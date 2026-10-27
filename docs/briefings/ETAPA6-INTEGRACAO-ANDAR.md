# Briefing — Etapa 6: integrar o andar portado na `World` (primeiro corte do estrangulador)

Para: uma sessão de modelo forte (Opus), fresca. Motivo e método: `docs/ABORDAGEM-FIDELIDADE-UNIDADES.md` (seções 4.1, 6 e 7.1).
Este é o passo em que o código portado **substitui** o motor atual pela primeira vez; é decisão de desenho, não lote mecânico.

## Ponto de partida (medido; não redescubra)
- Portado e provado a 100 % dos pares nos 3 episódios (`m10_start_s1`, `m10_mage_s102`, `m20_start_s203`): `game/src/sim/exe/path.ts`
  (aproximação e anel), `walk.ts` (folhas), `wave.ts` + `mfc.ts` (Path_WaveSearch, 8 ondas, backtraces, pegada, ocupação, CList/CMap),
  `walk_action.ts` (ordens de andar/perseguir, giro, fórmula x87, pôr/tirar das células, avanço por tique). Registros espelhados em
  `exe/types.ts`: `UnitRec`, `WalkRec` (+0x1c0), `MapObjRec` (+0x10), `PathRec`/grades, ocupação. Testes `game/src/sim/test/exe_*.ts`
  (`exe_recon.ts` remonta estados a partir dos pares). Stubs `NotPorted`: `0x55a96c Unit_TeleportTo`, `0x4f0832` (exec 0).
- **Como o original anda num tique** (relatório do lote 5c): `0x50f12c Unit_ActionMachine` → `0x56dca2 Unit_ActionDispatcher`.
  Com `IA+9 == 3` (sub-tarefa "andando"): `0x555b38 Path_ClearDynamic` → **`0x554fd2`, a única função que escreve a posição fina**
  (lê `MapObjRec` +0/+1/+4/+5 e `WalkRec` +0xb0/+0xb1 dx/dy por tique, +0xae direção, +0xaa tiques do passo; escreve `WalkRec`+0xac e a
  posição; no fim do passo põe a fração em 0x80/0x80; ao trocar de célula chama pegada +0x80, tirar +0x86..0x89 e pôr +0x72/+0x82..85).
  Com `IA+9 == 0` e `IA+8 == 1` (ordem de andar): `0x56e4ac Unit_WalkNear` → `0x555411 Unit_ActionWalk`; fora do centro da célula
  `0x555b38`; no centro, o caminho e `0x555c7e` (fórmula `0x559195` + 1º tique `0x554fd2`) ou o giro `0x556454`. Nenhuma função do andar
  chama `rand()`. `0x55a147` divide o custo da célula por 4 permanentemente (comportamento a reproduzir).
- **Nosso motor hoje** (`game/src/sim/world.ts`, 2196 linhas): `World.step()` (l. 786) pensa na fase 7, depois percorre as unidades na
  ordem do servidor e chama `act(u)`; o andar está em `walkTo` (l. 1253), `chaseUnit` (1279), `exeStep` (1310), `moveStep` (1412),
  `turning` (1241) e em `sim/path.ts` (A*). A classe `Unit` (l. 140) já tem campos-espelho do caminho do exe (`sPath`, `path`, `sGoal`,
  `sFinal`, `sCount`, `sTrack`, `sLen`, `sTcell`) e posição contínua `x`/`y` (células, fração em 1/256) com `cx`/`cy`.
- **Comparador de tique inteiro**: `cd game && npm run tickcmp -- --all` (`notes/tick-compare.md`, `tools/refcap/diff/tick_compare.mts`):
  para cada tique T importa o estado T (`game/src/sim/test/import_state.ts`: `applyState`, `spawnUnmatched`, `resetWorld`; o estado
  vem de `refs/oracle/ticks/<ep>.jsonl.gz`, com `walk.{static,dynamic,goal,final,c9,c78,track,slen,tcell}`, `fx/fy`, `x/y`, `act`,
  `task`, `dir16`...), aplica as ordens do roteiro, dá 1 `step()` e compara com T+1. Hoje: 10,2 % / 8,2 % / 2,8 % de tiques idênticos;
  **1ª divergência: `fx`/`fy` no 5º tique de andar do herói (1/256)**, depois `act` (ordem de andar vira ação 1 um tique tarde), `x/y`,
  `walk_dynamic`/`walk_static`. `import_state.ts` e `diff_window.ts` não estão rastreados no git (trabalho antigo; edite, mas não os
  commite inteiros sem avisar).

