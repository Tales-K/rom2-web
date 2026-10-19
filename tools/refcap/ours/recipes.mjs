// Receitas de preparo de estado por cenario (ids de tools/refcap/scenarios.json).
// Cada receita recebe { sess, meta, scenario, sleep } e deixa a tela pronta para a captura; capture.mjs tira o PNG.
// As posicoes de mouse escolhidas aqui ficam registradas em refs/ours/<id>.json ("mouse"); para uma comparacao justa
// a captura do original deve usar posicoes equivalentes (veja notes/compare.md).
//
// Acessa internos das cenas pelo console (game.scenes.current.<campo privado>) e, na missao, window.__mission
// (so existe no servidor de desenvolvimento). Se um campo mudar de nome, a receita falha com mensagem clara.

const NEUTRAL = [[1012, 756], [12, 756], [512, 756], [1012, 12], [12, 12]];

/** ponto da cidade cujo valor na mascara corresponde a regiao `name` (centro de massa ajustado ao ponto mais proximo) */
async function townPoint(sess, name) {
  return sess.eval(n => {
    const sc = game.scenes.current;
    // a mascara esta nas coordenadas da arte 640x480 (container "view" escalado; ver TownScene)
    const find = c => (c.hitArea && c.hitArea.width === 640 ? c : (c.children || []).map(find).find(Boolean));
    const view = find(sc.root);
    const k = view ? view.worldTransform.a : 1.6, ox = view ? view.worldTransform.tx : 0, oy = view ? view.worldTransform.ty : 0;
    const pts = [];
    for (let y = 2; y < 768; y += 6) for (let x = 2; x < 1024; x += 6) {
      const id = sc.readMask((x - ox) / k, (y - oy) / k);
      if (n === null ? id === 0 : sc.regions.get(id)?.name === n) pts.push([x, y]);
    }
    if (!pts.length) return null;
    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    let best = pts[0], bd = Infinity;
    for (const p of pts) { const d = (p[0] - cx) ** 2 + (p[1] - cy) ** 2; if (d < bd) { bd = d; best = p; } }
    return best;
  }, name);
}

/** primeiro ponto "neutro" da lista onde a mascara da cidade e 0 */
async function townNeutral(sess) {
  const p = await sess.eval(cands => {
    const sc = game.scenes.current;
    const find = c => (c.hitArea && c.hitArea.width === 640 ? c : (c.children || []).map(find).find(Boolean));
    const view = find(sc.root);
    const k = view ? view.worldTransform.a : 1.6, ox = view ? view.worldTransform.tx : 0, oy = view ? view.worldTransform.ty : 0;
    return cands.find(([x, y]) => sc.readMask((x - ox) / k, (y - oy) / k) === 0) ?? null;
  }, NEUTRAL);
  return p ?? NEUTRAL[0];
}


/** Leva o estado da campanha ate `done` (missoes concluidas pelo motor, como no jogo) e a cidade `town`. */
async function campaignAt(sess, { done = [], town = 1, stage = 0, rawVars = null } = {}) {
  await sess.ensureHero();
  if (!done.length && town === 1) return;
  const info = await sess.eval(async (done, town, stage, rawVars) => {
    const E = await import("/src/campaign/engine.ts");
    const R = await import("/src/campaign/runtime.ts");
    const P = await import("/src/campaign/progress.ts");
    const data = await R.loadCampaignData(game);
    const p = game.state.progress;
    const st = P.ensureCampaign(p, game.state.hero, data);
    if (rawVars) {   // exatamente as variaveis do save derivado do original (so estagio + missoes concluidas; sem os efeitos das conversas/missoes)
      st.vars = {};
      for (const [k, v] of Object.entries(rawVars)) E.setVar(st, Number(k), v);
      st.log = done.slice();
    } else for (const m of done) E.onMissionResult(st, data, { id: m, outcome: "complete" });
    st.pending = [];
    if (stage) E.setVar(st, 768, stage);     // estagio do save original (kaarg_30 / druids_60), sem concluir as missoes 30..50
    st.lastTown = town;
    P.syncLegacy(p, data);
    return { stage: E.stageOf(st), locations: st.locations, lastTown: st.lastTown };
  }, done, town, stage, rawVars);
  return info;
}

