import { Assets, Container, Rectangle, Sprite, Texture, Graphics } from "pixi.js";
import { frame, loadMenuKit, menuKitNow } from "./menukit";
import { justified } from "./tipwin";
import { bevelButton } from "./bevelbtn";

/**
 * Janela de mensagem do original: a MESMA da missão (falas do script, "Game paused...") e da cidade/taverna (conversas). Moldura dos
 * menus com o conjunto GRANDE de caveiras (lm.256 0..8, escala 1) de 480×224, retrato do falante em caixa 88×108 (fundo t_back +
 * figura + moldura t_border) à esquerda, texto justificado em font1 e botão "Ok" chanfrado embaixo.
 * Medido em refs/original/m20_dialog_1.png (missão 20, 19/10: janela em (268,268) do cliente 1024×768, cantos a ±0 px) e
 * inn_messenger_talk.png / town_click_gate_guard.png (a janela da cidade é a mesma, em (76,124) da arte 640×480 — antes usava o conjunto
 * pequeno de caveiras em 471×216, a "pendência" do GAPS [CAPTURAS-ORIGINAL]).
 */
export const MSG_W = 480, MSG_H = 224;
/** variante sem retrato ("Game paused. Click OK to continue."): 480×160 em (268,300), texto em (50,55), botão 96×26 centrado (m10_paused) */
export const PLAIN = { y: 300, h: 160, textX: 50, textY: 55, textW: 380, btnX: 197, btnY: 106, btnW: 96 };
/** posição da janela no cliente 1024×768 (a cidade desenha em 640×480 com deslocamento 192,144) */
export const MSG_X = 268, MSG_Y = 268;
const PORTRAIT = { x: 30, y: 56, w: 88, h: 108 };
const TEXT_X = 128, TEXT_Y = 35, TEXT_W = 300;
const BTN = { x: 200, y: 172, w: 80, h: 26 };
const TEXT_COLOR = 0xffffff;   // original: tons 255/222/189 do font1 (m20_dialog_1, inn_messenger_talk)

let artP: Promise<[Texture, Texture]> | undefined;
/** fundo (t_back) e moldura (t_border) dos retratos (tools/pipeline/talk_portraits.py) */
export function talkArt(): Promise<[Texture, Texture]> {
  return (artP ??= Promise.all([Assets.load<Texture>("assets/ui/talk/back.webp"), Assets.load<Texture>("assets/ui/talk/border.webp")]));
}

/** Retrato inteiro 160×240 (boneca/infowindow): na janela entra 1:1, recortado em (28,1) — medido por correlação com o HUD. */
export function isDollSized(p: Texture): boolean { return p.width >= 150 && p.height >= 200; }

export interface MessageOpts {
  onOk: () => void;
  /** rótulo do botão (padrão "Ok") */
  button?: string;
}

export class MessageWindow extends Container {
  private readonly fr = new Container();
  private readonly pic = new Container();
  private readonly body = new Container();
  private artDone = false;
  private text = "";
  private plain = false;
  private btn!: Container;
  /** deslocamento da janela atual em relação a (MSG_X, MSG_Y) (a variante sem retrato fica mais baixa e é mais baixa) */
  get dy(): number { return this.plain ? PLAIN.y - MSG_Y : 0; }

  constructor(private readonly opts: MessageOpts) {
    super();
    this.addChild(this.fr, this.pic, this.body);
    const build = () => { this.fr.removeChildren().forEach(c => c.destroy({ children: true })); this.fr.addChild(frame(menuKitNow() ?? { ok: false, lm: [], scr: [], radio: [] }, MSG_W, MSG_H, false, 1)); };
    build();
    if (!menuKitNow()?.ok) void loadMenuKit().then(k => { if (k.ok && !this.destroyed) build(); });
    this.btn = bevelButton(opts.button ?? "Ok", BTN.w, BTN.h, () => opts.onOk(), { font: "font1" });
    this.btn.position.set(BTN.x, BTN.y);
    this.addChild(this.btn);
  }

