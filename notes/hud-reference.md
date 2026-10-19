# HUD da missão: referências do original (frente HUD-FIDELIDADE)

Fontes consultadas (sem baixar arquivos; só visualização no navegador embutido e leitura estática do allods2.exe):

1. **Capturas do jogo original** (StopGame, resenha de usuário, 2025, 632×474 = 1024×768 reduzido):
   `images.stopgame.ru/uploads/users/2025/667353/r847x474/...` — `00083` (casa selecionada), `00085` (herói guerreiro
   selecionado, combate), `00086` (druida selecionada, floresta), `00087` (esqueleto inimigo selecionado, cemitério).
   MobyGames pediu verificação anti-robô (não contornada); Wikipédia en/ru só têm a capa.
2. **allods2.exe** (pefile + capstone, `tools/data/x86exe.py`): strings dos bitmaps em 0x1ef768.. (CrystalR/L, HeadsR/L,
   CommandBarR/L, CommandDnR, CommandEmpR, HumanBackL/R, TextBackL/R, BookOpened/Closed, BackPackOp/Cl, HumanMode, TextMode,
   diskette, ar1..4, SpellBook, SpellBack, Ball, ...), caminhos da boneca em 0x1eee65 e funções de desenho das barras.
3. **UnityAllods** (github.com/jewalky/UnityAllods, reimplementação aberta que leu o mesmo executável):
   `MapViewUnit.cs` (barras, texto do painel), `MapViewHuman.cs` (boneca), `MapViewInfowindow.cs`, `MapViewCommandbar.cs`,
   `MapViewSpellbook.cs`, `ItemClass.cs` (nome dos arquivos de equipamento). Usado só onde bate com o exe/capturas.

## Painel direito (1024×768, 176 px de largura, x = 848)

| y | altura | bitmap | conteúdo |
|---|---|---|---|
| 0 | 158 | CrystalL/R | minimapa roxo dentro do cristal, retângulo branco da câmera |
| 158 | 80 | CommandBarL + CommandEmpR + ícones de CommandBarR (botão ativo = recorte de CommandDnR) | 8 comandos em 4×2, botão i em (8+34·col, 7+34·lin, 34×34) |
| 158 | 80 | HeadsL/R (no lugar dos comandos) | quando a unidade selecionada não é do jogador (captura 00087) |
| 238 | 242 | HumanBackL/R (moldura oval) | retrato 160×240 em x 864, y 240 (absoluto); livro fechado em (864, 242), aberto (864, 238); mochila fechada (865, 439), aberta (864, 446) |
| 480 | 46 | extra1024L/R | só decoração (nós + caveira) |
| 526 | 242 | TextBackL/R | nome, Health/Mana em texto, atributos (Body/Agility/Mind/Spirit), Dmg/Attack, Absorb/Defense, Skills, Resistance, XP, Sight/Speed |

