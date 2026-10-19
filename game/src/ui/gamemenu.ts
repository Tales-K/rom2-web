/**
 * Menu do jogo (Esc / estátua da cidade / F10), como no original (main/text/dialogs.txt):
 *   ~Save Game / ~Load Game / Game ~Options / Sou~nd Options / [~Quest Objectives / ~Restart Quest / ~End Quest / ~Victory!] /
 *   ~Return to Game / ~Exit to Main Menu / Exit to ~Windows
 * Os itens entre colchetes só aparecem dentro de uma missão (`ctx.mission`).
 *
 *   openGameMenu(game, { parent?, mission?, onClose? })   -> MenuWindow
 *   openGameMenuIn(game, parent, onClose)                 -> Container   (assinatura do antigo town/common.ts openGameMenu)
 *   openGameOptions / openSoundOptions / openQuestObjectives
 *
 * Opções gravadas em game.state.settings (+ saveSettings): velocidade, suavização, dia/noite, mostrar vida, formação, recuo;
 * volumes via game.audio (que espelha em settings). Atalhos globais F2/F3: ui/hotkeys.ts.
 */
import { Container } from "pixi.js";
import type { Game } from "../core/game";
import type { MissionSave } from "../core/savedata";
import type { Settings } from "../core/state";
import { ConfirmDialog } from "./dialog";
import { CLASSIC, COL, ItemColumn, classicMenuItem, checkbox, label, loadMenuKit, menuItem, menuKitNow, menuStack, openWindow, radioGroup, slider, type MenuKit, type MenuWindow } from "./menukit";
import { ClassicList, screenHint } from "./classiclist";
import { ClassicSlider } from "./classicslider";
import { makeText } from "./text";
import { justified } from "./tipwin";
import { loadSlotAndGo, openLoadGame, openSaveGame } from "./saveui";

/** O que a cena de missão oferece ao menu (ver docs/REQUESTS.md, [SAVE-LOAD→MISSÃO]). */
export interface MissionMenuContext {
  id: number;
  /** título da missão (lista de saves, "Quest: <título>") */
  title?: string;
  /** snapshot completo para "Save Game" (sim/snapshot.ts snapshotMission) */
  snapshot(): MissionSave;
  /** linhas da janela "Quest Objectives" */
  objectives(): string[];
  restart(): void;
  /** "End Quest": abandona a missão e volta à cidade */
  end(): void;
  /** pausa a simulação enquanto o menu (ou uma subjanela) está aberto */
  setPaused?(on: boolean): void;
  /** true quando a missão já foi cumprida (mostra "~Victory!") */
  victory?(): boolean;
  onVictory?(): void;
  /** "Exit to Main Menu"/"Exit to Windows" no meio da missão: descarta o que a missão mudou e vai ao menu principal */
  exit?(): void;
  /** opções mudaram (velocidade do jogo etc.) */
  onSettingsChanged?(s: Settings): void;
}

export interface GameMenuContext {
  /** contêiner onde a janela é desenhada (padrão: a raiz da cena atual) */
  parent?: Container;
  mission?: MissionMenuContext;
  onClose?(): void;
}

/** Raiz da cena atual (o SceneManager anexa a raiz de cada cena ao stage). */
export function sceneRoot(game: Game): Container {
  const ch = game.app.stage.children;
  return (ch[ch.length - 1] as Container | undefined) ?? game.app.stage;
}

const fallbackKit = (): MenuKit => menuKitNow() ?? { ok: false, lm: [], scr: [], radio: [] };

