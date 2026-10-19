# allods2-re

Engenharia reversa dos formatos de *Rage of Mages II: Necromancer* (Allods 2, Nival, 1999) para um possível rework web.

- Jogo instalado em `C:\GOG Games\Rage of Mages II` (instalador GOG 2.0.0.5; verificação de segurança feita em 2026-10-17).
- Assets extraídos em `C:\Users\TALES K\Games\allods2-extracted` (fora do OneDrive, 504 MB, não versionar).
- Os arquivos do jogo não ficam neste repositório e não devem ser redistribuídos.

## Ferramentas

```
python -I tools/ya1.py list    "C:/GOG Games/Rage of Mages II/scenario.res"
python -I tools/ya1.py check   "C:/GOG Games/Rage of Mages II/graphics.res"
python -I tools/ya1.py extract "C:/GOG Games/Rage of Mages II/main.res" <pasta_vazia>

# sprites -> PNG (precisa do venv do projeto, que tem Pillow e numpy: uv venv .venv && uv pip install pillow numpy)
.venv/Scripts/python.exe tools/sprites.py "<...>/units/humans/archer/archer.256" saida.png --scale 2
```

## Estado

| Formato | Situação |
|---|---|
| `.res` (`&YA1`) | decifrado e validado nos 10 arquivos; extração completa |
| `.256` / `.16a` | decifrados e exportando PNG; 99,8% dos frames `.256` e 100% dos `.16a` (exceções listadas nas notas) |
| `.alm` (`M7R`) | contêiner resolvido (57/57 mapas); unidades, estruturas, jogadores e **script de missão completo** (ações, condições, gatilhos) legíveis em `data/scripts/`; mapas renderizados com os tiles de terreno (`tools/maprender.py`); faltam tipos 8–12 |
| `.reg` | decifrado (árvore de chaves); `units.reg` mapeia o tipo das unidades dos mapas para nome e sprite; JSONs em `data/reg/` |
| `.bmp`, `.wav`, `.txt` | padrão, já abrem normalmente |

Detalhes e evidências em [notes/formats.md](notes/formats.md), [notes/alm-format.md](notes/alm-format.md) e [notes/reg-format.md](notes/reg-format.md).

## Visualizador web (protótipo)

```
.venv/Scripts/python.exe tools/export_web.py     # mapas + terrenos -> web/
.venv/Scripts/python.exe tools/export_units.py   # sprites de unidades -> web/
.venv/Scripts/python.exe tools/export_objects.py     # árvores, pedras, cercas -> web/
.venv/Scripts/python.exe tools/export_structures.py  # casas, torres, pontes -> web/
cd web && python -m http.server 8765             # abrir http://127.0.0.1:8765/index.html#10
```
Mostra qualquer um dos 57 mapas (terreno, objetos de cenário, estruturas e unidades com sprite e nome, altitude) e o script da missão (em inglês, como no jogo) na lateral.
Os arquivos gerados em `web/assets` e `web/data` contêm dados do jogo: uso local, não redistribuir.

## Jogo web (TypeScript + PixiJS) — `game/`

**Entrega da fatia vertical até a missão 1: [docs/ENTREGA.md](docs/ENTREGA.md)** (como rodar, o que está pronto, limitações). Plano e regras de coordenação em [docs/PLAN.md](docs/PLAN.md); contratos de dados em [docs/DATA.md](docs/DATA.md).
```
tools/build_all.sh                          # gera assets/dados em game/public/ (demorado)
cd game && npm install && npm run dev      # http://127.0.0.1:5173/  (clique para começar; #cena=<nome> pula para uma cena)
npm run typecheck
```
Os assets e dados do jogo em `game/public/{assets,data}` são **gerados** pelos scripts de `tools/` (não versionados, uso local):
`tools/sync_game_assets.sh` (mapas/sprites), `tools/texts_export.py` (textos), `tools/pipeline/*.py` (mídia, menus, cidade, missão).
Pacotes baixados: [docs/DOWNLOADS.md](docs/DOWNLOADS.md). Aproximações e lacunas: [docs/GAPS.md](docs/GAPS.md).

## Próximos passos
1. Fechar as exceções dos sprites (72 frames `.256`, 11 arquivos de layout diferente) e achar a origem do deslocamento de cada frame (hoje alinhamos embaixo/centro).
2. `.alm`: blocos 8–12 e o restante do bloco 0; direção e demais campos das unidades; ligar `Send message N` ao texto de `main/text/mission*.txt`.
3. Animação (andar/atacar/morrer a partir de `units.reg`), sombras, estruturas animadas, e um motor de script que execute os gatilhos.
4. Sons (`sfx.res`, `speech.res`) e música (`music.res`) para o protótipo.
5. Anotar divergências do quebra-cabeça de 12 alavancas da missão do Oráculo quando você testar
   (combinação segundo vertigosn.ru: 1, 5, 6 e 10; 6 e 10 exigem Bola de Fogo).

## Utilitarios
- `tools/check_all_maps.py`: roda o parser em todos os .alm instalados (esperado: 57 de 57).
- `tools/disasm/x86tool.py` e `case.py`: desmontagem estatica do ROM2 Map Editor.exe (capstone), usadas para achar o leitor de .alm.
- `tools/audit_provenance.py`: lista o que o jogo web desenha por conta propria (Graphics, textos literais, DOM) -> `docs/PROVENANCE.md`; candidatos a elementos inventados que nao existem no original.

## Aviso

Projeto de fãs e de estudo, sem afiliação com a Nival, a Monolith ou a GOG. *Rage of Mages II* e *Allods 2* pertencem aos seus donos. Este repositório contém apenas código, ferramentas e notas de pesquisa próprios: nenhum arquivo, imagem, som, vídeo ou dado extraído do jogo. Para gerar os assets é preciso ter uma cópia legítima do jogo (veja `tools/build_all.sh`).
