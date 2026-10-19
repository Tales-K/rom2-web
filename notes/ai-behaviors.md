# IA, comportamentos automáticos e magias — allods2.exe (leitura estática) × implementação

Frente MOTOR-C. Ferramentas: `tools/data/x86exe.py` (+ script de apoio no scratchpad: callers, varredura de tabelas de salto,
"campo via ponteiro"). Nunca executado. **[exe]** = lido no código; **[est]** = aproximação nossa; **[UA]** = UnityAllods.
Implementação: `game/src/sim/{ai,behaviors,spells,world}.ts`; testes `game/src/sim/test/ai.ts`.

## Estruturas (unidade no servidor)
- `+0x10` objeto no mapa (célula = `0x54ff9e`), `+0x14` jogador (`+0x2c` ≠ 0 → jogador de IA, `+0x34` → ajustes de IA do jogador),
  `+0x50` código da tarefa, `+0x1c0` parâmetros de movimento/grupo (`+8` = raio de guarda, `+6` posto do grupo, `+0xa` giro),
  `+0x1c4` dados da tarefa/IA: `[0]` posto (word x|y<<8), `+0xc` alvo, `+0x14` alcance de ataque, `+0x40` **Withdraw**, `+0x44` **Wimpy**
  (vida absoluta), `+0x4c` classe de recuo, `+0x71` See invisible, `+0x78` magia escolhida, `+0x7c/+0x88` Spell1..3/Probability1..3.
  `+0x140` livro de magias (`0x51c391(id)` → magia: `+9` alcance, `+0xa` defensiva, `+0xc` mana), `+0x144` bits de efeitos ativos
  (0x10 ProtFire, 0x100 ProtWater, 0x1000 Invisibility, 0x2000 ProtAir, 0x80000 ProtEarth, 0x100000 Bless, 0x200000 Haste, 0x8000000 Shield).
- Carga do template de monstro `0x5114f3`: colunas na ordem de data.bin; scanRange → `+0xa5` (células), Withdraw/Wimpy/SeeInvisible
  → `+0x1c4+0x40/+0x44/+0x71`. Dificuldade fácil divide o Wimpy por 2 (`0x561e93`).

## Tarefas (despachante `0x569321`, switch em `+0x50`)
| código | rotina | o que faz | sim |
|---|---|---|---|
| 0xb Guard | `0x56a5fc` | posto = célula atual (ou do grupo); se longe do posto ≥ scanRange → volta; procura alvos num raio **em volta do posto** (`0x567988`: raio = `+0x1c0+8`); achou → Attack; senão volta ao posto / ocioso | `ai.ts` guard [exe]; revide/alerta além do raio [est] |
| 0xc Stand ground | `0x56a1fb` | percorre inimigos visíveis; distância `0x556dcd` (+1 se o alvo voa e a unidade não); só os ao alcance de ataque `0x56ac5b` (magia escolhida com mana, senão arma `+0x12c`); empate → prioridade `0x55aa21` | `standGroundTarget` [exe; prioridade = mais perto, est] |
| 3 Attack | `0x56acc8` | sorteia Spell1..3 (`rand(100) < prob`, vale a última) e lança no lugar do golpe (Teleport só se alvo a > 2); jogador de IA com livro → `0x57a769`; jogador humano com livro → `0x56b059` (usa a magia escolhida); corpo a corpo com livro → autocast | `rollProc` (1 sorteio por golpe [est]), `pickOffensive` |
| ocioso | `0x56afac/0x56afd9` | arg 0 → Stand ground; arg 1 → IA: conjurador `0x56c592` (Heal em si/aliado mais ferido); humano: autocast `0x56bc7b` | `casterSupport`, `autocast` |
Comandos de grupo do script (`0x577cee`, código = Par0): 1 Guard `0x5709d9` (raio = max(atual, parâmetro) ou ≥ **MinimalGuardRange**
= 8 de ai.reg quando 0), 2 Swarm, 3 Stand ground, 4 Move (usa Formation), 5 Swarm2 (Formation), 10 Attack, 11 Defend, 14 Patrol,
15 Follow, 17 Roam, 18 Dwell (raio mín. 20). [exe]

