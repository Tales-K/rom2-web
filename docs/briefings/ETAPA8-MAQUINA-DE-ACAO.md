# Briefing — Etapa 8a: a máquina de ação `0x50f12c` por `case`, golpe físico, dano e morte

Para: uma sessão de modelo forte (Opus), fresca. Motivo e método: `docs/ABORDAGEM-FIDELIDADE-UNIDADES.md` (seções 4.1, 6 e 7.1);
desenho em vigor: `notes/integracao-andar.md`, `notes/despachante.md` e os cabeçalhos de `game/src/sim/world.ts` e `sim/exe/action.ts`.
Regras de porta: skill `port-exe`. A magia (`Spell_Apply 0x519db8`, 8 448 B) **não** entra nesta etapa: fica em gancho (8b).

## Ponto de partida (medido em 2026-10-27; não redescubra)
- O despachante `0x56dca2` está inteiro (etapa 7): nenhum `NotPorted` do seu fecho é alcançado no corpus. O que ainda é motor antigo
  no tique da unidade é a **máquina de ação** `0x50f12c Unit_ActionMachine` (2 795 B, exec 96 413; vtable +0x18, chamada por
  `Server_Tick`): hoje `World.act(u)` (`world.ts` ~l. 1165–1193) e `World.dispatch` (~l. 1482; ganchos `strikeBegin` ~l. 1321 e
  `castBegin` ~l. 1351 chamados quando a sub-ação 1/2 nasce, l. 1522–1523) e `progressAttack` (~l. 1635) fazem o golpe/a magia do
  motor antigo e marcam +0x136; `kill` (~l. 2151) faz a morte. Esses são os pedaços a substituir.
- **Fecho executado** (`port_status.py show/next --root X --executed`): `0x50f12c` chama `0x516c1f Unit_StrikeBegin` (204 B, exec 112),
  `0x516b2f Unit_StrikeExtra` (240 B), `0x542580 Weapon_CastsSpell` (28 B), `0x50fc3e` (28 B, exec 7 063), `0x50ff2d` (348 B, exec
  8 254), `0x510745` (271 B, exec 72), `0x510a70 Unit_Die` (1 608 B, exec 5), `0x51fa25 Rand_Inclusive`, `0x519db8 Spell_Apply`,
  `0x519998 Spell_SpendMana`, `0x519d7f Spell_Release` (magia: gancho), `0x502019 Server_Event` e os envios ao cliente (`out`), MFC
  (`out`/`mfc.ts`); com exec 0: `0x5108fa Sack_PickupAll`, `0x553ab3`, `0x52bfe7`, `0x574f3f`, `0x522fab`, `0x52c129`, `0x5539e5`,
  `0x50101e`, `0x500ad9` (stubs). `0x516f6f Unit_PhysicalDamage` (1 482 B, exec 104; raiz extra, chamada por ponteiro) → `0x56e6b8`
  (523 B; marca IA+0x54 e o ponto de fuga, hoje `World.noteAttacked`), `0x57977a` (467 B), `0x5106d2`, `0x5169de` (208 B),
  `0x542560` (25 B, exec 95 858: acessor de atributo). `Unit_Die` tem 36 pendentes executadas no fecho, quase todas rede/MFC.
- **Sorteios a fechar** (golden, sítios não consumidos): `0x50f7b7` em `0x50f12c` (1 258 faltas), `0x5170f8`/`0x5170d3`/`0x5172b7`
  em `Unit_PhysicalDamage` (753/747/242), `0x510cbc`/`0x510d19` em `Unit_Die`. O `Rng` do motor (`sim/rng.ts`) rotula por sítio;
  `WorldRec.rng` já existe (`exe/rand.ts`: `0x57afc0`, `0x57afd0`); `Rand_Inclusive 0x51fa25` = `rand(n)` do `Rng`.
- **Números hoje**: tickcmp estado inteiro 82,0 / 82,4 / 82,0 %; sorteios iguais por tique 92,8 / 92,7 / 98,8 %. Resíduo (nota da
  etapa 7): `act` 6–10 % (golpe importado sem máquina, ação 3/0xd/0xe), `hp`/`mana`/`alive` 1–3 %, `rng` 7 % / 2 %. Golden 56,89 %
  de janelas limpas; **`--ci` falha** por `alive|t69|orig_dead` ×3, `alive|t75|ours_dead`, `target|t1|o:unit/n:unit` (vida/morte).
