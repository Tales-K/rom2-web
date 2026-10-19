/**
 * "Andar até e usar" pela interface (alavancas das missões 93-96 e 103; serve para qualquer estrutura clicável): o herói (ou o aliado
 * comandado) recebe uma ordem de mover até uma célula livre ao lado do alvo e, quando chega ao alcance, a ação roda uma vez.
 * É o mesmo fluxo de "pegar item" (mission/pickup.ts: ordem + chegada), só que a chegada dispara um callback da cena em vez de
 * `World.pickupAt`. Qualquer outra ordem dada à unidade no caminho cancela o uso.
 */
import type { Order } from "../sim/types";
import type { Unit, World } from "../sim/world";
import type { MissionHost } from "./host";

/** Alcance do uso, em células (Chebyshev entre a célula da unidade e a da estrutura): encostado, inclusive na diagonal. */
export const USE_REACH = 1;

/** Estrutura "Switch" cuja pegada ou a imagem logo acima (a sprite 32x64 sobe 1 célula) contém a célula (cx, cy); devolve o id do script. */
export function switchAtCell(host: MissionHost, cx: number, cy: number): number | undefined {
  for (const [id, p] of host.switches) if (cx === p.x && (cy === p.y || cy === p.y - 1)) return id;
  return undefined;
}

const reach = (u: Unit, x: number, y: number): number => Math.max(Math.abs(u.cx - x), Math.abs(u.cy - y));

/** Célula livre ao lado de (x, y) mais perto da unidade (a estrutura em si é intransitável); undefined se não há. */
export function approachCell(world: World, u: Unit, x: number, y: number): { x: number; y: number } | undefined {
  const g = world.grid;
  let best: { x: number; y: number } | undefined, bd = Infinity;
  for (let dy = -USE_REACH; dy <= USE_REACH; dy++) for (let dx = -USE_REACH; dx <= USE_REACH; dx++) {
    if (!dx && !dy) continue;
    const cx = x + dx, cy = y + dy;
    if (cx < 0 || cy < 0 || cx >= g.w || cy >= g.h || !g.walkable(cx, cy)) continue;
    const d = Math.hypot(cx - u.cx, cy - u.cy);
    if (d < bd) { bd = d; best = { x: cx, y: cy }; }
  }
  return best ?? g.nearestFree(x, y, false, 4, u.id) ?? undefined;
}

interface Pending { unit: number; x: number; y: number; order: Order; act(): void; tag?: number; }

/** Pedido de "andar e usar" no save (MissionUiState.walk): a ação (closure) é refeita pela cena a partir de `tag`. */
export interface WalkState { unit: number; x: number; y: number; tag?: number; }

export class WalkThenUse {
  private pending?: Pending;

  /**
   * Manda `u` até a estrutura em (x, y) e roda `act` ao chegar (na hora, se já está ao alcance). `give` emite a ordem de mover
   * (a cena passa por PartyControl para o aliado também parar de seguir). Devolve false se não há por onde chegar.
   */
  start(world: World, u: Unit, x: number, y: number, give: (o: Order) => void, act: () => void, tag?: number): boolean {
    this.pending = undefined;
    if (reach(u, x, y) <= USE_REACH) { act(); return true; }
    const c = approachCell(world, u, x, y);
    if (!c) return false;
    const order: Order = { type: "move", x: c.x, y: c.y };
    give(order);
    this.pending = { unit: u.id, x, y, order: u.order, act, tag };
    return true;
  }

  cancel(): void { this.pending = undefined; }

  /** Para o save: o pedido em andamento (sem a closure). */
  snapshot(): WalkState | null { const p = this.pending; return p ? { unit: p.unit, x: p.x, y: p.y, ...(p.tag != null ? { tag: p.tag } : {}) } : null; }
  /** Aplica o save: refaz o pedido com a ação `act` (a cena a reconstrói pelo `tag`); a ordem de mover da unidade já voltou com a simulação. */
  restore(world: World, s: WalkState | null | undefined, act: (tag?: number) => (() => void) | undefined): void {
    this.pending = undefined;
    const u = s && world.get(s.unit);
    const a = s && act(s.tag);
    if (s && u && u.alive && a) this.pending = { unit: s.unit, x: s.x, y: s.y, order: u.order, act: a, tag: s.tag };
  }
  get active(): boolean { return !!this.pending; }

  /** Chamado a cada quadro: roda a ação na chegada; descarta o pedido se a unidade morreu ou recebeu outra ordem. */
  step(world: World): void {
    const p = this.pending;
    if (!p) return;
    const u = world.get(p.unit);
    if (!u || !u.alive) { this.pending = undefined; return; }
    if (reach(u, p.x, p.y) <= USE_REACH) { this.pending = undefined; p.act(); return; }
    // terminou o caminho (ordem virou "none") ou recebeu outra ordem sem chegar ao alcance: desiste
    if (u.order !== p.order) this.pending = undefined;
  }
}
