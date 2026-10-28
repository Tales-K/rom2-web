/**
 * Corpos, Animate Dead, Summon e "ressurreição" por Heal — regras lidas do allods2.exe e conferidas no original rodando
 * (frente MAGIA-RE, notes/magic-original.md; frente VIDA-ZERO, notes/combat-formulas.md §5). Sem PixiJS/DOM; o `World` chama estas funções.
 *
 *  - Vida do corpo (`Unit.corpseHp`, a vida +0x94 do servidor, que continua caindo depois da queda). Estados de quem "caiu" (vida ≤ 0,
 *      0x50f12c: +0x13c = 1, defesa ÷ 2, animação de queda):
 *      INCONSCIENTE (vida exatamente 0): estável, não sangra nem regenera (medido 100 s em 0); continua alvo de golpes e Heal o levanta.
 *      SANGRANDO (−10 < vida < 0): −1 a cada 4 s (regeneração 0x50fc5a, no segundo `% 4 == 0` do contador de 1/s [[0x6044c4]+0]; LAB mediu
 *      −3 → −9 em 20 s). A leitura antiga (MAGIA-RE: 16 pontos/s em rajada) era uma inferência do código (rotina chamada a cada tique de 16/s
 *      com o contador parado no segundo); a medição limpa do LAB (refs/trace/d_hp.jsonl, passos de 1 ponto) vale. Golpes em quem está caído continuam
 *      baixando a vida (cobra caída do herói: −3 → −19), sem limite.
 *      MORTE CONSUMADA: fim da animação E vida ≤ −10 → 0x510a70 (saque, abate/experiência, `UnitDead`) e primeiro desgaste do corpo
 *      (0x5110b8 é chamada pela morte: −10 → −11 no mesmo instante, medido). Herói: vida = −50; voador/flutuante (+0x4a > 1): −1000
 *      (some); invocado (+0x148 ≠ 0): −10000 (some).
 *      depois (0x5110b8, 1×/s no laço 0x52bbb7; só nos segundos pares): −1 a cada 2 s (medido −11 → −48 em 74 s). Estado do corpo por
 *      limiar: < −10 → 2 (cadáver → zumbi), < −20 → 3 (ossos → esqueleto), < −40 → 4 (pó → fantasma), < −600 → 5 (sumiu). Tipos 33..36 param em −60.
 *      [est] o golpe fatal NÃO limita a vida (vida − dano, como o golpe em quem já caiu): um golpe grande já deixa o corpo em ossos/pó.
 *  - Animate Dead (dispatcher 0x519db8, caso 22 = 0x51a91f): procura NA CÉLULA-ALVO um corpo em estado 2, depois 3, depois 4, de tipo fora
 *      de 0x52..0x62 (mortos-vivos não se levantam de novo); consome o corpo (vida −10001, estado 5) e cria "F_Zombie.1" / "F_Skeleton.1" /
 *      "Ghost" do jogador de quem lança, num grupo novo em Stand Ground (0x570f2b), sem duração e sem vínculo com quem lançou. Atributos
 *      vindos do corpo: zumbi vida máx. = a do corpo; esqueleto/fantasma = metade; toHit e defesa copiados (a defesa do corpo já foi
 *      dividida por 2 ao morrer, 0x50f20d); Body (zumbi) / Body÷2+1 (esqueleto), Reaction÷2+1, Mind e Spirit copiados. O poder não conta.
 *  - Summon (caso 25 = 0x51a595): criatura sorteada 1..3 = Squirrel / Turtle / Foot_Animated; nível = habilidade Astral ÷ 25 + 1 (1..4;
 *      nome "X" ou "X.n"); nasce perto de quem lança (raio 6), do jogador dele, grupo novo em Guard (0x5709d9), +0x148 = id de quem invocou.
 *      Sem duração: 1×/s (0x52bbb7) cada invocador com N invocações vivas sorteia r = 1..100 e, se r < N, uma delas morre (sem corpo).
 *  - Invocadas e levantadas (+0x1a0): não deixam saque nem dão experiência (0x510bc2, 0x512900).
 *  - Heal (caso 24 = 0x51a2b8): cura quem não está em guerra com quem lança, tem regeneração (+0x98 ≠ 0) e vida > −10; se a vida passar de
 *      0, a unidade levanta (0x510484 → 0x510534: estado 0, defesa ×2 de volta, vida ≥ 1). Ou seja: só salva quem ainda está "sangrando".
 */
