# Estrutura da campanha (frente CAMPANHA-RE)

Gerador: `.venv\Scripts\python.exe tools/data/campaign.py` → `game/public/data/campaign.json` + `campaign-shops.json`.
Esquema: `docs/DATA.md` (seção CAMPANHA). Análise só estática (nada do jogo foi executado).

## A descoberta principal: `Scenario.dll`
A lógica da campanha não está no allods2.exe nem nos textos: está em `C:\GOG Games\Rage of Mages II\Scenario.dll` (271 KB, MFC
estático, compilado sem otimização). O exe faz `LoadLibrary("scenario.dll")` e pega 18 funções por ordinal (exe 0x4818e7…0x481aa1):

| ord | função (RVA) | ponteiro no exe | o que faz |
|---|---|---|---|
| 1/2 | `ScenarioGetVar/SetVar` (0x1cfd/0x1d0e) | 0x62729c/0x627298 | `vars[1024]` (0x10036028) — todo o estado da campanha |
| 3 | `ScenarioTalkTo(code)` (0x32c0) | 0x62746c | efeito de falar/contratar na taverna |
| 5/6 | `EnterLocation/LeaveLocation` (0x1d22/0x2806) | 0x627294/0x627160 | entrar num local; sair = **vitória** na missão (chama 0x10001da5) ou sair da cidade (0x10001d5c) |
| 9 | `ScenarioEnterInn(list,&n)` (0x286b) | 0x627480 | monta a lista de frequentadores |
| 11 | `ScenarioNewGame` (0x33be) | 0x627164 | estado inicial |
| 12/13 | `Save/Load` (0x3585/0x3686) | | vars + lojas + lista de locais + local atual |
| 14/19 | `GetAvailableLocations/GetAllLocations` | | listas de `Location {type, id, CRect}` |
| 15 | `GetShopAssortment` (0x37e8) | 0x627474 | `&shops[cidade]` (4 prateleiras × 5 dwords) |
| 16/17/18 | `IsTownAvailable/IsMissionAvailable/GetCurrentLocation` | | |

`tools/data/campaign_dll.py` desmonta o DLL (pefile + capstone) e `campaign.py` confere **cada constante** citada (código de taverna,
máscara de loja, preço por estágio, casos do switch) no endereço indicado; o script falha se algo divergir.

## Locais e mapa-múndi
Construtores estáticos `Location(type, id, x, y, 0, 0)` (função 0x100038e0; type 1 = missão, 2 = cidade), 52 objetos, 49 deles na lista
ALL (0x10001a0f): 3 cidades (1 Plagat 215,234; 2 Kaarg 370,305; 3 acampamento druida 194,225) + as 46 missões. Três objetos órfãos
(0x10037580.. com ids 10/20/30 em posições de 20/50/60) nunca entram em lista — sobra.
- Coordenadas em pixels do bitmap 640×480. **Confirmação independente**: `graphics/global.map/pathmap.bmp` (Yases) e `umoirpath.bmp`
  (Uimoir) são 8 bits com valor 2 exatamente em cada posição do DLL (49/49) e valor 1 nas estradas entre elas (o ícone `hero.bmp`
  anda por elas, exe 0x47110e). 93–96 compartilham o ponto 306,148 (só uma delas existe por partida).
- Mapa Uimoir só quando se sai de Plagat (exe 0x487dc4 grava +0x1b0 = 1 se o local era a cidade 1); aí o herói caminha sozinho até
  o primeiro local da lista (a missão 10; exe 0x470743). Em todos os outros casos: Yases (`gmap.bmp`).
- `ScenarioLeaveLocation` da cidade 1 remove Plagat da lista (DLL 0x10001d5c): Plagat nunca mais aparece.
- Depois da missão 10 não há cidade disponível → o exe entra direto no 1º local (missão 20) sem mapa (exe 0x486d45).
- Textos: `#title%d/#briefing%d/#town%d/#description%d` (exe 0x5f534c) de globalmap.txt. 10 e 20 não têm `#title` porque não passam
  pela escolha no mapa; o título vem da 1ª linha do `#briefing` do mission<id>.txt. `sites.txt` não é lido pelo exe.
- `graphics/infowindow/*.bmp` são retratos de unidades/estruturas (janela de informação da missão), **não** imagens de local de missão:
  o original não mostra imagem de local no mapa (`image: null`).

