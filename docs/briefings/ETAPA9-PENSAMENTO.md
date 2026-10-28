# Briefing — Etapa 9: o pensamento da IA (jogador, grupo, tarefas da unidade, visão), regeneração e ordens do cliente

Para: uma sessão de modelo forte (Opus), fresca; a etapa pode levar mais de uma sessão — **cada lote é commitado e anotado** para que
a próxima sessão continue de onde parou. Motivo e método: `docs/ABORDAGEM-FIDELIDADE-UNIDADES.md` (4.1, 6, 7.1); desenho em vigor:
`notes/integracao-andar.md`, `notes/despachante.md`, `notes/maquina-de-acao.md` e os cabeçalhos de `game/src/sim/world.ts` e
`sim/exe/action.ts`. Regras de porta: skill `port-exe`. As magias (`Spell_Apply`, magos da IA: `AI_Autocast 0x56bc7b`,
`AI_CastChosenSpell 0x56b059`, `AI_CasterShield 0x57a999`, `AI_IdleCasterSupport 0x56c592`...) **não** entram: ficam em gancho (etapa 8b).

## Ponto de partida (medido em 2026-10-27; não redescubra)
- Despachante `0x56dca2` e máquina de ação `0x50f12c` portados e integrados; golden `--ci` verde (61,6 % de janelas limpas); comparador
  com estado inteiro idêntico em 86,9 / 85,1 / 85,5 % dos tiques e sorteios iguais por tique em 93,6 / 92,8 / 99,5 %. **Resíduo** (nota
  da 8a): `task`/`target` ~5 % e `rng` 6–7 % nos tiques ≡ 1 mod 16 = o pensamento da IA; `hp` 1–3 % = regeneração (`0x50fc5a`) e magias;
  `act`/`dir16` na m20 T=5 = ordem de andar do grupo (`0x5728fa`); ordem repetida pelo cliente zera IA+8/andar+0x7c no exe (tratador).
- **Como o original pensa** (callgraph + perfil; confirme no C): `Server_Tick 0x4f08c0` chama `0x56fe4d` (570 B, exec 180 = 1×/s) →
  `AI_PlayerThink 0x570087` (108 B) → `AI_GroupThink 0x5700f3` (319 B, exec 1 793) → `0x5728fa` (1 117 B, exec 1 255) com
  `AI_GroupAssignTargets 0x57240b` (413 B), `AI_GroupVisibleEnemies 0x571c4d` (590 B), `AI_TargetCost 0x5711ea` (526 B), `0x57375a`,
  `0x5713f8`/`0x5725a8`; por unidade `0x56fe34` → `0x5692d5` → `0x569308` → `AI_TaskDispatcher 0x569321` (679 B, exec 176) com
  `AI_Idle 0x56afac`/`AI_IdleAlt 0x56afd9` (exec 3 720; também via `0x57309d`/`0x57311c`), `AI_Task_StandGround 0x56a1fb` (1 025 B),
  `AI_Task_Attack 0x56acc8` (603 B), `AI_Task_Guard 0x56a5fc`, `AI_Task_Patrol 0x569b62`, `AI_MoveTo 0x56c8af`, fuga (`AI_FleePoint
  0x56f765`, `AI_FleeAction 0x56c9bc`, `Grid_FineCoordCentroid 0x558b92`), `0x569fd4`, `AI_EnemiesAroundPost 0x567988`,
  `AI_AlliesScan 0x567b2d`; fila de eventos mundo+0xbbec drenada em `0x57485b`. **Visão**: `Vision_Compute 0x552c28` (645 B, exec
  4 098) com `0x552af8` (exec 1 015 000) e `0x559536` (1 272 960), `Vision_UnitMap 0x553329`, `0x553681` — laços quentes: porte literal,
  mas meça o custo (tiques/s do `tickcmp`) e relate. O motor já tem uma aproximação em `World` (~l. 806, "células que a unidade vê",
  tabelas `vision_tables.ts`): a porta a substitui. `Unit_Regen 0x50fc5a` (723 B, exec 6 026; chamado por vtable em `World_SecondTick
  0x52bbb7`): o motor tem a fórmula medida em `world.ts` ~l. 1124. `Server_PacketDispatcher 0x4f515d` (12 585 B, exec 130, `switch`
  por tipo de ordem): porte **só os `case` que o corpus executa** (perfil por bloco: use `exec_profile.py` com granularidade de bloco ou
  `fnprobe.py` para listar os tipos recebidos), `NotPorted` nos demais.
