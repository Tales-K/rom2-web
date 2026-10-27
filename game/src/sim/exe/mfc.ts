/**
 * Classes MFC instanciadas pelo servidor do allods2.exe, espelhadas uma vez por classe (skill port-exe: a biblioteca não se
 * porta método a método). Mesma ordem de iteração e mesmos retornos do original; cada método diz o endereço da instância
 * que espelha (esses endereços estão `out` em tools/re/port_status.tsv com nota "MFC: exe/mfc.ts:<Classe>.<método>").
 *
 * - CList<WORD,WORD> (cabeçalho de 0x1c bytes: +0 vtable, +4 m_pNodeHead, +8 m_pNodeTail, +0xc m_nCount, +0x10 m_pNodeFree,
 *   +0x14 m_pBlocks, +0x18 m_nBlockSize; nó de 0xc bytes: +0 pNext, +4 pPrev, +8 data u16). Listas de células do caminho da
 *   unidade (+0x1c8 estática, +0x1e4 dinâmica).
 * - CMap<short,short,OccRec,OccRec&> (+4 m_pHashTable, +8 m_nHashTableSize, +0xc m_nCount, +0x10 m_pFreeList, +0x14 m_pBlocks,
 *   +0x18 m_nBlockSize; associação de 0x48 bytes: +0 pNext, +4 nHashValue, +8 key i16, +0xc value OccRec). Ocupação por célula
 *   em mapa+0x54084.
 *
 * - CList<Event,Event&> (mundo+0xbbec; nó de 0x5c bytes: +0 pNext, +4 pPrev, +8 o evento de 0x54 bytes copiado por valor):
 *   eventos do servidor para a IA de grupo (golpe/magia: 0x56dca2, 0x56e6b8, 0x57240b), consumidos no pensamento (0x57485b).
 *
 * A lista livre e os blocos (CPlex) só decidem ENDEREÇOS dos nós, que nenhuma função do jogo compara nem ordena: não são
 * espelhados. A ordem dos nós (pNext/pPrev) e a das cadeias da tabela de hash (inserção na cabeça do balde) são.
 */
import { OccRec } from "./types";

/** Nó de CList<WORD> (0xc bytes). */
export class CListNode {
  next: CListNode | null = null; // +0x0 pNext
  prev: CListNode | null = null; // +0x4 pPrev
  data = 0;                      // +0x8 u16
}

/** Posição de iteração (POSITION&) de CList::GetNext. */
export interface ListPos { p: CListNode | null; }

/** CList<WORD,WORD>. */
export class CListWord {
  head: CListNode | null = null; // +0x04 m_pNodeHead
  tail: CListNode | null = null; // +0x08 m_pNodeTail
  count = 0;                     // +0x0c m_nCount (int)

  /** 0x55f090 (fastcall): m_nCount. */
  getCount(): number {
    return this.count | 0;
  }

  /** 0x55f0b0 IsEmpty (fastcall): m_nCount == 0. */
  isEmpty(): boolean {
    return this.count === 0;
  }

  /** 0x55f0d0 GetHead (fastcall): o exe devolve &head->data; aqui o valor (u16). Lista vazia: o exe lê o endereço 8 (falha). */
  getHead(): number {
    if (!this.head) throw new Error("CList::GetHead em lista vazia (0x55f0d0 lê [8])");
    return this.head.data & 0xffff;
  }

  /** 0x55f0f0 GetTail (fastcall): idem para a cauda. */
  getTail(): number {
    if (!this.tail) throw new Error("CList::GetTail em lista vazia (0x55f0f0 lê [8])");
    return this.tail.data & 0xffff;
  }

  /** 0x55f1d0 GetHeadPosition (fastcall). */
  getHeadPosition(): CListNode | null {
    return this.head;
  }

  /** 0x55f1f0 GetNext (cdecl, POSITION&): avança a posição e devolve o dado do nó em que ela estava (o exe devolve &data). */
  static getNext(pos: ListPos): number {
    const n = pos.p;
    if (!n) throw new Error("CList::GetNext com POSITION nula (0x55f1f0 lê [0])");
    pos.p = n.next;
    return n.data & 0xffff;
  }

