# Etapa 9b — carregador de missão, tique 0 exato (passagem)

Briefing, ferramentas e categorias: `docs/briefings/ETAPA9B-CARREGADOR.md`. Aqui: o que entrou por lote, números e o próximo lote.

## Como medir
```
PYTHONUTF8=1 .venv/Scripts/python.exe -X utf8 tools/re/oracle/load_mission.py --all     # 46 despejos, ~2 min, refs/oracle/load/
cd game && npm run loadcmp [-- 10,20] [--show M] [--dump ../scratch/x.jsonl]           # nosso carregador × despejo
npm run tickcmp -- --all                                                                # reancorada + corrida sem reimportar
```
O despejo traz `load_rand` (semente antes do 1.º sorteio de 0x4eb715, nº de sorteios e sítios); o comparador passa a semente ao nosso
`buildMission` (`opts.seed`) e confere o nº de sorteios (`rng|carga`, sem o do nosso herói). tickcmp ganhou `--free-show T` (sorteios,
estado antes do passo, campos do andar/IA/unidade e dados dos grupos × o despejo do tique seguinte na corrida livre; `TRAP_TASK=<id>`
mostra quem escreve IA+8 dessa unidade).

## Lote 1 (2026-10-29)
- **Rumo inicial**: o construtor de toda unidade 0x50e173 faz `andar+0 = andar+1 = Rand_Inclusive(0x80) + 0x40`; o servidor não lê a
  direção do `.alm` (0x561bf9). Os 46 despejos: 1 sorteio por unidade, todos no sítio 0x50e2b6, na ordem do `.alm` (= a lista
  `[0x68d2dc]+4` na carga fresca). `World.spawn` sorteia (toda criação, como no exe); sai o `u.dir` do `.alm` em `buildMission`.
- **Diplomacia**: byte do exe = consigo mesmo 0x12; senão bits 0..1 do `.alm` | 0x10 (visão partilhada, `players[].vision` do mapa).
  `w.dip` guarda o byte inteiro e a tabela do exe (`dipTable`) também (antes `& 3`: 0x567c56 compara o byte inteiro com 2).
  Confere 10 345 de 10 350 células nos 46 despejos; sobra a m92 (um 8.º jogador em guerra com 1/5/7 que o nosso mapa não exporta).
- **Corrida sem reimportar do tickcmp** (1.ª divergência T=1 nos três): três defeitos de integração/arnês, nenhum do passo portado:
  1. `resetWorld` guarda IA+0x20 (alvo atribuído pelo grupo) da corrida reancorada anterior e a importação não o traz → a corrida livre
     passa a ler IA+0x20 do despejo (endereço → a nossa unidade) — `g_assigned` saiu.
  2. `exeSyncWorld` refazia a lista viva (mundo+4) e as do contentor `[0x68d2dc]` na ordem dos ids a cada tique fora do importado; a ordem
     decide quem roda e sorteia primeiro (m20_start: a do despejo é 1, 24600, 24603, …, 24639, 24640, 24662, …). Agora as listas guardam a
     ordem que têm (sai quem não pertence, entra no fim: AddTail do exe); o snapshot/save leva a ordem (`exeWorld.lists`).
  3. `exeApplyPlayers` (grupos importados do despejo) não marcava o comando de grupo do `AiMode` como aplicado → no 1.º passo fora do tique
     importado `exeSyncGroups` reaplicava o Stand ground 0x570b8b e zerava IA+8 de 4 unidades (m20). Agora os grupos importados entram em
     `groupCmdApplied`.
  Também: a corrida livre restaura o `rng` depois dos sorteios da importação, como a reancorada.

| | antes (dd4ea6d) | depois |
|---|---|---|
| loadcmp: missões com tique 0 exato | 0 / 46 | 0 / 46 |
| loadcmp: pares idênticos | 96,67 % (19 849 divergentes) | 98,74 % (7 514 divergentes) |
| tickcmp reancorada (m10_start / m10_mage / m20_start) | 100,0 / 99,9 / 100,0 % | 100,0 / 99,9 / 100,0 % |
| tickcmp sem reimportar, 1.ª divergência | T=1 / 1 / 1 | **T=322 / 822 / 740** |
| golden limpas (`--ci`) | 79,43 % | 79,37 % (verde; 1 janela pior, `pos|t74` m10_start_s1 688–720) |

