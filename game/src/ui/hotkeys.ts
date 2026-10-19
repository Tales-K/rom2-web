/**
 * Atalhos globais do jogo (um jogador, como no original): F2 = Save Game, F3 = Load Game, F10 = menu do jogo.
 * `installGameHotkeys(game)` é idempotente; hoje é chamado pela TownScene e pelo MenuScene (pedido em docs/REQUESTS.md para o
 * orquestrador chamá-lo uma vez no construtor do Game ou em main.ts).
 *
 * Valem nas cenas com jogo em andamento: town, shop, inn, briefing, globalmap e mission (esta só depois de registrar o contexto com
 * `setMissionMenuContext`). F3 também funciona no menu principal (abre "Load Game"). Com uma janela modal aberta, as teclas vão
 * para ela (ui/modal.ts), então não abrem uma segunda janela. Esc continua sendo de cada cena (todas as cenas da cidade abrem o
 * menu do jogo com Esc; a missão deve abrir `openGameMenu(game, { mission })`, ver docs/REQUESTS.md).
 */
import type { Game } from "../core/game";
import { modalOpen } from "./modal";
import { openGameMenu, sceneRoot, type MissionMenuContext } from "./gamemenu";
import { openLoadGame, openSaveGame } from "./saveui";

const TOWN_SCENES = new Set(["town", "shop", "inn", "briefing", "globalmap"]);

let installedFor: Game | undefined;
let missionCtx: MissionMenuContext | undefined;

/** A MissionScene registra seu contexto ao entrar e limpa (undefined) ao sair. */
export function setMissionMenuContext(ctx: MissionMenuContext | undefined): void { missionCtx = ctx; }
export function missionMenuContext(): MissionMenuContext | undefined { return missionCtx; }

export function installGameHotkeys(game: Game): void {
  if (installedFor === game || typeof window === "undefined") return;
  installedFor = game;
  window.addEventListener("keydown", e => {
    if (e.defaultPrevented || modalOpen() || e.ctrlKey || e.altKey || e.metaKey || e.repeat) return;
    if (e.key !== "F2" && e.key !== "F3" && e.key !== "F10") return;
    const scene = game.scenes.name;
    const inMission = scene === "mission" && !!missionCtx;
    const inTown = TOWN_SCENES.has(scene) && !!game.state.hero;
    const inMenu = scene === "menu";
    if (!inMission && !inTown && !(inMenu && e.key === "F3")) return;
    e.preventDefault();
    const parent = sceneRoot(game);
    const m = inMission ? missionCtx : undefined;
    m?.setPaused?.(true);
    const resume = () => m?.setPaused?.(false);
    if (e.key === "F2") openSaveGame(game, parent, { mission: m ? () => m.snapshot() : undefined, missionTitle: m?.title, onClose: resume });
    else if (e.key === "F3") openLoadGame(game, parent, { onClose: resume });
    else openGameMenu(game, { parent, mission: m });
  });
}
