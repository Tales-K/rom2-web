"""Estados com o herói MAGO (Gildarius, mago) para a auditoria de magias dentro da missão (frente FIDELIDADE-MISSÃO, 19/10).

    python build_mage.py [--hero mage_m] [--explore]

Cria refs/original/saves/plagat_mage.sav e m10_mage.sav (missão 10 recém-iniciada, falas fechadas). O mensageiro da taverna pode estar em
outro cartão para o mago: a flag --explore só tira fotos da taverna (scratch/fm/mage/*.png) para escolher o cartão.
"""
from __future__ import annotations

import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))

import capture  # noqa: E402
import flows  # noqa: E402
import states  # noqa: E402
from input import Input  # noqa: E402
from launch import Game  # noqa: E402
from run_steps import acquire, release  # noqa: E402

OUT = os.path.join(ROOT, "scratch", "fm", "mage")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hero", default="mage_m")
    ap.add_argument("--card", type=int, default=2)
    ap.add_argument("--explore", action="store_true")
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    if not acquire():
        sys.exit(3)
    try:
        states.park_saves()
        with Game(["-window", "-1024"], max_runtime=300) as g:
            inp = Input(g)
            g.focus()
            flows.boot_to_menu(g, inp)
            flows.new_game_to_town(g, inp, hero=a.hero)
            capture.grab(g).save(os.path.join(OUT, "town.png"))
            if a.explore:
                flows.town_to_inn(g, inp)
                capture.grab(g).save(os.path.join(OUT, "inn.png"))
                return
            states.save_state(g, inp, "plagat_mage", "Plagat logo apos New Game (mago)", "town", hero=a.hero)
            flows.town_to_mission(g, inp, messenger_card=a.card)
            flows.dismiss_dialogs(g, inp)
            capture.grab(g).save(os.path.join(OUT, "m10.png"))
            states.save_state(g, inp, "m10_mage", "missao 10 recem-iniciada (mago), falas fechadas", "mission_hud", hero=a.hero)
    finally:
        release()
        from launch import list_game_pids
        print("allods2 restantes:", list_game_pids())


if __name__ == "__main__":
    main()
