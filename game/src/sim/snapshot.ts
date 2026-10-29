/**
 * Save no meio da missão: snapshot()/restore() do `World` (+ script + host + estado mínimo da cena), serializável em JSON.
 *
 * Modelo: o snapshot guarda só o estado MUTÁVEL. Para restaurar, monta-se a missão de novo exatamente como na entrada
 * (`buildMission(data, hero, callbacks)`, mesmo herói/dificuldade) e aplica-se o snapshot por cima: as unidades são criadas pelo
 * build na mesma ordem (ids iguais), e o restore sobrescreve posição, vida/mana, ordens, IA, caminho, efeitos, experiência,
 * ouro/itens, além de projéteis, sacos de loot, diplomacia, dinheiro, tique, próximo id, RNG, ocupação da grade, abates por tipo,
 * variáveis de cenário do host e o estado do ScriptRuntime (`snapshot()/restore()` da frente SCRIPT).
 * Campos estáticos (stats, timing, spells, nome, kind) vêm do build; `castSpell` e as magias dos projéteis são gravados por id.
 *
 * Versões do formato: 1 = original; 2 = + estado do host (vida das estruturas/alavancas, inconscientes, ids de script e grupos pós-Polymorph),
 * magias temporárias (pergaminho) e magia em lançamento fora da lista, estado extra da cena em `ui` (fila de falas, retirada, "andar e usar").
 * `migrateMissionSnapshot` aceita v1..v2 (campos ausentes = o que o build já montou) e rejeita versões futuras.
 *
 * Campos novos acrescentados à `Unit` são incluídos automaticamente (cópia genérica dos campos próprios, exceto UNIT_STATIC);
 * se um campo novo for estático/derivado do build, acrescente-o a UNIT_STATIC. Teste de determinismo: src/sim/test/snapshot.ts.
 */
import type { ScriptRuntimeState } from "../script";
import type { HostState } from "../mission/host";
import { Unit, type Loot, type PlayerAi, type Projectile, type SpellArea, type SpellDef, type Trap, type UnitInit, type World } from "./world";
import { mapRecFromJson, mapRecToJson, scalarFields, structsFromJson, unitRecFromJson, unitRecToJson, type ExeGroupsJson, type MapRecJson, type SpellObjsJson, type UnitRecJson } from "./exe/recio";

export const SNAPSHOT_VERSION = 2;
/** Menor versão que ainda sabemos ler. */
export const MIN_SNAPSHOT_VERSION = 1;

/** Campos da Unit que vêm do build (não são gravados). */
const UNIT_STATIC = new Set(["id", "kind", "typeId", "stats", "timing", "name", "scriptId", "npc", "isHero", "spells", "weaponSpell", "castSpell", "procSpells", "rec"]);
/** Campos de saves antigos que não existem mais na Unit: o andar virou o registro do exe (etapa 6); posição/direção voltam pelos
 *  setters (`x`, `y`, `dir`, `angle`), a célula sai da posição (`cx`/`cy` ignorados). */
const UNIT_GONE = new Set(["cx", "cy", "path", "pathGoal", "sPath", "sGoal", "sFinal", "sCount", "sTrack", "sLen", "sTcell", "segV", "repathIn", "turnLeft", "turnDir"]);

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** Codifica valores que o JSON não representa (Infinity/NaN, Map, Set, arrays tipados). */
function enc(v: unknown): Json {
  if (typeof v === "number") return Number.isFinite(v) ? v : { $n: String(v) };
  if (v === null || typeof v === "boolean" || typeof v === "string") return v;
  if (v === undefined) return null;
  if (Array.isArray(v)) return v.map(enc);
  if (v instanceof Map) return { $map: [...v].map(([k, x]) => [enc(k), enc(x)]) };
  if (v instanceof Set) return { $set: [...v].map(enc) };
  if (ArrayBuffer.isView(v)) return { $ta: (v as unknown as { constructor: { name: string } }).constructor.name, d: Array.from(v as unknown as ArrayLike<number>) };
  if (typeof v === "object") {
    const o: Record<string, Json> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (typeof x !== "function" && x !== undefined) o[k] = enc(x);
    return o;
  }
  return null;
}

