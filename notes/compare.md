# Comparação automática original × nosso (`tools/refcap`)

## Como rodar

```
# fluxo completo: captura o nosso jogo + compara com o que houver em refs/original + escreve o relatório
.venv\Scripts\python.exe tools/refcap/run_all.py                 # todos os cenários
.venv\Scripts\python.exe tools/refcap/run_all.py --only menu_main,mission10_idle
.venv\Scripts\python.exe tools/refcap/run_all.py --skip-capture  # só compara (refs/ours como está)
.venv\Scripts\python.exe tools/refcap/run_all.py -- --shift 0 --de 15   # opções extras para o compare.py

# partes separadas
node tools/refcap/ours/capture.mjs [--only ids] [--headful] [--realtime] [--list]
.venv\Scripts\python.exe tools/refcap/compare.py [--only ids] [--render-missing]
.venv\Scripts\python.exe tools/refcap/test_compare.py --real     # validação do comparador
```

Pré-requisitos: o Vite já rodando em `http://127.0.0.1:5173/` (o script não o inicia nem o reinicia), Node 18+,
`npm install` feito uma vez em `tools/refcap/ours` (puppeteer-core 24.43.1, ver `docs/DOWNLOADS.md`) e o Chrome ou Edge
instalados (caminhos padrão de Program Files; outro: `--browser` ou a variável `REFCAP_BROWSER`).

Saídas:
- `refs/ours/<id>.png` (1024×768, DPR 1) ou `<id>_000.png…` (sequências) + `refs/ours/<id>.json` (mouse, cursor, cena,
  avisos, versão do navegador) + `refs/ours/_capture.json` (resumo).
- `docs/COMPARE/report.md` (sumário por gravidade, itens acionáveis, achados do nosso lado, seção por cenário),
  `docs/COMPARE/report.json` (o mesmo em JSON) e `docs/COMPARE/<id>.png` (painéis + recortes).

## Captura do nosso jogo (`tools/refcap/ours/capture.mjs` + `recipes.mjs`)

- Chrome headless ("new") com WebGL por software (ANGLE/SwiftShader): resultado independe da GPU. Viewport 1024×768,
  `deviceScaleFactor` 1; o script confere que o canvas está em (0,0) com 1024×768 antes de começar.
- Herói: criado uma vez pela própria tela de criação (`ChargenScene.pickWin(1)` + `accept()`: guerreiro "Aldor");
  herói+progresso ficam em memória e são restaurados em `game.state` antes de cada cenário (não depende do formato do save).
- Cada cenário tem uma receita em `recipes.mjs` (troca de cena com `game.go`, espera `game.scenes` terminar, mouse por
  coordenadas do canvas, campos internos das cenas: `game.scenes.current.<campo>` e `window.__mission`).
  Missão: espera `__mission.ready`, fecha os diálogos (exceto `mission10_start`) e **pausa a simulação**
  (`userPaused`, sem a mensagem) para o estado não mudar; `mission10_idle` roda com a simulação ligada.
  Vida a 50% em `mission_hero_hurt`; cursores sobre terreno livre/célula bloqueada/inimigo/NPC achados pela grade do
  mundo; para inimigo/amigo o herói é **teleportado** para ~3 células do alvo (estado artificial, anotado no .json).
- Recarga do Vite (outra frente salvou um arquivo): detectada pela navegação do quadro principal; o cenário é repetido
  (até `--retries`, padrão 3).
- Cursor: na missão o cursor é desenhado no canvas (sai no PNG). Fora da missão o cursor temático é CSS e não sai em
  screenshots: ele é **composto** no PNG na posição do mouse (ponta do `url(...) x y`). Se o canvas estiver com cursor
  do sistema (`pointer`/`default`), nada é desenhado e o .json registra o aviso — isso já é uma divergência.
- Sequências: por padrão **tempo virtual** — `performance.now` é congelado e avançado `interval_ms` por quadro e o ticker
  do Pixi é avançado à mão (`app.ticker.update(t)`), então os 30 quadros cobrem exatamente 3 s mesmo com o WebGL lento.
  Animações baseadas em `setTimeout` não andam nesse modo; `--realtime` usa o relógio real (instantes no .json).
