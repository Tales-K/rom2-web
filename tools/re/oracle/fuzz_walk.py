"""Varredura das funções do andar (lote 5c) no Unicorn (A2Emu), para a faixa inteira de entrada e os ramos que os pares do
oráculo não alcançam: Unit_WalkFormula 0x559195 (x87: dx/dy diagonais = ftol(v*d*0.707)), Unit_WalkWait 0x5551ef,
Unit_TurnStep 0x556454, 0x5568e4, Dir_FromDelta16 0x556b2c e 0x556da2 (exec 0 no corpus), 0x54f618, AI_UnitDistance 0x556dcd.

Monta o objeto de mapa (0xa4570 bytes; grade de custo em +0, máscara em +0x10000 sem o bit 0x20, altitude em +0x944f4,
tabelas de direção em +0x58e88/+0x58e90/+0x58e98, multiplicador em +0x58d84) e unidades com a vtable 0x5d0eb0 (+0x10 objeto
de mapa, +0x49 lado, +0x4a tipo, +0x70 → +0x3c → +0x44 velocidade-byte, +0x8c velocidade, +0x1c0 andar). FPCW 0x27f (a do
jogo). Grava refs/oracle/fuzz/walk.jsonl: uma linha por caso {fn, in: {...}, out: {...}}; lido por
game/src/sim/test/exe_walkaction.ts.

    .venv/Scripts/python.exe tools/re/oracle/fuzz_walk.py [--n 4000] [--seed 1]
"""
from __future__ import annotations

import argparse
import json
import os
import random
import struct
import sys

from unicorn import x86_const as X

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools", "re"))
from unicorn_call import A2Emu  # noqa: E402

VT_UNIT = 0x5D0EB0
MAP_SIZE = 0xA4570
ALT, DX, DY, STEP, MUL = 0x944F4, 0x58E88, 0x58E90, 0x58E98, 0x58D84
REAL_DX = [0, 1, 1, 1, 0, -1, -1, -1]
REAL_DY = [-1, -1, 0, 1, 1, 1, 0, -1]


def i32(v: int) -> int:
    return v - (1 << 32) if v & 0x80000000 else v


