import { Container, Graphics, Rectangle, Sprite, Texture, type FederatedPointerEvent } from "pixi.js";
import { Scene } from "../core/scene";
import type { MissionResult } from "../core/state";
import { Hint } from "../ui/hint";
import { applyThemeCursor } from "../ui/cursor";
import { Voices } from "../town/voices";
import {
  Nav, Texts, ensureHero, loadStrip, loadTex, loadTexOr, maskReader, onKey, safeEnter, showModal, spr,
  type StripInfo,
} from "../town/common";
import type { Game } from "../core/game";
import { openGameMenuIn } from "../ui/gamemenu";
import { installGameHotkeys } from "../ui/hotkeys";
import { warm, warmTextures } from "../ui/prefetch";
import { frame640, ART_W, type Frame640 } from "../ui/frame640";
import { showTipWindow, tipsEnabled, type TipWindow } from "../ui/tipwin";
import { showTalk, type TalkWindow } from "../ui/talkwin";
import { enterTown, routeTownArrival, townDef, type CampaignCtx } from "../campaign/runtime";
import { getVar, leaveTown, stageOf, V_M10_TAKEN } from "../campaign/engine";
import type { TownDef } from "../campaign/types";

interface Region { name: string; x: number; y: number; w: number; h: number; cx: number; cy: number; top: number; speech?: string }
interface AnimMeta { x: number; y: number; group?: string; seq?: number; mode?: "loop" | "hover" | "once"; hover?: string; hoverTo?: number; rest?: number; fps?: number }
interface BirdFlight { strip: string; cells: ([number, number, number, number, number] | null)[] }
interface TownMeta {
  regions: Record<string, Region>;
  anims: Record<string, AnimMeta & StripInfo>;
  /** primeiro plano com preto transparente sobre os pássaros (torres e telhados; só Plagat) */
  overlay?: { x: number; y: number; strip: string };
  birds?: { x: number; y: number; fps: number; flights: BirdFlight[] };
}

/**
 * Sequências de um mesmo grupo (parado, gestos...) alternadas num único sprite.
 * Modos: loop = repete (e às vezes troca de sequência); hover = abre/fecha conforme o mouse está na região `region` (grade do
 * portão, porta da taverna); once = fica no quadro `rest` e de tempos em tempos toca a sequência inteira (guardas do portão).
 */
interface AnimSeq { x: number; y: number; frames: Texture[] }
interface Anim {
  sprite: Sprite; seqs: AnimSeq[]; seq: number; t: number; fps: number; mode: "loop" | "hover" | "once"; pos: number; target: number;
  region: string; rest: number; hoverTo: number; wait: number; playing: boolean;
  /** modo loop: pausa (s) entre execuções no quadro 0; `continuous` = sem pausa (dervixe de Plagat) */
  gap: [number, number]; pause: number; continuous: boolean;
}
/**
 * Cadência das animações, medida em sequências de 100 ms do original (scratch/cap2/c_town|c_kaarg|c_druids, 19/10): cada grupo repousa no quadro 0
 * e toca UMA sequência por vez (alternando as do grupo), com pausa aleatória entre execuções; Plagat roda a 15 quadros/s, Kaarg e o acampamento a 10.
 * Só o dervixe de Plagat roda sem pausa. Grupos fora da tabela usam 2..5 s.
 */
