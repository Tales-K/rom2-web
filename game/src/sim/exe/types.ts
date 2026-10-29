/**
 * Registros espelhados do servidor do allods2.exe: cada campo leva o offset e o tamanho do original. Só existem os campos que
 * alguma função portada lê ou escreve (acrescente aqui, com offset/tamanho, quando uma porta nova precisar). Ponteiros do exe
 * viram referências a outro registro espelhado; vtables ficam como o endereço (despacho em `vtables.ts`).
 *
 * Lote piloto (sim/exe/path.ts): Unit_ApproachCell 0x557f08 e o seu fecho.
 * Lote 5a (sim/exe/walk.ts): objeto de mapa completo, registro de ocupação de célula, grade de flags, campos de unidade lidos pelos acessores.
 * Lote 5b (sim/exe/wave.ts): `MapRec` (o objeto de mapa/caminho inteiro, `this` das ondas), listas de caminho e sub-registros da unidade.
 * Lote 5c (sim/exe/walk_action.ts): o andar (`WalkRec` +0x00..+0xb1: giro, passo por tique, alvo), `WorldRec`, unidades por endereço.
 * Etapa 6 (sim/exe/action.ts): campos do despachante 0x56dca2 (unidade +0x50/+0x144, IA +0x14/+0x18, tipo +0x45, mundo +0xbbe8).
 * Etapa 7 (sim/exe/action.ts, rand.ts): olhar em volta (IA +0x54), o sorteio do mundo (mundo +0 divisor, `rng`); golpe/magia como
 * sub-ação (unidade +0x4c/+0x5c/+0x60/+0x64, IA +0x00/+0x30/+0x50/+0x5c/+0x60, a lista de eventos do mundo +0xbbec e o evento +0xbd98);
 * fim de caminho (0x56ed4e: listas do mundo +0x04/+0xa68/+0xa88, diplomacia +0xa8bc, dono +0x04, tipo +0x00, IA +0x71, patrulha IA+0xb4).
 * Etapa 8a (sim/exe/combat.ts): dano físico 0x516f6f (atributos de combate +0xa6..+0xd3, +0x40/+0x48 último golpe, +0x4c bits 8/0x10),
 * golpe recebido 0x56e6b8 (IA +0x54..+0x5a, +0x94..+0x9c, +0xac; relógio de 16/s [[0x6044c4]+4]), diplomacia 0x57977a (dono +0x04 como
 * byte, +0x2c); máquina de ação 0x50f12c (+0x3c modelo, +0x58 fase, +0x6c contador, +0x68/+0x74 itens, +0x86, +0x96, +0x134..+0x13c);
 * morte 0x510a70 (+0x0e, +0x148, +0x1a0, dono +0x38/+0x40/+0xa54).
 * Etapa 9, lote 1 (sim/exe/regen.ts): regeneração 0x50fc5a (+0x98/+0x9e períodos, +0x9c mana máx., +0xa2/+0xa3 restos, +0xde/+0xe2 bônus)
 * e o contentor das listas de unidades [0x68d2dc] (`UnitListsRec`: todas, criadas por magia, cadáveres) de World_SecondTick 0x52bbb7.
 * Etapa 9, lote 2 (sim/exe/think.ts, vision.ts): o GRUPO de IA = o objeto unidade+0x70 (`UnitTypeRec`: lista de membros em +0 e os dados
 * do comando em +0x3c = `UnitStatsRec`: +0x0a parâmetro, +0x20 comando, +0x24..+0x2d centroide/raios, +0x30/+0x34 combate, +0x38 raio-base,
 * +0x45 acordado, +0x48 sempre acordado); o dono (+0x14) com a lista de grupos +0x28 e a máscara +0x32; o mundo com a lista de jogadores
 * ([0x68d2c4]+4), a tabela de classes +0xa54 e os contadores +0xa4c/+0xd720; a unidade +0x88 (Mind), +0xa5 (visão) e +0x1a4 (setor);
 * a IA +0x20 alvo do grupo, +0x24, +0x40/+0x44 Withdraw/Wimpy, +0x7c/+0x88 magias de chance, +0x9e/+0xa0 (Guard da carga do mapa).
 */
import { CListEvent, CListPtr, CListWord, CMapShortOcc } from "./mfc";
import { Rng } from "../rng";

/** Objeto de mapa da unidade (alvo do ponteiro unidade+0x10). Coordenadas em células e fração (1/256 de célula). */
export class MapObjRec {
  x = 0;  // +0x00 u8  célula x            (0x54ffb0, 0x54ff5b)
  y = 0;  // +0x01 u8  célula y            (0x54ffc0, 0x54ff7c)
  cell = 0;  // +0x02 u16 índice da célula y*256+x (0x54ff9e Obj_CellOf; escrito por 0x54f9b9 / 0x54fc41)
  fx = 0; // +0x04 u8  fração x (0..255)   (0x54ff5b)
  fy = 0; // +0x05 u8  fração y (0..255)   (0x54ff7c)
  owner = 0; // +0x08 u32 3º argumento de 0x54f9b9 (ponteiro do dono; só guardado)
}

/** Registro de ocupação de célula (0x3c bytes; valor do CMap em this+0x54084 do mapa, copiado por 0x55385f). Só os campos lidos por 0x5513b6 têm nome. */
export class OccRec {
  static readonly SIZE = 0x3c;
  /** `b` pode ser uma vista dentro de outro registro (o registro corrente em MapRec+0x5402c). */
  constructor(readonly b: Uint8Array = new Uint8Array(OccRec.SIZE)) {}
  get u8_02(): number { return this.b[0x02]; }
  get u8_34(): number { return this.b[0x34]; }
  u32(off: number): number { return (this.b[off] | (this.b[off + 1] << 8) | (this.b[off + 2] << 16) | (this.b[off + 3] << 24)) | 0; }
}

/** Grade de flags por célula (mapa+0x20000, u8[0x10000], índice y*256+x): bit 0x40 marcado por 0x550de0 e lido por 0x550eae. */
export interface FlagGridRec {
  readonly flags: Uint8Array;
}
export const FLAGS_OFF = 0x20000;
/** Grade de bytes em mapa+0x0 (u8[0x10000], índice y*256+x): divisor lido por 0x55687d. */
export interface ByteGridRec {
  readonly bytes: Uint8Array;
}
/** Mapa+0x10000, u8[0x10000]: lido por 0x551edb/0x559bc9 (bit 0x20); só o deslocamento é portado no lote 5a. */
export const GRID10000_OFF = 0x10000;

/** Objeto-sessão com u32 em +0x18b0 (lido por 0x540360). */
export class SessionRec {
  f18b0 = 0; // +0x18b0 u32
}

