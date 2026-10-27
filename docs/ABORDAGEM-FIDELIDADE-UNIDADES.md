# Abordagem: como fazer as unidades se comportarem como no original

Resposta ao problema descrito em `docs/PROBLEMA-FIDELIDADE-UNIDADES.md`. Descreve **como o trabalho deve ser feito**, não o faz.
Escrita por dois analistas independentes (Fable 5.1 ×2) que chegaram ao mesmo núcleo por caminhos separados; as diferenças
estão na seção 9. Números medidos nesta análise estão na seção 2.

## 1. Diagnóstico em uma frase

Tentamos reconstruir uma máquina de estados determinística **observando a saída por um buraco de fechadura** (traço de 7 campos por
unidade), quando temos o **código-fonte** dela (C decompilado, 8778 funções) e a capacidade de **executar qualquer função dela
isoladamente** (Unicorn). A comparação diferencial por episódio foi a ferramenta certa para provar que o original é determinístico
e para medir a distância; é a ferramenta errada para **fechar** a distância, por três razões estruturais:

1. **Cascata.** Uma diferença de 1 tique contamina tudo depois. As janelas de 5 s com ressincronização reduzem, mas não eliminam:
   a ressincronização importa um estado incompleto (timers, fase da ação, giro do olhar, listas de caminho), o que já é uma
   divergência no tique 0 da janela.
2. **Pouca observabilidade.** O traço registra posição/vida/alvo (saídas), não as decisões. Uma diferença de posição no tique 40
   pode vir de 20 funções; cada assinatura custou "2–3 sessões com sondas" para atribuir.
3. **Modelo "parecido", não "igual".** O motor foi escrito a partir de notas de comportamento e ajustado por tentativa (20/s → 16/s,
   `actRelease`, `decideTick`, "testado e DESFEITO" ×4 na fase 7). Ajustar um modelo diferente até coincidir tique a tique com ~1700
   funções não converge: cada remendo conserta um caso e quebra outro. O teto medido confirma: com ±32 tiques de folga só 46 % das
   janelas ficam limpas, logo **mais da metade do resíduo é lógica não portada**, não fase nem sorteio (o replay do `rand()` rendeu
   ~1 ponto).

Conclusão: trocar **inferência por observação** por **tradução do código**, com um oráculo que compare **estado interno completo**
a cada tique. Isso é o que fizeram os projetos de reimplementação que chegaram à fidelidade (devilutionX, OpenRCT2 na fase inicial,
decomps de Nintendo 64): a fidelidade é **por construção**, função a função, não por ajuste do todo.

## 2. Tamanho real do problema (medido nesta análise, `callgraph.tsv` + `index.tsv`)

| Fecho de chamadas diretas (só faixa do jogo 0x401000–0x57d000) | funções | nomeadas | código | linhas de C |
|---|---|---|---|---|
| `Server_Tick` 0x4f08c0 + raízes de vtable (`Unit_ActionMachine`, `Unit_Regen`, `AI_TaskDispatcher`, `AI_PlayerThink`) | 1759 | 236 | 354 KB | ~55 000 |
| `Unit_ActionMachine` 0x50f12c (ação, andar, caminho, efeitos, golpe, magia) | 814 | 121 | 154 KB | |
| `AI_PlayerThink` 0x570087 (pensamento 1×/s, grupos) | 220 | 62 | 38 KB | |
| `AI_TaskDispatcher` 0x569321 (tarefas da unidade) | 180 | 45 | 30 KB | |
| Stand ground + Guard (0x56a1fb, 0x56a5fc) | 138 | 36 | 23 KB | |
| Célula de aproximação (0x557f08 + 0x5585f4) | **11** | 3 | **3,3 KB** | |

- Mediana de **78 bytes por função**; 80 % têm menos de 207 bytes; só **23 funções passam de 2 KB**. A maior parte é acessor,
  wrapper ou laço curto: tradução mecânica. O fecho inclui código que não entra na porta (envio de rede, log, salvar, loja, taverna,
  strings): o núcleo "unidade" útil é da ordem de **150–200 KB / 20–30 mil linhas de C / 400–600 funções não triviais**.
- O servidor usa **524 offsets distintos** sobre `this` (361 a partir de `+0x1c4`, a área de IA da unidade). Esse é o tamanho do
  inventário de estruturas a reconstruir — finito, e o Ghidra pode gerar a lista.
