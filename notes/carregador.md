# Etapa 9b — carregador de missão, tique 0 exato (passagem)

Briefing, ferramentas e categorias: `docs/briefings/ETAPA9B-CARREGADOR.md`. Aqui: o que entrou por lote, números e o próximo lote.

## Como medir
```
PYTHONUTF8=1 .venv/Scripts/python.exe -X utf8 tools/re/oracle/load_mission.py --all     # 46 despejos, ~2 min, refs/oracle/load/
cd game && npm run loadcmp [-- 10,20] [--show M] [--dump ../scratch/x.jsonl]           # nosso carregador × despejo
npm run tickcmp -- --all                                                                # reancorada + corrida sem reimportar
```
O despejo traz `load_rand` (semente antes do 1.º sorteio de 0x4eb715, nº de sorteios e sítios); o comparador passa a semente ao nosso
`buildMission` (`opts.seed`) e confere o nº de sorteios (`rng|carga`, sem o do nosso herói). tickcmp ganhou `--free-show T` (sorteios,
estado antes do passo, campos do andar/IA/unidade e dados dos grupos × o despejo do tique seguinte na corrida livre; `TRAP_TASK=<id>`
mostra quem escreve IA+8 dessa unidade).

## Lote 1 (2026-10-29)
- **Rumo inicial**: o construtor de toda unidade 0x50e173 faz `andar+0 = andar+1 = Rand_Inclusive(0x80) + 0x40`; o servidor não lê a
  direção do `.alm` (0x561bf9). Os 46 despejos: 1 sorteio por unidade, todos no sítio 0x50e2b6, na ordem do `.alm` (= a lista
  `[0x68d2dc]+4` na carga fresca). `World.spawn` sorteia (toda criação, como no exe); sai o `u.dir` do `.alm` em `buildMission`.
- **Diplomacia**: byte do exe = consigo mesmo 0x12; senão bits 0..1 do `.alm` | 0x10 (visão partilhada, `players[].vision` do mapa).
  `w.dip` guarda o byte inteiro e a tabela do exe (`dipTable`) também (antes `& 3`: 0x567c56 compara o byte inteiro com 2).
  Confere 10 345 de 10 350 células nos 46 despejos; sobra a m92 (um 8.º jogador em guerra com 1/5/7 que o nosso mapa não exporta).
- **Corrida sem reimportar do tickcmp** (1.ª divergência T=1 nos três): três defeitos de integração/arnês, nenhum do passo portado:
  1. `resetWorld` guarda IA+0x20 (alvo atribuído pelo grupo) da corrida reancorada anterior e a importação não o traz → a corrida livre
     passa a ler IA+0x20 do despejo (endereço → a nossa unidade) — `g_assigned` saiu.
  2. `exeSyncWorld` refazia a lista viva (mundo+4) e as do contentor `[0x68d2dc]` na ordem dos ids a cada tique fora do importado; a ordem
     decide quem roda e sorteia primeiro (m20_start: a do despejo é 1, 24600, 24603, …, 24639, 24640, 24662, …). Agora as listas guardam a
     ordem que têm (sai quem não pertence, entra no fim: AddTail do exe); o snapshot/save leva a ordem (`exeWorld.lists`).
  3. `exeApplyPlayers` (grupos importados do despejo) não marcava o comando de grupo do `AiMode` como aplicado → no 1.º passo fora do tique
     importado `exeSyncGroups` reaplicava o Stand ground 0x570b8b e zerava IA+8 de 4 unidades (m20). Agora os grupos importados entram em
     `groupCmdApplied`.
  Também: a corrida livre restaura o `rng` depois dos sorteios da importação, como a reancorada.

| | antes (dd4ea6d) | depois |
|---|---|---|
| loadcmp: missões com tique 0 exato | 0 / 46 | 0 / 46 |
| loadcmp: pares idênticos | 96,67 % (19 849 divergentes) | 98,74 % (7 514 divergentes) |
| tickcmp reancorada (m10_start / m10_mage / m20_start) | 100,0 / 99,9 / 100,0 % | 100,0 / 99,9 / 100,0 % |
| tickcmp sem reimportar, 1.ª divergência | T=1 / 1 / 1 | **T=322 / 822 / 740** |
| golden limpas | 79,4 % | (abaixo) |

Corrida sem reimportar, o que sobra: m10_start T=322 só `rng`; m10_mage T=822 = o +0x12c do `syncCombat` (`notes/residuo.md`);
m20_start T=740 `act`/`dir16`/`rng` (24616, 24660).

## Próximo lote (2)
Atributos e livro: `toHit` (40 missões; ex. 740 × 370, 325 × 320), `dmin/dmax`, `eldmg`, `manaregen`/`u.f9e` e `ai.f71` (31: 50 × 0 e 1 × 0
nos monstros), `speed`/`turn`, `charge`, `defense`, `hp` contra `Monster_CreateByName 0x50dd41`, `Human_CreateByName 0x5143e4`,
`Monster_LoadTemplate 0x5114f3` e o `statsFor` (mission/setup.ts); livro dos monstros/humanos no `rec.book` (42 missões);
`AI_SetDefaultWimpy 0x57382c` (Wimpy/Withdraw, 24); `alive|n<id>` (37 missões: uma unidade nossa sem par). Depois: colocação 0x510089 e
`AI_GuardLoad`, e o MapRec (o comparador precisa mascarar ponteiros: a faixa "resto" +0x5400c… e a célula do nosso herói).