function dec(v: Json): unknown {
  if (Array.isArray(v)) return v.map(dec);
  if (v && typeof v === "object") {
    if ("$u" in v && Object.keys(v).length === 1) return undefined;
    if ("$n" in v && Object.keys(v).length === 1) return Number(v.$n);
    if ("$map" in v && Object.keys(v).length === 1) return new Map((v.$map as Json[][]).map(([k, x]) => [dec(k!), dec(x!)]));
    if ("$set" in v && Object.keys(v).length === 1) return new Set((v.$set as Json[]).map(dec));
    if ("$ta" in v && "d" in v) {
      const C = (globalThis as Record<string, unknown>)[String(v.$ta)] as { from(a: number[]): unknown } | undefined;
      return C ? C.from(v.d as number[]) : (v.d as number[]).slice();
    }
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) o[k] = dec(x);
    return o;
  }
  return v;
}

export interface UnitSnapshot {
  id: number;
  kind: string;
  /** unidade criada durante a missão (invocação): dados para recriá-la */
  dyn?: { typeId: number; init: Record<string, Json> };
  /** id da magia em lançamento (u.castSpell) */
  cast: string | null;
  /** magia em lançamento que não está mais em nenhuma lista da unidade (pergaminho já descartado): definição completa (v2) */
  castDef?: SpellDef;
  /** magias temporárias `scroll:*` da lista da unidade (v2) */
  tmp?: SpellDef[];
  /** demais campos mutáveis (codificados por `enc`) */
  f: Record<string, Json>;
  /** registro do exe (posição fina, andar, IA, caminhos) — ausente em saves antigos */
  rec?: UnitRecJson;
}

const hex = (b: Uint8Array): string => Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
const unhex = (h: string): Uint8Array => { const b = new Uint8Array(h.length >> 1); for (let i = 0; i < b.length; i++) b[i] = parseInt(h.substr(i * 2, 2), 16); return b; };

export interface ProjectileSnapshot extends Omit<Projectile, "spell"> { spell: string | null; spellDef?: SpellDef | null; }

export interface WorldSnapshot {
  tick: number;
  nextId: number;
  rng: number;
  dip: number[][];
  money: number[];
  units: UnitSnapshot[];
  projectiles: ProjectileSnapshot[];
  loot: Loot[];
  killsByType: [number, number][];
  /** ocupação da grade: pares [índice da célula, id da unidade] (só células ocupadas) */
  occ: [number, number][];
  /** estado do MapRec do exe (memória que difere do mapa sem unidades, ocupação) — ausente em saves antigos: refeito das unidades */
  exe?: MapRecJson;
  /** mundo do exe: rascunho do evento (+0xbd98, hex), a lista de eventos para a IA (+0xbbec, hex por evento) e as listas de
   *  candidatos do fim de caminho (+0xa68/+0xa88, endereços) — opcional */
  exeWorld?: { evt: string; events: string[]; cand?: number[]; dead?: number[]; friends?: number[]; foes?: number[]; dip?: string; f?: Record<string, number> };
  /** jogadores e grupos do exe (unidade+0x14/+0x70, comando aplicado) — ausente em saves antigos: refeitos das unidades */
  exeGroups?: ExeGroupsJson;
  /** objetos de magia do exe no mundo (projéteis/efeitos presos ao alvo em voo; Spell_Apply 0x519db8) — ausente em saves antigos: nenhum */
  spellObjs?: SpellObjsJson;
  /** áreas de magia no chão (MOTOR-C) — opcional para saves antigos */
  areas?: SpellArea[];
  /** armadilhas do script (Set trap) — opcional */
  traps?: Trap[];
  /** ajustes de IA por jogador (Formation/Retreat/AutoCasting) */
  playerAi?: PlayerAi[];
  /** guarda dos grupos de IA (raio-base, raio atual, em combate) [World.groupState] */
  groupState?: [number, { base: number; radius: number; combat: boolean; cmd12?: boolean }][];
}

/** `World.nextId` é privado; o snapshot precisa dele (próximo id de projétil/saco). */
type WorldPriv = { nextId: number };

function findSpell(u: Unit | undefined, id: string | null): SpellDef | null {
  if (!u || !id) return null;
  return u.spells.find(s => s.id === id) ?? (u.weaponSpell?.id === id ? u.weaponSpell : null) ?? u.procSpells?.find(p => p.spell.id === id)?.spell ?? null;
}

