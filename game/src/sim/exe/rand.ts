/**
 * Porta literal do servidor do allods2.exe: o objeto de sorteio uniforme do mundo (mundo+0 = divisor, 0x8000 no jogo).
 * Portadas: 0x57afc0 Rand_UniformObject, 0x57afd0.
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
