"""Mostra lado a lado uma unidade numa janela do par (depuração do run_pair.py).

    .venv\\Scripts\\python.exe tools/refcap/diff/show_window.py <prefixo do episódio> <início> <id do original> [passada p0] [campos]
"""
import json
import sys

pre, start, uid = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
tag = sys.argv[4] if len(sys.argv) > 4 else "p0"
orig = {f["step"]: f for f in map(json.loads, open(pre + "_orig.jsonl", encoding="utf-8"))}
for f in map(json.loads, open(f"{pre}_ours_{tag}.jsonl", encoding="utf-8")):
    if f.get("start") != start or "units" not in f:
        continue
    o = next((u for u in orig.get(f["step"], {}).get("units", []) if u["id"] == uid), None)
    n = next((u for u in f["units"] if u["id"] == uid), None)
    fo = f"o ({o['fx']:.2f},{o['fy']:.2f}) hp{o['hp']} mn{o['mana']} task{o['task']} md{o['mode']} tg{o['target']} st{o['state']}" if o else "o -"
    fn = f"n ({n['fx']:.2f},{n['fy']:.2f}) hp{n['hp']} mn{n['mana']} {n['task']}/{n['ai']} tg{n['target']} {n['state']}" if n else "n -"
    print(f"{f['step']:4d} {f['step'] / 16:6.2f}s  {fo:62s} | {fn}")
