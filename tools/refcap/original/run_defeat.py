"""Derrota na missão 10 do ORIGINAL: leva o herói até a cobra, deixa a vida do herói em 1 (ficha do servidor, +0x94) e espera a morte.
Grava as telas em <out>/defeat_NN.png (a cada 0.5 s) até a tela mudar de forma persistente. Frente FIDELIDADE-MISSÃO (19/10).

    python run_defeat.py [--out scratch/fm/defeat]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import capture  # noqa: E402
import flows  # noqa: E402
from memory import Proc  # noqa: E402
from run_scenarios import clear_msgs, set_speed, track_and_hover  # noqa: E402
from run_steps import acquire, open_session, release  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))


class C:
    def __init__(self, g, inp):
        self.g, self.inp = g, inp


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "scratch", "fm", "defeat"))
    ap.add_argument("--seconds", type=float, default=25)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    if not acquire():
        sys.exit(3)
    closer = None
    log = {}
    try:
        g, inp, closer = open_session("m10_start", 400)
        c = C(g, inp)
        p = Proc.attach(g.proc.pid)
        snap = p.snapshot()
        units = p.client_units(snap)
        hero = next(u["addr"] for u in units if u["stats"] == [40, 25, 17, 36])
        snake = next(u["addr"] for u in units if abs(u["x"] - 27.5) < .1 and abs(u["y"] - 42.5) < .1)
        info = p.hero_info(40, 36, 25, 17, snap)
        hs = flows.hero_screen(g) or (111, 362)
        inp.click(int(hs[0]), int(hs[1]))
        inp.key("1", mods=("ctrl",))
        set_speed(c, +4)
        t0 = time.time()
        while time.time() - t0 < 40:
            hc = (p.i32(hero + 8) / 256, p.i32(hero + 12) / 256)
            sc = (p.i32(snake + 8) / 256, p.i32(snake + 12) / 256)
            d = ((sc[0] - hc[0]) ** 2 + (sc[1] - hc[1]) ** 2) ** .5
            if d <= 9:
                break
            hs = flows.hero_screen(g)
            if hs is None:
                inp.key("1", mods=("alt",))
                g.wait(0.5)
                continue
            k = min(1.0, 6 / d)
            tx, ty = flows.cell_to_screen(hs, hc, (hc[0] + (sc[0] - hc[0]) * k, hc[1] + (sc[1] - hc[1]) * k))
            inp.click(max(10, min(840, tx)), max(10, min(760, ty)))
            g.wait(0.8)
        # ataca a cobra e zera a vida da ficha do servidor (a unidade cliente copia a ficha no próximo evento de vida)
        set_speed(c, -4)
        inp.key("1", mods=("alt",))
        g.wait(0.6)
        clear_msgs(type("C", (), {"inp": inp, "g": g})())
        pos = track_and_hover(type("C", (), {"inp": inp, "g": g})(), p, hero, snake)
        log["attack_pos"] = pos
        if pos:
            inp.click(*pos)
        g.wait(0.15)
        if info:
            p.write_i16(info + 0x94, 0)
        inp.move(700, 700)
        i = 0
        t2 = time.time()
        while time.time() - t2 < a.seconds:
            capture.grab(g).save(os.path.join(a.out, f"defeat_{i:02d}.png"))
            log.setdefault("hp", []).append([round(time.time() - t2, 1), p.i16(hero + 0x104)])
            i += 1
            g.wait(0.5)
    except Exception:  # noqa: BLE001
        traceback.print_exc()
    finally:
        json.dump(log, open(os.path.join(a.out, "log.json"), "w"))
        if closer:
            try:
                closer()
            except Exception as e:  # noqa: BLE001
                print("[aviso] fechar:", e)
        release()
        from launch import list_game_pids
        print("allods2 restantes:", list_game_pids())


if __name__ == "__main__":
    main()
