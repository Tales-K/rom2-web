/**
 * Porta literal do servidor do allods2.exe: o golpe físico e o dano (etapa 8a, notes/maquina-de-acao.md).
 * Portadas: 0x516f6f Unit_PhysicalDamage (acerto, absorção, resistência por tipo de arma, dano elemental A/B, Bless/Curse; marca o
 * agressor em +0x40/+0x48 e chama 0x56e6b8), 0x56e6b8 (golpe recebido: IA+0x54 = 1, célula de quem bateu IA+0x58, evento tipo 1 para a
 * IA de grupo na lista mundo+0xbbec, IA+0x94 agressor, IA+0x98 relógio de 16/s, IA+0x9c ponto de fuga), 0x57977a (guerra por agressão
 * na tabela mundo+0xa8bc), 0x5106d2 (bit de efeito 1 << n em +0x144), 0x5169de (distância entre centros em células, menos os lados),
 * 0x542560 (sem modelo +0x3c).
 * Contas em x87 (FPCW 0x27f = 53 bits = o double do JS): dano × (100 − proteção) / 100 + 0,75 truncado por CRT_ftol (crtFtol); ponto de
 * fuga = célula + delta × (10 / max(|dx|,|dy|)) truncado (max = 0 → NaN → ftol indefinido 0x80000000 → palavra 0).
 * Lote 2 (o golpe): 0x516c1f Unit_StrikeBegin, 0x516ceb Unit_StrikeHit (distância ≤ alcance → dano pela vtable +0x54 e vida −= dano;
 * 's' ao cliente; experiência vtable +0x6c), 0x516b2f Unit_StrikeExtra (carga extra do golpe à distância; Invisibility acaba), 0x542580
 * Weapon_CastsSpell, 0x53bff0, 0x542c90 AI_InBattle, 0x50fc3e, 0x50ff2d e 0x558b3d (aviso de giro/passo ao cliente: +0x138), 0x5040c4,
 * 0x504155, 0x504ab8 (começo do golpe para o cliente: +0x138), 0x510745 (cancela magia de item; ramo com exec 0).
 * Com gancho (magia, motor antigo): 0x5106f4 (efeito do tipo n na lista +0x20 → poder +0x40; exec 0: `effectPower`), o laço dos efeitos
 * 0xc em 0x516b2f (`effectExpire`), 0x519d7f Spell_Release (`spellRelease`), 0x513128 Unit_XPOnHit (`xpOnHit`); stub de cliente com
 * gancho: 0x504b1d/0x503672 's' (`clientHit`: HUD). 0x516ea0 (golpe à distância, exec 0): NotPorted.
 */
import { crtFtol, mapObjCellX, mapObjCellY, mapObjFineX, mapObjFineY, unitCenterX, unitCenterY, vtGetSize } from "./path";
import { fn_0x5514ce, mapObjCellOf } from "./walk";
import { NotPorted } from "./walk_action";
import { fn_0x53a5a0 } from "./action";
import { randInclusive } from "./rand";
import { vt2c, vt30, vt34, vt6c } from "./vtables";
import { spellRelease, type SpellHooks } from "./spells";
import { EXE_GLOBALS, type DmgRec, type ItemRec, type UnitRec, type WalkRec, type WorldRec } from "./types";

/** 0x582c40 (CRT abs, cdecl): |v| em 32 bits (INT_MIN fica INT_MIN). */
function crtAbs(v: number): number {
  v |= 0;
  return v < 0 ? (-v) | 0 : v;
}

/** Ganchos para o que a porta do combate não cobre (magia: motor antigo). Sem gancho → NotPorted. */
export interface CombatHooks extends SpellHooks {
  /** 0x5106f4: efeito do tipo `type` na lista de efeitos da unidade (+0x20) → poder (+0x40, short); null = não há (a porta apaga o bit). */
  effectPower?(u: UnitRec, type: number): number | null;
  /** 0x504b1d → 0x503672 's' (stub de cliente): o golpe acertou/errou `t` com `dmg` (HUD: evento, som, flecha). */
  clientHit?(a: UnitRec, t: UnitRec, dmg: number): void;
  /** 0x513128 Unit_XPOnHit (vtable +0x6c dos humanos): experiência pelo golpe (motor antigo). */
  xpOnHit?(a: UnitRec, t: UnitRec, dmg: number, p3: number): void;
}

/** 0x542560 (fastcall): a unidade não tem modelo (+0x3c nulo). */
export function fn_0x542560(u: UnitRec): boolean {
  return u.tpl === null;
}

