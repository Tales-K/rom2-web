/**
 * Pilotos automáticos headless das missões do estágio de Kaarg: 30, 31, 32, 40, 41, 42 e 43 (scripts em data/scripts/mission_<n>.txt).
 * Rodar em game/:  npm run test:sim   (= ... && npx tsx src/sim/test/missions_kaarg.ts)
 * Opcional: `npx tsx src/sim/test/missions_kaarg.ts 42` roda só a missão pedida.
 *
 * Padrão (como mission20.ts): monta a missão como a cena (loader.ts startRun, com Igles = unidade de script 10002 quando o script a usa),
 * leva o herói pelos gatilhos do script e exige Mission Complete; cobre as falhas do script (causas 2, 5, 6, 7, 8...). O piloto TELETRANSPORTA
 * o herói entre os pontos dos gatilhos e MATA (w.kill) o que o script exige morto, para o teste ser curto e determinístico; trechos de
 * movimento/combate reais (seguir Igles, enxame do espadachim, duelos) aparecem onde o motor precisa provar caminho/IA e como info.
 *   30 Lyrisha Village: Igles fala com o ancião (estágio 1) -> comandante (hostil, grupo 16 morto) -> filho segue Igles até o ancião
 *      (estágio 3) -> grupo 13 (nêmesis) entra e morre (estágio 4) -> Igles recebe a coroa. Falhas 5, 6, 7, 8, 2.
 *   31 Adamantium Mines: necromantes (jogador 4) mortos -> ferreiro 101 vira o 165 (Polymorph, mesmo id) -> falar com ele. Falhas 5, 6, 7, 8, 2.
 *   32 After the Sword: espadachim 8 (carrega a espada 20806) corre para (71,13); matá-lo antes = vitória; chegar lá = falha 5.
 *   40 The Astrologer: estandarte (item 54 = 3662) de Bugor, Dina, mapa (item 61 = 3669) do chefe dos gangsters. Falhas 5, 6.
 *   41 The Besieged Tower: emboscada (grupo 1), mago 132, dragão 131; torre (24,12) com o dragão morto. Falha 2.
 *   42 Killer Dragon: cadeia de frascos (itens 64..67 = 3672..3675), Polymorph do dragão 30 -> 126, matar o 126. Falhas 5, 6, 7, 2.
 *   43 Dirty Work: espião (fala) e todos os necromantes (jogador 2) mortos. Falha 2.
 */
import type { HeroState } from "../../core/state";
import type { Unit } from "../world";
import { defaultHero } from "../../mission/setup";
import { loadData, proc, run, startRun, type Run } from "./loader";

let passes = 0, failures = 0;
function check(cond: unknown, msg: string): void {
  if (cond) { passes++; console.log(`  ok   ${msg}`); } else { failures++; console.log(`  FALHOU: ${msg}`); }
}

const classes = (await loadData(30)).classes?.classes;
function fighterHero(): HeroState {
  const h = defaultHero();
  const c = classes?.["male_fighter"]?.attributes;
  if (c) h.stats = { body: c.body, agility: c.reaction, mind: c.mind, spirit: c.spirit };
  return h;
}

// ------------------------------------------------------------------------------------------- utilidades
const unit = (r: Run, id: number): Unit => {
  const u = r.b.host.units.get(id);
  if (!u) throw new Error(`unidade de script ${id} inexistente`);
  return u;
};
const group = (r: Run, g: number): Unit[] => r.b.host.groups.get(g) ?? [];
const dist = (a: Unit, b: Unit): number => Math.hypot(a.x - b.x, a.y - b.y);
/** teletransporta `who` para ao lado da unidade de script `id` (1 célula) */
function beside(r: Run, who: Unit, id: number): void { const t = unit(r, id); r.b.world.teleport(who, t.cx + 1, t.cy); }
function at(r: Run, who: Unit, x: number, y: number): void { r.b.world.teleport(who, x, y); }
/** deixa o script rodar (o runtime avalia a cada 0,5 s = 10 tiques) */
const settle = (r: Run, ticks = 25): number => run(r, ticks);
function killAll(r: Run, us: Unit[]): void { for (const u of us) if (u.alive) r.b.world.kill(u, r.b.hero); }
const failCause = (r: Run): number | undefined => (r.outcome && !r.outcome.ok ? r.outcome.cause : undefined);
const noUnsupported = (r: Run): boolean => !r.logs.some(l => /não implementa|não suportado/.test(l.msg));
const sub = (r: Run, n: number): number => r.subs.get(n) ?? 0;
const has = (r: Run, m: number): boolean => r.messages.includes(m);

