/**
 * Implementação do `ScriptHost` (contrato da frente SCRIPT, src/script/host.ts) sobre a simulação (src/sim).
 * Traduz ids do script (`unit#N`, `group#N`, 10001 = herói) para unidades do `World`.
 */
import { FAR_AWAY, HERO_UNIT_ID, type Cell, type GroupCommand, type ScriptHost, type ScriptLogLevel } from "../script";
import type { Unit, World } from "../sim/world";
import { buildSpell, type SpellTable } from "../sim/spells";
import { attachFollowers } from "../sim/behaviors";

export interface HostCallbacks {
  message(n: number): void;
  subobjective(n: number, value: number): void;
  complete(): void;
  fail(cause: number): void;
  giveAll(from: Unit, to: Unit): void;
  money(player: number, amount: number): void;
  log?(level: ScriptLogLevel, msg: string): void;
}

/** Id de item do script (editor) -> id do jogo (items.json): os itens de missão do script são 54..72 = 3662..3680 (banner 54, mapa 61, frascos 64-67...). */
export const QUEST_ITEM_BASE = 3608;
export const gameItem = (n: number): string => String(n > 0 && n < 1000 ? n + QUEST_ITEM_BASE : n);

/** estruturas "Switch 1" / "Switch 2" de structures.json */
const SWITCH_KINDS = new Set([28, 29]);

/**
 * Estado mutável do host que o save guarda (sim/snapshot.ts `MissionSnapshot.host`). Unidades por id da simulação (`Unit.id`).
 * Campos novos (v2) são opcionais: um save v1 só traz `scenarioVars` e `restore` tolera a falta dos demais.
 */
export interface HostState {
  scenarioVars: [number, number][];
  /** vida das estruturas do mapa (alavancas das missões 93-96/103: 0 = ligada, 100 = desligada) */
  buildingHp?: [number, number][];
  /** unidades "caídas" (vida 0 para o script) e os subconjuntos fraca/vinda do mapa */
  dazed?: number[];
  weak?: number[];
  mapDazed?: number[];
  /** id do script -> unidade (o Polymorph troca a unidade que cada id aponta) */
  units?: [number, number][];
  /** grupo -> unidades (o Polymorph troca a forma antiga pela nova nos grupos) */
  groups?: [number, number[]][];
}

export class MissionHost implements ScriptHost {
  /** id do script -> unidade */
  readonly units = new Map<number, Unit>();
  /** id de grupo -> unidades */
  readonly groups = new Map<number, Unit[]>();
  readonly scenarioVars = new Map<number, number>();
  /** unidades do mapa com vida inicial 0 (inconscientes): o script as vê com vida 0 até alguém do jogador se aproximar */
  readonly dazed = new Set<Unit>();
  /** subconjunto de `dazed` deixado com 1 de vida pelo script ("Set Unit Parameter" 6 = 0): acorda também ao ser curado (vida ≥ 25%) */
  readonly weak = new Set<Unit>();
  /** subconjunto de `dazed` que veio da vida 0 do MAPA (refém da 50, druida chefe da 101): ao acordar por proximidade volta à vida cheia (acordar com 5% no meio dos inimigos o matava) */
  readonly mapDazed = new Set<Unit>();
  /** spells.json (para as magias lançadas pelo script); preenchido por buildMission */
  spellTable?: SpellTable;

  /** estruturas do mapa (id do script = `structures[].id`): vida atual (0..100 como no editor; as "alavancas" das missões 93-103 usam 0/100) */
  readonly buildingHp = new Map<number, number>();

  constructor(private readonly world: World, private readonly cb: HostCallbacks) {}

  /** ids das alavancas ("Switch 1/2", structures.json 28 e 29) e onde ficam: o script lê o estado delas por "Health of building" (93-96, 103) */
  readonly switches = new Map<number, { x: number; y: number }>();

