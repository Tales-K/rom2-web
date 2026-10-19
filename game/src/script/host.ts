/**
 * Interface entre o motor de script das missões (frente SCRIPT) e o mundo da simulação (frente MISSÃO).
 *
 * A frente MISSÃO implementa `ScriptHost` sobre a simulação dela e entrega a instância para `ScriptRuntime`
 * (`runtime.ts`). Documentação completa: `docs/SCRIPT_HOST.md`. Este arquivo é o contrato estável:
 * métodos só são acrescentados (opcionais); nada é renomeado sem aviso em `docs/REQUESTS.md`.
 *
 * Convenções (todas as referências são as do script, não as da simulação):
 * - `UnitRef`: id de unidade do script = `units[].id` do JSON de script; 10001 = herói do jogador
 *   (10002 / 10003 = 2º e 3º heróis do grupo nas missões que têm vários, por exemplo o cavaleiro e Dina).
 * - `GroupRef`: id de grupo = `groups[].id` do JSON de script.
 * - `PlayerRef`: jogador = posição 1-based na lista `players` do mapa (1 = o jogador humano, "self").
 * - Coordenadas em **células** do mapa (tiles de 32 px), as mesmas do editor. `unitPosition` pode devolver
 *   fração (38.5 = centro da célula 38); o runtime trabalha com a célula (`Math.floor`).
 * - `ItemRef`, `SpellRef`, `StructureRef`: ids numéricos crus do editor (itens/magias como na base de dados do jogo;
 *   estrutura = `structures[].id` do mapa).
 *
 * Métodos marcados com `?` são opcionais: se o host não os implementar, o runtime usa o valor padrão documentado
 * (consultas) ou registra a ação como "não implementada" no log e segue (comandos). Nenhum método pode lançar exceção
 * para referência inexistente: devolva o valor "ausente" documentado.
 */

export type UnitRef = number;
export type GroupRef = number;
export type PlayerRef = number;
export type ItemRef = number;
export type SpellRef = number;
export type StructureRef = number;

/** Id especial do herói do jogador nos parâmetros `unit#N`. */
export const HERO_UNIT_ID = 10001;

/** Diplomacia como o script usa ("Change diplomacy"/"Get diplomacy"). */
export const Diplomacy = {
  /** paz / neutro ("Make 4th troll neutral" = 0; "Skrakan is friendly" exige 0) */
  Peace: 0,
  /** guerra / hostil ("Make ogre angry" = 1) */
  War: 1,
  /** aliado ("Druids become ally" = 2) */
  Ally: 2,
} as const;
export type DiplomacyValue = number;

/** Estado de um subobjetivo ("Set Subobjective"): 0 = oculto, 1 = mostrado/em andamento ("Sub2+"), 2 = cumprido ("Sub2!"). */
export const Subobjective = { Hidden: 0, Active: 1, Done: 2 } as const;

/** Parâmetros de unidade ("Get/Set unit parameter"). Só 6 = vida aparece nas missões. */
export const UnitParameter = { Health: 6 } as const;

/** Distância devolvida quando uma das pontas não existe (unidade morta, fora de fase, desconhecida). */
export const FAR_AWAY = 9999;

export interface Cell { x: number; y: number; }

/**
 * Comando de grupo (ação 6 "Group Command : ..."; o tipo vem da constante Par0 do .ini).
 * `x`/`y` em células; `range` em células.
 */
export type GroupCommand =
  | { type: "guard"; range: number }                         // Const 1  — guardar a posição atual num raio
  | { type: "swarm"; x: number; y: number }                  // Const 2  — avançar atacando até (x,y)
  | { type: "standGround" }                                  // Const 3  — parar e ficar
  | { type: "move"; x: number; y: number }                   // Const 4  — mover até (x,y) sem parar para lutar
  | { type: "swarm2"; x: number; y: number }                 // Const 5  — variante de swarm (tratar como swarm)
  | { type: "attack"; victim: UnitRef }                      // Const 10 — atacar a unidade
  | { type: "defend"; unit: UnitRef; range: number }         // Const 11 — defender a unidade, seguindo-a até `range`
  | { type: "patrol"; x: number; y: number }                 // Const 14 — patrulhar entre a posição atual e (x,y)
  | { type: "follow"; unit: UnitRef; range: number }         // Const 15 — seguir a unidade (escolta/refém)
  | { type: "roam" }                                         // Const 17 — vagar
  | { type: "dwell"; range: number }                         // Const 18 — permanecer na área
  | { type: "unknown"; code: number; params: number[] };

