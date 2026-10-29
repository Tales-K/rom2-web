# Briefing — Etapa 8b: magias, efeitos, magos da IA, invocações e saque (até onde o corpus executa)

Para: uma sessão de modelo forte (Opus), fresca; a etapa pode levar mais de uma sessão — **cada lote é commitado e anotado** para que
a próxima continue de onde parou. Motivo e método: `docs/ABORDAGEM-FIDELIDADE-UNIDADES.md` (4.1, 6, 7.1); desenho em vigor:
`notes/maquina-de-acao.md` (ganchos `MachineHooks`), `notes/pensamento.md` (ganchos `ThinkHooks`) e os cabeçalhos de
`game/src/sim/world.ts`, `sim/exe/action.ts` e `sim/exe/think.ts`. Regras de porta: skill `port-exe`.

## Ponto de partida (medido em 2026-10-28 no main 99ff33b; não redescubra)
- tickcmp (estado inteiro idêntico / mesmo nº de sorteios por tique): m10_start 97,4 / 99,6 %; m10_mage 96,7 / 98,9 %; m20_start
  98,5 / 99,8 %. Golden `--ci` verde, 71,7 % de janelas limpas. test:sim 30/30.
- **Onde a magia roda no corpus** (árvore dinâmica de chamadas no oráculo, rastreador por bloco com pilha de raízes): **só na
  m10_mage**. Na m10_start e na m20_start nenhum dos pontos de entrada abaixo é chamado — o resíduo delas não é magia (é `task`/
  `target`/`g_assigned` do pensamento, `post|1` do herói, `walk_*`; fica para depois desta etapa e deve ser nomeado no relatório).
- m10_mage, a maga (herói 0x121b21a0, jogador humano 0x12db52b8) — 9 lançamentos:
  - `AI_Autocast 0x56bc7b` (2 327 B, exec 10; T = 1, 65, 97, 113, 209, 225, 257, 321, 401, 417): **nunca lança**; chama
    AI_CanCastCost 0x56bb0d (3×/chamada), 0x571e9b (561 B), 0x567c56 (393 B), AI_AutocastTargetsMask 0x56bb53 (219 B), 0x57b0e0 (25 B),
    Vision_Compute (já portada), GetCount 0x44fc20. 0x56bc2e (77 B) e AI_InBattle 0x542c90 não rodam.
  - `AI_CastChosenSpell 0x56b059` (2 635 B, exec 18; T = 433…881): IA+0x78 (magia escolhida) = 0 em **todas** → devolve 0 no 1.º teste.
  - `AI_CastAtTarget 0x56c72b` (portada) ×5 em si mesma (T = 241, 385, 625, 753, 897; magias 0x2e34a00 ×2 e 0x2e349e0 ×3 = Heal,
    Unit_AddHeal 0x510484 ×3): vêm do pensamento já portado (0x56c592/0x57a999), a magia em si é a tarefa 8 → 0x56ebc0 → 0x56e906.
  - o cajado (magia da arma, 0x53a5a0) ×4 no inimigo (T = 835, 854, 872, 920; magia 0x2e34910; Spell_FireDamageObj 0x543040 ×4,
    Spell_DamageObject 0x51e505 ×4): AI_Task_Attack → despachante → sub-ação 2.
  - `Spell_SpendMana 0x519998` (620 B, exec 9), `Spell_Release 0x519d7f` (57 B, exec 9) → `Spell_Apply 0x519db8` (8 448 B, exec 9;
    switch por id, tabela 0x51becc; cria objetos de magia no heap: 0x401880 = new, Spell_DamageObject/Spell_WallObject/
    SpellArea_Construct). Folhas executadas sob Spell_Apply (exec): Spell_Instance 0x5195b1 (562 B, 17), 0x519441 (37 B, 9),
    Spell_CasterPower 0x519483 (154 B, 8), Spell_ProjectileDist 0x516aae (129 B, 8), Spell_AttachToTarget 0x5178d4 (117 B, 6),
    Spell_WallObject 0x51ca4d (83 B, 6), 0x517719/0x517774, 0x518d1e, 0x51f20a/0x51f29c, 0x51e8fa (1 912 B, 2), 0x51caa0, 0x5238c5,
    Unit_AddHeal 0x510484 (176 B, 3), 0x543130, 0x542e60…0x542fc0, 0x54f955/0x54feae/0x54ff06 (célula alvo), 0x5160ef.
  - Objetos de magia vivos depois do lançamento (vtable, sem chamador no callgraph; exec): 0x51d436 (3 610 B, 4: impacto do dano),
    0x51366b (3 157 B, 4), 0x51ce12 (867 B, 2), 0x51d175 (450 B, 2), 0x51d337 (255 B, 2), 0x51e65b (307 B, 4; SpellArea_HitCell),
    0x518efd (133 B, 18), 0x518ca1 (16 B, 11), 0x518e30 (205 B, 4), efeitos 0x517949 (343 B, 6) e 0x517aa0 (140 B, 6) pelos thunks
    0x542d00/0x542d20/0x542e30, 0x5127d2/0x5127f2, 0x5113e7/0x515a6c/0x515617. Lista de magias do contentor [0x68d2dc]+0x24.
