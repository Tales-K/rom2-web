"""Monta a pasta de execuÃ§Ã£o do jogo original FORA de C:\\GOG Games, com o dgVoodoo2 em modo janela.

Por quÃª: o allods2.exe sÃ³ aceita `-window` com o desktop em 16 bpp. Ele lÃª as mÃ¡scaras R/G/B da superfÃ­cie primÃ¡ria em
WORDs (0x4531fc); em 32 bpp a mÃ¡scara vermelha 0x00FF0000 vira 0 e o jogo cai em 0x453036 = SetCooperativeLevel(
EXCLUSIVE|FULLSCREEN) + SetDisplayMode(1024,768,16) -> tela cheia e troca de resoluÃ§Ã£o do monitor. O dgVoodoo2
(DDraw.dll x86) emula o DirectDraw inteiro e apresenta numa janela, sem tocar no modo do monitor.

    python setup_runtime.py            # cria/atualiza C:\\Users\\TALES K\\Games\\a2_run
    python setup_runtime.py --check    # sÃ³ confere

A pasta do GOG Ã© apenas LIDA. Saves (game*.sav), famehall.dat e afins passam a ser escritos em a2_run.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import sys

SRC = r"C:\GOG Games\Rage of Mages II"
RUN = r"C:\Users\TALES K\Games\a2_run"
DGV = r"C:\Users\TALES K\Games\_downloads\dgVoodoo2_87_5\x"
DGV_SHA256_ZIP = "5ffde6927f7355ca3fdd5d785b581256a8e6539fa13e395a891ade6ba1040850"
SKIP = {"unins000.exe", "unins000.dat", "unins000.msg", "ROM2 Map Editor.exe", "webcache.zip"}

# chaves do dgVoodoo.conf que alteramos (seÃ§Ã£o -> {chave: valor})
CONF = {
    "General": {"FullScreenMode": "false", "ScalingMode": "unspecified", "CaptureMouse": "false",
                "CenterAppWindow": "false", "KeepWindowAspectRatio": "true"},
    "GeneralExt": {"WindowedAttributes": "", "FPSLimit": "0", "PresentationModel": "flip_discard"},  # "auto" deixa a janela invisivel p/ BitBlt (19/10)
    "DirectX": {"AppControlledScreenMode": "false", "dgVoodooWatermark": "false", "Filtering": "appdriven",
                "Resolution": "unforced", "Bilinear2DOperations": "false"},
}


def patch_conf(text: str) -> str:
    out, sec = [], None
    for line in text.splitlines():
        s = line.strip()
        if s.startswith("[") and s.endswith("]"):
            sec = s[1:-1]
        elif sec in CONF and "=" in s and not s.startswith(";"):
            k = s.split("=", 1)[0].strip()
            if k in CONF[sec]:
                line = f"{k:<37}= {CONF[sec][k]}"
        out.append(line)
    return "\n".join(out) + "\n"


# O exe lÃª HKLM\SOFTWARE\Rage of Mages 2\INSTALLDIR e faz SetCurrentDirectoryA nele (0x480f12..0x480f23): saves,
# famehall.dat e .res iriam para C:\GOG Games. Na CÃ“PIA renomeamos o nome do valor consultado (string em .data,
# offset de arquivo 0x1f0b34, Ãºnico uso em 0x480f07); a consulta falha e o jogo fica no diretÃ³rio atual (a2_run).
INSTALLDIR_OFF = 0x1F0B34
INSTALLDIR_ORIG = b"INSTALLDIR\0"
INSTALLDIR_NEW = b"INSTALLDIX\0"


def patch_installdir(check_only=False):
    p = os.path.join(RUN, "allods2.exe")
    with open(p, "r+b") as f:
        f.seek(INSTALLDIR_OFF)
        cur = f.read(len(INSTALLDIR_ORIG))
        if cur == INSTALLDIR_NEW:
            print("exe jÃ¡ corrigido (INSTALLDIX)")
        elif cur == INSTALLDIR_ORIG:
            if check_only:
                print("exe SEM a correÃ§Ã£o de INSTALLDIR")
            else:
                f.seek(INSTALLDIR_OFF)
                f.write(INSTALLDIR_NEW)
                print("exe corrigido: INSTALLDIR -> INSTALLDIX")
        else:
            raise RuntimeError(f"bytes inesperados em {INSTALLDIR_OFF:#x}: {cur!r}")


def sha256(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    os.makedirs(RUN, exist_ok=True)
    for name in os.listdir(SRC):
        s, d = os.path.join(SRC, name), os.path.join(RUN, name)
        if name in SKIP or name.lower().endswith(".sav") or os.path.isdir(s) and name in ("Help",):
            continue
        if os.path.isdir(s):
            if not a.check:
                shutil.copytree(s, d, dirs_exist_ok=True)
            continue
        if name.lower() in ("famehall.dat",) and os.path.exists(d):
            continue  # o jogo reescreve; nÃ£o sobrescrever o da pasta de execuÃ§Ã£o
        if not os.path.exists(d) or os.path.getsize(d) != os.path.getsize(s):
            if a.check:
                print("faltando/diferente:", name)
            else:
                shutil.copy2(s, d)
    patch_installdir(a.check)
    if not a.check:
        shutil.copy2(os.path.join(DGV, "MS", "x86", "DDraw.dll"), os.path.join(RUN, "DDraw.dll"))
        conf = open(os.path.join(DGV, "dgVoodoo.conf"), encoding="utf-8", errors="replace").read()
        open(os.path.join(RUN, "dgVoodoo.conf"), "w", encoding="utf-8").write(patch_conf(conf))
    print("DDraw.dll", sha256(os.path.join(RUN, "DDraw.dll")))
    print("ok:", RUN)


if __name__ == "__main__":
    sys.exit(main())