/** Abre a taverna (dica fechada) no estado pedido. */
async function enterInn(sess, st = {}) {
  await campaignAt(sess, st);
  await sess.go("inn", { town: st.town ?? 1 }, 1800);
  await sess.eval(() => game.scenes.current.closeTip?.());
  await new Promise(r => setTimeout(r, 300));
}

/** Abre a loja (dica fechada) no estado pedido. */
async function enterShop(sess, st = {}) {
  await campaignAt(sess, st);
  await sess.go("shop", { town: st.town ?? 1 }, 1800);
  await sess.eval(() => game.scenes.current.closeTip?.());
  await new Promise(r => setTimeout(r, 300));
}

/** Sai pelo portao da cidade `town` como o TownScene (Plagat: depois da conversa com o mensageiro, que poe a missao 10 na lista). */
async function leaveGate(sess, town, locs = null) {
  await sess.eval(async (town, locs) => {
    const E = await import("/src/campaign/engine.ts");
    const R = await import("/src/campaign/runtime.ts");
    const P = await import("/src/campaign/progress.ts");
    const data = await R.loadCampaignData(game);
    const st = P.ensureCampaign(game.state.progress, game.state.hero, data);
    if (town === 1 && !E.getVar(st, E.V_M10_TAKEN)) { if (!st.locations.some(l => l[0] === "M" && l[1] === 10)) st.locations.push(["M", 10]); E.setVar(st, E.V_M10_TAKEN, 1); }
    E.leaveTown(st, town);
    if (locs) st.locations = locs;      // locais disponiveis como no save do original (kaarg_30: Kaarg/30/31)
    P.syncLegacy(game.state.progress, data);
  }, town, locs);
}

/** Abre o mapa-multi de Uimoir com a viagem ainda parada (`hold`) e a inicia com o relogio congelado: o quadro 0 e o instante zero da viagem. */
async function mapAtStart(sess) {
  await leaveGate(sess, 1);
  await sess.go("globalmap", { hold: true }, 1200);
  await sess.eval(() => { game.app.ticker.stop(); const t = __refcapClock.freeze(); game.scenes.current.startTravel?.(); game.app.ticker.update(t); });
  await sess.eval(() => new Promise(r => requestAnimationFrame(() => r())));
}
/** devolve o relogio/ticker ao normal (o cenario estatico deixa o tempo parado no instante zero da viagem) */
const releaseClock = sess => ({ after: () => sess.page.evaluate(() => { __refcapClock.release(); game.app.ticker.start(); }).catch(() => {}) });

/** Abre a cidade (dica fechada) no estado pedido. */
async function enterTown(sess, st = {}) {
  const info = await campaignAt(sess, st);
  await sess.go("town", { town: st.town ?? 1 }, 1500);
  await sess.eval(() => game.scenes.current.closeTip?.());
  await new Promise(r => setTimeout(r, 200));
  return info;
}

// ------------------------------------------------------------------------------------------- missao

async function startMission(sess, id = 10, { closeDialogs = true, pause = true, mage = false } = {}) {
  await sess.ensureHero(mage ? { mage: true } : undefined);
  await sess.go("mission", { id }, 300);
  await sess.page.waitForFunction(() => window.__mission && window.__mission === game.scenes.current && window.__mission.ready, { timeout: 90000 });
  sess.checkReload();
  await sess.page.waitForFunction(() => !game.scenes.current.loading, { timeout: 30000 });
  // o 1o dialogo do script pode demorar alguns tiques
  await new Promise(r => setTimeout(r, 1500));
  if (closeDialogs) await closeMissionDialogs(sess);
  if (pause) await sess.eval(() => { __mission.userPaused = true; });
}

