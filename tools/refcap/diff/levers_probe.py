"""Alavancas no ORIGINAL (frente GRUPO-ALAVANCAS, 20/10): mede, na cópia a2_diff (relógio virtual + caixa de correio), como o
clique de USAR age sobre as alavancas da missão 103 (e 93/96) e o que Fireball/área fazem nelas.

Lido no C (notes/group-levers.md): o cliente manda o pacote 0x24 (alvo = id da estrutura) → tarefa 0xf (anda até Chebyshev ≤ 1 e
virado) → ação 0xf da máquina 0x50f12c: `s = 0x52c129(posição da unidade)` = 1ª estrutura da lista com Chebyshev(célula da estrutura,
(ux − 1, uy − 1)) ≤ 2 (0x52bfe7) — NÃO necessariamente a clicada; se o tipo é 28/29/76/77 (Switch/Switch 2/Altar 1/Altar 2) a vida
+0x42 alterna 0 ↔ 1 (vida máxima 1 no data.bin; 1 = desligada, 0 = ligada) e o servidor manda a estrutura aos clientes (0x503672).

    .venv\\Scripts\\python.exe tools/refcap/diff/levers_probe.py [--state m103_start] [--out refs/trace/levers/m103.json]
        [--only dump,pick,use,walk,puzzle,fireball]

Saída JSON: alavancas (id, tipo, célula, vida, tamanho), tabela "pick" (célula da unidade → estrutura escolhida por 0x52bfe7),
"use" (herói posto ao lado de cada alavanca, pacote 0x24 → quais vidas mudaram), "walk" (herói a ~5 células, anda sozinho),
"puzzle" (a solução do script: 4, 6, 7, 9 ligadas → Drop all(132), valores do script), "fireball" (Fireball/Blizzard sobre as
alavancas: vida de todas depois).
"""
from __future__ import annotations

import argparse
import ctypes
import ctypes.wintypes as wt
import json
import os
import struct
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import original_episode as oe  # noqa: E402
sys.path.insert(0, os.path.join(HERE, "..", "original"))
from build_m103 import patch_heroes  # noqa: E402
from build_m110 import patch_portrait  # noqa: E402

ROOT = oe.ROOT
MAP = 0x670E48            # [MAP] = mundo/mapa do servidor
AIOBJ = 0x66832C          # [AIOBJ] = objeto da IA/script (valores em +0xc784, gatilhos +0xe6c4)
GAMEOBJ = 0x6044C4        # [[GAMEOBJ]+0x7c] → lista de estruturas
F_STRUCT_AT = 0x552079    # Map_StructureAtCell(this=mapa, célula y<<8|x)
F_PICK = 0x52BFE7         # 1ª estrutura da lista a Chebyshev ≤ 2 da posição dada (this=lista, pos)
F_TELEPORT = 0x55A96C     # Unit_TeleportTo(this=mundo, unidade, x, y)
F_NEW = 0x401880          # operator new
F_SPELL = 0x51906D        # construtor do objeto de magia (this, id)
F_ADDSPELL = 0x51C29E     # Unit_AddSpellToBook(this=livro, id, objeto)


