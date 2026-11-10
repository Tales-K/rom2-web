"""Missão 110 "The Last Battle" no ORIGINAL a partir de m110_town (derivado de plagat_start: estágio 110, missões 10..100 concluídas,
vars[769]=1, locais [Plagat, missão 110]; o portão entra direto na missão). O script da 110 não cita Igles/Dina (10002/10003), então a
missão derivada carrega (as 30+ que citam caem em "Can't resolve hero"). Frente RE-DANO (19/10).

A fala de abertura tem páginas da Dina (ausente no save derivado): `patch_portrait` remenda só o desenho do retrato na memória da cópia.
Herói PARADO, sem ordens: grava a telemetria do servidor (orig_mem.Server.frame, todas as unidades, ~10/s) desde a entrada na missão,
com as falas fechadas no caminho.

    python build_m110.py --out refs/trace/m110_idle.jsonl [--secs 60] [--boost 3000] [--save]

`--boost N` escreve vida = vida máx. = N no herói (para medir todos os pulsos sem que ele caia). `--save` grava m110_start no fim.
"""
from __future__ import annotations

import argparse
import json
import os
import struct
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "trace"))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))

import capture  # noqa: E402
import flows  # noqa: E402
import states  # noqa: E402
from run_steps import acquire, open_session, release  # noqa: E402

OUT = os.path.join(ROOT, "scratch", "fm", "m110")
DONE = [10, 20, 21, 30, 31, 32, 40, 41, 42, 43, 50, 51, 52, 53, 60, 61, 62, 63, 70, 71, 72, 73, 80, 90, 100]


BOXES: list[str] = []


def handle_boxes(g) -> list[str]:
    """Caixas de mensagem (#32770) do processo: lê o texto, registra e aperta o 1º botão (BM_CLICK). Devolve os textos."""
    import ctypes
    import ctypes.wintypes as wt
    from launch import windows_of_pid, _class
    user32 = ctypes.windll.user32
    out = []
    for h in windows_of_pid(g.proc.pid):
        if h == g.hwnd or not user32.IsWindowVisible(h) or _class(h) != "#32770":
            continue
        kids = []
        cb = ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)(lambda c, _: kids.append(c) or True)
        user32.EnumChildWindows(h, cb, 0)
        texts, button = [], None
        for c in kids:
            buf = ctypes.create_unicode_buffer(512)
            user32.GetWindowTextW(c, buf, 512)
            if buf.value:
                texts.append(buf.value)
            if button is None and _class(c) == "Button":
                button = c
        msg = " / ".join(texts)
        out.append(msg)
        BOXES.append(msg)
        print("[caixa]", msg, flush=True)
        if button:
            user32.SendMessageW(button, 0x00F5, 0, 0)   # BM_CLICK
    return out


def wait(g, sec):
    t = time.time()
    while time.time() - t < sec:
        handle_boxes(g)
        if g.proc.poll() is not None:
            raise RuntimeError("allods2 terminou")
        time.sleep(0.2)


PORTRAIT_JE = 0x468A7D   # cliente: retrato com equipamento (0x4689xx), `je` que pula o espaço de item vazio (+0x188 + 4i)
PORTRAIT_BODY = 0x468D1E  # `mov eax, [edx+0x28]` = nº do corpo em "%s%d.256" (lixo −58 sem a Dina) → `push 6; pop eax` (fmage\6.256 existe)


def patch_portrait(p):
    """A fala de abertura da 110 tem uma página da Dina (10003); sem ela no grupo (save derivado) o retrato de equipamento lê lixo e o
    cliente morre em "can't load graphics\\equipment\\fmage\\-58.256". Remendo SÓ de desenho na memória da cópia de execução: o `je` vira
    `jmp` (retrato sem equipamento). Não toca na lógica do servidor."""
    import ctypes
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    old = ctypes.c_ulong()
    cur = p.read(PORTRAIT_JE, 2)
    if cur != b"\x0f\x84":
        print("[remendo] bytes inesperados", cur.hex(), flush=True)
        return
    for addr, new in ((PORTRAIT_JE, b"\x90\xe9"), (PORTRAIT_BODY, b"\x6a\x06\x58")):
        k32.VirtualProtectEx(p.h, ctypes.c_void_p(addr), len(new), 0x40, ctypes.byref(old))
        p.write(addr, new)
        k32.VirtualProtectEx(p.h, ctypes.c_void_p(addr), len(new), old.value, ctypes.byref(old))
    print("[remendo] retrato sem equipamento e corpo 6:", p.read(PORTRAIT_JE, 2).hex(), p.read(PORTRAIT_BODY, 3).hex(), flush=True)


