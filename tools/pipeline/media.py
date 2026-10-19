#!/usr/bin/env python
"""Pipeline de MIDIA: converte video (Smacker), musica, efeitos e falas do jogo para formatos de navegador.

Entrada (somente leitura): <extracted>/{video,music,sfx,speech}  (padrao: C:\\Users\\TALES K\\Games\\allods2-extracted)
Saida: game/public/assets/{video,audio}/**, game/public/data/sfx.json, game/public/assets/media.json

  video/<nome>.mp4              H.264 + AAC (yuv420p, faststart) - logos_nival, logos_publisher, intro, teleport, stars, crown, knights, druids
  audio/music/<nome>.ogg|.mp3   Vorbis q4 (e MP3 de reserva para Safari); nomes b00..b16, chrgen, credit, map, menu
  audio/sfx/<caminho>.ogg       Vorbis q4 mono; mesma hierarquia de pastas de extracted/sfx
  audio/speech/<caminho>.ogg    Vorbis q2 mono; mesma hierarquia de extracted/speech
  data/sfx.json                 mapa id -> nome -> arquivo (formato em docs/DATA.md, secao MIDIA)
  assets/media.json             inventario de tudo que foi gerado (nome, caminho, duracao, tamanho)

O ffmpeg vem do pacote PyPI `imageio-ffmpeg` (registrado em docs/DOWNLOADS.md); le Smacker nativamente.
Reexecutavel: arquivos de saida mais novos que a entrada sao pulados (use --force para refazer).

Uso: .venv\\Scripts\\python.exe tools/pipeline/media.py [--only video,music,sfx,speech] [--skip-speech] [--no-mp3] [--force] [--jobs N]
"""
import argparse
import json
import os
import re
import subprocess
import sys
import wave
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "game" / "public"
DEFAULT_EXTRACTED = Path(r"C:\Users\TALES K\Games\allods2-extracted")

VIDEOS = {  # nome de saida -> caminho relativo em extracted/video
    "logos_nival": "logos/nival.smk",
    "logos_publisher": "logos/publisher.smk",
    "intro": "intro/01.smk",
    "teleport": "teleport/01.smk",
    "stars": "stars/01.smk",
    "crown": "crown/01.smk",
    "knights": "knights/01.smk",
    "druids": "druids/01.smk",
}


def ffmpeg_exe():
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


FF = None


def run_ff(args):
    cmd = [FF, "-hide_banner", "-nostdin", "-loglevel", "error", "-y"] + [str(a) for a in args]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"ffmpeg falhou ({r.returncode}): {r.stderr.strip()[:300]}")


def probe_duration(path):
    """Duracao em segundos (via ffmpeg -i; funciona para ogg/mp3/mp4/wav/smk)."""
    r = subprocess.run([FF, "-hide_banner", "-nostdin", "-i", str(path)], capture_output=True, text=True)
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", r.stderr)
    if not m:
        return 0.0
    return round(int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3]), 3)


def probe_video_size(path):
    r = subprocess.run([FF, "-hide_banner", "-nostdin", "-i", str(path)], capture_output=True, text=True)
    m = re.search(r"Video:.*?,\s*(\d{2,5})x(\d{2,5})", r.stderr)
    return (int(m[1]), int(m[2])) if m else (0, 0)


def fresh(src, dst, force):
    return (not force) and dst.exists() and dst.stat().st_size > 0 and dst.stat().st_mtime >= src.stat().st_mtime


def rel_url(p):
    return p.relative_to(PUBLIC).as_posix()


def entry(name, p, kind, extra=None):
    e = {"name": name, "kind": kind, "path": rel_url(p), "bytes": p.stat().st_size, "duration": probe_duration(p)}
    if extra:
        e.update(extra)
    return e


def entries(done, kind):
    with ThreadPoolExecutor(max_workers=ARGS.jobs) as ex:
        return list(ex.map(lambda t: entry(t[0], t[1], kind), done))


# ---------------------------------------------------------------- video
def do_video(ext, force):
    out_dir = PUBLIC / "assets" / "video"
    out_dir.mkdir(parents=True, exist_ok=True)
    items = []
    for name, rel in VIDEOS.items():
        src = ext / "video" / rel
        dst = out_dir / f"{name}.mp4"
        if not src.exists():
            print(f"[video] AUSENTE {src}")
            continue
        if fresh(src, dst, force):
            print(f"[video] ok (cache) {name}")
        else:
            print(f"[video] convertendo {name} ...", flush=True)
            # pad: garante dimensoes pares; fps original (15) preservado; paleta -> yuv420p
            run_ff(["-i", src, "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos,format=yuv420p",
                    "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-movflags", "+faststart",
                    "-c:a", "aac", "-b:a", "96k", "-ar", "44100", dst])
        w, h = probe_video_size(dst)
        items.append(entry(name, dst, "video", {"width": w, "height": h}))
    return items


