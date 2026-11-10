"""Leitor do anel de som do ORIGINAL (cópia a2_audio, make_audio_runtime.py). Registra cada pedido de som (função de tocar 0x45aa2f)
com objeto de som, volume (centésimos de dB), pan, laço, prioridade, frequência e o ENDEREÇO DE QUEM CHAMOU, além de "começou"
(0x45ad66) e "parou" (0x41f610). Frente AUDIO-2 (notes/audio-triggers.md).

    import audio_hook as ah
    with ah.session("plagat_start") as (g, inp, hook):      # abre o jogo em a2_audio, carrega o estado, liga o anel
        hook.mark("antes"); inp.click(...); g.wait(1); print(hook.drain())

A2_RUN_DIR é definido na importação (launch.py o lê). Trava scratch/refcap.lock (run_steps.acquire/release).
"""
from __future__ import annotations

import contextlib
import ctypes
import ctypes.wintypes as wt
import os
import struct
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
AUDIO_DIR = r"C:\Users\TALES K\Games\a2_audio"
os.environ["A2_RUN_DIR"] = AUDIO_DIR
sys.path.insert(0, HERE)

import memory  # noqa: E402
from memory import Proc  # noqa: E402

DATA = 0x6CDF00
RING_N = 0x4000
REC = 64
SFX_VEC = 0x627740          # CArray de objetos de som por id: [+4] dados, [+8] quantidade
SLOT_TABLE = 0x61F63C       # ponteiro para a tabela de vozes (16 B cada); DAT_0061f670 = nº de vozes
NVOICES = 0x61F670
k32 = ctypes.WinDLL("kernel32", use_last_error=True)
k32.VirtualAllocEx.restype = ctypes.c_void_p
k32.VirtualAllocEx.argtypes = [wt.HANDLE, ctypes.c_void_p, ctypes.c_size_t, wt.DWORD, wt.DWORD]


class Hook:
    def __init__(self, proc: Proc):
        self.p = proc
        self.ring = k32.VirtualAllocEx(proc.h, None, RING_N * REC, 0x3000, 0x04)
        if not self.ring:
            raise OSError("VirtualAllocEx falhou")
        proc.write(self.ring, b"\0" * (RING_N * REC))
        proc.write(DATA + 4, struct.pack("<I", 0))
        proc.write(DATA, struct.pack("<I", self.ring))
        self.seen = 0
        self.t0 = time.time()
        self.names: dict[int, tuple] = {}
        self.marks: list[tuple[float, str]] = []
        self.tsc_hz = None
        self._tsc0 = None
        self.ids: dict[int, int] = {}

    # ------------------------------------------------------------ objetos de som
    def refresh_ids(self):
        """objeto de som -> id do sfx.reg (vetor 0x627740)."""
        try:
            arr, n = self.p.u32(SFX_VEC + 4), self.p.u32(SFX_VEC + 8)
            if not arr or n > 5000:
                return
            vals = struct.unpack(f"<{n}I", self.p.read(arr, 4 * n))
            self.ids = {v: i for i, v in enumerate(vals) if v}
        except OSError:
            pass

    def name_of(self, obj: int) -> str:
        nm = "?"
        try:
            ptr = self.p.u32(obj + 8)
            nm = self.p.cstr(ptr, 80) if ptr else ""
        except OSError:
            pass
        return nm

    def label(self, obj: int) -> str:
        nm = self.name_of(obj)
        i = self.ids.get(obj)
        return f"{i}:{nm}" if i is not None else nm

    # ------------------------------------------------------------ leitura
    def start_poll(self, every: float = 0.02):
        """Thread que lê o anel a cada `every` s e acumula em self.events (nomes resolvidos na hora, antes de o objeto mudar)."""
        import threading
        self.events: list[dict] = []
        self._stop = False

        def run():
            while not self._stop:
                try:
                    self.events.extend(self.drain(quiet=True))
                except OSError:
                    return
                time.sleep(every)
        self._th = threading.Thread(target=run, daemon=True)
        self._th.start()

    def take(self) -> list[dict]:
        """Eventos acumulados desde a última chamada."""
        n = len(self.events)
        out, self.events[:] = self.events[:n], self.events[n:]
        return out

    def stop_poll(self):
        self._stop = True

    def mark(self, text: str):
        self.marks.append((time.time() - self.t0, text))
        return self.drain(quiet=True)

    def drain(self, quiet=False) -> list[dict]:
        """Registros novos desde a última leitura (ordem de chegada). Cada um: t (s do hook), tag, obj, label, ..."""
        cnt = self.p.u32(DATA + 4)
        now = time.time() - self.t0
        out = []
        if cnt - self.seen > RING_N:
            print(f"AVISO: anel estourou ({cnt - self.seen} registros)", file=sys.stderr)
            self.seen = cnt - RING_N
        if cnt == self.seen:
            return out
        self.refresh_ids()
        for i in range(self.seen, cnt):
            b = self.p.read(self.ring + (i % RING_N) * REC, REC)
            tag, ecx, a, bb, c, d, e, ret, tl, th, gtc = struct.unpack_from("<11I", b, 0)
            r = {"i": i, "tag": tag, "ret": ret, "gtc": gtc, "tsc": (th << 32) | tl, "t": now}
            if tag == 1:
                r.update(obj=ecx, vol=struct.unpack("<i", struct.pack("<I", a))[0],
                         pan=struct.unpack("<i", struct.pack("<I", bb))[0], loop=c, prio=d & 0xFF, freq=e)
            elif tag in (8, 9):
                try:
                    obj = self.p.u32(a)
                except OSError:
                    obj = 0
                r.update(obj=obj)
            elif tag in (2, 3, 5, 6):
                r.update(slot=ecx, obj=a, prio=bb)
                if tag == 2:
                    r["loop"] = c
                elif tag in (5, 6):
                    r["val"] = struct.unpack("<i", struct.pack("<I", c))[0]
            else:
                continue
            r["label"] = self.label(r["obj"])
            out.append(r)
        self.seen = cnt
        return out

    # ------------------------------------------------------------ vista da missão (objeto passado a 0x41b311, guardado em DATA+8)
    VIEW_FIELDS = {"x": 0x5c, "y": 0x60, "w": 0x64, "h": 0x68, "mapw": 0x84, "maph": 0x88, "lastx": 0x49b8, "lasty": 0x49bc,
                   "timer": 0x49c0}

    def view_addr(self) -> int:
        return self.p.u32(DATA + 8)

    def view(self) -> dict:
        a = self.view_addr()
        if not a:
            return {}
        return {k: self.p.i32(a + o) for k, o in self.VIEW_FIELDS.items()}

    def set_view(self, x: int, y: int):
        a = self.view_addr()
        self.p.write_i32(a + 0x5c, x)
        self.p.write_i32(a + 0x60, y)

    def slots(self) -> list[dict]:
        """Estado da tabela de vozes (obj, prio, tocando?)."""
        tab, n = self.p.u32(SLOT_TABLE), self.p.u32(NVOICES)
        res = []
        for k in range(n):
            s = struct.unpack("<4I", self.p.read(tab + 16 * k, 16))
            res.append({"k": k, "prio": s[1] & 0xFF, "buf": s[2], "obj": s[3], "label": self.label(s[3]) if s[3] else ""})
        return res


