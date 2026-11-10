/** Comparador janela a janela do corpus dourado: port literal de tools/refcap/diff/run_pair.py `compare_window` (estrito) + as métricas
 *  TOLERANTES da fase 7 (`compareWindowTol`: ±k tiques de 16/s por campo; `compareOrder`: só a ordem dos eventos). */
export const SAMPLE = 4;
const TASK_ORIG: Record<number, string> = { 1: "move", 10: "move", 3: "attack", 8: "cast", 0xD: "cast", 0xE: "cast", 11: "idle", 12: "idle", 0: "idle", 0x17: "idle", 16: "dead" };
const TASK_OURS: Record<string, string> = { move: "move", attack: "attack", cast: "cast", none: "idle", guard: "idle", hold: "idle", still: "idle",
  follow: "move", retreat: "move", patrol: "move", roam: "idle", defend: "idle", pickup: "move" };

export interface OU { id: number; type: number; state: number; hp: number; mana: number; fx: number; fy: number; target: number; mode: number; task: number }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
type Found = [string, number | string, string, string, unknown, unknown];
const ORDER: Record<string, number> = { alive: 0, spawn: 1, target: 2, task: 3, hp: 4, mana: 5, pos: 6 };

/** Diferenças de UM quadro nosso contra a amostra `ou` do original (o corpo do laço de run_pair.compare_window). */
function frameFound(ou: OU[], f: Any, hero: number, typeMiss: Set<string>): Found[] {
  const nu = new Map<number | string, Any>(f.units.map((u: Any) => [u.id, u]));
  const found: Found[] = [];
  for (const o of ou) {
    const i = o.id;
    // id 0 em (0,0): objeto de unidade fora do mapa que o original mantém durante a invocação (Summon) — não é unidade em jogo
    if (i === 0 || (o.fx < 1 && o.fy < 1)) continue;
    const n = nu.get(i);
    const oal = o.state !== 0x10 && o.hp > 0;
    const who = i === hero ? "hero" : `t${o.type}`;
    if (n === undefined) { if (oal) found.push(["spawn", i, who, "orig_only", null, null]); continue; }
    if (n.type !== undefined && n.type !== null && n.type !== o.type && i !== hero) { typeMiss.add(`${i},${o.type},${n.type}`); continue; }
    const nal = !!n.alive && n.hp > 0;
    if (oal !== nal) { found.push(["alive", i, who, !oal ? "orig_dead" : "ours_dead", o.hp, n.hp]); continue; }
    if (!oal) continue;
    const armed = n.armed === undefined || n.armed === null ? true : !!n.armed;
    let ot = (o.mode === 5 || o.mode === 6 || o.mode === 8 || o.task === 8 || o.task === 0xD) ? o.target : 0;
    const nt = (Number.isInteger(n.target) && armed) ? n.target : 0;
    if (n.task === "cast" && (o.task === 0xD || o.state === 13)) ot = nt;
    if (ot !== nt) {
      const kind = (t: number) => (!t ? "none" : (t === hero ? "hero" : "unit"));
      found.push(["target", i, who, `o:${kind(ot)}/n:${kind(nt)}`, ot, nt]);
    }
    if (i === hero && armed) {
      let oc = TASK_ORIG[o.task] ?? `#${o.task}`;
      const nc = TASK_OURS[n.task] ?? n.task;
      if (oc === "idle" && (o.mode === 5 || o.mode === 6) && o.target) oc = "attack";
      if (o.state === 13 && nc === "cast") oc = "cast";
      if (oc !== nc) found.push(["task", i, who, `o:${oc}/n:${nc}`, o.task, n.task]);
    }
    if (Math.abs(o.hp - n.hp) >= 3) found.push(["hp", i, who, n.hp > o.hp ? "ours_higher" : "ours_lower", o.hp, n.hp]);
    if (Math.abs(o.mana - n.mana) >= 3) found.push(["mana", i, who, n.mana > o.mana ? "ours_higher" : "ours_lower", o.mana, n.mana]);
    const d = Math.hypot(o.fx - n.fx, o.fy - n.fy);
    if (d > 0.75) {
      const om = (o.fx % 1 !== 0.5) || (o.fy % 1 !== 0.5);
      found.push(["pos", i, who, `o:${om ? "anda" : "parado"}/n:${n.state === "move" ? "anda" : "parado"}`, [o.fx, o.fy], [n.fx, n.fy]]);
    }
  }
  for (const [i, n] of nu) if (typeof i === "string" && n.alive) found.push(["spawn", i, `t${n.type}`, "ours_only", null, null]);
  return found;
}

/** 1ª divergência persistente (a mesma chave em 2 amostras seguidas do original); `keyOf` decide o que é "a mesma". */
function persist(steps: number[], foundAt: (st: number) => Found[] | null, keyOf: (x: Found) => string): Any | null {
  const streak = new Map<string, number>();
  for (const st of steps) {
    const found = foundAt(st);
    if (!found) continue;
    const keys = new Set<string>();
    for (const fd of found) {
      const k = keyOf(fd);
      keys.add(k);
      streak.set(k, (streak.get(k) ?? 0) + 1);
      if ((streak.get(k) ?? 0) >= 2) {
        const fs = found.filter(x => (streak.get(keyOf(x)) ?? 0) >= 2).sort((x, y) => ORDER[x[0]]! - ORDER[y[0]]!);
        const [field, uid, who, detail, a, b] = fs[0]!;
        return { step: st - SAMPLE, sec: (st - SAMPLE) / 16, field, unit: uid, who, detail, orig: a, ours: b, sig: `${field}|${who}|${detail}`,
          also: fs.slice(1, 4).map(x => `${x[0]}|${x[2]}|${x[3]}`) };
      }
    }
    for (const k of [...streak.keys()]) if (!keys.has(k)) streak.set(k, 0);
  }
  return null;
}

