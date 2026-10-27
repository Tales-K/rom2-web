"""Despeja a memória do allods2.exe (cópia a2_diff) no TIQUE 0 de episódios do corpus dourado (oráculo por retomada, etapa 1).

Para cada episódio (refs/golden/episodes/<id>/ep.json): carrega o estado pelo F3 e faz o mesmo prelúdio de run_pair.run_orig
(semente, relógio virtual em VTIME0, setup), estaciona a thread principal DENTRO do GATE (a caixa de correio chama Sleep), suspende
todas as threads e grava todas as regiões legíveis comprometidas (heap, pilhas, TEB/PEB, .data, imagens dos módulos não-sistema).
Imagens de DLLs do sistema NÃO são gravadas: no emulador viram armadilhas (export → nome, hle.py).

    PYTHONUTF8=1 .venv/Scripts/python.exe -X utf8 tools/re/oracle/dump_state.py m10_start_s1 m10_mage_s102 m20_start_s203

Saída: refs/oracle/images/<id>_t0/{mem.bin, meta.json} (git-ignorado). mem.bin = sequência de registros
<base u32, size u32, protect u32, type u32, zlen u32> + zlib(bytes). meta.json: episódio, VTIME/DONE, remetente das ordens,
_tiddata, TEB32 da thread principal, módulos, exportações dos módulos do sistema, IAT dos módulos não-sistema, unidades no tique 0.
"""
from __future__ import annotations

import ctypes
import ctypes.wintypes as wt
import json
import os
import struct
import sys
import time
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools", "refcap", "diff"))
import original_episode as oe  # noqa: E402  (define A2_RUN_DIR = a2_diff)
import vclock  # noqa: E402
from orig_mem import TLS_INDEX_PTR, teb32, thread_ids  # noqa: E402
from orig_trace import acquire_lock, release_lock  # noqa: E402

GOLD = os.path.join(ROOT, "refs", "golden", "episodes")
OUT = os.path.join(ROOT, "refs", "oracle", "images")
MEM_COMMIT = 0x1000
MEM_IMAGE = 0x1000000

psapi = ctypes.WinDLL("psapi", use_last_error=True)
k32 = ctypes.WinDLL("kernel32", use_last_error=True)
k32.OpenThread.restype = wt.HANDLE
psapi.EnumProcessModulesEx.argtypes = [wt.HANDLE, ctypes.POINTER(ctypes.c_void_p), wt.DWORD, ctypes.POINTER(wt.DWORD), wt.DWORD]
psapi.GetModuleFileNameExW.argtypes = [wt.HANDLE, ctypes.c_void_p, wt.LPWSTR, wt.DWORD]


class MODULEINFO(ctypes.Structure):
    _fields_ = [("lpBaseOfDll", ctypes.c_void_p), ("SizeOfImage", wt.DWORD), ("EntryPoint", ctypes.c_void_p)]


psapi.GetModuleInformation.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.POINTER(MODULEINFO), wt.DWORD]