/** 0x5106d2 (thiscall): bit `n` (1 << (n & 0x1f)) dos efeitos +0x144. */
export function fn_0x5106d2(u: UnitRec, n: number): number {
  return ((1 << (n & 0x1f)) & u.effects) | 0;
}

/** 0x5106f4 (thiscall; exec 0 no corpus): procura na lista de efeitos +0x20 o efeito com +0xc == `type`; devolve o poder dele (+0x40)
 *  ou null. Servida pelo gancho `effectPower` (os efeitos vivem no motor antigo). */
export function fn_0x5106f4(u: UnitRec, type: number, h: CombatHooks): number | null {
  if (!h.effectPower) throw new NotPorted("0x5106f4");
  return h.effectPower(u, type);
}

/** 0x5169de (cdecl): distância de Chebyshev entre os centros finos (0x50d884/0x50d8c0) menos (lado(a) + lado(b)) × 0x80 − 0x100;
 *  < 0x181 → 1 (AX; a parte alta de EAX fica com a da distância: CONCAT22), senão (d + 0x40) >> 8 células. */
export function fn_0x5169de(a: UnitRec, b: UnitRec): number {
  const uVar2 = unitCenterX(a);
  const uVar3 = unitCenterX(b);
  const iVar4 = crtAbs((uVar2 & 0xffff) - (uVar3 & 0xffff));
  const uVar2y = unitCenterY(a);
  const uVar3y = unitCenterY(b);
  let local_14 = crtAbs((uVar2y & 0xffff) - (uVar3y & 0xffff));
  if (local_14 < iVar4) local_14 = iVar4;
  const bVar1 = vtGetSize(a) & 0xff;
  const uVar2s = vtGetSize(b) & 0xff;
  local_14 = (local_14 - ((((bVar1 + uVar2s) * 0x80) | 0) - 0x100)) | 0;
  if (local_14 < 0x181) return (local_14 & ~0xffff) | 1;
  return (local_14 + 0x40) >> 8;
}

/** 0x57977a (thiscall; `this` = mundo+0xa8bc): guerra por agressão. O dono de `a` entra em guerra com o de `b` se não há guerra nem
 *  aliança (bit 0 | 1); o de `b` responde se `flag` = 0, ou já levou > 10 golpes (IA+0xac), ou está com menos de metade da vida, ou
 *  morreu (ação 0x10); com `flag` ≠ 0 conta o golpe. Avisos ao cliente (0x504e87) para o dono que não é de IA: stub. */
export function fn_0x57977a(wd: WorldRec, a: UnitRec, b: UnitRec, flag: number): void {
  const d = wd.dipTable;
  const bVar1 = a.owner.f04 & 0xff;
  const bVar2 = b.owner.f04 & 0xff;
  if ((d[bVar2 + bVar1 * 0x46 + 8]! & 3) === 0) {
    d[bVar2 + bVar1 * 0x46 + 8] = d[bVar2 + bVar1 * 0x46 + 8]! | 1;
    if ((a.owner.f2c | 0) === 0) { /* stub: cliente (0x504e87 ×2: diplomacia dos dois donos) */ }
  }
  if ((d[bVar1 + bVar2 * 0x46 + 8]! & 3) === 0) {
    if ((flag | 0) === 0 || 10 < (b.ai.fac | 0) || ((b.f94 << 16) >> 16) < Math.trunc(((b.f96 << 16) >> 16) / 2) || (b.act | 0) === 0x10) {
      d[bVar1 + bVar2 * 0x46 + 8] = d[bVar1 + bVar2 * 0x46 + 8]! | 1;
      if ((a.owner.f2c | 0) === 0) { /* stub: cliente (0x504e87 ×2) */ }
    }
    if ((flag | 0) !== 0) b.ai.fac = (b.ai.fac + 1) | 0;
  }
}

