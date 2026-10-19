import { Graphics, Sprite } from "pixi.js";
import { Scene, SCREEN_H, SCREEN_W } from "../core/scene";
import { applyThemeCursor } from "../ui/cursor";
import { frame640, type Frame640 } from "../ui/frame640";
import { ConfirmDialog } from "../ui/dialog";
import { modalOpen } from "../ui/modal";
import { openCutscenes } from "../ui/cutscenes";
import { openServerDialog } from "../ui/serverdialog";
import { openMultiCharacter, type MultiChar } from "../ui/multichar";
import { openLoadGame } from "../ui/saveui";
import { installGameHotkeys } from "../ui/hotkeys";
import { HitMap, bindHitRegions, loadHitMap } from "../ui/hitmap";
import { loadFonts, makeText, type GameText } from "../ui/text";
import type { Game } from "../core/game";
import { warm, warmTextures } from "../ui/prefetch";
import { loadTexOr, safeEnter } from "../town/common";

const DIR = "assets/ui/menu/";

interface Box { file?: string; x: number; y: number; w: number; h: number; }
interface MenuMeta {
  /** escala da arte gerada (1 = 640×480 nativo; tools/pipeline/menu.py --scale) */
  scale?: number;
  label: Box;
  buttons: Array<{ id: number; name: string; hover: Required<Box>; pressed: Required<Box> }>;
}

/** Arquivos de imagem do menu (para o pré-carregamento e para a própria cena). */
function menuFiles(meta: MenuMeta): string[] {
  return [DIR + "bg.webp", ...meta.buttons.flatMap(b => [DIR + b.hover.file, DIR + b.pressed.file, `${DIR}label${b.id}.webp`])];
}

/** Pré-carrega o menu principal em segundo plano (durante os logos/abertura). */
export async function prefetch(game: Game): Promise<void> {
  const meta = await game.data.tryJson<MenuMeta>(DIR + "menu.json");
  if (!meta) return;
  await warmTextures(game, [...menuFiles(meta), DIR + "hit.png"], 6);
}

/** Ordem horária no disco (do botão de cima): escudo, livro, globo, louros, ossos, pergaminho, filmes, mãos. */
const CLOCKWISE = [1, 5, 6, 7, 8, 4, 3, 2];

type Action = "new" | "multi" | "cuts" | "credits" | "load" | "server" | "fame" | "exit";
const ACTION: Record<number, Action> = { 1: "new", 2: "multi", 3: "cuts", 4: "credits", 5: "load", 6: "server", 7: "fame", 8: "exit" };
const UNAVAILABLE: Action[] = [];
const HOTKEYS: Record<string, number> = { n: 1, m: 2, s: 3, c: 4, l: 5, h: 7, x: 8, q: 8 };

/**
 * Menu principal: fundo e botões originais (main/graphics/mainmenu convertidos por tools/pipeline/menu.py).
 * O fundo traz os 8 botões "apagados"; passar o mouse acende o bitmap do botão (recortado pela máscara `menumask`) e mostra o
 * rótulo no centro do disco; pressionar troca para o bitmap "p". Música "menu".
 * Como o original em 1024×768: a tela 640×480 fica no centro, sem ampliar, com borda preta (ui/frame640.ts) e o cursor
 * "select" (mão prateada). Sem textos de ajuda na tela (o original não tem).
 *   Novo jogo -> chargen | Carregar -> tela "Load Game" (ui/saveui.ts) -> town ou mission | Cenas -> intro | Créditos -> credits | Sair -> confirma.
 *   Hall da Fama -> fame (scenes/FameScene.ts). Multijogador = tela "New Character" (ui/multichar.ts; sem rede); Servidor = diálogo só visual.
 * Teclado: setas/Tab percorrem o disco, Enter/Espaço ativam, N=novo, L=carregar, C=créditos, S=cenas, X/Q/Esc=sair.
 */
