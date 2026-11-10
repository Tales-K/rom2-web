"""Executor de EPISÓDIOS do jogo ORIGINAL para o teste diferencial (fase 1; desenho em notes/differential-fuzz.md).

Um episódio = (estado da biblioteca refs/original/saves, semente do rand(), roteiro de ações em tiques do servidor, N tiques).
O jogo abre UMA vez (cópia a2_diff = rand do cliente remendado + relógio virtual, make_diff_runtime.py); cada episódio recarrega o
estado pelo F3 dentro do mesmo processo, escreve a semente com o servidor parado e roda tique a tique: as ordens entram como o
pacote do cliente (vclock.command) entre dois tiques, sempre no mesmo tique.

    .venv\\Scripts\\python.exe tools/refcap/diff/original_episode.py --state m10_start --seed 7 --script s.json --ticks 400 \\
        --out refs/trace/diff/x.jsonl [--repeat 2] [--episodes lista.json] [--every 1] [--rescan-every 32]

- `--script`: JSON = lista de ações ou {"actions": [...]} (outras chaves são ignoradas; o bloco "ours" é do trace_run.ts). Ação:
  {"t": tique (0 = antes do 1º tique), "do": "move"|"attack"|"stop"|"guard"|"cast"|"pickup"|"select", "unit": id | "hero" | [ids]
   (omitido = a seleção atual), "x", "y", "target": id | "hero", "spell": id da magia (cast; com "target" = na unidade, senão no
   ponto x, y)}. Também aceita o formato de ordens do orig_trace/trace_run ({"t16"|"sec", "unit", "move": [x, y] | "attack": id}).
- `--episodes`: lista JSON de episódios {"state", "seed", "script" (caminho ou lista), "ticks", "out"} rodados em sequência.
- `--repeat N`: roda o mesmo episódio N vezes (saídas `<out>_r<k>.jsonl`) e compara: prova de determinismo.
- Saída JSONL (mesmo formato do orig_trace.py / sim/trace.ts, notes/telemetry.md): uma linha por amostra
  {src:"orig", ep, state, seed, step (tiques rodados), tick (1/s), t16, t16rel, sec = t16rel/16, rng (estado do rand), units: [...por id],
   orders?: [ações aplicadas antes deste tique], events?: [{type: death|spawn|gone|task|hp|mana, unit, ...}]}.
- Trava scratch/refcap.lock (espera 20 s × 90) e fecha o jogo no fim (também em erro).
"""
from __future__ import annotations

import argparse
import ctypes
import hashlib
import json
import os
import struct
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
DIFF_DIR = r"C:\Users\TALES K\Games\a2_diff"
os.environ.setdefault("A2_RUN_DIR", DIFF_DIR)          # launch.py lê na importação
sys.path.insert(0, os.path.join(HERE, "..", "original"))
sys.path.insert(0, os.path.join(HERE, "..", "trace"))
sys.path.insert(0, HERE)
import capture  # noqa: E402
import flows  # noqa: E402
import states  # noqa: E402
from input import Input  # noqa: E402
from launch import Game  # noqa: E402
from memory import Proc  # noqa: E402
from orig_mem import GAME_PTR, UNIT_VTABLES, Server  # noqa: E402
from orig_trace import acquire_lock, release_lock  # noqa: E402
from vclock import VClock  # noqa: E402

VTIME0 = 1_000_000          # relógio virtual fixo no início de cada episódio (GetTickCount/QPC do servidor)


