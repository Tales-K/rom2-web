# Briefing — Etapa 9b: carregador de missão, tique 0 exato

Para: sessões de modelo forte (Opus), uma por lote ou mais; **cada lote é commitado e anotado** em `notes/carregador.md` para que a
próxima continue. Motivo e método: `docs/ABORDAGEM-FIDELIDADE-UNIDADES.md` 4.4 (o carregador verifica-se por igualdade de dados, não
por porta literal; porta-se só o que divergir). Regras de porta quando houver porta: skill `port-exe`.

## Ferramentas (feitas nesta etapa)
- **Despejo do tique 0 do original, sem o jogo**: `tools/re/oracle/load_mission.py [--all | 10 20 ...]`. Parte da imagem de retomada
  `m10_start_s1_t0`, faz o que o cliente faz ao começar uma missão da campanha (0x48ab76): servidor **novo** (`0x4e957b` construtor,
  `0x4eb356` início com o modo 2 = campanha: data.bin "World Data", contentor das unidades `[0x68d2dc]`, jogadores `[0x68d2c4]`), depois
  `Server_StartMap 0x4eb715` com `"<N>.alm"` (mapa, não save) — que semeia o `rand()` (`Rand_SeedTimeGetTime`) e chama o carregador
  `0x5606aa` (jogadores 0x561422, unidades 0x561bf9, gatilhos/grupos 0x562745, objetos 0x564072). HLE própria: arquivos de verdade, só
  leitura (os `.res` que o processo já tinha abertos são "adotados" pelo `CFile` na imagem), data/hora fixas, `GetProfileStringA` = padrão,
  `FindFirstFileA` = nada. Grava `refs/oracle/load/<N>.json.gz` (git-ignorado) no formato de uma linha t=0 de `refs/oracle/ticks/`
  (`export_state.read_state` normalizado + registro do exe por unidade + MapRec inteiro). **46 missões em 1 min 49 s.** O herói não está no
  despejo: o cliente o junta depois de 0x4eb715.
- **Comparador**: `npm run loadcmp [-- 10,20] [--show M] [--fields a,b] [--no-map] [--dump arq]` (`tools/refcap/diff/load_compare.mts`).
  Monta a missão pelo NOSSO carregador (`loader.startRun`, como a MissionScene) e compara sem passo nenhum: a visão plana do tickcmp
  (exportada de `tick_compare.mts`, sem `rng`/`t16`), o registro do exe por unidade (andar/IA pelos offsets de `exe/recio.ts` + IA+0x10/+0x20,
  campos da unidade/tipo/dono, ids do livro; ponteiros → `u<id>`/`s<id>`/`ptr`) e os bytes do MapRec por faixa. Casamento exato por id
  (original = 0x6000 + id do `.alm` = o nosso `scriptId`); o herói fica fora.

## Ponto de partida (medido em 2026-10-29 no main dc178ee; não redescubra)
**Tique 0 exato: 0 de 46 missões; pares idênticos 96,67 % (575 811 / 595 660).** Todas as 4 175 unidades casam por id.

