"""Cria a cópia de execução do TESTE DIFERENCIAL `C:\\Users\\TALES K\\Games\\a2_diff` (a partir de a2_run; o GOG nunca é tocado):
o allods2.exe recebe o remendo do LAB (rand() do cliente = constante, make_lab_runtime.patch_exe) e o RELÓGIO VIRTUAL abaixo.
Desenho e medições: notes/differential-fuzz.md.

Relógio do servidor (análise estática, allods2.exe GOG):
- laço de missão solo 0x488aa1 (chamado por 0x481d89): `enquanto timeGetTime() >= base + (n+1)×período` roda UM tique do servidor
  (0x4f08c0 → 0x4f8521: [jogo+4]++ = relógio de 16/s, mensagens, mundo) e volta a testar; depois desenha um quadro.
- o servidor também lê GetTickCount (21 chamadas em 0x4e..0x55: estatísticas, salvamento de ficha a cada 15 s com +0x74, objeto
  0x52ee9b) e QueryPerformanceCounter (cronômetros de perfil da IA 0x55f2d0 / 0x57aee0).

Remendos (o GATE só vale com [EN] = 1 e os relógios com [ENT] = 1; com 0 cada caverna salta para a API real = jogo original):
- `call [timeGetTime]` em 0x488ad8 → GATE: conta a chamada (CALLS), executa a CAIXA DE CORREIO (chamada pedida pelo harness, na
  thread principal, entre tiques) e, se BUDGET > 0, consome 1, conta DONE, avança VTIME 62/63 ms e devolve 0xffffffff (o tique roda);
  senão devolve 0 (nenhum tique; o cliente segue desenhando).
- GetTickCount nas 21 chamadas do servidor → VTIME;  QueryPerformanceCounter em 0x55f2db/0x57aeee → VTIME (64 bits, alta = 0).

Variáveis (fim da última página de .data, além do VirtualSize, zeradas pelo carregador; o harness lê/escreve com Read/WriteProcessMemory):
  D+0x00 EN | +0x04 BUDGET | +0x08 DONE | +0x0c CALLS | +0x10 FN | +0x14 ECX | +0x18 NARGS | +0x1c..+0x28 ARGS[4] | +0x2c RET
  +0x30 MAILDONE | +0x34 VTIME | +0x38 ENT

    .venv\\Scripts\\python.exe tools/refcap/diff/make_diff_runtime.py [--no-copy]
Depois: `A2_RUN_DIR=C:\\Users\\TALES K\\Games\\a2_diff` (launch.py lê a variável) — original_episode.py já define.
"""
from __future__ import annotations

import argparse
import os
import struct
import sys

import pefile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "trace"))
import make_lab_runtime as lab  # noqa: E402

DST = r"C:\Users\TALES K\Games\a2_diff"
DATA = 0x6CDF00
V = {k: DATA + o for k, o in (("EN", 0), ("BUDGET", 4), ("DONE", 8), ("CALLS", 0xC), ("FN", 0x10), ("ECX", 0x14),
                              ("NARGS", 0x18), ("ARGS", 0x1C), ("RET", 0x2C), ("MAILDONE", 0x30), ("VTIME", 0x34),
                              ("ENT", 0x38))}
IAT_TIMEGETTIME = 0x6CF074
IAT_GETTICKCOUNT = 0x6CED18
IAT_QPC = 0x6CED14
GATE_SITE = 0x488AD8
GTC_SITES = [0x4E9EE8, 0x4F08DA, 0x4F0AC1, 0x4F6032, 0x4F6290, 0x4F6518, 0x4F65B7, 0x4F6B8E, 0x501658, 0x5017A6, 0x507FB9,
             0x507FC2, 0x509401, 0x509424, 0x50A666, 0x50AC29, 0x512F14, 0x5236F9, 0x52EEF7, 0x52EF55, 0x549377]
QPC_SITES = [0x55F2DB, 0x57AEEE]


