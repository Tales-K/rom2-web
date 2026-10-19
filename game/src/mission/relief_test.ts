/**
 * Testes do relevo (mission/relief.ts) e da visão (mission/sight.ts), sem Pixi: `npx tsx src/mission/relief_test.ts`.
 * Valores conferidos com as fórmulas do allods2.exe (notes/altitude.md) e com as capturas do original (herói da missão 20 a 47 px).
 */
import { json, proc } from "../sim/test/loader";
import { DAY_LIGHT, Relief, lightParamsAt } from "./relief";
import { markVisible } from "./sight";

let fails = 0;
function check(ok: boolean, msg: string): void { if (!ok) { fails++; console.error("FALHOU:", msg); } }

// 1) byte com sinal, bilinear truncado, média dos cantos
{
  const r = new Relief(4, 4, [0, 0, 0, 0, 0, 32, 64, 0, 0, 32, 64, 0, 0, 0, 0, 255]);
  check(r.v(3, 3) === -1, "altitude com sinal (255 → −1)");
  check(r.heightAt(1, 1) === 32, "vértice (1,1) = 32");
  check(r.heightAt(1.5, 1.5) === 48, "centro da célula (1,1) = 48");
  check(r.heightAtPx(32 + 31, 32) === 32 + Math.trunc(32 * 31 / 32), "fração truncada em x");
  check(r.cellAvg(1, 1) === 48, "média dos 4 cantos");
  check(r.cellAvg(0, 0) === 8, "média truncada (32/4)");
}
// 2) inversão tela → chão: o ponto desenhado volta à célula
{
  const m = json<{ w: number; h: number; alt: number[] }>("data/maps/20.json")!;
  const r = new Relief(m.w, m.h, m.alt);
  check(r.heightAt(41.5, 67.5) === 47, `herói da missão 20 sobe 47 px (deu ${r.heightAt(41.5, 67.5)})`);
  let bad = 0, n = 0;
  for (let y = 10; y < 70; y += 3) for (let x = 10; x < 70; x += 3) {
    const px = (x + 0.5) * 32, py = (y + 0.5) * 32;
    const g = r.screenToGround(px, py - r.heightAtPx(px, py));
    n++;
    if (Math.floor(g.y / 32) !== y) bad++;
  }
  // penhascos virados para trás escondem algumas células (a da frente cobre): tolera poucas
  check(bad <= n * 0.05, `tela → célula: ${bad}/${n} fora`);
  // luz: plano = 46; parâmetros do dia
  const flat = new Relief(4, 4, undefined);
  check(flat.flat && flat.light.every(v => v === 46), "plano de dia: L = 46");
  check(Math.abs(flat.gain(1, 1) - 1.5625) < 1e-9, "ganho do plano 1,5625");
  r.computeLight(DAY_LIGHT);
  let lo = 99, hi = 0;
  for (let i = 0; i < r.light.length; i++) { lo = Math.min(lo, r.light[i]!); hi = Math.max(hi, r.light[i]!); }
  check(lo >= 0 && hi <= 94 && hi > lo, "luz em [0, 94] e variando");
  const p6 = lightParamsAt(360, true), p12 = lightParamsAt(720, true), p23 = lightParamsAt(23 * 60, true);
  check(Math.abs(p6.angle + Math.PI / 4) < 1e-9 && p6.b === 14 && p6.c === 32, "6 h: ângulo −π/4");
  check(Math.abs(p12.angle) < 1e-9, "12 h: ângulo 0");
  check(p23.b === 32 && p23.c === 8, "noite: b 32, c 8");
  check(lightParamsAt(23 * 60, false) === DAY_LIGHT, "sem ciclo: valores fixos");
}
// 3) visão: plano = (visão + ½) células em linha reta; subida corta
{
  const w = 60, h = 60;
  const out = new Uint8Array(w * h);
  markVisible(w, h, () => 0, 30, 30, 6.4, out);
  check(out[30 * w + 36] === 1 && out[30 * w + 37] === 0, "plano: 6 células retas, a 7ª não");
  check(out[34 * w + 34] === 1 && out[35 * w + 35] === 0, "plano: 4 passos diagonais");
  const wall = new Uint8Array(w * h);
  markVisible(w, h, (x) => (x >= 32 ? 120 : 0), 30, 30, 6.4, wall);
  check(wall[30 * w + 34] === 1 && wall[30 * w + 35] === 0 && out[30 * w + 35] === 1 && wall[30 * w + 24] === 1, "subida de 120 px encurta a visão para o lado dela");
}

if (fails) { console.error(`relief: ${fails} falha(s)`); proc.exitCode = 1; } else
console.log("relief: ok");