  /** 0x542430 NewNode (thiscall): nó com pPrev/pNext dados; m_nCount++ (o dado é construído vazio: 0). */
  newNode(prev: CListNode | null, next: CListNode | null): CListNode {
    const n = new CListNode();
    n.prev = prev;
    n.next = next;
    this.count = (this.count + 1) | 0;
    n.data = 0;
    return n;
  }

  /** 0x55fd50 FreeNode (thiscall): m_nCount--; ao chegar a 0, RemoveAll. */
  freeNode(_n: CListNode): void {
    this.count = (this.count - 1) | 0;
    if (this.count === 0) this.removeAll();
  }

  /** 0x55f170 AddHead (thiscall): insere na cabeça; devolve o nó (POSITION). */
  addHead(v: number): CListNode {
    const n = this.newNode(null, this.head);
    n.data = v & 0xffff;
    if (this.head === null) this.tail = n;
    else this.head.prev = n;
    this.head = n;
    return n;
  }

  /** 0x542300 AddTail (thiscall): insere na cauda; devolve o nó (POSITION). */
  addTail(v: number): CListNode {
    const n = this.newNode(this.tail, null);
    n.data = v & 0xffff;
    if (this.tail === null) this.head = n;
    else this.tail.next = n;
    this.tail = n;
    return n;
  }

  /** 0x57b020 Find (thiscall; valor, POSITION de partida ou nula): 1.º nó com dado == valor (0x422230: short == short) a partir
   *  da cabeça, ou do nó SEGUINTE a `after`; null se não há. (Instância para a lista de patrulha IA+0xb4.) */
  find(v: number, after: CListNode | null): CListNode | null {
    let p = after === null ? this.head : after.next;
    while (p !== null) {
      if ((p.data & 0xffff) === (v & 0xffff)) return p;
      p = p.next;
    }
    return null;
  }

  /** 0x55f110 RemoveHead (fastcall): tira o nó-cabeça e devolve o dado (u16). Lista vazia: o exe lê [8] e falha. */
  removeHead(): number {
    const n = this.head;
    if (!n) throw new Error("CList::RemoveHead em lista vazia (0x55f110 lê [8])");
    const v = n.data & 0xffff;
    this.head = n.next;
    if (this.head === null) this.tail = null;
    else this.head.prev = null;
    this.freeNode(n);
    return v;
  }

  /** 0x5421b0 RemoveAll (fastcall): esvazia (m_nCount = 0, cabeça/cauda nulas; blocos liberados). */
  removeAll(): void {
    this.count = 0;
    this.tail = null;
    this.head = null;
  }

  /** Dados do início ao fim (para testes e depuração; não é método do exe). */
  values(): number[] {
    const r: number[] = [];
    for (let n = this.head; n; n = n.next) r.push(n.data);
    return r;
  }
}

/** Nó de CList<void*> (0xc bytes): +0 pNext, +4 pPrev, +8 dado u32 (endereço de unidade). */
export class CListPtrNode {
  next: CListPtrNode | null = null;
  prev: CListPtrNode | null = null;
  data = 0;
}

/**
 * CList<void*> (cabeçalho 0x1c como CListWord). Instância: a lista de unidades de 0x54ec6a em mapa+0x54010. O iterador do
 * jogo (8 bytes: +0 lista, +4 POSITION) é `CListPtrIter`.
 */
export class CListPtr {
  head: CListPtrNode | null = null; // +0x04
  tail: CListPtrNode | null = null; // +0x08
  count = 0;                        // +0x0c

  /** 0x53aff0 → 0x53b230 RemoveAll (fastcall): destrói cada elemento (0x53b590, vazio para ponteiros) e esvazia. */
  removeAll(): void {
    this.count = 0;
    this.tail = null;
    this.head = null;
  }

