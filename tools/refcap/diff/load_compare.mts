/**
 * Comparador do TIQUE 0 do carregador de missão (etapa 9b; docs/briefings/ETAPA9B-CARREGADOR.md, notes/carregador.md).
 * Para cada missão com despejo do original (refs/oracle/load/<M>.json.gz: o carregador do exe Server_StartMap 0x4eb715 chamado no
 * Unicorn, tools/re/oracle/load_mission.py) monta a missão pelo NOSSO carregador (loader.startRun, como a MissionScene) e compara,
 * campo a campo, sem passo nenhum:
 *  - a visão plana do tickcmp (tick_compare.mts: origFields/ourFields, grupos, diplomacia), menos `rng`/`t16` (o carregador semeia o
 *    rand() pelo relógio, 0x4eb715 → Rand_SeedTimeGetTime; o nosso jogo semeia por conta própria);
 *  - o registro do exe por unidade: campos de andar (+0x1c0) e de IA (+0x1c4) pelos offsets de exe/recio.ts (+ IA+0x10/+0x20), os
 *    campos da unidade que o despejo traz (+0x43, +0x49, +0x4a, +0x50, +0x54, +0x8c, +0x94, +0x9a, +0x12c, regeneração, +0x138), o
 *    tipo (+0x20/+0x44/+0x45), o dono (+0x2c) e o livro (ids). Ponteiros viram `u<id>` (unidade), `s<id>` (magia do livro) ou `ptr`;
 *  - os bytes do MapRec ([0x670e48], 0xa4570 B): contagem por faixa (passo, máscara estática, dinâmica, resto).
 * Unidades casadas por id: original = 0x6000 + id do .alm (o nosso `scriptId`); o herói pelo `hero` do despejo.
 *
 *   npm run loadcmp                       (na pasta game)  todas as missões com despejo
 *   npm run loadcmp -- 10,20              só essas          --show 10   os pares divergentes da missão 10
 *   --fields wimpy,ai.task                só esses campos   --no-map    sem o MapRec        --dump <arq>  todos os pares (JSONL)
 */
