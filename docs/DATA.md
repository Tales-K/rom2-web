# Contratos de dados (JSON em `game/public/data/`)

Quem produz cada arquivo é o dono indicado; quem consome codifica contra este contrato (e trata arquivo ausente com valores provisórios).
O produtor pode **acrescentar** campos, mas não renomear/remover os daqui sem avisar em `docs/REQUESTS.md`.

## Já existentes (orquestrador)
- `maps/<nome>.json`: `{name, source, w, h, version, tiles[w*h] (id do tile, 13 bits), alt[w*h], objs[[x,y,objectId]], players[{id,name}], units[{x,y,kind,player}], structures[{x,y,kind,hp,owner,id,extra?}], values/actions/triggers (somente texto)}`.
  `id` de jogador = posição na lista, 1-based. `kind` de unidade = `ID` em `units.json`; `kind` de estrutura = `ID` em `structures.json`; objeto = `ID` em `objects.json`.
- `units.json {id:{name,w,h,cx,cy,file}}`, `objects.json`, `structures.json {id:{name,w,h,tw,th}}`: sprites em `assets/{units,objects,structures}/`.
- `texts/<arquivo>.json`: textos do jogo (ver cabeçalho de `tools/texts_export.py`). Mensagens de missão: `texts/mission10.json` seções `event<N>` = "Send message N" do script;
  `briefing`, `failure<N>` etc. As tags `npc`, `iammale/iamfemale`, `iamfighter/iammage`, `part` escolhem a fala conforme o herói.

## DADOS produz
- `unit-stats.json`: `{ "<idDoTipoDeUnidade>": { "name": str, "health": n, "mana": n, "speed": n, "turnSpeed": n, "sight": n, "attack": n,
  "damage": {"min": n, "max": n}, "defense": n, "absorption": n, "range": n, "attackSkill": "blade|axe|bludgeon|pike|shooting|fire|water|air|earth|astral|none",
  "resist": {"fire": n, "water": n, "air": n, "earth": n, "astral": n}, "exp": n, "source": "data.bin|estimated" } }` (o id é o mesmo `ID` de `units.json`).
- `items.json`: `{ "<id>": { "name", "shape", "slot", "weight", "price", "damage"?, "defense"?, "absorption"?, "material"?, "usableBy"?, "icon"?, ... } }`
- `spells.json`: `{ "<id>": { "name", "school", "manaCost", "damage"?, "range"?, "description"?, ... } }`
- `classes.json`: criação de personagem — classes/sexos disponíveis, atributos iniciais, pontos livres, itens e magias iniciais, regras de habilidade por alinhamento.
- `docs/DATA.md` (seção DADOS): descreva o que cada campo significa e o que é estimado.

### DADOS — detalhes (gerado por `tools/data/derive.py`; formato do banco em `notes/data-bin-format.md`)
Regerar tudo: `.venv\Scripts\python.exe tools/data/databin.py` (→ `data/databin_raw.json`, bruto) e `.venv\Scripts\python.exe tools/data/derive.py`.
Fontes: `world/data/data.bin` (decifrado 100%: 149971/149971 bytes), `itemname.pkt/.bin` (491 itens prontos do jogo), `main/text/{itemname,itemserv,spell,spells,unitname,stats}.txt`.
Fórmulas: marcadas **[exe]** foram lidas por desmontagem estática do `allods2.exe` (endereço entre parênteses; confiança alta);
**[UA]** vêm da reimplementação aberta UnityAllods (jewalky) e não foram conferidas no exe (confiança média); **[est]** = estimativa nossa.
`rand(n)` do jogo devolve um inteiro uniforme em **0..n inclusive** [exe 0x51fa25].

