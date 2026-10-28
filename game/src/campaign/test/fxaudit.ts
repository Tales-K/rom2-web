/**
 * Auditoria do DESENHO durante os pilotos de missão (campaign/test/e2e_pilot.ts): a cada tique registra o sprite que a tela daria a
 * cada projétil novo (mission/fxrules.ts projectileSpriteId: magia, arma lançadora, flecha do units.reg) e procura auras do Shield que
 * seriam desenhadas em unidade FORA da visão do jogador (auraVisible com a névoa do jogador 1 sem relevo: mission/fog.ts, raio
 * sight + 1,4 por unidade ativa do jogador). Sem Pixi: é a mesma regra que mission/effects.ts aplica.
 */
import type { MissionData } from "../../mission/setup";
import { auraVisible, projectileSpriteId } from "../../mission/fxrules";
import type { Unit, World } from "../../sim/world";

export interface FxSample { tick: number; from: number; fromKind: string; weaponSpell?: string; kind: string; spell?: string; sprite?: string }
export interface FxAudit {
  projectiles: FxSample[];
  /** auras que a tela desenharia em unidade fora da visão (deve ficar vazio) */
  aurasOverFog: { tick: number; unit: number }[];
  /** quantas vezes (tique × unidade) uma aura visível foi desenhada */
  aurasShown: number;
  /** quantos tiques tiveram alguma unidade com Shield fora da visão (prova de que a regra foi exercitada) */
  shieldedOutOfSight: number;
}

/** Visibilidade para o jogador 1 como a névoa sem relevo (mission/fog.ts update): dentro de max(2, sight+1,4) de uma unidade própria. */
export function visibleToPlayer(w: World, u: Unit, player = 1): boolean {
  if (u.player === player) return true;
  const cx = Math.floor(u.x) + 0.5, cy = Math.floor(u.y) + 0.5;
  for (const v of w.units) {
    if (!v.active) continue;
    const shared = v.player === player || ((w.dip[v.player]?.[player] ?? 0) & 0x10) !== 0;
    if (!shared) continue;
    const r = Math.max(2, v.stats.sight + 1.4);
    const dx = cx - v.x, dy = cy - v.y;
    if (dx * dx + dy * dy <= r * r) return true;
  }
  return false;
}

export function fxAuditor(w: World, data: MissionData): { audit: FxAudit; tick: (t: number) => void } {
  const audit: FxAudit = { projectiles: [], aurasOverFog: [], aurasShown: 0, shieldedOutOfSight: 0 };
  const seen = new Set<number>();
  const projectileOf = (kind: string): number | undefined => { const v = data.anim[kind]?.Projectile; return v === undefined || v === null ? undefined : Number(v); };
  const isVisible = (u: { active: boolean }): boolean => visibleToPlayer(w, u as Unit);
  return {
    audit,
    tick(t: number): void {
      for (const p of w.projectiles) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        const from = w.get(p.from);
        audit.projectiles.push({
          tick: t, from: p.from, fromKind: from?.kind ?? "?", weaponSpell: from?.weaponSpell?.id, kind: p.kind, spell: p.spell?.id ?? undefined,
          sprite: projectileSpriteId(p, from, projectileOf),
        });
      }
      let outOfSight = false;
      for (const u of w.units) {
        if (!u.active || !u.buffs.some(b => b.spell === "27")) continue;
        const vis = visibleToPlayer(w, u);
        if (!vis) outOfSight = true;
        if (auraVisible(u, isVisible)) { audit.aurasShown++; if (!vis) audit.aurasOverFog.push({ tick: t, unit: u.id }); }
      }
      if (outOfSight) audit.shieldedOutOfSight++;
    },
  };
}