# ---------------------------------------------------------------- leitura rápida do servidor (com o servidor parado)
class Reader:
    def __init__(self, srv: Server):
        self.srv, self.p = srv, srv.p
        self.players: dict[int, int] = {}
        self.td = None

    def rescan(self):
        self.srv.rescan()
        self.players.clear()

    def rng(self) -> int:
        if self.td is None:
            tds = self.srv.tiddata()
            if len(tds) != 1:
                raise RuntimeError(f"{len(tds)} threads com _tiddata (esperado 1)")
            self.td = next(iter(tds.values()))
        return self.p.u32(self.td + 0x14)

    def set_seed(self, seed: int):
        for tid in self.srv.tiddata():
            self.srv.set_seed(tid, seed)
        self.td = None

    def unit(self, a: int) -> dict | None:
        p = self.p
        try:
            b = p.read(a, 0x1C8)
            vt, uid = struct.unpack_from("<II", b, 0)
            if vt not in UNIT_VTABLES:
                return None
            typ = struct.unpack_from("<H", b, 0x0E)[0]
            mo, pl = struct.unpack_from("<II", b, 0x10)
            task, state = struct.unpack_from("<II", b, 0x50)
            hp, hpmax, _regen, mana, manamax = struct.unpack_from("<hhhhh", b, 0x94)
            m = p.read(mo, 6)
            if pl not in self.players:
                self.players[pl] = p.i16(pl + 4) if pl else -1
            tdp = struct.unpack_from("<I", b, 0x1C4)[0]
            target, mode = 0, -1
            if tdp:
                td = p.read(tdp, 0x10)
                mode = td[8]
                tptr = struct.unpack_from("<I", td, 0xC)[0]
                if tptr:
                    try:
                        target = p.u32(tptr + 4)
                    except OSError:
                        target = -1
            x, y = m[0], m[1]
            return {"id": uid, "kind": UNIT_VTABLES[vt], "type": typ, "player": self.players[pl], "x": x, "y": y,
                    "fx": x + m[4] / 256, "fy": y + m[5] / 256, "hp": hp, "hpmax": hpmax, "mana": mana, "manamax": manamax,
                    "task": task, "mode": mode, "target": target, "state": state}
        except OSError:
            return None

    def units(self) -> list[dict]:
        us = [u for u in (self.unit(a) for a in self.srv.units) if u]
        uniq = {}
        for u in us:
            uniq.setdefault(u["id"], u)
        return [uniq[k] for k in sorted(uniq)]


# ---------------------------------------------------------------- gravador de sorteios (DIFF-FUZZ fase 6)
RAND_FN, RAND_HOOK, RAND_BACK = 0x583290, 0x5832AF, 0x5832B4     # rand() do CRT; gancho no `mov [eax+14h],ecx; mov eax,ecx`
RAND_HOOK_BYTES = bytes.fromhex("894814" "8bc1")
RAND_STACK = 14                                                  # dwords da pilha copiados por chamada (esp no retorno de rand)
RAND_REC = 8 + 4 * RAND_STACK                                    # registro: estado novo do LCG, relógio 16/s, pilha


def rand_cave(base: int) -> tuple[bytes, int, int]:
    """Código da caverna (montado à mão; conferido no Unicorn em tools/refcap/diff/test_randlog.py). Layout da alocação:
    base+0 contador (u32, sempre incrementa), base+4 capacidade, base+0x40 código, base+0x1000 registros de RAND_REC bytes:
    {estado do LCG depois do sorteio, [[GAME_PTR]+4] (relógio 16/s), RAND_STACK dwords a partir de esp (esp[0] = retorno de rand)}.
    Não para o processo e não muda registradores/flags: só grava (o resultado do rand é o mesmo)."""
    hdr, rec = base, base + 0x1000
    code = base + 0x40
    p32 = lambda v: struct.pack("<I", v & 0xFFFFFFFF)
    c = bytearray()
    c += bytes.fromhex("894814")                    # mov [eax+14h], ecx   (original)
    c += bytes.fromhex("9c565752")                  # pushfd; push esi; push edi; push edx
    c += b"\x8b\x35" + p32(hdr)                     # mov esi, [hdr]
    c += b"\x3b\x35" + p32(hdr + 4)                 # cmp esi, [hdr+4]
    jae_at = len(c)
    c += b"\x73\x00"                                # jae skip
    c += bytes.fromhex("c1e6" "%02x" % (RAND_REC.bit_length() - 1))   # shl esi, log2(RAND_REC)
    c += b"\x8d\xbe" + p32(rec)                     # lea edi, [esi+rec]
    c += bytes.fromhex("890f")                      # mov [edi], ecx
    c += b"\x8b\x15" + p32(GAME_PTR)                # mov edx, [GAME_PTR]
    c += bytes.fromhex("85d2" "7403" "8b5204")      # test edx,edx; jz +3; mov edx,[edx+4]
    c += bytes.fromhex("895704")                    # mov [edi+4], edx
    c += bytes.fromhex("8d742410" "83c708" "51")    # lea esi,[esp+10h]; add edi,8; push ecx
    c += b"\xb9" + p32(RAND_STACK)                  # mov ecx, RAND_STACK
    c += bytes.fromhex("fc" "f3a5" "59")            # cld; rep movsd; pop ecx
    c[jae_at + 1] = len(c) - (jae_at + 2)
    c += b"\xff\x05" + p32(hdr)                     # skip: inc dword [hdr]
    c += bytes.fromhex("5a5f5e9d" "8bc1")           # pop edx; pop edi; pop esi; popfd; mov eax, ecx  (original)
    c += b"\xe9" + p32(RAND_BACK - (code + len(c) + 5))
    return bytes(c), code, rec


