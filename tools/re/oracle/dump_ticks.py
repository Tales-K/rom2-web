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
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import resume as R  # noqa: E402

TICKS = os.path.join(R.ROOT, "refs", "oracle", "ticks")
DROP_UNIT = ("ptrs", "range", "body_state", "book")
DROP_BASE = ("terrain_speed", "altitude", "sack_cells")


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
    with gzip.open(path, "wt", encoding="utf-8", compresslevel=6) as fh:
        def snap(t):
            if t % every and t != ticks:
                return
            t0 = time.perf_counter()
            srv.units = R.unit_list(o)
            st = normalize(read_state(o.proc, srv, rd, mission, wh if t == 0 else None))
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
            ours[f["t"]] = {k: v for k, v in f.items() if k != "t"}
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