async function closeMissionDialogs(sess) {
  for (let i = 0; i < 40; i++) {
    const open = await sess.eval(() => { const h = __mission.hud; if (h.overlayOpen) { h.closeOverlay(); __mission.paused = false; return true; } if (h.dialogOpen) { h.nextLine(); return true; } return false; });
    if (!open) break;
    await new Promise(r => setTimeout(r, 120));
  }
}

/** posicao de tela (px) de uma unidade (meio do sprite) */
function unitScreenFn() {
  return `(u) => { const m = __mission, v = m.view.views.get(u.id); const T = 32;
    const wx = u.x * T, wy = u.y * T - (m.view.unitLift ? m.view.unitLift(u) : 0) - (v ? v.offY + v.lift : 0);
    return { x: (wx - m.cam.x) * m.zoom, y: (wy - m.cam.y) * m.zoom }; }`;
}

/** celula livre visivel perto do heroi (para "mouse sobre terreno livre") */
async function freeTerrainPoint(sess) {
  return sess.eval(() => {
    const m = __mission, h = m.hero, g = m.world.grid, T = 32;
    const occupied = new Set(m.world.units.filter(u => u.active).map(u => `${u.cx},${u.cy}`));
    const cand = [];
    for (let dy = -6; dy <= 6; dy++) for (let dx = -8; dx <= 8; dx++) {
      const x = h.cx + dx, y = h.cy + dy, d = Math.hypot(dx, dy);
      if (d < 3) continue;
      if (!g.walkable(x, y) || occupied.has(`${x},${y}`) || !m.fog.isVisible(x, y)) continue;
      if (m.world.loot.some(l => l.x === x && l.y === y)) continue;
      // vizinhanca tambem livre (o cursor nao fica sobre arvore/unidade)
      let ok = true;
      for (let ny = -1; ny <= 1 && ok; ny++) for (let nx = -1; nx <= 1 && ok; nx++) if (!g.walkable(x + nx, y + ny) || occupied.has(`${x + nx},${y + ny}`)) ok = false;
      if (!ok) continue;
      const lift = m.view.relief ? m.view.relief.heightAt(x + 0.5, y + 0.5) : 0;   // relevo (frente RELEVO)
      const sx = ((x + 0.5) * T - m.cam.x) * m.zoom, sy = ((y + 0.5) * T - lift - m.cam.y) * m.zoom;
      if (sx < 40 || sy < 40 || sx > 1024 - 176 - 40 || sy > 768 - 40) continue;
      cand.push({ d: Math.abs(d - 4), x: sx, y: sy });
    }
    cand.sort((a, b) => a.d - b.d);
    return cand[0] ?? null;
  });
}

async function blockedPoint(sess) {
  return sess.eval(() => {
    const m = __mission, h = m.hero, g = m.world.grid, T = 32;
    const cand = [];
    for (let dy = -9; dy <= 9; dy++) for (let dx = -12; dx <= 12; dx++) {
      const x = h.cx + dx, y = h.cy + dy;
      if (!g.inside(x, y) || g.walkable(x, y) || !m.fog.isVisible(x, y)) continue;
      if (m.world.units.some(u => u.active && Math.abs(u.cx - x) <= 1 && Math.abs(u.cy - y) <= 1)) continue;
      // relevo (frente RELEVO): o centro da celula sobe a altura do chao
      const lift = m.view.relief ? m.view.relief.heightAt(x + 0.5, y + 0.5) : 0;
      const sx = ((x + 0.5) * T - m.cam.x) * m.zoom, sy = ((y + 0.5) * T - lift - m.cam.y) * m.zoom;
      if (sx < 30 || sy < 30 || sx > 1024 - 176 - 30 || sy > 768 - 30) continue;
      // prefere celula cercada de bloqueio (centro de arvore/agua/estrutura), perto do heroi
      let n = 0; for (let ny = -1; ny <= 1; ny++) for (let nx = -1; nx <= 1; nx++) if (!g.walkable(x + nx, y + ny)) n++;
      cand.push({ s: Math.hypot(dx, dy) - n, x: sx, y: sy, cell: [x, y] });
    }
    cand.sort((a, b) => a.s - b.s);
    return cand[0] ?? null;
  });
}

