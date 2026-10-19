"""Leitura/escrita da memória do allods2.exe em execução (ReadProcessMemory/WriteProcessMemory via ctypes).

O exe é de 32 bits, base fixa 0x400000 e SEM relocações: variáveis globais (.data 0x5ee000..0x6cd8fc) têm endereço
fixo em toda execução. Objetos (herói, unidades) ficam no heap (endereços mudam) e são achados por ponteiros
globais ou por varredura (como o Cheat Engine). Endereços conhecidos: ver KNOWN e notes/original-capture.md.

Uso:
    from memory import Proc
    p = Proc.attach()            # primeiro allods2.exe
    hits = p.scan_i32(142)       # lista de endereços com o valor
    p.write_i32(addr, 71)
"""
from __future__ import annotations

import ctypes
import ctypes.wintypes as wt
import struct

import numpy as np

kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
PROCESS_ALL = 0x0010 | 0x0020 | 0x0008 | 0x0400  # VM_READ | VM_WRITE | VM_OPERATION | QUERY_INFORMATION
MEM_COMMIT, MEM_PRIVATE, MEM_IMAGE = 0x1000, 0x20000, 0x1000000
WRITABLE = {0x04, 0x08, 0x40, 0x80}  # PAGE_READWRITE, WRITECOPY, EXECUTE_READWRITE, EXECUTE_WRITECOPY


class MBI(ctypes.Structure):
    _fields_ = [("BaseAddress", ctypes.c_void_p), ("AllocationBase", ctypes.c_void_p),
                ("AllocationProtect", wt.DWORD), ("PartitionId", wt.WORD), ("RegionSize", ctypes.c_size_t),
                ("State", wt.DWORD), ("Protect", wt.DWORD), ("Type", wt.DWORD)]


kernel32.OpenProcess.restype = wt.HANDLE
kernel32.ReadProcessMemory.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t,
                                       ctypes.POINTER(ctypes.c_size_t)]
kernel32.WriteProcessMemory.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_size_t,
                                        ctypes.POINTER(ctypes.c_size_t)]
kernel32.VirtualQueryEx.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.POINTER(MBI), ctypes.c_size_t]
kernel32.VirtualQueryEx.restype = ctypes.c_size_t

# ---------------------------------------------------------------- endereços conhecidos (achados por experimento + desmontagem)
KNOWN: dict[str, int] = {
    # allods2.exe (base fixa 0x400000, sem relocações)
    "exe.ScenarioGetVar_ptr": 0x62729C,   # ponteiro para Scenario.dll!ord1 (RVA 0x1cfd) -> dá a base do DLL
    "exe.client_unit_vtable": 0x5CD5D0,   # classe da unidade do lado CLIENTE (o que o HUD/mapa desenham)
    "exe.human_info_vtable": 0x5D0FB8,    # "ficha" do herói/humano do lado servidor (atributos, vida, mana, XP)
    # Scenario.dll (preferida 0x10000000, TEM relocações: use dll_base())
    "dll.vars_rva": 0x36028,              # int vars[1024]; vars[768] = estágio da campanha
    "dll.cur_location_rva": 0x37560,      # Location* local atual (GetCurrentLocation, ord 18)
    "dll.avail_list_rva": 0x35F90,        # lista de locais disponíveis (GetAvailableLocations, ord 14)
    "dll.loc_plagat_rva": 0x35F60,        # Location(type 2, id 1)
    "dll.loc_kaarg_rva": 0x35F78,         # Location(type 2, id 2)
    "dll.loc_druids_rva": 0x37568,        # Location(type 2, id 3)
}
SCENARIO_GETVAR_RVA = 0x1CFD

# unidade CLIENTE (vtable 0x5cd5d0): deslocamentos
CU = {"x256": 0x08, "y256": 0x0C, "hp": 0x104, "hpmax": 0x108, "mana": 0x148, "manamax": 0x14A,
      "body": 0x144, "mind": 0x145, "spirit": 0x146, "agility": 0x147}  # atributos em bytes
