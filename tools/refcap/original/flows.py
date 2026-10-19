"""Navegação automática no jogo original (coordenadas da área cliente 1024x768, modo -1024).

Nas telas de menu/cidade/taverna o jogo desenha a arte 640x480 CENTRALIZADA (deslocamento 192,144) — não escala.
Todas as coordenadas abaixo foram medidas nas capturas (veja notes/original-capture.md).

Cada função espera o jogo chegar à tela (assinatura por recorte de referência em sigs/) em vez de esperas fixas.
"""
from __future__ import annotations

import os
import time

import numpy as np
from PIL import Image

import capture

HERE = os.path.dirname(os.path.abspath(__file__))
SIGS = os.path.join(HERE, "sigs")
OX, OY = 192, 144  # origem da arte 640x480 dentro do cliente 1024x768
MOUSE_AWAY = (1000, 750)  # canto preto fora da arte (não é hotspot em nenhuma tela 640x480)

# ---------------------------------------------------------------- assinaturas de tela
# nome -> (arquivo de referência em sigs/, caixa x0,y0,x1,y1 no cliente)
SIG_BOXES = {
    "menu": (200, 150, 290, 600),        # caveiras à esquerda do disco do menu principal
    "chargen_a": (200, 145, 245, 210),   # ornamento do pilar sup. esquerdo (vitrais)
    "chargen_b": (200, 150, 355, 370),   # painel vermelho de atributos (Body/Agility...)
    "town": (192, 290, 280, 450),        # prédio da esquerda da cidade de Plagat
    "inn": (370, 330, 650, 560),         # taverneiro no centro da taverna
    "dialog": (268, 270, 304, 306),      # caveira sup. esquerda da caixa de fala (taverna; caixa fixa, Ok em 507,452)
    "mission_hud": (862, 160, 1016, 236),  # barra de comandos do HUD da missão (1024: painel direito)
    "globalmap": (735, 515, 800, 585),   # rosa dos ventos do mapa-múndi (Allod Uimoir)
}


def crop(img: Image.Image, box) -> np.ndarray:
    return np.asarray(img.crop(box), dtype=np.int16)


def save_sig(name: str, img: Image.Image):
    os.makedirs(SIGS, exist_ok=True)
    img.crop(SIG_BOXES[name]).save(os.path.join(SIGS, name + ".png"))


def sig_diff(img: Image.Image, name: str) -> float:
    ref = np.asarray(Image.open(os.path.join(SIGS, name + ".png")).convert("RGB"), dtype=np.int16)
    return float(np.mean(np.abs(crop(img, SIG_BOXES[name]) - ref)))


def which_screen(img: Image.Image, thr: float = 12.0) -> str | None:
    best, bd = None, 1e9
    for n in SIG_BOXES:
        if not os.path.exists(os.path.join(SIGS, n + ".png")):
            continue
        d = sig_diff(img, n)
        if d < bd:
            best, bd = n, d
    return best if bd < thr else None


def wait_screen(g, name: str, timeout: float = 20.0, poke=None, every: float = 0.7, thr: float = 12.0):
    """Espera a tela `name`; `poke()` é chamado a cada `every` s enquanto não chega (ex.: apertar Esc)."""
    t0 = time.time()
    last = 0.0
    while time.time() - t0 < timeout:
        g.check_alive()
        img = capture.grab(g)
        if sig_diff(img, name) < thr:
            return img
        if poke and time.time() - last > every:
            poke()
            last = time.time()
        time.sleep(0.15)
    raise TimeoutError(f"tela {name!r} não apareceu em {timeout}s (vista: {which_screen(capture.grab(g))})")


def settle(g, sec=0.5):
    g.wait(sec)


