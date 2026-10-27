/**
 * Linha de visão simples (Bresenham) [est]: a guarda e as magias não a usam (o exe não testa linha de visão); fica para consultas de
 * diagnóstico (`World.hasLos`). Era parte de sim/path.ts, apagado com o A* na etapa 6 (o andar é o do exe: sim/exe/).
 */
import type { Grid } from "./grid";

/** Linha de visão simples (Bresenham) — bloqueada só por estruturas (árvores não tapam a visão nesta aproximação). */
export function lineOfSight(g: Grid, x0: number, y0: number, x1: number, y1: number, mask: number): boolean {
  let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    if (x0 === x1 && y0 === y1) return true;
    if ((x0 !== x1 || y0 !== y1) && g.inside(x0, y0) && (g.block[y0 * g.w + x0]! & mask)) return false;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
