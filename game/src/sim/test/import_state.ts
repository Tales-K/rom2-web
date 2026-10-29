/**
 * Importa um ESTADO do original (tools/refcap/diff/export_state.py → refs/trace/diff/state_*.json) no nosso World — fase 2 do teste
 * diferencial (notes/differential-fuzz.md). Monta a missão como a cena (loader.startRun, mesmo mapa e unit-templates), com o herói do
 * save (atributos Body/Reaction/Mind/Spirit, classe, magias do livro) em vez de defaultHero(), casa as unidades do original com as
 * nossas por (tipo, jogador, posição) e copia o estado (posição fina, vida, mana, velocidade, visão, toHit, dano, defesa, absorção,
 * alcance, giro, Wimpy/Withdraw, ordem em curso, direção). Mede a FIDELIDADE antes da cópia: quantos campos o nosso motor já monta igual.
 *
 *   npx tsx src/sim/test/import_state.ts --state ../refs/trace/diff/state_m10_start.json [--json]
 */
import type { HeroState } from "../../core/state";
import { defaultHero, spawnFromTemplate, spellDef } from "../../mission/setup";
import { snapshotMission, restoreMission, type MissionSnapshot } from "../snapshot";
import { thinkPhaseFor, type Unit, type World } from "../world";
import { TICKS_PER_SEC } from "../types";
import { CellStructRec, MapObjRec, MapRec, SpellObjRec, SpellPayloadRec, UnitRec, VT_DIRECT_DAMAGE, VT_POINT_EFFECT, VT_TRANSPORT, type WorldRec } from "../exe/types";
import { CMapShortOcc } from "../exe/mfc";
import { applyMemRuns, applyOccBuckets, listSet, recFromBytes } from "../exe/recio";
import { unitWalkFormula } from "../exe/walk_action";
import { loadData, proc, startRun, type Run } from "./loader";

export interface OrigUnit {
  id: number; kind: string; type: number; player: number; x: number; y: number; sx: number; sy: number; fx: number; fy: number;
  task: number; state: number; body: number; reaction: number; mind: number; spirit: number; speed: number; speed_eff?: number;
  hp: number; hpmax: number; mana: number; manamax: number; hpregen?: number; manaregen?: number; scan: number; toHit: number; skills: number[];
  dmin: number; damp: number; defense: number; absorb: number; prot: number[]; range: number; dir: number; turn: number;
  guard_radius: number; dest: number; angle?: number; target: number; mode: number; withdraw: number; wimpy: number; chosen_spell: number;
  book: { id: number; mana: number }[]; summoner: number; effects: number; post?: number;
  /** deduzido do traço (golden_worker inferUnreach): `+0x1c4+0x16` da guarda da carga do mapa */
  unreach_sec?: number;
  /** deduzido do traço: tiques até o giro do olhar em volta acabar (modo 0xb, ação 1) */
  /** export da fase 5: rumo desejado (+0x1c0[1]), +0x1c4+0x54, +0x16, +0x98 (relógio 16/s absoluto), +0x9c */
  want?: number; look_hit?: number; unreach_sec_raw?: number; hit_clock16?: number; flee_cell?: number;
  /** export da fase 6: máquina de ação 0x50f12c (fase +0x58: 5 carga, 7 espera; contador +0x6c), charge/relax (+0x134/+0x135),
   *  dano elemental extra (+0xb7..+0xbb: base A, faixa A, base B, faixa B, elemento) */
  act_phase?: number; act_cnt?: number; act_ready?: number; charge?: number; relax?: number; eldmg?: number[];
  walk?: { static: number[]; dynamic: number[]; goal: number; final: number; c9: number; c78: number; track: number; slen: number; tcell: number };
  /** export da etapa 6 (refs/oracle/ticks, tools/re/oracle/dump_ticks.py): o registro do exe (endereço, campos da unidade e do tipo,
   *  bytes crus do andar +0x1c0 e da IA +0x1c4) — o importador monta dele o UnitRec exato */
  exe?: OrigUnitRec;
  sub9?: number; pmask?: number; cell?: number;
}
export interface OrigUnitRec {
  a: number; vt: number; f43: number; size: number; kind: number; u50: number; act: number; speed: number; hp: number; mana: number;
  f12c: number; f20: number; f44: number; f45: number; p2c: number; mv: string; ai: string;
  /** etapa 9 (regeneração 0x50fc5a): períodos +0x98/+0x9e, mana máx. +0x9c, restos +0xa2/+0xa3, bônus +0xde/+0xe2, relógio de ocupação +0x138 */
  f98?: number; f9c?: number; f9e?: number; fa2?: number; fa3?: number; fde?: number; fe2?: number; f138?: number;
  /** etapa 8b: magia em curso +0x64 e o livro +0x140 como [id, endereço] (os ponteiros de magia do registro são do original) */
  f5c?: number; f64?: number; book?: [number, number][];
  /** etapa 8b, lote 4: os efeitos com duração da lista +0x20 (bytes da carga "Effect" e do objeto de mapa), na ordem da lista */
  fx?: { a: number; b: string; mo: string }[];
}
/** Deltas do MapRec por tique (dump_ticks.py): memória (trechos [deslocamento, hex] desde o tique anterior; o 1º é o objeto inteiro),
 *  baldes do CMap de ocupação que mudaram, estruturas novas (endereço → [x, y, largura, máscara]) e o mundo. */
export interface OrigExeMap {
  mem: [number, string][];
  occ?: { n?: number; count?: number; null?: boolean; full?: number; b: Record<string, [number, string][]> };
  structs?: Record<string, [number, number, number, number]>;
  /** etapa 9: as listas do contentor [0x68d2dc] que World_SecondTick percorre (ids na ordem da lista); lote 2: jogadores com os grupos
   *  (dados +0x3c em hex, membros por id) e a tabela de classes do mundo (+0xa54, 16 bytes em hex) */
  world?: { bbe8: number; lists?: { all: number[]; magic: number[]; corpses: number[] };
    players?: { a: number; id: number; f2c: number; f32: number; f38: number; groups: { a: number; data: string; units: number[] }[] }[]; class_table?: string;
    /** etapa 8b, lote 3: os objetos de magia no mundo ([[0x6044c4]+0x7c]+4) na ordem da lista */
    spell_objs?: OrigSpellObj[] };
}
/** Objeto de magia do despejo: bytes crus (hex) do objeto, do objeto de mapa +0x10 e da carga +0x4c (preso) / do filho +0x48 (projétil). */
export interface OrigSpellObj { a: number; b: string; mo: string; p?: { a: number; b: string; mo: string }; c?: OrigSpellObj }

