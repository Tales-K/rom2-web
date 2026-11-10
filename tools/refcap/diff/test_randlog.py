"""Confere no Unicorn a caverna do gravador de sorteios (original_episode.rand_cave / rand_site), sem rodar o jogo.

Carrega o allods2.exe somente leitura (re_inputs), troca o __getptd (0x58a930) por `mov eax, PTD; ret`, aplica o gancho em 0x5832af
e chama Rand_Inclusive / Rand_One / Rand_Range / Rand_UniformObject a partir de um "chamador" fictício. Confere: valor devolvido
igual ao do exe sem gancho, registradores/flags preservados, registro gravado (estado, relógio, pilha) e o site/argumento deduzidos.
    .venv\\Scripts\\python.exe -X utf8 tools/refcap/diff/test_randlog.py
"""
from __future__ import annotations

import os
import struct
import sys

import pefile
from unicorn import UC_ARCH_X86, UC_MODE_32, Uc
from unicorn.x86_const import (UC_X86_REG_EAX, UC_X86_REG_EBP, UC_X86_REG_EBX, UC_X86_REG_ECX, UC_X86_REG_EDI, UC_X86_REG_EDX,
                               UC_X86_REG_EFLAGS, UC_X86_REG_ESI, UC_X86_REG_ESP)

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import original_episode as oe  # noqa: E402

EXE = r"C:\Users\TALES K\Games\re_inputs\allods2.exe"
PTD, GAMEOBJ, CAVE, STACK, CALLER = 0x10000000, 0x10001000, 0x20000000, 0x30000000, 0x40000000
STOP = CALLER + 0x100


def machine(hook: bool):
    pe = pefile.PE(EXE, fast_load=True)
    ib = pe.OPTIONAL_HEADER.ImageBase
    uc = Uc(UC_ARCH_X86, UC_MODE_32)
    uc.mem_map(ib, 0x300000)
    for s in pe.sections:
        uc.mem_write(ib + s.VirtualAddress, s.get_data()[: max(s.Misc_VirtualSize, s.SizeOfRawData)])
    uc.mem_write(0x58A930, b"\xb8" + struct.pack("<I", PTD) + b"\xc3")       # __getptd → PTD
    for a in (PTD, CAVE, STACK, CALLER):
        uc.mem_map(a, 0x100000 if a != CAVE else 0x1000 + 64 * 0x1000)
    uc.mem_write(PTD + 0x14, struct.pack("<I", 12345))
    uc.mem_write(oe.GAME_PTR, struct.pack("<I", GAMEOBJ))
    uc.mem_write(GAMEOBJ + 4, struct.pack("<I", 777))
    if hook:
        code, cs, rec = oe.rand_cave(CAVE)
        uc.mem_write(CAVE, struct.pack("<II", 0, 64))
        uc.mem_write(cs, code)
        assert bytes(uc.mem_read(oe.RAND_HOOK, 5)) == oe.RAND_HOOK_BYTES
        uc.mem_write(oe.RAND_HOOK, b"\xe9" + struct.pack("<i", cs - (oe.RAND_HOOK + 5)))
    return uc


def call(uc, fn: int, args: list[int], ecx: int = 0) -> dict:
    """O chamador fictício: push args; call fn  (ret = CALLER+5+...). Devolve registradores depois."""
    code = b"".join(b"\x68" + struct.pack("<I", a) for a in reversed(args))
    site = CALLER + len(code) + 5
    code += b"\xe8" + struct.pack("<i", fn - site)
    uc.mem_write(CALLER, code + b"\x90" * 8)
    uc.reg_write(UC_X86_REG_ESP, STACK + 0x80000)
    uc.reg_write(UC_X86_REG_EBP, STACK + 0x80100)
    regs = {UC_X86_REG_EBX: 0x11111111, UC_X86_REG_ESI: 0x22222222, UC_X86_REG_EDI: 0x33333333, UC_X86_REG_ECX: ecx}
    for r, v in regs.items():
        uc.reg_write(r, v)
    uc.emu_start(CALLER, site)
    out = {k: uc.reg_read(r) for k, r in (("eax", UC_X86_REG_EAX), ("ebx", UC_X86_REG_EBX), ("esi", UC_X86_REG_ESI),
                                           ("edi", UC_X86_REG_EDI), ("ecx", UC_X86_REG_ECX), ("edx", UC_X86_REG_EDX),
                                           ("esp", UC_X86_REG_ESP), ("ebp", UC_X86_REG_EBP), ("fl", UC_X86_REG_EFLAGS))}
    out["site"] = site
    return out


def main():
    obj = PTD + 0x800                       # objeto do Rand_UniformObject: divisor 0x8000
    plain, hooked = machine(False), machine(True)
    for m in (plain, hooked):
        m.mem_write(obj, struct.pack("<I", 0x8000))
    cases = [(0x51FA25, [9], 0, "inc", 9, -1), (0x51FA4E, [6], 0, "one", 6, -1), (0x57AFF0, [33, 222], obj, "range", 33, 222),
             (0x57AFC0, [], obj, "uobj", -1, -1), (0x57AFD0, [190], obj, "scaled", 190, -1), (0x51FA0C, [], 0, "float", -1, -1),
             (0x583290, [], 0, "raw", -1, -1)]
    ok = 0
    for k, (fn, args, ecx, kind, a, b) in enumerate(cases):
        r0, r1 = call(plain, fn, args, ecx), call(hooked, fn, args, ecx)
        same = {x: (r0[x], r1[x]) for x in ("eax", "ebx", "esi", "edi", "esp", "ebp") if r0[x] != r1[x]}
        st0 = struct.unpack("<I", plain.mem_read(PTD + 0x14, 4))[0]
        cnt = struct.unpack("<I", hooked.mem_read(CAVE, 4))[0]
        rec = struct.unpack("<II%dI" % oe.RAND_STACK, hooked.mem_read(CAVE + 0x1000 + k * oe.RAND_REC, oe.RAND_REC))
        site, kd, ra, rb = oe.rand_site(rec[2:])
        good = (not same and cnt == k + 1 and rec[0] == st0 and rec[1] == 777 and site == r1["site"] and kd == kind
                and ra == (a & 0xFFFFFFFF if a >= 0 else -1) and rb == (b & 0xFFFFFFFF if b >= 0 else -1))
        ok += good
        print(f"{'ok ' if good else 'ERR'} {fn:#x} {kind:6s} eax={r1['eax']:#x} site={site:#x}/{r1['site']:#x} a={ra} b={rb} "
              f"state={rec[0]:#x}/{st0:#x} t16={rec[1]} diff={same}")
    print(f"{ok}/{len(cases)} casos")
    sys.exit(0 if ok == len(cases) else 1)


if __name__ == "__main__":
    main()
