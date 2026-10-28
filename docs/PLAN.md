# Plano — rework web de Rage of Mages II (TypeScript + PixiJS)

**Meta de entrega (fatia vertical):** abrir o jogo no navegador, ver os logos e o vídeo de abertura com música, passar pelo menu principal e pela
criação de personagem, chegar à primeira cidade (Plagat) com loja e taverna, aceitar a **missão 1** (`scenario/10.alm`, "Great Mage Skrakan"),
jogá-la até o fim com o script da missão funcionando, e voltar à cidade com o resultado salvo.

Fidelidade: reproduzir o jogo original no que os dados permitem; onde a regra original não foi decifrada, usar uma regra plausível e **anotar a lacuna**
em `docs/GAPS.md` (não bloquear por causa disso).

## Fluxo de cenas
`boot → logos → intro → menu → chargen → town(plagat) → inn → briefing → mission(10) → town → …` (veja `game/src/flow.ts`, que é a fonte canônica
dos parâmetros trocados entre cenas). Atalho de desenvolvimento: `http://127.0.0.1:5173/#cena=<nome>` pula direto para uma cena
(`#cena=mission&mission=10`).

## Arquitetura (`game/`)
- Vite + TypeScript estrito + PixiJS 8. Resolução lógica **1024×768** (`SCREEN_W/H` em `src/core/scene.ts`); o quadro é escalado por CSS.
- `src/core/`: `Game` (serviços), `Scene`/`SceneManager`, `AudioManager`, `VideoPlayer`, `DataStore`, `GameState` (salvo em localStorage).
- `src/scenes/<Nome>Scene.ts`: uma cena por arquivo, `export default class X extends Scene`. O registro (`registry.ts`) já aponta para todos os arquivos.
- `src/ui/text.ts`: `makeText` é o único ponto de criação de texto. `src/ui/button.ts`: botão provisório.
- `public/assets/**` (imagens, áudio, vídeo) e `public/data/**` (JSON) são **gerados** pelos scripts de `tools/` a partir dos arquivos extraídos do jogo. Não são versionados
  nem redistribuíveis. Caminhos no código são relativos a `public/` (por exemplo `assets/ui/menu/button1.png`, `data/maps/10.json`).
- Dados já disponíveis: `data/maps/<n>.json` (mapas), `data/units.json`, `data/objects.json`, `data/structures.json`, `assets/{terrain,units,objects,structures}`,
  `data/texts/*.json` (textos do jogo, formato em `tools/texts_export.py`), `data/index.json`.
- Conhecimento dos formatos do jogo: `notes/*.md` (leia `notes/formats.md`, `notes/alm-format.md`, `notes/reg-format.md`).

## Ferramentas e caminhos
- Python do projeto: `C:\Users\TALES K\OneDrive\Desktop\projetos\allods2-re\.venv\Scripts\python.exe` (tem Pillow, numpy, pefile, capstone). Módulos úteis em `tools/`: `ya1.py`, `reg.py`, `alm.py`, `sprites.py`, `descriptions.py`.
- Jogo instalado (**somente leitura, nunca executar nada de lá**): `C:\GOG Games\Rage of Mages II`. Arquivos `.res` já extraídos (somente leitura): `C:\Users\TALES K\Games\allods2-extracted`
  (`graphics/`, `main/`, `music/`, `sfx/`, `speech/`, `video/`, `scenario/`, `world/`, `movies/`).
- Servidor de desenvolvimento: **já está rodando** em `http://127.0.0.1:5173/` (Vite com recarga automática). Não o reinicie. Checagem de tipos: `cd game && npm run typecheck`
  (erros em arquivos de outras frentes, em construção, não são seus; só os seus importam).
- Teste visual: o navegador embutido do app (`mcp__Claude_Browser__*`). **Abra sua própria aba** com `tabs_create` e feche-a ao terminar; use `screenshot` com `scale` ≤ 0.5.
  O painel é estreito (retrato): o quadro 1024×768 aparece centralizado, escalado à largura; calcule as coordenadas de clique a partir do screenshot. Nunca navegue/feche abas que não sejam suas.

## Regras de coordenação (várias frentes trabalham ao mesmo tempo na mesma árvore)
1. Cada frente edita **somente os arquivos que possui** (tabela abaixo). Precisa de mudança em arquivo alheio ou em `core/`? Acrescente uma linha em `docs/REQUESTS.md` (formato: `- [frente] pedido`) e contorne por enquanto.
2. Nada de `npm install` sem registrar; só a frente SCRIPT pode instalar `tsx` (devDependency) para testes. Pacotes Python/npm novos: registre em `docs/DOWNLOADS.md` (nome, origem, versão, tamanho, motivo). Nunca instale software no sistema (sem winget/choco/instaladores).
3. Nunca execute `.exe`, `.dll`, `.bat` do jogo nem do download. Só leitura/extração. Nunca escreva dentro de `C:\GOG Games` nem de `allods2-extracted`.
4. Não faça commits, não mexa em git.
5. Não faça perguntas ao usuário: decida pela opção recomendada, registre a decisão no relatório final e em `docs/GAPS.md` se for uma aproximação.
6. Comentários e documentação em português; código e identificadores em inglês ou português coerente com o arquivo vizinho.
7. Ao terminar, devolva um relatório curto: o que ficou pronto, arquivos criados, como testar, lacunas e riscos.