/** 0x56e6b8 (thiscall; `this` = mundo): `b` sofreu um golpe/magia de `a` (todo golpe físico, acerto ou não; magias com dano). */
export function fn_0x56e6b8(wd: WorldRec, a: UnitRec, b: UnitRec, flag: number): void {
  b.ai.f54 = 1;
  b.ai.f58 = mapObjCellOf(a.mapObj) & 0xffff;
  b.ai.f5a = 0;
  fn_0x57977a(wd, a, b, flag);
  wd.evtSetU32(0x00, 1);
  wd.evtSetU32(0x2c, a.addr);
  wd.evtSetU32(0x30, b.addr);
  wd.events.addTail(wd.evt);
  b.ai.f94 = a.addr >>> 0;
  b.ai.f98 = EXE_GLOBALS.clock16 >>> 0;
  const dx = ((mapObjFineX(b.mapObj) & 0xffff) - (mapObjFineX(a.mapObj) & 0xffff)) | 0;   // [ebp-0x14] (double)
  const dy = ((mapObjFineY(b.mapObj) & 0xffff) - (mapObjFineY(a.mapObj) & 0xffff)) | 0;   // [ebp-0x1c] (double)
  const iVar3 = crtAbs(crtFtol(dx));
  const iVar2 = crtAbs(crtFtol(dy));
  let local_2c: number;
  if (iVar2 < iVar3) local_2c = crtAbs(crtFtol(dx));
  else local_2c = crtAbs(crtFtol(dy));
  const k = 10 / local_2c;                      // qword 0x5d1b90 = 10.0; max = 0 → +inf
  const ddx = dx * k, ddy = dy * k;             // 0 × inf = NaN
  let local_8 = crtFtol((mapObjCellY(b.mapObj) & 0xff) + ddy) << 8;
  local_8 = (local_8 + crtFtol((mapObjCellX(b.mapObj) & 0xff) + ddx)) | 0;
  b.ai.f9c = local_8 & 0xffff;
}

/**
 * 0x516f6f Unit_PhysicalDamage (thiscall; `this` = a vítima, slot +0x54 das vtables): dano de um golpe físico de `a` com os atributos
 * `info` (a unidade+0xa6 de `a`, ou uma struct avulsa das magias). Bless (bit 0x14) sorteia rand(100) < poder → dano máximo; Curse
 * (bit 0x1c) → só o mínimo; senão rand(0..faixa). Acerto: ataque + rand(200) − 100 > defesa, ou r ≥ 90 (r ≤ −90 erra); o bit 0x10 de
 * `a` acerta sempre e ignora a absorção. Dano elemental A sempre (proteção de água), B só com acerto ou sem dano físico (proteção do
 * elemento). Marca em `this` quem bateu (+0x40, +0x48) e chama 0x56e6b8. Devolve o dano (≥ 0); 0 para quem tem o bit 8.
 */
