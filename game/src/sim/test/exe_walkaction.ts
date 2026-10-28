/**
 * Prova da porta sim/exe/walk_action.ts (lote 5c, o andar), do despachante sim/exe/action.ts (etapa 6: 0x56dca2, 0x56ea52; etapa 7:
 * 0x56e5bc olhar em volta, golpe/magia como sub-ação 0x56eab5/0x56e8c3/0x56eff3/0x56f0bb/0x56ebc0/0x56e906/0x56dbc6/0x56d969...,
 * a lista de eventos do mundo 0x57b210, fim de caminho 0x56ed4e/0x567ddf/0x567a16/0x55aa21/0x54fb7f/0x57994d e a lista de patrulha
 * 0x57b020) e dos sorteios sim/exe/rand.ts (0x57afc0, 0x57afd0) contra
 * os pares do oráculo (tools/re/oracle/fnprobe.py) e a varredura no Unicorn (tools/re/oracle/fuzz_walk.py). Pares de 0x56dca2 que
 * caem numa tarefa ainda não portada (NotPorted) contam à parte, não como falha. Rodar em game/:
 *   npx tsx src/sim/test/exe_walkaction.ts            (EXE_WALK_ONLY=0x555411,fuzz para só algumas)
 *
 * Cada linha de refs/oracle/pairs/<episodio>/<addr>.jsonl é uma chamada do original em contexto real. Entradas remontadas só
 * pelos acessos da própria chamada (CallMem): o objeto de mapa inteiro (`TestMap`), as unidades pelos ponteiros (argumentos e
 * as que o mapa guarda: occCur+4, lista de 0x54ec6a), os sub-registros de andar (+0x1c0) e IA (+0x1c4), listas e CMap.
 * Exige igualdade exata em 100 % das chamadas:
 *   - retorno na largura declarada; rand(): a mesma contagem e a mesma semente final (`nrand`, `rng1`), logo os mesmos valores na
 *     mesma ordem (o `Rng` do motor parte da semente `rng0` da chamada);
 *   - mapa: todo byte que a porta mudou foi escrito pelo original e todo byte escrito pelo original igual ao final (CMap e
 *     lista de unidades conferidos por nós);
 *   - cada unidade tocada: cada campo espelhado (tabelas abaixo) igual ao final se o original o escreveu, intocado senão;
 *     nenhuma escrita do original na unidade/andar/IA/objeto de mapa fora dos campos espelhados; listas +0x1c8/+0x1e4.
 *
 * refs/ não vai para o git: sem os pares, o teste avisa e passa.
 */
import {
  NotPorted, aiUnitDistance, dirFromDelta16, fn_0x52b22a, fn_0x54f618, fn_0x5503af, fn_0x550697, fn_0x55073f, fn_0x55532d,
  fn_0x554fd2, fn_0x555c7e, fn_0x5568e4, fn_0x556d78, fn_0x556da2, fn_0x558f64, fn_0x55a147, fn_0x56fc69, gridUnitsInRings,
  pathClearDynamic, unitActionChase, unitActionWalk, unitPlaceOnCells, unitRemoveFromCells, unitTurnStep, unitWalkFormula,
  unitWalkNear, unitWalkWait,
} from "../exe/walk_action";
import {
  aiAngleTiebreak, aiEnemyFilter, aiStandGroundAt, fn_0x53a5a0, fn_0x54fb7f, fn_0x558b75, fn_0x567ddf, fn_0x56d969, fn_0x56dba1,
  fn_0x56dbc6, fn_0x56dbfb, fn_0x56dc24, fn_0x56e8c3, fn_0x56e906, fn_0x56ea52, fn_0x56eab5, fn_0x56ebc0, fn_0x56ed4e, fn_0x56eff3,
  fn_0x56f0bb, fn_0x57994d, unitActionDispatcher, unitLookAround,
} from "../exe/action";
import { CListEvent, CListEventNode, type CListPtr } from "../exe/mfc";
import { fn_0x57afd0, randUniformObject } from "../exe/rand";
import { Rng } from "../rng";
import {
  EVENT_SIZE, MAP_ALT_OFF, MAP_DIR_CELL_OFF, MAP_DIR_DX_OFF, MAP_DIR_DY_OFF, MAP_RINGS_OFF, MAP_SPEED_MUL_OFF, MAP_WORLD_OFF, MapObjRec,
  MapRec, UnitRec, WorldRec,
} from "../exe/types";
import {
  A, AL, AX, CallMem, EAX, M, PAIRS, U, W, WORLD_CAND_OFF, WORLD_DIP_OFF, WR, checkPtrList, eq, eventListFrom, existsSync, join, listFrom,
  mapObjFrom, proc, ptrListFrom, readFileSync, readdirSync, run, type Check, type Pair,
} from "./exe_recon";


