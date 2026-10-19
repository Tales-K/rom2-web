/**
 * A* em grade de 8 vizinhos, com custo por célula (map.reg) e sem cortar quinas bloqueadas.
 * Heurística octil × menor custo de terreno (admissível). Limite de nós expandidos para não travar o quadro.
 */
import type { Grid } from "./grid";
import type { Cell } from "./types";

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];
const SQ2 = Math.SQRT2;

class Heap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size(): number { return this.ids.length; }
  push(id: number, key: number): void {
    const ids = this.ids, keys = this.keys;
    let i = ids.length;
    ids.push(id); keys.push(key);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p]! <= key) break;
      ids[i] = ids[p]!; keys[i] = keys[p]!; i = p;
    }
    ids[i] = id; keys[i] = key;
  }
  pop(): number {
    const ids = this.ids, keys = this.keys;
    const top = ids[0]!;
    const lid = ids.pop()!, lk = keys.pop()!;
    const n = ids.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1]! < keys[c]!) c++;
        if (keys[c]! >= lk) break;
        ids[i] = ids[c]!; keys[i] = keys[c]!; i = c;
      }
      ids[i] = lid; keys[i] = lk;
    }
    return top;
  }
}

export interface PathOptions {
  flying?: boolean;
  /** células extras bloqueadas (por exemplo unidades paradas perto) */
  extraBlocked?: Set<number>;
  maxNodes?: number;
  /** aceita chegar a até esta distância (Chebyshev) do alvo; 0 = exatamente no alvo */
  near?: number;
}

/** Caminho de (sx,sy) até (tx,ty), sem incluir a célula inicial. `null` se não houver. Se o alvo é inalcançável,
 *  devolve o caminho até a célula alcançada mais próxima do alvo (comportamento do RTS: "chega o mais perto possível"). */
export function findPath(g: Grid, sx: number, sy: number, tx: number, ty: number, opt: PathOptions = {}): Cell[] | null {
  const W = g.w, H = g.h, N = W * H;
  const flying = !!opt.flying;
  const maxNodes = opt.maxNodes ?? 12000;
  const near = opt.near ?? 0;
  if (!g.inside(sx, sy)) return null;
  tx = Math.max(0, Math.min(W - 1, tx)); ty = Math.max(0, Math.min(H - 1, ty));
  const gScore = new Float32Array(N).fill(Infinity);
  const from = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const start = sy * W + sx;
  const hmul = flying ? 6 : g.minCost;
  const h = (x: number, y: number) => {
    const dx = Math.abs(x - tx), dy = Math.abs(y - ty);
    return (Math.max(dx, dy) - Math.min(dx, dy) + SQ2 * Math.min(dx, dy)) * hmul;
  };
  const ok = (x: number, y: number) => {
    if (!g.passable(x, y, flying)) return false;
    return !(opt.extraBlocked && opt.extraBlocked.has(y * W + x));
  };
  gScore[start] = 0;
  const open = new Heap();
  open.push(start, h(sx, sy));
  let best = start, bestH = h(sx, sy), expanded = 0;
  while (open.size) {
    const cur = open.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % W, cy = (cur / W) | 0;
    const hc = h(cx, cy);
    if (hc < bestH) { bestH = hc; best = cur; }
    if (Math.max(Math.abs(cx - tx), Math.abs(cy - ty)) <= near) { best = cur; break; }
    if (++expanded > maxNodes) break;
    for (let k = 0; k < 8; k++) {
      const nx = cx + DX[k]!, ny = cy + DY[k]!;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (closed[ni]) continue;
      // o alvo pode estar ocupado/bloqueado (atacar uma unidade): deixa entrar só se near cobre
      if (!ok(nx, ny)) continue;
      if (k >= 4 && (!ok(cx + DX[k]!, cy) || !ok(cx, cy + DY[k]!))) continue; // não corta quinas
      const step = (flying ? 6 : g.cost[ni]!) * (k >= 4 ? SQ2 : 1);
      const ng = gScore[cur]! + step;
      if (ng < gScore[ni]!) {
        gScore[ni] = ng; from[ni] = cur;
        open.push(ni, ng + h(nx, ny));
      }
    }
  }
  if (best === start) return [];
  const out: Cell[] = [];
  for (let c = best; c !== start && c !== -1; c = from[c]!) out.push({ x: c % W, y: (c / W) | 0 });
  out.reverse();
  return out;
}

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