A janela pior do golden persiste com o lote inteiro desligado (chaves de ambiente temporárias em cada mudança, todas juntas): não é
deste lote; o checkout compartilhado roda bem longe do HEAD (o arnês do golden nem está no git), então a referência de 79,43 % não é
reproduzível só pelo commit. Na bissecção, a 1.ª versão das listas estáveis derrubava o golden a 72,8 %: `World.spawn` põe o herói no
fim de `lists.all` (nasce depois do mapa) e a ordem antiga o punha à frente — corrigido (herói sempre à frente, como nos despejos).

Corrida sem reimportar, o que sobra: m10_start T=322 só `rng`; m10_mage T=822 = o +0x12c do `syncCombat` (`notes/residuo.md`);
m20_start T=740 `act`/`dir16`/`rng` (24616, 24660).

## Lote 2 (2026-10-29): a criação das unidades portada
- **`game/src/sim/exe/create.ts`**: a criação literal a partir do modelo CRU de data.bin (`unit-templates.json` ganhou `raw` = o CArray<int>
  e `rawItems` = as strings de equipamento; `tools/data/derive.py`, local, regenerado: o resto dos JSON ficou byte a byte igual).
  Monstro: 0x50ec60 → 0x5114f3 Monster_LoadTemplate → **0x511959** (o "Human_Create" do known_functions é o ramo do MONSTRO; renomeado
  `Monster_CreateFromTemplate`): itens pela vtable+0x44 (0x510883 → item+0x38), livro (magias de chance +0x7c/+0x88 = prob × 0x147; a
  máscara [0x38] troca o livro inteiro), habilidades [0x36]/[0x39..], 0x5113e7, 0x557a89, 0x57382c. Humano: 0x5121e1 → 0x5145d1 → 0x514cf2
  (o laço das habilidades vem do assembly) → itens (0x512638 → 0x512573: serve a lutador/mago) → livro (só com mana) → 0x513497 (0x5128ac,
  tabela 0x512824 = ftol((1,1^i − 1) × 1000), conferida na imagem) → **0x51366b já portado** → vida/mana cheias. Itens: 0x5290cc (arma;
  classe ≥ 10 = Flame Thrower/Sonic: o golpe vira elemental e o toHit do bônus = +0xa8, por isso o dragão tem 740 = 2 × 370), 0x52846b
  (escudo), 0x527a13 (armadura), 0x50f065 (carga), 0x52377e (efeitos "{...}" pela tabela de nomes 0x5f8f50 → 0x51d175/0x51d436). Os
  atributos do item ainda vêm de items.json (o construtor 0x528808/0x527e23/0x5273f0 não está portado).
- **`mission/unitcreate.ts`**: o registro criado vira os `UnitStats` (que `syncCombat` escreve de volta a cada tique) e os campos que o
  motor não reescreve (atributos, bônus +0xd4.., experiência, +0x1c, IA+0x4c/+0x7c/+0x88) passam à unidade. `buildMission` o usa para as
  unidades do mapa (companheiros e invocações seguem o `statsFor`); vida/vida máx. do `.alm` como 0x561bf9 (`hp`/`maxHp` do JSON; humano
  com as duas iguais = as do modelo); o modelo de herói no mapa (Dina/10230 na 40) fica com o tipo +0xe de herói (0x24).
- `World.exeSyncGroups`: IA+0x88 = probabilidade × 0x147 (era × 0x8000 ÷ 100).
- **Comparador**: `w.syncRecs()` antes das vistas (o que o 1.º passo vê: o livro e a IA+0x7c só eram sincronizados no passo — era todo o
  `u.book`); o `hero` do despejo da carga é uma unidade do MAPA (read_state escolhe uma; não há herói na carga) e casa pelo id como as
  outras — era todo o `alive|n<id>`; IA+0x4c, +0x7c[3] e +0x88[3] entram no comparador (todos iguais).
