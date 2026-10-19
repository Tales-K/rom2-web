import { Container, Sprite } from "pixi.js";
import type { MenuKit } from "./menukit";
import { CLASSIC } from "./menukit";
import { makeText } from "./text";

/**
 * Botão de opção (esfera roxa num aro dourado) das janelas do original (Game Options; radiob.256 quadros 0 = apagado, 1 = escolhido, 24×24)
 * com o rótulo em font1 a 28 px do canto esquerdo da esfera. Componente ÚNICO para os três grupos (Formation, Retreat, AutoCast mode).
 */
export interface ClassicRadio extends Container { set(on: boolean): void }

export function classicRadio(kit: MenuKit, text: string, on: boolean, onPick: () => void): ClassicRadio {
  const c = new Container() as ClassicRadio;
  const s = kit.ok ? new Sprite(kit.radio[on ? 1 : 0]) : null;
  const t = makeText(text, { font: "font1", color: CLASSIC.text });
  t.position.set(28, 3);
  if (s) c.addChild(s);
  c.addChild(t);
  c.set = v => { if (s) s.texture = kit.radio[v ? 1 : 0]!; };
  c.eventMode = "static"; c.cursor = "pointer";
  c.on("pointertap", () => onPick());
  c.on("pointerover", () => { t.tint = CLASSIC.focus; });
  c.on("pointerout", () => { t.tint = CLASSIC.text; });
  return c;
}
