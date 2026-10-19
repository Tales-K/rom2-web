/**
 * Runtime do script de missão (o "Trigger Manager" do Allods 2): avalia valores, testa gatilhos e executa ações
 * sobre um `ScriptHost`. Biblioteca pura (sem PixiJS, sem DOM). Uso e semântica: docs/SCRIPT_HOST.md.
 *
 *   const rt = new ScriptRuntime(parseScript(json), host);
 *   // a cada quadro da simulação (depois de colocar o herói no mapa):
 *   rt.update(dtSegundos);
 */
import {
  FAR_AWAY, type Cell, type GroupCommand, type ScriptHost, type ScriptLogLevel, type UnitRef,
} from "./host";
import {
  CheckKind, GroupCommandCode, InstantKind,
  type CompareOp, type Script, type ScriptParam, type ScriptRecord, type ScriptTrigger,
} from "./types";

export type DistanceMetric = "euclid" | "chebyshev";

export interface RuntimeOptions {
  /** segundos entre ciclos de avaliação dos gatilhos (padrão 1.0; o primeiro ciclo roda no primeiro `update`) */
  cyclePeriod?: number;
  /** métrica de distância em células (padrão "euclid") */
  distance?: DistanceMetric;
  /** limite de ações executadas por ciclo (proteção; padrão 1000) */
  maxActionsPerCycle?: number;
  /** máximo de ciclos recuperados num único `update` com dt grande (padrão 5) */
  maxCyclesPerUpdate?: number;
  /** parar de avaliar gatilhos depois de "Mission Complete/Fail" (padrão false: continua, mas só o 1º desfecho vale) */
  stopOnOutcome?: boolean;
  /** tamanho do histórico de eventos guardado em `history` (padrão 500) */
  historySize?: number;
  /** chamado a cada gatilho disparado / ação executada */
  onEvent?: (e: ScriptEvent) => void;
}

export type ScriptEvent =
  | { type: "trigger"; time: number; cycle: number; trigger: string; index: number }
  | { type: "action"; time: number; cycle: number; trigger: string; action: string; kind: number; kindName: string; args: number[]; handled: boolean }
  | { type: "outcome"; time: number; cycle: number; outcome: ScriptOutcome };

export type ScriptOutcome = { result: "complete" } | { result: "fail"; cause: number };

/** Estado serializável (para salvar no meio da missão). */
export interface ScriptRuntimeState {
  time: number;
  acc: number;
  cycle: number;
  started: boolean;
  variables: [number, number][];
  scenarioVariables: [number, number][];
  subobjectives: [number, number][];
  stage: number;
  outcome: ScriptOutcome | null;
  triggers: { fired: number; last: number }[];
}

interface TriggerState {
  fired: number;
  last: number;
}

export class ScriptRuntime {
  readonly script: Script;
  readonly host: ScriptHost;
  readonly options: Required<Omit<RuntimeOptions, "onEvent">> & { onEvent?: (e: ScriptEvent) => void };

  /** tempo de missão acumulado (s) */
  time = 0;
  /** número de ciclos de avaliação já executados */
  cycle = 0;
  /** variáveis de missão ("Return value of variable" / "Set value" / "Increment"); começam em 0 */
  readonly variables = new Map<number, number>();
  /** variáveis de cenário em memória (usadas só se o host não implementar get/setScenarioVariable) */
  readonly scenarioVariables = new Map<number, number>();
  /** subobjetivos (n -> 0 oculto / 1 ativo / 2 cumprido) */
  readonly subobjectives = new Map<number, number>();
  /** "Increment mission stage" */
  stage = 0;
  outcome: ScriptOutcome | null = null;
  readonly history: ScriptEvent[] = [];

  private acc = 0;
  private started = false;
  private readonly tstate: TriggerState[];
  private warned = new Set<string>();
  private currentTrigger = "";
  private actionsThisCycle = 0;

  constructor(script: Script, host: ScriptHost, options: RuntimeOptions = {}) {
    this.script = script;
    this.host = host;
    this.options = {
      cyclePeriod: options.cyclePeriod ?? 1.0,
      distance: options.distance ?? "euclid",
      maxActionsPerCycle: options.maxActionsPerCycle ?? 1000,
      maxCyclesPerUpdate: options.maxCyclesPerUpdate ?? 5,
      stopOnOutcome: options.stopOnOutcome ?? false,
      historySize: options.historySize ?? 500,
      onEvent: options.onEvent,
    };
    this.tstate = script.triggers.map(() => ({ fired: 0, last: -Infinity }));
    for (const w of script.warnings) this.log("warn", w);
  }

