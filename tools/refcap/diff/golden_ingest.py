"""Ingestão no CORPUS DOURADO (refs/golden/): guarda de forma permanente os traços MEDIDOS no jogo original (notes/golden-corpus.md).

    .venv\\Scripts\\python.exe tools/refcap/diff/golden_ingest.py --dir refs/trace/diff/pair [--dir ...] [--run "descrição da execução"]
    .venv\\Scripts\\python.exe tools/refcap/diff/golden_ingest.py --migrate        # pair, pair2, pair3 + minimização do e00 (execuções existentes)
    .venv\\Scripts\\python.exe tools/refcap/diff/golden_ingest.py --verify         # confere os hashes do manifest
    .venv\\Scripts\\python.exe tools/refcap/diff/golden_ingest.py --prefix refs/trace/diff/pair/min_003 --id min_target_t74 --tags regress

Entrada: a saída de `run_pair.py` (por episódio `<p>_ep.json`, `_base.json`, `_orig.jsonl`, `_states.jsonl`). Saída por episódio em
refs/golden/episodes/<id>/: ep.json (id, estado, semente, roteiro, ticks, herói, relógio t16_0, paradas, aplicadas), base.json.gz (estado
inicial exportado), orig.jsonl.gz (traço do original COMPACTO: só os campos que o comparador usa, uma linha por amostra), states.jsonl.gz
(estados completos a cada 16 tiques = pontos de ressincronização). `manifest.json` guarda hash sha256, origem e tamanho de tudo.
Nunca roda o original. Pula: execuções com truncamento, ações não aplicadas (ok=false), PROBE_ERROR, arquivos ausentes/ilegíveis,
arquivos modificados há < 60 s (execução em andamento) e duplicatas (mesmo estado+semente+ticks+roteiro). O que foi ingerido e o que
foi pulado (com o motivo) fica no manifest (`ingest_log`, `discarded`).
"""
from __future__ import annotations

import argparse
import datetime
import gzip
import hashlib
import io
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
GOLD = os.path.join(ROOT, "refs", "golden")
FORMAT = 1
COLS = ["id", "type", "state", "hp", "mana", "fx", "fy", "target", "mode", "task"]     # o que run_pair.compare_window lê do original
MIN_AGE_S = 60
HARNESS = ("original_episode.Session (cópia a2_diff com relógio virtual, make_diff_runtime.py) via run_pair.py run_orig: quadro a cada 4 "
           "tiques de 16/s + estado completo a cada 16")


def sha256(p: str) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def write_gz(path: str, data: bytes) -> None:
    """gzip determinístico (mtime = 0): o mesmo conteúdo dá o mesmo hash."""
    with open(path, "wb") as raw, gzip.GzipFile(filename="", mode="wb", fileobj=raw, compresslevel=9, mtime=0) as gz:
        gz.write(data)


def iso(t: float) -> str:
    return datetime.datetime.fromtimestamp(t).isoformat(timespec="seconds")


def load_manifest() -> dict:
    p = os.path.join(GOLD, "manifest.json")
    if os.path.exists(p):
        return json.load(open(p, encoding="utf-8"))
    return {"format": FORMAT, "created": iso(time.time()), "orig_cols": COLS, "window": 80, "sample": 4, "episodes": [], "discarded": [],
            "ingest_log": []}


