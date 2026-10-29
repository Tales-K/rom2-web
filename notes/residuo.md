# Resíduo nomeado do tickcmp (2026-10-29)

Ponto de partida: main em 57b8b80, estado inteiro idêntico 97,4 / 98,4 / 98,6 % (m10_start, m10_mage, m20_start), golden 76,5 %.
Lista do resíduo: `notes/magias.md` ("Resíduo"). Lição repetida da etapa 9: **nenhuma das divergências era função do exe não
portada**. Todas eram integração (o motor antigo escrevendo no registro, ou lendo a vista errada) ou o arnês de importação.

## Causas e correções

| Divergência (1.ª) | Causa | Correção |
|---|---|---|
| `post|1` m10_start T=49 ×7, m10_mage T=113 ×6, m20_start T=19 ×5 | **vista**: o posto IA+0 do herói é escrito pelas tarefas portadas (0x56d52b Stand ground, 0x56d4ba, 0x56d6b7), mas `Unit.home` era um campo à parte que só o motor antigo atualizava | `Unit.home` virou vista sobre `rec.ai.f00` (getter/setter); saiu a cópia `home → IA+0` de `exeSyncGroups`. Importação da patrulha guarda o posto do retrato antes de o traço sobrescrever IA+0 |
| `task|1` m10_mage T=241/385/625/755/897 (classe 0xd, o original já em 0xc) | **arnês + integração**. (1) `resumeCast` do tickcmp/diff_window recriava a ordem de magia "agora" (`orderTick` = tique da importação): o pensamento desse tique não a pegava. (2) Com a magia começada (0x56e906 → 0x56dbc6, Stand ground: classe 0xc, posto = célula) a ordem apresentada seguia "cast" | (1) `orderTick` = tique do roteiro em que a ordem chegou. (2) Em `act`, lado humano pelo porte: classe ≠ 0xd com IA+9 = 2 → ordem "none" no mesmo tique (como já era no fim de caminho). Testes `ai.ts`/`necro.ts`/`spell_selected.ts` esperam também IA+9 = 0 |
| `target|1` m10_mage T=609/749/885 | **comparador**: o lado do original é a unidade de IA+0xc (export_state.py) com IA+8 = 5/6/8 ou classe 8/0xd; o nosso vinha da ordem apresentada. A magia em si mesma deixa IA+0xc no último alvo de ataque | `tick_compare.mts` lê alvo e classe do registro (a mesma regra dos dois lados) |
| `task|<IA>` m10_start T=305/561, m20_start T=623/719/911/927 (`o=idle n=move`) | **comparador**: rótulo da classe vinha de `u.order`, que acompanha o registro um tique depois | idem (classe do registro) |
| `target|1` m10_mage T=463 (ataque repetido no mesmo alvo) | **integração**: o servidor trata toda mensagem do cliente, inclusive a igual à ordem em curso (IA+8 = 0, andar+0x7c = 0 até o pensamento); o `World.command` ignorava a ordem igual | `World.command(u, o, client = true)`: reenvio tratado. A interface (`mission/party.ts`), o tickcmp e o diff_window passam `client` |
| `task|24595`/`target`/`g_assigned`, `walk_*` m10_start T=609…817 (14 tiques) | **arnês**: as caídas (vida ≤ 0 sem 0x10) não recebiam o registro do original (`unitRecFromOrig`); o grupo do exe apontava para um registro avulso sem dono (+0x14 com +4 = 0) e AI_EnemyFilter 0x567a16 pelo 1.º membro (caído) tirava todos os candidatos — 0x57240b não atribuía o herói | `applyState`: caída com despejo também importa o registro inteiro |
| `act`/`task`/`target|1` m20_start T=687 (stop logo antes do pensamento) | **integração**: Server_Tick 0x4f08c0 pensa (0x56fe4d) ANTES de Server_ClockTick 0x4f8521 tratar as mensagens (0x4f84c6); o nosso aplicava a ordem antes do passo | `World.clientQueue`: mensagem do cliente antes de um passo com pensamento espera e é tratada depois do pensamento e do World_SecondTick, antes dos objetos de magia e das unidades. Ordens do motor antigo (`legacyOrder`/`legacyAi`, sem `clientOrder`) seguem imediatas |
| `dir16|1` m10_mage T=854 | **integração**: `beginCast` (apresentação, chamada pelo pacote da magia 0x5041d6) virava a unidade para o alvo escrevendo andar+0 | sai o giro; o rumo é só do exe |
| rng m10_start T=737/753/759/823 | consequência de 24595 acima | — |

## Números

| | m10_start | m10_mage | m20_start | golden limpas |
|---|---|---|---|---|
| antes (57b8b80) | 97,4 | 98,4 | 98,6 | 76,50 % |
| depois | **100,0** (960/960) | **99,9** (959/960) | **100,0** (960/960) | **79,43 %** (47 janelas melhores, 1 pior) |

Sorteios iguais por tique: 100 % nos três. `test:sim` verde; `golden --ci` verde com a referência regravada.

## O que sobra

- **m10_mage T=822** (`act|1` 1 × 13, `fx`, `walk_*`): +0x12c do herói. O original tem 6 (o cajado); o `syncCombat` do motor antigo
  escreve todo passo `attackRange(u)` = 7 (`stats.range`) por cima do valor importado. Com 7, AI_Task_Attack/0x56eab5 vê o alvo a 7
  células ao alcance e lança; o original segue andando. Some quando o mundo largar `syncCombat` pelo recálculo portado 0x51366b
  (atributos-base +0x84..+0x130 no despejo e na importação — item já listado na 8b). O par `range|1` (7 × 1, fora da comparação) é o
  mesmo campo.
- **Golden, assinatura nova `alive|t74|ours_dead` ×1** (m10_mage_s126 720–800): janela sem despejo. A importação derivada transforma
  "classe 0xc com IA+8 = 5" (Stand ground atacando) na ordem "attack" do mesmo alvo; o ataque do roteiro em 758 vira reenvio e reinicia
  a perseguição (no original é ordem nova, também tratada). O alvo fica 1 de vida abaixo em 768 e morre no nosso. [est: arnês, importação
  derivada]; sem o reenvio a janela troca para `target|hero|o:none/n:unit`. A antiga `hp|t75` da m10_mage_s114 800 (impacto do cajado)
  saiu.
- Corrida sem reimportar (não fazia parte desta tarefa): 1.ª divergência em T=1 nos três (`g_assigned` dos grupos que atribuem alvo
  no 1.º pensamento; `rng` na m20). Próximo candidato depois da 9b.

## Arquivos

`game/src/sim/world.ts` (home, `command(..., client, now)`, `clientQueue`, `aiTickAt`, fim da ordem de magia, `beginCast`),
`game/src/sim/test/import_state.ts` (caídas, posto da patrulha), `game/src/sim/test/diff_window.ts` (cliente, idade da ordem),
`game/src/mission/party.ts` (só `client = true` nas ordens do jogador), `tools/refcap/diff/tick_compare.mts` (alvo e classe do registro,
cliente, idade da ordem), testes `ai.ts`/`necro.ts`. `spell_selected.ts` recebeu a mesma espera, mas o arquivo não está no git (de outra
sessão): fica no checkout, fora do commit.
