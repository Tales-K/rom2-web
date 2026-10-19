/**
 * Relevo (altitude, bloco 2 do .alm) e iluminação do terreno como o allods2.exe faz (leitura estática; notes/altitude.md).
 * Sem PixiJS: usado pelo desenho (view.ts, terrainmesh.ts, worldanim.ts, effects.ts), pelo clique (tela → célula) e pelos testes.
 *
 * - Altitude = byte COM SINAL por VÉRTICE: o vértice (x, y) é o canto superior esquerdo da célula (x, y). Na tela o vértice fica
 *   em (32·x, 32·y − alt) — 1 px por unidade (exe 0x4065b1). A célula (x, y) é desenhada com os 4 cantos (x,y) (x+1,y) (x,y+1)
 *   (x+1,y+1): cada coluna de pixels da textura é esticada entre a borda de cima e a de baixo interpoladas (0x4575fe).
 * - Unidades e estruturas sobem a altura bilinear no seu ponto central, com as divisões truncadas do exe (0x46025d).
 *   Objetos de cenário sobem a média truncada dos 4 cantos da célula (tabela +0xc0, 0x4065b1).
 * - Luz por vértice (0x4a5dd2): inclinação medida na direção do sol (tan do ângulo solar) dos dois lados do vértice,
 *   L = (b + c/2 + 32) − sin(π/6 − atan2(Δh, 32/cos a))·c, limitada a [0, 94], média dos dois lados truncada.
 *   Brilho do pixel = (96 − L)/32 (tabela de sombreamento do terreno 0x42339e modo 3, 96 níveis), interpolado na célula.
 * - Parâmetros por hora do dia (0x474d98): sem ciclo dia/noite b=14, c=32, a=π/4 (plano: L=46 → ×1,5625).
 */

export const TILE_PX = 32;

/** Byte do .alm como inteiro com sinal (o exe lê com movsx). */
function s8(v: number): number { return (v << 24) >> 24; }

/** Parâmetros da luz do terreno numa hora do dia (exe 0x474d98: estrutura global 0x6226c0). */
export interface LightParams { b: number; c: number; angle: number; }

/** Sem ciclo dia/noite (opção desligada): o exe usa estes valores fixos. */
export const DAY_LIGHT: LightParams = { b: 14, c: 32, angle: Math.PI / 4 };

/** Parâmetros pela hora (minutos do dia, como o relógio do exe). `dayNight` falso = DAY_LIGHT. */
export function lightParamsAt(minutes: number, dayNight: boolean): LightParams {
  if (!dayNight) return DAY_LIGHT;
  const m = Math.max(0, Math.floor(minutes));
  const h = Math.floor(m / 60) % 24;
  const q = m % 120;
  const Q = Math.PI / 4;
  if (h >= 6 && h < 18) return { b: 14, c: 32, angle: ((m + 360) % 720) * Math.PI / 2 / 720 - Q };
  if (h < 2 || h >= 22) return { b: 32, c: 8, angle: Q - ((m + 120) % 240) * Math.PI / 2 / 240 };
  if (h < 4) return { b: 32 - Math.trunc(q * 4 / 120), c: Math.trunc(q * 12 / 120) + 8, angle: -Q };
  if (h < 6) return { b: 28 - Math.trunc(q * 14 / 120), c: Math.trunc(q * 12 / 120) + 20, angle: -Q };
  if (h < 20) return { b: Math.trunc(q * 10 / 120) + 14, c: 32 - Math.trunc(q * 12 / 120), angle: Q };
  return { b: Math.trunc(q * 8 / 120) + 24, c: 20 - Math.trunc(q * 12 / 120), angle: Q };
}

export class Relief {
  readonly w: number;
  readonly h: number;
  /** altitude com sinal por vértice (w×h) */
  readonly alt: Int8Array;
  /** nível de luz L por vértice (0..94; 46 = plano de dia) */
  readonly light: Uint8Array;
  /** desligado (mapa sem bloco 2 ou tudo zero): o desenho fica plano e sem custo */
  readonly flat: boolean;

  constructor(w: number, h: number, alt: ArrayLike<number> | undefined) {
    this.w = w; this.h = h;
    this.alt = new Int8Array(w * h);
    let any = false;
    if (alt) for (let i = 0; i < w * h; i++) { const v = s8(alt[i] ?? 0); this.alt[i] = v; if (v) any = true; }
    this.flat = !any;
    this.light = new Uint8Array(w * h);
    this.computeLight(DAY_LIGHT);
  }

  /** Altitude do vértice (x, y), presa à borda do mapa. */
  v(x: number, y: number): number {
    const cx = x < 0 ? 0 : x >= this.w ? this.w - 1 : x;
    const cy = y < 0 ? 0 : y >= this.h ? this.h - 1 : y;
    return this.alt[cy * this.w + cx]!;
  }

  /** Altura (px) no ponto `px, py` (px do mundo plano), bilinear com divisões truncadas como o exe (0x46025d). */
  heightAtPx(px: number, py: number): number {
    if (this.flat) return 0;
    const ix = Math.floor(px), iy = Math.floor(py);
    const cx = ix >> 5, cy = iy >> 5, fx = ix & 31, fy = iy & 31;
    const h00 = this.v(cx, cy), h10 = this.v(cx + 1, cy), h01 = this.v(cx, cy + 1), h11 = this.v(cx + 1, cy + 1);
    const top = h00 + Math.trunc((h10 - h00) * fx / 32);
    const bot = h01 + Math.trunc((h11 - h01) * fx / 32);
    return top + Math.trunc((bot - top) * fy / 32);
  }