**Unidades de medida.** Distâncias em **células** (1 célula = 32 px). `sight`/`range` em células. `speed`: avanço por tique = `speed/400`
célula em terreno de custo 8 [UA]; com **25 tiques/s** [UA] → **células/s = speed/16** (campo pronto `speedCellsPerSec`). Custo de terreno
(`data/reg/map.json` → Terrain): tempo por célula ×= `max(8,custo)/8` (areia 14, pedras 12, estrada/rachado 6, montanha 16), diagonal ×1,4142 [UA].
`turnSpeed` = unidades de ângulo por tique (palpite: círculo = 256). Ataque [UA]: o golpe sai em `2×charge` tiques e o ciclo dura
`2×(charge+relax)` tiques. Padrão de unidade sem template: charge 8, relax 4 [exe 0x50ec60].

**unit-stats.json** (chave = `ID` de `units.json` = `kind` das unidades do mapa; valor = template de nível 1 daquele tipo):
campos do contrato + `template` (nome em data.bin), `serverId`, `level`, `kind` (monster|human|hero), `healthRegen`/`manaRegen`
(**período** de regeneração — maior = mais lento, ver abaixo), `charge`/`relax`, `resistPhysical {blade,axe,bludgeon,pike,shooting}` (%),
`spells` (ids de spells.json), `speedCellsPerSec`, `levels {"1": serverId, ...}`. **O tipo sozinho não define o monstro**: o mapa guarda o
template exato (Troll de nível 4 em `10.alm`). Use **`map-unit-templates.json`** `{ "<mapa>": [ {serverId, level, kind} ] }` (mesma ordem de
`maps/<mapa>.json` `units[]`) e **`unit-templates.json`** `{ "<serverId>": {mesmo formato + attributes, treasure, equipment, magicSkills,
spellProbabilities, withdraw, wimpy, seeInvisible, tokenSize, movementType (1 anda, 2 paira, 3 voa), flying, alwaysHit, power} }`
(463 templates: 180 monstros + 283 humanos/NPCs; 57/57 mapas resolvidos).
- Monstros: valores diretos de data.bin. `damage {min,max}`: o jogo guarda `min` e a amplitude `max-min` em bytes; se `min ≥ 128` ou a
  amplitude > `min+255`, ambos ficam em unidades de 15 (já aplicado no JSON) [exe 0x51164e]. `alwaysHit` (attackKind 3: morcegos/súcubos):
  acerta sempre e ignora absorção [exe 0x516f6f].
- Humanos/NPCs/heróis (typeID 1–24): data.bin só tem atributos, habilidades e equipamento; os derivados são calculados como no jogo (abaixo).
- Tipos sem template próprio (ex.: 2): copiados do vizinho (`source: "estimated (...)"`).

**Combate físico [exe 0x516c1f → 0x516ceb → dano virtual 0x516f6f]**:
1. Alcance: ataca se distância ≤ alcance da arma (`range`, 1 = corpo a corpo).
2. Dano bruto `= min + rand(max-min)`. Bless no atacante: com chance = poder do Bless (%), dano = máximo; Curse: chance → dano = mínimo.
3. Acerto: `r = rand(200) - 100` (−100..100). **Acerta se `attack + r > defense` do alvo**, ou se `r ≥ 90` (sorte), ou se `alwaysHit`.
4. Se acertou: `dano -= absorption` do alvo (mín. 0; `alwaysHit` ignora); depois `dano = int(dano × (100 − resistFísica[tipoDaArma]) / 100 + 0,75)`.
5. Partes elementais do ataque (armas/monstros com dano mágico) somam `int(d × (100 − resist[escola]) / 100 + 0,75)` cada.
6. `vida -= dano`. Vida ≤ 0 → morrendo (a defesa cai pela metade); vida ≤ −10 → morte e saque [exe 0x50f12c].
- Saque [exe 0x510a70]: ouro se `treasure.goldChance > rand(100)`: `goldMin + rand(goldMax)`; item se `itemChance > rand(100)`: um item
  sorteado com preço entre `itemMin` e `itemMax` (filtro `itemMask`, não decifrado → [est] qualquer item de items.json nessa faixa).
