# Procedencia visual — candidatos a elementos inventados

Gerado por `python tools/audit_provenance.py`. Cada linha e algo que o nosso codigo desenha/escreve em vez de usar um bitmap ou texto do jogo.
Revisar contra o original; o que nao existir la deve ser removido ou trocado pelo bitmap original.

Resumo: 70 ocorrencias em 19 arquivos.

## `game/src/core/video.ts` (2)

- L29 — elemento DOM: `const v = document.createElement("video");`
- L45 — elemento DOM: `const v = this.preloaded.get(name) ?? document.createElement("video");`

## `game/src/mission/fog.ts` (1)

- L22 — elemento DOM: `this.canvas = document.createElement("canvas");`

## `game/src/mission/hud.ts` (19)

- L46 — forma desenhada (Graphics): `private mmDots = new Graphics();`
- L49 — forma desenhada (Graphics): `private cmdHighlight = new Graphics();`
- L54 — forma desenhada (Graphics): `private heroBars = new Graphics();`
- L81 — forma desenhada (Graphics): `const bg = new Graphics().rect(0, 0, SCREEN_W - PANEL_X, SCREEN_H).fill(0x1a140c);`
- L100 — forma desenhada (Graphics): `const hit = new Graphics().rect(0, 0, 38, 38).fill({ color: 0xffffff, alpha: 0.001 });`
- L148 — elemento DOM: `const cv = document.createElement("canvas");`
- L225 — forma desenhada (Graphics): `const bg = new Graphics().rect(0, 0, 34, 34).fill(0x101820).stroke({ color: s.id === active ? 0xffd84a : 0x806`
- L252 — forma desenhada (Graphics): `const bg = new Graphics()`
- L262 — texto literal (makeText): `const hint = makeText("click or Space to continue", { size: 11, color: 0x9a8c6e });`
- L295 — forma desenhada (Graphics): `const dim = new Graphics().rect(0, 0, SCREEN_W, SCREEN_H).fill({ color: 0x000000, alpha: 0.55 });`
- L297 — forma desenhada (Graphics): `const box = new Graphics().roundRect(0, 0, 320, 280, 8).fill(0x1d1912).stroke({ color: 0xd8a24a, width: 2 });`
- L299 — texto literal (makeText): `const title = makeText("Game Menu", { size: 24, color: 0xd8a24a, bold: true });`
- L314 — forma desenhada (Graphics): `const box = new Graphics().roundRect(0, 0, W, H, 8).fill({ color: 0x15110b, alpha: 0.96 }).stroke({ color: 0xd`
- L317 — texto literal (makeText): `const t = makeText('Inventory - ${h.name}', { size: 18, color: 0xd8a24a, bold: true });`
- L324 — texto literal (makeText): `const eq = makeText("Equipment:\n" + (equipment.length ? equipment.map(([s, n]) => '  ${s}: ${n}').join("\n") `
- L327 — texto literal (makeText): `const head = makeText("Backpack (click to use):", { size: 13, color: 0xe8dcc0 });`
- L336 — texto literal (makeText): `if (!items.length) { const n = makeText("  (empty)", { size: 13, color: 0x9a8c6e }); n.position.set(x0 + 270, `
- L345 — forma desenhada (Graphics): `const dim = new Graphics().rect(0, 0, SCREEN_W, SCREEN_H).fill({ color: 0x000000, alpha: 0.7 });`
- L348 — forma desenhada (Graphics): `const box = new Graphics().roundRect(x0, y0, W, H, 10).fill(0x1d1912).stroke({ color: ok ? 0xd8a24a : 0xc04030`

## `game/src/mission/view.ts` (6)

- L156 — forma desenhada (Graphics): `const shadow = new Graphics();`
- L157 — forma desenhada (Graphics): `const ring = new Graphics();`
- L160 — forma desenhada (Graphics): `const bar = new Graphics();`
- L274 — forma desenhada (Graphics): `g = new Graphics();`
- L295 — forma desenhada (Graphics): `const g = new Graphics()`
- L340 — elemento DOM: `const cv = document.createElement("canvas");`

## `game/src/scenes/BootScene.ts` (2)

- L8 — forma desenhada (Graphics): `const bg = new Graphics().rect(0, 0, SCREEN_W, SCREEN_H).fill(0x000000);`
- L9 — texto literal (makeText): `const t = makeText("Allods 2 — rework web\n\nClique para começar", { size: 28, align: "center", color: 0xd8a24`

## `game/src/scenes/BriefingScene.ts` (2)

- L50 — forma desenhada (Graphics): `const frame = new Graphics().roundRect(104, 128, 220, 316, 8).fill({ color: 0x1a120a, alpha: 0.9 }).stroke({ c`
- L75 — forma desenhada (Graphics): `const glow = new Graphics().circle(918, 676, 50).fill({ color: 0xffe6a0, alpha: 0.28 });`

## `game/src/scenes/ChargenScene.ts` (3)