| Categoria (campos) | missões | pares | causa (lida no C) |
|---|---|---|---|
| rumo inicial (`walk.dir`, `walk.dirTarget`, `dir16`) | 46 | 12 083 | **0x50e173** (construtor de toda unidade): `+0x1c0[0] = [1] = Rand_Inclusive(0x80) + 0x40`; a `direction` do `.alm` não é lida pelo servidor. O nosso usa a `direction` do mapa |
| atributos do modelo (`toHit`, `dmin/dmax`, `eldmg`, `manaregen`/`u.f9e`, `ai.f71`, `speed`/`turn`, `charge`, `defense`, `hp`...) | 45 | 4 450 | `Monster_CreateByName 0x50dd41` / `Human_CreateByName 0x5143e4` / `Monster_LoadTemplate 0x5114f3` × o nosso `statsFor` |
| livro (`u.book`: ids das magias) | 42 | 1 461 | monstros e humanos com magia: o nosso `rec.book` fica vazio fora do herói |
| posição/posto (`x/y`, `post` = IA+0, `walk.footCell`, +0x82/+0x83/+0x72) | 24 | 1 089 | colocação `0x510089` (célula ocupada → vizinha) × o nosso `grid.nearestFree` |
| diplomacia (`dip`) | 46 | 255 | diagonal = 0x12 no original (0 no nosso); e o nosso guarda só `& 3` |
| Wimpy/Withdraw | 24 | 221 | `AI_SetDefaultWimpy 0x57382c` (humanos, na criação) |
| MapRec (`map.*`) | 46 | 182 (bytes) | passo 6 do pé das estruturas (0x550a96; já conhecido: `worldFromState` copia `terrain_speed`), bit 0x20/0x60 da célula do NOSSO herói, e a "resto" (+0x5400c…) que mistura ponteiros e estruturas que o nosso modelo guarda fora de `mem` (CMap de ocupação, lista do anel) — **o comparador precisa mascarar os ponteiros antes de virar critério** |
| grupos (`g_radius`, `g_base`, `g_combat`) | 12 | 52 | `AI_GuardLoad 0x570aba` (raio-base 20) e o raio da guarda × `initGroupGuard` |
| outros: `alive|n<id>` (uma unidade nossa sem par em 37 missões), `u.task`, `walk.f88/f89` | — | 50 | a investigar no lote 2 |

Fora do comparador hoje (o despejo traz, a comparação ainda não lê): bytes da IA fora de `AI_FIELDS` (magias e probabilidades da IA —
`prob × 327`), grupos do exe em bytes (`exe.world.players[].groups[].data`), timers do registro além dos campos listados.

Corrida sem reimportar do tickcmp (`notes/residuo.md`, "O que sobra"): 1.ª divergência em T=1 nos 3 episódios (`g_assigned` dos grupos que
atribuem alvo no 1.º pensamento; `rng` na m20). Entra no lote 1.

## Lotes (nesta ordem; cada um medido com `npm run loadcmp` antes/depois, typecheck + `test:sim` + `tickcmp -- --all` + `golden -- --ci` sem piora, commitado e anotado)
1. **Rumo inicial e semente**: o sorteio de 0x50e173 em `World.spawn` (toda unidade criada, como no exe), `buildMission` aceita a semente
   (o comparador passa a do despejo: o `rand()` antes do 1.º sorteio da carga); sai o rumo do `.alm`. Diplomacia: diagonal e valor inteiro.
   Mais a 1.ª divergência em T=1 da corrida sem reimportar.
2. **Atributos e livro**: `Monster_CreateByName`/`Human_CreateByName`/`0x5114f3` contra o `statsFor`; livro dos monstros/humanos no
   `rec.book`; `AI_SetDefaultWimpy 0x57382c`; bytes da IA (magias, `prob × 327`) entram no comparador. `alive|n<id>` explicado.
3. **Colocação e grupos**: `0x510089` (célula de nascimento), `AI_GuardLoad 0x570aba` e os dados de grupo do exe em bytes no comparador.
4. **MapRec**: máscara de ponteiros no comparador, passo 6 do pé das estruturas no `mapbuild.ts`, o resto por faixa.
5. **O herói e os companheiros**: o despejo ganha a junção do herói (o caminho do cliente depois de 0x4eb715) e o comparador o inclui.

## Pronto quando
- `npm run loadcmp`: **46 de 46 missões com tique 0 exato** (ou resíduo nomeado por campo com endereço e a decisão escrita).
- A corrida sem reimportar do tickcmp sem divergência causada pelo tique 0 (1.ª divergência > T=1, nomeada).
- typecheck, `test:sim`, `tickcmp -- --all` (100,0 / 99,9 / 100,0 %) e `golden -- --ci` (79,4 %) sem piora a cada lote.
- `notes/carregador.md` com números por lote e o resíduo.

## Restrições
Só o Unicorn; o jogo real não é preciso nesta etapa. C lido pelo `index.tsv`/`port_status.py show`; nada de C no repositório. Despejos e
assets fora do git (`refs/`). Commits no `main` por nome de arquivo (nunca `git add -A`); sem push (o coordenador faz). Não renomear campos
do registro agora. Python `PYTHONUTF8=1 .venv/Scripts/python.exe -X utf8`. golden/tickcmp em primeiro plano com timeout longo.