/** Dados do comando do GRUPO de IA ([[unidade+0x70]+0x3c]; 0x4c bytes). O "tipo" da etapa 5a é o grupo: o comando 0x12 em +0x20 é o
 *  Guard da carga do mapa (0x54d76e testa-o), +0x44 e +0x45 são do grupo. */
export class UnitStatsRec {
  f00 = 0;       // +0x00 u16 célula do comando Guard = centroide +0x28 (0x57026e: AI_GroupCmd_Guard/AI_GuardLoad)
  f0a = 0;       // +0x0a i16 parâmetro do comando: célula (comandos 2, 4, 5, 0x11; 0x5700f3)
  f15 = 0;       // +0x15 u8  contagem do enxame (0x572ec4)
  f20 = 0;       // +0x20 i8  comando: −1 ocioso (Stand ground), 0 tarefas por unidade, 1 Guard (script), 2, 3, 4 andar, 5, 0x11 enxame, 0x12 Guard da carga do mapa, 0x13 (0x5700f3); 0x54d76e testa 0x12
  f24 = 0;       // +0x24 u32 centroide (x | y << 16; 0x56fa63, 0x56f850)
  f28 = 0;       // +0x28 u16 célula do centroide (0x56fa63; 0x5728fa → 0x567e92)
  f2a = 0;       // +0x2a u8  maior distância ao centroide
  f2b = 0;       // +0x2b u8  maior visão (+0xa5) do grupo
  f2c = 0;       // +0x2c u8  max(distância + visão)
  f2d = 0;       // +0x2d u8  raio da guarda (0x5726f7: base + 4 + rand(−1..1); 0x57272c: base + rand(−1..1))
  f30 = 0;       // +0x30 i32 em combate (0x5728fa/0x57275f)
  f34 = 0;       // +0x34 i32 pensamentos seguidos no mesmo estado
  f38 = 0;       // +0x38 i8  raio-base da guarda
  f39 = 0;       // +0x39 u8  (0x5709d9/0x570aba)
  speedByte = 0; // +0x44 u8  se ≠ 0 vale como velocidade, senão usa unidade+0x8c (0x55915a); comando 4: ≠ 0 → IA+0x24 = 1 (0x573198)
  f45 = 0;       // +0x45 u8  acordado: 0 (com mundo+0xbbe8 = 0 e IA+9 = 0) → ação 0x1b, grupo dormindo (0x56dca2); 0x570087 não pensa; 0x55b5f1 escreve
  f48 = 0;       // +0x48 u32 sempre acordado (gatilhos do script 0x562745; 0x55b406)
}
/** Grupo de IA (alvo do ponteiro unidade+0x70; elemento da lista dono+0x28): começa por um CList<void*> das unidades do grupo. */
export class UnitTypeRec {
  addr = 0;      // endereço no exe (identidade na lista de grupos do dono)
  /** +0x00 CList<void*> (cabeçalho 0x1c) das unidades do grupo: AI_EnemyFilter 0x567a16 as percorre para ver invisíveis; o pensamento
   *  do grupo (0x5700f3) as percorre por 0x55f220/0x55f240 */
  members = new CListPtr();
  stats: UnitStatsRec = new UnitStatsRec(); // +0x3c ptr dados do comando
  /** +0x44 ptr dono do grupo (= unidade+0x14 do último membro acrescentado por 0x52af8c; 0x5703c0 lê a formação dele) */
  owner: PlayerRec | null = null;
}
export type GroupRec = UnitTypeRec;
export type GroupDataRec = UnitStatsRec;

/** Sub-registro de andar (alvo do ponteiro unidade+0x1c0). Direções em 1/256 de volta (0x20 = 1/8). */
export class WalkRec {
  dir = 0;        // +0x00 u8  direção atual
  dirTarget = 0;  // +0x01 u8  direção desejada (0x556454, 0x555c7e)
  passMask = 0;   // +0x05 u8  máscara de passagem (AND com as grades +0x10000/+0x20000 do mapa)
  f08 = 0;        // +0x08 u8  raio de guarda da unidade (5: 0x551346; Wimpy = raio + 5 em 0x56cb0c/0x56c9bc; AI_EnemiesAroundPost 0x567988)
  nextCell = 0;   // +0x06 u16 próxima célula (cabeça do caminho dinâmico; 0x555c7e)
  f09 = 0;        // +0x09 u8  contagem de refazer caminho (0xff = refazer já; 0x555411/0x55574d/0x56e4ac)
  turnRate = 0;   // +0x0a u8  passo de giro por tique (0x5551ef, 0x556454)
  f6c = 0;        // +0x6c u32 posto a 1 por 0x56e4ac
  stepFrom = 0;   // +0x70 u16 célula de onde o passo atual partiu (0x555c7e; lido por 0x56fc69 em outras unidades)
  f72 = 0;        // +0x72 u16 velocidade na célula atual (0x55687d; 0x55020a, 0x555b38)
  dest = 0;       // +0x74 u16 célula de destino da ordem (0x555411, 0x55574d)
  f76 = 0;        // +0x76 u16 célula-alvo do caminho dinâmico (0x555dc2)
  f78 = 0;        // +0x78 u8  tiques desde o último refazer do caminho dinâmico
  chaseTarget = 0; // +0x7c u32 unidade perseguida (endereço; 0x55574d)
  footCell = 0;   // +0x80 u16 célula onde a pegada da unidade está marcada (0x55be86; 0 = nenhuma)
  f82 = 0;        // +0x82 u8  célula x ao pôr nas células (0x55020a)
  f83 = 0;        // +0x83 u8  célula y
  f84 = 0;        // +0x84 u8  byte baixo do x fino
  f85 = 0;        // +0x85 u8  byte baixo do y fino
  f86 = 0;        // +0x86 u8  célula x ao tirar das células (0x55073f)
  f87 = 0;        // +0x87 u8  célula y
  f88 = 0;        // +0x88 u8  byte baixo do x fino
  f89 = 0;        // +0x89 u8  byte baixo do y fino
  f8a = 0;        // +0x8a u16 tamanho do caminho estático da perseguição (0x55574d)
  f8c = 0;        // +0x8c u16 célula do alvo perseguido quando o caminho foi feito (0x55574d)
  f90 = 0;        // +0x90 u32 1 = chegou ao fim do caminho estático (0x555411)
  f94 = 0;        // +0x94 u16 célula do alvo no último refazer dinâmico (0x55574d)
  f96 = 0;        // +0x96 u16 célula da unidade no último refazer dinâmico (0x55574d)
  f98 = 0;        // +0x98 u32 posto a 1 por 0x555dc2 quando o caminho dinâmico fica vazio
  f9c = 0;        // +0x9c u8  zerado ao começar um passo (0x555c7e)
  f9d = 0;        // +0x9d u8  tiques de giro contados (0x556454)
  turning = 0;    // +0xa0 u32 1 = girando (0x556454)
  turnTicks = 0;  // +0xa4 u8  tiques de giro previstos (0x556454)
  stepSpeed = 0;  // +0xa8 u16 velocidade do passo, 1..0x3f (0x559195)
  stepTicks = 0;  // +0xaa u16 tiques para atravessar a célula (0x559195)
  stepTick = 0;   // +0xac u16 tique corrente do passo (0x554fd2)
  stepDir = 0;    // +0xae u16 direção do passo, 0..7 (0x559195)
  stepDx = 0;     // +0xb0 i8  avanço x fino por tique (0x559195)
  stepDy = 0;     // +0xb1 i8  avanço y fino por tique
}

