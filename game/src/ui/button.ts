import { Container, Graphics } from "pixi.js";
import { makeText } from "./text";

/** Botão simples de texto (placeholder; as cenas finais usam os bitmaps originais). */
export function textButton(label: string, w: number, h: number, onClick: () => void): Container {
  const c = new Container();
  const bg = new Graphics();
  const draw = (hover: boolean) => { bg.clear().roundRect(0, 0, w, h, 6).fill(hover ? 0x5a4a2a : 0x3a2f1c).stroke({ color: 0xd8a24a, width: 2 }); };
  draw(false);
  const t = makeText(label, { size: 18, color: 0xf5e9c8 });
  t.anchor.set(0.5); t.position.set(w / 2, h / 2);
  c.addChild(bg, t);
  c.eventMode = "static"; c.cursor = "pointer";
  c.on("pointerover", () => draw(true)).on("pointerout", () => draw(false)).on("pointertap", onClick);
  return c;
}
