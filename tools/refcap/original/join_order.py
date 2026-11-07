"""A ORDEM da entrada do herói numa missão no jogo ORIGINAL (F2 item 4: a junção do herói no oráculo, tools/re/oracle/join_episode.py).

Abre um save de cidade pelo harness (janela, trava scratch/refcap.lock, cópia A2_RUN_DIR = a2_lab: sem o relógio virtual, a entrada na
missão corre normal), instala cavernas de 5 bytes (memória alocada no processo; nada no disco) que registram, na ordem:
  - cada pacote tratado por Server_PacketDispatcher 0x4f515d (os 24 primeiros bytes: +5 jogador, +9 tipo, +10 dword);
  - a entrada de Server_StartMap 0x4eb715, do carregador do mapa 0x5606aa e do carregador do script 0x562745 (com [0x68d2c4], os
    jogadores, e o herói do 1.º jogador humano: o que 0x562518 exige para resolver as referências especiais 10001..);
clica no portão e espera a missão começar; lê a lista dos valores do script calculados ([0x66832c]+0xeaac) e grava o relatório em
scratch/join_order/<save>.json. Fecha o jogo e solta a trava no fim.

    .venv\\Scripts\\python.exe tools/refcap/original/join_order.py [--save m20_town]
"""
from __future__ import annotations

import argparse
import ctypes
import ctypes.wintypes as wt
import json
import os
import struct
import sys
import time

os.environ.setdefault("A2_RUN_DIR", r"C:\Users\TALES K\Games\a2_lab")
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))

import capture  # noqa: E402
import flows  # noqa: E402
from run_steps import acquire, open_session, release  # noqa: E402

HEAD = bytes.fromhex("558bec6aff")       # push ebp; mov ebp, esp; push -1 (as quatro funções começam assim)
HOOKS = {0x4F515D: 1, 0x4EB715: 2, 0x5606AA: 3, 0x562745: 4}
NAMES = {1: "pacote", 2: "Server_StartMap 0x4eb715", 3: "carga do mapa 0x5606aa", 4: "carga do script 0x562745"}
REC, CAP = 32, 4096
k32 = ctypes.WinDLL("kernel32", use_last_error=True)
k32.VirtualAllocEx.restype = ctypes.c_void_p
k32.VirtualAllocEx.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.c_size_t, wt.DWORD, wt.DWORD]
k32.VirtualProtectEx.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.c_size_t, wt.DWORD, ctypes.POINTER(wt.DWORD)]
k32.FlushInstructionCache.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.c_size_t]
p32 = lambda v: struct.pack("<I", v & 0xFFFFFFFF)


def cave(kind: int, hdr: int, rec: int, code: int, target: int) -> bytes:
    """Registro de 32 B: {tipo, [esp+4] da entrada (pacote / 1.º argumento), [0x68d2c4], 20 B do pacote (só tipo 1)}."""
    c = bytearray()
    c += b"\x9c\x60"                                   # pushfd; pushad
    c += b"\x8b\x35" + p32(hdr)                        # mov esi, [hdr]
    c += b"\x3b\x35" + p32(hdr + 4)                    # cmp esi, [hdr+4]
    j1 = len(c); c += b"\x73\x00"                      # jae fim
    c += b"\xc1\xe6\x05"                               # shl esi, 5
    c += b"\x8d\xbe" + p32(rec)                        # lea edi, [esi+rec]
    c += b"\xc7\x07" + p32(kind)                       # mov dword [edi], kind
    c += b"\x8b\x44\x24\x28"                           # mov eax, [esp+0x28] (= [esp+4] na entrada)
    c += b"\x89\x47\x04"                               # mov [edi+4], eax
    c += b"\x8b\x0d" + p32(0x68D2C4)                   # mov ecx, [0x68d2c4]
    c += b"\x89\x4f\x08"                               # mov [edi+8], ecx
    j2 = None
    if kind == 1:
        c += b"\x85\xc0"                               # test eax, eax
        j2 = len(c); c += b"\x74\x00"                  # jz conta
        c += b"\x89\xc6\x83\xc7\x0c\xb9" + p32(5)      # mov esi, eax; add edi, 12; mov ecx, 5
        c += b"\xfc\xf3\xa5"                           # cld; rep movsd
    conta = len(c)
    if j2 is not None:
        c[j2 + 1] = conta - (j2 + 2)
    c += b"\xff\x05" + p32(hdr)                        # inc dword [hdr]
    fim = len(c)
    c[j1 + 1] = fim - (j1 + 2)
    c += b"\x61\x9d" + HEAD                            # popad; popfd; os 5 bytes originais
    c += b"\xe9" + p32(target + 5 - (code + len(c) + 5))
    return bytes(c)


