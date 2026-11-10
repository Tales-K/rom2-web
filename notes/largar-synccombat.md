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

# Item 4 da F2: a junção do herói no oráculo FEITA; episódios desde a carga em 6 missões; o script do oráculo ainda incompleto
- **Junção** (`tools/re/oracle/join_episode.py`), feita como o cliente:
  1. o Igles de partida nova da imagem m10_start_s1 é serializado pelo próprio exe (0x4e9e97, a ficha .a2c de 296 bytes; só grava com
     [0x6044c4]+0x74 ≠ 0, posto só na chamada; vai para `refs/oracle/heroes/igles_m10.a2c`);
  2. `load_mission.load(N)`;
  3. o pacote 0xbe (+5 jogador, +9 tipo, +10 tamanho, +0xe a ficha: o 0x41c6b5 do cliente) e o pacote 4 (entrar: 0x4f1d9c → 0x4f2c83,
     ponto de entrada sorteado da lista +0xc0).
  [est] Com servidor+0x1a8 = 0 (o que a carga da campanha deixa), o caso 0xbe não desserializa e cria o personagem de reserva
  (0x4f254b, 0x19 em tudo: corpo 25, vida 75). O +0x1a8 é uma escolha da interface (0x46e/0x65, 0x44d135) e aqui vale 1 só no tique do
  0xbe. Resultado: o herói entra com 142 de vida e corpo 40, no ponto de entrada (m30: (12,14), o `heroEntry` do script).
  O roteiro é decidido no oráculo a cada 16 tiques (atacar o inimigo vivo mais perto, ou um monstro) e gravado. Sem imagem `<id>_t0`
  (o Unicorn depois da carga não se salva como imagem), o fnprobe não roda nesses episódios.
- **Episódios** (2400 tiques cada, `refs/`): m30_join, m31_join, m50_join, m60_join, m70_join, m110_join. Os de m30/m70/m110 passam de
  512 MB descompactados: `free_run.mts` e `tick_compare.mts` agora leem o .jsonl.gz em linhas (`gzLines`).
- **Correções com evidência**:
  - (1) `import_state.worldFromState` não roda o 1.º ciclo do script quando a base é desde a carga (`from_load`): o tique 0 é 2
    tiques depois da carga, antes do 1.º pensamento (os gatilhos "Start" do original andam no T=4). Antes, a m30/50/60/70 divergia
    no T=4 (o andar dos grupos do "Start" sumia).
  - (2) O tickcmp lê o comando do grupo nosso do registro do exe ([[unidade+0x70]+0x3c]+0x20, como o lado original), não de
    `groupState.cmd12`, que só a guarda da carga escreve.
  - O tickcmp --all, as 6 longas e o troll_chase continuam sem divergência; golden CI ok; test:sim e test:script verdes.
- **1.ª divergência na corrida livre** (modo importado):

  | episódio | 1.ª divergência |
  |---|---|
  | m30 | T=20, `dip 4→1` (o original entra em guerra) |
  | m31 | T=463, vida do 24708 (48 × 50) |
  | m50 | T=20, o 24619 anda no original |
  | m60 | T=99, o herói fica sem alvo no original |
  | m70 | T=20, rng e `dip 1↔6` = 2 (aliança no original) |
  | m110 | T=4, o caminho e o rumo do herói |

  O modo carregador diverge antes (o tipo/regeneração de mana do herói, os rumos sorteados).
- **Bloqueio: o script do oráculo não vê o herói.** No oráculo da m30, a lista de valores calculados do script ([0x66832c]+0xeaac,
  0x574899) tem só 18 valores, os sem referência especial (≥ 10001 no JSON; faixas 8000/9000 do .alm). Nenhum valor que cita o herói
  é calculado (gancho em 0x577268: só "From son to elder" por ciclo). O carregador do script (0x562745) roda dentro do Server_StartMap
  (g_4e0000.c:8297), antes de qualquer herói. Ou o jogo real resolve as especiais depois (passo de entrada que a minha junção não
  reproduz; o 0x4f1d9c roda e não resolve), ou os valores com especial vão para outra estrutura. Enquanto isso não fechar, os
  gatilhos do script que dependem do herói nunca disparam no oráculo, e as divergências do T=20 podem ser artefato. Próximo passo:
  achar onde o exe liga as referências 8000/9000 a unidades. Pistas: o laço da carga dos checks em g_560000.c ~1900–2000 (`local_154`,
  `local_130 = 0` → "Failed to create check"), 0x560d22 (procura no mapa +0xeab0 por +0x60/+0x68) e o resto do 0x562745.
- **Testado e desfeito** (no runtime do script, sem commit):
  - (a) valores com especial pendente valendo 0: quebra a kaarg (o "Elder to knight" dispara antes do "Elder to hero");
  - (b) calcular todos os valores no começo do ciclo, antes dos gatilhos, como o 0x57485b faz (0x574899 → 0x574ba1): bate com o C,
    mas quebra as missões 70/80/90 do test:sim de um jeito que não é só tempo. Precisa de estudo antes de ligar.

# Passo 1 do coordenador (a rotina das referências especiais): achada no C; a confirmação no jogo real ficou bloqueada (1.º plano)
- **A rotina**: as referências especiais são resolvidas NA CARGA DO SCRIPT, não depois. O carregador do mapa 0x5606aa chama as
  unidades (0x561bf9), o script (0x562745, param 1; o Server_StartMap chama via 0x4ec732 com param 0) e as armadilhas (0x564072).
  Cada referência de unidade passa por 0x562274:
  - < 10001: unidade do mapa (0x565080);
  - 10001..11000: 0x562518(id − 10001), que só no servidor local (+0x74 = 0) pega o 1.º jogador humano (0x53b930) COM herói (+0x38)
    e procura na lista dele (+0x24), depois em [0x68d2dc]+4, a unidade com `+0x14c − 0x15 == n` (o herói tem n = 0);
  - acima disso: 0x56236c (por nome).
  Sem a unidade, "Can't resolve hero %d", e o check não é criado. Na lista calculada (+0xeaac) ficam só os que resolveram; o
  0x574899 calcula cada um (0x574955) se +0x58 = 0.
