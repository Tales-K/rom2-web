# Motor de script das missões — contrato `ScriptHost` (frente SCRIPT)

O Allods 2 descreve cada missão com o **Trigger Manager** do editor: listas de **valores** (condições, variáveis, constantes),
**ações** ("instants") e **gatilhos** (`IF valor OP valor [AND …×3] THEN ação [, …×4]`). O motor em `game/src/script/` executa isso
sobre um mundo abstrato, o `ScriptHost`, que a frente MISSÃO implementa sobre a simulação dela.

- Código: `game/src/script/` — `host.ts` (contrato), `types.ts` (JSON + ids do .ini), `loader.ts` (carregador/validador),
  `runtime.ts` (laço), `index.ts` (exporta tudo). Biblioteca pura: sem PixiJS, sem DOM (só `fetch` em `fetchScript`).
- Dados: `public/data/scripts/<missão>.json` (frente MAPAS-RE, contrato em `docs/DATA.md`).
- Testes: `cd game && npm run test:script` (= `npx tsx src/script/test/run.ts`).

## Uso pela frente MISSÃO

```ts
import { fetchScript, ScriptRuntime, HERO_UNIT_ID, type ScriptHost } from "../script";

const script = await fetchScript(missionId);          // data/scripts/<id>.json  (ou parseScript(json))
const host: ScriptHost = new MyWorldHost(sim, script); // sua implementação (abaixo)
const rt = new ScriptRuntime(script, host /*, { cyclePeriod: 1 } */);

const drop = rt.dropLocation;                           // célula de entrada do herói ("Drop Location"), ex. (11,41) na missão 10
sim.spawnHero(HERO_UNIT_ID, drop);                      // coloque o herói ANTES do primeiro update
// a cada quadro da simulação:
rt.update(dtSeconds);                                   // 1º ciclo já no 1º update; depois a cada cyclePeriod (1 s)
// desfecho: host.missionComplete()/missionFail(causa) são chamados uma vez; também em rt.outcome
// salvar no meio da missão: rt.snapshot() (JSON) / rt.restore(estado)
```

Extras do runtime: `rt.outposts` (pontos "Outpost (Repopper)"), `rt.vipUnits` (unidades VIP), `rt.variables`, `rt.subobjectives`,
`rt.history` (últimos 500 eventos: gatilho disparado / ação executada / desfecho), `onEvent` nas opções (para um painel de depuração).

## Referências

| Tipo | O que é |
|---|---|
| `UnitRef` | `units[].id` do JSON de script (o `unit#N` dos dumps). **10001 = herói do jogador**; 10002/10003 = 2º/3º membros do grupo nas missões que os têm (cavaleiro, Dina). O host mapeia para as entidades dele usando `units[].index` (posição em `maps/<n>.json` `units`). |
| `GroupRef` | `groups[].id` (o `group#N`). |
| `PlayerRef` | posição 1-based na lista de jogadores do mapa (1 = "self", o humano). Em "Change diplomacy" os jogadores vêm como `int` — mesmo número. |
| Coordenadas | **células** do mapa (as do editor). `unitPosition` pode devolver fração (38.5 = centro da célula 38); o runtime usa `Math.floor`. |
| `ItemRef`/`SpellRef` | ids crus do editor (itens/magias do jogo). `StructureRef` = `structures[].id` do mapa. |

## Interface (resumo; a fonte é `game/src/script/host.ts`)

Obrigatórios (o mínimo para a missão 10 funcionar):

| Método | Uso no script |
|---|---|
| `unitPosition(u): {x,y} \| null` | todas as distâncias; `null` = não existe / morta / **fora de fase** |
| `groupUnitCount(g): number` | "How many units contains this group" (`== 0` = grupo eliminado). Recomendado: contar vivas, inclusive fora de fase |
| `diplomacy(a, b): number` | "Get diplomacy": **0 paz/neutro, 1 guerra, 2 aliado**; direcional (a→b) |
| `sendMessage(n)` | "Send message N" → `texts/mission<id>.json` seção `event<N>` (escolher a fala pelas tags do herói) |
| `setSubobjective(n, v)` | "Set Subobjective": 0 oculto, 1 ativo ("Sub2+"), 2 cumprido ("Sub2!") |
| `missionComplete()` / `missionFail(causa)` | "Force Mission Complete/Fail"; texto da causa = `failure<causa>`. O runtime chama **uma vez** (o 1º desfecho vence) |
| `setDiplomacy(a, b, v)` | "Change diplomacy" (direcional; o script costuma mudar as duas direções com duas ações) |
| `giveMoney(p, n)` | "Give money to player" |
| `phaseOutUnit(u)` / `phaseInUnit(u)` | tirar/recolocar no mapa sem matar (invisível, sem IA, sem colisão) |
| `groupCommand(g, cmd)` | comandos de grupo (abaixo) |
| `giveAll(from, to)` | "Give All": todo o inventário de `from` passa para `to` (Skrakan entrega os documentos) |

