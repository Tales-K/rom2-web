import type { SceneFactory } from "../core/scene";

/**
 * Registro de cenas (carregadas sob demanda). NÃO edite este arquivo ao implementar uma cena:
 * substitua o conteúdo do arquivo da cena (src/scenes/<Nome>Scene.ts) mantendo `export default class ... extends Scene`.
 */
export const SCENES: Record<string, SceneFactory> = {
  boot: () => import("./BootScene"),
  logos: () => import("./LogosScene"),
  intro: () => import("./IntroScene"),
  menu: () => import("./MenuScene"),
  chargen: () => import("./ChargenScene"),
  town: () => import("./TownScene"),
  shop: () => import("./ShopScene"),
  inn: () => import("./InnScene"),
  briefing: () => import("./BriefingScene"),
  globalmap: () => import("./GlobalMapScene"),
  mission: () => import("./MissionScene"),
  credits: () => import("./CreditsScene"),
  fame: () => import("./FameScene"),
};
