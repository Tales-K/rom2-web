/**
 * Tipos do JSON de script das missões (`public/data/scripts/<missão>.json`, contrato em docs/DATA.md, produzido pela
 * frente MAPAS-RE) e da forma normalizada que o runtime usa.
 */

/** Tipo de parâmetro como vem no JSON (numérico no .alm: 1 int, 2 group, 3 player, 4 unit, 5 x, 6 y, 7 const). */
export type ParamType = "int" | "group" | "player" | "unit" | "x" | "y" | "const" | "none" | "item" | "structure" | string;

export interface ScriptParamJson {
  label: string;
  type: ParamType | number;
  value: number;
  /** posição do parâmetro no registro (0..9); opcional (o grupo-alvo dos comandos de grupo é o slot 9) */
  slot?: number;
}

/** Registro de valor (condição/variável/constante) ou de ação. */
export interface ScriptRecordJson {
  seq: number;
  name: string;
  kind: number;
  kindName?: string;
  params: ScriptParamJson[];
  [extra: string]: unknown;
}

export interface ScriptConditionJson {
  a: number;
  b: number;
  op: string;
  /** código cru do operador no .alm (0..5); quando presente tem prioridade sobre `op` */
  opCode?: number;
}

export interface ScriptTriggerJson {
  name: string;
  enabled?: boolean | number;
  /** "Run Once" do Trigger Manager do editor */
  once?: boolean;
  /** período mínimo entre disparos, em segundos (opcional) */
  period?: number;
  conditions: ScriptConditionJson[];
  actions: number[];
  /** 46 dwords do registro de 0xb8 bytes */
  raw?: number[];
  [extra: string]: unknown;
}

export interface ScriptUnitJson {
  index: number;
  id: number;
  group: number | null;
  kind: number;
  player: number;
  x?: number;
  y?: number;
  [extra: string]: unknown;
}

export interface ScriptGroupJson {
  id: number;
  name?: string;
  units: number[];
}

export interface ScriptFileJson {
  mission: number;
  values: ScriptRecordJson[];
  actions: ScriptRecordJson[];
  triggers: ScriptTriggerJson[];
  units?: ScriptUnitJson[];
  groups?: ScriptGroupJson[];
  heroUnitId?: number;
  players?: { index: number; name: string }[];
  [extra: string]: unknown;
}

// ---------------------------------------------------------------------------------------------- forma normalizada

export type CompareOp = "==" | "!=" | ">" | "<" | ">=" | "<=";

/** Códigos de operador do .alm na ordem dos botões de rádio do diálogo "Trigger Manager" do editor. */
export const OP_CODES: readonly CompareOp[] = ["==", "!=", ">", "<", ">=", "<="];

export interface ScriptParam {
  label: string;
  type: string;
  value: number;
  slot?: number;
}

export interface ScriptRecord {
  seq: number;
  name: string;
  kind: number;
  kindName: string;
  params: ScriptParam[];
}

export interface ScriptCondition {
  a: number;
  b: number;
  op: CompareOp;
}

export interface ScriptTrigger {
  /** posição na lista (ordem de avaliação) */
  index: number;
  name: string;
  /** gatilho participa da avaliação */
  enabled: boolean;
  /** dispara no máximo uma vez ("Run Once") */
  once: boolean;
  /** intervalo mínimo entre disparos (segundos); 0 = a cada ciclo */
  period: number;
  conditions: ScriptCondition[];
  actions: number[];
}

export interface Script {
  mission: number;
  values: Map<number, ScriptRecord>;
  actions: Map<number, ScriptRecord>;
  /** em ordem de arquivo */
  valueList: ScriptRecord[];
  actionList: ScriptRecord[];
  triggers: ScriptTrigger[];
  units: ScriptUnitJson[];
  groups: ScriptGroupJson[];
  heroUnitId: number;
  players: { index: number; name: string }[];
  /** avisos do validador (referências quebradas, tipos desconhecidos...) */
  warnings: string[];
}

// ---------------------------------------------------------------------------------------------- ids de tipo (.ini)

/** "Description Checks.ini" — tipos de valor/condição (27 grupos; TRUE/FALSE/Constant Value compartilham 65538). */
export const CheckKind = {
  GroupUnitCount: 1,
  UnitInBox: 2,
  UnitInCircle: 3,
  UnitParameter: 4,
  UnitAlive: 5,
  UnitsDistance: 6,
  PointUnitDistance: 7,
  PlayerUnitCount: 8,
  UnitAttacking: 9,
  GetDiplomacy: 10,
  GetSack: 14,
  NearestPlayerUnitDistance: 15,
  ItemToPoint: 16,
  ItemInInventory: 17,
  Vip: 18,
  Variable: 19,
  PlayerBuildingCount: 20,
  BuildingHealth: 21,
  Teleportation: 22,
  ScenarioVariable: 23,
  Subobjective: 24,
  SpellOnTile: 25,
  SpellOnUnit: 26,
  CenteredOnTile: 27,
  Constant: 65538,
} as const;

/** "Description Instants.ini" — tipos de ação (49 grupos; os 12 comandos de grupo compartilham o id 6). */
export const InstantKind = {
  IncrementMissionStage: 1,
  SendMessage: 2,
  SetVariable: 3,
  MissionComplete: 4,
  MissionFail: 5,
  GroupCommand: 6,
  SetFormation: 7,
  IncrementVariable: 8,
  ChangeDiplomacy: 10,
  GiveItem: 11,
  AddItem: 12,
  RemoveItem: 13,
  PhaseOutUnit: 16,
  PhaseInUnit: 17,
  Polymorph: 18,
  ChangeUnitOwner: 19,
  DropAll: 20,
  SpellEffect: 21,
  ChangeGroupOwner: 22,
  GiveMoney: 23,
  CastSpellOnUnit: 24,
  SetTrap: 25,
  SetBuildingHealth: 26,
  TeleportUnit: 27,
  GiveAll: 28,
  TileSpellDuration: 29,
  UnitSpellDuration: 30,
  RepopDelay: 31,
  PhaseOutGroup: 32,
  PhaseInGroup: 33,
  SetUnitParameter: 34,
  SetScenarioVariable: 35,
  SetSubobjective: 36,
  SetMusicNode: 37,
  RemoveItemFromEverybody: 38,
  SuspendGroup: 39,
  /** instantes "estáticos": não são executados por gatilhos; descrevem o mapa */
  DropLocation: 65538,
  Outpost: 65539,
  NextMusic: 65540,
} as const;

/** Constante Par0 dos comandos de grupo (ação 6). */
export const GroupCommandCode = {
  Guard: 1, Swarm: 2, StandGround: 3, Move: 4, Swarm2: 5, Attack: 10, Defend: 11, Patrol: 14, Follow: 15, Roam: 17, Dwell: 18,
} as const;
