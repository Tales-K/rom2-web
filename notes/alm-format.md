# Mapas `.alm` (assinatura `M7R`): formato

Método: desmontagem estática do `ROM2 Map Editor.exe` (nunca executado) com `pefile` + `capstone`, leitura dos
**recursos de diálogo** do editor (os rótulos dos controles dão nome aos campos) e verificação em todos os 57 mapas
instalados (46 em `scenario.res`, 11 na raiz do jogo). Parser: [tools/alm.py](../tools/alm.py) (os 57 fecham no byte final,
`tools/check_all_maps.py`). Exportador para o jogo: [tools/alm_export.py](../tools/alm_export.py).

## Onde está o leitor no editor

- Função de carga: `0x41af70`…`0x4242d3` do `ROM2 Map Editor.exe` (MFC 6 estático, 32 bits, base 0x400000).
- Despacho por tipo de bloco: tabela de saltos em `0x424868`. Entradas: 0 `0x423112`, 1 `0x4232b1`, 2 `0x4232e6`, 3 `0x42330c`,
  4 `0x42344b`, 5 `0x42359f`, 6 `0x42367a`, 7 `0x4239d3`, 8 `0x423e30`, 9 `0x423fc2`, 10 `0x4241eb`, 11 `0x42332b`, 12 `0x424251`.
- O leitor chama `CFile::Read` (vtable+0x34) campo a campo, com condições de versão (`>= 0x3db, 0x44c, 0x456, 0x47e, 0x488, 0x4ce, 0x514`).
  Todos os mapas do jogo têm versão 0x514 ou 0x640, então todos os campos condicionais estão presentes.
- Diálogos úteis (recursos `DIALOG`): 227 propriedades da unidade, 225/270 jogadores e diplomacia, 273 "Trigger Manager",
  272/277 gerentes de instâncias (ações) e checks (valores), 137 luz, 274 "Global map settings", 279/280 itens e magias,
  282/284 armadilhas, 286 "Group Repop", 287 lojas, 288 tavernas, 289 "Usable Pointer info", 295 música.
  Script de extração usado: parser de `DLGTEMPLATE` com `pefile` (não versionado; trivial de refazer).

## Contêiner (confiança ALTA)

```
cabeçalho 20 bytes: "M7R\0", u32 20, u32 ? (0x6448 / 0x14448 / 0x40048), u32 nº de blocos (=13), u32 versão (0x514=1300 ou 0x640=1600)
bloco i:
  cabeçalho 20 bytes: u32 flag (5 ou 7), u32 20, u32 tamanho_do_corpo, u32 tipo, u32 lixo (varia por mapa; ignorar)
  corpo
```
O tipo 0 ocupa 16 bytes a mais do que o campo de tamanho informa (o leitor lê campos fixos). Nos demais tipos o tamanho do corpo é exato.
Ordem fixa nos 46 mapas de missão: tipos **0, 1, 2, 3, 5, 11, 4, 9, 8, 6, 7, 10, 12**.

## Tipo 0: informações do mapa (660 bytes; confiança ALTA na estrutura)

| off | campo | origem |
|---|---|---|
| 0, 4 | largura, altura (80/144/256 nas missões) | confirmado |
| 8 | float ângulo solar (rad; π/4 típico) | slider "Solar Angle" (código 0x414711) |
| 12 | hora inicial em minutos (360 = 6h; slider em quartos de hora × 15) | "Starting Time" (0x414760) |
| 16 | `64 − brilho` | "Brightness" (0x41472f) |
| 20 | contraste | "Contrast" (0x41474e) |
| 24 | máscara de 13 bits (8191, 4095…) | desconhecida |
| 28..64 | contagens: jogadores, estruturas, unidades, **nº total de registros de script** (= ações + valores + gatilhos; 10.alm 32+21+16 = 69), bolsas (bloco 8), "repop" (bloco 10), tavernas, lojas, placas (bloco 11), pontos de música (bloco 12) | usadas pelos leitores dos outros blocos |
| 68 | char[0x40] nome do mapa (≤ 0x3c; lixo de memória em várias missões) | "Map Name" |
| 132, 136 | jogadores recomendados, nível mínimo | "Rec. Players", "Min. Level" |
| 140, 144 | desconhecidos (missões: 0 e 60000000; multiplayer: 120000/90000000…) | versão ≥ 0x488 |
| 148 | char[0x200] copyright | "Copyright" (≤ 0x1fe) |

## Conteúdo por tipo

