"""Combate no ORIGINAL (missão 10): leva o herói até a cobra, ataca e grava sequências (barras de vida, texto de dano, cursor de ataque,
marca de seleção). Frente FIDELIDADE-MISSÃO (19/10).

    python run_combat.py [--out scratch/fm/combat] [--frames 60] [--ms 100]

Saída: <out>/hover_enemy.png (mouse sobre a cobra), <out>/fight_NNN.png (mapa 0..848 x 0..768, a cada --ms), <out>/log.json
(posição da cobra/herói em células, vida). Usa a trava scratch/refcap.lock.
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
from run_scenarios import clear_msgs, set_speed, track_and_hover, M10  # noqa: E402
from run_steps import acquire, open_session, release  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "scratch", "fm", "combat"))
    ap.add_argument("--prefix", default="fight", help="prefixo dos quadros (ex.: m10_fight_seq -> <out>/m10_fight_seq_NNN.png)")
    ap.add_argument("--full", action="store_true", help="grava a tela inteira 1024x768 (padrao: so o mapa 0..848)")
    ap.add_argument("--frames", type=int, default=60)
    ap.add_argument("--ms", type=int, default=100)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    if not acquire():
        sys.exit(3)
    closer = None
    log = {}
    try:
        g, inp, closer = open_session("m10_start", 400)
        p = Proc.attach(g.proc.pid)
        snap = p.snapshot()
        units = p.client_units(snap)
        hero = next(u["addr"] for u in units if u["stats"] == [40, 25, 17, 36])
        snake = next(u["addr"] for u in units if abs(u["x"] - 27.5) < .1 and abs(u["y"] - 42.5) < .1)
        hs = flows.hero_screen(g) or (111, 362)
        inp.click(int(hs[0]), int(hs[1]))
        inp.key("1", mods=("ctrl",))
        set_speed(type("C", (), {"inp": inp})(), +4)
        t0 = time.time()
        while time.time() - t0 < 40:
            hc = (p.i32(hero + 8) / 256, p.i32(hero + 12) / 256)
            sc = (p.i32(snake + 8) / 256, p.i32(snake + 12) / 256)
            d = ((sc[0] - hc[0]) ** 2 + (sc[1] - hc[1]) ** 2) ** .5
            if d <= 7:
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
        set_speed(type("C", (), {"inp": inp})(), -4)
        inp.key("1", mods=("alt",))
        g.wait(0.8)
        clear_msgs(type("C", (), {"inp": inp, "g": g})())
        pos = track_and_hover(type("C", (), {"inp": inp, "g": g})(), p, hero, snake)
        log["hover_pos"] = pos
        capture.grab(g).save(os.path.join(a.out, "hover_enemy.png"))
        if pos:
            inp.click(*pos)    # ataca
        t1 = time.time()
        log["t"] = []
        for i in range(a.frames):
            target = t1 + i * a.ms / 1000.0
            while time.time() < target:
                time.sleep(0.002)
            log["t"].append(round(time.time() - t1, 3))
            im = capture.grab(g)
            (im if a.full else im.crop((0, 0, 848, 768))).save(os.path.join(a.out, f"{a.prefix}_{i:03d}.png"))
            if i % 10 == 0:
                log.setdefault("hp", []).append([p.i16(hero + 0x104), p.i16(hero + 0x108), p.i16(snake + 0x104), p.i16(snake + 0x108)])
        log["hero_cell"] = [p.i32(hero + 8) / 256, p.i32(hero + 12) / 256]
        log["snake_cell"] = [p.i32(snake + 8) / 256, p.i32(snake + 12) / 256]
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