  // ------------------------------------------------------------------------------------------ informações estáticas

  /** Ponto de entrada do jogador ("Drop Location", instante estático), em células; null se o script não tiver. */
  get dropLocation(): Cell | null {
    const a = this.script.actionList.find(r => r.kind === InstantKind.DropLocation);
    return a ? { x: this.p(a, 0), y: this.p(a, 1) } : null;
  }

  /** "Outpost (Repopper)": pontos de reaparecimento declarados no script (estáticos). */
  get outposts(): { x: number; y: number; radius: number; delay: number; group: number }[] {
    return this.script.actionList.filter(r => r.kind === InstantKind.Outpost)
      .map(a => ({ x: this.p(a, 0), y: this.p(a, 1), radius: this.p(a, 2), delay: this.p(a, 3), group: this.p(a, 4) }));
  }

  /** Unidades marcadas como VIP (valor "VIP"); o host pode falhar a missão se uma delas morrer. */
  get vipUnits(): UnitRef[] {
    return this.script.valueList.filter(v => v.kind === CheckKind.Vip).map(v => this.p(v, 0));
  }

  // ------------------------------------------------------------------------------------------ laço

  /** Avança o relógio do script; roda um ciclo no primeiro chamado e depois a cada `cyclePeriod` segundos. */
  update(dt: number): void {
    if (!(dt >= 0)) dt = 0;
    this.time += dt;
    if (!this.started) {
      this.started = true;
      this.runCycle();
      return;
    }
    this.acc += dt;
    let n = 0;
    while (this.acc >= this.options.cyclePeriod && n < this.options.maxCyclesPerUpdate) {
      this.acc -= this.options.cyclePeriod;
      this.runCycle();
      n++;
    }
    if (n >= this.options.maxCyclesPerUpdate) this.acc = 0;
  }

  /** Executa um ciclo de avaliação: gatilhos em ordem de arquivo; cada um dispara no máximo uma vez por ciclo. */
  runCycle(): void {
    if (this.options.stopOnOutcome && this.outcome) return;
    this.cycle++;
    this.started = true;
    this.actionsThisCycle = 0;
    const trig = this.script.triggers;
    for (let i = 0; i < trig.length; i++) {
      const t = trig[i]!;
      const st = this.tstate[i]!;
      if (!t.enabled) continue;
      if (t.once && st.fired > 0) continue;
      if (t.period > 0 && this.time - st.last < t.period) continue;
      if (!this.checkTrigger(t)) continue;
      st.fired++;
      st.last = this.time;
      this.emit({ type: "trigger", time: this.time, cycle: this.cycle, trigger: t.name, index: t.index });
      this.currentTrigger = t.name;
      for (const seq of t.actions) {
        if (this.actionsThisCycle >= this.options.maxActionsPerCycle) {
          this.log("warn", `limite de ${this.options.maxActionsPerCycle} ações por ciclo atingido; resto do ciclo ignorado`);
          this.currentTrigger = "";
          return;
        }
        const a = this.script.actions.get(seq);
        if (a) {
          this.actionsThisCycle++;
          this.execute(a);
        }
      }
      this.currentTrigger = "";
      if (this.options.stopOnOutcome && this.outcome) return;
    }
  }

  /** Todas as condições do gatilho verdadeiras (AND). Sem condições = verdadeiro. */
  checkTrigger(t: ScriptTrigger): boolean {
    for (const c of t.conditions) {
      if (!compare(this.evaluate(c.a), c.op, this.evaluate(c.b))) return false;
    }
    return true;
  }

  /** Quantas vezes o gatilho (por nome ou índice) já disparou. */
  firedCount(trigger: string | number): number {
    const i = typeof trigger === "number" ? trigger : this.script.triggers.findIndex(t => t.name === trigger);
    return i >= 0 ? (this.tstate[i]?.fired ?? 0) : 0;
  }

  getVariable(n: number): number {
    return this.variables.get(n) ?? 0;
  }

