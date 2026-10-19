/**
 * IA das unidades (o que cada uma decide sozinha), chamada pelo `World` a cada 4 tiques por unidade.
 * Fonte principal: leitura estática do allods2.exe (notes/ai-behaviors.md tem endereços e o que é [exe] × [est]):
 *  - tarefas por unidade (despachante 0x569321): Guard 0x56a5fc, Stand ground 0x56a1fb, Attack 0x56acc8, ocioso 0x56afd9;
 *  - guarda: alvos procurados num raio em volta do POSTO (raio do grupo, mín. MinimalGuardRange = 8); sem alvo volta ao posto;
 *  - Stand ground / ocioso: ataca só o que estiver ao alcance da arma (alvo voador conta +1 de distância para quem não voa);
 *  - fuga/recuo (0x573713): vida ≤ Wimpy com inimigo a ≤ raio+5 → foge (Teleport se souber); vida ≤ Withdraw com inimigo a ≤ 2 → recua;
 *  - conjurador de IA (0x57a769): sorteia uma magia ofensiva conhecida com mana suficiente; Mind > 59 → 30% das vezes usa a arma;
 *  - conjurador de IA ocioso (0x56c592): Heal em si (se ferido) ou no aliado mais ferido; Shield em si;
 *  - autocast das unidades do jogador (0x56bc7b, CTRL+U): nível 1 Heal/Shield, 2 Bless/Haste, 3 proteções/Invisibility.
 * Aproximações nossas: alerta de grupo, revide fora do raio de guarda, reação do herói a ataques à distância, formação.
 */
import { MINIMAL_GUARD_RANGE, type Unit, type World } from "./world";
import { SPELL, isOffensive, type SpellDef } from "./spells";
import { TICKS_PER_SEC, type Order } from "./types";

const sid = (s: SpellDef) => Number(s.id);
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const cheb = (a: Unit, b: Unit) => Math.max(Math.abs(a.cx - b.cx), Math.abs(a.cy - b.cy));

/** Raio de guarda efetivo: o do comando (≥ MinimalGuardRange quando o script manda 0/≤2) [exe 0x5709d9]. */
export function guardRadius(r: number | undefined): number { return !r || r <= 2 ? MINIMAL_GUARD_RANGE : r; }

/** Distância "de ataque" [exe 0x56a1fb/0x556dcd]: alvo voador conta +1 para quem não voa. */
function attackDistance(u: Unit, t: Unit): number {
  const d = Math.max(Math.abs(t.cx - u.cx), Math.abs(t.cy - u.cy)) <= 1 ? 1 : Math.hypot(t.cx - u.cx, t.cy - u.cy);
  return d + (t.flying && !u.flying ? 1 : 0);
}

/** Alvo do "Stand ground": inimigo visível mais próximo ao alcance da arma [exe 0x56a1fb]. */
function standGroundTarget(w: World, u: Unit): Unit | undefined {
  const range = Math.max(1, w.attackRange(u));
  let best: Unit | undefined, bd = Infinity;
  for (const v of w.units) {
    if (v === u || !v.active || !w.isEnemy(u, v) || !w.canSee(u, v)) continue;
    if (Math.abs(v.cx - u.cx) > range + 2 || Math.abs(v.cy - u.cy) > range + 2) continue;
    const d = attackDistance(u, v);
    if (d <= (range <= 1 ? 1 : range + 0.5) && d < bd) { bd = d; best = v; }
  }
  return best;
}

function recentAttacker(w: World, u: Unit, secs: number): Unit | undefined {
  if (!u.lastAttacker || w.tick - u.lastHurtTick > secs * TICKS_PER_SEC) return undefined;
  const a = w.get(u.lastAttacker);
  return a && a.active && a.player !== u.player && w.canSee(u, a) ? a : undefined;
}

function alerted(w: World, u: Unit): Unit | undefined {
  if (!u.alertTarget || w.tick - u.alertTick > 5 * TICKS_PER_SEC) return undefined;
  const a = w.get(u.alertTarget);
  return a && a.active && w.isEnemy(u, a) && w.canSee(u, a) ? a : undefined;
}

