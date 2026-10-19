# Altitude (bloco 2 do `.alm`), relevo, luz do terreno e visão — allods2.exe (leitura estática) × implementação

Frente RELEVO, 19/10. Método: desmontagem estática do `allods2.exe` (pefile + capstone, nunca executado fora do harness;
scripts descartáveis no scratchpad sobre `tools/data/x86exe.py`) e conferência nas capturas `refs/original/m10_*`/`m20_*`
pelo comparador. Implementação: `game/src/mission/relief.ts` (fórmulas, sem Pixi), `terrainmesh.ts` (malha WebGL),
`sight.ts` (visão), `fog.ts`, `view.ts`, `worldanim.ts`, `effects.ts`, `scenes/MissionScene.ts`.

## Dados

- Bloco 2 = `u8[w×h]` lido como **byte com sinal** (`movsx`). É altitude **por vértice**: o valor da célula (x, y) é o canto
  superior esquerdo dela. Missões: 0..127 (10.alm 0..127; 20.alm 23..97).
- Objeto do mapa no cliente: `+0x80` → mapa (`+0x0c` tiles, `+0x10` alturas, `+0x18` luz por vértice, u8; getters 0x41e8b0,
  0x41e8d0, 0x41e930). Carga do bloco: 0x534ad4 ("Altitudes block not found").

## Terreno (0x404e0e e variantes 0x40538d/0x405861/0x405cf4)

- 0x4065b1 monta, para a vista, `Y[col,row] = row·32 − alt(vx+col, vy+row)` (1 px por unidade, sem escala), `+0xb8` = mín. das
  duas pontas de cima, `+0xbc` = máx. das de baixo e `+0xc0` = média truncada dos 4 cantos de cada célula.
- A vista guarda o canto em **células inteiras** (`+0x5c/+0x60`); o desenho é em `col·32`, sem fração de pixel. Limite:
  canto ≤ largura − 8 − colunas (0x402fb8).
- Célula com os 4 cantos iguais (`Y_TL = Y_TR`, `Y_BL = Y_BR`, `Y_BL = Y_TL + 32`): cópia 32×32 com sombreamento (0x457487).
  Senão 0x4575fe(x0, x1, yTL, yTR, yBL, yBR, luzes…): **cada coluna** da textura é esticada entre a borda de cima e a de baixo
  interpoladas linearmente em x (mapeamento bilinear). Linhas de cima para baixo: a célula da frente cobre a de trás.
- Brilho do pixel: luz L dos 4 cantos interpolada (por coluna e na vertical, +0,5 e truncada) e uma tabela de 96 níveis por
  arquivo de tiles (0x47e345 → 0x42339e modo 3): `canal = min(255, (paleta + tinta) · (96 − L) / 32)`.
- Nosso: malha por bloco de 16×16 células com 4 faixas verticais por célula (erro ≤ 1 px na célula mais torta), atlas
  único dos 52 arquivos (1664×512, sem filtro), brilho por vértice num shader GLSL (`relief-terrain`); só WebGL — fora dele (ou
  mapa sem relevo) ficam os sprites planos antigos.

## Luz por vértice (0x4a5dd2; chamada na carga e a cada 20 min do relógio, 0x41d3b9)

```
t = tan(|a|), K = 32 / cos(|a|)                 a = ângulo do sol
a < 0: s1 = h(x,y+1) + (h(x+1,y+1) − h(x,y+1))·t − h(x,y);  s2 = h(x,y) − [h(x,y−1) − (h(x,y−1) − h(x−1,y−1))·t]
a ≥ 0: s1 = h(x,y+1) − (h(x,y+1) − h(x−1,y+1))·t − h(x,y);  s2 = h(x,y) − [h(x,y−1) + (h(x+1,y−1) − h(x,y−1))·t]
Lk = clamp((b + c/2 + 32) − sin(π/6 − atan2(sk, K))·c, 0, 94)        L = trunc((L1 + L2)/2)
```
Só vértices internos (1..w−2, 1..h−2). Plano: L = b + 32.

Parâmetros (0x474d98, estrutura global 0x6226c0: tinta RGB, b, c, ?, ?, ângulo double). O `.alm` tem brilho/contraste/ângulo
(bloco 0), mas o jogo **não os usa** (só o editor):

| hora | b | c | ângulo | tinta (R,G,B) |
|---|---|---|---|---|
| ciclo dia/noite desligado | 14 | 32 | π/4 | 0 |
| 6–18 h | 14 | 32 | ((min+360) mod 720)·π/1440 − π/4 (−π/4 às 6 h → +π/4 às 18 h) | 0 |
| 18–20 h | 14 + 10q | 32 − 12q | π/4 | (24q, 0, 8q)… |
| 20–22 h | 24 + 8q | 20 − 12q | π/4 | |
| 22–2 h | 32 | 8 | π/4 − ((min+120) mod 240)·π/480 | (0, 12, 48) |
| 2–4 h | 32 − 4q | 8 + 12q | −π/4 | |
| 4–6 h | 28 − 14q | 20 + 12q | −π/4 | |

