/**
 * Trabalhador do corpus dourado (tools/refcap/diff/golden_run.mjs; notes/golden-corpus.md): roda episódios do corpus SÓ no nosso motor
 * (headless, sem original) e compara com o traço guardado do original. Mesmo algoritmo de run_pair.py (`compare_window`, `pair_episode`):
 * janelas de 80 tiques, cada uma parte do estado exportado do original (diff_window.runWindows → import_state.applyState), 1ª divergência
 * persistente (2 amostras) por janela, recomeço no 1º estado exportado ≥ k + 16 (até 3 passadas).
 *
 *   node_modules/tsx/dist/cli.mjs tools/refcap/diff/golden_worker.mts --gold refs/golden --ids a,b,c [--show]
 * Saída: uma linha `@@RESULT {json}` por episódio.
 */
import { existsSync, readFileSync } from "node:fs";
import { RngReplay, type RandRecording } from "../../../game/src/sim/rng";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { worldFromState, type Imported, type OrigState } from "../../../game/src/sim/test/import_state";
import { compareOrder, compareWindow, compareWindowTol, SAMPLE, type OU } from "./golden_compare.mts";
import { runWindows } from "../../../game/src/sim/test/diff_window";

const WINDOW = 80;
const EXTRA_TOLS = (process.env.GOLDEN_TOLS ?? "").split(",").map(Number).filter(n => n > 0);
const MAX_PASS = 3;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
function gz(p: string): string { return gunzipSync(readFileSync(p)).toString("utf8"); }

const cache = new Map<string, Imported>();
async function worldFor(base: OrigState): Promise<Imported> {
  const b = { ...(base as Any) }; delete b.seed; delete b.step;
  const key = createHash("sha1").update(JSON.stringify(b)).digest("hex");
  let imp = cache.get(key);
  if (!imp) { imp = await worldFromState(base); cache.set(key, imp); }
  return imp;
}

/** O export não traz `+0x1c4+0x16` (segundo da última perseguição inalcançável da guarda da carga do mapa, 0x54e2ac/0x5728fa): deduz do
 *  traço. Uma corrida de ≥ 3 estados com tarefa 0xb, modo 1 e destino ≠ posto numa unidade de grupo 0x12 é a fuga de 10/30 s (a fuga
 *  por golpe dura 1 pensamento); o carimbo = contador de 1/s na 1ª amostra do traço em modo 1 da corrida. Grava `unreach_sec` nas
 *  unidades dos estados dessa corrida e dos 30 s seguintes (import_state usa). */
function inferUnreach(base: OrigState, states: Map<number, OrigState>, steps: number[], orig: Map<number, OU[]>): void {
  const g12 = new Set<number>();
  for (const g of (base as Any).groups ?? []) if (g.cmd === 0x12) for (const x of g.units) g12.add(x.id);
  if (!g12.size) return;
  const flee = (o: Any) => o && o.task === 0xb && o.mode === 1 && o.dest !== o.post;
  const at = (k: number, id: number) => (states.get(steps[k]!) as Any)?.units?.find((u: Any) => u.id === id);
  const oSteps = [...orig.keys()].sort((a, b) => a - b);
  for (const id of g12) {
    let stamp: number | undefined, stampStep = -1;
    for (let k = 0; k < steps.length; k++) {
      const o = at(k, id);
      if (!o) continue;
      // destino fixo (o ponto +0x9c); a fuga de Wimpy/Withdraw (0x57377d) recalcula o ponto a cada pensamento
      if (flee(o) && !flee(k > 0 ? at(k - 1, id) : undefined) && flee(at(k + 1, id)) && flee(at(k + 2, id))
        && at(k + 1, id).dest === o.dest && at(k + 2, id).dest === o.dest) {
        const s1 = steps[k]!, s0 = k > 0 ? steps[k - 1]! : s1 - 16;
        let first = s1;
        for (const s of oSteps) { if (s <= s0 || s > s1) continue; const u = orig.get(s)!.find(x => x.id === id); if (u && u.mode === 1) { first = s; break; } }
        stamp = (states.get(s1) as Any).tick - Math.ceil((s1 - first) / 16); stampStep = s1;
      }
      if (stamp !== undefined && steps[k]! - stampStep <= 30 * 16) o.unreach_sec = stamp;
    }
  }
}

