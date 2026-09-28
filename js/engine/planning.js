// Perencanaan rute: peta grid, graf jalan, antrean prioritas, serta A* dan Dijkstra
// yang bisa dijalankan selangkah demi selangkah untuk animasi pencarian.
//
// Sebuah "ruang pencarian" adalah objek dengan:
//   neighbors(node) -> Array<[nextNode, cost]>
//   heuristic(a, b) -> perkiraan biaya a ke b (tidak boleh melebihi biaya sebenarnya)
// GridMap dan Graph di bawah sudah memenuhi kontrak ini.

/** Antrean prioritas min-heap. */
export class PriorityQueue {
  constructor() {
    this._items = [];
    this._prio = [];
  }
  get size() {
    return this._items.length;
  }
  push(item, priority) {
    const items = this._items;
    const prio = this._prio;
    items.push(item);
    prio.push(priority);
    let i = items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (prio[p] <= prio[i]) break;
      [items[p], items[i]] = [items[i], items[p]];
      [prio[p], prio[i]] = [prio[i], prio[p]];
      i = p;
    }
  }
  pop() {
    const items = this._items;
    const prio = this._prio;
    if (!items.length) return undefined;
    const top = items[0];
    const lastItem = items.pop();
    const lastPrio = prio.pop();
    if (items.length) {
      items[0] = lastItem;
      prio[0] = lastPrio;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && prio[l] < prio[m]) m = l;
        if (r < items.length && prio[r] < prio[m]) m = r;
        if (m === i) break;
        [items[m], items[i]] = [items[i], items[m]];
        [prio[m], prio[i]] = [prio[i], prio[m]];
        i = m;
      }
    }
    return top;
  }
  peekPriority() {
    return this._prio[0];
  }
}

/**
 * Peta grid. Node adalah indeks sel (bilangan bulat) = row * cols + col.
 * cost[i] = biaya masuk ke sel i (1 = normal, lebih besar = lebih lambat/macet).
 */
export class GridMap {
  constructor({ cols, rows, cellSize = 1, originX = 0, originY = 0, diagonal = false }) {
    this.cols = cols;
    this.rows = rows;
    this.cellSize = cellSize;
    this.originX = originX;
    this.originY = originY;
    this.diagonal = diagonal;
    this.blocked = new Uint8Array(cols * rows);
    this.cost = new Float32Array(cols * rows).fill(1);
  }
  index(col, row) {
    return row * this.cols + col;
  }
  cell(i) {
    return { col: i % this.cols, row: Math.floor(i / this.cols) };
  }
  inBounds(col, row) {
    return col >= 0 && row >= 0 && col < this.cols && row < this.rows;
  }
  setBlocked(col, row, blocked = true) {
    if (this.inBounds(col, row)) this.blocked[this.index(col, row)] = blocked ? 1 : 0;
  }
  isBlocked(col, row) {
    return !this.inBounds(col, row) || this.blocked[this.index(col, row)] === 1;
  }
  setCost(col, row, cost) {
    if (this.inBounds(col, row)) this.cost[this.index(col, row)] = cost;
  }
  /** Titik tengah sel dalam koordinat dunia. */
  toWorld(i) {
    const { col, row } = this.cell(i);
    return { x: this.originX + (col + 0.5) * this.cellSize, y: this.originY + (row + 0.5) * this.cellSize };
  }
  /** Indeks sel yang memuat titik dunia, atau -1 bila di luar grid. */
  fromWorld(x, y) {
    const col = Math.floor((x - this.originX) / this.cellSize);
    const row = Math.floor((y - this.originY) / this.cellSize);
    return this.inBounds(col, row) ? this.index(col, row) : -1;
  }
  neighbors(i) {
    const { col, row } = this.cell(i);
    const out = [];
    const dirs = this.diagonal
      ? [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
          [1, 1],
          [1, -1],
          [-1, 1],
          [-1, -1],
        ]
      : [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ];
    for (const [dc, dr] of dirs) {
      const c = col + dc;
      const r = row + dr;
      if (this.isBlocked(c, r)) continue;
      if (dc && dr && (this.isBlocked(col + dc, row) || this.isBlocked(col, row + dr))) continue; // jangan potong sudut
      const j = this.index(c, r);
      const step = dc && dr ? Math.SQRT2 : 1;
      out.push([j, step * this.cellSize * this.cost[j]]);
    }
    return out;
  }
  /** Jarak Manhattan (4 arah) atau oktil (8 arah), dikali biaya minimum 1. */
  heuristic(a, b) {
    const A = this.cell(a);
    const B = this.cell(b);
    const dx = Math.abs(A.col - B.col);
    const dy = Math.abs(A.row - B.row);
    if (!this.diagonal) return (dx + dy) * this.cellSize;
    return (Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)) * this.cellSize;
  }
}

/**
 * Graf jalan berarah. Node punya id (string atau angka) dan posisi {x, y}.
 * Biaya sisi default = panjang garis lurus antar node, bisa dikali (misalnya macet).
 */