/** Sub-registro de tarefa/IA (alvo do ponteiro unidade+0x1c4). */
export class AiRec {
  f00 = 0;        // +0x00 u16 célula do posto do Stand ground (0x56d52b AI_StandGroundAt)
  f02 = 0;        // +0x02 u16 ponto corrente da patrulha (0x56dca2, tarefa +0x50 == 0xa)
  f04 = 0;        // +0x04 u32 posto a 1 no fim do caminho da patrulha (0x56dca2)
  task = 0;       // +0x08 u8  tipo de tarefa (5 = ramo de alcance em 0x54d76e); ação do despachante 0x56dca2 (1 andar, 10 girar)
  sub = 0;        // +0x09 u8  subestado do despachante (3 = continuar o passo: 0x555b38 por tique; posto por 0x56e4ac)
  f0a = 0;        // +0x0a u16 célula (lida por 0x56fc69 em outra unidade)
  f0c = 0;        // +0x0c u32 alvo do ataque (endereço; tarefa 5 0x56eab5 → 0x56ea52)
  f10 = 0;        // +0x10 u32 alvo das classes de tarefa 8/0x11 da unidade (endereço; AI_TaskDispatcher 0x569321 testa se morreu; exec 0)
  f15 = 0;        // +0x15 u8  zerado por 0x56e4ac
  range = 0;      // +0x14 u8  alcance da perseguição (0x56ea52 → 0x55574d)
  f16 = 0;        // +0x16 i16 segundo (contador de 1/s) da última perseguição inalcançável (0x54d76e; 0x5728fa compara)
  target = 0;     // +0x18 u32 unidade perseguida pela tarefa 4 (endereço; 0x56ea52)
  f20 = 0;        // +0x20 u32 alvo atribuído pelo pensamento do grupo (endereço; 0x57240b/0x5725a8; 0x5728fa → AI_Task_Attack)
  f24 = 0;        // +0x24 u16 dx e +0x26 u16 dy da formação (célula − centroide; 0x5703c0/0x57063e), guardados como u32 dx | dy << 16
  f28 = 0;        // +0x28 u32 alvo da magia (endereço; tarefa 8 0x56ebc0 → 0x56ea52)
  f30 = 0;        // +0x30 u32 magia do livro escolhida (endereço do BookSpellRec; 0x569a80; copiada para unidade+0x64 por 0x56e906)
  f38 = 0;        // +0x38 u32 zerado pelo reinício da ordem do grupo (0x570e83)
  f3c = 0;        // +0x3c u16 célula da magia no chão (tarefa 9 0x56ec3f → 0x56e4ac)
  f40 = 0;        // +0x40 i32 vida do Withdraw (0x56cd11: vida ≤ → recua com inimigo a ≤ 2)
  f44 = 0;        // +0x44 i32 vida do Wimpy (0x56cb0c: vida ≤ → foge com inimigo a ≤ raio da unidade + 5)
  f50 = 0;        // +0x50 u32 1 depois de 0x56dbc6 (parar + Stand ground); 0 por 0x56dbfb
  f54 = 0;        // +0x54 u32 1 = sofreu golpe/magia (0x56e6b8): a próxima olhada em volta gira sem o sorteio (0x56e5bc zera)
  f58 = 0;        // +0x58 u16 célula de quem bateu (0x56e6b8)
  f5a = 0;        // +0x5a u8  zerado por 0x56e6b8
  f5c = 0;        // +0x5c u32 1 = a magia em curso mira uma unidade (0x56e906); 0 = célula (ação 0xe e evento 3 no despachante)
  f60 = 0;        // +0x60 u32 0 → 0x56e906 chama 0x56dbc6 (parar); zerado por 0x56d969
  f6c = 0;        // +0x6c u32 1 = comando 4 do grupo com +0x44 ≠ 0 (0x573198)
  f71 = 0;        // +0x71 u8  alcance de ver invisível (AI_EnemyFilter 0x567a16)
  spellSlot = 0;  // +0x78 u8  magia do livro escolhida (0 = nenhuma; 0x56ac5b)
  /** +0x7c i32[3] magias de chance (id; 0 = nenhuma) e +0x88 i32[3] a probabilidade de cada uma (rand() < p; AI_Task_Attack 0x56acc8) */
  f7c = new Int32Array(3);
  f88 = new Int32Array(3);
  f94 = 0;        // +0x94 u32 quem bateu por último (endereço; 0x56e6b8)
  f98 = 0;        // +0x98 u32 relógio de 16/s do último golpe recebido ([[0x6044c4]+4]; 0x56e6b8)
  f9c = 0;        // +0x9c u16 ponto de fuga y<<8 | x: célula + 10 × (vítima − agressor)/max(|dx|,|dy|) (0x56e6b8)
  f9e = 0;        // +0x9e u8  Guard da carga do mapa (0x5728fa): ≠ 0 → anda para +0xa0 e conta até 10
  fa0 = 0;        // +0xa0 u16 célula alternativa do Guard da carga do mapa (0x5728fa)
  fa4 = 0;        // +0xa4 u32 id da última magia que a IA lançou NESTA unidade (AI_CastAtTarget 0x56c72b escreve no alvo)
  fa8 = 0;        // +0xa8 u32 relógio de 16/s dessa magia ([[0x6044c4]+4]; 0x56c72b)
  fac = 0;        // +0xac u32 golpes recebidos de quem não era inimigo (0x57977a: > 10 → guerra de volta)
  fb0 = 0;        // +0xb0 u16 destino do teleporte da célula (0x5503af, registro de ocupação de tipo 0x17)
  /** +0xb4 ptr CList<WORD> dos pontos da patrulha (y<<8 | x), na ordem do roteiro: 0x57b020 Find, 0x55f1f0 GetNext e 0x55f0d0
   *  GetHead no fim do caminho da patrulha (0x56dca2) */
  patrol = new CListWord();
}

