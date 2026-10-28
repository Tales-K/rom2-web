/**
 * Prova da porta sim/exe/regen.ts (etapa 9, lote 1: regeneração 0x50fc5a e o laço de 1/s World_SecondTick 0x52bbb7 com Rand_One
 * 0x51fa4e e o CMap<uint,uint> de mfc.ts) contra os pares do oráculo (tools/re/oracle/fnprobe.py), com o arnês de exe_recon.ts
 * (igualdade exata em 100 % das chamadas: sorteios, unidades tocadas, listas). Unit_Die dentro do laço cai nos ganchos de mochila/saque
 * (NotPorted em endereço de `HOOKED`: conta à parte). Rodar em game/:
 *   npx tsx src/sim/test/exe_regen.ts            (EXE_REGEN_ONLY=0x50fc5a,... para só algumas)
 * refs/ não vai para o git: sem os pares, o teste avisa e passa.
 */
import { unitRegen, worldSecondTick } from "../exe/regen";
import { randOne } from "../exe/rand";
import { NotPorted } from "../exe/walk_action";
import { type DieHooks } from "../exe/death";
import {
  A, CallMem, EAX, M, PAIRS, U, WR, existsSync, join, listsFrom, proc, readFileSync, readdirSync, run, worldRec, type Check, type Ctx, type Pair,
} from "./exe_recon";

/** Mapa/caminho do exe: [0x670e48] (lido só quando Unit_Die roda). Mundo: [0x66832c]. */
const MAP_PTR = 0x670e48, WORLD_PTR = 0x66832c;
/** Ganchos de Unit_Die (como em exe_combat.ts): mochila da memória; efeitos com lista não vazia = gancho. */
function hooksFor(c: Ctx): DieHooks {
  return {
    packCount: r => c.cm.u32(c.cm.u32(r.addr + 0x7c) + 0xc) | 0,
    effectsOnDie: r => { if (c.cm.u32(r.addr + 0x24) !== 0) throw new NotPorted("0x51cc53"); },
  };
}
const HOOKED = new Set(["0x493480", "0x5254e7", "0x5109f5", "0x51cc53", "0x512697"]);

const CHECKS: Record<string, Check> = {
  "0x50fc5a": run((c, d) => { WR(c, 0); unitRegen(U(c, d.this)); return null; }),
  "0x51fa4e": run((c, d) => randOne(WR(c, 0), A(d, 0), 0x51fa4e), EAX),
  "0x52bbb7": run((c, d) => {
    // `this` = o contentor das listas [0x68d2dc]; o mapa só é lido se Unit_Die roda (base 0: nenhum byte baixo é lido nem escrito)
    const m = M(c, c.cm.has(MAP_PTR) ? c.cm.u32(MAP_PTR) : 0);
    const w = worldRec(c, c.cm.has(WORLD_PTR) ? c.cm.u32(WORLD_PTR) : 0, m);
    w.lists = listsFrom(c.cm, d.this);
    worldSecondTick(w, hooksFor(c));
    return null;
  }),
};

interface NodeEnv { env: Record<string, string | undefined>; }
const only = (proc as unknown as NodeEnv).env.EXE_REGEN_ONLY?.split(",");
let failures = 0;
const notPorted = new Map<string, number>();
if (!existsSync(PAIRS)) {
  console.log(`exe_regen: sem pares em ${PAIRS} (rode tools/re/oracle/fnprobe.py); pulado.`);
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
      console.log(`  ${bad ? "FALHOU" : "ok  "} ${ep} ${fn}: ${n - bad}/${n}${skipped ? ` (+${skipped} em gancho)` : ""}${first ? "  " + first : ""}`);
    }
  }
  const missing = Object.keys(CHECKS).filter((f) => !total.get(f) && (!only || only.includes(f)));
  if (missing.length) console.log(`  sem chamadas gravadas: ${missing.join(" ")}`);
  if (notPorted.size) console.log(`  NotPorted alcançado: ${[...notPorted].map(([a, k]) => `${a}×${k}`).join(" ")}`);
}
console.log(failures ? `exe_regen: ${failures} FALHA(S)` : "exe_regen: tudo igual ao original");
if (failures) proc.exitCode = 1;