export class Graph {
  constructor() {
    this.nodes = new Map(); // id -> { id, x, y, ... }
    this.edges = new Map(); // id -> Map(toId -> edge)
  }
  addNode(id, data = {}) {
    this.nodes.set(id, { id, x: 0, y: 0, ...data });
    if (!this.edges.has(id)) this.edges.set(id, new Map());
    return this;
  }
  /**
   * Tambah sisi a -> b. opts: { cost, twoWay = true, multiplier = 1, data }
   * Biaya efektif = cost (atau panjang) * multiplier.
   */
  addEdge(a, b, { cost = null, twoWay = true, multiplier = 1, data = null } = {}) {
    const make = (from, to) => {
      const A = this.nodes.get(from);
      const B = this.nodes.get(to);
      const length = Math.hypot(B.x - A.x, B.y - A.y);
      this.edges.get(from).set(to, { from, to, length, base: cost ?? length, multiplier, blocked: false, data });
    };
    make(a, b);
    if (twoWay) make(b, a);
    return this;
  }
  edge(a, b) {
    return this.edges.get(a)?.get(b) || null;
  }
  /** Tutup atau buka jalan a-b (kedua arah bila twoWay). */
  setBlocked(a, b, blocked = true, twoWay = true) {
    const e1 = this.edge(a, b);
    if (e1) e1.blocked = blocked;
    if (twoWay) {
      const e2 = this.edge(b, a);
      if (e2) e2.blocked = blocked;
    }
  }
  /** Ubah pengali biaya (misalnya 3 = macet, perjalanan tiga kali lebih lama). */
  setMultiplier(a, b, multiplier, twoWay = true) {
    const e1 = this.edge(a, b);
    if (e1) e1.multiplier = multiplier;
    if (twoWay) {
      const e2 = this.edge(b, a);
      if (e2) e2.multiplier = multiplier;
    }
  }
  edgeCost(e) {
    return e.base * e.multiplier;
  }
  neighbors(id) {
    const out = [];
    const m = this.edges.get(id);
    if (!m) return out;
    for (const e of m.values()) if (!e.blocked) out.push([e.to, this.edgeCost(e)]);
    return out;
  }
  /** Jarak garis lurus. Admissible selama biaya sisi tidak lebih kecil dari panjangnya. */
  heuristic(a, b) {
    const A = this.nodes.get(a);
    const B = this.nodes.get(b);
    return A && B ? Math.hypot(B.x - A.x, B.y - A.y) : 0;
  }
  /** Daftar semua sisi (berguna untuk menggambar). */
  allEdges() {
    const out = [];
    for (const m of this.edges.values()) for (const e of m.values()) out.push(e);
    return out;
  }
}

/**
 * Buat pencarian yang bisa dijalankan bertahap.
 *   const search = createSearch(graph, 'A', 'F', { algorithm: 'astar' });
 *   while (!search.done) search.step();   // atau panggil step() beberapa kali per frame
 *   search.path  -> ['A', 'C', 'F']
 *
 * @param {object} space ruang pencarian (GridMap, Graph, atau objek dengan neighbors/heuristic)
 * @param {*} start @param {*} goal
 * @param {object} [opts] { algorithm: 'astar' | 'dijkstra', heuristic, weight (pengali heuristik, default 1) }
 * Properti yang bisa dibaca untuk animasi:
 *   open (Set node di antrean), closed (Set node selesai), current (node terakhir diperluas),
 *   g (Map biaya terbaik), cameFrom (Map), expanded (jumlah node diperluas),
 *   done, found, path (Array node), cost
 */
export function createSearch(space, start, goal, { algorithm = 'astar', heuristic = null, weight = 1 } = {}) {
  const h = algorithm === 'dijkstra' ? () => 0 : heuristic || ((a, b) => space.heuristic(a, b));
  const pq = new PriorityQueue();
  const g = new Map([[start, 0]]);
  const cameFrom = new Map();
  const open = new Set([start]);
  const closed = new Set();
  pq.push(start, weight * h(start, goal));

  const search = {
    algorithm,
    start,
    goal,
    open,
    closed,
    g,
    cameFrom,
    current: null,
    expanded: 0,
    done: false,
    found: false,
    path: [],
    cost: Infinity,
    /** Perluas satu node. Mengembalikan true bila pencarian selesai. */
    step() {
      if (this.done) return true;
      let node;
      do {
        node = pq.pop();
      } while (node !== undefined && closed.has(node));
      if (node === undefined) {
        this.done = true;
        return true;
      }
      open.delete(node);
      closed.add(node);
      this.current = node;
      this.expanded++;
      if (node === goal) {
        this.done = true;
        this.found = true;
        this.cost = g.get(node);
        this.path = reconstructPath(cameFrom, node);
        return true;
      }
      const gn = g.get(node);
      for (const [next, cost] of space.neighbors(node)) {
        if (closed.has(next)) continue;
        const cand = gn + cost;
        if (cand < (g.get(next) ?? Infinity)) {
          g.set(next, cand);
          cameFrom.set(next, node);
          open.add(next);
          pq.push(next, cand + weight * h(next, goal));
        }
      }
      return false;
    },
    /** Jalankan sampai selesai (atau maxSteps langkah). */
    run(maxSteps = Infinity) {
      let n = 0;
      while (!this.done && n < maxSteps) {
        this.step();
        n++;
      }
      return this;
    },
    /** Jalur sementara dari start ke node tertentu (untuk animasi). */
    pathTo(node) {
      return g.has(node) ? reconstructPath(cameFrom, node) : [];
    },
  };
  return search;
}

export function reconstructPath(cameFrom, node) {
  const path = [node];
  while (cameFrom.has(node)) {
    node = cameFrom.get(node);
    path.push(node);
  }
  return path.reverse();
}

/** Cari jalur langsung sampai selesai. Hasil: { found, path, cost, expanded }. */
export function findPath(space, start, goal, opts = {}) {
  const s = createSearch(space, start, goal, opts).run();
  return { found: s.found, path: s.path, cost: s.cost, expanded: s.expanded };
}
