"""Captura em lote do ORIGINAL por GRUPOS de cenarios (frente FIDELIDADE-RESTO, 19/10).

    python run_groups.py --group mp_loader [--group mp_chargen] [--only id1,id2] [--max-runtime 400]

Cada cenario de tools/refcap/scenarios.json com `orig_group` entra no grupo; os cenarios de um grupo rodam em UMA sessao do jogo,
na ordem do arquivo. Campos: `orig_start` (menu | new | nome da biblioteca de saves; vale o do 1o cenario do grupo),
`orig_install` (arquivos de refs/original/saves copiados para a pasta do jogo durante o grupo; o personagem do Multiplayer
fica gravado la: `mp_char_tester.a2c` precisa do nome original `3040399872144.a2c`, ver multi_specs.py), `orig_pre` (passos do inicio da sessao, do 1o cenario, repetidos se o jogo cair), `orig_steps` (passos de run_steps.py executados ANTES da captura, separados por espaco) e `orig_seq` ("n,ms" = grava uma
sequencia `<id>_000.png...` em vez de um quadro). Depois dos passos o script captura `refs/original/<id>.png` (area cliente 1024x768)
e registra o como em refs/original/meta.json. Trava scratch/refcap.lock; o `Game` minimiza/restaura as janelas do usuario (winguard).
Passos com o jogo travado (ex.: Accept da etapa B do Multiplayer abre "Windows Features / DirectPlay") sao evitados de proposito.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(ROOT, "refs", "original")
META = os.path.join(OUT, "meta.json")
SCEN = os.path.join(ROOT, "tools", "refcap", "scenarios.json")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--group", action="append", required=True)
    ap.add_argument("--only", default="")
    ap.add_argument("--max-runtime", type=float, default=420)
    a = ap.parse_args()
    import capture
    import run_steps as rs
    scen = json.load(open(SCEN, encoding="utf-8"))["scenarios"]
    only = {s for s in a.only.split(",") if s}
    if not rs.acquire():
        print("[trava] nao consegui a trava")
        sys.exit(3)
    try:
        for grp in a.group:
            items = [s for s in scen if s.get("orig_group") == grp and (not only or s["id"] in only)]
            if not items:
                print("grupo vazio:", grp)
                continue
            closer = None
            installed = []
            import shutil
            import states
            from launch import GameCrashed
            meta = json.load(open(META, encoding="utf-8")) if os.path.exists(META) else {}
            crashed = []

            def start_session():
                g, inp, closer = rs.open_session(items[0].get("orig_start", "menu"), a.max_runtime)
                r = rs.Runner(g, inp, OUT)
                if items[0].get("orig_pre"):
                    r.run(items[0]["orig_pre"].split())      # passos de inicio de sessao (ex.: clicar no portao para abrir o mapa)
                return g, closer, r

            try:
                for name in items[0].get("orig_install", []):   # arquivos de refs/original/saves copiados para a pasta do jogo (removidos no fim)
                    dst = os.path.join(states.GAME_DIR, name)
                    shutil.copy2(os.path.join(ROOT, "refs", "original", "saves", name), dst)
                    installed.append(dst)
                g, closer, r = start_session()
                for s in items:
                    print(f"[{grp}] {s['id']}", flush=True)
                    for attempt in range(2):
                        try:
                            r.run(s.get("orig_steps", "").split())
                            if s.get("orig_seq"):
                                n, ms = s["orig_seq"].split(",")
                                r.run([f"seq:{s['id']},{n},{ms}"])
                                how = {"frames": int(n)}
                            else:
                                time.sleep(0.15)
                                capture.grab(g).save(os.path.join(OUT, s["id"] + ".png"))
                                how = {}
                            meta[s["id"]] = {"how": s.get("desc", ""), "run": f"groups_{grp}", "steps": s.get("orig_steps", ""),
                                             "date": time.strftime("%Y-%m-%d %H:%M:%S"), **how}
                            break
                        except GameCrashed:
                            # o jogo caiu (estado derivado invalido): registra e reabre a sessao para seguir com o proximo cenario
                            print("   [queda] allods2.exe caiu em", s["id"], flush=True)
                            meta[s["id"]] = {"how": s.get("desc", ""), "run": f"groups_{grp}", "crash": True, "date": time.strftime("%Y-%m-%d %H:%M:%S")}
                            crashed.append(s["id"])
                            try:
                                closer()
                            except Exception:  # noqa: BLE001
                                pass
                            closer = None
                            g, closer, r = start_session()
                            break
                        except Exception:  # noqa: BLE001
                            traceback.print_exc()
                            print("   [falha] encerrando o grupo", grp)
                            raise
                print("quedas:", crashed)
            except Exception:  # noqa: BLE001
                traceback.print_exc()
            finally:
                try:
                    cur = json.load(open(META, encoding="utf-8")) if os.path.exists(META) else {}
                    cur.update(meta)
                    json.dump(cur, open(META, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
                except Exception:  # noqa: BLE001
                    traceback.print_exc()
                if closer:
                    try:
                        closer()
                    except Exception as e:  # noqa: BLE001
                        print("[aviso] fechar:", e)
                for dst in installed:
                    try:
                        os.remove(dst)
                    except OSError:
                        pass
    finally:
        rs.release()
        from launch import list_game_pids, display_mode
        print("allods2 restantes:", list_game_pids(), "| modo:", display_mode())


if __name__ == "__main__":
    main()