export default class MenuScene extends Scene {
  private hit!: HitMap;
  private frame!: Frame640;
  private artK = 1;                                // escala da arte gerada (menu.json "scale")
  private hoverSprites = new Map<number, Sprite>();
  private pressedSprites = new Map<number, Sprite>();
  private labels = new Map<number, Sprite>();
  private focus = 0;
  private pressed = 0;
  private busy = false;
  private msg!: GameText;
  private msgTimer = 0;
  private fade!: Graphics;
  private fadeIn = 0;
  private restoreCursor?: () => void;
  private hasSave = false;
  private multi?: MultiChar;

  private onKey = (e: KeyboardEvent) => {
    if (ConfirmDialog.active || this.busy || modalOpen()) return;
    const k = e.key;
    if (k === "ArrowDown" || k === "ArrowRight" || (k === "Tab" && !e.shiftKey)) { e.preventDefault(); this.step(1); }
    else if (k === "ArrowUp" || k === "ArrowLeft" || (k === "Tab" && e.shiftKey)) { e.preventDefault(); this.step(-1); }
    else if (k === "Enter" || k === " ") { e.preventDefault(); if (this.focus) this.activate(this.focus); }
    else if (k === "Escape") { e.preventDefault(); void this.askExit(); }
    else if (HOTKEYS[k.toLowerCase()] && !e.ctrlKey && !e.altKey && !e.metaKey) { e.preventDefault(); this.setFocus(HOTKEYS[k.toLowerCase()]); this.activate(HOTKEYS[k.toLowerCase()]); }
  };

  override async enter(params?: unknown): Promise<void> {
    await safeEnter(this.game, this.root, "menu", () => this.build(), "boot");
    // volta da criação de personagem do Multiplayer: reabre a tela "New Character"
    if ((params as { multiLoader?: boolean } | undefined)?.multiLoader && this.fade) { this.fadeIn = 0; this.fade.alpha = 0; this.openMulti(); }
    const g = this.game;
    warm(g, g.state.hasSave() ? ["chargen", "town", "inn", "shop"] : ["chargen", "town"]);
  }

  private async build(): Promise<void> {
    await loadFonts();
    const meta = await this.game.data.getJson<MenuMeta>(DIR + "menu.json");
    const [hit, texList] = await Promise.all([loadHitMap(DIR + "hit.png"), Promise.all(menuFiles(meta).map(f => loadTexOr(this.game, f)))]);
    this.hit = hit;
    this.hasSave = this.game.state.hasSave();
    this.game.audio.attach(this.game.state);
    this.game.audio.playMusic("menu", { fadeMs: 800 });

    this.artK = meta.scale ?? 1;
    const f = this.frame = frame640(this.root);
    const place = (s: Sprite, x: number, y: number): Sprite => { s.position.set(x / this.artK, y / this.artK); s.scale.set(1 / this.artK); return s; };
    f.addChild(place(new Sprite(texList[0]), 0, 0));

    meta.buttons.forEach((b, i) => {
      const hs = place(new Sprite(texList[1 + i * 3]), b.hover.x, b.hover.y); hs.visible = false;
      const ps = place(new Sprite(texList[2 + i * 3]), b.pressed.x, b.pressed.y); ps.visible = false;
      const ls = place(new Sprite(texList[3 + i * 3]), meta.label.x, meta.label.y); ls.visible = false;
      // sem escurecer os botões "indisponíveis" (Multi/Server/Hall of Fame, Load sem saves): no original todos acendem igual
      // ao passar o mouse (refs/original/menu_hover_*, menu_nosave_hover_load_game; docs/GAPS.md [FIDELIDADE-MENU])
      f.addChild(hs, ps, ls);
      this.hoverSprites.set(b.id, hs); this.pressedSprites.set(b.id, ps); this.labels.set(b.id, ls);
    });

    // mensagem (só aparece ao clicar numa opção indisponível nesta versão; o original não tem texto fixo na tela)
    this.msg = makeText("", { font: "font4", color: 0xbd9e4a, align: "center", shadow: true });
    this.msg.anchor.set(0.5, 0.5); this.msg.position.set(320, 466); this.msg.alpha = 0;
    f.addChild(this.msg);

    // ponteiro (coordenadas 640×480 do quadro; o mapa de acerto está na escala da arte): ui/hitmap.ts bindHitRegions
    const idle = () => !this.busy && !ConfirmDialog.active && !modalOpen();
    this.root.eventMode = "static";
    bindHitRegions(f, this.hit, this.artK, {
      enabled: idle,
      hover: id => this.setFocus(id),
      down: id => { this.pressed = id; this.refresh(); },
      up: (pressed, over) => {
        this.pressed = 0; this.refresh();
        if (pressed && idle() && over === pressed) this.activate(pressed);
      },
      cancel: () => { this.pressed = 0; this.refresh(); },
    });

    this.fade = new Graphics().rect(0, 0, SCREEN_W, SCREEN_H).fill(0x000000);
    this.fade.eventMode = "none";
    this.root.addChild(this.fade);
    this.fadeIn = 1;

    this.restoreCursor = applyThemeCursor(this.game.app, "select");
    window.addEventListener("keydown", this.onKey, true);
    installGameHotkeys(this.game);                   // F2/F3 globais (F3 aqui abre "Load Game")
  }