import { skillFromExp } from "./stats";
import { MINIMAL_GUARD_RANGE, type Unit, type World } from "./world";
import type { SpellDef } from "./spells";

/** Limiares da vida do corpo [exe 0x5110b8 / 0x510a70]. */
export const CORPSE = {
  /** vida a partir da qual a morte é consumada (fim da animação) */
  DEATH: -10,
  ZOMBIE: -10, SKELETON: -20, GHOST: -40, GONE: -600,
  /** herói morto: pula direto para "pó" [exe 0x511010] */
  HERO: -50,
  /** voador/flutuante: some [exe 0x50f27e] */
  FLYING: -1000,
  /** corpo consumido por Animate Dead / invocação morta [exe 0x51abad, 0x510aaa] */
  CONSUMED: -10001,
} as const;

/** Tipos (units.reg) que não se levantam com Animate Dead: zumbis/esqueletos 0x52..0x62 [exe 0x51a9a4]. */
export const UNRAISABLE_MIN = 0x52, UNRAISABLE_MAX = 0x62;
/** Templates criados por Animate Dead conforme o estado do corpo [exe 0x51ad30/0x51ae48/0x51af6d]. */
export const RAISE_TEMPLATE: Record<number, string> = { 2: "F_Zombie.1", 3: "F_Skeleton.1", 4: "Ghost" };
/** Criaturas do Summon (sorteio 1..3) [exe 0x51a705]. */
export const SUMMON_CREATURES = ["Squirrel", "Turtle", "Foot_Animated"] as const;

/** Estado do corpo como o +0x13c do servidor: 0 vivo, 1 morrendo, 2 cadáver, 3 ossos, 4 pó, 5 sumiu. */
export function corpseStage(u: Unit): number {
  if (u.alive) return 0;
  if (!u.bodyDead) return 1;
  const h = u.corpseHp;
  return h < CORPSE.GONE ? 5 : h < CORPSE.GHOST ? 4 : h < CORPSE.SKELETON ? 3 : h < CORPSE.ZOMBIE ? 2 : 1;
}

/** Queda (world.fall, vida ≤ 0 depois do golpe): a vida do golpe (vida − dano, sem limite) vira a vida do corpo. Vida EXATAMENTE 0 =
 *  inconsciente (não sangra, como o refém da missão 50); negativa = sangrando. */
export function onFell(u: Unit, hpAfterDamage: number): void {
  u.corpseHp = Math.min(0, Math.round(hpAfterDamage));
  u.bodyDead = false;
}

/** Caído que ainda pode ser salvo: inconsciente (vida 0) ou sangrando. */
export const isUnconscious = (u: Unit): boolean => u.downed && u.corpseHp === 0;
export const isBleeding = (u: Unit): boolean => u.downed && u.corpseHp < 0;

/** Morte consumada (world.consumeDeath, 0x510a70): o corpo passa a se decompor. Invocado: some; voador: some; herói: pó (−50); os demais
 *  levam o 1º desgaste de 0x5110b8 (chamada pela morte). */
export function onConsumed(u: Unit): void {
  u.bodyDead = true;
  if (u.summoner) u.corpseHp = CORPSE.CONSUMED;
  else if (u.flying) u.corpseHp = CORPSE.FLYING;
  else if (u.isHero) u.corpseHp = Math.min(u.corpseHp, CORPSE.HERO);
  else u.corpseHp--;
}

/** Habilidade Astral (herói: pela experiência; outros: magicSkills do template). */
export function astralSkill(u: Unit): number {
  if (u.heroInfo) return skillFromExp(u.heroInfo.skillExp.astral ?? 0);
  return u.stats.magicSkills?.astral ?? 0;
}

/** Nível da criatura do Summon: Astral ÷ 25 + 1, de 1 a 4 [exe 0x51a69e]. */
export function summonLevel(u: Unit): number { return Math.max(1, Math.min(4, Math.floor(astralSkill(u) / 25) + 1)); }

/** Nome do template da criatura `k` (0..2) no nível `lvl` ("Squirrel", "Squirrel.2"...). */
export function summonTemplateName(k: number, lvl: number): string {
  const base = SUMMON_CREATURES[Math.max(0, Math.min(2, k))]!;
  return lvl > 1 ? `${base}.${lvl}` : base;
}