export function unitPhysicalDamage(wd: WorldRec, t: UnitRec, info: DmgRec | null, a: UnitRec | null, h: CombatHooks): number {
  let local_2c: number;
  if (info === null) {
    local_2c = 0;
  } else if ((t.f4c & 8) === 0) {
    let local_20 = 0;
    local_2c = 0;
    let local_24 = info.dmin & 0xff;
    let local_28 = info.dadd & 0xff;
    if ((info.dmin & 0x80) !== 0 && vt30(a!) === 0) {
      local_24 = ((local_24 & 0x7f) * 0xf) | 0;
      local_28 = (local_28 * 0xf) | 0;
    }
    let bVar3 = true;
    if (a !== null) {   // param_2[5] (dono) ≠ 0: todo registro espelhado tem dono
      let uVar6 = fn_0x5106d2(a, 0x14);
      if (uVar6 !== 0) {
        const iVar5 = fn_0x5106f4(a, 0x14, h);
        if (iVar5 === null) {
          a.effects = (a.effects & 0xffefffff) >>> 0;
        } else {
          const sVar1 = (iVar5 << 16) >> 16;
          const r = randInclusive(wd, 100, 0x517057);
          if (r < sVar1) {
            local_24 = (local_24 + local_28) | 0;
            bVar3 = false;
          }
        }
      }
      uVar6 = fn_0x5106d2(a, 0x1c);
      if (uVar6 !== 0) {
        const iVar5 = fn_0x5106f4(a, 0x1c, h);
        if (iVar5 === null) {
          a.effects = (a.effects & 0xefffffff) >>> 0;
        } else {
          const sVar1 = (iVar5 << 16) >> 16;
          const r = randInclusive(wd, 100, 0x5170b6);
          if (r < sVar1) bVar3 = false;
        }
      }
    }
    if (bVar3) {
      const iVar5 = randInclusive(wd, local_28, 0x5170d3);
      local_24 = (local_24 + iVar5) | 0;
    }
    const sVar1 = (info.atk << 16) >> 16;
    let iVar5 = randInclusive(wd, 200, 0x5170f8);
    iVar5 = (iVar5 - 100) | 0;
    const sVar2 = (t.fbe << 16) >> 16;
    if (sVar2 < ((sVar1 + iVar5) | 0) || (a !== null && (a.f4c & 0x10) !== 0)) {
      local_20 = local_24;
    } else if (iVar5 < 0x5a) {
      if (iVar5 < -0x5a) local_20 = 0;
    } else {
      local_20 = local_24;
    }
    if (0 < local_20) {
      if (a !== null && (a.f4c & 0x10) === 0) local_20 = (local_20 - ((t.fc0 << 16) >> 16)) | 0;
      if (local_20 < 0) local_20 = 0;
      const res = t.resist[info.wtype & 0xff] ?? 0;   // byte em this + wtype + 0xce (u8)
      if (res !== 0) local_20 = crtFtol(local_20 * (100 - res) / 100 + 0.75);
      local_2c = local_20;
    }
    if (((info.elA1 & 0xff) + (info.elA0 & 0xff)) !== 0) {
      const iVar7 = randInclusive(wd, info.elA1 & 0xff, 0x5171fd);
      local_20 = (iVar7 + (info.elA0 & 0xff)) | 0;
      const p = (t.prot[2]! << 16) >> 16;   // +0xc6 água
      if (p !== 0) {
        const l = crtFtol(local_20 * (100 - p) / 100 + 0.75);
        local_20 = l < 0 ? 0 : l;
      }
      local_2c = (local_2c + local_20) | 0;
    }
    if (((info.elB1 & 0xff) + (info.elB0 & 0xff)) !== 0 && (sVar2 < ((sVar1 + iVar5) | 0) || ((info.dmin & 0xff) + (info.dadd & 0xff)) === 0)) {
      iVar5 = randInclusive(wd, info.elB1 & 0xff, 0x5172b7);
      local_20 = (iVar5 + (info.elB0 & 0xff)) | 0;
      const k = info.elK & 0xff;
      const scale = (p: number): void => {
        if (p !== 0) {
          const l = crtFtol(local_20 * (100 - p) / 100 + 0.75);
          local_20 = l < 0 ? 0 : l;
        }
      };
      switch (k) {
        case 1: scale((t.prot[1]! << 16) >> 16); break;   // +0xc4 fogo
        case 2: scale((t.prot[2]! << 16) >> 16); break;   // +0xc6 água
        case 3: scale((t.prot[3]! << 16) >> 16); break;   // +0xc8 ar
        case 4: scale((t.prot[4]! << 16) >> 16); break;   // +0xca terra
        case 5: scale((t.prot[5]! << 16) >> 16); break;   // +0xcc astral
        default: break;                                     // stub: log ("Unknown magic damage type", 0x43a0a8)
      }
      if (0 < local_20) local_2c = (local_2c + local_20) | 0;
    }
    if (a !== null && !fn_0x542560(a)) {
      // param_2[5] (dono de `a`) ≠ 0 sempre no espelho
      t.f40 = a.addr >>> 0;
      const bVar4 = fn_0x53a5a0(a);
      t.f48 = bVar4 === 0 ? 0 : info.elK & 0xff;
      fn_0x56e6b8(wd, a, t, 0);   // `this`+0x14 (dono da vítima) ≠ 0 sempre no espelho
    }
    if (local_2c < 1) local_2c = 0;
  } else {
    local_2c = 0;
  }
  return local_2c;
}

// ------------------------------------------------------------------------------------------- o golpe (lote 2)

/** 0x542580 Weapon_CastsSpell (fastcall): o item tem magia (+0x84). */
export function weaponCastsSpell(it: ItemRec): boolean {
  return it.spell !== null;
}

/** 0x53bff0 (fastcall): classe do item = (+0x40 >> 8) & 0xf (0xe = consumível). */
export function fn_0x53bff0(it: ItemRec): number {
  return ((it.f40 & 0xffff) >> 8) & 0xf;
}

/** 0x542c90 AI_InBattle (fastcall; exec 0): bit 4 de +0x4c desligado. */
export function aiInBattle(u: UnitRec): boolean {
  return (1 - ((u.f4c & 4) !== 0 ? 1 : 0)) !== 0;
}

/** 0x50fc3e (fastcall): relógio de 16/s − +0x138 (tiques desde que a unidade ficou livre). */
export function fn_0x50fc3e(u: UnitRec): number {
  return (EXE_GLOBALS.clock16 - u.f138) | 0;
}