/** Ataca `t` (com `resume` = ordem a retomar depois). Conjuradores de IA podem trocar o golpe por magia [exe 0x57a769]. */
function engage(w: World, u: Unit, t: Unit, resume: Order | null = null): void {
  // unidade do jogador invisível não parte para a briga sozinha (atacar desfaz a invisibilidade; só uma ordem do jogador o faz) — missão 77: o ritual dos necromantes
  if (u.player === 1 && !u.isHero && u.hasBuff("invisible")) return;
  const s = pickOffensive(w, u, t);
  if (s) w.command(u, { type: "cast", spell: s.id, target: t.id });
  else w.command(u, { type: "attack", target: t.id });
  u.resume = resume;
}

/** Magia ofensiva para usar contra `t` (unidades que não são o herói): sorteio uniforme entre as conhecidas, com mana, não
 *  defensivas [exe 0x57a769]; com Mind > 59, 30% das vezes prefere a arma. Debuff já ativo no alvo e Control fora de morto-vivo
 *  são descartados [est]. */
function pickOffensive(w: World, u: Unit, t: Unit): SpellDef | null {
  if (u.isHero || !u.spells.length) return null;
  if ((u.stats.mind ?? 0) > 59 && w.rng.int(0, 99) < 30) return null;
  const list = u.spells.filter(s => s.mana <= u.mana && isOffensive(s) &&
    !(s.kind === "debuff" && t.buffs.some(b => b.spell === s.id)) &&
    !(s.kind === "field" && w.areas.some(a => a.spell === s.id && Math.hypot(a.x - t.cx, a.y - t.cy) <= a.radius)));
  if (!list.length) return null;
  return list[w.rng.int(0, list.length - 1)]!;
}

// ------------------------------------------------------------------------------------------------ fuga e recuo

/** Fuga (Wimpy) e recuo (Withdraw) [exe 0x573713 → 0x56cb0c / 0x56cd11]. Devolve true se a unidade está fugindo/recuando. */
function retreatCheck(w: World, u: Unit, radius: number): boolean {
  if (u.order.type === "retreat") return true;
  if (u.state === "attack" || u.state === "cast") return false;
  if (u.wimpyHp > 0 && u.hp <= u.wimpyHp && w.nearestEnemyAny(u, radius + 5)) {
    const tp = u.spells.find(s => sid(s) === SPELL.Teleport && s.mana <= u.mana);
    const c = w.fleeCell(u, tp ? Math.min(tp.range, 12) : 8, radius + 5);
    if (!c) return false;
    w.events.push({ type: "flee", unit: u.id });
    if (tp) { w.command(u, { type: "cast", spell: tp.id, x: c.x, y: c.y }); return true; }
    w.command(u, { type: "retreat" });
    u.fleeX = c.x; u.fleeY = c.y;
    return true;
  }
  if (u.withdrawHp > 0 && u.hp <= u.withdrawHp && w.nearestEnemyAny(u, 2.5)) {
    // recua só entre um golpe e outro (para conseguir atirar) [est]
    if (u.cooldown <= 0 && u.order.type === "attack") return false;
    const c = w.fleeCell(u, 3, 4);
    if (!c) return false;
    w.command(u, { type: "retreat" });
    u.fleeX = c.x; u.fleeY = c.y;
    return true;
  }
  return false;
}

// ------------------------------------------------------------------------------------------------ magias de apoio

function knows(u: Unit, id: number): SpellDef | undefined { return u.spells.find(s => sid(s) === id && s.mana <= u.mana); }

function castOn(w: World, u: Unit, s: SpellDef, t: Unit): boolean {
  if (t !== u && dist(u, t) > s.range + 0.5) return false;
  w.beginCast(u, s, t, t.cx, t.cy, true);
  return true;
}

/** Conjurador de IA ocioso [exe 0x56c592/0x57a999]: Heal em si se ferido, senão no aliado mais ferido ao alcance; Shield em si. */
function casterSupport(w: World, u: Unit): boolean {
  if (u.mana <= 10 || u.cooldown > 0) return false;
  const heal = knows(u, SPELL.Heal);
  if (heal) {
    if (u.hp < u.maxHp) return castOn(w, u, heal, u);
    let best: Unit | undefined, br = 1;
    for (const v of w.unitsInRadius(u.x, u.y, heal.range + 0.5, v => v !== u && !v.helpless && w.isFriend(u, v) && v.hp < v.maxHp)) {
      const r = v.hp / v.maxHp;
      if (r < br) { br = r; best = v; }
    }
    if (best) return castOn(w, u, heal, best);
  }
  const shield = knows(u, SPELL.Shield);
  if (shield && !u.buffs.some(b => b.spell === shield.id) && (recentAttacker(w, u, 10) || w.nearestEnemy(u, w.sightOf(u)))) return castOn(w, u, shield, u);
  return false;
}

