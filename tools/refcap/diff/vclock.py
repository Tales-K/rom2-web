"""Controle do relógio virtual e da caixa de correio da cópia `a2_diff` (make_diff_runtime.py; notes/differential-fuzz.md).

    from vclock import VClock
    vc = VClock(proc)          # Proc de tools/refcap/original/memory.py
    vc.freeze()                # GATE ligado: o servidor só anda quando o harness manda (orçamento de tiques)
    vc.time_on()               # GetTickCount/QPC do servidor = VTIME (avança 62/63 ms por tique)
    vc.step(1)                 # roda exatamente 1 tique e espera ele TERMINAR (próxima chamada do GATE)
    vc.call(fn, ecx, [args])   # chama fn(args) com ecx na THREAD PRINCIPAL, entre tiques; devolve eax
    vc.command(...)            # pacote de ordem do cliente (0x6904b8) entregue pelo envio do cliente 0x50164f
"""
from __future__ import annotations

import struct
import time

DATA = 0x6CDF00
OFF = {"EN": 0, "BUDGET": 4, "DONE": 8, "CALLS": 0xC, "FN": 0x10, "ECX": 0x14, "NARGS": 0x18, "ARGS": 0x1C, "RET": 0x2C,
       "MAILDONE": 0x30, "VTIME": 0x34, "ENT": 0x38}
GATE_SITE = 0x488AD8
GATE_CAVE = 0x5CA520

# ---------------------------------------------------------------- ordens (pacote de comando do cliente; análise em notes/differential-fuzz.md)
CMD_PKT = 0x6904B8          # pacote estático de comando do cliente (ctor 0x50bb82, vtable 0x5d0c30)
CLIENT_NET = 0x670E50       # ponta de rede do cliente
SEND = 0x50164F             # __thiscall envio(pacote) — o mesmo que os cliques usam
GET_APP = 0x401C60          # devolve o objeto da aplicação; +0xd0 = visão da missão (this dos métodos de ordem 0x418bc3...)
# tipo (+9) → tarefa no servidor (despachante 0x4f515d, tabela 0x4f8286; por unidade 0x56d...):
CMD = {"move": 0x16,        # tarefa 1 andar até (x=+0xa, y=+0xc)            0x5703c0 → 0x56d032
       "attack": 0x19,      # tarefa 3 atacar a unidade +0xe                   0x570946 → 0x56d1be
       "guard": 0x17,       # tarefa 0xb guarda                                0x5709d9 → 0x56d4ba
       "stop": 0x18,        # tarefa 0xc parar/segurar posição                 0x570b8b → 0x56d52b
       "cast_unit": 0x1E,   # tarefa 0xd magia (+0x10 = índice do livro) na unidade +0xe   0x5702be → 0x56d3e6
       "cast_point": 0x1F,  # magia no ponto (x, y)
       "pickup": 0x1D,      # tarefa 0xa na célula (x, y)                      0x570d26 → 0x56d6b7 = PATRULHA (célula atual ↔ (x, y)),
                            # não "pegar" (nome mantido pelos roteiros antigos; GRUPO-ALAVANCAS 20/10, C decompilado)
       "patrol": 0x1D,
       "pick": 0x21,        # pegar o saco da célula (x, y), item +0xe (cliente 0x419d8e; servidor caso 0xf → 0x56da98, tarefa 2)
       "use": 0x24,         # USAR a estrutura +0xe (cliente 0x41a0b5 com o cursor de uso; servidor 0x52bfa3 → 0x56d22b, tarefa 0xf:
                            # anda até Chebyshev ≤ 1 (2 se tamanho 3/4) virado para ela; ação 0xf da máquina 0x50f12c → alavanca)
       }
# magia (id do servidor) → índice que o cliente põe em +0x10 (tabela 0x5f8120: índice → id)
SPELL_TABLE = [0, 1, 2, 3, 4, 24, 20, 21, 26, 13, 12, 11, 10, 5, 6, 7, 8, 25, 22, 23, 27, 19, 18, 17, 16]
SPELL_INDEX = {sid: k for k, sid in enumerate(SPELL_TABLE) if k}


