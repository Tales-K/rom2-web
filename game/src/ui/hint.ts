import { Container, Graphics, Ticker } from "pixi.js";
import { makeText } from "./text";
import { ART_H, frameRect } from "./frame640";
import { SCREEN_W } from "../core/scene";

/**
 * Etiqueta pequena junto do cursor das telas 640×480 (cidade, loja): caixa de moldura dourada com fundo verde-escuro e texto
 * em font2 maiúsculo (medida em refs/original/town_hover_*.png). Várias linhas empilham na mesma caixa.
 * Uso: `const h = new Hint(frame); h.show(["Shop"], x, y); h.hide();` (coordenadas 640×480).
 */
/** passo entre linhas da etiqueta (load_game_hover_delete: caixa de 2 linhas = 30 px, 16 + 14) */
const PITCH = 14;
/** Atraso da etiqueta do original: some assim que o mouse se mexe e reaparece ~0,5 s depois de parar (medido em sequências de 40 ms:
 *  town_hover_inn, 12 quadros; o realce da região acende no quadro 0, sem atraso). */
export const HINT_DELAY_MS = 500;

export class Hint extends Container {
  private readonly box = new Graphics();
  private readonly lines: ReturnType<typeof makeText>[] = [];
  private key = "";
  private want = false;     // há texto para mostrar (aparece depois do atraso)
  private idle = 0;         // ms desde o último movimento do ponto de ancoragem
  private ax = NaN;
  private ay = NaN;
  private readonly tick = (t: Ticker): void => {
    if (!this.want || this.visible) return;
    this.idle += t.deltaMS;
    if (this.idle >= HINT_DELAY_MS) this.visible = true;
  };

  constructor(parent: Container) {
    super();
    this.eventMode = "none";
    this.visible = false;
    this.addChild(this.box);
    parent.addChild(this);
    Ticker.shared.add(this.tick);
  }

  override destroy(options?: Parameters<Container["destroy"]>[0]): void {
    Ticker.shared.remove(this.tick);
    super.destroy(options);
  }

  /** Monta caixa e linhas para `list` (refaz só quando o texto muda) e devolve true se mudou. */
  private build(list: string[]): boolean {
    const key = list.join("\n");
    if (key === this.key) return false;
    this.key = key;
    for (const t of this.lines.splice(0)) t.destroy();
    let w = 0;
    list.forEach((s, i) => {
      const t = makeText(s.toUpperCase(), { font: "font2", color: 0xae7f33, shadow: true });
      t.position.set(4, 2 + i * PITCH);
      this.addChild(t); this.lines.push(t);
      w = Math.max(w, s ? Math.ceil(t.width) : 0);
    });
    const bw = w + 12, bh = 16 + PITCH * (list.length - 1);   // 1 linha = 16 px (town_hover_shop e load_game_hover_ok)
    // medido em refs/original/load_game_hover_ok.png e town_hover_shop.png: filete a57931 de 1 px, linha 523c18 logo abaixo do filete de cima e fora do de baixo, miolo 212c21
    this.box.clear().rect(0, 0, bw, bh).fill(0xa57931).rect(1, 1, bw - 2, bh - 2).fill(0x212c21).rect(1, 1, bw - 2, 1).fill(0x523c18).rect(1, bh, bw - 1, 1).fill(0x523c18);
    return true;
  }

  /** `blank` = mantém as linhas vazias (dicas de vários parágrafos, ex.: ícones da criação: título, linha em branco, texto). */
  show(text: string | string[], x: number, y: number, blank = false): void {
    const list = (Array.isArray(text) ? text : [text]).filter(s => blank ? s !== undefined : Boolean(s));
    if (!list.length) { this.hide(); return; }
    const key = list.join("\n");
    const mx = Math.round(x), my = Math.round(y);
    if (mx !== this.ax || my !== this.ay || key !== this.key) { this.ax = mx; this.ay = my; this.idle = 0; this.visible = false; }
    this.want = true;
    this.build(list);
    const w = this.box.width || 30, h = this.box.height || 18;
    const fx = frameRect().x;   // o original NÃO recolhe a etiqueta para dentro dos 640×480: ela passa para a borda preta (town_hover_trainer, chargen_b_*_hover_fire); só a tela toda limita
    this.position.set(Math.max(-fx, Math.min(SCREEN_W - fx - w, Math.round(x) - 1)), Math.max(0, Math.min(ART_H - h, Math.round(y) - 18 - PITCH * (this.lines.length - 1))));   // várias linhas crescem para cima
  }

  /**
   * Versão em coordenadas de TELA (1024×768) para a missão: caixa com a ponta esquerda 1 px à direita do cursor e a base 3 px acima
   * dele, crescendo para cima; encosta na borda direita quando não cabe (medido em m10_hover_cmd_*, m10_hover_portrait, m10_hover_stats).
   */
  showScreen(text: string | string[], x: number, y: number): void {
    const list = (Array.isArray(text) ? text : [text]).filter(Boolean);
    if (!list.length) { this.hide(); return; }
    const key = list.join("\n");
    const mx = Math.round(x), my = Math.round(y);
    if (mx !== this.ax || my !== this.ay || key !== this.key) { this.ax = mx; this.ay = my; this.idle = 0; this.visible = false; }
    this.want = true;
    this.build(list);
    const w = this.box.width || 30, h = this.box.height || 18;
    this.position.set(Math.max(0, Math.min(SCREEN_W - 1 - w, mx + 1)), Math.max(0, Math.min(768 - h, my - 18 - PITCH * (list.length - 1))));
  }

  hide(): void { this.visible = false; this.want = false; this.key = ""; this.idle = 0; this.ax = this.ay = NaN; }
}