const hexBytes = (h: string): DataView => {
  const b = new Uint8Array(h.length >> 1);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(h.substr(2 * i, 2), 16);
  return new DataView(b.buffer);
};
function mapObjFromHex(o: MapObjRec, h: string): void {
  if (!h) return;
  const v = hexBytes(h);
  o.x = v.getUint8(0); o.y = v.getUint8(1); o.cell = v.getUint16(2, true); o.fx = v.getUint8(4); o.fy = v.getUint8(5); o.owner = v.getUint32(8, true);
}
/** Os objetos de magia do despejo nos registros espelhados (`SpellObjRec` pelo offset; a carga `SpellPayloadRec` com o dano +0x48). */
export function spellObjsFromOrig(w: WorldRec, list: OrigSpellObj[]): void {
  const obj = (x: OrigSpellObj): SpellObjRec => {
    const v = hexBytes(x.b), o = new SpellObjRec();
    o.addr = x.a >>> 0; o.vtbl = v.getUint32(0, true); o.f04 = v.getUint32(4, true); o.fc = v.getUint16(0xc, true); o.fe = v.getUint16(0xe, true);
    o.f14 = v.getUint32(0x14, true); o.f18 = v.getUint16(0x18, true); o.f1c = v.getUint32(0x1c, true); o.f3c = v.getUint32(0x3c, true);
    o.f40 = v.getUint8(0x40); o.f41 = v.getUint8(0x41); o.f42 = v.getUint16(0x42, true); o.f44 = v.getUint16(0x44, true); o.f46 = v.getUint16(0x46, true);
    o.f48 = v.getUint32(0x48, true); o.f4c = v.getUint32(0x4c, true); o.f50 = o.vtbl === VT_TRANSPORT ? v.getInt16(0x50, true) : 0;
    mapObjFromHex(o.mapObj, x.mo);
    w.spellObjs.set(o.addr, o);
    if (x.p && o.vtbl === VT_POINT_EFFECT) w.payloads.set(x.p.a >>> 0, payloadFromOrig(x.p));
    if (x.c) obj(x.c);
    return o;
  };
  for (const x of list) w.lists.spellObjs.addTail(obj(x).addr);
}
/** Carga de magia do despejo (`SpellPayloadRec` pelo offset; o dano +0x48 em Effect_DirectDamage). */
export function payloadFromOrig(x: { a: number; b: string; mo: string }): SpellPayloadRec {
  const pv = hexBytes(x.b), p = new SpellPayloadRec();
  p.addr = x.a >>> 0; p.vtbl = pv.getUint32(0, true); p.f04 = pv.getUint32(4, true); p.fc = pv.getUint16(0xc, true); p.fe = pv.getUint16(0xe, true);
  p.f14 = pv.getUint32(0x14, true); p.f18 = pv.getUint16(0x18, true); p.f1c = pv.getUint32(0x1c, true); p.f3c = pv.getUint8(0x3c); p.f3d = pv.getUint8(0x3d);
  p.f40 = pv.getInt16(0x40, true); p.f42 = pv.getInt16(0x42, true); p.f44 = pv.getUint32(0x44, true);
  if (p.vtbl === VT_DIRECT_DAMAGE) {
    const d = p.dmg, o2 = 0x48;
    d.atk = pv.getInt16(o2, true); for (let i = 0; i < 6; i++) d.sk[i] = pv.getInt16(o2 + 2 + 2 * i, true);
    d.dmin = pv.getUint8(o2 + 0xe); d.dadd = pv.getUint8(o2 + 0xf); d.wtype = pv.getUint8(o2 + 0x10); d.elA0 = pv.getUint8(o2 + 0x11);
    d.elA1 = pv.getUint8(o2 + 0x12); d.elB0 = pv.getUint8(o2 + 0x13); d.elB1 = pv.getUint8(o2 + 0x14); d.elK = pv.getUint8(o2 + 0x15);
  }
  mapObjFromHex(p.mapObj, x.mo);
  return p;
}
/** etapa 8b, lote 4: as listas +0x20 (efeitos com duração) das unidades do despejo, com os endereços do original. */
export function unitFxFromOrig(w: World, st: OrigState): void {
  const byAddr = new Map<number, Unit>(); for (const u of w.units) byAddr.set(u.rec.addr >>> 0, u);
  for (const o of st.units) {
    const u = o.exe?.fx ? byAddr.get(o.exe.a >>> 0) : undefined;
    if (!u) continue;
    u.rec.fx.removeAll();
    for (const x of o.exe!.fx!) { w.exeWorld.payloads.set(x.a >>> 0, payloadFromOrig(x)); u.rec.fx.addTail(x.a >>> 0); }
  }
}
/** Ids de magia (+0xc) e soma da absorção (tipo 0x10, +0x40) dos efeitos da lista +0x20 do despejo da unidade. */
function origFx(o: OrigUnit): { ids: Set<number>; absorb: number } {
  const ids = new Set<number>();
  let absorb = 0;
  for (const x of o.exe?.fx ?? []) {
    const v = hexBytes(x.b);
    if (v.getUint8(0x3d) & 0x80) continue;
    ids.add(v.getUint16(0xc, true));
    if (v.getUint8(0x3c) === 0x10) absorb += v.getInt16(0x40, true);
  }
  return { ids, absorb };
}
/** grupo de IA do original (export_state.read_groups): raio atual `+0x2d`, base `+0x38`, em combate `+0x30`, alvo de cada unidade */
export interface OrigGroup { player: number; cmd: number; center: number; radius: number; base?: number; combat: number; units: { id: number; assigned: number }[] }
export interface OrigState {
  mission: number; t16: number; tick: number; rng: number; hero: number | null; units: OrigUnit[]; state?: string; seed?: number;
  diplomacy?: number[][] | null; step?: number; groups?: OrigGroup[];
  exe?: OrigExeMap;
  /** só no estado base (tique 0): passo por célula F[y][x] = MapRec+0 do original (export_state.read_state) */
  terrain_speed?: number[][];
}

