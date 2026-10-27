# Briefing — Etapa 7: o despachante inteiro (olhar em volta, golpe/magia como sub-ação, fim de caminho)

Para: uma sessão de modelo forte (Opus), fresca. Motivo e método: `docs/ABORDAGEM-FIDELIDADE-UNIDADES.md` (seções 4.1, 6 e 7.1);
desenho da integração em vigor: `notes/integracao-andar.md` e o cabeçalho de `game/src/sim/world.ts`. Regras de porta: skill `port-exe`.

## Ponto de partida (medido em 2026-10-27; não redescubra)
- `0x56dca2 Unit_ActionDispatcher` está portado em `game/src/sim/exe/action.ts` e roda em todo tique por unidade a partir de
  `World.dispatch` (`world.ts` ~l. 1412). Os chamados ainda não portados saem por `DispatchHooks` (`action.ts` l. 17) com adaptadores
  do motor antigo em `World.exeHooks` (`world.ts` ~l. 1383): `f56dc24` (nada), `patrolNext` (nossa ordem de patrulha), `f56ed4e`
  (inimigo ao alcance → ataca), `task` (5 e 8 só o ramo de perseguir via `fn_0x56ea52`; 9 só o ramo de andar). O que não tem adaptador
  lança `NotPorted`; no jogo a unidade para.
- **`NotPorted` alcançados no corpus** (`npm run test:sim`, linha de `exe_walkaction.ts`): `0x56e5bc` ×17 426, `0x56eab5` ×288,
  `0x56dca2/IA+9=2 (0x57b210)` ×105, `0x56eff3` ×6, `0x56ebc0` ×5, `0x57b020` ×1, `0x56ed4e` ×1. Com `exec = 0` (ficam stub):
  `0x56ea24`, `0x56ecbc`, `0x56ec3f`, `0x56eb2d`, `0x56dc24`.
- **Fechos** (`port_status.py show/next --root X --executed`): `0x56e5bc` (252 B, exec 57 358) → `0x57afc0 Rand_UniformObject`
  (16 B) e `0x57afd0` (31 B); `0x56eab5` (120 B) → `0x56e8c3` (67 B); `0x56eff3` (200 B) → `0x56e8c3`, `0x56f0bb`, `0x53a5a0` (MFC);
  `0x56ed4e` (677 B) → `0x567ddf`, `0x567a16 AI_EnemyFilter`, `0x55aa21 AI_AngleTiebreak`, `0x54fb7f` (120 B, exec 396), `0x44fc20`
  (MFC), `0x56e5bc`, `0x56eff3`; `0x57b210` (157 B) → `0x57ad97`; `0x56ebc0` (127 B) → `0x56e906`; `0x57b020` (91 B) + a lista de
  patrulha IA+0xb4 (`0x55f1f0`/`0x55f0d0`, `CList` → `exe/mfc.ts`); `0x56dc24` → `0x56d969` (230 B, exec 181) e `0x56dba1
  Vision_UpdateManager`. O resto do fecho de `0x56eab5` (392 funções) é cliente/rede 0x500000–0x505fff (`Server_Event 0x502019`,
  `Server_SendStats`...) e MFC: `out` com stub, pela regra da skill.
- **Olhar em volta**: `World.idleLook` (`world.ts` ~l. 770, chamada ~l. 954) já imita `0x56e5bc` com os mesmos sítios de sorteio
  (`rng.draw(0x56e629)`, `rng.scaled(190, 0x56e656)`), mas erra **quando** é chamado: no golden é o maior sítio de sorteios não
  consumidos (7 645 a menos em `0x56e629`, 75 em `0x56e656`); no comparador, o estado inteiro idêntico é 38,5 / 32,6 / 32,3 % e sobe
  para 63,0 / 63,1 / 60,3 % quando se ignora `dir16`. O gatilho real é a tarefa IA+8 = 0xb e o contador IA+0x54, no despachante.
- **Sorteios**: o `Rng` do motor (`sim/rng.ts`) é o `rand()` do CRT com rotulagem por sítio (endereço de retorno no exe), e o golden
  conta os sítios. Funções portadas que sorteiam devem sortear por ele (`draw(site)` / `scaled(n, site)`), na mesma ordem do original;
  ponha o `Rng` ao alcance do `WorldRec` (campo novo) em vez de importar a `World`.
