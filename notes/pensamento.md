# O pensamento da IA, a regeneração e as ordens do cliente (etapa 9, 2026-10-28)

Briefing: `docs/briefings/ETAPA9-PENSAMENTO.md`. Regras: skill `port-exe`. Lotes: (1) regeneração e laço de 1/s; (2) pensamento do
jogador e do grupo + visão; (3) tarefas da unidade; (4) ordens do cliente (`Server_PacketDispatcher`).

## Lote 1 — regeneração 0x50fc5a e World_SecondTick 0x52bbb7 (no main, d6de030)
`exe/regen.ts` (`unitRegen`, `worldSecondTick`), `rand.ts` (0x51fa4e), `mfc.ts` (CMap<uint,uint>), listas do contentor [0x68d2dc]
(+4 todas na ordem de criação, +0x24 magia, +0x44 cadáveres). Prova `test/exe_regen.ts` 100 %. 0x52bbb7 roda no tique com relógio
pré-incremento ≡ 0xc (`absClock16() % 16 == 13` na World); `secClock()` = ⌊relógio 16/s ÷ 16⌋. Vida em int truncada a short (32 767 de
máximo regenera para negativo, como no exe). Golden 61,55 → 63,08 %.

## Lotes 2–4 — pensamento, tarefas, ordens (porta 100 % dos pares; integrados e no main em 28/10)
Código: `exe/think.ts` (0x56fe4d e chamados), `exe/vision.ts` (0x552c28, 0x553681), `exe/tasks.ts` (0x56fe34, 0x5692d5, 0x569321,
0x56a1fb, 0x569fd4, 0x56a5fc, 0x569b62, 0x56c840), `exe/orders.ts` (`clientOrder` = casos 4/6/7/0xa/0xc de 0x4f515d; 0x5703c0, 0x570b8b,
0x570946, 0x5702be, 0x56d032, 0x56d1be, 0x56d3e6, 0x570d26/0x56d6b7). Provas: `test/exe_think.ts` (42 funções), `exe_tasks.ts`,
`exe_orders.ts` — 100 % dos pares. Ganchos 8b: 0x56b059, 0x56bc7b, 0x57a769, 0x56cb8c, 0x56cef3. Achados: unidade+0x70 É o grupo; o
humano vive em grupos das ordens do cliente; diplomacia consigo = 0x12; laço das unidades de 0x52b459 na ordem de CRIAÇÃO.
Salvo em `refs/heads/wip/etapa9-lotes2-4` (último commit desta nota).

**Causa da queda do golden (63,08 → 32,98 %) — harness, não porta.** (1) Os jogadores/grupos do exe (`exeGroups`, `exePlayers`,
`groupCmdApplied`, dados +0x3c) não estão no `MissionSnapshot`: o golden reaproveita o mundo entre janelas (`resetWorld`) e o grupo da
janela anterior vazava (herói com o andar da janela passada; patrulha voltando ao posto). `World.exeGroupsSave()` guarda o retrato do
tique 0 e `resetWorld` o devolve ANTES do `restoreMission` (que reaplica os comandos do script). → 49,3 %. (2) "stop" do roteiro =
mensagem 0x18 = Stand ground: `diff_window.orderOf` dava `none` (sem `clientOrder`; o grupo seguia andando) → `hold`. → 61,2 %.
(3) Importação derivada: +0x45/+0x48 dos grupos — +0x48 = 1 de todos (do retrato) acordava no 1.º pensamento os grupos que o original
deixa dormir (9 olhares em volta a mais por tique): agora +0x45 = +0x48 = "acordado no original" (ação ≠ 0x1b) [est]. Sorteios do
olhar em volta por segundo: 0 % → 43 % das janelas iguais. (4) Apresentação/andar humano: `case "move"` de quem o porte comanda não passa
mais pelo `walkTo` (que reescrevia IA+8/IA+0xa), só pelo despachante; classe +0x50 = 1 com IA+8 = 0/0xb a meio passo ou 6 = "move";
o fim de caminho do exe (classe ≠ 1) = "none"; destino fora da área útil (fuga para IA+0x9c = 0) limitado como no `walkTo` [est].