- **Regeneração [exe 0x50fc5a]**: uma chamada por unidade a cada 4 tiques (`tique % 4 == id % 4`). Em cada chamada, se `healthRegen > 0`:
  `vida += 2 × vidaMax × (100 + bônusRegen%) × k / (healthRegen × 100)` (resto fracionário acumulado), `k = 3` se a unidade está há mais de
  80 tiques sem agir (descansando), senão 1; idem mana com `manaRegen`. Heróis/humanos: `healthRegen = 100`, `manaRegen = 50` [exe 0x50ec60].
  A taxa de tiques do servidor não foi confirmada: com 25 tiques/s a regeneração fica rápida (Ogro: ~17 PV/s). **Recomendado [est]: aplicar a
  fórmula 1×/s por unidade** (Ogro 2,7 PV/s; herói 139 PV ≈ 2,8 PV/s, ×3 parado).
- **Dificuldade [exe 0x561e20 / 0x4a4f2b]** (só inimigos, fora do multijogador): fácil → vidaMax ×0,5; normal → nada; difícil → `attack +50`,
  `defense +50`, vidaMax ×1,5.

**Herói / humanos [exe 0x51366b]** (atributos Body, Reaction=“Agility”, Mind, Spirit; `skill` = habilidade da arma em uso, 0..100;
`f = 2` guerreiro / 1 mago; `expTotal` = soma da experiência de todas as habilidades; divisões inteiras onde escrito `div`):
- Limites (máx.): guerreiro M 52/50/48/46, F 50/52/46/48; mago M 48/46/52/50, F 46/48/50/52 (Body/Reaction/Mind/Spirit) aplicados ao
  valor de base; bônus de itens somam por cima (o limite efetivo é limite + bônus do item).
- `healthMax = int((1,1^Body/100 + 1) × int(Body×f + log₁.₁(expTotal/5000 + 1) × f))` + itens.
- `manaMax` (magos) `= int((1,1^Spirit/100 + 1) × int(Spirit×2 + log₁.₁(expTotal/5000 + 1) × 2))` + itens.
- `attack (toHit) = int((1,1^Body + 1,1^Reaction) / 5) + 3 × skill` + toHit dos itens.
- `damage`: `b = int(1,1^Body / 20)`; `min = b + skill div 5 + minArma`; `max = min + b + (maxArma − minArma)`.
- `defense = Reaction div 3` + defesa dos itens; `absorption` = soma dos itens.
- `speed = Reaction < 12 ? Reaction : Reaction div 5 + 12` (+10 montado: tipos 19 e 21); carga = peso dos itens div 2; capacidade = `Body×10+1`;
  se carga ≥ capacidade: `speed -= carga div capacidade` (mín. 6). `turnSpeed = speed`.
- `sight = (Mind + Reaction)/25 + 4` (+ itens). Proteções = `Spirit div 2` + itens, limitadas a `[0, min(100, 70 + Spirit div 2)]`.
- Habilidade ↔ experiência [exe 0x512824]: `exp(v) = int((1,1^v − 1) × 1000)`; habilidade = maior `v` com `exp(v) ≤ exp`
  (`classes.json.skillExpTable`), máx. 100.
- **Experiência [exe 0x513128 / 0x5128cb]**: guerreiros só ganham com a arma, magos só com magias. Por golpe que causa dano:
  `base = int(expAlvo × 0,5 × dano / vidaMaxAlvo + 1)` (`expAlvo` = `exp` do template); × `(Mind/30 + 0,25)`; × `10/(n+10)` onde `n` =
  quantas vezes esse tipo de monstro já foi abatido; **÷ 8 (arred. p/ cima) se a habilidade não é a do alinhamento** (exceto Astral e
  Shooting); limitado a `exp(skill+1) − exp(skill)` por evento. Magia de suporte lançada: `int(nível × 0,5 + 0,5)`.
  Só conta contra unidades de jogadores de IA.

