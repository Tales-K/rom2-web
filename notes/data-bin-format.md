# `world/data/data.bin` — banco de parâmetros (confiança: ALTA)

Decifrado por desmontagem estática do `allods2.exe` (nunca executado) e conferido byte a byte: o parser
[`tools/data/databin.py`](../tools/data/databin.py) consome os 149 971 bytes exatos. Saída bruta: `data/databin_raw.json`.
Derivação dos contratos JSON: [`tools/data/derive.py`](../tools/data/derive.py) (documentação dos campos em `docs/DATA.md`, seção DADOS).

## Origem
O jogo compila planilhas de texto (`Shapes.txt`, `Materials.txt`, `Magic.txt`, `Armors.txt`, `Shields.txt`, `Weapons.txt`,
`Magic Items.txt`, `Units.txt`, `Humans.txt`, `Buildings.txt`, `Spells.txt` — não incluídas na versão GOG) num arquivo de
serialização **MFC `CArchive`** (mensagens "Parsing .txt files", "Writing new .bin file" no exe). Carga: `0x4f9fb0` abre
`World\Data\Data.bin` e chama `CDataBase::Serialize` em `0x4fac89` (ramo de leitura em `0x4fb105`).

## Primitivas MFC
| tipo | codificação |
|---|---|
| `CString` | `u8 n` (se `0xFF`: `u16 n`; se `0xFFFF`: `u32 n`) + `n` bytes cp1252 |
| contagem (`ReadCount`) | `u16` (se `0xFFFF`: `u32`) |
| `CStringArray` | contagem + `CString`s |
| contador de tabela | `u32` (`CArchive >> DWORD`) |

## Layout
```
CStringArray  cabeçalho de Shapes/Materials (11 nomes de coluna)
u32 n; n × Shape        Shapes (7: Common, Uncommon, Rare, Very Rare, Elven, Bad, Good)
u32 n; n × Shape        Materials (16: Iron, Bronze, Steel, Silver, Gold, Mithrill, Adamantium, Meteoric, Wood, Magic Wood,
                                   Leather, Hard Leather, Dragon Leather, Bone, Crystal, None)
CStringArray  cabeçalho de Parameter (30)
u32 n; n × Row          Parameters (50: tabela de modificadores mágicos: custo, faixa, por slot)
CStringArray  cabeçalho de itens (18)
u32 n; (n-1) × Item     Armors (30)      ┐ tabelas "a partir de 1": o contador inclui um elemento 0 vazio
u32 n; (n-1) × Item     Shields (9)      │ que NÃO é gravado
u32 n; (n-1) × Item     Weapons (27)     ┘
CStringArray; u32 n; (n-1) × Magic      Magic Items (96: livros, pergaminhos, poções, itens de missão)
CStringArray; u32 n; (n-1) × Unit       Units/monstros (241 linhas; várias vazias = posições reservadas)
CStringArray; u32 n; (n-1) × Human      Humans (289 linhas, 284 com nome)
CStringArray; u32 n; (n-1) × Row        Buildings (179)
CStringArray; u32 n; (n-1) × Spell      Spells (34; 29 com nome)
```
Registros (métodos `Serialize` das classes, endereços no exe):
| classe | Serialize | conteúdo |
|---|---|---|
| Shape/Material | `0x4fe455` | `CString nome` + 9 `double` (0x48 bytes) |
| Row (base) | `0x4fe3ab` | `CString nome` + contagem + `int32[]` (um valor por coluna; −1 = vazio) |
| Item | `0x4fe3f9` | Row + 14 bytes + `CStringArray` (vazio) |
| Magic | `0x4fe55d` | Row + `u8` + `CString efeitos` (`castSpell=Fire_Arrow:50`, `health=+30`) |
| Unit | `0x4fe8dc` | Row + 2 `CString` (equipamento `"Wood Short Bow"`, `"Wood Shaman Staff {castSpell=Fire_Arrow:5}"`; 2º vazio) |
| Human | `0x4ff159` | Row + 10 `CString` (itens equipados, um por slot) |
| Building | `0x4ff2e4` | Row |
| Spell | `0x4ff6e9` | Row + `CString efeitos` |

