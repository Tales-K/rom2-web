"""Ablação de um chamador do rand() no ORIGINAL (DIFF-FUZZ fase 6): o site continua sorteando (a sequência do LCG não muda para os
outros), mas o valor que ele RECEBE vira uma constante; roda episódios do corpus e compara o traço com o guardado.
Traço idêntico = o site não importa nesses episódios; diferente = relevante (1ª linha divergente). Grava em refs/golden/sites.json.

    .venv\\Scripts\\python.exe -X utf8 tools/refcap/diff/rand_ablate.py --site 0x56e656 --value 0 --eps m10_start_s1,m20_start_s103

Técnica: o `call wrapper` do site (5 bytes em ret − 5) vira `call caverna`; a caverna repete os argumentos, chama o wrapper original e
troca eax pela constante (mesma convenção de pilha: cdecl para Rand_Inclusive/Rand_One/rand, `ret 4`/`ret 8` para 0x57afd0/0x57aff0).
Remendo só em memória, na cópia a2_diff (nada no disco). Não serve para chamadas de float (0x51fa0c).
"""
from __future__ import annotations

import argparse
import ctypes
import ctypes.wintypes as wt
import datetime
import gzip
import json
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import golden_ingest as gi  # noqa: E402
import original_episode as oe  # noqa: E402
import run_pair as rp  # noqa: E402

GOLD = gi.GOLD
OUT = os.path.join(gi.ROOT, "refs", "trace", "diff", "ablate")
# wrapper → (nº de dwords de argumento repetidos, bytes que o callee limpa)
CONV = {0x51FA25: (1, 0), 0x51FA4E: (1, 0), 0x583290: (0, 0), 0x57AFC0: (0, 0), 0x57AFD0: (1, 4), 0x57AFF0: (2, 8)}


def cave_code(base: int, wrapper: int, value: int) -> bytes:
    nargs, clean = CONV[wrapper]
    c = bytearray()
    for _ in range(nargs):
        c += bytes.fromhex("ff7424") + bytes([4 * nargs])      # push dword [esp + 4·nargs] (repete os argumentos na ordem)
    c += b"\xe8" + struct.pack("<i", wrapper - (base + len(c) + 5))
    if clean == 0 and nargs:
        c += bytes.fromhex("83c4") + bytes([4 * nargs])         # add esp, 4·nargs (cdecl)
    c += b"\xb8" + struct.pack("<i", value)                     # mov eax, valor
    c += (b"\xc2" + struct.pack("<H", clean)) if clean else b"\xc3"
    return bytes(c)


def patch(p, site: int, value: int) -> int:
    call_at = site - 5
    cur = p.read(call_at, 5)
    if cur[0] != 0xE8:
        raise RuntimeError(f"{call_at:#x} não é call: {cur.hex()}")
    wrapper = (call_at + 5 + struct.unpack("<i", cur[1:])[0]) & 0xFFFFFFFF
    if wrapper not in CONV:
        raise RuntimeError(f"wrapper {wrapper:#x} sem convenção conhecida")
    k = ctypes.WinDLL("kernel32", use_last_error=True)
    k.VirtualAllocEx.restype = ctypes.c_void_p
    k.VirtualAllocEx.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.c_size_t, wt.DWORD, wt.DWORD]
    k.VirtualProtectEx.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.c_size_t, wt.DWORD, ctypes.POINTER(wt.DWORD)]
    base = k.VirtualAllocEx(p.h, None, 0x1000, 0x3000, 0x40)
    p.write(base, cave_code(base, wrapper, value))
    old = wt.DWORD()
    k.VirtualProtectEx(p.h, call_at, 5, 0x40, ctypes.byref(old))
    p.write(call_at, b"\xe8" + struct.pack("<i", base - (call_at + 5)))
    k.VirtualProtectEx(p.h, call_at, 5, old.value, ctypes.byref(wt.DWORD()))
    return wrapper


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--site", required=True)
    ap.add_argument("--value", type=int, required=True)
    ap.add_argument("--eps", required=True)
    a = ap.parse_args()
    site = int(a.site, 16)
    os.makedirs(OUT, exist_ok=True)
    res = []
    oe.acquire_lock("rand_ablate")
    try:
        with oe.Session(1800) as s:
            wrapper = None
            for eid in a.eps.split(","):
                ep = json.load(open(os.path.join(GOLD, "episodes", eid, "ep.json"), encoding="utf-8"))
                if wrapper is None:
                    s.load(ep["state"], ep["seed"])             # código carregado; remenda uma vez para a sessão
                    wrapper = patch(s.p, site, a.value)
                pre = os.path.join(OUT, f"{eid}_{site:x}_{a.value}")
                rp.run_orig(s, {"state": ep["state"], "seed": ep["seed"], "ticks": ep["ticks"], "actions": ep["script"], "name": eid}, pre)
                new = gi.compact_orig(gi.read_jsonl(pre + "_orig.jsonl")).split(b"\n")
                old = gzip.open(os.path.join(GOLD, "episodes", eid, "orig.jsonl.gz")).read().split(b"\n")
                k = next((i for i in range(min(len(new), len(old))) if new[i] != old[i]), None)
                r = {"ep": eid, "identical": k is None and len(new) == len(old), "first_diff_line": k,
                     "first_diff_step": json.loads(new[k])["s"] if k else None}
                print(json.dumps(r), flush=True)
                res.append(r)
    finally:
        oe.release_lock()
    sp = os.path.join(GOLD, "sites.json")
    sj = json.load(open(sp, encoding="utf-8")) if os.path.exists(sp) else {"sites": {}}
    e = sj["sites"].setdefault(f"0x{site:x}", {})
    e.setdefault("ablations", []).append({"value": a.value, "wrapper": f"0x{wrapper:x}", "results": res,
                                          "at": datetime.datetime.now().isoformat(timespec="seconds")})
    # traço diferente já no passo 0 = estado de animação sorteado pelo carregador (não determinístico entre cargas): não conta
    rel = [r for r in res if not r["identical"] and r["first_diff_step"]]
    same = [r for r in res if r["identical"]]
    e["class"] = "relevante" if rel else ("irrelevante" if same else "indeterminado")
    e["class_note"] = (f"ablação valor {a.value}: {len(rel)} com traço diferente depois do passo 0, {len(same)} idênticos, "
                       f"{len(res) - len(rel) - len(same)} indeterminados (passo 0 = carregador)"
                       + (" (só vale para estes episódios)" if not rel else ""))
    json.dump(sj, open(sp, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print("classe:", e["class"], "-", e["class_note"])


if __name__ == "__main__":
    main()
