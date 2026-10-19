import { Container, Graphics, Sprite, Texture } from "pixi.js";
import { Scene } from "../core/scene";
import { makeText } from "../ui/text";
import { Nav, Texts, ensureHero, loadStrip, loadTex, loadTexOr, onKey, safeEnter, spr, type StripInfo } from "../town/common";
import type { Game } from "../core/game";
import { warm, warmTextures } from "../ui/prefetch";
import { buildPatrons, patronSprites, type Patron } from "../town/patrons";
import { Voices } from "../town/voices";
import type { Line } from "../town/common";
import { campaignCtx, townDef, type CampaignCtx } from "../campaign/runtime";
import { mercTemplate, stageOf, talkTo, toggleHire } from "../campaign/engine";
import { syncLegacy } from "../campaign/progress";
import { frame640, type Frame640 } from "../ui/frame640";
import { openGameMenuIn } from "../ui/gamemenu";
import { drawHeroSheet } from "../ui/herosheet";
import { showTipWindow, tipsEnabled, type TipWindow } from "../ui/tipwin";
import { showTalk, type TalkWindow } from "../ui/talkwin";
import type { TemplateJson } from "../sim/stats";

const BASE = "assets/ui/inn/";
const STATIC = ["left_picture", "left_stats", "center", "buttons_area", "card_man", "card_quest", "btn1_off", "btn1_on", "btn2_off", "btn2_on", "btn3_off", "btn3_on"];

/** Pré-carrega a taverna em segundo plano (a animação "drink", a maior, só depois que a cena aparece). */
export async function prefetch(game: Game): Promise<void> {
  const meta = await game.data.tryJson<InnMeta>(BASE + "inn.json");
  if (!meta) return;
  await Promise.all(["data/texts/town.json", "data/texts/npcnames.json", "data/texts/main.json", BASE + "voices.json"].map(p => game.data.tryJson(p)));
  await warmTextures(game, [...STATIC.map(n => `${BASE}${n}.webp`), ...Object.entries(meta.anims).filter(([n]) => n !== "drink").map(([, a]) => BASE + "anim/" + a.strip),
    ...patronSprites().map(n => `${BASE}units/${n}_0.webp`)]);
}

interface InnMeta { anims: Record<string, { x: number; y: number } & StripInfo> }
interface Loop { sprite: Sprite; frames: Texture[]; t: number; fps: number; pos: number }

/** Ficha do herói/frequentador em unit-templates.json (campos usados pela taverna). */
interface UnitTpl extends TemplateJson {
  attributes?: { body: number; reaction: number; mind: number; spirit: number };
  skills?: Record<string, number>;
  female?: boolean; face?: number; mage?: boolean; equipment?: Array<{ id: number }>;
}

/**
 * Taverna (Plagat, Kaarg, acampamento): tela 640×480 do original (ui/frame640.ts) SEM título, ouro nem rótulos inventados.
 *   estatísticas do frequentador (em cima à esquerda, ficha font2)   |  taverneiro animado  |  botões [Hire/Fire] Talk Exit (em cima à direita)
 *   retrato do frequentador (embaixo à esquerda, boneca na moldura oval) | cartões embaixo no centro | retrato do herói (embaixo à direita)
 * O 1º frequentador já vem selecionado; o selecionado aparece iluminado e os demais escurecidos. Talk abre a janela de conversa
 * (ui/talkwin.ts) falante a falante; a dica abre numa janela própria (ui/tipwin.ts).
 */
export default class InnScene extends Scene {
  private texts!: Texts;
  private voices!: Voices;
  private patrons: Patron[] = [];
  private sel = -1;
  private talked = new Set<number>();
  private loops: Loop[] = [];
  /** Kaarg: faixas tocadas por roteiro medido no original (quadro por tick) */
  private scripted: { sprite: Sprite; frames: Texture[]; script: number[] }[] = [];
  private scriptTickMs = 100;
  private scriptT = 0;
  /** taverneiro: parado no quadro 0 (= drink[0]) e, de tempos em tempos, toca UMA vez o `breath` (24 quadros) ou o `drink` (40 quadros, ida e volta), a 12 quadros/s (original: 150 quadros a cada 100 ms) */
  private breath?: { sprite: Sprite; breath: Texture[]; drink: Texture[]; t: number; mode: "idle" | "breath" | "drink"; pos: number; wait: number };
  private frame!: Frame640;
  private cards: Array<{ unit?: Sprite }> = [];
  private unitTex = new Map<string, Texture>();
  private tpls: Record<string, UnitTpl> = {};
  private stats = new Container();
  private patronDoll = new Container();
  private btnLabels: ReturnType<typeof makeText>[] = [];
  private btnSprites: Sprite[] = [];
  private btnTex: Array<{ on: Texture; off: Texture }> = [];
  private removeKey?: () => void;
  private modal?: Container;
  private talk?: TalkWindow;
  private tip?: TipWindow;
  private dollKey = "";
  private itemWeights: Record<string, { weight?: number }> = {};
  private skillExp: number[] = [];
  private spellDefs: Record<string, { damage?: { min: number; max: number } | null }> = {};