class RandLog:
    """Grava TODA chamada do rand() do servidor numa caverna em memória alocada no processo (sem breakpoint: o processo nunca
    para). `begin()` zera o contador (servidor parado, depois da semente); `records()` lê o que foi gravado desde então."""
    def __init__(self, p, cap: int = 1 << 18):
        assert RAND_REC & (RAND_REC - 1) == 0
        import ctypes.wintypes as wt
        k = ctypes.WinDLL("kernel32", use_last_error=True)
        k.VirtualAllocEx.restype = ctypes.c_void_p
        k.VirtualAllocEx.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.c_size_t, wt.DWORD, wt.DWORD]
        k.VirtualProtectEx.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.c_size_t, wt.DWORD, ctypes.POINTER(wt.DWORD)]
        k.FlushInstructionCache.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.c_size_t]
        self.p, self.k, self.cap = p, k, cap
        size = 0x1000 + cap * RAND_REC
        base = k.VirtualAllocEx(p.h, None, size, 0x3000, 0x40)          # MEM_COMMIT|MEM_RESERVE, PAGE_EXECUTE_READWRITE
        if not base:
            raise OSError(f"VirtualAllocEx falhou ({ctypes.get_last_error()})")
        self.base = base
        code, self.code, self.rec = rand_cave(base)
        p.write(base, struct.pack("<II", 0, cap))
        p.write(self.code, code)
        cur = p.read(RAND_HOOK, 5)
        if cur != RAND_HOOK_BYTES:
            raise RuntimeError(f"rand() inesperado em {RAND_HOOK:#x}: {cur.hex()}")
        old = wt.DWORD()
        if not k.VirtualProtectEx(p.h, RAND_HOOK, 5, 0x40, ctypes.byref(old)):
            raise OSError(f"VirtualProtectEx falhou ({ctypes.get_last_error()})")
        p.write(RAND_HOOK, b"\xe9" + struct.pack("<i", self.code - (RAND_HOOK + 5)))
        k.VirtualProtectEx(p.h, RAND_HOOK, 5, old.value, ctypes.byref(wt.DWORD()))
        k.FlushInstructionCache(p.h, RAND_HOOK, 5)

    def begin(self):
        self.p.write(self.base, struct.pack("<I", 0))

    def count(self) -> int:
        return self.p.u32(self.base)

    def records(self) -> list[tuple]:
        n = self.count()
        if n > self.cap:
            raise RuntimeError(f"caverna do rand() cheia: {n} > {self.cap}")
        raw = self.p.read(self.rec, n * RAND_REC) if n else b""
        fmt = "<II%dI" % RAND_STACK
        return [struct.unpack_from(fmt, raw, i * RAND_REC) for i in range(n)]


