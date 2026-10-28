/**
 * Cena de missão: mapa + simulação (src/sim) + script (src/script via mission/host.ts) + HUD (mission/hud.ts) + inventário
 * (mission/inventory.ts + mission/itemui.ts).
 * Parâmetros: MissionParams { id, resume? } (resume: aplica o save carregado, `state.takeMissionResume`).
 * Ao terminar: MissionResult -> game.go("town", resultado) (ver `leave`).
 * Controles: clique esquerdo move/ataca/seleciona/recolhe saco; Ctrl+clique força ataque; botão direito cancela/arrasta a câmera;
 * WASD/setas/borda da tela rolam; M G C T R (Shift+A/S/D) = comandos; 1–9 e F5–F8 = magias; I ou ` = mochila; H = poção de cura;
 * Espaço = centraliza no herói; P = pausa; [ ] = velocidade; Esc/F10 = menu do jogo; F2 = salvar; F3 = carregar.
 */
import { loadSlotAndGo, openLoadGame } from "../ui/saveui";
import { Container, Graphics, Rectangle, Sprite, Texture, type Text, type FederatedPointerEvent } from "pixi.js";
import { Scene, SCREEN_H, SCREEN_W } from "../core/scene";
import type { HeroState, MissionParams, MissionResult, Settings } from "../core/state";
import type { MissionSave } from "../core/savedata";
import { makeText } from "../ui/text";
import { TICK_MS, TICKS_PER_SEC, type Order, type SimEvent } from "../sim/types";
import type { Unit, World } from "../sim/world";
import type { ScriptRuntime } from "../script";
import { restoreMission, snapshotMission, type MissionUiState } from "../sim/snapshot";
import { openGameMenu, type MissionMenuContext } from "../ui/gamemenu";
import { installGameHotkeys, setMissionMenuContext } from "../ui/hotkeys";
import { modalOpen } from "../ui/modal";
import { ANIM_BASE } from "../mission/anim";
import type { MissionHost } from "../mission/host";
import { Hud, PANEL_X, VIEW_H, VIEW_W, buildDoll, dollLayers, type CommandName, type DollLayer, type InfoText } from "../mission/hud";
import { pickLines } from "../mission/messages";
import { PartyControl, isOwn, partyMembers } from "../mission/party";
import { pickupText, sackAtCell } from "../mission/pickup";
import { WalkThenUse, switchAtCell, type WalkState } from "../mission/interact";
import {
  buildMission, defaultHero, loadMissionData, refreshHero, spawnCompanions, spawnFromTemplate, spellDef, summonFactoryFor, wireOutcome,
  type BuiltMission, type MissionData,
} from "../mission/setup";
import { skillFromExp } from "../sim/stats";
import { MapView, TILE } from "../mission/view";
import { MissionAudio } from "../mission/sound";
import { Fog } from "../mission/fog";
import { HeroInventory } from "../mission/inventory";
import { DOLL_RECT, ItemUi, alphaAt, fmtMoney } from "../mission/itemui";
import { applyAiSettings, attachFollowers, cycleAutocast, installMissionAi } from "../sim/behaviors";
import type { SpellTable } from "../sim/spells";
import { statsFor, type TemplateJson } from "../sim/stats";
import { timingFor } from "../mission/animTiming";
import { partyForMission } from "../campaign/engine";
import { loadCampaignData, recordHallStats } from "../campaign/runtime";

/** Música por missão (não há mapeamento conhecido no jogo; escolha nossa, docs/GAPS.md). */
const MUSIC: Record<number, string> = { 10: "b09" };
/** Borda do mapa que a câmera não mostra (células): na captura do original o herói da missão 10 (célula 11) aparece em x≈110 px,
 *  ou seja, a câmera para 8 células antes da borda (docs/COMPARE/mission10_start.png). */
const CAM_BORDER = 8;
/** Intervalo entre duas poções (tiques da simulação, 1,5 s): não decifrado no exe (docs/GAPS.md). */
const POTION_COOLDOWN = Math.round(1.5 * TICKS_PER_SEC);

type Mode = null | "attack" | "move" | "swarm" | "cast";

/** Efeito temporário de poção de regeneração (aplicado pela cena; volta no save em `MissionUiState.potionFx`). */
interface TimedFx { kind: "healthRegen" | "manaRegen"; perSec: number; until: number; acc: number; }

/** MissionResult + variáveis de cenário alteradas pelo script ("Set variable" de escopo de cenário: host.scenarioVars), para o
 *  motor de campanha aplicar as regras (docs/REQUESTS.md [MOTOR-A]). */
export type MissionResultEx = MissionResult & { scenarioVars?: Record<string, number> };

export default class MissionScene extends Scene {
  private id = 10;
  private data!: MissionData;
  private built!: BuiltMission;
  private world!: World;
  private host!: MissionHost;
  private runtime?: ScriptRuntime;
  private hero!: Unit;
  private heroState!: HeroState;
  /** herói como entrou na missão: volta a ser o do jogo ao falhar/abandonar/reiniciar (só a vitória guarda o que mudou) */
  private startHero!: HeroState;
  private inv!: HeroInventory;
  private itemUi!: ItemUi;
  private view!: MapView;
  private hud!: Hud;
  private audio!: MissionAudio;
  private worldLayer = new Container();
  private cursor = new Sprite(Texture.EMPTY);
  private cursorTex = new Map<string, { tex: Texture[]; w: number; h: number; hx: number; hy: number; delay: number }>();
  private cam = { x: 0, y: 0 };
  private camVel = { x: 0, y: 0 };
  private keys = new Set<string>();
  private acc = 0;
  private paused = false;
  private menuPaused = false;
  private userPaused = false;
  private ended = false;
  private pendingOutcome: { ok: boolean; cause: number } | null = null;
  private result?: MissionResultEx;
  private mode: Mode = null;
  private spell: string | null = null;
  private selected?: Unit;
  /** unidade do jogador que recebe as ordens (a última unidade própria selecionada; o herói por padrão). `selected` pode ser um
   *  inimigo/NPC só para ver o painel (como no original, o painel "Heads" aparece no lugar dos comandos) sem tirar o comando de `active`. */
  private active!: Unit;
  private partyCtl = new PartyControl();
  /** clique numa alavanca: anda até ela e aciona (mission/interact.ts); `switchShown` = estado já desenhado de cada alavanca */
  private useQ = new WalkThenUse();
  private switchShown = new Map<number, boolean>();
  /** unidade mostrada no painel (a sob o cursor ou a selecionada) */
  private infoUnit?: Unit;
  private pointer = { x: SCREEN_W / 2, y: SCREEN_H / 2, inside: false };
  private rdrag: { x: number; y: number; cx: number; cy: number; moved: boolean } | null = null;
  private objectives = new Map<number, number>();
  private subNames = new Map<number, string>();
  private shownMessages: number[] = [];
  /** falas na fila/na tela que o jogador ainda não dispensou (voltam no save: a fila do HUD não é serializável) */
  private pendingMsgs: number[] = [];
  /** variáveis de cenário vindas da campanha ao entrar (o MissionResult leva só as que mudaram) */
  private seedVars = new Map<number, number>();
  private documents = false;
  private portraits = new Map<string, Texture | null>();
  private doll: DollLayer[] = [];
  private dollBuild = 0;
  private cleanup: (() => void)[] = [];
  private loading?: Container;
  private elapsed = 0;
  /** abates para o hall da fama (campaign/hall.ts): inimigos do jogador mortos nesta missão (restaurado do save) */
  private hallKills = 0;
  private ready = false;
  private music = "";
  private resume?: MissionSave;
  private potionReady = 0;
  private potionFx: TimedFx[] = [];
  /** pergaminho em uso: magia temporária `scroll:<item>` na lista do herói até o lançamento começar */
  private scrollCast: { spell: string; item: string } | null = null;
  /** velocidade do jogo: tiques da simulação por tique real (settings.gameSpeed; padrão 1,5 ≈ 30 tiques/s). Teclas [ e ] (0,5–3). */
  private gameSpeed = 1.5;
  private fog!: Fog;
  /** zoom discreto (1 ou 2) */
  private zoom = 1;
  private get vw(): number { return VIEW_W / this.zoom; }
  private get vh(): number { return VIEW_H / this.zoom; }
  private get settings(): Settings { return this.game.state.settings; }

  override async enter(params?: unknown): Promise<void> {
    const p = params as MissionParams | undefined;
    this.id = p?.id || 10;
    this.game.audio.setSfxScope("mission");   // efeitos da missão ficam marcados para serem calados em exit()
    this.heroState = this.game.state.hero ?? defaultHero();
    this.resume = this.game.state.takeMissionResume(this.id);
    this.gameSpeed = this.settings.gameSpeed || 1.5;
    this.startHero = JSON.parse(JSON.stringify(this.heroState)) as HeroState;
    const bg = new Graphics().rect(0, 0, SCREEN_W, SCREEN_H).fill(0x000000);
    const lt = makeText("Loading mission...", { size: 22, color: 0xd8a24a });
    lt.anchor.set(0.5); lt.position.set(SCREEN_W / 2, SCREEN_H / 2);
    this.loading = new Container();
    this.loading.addChild(bg, lt);
    this.root.addChild(this.loading);

    this.data = await loadMissionData(this.game, this.id);
    this.audio = new MissionAudio(this.game, this.data.anim);
    await this.build();
    lt.text = "";
    this.loading.destroy({ children: true });
    this.loading = undefined;
    this.updateMusic();
  }

