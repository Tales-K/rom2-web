/**
 * Cena de missão: mapa + simulação (src/sim) + script (src/script via mission/host.ts) + HUD (mission/hud.ts) + inventário
 * (mission/inventory.ts + mission/itemui.ts).
 * Parâmetros: MissionParams { id, resume? } (resume: aplica o save carregado, `state.takeMissionResume`).
 * Ao terminar: MissionResult -> game.go("town", resultado) (ver `leave`).
 * Controles: clique esquerdo move/ataca/seleciona/recolhe saco; Alt+clique força mover, Ctrl+clique força ataque/enxame, Shift+clique
 * inclui/retira da seleção; botão direito cancela/arrasta a câmera; setas/borda da tela rolam. TODAS as teclas vêm do registro único
 * ui/hotkeymap.ts (README do original: M A G D C S T R P L E, grupos Ctrl+1..9, F4..F12, Ctrl+O/H/L/W/F/N/U/C, Keypad+/−, Tab, Espaço, Q/B, I,
 * F1 ajuda, F2 salvar, F3 carregar, Esc menu); `runHotkey` as traduz em efeitos. Extras: Pause (pausa), [ ] (velocidade), = − (zoom), Home, H, F.
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
import { clickKind, matchHotkey, type HotkeyHit, type HotkeyId } from "../ui/hotkeymap";
import { ANIM_BASE } from "../mission/anim";
import type { MissionHost } from "../mission/host";
import { Hud, PANEL_X, VIEW_H, VIEW_W, buildDoll, dollLayers, type CommandName, type DollLayer, type InfoText } from "../mission/hud";
import { pickLines } from "../mission/messages";
import { PartyControl, isOwn, partyMembers } from "../mission/party";
import { PickupAllQueue, pickupText, sackAtCell } from "../mission/pickup";
import { GroupBook, SelectionSet, centroid, spreadTargets } from "../mission/selection";
import { OPTION_MSG_MS, applyOptionKey, type OptionKey } from "../mission/optionkeys";
import { SPEED_MSG_BASE, SPEED_NORMAL, SPEED_TEXT, migrateSpeedFactor, speedFactor, speedLevel, stepSpeed } from "../mission/gamespeed";
import { normalizeQuick, setQuick, type QuickKind } from "../mission/quickkeys";
import { WalkThenUse, switchAtCell, type WalkState } from "../mission/interact";
import {
  buildMission, defaultHero, loadMissionData, refreshHero, spawnCompanions, spawnFromTemplate, spellDef, summonFactoryFor, wireOutcome,
  type BuiltMission, type MissionData,
} from "../mission/setup";
import { skillFromExp } from "../sim/stats";
import { portraitKeyFor, templateDoll } from "../mission/portraitrules";
import { MapView, TILE } from "../mission/view";
import { MissionAudio } from "../mission/sound";
import { MissionAmbience, ambientHour } from "../mission/ambient";
import { VIEW_CELLS_H, VIEW_CELLS_W } from "../core/sounds";
import type { VoiceCmd } from "../core/sounds";
import { Fog } from "../mission/fog";
import { HeroInventory } from "../mission/inventory";
import { DOLL_RECT, ItemUi, alphaAt, fmtMoney } from "../mission/itemui";
import { applyAiSettings, attachFollowers, cycleAutocast, installMissionAi } from "../sim/behaviors";
import { SPELL, type SpellTable } from "../sim/spells";
import { toggleChosenSpell } from "../sim/spellattack";
import { statsFor, type TemplateJson } from "../sim/stats";
import { timingFor } from "../mission/animTiming";
import { partyForMission } from "../campaign/engine";
import { loadCampaignData, recordHallStats } from "../campaign/runtime";
import { ConsoleInput, execConsoleLine, findTemplate, heroProtCap, reapplyGod, type ConsoleHost } from "../mission/console";
import { ConsoleLog } from "../ui/consolelog";

/** Música por missão (não há mapeamento conhecido no jogo; escolha nossa, docs/GAPS.md). */
const MUSIC: Record<number, string> = { 10: "b09" };
/** Borda do mapa que a câmera não mostra (células): na captura do original o herói da missão 10 (célula 11) aparece em x≈110 px,
 *  ou seja, a câmera para 8 células antes da borda (docs/COMPARE/mission10_start.png). */
const CAM_BORDER = 8;
/** Intervalo entre duas poções (tiques da simulação, 1,5 s): não decifrado no exe (docs/GAPS.md). */
const POTION_COOLDOWN = Math.round(1.5 * TICKS_PER_SEC);

type Mode = null | "attack" | "move" | "swarm" | "cast";
/** comandos da barra (hud) + "Stand still" (tecla L, sem botão no original) */
type ScCommand = CommandName | "still";

/** Efeito temporário de poção de regeneração (aplicado pela cena; volta no save em `MissionUiState.potionFx`). */
interface TimedFx { kind: "healthRegen" | "manaRegen"; perSec: number; until: number; acc: number; }

/** MissionResult + variáveis de cenário alteradas pelo script ("Set variable" de escopo de cenário: host.scenarioVars), para o
 *  motor de campanha aplicar as regras (docs/REQUESTS.md [MOTOR-A]). */
export type MissionResultEx = MissionResult & { scenarioVars?: Record<string, number> };

let qaInstCounter = 0;   // nº de instâncias da cena (fuzzer: detectar recarga/reinício)

export default class MissionScene extends Scene {
  private readonly qaInst = ++qaInstCounter;
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
  /** rio/fogo em laço e sons de ambiente 600..658 (mission/ambient.ts; exe 0x41b311) */
  private ambience?: MissionAmbience;
  private worldLayer = new Container();
  private cursor = new Sprite(Texture.EMPTY);
  private cursorTex = new Map<string, { tex: Texture[]; w: number; h: number; hx: number; hy: number; delay: number }>();
  private cam = { x: 0, y: 0 };
  private camVel = { x: 0, y: 0 };
  private keys = new Set<string>();
  /** console de mensagens (Enter) e trapaças `#...` (mission/console.ts, notes/cheats.md) */
  private readonly consoleIn = new ConsoleInput();
  private consoleLog = new ConsoleLog();
  private consoleHostObj?: ConsoleHost;
  private mainLines?: string[];
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
  /** grupos de seleção Ctrl+1..9 (máscara por unidade; mission/selection.ts) e unidades do jogador selecionadas além da ativa (Shift+clique, grupos, E) */
  private readonly groups = new GroupBook();
  private readonly extra = new SelectionSet();
  /** tecla P: o herói recolhe os sacos próximos, um depois do outro */
  private readonly pickupAll = new PickupAllQueue();
  /** clique numa alavanca: anda até ela e aciona (mission/interact.ts); `switchShown` = estado já desenhado de cada alavanca */
  private useQ = new WalkThenUse();
  private switchShown = new Map<number, boolean>();
  /** unidade mostrada no painel (a sob o cursor ou a selecionada) */
  private infoUnit?: Unit;
  private pointer = { x: SCREEN_W / 2, y: SCREEN_H / 2, inside: false };
  private rdrag: { x: number; y: number; cx: number; cy: number; moved: boolean } | null = null;
  /** botão esquerdo apertado: clique (age ao SOLTAR, se não arrastou) ou caixa de seleção (arrastou > 4 px; original: retângulo branco de
   *  1 px do ponto apertado ao cursor, e ao soltar as unidades do jogador dentro dele ficam selecionadas — sonda na missão 30, 28/10) */
  private ldrag: { x: number; y: number; local: { x: number; y: number }; ck: ReturnType<typeof clickKind>; ctrl: boolean; shift: boolean; moved: boolean } | null = null;
  private readonly selBox = new Graphics();
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
  /** velocidade do jogo: tiques da simulação por tique real (settings.gameSpeed; padrão = nível 4 "Normal" = 1,0081 ≈ 16,13 tiques/s, como o original; 9 níveis, Keypad+/Keypad- ou [ ], mission/gamespeed.ts). */
  private gameSpeed = speedFactor(SPEED_NORMAL);
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
    this.gameSpeed = migrateSpeedFactor(this.settings.gameSpeed) || speedFactor(SPEED_NORMAL);
    this.startHero = JSON.parse(JSON.stringify(this.heroState)) as HeroState;
    const bg = new Graphics().rect(0, 0, SCREEN_W, SCREEN_H).fill(0x000000);
    const lt = makeText("Loading mission...", { size: 22, color: 0xd8a24a });
    lt.anchor.set(0.5); lt.position.set(SCREEN_W / 2, SCREEN_H / 2);
    this.loading = new Container();
    this.loading.addChild(bg, lt);
    this.root.addChild(this.loading);

