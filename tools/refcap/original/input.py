"""Entrada sintética (mouse/teclado) para o jogo original via SendInput.

O allods2.exe lê o mouse por mensagens (WM_MOUSEMOVE/WM_LBUTTONDOWN...) + GetCursorPos e o teclado por mensagens
WM_KEYDOWN/WM_CHAR + GetAsyncKeyState (não importa DirectInput). SendInput gera tudo isso de forma idêntica ao
hardware. Coordenadas são SEMPRE da área cliente do jogo (0..1023, 0..767).

Segurança: toda ação confere antes que a janela do jogo está em primeiro plano (tenta focar; se não conseguir,
levanta erro) e que o ponto está dentro da área cliente — nada é clicado fora do jogo.
"""
from __future__ import annotations

import ctypes
import ctypes.wintypes as wt
import time

user32 = ctypes.WinDLL("user32", use_last_error=True)

INPUT_MOUSE, INPUT_KEYBOARD = 0, 1
MOUSEEVENTF_MOVE, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP = 0x1, 0x2, 0x4
MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP, MOUSEEVENTF_WHEEL, MOUSEEVENTF_ABSOLUTE = 0x8, 0x10, 0x800, 0x8000
KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, KEYEVENTF_SCANCODE = 0x1, 0x2, 0x8

ULONG_PTR = ctypes.c_size_t


class MOUSEINPUT(ctypes.Structure):
    _fields_ = [("dx", wt.LONG), ("dy", wt.LONG), ("mouseData", wt.DWORD), ("dwFlags", wt.DWORD),
                ("time", wt.DWORD), ("dwExtraInfo", ULONG_PTR)]


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [("wVk", wt.WORD), ("wScan", wt.WORD), ("dwFlags", wt.DWORD), ("time", wt.DWORD),
                ("dwExtraInfo", ULONG_PTR)]


class HARDWAREINPUT(ctypes.Structure):
    _fields_ = [("uMsg", wt.DWORD), ("wParamL", wt.WORD), ("wParamH", wt.WORD)]


class _U(ctypes.Union):
    _fields_ = [("mi", MOUSEINPUT), ("ki", KEYBDINPUT), ("hi", HARDWAREINPUT)]


class INPUT(ctypes.Structure):
    _fields_ = [("type", wt.DWORD), ("u", _U)]


user32.SendInput.argtypes = [wt.UINT, ctypes.POINTER(INPUT), ctypes.c_int]
user32.MapVirtualKeyW.argtypes = [wt.UINT, wt.UINT]

# teclas com nome -> VK
VK = {
    "esc": 0x1B, "enter": 0x0D, "space": 0x20, "tab": 0x09, "back": 0x08, "backspace": 0x08,
    "left": 0x25, "up": 0x26, "right": 0x27, "down": 0x28,
    "shift": 0x10, "ctrl": 0x11, "alt": 0x12,
    "add": 0x6B, "subtract": 0x6D, "pgup": 0x21, "pgdn": 0x22, "home": 0x24, "end": 0x23,
    "ins": 0x2D, "del": 0x2E, "pause": 0x13,
    **{f"f{i}": 0x6F + i for i in range(1, 13)},
}
EXTENDED = {0x25, 0x26, 0x27, 0x28, 0x21, 0x22, 0x24, 0x23, 0x2D, 0x2E}


def _send(*inputs):
    arr = (INPUT * len(inputs))(*inputs)
    n = user32.SendInput(len(inputs), arr, ctypes.sizeof(INPUT))
    if n != len(inputs):
        raise OSError(f"SendInput enviou {n}/{len(inputs)} (erro {ctypes.get_last_error()})")


def _mouse(flags, data=0):
    i = INPUT(type=INPUT_MOUSE)
    i.u.mi = MOUSEINPUT(0, 0, data, flags, 0, 0)
    return i


def _key(vk, up=False):
    scan = user32.MapVirtualKeyW(vk, 0)
    flags = KEYEVENTF_KEYUP if up else 0
    if vk in EXTENDED:
        flags |= KEYEVENTF_EXTENDEDKEY
    i = INPUT(type=INPUT_KEYBOARD)
    i.u.ki = KEYBDINPUT(vk, scan, flags, 0, 0)
    return i


class Input:
    def __init__(self, game, delay: float = 0.05):
        self.g = game
        self.delay = delay

    def _guard(self, x=None, y=None):
        self.g.check_alive()
        if not self.g.is_foreground() and not self.g.focus():
            raise RuntimeError("não consegui pôr a janela do jogo em primeiro plano; abortando a entrada")
        if x is not None:
            cx, cy, cw, ch = self.g.client_rect()
            if not (0 <= x < cw and 0 <= y < ch):
                raise ValueError(f"ponto ({x},{y}) fora da área cliente {cw}x{ch}")
            return cx + int(x), cy + int(y)

    # ----------------------------------------------------------------- mouse
    def move(self, x, y, steps: int = 1, dt: float = 0.01):
        """Move o cursor para (x,y) do cliente; steps>1 faz um trajeto (gera vários WM_MOUSEMOVE)."""
        sx, sy = self._guard(x, y)
        if steps > 1:
            p = wt.POINT()
            user32.GetCursorPos(ctypes.byref(p))
            for k in range(1, steps):
                user32.SetCursorPos(int(p.x + (sx - p.x) * k / steps), int(p.y + (sy - p.y) * k / steps))
                time.sleep(dt)
        user32.SetCursorPos(sx, sy)
        _send(_mouse(MOUSEEVENTF_MOVE))  # movimento relativo nulo: garante WM_MOUSEMOVE no ponto
        time.sleep(self.delay)

    def click(self, x, y, button="left", hold: float = 0.06, after: float | None = None):
        self.move(x, y)
        self._guard(x, y)
        down, up = (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP) if button == "left" else (
            MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP)
        _send(_mouse(down))
        time.sleep(hold)
        _send(_mouse(up))
        time.sleep(self.delay if after is None else after)

    def wheel(self, x, y, clicks=1):
        self.move(x, y)
        _send(_mouse(MOUSEEVENTF_WHEEL, (120 * clicks) & 0xFFFFFFFF))
        time.sleep(self.delay)

    # ----------------------------------------------------------------- teclado
    def key(self, name_or_vk, hold: float = 0.05, after: float | None = None, mods=()):
        self._guard()
        vk = name_or_vk if isinstance(name_or_vk, int) else (
            VK.get(name_or_vk.lower()) or ord(name_or_vk.upper()))
        mvk = [VK[m] for m in mods]
        _send(*[_key(m) for m in mvk], _key(vk))
        time.sleep(hold)
        _send(_key(vk, True), *[_key(m, True) for m in reversed(mvk)])
        time.sleep(self.delay if after is None else after)

    def type_text(self, text: str, dt: float = 0.03):
        """Digita texto ASCII (letras, dígitos, espaço)."""
        for ch in text:
            self._guard()
            if ch == " ":
                self.key("space", after=dt)
                continue
            r = user32.VkKeyScanW(ord(ch))
            vk, shift = r & 0xFF, (r >> 8) & 1
            self.key(vk, after=dt, mods=("shift",) if shift else ())
