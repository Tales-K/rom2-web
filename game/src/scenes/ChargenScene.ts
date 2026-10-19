import { Container, Graphics, Rectangle, Sprite, Texture, type FederatedPointerEvent } from "pixi.js";
import { Scene, SCREEN_H, SCREEN_W } from "../core/scene";
import type { HeroState } from "../core/state";
import { ATTRS, buildHero, canDec, canInc, dec, derive, inc, loadChargenData, newDraft, type Attr, type ChargenData, type ClassDef, type ClassId, type Draft } from "../ui/chargenData";
import { applyThemeCursor, setThemeCursor } from "../ui/cursor";
import { ConfirmDialog } from "../ui/dialog";
import { frame640, type Frame640 } from "../ui/frame640";
import { HitMap, bindHitRegions, loadHitMap } from "../ui/hitmap";
import { drawHeroSheet, type HeroSheet } from "../ui/herosheet";
import { loadFonts, makeText, type GameText } from "../ui/text";
import { Hint } from "../ui/hint";
import type { Game } from "../core/game";
import { warm, warmTextures } from "../ui/prefetch";
import { loadTexOr, safeEnter, Texts } from "../town/common";
import { showTipWindow, tipsEnabled, type TipWindow } from "../ui/tipwin";
import { loadMpChars, saveMpChars } from "../ui/multichar";

const DIR = "assets/ui/chargen/";

interface Box { x: number; y: number; w: number; h: number; }
interface Meta {
  /** escala da arte gerada (1 = 640×480 nativo; tools/pipeline/menu.py --scale) */
  scale?: number;
  windows: Box[]; sel: Box[]; levels: Box[]; cancel: Box; ok: Box; name: Box;
  torches: Array<Box & { frames: number }>;
  panels: Record<"attr" | "stats" | "buttons" | "portrait", Box>;
  /** placas Accept/Reset/Back (inn/button{1,2,3}off|on) */
  plates?: Box[];
  columns: Record<"fighter" | "mag", Box & { icons: Array<Box & { name: string; id: number }> }>;
  pm_size: number;
}

/** Retrato (janela de vitral) -> classe. Ordem das janelas no bitmap: guerreiro, guerreira, maga, mago. */
const WINDOW_CLASS: ClassId[] = ["male_fighter", "female_fighter", "female_mage", "male_mage"];
const LEVELS: HeroState["difficulty"][] = ["easy", "normal", "hard"];
/** Ícones que o original NÃO tem (hover/clique não fazem nada, nem tela com ele: refs/original/chargen_b_*_hover_shooting|astral, 19/10): Shooting do guerreiro (5º) e Astral da maga (2º). */
const NO_ICON: Record<"fighter" | "mag", number> = { fighter: 5, mag: 2 };
/** Texto (main.res) da dica de cada ícone, na ordem de ICON_ALIGN: espadas/armas 171..175; esferas Air 178, Astral 180, Fire 176, Water 177, Earth 179. */
const ICON_TIP: Record<"fighter" | "mag", number[]> = { fighter: [171, 172, 173, 174, 175], mag: [178, 180, 176, 177, 179] };
const ICON_ALIGN: Record<"fighter" | "mag", string[]> = { fighter: ["blade", "axe", "bludgeon", "pike", "shooting"], mag: ["air", "astral", "fire", "water", "earth"] };
const ICON_SFX: Record<string, string> = {
  blade: "chrgen/skill/fsword", axe: "chrgen/skill/faxe", bludgeon: "chrgen/skill/fclub", pike: "chrgen/skill/fpike", shooting: "chrgen/skill/fbow",
  fire: "chrgen/skill/mfire", water: "chrgen/skill/mwater", air: "chrgen/skill/mair", earth: "chrgen/skill/mearth", astral: "chrgen/skill/mastral",
};

/** Nomes (sem extensão) das imagens da criação de personagem, em DIR; ver tools/pipeline/menu.py. */
function textureNames(meta: Meta): string[] {
  const names: string[] = [];
  for (let k = 1; k <= 4; k++) { names.push(`pc_win${k}_on`, `pc_sel${k}a`, `pc_sel${k}b`); }
  for (let k = 0; k < 3; k++) for (const t of ["l", "lon", "on"]) names.push(`pc_lvl${k}_${t}`);
  names.push("pc_bg", "pc_ok", "pc_cancel", "pc_name", "pc_torch1", "pc_torch2",
    "pb_attr", "pb_stats", "pb_buttons", "pb_portrait", "col_fighter", "col_mag");
  for (let k = 1; k <= 3; k++) names.push(`pb_btn${k}_off`, `pb_btn${k}_on`);
  for (const k of ["fighter", "mag"] as const) for (const ic of meta.columns[k].icons) for (const s of ["on", "shine_on", "shine_off"]) names.push(`ic_${k}_${ic.name}_${s}`);
  for (const n of ["mnloff", "mnlon", "mdisable", "pnloff", "pnlon", "pdisable"]) names.push(`btn_${n}`);
  return names;
}

