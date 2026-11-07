# F2 etapa 2: largar o `syncCombat` do passo (2026-11-06)

Commits 94d69d7 (o passo sem `syncCombat`) e 21e09e3 (vida/mana máximas do herói na subida de nível).

## O que o exe faz (lido do C, `port_status.py show`)
- O recálculo dos atributos é a vtable+0x58 da unidade: 0x51366b (humanos/herói), 0x5118be (monstro). **Não roda a cada tique**: no
  corpus executa 4 vezes (`exec` = 4). Chamadores no C: 0x5128cb (experiência, só quando uma habilidade sobe de nível), 0x51d436
  (efeito põe/tira), 0x50f065 (carga), 0x5290cc/0x529392 (arma), 0x5145d1/0x513546 (criação), 0x5175fc (`#modify +god`), 0x561bf9
  (carregador). Entre um evento e outro, os atributos ficam no registro.
- 0x51ce12 (o efeito com duração entra na unidade) chama a vtable+0x40 do efeito novo (0x51d175 → 0x51d436 → vtable+0x58) **antes**
  do AddTail na lista +0x20.
- 0x5128cb: na subida de nível, +1 em +0xa8 + 2·esfera e vtable+0x58. O 0x51366b refaz vida máx. +0x96 e mana máx. +0x9c pela
  experiência total +0x130 (nível = log₁,₁(exp/5000 + 1)) e prende vida/mana ao máximo (sem proporção).

## O que mudou no mundo
- `World.step` não chama mais `syncCombat`. O motor antigo escreve os atributos no registro só nos eventos dele: nascer (`spawn`),
  restaurar (`syncRecs` e, por cima, os atributos salvos), buffs/auras/Invisibility do roteiro, invocação (`necro.ts`), IA montada
  (`installMissionAi`: o livro), inventário/pergaminho (`MissionScene`), console (`+god`), importação do oráculo (fim do `applyState`).
  A experiência do herói só mexe nas habilidades (`syncSkills`) e, na subida de nível, refaz os derivados (abaixo).
- Gancho `recompute` (vtable+0x58):
  - unidade com `exeBase` (o registro da criação portada `exe/create.ts`, que o carregador da 9b dá às unidades do mapa): a porta,
    `exe/effects.ts unitVt58` → 0x51366b / 0x5118be;
  - as outras (herói da campanha, companheiros, invocações, unidades dos testes, importações do oráculo): a ponte `syncCombat`, como
    antes, e de novo no fim do passo (só para quem passou pelo gancho), porque a soma da ponte lê a lista +0x20 e o efeito que está
    entrando ainda não está nela. Sem isso, 4 janelas do golden (m10_mage, Shield da maga: absorção +0xc0 sem o efeito) pioravam.
- Save: o golpe +0xa6.. (com +0xa8), as proteções +0xc2.. e as resistências +0xce.. entram no `UnitRecJson` (`cb`); no restore,
  `unitCombatFromJson` devolve o salvo por cima do `syncCombat` (a unidade caída tinha a defesa ÷ 2 do exe, e a ponte a refazia
  pelos `stats`).
- Subida de nível do herói: `World.heroSkillUp` (golpe, magia e experiência de apoio) → gancho `heroLevelUp` (`mission/setup.ts
  levelUpHero`: `heroDerived`, que já é a conta do 0x51366b, com a experiência de agora; vida e mana só presas ao máximo) → `syncCombat`.
- Testes que mudam `stats` por fora depois de nascer (`ai.ts` Stone Curse do Troll.4, `downed.ts` voador e `alwaysHit`) sincronizam
  com `w.syncCombat(u)`, como o console.

## Medidas (antes → depois)
| | antes (1221f5d) | depois (21e09e3) |
|---|---|---|
| tickcmp --all reancorada | 100,0 / 100,0 / 100,0 % | igual |
| tickcmp sem reimportar, 1.ª divergência | T=322 / nenhuma / 740 | igual |
| m10_troll_x1 sem reimportar | 2481; por campo dip@2481 hpmax@2795 manamax@2795 mana@2807 hp@2887 alive@2951 …, 14 de 30 unidades divergem | 2481; **só dip@2481**, 1 de 30 |
| m10_hydun_x1 / m10_ogre_x1 sem reimportar | 2337 / nenhuma | igual |
| golden --ci | 79,74 % | 79,74 % (CI ok; mesmas regressões contra a referência de 79,43 %) |
| loadcmp --no-map / com MapRec | 46/46 / 44/46 | igual |
| test:sim, test:script (49/49), typecheck | verdes | verdes |

## O que sobra (resíduo nomeado)
- **m10_troll_x1 reancorada, T=2795** `hpmax|1`/`manamax|1` (1 tique): a importação do oráculo não traz a experiência por habilidade
  (o despejo só tem a total +0x130 e os níveis), então o passo reancorado não sobe de nível. Na corrida sem reimportar é igual ao original.
