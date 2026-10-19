"""Explorador/capturador generico do jogo ORIGINAL por passos (frente CAPTURAS-ORIGINAL, 19/10).

    python run_steps.py <estado|new|menu> <pasta_saida> "<passos>" [--max-runtime 300]

`estado` = nome da biblioteca (refs/original/saves/index.json; ex.: plagat_start, kaarg_30, druids_60), `new` = New Game -> cidade
(Plagat), `menu` = so o menu principal. As janelas do usuario que cobrem o jogo sao minimizadas pelo `Game` (winguard) e
restauradas no fim (finally). Trava scratch/refcap.lock (uma instancia por vez).

Passos (separados por espaco; espacos nos argumentos = "_"):
  wait:s | shot:nome | click:x,y | rclick:x,y | move:x,y | dmove:x,y (move com trajeto) | down:x,y | up | key:tecla | esc | type:txt
  seqc:nome,n,ms,x0,y0,x1,y1 (como seq, recortado)
  seq:nome,n,ms  (grava nome_000.png.. com n quadros a cada ms) | flow:inn|town|menu | home (grava a referencia "home")
  grid:x0,y0,x1,y1,passo,wait_s  (varre posicoes; salva <out>/grid_x_y.png so das que mudam alem do cursor; resumo em grid.json)
  rel  (solta o botao esquerdo longe) | away (mouse no canto)
"""
from __future__ import annotations

import json
import os
import sys
import time
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
LOCK = os.path.join(ROOT, "scratch", "refcap.lock")

import numpy as np  # noqa: E402


def acquire(tries=10, wait=30):
    os.makedirs(os.path.dirname(LOCK), exist_ok=True)
    for i in range(tries):
        try:
            fd = os.open(LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, f"run_steps pid {os.getpid()} {time.ctime()}".encode())
            os.close(fd)
            return True
        except FileExistsError:
            print(f"[trava] ocupada; aguardando {wait}s ({i + 1}/{tries})", flush=True)
            time.sleep(wait)
    return False


def release():
    try:
        os.remove(LOCK)
    except OSError:
        pass


def open_session(state, max_runtime=300):
    """Devolve (g, inp, closer). state: nome da biblioteca | new | menu."""
    import contextlib  # noqa: F401
    import flows
    from input import Input
    from launch import Game
    if state in ("new", "menu"):
        cm = Game(["-window", "-1024"], max_runtime=max_runtime)
        g = cm.__enter__()
        inp = Input(g)
        g.focus()
        flows.boot_to_menu(g, inp)
        if state == "new":
            flows.new_game_to_town(g, inp)
        inp.move(*flows.MOUSE_AWAY)
        g.wait(0.4)
        return g, inp, (lambda: cm.__exit__(None, None, None))
    from load_state import open_state
    ctx = open_state(state, max_runtime=max_runtime)
    g, inp = ctx.__enter__()
    return g, inp, (lambda: ctx.__exit__(None, None, None))


