"""JOGO ESPELHADO: o usuário joga o original (cópia a2_diff, relógio virtual, semente fixa) numa janela, em velocidade real, e o
nosso sim (worker.mts, sem janela) acompanha tique a tique com as mesmas ordens; na 1.ª divergência os dois param.

    PYTHONUTF8=1 .venv/Scripts/python.exe -X utf8 tools/refcap/mirror/mirror.py [--state m10_start] [--seed 1]
        [--script ep.json] [--ticks N] [--speed 1] [--force-diverge T[:id]] [--no-image] [--oracle EPISODIO] [--batch]

Como funciona
- O original: original_episode.Session (a2_diff, harness em janela, trava scratch/refcap.lock — espera, nunca quebra) carrega o estado
  pelo menu com a semente; o GATE do relógio virtual só deixa o servidor andar quando a ferramenta manda (1 tique a cada 62,5 ms).
  O cliente desenha e lê o mouse o tempo todo: o usuário joga normalmente.
- Ordens: gancho de 5 bytes na entrada de Server_PacketDispatcher 0x4f515d (caverna em memória alocada no processo, como o RandLog):
  cada pacote do cliente que o servidor trata é gravado com o relógio de 16/s e a pilha (para saber se veio do tique ou do laço de
  pausa/diálogo, FUN_004f84f8). Viram ações do roteiro dos episódios (move/attack/guard/stop/cast/patrol/pick/use).
- Estado: export_state.read_state + o registro do exe (dump_ticks.ExeTracker) depois de cada tique; o worker aplica as mesmas ordens no
  mesmo tique, anda 1 tique e compara a visão plana do tickcmp (tick_compare.mts) inteira.
- Na divergência: o GATE fica fechado (o relógio virtual para; o processo não é suspenso), grava refs/mirror/<data-hora>/ e espera.

Saída (refs/mirror/<data-hora>/): ordens.json (episódio: estado, semente, t16_0, roteiro e pacotes crus — repete a partida pelo
original_episode.py ou, com to_oracle.py, pelo oráculo), imagem_t0/ (memória do processo no tique 0, formato do oráculo), tique0.png,
base.json.gz (estado completo do tique 0), estado_original.jsonl.gz e estado_nosso.jsonl (últimos ~10 s), relatorio.txt.

--oracle EPISODIO: o original é o oráculo (Unicorn, refs/oracle/images/<ep>_t0) com o roteiro do episódio, sem jogo nem janela — o
mesmo caminho do gancho e da comparação (teste da ferramenta).
"""
from __future__ import annotations

import argparse
import ctypes
import gzip
import json
import os
import struct
import subprocess
import sys
import threading
import time
from collections import deque

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools", "refcap", "diff"))
sys.path.insert(0, os.path.join(ROOT, "tools", "re", "oracle"))
import original_episode as oe  # noqa: E402  (define A2_RUN_DIR = a2_diff)
import vclock  # noqa: E402
from export_state import map_wh, mission_of, read_state  # noqa: E402
from orig_trace import acquire_lock, release_lock  # noqa: E402

GAME_PTR = 0x6044C4
UNITS_PTR = 0x68D2DC
DISPATCH = 0x4F515D
DISPATCH_HEAD = bytes.fromhex("558bec6aff")      # push ebp; mov ebp, esp; push -1
CLOCK_TICK = (0x4F8521, 0x4F856A)                # Server_ClockTick: o pacote tratado DENTRO do tique
DONE_ADDR = vclock.DATA + vclock.OFF["DONE"]
REC, CAP, STACK = 128, 1 << 14, 12
TICK_S = 0.0625
TYPE_NAME = {v: k for k, v in vclock.CMD.items() if k not in ("pickup", "cast_unit", "cast_point")}
TYPE_NAME.update({0x1E: "cast", 0x1F: "cast", 0x1D: "patrol"})


