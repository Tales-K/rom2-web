import { Container, Graphics, Rectangle, Sprite, Texture } from "pixi.js";
import type { Game } from "../core/game";
import { SCREEN_H, SCREEN_W } from "../core/scene";
import type { HeroState } from "../core/state";
import { textButton } from "../ui/button";
import { makeText } from "../ui/text";
import { TEST_HERO_KIT } from "./items_fallback";

/** Escala entre a arte original (640x480) e a nossa tela (1024x768): exatamente 1,6 nos dois eixos. */
export const S = SCREEN_W / 640;

export const GOLD = 0xe8c060;
export const PARCH = 0xe8dcc0;

export function loadTex(game: Game, path: string): Promise<Texture> { return game.data.texture(path); }

/** Como `loadTex`, mas nunca rejeita: arquivo ausente/corrompido vira textura vazia (aviso no console), para a cena não travar. */
export async function loadTexOr(game: Game, path: string): Promise<Texture> {
  try { return await game.data.texture(path); } catch (err) { console.warn("[textura] falhou:", path, (err as Error)?.message ?? err); return Texture.EMPTY; }
}

/** Faixa horizontal de quadros de animação (gerada por tools/pipeline/imgout.py:save_strip) -> uma Texture por quadro (compartilham a mesma fonte). */
export interface StripInfo { strip: string; frames: number; fw: number; fh: number }
export async function loadStrip(game: Game, dir: string, info: StripInfo): Promise<Texture[]> {
  const t = await loadTexOr(game, dir + info.strip);
  if (t === Texture.EMPTY) return [Texture.EMPTY];
  return Array.from({ length: info.frames }, (_, i) => new Texture({ source: t.source, frame: new Rectangle(i * info.fw, 0, info.fw, info.fh) }));
}

export async function loadTexMap(game: Game, paths: Record<string, string>): Promise<Record<string, Texture>> {
  const keys = Object.keys(paths);
  const tex = await Promise.all(keys.map(k => game.data.texture(paths[k])));
  const out: Record<string, Texture> = {};
  keys.forEach((k, i) => { out[k] = tex[i]; });
  return out;
}

export function spr(t: Texture, x = 0, y = 0): Sprite { const s = new Sprite(t); s.position.set(x, y); return s; }

/** Retângulo preenchido (cor + alfa). */
export function rect(x: number, y: number, w: number, h: number, color: number, alpha = 1): Graphics {
  return new Graphics().rect(x, y, w, h).fill({ color, alpha });
}

/** Herói de teste quando uma cena é aberta direto por `#cena=...` sem passar pela criação de personagem (não mexe em core/state.ts). */
export function ensureHero(game: Game): HeroState {
  if (!game.state.hero) {
    game.state.hero = {
      name: "Igles", sex: "male", heroClass: "fighter", face: 0, stats: { body: 12, mind: 6, agility: 9, spirit: 6 },
      weaponSkill: "blade", gold: 400, inventory: TEST_HERO_KIT.inventory.map(id => ({ id })), equipment: { ...TEST_HERO_KIT.equipment },
      spells: [], difficulty: "normal",
    };
  }
  return game.state.hero;
}

/** Estágio da campanha (vars[768] do Scenario.dll; 10 se a campanha ainda não foi criada). */
export function currentStage(game: Game): number {
  return game.state.progress.campaign?.vars["768"] ?? 10;
}

/** O portão de Plagat já está liberado (vars[769]: a missão 10 foi oferecida pelo mensageiro) ou já se saiu de Plagat. */
export function missionAccepted(game: Game): boolean {
  const c = game.state.progress.campaign;
  return !!c && (!!c.vars["769"] || c.log.length > 0);
}

// ------------------------------------------------------------------ textos
export interface Block { tags: Record<string, string | number | boolean>; text: string }
export interface Line { npc: number; text: string; part?: number; tags?: Block["tags"] }

interface SectionFile { kind: string; sections: Record<string, Block[]> }
interface LinesFile { kind: string; lines: string[] }

export class Texts {
  town: Record<string, Block[]> = {};
  globalmap: Record<string, Block[]> = {};
  ui: string[] = [];
  npcNames: string[] = [];
  private missionCache = new Map<number, { title: string; text: string } | undefined>();

  static async load(game: Game): Promise<Texts> {
    const t = new Texts();
    const [town, gm, ui, npc] = await Promise.all([
      game.data.tryJson<SectionFile>("data/texts/town.json"),
      game.data.tryJson<SectionFile>("data/texts/globalmap.json"),
      game.data.tryJson<LinesFile>("data/texts/main.json"),
      game.data.tryJson<LinesFile>("data/texts/npcnames.json"),
    ]);
    t.town = town?.sections ?? {};
    t.globalmap = gm?.sections ?? {};
    t.ui = ui?.lines ?? [];
    t.npcNames = npc?.lines ?? [];
    return t;
  }