  /** Altura no ponto em células (u.x, u.y). */
  heightAt(x: number, y: number): number { return this.heightAtPx(x * TILE_PX, y * TILE_PX); }

  /** Média truncada dos 4 cantos da célula (objetos de cenário, tabela +0xc0 do exe). */
  cellAvg(cx: number, cy: number): number {
    if (this.flat) return 0;
    return Math.trunc((this.v(cx, cy) + this.v(cx + 1, cy) + this.v(cx, cy + 1) + this.v(cx + 1, cy + 1)) / 4);
  }

  /** Y na tela (px do mundo) da borda de cima da célula na coluna `x` (células, fracionário) da linha de vértices `row`. */
  private edgeY(x: number, row: number): number {
    const c = Math.floor(x), f = x - c;
    const a = this.v(c, row), b = this.v(c + 1, row);
    return row * TILE_PX - (a + (b - a) * f);
  }

  /**
   * Ponto da tela (px do mundo, já com a câmera) → ponto do chão (px do mundo plano). A célula da frente (linha maior) ganha,
   * como no desenho do exe (linhas de cima para baixo). Fora do mapa ou sem relevo devolve o próprio ponto.
   */
  screenToGround(wx: number, wy: number): { x: number; y: number } {
    if (this.flat) return { x: wx, y: wy };
    const x = wx / TILE_PX;
    const r0 = Math.max(0, Math.floor((wy - 160) / TILE_PX)), r1 = Math.min(this.h - 1, Math.floor((wy + 160) / TILE_PX));
    for (let r = r1; r >= r0; r--) {
      const top = this.edgeY(x, r), bot = this.edgeY(x, r + 1);
      if (wy >= top && wy < bot && bot > top) return { x: wx, y: (r + (wy - top) / (bot - top)) * TILE_PX };
    }
    // nenhuma célula cobre o ponto (fora do mapa): só desfaz a altura do próprio ponto
    return { x: wx, y: wy + this.heightAtPx(wx, wy) };
  }

  /** parâmetros da última `computeLight` */
  params: LightParams = DAY_LIGHT;

  /** Recalcula a luz de todos os vértices internos (exe 0x4a5dd2 chamado com (1, 1, 0, 0)). */
  computeLight(p: LightParams): void {
    this.params = p;
    const { w, h } = this;
    const a = p.angle, aa = Math.abs(a);
    const t = Math.tan(aa), K = 32 / Math.cos(aa);
    const base = p.b + Math.trunc(p.c / 2) + 32;
    const lv = (s: number) => {
      const v = Math.atan2(s, K);
      const L = base - Math.sin(Math.PI / 6 - v) * p.c;
      return L > 94 ? 94 : L < 0 ? 0 : L;
    };
    const flatL = Math.max(0, Math.min(94, p.b + 32));
    this.light.fill(flatL);
    if (this.flat) return;
    const A = (x: number, y: number) => this.alt[y * w + x]!;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const h0 = A(x, y);
      let s1: number, s2: number;
      if (a < 0) {
        s1 = A(x, y + 1) + (A(x + 1, y + 1) - A(x, y + 1)) * t - h0;
        s2 = h0 - (A(x, y - 1) - (A(x, y - 1) - A(x - 1, y - 1)) * t);
      } else {
        s1 = A(x, y + 1) - (A(x, y + 1) - A(x - 1, y + 1)) * t - h0;
        s2 = h0 - (A(x, y - 1) + (A(x + 1, y - 1) - A(x, y - 1)) * t);
      }
      this.light[y * w + x] = Math.trunc((lv(s1) + lv(s2)) / 2);
    }
  }

  /** Brilho do vértice: (96 − L)/32 (1,5625 no plano de dia). */
  gain(x: number, y: number): number {
    const cx = x < 0 ? 0 : x >= this.w ? this.w - 1 : x;
    const cy = y < 0 ? 0 : y >= this.h ? this.h - 1 : y;
    return (96 - this.light[cy * this.w + cx]!) / 32;
  }

  /**
   * Brilho do vértice para o desenho: o de `gain` reescalado para que o plano fique sempre no valor de dia (1,5625). O escurecimento
   * da noite (b maior no exe) já sai da luz ambiente de daynight.ts; aqui fica só o relevo (contraste c e ângulo do sol da hora).
   */
  shade(x: number, y: number): number {
    const flatGain = (64 - this.params.b) / 32;
    return this.gain(x, y) * (50 / 32) / (flatGain > 0 ? flatGain : 1);
  }

  /** Brilho médio da célula como o minimapa do exe (0x4ab96c): (0x60 − média truncada dos 4 L)/32. */
  cellGain(cx: number, cy: number): number {
    const L = (x: number, y: number) => this.light[Math.max(0, Math.min(this.h - 1, y)) * this.w + Math.max(0, Math.min(this.w - 1, x))]!;
    const avg = Math.trunc((L(cx, cy) + L(cx + 1, cy) + L(cx, cy + 1) + L(cx + 1, cy + 1)) / 4);
    return (96 - avg) / 32;
  }
}