- Posições do mouse usadas (o original deve usar as mesmas): neutra 1012,756; "Novo jogo" 405,149; taverna = centro
  da região `inn` da máscara da cidade; missão = célula livre a ~4 células do herói (ver `mouse` no .json).

## Comparador (`tools/refcap/compare.py`)

1. **Alinhamento:** os dois lados em 1024×768 (tamanho diferente é reamostrado, com aviso); busca de deslocamento global
   inteiro em ±`--shift` (padrão 8 px; grosso a 1/4 e fino em resolução cheia), aplicado ao nosso.
2. **Diferença:** ΔE 1976 (Lab) por pixel e SSIM local (janela uniforme 9×9, luminância). Bloco de 4×4 px diverge se
   ΔE médio > `--de` (12) ou SSIM médio < `--ssim` (0,55). Blocos são dilatados, agrupados em componentes conexos e
   regiões a ≤ `--merge` px (12) são unidas; núcleos < `--min-area` px² (48) são descartados.
3. **Classificação** (nesta ordem):
   - `cursor`: região ≤ 64×64 junto da posição do mouse registrada em `refs/{ours,original}/<id>.json`;
   - `posicao deslocada`: busca de molde ±24 px — a maioria dos pixels divergentes passa a casar com um deslocamento
     (≥ 60% e +30 pontos sobre o deslocamento zero); ou par extra+faltando de mesmo tamanho e mesmo conteúdo;
   - `estilo/cor diferente`: bordas correlacionadas (> 0,45) nos dois lados → mesma forma, cor/brilho diferente;
   - `extra no nosso` / `faltando no nosso`: o lado cujo interior destoa do anel em volta (média/desvio em Lab;
     o anel é igual nos dois lados), ou o lado com muito mais energia de borda;
   - `estilo/forma diferente`: os dois têm conteúdo, estruturas diferentes (ex.: texto/arte trocados).
4. **Sequências:** fração de transições em que cada pixel muda (> 10 níveis); componentes animados de cada lado,
   quadros distintos por componente; `sem animacao onde o original anima` quando o nosso não tem atividade (≤ 15% do
   pico do original ou um único quadro distinto) numa área de +48 px em volta; o inverso vira `anima so no nosso`.
   Componentes junto do mouse são tratados como cursor. Sem original, o relatório descreve o que anima no nosso
   (ex.: "nada anima além do cursor").
5. **Gravidade** = % da tela × intensidade × peso da categoria (extra/faltando/sem animação 1,0; forma 0,8; cor 0,6;
   deslocada 0,5; cursor 0,35; animação ausente ×3). ALTA ≥ 1, média ≥ 0,2.
6. **Arquivo provável:** pelo prefixo do cenário (menu_→MenuScene.ts, town_→TownScene.ts…) e, na missão, pela posição
   (x ≥ 848 → `mission/hud.ts`; topo → `hud.say`; resto → `mission/view.ts`/`fog.ts`); a seção de cada cenário lista
   quantos candidatos a elementos inventados `docs/PROVENANCE.md` tem nesses arquivos.

Em toda execução o comparador avisa (stderr e relatório) quais cenários **não têm referência original**.

## Como interpretar

- Comece pelo **Sumário por gravidade** e pelos **Itens acionáveis** (verbo: REMOVER, ACRESCENTAR, REPOSICIONAR, TROCAR,
  ANIMAR). Confira a imagem `docs/COMPARE/<id>.png`: painéis ORIGINAL | NOSSO | DIFERENÇA (caixas numeradas, cor =
  categoria: vermelho extra, azul faltando, amarelo deslocada, roxo cor, rosa forma, cinza cursor, verde sem animação)
  e, embaixo, recortes ampliados original|nosso das 8 principais regiões.
- SSIM médio perto de 1 e poucas regiões = tela fiel. Uma tela inteira divergente (SSIM < 0,5) costuma significar
  estado diferente (outra cena, diálogo aberto, câmera em outro lugar) — confira o estado antes de mexer no código.
- "Achados da captura do nosso jogo" valem mesmo sem original (cursor do Windows, nada anima etc.).

## Limitações