  private nav = new Nav(this.game);
  private ctx!: CampaignCtx;
  private townId = 1;

  override async enter(params?: unknown): Promise<void> {
    await safeEnter(this.game, this.root, "inn", () => this.build(params), "town");
    warm(this.game, ["briefing", "town"]);
  }

  private async build(params?: unknown): Promise<void> {
    const game = this.game;
    const hero = ensureHero(game);
    this.ctx = await campaignCtx(game);
    const asked = (params as { town?: unknown } | undefined)?.town;
    this.townId = typeof asked === "number" ? asked : this.ctx.st.lastTown;
    const town = townDef(this.ctx.data, this.townId);
    game.audio.playMusic(town.music);
    [this.texts, this.voices] = await Promise.all([Texts.load(game), Voices.load(game)]);
    this.patrons = buildPatrons(game, this.texts, this.ctx.st, this.ctx.data, this.townId);
    const meta = await game.data.getJson<InnMeta>(BASE + "inn.json");
    // Kaarg / acampamento: centro e taverneiro próprios (assets/ui/inn/<cidade>/, tools/pipeline/town.py)
    const VAR = town.art === "base" ? undefined : `${BASE}${town.key}/`;
    const vmeta = VAR ? await game.data.tryJson<InnMeta>(VAR + "inn.json") : undefined;
    const L = (n: string) => loadTexOr(game, `${BASE}${n}.webp`);
    const A = meta.anims;
    const [leftPic, leftStats, center, btnArea, cardMan, cardQuest, eyeT, ldover, luover, ruover, tav09, gl0, gl1, gr0, gr1, ...rest] = await Promise.all([
      L("left_picture"), L("left_stats"), VAR ? loadTexOr(game, VAR + "center.webp") : L("center"), L("buttons_area"), L("card_man"), L("card_quest"),
      L("eye"), L("edge_ldover"), L("edge_luover"), L("edge_ruover"), L("edge_tav_09"), L("gem_lbuttonoff"), L("gem_lbuttonon"), L("gem_rbuttonoff"), L("gem_rbuttonon"),
      ...[1, 2, 3].flatMap(i => [L(`btn${i}_off`), L(`btn${i}_on`)]),
    ]);
    for (let i = 0; i < 3; i++) this.btnTex.push({ off: rest[i * 2], on: rest[i * 2 + 1] });
    // animações (faixas); "drink" é a maior e só é buscada depois, em segundo plano
    const [breathF, candleF, cauldronF] = VAR ? [[Texture.EMPTY], [Texture.EMPTY], [Texture.EMPTY]]
      : await Promise.all([loadStrip(game, BASE + "anim/", A.breath), loadStrip(game, BASE + "anim/", A.candle), loadStrip(game, BASE + "anim/", A.cauldron)]);
    const varAnims = vmeta ? await Promise.all(Object.values(vmeta.anims).map(async a => ({ a, f: await loadStrip(game, VAR + "anim/", a) }))) : [];
    // retratos dos cartões (só o quadro 0 de cada sprite), retrato de conversa do herói e fichas das unidades
    const tplFile = game.data.tryJson<Record<string, UnitTpl>>("data/unit-templates.json");
    const [itemsJ, classesJ] = await Promise.all([game.data.tryJson<Record<string, { weight?: number }>>("data/items.json"), game.data.tryJson<{ skillExpTable?: number[] }>("data/classes.json")]);
    this.itemWeights = itemsJ ?? {}; this.skillExp = classesJ?.skillExpTable ?? [];
    this.spellDefs = (await game.data.tryJson<InnScene["spellDefs"]>("data/spells.json")) ?? {};
    await Promise.all([...this.patrons.map(p => this.unit(p.sprite)), this.unit(hero.heroClass === "mage" ? "heromage" : "herofighter")]);
    this.tpls = (await tplFile) ?? {};

    const view = (this.frame = frame640(this.root));
    // left_stats = painel retangular das estatísticas (160×238); left_picture = moldura oval do retrato (160×242)
    view.addChild(spr(leftStats, 0, 0), spr(leftPic, 0, 238), spr(center, 160, 0), spr(btnArea, 480, 0), spr(leftPic, 480, 238));

    // animações da taverna
    const script = VAR && town.key === "kaarg" ? await game.data.tryJson<{ tick_ms: number; strips: Record<string, number[]> }>(VAR + "anim_script.json") : undefined;
    if (VAR && script) {
      // Kaarg: o taverneiro tem 5 faixas sobrepostas (corpo, olhos, mão, cabeça) que o original toca em ritmos próprios, com pausas em alguns
      // quadros: repetimos a coreografia medida em 30 s do original (anim_script.json: quadro de cada faixa a cada 100 ms), em laço
      const names = Object.keys(vmeta!.anims);
      varAnims.forEach(({ a, f }, i) => {
        const sc = script.strips[names[i]!];
        if (!sc) return;
        const sp = spr(f[0], 160 + a.x, a.y);
        view.addChild(sp);
        this.scripted.push({ sprite: sp, frames: f, script: sc });
      });
      this.scriptTickMs = script.tick_ms;
    } else if (VAR) {
      // acampamento: a sequência principal de cada grupo (taverneiro, gota d'água) em laço, sobre o centro próprio
      for (const { a, f } of varAnims) {
        if ((a as { seq?: number }).seq) continue;
        const s = spr(f[0], 160 + a.x, a.y);
        view.addChild(s);
        this.loops.push({ sprite: s, frames: [...f], t: 0, fps: 10, pos: 0 });
      }
    } else {
      // sequência de 150 quadros a cada 100 ms do original (scratch/cap2/c_inn, 19/10): vela = quadros 0..8 e caldeirão = 0..19 em laço, a 10 quadros/s;
      // o ÚLTIMO quadro de cada faixa (9 e 20) nunca é mostrado
      for (const [name, f, fps, n] of [["candle", candleF, 10, 9], ["cauldron", cauldronF, 10, 20]] as const) {
        const s = spr(f[0], 160 + A[name].x, A[name].y);
        view.addChild(s);
        this.loops.push({ sprite: s, frames: f.slice(0, n), t: 0, fps, pos: 0 });
      }
      const bs = spr(breathF[0], 160 + A.breath.x, A.breath.y);
      view.addChild(bs);
      this.breath = { sprite: bs, breath: breathF, drink: [], t: 0, mode: "idle", pos: 0, wait: 1 + Math.random() * 3 };
      void loadStrip(game, BASE + "anim/", A.drink).then(f => { if (this.breath && !this.root.destroyed && f.length > 1) {
        // a faixa "drink" termina numa pose diferente da primeira (diferença ~10 contra ~1,3 entre quadros vizinhos: pegar a caneca e não
        // soltá-la): tocar só para a frente fazia o taverneiro "pular" de volta ao quadro 0 do "breath". Vai e volta (ping-pong) → ciclo contínuo.
        this.breath.drink = [...f, ...f.slice(0, -1).reverse()];
      }
    });
    }

    // ornamentos das bordas do centro, olho (Switch to Picture/Stats) e gemas dos cantos da moldura do herói (posições medidas em inn_default.png)
    view.addChild(spr(ldover, 160, 238), spr(luover, 160, 0), spr(ruover, 464, 0), spr(tav09, 464, 238), spr(eyeT, 608, 242));
    for (const [off, on, x] of [[gl0, gl1, 476], [gr0, gr1, 598]] as const) {
      const g = spr(off, x, 446);
      g.eventMode = "static"; g.cursor = "pointer";
      g.on("pointerover", () => { g.texture = on; }).on("pointerout", () => { g.texture = off; });
      view.addChild(g);
    }

    // fichas e retratos (bonecas): esquerda = frequentador selecionado, direita = o herói
    view.addChild(this.stats, this.patronDoll);
    this.patronDoll.position.set(11, 240);
    void this.heroDoll(view);

    // cartões dos frequentadores: 48×64 a partir de x=176, passo 48 (medido em inn_default.png); selecionado claro, demais escurecidos
    const n = this.patrons.length;
    const step = n > 6 ? Math.floor(288 / n) : 48;
    for (let i = 0; i < n; i++) {
      const p = this.patrons[i];
      const card = new Container();
      card.position.set(176 + i * step, 416);
      card.addChild(spr(p.kind === "merc" ? cardMan : cardQuest));
      const ut = this.unitTex.get(p.sprite);
      let u: Sprite | undefined;
      if (ut) { u = spr(ut, 0, 0); u.position.set(Math.round((48 - ut.width) / 2), Math.round((64 - ut.height) / 2)); card.addChild(u); }
      this.cards.push({ unit: u });
      card.eventMode = "static"; card.cursor = "pointer";
      card.on("pointertap", () => { if (!this.modal && !this.talk && !this.tip) this.select(i); });
      view.addChild(card);
    }

    // botões: como no original [Hire/Fire (só mercenário)], Talk, Exit — falar com quem oferece já põe a missão no mapa
    const labels = ["", "Talk", this.texts.label(73, "Exit")];
    for (let i = 0; i < 3; i++) {
      const y = 44 + i * 47;                 // medido pixel a pixel em inn_default.png: x 484 (não 490), passo 47 (não 48)
      const s = spr(this.btnTex[i].off, 484, y);
      // as 3 cavidades aparecem sempre (a 1ª vazia quando não há Hire/Fire); com o mouse em cima o botão acende
      s.eventMode = "static"; s.cursor = "pointer";
      // original (inn_hover_* / inn_press_*, 19/10): sob o mouse só o rótulo acende (amarelo 0xffff73); a placa só muda (bitmap `on`) com o botão apertado
      const lit = (on: boolean) => { this.btnLabels[i].tint = on ? 0xffff73 : 0xbd9e4a; };
      s.on("pointerover", () => { if (this.btnLabels[i].text) lit(true); })
        .on("pointerout", () => { s.texture = this.btnTex[i].off; lit(false); })
        .on("pointerdown", () => { if (this.btnLabels[i].text) { s.texture = this.btnTex[i].on; lit(true); } })
        .on("pointerup", () => { s.texture = this.btnTex[i].off; });
      s.on("pointertap", () => { if (!this.modal && !this.talk && !this.tip) this.press(i); });
      view.addChild(s);
      this.btnSprites.push(s);
      const t = makeText(labels[i], { font: "font4", bold: true, color: 0xffffff, shadow: true });
      t.tint = 0xbd9e4a;   // cor medida em inn_hover_card3 (185,155,72 com a sombra)
      t.anchor.set(0.5);
      t.position.set(484 + 70, y + 22);   // 3 px mais baixo que o palpite anterior (medido)
      t.eventMode = "none";
      view.addChild(t);
      this.btnLabels.push(t);
    }

    this.removeKey = onKey(e => {
      if (e.key === "Escape") { if (!this.talk && !this.tip) this.toggleMenu(); }
      else if ((e.key === " " || e.key === "Enter") && this.patron && !this.modal && !this.talk && !this.tip) { e.preventDefault(); this.press(1); }
    });
    this.select(this.patrons.length ? 0 : -1);           // o original já seleciona o 1º frequentador
    this.openTip();
  }