## Significado das colunas
- **Shape/Material**: os 9 doubles são `[?, ?, Price, weight, damage, toHit, defence, absorption, MagCap]` (os 2 primeiros = 0; o cabeçalho
  tem 10 colunas para 9 valores). São **multiplicadores**: valor do item = valor da classe × shape × material — conferido contra os
  491 itens de `itemname.pkt` (preço/dano/toHit/defesa arredondam ao mais próximo; absorção trunca).
- **Item** (armas, escudos, armaduras): `Shape, Material` (sempre 0), `Price, weight, Slot, @.attackType (1 lâmina, 2 machado,
  3 maça, 4 lança, 5 tiro), @.physicalMin, @.physicalMax, @.toHit, #.defence, #.absorbtion, @.range, @.charge, @.relax,
  2 handed (2 = sim), sutableFor (1 guerreiro, 2 mago, 3 ambos), Other Parameter`.
  Os 14 bytes extras = 7 × `u16`, um por shape (Common…Good): máscara de bits dos materiais permitidos (bit = índice do material).
- **Parameter**: `cost.MP, affectMin, affectMax, UsableBy` + limiares por slot (`in.Weapon` … `in.Shoes`) para gerar itens mágicos.
  A ordem das linhas define o **id de parâmetro** usado em `itemname.pkt` e nos efeitos: 0 '', 1 price, 2 body, 3 mind, 4 reaction,
  5 spirit, 6 health, 7 healthMax, 8 healthRegeneration, 9 mana, 10 manaMax, 11 manaRegeneration, 12 toHit, 13 damageMin,
  14 damageMax (amplitude), 15 defence, 16 absorbtion, 17 speed, 18 rotationSpeed, 19 scanRange, 20 protection0, 21–25 protection
  Fire/Water/Air/Earth/Astral, 26 fighterSkill0, 27–31 skill Blade/Axe/Bludgeon/Pike/Shooting, 32 mageSkill0, 33–37 skill
  Fire/Water/Air/Earth/Astral, 38 itemLore, 39 magicLore, 40 creatureLore, 41 castSpell, 42 teachSpell, 43 damage, 44–48 damage
  Fire…Astral, 49 damageBonus (+ no pkt: 50 = poder da magia, 51 = consumível).
- **Unit** (62 inteiros): body, reaction, mind, spirit, healthMax, HP regeneraton (período), manaMax, MP regeneraton, speed,
  rotationSpeed, scanRange, physicalMin, physicalMax, attackKind (−1 normal, 3 sônico = acerta sempre), toHit, defence, absorbtion,
  attackChargeTime, attackRelaxTime, prot Fire/Water/Air/Earth/Astral, res.Blade/Axe/Bludgeon/Pike/Shooting, typeID (= `ID` de
  units.reg, o `kind` dos mapas), face, tokenSize, movementType (1 anda, 2 paira, 3 voa), dyingTime, Withdraw, Wimpy, See invisible,
  XPvalue, treasure.1 Gold (chance %), treasureMin.1, treasureMax.1, treasure.2 Item (chance %), treasureMin.2, treasureMax.2
  (faixa de preço), treasureMask.2, not used, not used1, Power, Spell 1, Probability 1, Spell 2, Probability 2, Spell 3,
  Probability 3, Spell Power, **serverID** (id do template, gravado em cada unidade dos `.alm`, dword 5 do registro de 48 bytes),
  knownSpells (máscara: bit n = magia n), skillFire…skillAstral. Nome `X.2`…`X.5` = níveis do mesmo monstro.
