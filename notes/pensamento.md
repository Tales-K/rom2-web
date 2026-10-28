# O pensamento da IA, a regeneração e as ordens do cliente (etapa 9, 2026-10-28)

Briefing: `docs/briefings/ETAPA9-PENSAMENTO.md`. Regras: skill `port-exe`. Lotes: (1) regeneração e laço de 1/s; (2) pensamento do
jogador e do grupo; (3) tarefas da unidade; (4) visão e `Server_PacketDispatcher`. Cada lote é commitado e anotado aqui.

## Lote 1 — regeneração 0x50fc5a e World_SecondTick 0x52bbb7 (feito)
Código: `game/src/sim/exe/regen.ts` (`unitRegen` 0x50fc5a, `vt14`, `worldSecondTick` 0x52bbb7), `rand.ts` (`randOne` 0x51fa4e),
`mfc.ts` (`CMapU32` = CMap<uint,uint> 0x545780/0x5457e0/0x545820/0x5459d0/0x545a60/0x545ad0/0x545b50/0x53d920/0x53d940, hash 0x4a1120:
`out`), `types.ts` (+0x98/+0x9c/+0x9e/+0xa2/+0xa3/+0xde/+0xe2; `UnitListsRec` = o contentor [0x68d2dc]: +4 todas as unidades na ordem
de criação, +0x24 criadas por magia = [0x672f64]+4, +0x44 cadáveres = [[0x6044c4]+0x7c]+0xc+4; `WorldRec.lists`). Prova:
`test/exe_regen.ts` (100 %: 0x50fc5a 1 720 + 1 800 + 2 506 = 6 026, 0x52bbb7 60 × 3, 0x51fa4e 3; pares gravados com
`fnprobe.py <ep> 0x52bbb7 0x51fa4e --verify 10`). `port_status.tsv`/`known_functions.json` atualizados.

**Ordem do tique (medida nos pares contra o despejo).** `Server_Tick 0x4f08c0` chama `0x52bbb7` no tique em que `[[0x6044c4]+4]`
(PRÉ-incremento) ≡ 0xc mod 16 — a regeneração lê o relógio 28 e a máquina 0x50f12c do MESMO tique lê 29 — logo antes de
`Server_ClockTick` e das máquinas. Na `World`: `absClock16() % 16 == 13` (o nosso relógio já é o pós-incremento), com
`EXE_GLOBALS.clock16` recuado de 1 durante a chamada; bloco antes do laço das unidades (`stepCorpses`/`stepSummons`/`regen` apagados).
O contador de 1/s `[[0x6044c4]+0]` é exatamente ⌊relógio de 16/s ÷ 16⌋ (no despejo `tick` = ⌊(t16 + 1) ÷ 16⌋ com `t16` o pré-incremento
do tique seguinte): `World.secClock()` passou a ser isso; `secPhase`/`secBase` e a âncora "≡ 13" do importador sumiram (a antiga ficava
+1 em 13 das 16 fases — ver o resíduo abaixo). A trava `contador % 4 == id % 4` usa +4 = o id do ORIGINAL (`regenSlot`) nos estados importados.
**Dentro de 0x52bbb7**: vtable+0x14 (= Unit_Regen nas 3 vtables) por toda a lista `all` (caídas incluídas: a sangria −1 a cada 4 s é
o ramo vida < 0); Corpse_Decay 0x5110b8 pela lista `corpses` (uma unidade morta sai de `all` e entra em `corpses`); desgaste das invocações
pela lista `magic`: CMap<uint,uint> invocador (+0x148) → contagem, iterado na ORDEM DOS BALDES (hash = endereço >> 4, % 17; dentro do
balde do mais novo ao mais velho) com Rand_One(100) < contagem → marca; depois a 1.ª invocação dele em `magic` morre por Unit_Die (gancho
`died`: queda da apresentação + `consumeDeath`). Os 3 sorteios do corpus (m10_mage) batem.
**Regeneração**: `k` = 3 quando 0x50fc3e (relógio − +0x138) > 0x50, senão 1; vida: v = vida×100 + resto(+0xa2) + (máx×2×(bônus+100)×k)/período,
resto = v % 100, vida = min(v/100 como short, máx) — TUDO em int com sinal e o resultado truncado a short: uma unidade com 32 767 de vida
máxima que leve qualquer golpe regenera para NEGATIVO (como no exe) — os testes "imortais" (100 000 PV) passaram a zerar `healthRegen`
(`pilot.ts immortal`, `missions_90s.ts`, `ai.ts`, `necro.ts`, `m110_probe.ts`); mana: todo segundo, sem a trava % 4, divide pelo período
+0x9e sem testar 0 (`Error` na porta; os dados não têm mana sem período). `Unit.mana`/`maxMana` viraram vistas sobre +0x9a/+0x9c;
`syncCombat` grava +0x98/+0x9e dos `stats` (bônus 0) fora do estado exato; snapshot leva os 7 campos (`recio.ts UNIT_KEYS`).
**Despejo/importação**: `dump_ticks.py` grava agora +0x98/+0x9c/+0x9e/+0xa2/+0xa3/+0xde/+0xe2/+0x138 e as 3 listas do contentor
(ids na ordem da lista: o despejo das unidades é por id, não pela lista); os 3 episódios foram regravados (`--check` idêntico).
`unitRecFromOrig` os importa; a importação derivada (janelas do golden) põe +0x138 = agora [est: como o `lastActionTick = 0` antigo].
Apagados: `World.regen` (fórmula medida), `secPhase`/`secBase`, `regenAcc`/`manaAcc`/`lastActionTick`, `necro.ts stepCorpses`/`stepSummons`;
o veneno ficou em `poisonTick` (efeito do motor antigo).