/** MapRec do original no tique T, reconstruído aplicando os deltas do estado por tique em ordem (refs/oracle/ticks). */
export class ExeReplay {
  private mem = new Uint8Array(MapRec.SIZE);
  private occ: { n: number; count: number; null: boolean; b: Record<string, [number, string][]> } = { n: 100, count: 0, null: true, b: {} };
  private structs = new Map<number, [number, number, number, number]>();
  private bbe8 = 0;
  private t = -1;
  constructor(private readonly ticks: readonly OrigState[]) {}
  private advance(T: number): void {
    if (T < this.t) { this.t = -1; this.mem.fill(0); this.occ = { n: 100, count: 0, null: true, b: {} }; this.structs.clear(); }
    for (let k = this.t + 1; k <= T; k++) {
      const ex = this.ticks[k]?.exe;
      if (!ex) throw new Error(`estado ${k} sem o campo exe (regrave refs/oracle/ticks com tools/re/oracle/dump_ticks.py)`);
      for (const [off, hex] of ex.mem) for (let i = 0; i < hex.length >> 1; i++) this.mem[off + i] = parseInt(hex.substr(i * 2, 2), 16);
      if (ex.occ) {
        if (ex.occ.full) this.occ = { n: ex.occ.n ?? 100, count: ex.occ.count ?? 0, null: !!ex.occ.null, b: {} };
        if (ex.occ.count !== undefined) this.occ.count = ex.occ.count;
        for (const [h, c] of Object.entries(ex.occ.b)) { if (c.length) this.occ.b[h] = c; else delete this.occ.b[h]; }
      }
      for (const [a, v] of Object.entries(ex.structs ?? {})) this.structs.set(Number(a), v);
      if (ex.world) this.bbe8 = ex.world.bbe8;
    }
    this.t = T;
  }
  /** Copia o MapRec do tique T para `m` (memória, ocupação, estruturas) e o campo do mundo. */
  applyTo(m: MapRec, T: number): void {
    this.advance(T);
    m.mem.set(this.mem);
    m.occ = new CMapShortOcc();
    applyOccBuckets(m.occ, { ...this.occ, full: 1 });
    m.structs.clear();
    for (const [a, [x, y, wd, mask]] of this.structs) {
      const r = new CellStructRec();
      r.mapObj.x = x; r.mapObj.y = y; r.mapObj.cell = (y << 8) | x; r.width = wd; r.cellMask = mask >>> 0;
      m.structs.set(a, r);
    }
    m.world!.fbbe8 = this.bbe8;
  }
}

/** UnitRec exato a partir do despejo do oráculo (campos da unidade, do tipo, do dono e os bytes do andar e da IA). */
export function unitRecFromOrig(r: UnitRec, o: OrigUnit, addrOf?: Map<number, number>): void {
  const e = o.exe!;
  // alvo do golpe/da magia em curso (+0x5c, não está no despejo): o alvo da tarefa (IA+0xc → +0x5c em 0x56e8c3), pelo endereço do original
  if ((o.state === 3 || o.state === 0xd) && o.target > 0) r.f5c = addrOf?.get(o.target) ?? 0;
  // etapa 8b: o despejo traz +0x5c (endereços de unidade são os do original) — a magia em si fica com o alvo antes da ação 0xd nascer
  if (e.f5c !== undefined) r.f5c = e.f5c >>> 0;
  r.addr = e.a >>> 0; r.vtbl = e.vt; r.f43 = e.f43; r.size = e.size; r.kind = e.kind; r.task = e.u50; r.act = e.act;
  r.speed = e.speed; r.f94 = e.hp; r.f96 = o.hpmax; r.mana = e.mana; r.attackRange = e.f12c;
  // regeneração 0x50fc5a: períodos, mana máx., restos, bônus e o relógio de ocupação (despejos anteriores à etapa 9: do estado, restos 0)
  r.f98 = e.f98 ?? o.hpregen ?? 0; r.f9c = e.f9c ?? o.manamax; r.f9e = e.f9e ?? o.manaregen ?? 0;
  r.fa2 = e.fa2 ?? 0; r.fa3 = e.fa3 ?? 0; r.fde = e.fde ?? 0; r.fe2 = e.fe2 ?? 0; r.f138 = (e.f138 ?? 0) >>> 0;
  r.type.stats.f20 = e.f20; r.type.stats.speedByte = e.f44; r.type.stats.f45 = e.f45; r.owner.f2c = e.p2c;
  r.effects = o.effects >>> 0; r.ready = o.act_ready ?? 0;
  r.f58 = (o.act_phase ?? 0) >>> 0; r.f6c = (o.act_cnt ?? 0) & 0xff;   // fase e contador da máquina de ação 0x50f12c
  const mo = r.mapObj;
  mo.x = o.x & 0xff; mo.y = o.y & 0xff; mo.cell = ((mo.y << 8) | mo.x) & 0xffff; mo.fx = o.sx & 0xff; mo.fy = o.sy & 0xff;
  recFromBytes(r, e.mv, e.ai);
  listSet(r.pathStatic, o.walk?.static ?? []);
  listSet(r.pathDynamic, o.walk?.dynamic ?? []);
}

const DX = [0, 1, 1, 1, 0, -1, -1, -1], DY = [-1, -1, 0, 1, 1, 1, 0, -1];
const DEAD = 0x10;
export const origAlive = (o: OrigUnit): boolean => o.state !== DEAD && o.hp > 0;

/** Herói do save: atributos do servidor (Reaction = Agility da nossa ficha), classe pelo livro, magias do livro. */
export function heroFromState(st: OrigState): HeroState {
  const o = st.units.find(u => u.id === st.hero) ?? st.units.find(u => u.kind === "hero");
  const h = defaultHero();
  if (!o) return h;
  h.stats = { body: o.body, agility: o.reaction, mind: o.mind, spirit: o.spirit };
  const mage = o.book.length > 0 && o.dmin === 0;
  if (mage) {
    const el = ["fire", "water", "air", "earth", "astral"] as const;
    const k = [1, 2, 3, 4, 5].reduce((b, i) => (o.skills[i] ?? 0) > (o.skills[b] ?? 0) ? i : b, 1);
    Object.assign(h, { heroClass: "mage", elementSkill: el[k - 1], weaponSkill: undefined,
      equipment: { weapon: "33037", mail: "63277", cuirass: "63531" }, inventory: [] });
  }
  h.spells = o.book.map(b => String(b.id));
  return h;
}

export interface Imported { r: Run; w: World; idmap: Map<number, number>; base: MissionSnapshot; st0: OrigState;
  /** volta os jogadores e grupos do exe ao retrato do tique 0 (`World.exeGroupsSave`: não estão no `MissionSnapshot`) */
  groups0: () => void }

/** Bits de efeito ativo (+0x144, notes/ai-behaviors.md) → magia que os põe. Duração/força não são lidas (objetos de efeito à parte):
 *  aplicamos a magia com o poder 50 [est]. Maldições (Curse, Slow, Stone Curse, veneno) ficam de fora. */
export const EFFECT_SPELL: [number, number][] = [[0x10, 4], [0x100, 8], [0x1000, 12], [0x2000, 13], [0x80000, 19], [0x100000, 20], [0x200000, 21], [0x8000000, 27]];

