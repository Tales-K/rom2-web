# Magias, efeitos e magos da IA (etapa 8b, 2026-10-28)

Briefing: `docs/briefings/ETAPA8B-MAGIAS.md`. Regras: skill `port-exe`. No corpus a magia só roda na m10_mage (a maga: autocast ×10,
AI_CastChosenSpell ×18, Heal ×3 e Shield ×2 pelo pensamento, o cajado ×4; 9 Spell_SpendMana/Release/Apply).

## Lotes 1–2 (no main: d206126, 0cc65ea)
`exe/think.ts` aiAutocast 0x56bc7b, aiCastChosenSpell 0x56b059 e folhas; `exe/spells.ts` spellSpendMana 0x519998, 0x519441, o pacote
0x5041d6/0x5042ba (+0x138), spellRelease 0x519d7f. Ganchos removidos: `castChosenSpell`, `autocast`, `spellSpendMana`, `spellRelease`.
Arnês: ponteiros de magia do registro importado pelo id (`World.exeImportSpellPtrs`), +0x5c importado.

## Lote 3 — a aplicação e os objetos de magia (47ca6e6; `test/exe_spells.ts`)
Spell_Apply 0x519db8 (poder = habilidade da esfera +0xa8+2×[2] + Mind − 30 em 0..255 ou o efeito 0x29 do item em uso; Spell_Instance
0x5195b1 com o x87; vtable+0x70 = gancho `xpOnCast`), Heal (0x510484; Unit_Revive = gancho `revive`), o dano preso ao alvo (0x51e505,
0x5178d4, projétil 0x518d1e). A lista do mundo [[0x6044c4]+0x7c]+4 = objetos de magia (`SpellObjRec`/`SpellPayloadRec`, `allocObj`),
0x52c279 a anda antes das unidades; 0x518efd, 0x542d00/0x517949 (aviso 0x56e6b8 no impacto), 0x51e65b. Definição = 22 colunas de data.bin
(`BookSpellRec.def`). Ganchos removidos: `spellLevel`, o adaptador do cajado. Achados: o cajado inicial tem poder 20 (0x514f59); Rand_One
no replay confere n. Arnês: `dump_ticks` despeja `spell_objs`. tickcmp 97,4 / 98,2 / 98,6 %; golden 76,5 % (era 71,65 %).

## Lote 4 — efeitos com duração e o recálculo do humano (de675a6; `test/exe_effects.ts`)
`exe/effects.ts`: 0x51e8fa (texto da definição+0x1c), 0x51caa0, 0x51ce12 (fusão; Bless×Curse), 0x51cc9f, 0x542540, 0x51d175/0x51d337,
0x51d436, 0x51366b `unitRecompute` (x87); Shield 0x1b. `UnitRec`: lista +0x20 `fx`, bônus +0xd4.., `skBase`. Laços de efeitos na máquina
e em Unit_Die. **No mundo**: vtable+0x58 = gancho `recompute` → `syncCombat` (o motor antigo ainda é dono dos atributos); `exeFxSum`
(tipo → `FX_KIND`), `exeFxBits`, `clientEffect`. Arnês: `dump_ticks`/`import_state` com `fx`. tickcmp 97,4 / 98,4 / 98,6 %.

## Lote 5 — os outros efeitos, o monstro e a SpellArea (exec 0: pares SINTÉTICOS, 100 %)
`tools/re/oracle/synth_spells.py` (novo): m10_mage até T=200, sonda do fnprobe ligada, Spell_Apply chamado direto no Unicorn (a 1.ª magia
do livro com +8/+4 trocados: definição do id = [0x68f5cc]+4 + id × 0x20; poder pela habilidade da esfera; cena de 25 lançamentos em
maga/herói 24608/monstros + 400 tiques; varredura do poder 0..255 por `case`, sem experiência) → `refs/oracle/pairs/synth_m10_mage`
(o test:sim lê toda pasta). Spell_Apply 1435/1435, 0x517c1a 294, 0x517cfe 468, 0x518681 525, 0x55a8f8 5647, 0x5183a2/0x518024/
0x518594/0x542d50 6, 0x5118be 13, 0x51ce12/0x51d175/0x51d337/0x51d436/0x51cc9f/0x51366b sintéticos todos iguais; replay isolado igual.
- `exe/effects.ts` `spellApplyEffect`: proteções (p/2), Poison (+0x40 × (p/45 + 1), ftol), Invisibility (Spell_WallObject, p × 16; 0 →
  destrói e sai), Light/Darkness (±(p/30 + 1)), Stone Curse (p × 240 × (sem item + 1)/100 e Rand_Inclusive contra a proteção de terra
  +0xca, 0 → sai), Bless/Curse (WallObject, 20 + 4p/5), Haste/Slow (±(p/15 + 1)); durações pow(1,025, p) × [0xe] × 16 (assembly).
  0x5118be (monstro: +0xa0); 0x51d175 com proteção de água (x87: ftol(n/100.0 + 0,5)). `UnitRec.fa5` virou o byte alto de +0xa4.
