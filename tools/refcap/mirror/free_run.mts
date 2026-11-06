/**
 * Corrida livre de um episódio do oráculo no nosso sim, num mundo novo (sem a corrida reancorada antes), nos dois começos de simcore:
 * estado importado do tique 0 e nosso carregador. Ordens do roteiro (refs/golden/episodes/<id>/ep.json) nos mesmos tiques; estado do
 * original por tique em refs/oracle/ticks/<id>.jsonl.gz (tools/re/oracle/dump_ticks.py). Relata o 1.º tique divergente (todos os
 * campos do tickcmp e só os de jogo: posição, vida, vivo, tarefa, alvo, diplomacia), por unidade e por campo, e os eventos dos dois lados.
 *
 *   cd game && npx tsx ../tools/refcap/mirror/free_run.mts --episode m10_quest_x1 [--mode import|loader|both] [--max N] [--show T]
 *     [--events 24600,24599] [--preroll] [--from T0  (modo importado a partir do estado T0 do original)]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { OrigState } from "../../../game/src/sim/test/import_state";
import { compare, ourUnit, prepState, simFromImport, simFromLoader, step, type Action, type Sim } from "./simcore.mts";
import { fieldOf, unitOf, type Diff } from "../diff/tick_compare.mts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const ROOT = join(import.meta.dirname, "..", "..", "..");
const gz = (p: string): string => gunzipSync(readFileSync(p)).toString("utf8");
const GAME = new Set(["x", "y", "hp", "alive", "task", "target", "dip", "player"]);

function load(id: string): { ep: Any; base: OrigState; ticks: OrigState[] } {
  const dir = join(ROOT, "refs", "golden", "episodes", id);
  const ep = JSON.parse(readFileSync(join(dir, "ep.json"), "utf8"));
  const base = JSON.parse(gz(join(dir, "base.json.gz"))) as Any;
  const bookOf = new Map<number, Any>(base.units.map((u: Any) => [u.id, u.book ?? []]));
  const ticks = gz(join(ROOT, "refs", "oracle", "ticks", `${id}.jsonl.gz`)).split("\n").filter(l => l.trim()).map(l => prepState(JSON.parse(l), bookOf));
  return { ep, base, ticks };
}

interface Res { first: number; firstDiff: Diff[]; firstGame: number; firstGameDiff: Diff[]; perUnit: Map<string, number>; perField: Map<string, number>; gold: [number, number][]; msgs: [number, number][]; ev: string[] }

function run(s: Sim, ep: Any, ticks: OrigState[], max: number, show: number | null, watch: number[], from = 0): Res {
  const script = ep.script as Action[];
  const res: Res = { first: -1, firstDiff: [], firstGame: -1, firstGameDiff: [], perUnit: new Map(), perField: new Map(), gold: [], msgs: [], ev: [] };
  // diferenças do tique 0 (modo carregador) não se repetem na contagem: só pares NOVOS contam como divergência
  const d0 = new Map(s.diff0.map(d => [d.key, d]));
  const N = Math.min(ticks.length - 1, max);
  let gold = 0, nmsg = 0;
  const prevO = new Map<number, Any>(), prevN = new Map<number, Any>();
  let dip = s.w.dip.map(r => [...r]);
  for (let T = from; T < N; T++) {
    step(s, script.filter(a => a.t === T));
    const nx = ticks[T + 1]! as Any;
    const diffs = compare(s, nx).filter(d => { const z = d0.get(d.key); return !z || String(z.orig) !== String(d.orig) || String(z.ours) !== String(d.ours); });
    if (diffs.length && res.first < 0) { res.first = T; res.firstDiff = diffs; }
    const g = diffs.filter(d => GAME.has(fieldOf(d.key)));
    if (g.length && res.firstGame < 0) { res.firstGame = T; res.firstGameDiff = g; }
    for (const d of diffs) {
      const f = fieldOf(d.key), u = unitOf(d.key);
      if (!res.perField.has(f)) res.perField.set(f, T);
      if (/^\d+$/.test(u) && !res.perUnit.has(u)) res.perUnit.set(u, T);
    }
    if (s.gold() !== gold) { res.gold.push([T + 1, s.gold() - gold]); gold = s.gold(); }
    if (s.messages().length !== nmsg) { for (const m of s.messages().slice(nmsg)) res.msgs.push([T + 1, m]); nmsg = s.messages().length; }
    for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) if ((s.w.dip[i]?.[j] ?? 0) !== (dip[i]?.[j] ?? 0)) res.ev.push(`T=${T + 1} nosso: dip[${i}][${j}] ${dip[i]?.[j]} -> ${s.w.dip[i]?.[j]}`);
    dip = s.w.dip.map(r => [...r]);
    for (const id of watch) {
      const o = (nx.units as Any[]).find(u => u.id === id), n = ourUnit(s, id);
      const po = prevO.get(id), pn = prevN.get(id);
      if (o && po && (po.hp > 0) !== (o.hp > 0)) res.ev.push(`T=${T + 1} original: ${id} vida ${po.hp} -> ${o.hp}`);
      if (n && pn && (pn.hp as number > 0) !== (n.hp as number > 0)) res.ev.push(`T=${T + 1} nosso: ${id} vida ${pn.hp} -> ${n.hp}`);
      if (o) prevO.set(id, o); if (n) prevN.set(id, n);
    }
    if (show === T) {
      console.log(`--show ${T}: ${diffs.length} pares`);
      for (const d of diffs.slice(0, 60)) console.log(`  ${d.key.padEnd(28)} o=${String(d.orig).slice(0, 50)}  n=${String(d.ours).slice(0, 50)}`);
    }
  }
  return res;
}

function dipEvents(ticks: OrigState[], max: number): string[] {
  const out: string[] = [];
  for (let T = 1; T < Math.min(ticks.length, max + 1); T++) {
    const a = ticks[T - 1]!.diplomacy, b = ticks[T]!.diplomacy;
    if (!a || !b) continue;
    for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) if (a[i]![j] !== b[i]![j]) out.push(`T=${T} dip[${i}][${j}] ${a[i]![j]} -> ${b[i]![j]}`);
  }
  return out;
}

const fmt = (ds: Diff[], n = 6): string => ds.slice(0, n).map(d => `${d.key} o=${String(d.orig).slice(0, 40)} n=${String(d.ours).slice(0, 40)}`).join("; ");

async function main(): Promise<void> {
  const a = process.argv.slice(2);
  const arg = (k: string): string | undefined => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  const id = arg("--episode") ?? "m10_quest_x1";
  const mode = arg("--mode") ?? "both";
  const max = arg("--max") ? Number(arg("--max")) : Infinity;
  const show = arg("--show") !== undefined ? Number(arg("--show")) : null;
  const watch = (arg("--events") ?? "1,24599,24600,24619").split(",").map(Number);
  const { ep, base, ticks } = load(id);
  console.log(`episódio ${id}: ${ticks.length - 1} tiques, ${ep.script.length} ordens; estado ${ep.state}`);
  console.log("diplomacia no original:\n  " + dipEvents(ticks, max).join("\n  "));
  for (const m of mode === "both" ? ["import", "loader"] : [mode]) {
    const t0 = Date.now();
    const from = m === "import" && arg("--from") ? Number(arg("--from")) : 0;
    const s = m === "import" ? await simFromImport(base, ticks[from]!, from ? ticks.slice(0, from + 1) : undefined, from) : await simFromLoader(ticks[0]!, { preroll: a.includes("--preroll") });
    if (from) console.log(`
[importado] começa no tique ${from} do original`);
    if (m === "loader") console.log(`\n[carregador] tique 0 nosso × original: ${s.diff0.length} pares diferentes (${fmt(s.diff0, 8)})`);
    const r = run(s, ep, ticks, max, show, watch, from);
    console.log(`\n=== corrida livre, ${m === "import" ? "estado importado do tique 0" : "nosso carregador"} (${((Date.now() - t0) / 1000).toFixed(0)} s) ===`);
    console.log(`1.º tique divergente (todos os campos): ${r.first < 0 ? "nenhum" : `T=${r.first} → estado ${r.first + 1}: ${fmt(r.firstDiff)}`}`);
    console.log(`1.º tique divergente (posição/vida/vivo/tarefa/alvo/diplomacia): ${r.firstGame < 0 ? "nenhum" : `T=${r.firstGame}: ${fmt(r.firstGameDiff)}`}`);
    console.log(`1.º tique por campo: ${[...r.perField].sort((x, y) => x[1] - y[1]).slice(0, 16).map(([f, t]) => `${f}@${t}`).join(" ")}`);
    console.log(`1.º tique por unidade: ${[...r.perUnit].sort((x, y) => x[1] - y[1]).slice(0, 16).map(([u, t]) => `${u}@${t}`).join(" ")}`);
    console.log(`ouro do script no nosso: ${r.gold.map(([t, g]) => `T=${t} +${g}`).join(", ") || "nenhum"}`);
    console.log(`mensagens do script no nosso: ${r.msgs.map(([t, n]) => `T=${t} #${n}`).join(", ") || "nenhuma"}`);
    console.log(`eventos (vida ≤ 0): ${r.ev.join("; ") || "-"}`);
  }
}

void main();