## Estágios
`vars[768]` = estágio, começa em 10 (NewGame). Concluir missão com id múltiplo de 10 soma 10 (DLL 0x10002465). Estágio 120 = fim.
- 10 Plagat (Uimoir) → 10 · 20 sem cidade → 20 · 30/40 Kaarg → 30/40 · 50–80: bloco livre 50/60/70/80 (50 e 60 surgem juntas ao
  concluir a 40; 80 ao concluir a 60; 70 é oferecida no acampamento druida, que surge ao concluir a 50) · 90/100/110 Kaarg.
- Estágios 60/70/80 contam quantas do bloco já foram feitas; por isso ofertas "do estágio 60" (61, 63) dependem da 1ª do bloco.

## Taverna (EnterInn, DLL 0x1000286b)
Cada frequentador é um dword: `npc | fala<<16 | tipo<<28 | contratado<<31`. Tipo 0 = conversa, 3 = dá missão (falar já põe a missão
no mapa: exe 0x49ba28 mostra `npc%dtalk%d` e chama TalkTo; TalkTo tipo 3 = `addMission(fala)`), 1/2 = mercenário. A fala M de quem
dá missão é o id da missão (as falas 7, 8, 9, 39, 48, 49, 78, 79 são só conversa). Todos os 46 códigos foram extraídos e batem com
`town.json`. `npc520talk7` existe no texto, mas nenhum código o usa.
Regras completas em `campaign.json.innRules`; os pontos que mudam o jogo:
- Ofertas presas a um estágio **exato**: 31 (30), 41–43 (40), 51/53 (50), 61/63 (60), 72/73 (70), 81/82 e 83 (80), 91/92 (90),
  101–103 (100). Se o jogador avançar o estágio sem falar com o NPC, perde a missão. 71 só aparece enquanto a 70 não foi concluída.
- 81 (Battle Mages, npc 2010) só para herói mago; 82 (Elite Knights, npc 2009) só guerreiro.
- Talena (npc 2022) encadeia 63 → 74|75|76|77 → 84|85|86|87 → 93|94|95|96 conforme (mago, mulher) do herói: guerreiro 74/84/93
  (Fogo), guerreira 75/85/94 (Terra), maga 76/86/95 (Água), mago 77/87/96 (Ar). `vars[776]` = mago, `[781]` = mulher, gravados pelo
  exe a partir das flags 0x40/0x80 do herói (0x4896e1; as mesmas de `-mage`/`-female` na linha de comando, exe 0x48c0e2).
- Igles (22) oferece 30, 40 e 62 (62 a partir do estágio 60 depois da 53); Dina (23) só conversa (fala 49).
- Efeitos de conversa: 517/10 grava `vars[769]` (o guarda de Plagat deixa passar, exe 0x4cd100); 22/30 libera o mercenário 2;
  orc 5/79 (aparece no acampamento druida após a 60) vira mercenário 5; druida 675/78 (após a 70) acrescenta o shape Elven à
  prateleira 3 da loja druida ("Elven artifacts... You can only buy them from us").
