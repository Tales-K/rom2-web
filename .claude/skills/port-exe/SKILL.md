---
name: port-exe
description: Regras para portar funções do servidor do allods2.exe (C decompilado pelo Ghidra) para TypeScript em game/src/sim, com prova pelo oráculo. Use em qualquer sessão que porte, revise ou marque funções em tools/re/port_status.tsv.
---

# Porta literal do servidor do allods2.exe → TypeScript

Contexto e motivo: `docs/ABORDAGEM-FIDELIDADE-UNIDADES.md` (seções 4.3 e 5). Critério: estado do servidor **idêntico por tique,
tolerância 0**. Fidelidade é por construção: uma função do exe = uma função TS, provada contra pares (entrada, saída) gravados do
original. Nunca inferir comportamento por observação; traduzir o código.

## Onde está cada coisa
- C decompilado: `C:\Users\TALES K\Games\allods2-decomp\` (`index.tsv` endereço→nome→arquivo→linha; `callgraph.tsv`; `game\g_<faixa>.c`).
  Fora do repositório e do OneDrive; **nunca copiar o C para o repositório**, nem colar trechos longos no chat: leia do arquivo.
- Lista de trabalho: `tools/re/port_status.tsv` (gerada e mantida por `tools/re/port_status.py`; ver "Fluxo").
- Nomes conhecidos: `tools/re/known_functions.json` (VA, nome, frase). Função que você decifrar e nomear: acrescente lá.
- Emulador: `tools/re/unicorn_call.py` (`A2Emu`: chama uma função do exe por endereço com memória preparada).
- Oráculo (`tools/re/oracle/README.md`): `fnprobe.py <ep> <addr...> --verify 20` grava os pares por função em
  `refs/oracle/pairs/<ep>/<addr>.jsonl` (`this`, args, `eax`, rng, `reads`/`writes`, `objs` endereço → unidade/sub-objeto/offset);
  `exec_profile.py` → `tools/re/exec_profile.tsv` (quantas vezes cada função roda no corpus; coluna `exec` do `show`/`next`).
  Função com `exec=0` não é prioridade; nome de `known_functions.json` pode estar errado (0x554bf8 "Unit_WalkTick" nunca roda):
  confira `exec` antes de tratar um nome como fato. Modelo de teste: `game/src/sim/test/exe_path.ts` (`Recon` remonta as entradas por `objs`).
- Episódios com imagem no oráculo: `m10_start_s1`, `m10_mage_s102`, `m20_start_s203`.
- Python: **sempre** `.venv/Scripts/python.exe` (tem `capstone`, `pefile`, `unicorn`); o `python` do sistema não tem.
- Notas de comportamento (`notes/ai-original.md`, `notes/combat-formulas.md`, ...) servem para **conferir** a leitura do C, não para substituí-la.

## Fluxo de uma sessão de porta
1. `python tools/re/port_status.py next --root <addr> --executed --n 15` (ou `--field 0x<off>`): lote de funções pendentes, **folhas primeiro**
   (as chamadas antes de quem chama). Porte na ordem impressa.
2. Para cada função: `python tools/re/port_status.py show <addr>` imprime o C, os chamados com estado e os chamadores. Leia o C inteiro.
3. Traduza (regras abaixo) para o arquivo TS do subsistema (ver "Organização").
4. Prove: teste com os pares do oráculo (`refs/oracle/<addr>.jsonl`, igualdade exata em 100 % das amostras) ou, para função pura,
   teste exaustivo por faixa contra o Unicorn (`A2Emu.call`). Sem prova não há porta: marque `review` e explique na nota.
5. `python tools/re/port_status.py set <addr> ported --ts <nomeTS> [--note "..."]` (ou `out`/`review` com motivo).
6. `cd game && npm run typecheck && npm run test:sim` e `npm run golden -- --ci` (janelas piores = 0).
7. Relatório final de ≤ 10 linhas: lote, portadas/review/out com endereços, o que o oráculo mostrou, próximo lote sugerido.

Duas tentativas por função. Não passou na 2ª: `review` com nota (o que diverge, em que amostra) e siga para a próxima. Não gaste
a sessão numa função.

## Regras da tradução (não negociáveis durante a porta)
- **1 função do exe = 1 função TS**, nome conhecido em camelCase + endereço no comentário: `export function approachCell(/* 0x557f08 */ ...)`.
  Sem nome conhecido: `fn_0x55f220` até alguém nomear. Mesma lista de parâmetros (`this` vira o 1º parâmetro ou método da classe
  espelhada), mesmo valor de retorno.
- **Mesmo fluxo de controle**: mesma ordem de laços, mesmos limites, mesmo desempate, mesmos `break`/`return` antecipados, mesma ordem
  de avaliação de chamadas (efeitos colaterais e `rand()`). Não reordene "para ficar claro".
- **Mesma aritmética inteira**: `(a * b) | 0` ou `Math.imul`; `>> 15` fica `>> 15`; divisão de inteiros com sinal = `Math.trunc(a / b)`;
  módulo com sinal = `a % b` (JS já trunca como C); `& 0xff`, `& 0xffff` conforme o tipo do campo (byte/short) — o campo espelhado tem
  o tamanho do original, então grave com a máscara. Comparações `unsigned` do C: `>>> 0` nos dois lados.
- **Mesmo número e ordem de chamadas ao `rand()`** (`sim/rng.ts`), inclusive sorteios descartados. `Rand_Inclusive(n)` = `(rand()*(n+1))>>15`;
  `rand()` cru 0..32767; veja `notes/golden-corpus.md` (sites) para o nome de cada ponto de uso.
- **Estado só no registro espelhado** (`sim/exe/` tipos com os campos pelo offset): se a função lê `this+0x1c4+0x16`, o TS lê o campo
  espelhado desse offset; se o campo ainda não existe no registro, **acrescente-o** (nome, offset, tamanho, comentário) — não crie
  um campo "parecido" em outro lugar.
- **Não melhore nada** durante a porta: nada de early-return novo, nada de cache, nada de "isso é claramente um bug" (um bug do
  original é comportamento a reproduzir; anote em `docs/GAME_DIFFS.md` se quiser propor desvio depois).
- **Cliente, rede, log, arquivo, save**: não portar; stub com comentário `// stub: cliente (0x504bb7 envio ao cliente local)` e estado
  `out` com motivo. Em dúvida se é servidor: é servidor se escreve em estado de unidade/grupo/jogador/mapa. Faixas típicas:
  pacotes/envio 0x500000–0x505fff (`Server_SendStats` 0x50164f, 0x504bb7, 0x503672).