  bindStructure(id: number, hp: number, kind?: number, x = 0, y = 0): void {
    this.buildingHp.set(id, hp);
    if (kind != null && SWITCH_KINDS.has(kind & 0xffff)) this.switches.set(id, { x: Math.floor(x), y: Math.floor(y) });
  }

  /**
   * Alavanca acionada pelo jogador (clique numa "Switch"): desligada (vida do mapa, 100) <-> ligada (0). O script lê "desligada" como 1 e "ligada" como 0
   * (`buildingHealth`) [est: 103 testa `> 0` para desligada e `== 0` para ligada; 93-96 abrem o teleporte com `!= 1` nas duas alavancas]. Devolve o novo estado.
   */
  toggleSwitch(id: number): boolean | undefined {
    if (!this.switches.has(id)) return undefined;
    const on = (this.buildingHp.get(id) ?? 0) > 0;
    this.buildingHp.set(id, on ? 0 : 100);
    return on;
  }
  /** id da alavanca mais próxima (≤ `reach` células) de (x,y), para o clique da interface */
  switchNear(x: number, y: number, reach = 1.5): number | undefined {
    let best: number | undefined, bd = reach + 1e-6;
    for (const [id, p] of this.switches) { const d = Math.hypot(p.x - x, p.y - y); if (d <= bd) { bd = d; best = id; } }
    return best;
  }

  // ------------------------------------------------------------------ save (sim/snapshot.ts)
  /** Estado mutável para o save: tudo o que o script/o jogador mudou no host depois do `buildMission`. */
  snapshot(): HostState {
    const ids = (s: Iterable<Unit>): number[] => [...s].map(u => u.id);
    return {
      scenarioVars: [...this.scenarioVars],
      buildingHp: [...this.buildingHp],
      dazed: ids(this.dazed), weak: ids(this.weak), mapDazed: ids(this.mapDazed),
      units: [...this.units].map(([k, u]) => [k, u.id] as [number, number]),
      groups: [...this.groups].map(([g, l]) => [g, ids(l)] as [number, number[]]),
    };
  }

  /** Aplica um estado salvo sobre o host recém-montado (mesmo mapa/herói). Tolera saves antigos (campos ausentes). */
  restore(s: Partial<HostState>): void {
    const w = this.world;
    this.scenarioVars.clear();
    for (const [k, v] of s.scenarioVars ?? []) this.scenarioVars.set(k, v);
    if (s.buildingHp) for (const [id, hp] of s.buildingHp) this.buildingHp.set(id, hp);
    const pick = (ids: number[]): Unit[] => ids.map(id => w.get(id)).filter((u): u is Unit => !!u);
    if (s.units) for (const [k, id] of s.units) { const u = w.get(id); if (u) this.units.set(k, u); }
    if (s.groups) for (const [g, ids] of s.groups) this.groups.set(g, pick(ids));
    if (s.dazed) {
      for (const [set, ids] of [[this.dazed, s.dazed], [this.weak, s.weak ?? []], [this.mapDazed, s.mapDazed ?? []]] as const) { set.clear(); for (const u of pick(ids)) set.add(u); }
    } else {
      // save v1 (sem os conjuntos): quem não está mais inconsciente já acordou
      for (const set of [this.dazed, this.weak, this.mapDazed]) for (const u of [...set]) if (!u.helpless) set.delete(u);
    }
  }

  bindUnit(scriptId: number, u: Unit): void { if (scriptId) this.units.set(scriptId, u); }
  bindGroup(group: number, u: Unit): void {
    let g = this.groups.get(group);
    if (!g) this.groups.set(group, (g = []));
    g.push(u);
  }

  private u(ref: number): Unit | undefined { return this.units.get(ref); }

