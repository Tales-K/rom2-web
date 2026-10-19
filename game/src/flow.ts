/**
 * Fluxo canônico das cenas (campanha dirigida por data/campaign.json; motor em campaign/engine.ts, cola em campaign/runtime.ts).
 *
 *   boot -> logos -> intro -> menu -> chargen -> town(Plagat) -> inn (falar com o mensageiro põe a 10 no mapa)
 *        -> town -> portão -> globalmap (Uimoir: o herói anda sozinho) -> mission(10) -> town* -> [vídeo teleport] -> mission(20)
 *        -> town* -> globalmap (Yases) -> town(Kaarg) / mission(N) -> town* -> ... -> estágio 120 -> credits(hall da fama)
 *   town* = a cena "town" recebe o MissionResult, aplica a vitória no motor, toca os vídeos e redireciona
 *           (mapa-múndi se houver cidade; senão a 1ª missão da lista direto; derrota: a última cidade).
 *
 * Parâmetros trocados entre cenas:
 *   menu      -> chargen         : (nenhum)  [Novo jogo]           | menu -> town : (nenhum) [Continuar/Load Game]
 *   chargen   -> town            : o herói já foi gravado em game.state (state.newGame(hero)); a campanha nasce na cidade
 *   town      -> shop | inn      : { town: number }   (1 Plagat, 2 Kaarg, 3 acampamento druida)
 *   inn|shop  -> town            : { town: number }
 *   town      -> globalmap       : (nenhum)  [portão; leaveTown no motor]
 *   globalmap -> town            : { town: number }
 *   globalmap -> mission         : MissionParams { id }  (sem briefing, como o original)
 *   mission   -> town            : MissionResult { id, outcome, scenarioVars? } (state.completeMission enfileira a vitória)
 *   town      -> credits         : { ending: true }  (estágio 120)
 *   briefing  -> mission         : MissionParams { id }  (tela fora do fluxo do original; atalho `#cena=briefing`)
 *   qualquer  -> menu            : ESC abre o menu do jogo (cada cena decide)
 */
export const SCENE_NAMES = ["boot", "logos", "intro", "menu", "chargen", "town", "shop", "inn", "briefing", "globalmap", "mission", "credits"] as const;
export type SceneName = (typeof SCENE_NAMES)[number];

/** Próxima cena padrão (usada pelos stubs). */
export const NEXT: Record<SceneName, SceneName> = {
  boot: "logos", logos: "intro", intro: "menu", menu: "chargen", chargen: "town", town: "inn",
  shop: "town", inn: "town", briefing: "mission", globalmap: "mission", mission: "town", credits: "menu",
};

/** A primeira missão da campanha (mission10.txt: "Great Mage Skrakan"; scenario/10.alm). */
export const FIRST_MISSION = 10;