/** Pode receber magia de apoio automática (bits de alvo do AutoCasting) [exe 0x56bb53]. */
function canBuff(w: World, u: Unit, t: Unit, flags: number): boolean {
  if (t === u) return true;
  if (t.player === u.player) return (flags & 1) !== 0;
  const d = w.dip[u.player]?.[t.player] ?? 0;
  if (d & 2) return (flags & 2) !== 0;
  if ((d & 3) === 0) return (flags & 4) !== 0;
  return false;
}

/** Em combate (para Bless) [est para o 0x542c90 do exe]. */
const inBattle = (w: World, t: Unit) => w.tick - t.lastHurtTick < 5 * TICKS_PER_SEC || t.order.type === "attack" || t.state === "attack";

/** Autocast das unidades do jogador [exe 0x56bc7b]. Devolve true se começou a lançar. */
export function autocast(w: World, u: Unit): boolean {
  const flags = w.playerAi[u.player]?.autocast ?? 0;
  if (!u.spells.length || u.mana < 5 || !(flags & 8) || u.cooldown > 0) return false;
  const heal = knows(u, SPELL.Heal), shield = knows(u, SPELL.Shield);
  if (heal && u.hp < u.maxHp) return castOn(w, u, heal, u);
  if (shield && !u.buffs.some(b => b.spell === shield.id)) return castOn(w, u, shield, u);
  const friends = w.unitsInRadius(u.x, u.y, w.sightOf(u), v => v !== u && canBuff(w, u, v, flags));
  if (heal) { const t = friends.find(v => v.hp < v.maxHp && dist(u, v) <= heal.range + 0.5); if (t) return castOn(w, u, heal, t); }
  if (!(flags & 0x10) || u.mana < 10) return false;
  const all = [u, ...friends];
  const bless = knows(u, SPELL.Bless), haste = knows(u, SPELL.Haste);
  for (const v of all) {
    if (bless && inBattle(w, v) && !v.hasBuff("bless") && castOn(w, u, bless, v)) return true;
    if (haste && !v.buffs.some(b => b.spell === haste.id) && inBattle(w, v) && castOn(w, u, haste, v)) return true;
  }
  if (!(flags & 0x20) || u.mana < 40) return false;
  for (const v of all) {
    for (const id of [SPELL.ProtAir, SPELL.ProtEarth, SPELL.ProtFire, SPELL.ProtWater]) {
      const s = knows(u, id);
      if (s && !v.buffs.some(b => b.spell === s.id) && castOn(w, u, s, v)) return true;
    }
  }
  const inv = knows(u, SPELL.Invisibility);
  if (inv && !u.hasBuff("invisible")) return castOn(w, u, inv, u);
  return false;
}

// ------------------------------------------------------------------------------------------------ unidades da IA / aliados