/** Casa as unidades do original com as nossas: herói com herói; o resto por (tipo, jogador) e menor distância. */
export function matchUnits(w: World, st: OrigState, hero: Unit): Map<number, number> {
  const idmap = new Map<number, number>();
  const free = new Set(w.units.filter(u => u !== hero).map(u => u.id));
  const orig = [...st.units].sort((a, b) => a.id - b.id);
  // 1ª passada: (tipo, jogador) com atribuição GULOSA GLOBAL pelos pares mais próximos (por id, a 24613 da m20 roubava o par da 24621)
  const pairs: [number, OrigUnit, Unit][] = [];
  for (const o of orig) {
    if (o.id === st.hero) { idmap.set(o.id, hero.id); continue; }
    for (const id of free) {
      const u = w.get(id)!;
      if (u.typeId !== o.type || u.player !== o.player) continue;
      const d = Math.hypot(u.x - o.fx, u.y - o.fy);
      if (d <= 6) pairs.push([d, o, u]);
    }
  }
  pairs.sort((a, b) => a[0] - b[0] || a[1].id - b[1].id);
  for (const [, o, u] of pairs) if (!idmap.has(o.id) && free.has(u.id)) { idmap.set(o.id, u.id); free.delete(u.id); }
  // 2ª passada: mesmo jogador a ≤ 4 células com tipo diferente (m20: 3 humanos tipo 1 do original são Peasant 14/10 no nosso
  // mapa — o tipo vai para a fidelidade)
  for (const o of orig) {
    if (idmap.has(o.id)) continue;
    let best: Unit | undefined, bd = Infinity;
    for (const id of free) {
      const u = w.get(id)!;
      if (u.player !== o.player) continue;
      const d = Math.hypot(u.x - o.fx, u.y - o.fy);
      if (d < bd) { bd = d; best = u; }
    }
    if (best && bd <= 4) { idmap.set(o.id, best.id); free.delete(best.id); }
  }
  return idmap;
}

/** Monta a missão do estado, casa as unidades e devolve o mundo (sem copiar o estado: use `applyState`). */
export async function worldFromState(st: OrigState): Promise<Imported> {
  const data = await loadData(st.mission);
  const r = startRun(data, heroFromState(st));
  // o estado exportado é de DEPOIS do 1º ciclo do script (gatilhos "Start": patrulhas, guardas, swarm): roda-o antes do retrato do
  // tique 0, senão cada janela o repete (a patrulha dos camponeses da m20 recomeçava na posição da janela)
  r.b.runtime?.update(0);
  const w = r.b.world;
  // passo por célula do original no tique 0 (MapRec+0): o nosso mapa (sim/exe/mapbuild.ts) não tem o passo padrão 6 que 0x550a96
  // põe nas células livres do pé das estruturas
  if (st.terrain_speed) {
    st.terrain_speed.forEach((row, y) => row.forEach((f, x) => { w.exeBase[y * 256 + x] = f & 0xff; w.exe.mem[y * 256 + x] = f & 0xff; }));
  }
  const idmap = matchUnits(w, st, r.b.hero);
  // unidades do original sem par (criadas pelo script antes do save, ex.: 3 humanos do jogador 3 na m20_start): cria do template do
  // mesmo tipo (o de vida máx. mais próxima) no lugar delas; o estado (stats, vida, ordem) vem do applyState
  spawnUnmatched(r, w, st, idmap);
  const base = snapshotMission(st.mission, r.b, { objectives: [], messages: [], elapsedMs: 0, cam: { x: 0, y: 0 }, zoom: 1 });
  return { r, w, idmap, base, st0: st, groups0: w.exeGroupsSave() };
}

/** Cria no nosso mundo as unidades vivas do estado do original que não têm par (ou cujo par sumiu): do template do mesmo tipo (vida
 *  máx. mais próxima), na célula delas. No início do episódio são as do script; no meio (janelas do golden/diff_window) são as que
 *  nasceram depois do tique 0 — invocações (Summon), mortos-vivos, reforços do script (GRUPO-ALAVANCAS, 20/10). Devolve as criadas. */
export function spawnUnmatched(r: Run, w: World, st: OrigState, idmap: Map<number, number>): number[] {
  const data = r.data;
  const made: number[] = [];
  for (const o of st.units) {
    // id 0 em (0,0): objeto de unidade FORA do mapa que o original guarda durante a invocação (aparece no export de todas as janelas com Summon)
    if (!origAlive(o) || o.id === 0 || (o.x === 0 && o.y === 0)) continue;
    const cur = idmap.get(o.id);
    if (cur !== undefined && w.get(cur)) continue;
    const cands = Object.entries(data.templates ?? {}).filter(([, t]) => (t as { typeId?: number }).typeId === o.type)
      .sort(([, a], [, b]) => Math.abs(Number((a as { health?: number }).health ?? 0) - o.hpmax) - Math.abs(Number((b as { health?: number }).health ?? 0) - o.hpmax));
    const u = cands.length ? spawnFromTemplate(r.b, data, Number(cands[0]![0])) : undefined;
    if (!u) continue;
    u.player = o.player;
    u.maxHp = Math.max(1, o.hpmax); u.hp = Math.max(1, o.hp);     // o template pode vir sem vida (applyState não revive quem nasce morto)
    w.placeExact(u, o.x, o.y);
    u.home = { x: o.x, y: o.y };
    idmap.set(o.id, u.id);
    made.push(o.id);
  }
  return made;
}

/** Volta ao mundo do tique 0 (para cada janela ser um teste independente). */
export function resetWorld(imp: Imported): void {
  // unidades nascidas na janela anterior (invocações nossas ou criadas por spawnUnmatched) não existem no retrato do tique 0:
  // saem antes do restore (restoreWorld exige o mesmo conjunto)
  const keep = new Set(imp.base.world.units.map(u => u.id));
  const w = imp.w;
  // pares criados por spawnUnmatched numa janela (ou noutro episódio do mesmo estado, no cache do golden) não valem mais
  for (const [o, n] of [...imp.idmap]) if (!keep.has(n)) imp.idmap.delete(o);
  if (w.units.some(u => !keep.has(u.id))) {
    // os grupos espelhados do exe (fora do retrato) também largam quem sai: senão o pensamento lê um membro sem registro
    const gone = w.units.filter(u => !keep.has(u.id)).map(u => u.rec.addr >>> 0);
    for (const g of w.exe.world!.groupsByAddr.values()) for (const a of gone) g.members.remove(a);
    for (const u of w.units) if (!keep.has(u.id)) w.byId.delete(u.id);
    w.units.splice(0, w.units.length, ...w.units.filter(u => keep.has(u.id)));
  }
  // os grupos do exe voltam ao tique 0 ANTES do retrato: o restore (exeRebuildLists → exeSyncGroups) reaplica os comandos do script
  // como na 1.ª janela
  imp.groups0();
  // IA+0x20 (alvo atribuído pelo grupo, 0x57240b) fica o da corrida, como antes de o save levar todos os campos do registro: a
  // importação não o traz e o do tique 0 piora a corrida reancorada do tickcmp (m10_start 97,4 → 96,3 %) [est: harness]
  const f20 = new Map(w.units.map(u => [u.id, u.rec.ai.f20] as const));
  restoreMission(imp.r.b, imp.base);
  for (const u of w.units) { const v = f20.get(u.id); if (v !== undefined) u.rec.ai.f20 = v; }
  imp.r.outcome = null;
}