# ---------------------------------------------------------------- gancho no despachante de pacotes do servidor
def dispatch_cave(base: int) -> tuple[bytes, int, int]:
    """Caverna: base+0 contador, +4 capacidade, +0x40 código, +0x400 registros de 128 B = {relógio 16/s, DONE do GATE, 12 dwords da pilha
    na entrada (esp[0] = retorno em Server_ClientMessages, esp[1] = pacote, esp[5] = retorno de Server_ClientMessages), 0x13 + 2×n
    bytes do pacote (n = byte +0x12, até 26 unidades)}. Não muda registradores/flags; refaz os 5 bytes da entrada e volta."""
    hdr, rec, code = base, base + 0x400, base + 0x40
    p32 = lambda v: struct.pack("<I", v & 0xFFFFFFFF)
    c = bytearray()
    c += b"\x9c\x60"                                   # pushfd; pushad
    c += b"\x8b\x35" + p32(hdr)                        # mov esi, [hdr]
    c += b"\x3b\x35" + p32(hdr + 4)                    # cmp esi, [hdr+4]
    j1 = len(c); c += b"\x73\x00"                      # jae skip
    c += b"\xc1\xe6\x07"                               # shl esi, 7
    c += b"\x8d\xbe" + p32(rec)                        # lea edi, [esi+rec]
    c += b"\xa1" + p32(GAME_PTR)                       # mov eax, [GAME_PTR]
    c += b"\x85\xc0\x74\x03\x8b\x40\x04"               # test eax,eax; jz +3; mov eax,[eax+4]
    c += b"\x89\x07"                                   # mov [edi], eax
    c += b"\xa1" + p32(DONE_ADDR)                      # mov eax, [DONE]
    c += b"\x89\x47\x04"                               # mov [edi+4], eax
    c += b"\x8d\x74\x24\x24"                           # lea esi, [esp+0x24]  (esp da entrada)
    c += b"\x83\xc7\x08"                               # add edi, 8
    c += b"\xb9" + p32(STACK)                          # mov ecx, 12
    c += b"\xfc\xf3\xa5"                               # cld; rep movsd
    c += b"\x8b\x74\x24\x28"                           # mov esi, [esp+0x28]  (pacote)
    c += b"\x85\xf6"                                   # test esi, esi
    j2 = len(c); c += b"\x74\x00"                      # jz skip
    c += b"\x0f\xb6\x4e\x12"                           # movzx ecx, byte [esi+0x12]
    c += b"\x83\xf9\x1a\x76\x05"                       # cmp ecx, 26; jbe +5
    c += b"\xb9" + p32(26)                             # mov ecx, 26
    c += b"\x8d\x0c\x4d" + p32(0x16)                   # lea ecx, [ecx*2+0x16]
    c += b"\xc1\xe9\x02\xf3\xa5"                       # shr ecx, 2; rep movsd
    skip = len(c)
    c[j1 + 1] = skip - (j1 + 2)
    c[j2 + 1] = skip - (j2 + 2)
    c += b"\xff\x05" + p32(hdr)                        # inc dword [hdr]
    c += b"\x61\x9d"                                   # popad; popfd
    c += DISPATCH_HEAD                                 # os 5 bytes originais
    c += b"\xe9" + p32(DISPATCH + 5 - (code + len(c) + 5))
    return bytes(c), code, rec


