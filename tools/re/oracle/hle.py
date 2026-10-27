"""HLE das importações do sistema para o oráculo por retomada (resume.py).

Cada entrada: nome da API (sem a DLL; aliases do ntdll/kernelbase em ALIAS) → (n.º de argumentos stdcall, tratador(o, args)).
O tratador recebe o Oracle e a lista de argumentos e devolve EAX (None = 0). Importação chamada sem entrada aqui = parada com
erro (o.unhandled), de propósito: toda HLE nova é decisão explícita e vai para notes/oracle-resume.md.
"""
from __future__ import annotations

import struct

M32 = 0xFFFFFFFF
FAKE_FILE = 0x4F1E0000          # "handle" devolvido por CreateFile (escritas viram nada)


def _vtime(o, a):
    return o.vtime()


def _qpc(o, a):
    o.write(a[0], struct.pack("<II", o.vtime(), 0))
    return 1


def _qpf(o, a):
    o.write(a[0], struct.pack("<II", 1000, 0))
    return 1


def _tls_get(o, a):
    o.set_u32(o.teb + 0x34, 0)
    return o.u32(o.teb + 0xE10 + 4 * a[0]) if a[0] < 64 else 0


def _tls_set(o, a):
    o.set_u32(o.teb + 0xE10 + 4 * a[0], a[1])
    return 1


def _heap_alloc(o, a):           # HeapAlloc(heap, flags, size)
    return o.heap_alloc(a[2])


def _heap_realloc(o, a):         # HeapReAlloc(heap, flags, ptr, size)
    return o.heap_realloc(a[2], a[3])


def _heap_size(o, a):            # HeapSize(heap, flags, ptr)
    return o.heap_size(a[2])


def _virtual_alloc(o, a):        # VirtualAlloc(addr, size, type, prot)
    return o.virtual_alloc(a[0], a[1], a[2])


def _written(o, a):              # WriteFile(h, buf, n, *written, ovl)
    if a[3]:
        o.set_u32(a[3], a[2])
    return 1


def _read0(o, a):                # ReadFile(h, buf, n, *read, ovl)
    if a[3]:
        o.set_u32(a[3], 0)
    return 1


def _interlocked(delta):
    def f(o, a):
        v = (o.u32(a[0]) + delta) & M32
        o.set_u32(a[0], v)
        return v
    return f


def _xchg(o, a):
    v = o.u32(a[0])
    o.set_u32(a[0], a[1])
    return v


def _cstr(o, a, maxlen=1 << 16):
    out = bytearray()
    while len(out) < maxlen:
        chunk = o.read(a + len(out), 64)
        z = chunk.find(b"\0")
        if z >= 0:
            return bytes(out + chunk[:z])
        out += chunk
    raise RuntimeError("cadeia sem fim em 0x%x" % a)


def _lstrlen(o, a):
    return len(_cstr(o, a[0])) if a[0] else 0


def _lstrcpy(o, a):              # lstrcpyA(dst, src) -> dst
    o.write(a[0], _cstr(o, a[1]) + b"\0")
    return a[0]


def _lstrcat(o, a):              # lstrcatA(dst, src) -> dst
    o.write(a[0] + len(_cstr(o, a[0])), _cstr(o, a[1]) + b"\0")
    return a[0]


def _set_last_error(o, a):
    o.set_u32(o.teb + 0x34, a[0])


TABLE = {
    # relógio: o mesmo VTIME das cavernas do a2_diff (make_diff_runtime.py), que avança 62/63 ms por tique
    "GetTickCount": (0, _vtime), "timeGetTime": (0, _vtime),
    "QueryPerformanceCounter": (1, _qpc), "QueryPerformanceFrequency": (1, _qpf),
    # TEB / CRT por thread (_getptd 0x58a930: GetLastError, TlsGetValue, SetLastError)
    "TlsGetValue": (1, _tls_get), "TlsSetValue": (2, _tls_set),
    "GetLastError": (0, lambda o, a: o.u32(o.teb + 0x34)), "SetLastError": (1, _set_last_error),
    "GetCurrentThreadId": (0, lambda o, a: o.meta["main_tid"]),
    "EnterCriticalSection": (1, None), "LeaveCriticalSection": (1, None),
    "InitializeCriticalSection": (1, None), "DeleteCriticalSection": (1, None),
    "InterlockedIncrement": (1, _interlocked(1)), "InterlockedDecrement": (1, _interlocked(-1)),
    "InterlockedExchange": (2, _xchg),
    # memória: alocador de avanço numa região nova; liberar não faz nada (o.frees conta)
    "HeapAlloc": (3, _heap_alloc), "HeapReAlloc": (4, _heap_realloc), "HeapSize": (3, _heap_size),
    "HeapFree": (3, lambda o, a: o.heap_free(a[2])),
    "GlobalAlloc": (2, lambda o, a: o.heap_alloc(a[1])), "LocalAlloc": (2, lambda o, a: o.heap_alloc(a[1])),
    "GlobalLock": (1, lambda o, a: a[0]), "GlobalUnlock": (1, lambda o, a: 1),
    "GlobalFree": (1, lambda o, a: o.heap_free(a[0]) and 0), "LocalFree": (1, lambda o, a: o.heap_free(a[0]) and 0),
    "VirtualAlloc": (4, _virtual_alloc), "VirtualFree": (3, lambda o, a: o.virtual_free(a[0], a[1], a[2])),
    # arquivos (ficha a cada 15 s, Server_Log): sucesso vazio
    "CreateFileA": (7, lambda o, a: FAKE_FILE), "WriteFile": (5, _written), "ReadFile": (5, _read0),
    "CloseHandle": (1, lambda o, a: 1), "SetFilePointer": (4, lambda o, a: 0), "FlushFileBuffers": (1, lambda o, a: 1),
    "GetFileType": (1, lambda o, a: 1), "SetEndOfFile": (1, lambda o, a: 1),
    "OutputDebugStringA": (1, None), "Sleep": (1, None),
    # cadeias (CString do MFC estático, 0x5a1977)
    "lstrlen": (1, _lstrlen), "lstrlenA": (1, _lstrlen), "lstrcpy": (2, _lstrcpy), "lstrcpyA": (2, _lstrcpy),
    "lstrcat": (2, _lstrcat), "lstrcatA": (2, _lstrcat),
}

# nomes com que as mesmas funções aparecem nas DLLs reais (encaminhamentos do kernel32)
ALIAS = {
    "RtlEnterCriticalSection": "EnterCriticalSection", "RtlLeaveCriticalSection": "LeaveCriticalSection",
    "RtlInitializeCriticalSection": "InitializeCriticalSection", "RtlDeleteCriticalSection": "DeleteCriticalSection",
    "RtlAllocateHeap": "HeapAlloc", "RtlReAllocateHeap": "HeapReAlloc", "RtlSizeHeap": "HeapSize", "RtlFreeHeap": "HeapFree",
    "RtlGetLastWin32Error": "GetLastError", "RtlSetLastWin32Error": "SetLastError", "RtlRestoreLastWin32Error": "SetLastError",
    "RtlQueryPerformanceCounter": "QueryPerformanceCounter", "RtlQueryPerformanceFrequency": "QueryPerformanceFrequency",
}


def lookup(name: str):
    """'dll!Nome' → (nargs, tratador) ou None."""
    n = name.split("!", 1)[-1]
    n = ALIAS.get(n, n)
    return TABLE.get(n)