Opcionais (se ausentes: consulta devolve o padrão; comando vira no-op com um aviso único em `log`):
`unitAlive` (padrão: `unitPosition != null`), `unitParameter(u, 6=vida)` (0), `unitIsAttacking` (false), `unitHasItem` (false),
`unitHasSpell` (false), `groupUnits` (usado como alternativa a `phaseIn/OutGroup`), `playerUnitCount` (0), `playerBuildingCount` (0),
`buildingHealth` (0), `nearestPlayerUnitDistance` (9999), `sackItemCount` (0), `spellOnTile` (0), `teleportation` (0),
`get/setScenarioVariable` (o runtime guarda em memória), `phaseIn/OutGroup`, `incrementMissionStage`, `setFormation`, `changeUnitOwner`,
`changeGroupOwner`, `dropAll`, `addItem`, `removeItem`, `giveItem`, `removeItemFromEverybody`, `polymorph`, `spellEffect`,
`castSpellOnUnit`, `setTrap`, `setBuildingHealth`, `teleportUnit`, `setTileSpellDuration`, `setUnitSpellDuration`, `setRepopDelay`,
`setUnitParameter`, `setNextMusic`, `setMusicNode`, `suspendGroup`, `log(level, msg)`.

Regras para o host: consultas sem efeito colateral e baratas (cada ciclo pode chamar dezenas); nunca lançar exceção por referência
desconhecida (devolva `null`/0); comandos podem ser assíncronos do ponto de vista do jogo (mensagem entra numa fila) — o runtime não espera.

### Comandos de grupo (`GroupCommand`, ação 6; o tipo vem da constante Par0)

| Const | `type` | Campos |
|---|---|---|
| 1 | `guard` | `range` |
| 2 / 5 | `swarm` / `swarm2` | `x, y` (avançar atacando) |
| 3 | `standGround` | — |
| 4 | `move` | `x, y` |
| 10 | `attack` | `victim` |
| 11 | `defend` | `unit, range` |
| 14 | `patrol` | `x, y` |
| 15 | `follow` | `unit, range` (escolta/refém segue o herói) |
| 17 | `roam` | — |
| 18 | `dwell` | `range` |
| outro | `unknown` | `code, params` |

## Valores (27 tipos de "Description Checks.ini")

| id | Nome | Resultado |
|---|---|---|
| 1 | How many units contains this group | `groupUnitCount` |
| 2 | Is unit in a box | 1/0 (célula dentro do retângulo, inclusivo) |
| 3 | Is unit in a circle | 1/0 (distância ≤ raio) |
| 4 | Get unit parameter | `unitParameter` (6 = vida) |
| 5 | Is unit alive? | 1/0 |
| 6 | Distance between units | distância em células; 9999 se uma das duas não está no mapa |
| 7 | Distance from point to unit | idem |
| 8 | How many units this player have | `playerUnitCount` |
| 9 | Is unit make attack | 1/0 |
| 10 | Get diplomacy | 0/1/2 |
| 14 | Get sack | `sackItemCount(x,y)` |
| 15 | Distance to nearest units of player | `nearestPlayerUnitDistance` |
| 16 | Item to point | distância do portador ao ponto **se ele tem o item**, senão 9999 |
| 17 | Item in inventory | 1/0 |
| 18 | VIP | 1/0 (viva) — também listado em `rt.vipUnits` |
| 19 | Return value of variable | variável de missão (começa em 0) |
| 20 | How many buildings this player have | `playerBuildingCount` |
| 21 | Health of building | `buildingHealth` |
| 22 | Teleportation | `teleportation` |
| 23 | Get Scenario Variable | variável de campanha (persistente) |
| 24 | Get Subobjective | estado guardado pelo runtime |
| 25 | Spell on Tile | `spellOnTile` |
| 26 | Spell on Unit | 1/0 |
| 27 | Centered on Tile | 1/0 (célula exata) |
| 65538 | Constant Value / TRUE / FALSE | o 1º parâmetro |

