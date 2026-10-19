/**
 * Motor de campanha (puro: sem DOM, sem Pixi; testado em campaign/test/run.ts com `npm run test:campaign`).
 *
 * Reimplementa as regras do Scenario.dll decifradas em notes/campaign.md (a fonte da verdade) sobre os dados de
 * data/campaign.json: `vars[1024]` (estágio em vars[768]), lista de locais disponíveis, taverna (ScenarioEnterInn/TalkTo),
 * conclusão de missão (DLL 0x10001da5), mercenários, lojas e mapa-múndi. Endereços citados = evidência no original.
 *
 * Decisões onde o original não foi decifrado (registradas em docs/GAPS.md e notes/campaign-impl.md):
 *  - depois de uma missão, com alguma cidade disponível, o jogo abre o mapa-múndi (Yases); sem cidade (só após a 10) entra
 *    direto no 1º local da lista [exe 0x486d45];
 *  - sem `scenarioVars` no resultado, as variáveis que o script da missão gravaria assumem o último valor listado em
 *    `missions[M].scenarioVarsSet` (20 → 772=1, 50 → 780=1, 110 → 779=1), como a simulação de tools/data/campaign.py;
 *  - Igles (npc 22) entra no grupo ao falar com ele na 30 (npc22talk30) — estimado.
 */
import type {
  CampaignData, CampaignState, Cond, Effect, InnPatron, Loc, MapNode, MissionOutcome, MissionResultIn, ShelfCfg,
} from "./types";

// ------------------------------------------------------------------ índices de vars[] (campaign.json.vars)
export const V_HIRED = 512, V_MERC_STATE = 532, V_MERC_TOWN = 552, V_SUBOBJ = 752;
export const V_STAGE = 768, V_M10_TAKEN = 769, V_JOIN = 773, V_OPENALL = 775, V_MAGE = 776, V_FEMALE = 781, V_DONE = 896;
export const FINAL_STAGE = 120;
export const MERC_COUNT = 20;

// ------------------------------------------------------------------ variáveis
export function getVar(st: CampaignState, i: number): number { return st.vars[i] ?? 0; }
export function setVar(st: CampaignState, i: number, v: number): void {
  if (v) st.vars[i] = v | 0; else delete st.vars[i];
}
export function stageOf(st: CampaignState): number { return getVar(st, V_STAGE); }
export function isDone(st: CampaignState, m: number): boolean { return getVar(st, V_DONE + m) !== 0; }
export function heroIsMage(st: CampaignState): boolean { return getVar(st, V_MAGE) !== 0; }
export function heroIsFemale(st: CampaignState): boolean { return getVar(st, V_FEMALE) !== 0; }

const sameLoc = (a: Loc, b: Loc) => a[0] === b[0] && a[1] === b[1];
export function hasLoc(st: CampaignState, l: Loc): boolean { return st.locations.some(x => sameLoc(x, l)); }
function addLoc(st: CampaignState, l: Loc, added?: Loc[]): void {
  if (hasLoc(st, l)) return;
  st.locations.push([l[0], l[1]]);
  added?.push([l[0], l[1]]);
}
function removeLoc(st: CampaignState, l: Loc): void { st.locations = st.locations.filter(x => !sameLoc(x, l)); }

export function availableTowns(st: CampaignState): number[] { return st.locations.filter(l => l[0] === "T").map(l => l[1]); }
export function availableMissions(st: CampaignState): number[] { return st.locations.filter(l => l[0] === "M").map(l => l[1]); }
export function isTownAvailable(st: CampaignState, t: number): boolean { return hasLoc(st, ["T", t]); }
export function isMissionAvailable(st: CampaignState, m: number): boolean { return hasLoc(st, ["M", m]); }