export function snapshotWorld(world: World): WorldSnapshot {
  const w = world as unknown as WorldPriv;
  const occ: [number, number][] = [];
  const g = world.grid.occ;
  for (let i = 0; i < g.length; i++) if (g[i]) occ.push([i, g[i]!]);
  return {
    tick: world.tick,
    nextId: w.nextId,
    rng: world.rng.state,
    dip: world.dip.map(r => [...r]),
    money: [...world.money],
    units: world.units.map(u => {
      const f: Record<string, Json> = {};
      // campo declarado e não preenchido (`heroInfo?:`) é próprio com valor undefined: marca para voltar undefined (e não null)
      for (const [k, v] of Object.entries(u)) if (!UNIT_STATIC.has(k) && typeof v !== "function") f[k] = v === undefined ? { $u: 1 } : enc(v);
      const tmp = u.spells.filter(sp => sp.id.startsWith("scroll:")).map(sp => JSON.parse(JSON.stringify(sp)) as SpellDef);
      const castDef = u.castSpell && !findSpell(u, u.castSpell.id) ? JSON.parse(JSON.stringify(u.castSpell)) as SpellDef : undefined;
      const dyn = u.dynamic ? { typeId: u.typeId, init: enc({ stats: u.stats, timing: u.timing, name: u.name }) as Record<string, Json> } : undefined;
      for (const k of ["x", "y", "dir", "angle"] as const) f[k] = enc(u[k]);
      return { id: u.id, kind: u.kind, cast: u.castSpell?.id ?? null, f, rec: unitRecToJson(u.rec), ...(dyn ? { dyn } : {}), ...(tmp.length ? { tmp } : {}), ...(castDef ? { castDef } : {}) };
    }),
    projectiles: world.projectiles.filter(p => !p.done).map(p => {
      const src = world.get(p.from);
      const known = !!p.spell && findSpell(src, p.spell.id) === p.spell;
      return { ...p, spell: p.spell?.id ?? null, ...(p.spell && !known ? { spellDef: { ...p.spell } } : {}) };
    }),
    loot: world.loot.map(l => ({ ...l, items: [...l.items] })),
    killsByType: [...world.killsByType],
    occ,
    exe: mapRecToJson(world.exe, world.exeBase),
    exeWorld: { evt: hex(world.exeWorld.evt), events: world.exeWorld.events.values().map(hex), cand: world.exeWorld.cand.values(), dead: world.exeWorld.dead.values(), friends: world.exeWorld.friends.values(), foes: world.exeWorld.foes.values(), dip: hex(world.exeWorld.dipTable), f: scalarFields(world.exeWorld) },
    exeGroups: world.exeGroupsToJson(),
    spellObjs: world.exeSpellObjsToJson(),
    areas: world.areas.map(a => JSON.parse(JSON.stringify(a)) as SpellArea),
    traps: world.traps.map(t => JSON.parse(JSON.stringify(t)) as Trap),
    playerAi: world.playerAi.map(p => ({ ...p })),
    groupState: [...world.groupState].map(([g, v]) => [g, { ...v }] as [number, { base: number; radius: number; combat: boolean; cmd12?: boolean }]),
  };
}

export class SnapshotMismatchError extends Error {}