  private async build(): Promise<void> {
    const built = buildMission(this.data, this.heroState, {
      message: n => this.showMessage(n),
      subobjective: (n, v) => this.setObjective(n, v),
      complete: () => this.endMission(true, 0),
      fail: c => this.endMission(false, c),
      giveAll: (_from, to) => { if (to.isHero) { this.documents = true; this.hud.say("You received Skrakan's documents.", 4000); } },
      money: (p, amount) => { if (p === 1) { this.hero.gold += amount; this.hud.say(`Picked up ${amount} gold`, 3000); this.audio.ui("gold"); } },
      log: (level, msg) => { if (level === "warn") console.warn("[script]", msg); },
    });
    this.built = built;
    this.world = built.world;
    this.host = built.host;
    this.runtime = built.runtime;
    this.hero = built.hero;
    this.selected = this.hero;
    this.active = this.hero;
    // herói morto → falha (depois da animação de morte); VIP morto → falha
    wireOutcome(built, (cause, who) => { if (who === this.hero) setTimeout(() => this.endMission(false, cause), 1200); else this.endMission(false, cause); });
    this.collectSubNames();
    // inventário: game.state.hero é a verdade; Unit.items do herói é o espelho que o script/saques usam
    this.inv = new HeroInventory(this.heroState, this.data);
    this.hero.items = this.inv.mirror();
    this.inv.markSynced(this.hero.items);
    // variáveis de cenário da campanha (data/campaign.json: "Get Scenario Variable" = vars[n]), se o estado de campanha existir
    // (contrato proposto em docs/REQUESTS.md [CAMPANHA→SAVE-LOAD]: progress.campaign.vars); o snapshot de um save as sobrescreve
    const cvars = (this.game.state.progress as { campaign?: { vars?: Record<string, number> } }).campaign?.vars;
    if (cvars) for (const [k, v] of Object.entries(cvars)) if (Number(k) < 752 && typeof v === "number") { this.host.scenarioVars.set(Number(k), v); this.seedVars.set(Number(k), v); }

    // aliados (Igles/Dina/mercenários do motor de campanha) e IA/comportamentos/magias automáticos (sim/behaviors.ts, MOTOR-C):
    // antes do restore de um save (as unidades do grupo entram na mesma ordem, logo depois do herói) e antes da vista carregar
    const party = await this.spawnParty();
    if (party.length) attachFollowers(this.world, this.hero, party);
    installMissionAi(this.world, {
      spells: this.data.spells as SpellTable | undefined, difficulty: this.heroState.difficulty,
      heroSpellIds: (this.heroState.spells ?? []).map(Number).filter(n => n > 0), settings: this.settings,
      summonFactory: summonFactoryFor(this.data),
    });

    this.view = new MapView(this.game, this.data, this.world);
    await this.view.load(s => { if (this.loading) (this.loading.children[1] as Text).text = `Loading ${s}...`; });
    this.view.selectedId = this.hero.id;
    this.fog = new Fog(this.data.map.w, this.data.map.h, this.view.relief);
    this.view.root.addChildAt(this.fog.sprite, this.view.root.getChildIndex(this.view.fx));
    this.view.isVisible = u => u.player === 1 || this.fog.isVisible(u.x, u.y);
    this.view.isCellVisible = (x, y) => this.fog.isVisible(x, y);
    this.fog.update(this.world);

    // camada do mundo recortada à área de jogo
    const mask = new Graphics().rect(0, 0, VIEW_W, VIEW_H).fill(0xffffff);
    this.worldLayer.addChild(this.view.root);
    this.worldLayer.mask = mask;
    const hit = new Graphics().rect(0, 0, VIEW_W, VIEW_H).fill({ color: 0x000000, alpha: 0.001 });
    hit.eventMode = "static";
    hit.on("pointerdown", e => this.onPointerDown(e));
    hit.on("pointerup", e => this.onPointerUp(e));
    hit.on("pointerupoutside", e => this.onPointerUp(e));
    this.root.addChild(new Graphics().rect(0, 0, SCREEN_W, SCREEN_H).fill(0x000000), this.worldLayer, mask, hit);

    this.hud = new Hud(this.game, {
      command: c => this.onCommand(c),
      minimap: (x, y, right) => { if (right) this.orderMove(x, y, false); else this.centerOn(x + 0.5, y + 0.5); },
      resultContinue: () => this.leave(),
      resultExit: () => { this.revertHero(); void this.game.go("menu"); },
      resultLoad: () => { openLoadGame(this.game, this.root, { dim: 0.28, onLoad: slot => loadSlotAndGo(this.game, slot) }); },
      selectSpell: id => this.selectSpell(id),
      dialogDone: () => { this.pendingMsgs = []; /* retoma */ },
      inventory: () => this.toggleInventory(),
      menu: () => this.openMenu(),
      selectUnit: (id, center) => {
        const u = this.world.get(id);
        if (!u || !u.alive) return;
        this.selectUnit(u);
        if (center) this.centerOn(u.x, u.y);
        this.audio.ui("click");
      },
    });
    await this.hud.load();
    this.root.addChild(this.hud.root);
    const map = this.data.map;
    // cor do tile × luz da célula como o minimapa do exe (0x4ab96c: (0x60 − média das 4 luzes)/32, limitado a 255) — frente RELEVO
    this.hud.buildMinimap(map.w, map.h, (x, y) => {
      const c = this.view.tileColor[(map.tiles[y * map.w + x] ?? 0) & 0x1fff] ?? 0x303030, g = this.view.relief.cellGain(x, y);
      const ch = (s: number) => Math.min(255, Math.trunc(((c >> s) & 255) * g));
      return (ch(16) << 16) | (ch(8) << 8) | ch(0);
    });
    this.refreshSpellUi();

    this.itemUi = new ItemUi(this.game, {
      inv: this.inv,
      gold: () => this.totalGold(),
      changed: eq => this.inventoryChanged(eq),
      use: i => this.useItem(i),
      dropItems: ids => this.dropOnGround(ids, 0),
      dropGold: n => this.dropGold(n),
      dollSlotAt: (x, y) => this.dollSlotAt(x, y),
      dollShown: () => this.infoUnit === this.hero,
      heroSelected: () => this.selected === this.hero,
      say: (t, ms) => this.hud.say(t, ms),
      sfx: n => this.audio.ui(n),
      setPaused: on => { this.paused = on; },
    });
    await this.itemUi.load();
    this.hud.invLayer.addChild(this.itemUi.root);
    this.hud.dollLayer.addChild(this.itemUi.dollHit);

    await this.loadCursors();
    await this.buildHeroDoll();
    await Promise.all(this.world.units.filter(u => u.isHero || u.npc).map(u => this.loadPortrait(u)));
    this.root.addChild(this.itemUi.dragLayer);
    this.cursor.eventMode = "none";
    this.root.addChild(this.cursor);
    this.centerOn(this.hero.x, this.hero.y);
    if (this.resume) {
      try { this.applyResume(this.resume); }
      catch (e) { console.error("[missão] save incompatível, começando do início:", e); this.hud.say("The saved game could not be restored; the quest starts over.", 6000); }
      this.resume = undefined;
    }
    this.applySettings();
    this.bindInput();
    setMissionMenuContext(this.menuContext());
    installGameHotkeys(this.game);
    this.ready = true;
    // depuração no console: __mission.world, __mission.hero, __mission.runtime, __mission.inv
    if (import.meta.env.DEV) (window as unknown as { __mission: unknown }).__mission = this;
  }

