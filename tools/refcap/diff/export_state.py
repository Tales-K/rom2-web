"""Exporta o ESTADO do servidor do allods2.exe (cópia a2_diff) para JSON — fase 2 do teste diferencial (notes/differential-fuzz.md).

    .venv\\Scripts\\python.exe tools/refcap/diff/export_state.py --state m10_start [--seed 7] [--out refs/trace/diff/state_m10_start.json]
        [--raw] [--ticks N --script s.json]   (roda N tiques com o roteiro antes de exportar)

Lê, com o servidor PARADO (relógio virtual), todas as unidades vivas e corpos (varredura por vtable, orig_mem.Server.rescan) com os
campos da estrutura do servidor (notes/data-bin-format.md, notes/ai-behaviors.md, notes/magic-original.md):
  id +4, tipo +0xe, objeto de mapa +0x10 (x, y, célula, subx, suby), jogador +0x14(+4), tarefa +0x50, estado +0x54,
  Body/Reaction/Mind/Spirit +0x84..+0x8a, Speed +0x8c, carga/capacidade +0x90/+0x92, vida +0x94/+0x96/+0x98, mana +0x9a/+0x9c/+0x9e,
  scanRange +0xa5 (células), toHit +0xa6, habilidades +0xa8+2i, dano +0xb4/+0xb5, tipo de arma +0xb6, dano elemental +0xb7..,
  defesa +0xbe, absorção +0xc0, proteções +0xc2+2i, resistências +0xce+i, alcance +0x12c, experiência +0x130, charge/relax +0x134,
  corpo +0x13c, livro +0x140 (CPtrArray: dados +8, tamanho +0xc; entrada = magia por id: +8 id, +9 alcance, +0xc mana),
  efeitos +0x144, invocador +0x148, sem saque +0x1a0;
  +0x1c0 movimento: [0] direção<<5, +6 posto do grupo, +8 raio de guarda, +0xa giro, +0x72 velocidade atual (Speed×8/F[célula]);
  +0x1c4 tarefa/IA: [0] posto (word), +8 modo, +0xa célula destino, +0xc alvo, +0x14 alcance de ataque, +0x40 Withdraw,
  +0x44 Wimpy, +0x4c classe de recuo, +0x71 See invisible, +0x78 magia escolhida, +0x7c.. Spell1..3 / Probability1..3.
Global: tique e relógio 16/s, estado do rand(), diplomacia (objeto de IA [0x66832c] + 0xa8bc + 8: byte [a×0x46 + b], bit 0 =
guerra de a contra b; 0x12 na diagonal), tabela de velocidade do terreno F (objeto de caminho [0x670e48] + y×256 + x, byte por
célula; passo do andar = Speed×8/F, notes/differential-fuzz.md fase 2) e marcas de célula (+0x10000: bit 0x20 = saco).
Inventário/equipamento do herói: só os campos DERIVADOS (toHit, dano, defesa, absorção, proteções; ponteiros +0x70..+0x80 crus).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
import original_episode as oe  # noqa: E402  (configura sys.path e A2_RUN_DIR)
from orig_mem import GAME_PTR, UNIT_VTABLES  # noqa: E402
from orig_trace import acquire_lock, release_lock  # noqa: E402

PATH_PTR = 0x670E48
AI_PTR = 0x66832C
DIPLO_OFF = 0xA8BC + 8
DIPLO_STRIDE = 0x46


def _h(b, o):
    return struct.unpack_from("<h", b, o)[0]


def _H(b, o):
    return struct.unpack_from("<H", b, o)[0]


def _I(b, o):
    return struct.unpack_from("<I", b, o)[0]


def read_book(p, book: int) -> list[dict]:
    if not book:
        return []
    try:
        data, size = p.u32(book + 8), p.u32(book + 0xC)
        if not data or size > 64:
            return []
        out = []
        for i, e in enumerate(struct.unpack(f"<{size}I", p.read(data, 4 * size))):
            if e:
                s = p.read(e, 0x12)
                out.append({"slot": i, "id": s[8], "range": s[9], "defensive": s[0xA], "mana": _h(s, 0xC), "dmin": s[0xE],
                            "damp": s[0xF], "f10": _h(s, 0x10)})
        return out
    except OSError:
        return []


def read_unit(p, a: int, players: dict, raw: bool = False) -> dict | None:
    try:
        b = p.read(a, 0x1D0)
    except OSError:
        return None
    vt, uid = struct.unpack_from("<II", b, 0)
    if vt not in UNIT_VTABLES:
        return None
    mo, pl = _I(b, 0x10), _I(b, 0x14)
    try:
        m = p.read(mo, 6)
        if pl not in players:
            players[pl] = p.i16(pl + 4) if pl else -1
        mv_p, ai_p = _I(b, 0x1C0), _I(b, 0x1C4)
        mv = p.read(mv_p, 0x90) if mv_p else bytes(0x90)
        ai = p.read(ai_p, 0xA0) if ai_p else bytes(0xA0)
    except OSError:
        return None
    target = 0
    tptr = _I(ai, 0xC)
    if tptr:
        try:
            target = p.u32(tptr + 4)
        except OSError:
            target = -1
    u = {
        "id": uid, "kind": UNIT_VTABLES[vt], "type": _H(b, 0xE), "player": players[pl],
        "x": m[0], "y": m[1], "cell": _H(m, 2), "sx": m[4], "sy": m[5], "fx": m[0] + m[4] / 256, "fy": m[1] + m[5] / 256,
        "task": _I(b, 0x50), "state": _I(b, 0x54),
        # máquina de ação 0x50f12c (fase 6): fase da ação +0x58 (0 início, 5 carga, 7 espera), contador +0x6c, pronto +0x136
        "act_phase": _I(b, 0x58), "act_cnt": b[0x6C], "act_ready": b[0x136],
        "body": _h(b, 0x84), "reaction": _h(b, 0x86), "mind": _h(b, 0x88), "spirit": _h(b, 0x8A), "speed": _h(b, 0x8C),
        "load": _h(b, 0x90), "capacity": _h(b, 0x92),
        "hp": _h(b, 0x94), "hpmax": _h(b, 0x96), "hpregen": _h(b, 0x98), "mana": _h(b, 0x9A), "manamax": _h(b, 0x9C),
        "manaregen": _h(b, 0x9E), "scan": b[0xA5], "scan256": _H(b, 0xA4), "toHit": _h(b, 0xA6),
        "skills": [_h(b, 0xA8 + 2 * i) for i in range(6)],
        "dmin": b[0xB4], "damp": b[0xB5], "wtype": b[0xB6], "eldmg": list(b[0xB7:0xBC]),
        "defense": _h(b, 0xBE), "absorb": _h(b, 0xC0), "prot": [_h(b, 0xC2 + 2 * i) for i in range(6)],
        "resist": list(b[0xCE:0xD4]), "range": struct.unpack_from("<i", b, 0x12C)[0], "exp": _I(b, 0x130),
        "charge": b[0x134], "relax": b[0x135], "body_state": _I(b, 0x13C), "effects": _I(b, 0x144), "summoner": _I(b, 0x148),
        "noloot": _I(b, 0x1A0),
        "dir": mv[0] >> 5, "angle": mv[0], "pmask": mv[5], "group_post": _H(mv, 6), "guard_radius": _H(mv, 8), "turn": _H(mv, 0xA), "cur_speed": _H(mv, 0x72),
        "post": _H(ai, 0), "mode": ai[8], "dest": _H(ai, 0xA), "target": target, "attack_range": _I(ai, 0x14),
        "withdraw": _I(ai, 0x40), "wimpy": _I(ai, 0x44), "retreat": _I(ai, 0x4C), "see_invis": ai[0x71],
        # olhar em volta (0x56e5bc) / perseguição da guarda 0x12 (0x5728fa): rumo desejado, +0x54 "golpeado", seg. da perseguição
        # inalcançável (+0x16), relógio do golpe (+0x98) e ponto de fuga (+0x9c) — DIFF-FUZZ fase 5
        "want": mv[1], "look_hit": _I(ai, 0x54), "sub9": ai[9],
        "unreach_sec_raw": _H(ai, 0x16), "hit_clock16": _I(ai, 0x98), "flee_cell": _H(ai, 0x9C),
        "chosen_spell": ai[0x78], "ai_spells": list(struct.unpack_from("<3I", ai, 0x7C)), "ai_probs": list(struct.unpack_from("<3I", ai, 0x88)),
        "book": read_book(p, _I(b, 0x140)),
        "ptrs": [hex(_I(b, o)) for o in (0x70, 0x74, 0x78, 0x7C, 0x80)],
    }
    # caminho em curso (0x555411/0x55574d): lista estática +0x1c8 e dinâmica +0x1e4 (CList: cabeça +4, nó {próximo, anterior, word
    # célula}), destino do estático +0x74, última célula +0x76, contadores +9 / +0x78, perseguição: alvo +0x7c, tamanho +0x8a, célula +0x8c
    def _cells(lst: int) -> list[int]:
        out, node = [], p.u32(lst + 4)
        while node and len(out) < 512:
            out.append(p.u16(node + 8) if hasattr(p, "u16") else struct.unpack("<H", p.read(node + 8, 2))[0])
            node = p.u32(node)
        return out
    try:
        tr = _I(mv, 0x7C)
        u["walk"] = {"static": _cells(a + 0x1C8), "dynamic": _cells(a + 0x1E4), "goal": _H(mv, 0x74), "final": _H(mv, 0x76),
                     "c9": mv[9], "c78": mv[0x78], "track": p.u32(tr + 4) if tr else 0, "slen": _H(mv, 0x8A), "tcell": _H(mv, 0x8C)}
    except OSError:
        pass
    # velocidade efetiva do andar (0x55915a): byte [[[+0x70]+0x3c]+0x44] se ≠ 0, senão Speed (+0x8c)
    try:
        o70 = _I(b, 0x70)
        sp = p.read(p.u32(o70 + 0x3C) + 0x44, 1)[0] if o70 else 0
    except OSError:
        sp = 0
    u["speed_eff"] = sp or u["speed"]
    if raw:
        u["raw"] = {"unit": b.hex(), "mv": mv.hex(), "ai": ai.hex()}
    return u


def _olist(p, lst: int, limit: int = 4096) -> list[int]:
    """Dados de uma lista MFC (CObList/CTypedPtrList): cabeça +4, nó {+0 próximo, +4 anterior, +8 dado}."""
    out, node = [], p.u32(lst + 4) if lst else 0
    while node and len(out) < limit:
        out.append(p.u32(node + 8))
        node = p.u32(node)
    return out


def read_groups(p, players: dict) -> list[dict]:
    """Grupos de IA de cada jogador (0x570087: lista em [jogador+0x28]; grupo = lista de unidades, +0x3c comando: +0x20 tipo,
    +0x28 centro (célula), +0x2d raio da guarda (base + 4 ± 1, sorteado no 1º pensamento), +0x30 em combate, +0x34 contador) e o alvo
    atribuído a cada unidade (+0x1c4+0x20, 0x57240b)."""
    out = []
    for pl, num in players.items():
        if not pl:
            continue
        try:
            for g in _olist(p, p.u32(pl + 0x28)):
                cmd = p.u32(g + 0x3C)
                c = p.read(cmd, 0x48) if cmd else bytes(0x48)
                units = []
                for u in _olist(p, g):
                    try:
                        ai = p.u32(u + 0x1C4)
                        at = p.u32(ai + 0x20) if ai else 0
                        units.append({"id": p.u32(u + 4), "assigned": p.u32(at + 4) if at else 0})
                    except OSError:
                        pass
                out.append({"player": num, "cmd": c[0x20], "center": _H(c, 0x28), "radius": c[0x2D], "base": c[0x38], "combat": _I(c, 0x30),
                            "count": _I(c, 0x34), "units": units})
        except OSError:
            continue
    return out


def read_vision_tables(p) -> dict:
    """Tabelas da visão do exe (objeto em [0x670e48]+0x58ec0; 0x552c28): pai de cada célula da janela 41×41 (+0x22000, 2 bytes com
    sinal por célula, linha = x × 128 + y × 2), custo do passo (+0x28000, word com sinal, mesma indexação) e o deslocamento do
    orçamento (+0x2a004: orçamento do centro = (scanRange << s) + (1 << (s − 1)))."""
    v = p.u32(PATH_PTR) + 0x58EC0
    par = p.read(v + 0x22000, 41 * 128)
    cost = p.read(v + 0x28000, 41 * 128)
    shift = p.u32(v + 0x2A004)
    return {"parent": [[list(struct.unpack_from("<2b", par, x * 128 + y * 2)) for y in range(41)] for x in range(41)],
            "cost": [[struct.unpack_from("<h", cost, x * 128 + y * 2)[0] for y in range(41)] for x in range(41)],
            "shift": shift, "rect": list(p.read(p.u32(PATH_PTR) + 0x58EB8, 4))}


def read_state(p, srv, rd, mission: int | None = None, wh: tuple[int, int] | None = None, raw: bool = False) -> dict:
    """Estado completo com o servidor parado. `wh` = tamanho do mapa (para a tabela F e as marcas de célula)."""
    players: dict = {}
    units = {}
    for a in srv.units:
        u = read_unit(p, a, players, raw)
        if u and u["id"] not in units:
            units[u["id"]] = u
    gp = p.u32(GAME_PTR)
    st = {"src": "orig", "mission": mission, "tick": p.i32(gp) if gp else -1, "t16": p.i32(gp + 4) if gp else -1,
          "rng": rd.rng(), "units": [units[k] for k in sorted(units)]}
    st["groups"] = read_groups(p, players)
    heroes = [u["id"] for u in st["units"] if u["kind"] == "hero"]
    st["hero"] = min(heroes) if heroes else None
    try:
        ai = p.u32(AI_PTR)
        m = p.read(ai + DIPLO_OFF, DIPLO_STRIDE * 16)
        st["diplomacy"] = [[m[a * DIPLO_STRIDE + c] for c in range(16)] for a in range(16)]
    except OSError:
        st["diplomacy"] = None
    if wh:
        w, h = wh
        pth = p.u32(PATH_PTR)
        F, sacks, b1, b2 = [], [], [], []
        for y in range(h):
            F.append(list(p.read(pth + y * 256, w)))
            fl = p.read(pth + 0x10000 + y * 256, w)
            sacks += [[x, y] for x in range(w) if fl[x] & 0x20]
            b1.append(fl.hex())
            b2.append(p.read(pth + 0x20000 + y * 256, w).hex())
        st["terrain_speed"] = F            # F[y][x]; passo = Speed×8/F por tique de 16/s (1/256 de célula)
        st["sack_cells"] = sacks
        # planos de passagem do caminho (0x54d76e/0x55d010: vizinho bloqueado se plano1[c] & máscara da unidade +0x1c0+5)
        st["plane1"], st["plane2"] = b1, b2
        # altura por célula (byte com sinal em +0x944f4, 0x559195: passo × (1 ± Δh/64) no trecho de célula a célula)
        st["altitude"] = [list(struct.unpack(f"<{w}b", p.read(pth + 0x944F4 + y * 256, w))) for y in range(h)]
    return st


def mission_of(state: str) -> int | None:
    m = re.match(r"m(\d+)_", state)
    return int(m.group(1)) if m else None


def map_wh(mission: int | None) -> tuple[int, int] | None:
    if mission is None:
        return None
    f = os.path.join(ROOT, "game", "public", "data", "maps", f"{mission}.json")
    if not os.path.exists(f):
        return None
    d = json.load(open(f, encoding="utf-8"))
    return d["w"], d["h"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", default="m10_start")
    ap.add_argument("--states", help="vários estados separados por vírgula (um processo)")
    ap.add_argument("--seed", type=lambda s: int(s, 0), default=7)
    ap.add_argument("--mission", type=int)
    ap.add_argument("--out")
    ap.add_argument("--raw", action="store_true")
    ap.add_argument("--max-runtime", type=float, default=900)
    a = ap.parse_args()
    states = a.states.split(",") if a.states else [a.state]
    acquire_lock("export_state")
    try:
        with oe.Session(a.max_runtime) as s:
            for state in states:
                s.load(state, a.seed)
                s.rd.rescan()
                s.rd.set_seed(a.seed)
                mission = a.mission or mission_of(state)
                st = read_state(s.p, s.srv, s.rd, mission, map_wh(mission), a.raw)
                st.update({"state": state, "seed": a.seed})
                try:
                    st["vision"] = read_vision_tables(s.p)
                    st["vision"]["selfcheck"] = s.p.u32(s.p.u32(PATH_PTR) + 0x58EC0 + 0x3A008) == s.p.u32(PATH_PTR)
                except OSError as e:
                    st["vision"] = {"error": str(e)}
                out = a.out if (a.out and len(states) == 1) else os.path.join(ROOT, "refs", "trace", "diff", f"state_{state}.json")
                os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
                with open(out, "w", encoding="utf-8") as fh:
                    json.dump(st, fh, separators=(",", ":"))
                print(json.dumps({"state": state, "out": out, "units": len(st["units"]), "hero": st["hero"]}), flush=True)
    finally:
        release_lock()


if __name__ == "__main__":
    main()
