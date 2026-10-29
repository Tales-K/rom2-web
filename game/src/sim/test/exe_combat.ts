/**
 * Prova da porta sim/exe/combat.ts (etapa 8a: dano físico 0x516f6f e o seu fecho 0x56e6b8/0x57977a/0x5106d2/0x5169de/0x542560; o golpe
 * 0x516c1f/0x516ceb/0x516b2f/0x542580/0x50fc3e/0x50ff2d/0x558b3d/0x5040c4/0x504ab8/0x510745), da máquina de ação 0x50f12c
 * (sim/exe/action.ts), de sim/exe/rand.ts (0x51fa25) e sim/exe/vtables.ts contra os pares do oráculo (tools/re/oracle/fnprobe.py), com
 * o arnês de exe_recon.ts (igualdade exata em 100 % das chamadas: retorno, sorteios, unidades tocadas, dono, mundo). Chamadas que caem
 * num gancho de magia/efeitos/experiência ou numa tarefa do despachante sem porta (NotPorted em endereço da lista `HOOKED`) contam à
 * parte; NotPorted fora da lista é falha. Rodar em game/:
 *   npx tsx src/sim/test/exe_combat.ts            (EXE_COMBAT_ONLY=0x516f6f,... para só algumas)
 * refs/ não vai para o git: sem os pares, o teste avisa e passa.
 */
import {
  fn_0x5040c4, fn_0x504ab8, fn_0x50fc3e, fn_0x50ff2d, fn_0x5106d2, fn_0x510745, fn_0x5169de, fn_0x542560, fn_0x558b3d, fn_0x56e6b8,
  fn_0x57977a, unitPhysicalDamage, unitStrikeBegin, unitStrikeExtra, unitStrikeHit, weaponCastsSpell,
} from "../exe/combat";
import { unitActionMachine, type MachineHooks } from "../exe/action";
import { corpseDecay, unitDie } from "../exe/death";
import { randInclusive } from "../exe/rand";
import { fn_0x519441, spellSpendMana } from "../exe/spells";
import { NotPorted } from "../exe/walk_action";
import { UnitRec, type DmgRec } from "../exe/types";
import {
  A, AL, CallMem, EAX, M, PAIRS, U, WALK_FIELDS, WORLD_DIP_OFF, WR, dmgFrom, existsSync, fill, itemFrom, join, proc, readFileSync, readdirSync,
  run, runS, spellFrom, worldRec, type Check, type Ctx, type Pair,
} from "./exe_recon";

/** Ganchos para o replay: magia/experiência/morte → NotPorted (gancho esperado); o laço dos efeitos (+0x20) com lista não vazia
 *  → NotPorted 0x50ee14 (vtable+0x38 do efeito, motor antigo); o nível da magia lido da memória da chamada. */
function hooksFor(c: Ctx): MachineHooks {
  return {
    effectsTick: r => { if (c.cm.u32(r.addr + 0x24) !== 0) throw new NotPorted("0x50ee14"); },
    // experiência do herói (0x513128 → 0x5128cb): motor antigo; as escritas dela ficam fora da conferência (exe_recon.ts checkUnit)
    xpOnHit: () => { /* nada */ },
    xpOnCast: () => { /* nada: 0x5131ef, experiência pela magia (motor antigo; escritas fora da conferência como as de 0x513128) */ },
    // Unit_Die: a mochila (+0x7c: CList, contagem em +0xc) lida da memória; os efeitos (+0x20) com lista não vazia = gancho (NotPorted)
    packCount: r => c.cm.u32(c.cm.u32(r.addr + 0x7c) + 0xc) | 0,
    effectsOnDie: r => { if (c.cm.u32(r.addr + 0x24) !== 0) throw new NotPorted("0x51cc53"); },
  };
}
const HOOKS: MachineHooks = {};
/** Endereços cujo NotPorted é um gancho esperado (magia 0x5106f4/0x519db8 — o gasto 0x519998 e o lançamento 0x519d7f são porta, 8b —, efeitos 0x50ee14/0x53b120, experiência
 *  0x513128, morte 0x510a70 (lote 3)) ou uma tarefa do despachante sem porta (exec 0), não falha. */