- O exe tem **CRT e MFC estáticos** (importa só kernel32/user32/gdi32/winmm/wsock32/ddraw/dsound): heap, `rand()` e listas MFC
  ficam **dentro** da imagem do processo. Isso é o que torna viável o oráculo da seção 4.
- O harness já lê e despeja a memória do processo (`tools/refcap/original/memory.py`: `Proc.snapshot()` de todas as regiões
  graváveis; `export_state.py` decodifica unidades, grupos, livros, visão).

## 3. Critério de "fiel": igualdade de estado do servidor, tique a tique, tolerância zero

Escolha: **critério 1** (estado idêntico por tique, incluindo estado interno), e não ordem de eventos nem equivalência percebida.

- É o único critério que **compõe**: função igual + função igual = sistema igual. Permite provar por partes e nunca regredir.
- É **atingível**, porque o original é determinístico sob o harness (fase 0: 100 % idêntico em 5 rodadas) e temos o código.
- Os outros critérios vêm de graça quando este vale; e nenhum deles localiza defeitos nem tem medida barata.
- Já é o que o multiplayer vai exigir (determinismo com hash de estado).

Tolerância: **0** em todo campo inteiro (posições finas em 1/256 de célula, vida, mana, timers, fase, contadores). Campos que
passam pela x87 (fórmula do andar, ponto de fuga, `ftol`) também devem bater em 0; se um caso de borda de precisão estendida
(80 bits) impedir, documenta-se e aceita-se ±1 unidade fina **só nesse campo**, nunca em lógica.

Fora do critério: tudo que é cliente (desenho, som, animação, HUD, névoa visual). Ordem de eventos e "percebido" ficam como relato
secundário para o usuário final (continuam saindo do `npm run golden`), não como meta de engenharia.

Importante: o original **jogado** não é determinístico (semente pelo relógio, consumo do `rand()` pelo cliente dependente de
quadros). Logo "fiel" só é mensurável sob o harness; para o jogador, um servidor idêntico sob o harness é indistinguível.

## 4. Método: três pilares

### 4.1 Leiaute de estado espelhado (o "registro fiel")

O estado do servidor no nosso motor passa a ter **os mesmos campos, com os mesmos significados e a mesma granularidade** que as
estruturas do exe: `CUnit` (área base, `+0x1c0` andar, `+0x1c4` IA/timers, `+0x144` efeitos, `+0x54/+0x58/+0x6c/+0x136` máquina de
ação, listas de caminho estático/dinâmico), `CGroup` (`+0x3c`: comando, centroide, raios, lista de vistos, dormindo), `CPlayer`
(diplomacia, livro), objetos de magia/efeito, as grades de passagem e de distância das ondas, o relógio (16/s, segundos, fase) e a
semente do `rand()`. Campos com **nome** (`aiMode`, não `_1c4_08`), mas documentados pelo offset, e um **decodificador** imagem de
memória → registro (generalização do `export_state.py`) e **codificador** registro → imagem (para o Unicorn).

Isso não é "arrays de bytes": é um modelo TS tipado cuja forma é ditada pelo exe. O `Unit` atual passa a delegar a esse registro,
subsistema a subsistema (padrão estrangulador, seção 6), e `snapshot.ts` passa a gravá-lo. Efeitos colaterais desejados: estado
importado do original vira só decodificação; o formato de save espelha o do jogo; o hash de estado do multiplayer sai disso.

Pergunta aberta 2 ("que parte do comportamento depende de estado que o traço não registra") **deixa de existir**: todo o estado
passa a ser registrado e comparado.

### 4.2 Oráculo: o servidor original rodando dentro do Unicorn, a partir de uma imagem do processo

Em vez de montar memória à mão por função (o que o 2º analista propôs; frágil para listas encadeadas e grades) ou de rodar o jogo
com GUI (uma instância, trava, 2,4 s por carga, só 7 campos observáveis), **despejar a memória do processo real** num limite de
tique (seções `.data`/`.bss` + heap + pilha, com `Proc.snapshot()`; `Scenario.dll` incluída, já que está carregada no processo) e
**retomar a execução no Unicorn** chamando `Server_Tick` 0x4f08c0 em laço:

- Importações que o tique toca viram HLE em Python: `timeGetTime` (relógio virtual, como `vclock.py`), `HeapAlloc/HeapFree/VirtualAlloc`
  (alocador simples sobre uma região nova), `send`/`OutputDebugString`/arquivo de log (stubs). `rand()` é do CRT estático: roda
  nativo. `fs:[0]` (SEH) com cadeia mínima, como já faz o `unicorn_call.py`.