**items.json** (chave = id decimal = `material<<12 | slot<<8 | shape<<5 | classe`, o mesmo usado em sacos/lojas do jogo):
`{id, hex, name (itemname.txt), serverName (itemserv.txt: "Rare Mithrill Long Sword"), kind weapon|shield|armor|scroll|potion|book|quest,
shape (Common, Uncommon, Rare, Very Rare, Elven, Bad, Good), material (Iron…Crystal, None), itemClass (classe de data.bin), slot
(weapon, shield, ring, amulet, helm, mail, cuirass, bracers, gauntlets, boots — magos usam os mesmos slots: hat=helm, robe=mail, cloak=cuirass,
gloves=gauntlets, shoes=boots; `none` para consumíveis), slotId, price, weight, magicCapacity, damage{min,max}?, toHit?, defense?, absorption?,
attackType? (blade|axe|bludgeon|pike|shooting|specialN), range? (células), charge?/relax?, twoHanded?, casterWeapon? (cajado),
effects? (bônus `{parâmetro: valor}`; nomes = lista `PARAMS` de derive.py: body, healthRegeneration, protectionFire…),
usableBy ["fighter","mage"], spell?/spellName?/spellPower? (pergaminhos), school? (livros), effectsText?, source}`. 491 itens vêm prontos de
`itemname.pkt`; 21 usados só por NPCs foram calculados. Fórmula (confere 491/491): `valor = classe × shape × material` (arredonda ao mais
próximo; `absorption` trunca). Poções: `effects.health/mana` = cura instantânea; `healthRegeneration`/`manaRegeneration` = bônus % de
regeneração temporário (duração em `effectsText`).

**spells.json** (chave = id 1..29 — número usado em `castSpell=` e nos bits de `knownSpells`; bit `n` ⇒ magia `n`):
`{id, name (spell.txt), internalName, school, level, manaCost, range (células), damage{min,max}?, duration, frequency, radius,
areaDuration, areaFrequency, defensive, effects (texto: "speed=+2: duration 30"), scrollCost, bookCost, description, castType, scroll?, superScroll?}`.
Uso [UA]: `skill = habilidadeDaEscola + Mind − 30` (≥ 0; lançada de item/pergaminho = poder do item, p.ex. `:50`);
dano = `rand(int(min × (skill/30 + 1)), int(max × (skill/30 + 1)))`, reduzido pela proteção da escola do alvo como no item 5 do combate;
alcance = `range + skill div 30` (Teleport: `+ skill div 3`); duração = `1,025^skill × duration` (áreas: `areaDuration + skill × 0,1`);
custo de mana = `manaCost` (itens não gastam mana).

**classes.json**: `classes.{male_fighter,female_fighter,male_mage,female_mage}` com `attributes` iniciais (Start_MF/FF/MM/FM de data.bin),
`attributeMax` [exe], `attributeMin` ([est]: inicial − 15), `freePoints: 0` (troca 1:1 entre atributos, `town.txt` tips7),
`skills` iniciais, `alignment {options, default, bonusSkill: 20}` (escolha dá 20 na arma/esfera; tips5/tips6), `startItems [{id,name,mods?}]`,
`startSpells` (bits de knownSpells: Heal e Shield para magos), `weaponSpell` (Fire Arrow no cajado), `derived` (valores já calculados),
`unitType`, `face`; `rules` (texto das regras), `skillExpTable[0..100]`.
**[est]/não decifrado:** mínimo dos atributos; se trocar o alinhamento muda o equipamento inicial (assumimos que não); taxa de tiques do servidor.

## MAPAS-RE produz
Gerador: `.venv\Scripts\python.exe tools/alm_export.py [--only 10] [--scripts-only|--maps-only]` (lê `allods2-extracted/scenario/*.alm` e os
`.alm` da pasta do jogo). Formato do `.alm` e endereços no editor: `notes/alm-format.md`.