  /** Texto da interface (main.txt, por índice de linha) com alternativa. */
  label(i: number, fallback: string): string { return this.ui[i] || fallback; }

  tip(n: number): string { return this.town[`tips${n}`]?.[0]?.text ?? ""; }

  /** Blocos de uma seção que valem para este herói (tags iammale/iamfemale/iamfighter/iammage), na ordem de `part`. */
  pick(section: string, hero: HeroState): Line[] {
    const blocks = this.town[section] ?? [];
    const ok = blocks.filter(b => {
      const g = b.tags;
      if (g.iammale && hero.sex !== "male") return false;
      if (g.iamfemale && hero.sex !== "female") return false;
      if (g.iamfighter && hero.heroClass !== "fighter") return false;
      if (g.iammage && hero.heroClass !== "mage") return false;
      return true;
    });
    ok.sort((a, b) => Number(a.tags.part ?? 0) - Number(b.tags.part ?? 0));
    return ok.map(b => ({ npc: Number(b.tags.npc ?? 0), text: b.text.replace(/\s+/g, " ").trim(), part: Number(b.tags.part ?? 0), tags: b.tags }));
  }

  /** Primeiro texto de uma seção de globalmap.json. */
  gm(section: string): string | undefined { return this.globalmap[section]?.[0]?.text; }

  /** Título e texto de briefing de uma missão (mission<N>.json#briefing; senão globalmap.json). */
  async mission(game: Game, id: number): Promise<{ title: string; text: string } | undefined> {
    if (this.missionCache.has(id)) return this.missionCache.get(id);
    let out: { title: string; text: string } | undefined;
    const f = await game.data.tryJson<SectionFile>(`data/texts/mission${id}.json`);
    const b = f?.sections?.briefing?.[0]?.text;
    if (b) {
      const [title, ...rest] = b.split(/\n\s*\n/);
      out = { title: title.trim(), text: rest.join("\n\n").trim() };
    } else {
      const title = this.gm(`title${id}`), text = this.gm(`briefing${id}`);
      if (title) out = { title, text: text ?? "" };
    }
    this.missionCache.set(id, out);
    return out;
  }

  /** Nome de um NPC: 21 = herói; ids sem nome no jogo recebem um papel genérico. */
  npcName(id: number, hero: HeroState): string {
    if (id === 21) return hero.name;
    const override: Record<number, string> = { 517: "Messenger", 207: "Mercenary", 2108: "Merchant", 520: "Townsman" };
    // npcnames.txt: a linha k (0-based) é o npc k+1 (21 = herói "Aldor", 22 Igles, 23 Dina, 2022 Talena)
    return override[id] || this.npcNames[id - 1] || "Stranger";
  }
}

// ------------------------------------------------------------------ interface genérica
/** Janela modal simples (fundo escurecido + painel + botões). Devolve o container para remoção. */
export function showModal(parent: Container, opts: { title?: string; text?: string; width?: number; buttons: Array<{ label: string; onClick: () => void }> }): Container {
  const c = new Container();
  const dim = rect(0, 0, SCREEN_W, SCREEN_H, 0x000000, 0.55);
  dim.eventMode = "static";
  c.addChild(dim);
  const w = opts.width ?? 560;
  const panel = new Container();
  const body = opts.text ? makeText(opts.text, { size: 19, wrap: w - 48, color: PARCH }) : undefined;
  const title = opts.title ? makeText(opts.title, { size: 26, color: GOLD, bold: true }) : undefined;
  let y = 22;
  if (title) { title.position.set(24, y); y += title.height + 12; panel.addChild(title); }
  if (body) { body.position.set(24, y); y += body.height + 20; panel.addChild(body); }
  const bw = Math.min(220, (w - 24 - 12 * opts.buttons.length) / opts.buttons.length);
  const row = opts.buttons.map((b, i) => { const t = textButton(b.label, bw, 44, b.onClick); t.position.set(24 + i * (bw + 12), y); panel.addChild(t); return t; });
  void row;
  y += 44 + 22;
  const bg = new Graphics().roundRect(0, 0, w, y, 10).fill({ color: 0x1c140c, alpha: 0.96 }).stroke({ color: 0xb88a3c, width: 3 });
  panel.addChildAt(bg, 0);
  panel.position.set((SCREEN_W - w) / 2, (SCREEN_H - y) / 2);
  c.addChild(panel);
  parent.addChild(c);
  return c;
}

/** O menu do jogo (Esc) agora é o original, com Save/Load/Options (ui/gamemenu.ts); mesma assinatura de antes. */
export { openGameMenuIn as openGameMenu } from "../ui/gamemenu";