const CHECKS: Record<string, Check> = {
  "0x5551ef": run((c, d) => { unitWalkWait(U(c, A(d, 0))); return null; }),
  "0x556454": run((c, d) => { unitTurnStep(U(c, A(d, 0)), A(d, 1)); return null; }),
  "0x5568e4": run((c, d) => fn_0x5568e4(U(c, A(d, 0)), U(c, A(d, 1))), AL),
  "0x556d78": run((c, d) => { fn_0x556d78(U(c, A(d, 0)), U(c, A(d, 1))); return null; }),
  "0x54f618": run((c, d) => fn_0x54f618(U(c, A(d, 0)), A(d, 1)), EAX),
  "0x558f64": run((c, d) => fn_0x558f64(U(c, A(d, 0))), AX),
  "0x556dcd": run((c, d) => aiUnitDistance(M(c, d.this), U(c, A(d, 0)), U(c, A(d, 1))), EAX),
  "0x55532d": run((c, d) => fn_0x55532d(M(c, d.this), U(c, A(d, 0)), U(c, A(d, 1)), A(d, 2)), EAX),
  "0x55a147": run((c, d) => fn_0x55a147(M(c, d.this), A(d, 0)), AL),
  "0x559195": run((c, d) => { const m = M(c, d.this); return unitWalkFormula(m, U(c, A(d, 0)), A(d, 1), (A(d, 2) << 24) >> 24); }, EAX),
  "0x554fd2": run((c, d) => { const m = M(c, d.this); fn_0x554fd2(m, U(c, A(d, 0))); return null; }),
  "0x555c7e": run((c, d) => { const m = M(c, d.this); fn_0x555c7e(m, U(c, A(d, 0))); return null; }),
  "0x555b38": run((c, d) => { const m = M(c, d.this); pathClearDynamic(m, U(c, A(d, 0))); return null; }),
  "0x555411": run((c, d) => { const m = M(c, d.this); unitActionWalk(m, U(c, A(d, 0)), A(d, 1), A(d, 2)); return null; }),
  "0x55574d": run((c, d) => { const m = M(c, d.this); unitActionChase(m, U(c, A(d, 0)), U(c, A(d, 1)), A(d, 2)); return null; }),
  "0x56e4ac": run((c, d) => { const w = W(c, d.this); unitWalkNear(w, U(c, A(d, 0)), A(d, 1), A(d, 2)); return null; }),
  "0x56fc69": run((c, d) => { const w = W(c, d.this); return fn_0x56fc69(w, U(c, A(d, 0)), A(d, 1)); }, AL),
  "0x56dca2": run((c, d) => { const w = W(c, d.this); w.fbbe8 = c.cm.u32(d.this + 0xbbe8); unitActionDispatcher(w, U(c, A(d, 0))); return null; }),
  "0x56ea52": run((c, d) => { const w = W(c, d.this); fn_0x56ea52(w, U(c, A(d, 0)), A(d, 1)); return null; }),
  "0x56e5bc": run((c, d) => { const w = W(c, d.this); unitLookAround(w, U(c, A(d, 0))); return null; }),
  "0x53a5a0": run((c, d) => fn_0x53a5a0(U(c, d.this)), AL),
  "0x56e8c3": run((c, d) => { fn_0x56e8c3(U(c, A(d, 0))); return null; }),
  "0x56eab5": run((c, d) => { const w = W(c, d.this); fn_0x56eab5(w, U(c, A(d, 0))); return null; }),
  "0x56f0bb": run((c, d) => { fn_0x56f0bb(U(c, A(d, 0)), A(d, 1)); return null; }),
  "0x56eff3": run((c, d) => { const w = W(c, d.this); fn_0x56eff3(w, U(c, A(d, 0))); return null; }),
  "0x558b75": run((c, d) => { const m = M(c, d.this); fn_0x558b75(m, U(c, A(d, 0))); return null; }),
  "0x56d969": run((c, d) => { const w = W(c, d.this); fn_0x56d969(w, U(c, A(d, 0))); return null; }),
  "0x56dbfb": run((c, d) => { const w = W(c, d.this); fn_0x56dbfb(w, U(c, A(d, 0))); return null; }),
  "0x56d52b": run((c, d) => { const w = W(c, d.this); aiStandGroundAt(w, U(c, A(d, 0))); return null; }),
  "0x56dba1": run((c, d) => { const w = W(c, d.this); fn_0x56dba1(w, U(c, A(d, 0))); return null; }),
  "0x56dbc6": run((c, d) => { const w = W(c, d.this); fn_0x56dbc6(w, U(c, A(d, 0))); return null; }),
  "0x56e906": run((c, d) => { const w = W(c, d.this); fn_0x56e906(w, U(c, A(d, 0))); return null; }),
  "0x56ebc0": run((c, d) => { const w = W(c, d.this); fn_0x56ebc0(w, U(c, A(d, 0))); return null; }),
  "0x54fb7f": run((c, d) => fn_0x54fb7f(mapObjFrom(c.cm, d.this), mapObjFrom(c.cm, A(d, 0))), AL),
  "0x55aa21": run((c, d) => aiAngleTiebreak(A(d, 0), A(d, 1)), AL),
  "0x57994d": run((c, d) => (fn_0x57994d(WR(c, d.this - WORLD_DIP_OFF), U(c, A(d, 0)), U(c, A(d, 1))) ? 1 : 0), AL),
  "0x567ddf": run((c, d) => { const w = W(c, d.this); fn_0x567ddf(w); return null; }),
  "0x567a16": run((c, d) => {
    const w = W(c, d.this);
    // a lista é o CList em param_2+4: a dos candidatos do mundo (+0xa64) ou outra (pensamento da IA)
    let l: CListPtr;
    if (A(d, 1) === d.this + WORLD_CAND_OFF - 4) l = w.cand;
    else { l = ptrListFrom(c.cm, A(d, 1) + 4); c.ptrList = l; c.ptrListAddr = A(d, 1) + 4; }
    aiEnemyFilter(w, U(c, A(d, 0)), l, A(d, 2));
    return null;
  }),
  "0x53afb0": run((c, d) => { const l = ptrListFrom(c.cm, d.this); c.ptrList = l; c.ptrListAddr = d.this; l.remove(A(d, 0)); return null; }),
  "0x44fc20": run((c, d) => ptrListFrom(c.cm, d.this).count, EAX),
  "0x56ed4e": run((c, d) => { const w = W(c, d.this); fn_0x56ed4e(w, U(c, A(d, 0))); return null; }),
  "0x56dc24": run((c, d) => { const w = W(c, d.this); fn_0x56dc24(w, U(c, A(d, 0))); return null; }),
  "0x57b020": (d, cm) => {
    // Find na lista de patrulha (this = o CList<WORD>): devolve o nó (POSITION) ou 0; conferimos nulidade e o dado do nó achado
    const l = listFrom(cm, d.this);
    const after = A(d, 1) === 0 ? null : (() => { throw new Error("Find com POSITION de partida: não previsto"); })();
    const n = l.find(A(d, 0) & 0xffff, after);
    if ((n === null) !== (d.eax === 0)) return `Find: porta ${n === null ? "nulo" : "nó"} ≠ original ${d.eax === 0 ? "nulo" : "nó"}`;
    return n === null || !cm.has(d.eax + 8) ? null : eq("Find.dado", n.data & 0xffff, cm.u16(d.eax + 8));
  },
  "0x57b210": run((c, d) => {
    // fastcall: ECX = a lista (mundo+0xbbec); o evento (0x54 bytes) vem por valor na pilha, logo acima do endereço de retorno
    c.events = eventListFrom(c.cm, d.this);
    c.eventsAddr = d.this;
    c.events.addTail(c.cm.bytes(d.esp0 + 4, EVENT_SIZE));
    return null;
  }),
  "0x57afc0": run((c, d) => randUniformObject(WR(c, d.this), 0x57afc0), EAX),
  "0x57afd0": run((c, d) => fn_0x57afd0(WR(c, d.this), A(d, 0), 0x57afd0), EAX),
  "0x54ec6a": run((c, d) => {
    const m = M(c, d.this);
    const l = gridUnitsInRings(m, A(d, 0), A(d, 1));
    if (l !== m.ringUnits) throw new Error("lista devolvida ≠ mapa+0x54010");
    return d.this + MAP_RINGS_OFF;
  }, EAX),
  "0x52b22a": (d, cm) => {
    const l = ptrListFrom(cm, d.this + 4);
    fn_0x52b22a(l, A(d, 0));
    return checkPtrList(cm, d.this + 4, l, "lista") ?? (d.nrand !== 0 ? "rand() chamado no original" : null);
  },
  "0x55073f": run((c, d) => { const m = M(c, d.this); return fn_0x55073f(m, U(c, A(d, 0)), A(d, 1), A(d, 2)); }, EAX),
  "0x550697": run((c, d) => { const m = M(c, d.this); return fn_0x550697(m, U(c, A(d, 0))); }, EAX),
  "0x553891": run((c, d) => { const m = M(c, d.this); return unitRemoveFromCells(m, U(c, A(d, 0))); }, AL),
  "0x5503af": run((c, d) => { const m = M(c, d.this); return fn_0x5503af(m, U(c, A(d, 0)), A(d, 1), A(d, 2)); }, EAX),
  "0x55020a": run((c, d) => { const m = M(c, d.this); return unitPlaceOnCells(m, U(c, A(d, 0))); }, EAX),
};