  setVariable(n: number, v: number): void {
    this.variables.set(n, v | 0);
  }

  // ------------------------------------------------------------------------------------------ valores

  /** Valor numérico do registro de valor `seq` (condição/variável/constante). Inexistente: 0. */
  evaluate(seq: number): number {
    const v = this.script.values.get(seq);
    if (!v) return 0;
    const h = this.host;
    const p = (k: number) => this.p(v, k);
    switch (v.kind) {
      case CheckKind.Constant:
        return v.params.length ? p(0) : 0;
      case CheckKind.Variable:
        return this.getVariable(p(0));
      case CheckKind.GroupUnitCount:
        return h.groupUnitCount(p(0)) | 0;
      case CheckKind.UnitInBox: {
        const c = this.cell(p(0));
        if (!c) return 0;
        const x0 = Math.min(p(1), p(3)), x1 = Math.max(p(1), p(3)), y0 = Math.min(p(2), p(4)), y1 = Math.max(p(2), p(4));
        return c.x >= x0 && c.x <= x1 && c.y >= y0 && c.y <= y1 ? 1 : 0;
      }
      case CheckKind.UnitInCircle: {
        const c = this.cell(p(0));
        return c && this.dist(c, { x: p(1), y: p(2) }) <= p(3) ? 1 : 0;
      }
      case CheckKind.UnitParameter:
        return h.unitParameter ? h.unitParameter(p(0), p(1)) : this.missing("unitParameter", 0);
      case CheckKind.UnitAlive:
      case CheckKind.Vip:
        return this.alive(p(0)) ? 1 : 0;
      case CheckKind.UnitsDistance: {
        const a = this.cell(p(0)), b = this.cell(p(1));
        return a && b ? this.dist(a, b) : FAR_AWAY;
      }
      case CheckKind.PointUnitDistance: {
        const a = this.cell(p(0));
        return a ? this.dist(a, { x: p(1), y: p(2) }) : FAR_AWAY;
      }
      case CheckKind.PlayerUnitCount:
        return h.playerUnitCount ? h.playerUnitCount(p(0)) : this.missing("playerUnitCount", 0);
      case CheckKind.UnitAttacking:
        return h.unitIsAttacking ? (h.unitIsAttacking(p(0)) ? 1 : 0) : this.missing("unitIsAttacking", 0);
      case CheckKind.GetDiplomacy:
        return h.diplomacy(p(0), p(1)) | 0;
      case CheckKind.GetSack:
        return h.sackItemCount ? h.sackItemCount(p(0), p(1)) : this.missing("sackItemCount", 0);
      case CheckKind.NearestPlayerUnitDistance:
        return h.nearestPlayerUnitDistance ? h.nearestPlayerUnitDistance(p(0), p(1), p(2)) : this.missing("nearestPlayerUnitDistance", FAR_AWAY);
      case CheckKind.ItemToPoint: {
        // distância do portador ao ponto, mas só se ele carrega o item ("Hero with amulet near ghost < 4")
        if (!h.unitHasItem) return this.missing("unitHasItem", FAR_AWAY);
        const a = this.cell(p(0));
        return a && h.unitHasItem(p(0), p(1)) ? this.dist(a, { x: p(2), y: p(3) }) : FAR_AWAY;
      }
      case CheckKind.ItemInInventory:
        return h.unitHasItem ? (h.unitHasItem(p(0), p(1)) ? 1 : 0) : this.missing("unitHasItem", 0);
      case CheckKind.PlayerBuildingCount:
        return h.playerBuildingCount ? h.playerBuildingCount(p(0)) : this.missing("playerBuildingCount", 0);
      case CheckKind.BuildingHealth:
        return h.buildingHealth ? h.buildingHealth(p(0)) : this.missing("buildingHealth", 0);
      case CheckKind.Teleportation:
        return h.teleportation ? h.teleportation(p(0), p(1), p(2), p(3)) : this.missing("teleportation", 0);
      case CheckKind.ScenarioVariable:
        return h.getScenarioVariable ? h.getScenarioVariable(p(0)) : (this.scenarioVariables.get(p(0)) ?? 0);
      case CheckKind.Subobjective:
        return this.subobjectives.get(p(0)) ?? 0;
      case CheckKind.SpellOnTile:
        return h.spellOnTile ? h.spellOnTile(p(0), p(1), p(2)) : this.missing("spellOnTile", 0);
      case CheckKind.SpellOnUnit:
        return h.unitHasSpell ? (h.unitHasSpell(p(0), p(1)) ? 1 : 0) : this.missing("unitHasSpell", 0);
      case CheckKind.CenteredOnTile: {
        const c = this.cell(p(0));
        return c && c.x === p(1) && c.y === p(2) ? 1 : 0;
      }
      default:
        this.warnOnce(`value-kind-${v.kind}`, `valor "${v.name}": tipo ${v.kind} desconhecido (vale 0)`);
        return 0;
    }
  }

