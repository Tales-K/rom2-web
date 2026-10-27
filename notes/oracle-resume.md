# Oráculo por retomada — etapa 1 (2026-10-27)

Briefing: `docs/briefings/ETAPA1-ORACULO-RETOMADA.md`. Código: `tools/re/oracle/` (README). Imagens: `refs/oracle/images/` (git-ignorado).

## Resultado do portão
`PYTHONUTF8=1 .venv/Scripts/python.exe -X utf8 tools/re/oracle/resume.py --gate` → **PASSOU** nos 3 episódios: o traço compacto de
960 tiques (`orig.jsonl.gz`, 242 linhas, byte a byte) e o `rng` dos 60 estados (a cada 16 tiques) são idênticos ao golden.

| Episódio | traço | rng | tiques/s |
|---|---|---|---|
| m10_start_s1 | idêntico | idêntico | ~525 |
| m10_mage_s102 | idêntico | idêntico | ~500 |
| m20_start_s203 | idêntico | idêntico | ~430 |

`m10_mage_s101` e `m20_start_s201`, citados na tarefa, não existem no corpus; usei os vizinhos `m10_mage_s102` e `m20_start_s203`.
Controle negativo: semente + 1 na imagem → diverge já na linha 2 do traço e no rng do estado 0.

## Como funciona
- **Despejo** (`dump_state.py`): prelúdio idêntico ao de `run_pair.run_orig` (F3, semente, `time_on(VTIME0)`, setup). A thread principal é
  **estacionada dentro do GATE**: a caixa de correio do vclock chama `Sleep(8000)` (FN = endereço real do Sleep); com ela parada num
  ponto limpo entre tiques, todas as threads são suspensas e gravam-se todas as regiões comprometidas legíveis (sem as imagens das DLLs
  do sistema), com proteção e tipo. ~55 MB por episódio (13 MB zlib), 9 s. `meta.json` guarda TEB32 e `_tiddata` da thread principal,
  índice TLS, remetente das ordens, módulos, exportações das DLLs do sistema (endereço → nome, lidas da memória) e a IAT dos módulos
  não-sistema (allods2.exe, scenario.dll, DDRAW.dll e WININET.dll da pasta do jogo, smackw32.dll).
- **Retomada** (`resume.py`): cada região volta ao endereço real; cada DLL do sistema vira uma faixa de `int3` com `ret N` nas
  exportações que têm HLE e um gancho de código só nessas faixas (custa nada no código do jogo). FS aponta para a **TEB32 real**
  despejada (GDT própria), então `_getptd` acha o `_tiddata` da imagem (semente do `rand()` em +0x14) pelo `TlsGetValue` real
  (slot +0xe10). Pilha, heap de avanço e página-sentinela em lacunas livres do espaço de endereços.
- **Tique** = o que o GATE do a2_diff faz (`DONE++`, `VTIME += 62 + (DONE & 1)`) + `Server_Tick(ECX = [0x6044c4])` (fastcall, como em
  `Game_SoloLoop` 0x488aa1). GetTickCount/QPC do servidor já leem VTIME pelas cavernas do a2_diff; as importações restantes também.
- **Ordens**: como `vclock.command` — corpo em 0x6904b8+5 e `0x50164f(ECX = 0x670e50, pacote)`, antes do tique do roteiro. O pacote
  chega ao servidor sem nenhum quadro do cliente no meio (os `settle_frames` do harness não são necessários).
- **Leitura**: `EmuProc` (subclasse de `memory.Proc` sobre o Unicorn) + `orig_mem.Server` + `original_episode.Reader` sem mudança; a
  revarredura de unidades olha só regiões graváveis, como a do harness. O laço de amostragem copia o de `run_orig` (quadro a cada 4,
  revarredura a cada 32, estado a cada 16).

- **Estado completo**: `export_state.read_state(o.proc, srv, rd, missão, map_wh)` roda sobre a imagem. No tique 0 de m10_start_s1 ele
  bate com o estado 0 do golden, exceto em campos que guardam endereços de heap ou bytes não inicializados (`ptrs`, `range`,
  `body_state`, `book`) e na ordem dos grupos (conteúdo igual): o golden foi gravado em outra execução do processo. Um critério
  "estado idêntico por tique" sobre esses campos tem de ignorar ponteiros ou comparar contra uma imagem do mesmo processo.

## HLE necessária (lista exata; `hle.py`)
Chamadas de fato nos 3 episódios: `RtlEnterCriticalSection`/`RtlLeaveCriticalSection` (sem efeito), `GetLastError`/`TlsGetValue`/
`SetLastError` (TEB real: +0x34, +0xe10), `RtlAllocateHeap` (avanço, zerado), `HeapFree` (sem efeito), `VirtualAlloc` (comprometer
página reservada = mapear zerada; sem endereço = avanço alinhado a 64 K), `VirtualFree` (DECOMMIT zera as páginas), `Interlocked-
Increment/Decrement`, `lstrlen` (MFC 0x5a1977, só no episódio de mago). Nada de DirectDraw, DirectSound, rede ou arquivo apareceu em
960 tiques; os tratadores de arquivo/relógio/TLS extras da tabela são preventivos. Sem stub no envio ao cliente 0x504bb7 nem em
0x52b321: a fila do cliente local cresce sem consumidor e não afetou nada em 960 tiques (heap de avanço usou < 50 KB).

## Falhas encontradas
1. `kernel32!lstrlen` sem tratador no tique 248 do episódio de mago (chamado de 0x5a1977, CString do MFC) → acrescentado com
   lstrcpy/lstrcat. Achado pela parada estrita (importação sem HLE para a emulação e informa nome + chamador).
Nenhuma outra: com a imagem despejada no ponto certo (thread estacionada no GATE), o resto bateu de primeira.

## Velocidade
~430–530 tiques/s por instância (Python + Unicorn 2.1.4, sem ganchos por instrução), ~90 mil instruções x86 por tique (m10). Carga da
imagem 0,3 s. 3 instâncias em paralelo rodam sem perda (processos independentes). A leitura do traço (revarredura de 55 MB a cada 32
tiques) custa mais que a emulação (~2,7 s por episódio); para uso intensivo, ler por ponteiros em vez de varrer.

## Limitações
- O alocador de avanço nunca reutiliza memória: endereços de objetos novos diferem do jogo real (nada no traço depende disso até
  agora); `HeapSize` de bloco anterior ao despejo para com erro; `HeapReAlloc` de bloco antigo copia até o fim da região.
- Só retoma do tique 0 despejado; o cliente não roda (nada que só o cliente faça entre tiques é reproduzido — o golden mostra que não
  influi nesses episódios). Diálogos/falas que pararam o laço no jogo real (`stalls`) não existem aqui: os 3 episódios têm `stalls = 0`.
- Imagens dependem do a2_diff e da máquina (endereços de DLLs do sistema ficam no meta); refazer com `dump_state.py` (uma instância do
  jogo, trava `scratch/refcap.lock`).