  override update(dtMs: number): void {
    if (!this.fade) return;                        // enter() ainda carregando
    if (this.fadeIn > 0) { this.fadeIn = Math.max(0, this.fadeIn - dtMs / 400); this.fade.alpha = this.fadeIn; }
    if (this.msgTimer > 0) {
      this.msgTimer -= dtMs;
      this.msg.alpha = Math.min(1, this.msgTimer / 400);
    }
  }

  override exit(): void {
    this.multi?.close();
    window.removeEventListener("keydown", this.onKey, true);
    ConfirmDialog.dismiss();
    this.restoreCursor?.();
  }

  // ------------------------------------------------------------------ foco / desenho

  private setFocus(id: number): void {
    if (id === this.focus) return;
    this.focus = id;
    this.refresh();
  }

  private step(dir: number): void {
    const i = CLOCKWISE.indexOf(this.focus);
    const next = i < 0 ? (dir > 0 ? CLOCKWISE[0] : CLOCKWISE[CLOCKWISE.length - 1]) : CLOCKWISE[(i + dir + CLOCKWISE.length) % CLOCKWISE.length];
    this.setFocus(next);
  }

  private refresh(): void {
    // Load Game sem nenhum save: o original mostra só o rótulo, o ícone não acende (refs/original/menu_nosave_hover_load_game)
    const lit = (id: number) => !(ACTION[id] === "load" && !this.hasSave);
    for (const [id, s] of this.hoverSprites) s.visible = this.focus === id && this.pressed !== id && lit(id);
    for (const [id, s] of this.pressedSprites) s.visible = this.pressed === id && lit(id);
    for (const [id, s] of this.labels) s.visible = this.focus === id;
  }

  private say(text: string): void {
    this.msg.text = text; this.msg.alpha = 1; this.msgTimer = 2600;
  }

  // ------------------------------------------------------------------ ações