class Asm:
    """Montador mínimo (x86-32) com rótulos e saltos curtos."""

    def __init__(self, org: int):
        self.org, self.b, self.labels, self.fix = org, bytearray(), {}, []

    def here(self):
        return self.org + len(self.b)

    def label(self, n):
        self.labels[n] = self.here()

    def raw(self, *bs):
        for x in bs:
            self.b += x if isinstance(x, (bytes, bytearray)) else bytes([x])

    def m32(self, v):
        self.b += struct.pack("<I", v & 0xFFFFFFFF)

    def j8(self, op, n):
        self.raw(op, 0)
        self.fix.append((len(self.b) - 1, n))

    def done(self) -> bytes:
        for pos, n in self.fix:
            rel = self.labels[n] - (self.org + pos + 1)
            assert -128 <= rel < 128, n
            self.b[pos] = rel & 0xFF
        return bytes(self.b)

    # instruções usadas
    def cmp_m_0(self, m): self.raw(0x83, 0x3D); self.m32(m); self.raw(0)
    def jmp_m(self, m): self.raw(0xFF, 0x25); self.m32(m)
    def call_m(self, m): self.raw(0xFF, 0x15); self.m32(m)
    def inc_m(self, m): self.raw(0xFF, 0x05); self.m32(m)
    def dec_m(self, m): self.raw(0xFF, 0x0D); self.m32(m)
    def mov_eax_m(self, m): self.raw(0xA1); self.m32(m)
    def mov_m_eax(self, m): self.raw(0xA3); self.m32(m)
    def mov_ecx_m(self, m): self.raw(0x8B, 0x0D); self.m32(m)
    def mov_m_0(self, m): self.raw(0xC7, 0x05); self.m32(m); self.m32(0)
    def add_m_eax(self, m): self.raw(0x01, 0x05); self.m32(m)


def build_caves(org: int) -> tuple[bytes, dict]:
    a = Asm(org)
    # ---------------- GATE (substitui timeGetTime no teste do laço de tiques 0x488aa1)
    a.label("gate")
    a.cmp_m_0(V["EN"]); a.j8(0x75, "g_on"); a.jmp_m(IAT_TIMEGETTIME)
    a.label("g_on")
    a.inc_m(V["CALLS"])
    a.mov_eax_m(V["FN"]); a.raw(0x85, 0xC0); a.j8(0x74, "g_nomail")
    a.raw(0x60)                      # pushad
    a.raw(0x89, 0xE5)                # mov ebp, esp
    a.mov_ecx_m(V["NARGS"])
    a.j8(0xE3, "g_call")             # jecxz
    a.label("g_push")
    a.raw(0xFF, 0x34, 0x8D); a.m32(V["ARGS"] - 4)   # push dword [ARGS-4 + ecx*4]
    a.j8(0xE2, "g_push")             # loop
    a.label("g_call")
    a.mov_ecx_m(V["ECX"])
    a.call_m(V["FN"])
    a.mov_m_eax(V["RET"])
    a.raw(0x89, 0xEC)                # mov esp, ebp
    a.raw(0x61)                      # popad
    a.mov_m_0(V["FN"])
    a.inc_m(V["MAILDONE"])
    a.label("g_nomail")
    a.mov_eax_m(V["BUDGET"]); a.raw(0x85, 0xC0); a.j8(0x74, "g_idle")
    a.dec_m(V["BUDGET"])
    a.inc_m(V["DONE"])
    a.mov_eax_m(V["DONE"]); a.raw(0x83, 0xE0, 0x01); a.raw(0x83, 0xC0, 0x3E)   # and eax,1 ; add eax,62
    a.add_m_eax(V["VTIME"])
    a.raw(0x83, 0xC8, 0xFF)          # or eax, -1  -> tique roda
    a.raw(0xC3)
    a.label("g_idle")
    a.raw(0x31, 0xC0, 0xC3)          # xor eax,eax ; ret -> nenhum tique
    # ---------------- GetTickCount do servidor
    a.label("gtc")
    a.cmp_m_0(V["ENT"]); a.j8(0x75, "t_on"); a.jmp_m(IAT_GETTICKCOUNT)
    a.label("t_on")
    a.mov_eax_m(V["VTIME"]); a.raw(0xC3)
    # ---------------- QueryPerformanceCounter do servidor (stdcall, 1 arg)
    a.label("qpc")
    a.cmp_m_0(V["ENT"]); a.j8(0x75, "q_on"); a.jmp_m(IAT_QPC)
    a.label("q_on")
    a.raw(0x8B, 0x44, 0x24, 0x04)    # mov eax, [esp+4]
    a.mov_ecx_m(V["VTIME"])
    a.raw(0x89, 0x08)                # mov [eax], ecx
    a.raw(0xC7, 0x40, 0x04); a.m32(0)  # mov dword [eax+4], 0
    a.raw(0xB8); a.m32(1)            # mov eax, 1
    a.raw(0xC2, 0x04, 0x00)          # ret 4
    code = a.done()
    return code, {k: a.labels[k] for k in ("gate", "gtc", "qpc")}


