"""Depurador minimo para descobrir ONDE o allods2.exe cai (violacao de acesso) em estados derivados (frente FIDELIDADE-RESTO, 19/10).

    python crashdbg.py <estado> "<passos de run_steps.py>" [--max 90]

Abre o estado da biblioteca, anexa-se ao processo como depurador (DebugActiveProcess) numa thread e executa os passos (run_steps) na thread
principal. A cada excecao de acesso invalido (0xC0000005) imprime o endereco da instrucao, o tipo/endereco do acesso e a pilha (ebp) do thread
que caiu, reconhecendo se cai no exe, no Scenario.dll (base lida dos eventos de carga) ou em outro modulo. Depois termina o jogo.
So le a memoria do jogo (nao altera nada); a janela do usuario e restaurada pelo winguard como nas outras capturas.
"""
from __future__ import annotations

import ctypes
import ctypes.wintypes as wt
import os
import struct
import sys
import threading
import time
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import run_steps as rs  # noqa: E402
from memory import Proc  # noqa: E402

k32 = ctypes.WinDLL("kernel32", use_last_error=True)
EXCEPTION_DEBUG_EVENT, CREATE_THREAD, CREATE_PROCESS, EXIT_THREAD, EXIT_PROCESS, LOAD_DLL, UNLOAD_DLL, OUTPUT_STRING = 1, 2, 3, 4, 5, 6, 7, 8
DBG_CONTINUE, DBG_EXCEPTION_NOT_HANDLED = 0x00010002, 0x80010001
WOW64_CONTEXT_i386 = 0x00010000
WOW64_CONTEXT_CONTROL = WOW64_CONTEXT_i386 | 1
WOW64_CONTEXT_INTEGER = WOW64_CONTEXT_i386 | 2
THREAD_ALL = 0x1F03FF


class EXC_REC(ctypes.Structure):
    _fields_ = [("ExceptionCode", wt.DWORD), ("ExceptionFlags", wt.DWORD), ("ExceptionRecord", ctypes.c_void_p), ("ExceptionAddress", ctypes.c_void_p),
                ("NumberParameters", wt.DWORD), ("ExceptionInformation", ctypes.c_size_t * 15)]


class EXC_INFO(ctypes.Structure):
    _fields_ = [("ExceptionRecord", EXC_REC), ("dwFirstChance", wt.DWORD)]


class LOAD_DLL(ctypes.Structure):
    _fields_ = [("hFile", wt.HANDLE), ("lpBaseOfDll", ctypes.c_void_p), ("dwDebugInfoFileOffset", wt.DWORD), ("nDebugInfoSize", wt.DWORD),
                ("lpImageName", ctypes.c_void_p), ("fUnicode", wt.WORD)]


class DEBUG_EVENT_U(ctypes.Union):
    _fields_ = [("Exception", EXC_INFO), ("LoadDll", LOAD_DLL), ("raw", ctypes.c_byte * 160)]


class DEBUG_EVENT(ctypes.Structure):
    _fields_ = [("dwDebugEventCode", wt.DWORD), ("dwProcessId", wt.DWORD), ("dwThreadId", wt.DWORD), ("u", DEBUG_EVENT_U)]


class WOW64_CONTEXT(ctypes.Structure):
    _fields_ = [("ContextFlags", wt.DWORD), ("Dr0", wt.DWORD), ("Dr1", wt.DWORD), ("Dr2", wt.DWORD), ("Dr3", wt.DWORD), ("Dr6", wt.DWORD), ("Dr7", wt.DWORD),
                ("FloatSave", ctypes.c_byte * 112), ("SegGs", wt.DWORD), ("SegFs", wt.DWORD), ("SegEs", wt.DWORD), ("SegDs", wt.DWORD),
                ("Edi", wt.DWORD), ("Esi", wt.DWORD), ("Ebx", wt.DWORD), ("Edx", wt.DWORD), ("Ecx", wt.DWORD), ("Eax", wt.DWORD),
                ("Ebp", wt.DWORD), ("Eip", wt.DWORD), ("SegCs", wt.DWORD), ("EFlags", wt.DWORD), ("Esp", wt.DWORD), ("SegSs", wt.DWORD),
                ("ExtendedRegisters", ctypes.c_byte * 512)]


k32.WaitForDebugEvent.argtypes = [ctypes.POINTER(DEBUG_EVENT), wt.DWORD]
k32.ContinueDebugEvent.argtypes = [wt.DWORD, wt.DWORD, wt.DWORD]
k32.OpenThread.restype = wt.HANDLE
k32.Wow64GetThreadContext.argtypes = [wt.HANDLE, ctypes.POINTER(WOW64_CONTEXT)]