  private activate(id: number): void {
    const action = ACTION[id];
    if (!action) return;
    if (UNAVAILABLE.includes(action)) { this.game.audio.playSfx("error"); this.say("Not available in this version"); return; }
    switch (action) {
      case "new": this.game.audio.playSfx("click_ok"); this.leave(() => this.game.go("chargen")); break;
      case "multi": this.game.audio.playSfx("click_ok"); this.openMulti(); break;
      case "load":
        // sem nenhum save o clique não faz nada (original: refs/original/load_game_nosave_screen)
        if (!this.hasSave) return;
        // tela "Load Game" (ui/saveui.ts): lista de slots; Confirm carrega e vai para a cidade ou para a missão salva
        this.game.audio.playSfx("click_ok");
        this.setFocus(0);
        openLoadGame(this.game, this.root, { cursor: "default", onClose: () => { this.hasSave = this.game.state.hasSave(); } });
        break;
      case "cuts":
        // janela "View Cutscenes" (ui/cutscenes.ts); "Intro" toca a abertura
        this.game.audio.playSfx("click_ok");
        this.setFocus(0);
        openCutscenes(this.game, this.root, { onPlay: id => void this.playCutscene(id) });
        break;
      case "credits": this.game.audio.playSfx("click_ok"); this.leave(() => this.game.go("credits")); break;
      case "server": this.game.audio.playSfx("click_ok"); this.setFocus(0); openServerDialog(this.root); break;
      case "fame": this.game.audio.playSfx("click_ok"); this.leave(() => this.game.go("fame")); break;
      case "exit": this.game.audio.playSfx("click_ok"); void this.askExit(); break;
    }
  }

  /** Tela "New Character" do Multiplayer (ui/multichar.ts): Accept sem personagens abre a criação em modo Multiplayer, Cancel fecha. */
  private openMulti(): void {
    this.setFocus(0);
    this.multi?.close();
    this.multi = openMultiCharacter(this.game, this.root, {
      onClose: () => { this.multi = undefined; },
      onNew: () => { this.multi = undefined; this.leave(() => this.game.go("chargen", { multi: true })); },
    });
  }

  /** Toca uma cena da galeria "Cut Scenes" (vídeo no centro da tela, como o original) e volta ao menu. A abertura é a cena "intro". */
  private async playCutscene(id: string): Promise<void> {
    if (id === "intro") { this.leave(() => this.game.go("intro")); return; }
    this.busy = true;
    this.game.audio.stopMusic(300);
    this.game.video.attach(this.game.state);
    await this.game.video.play(id, { skippable: true });
    if (this.root.destroyed) return;
    this.busy = false;
    this.game.audio.playMusic("menu", { fadeMs: 800 });
  }

  /** Escurece e troca de cena (a música continua; a cena seguinte decide a sua). */
  private leave(go: () => Promise<void>): void {
    this.busy = true;
    const t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / 250);
      if (!this.fade.destroyed) this.fade.alpha = k;
      if (k < 1) requestAnimationFrame(step); else void go();
    };
    step();
  }

  private async askExit(): Promise<void> {
    if (ConfirmDialog.active || this.busy) return;
    const ok = await ConfirmDialog.ask(this.root, "Exit the game?", { title: "Exit Game", yes: "Yes", no: "No" });
    if (!ok || this.root.destroyed) return;
    this.busy = true;
    this.game.audio.stopMusic(600);
    const cover = new Graphics().rect(0, 0, SCREEN_W, SCREEN_H).fill(0x000000);
    cover.alpha = 0; this.root.addChild(cover);
    const bye = makeText("You can close this tab now.\nPress any key to return to the menu.", { size: 26, color: 0xb8a070, align: "center" });
    bye.anchor.set(0.5); bye.position.set(SCREEN_W / 2, SCREEN_H / 2); bye.alpha = 0; this.root.addChild(bye);
    const t0 = performance.now();
    const step = () => {
      if (cover.destroyed) return;
      const k = Math.min(1, (performance.now() - t0) / 700);
      cover.alpha = k; bye.alpha = k;
      if (k < 1) requestAnimationFrame(step);
      else {
        try { window.close(); } catch { /* o navegador pode recusar */ }
        const back = () => { window.removeEventListener("keydown", back, true); if (!this.root.destroyed) void this.game.go("menu"); };
        setTimeout(() => window.addEventListener("keydown", back, true), 300);
      }
    };
    step();
  }
}