  // ------------------------------------------------------------------------------------------ ações

  /** Executa uma ação (registro de ação). Exposto para depuração/testes. */
  execute(a: ScriptRecord): void {
    const h = this.host;
    const p = (k: number) => this.p(a, k);
    let handled = true;
    let args = a.params.map(x => x.value);
    switch (a.kind) {
      case InstantKind.IncrementMissionStage:
        this.stage++;
        if (h.incrementMissionStage) h.incrementMissionStage(this.stage); else handled = false;
        break;
      case InstantKind.SendMessage:
        h.sendMessage(p(0));
        break;
      case InstantKind.SetVariable:
        this.setVariable(p(0), p(1));
        break;
      case InstantKind.IncrementVariable:
        this.setVariable(p(0), this.getVariable(p(0)) + 1);
        break;
      case InstantKind.MissionComplete:
        this.setOutcome({ result: "complete" });
        break;
      case InstantKind.MissionFail:
        this.setOutcome({ result: "fail", cause: p(0) });
        break;
      case InstantKind.GroupCommand: {
        const { group, cmd } = this.groupCommand(a);
        args = [group, ...a.params.filter(x => x.type !== "group").map(x => x.value)];
        if (group) h.groupCommand(group, cmd);
        else {
          this.warnOnce(`gc-nogroup-${a.seq}`, `ação "${a.name}": comando de grupo sem grupo-alvo (ignorado)`);
          handled = false;
        }
        break;
      }
      case InstantKind.SetFormation:
        handled = this.call("setFormation", () => h.setFormation?.(p(0), p(1)));
        break;
      case InstantKind.ChangeDiplomacy:
        h.setDiplomacy(p(0), p(1), p(2));
        break;
      case InstantKind.GiveItem:
        handled = this.call("giveItem", () => h.giveItem?.(p(0), p(1), p(2)));
        break;
      case InstantKind.AddItem:
        handled = this.call("addItem", () => h.addItem?.(p(0), p(1)));
        break;
      case InstantKind.RemoveItem:
        handled = this.call("removeItem", () => h.removeItem?.(p(0), p(1)));
        break;
      case InstantKind.PhaseOutUnit:
        h.phaseOutUnit(p(0));
        break;
      case InstantKind.PhaseInUnit:
        h.phaseInUnit(p(0));
        break;
      case InstantKind.Polymorph:
        handled = this.call("polymorph", () => h.polymorph?.(p(0), p(1)));
        break;
      case InstantKind.ChangeUnitOwner:
        handled = this.call("changeUnitOwner", () => h.changeUnitOwner?.(p(0), p(1)));
        break;
      case InstantKind.DropAll:
        handled = this.call("dropAll", () => h.dropAll?.(p(0)));
        break;
      case InstantKind.SpellEffect:
        handled = this.call("spellEffect", () => h.spellEffect?.(p(0), p(1), p(2), p(3), p(4), p(5)));
        break;
      case InstantKind.ChangeGroupOwner:
        handled = this.call("changeGroupOwner", () => h.changeGroupOwner?.(p(0), p(1)));
        break;
      case InstantKind.GiveMoney:
        h.giveMoney(p(0), p(1));
        break;
      case InstantKind.CastSpellOnUnit:
        handled = this.call("castSpellOnUnit", () => h.castSpellOnUnit?.(p(0), p(1), p(2), p(3), p(4)));
        break;
      case InstantKind.SetTrap:
        handled = this.call("setTrap", () => h.setTrap?.(p(0), p(1), p(2), p(3), p(4), p(5), p(6), p(7)));
        break;
      case InstantKind.SetBuildingHealth:
        handled = this.call("setBuildingHealth", () => h.setBuildingHealth?.(p(0), p(1)));
        break;
      case InstantKind.TeleportUnit:
        handled = this.call("teleportUnit", () => h.teleportUnit?.(p(0), p(1), p(2)));
        break;
      case InstantKind.GiveAll:
        h.giveAll(p(0), p(1));
        break;
      case InstantKind.TileSpellDuration:
        handled = this.call("setTileSpellDuration", () => h.setTileSpellDuration?.(p(0), p(1), p(2), p(3)));
        break;
      case InstantKind.UnitSpellDuration:
        handled = this.call("setUnitSpellDuration", () => h.setUnitSpellDuration?.(p(0), p(1), p(2)));
        break;
      case InstantKind.RepopDelay:
        handled = this.call("setRepopDelay", () => h.setRepopDelay?.(p(0), p(1)));
        break;
      case InstantKind.PhaseOutGroup:
        if (h.phaseOutGroup) h.phaseOutGroup(p(0));
        else if (h.groupUnits) for (const u of h.groupUnits(p(0))) h.phaseOutUnit(u);
        else handled = this.call("phaseOutGroup", () => undefined);
        break;
      case InstantKind.PhaseInGroup:
        if (h.phaseInGroup) h.phaseInGroup(p(0));
        else if (h.groupUnits) for (const u of h.groupUnits(p(0))) h.phaseInUnit(u);
        else handled = this.call("phaseInGroup", () => undefined);
        break;
      case InstantKind.SetUnitParameter:
        handled = this.call("setUnitParameter", () => h.setUnitParameter?.(p(0), p(1), p(2)));
        break;
      case InstantKind.SetScenarioVariable:
        if (h.setScenarioVariable) h.setScenarioVariable(p(0), p(1));
        else this.scenarioVariables.set(p(0), p(1));
        break;
      case InstantKind.SetSubobjective:
        this.subobjectives.set(p(0), p(1));
        h.setSubobjective(p(0), p(1));
        break;
      case InstantKind.SetMusicNode:
        handled = this.call("setMusicNode", () => h.setMusicNode?.(p(0), p(1), [p(2), p(3), p(4), p(5), p(6), p(7)]));
        break;
      case InstantKind.RemoveItemFromEverybody:
        handled = this.call("removeItemFromEverybody", () => h.removeItemFromEverybody?.(p(0)));
        break;
      case InstantKind.SuspendGroup:
        handled = this.call("suspendGroup", () => h.suspendGroup?.(p(0)));
        break;
      case InstantKind.NextMusic:
        handled = this.call("setNextMusic", () => h.setNextMusic?.(p(0)));
        break;
      case InstantKind.DropLocation:
      case InstantKind.Outpost:
        // instantes estáticos (lidos por `dropLocation`/`outposts`); num gatilho não fazem nada
        handled = false;
        break;
      default:
        this.warnOnce(`action-kind-${a.kind}`, `ação "${a.name}": tipo ${a.kind} desconhecido (ignorada)`);
        handled = false;
    }
    this.emit({
      type: "action", time: this.time, cycle: this.cycle, trigger: this.currentTrigger, action: a.name, kind: a.kind,
      kindName: a.kindName, args, handled,
    });
  }

