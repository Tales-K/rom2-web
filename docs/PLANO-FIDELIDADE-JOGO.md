# Plano de fidelidade do jogo inteiro (2026-10-31)

Objetivo: o jogo inteiro igual ao `allods2.exe` (não só as unidades), antes de qualquer trabalho de compressão ou multiplayer, que só
começam por decisão do usuário. Complementa `docs/ABORDAGEM-FIDELIDADE-UNIDADES.md` (comportamento das unidades), que segue como a
frente F2 abaixo.

## Regras para toda frente

1. **Comparar com o original antes de alterar.** Todo ponto (do usuário ou de um relatório) ganha evidência do original — captura,
   sonda de memória, oráculo ou o C do exe — registrada na nota antes da correção. Igual ao original → não muda, só registra.
2. **Medir antes e depois** com a ferramenta da frente; uma correção sem número de antes/depois não fecha.
3. **Uma sessão por elemento**, arquivos separados por frente (sim × apresentação) para rodar em paralelo sem conflito; o jogo real
   roda um de cada vez pela trava `scratch/refcap.lock`.
4. Cada frente termina com uma linha em `docs/GAPS.md`/`notes/` e um commit verificado; o coordenador faz o push.

## Estado de partida (levantamento de 2026-10-31)

| Elemento | Ferramenta de comparação | Estado |
|---|---|---|
| Menu, opções | cenários `menu_*`, overlay de cliques 100 % | visual verificado; a maioria das opções não tem efeito (#28) |
| Criação de personagem | 39 cenários `chargen_*` (SSIM ≥ 0,997) | verificado; mínimos e efeito da dificuldade estimados |
| Mapa global | 54 cenários `gm_*` | parcial (âncoras das bandeiras) |
| Cidades | 96 cenários `town_*` (SSIM médio 0,96) | quase; animações a mais/a menos, ritmo medido e não lido do exe, marca de hover |
| Taverna | `inn_*`, `inn_ssim.py` | parcial (taverna dos druidas, regra dos nomes) |
| Loja | `shop_*`, `shop_hit_compare.py` | parcial (clique × arrastar #14, rótulos, encantar #13/#15) |
| HUD da missão | 65 cenários (SSIM de região 0,76 → 0,92) | parcial (faixa de cabeças nossa #5, livro/olho #44, Tab #61; telas da missão fora do overlay de cliques) |
| Render do mapa | m10/m20 tela cheia (SSIM 0,90–0,95) | parcial (borda da névoa #27, ordem de desenho, altitude #26) |
| Sprites e animação | `units_audit.ts` (regra) | regras sim; sequências quadro a quadro não conferidas |
| Comportamento/combate | tickcmp 100,0/99,9/100,0 %, golden 79,4 %, loadcmp | verificado onde portado; partida real ainda usa carregador e atributos antigos |
| Visual das magias | `fxaudit.ts` (só a regra do sprite) | **não conferido** |
| Som e música | ganchos de áudio do `a2_audio`, `audio_triggers.json` | quase; música por região suposta |
| Vídeos, créditos, fama | `vid_*`, `credits_*`, `hall_of_fame*` | parcial (vários vídeos não comparados) |
| Salvar/carregar | visuais `*_save_*`/`load_*`, ida e volta do save | interface sim; formato e conteúdo (névoa) não |
| Scripts de missão | `test:script` com hospedeiro falso | **nunca conferido contra o original rodando** |
| Fluxo da campanha | `e2e.ts`, constantes do `Scenario.dll` | parcial (44/46 vitórias forçadas no teste) |

A linha de base visual é de 18–19/10 nos dois lados; tudo que mudou depois (porta do sim, correções de 28/10 e 31/10) não foi
re-capturado. A comparação de pixels (`tools/refcap/run_all.py`) roda à mão, fora do `npm` e do CI.

## Frentes, em ordem

### F0 — Linha de base nova (1 sessão; antes de F3–F7)
Rodar de novo `run_all.py` nos dois lados (440 cenários), pôr a comparação num script `npm run visualcmp` com relatório ordenado por
gravidade, e levar as telas da missão ao overlay de cliques (`overlay/compare.py`). Pronto quando: relatório novo em
`docs/COMPARE/`, lista ordenada das divergências por elemento em `notes/visual-baseline-2026-11.md`, e o script no repo.

### F1 — Rodadas de bugs do usuário (contínua)
Cada lista do usuário vira `notes/bugs-<data>.md` com veredito por ponto (diferente/igual ao original), em duas sessões: apresentação e
simulação. Rodada em curso: 31/10 (minimapa, saco de loot, velocidade, retrato no hover, hover nas cidades; orc/morcegos/troll da
fase 1).

### F2 — Combate na partida real (sequencial; frente do sim)
O que falta para a partida iniciada pelo nosso jogo ser igual, não só a importada:
1. 9b lotes 3+: carregador até 46/46 missões com tique 0 exato (colocação, `AI_GuardLoad`, MapRec).
2. Largar `syncCombat`: atributos pelo recálculo portado 0x51366b/0x5118be a cada tique (fecha o último tique do tickcmp e é
   candidato a "troll fácil"). **Feito no passo (06/11, `notes/largar-synccombat.md`)**: o exe só recalcula em eventos, e o mundo
   também; a porta vale nas unidades do carregador. Falta largar a ponte nas unidades do motor antigo: criar o herói pelo exe e portar
   a experiência 0x513128/0x5128cb.
3. Resto da 8b: áreas de dano, Fireball, Wall of Earth, Teleport, Summon, Animate Dead, Drain Life; dano de área em estruturas (#94).
4. Corrida livre longa: episódios do original **desde o tique 0** em mais missões (não só 10 e 20), comparados sem reimportar; o
   golden ganha janelas que começam na carga.
5. Formação do grupo (#25) contra o original.
Pronto quando: loadcmp 46/46, tickcmp livre ≥ 99 % em ≥ 6 missões, golden `--ci` verde e sem divergência nomeada do motor antigo.

**Estado da F2 em 2026-11-10** (`notes/largar-synccombat.md`; bateria: tickcmp `--all` e `--joins`, as 6 corridas longas, golden
`--ci`, loadcmp, test:sim, test:script):
- loadcmp 46/46 (com e sem MapRec): **cumprido**.
- golden `--ci` verde (80,75 %): **cumprido**.
- tickcmp livre ≥ 99 % em ≥ 6 missões: **5 de 6**. Sem divergência na corrida livre: 10 (6 episódios longos + m10_start/m10_mage),
  20 (m20_start), 31, 50 e 70 (episódios da junção, 2400 tiques). Fora: m30 (2037/2400, artefato do episódio — lixo de pilha de
  0x54e886 no Unicorn), m60 (302: subida de nível do companheiro) e m110 (517: o "How many units contains this group" do script).
- Sem divergência nomeada do motor antigo: **não cumprido**. Ficam: Summon/Animate Dead/Teleport/Wall of Earth/Drain Life no gancho
  `spellApply`; os atributos do herói e dos companheiros pelo `syncCombat` (`exeBase` só nas unidades do mapa); o despachante humano
  da classe 8 (0x5696e8, gancho `castClass`); o conjurador das armadilhas de magia (0x4f06ac, `trapCast`); a lista
  [[0x6044c4]+0x7c]+0x10 (objetos que lançam magia; também o fim do prédio destruído); e a formação do grupo (#25).
- Itens 1, 3 (salvo as magias acima) e 4: feitos. Item 2: falta criar o herói e os companheiros pelo exe (0x5145d1 com o modelo do
  estágio). Item 5: não começado.

### F3 — A missão na tela (apresentação; paralela a F2)
1. Render do mapa: ordem de desenho (unidades, cadáveres, sacos, estruturas), borda da névoa (#27), relevo.
2. Sequências de animação: capturar no original (cópia `a2_lab`, relógio e rand fixos) ataque, morte, magia e ócio de cada tipo de
   unidade, quadro a quadro, e comparar com o nosso no mesmo tique.
3. Visual das magias: cada magia lançada no original (pares do `synth_spells` mostram onde; captura no `a2_lab`) × a nossa — sprite,
   duração, camada, som.
4. HUD: faixa de cabeças (#5), livro/olho (#44), Tab (#61), retrato, cursores, mensagens.
Pronto quando: cenários novos da missão com SSIM de região ≥ 0,95 ou diferença explicada, e as sequências com o mesmo quadro por tique.

### F4 — Cidades e prédios (apresentação; paralela)
Animações e ritmo da cidade lidos do exe (#40, #41), hover, loja (arrastar em vez de clicar #14, rótulos, preços dos pergaminhos,
encantar #13/#15, som do livro/olho #16), taverna dos druidas e regra dos nomes, escola de magia. Pronto quando: SSIM ≥ 0,98 nas
cenas fixas e mesmas regiões de clique (overlay 100 %).

### F5 — Scripts de missão no original (1–2 sessões)
Sondar no original o ciclo dos gatilhos (1/s), a métrica de distância, os operadores 3/4/5 e o "executar uma vez", e rodar 3–4 missões
com eventos de script comparando o tique de cada gatilho com o nosso. Pronto quando: as inferências viram leitura do exe e os
gatilhos batem no tique.

### F6 — Campanha de ponta a ponta
Jogar (pelo e2e com vitórias reais, não forçadas) a campanha dos 4 heróis: recompensas, estoque das lojas por missão, entrada do
Igles, mapa global entre missões; conferir contra saves do original nos pontos de passagem.

### F7 — Acabamento
Efeito real das opções do jogo (#28), som e música por região, vídeos não comparados (#30), contagem de mortes da fama (#18), atalhos
extras (F10, Home, =, −, H, F: manter só se o usuário quiser), formato do save e o que ele guarda (névoa).

### F8 — Dificuldades fácil e difícil (por último, pedido do usuário em 31/10)
Só o normal (`[0x6044c4]+0xd8` = 2) está conferido. Ler no exe os fatores de vida de 1 e 3 (0x561bf9, 0x4a2908; hoje 0,5/1,5
estimados em `applyDifficulty`), dumps do oráculo com +0xd8 = 1 e 3, `loadcmp` nas 46 missões nas três dificuldades, e procurar
todo outro uso da dificuldade no exe (experiência, IA, dinheiro).

### Depois de F0–F8
Passada de nomes legíveis em `game/src/sim/exe/`. Compressão e multiplayer **só por decisão do usuário**.

## Paralelismo

Duas filas ao mesmo tempo: **sim** (F2, uma sessão por vez em `game/src/sim/`) e **apresentação** (F0 → F3/F4, uma sessão por
elemento em `game/src/mission/`, `ui/`, `scenes/`, `town/`). F5–F7 entram quando uma fila esvazia. Rodadas de bugs do usuário (F1)
têm prioridade sobre as duas.
