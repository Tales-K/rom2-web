"""Varredura de Path_WaveSearch 0x54d76e no Unicorn (A2Emu) por forma de mapa, para os ramos que os pares do oráculo não
alcançam: unidade de tipo ≠ 1 (ondas sem custo de passo, backtrace +2/+3), unidade grande (ondas 0x55c6f0/0x55c910/0x55cb30/
0x55cdf0 e 0x55c440/0x55cd50), alvo inalcançável (anel 0x5585f4, aproximação 0x557f08, 0x559bc9 com estrutura no alvo,
ramo de alcance 0x556f56/0x56ac5b), caminho de volta com mais de 1000 passos, máscara de passagem 0, bordas do mapa.

Cada caso monta o objeto de mapa (grades de passo/máscara estática/dinâmica numa janela; fora dela passo 1 e máscaras 0xff),
põe outras unidades e a própria no mapa de ocupação com 0x55be86 (modo 1), estruturas com registro de ocupação (0x55f430 +
0x550a53), listas de caminho com conteúdo prévio (0x55f170), e chama 0x54d76e. `operator new` 0x5a1e92 / `delete` 0x5a1ece
em HLE (heap de avanço), Server_SendMsg92 0x5052d2 vira nada (cliente). Grava refs/oracle/fuzz/0x54d76e.jsonl: uma linha por
caso com a entrada (o suficiente para a porta remontar o mesmo estado) e a saída: CRC32 do objeto de mapa inteiro (0xa4570
bytes, sem o cabeçalho do CMap em +0x54084..+0x540a0), as associações do CMap em ordem de balde/cadeia, as duas listas,
andar+0x80 e IA+0x16. E refs/oracle/fuzz/0x556f56.jsonl ([a, b, lado, AL] por caso). Lidos por game/src/sim/test/exe_wave.ts.

    .venv/Scripts/python.exe tools/re/oracle/fuzz_wave.py [--n 600] [--seed 1]
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import random
import struct
import sys
import zlib

from unicorn import UC_HOOK_CODE, UcError
from unicorn import x86_const as X

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools", "re"))
import unicorn_call as UC  # noqa: E402
from unicorn_call import A2Emu  # noqa: E402

WAVE = 0x54D76E
FOOT = 0x55BE86
SETAT = 0x55F430
APPLY = 0x550A53
ADDHEAD = 0x55F170
VT_UNIT = 0x5D0EB0
MAP_SIZE = 0xA4570
OCC_HDR = 0x54084
RING = 0x54156
RING_STEP = [(1, 0), (0, 1), (-1, 0), (0, -1)] * 3
DHEAP, DHEAP_SIZE = 0x20000000, 0x04000000
COVER = {0x55C6F0: "big_static_A", 0x55C910: "big_static_B", 0x55CB30: "big_dyn_A", 0x55CDF0: "big_dyn_B",
         0x5585F4: "ring", 0x557F08: "approach", 0x556F56: "range", 0x5052D2: "send92", 0x54E58C: "bt_static",
         0x54E886: "bt_dynamic", 0x54EB5C: "bt_dyn_over1000", 0x54E862: "bt_static_over1000", 0x55C440: "target_free"}


def i32(v: int) -> int:
    return v - (1 << 32) if v & 0x80000000 else v


class Fuzz:
    def __init__(self, seed: int):
        self.rnd = random.Random(seed)
        e = self.emu = A2Emu()
        e.uc.mem_map(DHEAP, DHEAP_SIZE)
        self.hp = DHEAP
        e.hook(0x5A1E92, self._new)                   # operator new (cdecl)
        e.hook(0x5A1ECE, lambda _e: 0)                # operator delete (cdecl)
        e.hook(0x5052D2, lambda _e: 0, ret_bytes=0xC)  # Server_SendMsg92 (thiscall, 3 args): cliente
        self.map = e.alloc(MAP_SIZE)
        self.units = [e.alloc(0x200) for _ in range(8)]
        self.mobj = [e.alloc(0x10) for _ in range(8)]
        self.walk = [e.alloc(0xA0) for _ in range(8)]
        self.ai = [e.alloc(0xA0) for _ in range(8)]
        self.owner = [e.alloc(0x40) for _ in range(8)]
        self.types = [e.alloc(0x40) for _ in range(8)]
        self.stats = [e.alloc(0x50) for _ in range(8)]
        self.book = e.alloc(0x20)
        self.structs = [e.alloc(0x70) for _ in range(4)]
        self.smobj = [e.alloc(0x10) for _ in range(4)]
        self.glob = e.alloc(0x10)
        self.cov: dict[str, int] = {}
        for a, name in COVER.items():
            e.uc.hook_add(UC_HOOK_CODE, lambda uc, addr, size, _, n=name: self.cov.__setitem__(n, self.cov.get(n, 0) + 1),
                          begin=a, end=a)

    def _new(self, e):
        n = struct.unpack("<I", e.read(e.uc.reg_read(X.UC_X86_REG_ESP) + 4, 4))[0]
        a = self.hp
        self.hp += (n + 15) & ~15
        if self.hp > DHEAP + DHEAP_SIZE:
            raise MemoryError("heap da varredura esgotado")
        e.write(a, bytes(n))
        return a

    def call(self, addr, args, this):
        """A2Emu.call sem o gancho de contagem por instrução (lento nas ondas)."""
        e, uc = self.emu, self.emu.uc
        for r in ("EAX", "EBX", "EDX", "ESI", "EDI", "EBP"):
            uc.reg_write(getattr(X, "UC_X86_REG_" + r), 0)
        uc.reg_write(X.UC_X86_REG_ECX, this)
        sp = UC.STACK_BASE + UC.STACK_SIZE - 0x1000
        for a in reversed(args):
            sp -= 4
            e.set_u32(sp, a & 0xFFFFFFFF)
        sp -= 4
        e.set_u32(sp, UC.RET_SENTINEL)
        uc.reg_write(X.UC_X86_REG_ESP, sp)
        uc.reg_write(X.UC_X86_REG_FPCW, 0x27F)
        try:
            uc.emu_start(addr, UC.RET_SENTINEL, count=400_000_000)
        except UcError as ex:
            raise RuntimeError("0x%x: %s EIP=0x%x %s" % (addr, ex, uc.reg_read(X.UC_X86_REG_EIP), getattr(e, "last_fault", "")))
        return uc.reg_read(X.UC_X86_REG_EAX)

    # ------------------------------------------------------------------------------------------------ montagem
    def unit(self, i, x, y, size, kind, mask, f2c=1, f20=0, task=0, rng=0, ai16=0):
        e, u = self.emu, self.units[i]
        e.write(u, bytes(0x200))
        e.set_u32(u, VT_UNIT)
        e.set_u32(u + 0x10, self.mobj[i])
        e.write(self.mobj[i], bytes([x, y]) + struct.pack("<H", y * 256 + x) + bytes([0x80, 0x80, 0, 0]))
        e.set_u32(u + 0x14, self.owner[i])
        e.write(self.owner[i], bytes(0x40))
        e.set_u32(self.owner[i] + 0x2C, f2c)
        e.write(u + 0x49, bytes([size, kind]))
        e.set_u32(u + 0x70, self.types[i])            # tipo: +0x3c → registro-base (+0x20 lido no ramo de alcance)
        e.write(self.types[i], bytes(0x40))
        e.set_u32(self.types[i] + 0x3C, self.stats[i])
        e.write(self.stats[i], bytes(0x50))
        e.write(self.stats[i] + 0x20, bytes([f20]))
        e.write(u + 0x12C, bytes([rng]))
        e.set_u32(u + 0x140, self.book)
        e.write(self.walk[i], bytes(0xA0))
        e.write(self.walk[i] + 5, bytes([mask]))
        e.set_u32(u + 0x1C0, self.walk[i])
        e.write(self.ai[i], bytes(0xA0))
        e.write(self.ai[i] + 8, bytes([task]))
        e.write(self.ai[i] + 0x16, struct.pack("<h", ai16))
        e.set_u32(u + 0x1C4, self.ai[i])
        for off in (0x1C8, 0x1E4):
            e.set_u32(u + off + 0x18, 10)                # m_nBlockSize
        return u

    def case(self, k: int) -> dict:
        r, e = self.rnd, self.emu
        self.hp = DHEAP
        self.cov = {}
        shape = r.choice(("open", "open", "obstacles", "obstacles", "walls", "enclosed", "serpent", "edge"))
        W = H = r.choice((20, 30, 40, 64, 80)) if shape != "serpent" else r.choice((40, 64))
        win = W + 17                                     # janela [0, W+17)²: borda de 8 bloqueada em volta da área jogável
        cost = bytearray(b"\x01" * win * win)
        smask = bytearray(b"\xff" * win * win)
        dmask = bytearray(b"\xff" * win * win)
        blk = r.choice((1, 4, 5))
        base_cost = r.choice((2, 4, 6, 8))
        for y in range(8, W + 9):
            for x in range(8, W + 9):
                i = y * win + x
                cost[i] = base_cost if r.random() < 0.7 else r.randint(1, 20)
                smask[i] = dmask[i] = r.choice((0, 0, 0, 0x10)) if r.random() < 0.1 else 0
                if shape == "obstacles" and r.random() < 0.25:
                    smask[i] |= blk
                    dmask[i] |= blk
                elif shape == "obstacles" and r.random() < 0.05:
                    dmask[i] |= blk                     # só na dinâmica
        if shape == "walls":
            for _ in range(r.randint(1, 4)):
                if r.random() < 0.5:
                    x = r.randint(10, W + 6)
                    gap = r.randint(8, W + 8)
                    for y in range(8, W + 9):
                        if abs(y - gap) > 1:
                            smask[y * win + x] |= blk
                            dmask[y * win + x] |= blk
                else:
                    y = r.randint(10, W + 6)
                    gap = r.randint(8, W + 8)
                    for x in range(8, W + 9):
                        if abs(x - gap) > 1:
                            smask[y * win + x] |= blk
                            dmask[y * win + x] |= blk
        if shape == "serpent":
            for row, y in enumerate(range(10, W + 8, 2)):
                gap = W + 7 if row % 2 == 0 else 9
                for x in range(8, W + 9):
                    if x != gap:
                        smask[y * win + x] |= blk
                        dmask[y * win + x] |= blk
        size = r.choice((1, 1, 1, 2, 3, 4)) if shape != "serpent" else 1
        kind = r.choice((1, 1, 2, 3))
        pmask = r.choice((0x41, 0x41, 0x05, 0x01, 0x45, blk | 0x40, 0x00))
        if pmask & blk == 0 and pmask != 0:
            pmask |= blk
        lo, hi = 8, W + 8 - size + 1

        def pos():
            if shape == "edge":
                return r.choice((lo, hi, r.randint(lo, hi))), r.choice((lo, hi, r.randint(lo, hi)))
            return r.randint(lo, hi), r.randint(lo, hi)
        if shape == "serpent":
            fx, fy, tx, ty = 8, 8, (8 if ((W - 2) // 2) % 2 else W + 8), W + 8
        else:
            (fx, fy), (tx, ty) = pos(), pos()
            if r.random() < 0.1:
                tx, ty = fx, fy
            if r.random() < 0.2:
                tx, ty = (fx + r.randint(-3, 3)), (fy + r.randint(-3, 3))
                tx, ty = min(max(tx, lo), hi), min(max(ty, lo), hi)
        if shape == "enclosed":
            for d in range(-2, size + 2):
                for (xx, yy) in ((tx + d, ty - 2), (tx + d, ty + size + 1), (tx - 2, ty + d), (tx + size + 1, ty + d)):
                    if 0 <= xx < win and 0 <= yy < win:
                        smask[yy * win + xx] |= blk
                        dmask[yy * win + xx] |= blk
        for i in range(size):                            # a origem é livre para a própria pegada
            for j in range(size):
                c = (fy + j) * win + fx + i
                smask[c] &= ~blk & 0xFF
                dmask[c] &= ~blk & 0xFF
        is_static = r.choice((0, 1))
        f2c = r.choice((0, 1))
        f20, task = (0x12, 5) if r.random() < 0.3 else (0, 0)
        g = r.randrange(-100, 100)
        inp = {"shape": shape, "W": W, "win": win, "cost": base64.b64encode(bytes(cost)).decode(),
               "smask": base64.b64encode(bytes(smask)).decode(), "dmask": base64.b64encode(bytes(dmask)).decode(),
               "wavesS": r.choice((5, 0, 2, 20)), "wavesD": r.choice((3, 0, 1, 10)), "defCost": r.choice((1, 6)), "g": g,
               "cost0": 0xFFFF if r.random() < 0.7 else 0}
        # mapa
        m = self.map
        mem = bytearray(MAP_SIZE)
        for y in range(win):
            mem[y * 256: y * 256 + win] = cost[y * win:(y + 1) * win]
            mem[0x10000 + y * 256: 0x10000 + y * 256 + win] = smask[y * win:(y + 1) * win]
            mem[0x20000 + y * 256: 0x20000 + y * 256 + win] = dmask[y * win:(y + 1) * win]
        for y in range(win, 256):
            mem[y * 256:(y + 1) * 256] = b"\x01" * 256
            mem[0x10000 + y * 256: 0x10000 + (y + 1) * 256] = b"\xff" * 256
            mem[0x20000 + y * 256: 0x20000 + (y + 1) * 256] = b"\xff" * 256
        for y in range(win):
            mem[y * 256 + win:(y + 1) * 256] = b"\x01" * (256 - win)
            mem[0x10000 + y * 256 + win: 0x10000 + (y + 1) * 256] = b"\xff" * (256 - win)
            mem[0x20000 + y * 256 + win: 0x20000 + (y + 1) * 256] = b"\xff" * (256 - win)
        if inp["cost0"]:
            mem[0x30000:0x50000] = bytes([0xFF]) * 0x20000      # custo da onda: 0xffff (grade apagada) ou 0 (mapa recém-criado)
        struct.pack_into("<ii", mem, 0x50000, W, W)
        struct.pack_into("<I", mem, OCC_HDR + 8, 100)
        struct.pack_into("<I", mem, OCC_HDR + 0x18, 10)
        mem[0x5414B] = inp["defCost"]
        for d, (dx, dy) in enumerate(RING_STEP):
            struct.pack_into("<bb", mem, RING + 2 * d, dx, dy)
        struct.pack_into("<ii", mem, 0x58584, inp["wavesS"], inp["wavesD"])
        e.write(m, bytes(mem))
        e.set_u32(0x6044C4, self.glob)
        e.write(self.glob, struct.pack("<h", g))
        e.write(self.book, bytes(0x20))
        # estruturas com registro de ocupação
        sts = []
        for s in range(r.choice((0, 0, 1, 2))):
            sx, sy, sw = r.randint(lo, hi), r.randint(lo, hi), r.randint(1, 3)
            if r.random() < 0.5 and s == 0:
                sx, sy = tx, ty
            smk = r.randrange(1 << 9)
            sa = self.structs[s]
            e.write(sa, bytes(0x70))
            e.set_u32(sa + 0x10, self.smobj[s])
            e.write(self.smobj[s], bytes([sx, sy]) + struct.pack("<H", sy * 256 + sx) + bytes([0x80, 0x80, 0, 0]))
            e.write(sa + 0x60, bytes([sw]))
            e.set_u32(sa + 0x64, smk)
            cells = []
            for i in range(sw):
                for j in range(sw):
                    c = ((sy + j) << 8) + sx + i
                    rec = bytearray(0x3C)
                    rec[0] = e.read(m + c, 1)[0]
                    rec[1] = e.read(m + 0x10000 + c, 1)[0]
                    struct.pack_into("<I", rec, 0xC, sa)
                    struct.pack_into("<H", rec, 0x3A, c)
                    e.write(m + 0x5402C, bytes(rec))
                    self.call(SETAT, [c, m + 0x5402C], m + OCC_HDR)
                    e.write(m + 0x10000 + c, bytes([e.read(m + 0x10000 + c, 1)[0] | 0x20]))
                    self.call(APPLY, [c], m)
                    cells.append(c)
            sts.append({"addr": sa, "x": sx, "y": sy, "w": sw, "mask": smk, "cells": cells})
        inp["structs"] = sts
        # outras unidades e a própria no mapa de ocupação
        others = []
        for i in range(1, 1 + r.choice((0, 1, 3, 5))):
            ox, oy = pos()
            osz, okind = r.choice((1, 1, 2)), r.choice((1, 2, 3))
            u = self.unit(i, ox, oy, osz, okind, 0x41)
            self.call(FOOT, [u, oy * 256 + ox, 1], m)
            others.append({"addr": u, "x": ox, "y": oy, "size": osz, "kind": okind})
        inp["others"] = others
        me = self.unit(0, fx, fy, size, kind, pmask, f2c=f2c, f20=f20, task=task, rng=r.randint(0, 8), ai16=r.randrange(-50, 50))
        place = r.random() < 0.85
        if place:
            self.call(FOOT, [me, fy * 256 + fx, 1], m)
        pre = {"s": [r.randrange(1 << 16) for _ in range(r.choice((0, 0, 2)))],
               "d": [r.randrange(1 << 16) for _ in range(r.choice((0, 0, 0, 3)))]}
        for off, key in ((0x1C8, "s"), (0x1E4, "d")):
            for v in pre[key]:
                self.call(ADDHEAD, [v], me + off)
        tgt = None
        if not is_static and r.random() < 0.3:
            ax, ay = pos()
            t = self.unit(7, ax, ay, r.randint(1, 2), 1, 0x41)
            tgt = {"addr": t, "x": ax, "y": ay, "size": e.read(t + 0x49, 1)[0]}
        inp.update({"me": {"addr": me, "x": fx, "y": fy, "size": size, "kind": kind, "mask": pmask, "f2c": f2c, "f20": f20,
                           "task": task, "rng": e.read(me + 0x12C, 1)[0], "ai16": struct.unpack("<h", e.read(self.ai[0] + 0x16, 2))[0],
                           "placed": place}, "pre": pre, "target": tgt,
                    "call": [fx, fy, tx, ty, is_static]})
        self.cov = {}
        self.call(WAVE, [me, fx, fy, tx, ty, is_static, tgt["addr"] if tgt else 0], m)
        out = self.dump(me)
        out["cov"] = sorted(self.cov)
        return {"in": inp, "out": out}

    def dump(self, me):
        e, m = self.emu, self.map
        mem = e.read(m, MAP_SIZE)
        crc = zlib.crc32(mem[:OCC_HDR])
        crc = zlib.crc32(mem[OCC_HDR + 0x1C:], crc)
        occ = []
        tbl, size, count = struct.unpack_from("<III", mem, OCC_HDR + 4)
        if tbl:
            for h in range(size):
                p = e.u32(tbl + 4 * h)
                while p:
                    occ.append([h, struct.unpack("<h", e.read(p + 8, 2))[0], e.read(p + 0xC, 0x3C).hex()])
                    p = e.u32(p)

        def lst(hdr):
            vals, p = [], e.u32(hdr + 4)
            while p:
                vals.append(e.u16(p + 8))
                p = e.u32(p)
            return {"n": i32(e.u32(hdr + 0xC)), "v": vals, "tail0": e.u32(hdr + 8) == 0}
        return {"crc": crc, "occ": occ, "occN": i32(count), "occNull": tbl == 0, "s": lst(me + 0x1C8), "d": lst(me + 0x1E4),
                "foot": e.u16(self.walk[0] + 0x80), "ai16": struct.unpack("<h", e.read(self.ai[0] + 0x16, 2))[0]}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=600)
    ap.add_argument("--seed", type=int, default=1)
    a = ap.parse_args()
    fz = Fuzz(a.seed)
    out_dir = os.path.join(ROOT, "refs", "oracle", "fuzz")
    os.makedirs(out_dir, exist_ok=True)
    tot: dict[str, int] = {}
    with open(os.path.join(out_dir, "0x%x.jsonl" % WAVE), "w", encoding="utf-8") as out:
        for k in range(a.n):
            c = fz.case(k)
            for n in c["out"]["cov"]:
                tot[n] = tot.get(n, 0) + 1
            out.write(json.dumps(c, separators=(",", ":")) + "\n")
            if k % 100 == 0:
                print(k, c["in"]["shape"], "lista s/d", len(c["out"]["s"]["v"]), len(c["out"]["d"]["v"]), flush=True)
    print("cobertura (casos):", json.dumps(dict(sorted(tot.items()))), flush=True)
    rnd = random.Random(a.seed + 1)
    with open(os.path.join(out_dir, "0x556f56.jsonl"), "w", encoding="utf-8") as out:
        for _ in range(20000):
            pa = rnd.randrange(1 << 32)
            pb = rnd.randrange(1 << 32)
            if rnd.random() < 0.5:
                pb = (pb & ~0xFFFF) | ((pa + rnd.randint(-6, 6) * 257) & 0xFFFF)
            n = rnd.choice((rnd.randrange(256), rnd.randint(0, 6)))
            al = fz.call(0x556F56, [pa, pb, n], 0) & 0xFF
            out.write(json.dumps([pa, pb, n, al]) + "\n")


if __name__ == "__main__":
    main()
