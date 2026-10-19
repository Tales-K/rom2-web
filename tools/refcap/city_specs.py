"""Gera (idempotente) os cenarios de cidade/taverna/Esc/Save/Options em tools/refcap/scenarios.json (frente CAPTURAS-ORIGINAL, 19/10).

    python tools/refcap/city_specs.py

Cada cenario novo tem o campo `orig` ({state, start, post}) lido por tools/refcap/original/run_city.py (captura do ORIGINAL) e os
campos genericos lidos por genericRecipe (captura do NOSSO): `enter` (town|inn), `campaign`, `pre` (passos), `mouse`, `press`, `sequence`.
Passos (`pre`/`post`): ["click",x,y] ["rclick",x,y] ["move",x,y] ["key","esc"|"enter"|"backspace"] ["type","txt"] ["wait",seg]
Coordenadas = pixels do cliente 1024x768 (arte 640x480 + deslocamento 192,144).
"""
from __future__ import annotations

import json
import os

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
SC = os.path.join(HERE, "scenarios.json")
TOWN_ART = os.path.join(ROOT, "game", "public", "assets", "ui", "town")
AWAY = [1000, 750]
OX, OY = 192, 144

TOWNS = {
    "plagat": dict(state="plagat_start", campaign=None, art="", prefix="town", inn="inn", sc_inn="inn"),
    "kaarg": dict(state="kaarg_30", campaign={"done": [10, 20], "town": 2, "stage": 30}, art="kaarg", prefix="town_kaarg", inn="inn_kaarg"),
    "druids": dict(state="druids_60", campaign={"done": [10, 20, 30, 40, 50], "town": 3, "stage": 60}, art="druids", prefix="town_druids", inn="inn_druids"),
}