  /** Traduz a ação 6 para `GroupCommand` + grupo-alvo. */
  groupCommand(a: ScriptRecord): { group: number; cmd: GroupCommand } {
    const g = a.params.find(x => x.type === "group");
    const rest = a.params.filter(x => x.type !== "group").map(x => x.value);
    const code = rest[0] ?? -1;
    const r = (k: number) => rest[k] ?? 0;
    let cmd: GroupCommand;
    switch (code) {
      case GroupCommandCode.Guard: cmd = { type: "guard", range: r(1) }; break;
      case GroupCommandCode.Swarm: cmd = { type: "swarm", x: r(1), y: r(2) }; break;
      case GroupCommandCode.StandGround: cmd = { type: "standGround" }; break;
      case GroupCommandCode.Move: cmd = { type: "move", x: r(1), y: r(2) }; break;
      case GroupCommandCode.Swarm2: cmd = { type: "swarm2", x: r(1), y: r(2) }; break;
      case GroupCommandCode.Attack: cmd = { type: "attack", victim: r(1) }; break;
      case GroupCommandCode.Defend: cmd = { type: "defend", unit: r(1), range: r(2) }; break;
      case GroupCommandCode.Patrol: cmd = { type: "patrol", x: r(1), y: r(2) }; break;
      case GroupCommandCode.Follow: cmd = { type: "follow", unit: r(1), range: r(2) }; break;
      case GroupCommandCode.Roam: cmd = { type: "roam" }; break;
      case GroupCommandCode.Dwell: cmd = { type: "dwell", range: r(1) }; break;
      default: cmd = { type: "unknown", code, params: rest.slice(1) };
    }
    return { group: g?.value ?? 0, cmd };
  }

