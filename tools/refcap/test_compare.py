"""Validacao do comparador com pares sinteticos (gabarito conhecido) e com pares reais do nosso jogo.

  .venv\\Scripts\\python.exe tools/refcap/test_compare.py [--real] [--keep DIR]

Sinteticos (fundo = uma captura nossa, ou textura gerada se refs/ours estiver vazio):
  extra      : elemento desenhado so no nosso                 -> "extra no nosso"
  missing    : elemento so no original                        -> "faltando no nosso"
  recolor    : mesma faixa (barra) com cores trocadas         -> "estilo/cor diferente"
  moved      : mesmo elemento 14 px deslocado                 -> "posicao deslocada"
  gshift     : imagem inteira deslocada (3,-2) + elemento     -> deslocamento global detectado + so o elemento
  cursor     : seta pequena so no nosso, junto do mouse       -> "cursor"
  idle (seq) : original com sprite animado, nosso parado      -> "sem animacao onde o original anima"
--real: pares reais do nosso jogo (antes/depois de um elemento), se as capturas existirem:
  town_default x town_hover_inn  (tooltip "Inn" + realce)    -> extra no "nosso" (= hover)
  mission_hud_full x mission_hero_hurt (barra de vida 50%)   -> regiao no painel (hud.ts)
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import compare  # noqa: E402

ROOT = HERE.parents[1]
W, H = 1024, 768


def background() -> Image.Image:
    for name in ("menu_main.png", "town_default.png"):
        p = ROOT / "refs/ours" / name
        if p.exists():
            return Image.open(p).convert("RGB")
    rng = np.random.default_rng(1)
    a = rng.integers(40, 90, (H // 8, W // 8, 3)).astype(np.uint8)
    return Image.fromarray(a).resize((W, H), Image.BICUBIC)


def badge(im: Image.Image, x: int, y: int, fill=(200, 40, 30), w: int = 70, h: int = 46) -> None:
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([x, y, x + w, y + h], 8, fill=fill, outline=(255, 230, 120), width=3)
    d.text((x + w // 2 - 3, y + 8), "!", fill=(255, 255, 255))
    d.line([x + 10, y + h - 10, x + w - 10, y + h - 10], fill=(255, 255, 255), width=2)


def bar(im: Image.Image, x: int, y: int, c1, c2) -> None:
    d = ImageDraw.Draw(im)
    d.rectangle([x, y, x + 160, y + 14], fill=(10, 10, 10), outline=(200, 180, 120))
    for i in range(0, 158, 4):
        d.rectangle([x + 1 + i, y + 2, x + 3 + i, y + 12], fill=c1 if (i // 4) % 2 else c2)


def arrow(im: Image.Image, x: int, y: int) -> None:
    d = ImageDraw.Draw(im)
    d.polygon([(x, y), (x, y + 22), (x + 6, y + 16), (x + 11, y + 26), (x + 14, y + 24), (x + 9, y + 15), (x + 17, y + 15)], fill=(240, 230, 200), outline=(0, 0, 0))


def sprite_frame(k: int) -> Image.Image:
    s = Image.new("RGBA", (40, 56), (0, 0, 0, 0))
    d = ImageDraw.Draw(s)
    sway = [0, 2, 4, 2, 0, -2, -4, -2][k % 8]
    d.ellipse([12 + sway, 2, 28 + sway, 18], fill=(220, 180, 140))
    d.rectangle([10, 18, 30, 44], fill=(60, 90, 160))
    d.line([20, 30, 36 + sway, 20 - abs(sway)], fill=(200, 200, 220), width=3)
    return s


def build(tmp: Path) -> dict[str, str]:
    od, nd = tmp / "original", tmp / "ours"
    od.mkdir(parents=True)
    nd.mkdir(parents=True)
    bg = background()
    expect: dict[str, str] = {}

    def save(sid, o, n, mouse=None):
        o.save(od / f"{sid}.png")
        n.save(nd / f"{sid}.png")
        if mouse:
            (nd / f"{sid}.json").write_text(json.dumps({"mouse": {"x": mouse[0], "y": mouse[1]}}))

    o, n = bg.copy(), bg.copy(); badge(n, 600, 300); save("extra", o, n); expect["extra"] = "extra no nosso"
    o, n = bg.copy(), bg.copy(); badge(o, 200, 500, fill=(30, 120, 40)); save("missing", o, n); expect["missing"] = "faltando no nosso"
    o, n = bg.copy(), bg.copy(); bar(o, 420, 640, (200, 30, 30), (150, 20, 20)); bar(n, 420, 640, (40, 60, 220), (20, 40, 160)); save("recolor", o, n)
    expect["recolor"] = "estilo/cor diferente"
    o, n = bg.copy(), bg.copy(); badge(o, 300, 150, fill=(120, 80, 200)); badge(n, 314, 150, fill=(120, 80, 200)); save("moved", o, n)
    expect["moved"] = "posicao deslocada"
    o = bg.copy(); badge(o, 700, 600, fill=(30, 160, 160))
    n = Image.fromarray(compare.shift_img(np.asarray(bg), 3, -2))
    save("gshift", o, n); expect["gshift"] = "faltando no nosso"
    o, n = bg.copy(), bg.copy(); arrow(n, 512, 380); save("cursor", o, n, mouse=(512, 380)); expect["cursor"] = "cursor"
    # sequencia: original anima um sprite, o nosso fica parado no quadro 0
    for k in range(12):
        fo, fn = bg.copy(), bg.copy()
        fo.paste(sprite_frame(k), (400, 420), sprite_frame(k))
        fn.paste(sprite_frame(0), (400, 420), sprite_frame(0))
        fo.save(od / f"idle_{k:03d}.png")
        fn.save(nd / f"idle_{k:03d}.png")
    expect["idle"] = "sem animacao onde o original anima"
    sc = [{"id": k, "desc": f"sintetico: {v}"} for k, v in expect.items() if k != "idle"]
    sc.append({"id": "idle", "desc": "sintetico: animacao", "sequence": 12, "interval_ms": 100})
    sc.append({"id": "nooriginal", "desc": "sintetico: sem referencia original"})
    n.save(nd / "nooriginal.png")
    (tmp / "scenarios.json").write_text(json.dumps({"scenarios": sc}))
    return expect


def run_synthetic(keep: Path | None) -> bool:
    tmp = Path(tempfile.mkdtemp(prefix="refcap_test_"))
    try:
        expect = build(tmp)
        args = compare.parse(["--orig", str(tmp / "original"), "--ours", str(tmp / "ours"), "--out", str(tmp / "out"), "--scenarios", str(tmp / "scenarios.json")])
        results = compare.run(args)
        compare.write_report(results, args)
        ok = True
        by = {r.id: r for r in results}
        for sid, cat in expect.items():
            r = by[sid]
            top = r.regions[0].category if r.regions else "(nenhuma)"
            cats = [g.category for g in r.regions]
            good = top == cat
            extra = ""
            if sid == "gshift":
                good = good and r.shift == (-3, 2) and len(r.regions) <= 2
                extra = f" shift={r.shift} regioes={len(r.regions)}"
            print(f"[{'ok' if good else 'FALHOU'}] {sid}: esperado '{cat}', principal '{top}' (todas: {cats}){extra}")
            ok &= good
        nr = by["nooriginal"]
        good = nr.status == "sem-original"
        print(f"[{'ok' if good else 'FALHOU'}] nooriginal: status {nr.status}")
        ok &= good
        if keep:
            shutil.copytree(tmp, keep, dirs_exist_ok=True)
            print(f"(saida mantida em {keep})")
        return ok
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def run_real(keep: Path | None) -> bool:
    ours = ROOT / "refs/ours"
    pairs = [("town_default", "town_hover_inn", {"extra no nosso", "estilo/cor diferente", "estilo/forma diferente"}, "TownScene"),
             ("mission_hud_full", "mission_hero_hurt", {"estilo/cor diferente", "estilo/forma diferente", "extra no nosso", "faltando no nosso"}, "hud.ts")]
    ok = True
    tmp = Path(tempfile.mkdtemp(prefix="refcap_real_"))
    try:
        (tmp / "original").mkdir()
        (tmp / "ours").mkdir()
        sc = []
        for a, b, cats, f in pairs:
            if not (ours / f"{a}.png").exists() or not (ours / f"{b}.png").exists():
                print(f"[pulado] {a} x {b}: capturas ausentes")
                continue
            sid = f"{a}__vs__{b}"
            shutil.copy(ours / f"{a}.png", tmp / "original" / f"{sid}.png")
            shutil.copy(ours / f"{b}.png", tmp / "ours" / f"{sid}.png")
            # mouse: as duas capturas tem o mouse em lugares diferentes
            mm = []
            for x in (a, b):
                j = ours / f"{x}.json"
                if j.exists():
                    m = json.loads(j.read_text(encoding="utf8")).get("mouse")
                    if m:
                        mm.append(m)
            if mm:
                (tmp / "ours" / f"{sid}.json").write_text(json.dumps({"mouse": mm[-1]}))
                (tmp / "original" / f"{sid}.json").write_text(json.dumps({"mouse": mm[0]}))
            sid_id = f"mission_{sid}" if a.startswith("mission") else sid
            if sid_id != sid:
                for d in ("original", "ours"):
                    for ext in ("png", "json"):
                        p = tmp / d / f"{sid}.{ext}"
                        if p.exists():
                            p.rename(tmp / d / f"{sid_id}.{ext}")
            sc.append({"id": sid_id, "desc": f"real: {a} (como original) x {b} (como nosso)", "_cats": list(cats), "_file": f})
        if not sc:
            return True
        (tmp / "scenarios.json").write_text(json.dumps({"scenarios": sc}))
        args = compare.parse(["--orig", str(tmp / "original"), "--ours", str(tmp / "ours"), "--out", str(tmp / "out"), "--scenarios", str(tmp / "scenarios.json")])
        results = compare.run(args)
        compare.write_report(results, args)
        for r, s in zip(results, sc):
            main = [g for g in r.regions if g.category != "cursor"]
            top = main[0] if main else None
            good = bool(top) and top.category in s["_cats"] and s["_file"] in (top.hint or "")
            print(f"[{'ok' if good else 'FALHOU'}] {r.id}: principal {top.category if top else '-'} {top.bbox if top else ''} -> {top.hint if top else ''}; "
                  f"{len(r.regions)} regioes: {[(g.category, g.bbox) for g in r.regions[:5]]}")
            ok &= good
        if keep:
            shutil.copytree(tmp, keep / "real", dirs_exist_ok=True)
        return ok
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--real", action="store_true")
    ap.add_argument("--keep", type=Path, default=None)
    a = ap.parse_args()
    ok = run_synthetic(a.keep)
    if a.real:
        ok &= run_real(a.keep)
    print("TUDO OK" if ok else "HA FALHAS")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