class Hooks:
    def __init__(self, p):
        self.p = p
        self.base = k32.VirtualAllocEx(p.h, None, 0x1000 + CAP * REC, 0x3000, 0x40)
        if not self.base:
            raise OSError("VirtualAllocEx falhou (%d)" % ctypes.get_last_error())
        self.hdr, self.rec = self.base, self.base + 0x1000
        p.write(self.hdr, struct.pack("<II", 0, CAP))
        for i, (addr, kind) in enumerate(HOOKS.items()):
            code = self.base + 0x40 + i * 0x80
            cur = bytes(p.read(addr, 5))
            if cur != HEAD:
                raise RuntimeError("0x%x inesperado: %s" % (addr, cur.hex()))
            p.write(code, cave(kind, self.hdr, self.rec, code, addr))
            self.patch(addr, b"\xe9" + struct.pack("<i", code - (addr + 5)))

    def patch(self, addr: int, data: bytes) -> None:
        old = wt.DWORD()
        if not k32.VirtualProtectEx(self.p.h, addr, len(data), 0x40, ctypes.byref(old)):
            raise OSError("VirtualProtectEx falhou (%d)" % ctypes.get_last_error())
        self.p.write(addr, data)
        k32.VirtualProtectEx(self.p.h, addr, len(data), old.value, ctypes.byref(old))
        k32.FlushInstructionCache(self.p.h, addr, len(data))

    def unhook(self) -> None:
        for addr in HOOKS:
            self.patch(addr, HEAD)

    def log(self) -> list[dict]:
        n = min(struct.unpack("<I", bytes(self.p.read(self.hdr, 4)))[0], CAP)
        raw = bytes(self.p.read(self.rec, n * REC)) if n else b""
        out = []
        for i in range(n):
            b = raw[i * REC:(i + 1) * REC]
            kind, arg, players = struct.unpack_from("<III", b, 0)
            e = {"i": i, "o_que": NAMES[kind], "arg": "0x%x" % arg, "jogadores": "0x%x" % players}
            if kind == 1:
                pk = b[12:32]                                # bytes 0..19 do pacote
                e.update({"jogador": struct.unpack_from("<H", pk, 5)[0], "tipo": "0x%x" % pk[9], "dword10": struct.unpack_from("<I", pk, 10)[0]})
            out.append(e)
        return out


def script_values(p) -> dict:
    ai = struct.unpack("<I", bytes(p.read(0x66832C, 4)))[0]
    if not ai:
        return {"ia": 0}
    lst = struct.unpack("<I", bytes(p.read(ai + 0xEAAC, 4)))[0]
    node = struct.unpack("<I", bytes(p.read(lst + 4, 4)))[0] if lst else 0
    ids = []
    while node and len(ids) < 1000:
        rec = node + 8
        rid, kind = struct.unpack("<II", bytes(p.read(rec, 8)))
        ids.append([rid, kind, bytes(p.read(rec + 0x58, 1))[0], "0x%x" % struct.unpack("<I", bytes(p.read(rec + 0x5C, 4)))[0]])
        node = struct.unpack("<I", bytes(p.read(node, 4)))[0]
    return {"n": len(ids), "valores": ids}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--save", default="m20_town")
    a = ap.parse_args()
    out = os.path.join(ROOT, "scratch", "join_order")
    os.makedirs(out, exist_ok=True)
    if not acquire():
        sys.exit(3)
    closer = None
    rep: dict = {"save": a.save, "copia": os.environ["A2_RUN_DIR"]}
    try:
        g, inp, closer = open_session(a.save, 300)
        from memory import Proc
        p = Proc(g.proc.pid)
        hk = Hooks(p)
        flows.close_tip(g, inp)
        g.wait(0.5)
        inp.click(*flows.TOWN_SPOT["gate"])
        # a carga e a junção acontecem logo depois do portão; as falas só precisam de cliques (sem o 1.º plano, a guarda do input
        # aborta: o registro é lido assim mesmo)
        try:
            for i in range(12):
                if not flows.wait_dialog(g, inp, 25 if i == 0 else 2.5):
                    break
                pt = flows.find_template(capture.grab(g), "btn_ok", region=(190, 300, 700, 600), thr=9) or (507, 452)
                inp.click(*pt)
                g.wait(0.6)
        except RuntimeError as e:
            rep["falas"] = str(e)
            g.wait(15.0)
        g.wait(1.0)
        capture.grab(g).save(os.path.join(out, f"{a.save}_hud.png"))
        rep["eventos"] = hk.log()
        rep["script"] = script_values(p)
        hk.unhook()
    finally:
        path = os.path.join(out, f"{a.save}.json")
        json.dump(rep, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print("relatório:", path, flush=True)
        if closer:
            closer()
        release()
        from launch import list_game_pids
        print("allods2 restantes:", list_game_pids(), flush=True)


if __name__ == "__main__":
    main()
