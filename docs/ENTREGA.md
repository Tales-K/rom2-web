# Entrega — fatia vertical "até a missão 1"

Rework web de Rage of Mages II / Allods 2 (1999) em TypeScript + PixiJS. Estado em 2026-10-18.

## Como rodar
```
tools/build_all.sh              # (Git Bash) gera assets e dados em game/public/ a partir do jogo instalado; demora (vídeo, música, falas)
cd game && npm install && npm run dev      # http://127.0.0.1:5173/  — clique na tela inicial para liberar áudio/vídeo
```
Checagens: `cd game && npm run typecheck`, `npm run test:script` (49 verificações do motor de script), `npm run test:sim` (27 da missão 10), `npm run build`.
Atalhos de desenvolvimento: `#cena=menu|chargen|town|inn|shop|briefing|globalmap|credits|mission&mission=10`; no console `game.go("cena")`.
Observação: com a aba do navegador oculta o PixiJS não renderiza (traga a aba para frente ao testar).

## O que o jogador percorre (testado no navegador com cliques reais)
1. **Logos** (Nival, publicadora) e **vídeo de abertura**, puláveis (Esc/clique), com som.
2. **Menu principal** com a arte original (disco de pedra), música "menu", teclado e confirmação de saída; Carregar/Continuar, Créditos.
3. **Criação de personagem** (4 retratos: guerreiro/guerreira/maga/mago; dificuldade; nome; arma ou esfera com habilidade inicial 20; atributos com pontos livres), música "chrgen".
4. **Plagat** (cidade original, música própria): taverna, loja, portão para o mapa-múndi, estátua/Esc (salvar, menu).
5. **Taverna**: o mensageiro de Skrakan oferece a missão 10 (falas e **vozes** originais); mercenários.
6. **Loja**: comprar, vender, mesa de trocas, equipar; itens reais de `data.bin`.
7. **Briefing** e **mapa-múndi**.
8. **Missão 10 "Great Mage Skrakan"**: mapa, objetos, unidades animadas, neblina, HUD original, controle do herói, combate com as fórmulas do `allods2.exe`, magias básicas, script da missão (mensagens, subobjetivos, diplomacia, vitória/falha) e tela de resultado; volta à cidade com o progresso salvo (missão 20 liberada).

## O que foi decifrado para isso (detalhes em `notes/`)
Contêineres `.res`; sprites `.256/.16a`; bancos `.reg`; mapas `.alm` completos (terreno, objetos, estruturas, unidades com id/grupo/direção, bolsas, placas, música) e o **script das missões** (46 missões, referências resolvidas); `data/world/data.bin` inteiro
(unidades, itens, magias, classes) e as regras de combate lidas do executável; Smacker→mp4 e WAV→ogg.

## Pacotes baixados (todos registrados em `docs/DOWNLOADS.md`)
PyPI no `.venv` do projeto: pillow, numpy, pefile, capstone, pip (ensurepip), imageio-ffmpeg. npm em `game/`: pixi.js, vite, typescript, tsx. Nada foi instalado no sistema; nada do jogo foi executado.

## Limitações conhecidas (lista completa em `docs/GAPS.md`)
- Só a missão 10 foi jogada ponta a ponta; as outras 45 carregam no motor de script (teste de fumaça), mas não foram testadas em jogo.
- Ogro e troll jovem derrotam um herói inicial no 1×1 (fórmulas e níveis do original; o script os trata como opcionais).
- Ritmo (tiques/s), período do ciclo de gatilhos e magias de área/monstros conjuradores: aproximados. Altitude e relevo ignorados; unidades grandes ocupam 1 célula.
- Mensagens do script pausam o jogo e não têm áudio (não existem arquivos de fala para elas).
- Layout de algumas telas (segunda etapa do criador de personagem, posição das missões no mapa-múndi, HUD empilhado) é nosso, não o original.
- Fontes bitmap: só a `font4` foi decifrada; textos em inglês (a fonte não tem acentos).
- Direção real das unidades (rumo da bússola de cada coluna do sprite) e `period` dos gatilhos não confirmados.

## Aviso legal
`game/public/assets` e `game/public/data` contêm material do jogo original e são gerados localmente a partir da cópia instalada; **não redistribua**. O projeto distribui apenas código, notas e ferramentas.

## Próximos passos sugeridos
Jogar e ajustar as missões 20+ no motor; áudio/diálogo das mensagens (talvez TTS ou legendas com duração); animação/relevo; magias de monstros e área; mapa-múndi fiel; multijogador; empacotar o build com cache e compressão (o `dist` tem ~170 MB de assets).
