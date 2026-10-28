/**
 * O que SOBROU do motor antigo da IA depois da porta do pensamento (etapa 9: sim/exe/think.ts, tasks.ts, orders.ts — grupos, tarefas
 * por unidade e ordens do cliente/script, 1×/s). Aqui ficam:
 *  - `legacyThink`: os modos sem tratador executado no corpus (exec 0 → NotPorted nos tratadores 0x56d5b9 defend, 0x56d638 follow,
 *    0x56dafe/0x56a909 still): "defend"/"follow" dos aliados do jogador (party.ts) e dos grupos do script, e as ordens defend/still/follow
 *    do herói. Aproximações nossas; a `World` os marca `legacyMode` (comando 0 no grupo, fora do despachante 0x569321).
 *  - as magias que a etapa 8b ainda não portou, chamadas pelos ganchos do pensamento portado: `pickOffensive` (AI_CasterOffensiveSpell
 *    0x57a769), `autocast` (AI_Autocast 0x56bc7b, CTRL+U), `exeFlee` (fuga por Teleport 0x56cb8c/0x56cef3) e `casterSupport`
 *    (AI_IdleCasterSupport 0x56c592 — esse já é a porta, pelo adaptador da World).
 *  - `guardRadius`: a regra do raio do Guard (AI_GroupCmd_Guard 0x5709d9 → 0x57026e), usada pelos testes.
 */
import { canRevive } from "./necro";
import { MINIMAL_GUARD_RANGE, type Unit, type World } from "./world";
import { SPELL, type SpellDef } from "./spells";
import { TICKS_PER_SEC, type Order } from "./types";

const sid = (s: SpellDef) => Number(s.id);
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** Raio de guarda do GRUPO [exe 0x5709d9 → 0x57026e → 0x56f850]: a geometria do grupo dá `max(distância ao centroide + scanRange)`
 *  de cada unidade (`grupo+0x3c +0x2c`; unidade sozinha = o próprio scanRange, `+0xa5` = visão truncada); o comando Guard sobe isso
 *  até o parâmetro (> 0) ou, sem parâmetro, até MinimalGuardRange (8). Ex.: Skrakan (visão 7,84) → max(7, 8) = 8; um monstro de visão
 *  10 guarda 10. O raio da UNIDADE (5, `UNIT_GUARD_RADIUS`) é outro: só vale para o Wimpy e a fuga. */
