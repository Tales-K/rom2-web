# Briefing — Etapa 5: andar, perseguir e o passo de andar por tique

Para: sessões frescas lendo a skill `port-exe` (`.claude/skills/port-exe/SKILL.md`). Lotes 5a e 5b servem para Sonnet; 5c pede
modelo forte (x87 e o caso de andar dentro da máquina de ação). Motivo e método: `docs/ABORDAGEM-FIDELIDADE-UNIDADES.md`
(seções 4.3, 5 e 7.1). **Esta etapa só porta e prova; não integra nada em `world.ts`/`ai.ts`** (a integração é a etapa 6).

## Por que esta etapa
O comparador de tique inteiro (`npm run tickcmp -- --all`, `notes/tick-compare.md`) mostra que a 1ª divergência do nosso motor é
a posição fina (`fx`/`fy`, 1/256 de célula) no 5º tique de andar do herói, depois `act` (a ordem de andar leva 1 tique a mais para
virar ação 1) e o caminho dinâmico. Tudo isso é o subsistema de andar. O piloto (etapa 4, `game/src/sim/exe/path.ts`) já portou a
célula de aproximação e o anel; esta etapa porta o resto do andar.

## O que já se sabe (medido; não redescubra)
- **Perfil de execução** `tools/re/exec_profile.tsv` (3 episódios × 960 tiques no oráculo): coluna `exec` no `show` e no `next`;
  `next --root <addr> --executed` lista só o que roda no corpus. Função com `exec=0` fica para a etapa 10, não para esta.
- **`0x554bf8` "Unit_WalkTick" nunca executa** e não tem chamador: nome errado vindo de nota. Não é raiz de nada.
- Raízes do andar (todas executam): `0x555411 Unit_ActionWalk` (10 chamadas em 160 tiques = uma por célula), `0x55574d Unit_ActionChase`,
  `0x5551ef Unit_WalkWait` (142 em 160 tiques: perto de uma por tique andado), `0x55532d` (4), `0x559195 Unit_WalkFormula` + `0x55915a` (7),
  `0x5551d6` (6), `0x56e4ac Unit_WalkNear` (10). O avanço da posição fina **por tique** não é nenhuma dessas chamadas por célula:
  está em `Unit_WalkWait`, em `0x50f12c Unit_ActionMachine` (caso da ação 1) ou numa chamada delas. Descubra com a sonda, não por
  leitura: `fnprobe.py m10_start_s1 0x5551ef 0x50f12c --verify 5` e procure em `writes` os endereços cujo `objs` é `sub "+0x10"`,
  `off 4`/`5` (fração x/y do objeto de mapa).
- O inventário de campos (`tools/re/fields_by_type.tsv`) não vê escritas feitas por ponteiro local; o sub-objeto de andar é
  `unidade+0x1c0 -> ...` (`0x1c0->0x0..0x86` já listados lá, com quem lê/escreve).
- Objetos de mapa fora de unidade (sem `objs`) são remontados pelas leituras relativas a `this`: veja `Recon` em
  `game/src/sim/test/exe_path.ts` e reutilize-o (mova para `game/src/sim/test/exe_recon.ts` se for compartilhar).

## Lotes
Antes de cada lote: `python tools/re/port_status.py next --root <raiz> --executed --n 40` dá a ordem (folhas primeiro). Grave os
pares de todo o lote de uma vez: `PYTHONUTF8=1 .venv/Scripts/python.exe -X utf8 tools/re/oracle/fnprobe.py <ep> <addr...> --verify 20`
para os 3 episódios (`m10_start_s1 m10_mage_s102 m20_start_s203`). Funções com muitas chamadas (acessores com `exec` > 50 000):
limite a sonda (`--max` se existir; senão sonde num episódio só) — 100 % de alguns milhares de amostras basta.