def save_manifest(m: dict) -> None:
    m["updated"] = iso(time.time())
    m["episodes"].sort(key=lambda e: e["id"])
    json.dump(m, open(os.path.join(GOLD, "manifest.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)


def save_origin(state: str) -> dict:
    idx = json.load(open(os.path.join(ROOT, "refs", "original", "saves", "index.json"), encoding="utf-8"))
    e = idx.get(state, {})
    sav = os.path.join(ROOT, "refs", "original", "saves", e.get("file", state + ".sav"))
    return {"key": state, "file": e.get("file"), "desc": e.get("desc"), "saved_at": e.get("date"), "screen": e.get("screen"),
            "stage": e.get("stage"), "sha256": sha256(sav) if os.path.exists(sav) else None}


def tags_of(ep: dict, frames: list[dict]) -> list[str]:
    t = {ep["state"]}
    for a in ep["actions"]:
        t.add(a["do"] + (f":{a['spell']}" if a["do"] == "cast" and "spell" in a else ""))
    ids0 = {u["id"] for u in frames[0]["units"]}
    hp: dict = {}
    mana: dict = {}
    for f in frames:
        for u in f["units"]:
            if u["id"] not in ids0:
                t.add("spawn")
            if u["id"] in hp and u["hp"] < hp[u["id"]]:
                t.add("dano")
            if u["id"] in hp and u["hp"] > hp[u["id"]]:
                t.add("cura-ou-regen-vida")
            if u["id"] in mana and u["mana"] > mana[u["id"]]:
                t.add("regen-mana")
            if u["state"] == 0x10 and u["id"] in hp and hp[u["id"]] > 0:
                t.add("morte")
            hp[u["id"]], mana[u["id"]] = u["hp"], u["mana"]
    return sorted(t)


def compact_orig(frames: list[dict]) -> bytes:
    out = io.StringIO()
    out.write(json.dumps({"v": FORMAT, "cols": COLS}) + "\n")
    for f in frames:
        out.write(json.dumps({"s": f["step"], "u": [[u[c] for c in COLS] for u in f["units"]]}, separators=(",", ":")) + "\n")
    return out.getvalue().encode("utf-8")


def read_jsonl(p: str) -> list[dict]:
    return [json.loads(l) for l in open(p, encoding="utf-8") if l.strip()]


def ingest_prefix(m: dict, prefix: str, run: str, ep_id: str | None, extra_tags: list[str], origin_dir: str) -> str:
    """Devolve 'ok:<id>' ou 'skip:<motivo>'."""
    name = os.path.basename(prefix)
    parts = {k: prefix + s for k, s in (("ep", "_ep.json"), ("base", "_base.json"), ("orig", "_orig.jsonl"), ("states", "_states.jsonl"))}
    for p in parts.values():
        if not os.path.exists(p):
            return f"skip:arquivo ausente ({os.path.basename(p)})"
    newest = max(os.path.getmtime(p) for p in parts.values())
    if time.time() - newest < MIN_AGE_S:
        return f"skip:modificado há {time.time() - newest:.0f} s (< {MIN_AGE_S} s; execução em andamento?)"
    try:
        ep = json.load(open(parts["ep"], encoding="utf-8"))
        base_txt = open(parts["base"], encoding="utf-8").read()
        base = json.loads(base_txt)
        frames = read_jsonl(parts["orig"])
        states = read_jsonl(parts["states"])
    except Exception as e:  # noqa: BLE001  (arquivo cortado = sem fechamento)
        return f"skip:ilegível/incompleto ({e.__class__.__name__})"
    if ep.get("truncated") is not None:
        return f"skip:execução truncada no tique {ep['truncated']}"
    if any(not a.get("ok", True) for a in ep.get("applied", [])):
        return "skip:ação não aplicada no original (ok=false)"
    if "PROBE_ERROR" in base_txt or "PROBE_ERROR" in json.dumps(ep):
        return "skip:PROBE_ERROR"
    if not frames or not states or frames[-1]["step"] < ep["ticks"] - 8 or states[-1]["step"] < ep["ticks"] - 32:
        return "skip:traço não chega ao fim do episódio"
    key = hashlib.sha1(json.dumps([ep["state"], ep["seed"], ep["ticks"], ep["actions"]], sort_keys=True).encode()).hexdigest()
    if any(e.get("content_key") == key for e in m["episodes"]):
        return "skip:duplicata (mesmo estado, semente, ticks e roteiro)"
    eid = ep_id or f"{ep['state']}_s{ep['seed']}"
    if any(e["id"] == eid for e in m["episodes"]):
        eid += "_" + key[:6]
    d = os.path.join(GOLD, "episodes", eid)
    os.makedirs(d, exist_ok=True)
    meta = {"id": eid, "state": ep["state"], "mission": base["mission"], "seed": ep["seed"], "ticks": ep["ticks"], "hero": ep["hero"],
            "t16_0": ep.get("t16_0"), "stalls": ep.get("stalls", 0), "script": ep["actions"], "applied": ep.get("applied", [])}
    json.dump(meta, open(os.path.join(d, "ep.json"), "w", encoding="utf-8"), separators=(",", ":"))
    write_gz(os.path.join(d, "base.json.gz"), base_txt.encode("utf-8"))
    write_gz(os.path.join(d, "orig.jsonl.gz"), compact_orig(frames))
    write_gz(os.path.join(d, "states.jsonl.gz"), open(parts["states"], "rb").read())
    files = {}
    for fn in ("ep.json", "base.json.gz", "orig.jsonl.gz", "states.jsonl.gz"):
        p = os.path.join(d, fn)
        files[fn] = {"sha256": sha256(p), "bytes": os.path.getsize(p)}
    m["episodes"] = [e for e in m["episodes"] if e["id"] != eid]
    m["episodes"].append({
        "id": eid, "state": ep["state"], "mission": base["mission"], "seed": ep["seed"], "ticks": ep["ticks"], "actions": len(ep["actions"]),
        "content_key": key, "tags": sorted(set(tags_of(ep, frames)) | set(extra_tags)), "files": files,
        "origin": {"save": save_origin(ep["state"]), "harness": HARNESS, "run": run, "source": os.path.relpath(prefix, ROOT).replace("\\", "/"),
                   "recorded_at": iso(os.path.getmtime(parts["orig"])), "ingested_at": iso(time.time()), "original_name": ep.get("name", name),
                   "source_dir": origin_dir}})
    return f"ok:{eid}"


def migrate(m: dict) -> None:
    td = os.path.join(ROOT, "refs", "trace", "diff")
    runs = {"pair": "bateria 1 (run_pair.py --battery 30, sementes 1-30, 20/10)",
            "pair2": "bateria 2 (sementes 101-130, 20/10)", "pair3": "bateria 3 (sementes 201-230, 20/10)"}
    for d, desc in runs.items():
        ingest_dir(m, os.path.join(td, d), desc, [])
    # minimização do e00: o teste de 3 ações que reproduz target|t74|o:none/n:hero (min_NNN com o roteiro mínimo)
    mp = os.path.join(td, "pair", "minimized_e00_m10_start_s1.json")
    if os.path.exists(mp):
        mn = json.load(open(mp, encoding="utf-8"))
        md = os.path.join(td, "pair", "min")
        for f in sorted(os.listdir(md)):
            if f.endswith("_ep.json"):
                ep = json.load(open(os.path.join(md, f), encoding="utf-8"))
                if ep["actions"] == mn["actions"]:
                    log(m, ingest_prefix(m, os.path.join(md, f[:-8]), "minimização ddmin de e00_m10_start_s1 (" + mn["sig"] + ")",
                                         "min_" + mn["episode"], ["regress", "minimizado"], "refs/trace/diff/pair/min"))
                    break


def log(m: dict, r: str) -> None:
    print(r)
    m["ingest_log"].append({"at": iso(time.time()), "result": r})
    if r.startswith("skip:") and r not in [x["reason"] for x in m["discarded"]]:
        m["discarded"].append({"reason": r[5:], "at": iso(time.time())})


def ingest_dir(m: dict, d: str, run: str, tags: list[str]) -> None:
    d = os.path.abspath(d)
    for f in sorted(os.listdir(d)):
        if f.endswith("_ep.json") and not f.startswith("min_"):
            r = ingest_prefix(m, os.path.join(d, f[:-8]), run, None, tags, os.path.relpath(d, ROOT).replace("\\", "/"))
            m["ingest_log"].append({"at": iso(time.time()), "prefix": f[:-8], "dir": os.path.basename(d), "result": r})
            print(f"{os.path.basename(d)}/{f[:-8]}: {r}")
            if r.startswith("skip:"):
                m["discarded"].append({"episode": f[:-8], "dir": os.path.basename(d), "reason": r[5:]})


def verify() -> int:
    m = load_manifest()
    bad = 0
    for e in m["episodes"]:
        for fn, info in e["files"].items():
            p = os.path.join(GOLD, "episodes", e["id"], fn)
            if not os.path.exists(p) or sha256(p) != info["sha256"]:
                print("HASH DIFERENTE/AUSENTE:", e["id"], fn)
                bad += 1
    tot = sum(i["bytes"] for e in m["episodes"] for i in e["files"].values())
    print(f"{len(m['episodes'])} episódios, {tot / 1e6:.1f} MB, {bad} problemas")
    return 1 if bad else 0


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", action="append", default=[])
    ap.add_argument("--run", default="")
    ap.add_argument("--tags", default="")
    ap.add_argument("--prefix")
    ap.add_argument("--id")
    ap.add_argument("--migrate", action="store_true")
    ap.add_argument("--verify", action="store_true")
    a = ap.parse_args()
    if a.verify:
        sys.exit(verify())
    os.makedirs(os.path.join(GOLD, "episodes"), exist_ok=True)
    m = load_manifest()
    tags = [t for t in a.tags.split(",") if t]
    if a.migrate:
        migrate(m)
    for d in a.dir:
        ingest_dir(m, d, a.run or f"execução em {d}", tags)
    if a.prefix:
        log(m, ingest_prefix(m, os.path.abspath(a.prefix), a.run or "manual", a.id, tags, os.path.dirname(a.prefix)))
    save_manifest(m)
    tot = sum(i["bytes"] for e in m["episodes"] for i in e["files"].values())
    print(f"corpus: {len(m['episodes'])} episódios, {tot / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