/** Aplica um snapshot sobre um World montado pelo mesmo build (mesmas unidades, mesma ordem). Lança SnapshotMismatchError se não casar. */
export function restoreWorld(world: World, s: WorldSnapshot): void {
  // unidades criadas durante a missão (invocações) são recriadas antes da conferência
  for (const su of s.units) {
    if (!su.dyn || world.get(su.id)) continue;
    const init = dec(su.dyn.init) as Pick<UnitInit, "stats" | "timing" | "name">;
    const u = new Unit(su.id, { kind: su.kind, typeId: su.dyn.typeId, player: 0, x: 0, y: 0, stats: init.stats, timing: init.timing, name: init.name });
    world.units.push(u);
    world.byId.set(u.id, u);
  }
  if (s.units.length !== world.units.length) throw new SnapshotMismatchError(`snapshot com ${s.units.length} unidades, mundo com ${world.units.length}`);
  for (const su of s.units) {
    const u = world.get(su.id);
    if (!u || u.kind !== su.kind) throw new SnapshotMismatchError(`unidade ${su.id} (${su.kind}) não encontrada no mundo montado`);
  }
  const w = world as unknown as WorldPriv;
  world.tick = s.tick;
  w.nextId = s.nextId;
  world.rng.state = s.rng;
  s.dip.forEach((row, a) => row.forEach((v, b) => { if (world.dip[a] && b < world.dip[a]!.length) world.dip[a]![b] = v; }));
  s.money.forEach((v, i) => { world.money[i] = v; });
  for (const su of s.units) {
    const u = world.get(su.id)! as unknown as Record<string, unknown>;
    // null salvo onde o build deixou undefined = save antigo que gravava campos vazios como null (heroInfo): mantém undefined
    for (const [k, v] of Object.entries(su.f)) { if (UNIT_GONE.has(k) || (v === null && u[k] === undefined)) continue; u[k] = dec(v); }
    const uu = u as unknown as Unit;
    if (su.rec) unitRecFromJson(uu.rec, su.rec);
    // magias temporárias (pergaminho): voltam à lista antes de resolver a magia em lançamento
    uu.spells = uu.spells.filter(sp => !sp.id.startsWith("scroll:"));
    for (const t of su.tmp ?? []) uu.spells.push(JSON.parse(JSON.stringify(t)) as SpellDef);
    uu.castSpell = findSpell(uu, su.cast) ?? (su.castDef ? JSON.parse(JSON.stringify(su.castDef)) as SpellDef : null);
  }
  world.projectiles.length = 0;
  for (const p of s.projectiles) {
    const { spellDef, ...rest } = p;
    const spell = findSpell(world.get(p.from), p.spell) ?? (spellDef ? { ...spellDef } : null);
    world.projectiles.push({ ...rest, spell });
  }
  world.loot.length = 0;
  for (const l of s.loot) world.loot.push({ ...l, items: [...l.items] });
  world.killsByType.clear();
  for (const [k, v] of s.killsByType) world.killsByType.set(k, v);
  world.grid.occ.fill(0);
  for (const [i, id] of s.occ) if (i >= 0 && i < world.grid.occ.length) world.grid.occ[i] = id;
  for (const a of world.areas) if (a.kind === "wall") world.applyWall(a, false);
  world.areas.length = 0;
  for (const a of s.areas ?? []) { const c = JSON.parse(JSON.stringify(a)) as SpellArea; world.areas.push(c); if (c.kind === "wall") world.applyWall(c, true); }
  world.traps.length = 0;
  for (const t of s.traps ?? []) world.traps.push(JSON.parse(JSON.stringify(t)) as Trap);
  // ocupação do exe: a gravada (exata) ou, em save antigo, refeita das unidades
  if (s.exe) {
    mapRecFromJson(world.exe, world.exeBase, s.exe);
    world.exeRestoreStructs();
    structsFromJson(world.exe, s.exe);
    world.exe.units.clear();
    for (const u of world.units) world.exe.units.set(u.rec.addr, u.rec);
  }
  else world.exeResync();
  world.exeWorld.evt.fill(0);
  world.exeWorld.events.removeAll();
  world.exeWorld.cand.removeAll();
  world.exeWorld.dead.removeAll();
  world.exeWorld.friends.removeAll();
  world.exeWorld.foes.removeAll();
  if (s.exeWorld) {
    world.exeWorld.evt.set(unhex(s.exeWorld.evt));
    for (const e of s.exeWorld.events) world.exeWorld.events.addTail(unhex(e));
    for (const a of s.exeWorld.cand ?? []) world.exeWorld.cand.addTail(a);
    for (const a of s.exeWorld.dead ?? []) world.exeWorld.dead.addTail(a);
    for (const a of s.exeWorld.friends ?? []) world.exeWorld.friends.addTail(a);   // +0xaa8/+0xac8 (0x567c56)
    for (const a of s.exeWorld.foes ?? []) world.exeWorld.foes.addTail(a);
    if (s.exeWorld.f) Object.assign(world.exeWorld, s.exeWorld.f);   // campos escalares do mundo (+0xa4c pensamentos, +0xbbe8...)
  }
  if (s.exeGroups) world.exeGroupsFromJson(s.exeGroups);
  world.exeSpellObjsFromJson(s.spellObjs);
  world.exeRebuildLists();
  if (s.playerAi) s.playerAi.forEach((p, i) => { if (world.playerAi[i]) Object.assign(world.playerAi[i]!, p); });
  world.groupState.clear();
  for (const [g, v] of s.groupState ?? []) world.groupState.set(g, { ...v });
  world.syncRecs();   // campos derivados dos registros do exe (atributos de combate, modelo, dono), como depois de um passo
  // a tabela de diplomacia do exe por último: 0x57977a escreve nela fora de `dip` (diagonal, jogadores fora da matriz)
  if (s.exeWorld?.dip) world.exeWorld.dipTable.set(unhex(s.exeWorld.dip));
  world.events.length = 0;
}

