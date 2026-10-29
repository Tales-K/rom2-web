/**
 * Grupo do jogador na missão: quais unidades o jogador comanda e como uma ordem da interface vira ordem da simulação.
 *
 * O herói obedece a `world.command` direto (heroThink respeita a ordem). Os aliados (Igles, Dina, mercenários, unidades que o
 * script passou ao jogador 1: Xara, druidas, Putnik, necromantes) são governados por `Unit.ai` (aiThink: "defend" o herói por
 * padrão), que reemitiria "seguir" por cima de qualquer ordem solta. Por isso a ordem do jogador também troca o modo de IA, com
 * a mesma convenção do host de script (mission/host.ts groupCommand): mover = ai "move", atacar/enxamear = "swarm", guardar =
 * "guard" no posto atual, stand ground = "hold", defender = "defend". Retirada: a unidade fica suspensa (sem IA) até chegar ao
 * destino da fuga e então guarda o ponto onde parou.
 */
import type { Order } from "../sim/types";
import { MINIMAL_GUARD_RANGE, type Unit, type World } from "../sim/world";

/** Unidade do lado do jogador (comandável)? */
export function isOwn(hero: Unit, u: Unit | undefined): u is Unit { return !!u && u.player === hero.player; }

/** Integrantes do grupo para o painel: o herói e as unidades do jogador criadas pelo mapa/campanha/script (sem invocações). */
export function partyMembers(world: World, hero: Unit): Unit[] {
  const out: Unit[] = [hero];
  for (const u of world.units) if (u !== hero && u.player === hero.player && !u.dynamic) out.push(u);
  return out;
}

export class PartyControl {
  /** unidades em retirada que este controle suspendeu (a IA volta quando a fuga termina) */
  private retreating = new Set<number>();

  /** Dá a ordem `o` a `u` (qualquer unidade do jogador). */
  order(world: World, u: Unit, o: Order): void {
    if (!u.active) return;
    if (u.isHero) { world.command(u, o, true); return; }
    this.release(u, false);
    // unidade congelada pelo script (suspendGroup): só a ordem, a IA continua desligada
    if (u.suspended) { world.command(u, o, true); return; }
    const cell = { x: u.cx, y: u.cy };
    switch (o.type) {
      case "move":
        u.ai = o.attackMove ? { type: "swarm", x: o.x, y: o.y } : { type: "move", x: o.x, y: o.y };
        world.command(u, o, true);
        break;
      case "attack": {
        const t = world.get(o.target);
        // depois de matar, procura o próximo inimigo por perto e só então guarda o ponto do alvo
        u.ai = { type: "swarm", x: t ? t.cx : cell.x, y: t ? t.cy : cell.y };
        world.command(u, o, true);
        break;
      }
      case "guard":
        u.home = { x: o.x, y: o.y };
        u.ai = { type: "guard", range: o.range ?? MINIMAL_GUARD_RANGE };
        world.command(u, { type: "none" });
        break;
      case "hold":
        u.ai = { type: "hold" };
        world.command(u, { type: "none" });
        break;
      case "defend":
        u.ai = { type: "defend", unit: o.unit, range: Math.max(1, o.range) };
        world.command(u, { type: "none" });
        break;
      case "retreat":
        world.command(u, o, true);
        u.suspended = true;
        this.retreating.add(u.id);
        break;
      case "cast":
        if (u.ai.type === "move" || u.ai.type === "swarm" || u.ai.type === "patrol") { u.home = cell; u.ai = { type: "guard", range: MINIMAL_GUARD_RANGE }; }
        world.command(u, o, true);
        break;
      case "pickup":
        u.home = { x: o.x, y: o.y };
        u.ai = { type: "guard", range: MINIMAL_GUARD_RANGE };
        world.command(u, o, true);
        break;
      default:
        world.command(u, o, true);
    }
  }

  /** Para o save (MissionUiState.retreating): ids das unidades em retirada. */
  snapshot(): number[] { return [...this.retreating]; }
  /** Aplica o save: sem isto a unidade suspensa pela retirada nunca voltaria a ter IA depois de carregar. */
  restore(ids: readonly number[] | undefined): void {
    this.retreating.clear();
    for (const id of ids ?? []) this.retreating.add(id);
  }

  /** Volta a IA das unidades cuja retirada terminou (a cada quadro). */
  step(world: World): void {
    if (!this.retreating.size) return;
    for (const id of [...this.retreating]) {
      const u = world.get(id);
      if (!u || !u.active) { this.retreating.delete(id); continue; }
      if (u.order.type === "retreat") continue;
      this.release(u, true);
    }
  }

  private release(u: Unit, settle: boolean): void {
    if (!this.retreating.delete(u.id)) return;
    u.suspended = false;
    if (settle) { u.home = { x: u.cx, y: u.cy }; u.ai = { type: "guard", range: MINIMAL_GUARD_RANGE }; }
  }
}
