# Missões — notas e relatório do teste de fumaça

Gerado por `cd game && npm run test:missions -- --write` (game/src/sim/test/missions_smoke.ts; loader em sim/test/loader.ts): monta cada
missão como a MissionScene (`loadMissionData` + `buildMission` + `wireOutcome` + `installMissionAi`), roda 600 tiques (30 s) com o herói
parado (guerreiro padrão, nível inicial) e confere dados estáticos. Colunas: Avisos = log do runtime/host (ação sem suporte);
Vivos = unidades vivas fora o herói; Msgs/Subs = mensagens e subobjetivos disparados; Desfecho = Mission Complete/Fail em 600 tiques.
Missões com teste de piloto automático: 10 (mission10.ts), 20 (mission20.ts), 30, 31, 32, 40, 41, 42, 43 (missions_kaarg.ts) e 50, 51, 52, 53, 60, 61, 62, 63 (missions_druids.ts) e 70-77 (missions_70s.ts) e 80-87 (missions_80s.ts) e 90-96, 100-103 e 110 (missions_90s.ts, helpers comuns em pilot.ts); o fluxo de cada uma está no cabeçalho do arquivo. A 92 termina em FAIL2 parada
porque as abelhas nível 4 (ataque 300) matam o herói padrão (dado do original).

Missão 20 ("The Road to Kaarg"): vitória = ficar a < 4 células de (42,10); falha 5 = atacar camponeses (jogador 3); falha 2 = herói morto;
opcionais: perto do "bom bandido" (unit 62) abre o subobjetivo 1 e grava a variável de cenário 772 = 1 (libera a 21); matar o grupo 6 cumpre-o.

Acampamento druida e bloco livre (vitória / falhas; Igles = 10002 e Dina = 10003 só existem com o estado de campanha; falha 2/3/4 = herói/Igles/Dina mortos, regra do motor):
- 50 Ancient Forest: enxame de zumbis (grupo 7) parte quando se fala com a druida/druida macho (v74); matá-lo cumpre a sub 1; o druida 40 pede a cratera (grupo 5, sub 2); grupo 5 morto + falar com o druida 40 = vitória. O refém ogro (unit 44, vida 0 no mapa) "acorda" ao chegar perto: msgs 20/250 e `vars[780] = 1` (libera a 52). Falha 5 = druida 40 morto.
- 51 Rebel Battalion: grupos 2, 3 e 4 (necromantes) mortos + falar com o capitão 14 (herói/Igles/Dina) = vitória. Falha 5 = atacar os cavaleiros.
- 52 The Hermit: ancião 42; druida solitário 43 (precisa dos "Os", jogador 5, mortos) libera a guarda 1 (122,97); druida chefe 44 (precisa dos morcegos, grupo 6, mortos) libera a guarda 2 (61,117); ossos (44,61) = vitória. Falha 5 = chegar a < 8 de (107,100) / < 10 de (44,115) sem a permissão, 6 = atacar druidas, 7 = ancião/aldeões, 8 = solitário morto, 9 = chefe morto.
- 53 The Traveler: ogro 55 morto -> druida 54 segue o herói até casa (40,123) (sub 1) -> druida chefe 89 (sub 2) -> necromantes (jogador 3) mortos -> o druida chefe arma a armadilha Teleport em (15,121) -> Putnik (178, jogador 1) em (9,15) = vitória + 40000 de ouro. Falha 6 = chefe morto, 7 = druida preso morto, 8 = Putnik morto. O gatilho "Druids attaked" não tem ação no script (sem falha 5).
- 60 Desert Star: Dina na cratera (47,69); orcs (grupo 5) mortos + Dina perto de Greenpeace (60) = vitória (só com Dina no grupo); morcegos (grupo 9) saem a (73,93) e caçam Dina. Falha 5 = Greenpeace morto.
- 61 Village Under Attack: orcs (grupo 5) mortos + herói perto do ancião 23 = vitória + 100000 de ouro. Falha 5 = ancião morto, 6 = atacar aldeões, 7 = atacar cavaleiros.
- 62 Outlaws Camp: todos os fugitivos (jogador 2) mortos = vitória; súcubo 25 morto perto do druida 24 = 10000 de ouro; falar com o líder 61 entrega as unidades 60/62. Falha 5 = atacar druidas.
- 63 Talena's Request: Xara (40) pede ajuda; bando 12 morto -> ela passa para o jogador (e acompanha o grupo); amuleto (item 60 = 3668, saco em (104,124)) levado a ela; bando 16 morto + Xara na torre (40,18) -> falar com ela = vitória. Falha 5 = Xara morta, 6 = atacar aldeões. O resultado não grava variáveis de cenário; a cadeia de Talena (74/75/76/77 por mago/mulher) vem do estado de campanha (conferido no piloto com o motor).

