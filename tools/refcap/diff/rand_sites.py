"""Tabela dos chamadores do rand() gravados no corpus dourado (rand.json.gz): sorteios por site, função do C decompilado.
    .venv\\Scripts\\python.exe -X utf8 tools/refcap/diff/rand_sites.py [--top 40] [--json refs/golden/rand_sites.json]
"""
from __future__ import annotations

import argparse
import bisect
import csv
import gzip
import json
import os
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
GOLD = os.path.join(ROOT, "refs", "golden")
DECOMP = r"C:\Users\TALES K\Games\allods2-decomp"


def func_index() -> tuple[list[int], list[tuple[str, str]]]:
    rows = []
    p = os.path.join(DECOMP, "index.tsv")
    if os.path.exists(p):
        for r in csv.DictReader(open(p, encoding="utf-8", errors="replace"), delimiter="\t"):
            rows.append((int(r["addr"], 16), r["name"], r.get("desc") or ""))
    rows.sort()
    return [r[0] for r in rows], [(r[1], r[2]) for r in rows]


def func_of(addrs, names, ret: int) -> str:
    i = bisect.bisect_right(addrs, ret) - 1
    if i < 0:
        return "?"
    return "%s@0x%x" % (names[i][0], addrs[i])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--top", type=int, default=40)
    ap.add_argument("--json")
    ap.add_argument("--raw", help="pasta com <id>_rand.json (golden_rerecord, antes de anexar)")
    a = ap.parse_args()
    addrs, names = func_index()
    tot = Counter()
    eps = defaultdict(set)
    args = defaultdict(Counter)
    n_eps = 0
    if a.raw:       # saídas brutas do golden_rerecord (refs/trace/diff/rerec/<id>_rand.json), antes de anexar
        srcs = [(f[:-10], os.path.join(a.raw, f)) for f in sorted(os.listdir(a.raw)) if f.endswith("_rand.json")]
    else:
        srcs = [(e, os.path.join(GOLD, "episodes", e, "rand.json.gz")) for e in sorted(os.listdir(os.path.join(GOLD, "episodes")))]
    for eid, p in srcs:
        if not os.path.exists(p):
            continue
        n_eps += 1
        rc = json.load(gzip.open(p) if p.endswith(".gz") else open(p, encoding="utf-8"))
        keys = [(s["ret"], s["kind"]) for s in rc["sites"]]
        for si, aa, bb in zip(rc["site"], rc["a"], rc["b"]):
            k = keys[si]
            tot[k] += 1
            eps[k].add(eid)
            args[k][(aa, bb)] += 1
    allc = sum(tot.values())
    out = []
    for (ret, kind), c in tot.most_common():
        out.append({"ret": ret, "kind": kind, "func": func_of(addrs, names, int(ret, 16)), "calls": c, "episodes": len(eps[(ret, kind)]),
                    "args": [[list(k), v] for k, v in args[(ret, kind)].most_common(4)]})
    print(f"{n_eps} episódios, {allc} sorteios, {len(out)} sites")
    for r in out[: a.top]:
        print(f"{r['calls']:8d} {100 * r['calls'] / max(1, allc):5.1f}% {r['episodes']:4d}ep {r['ret']:>9s} {r['kind']:6s} {r['func']:32s} {r['args']}")
    if a.json:
        json.dump({"episodes": n_eps, "calls": allc, "sites": out}, open(a.json, "w", encoding="utf-8"), indent=1)


if __name__ == "__main__":
    main()
