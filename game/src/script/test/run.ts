/**
 * Testes do motor de script (sem navegador).  Rodar em game/:   npx tsx src/script/test/run.ts   (ou npm run test:script)
 *
 * Fonte dos scripts: game/public/data/scripts/<n>.json (MAPAS-RE) se existir; senão as fixtures geradas por
 * tools/script_export_basic.py em src/script/test/fixtures/. `--fixtures` força as fixtures; `--official` exige o oficial.
 */
import { parseScript } from "../loader";
import { ScriptRuntime, type ScriptEvent } from "../runtime";
import { HERO_UNIT_ID } from "../host";
import type { Script } from "../types";
import { FakeWorld } from "./fakeHost";

// Node sem @types/node (o projeto é para navegador): módulos nativos via process.getBuiltinModule (Node >= 20.16).
interface NodeProc {
  argv: string[];
  exitCode?: number;
  getBuiltinModule(name: string): unknown;
}
const proc = (globalThis as unknown as { process: NodeProc }).process;
const { existsSync, readFileSync, readdirSync } = proc.getBuiltinModule("node:fs") as {
  existsSync(p: string): boolean; readFileSync(p: string, enc: "utf8"): string; readdirSync(p: string): string[];
};
const { dirname, join } = proc.getBuiltinModule("node:path") as { dirname(p: string): string; join(...p: string[]): string };
const { fileURLToPath } = proc.getBuiltinModule("node:url") as { fileURLToPath(u: string): string };

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "fixtures");
const OFFICIAL = join(HERE, "..", "..", "..", "public", "data", "scripts");
const argv = proc.argv.slice(2);
const MODE = argv.includes("--fixtures") ? "fixtures" : argv.includes("--official") ? "official" : "auto";

let failures = 0;
let passes = 0;

function check(cond: unknown, msg: string): void {
  if (cond) passes++;
  else {
    failures++;
    console.log(`  FALHOU: ${msg}`);
  }
}

function eq<T>(a: T, b: T, msg: string): void {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  check(ok, ok ? msg : `${msg}\n     obtido:   ${JSON.stringify(a)}\n     esperado: ${JSON.stringify(b)}`);
}

function test(name: string, fn: () => void): void {
  const before = failures;
  try {
    fn();
  } catch (e) {
    failures++;
    console.log(`  EXCEÇÃO: ${(e as Error).stack ?? e}`);
  }
  console.log(`${failures === before ? "ok  " : "ERRO"} ${name}`);
}

function sourceFor(n: number | string): { path: string; kind: string } {
  const off = join(OFFICIAL, `${n}.json`);
  if (MODE !== "fixtures" && existsSync(off)) return { path: off, kind: "oficial (MAPAS-RE)" };
  if (MODE === "official") throw new Error(`sem ${off}`);
  return { path: join(FIXTURES, `${n}.json`), kind: "fixture (script_export_basic.py)" };
}

function load(n: number | string): Script {
  return parseScript(JSON.parse(readFileSync(sourceFor(n).path, "utf8")));
}

function missionIds(): string[] {
  const dir = MODE === "fixtures" || !existsSync(OFFICIAL) ? FIXTURES : OFFICIAL;
  const ids = readdirSync(dir).filter(f => /^\d+\.json$/.test(f)).map(f => f.replace(".json", ""));
  return ids.sort((a, b) => Number(a) - Number(b));
}

/** Nomes das ações executadas (na ordem). */
function actionNames(h: ScriptEvent[]): string[] {
  return h.filter(e => e.type === "action").map(e => (e as { action: string }).action);
}

// ============================================================================================ missão 10