# ficha SERVIDOR do herói (vtable 0x5d0fb8), copiada para a unidade cliente pela função 0x4699xx (exe 0x469a25..)
HI = {"body": 0x84, "agility": 0x86, "mind": 0x88, "spirit": 0x8A, "speed?": 0x8C, "hp": 0x94, "hpmax": 0x96,
      "mana": 0x9A, "manamax": 0x9C}


class Proc:
    def __init__(self, pid: int):
        self.pid = pid
        self.h = kernel32.OpenProcess(PROCESS_ALL, False, pid)
        if not self.h:
            raise OSError(f"OpenProcess falhou ({ctypes.get_last_error()})")

    @classmethod
    def attach(cls, pid: int | None = None):
        if pid is None:
            from launch import list_game_pids
            pids = list_game_pids()
            if not pids:
                raise RuntimeError("allods2.exe não está rodando")
            pid = pids[0]
        return cls(pid)

    def close(self):
        if self.h:
            kernel32.CloseHandle(self.h)
            self.h = None

    # ------------------------------------------------------------ leitura/escrita
    def read(self, addr: int, n: int) -> bytes:
        buf = ctypes.create_string_buffer(n)
        got = ctypes.c_size_t()
        if not kernel32.ReadProcessMemory(self.h, ctypes.c_void_p(addr), buf, n, ctypes.byref(got)):
            raise OSError(f"ReadProcessMemory {addr:#x} falhou ({ctypes.get_last_error()})")
        return buf.raw[:got.value]

    def write(self, addr: int, data: bytes):
        got = ctypes.c_size_t()
        if not kernel32.WriteProcessMemory(self.h, ctypes.c_void_p(addr), data, len(data), ctypes.byref(got)):
            raise OSError(f"WriteProcessMemory {addr:#x} falhou ({ctypes.get_last_error()})")

    def i32(self, a):
        return struct.unpack("<i", self.read(a, 4))[0]

    def u32(self, a):
        return struct.unpack("<I", self.read(a, 4))[0]

    def i16(self, a):
        return struct.unpack("<h", self.read(a, 2))[0]

    def u8(self, a):
        return self.read(a, 1)[0]

    def write_i32(self, a, v):
        self.write(a, struct.pack("<i", v))

    def write_i16(self, a, v):
        self.write(a, struct.pack("<h", v))

    def write_u8(self, a, v):
        self.write(a, bytes([v & 0xFF]))

    def cstr(self, a, n=64):
        b = self.read(a, n)
        return b.split(b"\0")[0].decode("latin-1")

    # ------------------------------------------------------------ regiões / varredura
    def regions(self, writable_only=True):
        addr, mbi = 0, MBI()
        while addr < 0x7FFF0000:
            if not kernel32.VirtualQueryEx(self.h, ctypes.c_void_p(addr), ctypes.byref(mbi), ctypes.sizeof(mbi)):
                break
            base, size = mbi.BaseAddress or 0, mbi.RegionSize
            if mbi.State == MEM_COMMIT and (not writable_only or (mbi.Protect & 0xFF) in WRITABLE) \
                    and not (mbi.Protect & 0x100):  # sem PAGE_GUARD
                yield base, size, mbi.Type
            addr = base + size

    def snapshot(self, writable_only=True, max_region=256 << 20):
        """Lista de (base, bytes) de todas as regiões graváveis (heap + .data)."""
        out = []
        for base, size, typ in self.regions(writable_only):
            if size > max_region:
                continue
            try:
                out.append((base, self.read(base, size)))
            except OSError:
                pass
        return out

    def scan(self, pattern: bytes, align: int = 1, snap=None) -> list[int]:
        hits = []
        for base, data in (snap or self.snapshot()):
            i = data.find(pattern)
            while i >= 0:
                if i % align == 0:
                    hits.append(base + i)
                i = data.find(pattern, i + 1)
        return hits

    def scan_i32(self, v, snap=None):
        return self.scan(struct.pack("<i", v), 4, snap)

    def scan_i16(self, v, snap=None):
        return self.scan(struct.pack("<h", v), 2, snap)

    def filter_i32(self, addrs, v):
        out = []
        for a in addrs:
            try:
                if self.i32(a) == v:
                    out.append(a)
            except OSError:
                pass
        return out

    def scan_dwords_near(self, values: list[int], span: int = 64, snap=None, dtype="<i4") -> list[int]:
        """Endereços (alinhados a 4) onde values[0] aparece e todos os outros valores aparecem como dwords até `span`
        bytes adiante. Útil para achar estruturas (ex.: Body/Agility/Mind/Spirit do herói)."""
        res = []
        for base, data in (snap or self.snapshot()):
            n = len(data) // 4 * 4
            arr = np.frombuffer(data[:n], dtype=dtype)
            idx = np.nonzero(arr == values[0])[0]
            w = span // 4
            for i in idx:
                win = arr[i:i + w]
                if all((win == v).any() for v in values[1:]):
                    res.append(base + 4 * int(i))
        return res

    # ------------------------------------------------------------ Scenario.dll (campanha)
    def dll_base(self) -> int:
        ptr = self.u32(KNOWN["exe.ScenarioGetVar_ptr"])
        if not ptr:
            raise RuntimeError("Scenario.dll ainda não carregado")
        return ptr - SCENARIO_GETVAR_RVA

    def var(self, i: int) -> int:
        return self.i32(self.dll_base() + KNOWN["dll.vars_rva"] + 4 * i)

    def set_var(self, i: int, v: int):
        self.write_i32(self.dll_base() + KNOWN["dll.vars_rva"] + 4 * i, v)

    def vars(self) -> list[int]:
        b = self.read(self.dll_base() + KNOWN["dll.vars_rva"], 4096)
        return list(struct.unpack("<1024i", b))

    def current_location(self) -> tuple[int, int, int]:
        """(endereço do objeto, type, id) do local atual."""
        a = self.u32(self.dll_base() + KNOWN["dll.cur_location_rva"])
        if not a:
            return 0, 0, 0
        # Location (construtor 0x100038e0(type, id, x, y, 0, 0)): +0 type (1 missão, 2 cidade), +4 id, +8 x, +12 y
        t, i = struct.unpack("<2i", self.read(a, 8))
        return a, t, i

    def set_current_location(self, rva_key: str):
        self.write_i32(self.dll_base() + KNOWN["dll.cur_location_rva"], self.dll_base() + KNOWN[rva_key])

    # ------------------------------------------------------------ unidades
    def client_units(self, snap=None) -> list[dict]:
        """Todas as unidades do lado cliente (varredura pelo vtable 0x5cd5d0)."""
        res = []
        vt = KNOWN["exe.client_unit_vtable"]
        for base, data in (snap or self.snapshot()):
            a = np.frombuffer(data[: len(data) // 4 * 4], dtype="<u4")
            for i in np.nonzero(a == vt)[0]:
                o = base + 4 * int(i)
                if 0x5EE000 <= o < 0x6D0000:
                    continue  # protótipo estático em .data
                try:
                    b = self.read(o, 0x160)
                except OSError:
                    continue
                x, y = struct.unpack("<ii", b[8:16])
                res.append({"addr": o, "x": x / 256, "y": y / 256,
                            "hp": struct.unpack("<h", b[0x104:0x106])[0],
                            "hpmax": struct.unpack("<h", b[0x108:0x10a])[0],
                            "mana": struct.unpack("<h", b[0x148:0x14a])[0],
                            "stats": list(b[0x144:0x148])})
        return res

    def hero_info(self, body, agility, mind, spirit, snap=None) -> int | None:
        """Ficha servidor do herói (vtable 0x5d0fb8): procura os 4 atributos em i16 em +0x84."""
        for h in self.scan(struct.pack("<4h", body, agility, mind, spirit), 2, snap):
            base = h - HI["body"]
            try:
                if self.u32(base) == KNOWN["exe.human_info_vtable"]:
                    return base
            except OSError:
                pass
        return None

    def dump(self, a, n=128, fmt="i4"):
        b = self.read(a, n)
        arr = np.frombuffer(b[: n // 4 * 4], dtype="<" + fmt)
        lines = []
        for k in range(0, len(arr), 8):
            lines.append(f"{a + 4 * k:08x}: " + " ".join(f"{int(x):6d}" for x in arr[k:k + 8]))
        return "\n".join(lines)