def debugger(pid: int, stop: threading.Event, out: list, modules: dict):
    if not k32.DebugActiveProcess(pid):
        out.append(f"DebugActiveProcess falhou ({ctypes.get_last_error()})")
        return
    k32.DebugSetProcessKillOnExit(False)
    ev = DEBUG_EVENT()
    proc = Proc.attach(pid)
    while not stop.is_set():
        if not k32.WaitForDebugEvent(ctypes.byref(ev), 200):
            continue
        status = DBG_CONTINUE
        code = ev.dwDebugEventCode
        if code == LOAD_DLL:
            base = ev.u.LoadDll.lpBaseOfDll
            name = ""
            try:
                ptr = ev.u.LoadDll.lpImageName
                if ptr:
                    p2 = struct.unpack("<I", proc.read(ptr, 4))[0]
                    if p2:
                        name = proc.read(p2, 120).decode("utf-16-le" if ev.u.LoadDll.fUnicode else "latin-1", "ignore").split("\0")[0]
            except Exception:  # noqa: BLE001
                pass
            modules[base] = name
        elif code == EXCEPTION_DEBUG_EVENT:
            r = ev.u.Exception.ExceptionRecord
            status = DBG_EXCEPTION_NOT_HANDLED
            if r.ExceptionCode == 0xC0000005:
                info = {"first": ev.u.Exception.dwFirstChance, "eip": r.ExceptionAddress, "rw": r.ExceptionInformation[0], "addr": r.ExceptionInformation[1]}
                try:
                    h = k32.OpenThread(THREAD_ALL, False, ev.dwThreadId)
                    ctx = WOW64_CONTEXT()
                    ctx.ContextFlags = WOW64_CONTEXT_CONTROL | WOW64_CONTEXT_INTEGER
                    if k32.Wow64GetThreadContext(h, ctypes.byref(ctx)):
                        info["regs"] = {n: getattr(ctx, n) for n in ("Eax", "Ebx", "Ecx", "Edx", "Esi", "Edi", "Ebp", "Esp", "Eip")}
                        chain, ebp = [], ctx.Ebp
                        for _ in range(12):
                            try:
                                nxt, ret = struct.unpack("<II", proc.read(ebp, 8))
                            except Exception:  # noqa: BLE001
                                break
                            chain.append(ret)
                            if nxt <= ebp:
                                break
                            ebp = nxt
                        info["ebp_chain"] = chain
                        try:
                            info["stack"] = struct.unpack("<16I", proc.read(ctx.Esp, 64))
                        except Exception:  # noqa: BLE001
                            pass
                except Exception:  # noqa: BLE001
                    info["ctx_err"] = traceback.format_exc()
                out.append(info)
                if info["first"] == 0 or len(out) >= 3:
                    k32.ContinueDebugEvent(ev.dwProcessId, ev.dwThreadId, status)
                    break
        elif code == EXIT_PROCESS:
            out.append("processo encerrou")
            k32.ContinueDebugEvent(ev.dwProcessId, ev.dwThreadId, status)
            break
        k32.ContinueDebugEvent(ev.dwProcessId, ev.dwThreadId, status)
    k32.DebugActiveProcessStop(pid)


def main():
    state, steps = sys.argv[1], sys.argv[2]
    mx = float(sys.argv[sys.argv.index("--max") + 1]) if "--max" in sys.argv else 90
    if not rs.acquire():
        sys.exit(3)
    closer = None
    out, modules = [], {}
    stop = threading.Event()
    try:
        g, inp, closer = rs.open_session(state, mx)
        th = threading.Thread(target=debugger, args=(g.proc.pid, stop, out, modules), daemon=True)
        th.start()
        time.sleep(1.5)
        r = rs.Runner(g, inp, os.path.join(os.path.dirname(HERE), "..", "..", "scratch", "crashdbg"))
        try:
            r.run(steps.split())
        except Exception as e:  # noqa: BLE001
            print("passos terminaram com:", type(e).__name__, str(e)[:120])
        time.sleep(1.0)
        stop.set()
        th.join(5)
    finally:
        if closer:
            try:
                closer()
            except Exception as e:  # noqa: BLE001
                print("[aviso] fechar:", e)
        rs.release()
    print("modulos:", {hex(k): v for k, v in modules.items() if v})
    for o in out:
        if isinstance(o, dict):
            print({k: (hex(v) if isinstance(v, int) else v) for k, v in o.items() if k not in ("regs", "ebp_chain", "stack")})
            if "regs" in o:
                print(" regs:", {k: hex(v) for k, v in o["regs"].items()})
            if "ebp_chain" in o:
                print(" retornos (ebp):", [hex(v) for v in o["ebp_chain"]])
            if "stack" in o:
                print(" pilha:", [hex(v) for v in o["stack"]])
            if "ctx_err" in o:
                print(o["ctx_err"])
        else:
            print(o)


if __name__ == "__main__":
    main()