/** Menu do jogo. Esc ou "Return to Game" fecham. */
export function openGameMenu(game: Game, ctx: GameMenuContext = {}): MenuWindow {
  const parent = ctx.parent ?? sceneRoot(game);
  const m = ctx.mission;
  const kit = fallbackKit();
  const hasHero = !!game.state.hero;
  const SUBDIM = 0.22;   // cidade: o original escurece o fundo ~22% (town_esc_menu / town_save_screen: razão 0,78) e uma só vez ao abrir subjanelas
  type Entry = [label: string, fn: () => void, enabled?: boolean];
  const saveE: Entry = ["~Save Game", () => sub(w => openSaveGame(game, parent, { mission: m ? () => m.snapshot() : undefined, missionTitle: m?.title, onClose: w, onSaved: () => close(), dim: SUBDIM })), hasHero];
  const loadE: Entry = ["~Load Game", () => sub(w => openLoadGame(game, parent, { onClose: w, dim: SUBDIM, onLoad: slot => { close(); loadSlotAndGo(game, slot); } }))];
  const optE: Entry = ["Game ~Options", () => sub(w => openGameOptions(game, parent, { onClose: w, onChange: s => m?.onSettingsChanged?.(s) }))];
  const sndE: Entry = ["Sou~nd Options", () => sub(w => openSoundOptions(game, parent, { onClose: w, dim: SUBDIM, mission: !!m }))];
  const entries: Entry[] = m ? [saveE, loadE, optE, sndE] : [saveE, loadE, sndE];
  // itens do original na missão (refs/original/mission_menu.png): Save, Load, Game Options, Sound Options, Quest Objectives,
  // End Quest, Return to Game. Na cidade (refs/original/town_esc_menu.png, 19/10): Save Game, Load Game, Sound Options, Abort Game,
  // Return to Game (sem Game Options), janela 288×224; "Abort Game" abre outra janela igual com Exit to Main Menu / Exit to Windows /
  // Return to Game (town_abort_menu).
  if (m) {
    entries.push(["~Quest Objectives", () => sub(w => openQuestObjectives(game, parent, m.objectives(), { onClose: w }))]);
    if (m.victory?.()) entries.push(["~Victory!", () => { close(); m.onVictory?.(); }]);
    // "End Quest" abre outra janela igual com Victory! (só habilitado com a missão cumprida), Exit to Main Menu, Exit to Windows e Return
    // to Game — sem confirmação (refs/original/m10_menu_endquest; clicar em Exit to Main Menu volta direto ao menu principal)
    entries.push(["~End Quest", () => sub(back => openAbortMenu(back, true))]);
    entries.push(["~Return to Game", () => close()]);
  } else {
    entries.push(
      ["~Abort Game", () => sub(back => openAbortMenu(back))],
      ["~Return to Game", () => close()],
    );
  }
  /** "Abort Game" da cidade / "End Quest" da missão: janela do mesmo tamanho; na missão o 1º item é "Victory!" */
  function openAbortMenu(back: () => void, quest = false): MenuWindow {
    const leave = (): void => { game.state.save(); ab2.close(); close(); m?.exit?.(); if (!m) void game.go("menu"); };
    const ab: Entry[] = [
      ...(quest ? [["~Victory!", () => { ab2.close(); close(); m?.onVictory?.(); }, !!m?.victory?.()] as Entry] : []),
      ["~Exit to Main Menu", leave],
      ["Exit to ~Windows", () => { try { window.close(); } catch { /* o navegador pode recusar */ } leave(); }],
      ["~Return to Game", () => { ab2.close(); close(); }],
    ];
    const col2 = new ItemColumn(new Container());
    const ab2 = openWindow(parent, kit, { w: 288, h: 224, dim: SUBDIM, artScale: 1, offset: -4, onKey: e => col2.key(e), onClose: back });
    void loadMenuKit().then(() => {
      if (ab2.closed) return;
      ab.forEach(([lbl, fn, enabled], i) => {
        const it = col2.add(classicMenuItem(lbl, fn));
        it.position.set(40, (quest ? 50 : 70) + i * CLASSIC.pitch);
        if (enabled === false) it.setEnabled(false);
      });
      ab2.body.addChild(col2.view);
      col2.setFocus(Math.max(0, ab.findIndex(e => e[2] !== false)));
    });
    return ab2;
  }
  async function askIn(w: MenuWindow, text: string, title: string, yes: () => void): Promise<void> {
    w.setVisible(false);
    const ok = await ConfirmDialog.ask(parent, text, { title });
    if (w.closed) return;
    if (ok) yes(); else w.setVisible(true);
  }
  // janela 288×288 em tamanho natural, 4 px acima/à esquerda do centro, sem escurecer o fundo; caixas de 208×28 a cada 30 px
  const W = 288, H = m ? 288 : 224;
  const col = new ItemColumn(new Container());
  m?.setPaused?.(true);
  const win = openWindow(parent, kit, {
    w: W, h: H, dim: m ? 0 : SUBDIM, artScale: 1, offset: -4,
    onKey: e => { if (e.key === "F10") close(); else col.key(e); },
    onClose: () => { m?.setPaused?.(false); ctx.onClose?.(); },
  });
  function close(): void { win.close(); }
  /** abre uma subjanela escondendo o menu; ao fechar ela, o menu volta */
  function sub(open: (back: () => void) => MenuWindow): void {
    game.audio.playSfx("click_ok");
    win.setVisible(false);
    menuStack.escAll = () => { menuStack.escAll = null; close(); };
    open(() => { menuStack.escAll = null; if (!win.closed) win.setVisible(true); });
  }
  async function ask(text: string, title: string, yes: () => void): Promise<void> {
    win.setVisible(false);
    const ok = await ConfirmDialog.ask(parent, text, { title });
    if (win.closed) return;
    if (ok) yes(); else win.setVisible(true);
  }
  void loadMenuKit().then(k => {
    if (win.closed) return;
    void k;
    const top = m ? 40 + Math.round((7 - entries.length) * CLASSIC.pitch / 2) : 40;
    entries.forEach(([lbl, fn, enabled], i) => {
      const it = col.add(classicMenuItem(lbl, fn));
      it.position.set(40, top + i * CLASSIC.pitch);
      if (enabled === false) it.setEnabled(false);
    });
    win.body.addChild(col.view);
    col.setFocus(Math.max(0, entries.findIndex(e => e[2] !== false)));
  });
  return win;
}

