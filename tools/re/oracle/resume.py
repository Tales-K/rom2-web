"""Oráculo por retomada: o servidor do allods2.exe rodando no Unicorn a partir de uma imagem do processo (dump_state.py).

Mapeia todas as regiões despejadas nos endereços reais, transforma as DLLs do sistema em armadilhas (cada exportação = HLE de
hle.py; qualquer outra entrada nelas para com erro), põe FS na TEB32 real da thread principal e chama Server_Tick 0x4f08c0
(fastcall, ECX = [0x6044c4]) em laço, 1 chamada = 1 tique, avançando o relógio virtual como o GATE do a2_diff. As ordens do
roteiro entram como o vclock.command: pacote 0x6904b8 + envio 0x50164f (ECX = ponta do cliente 0x670e50), antes do tique.
O traço segue run_pair.run_orig (quadro a cada 4 tiques, revarredura de unidades a cada 32, rng a cada 16) e é comparado
byte a byte com refs/golden/episodes/<id>/{orig,states}.jsonl.gz.

    PYTHONUTF8=1 .venv/Scripts/python.exe -X utf8 tools/re/oracle/resume.py m10_start_s1 [m10_mage_s102 ...] [--ticks 960]
    PYTHONUTF8=1 .venv/Scripts/python.exe -X utf8 tools/re/oracle/resume.py --gate      # os 3 episódios do portão

Como biblioteca: o = Oracle("refs/oracle/images/m10_start_s1_t0"); o.tick(); o.read(addr, n); o.proc (Proc-like p/ export_state).
"""
from __future__ import annotations

import gzip
import json
import os
import struct
import sys
import time
import zlib

from unicorn import (Uc, UC_ARCH_X86, UC_MODE_32, UC_HOOK_CODE, UC_HOOK_MEM_UNMAPPED, UC_PROT_ALL, UcError)
from unicorn import x86_const as X

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "tools", "refcap", "diff"))
sys.path.insert(0, os.path.join(ROOT, "tools", "refcap", "trace"))
sys.path.insert(0, os.path.join(ROOT, "tools", "refcap", "original"))
import hle  # noqa: E402

IMAGES = os.path.join(ROOT, "refs", "oracle", "images")
GOLD = os.path.join(ROOT, "refs", "golden", "episodes")
GATE_EPISODES = ["m10_start_s1", "m10_mage_s102", "m20_start_s203"]
SERVER_TICK = 0x4F08C0
GAME_PTR = 0x6044C4
VC_DATA = 0x6CDF00                      # variáveis do relógio virtual (vclock.OFF): DONE +8, CALLS +0xc, VTIME +0x34
CMD_PKT, CLIENT_NET, SEND = 0x6904B8, 0x670E50, 0x50164F
PAGE = 0x1000
M32 = 0xFFFFFFFF
WRITABLE = {0x04, 0x08, 0x40, 0x80}


def _align(v, a=PAGE):
    return (v + a - 1) & ~(a - 1)


class OracleError(RuntimeError):
    pass