/** Pré-carrega a criação de personagem em segundo plano (menu/abertura): a cena mais pesada da fatia. */
export async function prefetch(game: Game): Promise<void> {
  const d = game.data;
  const meta = await d.tryJson<Meta>(DIR + "chargen.json");
  if (!meta) return;
  await Promise.all(["data/classes.json", "data/items.json", "data/texts/main.json"].map(p => d.tryJson(p)));
  await warmTextures(game, [...textureNames(meta).map(n => `${DIR}${n}.webp`), DIR + "pc_hit.png", DIR + "hit_fighter.png", DIR + "hit_mag.png"], 6);
}

const MAX_NAME = 16;
/** Nome padrão de cada janela da etapa A (guerreiro, guerreira, maga, mago), lido nas capturas do original (refs/original/chargen_a_sel_*). */
const DEFAULT_NAMES = ["Aldor", "Sagita", "Galinel", "Gildarius"];
/** Cores medidas nas capturas do original (RGB565 do DirectDraw): dourado dos rótulos, amarelo do nome, verde dos valores,
 *  laranja dos títulos "Skills"/"Resistance". */
const GOLD = 0xbd9e4a, NAME_YELLOW = 0xffff73;

/** exp(v) = int((1.1^v − 1)·1000) (classes.json rules.skillExperience) */
const skillExpOf = (v: number, table: number[]): number => table[v] ?? Math.floor((Math.pow(1.1, v) - 1) * 1000);
const log11 = (x: number): number => Math.log(x) / Math.log(1.1);

type Stage = "A" | "B";

/**
 * Criação de personagem, como o original em 1024×768 (tela 640×480 no centro, borda preta; ui/frame640.ts):
 *  Etapa A ("precreate"): quatro janelas de vitral = classe+sexo, três peças de xadrez = dificuldade (padrão: a do meio),
 *    tabuleta = nome ("Name:" dourado + nome em amarelo, font4), ossos da direita = OK (etapa B), da esquerda = volta ao menu.
 *    Sem textos de ajuda: o original não escreve nada além do nome. Cursor "select" (mão).
 *  Etapa B: coluna central com as 4 armas (guerreiro; a arma escolhida aparece "acesa" com o bitmap `on`) ou as esferas (mago);
 *    painel de atributos com [valor][+][−] e os pontos livres embaixo; painel verde com a ficha completa em font2
 *    (nome, atributos, vida/mana, dano/absorção, ataque/defesa, habilidades/resistências, peso, XP, visão, velocidade);
 *    placas Accept/Reset/Back; retrato do herói (boneca do painel da missão) na moldura oval. Cursor "default" (seta).
 * Imagens: tools/pipeline/menu.py (graphics/interface/chrgen). Dados: data/classes.json.
 */
export default class ChargenScene extends Scene {
  private meta!: Meta;
  private data!: ChargenData;
  private items: Record<string, { slot?: string; kind?: string; weight?: number }> | undefined;
  private main: string[] = [];
  private tex = new Map<string, Texture>();
  private hitA!: HitMap;
  private hitCol: Partial<Record<"fighter" | "mag", HitMap>> = {};
  private restoreCursor?: () => void;
  private frame!: Frame640;
  private artK = 1;

  private stage: Stage = "A";
  private stageA = new Container();
  private stageB = new Container();
  private cover!: Graphics;
  private fadeIn = 1;
  private busy = false;

  // ---- estado
  private win = 0;                 // 1..4 janela selecionada (0 = nenhuma)
  private level = 1;               // 0..2 (padrão do original: a peça do meio)
  private name = "";
  /** modo Multiplayer (menu > Multiplayer > Accept): campos Name e Clan (Tab alterna), janelas de dica e Accept grava o personagem local */
  private multi = false;
  private clan = "";
  private field: "name" | "clan" = "name";
  private mpTip?: TipWindow;
  private texts?: Texts;
  private editing = false;         // (legado) clicou na tabuleta
  private nameTouched = false;     // original (chargen_a_sel_*, 19/10): o nome padrão acompanha a janela escolhida até o jogador digitar/apagar
  private caret = true;
  private caretMs = 0;
  private draft!: Draft;

  // ---- etapa A
  private hoverA = 0;
  private winOn: Sprite[] = [];
  private selA: Sprite[][] = [];
  private lvl: Record<"l" | "lon" | "on", Sprite>[] = [];
  private okS!: Sprite; private cancelS!: Sprite; private nameS!: Sprite;
  private nameLabel!: GameText; private nameTxt!: GameText;
  private clanLabel?: GameText; private clanTxt?: GameText;
  private torchS: { s: Sprite; frames: Texture[] }[] = [];
  private tMs = 0;

