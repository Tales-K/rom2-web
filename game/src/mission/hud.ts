/**
 * HUD da missão com os bitmaps originais de graphics/interface (exportados para assets/ui/hud/ por tools/pipeline/mission.py).
 * Painel direito de 176 px na pilha que o jogo usa em 1024x768 (allods2.exe carrega Crystal/Heads/CommandBar/HumanBack/TextBack/
 * extra1024; posições conferidas com capturas do jogo original e com o UnityAllods — ver notes/hud-reference.md):
 *   y=0   cristal (minimapa) 158 px — só o explorado aparece; o resto fica o roxo do cristal (como no original)
 *   y=158 barra de comandos 80 px (CommandEmpR + ícones de CommandBarR, botão ativo de CommandDnR); "Heads" quando a unidade
 *         selecionada não é do jogador; o botão Cast só existe para quem conhece magias
 *   y=238 moldura oval (HumanBack) 242 px: retrato da unidade (boneca do herói ou graphics/infowindow) + botões livro/mochila
 *   y=480 extra1024 46 px (decorativo)
 *   y=526 TextBack 242 px: nome, vida/mana e atributos em texto MAIÚSCULO (não há barras de vida/mana no painel do original)
 * Rodapé da vista: barra de inventário (mission/itemui.ts, 90 px) e, acima dela quando as duas estão abertas, o livro de magias
 * (spb1024l + SpellBook + spb1024r, 85 px; UnityAllods MapViewSpellbook sobe 90 px com o inventário visível).
 * Também: janela de mensagem do script (moldura lm.256 com caveiras, retrato e "Ok", centrada como no original) e tela de resultado.
 */
import { Container, Graphics, Rectangle, Sprite, Texture, type Text } from "pixi.js";
import { SCREEN_H, SCREEN_W } from "../core/scene";
import type { Game } from "../core/game";
import { makeText } from "../ui/text";
import { classicMenuItem, frame, ItemColumn, loadMenuKit, menuKitNow, type MenuKit } from "../ui/menukit";
import { justified } from "../ui/tipwin";
import type { Unit, World } from "../sim/world";
import { PLAYER_COLORS } from "./view";
import { barFill, drawBar, hpKind } from "./bars";
import { drawHeroSheet } from "../ui/herosheet";
import { Hint } from "../ui/hint";
import { MSG_X, MSG_Y, MessageWindow } from "../ui/msgwin";

export const PANEL_X = 848;
export const VIEW_W = PANEL_X;
export const VIEW_H = SCREEN_H;
const HUD = "assets/ui/hud/";
const CMD_Y = 158, PIC_Y = 238, EXTRA_Y = 480, TEXT_Y = 526;
const SPB_H = 85;
/** minimapa: borda de células escondida pela moldura, tamanho do quadrado útil do cristal (px) e cores dos pontos (original: m10_hud) */
const MM_BORDER = 8, MM_SIZE = 128;
/** janela de resultado (m10_defeat): em (268,268), 480×286; botões a partir de y=200 */
const RESULT = { x: 268, y: 268, h: 288, btnY: 200 };
/** ícone do menu principal na moldura oval (dica medida em m10_hover_portrait: x 992..1004, y 454..466) */
const MENU_ICON = { x: 990, y: 442 };
const MM_OWN = 0x84e752, MM_NEUTRAL = 0x2145bd, MM_ENEMY = 0xe03030;
/** altura da barra de inventário (itemui.ts BAR_H) */
const INV_H = 90;

export type CommandName = "attack" | "move" | "guard" | "defend" | "cast" | "swarm" | "stand" | "retreat";
/** Ordem dos ícones em commandbarr.bmp (rótulos de main.txt: "Attack <A>", "Move <M>", ...). */
export const COMMANDS: { name: CommandName; label: string; key: string }[] = [
  { name: "attack", label: "Attack", key: "A" }, { name: "move", label: "Move", key: "M" },
  { name: "guard", label: "Guard", key: "G" }, { name: "defend", label: "Defend", key: "D" },
  { name: "cast", label: "Cast", key: "C" }, { name: "swarm", label: "Swarm", key: "S" },
  { name: "stand", label: "Stand Ground", key: "T" }, { name: "retreat", label: "Retreat", key: "R" },
];
/** Botão i da barra de comandos: retângulo 34×34 em (8 + 34·col, 7 + 34·lin) dentro de CommandBarR (UnityAllods MapViewCommandbar). */
const cmdRect = (i: number) => new Rectangle(8 + 34 * (i % 4), 7 + 34 * Math.floor(i / 4), 34, 34);

/** Posição de cada magia na grade 12×2 de spellbook.bmp (mesma ordem dos ícones; tabela SpellRemap do UnityAllods).
 *  "Control Spirit" = Animate Dead (id 22) e "Diamond Dust" = Stone Missile (id 16): confirmado pelos pergaminhos de items.json
 *  (Scroll spell 22 "Control Spirit", spell 16 "Diamond Dust"). O livro original tem só estas 24 células: Acid Stream (9), Darkness (14),
 *  Light (15), Curse (28) e Slow (29) não têm ícone no spellbook.bmp — no original elas só vêm de pergaminhos (usados pela mochila).
 *  Se o herói as conhecer, ficam nas teclas 1–9/F5–F8 (docs/GAPS.md). */
export const SPELL_GRID = [
  "Fire Arrow", "Fireball", "Wall of Fire", "Protection from Fire", "Heal", "Bless", "Haste", "Drain Life",
  "Protection from Air", "Invisibility", "Prismatic Spray", "Lightning",
  "Ice Missile", "Poison Cloud", "Blizzard", "Protection from Water", "Summon", "Animate Dead", "Teleport", "Shield",
  "Protection from Earth", "Stone Curse", "Wall of Earth", "Stone Missile",
];
/** Mesmas células por id de magia (spells.json) — casa também nomes alternativos ("Control Spirit", "Diamond Dust", "Fire Ball"). */
export const SPELL_GRID_IDS = [1, 2, 3, 4, 24, 20, 21, 26, 13, 12, 11, 10, 5, 6, 7, 8, 25, 22, 23, 27, 19, 18, 17, 16];