class Oracle:
    def __init__(self, img_dir: str):
        self.meta = json.load(open(os.path.join(img_dir, "meta.json"), encoding="utf-8"))
        self.uc = Uc(UC_ARCH_X86, UC_MODE_32)
        self.teb = self.meta["teb32"]
        self.regions: list[tuple[int, int, int, int]] = []     # (base, size, protect, type) despejadas
        self.unhandled: list[tuple[str, int]] = []
        self.calls: dict[str, int] = {}                          # contagem de HLE por nome
        self.fault = None
        self.sizes: dict[int, int] = {}                          # bloco do alocador de avanço → tamanho
        self.frees = 0
        self._load(os.path.join(img_dir, "mem.bin"))
        self._traps()
        self._own_areas()
        self._setup_fs()
        self.uc.hook_add(UC_HOOK_MEM_UNMAPPED, self._on_unmapped)
        self.proc = EmuProc(self)

    # ------------------------------------------------------------ montagem
    def _load(self, path):
        uc = self.uc
        with open(path, "rb") as fh:
            while True:
                h = fh.read(20)
                if len(h) < 20:
                    break
                base, size, prot, typ, zl = struct.unpack("<IIIII", h)
                data = zlib.decompress(fh.read(zl))
                uc.mem_map(base, size, UC_PROT_ALL)
                uc.mem_write(base, data)
                self.regions.append((base, size, prot, typ))

    def _mapped(self, a):
        for b, e, _ in self.uc.mem_regions():
            if b <= a <= e:
                return True
        return False

    def _traps(self):
        """DLLs do sistema: faixa cheia de int3; nas exportações com HLE, `ret N` + gancho que chama o tratador antes do ret."""
        names = {int(a): n for a, n in self.meta["exports"].items()}
        for mod, ents in self.meta["iat"].items():
            for e in ents:
                names.setdefault(e["value"], e["dll"] + "!" + e["name"])
        self.names = names
        ranges = []
        for m in self.meta["modules"]:
            if m["system"]:
                b, s = m["base"] & ~(PAGE - 1), _align(m["size"])
                self.uc.mem_map(b, s, UC_PROT_ALL)
                self.uc.mem_write(b, b"\xCC" * s)
                ranges.append((b, b + s - 1))
        for a in sorted(names):
            if not any(b <= a <= e for b, e in ranges) and not self._mapped(a):
                pg = a & ~(PAGE - 1)
                self.uc.mem_map(pg, PAGE, UC_PROT_ALL)
                self.uc.mem_write(pg, b"\xCC" * PAGE)
                ranges.append((pg, pg + PAGE - 1))
        self.handlers = {}
        for a, n in names.items():
            h = hle.lookup(n)
            if h is None or not any(b <= a <= e for b, e in ranges):
                continue
            nargs, fn = h
            self.uc.mem_write(a, b"\xC3" if nargs == 0 else b"\xC2" + struct.pack("<H", 4 * nargs))
            self.handlers[a] = (n, nargs, fn)
        for b, e in ranges:
            self.uc.hook_add(UC_HOOK_CODE, self._on_trap, begin=b, end=e)

    def _gap(self, size, start=0x01000000):
        regs = sorted((b, e) for b, e, _ in self.uc.mem_regions())
        a = start
        for b, e in regs:
            if e < a:
                continue
            if b >= a + size:
                return a
            a = _align(e + 1, 0x10000)
        if a + size <= 0x7FFE0000:
            return a
        raise OracleError("sem espaço livre")

    def _own_areas(self):
        uc = self.uc
        self.stub = self._gap(0x10000)
        uc.mem_map(self.stub, 0x10000, UC_PROT_ALL)
        uc.mem_write(self.stub, b"\xF4" * 0x10000)               # hlt: endereço de retorno das chamadas
        self.sentinel = self.stub + 0x100
        self.gdt = self.stub + 0x1000
        self.stack_size = 0x100000
        self.stack = self._gap(self.stack_size)
        uc.mem_map(self.stack, self.stack_size, UC_PROT_ALL)
        self.heap_size_total = 0x10000000
        self.heap = self._gap(self.heap_size_total)
        uc.mem_map(self.heap, self.heap_size_total, UC_PROT_ALL)
        self.heap_ptr = self.heap
        self.extra: list[tuple[int, int]] = []                  # páginas comprometidas por VirtualAlloc(addr, MEM_COMMIT)

    def _setup_fs(self):
        """GDT plana + FS com base na TEB32 real (despejada) da thread principal: FS:[0x18], [0x2c], slots TLS +0xe10."""
        uc = self.uc

        def entry(base, limit, access, flags):
            return struct.pack("<HHBBBB", limit & 0xFFFF, base & 0xFFFF, (base >> 16) & 0xFF, access,
                               ((flags & 0xF) << 4) | ((limit >> 16) & 0xF), (base >> 24) & 0xFF)
        gdt = (entry(0, 0, 0, 0) + entry(0, 0xFFFFF, 0x93, 0xC) + entry(0, 0xFFFFF, 0x9B, 0xC)
               + entry(self.teb, 0xFFF, 0x93, 0x4))
        uc.mem_write(self.gdt, gdt)
        uc.reg_write(X.UC_X86_REG_GDTR, (0, self.gdt, len(gdt) - 1, 0))
        for r in (X.UC_X86_REG_DS, X.UC_X86_REG_ES, X.UC_X86_REG_GS, X.UC_X86_REG_SS):
            uc.reg_write(r, 1 << 3)
        uc.reg_write(X.UC_X86_REG_FS, 3 << 3)

    # ------------------------------------------------------------ ganchos
    def _on_trap(self, uc, address, size, _):
        h = self.handlers.get(address)
        esp = uc.reg_read(X.UC_X86_REG_ESP)
        if h is None:
            caller = struct.unpack("<I", bytes(uc.mem_read(esp, 4)))[0]
            self.unhandled.append((self.names.get(address, "0x%x" % address), caller))
            uc.emu_stop()
            return
        name, nargs, fn = h
        self.calls[name] = self.calls.get(name, 0) + 1
        args = list(struct.unpack("<%dI" % nargs, bytes(uc.mem_read(esp + 4, 4 * nargs)))) if nargs else []
        r = fn(self, args) if fn else 0
        uc.reg_write(X.UC_X86_REG_EAX, (r or 0) & M32)

    def _on_unmapped(self, uc, access, address, size, value, _):
        self.fault = "acesso não mapeado 0x%x (tipo %d, %d B) em EIP=0x%x" % (address, access, size,
                                                                            uc.reg_read(X.UC_X86_REG_EIP))
        return False

    # ------------------------------------------------------------ memória
    def read(self, a, n):
        return bytes(self.uc.mem_read(a, n))

    def write(self, a, b):
        self.uc.mem_write(a, bytes(b))

    def u32(self, a):
        return struct.unpack("<I", self.read(a, 4))[0]

    def set_u32(self, a, v):
        self.write(a, struct.pack("<I", v & M32))

    def heap_alloc(self, size):
        a = self.heap_ptr
        self.heap_ptr += _align(max(size, 1), 16)
        if self.heap_ptr > self.heap + self.heap_size_total:
            raise OracleError("heap de avanço esgotado")
        self.sizes[a] = size
        return a

    def heap_free(self, p):
        self.frees += 1
        return 1

    def heap_size(self, p):
        if p in self.sizes:
            return self.sizes[p]
        raise OracleError("HeapSize de bloco anterior ao despejo 0x%x" % p)

    def heap_realloc(self, p, size):
        n = self.heap_alloc(size)
        old = self.sizes.get(p)
        if old is None:                          # bloco do heap real: copia o que couber na região mapeada
            old = size
            for b, e, _ in self.uc.mem_regions():
                if b <= p <= e:
                    old = min(size, e + 1 - p)
        if p:
            self.write(n, self.read(p, min(old, size)))
        return n

    def virtual_alloc(self, addr, size, typ):
        if not addr:
            self.heap_ptr = _align(self.heap_ptr, 0x10000)
            return self.heap_alloc(_align(size))
        b, e = addr & ~(PAGE - 1), _align(addr + size)
        for pg in range(b, e, PAGE):
            if not self._mapped(pg):
                self.uc.mem_map(pg, PAGE, UC_PROT_ALL)
                self.extra.append((pg, PAGE))
        return b

    def virtual_free(self, addr, size, typ):
        """MEM_DECOMMIT (0x4000) com tamanho: zera as páginas (recomprometer devolve zeros, como no Windows); MEM_RELEASE
        e o resto: a memória fica mapeada como estava (o.vfree conta)."""
        self.vfree = getattr(self, "vfree", 0) + 1
        if typ & 0x4000 and size:
            b, e = addr & ~(PAGE - 1), _align(addr + size)
            self.write(b, bytes(e - b))
        return 1

    # ------------------------------------------------------------ relógio e chamadas
    def vtime(self):
        return self.u32(VC_DATA + 0x34)

    def call(self, fn, ecx=0, args=(), max_insns=0):
        uc = self.uc
        sp = self.stack + self.stack_size - 0x100
        for v in reversed(list(args)):
            sp -= 4
            self.set_u32(sp, v)
        sp -= 4
        self.set_u32(sp, self.sentinel)
        for r in (X.UC_X86_REG_EAX, X.UC_X86_REG_EBX, X.UC_X86_REG_EDX, X.UC_X86_REG_ESI, X.UC_X86_REG_EDI,
                  X.UC_X86_REG_EBP):
            uc.reg_write(r, 0)
        uc.reg_write(X.UC_X86_REG_ECX, ecx & M32)
        uc.reg_write(X.UC_X86_REG_ESP, sp)
        uc.reg_write(X.UC_X86_REG_EFLAGS, 0x202)
        try:
            uc.emu_start(fn, self.sentinel, count=max_insns)
        except UcError as e:
            raise OracleError("Unicorn: %s em EIP=0x%x; %s" % (e, uc.reg_read(X.UC_X86_REG_EIP), self.fault or ""))
        if self.unhandled:
            n, c = self.unhandled[-1]
            raise OracleError("importação sem HLE: %s chamada de 0x%x" % (n, c))
        eip = uc.reg_read(X.UC_X86_REG_EIP)
        if eip != self.sentinel:
            raise OracleError("parou em EIP=0x%x (esperado o retorno)" % eip)
        return uc.reg_read(X.UC_X86_REG_EAX)

    def tick(self):
        """Um tique: o que o GATE faz (DONE++, VTIME += 62 + DONE&1) e Server_Tick(ECX = [0x6044c4])."""
        done = (self.u32(VC_DATA + 8) + 1) & M32
        self.set_u32(VC_DATA + 8, done)
        self.set_u32(VC_DATA + 0x34, self.vtime() + 62 + (done & 1))
        self.call(SERVER_TICK, ecx=self.u32(GAME_PTR))

    def command(self, kind: str, units: list[int], x=0, y=0, target=0, spell=0):
        from vclock import CMD, SPELL_INDEX
        typ = CMD[kind]
        b10 = SPELL_INDEX[spell] if kind.startswith("cast") else 0
        body = struct.pack("<HHB", self.meta["sender"], 0, typ) + struct.pack("<HHHBBB", x & 0xFFFF, y & 0xFFFF,
                                                                               target & 0xFFFF, b10, 0, len(units))
        body += b"".join(struct.pack("<H", u) for u in units)
        self.write(CMD_PKT + 5, body)
        self.call(SEND, ecx=CLIENT_NET, args=[CMD_PKT])


