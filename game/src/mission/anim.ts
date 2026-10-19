/**
 * Texturas das animações das unidades: atlas indexados gerados por tools/pipeline/anim_world.py em assets/ui/hud/anim/
 * (unit_<ID>.png, hero_<arma>.png, camada B *_b.png). Metadados, layout e tempos ficam em animTiming.ts (sem PixiJS).
 */
import { Rectangle, Texture } from "pixi.js";
import type { AnimMeta } from "./animTiming";

export * from "./animTiming";

export interface UnitFrame { tex: Texture; flipX: boolean; i: number; }

/** Texturas fatiadas sob demanda a partir do atlas. */
export class UnitSheet {
  private frames: (Texture | undefined)[] = [];
  constructor(readonly meta: AnimMeta, private readonly base: Texture) { base.source.scaleMode = "nearest"; }

  frame(i: number): Texture {
    const n = Math.max(0, Math.min(this.meta.count - 1, i));
    let t = this.frames[n];
    if (!t) {
      const m = this.meta;
      t = new Texture({ source: this.base.source, frame: new Rectangle((n % m.cols) * m.cellW, Math.floor(n / m.cols) * m.cellH, m.cellW, m.cellH) });
      this.frames[n] = t;
    }
    return t;
  }

  /** Frame parado na direção dir16 (0 = S, 4 = O, 8 = N, 12 = L). `i` = índice no atlas (a camada B usa o mesmo). */
  still(dir16: number): UnitFrame {
    const m = this.meta;
    if (m.flip) {
      const d = dir16 <= 8 ? dir16 : 16 - dir16;
      return { tex: this.frame(d), flipX: dir16 > 8, i: d };
    }
    const i = ((dir16 % m.staticDirs) + m.staticDirs) % m.staticDirs;
    return { tex: this.frame(i), flipX: false, i };
  }

  /** Frame `phase` do bloco `name` na direção dir16 (arredondada para 8 direções). */
  block(name: keyof AnimMeta["blocks"], dir16: number, phase: number): UnitFrame | null {
    const m = this.meta, b = m.blocks[name];
    if (!b) return null;
    const dir8 = Math.round(dir16 / 2) % 8;
    let d = dir8, flipX = false;
    if (m.flip) { if (dir8 > 4) { d = 8 - dir8; flipX = true; } }
    const ph = Math.max(0, Math.min(b.phases - 1, phase));
    const i = b.start + d * b.phases + ph;
    return { tex: this.frame(i), flipX, i };
  }
}
