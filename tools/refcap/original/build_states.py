"""Gera a biblioteca de estados (refs/original/saves/) jogando o mínimo e usando a memória do processo.

    python build_states.py                    # todos
    python build_states.py --only plagat_start,m10_start

Estados:
  plagat_start  cidade de Plagat logo após criar o guerreiro padrão (Aldor), dica fechada
  m10_start     missão 10 recém-carregada, falas iniciais fechadas
  kaarg_30      cidade de Kaarg no estágio 30: a partir de plagat_start, escreve vars[768]=30 e o local atual = Kaarg
                (Scenario.dll) e grava; ao carregar, o jogo monta a cidade de Kaarg
"""
from __future__ import annotations

import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import flows  # noqa: E402
import states  # noqa: E402
from input import Input  # noqa: E402
from launch import Game, display_mode, list_game_pids  # noqa: E402
from memory import Proc  # noqa: E402

HERO = {"class": "fighter_m", "name": "Aldor", "body": 40, "agility": 36, "mind": 25, "spirit": 17}


def build_new(only):
    states.park_saves()
    with Game(["-window", "-1024"], max_runtime=200) as g:
        inp = Input(g)
        g.focus()
        flows.boot_to_menu(g, inp)
        flows.new_game_to_town(g, inp)
        p = Proc.attach(g.proc.pid)
        info = {"stage": p.var(768), "location": p.current_location()[1:], "hero": HERO}
        if not only or "plagat_start" in only:
            states.save_state(g, inp, "plagat_start", "Plagat logo após New Game (guerreiro padrão)", "town", **info)
        if not only or "m10_start" in only:
            flows.town_to_mission(g, inp)
            flows.dismiss_dialogs(g, inp)
            states.save_state(g, inp, "m10_start", "missão 10 recém-iniciada (falas fechadas), herói no ponto de entrada",
                              "mission_hud", stage=p.var(768), hero=HERO)


def build_town_from(base, name, stage, loc_key, desc, extra_vars=None):
    states.install(base)
    with Game(["-window", "-1024"], max_runtime=200) as g:
        inp = Input(g)
        g.focus()
        flows.boot_to_menu(g, inp)
        states.load_from_menu(g, inp, base)
        inp.click(*flows.TIP_CLOSE["town"])
        p = Proc.attach(g.proc.pid)
        print("  antes: stage", p.var(768), "local", p.current_location())
        p.set_var(768, stage)
        for k, v in (extra_vars or {}).items():
            p.set_var(int(k), v)
        p.set_current_location(loc_key)
        print("  depois: stage", p.var(768), "local", p.current_location())
        states.save_state(g, inp, name, desc, "town", base=base, stage=stage, location=loc_key,
                          pokes={"768": stage, **(extra_vars or {})}, hero=HERO)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    only = set(filter(None, a.only.split(",")))
    m0 = display_mode()
    try:
        if not only or only & {"plagat_start", "m10_start"}:
            build_new(only)
        if not only or "kaarg_30" in only:
            build_town_from("plagat_start", "kaarg_30", 30, "dll.loc_kaarg_rva",
                            "Kaarg, estágio 30 (memória: vars[768]=30, local atual=Kaarg, a partir de plagat_start)")
    finally:
        print("allods2 restantes:", list_game_pids(), "modo:", display_mode(), "(antes", m0, ")")


if __name__ == "__main__":
    main()
