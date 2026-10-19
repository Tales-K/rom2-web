import { Container, Graphics, Rectangle, Sprite, Texture, type FederatedPointerEvent, type FederatedWheelEvent } from "pixi.js";
import { Scene } from "../core/scene";
import { makeText } from "../ui/text";
import { Nav, Texts, ensureHero, loadStrip, loadTexOr, onKey, safeEnter, spr, type StripInfo } from "../town/common";
import type { Game } from "../core/game";
import { warm, warmTextures } from "../ui/prefetch";
import { ItemCatalog, type ItemDef, type Shelf } from "../town/items";
import { campaignCtx, loadItemPool, loadShopsData, townDef, type CampaignCtx } from "../campaign/runtime";
import { ELVEN_BIT, putInStock, shelfAccepts, shopStock, takeFromStock } from "../campaign/shops";
import type { TownStock } from "../campaign/types";
import { frame640, type Frame640 } from "../ui/frame640";
import { openGameMenuIn } from "../ui/gamemenu";
import { showTipWindow, tipsEnabled, type TipWindow } from "../ui/tipwin";
import { Hint } from "../ui/hint";
import { ShopVoices, type ShopDir } from "../town/shopvoices";

/** shop.json das lojas de Kaarg/acampamento (tools/pipeline/town.py:build_shop_variant). */
type Box = { x: number; y: number; w: number; h: number };
type VarShopMeta = ShopMeta & { hili?: Record<string, Box>; extra?: Record<string, Box> };

/** Aba/realce de uma prateleira pela máscara: livros+poções, Elven, mágica, armas, armaduras. */
function shelfKindOf(mask: number): string {
  const a = shelfAccepts(mask);
  if (a.books) return "potion";
  if (mask & ELVEN_BIT || (a.magic && !((mask >>> 15) & 0x7f))) return "elven";
  if (a.magic) return "magic";
  if (a.weapons || a.shields) return "weapon";
  return "armor";
}

const BASE = "assets/ui/shop/";
const HUD = "assets/ui/hud/";
const INN = "assets/ui/inn/";
const TEX = ["scene", "frame", "inv", "menu", "table", "cell_shop", "cell_mine", "backinvs", "money", "arrow1", "arrow2", "arrow3", "arrow4"];
/** o que cada variante (Kaarg, acampamento) troca; o resto vem da arte de Plagat */
const OWN = new Set(["scene", "frame", "inv", "menu", "table", "arrow1", "arrow2", "arrow3", "arrow4"]);
type KeeperMeta = { x: number; y: number; idle?: StripInfo; rest?: StripInfo; yes: StripInfo; no: StripInfo };
type ShopMeta = { anims: Record<string, { x: number; y: number } & StripInfo>; keeper?: KeeperMeta };
/** lojista (vídeo movies/shopanim*): quadro de repouso, gesto ocioso (Plagat), "yes" depois de comprar/vender, "no" sem dinheiro */
interface Keeper { sprite: Sprite; rest: Texture; idle: Texture[]; yes: Texture[]; no: Texture[]; cur?: Texture[]; pos: number; t: number; wait: number }

/** Pré-carrega a loja em segundo plano (as imagens fixas, as animações e os dados de itens; os ícones são carregados sob demanda). */
export async function prefetch(game: Game): Promise<void> {
  const meta = await game.data.tryJson<ShopMeta>(BASE + "shop.json");
  if (!meta) return;
  await Promise.all(["data/texts/town.json", "data/texts/main.json", "data/items.json"].map(p => game.data.tryJson(p)));
  await warmTextures(game, [...TEX.map(n => `${BASE}${n}.webp`), `${HUD}invframe.png`, `${HUD}backinv.png`, `${HUD}humanbackr.png`, `${HUD}humanbackl.png`, `${HUD}bookclosed.png`,
    ...Object.values(meta.anims).map(a => BASE + "anim/" + a.strip)]);
}
type Txt = ReturnType<typeof makeText>;

// geometria 640×480 (medida em refs/original/shop_*.png; o quadro é montado por ui/frame640.ts)
const INV = { x: 0, y: 0 };                 // painel da grade de itens à venda (shopinv 164×303)
const FRAME = { x: 164, y: 0 };             // moldura da cena (shopframe 316×303)
const SCENE = { x: 169, y: 8 };             // shopmain 288×288 (os brilhos animados e os realces são relativos a ele)
const MENU = { x: 464, y: 0, w: 176 };      // shopmenu 176×238: plaquetas Undo/Buy/Sell/Exit
const TABLE = { x: 0, y: 303, w: 472, h: 87 };
const BAR = { x: 0, y: 390 };               // invframe 480×90: setas + 5 células (1ª = dinheiro)
const SLOT0 = 32, SLOT_W = 80;              // x das células da mesa e da faixa do inventário: 32 + 80 i
const TABLE_Y = 307, BAR_Y = 396;
const GRID_X = 1, GRID_Y = 32, GRID_COLS = 2, GRID_ROWS = 3;
const ARROW_UP = { x: 46, y: 0, w: 72, h: 32 }, ARROW_DOWN = { x: 46, y: 271, w: 72, h: 32 };
const OVAL = { x: 480, y: 238 };            // moldura oval do herói (inn/left_picture 160×242)
const SLOTS = 5;
/** centros (x, y) dos dois textos de cada plaqueta (rótulo, valor), relativos ao menu */
const PLAQUES = [
  { x: 16, y: 22, w: 144, h: 38, ly: 34, vy: 52 }, { x: 16, y: 70, w: 144, h: 38, ly: 84, vy: 98 },
  { x: 16, y: 122, w: 144, h: 38, ly: 133, vy: 147 }, { x: 16, y: 170, w: 144, h: 38, ly: 178, vy: 196 },
];
const TXT_GOLD = 0xc8a860;
const NUM_GOLD = 0xbd9e4a;