  // ------------------------------------------------------------------ consultas
  /** Unidades fora de fase (Phase out) continuam medindo distância: ligado na missão 84, em que Tekel (70) é um marcador invisível desde o início
   *  e o script mede a distância até ele (docs/GAPS.md [MISSÕES-E]). Nas demais missões fora de fase = ausente (9999). */
  measurePhased = false;
  unitPosition(ref: number): Cell | null {
    const u = this.u(ref);
    return u && (u.active || (this.measurePhased && u.alive)) ? { x: u.x, y: u.y } : null;
  }
  unitAlive(ref: number): boolean { const u = this.u(ref); return !!u && u.alive; }
  unitParameter(ref: number, param: number): number {
    const u = this.u(ref);
    if (!u || !u.alive) return 0;
    if (param === 6 && this.dazed.has(u)) {
      // unidade "caída" (vida 0 no mapa, ex.: o refém da missão 50): só acorda (vida > 0 para o script) quando alguém do jogador chega perto
      if ((this.weak.has(u) && u.hp >= u.maxHp * 0.25) || this.nearestPlayerUnitDistance(1, Math.floor(u.x), Math.floor(u.y)) <= 3) { this.dazed.delete(u); this.weak.delete(u); u.helpless = false; if (this.mapDazed.delete(u) && u.hp < u.maxHp * 0.25) u.hp = u.maxHp; }
      else return 0;
    }
    return param === 6 ? Math.ceil(u.hp) : 0;
  }
  unitIsAttacking(ref: number): boolean { const u = this.u(ref); return !!u && (u.state === "attack" || u.state === "cast" || u.order.type === "attack"); }
  /** Itens do herói contam para os companheiros (Igles/Dina): ligado na missão 72, em que só a Dina pode usar as runas nos painéis e a mochila do
   *  jogo ainda é só do herói (docs/GAPS.md [MISSÕES-D]); com a Dina carregando a runa, vale o que ela tem. */
  heroItemsCountForCompanions = false;
  private carrier(ref: number, id: string): Unit | undefined {
    const u = this.u(ref);
    if (!u) return undefined;
    if (u.items.includes(id) || !this.heroItemsCountForCompanions || (ref !== 10002 && ref !== 10003)) return u;
    const h = this.hero;
    return h && h.items.includes(id) ? h : u;
  }
  unitHasItem(ref: number, item: number): boolean { const id = gameItem(item); return !!this.carrier(ref, id)?.items.includes(id); }
  unitPlayer(ref: number): number { return this.u(ref)?.player ?? 0; }
  groupUnitCount(g: number): number { return (this.groups.get(g) ?? []).filter(u => u.alive).length; }
  groupUnits(g: number): number[] {
    return (this.groups.get(g) ?? []).filter(u => u.alive).map(u => u.scriptId).filter(id => id > 0);
  }
  playerUnitCount(p: number): number { return this.world.units.filter(u => u.player === p && u.alive).length; }
  playerBuildingCount(): number { return 0; }
  nearestPlayerUnitDistance(p: number, x: number, y: number): number {
    let best = FAR_AWAY;
    for (const u of this.world.units) if (u.player === p && u.active) best = Math.min(best, Math.hypot(Math.floor(u.x) - x, Math.floor(u.y) - y));
    return best;
  }
  diplomacy(a: number, b: number): number { return this.world.diplomacyValue(a, b); }
  money(p: number): number { return this.world.money[p] ?? 0; }
  sackItemCount(x: number, y: number): number { return this.world.loot.filter(l => l.x === x && l.y === y).reduce((s, l) => s + l.items.length + (l.gold ? 1 : 0), 0); }
  buildingHealth(id: number): number { const hp = this.buildingHp.get(id) ?? 0; return this.switches.has(id) ? (hp > 0 ? 1 : 0) : hp; }
  getScenarioVariable(i: number): number { return this.scenarioVars.get(i) ?? 0; }