- `scripts/<missão>.json` (as 46 missões): script **estruturado** + referências resolvidas.
```
{ "mission": 10, "source": "tools/alm_export.py", "texts": "texts/mission10.json",
  "values":  [ {"seq", "index", "name", "kind", "kindName", "executeOnce"?: true,
                "params": [{"slot": 0..9, "label", "type": "int|group|player|unit|x|y|const|item|structure", "typeCode", "value", "ref"?}]} ],
  "actions": [ idem + "text"?: "event<N>" (Send message N) | "failure<N>" (Force Mission Fail N), "group"?: n (comando de grupo) ],
  "triggers":[ {"index", "name", "enabled": true, "once": bool, "conditions": [{"a": seqDeValor, "b": seqDeValor, "op": "==|!=|>|<|>=|<=", "opCode": 0..5}],
                "actions": [seqDeAcao], "raw": [46 dwords]} ],
  "units":   [ {"index", "id", "group": n|null, "kind", "player", "x", "y", "face", "direction": 0..15, "spriteDir": 0..7, "human", "serverId",
                "hp"?, "maxHp"?, "quest"?: {"kill","intercept","escort","noXp"}, "bag"?: índiceEmBags} ],
  "groups":  [ {"id", "name"?, "units": [indexEmUnits]} ],
  "heroUnitId": 10001, "specialUnits": {"10001": "hero", "10002": "knight", "10003": "dina"},
  "heroEntry": {"x", "y"}, "dropLocations": [{"x", "y", "action", "name"}],
  "players": [{"index", "id", "name", "color", "computer", "money", "diplomacy": [0 neutro|1 inimigo|2 aliado por jogador], "vision": [bool]}],
  "structures": [{"index", "id", "kind", "x", "y", "owner", "hp"}],
  "signposts": [{"structure", "enabled", "actionIndex", "action": seqDaAcao}], "bags": [{"unit", "x", "y", "money", "items": [{"item", "wielded", "magic"}]}],
  "points": [{"source": "value|action", "seq", "name", "kind", "shape": "point|circle|box", "x", "y", "radius"?, "op"?, "x2"?, "y2"?, "role"?: "heroEntry"}] }
```
  - `unit#N`/`group#N` = `units[].id`/`groups[].id`; `ref` já traz o alvo: `{"unitIndex"}`, `{"special": "hero|knight|dina"}` (10001..10003),
    `{"units": [...]}` (grupo), `{"playerName"}`, `{"structureIndex"}`. Grupo = conjunto das unidades com aquele número (não há outro registro).
  - `once` = caixa "Run Once" do editor (1 vez; `false` = reavalia e dispara a cada ciclo enquanto a condição valer). **Não existe** período nem
    flag de ativação no arquivo: `enabled` é sempre `true` e não há `period` (a frequência do ciclo é do runtime; ver docs/GAPS.md).
  - Operadores: ordem dos botões do diálogo do editor (0 `==`, 1 `!=`, 2 `>`, 3 `<`, 4 `>=`, 5 `<=`); use `opCode`.
  - Comando de grupo (ação `kind` 6): `kindName` já vem resolvido ("Group Command : Move"…); o subcomando é o slot 0, o grupo o slot 9 (`group`).
  - `heroEntry` = ação "Drop Location" (nenhum gatilho a chama: é onde o grupo do herói nasce). X/Y do script são células inteiras;
    a posição das unidades é em células fracionárias (centro = n + 0,5).
  - `serverId` = chave de `unit-templates.json` (DADOS) e da tag `npc` das falas em `texts/mission<M>.json` (21 = herói).
  - `signposts`: clicar na estrutura executa a ação `action` (placas "To Great Mage Skrakan's Tower" etc.).