## Donos de arquivos
| Frente | Pode editar |
|---|---|
| MÍDIA | `tools/pipeline/media.py`, `game/public/assets/{video,audio}/**`, `game/src/core/{audio,video}.ts`, `game/src/scenes/{Logos,Intro,Credits}Scene.ts` |
| DADOS | `tools/data/**`, `notes/data-bin-format.md`, `game/public/data/{items,spells,unit-stats,hero,classes}*.json` e afins, `docs/DATA.md` (seção DADOS) |
| MAPAS-RE | `tools/alm_*.py`, `tools/alm.py`, `notes/alm-format.md`, `game/public/data/scripts/**`, `game/public/data/maps/**` (regenerar), `docs/DATA.md` (seção MAPAS) |
| MENUS | `tools/pipeline/menu.py`, `game/public/assets/ui/{menu,chargen,fonts}/**`, `game/src/scenes/{Menu,Chargen}Scene.ts`, `game/src/ui/**` |
| CIDADE | `tools/pipeline/town.py`, `game/public/assets/ui/{town,shop,inn,globalmap,briefing}/**`, `game/src/scenes/{Town,Shop,Inn,Briefing,GlobalMap}Scene.ts`, `game/src/town/**` |
| MISSÃO | `tools/pipeline/mission.py`, `game/public/assets/ui/{hud,cursors}/**`, `game/src/scenes/MissionScene.ts`, `game/src/mission/**`, `game/src/sim/**` |
| SCRIPT | `game/src/script/**`, `docs/SCRIPT_HOST.md`, `tools/script_*.py` (testes) |
| Orquestrador | `game/src/core/**` (exceto o que MÍDIA possui), `game/src/flow.ts`, `game/src/scenes/{registry,_stub,Boot}*.ts`, `game/src/main.ts`, `docs/PLAN.md`, `docs/REQUESTS.md`, `docs/GAPS.md`, README |

Resolução de conflitos de interface: o que está em `game/src/core/state.ts` e `game/src/flow.ts` é o contrato entre cenas. `MissionResult`/`MissionParams` também.

## Regra: componentizar o que se repete (pedido do usuário)
Elementos de UI/lógica que aparecem em mais de um lugar (botão Ok/classicMenuItem, moldura com caveiras e caixa de texto, diálogo com retrato, lista de slots, hover de item de menu, animação em loop de personagem, barras, tooltip) devem viver em UM componente em `game/src/ui/**` (ou `game/src/town/common.ts` para cidade), reutilizado por todas as cenas. Antes de criar algo novo, procure o existente (Grep) e estenda-o; ao achar cópias, extraia e substitua, sem mudar o visual validado pelo comparador.

## Fidelidade das unidades: porta do servidor (2026-10-27)
Decisão de método em `docs/ABORDAGEM-FIDELIDADE-UNIDADES.md` (problema em `docs/PROBLEMA-FIDELIDADE-UNIDADES.md`): parar a comparação
diferencial por episódio como meio de descoberta; **portar literalmente** o fecho de `Server_Tick` do C decompilado, com estado espelhado
e oráculo por retomada da imagem do processo no Unicorn; critério = estado idêntico por tique, tolerância 0. Ferramentas: skill
`port-exe` (`.claude/skills/port-exe/SKILL.md`, regras da porta e padrões do Ghidra), `tools/re/port_status.py` (lista de trabalho
`port_status.tsv`: `init`/`report`/`next`/`show`/`set`), briefing da etapa 1 em `docs/briefings/ETAPA1-ORACULO-RETOMADA.md`.
Economia: etapa 1 e piloto com modelo forte; lotes de porta com Sonnet em sessões frescas lendo a skill; escalada ao modelo forte só
para `review`. Decisões pendentes do usuário: proveniência do código portado, aceitar a troca do núcleo do sim por partes.
Estado 2026-10-27: etapas 1–4 prontas (oráculo por retomada, inventário de campos, `npm run tickcmp`, piloto com 12 funções a 100 %
dos pares; seção 7.1 do documento). Perfil de execução `tools/re/exec_profile.tsv`. Próximo: `docs/briefings/ETAPA5-ANDAR.md`.
Estado 2026-10-27 (noite): etapas 5–6 prontas (andar portado, 95 funções a 100 % dos pares, e integrado na `World` com o registro do exe
como fonte de verdade; campos do andar 80/82/76 % de tiques idênticos, golden 54,6 % limpas). Próximo: `docs/briefings/ETAPA7-DESPACHANTE.md`.
Estado 2026-10-27 (etapa 7): despachante 0x56dca2 inteiro (30 funções; nenhum NotPorted alcançado no corpus); estado inteiro idêntico
82 % nos 3 episódios, golden 56,9 % limpas (--ci cai só em vida/morte). Próximo: `docs/briefings/ETAPA8-MAQUINA-DE-ACAO.md`.
Estado 2026-10-27 (etapa 8a): máquina de ação 0x50f12c, dano e morte portados; estado inteiro idêntico 87/85/86 %, golden 61,6 % limpas
com --ci verde. Próximo: `docs/briefings/ETAPA9-PENSAMENTO.md` (pensamento da IA); magias (8b) depois.
Estado 2026-10-28 (etapa 9, lote 1): regeneração 0x50fc5a e laço de 1/s portados; estado inteiro idêntico 88/87/88 %, golden 63,1 %
limpas com --ci verde. Bugs de apresentação de 28/10 (itens 1–14) corrigidos (`notes/bugs-2026-10-28.md`). Próximo: lote 2 do pensamento
(`notes/pensamento.md`), lotes 3–4; magias (8b) depois.