- Ordens do jogador: escrever o pacote na fila de mensagens do cliente (formato e despachante 0x4f515d já conhecidos pelo `a2_diff`).
- Script: `Scenario.dll` roda nativo dentro da imagem (ponteiros já resolvidos no processo despejado).

O que isso dá:

1. **O original roda sem GUI, em N instâncias paralelas**, sem harness, sem trava, sem monitor. A fila de 8 s por episódio acaba.
2. **Memória inteira observável em todo tique**: oráculo de **tique inteiro** — estado `T` do original → `step()` nosso → comparar
   com estado `T+1` do original, **campo a campo**, para todas as unidades, grupos e grades. Sem cascata (todo tique reancora), e a
   **primeira diferença nomeia o campo**, e o campo nomeia a função que o escreve (via callgraph + grep do offset no C). Esse é o
   "próximo item de trabalho" automático, no lugar da fase de hipótese.
3. **Oráculo por função em contexto real**: qualquer função do fecho pode ser chamada no Unicorn com memória completa e real
   (hook de entrada/saída: argumentos, retorno, bytes tocados), gerando pares (entrada, saída) para testes unitários do nosso porte —
   sem construir estruturas à mão. Para funções puras (aritmética, aneis, desempates) vale também o teste exaustivo por faixa.
4. **A imagem crua não depende do mapa de estruturas**: despeja-se hoje, decodifica-se incrementalmente à medida que o inventário
   de campos cresce. Imagens antigas continuam válidas.

Validação do oráculo (obrigatória antes de confiar): retomar a imagem do tique 0 de `m10_start` e `m20_start` e comparar o traço de
960 tiques produzido no Unicorn com o traço do jogo real (`refs/golden`): tem de ser **100 % idêntico** (traço + estado do `rand()`),
como foi a prova de determinismo da fase 0. Se não for, o desvio aponta uma importação/estado não tratado — e é barato de achar
porque o Unicorn permite breakpoint em tudo.

Falhas previsíveis e mitigação (lista dos dois analistas; o fecho de `Server_Tick` só sai do código do jogo para CRT/MFC estáticos —
`_memset`, `_ftol`, `strstr`, `CStdioFile` — nenhuma importação de GUI, conferido no callgraph):
- `_getptd` chega ao `_tiddata` por `TlsGetValue`: precisa de TEB falsa (`FS:[0x18]`/`[0x2c]`) e HLE de `TlsGetValue`, senão o
  primeiro `rand()` falha. SEH é inofensivo enquanto nada lança; `RaiseException` = parar e investigar.
- `malloc` do MSVC 6 (small-block heap sobre `HeapAlloc`/`VirtualAlloc`): alocador de avanço numa região nova, `free` sem efeito;
  registrar alocações para detectar vazamento que mude endereços.
- **Fila do cliente**: no solo, o envio 0x504bb7 escreve na fila de recepção do cliente no mesmo processo e ninguém consome →
  cresce. Stub ou drenar. Idem eventos de visibilidade 0x52b321 e a ficha gravada a cada 15 s por `CStdioFile` (HLE
  `CreateFile`/`WriteFile` = sucesso vazio).
- `Scenario.dll` é chamada por ponteiro (fora do callgraph): despejar todos os módulos não-sistema e registrar todo salto para
  endereço não mapeado; a lista completa de HLEs sai empiricamente na 1ª sessão.
- Relógio: despejar da cópia `a2_diff`, já remendada (relógio virtual), para reaproveitar a fase 0.
- `DirectDraw`/`DirectSound` não aparecem no fecho; se um caminho indireto os tocar, HLE devolvendo sucesso.
- Velocidade: Unicorn sem hooks por instrução é JIT (dezenas de milhões de instruções/s); um tique do servidor deve custar < 1 M
  instruções, logo dezenas a centenas de tiques/s por instância — mais lento que o jogo real sem amostrar, mas paralelo e com
  observabilidade total.
- **O diff cru de memória por tique é ruidoso** (listas religadas, endereços de heap, contadores do cliente): a comparação é sempre
  sobre o **registro decodificado** (4.1), nunca sobre bytes; a imagem só torna o inventário incremental.

