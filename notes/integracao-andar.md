# Integração do andar portado na World (etapa 6, 2026-10-27)

Briefing: `docs/briefings/ETAPA6-INTEGRACAO-ANDAR.md`. Código: `game/src/sim/world.ts` (cabeçalho), `sim/exe/action.ts`, `sim/exe/mapbuild.ts`, `sim/exe/recio.ts`.

## Desenho
- **Fonte de verdade = registro do exe.** `Unit.rec: UnitRec` (objeto de mapa, andar +0x1c0, IA +0x1c4, listas +0x1c8/+0x1e4); `x`, `y`, `cx`, `cy`, `dir`, `angle`, `unreachSec` são **getters/setters** sobre ele (sem cópia; escrever `dir`/`angle` fixa também andar+1). `World.exe: MapRec` (grades, ocupação CMap, estruturas) e `exeWorld: WorldRec`. Única sincronização: `World.dispatch` (velocidade com Haste/Slow, vida, dono, classe +0x50 entram no registro; `grid.occ` = célula do chão sai dele).
- **Entrada:** `act(u)` → com IA+9 == 3 o despachante portado `0x56dca2` só continua o passo (antes de qualquer ordem). Ordem → tarefa do exe: andar → IA+8 = 1, IA+0xa = célula; andar com `near` > 0 (seguir, defender, magia no chão, usar) → 9 (IA+0x3c, alcance IA+0x14); atacar → 5 (alvo IA+0xc), magia em unidade → 8 (IA+0x28). Tarefas 5/8/9 entram por gancho (`DispatchHooks.task`: só o ramo de perseguir/andar, 0x56ea52 / 0x56e4ac; o ramo do golpe segue no motor antigo).
- **Regras medidas no oráculo (camada de tarefas, adaptadores):** o pensamento (tique ≡ 7) larga a ordem de andar quando a CÉLULA é a do destino (a meio passo só zera IA+8; a classe vira parada no pensamento seguinte); a patrulha troca de ponto no pensamento com a célula no ponto e, depois do fim de caminho bloqueado (cauda de 0x56dca2), só volta a andar no pensamento; ordem nova do cliente zera andar+0x7c e IA+8 (ataque: IA+0xc novo). Fim de caminho: 0x56dc24 = nada; patrulha = próximo ponto da nossa ordem; 0x56ed4e = inimigo ao alcance → ataca, senão nada. NotPorted no jogo: a unidade para (aviso único no console).
- **Mapa (`mapbuild.ts`, não é porta):** da `Grid`; conferido com a imagem do tique 0 das missões 10 e 20: passo e altura 100 %, máscara 100 %, registros das estruturas (r[0], r[1], +0xc) 100 % (78 e 427). Lado e tipo de movimento da unidade = `tokenSize`/`movementType` do modelo.

## Apagado
`walkTo`/`chaseUnit` viraram adaptadores (mesma assinatura); `exeStep`, `exeRoute`, `segmentSpeed`, `moveStep`, `turning` antigo, `turnTicks`, `Unit.path/sPath/sGoal/sFinal/sCount/sTrack/sLen/sTcell/pathGoal/segV/repathIn/turnLeft/turnDir`, `sim/path.ts` (A*; `lineOfSight` foi para `sim/los.ts`). Teste `[est]` do giro em `wimpy_mage.ts` saiu (o 0x556454 tem prova por pares).

## Despejo (`tools/re/oracle/dump_ticks.py`, 3 episódios regravados; `--check` idêntico ao golden)
Por unidade `exe`: endereço, vtable, +0x43/+0x49/+0x4a/+0x50/+0x54/+0x8c/+0x94/+0x9a/+0x12c, tipo +0x20/+0x44/+0x45, dono +0x2c, bytes crus do andar e da IA (0xb4). Por tique `exe`: trechos alterados do MapRec, baldes do CMap de ocupação que mudaram, estruturas novas, mundo +0xbbe8. `import_state.ExeReplay` remonta o MapRec do tique; `applyState` monta o UnitRec exato (ou, sem despejo — janelas do golden —, derivado: listas, contadores, passo a meio refeito pela fórmula, pegada nas duas células).

## Prova e números
- Pares: 0x56dca2 14 078/14 078 nos ramos portados (+17 832 em ramos NotPorted, fora), 0x56ea52 628/628 (`exe_walkaction.ts`).
- tickcmp, campos do andar (`fx,fy,x,y,act,walk_*`), tiques idênticos: m10_start 19,4 → 80,1 %; m10_mage 27,6 → 82,4 %; m20 4,8 → 75,9 %. Estado inteiro: 10,2/8,2/2,8 → 38,5/32,6/32,3 %. Posição e caminho: 100 % na m10_start; 1 tique em cada outro episódio.
- golden `--ci`: limpas 34,04 → 54,62 %, janelas melhores 313, piores 3; `pos|t103` 84 → 11, `pos|t1` 75 → 28, `pos|t74` 74 → 10. **CI falha**: `alive|t69|orig_dead` reapareceu (×2, m20_mage: Spirit morre no original, vida diferente no nosso — combate).

## Resíduo por campo (tickcmp)
- `fx`, `walk_static/dynamic/c9` m10_mage T=822: o motor antigo dá o herói ao alcance e golpeia; o exe segue perseguindo (0x56eab5 / 0x55532d, golpe = etapa 7).
- `walk_track` m10_mage T=463, m20 T=455: ordem de ataque repetida (mesmo alvo) — o cliente zera IA+8/andar+0x7c no exe; o nosso mantém a ordem (tratador de mensagem não portado).
- `walk_static/dynamic/goal/final` m20 T=639: o pensamento da guarda (0x5728fa, IA) troca o destino de 24603.
- `act` (~750 pares): olhar em volta e grupo dormindo (0x56e5bc, 0x56dca2 tipo+0x45), golpe/magia (IA+9 = 1/2, 0x56eff3), giro antes do golpe na tarefa 5 (0x56eab5) e ordem de ataque armada no pensamento — nenhum de unidade andando.
- Importação derivada (golden): sem o passo 6 já reaplicado nas células de estrutura, sem a pegada de quem só gira; patrulha com pontos A = posto (o exe usa a lista IA+0xb4 do script).