Números (tickcmp = tiques com estado inteiro idêntico; rand = mesmo nº de sorteios por tique):
| | m10_start | m10_mage | m20_start | golden limpas |
|---|---|---|---|---|
| 8a | 86,9 % / rand 93,6 | 85,1 / 92,8 | 85,5 / 99,5 | 61,55 (ref. do `--ci`: 61,14) |
| 9, lote 1 | **87,9 / 93,6** | **87,2 / 92,8** | **87,9 / 99,5** | **63,08** (21 janelas melhores, 2 piores; `--ci` código 0) |
`hp`/`mana` por campo: m10_start 100 %; m10_mage `mana` 99,5 (hero T=242: o original lança a magia, nós não — pensamento, lote 2/8b) e `hp`
99,7 (24611/24609: dano de magia da maga); m20 `hp` 99,9 (24603 T=612: golpe). Golden: `hp|hero` 38 → 36, `mana|hero` 6 → 7; assinatura
reaparecida ×1 `pos|t103|o:parado/n:anda` (m20_start_s106@880: a guarda do comando 0x12 em `ai.ts` compara `unreachSec` com `secClock()`
com limiares `< 10`/`< 30` afinados com o contador antigo (+1); com o contador exato a unidade 24610 foge e o original fica — resolve-se
com a porta de 0x5728fa no lote 2, não com retoque do limiar).