/** Reinicia a missão e mata o herói: falha causa 2 */
function heroDies(r: Run): void {
  r.b.world.kill(r.b.hero);
  run(r, 80);
  check(failCause(r) === 2, `herói morto: falha causa 2 (${JSON.stringify(r.outcome)})`);
}

// ------------------------------------------------------------------------------------------- 30
async function m30(): Promise<void> {
  console.log("\n=== Missão 30 — Lyrisha Village ===");
  const data = await loadData(30);
  const start = () => startRun(data, fighterHero(), undefined, { companions: [10002] });

  let r = start();
  let w = r.b.world, h = r.b.hero, host = r.b.host;
  const knight = unit(r, 10002);
  check(knight.player === 1 && knight !== h && knight.alive, `Igles = unidade de script 10002 no grupo do herói (${knight.name})`);
  check(Math.abs(h.cx - 12) <= 3 && Math.abs(h.cy - 14) <= 3, `herói nasce no Drop Location (12,14): ${h.cx},${h.cy}`);
  settle(r, 20);
  check(has(r, 1) && sub(r, 2) === 1, "mensagem 1 e subobjetivo 2 (achar Lyrisha) ativo");
  check((group(r, 13).length === 7) && group(r, 13).every(u => u.phased && u.player === 4), "nêmesis (grupo 13, 7 necromantes) escondido no começo");

  // aldeias do norte
  beside(r, h, 44); settle(r);
  check(has(r, 2), "mensagem 2 (camponês da aldeia alta)");
  beside(r, knight, 41); settle(r);
  check(has(r, 4), "mensagem 4 (Igles perto do ancião da aldeia alta)");
  // ancião principal: estágio 1
  beside(r, knight, 49); beside(r, h, 49); settle(r);
  check(has(r, 11) && sub(r, 1) === 1 && sub(r, 2) === 2, `ancião quer o filho: msg 11, sub1 ativo, sub2 cumprido (${[...r.subs].join(";")})`);
  // comandante (necromante 100) com o filho (95, jogador 5): Igles o irrita
  const vk = unit(r, 100), son = unit(r, 95);
  check(group(r, 16).length === 4 && group(r, 16).every(u => u.player === 4), "grupo 16 = guarda do comandante (jogador 4)");
  beside(r, knight, 100); settle(r);
  check(has(r, 15) && sub(r, 1) === 2, "mensagem 15 e subobjetivo 1 cumprido");
  check(w.diplomacyValue(4, 1) === 1, "comandante (jogador 4) hostil ao herói");
  check(!r.outcome, "sem desfecho ainda");
  killAll(r, group(r, 16));
  check(!vk.alive, "comandante morto");
  beside(r, knight, 95); settle(r);
  check(sub(r, 3) === 1 && son.ai?.type === "follow" && (son.ai as { unit: number }).unit === knight.id, `filho segue Igles (ai ${JSON.stringify(son.ai)}), subobjetivo 3 ativo`);
  // escolta real (40 s, vida travada): Igles e o herói caminham rumo ao ancião e o filho vem atrás ("seguir"); o resto da estrada (100+ células
  // com lobos/tartarugas) é pulado: o filho é posto perto do ancião
  const elder = unit(r, 49);
  const son0 = { x: son.x, y: son.y };
  w.command(knight, { type: "move", x: 46, y: 104, attackMove: true });
  w.command(h, { type: "move", x: 47, y: 104, attackMove: true });
  run(r, 20 * 40, () => {
    for (const u of [h, knight, son]) if (u.alive) u.hp = u.maxHp;
    if (knight.alive && knight.order.type === "none") w.command(knight, { type: "move", x: 46, y: 104, attackMove: true });
    if (h.alive && h.order.type === "none") w.command(h, { type: "move", x: 47, y: 104, attackMove: true });
  });
  check(son.alive && Math.hypot(son.x - son0.x, son.y - son0.y) > 8 && dist(son, knight) < 14, `filho acompanha Igles andando (andou ${Math.hypot(son.x - son0.x, son.y - son0.y).toFixed(0)} células; a ${dist(son, knight).toFixed(0)} de Igles)`);
  at(r, knight, 46, 104); at(r, h, 47, 104); at(r, son, elder.cx + 2, elder.cy);
  h.hp = h.maxHp; knight.hp = knight.maxHp; son.hp = son.maxHp;
  check(son.alive, "filho vivo");
  settle(r);
  check(has(r, 12) && sub(r, 3) === 2, "ancião reencontra o filho: msg 12, subobjetivo 3 cumprido");
  const nem = group(r, 13);
  check(nem.every(u => !u.phased && u.alive), "nêmesis (grupo 13) entra em campo (estágio 3)");
  check(w.diplomacyValue(4, 3) === 1, "nêmesis hostil aos aldeões");
  check(sub(r, 4) === 1, "subobjetivo 4 (derrotar o esquadrão) ativo");
  check(!r.outcome, "coroa só depois do esquadrão");
  killAll(r, nem); settle(r);
  check(sub(r, 4) === 2, "esquadrão morto: subobjetivo 4 cumprido");
  beside(r, knight, 49); settle(r, 30);
  check(r.outcome?.ok === true, `ancião dá a coroa: Mission Complete (${JSON.stringify(r.outcome)})`);
  check(has(r, 13) && knight.items.includes("3663"), `mensagem 13 e Igles leva a coroa (itens ${knight.items.join(",")})`);
  check(h.alive && noUnsupported(r), "herói vivo, script sem ações sem suporte");

  // falhas
  console.log("[30] falhas");
  r = start(); w = r.b.world; h = r.b.hero;
  settle(r, 10);
  w.damage(h, unit(r, 42), 1); settle(r, 30);
  check(failCause(r) === 5, `bater em aldeão: falha causa 5 (${JSON.stringify(r.outcome)})`);
  r = start(); w = r.b.world; h = r.b.hero;
  settle(r, 10);
  w.damage(h, unit(r, 75), 1); settle(r, 30);
  check(failCause(r) === 6, `atacar necromantes antes do discurso do ancião: falha causa 6 (${JSON.stringify(r.outcome)})`);
  r = start(); w = r.b.world;
  settle(r, 10); w.kill(unit(r, 95)); settle(r, 30);
  check(failCause(r) === 7, `filho morto: falha causa 7 (${JSON.stringify(r.outcome)})`);
  r = start(); w = r.b.world;
  settle(r, 10); w.kill(unit(r, 49)); settle(r, 30);
  check(failCause(r) === 8, `ancião morto: falha causa 8 (${JSON.stringify(r.outcome)})`);
  r = start(); heroDies(r);
}