  /** Janela de dica ao entrar (ver ui/tipwin.ts; cenários de captura usam `openTip`/`closeTip`). */
  openTip(): void {
    if (!this.frame || this.tip || !tipsEnabled()) return;
    const text = this.texts.tip(2);
    if (!text) return;
    this.tip = showTipWindow(this.frame, { text, x: 159, y: 0, onClose: () => { this.tip = undefined; } });
  }
  closeTip(): void { this.tip?.close(); }

  private toggleMenu(): void {
    if (this.modal) { this.modal.destroy({ children: true }); this.modal = undefined; return; }
    this.modal = openGameMenuIn(this.game, this.root, () => { this.modal = undefined; });
  }

  private async unit(name: string): Promise<Texture | undefined> {
    if (this.unitTex.has(name)) return this.unitTex.get(name);
    try { const t = await loadTex(this.game, `${BASE}units/${name}_0.webp`); this.unitTex.set(name, t); return t; } catch { return undefined; }
  }

  private get patron(): Patron | undefined { return this.sel >= 0 ? this.patrons[this.sel] : undefined; }

  /** Retrato do herói (moldura oval embaixo à direita): a mesma boneca da missão (mission/hud.ts buildDoll). */
  private async heroDoll(view: Container): Promise<void> {
    const hero = ensureHero(this.game);
    try {
      const { buildDoll } = await import("../mission/hud");
      const items = Object.values(hero.equipment ?? {}).map(v => Number(v)).filter(v => Number.isFinite(v) && v > 0);
      const doll = await buildDoll(this.game, { female: hero.sex === "female", mage: hero.heroClass === "mage", face: hero.face, items, hero: true });
      if (!doll || this.root.destroyed) { doll?.destroy({ children: true }); return; }
      doll.position.set(480, 240);
      view.addChildAt(doll, view.children.indexOf(this.stats));
    } catch (err) { console.warn("[taverna] retrato do herói indisponível:", (err as Error)?.message ?? err); }
  }

