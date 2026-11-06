/**
 * Núcleo do nosso sim para o JOGO ESPELHADO e a corrida livre de episódios (tools/refcap/mirror/; notes/bugs-2026-10-31-fase1.md, D).
 * Usa o sim como biblioteca, sem editar game/src/sim: monta o nosso mundo de um estado do original (o mesmo formato de
 * refs/oracle/ticks e do export_state.read_state) e anda tique a tique com as ordens do cliente, comparando a visão plana do tickcmp
 * (tick_compare.mts: viewOrig/viewOurs/diffViews) com o estado do original do tique seguinte.
 *
 * Dois começos:
 *  - `simFromImport` (estado importado): worldFromState + applyState do tique 0 do original, como a corrida livre do tickcmp, mas num
 *    mundo NOVO (o tickcmp a roda depois da reancorada, e o resetWorld guarda campos da última janela: a 1.ª divergência dele muda
 *    com o `--max`);
 *  - `simFromLoader` (nosso carregador): loader.startRun (como a MissionScene) com o herói do estado, a semente e o relógio do estado;
 *    unidades casadas pelo id do .alm (0x6000 + id), como o loadcmp.
 */
import { applyState, ExeReplay, heroFromState, spawnUnmatched, worldFromState, type OrigState } from "../../../game/src/sim/test/import_state";
import { loadData, startRun, type Run } from "../../../game/src/sim/test/loader";
import { orderOf } from "../../../game/src/sim/test/diff_window";
import { thinkPhaseFor, type Unit, type World } from "../../../game/src/sim/world";
import { TICKS_PER_SEC } from "../../../game/src/sim/types";
import { diffViews, viewOrig, viewOurs, type Diff, type View } from "../diff/tick_compare.mts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
export interface Action { t: number; do: string; unit?: number | string | (number | string)[]; x?: number; y?: number; target?: number | string; spell?: number; now?: boolean }

export interface Sim {
  mode: "import" | "loader";
  run: Run; w: World;
  /** id do original → id nosso */
  idmap: Map<number, number>;
  heroOrig: number;
  /** pares campo|unidade que já diferem no começo e o passo não mexe (só no modo importado: o applyState não os reproduz) */
  lost: Map<string, Diff>;
  /** pares que diferem no tique 0 (modo carregador: o nosso tique 0 × o do original) */
  diff0: Diff[];
  sel: Unit[];
  T: number;
  /** ouro dado ao jogador 1 pelo script desde o começo (Give money) */
  gold(): number;
  messages(): number[];
}

const m20 = (v: number): number => ((v % TICKS_PER_SEC) + TICKS_PER_SEC) % TICKS_PER_SEC;
const rev = (s: Sim): Map<number, number> => new Map([...s.idmap].map(([o, n]) => [n, o]));

/** IA+0x20 (alvo atribuído pelo grupo) do despejo: a importação não o traz (tick_compare.runFree faz o mesmo). */
function importF20(w: World, st0: Any, idmap: Map<number, number>): void {
  const byAddr = new Map<number, number>();
  for (const o of st0.units as Any[]) if (o.exe) byAddr.set(o.exe.a >>> 0, o.id);
  for (const o of st0.units as Any[]) {
    const n = idmap.get(o.id), u = n !== undefined ? w.get(n) : undefined;
    if (!u || !o.exe?.ai || o.exe.ai.length < 0x48) continue;
    const a = parseInt((o.exe.ai as string).slice(0x40, 0x48).match(/../g)!.reverse().join(""), 16) >>> 0;
    const t = a ? idmap.get(byAddr.get(a) ?? -1) : undefined;
    u.rec.ai.f20 = a && t !== undefined ? w.get(t)?.rec.addr ?? 0 : 0;
  }
}

/** Normaliza um estado do original para o importador: `range` e `book` (o despejo por tique não traz o livro). */
export function prepState(st: Any, bookOf?: Map<number, Any>): OrigState {
  for (const u of st.units) {
    u.range = u.attack_range;
    if (!u.book) u.book = bookOf?.get(u.id) ?? (u.exe?.book ?? []).map((b: [number, number]) => ({ id: b[0], mana: 0 }));
  }
  return st as OrigState;
}

