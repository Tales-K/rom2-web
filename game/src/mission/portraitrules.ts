/**
 * Regra PURA do retrato de uma unidade na missão (painel oval do HUD e janelas de fala), a mesma do exe 0x494832 / 0x49510c
 * (notes/inn-npcs.md, GAME_DIFFS #71): humano (`flags & 0x11`: herói, grupo, humano) → boneca (HumanBack + face + equipamento);
 * monstro/catapulta → bitmap `graphics\infowindow\<InfoPicture do tipo><face se > 1>.bmp`; sem bitmap → quadro parado do sprite.
 * Usada por scenes/MissionScene.ts e auditada por campaign/test/units_audit.ts.
 */
export interface PortraitUnit { isHero?: boolean; npc: number; kind: string }
/** entrada de unit-templates.json (campos lidos: kind, face, female, mage, equipment) */
export type PortraitTemplate = { [k: string]: unknown };
export interface PortraitData { templates?: Record<string, PortraitTemplate>; anim: Record<string, { InfoPicture?: string } | undefined> }

export interface DollOpts { female: boolean; mage: boolean; face: number; items: number[] }

/** Boneca do template de um humano não-herói (unit-templates.json: female/mage/face/equipment); undefined para monstros/sem template. */
export function templateDoll(u: PortraitUnit, data: PortraitData): DollOpts | undefined {
  const t = u.npc ? data.templates?.[String(u.npc)] : undefined;
  if (!t || (t.kind !== "human" && t.kind !== "hero")) return undefined;
  const eq = (t.equipment as { id: number }[] | undefined) ?? [];
  return { female: !!t.female, mage: !!t.mage, face: Number(t.face ?? 0), items: eq.map(e => Number(e.id)).filter(n => Number.isFinite(n) && n > 0) };
}

/**
 * Chave do retrato: "doll:hero" (boneca do herói), "doll:tpl:<template>" (boneca do template), "<infopicture><face>" (bitmap de
 * graphics/infowindow, assets/ui/hud/info/<chave>.png) ou "sprite:<tipo>" (quadro parado do sprite; sem InfoPicture).
 */
export function portraitKeyFor(u: PortraitUnit, data: PortraitData): string {
  if (u.isHero) return "doll:hero";
  if (templateDoll(u, data)) return `doll:tpl:${u.npc}`;
  const am = data.anim[u.kind];
  if (!am?.InfoPicture) return `sprite:${u.kind}`;
  const face = Number(data.templates?.[String(u.npc)]?.face ?? 0);
  return (am.InfoPicture + (face > 1 ? String(face) : "")).toLowerCase();
}