  /** Ficha (unit-templates.json) de um frequentador: mercenário = template do estágio; os demais = o próprio npc. */
  private tplOf(p: Patron): UnitTpl | undefined {
    const id = p.kind === "merc" && p.src.merc ? mercTemplate(this.ctx.data, p.src.merc, stageOf(this.ctx.st)) : this.ctx.data.npcs[String(p.npc)]?.serverId ?? p.npc;
    return this.tpls[String(id)];
  }

  private drawStats(p: Patron | undefined): void {
    this.stats.removeChildren().forEach(o => o.destroy({ children: true }));
    const t = p ? this.tplOf(p) : undefined;
    if (!p) {
      // sem frequentador escolhido (taverna vazia ou nada selecionado): "No units selected" no painel verde, como o painel da missão e a tela do Multiplayer
      // (refs/original/dr_inn.png, 19/10: font2 dourada, centrada em x=88, linhas em y=53 e 65)
      for (const [i, fb] of [[47, "No units"], [48, "selected"]] as const) {
        const tx = makeText(this.texts.label(i, fb).toUpperCase(), { font: "font2", color: 0xbd9e4a });
        tx.anchor.set(0.5, 0); tx.position.set(88, 53 + 12 * (i - 47));
        this.stats.addChild(tx);
      }
      return;
    }
    if (!t) return;
    const L = (i: number, fb: string) => this.texts.label(i, fb);
    const mage = !!t.mage;
    const at = t.attributes ?? { body: 0, reaction: 0, mind: 0, spirit: 0 };
    const sk = t.skills ?? {}, rs = t.resist ?? {};
    const skillKeys = mage ? ["fire", "water", "air", "earth", "astral"] : ["blade", "axe", "bludgeon", "pike", "shooting"];
    // Igles e Dina (npc 22/23, "heróis" do grupo) mostram a ficha completa (com WEIGHT e XP) sob o próprio nome; os demais, "Mercenary" + tipo
    const hero = p.npc === 22 || p.npc === 23;
    const weight = (t.equipment ?? []).reduce((a, e) => a + (this.itemWeights[String(e.id)]?.weight ?? 0), 0) / 10;
    const xp = skillKeys.reduce((a, k) => a + ((sk[k] ?? 0) > 0 ? this.skillExp[sk[k]!] ?? Math.floor((Math.pow(1.1, sk[k]!) - 1) * 1000) : 0), 0);
    drawHeroSheet(this.stats, {
      name: hero ? p.name : "Mercenary",
      inn: hero ? undefined : { name2: t.name ?? "", hideAttack: mage, footer: mage ? this.texts.label(190, "spellcaster") : undefined },
      labels: {
        attrs: [L(15, "Body"), L(16, "Agility"), L(17, "Mind"), L(18, "Spirit")], health: L(19, "Health"), mana: L(20, "Mana"), dmg: L(23, "Dmg"), absorb: L(24, "Absorb"),
        attack: L(25, "Attack"), defense: L(26, "Defense"), skills: L(27, "Skills"), resistance: L(28, "Resistance"),
        skillNames: (mage ? [36, 37, 38, 39, 40] : [30, 31, 32, 33, 34]).map(i => L(i, "")), resistNames: [41, 42, 43, 44, 45].map(i => L(i, "")),
        weight: L(35, "Weight"), xp: L(46, "XP"), sight: L(21, "Sight"), speed: L(22, "Speed"),
      },
      attrs: [at.body, at.reaction, at.mind, at.spirit],
      health: [t.health ?? 0, t.health ?? 0], mana: [t.mana ?? 0, t.mana ?? 0],
      damage: mage ? this.mageDamage(t) : [t.damage?.min ?? 0, t.damage?.max ?? 0], absorb: t.absorption ?? 0, attack: t.attack ?? 0, defense: t.defense ?? 0,
      skills: skillKeys.map(k => sk[k] ?? 0), resists: ["fire", "water", "air", "earth", "astral"].map(k => rs[k] ?? 0),
      weight, xp, sight: (t.sight ?? 0) - 0.001, speed: t.speed ?? 0,   // o original trunca (6.4 aparece 6.3)
    });
  }