**Portão de adoção**: a retomada só vale depois de reproduzir 3 episódios do corpus (`m10_start`, `m10_mage`, `m20_start`, 960
tiques) com traço **e** estado do `rand()` idênticos ao gravado em `refs/golden` — o golden vira o oráculo do oráculo. Se o portão
não passar em 3 sessões, plano B: oráculo por função com memória montada a partir do estado exportado (já funciona para funções
pequenas; frágil para listas e grades).

### 4.3 Porta literal, guiada pela primeira divergência

Regras da tradução (são o que faz convergir; não negociar durante a porta):

- **Uma função do exe = uma função TS**, nomeada pelo nome conhecido com o endereço no comentário (`approachCell /* 0x557f08 */`).
  Mesma assinatura, mesmo fluxo de controle, mesma ordem de laços e de desempates, mesma aritmética inteira (`| 0`, `Math.imul`,
  `>> 15`, divisão truncada, `ftol`), mesmo número e ordem de chamadas ao `rand()`.
- **Não "melhorar" durante a porta.** Limpeza, nomes bons e refatoração vêm depois, com o oráculo de tique como rede.
- **Não portar o que não é servidor**: nos pontos onde o tique chama cliente, rede, log ou arquivo, um stub documentado.
- Cada função portada ganha um teste que lê os pares (entrada, saída) do oráculo e exige igualdade exata em 100 % das amostras.
- Vtables e ponteiros de função não estão no `callgraph.tsv`: seguir o **C**, não o grafo; enumerar as vtables de `.rdata`
  (0x5d0eb0/0x5d0f40/0x5d0fb8 já conhecidas) e acrescentá-las ao grafo com um script.
- **O C perde as contas em x87.** Conferido em `Unit_ApproachCell` 0x557f08: aparece `lVar12 = CRT_ftol();` sem argumento, com os
  operandos carregados na pilha FPU por funções auxiliares cujo retorno o Ghidra não mostra. Para essas funções (94 chamadas a `_ftol`
  no servidor) a porta exige o **assembly** e teste contra o Unicorn em toda a faixa plausível; é o único trecho onde a tradução não é
  mecânica. A skill `port-exe` lista o padrão e os demais artefatos do Ghidra com a tradução de cada um.

Ferramentas desta etapa já criadas: skill `.claude/skills/port-exe/SKILL.md` (regras e padrões), `tools/re/port_status.py`
(lista de trabalho `port_status.tsv` com 1759 funções do fecho; `next --root` dá o lote folhas-primeiro, `next --field` acha quem
escreve num campo, `show` imprime o C com chamados e chamadores) e `docs/briefings/ETAPA1-ORACULO-RETOMADA.md` (briefing da etapa 1).

Ordem: ditada pelo oráculo de tique (campo que diverge primeiro e com mais frequência), que hoje já se conhece pelo placar
do golden: (1) célula de aproximação e anel sem rótulo (11 funções, 3,3 KB — `pos` 508); (2) andar/perseguir e o golpe depois de
andar (`Unit_ActionWalk`, `Unit_ActionChase`, `Unit_WalkTick`, `FUN_0055532d` — `hp` 260); (3) escolha de alvo do Stand ground e
guarda do grupo (0x56a1fb, 0x5728fa/0x57275f, 0x56eab5/0x56eff3 — `target` 207); (4) `Unit_ActionDispatcher` e
`Unit_ActionMachine` inteiros, um `case` por sessão; (5) acerto/dano/efeitos; (6) `AI_PlayerThink` e comandos de grupo; (7) o resto
do fecho, por frequência de execução medida no oráculo (hook de contagem: função nunca executada em nenhum episódio = baixa
prioridade, mas ainda na lista).

### 4.4 Carregador de missão

Sem o carregador igual, o tique 0 do nosso jogo (missão iniciada por nós) nunca será o tique 0 do original, e a fidelidade só
valeria a partir de estados importados. Mas o carregador **não precisa de porta literal**: verifica-se **por igualdade de dados**. Um
despejo do original logo após a carga de cada missão (46 despejos, uma vez) dá o tique 0 exato; o nosso carregador ganha um teste que
exige produzir o mesmo registro espelhado. Porta-se só o que divergir (padrões 0x57382c de Wimpy/Withdraw, `prob × 327`, livro,
grupos iniciais em Guard, timers iniciais); o `rand()` da animação inicial é irrelevante porque a semente entra depois. Depois do
núcleo do tique, não antes.

## 5. Cobertura: por código, não por episódio

