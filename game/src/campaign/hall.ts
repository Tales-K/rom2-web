/**
 * Hall da fama do original (allods2.exe; engenharia reversa e confirmação por memória em 19/10, docs/GAPS.md [FIDELIDADE-RESTO]).
 *
 * O hall é um objeto em +0x598 da janela principal: +4 = tempo jogado em missões, +8 = abates, +0xc = 10 (lugares).
 *  - abates (+8): +1 cada vez que uma unidade de tipo marcado (flag bit 0 da tabela de tipos, exe 0x41e830) que estava viva morre na
 *    visão do cliente (exe 0x410891). Confirmado no original: matar as 2 cobras da missão 10 levou +8 de 0 a 2.
 *  - tempo (+4): ao fim de cada missão soma `ticks / 16` (exe 0x486bba), com `ticks` = o contador do servidor `[0x6044c4]+4`, que anda a
 *    ~16 por segundo (medido: 83 por 5 s): na prática, os segundos de jogo dentro das missões.
 *  - XP: soma da experiência das 5 habilidades da unidade do herói (cliente +0x110, exe 0x469cbc: o "XP" da ficha, 7320 no início).
 *  - pontuação (exe 0x4a8d28, ao vencer com o estágio ≥ 120): `trunc(XP / (tempo × 10) × abates)`; com tempo = 0,
 *    `trunc(XP / 500000 × abates)`. Inteiro de 32 bits.
 *  - inserção (exe 0x4a8c5e): percorre a lista de cima para baixo e põe o novo ANTES da 1ª entrada com pontos ≤ aos dele
 *    (empate: o novo fica acima); sem achar, vai para o fim; depois corta tudo além de 10.
 */
import type { HeroState } from "../core/state";
import type { CampaignState } from "./types";

export interface FameEntry { name: string; score: number; date?: string }

/** Lista inicial do original (famehall.dat da instalação limpa; refs/original/hall_of_fame.png) */
export const DEFAULT_FAME: ReadonlyArray<readonly [string, number]> = [["Diamond", 70006], ["Glazz", 65817], ["Gella", 56966], ["GreatAlex", 53043], ["Oberic", 44925], ["Renn", 37399], ["Violett", 29751], ["Rex", 25479], ["Monk", 18114], ["Nick", 0]];
export const FAME_SLOTS = 10;
/** divisores do exe: tempo × 10 e o valor usado quando o tempo é 0 (doubles em 0x5cecd0 e 0x5cecd8) */
const TIME_K = 10, NO_TIME = 500000;

export function fameScore(xp: number, kills: number, seconds: number): number {
  const raw = seconds !== 0 ? (xp / (seconds * TIME_K)) * kills : (xp / NO_TIME) * kills;
  return Math.trunc(raw) | 0;
}

/** XP do hall = soma da experiência por habilidade (o "XP" da ficha); sem ela, a experiência acumulada do herói. */
export function hallXp(hero: Pick<HeroState, "skillExp" | "exp">): number {
  const se = hero.skillExp;
  if (se && Object.keys(se).length) return Object.values(se).reduce((a, b) => a + (Number(b) || 0), 0);
  return hero.exp ?? 0;
}

/** Fim de missão (`ms` = tempo de jogo da missão, `kills` = unidades mortas): acumula no estado da campanha (exe 0x486bba/0x410891). */
export function recordHallStats(c: Pick<CampaignState, "hall">, ms: number, kills: number): void {
  const h = c.hall ?? { seconds: 0, kills: 0 };
  const ticks = Math.floor((ms * 16) / 1000);          // ~16 ticks/s no original
  h.seconds += Math.trunc(ticks / 16);
  h.kills += Math.max(0, Math.floor(kills));
  c.hall = h;
}

/** Sem estatísticas gravadas (saves e missões que ainda não registram abates/tempo): estimativa por missão concluída [est]. */
export const FALLBACK_PER_MISSION = { seconds: 600, kills: 20 };
export function hallStatsOf(c: Pick<CampaignState, "hall" | "log"> | undefined): { seconds: number; kills: number; estimated: boolean } {
  if (c?.hall && (c.hall.seconds > 0 || c.hall.kills > 0)) return { ...c.hall, estimated: false };
  const n = c?.log.length ?? 0;
  return { seconds: n * FALLBACK_PER_MISSION.seconds, kills: n * FALLBACK_PER_MISSION.kills, estimated: true };
}

/** Insere `me` na lista do hall como o exe (empate: o novo sobe) e devolve a lista cortada em 10 e o lugar (-1 = fora). */
export function insertFame(list: FameEntry[], me: FameEntry, slots = FAME_SLOTS): { list: FameEntry[]; rank: number } {
  const out = list.slice();
  let at = out.findIndex(e => me.score >= e.score);
  if (at < 0) at = out.length;
  out.splice(at, 0, me);
  const top = out.slice(0, slots);
  return { list: top, rank: at < slots ? at : -1 };
}