**Missão 77** (falha 7 = gatilho "Zombie 59 attack?"): três causas. Bit 0x1000 (+0x144) não vinha do buff `spell: "ritual"`
(syncCombat agora põe pelo tipo `invisible`); o `hold()` do teste dava `none` (os necromantes do jogador 1 seguiam o grupo antigo) →
`hold` como a interface; a invisibilidade do ritual é [est] de `mission/setup.ts` (não é mecânica do exe: 0x567a16 vê o invisível a
distância ≤ IA+0x71, e os zumbis têm 2–8) → na World, enquanto houver ritual, IA de IA+0x71 = 0 e quem faz o ritual não age. 39/39.

| | m10_start | m10_mage | m20_start | golden limpas |
|---|---|---|---|---|
| 9, lote 1 | 87,9 / rand 93,6 | 87,2 / 92,8 | 87,9 / 99,5 | 63,08 |
| 9, lotes 2–4 + harness | **97,4 / 99,6** | **96,7 / 98,9** | **98,5 / 99,8** | **63,40** (era 32,98) |
tickcmp resíduo (1.ª divergência): m10_start `task|1` T=305, `g_assigned/target` T=609, `post|1` T=49 (posto IA+0), `rng` T=737;
m10_mage `act` T=242 (magia do herói, 8b), `rng` T=394, `post|1` T=113, `hit_clock16` T=843; m20 `post|1` T=19, `task` T=623, `target` T=455.
**test:sim inteiro verde (30/30; 4.ª sessão, 28/10).** Correções de integração: (1) save — grupos/jogadores do exe no `MissionSnapshot`
(`World.exeGroupsToJson/FromJson`, `snapshot.exeGroups`; registros por índice, comando já aplicado, próximo endereço), todos os
campos escalares da unidade/andar/IA (`recio.scalarFields`), +0x42 das estruturas (`MapRecJson.sf`), livro+0x18, escalares do mundo
(+0xa4c...); sem eles o restore reaplicava o comando do script (0x56d6b7 → Vision_Compute) — `resetWorld` preserva IA+0x20 da corrida
[est: harness; o do tique 0 derruba o tickcmp m10_start 97,4 → 96,3 %]. (2) Magia nos pontos do exe: 0x57a769 escolhe pelo motor
antigo e termina em AI_CastAtTarget 0x56c72b (tarefa 8); 0x56cb8c/0x56cef3 terminam em AI_TeleportCast 0x56969c/AI_MoveTo
(`World.fleeTask`); 0x519998 põe +0x138 = relógio (0x5041d6/0x5042ba: sem isto a regeneração triplicava); livro espelhado com as
magias de chance (0x56a981 as busca no livro), Curse/Slow (CArray > 28), assinatura do conteúdo (`bookSig`); `spellFor` prefere a
definição da própria unidade (o mapo é do módulo). (3) Tabela de classes +0xa54 desde o construtor (ordem antes do 1.º tique dava
custo 0xffffff); grupo que troca de dono sai da lista do dono antigo (pensava 2×/tique); +0x148 zerado no morto (0x510a70);
`helpless` (reféns "vida 0") fora do AI_EnemyFilter want=0 [est, marcado]; `packCount` conta o ouro carregado [est]; Guard do herói de
volta ao `heroLegacy`. Testes atualizados com endereço: ogro visão 5 (0x552c28), grupo partilha alvos (0x571c4d/0x57240b), recuo =
AI_MoveTo, área útil (0x559536), sangria ≡ 13 mod 64 (0x52bbb7), corpo 24–28 s, `hit` só > −10 (0x516c1f), dragão da 80 (0x569b62 →
0x57a999), Dina/druidas (0x56c592), `unstone` tira toda a Stone Curse (bit 0x40000 prendia em 0x56dca2), espera de 2 s da armadilha.
Placar antes → depois: snapshot 11→0, saveroundtrip 26→0, wimpy_mage 49→0, ai 11→0, downed 8→0, necro 5→0, spell_selected 3→0,
formulas 1→0 (+ manaRegen no boneco), missions_80s 1→0, missions_90s 3→0. tickcmp 97,4 / 96,7 / 98,5 % (igual).