test("missão 10: ordem das mensagens/ações num passeio completo", () => {
  const script = load(10);
  console.log(`     fonte: ${sourceFor(10).kind}; ${script.triggers.length} gatilhos, avisos: ${script.warnings.length}`);
  const world = new FakeWorld(script);
  const rt = new ScriptRuntime(script, world.fullHost());
  const drop = rt.dropLocation;
  eq(drop, { x: 11, y: 41 }, "Drop Location = (11,41)");
  world.add({ id: HERO_UNIT_ID, x: drop!.x + 0.5, y: drop!.y + 0.5, player: 1 });
  const troll4 = world.units.get(23);
  check(troll4 && troll4.player === 5, "unit#23 = 4º troll (jogador 5)");
  if (troll4) troll4.hp = 1229;
  const steps: string[] = [];
  const step = (label: string, fn?: () => void, seconds = 1) => {
    fn?.();
    const before = rt.history.length;
    rt.update(seconds);
    const acts = actionNames(rt.history.slice(before));
    steps.push(`${label}: ${acts.join(" | ") || "-"}`);
    return acts;
  };

  eq(step("início", undefined, 0), ["Send message 1 - start", "Sub2+ (find skrakan)"], "Start: msg 1 + Sub2+");
  eq(step("parado"), [], "Start não repete");
  eq(step("perto do ogro", () => world.move(HERO_UNIT_ID, 35.5, 68.5)), ["Send message 4 - ogre first", "v70++"], "Come to ogre first time");
  eq(rt.getVariable(70), 1, "v70 = 1");
  eq(step("continua perto"), [], "não repete enquanto perto");
  eq(step("se afasta", () => world.move(HERO_UNIT_ID, 28.5, 68.5)), ["v70++"], "Go away from ogre");
  eq(step("volta", () => world.move(HERO_UNIT_ID, 36.5, 67.5)), ["Send message 5 - ogre attacks", "v70++", "Make ogre angry"], "Ogre annoyed");
  eq(world.dip(7, 1), 1, "ogro (7) em guerra com o jogador");
  eq(step("ogro morre", () => world.killGroup(3)), ["Send message 6 - ogre dead"], "Ogre is dead");
  eq(step("perto do 4º troll", () => world.move(HERO_UNIT_ID, 45.5, 13.5)), ["Send message 2 - troll challenges", "v71++"], "Troll's Challenge");
  eq(step("arena", () => world.move(HERO_UNIT_ID, 62.5, 17.5)),
    ["Make 4th troll angry", "v71++", "Send message 9 - passage", "Sub1+"], "Challenge starts");
  eq(world.dip(5, 1), 1, "4º troll hostil");
  eq(step("1º troll morre", () => world.killGroup(11)),
    ["v71++", "Make 4th troll neutral", "Send message 10 - troll1 dead", "Sub1 - ok", "Make us netral to 4th troll"],
    "Challenge winned + Challenge winned-2");
  eq([world.dip(5, 1), world.dip(1, 5)], [0, 0], "paz com o 4º troll nas duas direções");
  eq(step("volta ao 4º troll", () => world.move(HERO_UNIT_ID, 45.5, 13.5)),
    ["Send message 3 - challenge complete", "v71++", "Troll gives money"], "4th troll gives prize");
  eq(world.moneyOf.get(1), 700, "700 de ouro");
  eq(step("fica perto do troll", undefined, 3), [], "prêmio não repete");
  eq(step("chega a Skrakan", () => world.move(HERO_UNIT_ID, 62.5, 36.5)),
    ["Send message 8 - skrakan", "Skrakan gives quest documents", "Force \"Mission Complete\" state", "Sub2! (find skrakan)"],
    "Near Skrakan");
  eq(world.outcome, "complete", "missão cumprida");
  eq(rt.outcome, { result: "complete" }, "runtime registra o desfecho");
  eq(world.messages, [1, 4, 5, 6, 2, 9, 10, 3, 8], "sequência de mensagens");
  eq([...rt.subobjectives], [[2, 2], [1, 2]], "subobjetivos finais");
  check(world.commands.some(c => c.name === "giveAll" && JSON.stringify(c.args) === JSON.stringify([32, HERO_UNIT_ID])), "Give All(32 -> herói)");
  eq(rt.firedCount("Ensure Skrakans friendship"), 0, "Skrakan continua amigo (sem falha 5)");
  eq(rt.firedCount("Trolls defense"), 0, "Trolls defense: vida 1229 não é < 1229");
  eq(rt.firedCount("Dragon near hero"), 0, "dragão longe");
  step("mais ciclos", undefined, 10);
  eq(world.commands.filter(c => c.name === "missionComplete").length, 1, "missionComplete chamado uma vez");
  if (failures) console.log(steps.map(s => "     " + s).join("\n"));
});

test("missão 10: Skrakan hostil -> Fail 5", () => {
  const script = load(10);
  const world = new FakeWorld(script);
  world.add({ id: HERO_UNIT_ID, x: 11.5, y: 41.5 });
  const rt = new ScriptRuntime(script, world.fullHost());
  rt.update(0);
  world.diplomacyTable.set("8,1", 1);
  rt.update(1);
  eq(world.outcome, "fail:5", "falha com causa 5");
  world.diplomacyTable.set("8,1", 0);
  world.move(HERO_UNIT_ID, 62.5, 36.5);
  rt.update(1);
  eq(world.outcome, "fail:5", "complete depois da falha é ignorado");
  eq(rt.outcome, { result: "fail", cause: 5 }, "desfecho continua falha");
});