/** Dono da unidade (alvo do ponteiro unidade+0x14; elemento da lista de jogadores [0x68d2c4]+4). */
export class PlayerRec {
  addr = 0;       // endereço no exe (identidade)
  f04 = 0;        // +0x04 i16 id do jogador (índice na tabela de diplomacia do mundo, 0x57994d; byte em 0x57977a)
  /** +0x28 ptr → CList<void*> (cabeçalho 0x1c) dos grupos de IA do jogador (0x570087: 0x57b140/0x57b160; 0x55b879) */
  groups = new CListPtr();
  f2c = 0;        // +0x2c u32 0 → 0x54d76e testa Path_TargetFree (onda estática de 1000); ≠ 0 = jogador de IA (0x57977a não avisa o cliente)
  f32 = 0;        // +0x32 u16 máscara do jogador (0x55aca2: marca os setores de 8×8 em volta das unidades do lado humano)
  /** [+0x34]+0x1f u8 formação do jogador (0x5703c0/0x57063e: 2 = os membros andam em formação, com deslocamentos IA+0x24/+0x26 em
   *  relação ao centroide, se nenhum estiver a mais de mundo+0xa724 células dele; 2 em todos os jogadores das 3 imagens do oráculo) */
  formation = 2;
  /** [+0x34]+0x20 u8 AutoCasting do jogador (Game Options; 0x56bb53/0x56bc7b): bits 1/2/4 alvos (próprias, aliadas, neutras), 8 nível 1
   *  (Heal/Shield), 0x10 nível 2 (Bless/Haste), 0x20 nível 3 (proteções/Invisibility) */
  autocast = 0;
  f38 = 0;        // +0x38 u32 unidade-herói do jogador (endereço; 0x50f12c, 0x510a70)
  f40 = 0;        // +0x40 u8  (0x510a70: id do modelo − 0x13)
  fa54 = 0;       // +0xa54 i32 contagem de mortes do herói (0x510a70)
}

/** Magia do livro (elemento do CArray do livro). */
export class BookSpellRec {
  addr = 0;       // endereço no exe (identidade do ponteiro devolvido por 0x51c391)
  id = 0;         // +0x08 u8  id da magia (0x516ceb, 0x510745)
  range = 0;      // +0x09 u8  alcance (0x56ac5b)
  f0a = 0;        // +0x0a u8  ≠ 0 = magia de apoio (alvo aliado: 0x57a999 só sorteia estas; 0x56c72b procura aliados em vez de inimigos)
  cost = 0;       // +0x0c i16 custo de mana
  /** +0x04 ptr definição da magia → CArray<int> em +8: elemento 0 = nível ("Complication Level"; byte baixo somado à espera em 0x50f12c) */
  def0 = 0;
  /** +0x04 ≠ 0 (Spell_SpendMana 0x519998: sem definição → 0) */
  hasDef = true;
  /** elementos 4 (1 → aviso ao cliente 0x5041d6 com o alvo, 0x519441; senão 0x5042ba com a célula) e 5 (2 = projétil: o gasto não
   *  olha o modelo da unidade) da definição (0x41e7e0) */
  def4 = 0;
  def5 = 0;
}

/** Item (alvo dos ponteiros unidade+0x68 em uso / +0x74 arma / +0x78). */
export class ItemRec {
  addr = 0;       // endereço no exe (identidade)
  f40 = 0;        // +0x40 u16 classe/forma: 0x53bff0 = (v >> 8) & 0xf (0xe = consumível: 0x50f12c solta o item e a magia)
  f42 = 0;        // +0x42 i16 cargas/contador (0x50f12c, 0x516b2f)
  f44 = 0;        // +0x44 u8  2 → 0x510745 não cancela
  f4a = 0;        // +0x4a i16 peso (espera extra da arma em 0x50f12c)
  tplF0f = 0;     // [+0x3c modelo do item → CArray +8][0xf]: ≠ 0 → a arma vai para a mochila na morte (0x510a70; exec 0)
  spell: BookSpellRec | null = null; // +0x84 ptr magia que a arma lança (0x542580 Weapon_CastsSpell)
}

/** Modelo da unidade (alvo do ponteiro unidade+0x3c): nome em +4 e CArray<int> dos parâmetros em +8 (dados em [+0xc]). */
export class TemplateRec {
  addr = 0;                        // endereço no exe (identidade)
  name = "";                       // +0x04 texto (0x510a70 procura "NPC")
  /** +0x08 CArray<int>: dados em [+0x0c], tamanho em +0x10 (0x4e8560). Elementos lidos: 0x21 duração da queda (0x50f048), 0x17
   *  (0x512526), 0x26..0x2c saque (0x510a70), 0xf (0x510a70, arma) */
  arr = new Int32Array(0x40);
  arrSize = 0;
}

/** Atributos de dano do golpe (unidade+0xa6; 0x516f6f recebe o ponteiro: também structs avulsas das magias). */
export class DmgRec {
  atk = 0;        // +0x00 i16 ataque (toHit)
  dmin = 0;       // +0x0e u8  dano mínimo (bit 0x80: ×15 contra quem não tem equipamento, vtable+0x30 = 0)
  dadd = 0;       // +0x0f u8  faixa do dano (rand(0..dadd))
  wtype = 0;      // +0x10 u8  tipo de arma: índice na tabela de resistências +0xce
  elA0 = 0;       // +0x11 u8  dano elemental A: base (contra a proteção de água +0xc6)
  elA1 = 0;       // +0x12 u8  dano elemental A: faixa
  elB0 = 0;       // +0x13 u8  dano elemental B: base (contra a proteção do elemento elK)
  elB1 = 0;       // +0x14 u8  dano elemental B: faixa
  elK = 0;        // +0x15 u8  elemento de B (1 fogo, 2 água, 3 ar, 4 terra, 5 astral) e do golpe (unidade+0x48 da vítima)
}

/** Livro de magias (alvo do ponteiro unidade+0x140): CArray<BookSpellRec*> em +4 (m_pData +8, m_nSize +0xc). */
export class SpellBookRec {
  spells: (BookSpellRec | null)[] = []; // +0x04 CArray (ponteiro nulo = slot vazio; índice = id da magia; 28 slots nas imagens do oráculo)
  /** não é do exe: assinatura das magias do motor antigo de que o espelho foi feito (World.exeSyncGroups só o refaz quando ela muda) */
  src: unknown = null;
  last = 0;       // +0x18 i32 último índice consultado (escrito por 0x51c391)
}

