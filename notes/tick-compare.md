# Comparador de tique inteiro (etapa 3, 2026-10-27)

`tools/refcap/diff/tick_compare.mts`. Para cada tique T do oráculo (`refs/oracle/ticks/<ep>.jsonl.gz`, o estado completo do servidor a cada
tique): `resetWorld` → `spawnUnmatched` → `applyState(T)` → ordens do roteiro com `t` = T → `World.step` (1 tique) → compara com o estado T+1,
campo a campo, por id de unidade e de grupo. Reancora todo tique, sem cascata. Roteiro: `refs/golden/episodes/<ep>/ep.json` (a ordem em `t`
aparece no estado `t+1`: medido, o herói da m10_start com `move` em t=4 mostra tarefa 1 só no estado 5).

## Como rodar (pasta `game`)
```
npm run tickcmp -- --episode m10_start_s1      # ou --all (os 3, ~10 s)
npm run tickcmp -- --all --fields hp,act,fx    # só esses campos
npm run tickcmp -- --episode m10_start_s1 --show 120   # original × nosso nos campos divergentes do tique 120
```
Extras: `--replay` (sorteios gravados do original, `rand.json.gz`), `--max N`, `--no-resync` (pula a corrida sem reimportar), `--quiet`.
Relatório por episódio: % de tiques idênticos (e idênticos exceto `dir16`); por campo, % idêntico e 1º tique divergente; 20 pares
`campo|unidade` com exemplo (T, original, nosso); pares fora da comparação; corrida de T=0 sem reimportar (1º tique divergente, mediana por
unidade, 1º tique por campo); lista `NÃO MODELADO`. Posições `fx/fy` em 1/256 de célula.

## Números (commit desta nota; motor sem alteração)
| Episódio | tiques 100% idênticos | idêntico sem `dir16` | sem reimportar: 1º divergente | mediana do 1º divergente por unidade |
|---|---|---|---|---|
| m10_start_s1 | 10,2 % | 16,8 % | T=0 (`dir16` 24583) | 46 (26 de 30 unidades divergem) |
| m10_mage_s102 | 8,2 % | 20,7 % | T=1 (`rng`) | 45 (28 de 30) |
| m20_start_s203 | 2,8 % | 4,3 % | T=0 (`fx` 24620, 1/256) | 74 (33 de 42) |

Campos que mais divergem (soma dos 3 episódios, em tiques): `fx`/`fy` (a posição fina: o herói já erra 1/256 no 5º tique de andar; unidades
que andam na patrulha/volta ao posto erram 10–20/256), `dir16` (o olhar em volta gira para o lado/ângulo que a IA sorteou diferente — o motor
não tem o `want` do exe), `act` (a ordem de andar leva 1 tique a mais para virar ação 1; unidades de grupo que voltam ao posto ficam em 0),
`walk_dynamic`/`walk_static` (o caminho dinâmico é refeito/vazio), `rng` (número de `rand()` por tique igual em 82–87 %).
Depois: `x/y` (célula reservada à frente), `task`, `walk_c9/goal/final`, `hp`/`mana` (poucos tiques), `target`.

## Números depois da etapa 6 (andar portado integrado, `notes/integracao-andar.md`)
| Episódio | estado inteiro idêntico (antes → depois) | campos do andar `fx,fy,x,y,act,walk_*` (antes → depois) |
|---|---|---|
| m10_start_s1 | 10,2 % → 38,5 % | 19,4 % → 80,1 % (posição e caminho 100 %) |
| m10_mage_s102 | 8,2 % → 32,6 % | 27,6 % → 82,4 % (posição/caminho: 2 tiques) |
| m20_start_s203 | 2,8 % → 32,3 % | 4,8 % → 75,9 % (posição/caminho: 2 tiques) |

O resíduo do andar é `act` de unidades que não andam (olhar em volta, golpe, magia). O despejo agora traz o registro do exe (`exe` por
unidade e por tique); a importação usa o MapRec do original (`ExeReplay`). Opções novas: `--dump <arq>` (todas as divergências da corrida
reancorada em JSONL), `--no-exe` (importação derivada, como no golden), `--free-from T` (corrida sem reimportar a partir de T).

## Campos não modelados (listados e impressos no fim do relatório; não contam)
`mode`, `want`, `sub9`, `act_phase`, `act_cnt`, `act_ready`, `chosen_spell`, `ai_spells`, `ai_probs`, `retreat`, `guard_radius`,
`group_post`, `cur_speed`, `walk.c78`, atributos (`body`, `reaction`, `mind`, `spirit`, `skills`, `load`, `capacity`, `wtype`, `pmask`,
`noloot`, `scan256`, `exp`, `prot`, `resist`, `see_invis`), `angle` fino (comparamos `dir16 = angle>>4`), `tick` (contador de 1/s do original
vira 2 tiques depois do relógio de regeneração que a importação ancora), grupos: `center`, `count`, pertinência. Comparados e modelados: `alive`,
`type`, `player`, `x/y`, `fx/fy`, `hp/hpmax`, `mana/manamax`, `act` (estado do exe: 0 parado, 1 andando/girando, 3 golpe, 13 magia, 16 morto, 27 grupo
dormindo), `task` (classe), `target`, `dir16`, estatísticas (`speed_eff, scan, toHit, dmin, dmax, defense, absorb, range, turn, withdraw, wimpy, charge,
relax, eldmg, hpregen, manaregen`), `effects` (só os bits de `EFFECT_SPELL`), `summoner`, `post`, `unreach`, `flee_cell`, `hit_clock16`, `look_hit`,
`walk_*` (estático, dinâmico, goal, final, c9, track, slen, tcell), `rng`, `t16`, diplomacia (16×16), grupos (`radius, base, combat, cmd12, assigned`).

## Regras de contagem e limitações
- Par `campo|unidade` que difere logo depois de `applyState` **e** que o passo não mexeu fica fora do tique (tabela "fora da comparação"): `type`
  do herói (nosso `typeId` 0), `manaregen` (template), `walk_dynamic`/`x`/`y` de quem já anda (o importador não reproduz o caminho dinâmico nem a
  célula reservada), `act`/`task` de alguns estados. Se o passo mexe no valor, ele é comparado normalmente.
- `applyState` sorteia `rand()` (por `command`/`importStrike`) em 8–67 % dos tiques: a tickcmp restaura `rng` do estado T depois da importação.
  (`import_state` não restaura: as janelas do golden herdam esse desvio.)
- O estado do roteiro (`runtime`) é o do tique 0: gatilhos por tempo (`runtime.update(1/16)` por tique) não disparam no modo reancorado; reforços
  e invocações do original entram só via `spawnUnmatched` (do template mais próximo, não do roteiro). Na corrida sem reimportar o roteiro roda inteiro.
- Grupos: casados pelo id do grupo do mapa do 1º membro casado; `radius<=0` não é importado.
- `look_wait` (giro do olhar em volta) é deduzido do traço de todo tique (tiques até a ação voltar a 0, menos 1).
- Alterações em arquivos compartilhados (sem mudar a lógica do motor): `import_state.ts` ganhou `opts.diplomacy` (copia a matriz do estado; só a
  tickcmp liga); `diff_window.ts` agora exporta `orderOf`.
