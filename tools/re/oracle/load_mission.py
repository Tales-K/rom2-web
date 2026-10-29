"""Tique 0 do carregador de missão do original, no Unicorn (etapa 9b; docs/briefings/ETAPA9B-CARREGADOR.md).

Parte de uma imagem de retomada (padrão: m10_start_s1_t0, que já tem o servidor, o cliente e o Scenario.dll vivos), chama o
carregador do servidor `Server_StartMap 0x4eb715` (ECX = [0x6044c4], CString "<N>.alm" por valor) como o cliente faz ao começar
uma missão da campanha (0x48c8a3: sprintf "%d.alm", servidor+0x1ac = 0 → mapa, não save) e despeja o estado decodificado
(`export_state.read_state`, o mesmo do dump_ticks/tickcmp) em refs/oracle/load/<N>.json.gz.

HLE próprio desta ferramenta: arquivos de verdade, só leitura, da pasta do jogo (CreateFileA/ReadFile/SetFilePointer/GetFileSize/
CloseHandle/...); escrita continua sem efeito. O resto é o do resume.py.

    PYTHONUTF8=1 .venv/Scripts/python.exe -X utf8 tools/re/oracle/load_mission.py 10 20 [--all] [--image m10_start_s1]
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import struct
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "tools", "refcap", "diff"))
import resume  # noqa: E402
from resume import GAME_PTR, IMAGES, Oracle, OracleError  # noqa: E402
from unicorn import UC_HOOK_CODE  # noqa: E402
from unicorn import x86_const as X  # noqa: E402

GAME_DIR = os.path.join(os.path.expanduser("~"), "Games", "a2_diff")
OUT = os.path.join(ROOT, "refs", "oracle", "load")
SERVER_NEW = 0x4E957B           # construtor do servidor (0x1d0 B; zera [0x68d2dc], [0x68d2c4], [0x670e48], [0x66832c])
SERVER_INIT = 0x4EB356          # servidor: início (data.bin "World Data", contentor das unidades [0x68d2dc], jogadores [0x68d2c4])
START_MAP = 0x4EB715            # servidor: começa um mapa (save se +0x1ac != 0)
CRT_RAND = 0x583290             # rand() do CRT (o Rng do nosso mundo); semente em _tiddata+0x14
CAMPAIGN = 2                    # cliente+0x5d8 na campanha (0x48c8a3: "%d.alm"); 0x4eb356 → +0x74 = 0, +0x70 = 1 (= a imagem)
CSTRING_CTOR = 0x5A1838         # CString::CString(LPCSTR), thiscall
FH0 = 0x4F2E0000                # handles dos arquivos abertos aqui


class Files:
    """Arquivos reais, só leitura, sob GAME_DIR (o caminho do exe pode vir relativo ou absoluto)."""

    def __init__(self, o: Oracle):
        self.o = o
        self.open: dict[int, object] = {}
        self.log: list[str] = []
        self.next = FH0
        self.adopt()

    def adopt(self):
        """Arquivos que o processo já tinha abertos no despejo (os .res): CFile do MFC = {vtable, m_hFile, m_bCloseOnDelete,
        m_strFileName}; acha o par (handle, CString com o caminho) e abre o mesmo arquivo aqui. A posição corrente do arquivo não
        está na imagem: toda leitura do carregador vem depois de um SetFilePointer (conferido: o 1.º acesso falha alto se não)."""
        o = self.o
        for (b, sz, _p, _t) in o.regions:
            if sz > 64 << 20:
                continue
            d = o.read(b, sz)
            for off in range(0, len(d) - 12, 4):
                h, q = struct.unpack_from("<I", d, off)[0], struct.unpack_from("<I", d, off + 8)[0]
                if not (0x100 <= h < 0x1000 and h % 4 == 0 and 0x10000 < q < 0x7FFF0000) or h in self.open:
                    continue
                try:
                    s = o.read(q, 260).split(b"\0", 1)[0].decode("latin-1")
                except Exception:
                    continue
                if s.lower().endswith(".res") and os.path.isfile(s):
                    self.open[h] = open(s, "rb")
                    self.log.append("adotado 0x%x %s" % (h, os.path.basename(s)))

    def _path(self, name: str) -> str | None:
        n = name.replace("/", "\\")
        cands = [n] if os.path.isabs(n) else []
        cands.append(os.path.join(GAME_DIR, os.path.basename(n) if os.path.isabs(n) else n))
        for c in cands:
            if os.path.isfile(c):
                return c
        return None

    def create(self, o, a):                 # CreateFileA(name, access, share, sa, disp, flags, tmpl)
        name = o.read(a[0], 260).split(b"\0", 1)[0].decode("latin-1")
        if a[1] & 0x40000000:                # GENERIC_WRITE: arquivo de log/ficha, como no resume.py
            self.log.append("W " + name)
            return resume.hle.FAKE_FILE
        p = self._path(name)
        self.log.append(("R " if p else "? ") + name)
        if not p:
            o.set_u32(o.teb + 0x34, 2)       # ERROR_FILE_NOT_FOUND
            return 0xFFFFFFFF
        h = self.next
        self.next += 4
        self.open[h] = open(p, "rb")
        return h

    def read(self, o, a):                   # ReadFile(h, buf, n, *read, ovl)
        f = self.open.get(a[0])
        data = f.read(a[2]) if f else b""
        if f is None and a[0] != resume.hle.FAKE_FILE:
            raise OracleError("ReadFile em handle desconhecido 0x%x" % a[0])
        if data:
            o.write(a[1], data)
        if a[3]:
            o.set_u32(a[3], len(data))
        return 1

    def seek(self, o, a):                   # SetFilePointer(h, lo, *hi, how)
        f = self.open.get(a[0])
        if f is None:
            return 0
        lo = struct.unpack("<i", struct.pack("<I", a[1]))[0]
        f.seek(lo, a[3])
        return f.tell()

    def size(self, o, a):                   # GetFileSize(h, *hi)
        f = self.open.get(a[0])
        if f is None:
            return 0
        if a[1]:
            o.set_u32(a[1], 0)
        return os.fstat(f.fileno()).st_size

    def close(self, o, a):
        f = self.open.pop(a[0], None)
        if f:
            f.close()
        return 1

    def find_first(self, o, a):             # FindFirstFileA(pat, *data): nenhum arquivo (só pastas de save/ficha procuram)
        self.log.append("F " + o.read(a[0], 260).split(b"\0", 1)[0].decode("latin-1"))
        o.set_u32(o.teb + 0x34, 2)
        return 0xFFFFFFFF

    def attrs(self, o, a):                  # GetFileAttributesA(name)
        name = o.read(a[0], 260).split(b"\0", 1)[0].decode("latin-1")
        p = self._path(name)
        return 0x80 if p else 0xFFFFFFFF


def _profile_default(o, a):             # GetProfileStringA(app, key, default, buf, n): sem win.ini → o padrão
    d = o.read(a[2], 260).split(b"\0", 1)[0][: max(0, a[4] - 1)] if a[2] else b""
    o.write(a[3], d + b"\0")
    return len(d)


def install(o: Oracle, name: str, nargs: int, fn) -> None:
    """Põe (ou troca) a HLE de `name` em todos os endereços com esse nome (exportações e IAT)."""
    for addr, n in o.names.items():
        if n.split("!", 1)[-1] != name:
            continue
        o.uc.mem_write(addr, b"\xC3" if nargs == 0 else b"\xC2" + struct.pack("<H", 4 * nargs))
        o.handlers[addr] = (n, nargs, fn)


def new_oracle(image: str) -> tuple[Oracle, Files]:
    o = Oracle(os.path.join(IMAGES, image + "_t0"))
    fs = Files(o)
    install(o, "CreateFileA", 7, fs.create)
    install(o, "ReadFile", 5, fs.read)
    install(o, "SetFilePointer", 4, fs.seek)
    install(o, "GetFileSize", 2, fs.size)
    install(o, "CloseHandle", 1, fs.close)
    install(o, "GetFileAttributesA", 1, fs.attrs)
    # data/hora fixas (o log do servidor carimba a hora; nada do estado do jogo depende disso)
    st = struct.pack("<8H", 2026, 10, 4, 29, 12, 0, 0, 0)
    install(o, "GetLocalTime", 1, lambda o, a: o.write(a[0], st))
    install(o, "GetSystemTime", 1, lambda o, a: o.write(a[0], st))
    install(o, "GetTimeZoneInformation", 1, lambda o, a: o.write(a[0], bytes(172)) or 0)   # TIME_ZONE_ID_UNKNOWN, UTC
    install(o, "GetProfileStringA", 5, _profile_default)
    install(o, "FindFirstFileA", 2, fs.find_first)
    install(o, "FindNextFileA", 2, lambda o, a: 0)
    install(o, "FindClose", 1, lambda o, a: 1)
    return o, fs


def cstring(o: Oracle, s: str) -> int:
    """CString do MFC estático com o texto `s`; devolve o ponteiro (o que vai por valor na pilha)."""
    txt = o.heap_alloc(len(s) + 1)
    o.write(txt, s.encode("latin-1") + b"\0")
    slot = o.heap_alloc(4)
    o.call(CSTRING_CTOR, ecx=slot, args=(txt,))
    return o.u32(slot)


def load(mission: int, image: str = "m10_start_s1", verbose: bool = False) -> tuple[Oracle, Files, int]:
    o, fs = new_oracle(image)
    # como o cliente ao começar uma missão (0x48ab76): servidor NOVO (o da imagem fica para trás com o mundo da missão dela)
    srv = o.heap_alloc(0x1D0)
    o.write(srv, bytes(0x1D0))
    o.call(SERVER_NEW, ecx=srv)
    o.set_u32(GAME_PTR, srv)
    r = o.call(SERVER_INIT, ecx=srv, args=(CAMPAIGN,))
    if r != 0:
        raise OracleError("0x4eb356 devolveu %d" % r)
    o.set_u32(srv + 0x6B * 4, 0)             # +0x1ac = 0: mapa, não o game0000.sav (0x48c8a3)
    cs = cstring(o, "%d.alm" % mission)
    # sorteios da carga: a semente antes do 1.º (Rand_SeedTimeGetTime no começo de 0x4eb715) e o sítio de cada um (retorno no chamador
    # de Rand_Inclusive/Rand_One = [ebp+4] no quadro dele) — o nosso carregador recebe a mesma semente e tem de sortear igual
    lr = o.load_rand = {"seed0": None, "draws": 0, "sites": {}}

    def on_rand(uc, addr, size, _):
        if lr["seed0"] is None:
            lr["seed0"] = o.u32(o.meta["tiddata"] + 0x14)
        lr["draws"] += 1
        site = "0x%x" % o.u32(uc.reg_read(X.UC_X86_REG_EBP) + 4)
        lr["sites"][site] = lr["sites"].get(site, 0) + 1
    hk = o.uc.hook_add(UC_HOOK_CODE, on_rand, begin=CRT_RAND, end=CRT_RAND)
    t0 = time.perf_counter()
    r = o.call(START_MAP, ecx=srv, args=(cs,))
    o.uc.hook_del(hk)
    if verbose:
        print("  0x4eb715 -> %d em %.1f s; arquivos: %s" % (r, time.perf_counter() - t0, ", ".join(fs.log)))
    return o, fs, r


def snapshot(o: Oracle, mission: int) -> dict:
    """O tique 0 decodificado, igual a uma linha t=0 de refs/oracle/ticks/<ep>.jsonl.gz (dump_ticks.snap)."""
    import original_episode as oe
    import dump_ticks as D
    from export_state import map_wh, read_state
    srv = resume.EmuServer(o.proc)
    rd = oe.Reader(srv)
    srv.units = resume.unit_list(o)
    st = D.normalize(read_state(o.proc, srv, rd, mission, map_wh(mission)))
    ex, recs = D.ExeTracker().read(o, srv.units)
    for u in st["units"]:
        if u["id"] in recs:
            u["exe"] = recs[u["id"]]
    st["exe"] = ex
    st["load_rand"] = getattr(o, "load_rand", None)
    return {"t": 0, **st}


def missions() -> list[int]:
    d = os.path.join(ROOT, "game", "public", "data", "maps")
    return sorted(int(f[:-5]) for f in os.listdir(d) if f[:-5].isdigit() and f.endswith(".json"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("missions", nargs="*", type=int)
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--image", default="m10_start_s1")
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    for m in missions() if a.all else a.missions:
        try:
            o, fs, r = load(m, a.image)
            if r != 0:
                raise OracleError("0x4eb715 devolveu %d" % r)
            st = snapshot(o, m)
        except OracleError as e:
            print("  missão %3d: %s" % (m, e), flush=True)
            continue
        path = os.path.join(OUT, "%d.json.gz" % m)
        with gzip.open(path, "wt", encoding="utf-8") as fh:
            json.dump(st, fh, separators=(",", ":"))
        lr = st["load_rand"]
        print("  missão %3d: %3d unidades, %2d grupos, %3d sorteios %s -> %s" % (m, len(st["units"]), len(st["groups"]), lr["draws"],
              lr["sites"], os.path.relpath(path, ROOT)), flush=True)


if __name__ == "__main__":
    main()