/** Unidade do servidor (0x1d0 bytes no registro de objs da sonda; as listas de caminho vão até +0x200). */
export class UnitRec {
  /** Endereço do registro no exe: identidade dos ponteiros de unidade guardados como u32 (OccRec +0x2c/+0x30, MapRec+0x54058). */
  addr = 0;
  vtbl = 0;                    // +0x000 u32 vtable (0x5d0eb0 / 0x5d0f40 / 0x5d0fb8)
  f04 = 0;                     // +0x004 u32 id da unidade no mapa (u16; 0x5110b8 zera ao sumir o corpo)
  f0e = 0;                     // +0x00e u16 id do modelo (0x510a70: ≥ 0x40 monstro com saque; 0x5110b8: 0x21..0x24 param em −60)
  mapObj: MapObjRec = new MapObjRec(); // +0x010 ptr objeto de mapa
  owner: PlayerRec = new PlayerRec();  // +0x014 ptr dono
  tpl: TemplateRec | null = null;      // +0x03c ptr modelo (0x542560: nulo → sem despachante/sem marcar o agressor)
  f40 = 0;                     // +0x040 u32 quem deu o último golpe (endereço; 0x516f6f)
  f44 = 0;                     // +0x044 u32 magia do livro escolhida para a ordem de lançar do cliente (endereço do BookSpellRec; o despachante de pacotes 0x4f515d a põe, 0x5702be a usa e zera)
  /** +0x043 u8: o byte alto do ponteiro +0x40 (0x5160ef lê +0x43 de OUTRO objeto, o do jogador; o campo ficou do lote 5a) */
  get f43(): number { return (this.f40 >>> 24) & 0xff; }
  set f43(v: number) { this.f40 = ((this.f40 & 0x00ffffff) | ((v & 0xff) << 24)) >>> 0; }
  f48 = 0;                     // +0x048 u8  elemento do último golpe (0x516f6f: DmgRec.elK se o agressor tem o bit 0x10, senão 0)
  size = 0;                    // +0x049 u8  lado em células (lido pelo slot 0x1c da vtable, 0x542360)
  kind = 0;                    // +0x04a u8  lido pelo slot 0x20 das vtables (0x542380); 1 = ramo "grade" de 0x55687d; > 1 → some ao morrer
  f4c = 0;                     // +0x04c u8  bits: 4 "fora de combate" (0x542c90), 8 imune a dano físico (0x516f6f), 0x10 acerta sempre e ignora absorção (0x53a5a0: arma lança magia; tarefa 6, 0x56eff3)
  task = 0;                    // +0x050 u32 classe da tarefa (1 andar, 0xa patrulha, 0x18...: ramo do fim do caminho em 0x56dca2)
  act = 0;                     // +0x054 u32 ação corrente (1 = andar, 3 golpe, 0xd/0xe magia, 0x10 morta; 0x56e4ac, 0x56e8c3, 0x56e906)
  f58 = 0;                     // +0x058 u32 fase da máquina de ação (0 início, 5 carga, 7 espera; 0x50f12c)
  f5c = 0;                     // +0x05c u32 alvo do golpe/da magia em curso (endereço; 0x56e8c3 ← IA+0xc, 0x56e906 ← IA+0x28)
  f60 = 0;                     // +0x060 u32 célula da magia no chão (byte x, byte y; evento 3 do despachante)
  f64 = 0;                     // +0x064 u32 magia em curso (endereço do BookSpellRec; 0x56e906 ← IA+0x30)
  f68: ItemRec | null = null;  // +0x068 ptr item em uso (a magia +0x64 vem dele; 0x50f12c, 0x510745)
  f6c = 0;                     // +0x06c u8  contador de tiques da fase (char no exe; 0x50f12c)
  type: UnitTypeRec = new UnitTypeRec(); // +0x070 ptr tipo da unidade
  f74: ItemRec | null = null;  // +0x074 ptr arma equipada (0x50f12c, 0x516ceb)
  f78: ItemRec | null = null;  // +0x078 ptr escudo/item solto ao morrer (0x510a70)
  f86 = 0;                     // +0x086 i16 Reaction (espera extra da arma em 0x50f12c)
  f88 = 0;                     // +0x088 i16 Mind (AI_TargetCost 0x5711ea: > 14 pesa o custo das classes 1 e 4)
  speed = 0;                   // +0x08c i16 velocidade da unidade (0x55915a)
  f94 = 0;                     // +0x094 i16 vida (0x516ceb subtrai o dano; < 1 → queda em 0x50f12c; 0x56fc69)
  f96 = 0;                     // +0x096 i16 vida máxima (0x57977a)
  f98 = 0;                     // +0x098 i16 período da regeneração de vida (0 = não regenera; 0x50fc5a)
  mana = 0;                    // +0x09a i16 mana (comparada ao custo da magia em 0x56ac5b; 0x50fc5a regenera)
  f9c = 0;                     // +0x09c i16 mana máxima (0x50fc5a)
  f9e = 0;                     // +0x09e i16 período da regeneração de mana (0x50fc5a divide por ele sem testar 0)
  fa2 = 0;                     // +0x0a2 u8  resto (centésimos) da regeneração de vida (0x50fc5a)
  fa3 = 0;                     // +0x0a3 u8  resto (centésimos) da regeneração de mana (0x50fc5a)
  fa5 = 0;                     // +0x0a5 u8  visão em células (Vision_Compute 0x552c28: orçamento (visão << 7) + 64; 0x56fa63)
  dmg: DmgRec = new DmgRec();  // +0x0a6 atributos do golpe (ponteiro passado a 0x516f6f)
  fbe = 0;                     // +0x0be i16 defesa (0x516f6f; ÷ 2 na queda, 0x50f12c)
  fc0 = 0;                     // +0x0c0 i16 absorção (0x516f6f)
  /** +0x0c2 i16[6] proteções: [1] fogo +0xc4, [2] água +0xc6, [3] ar +0xc8, [4] terra +0xca, [5] astral +0xcc (0x516f6f) */
  prot = new Int16Array(6);
  /** +0x0ce u8[6] resistências físicas por tipo de arma (índice DmgRec.wtype; 0x516f6f) */
  resist = new Uint8Array(6);
  fde = 0;                     // +0x0de i16 bônus % da regeneração de vida (0x50fc5a: × (bônus + 100))
  fe2 = 0;                     // +0x0e2 i16 bônus % da regeneração de mana (0x50fc5a)
  attackRange = 0;             // +0x12c u8  alcance sem magia (0x56ac5b, 0x516ceb)
  f134 = 0;                    // +0x134 u8  charge: tiques da fase 5 (0x50f12c)
  f135 = 0;                    // +0x135 u8  relax: tiques da fase 7 (0x50f12c)
  ready = 0;                   // +0x136 u8  pedido pronto (0x56dca2: golpe, IA+9 == 1)
  f138 = 0;                    // +0x138 u32 relógio de 16/s até o qual a unidade está ocupada (0x5040c4, 0x504155; 0x50fc3e)
  f13c = 0;                    // +0x13c u8  estado do corpo: 0 de pé, 1 caída (0x50f12c), 2..5 decomposição (0x5110b8)
  book: SpellBookRec = new SpellBookRec(); // +0x140 ptr livro de magias
  hasBook = false;             // +0x140 ≠ 0 (0x56c9bc: só quem tem livro tenta fugir por Teleport)
  effects = 0;                 // +0x144 u32 bits de efeito = 1 << id da magia (0x40000 → IA+9 = 4; 0x100000 Bless, 0x10000000 Curse, 0x1000 Invisibility)
  f148 = 0;                    // +0x148 u32 id de quem invocou (0x510a70: vida −10000)
  f14c = 0;                    // +0x14c u16 (0x510a70: dono+0x40 = valor − 0x13 no jogo não local)
  f1a0 = 0;                    // +0x1a0 u32 levantada/invocada: sem saque (0x510a70)
  f1a4 = 0;                    // +0x1a4 u16 máscara dos jogadores humanos perto (setor de 8×8; 0x55b5f1/0x55b406; 0 = longe)
  walk: WalkRec = new WalkRec();           // +0x1c0 ptr andar
  ai: AiRec = new AiRec();                 // +0x1c4 ptr tarefa/IA
  pathStatic = new CListWord();            // +0x1c8 CList<WORD> caminho estático (0x54e58c)
  pathDynamic = new CListWord();           // +0x1e4 CList<WORD> caminho dinâmico (0x54e886)
}

