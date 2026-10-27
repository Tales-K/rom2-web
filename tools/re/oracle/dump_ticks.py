"""Estado decodificado por tique de um episódio no Oracle (resume.py): export_state.read_state a cada tique (ou a cada N).

    PYTHONUTF8=1 .venv/Scripts/python.exe -X utf8 tools/re/oracle/dump_ticks.py [m10_start_s1 ...] [--every 1] [--ticks 960] [--check]
    (sem episódios = os 3 do portão; --check compara as linhas t múltiplas de 16 com states.jsonl.gz do golden, normalizado igual)

Saída: refs/oracle/ticks/<episodio>.jsonl.gz, uma linha por amostra: {"t": tiques rodados, ...read_state} (rng, tick, t16, units,
groups, diplomacy, hero). Como em states.jsonl do golden, só a linha t=0 traz plane1/plane2 (sem terrain_speed/altitude/sack_cells).
Normalizado para não depender da execução do processo: sem os campos de unidade que guardam endereços ou bytes não inicializados
(ptrs, range, body_state, book) e grupos ordenados. Unidades pelos CList do mundo (vivas + cadáveres, resume.unit_list), não por
varredura (mesmo conjunto que a varredura do harness).
"""
from __future__ import annotations

import gzip
import json
import os
import struct
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import resume as R  # noqa: E402

TICKS = os.path.join(R.ROOT, "refs", "oracle", "ticks")
DROP_UNIT = ("ptrs", "range", "body_state", "book")
DROP_BASE = ("terrain_speed", "altitude", "sack_cells")

# Registros do andar portado (etapa 6, game/src/sim/exe/types.ts): o importador (sim/test/import_state.ts) monta deles o UnitRec,
# o MapRec e a ocupação exatos do tique. Endereços valem só dentro desta imagem (o Unicorn é determinístico).
MAP_PTR = 0x670E48      # [ ] = objeto de mapa/caminho (MapRec, `this` das ondas)
WORLD_PTR = 0x66832C    # [ ] = mundo/IA (`this` de 0x56dca2/0x56e4ac; +0xa50 = MapRec)
MAPREC_SIZE = 0xA4570
OCC_HDR = 0x54084       # CMap<short,OccRec> (vtbl, tabela +4, tamanho +8, contagem +0xc); nó: próximo +0, hash +4, chave +8, valor +0xc
REC_N = 0xB4            # bytes de andar (+0x1c0) e de IA (+0x1c4) despejados (WalkRec vai até +0xb1, AiRec até +0xb1)


def _runs(old: bytes, new: bytes, gap: int = 8) -> list:
    """Trechos [deslocamento, hex] em que `new` difere de `old` (trechos a menos de `gap` bytes viram um)."""
    import numpy as np
    a, b = np.frombuffer(old, np.uint8), np.frombuffer(new, np.uint8)
    idx = np.nonzero(a != b)[0]
    out, i = [], 0
    while i < len(idx):
        s = e = int(idx[i])
        i += 1
        while i < len(idx) and int(idx[i]) - e <= gap:
            e = int(idx[i])
            i += 1
        out.append([s, new[s:e + 1].hex()])
    return out


class ExeTracker:
    """Estado do servidor que o andar portado lê, em deltas por tique: memória do MapRec (trechos alterados), baldes do CMap de
    ocupação que mudaram (cadeia inteira, na ordem do exe), estruturas novas apontadas por OccRec+0xc e os campos de unidade."""

    def __init__(self):
        self.mem = None
        self.buckets = None
        self.shape = None
        self.structs = set()

    def read(self, o, addrs: list) -> tuple[dict, dict]:
        mp = o.u32(MAP_PTR)
        mem = bytes(o.read(mp, MAPREC_SIZE))
        ex: dict = {"mem": [[0, mem.hex()]] if self.mem is None else _runs(self.mem, mem)}
        self.mem = mem
        hdr = mp + OCC_HDR
        tbl, n, cnt = o.u32(hdr + 4), o.u32(hdr + 8), o.u32(hdr + 0xC)
        buckets: dict = {}
        if tbl:
            for h in range(n):
                chain, p = [], o.u32(tbl + 4 * h)
                while p:
                    k = struct.unpack("<h", bytes(o.read(p + 8, 2)))[0]
                    chain.append([k, bytes(o.read(p + 0xC, 0x3C)).hex()])
                    p = o.u32(p)
                if chain:
                    buckets[h] = chain
        shape = (n, tbl == 0)
        if self.buckets is None or shape != self.shape:
            occ = {"n": n, "count": cnt, "null": tbl == 0, "full": 1, "b": {str(h): c for h, c in buckets.items()}}
        else:
            ch = {str(h): buckets.get(h, []) for h in set(buckets) | set(self.buckets) if buckets.get(h) != self.buckets.get(h)}
            occ = {"count": cnt, "b": ch} if ch or cnt != self.count else None
        self.buckets, self.shape, self.count = buckets, shape, cnt
        if occ:
            ex["occ"] = occ
        new = {}
        for chain in buckets.values():
            for _, v in chain:
                sp = struct.unpack_from("<I", bytes.fromhex(v), 0xC)[0]
                if sp and sp not in self.structs:
                    self.structs.add(sp)
                    mo = o.u32(sp + 0x10)
                    xy = bytes(o.read(mo, 2))
                    new[str(sp)] = [xy[0], xy[1], o.read(sp + 0x60, 1)[0], o.u32(sp + 0x64)]
        if new:
            ex["structs"] = new
        wd = o.u32(WORLD_PTR)
        ex["world"] = {"bbe8": o.u32(wd + 0xBBE8)}
        units = {}
        for a in addrs:
            b = bytes(o.read(a, 0x1D0))
            vt, uid = struct.unpack_from("<II", b, 0)
            if uid in units:
                continue
            t70, pl = struct.unpack_from("<I", b, 0x70)[0], struct.unpack_from("<I", b, 0x14)[0]
            st = o.u32(t70 + 0x3C) if t70 else 0
            mv, ai = struct.unpack_from("<I", b, 0x1C0)[0], struct.unpack_from("<I", b, 0x1C4)[0]
            units[uid] = {"a": a, "vt": vt, "f43": b[0x43], "size": b[0x49], "kind": b[0x4A], "u50": struct.unpack_from("<I", b, 0x50)[0],
                          "act": struct.unpack_from("<I", b, 0x54)[0], "speed": struct.unpack_from("<h", b, 0x8C)[0],
                          "hp": struct.unpack_from("<h", b, 0x94)[0], "mana": struct.unpack_from("<h", b, 0x9A)[0], "f12c": b[0x12C],
                          "f20": o.read(st + 0x20, 1)[0] if st else 0, "f44": o.read(st + 0x44, 1)[0] if st else 0,
                          "f45": o.read(st + 0x45, 1)[0] if st else 0, "p2c": o.u32(pl + 0x2C) if pl else 0,
                          "mv": bytes(o.read(mv, REC_N)).hex() if mv else "", "ai": bytes(o.read(ai, REC_N)).hex() if ai else ""}
        return ex, units