- **O que isso explica**: na minha junção, o herói entra DEPOIS do Server_StartMap, então todo check com o herói ou o Igles é
  descartado (m30: 18 de ~37 na lista). No jogo real, o herói (e o grupo: Igles 10002, Dina 10003, pelo índice +0x14c) já está no
  jogador antes da carga do mapa. Já registrado em sessões anteriores no jogo real: `build_m20.py` ("as missões 30+ derivadas de saves
  sem Igles falham: Can't resolve hero 10002 + caixa de erro") e `build_m103.py` (o remendo `sub ecx,0x2711` → `xor ecx,ecx` em
  0x5622e4, para todo especial resolver no herói).
- **Falta**: a ordem real dos pacotes da entrada (quem cria o jogador humano e quando chega o 0xbe, em relação ao Server_StartMap).
  Logo depois do init (0x4eb356) não há jogador 1 (0x4f3ba9(1) = 0). O candidato a criá-lo é o caso 2 do despachante (0x4f0cbe, nome
  do jogador).
- **Sonda no jogo real** (`tools/refcap/original/join_order.py`: cópia a2_lab, janela, trava; cavernas de 5 bytes no despachante
  0x4f515d e na entrada de 0x4eb715/0x5606aa/0x562745; lê a lista +0xeaac depois): 3 tentativas com o `m20_town`, e o harness não
  conseguiu pôr a janela do jogo em 1.º plano (`input._guard` aborta a entrada; na 3.ª nenhum pacote foi tratado, então o portão não
  entrou). Jogo fechado e trava solta. **Precisa do desktop livre para o jogo ficar em 1.º plano.** A m30 em si não entra a partir
  dos saves de cidade que temos (sem o Igles no grupo, a carga do script para com a caixa de erro); para ela, a sonda serve na m20
  e mostra a ordem.
- **Próximo, depois da ordem real**: no `join_episode.py`, criar o jogador e juntar o herói (e o Igles, para a m30+) antes do
  Server_StartMap, no lugar do 0xbe depois da carga; regravar os 6 episódios; conferir o tique 0 com o do jogo real.

# Item 4: a junção refeita na ordem do jogo; provada por equivalência na m10/m20 (sem o jogo real)
- **A ordem do jogo** (pelo C do cliente):
  - O servidor da campanha PERSISTE entre as missões.
  - No fim de cada missão (mensagem 0x41d, g_480000.c ~2891), o cliente chama 0x4ebd5f (refaz o jogador: +0x40/+0x41 = 0) e
    `Server_InnNpcCreate(var 0x300 = estágio, o grupo)`, que cria os companheiros: o template é NPC × 10 + 10000, mais a variante do
    estágio NPC × 10 + 9998 + estágio/10, e o índice +0x14c recebe o NPC (Igles 22 → 0x16, Dina 23).
  - Na missão seguinte, o Server_StartMap 0x4eb715 roda NO MESMO servidor (0x48c8a3), e só depois vem o pacote 4 (0x41c50d).
  - A carga do script (0x5606aa → 0x562745) encontra o herói e o grupo já no jogador e resolve as especiais (0x562274 → 0x562518).
- **`join_episode.py`** agora faz exatamente isso no servidor da imagem m10_start_s1: 0x4ebd5f, InnNpcCreate com os companheiros que
  o script cita (m30: Igles; m50/m70: Igles e Dina; m60: Dina), StartMap e o pacote 4. A ficha .a2c e o pacote 0xbe saíram.
  Na m30: herói em (12,14) (o `heroEntry`), Igles (id 2, índice 0x16, vida 158) em (11,17), **33 valores do script calculados = os
  40 do JSON menos os 7 constantes** (FALSE, 1, 2, 3, 4, 10, que não entram na lista). Antes eram 18.
  Correção da nota anterior: os ids que faltam na lista da m10 real (1, 3, 5, 6, 7) são constantes, não valores do Igles.
- **Provado por equivalência** (sem a sonda no jogo real): a mesma sequência na imagem m10_start_s1 com "10.alm" e na m20_start_s203
  com "20.alm" dá a MESMA tabela de valores do script dos saves gravados no jogo real (m10: 15, m20: 13; ids, tipos e os 0x30 bytes
  de parâmetros) e o herói na mesma célula (m10 (11,41), m20 (41,67)). Depois de 19 tiques, as diferenças com o tique 0 dos saves
  são só sorteios (o rumo do olhar em volta; 2 unidades de patrulha na m20): a carga semeia pelo relógio, e o save real foi gravado
  com t16 = 21 e o rng do harness. As corridas livres antigas não mudam (o código do sim não mudou).
- **Episódios regravados**: m30, m31, m50, m60, m70, m110 (2400 tiques). 1.ª divergência na corrida livre (modo importado):

  | episódio | 1.ª divergência |
  |---|---|
  | m30 | T=240, caminho do 24699 (`walk_goal`) |
  | m31 | T=450, vida do 24708 (52 × 48) |
  | m50 | T=355, ação do herói (3 × 0) |
  | m60 | T=13, rng |
  | m70 | T=21, ação/rumo de 24694–24696 |
  | m110 | T=5, o caminho dinâmico do herói (`fy`) e a magia de 24695 |

  As do T=20 (m30, m50) eram artefato das especiais sem resolver.