// ------------------------------------------------------------------------------------------- 31
async function m31(): Promise<void> {
  console.log("\n=== Missão 31 — Adamantium Mines ===");
  const data = await loadData(31);
  const start = () => startRun(data, fighterHero());
  let r = start();
  let w = r.b.world, h = r.b.hero, host = r.b.host;
  settle(r, 20 * 20);
  check(Math.abs(h.cx - 30) <= 3 && Math.abs(h.cy - 132) <= 3, `herói nasce no Drop Location (30,132): ${h.cx},${h.cy}`);
  check(!r.outcome && has(r, 1), "parado 20 s: sem desfecho, mensagem 1");
  const black = unit(r, 101), real = unit(r, 165);
  check(real.phased && black.player === 2 && real.player === 2, "ferreiro enfeitiçado (101) em cena e o verdadeiro (165) escondido");
  beside(r, h, 100); settle(r);
  check(has(r, 2), "ancião fala com o herói (msg 2)");
  beside(r, h, 101); settle(r);
  check(has(r, 4) && sub(r, 1) === 1, "ferreiro enfeitiçado: msg 4, subobjetivo 1");
  beside(r, h, 102); settle(r);
  check(has(r, 8) && sub(r, 2) === 1, "refém: msg 8, subobjetivo 2");
  beside(r, h, 105); settle(r);
  check(has(r, 6), "menino: msg 6");
  check(!r.outcome, "nada acaba antes dos necromantes");
  // necromantes (jogador 4) mortos com o herói longe do ferreiro: o polymorph deve manter o id 101 apontando para a nova forma
  const necros = r.b.world.units.filter(u => u.player === 4 && u.alive);
  check(necros.length >= 10, `${necros.length} unidades do jogador 4 (necromantes)`);
  at(r, h, 100, 40);
  killAll(r, necros); settle(r, 30);
  check(unit(r, 101) === real && unit(r, 165) === real, "polymorph: 101 e 165 passam a ser a nova forma");
  check(!real.phased && real.alive && !black.alive, "ferreiro verdadeiro em cena; enfeitiçado fora");
  check(Math.abs(real.cx - 52) <= 3 && Math.abs(real.cy - 70) <= 3, `novo ferreiro no lugar do antigo (${real.cx},${real.cy})`);
  check(!r.outcome, "polymorph não encerra a missão");
  check(host.groupUnitCount(2) === 1 && group(r, 2)[0] === real, "grupo 2 (ferreiro): a forma antiga sai e a nova ocupa o lugar dela");
  // reféns: voltam seguindo o herói
  beside(r, h, 102); settle(r);
  check(has(r, 14), "refém: msg 14 (salvos)");
  const hostages = group(r, 3);
  check(hostages.length === 3 && hostages.every(u => u.ai?.type === "follow" && (u.ai as { unit: number }).unit === h.id), "reféns passam a seguir o herói");
  beside(r, h, 100); settle(r);
  check(has(r, 10) && r.gold >= 10000, `ancião agradece: msg 10 e 10000 de ouro (${r.gold})`);
  check(sub(r, 2) === 2, "subobjetivo 2 cumprido");
  check(!r.outcome, "ainda falta falar com o ferreiro");
  beside(r, h, 101); settle(r, 30);
  check(r.outcome?.ok === true, `ferreiro libertado: Mission Complete (${JSON.stringify(r.outcome)})`);
  check(has(r, 12) && has(r, 250) && sub(r, 1) === 2, "msgs 12 e 250, subobjetivo 1 cumprido");
  check(noUnsupported(r), "script sem ações sem suporte");

  console.log("[31] falhas");
  r = start(); w = r.b.world; h = r.b.hero;
  settle(r, 10); w.damage(h, unit(r, 100), 1); settle(r, 30);
  check(failCause(r) === 8, `bater no aldeão: falha causa 8 (${JSON.stringify(r.outcome)})`);
  r = start(); w = r.b.world; h = r.b.hero;
  settle(r, 10); w.damage(h, unit(r, 102), 1); settle(r, 30);
  check(failCause(r) === 7, `bater em refém: falha causa 7 (${JSON.stringify(r.outcome)})`);
  r = start(); w = r.b.world;
  settle(r, 10); w.kill(unit(r, 102)); settle(r, 30);
  check(failCause(r) === 6, `refém morto (restam ${r.b.host.playerUnitCount(5)}): falha causa 6 (${JSON.stringify(r.outcome)})`);
  r = start(); w = r.b.world;
  settle(r, 10); w.kill(unit(r, 101)); settle(r, 30);
  check(failCause(r) === 5, `ferreiro enfeitiçado morto: falha causa 5 (${JSON.stringify(r.outcome)})`);
  r = start(); w = r.b.world;
  settle(r, 10); killAll(r, w.units.filter(u => u.player === 4 && u.alive)); settle(r, 30);
  check(!r.outcome, "(depois do polymorph) sem desfecho");
  w.kill(unit(r, 165)); settle(r, 30);
  check(failCause(r) === 5, `ferreiro verdadeiro morto: falha causa 5 (${JSON.stringify(r.outcome)})`);
  r = start(); heroDies(r);
}