- **Números hoje**: tickcmp inteiro 38,5 / 32,6 / 32,3 %; campos do andar 80,1 / 82,4 / 75,9 %; `rand()` com o mesmo nº de sorteios
  por tique 83,9 / 82,1 / 86,6 %. Golden 54,62 % de janelas limpas; `--ci` falha por `alive|t69|orig_dead` ×2 (Spirit da m20_mage morre no
  original: combate, fora desta etapa) e há 3 janelas piores (perseguição de monstro, alvo, vida).

## Lotes (uma sessão, nesta ordem; cada lote provado e commitado antes do seguinte)
1. **Olhar em volta**: `0x56e5bc` + `0x57afc0` + `0x57afd0`, pares com `fnprobe.py` (coluna `rng`: a ordem dos sorteios é parte da
   prova). Integração: a tarefa 0xb do despachante chama a porta; `idleLook`, `lookTurn`, `lookFlag`, `LOOK_OFF` e a chamada em
   `step()` saem. Medir: o estado inteiro idêntico deve encostar no "exceto `dir16`" (63 %), e o sítio `0x56e629` deve sumir da lista do golden.
2. **Golpe e magia como sub-ação**: `0x56eab5` (+`0x56e8c3`), `0x56eff3` (+`0x56f0bb`), `0x56ebc0` (+`0x56e906`), `0x57b210`
   (+`0x57ad97`) e os ramos IA+9 = 1/2 de `0x56dca2` que hoje lançam `NotPorted`. Essas funções decidem **quando** o golpe/a magia
   começa (ação, IA+9, relógios); o efeito em si (`Unit_StrikeBegin 0x516c1f`, `Spell_Apply`, dano) vive em `Unit_ActionMachine`
   `0x50f12c` e fica no motor antigo: exponha-o como gancho (`strike(u)`, `cast(u)`) chamado **no ponto exato** em que o exe o chama.
   Se o efeito precisar vir de dentro dessas funções de um jeito que não dá para pendurar num gancho, pare e relate.
3. **Fim de caminho**: `0x56ed4e` (+`0x567ddf`, `0x567a16`, `0x55aa21`, `0x54fb7f`), `0x57b020` + lista de patrulha IA+0xb4 via
   `mfc.ts` (o carregador da missão tem de preencher a lista a partir do roteiro), `0x56dc24` (+`0x56d969`; `Vision_UpdateManager`
   pode ficar `NotPorted` com gancho se for grande, com justificativa). Os adaptadores `f56dc24`, `patrolNext`, `f56ed4e` e o `task`
   somem; `DispatchHooks` fica só com os ganchos de efeito do lote 2.

## Pronto quando
- No corpus, nenhum `NotPorted` do fecho de `0x56dca2` é alcançado, salvo funções com `exec = 0`; todas as portadas a 100 % dos
  pares nos 3 episódios (`exe_walkaction.ts` ou um `exe_action.ts` novo no `test:sim`), sorteios inclusive.
- tickcmp: estado inteiro idêntico ≥ o "exceto `dir16`" de hoje (63 / 63 / 60 %); sorteios iguais por tique acima de 84 / 82 / 87 %;
  o resíduo de `act`, `dir16`, `rng`, `target` nomeado por campo com endereço do exe.
- Golden: `--ci` verde, ou cada falha nomeada com causa em combate (`hp`/`alive`); `--rebaseline` só com justificativa no relatório;
  janelas piores explicadas; `0x56e629` fora da lista de sítios não consumidos.
- `npm run typecheck` e `npm run test:sim` verdes; nenhuma implementação dupla viva (`idleLook` e a escolha de alvo no fim de caminho
  apagadas); `port_status.tsv` atualizado (`set`); nota `notes/despachante.md` (≤ 40 linhas: desenho dos ganchos, apagados, números
  antes/depois, resíduo por campo). Relatório final ≤ 12 linhas.

## Restrições
Só o Unicorn, nunca o jogo real. C lido por `port_status.py show`; nada de C no repositório. Não troque de branch; commite ao final de
cada lote (`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`); nunca `git add -A`: há arquivos antigos não commitados e não
rastreados (`import_state.ts`, `wimpy_mage.ts`, `spell_selected.ts`, `portal.ts`, uma linha em `MissionScene.ts`): edite se preciso,
mas não os commite inteiros sem avisar; `game/package.json` idem (relate linhas novas). Python `PYTHONUTF8=1 .venv/Scripts/python.exe
-X utf8`. Se o desenho exigir mexer no laço `step()` além do `act(u)`/`dispatch`, pare e relate antes.
