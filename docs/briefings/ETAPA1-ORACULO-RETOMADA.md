# Briefing — Etapa 1: oráculo por retomada (o servidor do original rodando no Unicorn)

Para: uma sessão de modelo forte (Fable ou Opus), fresca. Motivo e método: `docs/ABORDAGEM-FIDELIDADE-UNIDADES.md`, seção 4.2 e
etapa 1 da seção 7. Este briefing é autossuficiente; leia os arquivos citados só quando precisar.

## Objetivo
Despejar a memória do `allods2.exe` (cópia `a2_diff`) parado num limite de tique, mapear a imagem no Unicorn e chamar `Server_Tick`
(0x4f08c0) em laço, de modo que o servidor original rode **sem GUI, sem harness, em várias instâncias paralelas**, com a memória
inteira observável a cada tique.

**Portão (define "pronto")**: a partir das imagens do tique 0 dos episódios `m10_start_s1`, `m10_mage_s101` e `m20_start_s201` do
corpus (`refs/golden/episodes/<id>/ep.json` tem semente e roteiro), o traço de 960 tiques produzido no Unicorn (mesmas colunas do
`orig.jsonl.gz`) e o estado do `rand()` a cada 16 tiques são **idênticos** aos gravados em `refs/golden`. O golden é o oráculo do oráculo.
Se em 3 sessões o portão não passar, relatar o obstáculo e parar: o plano B (oráculo por função com memória montada) está na seção 4.2.

## O que já existe (reaproveite; não reescreva)
- `tools/refcap/original/memory.py` — `Proc.attach()`, `read/write`, `regions(writable_only)`, **`snapshot()`** (todas as regiões
  graváveis), varredura. O exe tem base fixa 0x400000 e **não tem relocações**; globais em `.data` 0x5ee000..0x6cd8fc.
- `tools/refcap/diff/vclock.py` + `make_diff_runtime.py` — a cópia `a2_diff` tem relógio virtual (GATE em 0x488ad8, caverna 0x5ca520,
  área de dados 0x6cdf00: EN/BUDGET/DONE/VTIME...), `vc.step(1)` roda exatamente 1 tique e espera terminar, `vc.call(fn, ecx, args)`,
  `vc.command(...)` injeta ordens (pacote 0x6904b8, envio 0x50164f, despachante do servidor 0x4f515d, tipos em `CMD`).
- `tools/refcap/diff/original_episode.py` — carrega um save da biblioteca pelo F3, aplica semente (`_tiddata+0x14`, `_getptd` 0x58a930),
  roda roteiro, grava traço. **Use-o para chegar ao tique 0 de um episódio** e, nesse ponto, despejar a memória.
- `tools/re/unicorn_call.py` — `A2Emu`: mapeia o PE, troca cada importação por stub (tabela `IMPORTS` nome → tratador), TEB mínima em
  0x7ffde000 (`FS` via GDT), pilha, `hook(addr, fn)` para HLE de funções internas, `call(addr, ...)`, `unhandled` (importações sem
  tratador). Validado em 3 funções puras e no `rand()` com semente trocada.
- `tools/refcap/diff/export_state.py` — decodifica unidades/grupos/livros/visão da memória; `game/src/sim/trace.ts` e
  `golden_compare.mts` definem o formato do traço.
