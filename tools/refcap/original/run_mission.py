"""Captura no ORIGINAL os cenarios de MISSAO definidos por tools/refcap/mission_specs.py (campo `orig`).

    python run_mission.py [--only id,id] [--prefix m10_hover] [--state m10_start] [--list] [--max-runtime 600]

Agrupa por (estado, start): uma sessao do jogo por grupo. `start`: mission = o estado ja e a missao (HUD); gate = estado de cidade
(m20_town) -> clica no portao e espera a 1a fala (nao fecha). Antes de cada cenario compara o painel e a barra de inventario com a
tela "home" (mouse em 700,700); se nao voltou, tenta Esc e reinicia a sessao. Passos (`pre`/`post`): click rclick dblclick drag move
key type wait. Saida: refs/original/<id>.png (ou <id>_000.. em sequencias) + meta.json. Trava scratch/refcap.lock.
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

import numpy as np  # noqa: E402

import capture  # noqa: E402
import flows  # noqa: E402
from input import _mouse, _send, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP  # noqa: E402
from launch import display_mode, list_game_pids  # noqa: E402
from run_scenarios import Ctx, META  # noqa: E402
from run_steps import acquire, open_session, release  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
SCEN = json.load(open(os.path.join(ROOT, "tools", "refcap", "scenarios.json"), encoding="utf-8"))["scenarios"]
NEUTRAL = (700, 700)
KEYS = {"esc": "esc", "enter": "enter", "backspace": "backspace", "pause": "pause"}


class Restart(Exception):
    pass


def do_steps(ctx, steps):
    g, inp = ctx.g, ctx.inp
    for st in steps:
        c = st[0]
        if c == "click":
            inp.click(st[1], st[2])
            g.wait(0.35)
        elif c == "rclick":
            inp.click(st[1], st[2], button="right")
            g.wait(0.35)
        elif c == "dblclick":
            inp.click(st[1], st[2])
            inp.click(st[1], st[2])
            g.wait(0.5)
        elif c == "drag":
            x0, y0, x1, y1 = st[1:5]
            inp.move(x0, y0, steps=3)
            time.sleep(0.15)
            _send(_mouse(MOUSEEVENTF_LEFTDOWN))
            time.sleep(0.2)
            inp.move((x0 + x1) // 2, (y0 + y1) // 2, steps=4)
            inp.move(x1, y1, steps=4)
            time.sleep(0.4)
            _send(_mouse(MOUSEEVENTF_LEFTUP))
            g.wait(0.5)
        elif c == "move":
            inp.move(st[1], st[2], steps=3)
        elif c == "key":
            inp.key(KEYS.get(st[1], st[1]))
            g.wait(0.3)
        elif c == "type":
            inp.type_text(st[1])
        elif c == "wait":
            g.wait(float(st[1]))
        else:
            raise ValueError(st)


def region_diff(img, home):
    a = np.asarray(img, dtype=np.int16)
    h = np.asarray(home, dtype=np.int16)
    panel = np.abs(a[:, 848:] - h[:, 848:]).mean()
    strip = np.abs(a[660:, :848] - h[660:, :848]).mean()
    return float(max(panel, strip))


def ensure_home(ctx, home, thr=4.0):
    def d():
        ctx.inp.move(*NEUTRAL)
        ctx.g.wait(0.5)
        return region_diff(capture.grab(ctx.g), home)
    v = d()
    if v < thr:
        return
    for _ in range(2):
        ctx.inp.key("esc")
        ctx.g.wait(0.7)
        v = d()
        if v < thr:
            return
    raise Restart(f"nao voltou ao home (diff {v:.1f})")


def capture_one(ctx, s, home):
    sid = s["id"]
    g, inp = ctx.g, ctx.inp
    if home is not None:
        ensure_home(ctx, home)
    do_steps(ctx, s.get("pre", []))
    m = s.get("mouse")
    how = s["desc"] + "; estado " + s["orig"]["state"] + " " + s["orig"]["start"]
    if m:
        inp.move(*m, steps=3)
        how += f"; mouse ({m[0]},{m[1]})"
    if s.get("press"):
        time.sleep(0.15)
        _send(_mouse(MOUSEEVENTF_LEFTDOWN))
        how += " (botao esquerdo apertado)"
        g.wait(0.5)
        ctx.save(sid, capture.grab(g), how)
        inp.move(*NEUTRAL, steps=3)
        time.sleep(0.1)
        _send(_mouse(MOUSEEVENTF_LEFTUP))
        g.wait(0.5)
    elif s.get("sequence"):
        g.wait(s.get("wait_ms", 700) / 1000)
        frames = capture.grab_sequence(g, s["sequence"], s.get("interval_ms", 100))
        ctx.save_seq(sid, frames, how)
    else:
        g.wait(s.get("wait_ms", 700) / 1000)
        ctx.save(sid, capture.grab(g), how)
    do_steps(ctx, s["orig"].get("post", []))


def start_session(state, start, max_runtime):
    """abre o jogo no estado; para start=gate clica no portao e espera a 1a fala. Devolve (g, inp, closer, home)."""
    g, inp, closer = open_session(state, max_runtime)
    if start == "gate":
        flows.close_tip(g, inp)
        g.wait(0.5)
        inp.click(*flows.TOWN_SPOT["gate"])
        if not flows.wait_dialog(g, inp, 30):
            raise RuntimeError("a 1a fala da missao nao apareceu")
        inp.move(1000, 300)
        g.wait(0.4)
        return g, inp, closer, None
    inp.move(*NEUTRAL)
    g.wait(0.6)
    return g, inp, closer, capture.grab(g)


def run_group(state, start, items, a, meta):
    todo = list(items)
    tries = 0
    while todo and tries < 4:
        tries += 1
        closer = None
        try:
            g, inp, closer, home = start_session(state, start, a.max_runtime)
            ctx = Ctx(g, inp, set(), meta)
            ctx.run = f"mission_{state}_{start}"
            if home is not None:
                home.save(os.path.join(ROOT, "scratch", "fm", f"home_{state}.png"))
            while todo:
                s = todo[0]
                if start == "gate" and s is not todo[0]:
                    raise Restart("gate: uma sessao por cenario")
                try:
                    capture_one(ctx, s, home)
                    todo.pop(0)
                except Restart as e:
                    print("   [restart]", s["id"], e, flush=True)
                    raise
                if start == "gate" and todo:
                    raise Restart("gate: nova sessao para o proximo cenario")
        except Restart:
            pass
        except Exception:  # noqa: BLE001
            traceback.print_exc()
            if todo:
                print("   [falha em]", todo[0]["id"], flush=True)
                todo.pop(0)
        finally:
            if closer:
                try:
                    closer()
                except Exception as e:  # noqa: BLE001
                    print("[aviso] fechar:", e)
            json.dump({**(json.load(open(META, encoding="utf-8")) if os.path.exists(META) else {}), **meta},
                      open(META, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
        if start == "gate":
            tries = 0   # cada cenario `gate` gasta uma sessao de proposito
    return todo


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--state", default="")
    ap.add_argument("--prefix", default="")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--max-runtime", type=float, default=600)
    a = ap.parse_args()
    only = set(filter(None, a.only.split(",")))
    sel = [s for s in SCEN if "orig" in s and s.get("mission") and (not only or s["id"] in only)
           and (not a.state or s["orig"]["state"] == a.state) and (not a.prefix or s["id"].startswith(a.prefix))]
    groups: dict = {}
    for s in sel:
        groups.setdefault((s["orig"]["state"], s["orig"]["start"]), []).append(s)
    if a.list:
        for k, v in groups.items():
            print(k, len(v), [s["id"] for s in v][:6])
        return
    if not acquire():
        print("[trava] nao consegui a trava")
        sys.exit(3)
    mode0 = display_mode()
    meta = json.load(open(META, encoding="utf-8")) if os.path.exists(META) else {}
    try:
        for (state, start), items in groups.items():
            print(f"== {state}/{start}: {len(items)} cenarios", flush=True)
            left = run_group(state, start, items, a, meta)
            if left:
                print("   [nao capturados]", [s["id"] for s in left])
    finally:
        release()
        if display_mode() != mode0:
            print("MODO DO MONITOR MUDOU", display_mode(), mode0)
        print("allods2 restantes:", list_game_pids(), "| modo:", display_mode())


if __name__ == "__main__":
    main()
