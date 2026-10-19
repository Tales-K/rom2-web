"""Captura no ORIGINAL dos cenarios de cidade/taverna/Esc/Save/Options definidos por tools/refcap/city_specs.py (campo `orig`).

    python run_city.py [--only id,id] [--state plagat_start] [--prefix town_hover] [--list] [--max-runtime 600]

Agrupa por (estado, start): uma sessao do jogo por grupo (estado da biblioteca -> cidade; start=inn entra na taverna uma vez).
Antes de cada cenario confere se a tela voltou ao "home" (comparacao com a captura inicial); se nao voltou tenta Esc/fechar dica;
se ainda assim nao, reinicia a sessao e segue com os cenarios restantes. Janelas do usuario: minimizadas/restauradas pelo Game (winguard).
Saida: refs/original/<id>.png (ou <id>_000.. em sequencias) + meta.json (how com "mouse (x,y)").
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
from flows import MOUSE_AWAY  # noqa: E402
from input import _mouse, _send, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP  # noqa: E402
from launch import display_mode, list_game_pids  # noqa: E402
from run_scenarios import Ctx, META, OUT  # noqa: E402
from run_steps import acquire, open_session, release  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
SCEN = json.load(open(os.path.join(ROOT, "tools", "refcap", "scenarios.json"), encoding="utf-8"))["scenarios"]
BY_ID = {s["id"]: s for s in SCEN}
KEYS = {"esc": "esc", "enter": "enter", "backspace": "backspace"}


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


def diff_home(ctx, home):
    ctx.inp.move(*MOUSE_AWAY)
    ctx.g.wait(0.4)
    a = np.asarray(capture.grab(ctx.g), dtype=np.int16)[144:624, 192:832]
    h = np.asarray(home, dtype=np.int16)[144:624, 192:832]
    return float(np.abs(a - h).mean())


def ensure_home(ctx, home, thr=3.0):
    d = diff_home(ctx, home)
    if d < thr:
        return
    for how in ("esc", "tip", "esc"):
        if how == "esc":
            ctx.inp.key("esc")
            ctx.g.wait(0.7)
        else:
            flows.close_tip(ctx.g, ctx.inp)
        d = diff_home(ctx, home)
        if d < thr:
            return
    raise Restart(f"nao voltou ao home (diff {d:.1f})")


def capture_one(ctx, s, home):
    sid = s["id"]
    g, inp = ctx.g, ctx.inp
    ensure_home(ctx, home)
    do_steps(ctx, s.get("pre", []))
    m = s.get("mouse")
    how = s["desc"] + "; " + "estado " + s["orig"]["state"] + " " + s["orig"]["start"]
    if m:
        inp.move(*m, steps=3)
        how += f"; mouse ({m[0]},{m[1]})"
    if s.get("press"):
        time.sleep(0.15)
        _send(_mouse(MOUSEEVENTF_LEFTDOWN))
        how += " (botao esquerdo apertado)"
        g.wait(0.5)
        ctx.save(sid, capture.grab(g), how)
        inp.move(*MOUSE_AWAY, steps=3)
        time.sleep(0.1)
        _send(_mouse(MOUSEEVENTF_LEFTUP))
        g.wait(0.5)
    elif s.get("sequence"):
        g.wait(s.get("wait_ms", 700) / 1000)
        frames = capture.grab_sequence(g, s["sequence"], s.get("interval_ms", 83))
        ctx.save_seq(sid, frames, how)
    else:
        g.wait(s.get("wait_ms", 700) / 1000)
        ctx.save(sid, capture.grab_stable(g, max_diff=0.002) if not m else capture.grab(g), how)
    do_steps(ctx, s["orig"].get("post", []))


def enter_inn(ctx, state):
    """Da cidade para a taverna (centro da regiao inn por cidade) e fecha a dica."""
    town = {"plagat_start": "plagat", "kaarg_30": "kaarg", "druids_60": "druids"}[state]
    spot = BY_ID[{"plagat": "town_hover_inn", "kaarg": "town_kaarg_hover_inn", "druids": "town_druids_hover_inn"}[town]]
    ref = json.load(open(os.path.join(ROOT, "refs", "original", "meta.json"), encoding="utf-8")).get(spot["id"], {}).get("how", "")
    pt = flows.TOWN_SPOTS[town]["inn"]
    ctx.inp.click(*pt)
    ctx.g.wait(2.0)
    flows.close_tip(ctx.g, ctx.inp)
    ctx.inp.move(*MOUSE_AWAY)
    ctx.g.wait(0.6)


def run_group(state, start, items, a, meta):
    closer = None
    todo = list(items)
    tries = 0
    while todo and tries < 4:
        tries += 1
        try:
            g, inp, closer = open_session(state, a.max_runtime)
            ctx = Ctx(g, inp, set(), meta)
            ctx.run = f"city_{state}_{start}"
            inp.move(*MOUSE_AWAY)
            g.wait(0.5)
            if start == "inn":
                enter_inn(ctx, state)
            home = capture.grab(g)
            home.save(os.path.join(ROOT, "scratch", "cap2", f"home_{state}_{start}.png"))
            while todo:
                s = todo[0]
                try:
                    capture_one(ctx, s, home)
                    todo.pop(0)
                except Restart as e:
                    print("   [restart]", s["id"], e, flush=True)
                    raise
        except Restart:
            pass
        except Exception:  # noqa: BLE001
            traceback.print_exc()
            if todo:
                print("   [falha em]", todo[0]["id"], flush=True)
                todo.pop(0)   # pula o cenario problematico
        finally:
            if closer:
                try:
                    closer()
                except Exception as e:  # noqa: BLE001
                    print("[aviso] fechar:", e)
                closer = None
            json.dump({**(json.load(open(META, encoding="utf-8")) if os.path.exists(META) else {}), **meta},
                      open(META, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
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
    sel = [s for s in SCEN if "orig" in s and (not only or s["id"] in only) and (not a.state or s["orig"]["state"] == a.state)
           and (not a.prefix or s["id"].startswith(a.prefix))]
    groups: dict = {}
    for s in sel:
        groups.setdefault((s["orig"]["state"], s["orig"]["start"]), []).append(s)
    if a.list:
        for k, v in groups.items():
            print(k, len(v))
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
