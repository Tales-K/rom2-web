/**
 * Galeria "Cut Scenes": máscara de vídeos liberados (puro, sem Pixi: usado pela campanha e pelos testes headless de campaign/test/e2e.ts).
 * O original guarda os bits no registro do Windows (global, não por save; exe 0x440c91/0x48f989) — aqui no localStorage.
 */
/** Cenas da galeria (cutscene.txt / data/campaign.json cutscenes): bit = id; "intro" sempre liberada (valor inicial 1 do registro). */
export const GALLERY: ReadonlyArray<{ bit: number; video: string; label: string }> = [
  { bit: 0, video: "intro", label: "Intro" }, { bit: 1, video: "teleport", label: "Astral travel" }, { bit: 2, video: "stars", label: "Starfall" },
  { bit: 3, video: "crown", label: "Crown" }, { bit: 4, video: "knights", label: "Knights' triumph" }, { bit: 5, video: "druids", label: "Druids' triumph" },
];
const KEY = "allods2web.cutscenes";

/** O que a galeria precisa do jogo (o `Game` completo serve). */
export interface CutsceneGame { state: { progress: { campaign?: { videos?: number[] } } } }

/** Máscara de cenas liberadas (bit 0 = intro, sempre). */
export function readMask(): number { try { return (Number(localStorage.getItem(KEY)) | 1) >>> 0; } catch { return 1; } }

/** Libera a cena `bit` (id da cutscene: 1 teleport, 2 stars, 3 crown, 4 knights, 5 druids) na galeria "Cut Scenes". Chamado quando o vídeo toca. */
export function markCutscene(bit: number): void {
  try { localStorage.setItem(KEY, String((readMask() | (1 << bit)) >>> 0)); } catch { /* sem armazenamento */ }
}

/** Cenas liberadas, na ordem do original (Intro, Astral travel, Starfall, Crown, Knights' triumph, Druids' triumph); soma o que o save atual já viu. */
export function unlockedCutscenes(game: CutsceneGame): { id: string; label: string }[] {
  let mask = readMask();
  for (const v of game.state.progress.campaign?.videos ?? []) if (v >= 0 && v < 32) mask |= 1 << v;
  return GALLERY.filter(g => (mask >> g.bit) & 1).map(g => ({ id: g.video, label: g.label }));
}