export function guardRadius(r: number | undefined, sight = 0): number {
  const scan = Math.max(0, Math.floor(sight));
  return r && r > 0 ? Math.max(r, scan) : Math.max(MINIMAL_GUARD_RANGE, scan);
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
export function engage(w: World, u: Unit, t: Unit, resume: Order | null = null): void {
  // unidade do jogador invisível não parte para a briga sozinha (atacar desfaz a invisibilidade; só uma ordem do jogador o faz) — missão 77: o ritual dos necromantes
  if (u.player === 1 && !u.isHero && u.hasBuff("invisible")) return;
  const s = t.active ? pickOffensive(w, u, t) : null;   // em quem caiu só o golpe da arma (a ordem de magia em alvo caído é cancelada)
  if (s) w.command(u, castAt(u, s, t));
  else w.command(u, { type: "attack", target: t.id });
  u.resume = resume;
  // decisão da própria IA (não mensagem do cliente): vale no próximo pensamento 1×/s, sem a regra do "mesmo tique" (World.step)
  u.orderTick = -1e9;
}

/** Ordem de Heal em quem ainda está morrendo (pode levantar) [exe 0x51a2b8] — não cancela a ordem. */
function healsDying(w: World, u: Unit, spell: string, target: number): boolean {
  const t = w.get(target), s = u.spells.find(x => x.id === spell);
  return !!t && !!s && s.kind === "heal" && canRevive(w, u, t);
}

/** Ordem de lançar `s` "no alvo" da IA: Summon sai em quem lança (alcance 0; a criatura nasce perto dele) [exe 0x51a595]. */
export function castAt(u: Unit, s: SpellDef, t: Unit): Order {
  return { type: "cast", spell: s.id, target: s.kind === "summon" ? u.id : t.id };
}

/** Magia da IA contra `t` [exe 0x57a769, leitura LAB notes/ai-original.md]: Mind > 59 → `rand(100) < 30` usa a arma; senão lista, na
 *  ordem dos ids **1..28** (o laço para antes de 29: Slow nunca é escolhida), as magias conhecidas com custo ≤ mana e NÃO defensivas
 *  (+0xa; Teleport, Heal, proteções, Bless, Haste, Invisibility, Light, Shield são defensivas) e sorteia uma (`rand() × n >> 15`).
 *  Sem filtro de alvo: Animate Dead/Summon/Wall of Earth/Darkness entram no sorteio e são lançadas NO ALVO de combate — Animate Dead
 *  num vivo não acha corpo e só gasta a mana [exe 0x51a91f]; Curse/Stone Curse podem repetir num alvo já afetado.
 *  Conferido no original (sonda --cast-probe, Skrakan com Lightning/Stone Curse, 44 lançamentos em 2 execuções: 22 × 22, Stone Curse
 *  repetido com o herói já petrificado): é este sorteio uniforme. A rotina 0x57a608 ("Prismatic > Stone Curse se o alvo não tem
 *  0x40000 > Lightning > Fire Arrow") não tem chamador nem ponteiro no exe e o comportamento medido a contradiz — código morto. O
 *  exe sorteia a cada pensamento (1/s, tique ≡ 7 mod 16) e lança o último sorteio quando a espera acaba; aqui sorteamos ao lançar
 *  (mesma distribuição). Stone Curse "a cada 2,3 s" × Lightning "a cada 1,5 s" vem da espera por magia (`castTiming`, nível 20 × 10). */
export function pickOffensive(w: World, u: Unit, t: Unit): SpellDef | null {
  void t;
  if (u.isHero || !u.spells.length) return null;
  if ((u.stats.mind ?? 0) > 59 && w.rng.scaled(100, 0x57a7b8) < 30) return null;
  const list = u.spells.filter(s => { const id = Number(s.base ?? s.id); return id >= 1 && id <= 28 && !s.defensive && s.mana <= u.mana; })
    .sort((a, b) => Number(a.base ?? a.id) - Number(b.base ?? b.id));
  if (!list.length) return null;
  return list[w.rng.scaled(list.length, 0x57a862)]!;
}

// ------------------------------------------------------------------------------------------------ fuga e recuo

/** Fuga do exe [0x56c9bc/0x56cb8c (Wimpy), 0x56ce0f/0x56cef3 (Withdraw)]: com Teleport conhecido e mana ≥ custo → Teleport ao ponto a
 *  `tpDist` células (Wimpy: scanRange+1; Withdraw: scanRange−1) longe do centroide dos inimigos; senão anda até o ponto a 3 células.
 *  Recalculado a cada pensamento (sem tempo mínimo; sem recarga além da mana). Chamada pelos ganchos `fleeTeleport`/`withdrawTeleport`
 *  do pensamento portado (0x56cb8c/0x56cef3: exec 0 no corpus). */
export function exeFlee(w: World, u: Unit, foes: Unit[], tpDist: number, nearRadius?: number): boolean {
  const tp = u.spells.find(s => sid(s) === SPELL.Teleport && s.mana <= u.mana);
  if (tp && u.order.type === "cast" && u.order.spell === tp.id) return true;
  // [0x56cb8c, telemetria do original: scratch/demo_wimpy/r11] com Teleport (Wimpy) o ponto de fuga é o centroide só dos inimigos a
  // Chebyshev ≤ raio de guarda da PRÓPRIA unidade (não dos de raio+5 que disparam a fuga): no 2º salto o Skrakan fugiu de um troll a 5
  // células e ignorou o herói a 9. Sem nenhum inimigo nesse raio o exe chama 0x56afac(0) → 0x56d52b: tarefa Stand ground (0xc) com
  // POSTO = célula atual (sonda c2: tarefa 12 logo no pouso) — cura-se e, recuperado do Wimpy, volta a lançar no alvo que a guarda do
  // grupo lhe dá (grupo+0x20 = herói) dali mesmo, sem voltar ao posto antigo.
  if (tp && nearRadius !== undefined) {
    const near = foes.filter(v => Math.abs(v.cx - u.cx) <= nearRadius && Math.abs(v.cy - u.cy) <= nearRadius);
    if (!near.length) {
      if (u.order.type !== "none") w.command(u, { type: "none" });
      u.home = { x: u.cx, y: u.cy };
      casterSupport(w, u);
      return true;
    }
    foes = near;
  }
  if (u.order.type !== "retreat") w.events.push({ type: "flee", unit: u.id });
  if (tp) {
    const c = w.exeFleePoint(u, foes, tpDist);
    // [est] ponto além do alcance do Teleport (1 + p div 3): o exe manda lançar no ponto (0x56969c) e não sabemos se anda antes; aqui o
    // ponto é trazido para dentro do alcance na mesma reta, para o Teleport sair já
    const d = Math.hypot(c.x - u.cx, c.y - u.cy);
    if (d > tp.range && d > 0) { const k = tp.range / d; c.x = Math.round(u.cx + (c.x - u.cx) * k); c.y = Math.round(u.cy + (c.y - u.cy) * k); }
    w.command(u, { type: "cast", spell: tp.id, x: c.x, y: c.y });
    return true;
  }
  const p = w.exeFleePoint(u, foes, 3);
  const c = w.grid.passable(p.x, p.y, u.flying) ? p : w.grid.nearestFree(p.x, p.y, u.flying, 2, u.id) ?? w.fleeCell(u, 3, 8);
  if (!c) return false;
  if (u.order.type === "retreat" && u.fleeX === c.x && u.fleeY === c.y) return true;
  w.command(u, { type: "retreat" });
  u.fleeX = c.x; u.fleeY = c.y;
  return true;
}

// ------------------------------------------------------------------------------------------------ magias de apoio

function knows(u: Unit, id: number): SpellDef | undefined { return u.spells.find(s => sid(s) === id && s.mana <= u.mana); }

function castOn(w: World, u: Unit, s: SpellDef, t: Unit): boolean {
  if (u.state === "attack" || u.state === "cast") return false;   // pensamento no meio de uma ação: o apoio fica para depois
  if (t !== u && dist(u, t) > s.range + 0.5) return false;
  w.castNow(u, s, t);   // sub-ação 2 do exe (a máquina gasta a mana e lança depois da carga); a ordem da unidade fica
  return true;
}

/** Conjurador de IA ocioso: a porta de AI_IdleCasterSupport 0x56c592 / AI_CasterShield 0x57a999 (sim/exe/think.ts) pelo adaptador da
 *  World; true se ficou com a tarefa 8 (magia). */
export function casterSupport(w: World, u: Unit): boolean {
  return w.exeIdleCasterSupport(u);
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

/** Autocast das unidades do jogador [exe 0x56bc7b; gancho `autocast` do pensamento portado]. Devolve true se começou a lançar. */
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

// ------------------------------------------------------------------------------------------------ modos sem tratador portado

/** Unidade do lado do jogador humano (jogador 1 ou aliado dele)? Usa autocast em vez da IA de conjurador. */
function isHumanSide(w: World, u: Unit): boolean { return u.player === w.humanPlayer; }

/** Pensamento do motor antigo para os modos `World.legacyMode`: "defend"/"follow" (aliados do jogador e grupos do script com esses
 *  comandos) e "still", e as ordens defend/still/follow do herói. Aproximações nossas (alerta de grupo, revide, formação). A fuga
 *  (Wimpy/Withdraw) é a do pensamento portado (AI_GroupFlee 0x57377d) para todas. */
export function legacyThink(w: World, u: Unit): void {
  if (u.isHero) { heroLegacy(w, u); return; }
  const human = isHumanSide(w, u);
  if ((u.state === "attack" || u.state === "cast") && human) return;
  const ai = u.ai;
  if (u.order.type === "attack" && !w.validTarget(u, u.order.target)) w.resumeOrNone(u);
  if (u.order.type === "cast" && u.order.target && u.order.target !== u.id && !w.validTarget(u, u.order.target)) w.resumeOrNone(u);
  if (u.order.type === "retreat") w.command(u, { type: "none" });
  const busy = u.order.type === "attack" || u.order.type === "cast";
  const tid = u.order.type === "attack" ? u.order.target : u.order.type === "cast" ? u.order.target ?? 0 : 0;
  // conjurador lutando: a cada pensamento o ataque sorteia de novo arma/magia (0x56acc8 → 0x57a769)
  if (busy && !human && u.spells.length && u.cooldown <= 0 && tid && tid !== u.id) {
    const t = w.get(tid);
    if (t && t.active) {
      const s = pickOffensive(w, u, t), r = u.resume;
      if (s && !(u.order.type === "cast" && u.order.spell === s.id)) { w.command(u, castAt(u, s, t)); u.resume = r; }
      else if (!s && u.order.type === "cast") { w.command(u, { type: "attack", target: t.id }); u.resume = r; }
    }
  }
  const sight = w.sightOf(u);
  switch (ai.type) {
    case "still":
      // Stand still (tecla L, tarefa 0x17): não ataca nem reage; só interrompe um golpe em curso
      if (busy) w.command(u, { type: "none" });
      return;
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
    default:
      return;
  }
}

/** O herói nas ordens defend/still/follow (sem tratador portado): a ordem do jogador manda; só decide ao defender. */
function heroLegacy(w: World, u: Unit): void {
  if (u.state === "attack" || u.state === "cast") return;
  const o = u.order;
  if (o.type === "attack" && !w.validTarget(u, o.target)) w.resumeOrNone(u);
  if (o.type === "cast" && o.target && o.target !== u.id && !w.validTarget(u, o.target) && !healsDying(w, u, o.spell, o.target)) w.resumeOrNone(u);
  const order = u.order;
  const busy = order.type === "attack" && !!u.target;
  const resume = u.resume;
  if (busy) {
    const t = w.get(u.target)!;
    if (resume?.type === "guard" && dist(t, { x: resume.x + 0.5, y: resume.y + 0.5 }) > guardRadius(resume.range) + 0.5) w.resumeOrNone(u);
    else if (resume?.type === "defend") { const lead = w.get(resume.unit); if (lead && dist(lead, u) > resume.range + w.sightOf(u)) w.resumeOrNone(u); }
    // ataque corpo a corpo: autocast entre golpes [exe 0x56aee2]
    else if (w.attackRange(u) < 2 && u.cooldown <= 0 && u.mana >= 5 && u.spells.length) autocast(w, u);
    void t;
    return;
  }
  switch (order.type) {
    case "still":
      return;   // Stand still (L): não ataca ninguém [exe: tarefa 0x17]
    case "guard": {
      // Guard do herói (pacote 5: sem `case` executado no corpus) [est]: alvos no raio em volta do posto, revide de quem bateu há < 3 s
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
