/** Host falso para testar o runtime sem simulação: um mundinho de unidades em células + registro de comandos. */
import { HERO_UNIT_ID, type Cell, type GroupCommand, type ScriptHost, type ScriptLogLevel } from "../host";
import type { Script } from "../types";

export interface FakeUnit {
  id: number;
  x: number;
  y: number;
  player: number;
  group: number | null;
  alive: boolean;
  phased: boolean;
  hp: number;
  items: Set<number>;
  attacking: boolean;
}

export type Command = { name: string; args: unknown[] };

export class FakeWorld {
  readonly units = new Map<number, FakeUnit>();
  readonly diplomacyTable = new Map<string, number>();
  readonly moneyOf = new Map<number, number>();
  readonly commands: Command[] = [];
  readonly messages: number[] = [];
  readonly logs: string[] = [];
  readonly scenario = new Map<number, number>();
  outcome: string | null = null;

  constructor(script?: Script) {
    if (script) {
      for (const u of script.units) {
        this.add({ id: u.id, x: u.x ?? 0, y: u.y ?? 0, player: u.player, group: u.group });
      }
    }
  }

  add(u: Partial<FakeUnit> & { id: number }): FakeUnit {
    const full: FakeUnit = {
      x: 0, y: 0, player: 1, group: null, alive: true, phased: false, hp: 100, items: new Set(), attacking: false, ...u,
    };
    this.units.set(u.id, full);
    return full;
  }

  move(id: number, x: number, y: number): void {
    const u = this.units.get(id);
    if (u) { u.x = x; u.y = y; }
  }

  kill(id: number): void {
    const u = this.units.get(id);
    if (u) u.alive = false;
  }

  killGroup(g: number): void {
    for (const u of this.units.values()) if (u.group === g) u.alive = false;
  }

  dip(a: number, b: number): number {
    return this.diplomacyTable.get(`${a},${b}`) ?? 0;
  }

  private rec(name: string, ...args: unknown[]): void {
    this.commands.push({ name, args });
  }

