import { Container, Rectangle, Sprite, Texture } from "pixi.js";
import { Scene } from "../core/scene";
import { makeText } from "../ui/text";
import { loadStrip, loadTexOr, maskReader, onKey, safeEnter, spr, Nav, type StripInfo } from "../town/common";
import type { Game } from "../core/game";
import { warmTextures } from "../ui/prefetch";
import { frame640, type Frame640 } from "../ui/frame640";
import { openGameMenuIn } from "../ui/gamemenu";
import { campaignCtx, missionText, townDef, type CampaignCtx } from "../campaign/runtime";
import { enterLocation, globalMapNodes } from "../campaign/engine";
import { syncLegacy } from "../campaign/progress";
import type { MapNode } from "../campaign/types";
import type { MissionParams } from "../core/state";
import { PathNet } from "../ui/mappath";
import { applyThemeCursor, cursorCss } from "../ui/cursor";
import { centeredWords } from "../ui/tipwin";

const D = "assets/ui/globalmap/";
type Pt = { x: number; y: number };

/** Bolinhas da trilha: uma a cada 8 pixels visitados (ui/mappath.ts) e, na viagem, uma nova a cada ~103 ms (refs/original/globalmap_seq_*: 22 bolinhas novas em 2,16 s). */
const DOT_MS = 103;
const BALL_OFF = 5;
const TITLE_GAP = 11;
/** o X vermelho do destino em Uimoir desenha-se em 13 quadros (cross.16a), ~13 quadros/s (completo em ~1 s no original) */
const CROSS_FPS = 13;

/**
 * Mapa-múndi (arte 640×480 centralizada): Uimoir (umoir.bmp) só na saída de Plagat — a trilha de bolinhas vermelhas vai sozinha de Plagat
 * (bandeira xadrez) até a missão 10, marcada por um X que se desenha (~2,5 s, sem clique) e a missão começa sem briefing
 * [exe 0x487dc4/0x470743; refs/original/globalmap_seq_*]; nos demais casos Yases (gmap.bmp) com os locais disponíveis do Scenario.dll
 * (campaign/engine.ts:globalMapNodes). Como no original (refs/original/globalmap_kaarg|druids.png): estandarte xadrez = onde o herói está;
 * bandeira branca = local disponível; bandeira turquesa = local escolhido (o 1º da lista até o mouse passar por outro), com título e
 * descrição no alto do pergaminho e a trilha pontilhada de bolinhas pelas estradas (umoirpath.bmp / pathmap.bmp) já desenhada;
 * missões concluídas não têm marca. Clicar: as bolinhas se desenham de novo, em ~0,1 px/ms, e a missão (ou a cidade) abre.
 * Sem botão "Return to town" (o original não tem; o portão da cidade é o único caminho de ida).
 */
export default class GlobalMapScene extends Scene {
  private removeKey?: () => void;
  private restoreCursor?: () => void;
  private modal?: Container;
  private anims: Array<{ sprite: Sprite; frames: Texture[]; t: number; pos: number }> = [];
  private title = new Container();
  private body = new Container();
  private frame!: Frame640;
  private ctx!: CampaignCtx;
  private busy = false;
  private nav = new Nav(this.game);
  private map: "uimoir" | "yases" = "yases";
  private nodes: MapNode[] = [];
  private marks = new Map<MapNode, { sprite: Sprite; isHere: boolean }>();
  private sel?: MapNode;
  private defaultSel?: MapNode;
  private white: Texture[] = [Texture.EMPTY];
  private teal: Texture[] = [Texture.EMPTY];
  private cross: Texture[] = [Texture.EMPTY];
  private crossMark?: Sprite;
  private crossT = -1;
  private ball: Texture = Texture.EMPTY;
  private trail = new Container();
  private net?: PathNet;
  private from: Pt = { x: 0, y: 0 };
  private pathCache = new Map<MapNode, Pt[]>();
  private dotsShown = -1;
  private dots: Pt[] = [];
  private walk?: { t: number; total: number; node: MapNode };
  private pending?: MapNode;
  private hold = false;

