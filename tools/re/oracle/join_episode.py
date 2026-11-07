"""Episódio do oráculo DESDE A CARGA de qualquer missão, com o herói juntado pelo próprio servidor (F2 item 4).

1. Herói: o Igles de partida nova da imagem m10_start_s1 serializado pelo exe (0x4e9e97, a ficha .a2c que o servidor grava; só grava
   com [0x6044c4]+0x74 ≠ 0, posto só na chamada) → refs/oracle/heroes/igles_m10.a2c (uma vez).
2. Carga: load_mission.load(N) (Server_StartMap 0x4eb715 na imagem m10_start_s1, servidor novo).
3. Junção como o cliente: pacote 0xbe (+5 jogador, +9 = 0xbe, +10 tamanho, +0xe a ficha; 0x41c6b5) → no despachante 0x4f515d o
   servidor desserializa a ficha (0x4ea6ab) e põe o herói no jogador. [est] Com +0x1a8 = 0 (a carga da campanha) o caso 0xbe não
   desserializa e cria o personagem de reserva (0x4f254b com 0x19 em tudo); +0x1a8 é a escolha da interface (mensagem 0x46e/0x65,
   0x44d135): aqui vale 1 só no tique do 0xbe. Depois o pacote 4 (entrar na missão, +10 = 0 → 0x4f1d9c → 0x4f2c83: o herói vai a um
   ponto de entrada sorteado da lista do servidor +0xc0).
4. Tique 0 = o estado logo depois da junção; o roteiro é decidido no próprio oráculo a cada 16 tiques (o herói ataca o inimigo vivo
   mais perto: em guerra com o jogador do herói, senão um monstro) e gravado com o tique de cada ordem.

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

HEROES = os.path.join(ROOT, "refs", "oracle", "heroes")
GOLD = os.path.join(ROOT, "refs", "golden", "episodes")
PKT = 0x672F78                  # buffer do pacote 0xbe do cliente (0x41c6b5)
SAVE_CHAR = 0x4E9E97            # grava a ficha .a2c do herói (servidor multijogador)
H_A2C = 0x4F2F0000


def _file_hles(o, fs, cap):
    """CreateFileA/WriteFile que capturam a ficha .a2c gravada, e as APIs de caminho/volume que o CFile do MFC chama."""
    create0 = fs.create

    def create(o, a):
        name = o.read(a[0], 260).split(b"\0", 1)[0].decode("latin-1")
        if a[1] & 0x40000000 and name.lower().endswith(".a2c"):
            cap["data"] = bytearray()
            return H_A2C
        return create0(o, a)

    def write(o, a):
        if a[0] == H_A2C:
            cap["data"] += bytes(o.read(a[1], a[2]))
        if a[3]:
            o.set_u32(a[3], a[2])
        return 1

    def fullpath(o, a):
        s = bytes(o.read(a[0], 260)).split(b"\0", 1)[0]
        o.write(a[2], s + b"\0")
        if a[3]:
            o.set_u32(a[3], a[2])
        return len(s)

    def cpyn(o, a):
        s = bytes(o.read(a[1], max(1, a[2]))).split(b"\0", 1)[0][: max(0, a[2] - 1)]
        o.write(a[0], s + b"\0")
        return a[0]
    for name, n, fn in (("CreateFileA", 7, create), ("WriteFile", 5, write), ("GetFullPathNameA", 4, fullpath),
                        ("CreateDirectoryA", 2, lambda o, a: 1), ("FlushFileBuffers", 1, lambda o, a: 1),
                        ("SetEndOfFile", 1, lambda o, a: 1), ("lstrcpyn", 3, cpyn), ("lstrcpynA", 3, cpyn),
                        ("GetFileType", 1, lambda o, a: 1), ("GetVolumeInformationA", 8, lambda o, a: 0)):
        L.install(o, name, n, fn)


def hero_a2c(image: str = "m10_start_s1") -> bytes:
    path = os.path.join(HEROES, "igles_m10.a2c" if image == "m10_start_s1" else f"{image}.a2c")
    if os.path.exists(path):
        return open(path, "rb").read()
    o, fs = L.new_oracle(image)
    cap = {"data": bytearray()}
    _file_hles(o, fs, cap)
    hero = next(u for u in R.unit_list(o) if o.u32(u + 4) == o.meta["hero"])
    srv = o.u32(R.GAME_PTR)
    f74 = o.u32(srv + 0x74)
    o.set_u32(srv + 0x74, 1)
    o.call(SAVE_CHAR, args=(hero,))
    o.set_u32(srv + 0x74, f74)
    if not cap["data"]:
        raise SystemExit("0x4e9e97 não gravou a ficha")
    os.makedirs(HEROES, exist_ok=True)
    open(path, "wb").write(cap["data"])
    return bytes(cap["data"])


def join(o, a2c: bytes, player: int) -> None:
    def send(typ: int, rest: bytes) -> None:
        o.write(PKT + 5, struct.pack("<HHB", player, 0, typ) + rest)
        o.call(SEND, ecx=CLIENT_NET, args=[PKT])
    srv = o.u32(R.GAME_PTR)
    o.set_u32(srv + 0x1A8, 1)
    send(0xBE, struct.pack("<I", len(a2c)) + a2c)
    o.tick()
    o.set_u32(srv + 0x1A8, 0)
    send(0x04, struct.pack("<I", 0))
    o.tick()


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
    a2c = hero_a2c()
    o, fs, r = L.load(a.mission)
    if r != 0:
        raise SystemExit("carga devolveu %d" % r)
    join(o, a2c, o.meta["sender"])
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
          "note": "oráculo desde a carga (load_mission) + junção do herói pelo servidor (pacotes 0xbe/4; tools/re/oracle/join_episode.py)"}
    json.dump(ep, open(os.path.join(GOLD, eid, "ep.json"), "w", encoding="utf-8"), ensure_ascii=False)
    print(json.dumps({"id": eid, "ticks": a.ticks, "ordens": len(script), "s": round(time.perf_counter() - t_start, 1),
                      "MB": round(os.path.getsize(path) / 1e6, 2), "out": path}, ensure_ascii=False))


if __name__ == "__main__":
    main()