  /**
   * "Dmg" de um mago na ficha da taverna = dano do projétil básico da escola do ataque (Fire Arrow, Ice Missile, Lightning, Stone Missile)
   * com poder = nível da habilidade: int(min × k)..int(max × k), k = poder/30 + 1 (a mesma regra de sim/spells.ts buildSpell).
   * Conferido em refs/original/inn_messenger.png: mago de Plagat, Air 99 → Lightning 5-10 × 4,3 = 21-43 (o `damage` 1-2 do template é o cajado).
   */
  private mageDamage(t: UnitTpl): [number, number] {
    const BOLT: Record<string, number> = { fire: 1, water: 5, air: 10, earth: 16 };
    const school = String((t as { attackSkill?: string }).attackSkill ?? "air");
    const skill = t.skills?.[school] ?? 0;
    const sp = this.spellDefs[String(BOLT[school] ?? 10)]?.damage;
    if (!sp) return [t.damage?.min ?? 0, t.damage?.max ?? 0];
    const k = skill / 30 + 1;
    return [Math.floor(sp.min * k + 1e-9), Math.floor(sp.max * k + 1e-9)];
  }

  private async drawPatronDoll(p: Patron | undefined): Promise<void> {
    const key = p ? String(p.npc) + ":" + p.kind : "";
    this.dollKey = key;
    this.patronDoll.removeChildren().forEach(o => o.destroy({ children: true }));
    const t = p ? this.tplOf(p) : undefined;
    if (!p || !t) return;
    try {
      const { buildDoll } = await import("../mission/hud");
      const items = (t.equipment ?? []).map(e => e.id);
      const doll = await buildDoll(this.game, { female: !!t.female, mage: !!t.mage, face: t.face ?? 0, items, hero: false });
      if (!doll || this.dollKey !== key || this.patronDoll.destroyed) { doll?.destroy({ children: true }); return; }
      this.patronDoll.addChild(doll);
    } catch (err) { console.warn("[taverna] retrato indisponível:", (err as Error)?.message ?? err); }
  }

