/**
 * Prova da porta sim/exe/orders.ts (etapa 9, lote 4: as ordens do cliente e do script — o regrupamento 0x52b06f/0x52af8c/0x53d690/
 * 0x539da0/0x52afd2, os comandos de grupo 0x570e83, AI_GroupCmd_Move 0x5703c0, 0x570b8b, 0x570946, 0x5702be e os tratadores por unidade
 * 0x56d032, 0x56d1be, 0x56d3e6) contra os pares do oráculo (tools/re/oracle/fnprobe.py), com o arnês de exe_recon.ts (igualdade exata em
 * 100 % das chamadas). O grupo novo de 0x52b06f nasce no endereço que o original alocou (`allocGroupAddr` = eax do par). Rodar em game/:
 *   npx tsx src/sim/test/exe_orders.ts            (EXE_ORDERS_ONLY=0x5703c0,... para só algumas)
 */
import {
  aiGroupCmdMove, fn_0x52af8c, fn_0x52afd2, fn_0x52b06f, fn_0x539da0, fn_0x53d690, fn_0x5702be, fn_0x570946, fn_0x570b8b, fn_0x570e83, fn_0x56d032,
  fn_0x56d1be, fn_0x56d3e6,
} from "../exe/orders";
import { aiGroupMaxScanRange } from "../exe/think";
import { PlayerRec } from "../exe/types";
import { A, EAX, GROUP_FIELDS, M, U, checkFields, finView, groupFrom, ptrListFrom, run, runPairs, spellFrom, worldRec, type Check, type Ctx } from "./exe_recon";

const MAP_PTR = 0x670e48, WORLD_PTR = 0x66832c;
const HOOKED = new Set<string>();

function world(c: Ctx, w?: number) {
  const wa = w ?? c.cm.u32(WORLD_PTR);
  const m = M(c, c.cm.has(MAP_PTR) ? c.cm.u32(MAP_PTR) : c.cm.u32(wa + 0xa50));
  return worldRec(c, wa, m);
}
const G = (c: Ctx, a: number) => groupFrom(c.cm, a);

const CHECKS: Record<string, Check> = {
  // regrupamento: `this` de 0x52b06f/0x53d690/0x539da0 é a lista de grupos do dono ([dono+0x28])
  "0x52b06f": run((c, d) => {
    const w = world(c);
    const p = new PlayerRec(); p.groups = ptrListFrom(c.cm, d.this);
    for (const ga of p.groups.values()) G(c, ga);
    w.allocGroupAddr = () => d.eax >>> 0;
    const g = fn_0x52b06f(w, p);
    c.ptrList = p.groups; c.ptrListAddr = d.this;
    // o grupo novo nasce em memória recém-alocada: os seus dados (+0x3c) conferidos pelo ponteiro FINAL, fora da conferência geral
    const e = checkFields(c.cm, finView(c.cm).u32(g.addr + 0x3c), g.stats as unknown as Record<string, number>, GROUP_FIELDS, "grupo novo");
    c.cm.groups.delete(g.addr);
    if (e) throw new Error(e);
    return g.addr | 0;
  }, EAX),
  "0x52af8c": run((c, d) => { world(c); fn_0x52af8c(G(c, d.this), U(c, A(d, 0))); return null; }),
  "0x52afd2": run((c, d) => { world(c); fn_0x52afd2(G(c, d.this), U(c, A(d, 0))); return null; }),
  "0x53d690": run((c, d) => { world(c); const l = ptrListFrom(c.cm, d.this); fn_0x53d690(l, A(d, 0)); c.ptrList = l; c.ptrListAddr = d.this; return null; }),
  "0x539da0": run((c, d) => { world(c); const l = ptrListFrom(c.cm, d.this); fn_0x539da0(l, A(d, 0)); c.ptrList = l; c.ptrListAddr = d.this; return null; }),
  // comandos de grupo
  "0x570e83": run((c, d) => { const w = world(c, d.this); fn_0x570e83(w, G(c, A(d, 0))); return null; }),
  "0x5703c0": run((c, d) => { const w = world(c, d.this); aiGroupCmdMove(w, G(c, A(d, 0)), A(d, 1), A(d, 2)); return null; }),
  "0x570b8b": run((c, d) => { const w = world(c, d.this); fn_0x570b8b(w, G(c, A(d, 0))); return null; }),
  "0x570946": run((c, d) => { const w = world(c, d.this); fn_0x570946(w, G(c, A(d, 0)), U(c, A(d, 1))); return null; }),
  "0x5702be": run((c, d) => { const w = world(c, d.this); fn_0x5702be(w, G(c, A(d, 0)), U(c, A(d, 1))); return null; }),
  "0x56f850": run((c, d) => { const w = world(c); return aiGroupMaxScanRange(w, G(c, A(d, 0))); }, EAX),
  // por unidade
  "0x56d032": run((c, d) => { const w = world(c, d.this); fn_0x56d032(w, U(c, A(d, 0)), A(d, 1), A(d, 2)); return null; }),
  "0x56d1be": run((c, d) => { const w = world(c, d.this); fn_0x56d1be(w, U(c, A(d, 0)), U(c, A(d, 1))); return null; }),
  "0x56d3e6": run((c, d) => { const w = world(c, d.this); fn_0x56d3e6(w, U(c, A(d, 0)), U(c, A(d, 1)), spellFrom(c.cm, A(d, 2))); return null; }),
};

runPairs("exe_orders", CHECKS, HOOKED, "EXE_ORDERS_ONLY");
