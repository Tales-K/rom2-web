/**
 * Porta literal do servidor do allods2.exe: a morte consumada e o corpo (etapa 8a, lote 3; notes/maquina-de-acao.md).
 * Portadas: 0x510a70 Unit_Die (chamada pela máquina 0x50f12c quando a vida fica < −9 depois da queda, e por World_SecondTick):
 * invocada (+0x148) → vida −10000; tarefa e ação 0x10; sai das células (0x553891) e volta ao centro (0x5551d6); itens +0x78/+0x74 para a
 * mochila (exec 0: NotPorted); vtable +0x4c; modelo com "NPC" no nome ou +0x1a0 → mochila nova vazia (gancho); monstro (modelo ≥ 0x40)
 * sem +0x1a0 → ouro (rand(100) < modelo[0x26] → modelo[0x27] + rand(modelo[0x28])) e item (rand(100) < modelo[0x29] → loja de
 * [0x2a]..[0x2b] com máscara [0x2c], 1 sorteado: gancho); mochila com itens ou ouro → saco (0x5109f5 Unit_DeathLoot: gancho) e mochila
 * nova; efeitos da lista +0x20 expiram (gancho); herói do dono (+0x38) → mortes +0xa54, evento, perfil (0x4e9e97: arquivo, stub), vida
 * −50; jogo não local com dono humano e modelo 0x21..0x3f → dono+0x40 (stub de envio); 0x5110b8 Corpse_Decay.
 * 0x5110b8 Corpse_Decay (também 1×/s em World_SecondTick para cada corpo): com vida > −10001, no segundo par ([[0x6044c4]+0]) vida −1
 * (modelos 0x21..0x24 só até −60); estado +0x13c por limiar (2 < −10, 3 < −20, 4 < −40, 5 < −600: vida −10001, id +4 liberado (0x4f8d3d
 * = stub: os ids são do motor) para +0x4a < 2); mudança de estado → Server_Event 1 (stub).
 * Os sorteios saem nos sítios 0x510cbc, 0x510cf3, 0x510d19 (e 0x510ddf no gancho do item) pelo `Rng` do mundo.
 */
import { NotPorted, unitRemoveFromCells } from "./walk_action";
import { mapObjCenterFraction } from "./walk";
import { randInclusive } from "./rand";
import { vt4c } from "./vtables";
import { EXE_GLOBALS, type UnitRec, type WorldRec } from "./types";

/** Ganchos da morte para o que vive no motor antigo (mochila, saque, loja, efeitos) e para a apresentação. Sem gancho → NotPorted. */
export interface DieHooks {
  /** 0x493480 + 0x5299b3: a mochila é destruída e nasce vazia (NPC ou +0x1a0 — tudo o que carregava some). */
  packDrop?(u: UnitRec): void;
  /** 0x5254e7/0x525f67 Shop_Init/Shop_Gen + 0x510ddf: 1 item sorteado da loja de [min, max] com a máscara vai para a mochila (+0x42 = 1). */
  lootItem?(u: UnitRec, min: number, max: number, mask: number): void;
  /** 0x53de20: quantos itens há na mochila +0x7c. */
  packCount?(u: UnitRec): number;
  /** 0x5109f5 Unit_DeathLoot → 0x52acf6 Sack_Create: a mochila e o ouro viram um saco na célula; a mochila nasce vazia (0x5299b3). */
  sackDrop?(u: UnitRec, gold: number, heroOwner: number): void;
  /** laço dos efeitos +0x20 na morte: os com flags 0x5d07e0/0x5d07e4 (0x51cc53) expiram (+0x42 = 1, vtable+0x38, 0x542540 → tira). */
  effectsOnDie?(u: UnitRec): void;
  /** vtable +0x4c dos humanos (0x512697, exec 0): o equipamento vai para a mochila. */
  onDieHuman?(u: UnitRec): void;
  /** Server_Event 0x2400000 (herói do dono morreu) e 0x4e9e97 (perfil em arquivo): stub de cliente com gancho para a apresentação. */
  heroDied?(u: UnitRec): void;
  /** depois de tudo (não é do exe): apresentação da morte consumada (evento, abates, corpo). */
  died?(u: UnitRec): void;
}