interface NodeEnv { env: Record<string, string | undefined>; }
const only = (proc as unknown as NodeEnv).env.EXE_WALK_ONLY?.split(",");
let failures = 0;
const notPorted = new Map<string, number>();
if (!existsSync(PAIRS)) {
  console.log(`exe_walkaction: sem pares em ${PAIRS} (rode tools/re/oracle/fnprobe.py); pulado.`);
} else {
  const total = new Map<string, number>();
  for (const ep of readdirSync(PAIRS).sort()) {
    for (const [fn, check] of Object.entries(CHECKS)) {
      if (only && !only.includes(fn)) continue;
      const file = join(PAIRS, ep, `${fn}.jsonl`);
      if (!existsSync(file)) continue;
      let n = 0, bad = 0, first = "", skipped = 0;
      for (const line of readFileSync(file, "utf8").split("\n")) {
        if (!line) continue;
        const d = JSON.parse(line) as Pair;
        n++;
        let err: string | null;
        try {
          err = check(d, new CallMem(d));
        } catch (ex) {
          if (ex instanceof NotPorted) notPorted.set(ex.addr, (notPorted.get(ex.addr) ?? 0) + 1);
          // despachante: a chamada caiu numa tarefa/sub-ação ainda não portada (IA, golpe, magia): fora da prova
          if (ex instanceof NotPorted && fn === "0x56dca2") { skipped++; n--; continue; }
          err = `exceção: ${(ex as Error).message}`;
        }
        if (err) { bad++; if (!first) first = `t=${d.t} seq=${d.seq}: ${err}`; }
      }
      if (bad) failures++;
      total.set(fn, (total.get(fn) ?? 0) + n);
      if (n === 0) continue;
      console.log(`  ${bad ? "FALHOU" : "ok  "} ${ep} ${fn}: ${n - bad}/${n}${skipped ? ` (+${skipped} em ramo não portado)` : ""}${first ? "  " + first : ""}`);
    }
  }
  const missing = Object.keys(CHECKS).filter((f) => !total.get(f) && (!only || only.includes(f)));
  if (missing.length) console.log(`  sem chamadas gravadas: ${missing.join(" ")}`);
  if (notPorted.size) console.log(`  NotPorted alcançado: ${[...notPorted].map(([a, k]) => `${a}×${k}`).join(" ")}`);
}