/** escolhe uma unidade (hostil ou amiga), poe o heroi a ~3 celulas dela, atualiza a nevoa e centra a camera */
async function approach(sess, kind) {
  const r = await sess.eval((kind, screenSrc) => {
    const m = __mission, w = m.world, h = m.hero;
    const screen = eval(screenSrc);
    const hostile = u => w.hostile(u.player, 1) || w.hostile(1, u.player);
    const list = w.units.filter(u => u.active && u.alive !== false && u !== h && !u.phased && (kind === "enemy" ? hostile(u) : !hostile(u)) && u.player !== 1);
    if (!list.length) return null;
    // amigo/neutro: prefere NPC (humano com fala) a monstro neutro
    const pri = u => (kind === "friend" && !(u.npc > 0 || u.human) ? 1e6 : 0);
    list.sort((a, b) => pri(a) + Math.hypot(a.x - h.x, a.y - h.y) - pri(b) - Math.hypot(b.x - h.x, b.y - h.y));
    const t = list[0];
    const d = Math.hypot(t.x - h.x, t.y - h.y);
    if (d > 4) w.teleport(h, Math.round(t.cx - 3), Math.round(t.cy + 1));
    m.fog.update(w);
    m.centerOn((h.x + t.x) / 2, (h.y + t.y) / 2);
    return { id: t.id, kind: t.kind, name: t.name, player: t.player, teleported: d > 4, cell: [t.cx, t.cy] };
  }, kind, unitScreenFn());
  if (!r) throw new Error(`nenhuma unidade ${kind} no mapa`);
  await new Promise(res => setTimeout(res, 400));   // um quadro para a camera/nevoa
  const p = await sess.eval((id, screenSrc) => { const screen = eval(screenSrc); return screen(__mission.world.get(id)); }, r.id, unitScreenFn());
  return { ...r, screen: p };
}

async function missionTerrainMouse(sess, meta) {
  const p = await freeTerrainPoint(sess);
  if (!p) { meta.warnings.push("nenhuma celula livre visivel perto do heroi; mouse no centro da area de jogo"); await sess.mouse(424, 384); return; }
  await sess.mouse(p.x, p.y);
}

// ------------------------------------------------------------------------------------------- receita generica
/**
 * Receita para cenarios SEM receita propria que declaram campos em scenarios.json (ver "_doc2"):
 *   scene / scene_params : cena do jogo (game.go)       nosave : apaga todos os saves antes
 *   saves : n  -> grava n saves nomeados (heroi atual) antes de abrir a cena (para a tela Load Game)
 *   setup : JS (corpo de funcao; `sc` = game.scenes.current, `game`) avaliado depois da cena abrir
 *   click_before : [[x,y],...] cliques (mouse real) antes da captura
 *   mouse : [x,y] pixels do cliente; press : botao esquerdo apertado (sem soltar) na captura
 */
