# Campanha no jogo (frente CAMPANHA-IMPL)

Regras: notes/campaign.md (Scenario.dll). Dados: `data/campaign.json`, `campaign-shops.json`. Testes: `cd game && npm run test:campaign`.

## Código
- `game/src/campaign/engine.ts` (puro): `newCampaign`, `innPatrons`, `talkTo`, `toggleHire`, `leaveTown`, `enterLocation`,
  `onMissionResult`, `nextAfterMission`, `globalMapNodes`, `partyForMission`, `mercTemplate`, `takePendingVideos`, `sanitizeCampaign`.
- `campaign/shops.ts` (puro): estoque por save/cidade/estágio (`shopStock`, `takeFromStock`, `putInStock`).
- `campaign/progress.ts` (puro): `ensureCampaign` (novo jogo ou migração do save antigo), fila de vitórias (`queueResult`/`applyQueue`),
  `syncLegacy` (mantém `availableMissions/completedMissions/town` coerentes).
- `campaign/runtime.ts`: carrega os JSON, `routeTownArrival` (aplica vitória, toca vídeos, decide destino), hall da fama.
- Estado salvo: `progress.campaign` (`CampaignState` em campaign/types.ts): `vars` esparso (estágio = vars[768]), `locations`,
  `current`, `lastTown`, `map`, `shops` (configuração DLL), `stock`, `seed`, `videos`, `pending`, `party`, `log`, `queue`.

## Fluxo
Plagat → taverna (Talk no mensageiro põe a 10 no mapa e libera o guarda) → portão → Uimoir (herói anda sozinho) → missão 10
(sem briefing, como o original) → cena "town" recebe o MissionResult → vídeo teleport → missão 20 direto → mapa Yases (Kaarg + 21)
→ Kaarg → ... → estágio 120 → hall da fama + créditos. Derrota: volta à última cidade (ou à mesma missão se não houver cidade).

## Decisões / interpretações
- Após vitória com cidade disponível: mapa-múndi (o exe só entra direto no 1º local quando não há cidade, 0x486d45).
- Sem `scenarioVars` no resultado: último valor de `scenarioVarsSet` (772=1, 780=1, 779=1), igual à simulação do campaign.py.
  A MissionScene já devolve `scenarioVars` (só as que mudaram); vazio = o script não gravou nada (sem 21/52).
- Igles entra no grupo ao falar com ele na 30 (estimado). Mercenários grátis; recusam a missão seguinte.
- Taverna: botões do original [Hire/Fire só para mercenário], Talk, Exit; o 1º frequentador já vem selecionado.
- Lojas: candidatos canônicos por estágio (campaign-shops.json) + faixa de preço da configuração atual; sorteio uniforme com
  reposição (pesos 1,6^k não decifrados); Elven da loja druida a partir de items.json (shape Elven, material da máscara).
- Cidades: máscara com o mesmo significado nas 3 (128 taverna, 144 loja, 160 saída, 176 estátua/menu, 192 escola em Plagat); os
  outros valores são moradores (fala kaargman/kaargguard/kaargwoman/druidinnkeeper/druidshopkeeper<estágio>). Animações de
  Kaarg/acampamento localizadas por correlação (tools/pipeline/town.py: `locate`), uma posição por sequência (a1/a2/...).
- Mapa: estandarte xadrez = onde o herói está; bandeira branca = disponível; azul = sob o mouse; cruz = concluída; trilha em
  linha reta (o caminho por pathmap.bmp não foi implementado).
- `npcnames.txt`: linha k = npc k+1 (corrigido em town/common.ts).