def do_logos(ext, force):
    """Logos BMP usados pelos creditos (main/graphics/logo/*.bmp) -> assets/video/logo/<nome>.png (Pillow)."""
    from PIL import Image
    out_dir = PUBLIC / "assets" / "video" / "logo"
    out_dir.mkdir(parents=True, exist_ok=True)
    items = []
    for src in sorted((ext / "main" / "graphics" / "logo").glob("*.bmp")):
        dst = out_dir / f"{src.stem.lower()}.png"
        if not fresh(src, dst, force):
            Image.open(src).convert("RGB").save(dst, optimize=True)
        with Image.open(dst) as im:
            items.append({"name": src.stem.lower(), "kind": "image", "path": rel_url(dst), "bytes": dst.stat().st_size, "duration": 0, "width": im.width, "height": im.height})
    print(f"[logos] {len(items)} imagens")
    return items


# ---------------------------------------------------------------- musica
def parse_tunes(ext):
    titles = {}
    p = ext / "main" / "text" / "tunes.txt"
    if p.exists():
        for line in p.read_text(encoding="latin-1").splitlines():
            if "=" in line:
                k, v = line.split("=", 1)
                titles[Path(k.strip()).stem.lower()] = v.strip()
    return titles


def do_music(ext, force, mp3):
    out_dir = PUBLIC / "assets" / "audio" / "music"
    out_dir.mkdir(parents=True, exist_ok=True)
    titles = parse_tunes(ext)
    jobs = []
    for src in sorted((ext / "music").glob("*.wav")):
        jobs.append(src)

    def one(src):
        stem = src.stem.lower()
        # tunes.txt chama a faixa de creditos de "credits"; o arquivo e credit.wav. Mantemos os dois nomes (alias abaixo).
        ogg = out_dir / f"{stem}.ogg"
        if not fresh(src, ogg, force):
            run_ff(["-i", src, "-vn", "-c:a", "libvorbis", "-q:a", "4", ogg])
        if mp3:
            m = out_dir / f"{stem}.mp3"
            if not fresh(src, m, force):
                run_ff(["-i", src, "-vn", "-c:a", "libmp3lame", "-q:a", "4", m])
        return stem

    with ThreadPoolExecutor(max_workers=ARGS.jobs) as ex:
        stems = list(ex.map(one, jobs))
    # alias: credits.ogg -> copia de credit (tunes.txt usa "credits"; o jogo original usa o arquivo credit.wav)
    items = []
    for stem in stems:
        for e, fmt in ((".ogg", "ogg"), (".mp3", "mp3")):
            p = out_dir / f"{stem}{e}"
            if p.exists():
                items.append(entry(stem, p, "music", {"title": titles.get(stem, titles.get(stem + "s", stem)), "format": fmt}))
    if "credit" in stems:
        for e in (".ogg", ".mp3"):
            a, b = out_dir / f"credit{e}", out_dir / f"credits{e}"
            if a.exists() and (not b.exists() or force or b.stat().st_size != a.stat().st_size):
                b.write_bytes(a.read_bytes())
            if b.exists():
                items.append(entry("credits", b, "music", {"title": titles.get("credits", "Credits"), "format": e[1:], "aliasOf": "credit"}))
    print(f"[music] {len(stems)} faixas")
    return items


# ---------------------------------------------------------------- efeitos e falas
def convert_tree(src_root, dst_root, q, force):
    """Converte todo .wav sob src_root em .ogg mono sob dst_root, mantendo a hierarquia. Devolve lista de (rel_posix_sem_ext, dst)."""
    files = sorted(p for p in src_root.rglob("*") if p.suffix.lower() == ".wav")

    def one(src):
        rel = src.relative_to(src_root).with_suffix("")
        dst = dst_root / rel.with_suffix(".ogg")
        dst.parent.mkdir(parents=True, exist_ok=True)
        err = None
        if not fresh(src, dst, force):
            try:
                run_ff(["-i", src, "-vn", "-ac", "1", "-c:a", "libvorbis", "-q:a", str(q), dst])
            except Exception as e:  # noqa: BLE001
                err = str(e)
        return rel.as_posix(), dst, err

    with ThreadPoolExecutor(max_workers=ARGS.jobs) as ex:
        res = list(ex.map(one, files))
    bad = [r for r in res if r[2]]
    for rel, _, err in bad:
        print(f"[erro] {rel}: {err}")
    return [(rel, dst) for rel, dst, err in res if not err and dst.exists()]


