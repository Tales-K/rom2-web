# Retomar FIDELIDADE-CIDADE (cidade, taverna, loja, mapa-múndi)

## Pronto (typecheck limpo)
- Cidade (TownScene, ids town_tip/default/hover_inn/hover_shop/kaarg/druids): frame640, sem ouro/título/caixa de dica/"Esc: menu"; janela de dica
  (ui/tipwin.ts, "Show tips next time" em localStorage), etiqueta pequena junto do cursor, figurantes de Plagat (carroça, mulher, dervixe,
  lojista, porta da taverna com hover, guardas, grade do portão fechada em repouso, pássaros + primeiro plano) via tools/pipeline/town.py
  (PLAGAT_AMBIENT, FIXED_POS para druidas/Kaarg). SSIM ~0,99. Plagat/Kaarg ok; druidas: falta "bug" (183 quadros 640x268, posição não achada).
- Taverna (InnScene, ids inn_tip/default/messenger/messenger_talk/kaarg/druids): layout original, ficha font2 (herosheet.ts `inn`), bonecas
  (buildDoll), cartões 176+48i/y416 com seleção clara/escura, botões y=44+48i, janela de conversa ui/talkwin.ts. SSIM 0,93-0,94.
  Pendente: dano de mago (21-43 = dano de magia), moldura direita (ruído), fonte do texto da conversa, 4º cartão em Kaarg (estado do save).
- Recipes/scenarios: tools/refcap/scenarios.json e ours/recipes.mjs já têm todos os ids (campaignAt/enterTown/enterInn).

## Falta
- ShopScene (shop_tip, shop_default, shop_kaarg, shop_druids): NÃO começado (ainda 1024/escala antiga). Geometria medida (640x480):
  inv (0,0); frame (164,0); cena (169,8); menu (464,0); mesa (0,303) slots x=32+80i,y~307; invframe (0,390), células x=32+80i,y=396 (1ª = dinheiro);
  grade 2x3 ícones 80x80 em (1+80c, 32+80r), canto sup. dir = peso (tab cell_shop), inf. esq = quantidade; setas shoparrow4 (46,271)/arrow1 (46,0);
  oval do herói (480,238) = inn left_picture + olho (608,242) + gemas; plaquetas Undo/Buy/Sell/Exit (labels main 72/70/71/73, dicas 68/66/67/69);
  dica em (165,170) 304x127. Rótulos 60-65,74 = dicas de mouse. Sem abas nem painel de info. Exportar no pipeline: shoparrow1-4, shopbutton1-4, invframe, backinv.
- GlobalMapScene (globalmap, globalmap_seq, globalmap_kaarg, globalmap_druids): frame640, tirar "Return to town", rótulos/bandeiras, viagem 2,5 s.
- BriefingScene, CreditsScene: frame640. Menus Load/Save/Options da cidade: sem captura (registrar em GAPS).
- docs/GAPS.md: registrar decisões (dica a cada entrada, "Mercenary"+tipo no título da ficha, Undo=limpar mesa, bugs dos druidas, Esc na cidade sem captura).
- (FIDELIDADE-CIDADE-2 concluiu loja, mapa-múndi, briefing, créditos; ver docs/GAPS.md)

## Comandos
cd game && npm run typecheck   (erros em MissionScene.ts são de outra frente)
.venv\Scripts\python.exe tools/pipeline/town.py --only town,inn,shop
.venv\Scripts\python.exe tools/refcap/run_all.py --only town_default,inn_default,shop_default  -> docs/COMPARE/<id>.png
