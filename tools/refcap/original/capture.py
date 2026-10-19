"""Captura da área cliente do jogo original.

Métodos:
  - "screen": BitBlt da tela (DC da área de trabalho, CAPTUREBLT) no retângulo cliente. Funciona com o DirectDraw em
    modo janela (-window), pois o DWM compõe a janela. Requer que a janela esteja visível e não coberta (focamos antes).
  - "print": PrintWindow(PW_RENDERFULLCONTENT) — reserva; costuma vir preto com DirectDraw.
O cursor do Windows não entra em BitBlt. `draw_cursor=True` desenha o cursor atual (GetCursorInfo + DrawIconEx) por cima,
na posição real, para os cenários de cursor (o jogo usa cursor de hardware via SetCursor — veja notes/original-capture.md).
"""
from __future__ import annotations

import ctypes
import ctypes.wintypes as wt
import time

import numpy as np
from PIL import Image

user32 = ctypes.WinDLL("user32", use_last_error=True)
gdi32 = ctypes.WinDLL("gdi32", use_last_error=True)

user32.GetDC.restype = wt.HDC
user32.GetDC.argtypes = [wt.HWND]
user32.ReleaseDC.argtypes = [wt.HWND, wt.HDC]
gdi32.CreateCompatibleDC.restype = wt.HDC
gdi32.CreateCompatibleDC.argtypes = [wt.HDC]
gdi32.CreateCompatibleBitmap.restype = wt.HBITMAP
gdi32.CreateCompatibleBitmap.argtypes = [wt.HDC, ctypes.c_int, ctypes.c_int]
gdi32.SelectObject.restype = wt.HGDIOBJ
gdi32.SelectObject.argtypes = [wt.HDC, wt.HGDIOBJ]
gdi32.BitBlt.argtypes = [wt.HDC, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wt.HDC, ctypes.c_int,
                         ctypes.c_int, wt.DWORD]
gdi32.DeleteObject.argtypes = [wt.HGDIOBJ]
gdi32.DeleteDC.argtypes = [wt.HDC]
gdi32.GetDIBits.argtypes = [wt.HDC, wt.HBITMAP, wt.UINT, wt.UINT, ctypes.c_void_p, ctypes.c_void_p, wt.UINT]
user32.PrintWindow.argtypes = [wt.HWND, wt.HDC, wt.UINT]
user32.DrawIconEx.argtypes = [wt.HDC, ctypes.c_int, ctypes.c_int, wt.HANDLE, ctypes.c_int, ctypes.c_int, wt.UINT,
                              wt.HBRUSH, wt.UINT]

SRCCOPY, CAPTUREBLT = 0x00CC0020, 0x40000000


class BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [("biSize", wt.DWORD), ("biWidth", wt.LONG), ("biHeight", wt.LONG), ("biPlanes", wt.WORD),
                ("biBitCount", wt.WORD), ("biCompression", wt.DWORD), ("biSizeImage", wt.DWORD),
                ("biXPelsPerMeter", wt.LONG), ("biYPelsPerMeter", wt.LONG), ("biClrUsed", wt.DWORD),
                ("biClrImportant", wt.DWORD)]


class CURSORINFO(ctypes.Structure):
    _fields_ = [("cbSize", wt.DWORD), ("flags", wt.DWORD), ("hCursor", wt.HANDLE), ("ptScreenPos", wt.POINT)]


class ICONINFO(ctypes.Structure):
    _fields_ = [("fIcon", wt.BOOL), ("xHotspot", wt.DWORD), ("yHotspot", wt.DWORD), ("hbmMask", wt.HBITMAP),
                ("hbmColor", wt.HBITMAP)]


user32.GetIconInfo.argtypes = [wt.HANDLE, ctypes.POINTER(ICONINFO)]