/** 0x5040c4 (thiscall; `this` = servidor): mensagem ao cliente (código p4 ou 'k', p2, p3, id da unidade: stub, 0x5039e2 envia e marca
 *  a tabela por jogador +0x114) e +0x138 = relógio de 16/s + p3 (a unidade fica ocupada p3 tiques). */
export function fn_0x5040c4(u: UnitRec, _p2: number, p3: number, _p4: number): void {
  fn_0x50fc3e(u);
  u.f138 = (EXE_GLOBALS.clock16 + (p3 & 0xff)) >>> 0;
  // stub: cliente (DAT_006c9618 → 0x5039e2)
}

/** 0x504155 (thiscall; servidor): mensagem 0x72 ao cliente (stub) e +0x138 = relógio + charge + relax. */
export function fn_0x504155(u: UnitRec): void {
  u.f138 = (EXE_GLOBALS.clock16 + (u.f134 & 0xff) + (u.f135 & 0xff)) >>> 0;
  // stub: cliente (DAT_00672f68: 0x72, id, id do alvo +0x5c → 0x5039e2)
}

/** 0x504ab8 (cdecl): começo do golpe para o cliente: alcance +0x12c < 2 → 'q' com (rumo + 8) >> 4 (0x5514ce) e charge + relax
 *  (0x5040c4); senão 0x504155. */
export function fn_0x504ab8(u: UnitRec): void {
  if ((u.attackRange & 0xff) < 2) {
    const cVar3 = 0x71;
    const bVar2 = ((u.f134 & 0xff) + (u.f135 & 0xff)) & 0xff;
    const iVar1 = fn_0x5514ce(u.walk.dir & 0xff);
    fn_0x5040c4(u, iVar1 & 0xff, bVar2, cVar3);
  } else {
    fn_0x504155(u);
  }
}

/** 0x558b3d (thiscall; `this` = andar): p4 (rumo desejado antes do despachante) ≠ +1 (agora) → *out = tiques de giro (+0xa4) e true. */
export function fn_0x558b3d(w: WalkRec, _u: UnitRec, out: { v: number }, _p3: number, p4: number): boolean {
  const bVar1 = ((p4 << 24) >> 24) !== ((w.dirTarget << 24) >> 24);
  if (bVar1) out.v = w.turnTicks & 0xff;
  return bVar1;
}

/** 0x50ff2d (thiscall): depois do despachante, ação 1: na mesma posição fina de antes (p1 x, p2 y) e rumo desejado mudado → giro:
 *  'm' ao cliente com (rumo desejado + 8) >> 4 e os tiques de giro (0x5040c4: +0x138); saiu do centro da célula (frações 0x80) →
 *  passo: direção × 2 e os tiques do passo. */
export function fn_0x50ff2d(u: UnitRec, p1: number, p2: number, p3: number, p4: number): void {
  const local_10 = { v: 0 };
  const uVar2 = mapObjFineX(u.mapObj);
  const local_8 = uVar2 & 0xffff;
  const uVar3 = mapObjFineY(u.mapObj) & 0xffff;
  if (local_8 === (p1 & 0xffff) && uVar3 === (p2 & 0xffff)) {
    const bVar1 = fn_0x558b3d(u.walk, u, local_10, ((uVar3 >> 8) << 8) | (p3 & 0xff), p4);
    if (bVar1) fn_0x5040c4(u, (((u.walk.dirTarget & 0xff) + 8) >> 4) & 0xff, local_10.v, 0x6d);
  } else if ((p1 & 0xff) === 0x80 && (p2 & 0xff) === 0x80) {
    fn_0x5040c4(u, ((u.walk.stepDir & 0xffff) << 1) & 0xff, u.walk.stepTicks & 0xff, 0);
  }
}

/** 0x510745 (fastcall): cancela a magia de item em curso (+0x68 em uso com +0x44 ≠ 2: 1º nó da lista +0x20 do item (0x53ddf0) com
 *  +0x3c == ')' e +0x40 == id da magia +0x64 → solta a magia, devolve o item à mochila +0x7c e zera +0x68). O ramo nunca roda no
 *  corpus (0x53ddf0 exec 0): NotPorted. */
export function fn_0x510745(u: UnitRec): void {
  if (u.f68 !== null && (u.f68.f44 & 0xff) !== 2) throw new NotPorted("0x53ddf0");
}

