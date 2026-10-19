import { Graphics } from "pixi.js";
import { Scene, SCREEN_H, SCREEN_W } from "../core/scene";
import { warm } from "../ui/prefetch";

/** Vídeo de abertura (intro). Clique/Esc/Espaço/Enter pula. Termine ou pule, vai para o menu; se o vídeo falhar, também. */
export default class IntroScene extends Scene {
  private dead = false;

  override async enter(): Promise<void> {
    this.root.addChild(new Graphics().rect(0, 0, SCREEN_W, SCREEN_H).fill(0x000000));
    this.game.audio.attach(this.game.state);
    this.game.video.attach(this.game.state);
    this.game.audio.stopMusic(0);
    warm(this.game, ["menu", "chargen"]);   // baixa o menu (e a criação de personagem) em segundo plano durante o vídeo
    setTimeout(() => void this.run(), 0);   // go() só funciona depois que enter() retorna
  }

  private async run(): Promise<void> {
    await this.game.video.play("intro", { skippable: true, anyKey: true });
    if (!this.dead) void this.game.go("menu");
  }

  override exit(): void {
    this.dead = true;
    this.game.video.stop();
  }
}