# wrappers do rand() (endereço de RETORNO dentro deles → onde estão o chamador efetivo e o argumento na cópia da pilha)
RAND_WRAP = {0x51FA37: "inc", 0x57AFCC: "uobj", 0x51FA15: "float"}


def rand_site(st: tuple) -> tuple[int, str, int, int]:
    """(chamador efetivo, tipo, a, b) de uma chamada: st = pilha copiada (st[0] = retorno do rand). Tipos: raw (rand() direto),
    inc = Rand_Inclusive(n) 0x51fa25 (a = n), one = Rand_One(n) 0x51fa4e (a = n), float = 0x51fa0c (rand()/32768.0),
    uobj = Rand_UniformObject 0x57afc0 (thiscall, o chamador faz a conta), scaled = 0x57afd0(n) (a = n), range = Rand_Range(a, b)
    0x57aff0. a/b = −1 quando não se aplicam."""
    r0 = st[0]
    if r0 == 0x51FA37:                     # Rand_Inclusive: [ebp][ret][n]
        if st[2] == 0x51FA5D:              # Rand_One → Rand_Inclusive: [n-1][ebp'][ret][n]
            return st[5], "one", st[6], -1
        return st[2], "inc", st[3], -1
    if r0 == 0x57AFCC:                     # Rand_UniformObject: [this][ebp][ret]
        r1 = st[3]
        if r1 == 0x57AFDF:
            return st[6], "scaled", st[7], -1
        if r1 == 0x57AFFF:
            return st[6], "range", st[7], st[8]
        return r1, "uobj", -1, -1
    if r0 == 0x51FA15:
        return st[3], "float", -1, -1
    return r0, "raw", -1, -1


def rand_calls(recs: list[tuple], t16_0: int) -> dict:
    """Registros da caverna → colunas compactas: tique do episódio (relógio 16/s − t16_0 − 1 = índice do tique em que o sorteio
    aconteceu; −1 = antes do 1º tique), índice do site, a, b, valor cru (0..32767) e o estado final do LCG (confere a continuidade)."""
    sites: dict[tuple, int] = {}
    tick, site, aa, bb, val = [], [], [], [], []
    for r in recs:
        state, t16, st = r[0], r[1], r[2:]
        ret, kind, a, b = rand_site(st)
        key = (ret, kind)
        if key not in sites:
            sites[key] = len(sites)
        tick.append(int(t16) - t16_0 - 1 if t16 else -2)
        site.append(sites[key])
        aa.append(a if a < 0x80000000 else a - (1 << 32))
        bb.append(b if b < 0x80000000 else b - (1 << 32))
        val.append((state >> 16) & 0x7FFF)
    return {"v": 1, "t16_0": t16_0, "n": len(recs), "last_state": recs[-1][0] if recs else None,
            "sites": [{"ret": "0x%x" % k[0], "kind": k[1]} for k in sites], "tick": tick, "site": site, "a": aa, "b": bb, "val": val}


# ---------------------------------------------------------------- roteiro
def normalize_script(script) -> list[dict]:
    acts = script.get("actions", []) if isinstance(script, dict) else list(script or [])
    out = []
    for a in acts:
        a = dict(a)
        if "do" not in a:            # formato orig_trace/trace_run
            if "move" in a:
                a["do"], (a["x"], a["y"]) = "move", a["move"]
            elif "attack" in a:
                a["do"], a["target"] = "attack", a["attack"]
            else:
                continue
        if "t" not in a:
            a["t"] = int(a["t16"]) if "t16" in a else int(round(16 * a.get("sec", 0)))
        out.append(a)
    return sorted(out, key=lambda a: a["t"])


