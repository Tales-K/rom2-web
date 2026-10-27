/**
 * Comparador de TIQUE INTEIRO (etapa 3 de docs/ABORDAGEM-FIDELIDADE-UNIDADES.md; notes/tick-compare.md).
 * Para cada tique T do oráculo (refs/oracle/ticks/<ep>.jsonl.gz: o estado decodificado do servidor original a CADA tique): importa o
 * estado T no nosso motor (import_state.applyState), aplica as ordens do roteiro com `t` = T, avança EXATAMENTE 1 tique e compara com o
 * estado T+1 do original, campo a campo, por id de unidade e de grupo. Reancora a cada tique: não há cascata.
 *
 *   npm run tickcmp -- --episode m10_start_s1        (na pasta game)    --all  = os 3 episódios
 *   --fields hp,act,fx       só esses campos            --show 120   original × nosso nos campos divergentes do tique 120
 *   --replay                 usa os sorteios gravados do original (rand.json.gz) no lugar do rand() nosso
 *   --max N                  só os N primeiros tiques   --no-resync  pula a corrida de T=0 sem reimportar
 *   --dump <arq>             grava todas as divergências da corrida reancorada (JSONL: episódio, T, campo|unidade, original, nosso)
 *   --no-exe                 ignora o registro do exe do despejo (importação derivada, como nas janelas do golden)
 *   --free-from T            a corrida sem reimportar parte do tique T (padrão 0)
 *
 * Regras de contagem:
 *  - campo que o nosso motor não modela (NAO_MODELADO) é listado à parte e não conta como divergência;
 *  - par (campo, unidade) que já difere logo depois da IMPORTAÇÃO (applyState não o reproduz) não pode ser culpa do passo: fica de fora
 *    da comparação desse tique e entra na tabela "perdido na importação".
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { RngReplay, type RandRecording } from "../../../game/src/sim/rng";
import { applyState, resetWorld, spawnUnmatched, worldFromState, EFFECT_SPELL, ExeReplay, type Imported, type OrigState } from "../../../game/src/sim/test/import_state";
import { listVals } from "../../../game/src/sim/exe/recio";
import { orderOf } from "../../../game/src/sim/test/diff_window";
import { type Unit, type World } from "../../../game/src/sim/world";
import { TICKS_PER_SEC, type Cell } from "../../../game/src/sim/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
type Val = number | string;
interface Action { t: number; do: string; unit?: number | string | (number | string)[]; x?: number; y?: number; target?: number | string; spell?: number }

const gz = (p: string): string => gunzipSync(readFileSync(p)).toString("utf8");
const ROOT = join(import.meta.dirname, "..", "..", "..");
const EPISODES = ["m10_start_s1", "m10_mage_s102", "m20_start_s203"];

/** Campos do oráculo que o nosso motor não representa (não contam como divergência). */
export const NAO_MODELADO: Record<string, string> = {
  mode: "modo da IA (+0x1c4): 0/1/5/6/8/11; o nosso tem AiMode/Order, sem o código do exe",
  want: "rumo desejado do giro (+0x1c0[1])", sub9: "sub-estado +0x9", act_phase: "fase da máquina de ação 0x50f12c (só importStrike a lê)",
  act_cnt: "contador da fase da ação", act_ready: "pedido pronto +0x136", chosen_spell: "magia escolhida pela IA (+0x78)",
  ai_spells: "magias da IA", ai_probs: "probabilidades da IA", retreat: "flag de recuo", guard_radius: "raio de guarda empacotado (+0x1c4)",
  group_post: "posto do grupo", cur_speed: "velocidade corrente", c78: "walk.c78 (+0x78)",
  body: "atributo", reaction: "atributo", mind: "atributo", spirit: "atributo", skills: "habilidades", load: "carga", capacity: "capacidade",
  wtype: "tipo de arma", pmask: "máscara de jogador", noloot: "sem saque", scan256: "visão em 1/256", exp: "experiência (só herói tem heroInfo)",
  prot: "proteções por elemento (formato diferente do nosso resist)", resist: "resistências", see_invis: "ver invisível", kind: "rótulo",
  sx: "derivado de fx", sy: "derivado de fy", cell: "derivado de x,y", dir: "derivado de angle",
  angle: "rumo fino 0..255 (o nosso tem 16 direções; ver dir16)", speed: "o speed_eff é o comparado", plane1: "plano de terreno", plane2: "plano de terreno",
  tick: "contador de 1/s do original: vira 2 tiques depois do relógio de regeneração (secClock) que a importação ancora; não é um estado à parte",
  g_center: "centro do grupo (cálculo do exe)", g_count: "contagem do grupo", g_members: "pertinência ao grupo",
};