def fmt(r: dict) -> str:
    if r["tag"] == 1:
        return f"{r['t']:7.2f} PLAY  {r['label']:<40} vol={r['vol']:6d} pan={r['pan']:6d} loop={r['loop']} prio={r['prio']:3d} f={r['freq']} ret={r['ret']:#x}"
    if r["tag"] in (8, 9):
        return f"{r['t']:7.2f} {'HELP ' if r['tag'] == 8 else 'HSTOP'} {r['label']:<40} from={r['ret']:#x}"
    if r["tag"] in (5, 6):
        return f"{r['t']:7.2f} {'VOL  ' if r['tag'] == 5 else 'PAN  '} {r['label']:<40} slot={r['slot']:#x} val={r['val']} ret={r['ret']:#x}"
    return f"{r['t']:7.2f} {'START' if r['tag'] == 2 else 'STOP '} {r['label']:<40} slot={r['slot']:#x} prio={r['prio']:3d} ret={r['ret']:#x}"


@contextlib.contextmanager
def session(state: str = "menu", max_runtime: float = 600, lock: bool = True, dismiss: bool = True):
    """(g, inp, hook): abre o jogo (cópia a2_audio) em `state` (menu | new | nome da biblioteca), com o anel ligado desde o início."""
    from run_steps import acquire, release
    import flows
    import states
    from input import Input
    from launch import Game, list_game_pids
    if lock and not acquire():
        raise RuntimeError("trava do harness ocupada")
    hook = None
    try:
        if state not in ("new", "menu"):
            states.install(state)
        with Game(["-window", "-1024"], max_runtime=max_runtime) as g:
            hook = Hook(Proc.attach(g.proc.pid))
            hook.start_poll()
            inp = Input(g)
            g.focus()
            flows.boot_to_menu(g, inp)
            if state == "new":
                flows.new_game_to_town(g, inp)
            elif state != "menu":
                scr = states.load_from_menu(g, inp, state)
                if dismiss:
                    flows.close_tip(g, inp)
                    if scr == "mission_hud":
                        flows.dismiss_dialogs(g, inp)
            inp.move(*flows.MOUSE_AWAY)
            g.wait(0.4)
            try:
                yield g, inp, hook
            finally:
                hook.stop_poll()
    finally:
        if list_game_pids():
            print("AVISO: allods2 restantes", list_game_pids(), file=sys.stderr)
        if lock:
            release()