/** Campos comparados na fidelidade (nosso motor × original) e como lê-los dos dois lados. */
const FIELDS: [string, (u: Unit, w: World) => number | string, (o: OrigUnit) => number | string][] = [
  ["type", u => u.typeId, o => o.type], ["hp", u => u.hp, o => o.hp], ["hpmax", u => u.maxHp, o => o.hpmax], ["mana", u => u.mana, o => o.mana],
  ["manamax", u => u.maxMana, o => o.manamax], ["speed", u => Math.round(u.stats.speed * 16), o => o.speed_eff ?? o.speed],
  ["scan", u => Math.floor(u.stats.sight), o => o.scan], ["toHit", u => u.stats.attack, o => o.toHit],
  ["dmin", u => u.stats.damage.min, o => o.dmin], ["dmax", u => u.stats.damage.max, o => o.dmin + o.damp],
  ["defense", u => u.stats.defense, o => o.defense], ["absorb", u => u.stats.absorption, o => o.absorb],
  ["range", u => u.stats.range, o => o.range & 0xff], ["turn", u => u.stats.turnSpeed ?? Math.round(u.stats.speed * 16), o => o.turn & 0xff],
  ["wimpy", u => u.wimpyHp, o => o.wimpy], ["withdraw", u => u.withdrawHp, o => o.withdraw],
  ["cell", u => `${u.cx},${u.cy}`, o => `${o.x},${o.y}`],
  ["book", u => u.spells.map(s => s.id).sort((a, b) => Number(a) - Number(b)).join(","), o => o.book.map(b => b.id).sort((a, b) => a - b).join(",")],
];

export interface Fidelity { units: number; matched: number; unmatched: number[]; fields: Record<string, { n: number; diff: number; ex: string[] }> }

export function fidelity(w: World, st: OrigState, idmap: Map<number, number>): Fidelity {
  const f: Fidelity = { units: st.units.length, matched: 0, unmatched: [], fields: {} };
  for (const [k] of FIELDS) f.fields[k] = { n: 0, diff: 0, ex: [] };
  for (const o of st.units) {
    const u = idmap.has(o.id) ? w.get(idmap.get(o.id)!) : undefined;
    if (!u) { f.unmatched.push(o.id); continue; }
    f.matched++;
    for (const [k, ours, orig] of FIELDS) {
      const a = ours(u, w), b = orig(o), e = f.fields[k]!;
      e.n++;
      if (String(a) !== String(b)) { e.diff++; if (e.ex.length < 4) e.ex.push(`${o.id}/t${o.type}: nosso ${a} × orig ${b}`); }
    }
  }
  return f;
}

/** Copia o estado do original para o nosso mundo (unidades casadas por `idmap`). Devolve os ids do original sem par e os que não dá
 *  para reproduzir (vivos no original, mortos no nosso). */