  // ---- etapa B
  private colSprites: Partial<Record<"fighter" | "mag", Container>> = {};
  private iconS: Record<string, Record<"on" | "shine_on" | "shine_off", Sprite>> = {};
  private hoverIcon = 0;
  private tip!: Hint;
  private hoverB = 0;              // 1..3 placas de botão
  private plateTexts: GameText[] = [];
  private plateS: Sprite[][] = [];
  private pmBtns: Array<{ attr: Attr; minus: Sprite[]; plus: Sprite[]; val: GameText }> = [];
  private pmHover: { attr: Attr; sign: -1 | 1 } | undefined;
  private poolTxt!: GameText;
  private stats = new Container();
  private portrait = new Container();
  private portraitKey = "";
  private glint = 0;

  private line = (n: number): string => (this.main[n] ?? "").replace(/#/g, "\n");
  private cls = (): ClassDef => this.data.classes[this.draftClass()];
  private draftClass = (): ClassId => WINDOW_CLASS[Math.max(0, (this.win || 1) - 1)];

  private onKey = (e: KeyboardEvent) => {
    if (ConfirmDialog.active || this.busy) return;
    if (this.stage === "A") this.keyA(e); else this.keyB(e);
  };

  // ================================================================== ciclo de vida

  override async enter(params?: unknown): Promise<void> {
    this.multi = Boolean((params as { multi?: boolean } | undefined)?.multi);
    await safeEnter(this.game, this.root, "character creation", () => this.build(), "menu");
    if (this.multi && this.frame) this.openMpTip();
    warm(this.game, ["town", "inn", "shop"]);
  }

  private async build(): Promise<void> {
    await loadFonts();
    const d = this.game.data;
    const [meta, data, mainJson, items, hits] = await Promise.all([
      d.getJson<Meta>(DIR + "chargen.json"), loadChargenData(p => d.tryJson(p)),
      d.tryJson<{ lines: string[] }>("data/texts/main.json"),
      d.tryJson<Record<string, { slot?: string; kind?: string; weight?: number }>>("data/items.json"),
      Promise.all([loadHitMap(DIR + "pc_hit.png"), loadHitMap(DIR + "hit_fighter.png"), loadHitMap(DIR + "hit_mag.png")]),
    ]);
    this.meta = meta; this.data = data; this.items = items;
    this.artK = meta.scale ?? 1;
    this.main = mainJson?.lines ?? [];
    [this.hitA, this.hitCol.fighter, this.hitCol.mag] = hits;
    await this.preload();

    this.win = 1; this.level = 1; this.nameTouched = false; this.name = this.multi ? "" : this.defaultName();
    if (this.multi) this.texts = await Texts.load(this.game);
    this.draft = newDraft(this.cls());

    this.game.audio.attach(this.game.state);
    this.game.audio.playMusic("chrgen", { fadeMs: 800 });

    const f = this.frame = frame640(this.root);
    this.buildA(); this.buildB();
    f.addChild(this.stageA, this.stageB);
    this.stageB.visible = false;

    this.cover = new Graphics().rect(0, 0, SCREEN_W, SCREEN_H).fill(0x000000);
    this.cover.eventMode = "none";
    this.root.addChild(this.cover);

    this.root.eventMode = "static";
    // etapa A: regiões da máscara do original (ui/hitmap.ts bindHitRegions); etapa B: colunas/placas/+− abaixo (onMove/onDown)
    bindHitRegions(f, this.hitA, this.artK, {
      enabled: () => this.stage === "A" && !this.busy && !ConfirmDialog.active,
      hover: id => { if (id !== this.hoverA) { this.hoverA = id; this.refreshA(); } },
      down: id => this.downA(id),
    });
    f.on("pointermove", (e: FederatedPointerEvent) => { const p = f.local(e); this.onMove(p.x, p.y); });
    f.on("pointerleave", () => this.onMove(-1, -1));
    f.on("pointerdown", (e: FederatedPointerEvent) => { const p = f.local(e); this.onDown(p.x, p.y); });

    this.restoreCursor = applyThemeCursor(this.game.app, "select");
    window.addEventListener("keydown", this.onKey, true);
    this.refreshA(); this.refreshB();
  }

  override update(dtMs: number): void {
    if (!this.cover) return;                       // enter() ainda carregando
    if (this.fadeIn > 0) { this.fadeIn = Math.max(0, this.fadeIn - dtMs / 450); this.cover.alpha = this.fadeIn; }
    this.tMs += dtMs;
    // tochas (15 quadros, ~12 fps); a segunda fica defasada
    this.torchS.forEach((t, i) => { t.s.texture = t.frames[(Math.floor(this.tMs / 80) + i * 7) % t.frames.length]; });
    if (this.stage === "A") {
      this.caretMs += dtMs;
      if (this.caretMs > 550) { this.caretMs = 0; this.caret = !this.caret; this.updateName(); }
    }
    this.glint += dtMs;
    if (this.stage === "A") {
      const flip = Math.floor(this.tMs / 700) % 2;
      this.selA.forEach((pair, i) => { pair[0].visible = this.win === i + 1 && flip === 0; pair[1].visible = this.win === i + 1 && flip === 1; });
    } else {
      this.updateIcons();
    }
  }

  override exit(): void {
    window.removeEventListener("keydown", this.onKey, true);
    ConfirmDialog.dismiss();
    this.restoreCursor?.();
  }

  private defaultName(): string { return DEFAULT_NAMES[0]; }

  private async preload(): Promise<void> {
    const names = textureNames(this.meta);
    const tx = await Promise.all(names.map(n => loadTexOr(this.game, `${DIR}${n}.webp`)));
    names.forEach((n, i) => this.tex.set(n, tx[i]));
  }

  /** Sprite da arte em coordenadas 640×480 (a arte pode ter sido gerada em outra escala: meta.scale). */
  private spr(name: string, b: Box, visible = true): Sprite {
    const s = new Sprite(this.tex.get(name)!);
    s.position.set(b.x / this.artK, b.y / this.artK); s.scale.set(1 / this.artK); s.visible = visible;
    return s;
  }

  private box(b: Box): Box { return { x: b.x / this.artK, y: b.y / this.artK, w: b.w / this.artK, h: b.h / this.artK }; }

  // ================================================================== etapa A (precreate)

  private buildA(): void {
    const m = this.meta, A = this.stageA;
    A.addChild(this.spr("pc_bg", { x: 0, y: 0, w: 640, h: 480 }));
    // tochas animadas
    m.torches.forEach((b, i) => {
      const sheet = this.tex.get(`pc_torch${i + 1}`)!;
      const frames: Texture[] = [];
      for (let f = 0; f < b.frames; f++) frames.push(new Texture({ source: sheet.source, frame: new Rectangle(f * b.w, 0, b.w, b.h) }));
      const s = new Sprite(frames[0]); s.position.set(b.x / this.artK, b.y / this.artK); s.scale.set(1 / this.artK);
      A.addChild(s); this.torchS.push({ s, frames });
    });
    // janelas (foco) e heróis selecionados (feixes de luz + figura)
    for (let k = 0; k < 4; k++) {
      const w = this.spr(`pc_win${k + 1}_on`, m.windows[k], false); A.addChild(w); this.winOn.push(w);
    }
    for (let k = 0; k < 4; k++) {
      const a = this.spr(`pc_sel${k + 1}a`, m.sel[k], false), b = this.spr(`pc_sel${k + 1}b`, m.sel[k], false);
      A.addChild(a, b); this.selA.push([a, b]);
    }
    // níveis (peças de xadrez)
    for (let k = 0; k < 3; k++) {
      const st = { l: this.spr(`pc_lvl${k}_l`, m.levels[k], false), lon: this.spr(`pc_lvl${k}_lon`, m.levels[k], false), on: this.spr(`pc_lvl${k}_on`, m.levels[k], false) };
      A.addChild(st.l, st.lon, st.on); this.lvl.push(st);
    }
    // ossos e tabuleta do nome (bitmaps "acesos" só no foco)
    this.cancelS = this.spr("pc_cancel", m.cancel, false); this.okS = this.spr("pc_ok", m.ok, false); this.nameS = this.spr("pc_name", m.name, false);
    A.addChild(this.cancelS, this.okS, this.nameS);
    // "Name:" (dourado) + nome (amarelo), font4 — posição medida em refs/original/chargen_a.png
    this.nameLabel = makeText(this.multi ? this.line(365) || "Name:" : "Name:", { font: "font4", color: GOLD });
    this.nameLabel.position.set(244, 432);
    this.nameTxt = makeText("", { font: "font4", color: NAME_YELLOW });
    this.nameTxt.position.set(300, 432);
    A.addChild(this.nameLabel, this.nameTxt);
    if (this.multi) {
      // Multiplayer (refs/original, 19/10): "Name:" e "Clan:" alinhados à direita em x=290, linhas em y=421 e 443, valores em x=300
      this.clanLabel = makeText(this.line(366) || "Clan:", { font: "font4", color: GOLD });
      this.clanTxt = makeText("", { font: "font4", color: NAME_YELLOW });
      this.nameLabel.anchor.set(1, 0); this.nameLabel.position.set(290, 421); this.nameTxt.position.set(300, 421);
      this.clanLabel.anchor.set(1, 0); this.clanLabel.position.set(290, 443); this.clanTxt.position.set(300, 443);
      A.addChild(this.clanLabel, this.clanTxt);
    }
    this.updateName();
  }

  private refreshA(): void {
    const h = this.hoverA;
    this.winOn.forEach((s, i) => { s.visible = h === i + 4 && this.win !== i + 1; });
    // peças: escolhida = `on`; foco = `l` (acesa) ou `lon` (acesa e escolhida)
    this.lvl.forEach((st, i) => {
      const sel = this.level === i, hov = h === i + 1;
      st.on.visible = sel && !hov; st.l.visible = hov && !sel; st.lon.visible = hov && sel;
    });
    this.cancelS.visible = h === 8; this.okS.visible = h === 9; this.nameS.visible = h === 10;
  }

  private updateName(): void {
    if (!this.nameTxt) return;
    const bar = this.caret && this.stage === "A" ? "|" : "";   // original: barra de 2 px sempre visível (pisca) na etapa A
    this.nameTxt.text = this.name + (!this.multi || this.field === "name" ? bar : "");
    if (this.clanTxt) this.clanTxt.text = this.clan + (this.field === "clan" ? bar : "");
  }

  private keyA(e: KeyboardEvent): void {
    const k = e.key;
    if (k === "Escape") { e.preventDefault(); this.cancel(); return; }
    if (k === "Enter") { e.preventDefault(); this.okA(); return; }
    if (this.multi && k === "Tab") { e.preventDefault(); this.field = this.field === "name" ? "clan" : "name"; this.caret = true; this.caretMs = 0; this.updateName(); return; }
    if (this.multi && this.mpTip && !this.mpTip.closed) return;
    if (k === "Backspace") { e.preventDefault(); if (this.multi && this.field === "clan") this.clan = this.clan.slice(0, -1); else this.name = this.name.slice(0, -1); this.nameTouched = true; this.editing = true; this.caret = true; this.caretMs = 0; this.updateName(); return; }
    if (k === "ArrowLeft" || k === "ArrowRight") { e.preventDefault(); this.pickWin(Math.max(1, Math.min(4, (this.win || 1) + (k === "ArrowRight" ? 1 : -1)))); return; }
    if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && /[\p{L}\p{N} '\-.]/u.test(k) && (this.multi && this.field === "clan" ? this.clan : this.name).length < MAX_NAME) {
      e.preventDefault(); if (this.multi && this.field === "clan") this.clan += k; else this.name += k; this.nameTouched = true; this.editing = true; this.caret = true; this.caretMs = 0; this.updateName();
    }
  }

  private pickWin(i: number): void {
    if (this.win === i) return;
    this.win = i; this.draft = newDraft(this.cls());
    if (!this.nameTouched) { this.name = DEFAULT_NAMES[i - 1] ?? this.name; this.updateName(); }
    this.game.audio.playSfx("chrgen/char");
    this.refreshA(); this.refreshB();
  }

  private okA(): void {
    if (!this.name.trim()) { this.game.audio.playSfx("error"); void ConfirmDialog.ask(this.root, this.line(193), { yes: this.line(77), no: this.line(78), width: 560 }); return; }
    this.game.audio.playSfx("chrgen/ok");
    this.setStage("B");
  }

  private cancel(): void {
    this.game.audio.playSfx("click_ok");
    this.leave(() => this.multi ? this.game.go("menu", { multiLoader: true }) : this.game.go("menu"));
  }

  /** Janela de dica do Multiplayer (original: aparece em cada etapa; tips8 = classe/sexo, tips5/6 = armas/esferas). Posições medidas em refs/original (19/10). */
  private openMpTip(): void {
    if (!this.multi || !tipsEnabled() || !this.texts) return;
    this.mpTip?.close();
    const B = this.stage === "B";
    const text = this.texts.tip(B ? (this.cls().mage ? 6 : 5) : 8);
    this.mpTip = showTipWindow(this.frame, B ? { text, x: 159, y: 280, w: 306, h: 192, textW: 264, wrapFull: true, textPos: [-2, 1], gem: [-2, 0], btn: [-7, 1] } : { text, x: 232, y: 48, w: 400, h: 128, textW: 360, gem: [-95, -1], btn: [4, 0], wrapFull: true });
  }

  // ================================================================== etapa B (alinhamento + atributos)

  private colKind = (): "fighter" | "mag" => (this.cls().mage ? "mag" : "fighter");

  private buildB(): void {
    const m = this.meta, B = this.stageB;
    // coluna central (a das armas e a das esferas; só uma visível). Sem escolha em foco, só o bitmap da coluna (4 armas);
    // a escolhida acende com o bitmap `on` (conferido no original: a espada do guerreiro padrão).
    for (const k of ["fighter", "mag"] as const) {
      const c = new Container();
      c.addChild(this.spr(`col_${k}`, m.columns[k]));
      for (const ic of m.columns[k].icons) {
        const set = {
          on: this.spr(`ic_${k}_${ic.name}_on`, ic, false), shine_on: this.spr(`ic_${k}_${ic.name}_shine_on`, ic, false), shine_off: this.spr(`ic_${k}_${ic.name}_shine_off`, ic, false),
        };
        c.addChild(set.on, set.shine_on, set.shine_off);
        this.iconS[`${k}:${ic.name}`] = set;
      }
      B.addChild(c); this.colSprites[k] = c;
    }
    const P = m.panels;
    B.addChild(this.spr("pb_attr", P.attr), this.spr("pb_stats", P.stats),
      this.spr("pb_buttons", P.buttons), this.spr("pb_portrait", P.portrait));

    // atributos: [valor][+][−] em cada linha (as 3 caixas do painel), medido em refs/original/chargen_b_fighter.png
    const sz = m.pm_size / this.artK;
    ATTRS.forEach((attr, i) => {
      const y = 54 + 32 * i;
      const mk = (a: string, b: string, c: string, x: number): Sprite[] => {
        const ss = [a, b, c].map(n => { const s = new Sprite(this.tex.get(n)!); s.position.set(x, y); s.width = sz; s.height = sz; return s; });
        ss[1].visible = false; ss[2].visible = false; B.addChild(...ss);
        return ss;
      };
      const plus = mk("btn_pnloff", "btn_pnlon", "btn_pdisable", 107);
      const minus = mk("btn_mnloff", "btn_mnlon", "btn_mdisable", 132);
      const val = makeText("", { font: "font4", shadow: true, color: GOLD, align: "center" });
      val.anchor.set(0.5, 0); val.position.set(93, y + 3);
      B.addChild(val);
      this.pmBtns.push({ attr, minus, plus, val });
    });
    this.poolTxt = makeText("", { font: "font4", shadow: true, color: GOLD, align: "center" });
    this.poolTxt.anchor.set(0.5, 0); this.poolTxt.position.set(84, 185);
    B.addChild(this.poolTxt);

    // ficha (painel verde): font2
    B.addChild(this.stats);

    // placas de botão (Accept / Reset / Back)
    [238, 239, 260].forEach((ln, i) => {
      const r = this.plateRect(i);
      const off = this.spr(`pb_btn${i + 1}_off`, r), on = this.spr(`pb_btn${i + 1}_on`, r, false);
      B.addChild(off, on); this.plateS.push([off, on]);
      const t = makeText(this.line(ln), { font: "font4", color: GOLD, align: "center" });
      t.anchor.set(0.5, 0); t.position.set(r.x + r.w / 2, r.y + 14);
      B.addChild(t); this.plateTexts.push(t);
    });

    // retrato (boneca) sobre a moldura oval
    this.portrait.position.set(P.portrait.x / this.artK, P.portrait.y / this.artK + 2);
    B.addChild(this.portrait);
    this.tip = new Hint(B);   // por cima de tudo na etapa B
  }

  /** retângulo (coordenadas 640×480) da placa i (0..2) do painel de botões */
  private plateRect(i: number): Box {
    return this.meta.plates?.[i] ? this.box(this.meta.plates[i]) : { x: 484, y: 44 + 47 * i, w: 140, h: 46 };
  }

  private refreshB(): void {
    if (!this.data) return;
    const c = this.cls(), d = this.draft;
    for (const k of ["fighter", "mag"] as const) this.colSprites[k]!.visible = k === this.colKind();
    for (const row of this.pmBtns) {
      const ok = { m: canDec(c, d, row.attr), p: canInc(c, d, row.attr) };
      const hov = this.pmHover && this.pmHover.attr === row.attr ? this.pmHover.sign : 0;
      row.minus[0].visible = ok.m && hov !== -1; row.minus[1].visible = ok.m && hov === -1; row.minus[2].visible = !ok.m;
      row.plus[0].visible = ok.p && hov !== 1; row.plus[1].visible = ok.p && hov === 1; row.plus[2].visible = !ok.p;
      row.val.text = String(d.attrs[row.attr]);
    }
    this.poolTxt.text = String(d.pool);
    // foco numa placa: bitmap "on" (hipótese: o original não foi capturado com o mouse sobre as placas)
    this.plateS.forEach(([off, on], i) => { on.visible = this.hoverB === i + 1; off.visible = !on.visible; });
    this.drawStats();
    this.updateIcons();
    void this.updatePortrait();
  }

  /** Ficha completa no painel verde (font2), no formato do original (posições medidas na captura do original). */
  private drawStats(): void {
    drawHeroSheet(this.stats, this.buildSheet(), this.meta.panels.stats.x / this.artK, this.meta.panels.stats.y / this.artK);
  }

  /** Dados da ficha do rascunho atual (também gravados no personagem do Multiplayer, ui/multichar.ts). */
  private buildSheet(): HeroSheet {
    const c = this.cls(), d = this.draft;
    const st = derive(c, d, this.data.skillExp);
    const L = (n: number) => this.line(n).toUpperCase();
    // habilidades: a escolhida = bônus; guerreiros têm Shooting 10 de base (captura do original: BLADE 20 ... SHOOTING 10)
    const skillKeys = c.mage ? ["fire", "water", "air", "earth", "astral"] : ["blade", "axe", "bludgeon", "pike", "shooting"];
    const skillLines = c.mage ? [36, 37, 38, 39, 40] : [30, 31, 32, 33, 34];
    const skills: Record<string, number> = {};
    for (const k of skillKeys) skills[k] = st.skills[k] ?? 0;
    if (!c.mage && d.align !== "shooting") skills.shooting = Math.max(skills.shooting, 10);
    const expTotal = skillKeys.reduce((a, k) => a + (skills[k] ? skillExpOf(skills[k], this.data.skillExp) : 0), 0);
    const f = c.mage ? 1 : 2;
    const hpMax = (body: number) => Math.floor((Math.pow(1.1, body) / 100 + 1) * Math.floor(body * f + log11(expTotal / 5000 + 1) * f));
    const mpMax = (sp: number) => c.mage ? Math.floor((Math.pow(1.1, sp) / 100 + 1) * Math.floor(sp * 2 + log11(expTotal / 5000 + 1) * 2)) : 0;
    const hpM = hpMax(d.attrs.body), mpM = mpMax(d.attrs.spirit);
    const hp = Math.min(hpM, st.health), mp = Math.min(mpM, st.mana);
    const hero = buildHero(c, d, this.name.trim() || "-", LEVELS[this.level], this.items);
    const weight = Object.values(hero.equipment ?? {}).concat(hero.inventory.map(i => i.id))
      .reduce((a, id) => a + (Number(this.items?.[String(id)]?.weight) || 0), 0) / 10;
    const sight = (d.attrs.mind + d.attrs.reaction) / 25 + 4;

    const res = st.resist as Record<string, number>;
    return {
      name: this.name.trim(),
      ...(this.multi ? { name2: this.clan.trim() } : {}),
      labels: {
        attrs: [L(15), L(16), L(17), L(18)], health: L(19), mana: L(20), dmg: L(23), absorb: L(24), attack: L(25), defense: L(26),
        skills: L(27), resistance: L(28), skillNames: skillLines.map(L), resistNames: [41, 42, 43, 44, 45].map(L),
        weight: L(35), xp: L(46), sight: L(21), speed: L(22),
      },
      attrs: [d.attrs.body, d.attrs.reaction, d.attrs.mind, d.attrs.spirit],
      health: [hp, hpM], mana: [mp, mpM], damage: [st.damage.min, st.damage.max], absorb: st.absorption, attack: st.attack, defense: st.defense,
      skills: skillKeys.map(k => skills[k]), resists: ["fire", "water", "air", "earth", "astral"].map(e => res[e] ?? 0),
      weight, xp: expTotal, sight, speed: st.speed,
    };
  }

  /** Retrato = boneca do herói (corpo pela face + equipamento inicial), a mesma do painel da missão (mission/hud.ts buildDoll). */
  private async updatePortrait(): Promise<void> {
    const c = this.cls();
    const key = c.id;
    if (key === this.portraitKey) return;
    this.portraitKey = key;
    const hero = buildHero(c, this.draft, this.name.trim() || "-", LEVELS[this.level], this.items);
    const items = Object.values(hero.equipment ?? {}).map(v => Number(v)).filter(n => Number.isFinite(n) && n > 0);
    try {
      const { buildDoll } = await import("../mission/hud");
      const doll = await buildDoll(this.game, { female: c.female, mage: c.mage, face: c.face, items, hero: true });
      if (this.portraitKey !== key || this.portrait.destroyed) { doll?.destroy({ children: true }); return; }
      this.portrait.removeChildren().forEach(o => o.destroy({ children: true }));
      if (doll) this.portrait.addChild(doll);
    } catch (err) {
      console.warn("[criação] retrato indisponível:", (err as Error)?.message ?? err);
    }
  }

  private updateIcons(): void {
    const k = this.colKind(), align = ICON_ALIGN[k];
    const pulse = Math.floor(this.glint / 450) % 2 === 0;
    align.forEach((al, i) => {
      const ic = this.meta.columns[k].icons[i];
      const set = this.iconS[`${k}:${ic.name}`];
      const selected = this.draft.align === al, hov = this.hoverIcon === i + 1;
      // escolhida: `on`; foco (sem escolher): brilho alternando shine_on/shine_off (hipótese; o original não foi capturado em foco)
      set.on.visible = selected;
      set.shine_on.visible = hov && !selected && pulse;
      set.shine_off.visible = hov && !selected && !pulse;
    });
  }

  private keyB(e: KeyboardEvent): void {
    const k = e.key;
    if (k === "Escape") { e.preventDefault(); this.setStage("A"); }
    else if (k === "Enter") { e.preventDefault(); this.accept(); }
  }

  private accept(): void {
    const c = this.cls();
    const hero = buildHero(c, this.draft, this.name.trim(), LEVELS[this.level], this.items);
    this.game.audio.playSfx("chrgen/ok");
    if (this.multi) {
      // Multiplayer: grava o personagem na lista local e volta à tela "New Character" (o jogo em rede não existe nesta versão)
      const items = Object.values(hero.equipment ?? {}).map(v => Number(v)).filter(n => Number.isFinite(n) && n > 0);
      saveMpChars([...loadMpChars(), {
        name: this.name.trim(), clan: this.clan.trim(), cls: c.id, gold: 1000, monsters: 0, players: 0, died: 0,
        sheet: this.buildSheet(), doll: { female: !!c.female, mage: !!c.mage, face: c.face ?? 0, items },
      }]);
      this.mpTip?.close();
      this.leave(() => this.game.go("menu", { multiLoader: true }));
      return;
    }
    this.game.state.newGame(hero);
    this.leave(() => this.game.go("town"));
  }

  private reset(): void {
    this.draft = newDraft(this.cls());
    this.game.audio.playSfx("undo");
    this.refreshB();
  }

  private setStage(s: Stage): void {
    this.stage = s;
    this.stageA.visible = s === "A"; this.stageB.visible = s === "B";
    this.hoverA = 0; this.hoverB = 0; this.hoverIcon = 0; this.pmHover = undefined; this.tip?.hide();
    if (this.restoreCursor) setThemeCursor(this.game.app, s === "A" ? "select" : "default");
    this.refreshA(); this.refreshB(); this.updateName();
    if (this.multi) this.openMpTip();
  }

  // ================================================================== ponteiro (coordenadas 640×480)

  private pointerY = 0;

  private onMove(x: number, y: number): void {
    this.pointerY = y;
    if (this.busy || ConfirmDialog.active) return;
    const K = this.artK;
    if (this.stage === "A") return;
    let icon = 0;
    const col = this.box(this.meta.columns[this.colKind()]);
    const hm = this.hitCol[this.colKind()]!;
    if (x >= col.x && x < col.x + col.w) icon = hm.at((x - col.x) * K, y * K);
    if (icon === NO_ICON[this.colKind()]) icon = 0;
    let plate = 0;
    for (let i = 0; i < 3; i++) { const r = this.plateRect(i); if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) plate = i + 1; }
    const sz = this.meta.pm_size / K;
    let pm: { attr: Attr; sign: -1 | 1 } | undefined;
    for (const row of this.pmBtns) {
      const m0 = row.minus[0], p0 = row.plus[0];
      if (x >= m0.x && x < m0.x + sz && y >= m0.y && y < m0.y + sz) pm = { attr: row.attr, sign: -1 };
      else if (x >= p0.x && x < p0.x + sz && y >= p0.y && y < p0.y + sz) pm = { attr: row.attr, sign: 1 };
    }
    if (icon !== this.hoverIcon || plate !== this.hoverB || pm?.attr !== this.pmHover?.attr || pm?.sign !== this.pmHover?.sign) {
      this.hoverIcon = icon; this.hoverB = plate; this.pmHover = pm;
      this.refreshB();
    }
    // dica do ícone: caixa com o canto esquerdo 3 px à direita do cursor e a base 3 px acima (medido em chargen_b_*_hover_*)
    if (icon) this.tip.show(this.line(ICON_TIP[this.colKind()][icon - 1]).split("\n"), x + 4, y, true); else this.tip.hide();
  }