/** Pensamento das unidades que não são o herói (monstros, NPCs, mercenários, invocações). */
export function aiThink(w: World, u: Unit): void {
  if (u.state === "attack" || u.state === "cast") return;
  const ai = u.ai;
  // alvo atual ainda vale?
  if (u.order.type === "attack" && !w.validTarget(u, u.order.target)) w.resumeOrNone(u);
  if (u.order.type === "cast" && u.order.target && !w.validTarget(u, u.order.target)) w.resumeOrNone(u);
  const radius = ai.type === "guard" || ai.type === "roam" ? guardRadius(ai.range) : MINIMAL_GUARD_RANGE;
  if (retreatCheck(w, u, radius)) return;
  const busy = u.order.type === "attack" || u.order.type === "cast";
  const tid = u.order.type === "attack" ? u.order.target : u.order.type === "cast" ? u.order.target ?? 0 : 0;
  const human = isHumanSide(w, u);
  // conjurador lutando: entre um golpe e outro pode voltar a lançar magia
  if (busy && u.order.type === "attack" && !human && u.spells.length && u.cooldown <= 0) {
    const t = w.get(u.order.target)!;
    const s = pickOffensive(w, u, t);
    if (s) { const r = u.resume; w.command(u, { type: "cast", spell: s.id, target: t.id }); u.resume = r; return; }
  }
  const sight = w.sightOf(u);
  switch (ai.type) {
    case "move":
      if (u.order.type !== "move") {
        if (Math.max(Math.abs(u.cx - ai.x), Math.abs(u.cy - ai.y)) <= 1) { u.home = { x: u.cx, y: u.cy }; u.ai = { type: "guard", range: MINIMAL_GUARD_RANGE }; }
        else w.command(u, { type: "move", x: ai.x, y: ai.y });
      }
      return;
    case "hold": {
      // Stand ground [exe 0x56a1fb]: só ataca ao alcance, nunca persegue
      if (busy) {
        const t = w.get(tid);
        if (t && attackDistance(u, t) > Math.max(1, w.attackRange(u)) + 0.5) w.command(u, { type: "none" });
        return;
      }
      const e = standGroundTarget(w, u);
      if (e) { engage(w, u, e); return; }
      if (human) autocast(w, u); else casterSupport(w, u);
      return;
    }
    case "defend":
    case "follow": {
      const lead = w.get(ai.unit);
      if (!lead || !lead.active) { u.ai = { type: "guard", range: MINIMAL_GUARD_RANGE }; u.home = { x: u.cx, y: u.cy }; u.formationSlot = -1; return; }
      const far = dist(lead, u) > ai.range + 0.5;
      if (ai.type === "defend") {
        if (busy) {
          // não se afasta demais de quem defende
          if (dist(lead, u) > ai.range + sight) w.command(u, { type: "follow", unit: lead.id, range: Math.max(1, Math.floor(ai.range / 2)) });
          return;
        }
        const t = recentAttacker(w, lead, 10) ?? recentAttacker(w, u, 6) ?? alerted(w, u) ??
          w.nearestEnemy(u, sight, v => dist(v, lead) <= ai.range + 3);
        if (t && dist(t, lead) <= ai.range + sight) { engage(w, u, t); return; }
        if (lead.state !== "move" && (human ? autocast(w, u) : casterSupport(w, u))) return;
      }
      if ((far || u.formationSlot >= 0) && u.order.type !== "follow") w.command(u, { type: "follow", unit: lead.id, range: Math.max(1, Math.floor(ai.range / 2)) });
      return;
    }
    case "swarm": {
      if (busy) return;
      const e = alerted(w, u) ?? w.nearestEnemy(u, sight);
      if (e) { engage(w, u, e); return; }
      if (u.order.type !== "move") {
        if (Math.max(Math.abs(u.cx - ai.x), Math.abs(u.cy - ai.y)) <= 1) { u.home = { x: u.cx, y: u.cy }; u.ai = { type: "guard", range: MINIMAL_GUARD_RANGE }; }
        else w.command(u, { type: "move", x: ai.x, y: ai.y, attackMove: true });
      }
      return;
    }
    case "patrol": {
      if (busy) return;
      const e = alerted(w, u) ?? recentAttacker(w, u, 6) ?? w.nearestEnemy(u, sight);
      if (e) { engage(w, u, e); return; }
      if (u.order.type !== "patrol") w.command(u, { type: "patrol", ax: u.home.x, ay: u.home.y, bx: ai.x, by: ai.y, toB: true });
      return;
    }
    case "roam":
    case "guard": {
      // Guard [exe 0x56a5fc]: alvos num raio em volta do POSTO; sem alvo, volta ao posto
      const post = { x: u.home.x + 0.5, y: u.home.y + 0.5 };
      const reach = radius + sight; // revide/alerta: um pouco além do raio [est]
      if (busy) {
        const t = w.get(tid);
        if (t && dist(t, post) > radius + 0.5) {
          const revenge = (t.id === u.lastAttacker && w.tick - u.lastHurtTick < 3 * TICKS_PER_SEC) || t.id === alerted(w, u)?.id;
          if (!revenge || dist(t, post) > reach) w.command(u, { type: "move", x: u.home.x, y: u.home.y });
        }
        return;
      }
      const e = w.nearestEnemy(u, radius, undefined, u.home);
      if (e) { engage(w, u, e); return; }
      const r = recentAttacker(w, u, 6) ?? alerted(w, u);
      if (r && dist(r, post) <= reach) { engage(w, u, r); return; }
      if (u.order.type === "none" && u.state === "idle") {
        if (human ? autocast(w, u) : casterSupport(w, u)) return;
        if (u.cx !== u.home.x || u.cy !== u.home.y) {
          if (Math.hypot(u.cx - u.home.x, u.cy - u.home.y) > 1.5 || ai.type === "guard") w.command(u, { type: "move", x: u.home.x, y: u.home.y });
        } else if (ai.type === "roam" && u.stats.speed > 0 && w.rng.chance(0.05)) {
          w.command(u, { type: "move", x: u.home.x + w.rng.int(-ai.range, ai.range), y: u.home.y + w.rng.int(-ai.range, ai.range) });
        }
      }
      return;
    }
  }
}