class PacketLog:
    """Instala o gancho; `alloc(n)` devolve memória executável no processo (vivo: VirtualAllocEx; oráculo: o heap RWX)."""

    def __init__(self, p, alloc, patch):
        self.p = p
        self.base = alloc(0x400 + CAP * REC)
        code, self.code, self.rec = dispatch_cave(self.base)
        p.write(self.base, struct.pack("<II", 0, CAP))
        p.write(self.code, code)
        cur = bytes(p.read(DISPATCH, 5))
        if cur != DISPATCH_HEAD:
            raise RuntimeError(f"Server_PacketDispatcher inesperado em {DISPATCH:#x}: {cur.hex()}")
        patch(DISPATCH, b"\xe9" + struct.pack("<i", self.code - (DISPATCH + 5)))
        self.seen = 0

    def new(self) -> list[dict]:
        n = struct.unpack("<I", bytes(self.p.read(self.base, 4)))[0]
        if n > CAP:
            raise RuntimeError("caverna dos pacotes cheia")
        out = []
        if n > self.seen:
            raw = bytes(self.p.read(self.rec + self.seen * REC, (n - self.seen) * REC))
            for i in range(n - self.seen):
                b = raw[i * REC:(i + 1) * REC]
                t16, done = struct.unpack_from("<iI", b, 0)
                stack = struct.unpack_from("<%dI" % STACK, b, 8)
                pk = b[8 + 4 * STACK:]
                cnt = min(pk[0x12], 26)
                out.append({"t16": t16, "done": done, "in_tick": CLOCK_TICK[0] <= stack[5] < CLOCK_TICK[1],
                            "hex": pk[:0x13 + 2 * cnt].hex()})
            self.seen = n
        return out


def decode(pk: dict) -> dict | None:
    """Pacote → ação do roteiro dos episódios (original_episode.Session.apply / simcore.step)."""
    b = bytes.fromhex(pk["hex"])
    if len(b) < 0x13 or not b[4]:
        return None
    typ = b[9]
    name = TYPE_NAME.get(typ)
    x, y, tgt = struct.unpack_from("<HHH", b, 0xA)
    n = b[0x12]
    units = [struct.unpack_from("<H", b, 0x13 + 2 * i)[0] for i in range(n) if 0x15 + 2 * i <= len(b)]
    a = {"do": name or f"pacote_{typ:#x}", "unit": units, "cat": b[4]}
    if name in ("move", "patrol", "pick"):
        a.update(x=x, y=y)
        if name == "pick":
            a["target"] = tgt
    elif name in ("attack", "use"):
        a["target"] = tgt
    elif typ in (0x1E, 0x1F):
        sid = vclock.SPELL_TABLE[b[0x10]] if b[0x10] < len(vclock.SPELL_TABLE) else b[0x10]
        a["spell"] = sid
        if typ == 0x1E:
            a["target"] = tgt
        else:
            a.update(x=x, y=y)
    return a


# ---------------------------------------------------------------- leitura do estado (servidor parado)
def unit_list(p) -> list[int]:
    w = p.u32(UNITS_PTR)
    out = []
    for lst in (0x4, 0x44):
        x = p.u32(w + lst + 4)
        while x:
            out.append(p.u32(x + 8))
            x = p.u32(x)
    return out


class StateReader:
    def __init__(self, p, srv, rd, mission):
        import dump_ticks
        self.p, self.srv, self.rd, self.mission = p, srv, rd, mission
        self.dt = dump_ticks
        self.trk = dump_ticks.ExeTracker()

    def base(self) -> dict:
        self.srv.units = unit_list(self.p)
        return read_state(self.p, self.srv, self.rd, self.mission, map_wh(self.mission))

    def full(self, tracker=None) -> dict:
        """Estado normalizado como refs/oracle/ticks, com o registro do exe; `tracker` novo = MapRec inteiro (tique de partida)."""
        trk = tracker or self.trk
        self.srv.units = unit_list(self.p)
        st = self.dt.normalize(read_state(self.p, self.srv, self.rd, self.mission, None))
        ex, recs = trk.read(self.p, self.srv.units)
        for u in st["units"]:
            if u["id"] in recs:
                u["exe"] = recs[u["id"]]
        st["exe"] = ex
        return st

    def money(self, player: int = 1) -> int | None:
        lst = self.p.u32(0x68D2C4)
        x = self.p.u32(lst + 4)
        while x:
            pa = self.p.u32(x + 8)
            if struct.unpack("<h", bytes(self.p.read(pa + 4, 2)))[0] == player:
                return self.p.u32(pa + 0x3C)
            x = self.p.u32(x)
        return None


