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

## Próximo lote (3)
Os grupos: `AI_GuardLoad 0x570aba` (`g_radius`/`g_base` do G6 da m30), a tarefa 0xc das unidades do jogador 1 (m53, m73) e os dados de
grupo do exe em bytes no comparador. Depois o MapRec (lote 4: mascarar ponteiros na faixa "resto" +0x5400c…, passo 6 do pé das estruturas — inclui o
`walk.f72` acima) e o herói (lote 5). Fora do comparador ainda: o construtor dos itens (atributos de items.json) e o resto da criação
para os companheiros/invocações (`spawnCompanions`, `summonFactoryFor` usam o `statsFor`).
