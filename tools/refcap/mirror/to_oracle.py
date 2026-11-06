"""Instala uma partida do jogo espelhado (refs/mirror/<data-hora>/) como episódio do oráculo e despeja o estado por tique.

    PYTHONUTF8=1 .venv/Scripts/python.exe -X utf8 tools/refcap/mirror/to_oracle.py refs/mirror/<data-hora> [--id nome] [--no-dump]

Copia imagem_t0/ para refs/oracle/images/<id>_t0/, grava refs/golden/episodes/<id>/{ep.json, base.json.gz} (roteiro = ordens.json) e
roda tools/re/oracle/dump_ticks.py <id> (refs/oracle/ticks/<id>.jsonl.gz). Depois:
    cd game && npx tsx ../tools/refcap/mirror/free_run.mts --episode <id>      (ou npm run tickcmp -- --episode <id>)
Ordens tratadas fora do tique (pausa/diálogo, `now`) entram no oráculo antes do tique seguinte, depois do pensamento: pode haver
diferença de 1 pensamento nessas ordens.
"""
from __future__ import annotations

import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools", "re", "oracle"))


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    src = os.path.abspath(args[0])
    eid = sys.argv[sys.argv.index("--id") + 1] if "--id" in sys.argv else "mirror_" + os.path.basename(src).replace("-", "")
    o = json.load(open(os.path.join(src, "ordens.json"), encoding="utf-8"))
    img = os.path.join(src, "imagem_t0")
    if not os.path.exists(os.path.join(img, "mem.bin")):
        raise SystemExit(f"{img} sem mem.bin (a partida foi gravada com --no-image?)")
    dst = os.path.join(ROOT, "refs", "oracle", "images", f"{eid}_t0")
    if os.path.exists(dst):
        shutil.rmtree(dst)
    shutil.copytree(img, dst)
    ep_dir = os.path.join(ROOT, "refs", "golden", "episodes", eid)
    os.makedirs(ep_dir, exist_ok=True)
    shutil.copy(os.path.join(src, "base.json.gz"), os.path.join(ep_dir, "base.json.gz"))
    script = [{k: v for k, v in a.items() if k not in ("cat", "now")} for a in o["script"] if not a["do"].startswith("pacote_")]
    ep = {"state": o["state"], "mission": o.get("mission"), "seed": o["seed"], "hero": o["hero"], "t16_0": o["t16_0"], "stalls": 0,
          "id": eid, "ticks": o["ticks"], "script": script, "note": f"jogo espelhado {src}"}
    json.dump(ep, open(os.path.join(ep_dir, "ep.json"), "w", encoding="utf-8"), ensure_ascii=False)
    print(f"episódio {eid}: {len(script)} ordens, {o['ticks']} tiques")
    if "--no-dump" not in sys.argv:
        import dump_ticks
        print(json.dumps(dump_ticks.dump(eid), ensure_ascii=False))


if __name__ == "__main__":
    main()