  private select(i: number): void {
    this.game.audio.stopSpeech();
    this.sel = i;
    const p = this.patron;
    this.cards.forEach((c, k) => { if (c.unit) c.unit.tint = k === i ? 0xffffff : 0x808080; });
    this.drawStats(p);
    void this.drawPatronDoll(p);
    this.refreshButtons();
  }

  /** Contratado para a próxima missão (bit 31 do código da taverna = vars[512+n-1]). */
  private hired(p: Patron): boolean { return !!p.src.merc && !!this.ctx.st.vars[String(511 + p.src.merc)]; }

  private refreshButtons(): void {
    const p = this.patron;
    const hire = p?.kind === "merc" ? (this.hired(p) ? this.texts.label(259, "Fire") : this.texts.label(258, "Hire")) : "";
    this.btnLabels[0].text = hire;
    this.btnLabels[1].text = "Talk";
    this.btnLabels[1].alpha = p ? 1 : 0.5;
  }

  private save(): void {
    syncLegacy(this.game.state.progress, this.ctx.data);
    this.game.state.save();
  }

  /** Retrato da janela de conversa: o alto da boneca (cabeça e tronco) recortado em 76×100 — o herói (npc 21) ou o npc da linha. */
  private async speakerPortrait(npc: number): Promise<Container | undefined> {
    const hero = ensureHero(this.game);
    let opts: { female: boolean; mage: boolean; face: number; items: number[]; hero: boolean } | undefined;
    if (npc === 21) {
      opts = { female: hero.sex === "female", mage: hero.heroClass === "mage", face: hero.face, hero: true,
        items: Object.values(hero.equipment ?? {}).map(v => Number(v)).filter(v => Number.isFinite(v) && v > 0) };
    } else {
      const p = this.patrons.find(q => q.npc === npc) ?? this.patron;
      const t = this.tpls[String(this.ctx.data.npcs[String(npc)]?.serverId ?? npc)] ?? (p ? this.tplOf(p) : undefined);
      if (t) opts = { female: !!t.female, mage: !!t.mage, face: t.face ?? 0, items: (t.equipment ?? []).map(e => e.id), hero: false };
    }
    if (!opts) return undefined;
    try {
      const { buildDoll } = await import("../mission/hud");
      const doll = await buildDoll(this.game, opts);
      if (!doll) return undefined;
      const c = new Container();
      doll.position.set(-42, -10);
      const m = new Graphics().rect(0, 0, 76, 100).fill(0xffffff);
      c.addChild(doll, m);
      c.mask = m;
      return c;
    } catch { return undefined; }
  }

