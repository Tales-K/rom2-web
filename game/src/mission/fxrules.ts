/**
 * Regras PURAS do desenho dos efeitos da missão (mission/effects.ts): que sprite de projectiles.reg um projétil usa e quando a aura
 * de uma unidade aparece. Sem Pixi, para os cenários de campanha (campaign/test/e2e*.ts) conferirem o que a tela mostraria.
 *
 *  - magia N (spells.json, 1..29) → projétil/efeito `8 + 2N` (ou `9 + 2N`) de projectiles.reg (Fire Arrow 1 → 10 firebolt);
 *  - golpe à distância de quem tem ARMA LANÇADORA (cajado do mago, `weaponSpell`) → o projétil da magia da arma: o cajado dispara a sua
 *    magia, nunca uma flecha (bug relatado: o mago "atirava flechas" na cobra caída — o golpe físico num alvo caído sai pelo golpe da
 *    máquina, sem magia, e o desenho caía na flecha genérica);
 *  - golpe "fire" (Human Mage/Dragão do units.reg) → 10; flecha → campo `Projectile` do units.reg do atirador (1 arco, 2 besta, 3 orc,
 *    4 goblin), senão 1; onda sônica e outros sem sprite → undefined (desenho simples).
 *  - aura do Shield (magia 27): só em unidade viva, ativa e VISÍVEL para o jogador (névoa de guerra): nada se desenha sobre a névoa.
 */

export interface ProjectileLike { kind: string; spell: { id: string } | null }
export interface ShooterLike { kind: string; weaponSpell?: { id: string } | null }
export interface AuraUnitLike { active: boolean; alive: boolean; phased: boolean; buffs: readonly { spell: string }[] }

export const SHIELD_SPELL = "27";
export const ARROW_SPRITES = ["1", "2", "3", "4"] as const;

/** Projétil/efeito do projectiles.reg usado pela magia `id` (`has` = existe no world.json; sem ele, o primeiro candidato). */
export function spellSpriteId(id: number | string, has: (k: string) => boolean = () => true): string | undefined {
  const n = Number(id);
  if (!Number.isFinite(n) || n < 1 || n > 29) return undefined;
  // magias cujo sprite não é o `8 + 2N` (conferido em capturas: Fireball 12, Ice Missile... ver effects.ts antes de 28/10)
  const fixed: Record<number, string> = { 2: "12", 3: "15", 6: "21", 7: "23", 9: "27", 11: "30", 16: "40", 17: "43" };
  if (fixed[n]) return fixed[n];
  for (const k of [8 + 2 * n, 9 + 2 * n]) if (has(String(k))) return String(k);
  return undefined;
}

/** Sprite do projétil `p` disparado por `from` (`projectileOf` = campo Projectile do units.reg do tipo). */
export function projectileSpriteId(p: ProjectileLike, from: ShooterLike | undefined, projectileOf: (kind: string) => number | undefined,
  has: (k: string) => boolean = () => true): string | undefined {
  if (p.spell) return spellSpriteId(p.spell.id, has);
  if ((p.kind === "arrow" || p.kind === "fire") && from?.weaponSpell) return spellSpriteId(from.weaponSpell.id, has);
  if (p.kind === "fire") return "10";
  if (p.kind === "arrow") {
    const n = from ? Number(projectileOf(from.kind) ?? 1) : 1;
    return String(n >= 1 && n <= 4 ? n : 1);
  }
  return undefined;
}

/** A aura do Shield de `u` deve estar na tela? */
export function auraVisible<U extends AuraUnitLike>(u: U, isVisible: (u: U) => boolean): boolean {
  if (!u.active || !u.alive || u.phased) return false;
  if (!u.buffs.some(b => b.spell === SHIELD_SPELL)) return false;
  return isVisible(u);
}
