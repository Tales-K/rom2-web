"""Pares do fnprobe gravados num episódio da junção (join_episode.py: missão desde a carga, com o herói), entre os tiques A e B.

Os episódios da junção não têm imagem `<id>_t0` (o Unicorn depois da carga não se salva como imagem), então o fnprobe de sempre não
roda neles; aqui o estado vem de `join_episode.start(missão)` e os tiques seguem o roteiro gravado do episódio (ep.json). A sonda só
liga no tique A (os tiques antes rodam sem ela). O par é coerente por construção (leituras/escritas com os valores, sorteios, objs);
o replay (`--verify`) não existe aqui, pela falta da imagem.

    PYTHONUTF8=1 .venv/Scripts/python.exe -X utf8 tools/re/oracle/join_pairs.py 110 40 400 0x519c04,0x579ddf,0x579d62 [--out m110_prism]
Saída: refs/oracle/pairs/<out>/<addr>.jsonl (o test:sim lê toda pasta de pairs/).
"""
from __future__ import annotations

import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fnprobe as F  # noqa: E402
import join_episode as J  # noqa: E402
import resume as R  # noqa: E402


def main():
    argv = sys.argv[1:]
    out = None
    if "--out" in argv:
        i = argv.index("--out")
        out = argv[i + 1]
        del argv[i:i + 2]
    m, a, b, fns_s = int(argv[0]), int(argv[1]), int(argv[2]), argv[3]
    out = out or "m%d_join_pairs" % m
    t0 = time.perf_counter()
    o, _ = J.start(m)
    with open(os.path.join(R.ROOT, "refs", "golden", "episodes", "m%d_join" % m, "ep.json"), encoding="utf-8") as fh:
        ep = json.load(fh)
    script, hero = sorted(ep.get("script", []), key=lambda x: x["t"]), ep["hero"]
    pend = list(script)
    pr = None
    for t in range(b):
        while pend and pend[0]["t"] <= t:
            R.apply_action(o, pend.pop(0), hero)
        if t == a:
            pr = F.Probe(o, F.parse_fns(fns_s.split(","), None), {})
            o.uc.ctl_flush_tb()
            pr.t = t
            pr.refresh_objects()
        if pr:
            pr.before_tick(t)
        o.tick()
    out_dir = os.path.join(F.PAIRS, out)
    os.makedirs(out_dir, exist_ok=True)
    per = {}
    for addr, recs in (pr.out.items() if pr else []):
        path = os.path.join(out_dir, "0x%x.jsonl" % addr)
        if not recs:
            if os.path.exists(path):
                os.remove(path)
            continue
        with open(path, "w", encoding="utf-8") as fh:
            for r in recs:
                fh.write(json.dumps(r, separators=(",", ":")) + "\n")
        per["0x%x" % addr] = len(recs)
    print(json.dumps({"s": round(time.perf_counter() - t0, 1), "per_fn": per, "out": out_dir}), flush=True)


if __name__ == "__main__":
    main()
