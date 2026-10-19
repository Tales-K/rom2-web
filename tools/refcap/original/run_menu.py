"""Captura de hover/pressed/Load Game/criacao de personagem no jogo ORIGINAL (frente FIDELIDADE-MENU).

    python run_menu.py --phase menu_nosave     # sem saves: menu com Load Game desabilitado + hover de cada botao
    python run_menu.py --phase menu            # com saves: hover e pressed de cada botao
    python run_menu.py --phase load            # tela Load Game (3 saves), hover/selecao dos slots e botoes; load_many (12 saves), load_nosave
    python run_menu.py --phase chargen         # nomes por personagem, hover das janelas, etapa B de cada classe, hover dos icones

Mesma infraestrutura de run_scenarios.py (dgVoodoo2 em janela; nunca muda o modo do monitor). As posicoes de mouse sao as
mesmas de tools/refcap/scenarios.json (campo "mouse"): o script le o JSON, entao o nosso lado e o original usam o mesmo ponto.
Saida: refs/original/<id>.png + meta.json (campo how com "mouse (x,y)", lido pelo comparador).
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import time
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import capture  # noqa: E402
import flows  # noqa: E402
import states  # noqa: E402
from flows import MOUSE_AWAY, MENU_BTN  # noqa: E402
from input import Input, _mouse, _send, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP  # noqa: E402
from launch import Game, display_mode, list_game_pids  # noqa: E402
from run_scenarios import Ctx, OUT, META, grab_after  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
GAME_DIR = states.GAME_DIR
SCEN = json.load(open(os.path.join(ROOT, "tools", "refcap", "scenarios.json"), encoding="utf-8"))["scenarios"]
BY_ID = {s["id"]: s for s in SCEN}


def pos(sid):
    m = BY_ID[sid].get("mouse")
    if not m:
        raise KeyError(f"cenario {sid} sem campo mouse em scenarios.json")
    return tuple(m)


def shot_at(ctx, sid, how, press=False, wait=0.7):
    """Move o mouse (ou pressiona o botao esquerdo la) e captura. Com press, o botao fica apertado ate release()."""
    x, y = pos(sid)
    ctx.inp.move(x, y, steps=3)
    if press:
        time.sleep(0.15)
        _send(_mouse(MOUSEEVENTF_LEFTDOWN))
    ctx.g.wait(wait)
    ctx.save(sid, capture.grab_stable(ctx.g) if not press else capture.grab(ctx.g), f"{how}; mouse ({x},{y})")


def release_away(ctx):
    """Solta o botao longe do botao do menu (cancela o clique)."""
    ctx.inp.move(*MOUSE_AWAY, steps=3)
    time.sleep(0.1)
    _send(_mouse(MOUSEEVENTF_LEFTUP))
    ctx.g.wait(0.5)


def on_menu(ctx):
    return flows.which_screen(capture.grab(ctx.g)) == "menu"


def recover_menu(ctx):
    for _ in range(4):
        if on_menu(ctx):
            return True
        ctx.inp.key("esc")
        ctx.g.wait(0.8)
    return on_menu(ctx)


# ------------------------------------------------------------------------------------------------ fases
def phase_menu(ctx, nosave):
    g, inp = ctx.g, ctx.inp
    flows.boot_to_menu(g, inp)
    if nosave:
        ctx.save("menu_nosave_main", grab_after(ctx), "menu SEM saves; mouse no canto (1000,750)")
        for sid in [s["id"] for s in SCEN if s["id"].startswith("menu_nosave_hover_")]:
            shot_at(ctx, sid, "hover (sem saves)", wait=0.8)
        return
    ctx.save("menu_main", grab_after(ctx), "menu com saves; mouse no canto (1000,750)")
    for sid in [s["id"] for s in SCEN if s["id"].startswith("menu_hover_")]:
        shot_at(ctx, sid, "hover", wait=0.8)
    for sid in [s["id"] for s in SCEN if s["id"].startswith("menu_press_")]:
        inp.move(*MOUSE_AWAY)
        g.wait(0.4)
        shot_at(ctx, sid, "botao esquerdo APERTADO (sem soltar)", press=True, wait=0.5)
        release_away(ctx)
        if not recover_menu(ctx):
            print("   [aviso] saiu do menu apos press em", sid)
            break


def phase_load(ctx, which="load"):
    """Tela Load Game. Os saves ja foram instalados por main(). Cada cenario (orig_phase == which) reabre a janela do zero:
    clica em Load Game, aplica os cliques de click_before (o 1o, em Load Game, e o proprio abrir), captura."""
    g, inp = ctx.g, ctx.inp
    flows.boot_to_menu(g, inp)
    ids = [s["id"] for s in SCEN if s.get("orig_phase") == which]
    for sid in ids:
        sc = BY_ID[sid]
        inp.move(*MOUSE_AWAY)
        g.wait(0.3)
        inp.click(*MENU_BTN["load_game"])
        g.wait(1.0)
        for cx, cy in sc.get("click_before", [])[1:]:
            inp.click(cx, cy)
            g.wait(0.5)
        how = sc["desc"]
        if sc.get("press"):
            shot_at(ctx, sid, how + " (apertado)", press=True, wait=0.5)
            release_away(ctx)
        else:
            shot_at(ctx, sid, how, wait=0.7)
        # fecha o que estiver aberto: Esc (dialogo de confirmacao) e depois Cancel; volta ao menu
        for _ in range(3):
            if on_menu(ctx):
                break
            inp.key("esc")
            g.wait(0.6)
        if not on_menu(ctx):
            inp.click(633, 523)
            g.wait(0.8)
        if not on_menu(ctx):
            print("   [aviso] nao voltou ao menu apos", sid)
            break


def phase_chargen(ctx):
    g, inp = ctx.g, ctx.inp
    flows.boot_to_menu(g, inp)
    inp.click(*MENU_BTN["new_game"])
    flows.wait_screen(g, "chargen_a", 10)
    g.wait(0.4)
    inp.click(*flows.TIP_CLOSE["chargen_a"])
    g.wait(0.5)
    wins = {"fighter_m": (345, 330), "fighter_f": (405, 330), "mage_f": (620, 370), "mage_m": (685, 370)}
    # 1) hover de cada janela (nao selecionada) e nome padrao ao selecionar
    for k, p in wins.items():
        sid = f"chargen_a_hover_{k}"
        if sid in BY_ID:
            shot_at(ctx, sid, f"chargen etapa A; mouse sobre a janela {k}", wait=0.6)
    seq = ["fighter_f", "mage_f", "mage_m", "fighter_m", "fighter_f", "fighter_f", "mage_m", "mage_m", "fighter_m"]
    for i, k in enumerate(seq):
        inp.click(*wins[k])
        g.wait(0.5)
        inp.move(*MOUSE_AWAY)
        g.wait(0.4)
        sid = f"chargen_a_sel_{i}_{k}"
        ctx.save(sid, capture.grab(g), f"clique na janela {k} (passo {i}); mouse no canto (1000,750)")
    # 2) nome digitado pelo usuario -> troca de personagem
    inp.click(*wins["fighter_m"])
    g.wait(0.4)
    inp.click(*flows.CHARGEN_A.get("name", (420, 560)))  # tabuleta do nome
    g.wait(0.3)
    for _ in range(12):
        inp.key("backspace", after=0.05)
    inp.type_text("Zed")
    g.wait(0.3)
    inp.move(*MOUSE_AWAY)
    g.wait(0.4)
    ctx.save("chargen_a_typed", capture.grab(g), "nome editado para 'Zed' (clique na tabuleta, backspaces, digitado)")
    inp.click(*wins["mage_f"])
    g.wait(0.5)
    inp.move(*MOUSE_AWAY)
    g.wait(0.4)
    ctx.save("chargen_a_typed_then_mage_f", capture.grab(g), "depois de digitar 'Zed', clique na maga: o nome muda?")
    inp.click(*wins["fighter_f"])
    g.wait(0.5)
    inp.move(*MOUSE_AWAY)
    g.wait(0.4)
    ctx.save("chargen_a_typed_then_fighter_f", capture.grab(g), "depois, clique na guerreira")
    # 3) nome vazio e troca de personagem
    inp.click(*(420, 560))
    g.wait(0.3)
    for _ in range(14):
        inp.key("backspace", after=0.05)
    g.wait(0.3)
    inp.move(*MOUSE_AWAY)
    ctx.save("chargen_a_empty", capture.grab(g), "nome apagado (backspace)")
    inp.click(*wins["mage_m"])
    g.wait(0.5)
    inp.move(*MOUSE_AWAY)
    g.wait(0.4)
    ctx.save("chargen_a_empty_then_mage_m", capture.grab(g), "nome vazio e clique no mago: o nome volta?")


def phase_chargen_b(ctx):
    g, inp = ctx.g, ctx.inp
    wins = {"fighter_m": (345, 330), "fighter_f": (405, 330), "mage_f": (620, 370), "mage_m": (685, 370)}
    flows.boot_to_menu(g, inp)
    first = True
    for k, p in wins.items():
        if first:
            inp.click(*MENU_BTN["new_game"])
            flows.wait_screen(g, "chargen_a", 10)
            g.wait(0.4)
            inp.click(*flows.TIP_CLOSE["chargen_a"])
            g.wait(0.4)
            first = False
        inp.click(*p)
        g.wait(0.5)
        inp.click(*flows.CHARGEN_A["ok"])
        flows.wait_screen(g, "chargen_b", 10)
        g.wait(0.4)
        tip = k in ("fighter_m",) or True
        inp.click(*flows.TIP_CLOSE["chargen_b"])
        g.wait(0.5)
        sid = f"chargen_b_{k}"
        ctx.save(sid, grab_after(ctx, wait=0.6), f"etapa B de {k}; mouse no canto (1000,750)")
        icons = [s["id"] for s in SCEN if s["id"].startswith(f"chargen_b_{k}_hover_")]
        for ic in icons:
            shot_at(ctx, ic, BY_ID[ic]["desc"], wait=0.6)
        # clicar num icone (selecao) e capturar com o mouse fora
        for ic in [s["id"] for s in SCEN if s["id"].startswith(f"chargen_b_{k}_pick_")]:
            x, y = pos(ic)
            inp.click(x, y)
            g.wait(0.5)
            inp.move(*MOUSE_AWAY)
            g.wait(0.5)
            ctx.save(ic, capture.grab(g), f"clique em ({x},{y}); mouse no canto (1000,750)")
        # voltar (Back 745,302) e reabrir o menu A
        inp.click(*flows.CHARGEN_B["back"])
        flows.wait_screen(g, "chargen_a", 10)
        g.wait(0.6)


PHASES = {"menu_nosave": lambda c: phase_menu(c, True), "menu": lambda c: phase_menu(c, False), "load": phase_load,
          "load_many": lambda c: phase_load(c, "load_many"), "load_nosave": lambda c: phase_load(c, "load_nosave"),
          "chargen": phase_chargen, "chargen_b": phase_chargen_b}


LOCK = os.path.join(ROOT, "scratch", "refcap.lock")


def acquire_lock(tries=10, wait=60):
    """Uma instancia do jogo por vez (coordenacao entre frentes): scratch/refcap.lock criado de forma atomica."""
    os.makedirs(os.path.dirname(LOCK), exist_ok=True)
    for i in range(tries):
        try:
            fd = os.open(LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, f"run_menu pid {os.getpid()} {time.ctime()}".encode())
            os.close(fd)
            return
        except FileExistsError:
            print(f"   [lock] {LOCK} existe; aguardando {wait}s ({i + 1}/{tries})", flush=True)
            time.sleep(wait)
    raise SystemExit("nao consegui o lock do jogo original")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--phase", required=True, choices=list(PHASES))
    a = ap.parse_args()
    acquire_lock()
    meta = json.load(open(META, encoding="utf-8")) if os.path.exists(META) else {}
    mode0 = display_mode()
    try:
        if a.phase in ("menu_nosave", "load_nosave"):
            states.park_saves()
        elif a.phase == "load_many":
            states.park_saves()
            for i in range(12):
                shutil.copy2(os.path.join(states.SAVES, "plagat_start.sav"), os.path.join(GAME_DIR, f"game{i:04d}.sav"))
        else:
            # varios saves: 3 estados da biblioteca (game0000..2) com nomes distintos
            states.park_saves()
            for i, n in enumerate(["plagat_start", "kaarg_30", "druids_60"]):
                shutil.copy2(os.path.join(states.SAVES, n + ".sav"), os.path.join(GAME_DIR, f"game{i:04d}.sav"))
        with Game(["-window", "-1024"], max_runtime=300) as g:
            ctx = Ctx(g, Input(g), set(), meta)
            ctx.run = "menu_" + a.phase
            g.focus()
            PHASES[a.phase](ctx)
    except Exception:  # noqa: BLE001
        traceback.print_exc()
    finally:
        try:
            meta = {**(json.load(open(META, encoding="utf-8")) if os.path.exists(META) else {}), **meta}  # relê: outras frentes gravam
            json.dump(meta, open(META, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
        finally:
            try:
                os.remove(LOCK)
            except OSError:
                pass
        if display_mode() != mode0:
            print("MODO DO MONITOR MUDOU", display_mode(), mode0)
        print("allods2 restantes:", list_game_pids(), "| modo:", display_mode())


if __name__ == "__main__":
    main()