A pergunta aberta 4 ("como saber se um comportamento do original que nenhum episódio cobre falta no nosso") tem resposta
estrutural: **a lista de verificação é o fecho de `Server_Tick`**. Cada função está em um de três estados, mantidos num arquivo
versionado (`tools/re/port_status.tsv`: endereço, nome, estado, função TS, motivo):

- **portada e provada** (teste com pares do oráculo passando);
- **fora do escopo, com justificativa** (cliente, rede, log, salvar, loja, código morto como 0x57a608);
- **pendente**.

Métrica de cobertura = bytes portados / bytes do fecho que não estão fora do escopo. Episódios novos deixam de ser necessários para
**descobrir** lógica; servem só como regressão de integração.

## 6. Como encaixar no motor atual sem parar o jogo

Padrão estrangulador, subsistema a subsistema, atrás da interface que `mission/`, `script/` e HUD já usam (`World`):

1. O registro fiel (4.1) entra como fonte de verdade do estado; o `Unit` atual passa a ser uma vista sobre ele (campos derivados
   e caches continuam onde estão).
2. Cada subsistema migra **inteiro** (andar e caminho; depois alvo e tarefas; depois máquina de ação; depois dano/magia; depois
   pensamento de grupo) e o código antigo correspondente é **apagado** no mesmo passo. Dois modelos conviventes por muito tempo é o
   principal risco de meio-termo.
3. `npm run golden -- --ci` continua rodando a cada troca como rede de regressão (janelas piores = 0). Os ~2100 testes de `test:sim`
   que codificam comportamentos marcados `[est]` são substituídos pelos testes do oráculo quando a função correspondente é portada;
   os que medem fatos já conferidos no original ficam.

## 7. Etapas em ordem, com "pronto quando"

| # | Etapa | Pronto quando | Custo estimado |
|---|---|---|---|
| 1 ✅ | **Oráculo por retomada** (4.2): despejo do processo (`a2_diff`) num limite de tique; retomada no Unicorn; HLE mínima; injeção de ordens | Portão: 3 episódios do corpus (`m10_start`, `m10_mage`, `m20_start`, 960 tiques) com traço + `rand` idênticos ao gravado | 2–3 sessões. Se falhar em 3, plano B (oráculo por função com memória montada) |
| 2 ✅ | **Inventário de campos**: script Ghidra/grep que lista todo offset usado sobre cada tipo (unidade, grupo, jogador, objeto) com as funções que leem/escrevem; tipos Ghidra criados a partir dele; ganchos de entrada/saída no emulador gravando argumentos e memória tocada por função | Decodificador imagem → registro cobre 100 % dos offsets lidos pelo fecho; `export_state.py` reescrito sobre ele; pares (entrada, saída) por função gerados sem montar memória à mão | 2–3 sessões |
| 3 ✅ | **Comparador de tique inteiro**: estado `T` → nosso `step()` → diff campo a campo com `T+1`; relatório "1º campo divergente → funções que o escrevem" | Roda em `npm run golden` sobre despejos por tique de 3–5 episódios; métrica "% de tiques exatos" e "mediana do 1º tique divergente sem ressincronização" | 1–2 sessões |
| 4 ✅ | **Piloto de porta**: célula de aproximação + anel (11 funções) com registro fiel do caminho | Campo de posição exato em 100 % dos tiques dos episódios do piloto, ou causa residual nomeada por campo | 1–2 sessões. **Decide o método**: se o piloto não fechar, voltar aqui antes de escalar |
| 5 | Andar/perseguir/golpe após andar (`docs/briefings/ETAPA5-ANDAR.md`) | `pos` e `hp` do herói exatos nos episódios da missão 10 | 3–4 sessões |
| 6 | Alvo (Stand ground, guarda de unidade e de grupo, sub-tarefas) | `target` exato; grupos 0x12 e 1 | 3–4 sessões |
| 7 | Máquina de ação e despachante inteiros (por `case`) | Todos os campos da área de ação exatos | 4–6 sessões |
| 8 | Dano, acerto, efeitos, magias, invocações, vida 0/−10, saque | Área de efeitos e vida exatas; GAME_DIFFS seção I zerada | 6–8 sessões |
| 9 | Pensamento de jogador de IA e comandos de grupo; carregador (4.4) | Tique 0 e pensamento exatos nas 46 missões a partir da carga | 5–8 sessões |
| 10 | Varredura do fecho restante por frequência de execução; `port_status.tsv` sem pendentes | Cobertura 100 % (portado ou fora do escopo justificado) | 5–10 sessões |