- Fórmulas de dano/acerto que o motor antigo usa estão em `sim/world.ts` e `sim/stats.ts` (`[est]` e medidas); o comparador compara
  `hp`, `hpmax`, `hit_clock16`, `look_hit`, `flee_cell`, `effects`, `alive`, `act`, estatísticas (`notes/tick-compare.md`).

## Lotes (uma sessão, nesta ordem; cada lote provado e commitado antes do seguinte)
1. **Dano físico**: `0x516f6f Unit_PhysicalDamage` + `0x56e6b8` + `0x57977a` + `0x5106d2` + `0x5169de` + `0x542560`, pares com
   `fnprobe.py` (sorteios conferidos). Integração: a World passa a aplicar o dano físico pela porta (o cálculo antigo de acerto/dano/
   absorção/fuga sai; `noteAttacked` sai); experiência e eventos de HUD continuam como efeito colateral no mesmo ponto.
2. **Máquina de ação**: `0x50f12c` por `case` com `0x516c1f`, `0x516b2f`, `0x542580`, `0x50fc3e`, `0x50ff2d`, `0x510745`; os `case`
   de magia chamam ganchos (`spellApply(u)`, `spellSpendMana`, `spellRelease`) servidos pelo motor antigo **no ponto exato**; `case`
   com exec 0 ficam `NotPorted`. `act(u)` vira: despachante portado → máquina portada; `strikeBegin`/`castBegin`/`progressAttack`
   somem (o que sobrar de animação/HUD lê o registro). Se a ordem dentro de `step()` (fase 7 do pensamento, ordem das unidades) tiver
   de mudar para bater, pare e relate antes.
3. **Morte**: `0x510a70 Unit_Die` (+ folhas executadas que não são rede/MFC); `kill`/`fall`/cadáver do motor antigo viram adaptadores
   do que a porta não cobre (necromancia, saque: `necro.ts` fica), sem implementação dupla da decisão de morrer.

## Pronto quando
- Todas as funções acima com `exec > 0` estão `ported` (100 % dos pares nos 3 episódios, sorteios incluídos) ou `out` com justificativa;
  `0x50f12c` não alcança `NotPorted` no corpus fora dos `case` de magia (gancho) e dos `case` com exec 0.
- tickcmp: `act`, `hp`, `alive`, `hit_clock16`, `look_hit`, `flee_cell` 100 % idênticos ou resíduo nomeado por campo com endereço;
  estado inteiro ≥ 85 % nos 3 episódios; sorteios iguais por tique acima de 93 / 93 / 99 %.
- Golden: `--ci` verde (as assinaturas `alive|t69`, `alive|t75`, `target|t1` somem) ou cada falha nomeada com causa em magia/pensamento;
  `0x50f7b7`, `0x5170f8`, `0x5170d3`, `0x5172b7` fora da lista de sítios não consumidos; sem `--rebaseline` sem justificativa.
- `npm run typecheck` e `npm run test:sim` verdes (testes `[est]` de dano substituídos pelos pares; os que medem fatos do original ficam);
  `port_status.tsv` e `known_functions.json` atualizados; nota `notes/maquina-de-acao.md` (≤ 40 linhas: ganchos, apagados, números
  antes/depois, resíduo por campo). Relatório final ≤ 12 linhas.

## Restrições
Só o Unicorn, nunca o jogo real. C lido por `port_status.py show`; nada de C no repositório. Não troque de branch; commite ao final de
cada lote (`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`); nunca `git add -A`: há arquivos antigos não commitados e não
rastreados (`test/import_state.ts`, `test/ai.ts`, `wimpy_mage.ts`, `spell_selected.ts`, `portal.ts`, `MissionScene.ts`): edite se preciso,
mas não os commite inteiros sem avisar; `game/package.json` idem (relate linhas novas). Python `PYTHONUTF8=1 .venv/Scripts/python.exe
-X utf8`. Contas em x87 (dano com float): reconstrua do assembly como no piloto (`notes/` da etapa 4), com fuzz no Unicorn.
