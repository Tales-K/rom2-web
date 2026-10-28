"""Converte os textos do jogo (extraidos de main.res -> main/text/*.txt) para JSON em game/public/data/texts/.

Dois formatos de arquivo:
  secoes:  linhas "#nome" ... "#" (fim). Dentro: linhas "=== comentario" sao ignoradas; linhas "<TAG=valor, FLAG, ...>" abrem um bloco
           com tags (ex.: <NPC=21, IAMMALE, IAMFIGHTER, PART=1>, <part=2>); o texto seguinte pertence ao bloco ate a proxima tag.
  lista:   um texto por linha (unitname.txt, stats.txt, tunes.txt...); linhas vazias preservadas (o indice importa).

Saida:  {"kind": "sections", "sections": {nome: [{"tags": {...}, "text": "..."}]}}
        {"kind": "lines", "lines": ["...", ...]}
        tunes.txt vira {"kind": "map", "map": {"b00.wav": "In Restless Waiting", ...}}

Uso: python tools/texts_export.py [--src <main/text>] [--out <game/public/data/texts>]
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAG = re.compile(r"^<(.*)>\s*$")


def parse_tag(inner):
    tags = {}
    for part in inner.split(","):
        part = part.strip()
        if not part:
            continue
        if "=" in part:
            k, v = part.split("=", 1)
            k, v = k.strip().lower(), v.strip()
            tags[k] = int(v) if re.fullmatch(r"-?\d+", v) else v
        else:
            tags[part.lower()] = True
    return tags


def parse_sections(text):
    sections, cur, name = {}, None, None
    block = None
    for raw in text.split("\n"):
        line = raw.rstrip("\r")
        if line.startswith("#") and len(line) > 1 and not line.startswith("# "):
            name = line[1:].strip()
            # nome repetido (mission20.txt: "#event11" da fala do herói e, mais abaixo, "#event11" da placa "Yellobrik Road" sob
            # "=======roadsign======="): vale a PRIMEIRA secao, como uma busca linear pelo nome; antes as duas eram fundidas e a
            # mensagem 11 da missao 20 mostrava a placa como 2a fala [est: ordem de busca do exe nao lida]
            if name in sections:
                name, cur, block = None, None, None
                continue
            cur = sections.setdefault(name, [])
            block = None
            continue
        if line.strip() == "#":
            name, cur, block = None, None, None
            continue
        if cur is None or line.startswith("="):
            continue
        m = TAG.match(line.strip())
        if m:
            block = {"tags": parse_tag(m.group(1)), "text": ""}
            cur.append(block)
            continue
        if block is None:
            block = {"tags": {}, "text": ""}
            cur.append(block)
        block["text"] += ("\n" if block["text"] else "") + line
    for blocks in sections.values():
        for b in blocks:
            b["text"] = b["text"].strip("\n")
    return sections


def convert(path):
    text = open(path, encoding="latin-1").read()
    base = os.path.basename(path).lower()
    if re.search(r"(?m)^#[A-Za-z]", text):
        return {"kind": "sections", "sections": parse_sections(text)}
    if base == "tunes.txt":
        return {"kind": "map", "map": dict(l.strip().split("=", 1) for l in text.splitlines() if "=" in l)}
    return {"kind": "lines", "lines": [l.rstrip("\r") for l in text.split("\n")]}


def main():
    a = sys.argv[1:]
    opt = lambda k, d: a[a.index(k) + 1] if k in a else d  # noqa: E731
    src = opt("--src", r"C:\Users\TALES K\Games\allods2-extracted\main\text")
    out = opt("--out", os.path.join(ROOT, "game", "public", "data", "texts"))
    os.makedirs(out, exist_ok=True)
    n = 0
    for f in sorted(os.listdir(src)):
        p = os.path.join(src, f)
        if os.path.isfile(p) and f.lower().endswith(".txt"):
            with open(os.path.join(out, f[:-4] + ".json"), "w", encoding="utf-8") as fh:
                json.dump(convert(p), fh, ensure_ascii=False, separators=(",", ":"))
            n += 1
    print("arquivos:", n, "->", out)


if __name__ == "__main__":
    main()
