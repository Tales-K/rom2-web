# Capturas de referência do jogo ORIGINAL (frente REF-ORIGINAL)

Scripts em `tools/refcap/original/`. Python: `.venv\Scripts\python.exe`. Saída: `refs/original/<id>.png` (área cliente 1024x768)
+ `refs/original/meta.json` (como cada estado foi alcançado). Biblioteca de estados: `refs/original/saves/` + `index.json`.

## Por que o jogo foi para tela cheia (e como foi evitado)
`-window` só pula o SetDisplayMode final (exe 0x4815ec). Antes disso a inicialização de vídeo (0x45293c) faz
SetCooperativeLevel(NORMAL), cria a superfície primária e lê o formato de pixel (0x4531fc), guardando as máscaras R/G/B em
**WORDs**. Num desktop de 32 bpp a máscara vermelha 0x00FF0000 vira 0, e o jogo cai em 0x453036 =
SetCooperativeLevel(EXCLUSIVE|FULLSCREEN 0x11) + SetDisplayMode(1024,768,16). Ou seja, `-window` só funciona com o desktop em
16 bpp, que não existe no Windows 11. Não há registro, INI ou -cfg que mude isso.

**Solução:** uma cópia de execução em `C:\Users\TALES K\Games\a2_run` (criada por `setup_runtime.py`) com o **dgVoodoo2 2.87.5**
(`DDraw.dll` x86, configurado com `FullScreenMode=false`, `AppControlledScreenMode=false`, `dgVoodooWatermark=false`,
`CaptureMouse=false`). Ele emula o DirectDraw inteiro numa janela sem borda de 1024x768, e o modo do monitor não muda. Além
disso, `launch.Game` grava o modo do monitor (EnumDisplaySettings) e roda um vigia a cada 100 ms. Se o modo mudar, se a janela
ficar em tela cheia ou se passar do tempo máximo, o vigia mata o processo e restaura o modo. O `finally` sempre mata todo
allods2.exe e restaura o modo se ele tiver mudado.

**Correção na cópia (o GOG fica intocado):** o exe lê `HKLM\SOFTWARE\Rage of Mages 2\INSTALLDIR` e faz SetCurrentDirectory nele
(0x480f12), o que mandaria saves/famehall.dat para C:\GOG Games. Na cópia, o nome do valor foi trocado para `INSTALLDIX`
(offset de arquivo 0x1f0b34). Com isso a consulta falha e o jogo usa o diretório de a2_run. O registro só é LIDO (não grava nada:
as opções vivem no save). A pasta GOG foi conferida igual ao backup (`C:\Users\TALES K\Games\_a2_backup`).

## Como rodar
```
python setup_runtime.py                    # uma vez (copia o jogo, dgVoodoo2, correção INSTALLDIR)
python run_scenarios.py                    # todas as execuções; --runs front,shop,briefing,combat,kaarg,druids
python build_states.py                     # (re)gera a biblioteca de saves
python load_state.py kaarg_30 --shot x.png # abre o jogo num estado (~7 s) e captura
python probe.py --out DIR --steps "flow:menu flow:town click:359,513 wait:2 shot:a"   # exploração
```
Módulos: `launch.py` (processo, janela, vigia), `capture.py` (BitBlt da tela; grab_sequence), `input.py` (SendInput, só com a
janela do jogo em primeiro plano e dentro da área cliente), `flows.py` (navegação com assinaturas de tela em `sigs/`, dicas,
diálogos, posição de unidades na tela), `states.py`/`load_state.py`/`build_states.py` (biblioteca), `memory.py`
(Read/WriteProcessMemory).

## Armadilhas
- A janela TEM de ficar em (0,0): o jogo pensa que está em tela cheia e usa GetCursorPos (coordenadas de tela) para o cursor
  e para o hover.
- O cursor é desenhado pelo próprio jogo (por software) e já sai na captura. Não use `draw_cursor`.
- Menus, cidade, taverna e loja em -1024 são a arte 640x480 **centralizada** (deslocamento 192,144, **sem escala**). Só a missão
  usa 1024 (painel direito de ~176 px: minimapa, comandos, retrato de corpo inteiro, ficha de atributos). Não há barra inferior.