# Item 4, divergências 1 e 2 corrigidas (C + oráculo): o "Suspend group" e a ordem da lista na entrada nova
- **"Suspend group"** (instantâneo 39 → 0x5781a7): o exe só faz `[[grupo]+0x3c]+0x48 = 0` (tira o "sempre acordado"). As unidades
  NÃO param: o 24695 (grupo 1 da m110), suspenso no 1.º ciclo, lança o Shield no pensamento do T=5 (gancho de escrita na IA+8 no
  oráculo: 0x56ff4d → AI_PlayerThink → AI_GroupThink 0x5700f3 → 0x5728fa → AI_Idle → AI_IdleAlt → AI_IdleCasterSupport → AI_CasterShield
  → AI_CastAtTarget). O `host.suspendGroup` congelava as unidades (`u.suspended` + "none"); agora chama `World.exeSuspendGroup`
  (+0x48 = 0 no registro do grupo; `exeAsleepGroups` vale para o registro criado depois e vai no save). O teste da m110 confere o
  +0x48, com o motivo anotado.
- **Ordem da lista das unidades** ([0x68d2dc]+4): numa entrada nova, o herói vai DEPOIS das unidades do mapa (0x4f2c83 → 0x52b22a no
  pacote 4; m110_join: herói em 259 de 260). A regra "herói à frente" do `exeSyncWorld` vem dos saves (m10/m20, golden). Agora há
  `World.heroListFront` (padrão true = a regra do save), e o estado importado desde a carga usa a ordem do despejo. Tirar a regra
  de todo mundo derruba o golden de 79,43 % para 73,32 %, porque ele é de saves. [est] A entrada nova do nosso jogo ainda segue a
  regra do save (follow-up: separar a entrada nova da carga de save no `buildMission`).
- Medidas: as 9 corridas antigas sem divergência; golden 79,99 % (CI ok); loadcmp 46/46; test:sim e test:script verdes.
  1.ª divergência livre:

  | episódio | antes | agora |
  |---|---|---|
  | m30 | T=240 | **T=1076** |
  | m31 | T=450 | **T=997** |
  | m50 | T=355 | **T=834** |
  | m60 | T=13 | T=13 (rng) |
  | m70 | T=21 | T=21 |
  | m110 | T=5 | T=5, agora só a perseguição do 24909/24910: o AI_CasterOffensiveSpell lança no 24893 fora do alcance; no nosso, a máquina põe a ação 1 mas o `unitActionChase` (0x56ea52) não monta o caminho, nem nos tiques seguintes — a próxima a ver |

# Próximo bloco (perseguição da m110): o livro na importação corrigido; a porta do 0x57a769 achada, mas desfeita (quebra a m103)
- **A causa da m110 T=5** (24909/24910 perseguindo no original, parados no nosso) tem duas partes:
  1. **O livro da importação**: o `exeSyncBook` refazia a instância do livro pelo poder atual de quem lança (sk 100, mind 63 →
     alcance +4: Stone Missile 11, e não os 7 do exe). O exe guarda a instância de quando o livro nasceu. **Corrigido**: o
     `import_state` passa a instância do despejo como `keep` (+9 alcance, +0xe, +0xf e +0x10 quando há), e o `bookApplyKeep` deixa
     o +0x10 calculado se o despejo não o traz. O `tools/refcap/diff/export_state.py` (não versionado; mudança local) agora lê também
     o +0x10. Com isso o 24910 bate.
  2. **AI_CasterOffensiveSpell 0x57a769 NÃO está portado**: ele fica num gancho do motor antigo (`casterOffensiveSpell` →
     `pickOffensive`). O exe (C lido, 444 bytes): com Mind (+0x88) < 60, ou o sorteio 0..99 (0x57afd0, sítio 0x57a7b8) acima de 29,
     monta a lista das magias do livro 1..28 com custo (+0xc) ≤ mana (+0x9a) e +0xa = 0, sorteia (sítio 0x57a862; índice além = a
     última; lista vazia = nada) e chama AI_CastAtTarget (IA+0x60 = 1); senão chama AI_Task_Attack, que reentra nele. Os sorteios
     do oráculo no T=5 da m110 (ganchos em Rand_Inclusive/Rand_One/0x57afc0/0x57afd0/0x57aff0) dão a mesma sequência de sítios
     até a escolha da magia; o exe chama o 0x57a769 para 18 conjuradores (24895–24912; o 24905 duas vezes, pela reentrada).
     **A porta literal leva a m110 do T=5 ao T=14** (rng) e deixa as 9 corridas antigas, o golden (79,99 %) e o loadcmp iguais.
     Mas quebra o test:sim na m103 ("Igles busca a pedra e a cabeça"): o Igles fica com a ação 0x1b (grupo dormindo) por centenas de
     tiques com a ordem de coletar, e não pega a cabeça. Com o gancho antigo, passa. Ajustes de cenário (desocupar o saco, "hold",
     tirar a pedra e o veneno) não resolveram. **Desfeita até achar por que o grupo do Igles dorme**: o +0x45 do grupo, escrito pelo
     0x55b5f1; a ação 0x1b vem do despachante com mundo+0xbbe8 = 0 e tipo+0x45 = 0. A porta está pronta para refazer: texto acima.
- Bateria verde com a correção do livro: 9 corridas sem divergência, golden 79,99 %, loadcmp 46/46, test:sim, test:script.
  Episódios regravados (o despejo com o +0x10 do livro); 1.ª divergência: m30 T=1076, m31 T=997, m50 T=834, m60 T=13, m70 T=21,
  m110 T=5.

# A porta do 0x57a769: a m103 resolvida (cenário); falta o Summon. Patch guardado, NÃO aplicado
- **(a)** `tools/refcap/diff/export_state.py` no git (49bdc17): só código, sem dado do jogo nem caminho do GOG. Ele importa o
  `original_episode`, o `orig_mem` e o `orig_trace`, que também estão fora do git (a pasta `tools/refcap/diff` tem ~20 arquivos fora).
- **(b) m103 "Igles busca a pedra e a cabeça"**: o grupo do Igles NÃO dorme. A ação 0x1b só aparece enquanto ele está petrificado; no
  fim, o +0x45 do grupo = 1. Ele não coleta porque a célula do saco (12,112) está coberta pela pegada 2×2 de um monstro de lado 2
  (tipo 66, jogador 7), parado atacando a 101: registro de ocupação +4 dele, legítimo (está no centro de (12,111)). Com a escolha de
  magia do exe as brigas mudam de lugar; nada indica que o exe deixaria a célula livre. O cenário passou a afastar quem cobre a célula
  do saco pela pegada (o teste é do fluxo do script), e a m9x passa (531 ok). O cenário no oráculo não foi montado: com essa causa
  (pegada legítima), a pergunta "o grupo dorme?" já se respondeu no próprio estado. Se quiser a prova no original, o roteiro do
  teste tem teleportes e mortes forçadas que o oráculo não tem.