class Probe:
    def __init__(self, s: oe.Session):
        self.s, self.p, self.vc = s, s.p, s.vc
        k = ctypes.WinDLL("kernel32", use_last_error=True)
        k.VirtualAllocEx.restype = ctypes.c_void_p
        k.VirtualAllocEx.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.c_size_t, wt.DWORD, wt.DWORD]
        self.buf = k.VirtualAllocEx(self.p.h, None, 0x1000, 0x3000, 0x04)
        if not self.buf:
            raise OSError("VirtualAllocEx")

    # ------------------------------------------------------------ estruturas
    def world(self) -> int:
        return self.p.u32(MAP)

    def struct_at(self, x: int, y: int) -> int:
        return self.vc.call(F_STRUCT_AT, self.world(), [(y << 8) | x])

    def read_struct(self, a: int) -> dict:
        p = self.p
        pos = p.u32(a + 0x10)
        return {"addr": a, "vt": p.u32(a), "id": p.u32(a + 4), "type": struct.unpack("<H", p.read(a + 0xE, 2))[0],
                "x": p.u8(pos), "y": p.u8(pos + 1), "hp": p.i16(a + 0x42), "b40": p.u8(a + 0x40), "size": p.u8(a + 0x60)}

    def struct_list(self) -> int:
        return self.p.u32(self.p.u32(self.p.u32(GAMEOBJ) + 0x7C))

    def pick(self, ux: int, uy: int, addr: bool = False) -> int | None:
        """Estrutura que a ação 0xf usaria com a unidade na célula (ux, uy) (0x52c129: pos = (ux − 1, uy − 1))."""
        x, y = ux - 1, uy - 1
        self.p.write(self.buf, struct.pack("<BBHBBHI", x & 0xFF, y & 0xFF, ((y & 0xFF) << 8) | (x & 0xFF), 0x80, 0x80, 0, self.world()))
        a = self.vc.call(F_PICK, self.struct_list(), [self.buf])
        if addr:
            return a or None
        return self.p.u32(a + 4) if a else None

    def structures(self, any_cell: tuple[int, int]) -> dict[int, int]:
        """id → endereço de TODAS as estruturas (varredura pela vtable de uma achada pelo pick)."""
        a = self.pick(any_cell[0] + 1, any_cell[1] + 1, addr=True)
        if not a:
            return {}
        vt = self.p.u32(a)
        out = {}
        for b in self.p.scan(struct.pack("<I", vt), 4):
            try:
                sid = self.p.u32(b + 4)
                pos = self.p.u32(b + 0x10)
                if 0x6000 <= sid < 0x7000 and pos:
                    self.p.u8(pos)
                    out[sid] = b
            except OSError:
                continue
        return out

    # ------------------------------------------------------------ unidades
    def hero_addr(self) -> int:
        srv = self.s.srv
        srv.rescan()
        best = None
        for a in srv.units:
            try:
                vt, uid = struct.unpack("<II", self.p.read(a, 8))
            except OSError:
                continue
            if oe.UNIT_VTABLES.get(vt) == "hero" and (best is None or uid < best[1]):
                best = (a, uid)
        return best[0]

    def teleport(self, unit: int, x: int, y: int) -> int:
        wobj = self.p.u32(self.p.u32(AIOBJ) + 0xA50)
        return self.vc.call(F_TELEPORT, wobj, [unit, x, y])

    def boost(self, unit: int, hp: int = 30000, mana: int = 3000):
        self.p.write(unit + 0x94, struct.pack("<hh", hp, hp))
        self.p.write(unit + 0x9A, struct.pack("<hh", mana, mana))

    def peace(self, unit: int) -> list[int]:
        """Tira o bit de guerra (bit 0 de diplo[a][b], [[0x66832c]+0xa8bc+8], passo 0x46) entre o jogador da unidade e todos: os
        monstros do anel (tipo 104) deixam de atacar o herói durante as medições (não mexe em quem já está em paz, p.ex. o xamã)."""
        me = self.p.i16(self.p.u32(unit + 0x14) + 4)
        base = self.p.u32(AIOBJ) + 0xA8BC + 8
        changed = []
        for b in range(16):
            for i, j in ((me, b), (b, me)):
                v = self.p.u8(base + i * 0x46 + j)
                if v & 1 and i != j:
                    self.p.write(base + i * 0x46 + j, bytes([v & 0xFE]))
                    changed.append(b)
        return sorted(set(changed))

    def grant(self, unit: int, spells: list[int]) -> list[int]:
        book = self.p.u32(unit + 0x140)
        out = []
        for sid in spells:
            o = self.vc.call(F_NEW, 0, [0x14])
            self.vc.call(F_SPELL, o, [sid])
            self.vc.call(F_ADDSPELL, book, [sid, o])
            out.append(sid)
        return out

    def triggers(self, n: int = 40) -> list[int]:
        return list(self.p.read(self.p.u32(AIOBJ) + 0xE6C4, n))

    def values(self, n: int = 90) -> list[int]:
        b = self.p.read(self.p.u32(AIOBJ) + 0xC784, 4 * n)
        return list(struct.unpack(f"<{n}i", b))

    def sacks(self, cells: list[tuple[int, int]]) -> list[list[int]]:
        w = self.world()
        return [[x, y] for x, y in cells if self.p.u8(w + 0x10000 + (y << 8) + x) & 0x20]

    def step(self, n: int):
        s = self.s
        t = s.srv.time16()
        try:
            s.vc.step(n, alive=s.g.check_alive)
        except TimeoutError:                      # janela modal (fala/caixa): fecha e espera o GATE voltar
            for _ in range(6):
                oe.flows.dismiss_dialogs(s.g, s.inp)
                try:
                    s.vc.wait_gate(2, timeout=3, alive=s.g.check_alive)
                    break
                except TimeoutError:
                    continue
            else:
                raise
        lost = n - (s.srv.time16() - t)
        tries = 0
        while lost > 0 and tries < 20:
            oe.flows.dismiss_dialogs(s.g, s.inp)
            t = s.srv.time16()
            s.vc.step(lost, alive=s.g.check_alive)
            lost -= s.srv.time16() - t
            tries += 1


