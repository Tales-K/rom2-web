"""Cria a cópia de execução de ÁUDIO `C:\\Users\\TALES K\\Games\\a2_audio` (a partir de a2_run; o GOG nunca é tocado): o allods2.exe
LIMPO (sem remendo de rand nem de relógio, tudo em tempo real) + 3 ganchos que gravam cada pedido de som num anel de memória
(frente AUDIO-2, 20/10; notes/audio-triggers.md).

Ganchos (`jmp` de 5 bytes para uma caverna na folga de .text, que chama a rotina de registro e executa as instruções roubadas):
- 0x45aa2f  tocar(vol, pan, laço, prio, freq) [thiscall, ECX = objeto de som]   -> registro tag 1 (o pedido, antes de qualquer descarte)
- 0x45ad66  iniciar a voz (já com slot escolhido; ECX = slot de 16 B, +4 prio, +8 buffer, +0xc objeto de som) -> tag 2 (começou)
- 0x41f610  parar a voz do slot (ECX = slot)                                     -> tag 3 (parou; ret distingue corte x parada)

Registro (64 B, anel de 16384; índice em DATA+4, ponteiro do anel em DATA+0, escrito pelo harness):
  +0 tag | +4 ECX | +8 a | +12 b | +16 c | +20 d | +24 e | +28 retorno | +32 tsc_lo | +36 tsc_hi | +40 GetTickCount
  tag 1: a=vol b=pan c=laço d=prio e=freq     tag 2: a=objeto b=prio(slot) c=laço     tag 3: a=objeto b=prio(slot)
- 0x41f4a0 / 0x41f540  ajustar volume / pan da voz do slot (tags 5 / 6; c = valor): os laços de rio e fogo se atualizam por aqui
- 0x41b311  ambiente/rio/fogo (chamado 1x por quadro com ECX = objeto da vista da missão): grava ECX em DATA+8 (sem registro no anel)

    .venv\\Scripts\\python.exe tools/refcap/original/make_audio_runtime.py [--no-copy]
Depois: A2_RUN_DIR=C:\\Users\\TALES K\\Games\\a2_audio (audio_hook.py define).
"""
from __future__ import annotations

import argparse
import os
import shutil
import struct
import sys

import pefile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "trace"))
import make_lab_runtime as lab  # noqa: E402

DST = r"C:\Users\TALES K\Games\a2_audio"
DATA = 0x6CDF00
IAT_GETTICKCOUNT = 0x6CED18
RING_MASK = 0x3FFF

HOOKS = [  # (VA, bytes roubados, tag)
    (0x45AA2F, bytes.fromhex("558bec83ec10894df0"), 1),
    (0x45AD66, bytes.fromhex("558bec51894dfc"), 2),
    (0x41F610, bytes.fromhex("558bec51894dfc"), 3),
    (0x41F4A0, bytes.fromhex("558bec51894dfc"), 5),   # ajustar volume da voz do slot (laços de rio/fogo): c=valor
    (0x41F540, bytes.fromhex("558bec51894dfc"), 6),   # ajustar pan da voz do slot: c=valor
    (0x438570, bytes.fromhex("558bec518b4508"), 8),   # ajudante de interface "toca se ocioso": a = ponteiro do ponteiro do objeto; ret = QUEM pediu
    (0x4385B0, bytes.fromhex("558bec518b4508"), 9),   # ajudante "parar": idem
    (0x41B311, bytes.fromhex("558bec81ecf4000000"), 4),   # ambiente/rio/fogo da vista: só guarda ECX (a vista) em DATA+8
]


def _m32(v):
    return struct.pack("<I", v & 0xFFFFFFFF)


def _h(s):
    return bytes.fromhex(s)


def build_common() -> bytes:
    """Rotina de registro (chamada pelas cavernas): EDX = tag; pilha: [esp]=retorno à caverna, +4..+35 pushad, +36 eflags,
    +40 retorno original, +44 1º argumento."""
    b = bytearray()
    b += _h("8b1d") + _m32(DATA)                       # mov ebx,[DATA]
    b += _h("85db")                                    # test ebx,ebx
    jz = len(b); b += _h("7400")                       # jz out
    b += _h("b8") + _m32(1)                            # mov eax,1
    b += _h("f00fc105") + _m32(DATA + 4)               # lock xadd [DATA+4],eax
    b += _h("25") + _m32(RING_MASK)                    # and eax,mask
    b += _h("c1e006")                                  # shl eax,6
    b += _h("01c3")                                    # add ebx,eax
    b += _h("8913894b04")                              # mov [ebx],edx ; mov [ebx+4],ecx

    def esp_to(src, dst):                              # mov eax,[esp+src] ; mov [ebx+dst],eax
        b.extend(_h("8b4424") + bytes([src]) + _h("8943") + bytes([dst]))
    b += _h("83fa01")                                  # cmp edx,1
    je1 = len(b); b += _h("7400")                      # je copy
    b += _h("83fa08")                                  # cmp edx,8
    jae = len(b); b += _h("7300")                      # jae copy
    b += _h("8b410c894308")                            # mov eax,[ecx+0xc] ; mov [ebx+8],eax   (objeto de som do slot)
    b += _h("0fb64104" "89430c")                       # movzx eax,byte [ecx+4] ; mov [ebx+12],eax  (prio do slot)
    esp_to(44, 16)
    jt = len(b); b += _h("eb00")                       # jmp tail
    b[je1 + 1] = len(b) - (je1 + 2)
    b[jae + 1] = len(b) - (jae + 2)
    for i in range(5):                                 # copy: argumentos 1..5 -> a..e
        esp_to(44 + 4 * i, 8 + 4 * i)
    b[jt + 1] = len(b) - (jt + 2)
    esp_to(40, 28)                                     # retorno original
    b += _h("ff15") + _m32(IAT_GETTICKCOUNT)           # call [GetTickCount]
    b += _h("894328")                                  # mov [ebx+40],eax
    b[jz + 1] = len(b) - (jz + 2)
    b += _h("c3")
    return bytes(b)