## Ações (49 grupos de "Description Instants.ini")
Todas mapeadas em `runtime.ts › execute`. Variáveis (`Set value`, `Increment variable`), subobjetivos, estágio da missão e desfecho
são estado do runtime (e repassados ao host). "Drop Location" (65538) e "Outpost" (65539) são instantes **estáticos**: não fazem
nada num gatilho; leia-os com `rt.dropLocation` / `rt.outposts`.

## Semântica (regra escolhida e evidências)

1. **Ciclo**: os gatilhos são avaliados em ciclos, o 1º no primeiro `update` (t = 0) e depois a cada `cyclePeriod` = **1 s**
   (opção). Em cada ciclo, os gatilhos são percorridos **na ordem do arquivo**; cada um testa as suas condições com o estado atual
   (o que um gatilho anterior mudou no mesmo ciclo já vale) e, se todas forem verdadeiras, executa as ações em ordem.
   Cada gatilho dispara **no máximo uma vez por ciclo** → não há laço infinito; há ainda um teto de 1000 ações por ciclo.
2. **"Run Once"** (dword 45 do registro de gatilho de 0xb8 bytes; caixa "Run Once" do diálogo Trigger Manager do editor):
   `once = true` → dispara uma única vez na missão; `once = false` → dispara **em todo ciclo** em que as condições forem verdadeiras
   (nível, não borda). Evidências: entre os 130 gatilhos com dword 45 = 0 estão todos os contadores, que só funcionam repetindo
   ("Counter: v71 < 5 → v71++", "Leader appears counter: v73 != 0 → v73++" seguido de "v73 == 10 → Phase In", "== 20 → Phase Out");
   os com 1 incluem "Start" (`FALSE == FALSE`, precisa disparar uma vez) e "4th troll gives prize" (sem trava, daria 700 de ouro
   repetidamente). Prioridade no JSON: `once` (boolean) > `raw[45]` > padrão `true`. `period` (s), se vier, é o intervalo mínimo
   entre disparos de um gatilho repetível.
3. **Operadores**: códigos 0..5 = `==`, `!=`, `>`, `<`, `>=`, `<=` — a ordem dos 6 botões de rádio de cada condição no diálogo do
   editor (recurso de diálogo do `ROM2 Map Editor.exe`). Isso corrige `COMPARE_OPS` de `tools/alm.py` (3 `>=`, 4 `<=`, 5 `<`) e bate
   com os scripts: "King to hero" (`ogres dead` cód. 3 → `< 4`, 1ª conversa) × "King to hero2" (cód. 4 → `>= 4`); "Left village
   panics: vida do guarda cód. 3 10" (= `< 10`); "Go away from ogre: > 4" × "Come to ogre: cód. 5 4" (= `<= 4`). Prioridade no
   JSON: `opCode` > código em `raw[42+k]` > string `op`.
4. **Desfecho**: o primeiro "Force Mission Complete/Fail" vale; os seguintes são ignorados (log). As ações restantes do mesmo gatilho
   continuam ("Near Skrakan" faz Complete e depois "Sub2!"); os ciclos seguintes também (opção `stopOnOutcome` para parar).
5. **Distância**: euclidiana entre células (opção `distance: "chebyshev"`); unidade ausente/morta/fora de fase = 9999.
6. **`enabled`**: não existe flag de ativação conhecida no `.alm`; todos os gatilhos participam (o validador desativa só os que
   referenciam valores inexistentes — há 1 caso nas 46 missões).

## Validação
`parseScript` lança `ScriptFormatError` se faltar `values`/`actions`/`triggers`; o resto vira `script.warnings` (o runtime repassa
para `host.log("warn", …)`). Nas 46 missões: 1 aviso (condição que aponta para o valor 4294967295).