- Endereços: `Game_SoloLoop` 0x488aa1, `Server_Tick` 0x4f08c0 (recebe a fase do relógio de 16/s), `Server_ClockTick` 0x4f8521,
  `Server_ClientMessages` 0x4f84c6, `Server_WorldTick` 0x4f04cf, `World_SecondTick` 0x52bbb7, envio ao cliente 0x504bb7, eventos de
  visibilidade 0x52b321, `rand` 0x583290, `_getptd` 0x58a930, `Server_Log` 0x43a0a8. Nomes: `tools/re/known_functions.json`.
  C decompilado: `C:\Users\TALES K\Games\allods2-decomp\` (`index.tsv`, `callgraph.tsv`, `game\g_*.c`); como usar: `notes/re-tools.md`.

## Passos sugeridos
1. **Despejo**: em `original_episode.py` (ou script novo `tools/re/oracle/dump_state.py`), no tique 0 do episódio e com o servidor
   parado pelo GATE, gravar: todas as regiões graváveis (`snapshot()`), mais as seções do exe e de **todos os módulos não-sistema**
   carregados (`Scenario.dll` é chamada por ponteiro; `EnumProcessModules`), registradores não importam (chamaremos `Server_Tick` do
   zero). Formato: um `.npz`/arquivo próprio com (base, bytes) por região + `meta.json` (episódio, tique, módulos, VTIME). Guardar em
   `refs/oracle/images/<episodio>_t<tique>/` (git-ignorado como todo `refs/`).
2. **Retomada**: `tools/re/oracle/resume.py`: `A2Emu` + mapear a imagem por cima; chamar `Server_Tick` com o mesmo argumento que
   `Game_SoloLoop` passa (leia 0x488aa1 no C: a fase do relógio 16/s vem de um global) em laço, 1 chamada = 1 tique; a cada tique
   (ou a cada N) ler o estado com o decodificador do `export_state` (adaptado para ler da imagem do Unicorn em vez do processo).
3. **HLE** (lista inicial; a lista real sai do `emu.unhandled` e dos saltos para endereço não mapeado na 1ª sessão):
   `timeGetTime`/`GetTickCount`/`QueryPerformanceCounter` = relógio virtual (+62/63 ms por tique como `vclock`); `TlsGetValue`/`TlsSetValue`
   + TEB (`FS:[0x18]`, `[0x2c]`) para `_getptd` chegar ao `_tiddata` **da imagem** (o `rand()` e a semente estão lá); `HeapAlloc/HeapFree/
   HeapReAlloc/VirtualAlloc/VirtualFree` = alocador de avanço numa região nova, `free` sem efeito (logar para detectar vazamento que
   desloque endereços); `CreateFileA/WriteFile/CloseHandle` (ficha por `CStdioFile` a cada 15 s, `Server_Log`) = sucesso vazio;
   `send`/`recv`/sockets = 0; `OutputDebugStringA` = nada. Nada de DirectDraw/DirectSound deve aparecer no tique; se aparecer, anotar
   o chamador e devolver sucesso.
4. **Fila do cliente**: no solo, 0x504bb7 escreve na fila de recepção do cliente local, que ninguém consome na emulação. Stub no envio
   (ou drenar a fila). Idem 0x52b321 se encher memória.
5. **Ordens**: injetar como o `vclock.command` faz (escrever o pacote 0x6904b8 e chamar o envio 0x50164f antes do tique `t` do roteiro),
   ou escrever direto na fila que `Server_ClientMessages` lê. Conferir no `ep.json` o campo `applied`.
6. **Traço**: emitir `orig.jsonl` no formato do golden e comparar com `refs/golden/episodes/<id>/orig.jsonl.gz` e `states.jsonl.gz`
   (`rng`). Primeira diferença = próxima importação/estado a tratar; use breakpoints do Unicorn (`UC_HOOK_CODE` em faixa) para achar.
7. **Medir**: tiques/s por instância sem hooks por instrução; instruções por tique. Registrar em `notes/oracle-resume.md`.

## Entregáveis
- `tools/re/oracle/{dump_state.py,resume.py,hle.py}` + `README` curto; imagens dos 3 episódios em `refs/oracle/images/`.
- `notes/oracle-resume.md`: o que foi preciso de HLE (lista exata), o que falhou e como foi achado, velocidade, limitações.
- Resultado do portão (3 episódios × traço + `rng`), com o comando que o reproduz.
- Nomes novos em `tools/re/known_functions.json`.

## Restrições e economia
- Uma instância do jogo real por vez (`scratch/refcap.lock`), só pelo harness, modo janela, **nunca** mudar a resolução do monitor nem
  tela cheia; não tocar `C:\GOG Games`; usar a cópia `a2_diff` em `C:\Users\TALES K\Games\`. Python: `PYTHONUTF8=1 .venv/Scripts/python.exe -X utf8`.
- O jogo real só serve para **despejar** as 3 imagens; todo o resto é no Unicorn.
- Leia o C pelo `index.tsv` + `Read` com offset/limite; não abra `g_*.c` inteiros. Relatório final ≤ 15 linhas. Não edite o motor
  (`game/src/sim`) nesta etapa.