const ANIM_CFG: Record<string, Record<string, { fps?: number; gap?: [number, number]; continuous?: boolean }>> = {
  // ritmo medido em 30 s de Plagat no original (scratch/fm/pl, 300 quadros a 100 ms; tools/refcap anim_an): carroça 15 quadros a ~14 fps em surtos de ~1 s
  // com pausas de 2,2 a 6,3 s; dervixe 30 quadros a ~14 fps (2,2 s) a cada ~8,5 s; mulher quase contínua (~9 fps); placa 7-8 quadros com pausas de 0,1 a 2 s;
  // cata-vento raro; lojista e halo não se mexeram nos 30 s (pausas longas [est])
  plagat: { dervish: { fps: 15, gap: [6, 6.8] }, cart: { fps: 15, gap: [2.2, 6.3] }, woman: { fps: 9, continuous: true }, sign: { fps: 15, gap: [0.1, 2] }, vane: { fps: 15, gap: [1.3, 12] },
    shopkeeper: { gap: [60, 120] }, halo: { gap: [60, 120] } },
  kaarg: { dervish: { gap: [0.3, 1] }, girl1: { gap: [3.5, 5] }, girl2: { gap: [3.5, 5] }, guard: { gap: [2.5, 4.5] } },
  druids: { man: { gap: [2, 6] }, woman: { gap: [3, 6] }, lizard: { gap: [0.5, 1.5] } },
};
/** Pássaros: de tempos em tempos um dos 9 voos (recortes justos de quadros 552×92) cruza o céu. */
interface Birds { sprite: Sprite; flights: { tex: Texture; cells: BirdFlight["cells"]; cache: Texture[] }[]; flight: number; pos: number; fps: number; t: number; wait: number; x: number; y: number }

/** Pasta da arte de cada cidade: Plagat = arte base (assets/ui/town/), Kaarg e o acampamento em subpastas (tools/pipeline/town.py). */
export function townArtDir(t: Pick<TownDef, "key" | "art">): string { return t.art === "base" ? "assets/ui/town/" : `assets/ui/town/${t.key}/`; }

/** Pré-carrega as imagens de Plagat (chamado em segundo plano pelo menu/criação de personagem). */
export async function prefetch(game: Game): Promise<void> {
  const BASE = "assets/ui/town/";
  const meta = await game.data.tryJson<TownMeta>(BASE + "town.json");
  if (!meta) return;
  await Promise.all(["data/texts/town.json", "data/texts/globalmap.json", "data/texts/main.json", "data/texts/npcnames.json", "data/campaign.json"].map(p => game.data.tryJson(p)));
  await warmTextures(game, [BASE + "main.webp", BASE + "mask.png",
    ...Object.keys(meta.regions).map(id => `${BASE}hili_${id}.webp`), ...Object.values(meta.anims).map(a => BASE + "anim/" + a.strip)]);
}

/**
 * Cidade (Plagat, Kaarg ou o acampamento druida, escolhida pela campanha): vista original townmain.bmp 640×480 centralizada
 * (ui/frame640.ts), SEM painel de ouro, título ou caixa de dica (a faixa de baixo é arte da cidade); a dica abre numa janela própria
 * (ui/tipwin.ts) e, ao passar o mouse, uma etiqueta pequena ("Inn", "Shop"...) aparece junto do cursor. Máscara de cliques: taverna,
 * loja, portão = mapa-múndi, estátua = menu do jogo, escola, moradores. Animações do original: guardas atrás da grade, carroça,
 * mulher e dervixe, lojista na porta, porta da taverna que abre com o mouse, pássaros (tools/pipeline/town.py).
 * É também o ponto de chegada da missão: `routeTownArrival` aplica o resultado no motor de campanha, toca os vídeos e
 * redireciona (mapa-múndi, a missão seguinte direto, ou o fim do jogo).
 */
export default class TownScene extends Scene {
  private anims: Anim[] = [];
  private birds?: Birds;
  private hili = new Map<number, Sprite>();
  private hover = 0;
  private texts!: Texts;
  private removeKey?: () => void;
  private modal?: Container;
  private tip?: TipWindow;
  private talk?: TalkWindow;
  private hint!: Hint;
  private restoreCursor?: () => void;
  private readMask!: (x: number, y: number) => number;
  private regions = new Map<number, Region>();
  private ctx!: CampaignCtx;
  private town!: TownDef;
  private frame!: Frame640;
  private nav = new Nav(this.game);