- `exe/spells.ts` SpellArea (vtable 0x5d10e0; ver o cabeçalho): construtor e ramo de área de Spell_Apply, 0x517cfe, marcar/desmarcar na
  vaga da área do registro de ocupação (0x518ba3, 0x55a37a/0x55a533), Light × Darkness e fogo × veneno (0x5189b5), 0x518681, 0x5045a5
  (as consultas mexem no occCur: são do servidor; o pacote é o gancho `clientArea`). NotPorted (áreas de dano, exec 0): 0x51806c,
  0x518833, 0x5182b6, a Fireball de 0x518681 (0x51e5db); 0x559c28 `review` (sem par).
- `exe/combat.ts`: 0x5106f4 anda na lista +0x20 (gancho `effectPower` REMOVIDO); o laço 0xc de 0x516b2f/0x519998 marca +0x42 = 1 na
  lista (`effectExpire` fica só para a invisibilidade dos `buffs` do script). Arnês: `allocsOf` alterna vivo/morto (o `new` reaproveita
  o bloco destruído), +6..+7 do objeto de mapa é preenchimento, `WorldRec.spellDefCol`.
**No mundo** (`spellApplyPorted`: todo `case` de carga "Effect" vai à porta): `exeFxSum` com Light/Darkness pelo id (Light ofusca o
monstro, Darkness o humano), `exeFxHas`/`invisible`/`exeFxExpire`, `canSee` com a invisibilidade da lista, apresentação das áreas por
`hookArea` (`world.areas` com `exe`: células marcadas; `setAreaDuration` mexe em +0x50), `setBuffDuration` em +0x42, "Spell on Unit" do
script lê a lista (mission/host.ts). A Stone Curse do exe NÃO para a unidade em `stunned`/`speedOf` (a máquina segue e o efeito acaba nela).
Testes ajustados à semântica do exe: ai.ts (Stone/Curse/Poison/Invisibility pela lista; Light ofusca; o troll com habilidade de terra:
poder 0 = Stone Curse sem efeito), pilot.ts `unstone`. Os `buffs` ficam para script, armadilhas e o que não é carga "Effect".
Números: tickcmp 97,4 / 98,4 / 98,6 % (igual); golden 76,5 % (0 piores, assinaturas iguais; referência não regravada). test:sim verde.

## Próximo
Resíduo nomeado do tickcmp (abaixo), 9b (carregador). Depois: áreas de dano (0x51806c/0x518833/0x5182b6, Fireball 0x51e5db), Wall of
Earth (0x11), Teleport/Summon/Animate/Drain Life (`spellApply` ainda motor antigo); o mundo largar `syncCombat` pelo recálculo portado
(despejar os atributos-base +0x84..+0x130 em dump_ticks/import_state).

## Resíduo (tickcmp, 1.ª divergência; medido no lote 4, igual no lote 5 salvo `range|1`, que saiu)
m10_start: `task|24595` T=609 + `g_assigned`/`target` (pensamento do grupo 0x57240b), `post|1` T=49, `walk_*` T=625. m10_mage: `post|1`
T=113 ×6 (posto IA+0 do herói), `target|1` T=463 ×6, `range|1` ×5 (+0x12c do herói alterna 6/1 em T=4/232/241/749/755; nenhuma função
sondada o escreve — escrita fora do servidor portado, a achar), `task|1` ×5 (ordem de magia do cliente 0x56d3e6: +0x50 = 0xd; o
original já está em 0xc no tique seguinte), `act`/`walk_*|1` T=822. m20_start: `post|1` T=19, `task|24603` T=623, `target|1` T=455.
Golden (lote 3): m10_mage_s114@800 `hp|t75` T=876 (o impacto do cajado chega antes no nosso); lote 4 não mudou assinatura.