def do_sfx(ext, force):
    dst_root = PUBLIC / "assets" / "audio" / "sfx"
    done = convert_tree(ext / "sfx", dst_root, 4, force)
    print(f"[sfx] {len(done)} arquivos")
    items = entries(done, "sfx")
    # mapa id -> nome (de data/reg/sfx.json, exportado de sfx.reg)
    names = {rel: rel_url(dst) for rel, dst in done}
    ids, missing = {}, []
    regp = ROOT / "data" / "reg" / "sfx.json"
    if regp.exists():
        for k, v in json.loads(regp.read_text(encoding="utf-8")).get("Sfx", {}).items():
            m = re.fullmatch(r"Sfx(\d+)", k)
            if not m:
                continue
            name = v.replace("\\", "/")
            if name in names:
                ids[m[1]] = name
            else:
                missing.append((m[1], name))
    # grupos: pasta com variantes (ex.: characters/aldor/attack -> [1,2]); o jogo sorteia uma
    groups = {}
    for rel in names:
        if "/" in rel:
            groups.setdefault(rel.rsplit("/", 1)[0], []).append(rel)
    groups = {g: sorted(v, key=lambda s: [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", s)]) for g, v in groups.items() if len(v) > 1}
    # id cujo nome e uma pasta (sem arquivo homonimo) -> grupo
    for sid, name in missing[:]:
        if name in groups:
            ids[sid] = name
            missing.remove((sid, name))
    if missing:
        print(f"[sfx] ids sem arquivo ({len(missing)}): " + ", ".join(f"{i}={n}" for i, n in missing[:20]))
    out = {
        "version": 1,
        "base": "assets/audio/sfx/",
        "ids": dict(sorted(ids.items(), key=lambda kv: int(kv[0]))),
        "names": dict(sorted(names.items())),
        "groups": dict(sorted(groups.items())),
        "durations": {e["name"]: e["duration"] for e in items},
        "missing": {i: n for i, n in missing},
    }
    (PUBLIC / "data").mkdir(parents=True, exist_ok=True)
    (PUBLIC / "data" / "sfx.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    return items


def do_speech(ext, force):
    dst_root = PUBLIC / "assets" / "audio" / "speech"
    done = convert_tree(ext / "speech", dst_root, 2, force)
    print(f"[speech] {len(done)} arquivos")
    return entries(done, "speech")


# ---------------------------------------------------------------- main
def main():
    global FF, ARGS
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--extracted", default=str(DEFAULT_EXTRACTED))
    ap.add_argument("--only", default="video,music,sfx,speech", help="lista separada por virgula")
    ap.add_argument("--skip-speech", action="store_true")
    ap.add_argument("--no-mp3", action="store_true", help="nao gerar o MP3 de reserva da musica")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--jobs", type=int, default=max(2, (os.cpu_count() or 4) - 1))
    ARGS = ap.parse_args()
    FF = ffmpeg_exe()
    ext = Path(ARGS.extracted)
    only = {s.strip() for s in ARGS.only.split(",") if s.strip()}
    if ARGS.skip_speech:
        only.discard("speech")

    media_path = PUBLIC / "assets" / "media.json"
    old = {}
    if media_path.exists():
        try:
            old = json.loads(media_path.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            old = {}
    by_kind = {k: old.get(k, []) for k in ("video", "image", "music", "sfx", "speech")}
    if "video" in only:
        by_kind["video"] = do_video(ext, ARGS.force)
        by_kind["image"] = do_logos(ext, ARGS.force)
    if "music" in only:
        by_kind["music"] = do_music(ext, ARGS.force, not ARGS.no_mp3)
    if "sfx" in only:
        by_kind["sfx"] = do_sfx(ext, ARGS.force)
    if "speech" in only:
        by_kind["speech"] = do_speech(ext, ARGS.force)

    totals = {k: {"count": len(v), "bytes": sum(e["bytes"] for e in v), "seconds": round(sum(e["duration"] for e in v), 1)} for k, v in by_kind.items()}
    media = {"version": 1, "totals": totals, **by_kind}
    media_path.parent.mkdir(parents=True, exist_ok=True)
    media_path.write_text(json.dumps(media, ensure_ascii=False, indent=1), encoding="utf-8")
    for k, t in totals.items():
        print(f"{k:7s} {t['count']:5d} arquivos  {t['bytes'] / 1e6:8.1f} MB  {t['seconds']:9.1f} s")
    print(f"total {sum(t['bytes'] for t in totals.values()) / 1e6:.1f} MB -> {rel_url(media_path)}")


if __name__ == "__main__":
    sys.exit(main())