  override async enter(params?: unknown): Promise<void> {
    let redirected = false;
    await safeEnter(this.game, this.root, "town", async () => {
      const { ctx, route, result } = await routeTownArrival(this.game, params);
      this.ctx = ctx;
      if (route.scene !== "town") {
        redirected = true;
        if (route.scene === "credits") this.nav.go("credits", { ending: true });
        else if (route.scene === "mission") this.nav.go("mission", { id: route.mission });
        else this.nav.go("globalmap");
        return;
      }
      await this.build(route.town, result);
    });
    if (!redirected) warm(this.game, ["inn", "shop", "globalmap"]);
  }

  private async build(townId: number, result?: MissionResult): Promise<void> {
    const game = this.game;
    ensureHero(game);
    const town = (this.town = townDef(this.ctx.data, townId));
    enterTown(game, this.ctx, townId);
    game.state.save();
    game.audio.playMusic(town.music);
    this.texts = await Texts.load(game);
    const BASE = townArtDir(town);
    const meta = await game.data.getJson<TownMeta>(BASE + "town.json");
    const [mainTex, maskTex] = await Promise.all([loadTexOr(game, BASE + "main.webp"), loadTex(game, BASE + "mask.png")]);
    this.readMask = maskReader(maskTex);

    const view = (this.frame = frame640(this.root));
    view.addChild(spr(mainTex));

    // animações (sequências agrupadas) e realces
    const animList = Object.entries(meta.anims);
    const regionList = Object.entries(meta.regions);
    const [animFrames, hiliTex] = await Promise.all([
      Promise.all(animList.map(([, a]) => loadStrip(game, BASE + "anim/", a))),
      Promise.all(regionList.map(([id]) => loadTexOr(game, `${BASE}hili_${id}.webp`))),
    ]);
    const groups = new Map<string, Anim>();
    animList.forEach(([name, a], i) => {
      const g = a.group ?? name;
      let an = groups.get(g);
      if (!an) {
        const s = spr(animFrames[i][0], a.x, a.y);
        view.addChild(s);
        const mode = a.mode === "hover" || g === "door" || g === "gate" ? "hover" : a.mode ?? "loop";
        const region = a.hover ?? (g === "door" || g === "gate" ? "gate" : "");
        const cfg = ANIM_CFG[town.art === "base" ? "plagat" : town.key]?.[g] ?? {};
        const fps = cfg.fps ?? a.fps ?? (mode === "hover" ? 14 : town.art === "base" ? 15 : 10);
        const gap = cfg.gap ?? [2, 5];
        an = { sprite: s, seqs: [], seq: 0, t: Math.random() * 0.2, fps, mode, pos: a.rest ?? 0, target: 0, region, rest: a.rest ?? 0, hoverTo: a.hoverTo ?? -1, wait: 2 + Math.random() * 6, playing: false,
          gap, pause: Math.random() * gap[1], continuous: !!cfg.continuous };
        groups.set(g, an);
        this.anims.push(an);
      }
      an.seqs[a.seq ?? 0] = { x: a.x, y: a.y, frames: animFrames[i] };
    });
    for (const an of this.anims) an.seqs = an.seqs.filter(Boolean);
    // a grade do portão fica na frente dos guardas
    for (const an of this.anims) if (an.mode === "hover" && an.region === "gate") view.addChild(an.sprite);
    if (meta.birds || meta.overlay) await this.buildSky(view, BASE, meta);
    regionList.forEach(([id, r], i) => {
      const n = Number(id);
      const h = spr(hiliTex[i], r.x, r.y);
      h.alpha = 0;
      view.addChild(h);
      this.hili.set(n, h);
      this.regions.set(n, r);
    });

    // etiqueta do mouse (ui/hint.ts: base 3 px acima e canto esquerdo 3 px à direita do cursor; só aparece ~0,5 s depois de o mouse parar),
    // acima de tudo no quadro. O cursor é sempre o "default" do jogo (a seta dourada não muda sobre as regiões: town_hover_*).
    this.hint = new Hint(view);
    this.restoreCursor = applyThemeCursor(game.app, "default");

    view.on("pointermove", (e: FederatedPointerEvent) => {
      const p = view.local(e);
      this.setHover(this.tip ? 0 : this.readMask(p.x, p.y));
      const text = this.tip ? "" : this.labelFor(this.regions.get(this.hover)?.name);
      if (text) this.hint.show(text, p.x + 4, p.y); else this.hint.hide();
    });
    view.on("pointerout", () => { this.setHover(0); this.hint.hide(); });
    // o original age ao APERTAR o botão (town_press_*: a taverna/loja já abrem, a estátua abre o menu e o portão mostra o guarda com o botão ainda apertado)
    view.on("pointerdown", (e: FederatedPointerEvent) => {
      if (e.button !== 0 || this.modal || this.tip || this.talk) return;
      const p = view.local(e);
      this.hint.hide();
      this.activate(this.readMask(p.x, p.y));
    });

    this.removeKey = onKey(e => { if (e.key === "Escape") this.toggleMenu(); });
    installGameHotkeys(game);                          // F2 = Save Game, F3 = Load Game, F10 = menu (ui/hotkeys.ts)

    if (result && result.outcome !== "complete") this.showFailure(result);
    else this.openTip();
  }