- `maps/<nome>.json` (57; multiplayer = `mp_<nome>`): campos antigos mantidos (`name, source, w, h, version, tiles, tileFlags, alt, objs, players[{id,name}],
  units[{x,y,kind,player}], structures, values/actions/triggers` em texto) + extras: `units[]` com os mesmos campos de `scripts` (`id`, `group`, `direction`,
  `spriteDir`, `face`, `serverId`…), `players[]` com diplomacia, `groups`, `heroEntry` (lista), `points` (pontos/áreas do script), `signposts`, `bags`,
  `music` (`[{x,y,radius,themes}]`) + `musicDefault`, `effects` (bloco 9, semântica parcial), `info` (luz: `solarAngle`, `startTime` em minutos,
  `brightness`, `contrast`; `name`, `recPlayers`, `minLevel`, contagens), `taverns`/`shops`/`repops` (só multiplayer); `triggers[].once`.
  Coluna do sprite a partir da direção: `spriteDir = ((direction - 8) >> 1) & 7` (código de desenho do editor).

## MÍDIA produz (`tools/pipeline/media.py`; reexecutável: `.venv\Scripts\python.exe tools/pipeline/media.py [--skip-speech] [--only video,music,sfx,speech] [--force]`)
Tudo em `game/public/` (gerado; não versionado). O ffmpeg vem de `imageio-ffmpeg` (ver `docs/DOWNLOADS.md`).
- `assets/video/<nome>.mp4`: H.264 (yuv420p, crf 20, 15 fps) + AAC 96k, `faststart`. Nomes: `logos_nival` (640×480), `logos_publisher`, `intro` (640×360), `teleport`, `stars`, `crown`, `knights`, `druids`. Tocar com `game.video.play("intro")`.
- `assets/video/logo/{nival,monolith,allods,buka}.png`: logos BMP do jogo (usados nos créditos).
- `assets/audio/music/<nome>.ogg` e `.mp3` (reserva): Vorbis q4 / MP3 q4. Nomes: `b00..b16, chrgen, credit, map, menu` (+ `credits` = cópia de `credit`, porque `tunes.txt` o chama assim). Títulos em `texts/tunes.json` e em `media.json` (campo `title`). `game.audio.playMusic("menu")`.
- `assets/audio/sfx/<caminho>.ogg`: mesma hierarquia de `extracted/sfx` (ex.: `click00.ogg`, `units/sword.ogg`, `magic/fireball.ogg`, `characters/aldor/attack/1.ogg`), mono, Vorbis q4.
- `data/sfx.json` (mapa de efeitos; `game.audio.playSfx(idOuNome, volume?)`):
  ```
  { "version": 1, "base": "assets/audio/sfx/",
    "ids":    { "5": "click_ok", "100": "units/sword", "512": "magic/fireball", ... },   // id numérico do sfx.reg ("SfxN") -> nome
    "names":  { "click_ok": "assets/audio/sfx/click_ok.ogg", "units/sword": "...", ... },  // nome (caminho sem extensão, "/") -> arquivo relativo a public/
    "groups": { "characters/aldor/attack": ["characters/aldor/attack/1", "characters/aldor/attack/2"], ... },  // pasta com variantes: o jogo sorteia uma
    "durations": { "click_ok": 0.137, ... },   // segundos
    "missing": { "390": "monsters/daemon/easy", ... } }   // ids do sfx.reg sem arquivo no jogo original
  ```
  `playSfx` aceita id (`5` ou `"5"`), nome (`"click_ok"`, `"units\sword"`) ou pasta com variantes (`"characters/aldor/attack"`).
- `assets/audio/speech/<caminho>.ogg`: mesma hierarquia de `extracted/speech` (`about/`, `accept/`, `reject/`, `shop/`, `shop_druid/`, `shop_kaarg/`, `talk/`, `town/`), mono, Vorbis q2. Nome de arquivo do original: `<npc 4 dígitos><classe a/f/m/s/t><fala 3 dígitos>p<parte>`. `game.audio.playSpeech("talk/2004t043p01")` (sem extensão) devolve uma Promise que resolve ao terminar.
- `assets/media.json`: `{version, totals:{<tipo>:{count,bytes,seconds}}, video:[], image:[], music:[], sfx:[], speech:[]}`; cada item: `{name, kind, path, bytes, duration, ...}` (`path` relativo a `public/`).
- API de `game.audio` (core/audio.ts): `unlock()`, `attach(state)` (volumes vêm de `state.settings`), `playMusic(nome,{loop,fadeMs})` (troca com crossfade), `stopMusic(fadeMs)`, `pauseMusic()/resumeMusic()`, `playSfx(idOuNome, vol)`, `preloadSfx([...])`, `playSpeech(id)`/`stopSpeech()`, `musicVolume/sfxVolume/speechVolume` (get/set), `debug()`. `game.video`: `play(nome,{skippable,volume,fadeMs})` → `"ended"|"skipped"|"error"`, `preload(nome)`, `stop()`.