## O que decidir e fazer
1. **Registro fiel dentro da `World`**: cada `Unit` passa a carregar `rec: UnitRec` (com `WalkRec`, `MapObjRec`) e a `World` um
   `PathRec` + ocupação espelhada. Para o andar, **o registro é a fonte de verdade**: `x`, `y`, `cx`, `cy`, `sPath`, `path`, `sGoal`...
   viram vistas (getters) sobre `rec` ou são sincronizados num único ponto depois de cada chamada portada; nunca dois donos.
   Decida e documente no cabeçalho de `world.ts` qual dos dois; prefira getters se não custar desempenho mensurável.
2. **Entrada do andar**: porte `0x56dca2 Unit_ActionDispatcher` (24 chamados; os executados já estão quase todos portados — confira com
   `port_status.py show 0x56dca2`; `0x56e5bc` é o maior que falta) **ou** só os seus ramos de andar como `dispatcherWalk(rec)`, com
   `NotPorted` nos ramos não alcançados. O `act(u)` da `World`, para unidades em andar/perseguição, passa a (a) escrever `IA+8`/`IA+9`
   (campos da `AiRec` em `+0x1c4`; crie o registro) a partir da ordem/estado atual e (b) chamar a função portada. Mapeie
   `u.state`/`u.order` → `(IA+8, IA+9)` com a tabela de `notes/tick-compare.md` (`act` 0 parado, 1 andando/girando...). A ordem
   de chegada das ordens (2 tiques antes do pensamento) não muda nesta etapa.
3. **Carregador/importador**: `applyState` preenche `rec` (posição fina, célula, `WalkRec` inteiro a partir de `walk.*`, direção,
   tiques do passo) e a ocupação/grades a partir do estado; o que o estado por tique não traz (ex.: `+0xb0/+0xb1` dx/dy, `+0xaa/+0xac`)
   tem de ser derivável ou acrescentado ao despejo (`tools/re/oracle/dump_ticks.py` + `export_state.py`; adicione campos e regrave os 3
   episódios: `dump_ticks.py`, ~1 min). Também o carregador normal da missão (`mission/setup.ts` → `World`) tem de inicializar `rec`.
4. **Apagar o andar antigo** no mesmo passo: `walkTo`/`chaseUnit`/`exeStep`/`moveStep`/`turning` ficam só como adaptadores finos
   (mesma assinatura para `mission/`, `script/`, HUD) que escrevem a ordem e delegam; `sim/path.ts` (A*) sai se nada mais o usa
   (o A* do herói por clique também vira a onda do exe: é o que o original faz). Testes de `test:sim` que codificavam comportamento
   `[est]` do andar: substitua pelos testes do oráculo; os que medem fatos conferidos no original ficam.
5. **Medir**: `npm run tickcmp -- --all --fields fx,fy,x,y,act,walk_static,walk_dynamic,walk_goal,walk_final,walk_c9,walk_track,walk_slen,walk_tcell`
   antes e depois; `--show <t>` nos tiques que ainda divergem para nomear a causa por campo (função do exe não portada, campo que o
   despejo não traz, ordem de chamadas no tique).

## Pronto quando
- No comparador, com reancoragem por tique, os campos `fx`, `fy`, `x`, `y`, `walk_*` das unidades que andam ficam **100 % idênticos**
  nos 3 episódios, ou cada tique residual tem causa nomeada por campo (função/raiz do exe, com endereço) na nota; `act` das unidades em
  andar idem. O % de tiques inteiros idênticos sobe (registre antes/depois em `notes/tick-compare.md`).
- `npm run typecheck`, `npm run test:sim`, `npm run golden -- --ci` (janelas piores = 0; o placar do golden pode e deve melhorar em `pos`).
- Nenhuma implementação dupla do andar viva; `port_status.tsv` atualizado (`0x56dca2` e o que mais for portado, com `set`).
- Nota `notes/integracao-andar.md` (≤ 40 linhas): desenho escolhido (fonte de verdade, mapeamento ordem → `IA+8/+9`), o que foi
  apagado, campos acrescentados ao despejo, números antes/depois, resíduo por campo. Relatório final ≤ 12 linhas.

## Restrições
Só o Unicorn, nunca o jogo real. C lido por `port_status.py show`; nada de C no repositório. Regras da skill `port-exe` valem para
toda função nova. Trabalho nesta pasta: não troque de branch; commite ao final (`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`);
nunca `git add -A` (há alterações antigas não commitadas; `game/package.json` idem: relate linhas novas em vez de commitar o arquivo).
Python `PYTHONUTF8=1 .venv/Scripts/python.exe -X utf8`. Se o desenho exigir mexer no laço `step()` além do `act(u)` do andar, pare e
relate antes (é o que a etapa 7, máquina de ação, vai fazer).