/** Objeto global [0x6044c4] (jogo/servidor): +0 contador de 1/s (lido como int em 0x50fc5a/0x5110b8, short em 0x54d76e; vira no fim do
 *  tique com relógio ≡ 0xf), +4 relógio de 16/s (0x56e6b8, 0x50fc3e, 0x5040c4), +0x74 ≠ 0 = jogo local (0x50f12c, 0x510a70). A World
 *  escreve antes de cada chamada da máquina; o teste lê da memória. */
export const EXE_GLOBALS = { w6044c4: 0, clock16: 0, f74: 1 };

/** Objeto de busca de caminho (o `this` de 0x557f08 / 0x55f970). */
export interface PathRec {
  /** +0x30000 u16[256*256] custo da onda por célula, índice y*256+x (0xffff = não alcançada). */
  readonly cost: Uint16Array;
  /** +0x54156 i8[2*N] passo (dx,dy) da volta no anel, indexado por direção*2 (+0 dx, +1 dy). */
  readonly ringStep: Int8Array;
}

export const PATH_COST_OFF = 0x30000;
export const PATH_RING_STEP_OFF = 0x54156;
/** Entradas (dx,dy) espelhadas em `ringStep` (direções 0..11; os pares só leram 1..10). */
export const PATH_RING_STEP_N = 12;

export function newPathRec(): PathRec {
  return { cost: new Uint16Array(256 * 256), ringStep: new Int8Array(PATH_RING_STEP_N * 2) };
}

/** Estrutura apontada por OccRec+0xc (objeto fixo na célula; lido por 0x550a96). */
export class CellStructRec {
  mapObj: MapObjRec = new MapObjRec(); // +0x10 ptr objeto de mapa (canto)
  f42 = 0;                             // +0x42 u16 máscara dos jogadores humanos nos blocos em volta (0x55b507, a cada pensamento)
  width = 0;                           // +0x60 u8  largura em células
  cellMask = 0;                        // +0x64 u32 bit (dy*largura+dx): célula ocupada pela estrutura
}

export const MAP_MASK_OFF = 0x10000;
export const MAP_WIDTH_OFF = 0x50000;   // i32 largura (células jogáveis; borda de 8)
export const MAP_HEIGHT_OFF = 0x50004;  // i32 altura
export const MAP_QA_X_OFF = 0x50008;    // u8[0x1000] fila A (x) da onda de unidade grande
export const MAP_QA_Y_OFF = 0x51008;    // u8[0x1000] fila A (y)
export const MAP_QB_X_OFF = 0x52008;    // u8[0x1000] fila B (x)
export const MAP_QB_Y_OFF = 0x53008;    // u8[0x1000] fila B (y)
export const MAP_QA_N_OFF = 0x54008;    // u16 tamanho da fila A
export const MAP_QB_N_OFF = 0x5400a;    // u16 tamanho da fila B
export const MAP_OCC_CUR_OFF = 0x5402c; // OccRec corrente (0x3c)
export const MAP_OCC_UNIT_OFF = 0x54058;  // u32 = occCur+0x2c unidade (tipo ≠ 3) na célula
export const MAP_OCC_UNIT3_OFF = 0x5405c; // u32 = occCur+0x30 unidade de tipo 3 na célula
export const MAP_OCC_MAP_OFF = 0x54084; // CMap<short,OccRec> (cabeçalho 0x1c)
export const MAP_DEFAULT_COST_OFF = 0x5414b; // u8 custo de passo padrão (0x550a96)
export const MAP_QA_OFF = 0x54584;      // u16[0x1000] fila A (células) da onda de 1 célula
export const MAP_QB_OFF = 0x56584;      // u16[0x1000] fila B (células)
export const MAP_WAVES_STATIC_OFF = 0x58584;  // i32 ondas extras da busca estática
export const MAP_WAVES_DYNAMIC_OFF = 0x58588; // i32 ondas extras da busca dinâmica
export const MAP_DYN_NEAR_OFF = 0x58594;  // i32 distância (Chebyshev) até a qual o caminho dinâmico é refeito (0x555dc2)
export const MAP_DYN_LEN_OFF = 0x58598;   // i32 tamanho da lista estática acima do qual o alvo dinâmico sai dela
export const MAP_FOOT_OFF = 0xa452c;    // u8[8*8] rascunho da pegada (0x55be86)
export const MAP_RINGS_OFF = 0x5400c;   // objeto de 0x54ec6a: +4 CList<void*> de unidades (MapRec.ringUnits, cabeçalho 0x1c)
export const MAP_OCC_P04_OFF = 0x54030; // u32 = occCur+4 unidade (tipo 1/2) que ocupa a célula (0x5503af, 0x55073f, 0x551edb)
export const MAP_OCC_P08_OFF = 0x54034; // u32 = occCur+8 unidade de tipo 3
export const MAP_OCC_KIND_OFF = 0x54060; // u8 = occCur+0x34 tipo de objeto na célula (0x17 = teleporte)
export const MAP_OCC_TX_OFF = 0x54064;  // u8 = occCur+0x38 destino x do teleporte
export const MAP_OCC_TY_OFF = 0x54065;  // u8 = occCur+0x39 destino y
export const MAP_PATH_STATIC_N_OFF = 0x5858c; // i32 refazeres do caminho estático tolerados (0x555411)
export const MAP_DYN_TICKS_OFF = 0x58590; // i32 tiques entre refazeres do caminho dinâmico (0x555411, 0x55574d)
export const MAP_WORLD_OFF = 0x58d80;   // ptr mundo (WorldRec; `this` de 0x56fc69)
export const MAP_SPEED_MUL_OFF = 0x58d84; // i32 multiplicador de velocidade (0x559195)
export const MAP_DIR_DX_OFF = 0x58e88;  // i8[8] dx da direção 0..7 (0x559195)
export const MAP_DIR_DY_OFF = 0x58e90;  // i8[8] dy
export const MAP_DIR_CELL_OFF = 0x58e98; // i32[8] passo do índice de célula da direção (0x559195)
export const MAP_ALT_OFF = 0x944f4;     // i8[0x10000] altitude por célula (0x559195)
export const MAP_RECT_OFF = 0x58eb8;    // u8[4] área útil x0, y0, x1, y1 (0x559536)
/** Objeto de visão em mapa+0x58ec0 (0x552c28; vision.ts): +0x22000 i8[2] pai de cada célula da janela 41×41 ([x × 0x80 + y × 2]),
 *  +0x24000 i32 orçamento ([x × 0x100 + y × 4]), +0x28000 i16 custo do passo, +0x2a004 u32 deslocamento do orçamento, +0x2a008 u8[0x10000]
 *  células vistas, +0x3a008 ptr mapa. */
