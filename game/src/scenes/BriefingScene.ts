import { Container, Graphics, Rectangle, Texture } from "pixi.js";
import { Scene } from "../core/scene";
import { makeText } from "../ui/text";
import { FIRST_MISSION } from "../flow";
import { Nav, Texts, ensureHero, loadTex, loadTexOr, onKey, safeEnter, spr } from "../town/common";
import { frame640 } from "../ui/frame640";
import { openGameMenuIn } from "../ui/gamemenu";
import type { Game } from "../core/game";
import { warm, warmTextures } from "../ui/prefetch";
import { campaignCtx, missionText } from "../campaign/runtime";
import { enterLocation } from "../campaign/engine";
import { syncLegacy } from "../campaign/progress";

export interface BriefingParams { mission: number; from?: "town" | "globalmap" | "inn" }

/** Imagem de janela de informação (graphics/infowindow) usada como "retrato do local" de cada missão. */
const INFO_IMAGE: Record<number, string> = {
  10: "tower_m", 20: "horse", 21: "tent", 30: "house02", 31: "mine", 32: "horse", 40: "tower_s", 41: "tower1", 42: "dragon", 43: "necro",
  50: "kaargtow1", 51: "castle", 60: "house03", 61: "orc", 70: "squirrel", 71: "squirrel", 80: "necrotower", 81: "necro", 90: "kaargshop", 91: "orcshaman",
  100: "castle", 101: "druid", 102: "zombie_f1", 103: "pyramid1", 110: "mainnecro",
};

/**
 * Briefing de uma missão: pergaminho (docs/sheet.bmp) com título, texto e o selo "Ok" que inicia a missão.
 * Observação: o original NÃO passa por esta tela no fluxo da campanha (mapa-múndi → missão direto; refs/original e
 * notes/original-capture.md); ela fica só para o atalho `#cena=briefing` e depuração.
 */
export default class BriefingScene extends Scene {
  private removeKey?: () => void;
  private modal?: Container;
  private nav = new Nav(this.game);

  override async enter(params?: unknown): Promise<void> {
    await safeEnter(this.game, this.root, "briefing", () => this.build(params), "town");
    warm(this.game, ["mission"]);   // baixa o módulo da missão (e o que ela exportar em `prefetch`) enquanto o jogador lê
  }