/** (obsoleto) menu provisório antigo; mantido só por referência. */
export function openGameMenuLegacy(game: Game, parent: Container, onClose?: () => void): Container {
  let modal: Container;
  const close = () => { modal.destroy({ children: true }); onClose?.(); };
  modal = showModal(parent, {
    title: "Game Menu",
    width: 420,
    buttons: [],
  });
  const panel = modal.children[1] as Container;
  const labels: Array<[string, () => void]> = [
    ["Return to Game", close],
    ["Save Game", () => { game.state.save(); note.text = "Game saved."; }],
    ["Exit to Main Menu", () => { game.state.save(); close(); void game.go("menu"); }],
  ];
  const note = makeText("", { size: 16, color: 0x9fd08a });
  let y = 70;
  for (const [label, fn] of labels) { const b = textButton(label, 372, 46, fn); b.position.set(24, y); panel.addChild(b); y += 58; }
  note.position.set(24, y + 4); panel.addChild(note);
  const bg = panel.children[0] as Graphics;
  bg.clear().roundRect(0, 0, 420, y + 40, 10).fill({ color: 0x1c140c, alpha: 0.96 }).stroke({ color: 0xb88a3c, width: 3 });
  panel.position.set((SCREEN_W - 420) / 2, (SCREEN_H - (y + 40)) / 2);
  return modal;
}

/** Faixa inferior: ouro do herói (ícone de moedas) + nome. */
export function goldBar(game: Game, moneyTex: Texture | undefined, hero: HeroState): { view: Container; refresh: () => void } {
  const view = new Container();
  const bg = rect(0, 0, 330, 48, 0x000000, 0.62);
  view.addChild(bg);
  if (moneyTex) { const m = spr(moneyTex, 2, -10); m.scale.set(0.7); view.addChild(m); }
  const name = makeText(hero.name, { size: 16, color: PARCH, bold: true }); name.position.set(66, 4);
  const gold = makeText("", { size: 20, color: GOLD, bold: true }); gold.position.set(66, 22);
  view.addChild(name, gold);
  const refresh = () => { gold.text = `${hero.gold} gold`; };
  refresh();
  return { view, refresh };
}

/** Escuta teclas enquanto a cena existe; devolve a função de remoção. */
export function onKey(handler: (e: KeyboardEvent) => void): () => void {
  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}

/** Lê os ids de uma máscara (PNG em tons de cinza com o valor = id) para teste de acerto por pixel. */
export function maskReader(tex: Texture): (x: number, y: number) => number {
  const res = tex.source.resource as CanvasImageSource & { width: number; height: number };
  const w = tex.width, h = tex.height;
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const ctx = cv.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(res, 0, 0);
  const data = ctx.getImageData(0, 0, w, h).data;
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    if (xi < 0 || yi < 0 || xi >= w || yi >= h) return 0;
    return data[(yi * w + xi) * 4];
  };
}

export { SCREEN_H, SCREEN_W };

// ------------------------------------------------------------------ robustez de cenas
/**
 * Corpo de `enter()` com tela "Loading..." (o SceneManager mostra a cena nova vazia até `enter` terminar) e proteção contra falha:
 * se a montagem lançar erro (JSON/imagem ausente etc.) a cena mostra a mensagem e volta ao destino `fallback` ao clicar ou apertar Esc/Enter,
 * em vez de ficar travada numa tela preta.
 */
export async function safeEnter(game: Game, root: Container, label: string, build: () => Promise<void>, fallback = "menu"): Promise<void> {
  const cover = new Container();
  cover.addChild(rect(0, 0, SCREEN_W, SCREEN_H, 0x000000));
  const t = makeText("Loading...", { size: 24, color: 0x8a7c60 });
  t.anchor.set(0.5); t.position.set(SCREEN_W / 2, SCREEN_H / 2);
  cover.addChild(t);
  cover.eventMode = "static";
  root.addChild(cover);
  try {
    await build();
    if (!cover.destroyed) cover.destroy({ children: true });
  } catch (err) {
    console.error(`[${label}] falha ao montar a cena:`, err);
    if (cover.destroyed) return;
    t.text = `Could not load "${label}".\nClick or press Esc to go back.`;
    t.style.align = "center";
    t.tint = 0xf0b060;
    root.addChild(cover);                              // por cima de tudo que já tenha sido montado
    const back = () => { window.removeEventListener("keydown", onKey, true); void game.go(fallback); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" || e.key === "Enter") back(); };
    window.addEventListener("keydown", onKey, true);
    cover.cursor = "pointer";
    cover.once("pointertap", back);
  }
}

/** Trava de navegação: só o primeiro pedido de troca de cena vale (cliques duplos/teclas repetidas não enfileiram trocas). */
export class Nav {
  private busy = false;
  constructor(private readonly game: Game) {}
  go(name: string, params?: unknown): void {
    if (this.busy) return;
    this.busy = true;
    this.game.go(name, params).catch(err => { console.error("[nav]", name, err); this.busy = false; });
  }
}