- **ai.ts "giro de 180° antes de lançar"**: o `suspended` do motor antigo não desliga o pensamento portado, e o AI_CasterOffensiveSpell
  dava ao lich a tarefa de magia por conta própria (9 × 2 tiques). O teste passou o lich para o jogador 1, para medir só o giro da ordem.
- **Falta: necro.ts "druida inimigo invoca em combate"**. O gancho antigo lançava o Summon EM SI MESMO (`s.kind === "summon" ? r : t`).
  O C do 0x57a769 passa sempre o alvo (o inimigo) ao AI_CastAtTarget, e o Summon tem alcance 0 e é "Caster Only": o druida
  persegue e não lança em 40 s. O que o exe faz depende do alcance da instância do Summon (Spell_Instance) e do caso Summon de
  Spell_Apply 0x519db8 (não portado). Precisa de cenário sintético no oráculo (synth_spells: um conjurador de IA com só o Summon
  no livro e um inimigo perto, olhando a IA+0x14 e se ele lança).
- **Patch** (porta + os 3 ajustes de teste, 112 linhas):
  `side-session-notes/local_c595edc7-3cc5-4c16-8649-e63ff20be6a9/porta-0x57a769.patch`
  (`git apply` na raiz do repo). Com ele, as 9 corridas antigas seguem sem divergência, o golden fica em 79,99 % e a m110 vai do
  T=5 ao T=14; o único vermelho é o necro.ts acima. A árvore ficou no HEAD (bateria verde).