Bloco 70 (missions_70s.ts; Igles = 10002 e Dina = 10003 no grupo; sub n vai ao motor de campanha como vars[752+n]; nenhuma grava variável de cenário própria):
- 70 The Elf: herói (só ele) fala com o elfo 54 (sub 1 -> 2, sub 2 = matar o necromante do grupo 37); necromante morto + alguém do grupo perto do elfo = coroa 12 (item 3664) e vitória; com vars[778] != 0 (esteve na 80) a coroa inteira (18118) vem do portador 207. Druida 128 (ou Dina) traz os monstros do jogador 6 como aliados. Falha 5 = atacar druidas, 6 = atacar o elfo, 7 = elfo morto.
- 71 Ill-Tempered Squirrels: ogros (grupos 1-4) mortos soltam os esquilos (grupos 10, 9, 8, 7); o rei 40 faz o pacto (sub 2) e, com os 4 bandos mortos, a 2ª conversa remove a Wall of Earth da ponte (66,50) (Tile Spell Duration 1); o herói liberta os caçadores (41, ≤ 2 células) que vão até o ancião (63,16); ancião + caçadores = 100000 de ouro e vitória. Falha 5 = atacar o rei, 6 = atacar caçadores/camponeses, 7 = um bando de esquilos inteiro morto.
- 72 The Disappearing Caravans: 4 runas (itens 68-71 = 3676-3679) nos bolsos de 4 orc shamans (69 ar, 78 terra, 165 fogo, 133 água); só a Dina conta nos painéis (102,78) (ar/terra/fogo) e (20,47) (água); os 4 elementais em paz = 500000 de ouro. Só falhas do motor (herói/Igles/Dina).
- 73 A Rebel Stronghold: perto do castelo (65,74) (≤ 10) os grupos 3, 9 e 10 avançam; jogador 6 (19 defensores) todo morto = vitória. Falha 5 = atacar aldeões (jogador 5). obj13 (16 células na última linha do mapa) não tem sprite: a grade o ignora.
- 74 Minge the Shaman (guerreiro): sobrando só o xamã 102 (orcs do jogador 2 mortos) + falar com ele = vitória; ogro 35 começa "meio morto" e acorda com o grupo a ≤ 3 células ou curado (≥ 25% de vida); falha 5 = xamã morto.
- 75 The Old Warrior (guerreira): filho 81 -> líder 66 -> filho; Igles a ≤ 1 do líder; moça 67 segue Igles até o filho; Igles com o filho = vitória. Falha 5 = líder, 6 = filho, 7 = moça mortos, 8 = atacar humanos.
- 76 The Dangerous Forest (maga): druida sábio 62 (caçadores do jogador 3 mortos) segue o grupo até as flores (46,17) = vitória. Falha 5 = druida sábio morto, 6 = atacar druidas.
- 77 A Mage's Spirit (mago): chefe 139 -> bom necromante 144 (passa ao jogador) -> túmulo (48,25) -> amigo 175 (passa ao jogador) -> ritual a dois no túmulo (a guarda do grupo 24 aparece ~5 s e some; o motor dá invisibilidade ao grupo na fala 10) -> fala final. Falha 5 = 144/175 mortos, 6 = atacar necromantes, 7 = guarda 59/182 ataca, 8 = bom necromante a > 15 do túmulo na hora do feitiço.
- Talena (taverna de Kaarg, npc 2022) oferece 74 (guerreiro), 75 (guerreira), 76 (maga) ou 77 (mago); as 4 variantes são cobertas no piloto (cada uma com falas com texto para o herói).