- **O caminho `exeBase` não é medido pelo tickcmp nem pelo golden**: as unidades importadas do oráculo e as janelas do golden não têm
  os atributos-base (+0x84..+0x8a), o bônus +0xd4.. nem a experiência no despejo. Para medir: `dump_ticks.py` exportar os bytes
  +0x84..+0x140 do registro, o importador montar o registro inteiro (`exeBase` = verdadeiro) e o gancho largar a ponte nelas. Hoje
  ele roda nas missões carregadas pelo nosso carregador (test:sim verde).
- **A ponte ainda existe**: o herói da campanha, os companheiros e as invocações nascem pelo motor antigo (`statsFor`/`heroStats`) e não
  têm o registro da criação portada. Para largá-la de vez falta a criação do herói pelo exe (atributos, itens pelo 0x5290cc/0x52846b/
  0x527a13, experiência +0x23c/+0x130) e a experiência portada (0x513128 Unit_XPOnHit e 0x5128cb, com o x87 do assembly;
  0x512f44, 0x542770, a tabela de abates +0x1a8), que substituiria `gainExp`/`levelUpHero`.
- `World.recomputeLater` (a ponte no fim do passo) sai junto com a ponte.
- Medido no despejo do m10_troll_x1: em T=2982 a mana máx. do herói vai de 101 a 102 sem subida de nível (a experiência fica em 8676),
  depois da 1.ª divergência (dip@2481). Não investigado.

# Fila da F2 depois do syncCombat (2026-11-06, mesma sessão)
Itens de `notes/bugs-2026-10-31-fase1.md` D/E, um commit cada, sem push.

| commit | item | o que mudou |
|---|---|---|
| f0e910e | 1. corrida livre do tickcmp | parte de `worldFromState(base)` (mundo novo), não do mundo da reancorada depois do `resetWorld` |
| bed8887 | 2. duração da queda | registro: modelo[0x21] do data.bin (`UnitStats.fallTicks`, `dyingTime`) na vtable+0x74 do monstro (0x50f048); era a animação (piso 14) |
| 22f4546 | (achado do item 2) | a vtable+0x58 do herói do motor antigo refaz vida/mana máx. pela experiência em TODO chamador (o Shield em T=1559 do m10_quest_x1 sobe a mana máx. 99 → 100 sem subida de nível) |
| 8082c8d | 3. script (parcial) | infraestrutura do script no pensamento (gancho 0x57485b, `World.scriptThink`, `ScriptRuntime.external`), desligada |
| — | 4. "Challenge winned" cedo | não começado |

Medidas (antes = 7d03d59; depois = 8082c8d):
| | antes | depois |
|---|---|---|
| tickcmp --all reancorada | 100,0 / 100,0 / 100,0 % | igual |
| tickcmp --all sem reimportar | 322 / nenhuma / 740 | **nenhuma / nenhuma / 740** (m20: mediana por unidade 775 → 793) |
| m10_quest_x1 sem reimportar (tickcmp e free_run.mts) | 1428 `rng` (sorteio do saque) | **1985 `dip|5,1`** ("Challenge starts", item 3) |
| m10_troll_x1 / m10_hydun_x1 / m10_ogre_x1 sem reimportar | 2481 / 2337 / nenhuma | igual |
| golden --ci | 79,74 % | **79,99 %** (0 janelas piores, 6 melhores) |
| loadcmp --no-map / com MapRec | 46/46 / 44/46 | igual |
| test:sim, test:script (49/49), typecheck | verdes | verdes |

O item 1 não mudou nenhum número (a livre do m10_quest_x1 já dava 1428 inteira e com --max 1500, igual ao free_run.mts); o free_run.mts
cai na m20 (`simcore` → `exeRebuildLists`), problema da ferramenta do espelho, não mexido.

## Script no pensamento (item 3, ligado em 973b145), item 4 e o free_run (2026-11-06, mesma sessão)
| commit | o que mudou |
|---|---|
| 973b145 | o script roda no pensamento (0x56fe4d → 0x57485b, 1×/s) com as distâncias de Chebyshev (valores 6, 7 e 15); sai o [est] do ritual da m77 |
| 6425a75 | item 4: a unidade caída conta no grupo e no jogador até a morte se consumar (0x52b459: ação 0x10 → 0x51618e) |
| 1e9100f | free_run.mts / espelho: `resetWorld` antes de aplicar o estado e `exeExact` só no 1.º passo (a m20 caía; o espelho nunca saía do estado importado) |

Evidência da m77 (antes de mudar os testes): o script não tem ação de invisibilidade; o exe só a dá pela magia, e o autocast 0x56bc7b
só lança Invisibility no nível 3 do AutoCasting (bit 0x20, "Maximum"; o padrão do New Game é 0x19). O buff de 16 s de `setup.ts`, o
IA+0x71 = 0 e a parada forçada em `world.ts` eram [est] nossos e saíram. A guarda (grupo 24) fica em campo enquanto 10 <= v73 < 20 =
10 ciclos = 10 s. O roteiro que o script pede: afastar os dois necromantes a <= 15 do túmulo, fora da vista da guarda (8 a 10), e trazer
o bom de volta depois que ela sai (falas 11 e 13 com v73 > 20). Medido no nosso sim sem o [est]: guarda de v73 = 10 a 19, Mission
Complete. Não gravado no original (o roteiro inteiro da m77 no oráculo é longo; fica como conferência futura).