/** 0x5110b8 Corpse_Decay (fastcall). */
export function corpseDecay(u: UnitRec, _h: DieHooks = {}): void {
  if (-0x2711 < ((u.f94 << 16) >> 16)) {
    const iVar1 = u.f13c & 0xff;   // param_1[0x4f]: só o byte baixo é comparado
    const sec = EXE_GLOBALS.w6044c4 | 0;
    const uVar2 = sec >> 31;
    if ((((((sec ^ uVar2) - uVar2) | 0) & 1) ^ uVar2) === uVar2) {
      if ((u.f0e & 0xffff) < 0x21 || 0x24 < (u.f0e & 0xffff)) u.f94 = ((((u.f94 << 16) >> 16) - 1) << 16) >> 16;
      else if (-0x3d < ((u.f94 << 16) >> 16)) u.f94 = ((((u.f94 << 16) >> 16) - 1) << 16) >> 16;
    }
    if (((u.f94 << 16) >> 16) < -10) u.f13c = 2;
    if (((u.f94 << 16) >> 16) < -0x14) u.f13c = 3;
    if (((u.f94 << 16) >> 16) < -0x28) u.f13c = 4;
    if (((u.f94 << 16) >> 16) < -600) {
      u.f13c = 5;
      u.f94 = (0xd8ef << 16) >> 16;
      if (iVar1 !== (u.f13c & 0xff)) { /* stub: cliente (Server_Event 1: estado do corpo) */ }
      if ((u.f04 >>> 0) !== 0 && (u.kind & 0xff) < 2) {
        // stub: 0x4f8d3d libera o id (u16 +4) no mapa de bits DAT_006c9628 (os ids do motor são do JS); exec 0 no corpus
        u.f04 = 0;
      }
    } else if (iVar1 !== (u.f13c & 0xff)) { /* stub: cliente (Server_Event 1) */ }
  }
}

/** 0x510a70 Unit_Die (fastcall). */
export function unitDie(wd: WorldRec, u: UnitRec, h: DieHooks = {}): void {
  if ((u.f148 >>> 0) !== 0) {
    u.f94 = (0xd8f0 << 16) >> 16;
    u.f148 = 0;
  }
  u.act = 0x10;
  u.task = 0x10;
  unitRemoveFromCells(wd.map, u);
  mapObjCenterFraction(u.mapObj);
  if (u.f78 !== null) throw new NotPorted("0x529ac2");   // vtable +0x48 (0x5108c6/0x51266e) + Pack_AddItem: exec 0
  if (u.f74 !== null && (u.f74.tplF0f | 0) !== 0) throw new NotPorted("0x529ac2");   // arma com modelo[0xf] ≠ 0 → mochila: exec 0
  vt4c(u, h.onDieHuman);
  const local_1c = u.tpl!.name.indexOf("NPC") !== -1 ? 1 : 0;   // CString::Find (0x59e063): −1 = não achou
  if (local_1c !== 0 || (u.f1a0 >>> 0) !== 0) {
    if (!h.packDrop) throw new NotPorted("0x493480");
    h.packDrop(u);
  }
  let local_14 = 0;
  if (0x3f < (u.f0e & 0xffff) && (u.f1a0 >>> 0) === 0) {
    const arr = u.tpl!.arr;
    const chance = arr[0x26]! | 0;
    let iVar3 = randInclusive(wd, 100, 0x510cbc);
    if (iVar3 < chance) {
      local_14 = randInclusive(wd, arr[0x28]! | 0, 0x510cf3);
      local_14 = ((arr[0x27]! | 0) + local_14) | 0;
    }
    const ichance = arr[0x29]! | 0;
    iVar3 = randInclusive(wd, 100, 0x510d19);
    if (iVar3 < ichance) {
      if (!h.lootItem) throw new NotPorted("0x5254e7");
      h.lootItem(u, arr[0x2a]! | 0, arr[0x2b]! | 0, arr[0x2c]! | 0);
    }
  }
  const iVar3 = h.packCount ? h.packCount(u) | 0 : 0;   // 0x53de20: sem gancho a mochila espelhada está vazia
  if (0 < iVar3 || local_14 !== 0) {
    const local_d0 = (u.owner.f38 >>> 0) === 0 || (u.owner.f38 >>> 0) !== (u.addr >>> 0) ? 0 : 1;
    if (!h.sackDrop) throw new NotPorted("0x5109f5");
    h.sackDrop(u, local_14, local_d0);
  }
  h.effectsOnDie?.(u);   // laço dos efeitos +0x20: sem gancho a lista espelhada está vazia
  if ((u.owner.f38 >>> 0) !== 0 && (u.owner.f38 >>> 0) === (u.addr >>> 0)) {
    u.owner.fa54 = (u.owner.fa54 + 1) | 0;
    h.heroDied?.(u);   // stub: cliente (Server_Event 0x2400000) e perfil do herói em arquivo (0x4e9e97)
    u.f94 = (0xffce << 16) >> 16;
  }
  if ((EXE_GLOBALS.f74 | 0) === 0 && (u.owner.f2c | 0) === 0 && 0x20 < (u.f0e & 0xffff) && (u.f0e & 0xffff) < 0x40) {
    u.owner.f40 = ((u.f14c & 0xffff) - 0x13) & 0xff;
    // stub: cliente (0x505347, mensagem 0xb4)
  }
  corpseDecay(u, h);
  h.died?.(u);
}