- **exec 0 no corpus** (não é prioridade; porta sem prova só se o chamador exigir, senão gancho/NotPorted): `AI_CasterOffensiveSpell
  0x57a769` (444 B), 0x56cb8c (389 B) e `AI_WithdrawActionAlt 0x56cef3` (319 B) (fuga por Teleport), `Spell_PrismaticSpray 0x519c04`,
  o laço 0x50ee14 (564 B), `Sack_PickupAll 0x5108fa` (251 B; `out`, caso 2 de 0x50f12c), 0x56a981 (magia de chance; `review`), 0x5106f4.
- **Nosso motor hoje**: ganchos `ThinkHooks.castChosenSpell` (`() => 0`: a magia selecionada entra no golpe pelo adaptador
  `thinkAfterDispatch` → `hookStrikeBorn`/`spellAttack`), `autocast` (`ai.ts:autocast`), `casterOffensiveSpell` (`pickOffensive`);
  `MachineHooks.spellSpendMana/spellRelease/spellApply/spellLevel` (`beginCast`/`releaseSpell`: `sim/spells.ts`, `spellattack.ts`,
  `areas.ts`, projéteis `launch`), efeitos `effectsTick/effectPower/effectExpire/effectsOnDie` (`buffs`).
- Resíduo da m10_mage que é magia (tickcmp): `act|1` T=242 (o original começa a magia: ação 0xd), `mana|1` T=242 (89 × 99), `task|1`
  T=241, `range|1` T=4 (+0x12c: 6 × 1 — AI_AttackRange 0x56ac5b com a magia da arma), `target|1` T=463, `hit_clock16`/`flee_cell`/
  `look_hit`/`hp` de 24611/24609 em T=843/851/928 (o cajado: quem é atingido e quando), `rng` T=394.

## Lotes (nesta ordem; cada um provado a 100 % dos pares com `fnprobe.py m10_mage_s102 <addrs> --verify 10`, sorteios incluídos,
integrado substituindo o gancho e o código antigo correspondente, typecheck + test:sim + `golden --ci` verdes, commitado e anotado)
1. **Escolha da magia pelos magos do jogador humano**: `AI_Autocast 0x56bc7b`, `AI_CastChosenSpell 0x56b059` e folhas (0x56bb53,
   0x567c56, 0x571e9b, 0x57b0e0, 0x56bc2e). IA+0x78 passa a ser a magia selecionada da interface (`selectedSpell`); o autocast antigo
   (`ai.ts:autocast`) e o ramo `spellAttack` do `hookStrikeBorn` saem. Contas em `double` (hp/hpmáx, 0x5d1b88): do assembly.
2. **Gasto e lançamento**: `Spell_SpendMana 0x519998`, `Spell_Release 0x519d7f`, Spell_CasterPower, 0x519441, Spell_ProjectileDist —
   mana e +0x138 na porta; os avisos ao cliente (0x5041d6/0x5042ba/0x503bef/Server_SendStats) são stubs.
3. **Aplicação**: `Spell_Apply 0x519db8` nos ids que o corpus executa (Heal, a magia do cajado; os outros `case` → NotPorted com o id) +
   Spell_Instance, Unit_AddHeal, os construtores dos objetos de magia (registro espelhado novo `SpellObjRec` em `exe/types.ts`, lista
   [0x68d2dc]+0x24) e a célula alvo.
4. **Projétil e impacto**: os métodos dos objetos (0x51d436, 0x51e65b, 0x518efd, 0x518ca1, 0x518e30, 0x51ce12/0x51d175/0x51d337),
   dano pelo 0x516f6f já portado; aviso do alvo (0x56e6b8) no impacto (assinatura do golden `target|t76`).
5. **Efeitos** na lista +0x20 (0x5178d4, 0x517949, 0x517aa0, 0x5127d2/0x5127f2): substituem os `buffs` do motor antigo onde o corpus os
   usa; `effectsTick`/`effectPower`/`effectExpire` portados.
6. **Invocações e saque**: só se o corpus executar (hoje não: 0x5108fa exec 0) — senão NotPorted documentado.

## Pronto quando
- tickcmp com estado inteiro ≥ 99 % nos 3 episódios **ou** resíduo nomeado por campo com endereço; na m10_mage `mana`, `hp`,
  `effects`, `task|hero` 100 %.
- Golden `--ci` verde acima de 71,7 % de janelas limpas (antes/depois registrados); regravar a referência só com cada assinatura
  classificada e nomeada no commit.
- `castChosenSpell` e `autocast` portados (ganchos removidos); `port_status.tsv` e `known_functions.json` atualizados; nenhuma
  implementação dupla viva; nota `notes/magias.md` (≤ 60 linhas: ganchos removidos, apagados, números por lote, resíduo por campo).

## Restrições
Só o Unicorn, nunca o jogo real. C lido por `port_status.py show`; nada de C no repositório. Não troque de branch; commits no `main`
por nome de arquivo (nunca `git add -A`: `sim/spells.ts`, `sim/areas.ts`, `sim/spellattack.ts` e `game/src/mission/` têm trabalho
antigo não commitado — commite só os trechos que a porta exige e diga quais). Não mexa em `mission/`, `scenes/`, `ui/`, `campaign/`
além do mínimo para a apresentação ler os registros. Cota no fim: commite o lote verde; o resto em `refs/heads/wip/etapa8b` (sem
trocar de branch) com nota de passagem em `notes/magias.md`. Python `PYTHONUTF8=1 .venv/Scripts/python.exe -X utf8`. Contas em x87:
do assembly, com fuzz no Unicorn. Lição da etapa 9: golden caiu → olhe o arnês (`test/import_state.ts`, `diff_window.ts`) primeiro.