  // ------------------------------------------------------------------ comandos
  /** gancho do motor para falas que o script não acompanha de ação (missão 77: o necromante "cobre" o grupo com invisibilidade na fala 10) */
  onMessage?: (n: number) => void;
  sendMessage(n: number): void { this.cb.message(n); this.onMessage?.(n); }
  setSubobjective(n: number, value: number): void { this.cb.subobjective(n, value); }
  missionComplete(): void { this.cb.complete(); }
  missionFail(cause: number): void { this.cb.fail(cause); }
  setDiplomacy(a: number, b: number, value: number): void { this.world.setDiplomacy(a, b, value); }
  giveMoney(p: number, amount: number): void {
    this.world.money[p] = (this.world.money[p] ?? 0) + amount;
    this.cb.money(p, amount);
  }
  phaseOutUnit(ref: number): void { const u = this.u(ref); if (u) this.world.phaseOut(u); }
  phaseInUnit(ref: number): void { const u = this.u(ref); if (u) this.world.phaseIn(u); }
  phaseOutGroup(g: number): void { for (const u of this.groups.get(g) ?? []) this.world.phaseOut(u); }
  phaseInGroup(g: number): void { for (const u of this.groups.get(g) ?? []) this.world.phaseIn(u); }
  teleportUnit(ref: number, x: number, y: number): void { const u = this.u(ref); if (u) this.world.teleport(u, x, y); }
  setUnitParameter(ref: number, param: number, value: number): void {
    const u = this.u(ref);
    if (!u || !u.alive || param !== 6) return;
    u.hp = Math.max(1, Math.min(u.maxHp, value));
    // vida 0 pelo script (ogro meio morto da missão 74): fica com 1 de vida e o script o vê com 0 até alguém do jogador chegar perto
    // ou a vida passar de 25% (cura); sem isso o clamp a 1 faria o gatilho "Ogre healed" disparar no primeiro ciclo
    if (value <= 0) { this.dazed.add(u); this.weak.add(u); u.helpless = true; } else { this.dazed.delete(u); this.weak.delete(u); u.helpless = false; }
  }
  changeUnitOwner(ref: number, p: number): void { const u = this.u(ref); if (u) this.setOwner(u, p); }
  changeGroupOwner(g: number, p: number): void { for (const u of this.groups.get(g) ?? []) this.setOwner(u, p); }
  /** Troca de dono. Quem passa para o jogador 1 (Xara da 63, druidas 60/62 da 62) acompanha o herói como os companheiros (formação/autocast,
   *  `attachFollowers`); quem sai do jogador 1 volta a guardar o lugar onde está. */
  private setOwner(u: Unit, p: number): void {
    const was = u.player;
    u.player = p;
    const hero = this.hero;
    if (p === 1 && was !== 1 && hero && u !== hero && u.alive) attachFollowers(this.world, hero, [u], 3);
    else if (p !== 1 && was === 1 && u !== hero && u.ai?.type === "defend") { u.home = { x: u.cx, y: u.cy }; u.ai = { type: "guard", range: 8 }; this.world.command(u, { type: "none" }); }
  }
  suspendGroup(g: number): void { for (const u of this.groups.get(g) ?? []) { u.suspended = true; this.world.command(u, { type: "none" }); } }
  addItem(ref: number, item: number): void { this.u(ref)?.items.push(gameItem(item)); }
  removeItem(ref: number, item: number): void { const id = gameItem(item), u = this.carrier(ref, id); if (u) u.items = u.items.filter(i => i !== id); }
  giveItem(from: number, to: number, item: number): void { this.removeItem(from, item); this.addItem(to, item); }
  setBuildingHealth(id: number, hp: number): void { if (this.buildingHp.has(id)) this.buildingHp.set(id, Math.max(0, hp)); }
  /** "Drop all": larga ouro e itens num saco na célula da unidade. */
  dropAll(ref: number): void {
    const u = this.u(ref);
    if (!u || (!u.items.length && !u.gold)) return;
    this.world.addLoot(u.cx, u.cy, u.gold, u.items);
    u.items = []; u.gold = 0;
  }
  removeItemFromEverybody(item: number): void {
    const id = gameItem(item);
    for (const u of this.world.units) if (u.items.includes(id)) u.items = u.items.filter(i => i !== id);
    for (const l of this.world.loot) if (l.items.includes(id)) l.items = l.items.filter(i => i !== id);
  }
  /** "Polymorph unit": a forma verdadeira (p0) sai e a forma polimorfada (p1; escondida desde o início da missão por
   *  buildMission) entra no lugar dela, com a mesma proporção de vida. */
  polymorph(trueForm: number, polymorphForm: number): void {
    const a = this.u(trueForm), b = this.u(polymorphForm);
    if (!a || !b) return;
    this.world.phaseOut(a);
    this.world.phaseIn(b);
    this.world.teleport(b, a.cx, a.cy);
    b.player = a.player; b.dir = a.dir;
    if (b.alive) b.hp = Math.max(1, Math.round(b.maxHp * (a.maxHp > 0 ? a.hp / a.maxHp : 1)));
    if (a.ai) b.ai = a.ai;
    // o script continua falando da unidade pelos dois ids (missão 31: "Blacksmith to hero" mede 101 depois do polymorph; 42: dragão 30/126):
    // os dois ids passam a apontar para a nova forma, que também herda os grupos da antiga
    this.units.set(trueForm, b); this.units.set(polymorphForm, b);
    for (const g of this.groups.values()) { const i = g.indexOf(a); if (i >= 0) { if (g.includes(b)) g.splice(i, 1); else g[i] = b; } }
    a.state = "dead"; a.hp = 0; // a forma antiga sai de cena sem morte (não conta em grupos/jogador, não dispara onDeath)
  }
  /** "Make spell effect": magia lançada do ponto de origem na unidade que estiver no ponto de destino (sem unidade: ignora). */
  spellEffect(fx: number, fy: number, tx: number, ty: number, spell: number, power: number): void {
    let best: Unit | undefined, bd = 2.01; // ≤ 2 células do destino
    for (const u of this.world.units) {
      if (!u.active || !u.alive) continue;
      const d = Math.hypot(u.x - (tx + 0.5), u.y - (ty + 0.5));
      if (d < bd) { bd = d; best = u; }
    }
    const def = buildSpell(spell, this.spellTable?.[String(spell)], power);
    // campos/paredes (Poison Cloud no poço da missão 60) viram área NO PONTO de destino, haja ou não alguém lá; o resto precisa de uma unidade
    if (def.kind === "field" || def.kind === "wall") this.world.castAtPoint(def, fx, fy, tx, ty);
    else if (best) this.world.castFromPoint(def, fx, fy, best);
  }
  /** "Set trap": armadilha persistente no mundo (Teleport da missão 53: leva quem pisar em (15,121) para (13,22)). */
  setTrap(spell: number, power: number, tx: number, ty: number, sx: number, sy: number, gx: number, gy: number): void {
    this.world.addTrap({ x: tx, y: ty, spell: buildSpell(spell, this.spellTable?.[String(spell)], power), fromX: sx, fromY: sy, toX: gx, toY: gy });
  }
  /** "Tile Spell Duration" (missão 71: ponte bloqueada pela Wall of Earth até o segundo papo com o rei). */
  setTileSpellDuration(x: number, y: number, spell: number, duration: number): void {
    if (!this.world.setAreaDuration(x, y, spell, duration)) this.log("info", `Tile Spell Duration: sem a magia ${spell} em (${x},${y})`);
  }
  /** "Spell on Tile": 1 se há área de magia da camada `layer` (spells.ts `spellLayer`: 0 fogo/gelo, 2 névoa, 3 parede de pedra) na célula, senão 0 [est]. */
  spellOnTile(x: number, y: number, layer = 0): number { return this.world.areaOnLayer(x, y, layer) ? 1 : 0; }
  /** "Unit Spell Duration" (missão 96: Stone Curse "permanente" nas estátuas): o efeito da magia na unidade passa a durar `duration` tiques. */
  setUnitSpellDuration(ref: number, spell: number, duration: number): void {
    const u = this.u(ref);
    if (!u || !this.world.setBuffDuration(u, spell, duration)) this.log("info", `Unit Spell Duration: unidade ${ref} sem a magia ${spell}`);
  }
  /** "Spell on Unit": a unidade tem um efeito (buff/debuff) da magia. */
  unitHasSpell(ref: number, spell: number): boolean { const u = this.u(ref); return !!u && (u.buffs.some(b => Number(b.spell) === spell) || this.world.exeFxHas(u, spell)); }
  setFormation(): void { /* formações do grupo: sem efeito no motor (docs/GAPS.md) */ }
  setScenarioVariable(i: number, v: number): void { this.scenarioVars.set(i, v); }
  /** "Cast spell to unit": magia lançada de um ponto (sem conjurador) na unidade (World.castFromPoint, frente MOTOR-C). */
  castSpellOnUnit(fromX: number, fromY: number, unit: number, spell: number, power: number): void {
    const t = this.u(unit);
    if (!t || !t.active) return;
    this.world.castFromPoint(buildSpell(spell, this.spellTable?.[String(spell)], power), fromX, fromY, t);
  }
  giveAll(from: number, to: number): void {
    const a = this.u(from), b = this.u(to);
    if (!a || !b) return;
    b.items.push(...a.items); a.items = [];
    if (a.gold) { b.gold += a.gold; a.gold = 0; }
    this.cb.giveAll(a, b);
  }

