"""Gera (idempotente) os cenarios DENTRO DA MISSAO em tools/refcap/scenarios.json (frente FIDELIDADE-MISSAO, 19/10).

    python tools/refcap/mission_specs.py

Campos de cada cenario novo:
  mission  = id da missao do NOSSO jogo (10 ou 20) aberta por startMission (falas fechadas, simulacao pausada); `keep_dialogs`
             deixa a 1a fala aberta; `deselect` tira a selecao (missao 20 do original comeca sem unidade selecionada)
  pre / post = passos ["click",x,y] ["rclick",x,y] ["dblclick",x,y] ["drag",x0,y0,x1,y1] ["move",x,y] ["key",k] ["type",t]
               ["wait",s] — a MESMA lista vale para o original (tools/refcap/original/run_mission.py) e para o nosso (genericRecipe)
  mouse / press / wait_ms / sequence : como em notes/compare.md
  roi      = [x0,y0,x1,y1] da interface comparada (compare.py calcula o SSIM so la dentro, sem deslocamento global)
  orig     = {state, start, post} lido por run_mission.py (state da biblioteca refs/original/saves; start = mission | gate)
Coordenadas = pixels do cliente 1024x768.
"""
from __future__ import annotations

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SC = os.path.join(HERE, "scenarios.json")