  /** 0x53d840 → 0x53c5c0 AddTail (thiscall); NewNode 0x53c830 (m_nCount++). */
  addTail(v: number): CListPtrNode {
    const n = new CListPtrNode();
    n.prev = this.tail;
    this.count = (this.count + 1) | 0;
    n.data = v >>> 0;
    if (this.tail === null) this.head = n;
    else this.tail.next = n;
    this.tail = n;
    return n;
  }

  /** 0x53afb0 (thiscall): Find 0x53b350 (1.º nó com dado == v a partir da cabeça; 0x53b5c0 compara os ponteiros) e, se há,
   *  RemoveAt 0x53b2e0 (desencadeia; FreeNode 0x53b540: m_nCount--). Sem o valor: nada. */
  remove(v: number): void {
    let p = this.head;
    while (p !== null && (p.data >>> 0) !== (v >>> 0)) p = p.next;
    if (p === null) return;
    if (p === this.head) this.head = p.next;
    else p.prev!.next = p.next;
    if (p === this.tail) this.tail = p.prev;
    else p.next!.prev = p.prev;
    this.count = (this.count - 1) | 0;
  }

  /** Dados do início ao fim (testes). */
  values(): number[] {
    const r: number[] = [];
    for (let n = this.head; n; n = n.next) r.push(n.data);
    return r;
  }
}

/** Iterador de CList<void*> (8 bytes; construtor 0x53b060 vazio). */
export class CListPtrIter {
  list: CListPtr | null = null; // +0 lista
  pos: CListPtrNode | null = null; // +4 POSITION

  /** 0x53b070 (thiscall): começa em `l` (GetHeadPosition 0x53b0c0); devolve o 1.º dado (GetNext 0x53b2b0) ou 0. */
  first(l: CListPtr): number {
    this.list = l;
    this.pos = l.head;
    return this.pos === null ? 0 : this.getNext();
  }

  /** 0x53b0e0 (fastcall): próximo dado ou 0 quando a POSITION é nula. */
  next(): number {
    return this.pos === null ? 0 : this.getNext();
  }

  /** 0x53b2b0 GetNext (cdecl, POSITION&). */
  private getNext(): number {
    const n = this.pos!;
    this.pos = n.next;
    return n.data >>> 0;
  }
}

/** Nó de CList<Event> (0x5c bytes): +0 pNext, +4 pPrev, +8 o evento (0x54 bytes). */
export class CListEventNode {
  next: CListEventNode | null = null;
  prev: CListEventNode | null = null;
  data = new Uint8Array(0x54);
}

/** CList<Event,Event&> (cabeçalho 0x1c como CListWord). Instância: a lista de eventos do mundo em +0xbbec. */
export class CListEvent {
  head: CListEventNode | null = null; // +0x04
  tail: CListEventNode | null = null; // +0x08
  count = 0;                          // +0x0c

  /** 0x57b210 AddTail (fastcall; o evento vem por valor na pilha): NewNode 0x57d090 (m_nCount++, construtor 0x57def0),
   *  cópia dos 0x15 dwords, encadeia na cauda; 0x57ad97 (destrutor do temporário) é vazio. Devolve o nó (POSITION). */
  addTail(ev: Uint8Array): CListEventNode {
    const n = new CListEventNode();
    n.prev = this.tail;
    n.next = null;
    this.count = (this.count + 1) | 0;
    n.data.set(ev.subarray(0, 0x54));
    if (this.tail === null) this.head = n;
    else this.tail.next = n;
    this.tail = n;
    return n;
  }

  /** 0x57b2b0 RemoveAll (fastcall): destrói os elementos (0x57d170), zera contagem, cabeça, cauda e blocos. */
  removeAll(): void {
    this.count = 0;
    this.tail = null;
    this.head = null;
  }

  /** Eventos do início ao fim (testes). */
  values(): Uint8Array[] {
    const r: Uint8Array[] = [];
    for (let n = this.head; n; n = n.next) r.push(n.data);
    return r;
  }
}

/** Associação de CMap<short,OccRec> (0x48 bytes). */
export class CMapAssoc {
  next: CMapAssoc | null = null; // +0x0 pNext
  hash = 0;                      // +0x4 nHashValue (balde)
  key = 0;                       // +0x8 i16
  readonly value = new OccRec(); // +0xc OccRec (0x3c bytes)
}