/** Unidade no modo 0xb girando (ação 1) no estado exportado: o giro do olhar em volta acaba no tique e e ela volta a sortear em e + 1
 *  (rngprobe); o traço de 4 em 4 tiques mostra a ação 0 na 1ª amostra s ≥ e + 1 → e ≈ s − 2. Grava `look_wait` (import_state). */
function inferLookWait(states: Map<number, OrigState>, orig: Map<number, OU[]>): void {
  for (const [a, st] of states) {
    for (const o of (st as Any).units as Any[]) {
      if (o.mode !== 11 || o.state !== 1) continue;
      let s = a + 4;
      for (; s <= a + 40; s += 4) { const u = orig.get(s)?.find(x => x.id === o.id); if (!u || u.state !== 1 || u.mode !== 11) break; }
      o.look_wait = Math.max(1, s - a - 2);
    }
  }
}

/** Sorteios gravados do original (rand.json.gz, golden_rerecord.py) → RngReplay (filas por tique/site); null sem gravação. */
function loadReplay(dir: string): RngReplay | null {
  const p = join(dir, "rand.json.gz");
  if (!existsSync(p)) return null;
  return new RngReplay(JSON.parse(gz(p)) as RandRecording);
}

async function runEpisode(gold: string, id: string, show: boolean): Promise<Any> {
  const t0 = Date.now();
  const dir = join(gold, "episodes", id);
  const replay = loadReplay(dir);
  const on = replay ? await runEpisodeMode(gold, id, show, replay) : null;
  const off = await runEpisodeMode(gold, id, show && !replay, null);
  const r = on ?? off;
  const cnt = (x: Any) => ({ windows: x.windows.length, clean: x.windows.filter((w: Any) => !w.div).length });
  r.replay = replay ? { on: cnt(on), off: cnt(off), sites: Object.fromEntries([...replay.stats].map(([k, v]) => [String(k), v])) } : null;
  if (on) r.rng = off.rng;          // sincronia do gerador: só faz sentido sem replay
  r.ms = Date.now() - t0;
  return r;
}