- **Biblioteca (MFC `CList`/`CArray`/`CMap`, 0x53a000–0x544fff e 0x401000–0x44ffff; CRT 0x582000+)**: não portar método a método;
  uma implementação espelhada por classe em `sim/exe/mfc.ts` (mesma ordem de iteração e retornos) e cada método `out` com nota
  `MFC: exe/mfc.ts:CList.addTail`. Acessor trivial do jogo nessa faixa (`this+0x18b0`, lado da unidade) é jogo: porta-se.
- Não use `notes/` nem o motor atual para "adivinhar" um trecho confuso: vá ao assembly (abaixo).

## Padrões do Ghidra e como traduzi-los (medidos nos arquivos do servidor)
| Padrão | O que é | Tradução |
|---|---|---|
| `CONCAT31(extraout_var, bVar) != 0` (998×) | registrador reusado; só o byte baixo importa | `bVar != 0` |
| `CONCAT22(x._2_2_, 0x807)` | escrita em `short` dentro de `int` | atribuição ao campo short |
| `extraout_ECX`, `extraout_EDX`, `extraout_var` (1572×) | valor "sobrando" num registrador após chamada; quase sempre lixo da análise | ignore, **salvo** quando a função chamada é `__fastcall`/`thiscall` e o chamador usa o registrador de propósito: confira no assembly |
| `unaff_FS_OFFSET`, `puStack_c = &LAB_...`, `local_8 = 0xffffffff` no prólogo (1659×) | SEH do MSVC (prólogo/epílogo) | ignore inteiramente |
| `uVar & 0xff`, `(byte)`, `(short)` em parâmetros `undefined4` | tipo real é byte/short; o Ghidra não reconstruiu | use o tamanho do campo espelhado |
| `__fastcall f(ECX, EDX, ...)` (883×) | 2 primeiros args em registradores; às vezes é `thiscall` mal detectado | confira a convenção no assembly antes de portar o chamador |
| `(**(code **)(*param + 0x1c))()` | chamada virtual (vtable +0x1c) | resolva pela vtable do tipo (unidade: 0x5d0eb0/0x5d0f40/0x5d0fb8; procure no `.rdata`) e chame a função concreta; anote o slot |
| `lVar = CRT_ftol();` **sem argumento**, `FUN_0050d884(obj)` sem uso do retorno, `(float10)`, `(double)` | **a conta em x87 sumiu do C** (operandos na pilha FPU) | **obrigatório desmontar** (capstone, `.venv`) e reconstruir a expressão; `ftol` = truncamento para 0; a precisão intermediária é de 80 bits: teste contra o Unicorn em toda a faixa de entrada plausível |
| `>> n` com ajuste `(x >> 31)`/`+ (x < 0)` | divisão com sinal por potência de 2 | `Math.trunc(x / 2**n)` |
| `SUB41(x, 0)`, `x._0_1_`, `x._2_2_` | fatia de bytes de um valor maior | máscara/deslocamento explícitos |
| `in_EAX`, `in_stack_...` | argumento não detectado | confira a convenção/pilha no assembly |
| `halt_baddata()` | código não decompilável | assembly |
| `FUN_0058a930` | `_getptd` (CRT): `+0x14` = semente do `rand()` | `rng` do sim |
| `y << 8 + x`, `this + idx*4 + 0xc784` | índice de célula (`y*256+x`) e tabelas por célula | grades espelhadas (`sim/exe/grid*.ts`) |