// --------------------------------------------------------------------------------- varredura no Unicorn (fuzz_walk.py)

interface FzUnit { x: number; y: number; fx: number; fy: number; size: number; kind: number; speed: number; sb: number; }
interface FzCase { fn: string; in: Record<string, unknown> & { u: FzUnit; t?: FzUnit }; out: Record<string, unknown>; }

function fzUnit(f: FzUnit, addr: number): UnitRec {
  const u = new UnitRec();
  u.addr = addr;
  u.vtbl = 0x5d0eb0;
  u.mapObj.x = f.x; u.mapObj.y = f.y; u.mapObj.fx = f.fx; u.mapObj.fy = f.fy; u.mapObj.cell = (f.y << 8) | f.x;
  u.size = f.size; u.kind = f.kind; u.speed = f.speed; u.type.stats.speedByte = f.sb;
  return u;
}

function fzRun(c: FzCase): Record<string, unknown> {
  const i = c.in;
  const u = fzUnit(i.u, 1);
  if (c.fn === "0x559195") {
    const m = new MapRec();
    const dx = i.dx as number[], dy = i.dy as number[], step = i.step as number[];
    for (let k = 0; k < 8; k++) {
      m.dv.setInt8(MAP_DIR_DX_OFF + k, dx[k]); m.dv.setInt8(MAP_DIR_DY_OFF + k, dy[k]); m.dv.setInt32(MAP_DIR_CELL_OFF + k * 4, step[k], true);
    }
    m.dv.setInt32(MAP_SPEED_MUL_OFF, i.mul as number, true);
    for (const [cl, v] of i.alt as number[][]) m.dv.setInt8(MAP_ALT_OFF + cl, v);
    for (const [cl, v] of i.cost as number[][]) m.mem[cl] = v;
    try {
      const eax = unitWalkFormula(m, u, i.cell as number, ((i.dir as number) << 24) >> 24);
      const w = u.walk, b = new Uint8Array(10), dv = new DataView(b.buffer);
      dv.setUint16(0, w.stepSpeed, true); dv.setUint16(2, w.stepTicks, true); dv.setUint16(4, w.stepTick, true);
      dv.setUint16(6, w.stepDir, true); dv.setInt8(8, w.stepDx); dv.setInt8(9, w.stepDy);
      return { eax, w: Array.from(b) };
    } catch (ex) {
      return { err: (ex as Error).message };
    }
  }
  const w = u.walk;
  const w0 = i.w0 as number[];
  w.dir = w0[0]; w.dirTarget = w0[1]; w.turnRate = i.rate as number; w.turning = i.turning as number; w.f9d = i.f9d as number;
  w.turnTicks = 0;
  const t = i.t ? fzUnit(i.t, 2) : u;
  const getw = () => ({ w0: [w.dir, w.dirTarget], a0: w.turning >>> 0, a4: w.turnTicks, "9d": w.f9d });
  switch (c.fn) {
    case "0x5551ef": unitWalkWait(u); return getw();
    case "0x556454": unitTurnStep(u, i.d as number); return getw();
    case "0x556da2": fn_0x556da2(u, i.cell as number); return getw();
    case "0x556b2c": return { al: dirFromDelta16(u, i.cell as number) };
    case "0x5568e4": return { al: fn_0x5568e4(u, t) };
    case "0x54f618": return { eax: fn_0x54f618(u, i.cell as number) };
    case "0x556dcd": return { eax: aiUnitDistance(new MapRec(), u, t) };
  }
  throw new Error(`caso ${c.fn} sem porta`);
}