// ------------------------------------------------------------------ missão inteira

/** Estado mínimo da cena de missão (HUD/câmera) que volta junto com o save. Campos extras são permitidos. */
export interface MissionUiState {
  /** subobjetivos mostrados (n -> 1 ativo / 2 cumprido) */
  objectives: [number, number][];
  /** mensagens do script já mostradas (eventN), em ordem */
  messages: number[];
  /** o herói recebeu os documentos (missão 10) */
  documents?: boolean;
  /** tempo de jogo da missão (ms) */
  elapsedMs: number;
  /** câmera (pixels do mundo, canto superior esquerdo) e zoom */
  cam: { x: number; y: number };
  zoom: number;
  gameSpeed?: number;
  /** unidade selecionada */
  selected?: number;
  [extra: string]: unknown;
}

export interface MissionSnapshot {
  v: number;
  /** id da missão (scenario/<id>.alm) */
  id: number;
  world: WorldSnapshot;
  script: ScriptRuntimeState | null;
  host: HostState;
  ui: MissionUiState;
}

/** Partes de uma missão montada (BuiltMission de mission/setup.ts tem esse formato). */
export interface MissionParts {
  world: World;
  host: { scenarioVars: Map<number, number>; snapshot?(): HostState; restore?(s: Partial<HostState>): void };
  runtime?: { snapshot(): ScriptRuntimeState; restore(s: ScriptRuntimeState): void };
}

export function snapshotMission(id: number, b: MissionParts, ui: MissionUiState): MissionSnapshot {
  return JSON.parse(JSON.stringify({
    v: SNAPSHOT_VERSION, id,
    world: snapshotWorld(b.world),
    script: b.runtime ? b.runtime.snapshot() : null,
    host: b.host.snapshot ? b.host.snapshot() : { scenarioVars: [...b.host.scenarioVars] },
    ui,
  })) as MissionSnapshot;
}

/**
 * Converte um snapshot de qualquer versão conhecida (1..SNAPSHOT_VERSION) para a atual, sem lançar para campos ausentes
 * (saves v1 não têm o estado do host, as magias temporárias nem os extras da cena). Versão futura/lixo: SnapshotMismatchError.
 */
export function migrateMissionSnapshot(s: MissionSnapshot): MissionSnapshot {
  const v = (s as { v?: unknown } | null | undefined)?.v;
  if (typeof v !== "number" || v < MIN_SNAPSHOT_VERSION || v > SNAPSHOT_VERSION || !s.world || !Array.isArray(s.world.units)) throw new SnapshotMismatchError(`versão de snapshot desconhecida: ${String(v)}`);
  const w = s.world;
  w.projectiles ??= []; w.loot ??= []; w.killsByType ??= []; w.occ ??= []; w.dip ??= []; w.money ??= [];
  return { ...s, v: SNAPSHOT_VERSION, host: (s.host ?? { scenarioVars: [] }) as HostState, ui: s.ui ?? { objectives: [], messages: [], elapsedMs: 0, cam: { x: 0, y: 0 }, zoom: 1 } };
}

/** Restaura sobre uma missão recém-montada (mesmo herói/dados). Devolve o estado da cena para a MissionScene aplicar. */
export function restoreMission(b: MissionParts, snap: MissionSnapshot): MissionUiState {
  const s = migrateMissionSnapshot(snap);
  restoreWorld(b.world, s.world);
  if (s.script && b.runtime) b.runtime.restore(s.script);
  if (b.host.restore) b.host.restore(s.host);
  else { b.host.scenarioVars.clear(); for (const [k, v] of s.host.scenarioVars ?? []) b.host.scenarioVars.set(k, v); }
  return s.ui;
}