- Janelas de dica ("Show tips next time") aparecem a cada tela: `flows.close_tip` procura o botão CLOSE (`sigs/btn_close.png`).
- A missão 10 só fica disponível depois de falar com o mensageiro (3º cartão da taverna de Plagat). O portão então mostra o
  mapa Uimoir (animação de ~2,5 s) e entra direto na missão, **sem tela de briefing**. O "briefing" capturado é Esc → Quest
  Objectives.
- Ao entrar numa missão o jogo grava `game9998.sav` (voltar à cidade) e `game9999.sav` (reiniciar). `states.install` move
  todos os game*.sav de a2_run para `a2_run/_parked/` antes de carregar.
- Keypad+/- muda a velocidade (0..8) e deixa mensagens no canto. BACKSPACE as apaga.

## Biblioteca de estados (`refs/original/saves/index.json`)
| nome | como | tela |
|---|---|---|
| plagat_start | New Game, guerreiro padrão "Aldor", cidade de Plagat | town |
| m10_start | taverna → mensageiro → portão → missão 10, falas fechadas | mission_hud |
| kaarg_30 | derivado de plagat_start: estágio 30, locais [Kaarg, 30, 31], 10/20 concluídas | Kaarg |
| druids_60 | derivado: estágio 60, locais [druidas, Kaarg, 60, 70], 10..50 concluídas | acampamento |
Carregar = único save em a2_run + menu Load Game → 1ª linha (500,304) → Ok (389,523).
**Save derivado (`states.derive_save`)**: o bloco do Scenario.dll no save é `vars[1024]` | lojas 4x4x20 B | n | n x
{id, type, x, y, x, y} | índice do local atual (DLL ScenarioSave 0x10003585 / Load 0x10003686). O loader só usa (type, id).
Para mudar a cidade, troque a lista e o índice. Mudar só o ponteiro do local atual na memória **não** basta: o save grava o
índice dentro da lista disponível. Mudar o tamanho da lista funcionou (o bloco é lido em sequência). Índices úteis:
`vars[768]` estágio, `vars[896+M]` missão M concluída, `[512+i]/[532+i]/[552+i]` mercenários (notes/campaign.md).

## Memória (`memory.py`, `KNOWN`, `CU`, `HI`)
- exe sem relocações (base 0x400000). Base do Scenario.dll = `[0x62729c]` − 0x1cfd (ponteiro de ScenarioGetVar). `vars` =
  base+0x36028; local atual = `[base+0x37560]` → Location {+0 type, +4 id}; lista disponível em base+0x35f90.
- Unidade CLIENTE (o que o mapa e o HUD desenham): vtable **0x5cd5d0**. +8/+0xC x,y ×256 (células); +0x104 vida (i16);
  +0x108 vida máx.; +0x148/+0x14A mana; +0x144..0x147 bytes Body, Mind, Spirit, Agility. `client_units()` lista todas pelo
  vtable (pos, vida, atributos).
- Ficha SERVIDOR do herói: vtable **0x5d0fb8**. +0x84 Body, +0x86 Agility, +0x88 Mind, +0x8A Spirit (i16), +0x94 vida,
  +0x96 vida máx., +0x9A/+0x9C mana. É copiada para a unidade cliente (exe 0x469a25..) só quando há um evento de vida. Por isso
  o herói ferido foi feito assim: 1º dano real, depois escrita de +0x94 = máx/2. Escrever direto na unidade cliente não
  redesenha o HUD.
- Posição na tela: barra de vida verde (24x2 px) do herói selecionado, com o centro do corpo +21 px abaixo, e 32 px por
  célula (`flows.hero_screen`, `cell_to_screen`; ignora a altitude).

