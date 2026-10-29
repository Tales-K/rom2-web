# Magias, efeitos e magos da IA (etapa 8b, 2026-10-28)

Briefing: `docs/briefings/ETAPA8B-MAGIAS.md`. Regras: skill `port-exe`. No corpus a magia só roda na m10_mage (a maga: autocast ×10,
AI_CastChosenSpell ×18, Heal ×3 e Shield ×2 pelo pensamento, o cajado ×4; 9 Spell_SpendMana/Release/Apply).

## Lotes 1–2 (no main: d206126, 0cc65ea)
`exe/think.ts` aiAutocast 0x56bc7b, aiCastChosenSpell 0x56b059 e folhas; `exe/spells.ts` spellSpendMana 0x519998, 0x519441, o pacote
0x5041d6/0x5042ba (+0x138), spellRelease 0x519d7f. Ganchos removidos: `castChosenSpell`, `autocast`, `spellSpendMana`, `spellRelease`.
Arnês: ponteiros de magia do registro importado pelo id (`World.exeImportSpellPtrs`), +0x5c importado.

## Lote 3 — a aplicação e os objetos de magia (porta 100 % dos pares, `test/exe_spells.ts` no test:sim)
`exe/spells.ts`: Spell_Apply 0x519db8 (7/7; cabeça: poder = habilidade da esfera unidade+0xa8+2×[2] + Mind − 30 em 0..255, ou o efeito
0x29 do item em uso 0x5238c5; Spell_Instance 0x5195b1 17/17 com o x87 do assembly; vtable+0x70 = gancho `xpOnCast`; ponto alvo; alvo
imune), Heal (Unit_AddHeal 0x510484 3/3; Unit_Revive = gancho `revive`, exec 0) e o objeto de dano preso ao alvo (0x51e505 + 0x543040..
0x543100, Spell_AttachToTarget 0x5178d4, projétil 0x518d1e, Spell_ProjectileDist 0x516aae). Os outros `case` (carga "Effect" com
duração — Shield & cia. —, paredes, áreas, Animate Dead, Teleport, Summon, Drain Life) vão INTEIROS ao gancho `spellApply` (motor
antigo) antes de qualquer efeito (`spellApplyPorted`). A lista do mundo [[0x6044c4]+0x7c]+4 é a dos objetos de magia (os pares de
0x52c279 a mostram vazia com as 16 estruturas do mapa: `lists.structs` virou `lists.spellObjs`, registros `SpellObjRec`/
`SpellPayloadRec`, alocador `WorldRec.allocObj`); 0x52c279 (958/958) a anda antes das unidades (Server_WorldTick 0x4f04cf), 0x518efd
(18/18), 0x542d00/0x517949 (4/4; o aviso 0x56e6b8 sai no IMPACTO), 0x51e65b (4/4: vtable+0x54 = 0x516f6f). Definição da magia = as 22
colunas de data.bin (`BookSpellRec.def`, `spellDefColumns`); spellLevel lê [0] (gancho removido). Save: objetos de magia, instância do
livro (`bi`) e o cajado em uso (+0x68 = +0x74, `i68`).
**Ganchos removidos**: `spellLevel`; o adaptador do cajado em `hookStrikeBorn` (a arma +0x74 agora tem a magia +0x84 e o efeito 0x29: a
máquina 0x50f12c troca o golpe pela magia como o exe). **Novos** (apresentação): `clientHeal`, `clientSpellHit`, `clientMissile`.
**Apagado**: nada do motor antigo de magia — `releaseSpell` ainda atende os `case` não portados, o script (`castFromPoint`) e as armadilhas.
**Achados**: o cajado inicial tem poder 20 (Hero_InitSkills 0x514f59 monta "Wood Staff {castSpell=<magia>:20}"; nossos dados diziam 1 —
`mission/setup.ts`); Rand_One 0x51fa4e no replay confere o argumento n (não n − 1); a ordem de magia escrita da tarefa 8/9 do exe não
muda a classe +0x50 (`exe: true`, também no rótulo do tickcmp).
Arnês: `dump_ticks.py` despeja os objetos de magia (`spell_objs`), `import_state` os remonta (o preso com carga "Effect" fica de fora: o
motor antigo aplica o Shield no lançamento); ação 0xd/0xe sem +0x64 (janelas sem o despejo do exe) → a magia do motor antigo ou uma
sem definição.
Números: tickcmp 97,4 / **98,2** / 98,6 % (m10_mage era 97,5; sorteios 100 %; `hp`, `alive`, `effects`, `mana` 100 %). Golden **76,5 %**
(1182/1545; era 71,65 % 1135/1584; o total cai porque janela limpa não gera reancoragem).