/** Unidade do lado do jogador humano (jogador 1 ou aliado dele)? Usa autocast em vez da IA de conjurador. */
function isHumanSide(w: World, u: Unit): boolean { return u.player === w.humanPlayer; }

// ------------------------------------------------------------------------------------------------ herói

/** Comportamento automático do herói (a ordem do jogador manda; só decide quando parado, vigiando ou defendendo). */
export function heroThink(w: World, u: Unit): void {
  if (u.state === "attack" || u.state === "cast") return;
  const o = u.order;
  if (o.type === "attack" && !w.validTarget(u, o.target)) w.resumeOrNone(u);
  if (o.type === "cast" && o.target && !w.validTarget(u, o.target)) w.resumeOrNone(u);
  const order = u.order;
  // Retreat Mode (opções) só quando o herói não está cumprindo uma ordem direta do jogador [est]
  if ((order.type === "none" || order.type === "hold" || order.type === "guard") && retreatCheck(w, u, MINIMAL_GUARD_RANGE)) return;
  const busy = order.type === "attack" && !!u.target;
  const resume = u.resume;
  if (busy) {
    const t = w.get(u.target)!;
    if (resume?.type === "hold" && attackDistance(u, t) > Math.max(1, w.attackRange(u)) + 0.5) w.resumeOrNone(u);
    else if (resume?.type === "guard" && dist(t, { x: resume.x + 0.5, y: resume.y + 0.5 }) > guardRadius(resume.range) + 0.5) w.resumeOrNone(u);
    else if (resume?.type === "defend") { const lead = w.get(resume.unit); if (lead && dist(lead, u) > resume.range + w.sightOf(u)) w.resumeOrNone(u); }
    // ataque corpo a corpo: autocast entre golpes [exe 0x56aee2]
    else if (w.attackRange(u) < 2 && u.cooldown <= 0 && u.mana >= 5 && u.spells.length) autocast(w, u);
    return;
  }
  switch (order.type) {
    case "none": {
      if (u.state !== "idle") return;
      // ocioso = Stand ground [exe 0x56afac(…,0) → 0x56a1fb]
      const e = standGroundTarget(w, u);
      if (e) { engage(w, u, e, { type: "none" }); return; }
      // reação a ataque de longe (atirador/mago fora do alcance) [est]
      const a = recentAttacker(w, u, 3);
      if (a && dist(a, u) <= w.sightOf(u) + 1) { engage(w, u, a, { type: "none" }); return; }
      autocast(w, u);
      return;
    }
    case "hold": {
      const e = standGroundTarget(w, u);
      if (e) { engage(w, u, e, { type: "hold" }); return; }
      autocast(w, u);
      return;
    }
    case "guard": {
      const r = guardRadius(order.range);
      const post = { x: order.x, y: order.y };
      const e = w.nearestEnemy(u, r, undefined, post) ?? (() => {
        const a = recentAttacker(w, u, 3);
        return a && dist(a, { x: post.x + 0.5, y: post.y + 0.5 }) <= r + w.sightOf(u) ? a : undefined;
      })();
      if (e) { engage(w, u, e, { ...order }); return; }
      if (u.cx === post.x && u.cy === post.y) autocast(w, u);
      return;
    }
    case "defend": {
      const lead = w.get(order.unit);
      if (!lead || !lead.active || lead === u) { w.command(u, { type: "guard", x: u.cx, y: u.cy }); return; }
      const t = recentAttacker(w, lead, 10) ?? recentAttacker(w, u, 6) ?? w.nearestEnemy(u, w.sightOf(u), v => dist(v, lead) <= order.range + 3);
      if (t) { engage(w, u, t, { ...order }); return; }
      if (dist(lead, u) <= order.range + 0.5) autocast(w, u);
      return;
    }
    default:
      return;
  }
}
