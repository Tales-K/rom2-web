import { Container, Graphics } from "pixi.js";
import { makeText, type PixelFont } from "./text";

/**
 * Botão "chanfrado" das janelas do original (CLOSE das dicas, "Ok" das conversas): miolo = fundo da janela (transparente), filete claro
 * (0x294539) em cima e à esquerda e 2 px escuros (0x000c08) embaixo e à direita; rótulo dourado centrado. Medido em
 * refs/original/shop_tip.png (CLOSE 80×18, font2) e inn_messenger_talk.png ("Ok" 79×24, font4 negrito). Sob o mouse só o rótulo
 * escurece para laranja 0x945900 e, apertado, o relevo inverte (filete claro embaixo/à direita) — medido em m20_dialog_hover_ok e
 * m20_dialog_press_ok (missão 20, 19/10).
 * ÚNICO componente: ui/tipwin.ts, ui/talkwin.ts e as cenas da cidade/taverna usam esta função.
 */
export interface BevelOpts { font?: PixelFont; bold?: boolean; color?: number }

const HOVER_COLOR = 0x945900;

export function bevelButton(label: string, w: number, h: number, onTap: () => void, o: BevelOpts = {}): Container {
  const c = new Container();
  const bg = new Graphics();
  const base = o.color ?? 0xbd9e4a;
  const t = makeText(label, { font: o.font ?? "font2", bold: o.bold, color: base, shadow: true });
  const draw = (hov: boolean, down: boolean) => {
    const lt = down ? 0x000c08 : 0x294539, dk = down ? 0x294539 : 0x000c08;
    bg.clear().rect(0, 0, w, h).fill({ color: 0x000000, alpha: 0.001 })
      .rect(1, 0, w - 1, 1).fill(lt).rect(0, 1, 1, h - 3).fill(lt)
      .rect(w - 2, 1, 2, h - 2).fill(dk).rect(2, h - 2, w - 2, 2).fill(dk);
    (t.style as { fill: number }).fill = hov || down ? HOVER_COLOR : base;
  };
  t.anchor.set(0.5); t.position.set(Math.round(w / 2) - 1, Math.round(h / 2) - 1);
  t.eventMode = "none";
  draw(false, false);
  c.addChild(bg, t);
  c.eventMode = "static"; c.cursor = "pointer";
  let over = false;
  c.on("pointerover", () => { over = true; draw(true, false); })
    .on("pointerout", () => { over = false; draw(false, false); })
    .on("pointerdown", () => draw(true, true))
    .on("pointerup", () => draw(over, false))
    .on("pointerupoutside", () => draw(false, false))
    .on("pointertap", onTap);
  return c;
}
