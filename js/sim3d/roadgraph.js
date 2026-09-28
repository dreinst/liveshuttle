// Jaringan jalan kota: simpul persimpangan, ruas berarah, lajur, konektor di dalam
// persimpangan, jaringan trotoar untuk pejalan kaki, dan pencarian rute A*.
//
// Lalu lintas kiri (Indonesia): kendaraan berjalan di sisi kiri jalan.
// Tiap arah punya dua lajur. Lajur 0 = lajur kiri (dekat trotoar, lajur normal).
// Lajur 1 = lajur kanan (dekat marka tengah, untuk menyalip dan belok kanan).
import { Poly } from './geom.js';

export const GRID = {
  N: 5, // 5 x 5 simpul, jadi 4 x 4 blok
  S: 100, // jarak antarsimpul (m)
  HALF: 7, // setengah lebar badan jalan (2 lajur x 3,5 m per arah)
  SIDE: 4, // lebar trotoar
  CONN: 12, // jarak garis henti dari pusat simpul
  CROSS: 9, // jarak garis tengah zebra cross dari pusat simpul
  CROSS_W: 3, // lebar zebra cross
  LANE_W: 3.5,
  CURB_R: 4.5, // jari-jari tikungan trotoar di sudut blok, supaya mobil yang belok kiri tetap di aspal
};

// Arah: 0 timur (+x), 1 selatan (+z), 2 barat (-x), 3 utara (-z).
export const DX = [1, 0, -1, 0];
export const DZ = [0, 1, 0, -1];
export const leftDir = (k) => (k + 3) & 3;
export const rightDir = (k) => (k + 1) & 3;
export const oppDir = (k) => (k + 2) & 3;
/** Jarak pusat lajur dari marka tengah, ke arah kiri kendaraan. */
export const laneOffset = (k) => (k === 0 ? 5.25 : 1.75);
export const MOVE_TEXT = { S: 'lurus', L: 'belok kiri', R: 'belok kanan' };

export function buildGraph() {
  const { N, S, CONN } = GRID;
  const half = (N - 1) / 2;
  const nodes = [];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      nodes.push({
        id: j * N + i,
        i,
        j,
        x: (i - half) * S,
        z: (j - half) * S,
        nb: [-1, -1, -1, -1],
        deg: 0,
        signalized: false,
        inSegs: [],
        outSegs: [],
        conns: [],
        approaches: [],
      });
    }
  }
  for (const n of nodes) {
    const cand = [
      [n.i + 1, n.j],
      [n.i, n.j + 1],
      [n.i - 1, n.j],
      [n.i, n.j - 1],
    ];
    cand.forEach(([i, j], k) => {
      if (i >= 0 && i < N && j >= 0 && j < N) {
        n.nb[k] = j * N + i;
        n.deg++;
      }
    });
    n.signalized = n.deg >= 3;
  }

  const segs = [];
  const lanes = [];
  for (const a of nodes) {
    for (let k = 0; k < 4; k++) {
      if (a.nb[k] < 0) continue;
      const b = nodes[a.nb[k]];
      const seg = { id: segs.length, a, b, k, dx: DX[k], dz: DZ[k], len: S - 2 * CONN, lanes: [], h: Math.atan2(DZ[k], DX[k]) };
      const lx = DZ[k];
      const lz = -DX[k];
      for (let lk = 0; lk < 2; lk++) {
        const off = laneOffset(lk);
        const x0 = a.x + DX[k] * CONN + lx * off;
        const z0 = a.z + DZ[k] * CONN + lz * off;
        const x1 = b.x - DX[k] * CONN + lx * off;
        const z1 = b.z - DZ[k] * CONN + lz * off;
        const lane = {
          id: lanes.length,
          type: 'road',
          seg,
          k: lk,
          dir: k,
          node: b,
          from: a,
          poly: new Poly([
            [x0, z0],
            [x1, z1],
          ]),
          len: seg.len,
          next: [],
          sibling: null,
          vmax: 99,
        };
        lanes.push(lane);
        seg.lanes.push(lane);
      }
      seg.lanes[0].sibling = seg.lanes[1];
      seg.lanes[1].sibling = seg.lanes[0];
      segs.push(seg);
      a.outSegs.push(seg);
      b.inSegs.push(seg);
    }
  }

  // Konektor di dalam persimpangan. Tiap arah mendapat fase hijau sendiri (fase terlindung),
  // jadi gerakan dari satu arah tidak pernah berpotongan dengan gerakan arah lain.
  for (const n of nodes) {
    for (const sin of n.inSegs) {
      const kin = sin.k;
      n.approaches.push(kin);
      for (const sout of n.outSegs) {
        const kout = sout.k;
        if (kout === oppDir(kin)) continue;
        const move = kout === kin ? 'S' : kout === leftDir(kin) ? 'L' : 'R';
        let pairs;
        if (n.deg === 2) pairs = [[0, 0], [1, 1]];
        else if (move === 'S') pairs = [[0, 0], [1, 1]];
        else if (move === 'L') pairs = [[0, 0]];
        else pairs = [[1, 1]];
        for (const [ka, kb] of pairs) {
          const la = sin.lanes[ka];
          const lb = sout.lanes[kb];
          const Px = la.poly.x[1];
          const Pz = la.poly.z[1];
          const Qx = lb.poly.x[0];
          const Qz = lb.poly.z[0];
          let pts;
          if (move === 'S') {
            pts = [
              [Px, Pz],
              [Qx, Qz],
            ];
          } else {
            // Belokan berupa busur lingkaran (kelengkungan tetap, jadi mudah diikuti kemudi).
            // Lajur masuk dan keluar berjarak sama dari titik sudut C, jadi busur menyinggung keduanya.
            const t = (Qx - Px) * DX[kin] + (Qz - Pz) * DZ[kin];
            const Cx = Px + DX[kin] * t;
            const Cz = Pz + DZ[kin] * t;
            const Ox = Px + Qx - Cx;
            const Oz = Pz + Qz - Cz;
            const rad = Math.hypot(Px - Ox, Pz - Oz);
            const a0 = Math.atan2(Pz - Oz, Px - Ox);
            let da = Math.atan2(Qz - Oz, Qx - Ox) - a0;
            if (da > Math.PI) da -= Math.PI * 2;
            if (da < -Math.PI) da += Math.PI * 2;
            pts = [];
            const M = 16;
            for (let i = 0; i <= M; i++) {
              const a = a0 + (da * i) / M;
              pts.push([Ox + Math.cos(a) * rad, Oz + Math.sin(a) * rad]);
            }
          }
          const poly = new Poly(pts);
          const R = move === 'S' ? Infinity : poly.len / (Math.PI / 2);
          const conn = {
            id: lanes.length,
            type: 'conn',
            node: n,
            fromLane: la,
            toLane: lb,
            move,
            approach: kin,
            dir: kout,
            k: ka,
            poly,
            len: poly.len,
            next: [lb],
            radius: R,
            vmax: move === 'S' ? 99 : Math.sqrt(2.8 * R),
          };
          lanes.push(conn);
          la.next.push(conn);
          n.conns.push(conn);
        }
      }
    }
  }

  const roadLanes = lanes.filter((l) => l.type === 'road');
  const roads = []; // ruas tak berarah untuk bangunan geometri
  for (const seg of segs) if (seg.a.id < seg.b.id) roads.push({ a: seg.a, b: seg.b, k: seg.k, fwd: seg, back: segs.find((s) => s.a === seg.b && s.b === seg.a) });

  return { nodes, segs, lanes, roadLanes, roads, sidewalk: buildSidewalks(nodes, roads) };
}