- **AI_SetDefaultWimpy 0x57382c** é morto na carga: só 0x511959 o chama, com a vtable de monstro (vt+0x30 = 0x542420 → 0). Os 46 despejos
  têm Withdraw/Wimpy = 0 em todos os humanos. A leitura de `notes/ai-original.md` ("humanos recebem 0x57382c") está errada. O resíduo
  `withdraw`/`wimpy` (25 missões) é o trecho NÃO commitado de `sim/behaviors.ts` (installMissionAi aplica o padrão aos humanos): desligado
  à mão, loadcmp dá 26 de 46 missões exatas sem o MapRec; perguntei ao coordenador antes de tirá-lo da árvore.

| | antes (754f17a) | depois |
|---|---|---|
| loadcmp com o MapRec: pares idênticos | 98,74 % (7 514 divergentes) | 99,77 % (1 427 de 630 346; o casamento novo e a IA a mais somam pares) |
| loadcmp `--no-map`: missões exatas / pares | 0 / 46 | **13 / 46**, 99,80 % (26 / 46 e 99,84 % sem o trecho alheio de behaviors.ts) |
| tickcmp reancorada / sem reimportar | 100,0 / 99,9 / 100,0 %; T=322 / 822 / 740 | igual |
| golden `--ci` | 79,37 % | 79,37 % (CI ok; a janela pior antiga) |
| `test:sim` | verde | verde |

Resíduo do lote, nomeado: `walk.f72` (3 unidades, m40/m72) = a velocidade da célula (0x55687d) com a unidade na mesma célula: o MapRec
"passo" (lote 4). `t.f20`/`u.task` (5 missões) e `g_radius`/`g_base` (12) = grupos (lote 3). `dip` m92 = o 8.º jogador (lote 1).

### Lote 2b (mesmo dia): a colocação
O carregador chama a colocação 0x510089 com raio 0: só a célula do `.alm` (sem vizinha; se não couber, "Can't place unit" e a unidade
não existe). Nos 46 despejos, 190 de 191 unidades que o nosso `grid.nearestFree` movia estão na célula do `.alm`; a outra (e 8 mais) é a
última linha dos mapas de 64/128, que 0x54fca8 prende a [8, largura − 9] × [8, altura − 9]. `UnitInit.exactCell` (World.spawn) faz isso
para as unidades do mapa (`buildMission`). loadcmp `--no-map`: **17 de 46** missões exatas, 99,96 % (com o MapRec 99,82 %); o `g_radius`/
`g_base` dos grupos caiu junto (era a posição). tickcmp, golden (79,37 %) e test:sim iguais.

Resíduo depois do 2b, nomeado: `withdraw`/`wimpy` (25 missões) = o trecho não commitado de behaviors.ts (acima); vida 0 no `.alm`
(m30 ×2, m50, m101: `u.task`/`t.f20`/`walk.footCell`/+0x86..+0x89) = o trecho NÃO commitado de setup.ts que as derruba com
`World.knockOut` (o original só põe a vida 0; o HEAD dava 5 % da vida); `u.task` 0xc × 0xb nas unidades do jogador 1 (m53, m73: 5) =
o modo de grupo do lado humano (lote 3); `walk.f72` (3) = MapRec "passo" (lote 4); `g_radius`/`g_base` m30 G6 (8 × 20) = AI_GuardLoad.

### Lote 2c: o padrão 0x57382c dos humanos sai da árvore
Com o aval do coordenador, saiu da árvore o trecho NÃO commitado de `sim/behaviors.ts` (`installMissionAi`) que dava aos humanos o
padrão de 0x57382c (com livro: Withdraw = vida máx., Wimpy = ¼; à distância: Withdraw = ½). Evidência: os 46 despejos do tique 0 têm
Withdraw/Wimpy (IA+0x40/+0x44) = 0 em todos os humanos, e o C mostra que 0x57382c só é chamado por 0x511959 — o ramo do MONSTRO, com a
vtable 0x5d0eb0, cuja vt+0x30 é 0x542420 → 0, então ele sai na hora (os humanos, 0x5143e4 → 0x5145d1, nem passam por 0x511959). O hunk
removido está salvo em **`notes/carregador-removido-behaviors.patch`** (não versionado; `git apply` o devolve). Os outros trechos não
commitados de behaviors.ts ficaram. `sim/test/formulas.ts` passou a afirmar 0/0 na carga e dá ao mago os limiares à mão para seguir
testando a fuga por Teleport.