# ---------------------------------------------------------------- leitura com as mesmas classes do harness
from memory import Proc  # noqa: E402
from orig_mem import Server  # noqa: E402


class EmuProc(Proc):
    """Proc (tools/refcap/original/memory.py) sobre a memória do Unicorn: snapshot/scan/u32... herdados."""

    def __init__(self, o: Oracle):
        self.o, self.pid, self.h = o, 0, None

    def close(self):
        pass

    def read(self, addr, n):
        try:
            return bytes(self.o.uc.mem_read(addr, n))
        except UcError as e:
            raise OSError(str(e))

    def write(self, addr, data):
        self.o.uc.mem_write(addr, bytes(data))

    def regions(self, writable_only=True):
        o = self.o
        for b, s, prot, typ in o.regions:
            if not writable_only or (prot & 0xFF) in WRITABLE:
                yield b, s, typ
        if o.heap_ptr > o.heap:
            yield o.heap, _align(o.heap_ptr - o.heap), 0x20000
        for b, s in o.extra:
            yield b, s, 0x20000


class EmuServer(Server):
    def tiddata(self):
        return {self.p.o.meta["main_tid"]: self.p.o.meta["tiddata"]}


# ---------------------------------------------------------------- episódio (espelho de run_pair.run_orig)
SAMPLE, STATE_EVERY, RESCAN = 4, 16, 32