/** Compatível com o antigo `openGameMenu(game, parent, onClose)` de town/common.ts: devolve o contêiner da janela. */
export function openGameMenuIn(game: Game, parent: Container, onClose?: () => void): Container {
  return openGameMenu(game, { parent, onClose }).root;
}

// ------------------------------------------------------------------ opções

export { openGameOptions } from "./gameoptions";
import { openGameOptions } from "./gameoptions";

/**
 * "Sound Options" como no original (refs/original/town_sound_*.png, 19/10): janela 480×352, título, "Tracks" + lista de 4 linhas (a faixa
 * da cidade), caixa "Acknowledgments", três controles de volume (Music / SFX / Speech: botão-estrela, trilho, cursor, botão-estrela) e os
 * botões Play, Stop e Ok. Volumes ligados a game.audio / game.state.settings.
 */
export function openSoundOptions(game: Game, parent: Container, opts: { onClose?: () => void; dim?: number; mission?: boolean } = {}): MenuWindow {
  const W = 480, H = 352;
  const cols = new ItemColumn(new Container(), true);
  const win = openWindow(parent, fallbackKit(), {
    w: W, h: H, dim: opts.dim ?? 0.22, artScale: 1, offset: -4, onKey: e => cols.key(e),
    onClose: () => { game.state.saveSettings(); hint.destroy(); opts.onClose?.(); },
  });
  const hint = screenHint(parent);   // etiquetas do original: "Return to Game", "Play", "Stop", "Music volume"... (dialogs.txt 8, 12, 14, 16..18, 165, 11)
  const tipOn = (o: Container, text: string): void => {
    o.eventMode = o.eventMode === "none" ? "static" : o.eventMode;
    o.on("pointermove", (e: { global: { x: number; y: number } }) => hint.show([text], e.global.x, e.global.y));
    o.on("pointerout", () => hint.hide());
    o.on("pointerdown", () => hint.hide());
  };
  void Promise.all([loadMenuKit(), game.data.tryJson<{ map?: Record<string, string> }>("data/texts/tunes.json")]).then(([kit, tj]) => {
    if (win.closed) return;
    const tunes = tj?.map ?? {};
    const b = win.body;
    const a = game.audio;
    const T = (text: string, x: number, y: number, color: number = CLASSIC.text, center = false) => {
      const t = makeText(text, { font: "font1", color });
      if (center) t.anchor.set(0.5, 0);
      t.position.set(x, y);
      b.addChild(t);
      return t;
    };
    T("Sound Options", 244, 19, CLASSIC.text, true);
    T("Tracks", 40, 59);
    // lista de faixas (a da cidade atual); sem faixas = linhas vazias
    const town = game.state.progress.town || "";
    // na missão a lista é a playlist de 4 faixas (refs/original/mission_sound_options: In Restless Waiting, Astral Threat, War of Druids, Tragedy of
    // Battle = b00..b03 de data/texts/tunes.json); na cidade, a faixa da cidade
    let sel = 0;
    const tracks = new ClassicList(kit, { rows: 4, onSelect: i => { sel = i; } });
    tracks.position.set(40, 80);
    const playlist = opts.mission ? ["b00", "b01", "b02", "b03"].map(k => ({ key: k, name: tunes[`${k}.wav`] ?? k })) : [];
    tracks.setItems(opts.mission ? playlist.map(p => p.name) : town ? [town.charAt(0).toUpperCase() + town.slice(1)] : []);
    if (opts.mission) tracks.select(0, false);
    b.addChild(tracks);
    tipOn(tracks, "Select track");
    const box = checkbox(kit, "Acknowledgments", game.state.settings.acknowledgments !== false, v => { game.state.settings.acknowledgments = v; game.state.saveSettings(); }, 14, true);
    box.position.set(43, 192);
    b.addChild(box);
    tipOn(box, "Acknowledgments");
    const rows: [string, () => number, (v: number) => void, number][] = [
      ["Music volume", () => a.musicVolume, v => { a.musicVolume = v; }, 175],
      ["SFX volume", () => a.sfxVolume, v => { a.sfxVolume = v; }, 224],
      ["Speech volume", () => a.speechVolume, v => { a.speechVolume = v; }, 274],
    ];
    let last = 0;
    const labels: ReturnType<typeof T>[] = [];
    const paintLabels = (hot = -1) => labels.forEach((l, i) => { l.tint = (hot >= 0 ? i === hot : i === labels.length - 1) ? CLASSIC.focus : CLASSIC.text; });   // em foco: o do mouse, senão o último (padrão)
    for (const [text, get, set, y] of rows) {
      const lab = T(text, 353, y, CLASSIC.text, true);
      labels.push(lab);
      const sl = new ClassicSlider(kit, 190, get(), v => {
        set(v);
        if (text === "SFX volume" && performance.now() - last > 150) { last = performance.now(); a.playSfx("click_ok"); }
      });
      sl.position.set(258, y + 15);
      const idx = labels.length - 1;
      sl.on("pointerover", () => paintLabels(idx));
      sl.on("pointerout", () => paintLabels());
      tipOn(sl, text);
      void lab;
      b.addChild(sl);
    }
    const mk = (label: string, x: number, y: number, w: number, fn: () => void) => {
      const it = cols.add(classicMenuItem(label, fn, { width: w, height: 24, edge: 2, textY: 2, pressRelief: true }));
      it.position.set(x, y);
      return it;
    };
    const play = mk("Play", 41, 256, 98, () => { if (opts.mission) a.playMusic(playlist[sel]?.key ?? "b00"); else if (town) a.playMusic(town); });
    const stop = mk("Stop", 151, 256, 100, () => a.stopMusic());
    const ok = mk("Ok", 41, 290, 210, () => win.close());
    tipOn(play, "Play"); tipOn(stop, "Stop"); tipOn(ok, "Return to Game");
    paintLabels();
    b.addChild(cols.view);
    void ok;
  });
  return win;
}

