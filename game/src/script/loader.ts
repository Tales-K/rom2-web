/**
 * Carregador/validador do JSON de script (`data/scripts/<missão>.json`).
 *
 * `parseScript(json)` aceita o objeto já decodificado (qualquer `unknown`), valida a estrutura mínima e devolve a forma
 * normalizada `Script`. Erros estruturais lançam `ScriptFormatError`; problemas recuperáveis (referência a valor/ação
 * inexistente, tipo desconhecido, operador estranho) viram `script.warnings` e o elemento é neutralizado.
 *
 * Regras de normalização (ver docs/SCRIPT_HOST.md, "Semântica"):
 * - operador: `opCode` (0..5) > código cru em `raw[42+k]` > string `op`; códigos na ordem do diálogo do editor
 *   ("==", "!=", ">", "<", ">=", "<=");
 * - `once`: campo `once` (boolean) > `raw[45] === 1` ("Run Once") > padrão `true`;
 * - `enabled`: todos os gatilhos ficam ativos — no .alm não há flag de ativação conhecida (o dword 45, que tools/alm.py
 *   chamava de `enabled`, é a caixa "Run Once"). `options.honorEnabled` respeita `enabled: false` explícito.
 */
import {
  OP_CODES, InstantKind,
  type CompareOp, type Script, type ScriptCondition, type ScriptParam, type ScriptRecord, type ScriptTrigger,
  type ScriptGroupJson, type ScriptUnitJson,
} from "./types";
import { HERO_UNIT_ID } from "./host";

export class ScriptFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScriptFormatError";
  }
}

export interface ParseOptions {
  /** respeitar `enabled: false` explícito no JSON (padrão: false — ver cabeçalho) */
  honorEnabled?: boolean;
  /** confiar na string `op` mesmo quando há `raw` (padrão: false) */
  trustOpStrings?: boolean;
}

const PARAM_TYPE_NAMES: Record<number, string> = { 0: "none", 1: "int", 2: "group", 3: "player", 4: "unit", 5: "x", 6: "y", 7: "const" };

/** Gatilhos do original com referência a valor inexistente (-1 = 0xFFFFFFFF) e o valor que eles queriam: missão 42 "final metamorph"
 *  (Hero to Magician 1 <= 4 e metamorph 3 → entrega o 4; sem isso a missão não termina). */
const BROKEN_REF_FIXES: Record<string, string> = { "Magician1 to Hero final metamorph": "Hero to Magician 1" };

const OP_ALIASES: Record<string, CompareOp> = {
  "==": "==", "=": "==", "!=": "!=", "<>": "!=", ">": ">", "<": "<", ">=": ">=", "<=": "<=",
};

const GROUP_COMMAND_NAMES: Record<number, string> = {
  1: "Guard", 2: "Swarm", 3: "Stand Ground", 4: "Move", 5: "Swarm 2", 10: "Attack", 11: "Defend", 14: "Patrol",
  15: "Follow", 17: "Roam", 18: "Dwell",
};

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function num(x: unknown, fallback = 0): number {
  return typeof x === "number" && Number.isFinite(x) ? x : (typeof x === "boolean" ? (x ? 1 : 0) : fallback);
}

function parseRecord(r: unknown, where: string, isAction: boolean, warnings: string[]): ScriptRecord | null {
  if (!isObj(r)) {
    warnings.push(`${where}: registro não é objeto`);
    return null;
  }
  const seq = num(r.seq, NaN);
  if (!Number.isFinite(seq)) {
    warnings.push(`${where}: sem seq`);
    return null;
  }
  const kind = num(r.kind, -1);
  const params: ScriptParam[] = [];
  if (Array.isArray(r.params)) {
    for (const p of r.params) {
      if (!isObj(p)) continue;
      const t = typeof p.type === "number" ? (PARAM_TYPE_NAMES[p.type] ?? `t${p.type}`) : String(p.type ?? "int");
      const param: ScriptParam = { label: String(p.label ?? ""), type: t, value: num(p.value) };
      if (typeof p.slot === "number") param.slot = p.slot;
      params.push(param);
    }
  }
  // comando de grupo: o grupo-alvo (Par9) pode vir como campo do registro em vez de parâmetro
  if (isAction && kind === InstantKind.GroupCommand && !params.some(p => p.type === "group")) {
    const g = num(r.group ?? r.targetGroup, 0);
    if (g) params.push({ label: "Group", type: "group", value: g, slot: 9 });
  }
  let kindName = typeof r.kindName === "string" ? r.kindName : "";
  if (isAction && kind === InstantKind.GroupCommand) {
    const c = params[0]?.value ?? -1;
    kindName = "Group Command : " + (GROUP_COMMAND_NAMES[c] ?? `const ${c}`);
  }
  return { seq, name: String(r.name ?? `#${seq}`), kind, kindName: kindName || `kind ${kind}`, params };
}

function opFrom(code: unknown): CompareOp | null {
  return typeof code === "number" && code >= 0 && code < OP_CODES.length ? OP_CODES[code]! : null;
}