class Runner:
    def __init__(self, g, inp, out):
        self.g, self.inp, self.out = g, inp, out
        self.home = None
        self.log = []
        os.makedirs(out, exist_ok=True)

    def shot(self, name):
        import capture
        time.sleep(0.1)
        img = capture.grab(self.g)
        img.save(os.path.join(self.out, name + ".png"))
        return img

    def run(self, steps):
        import capture
        import flows
        from input import _mouse, _send, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP
        g, inp = self.g, self.inp
        for st in steps:
            cmd, _, arg = st.partition(":")
            arg = arg.replace("_", " ") if cmd == "type" else arg
            if cmd == "wait":
                g.wait(float(arg))
            elif cmd == "shot":
                self.shot(arg or "x")
            elif cmd in ("click", "rclick"):
                x, y = map(int, arg.split(","))
                inp.click(x, y, button="left" if cmd == "click" else "right")
            elif cmd == "move":
                x, y = map(int, arg.split(","))
                inp.move(x, y, steps=3)
            elif cmd == "dmove":
                x, y = map(int, arg.split(","))
                inp.move(x, y, steps=8)
                time.sleep(0.9)
            elif cmd == "down":
                x, y = map(int, arg.split(","))
                inp.move(x, y, steps=4)
                time.sleep(0.15)
                _send(_mouse(MOUSEEVENTF_LEFTDOWN))
                time.sleep(0.15)
            elif cmd == "up":
                _send(_mouse(MOUSEEVENTF_LEFTUP))
                time.sleep(0.3)
            elif cmd == "rel":
                inp.move(*flows.MOUSE_AWAY, steps=3)
                time.sleep(0.1)
                _send(_mouse(MOUSEEVENTF_LEFTUP))
                time.sleep(0.4)
            elif cmd == "away":
                inp.move(*flows.MOUSE_AWAY, steps=3)
                time.sleep(0.3)
            elif cmd == "esc":
                inp.key("esc")
                time.sleep(0.5)
            elif cmd == "key":
                inp.key(arg)
                time.sleep(0.3)
            elif cmd == "type":
                inp.type_text(arg)
            elif cmd == "seq":
                name, n, ms = arg.split(",")
                ts = []
                for i, (t, img) in enumerate(capture.grab_sequence(g, int(n), int(ms))):
                    img.save(os.path.join(self.out, f"{name}_{i:03d}.png"))
                    ts.append(round(t, 3))
                self.log.append({"seq": name, "t": ts})
            elif cmd == "seqc":   # seqc:nome,n,ms,x0,y0,x1,y1 -> quadros recortados (para animacoes longas)
                name, n, ms, x0, y0, x1, y1 = arg.split(",")
                box = (int(x0), int(y0), int(x1), int(y1))
                ts = []
                t0 = time.perf_counter()
                for i in range(int(n)):
                    target = t0 + i * int(ms) / 1000.0
                    while time.perf_counter() < target:
                        time.sleep(0.002)
                    ts.append(round(time.perf_counter() - t0, 3))
                    capture.grab(g).crop(box).save(os.path.join(self.out, f"{name}_{i:03d}.png"))
                self.log.append({"seq": name, "t": ts})
            elif cmd == "home":
                inp.move(*flows.MOUSE_AWAY)
                time.sleep(0.4)
                self.home = capture.grab(g)
                self.home.save(os.path.join(self.out, "home.png"))
            elif cmd == "flow":
                import probe
                probe.run_steps(g, inp, [st], self.out, self.log)
            elif cmd == "grid":
                self.grid(*[float(v) if "." in v else int(v) for v in arg.split(",")])
            else:
                raise ValueError(f"passo desconhecido: {st}")

    def grid(self, x0, y0, x1, y1, step, wait):
        import capture
        import flows
        g, inp = self.g, self.inp
        inp.move(*flows.MOUSE_AWAY)
        time.sleep(0.5)
        base = np.asarray(capture.grab(g), dtype=np.int16)
        res = []
        for y in range(y0, y1 + 1, step):
            for x in range(x0, x1 + 1, step):
                inp.move(x, y, steps=2)
                time.sleep(wait)
                img = capture.grab(g)
                a = np.asarray(img, dtype=np.int16)
                d = np.abs(a - base).sum(2) > 30
                d[max(0, y - 40):y + 40, max(0, x - 40):x + 40] = False   # cursor
                n = int(d.sum())
                # linhas/colunas do que mudou (etiqueta, brilho)
                if n > 30:
                    ys, xs = np.nonzero(d)
                    res.append({"pos": [x, y], "n": n, "bbox": [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]})
                    img.save(os.path.join(self.out, f"grid_{x}_{y}.png"))
                else:
                    res.append({"pos": [x, y], "n": n})
        json.dump(res, open(os.path.join(self.out, "grid.json"), "w"))
        print(f"grid: {sum(1 for r in res if r['n'] > 30)}/{len(res)} posicoes mudam a tela", flush=True)


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("state")
    ap.add_argument("out")
    ap.add_argument("steps")
    ap.add_argument("--max-runtime", type=float, default=300)
    a = ap.parse_args()
    if not acquire():
        print("[trava] nao consegui a trava")
        sys.exit(3)
    closer = None
    try:
        g, inp, closer = open_session(a.state, a.max_runtime)
        r = Runner(g, inp, a.out)
        try:
            r.run(a.steps.split())
        finally:
            json.dump(r.log, open(os.path.join(a.out, "log.json"), "w"))
    except Exception:  # noqa: BLE001
        traceback.print_exc()
    finally:
        if closer:
            try:
                closer()
            except Exception as e:  # noqa: BLE001
                print("[aviso] fechar:", e)
        release()
        from launch import list_game_pids
        print("allods2 restantes:", list_game_pids())


if __name__ == "__main__":
    main()