  /** Céu animado: pássaros atrás das torres (primeiro plano `overlay`). */
  private async buildSky(view: Frame640, BASE: string, meta: TownMeta): Promise<void> {
    const flights: Birds["flights"] = [];
    for (const f of meta.birds?.flights ?? []) {
      const tex = await loadTexOr(this.game, BASE + "anim/" + f.strip);
      flights.push({ tex, cells: f.cells, cache: [] });
    }
    if (flights.length) {
      const sprite = new Sprite(Texture.EMPTY);
      sprite.visible = false;
      view.addChild(sprite);
      this.birds = { sprite, flights, flight: 0, pos: 0, fps: meta.birds!.fps, t: 0, wait: 1 + Math.random() * 5, x: meta.birds!.x, y: meta.birds!.y };
    }
    if (meta.overlay) view.addChild(spr(await loadTexOr(this.game, BASE + "anim/" + meta.overlay.strip), meta.overlay.x, meta.overlay.y));
  }

  /** Janela de dica ao entrar (a caixa "Show tips next time" desliga; ver ui/tipwin.ts). */
  openTip(): void {
    if (!this.frame || this.tip || !tipsEnabled()) return;
    const text = this.town.tips ? this.texts.town[this.town.tips]?.[0]?.text ?? this.texts.tip(1) : this.texts.tip(1);
    if (!text) return;
    this.setHover(0);
    this.tip = showTipWindow(this.frame, { text, x: 327, y: 0, onClose: () => { this.tip = undefined; } });
  }

  /** Fecha a janela de dica (usado pelos cenários de captura). */
  closeTip(): void { this.tip?.close(); }

  private labelFor(name?: string): string {
    const t = this.texts;
    return name === "inn" ? t.label(236, "Inn") : name === "shop" ? t.label(233, "Shop") : name === "statue" ? t.label(235, "Click to bring up the Main Menu")
      : name === "trainer" ? t.label(234, "School of Magic and Martial Arts") : name === "gate" ? t.label(232, "Exit") : "";
  }

  private setHover(id: number): void {
    if (id === this.hover) return;
    this.hover = id;
    const name = this.regions.get(id)?.name;
    for (const a of this.anims) if (a.mode === "hover") a.target = name === a.region ? (a.hoverTo >= 0 ? a.hoverTo : a.seqs[0].frames.length - 1) : a.rest;
  }

  /** Seção de fala por estágio (kaargwoman30..110, druidinnkeeper60..110): a maior ≤ estágio atual. */
  private speechSection(base: string): string | undefined {
    const stage = stageOf(this.ctx.st);
    let best: string | undefined, bestN = -1;
    for (const k of Object.keys(this.texts.town)) {
      const m = k.match(/^([a-z]+?)(\d+)$/);
      if (!m || m[1] !== base) continue;
      const n = Number(m[2]);
      if (n <= stage && n > bestN) { best = k; bestN = n; }
      if (!best && bestN < 0) best = k;
    }
    return best;
  }