def slim(st: dict) -> dict:
    """Estado para o worker por tique: sem os deltas do MapRec (só o tique de partida os usa)."""
    return {**st, "exe": {"world": st["exe"].get("world")}} if st.get("exe") else st


# ---------------------------------------------------------------- nosso sim
class Worker:
    def __init__(self, log_path: str):
        tsx = os.path.join(ROOT, "game", "node_modules", ".bin", "tsx.cmd")
        self.err = open(log_path, "w", encoding="utf-8")
        self.p = subprocess.Popen([tsx, os.path.join("..", "tools", "refcap", "mirror", "worker.mts")], cwd=os.path.join(ROOT, "game"),
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.err, text=True, encoding="utf-8",
                                  bufsize=1)

    def ask(self, msg: dict) -> dict:
        self.p.stdin.write(json.dumps(msg, separators=(",", ":")) + "\n")
        self.p.stdin.flush()
        line = self.p.stdout.readline()
        if not line:
            raise RuntimeError(f"o worker terminou (veja {self.err.name})")
        r = json.loads(line)
        if "error" in r:
            raise RuntimeError("worker: " + r["error"])
        return r

    def close(self):
        try:
            self.p.stdin.write('{"cmd":"quit"}\n')
            self.p.stdin.flush()
            self.p.wait(5)
        except Exception:
            self.p.kill()
        self.err.close()


# ---------------------------------------------------------------- os dois originais
class Live:
    """O jogo de verdade (a2_diff) numa janela."""
    kind = "jogo"

    def __init__(self, a):
        self.a = a
        self.s = oe.Session(a.max_runtime)

    def __enter__(self):
        self.s.__enter__()
        return self

    def __exit__(self, *exc):
        return self.s.__exit__(*exc)

    def start(self, state: str, seed: int) -> dict:
        s = self.s
        print(f"carregando {state} (semente {seed}): não mexa no jogo até aparecer PRONTO", flush=True)
        s.load(state, seed)
        s.rd.rescan()
        s.rd.set_seed(seed)
        s.vc.time_on(oe.VTIME0)
        self.p, self.vc, self.srv, self.rd, self.g = s.p, s.vc, s.srv, s.rd, s.g
        units = s.rd.units()
        return {"hero": s.hero_id(units), "t16_0": s.srv.time16(), "sender": s.vc.read_sender()}

    def snapshot(self, out: str, extra: dict, image: bool):
        import capture
        try:
            capture.grab(self.g).save(os.path.join(out, "tique0.png"))
        except Exception as e:  # noqa: BLE001
            print("   aviso: sem tique0.png:", e)
        if image:
            import dump_state
            t0 = time.perf_counter()
            dump_state.park_and_dump(self.s, os.path.join(out, "imagem_t0"), extra)
            print(f"   imagem do tique 0 gravada em {time.perf_counter() - t0:.1f} s", flush=True)

    def alloc(self, n: int) -> int:
        import ctypes.wintypes as wt
        k = ctypes.WinDLL("kernel32", use_last_error=True)
        k.VirtualAllocEx.restype = ctypes.c_void_p
        k.VirtualAllocEx.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.c_size_t, wt.DWORD, wt.DWORD]
        b = k.VirtualAllocEx(self.p.h, None, n, 0x3000, 0x40)
        if not b:
            raise OSError(f"VirtualAllocEx falhou ({ctypes.get_last_error()})")
        return b

    def patch(self, addr: int, data: bytes):
        import ctypes.wintypes as wt
        k = ctypes.WinDLL("kernel32", use_last_error=True)
        k.VirtualProtectEx.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.c_size_t, wt.DWORD, ctypes.POINTER(wt.DWORD)]
        k.FlushInstructionCache.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.c_size_t]
        old = wt.DWORD()
        if not k.VirtualProtectEx(self.p.h, addr, len(data), 0x40, ctypes.byref(old)):
            raise OSError(f"VirtualProtectEx falhou ({ctypes.get_last_error()})")
        self.p.write(addr, data)
        k.VirtualProtectEx(self.p.h, addr, len(data), old.value, ctypes.byref(wt.DWORD()))
        k.FlushInstructionCache(self.p.h, addr, len(data))

    def command(self, a: dict, hero: int) -> bool:
        return self.s.apply(a, [hero], hero)

    def tick(self, interactive: bool) -> bool:
        """Roda 1 tique (espera o diálogo/menu fechar, sem prazo, no modo interativo). True = o relógio do servidor andou."""
        vc, g = self.vc, self.g
        t16 = self.srv.time16()
        d0 = vc.get("DONE")
        vc.put("BUDGET", 1)
        t0, said = time.perf_counter(), False
        while True:
            sn = vc.snap()
            if sn["DONE"] >= d0 + 1 and sn["BUDGET"] == 0:
                break
            time.sleep(0.0005)
            if time.perf_counter() - t0 > 3:
                g.check_alive()
                if not interactive:
                    self.dismiss()
                elif not said:
                    print("   (jogo parado: feche o diálogo ou o menu para continuar)", flush=True)
                    said = True
                t0 = time.perf_counter()
        # o tique pode abrir uma fala (o laço modal do cliente para de chamar o GATE): espera ela fechar
        c_last, t1 = sn["CALLS"], time.perf_counter()
        while vc.get("CALLS") <= c_last:
            time.sleep(0.0005)
            if time.perf_counter() - t1 > 1.5:
                g.check_alive()
                if not interactive:
                    self.dismiss()
                elif not said:
                    print("   (fala aberta no jogo: clique Ok para continuar)", flush=True)
                    said = True
                t1 = time.perf_counter()
        return self.srv.time16() != t16

    def dismiss(self):
        """Modo roteiro: fecha a caixa de fala só se o botão Ok estiver na tela (clique às cegas viraria ordem de andar)."""
        import capture
        img = capture.grab(self.g)
        if oe.flows.sig_diff(img, "dialog") > 12:
            return
        pt = oe.flows.find_template(img, "btn_ok", region=(440, 400, 580, 520), thr=9)
        if pt:
            self.s.inp.click(int(pt[0]), int(pt[1]))
            self.s.inp.move(*oe.flows.MOUSE_AWAY)

    def freeze(self):
        self.vc.put("BUDGET", 0)

    def alive(self):
        self.g.check_alive()