export async function genericRecipe({ sess, sleep, meta, scenario: s }) {
  await sess.ensureHero(s.hero === "mage" ? { mage: true } : undefined);
  await sess.eval(() => { try { localStorage.removeItem("allods2web.mpchars"); } catch { /* sem armazenamento */ } });   // personagens do Multiplayer (ui/multichar.ts)
  if (s.nosave) await sess.eval(() => { for (let i = 0; i <= 40; i++) game.state.saves.remove(i); });
  else if (s.saves) await sess.eval(n => {
    for (let i = 0; i <= 40; i++) game.state.saves.remove(i);
    const names = ["plagat start"];   // o original (saves derivados do plagat_start) mostra o mesmo nome em todas as linhas
    for (let i = 0; i < n; i++) game.state.saveToSlot(i + 1, names[i % names.length]);
  }, s.saves);
  else await sess.eval(() => { if (!game.state.hasSave()) game.state.saveToSlot(1, "plagat start"); });
  if (s.mission) {   // missao (falas fechadas e simulacao pausada, ou a 1a fala aberta com keep_dialogs)
    await startMission(sess, s.mission, { closeDialogs: !s.keep_dialogs, pause: !s.keep_dialogs && !s.live, mage: s.hero === "mage" });
    if (s.deselect) await sess.eval(() => { const m = __mission; m.selected = undefined; m.view.selectedId = 0; });
  } else if (s.gmap) {   // mapa-multi Yases com a lista de locais pedida (tools/refcap/map_specs.py): {town, stage, done, locs}
    await campaignAt(sess, { done: s.gmap.done ?? [], town: s.gmap.town, stage: s.gmap.stage });
    await leaveGate(sess, s.gmap.town, s.gmap.locs);
    await sess.go("globalmap", null, 1500);
  } else if (s.enter) {   // cidade / taverna / loja no estado de campanha pedido (campaign + town)
    const st = { ...(s.campaign ?? {}), town: s.town ?? 1 };
    await (s.enter === "inn" ? enterInn : s.enter === "shop" ? enterShop : enterTown)(sess, st);
  } else await sess.go(s.scene, s.scene_params ?? null, s.settle_ms ?? 1500);
  await sess.mouse(...NEUTRAL[0]);
  for (const st of s.pre ?? []) {   // passos (mesma sintaxe do original: tools/refcap/city_specs.py)
    if (st[0] === "click") { await sess.mouse(st[1], st[2]); await sess.page.mouse.down(); await sess.page.mouse.up(); await sleep(400); }
    else if (st[0] === "rclick") { await sess.mouse(st[1], st[2]); await sess.page.mouse.down({ button: "right" }); await sess.page.mouse.up({ button: "right" }); await sleep(400); }
    else if (st[0] === "dblclick") { await sess.mouse(st[1], st[2]); for (let k = 0; k < 2; k++) { await sess.page.mouse.down(); await sess.page.mouse.up(); } await sleep(500); }
    else if (st[0] === "drag") { await sess.mouse(st[1], st[2]); await sess.page.mouse.down(); await sess.mouse((st[1] + st[3]) / 2, (st[2] + st[4]) / 2); await sess.mouse(st[3], st[4]); await sleep(300); await sess.page.mouse.up(); await sleep(500); }
    else if (st[0] === "move") await sess.mouse(st[1], st[2]);
    else if (st[0] === "key") { await sess.page.keyboard.press({ esc: "Escape", enter: "Enter", backspace: "Backspace", pause: "Pause" }[st[1]] ?? st[1]); await sleep(350); }
    else if (st[0] === "type") { await sess.page.keyboard.type(st[1], { delay: 40 }); await sleep(200); }
    else if (st[0] === "wait") await sleep(st[1] * 1000);
  }
  if (s.setup) await sess.eval(code => { const sc = game.scenes.current; return new Function("sc", "game", code)(sc, game); }, s.setup);
  await sess.mouse(...(s.mouse_before ?? NEUTRAL[0]));
  for (const [x, y] of s.click_before ?? []) { await sess.mouse(x, y); await sess.page.mouse.down(); await sess.page.mouse.up(); await sleep(400); }
  if (s.mouse) await sess.mouse(...s.mouse);
  if (s.press) { await sess.page.mouse.down(); meta.press = true; }
  await sleep(s.wait_ms ?? 700);
  return s.press ? { after: async () => { await sess.page.mouse.move(5, 5).catch(() => {}); await sess.page.mouse.up({ button: "left" }).catch(() => {}); } } : undefined;
}

/** missao 10 (falas fechadas, simulacao pausada) > Esc > clique no item do menu em y */
async function missionMenuItem(sess, sleep, y) {
  await startMission(sess, 10);
  await sess.page.keyboard.press("Escape");
  await sleep(700);
  await sess.mouse(508, y);
  await sess.page.mouse.down(); await sess.page.mouse.up();
  await sleep(1200);
}

