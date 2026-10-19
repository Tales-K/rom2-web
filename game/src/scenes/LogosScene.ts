import { Graphics } from "pixi.js";
import { Scene, SCREEN_H, SCREEN_W } from "../core/scene";
import { warm } from "../ui/prefetch";

/**
 * Logos de abertura: logos_publisher (Monolith) e logos_nival em sequência, como o original, depois a cena "intro".
 * Qualquer tecla ou clique pula TODOS os logos e a abertura e vai ao menu (como o original). Se um vídeo faltar ou falhar, segue adiante.
 */
export default class LogosScene extends Scene {
  private dead = false;
  private skipAll = false;
  private onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { this.skipAll = true; this.game.video.stop(); } };   // (o resto das teclas e o clique pulam pelo VideoPlayer, anyKey)

  override async enter(): Promise<void> {
    this.root.addChild(new Graphics().rect(0, 0, SCREEN_W, SCREEN_H).fill(0x000000));
    this.game.audio.attach(this.game.state);
    this.game.video.attach(this.game.state);
    this.game.audio.stopMusic(0);
    warm(this.game, ["menu"]);   // baixa o menu (e a criação de personagem) em segundo plano durante o vídeo
    window.addEventListener("keydown", this.onKey, true);
    // O SceneManager ainda está "trocando de cena" enquanto enter() roda; começa depois (go() seria ignorado).
    setTimeout(() => void this.run(), 0);
  }

  private async run(): Promise<void> {
    const seq = ["logos_publisher", "logos_nival"];   // ordem do original (refs/original, 19/10): Monolith (publisher, 24,5 s), Nival (11 s), depois a abertura
    for (let i = 0; i < seq.length; i++) {
      if (this.dead || this.skipAll) break;
      if (seq[i + 1]) this.game.video.preload(seq[i + 1]);
      const r = await this.game.video.play(seq[i], { skippable: true, anyKey: true });
      if (r === "skipped") this.skipAll = true;   // original (refs/original, 19/10): Esc, Espaço, Enter ou clique durante os logos vão DIRETO ao menu (pulam a abertura também)
    }
    if (!this.dead) void this.game.go(this.skipAll ? "menu" : "intro");
  }

  override exit(): void {
    this.dead = true;
    window.removeEventListener("keydown", this.onKey, true);
    this.game.video.stop();
  }
}
