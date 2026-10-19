"""Sonda: inicia o jogo, executa uma lista de passos e grava capturas numeradas numa pasta (para descobrir estados).

    python probe.py --out <pasta> --args "-window -1024" --steps "wait:3 shot esc wait:1 shot click:512,400 shot"

Passos: wait:<s> | shot[:nome] | esc/enter/space/<tecla> | key:<tecla> | click:x,y | rclick:x,y | move:x,y |
        type:<texto> | cshot[:nome] (com cursor) | seq:<n>,<ms>
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from launch import Game  # noqa: E402
import capture  # noqa: E402
from input import Input  # noqa: E402


def run_steps(g, inp, steps, out, log):
    n = 0
    for st in steps:
        cmd, _, arg = st.partition(":")
        if cmd == "flow":  # flow:menu | flow:town[=hero] | flow:inn
            import flows
            name, _, par = arg.partition("=")
            if name == "menu":
                flows.boot_to_menu(g, inp)
            elif name == "town":
                flows.new_game_to_town(g, inp, hero=par or "fighter_m")
            elif name == "inn":
                flows.town_to_inn(g, inp)
            elif name == "mission":
                fr = flows.town_to_mission(g, inp, talk_messenger=(par != "notalk"))
                for i, (t, img) in enumerate(fr):
                    img.save(os.path.join(out, f"gm_{i:03d}.png"))
                log.append({"globalmap_frames": [t for t, _ in fr]})
            elif par:
                getattr(flows, name)(g, inp, *[int(v) if v.lstrip("-").isdigit() else v for v in par.split(",")])
            else:
                getattr(flows, name)(g, inp)
        elif cmd == "wait":
            g.wait(float(arg))
        elif cmd in ("shot", "cshot"):
            img = capture.grab(g, draw_cursor=(cmd == "cshot"))
            name = arg or f"{n:03d}"
            img.save(os.path.join(out, name + ".png"))
            log.append({"shot": name, "t": round(time.time() - g.t_start, 2), "blank": capture.is_blank(img)})
            n += 1
        elif cmd in ("click", "rclick", "move"):
            x, y = map(int, arg.split(","))
            if cmd == "move":
                inp.move(x, y, steps=5)
            else:
                inp.click(x, y, button="left" if cmd == "click" else "right")
        elif cmd == "hold":  # hold:<tecla>,<segundos>
            k, sec = arg.split(",")
            inp.key(k, hold=float(sec))
        elif cmd == "type":
            inp.type_text(arg.replace("_", " "))
        elif cmd == "seq":
            k, ms = map(int, arg.split(","))
            for i, (t, img) in enumerate(capture.grab_sequence(g, k, ms)):
                img.save(os.path.join(out, f"seq_{i:03d}.png"))
        else:
            inp.key(arg if cmd == "key" else cmd)
        log.append({"step": st, "t": round(time.time() - g.t_start, 2)})


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--args", default="-window -1024")
    ap.add_argument("--steps", default="wait:5 shot")
    ap.add_argument("--max-runtime", type=float, default=120)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    log: list = []
    with Game(a.args.split(), max_runtime=a.max_runtime) as g:
        log.append({"client": g.client_rect(), "focus": g.focus()})
        inp = Input(g)
        try:
            run_steps(g, inp, a.steps.split(), a.out, log)
        finally:
            log.append({"dialogs": g.dialogs()})
            json.dump(log, open(os.path.join(a.out, "log.json"), "w"), indent=1)
    print(json.dumps(log))

