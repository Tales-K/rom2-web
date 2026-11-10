"""ÁUDIO das alavancas no ORIGINAL com o relógio virtual (frente GRUPO-ALAVANCAS, 20/10).

A cópia a2_diff (relógio virtual + caixa de correio) não tem os ganchos de áudio (a2_audio) e as duas cópias usam as mesmas variáveis
em 0x6cdf00 e a folga do exe não comporta as duas cavernas. Aqui os ganchos do make_audio_runtime.py são instalados EM TEMPO DE
EXECUÇÃO numa página alocada no processo (VirtualAllocEx RWX: variáveis + rotina de registro + cavernas; `jmp` de 5 bytes em cada
ponto de gancho, como o RandLog), e o leitor audio_hook.Hook passa a ler esse endereço.

Roteiro (m103_start com o remendo de heróis especiais): herói ao lado de cada alavanca da solução (4, 6, 7, 9 na ordem do script),
pacote USAR (0x24); depois 7 pelo lado errado (liga a 6), Fireball na 9; grava cada pedido de som (quem chamou, volume, pan,
prioridade) com o tique do servidor e a vida das alavancas.

    .venv\\Scripts\\python.exe tools/refcap/diff/levers_audio.py [--out refs/audio/levers_m103.json]
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

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import original_episode as oe  # noqa: E402  (fixa A2_RUN_DIR = a2_diff antes de launch)
sys.path.insert(0, os.path.join(HERE, "..", "original"))
import audio_hook as ah  # noqa: E402
import make_audio_runtime as mar  # noqa: E402
from build_m103 import patch_heroes  # noqa: E402
from build_m110 import patch_portrait  # noqa: E402
from levers_probe import Probe, lever_cells  # noqa: E402

k32 = ctypes.WinDLL("kernel32", use_last_error=True)
k32.VirtualAllocEx.restype = ctypes.c_void_p
k32.VirtualAllocEx.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.c_size_t, wt.DWORD, wt.DWORD]
k32.VirtualProtectEx.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.c_size_t, wt.DWORD, ctypes.POINTER(wt.DWORD)]
k32.FlushInstructionCache.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.c_size_t]


def install_audio_hooks(p) -> int:
    """Instala os 8 ganchos de áudio na memória do processo; devolve o endereço das variáveis (DATA do leitor)."""
    base = k32.VirtualAllocEx(p.h, None, 0x2000, 0x3000, 0x40)
    if not base:
        raise OSError("VirtualAllocEx")
    mar.DATA = base
    ah.DATA = base
    p.write(base, b"\0" * 0x100)
    org = base + 0x100
    common = mar.build_common()
    p.write(org, common)
    at = org + ((len(common) + 15) & ~15)
    sites = []
    for va, stolen, tag in mar.HOOKS:
        cur = p.read(va, len(stolen))
        if cur != stolen:
            raise RuntimeError(f"{va:#x}: bytes inesperados {cur.hex()}")
        cave = mar.build_cave(at, va, stolen, tag, org)
        p.write(at, cave)
        sites.append((va, stolen, at))
        at += (len(cave) + 15) & ~15
    for va, stolen, cave in sites:
        old = wt.DWORD()
        k32.VirtualProtectEx(p.h, va, len(stolen), 0x40, ctypes.byref(old))
        p.write(va, b"\xe9" + struct.pack("<i", cave - (va + 5)) + b"\x90" * (len(stolen) - 5))
        k32.VirtualProtectEx(p.h, va, len(stolen), old.value, ctypes.byref(wt.DWORD()))
        k32.FlushInstructionCache(p.h, va, len(stolen))
    return base


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", default="m103_start")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--out", default=os.path.join(oe.ROOT, "refs", "audio", "levers_m103.json"))
    ap.add_argument("--click", action="store_true", help="cliques REAIS do mouse (herói, depois a alavanca) em vez do pacote injetado")
    a = ap.parse_args()
    cells = lever_cells(103)
    out = {"state": a.state, "events": [], "steps": []}
    oe.acquire_lock("levers_audio")
    try:
        with oe.Session(900) as s:
            patch_heroes(s.p)
            patch_portrait(s.p)
            data = install_audio_hooks(s.p)
            hook = ah.Hook(s.p)
            hook.start_poll(0.01)
            pr = Probe(s)
            s.load(a.state, a.seed)
            s.rd.rescan()
            s.rd.set_seed(a.seed)
            s.vc.time_on(oe.VTIME0)
            SA = pr.structures(cells[1])
            ids = {lid: 0x6000 + lid for lid in cells}

            def hps():
                return {lid: pr.p.i16(SA[sid] + 0x42) for lid, sid in ids.items() if sid in SA}

            h = pr.hero_addr()
            hid = pr.p.u32(h + 4)
            pr.boost(h)
            pr.peace(h)
            pr.grant(h, [2])
            t16_0 = s.srv.time16()
            hook.take()

            def run(label, ticks):
                rows = []
                for k in range(ticks // 2):
                    pr.boost(h)
                    pr.step(2)
                    time.sleep(0.03)                  # o cliente desenha e processa as mensagens do servidor entre os tiques
                    for e in hook.take():
                        e["step"] = s.srv.time16() - t16_0
                        e["label_txt"] = ah.fmt(e)
                        rows.append(e)
                hp = hps()
                out["steps"].append({"label": label, "hp": hp, "sounds": [r["label_txt"] for r in rows if r["tag"] in (1, 8)]})
                out["events"] += [{**r, "phase": label} for r in rows]
                print(f"[{label}] alavancas ligadas: {[k for k, v in hp.items() if v == 0]}", flush=True)
                for r in rows:
                    if r["tag"] in (1, 8):
                        print("   ", r["label_txt"], flush=True)

            if a.click:
                # CLIQUE REAL: vista centrada, clique no herói (seleção) e na alavanca (cursor de uso → pacote 0x24 pelo cliente)
                import capture
                shots = os.path.join(oe.ROOT, "scratch", "fm", "levers_click")
                os.makedirs(shots, exist_ok=True)
                for k, (lid, hx, hy) in enumerate(((10, 27, 81), (7, 20, 73), (9, 23, 81), (6, 17, 73))):
                    if k:
                        s.vc.freeze()
                        s.load(a.state, a.seed)
                        s.rd.rescan()
                        s.vc.time_on(oe.VTIME0)
                        SA.clear()
                        SA.update(pr.structures(cells[1]))
                        h = pr.hero_addr()
                        pr.boost(h)
                        pr.peace(h)
                    # teleporte no servidor e depois TEMPO REAL (com o relógio virtual o cliente não redesenha a nova posição)
                    pr.teleport(h, hx, hy)
                    pr.step(2)
                    s.vc.release()
                    s.g.wait(1.5)
                    s.inp.click(868 + round(hx * 136 / 144), 14 + round(hy * 136 / 144))     # câmera pelo minimapa
                    s.inp.move(*oe.flows.MOUSE_AWAY)
                    s.g.wait(1.5)
                    pr.boost(h)
                    v = hook.view()
                    pos = pr.p.u32(h + 0x10)
                    hx, hy = pr.p.u8(pos), pr.p.u8(pos + 1)
                    print("vista", v, "herói", hx, hy, flush=True)
                    sx, sy = (hx - v["x"]) * 32 + 16, (hy - v["y"]) * 32 - 8      # o sprite fica ~1 célula acima (medido)
                    lx, ly = cells[lid]
                    tx, ty = (lx - v["x"]) * 32 + 18, (ly - v["y"]) * 32 - 14
                    s.inp.click(sx, sy)
                    s.g.wait(0.4)
                    s.inp.move(tx, ty)
                    s.g.wait(0.6)
                    capture.grab(s.g).save(os.path.join(shots, f"c{k}_{lid}_hover.png"))
                    hook.take()
                    before = hps()
                    s.inp.click(tx, ty)
                    rows = []
                    t0 = time.time()
                    while time.time() - t0 < 11:
                        pr.boost(h)
                        time.sleep(0.1)
                        rows += hook.take()
                    hp = hps()
                    lab = f"CLIQUE REAL na alavanca {lid}, herói em ({hx},{hy}) (vista {v['x']},{v['y']}; tela {tx},{ty})"
                    snd = [ah.fmt(r) for r in rows if r["tag"] in (1, 8)]
                    pos = pr.p.u32(h + 0x10)
                    out["steps"].append({"label": lab, "changed": {i: [before[i], hp[i]] for i in hp if hp[i] != before[i]},
                                         "hero_end": [pr.p.u8(pos), pr.p.u8(pos + 1)], "sounds": snd})
                    print(lab, "→ mudou:", out["steps"][-1]["changed"], "herói", out["steps"][-1]["hero_end"], flush=True)
                    for t in snd:
                        print("   ", t, flush=True)
                    capture.grab(s.g).save(os.path.join(shots, f"c{k}_{lid}_after.png"))
                    s.inp.move(*oe.flows.MOUSE_AWAY)
            else:
                run("ocioso", 32)
                for lid, (dx, dy) in ((4, (1, 0)), (6, (1, 0)), (7, (1, 0)), (9, (1, 1))):
                    x, y = cells[lid]
                    pr.teleport(h, x + dx, y + dy)
                    pr.step(2)
                    hook.take()
                    s.vc.command("use", [hid], target=ids[lid])
                    run(f"usar {lid} de ({x + dx},{y + dy})", 48)
                run("depois da solução", 64)
                x, y = cells[7]
                pr.teleport(h, x - 1, y)
                pr.step(2)
                hook.take()
                s.vc.command("use", [hid], target=ids[7])
                run("usar 7 pelo lado oeste (24,73)", 48)
                x, y = cells[9]
                pr.teleport(h, x + 5, y)
                pr.step(2)
                hook.take()
                s.vc.command("cast_point", [hid], x=x, y=y, spell=2)
                run("Fireball na 9", 64)
            hook.stop_poll()
            out["data"] = hex(data)
    finally:
        oe.release_lock()
        os.makedirs(os.path.dirname(a.out), exist_ok=True)
        json.dump(out, open(a.out, "w", encoding="utf-8"), indent=1, default=str)
        print("gravado", a.out)


if __name__ == "__main__":
    main()