  override async enter(params?: unknown): Promise<void> {
    this.hold = !!(params as { hold?: boolean } | undefined)?.hold;
    await safeEnter(this.game, this.root, "globalmap", () => this.build(), "town");
  }

  private async build(): Promise<void> {
    const game = this.game;
    game.audio.playMusic("map");
    this.ctx = await campaignCtx(game);
    const { data, st } = this.ctx;
    const gm = globalMapNodes(st, data);
    this.map = gm.map;
    const f = (this.frame = frame640(this.root));
    const [bgTex, meta, extra, ballTex, pathTex] = await Promise.all([
      loadTexOr(game, D + (gm.map === "uimoir" ? "uimoir.webp" : "yases.webp")),
      game.data.tryJson<Record<"missionflag" | "yourflag", StripInfo>>(D + "globalmap.json"),
      game.data.tryJson<Record<string, StripInfo | string>>(D + "sprites.json"),
      loadTexOr(game, D + "ballmap_bmp.webp"),
      loadTexOr(game, D + (gm.map === "uimoir" ? "path_uimoir.png" : "path_yases.png")),
    ]);
    f.addChild(spr(bgTex));
    this.ball = ballTex;
    const strip = (k: string) => (extra?.[k] && typeof extra[k] === "object" ? loadStrip(game, D, extra[k] as StripInfo) : Promise.resolve([Texture.EMPTY]));
    const [teal, chk, white, cross, smallFlag] = await Promise.all([
      meta ? loadStrip(game, D, meta.missionflag) : Promise.resolve([Texture.EMPTY]), meta ? loadStrip(game, D, meta.yourflag) : Promise.resolve([Texture.EMPTY]),
      strip("flagonmap"), strip("cross"), strip("flag"),
    ]);
    this.teal = teal; this.white = white; this.cross = cross;
    if (pathTex !== Texture.EMPTY) {
      const rd = maskReader(pathTex);   // path_*.png: 128 = estrada, 255 = nó (local do mapa)
      const bits = new Uint8Array(640 * 480);
      for (let y = 0; y < 480; y++) for (let x = 0; x < 640; x++) { const v = rd(x, y); bits[y * 640 + x] = v > 200 ? 2 : v > 0 ? 1 : 0; }
      this.net = new PathNet(bits);
    }

    // título (font4 negrito, escuro) e descrição (font2 escura, centrada) no alto do pergaminho de Yases
    this.title.position.set(230, 25);
    this.body.position.set(this.title.x, 47);   // descrição: font2 centrada linha a linha, espaço de 7 px, passo de 10 px (ui/tipwin.ts centeredWords)

    const here = st.current ?? (["T", st.lastTown] as const);
    this.nodes = gm.nodes.filter(n => !n.done);
    const hn = this.nodes.find(n => n.kind === "town" && here[0] === "T" && here[1] === n.id);
    this.from = hn ? { x: hn.x, y: hn.y } : gm.hero ?? { x: 0, y: 0 };
    f.addChild(this.trail);
    for (const n of this.nodes) {
      const isHere = n === hn;
      if (gm.map === "uimoir") continue;                 // em Uimoir o destino é o X desenhado (sem bandeiras)
      const frames = isHere ? chk : white;
      const s = this.flag(frames, n);
      this.marks.set(n, { sprite: s, isHere });
      if (isHere) continue;
      s.eventMode = "static"; s.cursor = "select";   // seta dourada no mapa; mão prateada sobre as bandeiras (refs/original/gm_*)
      s.hitArea = new Rectangle(0, 0, frames[0].width, frames[0].height);
      s.on("pointerover", () => { if (!this.busy) this.select(n); })
        .on("pointerout", () => { if (!this.busy) this.select(this.defaultSel); })
        .on("pointertap", () => this.go(n));
    }
    if (gm.map === "uimoir" && gm.hero) this.flag(smallFlag, { kind: "town", id: st.lastTown, x: gm.hero.x, y: gm.hero.y }, { x: -10, y: -24 });   // estandarte xadrez (pequeno) em Plagat
    f.addChild(this.title, this.body);

    this.restoreCursor = applyThemeCursor(game.app, "default");
    game.app.renderer.events.cursorStyles.select = cursorCss("select");
    this.removeKey = onKey(e => {
      if (e.key !== "Escape" || this.busy) return;
      if (this.modal) { this.modal.destroy({ children: true }); this.modal = undefined; } else this.modal = openGameMenuIn(game, this.root, () => { this.modal = undefined; });
    });

    if (gm.map === "uimoir") {
      // saída de Plagat: a trilha vai sozinha ao 1º local (missão 10) e a missão começa; sem texto (refs/original/globalmap.png)
      const target = this.nodes.find(n => n.kind === "mission");
      if (target) {
        this.pending = target;
        const [cx, cy] = [target.x - 10, target.y - 20];
        this.crossMark = spr(this.cross[0], cx, cy);
        this.crossMark.visible = false;
        f.addChild(this.crossMark);
        if (!this.hold) this.startTravel();
      }
    } else {
      // escolha inicial: a 1ª missão da lista (nas capturas do original sempre é uma missão: Lyrisha Village, The Desert Star), senão o 1º local
      const free = this.nodes.filter(n => !this.marks.get(n)!.isHere);
      this.defaultSel = free.find(n => n.kind === "mission") ?? free[0];
      this.select(this.defaultSel);
      if (!this.defaultSel) this.say("No destinations", "");
    }
  }