export function applyState(w: World, st: OrigState, idmap: Map<number, number>, opts: { orders?: boolean; stats?: boolean; spells?: Record<string, unknown>; diplomacy?: boolean; exe?: { replay: ExeReplay; t: number } } = {}): { missing: number[]; dead: number[] } {
  const orders = opts.orders ?? true, stats = opts.stats ?? true;
  const missing: number[] = [], dead: number[] = [];
  w.rng.state = st.rng >>> 0;
  // matriz de diplomacia do estado (tickcmp: o script muda a diplomacia no meio do episódio; as janelas do golden não importam)
  if (opts.diplomacy && st.diplomacy) st.diplomacy.forEach((row, a) => row.forEach((v, b) => { if (w.dip[a] && w.dip[a]![b] !== undefined) w.dip[a]![b] = v; }));
  const m20 = (v: number) => ((v % TICKS_PER_SEC) + TICKS_PER_SEC) % TICKS_PER_SEC;
  w.clockPhase = m20(thinkPhaseFor(st.t16) - w.tick);
  w.t16base = st.t16 - w.clock16();   // o contador de 1/s (`secClock`) deriva dele: ⌊relógio ÷ 16⌋ = o `tick` do despejo
  const byOrig = new Map<number, Unit>();
  for (const o of st.units) { const u = idmap.has(o.id) ? w.get(idmap.get(o.id)!) : undefined; if (u) byOrig.set(o.id, u); }
  const addrOf = new Map<number, number>(st.units.filter(o => o.exe).map(o => [o.id, o.exe!.a >>> 0]));
  for (const o of st.units) {
    const u = byOrig.get(o.id);
    if (!u) { missing.push(o.id); continue; }
    if (!origAlive(o)) {
      // morta (0x10): consumada; caída (vida ≤ 0 sem 0x10): a queda do exe, com o contador da animação (+0x6c) para Unit_Die cair no tique certo
      // a caída fica na célula do traço (no exe ela segue nas células até a morte consumada): sem isto ficava onde a janela anterior a
      // deixou (golden `target|t75`, m10_mage_s603 512: o goblin caído em (27,42) em vez de (25,42), longe do aliado que o golpeava)
      if (o.state !== 0x10 && !u.bodyDead && (u.alive || u.state === "dying")) w.placeExact(u, o.x, o.y, o.x + o.sx / 256, o.y + o.sy / 256);
      if (u.alive) {
        if (o.state === 0x10) { u.hp = Math.min(0, o.hp); w.kill(u); }
        else { u.hp = o.hp; w.importFallen(u, o.act_cnt ?? 0); }
      } else if (o.state !== 0x10 && !u.bodyDead) { u.hp = o.hp; u.rec.f6c = (o.act_cnt ?? 0) & 0xff; }
      // a caída segue membro do grupo no exe, com o registro inteiro (endereço, IA+0x58 de quem a golpeou, dono): sem ele o grupo
      // apontava para um registro avulso sem dono e AI_EnemyFilter pelo 1.º membro (caído) tirava todos os candidatos (m10_start,
      // 24593–24595 em T=609: o original atribui o herói a 24595)
      if (o.state !== 0x10 && o.exe && (u.alive || u.state === "dying")) unitRecFromOrig(u.rec, o, addrOf);
      continue;
    }
    if (!u.alive) { dead.push(o.id); continue; }
    if (stats) {
      u.stats = { ...u.stats, speed: (o.speed_eff ?? o.speed) / 16, sight: o.scan, attack: o.toHit, damage: { min: o.dmin, max: o.dmin + o.damp },
        defense: o.defense, absorption: o.absorb - origFx(o).absorb,   // lote 4: o Shield vem da lista +0x20 (World.exeFxSum) range: Math.max(1, o.range & 0xff), turnSpeed: (o.turn & 0xff) || u.stats.turnSpeed,
        ...(o.charge ? { charge: o.charge, relax: o.relax ?? u.stats.relax } : {}),
        ...(o.eldmg && o.eldmg.some(x => x) ? { elemental: { aBase: o.eldmg[0]!, aRange: o.eldmg[1]!, bBase: o.eldmg[2]!, bRange: o.eldmg[3]!, element: o.eldmg[4]! } } : {}) };
      u.wimpyHp = o.wimpy; u.withdrawHp = o.withdraw;
    }
    u.maxHp = o.hpmax; u.hp = o.hp; u.maxMana = o.manamax; u.mana = o.mana;
    u.regenSlot = o.id;
    if (opts.spells) for (const [bit, sid] of EFFECT_SPELL) {
      if (!(o.effects & bit) || origFx(o).ids.has(sid)) continue;   // lote 4: os da lista +0x20 do exe não viram `buffs`
      const def = u.spells.find(sp => Number(sp.id) === sid) ?? (opts.spells[String(sid)] ? spellDef(sid, opts.spells[String(sid)] as never, 50) : undefined);
      if (def) (w as unknown as { applyBuffs(a: Unit, b: Unit, s: unknown): void }).applyBuffs(u, u, def);
    }
    { const lt = o.target > 0 ? byOrig.get(o.target) : undefined; u.lastTarget = lt ? lt.id : 0; }
    // posição fina do exe (objeto de mapa: célula do chão e fração em 1/256) e rumo (andar+0, 0..255 a partir do norte)
    w.placeExact(u, o.x, o.y, o.x + o.sx / 256, o.y + o.sy / 256);
    u.angle = (o.angle ?? (o.dir & 7) << 5) & 0xff;
    if (!orders) continue;
    if (o.unreach_sec !== undefined) u.unreachSec = o.unreach_sec;
    // olhar em volta (0x56e5bc): tarefa IA+8 = 0xb e golpe recebido IA+0x54 no registro do exe (exato ou derivado abaixo)
    u.angle = (o.angle ?? 0) & 0xff;
    // campos novos do export (fase 5): guarda 0x12 e ponto de fuga exatos
    if (o.unreach_sec_raw !== undefined) u.unreachSec = o.unreach_sec_raw;
    if (o.flee_cell !== undefined) u.fleeCell = o.flee_cell;
    if (o.hit_clock16 !== undefined) u.hitClock16 = o.hit_clock16;   // relógio de 16/s absoluto (IA+0x98)
    const tgt = o.target > 0 ? byOrig.get(o.target) : undefined;
    // posto (+0x1c4[0]); na patrulha (tarefa 0xa, 0x569b62) o posto acompanha a unidade e o ponto A da nossa patrulha fica o do script
    // (o posto do retrato do tique 0: `home` é vista sobre IA+0, que a linha abaixo troca pelo do traço)
    const post0 = u.home;
    if (o.post && o.task !== 0xa) u.home = { x: o.post & 0xff, y: o.post >> 8 };
    // o posto IA+0 do traço vai direto ao registro (o pensamento portado não o relê de `home`); patrulha andando entre os pontos:
    // IA+4 = 1 (0x569b62 o põe ao mandar andar; no próximo pensamento o posto passa a ser a célula) [est: IA+4 não está no traço]
    if (o.post !== undefined) u.rec.ai.f00 = o.post & 0xffff;
    if (o.task === 0xa && o.mode === 1) u.rec.ai.f04 = 1;
    if (o.task === 0xa && o.dest && u.ai.type === "patrol") {
      // patrulha: ponto corrente = IA+2 (despejo da etapa 6; o fim do caminho já pode tê-lo trocado), senão o destino IA+0xa;
      // B = o ponto do script, A = o posto inicial
      const pt = o.exe?.ai ? parseInt(o.exe.ai.slice(4, 6), 16) | (parseInt(o.exe.ai.slice(6, 8), 16) << 8) : o.dest;
      const dx = pt & 0xff, dy = pt >> 8;
      w.command(u, { type: "patrol", ax: post0.x, ay: post0.y, bx: u.ai.x, by: u.ai.y, toB: dx === u.ai.x && dy === u.ai.y });
    }
    // andando (tarefa 1/10, ou a guarda voltando ao posto: tarefa 0xb modo 1; na guarda da carga do mapa, modo 1 com destino ≠ posto =
    // fuga ao ponto +0x9c, que pode ser 0 — World.noteAttacked / ai.ts)
    else if (o.task === 0xb && o.mode === 1 && o.dest !== o.post && (o.unreach_sec !== undefined || (o.flee_cell !== undefined && o.dest === o.flee_cell))) {
      u.fleeCell = o.dest; w.command(u, { type: "move", x: o.dest & 0xff, y: o.dest >> 8 });
    }
    // (tarefa 1/10 com IA+8 = 0: o pensamento já largou a ordem de andar — no destino ou a meio do último passo)
    else if (((o.task === 1 || o.task === 10) && (o.exe === undefined || o.mode !== 0) || (o.task === 0xb && o.mode === 1)) && o.dest) w.command(u, { type: "move", x: o.dest & 0xff, y: o.dest >> 8 });
    else if ((o.task === 3 || o.mode === 5 || o.mode === 6) && tgt && tgt.alive) {
      w.command(u, { type: "attack", target: tgt.id });
      // modo 0 = ordem ainda não pegou o pensamento 1×/s (chegou antes: vale no próximo); 5/6/8 = já em curso
      u.orderArmed = o.mode !== 0;
      if (!u.orderArmed) u.orderTick = w.tick - TICKS_PER_SEC;
    }
    else if (u.order.type === "attack" || u.order.type === "move" || u.order.type === "cast") w.command(u, { type: "none" });
    // registro do exe (fonte de verdade do andar): exato com o despejo da etapa 6, senão derivado do estado (janelas do golden)
    if (o.exe) { unitRecFromOrig(u.rec, o, addrOf); w.exeImportSpellPtrs(u, o.exe.book ?? [], o.exe.f64); }
    else recFromState(w, u, o, byOrig);
  }
  // guarda dos grupos: raio atual, base e combate do comando do grupo; alvo atribuído a cada unidade (0x57240b)
  for (const g of st.groups ?? []) {
    const us = g.units.map(x => byOrig.get(x.id)).filter((x): x is Unit => !!x && x.group > 0);
    if (!us.length || g.radius <= 0) continue;
    const base = g.base ?? (g.combat ? g.radius - 4 : g.radius);
    w.groupState.set(us[0]!.group, { base, radius: g.radius, combat: !!g.combat, cmd12: g.cmd === 0x12 });
    for (const x of g.units) {
      const u = byOrig.get(x.id);
      if (!u || u.group !== us[0]!.group) continue;
      u.groupRadius = g.radius;
      u.groupTarget = x.assigned ? byOrig.get(x.assigned)?.id ?? 0 : 0;
    }
  }
  // grupos acordados (+0x3c+0x45): unidade com ação 0x1b (27) = grupo dormindo (0x56dca2); acordado sem estar perto do jogador humano
  // nem ferido = sempre acordado (+0x48, gatilhos do script). Sem o despejo do exe (janelas do golden) é a aproximação antiga do cálculo
  // dos setores (0x55b5f1); com ele, +0x45/+0x48 vêm dos dados do grupo (abaixo)
  const awakeG = new Set<number>();
  if (orders) {
    for (const o of st.units) { const u = byOrig.get(o.id); if (u && u.group && origAlive(o) && o.state !== 27) awakeG.add(u.group); }
    const marks: [number, number][] = [];
    for (const u of w.units) if (u.alive && (u.isHero || u.player === w.humanPlayer)) marks.push([Math.floor(u.x) >> 3, Math.floor(u.y) >> 3]);
    const near = new Set<number>();
    for (const u of w.units) {
      if (!u.group || near.has(u.group) || !u.alive || !w.isAiPlayerUnit(u)) continue;
      if (u.hp < u.maxHp) { near.add(u.group); continue; }
      const bx = Math.floor(u.x) >> 3, by = Math.floor(u.y) >> 3;
      if (marks.some(([x, y]) => Math.abs(x - bx) <= 2 && Math.abs(y - by) <= 2)) near.add(u.group);
    }
    w.alwaysAwake = new Set([...awakeG].filter(g => !near.has(g)));
  }
  // MapRec do tique: o do original (deltas do despejo) ou, sem ele, refeito das unidades (`exeResync`); registros de unidades do
  // original sem par (mortas, fora do mapa) entram como estão, para os ponteiros da ocupação resolverem
  w.exeExact = false;
  if (opts.exe && st.units.some(o => o.exe)) {
    opts.exe.replay.applyTo(w.exe, opts.exe.t);
    w.exe.units.clear();
    for (const u of w.units) w.exe.units.set(u.rec.addr, u.rec);
    for (const o of st.units) {
      if (!o.exe || w.exe.units.has(o.exe.a >>> 0)) continue;
      const r = new UnitRec();
      unitRecFromOrig(r, o);
      w.exe.units.set(r.addr, r);
    }
    // lista das unidades vivas do exe (mundo+4) na ordem do despejo (= a da lista do original), com as sem par incluídas; as 3 listas
    // do contentor [0x68d2dc] (World_SecondTick) na ordem do original (ids → endereços)
    const L = st.exe?.world?.lists, toA = (ids: number[]) => ids.map(i => addrOf.get(i) ?? 0).filter(a => a !== 0);
    w.exeRebuildLists(st.units.filter(o => o.exe && origAlive(o)).map(o => o.exe!.a >>> 0),
      L ? { all: toA(L.all), magic: toA(L.magic), corpses: toA(L.corpses) } : undefined);
    // jogadores e grupos do exe (lote 2): os registros exatos do despejo; a unidade do motor de cada membro dá o `u.group`
    const P = st.exe?.world?.players;
    if (P) {
      const unitOf = new Map<number, Unit>(); for (const u of w.units) unitOf.set(u.rec.addr >>> 0, u);
      w.exeApplyPlayers(P.map(p => ({ ...p, groups: p.groups.map(g => ({ a: g.a, data: g.data, units: toA(g.units) })) })), st.exe?.world?.class_table ?? "",
        a => { const u = unitOf.get(a >>> 0); return u ? (u.group || -u.id) : 0; });
    }
    // os objetos de magia em voo/presos ao alvo (etapa 8b, lote 3): os do original, com os endereços dele
    w.exeSpellObjsFromJson(undefined);
    spellObjsFromOrig(w.exeWorld, st.exe?.world?.spell_objs ?? []);
    unitFxFromOrig(w, st);
    w.exeExact = true;
  } else {
    w.exeResync(); w.exeRebuildLists();
    // janelas do golden (sem o despejo): os dados do grupo exportados (raio, base, combate, contagem, comando) e o alvo atribuído (+0x20)
    for (const g of st.groups ?? []) {
      const us = g.units.map(x => byOrig.get(x.id)).filter((x): x is Unit => !!x && (x.group > 0 || (g.cmd === 1 && !w.isAiPlayerUnit(x) && x.ai.type === "guard")));   // + Guard do script no lado humano (grupo próprio)
      if (!us.length) continue;
      if (us[0]!.group === 0) w.exeScriptGuardNow(us[0]!);
      const d = us[0]!.rec.type.stats;
      d.f2d = g.radius & 0xff; d.f38 = (g.base ?? (g.combat ? g.radius - 4 : g.radius)) & 0xff; d.f30 = g.combat | 0; d.f34 = (g as { count?: number }).count ?? 0;
      d.f28 = g.center & 0xffff;
      for (const x of g.units) { const u = byOrig.get(x.id); if (u && u.rec.type === us[0]!.rec.type) u.rec.ai.f20 = x.assigned ? byOrig.get(x.assigned)?.rec.addr ?? 0 : 0; }
    }
    // +0x45 acordado agora (ação ≠ 0x1b) e +0x48 sempre acordado (gatilhos do script 0x562745, fora do traço): o grupo que dorme no
    // original tem +0x48 = 0 (com 1, 0x55b406 o acordaria); o acordado fica com 1 [est: perto do lado humano não dá para saber]. Sem
    // isto (+0x48 = 1 de todos, do retrato do tique 0) o 1.º pensamento acordava os que o original deixa dormindo (9 olhares em volta a
    // mais por tique na m10_start_s22)
    if (orders) for (const u of w.units) if (u.group && w.isAiPlayerUnit(u)) {
      const d = u.rec.type.stats, on = awakeG.has(u.group) ? 1 : 0;
      d.f45 = on; d.f48 = on;
    }
  }
  // unidades nossas sem par no original (ex.: invocação que o original não tem): ficam como estão
  return { missing, dead };
}