test("missão 10: dragão fora de fase não conta distância", () => {
  const script = load(10);
  const world = new FakeWorld(script);
  world.add({ id: HERO_UNIT_ID, x: 66.5, y: 68.5 });
  world.units.get(36)!.phased = true;
  const rt = new ScriptRuntime(script, world.fullHost());
  rt.update(0);
  eq(rt.firedCount("Dragon near hero"), 0, "dragão fora de fase: sem disparo");
  world.units.get(36)!.phased = false;
  rt.update(1);
  eq(rt.firedCount("Dragon near hero"), 1, "dragão de volta: dispara");
});

test("snapshot/restore", () => {
  const script = load(10);
  const world = new FakeWorld(script);
  world.add({ id: HERO_UNIT_ID, x: 35.5, y: 68.5 });
  const rt = new ScriptRuntime(script, world.fullHost());
  rt.update(0);
  const snap = JSON.parse(JSON.stringify(rt.snapshot()));
  const world2 = new FakeWorld(script);
  world2.add({ id: HERO_UNIT_ID, x: 35.5, y: 68.5 });
  const rt2 = new ScriptRuntime(script, world2.fullHost());
  rt2.restore(snap);
  rt2.update(1);
  eq(world2.messages, [], "restaurado: Start e 'ogre first' não repetem");
  eq(rt2.getVariable(70), 1, "v70 restaurado");
});

// ============================================================================================ semântica sintética

function synthetic(triggers: object[], values: object[], actions: object[]): Script {
  return parseScript({ mission: 0, values, actions, triggers });
}
const K = (seq: number, value: number) => ({ seq, name: String(value), kind: 65538, params: [{ label: "Value", type: "int", value }] });
const V = (seq: number, n: number) => ({ seq, name: `v${n}`, kind: 19, params: [{ label: "Variable", type: "int", value: n }] });
const INC = (seq: number, n: number) => ({ seq, name: `v${n}++`, kind: 8, params: [{ label: "Variable", type: "int", value: n }] });
const MSG = (seq: number, n: number) => ({ seq, name: `msg ${n}`, kind: 2, params: [{ label: "Message number", type: "int", value: n }] });
function raw(conds: [number, number, number][], acts: number[], once: boolean): number[] {
  const w = new Array(46).fill(0);
  conds.forEach(([a, b, op], k) => { w[32 + 2 * k] = a; w[33 + 2 * k] = b; w[42 + k] = op; });
  acts.forEach((s, k) => { w[38 + k] = s; });
  w[45] = once ? 1 : 0;
  return w;
}

test("gatilho repetível (Run Once desligado) conta a cada ciclo; códigos de operador do editor", () => {
  // "Counter: v71 < 5 -> v71++" (repetível) e "Conter ok: v71 >= 5 -> msg 5" (uma vez), como na missão 71
  const values = [V(1, 71), K(2, 5)];
  const actions = [INC(1, 71), MSG(2, 5)];
  const triggers = [
    { name: "Counter", conditions: [{ a: 1, b: 2, op: "?" }], actions: [1], raw: raw([[1, 2, 3]], [1], false) },
    { name: "Conter ok", conditions: [{ a: 1, b: 2, op: "?" }], actions: [2], raw: raw([[1, 2, 4]], [2], true) },
  ];
  const s = synthetic(triggers, values, actions);
  eq(s.triggers.map(t => [t.once, t.conditions[0]?.op]), [[false, "<"], [true, ">="]], "raw: once=w45, op 3 '<', op 4 '>='");
  const world = new FakeWorld();
  const rt = new ScriptRuntime(s, world.fullHost());
  rt.update(0);
  for (let i = 0; i < 9; i++) rt.update(1);
  eq(rt.getVariable(71), 5, "contador para em 5");
  eq(world.messages, [5], "msg 5 uma vez, quando o contador chega a 5");
  eq(rt.cycle, 10, "10 ciclos em 9 s (o primeiro em t=0)");
});