## Fatos do original que divergem do nosso (para as outras frentes)
Ouro inicial 1000 (nosso: 300). Herói parado fica **estático** por 3 s (de costas, capa laranja); só as árvores balançam
(ciclo de ~1,7 s). Vida inicial do guerreiro 142/142, XP 7320. A taverna de Plagat no estágio 10 já tem mercenários
(besteiro) e seleciona o 1º frequentador. Passar o mouse sobre um monstro mostra o retrato e o nome dele no painel. A barra de
vida de unidade é verde, com o resto cinza e as pontas escuras. Mapa-múndi: Uimoir é uma animação automática; Yases mostra
título e descrição no topo.

## Captura em 19/10 (frente CAPTURAS-ORIGINAL): janela invisível, minimizar janelas, novos executores

- **A janela do jogo ficava invisível para o BitBlt** (desde ~18:50 de 18/10; o BitBlt devolvia a área de trabalho/o app do Claude por baixo, PrintWindow
  preto). Causa: `PresentationModel = auto` do dgVoodoo.conf (escolhe um modelo flip que o DWM não entrega ao GDI neste Windows 11 + RTX 4070).
  Correção: **`PresentationModel = flip_discard`** em `a2_run\dgVoodoo.conf` (já gravado por `setup_runtime.py`, tabela CONF). OutputAPI/Adapters
  continuam `bestavailable`/`all` (backup do conf antigo em `C:\Users\TALES K\Games\dgVoodoo.conf.bak_bestavailable`). Não era janela do Claude por cima.
- **`winguard.py`**: `Game(hide_others=True)` (padrão) minimiza (SW_SHOWMINNOACTIVE) as janelas visíveis do usuário que cobrem (0,0,1024,768), guarda ordem Z,
  estado e janela em primeiro plano, e restaura em `close()` (finally) com SW_RESTORE de baixo para cima + foco devolvido; estado em
  `scratch/winguard_state.json` (`python winguard.py --restore` desfaz se o processo morrer). Nunca fecha nada. Autorizado pelo usuário só para as capturas.
- **`input.py`**: `backspace` virou tecla nomeada. **`flows.MENU_BTN`** corrigido (centroides de menu/hit.png).
- **`run_steps.py`** `<estado|new|menu> <pasta> "<passos>"`: explorador/gravador de passos (click/move/down/up/rel/key/type/seq/seqc recortado/grid/home);
  `grid` varre posições e guarda as telas que mudam. **`run_city.py`**: captura em lote os cenários com campo `orig` (gerados por
  `tools/refcap/city_specs.py`: hover/pressed de cada região das 3 cidades, falas + Ok, menu Esc, Save, Load, Sound Options, Abort, taverna, sequências).
  Reinicia a sessão se a tela não voltar ao "home". Cada grupo (estado, start) = uma sessão (~10–25 s por cenário).
- **Limite do estado `druids_60`**: clicar no taverneiro do acampamento mostra a 1ª fala e **derruba o allods2.exe (0xC0000005)** ao fechar a fala; entrar na
  taverna também derrubou numa tentativa. É um artefato do save derivado (vars do estágio 60 não decodificadas), não do harness.
- Capturas em sequência: `capture.grab_sequence` a cada 100 ms entrega 1 amostra por 100 ms (as animações da cidade avançam 1 ou 2 quadros por amostra).

