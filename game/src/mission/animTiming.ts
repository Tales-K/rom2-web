/**
 * Metadados de animação das unidades (assets/ui/hud/anim/units.json, gerado por tools/pipeline/mission.py) e tempos derivados.
 * Sem PixiJS: usado também pela simulação headless (src/sim/test). As texturas ficam em anim.ts.
 * Layout (deduzido, ver tools/pipeline/mission.py):
 *   Flip=1: 9 frames parados (16 direções, só S→O→N; o lado leste é espelhado) + 5 direções (S,SO,O,NO,N) × blocos
 *   Flip=0: 16 frames parados + 8 direções (S,SO,O,NO,N,NE,L,SE) × blocos
 *   blocos (nesta ordem): mover (MoveBegin+Move fases), atacar, morrer, ossos, ocioso
 */
import type { AnimTiming } from "../sim/world";

export interface AnimBlock { start: number; phases: number; begin?: number; }

export interface AnimMeta {
  name: string;
  image: string;
  cellW: number;
  cellH: number;
  cols: number;
  count: number;
  flip: boolean;
  staticDirs: number;
  dirs: number;
  blocks: { move?: AnimBlock; attack?: AnimBlock; dying?: AnimBlock; bones?: AnimBlock; idle?: AnimBlock };
  MoveAnimFrame?: number[];
  MoveAnimTime?: number[];
  AttackAnimFrame?: number[];
  AttackAnimTime?: number[];
  IdleAnimFrame?: number[];
  IdleAnimTime?: number[];
  Width?: number;
  Height?: number;
  CenterX?: number;
  CenterY?: number;
  Z?: number;
  Sound?: number[];
  AttackDelay?: number;
  InfoPicture?: string;
  Projectile?: number;
  TileSize?: number;
  /** tipo de unidade cujo sprite tem a animação de morte deste (units.reg) */
  Dying?: number;
  /** camada B ("spritesb": contorno de suavização desenhado a 50%; opção Smoothing) */
  imageB?: string;
  /** variantes de paleta (nível do monstro → RGB×256 em base64; tools/pipeline/anim_world.py) */
  palettes?: Record<string, string>;
  /** índice transparente do PNG indexado */
  transparent?: number;
  /** correções de layout aplicadas pela pipeline (ID 2 espelhado, morte da ovelha com 5 fases) */
  layoutFix?: Record<string, unknown>;
}

export type AnimTable = Record<string, AnimMeta>;

export const ANIM_BASE = "assets/ui/hud/anim/";

/** Duração de uma unidade de tempo das animações do jogo (AnimTime/AnimationTime dos .reg): 1/16 s. Medido nas capturas do
 *  original (refs/original/mission10_idle_*): as árvores (AnimationTime 4) trocam de quadro a cada 250 ms. */
export const ANIM_UNIT_MS = 62.5;

/** Converte tiques da simulação (50 ms) em unidades de animação (62,5 ms). */
export function simTicksToAnim(ticks: number): number { return ticks * 50 / ANIM_UNIT_MS; }

/** Índice (0..15) da direção do vetor (dx, dy) em células: 0 = S, 4 = O, 8 = N, 12 = L (mesmo sentido dos sprites). */
export function dir16(dx: number, dy: number): number {
  if (!dx && !dy) return 0;
  return ((Math.round(Math.atan2(-dx, dy) / (Math.PI / 8)) % 16) + 16) % 16;
}

/** Sequência (frame, duração) de uma animação. */
function seq(frames: number[] | undefined, times: number[] | undefined, phases: number, offset = 0): { f: number; t: number }[] {
  const fr = Array.isArray(frames) && frames.length ? frames : Array.from({ length: phases }, (_, i) => i);
  const tm = Array.isArray(times) && times.length ? times : fr.map(() => 2);
  return fr.map((f, i) => ({ f: Math.min(phases - 1, f + offset), t: Math.max(1, tm[i] ?? 2) }));
}

/** Fase da animação no tick `t` (laço se `loop`). */
export function phaseAt(s: { f: number; t: number }[], t: number, loop: boolean): number {
  const total = s.reduce((a, b) => a + b.t, 0) || 1;
  let k = loop ? t % total : Math.min(t, total - 1);
  for (const e of s) { if (k < e.t) return e.f; k -= e.t; }
  return s[s.length - 1]?.f ?? 0;
}

export function moveSeq(m: AnimMeta): { f: number; t: number }[] {
  const b = m.blocks.move;
  if (!b) return [];
  const begin = b.begin ?? 0;
  return seq(m.MoveAnimFrame, m.MoveAnimTime, b.phases - begin, 0).map(e => ({ f: e.f + begin, t: e.t }));
}
export function attackSeq(m: AnimMeta): { f: number; t: number }[] {
  const b = m.blocks.attack;
  return b ? seq(m.AttackAnimFrame, m.AttackAnimTime, b.phases) : [];
}
export function idleSeq(m: AnimMeta): { f: number; t: number }[] {
  const b = m.blocks.idle;
  return b ? seq(m.IdleAnimFrame, m.IdleAnimTime, b.phases) : [];
}
export function dyingSeq(m: AnimMeta): { f: number; t: number }[] {
  const b = m.blocks.dying;
  return b ? seq(undefined, Array(b.phases).fill(3), b.phases) : [];
}

/** Tempos da simulação (ticks de 50 ms). Com `charge`/`relax` do data.bin (tiques do jogo a 25/s; animação avança 0,5 por tique):
 *  o golpe sai em 2×charge tiques = charge/12,5 s e o ciclo dura (charge+relax)/12,5 s [UA]. Sem dados, usa a duração da animação. */
export function timingFor(m: AnimMeta | undefined, st?: { charge?: number; relax?: number }, dyingTime?: number): AnimTiming {
  const dy = m ? dyingSeq(m) : [];
  const dyingTicks = Math.max(14, dy.reduce((s, e) => s + e.t, 0) || 15, dyingTime ? Math.round(dyingTime / 25 * 20) : 0);
  if (st?.charge && st.charge > 0) {
    const cycle = Math.max(4, Math.round((st.charge + (st.relax ?? 0)) / 12.5 * 20));
    return { attackTicks: cycle, hitTick: Math.max(1, Math.round(st.charge / 12.5 * 20)), attackDelay: 0, dyingTicks };
  }
  if (!m) return { attackTicks: 12, hitTick: 7, attackDelay: 8, dyingTicks };
  const a = attackSeq(m);
  const attackTicks = Math.max(6, a.reduce((s, e) => s + e.t, 0) || 12);
  return { attackTicks, hitTick: Math.max(2, Math.round(attackTicks * 0.6)), attackDelay: Math.max(2, (m.AttackDelay ?? 4) * 2), dyingTicks };
}