/** Titik pada ruas di koordinat s (sepanjang ruas) dan lat (0 = pusat lajur kiri, 3,5 = pusat lajur kanan). */
export function segPoint(seg, s, lat, out = {}) {
  const l0 = seg.lanes[0].poly;
  const rx = -seg.dz;
  const rz = seg.dx;
  out.x = l0.x[0] + seg.dx * s + rx * lat;
  out.z = l0.z[0] + seg.dz * s + rz * lat;
  out.h = seg.h;
  return out;
}

/** Proyeksi titik ke koordinat ruas: s dan lat (kanan positif dari pusat lajur kiri). */
export function segProject(seg, x, z, out = {}) {
  const l0 = seg.lanes[0].poly;
  const ex = x - l0.x[0];
  const ez = z - l0.z[0];
  out.s = ex * seg.dx + ez * seg.dz;
  out.lat = -ex * seg.dz + ez * seg.dx;
  return out;
}

// ===== trotoar =====

/**
 * Jaringan trotoar. Tiap simpul punya empat sudut di (+-9, +-9) dari pusatnya.
 * Sudut c_k berada di antara arah k dan arah k+1. Tepi 'walk' menyusuri trotoar,
 * tepi 'cross' adalah zebra cross (hanya di persimpangan berlampu).
 */
function buildSidewalks(nodes, roads) {
  const { CROSS } = GRID;
  const corners = [];
  const edges = [];
  const cid = (n, q) => n.id * 4 + q;
  for (const n of nodes) {
    for (let q = 0; q < 4; q++) {
      const ox = (DX[q] + DX[(q + 1) & 3]) * CROSS;
      const oz = (DZ[q] + DZ[(q + 1) & 3]) * CROSS;
      corners.push({ id: cid(n, q), node: n, q, x: n.x + ox, z: n.z + oz, edges: [] });
    }
  }
  const addEdge = (a, b, type, extra = {}) => {
    const A = corners[a];
    const B = corners[b];
    const e = { id: edges.length, a, b, type, len: Math.hypot(B.x - A.x, B.z - A.z), ...extra };
    edges.push(e);
    A.edges.push(e);
    B.edges.push(e);
    return e;
  };
  for (const n of nodes) {
    for (let k = 0; k < 4; k++) {
      const ca = cid(n, (k + 3) & 3);
      const cb = cid(n, k);
      if (n.nb[k] >= 0) {
        if (n.signalized) addEdge(ca, cb, 'cross', { node: n, stub: k });
      } else {
        addEdge(ca, cb, 'walk', { node: n, side: true });
      }
    }
  }
  for (const r of roads) {
    const k = r.k;
    const n = r.a;
    const m = r.b;
    const ok = oppDir(k);
    addEdge(cid(n, k), cid(m, (ok + 3) & 3), 'walk', { road: r });
    addEdge(cid(n, (k + 3) & 3), cid(m, ok), 'walk', { road: r });
  }
  return { corners, edges };
}