| Tipo | Corpo | Situação |
|---|---|---|
| 1 | `u16[w×h]` id do tile: `id & 0x1fff = índice_do_arquivo*16 + linha` (arquivos `graphics/terrain/tile1-00..tile4-03` em ordem alfabética, 52 arquivos; cada arquivo é uma coluna de tiles 32×32). Bit 0x2000 = flag desconhecida | **confirmado visualmente** |
| 2 | `u8[w×h]` altitude | provável |
| 3 | `u8[w×h]` objeto de cenário: `ID do objeto + 1` em `objects.reg` (0 = vazio) | **confirmado visualmente** |
| 5 | jogadores, 76 bytes (ver abaixo) | ALTA |
| 11 | tavernas, lojas, placas (ver abaixo) | ALTA nas placas; estrutura nas outras |
| 4 | estruturas: 20 bytes `{x, y (24.8), tipo, u16 hp (%), dono, u16 id}`; +8 bytes quando `tipo == 0x21` ou `tipo & 0x1000000` (pontes de tamanho variável). `(x, y)` = centro da célula do canto superior esquerdo da pegada | **confirmado visualmente** |
| 9 | "efeitos": magias de item e armadilhas (ver abaixo) | estrutura ALTA, semântica parcial |
| 8 | bolsas e inventários (ver abaixo) | ALTA |
| 6 | **unidades**, 48 bytes (ver abaixo) | ALTA |
| 7 | **script da missão** (ver abaixo) | ALTA |
| 10 | registros de 16 bytes (só multiplayer): provável "Group Repop" `{grupo, atraso, flags, ?}` | hipótese |
| 12 | música: 0x1c bytes padrão + pontos `{x, y, raio, tema1..4 (−1 = vazio)}` | ALTA na estrutura |

### Tipo 5: jogadores (leitor 0x42359f)
`u32 cor` (o antigo "id"; pode repetir) · `u32 computador` (0 humano, 1 IA) · `u32 dinheiro` · `char[32] nome` · `u16 diplomacia[16]`.
O número do jogador usado por unidades, estruturas e scripts é a **posição na lista (1-based)**: o leitor de unidades compara o campo
com `player+4`, que o leitor de jogadores preenche com `índice+1`.
Diplomacia: `diplomacia[j]` é a relação deste jogador com o jogador `j+1`; bits 0..1 = 0 neutro, 1 inimigo, 2 aliado (radios
"Enemy/Neutral/Aliance" do diálogo 270, mapeamento em 0x42e07c); bit 0x10 = visão compartilhada ("Vision"). A diagonal vale 0x10/0x12.
Em 10.alm: Skrakan (8) tem tudo 0 (neutro); `Change diplomacy(7, 1, 1)` = "Make ogre angry" (1 = inimigo).

### Tipo 6: unidades (leitor 0x42367a, 48 bytes; confiança ALTA)
```
 0 u32 x, 4 u32 y   ponto fixo 24.8 (+0x80 = centro da célula)
 8 u16 tipo         ID de units.reg (66 Ogre (Lord), 71 Dragon, 24 Human Mage…)
10 u16 face         variante do tipo na tabela de modelos do jogo (= o ".N" do modelo: Troll.4 tem face 4)
12 u32 flags        0x10 = humano (radio Human/Monster)
16 u32 quest        bit0 Quest Kill, bit1 Quest Intersept, bit2 Quest Escort, bit3 No XP for kill (diálogo 227, 0x435640/0x436613)
20 u32 serverId     id do modelo em data.bin (= chave de game/public/data/unit-templates.json): o editor o resolve por (tipo, face)
                    em 0x425628; é também a tag `npc=` das falas em main/text/mission*.txt (10.alm: ogro 616, Troll.4 623,
                    dragão 651, Skrakan 2000). Ex.: o valor "1229 - max trolls hp" de 10.alm = vida do modelo 623 (Troll.4).
24 u32 jogador      posição 1-based no bloco 5
28 u32 bolsa        índice 1-based no bloco 8 (0 = sem inventário); o leitor subtrai 1
32 u32 direção      0..15 (16 rumos). Desenho (0x40c7fe): coluna do sprite = ((dir − 8) >> 1) & 7. Colocação aleatória sorteia 0..14
                    (0x41ec4c). 10 é o valor mais comum (7166 de 7246)
36 i16 hp, 38 i16 hp máximo   −1 = padrão do modelo ("HP"/"MaxHP")
40 u16 id           o "unit#N" dos scripts ("Unit ID:"). Os 2 bytes altos repetem os 16 bits baixos de x: o leitor lê 4 bytes
                    sobre +0x04 depois de ter lido x em +0x06 (artefato; ignorar)
44 u32 grupo        o "group#N" dos scripts (0 = sem grupo). Grupos não têm registro próprio: grupo N = unidades com este campo = N
```
Validação: nos 46 scripts, **todas** as 783 referências: `unit#N` (383), `group#N` (192), `player#N` (184) e
`structure#N` (24, `Health of building`) resolvem; não há ids de unidade repetidos em nenhum mapa. Os grupos batem com os nomes
do script (10.alm: grupo 3 = só o Ogre (Lord) = "ogres number"; grupo 11 = o troll do jogador "Troll1" = "1st troll alive?";
grupo 14 = 4 Sonic Bat do "Troll4", que "Phase In/Out Group" e "Defend unit#23 (4º troll)" usam; 20.alm "sheeps stand" = 4 WarSheep…).
Ids especiais (não estão no bloco 6): **10001 herói, 10002 cavaleiro, 10003 Dina** (pelos nomes: "Good ranger to hero/knight/dina").

