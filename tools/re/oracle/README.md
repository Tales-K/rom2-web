# Oráculo por retomada (etapa 1)

O servidor do `allods2.exe` (cópia `a2_diff`) rodando no Unicorn a partir de uma imagem do processo no tique 0 de um episódio,
sem GUI e sem o jogo, com a memória inteira observável. Notas, HLE e medições: `notes/oracle-resume.md`.

| Arquivo | O quê |
|---|---|
| `dump_state.py` | Abre o jogo pelo harness (trava `scratch/refcap.lock`, janela), faz o prelúdio de `run_pair.run_orig` e despeja a memória em `refs/oracle/images/<id>_t0/` |
| `resume.py` | `Oracle`: mapeia a imagem, armadilhas nas DLLs do sistema, FS na TEB32 real, `tick()` = GATE + `Server_Tick`; `run_episode` refaz o laço de `run_orig` e compara com `refs/golden` |
| `hle.py` | Tabela nome da API → (n.º de argumentos, tratador). Importação sem entrada = parada com erro |
| `fnprobe.py` | Oráculo por função: cada chamada de funções escolhidas com argumentos, retorno, rng e todos os acessos à memória → `refs/oracle/pairs/<id>/<addr>.jsonl`; `--verify N` refaz chamadas numa imagem nova e exige registro idêntico |
| `exec_profile.py` | Hook por bloco básico: quantas vezes cada função do `index.tsv` é entrada em N tiques de cada episódio → `tools/re/exec_profile.tsv` (coluna `exec` do `port_status.py`; raízes extras do `init`) |
| `dump_ticks.py` | `read_state` normalizado a cada tique → `refs/oracle/ticks/<id>.jsonl.gz`; `--check` compara com `states.jsonl.gz` do golden |

```
PYTHONUTF8=1 .venv/Scripts/python.exe -X utf8 tools/re/oracle/dump_state.py m10_start_s1 m10_mage_s102 m20_start_s203
PYTHONUTF8=1 .venv/Scripts/python.exe -X utf8 tools/re/oracle/resume.py --gate         # portão: traço + rng idênticos
PYTHONUTF8=1 .venv/Scripts/python.exe -X utf8 tools/re/oracle/resume.py <id> [--ticks N]
PYTHONUTF8=1 .venv/Scripts/python.exe -X utf8 tools/re/oracle/dump_ticks.py --check      # estado completo × golden
PYTHONUTF8=1 .venv/Scripts/python.exe -X utf8 tools/re/oracle/fnprobe.py <id> 0x557f08 ... [--args 0x557f08:2] --verify 20
```

Como biblioteca: `o, ep = load_episode(id)`; `play(o, ep, n, before_tick=, after_tick=)`; `unit_list(o)`; `o.tick()`; `o.command("move", [1], x=10, y=38)`; `o.read/u32/write`; `o.proc` é um `Proc`
(memory.py) sobre a memória emulada, aceito por `orig_mem.Server`, `original_episode.Reader` e `export_state.read_state`.