import { existsSync, readdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { loadData, startRun } from "../../../game/src/sim/test/loader";
import { heroFromState, type OrigState } from "../../../game/src/sim/test/import_state";
import { AI_FIELDS, WALK_FIELDS, fieldsFromHex, type Field } from "../../../game/src/sim/exe/recio";
import type { Unit, World } from "../../../game/src/sim/world";
import { diffViews, fieldOf, unitOf, viewOrig, viewOurs, type Diff, type View } from "./tick_compare.mts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const ROOT = join(import.meta.dirname, "..", "..", "..");
const LOAD = join(ROOT, "refs", "oracle", "load");
const ID0 = 0x6000;

/** Campos da IA além dos que o importador lê (recio AI_FIELDS): alvos IA+0x10 e IA+0x20 (endereços). */
const AI_EXTRA: Field[] = [[0x10, 4, "f10"], [0x20, 4, "f20"]];
const AI_ALL = [...AI_FIELDS, ...AI_EXTRA];
/** Campos de 4 bytes que guardam endereço (de unidade, de magia do livro ou outro objeto). */
const PTR_WALK = new Set(["chaseTarget", "f6c", "f90", "f98", "turning"]);
const PTR_AI = new Set(["f04", "f0c", "f10", "target", "f20", "f28", "f30", "f50", "f54", "f5c", "f60", "f94", "f98", "fac"]);

// ------------------------------------------------------------------------------------------------ registro do exe
interface Ctx { origAddr: Map<number, number>; origSpell: Map<number, number>; w: World; rev: Map<number, number> }

/** Valor de ponteiro normalizado: unidade → `u<id do original>`, magia do livro → `s<id>`, outro → `ptr`; 0 fica 0. */
function ptrOrig(c: Ctx, v: number): number | string {
  v >>>= 0;
  if (!v) return 0;
  const u = c.origAddr.get(v);
  if (u !== undefined) return `u${u}`;
  const s = c.origSpell.get(v);
  return s !== undefined ? `s${s}` : v < 0x10000 ? v : "ptr";
}
function ptrOurs(c: Ctx, v: number, u: Unit): number | string {
  v >>>= 0;
  if (!v) return 0;
  const t = c.w.unitByAddr(v);
  if (t) return `u${c.rev.get(t.id) ?? -t.id}`;
  const sp = u.rec.book.spells.find(s => s && (s.addr >>> 0) === v);
  return sp ? `s${sp.id}` : v < 0x10000 ? v : "ptr";
}

function exeOrig(o: Any, c: Ctx): Record<string, number | string> {
  const e = o.exe, out: Record<string, number | string> = {};
  if (!e) return out;
  const wf = fieldsFromHex(e.mv ?? "", WALK_FIELDS), af = fieldsFromHex(e.ai ?? "", AI_ALL);
  for (const [k, v] of Object.entries(wf)) out[`walk.${k}`] = PTR_WALK.has(k) ? ptrOrig(c, v) : v;
  for (const [k, v] of Object.entries(af)) out[`ai.${k}`] = PTR_AI.has(k) ? ptrOrig(c, v) : v;
  Object.assign(out, {
    "u.f43": e.f43, "u.size": e.size, "u.kind": e.kind, "u.task": e.u50, "u.act": e.act, "u.speed": e.speed, "u.hp": e.hp, "u.mana": e.mana,
    "u.f12c": e.f12c, "t.f20": e.f20, "t.f44": e.f44, "t.f45": e.f45, "o.f2c": e.p2c, "u.f98": e.f98, "u.f9c": e.f9c, "u.f9e": e.f9e,
    "u.fa2": e.fa2, "u.fa3": e.fa3, "u.fde": e.fde, "u.fe2": e.fe2, "u.f138": e.f138, "u.f5c": ptrOrig(c, e.f5c ?? 0), "u.f64": ptrOrig(c, e.f64 ?? 0),
    "u.book": (e.book ?? []).map((b: [number, number]) => b[0]).join(","), "u.fx": (e.fx ?? []).length,
  });
  return out;
}

function exeOurs(u: Unit, c: Ctx): Record<string, number | string> {
  const r = u.rec, out: Record<string, number | string> = {};
  const w = r.walk as unknown as Record<string, number>, a = r.ai as unknown as Record<string, number>;
  for (const [, , k] of WALK_FIELDS) out[`walk.${k}`] = PTR_WALK.has(k) ? ptrOurs(c, w[k] ?? 0, u) : (w[k] ?? 0);
  for (const [, , k] of AI_ALL) out[`ai.${k}`] = PTR_AI.has(k) ? ptrOurs(c, a[k] ?? 0, u) : (a[k] ?? 0);
  Object.assign(out, {
    "u.f43": r.f43, "u.size": r.size, "u.kind": r.kind, "u.task": r.task, "u.act": r.act, "u.speed": r.speed, "u.hp": r.f94, "u.mana": r.mana,
    "u.f12c": r.attackRange, "t.f20": r.type.stats.f20, "t.f44": r.type.stats.speedByte, "t.f45": r.type.stats.f45, "o.f2c": r.owner.f2c,
    "u.f98": r.f98, "u.f9c": r.f9c, "u.f9e": r.f9e, "u.fa2": r.fa2, "u.fa3": r.fa3, "u.fde": r.fde, "u.fe2": r.fe2, "u.f138": r.f138 >>> 0,
    "u.f5c": ptrOurs(c, r.f5c, u), "u.f64": ptrOurs(c, (r as Any).f64?.addr ?? (r as Any).f64 ?? 0, u),
    "u.book": r.book.spells.filter(s => s).map(s => s!.id).join(","), "u.fx": r.fx.values().length,
  });
  return out;
}

// ------------------------------------------------------------------------------------------------ MapRec
const MAP_BANDS: [string, number, number][] = [["map.passo", 0, 0x10000], ["map.mascara", 0x10000, 0x20000], ["map.dinamica", 0x20000, 0x30000], ["map.resto", 0x30000, 0xa4570]];
function mapDiff(st: Any, w: World): Diff[] {
  const run = st.exe?.mem?.[0];
  if (!run || run[0] !== 0) return [];
  const hex: string = run[1], mem = w.exe.mem, out: Diff[] = [];
  for (const [name, a, b] of MAP_BANDS) {
    let n = 0, first = -1;
    for (let i = a; i < b && i * 2 < hex.length; i++) {
      if (parseInt(hex.substr(i * 2, 2), 16) !== mem[i]) { n++; if (first < 0) first = i; }
    }
    if (n) out.push({ key: `${name}|${first.toString(16)}`, orig: `${n} B`, ours: `1.º +0x${first.toString(16)}` });
  }
  return out;
}

/** --show: os trechos do MapRec que diferem (deslocamento, bytes do original, nossos). */
function mapRuns(st: Any, w: World, max = 40): string[] {
  const hex: string = st.exe?.mem?.[0]?.[1] ?? "", mem = w.exe.mem, out: string[] = [];
  for (let i = 0; i < mem.length && i * 2 < hex.length && out.length < max; i++) {
    if (parseInt(hex.substr(i * 2, 2), 16) === mem[i]) continue;
    let e = i;
    while (e + 1 < mem.length && e - i < 15 && parseInt(hex.substr((e + 1) * 2, 2), 16) !== mem[e + 1]) e++;
    out.push(`+0x${i.toString(16)}: o=${hex.substr(i * 2, (e - i + 1) * 2)} n=${Buffer.from(mem.subarray(i, e + 1)).toString("hex")}`);
    i = e;
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ uma missão
interface Result { m: number; pairs: number; diffs: Diff[]; units: number; matched: number }

async function one(m: number, opt: Opts): Promise<Result> {
  const st = JSON.parse(gunzipSync(readFileSync(join(LOAD, `${m}.json.gz`))).toString("utf8")) as Any;
  for (const u of st.units) { u.range = u.attack_range; u.book = (u.exe?.book ?? []).map((b: [number, number]) => ({ id: b[0], mana: 0 })); }
  const data = await loadData(m);
  const r = startRun(data, heroFromState(st as OrigState));
  const w = r.b.world;
  // casamento por id: herói pelo `hero` do despejo; o resto por 0x6000 + id do .alm
  const idmap = new Map<number, number>();
  const byScript = new Map<number, Unit>();
  for (const u of w.units) if (u !== r.b.hero && u.scriptId) byScript.set(u.scriptId, u);
  for (const o of st.units as Any[]) {
    if (o.id === st.hero) { idmap.set(o.id, r.b.hero.id); continue; }
    const u = o.id >= ID0 ? byScript.get(o.id - ID0) : undefined;
    if (u) idmap.set(o.id, u.id);
  }
  const rev = new Map<number, number>([...idmap].map(([o, n]) => [n, o]));
  const c: Ctx = { w, rev, origAddr: new Map(), origSpell: new Map() };
  for (const o of st.units as Any[]) if (o.exe) { c.origAddr.set(o.exe.a >>> 0, o.id); for (const [id, a] of o.exe.book ?? []) c.origSpell.set(a >>> 0, id); }
  // visão plana do tickcmp + registro do exe
  const vo: View = viewOrig(st, idmap, w), vn: View = viewOurs(w, st, st, idmap, rev);
  for (const k of ["rng|", "t16|"]) { vo.delete(k); vn.delete(k); }
  for (const o of st.units as Any[]) {
    const n = idmap.get(o.id), u = n !== undefined ? w.get(n) : undefined;
    if (!u || !o.exe) continue;
    for (const [k, v] of Object.entries(exeOrig(o, c))) vo.set(`${k}|${o.id}`, v);
    for (const [k, v] of Object.entries(exeOurs(u, c))) vn.set(`${k}|${o.id}`, v);
  }
  // o herói não é do carregador: o servidor novo de 0x48ab76 não o tem (o cliente o junta depois de 0x4eb715) — fica fora, com o grupo
  const heroKey = new RegExp(`\\|(${st.hero}|G\\d+:${st.hero})$`);
  for (const v of [vo, vn]) for (const k of [...v.keys()]) if (heroKey.test(k)) v.delete(k);
  vn.delete(`alive|n${r.b.hero.id}`);
  const diffs = diffViews(vo, vn, null, opt.fields);
  if (opt.map) diffs.push(...mapDiff(st, w).filter(d => !opt.fields || opt.fields.has(fieldOf(d.key))));
  if (opt.show === m && opt.map) for (const l of mapRuns(st, w)) console.log(`    MapRec ${l}`);
  return { m, pairs: new Set([...vo.keys(), ...vn.keys()]).size, diffs, units: st.units.length, matched: idmap.size };
}

// ------------------------------------------------------------------------------------------------ relatório
interface Opts { fields: Set<string> | null; map: boolean; show: number | null; dump?: string }

function missions(sel: string | undefined): number[] {
  if (sel) return sel.split(",").map(Number);
  if (!existsSync(LOAD)) return [];
  return readdirSync(LOAD).filter(f => /^\d+\.json\.gz$/.test(f)).map(f => parseInt(f)).sort((a, b) => a - b);
}

async function main(): Promise<void> {
  const a = process.argv.slice(2);
  const arg = (k: string): string | undefined => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  const opt: Opts = { fields: arg("--fields") ? new Set(arg("--fields")!.split(",")) : null, map: !a.includes("--no-map"),
    show: arg("--show") !== undefined ? Number(arg("--show")) : null, dump: arg("--dump") };
  const sel = a.find(x => /^\d+(,\d+)*$/.test(x) && a[a.indexOf(x) - 1] !== "--show");
  const ms = missions(sel);
  if (!ms.length) { console.log(`sem despejos em ${LOAD}: rode tools/re/oracle/load_mission.py --all`); process.exitCode = 1; return; }
  if (opt.dump) writeFileSync(opt.dump, "");
  const byField = new Map<string, { miss: Set<number>; n: number; ex: string }>();
  let exact = 0, pairs = 0, bad = 0;
  console.log("missão  unidades  casadas   pares  divergentes  1.º campo");
  for (const m of ms) {
    const res = await one(m, opt);
    pairs += res.pairs; bad += res.diffs.length;
    if (!res.diffs.length) exact++;
    const fc = new Map<string, number>();
    for (const d of res.diffs) {
      const f = fieldOf(d.key);
      fc.set(f, (fc.get(f) ?? 0) + 1);
      const e = byField.get(f) ?? { miss: new Set<number>(), n: 0, ex: `m${m} ${unitOf(d.key)}: o=${d.orig} n=${d.ours}` };
      e.miss.add(m); e.n++; byField.set(f, e);
      if (opt.dump) appendFileSync(opt.dump, JSON.stringify({ m, k: d.key, o: d.orig, n: d.ours }) + "\n");
    }
    const top = [...fc].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([f, n]) => `${f}×${n}`).join(" ");
    console.log(`${String(m).padStart(6)}  ${String(res.units).padStart(8)}  ${String(res.matched).padStart(7)}  ${String(res.pairs).padStart(6)}  ${String(res.diffs.length).padStart(11)}  ${top}`);
    if (opt.show === m) for (const d of res.diffs.slice(0, 400)) console.log(`    ${fieldOf(d.key).padEnd(18)} ${unitOf(d.key).padEnd(16)} o=${String(d.orig).slice(0, 40).padEnd(24)} n=${String(d.ours).slice(0, 40)}`);
  }
  console.log(`\nTIQUE 0 EXATO: ${exact} de ${ms.length} missões; pares idênticos ${(100 * (pairs - bad) / Math.max(1, pairs)).toFixed(2)} % (${pairs - bad}/${pairs})`);
  console.log("campos que mais divergem (missões, pares, exemplo):");
  for (const [f, e] of [...byField].sort((x, y) => y[1].miss.size - x[1].miss.size || y[1].n - x[1].n).slice(0, 40)) {
    console.log(`  ${f.padEnd(18)} ${String(e.miss.size).padStart(3)} ${String(e.n).padStart(6)}   ${e.ex}`);
  }
}

void main();
