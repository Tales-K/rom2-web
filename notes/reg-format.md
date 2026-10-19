# Arquivos `.reg` — base de dados do jogo (confiança: ALTA)

São uma variante em árvore do contêiner `&YA1`. Parser: [tools/reg.py](../tools/reg.py); todos os 17 `.reg` extraídos abrem sem erro
(só `video/*.reg` tem um tipo de nó `4` ainda desconhecido). Dados exportados em `data/reg/*.json`.

```
0x00  "&YA1", u32 0, u32 n_raiz, u32 flags (0x11), u32 n_entradas, u32 0, u32 0          (cabeçalho de 0x1c bytes)
0x1c  n_entradas × 32 bytes: u32 a, u32 b, u32 tipo, char[20] nome
      área de dados logo após a tabela
tipo 0 texto    a = offset na área de dados, b = tamanho (com NUL)
tipo 1 pasta    a = índice do 1º filho, b = nº de filhos     (os filhos da raiz são as n_raiz primeiras entradas)
tipo 2 inteiro  a = valor
tipo 6 vetor    a = offset na área de dados, b = bytes (u32 little-endian)
```

## O que cada arquivo guarda
| Arquivo | Conteúdo |
|---|---|
| `graphics/units/units.reg` | 61 definições de unidade (`Unit0`…`Unit60`) + lista `Files` de caminhos de sprite |
| `graphics/structures/structures.reg` | 180 estruturas |
| `graphics/objects/objects.reg` | 194 objetos de cenário |
| `graphics/projectiles/projectiles.reg` | 32 projéteis/efeitos |
| `graphics/units/material.reg`, `sfx/sfx.reg`, `world/data/ai.reg`, `world/data/map.reg`, `scenario/npc.reg` | materiais, sons, IA, mapa-múndi, NPCs |

## `units.reg`
Cada unidade tem: `ID` (**é o campo "tipo" das unidades nos mapas `.alm`**: 66 = Ogre (Lord), 71 = Dragon, 68 = Fat troll, 74 = Squirrel, 76 = Turtle…),
`DescText` (nome), `File` (índice em `Files`, por exemplo `monsters\ogre\sprites` → `graphics/units/monsters/ogre/sprites.256`),
`MovePhases`, `MoveBeginPhases`, `AttackPhases`, `DyingPhases`, `Width`/`Height`, `CenterX`/`CenterY`, caixa de seleção, tempos e quadros de animação
(`AttackAnimTime/Frame`, `MoveAnimTime/Frame`), `Palette`, `Sound`, `AttackDelay`, `InfoPicture`, `InMapEditor`.

## `objects.reg` e `structures.reg`
- Objetos: `ID` (o bloco 3 dos mapas guarda `ID+1`), `DescText`, `File` (índice em `Files`, por exemplo `pine1\sprites`), `Index` (variante dentro do arquivo), `Phases`,
  `CenterX/Y`, `DeadObject`. Os IDs de módulo 3 seguem o padrão viva / em chamas (`...\fire\...`, arquivo ausente) / morta.
- Estruturas: `ID`, `DescText`, `File` (caminho direto, por exemplo `tower_s2\house` → `graphics/structures/tower_s2/house.256`), `TileWidth`, `TileHeight`, `FullHeight`,
  `ShadowY`, `Phases`, `AnimMask/Frame/Time`, `Picture`, `IconID`.

Os sprites `.256` têm 8 direções por linha (um frame de animação por linha); os frames são recortes de tamanho variável e o
deslocamento original de cada recorte não está no cabeçalho do frame (usamos alinhamento embaixo/centro no visualizador).
Direção real das unidades nos mapas: ainda não decodificada.