## Lote 4 — efeitos com duração e o recálculo do humano (100 % dos pares, `test/exe_effects.ts` no test:sim)
`exe/effects.ts`: 0x51e8fa (texto da definição+0x1c, `BookSpellRec.effText` = coluna `effects` de spells.json: "absorbtion=+5:duration 30";
CString do MFC reimplementado; 0x5a1bdb = operator+= ','), 0x51caa0, 0x51ce12 (fusão: tira −1, maior valor/duração, põe +1; Bless×Curse),
0x51cc9f (1920/1920), 0x542540, 0x51d175/0x51d337, 0x51d436 (todos os tipos; teachSpell NotPorted), 0x51366b `unitRecompute` (4/4, x87
do assembly: nível = log(exp/5000 + 1)/log 1,1, 1,1^Body/100 + 1, tetos por classe/sexo, bônus +0xd4.. por 0x5113e7/0x515617/0x515a6c,
as magias do livro refeitas por Spell_CasterPower 0x519483). Spell_Apply `case` 0x1b (Shield) portado (9/9). `UnitRec`: lista +0x20 `fx`,
Body/Spirit/carga/+0xa0/+0xa4, bônus `fd4..fe4`/`bdmg`/`bdef`, `skBase`, `f130`, `f7c`; dono +0xa5c. Laços: Unit_ActionMachine e Unit_Die
andam a lista portada (`unitEffectsTick`/`unitEffectsOnDie`); os `buffs` do motor antigo seguem para as magias não portadas.
**No mundo**: vtable+0x58 = gancho `recompute` → `syncCombat` (o motor antigo ainda é dono dos atributos a cada tique); `buffSum` soma os
efeitos da lista (`exeFxSum`, tipo → `FX_KIND`) e os bits +0x144 vêm dela (`exeFxBits`); apresentação pelo gancho `clientEffect`. Save:
`UnitRecJson.fx`/`bx`. **Arnês**: `dump_ticks` despeja a lista +0x20 (`fx`), `import_state` a remonta (o Shield não vira `buff`; absorção
importada sem ele), o preso com carga "Effect" entra na lista do mundo; o tickcmp exporta efeitos/absorção com a lista (antes `absorb` e
`effects` ficavam "fora da comparação" no Shield do T=0). `allocsOf` ignora o CList embutido destruído.
Números: tickcmp 97,4 / **98,4** / 98,6 % (m10_mage era 98,2; `effects`, `absorb` 100 %). Golden 76,5 % (1182/1545), 0 piores, igual.

## Próximo: lote 5
Os outros `case` de efeito de Spell_Apply (proteções 4/8/0xd/0x13, Bless/Curse 0x14/0x1c, Haste/Slow 0x15/0x1d, Invisibility 0xc, Stone
Curse 0x12, Light/Darkness 0xe/0xf, Poison 6: mesmo molde do 0x1b, exec 0 → sem pares) e o recálculo do monstro 0x5118be; depois tirar
`effectPower`/`effectExpire`/`buffs`. SpellArea 0x517c1a/0x517cfe. Recálculo no mundo exige despejar os atributos-base (+0x84..+0x130).

## Resíduo (tickcmp, 1.ª divergência; medido no lote 4)
m10_start: `task|24595` T=609 + `g_assigned`/`target` (pensamento do grupo 0x57240b), `post|1` T=49, `walk_*` T=625. m10_mage: `post|1`
T=113 ×6 (posto IA+0 do herói), `target|1` T=463 ×6, `range|1` ×5 (+0x12c do herói alterna 6/1 em T=4/232/241/749/755; nenhuma função
sondada o escreve — escrita fora do servidor portado, a achar), `task|1` ×5 (ordem de magia do cliente 0x56d3e6: +0x50 = 0xd; o
original já está em 0xc no tique seguinte), `act`/`walk_*|1` T=822. m20_start: `post|1` T=19, `task|24603` T=623, `target|1` T=455.
Golden (lote 3): m10_mage_s114@800 `hp|t75` T=876 (o impacto do cajado chega antes no nosso); lote 4 não mudou assinatura.
