"""Fluxo completo: captura o NOSSO jogo, compara com refs/original existentes e escreve docs/COMPARE/report.md.

  .venv\\Scripts\\python.exe tools/refcap/run_all.py [--only id,id] [--skip-capture] [--headful] [--realtime]
                                                    [-- <opcoes extras do compare.py>]

Requisitos: servidor Vite rodando em http://127.0.0.1:5173/ (nao e iniciado aqui), Node 18+ e as dependencias de
tools/refcap/ours (npm install feito uma vez; ver docs/DOWNLOADS.md). A captura do ORIGINAL e da outra frente
(tools/refcap/original/); este script so usa os PNG que ja estiverem em refs/original.
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
import compare  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", default=None, help="ids separados por virgula")
    ap.add_argument("--skip-capture", action="store_true", help="so compara (usa refs/ours como esta)")
    ap.add_argument("--headful", action="store_true", help="mostra a janela do navegador durante a captura")
    ap.add_argument("--realtime", action="store_true", help="sequencias com relogio real em vez do virtual")
    ap.add_argument("--url", default="http://127.0.0.1:5173/")
    ap.add_argument("rest", nargs=argparse.REMAINDER, help="apos --, opcoes repassadas ao compare.py")
    a = ap.parse_args()

    cap_rc = 0
    if not a.skip_capture:
        try:
            urllib.request.urlopen(a.url, timeout=5).read(64)
        except Exception as e:  # noqa: BLE001
            print(f"[erro] servidor do jogo inacessivel em {a.url}: {e}. Inicie o Vite (cd game && npm run dev) e repita.", file=sys.stderr)
            return 2
        node = shutil.which("node")
        if not node:
            print("[erro] node nao encontrado no PATH", file=sys.stderr)
            return 2
        if not (HERE / "ours/node_modules/puppeteer-core").exists():
            print("[erro] falta tools/refcap/ours/node_modules: rode `npm install` em tools/refcap/ours", file=sys.stderr)
            return 2
        cmd = [node, str(HERE / "ours/capture.mjs"), "--url", a.url]
        if a.only:
            cmd += ["--only", a.only]
        if a.headful:
            cmd.append("--headful")
        if a.realtime:
            cmd.append("--realtime")
        print("[captura] " + " ".join(cmd), flush=True)
        cap_rc = subprocess.call(cmd, cwd=str(ROOT))
        if cap_rc:
            print(f"[aviso] a captura terminou com codigo {cap_rc} (alguns cenarios falharam); comparando o que existe", file=sys.stderr)

    rest = [x for x in a.rest if x != "--"]
    cargs = (["--only", a.only] if a.only else []) + rest
    print("[comparacao] compare.py " + " ".join(cargs), flush=True)
    rc = compare.main(cargs)
    return rc or (1 if cap_rc else 0)


if __name__ == "__main__":
    sys.exit(main())