Total da ordem de **35–45 sessões** curtas e mecânicas (estimativas independentes dos dois analistas: 35–50 e 35–45; o 2º conta
~45–55 % das 55 mil linhas como portáveis, a 1–1,5 mil linhas de C por sessão, e as 23 funções grandes a ~1 sessão cada), comparável
ao já gasto (~60 frentes), com a diferença de que cada sessão move um ponteiro que **não volta** (função provada fica provada) e o
fim é definido (lista vazia), em vez de uma assíntota em 34 %. Cada sessão: ler o C de 10–30 funções, traduzir, rodar os pares do
oráculo, commit, relatório de 10 linhas; 2 em paralelo quando não compartilham subsistema. Marco intermediário esperado: após ~8–10
sessões (emulador + aproximação + andar) o resíduo `pos` 508 deve cair pela metade. O original real só volta a rodar para **despejar
imagens** (uma por missão e uma por episódio de interesse), nunca para traçar.

### 7.1 Resultado das etapas 1–4 (2026-10-27)

- **Etapa 1, oráculo** (commits 61d920b, 64b8b4b; `tools/re/oracle/`, `notes/oracle-resume.md`): portão passou nos 3 episódios
  (traço de 960 tiques + `rand` a cada 16 tiques idênticos ao golden), ~430–530 tiques/s por instância, HLE de ~12 APIs. Dois
  achados que o portão inicial não via: o Unicorn parte com FPCW 0 (precisão 24 bits) e o jogo roda com **0x27f (53 bits = double
  do JS)**; a lista de cadáveres (+0x44) precisa entrar na imagem. `fnprobe.py` grava pares por função (argumentos, retorno, rng,
  leituras e escritas com mapa endereço → unidade/sub-objeto/offset); `dump_ticks.py` grava o estado decodificado por tique.
- **Etapa 2, inventário** (a0dd053): 524 offsets distintos de `this`, `fields_by_type.tsv` por tipo com leitores/escritores, vtables
  de `.rdata`. Limite conhecido: escrita feita por ponteiro local não aparece (ex.: a fração de posição `+0x10->0x4` mostra 1 escritor).
- **Etapa 3, comparador** (f3c6084; `npm run tickcmp`, `notes/tick-compare.md`): tiques 100 % idênticos hoje: 10,2 % / 8,2 % / 2,8 %
  nos 3 episódios; mediana do 1º tique divergente sem reancorar: 46 / 45 / 74. 1ª divergência: `fx`/`fy` (1/256 no 5º tique de andar),
  `dir16` (olhar em volta), `act` (ordem de andar vira ação 1 um tique depois), caminho dinâmico, `rng` (82–87 % dos tiques com o
  mesmo nº de sorteios). O `applyState` sorteia `rand()` em 8–67 % dos tiques (o comparador restaura; o golden herda o desvio).
- **Etapa 4, piloto** (73d35a0; `game/src/sim/exe/{types,path}.ts`, `test/exe_path.ts`): 12 funções portadas, 100 % dos pares nos 3
  episódios + 4000 casos no Unicorn para os ramos que os pares não alcançam (`tools/re/oracle/fuzz_approach.py`), **na 1ª tentativa**.
  A conta em x87 de `Unit_ApproachCell` foi reconstruída do assembly (inclinação em float32, `ftol` truncando, NaN/inf → 0). Os
  pares mostraram: sem escritas, sem `rand()`, retorno válido só na largura declarada. O critério "posição exata em 100 % dos tiques"
  **não foi avaliado**: o piloto não integrou nada em `world.ts` (decisão: integração vira etapa própria, abaixo). **Método confirmado.**
- **Perfil de execução** (`tools/re/oracle/exec_profile.py` → `tools/re/exec_profile.tsv`, ~11 s por episódio): 730 funções rodam nos 3
  episódios × 960 tiques; 70 delas no servidor **não são alcançadas pelo callgraph** (vtable/ponteiro) e hoje entram como raízes
  extras no `port_status.py init` (lista: 1825 funções). Também revelou que `0x554bf8` "Unit_WalkTick" nunca executa (nome errado de
  nota). Métrica nova: bytes executados no corpus já portados (2,2 %).