export const MAP_VISION_OFF = 0x58ec0;
export const VIS_PARENT_OFF = 0x22000, VIS_BUDGET_OFF = 0x24000, VIS_COST_OFF = 0x28000, VIS_SHIFT_OFF = 0x2a004, VIS_SEEN_OFF = 0x2a008, VIS_MAP_OFF = 0x3a008;
/** Objeto dos setores em mapa+0x92ecc (0x55b5f1): +0x404 i32[34][34] máscara dos jogadores humanos por bloco de 8×8 ([(bx + 1) × 0x88 +
 *  (by + 1) × 4], borda de 1 bloco; zerado de +0x400 por 0x1210), +0x1610 ptr contentor das unidades, +0x1614/+0x1618/+0x1624 contadores. */
export const MAP_WAKE_OFF = 0x92ecc;
export const WAKE_TABLE_OFF = 0x404, WAKE_F1614_OFF = 0x1614, WAKE_F1618_OFF = 0x1618, WAKE_F1624_OFF = 0x1624;

/**
 * Objeto de mapa/caminho do servidor (o `this` das ondas, de 0x55be86 e da ocupação; até +0xa456c): espelhado byte a byte
 * num único buffer pelo offset (um estouro de fila cai dentro do objeto como no exe), com vistas tipadas para as grades.
 * O CMap de ocupação (+0x54084) é objeto JS (mfc.ts); os 0x1c bytes do cabeçalho dele no buffer ficam sem uso.
 * Ponteiros guardados como u32 nos registros de ocupação resolvem-se por `structs` (endereço → registro espelhado).
 */
export class MapRec implements PathRec, FlagGridRec, ByteGridRec {
  static readonly SIZE = 0xa4570;
  readonly mem = new Uint8Array(MapRec.SIZE);
  readonly dv = new DataView(this.mem.buffer);
  /** +0x00000 u8[0x10000] custo de passo por célula. */
  readonly bytes = this.mem.subarray(0, 0x10000);
  /** +0x10000 u8[0x10000] máscara estática (0x20 = tem registro de ocupação; 0x10; 1|4 bloqueio). */
  readonly mask = this.mem.subarray(MAP_MASK_OFF, MAP_MASK_OFF + 0x10000);
  /** +0x20000 u8[0x10000] máscara dinâmica (FLAGS_OFF). */
  readonly flags = this.mem.subarray(FLAGS_OFF, FLAGS_OFF + 0x10000);
  readonly cost = new Uint16Array(this.mem.buffer, PATH_COST_OFF, 0x10000);
  readonly ringStep = new Int8Array(this.mem.buffer, PATH_RING_STEP_OFF, PATH_RING_STEP_N * 2);
  /** +0x5402c registro de ocupação corrente (vista no buffer). */
  readonly occCur = new OccRec(this.mem.subarray(MAP_OCC_CUR_OFF, MAP_OCC_CUR_OFF + OccRec.SIZE));
  /** +0x54084 CMap<short,OccRec> ocupação por célula. */
  occ = new CMapShortOcc();
  /** +0x54010 CList<void*> de endereços de unidade (dentro do objeto em +0x5400c; 0x54ec6a). */
  ringUnits = new CListPtr();
  /** +0x58d80 ponteiro para o mundo. */
  world: WorldRec | null = null;
  readonly structs = new Map<number, CellStructRec>();
  /** Unidades pelo endereço (ponteiros u32 guardados no mapa: occCur+4, lista de 0x54ec6a). */
  readonly units = new Map<number, UnitRec>();

  u16(off: number): number { return this.dv.getUint16(off, true); }
  setU16(off: number, v: number): void { this.dv.setUint16(off, v & 0xffff, true); }
  i32(off: number): number { return this.dv.getInt32(off, true); }
  u32(off: number): number { return this.dv.getUint32(off, true); }
  setU32(off: number, v: number): void { this.dv.setUint32(off, v >>> 0, true); }
  i8(off: number): number { return this.dv.getInt8(off); }
  unitAt(addr: number): UnitRec {
    const u = this.units.get(addr >>> 0);
    if (!u) throw new Error(`unidade 0x${(addr >>> 0).toString(16)} sem registro espelhado`);
    return u;
  }
  structAt(addr: number): CellStructRec {
    const r = this.structs.get(addr >>> 0);
    if (!r) throw new Error(`estrutura 0x${(addr >>> 0).toString(16)} (OccRec+0xc) sem registro espelhado`);
    return r;
  }
}

/** Evento do servidor para a IA (0x54 bytes; o rascunho em mundo+0xbd98 é copiado por valor para a lista mundo+0xbbec). Campos
 *  escritos pelo despachante 0x56dca2: +0 tipo (2 magia na unidade, 3 magia na célula), +4 x, +8 y, +0x2c unidade, +0x30 magia,
 *  +0x34 alvo. Os bytes não escritos ficam como estavam (o exe copia o rascunho inteiro). */
export const EVENT_SIZE = 0x54;

/** Contentor das listas de unidades do servidor ([0x68d2dc]; o `this` de World_SecondTick 0x52bbb7): três CList<void*> de endereços de
 *  unidade. Uma unidade morta (Unit_Die, ação 0x10) sai de `all` e entra em `corpses`; `magic` guarda as criadas por magia
 *  (Summon/Animate Dead; [0x672f64] aponta para +0x20). */