**Golden `--ci` (5.ª sessão, 28/10): as 13 assinaturas classificadas janela a janela.** O diagnóstico anterior (`hp|t69` = espera da
arma fora do traço) estava ERRADO: era ordem dentro do tique. Correções (todas com `--show`/rastro tique a tique do registro):
(c) ordem do laço 0x52b459: a lista [0x68d2dc]+4 começa no HERÓI nos despejos m10/m20; refeita sem despejo (janelas do golden,
`exeSyncWorld`) o herói ia por último e quem o perseguia media 0x55532d/AI_UnitDistance com o passo dele por acabar (fino 129 × 128:
distância 1 × 2) — resolve `hp|t69` ×6, `pos|t75` ×3, `alive|t75` ×2, `alive|t69`, `alive|t74`, `alive|t103|orig_dead`, `hp|t76`,
`pos|t103` (17 janelas; golden 63,4 → 68,8 %). (b) importação: +0x136 (vem no traço) não era copiado nas unidades com par — o golpe
acabado seguia direto para o próximo (0x56dca2 só larga a sub-ação 1/2 com IA+0x15 > 2 E +0x136) → `alive|t103|ours_dead` (IA+0x15
derivado [est]); a caída (vida < 0) ficava na célula da janela anterior (placeExact) → `target|t75`. (b) integração: com o alvo morto o
motor antigo largava a ordem do lado humano (`resumeOrNone`); no exe a classe/tarefa ficam até o despachante/pensamento → `task|hero`,
`target|t75`; o Guard do script num aliado do jogador (m10_mage, unidade 2) agora vai ao grupo dele (comando 1, 0x57275f), uma vez por
unidade (`humanScriptCmd`, no save) — por grupo, o reagrupamento das ordens do cliente o reaplicava (Putnik da missão 53 parado).
Sobram 2 assinaturas, 4 janelas, regravadas na referência: `target|t69|o:hero/n:none` ×3 (m20_start_s30 560/800, m20_mage_s410 880)
= (a) logo depois do pensamento que dá a tarefa 5, o fim de caminho de 0x56dca2 (andar+0x98) a larga no mesmo tique no nosso; no
original a perseguição dura 4–8 tiques. Posições iguais ao traço: o que difere é a ocupação/pegadas do MapRec refeitas sem despejo
(`exeResync` [est]) e os contadores do andar — a janela não traz o MapRec. `target|t76|o:none/n:hero` ×1 (m10_mage_s23 720) = 8b:
o cajado da maga (arma que lança magia, 0x53a5a0 → Fire Arrow do motor antigo) avisa o alvo (0x56e6b8) no lançamento (721); o original
no impacto (~726–728), e o grupo atribui o herói um pensamento antes. Golden 71,7 % limpas (ref. 63,08); tickcmp 97,4 / 96,7 / 98,5 %.
Arquivos do commit: package.json, sim/{ai,world,rng,snapshot}.ts, exe/{mapbuild,mfc,rand,types,think,vision,tasks,orders,recio,
action}.ts, test/{exe_recon,import_state,exe_think,exe_tasks,exe_orders,missions_70s,diff_window,ai,necro,missions_90s,pilot,downed,
formulas}.ts, de test/missions_80s.ts só o dragão e Tekel (+ o import de TICKS_PER_SEC que eles usam), tools/re/{port_status.tsv,
known_functions.json,oracle/dump_ticks.py}, esta nota.