/**
 * "Quest Objectives and Hints:" como no original (refs/original/mission_quest_objectives.png, 19/10): janela 576×224, título e texto em font1 alinhados à
 * esquerda (x=40), passo de 18 px, botão Ok clássico (97×24) embaixo; cresce se o texto for longo.
 */
export function openQuestObjectives(game: Game, parent: Container, lines: string[], opts: { onClose?: () => void } = {}): MenuWindow {
  const W = 576;
  const body = lines.length ? lines.join("\n") : "No objectives yet.";
  const nLines = body.split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 62)), 0);   // ~62 caracteres por linha de 500 px
  const H = Math.max(224, 100 + 18 * nLines + 52);
  const col = new ItemColumn(new Container(), true);
  const win = openWindow(parent, fallbackKit(), { w: W, h: H, dim: 0, artScale: 1, offset: -4, onKey: e => col.key(e), onClose: opts.onClose });
  void loadMenuKit().then(() => {
    if (win.closed) return;
    const t = makeText("Quest Objectives and Hints:", { font: "font1", color: CLASSIC.text });
    t.position.set(40, 48);
    win.body.addChild(t);
    let y = 66;
    for (const para of body.split("\n")) {   // um parágrafo por linha de `lines`, justificado em 500 px (o original justifica)
      const j = justified(para, 500, CLASSIC.text, 18, "font1", false, 9, 6);
      j.position.set(40, y);
      win.body.addChild(j);
      y += Math.max(1, Math.round(j.height / 18)) * 18;
    }
    const ok = col.add(classicMenuItem("Ok", () => win.close(), { width: 97, height: 24, edge: 2, textY: 2, pressRelief: true }));
    ok.position.set(244, H - 52);
    win.body.addChild(col.view);
    void game;
  });
  return win;
}
