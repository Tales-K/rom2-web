# O despachante inteiro (etapa 7, 2026-10-27)

Briefing: `docs/briefings/ETAPA7-DESPACHANTE.md`. Código: `game/src/sim/exe/action.ts` (cabeçalho), `rand.ts`, `mfc.ts` (CListEvent, CListWord.find, CListPtr.remove), `types.ts`; integração em `world.ts` (cabeçalho). Prova: `game/src/sim/test/exe_walkaction.ts` (pares dos 3 episódios, sorteios conferidos por contagem e semente final). Commits: 6608fb8 (lote 1), c0035f0 (lote 2), lote 3.

## Desenho (ganchos)
- Toda tarefa IA+8 que o corpus alcança roda no despachante portado `0x56dca2`: 1 andar, 2 golpe, 4/5 perseguir e atacar, 6 atacar parado, 8 magia na unidade, 10 girar, 0xb olhar em volta; sub-ações 1 (golpe), 2 (magia, com o evento mundo+0xbd98 → lista +0xbbec), 3 (passo), 4, 0xff; cauda: fim de caminho (0x56dc24, patrulha pela lista [IA+0xb4], 0x56ed4e). `NotPorted` só nas tarefas com exec = 0 (7, 9, 0xc, 0xf); a 9 (andar com `near`) tem adaptador (`DispatchHooks.task`), o único que sobrou.
- **Efeito do golpe/magia** (Unit_ActionMachine 0x50f12c, não portada): `World.dispatch` chama `strikeBegin`/`castBegin` no tique em que a sub-ação 1/2 nasce (IA+0x15 = 0, logo depois do despachante — o ponto em que o exe entra na máquina) e `progressAttack` marca +0x136 (pronto) ao acabar; o despachante solta o pedido em E+1 e a tarefa volta em E+2, como medido (unidade 24590 da m10_start: 0x56e8c3 em T=259, pronto em 273, IA+9 = 0 em 274). A magia no chão (tarefa 9) continua no motor antigo. Magia/magia de chance no lugar do golpe (0x56b059/0x56acc8, decisão do pensamento no exe) entra no gancho do golpe e vira sub-ação 2.
- Olhar em volta: IA+8 = 0xb entra no pensamento (0x56afd9) para a ociosa de jogador de IA; golpe recebido marca IA+0x54 (0x56e6b8). Sorteios pelo `Rng` do motor via `WorldRec.rng` (0x57afc0/0x57afd0 em `rand.ts`, sítios 0x56e629/0x56e656).
- Listas do exe mantidas pela World: unidades vivas (mundo+4, refeita por tique na ordem de criação; no tique importado vem do despejo), tipo+0 (unidades do mesmo modelo [est: ou do mesmo dono?]), diplomacia +0xa8bc (bit 0 = guerra, por tique), patrulha [IA+0xb4] (A = posto, B = ponto do script, ao dar a ordem), eventos +0xbbec (esvaziada no pensamento, 0x57485b).
- [est] no motor antigo: o alvo que o fim de caminho não alcançou fica 5 s fora de `nearestEnemy` (`Unit.unreachTarget`; o exe guarda o segundo em IA+0x16 e o grupo pesa de outro modo) — sem isso o zumbi da missão 102 re-escolhia o mesmo aldeão atrás da cerca a cada pensamento.

## Apagado
`idleLook`, `lookTurn`, `lookFlag`, `LOOK_OFF`, `lookLog`, `look_wait` (import), `actRelease`, `chaseUnit`, `inRange`/`turning` do alvo unidade, os adaptadores `f56dc24`, `patrolNext`, `f56ed4e` e os casos 5/8 do `task`; `progressAttack` não vira mais a unidade para o alvo (o exe não vira no golpe).

## Números (antes → depois; tickcmp = tiques com estado inteiro idêntico nos 3 episódios; rand = mesmo nº de sorteios por tique)
| | m10_start | m10_mage | m20_start | golden limpas |
|---|---|---|---|---|
| etapa 6 | 38,5 % / rand 83,9 | 32,6 / 82,1 | 32,3 / 86,6 | 54,62 % |
| lote 1 (olhar em volta) | 69,8 / 92,8 | 73,3 / 92,7 | 73,8 / 98,3 | 54,92 |
| lote 2 (golpe/magia) | 75,9 / 92,8 | 77,1 / 92,7 | 77,2 / 98,3 | 56,74 |
| lote 3 (fim de caminho) | **82,0 / 92,8** | **82,4 / 92,7** | **82,0 / 98,8** | **56,89** (342 janelas melhores, 2 piores vs a referência de 34,04 %) |
Pares: 0x56e5bc 57 358, 0x57afc0 1 416, 0x57afd0 694, 0x56eab5 746, 0x56e8c3 119, 0x56eff3 8, 0x56ebc0 5, 0x56e906 5, 0x56dbc6 8, 0x56d969 181, 0x53a5a0 222, 0x57b210 257, 0x56ed4e 12, 0x567ddf 1 516, 0x567a16 1 770, 0x55aa21 497, 0x54fb7f 396, 0x57994d 429, 0x57b020 6, 0x53afb0 824, 0x44fc20 507, 0x56dca2 31 910 (100 %, nenhum ramo NotPorted alcançado). Golden `--ci`: falha por assinaturas de combate reaparecidas (`alive|t69|orig_dead` ×3, `alive|t75|ours_dead`, `target|t1|o:unit/n:unit`): vida/morte, fora desta etapa; sem `--rebaseline`. Janelas piores: m10_start_s424@720 (`target|t75|o:hero/n:none`: o monstro escolhe o herói no pensamento do grupo, 0x57240b) e m20_start_s414@560 (`pos|t103|o:parado/n:anda`: fim de caminho do 24662 um pensamento antes). `0x56e629` consumido a 99,55 % (7 834 faltas, todas +1 tique: o exe põe 0xb um tique antes do nosso pensamento nas janelas derivadas).

## Resíduo por campo (tickcmp, com endereço)
- `act` (6–10 % dos tiques; `dir16` 1–6 %): golpe em curso importado sem a máquina (ação 3 com `act_phase` 0 ou magia 0xd/0xe: 0x50f12c não portada → `act` 3 ≠ 0; ex. 24592 T=363, 24590 T=272) e o pensamento (0x569321/0x56acc8: não portado) que troca de alvo/tarefa em tiques ≡ 7 (herói T=289: `act` 1/`target` 24591 no original).
- `task`/`target` (~5 %): o pensamento da IA (0x570087 → 0x57240b AI_GroupAssignTargets, 0x5728fa) e o tratador de mensagem do cliente (ordem repetida zera IA+8/andar+0x7c) — etapa 8.
- `rng` (7 % m10, 2 % m20): sorteios do pensamento (0x57a769 AI_CasterOffensiveSpell, 0x572718/0x57274d raio do grupo) e do dano (0x5170f8/0x5170d3) fora do despachante; 0x56e629 consumido a 99,6 % (faltas +1 tique: unidade que o exe põe em 0xb um tique antes do nosso pensamento).
- `hp`/`mana`/`alive` (1–3 %): combate e magias do motor antigo (Unit_PhysicalDamage 0x516f6f, Spell_Apply 0x519db8).
