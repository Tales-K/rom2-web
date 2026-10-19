#!/usr/bin/env python
"""Pipeline de VOZES: inventario das falas dubladas ja convertidas por media.py (assets/audio/speech/**.ogg).

Saida: game/public/assets/audio/speech/voices.json (manifest unico das vozes; formato e regras em notes/voices.md)
  {version, kinds:{talk,accept,reject,about,town:[id sem extensao]},
   shops:{shop|shop_druid|shop_kaarg:{items:{"<id do item>":[1,2,3]}, books:[NN], effects:[NN]}},
   coverage:{missions:{lines, voiced}, town:{lines, voiced, orphans:[]}, shopItemsWithoutVoice:{...}}}

Regras (todas verificadas contra data/items.json e data/texts/*.json; o exe nao tem formato de fala para missoes):
  talk|accept|reject|town/<npc 4 dig.><classe t|f|a|m|s><fala 3 dig.>p<parte 2 dig.>    (tavern/cidade; ver town.py/voices.json antigo)
  about/<npc 4 dig.>t000p<parte 2 dig.>
  shop*/s<NN>i<MM>p<K>  ->  CLASSE de item: NN = (id>>8)&15 (slot: 1 arma, 2 escudo, 5 amuleto, 6 elmo, 8 peitoral, 9 braceletes,
                            10 luvas, 12 botas), MM = id&31 (classe dentro do slot; o material e os bits 0x20/0x40/0x80 nao contam:
                            0x0102 Iron Dagger = 0x3142 Silver Dagger = s01i02), K = parte da fala do lojista (1..3)
  shop*/books/<NN>      ->  ?livro de magia NN (id da magia);  shop*/effects/<NN> -> encantamento NN
Reexecutavel; so le assets/ e data/ ja gerados (nao toca no jogo instalado).
Uso: .venv\\Scripts\\python.exe tools/pipeline/voices.py
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "game" / "public"
SPEECH = PUBLIC / "assets" / "audio" / "speech"
KINDS = ("talk", "accept", "reject", "about", "town")
SHOPS = ("shop", "shop_druid", "shop_kaarg")


def ids(d):
    return sorted(f.stem for f in d.glob("*.ogg")) if d.is_dir() else []


def item_class(iid):
    return (iid >> 8) & 15, iid & 31


def shop_index(name, classes):
    d = SPEECH / name
    out = {}
    unknown = []
    for stem in ids(d):
        m = re.fullmatch(r"s(\d\d)i(\d\d)p(\d)", stem)   # o exe monta "s%.2di%.2dp%d": "s01i9p2" (1 digito) nunca e pedido (orfao)
        if not m:
            continue
        key = f"s{int(m.group(1)):02d}i{int(m.group(2)):02d}"
        out.setdefault(key, []).append((int(m.group(3)), stem))
        if (int(m.group(1)), int(m.group(2))) not in classes:
            unknown.append(stem)
    out = {k: [stem for _, stem in sorted(v)] for k, v in out.items()}   # nomes reais dos arquivos, em ordem de parte
    nums = lambda sub: [int(s) for s in ids(d / sub)]  # noqa: E731
    return {"classes": dict(sorted(out.items())), "books": nums("books"), "effects": nums("effects")}, unknown


def pad(n, w):
    return str(n).zfill(w)


def town_coverage(kinds):
    """Aplica a regra do jogo (town/voices.ts) a todas as secoes de town.json e lista arquivos que nenhuma fala usa."""
    tj = json.load(open(PUBLIC / "data" / "texts" / "town.json", encoding="utf-8"))["sections"]
    have = {f"{k}/{i}" for k in KINDS for i in kinds[k]}
    used, lines, voiced = set(), 0, 0
    for sec, arr in tj.items():
        if not isinstance(arr, list):
            continue
        a = re.fullmatch(r"npc(\d+)(talk|accept|reject)(\d+)", sec)
        ab = re.fullmatch(r"npc(\d+)about", sec)
        g = re.fullmatch(r"(kaargguard|kaargman|kaargwoman|druidinnkeeper|druidshopkeeper)(\d+)", sec)
        if a:
            kind, m, npc = a.group(2), int(a.group(3)), int(a.group(1))
        elif ab:
            kind, m, npc = "about", 0, int(ab.group(1))
        elif sec == "plagatguard":
            kind, m, npc = "town", 0, 97
        elif g:
            kind, m, npc = "town", int(g.group(2)), 0
        else:
            continue
        for i, e in enumerate(arr):
            lines += 1
            t = e.get("tags", {})
            who = t.get("npc") or npc or 97
            part = t.get("part", i + 1)
            hit = False
            for c in "tfams":
                fid = f"{kind}/{pad(who, 4)}{c}{pad(m, 3)}p{pad(part, 2)}"
                if fid in have:
                    used.add(fid)
                    hit = True
            voiced += hit
    return {"lines": lines, "voiced": voiced, "orphans": sorted(have - used)}


def mission_coverage():
    """Falas `event<N>` das missoes: nenhuma tem arquivo (o exe so tem formatos talk|town|accept|reject|about|shop*)."""
    lines = 0
    npcs = {}
    for f in sorted((PUBLIC / "data" / "texts").glob("mission*.json")):
        for sec, arr in json.load(open(f, encoding="utf-8")).get("sections", {}).items():
            if sec.startswith("event"):
                for e in arr:
                    lines += 1
                    n = str(re.match(r"\d+",str(e.get("tags", {}).get("npc", 0))).group())   # alguns textos trazem "23 part=3"
                    npcs[n] = npcs.get(n, 0) + 1
    return {"lines": lines, "voiced": 0, "linesByNpc": dict(sorted(npcs.items(), key=lambda kv: int(kv[0])))}


def main():
    kinds = {k: ids(SPEECH / k) for k in KINDS}
    items = json.load(open(PUBLIC / "data" / "items.json", encoding="utf-8"))
    classes = {item_class(int(k)) for k in items if int(k) < 0x10000}
    shops, unknown = {}, {}
    for s in SHOPS:
        shops[s], unknown[s] = shop_index(s, classes)
    data = {
        "version": 1,
        "kinds": kinds,
        "shops": shops,
        "coverage": {"missions": mission_coverage(), "town": town_coverage(kinds), "shopFilesWithoutItem": unknown},
    }
    out = SPEECH / "voices.json"
    json.dump(data, open(out, "w", encoding="utf-8"), separators=(",", ":"))
    c = data["coverage"]
    print(f"[voices] {sum(len(v) for v in kinds.values())} falas de cidade; lojas: " +
          ", ".join(f"{s}={len(v['classes'])} classes/{len(v['books'])} livros/{len(v['effects'])} efeitos" for s, v in shops.items()))
    print(f"[voices] cidade: {c['town']['voiced']}/{c['town']['lines']} linhas com voz, orfaos={c['town']['orphans']}")
    print(f"[voices] missoes: {c['missions']['voiced']}/{c['missions']['lines']} linhas com voz; arquivos de loja sem item no items.json: {unknown}")
    print("[voices] ->", out)


if __name__ == "__main__":
    main()