/** Magia como o livro a precisa (subconjunto de sim/SpellDef): a dica da célula usa nome, custo, dano/cura, duração, alcance e efeitos. */
export interface SpellInfo {
  id: string; name: string; mana?: number; range?: number; min?: number; max?: number; duration?: number; power?: number;
  target?: string; kind?: string; effects?: { kind: string; amount: number }[];
}

export interface HudCallbacks {
  command(c: CommandName): void;
  minimap(cellX: number, cellY: number, right: boolean): void;
  resultContinue(): void;
  /** botões da tela de resultado: voltar ao menu principal / abrir Load Game */
  resultExit(): void;
  resultLoad(): void;
  selectSpell(id: string): void;
  dialogDone(): void;
  /** botão da mochila na moldura oval */
  inventory(): void;
  /** ícone da chave na moldura oval: abre o menu principal (dica "Main Menu <Esc>") */
  menu(): void;
  /** cabeça do grupo clicada: seleciona a unidade (`center` = duplo clique: a câmera vai até ela) */
  selectUnit(id: number, center: boolean): void;
}

/** Cabeça de um integrante do grupo (faixa abaixo da moldura oval). `portrait` = retrato 160×240 ou, sem ele, o sprite parado. */
export interface PartyHead { id: number; name: string; hp: number; maxHp: number; alive: boolean; portrait?: Texture; }

/** Texto do painel inferior (TextBack). `full` = herói/unidade do jogador (atributos completos, como no original). */
export interface InfoText {
  name: string;
  /** unidade hostil: o painel do original mostra só o nome (refs/original/mission_selected_enemy: "BONE SNAKE" em 906,555) */
  nameOnly?: boolean;
  hp: number; maxHp: number; mana: number; maxMana: number;
  dmg?: [number, number]; attack?: number;
  full?: {
    attrs: [string, number][];           // Body, Agility, Mind, Spirit
    absorb: number; defense: number;
    skillsTitle: string; skills: [string, number][];
    resist: [string, number][];
    weight?: number;
    exp?: number; sight: number; speed: number;
  };
}

interface DialogLine { speaker: string; text: string; portrait?: Texture; /** mensagem do sistema sem retrato ("Game paused") */ plain?: boolean; }

/** Cores do texto do painel (UnityAllods DisplayInfo, conferidas na captura): legenda, valor, título de seção. */
const C_CAPTION = 0xbd9e4a, C_VALUE = 0x6b9a7b;
/** Retrato inteiro 160×240 (boneca/infowindow) — os menores são sprites parados. */
function isFullPortrait(p: Texture): boolean { return p.width >= 150 && p.height >= 200; }
/** Recorte (x, y, w, h) relativo ao canto do retrato: cabeça e tronco para o diálogo e para a faixa do grupo. */
function cropPortrait(p: Texture, x: number, y: number, w: number, h: number): Texture {
  return new Texture({ source: p.source, frame: new Rectangle(p.frame.x + x, p.frame.y + y, w, h) });
}

export class Hud {
  readonly root = new Container();
  private tex = new Map<string, Texture>();
  private kit?: MenuKit;
  private minimap = new Container();
  private mmSprite?: Sprite;
  private mmFull?: ImageData;
  private mmCanvas?: HTMLCanvasElement;
  private mmTex?: Texture;
  private mmSeen = -1;
  private mmDots = new Graphics();
  private mmScale = 1;
  private mmMask = new Graphics();
  /** retângulo da câmera: fora da máscara (o original o desenha inteiro mesmo na borda do cristal) */
  private mmRect = new Graphics();
  private mmOrigin = { x: 0, y: 0 };
  private cmdBar = new Container();
  private cmdButtons: { up: Sprite; down: Sprite }[] = [];
  private cmdHidden = new Set<CommandName>();
  private heads = new Container();
  private picLayer = new Container();
  private picSprite = new Sprite(Texture.EMPTY);
  /** camada entre o retrato e os botões livro/mochila (a barra de itens põe aqui o alvo de arrastar da boneca) */
  readonly dollLayer = new Container();
  /** camada da barra de inventário (abaixo do livro de magias e das janelas) */
  readonly invLayer = new Container();
  private infoText = new Container();
  private infoKey = "";
  /** faixa do grupo sobre o extra1024 (só com aliados): uma cabeça por integrante, clique seleciona, duplo clique centraliza */
  private partyLayer = new Container();
  private partySig = "";
  private headTex = new Map<string, Texture>();
  private lastHeadTap = { id: 0, at: 0 };
  private bookBtn = new Sprite(Texture.EMPTY);
  private packBtn = new Sprite(Texture.EMPTY);
  private spellbook = new Container();
  private spellCells = new Container();
  private spellSig = "";
  private spellHints: { x: number; y: number; i: number; lines: string[] }[] = [];
  private spellTexts: string[] = [];
  /** etiquetas da barra de inventário/livro: ficam ABAIXO do painel (o original as corta na borda do painel; m10_mage_hover_shield) */
  private hintBar?: Hint;
  /** "No units / selected" no centro da moldura oval quando nada está selecionado (m20_hud) */
  private noSel = new Container();
  private status!: Text;
  private hint?: Hint;
  private ui: string[] = [];
  /** painel de texto atual é a ficha completa do herói (as dicas dos atributos só existem nele) e é de mago? */
  private sheet: { full: boolean; mage: boolean } = { full: false, mage: false };
  private statusUntil = 0;
  private dialog = new Container();
  private dialogWin!: MessageWindow;
  private dialogQueue: DialogLine[] = [];
  private overlay = new Container();
  activeCommand: CommandName | null = null;
  inventoryOpen = false;

  constructor(private readonly game: Game, private readonly cb: HudCallbacks) {}

  get dialogOpen(): boolean { return this.dialog.visible; }
  get overlayOpen(): boolean { return this.overlay.children.length > 0; }
  get spellbookOpen(): boolean { return this.spellbook.visible; }
  /** topo do livro de magias (o cursor sobre ele não é do mapa) */
  get spellbookY(): number { return this.spellbook.y; }