  /** Mostra a conversa fala a fala, cada uma numa janela com "Ok"; `done` roda depois da última. */
  private converse(sec: string, lines: Line[], done?: () => void): void {
    const g = this.game, hero = ensureHero(g);
    let i = 0;
    const show = async () => {
      const l = lines[i];
      const portrait = await this.speakerPortrait(l.npc);
      if (this.root.destroyed) return;
      this.talk = showTalk(this.frame, {
        text: l.text, portrait: portrait ?? this.unitTex.get(this.patron?.sprite ?? ""),
        onOk: () => { g.audio.stopSpeech(); this.talk = undefined; i++; if (i < lines.length) void show(); else done?.(); },
      });
      void this.voices.say(g, sec, l, hero);
    };
    void show();
  }

  private press(i: number): void {
    const g = this.game, hero = ensureHero(g);
    const p = this.patron;
    if (i === 2) { this.nav.go("town", { town: this.townId }); return; }
    if (!p) return;
    if (i === 1) {
      const lines = p.talk ? this.texts.pick(p.talk, hero) : [];
      // ScenarioTalkTo: quem oferece missão já a põe no mapa; efeitos de conversa (portão de Plagat, mercenários...)
      if (!this.talked.has(p.npc)) {
        const r = talkTo(this.ctx.st, this.ctx.data, p.src);
        if (r.addedMission || r.effects || r.joined.length) this.save();
      }
      this.talked.add(p.npc);
      if (lines.length && p.talk) this.converse(p.talk, lines);
      return;
    }
    if (i === 0 && p.kind === "merc" && p.src.merc) {
      // contratar/dispensar (grátis); quem foi na última missão recusa (npc<n>reject<estágio>) [exe 0x49b812]
      const r = toggleHire(this.ctx.st, this.ctx.data, p.src.merc);
      const sec = r.textKey;
      this.save();
      this.refreshButtons();
      if (sec) {
        const lines = this.texts.pick(sec, hero).filter(l => l.npc !== 21).slice(0, 1);
        if (lines.length) this.converse(sec, lines);
      }
    }
  }

  override update(dtMs: number): void {
    const dt = dtMs / 1000;
    if (this.scripted.length) {
      this.scriptT += dtMs;
      const tick = Math.floor(this.scriptT / this.scriptTickMs);
      for (const sc of this.scripted) sc.sprite.texture = sc.frames[sc.script[tick % sc.script.length] ?? 0] ?? sc.frames[0]!;
    }
    for (const l of this.loops) {
      l.t += dt;
      while (l.t >= 1 / l.fps) { l.t -= 1 / l.fps; l.pos = (l.pos + 1) % l.frames.length; }
      l.sprite.texture = l.frames[l.pos];
    }
    const b = this.breath;
    if (b) {
      b.t += dt;
      if (b.mode === "idle") {
        b.wait -= dt;
        b.t = 0;
        if (b.wait <= 0) { b.mode = b.drink.length && Math.random() < 0.5 ? "drink" : "breath"; b.pos = 0; }
      }
      while (b.mode !== "idle" && b.t >= 1 / 12) {
        b.t -= 1 / 12;
        b.pos++;
        const n = (b.mode === "drink" ? b.drink : b.breath).length;
        if (b.pos >= n) { b.mode = "idle"; b.pos = 0; b.wait = 2 + Math.random() * 4; }
      }
      const f = b.mode === "drink" ? b.drink : b.breath;
      b.sprite.texture = b.mode === "idle" ? (b.drink[0] ?? b.breath[0]) : f[Math.min(b.pos, f.length - 1)];
    }
  }

  override exit(): void {
    this.removeKey?.();
    this.talk?.close();
    this.tip?.close();
    this.game.audio.stopSpeech();
  }
}