// ------------------------------------------------------------------------------------------- 32
async function m32(): Promise<void> {
  console.log("\n=== Missão 32 — After the Sword ===");
  const data = await loadData(32);
  const start = () => startRun(data, fighterHero());
  let r = start();
  let w = r.b.world, h = r.b.hero;
  const sword = unit(r, 8);
  check(sword.items.includes("20806") && sword.player === 2, "espadachim (unit 8) carrega a espada 20806");
  settle(r, 20 * 20);
  check(!r.outcome && has(r, 1) && sword.cx === 50 && sword.cy === 49, "parado 20 s: sem desfecho, espadachim parado em (50,49)");

  // enxame dos bandidos ao chegar em (28,33); com <= 2 vivos o espadachim foge para (71,13)
  const brigands = group(r, 1);
  check(brigands.length === 5, "grupo 1 = 5 bandidos");
  at(r, h, 25, 36); settle(r);
  check(brigands.every(b => b.ai?.type === "guard"), "bandidos em alerta (enxame) quando o herói chega ao ponto (28,33)");
  killAll(r, brigands.slice(0, 3)); settle(r);
  check(sword.ai?.type === "swarm", `espadachim começa a correr (ai ${JSON.stringify(sword.ai)})`);
  // o herói ainda tem tempo: pula para perto e mata o espadachim de verdade (duelo)
  at(r, h, sword.cx - 3, sword.cy + 2);
  const t = run(r, 20 * 120, () => {
    if (!h.alive || !sword.alive) return true;
    if (h.order.type === "none" || h.order.type === "hold") w.command(h, { type: "attack", target: sword.id });
  });
  console.log(`  info: duelo com o espadachim: ${sword.alive ? "não morreu" : "morreu"} em ${(t / 20).toFixed(0)} s (herói ${Math.ceil(h.hp)}/${h.maxHp})`);
  if (sword.alive) { w.kill(sword, h); settle(r); }
  settle(r);
  check(r.outcome?.ok === true, `espadachim morto: Mission Complete (${JSON.stringify(r.outcome)})`);
  check(noUnsupported(r), "script sem ações sem suporte");

  console.log("[32] falhas");
  // chegar tarde: bandidos mortos, herói longe -> o espadachim alcança (71,13) = falha 5
  r = start(); w = r.b.world; h = r.b.hero;
  const sw2 = unit(r, 8);
  settle(r, 5); killAll(r, group(r, 1).slice(0, 3)); settle(r, 25);
  check(sw2.ai?.type === "swarm", "espadachim corre quando restam <= 2 bandidos");
  const t2 = run(r, 20 * 240);
  check(failCause(r) === 5, `espadachim chega a (71,13) em ${(t2 / 20).toFixed(0)} s: falha causa 5 (${JSON.stringify(r.outcome)}; pos ${sw2.cx},${sw2.cy})`);
  // outro gatilho de início: herói perto do portador da espada
  r = start(); h = r.b.hero;
  settle(r, 5); at(r, h, 50, 45); settle(r);
  check(unit(r, 8).ai?.type === "swarm", "herói perto do portador (50,49): ele sai correndo");
  r = start(); heroDies(r);
}