  async load(): Promise<void> {
    const names = ["commandbarl", "commandbarr", "commanddnr", "commandempr", "crystall", "crystalr", "headsl", "headsr", "humanbackl", "humanbackr",
      "extra1024l", "extra1024r", "textbackl", "textbackr", "bookclosed", "bookopened", "backpackcl", "backpackop", "spellbook", "spellback",
      "spb1024l", "spb1024r"];
    const kitP = loadMenuKit();
    await Promise.all(names.map(async n => {
      try { this.tex.set(n, await this.game.data.texture(`${HUD}${n}.png`)); } catch { /* ausente: painel liso */ }
    }));
    this.kit = await kitP;
    const T = (n: string) => this.tex.get(n);
    const spr = (n: string, x: number, y: number, parent: Container) => { const t = T(n); if (!t) return undefined; const s = new Sprite(t); s.position.set(x, y); parent.addChild(s); return s; };

    this.root.addChild(this.invLayer);
    // livro de magias (rodapé da vista; o painel fica por cima da ponta direita, como em 1024x768 no original)
    this.spellbook.visible = false;
    spr("spb1024l", 0, 0, this.spellbook);
    spr("spellbook", 192, 0, this.spellbook);
    spr("spb1024r", PANEL_X - 192, 0, this.spellbook);   // 656: o original cobre a sobra do SpellBook (m10_book_open)
    this.spellCells.position.set(192, 0);
    this.spellbook.addChild(this.spellCells);
    this.spellbook.eventMode = "static";
    this.spellbook.y = SCREEN_H - SPB_H;
    this.root.addChild(this.spellbook);
    this.hintBar = new Hint(this.root);

    const panel = new Container();
    panel.position.set(PANEL_X, 0);
    panel.addChild(new Graphics().rect(0, 0, SCREEN_W - PANEL_X, SCREEN_H).fill(0x000000));
    spr("crystall", 0, 0, panel); spr("crystalr", 16, 0, panel);
    // barra de comandos (base vazia + ícones) e "cabeças" no mesmo lugar
    spr("commandbarl", 0, CMD_Y, panel);
    this.cmdBar.position.set(16, CMD_Y);
    spr("commandempr", 0, 0, this.cmdBar);
    COMMANDS.forEach((c, i) => {
      const r = cmdRect(i);
      const sub = (n: string) => { const t = T(n); const s = new Sprite(t ? new Texture({ source: t.source, frame: r }) : Texture.EMPTY); s.position.set(r.x, r.y); return s; };
      const up = sub("commandbarr"), down = sub("commanddnr");
      down.visible = false;
      up.eventMode = down.eventMode = "static";
      for (const s of [up, down]) s.on("pointertap", () => this.cb.command(c.name));
      this.cmdBar.addChild(up, down);
      this.cmdButtons.push({ up, down });
    });
    panel.addChild(this.cmdBar);
    this.heads.position.set(0, CMD_Y);
    spr("headsl", 0, 0, this.heads); spr("headsr", 16, 0, this.heads);
    this.heads.visible = false;
    panel.addChild(this.heads);
    // moldura oval com o retrato
    spr("humanbackl", 0, PIC_Y, panel); spr("humanbackr", 16, PIC_Y, panel);
    for (const [i, line] of [[47, "No units"], [48, "selected"]] as const) {
      const t = makeText(((this.ui[i] ?? "") || line).toUpperCase(), { font: "font2", color: C_CAPTION });
      t.anchor.set(0.5, 0);
      t.position.set(87, 291 + 12 * (i - 47));
      this.noSel.addChild(t);
    }
    this.noSel.visible = false;
    panel.addChild(this.noSel);
    this.picLayer.position.set(16, PIC_Y + 2);
    this.picLayer.addChild(this.picSprite);
    panel.addChild(this.picLayer);
    this.dollLayer.position.set(16, PIC_Y + 2);
    panel.addChild(this.dollLayer);
    // livro (16,4) e mochila (17,201) dentro da janela de informação (allods2.exe: BookClosed/BackPackCl; posições do UnityAllods)
    this.bookBtn.eventMode = this.packBtn.eventMode = "static";
    this.bookBtn.on("pointertap", () => this.toggleSpellbook());
    this.packBtn.on("pointertap", () => this.cb.inventory());
    panel.addChild(this.bookBtn, this.packBtn);
    this.refreshButtons();
    spr("extra1024l", 0, EXTRA_Y, panel); spr("extra1024r", 16, EXTRA_Y, panel);
    this.partyLayer.position.set(16, EXTRA_Y);
    panel.addChild(this.partyLayer);
    spr("textbackl", 0, TEXT_Y, panel); spr("textbackr", 16, TEXT_Y, panel);
    this.infoText.position.set(16, TEXT_Y);
    panel.addChild(this.infoText);
    this.root.addChild(panel);

    // minimapa dentro do cristal: 2 px por célula, só as células 8..w-8 (a moldura cobre a borda de 8 células que a câmera não mostra);
    // medido em refs/original/m10_hud.png (herói na célula 11,41 = pixel 878,84) e m20_hud (41,67 = 936..941,134..139)
    this.minimap.position.set(PANEL_X + 24, 18);
    this.minimap.addChild(this.mmMask);
    this.minimap.mask = this.mmMask;
    this.root.addChild(this.mmRect);
    this.root.addChild(this.minimap);

    // linha de mensagens curtas (recolher ouro, falta de mana...) no canto da vista
    this.status = makeText("", { size: 14, color: 0xffe9a8, stroke: 0x000000 });
    this.status.position.set(10, 8);
    this.root.addChild(this.status);

    // ícone da chave (canto inferior direito da moldura oval, parte da arte): abre o menu principal [dica main.txt 14]
    const menuHit = new Graphics().rect(0, 0, 26, 30).fill({ color: 0, alpha: 0.001 });
    menuHit.position.set(MENU_ICON.x - PANEL_X, MENU_ICON.y);
    menuHit.eventMode = "static";
    menuHit.on("pointertap", () => this.cb.menu());
    panel.addChild(menuHit);

    this.buildDialog();
    this.root.addChild(this.overlay);
    this.ui = (await this.game.data.tryJson<{ lines: string[] }>("data/texts/main.json"))?.lines ?? [];
    this.spellTexts = (await this.game.data.tryJson<{ lines: string[] }>("data/texts/spells.json"))?.lines ?? [];
    this.hint = new Hint(this.root);
  }

  // ------------------------------------------------------------------------------------------- minimapa