def run_episode(eid: str, ticks: int | None = None, verbose=False) -> dict:
    import original_episode as oe
    import golden_ingest as gi
    ep = json.load(open(os.path.join(GOLD, eid, "ep.json"), encoding="utf-8"))
    ticks = ticks or ep["ticks"]
    t_load = time.perf_counter()
    o = Oracle(os.path.join(IMAGES, f"{eid}_t0"))
    t_load = time.perf_counter() - t_load
    srv = EmuServer(o.proc)
    rd = oe.Reader(srv)
    rd.rescan()
    hero = o.meta["hero"]
    pend = sorted(oe.normalize_script(ep["script"]), key=lambda a: a["t"])
    frames = [{"step": 0, "units": rd.units()}]
    rngs = [rd.rng()]
    applied = []

    def apply(a):
        def ref(v):
            return hero if v == "hero" else int(v)
        u = a.get("unit")
        us = [ref(x) for x in u] if isinstance(u, list) else [ref(u)] if u is not None else [hero]
        do = a["do"]
        if do in ("move", "pickup"):
            o.command(do, us, x=int(a["x"]), y=int(a["y"]))
        elif do == "attack":
            o.command("attack", us, target=ref(a["target"]))
        elif do in ("stop", "guard"):
            o.command(do, us)
        elif do == "use":
            o.command("use", us, target=int(a["target"]))
        elif do in ("patrol", "pick"):
            o.command(do, us, x=int(a["x"]), y=int(a["y"]), target=int(a.get("target", 0)))
        elif do == "cast":
            if "target" in a:
                o.command("cast_unit", us, target=ref(a["target"]), spell=int(a["spell"]))
            else:
                o.command("cast_point", us, x=int(a["x"]), y=int(a["y"]), spell=int(a["spell"]))
        else:
            return False
        return True

    step, t_run, t_read, err = 0, 0.0, 0.0, None
    try:
        while step < ticks:
            while pend and pend[0]["t"] <= step:
                a = pend.pop(0)
                applied.append({**a, "ok": apply(a)})
            nxt = min(x for x in (ticks, (step // SAMPLE + 1) * SAMPLE, pend[0]["t"] if pend else ticks) if x > step)
            t0 = time.perf_counter()
            for _ in range(nxt - step):
                o.tick()
            t_run += time.perf_counter() - t0
            step = nxt
            t0 = time.perf_counter()
            if step % RESCAN == 0:
                rd.rescan()
            if step % SAMPLE == 0:
                frames.append({"step": step, "units": rd.units()})
            if step % STATE_EVERY == 0 and step < ticks:
                rngs.append(rd.rng())
            t_read += time.perf_counter() - t0
    except OracleError as e:
        err = f"tique {step}: {e}"
    # comparação com o golden
    d = os.path.join(GOLD, eid)
    new = gi.compact_orig(frames).split(b"\n")
    old = gzip.open(os.path.join(d, "orig.jsonl.gz")).read().split(b"\n")
    partial = step < ep["ticks"]
    if partial:                                  # execução curta: compara só o prefixo
        old = old[:len(new) - 1] + [b""]
    k = next((i for i in range(min(len(new), len(old))) if new[i] != old[i]), None)
    if k is None and len(new) != len(old):
        k = min(len(new), len(old))
    gold_rng = [json.loads(l)["rng"] for l in gzip.open(os.path.join(d, "states.jsonl.gz")).read().splitlines() if l.strip()]
    if partial:
        gold_rng = gold_rng[:len(rngs)]
    kr = next((i for i in range(min(len(rngs), len(gold_rng))) if rngs[i] != gold_rng[i]), None)
    if kr is None and len(rngs) != len(gold_rng):
        kr = min(len(rngs), len(gold_rng))
    res = {"id": eid, "ticks": step, "err": err, "trace_ok": k is None, "rng_ok": kr is None,
           "load_s": round(t_load, 2), "run_s": round(t_run, 2), "read_s": round(t_read, 2),
           "ticks_per_s": round(step / t_run, 1) if t_run else None, "hle": o.calls, "frees": o.frees,
           "heap_used": o.heap_ptr - o.heap}
    if k is not None:
        res["trace_first_diff"] = {"line": k, "ours": new[k][:300].decode() if k < len(new) else None,
                                   "gold": old[k][:300].decode() if k < len(old) else None}
    if kr is not None:
        res["rng_first_diff"] = {"state": kr, "step": 16 * kr, "ours": rngs[kr] if kr < len(rngs) else None,
                                 "gold": gold_rng[kr] if kr < len(gold_rng) else None}
    res["applied_ok"] = applied == ep.get("applied", [])[:len(applied)]
    return res


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    ticks = None
    if "--ticks" in sys.argv:
        ticks = int(sys.argv[sys.argv.index("--ticks") + 1])
        args = [a for a in args if a != str(ticks)]
    ids = GATE_EPISODES if "--gate" in sys.argv or not args else args
    ok = True
    for eid in ids:
        r = run_episode(eid, ticks)
        ok &= r["trace_ok"] and r["rng_ok"] and not r["err"]
        print(json.dumps(r, ensure_ascii=False), flush=True)
    print("PORTÃO:", "PASSOU" if ok else "FALHOU")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
