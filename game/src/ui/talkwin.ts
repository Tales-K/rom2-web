import { Container, Graphics, Texture } from "pixi.js";
import { pushKeyLayer } from "./modal";
import { MSG_X, MSG_Y, MessageWindow } from "./msgwin";

/**
 * Janela de conversa do original (taverna: "I was the one who brought to town..."; moradores da cidade): a janela de mensagem comum
 * (ui/msgwin.ts, a mesma da missão) em (76,124) dos 640×480. Modal (teclado: Enter/Esc/Espaço = Ok).
 */
export interface TalkWindow { root: Container; close(): void; readonly closed: boolean }

export function showTalk(parent: Container, opts: {
  text: string; portrait?: Texture | Container; button?: string; onOk?: () => void;
  /** retrato 88×108 já com a moldura t_border (recortado do original: tools/pipeline/talk_portraits.py); dispensa a nossa caixa/aro */
  framedPortrait?: Texture;
}): TalkWindow {
  const root = new Container();
  const shield = new Graphics().rect(-2000, -2000, 5000, 5000).fill({ color: 0x000000, alpha: 0.001 });
  shield.eventMode = "static";
  root.addChild(shield);
  const win = new MessageWindow({ button: opts.button, onOk: () => ok() });
  win.position.set(MSG_X - 192, MSG_Y - 144);
  root.addChild(win);
  if (opts.framedPortrait) win.setPortrait({ framed: opts.framedPortrait });
  else if (opts.portrait) win.setPortrait(opts.portrait instanceof Container ? { container: opts.portrait } : { doll: opts.portrait });
  win.setText(opts.text);

  let closed = false;
  const pop = pushKeyLayer(e => { if (e.key === "Escape" || e.key === "Enter" || e.key === " ") ok(); });
  function ok(): void { if (closed) return; close(); opts.onOk?.(); }
  function close(): void {
    if (closed) return;
    closed = true;
    pop();
    if (!root.destroyed) root.destroy({ children: true });
  }
  root.on("destroyed", () => { if (!closed) { closed = true; pop(); } });
  parent.addChild(root);
  return { root, close, get closed() { return closed; } };
}