test("opCode tem prioridade; período mínimo; limite de ações", () => {
  const values = [K(1, 0), K(2, 0)];
  const actions = [MSG(1, 1)];
  const s = synthetic([
    { name: "a cada 3 s", conditions: [{ a: 1, b: 2, op: "!=", opCode: 0 }], actions: [1], once: false, period: 3 },
  ], values, actions);
  eq(s.triggers[0]!.conditions[0]!.op, "==", "opCode 0 vence a string '!='");
  const world = new FakeWorld();
  const rt = new ScriptRuntime(s, world.fullHost());
  rt.update(0);
  for (let i = 0; i < 9; i++) rt.update(1);
  eq(world.messages.length, 4, "período 3 s em 9 s: t=0,3,6,9");
  const many = synthetic(
    Array.from({ length: 20 }, (_, i) => ({ name: `t${i}`, conditions: [{ a: 1, b: 2, op: "==" }], actions: [1, 1, 1, 1], once: false })),
    values, actions);
  const w2 = new FakeWorld();
  const rt2 = new ScriptRuntime(many, w2.fullHost(), { maxActionsPerCycle: 10 });
  rt2.update(0);
  eq(w2.messages.length, 10, "limite de 10 ações por ciclo");
  check(w2.logs.some(l => l.includes("limite")), "aviso de limite registrado");
});

test("validador: referência quebrada desativa o gatilho com aviso", () => {
  const s = synthetic([{ name: "quebrado", conditions: [{ a: 99, b: 1, op: "==" }], actions: [1] }], [K(1, 0)], [MSG(1, 1)]);
  eq(s.triggers[0]!.enabled, false, "desativado");
  check(s.warnings.length === 1, "1 aviso");
  let threw = false;
  try { parseScript({ values: [] }); } catch { threw = true; }
  check(threw, "JSON sem 'actions'/'triggers' lança ScriptFormatError");
});

// ============================================================================================ fumaça (46 missões)

test("fumaça: todas as missões carregam, validam e rodam 60 ciclos (host completo e mínimo)", () => {
  const ids = missionIds();
  console.log(`     ${ids.length} scripts (${sourceFor(ids[0]!).kind})`);
  check(ids.length === 46, `46 missões (encontradas ${ids.length})`);
  let totalWarn = 0, totalFired = 0, outcomes = 0;
  const unhandled = new Map<string, number>();
  for (const id of ids) {
    const script = load(id);
    totalWarn += script.warnings.length;
    for (const variant of ["full", "minimal"] as const) {
      const world = new FakeWorld(script);
      const hero = world.add({ id: HERO_UNIT_ID, x: 10.5, y: 10.5 });
      world.add({ id: 10002, x: 11.5, y: 10.5 });
      world.add({ id: 10003, x: 12.5, y: 10.5 });
      const rt = new ScriptRuntime(script, variant === "full" ? world.fullHost() : world.minimalHost());
      const drop = rt.dropLocation;
      if (drop) { hero.x = drop.x + 0.5; hero.y = drop.y + 0.5; }
      // passeio determinístico: o herói visita cada unidade do mapa; grupos morrem aos poucos
      let seed = Number(id) * 7919;
      const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
      const targets = script.units;
      rt.update(0);
      for (let c = 0; c < 60; c++) {
        const t = targets.length ? targets[Math.floor(rnd() * targets.length)]! : null;
        if (t) world.move(HERO_UNIT_ID, (t.x ?? 0) + 1.5, (t.y ?? 0) + 0.5);
        if (rnd() < 0.1 && script.groups.length) world.killGroup(script.groups[Math.floor(rnd() * script.groups.length)]!.id);
        rt.update(1);
      }
      if (variant === "full") {
        totalFired += rt.history.filter(e => e.type === "trigger").length;
        if (rt.outcome) outcomes++;
        for (const e of rt.history) if (e.type === "action" && !e.handled) unhandled.set(e.kindName, (unhandled.get(e.kindName) ?? 0) + 1);
      }
    }
  }
  console.log(`     avisos do validador: ${totalWarn}; gatilhos disparados (host completo): ${totalFired}; missões com desfecho: ${outcomes}`);
  if (unhandled.size) console.log(`     ações sem efeito no host completo: ${[...unhandled].map(([k, v]) => `${k}×${v}`).join(", ")}`);
  check(totalFired > 46, "gatilhos disparam");
});

console.log(`\n${passes} verificações ok, ${failures} falhas`);
if (failures) proc.exitCode = 1;