  /** Monta a imagem do mapa; só as células exploradas aparecem (`updateMinimapFog`), o resto deixa ver o roxo do cristal. */
  buildMinimap(w: number, h: number, colorAt: (x: number, y: number) => number): void {
    const B = MM_BORDER, spanW = Math.max(1, w - 2 * B), spanH = Math.max(1, h - 2 * B);
    // 2 px por célula quando cabe nos 128×128 do cristal (mapas de 80 células); mapas maiores usam 1 px ou reduzem [est]
    const span = Math.max(spanW, spanH);
    this.mmScale = span * 2 <= MM_SIZE ? 2 : span <= MM_SIZE ? 1 : MM_SIZE / span;
    const k = this.mmScale;
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const ctx = cv.getContext("2d")!;
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const c = colorAt(x, y), i = (y * w + x) * 4;
      img.data[i] = (c >> 16) & 255; img.data[i + 1] = (c >> 8) & 255; img.data[i + 2] = c & 255; img.data[i + 3] = 255;
    }
    this.mmFull = img;
    ctx.clearRect(0, 0, w, h);
    this.mmCanvas = cv;
    const t = Texture.from(cv);
    t.source.scaleMode = "nearest";
    this.mmTex = t;
    this.mmSprite = new Sprite(t);
    this.mmSprite.scale.set(k);
    // a área visível (células B..w-B) fica centrada nos 128×128; o resto do mapa fica sob a moldura (máscara)
    const vw = Math.floor(spanW * k), vh = Math.floor(spanH * k);
    const offX = Math.floor((MM_SIZE - vw) / 2), offY = Math.floor((MM_SIZE - vh) / 2);
    this.minimap.position.set(PANEL_X + 24 + offX, 18 + offY);
    this.mmMask.clear().rect(0, 0, vw, vh).fill(0xffffff);
    this.mmOrigin = { x: Math.round(-B * k), y: Math.round(-B * k) };
    this.mmSprite.position.set(this.mmOrigin.x, this.mmOrigin.y);
    this.mmDots.position.set(this.mmOrigin.x, this.mmOrigin.y);
    this.mmRect.position.set(PANEL_X + 24 + offX + this.mmOrigin.x, 18 + offY + this.mmOrigin.y);
    // área clicável = o quadrado visível do mapa (inclusive o não explorado)
    const hit = new Graphics().rect(0, 0, w, h).fill({ color: 0, alpha: 0.001 });
    hit.scale.set(k);
    hit.position.set(this.mmOrigin.x, this.mmOrigin.y);
    this.minimap.addChild(this.mmSprite, this.mmDots, hit);
    hit.eventMode = "static";
    const go = (e: { global: { x: number; y: number }; button?: number }) => {
      const p = hit.toLocal(e.global);
      this.cb.minimap(Math.floor(p.x), Math.floor(p.y), e.button === 2);
    };
    let dragging = false;
    hit.on("pointerdown", e => { dragging = e.button === 0; go(e); });
    hit.on("pointermove", e => { if (dragging) go(e); });
    hit.on("pointerup", () => { dragging = false; });
    hit.on("pointerupoutside", () => { dragging = false; });
  }

  /** Copia para o minimapa só as células exploradas (`explored` = névoa). `fogOff` mostra tudo. */
  updateMinimapFog(explored: Uint8Array, fogOff: boolean): void {
    const full = this.mmFull, cv = this.mmCanvas;
    if (!full || !cv) return;
    let n = 0;
    for (let i = 0; i < explored.length; i++) n += explored[i]!;
    const key = fogOff ? -2 : n;
    if (key === this.mmSeen) return;
    this.mmSeen = key;
    const ctx = cv.getContext("2d")!;
    const img = ctx.createImageData(full.width, full.height);
    const s = full.data, d = img.data;
    for (let i = 0; i < explored.length; i++) {
      if (!fogOff && !explored[i]) continue;
      const k = i * 4;
      d[k] = s[k]!; d[k + 1] = s[k + 1]!; d[k + 2] = s[k + 2]!; d[k + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    this.mmTex?.source.update();
  }

  updateMinimap(world: World, cam: { x: number; y: number; w: number; h: number }, visible: (u: Unit) => boolean): void {
    const g = this.mmDots, k = this.mmScale;
    g.clear();
    const mine = world.units.find(u => u.isHero)?.player ?? 1;
    // pontos de 2×2 px (original: herói 84e752; objeto/neutro 2145bd; hostil em vermelho [est])
    for (const u of world.units) {
      if (!u.active || !visible(u)) continue;
      const col = u.player === mine ? MM_OWN : world.hostile(u.player, mine) ? MM_ENEMY : MM_NEUTRAL;
      g.rect(Math.floor(u.x) * k, Math.floor(u.y) * k, 2, 2).fill(col);
    }
    // retângulo branco da câmera (1 px, coordenadas inteiras)
    const x0 = Math.round(cam.x / 32 * k), y0 = Math.round(cam.y / 32 * k), w = Math.round(cam.w / 32 * k), h = Math.round(cam.h / 32 * k);
    const r = this.mmRect;
    r.clear().rect(x0, y0, w + 1, 1).rect(x0, y0 + h, w + 1, 1).rect(x0, y0, 1, h + 1).rect(x0 + w, y0, 1, h + 1).fill(0xffffff);
  }

  // ------------------------------------------------------------------------------------------- painel

  /** Comando ativo: o botão aparece "afundado" (subretângulo de commanddnr.bmp). */
  setActiveCommand(c: CommandName | null): void {
    this.activeCommand = c;
    this.paintCommands();
  }

  /** Comandos que a unidade não tem (Cast sem magias) ficam como o fundo vazio de CommandEmpR, como no original. */
  setCommandHidden(c: CommandName, hidden: boolean): void {
    if (hidden === this.cmdHidden.has(c)) return;
    if (hidden) this.cmdHidden.add(c); else this.cmdHidden.delete(c);
    this.paintCommands();
  }

  private paintCommands(): void {
    COMMANDS.forEach((x, i) => {
      const b = this.cmdButtons[i];
      if (!b) return;
      const hid = this.cmdHidden.has(x.name);
      b.down.visible = !hid && x.name === this.activeCommand;
      b.up.visible = !hid && x.name !== this.activeCommand;
    });
  }

  /** Unidade selecionada: retrato na moldura oval, texto no TextBack e barra de comandos (só para unidades do jogador). */
  showInfo(info: InfoText | undefined, pic: Texture | undefined, own: boolean): void {
    this.cmdBar.visible = own && !!info;
    this.heads.visible = !own || !info;
    this.picLayer.visible = !!info;
    this.noSel.visible = !info;
    this.picSprite.texture = pic ?? Texture.EMPTY;
    const key = info ? JSON.stringify(info) : "";
    this.sheet = { full: !!info?.full, mage: !!info?.full && info.full.skills[0]?.[0] === "Fire" };
    if (key === this.infoKey) return;
    this.infoKey = key;
    this.infoText.removeChildren().forEach(c => c.destroy());
    if (!info) return;
    const f = info.full;
    if (f) {
      // herói/unidade do jogador: a MESMA ficha da criação de personagem e da taverna (ui/herosheet.ts); no HUD o painel
      // fica 12 px à esquerda do painel da criação (medido em m10_hud: BODY em 870,571)
      drawHeroSheet(this.infoText, {
        name: info.name,
        labels: {
          attrs: [f.attrs[0]![0], f.attrs[1]![0], f.attrs[2]![0], f.attrs[3]![0]], health: "Health", mana: "Mana", dmg: "Dmg", absorb: "Absorb",
          attack: "Attack", defense: "Defense", skills: f.skillsTitle, resistance: "Resistance", skillNames: f.skills.map(x => x[0]),
          resistNames: f.resist.map(x => x[0]), weight: "Weight", xp: "XP", sight: "Sight", speed: "Speed",
        },
        attrs: [f.attrs[0]![1], f.attrs[1]![1], f.attrs[2]![1], f.attrs[3]![1]],
        health: [Math.max(0, Math.ceil(info.hp)), info.maxHp], mana: [Math.max(0, Math.floor(info.mana)), info.maxMana],
        damage: info.dmg ?? [0, 0], absorb: f.absorb, attack: info.attack ?? 0, defense: f.defense,
        skills: f.skills.map(x => x[1]), resists: f.resist.map(x => x[1]),
        weight: f.weight ?? 0, xp: f.exp ?? 0, sight: f.sight, speed: f.speed,
      }, -12, 0);
      return;
    }
    // outras unidades: nome, vida/mana, dano e ataque (capturas 00083/00087 do original)
    const LH = 10;
    const put = (s: string, x: number, y: number, w: number, align: "left" | "right" | "center", color: number) => {
      const t = makeText(s.toUpperCase(), { font: "font2", color });
      t.anchor.set(align === "left" ? 0 : align === "right" ? 1 : 0.5, 0);
      t.position.set(align === "left" ? x - 1 : align === "right" ? x + w : x + w / 2 + 1, y - 2);
      this.infoText.addChild(t);
    };
    const rows = (pairs: [string, string | number][], x: number, y: number, w: number) =>
      pairs.forEach(([c, v], i) => { put(c, x, y + i * LH, w, "left", C_CAPTION); put(String(v), x, y + i * LH, w, "right", C_VALUE); });
    if (info.nameOnly) { put(info.name, 36, 29, 70, "center", C_CAPTION); return; }
    put(info.name, 36, 19, 70, "center", C_CAPTION);
    put("Health", 85, 45, 58, "center", C_CAPTION);
    put(`${Math.max(0, Math.ceil(info.hp))}/${info.maxHp}`, 85, 45 + LH, 58, "center", C_VALUE);
    put("Mana", 85, 45 + 2 * LH, 58, "center", C_CAPTION);
    put(`${Math.max(0, Math.floor(info.mana))}/${info.maxMana}`, 85, 45 + 3 * LH, 58, "center", C_VALUE);
    if (info.dmg) rows([["Dmg", `${info.dmg[0]}-${info.dmg[1]}`], ["Attack", info.attack ?? 0]], 7, 89, 63);
  }

  /**
   * Faixa do grupo (só aparece com pelo menos um aliado; sem aliados o painel fica idêntico ao original). Até 5 integrantes: uma
   * fileira de cabeças 30×42; de 6 a 12: duas fileiras de 26×22. A selecionada tem moldura dourada; sem barras no original, a
   * fina barra de vida embaixo de cada cabeça é extensão nossa (docs/GAPS.md [MISSÃO-UI-1]).
   */
  setParty(members: PartyHead[], activeId: number): void {
    const n = Math.min(members.length, 12);
    const bar = (m: PartyHead) => barFill(m.hp, m.maxHp, 24);
    const sig = n < 2 ? "" : members.slice(0, n).map(m => `${m.id}:${m.alive ? 1 : 0}:${bar(m)}${hpKind(m.hp, m.maxHp)[0]}:${m.portrait ? 1 : 0}`).join(",") + `|${activeId}`;
    if (sig === this.partySig) return;
    this.partySig = sig;
    this.partyLayer.removeChildren().forEach(c => c.destroy({ children: true }));
    if (n < 2) return;
    const one = n <= 5;
    const cw = one ? 30 : 26, ch = one ? 42 : 22, cols = one ? n : 6;
    const gap = one ? 2 : 0;
    const x0 = Math.floor((160 - cols * cw - (cols - 1) * gap) / 2);
    const y0 = one ? 2 : 0;
    members.slice(0, n).forEach((m, i) => {
      const cx = x0 + (i % cols) * (cw + gap), cy = y0 + Math.floor(i / cols) * ch;
      const cell = new Container();
      cell.position.set(cx, cy);
      const active = m.id === activeId;
      cell.addChild(new Graphics().rect(0, 0, cw, ch).fill(0x120c06).stroke({ color: active ? 0xf2d27a : 0x6b5326, width: active ? 2 : 1, alignment: 1 }));
      const head = m.portrait ? this.headOf(m.portrait) : undefined;
      if (head) {
        const hh = ch - 6, ww = cw - 4;
        const s = new Sprite(head);
        const k = Math.min(ww / head.width, hh / head.height);
        s.scale.set(k);
        s.position.set(Math.round((cw - head.width * k) / 2), 2 + Math.round((hh - head.height * k) / 2));
        if (!m.alive) { s.tint = 0x555555; s.alpha = 0.6; }
        cell.addChild(s);
      }
      // mesma barra das unidades no mapa (mission/bars.ts): trilho de 4 px na base da cabeça
      const inner = cw - 4, g = new Graphics();
      drawBar(g, 2, ch - 5, inner, barFill(m.hp, m.maxHp, inner), hpKind(m.hp, m.maxHp), !m.alive);
      cell.addChild(g);
      cell.eventMode = "static";
      cell.on("pointerover", () => this.say(m.name, 1200));
      cell.on("pointertap", () => {
        if (!m.alive) return;
        const now = performance.now();
        const dbl = this.lastHeadTap.id === m.id && now - this.lastHeadTap.at < 400;
        this.lastHeadTap = { id: dbl ? 0 : m.id, at: now };
        this.cb.selectUnit(m.id, dbl);
      });
      this.partyLayer.addChild(cell);
    });
  }

  /** Recorte da cabeça: retrato 160×240 (boneca/infowindow) mostra só o alto; sprites pequenos entram inteiros. */
  private headOf(p: Texture): Texture {
    if (!isFullPortrait(p)) return p;
    const key = `${p.source.uid}:${p.frame.x},${p.frame.y}`;
    let t = this.headTex.get(key);
    if (!t) { t = cropPortrait(p, 30, 6, 100, 100); this.headTex.set(key, t); }
    return t;
  }

  private refreshButtons(): void {
    const t = (n: string) => this.tex.get(n) ?? Texture.EMPTY;
    const open = this.spellbook.visible;
    this.bookBtn.texture = t(open ? "bookopened" : "bookclosed");
    this.bookBtn.position.set(16, PIC_Y + (open ? 0 : 4));
    this.packBtn.texture = t(this.inventoryOpen ? "backpackop" : "backpackcl");
    if (this.inventoryOpen) this.packBtn.position.set(16, PIC_Y + 208); else this.packBtn.position.set(17, PIC_Y + 201);
  }

  toggleSpellbook(open = !this.spellbook.visible): void {
    if (open !== this.spellbook.visible) this.game.audio.playSfx("ibook");
    this.spellbook.visible = open;
    this.refreshButtons();
  }

  /** Inventário aberto: botão da mochila aberto e livro de magias sobe acima da barra. */
  setInventoryOpen(on: boolean): void {
    this.inventoryOpen = on;
    this.spellbook.y = on ? SCREEN_H - INV_H - SPB_H : SCREEN_H - SPB_H;
    this.refreshButtons();
  }

  /** Livro de magias: as magias conhecidas ficam visíveis na grade de spellbook.bmp; as outras, cobertas por spellback.bmp. */
  setSpells(spells: SpellInfo[], active: string | null): void {
    const sig = spells.map(s => s.id).join(",") + "|" + active;
    if (sig === this.spellSig) return;
    this.spellSig = sig;
    this.spellHints = [];
    this.spellCells.removeChildren().forEach(c => c.destroy());
    const back = this.tex.get("spellback");
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
    SPELL_GRID.forEach((name, i) => {
      const x = 5 + (i % 12) * 38, y = 5 + Math.floor(i / 12) * 38;
      const gid = String(SPELL_GRID_IDS[i]);
      const s = spells.find(sp => sp.id === gid || norm(sp.name) === norm(name));
      if (!s) {
        if (back) { const b = new Sprite(back); b.position.set(x + 1, y + 1); this.spellCells.addChild(b); }
        return;
      }
      // magia ativa: célula clareada (m10_mage: +45 por canal = cinza 0x808c80 a 50%)
      const hit = new Graphics().rect(0, 0, 37, 37).fill({ color: s.id === active ? 0x808c80 : 0x000000, alpha: s.id === active ? 0.5 : 0.001 });
      hit.position.set(x, y);
      hit.eventMode = "static";
      hit.on("pointertap", () => this.cb.selectSpell(s.id));
      this.spellCells.addChild(hit);
      this.spellHints.push({ x: 192 + x, y, i, lines: this.spellLines(s, i) });
    });
  }

  /** Dica da magia (medida em m10_mage_hover_*): "Nome (tipo)", descrição (texts/spells.json, mesma ordem da grade), "Mana cost", "Damage",
   *  "Duration", "Range" e os efeitos ("Absorption: 5"). */
  private spellLines(s: SpellInfo, i: number): string[] {
    const [title, ...desc] = (this.spellTexts[i] ?? s.name).split("#");
    const L = [title!, ...desc];
    if (s.mana) L.push(`Mana cost: ${s.mana}`);
    if (s.max && s.kind !== "shield") L.push(`Damage: ${s.min ?? 0}-${s.max}`);
    // duração só nas magias com efeito (a "duração" da cura não aparece no original: m10m_hover_heal)
    if (s.duration && (s.effects?.length || s.kind === "shield")) L.push(`Duration: ${(Math.round(s.duration * 10) / 10).toFixed(1)}`);
    if (s.range && s.target !== "self") L.push(`Range: ${s.range}`);
    const k = (s.power ?? 0) / 30 + 1;   // o original mostra a magnitude do efeito sem a escala do poder (Shield: 5 com poder 21)
    for (const e of s.effects ?? []) {
      const n: Record<string, string> = { absorption: "Absorption", defense: "Defense", attack: "Attack", speed: "Speed", sight: "Sight" };
      if (n[e.kind]) L.push(`${n[e.kind]}: ${Math.round(e.amount / k * 10) / 10}`);
    }
    return L;
  }

  say(text: string, ms = 2500): void {
    this.status.text = text;
    this.statusUntil = performance.now() + ms;
  }

  tick(): void {
    if (this.statusUntil && performance.now() > this.statusUntil) { this.status.text = ""; this.statusUntil = 0; }
  }

  // ------------------------------------------------------------------------------------------- dicas (etiqueta junto do cursor)

  /** Texto da dica (main.txt, "#" = quebra de linha, "~~" = "~"). */
  private tx(i: number): string[] { return (this.ui[i] ?? "").replace(/~~/g, "~").split("#").filter(Boolean); }

  /** Dica sob o ponto (tela): comandos, livro, mochila, chave do menu, atributos da ficha do herói (main.txt 0..14, 155..180). */
  private hoverLines(x: number, y: number): string[] {
    const inR = (rx: number, ry: number, w: number, h: number) => x >= rx && y >= ry && x < rx + w && y < ry + h;
    if (this.cmdBar.visible) {
      for (let i = 0; i < COMMANDS.length; i++) {
        const r = cmdRect(i);
        if (!this.cmdHidden.has(COMMANDS[i]!.name) && inR(PANEL_X + 16 + r.x, CMD_Y + r.y, r.width, r.height)) return this.tx(i);
      }
    }
    const bb = (b: Sprite) => inR(PANEL_X + b.x, b.y, b.texture.width, b.texture.height);
    if (bb(this.bookBtn)) return this.tx(this.spellbook.visible ? 9 : 8);
    if (bb(this.packBtn)) return this.tx(this.inventoryOpen ? 11 : 10);
    if (inR(MENU_ICON.x, MENU_ICON.y, 26, 30)) return this.tx(14);
    if (this.sheet.full && x >= PANEL_X + 16 && x < 1008 && y >= TEXT_Y + 45 && y < TEXT_Y + 221) {
      // linhas de 10 px a partir de y=571 (medido: a dica muda a cada linha; colunas em x=944 e x=936)
      const r = y - (TEXT_Y + 45), k = Math.floor(r / 10);
      if (k >= 0 && k < 4) return this.tx(x < 944 ? 155 + k : k < 2 ? 159 : 160);
      const t = y - (TEXT_Y + 89);      // DMG/ATTACK: 615, 625
      if (t >= 0 && t < 20) return this.tx(x < 936 ? 161 + Math.floor(t / 10) : 163 + Math.floor(t / 10));
      const u = y - (TEXT_Y + 113);     // SKILLS/RESISTANCE: 639; habilidades 649..698
      if (u >= 0 && u < 10) return this.tx(x < 936 ? 168 : 169);
      if (u >= 10 && u < 60) return this.tx((this.sheet.mage ? 176 : 171) + Math.floor((u - 10) / 10));
      const w = y - (TEXT_Y + 175);     // WEIGHT 701, XP 713 (linhas de 12), SIGHT 727, SPEED 737
      if (w >= 0 && w < 10) return this.tx(165);
      if (w >= 12 && w < 22) return this.tx(170);
      const v = y - (TEXT_Y + 201);
      if (x >= 900 && x < 990 && v >= 0 && v < 10) return this.tx(166);
      if (x >= 900 && x < 990 && v >= 10 && v < 20) return this.tx(167);
    }
    return [];
  }

  /** Chamado a cada quadro: mostra a dica sob o ponteiro (ou `extra`, a da barra de inventário/boneca) depois de 0,5 s parado. */
  updateHint(px: number, py: number, inside: boolean, extra: string[] = []): void {
    const top = this.hint, bar = this.hintBar;
    if (!top || !bar) return;
    if (!inside || this.dialog.visible || this.overlay.children.length) { top.hide(); bar.hide(); return; }
    let barLines = extra;
    if (!barLines.length && this.spellbook.visible && py >= this.spellbook.y) {
      const c = this.spellHints.find(h => px >= h.x && px < h.x + 37 && py >= this.spellbook.y + h.y && py < this.spellbook.y + h.y + 37);
      if (c) barLines = c.lines;
    }
    const panelLines = barLines.length ? [] : this.hoverLines(px, py);
    if (barLines.length) bar.showScreen(barLines, px, py); else bar.hide();
    if (panelLines.length) top.showScreen(panelLines, px, py); else top.hide();
  }

  // ------------------------------------------------------------------------------------------- mensagem do script

  /** Janela de mensagem do original (ui/msgwin.ts, a mesma da cidade): moldura, retrato emoldurado, texto em font1 e botão "Ok". */
  private buildDialog(): void {
    this.dialogWin = new MessageWindow({ onOk: () => this.nextLine() });
    this.dialogWin.homeY = 0;
    this.dialog.addChild(this.dialogWin);
    this.dialog.position.set(MSG_X, MSG_Y);
    this.dialog.visible = false;
    this.dialog.eventMode = "static";
    this.root.addChild(this.dialog);
  }

  queueLines(lines: DialogLine[]): void {
    this.dialogQueue.push(...lines);
    if (!this.dialog.visible) this.nextLine();
  }

  /** Esvazia a fila (save carregado) */
  clearDialog(): void { this.dialogQueue = []; this.dialog.visible = false; }

  nextLine(): void {
    const l = this.dialogQueue.shift();
    if (!l) { this.dialog.visible = false; this.cb.dialogDone(); return; }
    this.dialog.visible = true;
    this.dialogWin.setPlain(!!l.plain);
    this.dialogWin.setText(l.text);
    // retrato 160×240 (boneca/infowindow) entra 1:1 recortado como no original; sprites pequenos ficam centrados na caixa
    this.dialogWin.setPortrait(l.plain || !l.portrait ? undefined : { doll: l.portrait });
  }

  // ------------------------------------------------------------------------------------------- resultado

  private clearOverlay(): void { this.overlay.removeChildren().forEach(c => c.destroy({ children: true })); }

  closeOverlay(): void { this.clearOverlay(); }

  /**
   * Tela de resultado (medida em refs/original/m10_defeat: "Mission Failed" ao morrer o herói): a janela de mensagem em 480×288 em (268,268) com
   * o título e o texto da falha em font1 (título à esquerda; texto justificado com recuo) e dois botões largos chanfrados embaixo
   * (365×24, 2 px de borda, colados): falha = "Exit to Main Menu" / "Load Game"; sucesso [est, sem captura] = "Victory!" / "Exit to Main Menu".
   */
  showResult(ok: boolean, title: string, text: string, _details?: string): void {
    this.clearOverlay();
    this.dialog.visible = false;
    const root = new Container();
    root.position.set(RESULT.x, RESULT.y);
    const shield = new Graphics().rect(-RESULT.x, -RESULT.y, SCREEN_W, SCREEN_H).fill({ color: 0x000000, alpha: 0.001 });
    shield.eventMode = "static";
    const fr = new Container();
    const build = () => { fr.removeChildren().forEach(c => c.destroy({ children: true })); fr.addChild(frame(this.kit ?? menuKitNow() ?? { ok: false, lm: [], scr: [], radio: [] }, 480, RESULT.h, false, 1)); };
    build();
    root.addChild(shield, fr);
    const t = makeText(title, { font: "font1", color: 0xffffff });
    t.position.set(40, 47);
    const body = justified(text, 404, 0xffffff, 17, "font1", false, 11, 10, 9);
    body.position.set(40, 67);
    root.addChild(t, body);
    const col = new ItemColumn(new Container());
    const labels: [string, () => void][] = ok
      ? [["~Victory!", () => this.cb.resultContinue()], ["~Exit to Main Menu", () => this.cb.resultExit()]]
      : [["~Exit to Main Menu", () => this.cb.resultExit()], ["~Load Game", () => this.cb.resultLoad()]];
    labels.forEach(([lbl, fn], i) => {
      const it = col.add(classicMenuItem(lbl, fn, { width: 365, height: 24, edge: 2, pressRelief: true, textY: 3 }));
      it.position.set(61, RESULT.btnY + 24 * i);
    });
    root.addChild(col.view);
    root.eventMode = "static";
    root.on("keydown" as never, () => undefined);
    this.overlay.addChild(root);
    this.resultKeys = e => col.key(e);
  }

  /** teclado da tela de resultado (setas/Enter/atalhos) — a cena repassa as teclas enquanto `overlayOpen` */
  resultKeys?: (e: KeyboardEvent) => boolean;
}

// ------------------------------------------------------------------------------------------- boneca (retrato do herói)

interface DollIndex { [sub: string]: { bodies: number[]; p: Record<string, [number, number]>; s: Record<string, [number, number]> } }
let dollIndex: Promise<(DollIndex & { back?: Record<string, [number, number]> }) | undefined> | undefined;

/** Ordem das camadas (0 = fundo) por slot do item — UnityAllods MapViewHuman.UpdateItemPic, que reproduz o allods2.exe:
 *  guerreiro: capa(0) corpo(1) anel(2,3) malha(4) botas(5) amuleto(6) braçadeira2(7) luva2(8) couraça(9) braçadeira1(10)
 *  luva1(11) elmo(12) arma(13) escudo(14); mago: capa1(0) corpo(1) anel(2,3) sapatos(4) luva1(5) túnica(6) amuleto(7)
 *  capa2(8) luva2(9) chapéu(10) cajado(11). [primária, secundária] por slot (slot = (id >> 8) & 15). */
const FIGHTER_LAYERS: Record<number, [number, number?]> = { 1: [13], 2: [14], 4: [2, 3], 5: [6], 6: [12], 7: [4], 8: [9], 9: [7, 10], 10: [8, 11], 12: [5] };
const MAGE_LAYERS: Record<number, [number, number?]> = { 1: [11], 4: [2, 3], 5: [7], 6: [10], 7: [6], 8: [0, 8], 10: [5, 9], 12: [4] };

/** Nome do arquivo da camada: material, slot, classe, opção do id do item (`%02d%02d%d%02d`). */
export function itemImageName(id: number): string {
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${p2(id >> 12)}${p2((id >> 8) & 15)}${(id >> 5) & 7}${p2(id & 31)}`;
}

/** Camada da boneca: `item` = id do item vestido (0 = corpo/capa). */
export interface DollLayer { item: number; texture: Texture; x: number; y: number; }

/** Monta a "boneca" 160×240 (corpo pela face + equipamento vestido + capa do herói guerreiro), como na moldura oval do original.
 *  Cada Sprite leva `label` = id do item (para o teste de alfa do arrastar; MapViewHuman.GetHumanItemByPoint). */
export async function buildDoll(game: Game, opts: { female: boolean; mage: boolean; face: number; items: number[]; hero: boolean }): Promise<Container | undefined> {
  dollIndex ??= game.data.tryJson<DollIndex & { back?: Record<string, [number, number]> }>(`${HUD}doll/index.json`);
  const idx = await dollIndex;
  if (!idx) { dollIndex = undefined; return undefined; }   // não guarda a falha (tenta de novo na próxima missão)
  const sub = `${opts.female ? "f" : "m"}${opts.mage ? "mage" : "fighter"}`;
  const d = idx[sub];
  if (!d) return undefined;
  const face = d.bodies.includes(opts.face) ? opts.face : d.bodies[0];
  const layers: { order: number; path: string; x: number; y: number; item: number }[] = [{ order: 1, path: `${sub}/${face}`, x: 0, y: 0, item: 0 }];
  const table = opts.mage ? MAGE_LAYERS : FIGHTER_LAYERS;
  let any = false;
  for (const id of opts.items) {
    const slot = (id >> 8) & 15, lay = table[slot];
    if (!lay) continue;
    const n = itemImageName(id);
    const p = d.p[n], s = d.s[n];
    if (p) { layers.push({ order: lay[0], path: `${sub}/p/${n}`, x: p[0], y: p[1], item: id }); any = true; }
    if (s && lay[1] !== undefined) layers.push({ order: lay[1], path: `${sub}/s/${n}`, x: s[0], y: s[1], item: id });
  }
  const g = opts.female ? "f" : "m";
  if (opts.hero && !opts.mage && any && idx.back?.[g]) layers.push({ order: 0, path: `back${g}`, x: idx.back[g]![0], y: idx.back[g]![1], item: 0 });
  layers.sort((a, b) => a.order - b.order);
  const c = new Container();
  const tex = await Promise.all(layers.map(l => game.data.texture(`${HUD}doll/${l.path}.webp`).catch(() => undefined)));
  layers.forEach((l, i) => { const t = tex[i]; if (!t) return; const s = new Sprite(t); s.position.set(l.x, l.y); s.label = String(l.item); c.addChild(s); });
  return c;
}

/** Camadas de uma boneca montada (para o teste de alfa), do fundo para a frente. */
export function dollLayers(doll: Container): DollLayer[] {
  return doll.children.map(ch => { const s = ch as Sprite; return { item: Number(s.label) || 0, texture: s.texture, x: s.x, y: s.y }; });
}

/** Recorta o frame "parado de frente" de um atlas para usar como retrato. */
export function portraitFrom(tex: Texture, w: number, h: number): Texture {
  return new Texture({ source: tex.source, frame: new Rectangle(0, 0, Math.min(w, tex.width), Math.min(h, tex.height)) });
}