## CAMPANHA produz (`tools/data/campaign.py`; evidências em `notes/campaign.md`)
Regerar: `.venv\Scripts\python.exe tools/data/campaign.py` (desmonta `Scenario.dll`/`allods2.exe` só para leitura; usa textos/scripts/mapas
já exportados, `unit-templates.json`, `items.json`, `data/databin_raw.json`; falha se alguma constante citada não bater com o DLL ou se a
simulação das regras não alcançar as 46 missões e o fim). **Fonte**: a progressão do original está no `Scenario.dll` (DLL carregado pelo
exe por ordinal); os endereços `[DLL 0x...]`/`[exe 0x...]` nos campos e em notes/campaign.md são a evidência.

`campaign.json`:
```
{ version, source, legend, start {stage:10, town:1, availableLocations}, flow [texto],
  vars { "768": "estágio", "896+M": "missão M concluída", ... },          // índices de ScenarioGetVar/SetVar (1024 ints, vão no save)
  stages [ {stage, towns, map:"uimoir|yases", mainMissions, innOffersAtThisStage, advanceWhen, note?} ],
  towns  [ {id, key:"plagat|kaarg|druids", name, title, description, map, art:"base|kaarg|druid", artDirs{town,inn,shop},
            music:"b14|b16|b15", mapPos{x,y,map}, availableFrom, tips, guard, townPeopleKeys, townSpeech} ],
  missions { "<id>": { id, title, titleKey, briefingKey, briefing (globalmap), missionBriefing (#briefing de mission<id>.txt),
            main, stageGroup, stagesOffered [estágios em que pode surgir], town (cidade de quem oferece | null),
            mapPos {x,y,map:"uimoir|yases"}, image:null, alm, map, script, texts, textKeys {briefing, failures[], events},
            recommendedLevel, recommendedPlayers, size, music {default, regions},
            offeredBy [ {npc, talkKey:"npc<N>talk<M>", town, innCode, conditions, dllAddr} | {completionOf:M, note} ],
            prerequisites [condições], onComplete [efeitos], unlocksDirect [ids], unlocks [ids],
            reward {gold[], goldTotal, giveAll[], xp}, scenarioVarsSet[], scenarioVarsRead[], outcomes{complete,fail},
            heroVariant? ("male_fighter".. ou "mage"/"fighter"), magicSource?, autoStart?, titleSource? } },
  npcs { "<id>": { id, name, nameSource, template, serverId, typeId, portrait:"graphics/interface/inn/unit<typeId>/sprites.16a",
            roles ["missionGiver","gossip","mercenary","townPerson","hero","unused"], offers [missões], towns,
            talks [{key, kind:"mission|talk|town", conditions, effects}],
            merc? {desc, unlock, town, firstStage, templates {"<estágio>": serverId}, templateRule, aboutKey, acceptKeys[],
                   rejectKeys[], price:0} } },
  unlockGraph {semantics, edges {"start"|"<id>": [ids]}},
  innRules [ {order, dllAddr, code, npc, talk, kind (0 conversa | 3 missão), hired, textKey, conditions, effects} ],
  innMercenaries {rule, hire, afterMission, talk, inMission}, party {hero, igles, dina},
  cutscenes [ {id, name, video, when} ], cutsceneGallery, ending {variable:779, knights, druids, after, hallOfFame},
  globalMap {maps{uimoir,yases}, pathBitmaps, sprites, texts, music}, save {vars, shops, locations},
  shopRules {shelfFields, generation[], towns {"1|2|3": {shelves[{index,min,max,count,qty,mask,decoded}]}},
             changesOnComplete {"30|40|60|80|90": {town, masks}}, talkUnlock, stagePrices {"<estágio>": {kaargMax, druidMax, kaargMin}}},
  validation {runs, missionsReached, canonical {herói: {order, cutscenes}}, problems[]} }
```
- **Taverna**: lista = `innRules` cujas `conditions` são todas verdadeiras (na ordem `order`) + mercenários (`innMercenaries.rule`).
  Falar com `kind 3` já põe a missão `talk` no mapa (não há "aceitar" separado). Condições: `{stage:[...]}`, `{stageGt:n}`, `{stageGe:n}`,
  `{town:n}`, `{var:i, eq|ne:v}`, `{done:M}`/`{notDone:M}` (= `vars[896+M]`), `{anyDone:[...]}`, `{noneDone:[...]}`, `{heroMage}`,
  `{heroFemale}`, `{completed:M}`. Efeitos: `addMission`, `addTown`, `setVar`, `merc {id,state,town}`, `cutscene`, `if/then/else`,
  `setShopMasks`, `orShopMask`, `initShop`, `partyJoin`, `stageAdvance`.