### Tipo 8: bolsas e inventários (leitor 0x423e30)
`contagem` (bloco 0) × `{u32 n_itens, u32 unidade (id; 0 = bolsa no chão), u32 x, u32 y (24.8), u32 dinheiro}` +
`n_itens × {u32 item, u16 flag (provável "Wielded"), u32 magia (1-based no bloco 9; 0 = nenhuma)}`.
10.alm: a bolsa 1 é de Skrakan (unidade 32) com o item 3661 (os "documentos" que `Give All(Skrakan → herói)` entrega).

### Tipo 9: "efeitos" (leitor 0x423fc2)
`u32 n` + n × `{u32 a, u32 x, u32 y, u16 modo, u32 alvo, u16 p1, u16 p2, u32 m, m × (u16, u32)}`. É a mesma lista para:
- magias de item (x = y = 0; entradas = (modificador, valor); referenciadas pelos itens das bolsas), ex.: 32.alm "Get Sword";
- armadilhas e lançamentos a partir de estrutura (x, y = origem; modo 4 = "Cast from structure": o editor procura a estrutura em (x, y)
  e grava o id dela em `alvo`; `a` parece ser a magia e p1/p2 potência/alcance; nas armadilhas as entradas são posições (x, y) de disparo).
Semântica parcial (missões 93–96: paredes de fogo/pedra, névoa).

### Tipo 11: tavernas, lojas, placas (leitor 0x42332b; contagens no bloco 0)
- tavernas, 12 bytes: `{estrutura, flags, item de entrega (−1 = nenhum)}` (diálogo "Tavern Quests"; só multiplayer);
- lojas, 0x54 bytes: `{estrutura, i32[20]}` = 4 prateleiras (máscaras de material/forma, preço mín./máx., máx. itens…; só multiplayer);
- **placas**, 12 bytes: `{estrutura, ligada, índice_da_ação}` (diálogo "Usable Pointer info: Instance ON"): clicar na placa executa a
  ação do bloco 7 na **posição** `índice` (0-based, não o seq). Conferido: 10.alm estrutura 42 (placa, kind 74) → ação 26
  "Send message 9 - pointer to tower" (mensagem 19 = "To Great Mage Skrakan's Tower"); 20, 21, 30, 40 e 50.alm idem. Algumas placas
  aparecem repetidas (artefato do editor).

### Tipo 12: música (leitor 0x424251)
0x1c bytes do conjunto padrão + `contagem` × 7 dwords `{x, y, raio, tema1..tema4}` (−1 = vazio; temas = Melody1..17 de `Music.ini`,
provavelmente 0-based). 10.alm tem 7 pontos; o primeiro, (14, 41) raio 6, cobre o ponto de entrada do herói.

### Tipo 7: script da missão (leitor 0x4239d3)
```
u32 n0, n0 × 0x31c   ações ("instances")
u32 n1, n1 × 0x31c   valores ("checks": condições, variáveis, constantes)
u32 n2, n2 × 0xb8    gatilhos
registro de 0x31c:
  0x000 char[0x40] nome | 0x40 u32 tipo | 0x44 u32 seq (id usado pelos gatilhos) | 0x48 u32 "Execute once"
  0x4c  i32[10] valor de cada parâmetro (slot 0..9) | 0x74 u32[10] tipo de cada parâmetro | 0x9c 10 × char[0x40] rótulo ("<None>" = vazio)
registro de gatilho (0xb8 = 46 dwords):
  w0..31 char[0x80] nome (+ lixo de memória) | w32..37 três pares (a, b) de seq de valores (a = 0: vazio)
  w38..41 até 4 seq de ações | w42..44 operador de cada par | w45 "Run Once"
```
- **Operadores** = índice do botão de rádio do diálogo 273 (WS_GROUP só no primeiro de cada grupo), gravado sem conversão (0x414fa4,
  0x415285): **0 `==`, 1 `!=`, 2 `>`, 3 `<`, 4 `>=`, 5 `<=`**. (A versão anterior desta nota dava 3 `>=`, 4 `<=`, 5 `<` por palpite; os
  exemplos "distância 5 4" continuam fazendo sentido como `<=`.) Uso nos 719 gatilhos: 0 = 1368, 5 = 410, 1 = 199, 2 = 127, 3 = 29, 4 = 12.