// ------------------------------------------------------------------------------------------- 40
async function m40(): Promise<void> {
  console.log("\n=== Missão 40 — The Astrologer ===");
  const data = await loadData(40);
  const start = (comp = false) => startRun(data, fighterHero(), undefined, comp ? { companions: [10002] } : {});
  let r = start();
  let w = r.b.world, h = r.b.hero;
  const bugor = unit(r, 57), dina = unit(r, 89), chief = unit(r, 50);
  check(bugor.items.includes("3662"), "Bugor (57) carrega o estandarte 3662 (item 54 do script)");
  check(chief.items.includes("3669"), "chefe dos gangsters (50) carrega o mapa estelar 3669 (item 61)");
  settle(r, 20 * 10);
  check(!r.outcome && has(r, 1) && dina.alive, "parado 10 s: sem desfecho, mensagem 1, Dina viva");
  beside(r, h, 62); settle(r);
  check(has(r, 2) && sub(r, 1) === 1, "ancião: msg 2, subobjetivo 1 (estandarte)");
  // Bugor: conversa -> hostil; é morto e solta o estandarte
  beside(r, h, 57); settle(r);
  check(has(r, 4) && w.diplomacyValue(6, 1) === 1, "Bugor: msg 4 e fica hostil");
  const bx = bugor.cx, by = bugor.cy;
  w.kill(bugor, h); settle(r, 5);
  check(w.loot.some(l => l.x === bx && l.y === by && l.items.includes("3662")), "estandarte cai no chão");
  at(r, h, bx, by - 1);
  w.command(h, { type: "pickup", x: bx, y: by });
  run(r, 60);
  check(h.items.includes("3662"), `herói pega o estandarte (itens ${h.items.join(",")})`);
  settle(r);
  check(sub(r, 1) === 2, "subobjetivo 1 cumprido (herói tem o estandarte)");
  // necromante solitário (58): fala e fica hostil; subobjetivo 2
  beside(r, h, 58); settle(r);
  check(has(r, 7) && sub(r, 2) === 1 && w.diplomacyValue(7, 1) === 1, "necromante solitário: msg 7, subobjetivo 2, hostil");
  // os dois necromantes (grupo 4) perto de Dina
  const gn = group(r, 4);
  check(gn.length === 2 && gn.every(u => u.player === 4), "grupo 4 = 2 necromantes");
  at(r, h, dina.cx - 3, dina.cy); settle(r);
  check(!has(r, 12), "Dina ainda não fala com os necromantes vivos");
  killAll(r, gn); settle(r);
  check(sub(r, 2) === 2, "necromantes mortos: subobjetivo 2 cumprido");
  check(dina.alive, "Dina viva");
  beside(r, h, 89); settle(r);
  check(has(r, 12) && sub(r, 3) === 1, "Dina agradece: msg 12, subobjetivo 3 (papéis)");
  // gangsters: recusam sem o estandarte, entregam o mapa com ele
  at(r, h, chief.cx + 1, chief.cy); settle(r, 30);
  check(has(r, 9), "chefe: msg 9 (troca o estandarte pelo mapa)");
  check(h.items.includes("3669") && !h.items.includes("3662"), `herói recebe o mapa 3669 e perde o estandarte (itens ${h.items.join(",")})`);
  check(!r.outcome, "ainda falta mostrar o mapa a Dina");
  beside(r, h, 89); settle(r, 30);
  check(r.outcome?.ok === true, `mapa levado a Dina: Mission Complete (${JSON.stringify(r.outcome)})`);
  check(has(r, 13) && !h.items.includes("3669"), "msg 13 e o mapa é retirado do herói");
  check(noUnsupported(r), "script sem ações sem suporte");

  console.log("[40] Igles e falhas");
  r = start(true); w = r.b.world;
  const kn = unit(r, 10002);
  settle(r, 5); beside(r, kn, 62); at(r, r.b.hero, 12, 129); settle(r);
  check(has(r, 3), "Igles perto do ancião: msg 3");
  r = start(); w = r.b.world;
  settle(r, 5); w.kill(unit(r, 89)); settle(r, 30);
  check(failCause(r) === 5, `Dina morta: falha causa 5 (${JSON.stringify(r.outcome)})`);
  r = start(); w = r.b.world; h = r.b.hero;
  settle(r, 5); w.damage(h, unit(r, 62), 1); settle(r, 30);
  check(failCause(r) === 6, `bater em aldeão: falha causa 6 (${JSON.stringify(r.outcome)})`);
  r = start(); heroDies(r);
}

