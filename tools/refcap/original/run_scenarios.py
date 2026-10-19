"""Captura automática dos cenários de tools/refcap/scenarios.json no jogo ORIGINAL.

    python run_scenarios.py                 # todas as execuções (runs) em sequência
    python run_scenarios.py --runs front    # só uma execução (front, shop, briefing, combat, kaarg, druids)
    python run_scenarios.py --only town_default,inn_default

Cada "run" inicia o jogo uma vez (modo janela via dgVoodoo2, ver setup_runtime.py), encadeia vários cenários e o
encerra no fim (finally). Saída: refs/original/<id>.png (1024x768) e refs/original/meta.json (como cada estado foi
alcançado). Pré-requisito: setup_runtime.py já executado.
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
from flows import MOUSE_AWAY  # noqa: E402
from input import Input  # noqa: E402
from launch import Game, display_mode, list_game_pids  # noqa: E402
from memory import Proc  # noqa: E402
import states  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(ROOT, "refs", "original")
META = os.path.join(OUT, "meta.json")

# pontos do mapa da missão 10 logo no início (câmera inicial; herói em ~(110,365))
M10 = {"hero": (110, 362), "terrain": (60, 470), "tree": (272, 455), "hud_blank": (940, 497)}


class Ctx:
    def __init__(self, g, inp, only, meta):
        self.g, self.inp, self.only, self.meta = g, inp, only, meta
        self.run = None
        self.state = None

    def want(self, sid):
        return not self.only or sid in self.only

    def save(self, sid, img, how, **extra):
        os.makedirs(OUT, exist_ok=True)
        img.save(os.path.join(OUT, sid + ".png"))
        self.meta[sid] = {"how": how, "run": self.run, "args": self.g.args,
                          "t_since_launch": round(time.time() - self.g.t_start, 1),
                          "date": time.strftime("%Y-%m-%d %H:%M:%S"), **extra}
        print(f"  [ok] {sid}")

    def save_seq(self, sid, frames, how, **extra):
        for i, (t, img) in enumerate(frames):
            img.save(os.path.join(OUT, f"{sid}_{i:03d}.png"))
        self.meta[sid] = {"how": how, "run": self.run, "args": self.g.args, "frames": len(frames),
                          "t_ms": [round(t * 1000) for t, _ in frames],
                          "date": time.strftime("%Y-%m-%d %H:%M:%S"), **extra}
        print(f"  [ok] {sid} ({len(frames)} quadros)")


def grab_after(ctx, pos=MOUSE_AWAY, wait=0.6, stable=True):
    ctx.inp.move(*pos)
    ctx.g.wait(wait)
    return capture.grab_stable(ctx.g) if stable else capture.grab(ctx.g)


# ------------------------------------------------------------------------------------------- runs
def run_front(ctx):
    """menu -> chargen -> cidade -> taverna (mensageiro) -> portão -> mapa-múndi -> missão 10 (+ save de checkpoint)."""
    g, inp = ctx.g, ctx.inp
    flows.boot_to_menu(g, inp)
    ctx.save("menu_main", grab_after(ctx), "Esc nos vídeos de abertura até o menu; mouse no canto (1000,750)")
    ctx.save("menu_hover_new", grab_after(ctx, flows.MENU_BTN["new_game"], 0.8, stable=False),
             "menu; mouse sobre New Game (445,237)")
    inp.click(*flows.MENU_BTN["new_game"])
    flows.wait_screen(g, "chargen_a", 10)
    g.wait(0.4)
    inp.click(*flows.TIP_CLOSE["chargen_a"])
    ctx.save("chargen_a", grab_after(ctx, wait=0.8, stable=False),
             "New Game; dica fechada (CLOSE 751,296); guerreiro (padrão) selecionado; nome padrão 'Aldor'")
    inp.click(*flows.CHARGEN_A["ok"])
    flows.wait_screen(g, "chargen_b", 10)
    g.wait(0.4)
    inp.click(*flows.TIP_CLOSE["chargen_b"])
    ctx.save("chargen_b_fighter", grab_after(ctx, wait=0.6), "OK (780,585) na 1a tela; dica fechada (583,592)")
    inp.click(*flows.CHARGEN_B["accept"])
    flows.wait_screen(g, "town", 15)
    g.wait(0.8)
    ctx.save("town_tip", grab_after(ctx, wait=0.3, stable=False), "Accept (745,209); cidade com a janela de dica aberta")
    inp.click(*flows.TIP_CLOSE["town"])
    ctx.save("town_default", grab_after(ctx, wait=0.8, stable=False), "cidade após fechar a dica (751,312)")
    ctx.save("town_hover_inn", grab_after(ctx, flows.TOWN_SPOT["inn"], 0.8, stable=False),
             "cidade; mouse sobre a taverna (359,513)")
    ctx.save("town_hover_shop", grab_after(ctx, flows.TOWN_SPOT["shop"], 0.8, stable=False),
             "cidade; mouse sobre a loja (486,450)")
    inp.click(*flows.TOWN_SPOT["inn"])
    flows.wait_screen(g, "inn", 10)
    g.wait(0.8)
    ctx.save("inn_tip", grab_after(ctx, wait=0.3, stable=False), "taverna com a dica aberta")
    inp.click(*flows.TIP_CLOSE["inn"])
    ctx.save("inn_default", grab_after(ctx, wait=0.6, stable=False),
             "taverna, dica fechada (583,312). O original já seleciona o 1o frequentador (mercenário besteiro)")
    inp.click(*flows.INN["card"][2])
    ctx.save("inn_messenger", grab_after(ctx, wait=0.6, stable=False),
             "taverna; clique no 3o cartão (488,592) = mensageiro de Skrakan")
    inp.click(*flows.INN["talk"])
    g.wait(1.0)
    ctx.save("inn_messenger_talk", grab_after(ctx, wait=0.3, stable=False), "Talk (745,255) com o mensageiro: 1a fala")
    n = flows.dismiss_dialogs(g, inp)
    ctx.meta["inn_messenger_talk"]["dialogs_closed"] = n
    flows.inn_exit(g, inp)
    inp.click(*flows.TIP_CLOSE["town"])
    g.wait(0.3)
    inp.click(*flows.TOWN_SPOT["gate"])
    frames, t0 = [], time.time()
    while time.time() - t0 < 15:
        img = capture.grab(g)
        frames.append((time.time() - t0, img))
        if flows.sig_diff(img, "mission_hud") < 12:
            break
        time.sleep(0.08)
    gm = [(t, im) for t, im in frames if flows.sig_diff(im, "globalmap") < 25]
    if gm:
        ctx.save("globalmap", gm[0][1], "portão da cidade (393,299) após falar com o mensageiro: mapa-múndi "
                 "(animação de viagem Plagat -> Rakhl-Uimoir, ~2,5 s, sem clique)")
        ctx.save_seq("globalmap_seq", gm, "mesma animação, quadros a cada ~100 ms")
    flows.wait_screen(g, "mission_hud", 20)
    g.wait(1.0)
    ctx.save("mission10_start", grab_after(ctx, M10["terrain"], 0.8, stable=False),
             "missão 10 recém-carregada; 1a fala do herói aberta; mouse sobre terreno livre (60,470)")
    flows.dismiss_dialogs(g, inp)
    mission_shots(ctx)


def mission_shots(ctx):
    g, inp = ctx.g, ctx.inp
    ctx.save("mission_hud_full", grab_after(ctx, M10["hud_blank"], 0.8, stable=False),
             "missão 10 após fechar as falas; mouse no painel do HUD (940,497)")
    inp.move(*M10["hud_blank"])
    g.wait(0.5)
    ctx.save_seq("mission10_idle", capture.grab_sequence(g, 30, 100),
                 "herói parado no ponto de entrada, 30 quadros a cada 100 ms; mouse no HUD", interval_ms=100)
    ctx.save("mission_cursor_terrain", grab_after(ctx, M10["terrain"], 0.8, stable=False),
             "mouse sobre terreno livre (60,470); cursor desenhado pelo próprio jogo")
    ctx.save("mission_cursor_blocked", grab_after(ctx, M10["tree"], 0.8, stable=False),
             "mouse sobre a árvore grande (272,455)")
    ctx.save("mission_cursor_friend", grab_after(ctx, M10["hero"], 0.8, stable=False),
             "mouse sobre o próprio herói (110,362) — não há NPC aliado perto do início da missão 10")


def clear_msgs(ctx):
    ctx.inp.key("back")  # BACKSPACE apaga as mensagens do canto (ex.: "Game Speed is ...")
    ctx.g.wait(0.2)


def set_speed(ctx, steps):
    """Keypad+/Keypad- (velocidade do jogo, 0..8, normal 4)."""
    for _ in range(abs(steps)):
        ctx.inp.key("add" if steps > 0 else "subtract", after=0.08)


def track_and_hover(ctx, p, hero, unit_addr, n=12):
    """Põe o mouse sobre a unidade `unit_addr` (endereço da unidade cliente) recalculando a cada 50 ms."""
    pos = None
    for _ in range(n):
        hs = flows.hero_screen(ctx.g)
        if hs is None:
            break
        hc = (p.i32(hero + 8) / 256, p.i32(hero + 12) / 256)
        uc = (p.i32(unit_addr + 8) / 256, p.i32(unit_addr + 12) / 256)
        pos = flows.cell_to_screen(hs, hc, uc)
        if not (5 <= pos[0] < 845 and 5 <= pos[1] < 763):
            return None
        ctx.inp.move(*pos)
        time.sleep(0.05)
    return pos


def run_shop(ctx):
    """estado plagat_start -> loja de Plagat."""
    g, inp = ctx.g, ctx.inp
    inp.click(*flows.TOWN_SPOT["shop"])
    g.wait(2.5)
    ctx.save("shop_tip", grab_after(ctx, wait=0.3, stable=False), "estado plagat_start -> loja (486,450); dica aberta")
    inp.click(587, 410)  # CLOSE da dica da loja
    ctx.save("shop_default", grab_after(ctx, wait=0.6, stable=False),
             "estado plagat_start -> loja (486,450); dica fechada (587,410); prateleira inicial = escudos; ouro 1000")


def run_briefing(ctx):
    """estado m10_start -> Esc -> Quest Objectives (o original não tem tela de briefing para a missão 10)."""
    g, inp = ctx.g, ctx.inp
    inp.move(*M10["hud_blank"])
    inp.key("esc")
    g.wait(0.8)
    ctx.save("mission_menu", grab_after(ctx, M10["hud_blank"], 0.4, stable=False), "missão 10, Esc (menu do jogo)")
    inp.click(507, 410)  # Quest Objectives
    g.wait(1.0)
    ctx.save("briefing_10", grab_after(ctx, M10["hud_blank"], 0.4, stable=False),
             "missão 10, Esc -> Quest Objectives: único 'briefing' do original para a missão 10 (o mensageiro da "
             "taverna dá a missão e o portão leva direto à missão, sem tela de briefing)")


def run_combat(ctx):
    """estado m10_start -> anda (velocidade máxima) até a cobra em (27.5,42.5) -> cursor de ataque, monstro
    selecionado, herói ferido (vida da ficha do servidor escrita após o 1o dano real)."""
    g, inp = ctx.g, ctx.inp
    p = Proc.attach(g.proc.pid)
    snap = p.snapshot()
    units = p.client_units(snap)
    hero = next(u["addr"] for u in units if u["stats"] == [40, 25, 17, 36])
    snake = next(u["addr"] for u in units if abs(u["x"] - 27.5) < .1 and abs(u["y"] - 42.5) < .1)
    info = p.hero_info(40, 36, 25, 17, snap)
    hs = flows.hero_screen(g) or (111, 362)
    inp.click(int(hs[0]), int(hs[1]))  # seleciona o herói
    inp.key("1", mods=("ctrl",))
    set_speed(ctx, +4)
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
    set_speed(ctx, -4)
    inp.key("1", mods=("alt",))  # centraliza no herói
    g.wait(0.8)
    clear_msgs(ctx)
    pos = track_and_hover(ctx, p, hero, snake)
    ctx.save("mission_cursor_enemy", capture.grab(g),
             f"estado m10_start; herói levado (velocidade 8, cliques) até ~7 células da cobra (27.5,42.5); herói "
             f"selecionado; mouse sobre a cobra (posição lida da memória e convertida para tela: {pos})")
    inp.click(int(M10["terrain"][0]), int(M10["terrain"][1]), button="right")  # botão direito = desselecionar
    g.wait(0.3)
    if pos:
        inp.click(*pos)
    g.wait(0.6)
    clear_msgs(ctx)
    ctx.save("mission_selected_enemy", grab_after(ctx, M10["hud_blank"], 0.3, stable=False),
             "botão direito (desseleciona) e clique esquerdo sobre a cobra: painel mostra o monstro")
    inp.key("1")  # volta a selecionar o herói (grupo 1)
    t1 = time.time()
    while time.time() - t1 < 20 and p.i16(hero + 0x104) >= p.i16(hero + 0x108):
        g.wait(0.3)
    if info:
        p.write_i16(info + 0x94, p.i16(info + 0x96) // 2)
    g.wait(0.5)
    clear_msgs(ctx)
    ctx.save("mission_hero_hurt", grab_after(ctx, M10["hud_blank"], 0.3, stable=False),
             "depois do 1o dano real (luta com a cobra), escreve vida = vida máx/2 na ficha do servidor do herói "
             "(vtable 0x5d0fb8, +0x94); a cópia para a unidade cliente acontece no próximo evento de vida",
             hero_hp=[p.i16(hero + 0x104), p.i16(hero + 0x108)])


def town_run(town, prefix):
    def fn(ctx):
        g, inp = ctx.g, ctx.inp
        sp = flows.TOWN_SPOTS[town]
        ctx.save(f"town_{prefix}", grab_after(ctx, wait=0.6, stable=False), f"estado {ctx.state}; cidade")
        ctx.save(f"town_{prefix}_hover_inn", grab_after(ctx, sp["inn"], 0.8, stable=False),
                 f"estado {ctx.state}; mouse sobre a taverna {sp['inn']}")
        inp.click(*sp["inn"])
        g.wait(2.5)
        flows.close_tip(g, inp)
        ctx.save(f"inn_{prefix}", grab_after(ctx, wait=0.6, stable=False), f"estado {ctx.state}; taverna (dica fechada)")
        inp.click(*flows.INN["exit"])
        g.wait(2.0)
        flows.close_tip(g, inp)
        inp.click(*sp["shop"])
        g.wait(2.5)
        flows.close_tip(g, inp)
        ctx.save(f"shop_{prefix}", grab_after(ctx, wait=0.6, stable=False), f"estado {ctx.state}; loja (dica fechada)")
        inp.click(745, 320)  # Exit da loja
        g.wait(2.0)
        flows.close_tip(g, inp)
        inp.click(*sp["gate"])
        g.wait(3.0)
        ctx.save(f"globalmap_{prefix}", grab_after(ctx, wait=0.5, stable=False),
                 f"estado {ctx.state}; portão {sp['gate']} -> mapa-múndi Yases (locais = os da lista do save)")
    return fn


# nome -> (estado inicial da biblioteca ou None = jogo novo, função)
RUNS = {
    "front": (None, run_front),
    "shop": ("plagat_start", run_shop),
    "briefing": ("m10_start", run_briefing),
    "combat": ("m10_start", run_combat),
    "kaarg": ("kaarg_30", town_run("kaarg", "kaarg")),
    "druids": ("druids_60", town_run("druids", "druids")),
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", default=",".join(RUNS))
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    only = set(filter(None, a.only.split(",")))
    meta = json.load(open(META, encoding="utf-8")) if os.path.exists(META) else {}
    mode0 = display_mode()
    failures = []
    for rn in a.runs.split(","):
        state, fn = RUNS[rn]
        print(f"== run {rn} (estado {state})")
        try:
            if state:
                states.install(state)
            with Game(["-window", "-1024"], max_runtime=300) as g:
                ctx = Ctx(g, Input(g), only, meta)
                ctx.run, ctx.state = rn, state
                g.focus()
                if state:
                    flows.boot_to_menu(g, ctx.inp)
                    scr = states.load_from_menu(g, ctx.inp, state)
                    if scr in ("town", "other"):
                        flows.close_tip(g, ctx.inp)
                    g.wait(0.3)
                    if scr == "mission_hud":
                        flows.dismiss_dialogs(g, ctx.inp)
                fn(ctx)
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            failures.append((rn, repr(e)))
        finally:
            json.dump(meta, open(META, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
        if display_mode() != mode0:
            print("MODO DO MONITOR MUDOU — parando", display_mode(), mode0)
            break
    print("falhas:", failures, "| allods2 restantes:", list_game_pids(), "| modo:", display_mode())


if __name__ == "__main__":
    main()
