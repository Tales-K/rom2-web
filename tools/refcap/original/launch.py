"""Inicia/encerra o Rage of Mages II original (allods2.exe) em modo janela, de forma controlada.

Uso como biblioteca:
    from launch import Game
    with Game(args=["-window", "-1024"]) as g:   # sempre mata o processo no fim (finally)
        g.wait_ready()
        ...

Uso na linha de comando (teste rápido):
    python launch.py [--args "-window -1024 -nomusic"] [--hold 10]

Regras: nada é escrito na pasta do jogo por este módulo; o processo é encerrado ao sair (inclusive em exceções),
e `kill_all()` confirma que não sobrou nenhum allods2.exe.
"""
from __future__ import annotations

import ctypes
import ctypes.wintypes as wt
import os
import subprocess
import sys
import time

GOG_DIR = r"C:\GOG Games\Rage of Mages II"   # instalação original: somente leitura
# pasta de execução (cópia + dgVoodoo2 em janela), criada por setup_runtime.py — veja notes/original-capture.md
GAME_DIR = r"C:\Users\TALES K\Games\a2_run"
EXE = os.path.join(GAME_DIR, "allods2.exe")
WINDOW_CLASS = "CMainWindow"  # nome da classe C++; a janela real é MFC "Afx:400000:b", título "Rage of Mages 2: Necromancer"
CLIENT_W, CLIENT_H = 1024, 768
# posição fixa do canto superior esquerdo da ÁREA CLIENTE na tela (monitor principal).
# TEM de ser (0,0): o jogo pensa que está em tela cheia e usa GetCursorPos (coordenadas de TELA) como coordenadas
# de jogo para desenhar o cursor e para o hover; com a janela deslocada o cursor do jogo fica deslocado.
CLIENT_X, CLIENT_Y = 0, 0

user32 = ctypes.WinDLL("user32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
try:  # coordenadas físicas (a máquina está a 96 dpi, mas não custa)
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    pass

WNDENUMPROC = ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)
user32.EnumWindows.argtypes = [WNDENUMPROC, wt.LPARAM]
user32.GetWindowThreadProcessId.argtypes = [wt.HWND, ctypes.POINTER(wt.DWORD)]
user32.GetWindowThreadProcessId.restype = wt.DWORD
user32.GetClassNameW.argtypes = [wt.HWND, wt.LPWSTR, ctypes.c_int]
user32.GetWindowTextW.argtypes = [wt.HWND, wt.LPWSTR, ctypes.c_int]
user32.GetClientRect.argtypes = [wt.HWND, ctypes.POINTER(wt.RECT)]
user32.GetWindowRect.argtypes = [wt.HWND, ctypes.POINTER(wt.RECT)]
user32.ClientToScreen.argtypes = [wt.HWND, ctypes.POINTER(wt.POINT)]
user32.SetWindowPos.argtypes = [wt.HWND, wt.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wt.UINT]
user32.GetForegroundWindow.restype = wt.HWND
user32.IsWindowVisible.argtypes = [wt.HWND]
user32.IsWindow.argtypes = [wt.HWND]


def _class(hwnd) -> str:
    b = ctypes.create_unicode_buffer(256)
    user32.GetClassNameW(hwnd, b, 256)
    return b.value


def _title(hwnd) -> str:
    b = ctypes.create_unicode_buffer(512)
    user32.GetWindowTextW(hwnd, b, 512)
    return b.value


def windows_of_pid(pid: int) -> list[int]:
    out: list[int] = []

    def cb(hwnd, _):
        p = wt.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(p))
        if p.value == pid:
            out.append(hwnd)
        return True

    user32.EnumWindows(WNDENUMPROC(cb), 0)
    return out


def list_game_pids() -> list[int]:
    r = subprocess.run(["tasklist", "/FI", "IMAGENAME eq allods2.exe", "/FO", "CSV", "/NH"],
                       capture_output=True, text=True)
    pids = []
    for line in r.stdout.splitlines():
        parts = [p.strip('"') for p in line.split('","')]
        if len(parts) > 1 and parts[0].lower().startswith("allods2"):
            try:
                pids.append(int(parts[1]))
            except ValueError:
                pass
    return pids