const HOOKED = new Set(["0x5106f4", "0x519db8", "0x50ee14", "0x53b120", "0x51cc53", "0x513128", "0x56ea24", "0x56ec3f", "0x56eb2d", "0x56ecbc"]);
/** Mapa/caminho do exe: [0x670e48]. */
const MAP_PTR = 0x670e48;
/** Mundo do exe: [0x66832c]. */
const WORLD_PTR = 0x66832c;

/** Atributos do golpe: a struct +0xa6 do agressor (registro partilhado) ou uma avulsa (magias). */
function dmgArg(c: Ctx, p: number, a: UnitRec | null): DmgRec | null {
  if (p === 0) return null;
  if (a && p === a.addr + 0xa6) return a.dmg;
  return dmgFrom(c.cm, p);
}

const CHECKS: Record<string, Check> = {
  "0x542560": run((c, d) => (fn_0x542560(U(c, d.this)) ? 1 : 0), AL),
  "0x5106d2": run((c, d) => fn_0x5106d2(U(c, d.this), A(d, 0)), EAX),
  "0x5169de": run((c, d) => fn_0x5169de(U(c, A(d, 0)), U(c, A(d, 1))), EAX),
  "0x51fa25": run((c, d) => randInclusive(WR(c, 0), A(d, 0), 0x51fa25), EAX),
  "0x57977a": run((c, d) => { const w = WR(c, d.this - WORLD_DIP_OFF); fn_0x57977a(w, U(c, A(d, 0)), U(c, A(d, 1)), A(d, 2)); return null; }),
  "0x56e6b8": run((c, d) => { const w = WR(c, d.this); fn_0x56e6b8(w, U(c, A(d, 0)), U(c, A(d, 1)), A(d, 2)); return null; }),
  "0x516f6f": run((c, d) => {
    const w = WR(c, c.cm.u32(WORLD_PTR));
    const t = U(c, d.this);
    const a = A(d, 1) === 0 ? null : U(c, A(d, 1));
    return unitPhysicalDamage(w, t, dmgArg(c, A(d, 0), a), a, HOOKS);
  }, EAX),
  "0x542580": run((c, d) => (weaponCastsSpell(itemFrom(c.cm, d.this)!) ? 1 : 0), AL),
  "0x50fc3e": run((c, d) => { WR(c, 0); return fn_0x50fc3e(U(c, d.this)); }, EAX),
  "0x5040c4": run((c, d) => { WR(c, 0); fn_0x5040c4(U(c, A(d, 0)), A(d, 1), A(d, 2), A(d, 3)); return null; }),
  "0x504ab8": run((c, d) => { WR(c, 0); fn_0x504ab8(U(c, A(d, 0))); return null; }),
  "0x558b3d": run((c, d) => {
    // this = o andar (a chamada só lê +1): remontado de d.this; argumentos: a unidade, o ponteiro de saída (local do chamador), p3, p4
    const u = new UnitRec();
    fill(u.walk as unknown as Record<string, number>, c.cm, d.this, WALK_FIELDS);
    return fn_0x558b3d(u.walk, u, { v: 0 }, A(d, 2), A(d, 3)) ? 1 : 0;
  }, AL),
  "0x50ff2d": run((c, d) => { WR(c, 0); fn_0x50ff2d(U(c, d.this), A(d, 0), A(d, 1), A(d, 2), A(d, 3)); return null; }),
  "0x510745": run((c, d) => { fn_0x510745(U(c, d.this)); return null; }),
  "0x516b2f": run((c, d) => { const w = WR(c, 0); unitStrikeExtra(w, U(c, A(d, 0)), A(d, 1) === 0 ? null : U(c, A(d, 1)), { v: 0 }, hooksFor(c)); return null; }),
  "0x516ceb": runS((c, d) => { const w = worldRec(c, c.cm.u32(WORLD_PTR), M(c, c.cm.u32(MAP_PTR))); unitStrikeHit(w, U(c, A(d, 0)), A(d, 1) === 0 ? null : U(c, A(d, 1)), hooksFor(c)); return null; }),
  "0x516c1f": run((c, d) => { const w = WR(c, c.cm.u32(WORLD_PTR)); unitStrikeBegin(w, U(c, A(d, 0)), A(d, 1) === 0 ? null : U(c, A(d, 1)), hooksFor(c)); return null; }),
  "0x50f12c": runS((c, d) => {
    // o mapa: [0x670e48] (Unit_Die, lido mesmo sem o despachante) ou mundo+0xa50 (despachante)
    const wa = c.cm.u32(WORLD_PTR);
    const m = M(c, c.cm.has(MAP_PTR) ? c.cm.u32(MAP_PTR) : c.cm.u32(wa + 0xa50));
    const w = worldRec(c, wa, m);
    w.fbbe8 = c.cm.u32(wa + 0xbbe8);
    unitActionMachine(w, U(c, d.this), hooksFor(c));
    return null;
  }),
  // etapa 8b, lote 2: o gasto e o lançamento (exe/spells.ts); Spell_Apply 0x519db8 dentro de 0x519d7f fica em gancho
  "0x519998": run((c, d) => { WR(c, 0); return spellSpendMana(WR(c, 0), spellFrom(c.cm, d.this), U(c, A(d, 0)), A(d, 1) === 0 ? null : U(c, A(d, 1)), A(d, 2) & 0xff, A(d, 3) & 0xff, hooksFor(c)); }, EAX),
  "0x519441": run((c, d) => (fn_0x519441(spellFrom(c.cm, d.this)) ? 1 : 0), AL),
  "0x5110b8": run((c, d) => { WR(c, 0); corpseDecay(U(c, d.this)); return null; }),
  "0x510a70": run((c, d) => {
    // o mapa vem do global [0x670e48] (Unit_RemoveFromCells) e o mundo de [0x66832c] (sorteios)
    const m = M(c, c.cm.u32(MAP_PTR));
    const w = worldRec(c, c.cm.u32(WORLD_PTR), m);
    unitDie(w, U(c, d.this), hooksFor(c));
    return null;
  }),
};