Bloco 80 (missions_80s.ts; Igles = 10002 e Dina = 10003 no grupo; sub n vai ao motor de campanha como vars[752+n]; nenhuma grava variável de cenário própria; 80 lê `777` "esteve na 70", que a campanha semeia e a vitória na 80 grava `778`):
- 80 The Scarab Wastes: xamã orc E'lo (38, grupo 9 de orcs) morto = sub 1 cumprida, sub 2 (coroa) ativa e trolls (jogador 4) hostis aos orcs (4->3 = 1; 3->4 continua 0); a coroa 13 (item 57 = 3665) cai no chão; quando o herói (ou Igles/Dina) a tem: com 777 = 0, msgs 2/3/4 e vitória (as peças 1 e 12 são removidas, a 13 fica); com 777 != 0, msgs 5/6/7, a coroa inteira (18118) do portador 160 (lich fora de fase, grupo 28) vai para quem a pegou e a 13 some. O script não tem falha própria (só 2/3/4 do motor). Dragão do grupo 18 patrulha até (39,129).
- 81 The Battle Mages (só herói mago, npc 2010): 5 bandos de necromantes/zumbis (astral 18, fogo 10, ar 14 = "most dead" -> v70; terra 1, água 5) todos mortos = vitória (a ordem dos bandos não importa; tudo no mesmo ciclo vale). Sem falha própria.
- 82 The Elite Knights (só herói guerreiro, npc 2009): igual à 81 com cavaleiros (machados 1, arcos 11, clavas 4, depois lanças 8 e espadas 15). Sem falha própria.
- 83 The Stone Web (acampamento druida, npc 677, estágio 80 com `vars[536] != 0`): grupo 15 (3 necromantes + 13 zumbis, em (59,72)) morto = vitória. Sem falha própria.
- 84 Tekel Knows! (guerreiro; Talena): os 28 defensores do jogador 2 (Orakul) mortos + alguém do grupo a <= 4 de Tekel (70, camponês jogador 3 fora de fase desde o início — marcador invisível em (16,13), `MissionHost.measurePhased`) = vitória. Sem falha própria.
- 85 The Storyteller (guerreira; Talena): líder 8 (aldeia, (37,23)) fala (v70); o contador v72 corre a partir da fala ou de o grupo todo (Distance to nearest units of player) ficar a >= 15 de (39,10) e, 16 ciclos (~8 s) depois, os lobos atacantes (jogador 5, grupos 3 e 4) marcham sobre as ovelhas; lobos mortos + alguém a <= 4 do líder = vitória. Falhas: 7 = ovelhas (jogador 4) <= 15 de 18 (os lobos reais matam 3 em ~30 s), 5 = aldeões atacados, 6 = líder morto.
- 86 The Swamp Mage (maga; Talena): maga do pântano (38, druida, (60,16)) com a paz nas feras (grupo 2, jogador 5) = as 9 feras passam ao jogador (ai defend) e o herói fica hostil aos 11 bandidos (jogador 2; a ação inversa "Brigands to Self enemy" nunca é chamada); bandidos mortos + maga de novo = vitória. Feras atacadas antes -> msg 14 (sem pacto) e a vitória segue por bandidos mortos + maga. A falsa maga (12, bandido) só fala antes do pacto (msg 2) e, com as feras mortas, msg 5. Falha 5 = maga morta, 6 = maga atacada.
- 87 The Dark Library (mago; Talena): bibliotecário 20 ((28,57), sub 1), cidadão 36 ((21,19)), 10 mortos-vivos do grupo 6 mortos, casa (54,13) (a <= 15 msg 14, a <= 4 com o cidadão já ouvido e os defensores mortos = livros achados), bibliotecário de novo = vitória. Falha 5 = necromantes (jogador 2) atacados, 6 = bibliotecário morto.
- Talena (npc 2022, Kaarg) encadeia 63 -> 74|75|76|77 -> 84|85|86|87 -> 93|94|95|96 pelo (mago, mulher) do herói; o piloto percorre as 4 cadeias na campanha.

