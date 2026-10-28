/**
 * Lado NOSSO do teste diferencial por JANELAS (tools/refcap/diff/run_pair.py; notes/differential-fuzz.md fases 2–3).
 * Cada janela [start, end) (tiques de 16/s do original) é um teste independente: volta ao mundo do tique 0, copia o estado do original
 * exportado em `start` (import_state.applyState), aplica as ações do roteiro desse trecho no mesmo instante (tique do original × TICKS_PER_SEC/16 = 1)
 * e grava quadros a cada `sample` tiques do original (padrão 4 = 5 tiques nossos, mesmo instante nos dois motores).
 *
 *   npx tsx src/sim/test/diff_window.ts --spec spec.json
 * spec = {base: state_t0.json, states: estados.jsonl (uma linha por estado exportado, com `step`), actions: [...], windows: [{start,end}],
 *         sample: 4, out: saída.jsonl}
 * Saída: uma linha por quadro {win, start, step, sec, units: [{id (do original; "n<id>" = só nosso), type, x, y, fx, fy, hp, mana, task,
 * target (id do original), alive}]} e, por janela, {win, start, apply: {missing, dead}}.
 */
import { SERVER_TICKS_PER_SEC, type Unit, type World } from "../world";
import type { Order } from "../types";
import { TICKS_PER_SEC } from "../types";
import { applyState, resetWorld, spawnUnmatched, worldFromState, type Imported, type OrigState } from "./import_state";
import { proc } from "./loader";

const { readFileSync, writeFileSync } = proc.getBuiltinModule("node:fs") as {
  readFileSync(p: string, e: "utf8"): string; writeFileSync(p: string, d: string): void;
};

interface Action { t: number; do: string; unit?: number | string | (number | string)[]; x?: number; y?: number; target?: number | string; spell?: number; }
export interface Spec { base: string; states: string; actions: Action[]; windows: { start: number; end: number }[]; sample?: number; out: string; }

const K = TICKS_PER_SEC / SERVER_TICKS_PER_SEC;

export function orderOf(w: World, a: Action, u: Unit, ref: (v: number | string | undefined) => Unit | undefined): Order | null {
  switch (a.do) {
    case "move": case "pickup": return { type: "move", x: a.x ?? u.cx, y: a.y ?? u.cy };
    case "attack": { const t = ref(a.target); return t ? { type: "attack", target: t.id } : null; }
    // "stop" do roteiro = mensagem 0x18 do cliente (vclock.py) → Stand ground 0x570b8b, a mesma do botão "parado" da interface
    case "stop": return { type: "hold" };
    case "guard": return { type: "guard", x: u.cx, y: u.cy };
    case "cast": {
      if (a.target !== undefined) { const t = ref(a.target); return t ? { type: "cast", spell: String(a.spell), target: t.id } : null; }
      return { type: "cast", spell: String(a.spell), x: a.x ?? u.cx, y: a.y ?? u.cy };
    }
    default: return null;
  }
}

async function main(): Promise<void> {
  const args = proc.argv.slice(2);
  const spec = JSON.parse(readFileSync(args[args.indexOf("--spec") + 1]!, "utf8")) as Spec;
  const base = JSON.parse(readFileSync(spec.base, "utf8")) as OrigState;
  const states = new Map<number, OrigState>();
  for (const line of readFileSync(spec.states, "utf8").split("\n")) if (line.trim()) { const s = JSON.parse(line) as OrigState; states.set(s.step ?? 0, { ...base, ...s, mission: base.mission }); }
  const imp = await worldFromState(base);
  const out = runWindows(imp, base, states, spec);
  writeFileSync(spec.out, out.join("\n") + "\n");
  console.log(`ok: ${spec.windows.length} janelas → ${spec.out}`);
}

