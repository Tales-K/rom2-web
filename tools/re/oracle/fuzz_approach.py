"""Varredura de Unit_ApproachCell 0x557f08 no Unicorn (A2Emu), para os ramos que os pares do oráculo não alcançam (nenhuma
célula alcançada, vários anéis, dx==0 / dy==0 na inclinação em float, laço do anel > 100, bordas 0/255 do mapa).

Monta um objeto de busca (grade de custo em +0x30000, passos do anel em +0x54156), duas unidades com a vtable 0x5d0eb0
(+0x10 → objeto de mapa, +0x49 lado) e chama a função com FPCW 0x27f (a do jogo). Grava refs/oracle/fuzz/0x557f08.jsonl:
uma linha por caso {a: [x,y,fx,fy,lado] do atacante, t: idem do alvo, cells: [[índice y*256+x, custo], ...] (o resto é 0xffff),
eax, nreads, hreads (hash da sequência de células lidas: h = (h*31 + índice) | 0)}; e refs/oracle/fuzz/0x5585f4.jsonl para
Path_UnlabeledTargetRing ({size, center, rings, cells, eax, nreads, hreads}). Lidos por game/src/sim/test/exe_path.ts.

    .venv/Scripts/python.exe tools/re/oracle/fuzz_approach.py [--n 3000] [--seed 1]
"""
from __future__ import annotations

import argparse
import json
import os
import random
import struct
import sys

from unicorn import UC_HOOK_MEM_READ
from unicorn import x86_const as X

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools", "re"))
from unicorn_call import A2Emu  # noqa: E402

FN = 0x557F08
RING_FN = 0x5585F4
VT_UNIT = 0x5D0EB0
COST, RING = 0x30000, 0x54156
# passos (dx,dy) do anel por direção 0..11, lidos do objeto real nos pares (direções 1..10; período 4)
RING_STEP = [(1, 0), (0, 1), (-1, 0), (0, -1)] * 3


