# Simulação da missão (`game/src/sim/`)

Biblioteca pura (sem PixiJS, sem DOM), determinística, em passo fixo de **62,5 ms (16 Hz, o tique do servidor do exe; até a DIFF-FUZZ fase 7 era 50 ms/20 Hz)**. A cena (`scenes/MissionScene.ts`)
acumula o tempo real e chama `world.step()` + `runtime.update(0.05)` (script) quantas vezes couber; a apresentação lê o estado
das unidades e consome `world.events` a cada quadro.

| Arquivo | Conteúdo |
|---|---|
| `types.ts` | `UnitStats`, `Order`, `SimEvent`, `TICK_MS`, direções (`dirFromDelta`: 0 = S, 4 = O, 8 = N, 12 = L — mesmo sentido dos sprites) |
| `rng.ts` | `Rng` (mulberry32): toda aleatoriedade passa por aqui (semente por missão) |
| `grid.ts` | `Grid`: custo por célula (map.reg `Terrain/Cost*`), bloqueio estático (terreno água/rocha, objetos, pegadas de estruturas, borda), ocupação dinâmica (`occ`: 1 unidade por célula) |
| `los.ts` | `lineOfSight` (Bresenham, diagnóstico). O andar (caminho, passo, giro) é o do exe portado em `exe/` (etapa 6: `notes/integracao-andar.md`); o A* antigo (`path.ts`) foi apagado |
| `stats.ts` | atributos: templates do data.bin (`map-unit-templates.json` → `unit-templates.json`), `unit-stats.json`, tabela provisória; `heroDerived` = fórmulas de herói [exe] (porte de tools/data/derive.py) |
| `world.ts` | `World` (unidades, projéteis, áreas de magia, sacos de loot, diplomacia, combate, magias, ordens) e `Unit` |
| `ai.ts` | IA: guarda/stand ground/ataque/fuga/recuo [exe], conjuradores, autocast, herói automático, aliados (notes/ai-behaviors.md) |
| `spells.ts` | `SpellDef` + `buildSpell(id, json, poder)`: as 29 magias (tipo, alvo, dano, raio, efeitos, durações) |
| `behaviors.ts` | `installMissionAi`, `applyAiSettings`, `cycleAutocast`, `attachFollowers` (liga tudo a uma missão montada) |

## Modelo
- **Posição**: `x, y` contínuos em células (centro = n + 0,5); `cx, cy` = célula ocupada. Andar = reservar a próxima célula do caminho
  (libera a anterior) e deslizar até o centro dela. Velocidade = `speed/16` células/s (valor bruto do jogo, docs/DATA.md) × `8/max(8, custo)`.
- **Ordens** (`world.command`): `move` (opcionalmente atacando no caminho), `attack`, `cast`, `hold`, `follow`, `patrol`, `pickup`.
- **Estados**: `idle`, `move`, `attack`, `cast`, `dying`, `dead` (o renderizador escolhe a animação por estado + `stateTime`/`walkTime` + `dir`).
- **Combate** [exe] (docs/DATA.md): `r = rand(0..200) − 100`; acerta se `ataque + r > defesa` (ou `r ≥ 90`, ou `alwaysHit`); dano
  `rand[min,max] − absorção` (mín. 0), depois `int(d × (100 − resistFísica)/100 + 0,75)`; magia sem teste nem absorção, reduzida pela
  proteção da escola. Ciclo de ataque = `(charge+relax)/12,5 s`, golpe em `charge/12,5 s`. Ranged/magia = projétil teleguiado.
- **Experiência** [exe] do herói por golpe: `int(expAlvo × 0,5 × dano/vidaMax + 1) × (Mind/30 + 0,25) × 10/(n+10)`, ÷8 fora do alinhamento,
  limitada ao próximo nível da habilidade; guerreiro só ganha com a arma, mago só com magias (`Unit.heroInfo.skillExp`).
- **Dificuldade** [exe] (`mission/setup.ts applyDifficulty`): fácil → vida das unidades de IA ×0,5; difícil → ×1,5, ataque +50, defesa +50.
- **Diplomacia** direcional `dip[a][b]` (bit 0 guerra, bit 1 aliado, 0x10 visão compartilhada). Uma unidade ataca por iniciativa quem o dono
  dela considera inimigo. Bater em alguém em paz deixa o dono da vítima hostil ao agressor (é assim que se "irrita" o ogro ou Skrakan).
- **IA** (`ai.ts`, a cada 4 ticks por unidade): `guard` (alvos num raio ≥ 8 em volta do POSTO, volta ao posto) [exe], `hold` (Stand
  ground: só ao alcance), `move`, `swarm`, `defend` (aliados/mercenários), `follow`, `patrol`, `roam`; fuga (Wimpy) e recuo (Withdraw);
  alerta de grupo [est]; conjuradores sorteiam magia ofensiva e curam aliados; magias de chance dos templates. Ver notes/ai-behaviors.md.
- **Herói**: controlado pelo jogador; parado = Stand ground (ataca o que estiver ao alcance) + reage a quem o fere de longe [est] + autocast.
  Ordens de comando: `hold` (Stand ground), `guard {x,y,range?}`, `defend {unit,range}`, `retreat`, `patrol`, `move {attackMove}` (Swarm), `cast`.
- **Regeneração** [exe] 1×/s por unidade: `vida += 2 × vidaMax × k / healthRegen` (`healthRegen` = período; k = 3 descansando), idem mana;
  aproximação: vida não regenera em combate (dano nos últimos 5 s). **Efeitos** temporários em `Unit.buffs` (Shield = +absorção).