// ------------------------------------------------------------------------------------------- 41
async function m41(): Promise<void> {
  console.log("\n=== Missão 41 — The Besieged Tower ===");
  const data = await loadData(41);
  const start = (comp = false) => startRun(data, fighterHero(), undefined, comp ? { companions: [10002] } : {});
  let r = start();
  let w = r.b.world, h = r.b.hero;
  const mage = unit(r, 132), dragon = unit(r, 131);
  check(Math.abs(h.cx - 40) <= 3 && Math.abs(h.cy - 69) <= 3, `herói nasce no Drop Location (40,69): ${h.cx},${h.cy}`);
  settle(r, 20 * 10);
  const amb = group(r, 1);
  check(amb.length === 15 && amb.every(u => u.phased), "emboscada (grupo 1, 15 monstros) escondida");
  check(has(r, 1) && sub(r, 1) === 1 && !r.outcome, "msg 1, subobjetivo 1 (causa), sem desfecho");
  at(r, h, 40, 56); settle(r);
  check(amb.every(u => !u.phased), "ao passar a 1ª ponte a armadilha dispara: emboscada em campo");
  w.kill(mage, h); settle(r);
  check(has(r, 2) && sub(r, 1) === 2 && sub(r, 2) === 1, "mago morto: msg 2, subobjetivo 1 cumprido, subobjetivo 2 ativo");
  check(amb.every(u => u.phased), "mago morto: emboscada some");
  at(r, h, 28, 16); settle(r);
  check(has(r, 3), "perto do dragão: msg 3");
  const d2 = unit(r, 131);
  w.kill(d2, h);
  settle(r);
  check(sub(r, 2) === 2, "dragão morto: subobjetivo 2 cumprido");
  check(!r.outcome, "falta chegar à torre");
  at(r, h, 24, 12); settle(r, 30);
  check(r.outcome?.ok === true, `herói na torre (24,12): Mission Complete (${JSON.stringify(r.outcome)})`);
  check(has(r, 4), "msg 4 (torre, herói)");

  console.log("[41] duelo real (info), Igles e falha");
  {
    const q = start(); const qh = q.b.hero, qd = unit(q, 131);
    at(q, qh, 28, 16);
    const t = run(q, 20 * 90, () => {
      if (!qh.alive || !qd.alive) return true;
      if (qh.order.type === "none" || qh.order.type === "hold") q.b.world.command(qh, { type: "attack", target: qd.id });
    });
    console.log(`  info: duelo guerreiro x dragão (${qd.maxHp} de vida, ${qd.stats.damage.min}-${qd.stats.damage.max}): ${qd.alive ? (qh.alive ? "empate" : "herói morreu") : "dragão morreu"} em ${(t / 20).toFixed(0)} s (herói ${Math.max(0, Math.ceil(qh.hp))}/${qh.maxHp})`);
  }
  r = start(true); w = r.b.world; h = r.b.hero;
  const kn = unit(r, 10002);
  settle(r, 5); w.kill(unit(r, 132), h); w.kill(unit(r, 131), h); settle(r, 25);
  at(r, kn, 24, 12); at(r, h, 24, 40); settle(r, 30);
  check(r.outcome?.ok === true && has(r, 5), `Igles na torre com o dragão morto: Mission Complete + msg 5 (${JSON.stringify(r.outcome)})`);
  r = start(); w = r.b.world; h = r.b.hero;
  settle(r, 5); at(r, h, 24, 12); settle(r, 30);
  check(!r.outcome, "na torre com o dragão vivo: nada acontece");
  r = start(); heroDies(r);
}

