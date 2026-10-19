"""Biblioteca de estados do jogo original (saves prontos) — refs/original/saves/<nome>.sav + index.json.

Carregar um estado = deixar SÓ esse save na pasta de execução (a2_run, como game0000.sav; os outros game*.sav vão para
a2_run/_parked/) e escolher a 1a linha do diálogo "Load Saved Game" do menu principal. Leva ~6 s desde o início do jogo.

    from states import install, load_from_menu, save_state
"""
from __future__ import annotations

import json
import os
import shutil
import time

import capture
import flows
from launch import GAME_DIR

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
SAVES = os.path.join(ROOT, "refs", "original", "saves")
INDEX = os.path.join(SAVES, "index.json")
PARK = os.path.join(GAME_DIR, "_parked")

LOAD_ROW0 = (500, 304)   # 1a linha da lista do diálogo Load (linhas a cada 19 px)
LOAD_OK = (389, 523)


def index() -> dict:
    return json.load(open(INDEX, encoding="utf-8")) if os.path.exists(INDEX) else {}


def _write_index(ix):
    os.makedirs(SAVES, exist_ok=True)
    json.dump(ix, open(INDEX, "w", encoding="utf-8"), indent=1, ensure_ascii=False)


def park_saves():
    """Tira todos os game*.sav da pasta de execução (move para _parked/, com carimbo de hora)."""
    os.makedirs(PARK, exist_ok=True)
    stamp = time.strftime("%Y%m%d_%H%M%S")
    for f in os.listdir(GAME_DIR):
        if f.lower().startswith("game") and f.lower().endswith(".sav"):
            shutil.move(os.path.join(GAME_DIR, f), os.path.join(PARK, f"{stamp}_{f}"))


def install(name: str):
    """Deixa só o save `name` em a2_run (como game0000.sav). Chamar ANTES de iniciar o jogo."""
    src = os.path.join(SAVES, name + ".sav")
    if not os.path.exists(src):
        raise FileNotFoundError(f"estado {name!r} não existe em {SAVES} (veja index.json)")
    park_saves()
    shutil.copy2(src, os.path.join(GAME_DIR, "game0000.sav"))


def load_from_menu(g, inp, name: str | None = None, timeout: float = 25.0) -> str:
    """No menu principal: Load Game -> 1a linha -> Ok. Espera a tela esperada (index[name]['screen']) e devolve-a."""
    expect = index().get(name, {}).get("screen") if name else None
    inp.click(*flows.MENU_BTN["load_game"])
    g.wait(1.2)
    inp.click(*LOAD_ROW0)
    g.wait(0.3)
    inp.click(*LOAD_OK)
    t0 = time.time()
    prev, stable = None, 0
    while time.time() - t0 < timeout:
        g.check_alive()
        img = capture.grab(g)
        scr = flows.which_screen(img)
        if scr in ("town", "mission_hud", "inn") and (expect is None or scr == expect):
            g.wait(0.8)
            return scr
        # cidades de Kaarg/druidas têm outra arte: aceita uma tela estável, não-preta, que não é o menu
        if scr is None and not capture.is_blank(img, 20) and time.time() - t0 > 3:
            a = capture.np.asarray(img, dtype=capture.np.int16)
            stable = stable + 1 if prev is not None and capture.np.mean(capture.np.abs(a - prev)) < 2 else 0
            prev = a
            if stable >= 4:
                g.wait(0.5)
                return "other"
        time.sleep(0.2)
    raise TimeoutError(f"o estado {name!r} não carregou (esperado {expect})")


# ------------------------------------------------------------------ edição offline do bloco do Scenario.dll no save
# ScenarioSave (DLL 0x10003585) grava, em sequência: int vars[1024] (4096 B) | lojas 4x4x{min,max,count,qty,mask} (320 B)
# | n = nº de locais disponíveis | n x Location {id, type, x, y, x, y} (24 B, DLL 0x10003990) | índice do local atual.
# Ao carregar (0x10003686) o local atual = n-ésimo da lista -> o exe monta a cidade/missão correspondente.
TOWNS = {"plagat": (1, 2, 215, 234), "kaarg": (2, 2, 370, 305), "druids": (3, 2, 194, 225)}
# posições (bitmap 640x480 do mapa-múndi) das missões, de Scenario.dll (tools/data/campaign_dll.py); o loader do DLL só
# usa (type, id) — x, y vão junto por fidelidade ao formato
MISSION_POS = {10: (302, 158), 20: (380, 364), 21: (423, 367), 30: (331, 395), 31: (443, 225), 32: (457, 202),
               40: (339, 226), 41: (403, 228), 42: (531, 207), 43: (454, 358), 50: (210, 260), 51: (450, 240),
               52: (132, 303), 53: (292, 191), 60: (511, 301), 61: (475, 312), 62: (253, 169), 63: (385, 221),
               70: (86, 193), 71: (337, 306), 72: (530, 255), 73: (343, 347), 80: (554, 299), 90: (283, 244),
               100: (388, 140), 110: (448, 140)}