/** Registro do exe derivado do estado do golden (sem os bytes do andar): listas, destino, contadores, tarefa e, a meio passo, o
 *  passo refeito pela fórmula (0x559195) a partir do centro da célula de onde ele partiu [est: tique corrente do passo pela distância
 *  andada]. */
function recFromState(w: World, u: Unit, o: OrigUnit, byOrig: Map<number, Unit>): void {
  const r = u.rec, wk = o.walk, a = (o.angle ?? (o.dir & 7) << 5) & 0xff;
  if (wk) {
    listSet(r.pathStatic, wk.static); listSet(r.pathDynamic, wk.dynamic);
    r.walk.dest = wk.goal; r.walk.f76 = wk.final; r.walk.f09 = wk.c9; r.walk.f78 = wk.c78; r.walk.f8a = wk.slen; r.walk.f8c = wk.tcell;
    r.walk.chaseTarget = wk.track ? byOrig.get(wk.track)?.rec.addr ?? 0 : 0;
  }
  r.walk.dir = a; r.walk.dirTarget = (o.want ?? a) & 0xff;
  if (o.turn) r.walk.turnRate = o.turn & 0xff;
  if (o.pmask) r.walk.passMask = o.pmask & 0xff;
  r.task = o.task; r.act = o.state; r.effects = o.effects >>> 0;
  r.f58 = (o.act_phase ?? 0) >>> 0; r.f6c = (o.act_cnt ?? 0) & 0xff;
  // +0x136 pedido pronto (vem no traço): sem ele, o golpe acabado (fase 0) seguia direto para o próximo (0x56dca2 só encerra a sub-ação 1/2
  // com IA+0x15 > 2 E +0x136 ≠ 0) — o herói batia ~4 tiques antes (golden `alive|t103`, m20_start_s130 720)
  r.ready = (o.act_ready ?? 0) & 0xff;
  if ((o.state === 3 || o.state === 0xd) && o.target > 0) r.f5c = byOrig.get(o.target)?.rec.addr ?? 0;
  r.speed = o.speed_eff ?? o.speed; r.type.stats.speedByte = 0; r.f94 = o.hp; r.mana = o.mana;
  // relógio de ocupação +0x138 (0x50fc3e: regeneração ×3 depois de 80 tiques parada) não está no traço: como se a unidade acabasse de agir
  // [est: o mesmo que o motor antigo fazia com `lastActionTick` = 0 num mundo recém-criado]; os restos +0xa2/+0xa3 ficam 0
  r.f138 = ((w.t16base ?? 0) + w.clock16()) >>> 0;
  r.ai.task = o.mode & 0xff; r.ai.sub = (o.sub9 ?? 0) & 0xff; r.ai.f0a = o.dest & 0xffff; r.ai.f54 = o.look_hit ? 1 : 0;
  // IA+0x15 (tiques da sub-ação 1/2 desde 0x56e8c3/0x56e906, que o zeram) não está no traço: na fase 5 = carga − contador, depois dela já
  // passou de 2 (só se compara com 2) [est: sem o acréscimo de 0x5167c6 na carga]
  if (r.ai.sub === 1 || r.ai.sub === 2) r.ai.f15 = r.f58 === 5 ? Math.max(0, Math.min(3, ((o.charge ?? r.f134) & 0xff) - r.f6c)) : 3;
  // tarefas 5/6 (atacar IA+0xc): o alvo do traço; sem par para ele, a tarefa fica 0 (o despachante leria um ponteiro nulo) [est]
  if (r.ai.task === 5 || r.ai.task === 6) {
    r.ai.f0c = o.target > 0 ? byOrig.get(o.target)?.rec.addr ?? 0 : 0;
    if (r.ai.f0c === 0) r.ai.task = 0;
  }
  // a meio giro (rumo ≠ desejado): andar+0xa0 = 1 (0x556454 continua pelo passo de giro em vez de encostar de uma vez)
  r.walk.turning = r.walk.dir !== r.walk.dirTarget ? 1 : 0; r.walk.stepTick = 0; r.walk.stepTicks = 0;
  if (o.sx === 128 && o.sy === 128) { if (r.ai.sub === 3) r.ai.sub = 0; return; }
  // a meio passo: direção do passo = rumo; a célula de partida é a atual se a fração já passou do centro no sentido do passo
  const d = (a >> 5) & 7, dx = DX[d]!, dy = DY[d]!;
  const behind = (dx !== 0 && (o.sx - 128) * dx < 0) || (dy !== 0 && (o.sy - 128) * dy < 0);
  const fx0 = (o.x - (behind ? dx : 0)) & 0xff, fy0 = (o.y - (behind ? dy : 0)) & 0xff;
  const from = (fy0 << 8) | fx0;
  r.walk.stepFrom = from; r.walk.nextCell = (((fy0 + dy) & 0xff) << 8) | ((fx0 + dx) & 0xff);
  unitWalkFormula(w.exe, r, from, d << 5);
  const went = Math.max(Math.abs(o.x * 256 + o.sx - (fx0 * 256 + 128)), Math.abs(o.y * 256 + o.sy - (fy0 * 256 + 128)));
  const per = Math.max(1, Math.abs(r.walk.stepDx) || Math.abs(r.walk.stepDy));
  r.walk.stepTick = Math.min(r.walk.stepTicks, Math.round(went / per));
  r.ai.sub = 3;
}