def find_template(img: Image.Image, name: str, region=(192, 144, 832, 624), thr: float = 18.0, step: int = 2):
    """Procura sigs/<name>.png na região (busca exaustiva em escala 1/2). Devolve o centro (x,y) ou None."""
    from numpy.lib.stride_tricks import sliding_window_view
    t = Image.open(os.path.join(SIGS, name + ".png")).convert("L")
    tw, th = t.size
    t = np.asarray(t.resize((tw // step, th // step)), dtype=np.float32)
    x0, y0, x1, y1 = region
    a = img.convert("L").crop(region)
    a = np.asarray(a.resize(((x1 - x0) // step, (y1 - y0) // step)), dtype=np.float32)
    if a.shape[0] < t.shape[0] or a.shape[1] < t.shape[1]:
        return None
    win = sliding_window_view(a, t.shape)
    d = np.abs(win - t).mean(axis=(2, 3))
    iy, ix = np.unravel_index(np.argmin(d), d.shape)
    if d[iy, ix] > thr:
        return None
    return x0 + ix * step + tw // 2, y0 + iy * step + th // 2


def dismiss_dialogs(g, inp, max_n: int = 30, wait: float = 0.35) -> int:
    """Clica 'Ok' em caixas de diálogo (falas da taverna etc.) até não haver mais. Devolve quantas fechou."""
    n = 0
    for _ in range(max_n):
        inp.move(*MOUSE_AWAY)
        g.wait(0.15)
        img = capture.grab(g)
        if sig_diff(img, "dialog") > 12:
            break
        p = find_template(img, "btn_ok", region=(440, 400, 580, 520), thr=9) or (507, 452)
        inp.click(*p)
        n += 1
        g.wait(wait)
    inp.move(*MOUSE_AWAY)
    return n


# ---------------------------------------------------------------- fluxos
# janelas de dica ("Show tips next time" + CLOSE): posição do botão CLOSE por tela
TIP_CLOSE = {"chargen_a": (751, 296), "chargen_b": (583, 592), "town": (751, 312), "inn": (583, 312)}

MENU_BTN = {  # centros dos botoes do menu principal = centroides de menu/hit.png (corrigidos em 19/10: 6 dos 8 estavam errados)
    "new_game": (445, 235), "load_game": (577, 243), "multiplayer": (368, 328), "server": (655, 333),
    "cut_scenes": (362, 434), "hall_of_fame": (652, 443), "credits": (449, 522), "exit": (570, 526),
}
TOWN_SPOT = {"inn": (359, 513), "shop": (486, 450), "gate": (393, 299), "statue": (565, 494), "trainer": (696, 516)}
# hotspots por cidade (mediana dos pixels de townmask.bmp: 128 taverna, 144 loja, 160 portão, 176 estátua, 192 escola)
TOWN_SPOTS = {
    "plagat": TOWN_SPOT,
    "kaarg": {"inn": (739, 459), "shop": (539, 440), "gate": (377, 441), "statue": (241, 383), "trainer": (471, 481)},
    "druids": {"inn": (339, 376), "shop": (658, 462), "gate": (272, 476)},
}
CHARGEN_A = {"fighter_m": (345, 330), "fighter_f": (405, 330), "mage_f": (620, 370), "mage_m": (685, 370),
             "ok": (780, 585), "cancel": (238, 585)}
CHARGEN_B = {"accept": (745, 209), "reset": (745, 255), "back": (745, 302)}
INN = {"talk": (745, 255), "exit": (745, 302), "card": [(392, 592), (440, 592), (488, 592), (536, 592), (584, 592)]}


def boot_to_menu(g, inp, timeout=25):
    """Pula logos/abertura com Esc até o menu principal."""
    g.wait(1.5)
    img = wait_screen(g, "menu", timeout, poke=lambda: inp.key("esc"), every=0.8)
    inp.move(*MOUSE_AWAY)
    g.wait(0.6)  # fim do fade
    return img


def new_game_to_town(g, inp, hero="fighter_m", close_tips=True):
    inp.click(*MENU_BTN["new_game"])
    wait_screen(g, "chargen_a", 10)
    g.wait(0.4)
    inp.click(*TIP_CLOSE["chargen_a"])
    g.wait(0.3)
    if hero != "fighter_m":
        inp.click(*CHARGEN_A[hero])
        g.wait(0.4)
    inp.click(*CHARGEN_A["ok"])
    wait_screen(g, "chargen_b", 10)
    g.wait(0.4)
    inp.click(*TIP_CLOSE["chargen_b"])
    g.wait(0.3)
    inp.click(*CHARGEN_B["accept"])
    wait_screen(g, "town", 15)
    g.wait(0.8)
    if close_tips:
        inp.click(*TIP_CLOSE["town"])
        g.wait(0.3)
    inp.move(*MOUSE_AWAY)
    g.wait(0.3)


def inn_talk(g, inp, card: int, read=True):
    """Seleciona o frequentador `card` (0..4) e clica Talk; com read=True fecha todas as falas."""
    inp.click(*INN["card"][card])
    g.wait(0.5)
    inp.click(*INN["talk"])
    g.wait(1.0)
    if read:
        return dismiss_dialogs(g, inp)
    return 0


def inn_exit(g, inp):
    inp.click(*INN["exit"])
    wait_screen(g, "town", 10)
    g.wait(0.5)


def town_to_inn(g, inp, close_tips=True):
    inp.click(*TOWN_SPOT["inn"])
    wait_screen(g, "inn", 10)
    g.wait(0.8)
    if close_tips:
        inp.click(*TIP_CLOSE["inn"])
        g.wait(0.3)
    inp.move(*MOUSE_AWAY)
    g.wait(0.3)


def town_to_mission(g, inp, talk_messenger=True, messenger_card=2):
    """Cidade -> (taverna: fala com o mensageiro) -> portão -> mapa-múndi (animação) -> missão 10.
    Devolve a lista de quadros (t, img) do mapa-múndi capturados durante a viagem."""
    if talk_messenger:
        town_to_inn(g, inp)
        inn_talk(g, inp, messenger_card)
        inn_exit(g, inp)
        inp.click(*TIP_CLOSE["town"])  # a dica da cidade reaparece ao voltar
        g.wait(0.3)
    inp.click(*TOWN_SPOT["gate"])
    frames = []
    t0 = time.time()
    while time.time() - t0 < 15:
        g.check_alive()
        img = capture.grab(g)
        frames.append((round(time.time() - t0, 2), img))
        if sig_diff(img, "mission_hud") < 12:
            break
        time.sleep(0.1)
    else:
        raise TimeoutError("missão não carregou")
    wait_dialog(g, inp, 4.0)  # a 1a fala do herói aparece ~0,5-1 s depois do HUD
    return frames


def wait_dialog(g, inp, timeout=3.0) -> bool:
    """Espera uma caixa de fala aparecer (mouse fora para não cobrir a caveira)."""
    inp.move(*MOUSE_AWAY)
    t0 = time.time()
    while time.time() - t0 < timeout:
        if sig_diff(capture.grab(g), "dialog") < 12:
            return True
        time.sleep(0.15)
    return False


# ---------------------------------------------------------------- missão: posição na tela
def hp_bars(img):
    """Barras de vida verdes desenhadas sobre unidades (herói selecionado): [(y, x0, x1)] na área do mapa (x < 850).
    A barra tem 24 px x 2 linhas; o centro do corpo da unidade fica ~21 px abaixo."""
    a = np.asarray(img.convert("RGB"), dtype=int)[:, :850]
    m = (a[:, :, 1] > 180) & (a[:, :, 0] < 90) & (a[:, :, 2] < 90)
    out = []
    for y in np.nonzero(m.sum(1) >= 10)[0]:
        xs = np.nonzero(m[y])[0]
        for r in np.split(xs, np.nonzero(np.diff(xs) > 1)[0] + 1):
            if len(r) >= 10:
                out.append((int(y), int(r[0]), int(r[-1])))
    return out


def hero_screen(g):
    """(x, y) na tela do centro do herói selecionado, pela barra de vida verde; None se não achou."""
    b = hp_bars(capture.grab(g))
    if not b:
        return None
    y, x0, x1 = b[0]
    return (x0 + x1) / 2, y + 21


def cell_to_screen(hero_xy_screen, hero_cell, cell):
    """Converte célula do mapa (x, y em células, como no .alm) para tela, a partir da posição do herói na tela.
    32 px por célula; ignora a altitude do terreno (erro de alguns px em relevo)."""
    hx, hy = hero_xy_screen
    return int(hx + (cell[0] - hero_cell[0]) * 32), int(hy + (cell[1] - hero_cell[1]) * 32)


def close_tip(g, inp, wait: float = 0.3) -> bool:
    """Fecha a janela de dica ("Show tips next time" / CLOSE) se houver uma na tela (procura o botão CLOSE)."""
    inp.move(*MOUSE_AWAY)
    g.wait(0.1)
    p = find_template(capture.grab(g), "btn_close", thr=8)
    if p:
        inp.click(*p)
        g.wait(wait)
        inp.move(*MOUSE_AWAY)
        return True
    return False
