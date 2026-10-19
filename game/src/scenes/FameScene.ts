import { Container, Rectangle, Text } from "pixi.js";
import { Scene } from "../core/scene";
import { frame640 } from "../ui/frame640";
import { applyThemeCursor } from "../ui/cursor";
import { loadTexOr, onKey, spr } from "../town/common";
import { readFameHall } from "../campaign/runtime";

/**
 * Hall da Fama do menu principal (refs/original/hall_of_fame.png, 19/10): pergaminho 640×480 (main/graphics/famehall/hall.bmp, com o título, os
 * ornamentos e o selo "Ok") e a lista de 10 linhas em serifa negrito marrom: posição "n." em x=145, nome em x=175, pontos à direita em x=484,
 * passo de 24 px a partir de y=145. Esc NÃO fecha no original; só o selo "Ok" (canto inferior direito) volta ao menu.
 */
const ROW = { y: 143, pitch: 24, rank: 145, name: 175, score: 484 };
const SEAL = new Rectangle(540, 415, 70, 62);

export default class FameScene extends Scene {
  private restoreCursor?: () => void;
  private removeKey?: () => void;

  override async enter(): Promise<void> {
    const view = frame640(this.root);
    view.addChild(spr(await loadTexOr(this.game, "assets/ui/menu/hall.webp")));
    const list = readFameHall();
    const base = { fontFamily: "Times New Roman, Times, serif", fontWeight: "bold" as const, fontSize: 16, dropShadow: { color: 0x000000, alpha: 0.45, distance: 1, angle: Math.PI / 4, blur: 0 } };
    const style = { ...base, fill: 0x24160c };
    const scoreStyle = { ...base, fill: 0x3a1a3c };   // pontos em roxo escuro (medido)
    const lay = new Container();
    list.slice(0, 10).forEach((e, i) => {
      const y = ROW.y + i * ROW.pitch;
      const r = new Text({ text: `${i + 1}.`, style }); r.position.set(ROW.rank, y);
      const n = new Text({ text: e.name, style }); n.position.set(ROW.name, y);
      const s = new Text({ text: e.score.toLocaleString("en-US"), style: scoreStyle }); s.anchor.set(1, 0); s.position.set(ROW.score, y);
      lay.addChild(r, n, s);
    });
    view.addChild(lay);
    const hit = new Container();
    hit.hitArea = SEAL; hit.eventMode = "static"; hit.cursor = "pointer";
    hit.on("pointertap", () => this.back());
    view.addChild(hit);
    this.restoreCursor = applyThemeCursor(this.game.app, "default");
    this.removeKey = onKey(e => { if (e.key === "Enter") this.back(); });
  }

  private back(): void { this.game.audio.playSfx("click_ok"); void this.game.go("menu"); }

  override exit(): void { this.removeKey?.(); this.restoreCursor?.(); }
}