// ------------------------------------------------------------------ RNG estável (mulberry32)
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashSeed(...parts: Array<number | string>): number {
  let h = 2166136261 >>> 0;
  for (const p of parts) for (const ch of String(p) + "|") { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

// ------------------------------------------------------------------ novo jogo (ScenarioNewGame, DLL 0x100033be)
export interface HeroFlags { mage: boolean; female: boolean }

export function newCampaign(data: CampaignData, hero: HeroFlags, seed = Date.now() >>> 0): CampaignState {
  const st: CampaignState = {
    v: 1, vars: {}, locations: data.start.availableLocations.map(l => [l[0], l[1]] as Loc), current: ["T", data.start.town],
    lastTown: data.start.town, map: "yases", shops: {}, stock: {}, seed: seed >>> 0, videos: [], pending: [], party: [], log: [], queue: [],
  };
  setVar(st, V_STAGE, data.start.stage);
  setVar(st, V_MAGE, hero.mage ? 1 : 0);        // exe 0x4896e1 (flag 0x40 do herói)
  setVar(st, V_FEMALE, hero.female ? 1 : 0);    // exe 0x489705 (flag 0x80)
  for (const t of ["1", "2"]) initShop(st, data, Number(t));
  return st;
}

function initShop(st: CampaignState, data: CampaignData, town: number): void {
  const cfg = data.shopRules.towns[String(town)];
  if (!cfg) return;
  st.shops[String(town)] = cfg.shelves.map(s => ({ min: s.min, max: s.max, count: s.count, qty: s.qty, mask: s.mask >>> 0 }));
  delete st.stock[String(town)];
}

// ------------------------------------------------------------------ condições e efeitos
export function evalCond(c: Cond, st: CampaignState, town: number | null): boolean {
  const k = c as Record<string, unknown>;
  if ("stage" in k) return (k.stage as number[]).includes(stageOf(st));
  if ("stageGt" in k) return stageOf(st) > (k.stageGt as number);
  if ("stageGe" in k) return stageOf(st) >= (k.stageGe as number);
  if ("town" in k) return town === k.town;
  if ("var" in k) { const x = getVar(st, k.var as number); return "eq" in k ? x === k.eq : x !== k.ne; }
  if ("done" in k) return isDone(st, k.done as number);
  if ("completed" in k) return isDone(st, k.completed as number);
  if ("notDone" in k) return !isDone(st, k.notDone as number);
  if ("anyDone" in k) return (k.anyDone as number[]).some(m => isDone(st, m));
  if ("noneDone" in k) return !(k.noneDone as number[]).some(m => isDone(st, m));
  if ("heroMage" in k) return heroIsMage(st) === k.heroMage;
  if ("heroFemale" in k) return heroIsFemale(st) === k.heroFemale;
  throw new Error("condição desconhecida: " + JSON.stringify(c));
}
export const evalAll = (cs: Cond[], st: CampaignState, town: number | null) => cs.every(c => evalCond(c, st, town));

interface EffectLog { cutscenes: number[]; added: Loc[]; joined: number[] }

function applyEffects(st: CampaignState, data: CampaignData, effs: Effect[], log: EffectLog): void {
  for (const e of effs) {
    const k = e as Record<string, unknown>;
    if ("addMission" in k) addLoc(st, ["M", k.addMission as number], log.added);
    else if ("addTown" in k) addLoc(st, ["T", k.addTown as number], log.added);
    else if ("setVar" in k) { const [i, v] = k.setVar as [number, number]; setVar(st, i, v); }
    else if ("merc" in k) {
      const m = k.merc as { id: number; state: number; town: number };
      setVar(st, V_MERC_STATE + m.id - 1, m.state);
      setVar(st, V_MERC_TOWN + m.id - 1, m.town);
    } else if ("cutscene" in k) log.cutscenes.push(k.cutscene as number);
    else if ("if" in k) {
      const ife = e as { if: Cond[]; then: Effect[]; else?: Effect[] };
      applyEffects(st, data, evalAll(ife.if, st, null) ? ife.then : ife.else ?? [], log);
    } else if ("setShopMasks" in k) {
      const s = k.setShopMasks as { town: number; masks: Record<string, number> };
      const shelves = st.shops[String(s.town)];
      if (shelves) for (const [i, m] of Object.entries(s.masks)) if (shelves[Number(i)]) shelves[Number(i)].mask = m >>> 0;
    } else if ("orShopMask" in k) {
      const s = k.orShopMask as { town: number; shelf: number; bits: number };
      const sh = st.shops[String(s.town)]?.[s.shelf];
      if (sh) sh.mask = (sh.mask | s.bits) >>> 0;
    } else if ("initShop" in k) initShop(st, data, k.initShop as number);
    else if ("partyJoin" in k) {
      const npc = k.partyJoin as number;
      setVar(st, V_JOIN, npc);                    // exe 0x486c5b: entra no grupo ao voltar da missão
      if (!st.party.includes(npc)) { st.party.push(npc); log.joined.push(npc); }
    } else if ("stageAdvance" in k) advanceStage(st, data, k.stageAdvance as number);
    else throw new Error("efeito desconhecido: " + JSON.stringify(e));
  }
}

/** Estágio novo: soma e aplica os preços máximos/mínimos das lojas (DLL 0x100024b0..0x100026e9). */
function advanceStage(st: CampaignState, data: CampaignData, by: number): void {
  const s = stageOf(st) + by;
  setVar(st, V_STAGE, s);
  const p = data.shopRules.stagePrices[String(s)];
  if (!p) return;
  const set = (town: string, max: number | null, min: number | null) => {
    for (const sh of st.shops[town] ?? []) { if (max !== null) sh.max = max; if (min !== null) sh.min = min; }
  };
  set("2", p.kaargMax, p.kaargMin);
  if (p.druidMax !== null) set("3", p.druidMax, null);
}

// ------------------------------------------------------------------ taverna (ScenarioEnterInn, DLL 0x1000286b)
export function decodeInnCode(code: number): { npc: number; talk: number; kind: number; hired: boolean } {
  return { npc: code & 0xffff, talk: (code >>> 16) & 0xfff, kind: (code >>> 28) & 7, hired: (code >>> 31) !== 0 };
}

/** Chave de fala por estágio: a maior `<base><n>` com n ≤ estágio (ou a primeira). */
function keyForStage(keys: string[], stage: number): string | undefined {
  let best: string | undefined, bestN = -1, first: string | undefined, firstN = Infinity;
  for (const k of keys) {
    const n = Number(k.match(/(\d+)$/)?.[1] ?? NaN);
    if (!Number.isFinite(n)) continue;
    if (n <= stage && n > bestN) { best = k; bestN = n; }
    if (n < firstN) { first = k; firstN = n; }
  }
  return best ?? first;
}

/**
 * Frequentadores da taverna da cidade `town`, na ordem do original: regras do switch por estágio (innRules) e depois os
 * mercenários com cidade = `town` e estado 1 (livre) ou 2 (descansando) [DLL 0x1000315a].
 */
export function innPatrons(st: CampaignState, data: CampaignData, town: number): InnPatron[] {
  const out: InnPatron[] = [];
  for (const r of [...data.innRules].sort((a, b) => a.order - b.order)) {
    if (!evalAll(r.conditions, st, town)) continue;
    const kind = r.kind === 3 ? 3 : 0;
    out.push({
      code: parseInt(r.code, 16) >>> 0, npc: r.npc, talk: r.talk, kind, hired: false, textKey: r.textKey,
      mission: kind === 3 ? r.talk : undefined, portrait: data.npcs[String(r.npc)]?.portrait ?? undefined,
    });
  }
  const stage = stageOf(st);
  for (let i = 0; i < MERC_COUNT; i++) {
    const state = getVar(st, V_MERC_STATE + i);
    if (getVar(st, V_MERC_TOWN + i) !== town || (state !== 1 && state !== 2)) continue;
    const n = i + 1;
    const hired = getVar(st, V_HIRED + i) !== 0;
    const merc = data.npcs[String(n)]?.merc;
    out.push({
      code: ((state << 28) | n | (hired ? 0x80000000 : 0)) >>> 0, npc: n, talk: 0, kind: state as 1 | 2, hired,
      textKey: merc?.aboutKey ?? `npc${n}about`, merc: n, portrait: data.npcs[String(n)]?.portrait ?? undefined,
      acceptKey: merc ? keyForStage(merc.acceptKeys, stage) : undefined, rejectKey: merc ? keyForStage(merc.rejectKeys, stage) : undefined,
    });
  }
  return out;
}

export interface TalkResult { addedMission?: number; effects: boolean; joined: number[] }

/**
 * Botão "Talk" num frequentador (ScenarioTalkTo, DLL 0x100032c0): quem oferece missão (tipo 3) já a põe no mapa
 * [exe 0x49ba28]; efeitos de conversa (517/10 libera o portão de Plagat, 22/30 libera o mercenário 2, 5/79, 675/78).
 * Mercenário: o "Talk" só mostra `npc<n>about` (sem efeito).
 */
export function talkTo(st: CampaignState, data: CampaignData, p: InnPatron): TalkResult {
  const res: TalkResult = { effects: false, joined: [] };
  if (p.kind === 1 || p.kind === 2) return res;
  if (p.kind === 3 && p.mission && !isDone(st, p.mission) && !isMissionAvailable(st, p.mission)) {
    addLoc(st, ["M", p.mission]);
    res.addedMission = p.mission;
  }
  const rule = data.innRules.find(r => r.npc === p.npc && r.talk === p.talk);
  if (rule?.effects.length) {
    const log: EffectLog = { cutscenes: [], added: [], joined: [] };
    applyEffects(st, data, rule.effects, log);
    res.effects = true;
  }
  // Igles entra no grupo a partir da conversa da missão 30 (estimado: notes/campaign.md, "Lacunas")
  if (p.npc === 22 && p.talk === 30 && !st.party.includes(22)) { st.party.push(22); res.joined.push(22); }
  return res;
}

export interface HireResult { hired: boolean; refused: boolean; textKey?: string }

/** Botão "Hire"/"Fire" de um mercenário [exe 0x49b812 / 0x49b989]: estado 1 alterna o contrato; estado 2 recusa. Grátis. */
export function toggleHire(st: CampaignState, data: CampaignData, merc: number): HireResult {
  const i = merc - 1;
  const state = getVar(st, V_MERC_STATE + i);
  const m = data.npcs[String(merc)]?.merc;
  const stage = stageOf(st);
  if (state === 2) return { hired: false, refused: true, textKey: m ? keyForStage(m.rejectKeys, stage) : undefined };
  if (state !== 1) return { hired: false, refused: true };
  const now = getVar(st, V_HIRED + i) ? 0 : 1;
  setVar(st, V_HIRED + i, now);
  return { hired: !!now, refused: false, textKey: now && m ? keyForStage(m.acceptKeys, stage) : undefined };
}

export function hiredMercs(st: CampaignState): number[] {
  const out: number[] = [];
  for (let i = 0; i < MERC_COUNT; i++) if (getVar(st, V_HIRED + i)) out.push(i + 1);
  return out;
}

/** Template de unidade do mercenário n no estágio atual: 10000 + 10·n + estágio/10 − 2 [exe 0x4f36c0]. */
export function mercTemplate(data: CampaignData, n: number, stage: number): number {
  const t = data.npcs[String(n)]?.merc?.templates?.[String(stage)];
  return t ?? 10000 + 10 * n + Math.max(0, Math.floor(stage / 10) - 2);
}

/** Quem vai para a missão além do herói: Igles/Dina (unidades 10002/10003) e os mercenários contratados (templates). */
export function partyForMission(st: CampaignState, data: CampaignData): { companions: Array<{ npc: number; unit: number }>; mercs: Array<{ merc: number; template: number }> } {
  const unit: Record<number, number> = { 22: 10002, 23: 10003 };
  return {
    companions: st.party.filter(n => unit[n]).map(n => ({ npc: n, unit: unit[n] })),
    mercs: hiredMercs(st).map(n => ({ merc: n, template: mercTemplate(data, n, stageOf(st)) })),
  };
}

// ------------------------------------------------------------------ locais (Enter/LeaveLocation)
export interface LeaveResult { ok: boolean; map: "uimoir" | "yases"; autoMission?: number }

/**
 * Sair de uma cidade pelo portão. Plagat: o guarda bloqueia até a missão 10 ser aceita (vars[769], exe 0x4cd100); ao sair,
 * Plagat some da lista (DLL 0x10001d5c) e o mapa Uimoir leva o herói sozinho ao 1º local (missão 10) [exe 0x487dc4, 0x470743].
 */
export function leaveTown(st: CampaignState, town: number): LeaveResult {
  if (town === 1) {
    if (!getVar(st, V_M10_TAKEN)) return { ok: false, map: "uimoir" };
    removeLoc(st, ["T", 1]);
    st.map = "uimoir";
    st.current = null;
    const first = st.locations.find(l => l[0] === "M");
    return { ok: true, map: "uimoir", autoMission: first?.[1] };
  }
  st.map = "yases";
  st.current = null;
  return { ok: true, map: "yases" };
}

/** Entrar num local (ScenarioEnterLocation): missão zera os subobjetivos vars[752..767] [DLL 0x10001d40]. */
export function enterLocation(st: CampaignState, l: Loc): void {
  st.current = [l[0], l[1]];
  st.map = "yases";                                  // Uimoir só vale para a viagem que sai de Plagat
  if (l[0] === "M") { for (let i = 0; i < 16; i++) setVar(st, V_SUBOBJ + i, 0); }
  else st.lastTown = l[1];
}

/** Para onde ir quando não há escolha: o 1º local da lista [exe 0x486d4f]. */
export function firstLocation(st: CampaignState): Loc | null { return st.locations[0] ? [st.locations[0][0], st.locations[0][1]] : null; }

/** Destino depois de uma missão: mapa-múndi se houver cidade; senão o 1º local (missão) direto. */
export function nextAfterMission(st: CampaignState): { scene: "globalmap" } | { scene: "mission"; mission: number } | { scene: "end" } {
  if (stageOf(st) >= FINAL_STAGE) return { scene: "end" };
  if (availableTowns(st).length) return { scene: "globalmap" };
  const m = st.locations.find(l => l[0] === "M");
  return m ? { scene: "mission", mission: m[1] } : { scene: "globalmap" };
}

// ------------------------------------------------------------------ conclusão de missão (ScenarioLeaveLocation, DLL 0x10001da5)
function toPairs(v: MissionResultIn["scenarioVars"]): Array<[number, number]> | undefined {
  if (!v) return undefined;
  if (Array.isArray(v)) return v.filter(p => Array.isArray(p) && p.length === 2).map(([a, b]) => [Number(a), Number(b)]);
  return Object.entries(v).map(([a, b]) => [Number(a), Number(b)]);
}

/** Valores que o script da missão grava quando o resultado não traz `scenarioVars` (último valor listado). */
export function defaultScenarioVars(data: CampaignData, id: number): Array<[number, number]> {
  const out = new Map<number, number>();
  for (const s of data.missions[String(id)]?.scenarioVarsSet ?? []) out.set(s.var, s.value);
  return [...out];
}

export function onMissionResult(st: CampaignState, data: CampaignData, r: MissionResultIn): MissionOutcome {
  const stageBefore = stageOf(st);
  const out: MissionOutcome = { completed: false, stageBefore, stageAfter: stageBefore, cutscenes: [], added: [], joined: [], ended: false, next: null };
  const m = r.id;
  if (r.outcome !== "complete" || isDone(st, m) || !data.missions[String(m)]) {
    // derrota/abandono: nada muda no cenário (o original recarrega); os subobjetivos da tentativa são descartados
    for (let i = 0; i < 16; i++) setVar(st, V_SUBOBJ + i, 0);
    out.next = firstLocation(st);
    return out;
  }
  // variáveis de cenário gravadas pelo script (Set Scenario Variable / Set Subobjective)
  for (const [i, v] of toPairs(r.scenarioVars) ?? defaultScenarioVars(data, m)) if (i >= 0 && i < 1024 && i !== V_STAGE) setVar(st, i, v);
  // mercenários: quem foi descansa (estado 2), os demais voltam a 1 [DLL 0x100020b0]
  for (let i = 0; i < MERC_COUNT; i++) {
    const s = getVar(st, V_MERC_STATE + i);
    if (s) setVar(st, V_MERC_STATE + i, getVar(st, V_HIRED + i) ? 2 : 1);
    setVar(st, V_HIRED + i, 0);
  }
  removeLoc(st, ["M", m]);
  setVar(st, V_DONE + m, 1);
  const log: EffectLog = { cutscenes: [], added: [], joined: [] };
  applyEffects(st, data, data.missions[String(m)].onComplete, log);
  if (getVar(st, V_OPENALL)) {                                   // depuração do original [DLL 0x10001dbc]
    for (const t of data.towns) if (t.id !== 1) addLoc(st, ["T", t.id], log.added);
    for (const k of Object.keys(data.missions)) if (!isDone(st, Number(k))) addLoc(st, ["M", Number(k)], log.added);
  }
  st.log.push(m);
  st.map = "yases";
  for (const c of log.cutscenes) { st.pending.push(c); }
  if (st.current && st.current[0] === "M" && st.current[1] === m) st.current = null;
  out.completed = true;
  out.cutscenes = log.cutscenes;
  out.added = log.added;
  out.joined = log.joined;
  out.stageAfter = stageOf(st);
  out.ended = out.stageAfter >= FINAL_STAGE;
  out.next = firstLocation(st);
  return out;
}

/** Vídeos pendentes (consumidos): nomes de arquivo em assets/video (teleport/stars/crown/knights/druids). */
export function takePendingVideos(st: CampaignState, data: CampaignData): string[] {
  const ids = st.pending.splice(0);
  for (const id of ids) if (!st.videos.includes(id)) st.videos.push(id);
  return ids.map(id => data.cutscenes.find(c => c.id === id)?.video).filter((v): v is string => !!v);
}

// ------------------------------------------------------------------ mapa-múndi
/** Nós do mapa atual (Uimoir só ao sair de Plagat): locais disponíveis + missões concluídas desse mapa (cruz). */
export function globalMapNodes(st: CampaignState, data: CampaignData): { map: "uimoir" | "yases"; nodes: MapNode[]; hero: { x: number; y: number } | null } {
  const map = st.map;
  const nodes: MapNode[] = [];
  for (const [k, id] of st.locations) {
    const pos = k === "T" ? data.towns.find(t => t.id === id)?.mapPos : data.missions[String(id)]?.mapPos;
    if (!pos || pos.map !== map) continue;
    nodes.push({ kind: k === "T" ? "town" : "mission", id, x: pos.x, y: pos.y, current: !!st.current && st.current[0] === k && st.current[1] === id });
  }
  for (const m of st.log) {
    const pos = data.missions[String(m)]?.mapPos;
    if (pos && pos.map === map) nodes.push({ kind: "mission", id: m, x: pos.x, y: pos.y, done: true });
  }
  // ícone do herói: no local atual, senão na última cidade (Plagat ao sair dela)
  let hero: { x: number; y: number } | null = null;
  const cur = st.current;
  const curPos = cur ? (cur[0] === "T" ? data.towns.find(t => t.id === cur[1])?.mapPos : data.missions[String(cur[1])]?.mapPos) : undefined;
  const townPos = data.towns.find(t => t.id === st.lastTown)?.mapPos;
  if (curPos && curPos.map === map) hero = { x: curPos.x, y: curPos.y };
  else if (townPos && townPos.map === map) hero = { x: townPos.x, y: townPos.y };
  else if (st.log.length) {
    const p = data.missions[String(st.log[st.log.length - 1])]?.mapPos;
    if (p && p.map === map) hero = { x: p.x, y: p.y };
  }
  return { map, nodes, hero };
}

// ------------------------------------------------------------------ utilidades
export function townKey(data: CampaignData, id: number): string { return data.towns.find(t => t.id === id)?.key ?? "plagat"; }
export function townIdByKey(data: CampaignData, key: string): number { return data.towns.find(t => t.key === key)?.id ?? 1; }
export function shopConfig(st: CampaignState, town: number): ShelfCfg[] | undefined { return st.shops[String(town)]; }

/** Validação/saneamento de um CampaignState vindo do save (nunca lança). Devolve undefined se não der para usar. */
export function sanitizeCampaign(v: unknown): CampaignState | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Partial<CampaignState> & Record<string, unknown>;
  if (!o.vars || typeof o.vars !== "object" || !Array.isArray(o.locations)) return undefined;
  const vars: Record<string, number> = {};
  for (const [k, x] of Object.entries(o.vars)) if (typeof x === "number" && Number.isFinite(x) && x !== 0 && Number(k) >= 0 && Number(k) < 1024) vars[k] = x | 0;
  const isLoc = (l: unknown): l is Loc => Array.isArray(l) && (l[0] === "T" || l[0] === "M") && typeof l[1] === "number";
  const nums = (a: unknown) => (Array.isArray(a) ? a.filter((x): x is number => typeof x === "number" && Number.isFinite(x)) : []);
  return {
    v: 1, vars, locations: o.locations.filter(isLoc).map(l => [l[0], l[1]] as Loc), current: isLoc(o.current) ? [o.current[0], o.current[1]] : null,
    lastTown: typeof o.lastTown === "number" ? o.lastTown : 1, map: o.map === "uimoir" ? "uimoir" : "yases",
    shops: o.shops && typeof o.shops === "object" ? o.shops as CampaignState["shops"] : {},
    stock: o.stock && typeof o.stock === "object" ? o.stock as CampaignState["stock"] : {},
    seed: typeof o.seed === "number" ? o.seed >>> 0 : 1, videos: nums(o.videos), pending: nums(o.pending), party: nums(o.party), log: nums(o.log),
    queue: Array.isArray(o.queue) ? o.queue.filter((q): q is CampaignState["queue"][number] => !!q && typeof (q as { id?: unknown }).id === "number") : [],
    ...(o.ended ? { ended: true } : {}),
    ...(o.hall && typeof o.hall === "object" && Number.isFinite((o.hall as { seconds?: number }).seconds) && Number.isFinite((o.hall as { kills?: number }).kills)
      ? { hall: { seconds: Math.max(0, Math.floor((o.hall as { seconds: number }).seconds)), kills: Math.max(0, Math.floor((o.hall as { kills: number }).kills)) } } : {}),
  };
}
