"""Inicia o jogo original já num estado da biblioteca (refs/original/saves/index.json).

    python load_state.py <nome> [--shot arquivo.png] [--hold segundos]
    python load_state.py --list

Copia o save para a pasta de execução (único game*.sav), carrega-o pelo menu Load Game e (opcional) captura a tela.
Encerra o jogo no fim. Como biblioteca: `from load_state import open_state` (context manager que devolve (g, inp)).
"""
from __future__ import annotations

import argparse
import contextlib
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import capture  # noqa: E402
import flows  # noqa: E402
import states  # noqa: E402
from input import Input  # noqa: E402
from launch import Game  # noqa: E402


@contextlib.contextmanager
def open_state(name: str, close_tip: bool = True, max_runtime: float = 300):
    states.install(name)
    with Game(["-window", "-1024"], max_runtime=max_runtime) as g:
        inp = Input(g)
        g.focus()
        flows.boot_to_menu(g, inp)
        scr = states.load_from_menu(g, inp, name)
        if close_tip:
            flows.close_tip(g, inp)
        if scr == "mission_hud":
            flows.dismiss_dialogs(g, inp)
        inp.move(*flows.MOUSE_AWAY)
        g.wait(0.4)
        yield g, inp


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("name", nargs="?")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--shot")
    ap.add_argument("--hold", type=float, default=0)
    a = ap.parse_args()
    if a.list or not a.name:
        print(json.dumps(states.index(), indent=1, ensure_ascii=False))
        return
    with open_state(a.name) as (g, inp):
        if a.shot:
            capture.grab(g).save(a.shot)
            print("captura:", a.shot)
        if a.hold:
            g.wait(a.hold)


if __name__ == "__main__":
    main()
