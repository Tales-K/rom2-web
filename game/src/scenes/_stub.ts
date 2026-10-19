import { Graphics } from "pixi.js";
import { NEXT, type SceneName } from "../flow";
import { Scene, SCREEN_H, SCREEN_W } from "../core/scene";
import type { Game } from "../core/game";
import { textButton } from "../ui/button";
import { makeText } from "../ui/text";

/** Cena provisória: mostra o nome, o dono da implementação e um botão para a próxima cena do fluxo. Substitua pelo conteúdo real. */
export function makeStub(name: SceneName, owner: string, note: string) {
  return class StubScene extends Scene {
    constructor(game: Game) { super(game); }
    override async enter(params?: unknown): Promise<void> {
      const bg = new Graphics().rect(0, 0, SCREEN_W, SCREEN_H).fill(0x14110d);
      const title = makeText(`${name}  [stub]`, { size: 36, color: 0xd8a24a }); title.position.set(40, 40);
      const who = makeText(`Responsável: ${owner}\n${note}`, { size: 18, wrap: SCREEN_W - 80 }); who.position.set(40, 100);
      const p = makeText(`params: ${JSON.stringify(params ?? null)}`, { size: 14, color: 0x9a8c6e }); p.position.set(40, 200);
      const btn = textButton(`Ir para "${NEXT[name]}"`, 260, 48, () => { void this.game.go(NEXT[name], params); });
      btn.position.set(40, 260);
      this.root.addChild(bg, title, who, p, btn);
    }
  };
}