- Heurística, não semântica: em fundos muito texturizados uma regiao "extra" pode sair como "estilo/forma"; texto
  diferente aparece como "estilo/forma". O verbo sugerido é ponto de partida, não diagnóstico.
- Estado tem de bater: câmera da missão, posição do herói, mouse, fase de animações (tochas, água) e névoa diferem
  entre as capturas → regiões espúrias. Por isso as missões são pausadas e as posições do mouse ficam no .json.
- O original roda em DirectDraw com paleta; nossa arte é WebP (q92/95, PSNR 31–40 dB) e reescalada 1,6× em várias
  telas: o limiar ΔE 12 ignora esse ruído, mas bordas de texto podem acusar pequenas regiões.
- Sequências no tempo virtual não avançam animações por `setTimeout`/`setInterval`.
- Teleporte do herói nos cenários de cursor sobre inimigo/amigo; o original precisa mostrar situação equivalente.
- Ver também a entrada [REF-NOSSO] em docs/GAPS.md.


## Cenários genéricos (hover, pressed, janelas) — frente FIDELIDADE-MENU

Cenário **sem receita** em `ours/recipes.mjs` que tenha o campo `scene` usa a receita genérica (`genericRecipe`): `scene`/`scene_params`
(cena do jogo), `setup` (JS com `sc` = cena atual), `saves: n` / `nosave: true` (saves no localStorage antes de abrir a cena),
`click_before: [[x,y],...]` (cliques reais), **`mouse: [x,y]`** (ação de mover o mouse, pixels do cliente 1024×768) e `press: true`
(botão esquerdo apertado até a captura). O original é capturado com os MESMOS pontos por `tools/refcap/original/run_menu.py`
(`--phase menu_nosave|menu|load|load_many|load_nosave|chargen|chargen_b`), que lê `scenarios.json`; usa a trava `scratch/refcap.lock`
(uma instância do jogo por vez). Em paralelo com outras capturas: `REFCAP_PROFILE=<pasta>` dá um perfil de Chrome próprio ao
`capture.mjs`, e `compare.py --out <pasta>` evita sobrescrever `docs/COMPARE/report.*`.

## Campos novos dos cenários (19/10, frente CAPTURAS-ORIGINAL)

`enter` ("town" | "inn" | "shop") + `town` (1..3) + `campaign` ({done,town,stage}) abrem a cena no estado de campanha pedido (como `enterTown/enterInn`);
`pre` = passos em ordem (`["click",x,y]`, `["rclick",x,y]`, `["move",x,y]`, `["key","esc"|"enter"|"backspace"]`, `["type","txt"]`, `["wait",seg]`) executados
antes de `mouse`/`press`; `orig` = como capturar o ORIGINAL (`state`, `start`, `post`; lido por `tools/refcap/original/run_city.py`). Os cenários de cidade são
gerados por `tools/refcap/city_specs.py` (idempotente: reescreve só os ids dele). Receitas da missão: `mission_game_options|quest_objectives|sound_options`
(Esc na missão 10 + clique no item).

## SSIM da interface (`roi`, FIDELIDADE-MISSÃO 19/10)
Cada cenário de scenarios.json pode ter `roi: [x0,y0,x1,y1]`: o `compare.py` calcula o SSIM médio SÓ dentro dessa caixa, sobre as imagens originais SEM o deslocamento global (a interface é ancorada na tela) e o grava em `report.json` (`ssim_roi`, `roi`) e na seção do cenário em `report.md`. Use para medir interface quando o fundo (mapa/altitude) não bate. Campos novos de cenário de missão (`tools/refcap/mission_specs.py`): `mission` (id da missão aberta por `startMission`), `keep_dialogs`, `deselect`, `live` (não pausa a simulação), `hero: "mage"` (herói mago "Gildarius"), passos `dblclick`/`drag`/tecla `pause`. Sequências com original capturado por outro script ficam sem `orig` e com `orig_by`. Executar: `python tools/refcap/mission_specs.py && python tools/refcap/original/run_mission.py [--state m10_start|m20_start|m20_town|m10_mage]` e `python tools/refcap/run_all.py --only <ids> -- --out docs/COMPARE/mission --shift 0`.