  /** Inicia a viagem automática de Uimoir (a cena aberta com `hold` espera esta chamada — usado pelas capturas de referência). */
  startTravel(): void {
    const n = this.pending;
    if (!n || this.walk || this.busy) return;
    this.pending = undefined;
    this.crossT = 0;
    if (this.crossMark) this.crossMark.visible = true;
    this.go(n);
  }

  private info(n: MapNode): { title: string; text: string } {
    if (n.kind === "town") { const t = townDef(this.ctx.data, n.id); return { title: this.ctx.data.towns.find(x => x.id === n.id)?.title ?? t.name, text: t.description ?? "" }; }
    const m = missionText(this.ctx.data, n.id);
    return { title: m.title, text: m.text.toUpperCase() };
  }

  private flag(frames: Texture[], n: MapNode, at?: Pt): Sprite {
    const s = spr(frames[0]);
    s.position.set(at ? n.x + at.x : n.x - 4, at ? n.y + at.y : n.y - frames[0].height + 4);
    this.frame.addChild(s);
    this.anims.push({ sprite: s, frames, t: Math.random() * 0.1, pos: Math.floor(Math.random() * frames.length) });
    return s;
  }

  private swap(s: Sprite, frames: Texture[]): void { const a = this.anims.find(x => x.sprite === s); if (a) { a.frames = frames; a.pos %= frames.length; } }

  private say(title: string, text: string): void {
    // refs/original/gm_*: título em font4 SEM negrito, centrado, com 12 px entre as palavras; a descrição perde o último caractere (o ponto final)
    this.title.removeChildren().forEach(c => c.destroy());
    this.body.removeChildren().forEach(c => c.destroy({ children: true }));
    if (title) {
      const ts = title.split(/\s+/).filter(Boolean).map(w => makeText(w, { font: "font4", color: 0x201808 }));
      const total = ts.reduce((a, t) => a + t.width, 0) + TITLE_GAP * (ts.length - 1);
      let x = -Math.round(total / 2);
      for (const t of ts) { t.position.set(x, 0); this.title.addChild(t); x += t.width + TITLE_GAP; }
    }
    if (text) this.body.addChild(centeredWords(text.slice(0, -1), 316, 0x101c08));
  }

  /** Local escolhido: bandeira turquesa, título/descrição e a trilha completa de bolinhas até ele. */
  private select(n?: MapNode): void {
    if (this.sel === n) return;
    this.sel = n;
    for (const [m, k] of this.marks) if (!k.isHere) this.swap(k.sprite, m === n ? this.teal : this.white);
    if (n && this.map === "yases") { const i = this.info(n); this.say(i.title, i.text); } else this.say("", "");
    this.dots = n ? this.dotsFor(n) : [];
    this.trail.removeChildren().forEach(c => c.destroy()); this.dotsShown = 0;
    this.drawTrail(this.dots.length);
  }