Testes ajustados pela conta do script (o porquê está em cada um): m77 (ritual), m74 (o 1.º ciclo é o do 1.º pensamento), m85 (v72 > 15 =
~15 s), m101/m102 (2 ciclos; a Dina chega a Chebyshev 4 do druida e a conversa v71 é dela; contador de 5 ciclos), m41 e m32 (Chebyshev),
m63 (2 ciclos), m9x (o necromante some numa diagonal, Chebyshev).

| | antes (358f84c) | depois (1e9100f) |
|---|---|---|
| tickcmp --all reancorada / sem reimportar | 100/100/100; nenhuma/nenhuma/740 | igual |
| m10_quest_x1 sem reimportar | 1985 `dip|5,1` | **2416** `hpmax|1` (o `dip` sai da lista de campos) |
| m10_quest_x1 a partir do estado 4000 (free_run) | "Challenge winned" em 4048 (original 4066) | **4066** |
| m10_troll_x1 / m10_hydun_x1 / m10_ogre_x1 sem reimportar | 2481 / 2337 / nenhuma | **nenhuma** / 2337 / nenhuma |
| free_run.mts --mode import (m10_start, m10_mage, m20, quest, troll) | nenhuma, nenhuma, **erro**, 1985, 2481 | nenhuma, nenhuma, 740, 2416, nenhuma |
| golden --ci | 79,99 % | 79,99 % (CI ok) |
| loadcmp --no-map / com MapRec | 46/46 / 44/46 | igual |
| test:sim, test:script (49/49), typecheck | verdes | verdes |

Resíduo: m10_quest_x1 T=2416 `hpmax/manamax|1` 42/100 × 43/101 (a próxima subida de vida/mana máx. do herói); a partir de um estado do
meio (free_run --from) o script recomeça sem as variáveis (v71 etc. não vêm no despejo) — artefato da importação.

# Passagem (2026-11-06, fim desta sessão): o que está no main e o que vem a seguir
No main: 94d69d7 .. 4ca65f7 (push feito pelo coordenador) + esta passagem. Árvore: só as mudanças alheias de antes (setup.ts, host.ts,
behaviors.ts, testes de missão, ...); `mission/console.ts` (não versionado) tem 1 linha minha (`w.syncCombat(u)` depois do `+god`).
Medidas de referência agora: tickcmp --all 100/100/100, livre nenhuma/nenhuma/740; m10_quest_x1 livre 2416; m10_troll_x1 nenhuma;
m10_hydun_x1 2337; m10_ogre_x1 nenhuma; golden --ci 79,99 %; loadcmp 46/46 / 44/46; free_run.mts igual ao tickcmp nos 5 episódios.

## Item 1 da fila nova: resíduo T=2416 do m10_quest_x1 (hpmax/manamax do herói 42/100 × 43/101) — diagnosticado, NÃO corrigido
No original, em T=2417 a habilidade de fogo do herói sobe 20 → 21 (experiência total +0x130 = 8048) e o 0x51366b refaz 43/101. No nosso
ela não sobe: a experiência do herói é do motor antigo (`World.gainExp`/`supportExp`, ganchos `xpOnHit`/`xpOnCast`) e fica para trás.
Sonda (simcore, corrida sem reimportar), ganho acumulado desde T=0, original × nosso:
| tique | original | nosso | o que é |
|---|---|---|---|
| 693, 1558, 2106 | +8 cada | 0 | magia de apoio (Shield da maga; em 1559 o Shield entra): o 0x5131ef dá, o nosso `supportExp` não |
| 1303, 1429, 1464, 1497 | +28, +19, +17, +21 | 0 | golpe que mata (Bone Snakes): o nosso `hookXp` exige `t.alive` depois do dano |
| 1326..1558 (golpes comuns) | +8, +9, +9, +11, +11, +8, +10, +6, +6, +4 | +7, +8, +4, +10, +10, +1, +9, +3, 0, 0 | fórmula aproximada (`gainExp`: base × (Mind/30 + 0,25) × 10/(n+10), ÷8 fora do alinhamento) |
| 2259.. | iguais (+59, +54, +50, +45, +79, ...) | iguais | |
Total em 2417: original 8048, nosso 7901 (falta 147 = 139 dos ganhos + 8 da experiência inicial: a importação dá ao herói a experiência
padrão por escola de `heroFromState`/`heroStartSkillExp`, 7320, e o despejo tem só o total 7328 e os níveis).
**Correção certa: portar a experiência do exe** (lote próprio, x87 do assembly): 0x513128 Unit_XPOnHit (out hoje; o `CRT_ftol` sem
argumento = conta perdida no C), 0x5128cb (vtable+0x64; pending, exec 31: a tabela de abates +0x1a8 por tipo 0x41e1d0/0x402880, ÷8 fora
do alinhamento +0x23c, 0x512f44 teto por nível, +0x23c/+0x130, subida → vtable+0x58), 0x512f44 (pending, exec 31), 0x542770 (pending,
exec 31), 0x5131ef (experiência pela magia; out, "x87 perdido"). Pares do oráculo: `fnprobe.py` nos episódios com imagem (exec 31 no
corpus). Depois: `gainExp`/`supportExp`/`hookXp*`/`killsByType` saem, o herói passa a ter +0x23c/+0x130 no registro (hoje 0), e
`recomputeHero` lê +0x130. Para a reancorada/free_run --from: o despejo precisa trazer +0x23c (experiência por escola) e +0x130
(`dump_ticks.py`), senão a importação continua com a experiência padrão.