async function main(): Promise<void> {
  const args = proc.argv.slice(2);
  const opt = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
  const { readFileSync } = proc.getBuiltinModule("node:fs") as { readFileSync(p: string, e: "utf8"): string };
  const st = JSON.parse(readFileSync(opt("state") ?? "../refs/trace/diff/state_m10_start.json", "utf8")) as OrigState;
  const imp = await worldFromState(st);
  const f = fidelity(imp.w, st, imp.idmap);
  const res = applyState(imp.w, st, imp.idmap);
  const after = fidelity(imp.w, st, imp.idmap);
  if (args.includes("--json")) { console.log(JSON.stringify({ before: f, after, apply: res })); return; }
  console.log(`estado ${st.state ?? "?"} (missão ${st.mission}): ${f.matched}/${f.units} unidades casadas; sem par: ${f.unmatched.join(",") || "-"}`);
  for (const [k, e] of Object.entries(f.fields)) {
    const a = after.fields[k]!;
    console.log(`  ${k.padEnd(9)} antes ${String(e.diff).padStart(3)}/${e.n} diferentes  depois ${a.diff}  ${e.ex.slice(0, 2).join(" | ")}`);
  }
  console.log(`  aplicar: sem par ${res.missing.length}, mortos só no nosso ${res.dead.length}`);
}

if ((proc.argv[1] ?? "").replace(/\\/g, "/").endsWith("import_state.ts")) void main();