- Missões sem NPC: 20 (vitória na 10), 32 (31), 50 e 60 (40), 80 (60), 21 e 52 (o script da 20/50 grava `vars[772]`/`[780]` durante
  a missão; ao vencê-la o DLL acrescenta a 21/52 — opcionais). Isso confirma os comentários russos de town.txt ("Миссия 20 выдается в
  миссии 10", "Mission 80 given in mission 60").

## Mercenários
`vars[512+i]` contratado, `[532+i]` estado (0 indisponível, 1 livre, 2 descansando), `[552+i]` cidade. Liberação: 1 arqueira (vitória
na 20, Kaarg), 2 espadachim (falar com Igles na 30, Kaarg), 3 druida (50, acampamento), 4 troll (70, acampamento), 5 orc Ginsush
(conversa 79, acampamento), 6 cavaleiro-mago (60, Kaarg), 7 catapulta (100, Kaarg).
- Contratar (estado 1): texto `npc<n>accept<estágio>` e o bit 31; estado 2: `npc<n>reject<estágio>` ("enjoyed our last trip... I'm
  staying home") e nada muda (exe 0x49b812). Ao vencer uma missão, quem foi vira estado 2 (recusa a próxima) e os demais 1 (DLL
  0x100020b0) — mercenários alternam missões. **Sem preço** no código.
- Na missão: template `10000 + 10·n + estágio/10 − 2` (exe 0x4f36c0) — p.ex. 10011 `2MercenaryXBowman30`, 10079 `MercenaryCatapult`.
- Retrato da taverna: `graphics/interface/inn/Unit<typeId>/sprites.16a` com o typeId do template (exe 0x499880); herói usa
  `HeroMage`/`HeroFighter`.
- Dina entra no grupo ao voltar da 40 (`vars[773] = 23`, exe 0x486c5b). Como Igles (unidade 10002) entra não foi achado no exe —
  os scripts o usam a partir da 30 (estimado: a partir da conversa npc22talk30).

## Conclusão de missão (DLL 0x10001da5) e vídeos
Remove a missão da lista, `vars[896+M] = 1`, efeitos por missão (`missions[M].onComplete`) e o evento de vídeo devolvido ao exe
(exe 0x486cc8 → 0x48f919, que também marca o bit `1<<evento` em 0x5f1a04 — galeria "Cut Scenes"): 1 teleport (10), 2 stars (30),
3 crown (a 2ª de 70/80; vars 777/778), 4 knights / 5 druids (110, conforme `vars[779]` gravado pelo script de 110). Estágio ≥ 120 →
hall da fama (`famehall.dat`: 10 × {nome, pontos, 2 u32}; pontos = trunc(XP/(segundos×10)×abates), exe 0x4a8d28: ver campaign/hall.ts e docs/GAPS.md [FIDELIDADE-RESTO])
e volta ao menu. `vars[775]` (nunca ligado) liberaria todos os locais — opção de depuração.

## Lojas
Configuração no DLL, geração no exe. 4 cidades × 4 prateleiras `{min, max, count, qty, mask}` (cidade 0 sem uso).
- NewGame: Plagat máx. 1500; Kaarg máx. 5000; ao vencer a 50 a loja druida (mín. 499 exceto prateleira 2). Máx. por estágio novo:
  30 → 10 000, 40 → 22 000, 50 → 60 000, 60 → 150 000, 70 → 400 000, 80 → 800 000, 90 → 1,5 M (+ mín. 12 000), 100 → 5 M (+ mín.
  40 000), 110 → 10 M (Kaarg; a druida acompanha a partir do 50). Máscaras de Kaarg mudam ao vencer 30, 40, 60, 80, 90.
- Máscara (exe 0x5254e7/0x524bca/0x5247db): bits 0–14 materiais (pulando Bone), 15–21 shapes, 0x1000000 armas, 0x400000 armaduras
  de guerreiro (sutableFor bit 0), 0x800000 escudos, 0x8000000 armaduras de mago (só com 0x20000000), 0x4000000 livros (um por
  magia, preço = bookCost, sem 9/14/15/24/28/29) + 6 poções fixas com 50+rand(50) unidades (exe 0x525f67); 0x20000000 = itens com
  magia aleatória (50% se 0x10000000 também). Candidato = classe × shape × material permitido pela classe (7×u16 de data.bin), preço
  `trunc(classe × shape × material)` dentro de [min, max]; o exe sorteia `count` deles, quantidade `1 + rand(qty)` para empilháveis.
- Plagat: armas e escudos de Ferro/Bronze/Couro, armaduras de Ferro/Bronze (Common/Uncommon), livros básicos (1000) e poções. A
  prateleira 2 (armaduras de mago mágicas, material Wood) sai **vazia** pela decodificação — nenhuma armadura de mago aceita Wood
  (conferir com captura do original).

## Lacunas
- Como/quando Igles entra no grupo (estimado: conversa 30). Ícone de cada tipo de local no mapa (missionflag/flagonmap/yourflag).
- Bits 0x2000000 e 0x10000000 (sem 0x20000000) das máscaras não são lidos pelo gerador; distribuição do sorteio (pesos 1,6^k, exe
  0x525606) e o encantamento (0x526b5d) não decifrados; preço de venda ao lojista não procurado.
- Pontuação do hall da fama: RESOLVIDA (tempo = segundos em missão, abates = unidades mortas; campaign/hall.ts). Falta o nosso jogo gravar os dois por missão (`recordHallStats`).
- Recompensas: só o ouro dos scripts ("Give money to player") e itens de enredo ("Give All"); o original não dá XP por missão.