class Unit:
    def __init__(self, emu: A2Emu):
        self.emu = emu
        self.a = emu.alloc(0x200)
        self.mo = emu.alloc(0x10)
        self.w = emu.alloc(0xC0)
        self.ai = emu.alloc(0xC0)
        self.typ = emu.alloc(0x40)
        self.stats = emu.alloc(0x50)
        emu.set_u32(self.a, VT_UNIT)
        emu.set_u32(self.a + 0x10, self.mo)
        emu.set_u32(self.a + 0x70, self.typ)
        emu.set_u32(self.typ + 0x3C, self.stats)
        emu.set_u32(self.a + 0x1C0, self.w)
        emu.set_u32(self.a + 0x1C4, self.ai)

    def place(self, x, y, fx, fy, size, kind=0, speed=0, speed_byte=0):
        e = self.emu
        e.write(self.mo, bytes([x, y, 0, 0, fx, fy]))
        e.write(self.a + 0x49, bytes([size, kind]))
        e.write(self.a + 0x8C, struct.pack("<h", speed))
        e.write(self.stats + 0x44, bytes([speed_byte]))

    def walk(self, off, n):
        return list(self.emu.read(self.w + off, n))

    def rec(self):
        e = self.emu
        mo = e.read(self.mo, 6)
        return {"x": mo[0], "y": mo[1], "fx": mo[4], "fy": mo[5], "size": e.read(self.a + 0x49, 1)[0],
                "kind": e.read(self.a + 0x4A, 1)[0], "speed": struct.unpack("<h", e.read(self.a + 0x8C, 2))[0],
                "sb": e.read(self.stats + 0x44, 1)[0]}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=4000)
    ap.add_argument("--seed", type=int, default=1)
    a = ap.parse_args()
    rnd = random.Random(a.seed)
    emu = A2Emu()
    m = emu.alloc(MAP_SIZE)
    u, t = Unit(emu), Unit(emu)
    out_dir = os.path.join(ROOT, "refs", "oracle", "fuzz")
    os.makedirs(out_dir, exist_ok=True)
    lines = []

    def emit(fn, inp, out):
        lines.append(json.dumps({"fn": fn, "in": inp, "out": out}, separators=(",", ":")))

    def rpos():
        return rnd.randrange(8, 120), rnd.randrange(8, 120), rnd.choice((0x80, 0, 0xFF, rnd.randrange(256))), \
            rnd.choice((0x80, 0, 0xFF, rnd.randrange(256)))

    # Unit_WalkFormula: velocidade 0..255 (byte e short), multiplicador, altitudes, custos, tabelas reais e aleatórias
    for k in range(a.n):
        real = rnd.random() < 0.5
        dx = REAL_DX if real else [rnd.choice((0, 1, -1, rnd.randint(-128, 127))) for _ in range(8)]
        dy = REAL_DY if real else [rnd.choice((0, 1, -1, rnd.randint(-128, 127))) for _ in range(8)]
        step = [rnd.choice((1, -1, 256, -256, 257, -255, rnd.randint(-70000, 70000))) for _ in range(8)]
        mul = rnd.choice((1, 2, 3, 4, rnd.randint(-5, 40), rnd.randint(-(1 << 31), (1 << 31) - 1)))
        cell = rnd.randrange(0x10000)
        dirb = rnd.randrange(256)
        b7 = ((dirb + 0x10) & 0xFF) >> 5
        cell2 = (cell + step[b7]) & 0xFFFF
        alt = {cell: rnd.randint(-128, 127), cell2: rnd.randint(-128, 127)}
        cost = {cell: rnd.choice((0, 1, 2, 8, rnd.randrange(256))), cell2: rnd.choice((0, 1, 2, 8, rnd.randrange(256)))}
        kind = rnd.choice((1, 1, 1, 0, 2, 3))
        speed = rnd.choice((rnd.randint(0, 40), rnd.randint(-40, 300), rnd.randint(-32768, 32767)))
        sb = rnd.choice((0, 0, rnd.randrange(256)))
        u.place(10, 10, 0x80, 0x80, 1, kind, speed, sb)
        emu.write(m + DX, struct.pack("<8b", *dx))
        emu.write(m + DY, struct.pack("<8b", *dy))
        emu.write(m + STEP, struct.pack("<8i", *step))
        emu.write(m + MUL, struct.pack("<i", mul))
        for c, v in alt.items():
            emu.write(m + ALT + c, struct.pack("<b", v))
        for c, v in cost.items():
            emu.write(m + c, bytes([v]))
            emu.write(m + 0x10000 + c, b"\x00")
        emu.write(u.w + 0xA8, bytes(10))
        emu.uc.reg_write(X.UC_X86_REG_FPCW, 0x27F)
        try:
            res = emu.call(0x559195, args=[u.a, cell, dirb], this=m, convention="thiscall")
            out = {"eax": i32(res.eax), "w": u.walk(0xA8, 10)}
        except RuntimeError as ex:                 # #DE (divisão por zero) ou similar
            out = {"err": str(ex)[:80]}
        emit("0x559195", {"u": u.rec(), "dx": dx, "dy": dy, "step": step, "mul": mul, "cell": cell, "dir": dirb,
                          "alt": [[c, v] for c, v in alt.items()], "cost": [[c, v] for c, v in cost.items()]}, out)
        for c in alt:
            emu.write(m + ALT + c, b"\x00")
            emu.write(m + c, b"\x00")
        if k % 1000 == 0:
            print("0x559195", k, out, flush=True)

    # giro: WalkWait / TurnStep / 0x556da2 / Dir_FromDelta16 / 0x5568e4 / 0x54f618 / AI_UnitDistance
    for k in range(a.n):
        w0 = [rnd.randrange(256), rnd.randrange(256)]
        rate = rnd.choice((1, 2, 4, 8, 16, 32, 64, 0x80, 0xFF, rnd.randint(1, 255)))
        turning = rnd.choice((0, 0, 1, rnd.randrange(1 << 32)))
        f9d = rnd.randrange(256)
        x, y, fx, fy = rpos()
        size = rnd.choice((1, 1, 2, 3, rnd.randint(1, 255)))
        u.place(x, y, fx, fy, size)
        tx, ty, tfx, tfy = (x + rnd.randint(-6, 6)) & 0xFF, (y + rnd.randint(-6, 6)) & 0xFF, rnd.randrange(256), rnd.randrange(256)
        if rnd.random() < 0.2:
            tx, ty = x, y
        tsize = rnd.choice((1, 1, 2, 3, rnd.randint(1, 255)))
        t.place(tx, ty, tfx, tfy, tsize)

        def setw():
            emu.write(u.w, bytes(w0))
            emu.write(u.w + 0x0A, bytes([rate]))
            emu.set_u32(u.w + 0xA0, turning)
            emu.write(u.w + 0x9D, bytes([f9d]))
            emu.write(u.w + 0xA4, b"\x00")

        def getw():
            return {"w0": u.walk(0, 2), "a0": emu.u32(u.w + 0xA0), "a4": u.walk(0xA4, 1)[0], "9d": u.walk(0x9D, 1)[0]}

        inp = {"w0": w0, "rate": rate, "turning": turning, "f9d": f9d, "u": u.rec(), "t": t.rec()}
        setw()
        emu.call(0x5551EF, args=[u.a])
        emit("0x5551ef", inp, getw())
        d = rnd.randrange(256)
        setw()
        emu.call(0x556454, args=[u.a, d | (rnd.randrange(1 << 24) << 8)])
        emit("0x556454", dict(inp, d=d), getw())
        cell = (ty << 8) | tx
        garbage = rnd.randrange(1 << 16) << 16
        setw()
        emu.call(0x556DA2, args=[u.a, cell | garbage], regs={"eax": rnd.randrange(1 << 32)})
        emit("0x556da2", dict(inp, cell=cell), getw())
        r = emu.call(0x556B2C, args=[u.a, cell | garbage])
        emit("0x556b2c", dict(inp, cell=cell), {"al": r.eax & 0xFF})
        r = emu.call(0x5568E4, args=[u.a, t.a])
        emit("0x5568e4", inp, {"al": r.eax & 0xFF})
        setw()
        r = emu.call(0x54F618, args=[u.a, cell | garbage])
        emit("0x54f618", dict(inp, cell=cell), {"eax": i32(r.eax)})
        r = emu.call(0x556DCD, args=[u.a, t.a], this=m, convention="thiscall")
        emit("0x556dcd", inp, {"eax": i32(r.eax)})
    with open(os.path.join(out_dir, "walk.jsonl"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
    print("casos:", len(lines), flush=True)


if __name__ == "__main__":
    main()