export class UnitListsRec {
  /** +0x04 todas as unidades do mapa, na ordem de criação, caídas incluídas (0x52bbb7: vtable+0x14 = Unit_Regen em cada uma). */
  all = new CListPtr();
  /** +0x24 unidades criadas por magia ([0x672f64]+4): o desgaste das invocações conta as com +0x148 ≠ 0 (0x52bbb7). */
  magic = new CListPtr();
  /** +0x44 cadáveres ([[0x6044c4]+0x7c]+0xc+4), na ordem da morte (0x52bbb7: Corpse_Decay 0x5110b8 em cada um). */
  corpses = new CListPtr();
  /** [[0x6044c4]+0x7c]+4 (+4): objetos fixos do mapa (CellStructRec; 0x55b5f1 → 0x55b507 escreve +0x42). Não é do contentor [0x68d2dc]. */
  structs = new CListPtr();
}

/** Mundo/servidor (o `this` de 0x56dca2, 0x56e4ac, 0x56fc69 e dos sorteios 0x57afc0/0x57afd0). */
export class WorldRec {
  /** as listas de unidades do servidor ([0x68d2dc]: não é parte do objeto mundo; fica aqui por ser o estado que 0x52bbb7/0x571c4d percorrem) */
  lists = new UnitListsRec();
  divisor = 0x8000;                  // +0x0000 u32 divisor do objeto de sorteio uniforme (0x57afd0: rand() × n / divisor)
  /** [mapa+0xa456c]+4 = o contentor das unidades [0x68d2dc] (todas, caídas incluídas; 0x56ed4e e 0x571c4d a percorrem): `lists.all`.
   *  (Até o lote 1 da etapa 9 era tida como "mundo+4"; os pares de 0x52bbb7 mostraram que é o mesmo objeto.) */
  get liveUnits(): CListPtr { return this.lists.all; }
  set liveUnits(l: CListPtr) { this.lists.all = l; }
  /** +0xa68 (objeto +0xa64, lista em +4) CList<void*> dos candidatos a alvo no fim do caminho (0x56ed4e, 0x567ddf, 0x567a16). */
  cand = new CListPtr();
  /** +0xa88 (objeto +0xa84) CList<void*> dos candidatos caídos (vida +0x94 < 1; 0x567ddf). */
  dead = new CListPtr();
  /** +0xaa8 (objeto +0xaa4) CList<void*> dos candidatos SEM guerra com a unidade (0x567c56: aliados e neutros vistos; AI_Autocast
   *  0x56bc7b e o caso Heal de AI_CastChosenSpell 0x56b059 procuram nela o alvo da magia de apoio). */
  friends = new CListPtr();
  /** +0xac8 (objeto +0xac4) CList<void*> dos candidatos EM guerra com a unidade (0x567c56; AI_CastChosenSpell 0x56b059: alvos das áreas). */
  foes = new CListPtr();
  /** +0xa8bc tabela de diplomacia: byte [8 + id(a) × 0x46 + id(b)], bit 0 = guerra (0x57994d). */
  dipTable = new Uint8Array(8 + 0x46 * 0x46);
  /** não é do exe: endereços das unidades "vida 0" do mapa/script (reféns; `World.knockOut`) que a escolha de inimigos ignora [est] */
  readonly helpless = new Set<number>();
  fbbe8 = 0;                         // +0xbbe8 u32 0 → 0x56dca2 testa o grupo dormindo (tipo+0x45)
  /** +0xbbec CList<Event> dos eventos para a IA (0x57b210 AddTail no despachante; 0x57b2b0 RemoveAll no pensamento 0x57485b). */
  events = new CListEvent();
  /** +0xbd98 rascunho do evento (0x54 bytes). */
  readonly evt = new Uint8Array(EVENT_SIZE);
  private readonly evtDv = new DataView(this.evt.buffer);
  evtSetU32(off: number, v: number): void { this.evtDv.setUint32(off, v >>> 0, true); }
  evtU32(off: number): number { return this.evtDv.getUint32(off, true); }
  /** o rand() do CRT (_tiddata+0x14) que 0x583290 usa: o `Rng` do motor (a World põe o seu aqui) */
  rng: Rng = new Rng();
  /** a lista de jogadores ([0x68d2c4]+4, CList<void*> de endereços de PlayerRec; 0x56fe4d: 0x57b120/0x53da40) e os registros */
  players = new CListPtr();
  readonly playersByAddr = new Map<number, PlayerRec>();
  /** grupos pelo endereço (elementos das listas dono+0x28; a unidade aponta para o seu em +0x70) */
  readonly groupsByAddr = new Map<number, UnitTypeRec>();
  /** +0xa54 i8[4][4] peso por classe (AI_TargetCost 0x5711ea: [classe do atacante × 4 + classe do alvo]; 0 = nunca, 1 = ×1,5, 4 = ×0,75) */
  classTable = new Int8Array(16);
  fa4c = 0;                          // +0xa4c i32 pensamentos (0x56fe4d)
  fa724 = 2;                         // +0xa724 u8  distância máxima ao centroide para andar em formação (0x5703c0/0x57063e; 2 nas 3 imagens)
  fa8b8 = 8;                         // +0xa8b8 i32 MinimalGuardRange (ai.reg; AI_GroupCmd_Guard 0x5709d9, AI_GuardLoad 0x570aba)
  fd720 = 0;                         // +0xd720 i32 passagens do script (0x57485b)
  /** não é do exe: o endereço do próximo grupo que 0x52b06f aloca (o exe: `new` de 0x50 bytes); a World dá endereços sintéticos, o arnês
   *  de remontagem o do par */
  allocGroupAddr: () => number = () => { throw new Error("WorldRec.allocGroupAddr não definido (0x52b06f)"); };
  /** não é do exe: a magia do livro pelo endereço que o exe guarda como ponteiro (IA+0x30, unidade+0x44); a World procura nos livros
   *  espelhados, o arnês de remontagem lê o registro da memória do par */
  spellAt: (addr: number) => BookSpellRec = (addr) => { throw new Error(`WorldRec.spellAt não definido (magia 0x${(addr >>> 0).toString(16)})`); };
  playerAt(addr: number): PlayerRec {
    const p = this.playersByAddr.get(addr >>> 0);
    if (!p) throw new Error(`jogador 0x${(addr >>> 0).toString(16)} sem registro espelhado`);
    return p;
  }
  groupAt(addr: number): UnitTypeRec {
    const g = this.groupsByAddr.get(addr >>> 0);
    if (!g) throw new Error(`grupo 0x${(addr >>> 0).toString(16)} sem registro espelhado`);
    return g;
  }
  constructor(public map: MapRec) {} // +0xa50 ptr objeto de mapa/caminho
}