# A porta do AI_CasterOffensiveSpell 0x57a769 RELIGADA (com o Summon resolvido pelo oráculo)
- **Summon no exe** (cenário sintético, imagem m10_mage_s102; sonda de rascunho fora do git): um monstro com só o Summon no livro
  (0x53a600, 0x51906d, 0x51c29e), mana 1000, vida 30000, bit de livro em +0x4c, posto a 3 células da maga (Unit_TeleportTo).
  O 0x57a769 escolhe o Summon e o põe no ALVO INIMIGO (IA+8 = 8, IA+0x28 = a maga), com IA+0x14 = 0 (o alcance da magia, "Caster
  Only"). Ele é chamado uma vez em 640 tiques; o despachante 0x56ebc0 nunca acha o alvo ao alcance, e o monstro persegue e depois
  bate corpo a corpo (tarefas 5/6). Em 40 s não invoca nem gasta mana. A porta literal (sem o caso especial "Summon em si mesmo" do
  gancho antigo) faz o mesmo. O teste `necro.ts` passou a esperar isso, com o motivo anotado.
- Os outros dois ajustes de teste (m103: afastar quem cobre a célula do saco pela pegada; ai.ts: o lich do lado do jogador 1) são
  os da nota anterior.
- Bateria verde: 9 corridas sem divergência, golden 79,99 % (CI ok), loadcmp 46/46, test:sim, test:script. Corrida livre: m30 T=1076,
  m31 T=997, m50 T=834, m60 T=13, m70 T=21, **m110 T=5 → T=14** (rng).

# As dependências do export_state.py no git (passo 2 do coordenador)
- Lidos inteiros os 19 arquivos de `tools/refcap/diff` fora do git e os 2 de `tools/refcap/trace` que o export_state importa
  (`orig_mem.py`, `orig_trace.py`). Todos são código ou configuração da ferramenta, sem dado do jogo. O `causes.json` é a tabela de
  causas nomeadas do relatório do golden (texto nosso). Os caminhos absolutos que aparecem são das cópias de execução em
  `C:\Users\TALES K\Games\` (como em ~25 arquivos de `tools/` já no git). O `make_diff_runtime.py` cita "GOG" só em texto
  ("o GOG nunca é tocado", "allods2.exe GOG"), sem caminho.
- **Mudança local antes do commit**: a docstring do `orig_mem.py` trazia o caminho da instalação original como aviso ("nunca em
  C:\GOG Games"). Agora diz "nunca na instalação original". É o único caminho do GOG que havia nesses 21 arquivos.
- **No git**: `tools/refcap/diff/{causes.json, gen_script, golden_compare.mts, golden_ingest, golden_rerecord, golden_run.mjs,
  golden_worker.mts, group_episodes, levers_audio, levers_probe, make_diff_runtime, original_episode, rand_ablate, rand_sites,
  run_pair, show_window, test_randlog, tile_speed, vclock}` e `tools/refcap/trace/{orig_mem, orig_trace}.py`. Com isso, o
  export_state, o original_episode e o run_pair importam a partir de um clone limpo.
- **Ficaram de fora** (outra pasta, não fazem parte do pedido nem foram auditados): dependências de 2 dos arquivos commitados que
  continuam fora do git, então eles NÃO importam a partir de um clone limpo:
  - `make_diff_runtime.py` importa `tools/refcap/trace/make_lab_runtime.py`;
  - `levers_audio.py` importa `tools/refcap/original/{audio_hook, make_audio_runtime, build_m103, build_m110}.py`;
  - `levers_probe.py` importa `tools/refcap/original/{build_m103, build_m110}.py`.
  Também ficou de fora o resto de `tools/refcap` não versionado (hit_regions/*.json, overlay/, original/ e trace/ restantes), de
  outras frentes.
- Nada do sim mudou (a bateria do 89af147 vale; typecheck refeito).

# m110 T=14 → T=27: a Blizzard/Acid Stream do exe (0x51806c), o texto do efeito exato e a ação do grupo suspenso
- **T=14** (rng): os sorteios 0x51814a/0x51815c (a célula do passo da Blizzard) saíam no T=14 no nosso e no T=15 no original. A
  Blizzard ainda era o motor antigo (`stepAreas`, pulso estimado). **Portados**: Spell_AreaProgressive 0x51806c (modo 2: um passo a
  cada 3 tiques por +0x50; Blizzard 32 células sorteadas em ±2; Acid Stream 6 passos pelas tabelas 0x5f8550/0x5f8928 lidas do exe, na
  direção +0x4e por SpellArea_DirTransform), 0x54fca8 (a carga vai à célula, presa a 8..lado−9; só pulsa se não foi presa) e 0x517e80
  (embutida). O `spellApplyPorted` passou a cobrir a distribuição 5 (o ramo de Spell_Apply que monta a área de modo 2 já estava
  portado). Apresentação: `clientAreaPulse` (o 0x504524) faz o "blast" e, na Blizzard, o `onAreaCells` das alavancas, como o motor
  antigo. **PONTE (#94)**: o objeto do mapa da célula (o prédio, ocupação +0xc) vai ao gancho `areaHitObject`, que no mundo não faz nada
  (o dano 0x5201b2 é do lote do prédio); sem gancho, NotPorted 0x5201b2. Vtables do prédio (0x5d1268/0x5d1228): +0x2c 0x542010 → 0,
  +0x34 0x543390 → 1 (lidas do exe).
  Prova: `synth_spells.py --scene bliz` (pasta `refs/oracle/pairs/synth_m10_bliz`: Blizzard e Acid Stream no alvo e no chão, poder
  0..255): 0x51806c 310/310 (+4 em gancho: o prédio), 0x54fca8 146/146, 0x519db8 12/12, 0x517cfe 102/102, 0x518681 404/404,
  0x51e65b 12/12 (+4 no prédio). O arnês do 0x51806c pega o mapa pelo objeto da carga (+0x48 → +0x10 → +8) quando o [0x670e48] não
  foi lido (todas as células na borda).
- **T=16** (`absorb` do 24890: 7 × 12): a Stone Curse do 24796. O texto do efeito em data.bin é `"absorbtion=+5:duration 8,defence=-20:
  duration 8"` COM as aspas (lido na definição +0x1c no oráculo). O 0x51e8fa do exe não acha o nome `"absorbtion` e o efeito fica
  sem tipo (+0x3c = 0, +0x40 = 0); o nosso `spells.json` tirava as aspas (`derive.py`: `strip('"')`) e o efeito somava 5 na absorção.
  Correção: o `derive.py` (fora do git, `/tools/data/` no .gitignore) grava também `effectsRaw` (o texto exato; só a Stone Curse
  difere), e o `bookSpellRec` usa `effectsRaw ?? effects`. Os outros 5 arquivos que o derive.py gera saíram iguais byte a byte.
  **Quem tiver outro clone precisa regerar o `game/public/data/spells.json`** (`tools/data/derive.py`).
- **T=21** (`act` 13 × 27 em 8 lançadores do grupo suspenso): artefato da medida. O tickcmp punha 27 em toda unidade de grupo
  dormindo (regra do motor antigo); o despachante 0x56dca2 portado só põe 0x1b com a sub-ação IA+9 = 0, e no original os lançadores
  terminam a magia com a ação 0xd (act_cnt 6..1). Agora a medida é o `act` do registro.
- Medidas: as 9 corridas antigas sem divergência; golden 79,99 % (CI ok); loadcmp 46/46 (com e sem MapRec); test:sim, test:script
  49/49 e typecheck verdes. Corrida livre: m30 T=1076, m31 T=997, m50 T=834, m60 T=13, m70 T=21, **m110 T=14 → T=27**
  (`act` do 24910: 13 × 3).
- **T=27** (`act` do druida 24910: 13 × 3): no exe, o "Druid_Male2" (tipo 100) tem a arma do modelo "Wood Shaman Staff
  {castSpell=Ice_Missile:5}" em +0x74, com a magia +0x84 (Ice Missile, alcance 7). Gancho de escrita no oráculo: o despachante põe o
  golpe (ação 3, 0x56e8c3) e a máquina 0x50f12c (0x50f430) o troca pela magia da arma (ação 0xd, +0x64 = a magia, +0x68 = a arma). No
  nosso, só o herói tinha `weaponSpell`; o `weaponItemSync` zerava a magia da arma de toda unidade do mapa. Agora o `buildMission` dá às
  unidades do mapa criadas pelo modelo a magia da arma (o `castSpell`/`spellPower` do item do equipamento na posição da arma); a máquina
  portada decide pelo bit 4 de +0x4c (0x53a5a0). São 104 modelos com arma assim em data.bin (xamãs orcs, esqueletos magos, druidas,
  catapultas...). Bateria igual (9 corridas sem divergência, golden 79,99 %, loadcmp 46/46, test:sim, test:script); **m110 T=27 → T=49**
  (`flee_cell`/`hit_clock16`/`look_hit` do 24908).
- **T=49** (`look_hit`/`hit_clock16`/`flee_cell` do 24908): gancho de escrita no oráculo — 0x50f485 (máquina) → 0x519998 → 0x519c04
  **Spell_PrismaticSpray** → 0x579ddf → 0x56e6b8 (o aviso ao alvo). O Prismatic Spray ainda era o motor antigo (`spellPrismatic`).
  **Portados**: 0x519c04 (raios = min(poder ÷ 20 + 2, 7), poder pela esfera 0x511913 ou pelo efeito 0x29 do item em uso), 0x579ddf
  Spell_PrismaticTargets (avisa o alvo; AI_GroupVisibleEnemies do grupo de quem lança; os de pé e os caídos com 0x579d62 ≤ alcance ×
  0x100, rascunho em mundo+0xc74; os `n` menores, o alvo primeiro, e RemoveTail 0x57b080 até `n`), 0x579d62 (AI_UnitDistance × 0x100 +
  AI_AngleTiebreak) e o +0x138 = relógio do 0x504391 (o resto do pacote é stub: `clientPrismatic`, que começa a apresentação; os raios
  são os projéteis de Spell_Apply em cada alvo). Prova: `tools/re/oracle/join_pairs.py` (novo: grava pares do fnprobe num episódio da
  junção, a partir de `join_episode.start` e do roteiro do ep.json; sem replay, por falta da imagem) — pasta `m110_prism`, lançamentos
  reais da IA da m110 nos tiques 40..700: 0x519c04 20/20, 0x579ddf 20/20, 0x579d62 99/99; e `synth_spells.py --scene prism` 6/6. O
  arnês do exe_spells pega o mundo de `this` (thiscall do mundo) e o mapa de mundo+0xa50 quando o [0x670e48] não está no par.
  **Testes** (missions_90s, com o motivo anotado): o Prismatic do exe pega sempre o alvo e os inimigos que o grupo vê. Na m90, o raio do
  necromante mata a Dina de 26 PV ao lado do herói; nos santuários 95/96, o dragão mata o herói mago de 29 PV. O "imortal" dos pilotos
  (vida 100000) não valia para o herói: a vida +0x94/+0x96 é short e o recálculo 0x51366b refaz a máxima pelo corpo. Agora há
  `makeImmortal` (pilot.ts): 30000 PV, e o `keep` repõe a máxima a cada tique.
  Bateria igual (9 corridas sem divergência, golden 79,99 %, loadcmp 46/46, test:sim, test:script); **m110 T=49 → T=85** (rng).

# m60 T=13 (rng): do episódio, não do motor — a importação não criava os companheiros; agora T=33
- Gancho no rand() cru do CRT (0x583290, com `ctl_flush_tb`; os ganchos nos envoltórios não viam este): no T=13 o original sorteia 3
  vezes, o nosso 2. O 3.º é o Rand_Inclusive(3) de 0x50f7b7 (a espera da fase 7 da máquina 0x50f12c) da **Dina** (id 2 do original,
  jogador 1, tipo 0x24, 26 PV), que lança desde o T=5. No nosso mundo importado a Dina não existia: a junção cria os companheiros pelo
  Server_InnNpcCreate antes do StartMap, e o `worldFromState` só montava o mapa e o herói. O `spawnUnmatched` também não a criava (não
  há modelo de tipo 0x24 no unit-templates). Faltava também o livro: o companheiro nasce do modelo sem magias.
- **Correção (só a importação, `game/src/sim/test/import_state.ts`)**: com `from_load`, os companheiros nascem do modelo
  (`spawnCompanions`: Igles 10002 para o tipo 0x21, Dina 10003 para o 0x24) pelas unidades do jogador 1 do original além do herói, sem o
  `attachFollowers` dos pilotos. As magias do livro do despejo que a unidade não tem (contando as de chance e a da arma, que também
  vão ao livro espelhado) entram em `u.spells`; a instância continua vindo do despejo (`keep`). m30/m50/m70 ganham o Igles; m60 a Dina.
- Medidas: **m60 T=13 → T=33** (`turn` do herói: 19 × 16); m30 1076, m31 997, m50 834, m70 21 e m110 85 iguais; as 9 corridas
  antigas sem divergência; golden 79,99 % (CI ok); loadcmp 46/46; test:sim e test:script verdes.

# m70 T=21: causa achada (o "Phase out unit" do exe tira a unidade do contentor); a porta deixa a m70 SEM divergência, mas ficou de fora
- Sorteios no T=21: o original chama AI_CasterShield 0x57a999 (sítio 0x57aad9) 6 vezes, o nosso 7. A chamada a mais é do dragão
  24699 (jogador 6), que o script põe fora de fase no T=6 ("Phase Out dragon"; no original ele some do despejo nesse tique). No exe,
  "Phase out unit" (instante 16 → 0x57821e → **0x5102a3**): com +0x4c sem o bit 8, Unit_RemoveFromCells, +0x4c |= 8 e **sai de
  [0x68d2dc]+4** (`lists.all`: não pensa, não age, não regenera); "Phase in" (17 → 0x578236 → **0x5103ae**): a colocação 0x510089,
  AddTail no contentor (0x52b22a) e +0x4c &= ~8. O nosso `phaseOut` só tirava das células: a unidade fora de fase seguia pensando.
- **A porta** (3 trechos em `world.ts`: `phaseOut` tira de `lists.all` e liga o bit 8; `phaseIn` volta ao fim e apaga o bit; o
  `stable(w.lists.all, …)` do `exeSyncWorld` exclui as fora de fase) **leva a m70 a nenhuma divergência em 2400 tiques** e deixa as 9
  corridas, o golden (79,99 %), o loadcmp e o test:script iguais. **Desfeita** porque quebra um teste do test:sim:
  missions_druids m60 "e atacam a maga (Dina)". Os morcegos do grupo 9 voltam de fase e recebem "Attack unit" no mesmo tique (153).
  Com a porta, o `applyTaskOrder` do pensamento lê a IA+8 = 0 e apaga a ordem antes de ela virar a tarefa 5 (sem a porta, a IA+8 já
  é 5 no mesmo tique). A unidade volta ao fim da lista, e a passagem que converte a ordem do motor antigo em tarefa do exe
  (world.ts ~2158) já tinha passado.
- **Próximo**: achar, no C, quando o exe processa o "Attack unit" (o instante e a IA+8 que ele escreve) de uma unidade recém-voltada
  de fase, e fazer a conversão ordem → tarefa não depender da posição na lista. Depois religar os 3 trechos acima.

# m70 T=21 FECHADO: o Phase out/in do exe religado; a m70_join sem divergência em 2400 tiques
- **Evidência do oráculo para o teste da m60** (sonda de rascunho, fora do git: `join_episode.start(60)`, 60 tiques, Dina e herói
  teleportados por 0x55a96c para (72,92)/(73,93)): os morcegos do grupo 9 ficam FORA de [0x68d2dc]+4 com +0x4c = 0x18 (bit 8) enquanto
  estão fora de fase. No tique do "Phase In bats" + "Bats attack mage", eles voltam à lista com +0x4c = 0x10, classe 3, alvo IA+0xc =
  Dina, **IA+8 = 0 e ação 0x1b por 16 tiques**, e só no pensamento seguinte vão para IA+8 = 5 e ação 1. Com a porta, o nosso faz o mesmo
  (tique 153 → 169). Sem a porta, a tarefa 5 aparecia no mesmo tique. O teste "e atacam a maga (Dina)" (missions_druids) passou a
  esperar 1 s antes de conferir, com o motivo anotado.
- Religados os 3 trechos de `world.ts` (`phaseOut` 0x5102a3: fora de `lists.all`, +0x4c |= 8; `phaseIn` 0x5103ae: AddTail, +0x4c &= ~8;
  `stable` sem as fora de fase). port_status: 0x5102a3, 0x5103ae, 0x57821e, 0x578236.
- Medidas: **m70_join livre: nenhuma divergência** (antes T=21); m30 1076, m31 997, m50 834, m60 33, m110 85 iguais; as 9 corridas
  antigas sem divergência; golden 79,99 % (CI ok); loadcmp 46/46 (com e sem MapRec); test:sim, test:script e typecheck verdes.

# m110 T=85 → T=517: a morte consumada sai do grupo (0x52b459 → 0x51618e)
- Sorteios do T=85: o original tem 16+9 sorteios de AI_CasterOffensiveSpell (0x57a862/0x57a7b8), o nosso 17+10. Pelos chamadores
  (gancho em 0x57a769 no oráculo e no nosso), o nosso chama a magia para o 24911, que já está morto (ação 0x10, vida −34, nos dois).
- No exe, 0x52b459 (o laço das unidades) faz, com a ação 0x10: 0x51618e = 0x52afd2 (sai da lista de membros do grupo, +0x70 = 0),
  e o grupo vazio de dono humano (dono+0x2c = 0) sai da lista do dono (0x539d50). Depois tira de [0x68d2dc]+4. O nosso
  `consumeDeath` só trocava de lista; o pensamento do grupo seguia rodando o morto. Agora ele sai do grupo, e o `exeGroupSync` não
  põe de volta quem tem a morte consumada. A lista de unidades do dono (+0x24) não é espelhada.
- Medidas: **m110 T=85 → T=517** (`player` de 24895–24897: 3 × 1 — troca de dono); **m31 T=997 → T=1840**; **golden 79,99 % →
  80,75 %** (1 janela pior, 14 melhores; CI saiu com 0); m70 e as 9 corridas antigas sem divergência; m30 1076, m50 834, m60 33
  iguais; loadcmp 46/46; test:sim, test:script e typecheck verdes.

# derive.py e databin.py no git (passo 2)
- `tools/data/derive.py` (gera o `game/public/data/*.json`, que continua fora) e `tools/data/databin.py` (o leitor do data.bin, que ele
  importa) lidos inteiros: são código. Há só rótulos e nomes de campo, os tetos de atributo do exe (0x5136a5) e as descrições das
  fórmulas, escritas por nós. A pasta `/tools/data/` está no .gitignore; os dois entram rastreados mesmo assim (os outros arquivos da
  pasta continuam fora).
- O único caminho do GOG era a fonte dos .alm de multijogador em `build_map_units` (só leitura). Agora é a cópia de execução
  `C:\Users\TALES K\Games\a2_run`: os 9 .alm são iguais byte a byte aos da instalação, e os 6 JSON gerados saíram idênticos aos
  de antes. Com a mudança do `effectsRaw` (o texto exato do efeito, com as aspas da Stone Curse).

# Os imports que faltavam ao tools/refcap/diff (passo 3)
- Lidos inteiros e commitados (código; sem dado do jogo e sem caminho do GOG — só docstrings que dizem que o GOG nunca é tocado):
  `tools/refcap/original/{audio_hook, make_audio_runtime, build_m103, build_m110}.py` e `tools/refcap/trace/make_lab_runtime.py`.
  As constantes são endereços e assinaturas de 3 a 9 bytes do exe para conferir o remendo. Os caminhos absolutos são das cópias de
  execução (`a2_audio`, `a2_diff`, `a2_run`, `a2_lab`). Com isso, `make_diff_runtime`, `levers_audio` e `levers_probe` importam a
  partir de um clone limpo.
- Aviso: `audio_hook`/`build_m103` escolhem a cópia pela variável `A2_RUN_DIR`, que o `launch.py` só lê numa mudança local de outra
  sessão, ainda não commitada (o mesmo vale para os pontos novos de `states.py` e o `dblclick` de `run_steps.py`). Sem ela, eles
  importam, mas rodam na `a2_run`.

# m60 T=33 → T=98: o giro do recálculo 0x51366b (= velocidade) e a medida do giro/velocidade pelo registro
- **T=33** (`turn` do herói: 19 × 16): o Bless da Dina no herói passa por 0x51d436 → vtable+0x58 (0x51366b), que faz giro = velocidade
  (19). Duas partes:
  - (a) Medida: o tickcmp lia o giro dos dados (`stats.turnSpeed`) e a velocidade efetiva de `stats.speed`. Agora lê os dois do
    registro (+0x1c0+0xa e +0x90).
  - (b) Motor: o gancho `recompute` dos humanos sem `exeBase` não mexia no giro, e a máquina o refazia pelos dados a cada tique. Agora
    o recálculo marca `turnFromRecompute` (giro = velocidade; fora do tique exato, "−1": a velocidade com o Haste/Slow só entra no
    registro na máquina, que então fixa o giro), e a máquina usa esse giro até o próximo recálculo. Nas `exeBase`, ele vem da porta.
- **T=1** (com a medida nova; `turn` da Dina: 16 × 18): a Dina do despejo tem giro 16 e velocidade 18 (o 0x51366b ainda não rodou
  desde que a velocidade mudou). A importação passou a guardar o giro do original em `turnFromRecompute`.
- **T=52** (`speed_eff`/`turn` da Dina: 20 × 18, o Haste nela): resolvido pelo "−1" acima.
- Medidas: **m60 T=33 → T=98** (o herói larga o alvo no original: `act` 0 × 1, `target` 0 × 24641, a mesma assinatura da m30 em 1076 e
  da m50 em 834 — a próxima a ver). As outras iguais (m70 e as 9 antigas sem divergência; m30 1076, m31 1840, m50 834, m110 517);
  golden 80,75 % (sai com 0); loadcmp 46/46; test:sim, test:script e typecheck verdes.

# m60 T=98, m30 T=1076, m50 T=834: a ordem do cliente acaba quando o despachante larga a tarefa
- Assinatura comum (`act` 0 × 1, `target` 0 × alvo, `walk_static` vazio × caminho): no original o herói, ao lado do alvo que anda, fica
  parado. Gancho de escrita (m60_join T=97): na perseguição (0x55574d → 0x555ace), o caminho dinâmico até a célula final (a dele) sai
  vazio, e walk+0x98 = 1 (0x555f47). Na cauda do despachante 0x56dca2, com a classe 3, vem IA+8 = 0 (0x56e341) e 0x56ed4e. A IA+8 fica
  0 até a ordem seguinte. Os pares do fnprobe gravados nesse trecho por `join_pairs.py` (pasta `m60_chase`) batem com a porta
  (0x56dca2 855/855, 0x55574d 1/1): o nosso fazia o mesmo no tique, mas o laço de ordens do motor antigo ("lado humano pelo porte")
  repunha a tarefa 5 no tique seguinte, a partir da ordem `attack` que seguia em `u.order`.
- **Correção** (`World.machine`): numa unidade do lado humano com a tarefa do exe, quando a máquina/despachante leva a IA+8 de 5 a 0
  com a ordem `attack` apresentada, a ordem acaba (`none`). No exe, a ordem do cliente vale uma vez (o pacote põe a tarefa).
- Medidas: **m50_join livre: nenhuma divergência** (antes 834); **m30 1076 → 2037**; **m60 98 → 282** (o `speed_eff`/`turn` da Dina:
  18 × 20, o fim do Haste); m70 e as 9 antigas sem divergência; m31 1840 e m110 517 iguais; golden 80,75 % (sai com 0); loadcmp
  46/46; test:sim, test:script e typecheck verdes.

# m31 T=1840 → nenhuma; m60 T=282 → T=302: o giro e a velocidade no próprio tique do recálculo
- m31 T=1840 (`turn` do herói 19 × 16): a subida de nível no golpe passa pelo recálculo 0x51366b no meio da máquina, e o giro vira a
  velocidade no mesmo tique. O "−1" adiava para a máquina seguinte. Agora o gancho já põe giro = velocidade do registro.
- m60 T=282 (`speed_eff`/`turn` da Dina 18 × 20): o fim do Haste (0x51cc9f tira da lista +0x20 e recalcula) e a velocidade do motor
  antigo só voltava na máquina seguinte. Agora o gancho refaz a velocidade (`speedOf`, que já não conta o efeito que saiu) fora do
  tique exato; o "−1" continua para o efeito que entra (o Haste novo só aparece na lista depois do recálculo).
- Medidas: **m31_join livre: nenhuma divergência** (antes 1840); m60 282 → 302 (`manamax` da Dina 187 × 186). As 9 antigas, m50 e m70
  continuam sem divergência; m30 2037 e m110 517 iguais; golden 80,75 % (sai com 0); loadcmp 46/46; test:sim, test:script e
  typecheck verdes.
- **Meta "tickcmp livre ≥ 99 % em ≥ 6 missões"**: sem divergência em 2400 tiques (ou no episódio inteiro) estão as missões 10 (6
  episódios longos + tickcmp), 20 (m20_start_s203), 31, 50 e 70 = 5 missões. A m30 está em 2037/2400 (84,9 %), a m110 em 517 e a
  m60 em 302. Obs.: o tickcmp reancorado (`--episode mXX_join`) quebra na m30/m60/m70 (CList::GetNext com POSITION nula em 0x5692d5,
  a patrulha importada na janela) — o modo reancorado dos episódios da junção não estava na bateria; a medida da meta é a corrida
  livre.

# m30 T=2037: do episódio (lixo de pilha no oráculo), não do motor — o limite [est] do destino fica
- Sintoma: `walk_goal` 0 × 0x808 em 24714–24717. Ganchos no oráculo: 0x5728fa (comando 0x12) → AI_MoveTo(IA+0x9c = 0), e o despachante
  manda 0x555411 andar para a célula 0. A onda até (0,0) dá caminho estático vazio, então destino 0 e fim de caminho no mesmo passo
  (walk+0x98 = 1), e a IA+8 volta a 0xb. Os pares do trecho (`join_pairs.py`, pasta `m30_walk`: 0x555411 4/4, 0x56dca2 218/218)
  batem com a porta.
- O nosso diverge pelo [est] do `World.order` (case "move"): o destino fora da área útil é limitado a 8..lado−9. Esse [est] vem de
  medida no JOGO REAL (m20_mage_s404, 24639, T=288: o original anda para oeste); no exe, a volta do caminho até a célula 0 lê lixo de
  pilha (0x54e886). Testado sem o limite: a m30 fica sem divergência em 2400 tiques, mas o golden cai de 80,75 % para 79,76 % (17
  janelas piores, todas de saves do jogo real). O lixo de pilha do Unicorn não é o do jogo, então o que o oráculo faz aqui é do
  episódio. **Desfeito; o limite fica.**
- Meta "livre ≥ 99 % em ≥ 6 missões": 5 missões sem divergência (10, 20, 31, 50, 70). A m30 para em 2037/2400 por esse artefato. Para
  a 6.ª: a m60 (T=302) ou a m110 (T=517), ou um episódio da m30 sem a fuga para a célula 0.
