"""Episódio do oráculo DESDE A CARGA de qualquer missão, com o herói (e os companheiros) já no jogador, como na campanha (F2 item 4).

A ordem do jogo (cliente 0x48c8a3): o servidor da campanha PERSISTE de uma missão para a outra; o Server_StartMap 0x4eb715 é chamado
nele (+0x1ac = 0: mapa, não save), e só depois o cliente manda o pacote 4 (entrar: 0x41c50d → 0x4f1d9c → 0x4f2c83, o ponto de
entrada sorteado da lista +0xc0). A carga do script (0x5606aa → 0x562745) resolve na hora as referências especiais (0x562274 →
0x562518: o herói e o grupo do 1.º jogador humano pelo índice +0x14c − 0x15; sem a unidade, "Can't resolve hero" e o valor não é
criado), então o herói e os companheiros têm de estar no jogador ANTES da carga.

1. Servidor: o da imagem m10_start_s1 (o Igles de partida nova já no jogador 1); 0x4ebd5f, o fim da missão do cliente (0x41d).
2. Companheiros que o script da missão cita (10002 → NPC 22, Igles; 10003 → NPC 23, Dina) pelo próprio exe: Server_InnNpcCreate
   0x4f312a(estágio, [NPCs]) — template NPC × 10 + 10000, variante do estágio NPC × 10 + 9998 + estágio/10; índice +0x14c = NPC.
3. Server_StartMap("<N>.alm") no mesmo servidor e o pacote 4; o tique 0 é o estado logo depois.
4. O roteiro é decidido no oráculo a cada 16 tiques (o herói ataca o inimigo vivo mais perto: em guerra com o jogador dele, senão
   um monstro) e gravado com o tique de cada ordem.

Validação por equivalência (sem o jogo real): StartMap("10.alm") e ("20.alm") nas imagens m10_start_s1/m20_start_s203 dão a MESMA tabela
de valores do script dos saves reais (ids, tipos, parâmetros) e o mesmo tique 0 salvo o tempo já andado e o rng do save
(notes/largar-synccombat.md).

Saída: refs/golden/episodes/<id>/{ep.json, base.json.gz} e refs/oracle/ticks/<id>.jsonl.gz (o formato do dump_ticks). Sem imagem
<id>_t0 (o estado do Unicorn depois da carga não se salva como imagem): fnprobe nesses episódios fica de fora.

    PYTHONUTF8=1 .venv/Scripts/python.exe -X utf8 tools/re/oracle/join_episode.py --mission 30 --ticks 2400 [--id m30_join]
    cd game && npx tsx ../tools/refcap/mirror/free_run.mts --episode m30_join
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import struct
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "tools", "refcap", "diff"))
import load_mission as L  # noqa: E402
import resume as R  # noqa: E402
import dump_ticks as D  # noqa: E402
from resume import CLIENT_NET, SEND  # noqa: E402

GOLD = os.path.join(ROOT, "refs", "golden", "episodes")
SCRIPTS = os.path.join(ROOT, "game", "public", "data", "scripts")
PKT = 0x672F78                  # buffer de pacotes do cliente (0x41c50d)
INN_NPC_CREATE = 0x4F312A       # Server_InnNpcCreate(estágio, CWordArray de NPCs)
END_MISSION = 0x4EBD5F          # fim da missão no servidor (fastcall; o cliente o chama na mensagem 0x41d)
COMPANION_NPC = {10002: 22, 10003: 23}


def companions(mission: int) -> list[int]:
    """Os NPCs dos companheiros que o script da missão cita (referências especiais 10002/10003)."""
    j = json.load(open(os.path.join(SCRIPTS, f"{mission}.json"), encoding="utf-8"))
    refs = {p["value"] for r in j["values"] + j["actions"] for p in r["params"] if p.get("type") == "unit" and p.get("value", 0) >= 10002}
    return [COMPANION_NPC[r] for r in sorted(refs) if r in COMPANION_NPC]


def start(mission: int, image: str = "m10_start_s1"):
    """O servidor da imagem, os companheiros, Server_StartMap e o pacote 4 (entrar). Devolve (oráculo, NPCs criados)."""
    o, fs = L.new_oracle(image)
    srv = o.u32(R.GAME_PTR)
    # fim da missão anterior como o cliente faz (mensagem 0x41d, g_480000.c ~2891): 0x4ebd5f refaz o jogador (+0x40/+0x41 = 0: o
    # pacote 4 volta a levar ao ponto de entrada) e logo depois Server_InnNpcCreate(var 0x300 = estágio, o grupo da campanha)
    o.call(END_MISSION, ecx=srv)
    npcs = companions(mission)
    if npcs:
        data, arr = o.heap_alloc(0x40), o.heap_alloc(0x40)
        o.write(data, struct.pack("<%dH" % len(npcs), *npcs))
        o.write(arr, struct.pack("<IIIII", 0, data, len(npcs), len(npcs), 0))       # CWordArray {vtbl, m_pData, m_nSize, m_nMaxSize, grow}
        o.call(INN_NPC_CREATE, args=(mission // 10 * 10, arr))
    o.set_u32(srv + 0x6B * 4, 0)                                                     # +0x1ac = 0: mapa, não save (0x48c8a3)
    r = o.call(L.START_MAP, ecx=srv, args=(L.cstring(o, "%d.alm" % mission),))
    if r != 0:
        raise SystemExit("Server_StartMap devolveu %d" % r)
    o.write(PKT + 5, struct.pack("<HHBI", o.meta["sender"], 0, 4, 0))                # pacote 4: entrar na missão (+10 = 0)
    o.call(SEND, ecx=CLIENT_NET, args=[PKT])
    o.tick()
    return o, npcs


def pick_target(st: dict) -> int | None:
    """O alvo vivo mais perto do herói (Chebyshev): em guerra com o jogador dele, senão um monstro (ataque forçado)."""
    us = st["units"]
    h = next((u for u in us if u["id"] == st.get("hero")), None)
    if not h or h["hp"] <= 0 or h.get("state") == 0x10:
        return None
    dip = st["diplomacy"]
    hp_ = h["player"]

    def war(p):
        return (dip[hp_][p] & 1) or (dip[p][hp_] & 1)
    best = None
    for pref in (True, False):
        for u in us:
            if u["id"] == h["id"] or u["hp"] <= 0 or u.get("state") == 0x10 or u["player"] == hp_:
                continue
            if (pref and not war(u["player"])) or (not pref and u.get("kind") != "monster"):
                continue
            d = max(abs(u["x"] - h["x"]), abs(u["y"] - h["y"]))
            if best is None or d < best[0]:
                best = (d, u["id"])
        if best:
            return best[1]
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mission", type=int, required=True)
    ap.add_argument("--ticks", type=int, default=2400)
    ap.add_argument("--id")
    ap.add_argument("--every", type=int, default=16, help="de quantos em quantos tiques o herói reavalia o alvo")
    a = ap.parse_args()
    eid = a.id or f"m{a.mission}_join"
    import original_episode as oe
    from export_state import map_wh, read_state
    t_start = time.perf_counter()
    o, npcs = start(a.mission)
    srv = R.EmuServer(o.proc)
    rd = oe.Reader(srv)
    wh = map_wh(a.mission)
    trk = D.ExeTracker()
    os.makedirs(D.TICKS, exist_ok=True)
    os.makedirs(os.path.join(GOLD, eid), exist_ok=True)
    path = os.path.join(D.TICKS, f"{eid}.jsonl.gz")
    script: list[dict] = []
    cur = None
    with gzip.open(path, "wt", encoding="utf-8", compresslevel=6) as fh:
        def snap(t):
            srv.units = R.unit_list(o)
            raw = read_state(o.proc, srv, rd, a.mission, wh if t == 0 else None)
            st = D.normalize(dict(raw))
            ex, recs = trk.read(o, srv.units)
            for u in st["units"]:
                if u["id"] in recs:
                    u["exe"] = recs[u["id"]]
            st["exe"] = ex
            fh.write(json.dumps({"t": t, **st}, separators=(",", ":")) + "\n")
            return raw, st
        raw0, st = snap(0)
        if st.get("hero") is None:
            raise SystemExit("sem herói depois da junção")
        base = {**raw0, "step": 0, "state": eid, "seed": raw0.get("rng"), "from_load": True}   # antes do 1.º pensamento (import_state)
        with gzip.open(os.path.join(GOLD, eid, "base.json.gz"), "wt", encoding="utf-8") as bf:
            json.dump(base, bf)
        hero = st["hero"]
        for step in range(a.ticks):
            if step % a.every == 0:
                alive = {u["id"]: u for u in st["units"] if u["hp"] > 0 and u.get("state") != 0x10}
                if cur not in alive:
                    cur = pick_target(st)
                    if cur is not None:
                        act = {"t": step, "do": "attack", "unit": "hero", "target": cur}
                        R.apply_action(o, act, hero)
                        script.append(act)
            o.tick()
            _, st = snap(step + 1)
    ep = {"state": eid, "mission": a.mission, "seed": base["seed"], "hero": hero, "t16_0": raw0.get("t16"), "stalls": 0, "id": eid,
          "ticks": a.ticks, "script": script,
          "companions": npcs, "note": "oráculo desde a carga: servidor da campanha com o herói, Server_StartMap e o pacote 4 (tools/re/oracle/join_episode.py)"}
    json.dump(ep, open(os.path.join(GOLD, eid, "ep.json"), "w", encoding="utf-8"), ensure_ascii=False)
    print(json.dumps({"id": eid, "ticks": a.ticks, "ordens": len(script), "s": round(time.perf_counter() - t_start, 1),
                      "MB": round(os.path.getsize(path) / 1e6, 2), "out": path}, ensure_ascii=False))


if __name__ == "__main__":
    main()