- **Não há barras de vida/mana no painel**: a vida e a mana aparecem só como texto ("HEALTH 1240/1291", "MANA 0/0"; capturas 00085/00087).
- Unidade que não é do jogador: só nome, Health, Mana, Dmg, Attack (00087: "SKELETON / HEALTH 68/128 / MANA 0/0 / DMG 13-26 /
  ATTACK 140"); estrutura: nome + Health (00083). Herói: tudo (00085).
- Cores do texto (UnityAllods, conferidas a olho nas capturas): legenda 0xBD9E4A, valor 0x6B9A7B, títulos "Skills"/"Resistance" 0x945900.
  A fonte do original é a `font2` (8×10), ainda não decifrada: usamos a font4 em 11 px.
- Na captura 00085 há também um ícone dourado parecido com chave no canto inferior direito da moldura (provável `diskette.bmp`,
  32×32, carregado pelo exe): função desconhecida, **não reproduzido**.

## Retrato (moldura oval)

- Herói e humanos: **boneca** montada em camadas 160×240 (00085: guerreiro de armadura verde com besta e capa laranja; 00086:
  druida). Corpo = `graphics/equipment/<m|f><fighter|mage>/<face>.256`; cada item vestido acrescenta
  `.../primary/<AABBCDD>.256` (e `secondary` para pares: braçadeiras, luvas, anéis, capa de mago); herói guerreiro ganha a
  capa `interface/heroback/back<m|f>.256` atrás. Nome = `%02d%02d%d%02d` (material, slot, classe, opção do id do item).
  Ordem das camadas: ver `buildDoll` em `game/src/mission/hud.ts`.
- `face` do herói = campo `face` da classe (classes.json: 32/11/15/6) — o mesmo índice do corpo.
- Monstros/estruturas: `graphics/infowindow/<InfoPicture>.bmp` 160×240 com fundo preto = transparente (o fundo de pedra da
  moldura aparece atrás; 00083/00087).
- `allods2-extracted/graphics/equipment/*/primary|secondary` estão vazias: a pipeline lê as 984 camadas direto do graphics.res.

## Barras sobre as unidades (allods2.exe 0x4653a5 / 0x461b2b → 0x460db1; Ball.bmp em 0x626cac)

- Desenhadas para toda unidade viva e visível (estado < morrendo; invisível só se o jogador não a enxerga).
- Retângulo = seleção do units.reg: x1 = SelectionX1, x2 = SelectionX2, y = SelectionY1 (relativos ao canto do sprite,
  posicionado por CenterX/CenterY).
- Pontas: Ball.bmp 4×4 (bolinha marrom; preto = transparente) em (x1, y−2) e (x2−4, y−2).
- Trilho (x1+4..x2−4, linhas y−2..y+1): 0x404040, linha y−1 0x808080, linha y 0x606060.
- Preenchimento: `int(vida × (x2−x1−8) / vidaMax)`, mínimo 1 se vida ≠ 0. Linhas y−2 e y+1 escuras (0x80), y−1 clara (0xFF),
  y média (0xC0). **Verde**; **amarelo** se vida < máx/2; **vermelho** se vida < máx/4 (o UnityAllods usa 0,33/0,66 — errado;
  a captura 00087 mostra verde a 53%).
- Mana (ManaMax > 0): mesma barra 4 px abaixo, sempre azul (0,0,FF/C0/80), mínimo 1.
- Modo "apagado" (bandeira do mundo +0xab8 e unidade sem a bandeira +0x80): sem trilho, cores pela metade sobre o fundo
  escurecido por tabela (0x4564df nível 8). Interpretamos +0x80 como "selecionada" (o UnityAllods faz o mesmo com alfa 0,5).

## Animação parada

- units.reg não dá `IdlePhases` a humanos; os sprites dos heróis fecham exatamente 16 parados + 8 × (mover + atacar)
  (ex.: swordsman 152 = 16 + 8×(10+7)) — **não existem quadros de ocioso** para o herói. Só 5 dos 77 tipos têm bloco ocioso.
  O UnityAllods também mostra o quadro parado quando `IdlePhases ≤ 1`. Conclusão: herói parado fica estático, como já fazíamos.
- `heroes/unarmed` (129 quadros) usa o layout espelhado do "Unarmed Fighter" (ID 1): corrigido na pipeline.

## Livro de magias

- `spb1024l` (192) + `SpellBook` (480×85, ícones de todas as magias em 12×2 células de 38 px a partir de (5,5)) + `spb1024r`
  no rodapé da vista (x 0/192/672, y 683). Magias desconhecidas cobertas por `SpellBack` 36×36 em (+1,+1). Abre pelo livro
  da moldura ou pelo comando Cast. Ordem da grade: `SPELL_GRID` em hud.ts.

## Elementos nossos removidos

Barras de vida/mana desenhadas no painel (PIXI.Graphics), texto "Objectives/Gold/Exp" no painel (objetivos foram para o
menu Esc, ouro para o inventário), botões quadrados de magia inventados sobre o extra1024, moldura amarela do comando ativo,
anel elíptico de seleção sob as unidades (o original realça a unidade sob o cursor clareando o sprite), barras só no
herói/selecionado/ferido (agora em todas, como o exe), fundo marrom liso do painel (agora preto sob os bitmaps).

## Correções medidas no original (FIDELIDADE-MISSÃO, 19/10) — valem mais que o texto acima
- A **font2 foi decifrada** (ui/text.ts `font2`): o painel de texto usa `ui/herosheet.ts` (a mesma ficha da criação/taverna) em x-12 do painel da criação; Weight em décimos e XP = soma da experiência por habilidade.
- **Barras sobre as unidades**: só a unidade PRÓPRIA selecionada tem barra (vida; mana azul embaixo se houver). Inimigos (selecionados ou não), unidades próprias não selecionadas e o herói sem seleção não mostram barra — o "modo apagado" do exe não aparece. Unidade hostil selecionada: o painel mostra só o nome (y do glifo 555, centrado em x≈935).
- **Minimapa**: 2 px por célula, células 8..w-8 (80 células → 64×64 = 128 px), célula 0 em (856,2), pontos 2×2 (herói 84e752, objeto 2145bd), retângulo branco de 1 px de (cam/32)×2 px; a área explorada é circular de raio sight+1,4 em blocos de 2 px.
- **Etiquetas**: caixa dourada font2, cursor+1 / base 3 px acima, aparece 0,5 s parado; textos em main.txt 0..14 e 155..180, spells.txt, e o item como "Nome / Damage a-b / Attack +n / Defense +n / Absorption +n".
- Texto de dano: font3 salmão (231,113,82) com sombra. Aura do Shield: nuvem de puffs (pr_62).