def normalize(st: dict) -> dict:
    st = {k: v for k, v in st.items() if k not in DROP_BASE}
    st["units"] = [{k: v for k, v in u.items() if k not in DROP_UNIT} for u in st["units"]]
    st["groups"] = sorted(st["groups"], key=lambda g: (g["player"], [u["id"] for u in g["units"]], g["center"],
                                                       json.dumps(g, sort_keys=True)))
    return st


def dump(eid: str, every: int = 1, ticks: int | None = None) -> dict:
    import original_episode as oe
    from export_state import map_wh, mission_of, read_state
    o, ep = R.load_episode(eid)
    ticks = ticks or ep["ticks"]
    srv = R.EmuServer(o.proc)
    rd = oe.Reader(srv)
    mission = mission_of(ep["state"])
    wh = map_wh(mission)
    os.makedirs(TICKS, exist_ok=True)
    path = os.path.join(TICKS, f"{eid}.jsonl.gz")
    t_read = [0.0]
    trk = ExeTracker()
    with gzip.open(path, "wt", encoding="utf-8", compresslevel=6) as fh:
        def snap(t):
            if t % every and t != ticks:
                return
            t0 = time.perf_counter()
            srv.units = R.unit_list(o)
            st = normalize(read_state(o.proc, srv, rd, mission, wh if t == 0 else None))
            ex, recs = trk.read(o, srv.units)
            for u in st["units"]:
                if u["id"] in recs:
                    u["exe"] = recs[u["id"]]
            st["exe"] = ex
            fh.write(json.dumps({"t": t, **st}, separators=(",", ":")) + "\n")
            t_read[0] += time.perf_counter() - t0
        t0 = time.perf_counter()
        snap(0)
        R.play(o, ep, ticks, after_tick=snap)
        dt = time.perf_counter() - t0
    return {"id": eid, "ticks": ticks, "every": every, "s": round(dt, 2), "ticks_per_s": round(ticks / dt, 1),
            "read_s": round(t_read[0], 2), "MB": round(os.path.getsize(path) / 1e6, 2), "out": path}


def check(eid: str, path: str) -> list:
    """Compara as linhas t % 16 == 0 com refs/golden/episodes/<id>/states.jsonl.gz normalizado igual. [] = idêntico."""
    ours = {}
    for l in gzip.open(path, "rt", encoding="utf-8"):
        f = json.loads(l)
        if f["t"] % 16 == 0:
            t = f["t"]
            f = {k: v for k, v in f.items() if k not in ("t", "exe")}
            f["units"] = [{k: v for k, v in u.items() if k != "exe"} for u in f["units"]]
            ours[t] = f
    bad = []
    for l in gzip.open(os.path.join(R.GOLD, eid, "states.jsonl.gz"), "rt", encoding="utf-8"):
        g = json.loads(l)
        t = g["step"]
        g = normalize({k: v for k, v in g.items() if k not in ("step", "state", "seed")})
        if ours.get(t) != g:
            bad.append((t, sorted(k for k in set(g) | set(ours.get(t, {})) if g.get(k) != ours.get(t, {}).get(k))))
    return bad


def main():
    argv = sys.argv[1:]

    def opt(name, default):
        if name in argv:
            i = argv.index(name)
            v = argv[i + 1]
            del argv[i:i + 2]
            return v
        return default
    every = int(opt("--every", "1"))
    do_check = "--check" in argv
    argv = [a for a in argv if a != "--check"]
    ticks = opt("--ticks", None)
    for eid in argv or R.GATE_EPISODES:
        r = dump(eid, every, int(ticks) if ticks else None)
        if do_check:
            bad = check(eid, r["out"])
            r["golden_states"] = "idênticos" if not bad else bad[:5]
        print(json.dumps(r, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
