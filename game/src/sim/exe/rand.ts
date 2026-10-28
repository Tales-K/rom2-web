/**
 * Porta literal do servidor do allods2.exe: o objeto de sorteio uniforme do mundo (mundo+0 = divisor, 0x8000 no jogo).
 * Portadas: 0x57afc0 Rand_UniformObject, 0x57afd0, 0x51fa25 Rand_Inclusive, 0x51fa4e Rand_One, 0x57aff0 Rand_Range.
 * `site` = endereço de retorno no chamador do exe (rotulagem dos sorteios do `Rng`, sim/rng.ts; não é estado do exe).
 */
import type { RandSite } from "../rng";
import type { WorldRec } from "./types";

/** 0x57afc0 Rand_UniformObject (thiscall; `this` = mundo, sem uso): o rand() cru do CRT (0x583290), 0..32767. `a` = argumento do
 *  chamador para o replay conferir (−1 = nenhum). */
export function randUniformObject(wd: WorldRec, site: RandSite, a = -1): number {
  return wd.rng.draw(site, a);
}

/** 0x57afd0 (thiscall; `this` = mundo): rand() × n / [mundo+0] (imul + idiv: divisão inteira com sinal). */
export function fn_0x57afd0(wd: WorldRec, n: number, site: RandSite): number {
  const r = randUniformObject(wd, site, n);
  if ((wd.divisor | 0) === 0) throw new Error("0x57afd0: divisão por zero (#DE no exe)");
  return Math.trunc(Math.imul(r, n | 0) / (wd.divisor | 0));
}

/** 0x51fa25 Rand_Inclusive (cdecl): rand(n) = (rand() × (n+1)) >> 15, 0..n; n = 0 → 0 SEM sorteio. O rand() do CRT (0x583290) é o
 *  `Rng` do mundo; `site` = endereço de retorno no chamador (rotulagem). Produto em 32 bits com sinal (imul) e o ajuste de sinal do `>>`. */
export function randInclusive(wd: WorldRec, n: number, site: RandSite): number {
  if ((n | 0) === 0) return 0;
  const uVar2 = wd.rng.draw(site, n);
  let iVar1 = Math.imul(uVar2, (n + 1) | 0);
  iVar1 = (iVar1 + ((iVar1 >> 31) & 0x7fff)) >> 15;
  return iVar1;
}

/** 0x51fa4e Rand_One (cdecl): 1 + Rand_Inclusive(n − 1), ou seja, 1..n (n = 1 → 1 sem sorteio). */
export function randOne(wd: WorldRec, n: number, site: RandSite): number {
  const iVar1 = randInclusive(wd, (n - 1) | 0, site);
  return (iVar1 + 1) | 0;
}

/** 0x57aff0 Rand_Range (thiscall; `this` = mundo): rand() × (b − a + 1) / [mundo+0] + a (imul/idiv com sinal). */
export function randRange(wd: WorldRec, a: number, b: number, site: RandSite): number {
  const iVar1 = randUniformObject(wd, site, ((b - a) + 1) | 0);
  if ((wd.divisor | 0) === 0) throw new Error("0x57aff0: divisão por zero (#DE no exe)");
  return (Math.trunc(Math.imul(iVar1, ((b - a) + 1) | 0) / (wd.divisor | 0)) + a) | 0;
}