  private activate(id: number): void {
    const r = this.regions.get(id);
    const name = r?.name;
    const g = this.game;
    const town = this.town.id;
    if (name === "inn") this.nav.go("inn", { town });
    else if (name === "shop") this.nav.go("shop", { town });
    else if (name === "statue") this.toggleMenu();
    else if (name === "trainer") {
      // Escola ("School of Magic and Martial Arts"): o original tem a região (realce e etiqueta ao passar o mouse), mas não há tela de
      // treino nos dados da campanha (graphics/interface/training vazio); o aviso "School is not open yet" era invenção nossa e saiu.
      // O clique não faz nada até haver captura do original (docs/PROVENANCE.md, docs/GAPS.md).
    } else if (name === "person" && r?.speech) {
      const sec = this.speechSection(r.speech);
      const lines = sec ? this.texts.pick(sec, ensureHero(g)) : [];
      if (!lines.length) return;
      let i = 0;
      const show = async () => {
        this.closeModal();
        const l = lines[i];
        // mesma janela de conversa da taverna (ui/talkwin.ts: moldura com caveiras + botão Ok chanfrado) e o retrato 88×108 do morador
        // (recortado do original; sem arquivo = sem retrato). O original NÃO mostra o nome do falante.
        const portrait = await this.portraitOf(l.npc);
        if (this.root.destroyed) return;
        this.talk = showTalk(this.frame, {
          text: l.text, framedPortrait: portrait,
          onOk: () => { this.talk = undefined; g.audio.stopSpeech(); i++; if (i < lines.length) void show(); },
        });
        void Voices.load(g).then(v => { if (this.talk) v.say(g, sec!, l, ensureHero(g)); });
      };
      void show();
    } else if (name === "gate") {
      const st = this.ctx.st;
      if (town === 1 && !getVar(st, V_M10_TAKEN)) {
        const line = this.texts.pick("plagatguard", ensureHero(g))[0];
        const guard = line?.text ?? "Sorry, but you can't leave the town.";
        if (line) void Voices.load(g).then(v => { if (this.talk) v.say(g, "plagatguard", line, ensureHero(g)); });
        void this.portraitOf(line?.npc ?? 97).then(portrait => {
          if (this.root.destroyed || this.talk) return;
          this.talk = showTalk(this.frame, { text: guard, framedPortrait: portrait, onOk: () => { this.talk = undefined; g.audio.stopSpeech(); } });
        });
        return;
      }
      leaveTown(st, town);
      g.state.autosave("saindo da cidade");
      this.nav.go("globalmap");
    }
  }

  /** retrato 88×108 do morador (assets/ui/talk/npc<N>.webp); undefined se não houver */
  private async portraitOf(npc: number): Promise<Texture | undefined> {
    const t = await loadTexOr(this.game, `assets/ui/talk/npc${npc}.webp`);
    return t === Texture.EMPTY ? undefined : t;
  }

  private closeModal(): void { this.modal?.destroy({ children: true }); this.modal = undefined; this.game.audio.stopSpeech(); }

  private toggleMenu(): void {
    if (this.tip) return;
    if (this.modal) { this.closeModal(); return; }
    // menu do jogo original (ui/gamemenu.ts): Save/Load/Options/Sound/Return/Exit
    this.modal = openGameMenuIn(this.game, this.root, () => { this.modal = undefined; });
  }

  private showFailure(r: MissionResult): void {
    const text = r.outcome === "fail" ? "You were defeated. Rest at the town and try again." : "You returned to town.";
    this.modal = showModal(this.root, { title: r.outcome === "fail" ? "Mission Failed" : "Back in Town", text, buttons: [{ label: "Ok", onClick: () => { this.closeModal(); this.openTip(); } }] });
  }