/** Nível de log do runtime. */
export type ScriptLogLevel = "info" | "warn";

export interface ScriptHost {
  // ------------------------------------------------------------------ consultas ao mundo
  // Chamadas várias vezes por ciclo de avaliação: devem ser baratas e sem efeitos colaterais.

  /** Célula/posição da unidade, ou `null` se ela não existe, morreu ou está fora de fase (phase out). */
  unitPosition(unit: UnitRef): Cell | null;
  /** A unidade existe e está viva (unidades fora de fase contam como vivas). Padrão: `unitPosition(u) !== null`. */
  unitAlive?(unit: UnitRef): boolean;
  /** Atributo da unidade ("Get unit parameter"). 6 = vida atual, na mesma escala do jogo. Ausente: 0. */
  unitParameter?(unit: UnitRef, param: number): number;
  /** A unidade está atacando / em combate ("Is unit make attack"). Padrão: false. */
  unitIsAttacking?(unit: UnitRef): boolean;
  /** A unidade carrega o item no inventário ("Item in inventory", "Item to point"). Padrão: false. */
  unitHasItem?(unit: UnitRef, item: ItemRef): boolean;
  /** A unidade está sob efeito da magia ("Spell on Unit"). Padrão: false. */
  unitHasSpell?(unit: UnitRef, spell: SpellRef): boolean;
  /** Dono atual da unidade (jogador), ou 0 se não existe. Usado só para diagnóstico. */
  unitPlayer?(unit: UnitRef): PlayerRef;

  /** Quantas unidades do grupo ainda vivem ("How many units contains this group"; 0 = grupo eliminado).
   *  Recomendação: contar também as que estão fora de fase. */
  groupUnitCount(group: GroupRef): number;
  /** Ids (do script) das unidades do grupo, vivas. Usado por "Phase in/out group" etc. no host; opcional. */
  groupUnits?(group: GroupRef): UnitRef[];
  /** Quantas unidades vivas o jogador tem ("How many units this player have"). Padrão: 0. */
  playerUnitCount?(player: PlayerRef): number;
  /** Quantas estruturas o jogador tem ("How many buildings this player have"). Padrão: 0. */
  playerBuildingCount?(player: PlayerRef): number;
  /** Vida da estrutura ("Health of building"); 0 se destruída/inexistente. Padrão: 0. */
  buildingHealth?(building: StructureRef): number;
  /** Distância (células) da unidade viva mais próxima do jogador até (x,y) ("Distance to nearest units of player").
   *  Padrão: o runtime não sabe calcular sem lista de unidades → `FAR_AWAY`. */
  nearestPlayerUnitDistance?(player: PlayerRef, x: number, y: number): number;

  /** Diplomacia de `a` para `b` (0 paz, 1 guerra, 2 aliado). */
  diplomacy(a: PlayerRef, b: PlayerRef): DiplomacyValue;
  /** Dinheiro do jogador (não há condição no .ini, mas útil para diagnóstico). */
  money?(player: PlayerRef): number;

  /** Quantos itens há num saco (sack) caído na célula ("Get sack"). Padrão: 0. */
  sackItemCount?(x: number, y: number): number;
  /** Há efeito de magia na célula/camada ("Spell on Tile"); devolve o id/força (0 = nada). Padrão: 0. */
  spellOnTile?(x: number, y: number, layer: number): number;
  /** Há teleporte ativo de (fx,fy) para (tx,ty) ("Teleportation"). Padrão: 0. */
  teleportation?(fromX: number, fromY: number, toX: number, toY: number): number;

  /** Variável de cenário/campanha (persistente entre missões; ex.: 777 "Was in 70 mission").
   *  Se não implementado, o runtime guarda em memória (perde ao sair da missão). */
  getScenarioVariable?(index: number): number;

  // ------------------------------------------------------------------ comandos (ações)
  // Chamados na ordem em que as ações do gatilho aparecem. Não precisam ser instantâneos (ex.: mensagem
  // pode entrar numa fila de diálogo); o runtime não espera.