/** Port literal de run_pair.compare_window (só os quadros nossos com passo inteiro presente no traço do original). */
export function compareWindow(orig: Map<number, OU[]>, ours: Any[], start: number, hero: number, typeMiss: Set<string>): Any | null {
  const at = new Map<number, Any>();
  const steps: number[] = [];
  for (const f of ours) if (f.step > start && orig.has(f.step) && !at.has(f.step)) { at.set(f.step, f); steps.push(f.step); }
  return persist(steps, st => frameFound(orig.get(st)!, at.get(st), hero, typeMiss), fd => fd.slice(0, 4).join("\u0001"));
}

/** Métrica TOLERANTE (fase 7): uma diferença na amostra `st` do original só conta se aparece em TODOS os quadros nossos com passo em
 *  [st − tol, st + tol] (tiques de 16/s; os nossos quadros saem a cada tique de 20/s, passo fracionário). Interseção por campo|unidade (o
 *  detalhe varia de quadro a quadro); persistência (2 amostras) e rótulo do estrito (detalhe do quadro exato). */
export function compareWindowTol(orig: Map<number, OU[]>, ours: Any[], start: number, hero: number, tol: number): Any | null {
  const fr = ours.filter(f => f.step >= start).sort((a, b) => a.step - b.step);
  if (!fr.length) return null;
  const last = fr[fr.length - 1].step;
  const steps = [...orig.keys()].filter(s => s > start && s <= last).sort((a, b) => a - b);
  const dummy = new Set<string>();
  const key = (fd: Found) => `${fd[0]}\u0001${fd[1]}`;
  return persist(steps, st => {
    const cand = fr.filter(f => Math.abs(f.step - st) <= tol + 1e-9);
    if (!cand.length) return null;
    cand.sort((a, b) => Math.abs(a.step - st) - Math.abs(b.step - st));
    let keep: Found[] = frameFound(orig.get(st)!, cand[0], hero, dummy);
    for (const f of cand.slice(1)) {
      if (!keep.length) break;
      const ks = new Set(frameFound(orig.get(st)!, f, hero, dummy).map(key));
      keep = keep.filter(x => ks.has(key(x)));
    }
    return keep;
  }, fd => fd.slice(0, 4).join("\u0001"));   // persistência com a chave do estrito: tolerante ⊆ estrito em cada amostra
}

/** Eventos de uma sequência de amostras: queda/morte (`die`), golpe recebido (`hit`, vida −3 ou mais), troca de alvo (`tgt`) e, no herói,
 *  troca de tarefa (`task`). Dentro da mesma amostra a ordem é a da chave (o traço é de 4 em 4 tiques). */
function events(samples: [number, Map<number | string, { alive: boolean; hp: number; tgt: number; task: string }>][], hero: number, until: number): string[] {
  const ev: string[] = [];
  let prev: Map<number | string, { alive: boolean; hp: number; tgt: number; task: string }> | null = null;
  for (const [st, cur] of samples) {
    if (st > until) break;
    if (prev) {
      const here: string[] = [];
      for (const [id, c] of cur) {
        const p = prev.get(id);
        if (!p) continue;
        if (p.alive && !c.alive) here.push(`die:${id}`);
        if (c.alive && p.hp - c.hp >= 3) here.push(`hit:${id}`);
        if (c.alive && p.tgt !== c.tgt) here.push(`tgt:${id}:${c.tgt}`);
        if (id === hero && c.alive && p.task !== c.task) here.push(`task:${c.task}`);
      }
      ev.push(...here.sort());
    }
    prev = cur;
  }
  return ev;
}

/** Métrica por ORDEM de eventos (fase 7): a janela é "limpa" se a sequência de eventos (sem o tempo) é a mesma nos dois motores, nas
 *  amostras do original até 8 tiques antes do fim (um evento defasado no fim da janela sairia de um lado só). */
export function compareOrder(orig: Map<number, OU[]>, ours: Any[], start: number, end: number, hero: number): boolean {
  const at = new Map<number, Any>();
  for (const f of ours) if (f.step >= start && orig.has(f.step) && !at.has(f.step)) at.set(f.step, f);
  const steps = [...at.keys()].sort((a, b) => a - b);
  const oTask = (o: OU) => { let c = TASK_ORIG[o.task] ?? `#${o.task}`; if (c === "idle" && (o.mode === 5 || o.mode === 6) && o.target) c = "attack"; if (o.state === 13) c = "cast"; return c; };
  const oS = steps.map(st => [st, new Map(orig.get(st)!.map(o => {
    const t = (o.mode === 5 || o.mode === 6 || o.mode === 8 || o.task === 8 || o.task === 0xD) ? o.target : 0;
    return [o.id, { alive: o.state !== 0x10 && o.hp > 0, hp: o.hp, tgt: t, task: oTask(o) }];
  }))] as [number, Map<number | string, Any>][]);
  const nS = steps.map(st => [st, new Map((at.get(st).units as Any[]).filter(n => typeof n.id === "number").map(n => {
    const armed = n.armed === undefined || n.armed === null ? true : !!n.armed;
    return [n.id, { alive: !!n.alive && n.hp > 0, hp: n.hp, tgt: Number.isInteger(n.target) && armed ? n.target : 0, task: TASK_OURS[n.task] ?? n.task }];
  }))] as [number, Map<number | string, Any>][]);
  const a = events(oS, hero, end - 8), b = events(nS, hero, end - 8);
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
