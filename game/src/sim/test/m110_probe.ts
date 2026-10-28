/**
 * Sonda (diagnóstico, fora do npm test) da guerra da missão 110 com o herói parado e sem companheiros, como em
 * tools/refcap/original/build_m110.py (refs/trace/m110_idle*.jsonl): vida somada dos cavaleiros (grupo 11) e dos druidas (grupo 12)
 * a cada 5 s, primeiro lançamento dos magos dos cavaleiros e o fim da batalha (um dos lados todo morto) por semente.
 *   npx tsx src/sim/test/m110_probe.ts [sementes=3]
 * Original (3 partidas): fim aos 45,0 s / 39,9 s e 1 empate (sobra 1 mago no posto); magos lançam desde ~3 s.
 */
import { loadData, proc, run, startRun } from "./loader";
import { group, heroOf } from "./pilot";

import { TICKS_PER_SEC } from "../types";
const seeds = Number(proc.argv[2] ?? 3);
const data = await loadData(110);
const ends: number[] = [];
for (let s = 0; s < seeds; s++) {
  const r = startRun(data, heroOf(false, false), undefined, { companions: [] });
  const w = r.b.world, h = r.b.hero;
  w.rng.state = (0x2a11d052 + s * 7919) >>> 0;
  h.maxHp = h.hp = 100000; h.stats = { ...h.stats, healthRegen: 0 };
  const knights = group(r, 11), druids = group(r, 12), mages = knights.filter(u => u.spells.length);
  const mana0 = mages.map(u => u.mana);
  let end = -1, firstMageCast = -1;
  const curve: string[] = [];
  const hp = (l: typeof knights) => l.reduce((a, u) => a + (u.alive ? Math.max(0, u.hp) : 0), 0);
  run(r, TICKS_PER_SEC * 90, t => {
    if (firstMageCast < 0 && mages.some((u, i) => u.mana < mana0[i]! - 20)) firstMageCast = t / TICKS_PER_SEC;
    if (t % 100 === 0 && t <= 900) curve.push(`${t / TICKS_PER_SEC}s K${hp(knights)} D${hp(druids)}`);
    if (knights.every(u => !u.alive) || druids.every(u => !u.alive)) { end = t / TICKS_PER_SEC; return true; }
  });
  console.log(`semente ${s}: fim ${end < 0 ? "—" : end.toFixed(1) + " s"}, K ${knights.filter(u => u.alive).length} D ${druids.filter(u => u.alive).length}, ` +
    `1º lançamento dos magos ${firstMageCast} s\n  ${curve.join(" | ")}`);
  ends.push(end);
}
console.log("fins:", ends.map(e => e < 0 ? "empate" : e.toFixed(1)).join(", "));