  // ------------------------------------------------------------------------------------------ estado

  snapshot(): ScriptRuntimeState {
    return {
      time: this.time, acc: this.acc, cycle: this.cycle, started: this.started,
      variables: [...this.variables], scenarioVariables: [...this.scenarioVariables], subobjectives: [...this.subobjectives],
      stage: this.stage, outcome: this.outcome,
      triggers: this.tstate.map(s => ({ fired: s.fired, last: Number.isFinite(s.last) ? s.last : -1e9 })),
    };
  }

  restore(s: ScriptRuntimeState): void {
    this.time = s.time; this.acc = s.acc; this.cycle = s.cycle; this.started = s.started;
    this.variables.clear(); for (const [k, v] of s.variables) this.variables.set(k, v);
    this.scenarioVariables.clear(); for (const [k, v] of s.scenarioVariables) this.scenarioVariables.set(k, v);
    this.subobjectives.clear(); for (const [k, v] of s.subobjectives) this.subobjectives.set(k, v);
    this.stage = s.stage; this.outcome = s.outcome;
    // -Infinity (gatilho que nunca disparou) é gravado como -1e9
    s.triggers.forEach((t, i) => { const st = this.tstate[i]; if (st) { st.fired = t.fired; st.last = t.last <= -1e9 ? -Infinity : t.last; } });
  }

  // ------------------------------------------------------------------------------------------ auxiliares

  private p(r: ScriptRecord, k: number): number {
    return (r.params[k] as ScriptParam | undefined)?.value ?? 0;
  }

  private cell(u: UnitRef): Cell | null {
    const pos = this.host.unitPosition(u);
    return pos ? { x: Math.floor(pos.x), y: Math.floor(pos.y) } : null;
  }

  private alive(u: UnitRef): boolean {
    return this.host.unitAlive ? this.host.unitAlive(u) : this.host.unitPosition(u) !== null;
  }

  private dist(a: Cell, b: Cell): number {
    const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
    return this.options.distance === "chebyshev" ? Math.max(dx, dy) : Math.sqrt(dx * dx + dy * dy);
  }

  private setOutcome(o: ScriptOutcome): void {
    if (this.outcome) {
      this.log("info", `desfecho ${o.result} ignorado: missão já terminou (${this.outcome.result})`);
      return;
    }
    this.outcome = o;
    this.emit({ type: "outcome", time: this.time, cycle: this.cycle, outcome: o });
    if (o.result === "complete") this.host.missionComplete();
    else this.host.missionFail(o.cause);
  }

  private call(method: string, fn: () => void): boolean {
    if (typeof (this.host as unknown as Record<string, unknown>)[method] !== "function") {
      this.warnOnce(`host-${method}`, `host não implementa ${method}: ação ignorada`);
      return false;
    }
    fn();
    return true;
  }

  private missing(method: string, fallback: number): number {
    this.warnOnce(`host-${method}`, `host não implementa ${method}: usando ${fallback}`);
    return fallback;
  }

  private warnOnce(key: string, msg: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.log("warn", msg);
  }

  private log(level: ScriptLogLevel, msg: string): void {
    this.host.log?.(level, `[script ${this.script.mission}] ${msg}`);
  }

  private emit(e: ScriptEvent): void {
    this.history.push(e);
    if (this.history.length > this.options.historySize) this.history.splice(0, this.history.length - this.options.historySize);
    this.options.onEvent?.(e);
  }
}

export function compare(a: number, op: CompareOp, b: number): boolean {
  switch (op) {
    case "==": return a === b;
    case "!=": return a !== b;
    case ">": return a > b;
    case "<": return a < b;
    case ">=": return a >= b;
    case "<=": return a <= b;
  }
}