- **Nosso motor hoje**: `sim/ai.ts` (487 linhas: `aiThink`, `heroThink`, `autocast`, fuga, Stand ground, guarda, `[est]` e medidas de
  `notes/ai-behaviors.md`/`ai-original.md`), chamado de `World.step` na fase ≡ 7 (`world.ts` ~l. 1024–1082); `behaviors.ts` monta os
  parâmetros de IA dos dados; adaptadores `thinkAfterDispatch` (`world.ts` ~l. 1521) e a magia no chão. Grupos: `World` tem centro,
  raio-base e comandos (`world.ts` ~l. 704). `AiRec` (+0x1c4) e a lista IA+0xb4 já estão em `exe/types.ts`; os campos de grupo e de
  jogador do exe (dono +0x2c, +0x38/+0x40/+0xa54) só em parte: estenda os registros e o despejo (`dump_ticks.py`) conforme o inventário
  `tools/re/fields_by_type.tsv`.
- Pares: `fnprobe.py <ep> <addrs> --verify 10` (com `--stride` nos quentes); sorteios conferidos pela coluna `rng` (o pensamento sorteia:
  `0x57a769`, `0x572718`/`0x57274d`, `Rand_Range 0x57aff0`). Arnês de remontagem: `test/exe_recon.ts`.

## Lotes (nesta ordem; cada um provado a 100 % dos pares nos 3 episódios, typecheck e `test:sim` verdes, commitado e anotado)
1. **Regeneração** `0x50fc5a` (+ folhas executadas): substitui a fórmula do motor; `hp`/`mana` de quem não luta ficam 100 %.
2. **Pensamento do grupo**: `0x56fe4d`, `AI_PlayerThink`, `0x57485b`, `AI_GroupThink`, `0x5728fa`, `AI_GroupAssignTargets`,
   `AI_GroupVisibleEnemies`, `AI_TargetCost`, `0x57375a`, `0x5713f8`, `0x5725a8` e folhas; registros de grupo/jogador espelhados; a
   fase de pensamento da `World` passa a ser a do exe (1×/s, no tique em que `0x56fe4d` roda — meça com o oráculo). Se a ordem dentro
   de `step()` tiver de mudar (pensamento antes/depois das máquinas), **faça só o que o exe faz e relate**.
3. **Tarefas da unidade**: `0x56fe34`, `0x5692d5`, `0x569308`, `AI_TaskDispatcher`, `AI_Idle`/`AI_IdleAlt`, Stand ground, ataque, guarda,
   patrulha, `AI_MoveTo`, fuga e folhas; os ramos de mago em gancho (`autocast`/`pickOffensive` do `ai.ts` servidos no ponto exato).
   `aiThink`/`heroThink` viram adaptadores finos ou somem; `[est]` de `ai.ts` que a porta cobre saem.
4. **Visão** `Vision_Compute` e folhas (substitui a aproximação da `World`); depois **ordens do cliente**: os `case` executados de
   `Server_PacketDispatcher` (andar, atacar, parar, patrulha, magia...), para que ordem repetida zere IA+8/andar+0x7c como no exe.

## Pronto quando
- Todas as funções acima com `exec > 0` estão `ported` (100 % dos pares, sorteios incluídos) ou `out`/gancho com justificativa.
- tickcmp: `task`, `target`, `rng`, `hp`, `mana`, `post`, `flee_cell`, grupos (`radius, base, combat, cmd12, assigned`) 100 % ou resíduo
  nomeado por campo com endereço; estado inteiro ≥ 92 % nos 3 episódios; sorteios iguais por tique ≥ 98 % (m20 ≥ 99,5 %).
- Golden: `--ci` verde; janelas limpas acima de 61,6 % (registre antes/depois); `0x56e629` e `0x57aad9` fora da lista de sítios não
  consumidos (o 2º é `AI_CasterShield`: se ficar por ser magia, diga). Sem `--rebaseline` sem justificativa.
- `npm run typecheck` e `npm run test:sim` verdes; nenhuma implementação dupla viva; `port_status.tsv` e `known_functions.json`
  atualizados; nota `notes/pensamento.md` (≤ 50 linhas: ordem do tique, ganchos, apagados, números por lote, resíduo). Relatório ≤ 12 linhas.

## Restrições
Só o Unicorn, nunca o jogo real. C lido por `port_status.py show`; nada de C no repositório. Não troque de branch; commite ao final de
cada lote (`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`); nunca `git add -A`: há arquivos antigos não commitados e não
rastreados (`test/import_state.ts`, `test/ai.ts`, `sim/ai.ts` e `necro.ts` têm linhas da 8a fora do commit, `mission/setup.ts`,
`game/package.json`): edite se preciso e relate as linhas; `sim/ai.ts` pode ser commitado inteiro **se** a sessão o reescrever nesta
etapa (diga no commit). Python `PYTHONUTF8=1 .venv/Scripts/python.exe -X utf8`. Contas em x87: reconstrua do assembly, com fuzz no Unicorn.