/** 0x422210 HashKey<short> (cdecl): (key & 0xffff) >> 4. */
export function hashKeyShort(key: number): number {
  return (key & 0xffff) >>> 4;
}

/** CMap<short,short,OccRec,OccRec&>. */
export class CMapShortOcc {
  table: (CMapAssoc | null)[] | null = null; // +0x04 m_pHashTable
  tableSize = 17;                            // +0x08 m_nHashTableSize (u32)
  count = 0;                                 // +0x0c m_nCount

  /** 0x55f5d0 InitHashTable (thiscall): descarta a tabela; se `alloc`, aloca `size` baldes vazios. */
  initHashTable(size: number, alloc: number): void {
    this.table = null;
    if (alloc !== 0) this.table = new Array<CMapAssoc | null>(size >>> 0).fill(null);
    this.tableSize = size >>> 0;
  }

  /** 0x55ff70 GetAssocAt (thiscall): associação da chave (ou null) e o balde em `out.hash` (sempre calculado). */
  getAssocAt(key: number, out: { hash: number }): CMapAssoc | null {
    out.hash = (hashKeyShort(key) % this.tableSize) >>> 0;
    if (this.table !== null) {
      for (let a = this.table[out.hash]; a !== null; a = a.next) {
        if (((a.key << 16) >> 16) === ((key << 16) >> 16)) return a;
      }
    }
    return null;
  }

  /** 0x55f3e0 Map_OccupancyLookup (Lookup, thiscall): copia o valor para `dst` (memcpy 0x3c, 0x55385f) se a chave existe. */
  lookup(key: number, dst: OccRec): boolean {
    const a = this.getAssocAt(key, { hash: 0 });
    const found = a !== null;
    if (found) dst.b.set(a.value.b);
    return found;
  }

  /** 0x5602b0 NewAssoc (fastcall): m_nCount++; chave 0 e valor zerado/construído (0x5604f0). */
  newAssoc(): CMapAssoc {
    const a = new CMapAssoc();
    this.count = (this.count + 1) | 0;
    return a;
  }

  /** 0x55fdc0 operator[] (thiscall): valor da chave, criando a associação na cabeça do balde se não existe. */
  index(key: number): OccRec {
    const out = { hash: 0 };
    let a = this.getAssocAt(key, out);
    if (a === null) {
      if (this.table === null) this.initHashTable(this.tableSize, 1);
      a = this.newAssoc();
      a.hash = out.hash;
      a.key = (key << 16) >> 16;
      a.next = this.table![out.hash];
      this.table![out.hash] = a;
    }
    return a.value;
  }

  /** 0x55f430 SetAt (thiscall): (*this)[key] = src (memcpy 0x3c). */
  setAt(key: number, src: OccRec): void {
    this.index(key).b.set(src.b);
  }

  /** 0x55fe50 RemoveAll (fastcall): libera a tabela (m_pHashTable = 0) e zera a contagem. */
  removeAll(): void {
    this.table = null;
    this.count = 0;
  }

  /** 0x55ff10 FreeAssoc (thiscall): m_nCount--; ao chegar a 0, RemoveAll. */
  freeAssoc(_a: CMapAssoc): void {
    this.count = (this.count - 1) | 0;
    if (this.count === 0) this.removeAll();
  }

  /** 0x55f460 RemoveKey (thiscall): tira a associação da chave; 1 se existia. */
  removeKey(key: number): number {
    if (this.table !== null) {
      const h = (hashKeyShort(key) % this.tableSize) >>> 0;
      let prev: CMapAssoc | null = null;
      for (let a = this.table[h]; a !== null; a = a.next) {
        if (((a.key << 16) >> 16) === ((key << 16) >> 16)) {
          if (prev === null) this.table[h] = a.next;
          else prev.next = a.next;
          this.freeAssoc(a);
          return 1;
        }
        prev = a;
      }
    }
    return 0;
  }
}
