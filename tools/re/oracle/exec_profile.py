"""Perfil de execução do servidor no oráculo: quantas vezes cada função do `index.tsv` é *entrada* durante N tiques de cada
episódio (hook por bloco básico do Unicorn sobre .text; ~2 s por 160 tiques). Serve para ordenar a porta por frequência real,
detectar nomes errados (função "conhecida" que nunca roda) e separar código morto nos episódios do corpus.

    PYTHONUTF8=1 .venv/Scripts/python.exe -X utf8 tools/re/oracle/exec_profile.py [--ticks 960] [--out tools/re/exec_profile.tsv] [ep ...]

Saída (TSV): addr, name, total, calls_<ep>... (só funções com total > 0), ordenada por total decrescente.
"""
from __future__ import annotations

import argparse
import collections
import csv
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
import resume  # noqa: E402
from unicorn import UC_HOOK_BLOCK  # noqa: E402

DECOMP = os.environ.get("A2_DECOMP", r"C:\Users\TALES K\Games\allods2-decomp")
DEFAULT_EPS = ["m10_start_s1", "m10_mage_s102", "m20_start_s203"]
TEXT = (0x401000, 0x5CA000)


def load_index() -> dict[int, str]:
    idx = {}
    with open(os.path.join(DECOMP, "index.tsv"), encoding="utf8") as f:
        for row in csv.reader(f, delimiter="\t"):
            if row and row[0].startswith("0x"):
                idx[int(row[0], 16)] = row[1]
    return idx


def profile(eid: str, ticks: int, idx: dict[int, str]) -> collections.Counter:
    o, ep = resume.load_episode(eid)
    hits: collections.Counter = collections.Counter()

    def cb(_uc, addr, _size, _):
        if addr in idx:
            hits[addr] += 1

    o.uc.hook_add(UC_HOOK_BLOCK, cb, begin=TEXT[0], end=TEXT[1])
    t0 = time.time()
    resume.play(o, ep, ticks)
    print(f"{eid}: {ticks} tiques em {time.time() - t0:.0f}s; {len(hits)} funções executadas, {sum(hits.values())} entradas")
    return hits


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("eps", nargs="*", default=DEFAULT_EPS)
    ap.add_argument("--ticks", type=int, default=960)
    ap.add_argument("--out", default=os.path.join(ROOT, "tools", "re", "exec_profile.tsv"))
    a = ap.parse_args()
    idx = load_index()
    per = {eid: profile(eid, a.ticks, idx) for eid in a.eps}
    total: collections.Counter = collections.Counter()
    for h in per.values():
        total.update(h)
    with open(a.out, "w", encoding="utf8", newline="") as f:
        w = csv.writer(f, delimiter="\t", lineterminator="\n")
        w.writerow(["addr", "name", "total"] + [f"calls_{e}" for e in a.eps])
        for addr, n in sorted(total.items(), key=lambda kv: (-kv[1], kv[0])):
            w.writerow([f"0x{addr:x}", idx[addr], n] + [per[e].get(addr, 0) for e in a.eps])
    print(f"{a.out}: {len(total)} funções executadas em {len(a.eps)} episódio(s)")


if __name__ == "__main__":
    main()