  groupCommand(g: number, cmd: GroupCommand): void {
    const list = (this.groups.get(g) ?? []).filter(u => u.alive);
    for (const u of list) {
      u.suspended = false;
      switch (cmd.type) {
        // alcances [exe 0x570aba/0x5709d9]: guard com raio 0 = MinimalGuardRange (8); dwell = guard com raio mínimo 20
        case "guard": u.home = { x: u.cx, y: u.cy }; u.ai = { type: "guard", range: cmd.range > 0 ? cmd.range : 8 }; break;
        case "dwell": u.home = { x: u.cx, y: u.cy }; u.ai = { type: "guard", range: Math.max(cmd.range, 20) }; break;
        case "standGround": u.ai = { type: "hold" }; this.world.command(u, { type: "none" }); break;
        case "move": u.ai = { type: "move", x: cmd.x, y: cmd.y }; this.world.command(u, { type: "move", x: cmd.x, y: cmd.y }); break;
        case "swarm": case "swarm2": u.ai = { type: "swarm", x: cmd.x, y: cmd.y }; break;
        case "attack": {
          // perseguir a vítima de longe (os morcegos da missão 60 vão atrás da maga): "swarm" não solta o alvo pela distância do posto, como o guard faria
          const v = this.u(cmd.victim);
          if (v) { u.ai = { type: "swarm", x: v.cx, y: v.cy }; this.world.command(u, { type: "attack", target: v.id }); }
          break;
        }
        case "defend": { const v = this.u(cmd.unit); if (v) u.ai = { type: "defend", unit: v.id, range: Math.max(1, cmd.range) }; break; }
        case "follow": { const v = this.u(cmd.unit); if (v) u.ai = { type: "follow", unit: v.id, range: Math.max(1, cmd.range) }; break; }
        case "patrol": u.home = { x: u.cx, y: u.cy }; u.ai = { type: "patrol", x: cmd.x, y: cmd.y }; break;
        case "roam": u.home = { x: u.cx, y: u.cy }; u.ai = { type: "roam", range: 5 }; break;
        default: this.log("warn", `comando de grupo não suportado: ${JSON.stringify(cmd)}`);
      }
    }
  }

  log(level: ScriptLogLevel, msg: string): void {
    if (this.cb.log) this.cb.log(level, msg);
    else if (level === "warn") console.warn("[script]", msg);
  }

  /** O herói (10001). */
  get hero(): Unit | undefined { return this.u(HERO_UNIT_ID); }
}