loadcmp `--no-map`: **35 de 46** missões exatas, 99,99 % (57 pares); com o MapRec 99,96 % (0 de 46: o MapRec diverge nas 46). tickcmp
(100,0 / 99,9 / 100,0 %; T=322 / 822 / 740), golden (79,37 %, CI ok) e test:sim iguais. O `g_radius`/`g_base` do G6 da m30 sumiu junto
(o raio vinha do Withdraw). Resíduo, nomeado: vida 0 no `.alm` (m30 ×2, m50, m101: o `knockOut` do trecho não commitado de setup.ts),
`u.task` 0xc × 0xb nas unidades do jogador 1 (m53, m73), `walk.f72` (3, MapRec "passo") e `dip` da m92 (8.º jogador).

## Lote 3 (2026-10-31, cc63871): grupos do jogador 1, MapRec, sacos e prédios
- **Grupos do jogador 1** (0x562745, ramo da carga): grupo cujo dono+4 = 1 recebe `AI_NewGroupStandGround 0x570f2b` (0x570e83 + Stand
  ground 0x570b8b: comando 3, tarefa 12), não `AI_GuardLoad`. Nos 46 despejos só há 5 unidades assim (m53 Ataman G29, m73 G17 ×4).
  `World.initGroupGuard(setup)` aplica 0x570f2b ao grupo (por unidade, como o resto do lado humano) e marca o Guard padrão da unidade
  (`AiMode.load`) para que `exeGroupSync` não o tome por comando 1 do script; o script que der Guard troca o objeto.
- **MapRec, constantes do construtor 0x54d2d9** (`mapbuild.ts initCtorTables`): tamanhos de bloco dos contentores MFC, +0x54190+0x3f0 = 2
  (0x55f2f0), as tabelas de 0x553d51 (canto +0x540a6, par de terrenos +0x54126, +0x5413e, custo por terreno +0x54146 = os valores do
  map.reg nos despejos), +0x58ebc/+0x58ebe (0x554626), visão +0x2a000 = 1 << ScanShift e a tabela dx² + dy² em +0x20000 (0x552244).
- **Passo** (+0x0): pelo tile com `Path_RockClass 0x55494d` lendo as tabelas do próprio MapRec (`Grid.tile`, `tilePasso`): pega a última
  linha dos mapas e os tiles de classe ≥ 0xd (0xff); nas células livres do pé das estruturas o padrão +0x5414b = 6 (0x550a96). O
  `walk.f72` (m40/m72/m90) era isto.
- **Pontes de tamanho variável** (tipo 0x21 com `extra`): estrutura de largura extra[0] e máscara 0 (`exe.structs` dos despejos) — um
  registro por célula do tabuleiro (máscara 0x20) e passo 6. **Prédios sobrepostos**: 0x5599df põe o prédio célula a célula e para na
  1.ª que já tem outro (0x559890 → 0), ficando com as que pôs (`Grid.structs[].n`): m30 casa #37 sobre a cabana #27 (nenhuma célula; o
  despejo tem 40 de 41 estruturas), m40 ferraria #43 sem a última linha.
- **Sacos**: 0x5538c7 (põe: 0x5508a0 + saco em +0x10 + 0x550a53), 0x5539e5 (tira; registro vazio → 0x550966) e 0x553ad1 portadas em
  `wave.ts`; `World.exeSyncBags` (no `exeSyncWorld`, fora do modo exato) acompanha `loot` — todo saco, também o vazio do mapa (m93 13,16).
- **Comparador**: `MAP_MASKED` em `load_compare.mts` com o motivo de cada faixa — ponteiros (vtables, heap, globais, o mapa, o arquivo),
  os 4 cronômetros de perfil 0x55f290 (QueryPerformanceFrequency do arnês), o OccRec corrente +0x5402c (rascunho da última consulta);
  `m_nCount` do CMap comparado pelo nosso objeto (`map.ocupacao`); a célula do nosso herói fora das máscaras e da contagem.