- **Ao vencer a missão M**: mercenários contratados → estado 2, demais → 1; tirar M da lista; `vars[896+M]=1`; aplicar
  `missions[M].onComplete` (inclui `stageAdvance` se M%10==0). Sem cidade disponível (só após a 10) a 1ª missão da lista começa direto.
  Ao sair de Plagat com a 10 aceita, Plagat sai da lista e o mapa Uimoir leva o herói sozinho à 10.
- **Variáveis dos scripts** ("Set/Get Scenario Variable"): 772 (20 → dá a 21), 780 (50 → dá a 52), 779 (110 → final), 777/778 (lidas por
  80/70). "Set/Get Subobjective" = `vars[752+n]` (zeradas ao entrar numa missão).
- `mapPos`: pixels do bitmap 640×480 (`umoir.bmp`/`gmap.bmp`; ×1,6 para 1024×768); são os nós (valor 2) de `pathmap.bmp`/`umoirpath.bmp`
  (valor 1 = estrada por onde o ícone do herói anda).
- `campaign-shops.json`: `{note, towns {"<cidade>": {"<estágio>": [ {shelf,min,max,count,qty,mask, candidates[{id,name,price,inItemsJson,...}]} ]}}}`
  = candidatos de cada prateleira **antes** do sorteio de `count` itens, na progressão canônica (missões principais em ordem numérica);
  itens fora de `items.json` têm nome/preço calculados (`inItemsJson:false`).
- Estimado/não decifrado: entrada de Igles no grupo, ícones de local, bits 0x2000000/0x10000000 das máscaras, pesos do sorteio,
  encantamento, preço de venda, pontuação do hall da fama (ver notes/campaign.md e docs/GAPS.md).

## MOTOR produz (frente MOTOR-C; `game/src/sim/`)
- Não gera JSON. Consome `spells.json` (todas as colunas), `unit-templates.json` (`spells`, `spellProbabilities`, `spellPower`, `magicSkills`/`skills`,
  `withdraw`, `wimpy`, `seeInvisible`, `attributes.mind`, `level`) e `ai.reg` (MinimalGuardRange = 8, constante `MINIMAL_GUARD_RANGE`).
- Semântica [exe] decifrada (notes/ai-behaviors.md): `withdraw`/`wimpy` = vida ABSOLUTA abaixo da qual a unidade recua (inimigo a ≤ 2) /
  foge (inimigo a ≤ raio de guarda + 5); fácil → wimpy/2. `spellProbabilities` = magias lançadas no lugar do golpe com chance %, poder =
  `spellPower`. `spells` (knownSpells) = magias que a IA sorteia (ofensivas) ou usa para curar/proteger. Herói inicial: 10 na 5ª habilidade.