  private collectSubNames(): void {
    const s = this.runtime?.script;
    if (!s) return;
    for (const a of s.actionList) {
      if (a.kind !== 36) continue;
      const n = a.params[0]?.value ?? 0, v = a.params[1]?.value ?? 0;
      if (v !== 1 || this.subNames.has(n)) continue;
      const m = a.name.match(/\(([^)]+)\)/);
      let label = m ? m[1]! : "";
      if (!label) {
        const t = s.triggers.find(tr => tr.actions.includes(a.seq));
        label = t?.name ?? `Objective ${n}`;
      }
      this.subNames.set(n, label.charAt(0).toUpperCase() + label.slice(1));
    }
  }

  // ------------------------------------------------------------------------------------------- save / menu

  private uiState(): MissionUiState {
    return {
      objectives: [...this.objectives], messages: [...this.shownMessages], documents: this.documents, elapsedMs: this.elapsed, hallKills: this.hallKills,
      cam: { ...this.cam }, zoom: this.zoom, gameSpeed: this.gameSpeed, selected: this.selected?.id, active: this.active.id,
      // extras desta cena: herói da entrada (para Restart/End Quest), névoa explorada, poções em efeito
      startHero: this.startHero, fog: encodeRuns(this.fog.explored), potionReady: this.potionReady, potionFx: this.potionFx,
      // v2: falas pendentes, aliados em retirada (suspensos até a fuga acabar), "andar e usar" alavanca, pergaminho escolhido e não lançado
      pendingMsgs: [...this.pendingMsgs], retreating: this.partyCtl.snapshot(), walk: this.useQ.snapshot(), scrollCast: this.scrollCast,
    };
  }

  private applyResume(s: MissionSave): void {
    // o tipo do sprite do herói depende da arma: se ele trocou de arma depois de entrar, o save tem o herói novo (outro `kind`)
    // e o snapshot o antigo — o `kind` só afeta o desenho, então vale o do build
    const hs = s.world.units.find(u => u.id === this.hero.id);
    if (hs && hs.kind !== this.hero.kind) hs.kind = this.hero.kind;
    const ui = restoreMission(this.built, s);            // lança SnapshotMismatchError se o mapa/herói não casarem
    this.objectives = new Map(ui.objectives); this.shownMessages = [...ui.messages]; this.documents = !!ui.documents;
    this.elapsed = ui.elapsedMs; this.hallKills = Number(ui.hallKills) || 0; this.zoom = ui.zoom || 1; this.cam = { ...ui.cam }; this.clampCam();
    if (ui.gameSpeed) this.gameSpeed = ui.gameSpeed;
    if (ui.startHero) this.startHero = ui.startHero as HeroState;
    if (typeof ui.fog === "string") decodeRuns(ui.fog, this.fog.explored);
    this.potionReady = Number(ui.potionReady) || 0;
    this.potionFx = Array.isArray(ui.potionFx) ? ui.potionFx as TimedFx[] : [];
    this.selected = (ui.selected ? this.world.get(ui.selected) : undefined) ?? this.hero; this.view.selectedId = this.selected.id;
    const act = typeof ui.active === "number" ? this.world.get(ui.active) : undefined;
    this.active = act && act.alive && isOwn(this.hero, act) ? act : isOwn(this.hero, this.selected) && this.selected.alive ? this.selected : this.hero;
    // o herói do save é a verdade do inventário; o espelho da sim é refeito a partir dele
    this.hero.items = this.inv.mirror();
    this.inv.markSynced(this.hero.items);
    this.hud.clearDialog();
    this.pendingMsgs = [];
    this.partyCtl.restore(Array.isArray(ui.retreating) ? ui.retreating as number[] : undefined);
    this.useQ.restore(this.world, ui.walk as WalkState | null | undefined, tag => (tag != null ? this.switchAct(tag) : undefined));
    this.scrollCast = null;                              // a magia temporária voltou na lista do herói pelo snapshot (Unit.spells `scroll:*`)
    const sc = ui.scrollCast as { spell: string; item: string } | null | undefined;
    if (sc && this.hero.spells.some(sp => sp.id === sc.spell)) this.scrollCast = { spell: sc.spell, item: sc.item };
    // falas que estavam na tela/na fila voltam a ser mostradas (sem contar de novo em shownMessages)
    for (const n of Array.isArray(ui.pendingMsgs) ? ui.pendingMsgs as number[] : []) this.queueMessage(n);
    this.fog.update(this.world);
    this.refreshSpellUi();
  }

  private menuContext(): MissionMenuContext {
    return {
      id: this.id, title: this.data.texts?.sections?.briefing?.[0]?.text.split(/\n\s*\n/)[0]?.trim(),
      snapshot: () => snapshotMission(this.id, this.built, this.uiState()),
      objectives: () => this.objectiveLines(),
      restart: () => { this.revertHero(); void this.game.go("mission", { id: this.id } satisfies MissionParams); },
      end: () => { this.result = { id: this.id, outcome: "abort" }; this.leave(); },
      setPaused: on => { this.menuPaused = on; },
      victory: () => this.ended && this.result?.outcome === "complete",
      onVictory: () => this.leave(),
      exit: () => { this.revertHero(); void this.game.go("menu"); },
      onSettingsChanged: st => { this.gameSpeed = st.gameSpeed; this.applySettings(); },
    };
  }

  private openMenu(): void {
    if (modalOpen()) return;
    this.itemUi.cancelDrag();
    openGameMenu(this.game, { parent: this.root, mission: this.menuContext() });
  }

  /**
   * Opções de `state.settings` que valem na missão. HUD: "Show Health" (barras sobre as unidades), "Smoothing" (rolagem da câmera
   * com aceleração), "Game Speed". IA/sim: "Formation Mode"/"Retreat Mode" são lidos pela simulação se ela expuser
   * `World.applySettings(settings)` (frente MOTOR-C; docs/REQUESTS.md) — este é o ponto de leitura.
   */
  private applySettings(): void {
    const st = this.settings;
    this.view.bars.visible = st.showHealth !== false;
    applyAiSettings(this.world, st);
  }

  /** Grupo do herói vindo da campanha (`partyForMission`): mercenários pelo template do estágio (unit-templates.json, typeId =
   *  sprite); Igles/Dina = unidades de script 10002/10003 (templates 10220/10230). */
  private async spawnParty(): Promise<Unit[]> {
    const st = this.game.state.progress.campaign;
    if (!st) return [];
    let party: ReturnType<typeof partyForMission>;
    try { party = partyForMission(st, await loadCampaignData(this.game)); } catch (e) { console.warn("[missão] campanha indisponível:", e); return []; }
    const out: Unit[] = [];
    out.push(...spawnCompanions(this.built, this.data, party.companions.map(c => c.unit)));
    for (const m of party.mercs) {
      const u = spawnFromTemplate(this.built, this.data, m.template);
      if (u) out.push(u); else console.warn(`[missão] sem template ${m.template} para merc ${m.merc}`);
    }
    return out;
  }

  // ------------------------------------------------------------------------------------------- entrada

  private bindInput(): void {
    const canvas = this.game.app.canvas;
    const prevCursor = canvas.style.cursor;
    // o EventSystem do Pixi troca style.cursor por cursorStyles.default/pointer ao passar sobre objetos interativos:
    // na missão o cursor é desenhado pelo jogo, então os dois ficam "none" (restaurados no exit)
    const styles = this.game.app.renderer.events.cursorStyles;
    const prevStyles = { default: styles.default, pointer: styles.pointer };
    styles.default = "none"; styles.pointer = "none";
    canvas.style.cursor = "none";
    const toLocal = (ev: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: (ev.clientX - r.left) * SCREEN_W / r.width, y: (ev.clientY - r.top) * SCREEN_H / r.height };
    };
    const move = (ev: PointerEvent) => {
      const p = toLocal(ev);
      this.pointer.x = p.x; this.pointer.y = p.y;
      this.pointer.inside = p.x >= 0 && p.y >= 0 && p.x < SCREEN_W && p.y < SCREEN_H;
      this.itemUi.pointerMove(p.x, p.y);
      if (this.rdrag) {
        const dx = p.x - this.rdrag.x, dy = p.y - this.rdrag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) this.rdrag.moved = true;
        if (this.rdrag.moved) { this.cam.x = this.rdrag.cx - dx / this.zoom; this.cam.y = this.rdrag.cy - dy / this.zoom; this.clampCam(); }
      }
    };
    const up = (ev: PointerEvent) => { const p = toLocal(ev); this.itemUi.pointerUp(p.x, p.y); };
    const leave = () => { this.pointer.inside = false; };
    const ctx = (e: Event) => e.preventDefault();
    const kd = (e: KeyboardEvent) => this.onKey(e, true);
    const ku = (e: KeyboardEvent) => this.onKey(e, false);
    const blur = () => this.keys.clear();
    const wheel = (e: WheelEvent) => { if (this.pointer.x < PANEL_X && !modalOpen()) { e.preventDefault(); this.setZoom(e.deltaY < 0 ? 2 : 1); } };
    canvas.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    canvas.addEventListener("pointerleave", leave);
    canvas.addEventListener("contextmenu", ctx);
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    window.addEventListener("blur", blur);
    this.cleanup.push(() => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointerleave", leave);
      canvas.removeEventListener("contextmenu", ctx);
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("blur", blur);
      canvas.removeEventListener("wheel", wheel);
      styles.default = prevStyles.default; styles.pointer = prevStyles.pointer;
      canvas.style.cursor = prevCursor;
    });
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    const k = e.key.toLowerCase();
    if (down) this.keys.add(k); else { this.keys.delete(k); return; }
    if (e.repeat || modalOpen()) return;
    if (this.ended) { if (this.hud.resultKeys?.(e)) e.preventDefault(); return; }
    if (k === "escape") {
      e.preventDefault();
      if (this.itemUi.dragging) this.itemUi.cancelDrag();
      else if (this.mode) this.setMode(null);
      else this.openMenu();
      return;
    }
    if (this.hud.dialogOpen) { if (k === " " || k === "enter") { e.preventDefault(); this.hud.nextLine(); } return; }
    if ((e.ctrlKey || e.metaKey) && k === "u") {
      // CTRL+U: nível de magia automática ("Autocasting level N", main.txt)
      e.preventDefault();
      const n = cycleAutocast(this.world);
      this.hud.say(n ? `Autocasting level ${n}` : "Autocasting off");
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // magias: 1–9 = n-ésima magia conhecida; F5–F8 = 1–4 (as teclas F2/F3/F10 são do save/menu, ui/hotkeys.ts)
    const fk = /^f([5-8])$/.exec(k);
    if (/^[1-9]$/.test(k) || fk) {
      if (fk) e.preventDefault();
      const n = fk ? Number(fk[1]) - 4 : Number(k);
      const s = this.knownSpells()[n - 1];
      if (s) this.selectSpell(s.id);
      return;
    }
    switch (k) {
      case "i": case "`": this.toggleInventory(); return;
      case " ": e.preventDefault(); this.centerOn(this.actor.x, this.actor.y); return;
      case "tab": e.preventDefault(); this.cycleParty(e.shiftKey ? -1 : 1); return;
      case "h": this.quickPotion(); return;
      case "[": case "]":
        this.gameSpeed = Math.max(0.5, Math.min(3, this.gameSpeed + (k === "[" ? -0.25 : 0.25)));
        this.settings.gameSpeed = this.gameSpeed; this.game.state.saveSettings();
        this.hud.say(`Game speed ${this.gameSpeed.toFixed(2)}x`);
        return;
      case "f": this.fog.enabled = !this.fog.enabled; this.fog.update(this.world); return;
      case "+": case "=": this.setZoom(2); return;
      case "-": case "_": this.setZoom(1); return;
      // Pause: janela de mensagem "Game paused. Click OK to continue." (refs/original/m10_paused); a simulação para enquanto ela está aberta
      case "p": case "pause": e.preventDefault(); if (!this.hud.dialogOpen) this.hud.queueLines([{ speaker: "", text: "Game paused. Click OK to continue.", plain: true }]); return;
    }
    const cmd = ({ a: "attack", m: "move", g: "guard", d: "defend", c: "cast", s: "swarm", t: "stand", r: "retreat" } as Record<string, CommandName>)[k];
    // WASD também rola a câmera: só vira comando com Shift (a, s, d colidiriam); M, G, C, T, R funcionam direto
    if (cmd && (["m", "g", "c", "t", "r"].includes(k) || e.shiftKey)) this.onCommand(cmd);
  }

  /** unidade que recebe as ordens: a ativa se estiver viva; senão o herói */
  private get actor(): Unit { return this.active.alive && this.active.active ? this.active : this.hero; }

  /** Seleciona uma unidade (painel, retrato, cabeça). Unidade do jogador passa a receber as ordens. */
  private selectUnit(u: Unit): void {
    this.selected = u; this.view.selectedId = u.id;
    if (!isOwn(this.hero, u) || !u.alive || u === this.active) return;
    this.active = u;
    this.setMode(null);
    if (!u.spells.some(s => !s.id.startsWith("scroll:"))) this.hud.toggleSpellbook(false);
    this.refreshSpellUi();
  }

  /** Tab / Shift+Tab: próximo integrante vivo do grupo */
  private cycleParty(dir: number): void {
    const m = partyMembers(this.world, this.hero).filter(u => u.alive);
    if (m.length < 2) return;
    const i = Math.max(0, m.indexOf(this.actor));
    const u = m[(i + dir + m.length) % m.length]!;
    this.selectUnit(u);
    this.centerOn(u.x, u.y);
  }

  /** Ordem do jogador à unidade ativa (aliados também trocam o modo de IA, ver mission/party.ts). */
  private giveOrder(o: Order, u: Unit = this.actor): void { this.partyCtl.order(this.world, u, o); }

  private worldPoint(sx: number, sy: number): { x: number; y: number } { return { x: this.cam.x + sx / this.zoom, y: this.cam.y + sy / this.zoom }; }

  /** Célula do chão sob o ponto da tela, desfazendo o relevo (a célula da frente cobre as de trás, como no desenho). */
  private groundCell(w: { x: number; y: number }): { cx: number; cy: number } {
    const g = this.view.relief.screenToGround(w.x, w.y);
    return { cx: Math.floor(g.x / TILE), cy: Math.floor(g.y / TILE) };
  }

  private onPointerDown(e: FederatedPointerEvent): void {
    if (this.ended || this.hud.overlayOpen || modalOpen()) return;
    if (e.button === 2) { this.rdrag = { x: this.pointer.x, y: this.pointer.y, cx: this.cam.x, cy: this.cam.y, moved: false }; return; }
    if (e.button !== 0) return;
    if (this.hud.dialogOpen) return;
    const local = e.getLocalPosition(this.root);
    const w = this.worldPoint(local.x, local.y);
    const { cx, cy } = this.groundCell(w);
    const target = this.view.pick(w.x, w.y);
    const hostileTo = (u: Unit) => this.world.hostile(u.player, 1) || this.world.hostile(1, u.player);
    const h = this.actor;
    if (!h.active) return;
    switch (this.mode) {
      case "cast": {
        const sp = h.spells.find(s => s.id === this.spell);
        if (!sp) break;
        // alvo pelo `target` da magia (sim/spells.ts): inimigo, amigo (ou o próprio), ponto no chão
        const tgt = sp.target ?? (sp.kind === "heal" ? "friend" : "enemy");
        if (tgt === "point") this.giveOrder({ type: "cast", spell: sp.id, x: cx, y: cy });
        else if (tgt === "friend" || tgt === "self") this.giveOrder({ type: "cast", spell: sp.id, target: (target && !hostileTo(target) ? target : h).id });
        else if (target && target !== h) this.giveOrder({ type: "cast", spell: sp.id, target: target.id });
        else { this.hud.say("Choose a target for the spell"); return; }
        this.audio.ui("click");
        this.setMode(null);
        return;
      }
      case "attack":
        if (target && target !== h) this.giveOrder({ type: "attack", target: target.id, forced: true });
        else this.giveOrder({ type: "move", x: cx, y: cy, attackMove: true });
        this.setMode(null);
        return;
      case "swarm":
        this.giveOrder({ type: "move", x: cx, y: cy, attackMove: true });
        this.setMode(null);
        return;
      case "move":
        this.orderMove(cx, cy, false);
        this.setMode(null);
        return;
    }
    // saco no chão (coroa do xamã, ingrediente, amuleto...): o clique no saco recolhe, mesmo com um bando em volta (mission/pickup.ts)
    if (sackAtCell(this.world, cx, cy, h)) {
      this.selected = h; this.view.selectedId = h.id;
      this.giveOrder({ type: "pickup", x: cx, y: cy });
      this.audio.ui("click");
      return;
    }
    // alavanca (estrutura "Switch" das missões 93-96 e 103): o clique na pegada ou na imagem logo acima anda até ela e a aciona; só um inimigo na frente tem prioridade
    const lever = this.host && (!target || !hostileTo(target)) && !e.ctrlKey ? switchAtCell(this.host, cx, cy) : undefined;
    if (lever !== undefined) { this.useSwitch(lever); return; }
    if (target && target !== h) {
      // unidade do jogador (aliado do grupo): só seleciona; inimigo: ataca com a unidade ativa e mostra o painel dele
      if (isOwn(this.hero, target) && !hostileTo(target) && !e.ctrlKey) { this.selectUnit(target); this.audio.ui("click"); return; }
      if (hostileTo(target) || e.ctrlKey) { this.giveOrder({ type: "attack", target: target.id, forced: e.ctrlKey }); this.audio.ui("click"); }
      this.selected = target; this.view.selectedId = target.id;
      return;
    }
    if (target === h) { this.selectUnit(h); return; }
    if (this.useSignpost(cx, cy)) return;
    this.selected = h; this.view.selectedId = h.id;
    this.orderMove(cx, cy, false);
  }

  /** Ação de ligar/desligar a alavanca `id` (também refeita ao carregar um save com o herói a caminho dela). */
  private switchAct(id: number): (() => void) | undefined {
    const p = this.host.switches.get(id);
    if (!p) return undefined;
    return () => {
      const near = this.host.switchNear(p.x, p.y, 0) ?? id;
      const on = this.host.toggleSwitch(near);
      if (on !== undefined) { this.audio.ui("click"); console.info(`[missão] alavanca ${near} ${on ? "ligada" : "desligada"}`); }
    };
  }

  /** Anda até a alavanca `id` e a liga/desliga ao chegar (`host.toggleSwitch`; o sprite acompanha em `syncSwitches`). */
  private useSwitch(id: number): void {
    const p = this.host.switches.get(id), u = this.actor;
    if (!p) return;
    this.selected = u; this.view.selectedId = u.id;
    const ok = this.useQ.start(this.world, u, p.x, p.y, o => this.giveOrder(o, u), this.switchAct(id)!, id);
    if (ok) this.audio.ui("click"); else this.hud.say("Can't reach that lever", 2000);
  }

  /** Deixa o sprite de cada alavanca no estado do host (ligada = quadro "destruída"); também vale para saves e para o script. */
  private syncSwitches(): void {
    for (const id of this.host.switches.keys()) {
      const on = (this.host.buildingHp.get(id) ?? 0) <= 0;
      if (this.switchShown.get(id) === on || (on === false && !this.switchShown.has(id))) continue;
      this.switchShown.set(id, on);
      this.view.setStructureDead(id, on);
    }
  }

  private onPointerUp(e: FederatedPointerEvent): void {
    if (e.button === 2 && this.rdrag) {
      if (!this.rdrag.moved) {
        // clique direito: cancela modo/seleção
        if (this.mode) this.setMode(null);
        else { this.selected = undefined; this.view.selectedId = 0; }   // original: botão direito desseleciona (HUD "No units selected")
      }
      this.rdrag = null;
    }
  }

  /** Placas clicáveis (signposts do mapa): executam a ação do script associada (ex.: "pointer to tower"). */
  private useSignpost(cx: number, cy: number): boolean {
    const map = this.data.map, rt = this.runtime;
    if (!rt || !map.signposts?.length) return false;
    for (const st of map.structures) {
      const def = this.data.structures[String(st.kind)];
      const x0 = Math.floor(st.x), y0 = Math.floor(st.y);
      const tw = def?.tw ?? 1, th = def?.th ?? 1;
      // a imagem sobe acima da pegada: aceita o clique até 2 células acima
      if (cx < x0 || cx >= x0 + tw || cy < y0 - 2 || cy >= y0 + th) continue;
      const sp = map.signposts.find(p => p.structure === st.id && p.enabled);
      if (!sp) continue;
      const a = sp.action != null ? rt.script.actions.get(sp.action) : rt.script.actionList[sp.actionIndex];
      if (a) { rt.execute(a); this.audio.ui("click"); }
      return true;
    }
    return false;
  }

  /** Música por região (map.music: pontos com raio e tema; tema N -> faixa bNN — mapeamento suposto, docs/GAPS.md). */
  private updateMusic(): void {
    const nodes = this.data.map.music;
    let track = MUSIC[this.id] ?? "b04";
    if (nodes?.length) {
      let best: { d: number; t: number } | null = null;
      for (const n of nodes) {
        const d = Math.hypot(this.hero.cx - n.x, this.hero.cy - n.y);
        const t = n.themes?.[0];
        if (t != null && t >= 0 && d <= n.radius && (!best || d < best.d)) best = { d, t };
      }
      if (best) track = `b${String(best.t).padStart(2, "0")}`;
      else if (this.music) return; // fora de qualquer região: mantém a faixa atual
    }
    if (track !== this.music) { this.music = track; this.game.audio.playMusic(track, { fadeMs: 1500 }); }
  }

  private orderMove(cx: number, cy: number, attackMove: boolean): void {
    const u = this.actor;
    if (!u.active) return;
    const g = this.world.grid;
    let x = Math.max(0, Math.min(g.w - 1, cx)), y = Math.max(0, Math.min(g.h - 1, cy));
    if (!g.walkable(x, y)) { const c = g.nearestFree(x, y, false, 4, u.id); if (c) { x = c.x; y = c.y; } }
    this.giveOrder({ type: "move", x, y, attackMove });
    this.audio.ui("click");
  }

  private setMode(m: Mode): void {
    if (this.mode === "cast" && m !== "cast") {
      this.hud.toggleSpellbook(false);
      // pergaminho escolhido mas não lançado: some a magia temporária (o pergaminho continua na mochila)
      if (this.scrollCast && this.hero.castSpell?.id !== this.scrollCast.spell) this.dropScrollSpell();
    }
    this.mode = m;
    const map: Record<string, CommandName> = { attack: "attack", move: "move", swarm: "swarm", cast: "cast" };
    this.hud.setActiveCommand(m ? map[m]! : null);
    if (m !== "cast") this.hud.setSpells(this.knownSpells(), null);
  }

  private onCommand(c: CommandName): void {
    if (this.ended) return;
    const h = this.actor;
    switch (c) {
      case "attack": this.setMode("attack"); break;
      case "move": this.setMode("move"); break;
      case "swarm": this.setMode("swarm"); break;
      // ordens do original (pedido MOTOR-C): Guard vigia o posto (raio mínimo 8), Stand Ground não sai do lugar, Defend protege a
      // unidade amiga selecionada (ou o herói; um aliado defende o herói), Retreat foge dos inimigos próximos
      case "guard": this.giveOrder({ type: "guard", x: h.cx, y: h.cy }); this.setMode(null); break;
      case "stand": this.giveOrder({ type: "hold" }); this.setMode(null); break;
      case "defend": {
        const sel = this.selected && this.selected !== h && this.selected.alive && this.selected.player === h.player ? this.selected
          : this.selected && this.selected !== h && this.selected.alive && !this.world.hostile(this.selected.player, 1) && !this.world.hostile(1, this.selected.player) ? this.selected
          : h === this.hero ? h : this.hero;
        this.giveOrder({ type: "defend", unit: sel.id, range: 4 }); this.setMode(null);
        break;
      }
      case "cast": {
        const known = this.knownSpells();
        if (!known.length) break;
        this.hud.toggleSpellbook(true);   // o comando Cast abre o livro de magias (como no original)
        this.selectSpell(this.spell && known.some(s => s.id === this.spell) ? this.spell : known[0]!.id);
        break;
      }
      case "retreat": this.giveOrder({ type: "retreat" }); this.setMode(null); break;
    }
  }

  /** magias aprendidas pela unidade ativa (sem as temporárias de pergaminho, que são do herói) */
  private knownSpells(): Unit["spells"] { return this.actor.spells.filter(s => !s.id.startsWith("scroll:")); }

  private refreshSpellUi(): void {
    this.hud.setSpells(this.knownSpells(), this.mode === "cast" ? this.spell : null);
    this.hud.setCommandHidden("cast", !this.knownSpells().length);
  }

  private selectSpell(id: string): void {
    const caster = this.actor;
    const s = caster.spells.find(x => x.id === id);
    if (!s) return;
    if (s.target === "self" || (!s.target && s.kind === "shield")) {
      // "Caster Only" (Escudo etc.): lança direto em quem conjura
      this.giveOrder({ type: "cast", spell: s.id, target: caster.id });
      this.audio.ui("click");
      return;
    }
    this.spell = id;
    this.mode = "cast";
    this.hud.setActiveCommand("cast");
    this.hud.setSpells(this.knownSpells(), id);
    this.hud.say(`${s.name}${s.mana ? ` (${s.mana} mana)` : ""}: click a target`);
  }

  // ------------------------------------------------------------------------------------------- itens

  private totalGold(): number { return (this.heroState.gold ?? 0) + this.hero.gold; }

  private toggleInventory(): void {
    const on = !this.itemUi.open;
    // só o herói tem mochila e equipamento (docs/GAPS.md [MISSÃO-UI-1]): abrir com um aliado selecionado volta ao herói
    if (on && this.selected && this.selected !== this.hero) this.selectUnit(this.hero);   // sem seleção fica assim: a barra mostra "No hero selected" (m20_bag_open)
    this.itemUi.setOpen(on);
    this.hud.setInventoryOpen(on);
    this.audio.ui("click");
  }

  /** Mochila/equipamento mudaram pela interface: recalcula o herói (peso, atributos, magias), o espelho da sim e a boneca. */
  private inventoryChanged(equipment: boolean): void {
    refreshHero(this.hero, this.heroState, this.data);
    this.hero.items = this.inv.mirror();
    this.inv.markSynced(this.hero.items);
    this.refreshSpellUi();
    if (equipment) void this.buildHeroDoll();
    if (this.inv.overloaded()) this.hud.say("You are carrying too much: your speed is reduced", 3000);
  }

  /** Traz para a mochila o que a sim/script deu ao herói (sacos, Give All) e tira o que o script removeu. */
  private syncItems(): void {
    const r = this.inv.absorb(this.hero.items);
    // sempre regrava o espelho: mudanças feitas direto no herói (game.state.hero) também valem para o script
    this.hero.items = r.mirror;
    if (!r.added.length && !r.removed.length) return;
    refreshHero(this.hero, this.heroState, this.data);
    if (r.added.length) {
      const names = [...new Set(r.added)].map(id => { const n = r.added.filter(x => x === id).length; return `${n > 1 ? `${n} ` : ""}${this.inv.name(id)}`; });
      this.hud.say(`Picked up ${names.join(", ")}`, 3500);
    }
  }

  /** Usa a poção/pergaminho da posição i da mochila. */
  private useItem(i: number): void {
    const e = this.heroState.inventory[i];
    if (!e || !this.hero.alive) return;
    const fx = this.inv.useEffect(e.id);
    if (!fx) { this.hud.say("This item cannot be used here"); this.audio.ui("error"); return; }
    if (fx.scroll) { this.useScroll(e.id, fx.scroll.spell, fx.scroll.power); return; }
    if (this.world.tick < this.potionReady) { this.hud.say("You cannot drink another potion yet"); this.audio.ui("error"); return; }
    const h = this.hero;
    let eqChanged = false;
    if (fx.health) { const v = Math.min(fx.health, h.maxHp - Math.ceil(h.hp)); h.hp = Math.min(h.maxHp, h.hp + fx.health); this.view.floatText(h, `+${Math.max(0, v)}`, 0x80ff80); }
    if (fx.mana) { h.mana = Math.min(h.maxMana, h.mana + fx.mana); this.view.floatText(h, `+${fx.mana} mana`, 0x80b0ff); }
    if (fx.attrs) {
      for (const [k, v] of Object.entries(fx.attrs)) this.heroState.stats[k as keyof HeroState["stats"]] += v!;
      this.view.floatText(h, Object.entries(fx.attrs).map(([k, v]) => `${k} +${v}`).join(" "), 0xffd84a);
      eqChanged = true;
    }
    if (fx.timed) {
      const until = this.world.tick + Math.round(fx.timed.seconds * TICKS_PER_SEC);
      if (fx.timed.kind === "absorption") {
        h.buffs = h.buffs.filter(b => b.spell !== "potion");
        h.buffs.push({ kind: "absorption", amount: fx.timed.amount, until, spell: "potion" });
      } else {
        // regeneração: valor/100 pontos por segundo durante a duração (aproximação nossa; docs/GAPS.md)
        this.potionFx = this.potionFx.filter(p => p.kind !== fx.timed!.kind);
        this.potionFx.push({ kind: fx.timed.kind, perSec: fx.timed.amount / 100, until, acc: 0 });
      }
    }
    this.inv.take(i);
    this.potionReady = this.world.tick + POTION_COOLDOWN;
    this.audio.ui("potion");
    this.inventoryChanged(eqChanged);
  }

  /** Pergaminho: lança a magia (poder do item) sem gastar mana; o pergaminho some quando o lançamento começa. */
  private useScroll(item: string, spell: number, power: number): void {
    this.dropScrollSpell();
    this.selectUnit(this.hero);   // mochila e pergaminhos são do herói
    const def = { ...spellDef(spell, this.data.spells?.[String(spell)], power), id: `scroll:${item}`, mana: 0 };
    this.hero.spells.push(def);
    this.scrollCast = { spell: def.id, item };
    this.selectSpell(def.id);
  }

  private dropScrollSpell(): void {
    if (!this.scrollCast) return;
    const id = this.scrollCast.spell;
    this.hero.spells = this.hero.spells.filter(s => s.id !== id);
    this.scrollCast = null;
  }

  /** a cada quadro: consome o pergaminho quando o lançamento começa */
  private checkScroll(): void {
    const sc = this.scrollCast;
    if (!sc || this.hero.castSpell?.id !== sc.spell) return;
    const i = this.heroState.inventory.findIndex(e => e.id === sc.item);
    if (i >= 0) this.inv.take(i);
    this.dropScrollSpell();
    this.inventoryChanged(false);
  }

  /** Poções de regeneração (por tique da simulação). */
  private stepPotionFx(): void {
    if (!this.potionFx.length) return;
    const h = this.hero, t = this.world.tick;
    for (const p of this.potionFx) {
      p.acc += p.perSec / TICKS_PER_SEC;
      const add = Math.floor(p.acc);
      if (add <= 0) continue;
      p.acc -= add;
      if (p.kind === "healthRegen") h.hp = Math.min(h.maxHp, h.hp + add); else h.mana = Math.min(h.maxMana, h.mana + add);
    }
    this.potionFx = this.potionFx.filter(p => p.until > t);
  }

  /** Usa a primeira poção de cura da mochila (tecla H). */
  private quickPotion(): void {
    const i = this.heroState.inventory.findIndex(x => this.inv.useEffect(x.id)?.health);
    if (i < 0) { this.hud.say("No healing potions"); return; }
    this.useItem(i);
  }

  /** Larga itens/ouro num saco na célula do herói (junta com um saco que já esteja ali). */
  private dropOnGround(ids: string[], gold: number): void {
    if (!ids.length && gold <= 0) return;
    const h = this.hero;
    const here = this.world.loot.find(l => l.x === h.cx && l.y === h.cy);
    if (here) { here.items.push(...ids); here.gold += gold; }
    else {
      const w = this.world as unknown as { nextId: number };
      this.world.loot.push({ id: w.nextId++, x: h.cx, y: h.cy, gold, items: [...ids] });
    }
    this.audio.ui("drop");
  }

  /** "Drop money": tira primeiro do ouro recolhido na missão, depois do ouro que o herói trouxe. */
  private dropGold(n: number): void {
    n = Math.min(Math.floor(n), this.totalGold());
    if (n <= 0) return;
    const fromMission = Math.min(n, this.hero.gold);
    this.hero.gold -= fromMission;
    this.world.money[1] = Math.max(0, (this.world.money[1] ?? 0) - fromMission);
    this.heroState.gold -= n - fromMission;
    this.dropOnGround([], n);
    this.hud.say(`Dropped ${fmtMoney(n)} gold`);
  }

  /** slot do item vestido sob o ponto da boneca (teste de alfa por camada, de cima para baixo) */
  private dollSlotAt(x: number, y: number): string | undefined {
    for (let i = this.doll.length - 1; i >= 0; i--) {
      const l = this.doll[i]!;
      if (!l.item) continue;
      if (alphaAt(l.texture, x - l.x, y - l.y) > 127) {
        return Object.keys(this.heroState.equipment).find(s => Number(this.heroState.equipment[s]) === l.item);
      }
    }
    return undefined;
  }

  // ------------------------------------------------------------------------------------------- script

  private npcName(npc: number): string {
    if (npc === 21 || npc === 0) return this.heroState.name;
    const u = this.world.units.find(x => x.npc === npc);
    return u?.name ?? "";
  }

  private portraitKey(u: Unit): string {
    if (u.isHero) return "doll:hero";
    // Igles (10002) e Dina (10003): humanos de corpo nu como o herói, sem InfoPicture: boneca pela face da classe
    if (u.scriptId === 10002) return "doll:igles";
    if (u.scriptId === 10003) return "doll:dina";
    const am = this.data.anim[u.kind];
    return !am?.InfoPicture ? `sprite:${u.kind}` : am.InfoPicture.toLowerCase();
  }

  /** boneca montada → textura de retrato 160×240 */
  private renderDoll(doll: Container): Texture { return this.game.app.renderer.generateTexture({ target: doll, frame: new Rectangle(0, 0, 160, 240) }); }

  /** "Boneca" do herói na moldura oval (graphics/equipment: corpo pela face + itens vestidos + capa), renderizada numa textura
   *  160×240 que também serve de retrato nas mensagens. As camadas ficam guardadas para o arrastar de itens. */
  private async buildHeroDoll(): Promise<void> {
    const ticket = ++this.dollBuild;
    const hs = this.heroState;
    const mage = hs.heroClass === "mage", female = hs.sex === "female";
    const cls = (this.data.classes as { classes?: Record<string, { face?: number }> } | undefined)?.classes?.[`${female ? "female" : "male"}_${mage ? "mage" : "fighter"}`];
    const items = Object.values(hs.equipment ?? {}).map(v => Number(v)).filter(n => Number.isFinite(n) && n > 0);
    const doll = await buildDoll(this.game, { female, mage, face: hs.face || cls?.face || 0, items, hero: true });
    if (!doll || ticket !== this.dollBuild || this.root.destroyed) { doll?.destroy({ children: true }); return; }
    const tex = this.renderDoll(doll);
    this.doll = dollLayers(doll);
    doll.destroy({ children: true });
    const old = this.portraits.get("doll:hero");
    this.portraits.set("doll:hero", tex);
    if (old) setTimeout(() => old.destroy(true), 2000);
  }

  /** Retrato: boneca do herói, bitmap de graphics/infowindow (InfoPicture) ou, sem bitmap, o frame parado de frente do sprite. */
  private async loadPortrait(u: Unit): Promise<void> {
    const key = this.portraitKey(u);
    if (this.portraits.has(key)) return;
    this.portraits.set(key, null);
    const am = this.data.anim[u.kind];
    const sprite = async () => {
      if (!am) return;
      const t = await this.game.data.texture(ANIM_BASE + am.image);
      this.portraits.set(key, new Texture({ source: t.source, frame: new Rectangle(0, 0, am.cellW, am.cellH) }));
    };
    try {
      if (key === "doll:hero") return;
      if (key === "doll:igles" || key === "doll:dina") {
        const mage = key === "doll:dina";
        const cls = (this.data.classes as { classes?: Record<string, { face?: number }> } | undefined)?.classes?.[mage ? "female_mage" : "male_fighter"];
        const doll = await buildDoll(this.game, { female: mage, mage, face: cls?.face ?? 0, items: [], hero: false });
        if (doll && !this.root.destroyed) {
          this.portraits.set(key, this.renderDoll(doll));
          doll.destroy({ children: true });
          return;
        }
        await sprite();
      } else if (key.startsWith("sprite:")) await sprite();
      else {
        // humanos de mercenário não têm bitmap em infowindow: sprite parado
        try { this.portraits.set(key, await this.game.data.texture(`assets/ui/hud/info/${key}.png`)); } catch { await sprite(); }
      }
    } catch { /* sem retrato */ }
  }

  private portraitFor(u: Unit | undefined): Texture | undefined {
    if (!u) return undefined;
    const key = this.portraitKey(u);
    if (!this.portraits.has(key)) void this.loadPortrait(u);
    return this.portraits.get(key) ?? undefined;
  }

  /** Texto do painel de informação: completo para o herói; nome, vida/mana, dano e ataque para as demais (capturas do original). */
  private infoFor(u: Unit): InfoText {
    const st = u.stats;
    const base: InfoText = { name: u.name, hp: u.hp, maxHp: u.maxHp, mana: u.mana, maxMana: u.maxMana, dmg: [st.damage.min, st.damage.max], attack: st.attack };
    if (this.world.hostile(u.player, 1) || this.world.hostile(1, u.player)) base.nameOnly = true;
    if (!u.isHero) return base;
    const hs = this.heroState, mage = !!u.heroInfo?.mage;
    const sx = u.heroInfo?.skillExp ?? {};
    const sk = (k: string) => skillFromExp(sx[k] ?? 0);
    const names = mage ? ["Fire", "Water", "Air", "Earth", "Astral"] : ["Blade", "Axe", "Bludgeon", "Pike", "Shooting"];
    const absorb = st.absorption + u.buffs.filter(b => b.kind === "absorption").reduce((a, b) => a + b.amount, 0);
    base.full = {
      attrs: [["Body", hs.stats.body], ["Agility", hs.stats.agility], ["Mind", hs.stats.mind], ["Spirit", hs.stats.spirit]],
      absorb, defense: st.defense,
      skillsTitle: "Skills", skills: names.map(n => [n, sk(n.toLowerCase())] as [string, number]),
      resist: [["Fire", st.resist.fire], ["Water", st.resist.water], ["Air", st.resist.air], ["Earth", st.resist.earth], ["Astral", st.resist.astral]],
      weight: this.inv.weight() / 10,   // itens guardam o peso em décimos (painel do original: 23.6)
      exp: Object.values(sx).reduce((a, b) => a + b, 0), sight: st.sight, speed: Math.round(st.speed * 16),
    };
    return base;
  }

  private showMessage(n: number): void {
    this.shownMessages.push(n);
    this.queueMessage(n);
  }

  private queueMessage(n: number): void {
    const lines = pickLines(this.data.texts?.sections[`event${n}`], this.heroState);
    if (!lines.length) return;
    this.pendingMsgs.push(n);
    this.audio.ui("message");
    this.hud.queueLines(lines.map(l => {
      const u = l.npc === 21 ? this.hero : this.world.units.find(x => x.npc === l.npc);
      return { speaker: this.npcName(l.npc), text: l.text, portrait: this.portraitFor(u) };
    }));
  }

  /** Subobjetivos: o original não anuncia na tela (aparecem em "Quest Objectives" do menu). */
  private setObjective(n: number, v: number): void { this.objectives.set(n, v); }

  /**
   * Texto da janela "Quest Objectives and Hints:": o original mostra o briefing da missão (título e parágrafo de `#briefing`, refs/original/
   * mission_quest_objectives: "Great Mage Skrakan" / "You must get to Rakhl-Uimoir tower...") e não lista os subobjetivos do script (o da 10,
   * "Find skrakan", não aparece); sem briefing nos dados, cai para os subobjetivos.
   */
  private objectiveLines(): string[] {
    const brief = this.data.texts?.sections?.briefing?.[0]?.text;
    const paras = brief ? brief.split(/\n\s*\n/).map(t => t.replace(/\s+/g, " ").trim()).filter(Boolean) : [];
    if (paras.length) return paras;
    const out: string[] = [];
    for (const [n, v] of [...this.objectives].sort((a, b) => a[0] - b[0])) {
      if (v <= 0) continue;
      out.push(`- ${this.subNames.get(n) ?? `Objective ${n}`}${v === 2 ? " (done)" : ""}`);
    }
    return out;
  }

  private endMission(ok: boolean, cause: number): void {
    if (this.ended || this.pendingOutcome) return;
    this.pendingOutcome = { ok, cause };
  }

  /** Texto de sucesso: o data.bin não tem fala de vitória; a missão 10 (Skrakan) tem frase própria, as demais mostram os objetivos cumpridos. */
  private successText(): string {
    if (this.id === 10) return this.documents ? "Skrakan has handed over the documents. Return to Plagat." : "You have reached Skrakan's tower.";
    const done = [...this.objectives].filter(([, v]) => v === 2).sort((a, b) => a[0] - b[0]).map(([n]) => this.subNames.get(n)).filter((t): t is string => !!t).slice(0, 4);
    return done.length ? ["Mission accomplished.", ...done.map(t => `- ${t}`)].join(String.fromCharCode(10)) : "Mission accomplished.";
  }

  private finish(): void {
    const o = this.pendingOutcome!;
    this.ended = true;
    this.paused = true;
    this.itemUi.cancelDrag();
    const sec = this.data.texts?.sections;
    const failText = o.ok ? "" : (sec?.[`failure${o.cause}`]?.[0]?.text ?? (this.hero.alive ? "Mission failed." : sec?.["failure2"]?.[0]?.text ?? "Your hero has died."));
    const gold = this.hero.gold;
    this.result = { id: this.id, outcome: o.ok ? "complete" : "fail", goldReward: 0, flags: o.ok && this.documents ? { skrakan_documents: 1 } : {} };
    this.audio.ui(o.ok ? "complete" : "failed");
    this.hud.showResult(o.ok, o.ok ? "Mission Completed" : "Mission Failed", o.ok ? this.successText() : failText);
  }

  /** Falha/abandono/reinício: o herói volta a ser o da entrada da missão (itens usados/achados e ouro não contam). */
  private revertHero(): void {
    const st = this.game.state;
    if (!st.hero) return;
    const back = JSON.parse(JSON.stringify(this.startHero)) as HeroState;
    Object.assign(st.hero, back);
    for (const k of Object.keys(st.hero) as (keyof HeroState)[]) if (!(k in back)) delete st.hero[k];
  }

  /**
   * Grava o resultado e volta para a cidade. O que vai no MissionResult (contrato com a TownScene/motor de campanha):
   *   { id, outcome, goldReward: 0, flags, scenarioVars }  — `scenarioVars` = todas as variáveis de cenário que o script gravou
   *   ("Set variable" de escopo de cenário, host.scenarioVars, índice → valor). Sem `unlocks`: a progressão é do motor de campanha.
   * Vitória: o ouro recolhido, a experiência e o inventário já ficam no herói (game.state.hero) e chamamos
   * `state.completeMission(id)` SEM desbloqueios (só marca a missão como cumprida e grava o autosave). Itens de missão (kind "quest",
   * ex.: os documentos de Skrakan) não seguem para a cidade (a entrega vira flag). Falha/abandono: herói da entrada + autosave.
   */
  private leave(): void {
    if (!this.ready) return;
    this.ready = false;   // nada de update() (nem sincronizar itens) depois de sair
    const r: MissionResultEx = { ...(this.result ?? { id: this.id, outcome: "abort" as const }) };
    // variáveis de cenário que o script mudou + subobjetivos em 752+n (campaign/engine.ts V_SUBOBJ)
    const vars: Record<string, number> = Object.fromEntries([...this.host.scenarioVars].filter(([k, v]) => this.seedVars.get(k) !== v).map(([k, v]) => [String(k), v]));
    for (const [n, v] of this.objectives) vars[String(752 + n)] = v;
    r.scenarioVars = vars;
    const st = this.game.state;
    if (st.hero && r.outcome === "complete") {
      this.syncItems();
      st.hero.gold += this.hero.gold;
      st.hero.exp = (st.hero.exp ?? 0) + this.hero.exp;
      if (this.hero.heroInfo) st.hero.skillExp = { ...this.hero.heroInfo.skillExp };
      st.hero.inventory = st.hero.inventory.filter(e => !this.inv.isQuest(e.id));
      // hall da fama: tempo de simulação (ticks do mundo, 20/s; pausas e diálogos não contam) e abates da missão
      const camp = st.progress.campaign;
      if (camp) recordHallStats(camp, this.world.tick * TICK_MS, this.hallKills);
      st.completeMission(r.id, [], r.scenarioVars);
    } else {
      this.revertHero();
      st.save();
    }
    void this.game.go("town", r);
  }

  // ------------------------------------------------------------------------------------------- câmera/cursor

  private setZoom(z: number): void {
    if (z === this.zoom) return;
    const cx = (this.cam.x + this.vw / 2) / TILE, cy = (this.cam.y + this.vh / 2) / TILE;
    this.zoom = z;
    this.centerOn(cx, cy);
  }

  /** Centra a câmera no ponto (células). O exe guarda a vista em células inteiras (canto = célula, desenho em col·32, sem fração):
   *  o canto é arredondado para baixo à célula, como nas capturas do original (missão 10: −16 px em y; missão 20: −8 px em x). */
  private centerOn(cx: number, cy: number): void {
    this.cam.x = Math.floor((cx * TILE - this.vw / 2) / TILE) * TILE;
    this.cam.y = Math.floor((cy * TILE - this.vh / 2) / TILE) * TILE;
    this.clampCam();
  }

  /** a câmera não mostra as CAM_BORDER células da borda do mapa (como o original: vista ≤ largura − 8 − colunas inteiras, exe 0x402fb8) */
  private clampCam(): void {
    const m = this.data.map;
    const b = CAM_BORDER * TILE;
    const maxX = m.w * TILE - b - Math.floor(this.vw / TILE) * TILE, maxY = m.h * TILE - b - Math.floor(this.vh / TILE) * TILE;
    this.cam.x = maxX < b ? (m.w * TILE - this.vw) / 2 : Math.max(b, Math.min(maxX, this.cam.x));
    this.cam.y = maxY < b ? (m.h * TILE - this.vh) / 2 : Math.max(b, Math.min(maxY, this.cam.y));
  }

  private async loadCursors(): Promise<void> {
    const meta = await this.game.data.tryJson<Record<string, { w: number; h: number; frames: number; hx?: number; hy?: number; delay?: number }>>("assets/ui/cursors/cursors.json");
    if (!meta) return;
    await Promise.all(["default", "move", "attack", "swarm", "select", "cast", "pickup", "cantput"].map(async n => {
      const m = meta[n];
      if (!m) return;
      try {
        const base = await this.game.data.texture(`assets/ui/cursors/${n}.png`);
        const tex: Texture[] = [];
        for (let i = 0; i < m.frames; i++) tex.push(new Texture({ source: base.source, frame: new Rectangle(i * m.w, 0, m.w, m.h) }));
        this.cursorTex.set(n, { tex, w: m.w, h: m.h, hx: m.hx ?? 0, hy: m.hy ?? 0, delay: m.delay ?? 100 });
      } catch { /* sem cursor */ }
    }));
  }

  /** O cursor de magia aparece quando o alvo sob o mouse serve à magia escolhida (amigo para cura, inimigo para dano, qualquer ponto para áreas). */
  private castCursorOk(u: Unit | undefined): boolean {
    const sp = this.actor.spells.find(x => x.id === this.spell);
    if (!sp) return true;
    const hostile = !!u && u !== this.actor && (this.world.hostile(u.player, 1) || this.world.hostile(1, u.player));
    switch (sp.target) {
      case "point": return true;
      case "friend": return !!u && !hostile;
      case "enemy": return !!u && hostile;
      default: return !!u;
    }
  }

  private updateCursor(now: number): void {
    const p = this.pointer;
    this.cursor.visible = p.inside;
    if (!p.inside) return;
    let name = "default";
    const overUi = this.hud.overlayOpen || this.hud.dialogOpen || modalOpen() || this.itemUi.dragging || this.itemUi.contains(p.x, p.y)
      || (this.hud.spellbookOpen && p.y >= this.hud.spellbookY);
    if (p.x < PANEL_X && !overUi) {
      const w = this.worldPoint(p.x, p.y);
      const { cx: cellX, cy: cellY } = this.groundCell(w);
      const overSack = !this.mode && !!sackAtCell(this.world, cellX, cellY, this.actor);
      const overLever = !this.mode && !overSack && switchAtCell(this.host, cellX, cellY) !== undefined;
      const u = overSack || overLever ? undefined : this.view.pick(w.x, w.y);
      this.view.hoverId = u?.id ?? 0;
      if (overSack || overLever) name = "pickup";   // sem cursor próprio de alavanca nas notas: a mão de "pegar" (interação)
      else if (this.mode === "cast" && this.castCursorOk(u)) name = "cast";   // só sobre alvo válido; senão o cursor normal (m10m_heal_selected)
      else if (this.mode === "attack") name = "attack";
      else if (this.mode === "swarm") name = "swarm";
      else if (this.mode === "move") name = "move";
      else if (u) name = u !== this.actor && (this.world.hostile(u.player, 1) || this.world.hostile(1, u.player)) ? "attack" : "select";
      else name = "move";   // (o cursor "cantput" é do arrastar de itens, não do terreno intransitável)
    } else this.view.hoverId = 0;
    const c = this.cursorTex.get(name) ?? this.cursorTex.get("default");
    if (!c) { this.cursor.visible = false; return; }
    // quadro pelo tempo de cada cursor (cursors.json `delay`, ms) e ponta no hotspot (hx, hy) que o allods2.exe usa
    this.cursor.texture = c.tex[c.delay > 0 ? Math.floor(now / c.delay) % c.tex.length : 0]!;
    this.cursor.position.set(Math.round(p.x - c.hx), Math.round(p.y - c.hy));
  }

  /** Rolagem por teclado/borda. "Smoothing" ligado: velocidade com aceleração/desaceleração; desligado: passo fixo. */
  private scrollCamera(dtMs: number): void {
    const sp = 0.9;
    let dx = 0, dy = 0;
    const k = this.keys;
    if (!modalOpen() && !this.hud.overlayOpen) {
      if (k.has("arrowleft") || k.has("a")) dx -= 1;
      if (k.has("arrowright") || k.has("d")) dx += 1;
      if (k.has("arrowup") || k.has("w")) dy -= 1;
      if (k.has("arrowdown") || k.has("s")) dy += 1;
      const p = this.pointer;
      if (p.inside && !this.rdrag && !this.itemUi.dragging) {
        if (p.x < 6) dx -= 1; else if (p.x > SCREEN_W - 6) dx += 1;
        if (p.y < 6) dy -= 1; else if (p.y > SCREEN_H - 6) dy += 1;
      }
    }
    dx = Math.sign(dx) * sp; dy = Math.sign(dy) * sp;
    if (this.settings.smoothing) {
      const a = Math.min(1, dtMs / 120);
      this.camVel.x += (dx - this.camVel.x) * a;
      this.camVel.y += (dy - this.camVel.y) * a;
      if (Math.abs(this.camVel.x) < 0.01) this.camVel.x = 0;
      if (Math.abs(this.camVel.y) < 0.01) this.camVel.y = 0;
    } else { this.camVel.x = dx; this.camVel.y = dy; }
    if (this.camVel.x || this.camVel.y) { this.cam.x += this.camVel.x * dtMs; this.cam.y += this.camVel.y * dtMs; this.clampCam(); }
  }

  // ------------------------------------------------------------------------------------------- laço

  override update(dtMs: number): void {
    if (!this.ready) return;
    const now = performance.now();
    this.hud.tick();
    this.partyCtl.step(this.world);
    this.scrollCamera(dtMs);

    // simulação em passo fixo; pausa durante mensagens, menus e no fim
    const running = !this.paused && !this.menuPaused && !this.userPaused && !this.hud.dialogOpen && !this.ended && !modalOpen();
    if (running) {
      this.acc += Math.min(dtMs, 250) * this.gameSpeed;
      this.elapsed += Math.min(dtMs, 250);
      let n = 0;
      while (this.acc >= TICK_MS && n < 12) {
        this.acc -= TICK_MS; n++;
        this.world.step();
        this.runtime?.update(TICK_MS / 1000);
        this.stepPotionFx();
        if (this.hud.dialogOpen || this.pendingOutcome) break;
      }
    }
    this.consumeEvents();
    this.useQ.step(this.world);
    this.syncSwitches();
    this.syncItems();
    this.checkScroll();
    if ((this.world.tick % 40) === 0 && running) this.updateMusic();
    if ((this.world.tick % 6) === 0 && running) { this.fog.update(this.world); }
    if (this.pendingOutcome && !this.hud.dialogOpen && !this.ended) this.finish();

    // apresentação
    this.view.root.scale.set(this.zoom);
    this.view.root.position.set(-Math.round(this.cam.x * this.zoom), -Math.round(this.cam.y * this.zoom));
    this.view.update({ x: this.cam.x, y: this.cam.y, w: this.vw, h: this.vh }, now);
    if ((this.world.tick & 3) === 0 || !running) {
      this.hud.updateMinimapFog(this.fog.explored, !this.fog.enabled);
      this.hud.updateMinimap(this.world, { x: this.cam.x, y: this.cam.y, w: this.vw, h: this.vh }, u => this.view.isVisible(u));
      // morte da unidade ativa: o comando volta ao herói; selecionada morta: volta à ativa
      const wasActive = this.active;
      if (this.actor !== this.active) { this.active = this.actor; this.refreshSpellUi(); }
      // sem seleção (botão direito, como no original): o painel mostra "No units selected"; selecionada morta volta à ativa
      const sel = !this.selected ? undefined : this.selected.alive || this.selected === this.hero ? this.selected : this.active;
      if (sel !== this.selected) { this.selected = sel; this.view.selectedId = sel?.id ?? 0; }
      if (wasActive !== this.active) this.setMode(null);
      this.hud.setParty(partyMembers(this.world, this.hero).map(u => ({
        id: u.id, name: u.name, hp: u.hp, maxHp: u.maxHp, alive: u.alive, portrait: this.portraitFor(u),
      })), this.active.id);
      // como no original: com o cursor sobre uma unidade, o painel mostra ela (retrato e texto); senão a selecionada
      const hov = this.view.hoverId ? this.world.get(this.view.hoverId) : undefined;
      const show = hov && hov.alive && !this.itemUi.dragging ? hov : sel;
      this.infoUnit = show;
      this.hud.showInfo(show ? this.infoFor(show) : undefined, this.portraitFor(show), !!show && show.player === this.hero.player);
    }
    this.itemUi.update(this.pointer.x, this.pointer.y, this.pointer.inside, now);
    this.hud.updateHint(this.pointer.x, this.pointer.y, this.pointer.inside, this.itemUi.hintLines(this.pointer.x, this.pointer.y, this.pointer.inside));
    this.updateCursor(now);
  }

  private consumeEvents(): void {
    const ev = this.world.events;
    if (!ev.length) return;
    for (const e of ev) this.onEvent(e);
    ev.length = 0;
  }

  private onEvent(e: SimEvent): void {
    const w = this.world;
    switch (e.type) {
      case "hit": {
        const t = w.get(e.target);
        if (t) this.view.floatText(t, String(e.amount), t.isHero ? 0xff6060 : 0xffe080);
        if (t) this.audio.hit(t, w.get(e.unit), this.cam);
        break;
      }
      case "miss": { const t = w.get(e.target); if (t && (t.isHero || w.get(e.unit)?.isHero)) this.view.floatText(t, "miss", 0xc0c0c0); break; }
      case "attack": { const u = w.get(e.unit); if (u) this.audio.attack(u, this.cam); break; }
      case "death": { const u = w.get(e.unit); if (u && u.player !== this.hero.player && w.hostile(this.hero.player, u.player)) this.hallKills++; if (u) this.audio.death(u, this.cam); if (this.selected === u) this.selected = this.actor; break; }
      case "heal": { const u = w.get(e.unit); if (u) this.view.floatText(u, `+${e.amount}`, 0x80ff80); break; }
      case "exp": break;
      case "levelup": { const u = w.get(e.unit); if (u) this.view.floatText(u, "Skill up!", 0xffd84a); break; }
      case "buff": { const u = w.get(e.unit); if (u) this.view.floatText(u, `Shield +${e.amount}`, 0x9fd0ff); break; }
      case "pickup": {
        const u = w.get(e.unit);
        // ouro recolhido por um aliado vai para o herói (só ele conta no resultado e na mochila)
        if (u && e.gold && u !== this.hero && isOwn(this.hero, u)) { u.gold = Math.max(0, u.gold - e.gold); this.hero.gold += e.gold; }
        if (u && e.gold) { this.view.floatText(u, `+${e.gold} gold`, 0xffd84a); this.audio.ui("gold"); }
        // aviso do que foi recolhido (ouro e/ou itens, ex.: a coroa da missão 80) para o herói e os aliados
        if (u && isOwn(this.hero, u)) {
          const msg = pickupText(e, id => this.data.items?.[id]?.name ?? `item ${id}`);
          if (msg) this.hud.say(msg, 3000);
        }
        break;
      }
      case "message": this.hud.say(e.text); break;
      case "cast": { const u = w.get(e.unit); if (u) this.audio.cast(u, this.cam, e.spell); break; }
      case "diplomacy":
        if (e.b === 1 && e.value === 1) {
          const p = this.data.map.players.find(pl => pl.id === e.a);
          console.info(`[missão] ${p?.name ?? e.a} agora é hostil`);
        }
        break;
    }
  }

  override exit(): void {
    setMissionMenuContext(undefined);
    for (const f of this.cleanup) f();
    this.cleanup = [];
    // saída da missão por qualquer caminho (vitória, derrota, End Quest, Restart, carregar save): nada da missão continua
    // sobre a cidade/menu — música (com fade curto), falas e efeitos em andamento ou ainda carregando
    const au = this.game.audio;
    au.stopMusic(300);
    au.stopSpeech();
    au.stopSfxScope("mission");
  }
}

// ------------------------------------------------------------------ névoa explorada no save (RLE: "n0,n1,n0,n1,...")

function encodeRuns(a: Uint8Array): string {
  const out: number[] = [];
  let cur = 0, run = 0;
  for (let i = 0; i < a.length; i++) {
    const v = a[i] ? 1 : 0;
    if (v === cur) run++; else { out.push(run); cur = v; run = 1; }
  }
  out.push(run);
  return out.join(",");
}

function decodeRuns(s: string, into: Uint8Array): void {
  let i = 0, v = 0;
  for (const part of s.split(",")) {
    const n = Number(part) || 0;
    if (v) into.fill(1, i, Math.min(into.length, i + n));
    i += n; v ^= 1;
  }
}