/** 0x516b2f Unit_StrikeExtra (cdecl): carga extra do golpe: com alvo, agressor vivo (+0x94 > 0; donos ≠ 0 sempre no espelho):
 *  d = 0x5169de (células); com Invisibility (bit 0xc) os efeitos 0xc da lista +0x20 ganham +0x42 = 1 (gancho `effectExpire`: a
 *  invisibilidade acaba); d > 1 → *out = (d × 256 + 128) / 200; e o cliente é avisado (0x504ab8: +0x138). */
export function unitStrikeExtra(a: UnitRec | null, t: UnitRec | null, out: { v: number }, h: CombatHooks): void {
  out.v = 0;
  if (t !== null && a !== null && 0 < ((a.f94 << 16) >> 16)) {
    const iVar1 = fn_0x5169de(a, t);
    const local_8 = (iVar1 << 16) >> 16;
    const uVar2 = fn_0x5106d2(a, 0xc);
    if (uVar2 !== 0) {
      if (!h.effectExpire) throw new NotPorted("0x53b120");
      h.effectExpire(a, 0xc);
    }
    if (1 < local_8) out.v = Math.trunc(((local_8 * 0x100 + 0x80) | 0) / 200);
    fn_0x504ab8(a);
  }
}

/** 0x516ea0 (cdecl; exec 0): golpe à distância (0x5201b2). */
export function fn_0x516ea0(_a: UnitRec, _t: UnitRec): never {
  throw new NotPorted("0x516ea0");
}

/**
 * 0x516ceb Unit_StrikeHit (cdecl): o golpe de `a` em `t`: alvo e agressor com dono, agressor vivo e distância 0x5169de ≤ alcance +0x12c
 * → dano pela vtable +0x54 do alvo (0x516f6f nas três) e vida −= dano (short); arma que lança magia, em batalha (0x542c90) com dano > 0
 * e alvo ainda vivo, ou magia de id 2 → +0x64/+0x68 = a magia/a arma, Spell_Release (gancho) e zera; 's' ao cliente (0x504b1d →
 * 0x503672: gancho `clientHit`; a tabela +0x114 por jogador é do cliente) se o alvo estava vivo ou tem vida > −10; experiência (vtable
 * +0x6c) com dano > 0, alvo vivo antes e > −10 depois.
 */
export function unitStrikeHit(wd: WorldRec, a: UnitRec | null, t: UnitRec | null, h: CombatHooks): void {
  if (t !== null && a !== null && 0 < ((a.f94 << 16) >> 16)) {
    const bVar1 = a.attackRange & 0xff;
    const iVar7 = fn_0x5169de(a, t);
    if (((iVar7 << 16) >> 16) <= ((bVar1 << 16) >> 16)) {
      const bVar5 = 0 < ((t.f94 << 16) >> 16);
      const HVar8 = unitPhysicalDamage(wd, t, a.dmg, a, h);
      const local_10 = (HVar8 << 16) >> 16;
      t.f94 = ((((t.f94 << 16) >> 16) - local_10) << 16) >> 16;
      if (a.f74 !== null && weaponCastsSpell(a.f74) && aiInBattle(a)
        && ((0 < HVar8 && 0 < ((t.f94 << 16) >> 16)) || (a.f74.spell!.id & 0xff) === 2)) {
        a.f64 = a.f74.spell!.addr >>> 0;
        a.f68 = a.f74;
        spellRelease(wd, a.f74.spell!, a, t, h);
        a.f64 = 0;
        a.f68 = null;
      }
      if (bVar5 || -10 < ((t.f94 << 16) >> 16)) h.clientHit?.(a, t, HVar8);   // 0x504b1d: stub de cliente com gancho (HUD)
      if (0 < HVar8 && bVar5 && -10 < ((t.f94 << 16) >> 16)) vt6c(a, t, HVar8, 0, h.xpOnHit);
    }
  }
}

/** 0x516c1f Unit_StrikeBegin (cdecl): alvo com slot +0x2c ≠ 0 → golpe de perto (0x516ceb); senão slot +0x34 ≠ 0 → à distância
 *  (0x516ea0); senão log "I don't know how to attack" (stub). */
export function unitStrikeBegin(wd: WorldRec, a: UnitRec, t: UnitRec | null, h: CombatHooks): void {
  if (t !== null) {
    const UVar1 = vt2c(t);
    if (UVar1 === 0) {
      const UVar1b = vt34(t);
      if (UVar1b === 0) { /* stub: log (0x43a0a8 "I don't know how to attack") */ }
      else fn_0x516ea0(a, t);
    } else {
      unitStrikeHit(wd, a, t, h);
    }
  }
}