def events_between(prev: dict[int, dict], cur: dict[int, dict]) -> list[dict]:
    ev = []
    for i, u in cur.items():
        q = prev.get(i)
        if q is None:
            ev.append({"type": "spawn", "unit": i, "utype": u["type"], "x": u["x"], "y": u["y"]})
            continue
        if (q["state"] != 0x10) and u["state"] == 0x10:
            ev.append({"type": "death", "unit": i})
        if q["task"] != u["task"]:
            ev.append({"type": "task", "unit": i, "from": q["task"], "to": u["task"]})
        if q["hp"] != u["hp"]:
            ev.append({"type": "hp", "unit": i, "delta": u["hp"] - q["hp"]})
        if q["mana"] != u["mana"]:
            ev.append({"type": "mana", "unit": i, "delta": u["mana"] - q["mana"]})
    for i in prev:
        if i not in cur:
            ev.append({"type": "gone", "unit": i})
    return ev


# ---------------------------------------------------------------- sessão (um processo, vários episódios)
class Session:
    def __init__(self, max_runtime: float):
        self.g = Game(["-window", "-1024"], max_runtime=max_runtime)
        self.loaded: str | None = None
        self.load_times: list[float] = []

    def __enter__(self):
        self.g.__enter__()
        self.p = Proc(self.g.proc.pid)
        self.vc = VClock(self.p)
        self.vc.freeze()                         # o servidor nunca anda sozinho nesta sessão
        self.inp = Input(self.g)
        self.g.focus()
        self.srv = Server(self.p)
        self.rd = Reader(self.srv)
        return self

    def __exit__(self, *exc):
        return self.g.__exit__(*exc)

    def _after_load(self):
        flows.close_tip(self.g, self.inp)
        flows.dismiss_dialogs(self.g, self.inp)
        self.inp.move(*flows.MOUSE_AWAY)

    def load(self, state: str, seed: int) -> float:
        g, inp, vc = self.g, self.inp, self.vc
        t0 = time.perf_counter()
        vc.put("ENT", 0)
        if self.loaded is None:
            states.install(state)
            flows.boot_to_menu(g, inp)
            t0 = time.perf_counter()
            inp.click(*flows.MENU_BTN["load_game"])
            g.wait(1.2)
            gp0, t16_0 = 0, -1
        else:
            if state != self.loaded:
                states.install(state)            # o diálogo do F3 lê a pasta ao abrir: só este save fica nela
            gp0 = self.p.u32(GAME_PTR)
            t16_0 = self.srv.time16()
            inp.move(*flows.MOUSE_AWAY)
            inp.key("f3")
            g.wait(0.7)
        inp.click(*states.LOAD_ROW0)
        g.wait(0.2)
        # o carregador também sorteia (ex.: estado inicial de animação das unidades): semente fixa ANTES do Ok
        self.rd.set_seed(seed)
        inp.click(*states.LOAD_OK)
        # fim da carga: o laço de missão (GATE) PARA enquanto o save é lido e volta depois; ou mudou o objeto do jogo/relógio
        seen, last_c, last_t = False, vc.get("CALLS"), time.perf_counter()
        while True:
            g.check_alive()
            c = vc.get("CALLS")
            now = time.perf_counter()
            if c != last_c:
                if seen and c - last_c >= 1:
                    base = c
                    while vc.get("CALLS") < base + 100:
                        g.check_alive()
                        time.sleep(0.01)
                        if time.perf_counter() - t0 > 40:
                            raise TimeoutError(f"F3 não carregou {state}")
                    break
                last_c, last_t = c, now
            elif now - last_t > 0.25:
                seen = True
            try:
                gp = self.p.u32(GAME_PTR)
                if gp and (gp != gp0 or self.srv.time16() != t16_0):
                    seen = True
            except OSError:
                seen = True
            if now - t0 > 40:
                raise TimeoutError(f"F3 não carregou {state}")
            time.sleep(0.01)
        g.wait(0.3)
        self._after_load()
        dt = time.perf_counter() - t0
        self.loaded = state
        self.load_times.append(round(dt, 2))
        return dt

    # ------------------------------------------------------------ preparo do episódio (GRUPO-ALAVANCAS, 20/10)
    STRUCT_VT = 0x5D1268                    # vtable das estruturas (casas, alavancas, pontes...; medida na m103)

    def unit_addr(self, uid: int) -> int | None:
        self.srv.rescan()
        for a in self.srv.units:
            try:
                if self.p.u32(a + 4) == uid and self.p.u32(a) in UNIT_VTABLES:
                    return a
            except OSError:
                continue
        return None

    def grant_spells(self, addr: int, spells: list[int]):
        """Põe as magias no livro (+0x140) como o `#modify self +spell n` (0x4f3d68): objeto novo 0x14 B (operator new 0x401880),
        construtor 0x51906d(id), Unit_AddSpellToBook 0x51c29e(livro, id, objeto) — pela caixa de correio, na thread principal."""
        book = self.p.u32(addr + 0x140)
        if not book:
            raise RuntimeError("unidade sem livro")
        for sid in spells:
            o = self.vc.call(0x401880, 0, [0x14])
            self.vc.call(0x51906D, o, [sid])
            self.vc.call(0x51C29E, book, [sid, o])

    def setup(self, cfg: dict, hero: int) -> dict:
        """`cfg` = {"spells": [ids], "mana": n (mana = mana máx.), "hp": n (vida = vida máx.)} aplicado ao herói ANTES do estado
        inicial exportado (o nosso lado importa livro/mana/vida do estado)."""
        a = self.unit_addr(hero)
        if a is None:
            raise RuntimeError("herói não achado")
        if cfg.get("spells"):
            self.grant_spells(a, cfg["spells"])
        if cfg.get("exp"):
            # experiência +0x130 e recálculo da ficha 0x51366b (fastcall: vida/mana máx. sobem com a experiência). Escrever só a mana
            # NÃO serve: o próximo recálculo (melhora de perícia ao lançar) volta a mana máx. à da ficha e corta a mana (medido: 3000 → 99)
            self.p.write(a + 0x130, struct.pack("<I", cfg["exp"]))
            self.vc.call(0x51366B, a, [])
        if cfg.get("mana") == "max":
            self.p.write(a + 0x9A, self.p.read(a + 0x9C, 2))
        elif cfg.get("mana"):
            self.p.write(a + 0x9A, struct.pack("<hh", cfg["mana"], cfg["mana"]))
        if cfg.get("hp"):
            self.p.write(a + 0x94, struct.pack("<hh", cfg["hp"], cfg["hp"]))
        return {"hero_addr": a}

    def structures(self) -> dict[int, int]:
        """id → endereço de todas as estruturas (varredura pela vtable)."""
        out = {}
        for b in self.p.scan(struct.pack("<I", self.STRUCT_VT), 4):
            try:
                sid, pos = self.p.u32(b + 4), self.p.u32(b + 0x10)
                if 0x6000 <= sid < 0x7000 and pos:
                    self.p.u8(pos)
                    out[sid] = b
            except OSError:
                continue
        return out

    def read_structures(self, addrs: dict[int, int]) -> list[list[int]]:
        """[id do mapa, tipo, x, y, vida] de cada estrutura (vida +0x42; some da lista quando destruída e liberada)."""
        out = []
        for sid, b in sorted(addrs.items()):
            try:
                if self.p.u32(b) != self.STRUCT_VT or self.p.u32(b + 4) != sid:
                    continue
                pos = self.p.u32(b + 0x10)
                out.append([sid - 0x6000, struct.unpack("<H", self.p.read(b + 0xE, 2))[0], self.p.u8(pos), self.p.u8(pos + 1),
                            self.p.i16(b + 0x42)])
            except OSError:
                continue
        return out

    def hero_id(self, units: list[dict]) -> int:
        hs = [u for u in units if u["kind"] == "hero"]
        return min(u["id"] for u in hs) if hs else units[0]["id"]

    def episode(self, ep: int, state: str, seed: int, actions: list[dict], ticks: int, out_path: str, every: int = 1,
                rescan_every: int = 32) -> dict:
        load_s = self.load(state, seed)
        vc, rd, srv, g = self.vc, self.rd, self.srv, self.g
        rd.rescan()
        rd.set_seed(seed)
        vc.time_on(VTIME0)
        units = rd.units()
        hero = self.hero_id(units)
        t16_0 = srv.time16()
        sel: list[int] = [hero]
        pend = list(actions)
        frames, stalls = [], 0
        prev = {u["id"]: u for u in units}
        h = hashlib.sha256()
        t0 = time.perf_counter()
        os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as out:
            def emit(step, us, applied, ev):
                f = {"src": "orig", "ep": ep, "state": state, "seed": seed, "step": step, "tick": srv.tick(), "t16": srv.time16()}
                f["t16rel"] = f["t16"] - t16_0
                f["sec"] = f["t16rel"] / 16
                f["rng"] = rd.rng()
                f["units"] = us
                if applied:
                    f["orders"] = applied
                if ev:
                    f["events"] = ev
                line = json.dumps(f)
                h.update(json.dumps({k: v for k, v in f.items() if k != "ep"}).encode())
                out.write(line + "\n")
            emit(0, units, [], [])
            step = 0
            while step < ticks:
                applied = []
                while pend and pend[0]["t"] <= step:
                    a = pend.pop(0)
                    applied.append({**a, "ok": self.apply(a, sel, hero)})
                # roda em bloco até o próximo ponto de interesse (amostra, ação, revarredura, fim): sem desenho no meio
                nxt = min(x for x in (ticks, (step // every + 1) * every,
                                      (step // rescan_every + 1) * rescan_every if rescan_every else ticks,
                                      pend[0]["t"] if pend else ticks) if x > step)
                n = nxt - step
                t16b = srv.time16()
                vc.step(n, alive=g.check_alive)
                lost = n - (srv.time16() - t16b)
                while lost > 0:                   # servidor parado (fala aberta): fecha e completa os tiques
                    stalls += 1
                    flows.dismiss_dialogs(g, self.inp)
                    t16b = srv.time16()
                    vc.step(lost, alive=g.check_alive)
                    lost -= srv.time16() - t16b
                    if stalls > 50:
                        raise RuntimeError("servidor não anda (diálogo que não fecha?)")
                step = nxt
                if rescan_every and step % rescan_every == 0:
                    rd.rescan()
                if step % every == 0 or step == ticks or applied:
                    us = rd.units()
                    cur = {u["id"]: u for u in us}
                    emit(step, us, applied, events_between(prev, cur))
                    prev = cur
        dt = time.perf_counter() - t0
        return {"ep": ep, "state": state, "seed": seed, "ticks": ticks, "out": out_path, "load_s": round(load_s, 2),
                "run_s": round(dt, 2), "ticks_per_s": round(ticks / dt, 1), "stalls": stalls, "hero": hero,
                "sha256": h.hexdigest()}

    def apply(self, a: dict, sel: list[int], hero: int) -> bool:
        def ref(v):
            return hero if v == "hero" else int(v)
        u = a.get("unit")
        units = [ref(x) for x in u] if isinstance(u, list) else [ref(u)] if u is not None else list(sel)
        do = a["do"]
        if do == "select":
            sel[:] = units
            return True
        try:
            if do in ("move", "pickup"):
                self.vc.command(do, units, x=int(a["x"]), y=int(a["y"]))
            elif do == "attack":
                self.vc.command("attack", units, target=ref(a["target"]))
            elif do in ("stop", "guard"):
                self.vc.command(do, units)
            elif do == "use":                      # estrutura (alavanca, fonte...) pelo id do SERVIDOR (+4 da estrutura)
                self.vc.command("use", units, target=int(a["target"]))
            elif do in ("patrol", "pick"):
                self.vc.command(do, units, x=int(a["x"]), y=int(a["y"]), target=int(a.get("target", 0)))
            elif do == "cast":
                if "target" in a:
                    self.vc.command("cast_unit", units, target=ref(a["target"]), spell=int(a["spell"]))
                else:
                    self.vc.command("cast_point", units, x=int(a["x"]), y=int(a["y"]), spell=int(a["spell"]))
            else:
                return False
        except (KeyError, ValueError):
            return False
        return True


def first_diff(pa: str, pb: str) -> dict | None:
    """Primeira diferença entre dois traços do original, nos tiques (`step`) amostrados pelos DOIS (eventos/ordens fora)."""
    A = {f["step"]: f for f in map(json.loads, open(pa, encoding="utf-8"))}
    B = {f["step"]: f for f in map(json.loads, open(pb, encoding="utf-8"))}
    common = sorted(set(A) & set(B))
    for st in common:
        fa, fb = A[st], B[st]
        ka = {k: v for k, v in fa.items() if k not in ("ep", "events", "orders")}
        kb = {k: v for k, v in fb.items() if k not in ("ep", "events", "orders")}
        if ka != kb:
            ua, ub = {u["id"]: u for u in fa["units"]}, {u["id"]: u for u in fb["units"]}
            du = [(i, {k: (ua.get(i, {}).get(k), ub.get(i, {}).get(k)) for k in ("x", "y", "fx", "fy", "hp", "mana", "task", "state",
                                                                                    "target") if ua.get(i, {}).get(k) != ub.get(i, {}).get(k)})
                  for i in sorted(set(ua) | set(ub)) if ua.get(i) != ub.get(i)]
            return {"step": fa["step"], "rng": (fa.get("rng"), fb.get("rng")), "units": du[:5]}
    return None if common else {"common_steps": 0}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", default="m10_start")
    ap.add_argument("--seed", type=lambda s: int(s, 0), default=7)
    ap.add_argument("--script")
    ap.add_argument("--ticks", type=int, default=160)
    ap.add_argument("--out", default=os.path.join(ROOT, "refs", "trace", "diff", "orig.jsonl"))
    ap.add_argument("--episodes")
    ap.add_argument("--repeat", type=int, default=1)
    ap.add_argument("--every", type=int, default=1)
    ap.add_argument("--rescan-every", type=int, default=32)
    ap.add_argument("--max-runtime", type=float, default=1800)
    a = ap.parse_args()

    def load_script(s):
        if s is None:
            return []
        if isinstance(s, str):
            return normalize_script(json.load(open(s, encoding="utf-8")))
        return normalize_script(s)

    if a.episodes:
        eps = json.load(open(a.episodes, encoding="utf-8"))
    else:
        base, ext = os.path.splitext(a.out)
        eps = [{"state": a.state, "seed": a.seed, "script": a.script, "ticks": a.ticks,
                "out": a.out if a.repeat == 1 else f"{base}_r{k}{ext or '.jsonl'}"} for k in range(a.repeat)]
    acquire_lock("original_episode")
    results = []
    try:
        with Session(a.max_runtime) as s:
            for k, e in enumerate(eps):
                r = s.episode(k, e["state"], int(e.get("seed", 7)), load_script(e.get("script")), int(e.get("ticks", 160)),
                              e["out"], every=int(e.get("every", a.every)),
                              rescan_every=int(e.get("rescan_every", a.rescan_every)))
                results.append(r)
                print(json.dumps(r), flush=True)
    finally:
        release_lock()
    key = [json.dumps([e["state"], int(e.get("seed", 7)), int(e.get("ticks", 160)), e.get("script")]) for e in eps]
    for k, r in enumerate(results):
        ref = next((results[j] for j in range(k) if key[j] == key[k]), None)
        if ref is not None:
            d = first_diff(ref["out"], r["out"])
            print(f"ep {r['ep']} × ep {ref['ep']}:", "IDÊNTICO" if d is None else f"diverge: {json.dumps(d)}")


if __name__ == "__main__":
    main()
