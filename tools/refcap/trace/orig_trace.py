"""Traço de telemetria do jogo ORIGINAL (JSONL, um quadro por amostra) a partir de um estado salvo.

    .venv\\Scripts\\python.exe tools/refcap/trace/orig_trace.py --state m10_start --secs 20 --hz 20 --out refs/trace/m10_orig.jsonl
        [--seed 12345] [--pause-seed] [--orders orders.json] [--rng-log]

- Trava scratch/refcap.lock (falha se existir; espera 20 s, até 90 tentativas) e a apaga no fim, também em erro; o jogo é fechado.
- `--seed N`: escreve N no estado do rand() de TODAS as threads que já usaram o CRT (_tiddata+0x14) logo depois de carregar.
  Com `--pause-seed`, pausa (tecla Pause), escreve a semente e retoma — o servidor não anda enquanto a janela de pausa está aberta.
- `--orders`: lista JSON [{"t16": T | "sec": s, "unit": id|"hero", "move": [x, y] | "attack": idDoAlvo}] aplicada quando o relógio de
  16/s ([[0x6044c4]+4], relativo ao início) chega a T, escrevendo a TAREFA da unidade no servidor (despachante 0x569321: +0x50 = 1 andar
  até +0x1c4+0xa, ou 3 atacar +0x1c4+0xc) — sem cliques.
- Formato de cada linha: {"src":"orig","tick"(contador de 1/s),"t16","t16rel","sec","wall_ms","seeds"?:{tid:seed},"units":[{id,kind,
  type,player,x,y,fx,fy,hp,hpmax,mana,manamax,task,mode,target,state}]} (notes/telemetry.md).
"""
from __future__ import annotations

import argparse
import json
import os
import struct
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(HERE, "..", "original"))
sys.path.insert(0, HERE)
from orig_mem import Server  # noqa: E402

LOCK = os.path.join(ROOT, "scratch", "refcap.lock")


def acquire_lock(tag: str, tries: int = 90, wait: float = 20):
    os.makedirs(os.path.dirname(LOCK), exist_ok=True)
    for i in range(tries):
        try:
            fd = os.open(LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, f"{tag} pid {os.getpid()} {time.ctime()}".encode())
            os.close(fd)
            return
        except FileExistsError:
            print(f"   [lock] ocupado ({i + 1}/{tries}); aguardando {wait:.0f}s", flush=True)
            time.sleep(wait)
    raise SystemExit("não consegui o lock do jogo original")


def release_lock():
    try:
        os.remove(LOCK)
    except FileNotFoundError:
        pass


def apply_order(srv: Server, o: dict, hero_id: int | None):
    uid = hero_id if o.get("unit") == "hero" else int(o["unit"])
    for a in srv.units:
        try:
            if srv.p.u32(a + 4) != uid:
                continue
            td = srv.p.u32(a + 0x1C4)
            if not td:
                return False
            # tarefas do despachante 0x569321: 1 = andar até +0x1c4+0xa (0x569409), 3 = atacar +0x1c4+0xc (0x569428)
            if "move" in o:
                x, y = o["move"]
                srv.p.write(td + 0xA, struct.pack("<H", (x & 0xFF) | ((y & 0xFF) << 8)))
                srv.p.write(a + 0x50, struct.pack("<I", 1))
                return True
            if "attack" in o:
                tgt = next((b for b in srv.units if srv.p.u32(b + 4) == int(o["attack"])), None)
                if tgt is None:
                    return False
                srv.p.write(td + 0xC, struct.pack("<I", tgt))
                srv.p.write(a + 0x50, struct.pack("<I", 3))
                return True
        except OSError:
            return False
    return False


def trace(g, srv: Server, secs: float, hz: float, out, orders: list[dict], rng_log: bool):
    srv.rescan()
    hero = next((u for u in (srv.read_unit(a) for a in srv.units) if u and u["kind"] == "hero"), None)
    hero_id = hero["id"] if hero else None
    t0 = time.perf_counter()
    nxt = t0
    last_scan = t0
    pend = sorted(orders, key=lambda o: o.get("t16", o.get("tick", 0)))
    t16_0 = srv.time16()
    n = 0
    while time.perf_counter() - t0 < secs:
        g.check_alive()
        now = time.perf_counter()
        if now - last_scan > 1.0:
            srv.rescan()
            last_scan = now
        f = srv.frame()
        f["wall_ms"] = round((now - t0) * 1000, 1)
        f["t16rel"] = f["t16"] - t16_0
        f["sec"] = f["t16rel"] / 16
        while pend and f["t16rel"] >= pend[0].get("t16", 16 * pend[0].get("sec", 0)):
            o = pend.pop(0)
            f.setdefault("orders", []).append({**o, "ok": apply_order(srv, o, hero_id)})
        if rng_log:
            f["seeds"] = {str(k): v for k, v in srv.seeds().items()}
        out.write(json.dumps(f) + "\n")
        n += 1
        nxt += 1 / hz
        time.sleep(max(0.0, nxt - time.perf_counter()))
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", default="m10_start")
    ap.add_argument("--secs", type=float, default=20)
    ap.add_argument("--hz", type=float, default=20)
    ap.add_argument("--out", required=True)
    ap.add_argument("--seed", type=lambda s: int(s, 0))
    ap.add_argument("--pause-seed", action="store_true")
    ap.add_argument("--orders")
    ap.add_argument("--rng-log", action="store_true")
    a = ap.parse_args()
    orders = json.load(open(a.orders, encoding="utf-8")) if a.orders else []
    acquire_lock("orig_trace")
    try:
        from load_state import open_state
        with open_state(a.state, max_runtime=a.secs + 120) as (g, inp):
            srv = Server()
            if a.seed is not None:
                if a.pause_seed:
                    inp.key("pause")
                    g.wait(0.5)
                for tid in srv.tiddata():
                    srv.set_seed(tid, a.seed)
                if a.pause_seed:
                    inp.key("enter")
                    g.wait(0.2)
            os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
            with open(a.out, "w", encoding="utf-8") as out:
                n = trace(g, srv, a.secs, a.hz, out, orders, a.rng_log)
            print(f"ok: {n} quadros em {a.out}")
    finally:
        release_lock()


if __name__ == "__main__":
    main()