- L168 — forma desenhada (Graphics): `this.cover = new Graphics().rect(0, 0, SCREEN_W, SCREEN_H).fill(0x000000);`
- L266 — forma desenhada (Graphics): `const box = new Graphics().roundRect(100, 6, 368, 92, 8).fill({ color: 0x000000, alpha: 0.5 });`
- L381 — forma desenhada (Graphics): `this.plateHover = new Graphics(); B.addChild(this.plateHover);`

## `game/src/scenes/CreditsScene.ts` (1)

- L30 — forma desenhada (Graphics): `const bg = new Graphics().rect(0, 0, SCREEN_W, SCREEN_H).fill(0x000000);`

## `game/src/scenes/InnScene.ts` (2)

- L87 — forma desenhada (Graphics): `const bgFill = new Graphics().rect(0, 0, SCREEN_W, SCREEN_H).fill(0x0c0806);`
- L113 — forma desenhada (Graphics): `this.cardBox = new Graphics();`

## `game/src/scenes/IntroScene.ts` (1)

- L10 — forma desenhada (Graphics): `this.root.addChild(new Graphics().rect(0, 0, SCREEN_W, SCREEN_H).fill(0x000000));`

## `game/src/scenes/LogosScene.ts` (1)

- L15 — forma desenhada (Graphics): `this.root.addChild(new Graphics().rect(0, 0, SCREEN_W, SCREEN_H).fill(0x000000));`

## `game/src/scenes/MenuScene.ts` (3)

- L103 — texto literal (makeText): `const hint = makeText("Arrows / Enter / Esc", { size: 14, color: 0x8a7c60, stroke: 0x000000 });`
- L124 — forma desenhada (Graphics): `this.fade = new Graphics().rect(0, 0, SCREEN_W, SCREEN_H).fill(0x000000);`
- L209 — forma desenhada (Graphics): `const cover = new Graphics().rect(0, 0, SCREEN_W, SCREEN_H).fill(0x000000);`

## `game/src/scenes/MissionScene.ts` (5)

- L79 — forma desenhada (Graphics): `const bg = new Graphics().rect(0, 0, SCREEN_W, SCREEN_H).fill(0x000000);`
- L80 — texto literal (makeText): `const lt = makeText("Loading mission...", { size: 22, color: 0xd8a24a });`
- L123 — forma desenhada (Graphics): `const mask = new Graphics().rect(0, 0, VIEW_W, VIEW_H).fill(0xffffff);`
- L126 — forma desenhada (Graphics): `const hit = new Graphics().rect(0, 0, VIEW_W, VIEW_H).fill({ color: 0x000000, alpha: 0.001 });`
- L131 — forma desenhada (Graphics): `this.root.addChild(new Graphics().rect(0, 0, SCREEN_W, SCREEN_H).fill(0x000000), this.worldLayer, mask, hit);`

## `game/src/scenes/ShopScene.ts` (13)

- L61 — forma desenhada (Graphics): `private hotHili = new Graphics();`
- L286 — forma desenhada (Graphics): `const bg = new Graphics().roundRect(0, 0, w - 4, 28, 4).fill(s === this.shelf ? 0x6a4a22 : 0x2c1f10).stroke({ `
- L300 — forma desenhada (Graphics): `else { c.addChild(new Graphics().roundRect(0, 0, size, size, 6).fill(0x3a2a1a)); }`
- L332 — texto literal (makeText): `const price = makeText('${it.price}', { size: 14, color: GOLD, bold: true, stroke: 0x000000 });`
- L339 — texto literal (makeText): `if (!slice.length) { const t = makeText("(empty shelf)", { size: 16, color: 0x9a8c6e }); t.position.set(x0 + 8`
- L346 — forma desenhada (Graphics): `c.addChild(new Graphics().roundRect(0, 0, 20, 26, 3).fill(on ? 0x6a4a22 : 0x2a1e12).stroke({ color: on ? GOLD `
- L375 — texto literal (makeText): `if (e.left > 1) { const n = makeText('x${e.left}', { size: 14, color: 0xffffff, bold: true, stroke: 0x000000 }`
- L385 — forma desenhada (Graphics): `c.addChild(new Graphics().roundRect(0, 0, 28, 20, 3).fill(on ? 0x6a4a22 : 0x2a1e12).stroke({ color: on ? GOLD `
- L424 — texto literal (makeText): `const title = makeText('${hero.name}', { size: 18, color: GOLD, bold: true });`
- L432 — texto literal (makeText): `const l = makeText('${label}:', { size: 15, color: 0xb0a080 });`
- L454 — texto literal (makeText): `const w = makeText('Weight carried: ${Math.round(weight * 10) / 10}', { size: 14, color: 0xb0a080 });`
- L462 — forma desenhada (Graphics): `this.infoC.addChild(new Graphics().roundRect(x - 10, y - 6, 464, 190, 8).fill({ color: 0x000000, alpha: 0.35 }`
- L490 — forma desenhada (Graphics): `const hover = new Graphics().roundRect(0, 0, p.w, p.h, 6).fill({ color: 0xffd890, alpha: 0.18 });`

## `game/src/scenes/TownScene.ts` (1)

- L125 — texto literal (makeText): `const hint = makeText("Esc: menu", { size: 13, color: 0xb0a080 });`

## `game/src/town/common.ts` (4)