- **Human** (26 inteiros): Body, Reaction, Mind, Spirit, HealthMax, ManaMax, Speed, RotationSpeed, ScanRange, Defence,
  Skill.General, 5 habilidades (guerreiro: Blade/Axe/Bludgeon/Pike/Shooting; mago: Fire/Water/Air/Earth/Astral), typeID, face,
  gender (1 = mulher), AttackChargeTime, AttackRelaxTime, TokenSize, MovementType, DyingTime, serverID, knownSpells.
  `Start_MF/FF/MM/FM` = heróis iniciais da criação de personagem; `Fighter_Hero`/`Mage_Hero`; `NPCxx_n`, `CH_*` (personagens de
  missão: `CH_Scrakan` = serverID 2000, o Skrakan de `10.alm`).
- **Building**: sizeX, sizeY, scanRange, healthMax, Passability (máscara), BuildingPresent, (Start ID, Tiles sem valor).
- **Spell** (22 inteiros): Complication Level, Mana Cost, Sphere (1 fogo, 2 água, 3 ar, 4 terra, 5 astral), Item, Spell Target,
  Delivery System, Max Range, Spell Effect Speed, Distribution system, Radius/Length÷2, Area Effect Affect, Area Effect Duration,
  Area Effect Frequency, Apply on Unit Method, Spell Duration, Spell Frequency, damageMin, damageMax, Defensive, SkillOffset,
  scrollCost, bookCost + texto de efeitos. O índice (1-based) é o id usado em `castSpell=` e nos bits de `knownSpells`.

## Arquivos vizinhos
- `itemname.bin`: 491 × `u16` = ids de item, na ordem de `main/text/itemname.txt` (nome exibido) e `itemserv.txt` (nome canônico).
- `itemname.pkt`: `3 bytes 0, u32 n, u16 ?`, depois `n` × { `u16 id`, `u16 ?(1)`, `u8 flags` (2 guerreiro, 4 mago, 1/16 ?),
  `u8 nMods`, `u8 tamanho`, `u8 1`, `u32 preço`, `(nMods−1)` × { `u8 parâmetro`, `u8 valor` } } — fecha no último byte.
  `damageMax` aqui é a **amplitude** (max − min).
- Id de item (16 bits): `material<<12 | slot<<8 | shape<<5 | classe` (classe = índice 1-based na tabela do slot: 1 armas, 2 escudos,
  demais armaduras; slot 14 + material 0 = item mágico, índice = byte baixo).

## Estrutura de estatísticas de unidade no exe (para quem for desmontar mais)
`+0x84 Body, +0x86 Reaction, +0x88 Mind, +0x8a Spirit, +0x8c speed, +0x90 carga, +0x92 capacidade, +0x94 vida, +0x96 vidaMax,
+0x98 período de regen. de vida, +0x9a mana, +0x9c manaMax, +0x9e período de regen. de mana, +0xa4 scanRange (×256), +0xa6 toHit,
+0xa8+2i habilidades, +0xb4 dano mín (u8), +0xb5 amplitude (u8), +0xb6 tipo da arma, +0xb7..+0xbb dano elemental, +0xbe defesa,
+0xc0 absorção, +0xc2+2i proteções (i=1 fogo … 5 astral), +0xce+i resistências físicas, +0xd4 bloco de bônus dos itens,
+0x12c alcance, +0x130 experiência total, +0x134/+0x135 charge/relax`. Funções: stats do herói `0x51366b`, carga de template de
monstro `0x5114f3`, dano `0x516f6f`, ataque corpo a corpo `0x516ceb`, regeneração `0x50fc5a`, morte/saque `0x510a70`,
experiência `0x513128`/`0x5128cb`, dificuldade `0x561bf9`. Ferramentas: `tools/data/x86exe.py` (dis/xref), `find_imm.py`, `find_writes.py`.

## Em aberto
- Significado dos 2 doubles iniciais de Shape/Material e da 10ª coluna do cabeçalho ("Level").
- `treasureMask.2` (filtro do gerador de saque), `Power`, `not used`, `Withdraw`/`Wimpy` (fuga?), `face`, `tokenSize`.
- Fórmulas de magia (dano por habilidade, duração) — só da reimplementação UnityAllods; a taxa de tiques do servidor.
