# Passagem de sessão (2026-10-18) — leia primeiro ao retomar

## Primeiro passo na sessão nova
1. Confirme que as ferramentas do **context-mode** (MCP `ctx_execute`, `ctx_search`, `ctx_batch_execute`...) aparecem (`ToolSearch ctx_`). Foi registrado em `~/.claude.json` (user, Node 24 do nvm). Se não aparecerem, rode `claude mcp list`.
2. **Inclua em TODO briefing de subagente**: "use as ferramentas ctx_* (context-mode) para saídas grandes (logs de teste, listagens, leitura de arquivos longos) em vez de colar a saída no contexto; Grep/Read com offset/limit; `| tail -20`; relatório final ≤ 250 palavras".
3. Regras de orçamento: no máximo 3 agentes ao mesmo tempo; Sonnet para trabalho de extensão de padrão, Opus só para engenharia reversa; retomar agentes parados com SendMessage.
4. Rode `cd game && npm run typecheck && npm run test:sim && npm run test:script && npm run test:campaign && npm run test:missions` e veja o que está vermelho (o FIDELIDADE-CIDADE pode ter parado no meio de uma edição).

## Bugs do usuário a revisar logo depois do reinício
- **Diálogo da missão (moldura com caveiras, `mission/hud.ts`, janela de mensagem):** o quadrado da FOTO do personagem (retrato à esquerda) está **sobrescrevendo a borda esquerda da moldura** (ouro/caveira). Conferir contra o original (`refs/original/` cenário de missão com diálogo; `tools/refcap/run_all.py --only mission10_start`) e ajustar posição/tamanho do retrato para ficar DENTRO da moldura, sem cobrir as bordas.
- **Tela Load Game:** clicar no slot não seleciona (carregar por teclado/API funciona). Arquivos: `game/src/ui/saveui.ts`, `ui/menukit.ts`.
- Música: `AudioManager.playMusic` agora é exclusivo (uma faixa por vez); se o usuário ainda ouvir a música da missão sobre a da cidade, investigar caminhos de saída (derrota, End Quest, Restart).

## Estado do projeto
Ver `docs/ENTREGA.md`, `docs/ROADMAP.md`, `docs/GAPS.md`, `docs/REQUESTS.md`. Resumo:
- Feitos: decodificação dos formatos; jogo web (`game/`): logos/intro/menu/criação idênticos ao original (SSIM ~1,0), cidade/taverna/loja/mapa-múndi funcionais e em fidelidade (rodada FIDELIDADE-CIDADE em andamento), campanha dirigida por `campaign.json` (Plagat → Kaarg → acampamento druida; 46 missões alcançáveis no motor), salvar/carregar com menu Esc, inventário/bolsa, IA/magias, animações, pilotos automáticos das missões 10, 20, 30, 31, 32, 40–43; comparador automático contra o original (`tools/refcap/run_all.py`, capturas em `refs/original/`, biblioteca de estados em `refs/original/saves/`).
- Em andamento no momento da passagem: **FIDELIDADE-CIDADE** (agente `afd97e08c4fbe389e`, Sonnet): enquadramento 640x480, painéis inventados, animações da cidade, taverna, loja, mapa-múndi. Quando terminar, ler o relatório dele e `docs/COMPARE/report.md`.

## Próximos passos
1. Revisar os bugs acima e integrar o resultado do FIDELIDADE-CIDADE (rodar o comparador em todos os cenários).
2. Fase 3: pilotos e correções de motor por lotes de missões — 50–53 (acampamento druida), 60–63, 70–77, 80–87, 90–96, 100–103, 110 — usando `game/src/sim/test/mission20.ts` e `missions_kaarg.ts` como padrão; tratar o aviso das missões 71 e 93–96 (ações de host sem suporte: `setTrap`, `setTileSpellDuration`, `spellOnTile`, `unitHasSpell`).
3. Fidelidade das cenas que ainda não têm captura do original (Load/Save/Options, créditos, vídeos, taverna druida, menu Esc da cidade) com a biblioteca de estados do original.
4. Itens em aberto de GAPS: altitude/relevo, hall da fama, trilha do mapa-múndi, mensagens de missão sem áudio.

## Atualização: FIDELIDADE-CIDADE parou (typecheck limpo)
Cidade (SSIM ~0,99 em Plagat, Kaarg e druidas) e taverna (~0,93–0,94) prontas em frame640. **Faltam:** loja (geometria já medida), mapa-múndi, Briefing, Credits e menus da cidade; `npm run test:campaign` não foi rodado depois das mudanças. Pendências na taverna: dano do mago (21–43 no original) sai diferente; Kaarg mostra um 4º cartão por diferença de estado do save; nos druidas falta a animação "bug". Detalhes e comandos: `docs/RESUME-FIDELIDADE-CIDADE.md`. As decisões novas dele ainda não estão em `docs/GAPS.md`. Nenhum agente está rodando.