## Missão dentro do original (frente FIDELIDADE-MISSÃO, 19/10)
- **Estados novos** (refs/original/saves): `m20_town` (derivado de plagat_start: estágio 20, vars[906]=1 [missão 10 concluída] e vars[769]=1 [o guarda deixa sair], locais [Plagat, missão 20]) → clicar no portão (393,299) entra DIRETO na missão 20 (sem mapa); `m20_start` (falas fechadas; construído por `build_m20.py`, que passa `in_mission=True` a `states.save_state` porque a missão 20 começa sem seleção e a barra de comandos é a "Heads", então a assinatura `mission_hud` falha); `plagat_mage`/`m10_mage` (Gildarius; `build_mage.py`, mensageiro no 3º cartão como no guerreiro). **Missões 30+ derivadas não servem**: sem Igles (10002) o script dá "Can't resolve hero 10002" e o exe abre uma caixa de erro (derruba a captura). Salvar uma missão derivada da cidade falha se o menu Esc for achado pelo HUD: use `in_mission=True`.
- **Executores**: `run_mission.py` (cenários com `mission` + `orig` de scenarios.json; passos click/rclick/dblclick/drag/move/key/type/wait; `start: gate` clica no portão e espera a 1ª fala, uma sessão por cenário; compara painel e barra de inventário com a tela "home" (mouse em 700,700) e reinicia a sessão se não voltou); `run_combat.py` (leva o herói a 7 células da cobra (27.5,42.5) como `run_scenarios.run_combat` e grava a luta a cada 100 ms: `--out refs/original --prefix m10_fight_seq --full --frames 40`); `run_defeat.py` (ataca a cobra e zera a vida da ficha do servidor, `info+0x94 = 0`; a janela "Mission Failed" aparece ~3 s depois). Tudo ~12–120 s por sessão.
- **Comportamentos do original descobertos**: Pause = janela "Game paused. Click OK to continue."; **o "Drop money" abre com DUPLO CLIQUE no ouro da barra de inventário** (arrastar o ouro para o mapa, para a boneca ou para outra célula não faz nada; o campo abre com "0" e o cursor antes dele: digitar 250 dá "2500"); a chave no canto inferior direito da moldura oval = "Main Menu <ESC>"; Esc → End Quest abre a janela "Victory! (desabilitado) / Exit to Main Menu / Exit to Windows / Return to Game" e Exit to Main Menu sai direto; clicar numa unidade hostil mostra só o nome no painel; botão direito desseleciona; barras só na unidade própria selecionada; com a magia escolhida o cursor de magia só aparece sobre alvo válido; mago começa com Shield (autocast) e 99/99 de mana; o minimapa é 2 px por célula (células 8..w-8) e o hover de `Shield` mostra a descrição inteira cortada na borda do painel.
- **Armadilhas**: com `grid` do run_steps toda posição "muda a tela" porque a etiqueta aparece junto do cursor; para achar a região de cada dica use o hash do conteúdo da caixa (ver `scratch/fm/hintscan.py` neste trabalho: caixa = filete a57931). `Pause` só funciona como tecla nomeada `pause` (VK 0x13).

## Frente FIDELIDADE-RESTO (19/10): lote por grupos, vídeos, depuração
- **`tools/refcap/original/run_groups.py --group <g>`**: cenários com `orig_group`/`orig_start`/`orig_pre`/`orig_steps`(/`orig_seq`/`orig_install`) em scenarios.json rodam numa só sessão; se o jogo cair, registra `crash` em meta.json e reabre a sessão (feito para o mapa-múndi: o hover na bandeira da missão 10 derruba o exe). Geradores: `multi_specs.py` (Multiplayer), `map_specs.py` (+ `original/build_map_states.py`: estados `kaarg_all`/`druids_all`), `druid_specs.py` (taverna druida; `rawVars` no nosso lado).
- **Vídeos capturáveis**: o BitBlt entrega os Smacker (a correção `PresentationModel=flip_discard` basta). Tamanho natural centrado (640×360 em (192,204); logos 640×480 em (192,144)); ordem Monolith → Nival → abertura; qualquer tecla/clique → menu. Registro de cutscenes liberadas = HKLM (global).
- **`crashdbg.py <estado> "<passos>"`**: depurador mínimo (DebugActiveProcess por ctypes) que imprime EIP/registradores/ebp da violação de acesso; `probe_hall.py`: lê o objeto do hall (janela principal +0x598, vtable 0x5ce0d8). Desmontagem: scratch/re/x86.py (capstone + pefile sobre a2_run/allods2.exe).
- **Armadilhas novas**: o Accept da etapa B do Multiplayer cria `<n>.a2c` em a2_run e depois abre "Windows Features / DirectPlay" (travando o jogo; fechar com taskkill do allods2 e do Fondue.exe e `winguard.py --restore`; NÃO ativar a feature). Sem `.a2c` o loader abre em "New Character"; com um, em "Nome|Clã". Em druids_60 não clicar na taverna em (339,376) (cursor na faixa dos frequentadores = queda); usar (352,336).
