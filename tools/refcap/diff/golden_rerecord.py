"""Regrava os episódios do CORPUS DOURADO no original com o gravador de sorteios (DIFF-FUZZ fase 6) e anexa `rand.json.gz`.

Para cada episódio de refs/golden: roda de novo o original (run_pair.run_orig, mesmo roteiro/semente/tiques) com a caverna
original_episode.RandLog (grava toda chamada do rand(): chamador efetivo, argumento, valor, relógio), confere que o traço
(orig.jsonl compacto) e os estados (states.jsonl) saíram IDÊNTICOS aos guardados e só então grava `episodes/<id>/rand.json.gz`
e o registro no manifest (`files["rand.json.gz"]`, `rand: {n, sites, verified}`). Episódio divergente: não anexa; registra o motivo.

    .venv\\Scripts\\python.exe -X utf8 tools/refcap/diff/golden_rerecord.py [--only id1,id2] [--limit N] [--redo]
    .venv\\Scripts\\python.exe -X utf8 tools/refcap/diff/golden_rerecord.py --attach-only     # só confere/anexa o que já foi gravado

Saídas brutas em refs/trace/diff/rerec/<id>_*.  Trava scratch/refcap.lock (uma instância do original por vez).
Formato de rand.json.gz: {v, seed, t16_0, n, last_state, sites: [{ret, kind}], tick[], site[], a[], b[], val[]} (colunas, uma
entrada por chamada na ordem global; tick = índice do tique do episódio em que o sorteio aconteceu, val = rand() cru 0..32767).
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import golden_ingest as gi  # noqa: E402
import original_episode as oe  # noqa: E402
import run_pair as rp  # noqa: E402

GOLD = gi.GOLD
OUT = os.path.join(gi.ROOT, "refs", "trace", "diff", "rerec")


def lcg(s: int) -> int:
    return (s * 214013 + 2531011) & 0xFFFFFFFF


def check(eid: str, prefix: str) -> tuple[bool, str]:
    """Traço e estados idênticos ao guardado + cadeia do LCG contínua e alinhada aos estados."""
    d = os.path.join(GOLD, "episodes", eid)
    try:
        frames = gi.read_jsonl(prefix + "_orig.jsonl")
        new_orig = gi.compact_orig(frames)
        old_orig = gzip.open(os.path.join(d, "orig.jsonl.gz")).read()
        new_states = open(prefix + "_states.jsonl", "rb").read()
        old_states = gzip.open(os.path.join(d, "states.jsonl.gz")).read()
        rc = json.load(open(prefix + "_rand.json", encoding="utf-8"))
        ep = json.load(open(prefix + "_ep.json", encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        return False, f"ilegível ({e.__class__.__name__}: {e})"
    if ep.get("truncated") is not None:
        return False, f"truncado no tique {ep['truncated']}"
    if new_orig != old_orig:
        a, b = new_orig.split(b"\n"), old_orig.split(b"\n")
        k = next((i for i in range(min(len(a), len(b))) if a[i] != b[i]), min(len(a), len(b)))
        return False, f"traço difere na linha {k} ({len(a)} × {len(b)} linhas)"
    sa = [json.loads(l) for l in new_states.splitlines() if l.strip()]
    sb = [json.loads(l) for l in old_states.splitlines() if l.strip()]
    if [s.get("rng") for s in sa] != [s.get("rng") for s in sb]:
        return False, "rng dos estados difere"
    same_states = new_states == old_states
    ok, why = consistency(rc, sb)
    if not ok:
        return False, why
    return True, "ok" + ("" if same_states else " (estados: mesmo rng, conteúdo com outra diferença)")


def consistency(rc: dict, sb: list[dict]) -> tuple[bool, str]:
    """Cadeia do LCG: estado de cada chamada = lcg(anterior); o estado exportado no passo k = o da última chamada com tique < k."""
    s0 = sb[0].get("rng")
    vals, ticks = rc["val"], rc["tick"]
    st, chain_ok = s0, True
    by_step = {s["step"]: s.get("rng") for s in sb}
    states_at, j = {}, 0
    cur = s0
    # reconstrói os estados a partir da semente do passo 0 e dos valores: confere o valor de cada chamada
    for i in range(len(vals)):
        st = lcg(st)
        if ((st >> 16) & 0x7FFF) != vals[i]:
            chain_ok = False
            break
    if not chain_ok:
        return False, f"cadeia do LCG quebrada na chamada {i}"
    if st != rc["last_state"]:
        return False, "último estado do LCG não confere"
    bad = 0
    for k, want in by_step.items():
        while j < len(ticks) and ticks[j] < k:
            cur = lcg(cur)
            j += 1
        states_at[k] = cur
        if cur != want:
            bad += 1
    if bad:
        return False, f"{bad} estados com rng fora do alinhamento por tique (tique da chamada errado?)"
    return True, "ok"


def replace_all(m: dict, eid: str, prefix: str, why_old: str) -> tuple[bool, str]:
    """`--accept-new`: o carregador do original às vezes sorteia outro estado de animação inicial (fase 0) e o traço novo diverge do
    guardado desde o passo 0; a gravação nova é tão válida quanto (mesmo estado/semente/roteiro) e é coerente consigo mesma (cadeia do
    LCG × estados novos). Troca traço, base, estados e sorteios; os antigos ficam em *.v1.gz (fora do manifest)."""
    try:
        sa = gi.read_jsonl(prefix + "_states.jsonl")
        rc = json.load(open(prefix + "_rand.json", encoding="utf-8"))
        ep = json.load(open(prefix + "_ep.json", encoding="utf-8"))
        frames = gi.read_jsonl(prefix + "_orig.jsonl")
    except Exception as ex:  # noqa: BLE001
        return False, f"ilegível ({ex})"
    if ep.get("truncated") is not None or any(not x.get("ok", True) for x in ep.get("applied", [])):
        return False, "truncado ou ordem não aplicada"
    ok, why = consistency(rc, sa)
    if not ok:
        return False, why
    d = os.path.join(GOLD, "episodes", eid)
    e = next(x for x in m["episodes"] if x["id"] == eid)
    for fn, data in (("orig.jsonl.gz", gi.compact_orig(frames)), ("base.json.gz", open(prefix + "_base.json", "rb").read()),
                     ("states.jsonl.gz", open(prefix + "_states.jsonl", "rb").read())):
        p = os.path.join(d, fn)
        old = p.replace(".gz", ".v1.gz")
        if not os.path.exists(old):
            os.replace(p, old)
        gi.write_gz(p, data)
        e["files"][fn] = {"sha256": gi.sha256(p), "bytes": os.path.getsize(p)}
    e["export"] = {"version": 2, "from": "golden_rerecord.py (fase 6)", "old": "*.v1.gz (fora do manifest)"}
    e["rerecorded"] = {"why": why_old, "at": gi.iso(os.path.getmtime(prefix + "_orig.jsonl")),
                       "note": "traço regravado: o guardado divergia desde o passo 0 (estado de animação sorteado pelo carregador)"}
    attach(m, eid, prefix, "regravado (traço novo coerente com os sorteios)", False)
    return True, "regravado"


def attach(m: dict, eid: str, prefix: str, why: str, upgrade: bool) -> None:
    d = os.path.join(GOLD, "episodes", eid)
    rc = json.load(open(prefix + "_rand.json", encoding="utf-8"))
    gi.write_gz(os.path.join(d, "rand.json.gz"), json.dumps(rc, separators=(",", ":")).encode("utf-8"))
    e = next(x for x in m["episodes"] if x["id"] == eid)
    e.get("rand", {}).pop("rejected", None)
    if upgrade and "conteúdo" in why:
        # mesmo traço e mesmo rng: troca base/estados pelo export ATUAL (grupos, listas do andar, want/look_hit...); o antigo fica em *.v1.gz
        for fn, src in (("base.json.gz", "_base.json"), ("states.jsonl.gz", "_states.jsonl")):
            p = os.path.join(d, fn)
            old = p.replace(".gz", ".v1.gz")
            if not os.path.exists(old):
                os.replace(p, old)
            gi.write_gz(p, open(prefix + src, "rb").read())
            e["files"][fn] = {"sha256": gi.sha256(p), "bytes": os.path.getsize(p)}
        e["export"] = {"version": 2, "from": "golden_rerecord.py (fase 6)", "old": "base.json.v1.gz / states.jsonl.v1.gz (fora do manifest)"}
    p = os.path.join(d, "rand.json.gz")
    e["files"]["rand.json.gz"] = {"sha256": gi.sha256(p), "bytes": os.path.getsize(p)}
    e["rand"] = {"n": rc["n"], "sites": len(rc["sites"]), "verified": why, "recorded_at": gi.iso(os.path.getmtime(prefix + "_rand.json")),
                 "harness": "golden_rerecord.py: run_pair.run_orig + original_episode.RandLog (caverna em 0x5832af, sem breakpoint)"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--redo", action="store_true")
    ap.add_argument("--attach-only", action="store_true")
    ap.add_argument("--upgrade", action="store_true", help="troca base/estados pelo export atual quando traço e rng são idênticos")
    ap.add_argument("--retries", type=int, default=3, help="novas tentativas quando o traço sai diferente do guardado")
    ap.add_argument("--accept-new", action="store_true", help="traço diferente do guardado: troca tudo pela gravação nova (coerente)")
    ap.add_argument("--fresh-min", type=float, default=0, help="não regrava quem tem gravação bruta mais nova que N minutos")
    a = ap.parse_args()
    m = gi.load_manifest()
    eps = [e for e in m["episodes"] if not a.only or e["id"] in a.only.split(",")]
    if not a.redo:
        eps = [e for e in eps if "rand.json.gz" not in e["files"] or (a.upgrade and "export" not in e)]
    if a.limit:
        eps = eps[: a.limit]
    os.makedirs(OUT, exist_ok=True)
    todo = []
    for e in eps:
        prefix = os.path.join(OUT, e["id"])
        fresh = os.path.exists(prefix + "_rand.json") and time.time() - os.path.getmtime(prefix + "_rand.json") < a.fresh_min * 60
        if a.attach_only or fresh or (os.path.exists(prefix + "_rand.json") and not a.redo):
            continue
        todo.append(e)
    stats = {"ok": 0, "bad": 0}
    done: set = set()

    def finalize(e: dict) -> None:
        """confere e anexa JÁ (manifest salvo a cada episódio: uma queda do jogo não perde o que foi gravado)"""
        prefix = os.path.join(OUT, e["id"])
        done.add(e["id"])
        if not os.path.exists(prefix + "_rand.json"):
            return
        good, why = check(e["id"], prefix)
        print(f"{e['id']}: {'OK ' if good else 'DIFERENTE '}{why}", flush=True)
        if good:
            attach(m, e["id"], prefix, why, a.upgrade)
            stats["ok"] += 1
        elif a.accept_new and ("traço difere" in why or "rng dos estados" in why) and replace_all(m, e["id"], prefix, why)[0]:
            print(f"{e['id']}: REGRAVADO (traço novo)", flush=True)
            stats["ok"] += 1
        else:
            e.setdefault("rand", {})["rejected"] = why
            stats["bad"] += 1
        gi.save_manifest(m)

    if todo and not a.attach_only:
        oe.acquire_lock("golden_rerecord")
        try:
            k = 0
            while k < len(todo):
                with oe.Session(3600) as s:
                    rec = oe.RandLog(s.p)
                    while k < len(todo):
                        e = todo[k]
                        ep = json.load(open(os.path.join(GOLD, "episodes", e["id"], "ep.json"), encoding="utf-8"))
                        run = {"state": ep["state"], "seed": ep["seed"], "ticks": ep["ticks"], "actions": ep["script"], "name": e["id"]}
                        t0 = time.perf_counter()
                        crashed = False
                        for att in range(1 + a.retries):
                            try:
                                r = rp.run_orig(s, run, os.path.join(OUT, e["id"]), rec)
                            except Exception as ex:  # noqa: BLE001  (jogo caiu/laço preso: reabre e segue)
                                print(f"{e['id']}: ERRO {ex.__class__.__name__}: {ex}", flush=True)
                                crashed = True
                                break
                            good, why = check(e["id"], os.path.join(OUT, e["id"]))
                            print(f"{e['id']}: {r} {time.perf_counter() - t0:.1f} s, {rec.count()} sorteios, tentativa {att + 1}: {why}",
                                  flush=True)
                            if good or r.get("truncated") is not None or att >= a.retries:
                                break
                            # o carregador sorteia o estado de animação inicial (fase 0): às vezes 1 unidade sai com outro `state`
                            # no passo 0 e o traço inteiro muda; recarregar (outro estado antes, F3) às vezes resolve
                            other = next((x["state"] for x in m["episodes"] if x["state"] != run["state"]), None)
                            try:
                                if other:
                                    s.load(other, run["seed"])
                            except Exception as ex:  # noqa: BLE001
                                print(f"{e['id']}: recarga falhou ({ex}); reabre o jogo", flush=True)
                                crashed = True
                                break
                        k += 1
                        finalize(e)
                        if crashed or r.get("truncated") is not None:
                            break          # laço preso/jogo instável: reabre a sessão
        finally:
            oe.release_lock()
    for e in eps:
        if e["id"] not in done:
            finalize(e)
    gi.save_manifest(m)
    print(f"anexados {stats['ok']}, rejeitados {stats['bad']}; com rand: {sum('rand.json.gz' in e['files'] for e in m['episodes'])}/{len(m['episodes'])}")


if __name__ == "__main__":
    main()
