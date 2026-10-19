/**
 * Ciclo dia/noite da missão (opção "Day/Night changes" = Settings.dayNight; frente MOTOR-B). Sem PixiJS (testável).
 * Dados: bloco 0 do .alm (`maps/<n>.json` info.startTime em minutos desde 0h — 360 = 6:00 na missão 10). O jogo tem
 * sons de ambiente separados de dia/noite (sfx.reg ambient\*-day / *-night), o que confirma que há noite.
 * NÃO decifrado (ver docs/GAPS.md): a velocidade do relógio e a curva/cor da luz. Usamos 1 minuto do jogo por segundo
 * de simulação (dia de 24 min), amanhecer 4:00–6:00, anoitecer 19:00–21:00, noite a 55% de luz puxando para o azul.
 * A captura do original no início da missão 10 (6:00) não mostra escurecimento → às 6:00 a luz já é plena.
 */

/** minutos do jogo por segundo de simulação */
export const GAME_MINUTES_PER_SEC = 1;
const DAWN_START = 4 * 60, DAWN_END = 6 * 60, DUSK_START = 19 * 60, DUSK_END = 21 * 60;
const NIGHT = { r: 0.5, g: 0.55, b: 0.72 };

/** Hora do jogo (minutos 0..1439) depois de `simSeconds` a partir de `startTime`. */
export function gameMinutes(startTime: number, simSeconds: number): number {
  return (((startTime + simSeconds * GAME_MINUTES_PER_SEC) % 1440) + 1440) % 1440;
}

/** Fração de "dia" (1 = luz plena, 0 = noite) na hora `min`. */
export function daylight(min: number): number {
  if (min >= DAWN_END && min <= DUSK_START) return 1;
  if (min > DUSK_START && min < DUSK_END) return 1 - (min - DUSK_START) / (DUSK_END - DUSK_START);
  if (min > DAWN_START && min < DAWN_END) return (min - DAWN_START) / (DAWN_END - DAWN_START);
  return 0;
}

/** Cor multiplicativa (0xRRGGBB) da luz ambiente para a fração de dia `d`. */
export function lightColor(d: number): number {
  const k = Math.max(0, Math.min(1, d));
  const c = (n: number) => Math.round(255 * (n + (1 - n) * k));
  return (c(NIGHT.r) << 16) | (c(NIGHT.g) << 8) | c(NIGHT.b);
}