## Itens 2 e 3 da fila nova (não começados)
- Resto da 8b: áreas de dano, Fireball, Wall of Earth, Teleport, Summon, Animate Dead, Drain Life, magia de chão da IA (Darkness: o
  resíduo T=2337 do m10_hydun_x1), dano de área em estruturas (#94). Provar com pares do oráculo ou `tools/re/oracle/synth_spells.py`.
- Armadilhas do MapRec (m76, m93): 0x55a96c Unit_TeleportTo, o conjurador 0x4f06ac e dependências (0x4f0832/0x4f086f, 0x51c29e,
  0x50dc2b, 0x519466, 0x51906d, 0x53a600), 0x55ba36 + 0x55b978 (registro +0x34) e tirar a imitação `setTrap` do host (carga e "Set trap"
  0x57847e). Meta: loadcmp com MapRec 46/46. Ver `notes/carregador.md` "Lote 3c".
- Se a m77 for mexida de novo: gravar o trecho do ritual no original (o veredito de 973b145 é pelo C e pelo script).

## Dicas de ferramenta desta sessão
- Commitar só os próprios trechos: montar o arquivo a partir do `git show HEAD:<arq>` com as mesmas trocas (âncoras ASCII ou lidas do
  arquivo: os acentos de um heredoc não chegam iguais ao Node neste shell) e `git hash-object -w --path=<arq>` + `update-index --cacheinfo`.
  Vários testes de missão estão em CRLF na árvore.
- `test:sim` leva ~7 min; os arquivos de teste rodam soltos com `npx tsx src/sim/test/<arq>.ts`.
- Sonda de experiência/estado sem reimportar: `simFromImport` + `step` do `tools/refcap/mirror/simcore.mts` (lendo
  `refs/golden/episodes/<id>/` e `refs/oracle/ticks/<id>.jsonl.gz`, com `prepState`).

# Atualização da passagem (2026-11-06, depois de ce2bb7c): item 1 da fila FECHADO
**Experiência do exe portada** (ce2bb7c; `game/src/sim/exe/xp.ts`, prova `game/src/sim/test/exe_xp.ts`, no `test:sim`): 0x513128
(vtable+0x6c), 0x512fcb (vtable+0x68, chamada no `consumeDeath` como o 0x52b459 da morte consumada), 0x5131ef (vtable+0x70), 0x5128cb
(vtable+0x64), 0x512f44, 0x542770 — 195 pares do oráculo iguais (m10_start, m10_mage, m20_start e m10_quest_x1 até 4070: subida de nível
de T=2417 e a morte do Troll1). Saíram `gainExp`/`heroSkillUp`/`hookXp*`/`killsByType` (o `supportExp` ficou só como ponte para o
0x5131ef nas magias que o motor antigo ainda resolve).
Achados (com evidência do original):
- [0x6044c4]+0x74 = 0 no jogo de um jogador (pares dos 4 episódios): `EXE_GLOBALS.f74` era 1 por suposição desde a 8a (o teto do
  ganho saía ÷ 5; também muda `death.ts:115` e `spells.ts:564`, que usam o mesmo campo).
- +0x4c bit 2 = humano com mana (o herói do oráculo tem 6): o Spell_Apply só chama a vtable+0x70 com ele (os comentários diziam
  "sem o bit 2"); o `syncCombat` o liga nos humanos do motor antigo com mana.
- +0x1a0 = bandeira 8 (sem experiência) da unidade do .alm (0x561bf9: +0x194/+0x198/+0x19c/+0x1a0 = bandeiras 1/4/2/8); o Hydun e os
  morcegos da m10 têm 1 no oráculo (também tira o saque deles em 0x510a70).
- O herói precisa de +0xe 0x21..0x24 no registro (era o `typeId`, 0) [est: 0x21 + 2 × mago + mulher; a Dina, maga, é 0x24].
- `dump_ticks.py` exporta +0x23c e os abates (só humanos: o registro do monstro é menor — ler +0x23c dele derrubava o despejo); os 9
  despejos de `refs/oracle/ticks/` foram refeitos.
| | antes (af994fa) | depois (ce2bb7c) |
|---|---|---|
| m10_quest_x1 sem reimportar | 2416 `hpmax\|1` | **4469** `act\|24599` (a IA do Hydun em guerra); +0x23c do herói igual ao original do início ao fim |
| m10_quest_x1 / m10_troll_x1 reancorada | 99,1 / 99,4 % | 99,4 / 99,5 % |
| m10_troll_x1 / m10_hydun_x1 / m10_ogre_x1 livre | nenhuma / 2337 / nenhuma | iguais |
| tickcmp --all, golden --ci, loadcmp | 100/100/100 (nenhuma/nenhuma/740), 79,99 %, 46/46 e 44/46 | iguais |
| test:sim, test:script (49/49), typecheck | verdes | verdes (test:sim com exe_xp) |
Fora (anotado): 0x51327b (vtable+0x50 do matador: ouro pela morte com [0x6044c4]+0x74 ≠ 0 — no jogo de um jogador não roda) e os
stubs de cliente (Server_SendMsg92, Server_Event 0xffb, 0x4e9e97). As magias antigas ofensivas (8b) não chamam a vtable+0x70: quando
forem portadas pelo Spell_Apply, chamam.

## Próximo (a fila continua)
1. ~~Experiência~~ (feito).
2. Resto da 8b em lotes (áreas de dano, Fireball, Wall of Earth, Teleport, Summon, Animate Dead, Drain Life, magia de chão da IA —
   o resíduo T=2337 do m10_hydun_x1 é o Darkness do morcego 24619 —, dano de área em estruturas #94). O m10_quest_x1 em 4469 (a IA do
   Hydun, 24599, em guerra) é o próximo resíduo dele: olhar antes de começar a 8b.
3. Armadilhas do MapRec (m76, m93): meta loadcmp com MapRec 46/46.

# Atualização (2026-11-06, b941164): 8b lote A — magia no chão da IA
Tarefa 9 do despachante portada (0x56ec3f; 0x55539a de frente + Chebyshev ≤ alcance; 0x56e986 começa a magia na célula) e a imitação
do motor antigo saiu; o livro espelhado nasce instanciado pelo poder de quem lança (0x51c3e4 → 0x519483 → Spell_Instance), como o do
exe (o alcance +9 que o pensamento copia para IA+0x14). Pares do m10_hydun_x1 6/6 (0x56e986 sem par: review).
m10_hydun_x1 sem reimportar: 2337 -> **nenhuma**; reancorada 98,8 -> 98,9 %. O resto igual (tickcmp --all, quest 4469, golden 79,99 %,
loadcmp 46/46 e 44/46, test:sim, test:script).
Próximo: o m10_quest_x1 em 4469 (Hydun 24599, ação 13 = magia em unidade, alvo o herói, depois da guerra de T=4436): provável magia de
chance 0x56a981 (motor antigo, `buffs`) ou a escolha de magia da IA; depois os outros itens da 8b e as armadilhas.

# Atualização (2026-11-06, depois do lote A): m10_quest_x1 sem divergência
O resíduo de 4469 era o motor antigo largando a tarefa do exe: a magia (Stone Curse de chance do Hydun) e o ataque (morcegos) no alvo
caído, e o act reescrevendo IA+0x14/+0x30 com o SpellDef antigo. Agora as ordens vindas da tarefa do exe ficam com o despachante.
**Corridas sem reimportar: m10_start, m10_mage, m10_quest_x1, m10_troll_x1, m10_hydun_x1, m10_ogre_x1 — nenhuma divergência; m20_start 740.**
Golden 79,99 %, loadcmp 46/46 e 44/46. Próximo: m20_start T=740 (act/dir16 de 24616 e 24660, rng) e os outros itens da 8b; armadilhas.

## m20_start T=740 — investigado, NÃO corrigido (para a próxima sessão)
- Sintoma (corrida sem reimportar): em 740, olhar em volta trocado entre 24616 e 24660 (um sorteia o rumo novo, o outro não); mesmo
  número de sorteios — é a **ordem** em que as unidades rodam (0x52b459 percorre a lista).
- Causa achada: a unidade **24609** (tipo 103, jogador 2) cai em T=727 (vida −4, sem morte consumada). No original ela fica na mesma
  posição de `[0x68d2dc]+4` (`lists.all`, posição 3 de 42); no nosso, em 728, ela vai para o fim de `lists.all` E da lista viva (mundo+4),
  com o mesmo endereço e `bodyDead` = false. O `stable(...)` do `exeSyncWorld` não deveria movê-la (`all` = não consumadas): falta achar
  quem refaz as duas listas nesse passo (sonda: posição em `exeWorld.lists.all.values()` e `liveUnits` antes/depois de cada função do passo).
- Desvio escondido à parte (sem efeito nos sorteios): desde T=384 unidades dormindo (24644, 24645, 24662; 24600 em 496) ficam com IA+8 = 0
  no nosso (o `act`, `case "none"`, chama `stop` quando `!awake`) e 0xb no original. Testado manter a IA+8: some o desvio escondido,
  o 740 continua; desfeito (sem prova do mecanismo).
- Ferramenta usada (refazer em `game/src/sim/test/_scratch_*.ts`, fora do commit): `simFromImport` + `step` do simcore, comparando
  `AI_FIELDS`/`WALK_FIELDS` do exe_recon com os bytes `o.exe.ai`/`o.exe.mv` do despejo, e `serverOrder()` com `exe.world.lists.all`.

# Atualização (2026-11-06, ef7d5e2): m20_start T=740 FECHADO — todas as corridas livres do oráculo sem divergência
Causa: `liveUnits` (mundo+4) e `lists.all` ([0x68d2dc]+4) são a mesma lista (apelido em exe/types.ts), mas o exeSyncWorld a filtrava
duas vezes — "vivas" tirava a unidade caída e "não consumadas" a punha de volta no fim. No exe ela fica no lugar até a ação 0x10
(0x52b459). A m50 do test:sim passou a esperar a morte consumada do enxame (40 tiques) antes do gatilho do grupo vazio.
**Corridas sem reimportar, nenhuma divergência: m10_start_s1, m10_mage_s102, m20_start_s203, m10_quest_x1 (4560), m10_troll_x1 (3200),
m10_hydun_x1 (2600), m10_ogre_x1 (1200).** Reancoradas 100/100/100 (as longas 99,4/99,5/98,9/97,9 %, artefatos da importação). Golden
79,99 %, loadcmp 46/46 e 44/46.

## Próximo (fila do coordenador)
- **8b, lotes seguintes** (áreas de dano, Fireball, Wall of Earth, Teleport, Summon, Animate Dead, Drain Life, dano de área em
  estruturas #94): o corpus não tem mais resíduo para guiar — cada lote precisa de pares sintéticos (`tools/re/oracle/synth_spells.py`,
  como no lote 5 da 8b: `notes/magias.md`) ou de um episódio novo do oráculo que lance a magia (gravar com o espelho/`to_oracle.py`, ou
  roteiro no oráculo como o m10_quest_x1). Ponto de partida: `exe/spells.ts spellApplyPorted` (os `case` que ainda vão ao gancho
  `spellApply` do motor antigo) e `port_status.py next --root 0x519db8 --n 15`.
- **Armadilhas do MapRec** (m76, m93; meta loadcmp com MapRec 46/46): ver "Itens 2 e 3 da fila nova" acima e `notes/carregador.md` "Lote 3c".
- Também útil antes da 8b: mais episódios longos do oráculo em outras missões (item 4 da F2 no PLANO: "tickcmp livre ≥ 99 % em ≥ 6
  missões"), porque hoje todos os episódios são das missões 10 e 20.

# Atualização (2026-11-06): 8b lote B — a explosão da Fireball e a Wall of Fire (portadas e provadas; ainda NÃO ligadas no jogo)
- Portadas: SpellArea_ApplyAll 0x518833 (modo 0 do 0x517cfe), a cópia 0x51e5db e o ramo da Fireball de 0x518681 (dano B ÷ lado²
  do alvo), Map_StructureAtCell 0x552079, SpellArea_Wall 0x5182b6 + SpellArea_DirTransform 0x517ec3 (tabelas 0x5f8400 reta/0x5f84a8
  diagonal lidas do exe).
- Prova: pares sintéticos `synth_spells.py --scene fire` (pasta `refs/oracle/pairs/synth_m10_fire`: Fireball e Wall of Fire no chão
  em t=200 da m10_mage_s102). exe_spells: 0x518833 3/3 (+1 em gancho: a explosão pega uma estrutura, #94), 0x518681 248/248,
  0x51e65b 11/11, 0x517cfe 82/82, 0x518024 2/2, 0x552079 36/36. Duas correções do arnês: a carga da área da Fireball entra com a
  vtable Effect_DirectDamage (0x51e5db não a lê, e sem ela o arnês não lia o dano), e as conferências de dano usam a experiência
  portada (exe/xp.ts), porque a cena sobe o nível do mago (+0x96 +1 em t=235). O replay do fnprobe (`--verify 10`) deu 9 de 97
  diferentes (reads/writes de 0x518833/0x51e65b e o edx de 0x518681), provavelmente o heap da morte/cliente fora do estado gravado; os
  pares em si são o que o original fez.
- Spell_Apply da Fireball/Wall of Fire (`spellApplyPorted`: dano com distribuição 3/4): com a porta liberada, os 6 pares batem (6/6),
  **mas fica no gancho do motor antigo**. No jogo, a explosão chegaria a estrutura (#94: 0x5201b2) e a objeto do mapa (árvore) na
  célula, e o passo da lista (0x52c279, `world.ts` ~1759) não tem rede para NotPorted. Liga-se junto com o #94.
- Importação das áreas: o despejo (`dump_ticks.py`) agora traz a carga +0x48 da SpellArea, e `spellObjsFromOrig` lê o modo +8,
  +0x4c..+0x4f e +0x50. Antes o modo vinha 0, e o m10_troll_chase caía em NotPorted 0x518833 (as áreas lá são o Darkness do morcego,
  modo 1, raio 4; não há Fireball nesse episódio).
- Medida (tick_compare): `scan` do nosso lado = `sightOf` (o +0xa5 do original já tem o Light/Darkness, 0x51d175), e os bits de efeito
  com a mesma máscara nos dois lados (+ Darkness/Light 0x4000/0x8000). Antes, os dois davam uma falsa divergência em T=2910 do
  m10_troll_chase, com o +0xa4 do herói (1280) igual ao do original.
- Medidas: **m10_troll_chase** (antes NotPorted) reancorada 97,5 %, livre **nenhuma** divergência; **m10_troll_chase_w** 98,3 %, livre
  **nenhuma**. As outras 7 continuam sem divergência (tickcmp --all 100/100/100; quest 99,4, troll 99,5, hydun 98,9, ogre 97,9).
  Golden 79,99 % (CI ok), loadcmp 46/46 `--no-map` e 44/46 com MapRec, test:sim, test:script 49/49 e typecheck verdes.
- Próximo da 8b: o #94 (dano em estrutura 0x5201b2 e objeto do mapa em 0x518681) → liberar a Fireball/Wall of Fire no
  `spellApplyPorted`; depois Blizzard (modo 2, 0x51806c), Wall of Earth, Teleport, Summon, Animate Dead e Drain Life.
- **Correção no mesmo dia**: a "estrutura" de Map_StructureAtCell (0x552079, ocupação +8) é a **unidade grande** nas células que ela
  cobre além da dela (o par t=239 é o monstro 0x12baa668, vtable 0x5d0eb0, de lado 3). O 0x518833 agora chama 0x518681 nela, e ela
  leva a explosão uma vez por célula, com o dano B ÷ lado². Pares 0x518833 **4/4** (sem gancho). O prédio fica na ocupação +0xc
  (`CellStructRec`, 0x559bc9) e continua NotPorted: no Effect_DirectDamage, vtable+0x2c = 0 e +0x34 ≠ 0 levam a 0x5201b2
  (dano = +0x13 + Rand(+0x14) − 5 na vida +0x42 do prédio, só com +0x44 ≠ 0; com o dano ≥ vida, tira da lista [0x6044c4]+0x7c+0x10
  o que estiver na posição dele). Faltam as vtables do prédio (+0x1c, +0x20, +0x2c, +0x34) e os pares de uma Fireball num prédio.
  **É o que falta para ligar a Fireball/Wall of Fire no `spellApplyPorted`.**
- **Prédio, medido no Unicorn (m10_mage_s102, tique 1; sonda de rascunho fora do git)**: os 16 prédios da m10 têm vtable 0x5d1268
  (um 0x5d1228), **vida +0x42 e máxima +0x44** (casas 100/100, um de 500/500, alguns 0/100 ou 0/0). Vtable 0x5d1268: +0x1c 0x541fe0,
  +0x20 0x541ff0, +0x2c 0x542010, +0x34 0x543390 (0x5d1228: igual, salvo +0x54 0x520137 × 0x520853). Ou seja, **a Fireball do original
  danifica e destrói prédios**. O nosso motor só guarda a vida dos prédios para o script (`mission/host.ts` `buildingHp`, "Health of
  building"), e o espelho tem `CellStructRec.f42` como a "máscara dos jogadores" do 0x55b507. Conferir isso antes do lote, porque no
  objeto do prédio o +0x42 é a vida.
  Lote do prédio (próximo da 8b): espelhar o prédio (vtable, +0x42/+0x44, lista [0x6044c4]+0x7c+0x10), portar 0x5201b2 e as
  entradas da vtable, ligar o `buildingHp` do script à vida do espelho, gravar pares de uma Fireball num prédio (`synth_spells.py
  --scene fire`, alvo na célula de um prédio) e só então liberar distribuição 3/4 no `spellApplyPorted`. O desenho do prédio
  destruído no cliente (0x504b1d) é à parte.

# Atualização (2026-11-06): armadilhas do MapRec — loadcmp com MapRec 44 → **46/46**
- Portadas: 0x55ba36 (a armadilha no registro de ocupação da célula: cria com 0x5508a0, copia, grava e reaplica a máscara; 0 se a
  célula já tinha armadilha ou tem o bit 1 de mapa+0x20000) e 0x55b978 (os 6 bytes em +0x34: magia, poder, ponto 1, ponto 2),
  Unit_TeleportTo 0x55a96c (+ Unit_CanPlaceAt 0x55a928, Unit_SetPosition 0x54fbf7; para e fica em Stand ground pelo 0x56dba1 do
  mundo de mapa+0x58d80; Server_Event é stub). A carga (o trecho de 0x564072: entrada do bloco 9 com célula ≠ (0,0) e modo < 4) está
  em `World.exeAddMapTraps`, que entra na base do MapRec; o "Set trap" do script (0x57847e: [magia, poder, origem, destino], ou o
  gatilho duas vezes se a origem x é 0) está em `World.exeSetTrap`. O `mission/host.setTrap` e o laço do `setup.ts` não usam mais o
  `world.addTrap`/`stepTraps` do motor antigo (fica só para saves antigos e testes).
- Prova: pares sintéticos `tools/re/oracle/synth_traps.py` (m10_start_s1, t=60: dois teleportes no caminho do herói;
  `refs/oracle/pairs/synth_m10_trap`): 0x55ba36 3/3, 0x55b978 3/3, 0x55a96c 12/12, 0x55a928 12/12, 0x54fbf7 6/6, 0x5503af 23/23;
  replay do fnprobe IDÊNTICO (42 chamadas).
- **PONTE**: a armadilha de magia (m76: Fireball/Ice Missile...) vai a 0x4f0832 → o conjurador 0x4f06ac (uma unidade de 0x208 bytes na
  lista +0x2c do mundo, livro 0x53a600, magia 0x51906d, poder em +0xa8, mind 0x1e, ação 0xd/0xe), que não está portado. O
  `WorldRec.trapCast` lança pelo motor antigo (`castFromPoint` do ponto 1 na unidade, com o poder da armadilha). Antes, as armadilhas
  de magia eram ignoradas.
- Mudança de comportamento, com evidência: no exe a armadilha dispara só para quem entra na célula dela (0x5503af), e não na zona
  de ±1 célula do motor antigo (estimativa). Ela também não entra na lista [0x6044c4]+0x7c+0x10 que o 0x57a47d percorre, então o
  gancho `traps` do pensamento (o sorteio 0x57a409 por armadilha) não sorteia mais por elas. Testes: missions_90s conta as armadilhas
  pelo MapRec (`exeTrapCount`) e, na m96, espera a unidade 6 (jogador 7, só de passagem) sair de (56,72) antes de pôr o herói no
  gatilho; missions_druids (m53) confere o registro em (15,121) (`exeTrapAt`).
- Medidas: loadcmp `--no-map` 46/46 e **com MapRec 46/46** (antes 44/46: m76, m93); as 9 corridas livres sem divergência; golden
  79,99 % (CI ok); test:sim, test:script 49/49 e typecheck verdes.
- Falta das armadilhas: o conjurador 0x4f06ac e família (0x50dc2b, 0x53a600, 0x51906d, 0x519466, 0x51c29e) no lugar da ponte; e a
  lista +0x10 do 0x57a47d (os objetos que lançam magia em quem chega perto: 0x57a307 escolhe o alvo), hoje o gancho `traps` sem uso.

# Item 4 da F2 (episódios desde a carga em ≥ 6 missões) — investigado, NÃO feito: falta o herói no oráculo
- **Sem herói o mundo dorme**: `load_mission.load(30)` seguido de `o.tick()` roda (200 tiques em 0,6 s; 124 → 117 unidades, o
  script tira algumas), mas nenhuma vida muda. Os grupos só acordam perto de jogador humano (0x55b5f1 e as máscaras dos humanos), e o
  despejo da carga não tem herói, porque o cliente o junta depois de 0x4eb715. Um episódio "desde a carga" só com o load_mission não
  exercita combate, magia nem grupos. Sonda de rascunho fora do git.
- **Saves de começo de missão** (`refs/original/saves/index.json`, tela `mission_hud`): só m10_start/m10_mage, m20_start/m20_mage e
  m103_start (este só com o remendo de heróis especiais). Há saves de cidade nos estágios 30 (Kaarg: m30/m31), 50, 60 (druidas:
  m60/m70), 100/103 e 110. Os episódios do m10/m20 vieram do `dump_state.py` (jogo real pelo harness, imagem no tique 0) e os do
  troll_chase do espelho (`tools/refcap/mirror/to_oracle.py`).
- Caminhos, do mais barato ao mais caro:
  1. **Jogo real** (uma instância, a trava `scratch/refcap.lock`; hoje o espelho a usa): entrar na missão a partir do save de cidade,
     salvar o `mission_hud` (como `m20_start` foi derivado via `m20_town`) e gravar o tique 0 com `dump_state.py` ou com o espelho
     (`mirror.py --state ...` + `to_oracle.py`). Depois, um roteiro de ordens por missão no oráculo (como o m10_quest_x1), o
     `dump_ticks.py` e `free_run.mts`. Missões candidatas pelos saves: 30, 31, 60, 70, 103, 110.
  2. **A junção do herói no oráculo** (o "lote 5" de notes/carregador.md): depois do `load_mission`, chamar o tratador do servidor que
     cria o herói do jogador. O candidato é 0x4f254b (1835 bytes; chama Human_CreateByName 0x5143e4, Hero_InitSkills 0x514f59, a
     colocação 0x54f9b9 e Server_Event; chamado por Server_PacketDispatcher 0x4f515d, 0x4f856a e 0x4ebd5f), com os dados do personagem
     que o cliente manda. Isso abre as 46 missões sem jogo real, e no nosso lado é o mesmo passo de "criar o herói pelo exe" (F2 item 2).
- Nada no git mudou por este item.
