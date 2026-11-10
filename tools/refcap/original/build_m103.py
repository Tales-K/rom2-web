"""Missão 103 "The Desert Oracle" (puzzle das alavancas) no ORIGINAL a partir de um save DERIVADO (frente GRUPO-ALAVANCAS, 20/10).

O script da 103 cita Igles (10002) e Dina (10003); num save derivado eles não estão no grupo e o carregador do script cai em
"Can't resolve hero" (0x562274 → 0x562518, busca da unidade com `+0x14c − 0x15 == n` na lista do jogador). Remendo SÓ na memória da
cópia de execução (nunca no disco nem no GOG): `sub ecx,0x2711` de 0x5622e4 vira `xor ecx,ecx` → toda referência de herói especial
(10001..10003) resolve para o herói (n = 0). Os gatilhos das alavancas (17..30) não usam 10002/10003; os que usam passam a medir o
herói (anotado nos resultados). Mais o remendo de desenho do retrato da Dina (build_m110.patch_portrait).

    .venv\\Scripts\\python.exe tools/refcap/original/build_m103.py [--mission 103] [--hero mage|fighter]

Gera m103_town (derivado de plagat_mage: estágio 100, missões 10..100 concluídas, locais [Plagat, missão 103]) e, entrando pelo
portão, grava m103_start (missão recém-iniciada, falas fechadas). `--mission 93` faz o mesmo para a 93/96 (fontes de magia; o
script não cita 10002/10003). Cópia de execução: A2_RUN_DIR (padrão a2_diff, para o relógio virtual dos episódios depois).
"""
from __future__ import annotations

import argparse
import os
import sys
import time

os.environ.setdefault("A2_RUN_DIR", r"C:\Users\TALES K\Games\a2_diff")
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "trace"))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))

import capture  # noqa: E402
import flows  # noqa: E402
import states  # noqa: E402
from build_m110 import handle_boxes, patch_portrait  # noqa: E402
from run_steps import acquire, open_session, release  # noqa: E402

RESOLVE_SUB = 0x5622E4            # sub ecx, 0x2711 (id do herói especial → índice n da busca 0x562518)
RESOLVE_OLD = bytes.fromhex("81e911270000")
RESOLVE_NEW = bytes.fromhex("31c990909090")   # xor ecx, ecx ; 4 × nop → n = 0 (o herói)
DONE = [10, 20, 21, 30, 31, 32, 40, 41, 42, 43, 50, 51, 52, 53, 60, 61, 62, 63, 70, 71, 72, 73, 80, 90, 91, 100]


def patch_code(p, addr: int, old: bytes, new: bytes) -> bool:
    import ctypes
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    cur = p.read(addr, len(old))
    if cur == new:
        return True
    if cur != old:
        print(f"[remendo] {addr:#x}: bytes inesperados {cur.hex()}", flush=True)
        return False
    o = ctypes.c_ulong()
    k32.VirtualProtectEx(p.h, ctypes.c_void_p(addr), len(new), 0x40, ctypes.byref(o))
    p.write(addr, new)
    k32.VirtualProtectEx(p.h, ctypes.c_void_p(addr), len(new), o.value, ctypes.byref(o))
    return p.read(addr, len(new)) == new


def patch_heroes(p) -> bool:
    """Herói especial 10002/10003 → herói (só memória do processo)."""
    ok = patch_code(p, RESOLVE_SUB, RESOLVE_OLD, RESOLVE_NEW)
    print("[remendo] heróis especiais → herói:", ok, flush=True)
    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mission", type=int, default=103)
    ap.add_argument("--hero", default="mage", choices=["mage", "fighter"])
    a = ap.parse_args()
    base = "plagat_mage" if a.hero == "mage" else "plagat_start"
    tag = f"m{a.mission}" + ("" if a.hero == "mage" else "_f")
    town = f"{tag}_town"
    out = os.path.join(ROOT, "scratch", "fm", tag)
    os.makedirs(out, exist_ok=True)
    states.derive_save(base, town, f"Plagat, estágio 100, 10..100 concluídas, locais [Plagat, missão {a.mission}] (derivado de {base})",
                       100, [states.TOWNS["plagat"], states.mission(a.mission)], cur=0,
                       set_vars={769: 1, **states.done_vars(*DONE)}, hero="mage_m" if a.hero == "mage" else "fighter_m")
    if not acquire():
        sys.exit(3)
    closer = None
    try:
        g, inp, closer = open_session(town, 400)
        from memory import Proc
        p = Proc(g.proc.pid)
        patch_heroes(p)
        patch_portrait(p)
        flows.close_tip(g, inp)
        g.wait(0.5)
        inp.click(*flows.TOWN_SPOT["gate"])
        t0 = time.time()
        n = 0
        while time.time() - t0 < 40:
            handle_boxes(g)
            g.wait(1.0)
            img = capture.grab(g)
            pt = flows.find_template(img, "btn_ok", region=(190, 300, 700, 600), thr=9)
            if pt:
                img.save(os.path.join(out, f"dlg_{n}.png"))
                inp.click(*pt)
                n += 1
                t0 = time.time() - 30          # depois da 1ª fala: mais 10 s sem fala = fim
                continue
            if n and flows.sig_diff(img, "mission_hud") < 12:
                g.wait(1.5)
                if not flows.find_template(capture.grab(g), "btn_ok", region=(190, 300, 700, 600), thr=9):
                    break
        print("falas:", n, flush=True)
        inp.move(*flows.MOUSE_AWAY)
        g.wait(0.5)
        capture.grab(g).save(os.path.join(out, "hud.png"))
        states.save_state(g, inp, f"{tag}_start", f"missão {a.mission} recém-iniciada, falas fechadas (derivado via {town}; "
                          "carregar SÓ com o remendo de heróis especiais, build_m103.patch_heroes)",
                          "mission_hud", in_mission=True, stage=100, base=town, needs_patch="heroes")
    finally:
        if closer:
            closer()
        release()
        from launch import list_game_pids
        print("allods2 restantes:", list_game_pids())


if __name__ == "__main__":
    main()