Bloco 90-110 (missions_90s.ts; Igles = 10002 e Dina = 10003 no grupo; sub n vai ao motor de campanha como vars[752+n]; só a 110 grava variável de cenário (779)):
- 90 A Kings Request (guerreiro; enviado necromante, npc 2004): druida chefe 15 (129,14) fala (v70): sub 1 cumprido, sub 4 ativa, aliança com os druidas (5 e 6), dragões (grupo 9) e trolls (grupo 10) marcham em defesa; podstava 78 grita (v71): emboscada (grupo 7, 15 necromantes) aparece e os necromantes viram inimigos; grupo 7 morto = vitória. Atacar a podstava antes da conversa também mostra a emboscada (msg 13). Falha 5 = druida atacado antes da aliança.
- 91 The Orcologist (pregador druida, npc 681): orcólogo 95 (104,114) fala (sub 2), o xamã orc 41 (69,32) larga o ingrediente (item 58 = 3666) ao morrer, o herói o pega no chão e entrega (1.000.000 de ouro). Falha 5 = orcólogo atacado, 6 = orcólogo morto.
- 92 The Ancient Crypt (elfo, npc 2003): cadeia dos druidas (fantasma (45,24), armadilheiro 55, 3 súcubos mortos, falante 56 com o dragão 57 morto, escolta dos fantasmas até o falante) rende o prêmio do marcador 79 (item 17762 + 10000 de ouro, que o herói pega); vitória = os 12 necromantes (jogador 2) mortos. Falha 5 = druidas atacados, 6 = camponeses (jogador 7).
- 93-96 As Fontes de Magia (Talena: 93 guerreiro, 94 guerreira, 95 maga, 96 mago): duas alavancas "Switch" (estruturas 2 e 3; desligada = 1, ligada = 0) abrem o teleporte (102,34) -> centro (74,72); teleportes do mapa (bloco 9, magia 23) levam do centro ao enigma e do santuário a (26,118), na ilha do ponto final (10,135). Enigma: 93 duas Wall of Fire (6 células (121..125, 69/75)); 94 Wall of Earth em I (muros em y=113 e y=117 e pilar em x=65); 95 as nuvens venenosas (66,25)/(69,27) precisam sumir das 9 células [est: um Wall of Fire as queima]; 96 Invisibility nas 3 estátuas (20, 21, 22). O armadilheiro de teleporte do enigma leva ao santuário; dragão morto + herói a <= 4 do marcador fora de fase (pirâmide) larga o prêmio e chegar a (10,135) termina.
- 100 The King's Hunt (velho cavaleiro, npc 2006): falar com o rei 276 troca-o pelo rei sem máscara 306 e põe os cavaleiros maus (jogador 8) em guerra com os bons e com o herói; os 8 seguidores (grupo 23) e o rei (grupo 27) mortos = vitória. Falha 5 = tio 293 morto, 6 = cavaleiros bons atacados.
- 101 Forest Madness (pregador druida, npc 681): druida 8 (sub 1), druida chefe 7 caído (vida 0 no mapa: acorda com um Heal que passe de 25% ou com o grupo a <= 3 células), necromantes (grupo 3) mortos + conversa com o druida chefe = vitória (os monstros dos druidas ficam em paz). Falha 5 = druida chefe morto, 6 = druidas atacados.
- 102 Mysterious Amulet (camponesa de Ushut, npc 2109): o mago 217 leva o amuleto (item 60 = 3668); mago morto -> o herói pega o saco e leva ao fantasma (125,15) (a <= 4) = vitória (também: fantasma e grupos 24 e 7 mortos). Dragões e mago podem entrar no grupo (só um dos dois lados). Os zumbis do grupo 8 marcham sobre a aldeia (o ancião 66 cai em ~41 s sem defesa = falha 6). Falha 5 = camponeses atacados.
- 103 The Desert Oracle (orcólogo, npc 2005): pedra (item 63) na casa (41,50), cabeça (item 62) com o ogro 31, xamã orc 30 (94,123) recebe as duas e marcha sozinho por (80,77) até o Oráculo (128,72); o grupo em (126,71) e o xamã ali = vitória. As 16 alavancas só rendem prêmios (4, 6, 7, 9 ligadas e as outras 8 desligadas -> marcador 132; 14 e 16 ligadas, 13 e 15 desligadas -> marcador 131). Falha 5 = xamã morto, 6 = xamã atacado.
- 110 The Last Battle (velho cavaleiro, npc 2006): cavaleiros (grupo 11) e druidas (grupo 12) em guerra; o lado que sobra passa ao jogador (779 = 1 se os druidas vencem, 0 se os cavaleiros); os grupos de Urd ficam suspensos; Urd (117) morto = vitória; a campanha vai ao vídeo final 5 (druidas) ou 4 (cavaleiros) e ao estágio 120.

