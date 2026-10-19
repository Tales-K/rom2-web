/**
 * Tipos da campanha: o subconjunto de `data/campaign.json` e `data/campaign-shops.json` (tools/data/campaign.py; esquema em
 * docs/DATA.md, seção CAMPANHA) que o motor usa, e o estado salvo (`Progress.campaign`).
 * Fonte da verdade das regras: notes/campaign.md (progressão decifrada do Scenario.dll).
 */

/** Condição (todas as de uma lista precisam valer). */
export type Cond =
  | { stage: number[] } | { stageGt: number } | { stageGe: number } | { town: number }
  | { var: number; eq: number } | { var: number; ne: number }
  | { done: number } | { notDone: number } | { anyDone: number[] } | { noneDone: number[] }
  | { heroMage: boolean } | { heroFemale: boolean } | { completed: number };

/** Efeito (ver legend.effects do campaign.json). */
export type Effect =
  | { addMission: number } | { addTown: number } | { setVar: [number, number] }
  | { merc: { id: number; state: number; town: number } } | { cutscene: number }
  | { if: Cond[]; then: Effect[]; else?: Effect[] }
  | { setShopMasks: { town: number; masks: Record<string, number> } }
  | { orShopMask: { town: number; shelf: number; bits: number } }
  | { initShop: number } | { partyJoin: number } | { stageAdvance: number };

export interface MapPos { x: number; y: number; map: "uimoir" | "yases" }

export interface MissionDef {
  id: number;
  title: string;
  briefing: string | null;          // #briefing<id> do globalmap.txt
  missionBriefing?: string | null;  // #briefing de mission<id>.txt (1ª linha = título)
  main: boolean;
  mapPos: MapPos;
  town: number | null;
  onComplete: Effect[];
  scenarioVarsSet?: Array<{ var: number; value: number; action?: string }>;
  recommendedLevel?: number;
  /** grupo de estágio da missão (id da principal do bloco) e estágios em que a taverna a oferece; condições de oferta */
  stageGroup: number;
  stagesOffered: number[];
  prerequisites?: Cond[];
}

export interface TownDef {
  id: number;
  key: "plagat" | "kaarg" | "druids";
  name: string;
  title: string;
  description: string | null;
  map: "uimoir" | "yases";
  art: "base" | "kaarg" | "druid";
  music: string;
  tips: string | null;
  guard: string | null;
  mapPos: MapPos;
  townPeopleKeys: string[];
}

export interface InnRule {
  order: number;
  code: string;
  npc: number;
  talk: number;
  kind: number;          // 0 conversa, 3 oferece missão
  textKey: string;
  conditions: Cond[];
  effects: Effect[];
}

export interface MercDef {
  desc: string; town: number; firstStage: number;
  templates: Record<string, number>;
  aboutKey: string; acceptKeys: string[]; rejectKeys: string[]; price: number;
}

export interface NpcDef {
  id: number; name: string; template: string | null; serverId: number | null; typeId: number | null;
  portrait: string | null; roles: string[]; offers: number[]; towns: number[]; merc?: MercDef;
}

export interface ShelfCfg { index?: number; min: number; max: number | null; count: number; qty: number; mask: number }

export interface CampaignData {
  version: number;
  start: { stage: number; town: number; availableLocations: Array<["T" | "M", number]> };
  towns: TownDef[];
  missions: Record<string, MissionDef>;
  npcs: Record<string, NpcDef>;
  innRules: InnRule[];
  cutscenes: Array<{ id: number; name: string; video: string; when: string }>;
  shopRules: {
    towns: Record<string, { shelves: ShelfCfg[] }>;
    stagePrices: Record<string, { kaargMax: number | null; druidMax: number | null; kaargMin: number | null }>;
  };
  validation?: { canonical?: Record<string, { order: number[]; cutscenes: number[] }> };
}

