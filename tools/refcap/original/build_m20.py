"""Gera o estado m20_start (missão 20 recém-iniciada, falas fechadas) a partir de m20_town (derivado de plagat_start:
estágio 20, missão 10 concluída, vars[769]=1, locais [Plagat, missão 20]) e guarda as falas iniciais em scratch/fm/m20/dlg_*.png.
As missões 30+ derivadas de saves sem Igles (unidade 10002) falham ("Can't resolve hero 10002" + caixa de erro do exe), por
isso a 2ª missão de referência é a 20. Frente FIDELIDADE-MISSÃO (19/10).

    python build_m20.py
"""
from __future__ import annotations

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))

import capture  # noqa: E402
import flows  # noqa: E402
import states  # noqa: E402
from run_steps import acquire, open_session, release  # noqa: E402

OUT = os.path.join(ROOT, "scratch", "fm", "m20")


def main():
    os.makedirs(OUT, exist_ok=True)
    if not acquire():
        sys.exit(3)
    closer = None
    try:
        g, inp, closer = open_session("m20_town", 300)
        flows.close_tip(g, inp)
        g.wait(0.5)
        inp.click(*flows.TOWN_SPOT["gate"])
        n = 0
        for i in range(12):
            if not flows.wait_dialog(g, inp, 25 if i == 0 else 2.5):
                break
            capture.grab(g).save(os.path.join(OUT, f"dlg_{i}.png"))
            p = flows.find_template(capture.grab(g), "btn_ok", region=(190, 300, 700, 600), thr=9) or (507, 452)
            inp.click(*p)
            g.wait(0.6)
            n += 1
        print("falas:", n)
        inp.move(*flows.MOUSE_AWAY)
        g.wait(0.5)
        capture.grab(g).save(os.path.join(OUT, "hud.png"))
        states.save_state(g, inp, "m20_start", "missão 20 recém-iniciada, falas fechadas (derivado de plagat_start via m20_town)",
                          "mission_hud", in_mission=True, stage=20, base="m20_town")
    finally:
        if closer:
            closer()
        release()
        from launch import list_game_pids
        print("allods2 restantes:", list_game_pids())


if __name__ == "__main__":
    main()
