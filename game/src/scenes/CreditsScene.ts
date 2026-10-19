import { Container, Graphics, Sprite } from "pixi.js";
import { Scene } from "../core/scene";
import { frame640, ART_H, ART_W, type Frame640 } from "../ui/frame640";
import { makeText } from "../ui/text";
import { addToFameHall, hallStatsOf, hallXp, readFameHall } from "../campaign/runtime";

interface CreditsFile { kind: "lines"; lines: string[]; }

const FALLBACK = ["ALLODS 2", "Rage of Mages II", "", "Rework web", "", "Os créditos originais não foram encontrados."];
const LOGO_RE = /^"?([a-z0-9_]+)\.bmp"?$/i;           // linhas como "nival.bmp" = logo no meio dos créditos
/** original (scratch/cap2/d_menu/credits_*, 19/10): rola a 43 px/s, todas as linhas em font1 branco-gelo (232,230,232) com passo de 15 px (linha vazia = 15 px), sem esmaecer nas bordas */
const SPEED = 43, PITCH = 15, TEXT = 0xe8e6e8;

const VH = ART_H, VW = ART_W;                           // os créditos rolam dentro do quadro 640×480 do original (ui/frame640.ts)

/** Créditos: rolagem do texto de data/texts/credits.json com a música "credit". Esc volta ao menu; clique/Espaço acelera. */
export default class CreditsScene extends Scene {
  private items: { node: Container; y: number; h: number }[] = [];
  private scroll = 0;            // deslocamento (px) do conteúdo para cima
  private speed = SPEED;
  private total = 0;
  private fast = false;
  private leaving = false;
  private endTimer = 0;
  private view!: Frame640;

  private onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); this.leave(); }
    else if (e.key === " " || e.key === "Enter") { this.fast = e.type === "keydown"; }
  };
  private onKeyUp = (e: KeyboardEvent) => { if (e.key === " " || e.key === "Enter") this.fast = false; };
  private onDown = () => { this.fast = true; };
  private onUp = () => { this.fast = false; };

  override async enter(params?: unknown): Promise<void> {
    this.view = frame640(this.root);
    this.view.on("pointerdown", this.onDown); this.view.on("pointerup", this.onUp); this.view.on("pointerupoutside", this.onUp);
    if ((params as { ending?: boolean } | undefined)?.ending) await this.fameHall();

    this.game.audio.attach(this.game.state);
    this.game.audio.playMusic("credit", { loop: false, fadeMs: 800 });

    let lines = FALLBACK;
    const f = await this.game.data.tryJson<CreditsFile>("data/texts/credits.json");
    if (f && Array.isArray(f.lines)) lines = f.lines;
    await this.build(lines);

    window.addEventListener("keydown", this.onKey, true);
    window.addEventListener("keyup", this.onKeyUp, true);
  }

  /**
   * Fim da campanha (estágio 120): registra o herói no hall da fama (famehall.dat do original: 10 × nome + pontos; pontuação
   * estimada, ver campaign/runtime.ts) e mostra a lista até um clique/tecla; depois rolam os créditos e volta ao menu.
   */
  private async fameHall(): Promise<void> {
    const st = this.game.state;
    const camp = st.progress.campaign;
    const first = !!camp && !camp.ended;
    let rank = -1;
    let list = readFameHall();
    if (first && st.hero) {
      ({ list, rank } = addToFameHall(st.hero.name, hallXp(st.hero), hallStatsOf(camp)));
      camp!.ended = true;
      st.save();
    }
    const view = this.view;
    const c = new Container();
    c.addChild(new Graphics().rect(0, 0, VW, VH).fill(0x000000));
    const title = makeText("Hall of Fame", { font: "font4", bold: true, color: 0xc8a860, scale: 2 });
    title.anchor.set(0.5, 0); title.position.set(VW / 2, 70);
    c.addChild(title);
    list.forEach((e, i) => {
      const hi = i === rank;
      const t = makeText(`${i + 1}.  ${e.name}`, { font: "font4", bold: hi, color: hi ? 0xffe680 : 0xd8cba8 });
      t.position.set(VW / 2 - 140, 120 + i * 24);
      const s = makeText(String(e.score), { font: "font4", color: hi ? 0xffe680 : 0xd8cba8 });
      s.anchor.set(1, 0); s.position.set(VW / 2 + 140, 120 + i * 24);
      c.addChild(t, s);
    });
    view.addChild(c);
    this.game.audio.playMusic("credit", { loop: false, fadeMs: 800 });
    await new Promise<void>(resolve => {
      const done = () => { window.removeEventListener("keydown", done, true); c.off("pointertap", done); resolve(); };
      c.eventMode = "static";
      c.on("pointertap", done);
      window.addEventListener("keydown", done, true);
    });
    c.destroy({ children: true });
  }

  private async build(lines: string[]): Promise<void> {
    const content = new Container();
    this.view.addChild(content);
    const clip = new Graphics().rect(0, 0, VW, VH).fill(0xffffff);
    this.view.addChild(clip);
    content.mask = clip;
    let y = VH;                                       // começa logo abaixo da tela
    let heading = true;                                     // a primeira linha após um vazio é título de seção
    for (const raw of lines) {
      const line = raw.trimEnd();
      const logo = line.match(LOGO_RE);
      if (line.trim() === "") { y += PITCH; heading = true; continue; }
      let node: Container; let h: number;
      if (logo) {
        h = 90;
        node = new Container();
        try {
          const tex = await this.game.data.texture(`assets/video/logo/${logo[1].toLowerCase()}.png`);
          const s = new Sprite(tex); s.anchor.set(0.5, 0); s.x = VW / 2; s.y = 0; node.addChild(s);
          if (tex.width > VW - 40) s.scale.set((VW - 40) / tex.width);
          h = tex.height * s.scale.y + 16;
        } catch { /* sem o logo: só espaço */ }
        heading = true;
      } else {
        const t = makeText(line, { font: "font1", color: TEXT, align: "center" });
        t.anchor.set(0.5, 0); t.x = VW / 2; node = t; h = PITCH; heading = false;
      }
      node.y = y; content.addChild(node);
      this.items.push({ node, y, h });
      y += h;
    }
    this.total = y - VH;                              // altura do conteúdo
  }

  override update(dtMs: number): void {
    if (this.leaving) return;
    this.scroll += this.speed * (this.fast ? 5 : 1) * dtMs / 1000;
    for (const it of this.items) {
      const sy = it.y - this.scroll;                        // posição na tela
      const vis = sy + it.h > 0 && sy < VH;
      it.node.visible = vis;
      if (!vis) continue;
      it.node.y = sy;
      it.node.alpha = 1;
    }
    if (this.scroll >= this.total + VH * 0.15 && !this.endTimer) {
      this.endTimer = window.setTimeout(() => this.leave(), 2500);   // fim dos créditos: volta ao menu
    }
  }

  private leave(): void {
    if (this.leaving) return;
    this.leaving = true;
    void this.game.go("menu");
  }

  override exit(): void {
    window.removeEventListener("keydown", this.onKey, true);
    window.removeEventListener("keyup", this.onKeyUp, true);
    clearTimeout(this.endTimer);
    this.game.audio.stopMusic(600);
  }
}