/** Candidato de prateleira (campaign-shops.json). */
export interface ShopCandidate {
  id: number | null; name: string; price: number | null; inItemsJson?: boolean; table?: string;
  serverName?: string; spell?: number; spellName?: string; fixed?: boolean;
}
export interface ShopShelfData { shelf: number; min: number; max: number | null; count: number; qty: number; mask: string; candidates: ShopCandidate[] }
export interface ShopsData { towns: Record<string, Record<string, ShopShelfData[]>> }

/** Item mínimo do items.json usado para as prateleiras Elven da loja druida (orShopMask). */
export interface PoolItem { id: number; name: string; price: number; shape?: string; material?: string; kind?: string }

// ------------------------------------------------------------------ estado salvo
export type LocKind = "T" | "M";
export type Loc = [LocKind, number];

/** Item à venda (id = chave do items.json; livros: "<id>#<magia>"). */
export interface StockItem { id: string; base: number; name: string; price: number; count: number; spell?: number }
export interface TownStock { key: string; shelves: StockItem[][] }

export interface CampaignState {
  v: 1;
  /** `vars[1024]` do Scenario.dll, esparso (só os não nulos). Índices em campaign.json.vars. */
  vars: Record<string, number>;
  /** lista de locais disponíveis (ordem do original: o 1º é para onde se vai quando não há escolha) */
  locations: Loc[];
  /** local atual (ScenarioGetCurrentLocation) */
  current: Loc | null;
  /** última cidade em que o herói esteve (1..3) */
  lastTown: number;
  /** mapa-múndi da próxima abertura: Uimoir só ao sair de Plagat */
  map: "uimoir" | "yases";
  /** configuração das lojas [cidade][prateleira] (ScenarioSave guarda isto) */
  shops: Record<string, ShelfCfg[]>;
  /** estoque gerado por cidade (regenerado quando muda o estágio/máscara) */
  stock: Record<string, TownStock>;
  /** semente estável por save (estoque das lojas) */
  seed: number;
  /** vídeos de transição já vistos (galeria "Cut Scenes") */
  videos: number[];
  /** vídeos a tocar na próxima volta à cidade (consumidos por runtime.ts) */
  pending: number[];
  /** npcs no grupo além do herói (22 Igles, 23 Dina) */
  party: number[];
  /** missões concluídas, em ordem */
  log: number[];
  /** missões cujo resultado ainda não foi aplicado (gravado pela missão, aplicado pela cidade) */
  queue: Array<{ id: number; scenarioVars?: Array<[number, number]> }>;
  /** fim do jogo (estágio 120) já registrado no hall da fama */
  ended?: boolean;
  /** estatísticas do hall da fama (campaign/hall.ts): segundos de jogo nas missões e unidades mortas, acumulados ao fim de cada missão */
  hall?: { seconds: number; kills: number };
}

export type MissionOutcomeKind = "complete" | "fail" | "abort";

export interface MissionResultIn {
  id: number;
  outcome: MissionOutcomeKind;
  /** variáveis de cenário gravadas pelo script ("Set Scenario Variable"/"Set Subobjective"); ausente = derivar do campaign.json */
  scenarioVars?: Array<[number, number]> | Record<string, number>;
}

export interface MissionOutcome {
  completed: boolean;
  stageBefore: number;
  stageAfter: number;
  cutscenes: number[];
  added: Loc[];
  joined: number[];
  ended: boolean;
  next: Loc | null;
}

export interface InnPatron {
  code: number;
  npc: number;
  /** fala M (id da missão para quem oferece; 0 para mercenário) */
  talk: number;
  /** 0 conversa, 1 mercenário livre, 2 mercenário descansando, 3 oferece missão */
  kind: 0 | 1 | 2 | 3;
  hired: boolean;
  /** seção de town.json da conversa (npc<N>talk<M> ou npc<n>about) */
  textKey: string;
  mission?: number;
  merc?: number;
  acceptKey?: string;
  rejectKey?: string;
  /** retrato (graphics/interface/inn/unit<typeId>) */
  portrait?: string;
}

export interface MapNode { kind: "town" | "mission"; id: number; x: number; y: number; done?: boolean; current?: boolean }
