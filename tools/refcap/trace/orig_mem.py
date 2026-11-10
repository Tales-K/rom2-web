"""Telemetria do allods2.exe em execução: unidades do SERVIDOR, tique do servidor e estado do rand() do CRT por thread.

Estruturas (notes/telemetry.md, notes/ai-behaviors.md, notes/combat-formulas.md; endereços VA do exe, base fixa 0x400000):
- unidade do servidor = objeto com vtable 0x5d0eb0 (monstro), 0x5d0f40 (humano) ou 0x5d0fb8 (herói/humano com ficha);
  +0x04 id, +0x0e tipo (word), +0x10 objeto de mapa (byte x, byte y, word célula, byte subx +4, byte suby +5),
  +0x14 jogador (+4 = número), +0x50 tarefa, +0x54 estado (0x10 = morto), +0x94 vida, +0x96 vida máx., +0x98 período de regeneração,
  +0x9a mana, +0x9c mana máx., +0x1c4 dados da tarefa (+8 modo, +0xa célula destino, +0xc alvo, +0x40 Withdraw, +0x44 Wimpy).
- tique do servidor: [[0x6044c4] + 0] (regeneração 0x50fc5a); contador de tempo ~16/s em [[0x6044c4] + 4].
- rand() do CRT MSVC (0x583290): estado POR THREAD em _tiddata+0x14, _tiddata = TlsGetValue([0x600a20]) (0x58a930);
  seed = seed × 214013 + 2531011, retorno (seed >> 16) & 0x7fff; srand(timeGetTime()) em 0x51f9f8 e srand(time(0)) da IA em 0x57af80.
Só leitura, exceto `set_seed` (escreve na memória do processo da CÓPIA de execução a2_run; nunca na instalação original).
"""
from __future__ import annotations

import ctypes
import ctypes.wintypes as wt
import os
import struct
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "original"))
from memory import Proc  # noqa: E402

UNIT_VTABLES = {0x5D0EB0: "monster", 0x5D0F40: "human", 0x5D0FB8: "hero"}
GAME_PTR = 0x6044C4
TLS_INDEX_PTR = 0x600A20

kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
ntdll = ctypes.WinDLL("ntdll")
TH32CS_SNAPTHREAD = 0x4
THREAD_QUERY_INFORMATION = 0x40


class THREADENTRY32(ctypes.Structure):
    _fields_ = [("dwSize", wt.DWORD), ("cntUsage", wt.DWORD), ("th32ThreadID", wt.DWORD), ("th32OwnerProcessID", wt.DWORD),
                ("tpBasePri", ctypes.c_long), ("tpDeltaPri", ctypes.c_long), ("dwFlags", wt.DWORD)]


class THREAD_BASIC_INFORMATION(ctypes.Structure):
    _fields_ = [("ExitStatus", ctypes.c_long), ("TebBaseAddress", ctypes.c_void_p), ("UniqueProcess", ctypes.c_void_p),
                ("UniqueThread", ctypes.c_void_p), ("AffinityMask", ctypes.c_void_p), ("Priority", ctypes.c_long),
                ("BasePriority", ctypes.c_long)]


kernel32.CreateToolhelp32Snapshot.restype = wt.HANDLE
kernel32.OpenThread.restype = wt.HANDLE


def thread_ids(pid: int) -> list[int]:
    snap = kernel32.CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0)
    te = THREADENTRY32()
    te.dwSize = ctypes.sizeof(te)
    out = []
    ok = kernel32.Thread32First(snap, ctypes.byref(te))
    while ok:
        if te.th32OwnerProcessID == pid:
            out.append(te.th32ThreadID)
        ok = kernel32.Thread32Next(snap, ctypes.byref(te))
    kernel32.CloseHandle(snap)
    return out