// ------------------------------------------------------------------------------------------- 42
async function m42(): Promise<void> {
  console.log("\n=== Missão 42 — Killer Dragon ===");
  const data = await loadData(42);
  const start = (comp = false) => startRun(data, fighterHero(), undefined, comp ? { companions: [10002] } : {});
  let r = start();
  let w = r.b.world, h = r.b.hero;
  const mad = unit(r, 30), tame = unit(r, 126), mag1 = unit(r, 31), mag2 = unit(r, 32);
  const warns = data.script?.warnings ?? [];
  check(!warns.some(m => /inexistente/.test(m)), `script sem referências quebradas (${warns.length} avisos)`);
  check(Math.abs(h.cx - 12) <= 3 && Math.abs(h.cy - 31) <= 3, `herói nasce no Drop Location (12,31): ${h.cx},${h.cy}`);
  check(tame.phased && !mad.phased && mad.maxHp > tame.maxHp, `dragão louco (${mad.maxHp} de vida) em cena; forma polimorfada (${tame.maxHp}) escondida`);
  settle(r, 20 * 15);
  check(!r.outcome && has(r, 1), "parado 15 s: sem desfecho, mensagem 1");
  beside(r, h, 33); settle(r);
  check(has(r, 2), "ancião 1: msg 2");
  beside(r, h, 34); settle(r);
  check(has(r, 4), "ancião 2: msg 4");
  const items = () => h.items.filter(i => +i >= 3672 && +i <= 3675).join(",");
  // 1º mago: dá o frasco vazio (item 64 = 3672)
  beside(r, h, 31); settle(r);
  check(has(r, 6) && sub(r, 1) === 1 && items() === "3672", `mago 1: msg 6, subobjetivo 1, frasco vazio (itens ${items()})`);
  // fonte (13,104): enche o frasco (65 = 3673)
  at(r, h, 13, 105); settle(r);
  check(has(r, 11) && items() === "3673" && sub(r, 1) === 2, `fonte: msg 11, frasco cheio, subobjetivo 1 cumprido (itens ${items()})`);
  check(sub(r, 2) === 1, "subobjetivo 2 ativo depois do 1");
  // 2º mago: encanta (66 = 3674)
  beside(r, h, 32); settle(r);
  check(has(r, 8) && items() === "3674" && sub(r, 2) === 2, `mago 2: msg 8, frasco encantado, subobjetivo 2 cumprido (itens ${items()})`);
  check(sub(r, 3) === 1, "subobjetivo 3 ativo");
  // volta ao 1º mago: poção final (67 = 3675) — depende do gatilho com referência -1 consertado no loader
  beside(r, h, 31); settle(r);
  check(has(r, 12) && items() === "3675", `mago 1 de novo: msg 12, poção de metamorfose (itens ${items()})`);
  // dragão louco: a poção o transforma (Polymorph 30 -> 126)
  check(!r.outcome, "ainda não acabou");
  beside(r, h, 30); settle(r, 30);
  check(has(r, 9) && has(r, 14) && items() === "", `poção usada no dragão: msgs 9 e 14, item consumido (itens ${items()})`);
  check(mad.state === "dead" && !tame.phased && tame.alive && unit(r, 30) === tame && unit(r, 126) === tame, "polymorph: dragão 30 sai, o 126 entra no lugar (ids 30/126 = nova forma)");
  check(Math.abs(tame.cx - 115) <= 4 && Math.abs(tame.cy - 68) <= 4, `forma nova na posição do dragão (${tame.cx},${tame.cy})`);
  check(sub(r, 3) === 2 && !r.outcome, "subobjetivo 3 cumprido, dragão ainda vivo");
  w.kill(tame, h); settle(r, 30);
  check(r.outcome?.ok === true, `forma polimorfada morta: Mission Complete (${JSON.stringify(r.outcome)})`);
  check(noUnsupported(r), "script sem ações sem suporte");

  console.log("[42] duelo real (info), Igles e falhas");
  {
    // duelo real contra a forma polimorfada (a cadeia de frascos é pulada: o dragão é trocado direto pelo host)
    const q = start(); const qh = q.b.hero;
    settle(q, 5); // o gatilho Start esconde o 126; só depois o polymorph
    q.b.host.polymorph(30, 126);
    const qd = unit(q, 126);
    at(q, qh, qd.cx - 2, qd.cy);
    const t = run(q, 20 * 100, () => {
      if (!qh.alive || !qd.alive) return true;
      if (qh.order.type === "none" || qh.order.type === "hold") q.b.world.command(qh, { type: "attack", target: qd.id });
    });
    console.log(`  info: duelo guerreiro x dragão polimorfado (${qd.maxHp} de vida): ${qd.alive ? (qh.alive ? "empate" : "herói morreu") : "dragão morreu"} em ${(t / 20).toFixed(0)} s (herói ${Math.max(0, Math.ceil(qh.hp))}/${qh.maxHp})`);
  }
  r = start(true); w = r.b.world; h = r.b.hero;
  settle(r, 5); beside(r, unit(r, 10002), 31); at(r, h, 12, 31); settle(r);
  check(has(r, 7) && !has(r, 6), "Igles perto do mago 1 antes do herói: msg 7 (recusa)");
  r = start(); w = r.b.world; h = r.b.hero;
  settle(r, 5); w.damage(h, unit(r, 32), 1); settle(r, 30);
  check(failCause(r) === 6, `atacar mago: falha causa 6 (${JSON.stringify(r.outcome)})`);
  r = start(); w = r.b.world; h = r.b.hero;
  settle(r, 5); w.damage(h, unit(r, 33), 1); settle(r, 30);
  check(failCause(r) === 7, `atacar aldeão: falha causa 7 (${JSON.stringify(r.outcome)})`);
  r = start(); w = r.b.world;
  settle(r, 5); w.kill(unit(r, 31)); settle(r, 30);
  check(failCause(r) === 5, `mago morto: falha causa 5 (${JSON.stringify(r.outcome)})`);
  r = start(); heroDies(r);
}