- **Ajuste da ordem**: a integração (seção 6) passa a ser uma etapa própria entre a 5 e a 6 da tabela, decidida por modelo forte
  depois do lote do andar, porque o avanço de posição por tique vive no caso 1 de `Unit_ActionMachine` e exige o registro espelhado
  dentro da `World` (o `Unit` atual vira vista sobre `UnitRec`).

## 8. Medir progresso (barato, monotônico)

- **Funções provadas / fecho** (ponderado por bytes): sobe a cada sessão; roda em ms dentro de `test:sim`. `port_status.py report`
  dá também **bytes executados no corpus já portados** (perfil `exec_profile.tsv`): é a cobertura que importa primeiro.
- **% de tiques exatos** (estado inteiro) e **mediana do 1º tique divergente sem ressincronização** por episódio (hoje provavelmente
  < 80; meta 960): uma linha nova no `npm run golden`, ~2 s. Não satura como "% de janelas limpas".
- **1º campo divergente** mais frequente = próxima tarefa (automático).
- `golden --ci`: janelas piores = 0 (regressão).

## 9. Onde os dois analistas divergiram, e a decisão

| Ponto | 2º analista | Este documento | Decisão |
|---|---|---|---|
| Oráculo | Por função, memória montada no Unicorn a partir do estado exportado (JSON) | Retomada da imagem do processo; oráculo de tique inteiro + por função em contexto real | Retomada, com portão de 3 episódios (etapa 1); o 2º analista concedeu o ponto após conferir que o fecho não toca GUI; o outro é plano B |
| Carregador | Verificar por igualdade com o despejo pós-carga; portar só o que divergir | Portar como subsistema | **Por igualdade** (4.4), depois do núcleo |
| Diff de memória | Alertou: diff cru por tique é ruidoso (listas, heap) | Decodificar antes de comparar | Comparar sempre o registro decodificado, nunca bytes |
| x87 | Não mencionado | Risco explícito; teste exaustivo via Unicorn nas funções com ponto flutuante | Tratar na etapa 5 (andar) |
| Proveniência | Levantou: código traduzido do decompilado é derivado do original | Concorda; não é decisão técnica | **Decisão do usuário** (seção 10) |

Convergiram sem combinar: porta literal, leiaute espelhado, tique exato com tolerância 0, cobertura por callgraph, parar de remendar
`ai.ts`/`world.ts` por assinatura, não investir mais em replay de `rand()` nem em tolerâncias.

## 10. O que NÃO fazer, e decisões que são do usuário

Não fazer:
- Não gerar mais episódios nem fuzz para **descobrir** lógica; não continuar remendos guiados por assinatura; não ampliar tolerâncias;
  não investir mais no replay por chamador do `rand()`; não ir ao assembly antes do C; não "melhorar" código durante a porta.
- Não deixar dois modelos de estado conviverem por mais de um subsistema; não portar cliente/rede/log.

Decisões que só o usuário pode tomar:
1. **Proveniência.** Código traduzido função a função do decompilado é obra derivada do original. O repositório já mantém o decompilado e
   `refs/` fora do público; o porte TS do servidor terá a mesma natureza. Opções: aceitar (é o que devilutionX e os decomps fazem, com
   risco conhecido), ou manter o núcleo do sim num módulo privado. Deve ser decidido **antes** da etapa 4.
2. **Aceitar que o núcleo do sim será reescrito** (por partes, atrás da mesma interface) e que testes `[est]` serão descartados.
3. **Critério**: confirmar tique exato com tolerância 0 (seção 3) como meta de engenharia, com os relatos tolerantes só como informação.

## 11. Respostas às perguntas abertas

1. **Critério e tolerância**: estado do servidor idêntico por tique, tolerância 0 (seção 3).
2. **Estado não registrado**: deixa de existir com o registro fiel e o oráculo de tique inteiro (4.1, 4.2); hoje são, no mínimo,
   fase/contador da ação, pedido e modo da sub-tarefa, giro do olhar, listas de caminho estático/dinâmico, timers `+0x1c4+0x16/0x54/0x98/0x9c`,
   `+0x136`, raio/estado/dormindo do grupo.
3. **Lógica vs estado vs fase**: o teto de 46 % com ±32 tiques e o ganho de ~1 ponto do replay dizem que > metade é lógica não
   portada; a fração exata por campo sai do comparador de tique inteiro (etapa 3) sem mais sondas.
4. **Comportamento sem episódio**: cobertura pelo fecho do callgraph (seção 5), com contagem de execução por função no oráculo para
   priorizar.