def build_cave(org: int, va: int, stolen: bytes, tag: int, common: int) -> bytes:
    if tag == 4:
        b = bytearray(_h("890d") + _m32(DATA + 8) + stolen)          # mov [DATA+8],ecx ; instruções roubadas
        b += _h("e9") + struct.pack("<i", (va + len(stolen)) - (org + len(b) + 5))
        return bytes(b)
    b = bytearray(_h("9c60"))                          # pushfd ; pushad
    b += _h("ba") + _m32(tag)                          # mov edx,tag
    b += _h("e8") + struct.pack("<i", common - (org + len(b) + 5))   # call common
    b += _h("619d") + stolen                           # popad ; popfd ; instruções roubadas
    b += _h("e9") + struct.pack("<i", (va + len(stolen)) - (org + len(b) + 5))
    return bytes(b)


def patch_audio(path: str) -> dict:
    raw = bytearray(open(path, "rb").read())
    pe = pefile.PE(data=bytes(raw))
    base = pe.OPTIONAL_HEADER.ImageBase
    text = next(s for s in pe.sections if s.Name.startswith(b".text"))
    tva, toff = base + text.VirtualAddress, text.PointerToRawData
    sec = next(s for s in pe.sections if s.Name.startswith(b".rdata"))   # folga de .rdata (320 B) tornada executável
    sva, soff, ssz = base + sec.VirtualAddress, sec.PointerToRawData, sec.SizeOfRawData
    data = next(s for s in pe.sections if s.Name.startswith(b".data"))
    dend = base + data.VirtualAddress + data.Misc_VirtualSize
    assert dend <= DATA and DATA + 0x10 <= ((dend + 0xFFF) & ~0xFFF), "variáveis fora da última página de .data"
    coff = (sec.Misc_VirtualSize + 15) & ~15
    tsz, tcoff = text.SizeOfRawData, (text.Misc_VirtualSize + 15) & ~15
    space = [[sva + coff, soff + coff, ssz - coff], [tva + tcoff, toff + tcoff, tsz - tcoff]]   # (va, arquivo, folga): .rdata, depois .text
    used = [bytearray(), bytearray()]
    cva = None

    def place(blob):
        """Reserva `blob` na 1a seção com folga; devolve (índice da seção, VA)."""
        for k, (va0, off0, room) in enumerate(space):
            if len(used[k]) + len(blob) <= room:
                at = va0 + len(used[k])
                used[k] += blob
                return k, at
        raise SystemExit("sem folga para as cavernas")
    k0, cva = place(build_common())
    caves = {}
    for va, stolen, tag in HOOKS:
        n = len(build_cave(0, va, stolen, tag, 0))
        k, at = place(bytes([0xcc]) * n)
        used[k][at - space[k][0]:at - space[k][0] + n] = build_cave(at, va, stolen, tag, cva)   # a chamada é relativa: a seção não importa
        caves[va] = at
    for k, (va0, off0, room) in enumerate(space):
        if used[k]:
            if any(raw[off0:off0 + len(used[k])]):
                raise SystemExit("folga não está zerada")
            raw[off0:off0 + len(used[k])] = used[k]
    struct.pack_into("<I", raw, sec.get_file_offset() + 8, coff + len(used[0]))
    struct.pack_into("<I", raw, sec.get_file_offset() + 36, sec.Characteristics | 0x20000000)   # + executável
    if used[1]:
        struct.pack_into("<I", raw, text.get_file_offset() + 8, tcoff + len(used[1]))
    out = used[0] + used[1]
    for va, stolen, tag in HOOKS:
        o = toff + va - tva
        if bytes(raw[o:o + len(stolen)]) != stolen:
            raise SystemExit(f"{va:#x}: bytes inesperados {bytes(raw[o:o + len(stolen)]).hex()}")
        raw[o:o + len(stolen)] = b"\xe9" + struct.pack("<i", caves[va] - (va + 5)) + b"\x90" * (len(stolen) - 5)
    open(path, "wb").write(raw)
    return {"caves": {hex(k): hex(v) for k, v in caves.items()}, "bytes": len(out), "data": hex(DATA)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-copy", action="store_true")
    a = ap.parse_args()
    lab.DST = DST
    if not a.no_copy or not os.path.exists(os.path.join(DST, "allods2.exe")):
        lab.copy_runtime()
    exe = os.path.join(DST, "allods2.exe")
    shutil.copy2(os.path.join(lab.SRC, "allods2.exe"), exe)    # sempre parte do exe limpo de a2_run
    print("ganchos de áudio:", patch_audio(exe))
    print("ok:", DST)


if __name__ == "__main__":
    sys.exit(main())