// ------------------------------------------------------------------------------------------------ leitura dos dados
interface Episode { id: string; ep: Any; ticks: OrigState[]; base: OrigState; replay: RngReplay | null; exe: ExeReplay | null }

function loadEpisode(id: string): Episode {
  const dir = join(ROOT, "refs", "golden", "episodes", id);
  const ep = JSON.parse(readFileSync(join(dir, "ep.json"), "utf8"));
  const base = JSON.parse(gz(join(dir, "base.json.gz"))) as OrigState;
  const bookOf = new Map<number, Any>(base.units.map((u: Any) => [u.id, u.book ?? []]));
  const lines = gz(join(ROOT, "refs", "oracle", "ticks", `${id}.jsonl.gz`)).split("\n").filter(l => l.trim());
  const ticks = lines.map(l => {
    const s = JSON.parse(l) as Any;
    // o oráculo não traz `range` (usa o byte baixo de attack_range) nem `book` (estático: vem do base do golden)
    for (const u of s.units) { u.range = u.attack_range; u.book = bookOf.get(u.id) ?? []; }
    return s as OrigState;
  });
  const rp = join(dir, "rand.json.gz");
  const replay = existsSync(rp) ? new RngReplay(JSON.parse(gz(rp)) as RandRecording) : null;
  // MapRec do original por tique (deltas do despejo da etapa 6); sem eles (despejo antigo ou --no-exe) o importador refaz a ocupação
  const exe = ticks[0]?.exe && !process.argv.includes("--no-exe") ? new ExeReplay(ticks) : null;
  if (!exe) for (const t of ticks) for (const u of t.units) delete (u as Any).exe;
  return { id, ep, ticks, base: { ...(base as Any), mission: base.mission }, replay, exe };
}

// ------------------------------------------------------------------------------------------------ visões planas (campo|chave → valor)
const cellCode = (c: Cell | null | undefined): number => (c ? c.y * 256 + c.x : 0);
const R256 = (v: number): number => Math.round(v * 256);
const TASK_CLASS: Record<number, string> = { 1: "move", 10: "move", 3: "attack", 8: "cast", 0xd: "cast", 0xe: "cast", 11: "idle", 12: "idle", 0: "idle", 0x17: "idle", 16: "dead" };
const EFFECT_MASK = EFFECT_SPELL.reduce((m, [b]) => m | b, 0);
type View = Map<string, Val>;
const origDead = (o: Any): boolean => o.state === 0x10 || o.hp <= 0;
const skipUnit = (o: Any): boolean => o.id === 0 || (o.fx < 1 && o.fy < 1);

/** Campos escalares do original de uma unidade viva (mesmos nomes de ourFields). */
function origFields(o: Any): Record<string, Val | undefined> {
  const w = o.walk ?? {};
  const targeted = o.mode === 5 || o.mode === 6 || o.mode === 8 || o.task === 8 || o.task === 0xd;
  let tc = TASK_CLASS[o.task] ?? `#${o.task}`;
  if (tc === "idle" && (o.mode === 5 || o.mode === 6) && o.target) tc = "attack";
  return {
    type: o.type, player: o.player, x: o.x, y: o.y, fx: R256(o.fx), fy: R256(o.fy), hp: o.hp, hpmax: o.hpmax, mana: o.mana, manamax: o.manamax,
    act: o.state, task: tc, target: targeted ? o.target : 0, dir16: (o.angle ?? 0) >> 4,
    speed_eff: o.speed_eff ?? o.speed, scan: o.scan, toHit: o.toHit, dmin: o.dmin, dmax: o.dmin + o.damp, defense: o.defense, absorb: o.absorb,
    range: Math.max(1, o.attack_range & 0xff), turn: o.turn & 0xff, withdraw: o.withdraw, wimpy: o.wimpy, charge: o.charge ?? 0, relax: o.relax ?? 0,
    eldmg: (o.eldmg ?? [0, 0, 0, 0, 0]).join(","), hpregen: o.hpregen, manaregen: o.manaregen, effects: o.effects & EFFECT_MASK, summoner: o.summoner,
    post: o.task === 0xa ? undefined : o.post, unreach: o.unreach_sec_raw, flee_cell: o.flee_cell, hit_clock16: o.hit_clock16, look_hit: o.look_hit ? 1 : 0,
    walk_static: (w.static ?? []).join(","), walk_dynamic: (w.dynamic ?? []).join(","), walk_goal: w.goal ?? 0, walk_final: w.final ?? 0,
    walk_c9: w.c9 ?? 255, walk_track: w.track ?? 0, walk_slen: w.slen ?? 0, walk_tcell: w.tcell ?? 0,
  };
}