## Fuga e recuo `0x573713` [exe]
- **Wimpy** `0x56cb0c`: vida ≤ Wimpy e inimigo a ≤ raio de guarda + 5 → foge `0x56c9bc` (Teleport se tiver; senão corre para longe dos inimigos).
- **Withdraw** `0x56cd11`: vida ≤ Withdraw e inimigo a ≤ 2 → recua `0x56ce0f` (Teleport/célula livre afastada). Orc Archer tem Withdraw 90 > vida → sempre recua ("kiting").
- Padrão de unidade do jogador `0x57382c`: conjurador Withdraw = vidaMáx, Wimpy = 1/4; à distância Withdraw = 1/2; corpo a corpo 0.
- **Retreat Mode** (opção "WimpyMode", msg 0x46 sub 1, `0x4f67d5`): p = 0/10/30 % → Wimpy = p% para todos; Withdraw = 0 (corpo a corpo), 2p% (à distância), 3p% (conjurador).
- [est] o herói só aplica a Retreat Mode quando não cumpre ordem direta; recuo só entre um golpe e outro.

## Opções do jogador (mensagem 0x46 ao servidor) [exe]
- sub 2 **Formation**: opção 0/1/2 → servidor 0/2/1 em `jogador+0x34+0x1f`; lida só por Move (`0x5703c0`) e Swarm2 (`0x57063e`). A
  geometria da formação não foi decifrada → [est] slots em fileiras de 3 atrás do líder; "auto" só enquanto o líder anda.
- sub 3 **AutoCasting** (`+0x20`): bits 1/2/4 = alvos próprios/aliados/neutros (`0x56bb53`); 8 = nível 1, 0x10 nível 2, 0x20 nível 3;
  CTRL+U cicla 8 → 0x18 → 0x38 (`0x41a54a`). Autocast `0x56bc7b`: mana < 5 → nada; N1: Heal em si se ferido, Shield em si, Heal no
  primeiro aliado ferido; N2 (mana ≥ 10): Bless em quem luta, Haste; N3 (mana ≥ 40): proteções Ar/Terra/Fogo/Água, Invisibility.

## Conjuradores da IA [exe]
- Ofensiva `0x57a769`: se Mind > 59, 30% das vezes usa a arma; senão sorteio uniforme entre magias conhecidas não defensivas com mana.
- Ociosa `0x56c592` (mana > 10): Heal em si se ferido, senão no aliado mais ferido ao alcance do Heal; `0x57a999` Shield.

## Herói
- Habilidades iniciais `0x514f59`: 20 no alinhamento e **10 na 5ª** (Shooting/Astral) → Aldor: Health 142, XP 7320 (bate com a
  captura em notes/original-capture.md). `heroStartSkills` em sim/stats.ts.
- Ocioso = Stand ground (só ao alcance). [est] reage a quem o feriu de longe (3 s). Guard/Defend/Stand/Retreat/Patrol = ordens do sim.

## Magias (sim/spells.ts)
Tipo por id (bolt, ball, field, wall, cone, heal, drain, shield, buff, debuff, teleport, control, summon). Fórmulas [UA]: dano ×
(poder/30+1), alcance + poder div 30 (Teleport + poder div 3), duração × 1,025^poder, área + poder × 0,1 s. Bless/Curse = chance
(poder %) de dano máx./mín. [exe 0x516ceb]. [est]: magnitude dos efeitos × (poder/30+1); Invisibility vista se SeeInvisible × 10 ≥ poder;
Animate Dead = "Control Spirit" (toma morto-vivo/espírito, poder ≥ 20 × (nível−1)); Summon depende de `summonFactory`; cones ±30°/±45°.
