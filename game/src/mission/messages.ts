/** Seleção das falas de `texts/mission<N>.json` (seções `event<N>`, `failure<N>`) conforme o herói (sexo/classe). */
import type { HeroState } from "../core/state";

export interface TextEntry { tags: Record<string, unknown>; text: string; }
export interface Line { npc: number; text: string; part: number; }

export function pickLines(entries: TextEntry[] | undefined, hero: HeroState): Line[] {
  if (!entries) return [];
  const male = hero.sex === "male", mage = hero.heroClass === "mage";
  const ok = (t: Record<string, unknown>) => {
    if (t.iammale && !male) return false;
    if (t.iamfemale && male) return false;
    if (t.iamfighter && mage) return false;
    if (t.iammage && !mage) return false;
    return true;
  };
  return entries.filter(e => ok(e.tags) && e.text.trim())
    .map((e, i) => ({ npc: Number(e.tags.npc ?? 0), text: e.text.trim(), part: Number(e.tags.part ?? i + 1) }))
    .sort((a, b) => a.part - b.part);
}