  /** Bolinhas ao longo da rota pelas estradas (ui/mappath.ts: grafo de nós como o exe; sem rede, em linha reta a cada 8 px). */
  private dotsFor(n: MapNode): Pt[] {
    let path = this.pathCache.get(n);
    if (!path) {
      const to = { x: n.x, y: n.y };
      path = this.net?.dots(this.from, to) ?? [];
      if (!path.length) {             // sem rede ou sem rota: linha reta
        const len = Math.hypot(to.x - this.from.x, to.y - this.from.y);
        for (let d = 0; d <= len; d += 8) path.push({ x: this.from.x + (to.x - this.from.x) * (d / (len || 1)), y: this.from.y + (to.y - this.from.y) * (d / (len || 1)) });
      }
      this.pathCache.set(n, path);
    }
    return path;
  }

  private drawTrail(n: number): void {
    if (n === this.dotsShown) return;
    // só acrescenta/remove a diferença
    const have = this.trail.children.length;
    if (n < have) for (const c of this.trail.removeChildren(n)) c.destroy();
    else for (let i = have; i < n; i++) { const d = this.dots[i]; this.trail.addChild(spr(this.ball, d.x - BALL_OFF, d.y - BALL_OFF)); }   // bolinha 8×8 desenhada com o canto em (pixel − BALL_OFF) (refs/original/gm_*)
    this.dotsShown = n;
  }

  /** Anda até o local (as bolinhas se desenham do herói até ele) e entra. */
  private go(n: MapNode): void {
    if (this.busy || this.modal) return;
    this.busy = true;
    this.select(n);
    this.dotsShown = -1; this.trail.removeChildren().forEach(c => c.destroy()); this.dotsShown = 0;
    const total = Math.max(DOT_MS, (this.dots.length - 1) * DOT_MS);   // as 2 primeiras bolinhas já estão na tela no instante 0 (original: 2 + ⌊t/103⌋)
    this.walk = { t: 0, total: Math.max(1, total), node: n };
  }

  private enterNode(n: MapNode): void {
    const { st, data } = this.ctx;
    if (n.kind === "town") { this.nav.go("town", { town: n.id }); return; }
    enterLocation(st, ["M", n.id]);
    syncLegacy(this.game.state.progress, data);
    this.game.state.autosave(`entrando na missão ${n.id}`);
    this.nav.go("mission", { id: n.id } satisfies MissionParams);
  }

  override update(dtMs: number): void {
    for (const f of this.anims) {
      f.t += dtMs / 1000;
      while (f.t >= 0.1) { f.t -= 0.1; f.pos = (f.pos + 1) % f.frames.length; }
      f.sprite.texture = f.frames[f.pos];
    }
    if (this.crossT >= 0 && this.crossMark) {
      this.crossT += dtMs / 1000;
      this.crossMark.texture = this.cross[Math.min(this.cross.length - 1, Math.floor(this.crossT * CROSS_FPS))];
    }
    const w = this.walk;
    if (w) {
      w.t = Math.min(w.total, w.t + dtMs);
      this.drawTrail(Math.min(this.dots.length, 2 + Math.floor(w.t / DOT_MS)));
      if (w.t >= w.total) { this.walk = undefined; this.enterNode(w.node); }
    }
  }

  override exit(): void { this.removeKey?.(); this.restoreCursor?.(); }
}

/** Pré-carrega o mapa-múndi (a missão inicial usa o mapa de Uimoir). */
export async function prefetch(game: Game): Promise<void> {
  const gm = await game.data.tryJson<Record<string, StripInfo>>(D + "globalmap.json");
  await warmTextures(game, [D + "uimoir.webp", D + "path_uimoir.png", D + "ballmap_bmp.webp", ...(gm ? Object.values(gm).map(i => D + i.strip) : []), D + "cross.webp"]);
}