  /** Variante sem retrato (mensagem do sistema): moldura mais baixa, texto à esquerda, botão mais largo. Refaz o texto. */
  setPlain(on: boolean): void {
    if (on === this.plain) return;
    this.plain = on;
    this.fr.removeChildren().forEach(c => c.destroy({ children: true }));
    this.fr.addChild(frame(menuKitNow() ?? { ok: false, lm: [], scr: [], radio: [] }, MSG_W, on ? PLAIN.h : MSG_H, false, 1));
    this.position.y = this.homeY + this.dy;
    this.btn.destroy({ children: true });
    this.btn = bevelButton(this.opts.button ?? "Ok", on ? PLAIN.btnW : BTN.w, BTN.h, () => this.opts.onOk(), { font: "font1" });
    this.btn.position.set(on ? PLAIN.btnX : BTN.x, on ? PLAIN.btnY : BTN.y);
    this.addChild(this.btn);
    const t = this.text; this.text = ""; this.setText(t);
  }

  /** y do canto da janela na variante com retrato (definido por quem posiciona a janela) */
  homeY = 0;

  /** Texto justificado (font1) da fala. */
  setText(text: string): void {
    if (text === this.text) return;
    this.text = text;
    this.body.removeChildren().forEach(c => c.destroy({ children: true }));
    const t = this.plain ? justified(text, PLAIN.textW, TEXT_COLOR, 17, "font1", false, 11, 0, 9) : justified(text, TEXT_W, TEXT_COLOR, 17, "font1", false, 11, 10, 9);
    t.position.set(this.plain ? PLAIN.textX : TEXT_X, this.plain ? PLAIN.textY : TEXT_Y);
    this.body.addChild(t);
  }

  /** Retrato à esquerda. `framed` = textura 88×108 já com a moldura (recorte do original); `doll` = boneca/infowindow 160×240 ou sprite pequeno;
   *  Container = boneca da taverna (já posicionada em coordenadas de boneca). Sem argumento: só fundo e moldura. */
  setPortrait(p: { framed: Texture } | { doll: Texture } | { container: Container } | undefined): void {
    this.pic.removeChildren().forEach(c => c.destroy({ children: true }));
    if (!p) return;
    if ("framed" in p) {
      const s = new Sprite(p.framed); s.position.set(PORTRAIT.x, PORTRAIT.y); this.pic.addChild(s);
      return;
    }
    const back = new Container(), figure = new Container(), edge = new Container();
    const inner = new Rectangle(PORTRAIT.x + 8, PORTRAIT.y + 7, 72, 92);   // miolo da caixa (t_border 88×108 tem ~8 px de moldura)
    const clip = new Graphics().rect(inner.x, inner.y, inner.width, inner.height).fill(0xffffff);
    figure.mask = clip;
    if ("container" in p) {
      figure.position.set(PORTRAIT.x - 2, PORTRAIT.y + 3);   // origem da boneca da taverna (medida na janela antiga: 23,55 de (273,272))
      figure.addChild(p.container);
      this.pic.addChild(back, clip, figure, edge);
    } else {
      const t = p.doll;
      if (isDollSized(t)) {
        // 1:1, recorte (28,1) do retrato 160×240 dentro da caixa 88×108
        const s = new Sprite(new Texture({ source: t.source, frame: new Rectangle(t.frame.x + 28, t.frame.y + 1, 88, 108) }));
        s.position.set(PORTRAIT.x, PORTRAIT.y);
        figure.addChild(s);
      } else {
        const s = new Sprite(t);
        const k = Math.min(2, 72 / t.width, 92 / t.height);
        s.scale.set(k);
        s.position.set(inner.x + (inner.width - t.width * k) / 2, inner.y + (inner.height - t.height * k) / 2);
        figure.addChild(s);
      }
      this.pic.addChild(back, clip, figure, edge);
    }
    void talkArt().then(([bk, bd]) => {
      if (this.destroyed || this.artDone && !this.pic.children.includes(back)) return;
      if (back.destroyed) return;
      const b = new Sprite(new Texture({ source: bk.source, frame: new Rectangle(0, 0, 72, 92) })); b.position.set(inner.x, inner.y); back.addChild(b);
      const e = new Sprite(bd); e.position.set(PORTRAIT.x, PORTRAIT.y); edge.addChild(e);
    });
  }
}