const FUZZ = join(PAIRS, "..", "fuzz", "walk.jsonl");
if ((!only || only.includes("fuzz")) && existsSync(FUZZ)) {
  const per = new Map<string, [number, number, string]>();
  for (const line of readFileSync(FUZZ, "utf8").split("\n")) {
    if (!line) continue;
    const c = JSON.parse(line) as FzCase;
    const got = fzRun(c);
    const s = per.get(c.fn) ?? [0, 0, ""];
    s[0]++;
    const want = c.out;
    const same = "err" in want ? "err" in got : JSON.stringify(got) === JSON.stringify(want);
    if (!same) { s[1]++; if (!s[2]) s[2] = `${JSON.stringify(c.in).slice(0, 160)} → porta ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`; }
    per.set(c.fn, s);
  }
  for (const [fn, [n, bad, first]] of per) {
    if (bad) failures++;
    console.log(`  ${bad ? "FALHOU" : "ok  "} fuzz ${fn}: ${n - bad}/${n}${first ? "  " + first : ""}`);
  }
} else if (!only || only.includes("fuzz")) {
  console.log(`  sem varredura em ${FUZZ} (rode tools/re/oracle/fuzz_walk.py)`);
}

console.log(failures ? `exe_walkaction: ${failures} FALHA(S)` : "exe_walkaction: tudo igual ao original");
if (failures) proc.exitCode = 1;
