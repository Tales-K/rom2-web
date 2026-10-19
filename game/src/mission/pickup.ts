/**
 * Pegar item do chão pela interface (clique no saco / cursor "pickup"): regra única usada pelo clique e pelo cursor da MissionScene.
 * O saco (`World.loot`) ocupa a célula onde a unidade morreu / onde o script largou o item (missões 80 coroa, 91 ingrediente, 102 amuleto, 92-96
 * prêmios dos santuários). Antes só valia se o clique caísse numa célula sem nenhuma unidade "pickável" por perto: a caixa de acerto das unidades
 * (view.pick, 12-28 px de meia-largura) engolia o clique e o herói atacava o orc ao lado em vez de recolher a coroa do xamã morto no meio do bando.
 * Agora o saco tem prioridade sobre a unidade pickada, a menos que alguém esteja EM CIMA do saco (aí o clique é nessa unidade).
 */
import type { Unit, World } from "../sim/world";

export type Sack = World["loot"][number];

/** O saco que um clique na célula (cx, cy) recolhe para `actor` (o herói ou o aliado comandado); undefined se não há saco ou há outra unidade sobre ele. */
export function sackAtCell(world: World, cx: number, cy: number, actor?: Unit): Sack | undefined {
  const sack = world.loot.find(l => l.x === cx && l.y === cy);
  if (!sack) return undefined;
  const on = world.unitAtCell(cx, cy);
  return on && on !== actor && on.active ? undefined : sack;
}

/** Texto do aviso depois de recolher um saco: "Picked up 500 gold, Crown piece" (undefined se o saco estava vazio). */
export function pickupText(e: { gold: number; items?: string[] }, itemName: (id: string) => string): string | undefined {
  const parts: string[] = [];
  if (e.gold > 0) parts.push(`${e.gold} gold`);
  const count = new Map<string, number>();
  for (const id of e.items ?? []) count.set(id, (count.get(id) ?? 0) + 1);
  for (const [id, n] of count) parts.push(n > 1 ? `${itemName(id)} x${n}` : itemName(id));
  return parts.length ? `Picked up ${parts.join(", ")}` : undefined;
}