  /** "Send message N": mostrar a fala `event<N>` de `texts/mission<id>.json` (escolhendo pelas tags do herói). */
  sendMessage(n: number): void;
  /** "Set Subobjective": mostrar/atualizar o subobjetivo N (0 oculto, 1 ativo, 2 cumprido). */
  setSubobjective(n: number, value: number): void;
  /** "Force Mission Complete": o runtime chama uma só vez (o primeiro desfecho vence). */
  missionComplete(): void;
  /** "Force Mission Fail" com a causa (texto `failure<cause>`; 0 = genérica). Chamado uma só vez. */
  missionFail(cause: number): void;
  /** "Change diplomacy": diplomacia de `a` para `b` passa a `value` (a relação é direcional, como no script). */
  setDiplomacy(a: PlayerRef, b: PlayerRef, value: DiplomacyValue): void;
  /** "Give money to player". */
  giveMoney(player: PlayerRef, amount: number): void;
  /** "Phase out unit": retira a unidade do mapa (invisível, sem colisão, sem IA) sem matá-la. */
  phaseOutUnit(unit: UnitRef): void;
  /** "Phase in unit": recoloca no mapa uma unidade fora de fase. */
  phaseInUnit(unit: UnitRef): void;
  /** "Phase Out Group". Padrão: `phaseOutUnit` em `groupUnits(g)` se houver. */
  phaseOutGroup?(group: GroupRef): void;
  /** "Phase In Group". Padrão: `phaseInUnit` em `groupUnits(g)` se houver. */
  phaseInGroup?(group: GroupRef): void;
  /** Comandos de grupo (guardar, mover, patrulhar, defender, seguir, parar...). */
  groupCommand(group: GroupRef, cmd: GroupCommand): void;
  /** "Give All": `from` entrega todo o inventário (e o dinheiro, se houver) a `to` (ex.: Skrakan entrega os documentos). */
  giveAll(from: UnitRef, to: UnitRef): void;

  /** "Increment mission stage". */
  incrementMissionStage?(stage: number): void;
  /** "Set formation". */
  setFormation?(player: PlayerRef, formation: number): void;
  /** "Change unit's owner". */
  changeUnitOwner?(unit: UnitRef, player: PlayerRef): void;
  /** "Change group's owner". */
  changeGroupOwner?(group: GroupRef, player: PlayerRef): void;
  /** "Drop all": a unidade larga todo o inventário num saco no chão. */
  dropAll?(unit: UnitRef): void;
  /** "Add item to unit's inventory". */
  addItem?(unit: UnitRef, item: ItemRef): void;
  /** "Remove item from unit's inventory". */
  removeItem?(unit: UnitRef, item: ItemRef): void;
  /** "Give item from one unit to another". */
  giveItem?(from: UnitRef, to: UnitRef, item: ItemRef): void;
  /** "Remove item from everybody's inventory". */
  removeItemFromEverybody?(item: ItemRef): void;
  /** "Polymorph unit": `trueForm` vira `polymorphForm` (as duas são unidades do mapa; uma sai, a outra entra no lugar). */
  polymorph?(trueForm: UnitRef, polymorphForm: UnitRef): void;
  /** "Make spell effect": efeito de magia de (fx,fy) para (tx,ty). */
  spellEffect?(fromX: number, fromY: number, toX: number, toY: number, spell: SpellRef, power: number): void;
  /** "Cast spell to unit". */
  castSpellOnUnit?(fromX: number, fromY: number, unit: UnitRef, spell: SpellRef, power: number): void;
  /** "Set trap": quando alguém pisar em (trigger), lança `spell` de (source) para (target). */
  setTrap?(spell: SpellRef, power: number, triggerX: number, triggerY: number,
           sourceX: number, sourceY: number, targetX: number, targetY: number): void;
  /** "Set building's health". */
  setBuildingHealth?(building: StructureRef, health: number): void;
  /** "Teleport unit". */
  teleportUnit?(unit: UnitRef, x: number, y: number): void;
  /** "Tile Spell Duration". */
  setTileSpellDuration?(x: number, y: number, spell: SpellRef, duration: number): void;
  /** "Unit Spell Duration". */
  setUnitSpellDuration?(unit: UnitRef, spell: SpellRef, duration: number): void;
  /** "Repop Delay" (grupo de reaparecimento de um "Outpost"). */
  setRepopDelay?(group: GroupRef, delay: number): void;
  /** "Set Unit Parameter" (6 = vida). */
  setUnitParameter?(unit: UnitRef, param: number, value: number): void;
  /** "Change next music to". */
  setNextMusic?(theme: number): void;
  /** "Set music node". */
  setMusicNode?(x: number, y: number, themes: number[]): void;
  /** "Suspend group": o grupo para de agir (IA desligada) até novo comando. */
  suspendGroup?(group: GroupRef): void;
  /** "Set Scenario Variable" (persistente entre missões). Se não implementado, o runtime guarda em memória. */
  setScenarioVariable?(index: number, value: number): void;

  /** Log do runtime (ações não implementadas, avisos de validação, rastreio). Padrão: silencioso. */
  log?(level: ScriptLogLevel, message: string): void;
}
