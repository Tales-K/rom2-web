/**
 * Barra de vida/mana no estilo do allods2.exe (notes/hud-reference.md "Barras sobre as unidades"): trilho cinza 4 px, preenchimento
 * com três tons (linha de cima clara, meio médio, resto/fundo escuro). Um só componente para as barras sobre as unidades
 * (mission/view.ts) e para as cabeças do grupo (mission/hud.ts).
 */
import type { Graphics } from "pixi.js";

export type BarKind = "green" | "yellow" | "red" | "blue";
/** claro, médio, escuro (canal de cor da barra) */
export const BAR_LEVELS = [0xff, 0xc0, 0x80];
/** Modo "apagado" (`dim`): cores pela metade sobre o fundo escurecido. */
export function barColor(kind: BarKind, level: number, dim = false): number {
  const v = dim ? level >> 1 : level;
  return kind === "green" ? v << 8 : kind === "yellow" ? (v << 16) | (v << 8) : kind === "red" ? v << 16 : v;
}

/** Cor da barra de vida: vermelha abaixo de 1/4, amarela abaixo de 1/2 (allods2.exe 0x460db1; a captura 00087 mostra verde a 53%). */
export function hpKind(hp: number, max: number): BarKind {
  const h = Math.ceil(hp);
  return h < Math.trunc(max / 4) ? "red" : h < Math.trunc(max / 2) ? "yellow" : "green";
}

/** Largura do preenchimento em px; mínimo 1 se `minOne` ou se o valor não é zero. */
export function barFill(value: number, max: number, inner: number, minOne = false): number {
  let fill = max > 0 ? Math.floor(Math.max(0, value) * inner / max) : 0;
  if (fill === 0 && (minOne || value !== 0)) fill = 1;
  return fill;
}

/** Desenha a barra (4 px de altura a partir de `top`): trilho de largura `inner` + preenchimento `fill`. */
export function drawBar(g: Graphics, x: number, top: number, inner: number, fill: number, kind: BarKind, dim = false): void {
  const [hi, mid, lo] = BAR_LEVELS.map(l => barColor(kind, l, dim)) as [number, number, number];
  if (!dim) {
    g.rect(x, top, inner, 4).fill(0x404040).rect(x, top + 1, inner, 1).fill(0x808080).rect(x, top + 2, inner, 1).fill(0x606060);
    g.rect(x, top, fill, 4).fill(lo).rect(x, top + 1, fill, 1).fill(hi).rect(x, top + 2, fill, 1).fill(mid);
  } else {
    g.rect(x, top, fill, 4).fill({ color: 0x000000, alpha: 0.5 });
    g.rect(x, top, fill, 1).fill({ color: lo, alpha: 0.5 }).rect(x, top + 1, fill, 1).fill({ color: hi, alpha: 0.5 })
      .rect(x, top + 2, fill, 1).fill({ color: mid, alpha: 0.5 }).rect(x, top + 3, fill, 1).fill({ color: lo, alpha: 0.5 });
  }
}
