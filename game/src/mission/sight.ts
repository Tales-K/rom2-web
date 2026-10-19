/**
 * Visão com relevo como o cliente do allods2.exe calcula a névoa de guerra (leitura estática: tabelas em 0x403730, anéis em
 * 0x403ca0, passo em 0x403b8f; notes/altitude.md). Sem PixiJS.
 *
 * Janela 41×41 em volta da célula da unidade. Cada célula herda o "alcance restante" da célula anterior no raio até o centro
 * (passo em x, em y ou na diagonal, conforme a direção) e gasta `d + (alt(célula) − alt(vigia))`:
 *   d = trunc(√(i²+j²)·128 / max(|i|,|j|))  (128 por passo reto, 181 na diagonal);
 *   alcance inicial = (visão·256 >> 1) + 64  (= (visão + ½)·128).
 * A célula é vista se o alcance restante > 0. Subir gasta alcance (1 px de altitude = 1/128 de célula), descer devolve.
 * Os anéis param quando um anel inteiro fica sem alcance (até 19 células).
 */

const R = 20, N = 2 * R + 1;
/** custo d por (a, b) da janela (índices 0..40, centro 20) */
const COST = new Int32Array(N * N);
/** célula anterior no raio (deslocamento em a e em b) */
const PREV_A = new Int8Array(N * N), PREV_B = new Int8Array(N * N);
(() => {
  for (let i = 0; i <= R; i++) for (let j = 0; j <= R; j++) {
    const half = i >> 1, dbl = i * 2;
    // sinais por quadrante: (+i,+j) (−i,−j) (+i,−j) (−i,+j)
    let sa: number, sb: number;
    if (j < half) { sa = 1; sb = 0; } else if (j <= dbl) { sa = 1; sb = 1; } else { sa = 0; sb = 1; }
    const put = (a: number, b: number, pa: number, pb: number) => { PREV_A[a * N + b] = pa; PREV_B[a * N + b] = pb; };
    put(R + i, R + j, -sa, -sb);
    put(R - i, R - j, sa, sb);
    put(R + i, R - j, -sa, sb);
    put(R - i, R + j, sa, -sb);
    if (i || j) {
      const d = Math.trunc(Math.sqrt(i * i + j * j) * 128 / Math.max(i, j));
      COST[(R + i) * N + R + j] = d; COST[(R - i) * N + R - j] = d; COST[(R + i) * N + R - j] = d; COST[(R - i) * N + R + j] = d;
    }
  }
  // o exe corrige os vizinhos horizontais do centro (a fórmula daria diagonal)
  PREV_A[(R + 1) * N + R] = -1; PREV_B[(R + 1) * N + R] = 0;
  PREV_A[(R - 1) * N + R] = 1; PREV_B[(R - 1) * N + R] = 0;
})();

const left = new Int32Array(N * N);

/**
 * Marca em `out` (w×h, 1 = vista) as células vistas por quem está na célula (cx, cy) com visão `sight` (células).
 * `alt(x, y)` = altitude com sinal do vértice (canto superior esquerdo da célula).
 */
export function markVisible(w: number, h: number, alt: (x: number, y: number) => number, cx: number, cy: number, sight: number,
  out: Uint8Array, explored?: Uint8Array): void {
  left.fill(0);
  left[R * N + R] = (Math.trunc(sight * 256) >> 1) + 64;
  const h0 = alt(cx, cy);
  if (cx >= 0 && cy >= 0 && cx < w && cy < h) { out[cy * w + cx] = 1; if (explored) explored[cy * w + cx] = 1; }
  const step = (a: number, b: number): boolean => {
    const x = cx + a - R, y = cy + b - R;
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    const k = a * N + b;
    const prev = (a + PREV_A[k]!) * N + (b + PREV_B[k]!);
    const v = left[prev]! - (COST[k]! + alt(x, y) - h0);
    left[k] = v;
    if (v > 0) { out[y * w + x] = 1; if (explored) explored[y * w + x] = 1; return true; }
    return false;
  };
  for (let r = 1; r < R; r++) {
    let any = false;
    for (let t = -r; t <= r; t++) {
      if (step(R + t, R - r)) any = true;
      if (step(R + t, R + r)) any = true;
      if (step(R - r, R + t)) any = true;
      if (step(R + r, R + t)) any = true;
    }
    if (!any) break;
  }
}
