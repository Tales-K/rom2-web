"""Cria a cópia de execução de LABORATÓRIO `C:\\Users\\TALES K\\Games\\a2_lab` (a partir de a2_run; o GOG nunca é tocado) com o
allods2.exe REMENDADO para reprodutibilidade (notes/telemetry.md):

- o jogo usa UM só estado de rand() (CRT MSVC, 0x583290) para servidor e cliente, na mesma thread; o cliente (desenho, sons,
  interface: chamadas diretas `call 0x583290` em 0x41xxxx..0x4cxxxx) consome números a cada quadro, então a sequência do servidor
  depende do ritmo de quadros. O remendo troca o destino dessas chamadas do CLIENTE por uma rotina que devolve uma constante
  (0x4000) e deixa intactas as do servidor (0x51fa0c, 0x51fa25 e o gerador da IA 0x57afc0).
- `--map 10=caminho.alm`: troca o .alm da missão dentro de uma CÓPIA de scenario.res (contêiner &YA1, notes/formats.md): os
  dados novos vão no fim da área de dados e a entrada aponta para eles.

    .venv\\Scripts\\python.exe tools/refcap/trace/make_lab_runtime.py [--no-patch] [--map 10=refs/lab/lab.alm]
Depois: `set A2_RUN_DIR=C:\\Users\\TALES K\\Games\\a2_lab` antes de orig_trace.py / probe_move.py (launch.py lê a variável).
"""
from __future__ import annotations

import argparse
import os
import re
import shutil
import struct
import sys

import pefile

SRC = r"C:\Users\TALES K\Games\a2_run"
DST = r"C:\Users\TALES K\Games\a2_lab"
RAND = 0x583290
CLIENT_MAX = 0x500000          # chamadas diretas a rand() abaixo daqui são do cliente (interface/desenho/som)
CONST = 0x4000
RAND_N = 0x51FA25              # rand(n) do jogo; o cliente também o chama (0x41bca4, 0x468222.., 0x4756a3, 0x49f5d1)
CLIENT_N_MAX = 0x4E0000        # 0x4e..0x4f = lógica de jogo/rede do servidor: não mexer


def copy_runtime():
    os.makedirs(DST, exist_ok=True)
    for f in os.listdir(SRC):
        s, d = os.path.join(SRC, f), os.path.join(DST, f)
        if f.lower().startswith("game") and f.lower().endswith(".sav") or f == "_parked":
            continue
        if os.path.isdir(s):
            if not os.path.exists(d):
                shutil.copytree(s, d)
        else:
            fresh = f.lower() in ("allods2.exe", "scenario.res")
            if not fresh and os.path.exists(d) and os.path.getsize(d) == os.path.getsize(s) \
                    and int(os.path.getmtime(d)) == int(os.path.getmtime(s)):
                continue
            shutil.copy2(s, d)
    os.makedirs(os.path.join(DST, "_parked"), exist_ok=True)


def patch_exe(path: str) -> dict:
    raw = bytearray(open(path, "rb").read())
    pe = pefile.PE(data=bytes(raw))
    base = pe.OPTIONAL_HEADER.ImageBase
    text = next(s for s in pe.sections if s.Name.startswith(b".text"))
    tva, toff, tsz = base + text.VirtualAddress, text.PointerToRawData, text.SizeOfRawData
    tdata = bytes(raw[toff:toff + tsz])
    # caverna: folga de .text entre VirtualSize e SizeOfRawData (zeros no arquivo, mapeada como código); senão 16× int3
    code = b"\xb8" + struct.pack("<I", CONST) + b"\xc3"   # mov eax, CONST ; ret
    slack = (text.Misc_VirtualSize + 15) & ~15
    if slack + 16 <= tsz and tdata[slack:slack + 16] == b"\0" * 16:
        coff = slack
        text.Misc_VirtualSize = slack + 16                # a seção passa a cobrir a caverna
        raw = bytearray(pe.write())
    else:
        m = re.search(rb"\xcc{16}", tdata)
        if not m:
            raise SystemExit("sem caverna em .text")
        coff = m.start()
    cave = tva + coff
    raw[toff + coff:toff + coff + len(code)] = code
    # 2ª rotina (rand(n) do jogo, 0x51fa25, chamada pelo cliente em 0x41..0x49): devolve 0 (sempre dentro de 0..n)
    cave2 = cave + 8
    raw[toff + coff + 8:toff + coff + 11] = b"\x31\xc0\xc3"   # xor eax, eax ; ret
    n = 0
    sites = []
    for mm in re.finditer(rb"\xe8", tdata):
        i = mm.start()
        if i + 5 > len(tdata):
            continue
        src = tva + i
        rel = struct.unpack_from("<i", tdata, i + 1)[0]
        dst = src + 5 + rel
        if dst == RAND and src < CLIENT_MAX:
            struct.pack_into("<i", raw, toff + i + 1, cave - (src + 5))
        elif dst == RAND_N and src < CLIENT_N_MAX:
            struct.pack_into("<i", raw, toff + i + 1, cave2 - (src + 5))
        else:
            continue
        n += 1
        sites.append(hex(src))
    open(path, "wb").write(raw)
    return {"cave": hex(cave), "patched": n, "sites": sites}


def replace_in_res(res_path: str, inner: str, data: bytes):
    buf = bytearray(open(res_path, "rb").read())
    magic, root_first, root_count, flags, dir_off, count = struct.unpack_from("<4sIIIII", buf, 0)
    assert magic == b"&YA1", "não é &YA1"
    entries = [list(struct.unpack_from("<IIII16s", buf, dir_off + 32 * k)) for k in range(count)]
    names = [e[4].split(b"\0")[0].split(b"\xcd")[0].decode("latin-1") for e in entries]
    target = inner.split("/")[-1].lower()
    idx = [k for k, nme in enumerate(names) if nme.lower() == target and entries[k][3] == 0]
    if len(idx) != 1:
        raise SystemExit(f"{inner}: {len(idx)} entradas")
    k = idx[0]
    table = bytes(buf[dir_off:dir_off + 32 * count])
    new = bytes(buf[:dir_off]) + data
    entries[k][1], entries[k][2] = dir_off, len(data)
    new_dir = len(new)
    tab = bytearray(table)
    struct.pack_into("<IIII16s", tab, 32 * k, *entries[k])
    out = bytearray(new + bytes(tab))
    struct.pack_into("<I", out, 0x10, new_dir)
    open(res_path, "wb").write(out)
    return {"entry": k, "offset": dir_off, "size": len(data)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-patch", action="store_true")
    ap.add_argument("--map", action="append", default=[], help="N=arquivo.alm (troca scenario/N.alm na cópia)")
    a = ap.parse_args()
    copy_runtime()
    if not a.no_patch:
        print("exe:", patch_exe(os.path.join(DST, "allods2.exe")))
    for spec in a.map:
        n, path = spec.split("=", 1)
        print("scenario.res:", replace_in_res(os.path.join(DST, "scenario.res"), f"{n}.alm", open(path, "rb").read()))
    print("ok:", DST)


if __name__ == "__main__":
    sys.exit(main())
