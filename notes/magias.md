# Magias, efeitos e magos da IA (etapa 8b, 2026-10-28)

Briefing: `docs/briefings/ETAPA8B-MAGIAS.md`. Regras: skill `port-exe`. Onde a magia roda no corpus (árvore dinâmica no oráculo): só
na m10_mage — a maga (jogador humano) com autocast ×10 (nunca lança), AI_CastChosenSpell ×18 (IA+0x78 = 0: devolve 0), Heal em si
×3/×2 pelo pensamento já portado (0x56c592/0x57a999 → AI_CastAtTarget) e o cajado ×4; 9 Spell_SpendMana/Release/Apply. m10_start e
m20_start não executam nenhum ponto de entrada de magia: o resíduo delas é do pensamento/andar (abaixo).

## Lote 1 — os magos do jogador humano (porta 100 % dos pares)
`exe/think.ts`: `aiAutocast` 0x56bc7b, `aiCastChosenSpell` 0x56b059, `aiAutocastTargetsMask` 0x56bb53, `fn_0x567c56`
(AI_SplitFriendsFoes: candidatos → mundo+0xac8 em guerra / +0xaa8 os outros), `fn_0x571e9b` (AI_GroupVisibleUnits = 0x571c4d sem o
filtro de inimigos), `fn_0x57b0e0` (AddTail), `fn_0x56bc2e` (AI_SpellInRange; exec 0, sem pares). Prova `test/exe_think.ts`:
0x56bc7b 10/10, 0x56b059 18/18, 0x56bb53 10/10, 0x567c56 10/10, 0x571e9b 10/10, 0x57b0e0 10/10. Registros novos: `WorldRec.friends`
(+0xaa8) e `foes` (+0xac8) (no save e no arnês), `PlayerRec.autocast` ([+0x34]+0x20; a World o espelha de `playerAi[p].autocast`).
Contas: vida ÷ vida máx. é divisão INTEIRA (idiv → fild; assembly 0x56be6f) comparada a 1,0 (0x5d1b88); a "não repetir em 20 tiques"
(IA+0xa4/+0xa8) compara com 0x14 (Bless) em todas as magias do autocast, como está no exe.
**Ganchos removidos**: `ThinkHooks.castChosenSpell` e `autocast` (tasks.ts 0x56c840 e think.ts 0x56acc8/0x56b025 chamam a porta).
**Apagados**: `ai.ts:autocast` (+ `canBuff`, `inBattle` [est], `knows`, `castOn`), `spellattack.ts:spellAttack` e o ramo dele em
`World.hookStrikeBorn`. IA+0x78 = id do livro da magia marcada na interface (`selectedSpell`, CTRL+A), espelhado em `exeSyncGroups`.
O pensamento do motor antigo (`legacyThink`, modos defend/follow/still) chama a porta por `World.exeAutocast`: a tarefa 8 que ela deixa
vira a sub-ação 2 na hora (`castNow`) e a ordem fica (nesses modos a World reescreve IA+8 pela ordem).
Testes: missão 91 "Dina conduz a cadeia" com `immortal` — a Dina agora se dá Haste fora de combate (o exe só exige combate para o
Bless; o autocast antigo exigia para os dois) e chega antes à patrulha orc que a matava; a cadeia de falas é o que o teste mede.
**Achado**: AI_Task_Attack 0x56acc8 chama o autocast quando IA+0x14 (AI_AttackRange 0x56ac5b: o alcance da magia escolhida com
mana, senão +0x12c) é < 2, e o autocast que não lança ZERA IA+8 em todos os ramos — a maga corpo a corpo com livro não golpeia. A
maga do original tem cajado (+0x12c = 6 no oráculo; a nossa tem 1: resíduo `range|1`, derivação dos atributos do herói, fora da 8b).
`necro.ts` e `spell_selected.ts` (este não rastreado; editado, não commitado) passaram a dar alcance 6 à maga como no original e a
testar o caso corpo a corpo/Shield forçado pelo exe (0 golpes).
Números: tickcmp 97,4 / 96,7 / 98,5 % (igual: no corpus o autocast não lança e a escolhida é 0); golden 71,7 % (0 piores, 1 melhor).
**Arnês (tickcmp)**: os ponteiros de magia do registro importado (IA+0x30, +0x64) eram endereços de BookSpellRec do ORIGINAL — o
gancho do gasto não achava a magia e desfazia a sub-ação (`act|1`/`mana|1` T=242…); e +0x5c só vinha na ação 3/0xd (a magia nasce
com o alvo já posto: sem ele o motor antigo virava a maga para (0,0), `dir16`). `dump_ticks.py` agora despeja +0x5c, +0x64 e o
livro ([id, endereço]); `import_state` põe +0x5c e `World.exeImportSpellPtrs` traduz IA+0x30/+0x64 pelo id. tickcmp 97,4 / **97,5** /
**98,6** % (m10_mage: `mana` 100 %, `act` 98,9 → 99,5 %, sorteios 98,9 → 99,2 %).

## Próximo: lote 2 (gasto e lançamento) — o que já se sabe
Spell_SpendMana 0x519998: `this` = a magia do livro (+4 definição: CArray em +8, elementos 2 esfera, 4 (1 → aviso 0x5041d6, senão
0x5042ba), 5 (2 = projétil: tempo de voo = Spell_ProjectileDist ÷ [7]), 7 velocidade; +8 id; +0xc custo); unidade +0x68 item em uso
(sem mana), +0x74 arma (cajado sem livro com +0x74 = +0x68 → 1 sem aviso), lista de efeitos +0x20 (efeito 0xc: +0x42 = 1 quando o alvo
é outro), +0x138 = relógio no aviso (vtable+0x2c). Prismatic Spray (0xb) → Spell_CasterPower + 0x519c04 (exec 0). Spell_Release
0x519d7f: id ≠ 0xb → Spell_Apply(…, 0, 0). Falta espelhar a lista de efeitos +0x20 e os objetos de magia ([0x68d2dc]+0x24).

## Resíduo (tickcmp, 1.ª divergência, depois do lote 1 + arnês)
m10_start: `task|24595` T=609 (o=attack n=move) + `g_assigned`/`target` (pensamento do grupo 0x57240b), `post|1` T=49 (posto IA+0 do
herói), `walk_*` T=625. m10_mage: `task|1` T=241 ×5 (rótulo: a World escreve a ordem "cast" da tarefa 8 de AI_CastAtTarget; o
original compara a classe +0x50, que AI_CastAtTarget não muda), `range|1` T=4 ×5 (+0x12c: 6 × 1, atributos do herói), o cajado
(0x53a5a0 → Spell_Apply no motor antigo: `rng` T=843, `hit_clock16`/`flee_cell`/`look_hit`/`hp`/`alive` de 24611/24609 em T=843…928 —
o aviso 0x56e6b8 sai no lançamento e não no impacto), `act|1` T=822, `post|1` T=113, `target|1` T=463. m20_start: `post|1` T=19,
`task|24603` T=623, `target|1` T=455.