    this.data = await loadMissionData(this.game, this.id);
    this.audio = new MissionAudio(this.game, this.data.anim);
    if (this.data.objectSound) this.ambience = new MissionAmbience(this.data.map, this.data.objectSound, { audio: this.game.audio, rand: Math.random, now: () => performance.now() });
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
      money: (p, amount) => { if (p === 1) { this.hero.gold += amount; this.hud.say(`Picked up ${amount} gold`, 3000); } },   // sem som no original
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
    hit.on("pointermove", e => this.onPointerMove(e));
    hit.on("pointerupoutside", e => this.onPointerUp(e));
    this.selBox.eventMode = "none";
    this.root.addChild(new Graphics().rect(0, 0, SCREEN_W, SCREEN_H).fill(0x000000), this.worldLayer, mask, hit, this.selBox);

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
        this.voice(u, "select");   // original: só a voz de seleção (0x417f24), sem clique
      },
    });
    await this.hud.load();
    this.root.addChild(this.hud.root);
    this.root.addChild(this.consoleLog.view);
    this.mainLines = (await this.game.data.tryJson<{ lines: string[] }>("data/texts/main.json"))?.lines;
    if (/(^#|[#&?])debug=cheats(&|$)/.test(location.hash) && !this.settings.cheats) { this.settings.cheats = true; this.game.state.saveSettings(); }
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
    const qaHook = import.meta.env.DEV ? (window as unknown as { __qa?: { freezeNext?: boolean } }).__qa : undefined;
    if (qaHook?.freezeNext) { qaHook.freezeNext = false; this.userPaused = true; }   // fuzzer: compara o estado carregado antes de despausar
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
      groups: this.groups.snapshot(), extra: [...this.extra.list],
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
    if (ui.gameSpeed) this.gameSpeed = migrateSpeedFactor(ui.gameSpeed);
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
    this.groups.load(ui.groups);
    this.setExtra(Array.isArray(ui.extra) ? (ui.extra as unknown[]).filter((n): n is number => typeof n === "number") : []);
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
    this.consoleLog.altColors = st.altColors === true;
    applyAiSettings(this.world, st);
  }

  /** Grupo do herói vindo da campanha (`partyForMission`): mercenários pelo template do estágio (unit-templates.json, typeId =
   *  sprite); Igles/Dina = unidades de script 10002/10003 (templates 10220/10230). */
  private async spawnParty(): Promise<Unit[]> {
    const st = this.game.state.progress.campaign;
    if (!st) return [];
    let party: ReturnType<typeof partyForMission>;
    let cdata: Awaited<ReturnType<typeof loadCampaignData>>;
    try { cdata = await loadCampaignData(this.game); party = partyForMission(st, cdata); } catch (e) { console.warn("[missão] campanha indisponível:", e); return []; }
    const out: Unit[] = [];
    out.push(...spawnCompanions(this.built, this.data, party.companions.map(c => c.unit)));
    for (const m of party.mercs) {
      // nome = npcnames.txt[n-1] ("Mercenary"), como no painel da taverna: a unidade do mercenário nasce com id n e as mesmas
      // flags das da taverna (exe 0x4f3916; painel 0x494ec1: flags & 0x11 -> npcnames[id-1]) — notes/inn-npcs.md [est]
      const u = spawnFromTemplate(this.built, this.data, m.template, { name: cdata.npcs[String(m.merc)]?.innTitle?.[0] || "Mercenary" });
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
    // console aberto: todas as teclas vão para a linha de entrada (não rolam a câmera nem viram atalhos)
    if (down && this.consoleIn.open && !modalOpen() && !this.ended) { this.consoleKey(e); return; }
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
    // ÚNICO ponto de entrada das teclas da missão: registro ui/hotkeymap.ts (F1/F2/F3/F10 são globais: ui/hotkeys.ts)
    const hit = matchHotkey(e, "mission");
    if (hit && hit.def.scope === "mission") this.runHotkey(hit, e);
  }

  /** Efeito de cada atalho do registro (`HotkeyId`). Teclas só de multiplayer (W, Ctrl+K, Ctrl+T) não fazem nada no jogo de um jogador, como no original. */
  private runHotkey(hit: HotkeyHit, e: KeyboardEvent): void {
    const stop = (): void => e.preventDefault();
    const known = this.knownSpells().length > 0;
    switch (hit.id) {
      case "console": if (this.consoleKey(e)) return; return;
      case "autocastMode": {
        // CTRL+U: modo de magia automática; mensagens do original ("Autocasting is set to minimum/average/maximum", medido) e o modo
        // vai para as opções (Game Options mostra o mesmo, e reaplicar as opções não desfaz o ciclo)
        stop();
        const mode = (["off", "min", "avg", "max"] as const)[cycleAutocast(this.world)] ?? "off";
        if (mode !== "off") { this.settings.autoCastMode = mode; this.game.state.saveSettings(); }
        this.note(`Autocasting is set to ${({ off: "off", min: "minimum", avg: "average", max: "maximum" })[mode]}`);
        return;
      }
      case "chooseAttackSpell": stop(); this.chooseAttackSpell(); return;   // CTRL+A sobre uma célula do livro (original: exe 0x4c74b1)
      case "smoothing": case "showHealth": case "flyingDamage": case "retreatMode": case "formationMode": case "dayNight": case "messageColors":
        stop(); this.optionKey(hit.id); return;
      case "questLog": case "playerNames": case "netStats": stop(); return;   // só multiplayer
      case "inventory": this.toggleInventory(); return;
      case "spellbook": if (known) this.hud.toggleSpellbook(); return;
      case "panels": stop(); this.togglePanels(); return;
      case "infoMode": stop(); this.hud.toggleInfoMode(); return;
      case "pause": stop(); if (!this.hud.dialogOpen) this.hud.queueLines([{ speaker: "", text: "Game paused. Click OK to continue.", plain: true }]); return;   // refs/original/m10_paused
      case "speedUp": case "speedDown": stop(); this.changeSpeed(hit.id === "speedUp" ? 1 : -1); return;
      case "clearMessages": stop(); this.consoleLog.clear(); return;
      case "move": this.onCommand("move"); return;
      case "attack": this.onCommand("attack"); return;
      case "swarm": this.onCommand("swarm"); return;
      case "cast": this.onCommand("cast"); return;
      case "guard": this.onCommand("guard"); return;
      case "defend": this.onCommand("defend"); return;
      case "stand": this.onCommand("stand"); return;
      case "retreat": this.onCommand("retreat"); return;
      case "still": this.onCommand("still"); return;
      case "pickupAll": stop(); this.pickupAllSacks(); return;
      case "selectMercs": stop(); this.selectAllParty(); return;
      case "groupSave": case "groupSaveMulti": stop(); this.saveGroup(hit.arg ?? 1, hit.id === "groupSaveMulti"); return;
      case "groupRestore": case "groupCenter": case "groupAdd": stop(); this.restoreGroup(hit.arg ?? 1, hit.id === "groupAdd", hit.id === "groupCenter"); return;
      case "quickSetSpell": stop(); this.quickSet("spell", hit.arg ?? 0); return;
      case "quickSetItem": stop(); this.quickSet("item", hit.arg ?? 0); return;
      case "quickUse": stop(); this.quickUse(hit.arg ?? 0); return;
      case "centerHero": stop(); this.centerOn(this.actor.x, this.actor.y); return;
      case "zoomIn": this.setZoom(2); return;
      case "zoomOut": this.setZoom(1); return;
      case "quickPotion": this.quickPotion(); return;
      case "toggleFog": this.fog.enabled = !this.fog.enabled; this.fog.update(this.world); return;
      default: return;
    }
  }

  /** Mensagem do console (canto superior esquerdo), como as do original: sistema = branco (rosa com "Alt. message colors"). */
  private note(text: string, ms = OPTION_MSG_MS): void {
    this.consoleLog.push(text, "system", ms);
  }

  /** Ctrl+O/H/L/W/F/N/C: muda o campo de `state.settings` que a janela Game Options mostra e aplica na hora (mission/optionkeys.ts). */
  private optionKey(id: HotkeyId): void {
    const keyOf: Partial<Record<HotkeyId, OptionKey>> = {
      smoothing: "smoothing", showHealth: "showHealth", flyingDamage: "flyingDamage", retreatMode: "retreatMode", formationMode: "formationMode",
      dayNight: "dayNight", messageColors: "messageColors",
    };
    const text = applyOptionKey(keyOf[id]!, this.settings, this.mainLines);
    this.consoleLog.altColors = this.settings.altColors === true;
    this.game.state.saveSettings();
    this.applySettings();
    this.note(text);
  }

  /** Keypad+ / Keypad−: um nível de velocidade (0..8, normal 4): "Game Speed is ..." no console (nos limites: o texto do nível atual por 5 s). */
  private changeSpeed(dir: 1 | -1): void {
    const r = stepSpeed(this.gameSpeed, dir);
    this.gameSpeed = r.factor;
    this.settings.gameSpeed = r.factor;
    this.game.state.saveSettings();
    const text = this.mainLines?.[SPEED_MSG_BASE + r.level] || SPEED_TEXT[r.level]!;
    this.note(text, r.changed ? undefined : 5000);
  }

  /** P: o herói selecionado recolhe os sacos próximos, um depois do outro (mission/pickup.ts PickupAllQueue; exe 0x419f2a: só unidades de herói). */
  private pickupAllSacks(): void {
    const h = this.hero;
    if (!h.alive || !h.active || !this.selectedOwn().includes(h)) return;
    const n = this.pickupAll.start(this.world, h, o => this.partyCtl.order(this.world, h, o));
    if (n) this.voice(h, "pickup");
  }

  /** Ctrl+F4..F12 (magia sob o ponteiro no livro aberto) e Shift+F4..F12 (item sob o ponteiro na mochila aberta): grava o atalho no personagem. */
  private quickSet(kind: QuickKind, slot: number): void {
    let id: string | undefined;
    if (kind === "spell") {
      const s = this.hud.spellbookOpen ? this.hud.spellAt(this.pointer.x, this.pointer.y) : undefined;
      if (s && this.knownSpells().some(x => x.id === s)) id = s;
    } else if (this.itemUi.open) id = this.itemUi.itemAt(this.pointer.x, this.pointer.y)?.id;
    if (!id) return;
    this.heroState.quickKeys = setQuick(this.heroState.quickKeys ?? [], slot, kind, id);
  }

  /** F4..F12: escolhe a magia do atalho (como clicar nela no livro) ou usa o item do atalho (poção/pergaminho/equipar). */
  private quickUse(slot: number): void {
    const s = normalizeQuick(this.heroState.quickKeys)[slot];
    if (!s) return;
    if (s.kind === "spell") { if (this.knownSpells().some(x => x.id === s.id)) this.selectSpell(s.id); return; }
    const i = this.heroState.inventory.findIndex(e => e.id === s.id);
    if (i >= 0 && this.hero.alive) this.itemUi.activate(i);
  }

  /** Espaço: abre mochila e livro juntos; com algum aberto, fecha os que estão abertos (exe 0x40cd6e). */
  private togglePanels(): void {
    const inv = this.itemUi.open, book = this.hud.spellbookOpen;
    if (!inv && !book) {
      this.toggleInventory();
      if (this.knownSpells().length) this.hud.toggleSpellbook(true);
    } else {
      if (inv) this.toggleInventory();
      if (book) this.hud.toggleSpellbook(false);
    }
  }

  /** Tecla para o console (Enter abre/envia). Devolve se a tecla foi do console. */
  private consoleKey(e: KeyboardEvent): boolean {
    const r = this.consoleIn.key(e, () => [this.heroState.name]);
    if (r === undefined) return false;
    e.preventDefault();
    if (r) execConsoleLine(this.consoleHost(), r);
    this.consoleLog.setInput(this.consoleIn.open, this.consoleIn.text);
    return true;
  }

  /** Ponte do console (mission/console.ts) com a cena: ouro/itens/magias no herói, névoa, vitória, falas, invocação. */
  private consoleHost(): ConsoleHost {
    if (this.consoleHostObj) return this.consoleHostObj;
    const heroChanged = () => { refreshHero(this.hero, this.heroState, this.data); reapplyGod(this.hero); this.refreshSpellUi(); };
    this.consoleHostObj = {
      world: this.world,
      hero: this.hero,
      playerName: this.heroState.name,
      mainLines: this.mainLines,
      cheats: () => this.settings.cheats === true,
      setCheats: on => { this.settings.cheats = on; this.game.state.saveSettings(); },
      message: t => this.consoleLog.push(t, "system"),
      chat: t => this.consoleLog.push(`${this.heroState.name}: ${t}`, "chat"),
      items: this.data.items as ConsoleHost["items"],
      addGold: n => {
        this.hero.gold += n; this.world.money[this.hero.player] = (this.world.money[this.hero.player] ?? 0) + n;
        this.consoleLog.push(`Picked up ${n} gold`, "info");   // refs/original/console/c06_gold.png
      },
      godCap: u => (u === this.hero ? heroProtCap(this.heroState.stats?.spirit ?? 0) : 100),
      addItem: (id, n) => { for (let i = 0; i < n; i++) this.hero.items.push(id); this.syncItems(); },
      hasSpellbook: () => this.heroState.heroClass === "mage",
      learnSpell: id => { const s = (this.heroState.spells ??= []); if (!s.map(Number).includes(id)) s.push(String(id)); },
      heroChanged,
      summon: (name, n) => {
        const tid = findTemplate(this.data.templates as Record<string, unknown> | undefined, name);
        let made = 0;
        for (let i = 0; tid && i < n; i++) {
          const u = spawnFromTemplate(this.built, this.data, Number(tid));
          if (!u) break;
          u.dynamic = true;   // criada no meio da missão: o snapshot guarda os dados estáticos
          made++;
        }
        return made;
      },
      showMap: on => {
        if (on) { this.fog.explored.fill(1); this.fog.enabled = false; } else this.fog.enabled = true;
        this.fog.update(this.world);
      },
      victory: () => this.endMission(true, 0),
      event: n => { if (n === 0xff) this.endMission(false, 0); else this.showMessage(n); },
      afterPickup: () => this.syncItems(),
    };
    return this.consoleHostObj;
  }

  /** unidade que recebe as ordens: a ativa se estiver viva; senão o herói */
  private get actor(): Unit { return this.active.alive && this.active.active ? this.active : this.hero; }

  /** Seleciona uma unidade (painel, retrato, cabeça). Unidade do jogador passa a receber as ordens. Selecionar uma só desfaz a seleção múltipla. */
  private selectUnit(u: Unit, keepExtra = false): void {
    this.selected = u; this.view.selectedId = u.id;
    if (!keepExtra) this.setExtra([]);
    if (!isOwn(this.hero, u) || !u.alive || u === this.active) return;
    this.active = u;
    this.setMode(null);
    if (!u.spells.some(s => !s.id.startsWith("scroll:"))) this.hud.toggleSpellbook(false);
    this.refreshSpellUi();
  }

  /** Demais unidades selecionadas (além da ativa): guarda e espelha na vista (barra de seleção). */
  private setExtra(ids: readonly number[]): void {
    this.extra.set(ids.filter(id => id !== this.active?.id));
    this.view.selectedExtra.clear();
    for (const id of this.extra.list) this.view.selectedExtra.add(id);
  }

  /** Unidades do jogador selecionadas: a ativa e as demais (vivas e em jogo); vazio se nada está selecionado (botão direito). */
  private selectedOwn(): Unit[] {
    if (!this.selected) return [];
    const out: Unit[] = [this.actor];
    for (const id of this.extra.list) {
      const u = this.world.get(id);
      if (u && u.alive && u.active && isOwn(this.hero, u) && !out.includes(u)) out.push(u);
    }
    return out;
  }

  /** Quem recebe uma ordem de interface: toda a seleção (a ativa sempre, mesmo sem seleção explícita, como antes). */
  private orderUnits(): Unit[] {
    const sel = this.selectedOwn();
    return sel.length ? sel : [this.actor];
  }

  /** Define a seleção (grupos, E, Shift+clique): a 1ª vira a ativa; lista vazia = nada selecionado ("No units selected"). */
  private setSelection(units: readonly Unit[]): void {
    const list = units.filter(u => u.alive && u.active && isOwn(this.hero, u));
    if (!list.length) { this.selected = undefined; this.view.selectedId = 0; this.setExtra([]); return; }
    this.selectUnit(list[0]!, true);
    this.setExtra(list.slice(1).map(u => u.id));
  }

  /** Shift+clique: inclui/retira a unidade do jogador da seleção (retirar a última deixa nada selecionado). */
  private toggleSelected(u: Unit): void {
    const cur = this.selectedOwn();
    const next = cur.includes(u) ? cur.filter(x => x !== u) : [...cur, u];
    this.setSelection(next);
    if (next.includes(u)) this.voice(u, "select");
  }

  /** E: seleciona todo o grupo do jogador (herói, mercenários e aliados; sem invocações): exe 0x416717. */
  private selectAllParty(): void {
    const all = partyMembers(this.world, this.hero).filter(u => u.alive && u.active);
    this.setSelection(all);
    if (all[0]) this.voice(all[0], "select");
  }

  /** Ctrl+1..9 (multi = Ctrl+Shift): grava o grupo (mission/selection.ts GroupBook). */
  private saveGroup(n: number, multi: boolean): void {
    this.groups.save(n, this.selectedOwn().map(u => u.id), multi);
  }

  /** 1..9 restaura (substitui a seleção), Shift+n acrescenta, Alt+n restaura e centraliza a vista na média dos selecionados. */
  private restoreGroup(n: number, add: boolean, center: boolean): void {
    // qualquer unidade do jogador vale num grupo (invocadas também; só o E ignora as invocadas)
    const own = this.world.units.filter(u => isOwn(this.hero, u) && u.alive && u.active).map(u => u.id);
    const ids = this.groups.restore(n, own, this.selectedOwn().map(u => u.id), add);
    this.setSelection(ids.map(id => this.world.get(id)!).filter(Boolean));
    const sel = this.selectedOwn();
    if (sel[0]) this.voice(sel[0], "select");
    const c = center ? centroid(this.selected ? sel : []) : undefined;
    if (c) this.centerOn(c.x, c.y);
  }

  /** Ordem do jogador à unidade `u` ou, sem `u`, a toda a seleção (aliados também trocam o modo de IA, ver mission/party.ts). */
  private giveOrder(o: Order, u?: Unit): void {
    this.pickupAll.cancel();   // qualquer outra ordem do jogador interrompe o "pegar tudo" (P); a fila só chama giveOrder pelo próprio passo
    if (u) { this.partyCtl.order(this.world, u, o); return; }
    for (const x of this.orderUnits()) this.partyCtl.order(this.world, x, o);
  }

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
    // o clique age ao SOLTAR (onPointerUp): apertar e arrastar é a caixa de seleção do original (não move o herói)
    const local = e.getLocalPosition(this.root);
    this.ldrag = { x: local.x, y: local.y, local, ck: clickKind(e), ctrl: !!e.ctrlKey, shift: !!e.shiftKey, moved: false };
  }

  /** Botão esquerdo apertado e o ponteiro andando: a caixa de seleção (retângulo branco de 1 px, como o original). */
  private onPointerMove(e: FederatedPointerEvent): void {
    const d = this.ldrag;
    if (!d) return;
    const p = e.getLocalPosition(this.root);
    if (Math.abs(p.x - d.x) + Math.abs(p.y - d.y) > 4) d.moved = true;
    this.selBox.clear();
    if (d.moved) {
      const x1 = Math.max(0, Math.min(VIEW_W - 1, p.x)), y1 = Math.max(0, Math.min(VIEW_H - 1, p.y));
      this.selBox.rect(Math.min(d.x, x1) + 0.5, Math.min(d.y, y1) + 0.5, Math.abs(x1 - d.x), Math.abs(y1 - d.y)).stroke({ color: 0xffffff, width: 1 });
    }
  }

  /** Clique esquerdo no mapa (sem arrasto), nas coordenadas da tela `local`; `ck` = Alt força mover, Ctrl força ataque/enxame, Shift inclui/retira da seleção. */
  private leftClick(local: { x: number; y: number }, ck: ReturnType<typeof clickKind>, ctrl: boolean): void {
    if (this.ended || this.hud.overlayOpen || modalOpen() || this.hud.dialogOpen) return;
    const w = this.worldPoint(local.x, local.y);
    const { cx, cy } = this.groundCell(w);
    const target = this.view.pick(w.x, w.y, undefined, this.mode === "cast" ? "all" : "hostile");   // caídos: alvo de golpe (inimigos) e de Heal (modo magia)
    const hostileTo = (u: Unit) => this.world.hostile(u.player, 1) || this.world.hostile(1, u.player);
    const h = this.actor;
    if (!h.active) return;
    switch (this.mode) {
      case "cast": {
        const sp = h.spells.find(s => s.id === this.spell);
        if (!sp) break;
        // alvo pelo `target` da magia (sim/spells.ts): inimigo, amigo (ou o próprio), ponto no chão; só a unidade ativa conjura
        const tgt = sp.target ?? (sp.kind === "heal" ? "friend" : "enemy");
        if (tgt === "point") this.giveOrder({ type: "cast", spell: sp.id, x: cx, y: cy }, h);
        else if (tgt === "friend" || tgt === "self") this.giveOrder({ type: "cast", spell: sp.id, target: (target && !hostileTo(target) ? target : h).id }, h);
        else if (target && target !== h) this.giveOrder({ type: "cast", spell: sp.id, target: target.id }, h);
        else { this.hud.say("Choose a target for the spell"); return; }
        this.setMode(null);   // ordem de magia: sem clique nem voz no original (o som sai no lançamento)
        return;
      }
      case "attack":
        if (target && target !== h) this.giveOrder({ type: "attack", target: target.id, forced: true });
        else this.orderMove(cx, cy, true);
        this.voice(h, "attack");
        this.setMode(null);
        return;
      case "swarm":
        this.orderMove(cx, cy, true);
        this.voice(h, "swarm");
        this.setMode(null);
        return;
      case "move":
        this.orderMove(cx, cy, false);
        this.setMode(null);
        return;
    }
    // Alt+clique: força mover (ignora o que estiver sob o cursor: unidade, saco, alavanca)
    if (ck === "forceMove") { this.orderMove(cx, cy, false); return; }
    // saco no chão (coroa do xamã, ingrediente, amuleto...): o clique no saco recolhe, mesmo com um bando em volta (mission/pickup.ts)
    if (sackAtCell(this.world, cx, cy, h)) {
      this.selected = h; this.view.selectedId = h.id;
      this.giveOrder({ type: "pickup", x: cx, y: cy }, h);
      this.voice(h, "pickup");
      return;
    }
    // alavanca (estrutura "Switch" das missões 93-96 e 103): o clique na pegada ou na imagem logo acima anda até ela e a aciona; só um inimigo na frente tem prioridade
    const lever = this.host && (!target || !hostileTo(target)) && !ctrl ? switchAtCell(this.host, cx, cy) : undefined;
    if (lever !== undefined) { this.useSwitch(lever); return; }
    if (target && target !== h) {
      // unidade do jogador (aliado do grupo): só seleciona; inimigo: ataca com a unidade ativa e mostra o painel dele
      if (ck === "toggleSelect" && isOwn(this.hero, target) && target.alive) { this.toggleSelected(target); return; }
      if (isOwn(this.hero, target) && !hostileTo(target) && ck !== "forceAttack") { this.selectUnit(target); this.voice(target, "select"); return; }
      if (hostileTo(target) || ck === "forceAttack") { this.giveOrder({ type: "attack", target: target.id, forced: ck === "forceAttack" }); this.voice(h, "attack"); }
      this.selected = target; this.view.selectedId = target.id;
      return;
    }
    if (target === h) { if (ck === "toggleSelect") this.toggleSelected(h); else { this.selectUnit(h); this.voice(h, "select"); } return; }
    if (this.useSignpost(cx, cy)) return;
    this.selected = h; this.view.selectedId = h.id;
    // Ctrl+clique no chão: força ataque/enxame (mover atacando quem aparecer)
    if (ck === "forceAttack") { this.orderMove(cx, cy, true); this.voice(h, "swarm"); } else this.orderMove(cx, cy, false);
  }

  /**
   * Ação de USAR ao chegar (também refeita ao carregar um save com o herói a caminho). Como no original (ação 0xf de 0x50f12c), a estrutura
   * acionada é a 1ª da lista a Chebyshev ≤ 2 de (x − 1, y − 1) da unidade (`host.useFrom`), que pode NÃO ser a clicada: na 103 a 7 pelo oeste
   * liga a 6, a 9 pelo oeste liga a 3, a 8 e a 11 nunca (medido com cliques reais, notes/group-levers.md). Sem som (medido).
   */
  private switchAct(id: number): ((u: Unit) => void) | undefined {
    if (!this.host.switches.get(id)) return undefined;
    return (u: Unit) => {
      const r = this.host.useFrom(u.cx, u.cy);
      if (r) console.info(`[missão] alavanca ${r.id} ${r.on ? "ligada" : "desligada"}${r.id !== id ? ` (clicada a ${id})` : ""}`);
    };
  }

  /** Anda até a alavanca `id` e a usa ao chegar (o sprite acompanha em `syncSwitches`). O clique é uma ordem de andar: voz `move` [exe 0x41a0b5 → vtable +0x6c, a mesma de 0x418bc3]. */
  private useSwitch(id: number): void {
    const p = this.host.switches.get(id), u = this.actor;
    if (!p) return;
    this.selected = u; this.view.selectedId = u.id;
    const ok = this.useQ.start(this.world, u, p.x, p.y, o => this.giveOrder(o, u), this.switchAct(id)!, id);
    if (ok) this.voice(u, "move"); else this.hud.say("Can't reach that lever", 2000);
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
    if (e.button === 0 && this.ldrag) {
      const d = this.ldrag;
      this.ldrag = null;
      this.selBox.clear();
      const p = e.getLocalPosition(this.root);
      if (!d.moved) this.leftClick(d.local, d.ck, d.ctrl);
      else this.boxSelect(d.x, d.y, p.x, p.y, d.shift);
      return;
    }
    if (e.button === 2 && this.rdrag) {
      if (!this.rdrag.moved) {
        // clique direito: cancela modo/seleção
        if (this.mode) this.setMode(null);
        else { this.selected = undefined; this.view.selectedId = 0; this.setExtra([]); }   // original: botão direito desseleciona (HUD "No units selected")
      }
      this.rdrag = null;
    }
  }

  /** Caixa de seleção (arrasto com o botão esquerdo; sonda no original, missão 30): as unidades do jogador vivas cujo ponto no chão cai
   *  no retângulo da tela ficam selecionadas (a 1ª vira a ativa); com Shift somam-se à seleção atual [est]; caixa vazia não muda nada [est]. */
  private boxSelect(x0: number, y0: number, x1: number, y1: number, add: boolean): void {
    if (this.ended || this.hud.overlayOpen || modalOpen()) return;
    const a = this.worldPoint(Math.min(x0, x1), Math.min(y0, y1)), b = this.worldPoint(Math.max(x0, x1), Math.max(y0, y1));
    const inside = this.world.units.filter(u => u.alive && u.active && isOwn(this.hero, u) && this.view.isVisible(u)
      && u.x * TILE >= a.x && u.x * TILE <= b.x && u.y * TILE >= a.y && u.y * TILE <= b.y);
    if (!inside.length) return;
    const cur = add ? this.selectedOwn() : [];
    this.setSelection([...cur, ...inside.filter(u => !cur.includes(u))]);
    this.voice(inside[0]!, "select");
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

  /** Mover (ou enxamear, `attackMove`) toda a seleção: o 1º vai ao ponto, os outros às células livres em volta (sem formação própria: Formation Mode é do sim). */
  private orderMove(cx: number, cy: number, attackMove: boolean): void {
    const units = this.orderUnits().filter(x => x.active);
    const u = units[0];
    if (!u) return;
    const g = this.world.grid;
    let x = Math.max(0, Math.min(g.w - 1, cx)), y = Math.max(0, Math.min(g.h - 1, cy));
    if (!g.walkable(x, y)) { const c = g.nearestFree(x, y, false, 4, u.id); if (c) { x = c.x; y = c.y; } }
    if (units.length === 1) this.giveOrder({ type: "move", x, y, attackMove }, u);
    else {
      const slots = spreadTargets(x, y, units.length, (a, b) => a >= 0 && b >= 0 && a < g.w && b < g.h && g.walkable(a, b));
      units.forEach((m, i) => this.giveOrder({ type: "move", x: slots[i]!.x, y: slots[i]!.y, attackMove }, m));
    }
    this.voice(u, "move");   // original: só a voz da unidade (0x418caa), sem clique
  }

  /** Voz de comando/seleção da unidade (mission/sound.ts; unidades sem conjunto de voz ficam caladas). */
  private voice(u: Unit, cmd: VoiceCmd): void { this.audio.voice(u, cmd, this.cam); }

  private setMode(m: Mode): void {
    if (this.mode === "cast" && m !== "cast") {
      this.hud.toggleSpellbook(false);
      // pergaminho escolhido mas não lançado: some a magia temporária (o pergaminho continua na mochila)
      if (this.scrollCast && this.hero.castSpell?.id !== this.scrollCast.spell) this.dropScrollSpell();
    }
    this.mode = m;
    const map: Record<string, CommandName> = { attack: "attack", move: "move", swarm: "swarm", cast: "cast" };
    this.hud.setActiveCommand(m ? map[m]! : null);
    if (m !== "cast") this.hud.setSpells(this.knownSpells(), null, this.actor.selectedSpell);
  }

  private onCommand(c: ScCommand): void {
    if (this.ended) return;
    const h = this.actor;
    const each = (fn: (u: Unit) => void): void => this.orderUnits().forEach(fn);
    switch (c) {
      case "attack": this.setMode("attack"); break;
      case "move": this.setMode("move"); break;
      case "swarm": this.setMode("swarm"); break;
      // ordens do original (pedido MOTOR-C): Guard vigia o posto (raio mínimo 8), Stand Ground não sai do lugar, Defend protege a
      // unidade amiga selecionada (ou o herói; um aliado defende o herói), Retreat foge dos inimigos próximos
      case "guard": each(u => this.giveOrder({ type: "guard", x: u.cx, y: u.cy }, u)); this.setMode(null); break;
      case "stand": this.giveOrder({ type: "hold" }); this.setMode(null); break;
      // L (tarefa 0x17 do exe): parado, sem atacar ninguém
      case "still": this.giveOrder({ type: "still" }); this.setMode(null); break;
      case "defend": {
        const sel = this.selected && this.selected !== h && this.selected.alive && this.selected.player === h.player ? this.selected
          : this.selected && this.selected !== h && this.selected.alive && !this.world.hostile(this.selected.player, 1) && !this.world.hostile(1, this.selected.player) ? this.selected
          : h === this.hero ? h : this.hero;
        each(u => { if (u !== sel || u === h) this.giveOrder({ type: "defend", unit: sel.id, range: 4 }, u); });
        this.voice(h, "defend"); this.setMode(null);
        break;
      }
      case "cast": {
        const known = this.knownSpells();
        if (!known.length) break;
        this.hud.toggleSpellbook(true);   // o comando Cast abre o livro de magias (como no original)
        this.selectSpell(this.spell && known.some(s => s.id === this.spell) ? this.spell : known[0]!.id);
        break;
      }
      case "retreat": this.giveOrder({ type: "retreat" }); this.voice(h, "retreat"); this.setMode(null); break;
    }
  }

  /** magias aprendidas pela unidade ativa (sem as temporárias de pergaminho, que são do herói) */
  private knownSpells(): Unit["spells"] { return this.actor.spells.filter(s => !s.id.startsWith("scroll:")); }

  /** CTRL+A sobre a célula do livro: marca/desmarca a magia que o ataque da unidade ativa lança (sim/spellattack.ts toggleChosenSpell). */
  private chooseAttackSpell(): void {
    if (!this.hud.spellbookOpen) return;
    const id = this.hud.spellAt(this.pointer.x, this.pointer.y);
    if (id && toggleChosenSpell(this.actor, id)) this.refreshSpellUi();
  }

  private refreshSpellUi(): void {
    this.hud.setSpells(this.knownSpells(), this.mode === "cast" ? this.spell : null, this.actor.selectedSpell);
    this.hud.setCommandHidden("cast", !this.knownSpells().length);
  }

  private selectSpell(id: string): void {
    const caster = this.actor;
    const s = caster.spells.find(x => x.id === id);
    if (!s) return;
    // lançar pelo livro NÃO marca a magia de ataque (+0x1c4+0x78): no original só CTRL+A sobre a célula marca (chooseAttackSpell; BUG-MAGO 19/10:
    // marcar Heal ao se curar deixava o mago parado — com Heal marcada e ninguém ferido o ataque "para", exe 0x56b059)
    if (s.target === "self" || (!s.target && s.kind === "shield")) {
      // "Caster Only" (Escudo etc.): lança direto em quem conjura
      this.giveOrder({ type: "cast", spell: s.id, target: caster.id });
      return;
    }
    this.spell = id;
    this.mode = "cast";
    this.hud.setActiveCommand("cast");
    this.hud.setSpells(this.knownSpells(), id, caster.selectedSpell);
    this.hud.say(`${s.name}${s.mana ? ` (${s.mana} mana)` : ""}: click a target`);
  }

  // ------------------------------------------------------------------------------------------- itens

  private totalGold(): number { return (this.heroState.gold ?? 0) + this.hero.gold; }

  private toggleInventory(): void {
    const on = !this.itemUi.open;
    // só o herói tem mochila e equipamento (docs/GAPS.md [MISSÃO-UI-1]): abrir com um aliado ATIVO volta ao herói — mas a seleção múltipla
    // fica (bug 14 de 28/10: antes `selectUnit(hero)` apagava as demais unidades selecionadas, inclusive ao abrir com o painel mostrando
    // o inimigo atacado); herói fora da seleção: seleciona só ele (sem seleção fica assim: a barra mostra "No hero selected", m20_bag_open)
    if (on && this.selected && this.selected !== this.hero) {
      const sel = this.selectedOwn();
      if (sel.includes(this.hero)) this.setSelection([this.hero, ...sel.filter(u => u !== this.hero)]);
      else this.selectUnit(this.hero);
    }
    this.itemUi.setOpen(on);
    this.hud.setInventoryOpen(on);
    this.audio.ui("book");   // abrir/fechar a mochila: ibook (0x41adc2/0x41ae4f) [medido no original]
  }

  /** Mochila/equipamento mudaram pela interface: recalcula o herói (peso, atributos, magias), o espelho da sim e a boneca. */
  private inventoryChanged(equipment: boolean): void {
    refreshHero(this.hero, this.heroState, this.data);
    reapplyGod(this.hero);
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
    reapplyGod(this.hero);
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

  /** Chave do retrato (regra pura em mission/portraitrules.ts: boneca do herói/do template, bitmap de infowindow + face, ou sprite). */
  private portraitKey(u: Unit): string { return portraitKeyFor(u, this.data); }

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
      if (key.startsWith("doll:tpl:")) {
        const opts = templateDoll(u, this.data);
        const doll = opts ? await buildDoll(this.game, { ...opts, hero: false }) : undefined;
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
      // hall da fama: tempo de simulação (ticks do mundo, 16/s; pausas e diálogos não contam) e abates da missão
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
    // janelas abertas depois do cursor (menu Esc, opções, diálogos) cobririam o ponteiro: ele fica sempre no topo
    if (this.root.children[this.root.children.length - 1] !== this.cursor) this.root.addChild(this.cursor);
    let name = "default";
    const overUi = this.hud.overlayOpen || this.hud.dialogOpen || modalOpen() || this.itemUi.dragging || this.itemUi.contains(p.x, p.y)
      || (this.hud.spellbookOpen && p.y >= this.hud.spellbookY);
    if (p.x < PANEL_X && !overUi) {
      const w = this.worldPoint(p.x, p.y);
      const { cx: cellX, cy: cellY } = this.groundCell(w);
      const overSack = !this.mode && !!sackAtCell(this.world, cellX, cellY, this.actor);
      const overLever = !this.mode && !overSack && switchAtCell(this.host, cellX, cellY) !== undefined;
      const u = overSack || overLever ? undefined : this.view.pick(w.x, w.y, undefined, this.mode === "cast" ? "all" : "hostile");
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
      if (k.has("arrowleft")) dx -= 1;
      if (k.has("arrowright")) dx += 1;
      if (k.has("arrowup")) dy -= 1;
      if (k.has("arrowdown")) dy += 1;
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
    this.consoleLog.tick(now);
    this.partyCtl.step(this.world);
    this.pickupAll.step(this.world, o => this.partyCtl.order(this.world, this.hero, o));
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
    this.updateAmbience();
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
      if (this.extra.size) this.setExtra(this.extra.list.filter(id => { const x = this.world.get(id); return !!x && x.alive && x.active && isOwn(this.hero, x); }));
      // seleção PRÓPRIA (ativa + demais) para as barras de seleção: não some quando o painel passa a mostrar o inimigo clicado (bug 11 de 28/10)
      this.view.selectedOwn.clear();
      for (const u of this.selectedOwn()) this.view.selectedOwn.add(u.id);
      this.hud.setParty(partyMembers(this.world, this.hero).map(u => ({
        id: u.id, name: u.name, hp: u.hp, maxHp: u.maxHp, alive: u.alive, portrait: this.portraitFor(u),
      })), this.active.id, this.extra.list);
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
        if (t) this.audio.hit(t, e.amount, this.cam);
        break;
      }
      case "miss": { const t = w.get(e.target); if (t && (t.isHero || w.get(e.unit)?.isHero)) this.view.floatText(t, "miss", 0xc0c0c0); break; }
      case "attack": { const u = w.get(e.unit); if (u) this.audio.attack(u, this.cam); break; }
      // queda = grito de morte e fim da seleção; morte consumada (≤ −10, saque/abate) = contagem do hall da fama [exe 0x510a70]
      case "fall": { const u = w.get(e.unit); if (u) this.audio.death(u, this.cam); if (this.selected === u) this.selected = this.actor; break; }
      case "death": { const u = w.get(e.unit); if (u && u.player !== this.hero.player && w.hostile(this.hero.player, u.player)) this.hallKills++; break; }
      case "heal": { const u = w.get(e.unit); if (u) this.view.floatText(u, `+${e.amount}`, 0x80ff80); break; }
      case "exp": break;
      case "levelup": { const u = w.get(e.unit); if (u) this.view.floatText(u, "Skill up!", 0xffd84a); break; }
      case "buff": { const u = w.get(e.unit); if (u) this.view.floatText(u, `Shield +${e.amount}`, 0x9fd0ff); break; }
      case "pickup": {
        const u = w.get(e.unit);
        // ouro recolhido por um aliado vai para o herói (só ele conta no resultado e na mochila)
        if (u && e.gold && u !== this.hero && isOwn(this.hero, u)) { u.gold = Math.max(0, u.gold - e.gold); this.hero.gold += e.gold; }
        if (u && e.gold) this.view.floatText(u, `+${e.gold} gold`, 0xffd84a);   // o original não toca som ao recolher ouro
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

  // ------------------------------------------------------------------------------------------- QA (somente leitura; tools/fuzz, ui/qa.ts)

  /** Estado resumido para o fuzzer (`window.__qa.state().mission`). Não altera nada. */
  qaState(): Record<string, unknown> {
    if (!this.ready) return { ready: false };
    const w = this.world, h = this.hero, cur = this.cursor, root = this.root;
    const mine = (u: Unit): boolean => u.player === h.player;
    const unit = (u: Unit) => ({
      id: u.id, name: u.name, player: u.player, hero: u.isHero, own: mine(u),
      hostile: !mine(u) && (w.hostile(u.player, 1) || w.hostile(1, u.player)),
      hp: u.hp, maxHp: u.maxHp, mana: u.mana, maxMana: u.maxMana, x: u.x, y: u.y, cx: u.cx, cy: u.cy,
      state: u.state, order: u.order.type, orderTarget: (u.order as { target?: number }).target ?? 0, target: u.target,
      alive: u.alive, active: u.active, helpless: u.helpless, phased: u.phased, suspended: u.suspended,
      selSpell: u.selectedSpell, castSpell: u.castSpell?.id ?? null, cooldown: u.cooldown, pathLen: u.rec.pathDynamic.getCount(),
      gold: u.gold, items: u.items.length, flying: u.flying, range: w.attackRange(u), bodyDead: u.bodyDead, downed: u.downed, corpseHp: u.corpseHp, dyn: u.dynamic,
      spells: u.spells.map(s => s.id), invisible: u.hasBuff("invisibility" as never),
    });
    const sx = (u: Unit) => ({
      sx: Math.round((u.x * TILE - this.cam.x) * this.zoom),
      sy: Math.round((u.y * TILE - this.view.unitLift(u) - this.cam.y) * this.zoom),
    });
    const own = w.units.filter(u => mine(u));
    const near = w.units.filter(u => !mine(u) && u.active && Math.hypot(u.x - h.x, u.y - h.y) < 14).slice(0, 24);
    const nonFinite: string[] = [];
    const outOfMap: number[] = [];
    for (const u of w.units) {
      for (const k of ["x", "y", "hp", "mana", "cx", "cy", "gold", "maxHp", "maxMana"] as const) if (!Number.isFinite(u[k])) nonFinite.push(`${u.id}.${k}`);
      if (u.active && (u.x < 0 || u.y < 0 || u.x > w.grid.w || u.y > w.grid.h)) outOfMap.push(u.id);
    }
    for (const k of ["x", "y"] as const) if (!Number.isFinite(this.cam[k])) nonFinite.push(`cam.${k}`);
    const idx = root.children.indexOf(cur);
    const above = idx < 0 ? ["<cursor fora da raiz>"] : root.children.slice(idx + 1).filter(c => {
      if (!c.visible || c.alpha <= 0) return false;
      try { const b = c.getBounds(); return b.width * b.height > 0 && b.containsPoint(this.pointer.x, this.pointer.y); } catch { return false; }
    }).map(c => `${c.constructor.name}${(c as { label?: string }).label ? ":" + (c as { label?: string }).label : ""}`);
    // alvos clicáveis no mapa (conferidos com view.pick: o clique acerta de fato a unidade)
    const clickable: { id: number; sx: number; sy: number; hostile: boolean; own: boolean }[] = [];
    for (const u of w.units) {
      if (!u.active) continue;
      const p = sx(u);
      if (p.sx < 4 || p.sy < 4 || p.sx > PANEL_X - 4 || p.sy > SCREEN_H - 4) continue;
      const wp = this.worldPoint(p.sx, p.sy);
      if (this.view.pick(wp.x, wp.y) !== u) continue;
      clickable.push({ id: u.id, ...p, hostile: !mine(u) && (w.hostile(u.player, 1) || w.hostile(1, u.player)), own: mine(u) });
      if (clickable.length >= 30) break;
    }
    const sorted = (a: string[]) => [...a].sort();
    return {
      ready: true, id: this.id, inst: this.qaInst, tick: w.tick, ended: this.ended, elapsed: this.elapsed,
      paused: { paused: this.paused, menu: this.menuPaused, user: this.userPaused, dialog: this.hud.dialogOpen },
      ai: { ...(w.playerAi[h.player] ?? {}) }, settings: JSON.stringify(this.settings),
      mode: this.mode, spell: this.spell, speed: this.gameSpeed, zoom: this.zoom, cam: { ...this.cam },
      heroId: h.id, activeId: this.active.id, selectedId: this.selected?.id ?? 0, selectedIds: this.selectedOwn().map(u => u.id),
      groups: this.groups.snapshot(), infoMode: this.hud.infoPictureOnly ? "picture" : "stats", quick: JSON.stringify(this.heroState.quickKeys ?? []),
      pickupAll: this.pickupAll.active, speedLevel: speedLevel(this.gameSpeed), consoleMsgs: this.consoleLog.messages.length,
      hero: unit(h), own: own.map(unit), near: near.map(unit), clickable, nonFinite, outOfMap,
      counts: { units: w.units.length, alive: w.units.filter(u => u.alive).length, loot: w.loot.length },
      windows: {
        modal: modalOpen(), inv: this.itemUi.open, book: this.hud.spellbookOpen, dialog: this.hud.dialogOpen,
        overlay: this.hud.overlayOpen, console: this.consoleIn.open, dragging: this.itemUi.dragging,
      },
      cursor: {
        visible: cur.visible, x: cur.x, y: cur.y, alpha: cur.alpha, hasTexture: cur.texture.width > 1,
        idx, n: root.children.length, above, px: this.pointer.x, py: this.pointer.y, inside: this.pointer.inside,
        css: this.game.app.canvas.style.cursor,
      },
      inv: {
        pack: this.heroState.inventory.map(e => [e.id, e.count ?? 1]), equip: { ...this.heroState.equipment },
        mirror: sorted(this.hero.items), packMirror: sorted(this.inv.mirror()), heldGold: this.heroState.gold ?? 0, unitGold: h.gold,
        money: w.money[h.player] ?? 0,
        ground: w.loot.map(l => ({ x: l.x, y: l.y, gold: l.gold, items: [...l.items] })),
      },
      spellsKnown: this.knownSpells().map(s => ({ id: s.id, name: s.name, mana: s.mana, target: s.target ?? null, kind: s.kind })),
    };
  }

  /** Resumo determinístico para comparar antes/depois de salvar e carregar. */
  qaSummary(): unknown {
    const w = this.world, h = this.hero;
    const r = (n: number) => Math.round(n * 100) / 100;
    return {
      tick: w.tick, elapsed: Math.round(this.elapsed),
      hero: { hp: r(h.hp), mana: r(h.mana), cx: h.cx, cy: h.cy, gold: this.totalGold(), sel: h.selectedSpell },
      pack: this.heroState.inventory.map(e => `${e.id}x${e.count ?? 1}`).sort(), equip: { ...this.heroState.equipment },
      units: w.units.map(u => `${u.id}:${u.alive ? 1 : 0}:${r(u.hp)}:${r(u.mana)}:${u.cx},${u.cy}`).sort(),
      loot: w.loot.map(l => `${l.x},${l.y}:${l.gold}:${[...l.items].sort().join("+")}`).sort(),
      objectives: [...this.objectives].map(([k, v]) => `${k}=${v}`).sort(), fog: this.fog.explored.reduce((a, b) => a + (b ? 1 : 0), 0),
    };
  }

  /** Salva no slot (como o menu faz) e devolve o resumo do estado salvo; a simulação fica parada. */
  qaSave(slot: number): unknown {
    this.userPaused = true;
    const summary = this.qaSummary();
    const r = this.game.state.saveToSlot(slot, "QA fuzz", snapshotMission(this.id, this.built, this.uiState()), this.data.texts?.sections?.briefing?.[0]?.text.split(/\n\s*\n/)[0]?.trim());
    return { ok: r.ok, summary };
  }

  /** ÚNICO gancho que escreve (só DEV, só para o fuzzer variar o estado): vida/mana do herói em fração e teletransporte para perto
   *  do `idx`-ésimo inimigo mais próximo (o macaco não precisa andar a missão inteira para chegar ao combate). */
  qaPoke(o: { hp?: number; mana?: number; tele?: "enemy"; idx?: number }): unknown {
    const h = this.hero, w = this.world;
    if (!h.alive) return { ok: false };
    if (o.hp !== undefined) h.hp = Math.max(1, Math.min(h.maxHp, Math.round(h.maxHp * o.hp)));
    if (o.mana !== undefined) h.mana = Math.max(0, Math.min(h.maxMana, Math.round(h.maxMana * o.mana)));
    let to: { x: number; y: number } | undefined;
    if (o.tele === "enemy") {
      const foes = w.units.filter(u => u.active && !u.helpless && u.player !== h.player && (w.hostile(u.player, 1) || w.hostile(1, u.player)))
        .sort((a, b) => Math.hypot(a.x - h.x, a.y - h.y) - Math.hypot(b.x - h.x, b.y - h.y));
      const e = foes[(o.idx ?? 0) % Math.max(1, foes.length)];
      const c = e ? w.grid.nearestFree(e.cx - 4, e.cy, false, 4, h.id) : undefined;
      if (c) { w.teleport(h, c.x, c.y); this.centerOn(h.x, h.y); to = c; }
    }
    return { ok: true, to };
  }

  qaFreeze(on: boolean): void { this.userPaused = on; }

  /** Ambiente sonoro (mission/ambient.ts): a vista é a célula do canto da tela (inteira, como +0x5c/+0x60 do exe); fogo = células das Walls of Fire. */
  private updateAmbience(): void {
    if (!this.ambience) return;
    const fire = new Set<number>();
    for (const a of this.world.areas) if (a.spell === String(SPELL.WallOfFire) && a.cells) for (const c of a.cells) fire.add(c);
    this.ambience.update({ x: Math.floor(this.cam.x / TILE), y: Math.floor(this.cam.y / TILE), w: VIEW_CELLS_W, h: VIEW_CELLS_H }, fire,
      ambientHour(this.world.tick / TICKS_PER_SEC));
  }

  override exit(): void {
    this.ambience?.stop();
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