  override update(dtMs: number): void {
    const dt = dtMs / 1000;
    for (const a of this.anims) {
      let seq = a.seqs[a.seq];
      if (!seq) continue;
      const last = seq.frames.length - 1;
      const step = 1 / a.fps;
      if (a.mode === "loop" && !a.continuous) {
        // repouso no quadro 0 e uma sequência por vez (alterna as do grupo)
        if (!a.playing) {
          a.pause -= dt;
          if (a.pause > 0) { a.sprite.texture = seq.frames[0]; continue; }
          a.playing = true; a.pos = 0; a.t = 0;
          if (a.seqs.length > 1) { a.seq = (a.seq + 1) % a.seqs.length; seq = a.seqs[a.seq]; a.sprite.position.set(seq.x, seq.y); }
        } else a.t += dt;
        while (a.playing && a.t >= step) {
          a.t -= step;
          a.pos++;
          if (a.pos >= seq.frames.length) { a.playing = false; a.pos = 0; a.pause = a.gap[0] + Math.random() * (a.gap[1] - a.gap[0]); }
        }
        a.sprite.texture = seq.frames[Math.max(0, Math.min(seq.frames.length - 1, a.pos))];
        continue;
      }
      a.t += dt;
      if (a.mode === "once" && !a.playing) {
        a.wait -= dt;
        if (a.wait <= 0) { a.playing = true; a.pos = 0; a.t = 0; }
      }
      while (a.t >= step) {
        a.t -= step;
        if (a.mode === "hover") { a.pos += Math.sign(a.target - a.pos); continue; }
        if (a.mode === "once") {
          if (!a.playing) continue;
          a.pos++;
          if (a.pos >= last) { a.pos = Math.min(a.rest, last); a.playing = false; a.wait = 8 + Math.random() * 10; }
          continue;
        }
        a.pos++;
        if (a.pos >= seq.frames.length) {
          a.pos = 0;
          // fim da sequência: em geral repete a principal; às vezes um gesto (outra sequência do grupo)
          if (a.seqs.length > 1) {
            a.seq = a.seq !== 0 ? 0 : Math.random() < 0.35 ? 1 + Math.floor(Math.random() * (a.seqs.length - 1)) : 0;
            seq = a.seqs[a.seq];
            a.sprite.position.set(seq.x, seq.y);
          }
        }
      }
      a.sprite.texture = seq.frames[Math.max(0, Math.min(seq.frames.length - 1, a.pos))];
    }
    this.updateBirds(dt);
    for (const [id, h] of this.hili) {
      const want = id === this.hover && !this.modal && !this.tip && !this.talk ? 1 : 0;
      h.alpha = want;   // original: o realce acende e apaga no mesmo quadro (town_hover_*, sequência de 40 ms)
    }
  }

  private updateBirds(dt: number): void {
    const b = this.birds;
    if (!b) return;
    if (!b.sprite.visible) {
      b.wait -= dt;
      if (b.wait > 0) return;
      b.flight = Math.floor(Math.random() * b.flights.length);
      b.pos = 0; b.t = 0; b.sprite.visible = true;
    }
    const f = b.flights[b.flight];
    b.t += dt;
    while (b.t >= 1 / b.fps) { b.t -= 1 / b.fps; b.pos++; }
    if (b.pos >= f.cells.length) { b.sprite.visible = false; b.wait = 5 + Math.random() * 12; return; }
    const c = f.cells[b.pos];
    if (!c) { b.sprite.texture = Texture.EMPTY; return; }
    b.sprite.texture = (f.cache[b.pos] ??= new Texture({ source: f.tex.source, frame: new Rectangle(c[0], 0, c[1], c[2]) }));
    b.sprite.position.set(b.x + c[3], b.y + c[4]);
  }

  override exit(): void {
    this.removeKey?.();
    this.tip?.close();
    this.talk?.close();
    this.game.audio.stopSpeech();
    this.hint?.hide();
    this.restoreCursor?.();
  }
}