Desmontar um trecho: `.venv/Scripts/python.exe -c "import pefile,capstone; ..."` (exemplo em `tools/re/unicorn_call.py` e `notes/re-tools.md`);
a imagem é `C:\Users\TALES K\Games\re_inputs\allods2.exe`, base 0x400000, sem relocações.

## Organização do código TS (alvo)
- `game/src/sim/exe/` — o porte: um arquivo por subsistema do exe, nomeado pela raiz: `path.ts` (ondas, backtrace, aproximação),
  `walk.ts` (0x555411, 0x55574d, 0x554bf8), `action.ts` (0x50f12c, 0x56dca2), `tasks.ts` (0x569321 e tarefas), `think.ts` (0x570087,
  grupos), `combat.ts` (0x516c1f.., dano), `spells.ts`, `effects.ts`, `regen.ts`; `types.ts` com os registros espelhados (`UnitRec`,
  `GroupRec`, `PlayerRec`...) e `vtables.ts` (slot → função).
- Cada arquivo começa com um cabeçalho listando os endereços portados nele. O resto do sim (`world.ts`, `ai.ts`) chama o porte e vai
  sendo esvaziado subsistema a subsistema (padrão estrangulador; não deixe duas implementações do mesmo comportamento vivas depois
  da troca).
- Testes: `game/src/sim/test/exe_<subsistema>.ts`, um por arquivo, lendo `refs/oracle/<addr>.jsonl`.

## Economia de tokens
- Leia o C pelo `show`, nunca abra o `g_*.c` inteiro (são milhares de linhas). Saídas grandes: `ctx_search`/`ctx_execute`.
- Não resuma a conversa nem repita estas regras no relatório. Relatório ≤ 10 linhas.
- Lote de 10–30 funções pequenas ou 1–3 grandes (> 2 KB) por sessão. Terminou o lote: pare e relate; não comece outro.