| | antes (442747b) | depois (cc63871) |
|---|---|---|
| loadcmp `--no-map`: missões exatas / pares | 35 / 46, 99,99 % (57) | **40 / 46**, 99,99 % (44) |
| loadcmp com o MapRec | 0 / 46 (resto, passo, máscaras em todas) | **38 / 46** |
| tickcmp reancorada / sem reimportar | 100,0 / 100,0 / 100,0 %; T=322 / nenhuma / 740 | igual |
| golden `--ci` | 79,7 % | 79,74 % (CI ok; a janela pior é a antiga `pos|t74`) |
| typecheck, `test:sim` | verdes | verdes |

### Resíduo nomeado (8 missões com o MapRec)
- **Vida 0 no `.alm`** (m30 ×2, m50, m101: `walk.footCell`/+0x86..+0x89, `u.task`, `t.f20`; e o `g_radius`/`g_base` do G6 da m30, que
  sai das mesmas duas unidades): o trecho NÃO commitado de `mission/setup.ts` chama `world.knockOut` na carga; o original deixa a
  unidade normal na célula (tarefa 11 do Guard), só com vida 0 — a queda é do 1.º tique. Fora do meu escopo (`game/src/mission/`);
  perguntei ao coordenador.
- **Forma do "Polymorph unit"** (m31 24741, m42 24702): `buildMission` (HEAD) faz `world.phaseOut` na carga; o original a deixa nas
  células no tique 0. Mesmo arquivo, mesma pergunta. Conferir no C da ação 0x57… do script como o exe esconde a forma antes de mudar.
- **m92 `dip` 1/5/7 × 8**: o 8.º jogador (sem unidades) em guerra; `alm_export.py` corta a diplomacia em `players.length` e
  `buildMission` monta a tabela por ela (tools/ e mission/, ambos com trechos alheios). Inerte no jogo.
- **Armadilhas do bloco 9** (m76 ×12, m93 teleportes ×N): o exe cria um registro de ocupação por armadilha (+0x34 = magia/0x17,
  +0x35 = poder, +0x36 = célula, +0x38 = destino, +0x3a = célula); o nosso trata as armadilhas no `mission/host` (`setTrap`) e não
  marca o MapRec. Pôr os registros exige ler o carregador dos efeitos (0x5626bc/0x562274?) e tirar o tratamento do host, senão o andar
  portado (que lê +0x34 = 0x17) teleporta em dobro.
- Fora do comparador ainda: o construtor dos itens (atributos de items.json), os registros de ocupação byte a byte (só a contagem e as
  máscaras entram), os dados dos grupos do exe em bytes, e a junção do herói (lote 5).

### Lote 3b (mesmo dia, com o aval do coordenador para `mission/setup.ts`): vida 0, Polymorph e a unidade sem grupo
Evidência do original (despejos do tique 0, `refs/oracle/load/`):
- **(a) vida 0 no `.alm`**: m30 24622/24623, m50 24620, m101 24583 estão de pé na célula (`cell` 0x736f/0x7772/0xf10/0xe16, footCell
  marcada), estado 0, ação 0, tarefa 11, comando do grupo 0x12 (AI_GuardLoad), só `hp` = 0 (vida máx. 42/55/100/333). Nada de queda
  na carga: ela é a de 0x50f12c (vida ≤ 0) no 1.º tique. Saiu o `world.knockOut` da carga (trecho WIP não commitado); ficam os sets
  `dazed`/`weak`/`mapDazed` do host (servem ao script; o tique 0 não os contradiz), `helpless` (não é do exe) e a vida 0. A queda
  passa para o começo do 1.º passo (`World.knockOutAtFirstStep`, gravado no snapshot). [est] Com a queda animada da máquina (sem o
  `knockOut`) o dragão aliado (jogador 3, caminho portado) lança Heal no druida chefe da m101 caído no tique 15 e ele levanta —
  `missions_90s` quebrava; a m101 não tem episódio no oráculo para dizer quem está certo, então o `knockOut` no 1.º passo mantém o
  comportamento que o jogo tinha a partir do tique 1.
- **(b) a forma do "Polymorph unit"**: m31 24741 (id 165) e m42 24702 (id 126) estão nas células no tique 0 (vida cheia, tarefa 11,
  comando 0x12). O próprio script tem "Phase out unit" para elas (m31 [165], m42 [126]): saiu o `world.phaseOut` da carga; o nosso
  script as tira de cena no 1.º ciclo (fase em < 1 s; `missions_kaarg` m42 confere as duas coisas).