def kill_all(timeout: float = 5.0) -> bool:
    """Mata todo allods2.exe e confirma. Devolve True se não sobrou nenhum."""
    for pid in list_game_pids():
        subprocess.run(["taskkill", "/F", "/PID", str(pid)], capture_output=True)
    t0 = time.time()
    while time.time() - t0 < timeout:
        if not list_game_pids():
            return True
        time.sleep(0.2)
    return not list_game_pids()


class GameCrashed(RuntimeError):
    pass


class DisplayModeChanged(RuntimeError):
    pass


# ------------------------------------------------------------------ guarda do modo de vídeo do monitor
class DEVMODEW(ctypes.Structure):
    _fields_ = [("dmDeviceName", wt.WCHAR * 32), ("dmSpecVersion", wt.WORD), ("dmDriverVersion", wt.WORD),
                ("dmSize", wt.WORD), ("dmDriverExtra", wt.WORD), ("dmFields", wt.DWORD),
                ("dmPositionX", wt.LONG), ("dmPositionY", wt.LONG), ("dmDisplayOrientation", wt.DWORD),
                ("dmDisplayFixedOutput", wt.DWORD), ("dmColor", ctypes.c_short), ("dmDuplex", ctypes.c_short),
                ("dmYResolution", ctypes.c_short), ("dmTTOption", ctypes.c_short), ("dmCollate", ctypes.c_short),
                ("dmFormName", wt.WCHAR * 32), ("dmLogPixels", wt.WORD), ("dmBitsPerPel", wt.DWORD),
                ("dmPelsWidth", wt.DWORD), ("dmPelsHeight", wt.DWORD), ("dmDisplayFlags", wt.DWORD),
                ("dmDisplayFrequency", wt.DWORD), ("dmICMMethod", wt.DWORD), ("dmICMIntent", wt.DWORD),
                ("dmMediaType", wt.DWORD), ("dmDitherType", wt.DWORD), ("dmReserved1", wt.DWORD),
                ("dmReserved2", wt.DWORD), ("dmPanningWidth", wt.DWORD), ("dmPanningHeight", wt.DWORD)]


user32.EnumDisplaySettingsW.argtypes = [wt.LPCWSTR, wt.DWORD, ctypes.POINTER(DEVMODEW)]
user32.ChangeDisplaySettingsW.argtypes = [ctypes.c_void_p, wt.DWORD]


def display_mode() -> tuple[int, int, int, int]:
    """(largura, altura, bpp, Hz) atuais do monitor principal."""
    dm = DEVMODEW()
    dm.dmSize = ctypes.sizeof(DEVMODEW)
    user32.EnumDisplaySettingsW(None, 0xFFFFFFFF, ctypes.byref(dm))  # ENUM_CURRENT_SETTINGS
    return dm.dmPelsWidth, dm.dmPelsHeight, dm.dmBitsPerPel, dm.dmDisplayFrequency


def restore_display(saved) -> bool:
    """Se o modo atual difere do gravado, volta ao modo do registro (ChangeDisplaySettings(NULL,0))."""
    if display_mode() == saved:
        return False
    user32.ChangeDisplaySettingsW(None, 0)
    time.sleep(1.0)
    if display_mode() != saved:  # reaplica os valores gravados explicitamente
        dm = DEVMODEW()
        dm.dmSize = ctypes.sizeof(DEVMODEW)
        dm.dmPelsWidth, dm.dmPelsHeight, dm.dmBitsPerPel, dm.dmDisplayFrequency = saved
        dm.dmFields = 0x80000 | 0x100000 | 0x40000 | 0x400000
        user32.ChangeDisplaySettingsW(ctypes.byref(dm), 0)
    return True