**5a — folhas do andar (Sonnet, 1 sessão).** Acessores e funções ≤ 120 bytes com `exec > 0` no fecho de `0x555411` ∪ `0x55574d`
que **não** sejam biblioteca nem cliente (abaixo). Esperado: ~40 funções (0x54f*, 0x55f*, 0x551*, 0x542*, 0x558f*, 0x55c550...).
Campos novos vão para `types.ts` (`UnitRec`, `MapObjRec`, `PathRec`, um `WalkRec` para `+0x1c0`), com offset e tamanho.
- Biblioteca (MFC `CList`/`CArray`/`CMap` em 0x53a000–0x544fff e 0x401000–0x44ffff; CRT 0x582000+): **não portar uma a uma**.
  Uma implementação espelhada por classe em `game/src/sim/exe/mfc.ts` (mesma ordem de iteração, mesmos valores de retorno) e cada
  método `out` com nota `MFC: exe/mfc.ts:CList.addTail`. Acessores triviais do jogo nessa faixa (ex.: `0x540360` = `this+0x18b0`,
  `0x542360` = lado da unidade, `0x55f9f0` = índice de célula) são jogo, não biblioteca: portam-se.
- Cliente/rede (0x500000–0x505fff: pacotes, `0x50164f Server_SendStats`, `0x504bb7` envio ao cliente, `0x5052d2 Server_SendMsg92`,
  `0x503672`): `out` com nota; no TS, chamada vira comentário `// stub: cliente (...)`.

**5b — ondas e caminho (modelo forte ou Sonnet com 2 tentativas, 1–2 sessões).** `0x54d76e Path_WaveSearch` (3,2 KB),
`0x55d*`/`0x55e*` `Path_WaveStatic/DynamicAtoB/BtoA` (4 × ~2 KB; confira no assembly se são cópias — em `0x5585f4` os dois ramos eram
idênticos), `0x54e886 Path_BacktraceDynamic` e `Path_BacktraceStatic`, `0x555dc2 Path_RefreshDynamic`, `0x555b38 Path_ClearDynamic`,
`0x55c440 Path_TargetFree`, `0x55c6f0`, `0x55c5a0 Unit_FootprintCheck`. Grades de onda entram em `PathRec` (offsets `+0x30000` etc.;
`PATH_COST_OFF` já existe). Prova: pares (a sequência de células lidas e escritas, como em `exe_path.ts`) e, para a onda, um caso
de Unicorn por forma de mapa (`tools/re/oracle/fuzz_approach.py` é o modelo).

**5c — o andar em si (modelo forte, 1–2 sessões).** `Unit_ActionWalk`, `Unit_ActionChase`, `Unit_WalkWait`, `0x55532d`,
`Unit_WalkFormula`/`0x55915a`/`0x5551d6`, `Unit_WalkNear`, `0x55020a Unit_PlaceOnCells`, `0x550697`, `0x551383 Unit_SubCellCenter`,
`0x556* Unit_TurnStep`/`Dir_FromDelta16` e **o trecho que avança a posição fina por tique** (achado pela sonda; se for um `case` de
`Unit_ActionMachine`, porte só esse `case` como função própria `actionMachineWalkCase(/* 0x50f12c caso 1 */)` e anote em `port_status`
com `review` + nota "parcial: caso 1"; a máquina inteira é a etapa 7). x87: `Unit_WalkFormula` quase certamente usa FPU
("fórmula do andar"): desmonte e teste contra o Unicorn em toda a faixa de velocidade/ângulo, como em `unitApproachCell`.

## Pronto quando
- Todas as funções com `exec > 0` no fecho de `0x555411` ∪ `0x55574d` ∪ `0x5551ef` ∪ `0x55532d` estão `ported`, `out` (biblioteca/
  cliente, com nota) ou `review` (com a amostra que diverge). `port_status.py report` sobe em "executadas no corpus".
- `npm run typecheck && npm run test:sim` verdes com `exe_walk.ts` (e `exe_path.ts`) a 100 % dos pares; `npm run golden -- --ci` ok
  (nada muda no motor, então deve ficar igual); `npm run tickcmp -- --all` igual ao de `notes/tick-compare.md` (sem integração ainda).
- Relatório ≤ 10 linhas por sessão; em 5c, diga **onde** fica o avanço por tique e quais campos de `WalkRec`/`UnitRec` ele lê e
  escreve: é a entrada da etapa 6 (integração).

## Restrições
Só o Unicorn (nunca o jogo real); C lido pelo `show`; nada de C no repositório; `refs/` fica fora do git (os pares e o fuzz
são regeneráveis pelos comandos acima); Python `.venv/Scripts/python.exe`. Não edite `world.ts`/`ai.ts`/`import_state.ts`.