  private async build(params?: unknown): Promise<void> {
    const game = this.game;
    ensureHero(game);
    const p = (params ?? {}) as Partial<BriefingParams> & { id?: number };
    const mission = p.mission ?? p.id ?? FIRST_MISSION;
    const back = p.from === "globalmap" ? "globalmap" : "town";
    const imgName = INFO_IMAGE[mission] ?? "castle";
    const [texts, sheetTex, pic] = await Promise.all([
      Texts.load(game), loadTexOr(game, "assets/ui/briefing/sheet.webp"),
      loadTex(game, `assets/ui/briefing/info/${imgName}.webp`).catch((): Texture | undefined => undefined),
    ]);
    // textos da campanha: #title/#briefing do globalmap.txt (10 e 20: o #briefing de mission<id>.txt)
    const ctx = await campaignCtx(game).catch(() => undefined);
    const info = ctx ? missionText(ctx.data, mission) : await texts.mission(game, mission);

    // tela 640×480 do original em tamanho natural, centralizada (ui/frame640.ts); só o pergaminho (sheet.bmp), sem molduras nossas
    const view = frame640(this.root);
    view.addChild(spr(sheetTex));

    // imagem do local (janela de informação do jogo, recortada na área à esquerda do pergaminho)
    if (pic) {
      const frame = new Graphics().roundRect(65, 80, 138, 198, 5).fill({ color: 0x1a120a, alpha: 0.9 }).stroke({ color: 0x6a4a22, width: 2 });
      const s = spr(pic, 70, 83);
      s.width = 128; s.height = 192;
      view.addChild(frame, s);
    }

    const title = makeText(info?.title ?? `Mission ${mission}`, { font: "font4", bold: true, color: 0x3a1f0a, shadow: false, wrap: 350 });
    title.position.set(225, 60);
    const body = makeText(info?.text || "", { font: "font4", color: 0x2a1a0c, shadow: false, wrap: 350 });
    body.position.set(225, title.y + title.height + 14);
    view.addChild(title, body);

    if (mission === FIRST_MISSION) {
      // planta da torre de Rakhl-Uimoir (docs/1.bmp), como ilustração
      const plan = spr(await loadTexOr(game, "assets/ui/briefing/plan.webp"), 350, 250);
      plan.scale.set(0.39);
      plan.alpha = 0.85;
      view.addChild(plan);
    }

    // selo "Ok" do pergaminho = iniciar missão
    const start = new Container();
    start.hitArea = new Rectangle(542, 392, 62, 60);
    start.eventMode = "static"; start.cursor = "pointer";
    const glow = new Graphics().circle(574, 422, 31).fill({ color: 0xffe6a0, alpha: 0.28 });
    glow.visible = false;
    start.addChild(glow);
    start.on("pointerover", () => { glow.visible = true; }).on("pointerout", () => { glow.visible = false; });
    start.on("pointertap", () => this.start(mission));
    const startLbl = makeText(texts.label(237, "Start Mission"), { font: "font4", bold: true, color: 0x3a1f0a, shadow: false });
    startLbl.anchor.set(1, 0.5);
    startLbl.position.set(537, 422);
    view.addChild(start, startLbl);

    // "Back": botão de texto simples (nosso; o original não tem esta tela), no canto inferior esquerdo
    const backBtn = new Container();
    const bbg = new Graphics();
    const bdraw = (h: boolean) => bbg.clear().rect(0, 0, 106, 26).fill(h ? 0x5a4a2a : 0x3a2f1c).stroke({ color: 0xd8a24a, width: 1 });
    bdraw(false);
    const bt = makeText(texts.label(260, "Back"), { font: "font4", bold: true, color: 0xf5e9c8, shadow: false });
    bt.anchor.set(0.5); bt.position.set(53, 13);
    backBtn.addChild(bbg, bt);
    backBtn.position.set(79, 410);
    backBtn.eventMode = "static"; backBtn.cursor = "pointer";
    backBtn.on("pointerover", () => bdraw(true)).on("pointerout", () => bdraw(false)).on("pointertap", () => { this.nav.go(back); });
    view.addChild(backBtn);

    this.removeKey = onKey(e => {
      if (e.key === "Escape") {
        if (this.modal) { this.modal.destroy({ children: true }); this.modal = undefined; }
        else this.modal = openGameMenuIn(game, this.root, () => { this.modal = undefined; });
      } else if (e.key === "Enter" && !this.modal) this.start(mission);
    });
  }

  /** Entra na missão (ScenarioEnterLocation: zera os subobjetivos) — a campanha não usa mais flags `accepted_<id>`. */
  private start(mission: number): void {
    if (this.modal) return;
    void campaignCtx(this.game).then(ctx => {
      enterLocation(ctx.st, ["M", mission]);
      syncLegacy(this.game.state.progress, ctx.data);
      this.game.state.save();
      this.nav.go("mission", { id: mission });
    });
  }

  override exit(): void { this.removeKey?.(); }
}

/** Pré-carrega o briefing da missão inicial em segundo plano. */
export async function prefetch(game: Game): Promise<void> {
  await Promise.all(["data/texts/town.json", "data/texts/globalmap.json", "data/texts/main.json", `data/texts/mission${FIRST_MISSION}.json`].map(p => game.data.tryJson(p)));
  await warmTextures(game, ["assets/ui/briefing/sheet.webp", `assets/ui/briefing/info/${INFO_IMAGE[FIRST_MISSION]}.webp`, "assets/ui/briefing/plan.webp"]);
}
