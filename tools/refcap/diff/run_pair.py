"""Par original × nosso por JANELAS com RESSINCRONIZAÇÃO (fase 3 do teste diferencial; notes/differential-fuzz.md).

    .venv\\Scripts\\python.exe tools/refcap/diff/run_pair.py --battery 30 [--states m10_start,m10_mage,m20_start] [--ticks 960]
        [--window 80] [--seed0 1] [--minimize top|<assinatura>] [--no-bugs]
    .venv\\Scripts\\python.exe tools/refcap/diff/run_pair.py --reuse refs/trace/diff/pair    (só refaz o nosso lado e a comparação)

1. ORIGINAL (um processo, cópia a2_diff, relógio virtual): para cada episódio {estado da biblioteca, semente, roteiro gerado por
   gen_script.py, N tiques} grava quadros a cada 4 tiques e o ESTADO COMPLETO (export_state.read_state) a cada 16 tiques.
2. NOSSO (game/src/sim/test/diff_window.ts, um processo por episódio e passada): cada janela [início, fim) volta ao tique 0, copia o
   estado do original no início e roda as mesmas ações → teste independente, sem cascata.
3. COMPARAÇÃO nos tiques comuns (múltiplos de 4 = 0,25 s): por unidade do original (ids casados por import_state.matchUnits), campos
   vivo, alvo, tarefa (só herói), vida, mana e posição fina, com tolerância (2 amostras seguidas fora: vida/mana ≥ 3, posição > 0,75
   célula). A 1ª divergência da janela (tique k) é registrada com assinatura `campo|unidade|detalhe`; a janela seguinte recomeça do
   estado do original no 1º tique exportado ≥ k + 16 (passadas 2 e 3), até o fim da janela original.
4. RELATÓRIO: refs/trace/diff/pair/report.json e a seção "Diverge do original" de docs/BUGS.md (marcadores DIFF-FUZZ, preservada por
   tools/fuzz/report.mjs). `--minimize`: delta-debugging (ddmin) do roteiro do 1º episódio com a assinatura, re-rodando o original e
   o nosso, até o menor roteiro que ainda reproduz.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys
import time
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
import original_episode as oe  # noqa: E402
from export_state import mission_of, read_state, map_wh  # noqa: E402
from gen_script import generate  # noqa: E402
from orig_trace import acquire_lock, release_lock  # noqa: E402

PAIR = os.path.join(ROOT, "refs", "trace", "diff", "pair")
GAME = os.path.join(ROOT, "game")
SAMPLE, STATE_EVERY = 4, 16
TYPE_MISS: set = set()     # (id do original, tipo no original, tipo no nosso) excluídos da comparação
TASK_ORIG = {1: "move", 10: "move", 3: "attack", 8: "cast", 0xD: "cast", 0xE: "cast", 11: "idle", 12: "idle", 0: "idle", 0x17: "idle",
             16: "dead"}
TASK_OURS = {"move": "move", "attack": "attack", "cast": "cast", "none": "idle", "guard": "idle", "hold": "idle", "still": "idle",
             "follow": "move", "retreat": "move", "patrol": "move", "roam": "idle", "defend": "idle", "pickup": "move"}


# ---------------------------------------------------------------- lado original
def run_orig(s: oe.Session, ep: dict, prefix: str, rec: "oe.RandLog | None" = None) -> dict:
    """`rec` (fase 6): gravador de sorteios instalado na sessão; grava `<prefix>_rand.json` (toda chamada do rand() do episódio)."""
    state, seed, ticks, acts = ep["state"], ep["seed"], ep["ticks"], sorted(ep["actions"], key=lambda a: a["t"])
    s.load(state, seed)
    vc, rd, srv, g = s.vc, s.rd, s.srv, s.g
    rd.rescan()
    rd.set_seed(seed)
    vc.time_on(oe.VTIME0)
    if rec is not None:
        rec.begin()
    mission = mission_of(state)
    units = rd.units()
    hero = s.hero_id(units)
    setup_info = s.setup(ep["setup"], hero) if ep.get("setup") else None
    if setup_info:
        units = rd.units()
    st_addrs = s.structures() if ep.get("structures") else {}
    sel = [hero]
    pend = list(acts)
    frames, states = [], []
    t16_0 = srv.time16()

    def snap(step):
        st = read_state(s.p, srv, rd, mission)
        st.update({"step": step, "state": state, "seed": seed})
        if st_addrs:
            st["structures"] = s.read_structures(st_addrs)
        states.append(st)

    base = read_state(s.p, srv, rd, mission, map_wh(mission))
    base.update({"step": 0, "state": state, "seed": seed})
    if st_addrs:
        base["structures"] = s.read_structures(st_addrs)
    frames.append({"step": 0, "units": units})
    states.append({k: v for k, v in base.items() if k not in ("terrain_speed", "altitude", "sack_cells")})
    step, stalls, applied, truncated = 0, 0, [], None
    while step < ticks:
        while pend and pend[0]["t"] <= step:
            a = pend.pop(0)
            applied.append({**a, "ok": s.apply(a, sel, hero)})
        nxt = min(x for x in (ticks, (step // SAMPLE + 1) * SAMPLE, pend[0]["t"] if pend else ticks) if x > step)
        n = nxt - step
        t16b = srv.time16()
        try:
            vc.step(n, alive=g.check_alive)
        except TimeoutError:
            # laço de missão preso numa janela modal (fala, "Mission failed"...): fecha e espera o GATE voltar; senão trunca o episódio
            ok = False
            for _ in range(4):
                oe.flows.dismiss_dialogs(g, s.inp)
                try:
                    vc.wait_gate(2, timeout=3, alive=g.check_alive)
                    ok = True
                    break
                except TimeoutError:
                    continue
            if not ok:
                truncated = step
                print(f"   [orig] {ep.get('name', state)}: laço parado no tique {step}; episódio truncado", flush=True)
                break
            stalls += 1
        lost = n - (srv.time16() - t16b)
        while lost > 0:
            stalls += 1
            oe.flows.dismiss_dialogs(g, s.inp)
            t16b = srv.time16()
            vc.step(lost, alive=g.check_alive)
            lost -= srv.time16() - t16b
            if stalls > 50:
                raise RuntimeError("servidor não anda")
        step = nxt
        if step % 32 == 0:
            rd.rescan()
        if step % SAMPLE == 0:
            frames.append({"step": step, "units": rd.units()})
        if step % STATE_EVERY == 0 and step < ticks:
            snap(step)
    with open(prefix + "_orig.jsonl", "w", encoding="utf-8") as fh:
        for f in frames:
            fh.write(json.dumps(f) + "\n")
    with open(prefix + "_states.jsonl", "w", encoding="utf-8") as fh:
        for st in states:
            fh.write(json.dumps(st, separators=(",", ":")) + "\n")
    json.dump(base, open(prefix + "_base.json", "w", encoding="utf-8"), separators=(",", ":"))
    if rec is not None:
        rc = oe.rand_calls(rec.records(), t16_0)
        rc["seed"] = seed
        json.dump(rc, open(prefix + "_rand.json", "w", encoding="utf-8"), separators=(",", ":"))
    json.dump({**ep, "hero": hero, "stalls": stalls, "applied": applied, "t16_0": t16_0, "truncated": truncated},
              open(prefix + "_ep.json", "w", encoding="utf-8"))
    return {"frames": len(frames), "states": len(states), "stalls": stalls, "truncated": truncated}


# ---------------------------------------------------------------- lado nosso
def run_ours(prefix: str, actions: list[dict], windows: list[tuple[int, int]], tag: str) -> list[dict]:
    prefix = os.path.abspath(prefix)
    spec = {"base": prefix + "_base.json", "states": prefix + "_states.jsonl", "actions": actions,
            "windows": [{"start": a, "end": b} for a, b in windows], "sample": SAMPLE, "out": f"{prefix}_ours_{tag}.jsonl"}
    sp = f"{prefix}_spec_{tag}.json"
    json.dump(spec, open(sp, "w", encoding="utf-8"))
    r = subprocess.run(f'npx tsx src/sim/test/diff_window.ts --spec "{sp}"', cwd=GAME, shell=True, capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise RuntimeError(f"diff_window falhou: {r.stderr[-2000:]}")
    return [json.loads(l) for l in open(spec["out"], encoding="utf-8") if l.strip()]


# ---------------------------------------------------------------- comparação
def compare_window(orig: dict[int, dict], ours: list[dict], start: int, end: int, hero: int, types: dict) -> dict | None:
    """1ª divergência persistente (2 amostras) da janela; None = igual dentro da tolerância."""
    streak: dict[tuple, int] = defaultdict(int)
    typemiss = TYPE_MISS
    for f in ours:
        st = f["step"]
        if st <= start or st not in orig:
            continue
        ou = {u["id"]: u for u in orig[st]["units"]}
        nu = {u["id"]: u for u in f["units"]}
        found = []
        for i, o in ou.items():
            if i == 0 or (o["fx"] < 1 and o["fy"] < 1):       # objeto fora do mapa da invocação (Summon), não é unidade em jogo
                continue
            n = nu.get(i)
            oal = o["state"] != 0x10 and o["hp"] > 0
            who = "hero" if i == hero else f"t{o['type']}"
            if n is None:
                if oal:
                    found.append(("spawn", i, who, "orig_only", None, None))
                continue
            if n.get("type") is not None and n["type"] != o["type"] and i != hero:
                typemiss.add((i, o["type"], n["type"]))
                continue                     # tipo diferente no nosso mapa (m20: humanos tipo 1 × Peasant): fora da comparação
            nal = bool(n["alive"]) and n["hp"] > 0
            if oal != nal:
                found.append(("alive", i, who, "orig_dead" if not oal else "ours_dead", o["hp"], n["hp"]))
                continue
            if not oal:
                continue
            # alvo: o do original (+0x1c4+0xc) vale com tarefa de ataque/magia ou modo engajado (5 guarda, 6 parado revidando)
            ot = o["target"] if (o["mode"] in (5, 6, 8) or o["task"] in (8, 0xD)) else 0
            nt = n["target"] if isinstance(n["target"], int) and n.get("armed", True) else 0
            # lançando (tarefa 0xD): o +0x1c4+0xc do original continua o alvo de ATAQUE anterior (a magia guarda o dela à parte; Shield
            # em si mesmo deixa o inimigo ali) — o alvo só se compara fora do lançamento
            if n.get("task") == "cast" and (o["task"] == 0xD or o["state"] == 13):
                ot = nt                # (estado 13 = animação do lançamento, já com a tarefa trocada para 12)
            if ot != nt:
                kind = lambda t: "none" if not t else ("hero" if t == hero else "unit")
                found.append(("target", i, who, f"o:{kind(ot)}/n:{kind(nt)}", ot, nt))
            if i == hero and n.get("armed", True):
                oc, nc = TASK_ORIG.get(o["task"], f"#{o['task']}"), TASK_OURS.get(n["task"], n["task"])
                if oc == "idle" and o["mode"] in (5, 6) and o["target"]:
                    oc = "attack"          # parado/guarda revidando (modo 5/6 com alvo) = nosso ataque automático
                if o["state"] == 13 and nc == "cast":
                    oc = "cast"            # animação do lançamento (estado 13) com a tarefa já trocada para 12
                if oc != nc:
                    found.append(("task", i, who, f"o:{oc}/n:{nc}", o["task"], n["task"]))
            if abs(o["hp"] - n["hp"]) >= 3:
                found.append(("hp", i, who, "ours_higher" if n["hp"] > o["hp"] else "ours_lower", o["hp"], n["hp"]))
            if abs(o["mana"] - n["mana"]) >= 3:
                found.append(("mana", i, who, "ours_higher" if n["mana"] > o["mana"] else "ours_lower", o["mana"], n["mana"]))
            d = math.hypot(o["fx"] - n["fx"], o["fy"] - n["fy"])
            if d > 0.75:
                om = (o["fx"] % 1, o["fy"] % 1) != (0.5, 0.5)
                found.append(("pos", i, who, f"o:{'anda' if om else 'parado'}/n:{'anda' if n['state'] == 'move' else 'parado'}",
                              [o["fx"], o["fy"]], [n["fx"], n["fy"]]))
        for i, n in nu.items():
            if isinstance(i, str) and n["alive"]:
                found.append(("spawn", i, f"t{n['type']}", "ours_only", None, None))
        keys = set()
        for fd in found:
            k = fd[:4]
            keys.add(k)
            streak[k] += 1
            if streak[k] >= 2:
                order = {"alive": 0, "spawn": 1, "target": 2, "task": 3, "hp": 4, "mana": 5, "pos": 6}
                fs = sorted((x for x in found if streak[x[:4]] >= 2), key=lambda x: order[x[0]])
                field, uid, who, detail, a, b = fs[0]
                return {"step": st - SAMPLE, "sec": (st - SAMPLE) / 16, "field": field, "unit": uid, "who": who, "detail": detail,
                        "orig": a, "ours": b, "sig": f"{field}|{who}|{detail}", "also": [f"{x[0]}|{x[2]}|{x[3]}" for x in fs[1:4]]}
        for k in list(streak):
            if k not in keys:
                streak[k] = 0
    return None


def pair_episode(prefix: str, ticks: int, window: int, max_pass: int = 3) -> dict:
    ep = json.load(open(prefix + "_ep.json", encoding="utf-8"))
    if ep.get("truncated") is not None:
        ticks = min(ticks, ep["truncated"])
    orig = {f["step"]: f for f in map(json.loads, open(prefix + "_orig.jsonl", encoding="utf-8"))}
    st_steps = sorted(json.loads(l)["step"] for l in open(prefix + "_states.jsonl", encoding="utf-8"))
    types = {}
    wins = [(a, min(a + window, ticks)) for a in range(0, ticks, window)]
    results, todo = [], wins
    for p in range(max_pass):
        if not todo:
            break
        frames = run_ours(prefix, ep["actions"], todo, f"p{p}")
        by_win = defaultdict(list)
        meta = {}
        for f in frames:
            if "units" in f:
                by_win[f["win"]].append(f)
            else:
                meta[f["win"]] = f
        nxt = []
        for wi, (a, b) in enumerate(todo):
            d = compare_window(orig, by_win.get(wi, []), a, b, ep["hero"], types)
            results.append({"start": a, "end": b, "pass": p, "div": d, "apply": meta.get(wi, {}).get("apply")})
            if d:
                e = next((s for s in st_steps if s >= d["step"] + 16), None)
                if e is not None and e < b - 16:
                    nxt.append((e, b))
        todo = nxt
    return {"prefix": os.path.basename(prefix), "state": ep["state"], "seed": ep["seed"], "windows": results}


# ---------------------------------------------------------------- relatório
def summarize(eps: list[dict]) -> dict:
    sigs: dict[str, dict] = {}
    nwin = ndiv = 0
    for e in eps:
        for w in e["windows"]:
            nwin += 1
            d = w["div"]
            if not d:
                continue
            ndiv += 1
            g = sigs.setdefault(d["sig"], {"sig": d["sig"], "count": 0, "episodes": set(), "first": None})
            g["count"] += 1
            g["episodes"].add(e["prefix"])
            if g["first"] is None:
                g["first"] = {"episode": e["prefix"], "state": e["state"], "seed": e["seed"], "window": [w["start"], w["end"]], **d}
    out = sorted(sigs.values(), key=lambda g: -g["count"])
    for g in out:
        g["episodes"] = sorted(g["episodes"])
    return {"episodes": len(eps), "windows": nwin, "divergent_windows": ndiv, "unique": len(out), "signatures": out}


CAUSES = {}   # assinatura (prefixo) → causa provável (preenchido à mão em causes.json depois da análise)


def write_bugs(rep: dict, causes: dict):
    path = os.path.join(ROOT, "docs", "BUGS.md")
    text = open(path, encoding="utf-8").read() if os.path.exists(path) else ""
    L = ["<!-- DIFF-FUZZ:BEGIN -->", "## Diverge do original (teste diferencial, tools/refcap/diff/run_pair.py)", "",
         f"Gerado em {time.strftime('%Y-%m-%d %H:%M')}: {rep['episodes']} episódios, {rep['windows']} janelas de ≤ 5 s com ressincronização, "
         f"{rep['divergent_windows']} janelas divergentes, {rep['unique']} assinaturas únicas. Cada janela parte do estado do original "
         "(export_state.py) e roda as mesmas ações nos dois motores; assinatura = `campo|unidade|detalhe` (o = original, n = nosso).",
         f"Reproduzir: `.venv\\Scripts\\python.exe tools/refcap/diff/run_pair.py --reuse {os.path.relpath(PAIR, ROOT).replace(os.sep, '/')}` "
         f"(nosso lado) ou o episódio inteiro com o roteiro de `{os.path.relpath(PAIR, ROOT).replace(os.sep, '/')}/<ep>_ep.json`.", "",
         "| # | Assinatura | Ocorrências | Episódios | 1º exemplo | Causa provável / status |", "|---|---|---|---|---|---|"]
    for k, g in enumerate(rep["signatures"], 1):
        f = g["first"]
        cause = next((v for p, v in causes.items() if g["sig"].startswith(p)), "a investigar")
        L.append(f"| {k} | `{g['sig']}` | {g['count']} | {len(g['episodes'])} | {f['episode']} jan. {f['window'][0]}–{f['window'][1]}, "
                 f"t = {f['sec']:.2f} s, unidade {f['unit']}: o {f['orig']} × n {f['ours']} | {cause} |")
    L += ["", "<!-- DIFF-FUZZ:END -->"]
    block = "\n".join(L)
    if "<!-- DIFF-FUZZ:BEGIN -->" in text:
        import re
        text = re.sub(r"<!-- DIFF-FUZZ:BEGIN -->[\s\S]*<!-- DIFF-FUZZ:END -->", lambda m: block, text)
    else:
        text = text.rstrip() + "\n\n" + block + "\n"
    open(path, "w", encoding="utf-8").write(text)


# ---------------------------------------------------------------- minimização (ddmin)
def ddmin(actions: list[dict], test) -> list[dict]:
    n = 2
    cur = list(actions)
    while len(cur) >= 2:
        chunk = math.ceil(len(cur) / n)
        subsets = [cur[i:i + chunk] for i in range(0, len(cur), chunk)]
        reduced = False
        for i in range(len(subsets)):
            comp = [a for j, s in enumerate(subsets) if j != i for a in s]
            if comp and test(comp):
                cur, n, reduced = comp, max(n - 1, 2), True
                break
        if not reduced:
            if n >= len(cur):
                break
            n = min(len(cur), n * 2)
    return cur


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--battery", type=int, default=0)
    ap.add_argument("--states", default="m10_start,m10_mage,m20_start")
    ap.add_argument("--ticks", type=int, default=960)
    ap.add_argument("--window", type=int, default=80)
    ap.add_argument("--seed0", type=int, default=1)
    ap.add_argument("--reuse")
    ap.add_argument("--minimize")
    ap.add_argument("--no-bugs", action="store_true")
    ap.add_argument("--redo", action="store_true", help="refaz o lado original mesmo se o episódio já existe")
    ap.add_argument("--script", help="um episódio com este roteiro (com --state/--seed/--name)")
    ap.add_argument("--state", default="m10_start")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--name", default="single")
    ap.add_argument("--dir", help="pasta dos episódios (padrão refs/trace/diff/pair; --reuse <pasta> também a escolhe)")
    ap.add_argument("--episodes", help="JSON com a lista de episódios prontos (name, state, seed, ticks, actions, setup, structures)")
    a = ap.parse_args()
    global PAIR
    if a.dir or a.reuse:
        PAIR = os.path.abspath(a.dir or a.reuse)
    os.makedirs(PAIR, exist_ok=True)
    states = a.states.split(",")
    eps = []
    for k in range(a.battery):
        state = states[k % len(states)]
        seed = a.seed0 + k
        base = os.path.join(ROOT, "refs", "trace", "diff", f"state_{state}.json")
        st = json.load(open(base, encoding="utf-8"))
        eps.append({"name": f"e{k:02d}_{state}_s{seed}", "state": state, "seed": seed, "ticks": a.ticks,
                    "actions": generate(st, seed, a.ticks)})
    if a.script:
        eps.append({"name": a.name, "state": a.state, "seed": a.seed, "ticks": a.ticks,
                    "actions": oe.normalize_script(json.load(open(a.script, encoding="utf-8")))})
    if a.episodes:               # lista pronta: [{name, state, seed, ticks, actions, setup?, structures?}] (group_episodes.py)
        for e in json.load(open(a.episodes, encoding="utf-8")):
            eps.append({**e, "actions": oe.normalize_script(e["actions"])})
    t0 = time.time()
    if eps:
        acquire_lock("run_pair")
        failed = []
        try:
            todo = [ep for ep in eps if a.redo or not os.path.exists(os.path.join(PAIR, ep["name"] + "_ep.json"))]
            while todo:
                with oe.Session(3600) as s:            # reabre o jogo se um episódio deixar o laço preso
                    while todo:
                        ep = todo.pop(0)
                        try:
                            r = run_orig(s, ep, os.path.join(PAIR, ep["name"]))
                        except Exception as e:  # noqa: BLE001
                            failed.append(ep["name"])
                            print(f"[orig] {ep['name']}: FALHOU ({e}); reabrindo o jogo", flush=True)
                            break
                        print(f"[orig] {ep['name']}: {r} ({time.time() - t0:.0f} s)", flush=True)
                        if r.get("truncated") is not None:
                            break
        finally:
            release_lock()
        eps = [e for e in eps if e["name"] not in failed]
    names = [e["name"] for e in eps] or sorted({f[:-8] for f in os.listdir(a.reuse or PAIR) if f.endswith("_ep.json")})
    results = []
    for nm in names:
        r = pair_episode(os.path.join(PAIR, nm), a.ticks, a.window)
        nd = sum(1 for w in r["windows"] if w["div"])
        print(f"[par] {nm}: {len(r['windows'])} janelas, {nd} divergentes", flush=True)
        results.append(r)
    rep = summarize(results)
    rep["type_mismatch"] = sorted(TYPE_MISS)
    json.dump({"summary": {k: v for k, v in rep.items() if k != "signatures"}, "signatures": rep["signatures"], "episodes": results},
              open(os.path.join(PAIR, "report.json"), "w", encoding="utf-8"), indent=1, default=list)
    print(json.dumps({k: v for k, v in rep.items() if k != "signatures"}))
    for g in rep["signatures"][:12]:
        print(f"  {g['count']:3d} × {g['sig']}  ({len(g['episodes'])} ep.)  ex: {g['first']['episode']} t={g['first']['sec']:.2f} "
              f"u{g['first']['unit']} o={g['first']['orig']} n={g['first']['ours']}")
    causes_p = os.path.join(HERE, "causes.json")
    causes = json.load(open(causes_p, encoding="utf-8")) if os.path.exists(causes_p) else {}
    if not a.no_bugs:
        write_bugs(rep, causes)
    if a.minimize:
        sig = rep["signatures"][0]["sig"] if a.minimize == "top" else a.minimize
        g = next(x for x in rep["signatures"] if x["sig"] == sig)
        nm = g["first"]["episode"]
        ep = json.load(open(os.path.join(PAIR, nm + "_ep.json"), encoding="utf-8"))
        acquire_lock("run_pair_min")
        tries = []
        try:
            with oe.Session(3600) as s:
                def test(sub):
                    pre = os.path.join(PAIR, f"min_{len(tries):03d}")
                    run_orig(s, {**ep, "actions": sub}, pre)
                    r = pair_episode(pre, ep["ticks"], a.window, max_pass=1)
                    ok = any(w["div"] and w["div"]["sig"] == sig for w in r["windows"])
                    tries.append({"n": len(sub), "ok": ok})
                    print(f"[min] {len(sub)} ações → {'reproduz' if ok else 'não'}", flush=True)
                    return ok
                best = ddmin(ep["actions"], test)
        finally:
            release_lock()
        out = os.path.join(PAIR, f"minimized_{nm}.json")
        json.dump({"sig": sig, "episode": nm, "state": ep["state"], "seed": ep["seed"], "actions": best, "tries": tries},
                  open(out, "w", encoding="utf-8"), indent=1)
        print(f"[min] {sig}: {len(ep['actions'])} → {len(best)} ações ({out})")


if __name__ == "__main__":
    main()