/** Campos da nossa unidade (u) no formato do original; `rev` = id nosso → id do original. */
function ourFields(w: World, u: Unit, rev: Map<number, number>, st: Any): Record<string, Val | undefined> {
  const s = u.stats;
  let act: number;
  if (!u.alive || u.hp <= 0) act = 16;
  else if (!w.awake(u)) act = 27;
  else if (u.state === "attack") act = 3;
  else if (u.state === "cast") act = 13;
  else if (u.state === "move" || u.rec.act === 1) act = 1;
  else act = 0;
  const o = u.order;
  const tc = o.type === "attack" ? "attack" : o.type === "cast" ? "cast" : o.type === "move" || o.type === "pickup" || o.type === "follow" || o.type === "retreat" || o.type === "patrol" ? "move" : "idle";
  const armed = u.orderArmed;
  const ot = o.type === "attack" ? o.target : o.type === "cast" ? o.target ?? 0 : 0;
  const el = s.elemental ? [s.elemental.aBase, s.elemental.aRange, s.elemental.bBase, s.elemental.bRange, s.elemental.element] : [0, 0, 0, 0, 0];
  let effects = 0;
  for (const [bit, sid] of EFFECT_SPELL) if (u.buffs.some(b => Number(b.spell) === sid)) effects |= bit;
  const oid = (id: number) => (id ? rev.get(id) ?? -id : 0);
  const base = w.t16base ?? 0;
  const r = u.rec;
  return {
    type: u.typeId, player: u.player, x: u.cx, y: u.cy, fx: R256(u.x), fy: R256(u.y), hp: u.hp, hpmax: u.maxHp, mana: u.mana, manamax: u.maxMana,
    act, task: tc, target: armed ? oid(ot) : 0, dir16: (u.dir + 8) % 16,
    speed_eff: Math.round(s.speed * 16), scan: Math.floor(s.sight), toHit: s.attack, dmin: s.damage.min, dmax: s.damage.max, defense: s.defense, absorb: s.absorption,
    range: s.range, turn: s.turnSpeed ?? Math.round(s.speed * 16), withdraw: u.withdrawHp, wimpy: u.wimpyHp, charge: s.charge ?? 0, relax: s.relax ?? 0,
    eldmg: el.join(","), hpregen: s.healthRegen ?? 0, manaregen: s.manaRegen ?? 0, effects, summoner: oid(u.summoner),
    post: cellCode(u.home), unreach: u.unreachSec, flee_cell: u.fleeCell, hit_clock16: u.hitClock16 < -99999 ? 0 : u.hitClock16 + base, look_hit: u.rec.ai.f54 ? 1 : 0,
    walk_static: listVals(r.pathStatic).join(","), walk_dynamic: listVals(r.pathDynamic).join(","), walk_goal: r.walk.dest, walk_final: r.walk.f76,
    walk_c9: r.walk.f09, walk_track: trackOf(w, r.walk.chaseTarget >>> 0, rev, st), walk_slen: r.walk.f8a, walk_tcell: r.walk.f8c,
  };
}

/** Id do original da unidade perseguida (andar+0x7c, endereço do registro): pelo endereço no despejo, senão pela nossa unidade. */
function trackOf(w: World, addr: number, rev: Map<number, number>, st: Any): number {
  if (!addr) return 0;
  for (const o of st.units as Any[]) if (o.exe && (o.exe.a >>> 0) === addr) return o.id;
  const u = w.unitByAddr(addr);
  return u ? rev.get(u.id) ?? -u.id : -1;
}

/** Lado do original: mapa `campo|chave` → valor, só das unidades vivas (e mortas: só `alive`). */
function viewOrig(st: Any, idmap: Map<number, number>, w: World): View {
  const v: View = new Map();
  for (const o of st.units as Any[]) {
    if (skipUnit(o)) continue;
    v.set(`alive|${o.id}`, origDead(o) ? 0 : 1);
    if (origDead(o)) continue;
    for (const [k, x] of Object.entries(origFields(o))) if (x !== undefined) v.set(`${k}|${o.id}`, x);
  }
  v.set("rng|", st.rng >>> 0); v.set("t16|", st.t16);
  if (st.diplomacy) for (let a = 0; a < st.diplomacy.length; a++) for (let b = 0; b < st.diplomacy[a].length; b++) v.set(`dip|${a},${b}`, st.diplomacy[a][b]);
  for (const g of st.groups ?? []) {
    const key = groupKey(g, idmap, w);
    if (!key) continue;
    v.set(`g_radius|${key}`, g.radius); v.set(`g_base|${key}`, g.base ?? 0); v.set(`g_combat|${key}`, g.combat ? 1 : 0); v.set(`g_cmd12|${key}`, g.cmd === 0x12 ? 1 : 0);
    for (const x of g.units) v.set(`g_assigned|${key}:${x.id}`, x.assigned ?? 0);
  }
  return v;
}