export function parseScript(json: unknown, options: ParseOptions = {}): Script {
  if (!isObj(json)) throw new ScriptFormatError("script: JSON não é objeto");
  for (const k of ["values", "actions", "triggers"]) {
    if (!Array.isArray(json[k])) throw new ScriptFormatError(`script: campo "${k}" ausente ou não é lista`);
  }
  const warnings: string[] = [];
  const mission = num(json.mission, 0);

  const valueList: ScriptRecord[] = [];
  const actionList: ScriptRecord[] = [];
  (json.values as unknown[]).forEach((r, i) => {
    const rec = parseRecord(r, `values[${i}]`, false, warnings);
    if (rec) valueList.push(rec);
  });
  (json.actions as unknown[]).forEach((r, i) => {
    const rec = parseRecord(r, `actions[${i}]`, true, warnings);
    if (rec) actionList.push(rec);
  });
  const values = new Map<number, ScriptRecord>();
  const actions = new Map<number, ScriptRecord>();
  for (const v of valueList) {
    if (values.has(v.seq)) warnings.push(`valor seq ${v.seq} duplicado ("${v.name}")`);
    values.set(v.seq, v);
  }
  for (const a of actionList) {
    if (actions.has(a.seq)) warnings.push(`ação seq ${a.seq} duplicada ("${a.name}")`);
    actions.set(a.seq, a);
  }

  const triggers: ScriptTrigger[] = [];
  (json.triggers as unknown[]).forEach((t, index) => {
    if (!isObj(t)) {
      warnings.push(`triggers[${index}]: não é objeto`);
      return;
    }
    const name = String(t.name ?? `trigger ${index}`);
    const raw = Array.isArray(t.raw) && t.raw.length === 46 ? (t.raw as unknown[]).map(x => num(x)) : null;
    // condições do registro cru: slots k = 0..2, a = raw[32+2k], b = raw[33+2k], op = raw[42+k]
    const rawConds = raw ? [0, 1, 2].filter(k => raw[32 + 2 * k]).map(k => ({ a: raw[32 + 2 * k]!, b: raw[33 + 2 * k]!, code: raw[42 + k]!, used: false })) : [];
    const conditions: ScriptCondition[] = [];
    let broken = false;
    const condList = Array.isArray(t.conditions) ? t.conditions : [];
    for (const c of condList) {
      if (!isObj(c)) continue;
      let a = num(c.a, 0);
      const b = num(c.b, 0);
      // referência quebrada do original (valor apagado no editor): a intenção é inequívoca pelo nome do gatilho (docs/GAPS.md)
      if (!values.has(a)) {
        const fix = BROKEN_REF_FIXES[name];
        const target = fix ? valueList.find(v => v.name === fix) : undefined;
        if (target) a = target.seq;
      }
      let op: CompareOp | null = opFrom(c.opCode);
      if (!op && raw && !options.trustOpStrings) {
        const m = rawConds.find(rc => !rc.used && rc.a === a && rc.b === b);
        if (m) {
          m.used = true;
          op = opFrom(m.code);
        }
      }
      if (!op) op = OP_ALIASES[String(c.op ?? "")] ?? null;
      if (!op) {
        warnings.push(`gatilho "${name}": operador desconhecido ${JSON.stringify(c.op)}; condição considerada falsa`);
        broken = true;
        continue;
      }
      if (!values.has(a) || !values.has(b)) {
        warnings.push(`gatilho "${name}": condição referencia valor inexistente (${a} ${op} ${b}); gatilho nunca dispara`);
        broken = true;
        continue;
      }
      conditions.push({ a, b, op });
    }
    const acts: number[] = [];
    for (const x of Array.isArray(t.actions) ? t.actions : []) {
      const s = num(x, 0);
      if (!s) continue;
      if (!actions.has(s)) warnings.push(`gatilho "${name}": ação seq ${s} inexistente (ignorada)`);
      else acts.push(s);
    }
    let once = true;
    if (typeof t.once === "boolean") once = t.once;
    else if (raw) once = raw[45] === 1;
    let enabled = true;
    if (options.honorEnabled && t.enabled === false) enabled = false;
    if (broken) enabled = false;
    if (conditions.length === 0 && !broken) {
      // sem condição: no editor o gatilho fica "IF (nada)"; tratamos como sempre verdadeiro (igual a FALSE == FALSE)
      warnings.push(`gatilho "${name}": sem condições (tratado como sempre verdadeiro)`);
    }
    const period = Math.max(0, num(t.period, 0));
    triggers.push({ index, name, enabled, once, period, conditions, actions: acts });
  });

  const units: ScriptUnitJson[] = Array.isArray(json.units) ? (json.units as unknown[]).filter(isObj).map(u => ({
    ...u, index: num(u.index, -1), id: num(u.id, -1), group: u.group == null ? null : num(u.group), kind: num(u.kind), player: num(u.player),
  })) : [];
  const groups: ScriptGroupJson[] = Array.isArray(json.groups) ? (json.groups as unknown[]).filter(isObj).map(g => ({
    id: num(g.id, -1), ...(typeof g.name === "string" ? { name: g.name } : {}),
    units: Array.isArray(g.units) ? (g.units as unknown[]).map(x => num(x, -1)) : [],
  })) : [];
  const players = Array.isArray(json.players) ? (json.players as unknown[]).filter(isObj).map(p => ({ index: num(p.index), name: String(p.name ?? "") })) : [];

  return {
    mission, values, actions, valueList, actionList, triggers, units, groups,
    heroUnitId: num(json.heroUnitId, HERO_UNIT_ID), players, warnings,
  };
}

/** Busca e analisa `data/scripts/<missão>.json` (caminho relativo a `public/`). */
export async function fetchScript(mission: number | string, base = "", options?: ParseOptions): Promise<Script> {
  const url = `${base}data/scripts/${mission}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new ScriptFormatError(`script: ${url} -> HTTP ${res.status}`);
  return parseScript(await res.json(), options);
}