(q = (min mod 120)/120, truncado como no exe.) De dia o plano dá (96−46)/32 = **1,5625×** — é o "ganho de 1,55" que a vista
já aplicava (WORLD_GAIN). Conferido: com −π/4 (6 h, ciclo ligado) o desvio do log da razão de brilho original/nosso por bloco
16×16 cai de 0,148/0,154 (sem relevo de luz) para 0,125/0,142 (m10/m20); com +π/4 piora (0,153/0,189). Logo as capturas do
original estão com o ciclo dia/noite ligado.

Nosso: `Relief.computeLight(lightParamsAt(min, dayNight))` a cada 20 minutos; o desenho usa `shade = gain·1,5625/((64−b)/32)`,
ou seja o plano fica sempre no valor de dia e o escuro da noite continua com a luz ambiente de `daynight.ts` (decisão em GAPS).

## Unidades, estruturas, objetos

- 0x46025d (objeto do mapa genérico): centro = `pos + tamanho·128 − 128` (1/256 de célula); `+0x6c` = altura bilinear com as
  divisões truncadas do exe: `top = h00 + (h10−h00)·fx/32`, `bot = h01 + (h11−h01)·fx/32`, `h = top + (bot−top)·fy/32`
  (fx, fy = pixel dentro da célula). Todo desenho subtrai `+0x6c` do y (barras 0x4653a5: `y − CenterY + SelY1 − h − voo`).
- Objetos de cenário por célula (0x406f43 → virtual +0x2c com `+0xc0`): sobem a **média truncada dos 4 cantos**.
- Antes desta frente os objetos subiam 22 px fixos (OBJ_LIFT, medido na missão 10): era a altitude. Com o relevo, sobra 0.
- Nosso: unidades/sombras/barras/números/seleção (`pick`) pelo bilinear no ponto da unidade; estruturas pelo bilinear no centro da
  pegada; objetos pela média dos cantos; sacos e efeitos (projéteis, áreas, explosões, aura do Shield) pelo bilinear no ponto.

## Clique (tela → célula)

O cliente casa o ponto com a célula pelas bordas deformadas (`+0xb8/+0xbc`). Nosso `Relief.screenToGround`: na coluna do mouse,
procura de baixo para cima a primeira linha cuja borda de cima (interpolada em x) ≤ y < borda de baixo e devolve a fração; a
célula da frente vence, como no desenho. Usado no clique e no cursor (`MissionScene.groundCell`); unidades por `pick` na tela.

## Câmera

Canto em células inteiras: `centerOn` arredonda para baixo (capturas: missão 10 −16 px em y, missão 20 −8 px em x antes da
correção; depois 0/0). O limite direito/inferior usa colunas/linhas inteiras (0x402fb8). A rolagem por teclado/borda continua
suave (o exe anda de célula em célula) — decisão em GAPS.

## Visão / névoa (0x403730 tabelas, 0x403ca0 anéis, 0x403b8f passo)

Janela 41×41 em volta da célula da unidade. `alcance[centro] = (visão_u16 >> 1) + 64` (visão em 1/256 de célula, shift 7 →
128 por célula). Cada célula: `alcance = alcance[anterior] − (d + alt(célula) − alt(vigia))` com
`d = trunc(√(i²+j²)·128/max(i,j))` e "anterior" = passo para o centro (só x se |j| < |i|/2, diagonal se ≤ 2|i|, só y acima;
os vizinhos horizontais do centro são corrigidos para passo em x). Vista se `alcance > 0`; anéis até 19, param quando um anel
inteiro fica sem alcance. Subir gasta alcance (1/128 de célula por unidade), descer devolve — o vale corta a visão (missão 20).
Nosso: `sight.ts markVisible` em `fog.ts`; a névoa é desenhada **por vértice** (vértice claro se alguma célula vizinha é vista)
na malha do relevo — a borda fica meia célula para fora, como nas capturas.

Uso na jogabilidade: estas rotinas são do cliente (névoa e quem aparece na tela). A simulação (`game/src/sim/**`) não foi
alterada: alcance de projéteis, velocidade e IA do servidor não leem a altitude no que foi lido aqui (não procurado a fundo no
lado servidor — pendência em GAPS).

## Minimapa (0x4ab96c)

Cor da célula = cor do tile × (0x60 − média truncada das 4 luzes)/32, por canal, limitada a 255. Nosso: `Relief.cellGain`
multiplicando a cor média do tile em `buildMinimap`.

## Resultado (comparador, tela inteira, sem deslocamento)

Ver docs/COMPARE/fidelidade-missao.md e o relatório da frente: m10_hud 0,822 → 0,949, m20_hud 0,768 → 0,912.