/** Id do grupo do original → id do grupo do mapa no nosso mundo (pelo 1º membro casado); ordem dos grupos do original é irrelevante. */
function groupKey(g: Any, idmap: Map<number, number>, w: World): string | null {
  for (const x of g.units) { const n = idmap.get(x.id); const u = n !== undefined ? w.get(n) : undefined; if (u && u.group > 0) return `G${u.group}`; }
  return null;
}

function viewOurs(w: World, st: Any, orig: Any, idmap: Map<number, number>, rev: Map<number, number>): View {
  const v: View = new Map();
  for (const o of orig.units as Any[]) {
    if (skipUnit(o)) continue;
    const n = idmap.get(o.id);
    const u = n !== undefined ? w.get(n) : undefined;
    if (!u) { if (!origDead(o)) v.set(`alive|${o.id}`, -1); continue; }          // -1 = "não existe no nosso mundo" (spawn faltando)
    const alive = u.alive && u.hp > 0;
    v.set(`alive|${o.id}`, alive ? 1 : 0);
    if (!alive) continue;
    for (const [k, x] of Object.entries(ourFields(w, u, rev, st))) if (x !== undefined) v.set(`${k}|${o.id}`, x);
  }
  for (const u of w.units) if (!rev.has(u.id) && u.active && u.hp > 0) v.set(`alive|n${u.id}`, 1);
  v.set("rng|", w.rng.state >>> 0); v.set("t16|", (w.t16base ?? 0) + w.clock16()); 
  if (orig.diplomacy) for (let a = 0; a < orig.diplomacy.length; a++) for (let b = 0; b < orig.diplomacy[a].length; b++) v.set(`dip|${a},${b}`, w.dip[a]?.[b] ?? 0);
  for (const g of orig.groups ?? []) {
    const key = groupKey(g, idmap, w);
    if (!key) continue;
    const gid = Number(key.slice(1)), gs = w.groupState.get(gid);
    v.set(`g_radius|${key}`, gs?.radius ?? 0); v.set(`g_base|${key}`, gs?.base ?? 0); v.set(`g_combat|${key}`, gs?.combat ? 1 : 0); v.set(`g_cmd12|${key}`, gs?.cmd12 ? 1 : 0);
    for (const x of g.units) { const n = idmap.get(x.id); const u = n !== undefined ? w.get(n) : undefined; v.set(`g_assigned|${key}:${x.id}`, u && u.group === gid ? (u.groupTarget ? rev.get(u.groupTarget) ?? -u.groupTarget : 0) : 0); }
  }
  return v;
}

const fieldOf = (k: string): string => k.slice(0, k.indexOf("|"));
const unitOf = (k: string): string => k.slice(k.indexOf("|") + 1);
const same = (a: Val | undefined, b: Val | undefined): boolean => String(a) === String(b);