## Pedido do usuário para depois do reinício: auditoria de fidelidade de TODAS as interfaces em jogo
Revisar, uma a uma, cada interface que aparece durante o jogo (principalmente dentro da missão), comparando com o original (capturas em `refs/original/` e a biblioteca de estados `refs/original/saves/` + `tools/refcap/original/load_state`): diálogo de mensagem (moldura com caveiras, retrato dentro da moldura, botão Ok), **"Drop money"** (How much gold do you want to drop? campo numérico, botões "Drop money" / "Cancel drop"; o print do usuário mostra linhas finas de retângulo atrás do conteúdo da moldura e o destaque do botão com cor diferente: conferir com o original), inventário/bolsa e tooltips de item, livro de magias, janelas de objetivos, menu Esc/Load/Save/Options, tela de resultado da missão, caixa de confirmação (Sair), painel de status/ficha do herói, minimapa, barras sobre unidades, textos flutuantes de dano, loja/taverna (restante do FIDELIDADE-CIDADE). Para cada uma: capturar nosso e original no mesmo estado, rodar `tools/refcap/run_all.py`, listar divergências e corrigir; registrar em `docs/COMPARE/`. Acrescentar os cenários novos a `tools/refcap/scenarios.json`.

## Atualização (UI-FIX concluído)
- Diálogo da missão: moldura em escala 1 (480x222 em (268,267)), retrato 86x102 dentro da moldura; SSIM 0,715 → 0,742. "Drop money": emenda da moldura corrigida (miolo inset 8px), foco dourado via classicMenuItem; layout estimado (sem captura do original). Load Game: clique nos slots corrigido. Áudio: uma única faixa após vitória/derrota/End Quest/Restart (caminhos F3/load não exercitados).
- Rodando: FIDELIDADE-CIDADE-2, MISSÕES-E (80–87), MISSÃO-UI-1 (comandar aliados + painel Heads). Próximo lote: MISSÕES-F (90–96, 100–103, 110), auditoria de interfaces em jogo.

## Atualização (2026-10-19)
- Concluídos: UI-FIX, MISSÕES-C/D/E/F (pilotos de 50–110; suíte: sim 1675 ok, script 49, campaign 65, missions 46/0 exceções), MISSÃO-UI-1/2 (grupo/aliados, alavancas, pegar item), SAVE-AUDIT (snapshot v2), FIDELIDADE-CIDADE-2, FIDELIDADE-MENU, CAPTURAS-ORIGINAL (harness corrigido: dgVoodoo flip_discard + winguard.py; 104 cenários, SSIM médio 0,909 → 0,962).
- Em andamento: FIDELIDADE-MISSÃO (auditoria de interfaces dentro da missão + moldura de fala, carroça, taverneiro de Kaarg).
- Pendências: tela New Character do Multiplayer (0,65), vídeos sem captura, seleção múltipla/grupos de teclas e inventário de aliados (sem referência), relevo/altitude, hall da fama, trilha do mapa, vozes das mensagens, save derivado druids_60 derruba o original.
- Usuário prefere: componentizar o que se repete (docs/PLAN.md); autorizou minimizar janelas nas capturas.

## Atualização (FIDELIDADE-MISSÃO concluída, 2026-10-19)
- Interfaces dentro da missão auditadas contra o original (guerreiro na 10, 20 sem seleção, mago na 10): HUD/ficha/minimapa/etiquetas, janela de mensagem única (`ui/msgwin.ts`, também na cidade), Drop money (`ui/numdialog.ts`, duplo clique), Pause, End Quest, derrota, mochila, livro de magias, bars/texto de dano, cursores, Quest Objectives, Sound Options. SSIM da interface (ROI) dos 44 cenários medidos antes e depois: 0,760 → 0,922 (docs/COMPARE/fidelidade-missao.md); cidade: falas 0,92 → 0,96–0,97. Carroça de Plagat e taverneiro de Kaarg resolvidos (ritmo medido).
- Pendências: relevo/altitude (herói 12–47 px mais alto no original; SSIM da tela inteira ~0,82), iluminação do terreno, autocast do mago, efeitos de magia além do Shield, tela de vitória (estimada), missões 30+ sem estado de referência no original (saves derivados sem Igles falham). Detalhes em docs/GAPS.md [MISSÃO-FIDELIDADE].
- Para refazer: `python tools/refcap/mission_specs.py`, `python tools/refcap/original/run_mission.py` (por --state), `python tools/refcap/run_all.py --only <ids> -- --out docs/COMPARE/mission --shift 0`. Suíte: sim 1675 ok, script 49, campaign 65, missions 46/0 exceções.

## Atualização (2026-10-19, 2)
- Concluídos desde a anterior: FIDELIDADE-MISSÃO (interfaces em jogo; SSIM interface 0,76→0,92), RELEVO (altitude: notes/altitude.md; SSIM tela inteira m10 0,94, m20 0,89–0,92), VOZES (missões não têm voz no original; cidade/taverna/lojas sim, notes/voices.md), FIDELIDADE-RESTO (Multiplayer New Character, fórmula do hall da fama, trilha do mapa, vídeos), LIGAÇÕES (hall stats na MissionScene, vozes da loja). Suíte: sim 56 arquivos-ok + relief, script 49, campaign 78, missions 46/0 exceções.
- Em andamento: CAMPANHA-E2E (teste headless da campanha inteira + trecho real no navegador).
- Pendências: vídeos Teleport/stars/crown/knights/druids sem captura (exigem vencer missões no original), tela de vitória/aura Shield/efeitos de magia estimados, iluminação por hora do dia do relevo, autocast do mago, seleção múltipla/grupos de teclas e inventário de aliados (sem referência), DirectPlay do Multiplayer.