// ===== A* pada graf lajur =====

class Heap {
  constructor() {
    this.a = [];
  }
  push(f, id) {
    const a = this.a;
    a.push([f, id]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
  get size() {
    return this.a.length;
  }
}

const V_REF = 12.5; // kecepatan acuan untuk biaya waktu (m/s)
// Penalti per ruas di lajur kanan. Lebih besar dari biaya pindah lajur (4), jadi setelah menyalip
// mobil memilih kembali ke lajur kiri daripada tetap di kanan sampai beberapa ruas.
const RIGHT_LANE_COST = 6;
const LANE_CHANGE_COST = 4;

function enterCost(lane) {
  if (lane.type === 'road') return lane.len / V_REF + (lane.k === 1 ? RIGHT_LANE_COST : 0);
  let c = lane.len / Math.min(V_REF, lane.vmax);
  if (lane.move === 'L') c += 1.5;
  if (lane.move === 'R') c += 3;
  if (lane.node.signalized) c += 6;
  return c;
}

/**
 * A* dari lajur awal ke salah satu lajur pada ruas tujuan.
 * Biaya = perkiraan waktu tempuh (detik) ditambah penalti belok, lampu, dan pindah lajur.
 * Heuristik = jarak garis lurus dibagi 14 m/s, sehingga tidak pernah melebihi biaya sebenarnya.
 * opts.lockLane: larang pindah lajur di ruas awal (dipakai saat pindah lajur gagal).
 */
export function findRoute(graph, startLane, startS, goalSeg, goalS, opts = {}) {
  const lanes = graph.lanes;
  const n = lanes.length;
  const g = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const gp = goalSeg.lanes[0].poly;
  const gx = gp.x[0] + goalSeg.dx * goalS;
  const gz = gp.z[0] + goalSeg.dz * goalS;
  const hFn = (lane) => {
    const p = lane.poly;
    const ex = p.x[p.n - 1];
    const ez = p.z[p.n - 1];
    return Math.hypot(gx - ex, gz - ez) / 14;
  };
  const heap = new Heap();
  g[startLane.id] = Math.max(0, startLane.len - startS) / V_REF;
  heap.push(g[startLane.id] + hFn(startLane), startLane.id);
  let found = -1;
  let guard = 0;
  while (heap.size && guard++ < 20000) {
    const [, id] = heap.pop();
    if (closed[id]) continue;
    closed[id] = 1;
    const lane = lanes[id];
    // Tujuan dicapai di lajur kiri. Lajur kanan hanya diterima bila mobil sudah di ruas tujuan
    // dan dilarang pindah lajur (lockLane).
    const goalLaneOk = lane.k === 0 || (opts.lockLane && startLane.seg === goalSeg);
    if (lane.type === 'road' && lane.seg === goalSeg && goalLaneOk && (lane.seg !== startLane.seg || id !== startLane.id || startS < goalS)) {
      found = id;
      break;
    }
    const nbrs = [];
    for (const c of lane.next) {
      // ruas yang kedua lajurnya tertutup rintangan dihindari (kecuali ruas tujuan)
      const road = c.type === 'conn' ? c.next[0] : c;
      if (opts.closed && road && road.seg !== goalSeg && road.seg !== startLane.seg && opts.closed.has(road.seg.id)) continue;
      nbrs.push([c, enterCost(c)]);
    }
    if (lane.type === 'road' && lane.sibling && !(opts.lockLane && lane.seg === startLane.seg)) {
      nbrs.push([lane.sibling, LANE_CHANGE_COST + (lane.sibling.k === 1 ? 3 : 0)]);
    }
    for (const [nb, c] of nbrs) {
      if (closed[nb.id]) continue;
      const ng = g[id] + c;
      if (ng < g[nb.id]) {
        g[nb.id] = ng;
        prev[nb.id] = id;
        heap.push(ng + hFn(nb), nb.id);
      }
    }
  }
  if (found < 0) return null;
  const path = [];
  for (let id = found; id >= 0; id = prev[id]) path.push(lanes[id]);
  path.reverse();
  return { lanes: path, cost: g[found], expanded: guard };
}

/** Ubah deretan lajur hasil A* menjadi item rute: ruas (dengan lajur awal dan akhir) dan konektor. */
export function routeItems(path) {
  const items = [];
  for (const lane of path) {
    const last = items[items.length - 1];
    if (lane.type === 'road') {
      if (last && last.type === 'road' && last.seg === lane.seg) {
        last.kEnd = lane.k;
      } else {
        items.push({ type: 'road', seg: lane.seg, kStart: lane.k, kEnd: lane.k, len: lane.seg.len });
      }
    } else {
      items.push({ type: 'conn', lane, len: lane.len });
    }
  }
  return items;
}