class Game:
    def __init__(self, args=None, extra_env: dict | None = None, start_timeout: float = 40.0,
                 place: bool = True, max_runtime: float = 600.0, hide_others: bool = True):
        self.args = list(args) if args is not None else ["-window", "-1024"]
        self.extra_env = extra_env or {}
        self.start_timeout = start_timeout
        self.place = place
        self.hide_others = hide_others
        self._guard = None
        self.max_runtime = max_runtime
        self.proc: subprocess.Popen | None = None
        self.hwnd: int | None = None
        self.t_start = 0.0
        self.saved_mode = None
        self.violation: str | None = None
        self._stop = False

    # ---------------------------------------------------------------- ciclo de vida
    def start(self):
        import threading
        if not os.path.exists(os.path.join(GAME_DIR, "DDraw.dll")):
            raise RuntimeError("pasta de execução sem dgVoodoo2: rode setup_runtime.py (sem ele o jogo vai a tela cheia)")
        kill_all()
        self.saved_mode = display_mode()
        env = dict(os.environ)
        env.update(self.extra_env)
        self.t_start = time.time()
        self.proc = subprocess.Popen([EXE, *self.args], cwd=GAME_DIR, env=env)
        threading.Thread(target=self._watchdog, daemon=True).start()
        self.hwnd = self._wait_window()
        if self.place:
            self.place_window()
        if self.hide_others:  # minimiza as janelas do usuario que cobrem o jogo (autorizado); restaurado em close()
            from winguard import hide_others as _hide
            self._guard = _hide(self.hwnd)
            self._guard.__enter__()
            self.focus()
        return self

    def _watchdog(self):
        """A cada 100 ms: modo do monitor igual ao gravado, janela não em tela cheia, tempo máximo."""
        sw, sh = self.saved_mode[0], self.saved_mode[1]
        while not self._stop and self.proc and self.proc.poll() is None:
            why = None
            mode = display_mode()
            if mode != self.saved_mode:
                why = f"modo do monitor mudou: {self.saved_mode} -> {mode}"
            elif self.hwnd:
                r = wt.RECT()
                user32.GetWindowRect(self.hwnd, ctypes.byref(r))
                if r.left <= 0 and r.top <= 0 and r.right >= sw and r.bottom >= sh:
                    why = f"janela do jogo em tela cheia {r.left, r.top, r.right, r.bottom}"
            if not why and time.time() - self.t_start > self.max_runtime:
                why = f"tempo máximo de execução ({self.max_runtime:.0f}s)"
            if why:
                self.violation = why
                try:
                    self.proc.kill()
                except Exception:
                    pass
                kill_all()
                restore_display(self.saved_mode)
                print("WATCHDOG:", why, file=sys.stderr)
                return
            time.sleep(0.1)

    def _wait_window(self) -> int:
        t0 = time.time()
        while time.time() - t0 < self.start_timeout:
            self.check_alive()
            for h in windows_of_pid(self.proc.pid):
                cls = _class(h)
                if user32.IsWindowVisible(h) and (cls == WINDOW_CLASS or (
                        cls.startswith("Afx:400000") and _title(h).startswith("Rage of Mages"))):
                    return h
            time.sleep(0.2)
        raise TimeoutError("janela CMainWindow não apareceu em %.0fs (diálogos: %r)"
                           % (self.start_timeout, self.dialogs()))

    def dialogs(self) -> list[tuple[str, str]]:
        """Janelas visíveis do processo que não são a principal (caixas de erro etc.)."""
        if not self.proc:
            return []
        res = []
        for h in windows_of_pid(self.proc.pid):
            if h != self.hwnd and user32.IsWindowVisible(h):
                res.append((_class(h), _title(h)))
        return res

    def check_alive(self):
        if self.proc is None:
            raise GameCrashed("jogo não iniciado")
        if self.violation:
            raise DisplayModeChanged(self.violation)
        rc = self.proc.poll()
        if rc is not None:
            raise GameCrashed(f"allods2.exe terminou (código {rc & 0xffffffff:#x})")
        for cls, title in self.dialogs():
            if cls == "#32770":  # MessageBox
                raise GameCrashed(f"caixa de diálogo do jogo: {title!r}")

    def close(self):
        try:
            if self.proc and self.proc.poll() is None:
                self.proc.kill()
                try:
                    self.proc.wait(5)
                except subprocess.TimeoutExpired:
                    pass
        finally:
            self._stop = True
            if self._guard is not None:
                try:
                    self._guard.__exit__(None, None, None)
                finally:
                    self._guard = None
            ok = kill_all()
            if not ok:
                print("AVISO: ainda há allods2.exe rodando!", file=sys.stderr)
            if self.saved_mode and restore_display(self.saved_mode):
                print("AVISO: o modo do monitor tinha mudado e foi restaurado", file=sys.stderr)

    def __enter__(self):
        try:
            return self.start()
        except BaseException:
            self.close()
            raise

    def __exit__(self, *exc):
        self.close()
        return False

    # ---------------------------------------------------------------- janela
    def client_rect(self) -> tuple[int, int, int, int]:
        """(x, y, w, h) da área cliente em coordenadas de tela."""
        r = wt.RECT()
        user32.GetClientRect(self.hwnd, ctypes.byref(r))
        p = wt.POINT(0, 0)
        user32.ClientToScreen(self.hwnd, ctypes.byref(p))
        return p.x, p.y, r.right - r.left, r.bottom - r.top

    def place_window(self):
        """Move a janela para que a área cliente fique em (CLIENT_X, CLIENT_Y). Não muda o tamanho
        (o próprio jogo define 1024x768 com -1024); avisa se o tamanho não bater."""
        for _ in range(20):
            wr = wt.RECT()
            user32.GetWindowRect(self.hwnd, ctypes.byref(wr))
            cx, cy, cw, ch = self.client_rect()
            dx, dy = cx - wr.left, cy - wr.top
            SWP_NOSIZE, SWP_NOZORDER, SWP_NOACTIVATE = 0x1, 0x4, 0x10
            user32.SetWindowPos(self.hwnd, 0, CLIENT_X - dx, CLIENT_Y - dy, 0, 0,
                                SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE)
            time.sleep(0.1)
            cx, cy, cw, ch = self.client_rect()
            if (cx, cy) == (CLIENT_X, CLIENT_Y):
                break
        if (cw, ch) != (CLIENT_W, CLIENT_H):
            print(f"AVISO: área cliente {cw}x{ch} (esperado {CLIENT_W}x{CLIENT_H})", file=sys.stderr)

    def is_foreground(self) -> bool:
        return user32.GetForegroundWindow() == self.hwnd

    def focus(self, tries: int = 10) -> bool:
        """Traz a janela do jogo para o primeiro plano (truque AttachThreadInput)."""
        for _ in range(tries):
            if self.is_foreground():
                return True
            fg = user32.GetForegroundWindow()
            cur = kernel32.GetCurrentThreadId()
            fgt = user32.GetWindowThreadProcessId(fg, None) if fg else 0
            tgt = user32.GetWindowThreadProcessId(self.hwnd, None)
            if fgt:
                user32.AttachThreadInput(cur, fgt, True)
            user32.AttachThreadInput(cur, tgt, True)
            user32.ShowWindow(self.hwnd, 9)  # SW_RESTORE
            user32.BringWindowToTop(self.hwnd)
            user32.SetForegroundWindow(self.hwnd)
            if fgt:
                user32.AttachThreadInput(cur, fgt, False)
            user32.AttachThreadInput(cur, tgt, False)
            time.sleep(0.15)
        return self.is_foreground()

    def wait(self, sec: float):
        """Espera checando se o jogo continua vivo."""
        t0 = time.time()
        while time.time() - t0 < sec:
            self.check_alive()
            time.sleep(min(0.1, sec))


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--args", default="-window -1024")
    ap.add_argument("--hold", type=float, default=5)
    a = ap.parse_args()
    with Game(a.args.split()) as g:
        print("hwnd", g.hwnd, "cliente", g.client_rect(), "foco", g.focus())
        g.wait(a.hold)
        print("diálogos:", g.dialogs())
    print("restantes:", list_game_pids())