async function runEpisodeMode(gold: string, id: string, show: boolean, replay: RngReplay | null): Promise<Any> {
  const t0 = Date.now();
  const dir = join(gold, "episodes", id);
  const ep = JSON.parse(readFileSync(join(dir, "ep.json"), "utf8"));
  const baseTxt = gz(join(dir, "base.json.gz"));
  const base = JSON.parse(baseTxt) as OrigState;
  const states = new Map<number, OrigState>();
  const stSteps: number[] = [];
  for (const line of gz(join(dir, "states.jsonl.gz")).split("\n")) {
    if (!line.trim()) continue;
    const s = JSON.parse(line) as OrigState;
    states.set(s.step ?? 0, { ...(base as Any), ...(s as Any), mission: base.mission });
    stSteps.push(s.step ?? 0);
  }
  stSteps.sort((a, b) => a - b);
  const orig = new Map<number, OU[]>();
  const origRaw = gz(join(dir, "orig.jsonl.gz")).split("\n").filter(l => l.trim());
  const head = JSON.parse(origRaw[0]!) as { cols: string[] };
  for (const l of origRaw.slice(1)) {
    const f = JSON.parse(l) as { s: number; u: unknown[][] };
    orig.set(f.s, f.u.map(r => Object.fromEntries(head.cols.map((c, k) => [c, r[k]])) as unknown as OU));
  }
  inferUnreach(base, states, stSteps, orig);
  inferLookWait(states, orig);
  const imp = await worldFor(base);
  const hero: number = ep.hero;
  const ticks: number = ep.ticks;
  const typeMiss = new Set<string>();
  const results: Any[] = [];
  const rng = { n: 0, sync: 0, orig: 0, ours: 0, d: [] as [number, number, number][] };
  let todo: [number, number][] = [];
  for (let a = 0; a < ticks; a += WINDOW) todo.push([a, Math.min(a + WINDOW, ticks)]);
  const t16_0: number = ep.t16_0;
  for (let p = 0; p < MAX_PASS && todo.length; p++) {
    // replay: só a 1ª passada conta gravados × consumidos (as seguintes repetem trechos já contados)
    if (replay) replay.counting = p === 0;
    const hook = replay ? (w: Any, win: { start: number; end: number }) => {
      w.rng.replay = replay;
      replay.clock = () => (w.t16base ?? 0) + w.clock16();
      replay.begin(t16_0 + win.start + 1, t16_0 + win.end + 1);
    } : undefined;
    const lines = runWindows(imp, base, states, { actions: ep.script, windows: todo.map(([start, end]) => ({ start, end })), sample: SAMPLE, every: true }, hook);
    const byWin = new Map<number, Any[]>();
    const meta = new Map<number, Any>();
    for (const l of lines) {
      const f = JSON.parse(l) as Any;
      if (f.units) { if (!byWin.has(f.win)) byWin.set(f.win, []); byWin.get(f.win)!.push(f); } else meta.set(f.win, f);
    }
    const nxt: [number, number][] = [];
    // sincronia do rand() (pass 0): sorteios do original e nossos no 1º segundo de cada janela (estado em a e a + 16)
    if (p === 0) todo.forEach(([a], wi) => {
      const s0 = states.get(a), s1 = states.get(a + 16), f1 = (byWin.get(wi) ?? []).find(f => f.step === a + 16);
      if (!s0 || !s1 || !f1) return;
      const no = lcgSteps(s0.rng, s1.rng), nn = lcgSteps(s0.rng, f1.rng);
      rng.n++; if (no === nn) rng.sync++;
      rng.orig += no ?? 0; rng.ours += nn ?? 0;
      rng.d.push([a, no ?? -1, nn ?? -1]);
    });
    todo.forEach(([a, b], wi) => {
      const fr = byWin.get(wi) ?? [];
      const d = compareWindow(orig, fr, a, hero, typeMiss);
      if (d && show) d.rows = context(orig, fr, d);
      // métricas tolerantes (fase 7): ±1 e ±2 tiques de 16/s por campo e só a ordem dos eventos (a passada seguinte segue o estrito)
      const t1 = d ? compareWindowTol(orig, fr, a, hero, 1) : null;
      const t2 = t1 ? compareWindowTol(orig, fr, a, hero, 2) : null;
      const tol: Any = { t1: t1 ? t1.sig : null, t2: t2 ? t2.sig : null, ord: d ? compareOrder(orig, fr, a, b, hero) : true };
      // diagnóstico: GOLDEN_TOLS=4,8,16 grava também essas tolerâncias (tol.x) no JSON da execução
      for (const k of EXTRA_TOLS) tol.x = { ...(tol.x ?? {}), [k]: d ? (compareWindowTol(orig, fr, a, hero, k)?.sig ?? null) : null };
      results.push({ start: a, end: b, pass: p, div: d, tol, apply: meta.get(wi)?.apply ?? null });
      if (d) {
        const e = stSteps.find(s => s >= d.step + 16);
        if (e !== undefined && e < b - 16) nxt.push([e, b]);
      }
    });
    todo = nxt;
  }
  return { id, state: ep.state, seed: ep.seed, ticks, windows: results, typeMiss: [...typeMiss].sort(), rng, ms: Date.now() - t0 };
}

/** Quantos passos do LCG do CRT (`seed × 214013 + 2531011`) levam de `a` a `b` (até 5000; null = mais). */
function lcgSteps(a: number, b: number): number | null {
  let s = a >>> 0;
  for (let n = 0; n <= 5000; n++) { if (s === (b >>> 0)) return n; s = (Math.imul(s, 214013) + 2531011) >>> 0; }
  return null;
}

/** Linhas lado a lado (original × nosso) da unidade divergente em torno da divergência (para `--show`). */
function context(orig: Map<number, OU[]>, frames: Any[], d: Any): Any[] {
  const rows: Any[] = [];
  for (const f of frames) {
    if (!orig.has(f.step) || f.step < d.step - 12 || f.step > d.step + 16) continue;
    const o = orig.get(f.step)?.find(u => u.id === d.unit);
    const n = f.units.find((u: Any) => u.id === d.unit);
    rows.push({ step: f.step, orig: o ? { fx: o.fx, fy: o.fy, hp: o.hp, mana: o.mana, task: o.task, mode: o.mode, target: o.target, state: o.state } : null,
      ours: n ? { fx: n.fx, fy: n.fy, hp: n.hp, mana: n.mana, task: n.task, target: n.target, state: n.state } : null });
  }
  return rows;
}

async function main(): Promise<void> {
  const a = process.argv.slice(2);
  const arg = (k: string) => a[a.indexOf(k) + 1]!;
  const gold = arg("--gold");
  const ids = arg("--ids").split(",").filter(Boolean);
  const show = a.includes("--show");
  for (const id of ids) {
    const r = await runEpisode(gold, id, show);
    process.stdout.write(`@@RESULT ${JSON.stringify(r)}\n`);
  }
}
void main();