- L42 — forma desenhada (Graphics): `return new Graphics().rect(x, y, w, h).fill({ color, alpha });`
- L163 — forma desenhada (Graphics): `const bg = new Graphics().roundRect(0, 0, w, y, 10).fill({ color: 0x1c140c, alpha: 0.96 }).stroke({ color: 0xb`
- L220 — elemento DOM: `const cv = document.createElement("canvas");`
- L243 — texto literal (makeText): `const t = makeText("Loading...", { size: 24, color: 0x8a7c60 });`

## `game/src/ui/button.ts` (1)

- L7 — forma desenhada (Graphics): `const bg = new Graphics();`

## `game/src/ui/dialog.ts` (2)

- L24 — forma desenhada (Graphics): `const dim = new Graphics().rect(0, 0, SCREEN_W, SCREEN_H).fill({ color: 0x000000, alpha: 0.6 });`
- L33 — forma desenhada (Graphics): `const panel = new Graphics()`

## `game/src/ui/hitmap.ts` (1)

- L20 — elemento DOM: `const c = document.createElement("canvas");`



## Escola de Magia (cidade) — removida (FIDELIDADE-CIDADE-2)

- `TownScene.activate("trainer")` abria uma janela "The School is not open yet. Come back later." (texto e janela nossos). Removida: o clique na região 192 não faz nada. Pendente confirmar com o original (não executável aqui).
- Outras telas da cidade conferidas: taverna (`inn`), loja (`shop`), portão (mapa-múndi ou fala do guarda de Plagat, `plagatguard` do town.json), estátua (menu do jogo) e moradores falantes (town.json) existem no original; "Mission Failed"/"Back in Town" (`showFailure`) é nosso e fica até a campanha tratar a derrota sem janela.
- Loja: as mensagens "mesa cheia"/"sem dinheiro" (etiqueta do mouse) e a etiqueta com nome/preço/peso dos itens são nossas (o original mostra só os textos 54..74 de main.txt).
- Briefing (`BriefingScene`): o original não tem a tela (só a janela "Quest Objectives" da missão); mantida só para depuração, com o pergaminho `sheet.bmp`.

## Capturas de 19/10 (frente CAPTURAS-ORIGINAL) — novos recursos e origem

- `game/public/assets/ui/talk/npc90|91|92|93|94|97|99.webp` (retratos 88×108 das janelas de fala dos moradores): **recortados das capturas do jogo original**
  (`refs/original/town_*_talk_*.png`, posição (298,324) do cliente 1024×768) por `tools/pipeline/talk_portraits.py`. Motivo: os ids 90..99 de `campaign.json` não têm
  template/retrato, `graphics/interface/t_border.*` e `t_back.bmp` só trazem a moldura e o fundo, e a pintura da figura não foi achada como recurso isolado em
  `graphics.res`. Limite: dependem de `refs/original` ao regerar; trocar por recurso real se for localizado.
- `assets/ui/talk/border.webp` (t_border.256, moldura 88×108) e `back.webp` (t_back.bmp): extraídos de graphics/interface por `talk_portraits.py` (moldura/fundo dos
  retratos de boneca da taverna).
- `assets/ui/menu/hall.webp` (main/graphics/famehall/hall.bmp): fundo do Hall da Fama (`tools/pipeline/hall.py`). Lista padrão = `famehall.dat` da instalação limpa.
- `assets/ui/town/druids/anim/bug0|1.webp`: besouro do acampamento (town_druid/bug/sprites.16a, 183 quadros 640×268) em 2 voos recortados (`tools/pipeline/town.py`
  `build_bug`; posição (0,212) conferida por correlação com `scratch/cap2/c_druids`).
- Textos e geometria de Save/Sound Options/Game Options/View Cutscenes/diálogo do Server: medidos em `refs/original/town_save_*`, `town_sound_*`,
  `mission_game_options`, `menu_cutscenes`, `menu_server_dialog` (strings de dialogs.txt: 8, 11, 12, 14, 16..18, 165; "Retrieving server list from web page" e a URL
  `http://www.rageofimages.com/r2servers/text.asp` aparecem na captura).
- Fonte do Hall da Fama (`FameScene`): serifa negrito do sistema (o original usa uma fonte TrueType do Windows; Times New Roman é aproximação).

- [MISSÃO-FIDELIDADE 19/10] `game/public/assets/ui/inn/kaarg/anim_script.json`: **medido** no original (taverna de Kaarg, 300 quadros a 100 ms, run_steps seqc; casamento de cada quadro com os de `anim/taverner*.webp`) — é só um roteiro de índices, sem arte nova. `ui/msgwin.ts`/`ui/numdialog.ts`/`ui/hint.ts showScreen`/`mission/hud.ts` (dicas, minimapa, resultado) seguem medidas em refs/original/m10_*, m20_*, m10m_*, m10_defeat. Estimados (sem captura do original): aura do Shield (puffs `pr_62`, contagem/escala), tela de VITÓRIA ("Victory!"/"Exit to Main Menu"), cor do texto de dano para o herói ferido, pontos hostis do minimapa (vermelho), playlist da missão (b00..b03 em todas as missões).