- **w45 = caixa "Run Once"** (membro +0x25c do diálogo ↔ +0x344 da cópia do registro, que começa em +0x290): 1 = dispara uma vez
  (585 gatilhos), 0 = repete a cada avaliação enquanto a condição valer (130: "Counter", "Spell timer", "Ensure knights 1", paredes de fogo…).
  Não existe campo de "ativo", de período nem de atraso no registro (o diálogo só tem nome, 3 condições, 4 ações, Run Once e os
  operadores; as três caixas sem rótulo 0x481..0x483 só habilitam as linhas "And" na interface). O antigo `enabled` era este w45.
- Todas as condições precisam ser verdadeiras (AND); ao disparar, executa as ações em ordem.
- **"Execute once"** (0x48) existe nos dois gerentes; vale 0 em todas as 1350 ações e 1 em 162 de 986 valores (missões 102 e 110 o
  ligam em quase tudo, inclusive no contador que precisa ser reavaliado). Provavelmente sem efeito no jogo.
- Tipo de parâmetro: 1 inteiro, 2 grupo, 3 jogador, 4 unidade (10001..10003 = herói/cavaleiro/Dina), 5 X, 6 Y, 7 constante enumerada,
  8 item, 9 estrutura (id do bloco 4). X/Y são coordenadas de **célula** (inteiras).
- Tipo do registro: ações em `Description Instants.ini`, valores em `Description Checks.ini` (pasta do jogo). Vários grupos do .ini
  dividem o mesmo ID: **ação 6 = comando de grupo**, o subcomando vem no slot 0 ("Const": 1 Guard, 2 Swarm, 3 Stand Ground, 4 Move,
  5 Swarm 2, 10 Attack, 11 Defend, 14 Patrol, 15 Follow, 17 Roam, 18 Dwell) e o grupo no **slot 9** (slot 1 em Follow); ação 65538 =
  "Drop Location", valor 65538 = constante ("TRUE"/"FALSE" quando o rótulo é "Const"). O antigo parser só lia os slots 0..8.
- **Ponto de entrada do herói**: a ação "Drop Location" (65538, X/Y). Todas as 46 missões têm exatamente uma e nenhum gatilho a chama:
  é um marcador estático (10.alm: (11, 41), ao lado da placa 42).
- Mensagens: `Send message N` ↔ `texts/mission<M>.json` seção `event<N>` (517 de 529 resolvem; faltam `event250` "mission given" em
  20/31/50, `event20` em 30, `event10..12` em 71, `failure0` em 10/20/30, `failure7` em 40, `failure5` em 96); `Force "Mission Fail"(N)` ↔ `failure<N>`. A tag `npc=` das falas é o `serverId`
  da unidade que fala (21 = o herói).
- Validado: 2859/2860 referências de condição (a que falta é um −1 em 42.alm) e 2860/2860 de ação apontam para `seq` existentes.
- Nomes em inglês nesta versão. Totais nos 57 mapas: 1350 ações, 986 valores, 719 gatilhos. Dumps legíveis em
  [`data/scripts/`](../data/scripts) (`tools/script_dump.py`; gerados antes da correção dos operadores 3/4/5).

Exemplo (`10.alm`): `Come to ogre first time  IF [Hero to ogre distance] <= [4] AND [v70] == [FALSE]  THEN Send message 4 - ogre first, v70++`
(unit#10001 = herói, unit#5 = unidade 0, Ogre (Lord) do jogador 7 "Ogre").

## O que falta
1. Frequência com que o jogo avalia os gatilhos (está no `allods2.exe`, não no editor) e se "Execute once" dos valores tem efeito.
2. Bit 0x2000 dos tiles; máscara do bloco 0 (+24); campos 140/144 do bloco 0; bloco 10 e os detalhes de lojas/tavernas/efeitos.
3. Qual rumo da bússola corresponde a cada coluna do sprite (a direção 0..15 e a coluna já estão decifradas).
4. Escrita de `.alm` (só para um editor web).

## Ferramentas baixadas (todas do PyPI, instaladas só em `.venv/` do projeto)
`pillow 13.0.0`, `numpy 2.5.4`, `pefile 2024.8.26`, `capstone 5.0.9`.
