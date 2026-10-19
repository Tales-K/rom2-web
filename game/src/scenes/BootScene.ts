import { Graphics } from "pixi.js";
import { Scene, SCREEN_H, SCREEN_W } from "../core/scene";
import { makeText } from "../ui/text";

/** Tela inicial: o navegador exige um clique para liberar áudio/vídeo; depois vai para "logos". */
export default class BootScene extends Scene {
  override async enter(): Promise<void> {
    const bg = new Graphics().rect(0, 0, SCREEN_W, SCREEN_H).fill(0x000000);
    const t = makeText("Allods 2 - web rework\n\nClick to start", { size: 28, align: "center", color: 0xd8a24a });
    t.anchor.set(0.5); t.position.set(SCREEN_W / 2, SCREEN_H / 2);
    bg.eventMode = "static"; bg.cursor = "pointer";
    bg.on("pointertap", () => { this.game.audio.unlock(); void this.game.go("logos"); });
    this.root.addChild(bg, t);
    // atalho de desenvolvimento: #cena=<nome> (ex.: http://127.0.0.1:5173/#cena=mission) pula direto para uma cena
    const m = location.hash.match(/cena=([a-z]+)/);
    if (m) { this.game.audio.unlock(); this.game.state.load(); void this.game.go(m[1], location.hash.includes("mission=") ? { id: Number(location.hash.match(/mission=(\d+)/)?.[1]) } : undefined); }
  }
}