  /** Host com todos os métodos (opcionais incluídos). */
  fullHost(): ScriptHost {
    const w = this;
    const live = (id: number) => { const u = w.units.get(id); return u && u.alive ? u : null; };
    return {
      unitPosition: (id) => { const u = live(id); return u && !u.phased ? { x: u.x, y: u.y } as Cell : null; },
      unitAlive: (id) => !!live(id),
      unitParameter: (id, p) => (p === 6 ? (live(id)?.hp ?? 0) : 0),
      unitIsAttacking: (id) => !!live(id)?.attacking,
      unitHasItem: (id, item) => !!live(id)?.items.has(item),
      unitHasSpell: () => false,
      unitPlayer: (id) => w.units.get(id)?.player ?? 0,
      groupUnitCount: (g) => [...w.units.values()].filter(u => u.group === g && u.alive).length,
      groupUnits: (g) => [...w.units.values()].filter(u => u.group === g && u.alive).map(u => u.id),
      playerUnitCount: (p) => [...w.units.values()].filter(u => u.player === p && u.alive).length,
      playerBuildingCount: () => 1,
      buildingHealth: () => 100,
      nearestPlayerUnitDistance: (p, x, y) => {
        let best = 9999;
        for (const u of w.units.values()) {
          if (u.player !== p || !u.alive || u.phased) continue;
          best = Math.min(best, Math.hypot(Math.floor(u.x) - x, Math.floor(u.y) - y));
        }
        return best;
      },
      diplomacy: (a, b) => w.dip(a, b),
      money: (p) => w.moneyOf.get(p) ?? 0,
      sackItemCount: () => 0,
      spellOnTile: () => 0,
      teleportation: () => 0,
      getScenarioVariable: (i) => w.scenario.get(i) ?? 0,

      sendMessage: (n) => { w.messages.push(n); w.rec("sendMessage", n); },
      setSubobjective: (n, v) => w.rec("setSubobjective", n, v),
      missionComplete: () => { w.outcome = "complete"; w.rec("missionComplete"); },
      missionFail: (c) => { w.outcome = `fail:${c}`; w.rec("missionFail", c); },
      setDiplomacy: (a, b, v) => { w.diplomacyTable.set(`${a},${b}`, v); w.rec("setDiplomacy", a, b, v); },
      giveMoney: (p, m) => { w.moneyOf.set(p, (w.moneyOf.get(p) ?? 0) + m); w.rec("giveMoney", p, m); },
      phaseOutUnit: (id) => { const u = w.units.get(id); if (u) u.phased = true; w.rec("phaseOutUnit", id); },
      phaseInUnit: (id) => { const u = w.units.get(id); if (u) u.phased = false; w.rec("phaseInUnit", id); },
      phaseOutGroup: (g) => { for (const u of w.units.values()) if (u.group === g) u.phased = true; w.rec("phaseOutGroup", g); },
      phaseInGroup: (g) => { for (const u of w.units.values()) if (u.group === g) u.phased = false; w.rec("phaseInGroup", g); },
      groupCommand: (g, cmd: GroupCommand) => w.rec("groupCommand", g, cmd),
      giveAll: (a, b) => {
        const from = w.units.get(a), to = w.units.get(b);
        if (from && to) { for (const i of from.items) to.items.add(i); from.items.clear(); }
        w.rec("giveAll", a, b);
      },
      incrementMissionStage: (s) => w.rec("incrementMissionStage", s),
      setFormation: (p, f) => w.rec("setFormation", p, f),
      changeUnitOwner: (id, p) => { const u = w.units.get(id); if (u) u.player = p; w.rec("changeUnitOwner", id, p); },
      changeGroupOwner: (g, p) => { for (const u of w.units.values()) if (u.group === g) u.player = p; w.rec("changeGroupOwner", g, p); },
      dropAll: (id) => w.rec("dropAll", id),
      addItem: (id, item) => { w.units.get(id)?.items.add(item); w.rec("addItem", id, item); },
      removeItem: (id, item) => { w.units.get(id)?.items.delete(item); w.rec("removeItem", id, item); },
      giveItem: (a, b, item) => {
        const from = w.units.get(a), to = w.units.get(b);
        if (from?.items.delete(item)) to?.items.add(item);
        w.rec("giveItem", a, b, item);
      },
      removeItemFromEverybody: (item) => { for (const u of w.units.values()) u.items.delete(item); w.rec("removeItemFromEverybody", item); },
      polymorph: (a, b) => w.rec("polymorph", a, b),
      spellEffect: (...a) => w.rec("spellEffect", ...a),
      castSpellOnUnit: (...a) => w.rec("castSpellOnUnit", ...a),
      setTrap: (...a) => w.rec("setTrap", ...a),
      setBuildingHealth: (...a) => w.rec("setBuildingHealth", ...a),
      teleportUnit: (id, x, y) => { w.move(id, x, y); w.rec("teleportUnit", id, x, y); },
      setTileSpellDuration: (...a) => w.rec("setTileSpellDuration", ...a),
      setUnitSpellDuration: (...a) => w.rec("setUnitSpellDuration", ...a),
      setRepopDelay: (...a) => w.rec("setRepopDelay", ...a),
      setUnitParameter: (id, p, v) => { const u = w.units.get(id); if (u && p === 6) u.hp = v; w.rec("setUnitParameter", id, p, v); },
      setNextMusic: (t) => w.rec("setNextMusic", t),
      setMusicNode: (...a) => w.rec("setMusicNode", ...a),
      suspendGroup: (g) => w.rec("suspendGroup", g),
      setScenarioVariable: (i, v) => { w.scenario.set(i, v); w.rec("setScenarioVariable", i, v); },
      log: (level: ScriptLogLevel, m: string) => { w.logs.push(`${level}: ${m}`); },
    };
  }

  /** Host só com os métodos obrigatórios (testa os caminhos padrão do runtime). */
  minimalHost(): ScriptHost {
    const f = this.fullHost();
    return {
      unitPosition: f.unitPosition, groupUnitCount: f.groupUnitCount, diplomacy: f.diplomacy,
      sendMessage: f.sendMessage, setSubobjective: f.setSubobjective, missionComplete: f.missionComplete,
      missionFail: f.missionFail, setDiplomacy: f.setDiplomacy, giveMoney: f.giveMoney, phaseOutUnit: f.phaseOutUnit,
      phaseInUnit: f.phaseInUnit, groupCommand: f.groupCommand, giveAll: f.giveAll, log: f.log,
    };
  }
}

export { HERO_UNIT_ID };
