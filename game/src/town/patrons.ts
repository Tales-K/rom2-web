import type { Game } from "../core/game";
import type { Line, Texts } from "./common";
import { innPatrons } from "../campaign/engine";
import type { CampaignData, CampaignState, InnPatron } from "../campaign/types";

/**
 * Quem aparece na taverna: regras do Scenario.dll (campaign/engine.ts:innPatrons — ScenarioEnterInn, DLL 0x1000286b),
 * na ordem do original (conversas e ofertas do estágio, depois os mercenários da cidade).
 */
export interface Patron {
  npc: number;
  name: string;
  kind: "quest" | "chat" | "merc";
  /** retrato em assets/ui/inn/units/<sprite>_0.webp (graphics/interface/inn/unit<typeId>, npcs[].portrait) */
  sprite: string;
  /** missão oferecida (kind === "quest") */
  mission?: number;
  /** seção de town.json com a conversa (npc<N>talk<M> / npc<n>about) */
  talk?: string;
  acceptSection?: string;
  rejectSection?: string;
  /** frequentador do motor (código da taverna) */
  src: InnPatron;
}

const FALLBACK_SPRITES = ["unit4", "unit5", "unit7", "unit10", "unit12", "unit13", "unit15", "unit1"];

/** Todos os sprites de frequentadores que a taverna pode usar (para o pré-carregamento). */
export function patronSprites(): string[] { return ["unit15", "unit1", "unit24", ...FALLBACK_SPRITES]; }

function spriteOf(p: InnPatron): string {
  const m = p.portrait?.match(/inn\/(unit\d+)\//i);
  return m ? m[1].toLowerCase() : FALLBACK_SPRITES[p.npc % FALLBACK_SPRITES.length];
}

const MERC_NAMES: Record<number, string> = { 1: "Archer", 2: "Swordsman", 3: "Druid", 4: "Troll", 5: "Ginsush", 6: "Mage Knight", 7: "Catapult" };

export function buildPatrons(game: Game, texts: Texts, st: CampaignState, data: CampaignData, town: number): Patron[] {
  const hero = game.state.hero!;
  return innPatrons(st, data, town).map(p => {
    const merc = p.kind === 1 || p.kind === 2;
    // nome: o do campaign.json (história/npcnames.txt, sem a descrição entre parênteses); mercenários pelo papel
    const def = data.npcs[String(p.npc)] as (typeof data.npcs)[string] & { nameSource?: string } | undefined;
    let name = def && def.nameSource !== "unit-templates" ? def.name.replace(/\s*\(.*\)\s*$/, "") : texts.npcName(p.npc, hero);
    if (merc) name = MERC_NAMES[p.npc] ?? "Mercenary";
    return {
      npc: p.npc, name, kind: p.kind === 3 ? "quest" : merc ? "merc" : "chat", sprite: spriteOf(p), mission: p.mission,
      talk: p.textKey, acceptSection: p.acceptKey, rejectSection: p.rejectKey, src: p,
    } satisfies Patron;
  });
}

export type { Line };