- **A unidade sem grupo** (m30 24679, `group: null` no `.alm`): no original ela tem um grupo só dela com comando 0x12 (AI_GuardLoad,
  como todo grupo na carga 0x562745); o nosso dava o Guard do script (comando 1). `World.initLoadGuardAlone` aplica 0x570aba ao grupo
  dela e marca o Guard padrão como da carga.

| | antes (5d78e65) | depois |
|---|---|---|
| loadcmp `--no-map` | 40 / 46 | **45 / 46** (sobra a m92 `dip`) |
| loadcmp com o MapRec | 38 / 46 | **43 / 46** (m76, m93 armadilhas; m92) |
| tickcmp, golden `--ci`, `test:sim`, `test:script` | 100,0 / 100,0 / 100,0 % (T=322 / nenhuma / 740), 79,74 %, verdes | iguais |

Atenção: o HEAD de `mission/setup.ts` não tem o laço `world.initGroupGuard(g, list, 0, true)` da carga (é um trecho WIP não
commitado na árvore); sem ele o Guard da carga (e o Stand ground do jogador 1 do lote 3) não roda. Os números acima são da árvore.

### Lote 3c: a diplomacia do 8.º jogador (m92)
A carga 0x561422 copia as 16 entradas de diplomacia do `.alm` de cada jogador presente para a tabela do mundo, também as dos jogadores
que não existem: na m92 (7 jogadores) as linhas 1, 5 e 7 têm 1 (guerra) na coluna 8 (despejo do tique 0; o script não troca dono de
ninguém, então é inerte no jogo). `alm_export.py` ganhou `players[].diplomacyRaw` (as 16 entradas cruas; os JSON de mapa foram só
acrescidos desse campo — a regeneração inteira também traria o `tileBlock` do trecho alheio não commitado, que não mexe no loadcmp);
`buildMission` estende a linha de cada jogador presente até a 16.ª entrada (`& 0x13`) e `exeSyncWorld` copia a linha inteira.
loadcmp `--no-map` **46 / 46**; com o MapRec 44 / 46 (m76, m93). tickcmp, golden 79,74 %, test:sim, test:script iguais.

**Armadilhas do bloco 9 (m76, m93) — não é só o carregador.** O registro vem de 0x55ba36 (0x564072 na carga e 0x57847e "Set trap" do
script): cria o registro (0x5508a0), copia 6 bytes em +0x34 (0x55b978: magia, poder, x, y, x/y de destino), grava e reaplica. Com o
registro no MapRec o andar portado (0x5503af) passa a dispará-las: 0x17 põe o destino em IA+0xb0 para `Unit_TeleportTo 0x55a96c`
(NotPorted), as outras chamam 0x4f0832 / 0x4f086f → 0x4f06ac (o lançador de magia da armadilha: aloca um conjurador, 0x51c29e livro,
0x50dc2b, 0x519466, 0x51906d — pendentes), também NotPorted. Hoje o `mission/host` imita os teleportes (`setTrap`) e ignora as de magia.
Fechar m76/m93 = portar 0x55ba36/0x55b978, o trecho de 0x564072, 0x55a96c e a família 0x4f06ac, e tirar a imitação do host.
**Fechado em 06/11** (notes/largar-synccombat.md, "armadilhas do MapRec"): 0x55ba36/0x55b978, o trecho da carga (World.exeAddMapTraps),
o Set trap 0x57847e e Unit_TeleportTo 0x55a96c portados e provados (synth_traps.py); loadcmp com o MapRec **46 / 46**. A família 0x4f06ac
(armadilha de magia) segue numa ponte para o motor antigo (`WorldRec.trapCast`).

## Próximo lote (4)
1. Feito no 3b. Pendente: commitar o laço WIP `initGroupGuard(..., true)` de `buildMission` (dono: o coordenador).
2. Armadilhas no MapRec (acima) e a diplomacia do 8.º jogador.
3. O resíduo da fase 1 (`notes/bugs-2026-10-31-fase1.md`): o gatilho do script no tique de pensamento (0x57485b roda 1×/s; o nosso
   `runtime.update` roda por tique: conferir no C antes de mexer em `script/runtime`) e o crescimento de vida/mana máx. pela XP.
4. O herói (lote 5).