// ------------------------------------------------------------------------------------------- receitas
export const RECIPES = {
  async chargen_a({ sess, sleep }) {
    await sess.go("chargen", null, 800);
    await sess.eval(() => { const sc = game.scenes.current; sc.pickWin(1); });
    await sess.mouse(...NEUTRAL[0]);
    await sleep(900);
  },
  async chargen_b_fighter({ sess, sleep }) {
    await sess.go("chargen", null, 800);
    await sess.eval(() => { const sc = game.scenes.current; sc.pickWin(1); if (!sc.name || !sc.name.trim()) sc.name = "Aldor"; sc.setStage("B"); });
    await sess.mouse(...NEUTRAL[0]);
    await sleep(900);
  },
  async town_tip({ sess, sleep }) {
    await sess.ensureHero();
    await sess.go("town", null, 1500);
    await sess.eval(() => { const sc = game.scenes.current; if (!sc.tip) sc.openTip(); });
    await sess.mouse(745, 209);            // onde o original clicou em "Accept"
    await sleep(500);
  },
  async town_default({ sess, sleep }) {
    await enterTown(sess);
    await sess.mouse(...(await townNeutral(sess)));
    await sleep(500);
  },
  async town_hover_inn({ sess, sleep, meta }) {
    await enterTown(sess);
    await sess.mouse(359, 513);            // posicao usada no original
    await sleep(900);
    if (!(await sess.eval(() => game.scenes.current.hover))) meta.warnings.push("hover da taverna nao registrado");
  },
  async town_hover_shop({ sess, sleep, meta }) {
    await enterTown(sess);
    await sess.mouse(486, 450);
    await sleep(900);
    if (!(await sess.eval(() => game.scenes.current.hover))) meta.warnings.push("hover da loja nao registrado");
  },
  async town_kaarg({ sess, sleep }) {
    await enterTown(sess, { done: [10, 20], town: 2, stage: 30 });
    await sess.mouse(...(await townNeutral(sess)));
    await sleep(500);
  },
  async town_kaarg_hover_inn({ sess, sleep }) {
    await enterTown(sess, { done: [10, 20], town: 2, stage: 30 });
    await sess.mouse(739, 459);
    await sleep(900);
  },
  async town_druids({ sess, sleep }) {
    await enterTown(sess, { done: [10, 20, 30, 40, 50], town: 3, stage: 60 });
    await sess.mouse(...(await townNeutral(sess)));
    await sleep(500);
  },
  async town_druids_hover_inn({ sess, sleep }) {
    await enterTown(sess, { done: [10, 20, 30, 40, 50], town: 3, stage: 60 });
    await sess.mouse(339, 376);
    await sleep(900);
  },
  async inn_tip({ sess, sleep }) {
    await sess.ensureHero();
    await sess.go("inn", { town: 1 }, 1800);
    await sess.eval(() => { const sc = game.scenes.current; if (!sc.tip) sc.openTip(); });
    await sess.mouse(583, 312);
    await sleep(500);
  },
  async inn_default({ sess, sleep }) {
    await enterInn(sess);
    await sess.mouse(...NEUTRAL[0]);
    await sleep(400);
  },
  async inn_messenger({ sess, sleep, meta }) {
    await enterInn(sess);
    const i = await sess.eval(() => {
      const sc = game.scenes.current;
      let i = sc.patrons.findIndex(p => p.npc === 517);
      if (i < 0) i = sc.patrons.findIndex(p => p.kind === "quest");
      if (i >= 0) sc.select(i);
      return i;
    });
    if (i < 0) meta.warnings.push("mensageiro (npc 517 / quest) nao esta na taverna");
    await sess.mouse(488, 592);            // 3o cartao (onde o original clicou)
    await sleep(600);
  },
  async inn_messenger_talk({ sess, sleep, meta }) {
    await enterInn(sess);
    await sess.eval(() => { const sc = game.scenes.current; const i = sc.patrons.findIndex(p => p.npc === 517); if (i >= 0) sc.select(i); sc.press(1); });
    await sess.mouse(745, 255);
    await sleep(900);
    if (!(await sess.eval(() => !!game.scenes.current.talk))) meta.warnings.push("janela de conversa nao abriu");
  },
  async inn_kaarg({ sess, sleep }) {
    await enterInn(sess, { done: [10, 20], town: 2, stage: 30 });
    await sess.mouse(...NEUTRAL[0]);
    await sleep(400);
  },
  async inn_druids({ sess, sleep }) {
    await enterInn(sess, { done: [10, 20, 30, 40, 50], town: 3, stage: 60 });
    await sess.mouse(...NEUTRAL[0]);
    await sleep(400);
  },
  async shop_tip({ sess, sleep }) {
    await sess.ensureHero();
    await sess.go("shop", { town: 1 }, 1800);
    await sess.eval(() => { const sc = game.scenes.current; if (!sc.tip) sc.openTip(); });
    await sess.mouse(...NEUTRAL[0]);
    await sleep(500);
  },
  async shop_default({ sess, sleep }) {
    await enterShop(sess);
    await sess.mouse(...NEUTRAL[0]);
    await sleep(400);
  },
  async shop_kaarg({ sess, sleep }) {
    await enterShop(sess, { done: [10, 20], town: 2, stage: 30 });
    await sess.mouse(...NEUTRAL[0]);
    await sleep(400);
  },
  async shop_druids({ sess, sleep }) {
    await enterShop(sess, { done: [10, 20, 30, 40, 50], town: 3, stage: 60 });
    await sess.mouse(...NEUTRAL[0]);
    await sleep(400);
  },
  async briefing_10({ sess, sleep }) {
    await sess.ensureHero();
    await sess.go("briefing", { mission: 10 }, 1500);
    await sess.mouse(...NEUTRAL[0]);
    await sleep(400);
  },
  async globalmap({ sess, sleep }) {
    await sess.ensureHero({ flags: { accepted_10: 1 } });
    await mapAtStart(sess);
    await sess.mouse(...NEUTRAL[0]);
    return releaseClock(sess);
  },
  async globalmap_seq({ sess }) {
    await sess.ensureHero({ flags: { accepted_10: 1 } });
    await mapAtStart(sess);
    await sess.mouse(...NEUTRAL[0]);
  },
  async globalmap_kaarg({ sess, sleep }) {
    await campaignAt(sess, { done: [10, 20], town: 2, stage: 30 });
    await leaveGate(sess, 2, [["T", 2], ["M", 30], ["M", 31]]);
    await sess.go("globalmap", null, 1500);
    await sess.mouse(...NEUTRAL[0]);
    await sleep(400);
  },
  async globalmap_druids({ sess, sleep }) {
    await campaignAt(sess, { done: [10, 20, 30, 40, 50], town: 3, stage: 60 });
    await leaveGate(sess, 3, [["T", 3], ["T", 2], ["M", 60], ["M", 52]]);
    await sess.go("globalmap", null, 1500);
    await sess.mouse(...NEUTRAL[0]);
    await sleep(400);
  },
  async mission10_start({ sess, sleep, meta }) {
    await startMission(sess, 10, { closeDialogs: false, pause: false });
    await missionTerrainMouse(sess, meta);
    await sleep(300);
    meta.dialog_open = await sess.eval(() => __mission.hud.dialogOpen);
  },
  async mission10_idle({ sess, sleep, meta }) {
    await startMission(sess, 10, { pause: false });
    await sess.eval(() => { const m = __mission; m.selected = m.hero; m.view.selectedId = m.hero.id; m.world.command(m.hero, { type: "none" }); });
    await missionTerrainMouse(sess, meta);
    await sleep(1200);
    meta.hero = await sess.eval(() => { const h = __mission.hero; return { kind: h.kind, state: h.state, cell: [h.cx, h.cy] }; });
  },
  // Esc na missao 10 e um item do menu do jogo (original: refs/original/mission_game_options|quest_objectives|sound_options, 19/10)
  async mission_game_options({ sess, sleep }) { await missionMenuItem(sess, sleep, 350); },
  async mission_quest_objectives({ sess, sleep }) { await missionMenuItem(sess, sleep, 410); },
  async mission_sound_options({ sess, sleep }) { await missionMenuItem(sess, sleep, 380); },
  // combate com a cobra (missao 10): o original (run_combat.py) leva o heroi a ~7 celulas da cobra e ataca; aqui o heroi e posto a 7 celulas e ataca
  async m10_fight_seq({ sess, sleep, meta }) {
    await startMission(sess, 10, { pause: false });
    const r = await sess.eval(() => {
      const m = __mission, w = m.world, h = m.hero;
      const snake = w.units.find(u => u.active && u.alive && Math.abs(u.x - 27.5) < 0.7 && Math.abs(u.y - 42.5) < 0.7);
      if (!snake) return null;
      w.teleport(h, 20, 42);
      m.fog.update(w);
      m.selected = h; m.view.selectedId = h.id;
      m.centerOn(h.x + 2, h.y);
      m.world.command(h, { type: "attack", target: snake.id, forced: true });
      return { snake: snake.id, kind: snake.kind, hp: snake.hp };
    });
    if (!r) throw new Error("cobra (27.5,42.5) nao encontrada");
    meta.target = r;
    meta.warnings.push("heroi teleportado para 7 celulas da cobra (estado artificial)");
  },
  // morte do heroi: "Mission Failed" (original: tools/refcap/original/run_defeat.py, tela m10_defeat)
  async m10_defeat({ sess, sleep, meta }) {
    await startMission(sess, 10, { pause: false });
    await sess.eval(() => { const m = __mission; m.world.kill(m.hero); });
    await sleep(1500);
    await sess.mouse(700, 700);
    meta.warnings.push("heroi morto por m.world.kill (o original: vida da ficha do servidor = 0 + ataque)");
  },
  async mission_hud_full({ sess, sleep, meta }) {
    await startMission(sess, 10);
    await missionTerrainMouse(sess, meta);
    await sleep(500);
  },
  async mission_hero_hurt({ sess, sleep, meta }) {
    await startMission(sess, 10);
    meta.hero = await sess.eval(() => {
      const h = __mission.hero;
      h.hp = Math.max(1, Math.round(h.maxHp / 2));
      if (h.maxMana > 0) h.mana = Math.round(h.maxMana / 2);
      return { hp: h.hp, maxHp: h.maxHp, mana: h.mana, maxMana: h.maxMana };
    });
    await missionTerrainMouse(sess, meta);
    await sleep(600);
  },
  async mission_cursor_terrain({ sess, sleep, meta }) {
    await startMission(sess, 10);
    await missionTerrainMouse(sess, meta);
    await sleep(500);
    meta.cursor_name_expected = "move";
  },
  async mission_cursor_blocked({ sess, sleep, meta }) {
    await startMission(sess, 10);
    const p = await blockedPoint(sess);
    if (!p) throw new Error("nenhuma celula intransitavel visivel perto do heroi");
    meta.blocked_cell = p.cell;
    await sess.mouse(p.x, p.y);
    await sleep(500);
  },
  async mission_cursor_enemy({ sess, sleep, meta }) {
    await startMission(sess, 10);
    const t = await approach(sess, "enemy");
    meta.target = t;
    if (t.teleported) meta.warnings.push("heroi teleportado para perto do alvo (estado artificial; o original deve mostrar o mesmo tipo de cena)");
    await sess.mouse(t.screen.x, t.screen.y);
    await sleep(500);
  },
  async mission_cursor_friend({ sess, sleep, meta }) {
    await startMission(sess, 10);
    const t = await approach(sess, "friend");
    meta.target = t;
    if (t.teleported) meta.warnings.push("heroi teleportado para perto do alvo (estado artificial)");
    await sess.mouse(t.screen.x, t.screen.y);
    await sleep(500);
  },
  async mission_selected_enemy({ sess, sleep, meta }) {
    await startMission(sess, 10);
    const t = await approach(sess, "enemy");
    meta.target = t;
    await sess.eval(id => { const m = __mission, u = m.world.get(id); m.selected = u; m.view.selectedId = id; }, t.id);
    await missionTerrainMouse(sess, meta);
    await sleep(600);
  },
};