def i32(v: int) -> int:
    return v - (1 << 32) if v & 0x80000000 else v


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=3000)
    ap.add_argument("--seed", type=int, default=1)
    a = ap.parse_args()
    rnd = random.Random(a.seed)
    emu = A2Emu()
    path = emu.alloc(0x55000)
    units = [emu.alloc(0x1D0) for _ in range(2)]
    mobjs = [emu.alloc(8) for _ in range(2)]
    ring = b"".join(struct.pack("<bb", dx, dy) for dx, dy in RING_STEP)
    reads: list[int] = []

    def on_read(uc, access, addr, size, value, _):
        reads.append((addr - path - COST) >> 1)

    emu.uc.hook_add(UC_HOOK_MEM_READ, on_read, begin=path + COST, end=path + COST + 0x20000 - 1)
    out_dir = os.path.join(ROOT, "refs", "oracle", "fuzz")
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "0x%x.jsonl" % FN), "w", encoding="utf-8") as out:
        for k in range(a.n):
            big = rnd.random() < 0.05
            def frac() -> int:
                return rnd.choice((0, 0x80, rnd.randrange(256)))
            tx, ty = rnd.choice((rnd.randrange(256), rnd.randrange(4), 255 - rnd.randrange(4))), rnd.randrange(256)
            tsz, asz = (rnd.randint(1, 40), rnd.randint(1, 40)) if big else (rnd.randint(1, 3), rnd.randint(1, 3))
            t = [tx, ty, frac(), frac(), tsz]
            mode = rnd.random()
            if mode < 0.1:
                ax, ay = tx, ty                                         # mesmo ponto: dx = dy = 0
            elif mode < 0.25:
                ax, ay = tx, (ty + rnd.randint(-20, 20)) & 0xFF        # mesma coluna
            elif mode < 0.4:
                ax, ay = (tx + rnd.randint(-20, 20)) & 0xFF, ty        # mesma linha
            else:
                ax, ay = (tx + rnd.randint(-20, 20)) & 0xFF, (ty + rnd.randint(-20, 20)) & 0xFF
            at = [ax, ay, frac(), frac(), asz]
            if mode < 0.4 and rnd.random() < 0.5:
                at[2], at[3] = t[2], t[3]
            p_unreached = rnd.choice((0.0, 0.5, 0.9, 0.98, 1.0))
            grid = bytearray(b"\xff" * 0x20000)
            cells = []
            r = 12 + (40 if big else 0)
            for yy in range(ty - r, ty + r + 1):
                for xx in range(tx - r, tx + r + 1):
                    if rnd.random() >= p_unreached:
                        idx = (yy & 0xFF) * 256 + (xx & 0xFF)
                        v = rnd.randrange(0xFFFF)
                        struct.pack_into("<H", grid, idx * 2, v)
                        cells.append((idx, v))
            emu.write(path + COST, bytes(grid))
            emu.write(path + RING, ring)
            for u, mo, rec in ((units[0], mobjs[0], at), (units[1], mobjs[1], t)):
                emu.set_u32(u, VT_UNIT)
                emu.set_u32(u + 0x10, mo)
                emu.write(u + 0x49, bytes([rec[4]]))
                emu.write(mo, bytes([rec[0], rec[1], 0, 0, rec[2], rec[3], 0, 0]))
            emu.uc.reg_write(X.UC_X86_REG_FPCW, 0x27F)
            reads.clear()
            res = emu.call(FN, args=[units[0], units[1]], this=path, convention="thiscall")
            h = 0
            for i in reads:
                h = i32((h * 31 + i) & 0xFFFFFFFF)
            out.write(json.dumps({"a": at, "t": t, "cells": sorted(dict(cells).items()), "eax": i32(res.eax),
                                  "nreads": len(reads), "hreads": h}, separators=(",", ":")) + "\n")
            if k % 500 == 0:
                print(k, "eax=0x%x" % res.eax, "lidas", len(reads), flush=True)
    # Path_UnlabeledTargetRing 0x5585f4 (+ 0x55f9a0): centro com lixo nos bits altos, anéis 0..10, bordas do índice.
    with open(os.path.join(out_dir, "0x%x.jsonl" % RING_FN), "w", encoding="utf-8") as out:
        for k in range(a.n // 3):
            sz = rnd.randint(1, 3)
            cx, cy = rnd.choice((rnd.randrange(256), rnd.randrange(3), 255 - rnd.randrange(3))), rnd.randrange(256)
            center = (rnd.randrange(1 << 16) << 16) | (cy << 8) | cx
            rings = rnd.choice((0, 1, 2, rnd.randint(3, 10))) | (rnd.randrange(1 << 16) << 16)
            p_unreached = rnd.choice((0.5, 0.9, 0.98, 1.0))
            grid = bytearray(b"\xff" * 0x20000)
            cells = []
            for yy in range(cy - 11, cy + 12):
                for xx in range(cx - 11, cx + 12):
                    if rnd.random() >= p_unreached:
                        idx = ((yy * 256 + xx) & 0xFFFF)
                        v = rnd.randrange(0xFFFF)
                        struct.pack_into("<H", grid, idx * 2, v)
                        cells.append((idx, v))
            emu.write(path + COST, bytes(grid))
            emu.set_u32(units[0], VT_UNIT)
            emu.write(units[0] + 0x49, bytes([sz]))
            reads.clear()
            res = emu.call(RING_FN, args=[units[0], rnd.randrange(1 << 32), center, rings], this=path, convention="thiscall")
            h = 0
            for i in reads:
                h = i32((h * 31 + i) & 0xFFFFFFFF)
            out.write(json.dumps({"size": sz, "center": i32(center), "rings": i32(rings), "cells": sorted(dict(cells).items()),
                                  "eax": i32(res.eax), "nreads": len(reads), "hreads": h}, separators=(",", ":")) + "\n")


if __name__ == "__main__":
    main()