  /** clique numa região da etapa A (ids de pc_hit.png): 1..3 peças de dificuldade, 4..7 janelas, 8 ossos da esquerda, 9 da direita, 10 nome */
  private downA(h: number): void {
    if (h >= 4 && h <= 7) this.pickWin(h - 3);
    else if (h >= 1 && h <= 3) {
      if (this.level !== h - 1) this.level = h - 1;
      this.game.audio.playSfx(`chrgen/level${h}`);
      this.refreshA();
    } else if (h === 8) this.cancel();
    else if (h === 9) this.okA();
    else if (h === 10) { if (this.multi) this.field = this.pointerY >= 432 ? "clan" : "name"; this.editing = true; this.caret = true; this.caretMs = 0; this.updateName(); }
  }

  private onDown(x: number, y: number): void {
    if (this.busy || ConfirmDialog.active) return;
    if (this.stage === "A") return;
    this.onMove(x, y);
    if (this.hoverIcon) {
      const al = ICON_ALIGN[this.colKind()][this.hoverIcon - 1];
      if (this.draft.align !== al) { this.draft.align = al; this.game.audio.playSfx(ICON_SFX[al]); this.refreshB(); }
      return;
    }
    if (this.pmHover) {
      const c = this.cls(), { attr, sign } = this.pmHover;
      const done = sign < 0 ? dec(c, this.draft, attr) : inc(c, this.draft, attr);
      if (done) this.game.audio.playSfx("chrgen/+_-"); else this.game.audio.playSfx("error");
      this.refreshB();
      return;
    }
    switch (this.hoverB) {
      case 1: this.accept(); break;
      case 2: this.reset(); break;
      case 3: this.game.audio.playSfx("click_ok"); this.setStage("A"); break;
    }
  }

  // ================================================================== transições

  private leave(go: () => Promise<void>): void {
    this.busy = true;
    const t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / 300);
      if (!this.cover.destroyed) this.cover.alpha = k;
      if (k < 1) requestAnimationFrame(step); else void go();
    };
    step();
  }
}