def mission(mid):
    return (mid, 1, *MISSION_POS[mid])


def done_vars(*missions):
    """vars[896+M] = 1 (missão concluída, DLL 0x10001da5)."""
    return {896 + m: 1 for m in missions}


def find_scenario_block(data: bytes, stage: int) -> int:
    import struct
    for p in range(0, len(data) - 4096):
        if struct.unpack_from("<i", data, p + 3072)[0] == stage and data[p:p + 4096].count(0) > 3600:
            return p
    raise ValueError("bloco de variáveis do cenário não encontrado")


def derive_save(base: str, name: str, desc: str, stage: int, locations: list, cur: int = 0,
                set_vars: dict | None = None, screen: str = "town", **info):
    """Cria refs/original/saves/<name>.sav a partir de <base>.sav trocando estágio/variáveis/locais disponíveis.
    `locations` = lista de (id, type, x, y); `cur` = índice do local atual nessa lista."""
    import struct
    ix = index()
    d = bytearray(open(os.path.join(SAVES, base + ".sav"), "rb").read())
    p = find_scenario_block(bytes(d), ix.get(base, {}).get("stage", 10))
    vs = {768: stage, **{int(k): v for k, v in (set_vars or {}).items()}}
    for k, v in vs.items():
        struct.pack_into("<i", d, p + 4 * k, v)
    q = p + 4096 + 320
    n_old = struct.unpack_from("<i", d, q)[0]
    old_len = 4 + 24 * n_old + 4
    new = struct.pack("<i", len(locations))
    for (lid, typ, x, y) in locations:
        new += struct.pack("<6i", lid, typ, x, y, x, y)
    new += struct.pack("<i", cur)
    d[q:q + old_len] = new  # o bloco é lido em sequência; mudar o nº de locais só desloca o que vem depois
    open(os.path.join(SAVES, name + ".sav"), "wb").write(d)
    ix[name] = {"file": name + ".sav", "desc": desc, "screen": screen, "stage": stage, "base": base,
                "derived": {"vars": {str(k): v for k, v in vs.items()}, "locations": locations, "cur": cur},
                "date": time.strftime("%Y-%m-%d %H:%M:%S"), **info}
    _write_index(ix)
    print(f"  [derive] {name} <- {base} (estágio {stage}, locais {locations})")


def save_state(g, inp, name: str, desc: str, screen: str, in_mission: bool | None = None, **info) -> str:
    """Grava o estado atual (Esc -> Save Game -> nome -> Enter) e copia o .sav para a biblioteca."""
    before = {f: os.path.getmtime(os.path.join(GAME_DIR, f)) for f in os.listdir(GAME_DIR) if f.endswith(".sav")}
    inp.move(*flows.MOUSE_AWAY)
    inp.key("esc")
    g.wait(0.9)
    if in_mission is None:
        in_mission = flows.sig_diff(capture.grab(g), "mission_hud") < 12
    inp.click(507, 290 if in_mission else 322)  # "Save Game" no menu Esc da missão / da cidade
    g.wait(1.0)
    inp.type_text(name.replace("_", " "))
    inp.key("enter")
    g.wait(1.5)
    after = {f: os.path.getmtime(os.path.join(GAME_DIR, f)) for f in os.listdir(GAME_DIR) if f.endswith(".sav")}
    new = [f for f in after if before.get(f) != after[f] and not f.startswith("game999")]
    if not new:
        raise RuntimeError("o jogo não gravou o save")
    os.makedirs(SAVES, exist_ok=True)
    shutil.copy2(os.path.join(GAME_DIR, new[0]), os.path.join(SAVES, name + ".sav"))
    ix = index()
    ix[name] = {"file": name + ".sav", "desc": desc, "screen": screen, "ingame_name": name.replace("_", " "),
                "date": time.strftime("%Y-%m-%d %H:%M:%S"), **info}
    _write_index(ix)
    print(f"  [save] {name} <- {new[0]}")
    return new[0]
