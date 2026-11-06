/**
 * Lado NOSSO do jogo espelhado (mirror.py): o sim sem janela, como biblioteca (simcore.mts), falando JSON por linha em stdin/stdout.
 *
 *   → {"cmd":"init", "base": <estado do tique 0 com terrain_speed e livro>, "st0": <estado normalizado do tique 0 + exe>, "force"?: {"t","unit"}}
 *   ← {"ok":true, "units":n, "matched":n, "lost":n}
 *   → {"cmd":"tick", "t":k, "acts":[ações do roteiro], "st": <estado do original depois do tique k>}
 *   ← {"t":k, "diffs":[[chave, original, nosso], ...], "ours": {id: resumo} (só das unidades divergentes), "gold":n, "msgs":[...]}
 *   → {"cmd":"dump", "path": arq}     grava os últimos quadros nossos (visão plana por tique) em JSONL
 *   → {"cmd":"reinit", "st0": ...}     reimporta o estado atual do original (seguir depois de uma divergência)
 *
 * `force` = divergência forçada para testar a pausa: no tique t a vida da unidade `unit` (id do original) cai 1 no nosso mundo.
 */
import { createInterface } from "node:readline";
import { writeFileSync } from "node:fs";
import type { OrigState } from "../../../game/src/sim/test/import_state";
import { compare, ourUnit, prepState, simFromImport, step, type Action, type Sim } from "./simcore.mts";
import { unitOf, viewOurs } from "../diff/tick_compare.mts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const KEEP = 160;
let sim: Sim | null = null;
let base: OrigState | null = null;
let force: { t: number; unit: number } | null = null;
let bookOf = new Map<number, Any>();
const ring: string[] = [];

// o sim escreve avisos no console: stdout é do protocolo, então tudo o que não for resposta vai para stderr
const out = (o: unknown): void => { process.stdout.write(JSON.stringify(o) + "\n"); };
console.log = (...a: unknown[]) => process.stderr.write(a.map(String).join(" ") + "\n");
console.warn = console.log;
console.info = console.log;

async function init(m: Any): Promise<void> {
  if (m.base) {
    base = m.base as OrigState;
    bookOf = new Map((base.units as Any[]).map(u => [u.id, u.book ?? []]));
    prepState(base, bookOf);
  }
  const st0 = prepState(m.st0, bookOf);
  sim = await simFromImport(base!, st0);
  if (m.force) force = m.force;
  if (m.T0) sim.T = m.T0;
  out({ ok: true, units: st0.units.length, matched: sim.idmap.size, lost: sim.lost.size, T: sim.T });
}

function tick(m: Any): void {
  const s = sim!;
  const st = prepState(m.st, bookOf);
  step(s, (m.acts ?? []) as Action[]);
  if (force && force.t === m.t) {
    const n = s.idmap.get(force.unit), u = n !== undefined ? s.w.get(n) : undefined;
    if (u) u.hp -= 1;
  }
  const diffs = compare(s, st);
  const rev = new Map([...s.idmap].map(([o, n]) => [n, o]));
  const view = viewOurs(s.w, st, st, s.idmap, rev);
  ring.push(JSON.stringify({ t: m.t, ours: Object.fromEntries(view) }));
  if (ring.length > KEEP) ring.shift();
  const ours: Record<string, unknown> = {};
  for (const d of diffs) { const u = unitOf(d.key).split(":")[0]!.split(",")[0]!; if (/^\d+$/.test(u) && !(u in ours)) ours[u] = ourUnit(s, Number(u)); }
  out({ t: m.t, diffs: diffs.map(d => [d.key, d.orig ?? null, d.ours ?? null]), ours, gold: s.gold(), msgs: s.messages().length });
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
let queue = Promise.resolve();
rl.on("line", line => {
  queue = queue.then(async () => {
    if (!line.trim()) return;
    let m: Any;
    try { m = JSON.parse(line); } catch (e) { out({ error: `JSON: ${e}` }); return; }
    try {
      if (m.cmd === "init" || m.cmd === "reinit") await init(m);
      else if (m.cmd === "tick") tick(m);
      else if (m.cmd === "dump") { writeFileSync(m.path, ring.join("\n") + "\n"); out({ ok: true, n: ring.length }); }
      else if (m.cmd === "quit") process.exit(0);
      else out({ error: `comando desconhecido ${m.cmd}` });
    } catch (e) {
      out({ error: String((e as Error)?.stack ?? e) });
    }
  });
});
rl.on("close", () => { void queue.then(() => process.exit(0)); });