def modules(p) -> list[dict]:
    arr = (ctypes.c_void_p * 1024)()
    need = wt.DWORD()
    if not psapi.EnumProcessModulesEx(p.h, arr, ctypes.sizeof(arr), ctypes.byref(need), 0x01):   # LIST_MODULES_32BIT
        raise OSError(ctypes.get_last_error())
    out = []
    for i in range(need.value // ctypes.sizeof(ctypes.c_void_p)):
        hm = arr[i]
        buf = ctypes.create_unicode_buffer(520)
        psapi.GetModuleFileNameExW(p.h, hm, buf, 520)
        mi = MODULEINFO()
        psapi.GetModuleInformation(p.h, hm, ctypes.byref(mi), ctypes.sizeof(mi))
        path = buf.value
        out.append({"name": os.path.basename(path).lower(), "base": mi.lpBaseOfDll, "size": mi.SizeOfImage, "path": path,
                    "system": path.lower().startswith(os.environ.get("SystemRoot", r"C:\Windows").lower())})
    return out


def pe_dirs(p, base: int) -> list[tuple[int, int]]:
    lfanew = p.u32(base + 0x3C)
    nt = base + lfanew
    opt = nt + 0x18
    n = p.u32(opt + 0x5C)
    return [struct.unpack("<II", p.read(opt + 0x60 + 8 * i, 8)) for i in range(n)]


def exports(p, mod: dict) -> dict[int, str]:
    """endereço → 'dll!nome' das exportações (lidas da imagem na memória; encaminhadas ficam de fora: o destino tem nome próprio)."""
    base = mod["base"]
    rva, size = pe_dirs(p, base)[0]
    if not rva:
        return {}
    d = p.read(base + rva, 40)
    nfun, nnames, afun, anames, aord = struct.unpack_from("<IIIII", d, 20)
    funcs = struct.unpack("<%dI" % nfun, p.read(base + afun, 4 * nfun)) if nfun else ()
    names = struct.unpack("<%dI" % nnames, p.read(base + anames, 4 * nnames)) if nnames else ()
    ords = struct.unpack("<%dH" % nnames, p.read(base + aord, 2 * nnames)) if nnames else ()
    out = {}
    named = set()
    for nm, o in zip(names, ords):
        f = funcs[o]
        if not f or rva <= f < rva + size:
            continue
        out.setdefault(base + f, mod["name"] + "!" + p.cstr(base + nm, 80))
        named.add(o)
    for o, f in enumerate(funcs):
        if f and o not in named and not (rva <= f < rva + size):
            out.setdefault(base + f, "%s!#%d" % (mod["name"], o))
    return out


def iat(p, mod: dict) -> list[dict]:
    """IAT de um módulo não-sistema: [{slot, dll, name, value}] (nomes pela OriginalFirstThunk)."""
    base = mod["base"]
    rva, _ = pe_dirs(p, base)[1]
    out = []
    if not rva:
        return out
    a = base + rva
    while True:
        oft, _ts, _fw, name, ft = struct.unpack("<IIIII", p.read(a, 20))
        if not name and not ft:
            break
        dll = p.cstr(base + name, 80).lower()
        src = oft or ft
        i = 0
        while True:
            th = p.u32(base + src + 4 * i)
            if not th:
                break
            nm = "#%d" % (th & 0xFFFF) if th & 0x80000000 else (p.cstr(base + th + 2, 120) if oft else "?")
            slot = base + ft + 4 * i
            out.append({"slot": slot, "dll": dll, "name": nm, "value": p.u32(slot)})
            i += 1
        a += 20
    return out


def suspend_all(pid: int, on: bool) -> int:
    n = 0
    for tid in thread_ids(pid):
        h = k32.OpenThread(0x0002, False, tid)            # THREAD_SUSPEND_RESUME
        if not h:
            continue
        (k32.SuspendThread if on else k32.ResumeThread)(wt.HANDLE(h))
        k32.CloseHandle(wt.HANDLE(h))
        n += 1
    return n


def fpu_state(tid: int) -> dict:
    """Palavras de controle da FPU x87 e do SSE da thread (WOW64_CONTEXT; a thread tem de estar suspensa). O Unicorn começa com
    FPCW = 0 (precisão de 24 bits): sem copiar a da thread, contas em ponto flutuante arredondam diferente (exp do herói, m20)."""
    h = k32.OpenThread(0x0008 | 0x0040, False, tid)          # THREAD_GET_CONTEXT | QUERY_INFORMATION
    if not h:
        raise OSError(ctypes.get_last_error())
    ctx = (ctypes.c_ubyte * 0x2CC)()
    struct.pack_into("<I", ctx, 0, 0x10008 | 0x10020)        # CONTEXT_i386 | FLOATING_POINT | EXTENDED_REGISTERS
    ok = k32.Wow64GetThreadContext(wt.HANDLE(h), ctx)
    k32.CloseHandle(wt.HANDLE(h))
    if not ok:
        raise OSError(ctypes.get_last_error())
    cw, sw, tw = struct.unpack_from("<III", ctx, 0x1C)
    mxcsr = struct.unpack_from("<I", ctx, 0xCC + 24)[0]
    return {"fpcw": cw & 0xFFFF, "fpsw": sw & 0xFFFF, "fptw": tw & 0xFFFF, "mxcsr": mxcsr}


def write_image(p, path: str, skip: list[tuple[int, int]]) -> list[dict]:
    from memory import MBI, kernel32 as mk32
    idx = []
    addr, mbi = 0, MBI()
    regs = []
    while addr < 0x7FFF0000 and mk32.VirtualQueryEx(p.h, ctypes.c_void_p(addr), ctypes.byref(mbi), ctypes.sizeof(mbi)):
        base, size = mbi.BaseAddress or 0, mbi.RegionSize
        if mbi.State == MEM_COMMIT and not (mbi.Protect & 0x100) and (mbi.Protect & 0xFF) not in (0, 1):
            regs.append((base, size, mbi.Type, mbi.Protect))
        addr = base + size
    with open(path, "wb") as fh:
        for base, size, typ, prot in regs:
            if any(b <= base < b + s for b, s in skip):
                continue
            if size > (256 << 20):
                continue
            try:
                data = p.read(base, size)
            except OSError:
                continue
            z = zlib.compress(data, 1)
            fh.write(struct.pack("<IIIII", base, size, prot, typ, len(z)))
            fh.write(z)
            idx.append({"base": base, "size": size, "type": typ, "protect": prot})
    return idx


def park_and_dump(s, out_dir: str, extra: dict) -> dict:
    p, vc = s.p, s.vc
    mods = modules(p)
    sysmods = [m for m in mods if m["system"]]
    exp: dict[int, str] = {}
    for m in sysmods:
        try:
            exp.update(exports(p, m))
        except OSError:
            pass
    iats = {m["name"]: iat(p, m) for m in mods if not m["system"]}
    sleep = next((e["value"] for e in iats.get("allods2.exe", []) if e["name"] == "Sleep"), None)
    if sleep is None:
        sleep = next(a for a, n in exp.items() if n.endswith("!Sleep"))
    tls_idx = p.u32(TLS_INDEX_PTR)
    tds = s.srv.tiddata()
    if len(tds) != 1:
        raise RuntimeError(f"{len(tds)} threads com _tiddata")
    main_tid, td = next(iter(tds.items()))
    teb = teb32(main_tid)
    # estaciona a thread principal: GATE → caixa de correio → Sleep(8000); depois suspende tudo e lê
    c0, m0 = vc.get("CALLS"), vc.get("MAILDONE")
    p.write(vclock.DATA + vclock.OFF["ARGS"], struct.pack("<4I", 8000, 0, 0, 0))
    vc.put("NARGS", 1)
    vc.put("ECX", 0)
    vc.put("FN", sleep)
    t0 = time.perf_counter()
    while vc.get("CALLS") == c0:
        if time.perf_counter() - t0 > 5:
            raise TimeoutError("GATE não chamado")
        time.sleep(0.001)
    time.sleep(0.2)
    clk = vc.snap()
    suspend_all(p.pid, True)
    try:
        fpu = fpu_state(main_tid)
        os.makedirs(out_dir, exist_ok=True)
        idx = write_image(p, os.path.join(out_dir, "mem.bin"), [(m["base"], m["size"]) for m in sysmods])
    finally:
        suspend_all(p.pid, False)
    while vc.get("MAILDONE") == m0:
        if time.perf_counter() - t0 > 20:
            raise TimeoutError("Sleep não voltou")
        time.sleep(0.01)
    meta = {**extra, "clock": clk, "fpu": fpu, "tls_index": tls_idx, "tiddata": td, "main_tid": main_tid, "teb32": teb,
            "modules": mods, "exports": {str(a): n for a, n in exp.items()}, "iat": iats, "regions": idx,
            "sleep_fn": sleep, "dumped": time.strftime("%Y-%m-%d %H:%M:%S")}
    json.dump(meta, open(os.path.join(out_dir, "meta.json"), "w", encoding="utf-8"))
    return meta


def dump_episode(s, eid: str) -> dict:
    ep = json.load(open(os.path.join(GOLD, eid, "ep.json"), encoding="utf-8"))
    state, seed = ep["state"], int(ep["seed"])
    s.load(state, seed)
    vc, rd, srv = s.vc, s.rd, s.srv
    rd.rescan()
    rd.set_seed(seed)
    vc.time_on(oe.VTIME0)
    units = rd.units()
    hero = s.hero_id(units)
    if ep.get("setup"):
        s.setup(ep["setup"], hero)
        units = rd.units()
    t16_0 = srv.time16()
    if t16_0 != ep.get("t16_0", t16_0):
        print(f"   aviso: t16_0 {t16_0} != {ep['t16_0']} do golden", flush=True)
    sender = vc.read_sender()
    extra = {"id": eid, "state": state, "seed": seed, "ticks": ep["ticks"], "hero": hero, "t16_0": t16_0, "tick": srv.tick(),
             "rng": rd.rng(), "sender": sender, "game_ptr": s.p.u32(oe.GAME_PTR), "units0": units}
    out = os.path.join(OUT, f"{eid}_t0")
    t0 = time.perf_counter()
    meta = park_and_dump(s, out, extra)
    mb = os.path.getsize(os.path.join(out, "mem.bin")) / 1e6
    print(f"{eid}: {len(meta['regions'])} regiões, {sum(r['size'] for r in meta['regions']) / 1e6:.0f} MB "
          f"({mb:.0f} MB zlib) em {time.perf_counter() - t0:.1f} s; t16_0={t16_0} rng={extra['rng']}", flush=True)
    return meta


def main():
    ids = sys.argv[1:] or ["m10_start_s1", "m10_mage_s102", "m20_start_s203"]
    acquire_lock("oracle_dump")
    try:
        with oe.Session(1200) as s:
            for eid in ids:
                dump_episode(s, eid)
    finally:
        release_lock()


if __name__ == "__main__":
    main()