def patch_clock(path: str) -> dict:
    raw = bytearray(open(path, "rb").read())
    pe = pefile.PE(data=bytes(raw))
    base = pe.OPTIONAL_HEADER.ImageBase
    text = next(s for s in pe.sections if s.Name.startswith(b".text"))
    tva, toff, tsz = base + text.VirtualAddress, text.PointerToRawData, text.SizeOfRawData
    data = next(s for s in pe.sections if s.Name.startswith(b".data"))
    dend = base + data.VirtualAddress + data.Misc_VirtualSize
    assert dend <= DATA and DATA + 0x40 <= ((dend + 0xFFF) & ~0xFFF), "variáveis fora da última página de .data"
    coff = (text.Misc_VirtualSize + 15) & ~15           # depois da caverna do LAB
    org = tva + coff
    code, ent = build_caves(org)
    if coff + len(code) > tsz or any(raw[toff + coff:toff + coff + len(code)]):
        raise SystemExit(f"sem folga em .text para {len(code)} bytes")
    raw[toff + coff:toff + coff + len(code)] = code
    struct.pack_into("<I", raw, text.get_file_offset() + 8, coff + len(code))   # VirtualSize cobre a caverna

    def site(va, iat, dst):
        o = toff + va - tva
        want = b"\xff\x15" + struct.pack("<I", iat)
        if bytes(raw[o:o + 6]) != want:
            raise SystemExit(f"{va:#x}: esperado call [{iat:#x}], achado {bytes(raw[o:o + 6]).hex()}")
        raw[o:o + 6] = b"\xe8" + struct.pack("<i", dst - (va + 5)) + b"\x90"

    site(GATE_SITE, IAT_TIMEGETTIME, ent["gate"])
    for s in GTC_SITES:
        site(s, IAT_GETTICKCOUNT, ent["gtc"])
    for s in QPC_SITES:
        site(s, IAT_QPC, ent["qpc"])
    open(path, "wb").write(raw)
    return {"caves": {k: hex(v) for k, v in ent.items()}, "bytes": len(code), "data": hex(DATA),
            "sites": 1 + len(GTC_SITES) + len(QPC_SITES)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-copy", action="store_true", help="só remenda o exe (cópia já existe)")
    a = ap.parse_args()
    lab.DST = DST
    if not a.no_copy or not os.path.exists(os.path.join(DST, "allods2.exe")):
        lab.copy_runtime()
    exe = os.path.join(DST, "allods2.exe")
    import shutil
    shutil.copy2(os.path.join(lab.SRC, "allods2.exe"), exe)    # sempre parte do exe limpo de a2_run
    print("rand do cliente:", {k: v for k, v in lab.patch_exe(exe).items() if k != "sites"})
    print("relógio virtual:", patch_clock(exe))
    print("ok:", DST)


if __name__ == "__main__":
    sys.exit(main())