/** Summon [exe 0x51a595]: cria a criatura perto de quem lança. Devolve a unidade (ou undefined sem fábrica/template). */
export function summonCreature(w: World, u: Unit, s: SpellDef): Unit | undefined {
  const name = summonTemplateName(w.rng.one(3, 0x51a698) - 1, summonLevel(u));
  const init = w.summonFactory?.(u, u.cx, u.cy, s.power ?? 0, name);
  if (!init) { w.events.push({ type: "message", text: "Summon is not available" }); return undefined; }
  const c = w.grid.nearestFree(u.cx, u.cy, !!init.stats.flying, 6) ?? { x: u.cx, y: u.cy };
  const m = w.spawn({ ...init, x: c.x, y: c.y, player: u.player });
  m.dynamic = true; w.exeWorld.lists.magic.addTail(m.rec.addr);   // [0x672f64]+4: o desgaste de 0x52bbb7 a conta
  m.summoner = u.id;
  m.home = { x: m.cx, y: m.cy };
  m.ai = { type: "guard", range: MINIMAL_GUARD_RANGE };
  w.events.push({ type: "summon", unit: m.id, by: u.id });
  return m;
}

/** Corpo levantável na célula: estado 2, depois 3, depois 4; tipo fora de 0x52..0x62 [exe 0x51a91f]. */
export function corpseAt(w: World, x: number, y: number): Unit | undefined {
  for (const want of [2, 3, 4]) {
    for (const u of w.units) {
      if (u.alive || u.phased || u.cx !== x || u.cy !== y) continue;
      if (u.typeId >= UNRAISABLE_MIN && u.typeId <= UNRAISABLE_MAX) continue;
      if (corpseStage(u) === want) return u;
    }
  }
  return undefined;
}

/** Animate Dead [exe 0x51a91f]: levanta o corpo da célula-alvo como zumbi/esqueleto/fantasma do jogador de quem lança. */
export function raiseDead(w: World, u: Unit, s: SpellDef, t: Unit | undefined, x: number, y: number): Unit | undefined {
  const cx = t && t.alive ? t.cx : x, cy = t && t.alive ? t.cy : y;
  const c = corpseAt(w, cx, cy);
  if (!c) return undefined;
  const stage = corpseStage(c);
  const init = w.summonFactory?.(u, c.cx, c.cy, s.power ?? 0, RAISE_TEMPLATE[stage]!);
  if (!init) { w.events.push({ type: "message", text: "Animate Dead is not available" }); return undefined; }
  c.corpseHp = CORPSE.CONSUMED;
  const half = stage !== 2;
  const st = {
    ...init.stats,
    health: Math.max(1, half ? Math.floor(c.maxHp / 2) : c.maxHp),
    attack: c.stats.attack,
    defense: Math.floor(c.stats.defense / 2),
    mind: c.stats.mind ?? init.stats.mind,
  };
  const p = w.grid.nearestFree(c.cx, c.cy, !!st.flying, 6) ?? { x: c.cx, y: c.cy };
  const m = w.spawn({ ...init, stats: st, x: p.x, y: p.y, player: u.player });
  m.dynamic = true; w.exeWorld.lists.magic.addTail(m.rec.addr);   // [0x672f64]+4
  m.home = { x: m.cx, y: m.cy };
  m.ai = { type: "hold" };
  w.events.push({ type: "summon", unit: m.id, by: u.id });
  return m;
}

/** Heal em quem está morrendo [exe 0x51a2b8 → 0x510484]: ainda sangrando (vida > −10), sem guerra e com regeneração. */
export function canRevive(w: World, healer: Unit, t: Unit): boolean {
  return !t.alive && !t.bodyDead && !t.isHero && !t.phased && t.corpseHp > CORPSE.DEATH
    && !w.hostile(healer.player, t.player) && (t.stats.healthRegen ?? 1) !== 0;
}

/** Aplica a cura `amount` em quem está morrendo (devolve false se não pode): se a vida passar de 0 a unidade levanta, senão só
 *  sangra menos. */
export function healDying(w: World, healer: Unit, t: Unit, amount: number): boolean {
  if (!canRevive(w, healer, t)) return false;
  const hp = Math.min(t.maxHp, t.corpseHp + amount);
  if (hp <= 0) t.corpseHp = hp;
  else w.revive(t, hp);
  return true;
}