/** `ticks` (opcional) = os estados 0..T0 do original, para começar no tique T0 (o MapRec do despejo vem em deltas desde o 0). */
export async function simFromImport(base: OrigState, st0: OrigState, ticks?: readonly OrigState[], T0 = 0): Promise<Sim> {
  const imp = await worldFromState(base);
  const w = imp.w;
  spawnUnmatched(imp.r, w, st0, imp.idmap);
  const exe = st0.exe ? new ExeReplay(ticks ?? [st0]) : null;
  applyState(w, st0, imp.idmap, { spells: imp.r.data.spells as Record<string, unknown> | undefined, diplomacy: true, ...(exe ? { exe: { replay: exe, t: ticks ? T0 : 0 } } : {}) });
  w.events.length = 0;
  const s: Sim = { mode: "import", run: imp.r, w, idmap: imp.idmap, heroOrig: st0.hero ?? 1, lost: new Map(), diff0: [], sel: [], T: ticks ? T0 : 0,
    gold: () => imp.r.gold, messages: () => imp.r.messages };
  const r0 = rev(s);
  for (const d of diffViews(viewOrig(st0, s.idmap, w), viewOurs(w, st0, st0, s.idmap, r0), null, null)) s.lost.set(d.key, d);
  w.rng.replay = null;
  w.rng.state = st0.rng >>> 0;
  importF20(w, st0, s.idmap);
  s.sel = [w.get(s.idmap.get(s.heroOrig) ?? -1)].filter((u): u is Unit => !!u);
  return s;
}

/** Nosso carregador: a missão do zero (startRun), com o herói do estado, a semente do rand() e o relógio de 16/s do estado
 *  (`preroll` = andar t16 do estado − 0 tiques sem ordens antes do tique 0, como o tempo que o save do original já tinha rodado). */
export async function simFromLoader(st0: OrigState, opts: { preroll?: boolean } = {}): Promise<Sim> {
  const data = await loadData(st0.mission);
  const r = startRun(data, heroFromState(st0), undefined, { seed: st0.rng >>> 0 });
  const w = r.b.world;
  const idmap = new Map<number, number>();
  const byScript = new Map<number, Unit>();
  for (const u of w.units) if (u !== r.b.hero && u.scriptId) byScript.set(u.scriptId, u);
  for (const o of st0.units as Any[]) {
    if (o.id === st0.hero) { idmap.set(o.id, r.b.hero.id); continue; }
    const u = o.id >= 0x6000 ? byScript.get(o.id - 0x6000) : undefined;
    if (u) idmap.set(o.id, u.id);
  }
  if (opts.preroll) {
    for (let i = 0; i < st0.t16; i++) { w.step(); r.b.runtime?.update(1 / TICKS_PER_SEC); w.events.length = 0; }
  } else {
    w.clockPhase = m20(thinkPhaseFor(st0.t16) - w.tick);
    w.t16base = st0.t16 - w.clock16();
  }
  const s: Sim = { mode: "loader", run: r, w, idmap, heroOrig: st0.hero ?? 1, lost: new Map(), diff0: [], sel: [], T: 0,
    gold: () => r.gold, messages: () => r.messages };
  w.syncRecs();
  s.diff0 = diffViews(viewOrig(st0, idmap, w), viewOurs(w, st0, st0, idmap, rev(s)), null, null);
  s.sel = [r.b.hero];
  return s;
}

/** Aplica as ordens do tique T (formato do roteiro dos episódios) e avança 1 tique. */
export function step(s: Sim, acts: Action[]): void {
  const w = s.w;
  const ref = (v: number | string | undefined): Unit | undefined => {
    if (v === undefined) return undefined;
    const n = s.idmap.get(v === "hero" ? s.heroOrig : Number(v));
    return n !== undefined ? w.get(n) : undefined;
  };
  for (const a of acts) {
    const us = Array.isArray(a.unit) ? a.unit.map(ref) : a.unit !== undefined ? [ref(a.unit)] : s.sel;
    const list = us.filter((u): u is Unit => !!u && u.alive);
    if (a.do === "select") { s.sel = list; continue; }
    for (const u of list) { const o = orderOf(w, a as Any, u, ref); if (o) w.command(u, o, true, !!a.now); }
  }
  w.step();
  s.run.b.runtime?.update(1 / TICKS_PER_SEC);
  w.events.length = 0;
  s.T++;
}

/** Pares divergentes entre o nosso mundo (depois do passo) e o estado `nx` do original. */
export function compare(s: Sim, nx: OrigState, fields: Set<string> | null = null): Diff[] {
  const r = rev(s);
  const nv: View = viewOurs(s.w, nx, nx, s.idmap, r);
  const ign = new Map<string, Diff>();
  for (const [k, d] of s.lost) if (String(nv.get(k)) === String(d.ours)) ign.set(k, d);
  return diffViews(viewOrig(nx, s.idmap, s.w), nv, ign, fields);
}

/** Resumo de uma unidade nossa (para o relatório): posição, vida, ordem, alvo. */
export function ourUnit(s: Sim, origId: number): Record<string, unknown> | null {
  const n = s.idmap.get(origId), u = n !== undefined ? s.w.get(n) : undefined;
  if (!u) return null;
  return { x: u.cx, y: u.cy, fx: +u.x.toFixed(3), fy: +u.y.toFixed(3), hp: u.hp, mana: u.mana, alive: u.alive, order: u.order?.type ?? null,
    task: u.rec.task, ai: u.rec.ai.task, act: u.rec.act, player: u.player };
}