// ------------------------------------------------------------------------------------------- 43
async function m43(): Promise<void> {
  console.log("\n=== Missão 43 — Dirty Work ===");
  const data = await loadData(43);
  const start = (comp = false) => startRun(data, fighterHero(), undefined, comp ? { companions: [10002] } : {});
  let r = start();
  let w = r.b.world, h = r.b.hero;
  const spy = unit(r, 74), inv = unit(r, 75);
  check(Math.abs(h.cx - 64) <= 3 && Math.abs(h.cy - 15) <= 3, `herói nasce no Drop Location (64,15): ${h.cx},${h.cy}`);
  const sk = group(r, 5);
  settle(r, 20 * 30);
  check(has(r, 1) && !r.outcome, "30 s no início: msg 1, sem desfecho");
  check(spy.phased && inv.phased, "espião (74) e espião invisível (75) escondidos");
  check(sk.length === 1 && sk[0]!.ai?.type === "swarm", `esqueleto do enxame ativo (ai ${JSON.stringify(sk[0]?.ai)})`);
  console.log(`  info: após 30 s o herói parado está com ${Math.ceil(h.hp)}/${h.maxHp} de vida`);
  h.hp = h.maxHp;
  // espião: 1ª vez "invisível" (msg 6), 2ª vez aparece (msg 3, fase dentro do 74)
  at(r, h, 17, 38); settle(r, 40);
  check(has(r, 6) && has(r, 3), "espião: msg 6 (invisível) e depois msg 3");
  check(!spy.phased, "espião 74 entra em cena");
  // todos os necromantes (jogador 2) mortos
  const necros = w.units.filter(u => u.player === 2 && u.alive);
  check(necros.length >= 30, `${necros.length} unidades do jogador 2`);
  killAll(r, necros.slice(1)); settle(r, 25);
  check(!r.outcome, "enquanto sobrar um necromante, sem desfecho");
  killAll(r, necros); settle(r, 25);
  check(r.outcome?.ok === true, `todos os necromantes mortos: Mission Complete (${JSON.stringify(r.outcome)})`);
  check(noUnsupported(r), "script sem ações sem suporte");

  console.log("[43] Igles e falha");
  r = start(true); w = r.b.world; h = r.b.hero;
  settle(r, 5); at(r, unit(r, 10002), 17, 38); at(r, h, 64, 15); settle(r, 25);
  check(has(r, 7), "Igles perto do espião invisível: msg 7");
  r = start(); heroDies(r);
}

// ------------------------------------------------------------------------------------------- execução
const only = proc.argv.slice(2).map(Number).filter(n => n > 0);
const all: [number, () => Promise<void>][] = [[30, m30], [31, m31], [32, m32], [40, m40], [41, m41], [42, m42], [43, m43]];
for (const [id, fn] of all) {
  if (only.length && !only.includes(id)) continue;
  try { await fn(); } catch (e) { failures++; console.log(`  FALHOU: missão ${id} lançou exceção: ${(e as Error).stack ?? e}`); }
}
console.log(`\n${passes} ok, ${failures} falha(s)`);
if (failures) proc.exitCode = 1;