NEUTRAL = [700, 700]                  # fora do herói e do painel (escuro, nevoa)
PANEL = [848, 0, 1024, 768]
BAG = (881, 455)                      # mochila fechada/aberta
BOOK = (880, 258)                     # livro de magias
GOLD = (100, 715)                     # 1a celula da barra de inventario (ouro)
EMPTY_SLOT = (300, 715)
DROP_OK, DROP_CANCEL = (202, 695), (297, 695)
STRIP = [0, 660, 1024, 768]           # barra de inventario
MENU_ITEMS = [(508, 290 + 30 * i) for i in range(7)]   # Save, Load, Game Options, Sound, Quest Objectives, End Quest, Return
MENU_NAMES = ["save", "load", "gameopt", "sound", "quest", "endquest", "return"]
CMD = lambda i: (889 + 34 * (i % 4), 182 + 34 * (i // 4))   # centro do botao i da barra de comandos
CMD_NAMES = ["attack", "move", "guard", "defend", "cast", "swarm", "stand", "retreat"]
MENU_ROI = [360, 230, 660, 530]   # janela do menu 288x288 (centrada, 4 px acima/esquerda)
DLG_ROI = [260, 260, 760, 500]
HINT_ROI = [560, 100, 1024, 330]


def o(state, start="mission", post=None):
    d = {"state": state, "start": start}
    if post:
        d["post"] = post
    return d


def build():
    S = []

    def add(id, desc, state="m10_start", start="mission", mission=10, post=None, **kw):
        d = {"id": id, "desc": desc, "mission": mission}
        d.update(kw)
        d["orig"] = o(state, start, post)
        S.append(d)

    # ------------------------------------------------------------------ HUD (missao 10: heroi selecionado)
    add("m10_hud", "Missao 10, HUD completo, mouse fora (700,700)", mouse=NEUTRAL, roi=PANEL)
    for i, nm in enumerate(CMD_NAMES):
        add(f"m10_hover_cmd_{nm}", f"Missao 10: mouse sobre o botao {nm} da barra de comandos (etiqueta)", mouse=list(CMD(i)), wait_ms=900,
            roi=[848, 100, 1024, 330] if i % 4 else HINT_ROI)
    for i in (0, 5):
        add(f"m10_press_cmd_{CMD_NAMES[i]}", f"Missao 10: botao {CMD_NAMES[i]} apertado", mouse=list(CMD(i)), press=True, wait_ms=500, roi=PANEL)
    add("m10_hover_book", "Missao 10: mouse sobre o livro de magias da moldura", mouse=list(BOOK), wait_ms=900, roi=[560, 200, 1024, 330])
    add("m10_hover_bag", "Missao 10: mouse sobre a mochila da moldura", mouse=list(BAG), wait_ms=900, roi=[560, 400, 1024, 520])
    add("m10_hover_minimap", "Missao 10: mouse sobre o minimapa", mouse=[930, 80], wait_ms=900, roi=PANEL)
    add("m10_hover_portrait", "Missao 10: mouse sobre o retrato", mouse=[936, 350], wait_ms=900, roi=PANEL)
    add("m10_hover_stats", "Missao 10: mouse sobre o painel de atributos", mouse=[900, 590], wait_ms=900, roi=[560, 500, 1024, 768])
    add("m10_book_open", "Missao 10: livro de magias aberto (guerreiro, sem magias)", pre=[["click", *BOOK], ["wait", 0.5]], mouse=NEUTRAL,
        post=[["click", *BOOK]], roi=[0, 640, 1024, 768])
    # ------------------------------------------------------------------ inventario e "Drop money"
    bag = [["click", *BAG], ["wait", 0.6]]
    add("m10_bag_open", "Missao 10: mochila aberta (barra de inventario, ouro 1000)", pre=bag, mouse=NEUTRAL, post=[["click", *BAG]], roi=STRIP)
    add("m10_bag_hover_gold", "Missao 10: mochila, mouse sobre o ouro (etiqueta MONEY)", pre=bag, mouse=list(GOLD), wait_ms=900,
        post=[["click", *BAG]], roi=STRIP)
    add("m10_bag_hover_empty", "Missao 10: mochila, mouse sobre celula vazia (etiqueta)", pre=bag, mouse=list(EMPTY_SLOT), wait_ms=900,
        post=[["click", *BAG]], roi=STRIP)
    drop = bag + [["dblclick", *GOLD], ["wait", 0.7]]
    after_drop = [["click", *DROP_CANCEL], ["wait", 0.4], ["click", *BAG]]
    add("m10_drop_money", "Missao 10: duplo clique no ouro -> 'How much gold do you want to drop?' (campo 0)", pre=drop, mouse=NEUTRAL,
        post=after_drop, roi=[60, 540, 440, 768])
    add("m10_drop_money_typed", "Missao 10: Drop money com 250 digitado", pre=drop + [["type", "250"], ["wait", 0.3]], mouse=NEUTRAL,
        post=after_drop, roi=[60, 540, 440, 768])
    add("m10_drop_hover_ok", "Missao 10: Drop money, mouse sobre Ok", pre=drop, mouse=list(DROP_OK), wait_ms=700, post=after_drop, roi=[60, 540, 440, 768])
    add("m10_drop_press_ok", "Missao 10: Drop money, botao Ok apertado", pre=drop, mouse=list(DROP_OK), press=True, wait_ms=500, post=after_drop,
        roi=[60, 540, 440, 768])
    add("m10_drop_hover_cancel", "Missao 10: Drop money, mouse sobre Cancel", pre=drop, mouse=list(DROP_CANCEL), wait_ms=700, post=after_drop,
        roi=[60, 540, 440, 768])
    # ------------------------------------------------------------------ menu Esc da missao
    add("m10_menu", "Missao 10: Esc (menu do jogo), mouse fora", pre=[["key", "esc"], ["wait", 0.6]], mouse=NEUTRAL, post=[["key", "esc"]], roi=MENU_ROI)
    for i, nm in enumerate(MENU_NAMES):
        add(f"m10_menu_hover_{nm}", f"Missao 10: menu Esc, mouse sobre '{nm}'", pre=[["key", "esc"], ["wait", 0.6]], mouse=list(MENU_ITEMS[i]),
            post=[["key", "esc"]], roi=MENU_ROI)
    add("m10_menu_press_save", "Missao 10: menu Esc, 'Save Game' apertado", pre=[["key", "esc"], ["wait", 0.6]], mouse=list(MENU_ITEMS[0]), press=True,
        post=[["key", "esc"]], roi=MENU_ROI)
    add("m10_menu_save", "Missao 10: Esc > Save Game", pre=[["key", "esc"], ["wait", 0.6], ["click", *MENU_ITEMS[0]], ["wait", 0.9]], mouse=NEUTRAL,
        post=[["key", "esc"]], roi=MENU_ROI)
    add("m10_menu_load", "Missao 10: Esc > Load Game", pre=[["key", "esc"], ["wait", 0.6], ["click", *MENU_ITEMS[1]], ["wait", 0.9]], mouse=NEUTRAL,
        post=[["key", "esc"]], roi=MENU_ROI)
    add("m10_menu_endquest", "Missao 10: Esc > End Quest (confirmacao?)", pre=[["key", "esc"], ["wait", 0.6], ["click", *MENU_ITEMS[5]], ["wait", 0.9]],
        mouse=NEUTRAL, post=[["key", "esc"]], roi=MENU_ROI)
    add("m10_paused", "Missao 10: tecla Pause -> 'Game paused. Click Ok to continue.'", pre=[["key", "pause"], ["wait", 0.6]], mouse=NEUTRAL,
        post=[["click", 507, 452]], roi=DLG_ROI)
    # ------------------------------------------------------------------ missao 20 (nada selecionado) e falas
    add("m20_hud", "Missao 20: HUD com 'No units selected' (original comeca sem selecao), mouse fora", state="m20_start", mission=20, deselect=True,
        mouse=NEUTRAL, roi=PANEL)
    add("m20_bag_open", "Missao 20: mochila aberta", state="m20_start", mission=20, deselect=True, pre=bag, mouse=NEUTRAL, post=[["click", *BAG]], roi=STRIP)
    add("m20_menu", "Missao 20: Esc (menu do jogo)", state="m20_start", mission=20, deselect=True, pre=[["key", "esc"], ["wait", 0.6]], mouse=NEUTRAL,
        post=[["key", "esc"]], roi=MENU_ROI)
    add("m20_dialog_1", "Missao 20: 1a fala do heroi (retrato + Ok), mouse fora", state="m20_town", start="gate", mission=20, keep_dialogs=True,
        deselect=True, mouse=[1000, 300], roi=DLG_ROI)
    add("m20_dialog_hover_ok", "Missao 20: 1a fala, mouse sobre Ok", state="m20_town", start="gate", mission=20, keep_dialogs=True, deselect=True,
        mouse=[507, 452], wait_ms=600, roi=DLG_ROI)
    add("m20_dialog_press_ok", "Missao 20: 1a fala, Ok apertado", state="m20_town", start="gate", mission=20, keep_dialogs=True, deselect=True,
        mouse=[507, 452], press=True, wait_ms=500, roi=DLG_ROI)
    # ------------------------------------------------------------------ mago (Gildarius): livro de magias, dicas, magia selecionada, barra de mana
    HEAL, SHIELD = (368, 707), (482, 745)
    mg = dict(state="m10_mage", hero="mage")
    add("m10m_hud", "Missao 10 com o mago: HUD completo (mana 99/99, Cast habilitado), mouse fora", mouse=NEUTRAL, roi=PANEL, **mg)
    add("m10m_hero_bars", "Missao 10 com o mago: barras de vida e mana sobre o heroi", mouse=NEUTRAL, roi=[60, 320, 180, 420], **mg)
    add("m10m_book_open", "Missao 10 com o mago: livro de magias aberto (Heal e Shield)", pre=[["click", *BOOK], ["wait", 0.5]], mouse=NEUTRAL,
        post=[["click", *BOOK]], roi=[0, 640, 1024, 768], **mg)
    add("m10m_hover_heal", "Mago: mouse sobre a celula Heal (dica com custo, dano, alcance)", pre=[["click", *BOOK], ["wait", 0.5]], mouse=list(HEAL), wait_ms=1000,
        post=[["click", *BOOK]], roi=[340, 600, 848, 768], **mg)
    add("m10m_hover_shield", "Mago: mouse sobre a celula Shield (dica longa cortada pelo painel)", pre=[["click", *BOOK], ["wait", 0.5]], mouse=list(SHIELD), wait_ms=1000,
        post=[["click", *BOOK]], roi=[440, 600, 1024, 768], **mg)
    add("m10m_heal_selected", "Mago: Heal escolhida no livro (celula clareada, cursor de magia sobre o terreno)", pre=[["click", *BOOK], ["wait", 0.4], ["click", *HEAL], ["wait", 0.4]],
        mouse=[300, 420], post=[["key", "esc"], ["click", *BOOK]], roi=[0, 300, 848, 768], **mg)
    add("m10m_shield_cast", "Mago: Shield lancado pelo livro (clique na celula) e 1,5 s depois: aura sobre o heroi, mana gasta", pre=[["click", *BOOK], ["wait", 0.4], ["click", *SHIELD], ["wait", 1.5]],
        mouse=NEUTRAL, post=[["click", *BOOK]], roi=[60, 320, 180, 420], live=True, **mg)
    # ------------------------------------------------------------------ tela de resultado (original: run_defeat.py --out scratch/fm/defeat3; quadro 06 -> refs/original/m10_defeat.png)
    add("m10_defeat", "Missao 10: heroi morto -> 'Mission Failed' (Exit to Main Menu / Load Game)", mouse=[700, 700], roi=[260, 260, 760, 560])
    S[-1].pop("orig")
    S[-1]["orig_by"] = "tools/refcap/original/run_defeat.py --out scratch/fm/defeat3 (copiar defeat_06.png)"
    # ------------------------------------------------------------------ combate (original: tools/refcap/original/run_combat.py --prefix m10_fight_seq --full)
    add("m10_fight_seq", "Missao 10: heroi ataca a cobra (barra do heroi, texto de dano, cursor), 40 quadros a cada 100 ms", sequence=40, interval_ms=100, roi=[0, 0, 848, 768])
    S[-1].pop("orig")
    S[-1]["orig_by"] = "tools/refcap/original/run_combat.py --out refs/original --prefix m10_fight_seq --full --frames 40"
    return S


def main():
    d = json.load(open(SC, encoding="utf-8"))
    new = build()
    ids = {s["id"] for s in new}
    d["scenarios"] = [s for s in d["scenarios"] if s["id"] not in ids] + new
    json.dump(d, open(SC, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(f"{len(new)} cenarios de missao gravados em {SC} ({len(d['scenarios'])} no total)")


if __name__ == "__main__":
    main()