/** Núcleo reutilizável (também usado por tools/refcap/diff/golden_worker.mts, corpus dourado): uma linha JSON por quadro/janela. */
export function runWindows(imp: Imported, base: OrigState, states: Map<number, OrigState>, spec: Pick<Spec, "actions" | "windows" | "sample"> & { every?: boolean },
  onWindow?: (w: World, win: { start: number; end: number }, st: OrigState) => void): string[] {
  const sample = spec.sample ?? 4;
  const out: string[] = [];
  spec.windows.forEach((win, wi) => {
    const st = states.get(win.start);
    if (!st) { out.push(JSON.stringify({ win: wi, start: win.start, error: "sem estado exportado" })); return; }
    resetWorld(imp);
    const w = imp.w;
    // invocações/reforços que o original criou depois do tique 0 (Summon do grupo): nascem no nosso mundo na célula do estado
    spawnUnmatched(imp.r, w, st, imp.idmap);
    const res = applyState(w, st, imp.idmap, { spells: imp.r.data.spells as Record<string, unknown> | undefined });
    w.events.length = 0;
    w.rng.replay = null;
    onWindow?.(w, win, st);         // golden: liga o replay dos sorteios do original (rng.ts RngReplay) nesta janela
    const rev = new Map<number, number>([...imp.idmap].map(([o, n]) => [n, o]));
    const heroOrig = base.hero ?? 0;
    const ref = (v: number | string | undefined): Unit | undefined => {
      if (v === undefined) return undefined;
      const o = v === "hero" ? heroOrig : Number(v);
      const n = imp.idmap.get(o);
      return n !== undefined ? w.get(n) : undefined;
    };
    out.push(JSON.stringify({ win: wi, start: win.start, end: win.end, apply: res }));
    let sel: Unit[] = [ref("hero")!].filter(Boolean);
    // magia em curso no original (tarefa 0xd) no início da janela: repete a última ordem de magia do roteiro (o estado não diz qual)
    const hs = st.units.find(o => o.id === heroOrig);
    const lastCast = [...spec.actions].filter(a => a.t < win.start && (a.do === "cast" || a.do === "attack" || a.do === "move" || a.do === "stop")).pop();
    // 0xd = magia na unidade, 0xe = magia no PONTO (andando até o alcance, modo 9): as duas são retomadas (GRUPO-ALAVANCAS: o herói a caminho
    // de lançar Fireball/Blizzard no começo da janela ficava ocioso no nosso lado)
    if (hs && (hs.task === 0xd || hs.task === 0xe) && lastCast?.do === "cast" && sel[0]) { const o = orderOf(w, lastCast, sel[0], ref); if (o) { w.command(sel[0], o); sel[0].orderArmed = hs.mode !== 0; } }
    const acts = spec.actions.filter(a => a.t >= win.start && a.t < win.end).sort((a, b) => a.t - b.t);
    const frame = (step: number) => {
      const units = [];
      for (const u of w.units) {
        if (u.phased) continue;
        if (!u.alive && u.state !== "dying" && !rev.has(u.id)) continue;
        const tgt = u.order.type === "attack" ? u.order.target : u.order.type === "cast" ? u.order.target ?? 0 : 0;
        units.push({ id: rev.get(u.id) ?? `n${u.id}`, type: u.typeId, x: u.cx, y: u.cy, fx: Math.round(u.x * 256) / 256, fy: Math.round(u.y * 256) / 256,
          hp: u.hp, mana: u.mana, task: u.order.type, ai: u.ai?.type ?? "", target: tgt ? rev.get(tgt) ?? -tgt : 0, alive: u.alive, state: u.state,
          armed: u.orderArmed });
      }
      out.push(JSON.stringify({ win: wi, start: win.start, step, sec: step / SERVER_TICKS_PER_SEC, rng: w.rng.state >>> 0, units }));
    };
    frame(win.start);
    const n = Math.round((win.end - win.start) * K);
    let ai = 0;
    for (let i = 0; i < n; i++) {
      // ações do roteiro no mesmo instante do original (o original aplica antes do tique `t`)
      while (ai < acts.length && Math.round((acts[ai]!.t - win.start) * K) <= i) {
        const a = acts[ai++]!;
        const us = Array.isArray(a.unit) ? a.unit.map(ref) : a.unit !== undefined ? [ref(a.unit)] : sel;
        const list = us.filter((u): u is Unit => !!u && u.alive);
        if (a.do === "select") { sel = list; continue; }
        for (const u of list) { const o = orderOf(w, a, u, ref); if (o) w.command(u, o); }
      }
      w.step();
      imp.r.b.runtime?.update(1 / TICKS_PER_SEC);
      w.events.length = 0;
      const step = win.start + (i + 1) / K;
      // `every` (golden, métrica tolerante): quadro em TODO tique nosso (passo fracionário do original); a comparação estrita só usa os
      // quadros com passo inteiro presentes no traço do original
      if (spec.every || (Number.isInteger(step) && (step - win.start) % sample === 0)) frame(step);
    }
  });
  return out;
}

if (proc.argv.includes("--spec")) void main();