def lever_cells(mission: int) -> dict[int, tuple[int, int]]:
    d = json.load(open(os.path.join(ROOT, "game", "public", "data", "scripts", f"{mission}.json"), encoding="utf-8"))
    return {s["id"]: (int(s["x"]), int(s["y"])) for s in d["structures"] if s["kind"] in (28, 29)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", default="m103_start")
    ap.add_argument("--mission", type=int, default=103)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--out", default=os.path.join(ROOT, "refs", "trace", "levers", "m103.json"))
    ap.add_argument("--only", default="dump,pick,use,walk,puzzle,fireball")
    ap.add_argument("--levers", help="só estas alavancas nos testes use/walk (ex.: 9,10,11,12)")
    a = ap.parse_args()
    only = set(a.only.split(","))
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    cells = lever_cells(a.mission)
    sel = {int(x) for x in a.levers.split(",")} if a.levers else None
    res: dict = json.load(open(a.out, encoding="utf-8")) if os.path.exists(a.out) else {}
    res.update({"state": a.state, "seed": a.seed, "cells_map": {k: list(v) for k, v in cells.items()}})
    oe.acquire_lock("levers_probe")
    try:
        with oe.Session(1800) as s:
            patch_heroes(s.p)
            patch_portrait(s.p)
            pr = Probe(s)

            def fresh():
                SA.clear()
                s.load(a.state, a.seed)
                s.rd.rescan()
                s.rd.set_seed(a.seed)
                s.vc.time_on(oe.VTIME0)

            SA: dict[int, int] = {}

            def levers() -> dict[int, dict]:
                if not SA or any(pr.p.u32(v + 4) != k for k, v in SA.items()):
                    SA.clear()
                    SA.update(pr.structures(next(iter(cells.values()))))
                out = {}
                for lid in cells:
                    st = SA.get(0x6000 + lid)
                    out[lid] = pr.read_struct(st) if st else None
                return out

            def hps() -> dict[int, int | None]:
                return {k: (v["hp"] if v else None) for k, v in levers().items()}

            fresh()
            L = levers()
            res["levers"] = {k: ({kk: vv for kk, vv in v.items() if kk not in ("addr",)} if v else None) for k, v in L.items()}
            res["map_is_world"] = pr.p.u32(pr.p.u32(AIOBJ) + 0xA50) == pr.world()
            res["values0"] = pr.values()
            print("alavancas:", {k: (v["id"], v["type"], v["x"], v["y"], v["hp"], v["size"]) if v else None for k, v in L.items()},
                  flush=True)
            if "pick" in only:
                tab = {}
                for lid, (x, y) in cells.items():
                    row = {}
                    for dy in (-1, 0, 1):
                        for dx in (-1, 0, 1):
                            if dx or dy:
                                row[f"{dx},{dy}"] = pr.pick(x + dx, y + dy)
                    tab[lid] = row
                res["pick"] = tab
                print("pick:", json.dumps(tab), flush=True)
            hero = pr.hero_addr()
            hid = pr.p.u32(hero + 4)
            res["hero"] = hid

            def use_from(lid: int, hx: int, hy: int, ticks: int = 160) -> dict:
                fresh()
                h = pr.hero_addr()
                pr.boost(h)
                res.setdefault("peace", pr.peace(h))
                before = hps()
                ok = pr.teleport(h, hx, hy)
                pr.step(2)
                p0 = (pr.p.u8(pr.p.u32(h + 0x10)), pr.p.u8(pr.p.u32(h + 0x10) + 1))
                s.vc.command("use", [hid], target=L[lid]["id"])
                trace = []
                for k in range(ticks // 4):
                    pr.boost(h)
                    pr.step(4)
                    pos = pr.p.u32(h + 0x10)
                    hp = hps()
                    trace.append({"t": 4 * (k + 1), "x": pr.p.u8(pos), "y": pr.p.u8(pos + 1), "task": pr.p.u32(h + 0x50),
                                  "act": pr.p.u32(h + 0x54), "changed": {i: v for i, v in hp.items() if v != before[i]}})
                after = hps()
                ch = {i: [before[i], after[i]] for i in after if after[i] != before[i]}
                first = next((f for f in trace if f["changed"]), None)
                return {"lever": lid, "from": [hx, hy], "teleport_ret": ok, "start": list(p0), "changed": ch,
                        "at": first and {"t": first["t"], "x": first["x"], "y": first["y"]},
                        "end": [trace[-1]["x"], trace[-1]["y"]], "task_end": trace[-1]["task"]}

            def run_set(key, starts, ticks):
                out = [r for r in res.get(key, []) if sel is None or r["lever"] not in sel]
                for lid, (x, y) in cells.items():
                    if (a.mission == 103 and lid > 12) or (sel is not None and lid not in sel):
                        continue
                    for hx, hy in starts(x, y):
                        try:
                            r = use_from(lid, hx, hy, ticks)
                        except (TimeoutError, OSError) as e:
                            r = {"lever": lid, "from": [hx, hy], "error": str(e)}
                            s.g.check_alive()
                        out.append(r)
                        print(key, lid, (hx, hy), r.get("changed"), r.get("at"), r.get("error", ""), flush=True)
                res[key] = sorted(out, key=lambda r: (r["lever"], r["from"]))

            if "use" in only:
                run_set("use", lambda x, y: [(x + dx, y + dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))], 64)
            if "walk" in only:
                run_set("walk", lambda x, y: [(24, 77), (x + 5, y), (x - 5, y)], 240)
            if "puzzle" in only and a.mission == 103:
                fresh()
                h = pr.hero_addr()
                pr.boost(h)
                res.setdefault("peace", pr.peace(h))
                seq = []
                ring = [(x, y) for x in range(18, 31) for y in range(71, 84)]
                for lid in (4, 6, 7, 9):
                    x, y = cells[lid]
                    best = next(((x + dx, y + dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1))
                                 if pr.pick(x + dx, y + dy) == L[lid]["id"]), None)
                    if best is None:
                        seq.append({"lever": lid, "skip": "nenhuma célula vizinha escolhe esta alavanca"})
                        continue
                    pr.teleport(h, *best)
                    pr.step(2)
                    s.vc.command("use", [hid], target=L[lid]["id"])
                    pr.step(48)
                    seq.append({"lever": lid, "from": list(best), "hp": hps(), "sacks": pr.sacks(ring)})
                pr.step(64)
                res["puzzle"] = {"steps": seq, "hp": hps(), "values": pr.values(), "sacks": pr.sacks(ring)}
                print("puzzle:", json.dumps(res["puzzle"]["hp"]), res["puzzle"]["sacks"], flush=True)
            if "extra" in only and a.mission == 103:
                # (1) gatilhos antes/depois da solução; (2) Fireball 2× na MESMA alavanca (ligada → ?); (3) usar depois da Fireball
                ex = {}
                fresh()
                h = pr.hero_addr()
                pr.boost(h)
                pr.peace(h)
                pr.step(16)
                ex["trig0"] = pr.triggers()
                for lid in (4, 6, 7, 9):
                    x, y = cells[lid]
                    best = next((x + dx, y + dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1)) if pr.pick(x + dx, y + dy) == L[lid]["id"])
                    pr.teleport(h, *best)
                    pr.step(2)
                    s.vc.command("use", [hid], target=L[lid]["id"])
                    pr.boost(h)
                    pr.step(48)
                pr.step(64)
                ex["trig_puzzle"] = pr.triggers()
                ex["hp_puzzle"] = hps()
                ex["units_puzzle"] = [u for u in s.rd.units() if u["id"] in (132, 131) or abs(u["x"] - 24) + abs(u["y"] - 77) <= 2]
                # desfaz a 4: a solução deixa de valer → os gatilhos "once" não voltam
                x, y = cells[4]
                pr.teleport(h, x + 1, y)
                pr.step(2)
                s.vc.command("use", [hid], target=L[4]["id"])
                pr.step(48)
                ex["hp_undo4"] = hps()
                ex["values_undo4"] = pr.values(40)
                fresh()
                h = pr.hero_addr()
                pr.boost(h)
                pr.peace(h)
                pr.grant(h, [2])
                x, y = cells[6]
                seq = []
                for k in range(3):
                    pr.teleport(h, x + 5, y)
                    pr.step(2)
                    s.vc.command("cast_point", [hid], x=x, y=y, spell=2)
                    for _ in range(20):
                        pr.boost(h)
                        pr.step(4)
                    seq.append({"fireball": k + 1, "hp": hps()[6]})
                pr.teleport(h, x + 1, y)
                pr.step(2)
                s.vc.command("use", [hid], target=L[6]["id"])
                pr.step(48)
                seq.append({"use_after": True, "hp": hps()[6]})
                ex["fireball_repeat"] = seq
                res["extra"] = ex
                print("extra:", json.dumps({k: v for k, v in ex.items() if k != "units_puzzle"})[:1500], flush=True)
            if "fireball" in only:
                out = []
                for spell, lid in ((2, 6), (2, 10), (7, 6), (3, 10), (2, 1)):
                    if lid not in cells:
                        continue
                    fresh()
                    h = pr.hero_addr()
                    pr.boost(h)
                    res.setdefault("peace", pr.peace(h))
                    pr.grant(h, [spell])
                    x, y = cells[lid]
                    pr.teleport(h, x + 5, y)
                    pr.step(2)
                    before = hps()
                    s.vc.command("cast_point", [hid], x=x, y=y, spell=spell)
                    tl = []
                    for k in range(40):
                        pr.boost(h)
                        pr.step(4)
                        hp = hps()
                        tl.append({"t": 4 * (k + 1), "hp": {i: v for i, v in hp.items() if v != before[i]},
                                   "mana": pr.p.i16(h + 0x9A)})
                    after = hps()
                    out.append({"spell": spell, "lever": lid, "at": [x, y], "before": before, "after": after,
                                "changed": {i: [before[i], after[i]] for i in after if after[i] != before[i]},
                                "first": next((f for f in tl if f["hp"]), None), "mana_end": tl[-1]["mana"],
                                "exists_after": sorted(k - 0x6000 for k in pr.structures(next(iter(cells.values()))))})
                    print("spell", spell, "lever", lid, out[-1]["changed"], flush=True)
                res["fireball"] = out
    finally:
        oe.release_lock()
        json.dump(res, open(a.out, "w", encoding="utf-8"), indent=1, default=str)
        print("gravado", a.out)


if __name__ == "__main__":
    main()