/** Regiões clicáveis (relativas à cena) que escolhem a prateleira (Plagat; as lojas de Kaarg/acampamento usam os `hili_*` medidos). */
const HOTSPOTS: Array<{ shelf: Shelf; x: number; y: number; w: number; h: number }> = [
  { shelf: "weapon", x: 0, y: 70, w: 70, h: 218 },
  { shelf: "armor", x: 150, y: 150, w: 138, h: 138 },
  { shelf: "magic", x: 70, y: 84, w: 100, h: 44 },
  { shelf: "potion", x: 170, y: 40, w: 118, h: 100 },
];

/** "1,000" */
export function fmtMoney(n: number): string { return String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

interface Entry { src: "shop" | "mine"; id: string }
interface Spot extends Box { shelf: number; kind: string; hili?: Sprite }

/**
 * Loja (Plagat, Kaarg, acampamento): tela 640×480 do original (ui/frame640.ts), SEM abas, título, ouro nem painel de informações.
 *   grade 2×3 dos itens da prateleira (esquerda) | cena animada do lojista (centro; clique numa prateleira troca o conteúdo da grade)
 *   plaquetas Undo/Buy/Sell/Exit com os valores (direita) | retrato do herói (embaixo à direita)
 *   mesa de 5 lugares (embaixo à esquerda) e faixa do inventário do herói com o dinheiro na 1ª célula (por último).
 * Itens: arrastar ou clicar na grade/inventário os coloca na mesa; Buy/Sell executam; Undo esvazia a mesa. A etiqueta pequena do mouse
 * (ui/hint.ts) diz o que é cada lugar. A dica abre numa janela própria (ui/tipwin.ts).
 */
export default class ShopScene extends Scene {
  private texts!: Texts;
  private cat!: ItemCatalog;
  private tex: Record<string, Texture> = {};
  private hud: Record<string, Texture> = {};
  /** prateleira 0..3 da configuração do Scenario.dll */
  private shelf = 0;
  private shopRow = 0;
  private invOff = 0;
  private table: Entry[] = [];
  private frame!: Frame640;
  private gridC = new Container();
  private barC = new Container();
  private tableC = new Container();
  private arrowsC = new Container();
  private plaqueTxt: Txt[][] = [];
  private hint!: Hint;
  private flashTimer = 0;
  private hotSpots: Spot[] = [];
  private keeper?: Keeper;
  private anims: Array<{ sprite: Sprite; frames: Texture[]; t: number; pos: number; fps: number }> = [];
  private drag?: { entry: Entry; sx: number; sy: number; ghost?: Sprite; fromTable: boolean };
  private justDragged = false;
  private removeKey?: () => void;
  private modal?: Container;
  private tip?: TipWindow;
  private doll?: Container;
  private dollTicket = 0;
  private iconCache = new Map<string, Texture>();
  private mouse = { x: 0, y: 0, inside: false };
  private hoverArrow = 0;
  private plaqueHover = -1;

  private nav = new Nav(this.game);

  private ctx!: CampaignCtx;
  private townId = 1;
  private stockData!: TownStock;
  /** nome do realce/aba (weapon/armor/magic/potion/elven) de cada prateleira 0..3, pela máscara */
  private shelfKind: string[] = [];
  /** vozes do lojista (town/shopvoices.ts): fala o nome/descrição da classe do item ao selecioná-lo na grade [est: o momento no original não foi capturado] */
  private voices?: ShopVoices;
  private voiceDir: ShopDir = "shop";

  override async enter(params?: unknown): Promise<void> {
    await safeEnter(this.game, this.root, "shop", () => this.build(params), "town");
    warm(this.game, ["town"]);
  }

  private async build(params?: unknown): Promise<void> {
    const game = this.game;
    ensureHero(game);
    this.ctx = await campaignCtx(game);
    const asked = (params as { town?: unknown } | undefined)?.town;
    this.townId = typeof asked === "number" ? asked : this.ctx.st.lastTown;
    const town = townDef(this.ctx.data, this.townId);
    game.audio.playMusic(town.music);
    this.voiceDir = town.key === "kaarg" ? "shop_kaarg" : town.key === "druids" ? "shop_druid" : "shop";
    void ShopVoices.load(game).then(v => { this.voices = v; }).catch(() => undefined);
    // Kaarg / acampamento: cena, moldura, inventário, menu, mesa e setas próprios + realces das prateleiras (assets/ui/shop/<cidade>/)
    const VAR = town.art === "base" ? undefined : `${BASE}${town.key}/`;
    const hudNames = ["invframe", "backinv", "invarrow1", "invarrow2", "invarrow3", "invarrow4", "humanbackl", "humanbackr", "bookclosed"];
    const [texts, cat, loaded, hudT, eyeT, gl0, gl1, gr0, gr1, baseMeta, vmeta, shops, pool] = await Promise.all([
      Texts.load(game), ItemCatalog.load(game),
      Promise.all(TEX.map(n => loadTexOr(game, VAR && OWN.has(n) ? `${VAR}${n}.webp` : `${BASE}${n}.webp`))),
      Promise.all(hudNames.map(n => loadTexOr(game, `${HUD}${n}.png`))),
      loadTexOr(game, `${INN}eye.webp`),
      loadTexOr(game, `${INN}gem_lbuttonoff.webp`), loadTexOr(game, `${INN}gem_lbuttonon.webp`),
      loadTexOr(game, `${INN}gem_rbuttonoff.webp`), loadTexOr(game, `${INN}gem_rbuttonon.webp`),
      game.data.getJson<ShopMeta>(BASE + "shop.json"),
      VAR ? game.data.tryJson<VarShopMeta>(VAR + "shop.json") : Promise.resolve(undefined), loadShopsData(game), loadItemPool(game),
    ]);
    this.texts = texts; this.cat = cat;
    TEX.forEach((n, i) => { this.tex[n] = loaded[i]; });
    hudNames.forEach((n, i) => { this.hud[n] = hudT[i]; });
    this.stockData = shopStock(this.ctx.st, shops, this.townId, pool);
    for (const sh of this.stockData.shelves) for (const it of sh) this.cat.registerStock(it);
    const cfg = this.ctx.st.shops[String(this.townId)] ?? [];
    this.shelfKind = [0, 1, 2, 3].map(i => shelfKindOf(cfg[i]?.mask ?? 0));
    const meta: ShopMeta = VAR ? { anims: vmeta?.anims ?? {}, keeper: vmeta?.keeper } : baseMeta;
    const animDir = VAR ? VAR + "anim/" : BASE + "anim/";

    const view = (this.frame = frame640(this.root));
    view.addChild(spr(this.tex.inv, INV.x, INV.y), spr(this.tex.frame, FRAME.x, FRAME.y), spr(this.tex.scene, SCENE.x, SCENE.y));
    // brilhos animados da loja (Plagat) / fogo (Kaarg)
    const animEntries = Object.values(meta.anims);
    const animFrames = await Promise.all(animEntries.map(a => loadStrip(game, animDir, a)));
    animEntries.forEach((a, i) => {
      const frames = animFrames[i];
      const s = spr(frames[0], SCENE.x + a.x, SCENE.y + a.y);
      view.addChild(s);
      this.anims.push({ sprite: s, frames, t: Math.random(), pos: 0, fps: VAR ? 8 : 11 });
    });
    // lojista
    const km = meta.keeper;
    if (km) {
      const kd = (VAR ?? BASE) + "anim/";
      const [yes, no, idle, rest] = await Promise.all([loadStrip(game, kd, km.yes), loadStrip(game, kd, km.no), km.idle ? loadStrip(game, kd, km.idle) : Promise.resolve([]),
        km.rest ? loadStrip(game, kd, km.rest) : Promise.resolve([])]);
      const r0 = rest[0] ?? idle[0] ?? yes[0];
      const sprite = spr(r0, SCENE.x + km.x, SCENE.y + km.y);
      view.addChild(sprite);
      this.keeper = { sprite, rest: r0, idle, yes, no, pos: 0, t: 0, wait: 4 + Math.random() * 4 };
    }
    // prateleira Elven do acampamento: só aparece depois da conversa com o druida gabola (675/78 → bit 0x80000)
    const elven = vmeta?.extra?.elven;
    if (VAR && elven && this.shelfKind.includes("elven") && this.stockData.shelves[this.shelfKind.indexOf("elven")]?.length) {
      view.addChild(spr(await loadTexOr(game, VAR + "elven.webp"), SCENE.x + elven.x, SCENE.y + elven.y));
    }
    // regiões das prateleiras sobre a cena (com o realce `hili_*` nas lojas que o têm)
    const boxes: Array<Box & { kind: string }> = VAR
      ? Object.entries(vmeta?.hili ?? {}).map(([k, h]) => ({ kind: k, ...h }))
      : HOTSPOTS.map(h => ({ kind: h.shelf, ...h }));
    for (const b of boxes) {
      const shelf = this.shelfKind.indexOf(b.kind);
      if (shelf < 0) continue;
      const spot: Spot = { shelf, kind: b.kind, x: SCENE.x + b.x, y: SCENE.y + b.y, w: b.w, h: b.h };
      if (VAR) {
        const t = await loadTexOr(game, `${VAR}hili_${b.kind}.webp`);
        if (t !== Texture.EMPTY) { spot.hili = spr(t, spot.x, spot.y); spot.hili.visible = false; spot.hili.eventMode = "none"; view.addChild(spot.hili); }
      }
      this.hotSpots.push(spot);
    }
    for (const s of this.hotSpots) {
      const z = new Container();
      z.hitArea = new Rectangle(s.x, s.y, s.w, s.h);
      z.eventMode = "static"; z.cursor = "pointer";
      z.on("pointertap", () => { if (this.blocked()) return; this.setShelf(s.shelf); });
      view.addChild(z);
    }
    view.addChild(spr(this.tex.menu, MENU.x, MENU.y), spr(this.tex.table, TABLE.x, TABLE.y), spr(this.hud.invframe, BAR.x, BAR.y));
    view.addChild(this.arrowsC, this.gridC, this.tableC, this.barC);
    this.buildMenu(view);

    // retrato do herói na moldura oval de 176 px do HUD (humanbackl + humanbackr; a mesma boneca da taverna/missão), livro e olho dos cantos
    view.addChild(spr(this.hud.humanbackl, MENU.x, OVAL.y), spr(this.hud.humanbackr, OVAL.x, OVAL.y), spr(this.hud.bookclosed, 480, 242), spr(eyeT, 608, 242));
    // gemas dos cantos (as setas douradas de rolar entre os personagens do grupo; só há um herói, então só acendem com o mouse)
    for (const [off, on, x] of [[gl0, gl1, 476], [gr0, gr1, 598]] as const) {
      const g = spr(off, x, 446);
      g.eventMode = "static"; g.cursor = "pointer";
      g.on("pointerover", () => { g.texture = on; }).on("pointerout", () => { g.texture = off; });
      view.addChild(g);
    }
    this.hint = new Hint(view);

    // ponteiro (coordenadas 640×480 do quadro): etiqueta, arrasto e roda
    view.on("pointermove", (e: FederatedPointerEvent) => this.onMove(e));
    view.on("pointerleave", () => { this.mouse.inside = false; this.refreshHint(); });
    view.on("pointerup", (e: FederatedPointerEvent) => this.onUp(e));
    view.on("pointerupoutside", (e: FederatedPointerEvent) => this.onUp(e));
    view.on("rightdown", (e: FederatedPointerEvent) => this.onRight(e));
    view.on("wheel", (e: FederatedWheelEvent) => this.onWheel(e));
    this.root.eventMode = "static";

    this.removeKey = onKey(e => {
      if (e.key !== "Escape" || this.tip) return;
      this.toggleMenu();
    });
    await this.preloadIcons();
    // a grade começa na prateleira de escudos (como o original, em Plagat e em Kaarg), senão a 0 (no acampamento druida ela abre vazia, só com as caveiras da grade)
    const sh = [0, 1, 2, 3].findIndex(i => shelfAccepts(cfg[i]?.mask ?? 0).shields && this.shelfItems(i).length);
    const ar = [0, 1, 2, 3].findIndex(i => this.shelfKind[i] === "armor");
    const first = sh >= 0 ? sh : Math.max(0, ar);
    this.setShelf(first);
    this.renderAll();
    void this.drawDoll();
    this.openTip();
  }

  /** Janela de dica ao entrar (ver ui/tipwin.ts; cenários de captura usam `openTip`/`closeTip`). */
  openTip(): void {
    if (!this.frame || this.tip || !tipsEnabled()) return;
    const text = this.texts.tip(3);
    if (!text) return;
    this.tip = showTipWindow(this.frame, { text, x: 161, y: 160, w: 304, h: 127, textW: 264, indent: 6, small: true, textPos: [-2, 2], gem: [2, 4], btn: [-3, 3], onClose: () => { this.tip = undefined; } });
  }
  closeTip(): void { this.tip?.close(); }

  private blocked(): boolean { return !!this.tip || !!this.modal; }

  private toggleMenu(): void {
    if (this.modal) { this.modal.destroy({ children: true }); this.modal = undefined; return; }
    this.modal = openGameMenuIn(this.game, this.root, () => { this.modal = undefined; });
  }

  // ------------------------------------------------------------ ícones
  /** Ícones sob demanda: só o que está à vista (prateleira atual, inventário, equipamento) é baixado; o resto espera ser mostrado. */
  private async preloadIcons(): Promise<void> {
    const hero = this.game.state.hero!;
    const ids = new Set<string>([...hero.inventory.map(i => i.id), ...Object.values(hero.equipment).filter((v): v is string => !!v)]);
    for (let i = 0; i < 4; i++) for (const it of this.shelfItems(i).slice(0, 6)) ids.add(it.id);
    await Promise.all([...ids].map(id => this.fetchIcon(this.cat.iconPath(this.cat.get(id)))));
  }

  private pendingIcons = new Set<string>();
  private failedIcons = new Set<string>();
  private iconTimer = 0;

  private async fetchIcon(path: string): Promise<void> {
    if (this.iconCache.has(path) || this.pendingIcons.has(path) || this.failedIcons.has(path)) return;
    this.pendingIcons.add(path);
    try { this.iconCache.set(path, await this.game.data.texture(path)); } catch { this.failedIcons.add(path); /* ícone ausente: fica o quadrado cinza */ }
    this.pendingIcons.delete(path);
  }

  /** Textura do ícone; se ainda não foi baixado, pede e redesenha quando chegar. */
  private icon(it: ItemDef): Texture | undefined {
    const path = this.cat.iconPath(it);
    const t = this.iconCache.get(path);
    if (t || this.pendingIcons.has(path) || this.failedIcons.has(path)) return t;
    void this.fetchIcon(path).then(() => {
      if (this.root.destroyed || this.iconTimer) return;
      this.iconTimer = window.setTimeout(() => { this.iconTimer = 0; if (!this.root.destroyed) this.renderAll(); }, 40);
    });
    return undefined;
  }

  // ------------------------------------------------------------ estado
  private get hero() { return this.game.state.hero!; }

  private held(id: string): number {
    return this.hero.inventory.filter(i => i.id === id).reduce((n, e) => n + (e.count ?? 1), 0);
  }
  private onTable(src: "shop" | "mine", id: string): number { return this.table.filter(t => t.src === src && t.id === id).length; }

  /** Aviso curto (cheio, sem ouro...) na etiqueta do mouse — texto nosso: o original não mostra mensagens. */
  private note(msg: string): void {
    if (!msg) return;
    this.hint.show(msg, this.mouse.x, this.mouse.y);
    clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => { this.flashTimer = 0; this.refreshHint(); }, 1800);
  }

  /** Itens da prateleira i (estoque da campanha: campaign/shops.ts). */
  private shelfItems(i: number): ItemDef[] {
    return (this.stockData.shelves[i] ?? []).filter(s => s.count > 0).map(s => this.cat.get(s.id));
  }

  private stockCount(id: string): number {
    for (const sh of this.stockData.shelves) { const s = sh.find(x => x.id === id); if (s) return s.count; }
    return 0;
  }

  private setShelf(s: number): void {
    this.shelf = s;
    this.shopRow = 0;
    this.game.audio.stopSpeech();
    this.renderGrid();
  }

  /** Lojista descreve a classe do item (interrompe a fala anterior; classe sem arquivo = silêncio). */
  private sayItem(id: string): void {
    const base = Number(id.split("#")[0]);
    if (!this.voices || !Number.isFinite(base) || base <= 0) { this.game.audio.stopSpeech(); return; }
    this.voices.sayItem(this.game, this.voiceDir, base);
  }

  private addToTable(e: Entry): void {
    if (this.table.length >= SLOTS) { this.note("The table is full"); return; }
    if (e.src === "mine" && this.held(e.id) - this.onTable("mine", e.id) <= 0) return;
    if (e.src === "shop" && this.onTable("shop", e.id) >= this.stockCount(e.id)) return;
    this.table.push(e);
    this.renderAll();
  }

  private removeFromTable(i: number): void { this.table.splice(i, 1); this.renderAll(); }

  private buyTotal(): number { return this.table.filter(t => t.src === "shop").reduce((s, t) => s + this.cat.get(t.id).price, 0); }
  private sellTotal(): number { return this.table.filter(t => t.src === "mine").reduce((s, t) => s + this.cat.sellPrice(this.cat.get(t.id)), 0); }

  private addInv(id: string): void {
    const e = this.hero.inventory.find(i => i.id === id);
    if (e) e.count = (e.count ?? 1) + 1; else this.hero.inventory.push({ id });
  }
  private removeInv(id: string): void {
    const i = this.hero.inventory.findIndex(x => x.id === id);
    if (i < 0) return;
    const e = this.hero.inventory[i];
    if ((e.count ?? 1) > 1) e.count = (e.count ?? 1) - 1; else this.hero.inventory.splice(i, 1);
  }

  private buy(): void {
    const items = this.table.filter(t => t.src === "shop");
    if (!items.length) return;
    const total = this.buyTotal();
    if (this.hero.gold < total) { this.note("Not enough money"); this.keeperDo("no"); return; }
    this.hero.gold -= total;
    for (const t of items) {
      this.addInv(t.id);
      const shelf = this.stockData.shelves.findIndex(sh => sh.some(x => x.id === t.id));
      if (shelf >= 0) takeFromStock(this.ctx.st, this.townId, shelf, t.id);
    }
    this.table = this.table.filter(t => t.src !== "shop");
    this.game.state.save();
    this.keeperDo("yes");
    this.renderAll();
  }

  private sell(): void {
    const items = this.table.filter(t => t.src === "mine");
    if (!items.length) return;
    const total = this.sellTotal();
    for (const t of items) {
      this.removeInv(t.id);
      // o item vendido vai para a prateleira cuja máscara aceita a categoria [exe 0x521d4c]
      const it = this.cat.get(t.id);
      const kind = it.kind === "weapon" ? "weapon" : it.kind === "shield" ? "shield" : it.kind === "book" ? "book"
        : it.kind === "armor" ? (it.usableBy?.includes("fighter") ? "armor" : "mageArmor") : "other";
      if (kind !== "other") putInStock(this.ctx.st, this.townId, { id: t.id, base: Number(t.id.split("#")[0]) || 0, name: it.name, price: it.price, count: 1 }, kind);
    }
    this.hero.gold += total;
    this.table = this.table.filter(t => t.src !== "mine");
    this.game.state.save();
    this.keeperDo("yes");
    this.renderAll();
  }

  private equip(id: string): void {
    const it = this.cat.get(id);
    if (it.slot === "none") { this.note("Cannot be worn"); return; }
    const old = this.hero.equipment[it.slot];
    this.removeInv(id);
    this.hero.equipment[it.slot] = id;
    if (old) this.addInv(old);
    this.game.state.save();
    this.renderAll();
    void this.drawDoll();
  }

  private unequip(slot: string): void {
    const id = this.hero.equipment[slot];
    if (!id) return;
    this.hero.equipment[slot] = undefined;
    this.addInv(id);
    this.game.state.save();
    this.renderAll();
    void this.drawDoll();
  }

  // ------------------------------------------------------------ desenho
  private renderAll(): void {
    this.renderGrid(); this.renderBar(); this.renderTable(); this.renderPlaques();
  }

  private clear(c: Container): void { for (const ch of c.removeChildren()) ch.destroy({ children: true }); }

  /** Ícone 80×80 do item (quadrado escuro enquanto o arquivo não chega). */
  private makeIcon(it: ItemDef): Container {
    const c = new Container();
    const t = this.icon(it);
    if (t) { const s = new Sprite(t); s.width = 80; s.height = 80; c.addChild(s); }
    else c.addChild(new Graphics().roundRect(4, 4, 72, 72, 6).fill({ color: 0x3a2a1a, alpha: 0.6 }));
    return c;
  }


  /** Célula de item (80×80): ícone + aba de peso (laranja = loja, verde = meu) + `corner` embaixo à esquerda (quantidade). */
  private makeCell(it: ItemDef, mine: boolean, count?: string): Container {
    const c = new Container();
    c.addChild(this.makeIcon(it));
    // aba do preço (canto sup. dir.; medida em refs/original/shop_*.png): moldura clara, miolo bronze, pino à direita; largura = texto + folga.
    // Embaixo à esquerda, a quantidade em estoque (Kaarg no original: 12, 58, 175, 350, 2.700, 4.200 na aba e 5, 3, 3, 3, 4, 2 embaixo).
    const price = fmtMoney(mine ? this.cat.sellPrice(it) : it.price);
    {
      const t = makeText(price, { font: "font2", color: NUM_GOLD, shadow: true });
      const bw = Math.ceil(t.width) + 7, x0 = 80 - bw;
      const g = new Graphics().rect(x0 + 1, 0, bw - 1, 10).fill(0x735942).rect(x0 + 2, 1, bw - 3, 8).fill(0x523418)
        .rect(x0, 1, 1, 8).fill(0x735942).rect(x0 + 1, 9, bw - 1, 1).fill(0x422c10)
        .rect(75, 2, 5, 6).fill(0x081408).rect(76, 3, 3, 3).fill(0xa5a67b);
      c.addChild(g);
      t.anchor.set(1, 0); t.position.set(75, 1); c.addChild(t);
    }
    if (count) { const q = makeText(count, { font: "font2", color: NUM_GOLD, shadow: true }); q.position.set(10, 66); c.addChild(q); }
    return c;
  }

  private bindItem(c: Container, entry: Entry, fromTable: boolean, onTap: () => void): void {
    c.hitArea = new Rectangle(0, 0, 80, 80);
    c.eventMode = "static"; c.cursor = "pointer";
    c.on("pointerdown", (e: FederatedPointerEvent) => {
      if (e.button !== 0 || this.blocked()) return;
      const p = this.frame.local(e);
      this.drag = { entry, sx: p.x, sy: p.y, fromTable };
    });
    c.on("pointertap", (e: FederatedPointerEvent) => {
      if (this.justDragged) { this.justDragged = false; return; }
      if (e.button !== 0 || this.blocked()) return;
      onTap();
    });
  }

  private shelfRows(): number { return Math.ceil(this.shelfItems(this.shelf).length / GRID_COLS); }

  private renderGrid(): void {
    this.clear(this.gridC);
    const stock = this.shelfItems(this.shelf);
    const maxRow = Math.max(0, Math.ceil(stock.length / GRID_COLS) - GRID_ROWS);
    this.shopRow = Math.max(0, Math.min(this.shopRow, maxRow));
    const slice = stock.slice(this.shopRow * GRID_COLS, (this.shopRow + GRID_ROWS) * GRID_COLS);
    slice.forEach((it, i) => {
      const n = this.stockCount(it.id) - this.onTable("shop", it.id);
      const c = new Container();
      c.addChild(new Sprite(this.tex.backinvs), this.makeCell(it, false, String(Math.max(0, n))));
      c.position.set(GRID_X + (i % GRID_COLS) * 80, GRID_Y + Math.floor(i / GRID_COLS) * 80);
      if (n <= 0) c.alpha = 0.35;
      this.bindItem(c, { src: "shop", id: it.id }, false, () => { this.sayItem(it.id); this.addToTable({ src: "shop", id: it.id }); });
      this.gridC.addChild(c);
    });
    this.renderArrows();
  }

  /** Ornamentos acima/abaixo da grade: gema acesa = dá para rolar nesse sentido. */
  private renderArrows(): void {
    this.clear(this.arrowsC);
    const maxRow = Math.max(0, this.shelfRows() - GRID_ROWS);
    const up = this.shopRow > 0, down = this.shopRow < maxRow;
    const u = spr(this.tex[up ? "arrow1" : "arrow3"], ARROW_UP.x, ARROW_UP.y);
    const d = spr(this.tex[down ? "arrow4" : "arrow2"], ARROW_DOWN.x, ARROW_DOWN.y);
    for (const [s, on, dir] of [[u, up, -1], [d, down, 1]] as const) {
      if (on) { s.eventMode = "static"; s.cursor = "pointer"; s.on("pointertap", () => { if (!this.blocked()) { this.shopRow += dir; this.renderGrid(); } }); }
    }
    this.arrowsC.addChild(u, d);
  }

  /** Faixa do inventário: 1ª célula = dinheiro, as outras 4 = itens do herói (as setas das pontas rolam). */
  private bagList(): Array<{ id: string; left: number }> {
    const merged = new Map<string, number>();
    for (const e of this.hero.inventory) merged.set(e.id, (merged.get(e.id) ?? 0) + (e.count ?? 1));
    return [...merged].map(([id, n]) => ({ id, left: n - this.onTable("mine", id) })).filter(e => e.left > 0);
  }

  private renderBar(): void {
    this.clear(this.barC);
    const list = this.bagList();
    const vis = SLOTS - 1;
    this.invOff = Math.max(0, Math.min(this.invOff, Math.max(0, list.length - vis)));
    const back = this.hud.backinv;
    // dinheiro
    const m = new Container();
    m.position.set(SLOT0, BAR_Y);
    m.addChild(new Sprite(back), new Sprite(this.tex.money));
    const mt = makeText(fmtMoney(this.hero.gold), { font: "font2", color: NUM_GOLD, shadow: false });
    mt.position.set(10, 64);
    m.addChild(mt);
    this.barC.addChild(m);
    list.slice(this.invOff, this.invOff + vis).forEach((e, i) => {
      const it = this.cat.get(e.id);
      const c = new Container();
      c.position.set(SLOT0 + SLOT_W * (i + 1), BAR_Y);
      c.addChild(new Sprite(back));
      c.addChild(this.makeCell(it, true, e.left > 1 ? String(e.left) : undefined));
      this.bindItem(c, { src: "mine", id: e.id }, false, () => this.addToTable({ src: "mine", id: e.id }));
      this.barC.addChild(c);
    });
    // setas das pontas
    const can = [this.invOff > 0, this.invOff < list.length - vis];
    [0, 1].forEach(k => {
      const z = new Container();
      z.hitArea = new Rectangle(k ? 432 : 0, BAR.y, 32, 90);
      z.eventMode = can[k] ? "static" : "none"; z.cursor = "pointer";
      z.on("pointerover", () => { this.hoverArrow = k + 1; this.refreshBarArrow(); })
        .on("pointerout", () => { this.hoverArrow = 0; this.refreshBarArrow(); })
        .on("pointerdown", () => { if (!this.blocked()) { this.invOff += k ? 1 : -1; this.renderBar(); } });
      this.barC.addChild(z);
    });
    this.barArrow = new Sprite(Texture.EMPTY);
    this.barArrow.eventMode = "none";
    this.barC.addChild(this.barArrow);
    this.refreshBarArrow();
  }

  private barArrow?: Sprite;
  private refreshBarArrow(): void {
    const s = this.barArrow;
    if (!s || s.destroyed) return;
    if (!this.hoverArrow) { s.visible = false; return; }
    s.texture = this.hud[`invarrow${this.hoverArrow}`];
    s.position.set(this.hoverArrow === 1 ? 0 : 432, BAR.y + 2);
    s.visible = true;
  }

  private renderTable(): void {
    this.clear(this.tableC);
    this.table.forEach((e, i) => {
      const it = this.cat.get(e.id);
      const c = this.makeCell(it, e.src === "mine");
      c.position.set(SLOT0 + SLOT_W * i, TABLE_Y);
      this.bindItem(c, e, true, () => this.removeFromTable(i));
      this.tableC.addChild(c);
    });
  }

  private buildMenu(view: Container): void {
    const labels = [72, 70, 71, 73].map((n, i) => this.texts.label(n, ["Undo", "Buy", "Sell", "Exit"][i]));
    const hits = [() => this.undo(), () => this.buy(), () => this.sell(), () => this.leave()];
    PLAQUES.forEach((p, i) => {
      const cx = MENU.x + MENU.w / 2 + 1;
      const l = makeText(labels[i], { font: "font4", color: TXT_GOLD });
      l.anchor.set(0.5); l.position.set(cx, p.ly);
      const v = makeText("0", { font: "font4", color: TXT_GOLD });
      v.anchor.set(0.5); v.position.set(cx, p.vy);
      l.eventMode = v.eventMode = "none";
      this.plaqueTxt.push([l, v]);
      const z = new Container();
      z.hitArea = new Rectangle(MENU.x + p.x, MENU.y + p.y, p.w, p.h);
      z.eventMode = "static"; z.cursor = "pointer";
      z.on("pointertap", () => { if (!this.blocked()) hits[i](); });
      view.addChild(z, l, v);
    });
  }

  private renderPlaques(): void {
    const gold = this.hero.gold;
    const vals = [gold, this.buyTotal(), this.sellTotal(), gold];
    vals.forEach((v, i) => { this.plaqueTxt[i][1].text = fmtMoney(v); });
  }

  private undo(): void { this.table = []; this.renderAll(); }
  private leave(): void { this.game.audio.stopSpeech(); this.game.state.save(); this.nav.go("town", { town: this.townId }); }

  // ------------------------------------------------------------ boneca do herói
  /** Retrato do herói na moldura oval (a mesma boneca da taverna/missão: mission/hud buildDoll). */
  private async drawDoll(): Promise<void> {
    const ticket = ++this.dollTicket;
    const hero = ensureHero(this.game);
    try {
      const { buildDoll } = await import("../mission/hud");
      const items = Object.values(hero.equipment ?? {}).map(v => Number(v)).filter(v => Number.isFinite(v) && v > 0);
      const doll = await buildDoll(this.game, { female: hero.sex === "female", mage: hero.heroClass === "mage", face: hero.face, items, hero: true });
      if (!doll || this.root.destroyed || ticket !== this.dollTicket) { doll?.destroy({ children: true }); return; }
      this.doll?.destroy({ children: true });
      this.doll = doll;
      doll.position.set(OVAL.x, OVAL.y + 2);
      doll.eventMode = "none";
      // por cima do oval, abaixo das gemas e da etiqueta
      this.frame.addChildAt(doll, this.frame.children.indexOf(this.hint));
    } catch (err) { console.warn("[loja] retrato do herói indisponível:", (err as Error)?.message ?? err); }
  }

  /** Slot do item vestido sob o ponto (teste de alfa por camada, de cima para baixo; como o MissionScene.dollSlotAt). */
  private async dollSlotAt(x: number, y: number): Promise<string | undefined> {
    if (!this.doll) return undefined;
    const [{ dollLayers }, { alphaAt }] = await Promise.all([import("../mission/hud"), import("../mission/itemui")]);
    const layers = dollLayers(this.doll);
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i];
      if (!l.item) continue;
      if (alphaAt(l.texture, x - this.doll.x - l.x, y - this.doll.y - l.y) > 127) {
        return Object.keys(this.hero.equipment).find(s => Number(this.hero.equipment[s]) === l.item);
      }
    }
    return undefined;
  }

  // ------------------------------------------------------------ mouse
  /** Etiqueta do que está sob o mouse (rótulos 58..65, 66..69, 74 de main.txt; itens: nome + preço). */
  private hintLines(x: number, y: number): string[] {
    const T = (n: number, fb: string) => this.texts.label(n, fb);
    if (this.blocked()) return [];
    if (this.drag?.ghost) return [];
    const inR = (a: number, b: number, w: number, h: number) => x >= a && y >= b && x < a + w && y < b + h;
    const itemLines = (it: ItemDef, price: number, sell: boolean): string[] => {
      const l = [it.name];
      if (it.damage) l.push(`Damage ${it.damage[0]}-${it.damage[1]}`);
      if (it.weight !== undefined) l.push(`Weight ${it.weight}`);
      if (it.defense !== undefined && it.defense > 0) l.push(`Defense ${it.defense}`);
      if (it.absorption !== undefined && it.absorption > 0) l.push(`Absorption ${it.absorption}`);
      l.push(`${sell ? "Sell" : "Price"} ${fmtMoney(price)}`);
      return l;
    };
    // plaquetas
    for (let i = 0; i < 4; i++) if (inR(MENU.x + PLAQUES[i].x, MENU.y + PLAQUES[i].y, PLAQUES[i].w, PLAQUES[i].h)) return [T([68, 66, 67, 69][i], "")];
    // grade
    if (inR(GRID_X, GRID_Y, GRID_COLS * 80, GRID_ROWS * 80)) {
      const c = Math.floor((x - GRID_X) / 80), r = Math.floor((y - GRID_Y) / 80);
      const it = this.shelfItems(this.shelf)[(this.shopRow + r) * GRID_COLS + c];
      return it ? itemLines(it, it.price, false) : [T(60, "Shop Shelf")];
    }
    if (inR(ARROW_UP.x, ARROW_UP.y, ARROW_UP.w, ARROW_UP.h)) return [T(56, "Scroll up")];
    if (inR(ARROW_DOWN.x, ARROW_DOWN.y, ARROW_DOWN.w, ARROW_DOWN.h)) return [T(57, "Scroll down")];
    // mesa
    if (inR(TABLE.x, TABLE.y, TABLE.w, TABLE.h)) {
      const i = Math.floor((x - SLOT0) / SLOT_W);
      const e = x >= SLOT0 && y >= TABLE_Y && y < TABLE_Y + 80 ? this.table[i] : undefined;
      if (e) { const it = this.cat.get(e.id); return itemLines(it, e.src === "shop" ? it.price : this.cat.sellPrice(it), e.src === "mine"); }
      return [T(59, "Put items here to buy/sell")];
    }
    // faixa do inventário
    if (inR(BAR.x, BAR.y, 480, 90)) {
      if (x >= 0 && x < 32) return [T(55, "Scroll left")];
      if (x >= 432) return [T(54, "Scroll right")];
      const i = Math.floor((x - SLOT0) / SLOT_W);
      if (i === 0) return [T(74, "Money")];
      const e = this.bagList()[this.invOff + i - 1];
      if (e) { const it = this.cat.get(e.id); return itemLines(it, this.cat.sellPrice(it), true); }
      return [T(58, "Your hero's inventory")];
    }
    // prateleiras na cena
    for (const s of this.hotSpots) {
      if (inR(s.x, s.y, s.w, s.h)) return [T({ armor: 62, weapon: 63, magic: 64, potion: 65 }[s.kind] ?? 64, s.kind === "elven" ? "Elven Items" : "Magic Items")];
    }
    return [];
  }

  private refreshHint(): void {
    if (this.flashTimer) return;
    // realce das prateleiras (lojas com `hili_*`)
    const p = this.mouse;
    for (const s of this.hotSpots) if (s.hili) s.hili.visible = p.inside && !this.blocked() && p.x >= s.x && p.y >= s.y && p.x < s.x + s.w && p.y < s.y + s.h;
    const lines = p.inside ? this.hintLines(p.x, p.y) : [];
    if (lines.length) this.hint.show(lines, p.x, p.y); else this.hint.hide();
  }

  private onMove(e: FederatedPointerEvent): void {
    const p = this.frame.local(e);
    this.mouse = { x: p.x, y: p.y, inside: true };
    const d = this.drag;
    if (d && !d.ghost && Math.hypot(p.x - d.sx, p.y - d.sy) > 5) {
      const t = this.icon(this.cat.get(d.entry.id));
      if (t) {
        const g = new Sprite(t); g.width = 80; g.height = 80; g.alpha = 0.85; g.anchor.set(0.5); g.eventMode = "none";
        d.ghost = g; this.frame.addChild(g);
      }
    }
    if (d?.ghost) d.ghost.position.set(p.x, p.y);
    this.refreshHint();
  }

  private onUp(e: FederatedPointerEvent): void {
    const d = this.drag;
    this.drag = undefined;
    if (!d) return;
    if (d.ghost) {
      this.justDragged = true;
      d.ghost.destroy();
      const p = this.frame.local(e);
      const over = p.x >= TABLE.x && p.x <= TABLE.x + TABLE.w && p.y >= TABLE.y && p.y <= TABLE.y + TABLE.h;
      if (over && !d.fromTable) this.addToTable(d.entry);
      else if (!over && d.fromTable) {
        const i = this.table.findIndex(t => t.src === d.entry.src && t.id === d.entry.id);
        if (i >= 0) this.removeFromTable(i);
      }
      setTimeout(() => { this.justDragged = false; }, 0);
    }
    this.refreshHint();
  }

  /** Botão direito: numa célula do inventário veste o item; na boneca tira o item vestido sob o mouse. */
  private onRight(e: FederatedPointerEvent): void {
    if (this.blocked()) return;
    const p = this.frame.local(e);
    if (p.y >= BAR.y && p.x >= SLOT0 + SLOT_W && p.x < 432) {
      const ent = this.bagList()[this.invOff + Math.floor((p.x - SLOT0) / SLOT_W) - 1];
      if (ent) this.equip(ent.id);
      return;
    }
    if (p.x >= OVAL.x && p.y >= OVAL.y) void this.dollSlotAt(p.x, p.y).then(slot => { if (slot) this.unequip(slot); });
  }

  private onWheel(e: FederatedWheelEvent): void {
    if (this.blocked()) return;
    const p = this.frame.local(e);
    const d = e.deltaY > 0 ? 1 : -1;
    if (p.y >= BAR.y) { this.invOff += d; this.renderBar(); } else if (p.x < 164) { this.shopRow += d; this.renderGrid(); }
  }

  /** gesto do lojista: "yes" (negócio feito) ou "no" (sem dinheiro) */
  private keeperDo(which: "yes" | "no"): void {
    const k = this.keeper;
    if (!k) return;
    k.cur = k[which]; k.pos = 0; k.t = 0;
  }

  override update(dtMs: number): void {
    const k = this.keeper;
    if (k) {
      k.t += dtMs / 1000;
      if (!k.cur) {
        k.wait -= dtMs / 1000;
        if (k.wait <= 0 && k.idle.length > 1) { k.cur = [...k.idle, ...k.idle.slice(0, -1).reverse()]; k.pos = 0; k.t = 0; }
      } else {
        while (k.t >= 1 / 12 && k.cur) {
          k.t -= 1 / 12; k.pos++;
          if (k.pos >= k.cur.length) { k.cur = undefined; k.wait = 5 + Math.random() * 6; k.sprite.texture = k.rest; }
        }
        if (k.cur) k.sprite.texture = k.cur[k.pos];
      }
    }
    for (const a of this.anims) {
      a.t += dtMs / 1000;
      while (a.t >= 1 / a.fps) { a.t -= 1 / a.fps; a.pos = (a.pos + 1) % a.frames.length; }
      a.sprite.texture = a.frames[a.pos];
    }
  }

  override exit(): void { this.removeKey?.(); this.tip?.close(); clearTimeout(this.iconTimer); clearTimeout(this.flashTimer); this.game.audio.stopSpeech(); }
}