## Lote 2 — pensamento do jogador e do grupo (EM CURSO; porta provada, integração na World não verde — NÃO commitado)
Estado em 2026-10-28 (sessão cortada pelo limite de uso). Arquivos novos/alterados fora do commit d6de030 (lote 1): `exe/think.ts`,
`exe/vision.ts` (novos), `exe/types.ts` (grupo = `UnitTypeRec` com `UnitStatsRec` = dados +0x3c; `PlayerRec.groups/f32`; `WorldRec.players/
classTable/groupsByAddr/playersByAddr`, `liveUnits` = `lists.all`, `lists.structs`; IA +0x20/+0x24/+0x40/+0x44/+0x6c/+0x7c[3]/+0x88[3]/+0x9e/+0xa0;
unidade +0x88/+0xa5/+0x1a4/`hasBook`; andar +0x08; `CellStructRec.f42`; offsets da visão/setores), `exe/mfc.ts` (`CListPtr.first/nextAfter/getCount`),
`exe/rand.ts` (`randRange` 0x57aff0), `exe/mapbuild.ts` (tabelas da visão + área útil no MapRec), `test/exe_recon.ts` (grupos/jogadores
memoizados em `CallMem`, `GROUP_FIELDS`, listas percorridas pela cabeça), `test/exe_think.ts` (novo), `test/import_state.ts`, `world.ts`,
`ai.ts` (exports + `flee` desligável), `tools/re/oracle/dump_ticks.py` (+ `players`/`class_table` no despejo; episódios regravados).
**Prova (test/exe_think.ts): 100 % em todas as funções gravadas** (pares `fnprobe.py <ep> <lista de 38 endereços> --stride …`, ver o cabeçalho
do teste): 0x5728fa, 0x57240b, 0x571c4d, 0x5711ea, 0x5713f8, 0x5725a8, 0x57309d, 0x573198, 0x573159, 0x57377d, 0x573713, 0x56cb0c, 0x56cd11,
0x56c9bc, 0x56f765, 0x558b92 (x87 reconstruído), 0x56acc8, 0x56afac, 0x56afd9, 0x56b025, 0x56c8af, 0x567e92, 0x56fa63, 0x56f850, 0x5726f7,
0x57aff0, 0x552c28 (Vision_Compute, 189/189 na m20), 0x553681, 0x567988, 0x55b5f1, 0x55b879, 0x55aca2, 0x55b406, 0x570087, 0x5700f3 (os
que caem no gancho do lote 3 — 0x5692d5/0x56a1fb — ou das magias — 0x56b059/0x56bc7b/0x56c592 — contam à parte). `port_status.tsv` e
`known_functions.json` AINDA NÃO marcados para o lote 2.
**Achados**: Vision_UnitMap 0x553329 chama Vision_Compute 0x552c28 (a visão do lote 4 já está portada aqui); o "tipo" unidade+0x70 É o grupo
(0x5692d5 testa dono+0x2c; o comando da carga 0x12 em +0x20; +0x45 acordado; +0x48 sempre acordado); [mapa+0xa456c] = [0x68d2dc]; o jogador
humano vive em grupos criados pelas ordens do cliente (parado → comando 3, andar → 4, atacar → 0; grupo vazio → −1); 0x57485b é o SCRIPT
(0x574899/0x574ba1 → `out`, game/src/script); 0x57a307 (armadilhas) exec 0; 0x57a769 exec 0 (nenhum conjurador de IA ataca no corpus).
**Integração na World (feita, não verde)**: `exeThink()` no tique do pensamento chama `fn_0x56fe4d` com relógio recuado de 1; `exeGroups`/
`exePlayers` (`exeGroupSync` por unidade; comando por `exeGroupCmd`); `syncOrdersFromTasks` escreve a ordem a partir de IA+8 (sem passar por
`command()`); `thinkHooks` (unitThink = aiThink/heroThink antigos com `flee=false`, standGround, autocast, casterSupport, pickOffensive,
fuga por Teleport pelo `exeFlee` antigo); `thinkGroups`/`computeActiveGroups`/`activeGroups` apagados; `awake(u)` = +0x45 do grupo;
`exeApplyPlayers` no estado exato; bit 4 de +0x4c = tem livro (`syncCombat`). tickcmp ANTES das 2 últimas correções (ordem sem `command`,
tabelas da visão no mapbuild): 87,9 / 87,2 / 88,0 (`task` m10_start caiu para 93,0; `rng` diverge já em T=1 — sorteios do pensamento
diferentes: suspeitos `casterSupport` (0x57aad9/0x57ac98) agora chamado pelo padrão do exe (IdleAlt com bit 4) e o sorteio das magias de chance
0x56ad33 em 0x56acc8 duplicado com `rollProc` no golpe; ainda não medido depois das correções). Testes: mission10 2 falhas, mission20 10,
ai.ts 7 (kiting/recuo, Shield/autocast, cura do mercenário, "decisão no pensamento", alvo do grupo — este último era a visão sem tabelas no
mapbuild, já corrigido). **Próximo**: rodar `npm run tickcmp -- --all`, `--show` nas 1.ªs divergências (m10_start T=1 rng, T=97 herói), afinar
ganchos (`rollProc` só num dos lados; `casterSupport` só quando o exe chama 0x56c592), `test:sim` e golden verdes, marcar `port_status`
(ported: a lista acima; out: 0x574899, 0x574ba1, 0x574955, 0x55f220/0x55f240/0x57b140/0x57b160/0x57b120 MFC), commitar.
## Lote 3 — tarefas da unidade (a fazer)
## Lote 4 — visão e ordens do cliente (a fazer)
