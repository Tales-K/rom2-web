/**
 * A magia escolhida na interface (CTRL+A; IA+0x78 do exe): marcar/desmarcar e o alcance para a apresentação. O que a unidade faz com ela
 * ao atacar é a porta de AI_CastChosenSpell 0x56b059 (sim/exe/think.ts; a World espelha a escolha em IA+0x78 pelo id do livro).
 */
import type { SpellDef } from "./spells";
import type { Unit } from "./world";

const BOLT = new Set([1, 5, 10, 11, 16, 26]);
const AREA = new Set([2, 3, 6, 7]);
const sid = (s: SpellDef) => Number(s.base ?? s.id);

/**
 * Marca/desmarca a magia de ataque da unidade [exe 0x4c74b1 → 0x41a727 → mensagem 0x46 sub 4, servidor 0x4f69a6]. Conferido no original rodando
 * (BUG-MAGO, 19/10): só o atalho CTRL+A com o ponteiro sobre a célula do livro marca (a letra "A" aparece no canto inferior esquerdo da célula);
 * CTRL+A de novo na mesma célula desmarca (+0x78 = 0); em outra célula troca. Lançar pelo livro (clique na magia + alvo) NÃO marca, nem o botão
 * de ataque nem fechar o livro limpam. As magias "Caster Only" (Shield, Summon) não entram: o ponteiro sobre elas não vira célula escolhida.
 * Devolve se a célula era marcável.
 */
export function toggleChosenSpell(u: Unit, id: string): boolean {
  const s = u.spells.find(x => x.id === id);
  if (!s || id.startsWith("scroll:")) return false;
  if (s.target === "self" || (!s.target && s.kind === "shield")) return false;
  u.selectedSpell = u.selectedSpell === id ? null : id;
  return true;
}

/** Magia escolhida utilizável (conhecida e com mana) [exe 0x56bb0d]. */
export function selectedSpell(u: Unit): SpellDef | undefined {
  if (!u.selectedSpell) return undefined;
  const s = u.spells.find(x => x.id === u.selectedSpell);
  return s && s.mana <= u.mana ? s : undefined;
}

/** Alcance de ataque com a magia escolhida (se houver mana) [exe 0x56ac5b]; 0 = usa a arma. */
export function selectedSpellRange(u: Unit): number {
  const s = selectedSpell(u);
  if (!s) return 0;
  const id = sid(s);
  return BOLT.has(id) || AREA.has(id) || id === 18 || id === 28 ? s.range : 0;
}
