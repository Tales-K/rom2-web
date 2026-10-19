# Vozes (falas dubladas) — onde estão e como se ligam

Fonte: `speech.res` (extraído em `allods2-extracted/speech`, 1 133 WAVs mono). Convertido por `tools/pipeline/media.py` para
`game/public/assets/audio/speech/**.ogg`; inventário e cobertura em `assets/audio/speech/voices.json` (`tools/pipeline/voices.py`, reexecutável,
só lê o que já foi gerado). Os formatos abaixo vêm das strings do `allods2.exe` (lidas, nunca executado) e foram conferidos contra os dados.

## Formatos de nome do exe (todos os que existem)

| Pasta | Formato | Quem usa |
|---|---|---|
| `talk/` | `%04d%c%sp%02d` = npc, classe, **fala 3 díg.**, parte | conversa da taverna (`npc<N>talk<M>` de `town.json`), incl. as falas do herói (npc 21), Igles (22), Dina (23) |
| `accept/`, `reject/` | idem | aceitar/recusar contratar mercenário (`npc<N>accept<M>`/`reject<M>`) |
| `about/` | `%04dt000p%02d` | fala ao selecionar o mercenário (`npc<N>about`) |
| `town/` | idem `talk` | moradores/guardas (`kaargguard<M>`, `kaargman`, `kaargwoman`, `druidinnkeeper`, `druidshopkeeper`, `plagatguard`) |
| `shop/`, `shop_druid/`, `shop_kaarg/` | `s%.2di%.2dp%d`, `books/%.2d`, `effects/%.2d` | lojista (ver abaixo) |

Classe `%c`: `t` = fala sem tag de sexo/classe; `f` guerreiro, `a` guerreira, `m` mago, `s` maga (a do herói; vale também p/ npc 21).
Não existe formato de fala por evento de missão, por briefing ou por aviso de vitória/derrota: **as mensagens `event<N>` das missões
(2 239 linhas em `texts/mission*.json`) não têm áudio no jogo original instalado** — nem nas conversas de Igles/Dina/herói
(arquivos 0021/0022/0023 são só das conversas de taverna/guardas; npcs 616…2133 das missões nem aparecem em `speech/`). O original
só toca o efeito `sfx/message` (já ligado em `MissionScene.queueMessage`) ao abrir a mensagem; `mess_in`/`mess_out` existem e não têm
uso comprovado. Briefings (`#briefing`) e a janela de objetivos também são mudos.

## Cobertura da cidade (conferida por `voices.py`, regra em `src/town/voices.ts`)

599 das 604 linhas de `town.json` (talk/accept/reject/about/town) têm arquivo. Sem voz: `npc22talk40` partes 21–24 (falas do herói sem arquivo)
e `npc4reject90` p3. Arquivos que nenhuma linha usa: `accept/0022t081p06`, `accept/0022t100p99`, `reject/0004t090p03`.

## Lojas — decifrado

`s<NN>i<MM>p<K>`: **NN = (id do item >> 8) & 15** (slot: 1 arma, 2 escudo, 5 amuleto, 6 elmo, 8 peitoral, 9 braceletes, 10 luvas, 12 botas),
**MM = id & 31** (classe no slot; material e bits 0x20/0x40/0x80 não contam: Iron Dagger `0x0102` = Silver Dagger `0x3142` = `s01i02`),
**K** = parte da fala (1–3; o lojista descreve o tipo de item). Conferido: os 110 nomes de arquivo das 3 lojas caem todos em (slot, classe)
que existem em `items.json`. Itens de classe sem arquivo (amuleto, poções, pergaminhos…) ficam mudos. O original tem um arquivo órfão
`shop/s01i9p2` (sem zero; o exe monta `%.2d`, nunca o pede) — ignorado.
`books/NN` (19/23/23 arquivos) = id da magia do livro e `effects/NN` (15/20/20) = id do efeito/encantamento do item [estimativa, não
conferida por escuta]. Quando tocam no original (ao selecionar o item? ao passar o mouse?) não foi capturado — [est] ao selecionar.
API pronta e testada: `src/town/shopvoices.ts` (`ShopVoices.load/item/book/effect/sayItem`) + `AudioManager.playSpeechSeq(ids)` (sequência
interrompida por `stopSpeech`/outra fala). `ShopScene` chama `sayItem` ao clicar num item da grade (docs/GAPS.md [LIGAÇÕES]).

## Pipeline
`.venv\Scripts\python.exe tools/pipeline/media.py --only speech` (converte) → `tools/pipeline/voices.py` (manifest `voices.json`) →
`tools/pipeline/town.py --only voices` (lista `ui/inn/voices.json` usada por `town/voices.ts`). Nada gerado é redistribuível.