class VClock:
    def __init__(self, proc):
        self.p = proc
        code = proc.read(GATE_SITE, 5)
        if code[0] != 0xE8 or GATE_SITE + 5 + struct.unpack("<i", code[1:])[0] != GATE_CAVE:
            raise RuntimeError("este allods2.exe não tem o relógio virtual (rode make_diff_runtime.py e use A2_RUN_DIR=a2_diff)")
        self.sender = None

    # ------------------------------------------------------------ variáveis
    def get(self, k) -> int:
        return struct.unpack("<I", self.p.read(DATA + OFF[k], 4))[0]

    def put(self, k, v):
        self.p.write(DATA + OFF[k], struct.pack("<I", v & 0xFFFFFFFF))

    def snap(self) -> dict:
        b = self.p.read(DATA, 0x3C)
        return {k: struct.unpack_from("<I", b, o)[0] for k, o in OFF.items() if k != "ARGS"}

    def freeze(self):
        self.put("BUDGET", 0)
        self.put("EN", 1)

    def time_on(self, vtime: int | None = None):
        import ctypes
        self.put("VTIME", vtime if vtime is not None else ctypes.windll.kernel32.GetTickCount())
        self.put("ENT", 1)

    def release(self):
        """Volta ao relógio real (o servidor corre sozinho)."""
        self.put("ENT", 0)
        self.put("EN", 0)

    # ------------------------------------------------------------ tiques
    def wait_gate(self, n: int = 1, timeout: float = 10.0, alive=None):
        """Espera o GATE ser chamado mais `n` vezes (cada chamada = início de um teste de tique; entre elas o cliente desenha)."""
        c0 = self.get("CALLS")
        t0 = time.perf_counter()
        while self.get("CALLS") < c0 + n:
            if time.perf_counter() - t0 > timeout:
                if alive:
                    alive()
                raise TimeoutError("o GATE não foi chamado (laço de missão parado? diálogo aberto?)")
            time.sleep(0.0005)

    def step(self, n: int = 1, timeout: float = 10.0, alive=None) -> int:
        """Roda exatamente `n` tiques do servidor (em sequência, sem desenho no meio) e espera o último TERMINAR."""
        d0 = self.get("DONE")
        self.put("BUDGET", n)
        t0 = time.perf_counter()
        while True:
            s = self.snap()
            if s["DONE"] >= d0 + n and s["BUDGET"] == 0:
                break
            if time.perf_counter() - t0 > timeout:
                if alive:
                    alive()
                raise TimeoutError(f"tique não rodou (DONE {s['DONE']} de {d0 + n})")
            time.sleep(0.0005)
        # a chamada do GATE que disparou o último tique já contou em CALLS; a próxima só vem depois do tique terminar
        c_last = s["CALLS"]
        while self.get("CALLS") <= c_last:
            if time.perf_counter() - t0 > timeout:
                raise TimeoutError("o tique não terminou")
            time.sleep(0.0005)
        return s["DONE"]

    # ------------------------------------------------------------ chamada na thread principal
    def call(self, fn: int, ecx: int = 0, args: list[int] = (), timeout: float = 10.0) -> int:
        if self.get("FN"):
            raise RuntimeError("caixa de correio ocupada")
        args = list(args)
        assert len(args) <= 4
        self.p.write(DATA + OFF["ARGS"], struct.pack("<4I", *(args + [0] * (4 - len(args)))))
        self.put("NARGS", len(args))
        self.put("ECX", ecx)
        m0 = self.get("MAILDONE")
        self.put("FN", fn)                      # por último: o GATE só olha FN
        t0 = time.perf_counter()
        while self.get("MAILDONE") == m0:
            if time.perf_counter() - t0 > timeout:
                self.put("FN", 0)
                raise TimeoutError("a caixa de correio não foi atendida")
            time.sleep(0.0005)
        return self.get("RET")

    # ------------------------------------------------------------ ordens
    def read_sender(self) -> int:
        """Id do remetente = word [[[app]+0xd0]+0x9cc]+4 (o cliente põe isso em +5 de todo pacote; app = 0x401c60())."""
        app = self.call(GET_APP)
        view = self.p.u32(app + 0xD0)
        pl = self.p.u32(view + 0x9CC)
        self.sender = struct.unpack("<H", self.p.read(pl + 4, 2))[0]
        return self.sender

    def command(self, kind: str, units: list[int], x: int = 0, y: int = 0, target: int = 0, spell: int = 0,
                settle_frames: int = 2):
        """Envia a ordem como o cliente faria (mesmo pacote, mesma função de envio), na thread principal, com o servidor parado.
        Depois espera `settle_frames` chamadas do GATE para o pacote ser entregue antes do próximo tique."""
        if self.sender is None:
            self.read_sender()
        typ = CMD[kind]
        b10 = SPELL_INDEX[spell] if kind.startswith("cast") else 0
        body = struct.pack("<HHB", self.sender, 0, typ) + struct.pack("<HHHBBB", x & 0xFFFF, y & 0xFFFF, target & 0xFFFF,
                                                                      b10, 0, len(units))
        body += b"".join(struct.pack("<H", u) for u in units)
        self.p.write(CMD_PKT + 5, body)
        self.call(SEND, CLIENT_NET, [CMD_PKT])
        if settle_frames:
            self.wait_gate(settle_frames)