<!-- SMOKE:BEGIN -->
| Missão | Nome | Un. | Est. | Obj. | Exceção | Avisos runtime/host | Sem template/stats | Sem anim | Sem sprite | Jogadores | Refs script | Vivos | Herói | Msgs | Subs | Desfecho (600 tiques) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 10 | Great Mage Skrakan | 29 | 16 | 493 | - | - | - | - | - | aliança assimétrica 2->4=1 / 4->2=2 aliança assimétrica 3->4=1 / 4->3=2 | - | 29 | 142/142 | 1 | 2=1 | - |
| 20 | The Road to Kaarg | 41 | 48 | 954 | - | - | - | - | - | - | - | 41 | 142/142 | 1 | 2=1 | - |
| 21 | The Brigands Camp | 58 | 38 | 1351 | - | - | - | - | - | - | - | 58 | 142/142 | 1 | 1=1 | - |
| 30 | Lyrisha Village | 124 | 41 | 4117 | - | - | - | - | - | - | - | 124 | 142/142 | 1 | 2=1 | - |
| 31 | Adamantium Mines | 76 | 102 | 3854 | - | - | - | - | - | aliança assimétrica 2->6=0 / 6->2=2 aliança assimétrica 3->6=0 / 6->3=2 aliança assimétrica 5->6=0 / 6->5=2 | - | 76 | 142/142 | 1 | - | - |
| 32 | After the Sword | 20 | 2 | 1003 | - | - | - | - | - | - | - | 20 | 142/142 | 1 | - | - |
| 40 | The Astrologer | 108 | 52 | 3942 | - | - | - | - | - | - | - | 108 | 142/142 | 1 | - | - |
| 41 | The Besieged Tower | 48 | 3 | 886 | - | - | - | - | - | - | - | 48 | 142/142 | 1 | 1=1 | - |
| 42 | Killer Dragon | 89 | 40 | 1338 | - | - | - | - | - | - | - | 89 | 142/142 | 1 | - | - |
| 43 | Dirty Work | 55 | 20 | 418 | - | - | - | - | - | - | - | 55 | 83/142 | 1 | - | - |
| 50 | The Ancient Forest | 74 | 29 | 3902 | - | - | - | - | obj7 | - | - | 74 | 142/142 | 1 | - | - |
| 51 | Rebel Battalion | 147 | 5 | 2737 | - | - | - | - | - | - | - | 147 | 142/142 | 1 | - | - |
| 52 | The Hermit | 70 | 47 | 1836 | - | - | - | - | obj1 obj208 obj16 | aliança assimétrica 2->4=0 / 4->2=2 aliança assimétrica 3->7=0 / 7->3=2 aliança assimétrica 4->7=0 / 7->4=2 aliança assimétrica 5->7=0 / 7->5=2 aliança assimétrica 6->7=0 / 7->6=2 | - | 70 | 142/142 | 1 | - | - |
| 53 | The Traveler | 90 | 87 | 1904 | - | - | - | - | - | - | - | 90 | 142/142 | 1 | - | - |
| 60 | The Desert Star | 96 | 20 | 625 | - | - | - | - | - | - | - | 96 | 142/142 | 1 | 1=1 | - |
| 61 | Village Under Attack | 68 | 18 | 367 | - | - | - | - | - | - | - | 67 | 142/142 | 2 | 1=1 | - |
| 62 | The Outlaws Camp | 39 | 24 | 797 | - | - | - | - | - | - | - | 39 | 142/142 | 1 | - | - |
| 63 | Talena's Request | 102 | 39 | 2964 | - | - | - | - | - | - | - | 102 | 142/142 | 1 | - | - |
| 70 | The Elf | 140 | 61 | 2071 | - | - | - | - | - | - | - | 140 | 142/142 | 1 | 1=1 | - |
| 71 | Ill-Tempered Squirrels | 63 | 23 | 828 | - | - | - | - | - | - | - | 63 | 142/142 | 1 | 1=1 | - |
| 72 | The Disappearing Caravans | 165 | 68 | 978 | - | - | - | - | - | - | - | 165 | 142/142 | 1 | - | - |
| 73 | A Rebel Stronghold | 97 | 69 | 3603 | - | - | - | - | obj13 | aliança assimétrica 4->5=2 / 5->4=0 | - | 97 | 142/142 | 1 | - | - |
| 74 | Minge the Shaman | 103 | 30 | 1038 | - | - | - | - | - | - | - | 103 | 142/142 | 1 | - | - |
| 75 | The Old Warrior | 115 | 56 | 4717 | - | - | - | - | - | - | - | 109 | 142/142 | 1 | - | - |
| 76 | The Dangerous Forest | 132 | 30 | 2084 | - | - | - | - | - | - | - | 125 | 142/142 | 1 | - | - |
| 77 | A Mage's Spirit | 131 | 55 | 1671 | - | - | - | - | - | - | - | 131 | 142/142 | 1 | - | - |
| 80 | The Scarab Wastes | 127 | 26 | 722 | - | - | - | - | - | - | - | 127 | 142/142 | 1 | 1=1 | - |
| 81 | The Battle Mages | 59 | 18 | 393 | - | - | - | - | - | - | - | 59 | 142/142 | 1 | - | - |
| 82 | The Elite Knights | 86 | 42 | 847 | - | - | - | - | - | - | - | 86 | 142/142 | 1 | - | - |
| 83 | The Stone Web | 92 | 21 | 2009 | - | - | - | - | - | - | - | 92 | 142/142 | 1 | - | - |
| 84 | Tekel Knows! | 59 | 11 | 281 | - | - | - | - | - | - | - | 59 | 142/142 | 1 | - | - |
| 85 | The Storyteller | 42 | 7 | 663 | - | - | - | - | - | - | - | 42 | 142/142 | 1 | - | - |
| 86 | The Swamp Mage | 35 | 10 | 833 | - | - | - | - | - | - | - | 35 | 142/142 | 1 | - | - |
| 87 | The Dark Library | 35 | 19 | 497 | - | - | - | - | - | - | - | 35 | 142/142 | 1 | - | - |
| 90 | A Kings Request | 167 | 24 | 3314 | - | - | - | - | - | - | - | 167 | 142/142 | 1 | 1=1 | - |
| 91 | The Orcologist | 160 | 55 | 559 | - | - | - | - | - | - | - | 160 | 142/142 | 1 | 1=1 | - |
| 92 | The Ancient Crypt | 113 | 63 | 2374 | - | - | - | - | - | - | - | 113 | 0/142 | 1 | - | FAIL2 |
| 93 | The Magic Source of Fire | 23 | 25 | 395 | - | - | - | - | - | - | - | 23 | 142/142 | 1 | - | - |
| 94 | The Magic Source of Earth | 22 | 24 | 392 | - | - | - | - | - | - | - | 22 | 142/142 | 1 | - | - |
| 95 | The Magic Source of Water | 22 | 24 | 394 | - | - | - | - | - | - | - | 22 | 142/142 | 1 | - | - |
| 96 | The Magic Source of Air | 22 | 25 | 392 | - | - | - | - | - | - | - | 22 | 142/142 | 1 | - | - |
| 100 | The King's Hunt | 174 | 62 | 1575 | - | - | - | - | - | aliança assimétrica 2->6=0 / 6->2=2 aliança assimétrica 2->9=0 / 9->2=2 aliança assimétrica 3->6=0 / 6->3=2 aliança assimétrica 3->9=0 / 9->3=2 aliança assimétrica 4->6=0 / 6->4=2 aliança assimétrica 4->9=0 / 9->4=2 (+6) | - | 174 | 142/142 | 1 | 1=1 | - |
| 101 | Forest Madness | 191 | 8 | 3591 | - | - | - | - | - | - | - | 191 | 142/142 | 1 | - | - |
| 102 | Mysterious Amulet | 145 | 60 | 740 | - | - | - | - | - | aliança assimétrica 5->7=2 / 7->5=1 | - | 138 | 142/142 | 1 | - | - |
| 103 | The Desert Oracle | 99 | 38 | 1109 | - | - | - | - | - | - | - | 99 | 142/142 | 1 | - | - |
| 110 | The Last Battle | 259 | 136 | 4835 | - | - | - | - | - | aliança assimétrica 1->3=0 / 3->1=2 aliança assimétrica 1->4=0 / 4->1=2 | - | 246 | 142/142 | 2 | - | - |
<!-- SMOKE:END -->
