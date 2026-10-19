# Roteiro até o fim do jogo

Pedido do usuário (2026-10-18): fechar o que faltou da fase 1 (menu de carregar, sprites corrigidos, UI da cidade **idêntica** ao original), depois segunda cidade e
segunda missão completas, lojas, itens, bolsa, menu Esc dentro do jogo (também nas missões), salvar e carregar, sprites animados como no original (inclusive parado/idle),
comportamentos automáticos (IA, auto-ataque, auto-magia...), e seguir de cidade em cidade e mapa em mapa até o fim.

## Fase 1 — fechar (em andamento)
- SPRITES-RE: decodificador `.16a`/`.256` especiais; cursores e bandeiras corretos.
- HUD-FIDELIDADE: retrato, barras de vida/mana, herói parado animado, elementos inventados removidos.
- REF-ORIGINAL / REF-NOSSO: captura do original por script (atalhos `-window -map -name`, saves, memória) e comparação automática (`tools/refcap/`, `docs/COMPARE/`).
- Onda A (próxima): CAMPANHA-RE (estrutura da campanha) e SAVE/LOAD (slots, Esc em qualquer cena, carregar).
- Onda B: UI fiel ao original guiada pelo relatório de comparação (menu, criação, cidade, taverna, loja, briefing, mapa-múndi) e Kaarg como segunda cidade.

## Fase 2 — segunda cidade e segunda missão
Missão 20 ("The Road to Kaarg") jogável do início ao fim; cidade de Kaarg (arte `*_kaarg`), loja e taverna com os NPCs/missões reais; itens, bolsa/inventário completos,
magias, mercenários; Esc em missão (salvar/carregar/reiniciar/sair); animações de unidade (andar, atacar, morrer, parado/idle), objetos e estruturas; IA automática.

## Fase 3 — campanha inteira
Para cada cidade (Plagat, Kaarg, bosque dos druidas, ...) e cada missão (46 `.alm`): rodar o motor, corrigir ações de script/unidades/magias ainda não suportadas,
testar com piloto automático (`npm run test:sim`), comparar com o original quando possível, registrar lacunas em `docs/GAPS.md`.

## Regras de operação
- Ondas de agentes com donos de arquivo disjuntos (`docs/PLAN.md`); um agente por área de código por vez.
- Todo agente termina com typecheck + testes; o orquestrador integra, testa no navegador e atualiza este roteiro.
- Verdade de referência: o jogo original rodado por script (`tools/refcap/original/`), dados decifrados (`notes/`, `docs/DATA.md`) e o executável (leitura estática).
