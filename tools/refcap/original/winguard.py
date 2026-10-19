"""Minimiza as janelas do usuario que cobrem o jogo durante a captura e SEMPRE as restaura depois.

Autorizado pelo usuario (so durante a captura; nunca fecha janela nem encerra programa). Regras:
  - so janelas visiveis, nao minimizadas, nao "cloaked" e que intersectam o retangulo do jogo (0,0,1024,768);
  - guarda a ordem Z, o estado (maximizada/normal) e a janela em primeiro plano; restaura em ordem inversa (de baixo
    para cima) com SW_RESTORE (volta a maximizada se estava), e devolve o foco a que estava em primeiro plano;
  - grava scratch/winguard_state.json para o caso de o processo morrer: `python winguard.py --restore` restaura.
Uso: `with hide_others(game_hwnd): ...` (ou Game(..., hide_others=True), que ja usa isto).
"""
from __future__ import annotations

import contextlib
import ctypes
import ctypes.wintypes as wt
import json
import os
import sys
import time

user32 = ctypes.WinDLL("user32", use_last_error=True)
dwm = ctypes.WinDLL("dwmapi")
WNDENUMPROC = ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
user32.EnumWindows.argtypes = [WNDENUMPROC, wt.LPARAM]
for _f in ("IsWindowVisible", "IsIconic", "IsZoomed", "IsWindow"):
    getattr(user32, _f).argtypes = [wt.HWND]
user32.GetWindowRect.argtypes = [wt.HWND, ctypes.POINTER(wt.RECT)]
user32.GetClassNameW.argtypes = [wt.HWND, wt.LPWSTR, ctypes.c_int]
user32.GetWindowTextW.argtypes = [wt.HWND, wt.LPWSTR, ctypes.c_int]
user32.GetWindowLongW.argtypes = [wt.HWND, ctypes.c_int]
user32.ShowWindow.argtypes = [wt.HWND, ctypes.c_int]
user32.GetForegroundWindow.restype = wt.HWND
user32.SetForegroundWindow.argtypes = [wt.HWND]

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
STATE = os.path.join(ROOT, "scratch", "winguard_state.json")
SKIP_CLASSES = {"Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "Windows.UI.Core.CoreWindow",
                "XamlExplorerHostIslandWindow", "TopLevelWindowForOverflowXamlIsland"}
GWL_EXSTYLE, WS_EX_TOOLWINDOW = -20, 0x80
SW_RESTORE, SW_SHOWMINNOACTIVE = 9, 7


def _cls(h):
    b = ctypes.create_unicode_buffer(256)
    user32.GetClassNameW(h, b, 256)
    return b.value


def _title(h):
    b = ctypes.create_unicode_buffer(256)
    user32.GetWindowTextW(h, b, 256)
    return b.value


def _cloaked(h):
    v = wt.DWORD(0)
    dwm.DwmGetWindowAttribute(wt.HWND(h), 14, ctypes.byref(v), 4)
    return bool(v.value)


def covering_windows(game_hwnd, rect=(0, 0, 1024, 768)):
    """Janelas do usuario (topo -> fundo) que cobrem o retangulo `rect` da tela."""
    out = []

    def cb(h, _):
        if h == game_hwnd or not user32.IsWindowVisible(h) or user32.IsIconic(h) or _cloaked(h):
            return True
        if _cls(h) in SKIP_CLASSES or (user32.GetWindowLongW(h, GWL_EXSTYLE) & WS_EX_TOOLWINDOW):
            return True
        if not _title(h):
            return True
        r = wt.RECT()
        user32.GetWindowRect(h, ctypes.byref(r))
        if r.right - r.left < 100 or r.bottom - r.top < 60:
            return True
        if r.right <= rect[0] or r.left >= rect[2] or r.bottom <= rect[1] or r.top >= rect[3]:
            return True
        out.append((int(h), bool(user32.IsZoomed(h)), _title(h)[:40], _cls(h)))
        return True

    user32.EnumWindows(WNDENUMPROC(cb), 0)
    return out


def restore_from(items, fg):
    n = 0
    for h, zoomed, *_ in reversed(items):  # do fundo para o topo
        if user32.IsWindow(h) and user32.IsIconic(h):
            user32.ShowWindow(h, SW_RESTORE)
            n += 1
            time.sleep(0.15)
    if fg and user32.IsWindow(fg):
        try:
            user32.SetForegroundWindow(fg)
        except Exception:  # noqa: BLE001
            pass
    return n


@contextlib.contextmanager
def hide_others(game_hwnd=None, rect=(0, 0, 1024, 768), settle=0.8, verbose=True):
    fg = int(user32.GetForegroundWindow() or 0)
    items = covering_windows(game_hwnd, rect)
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    json.dump({"fg": fg, "items": items}, open(STATE, "w"), ensure_ascii=False)
    try:
        for h, *_ in items:
            user32.ShowWindow(h, SW_SHOWMINNOACTIVE)
        time.sleep(settle)
        if verbose:
            print(f"[winguard] minimizadas {len(items)}: " + "; ".join(f"{t!r}{'(max)' if z else ''}" for _, z, t, _c in items),
                  flush=True)
        yield items
    finally:
        n = restore_from(items, fg)
        try:
            os.remove(STATE)
        except OSError:
            pass
        if verbose:
            print(f"[winguard] restauradas {n}", flush=True)


if __name__ == "__main__":
    if "--restore" in sys.argv and os.path.exists(STATE):
        d = json.load(open(STATE))
        print("restauradas", restore_from([tuple(i) for i in d["items"]], d["fg"]))
        os.remove(STATE)
    elif "--list" in sys.argv:
        for it in covering_windows(None):
            print(it)
