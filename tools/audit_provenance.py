"""Auditoria de procedencia visual: lista tudo que o jogo web DESENHA por conta propria (e portanto pode nao existir no original).

Procura em game/src: formas desenhadas com PIXI.Graphics, textos literais passados a makeText (que nao vem dos textos do jogo)
e criacao de elementos de DOM. Cada ocorrencia e um candidato a "elemento inventado": revisar contra o original (captura de tela / executavel).
Saida: docs/PROVENANCE.md (reescrito a cada execucao).

Uso: python tools/audit_provenance.py
"""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "game", "src")
OUT = os.path.join(ROOT, "docs", "PROVENANCE.md")

PATTERNS = [
    ("forma desenhada (Graphics)", re.compile(r"new Graphics\(\)")),
    ("texto literal (makeText)", re.compile(r"makeText\(\s*([\"'`])(?P<s>[^\"'`]{1,60})\1")),
    ("elemento DOM", re.compile(r"document\.createElement\(\s*[\"'](?P<s>\w+)[\"']")),
]
SKIP_FILES = {"_stub.ts"}


def main():
    rows = []
    for dp, _, fs in os.walk(SRC):
        if os.sep + "test" in dp:
            continue
        for f in sorted(fs):
            if not f.endswith(".ts") or f in SKIP_FILES:
                continue
            p = os.path.join(dp, f)
            rel = os.path.relpath(p, ROOT).replace("\\", "/")
            for i, line in enumerate(open(p, encoding="utf-8").read().splitlines(), 1):
                for kind, rx in PATTERNS:
                    m = rx.search(line)
                    if m:
                        snippet = line.strip()
                        rows.append((rel, i, kind, snippet[:110]))
    rows.sort()
    by_file = {}
    for r in rows:
        by_file.setdefault(r[0], []).append(r)
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write("# Procedencia visual — candidatos a elementos inventados\n\n")
        fh.write("Gerado por `python tools/audit_provenance.py`. Cada linha e algo que o nosso codigo desenha/escreve em vez de usar um bitmap ou texto do jogo.\n")
        fh.write("Revisar contra o original; o que nao existir la deve ser removido ou trocado pelo bitmap original.\n\n")
        fh.write("Resumo: %d ocorrencias em %d arquivos.\n\n" % (len(rows), len(by_file)))
        for rel, items in by_file.items():
            fh.write("## `%s` (%d)\n\n" % (rel, len(items)))
            for _, i, kind, snip in items:
                fh.write("- L%d — %s: `%s`\n" % (i, kind, snip.replace("`", "'")))
            fh.write("\n")
    print("ocorrencias:", len(rows), "arquivos:", len(by_file), "->", OUT)


if __name__ == "__main__":
    main()