def region_points(art: str):
    """{id: (nome, (x,y) de tela)}: ponto da mascara mais proximo do centro de massa de cada regiao."""
    d = os.path.join(TOWN_ART, art)
    meta = json.load(open(os.path.join(d, "town.json"), encoding="utf-8"))["regions"]
    mask = np.asarray(Image.open(os.path.join(d, "mask.png")).convert("L"))
    out = {}
    for k, r in meta.items():
        ys, xs = np.nonzero(mask == int(k))
        if not len(xs):
            continue
        cx, cy = xs.mean(), ys.mean()
        i = int(np.argmin((xs - cx) ** 2 + (ys - cy) ** 2))
        out[int(k)] = (r["name"], r.get("speech"), (int(xs[i]) + OX, int(ys[i]) + OY))
    ys, xs = np.nonzero(mask == 0)
    out[0] = ("none", None, (int(xs[len(xs) // 3]) + OX, int(ys[len(ys) // 3]) + OY))
    return out


def sc(id, desc, town, **kw):
    t = TOWNS[town]
    d = {"id": id, "desc": desc}
    start = kw.pop("start", "town")
    d["enter"] = start
    if t["campaign"]:
        d["campaign"] = t["campaign"]
    d["town"] = {"plagat": 1, "kaarg": 2, "druids": 3}[town]
    post = kw.pop("post", None)
    d["orig"] = {"state": t["state"], "start": start, **({"post": post} if post else {})}
    d.update(kw)
    return d


def build():
    out = []
    # ------------------------------------------------------------------ cidades: hover em cada ponto + pressionado + clique
    for town, t in TOWNS.items():
        pts = region_points(t["art"])
        # 1 nome por regiao (persons numerados)
        seen = {}
        for rid, (name, speech, p) in sorted(pts.items()):
            if rid == 0:
                tag = "none"
            elif name == "person":
                n = seen[speech] = seen.get(speech, 0) + 1
                tag = (speech or "person") + ("" if n == 1 else str(n))
            else:
                tag = name
            pts[rid] = (name, speech, p, tag)
        for rid, (name, speech, p, tag) in sorted(pts.items()):
            sid = f"{t['prefix']}_hover_{tag}"
            if sid in ("town_hover_inn", "town_hover_shop", "town_kaarg_hover_inn", "town_druids_hover_inn"):
                continue   # ja existem (capturas anteriores)
            out.append(sc(sid, f"{town}: mouse sobre '{tag}' (regiao {rid} da mascara), parado 0,9 s", town, mouse=list(p), wait_ms=900))
        for rid, (name, speech, p, tag) in sorted(pts.items()):
            if name in ("inn", "shop", "statue", "gate", "trainer") and (town == "plagat" or name in ("inn", "gate")):
                out.append(sc(f"{t['prefix']}_press_{tag}", f"{town}: botao esquerdo APERTADO (sem soltar) sobre '{tag}'", town, mouse=list(p), press=True,
                              orig_release="away"))
            if name == "person":
                sid = f"{t['prefix']}_talk_{tag}"
                out.append(sc(sid, f"{town}: clique em '{tag}' -> janela de conversa (1a fala), mouse no canto", town, pre=[["click", *p], ["wait", 1.2]], mouse=AWAY, wait_ms=900,
                              orig_note="se a conversa tiver varias falas so a 1a", post=[["click", 507, 452], ["wait", 0.6]]))
                out.append(sc(sid + "_hover_ok", f"{town}: conversa com '{tag}', mouse sobre Ok", town, pre=[["click", *p], ["wait", 1.2]], mouse=[507, 452], wait_ms=700, post=[["click", 507, 452], ["wait", 0.6]]))
                out.append(sc(sid + "_press_ok", f"{town}: conversa com '{tag}', Ok APERTADO", town, pre=[["click", *p], ["wait", 1.2]], mouse=[507, 452], press=True, post=[["click", 507, 452], ["wait", 0.6]]))
        # animacoes da cidade parada (sequencia)
        out.append(sc(f"{t['prefix']}_seq", f"{town}: 40 quadros a cada 83 ms (animacoes da cidade; mouse no canto)", town, mouse=AWAY, sequence=40, interval_ms=83))
    # Plagat: School of Magic (clique) e guarda do portao
    out.append(sc("town_click_trainer", "Plagat: clique na School of Magic (o que acontece), 1,5 s depois", "plagat", pre=[["click", 696, 516], ["wait", 1.5]], mouse=AWAY, wait_ms=700))
    out.append(sc("town_click_gate_guard", "Plagat: clique no portao antes de aceitar a missao 10 -> fala do guarda", "plagat", pre=[["click", 393, 299], ["wait", 1.2]], mouse=AWAY, wait_ms=900,
                  post=[["click", 507, 452], ["wait", 0.6]]))
    out.append(sc("town_click_gate_guard_hover_ok", "Plagat: fala do guarda, mouse sobre Ok", "plagat", pre=[["click", 393, 299], ["wait", 1.2]], mouse=[507, 452], wait_ms=700, post=[["click", 507, 452], ["wait", 0.6]]))
    out.append(sc("town_click_gate_guard_press_ok", "Plagat: fala do guarda, Ok APERTADO", "plagat", pre=[["click", 393, 299], ["wait", 1.2]], mouse=[507, 452], press=True, post=[["click", 507, 452], ["wait", 0.6]]))
    # ------------------------------------------------------------------ menu Esc da cidade (so Plagat; Kaarg/druidas usam o mesmo) e subjanelas
    ITEMS = {"save": 322, "load": 352, "sound": 382, "abort": 412, "return": 442}
    out.append(sc("town_esc_menu", "Plagat: Esc -> menu do jogo da cidade (5 itens), mouse no canto", "plagat", pre=[["key", "esc"], ["wait", 0.8]], mouse=AWAY, wait_ms=500, post=[["key", "esc"], ["wait", 0.8]]))
    for k, y in ITEMS.items():
        out.append(sc(f"town_esc_hover_{k}", f"Plagat: menu Esc, mouse sobre '{k}'", "plagat", pre=[["key", "esc"], ["wait", 0.8]], mouse=[506, y], wait_ms=600, post=[["key", "esc"], ["wait", 0.8]]))
    out.append(sc("town_esc_press_save", "Plagat: menu Esc, botao apertado sobre Save Game", "plagat", pre=[["key", "esc"], ["wait", 0.8]], mouse=[506, 322], press=True, post=[["key", "esc"], ["wait", 0.8]]))
    esc = lambda *more: [["key", "esc"], ["wait", 0.8], *more]
    out.append(sc("town_save_screen", "Plagat: Esc > Save Game (janela Save, mouse no canto)", "plagat", pre=esc(["click", 506, 322], ["wait", 1.0]), mouse=AWAY, wait_ms=500, post=[["key", "esc"], ["wait", 0.8]]))
    SV = {"hover_row2": (500, 360), "hover_ok": (389, 502), "hover_delete": (511, 502), "hover_cancel": (633, 502), "hover_name": (500, 285), "hover_scroll_up": (703, 342), "hover_scroll_down": (703, 457)}
    for k, p in SV.items():
        out.append(sc(f"town_save_{k}", f"Plagat: janela Save, mouse em {k}", "plagat", pre=esc(["click", 506, 322], ["wait", 1.0]), mouse=list(p), wait_ms=700, post=[["key", "esc"], ["wait", 0.8]]))
    for k, p in {"press_ok": (389, 502), "press_cancel": (633, 502), "press_delete": (511, 502)}.items():
        out.append(sc(f"town_save_{k}", f"Plagat: janela Save, botao apertado em {k[6:]}", "plagat", pre=esc(["click", 506, 322], ["wait", 1.0]), mouse=list(p), press=True, post=[["key", "esc"], ["wait", 0.8]]))
    out.append(sc("town_save_select_row", "Plagat: janela Save, clique na linha 'plagat start' (o campo de nome muda?)", "plagat", pre=esc(["click", 506, 322], ["wait", 1.0], ["click", 500, 360], ["wait", 0.4]), mouse=AWAY, wait_ms=500, post=[["key", "esc"], ["wait", 0.8]]))
    out.append(sc("town_save_typed", "Plagat: janela Save, digitado 'Test' (linha vazia escolhida)", "plagat", pre=esc(["click", 506, 322], ["wait", 1.0], ["type", "Test"], ["wait", 0.4]), mouse=AWAY, wait_ms=500, post=[["key", "esc"], ["wait", 0.8]]))
    out.append(sc("town_save_typed_row2", "Plagat: janela Save, digitado 'Test' depois de clicar na linha 'plagat start'", "plagat", pre=esc(["click", 506, 322], ["wait", 1.0], ["click", 500, 360], ["wait", 0.3], ["type", "Test"], ["wait", 0.4]), mouse=AWAY, wait_ms=500, post=[["key", "esc"], ["wait", 0.8]]))
    out.append(sc("town_load_screen", "Plagat: Esc > Load Game (janela Load na cidade)", "plagat", pre=esc(["click", 506, 352], ["wait", 1.0]), mouse=AWAY, wait_ms=500, post=[["key", "esc"], ["wait", 0.8]]))
    out.append(sc("town_sound_options", "Plagat: Esc > Sound Options (mouse no canto)", "plagat", pre=esc(["click", 506, 382], ["wait", 1.0]), mouse=AWAY, wait_ms=500, post=[["key", "esc"], ["wait", 0.8]]))
    SO = {"hover_ok": (412, 505), "hover_play": (358, 471), "hover_stop": (468, 471), "hover_check": (321, 407), "hover_music_left": (535, 406), "hover_track": (500, 293), "hover_slider": (637, 406)}
    for k, p in SO.items():
        out.append(sc(f"town_sound_{k}", f"Plagat: Sound Options, mouse em {k}", "plagat", pre=esc(["click", 506, 382], ["wait", 1.0]), mouse=list(p), wait_ms=700, post=[["key", "esc"], ["wait", 0.8]]))
    out.append(sc("town_sound_press_ok", "Plagat: Sound Options, Ok apertado", "plagat", pre=esc(["click", 506, 382], ["wait", 1.0]), mouse=[412, 505], press=True, post=[["key", "esc"], ["wait", 0.8]]))
    out.append(sc("town_sound_press_play", "Plagat: Sound Options, Play apertado", "plagat", pre=esc(["click", 506, 382], ["wait", 1.0]), mouse=[358, 471], press=True, post=[["key", "esc"], ["wait", 0.8]]))
    out.append(sc("town_sound_check_off", "Plagat: Sound Options, clique em Acknowledgments (desmarca)", "plagat", pre=esc(["click", 506, 382], ["wait", 1.0], ["click", 321, 407], ["wait", 0.4]), mouse=AWAY, wait_ms=500, post=[["key", "esc"], ["wait", 0.8]]))
    out.append(sc("town_abort_menu", "Plagat: Esc > Abort Game (janela de 3 itens)", "plagat", pre=esc(["click", 506, 412], ["wait", 1.0]), mouse=AWAY, wait_ms=500, post=[["key", "esc"], ["wait", 0.8]]))
    # ------------------------------------------------------------------ taverna (Plagat / Kaarg / druidas)
    for town, t in TOWNS.items():
        pre_ = {"plagat": "inn", "kaarg": "inn_kaarg", "druids": "inn_druids"}[town]
        out.append(sc(f"{pre_}_seq", f"{town}: taverna parada, 48 quadros a cada 83 ms (taverneiro; mouse no canto)", town, start="inn", mouse=AWAY, sequence=48, interval_ms=83))
    for k, p in {"talk": (745, 255), "exit": (745, 302), "card1": (392, 592), "card3": (488, 592), "card5": (584, 592)}.items():
        out.append(sc(f"inn_hover_{k}", f"Plagat: taverna, mouse em {k}", "plagat", start="inn", mouse=list(p), wait_ms=800))
    for k, p in {"talk": (745, 255), "exit": (745, 302)}.items():
        out.append(sc(f"inn_press_{k}", f"Plagat: taverna, botao {k} APERTADO", "plagat", start="inn", mouse=list(p), press=True))
    out.append(sc("inn_talk_hover_ok", "Plagat: taverna, mensageiro (cartao 3) > Talk > mouse sobre Ok", "plagat", start="inn",
                  pre=[["click", 488, 592], ["wait", 0.5], ["click", 745, 255], ["wait", 1.0]], mouse=[507, 452], wait_ms=700, post=[["click", 507, 452], ["wait", 0.6]]))
    out.append(sc("inn_talk_press_ok", "Plagat: taverna, mensageiro > Talk > Ok APERTADO", "plagat", start="inn",
                  pre=[["click", 488, 592], ["wait", 0.5], ["click", 745, 255], ["wait", 1.0]], mouse=[507, 452], press=True, post=[["click", 507, 452], ["wait", 0.6]]))
    out.append(sc("inn_card3_selected_hover_talk", "Plagat: taverna, cartao 3 escolhido, mouse sobre Talk", "plagat", start="inn", pre=[["click", 488, 592], ["wait", 0.5]], mouse=[745, 255], wait_ms=700))
    # 2a fala da mulher de Kaarg (npc 99, "sis"): o retrato dela e outro
    kp = region_points("kaarg")
    wp = [v[2] for k, v in kp.items() if v[1] == "kaargwoman"][0]
    out.append(sc("town_kaarg_talk_kaargwoman_line2", "kaarg: conversa com a mulher, 2a fala (npc 99), mouse no canto", "kaarg", pre=[["click", *wp], ["wait", 1.2], ["click", 507, 452], ["wait", 1.2]], mouse=AWAY, wait_ms=900,
                  post=[["click", 507, 452], ["wait", 0.8], ["click", 507, 452], ["wait", 0.6]]))
    # cursor de texto da janela Save: 30 quadros a cada 100 ms depois de digitar "ab"
    out.append(sc("town_save_caret_seq", "Plagat: janela Save, digitado 'ab', 30 quadros a cada 100 ms (piscar do cursor de texto)", "plagat",
                  pre=[["key", "esc"], ["wait", 0.8], ["click", 506, 322], ["wait", 1.0], ["type", "ab"], ["wait", 0.3]], mouse=AWAY, sequence=30, interval_ms=100,
                  post=[["key", "esc"], ["wait", 0.8]]))
    # criacao de personagem (capturada por original/run_menu.py --phase chargen / chargen_b em 19/10): nome padrao por janela, nome digitado/apagado
    wins = {"fighter_m": (345, 330), "fighter_f": (405, 330), "mage_f": (620, 370), "mage_m": (685, 370)}
    seq = ["fighter_f", "mage_f", "mage_m", "fighter_m", "fighter_f", "fighter_f", "mage_m", "mage_m", "fighter_m"]
    chg = lambda id, desc, pre: {"id": id, "desc": desc, "scene": "chargen", "pre": pre, "mouse": AWAY, "wait_ms": 500}
    for i, k in enumerate(seq):
        out.append(chg(f"chargen_a_sel_{i}_{k}", f"criacao A: clique em {k} (passo {i}), nome padrao da janela", [["click", *wins[w]] for w in seq[: i + 1]]))
    typed = [["click", *wins["fighter_m"]], ["click", 420, 560]] + [["key", "backspace"]] * 12 + [["type", "Zed"]]
    out.append(chg("chargen_a_typed", "criacao A: nome editado para 'Zed'", typed))
    out.append(chg("chargen_a_typed_then_mage_f", "criacao A: depois de digitar 'Zed', clique na maga: o nome NAO muda", typed + [["click", *wins["mage_f"]]]))
    out.append(chg("chargen_a_typed_then_fighter_f", "criacao A: depois, clique na guerreira: continua 'Zed'", typed + [["click", *wins["mage_f"]], ["click", *wins["fighter_f"]]]))
    empty = typed + [["click", *wins["mage_f"]], ["click", *wins["fighter_f"]], ["click", 420, 560]] + [["key", "backspace"]] * 14
    out.append(chg("chargen_a_empty", "criacao A: nome apagado", empty))
    out.append(chg("chargen_a_empty_then_mage_m", "criacao A: nome vazio e clique no mago: continua vazio", empty + [["click", *wins["mage_m"]]]))
    for s in out:   # o original tinha o save "plagat start" na lista das janelas Save/Load
        if s["id"].startswith(("town_save", "town_load")):
            s["saves"] = 1
    return out


def main():
    d = json.load(open(SC, encoding="utf-8"))
    new = build()
    ids = {s["id"] for s in new}
    keep = [s for s in d["scenarios"] if s["id"] not in ids]
    d["scenarios"] = keep + new
    json.dump(d, open(SC, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(f"{len(new)} cenarios gerados; total {len(d['scenarios'])}")


if __name__ == "__main__":
    main()