interface Diff { key: string; orig: Val | undefined; ours: Val | undefined }
/** Pares divergentes de duas visões. `ignore` = pares já perdidos na importação; `fields` = filtro. Alvo de ataque/magia: ver golden_compare. */
function diffViews(o: View, n: View, ignore: { has(k: string): boolean } | null, fields: Set<string> | null): Diff[] {
  const out: Diff[] = [];
  const keys = new Set<string>([...o.keys(), ...n.keys()]);
  for (const k of keys) {
    const f = fieldOf(k);
    if (fields && !fields.has(f)) continue;
    if (ignore?.has(k)) continue;
    const a = o.get(k), b = n.get(k);
    if (a === undefined && b === undefined) continue;
    // campo comparável só quando os dois lados têm a unidade viva (alive discrepante já é uma divergência por si)
    if (f !== "alive" && f !== "rng" && f !== "t16" && f !== "dip" && !f.startsWith("g_") && (a === undefined || b === undefined)) continue;
    if (!same(a, b)) out.push({ key: k, orig: a, ours: b });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ execução
function actionsAt(script: Action[], t: number): Action[] { return script.filter(a => a.t === t); }

function runActions(imp: Imported, w: World, acts: Action[], sel: Unit[], heroOrig: number): Unit[] {
  const ref = (v: number | string | undefined): Unit | undefined => {
    if (v === undefined) return undefined;
    const o = v === "hero" ? heroOrig : Number(v);
    const n = imp.idmap.get(o);
    return n !== undefined ? w.get(n) : undefined;
  };
  for (const a of acts) {
    const us = Array.isArray(a.unit) ? a.unit.map(ref) : a.unit !== undefined ? [ref(a.unit)] : sel;
    const list = us.filter((u): u is Unit => !!u && u.alive);
    if (a.do === "select") { sel = list; continue; }
    for (const u of list) { const o = orderOf(w, a as Any, u, ref); if (o) w.command(u, o); }
  }
  return sel;
}

function stepOnce(imp: Imported): void {
  imp.w.step();
  imp.w.exeExact = false;   // o estado exato do exe vale só para o passo logo depois da importação
  imp.r.b.runtime?.update(1 / TICKS_PER_SEC);
  imp.w.events.length = 0;
}

/** Retoma a magia em curso do herói (tarefa 0xd/0xe no estado importado): o estado não diz qual era (diff_window faz o mesmo). */
function resumeCast(imp: Imported, w: World, st: Any, script: Action[], T: number, heroOrig: number): void {
  const hs = (st.units as Any[]).find(o => o.id === heroOrig);
  const n = imp.idmap.get(heroOrig);
  const hero = n !== undefined ? w.get(n) : undefined;
  const last = [...script].filter(a => a.t < T && ["cast", "attack", "move", "stop"].includes(a.do)).pop();
  if (!hs || !hero || !last || last.do !== "cast" || (hs.task !== 0xd && hs.task !== 0xe)) return;
  const ref = (v: number | string | undefined) => { const id = imp.idmap.get(v === "hero" ? heroOrig : Number(v)); return id !== undefined ? w.get(id) : undefined; };
  const o = orderOf(w, last as Any, hero, ref);
  if (o) { w.command(hero, o); hero.orderArmed = hs.mode !== 0; }
}

interface Agg {
  n: number; whole: number; wholeNoDir: number;                                              // tiques e tiques com estado inteiro idêntico
  field: Map<string, { bad: number; first: number }>;                    // por campo
  pair: Map<string, { n: number; t: number; orig: Val | undefined; ours: Val | undefined }>;
  lost: Map<string, number>;                                             // campo → (tique, unidade) perdidos na importação
  lostPair: Map<string, { n: number; t: number; orig: Val | undefined; ours: Val | undefined }>;
  rngDraws: { same: number; total: number }; importDraws: number;
}
const newAgg = (): Agg => ({ n: 0, whole: 0, wholeNoDir: 0, field: new Map(), pair: new Map(), lost: new Map(), lostPair: new Map(), rngDraws: { same: 0, total: 0 }, importDraws: 0 });

function lcgSteps(a: number, b: number): number | null {
  let s = a >>> 0;
  for (let n = 0; n <= 3000; n++) { if (s === (b >>> 0)) return n; s = (Math.imul(s, 214013) + 2531011) >>> 0; }
  return null;
}

/** Corrida de passo único reancorada: um tique por vez. */
async function runResync(E: Episode, imp: Imported, opt: Opts, show: number | null): Promise<Agg> {
  const agg = newAgg();
  const script = E.ep.script as Action[];
  const heroOrig: number = E.ep.hero;
  const N = Math.min(E.ticks.length - 1, opt.max ?? Infinity);
  for (let T = 0; T < N; T++) {
    const st = E.ticks[T] as Any, nx = E.ticks[T + 1] as Any;
    resetWorld(imp);
    const w = imp.w;
    spawnUnmatched(imp.r, w, st, imp.idmap);
    applyState(w, st, imp.idmap, { spells: imp.r.data.spells as Record<string, unknown> | undefined, diplomacy: true, ...(E.exe ? { exe: { replay: E.exe, t: T } } : {}) });
    w.events.length = 0;
    countImportDraws(agg, w, st);
    const rev = new Map<number, number>([...imp.idmap].map(([o, n]) => [n, o]));
    // perdido na importação: o que o applyState não reproduz do estado T
    const lost = new Map<string, Diff>();
    for (const d of diffViews(viewOrig(st, imp.idmap, w), viewOurs(w, st, st, imp.idmap, rev), null, null)) lost.set(d.key, d);
    w.rng.replay = null;
    if (opt.replay && E.replay) {
      E.replay.counting = false; w.rng.replay = E.replay;
      E.replay.clock = () => (w.t16base ?? 0) + w.clock16();
      E.replay.begin(E.ep.t16_0 + T + 1, E.ep.t16_0 + T + 2);
    }
    resumeCast(imp, w, st, script, T, heroOrig);
    w.rng.state = st.rng >>> 0;
    const sel0 = [imp.w.get(imp.idmap.get(heroOrig) ?? -1)].filter((u): u is Unit => !!u);
    runActions(imp, w, actionsAt(script, T), sel0, heroOrig);
    stepOnce(imp);
    const rev2 = new Map<number, number>([...imp.idmap].map(([o, n]) => [n, o]));
    const nv = viewOurs(w, nx, nx, imp.idmap, rev2);
    const eff = unchanged(lost, nv);
    const diffs = diffViews(viewOrig(nx, imp.idmap, w), nv, eff, opt.fields);
    tally(agg, T, diffs, eff, opt.fields);
    if (opt.dump) for (const d of diffs) appendFileSync(opt.dump, JSON.stringify({ ep: E.id, T, k: d.key, o: d.orig, n: d.ours }) + "\n");
    if (nx.rng !== undefined && st.rng !== undefined) {
      const no = lcgSteps(st.rng, nx.rng), nn = lcgSteps(st.rng, w.rng.state);
      agg.rngDraws.total++; if (no === nn) agg.rngDraws.same++;
    }
    if (show === T) printShow(T, diffs, eff, nx, st, w, rev2);
    if (T % 200 === 0 && !opt.quiet) process.stderr.write(`  ${E.id}: T=${T}/${N}\r`);
  }
  return agg;
}

/** applyState/resumeCast chamam w.command & cia., que podem sortear: conta os tiques em que a importação mexeu no rng (restaurado depois). */
function countImportDraws(agg: Agg, w: World, st: Any): void { if ((w.rng.state >>> 0) !== (st.rng >>> 0)) agg.importDraws++; w.rng.state = st.rng >>> 0; }

/** Pares perdidos na importação que o passo NÃO mexeu (nosso valor igual ao logo após importar): ficam fora da comparação — não são culpa do
 *  passo (ex.: `type` do herói, `manaregen`). Os que o passo mexeu (act de quem passa a andar, caminho dinâmico) são comparados normalmente. */
function unchanged(lost: Map<string, Diff>, nv: View): Map<string, Diff> {
  const out = new Map<string, Diff>();
  for (const [k, d] of lost) if (String(nv.get(k)) === String(d.ours)) out.set(k, d);
  return out;
}

function tally(agg: Agg, T: number, diffs: Diff[], lost: Map<string, Diff>, fields: Set<string> | null): void {
  agg.n++;
  if (!diffs.length) agg.whole++;
  if (diffs.every(d => fieldOf(d.key) === "dir16")) agg.wholeNoDir++;
  const seen = new Set<string>();
  for (const d of diffs) {
    const f = fieldOf(d.key);
    if (!seen.has(f)) { seen.add(f); const e = agg.field.get(f) ?? { bad: 0, first: T }; e.bad++; agg.field.set(f, e); }
    const pk = `${f}|${unitOf(d.key)}`;
    const p = agg.pair.get(pk);
    if (p) p.n++; else agg.pair.set(pk, { n: 1, t: T, orig: d.orig, ours: d.ours });
  }
  const lf = new Set<string>();
  for (const [k, d] of lost) {
    const f = fieldOf(k);
    if (fields && !fields.has(f)) continue;
    const lp = agg.lostPair.get(`${f}|${unitOf(k)}`);
    if (lp) lp.n++; else agg.lostPair.set(`${f}|${unitOf(k)}`, { n: 1, t: T, orig: d.orig, ours: d.ours });
    if (!lf.has(f)) { lf.add(f); agg.lost.set(f, (agg.lost.get(f) ?? 0) + 1); }
  }
}

function printShow(T: number, diffs: Diff[], lost: Map<string, Diff>, nx: Any, st: Any, w: World, rev: Map<number, number>): void {
  console.log(`\n--show ${T}: estado ${T} → passo → comparado com o estado ${T + 1}  (t16 ${st.t16}→${nx.t16})`);
  if (!diffs.length) console.log("  estado inteiro idêntico");
  console.log("  campo          unidade        original            nosso");
  for (const d of diffs.sort((a, b) => a.key.localeCompare(b.key))) {
    console.log(`  ${fieldOf(d.key).padEnd(14)} ${unitOf(d.key).padEnd(14)} ${String(d.orig).slice(0, 36).padEnd(19)} ${String(d.ours).slice(0, 48)}`);
  }
  if (lost.size) console.log(`  (+ ${lost.size} pares campo|unidade já perdidos na importação, fora da comparação)`);
  void w; void rev;
}

interface FreeResult { first: number; firstDiff: Diff[]; perUnit: Map<string, number>; perField: Map<string, number>; unitsSeen: number }

/** Corrida inteira a partir de T=0 SEM reimportar: acha o primeiro tique em que algum campo diverge (por unidade e por campo também). */
async function runFree(E: Episode, imp: Imported, opt: Opts): Promise<FreeResult> {
  const script = E.ep.script as Action[];
  const heroOrig: number = E.ep.hero;
  const N = Math.min(E.ticks.length - 1, opt.max ?? Infinity);
  const T0 = opt.freeFrom ?? 0;
  resetWorld(imp);
  const w = imp.w;
  const st0 = E.ticks[T0] as Any;
  spawnUnmatched(imp.r, w, st0, imp.idmap);
  applyState(w, st0, imp.idmap, { spells: imp.r.data.spells as Record<string, unknown> | undefined, diplomacy: true, ...(E.exe ? { exe: { replay: E.exe, t: T0 } } : {}) });
  w.events.length = 0;
  const rev0 = new Map<number, number>([...imp.idmap].map(([o, n]) => [n, o]));
  const lost = new Map<string, Diff>();
  for (const d of diffViews(viewOrig(st0, imp.idmap, w), viewOurs(w, st0, st0, imp.idmap, rev0), null, null)) lost.set(d.key, d);
  w.rng.replay = null;
  if (opt.replay && E.replay) { E.replay.counting = false; w.rng.replay = E.replay; E.replay.clock = () => (w.t16base ?? 0) + w.clock16(); E.replay.begin(E.ep.t16_0 + T0 + 1, E.ep.t16_0 + N + 2); }
  resumeCast(imp, w, st0, script, T0, heroOrig);
  let sel = [w.get(imp.idmap.get(heroOrig) ?? -1)].filter((u): u is Unit => !!u);
  const res: FreeResult = { first: -1, firstDiff: [], perUnit: new Map(), perField: new Map(), unitsSeen: 0 };
  const ids = new Set<string>();
  for (const o of st0.units as Any[]) if (!skipUnit(o)) ids.add(String(o.id));
  for (let T = T0; T < N; T++) {
    sel = runActions(imp, w, actionsAt(script, T), sel, heroOrig);
    stepOnce(imp);
    const nx = E.ticks[T + 1] as Any;
    const rev = new Map<number, number>([...imp.idmap].map(([o, n]) => [n, o]));
    const nv = viewOurs(w, nx, nx, imp.idmap, rev);
    const diffs = diffViews(viewOrig(nx, imp.idmap, w), nv, unchanged(lost, nv), opt.fields);
    if (diffs.length && res.first < 0) { res.first = T; res.firstDiff = diffs; }
    for (const d of diffs) {
      const f = fieldOf(d.key), u = unitOf(d.key).split(":")[0]!.split(",")[0]!;
      if (!res.perField.has(f)) res.perField.set(f, T);
      if (/^\d+$/.test(u) && !res.perUnit.has(u)) res.perUnit.set(u, T);
    }
    for (const o of nx.units as Any[]) if (!skipUnit(o)) ids.add(String(o.id));
  }
  res.unitsSeen = ids.size;
  return res;
}

// ------------------------------------------------------------------------------------------------ relatório
interface Opts { fields: Set<string> | null; replay: boolean; max?: number; quiet?: boolean; resync: boolean; dump?: string; freeFrom?: number }
const pct = (a: number, b: number): string => (b ? (100 * a / b).toFixed(1) : "—") + "%";
const median = (a: number[]): number => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };

function report(E: Episode, agg: Agg, free: FreeResult | null, opt: Opts): void {
  console.log(`\n=== ${E.id}  (${agg.n} tiques, missão ${E.ticks[0]!.mission}${opt.replay ? ", sorteios do original" : ""}) ===`);
  console.log(`estado inteiro idêntico: ${agg.whole}/${agg.n} = ${pct(agg.whole, agg.n)}`);
  console.log(`idêntico exceto o rumo do olhar em volta (dir16): ${agg.wholeNoDir}/${agg.n} = ${pct(agg.wholeNoDir, agg.n)}`);
  console.log(`importação sorteou rand() em ${agg.importDraws}/${agg.n} tiques (rng restaurado depois)`);
  console.log(`rand(): mesmo nº de sorteios por tique em ${pct(agg.rngDraws.same, agg.rngDraws.total)}`);
  console.log("por campo (tiques idênticos, 1ª divergência):");
  const names = new Set<string>([...agg.field.keys()]);
  const rows = [...names].map(f => ({ f, e: agg.field.get(f)! })).sort((a, b) => b.e.bad - a.e.bad);
  for (const { f, e } of rows) console.log(`  ${f.padEnd(14)} ${pct(agg.n - e.bad, agg.n).padStart(7)}   1ª em T=${e.first}   (${e.bad} tiques divergentes)`);
  console.log(`  (demais campos comparados: 100% idênticos)`);
  console.log("20 pares campo|unidade mais frequentes (exemplo: T, original, nosso):");
  const pairs = [...agg.pair].sort((a, b) => b[1].n - a[1].n).slice(0, 20);
  for (const [k, p] of pairs) console.log(`  ${k.padEnd(24)} ${String(p.n).padStart(4)}×  T=${p.t}  orig=${String(p.orig).slice(0, 30)}  nosso=${String(p.ours).slice(0, 30)}`);
  if (agg.lost.size) {
    console.log("fora da comparação (applyState não reproduz e o passo não mexeu; tiques com ≥1 unidade):");
    console.log("  " + [...agg.lost].sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f}:${n}`).join("  "));
    for (const [k, p] of [...agg.lostPair].sort((a, b) => b[1].n - a[1].n).slice(0, 6)) console.log(`    ${k.padEnd(22)} ${String(p.n).padStart(4)}×  T=${p.t}  orig=${String(p.orig).slice(0, 26)}  nosso=${String(p.ours).slice(0, 26)}`);
  }
  if (free) {
    const t = [...free.perUnit.values()];
    const all = [...free.perUnit.entries()];
    console.log(`SEM ressincronização (T=0 → fim): 1º tique divergente = ${free.first < 0 ? "nenhum" : free.first}` +
      (free.first >= 0 ? ` (${free.firstDiff.slice(0, 4).map(d => `${d.key} o=${d.orig} n=${d.ours}`).join("; ")})` : ""));
    const never = free.unitsSeen - all.length;
    console.log(`  mediana do 1º tique divergente por unidade: ${median(t)}  (${all.length} de ${free.unitsSeen} unidades divergem; ${never} nunca)`);
    console.log(`  1º tique por campo: ${[...free.perField].sort((a, b) => a[1] - b[1]).slice(0, 14).map(([f, x]) => `${f}@${x}`).join(" ")}`);
  }
}

function printNaoModelado(): void {
  console.log("\nNÃO MODELADO (não contam como divergência):");
  for (const [k, v] of Object.entries(NAO_MODELADO)) console.log(`  ${k.padEnd(12)} ${v}`);
}

async function main(): Promise<void> {
  const a = process.argv.slice(2);
  const arg = (k: string): string | undefined => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  const ids = a.includes("--all") ? EPISODES : (arg("--episode") ?? EPISODES[0]!).split(",");
  const opt: Opts = { fields: arg("--fields") ? new Set(arg("--fields")!.split(",")) : null, replay: a.includes("--replay"), resync: !a.includes("--no-resync"),
    max: arg("--max") ? Number(arg("--max")) : undefined, quiet: a.includes("--quiet"), dump: arg("--dump"), freeFrom: arg("--free-from") ? Number(arg("--free-from")) : undefined };
  if (opt.dump) writeFileSync(opt.dump, "");
  const show = arg("--show") !== undefined ? Number(arg("--show")) : null;
  const summary: string[] = [];
  for (const id of ids) {
    const E = loadEpisode(id);
    const imp = await worldFromState(E.base);
    const t0 = Date.now();
    const agg = await runResync(E, imp, opt, show);
    const free = opt.resync && show === null ? await runFree(E, imp, opt) : null;
    report(E, agg, free, opt);
    summary.push(`${id}: idêntico ${pct(agg.whole, agg.n)}; sem ressinc. 1º=${free?.first ?? "-"} mediana/unid.=${free ? median([...free.perUnit.values()]) : "-"} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
  if (ids.length > 1) console.log("\nRESUMO\n  " + summary.join("\n  "));
  printNaoModelado();
}

void main();