interface NodeEnv { env: Record<string, string | undefined>; }
const only = (proc as unknown as NodeEnv).env.EXE_COMBAT_ONLY?.split(",");
let failures = 0;
const notPorted = new Map<string, number>();
if (!existsSync(PAIRS)) {
  console.log(`exe_combat: sem pares em ${PAIRS} (rode tools/re/oracle/fnprobe.py); pulado.`);
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
          if (ex instanceof NotPorted) {
            notPorted.set(ex.addr, (notPorted.get(ex.addr) ?? 0) + 1);
            if (HOOKED.has(ex.addr)) { skipped++; n--; continue; }
          }
          err = `exceção: ${(ex as Error).message}`;
        }
        if (err) { bad++; if (!first) first = `t=${d.t} seq=${d.seq}: ${err}`; }
      }
      if (bad) failures++;
      total.set(fn, (total.get(fn) ?? 0) + n);
      if (n === 0 && !skipped) continue;
      console.log(`  ${bad ? "FALHOU" : "ok  "} ${ep} ${fn}: ${n - bad}/${n}${skipped ? ` (+${skipped} em gancho/ramo sem porta)` : ""}${first ? "  " + first : ""}`);
    }
  }
  const missing = Object.keys(CHECKS).filter((f) => !total.get(f) && (!only || only.includes(f)));
  if (missing.length) console.log(`  sem chamadas gravadas: ${missing.join(" ")}`);
  if (notPorted.size) console.log(`  NotPorted alcançado: ${[...notPorted].map(([a, k]) => `${a}×${k}`).join(" ")}`);
}
console.log(failures ? `exe_combat: ${failures} FALHA(S)` : "exe_combat: tudo igual ao original");
if (failures) proc.exitCode = 1;