def cursor_info():
    """(hCursor, (x, y) tela, hotspot (hx, hy), visível)."""
    ci = CURSORINFO()
    ci.cbSize = ctypes.sizeof(CURSORINFO)
    user32.GetCursorInfo(ctypes.byref(ci))
    hot = (0, 0)
    if ci.hCursor:
        ii = ICONINFO()
        if user32.GetIconInfo(ci.hCursor, ctypes.byref(ii)):
            hot = (ii.xHotspot, ii.yHotspot)
            if ii.hbmMask:
                gdi32.DeleteObject(ii.hbmMask)
            if ii.hbmColor:
                gdi32.DeleteObject(ii.hbmColor)
    return ci.hCursor, (ci.ptScreenPos.x, ci.ptScreenPos.y), hot, bool(ci.flags & 1)


def _dib_to_image(hdc, hbmp, w, h) -> Image.Image:
    bmi = BITMAPINFOHEADER()
    bmi.biSize = ctypes.sizeof(BITMAPINFOHEADER)
    bmi.biWidth, bmi.biHeight, bmi.biPlanes, bmi.biBitCount = w, -h, 1, 32
    buf = (ctypes.c_ubyte * (w * h * 4))()
    gdi32.GetDIBits(hdc, hbmp, 0, h, buf, ctypes.byref(bmi), 0)
    a = np.frombuffer(buf, dtype=np.uint8).reshape(h, w, 4)
    return Image.fromarray(a[:, :, [2, 1, 0]].copy(), "RGB")


def grab_rect(x, y, w, h, draw_cursor=False, hwnd=None, method="screen") -> Image.Image:
    src = user32.GetDC(None if method == "screen" else hwnd)
    mem = gdi32.CreateCompatibleDC(src)
    bmp = gdi32.CreateCompatibleBitmap(src, w, h)
    old = gdi32.SelectObject(mem, bmp)
    try:
        if method == "screen":
            gdi32.BitBlt(mem, 0, 0, w, h, src, x, y, SRCCOPY | CAPTUREBLT)
        else:
            user32.PrintWindow(hwnd, mem, 2)  # PW_RENDERFULLCONTENT (janela inteira, inclusive bordas)
        if draw_cursor:
            hc, (cx, cy), (hx, hy), vis = cursor_info()
            if hc and vis:
                user32.DrawIconEx(mem, cx - x - hx, cy - y - hy, hc, 0, 0, 0, None, 0x3)  # DI_NORMAL
        return _dib_to_image(mem, bmp, w, h)
    finally:
        gdi32.SelectObject(mem, old)
        gdi32.DeleteObject(bmp)
        gdi32.DeleteDC(mem)
        user32.ReleaseDC(None if method == "screen" else hwnd, src)


def grab(game, draw_cursor=False) -> Image.Image:
    """Área cliente do jogo (1024x768)."""
    x, y, w, h = game.client_rect()
    return grab_rect(x, y, w, h, draw_cursor=draw_cursor)


def is_blank(img: Image.Image, tol: int = 4) -> bool:
    a = np.asarray(img)
    return int(a.max()) - int(a.min()) <= tol


def grab_stable(game, draw_cursor=False, settle=0.15, tries=8, max_diff=0.0) -> Image.Image:
    """Captura até dois quadros seguidos serem iguais (útil para telas estáticas)."""
    prev = grab(game, draw_cursor)
    for _ in range(tries):
        time.sleep(settle)
        cur = grab(game, draw_cursor)
        d = np.mean(np.asarray(cur, dtype=np.int16) != np.asarray(prev, dtype=np.int16))
        if d <= max_diff:
            return cur
        prev = cur
    return prev


def grab_sequence(game, n, interval_ms, draw_cursor=False):
    out = []
    t0 = time.perf_counter()
    for i in range(n):
        target = t0 + i * interval_ms / 1000.0
        while time.perf_counter() < target:
            time.sleep(0.002)
        out.append((time.perf_counter() - t0, grab(game, draw_cursor)))
    return out