def teb32(tid: int) -> int | None:
    """TEB de 32 bits de uma thread WOW64 (= TEB64 + 0x2000; com Python de 32 bits, o próprio TEB)."""
    h = kernel32.OpenThread(THREAD_QUERY_INFORMATION, False, tid)
    if not h:
        return None
    tbi = THREAD_BASIC_INFORMATION()
    st = ntdll.NtQueryInformationThread(wt.HANDLE(h), 0, ctypes.byref(tbi), ctypes.sizeof(tbi), None)
    kernel32.CloseHandle(h)
    if st != 0 or not tbi.TebBaseAddress:
        return None
    base = tbi.TebBaseAddress
    return base + 0x2000 if struct.calcsize("P") == 8 else base


class Server:
    def __init__(self, proc: Proc | None = None):
        self.p = proc or Proc.attach()
        self.units: list[int] = []

    # ---------------------------------------------------------------- tique e RNG
    def tick(self) -> int:
        g = self.p.u32(GAME_PTR)
        return self.p.i32(g) if g else -1

    def time16(self) -> int:
        g = self.p.u32(GAME_PTR)
        return self.p.i32(g + 4) if g else -1

    def tiddata(self) -> dict[int, int]:
        """{thread id: endereço do _tiddata} das threads que já usaram o CRT."""
        idx = self.p.u32(TLS_INDEX_PTR)
        out = {}
        for tid in thread_ids(self.p.pid):
            t = teb32(tid)
            if t is None:
                continue
            try:
                slot = self.p.u32(t + 0xE10 + 4 * idx) if idx < 64 else 0
            except OSError:
                continue
            if slot:
                out[tid] = slot
        return out

    def seeds(self) -> dict[int, int]:
        out = {}
        for tid, td in self.tiddata().items():
            try:
                out[tid] = self.p.u32(td + 0x14)
            except OSError:
                pass
        return out

    def set_seed(self, tid: int, seed: int):
        td = self.tiddata()[tid]
        self.p.write(td + 0x14, struct.pack("<I", seed & 0xFFFFFFFF))

    # ---------------------------------------------------------------- unidades
    def rescan(self) -> list[int]:
        snap = self.p.snapshot()
        found = []
        for vt in UNIT_VTABLES:
            for a in self.p.scan(struct.pack("<I", vt), 4, snap):
                try:
                    hp, hpmax = struct.unpack("<hh", self.p.read(a + 0x94, 4))
                    mo = self.p.u32(a + 0x10)
                except OSError:
                    continue
                if 0 < hpmax < 30000 and -100 <= hp <= hpmax and 0x10000 <= mo < 0x7FFF0000:
                    found.append(a)
        self.units = sorted(set(found))
        return self.units

    def read_unit(self, a: int) -> dict | None:
        try:
            b = self.p.read(a, 0x1D0)
            vt, uid = struct.unpack_from("<II", b, 0)
            if vt not in UNIT_VTABLES:
                return None
            typ = struct.unpack_from("<H", b, 0x0E)[0]
            mo, pl = struct.unpack_from("<II", b, 0x10)
            task, state = struct.unpack_from("<II", b, 0x50)
            hp, hpmax, regen, mana, manamax = struct.unpack_from("<hhhhh", b, 0x94)
            m = self.p.read(mo, 6)
            x, y, sx, sy = m[0], m[1], m[4], m[5]
            player = self.p.i16(pl + 4) if pl else -1
            tdp = struct.unpack_from("<I", b, 0x1C4)[0]
            target, mode = 0, -1
            if tdp:
                td = self.p.read(tdp, 0x48)
                mode = td[8]
                tptr = struct.unpack_from("<I", td, 0xC)[0]
                if tptr:
                    try:
                        target = self.p.u32(tptr + 4)
                    except OSError:
                        target = -1
            return {"id": uid, "kind": UNIT_VTABLES[vt], "type": typ, "player": player, "x": x, "y": y,
                    "fx": x + sx / 256, "fy": y + sy / 256, "hp": hp, "hpmax": hpmax, "mana": mana, "manamax": manamax,
                    "task": task, "mode": mode, "target": target, "state": state}
        except OSError:
            return None

    def frame(self) -> dict:
        us = [u for u in (self.read_unit(a) for a in self.units) if u]
        return {"src": "orig", "tick": self.tick(), "t16": self.time16(), "units": us}
