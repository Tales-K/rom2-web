"""Gera (idempotente) os cenarios do Multiplayer ("New Character") em tools/refcap/scenarios.json (frente FIDELIDADE-RESTO, 19/10).

    python tools/refcap/multi_specs.py
    python tools/refcap/original/run_groups.py --group mp_loader --group mp_chargen      # captura o ORIGINAL
    python tools/refcap/run_all.py --only <ids> -- --out docs/COMPARE/resto --shift 0     # nosso + comparacao

Campos: os genericos do nosso lado (`scene`, `click_before`, `pre`, `mouse`, `press`) + `orig_group`/`orig_steps` lidos por
tools/refcap/original/run_groups.py. Coordenadas = pixels do cliente 1024x768 (arte 640x480 + deslocamento 192,144).
O Accept da etapa B do Multiplayer abre no original um aviso do Windows ("DirectPlay") que trava o jogo: NAO e capturado.
"""
from __future__ import annotations

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SC = os.path.join(HERE, "scenarios.json")
AWAY = [1012, 756]
PLATES = {"accept": (746, 183), "delete": (746, 231), "rename": (746, 279), "cancel": (746, 327)}


def build():
    out = []
    first = True
    for nm, (x, y) in PLATES.items():
        out.append(dict(id=f"mp_hover_{nm}", desc=f"Multiplayer (New Character): mouse sobre {nm}",
                        scene="menu", click_before=[[368, 328]], mouse=[x, y],
                        orig_group="mp_loader", orig_start="menu",
                        orig_steps=("click:368,328 wait:1.5 " if first else "rel ") + f"move:{x},{y} wait:1.2"))
        first = False
    for nm, (x, y) in PLATES.items():
        out.append(dict(id=f"mp_press_{nm}", desc=f"Multiplayer (New Character): botao esquerdo apertado sobre {nm}",
                        scene="menu", click_before=[[368, 328]], mouse=[x, y], press=True,
                        orig_group="mp_loader", orig_start="menu", orig_steps=f"rel move:1012,756 wait:0.4 down:{x},{y} wait:0.4"))
    out.append(dict(id="mp_hover_resist", desc="Multiplayer (New Character): mouse sobre o painel verde (dica da resistencia)",
                    scene="menu", click_before=[[368, 328]], mouse=[272, 500],
                    orig_group="mp_loader", orig_start="menu", orig_steps="rel move:272,500 wait:1.3"))
    # criacao em modo Multiplayer (Accept sem personagens)
    chg = [
        ("mp_chargen_a_tip", "Multiplayer > Accept: criacao etapa A com a janela de dica", [], "click:368,328 wait:1.5 click:746,183 wait:1.5 move:1012,756 wait:0.8"),
        ("mp_chargen_a", "Criacao (Multiplayer) etapa A, dica fechada", [["click", 751, 297]], "click:751,297 wait:1 move:1012,756 wait:0.8"),
        ("mp_chargen_a_name", "Criacao (Multiplayer) etapa A, nome 'Tester'", [["click", 751, 297], ["type", "Tester"]], "type:Tester wait:0.6"),
        ("mp_chargen_a_clan", "Criacao (Multiplayer) etapa A, Tab e clan 'Clan'", [["click", 751, 297], ["type", "Tester"], ["key", "Tab"], ["type", "Clan"]], "key:tab type:Clan wait:0.6"),
        ("mp_chargen_b_tip", "Criacao (Multiplayer) etapa B com a janela de dica", [["click", 751, 297], ["type", "Tester"], ["key", "Tab"], ["type", "Clan"], ["key", "enter"]], "key:enter wait:1.5 move:1012,756 wait:0.8"),
        ("mp_chargen_b", "Criacao (Multiplayer) etapa B, dica fechada", [["click", 751, 297], ["type", "Tester"], ["key", "Tab"], ["type", "Clan"], ["key", "enter"], ["click", 584, 592]], "click:584,592 wait:1 move:1012,756 wait:0.8"),
    ]
    for sid, desc, pre, steps in chg:
        sc = dict(id=sid, desc=desc, scene="chargen", scene_params={"multi": True}, settle_ms=1500, mouse=AWAY,
                  orig_group="mp_chargen", orig_start="menu", orig_steps=steps)
        if pre:
            sc["pre"] = pre
        out.append(sc)
    # com um personagem gravado ("Tester|Clan", classe guerreiro padrao): no original o arquivo .a2c vem de refs/original/saves/mp_char_tester.a2c
    # (criado pela propria tela: Accept > Tester > Tab > Clan > Enter > Accept da etapa B); no nosso, os mesmos passos de criacao
    make = [["click", 751, 297], ["type", "Tester"], ["key", "Tab"], ["type", "Clan"], ["key", "enter"], ["click", 584, 592], ["click", 746, 208], ["wait", 2.5]]
    boot = "click:368,328 wait:1.5 "
    char = [
        ("mp_char_home", "Multiplayer com 1 personagem (Tester|Clan escolhido)", [], AWAY, False, boot + "move:1012,756 wait:0.8"),
        ("mp_char_hover_row1", "Multiplayer: mouse sobre a linha do personagem", [], [512, 222], False, "move:512,222 wait:1"),
        ("mp_char_hover_row2", "Multiplayer: mouse sobre a linha New Character", [], [512, 238], False, "move:512,238 wait:1"),
        ("mp_char_sel_new", "Multiplayer: linha New Character clicada (sem personagem escolhido)", [["click", 512, 238]], AWAY, False, "click:512,238 wait:1 move:1012,756 wait:0.8"),
        ("mp_char_sel_char", "Multiplayer: linha do personagem clicada de novo", [["click", 512, 238], ["click", 512, 222]], AWAY, False, "click:512,222 wait:1 move:1012,756 wait:0.8"),
        ("mp_char_hover_dmg", "Multiplayer: mouse sobre a linha DMG da ficha (dica)", [], [276, 478], False, "move:276,478 wait:1.3"),
        ("mp_char_hover_speed", "Multiplayer: mouse sobre a linha SPEED da ficha (dica)", [], [276, 598], False, "move:276,598 wait:1.3"),
        ("mp_char_hover_weight", "Multiplayer: mouse sobre a linha WEIGHT da ficha (sem dica)", [], [276, 563], False, "move:276,563 wait:1.3"),
        ("mp_char_delete_confirm", "Multiplayer: Delete com personagem escolhido (confirmacao)", [["click", 746, 231]], AWAY, False, "click:746,231 wait:1.2 move:1012,756 wait:0.5"),
        ("mp_char_rename", "Multiplayer: Rename (campo do cla)", [["key", "esc"], ["click", 746, 279]], AWAY, False, "key:esc wait:0.8 click:746,279 wait:1 move:1012,756 wait:0.6"),
        ("mp_char_rename_typed", "Multiplayer: Rename, 'Abc' digitado", [["key", "esc"], ["click", 746, 279], ["type", "Abc"]], AWAY, False, "type:Abc wait:0.6"),
        ("mp_char_rename_done", "Multiplayer: Rename confirmado com Enter", [["key", "esc"], ["click", 746, 279], ["type", "Abc"], ["key", "enter"]], AWAY, False, "key:enter wait:1"),
    ]
    for sid, desc, extra, mouse, press, steps in char:
        out.append(dict(id=sid, desc=desc, scene="chargen", scene_params={"multi": True}, settle_ms=1500, mouse=mouse,
                        pre=make + extra, orig_group="mp_char", orig_start="menu", orig_install=["mp_char_tester.a2c"], orig_steps=steps))
    return out


def main():
    d = json.load(open(SC, encoding="utf-8"))
    new = build()
    ids = {s["id"] for s in new}
    d["scenarios"] = [s for s in d["scenarios"] if s["id"] not in ids] + new
    json.dump(d, open(SC, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(f"{len(new)} cenarios gerados; total {len(d['scenarios'])}")


if __name__ == "__main__":
    main()