class Oracle:
    """O servidor do original no Unicorn (tools/re/oracle/resume.py), a partir da imagem do tique 0 de um episódio."""
    kind = "oráculo"

    def __init__(self, a):
        import resume as R
        self.R = R
        self.o, self.ep = R.load_episode(a.oracle)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def start(self, state, seed) -> dict:
        self.p = self.o.proc
        self.srv = self.R.EmuServer(self.p)
        self.rd = oe.Reader(self.srv)
        m = self.o.meta
        return {"hero": m["hero"], "t16_0": m["t16_0"], "sender": m["sender"], "seed": self.ep.get("seed", m.get("seed"))}

    def snapshot(self, out, extra, image):
        pass

    def alloc(self, n):
        return self.o.heap_alloc(n)

    def patch(self, addr, data):
        self.o.write(addr, data)

    def command(self, a, hero) -> bool:
        return self.R.apply_action(self.o, a, hero)

    def tick(self, interactive) -> bool:
        self.o.tick()
        return True

    def freeze(self):
        pass

    def alive(self):
        pass


# ---------------------------------------------------------------- relatório
def mmss(t: int) -> str:
    s = t // 16
    return f"{s // 60:02d}:{s % 60:02d}"


def write_report(out: str, info: dict, k: int, r: dict, orig_st: dict, orders: list, hist: deque, reason: str) -> str:
    ou = {u["id"]: u for u in orig_st["units"]}
    by_unit: dict[str, list] = {}
    glob = []
    for key, o, n in r["diffs"]:
        f, u = key.split("|", 1)
        uid = u.split(":")[0].split(",")[0]
        (by_unit.setdefault(uid, []) if uid.isdigit() else glob).append((f, u, o, n))
    L = [f"Jogo espelhado — {reason}", "",
         f"Original: {info['backend']} ({info['state']}, semente {info['seed']}, herói {info['hero']}, relógio t16_0 = {info['t16_0']})",
         f"Tique: {k} (o estado depois do tique {k} = estado {k + 1})   tempo de jogo {mmss(k)} (tique ÷ 16)",
         f"Pares divergentes: {len(r['diffs'])}", ""]
    for uid, fs in by_unit.items():
        o = ou.get(int(uid), {})
        L.append(f"Unidade {uid} (tipo {o.get('type')}, jogador {o.get('player')}, célula {o.get('x')},{o.get('y')}):")
        for f, u, a, b in fs:
            L.append(f"   {f:<16} original={a}   nosso={b}" + (f"   [{u}]" if u != uid else ""))
        ours = r.get("ours", {}).get(uid)
        if o:
            L.append(f"   original: vida {o.get('hp')}/{o.get('hpmax')} mana {o.get('mana')} tarefa {o.get('task')} modo {o.get('mode')} "
                     f"alvo {o.get('target')} ação {o.get('state')} fina ({o.get('fx'):.3f},{o.get('fy'):.3f})")
        if ours:
            L.append(f"   nosso:    {json.dumps(ours, ensure_ascii=False)}")
    if glob:
        L.append("Campos globais:")
        for f, u, a, b in glob:
            L.append(f"   {f}|{u:<12} original={a}   nosso={b}")
    L += ["", "Ordens recentes (últimos 10 s de jogo):"]
    rec = [x for x in orders if x["t"] >= k - 160]
    L += [f"   t={x['t']} ({mmss(x['t'])}) {json.dumps({kk: v for kk, v in x.items() if kk != 't'}, ensure_ascii=False)}" for x in rec] or ["   nenhuma"]
    L += ["", "Arquivos: ordens.json (roteiro + pacotes crus), imagem_t0/ (memória do tique 0), tique0.png, base.json.gz,",
          f"estado_original.jsonl.gz e estado_nosso.jsonl (últimos {len(hist)} tiques), worker.log.",
          "Repetir no oráculo: .venv/Scripts/python.exe -X utf8 tools/refcap/mirror/to_oracle.py " + out,
          "  (instala como episódio do oráculo e roda dump_ticks; depois: cd game && npx tsx ../tools/refcap/mirror/free_run.mts --episode <id>)"]
    path = os.path.join(out, "relatorio.txt")
    open(path, "w", encoding="utf-8").write("\n".join(L) + "\n")
    return path