- **Morte**: libera a célula, `dying` por `dyingTicks`, depois `dead` (ossos ficam no chão). Larga um saco com o ouro do tesouro do template
  e o saco do mapa (`bags`), que o herói recolhe ao pisar na célula.

## Interface para MOTOR-A/B (MissionScene, HUD, view) — magias e comportamentos
- Logo depois de `buildMission` (e antes de `restoreMission`): `installMissionAi(built.world, { spells: data.spells, difficulty: hero.difficulty,
  heroSpellIds: hero.spells.map(Number), settings: game.state.settings })`. Opções mudaram → `applyAiSettings(world, settings)`.
  CTRL+U → `cycleAutocast(world)` (devolve 1..3; `setAutocastLevel(world, 0)` desliga). Aliados (Igles/Dina/mercenários de
  `partyForMission`): spawnar e chamar `attachFollowers(world, hero, [unidades])` antes de `installMissionAi` (ou de novo depois).
- Lançar: `world.command(h, { type: "cast", spell: s.id, target?, x?, y? })`; `s.target` diz o alvo: `"enemy"`, `"friend"` (aliado ou
  o próprio), `"self"` (lançar direto), `"point"` (clique no chão: x,y). `s.kind`, `s.radius`, `s.mana`, `s.range` para o HUD.
- Estado para desenhar: `world.areas` (campos/paredes: `spell, x, y, radius, kind`), `unit.buffs` (`kind`: absorption, defense, attack,
  speed, sight, resist.*, bless, curse, invisible, stone, poison, control), `world.stunned(u)`, `world.canSee(viewer, u)`,
  projéteis com `to = 0` vão para `(tx,ty)`. Atributos efetivos: `speedOf/defenseOf/absorptionOf/attackOf/resistOf/sightOf`.
- Eventos novos (`types.ts`): `spell` (quem/alvo/ponto, `auto` = autocast/IA), `blast` (explosão/jato), `area` (on/off), `effect`
  (buff on/off), `teleport`, `owner` (Control Spirit), `summon`, `flee`.

## Ponte com o script
`mission/host.ts` implementa `ScriptHost` (src/script/host.ts) sobre o `World`: ids do script → unidades, grupos, distâncias, diplomacia,
mensagens, subobjetivos, desfecho, dinheiro, phase in/out, comandos de grupo, "Give All".

## Teste headless
`npm run test:sim` (em `game/`) roda `test/mission10.ts` com tsx: monta o mundo da missão 10 a partir de `public/` (sem PixiJS),
leva um guerreiro e uma maga do Drop Location até Skrakan pela ponte (Mission Complete), luta com cobras, irrita Skrakan (falha 5),
deixa o herói morrer (falha 2), roda o desafio do troll e imprime duelos informativos contra o ogro e o troll jovem.

## Save no meio da missão (`snapshot.ts`, frente SAVE-LOAD)
`snapshotMission(id, built, ui)` / `restoreMission(built, snap)` (e `snapshotWorld`/`restoreWorld`) geram um JSON (~17 KB na missão 10) com
o estado **mutável**: por unidade todos os campos próprios exceto os estáticos do build (`UNIT_STATIC`: id, kind, typeId, stats, timing, name,
scriptId, npc, isHero, spells, weaponSpell; `castSpell` vai por id), projéteis vivos (magia por id), sacos de loot, diplomacia, dinheiro,
`tick`, `nextId`, estado do `Rng`, ocupação da grade (pares célula→id), abates por tipo, `host.scenarioVars` e `ScriptRuntime.snapshot()`,
mais o estado mínimo da cena (`MissionUiState`: subobjetivos, mensagens vistas, documentos, tempo, câmera, zoom, velocidade, seleção).
Para restaurar: montar a missão de novo com `buildMission(data, game.state.hero, callbacks)` (o herói salvo no mesmo save) e aplicar o
snapshot **antes** do primeiro `world.step()`; `world.events` é esvaziado. Campo novo na `Unit` entra sozinho no snapshot (cópia genérica;
Map/Set/Infinity/arrays tipados são codificados); se for derivado do build, acrescente-o a `UNIT_STATIC`.
Teste: `npx tsx src/sim/test/snapshot.ts` — salva no meio (andando até Skrakan, lutando com cobras com projéteis no ar, morrendo para Hydun),
restaura numa missão recém-montada e exige estado idêntico tique a tique e o mesmo desfecho da execução sem salvar.
Não guardados (aproximação): névoa de guerra explorada (recalculada em volta das unidades), fila de falas abertas na caixa de diálogo.

## Testes das missões (frente MISSÕES)
`npm run test:missions` roda `test/missions_smoke.ts` (46 missões, 600 tiques, relatório; `-- --write` regrava a tabela em notes/missions.md);
`test/mission20.ts` (parte de `test:sim`) é o piloto automático da missão 20 (vitória em Kaarg, opcionais, falhas 2 e 5). `test/loader.ts`
carrega `public/` do disco com o mesmo `loadMissionData` da cena (aceita qualquer objeto com `data.getJson/tryJson`) e traz `startRun`/`run`.
`test/missions_kaarg.ts` (parte de `test:sim`) = pilotos das missões 30, 31, 32, 40, 41, 42 e 43 (vitória + falhas de cada script); `startRun(data, hero, vars, { companions: [10002] })` põe Igles/Dina (unidades de script 10002/10003, `mission/setup.ts spawnCompanions`) no grupo.