KEEP = ("id", "player", "type", "x", "y", "hp", "hpmax", "mana", "manamax", "task", "mode", "target", "state")


def compact(units):
    """Só herói (1), cavaleiros (3) e druidas (4), com os campos usados na análise (o quadro cheio passa de 100 MB)."""
    return [{k: u[k] for k in KEEP} for u in units if u["player"] in (1, 3, 4)]


def recorder(path, secs, boost, stop):
    from orig_mem import Server
    srv = Server()
    t0 = time.perf_counter()
    while not stop.is_set() and time.perf_counter() - t0 < 30:
        try:
            if len(srv.rescan()) > 50:
                break
        except Exception:
            pass
        time.sleep(0.3)
    patch_portrait(srv.p)
    t16_0 = srv.time16()
    boosted = False
    with open(path, "w", encoding="utf-8") as out:
        t1 = time.perf_counter()
        while not stop.is_set() and time.perf_counter() - t1 < secs + 240:
            f = srv.frame()
            if f["t16"] - t16_0 > secs * 16:
                break
            if boost and not boosted:
                for a in srv.units:
                    u = srv.read_unit(a)
                    if u and u["player"] == 1 and u["kind"] == "hero":
                        srv.p.write(a + 0x94, struct.pack("<hh", boost, boost))
                        boosted = True
            f["units"] = compact(f["units"])
            f["t16rel"] = f["t16"] - t16_0
            f["sec"] = f["t16rel"] / 16
            f["wall"] = round(time.perf_counter() - t1, 3)
            out.write(json.dumps(f) + "\n")
            time.sleep(0.1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(ROOT, "refs", "trace", "m110_idle.jsonl"))
    ap.add_argument("--secs", type=float, default=60)
    ap.add_argument("--boost", type=int, default=0)
    ap.add_argument("--save", action="store_true")
    ap.add_argument("--esc", action="store_true", help="fecha as falas com Esc em vez de OK")
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    states.derive_save("plagat_start", "m110_town", "Plagat com estágio 110, 10..100 concluídas, locais [Plagat, missão 110] (derivado)",
                       110, [states.TOWNS["plagat"], states.mission(110)], cur=0, set_vars={769: 1, **states.done_vars(*DONE)})
    if not acquire():
        sys.exit(3)
    closer = None
    stop = threading.Event()
    th = None
    try:
        g, inp, closer = open_session("m110_town", a.secs + 200)
        flows.close_tip(g, inp)
        g.wait(0.5)
        inp.click(*flows.TOWN_SPOT["gate"])
        th = threading.Thread(target=recorder, args=(a.out, a.secs, a.boost, stop), daemon=True)
        th.start()
        n = 0
        wait(g, 4)
        for i in range(80):
            img = capture.grab(g)
            p = flows.find_template(img, "btn_ok", region=(190, 300, 700, 600), thr=9)
            if not p:
                wait(g, 1.5)
                p = flows.find_template(capture.grab(g), "btn_ok", region=(190, 300, 700, 600), thr=9)
                if not p:
                    break
            capture.grab(g).save(os.path.join(OUT, f"dlg_{i}.png"))
            if a.esc:
                inp.key("esc")
            else:
                inp.click(*p)
            wait(g, 0.8)
            n += 1
        print("falas:", n, flush=True)
        inp.move(*flows.MOUSE_AWAY)
        for k in range(int(a.secs // 10) + 30):
            img = capture.grab(g)
            img.save(os.path.join(OUT, f"hud_{k:02d}.png"))
            p = flows.find_template(img, "btn_ok", region=(190, 300, 700, 600), thr=9)
            if p:
                print(f"[fala no meio] hud_{k:02d}", flush=True)
                inp.click(*p)
                inp.move(*flows.MOUSE_AWAY)
            if not th.is_alive():
                break
            wait(g, 10)
        th.join(timeout=a.secs + 40)
        if a.save:
            states.save_state(g, inp, "m110_start", "missão 110 (derivada de plagat_start via m110_town), falas fechadas",
                              "mission_hud", in_mission=True, stage=110, base="m110_town")
    finally:
        stop.set()
        if closer:
            closer()
        release()
        from launch import list_game_pids
        print("allods2 restantes:", list_game_pids())


if __name__ == "__main__":
    main()