# ---------------------------------------------------------------- laço
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--state", default="m10_start")
    ap.add_argument("--seed", type=lambda s: int(s, 0), default=1)
    ap.add_argument("--script", help="ep.json/roteiro: as ordens entram pelo pacote do cliente (teste sem usuário)")
    ap.add_argument("--ticks", type=int, default=0, help="para depois de N tiques (0 = sem limite)")
    ap.add_argument("--speed", type=float, default=1.0, help="1 = tempo real; 0 = o mais rápido possível")
    ap.add_argument("--force-diverge", help="T[:id] — divergência forçada: no tique T a vida da unidade id (padrão herói) cai 1 no nosso")
    ap.add_argument("--no-image", action="store_true", help="não grava a imagem de memória do tique 0")
    ap.add_argument("--oracle", help="episódio do oráculo no lugar do jogo (teste)")
    ap.add_argument("--batch", action="store_true", help="sem perguntas no fim (fecha o jogo)")
    ap.add_argument("--out")
    ap.add_argument("--max-runtime", type=float, default=4 * 3600)
    a = ap.parse_args()
    interactive = not a.batch and not a.script and not a.oracle and sys.stdin.isatty()
    stamp = time.strftime("%Y-%m-%d_%H%M%S")
    out = os.path.abspath(a.out) if a.out else os.path.join(ROOT, "refs", "mirror", stamp)
    os.makedirs(out, exist_ok=True)
    script = []
    if a.oracle and not a.script:
        a.script = os.path.join(ROOT, "refs", "golden", "episodes", a.oracle, "ep.json")
    if a.script:
        sj = json.load(open(a.script, encoding="utf-8"))
        script = oe.normalize_script(sj.get("script", sj) if isinstance(sj, dict) else sj)
        if isinstance(sj, dict) and not a.oracle:
            a.state = sj.get("state", a.state)
            a.seed = int(sj.get("seed", a.seed))
        if not a.ticks and isinstance(sj, dict) and sj.get("ticks"):
            a.ticks = int(sj["ticks"])
    state = json.load(open(os.path.join(ROOT, "refs", "golden", "episodes", a.oracle, "ep.json")))["state"] if a.oracle else a.state
    mission = mission_of(state)
    print(f"saída: {out}", flush=True)
    worker = Worker(os.path.join(out, "worker.log"))
    locked = False
    if not a.oracle:
        print("aguardando a trava scratch/refcap.lock (outra sessão pode estar usando o jogo)...", flush=True)
        acquire_lock("mirror")
        locked = True
    B = (Oracle if a.oracle else Live)(a)
    orders: list[dict] = []
    packets: list[dict] = []
    info = {"backend": B.kind + (f" {a.oracle}" if a.oracle else ""), "state": state, "seed": a.seed}
    hist: deque = deque(maxlen=160)
    k = 0
    result = None
    try:
        with B:
            info.update(B.start(state, a.seed))
            a.seed = info["seed"] = info.get("seed", a.seed)
            sr = StateReader(B.p, B.srv, B.rd, mission)
            base = sr.base()
            st0 = sr.full()
            money0 = sr.money()
            json.dump(base, gzip.open(os.path.join(out, "base.json.gz"), "wt", encoding="utf-8"), separators=(",", ":"))
            B.snapshot(out, {"id": "mirror_" + stamp, "state": state, "seed": a.seed, "ticks": 0, "hero": info["hero"],
                             "t16_0": info["t16_0"], "tick": st0["tick"], "rng": st0["rng"], "sender": info["sender"],
                             "game_ptr": B.p.u32(GAME_PTR), "units0": B.rd.units()}, not a.no_image)
            force = None
            if a.force_diverge:
                t, _, u = a.force_diverge.partition(":")
                force = {"t": int(t), "unit": int(u) if u else info["hero"]}
            r0 = worker.ask({"cmd": "init", "base": base, "st0": st0, "force": force})
            print(f"nosso sim: {r0['matched']}/{r0['units']} unidades casadas, {r0['lost']} pares fora da comparação (importação)", flush=True)
            plog = PacketLog(B.p, B.alloc, B.patch)
            hero = info["hero"]
            pend = list(script)
            t_next = time.perf_counter()
            per = TICK_S / a.speed if a.speed > 0 else 0.0
            cost = deque(maxlen=160)
            last_save = time.perf_counter()

            def save_orders(n_ticks):
                json.dump({"state": state, "mission": mission, "seed": a.seed, "hero": hero, "t16_0": info["t16_0"], "ticks": n_ticks,
                           "script": [{kk: v for kk, v in o.items() if kk != "_sent"} for o in orders], "packets": packets, "money0": money0,
                           "note": f"jogo espelhado {stamp} ({info['backend']})"},
                          open(os.path.join(out, "ordens.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)

            print(f"PRONTO — {'roteiro rodando' if script else 'jogue na janela do jogo'}; tique 0 = relógio {info['t16_0']}", flush=True)
            sim_gold0 = 0
            while not a.ticks or k < a.ticks:
                for x in [x for x in pend if x["t"] <= k]:
                    pend.remove(x)
                    B.command(x, hero)
                if per:
                    now = time.perf_counter()
                    if t_next > now:
                        time.sleep(t_next - now)
                    t_next = max(t_next + per, time.perf_counter() - per)
                moved = B.tick(interactive)
                c0 = time.perf_counter()
                for pk in plog.new():
                    # dentro do tique k o relógio já foi incrementado (Server_ClockTick): t = relógio − t16_0 − 1; fora do tique (laço da
                    # pausa/diálogo FUN_004f84f8) vale antes do próximo: t = relógio − t16_0, e o nosso aplica na hora (`now`)
                    t = pk["t16"] - info["t16_0"] - (1 if pk["in_tick"] else 0)
                    packets.append({**pk, "t": t})
                    act = decode(pk)
                    if act is None:
                        continue
                    act["t"] = t
                    if not pk["in_tick"]:
                        act["now"] = True
                    orders.append(act)
                if not moved:
                    continue
                acts = [o for o in orders if o["t"] == k]
                late = [o for o in orders if o["t"] < k and not o.get("_sent")]
                for o in acts + late:
                    o["_sent"] = True
                if late:
                    print(f"   aviso: {len(late)} ordem(ns) com tique < {k} (aplicadas agora)", flush=True)
                acts = late + acts
                acts = [{kk: v for kk, v in o.items() if kk != "_sent"} for o in acts]
                st = sr.full()
                money = sr.money()
                r = worker.ask({"cmd": "tick", "t": k, "acts": acts, "st": slim(st)})
                if money is not None and money0 is not None and money - money0 != r.get("gold", 0) - sim_gold0:
                    r["diffs"].append(["money|1", money - money0, r.get("gold", 0) - sim_gold0])
                hist.append({"t": k, **slim(st), "money": money})
                cost.append(time.perf_counter() - c0)
                if acts:
                    print(f"   t={k} ({mmss(k)}) ordens: {json.dumps(acts, ensure_ascii=False)}", flush=True)
                if k % 160 == 0:
                    print(f"   t={k} ({mmss(k)}) igual; custo/tique {1000 * sum(cost) / len(cost):.1f} ms", flush=True)
                if time.perf_counter() - last_save > 10:
                    save_orders(k + 1)
                    last_save = time.perf_counter()
                if r["diffs"]:
                    B.freeze()
                    result = (k, r, st)
                    break
                k += 1
            save_orders(k + 1)
            with gzip.open(os.path.join(out, "estado_original.jsonl.gz"), "wt", encoding="utf-8") as fh:
                for h in hist:
                    fh.write(json.dumps(h, separators=(",", ":")) + "\n")
            worker.ask({"cmd": "dump", "path": os.path.join(out, "estado_nosso.jsonl")})
            if result:
                k, r, st = result
                rp = write_report(out, info, k, r, st, orders, hist, "DIVERGÊNCIA (os dois pararam)")
                print("\n" + open(rp, encoding="utf-8").read(), flush=True)
                print(f"PAUSADO no tique {k} ({mmss(k)}). O jogo fica congelado na janela (o cliente desenha, o servidor não anda).", flush=True)
            else:
                rp = write_report(out, info, k, {"diffs": []}, sr.full(), orders, hist, f"sem divergência em {k} tiques")
                print(f"sem divergência em {k} tiques ({mmss(k)})", flush=True)
            if interactive:
                input("Enter fecha o jogo e termina. ")
    except Exception as e:  # noqa: BLE001
        print(f"interrompido no tique {k}: {e}", flush=True)
        try:
            json.dump({"state": state, "seed": a.seed, "ticks": k, "script": orders, "packets": packets, "erro": str(e)},
                      open(os.path.join(out, "ordens.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        except Exception:  # noqa: BLE001
            pass
        if interactive:
            input("Enter termina. ")
        raise
    finally:
        worker.close()
        if locked:
            release_lock()
    return 0 if result is None else 3


if __name__ == "__main__":
    sys.exit(main())
