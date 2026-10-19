# Pacotes baixados (o usuário quer saber de tudo que foi baixado)

| Pacote | Origem | Versão | Onde | Motivo |
|---|---|---|---|---|
| pillow | PyPI | 13.0.0 | `.venv/` | converter sprites/bitmaps em PNG |
| numpy | PyPI | 2.5.4 | `.venv/` | apoio ao Pillow |
| pefile | PyPI | 2024.8.26 | `.venv/` | ler o PE do ROM2 Map Editor (somente leitura) |
| capstone | PyPI | 5.0.9 | `.venv/` | desmontagem estática do editor |
| pixi.js | npm | 8.22.0 | `game/node_modules` | renderização do jogo |
| vite | npm | 6.4.4 | `game/node_modules` | servidor/empacotador de desenvolvimento |
| typescript | npm | 5.9.3 | `game/node_modules` | checagem de tipos |

Acrescente novas linhas abaixo (pacote, origem, versão, tamanho aproximado, motivo).
| pip | `python -m ensurepip` (wheel embutido no próprio Python 3.12; sem rede) | 25.0.1 | `.venv/` | o venv não tinha pip; necessário para instalar `imageio-ffmpeg` (frente MÍDIA) |
| imageio-ffmpeg | PyPI | 0.6.0 | `.venv/` (≈84 MB instalado; binário `ffmpeg-win-x86_64-v7.1.exe` ≈88 MB) | traz um ffmpeg 7.1 (libx264, aac, libvorbis, libmp3lame; lê Smacker `.smk` nativamente) para converter vídeos/áudio em `tools/pipeline/media.py` (frente MÍDIA). Nada instalado no sistema. |
| tsx | npm | 4.23.15 | `game/node_modules` (devDependency; ~12 MB + esbuild ~11 MB) | rodar os testes TypeScript do motor de script sem navegador (`npm run test:script`) — frente SCRIPT |
| puppeteer-core | npm | 24.43.1 (+79 dependências transitivas) | `tools/refcap/ours/node_modules` (≈52 MB; `package.json` próprio, fora de `game/`) | captura automática do nosso jogo (`tools/refcap/ours/capture.mjs`) controlando o Chrome 155 **já instalado** (não baixa navegador). A 25.12.0 foi instalada e removida em seguida: exige Node ≥ 22 (a máquina tem Node 20.19) — frente REF-NOSSO |
| dgVoodoo2 | GitHub oficial `dege-diosg/dgVoodoo2` releases, https://github.com/dege-diosg/dgVoodoo2/releases/download/v2.87.5/dgVoodoo2_87_5.zip | 2.87.5 | zip 9 268 078 B (SHA-256 5ffde6927f7355ca3fdd5d785b581256a8e6539fa13e395a891ade6ba1040850); extraído em `C:\Users\TALES K\Games\_downloads\dgVoodoo2_87_5\`; só `MS\x86\DDraw.dll` (SHA-256 612a2440…6c2e) + `dgVoodoo.conf` copiados para a cópia de execução `C:\Users\TALES K\Games\a2_run` | modo janela do allods2.exe sem trocar a resolução do monitor (frente REF-ORIGINAL). Nada instalado no sistema; C:\GOG Games intocado |
| context-mode (servidor MCP) | npm via npx (mksglu/context-mode, Elastic-2.0) | 1.0.169 | cache do npx; registrado em ~/.claude.json (escopo user, com Node 24 do nvm) | economizar contexto (ferramentas ctx_*); só aparece em uma sessao nova |
| dgVoodoo2 | GitHub oficial dege-diosd/dgVoodoo2 | 2.87.5 | só na copia C:\Users\TALES K\Games2_run | rodar o original em janela sem trocar a resolucao |
