// Peta kawasan kampus untuk pelajaran Misi Shuttle Otonom.
//
// Koordinat dalam meter, y ke bawah, lalu lintas kiri. Jalan lingkar kampus berbentuk persegi
// panjang 120 m x 100 m dengan sudut melengkung, ditambah dua jalan tengah yang bersilangan.
//
//   graf jalan: persimpangan = node, ruas jalan = sisi (dua arah)
//     B Simpang Utara (60, 0)     berlampu, pertigaan
//     D Simpang Barat (0, 50)     tanpa lampu, pertigaan
//     E Simpang Tengah (60, 50)   berlampu, perempatan
//     F Simpang Timur (120, 50)   tanpa lampu, pertigaan
//     H Simpang Selatan (60, 100) berlampu, pertigaan
//   Sudut jalan lingkar bukan node, hanya tikungan di dalam satu ruas.
//
// Setiap ruas punya dua "link" berarah (misalnya D>H dan H>D). Link menyimpan lajur kiri arah
// itu, dipotong 7 m dari pusat persimpangan. Di dalam persimpangan kendaraan mengikuti kurva
// penghubung (movement) dari ujung satu lajur ke awal lajur berikutnya.
//
// File ini hanya berisi geometri, data halte, dan gambar statis. Simulasi ada di ./world.js.

import { makeRoad, crosswalk, stopLine, connector, slicePolyline } from '../../engine/road.js';
import { Path, arcPoints, polylineLength, resamplePolyline, closestPointOnSegment } from '../../engine/geometry.js';
import { TrafficLight, SignalPlan } from '../../engine/traffic.js';
import { wrapAngle, TAU } from '../../engine/math.js';
import { COLORS, FONT, withAlpha } from '../../engine/theme.js';
import {
  drawBuilding,
  drawTree,
  drawCrosswalk,
  drawStopLine,
  drawLine,
  drawRoadMarkings,
  drawCar,
  rectBox,
  polygonPath,
} from '../../engine/draw.js';

export const LANE_W = 3.5;
export const HALF_W = 3.5; // setengah lebar jalan dua lajur
export const TRIM = 7; // lajur berakhir 7 m dari pusat persimpangan
export const CORNER_R = 10; // jari-jari tikungan jalan lingkar (garis tengah)
export const SIDEWALK = 2.5;
export const FILLET_R = 3.5; // lengkung trotoar di sudut persimpangan

/** Area yang digambar di lapisan statis (juga batas gerak kamera). */
export const EXT = { minX: -60, minY: -50, maxX: 180, maxY: 150 };
/** Area peta yang harus terlihat utuh pada tampilan Seluruh kampus. */
export const MAP_BOUNDS = { minX: -14, minY: -9, maxX: 134, maxY: 109 };

export const NODES = {
  B: { id: 'B', x: 60, y: 0, name: 'Simpang Utara', signal: true },
  D: { id: 'D', x: 0, y: 50, name: 'Simpang Barat', signal: false },
  E: { id: 'E', x: 60, y: 50, name: 'Simpang Tengah', signal: true },
  F: { id: 'F', x: 120, y: 50, name: 'Simpang Timur', signal: false },
  H: { id: 'H', x: 60, y: 100, name: 'Simpang Selatan', signal: true },
};
export const NODE_LIST = Object.values(NODES);
for (const n of NODE_LIST) {
  n.res = new Map(); // reservasi persimpangan: id kendaraan -> { move, mover }
  n.moves = [];
  n.arms = [];
}

const ROAD_DEFS = [
  { id: 'BD', a: 'B', b: 'D', via: { x: 0, y: 0 }, name: 'Jl. Rektorat' },
  { id: 'FB', a: 'F', b: 'B', via: { x: 120, y: 0 }, name: 'Jl. Perpustakaan' },
  { id: 'DH', a: 'D', b: 'H', via: { x: 0, y: 100 }, name: 'Jl. Gerbang' },
  { id: 'HF', a: 'H', b: 'F', via: { x: 120, y: 100 }, name: 'Jl. Kantin' },
  { id: 'BE', a: 'B', b: 'E', name: 'Jl. Ilmu' },
  { id: 'DE', a: 'D', b: 'E', name: 'Jl. Cendekia' },
  { id: 'EF', a: 'E', b: 'F', name: 'Jl. Riset' },
  { id: 'EH', a: 'E', b: 'H', name: 'Jl. Mahasiswa' },
];

const unit = (x, y) => {
  const l = Math.hypot(x, y) || 1;
  return { x: x / l, y: y / l };
};

/** Garis tengah ruas dari pusat node a ke pusat node b, dengan tikungan busur bila ada `via`. */
function centerline(def) {
  const A = NODES[def.a];
  const B = NODES[def.b];
  if (!def.via) return [{ x: A.x, y: A.y }, { x: B.x, y: B.y }];
  const C = def.via;
  const d1 = unit(C.x - A.x, C.y - A.y);
  const d2 = unit(B.x - C.x, B.y - C.y);
  const r = CORNER_R;
  const cx = C.x + (d2.x - d1.x) * r;
  const cy = C.y + (d2.y - d1.y) * r;
  const t1 = { x: C.x - d1.x * r, y: C.y - d1.y * r };
  const t2 = { x: C.x + d2.x * r, y: C.y + d2.y * r };
  const a0 = Math.atan2(t1.y - cy, t1.x - cx);
  const a1 = a0 + wrapAngle(Math.atan2(t2.y - cy, t2.x - cx) - a0);
  return [{ x: A.x, y: A.y }, ...arcPoints(cx, cy, r, a0, a1, 10), { x: B.x, y: B.y }];
}

// ---------- ruas dan link ----------

export const ROADS = {};
export const LINKS = {};

for (const def of ROAD_DEFS) {
  const points = centerline(def);
  const road = makeRoad({ id: def.id, points, lanesPerDir: 1, laneWidth: LANE_W, sidewalk: SIDEWALK, trimStart: TRIM, trimEnd: TRIM });
  const R = { ...def, points, road, length: polylineLength(points), path: new Path(points), links: [] };
  ROADS[def.id] = R;
  addLink(R, def.a, def.b, road.lanes.find((l) => l.dir === 1).points);
  addLink(R, def.b, def.a, road.lanes.find((l) => l.dir === -1).points);
  // arah lengan jalan dari tiap node (untuk lengkung trotoar)
  const n = points.length;
  NODES[def.a].arms.push(unit(points[1].x - points[0].x, points[1].y - points[0].y));
  NODES[def.b].arms.push(unit(points[n - 2].x - points[n - 1].x, points[n - 2].y - points[n - 1].y));
}
export const ROAD_LIST = Object.values(ROADS);

function addLink(R, from, to, fullPts) {
  const len = polylineLength(fullPts);
  const pts = slicePolyline(fullPts, TRIM, len - TRIM);
  const lane = new Path(pts);
  const n = pts.length;
  const L = {
    id: `${from}>${to}`,
    road: R,
    from: NODES[from],
    to: NODES[to],
    pts,
    lane,
    length: lane.length,
    cost: R.length, // biaya sisi graf = panjang ruas (garis tengah, pusat ke pusat)
    startHeading: Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x),
    endHeading: Math.atan2(pts[n - 1].y - pts[n - 2].y, pts[n - 1].x - pts[n - 2].x),
    reverse: `${to}>${from}`,
    next: [],
    light: null,
    zebras: [],
    halte: [],
  };
  LINKS[L.id] = L;
  R.links.push(L);
}
export const LINK_LIST = Object.values(LINKS);

// link lanjutan (tanpa putar balik) dan kurva penghubung di persimpangan
export const MOVES = new Map();
for (const L of LINK_LIST) {
  for (const M of LINK_LIST) {
    if (M.from !== L.to || M.id === L.reverse) continue;
    L.next.push(M.id);
    const p0 = L.pts[L.pts.length - 1];
    const p1 = M.pts[0];
    const h0 = L.endHeading;
    const h1 = M.startHeading;
    const dh = wrapAngle(h1 - h0);
    let points;
    let radius = Infinity;
    let turn = 'lurus';
    if (Math.abs(dh) < 0.1) points = [{ x: p0.x, y: p0.y }, { x: p1.x, y: p1.y }];
    else {
      // titik kontrol 0,5523 R membuat kurva Bezier kubik hampir berupa busur lingkaran
      radius = Math.abs((p1.x - p0.x) * Math.cos(h0) + (p1.y - p0.y) * Math.sin(h0));
      const chord = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      points = connector(p0, h0, p1, h1, { tension: (0.5523 * radius) / chord, segments: 12 });
      turn = dh < 0 ? 'kiri' : 'kanan';
    }
    const move = { id: `${L.id}|${M.id}`, node: L.to, in: L, out: M, points, length: polylineLength(points), turn, radius, conflicts: new Set() };
    MOVES.set(move.id, move);
    L.to.moves.push(move);
  }
}

// dua gerakan di satu persimpangan bersilangan bila lintasannya berdekatan (< 2,4 m) atau menuju lajur yang sama
for (const N of NODE_LIST) {
  const samples = new Map(N.moves.map((m) => [m, resamplePolyline(m.points, 0.5)]));
  for (let i = 0; i < N.moves.length; i++) {
    for (let j = i + 1; j < N.moves.length; j++) {
      const a = N.moves[i];
      const b = N.moves[j];
      if (a.in === b.in) continue; // antre di lajur yang sama, diatur oleh jarak ikut
      let hit = a.out === b.out;
      if (!hit) {
        const pa = samples.get(a);
        const pb = samples.get(b);
        outer: for (const p of pa) {
          for (const q of pb) {
            if ((p.x - q.x) ** 2 + (p.y - q.y) ** 2 < 2.4 * 2.4) {
              hit = true;
              break outer;
            }
          }
        }
      }
      if (hit) {
        a.conflicts.add(b);
        b.conflicts.add(a);
      }
    }
  }
}

// ---------- lampu lalu lintas ----------

function lightFor(linkId) {
  const L = LINKS[linkId];
  const end = L.pts[L.pts.length - 1];
  const h = L.endHeading;
  // tiang di tepi kiri jalan, sejajar garis henti, muka lampu menghadap kendaraan yang datang
  const off = 2.45;
  const light = new TrafficLight({
    id: `lampu-${linkId}`,
    x: end.x + Math.sin(h) * off,
    y: end.y - Math.cos(h) * off,
    heading: h + Math.PI,
    label: `Lampu ${L.to.name}`,
  });
  L.light = light;
  return light;
}

export const PLANS = [
  new SignalPlan(
    [
      { lights: [lightFor('F>B'), lightFor('D>B')], green: 10 },
      { lights: [lightFor('E>B')], green: 6 },
    ],
    { yellow: 3, allRed: 1.5, offset: 0 },
  ),
  new SignalPlan(
    [
      { lights: [lightFor('B>E'), lightFor('H>E')], green: 8 },
      { lights: [lightFor('D>E'), lightFor('F>E')], green: 8 },
    ],
    { yellow: 3, allRed: 1.5, offset: 6 },
  ),
  new SignalPlan(
    [
      { lights: [lightFor('D>H'), lightFor('F>H')], green: 10 },
      { lights: [lightFor('E>H')], green: 6 },
    ],
    { yellow: 3, allRed: 1.5, offset: 12 },
  ),
];
export const LIGHTS = PLANS.flatMap((p) => p.lights);

// garis henti (berlampu) dan garis beri jalan (tanpa lampu) di ujung tiap lajur
export const STOP_MARKS = LINK_LIST.map((L) => {
  const p = L.lane.sample(L.length - 0.4);
  return { link: L, signal: L.to.signal, x: p.x, y: p.y, heading: L.endHeading, line: stopLine({ x: p.x, y: p.y, heading: L.endHeading, length: 3.3 }) };
});

// ---------- zebra cross ----------

const ZEBRA_DEFS = [
  { id: 'z-gerbang', road: 'DH', x: 0, y: 68, walk: 0, name: 'dekat Gerbang Utama' },
  { id: 'z-asrama', road: 'DH', x: 17, y: 100, walk: Math.PI / 2, name: 'dekat Asrama' },
  { id: 'z-perpus', road: 'FB', x: 120, y: 34, walk: Math.PI, name: 'dekat Perpustakaan' },
];
export const ZEBRA_BAND = 3.2;
export const ZEBRAS = ZEBRA_DEFS.map((d) => {
  const u = { x: Math.cos(d.walk), y: Math.sin(d.walk) };
  const Z = {
    ...d,
    u, // arah menyeberang
    v: { x: -u.y, y: u.x }, // arah sepanjang jalan
    curb: HALF_W + 1.3, // jarak titik tunggu dari garis tengah
    cw: crosswalk({ x: d.x, y: d.y, heading: d.walk, length: 2 * HALF_W, width: ZEBRA_BAND }),
    timer: 0,
  };
  for (const L of ROADS[d.road].links) {
    const c = L.lane.closest(d.x, d.y).s;
    L.zebras.push({ zebra: Z, s0: c - ZEBRA_BAND / 2 - 0.2, s1: c + ZEBRA_BAND / 2 + 0.2 });
  }
  return Z;
});
// urutkan zebra cross di tiap link menurut posisinya sepanjang lajur
for (const L of LINK_LIST) L.zebras.sort((a, b) => a.s0 - b.s0);

// ---------- halte (urutan = urutan layanan shuttle) ----------

const HALTE_DEFS = [
  { id: 'gerbang', name: 'Gerbang Utama', color: '#f472b6', link: 'D>H', at: { x: 1.75, y: 85 } },
  { id: 'asrama', name: 'Asrama', color: '#c084fc', link: 'D>H', at: { x: 32, y: 98.25 } },
  { id: 'kantin', name: 'Kantin', color: '#fb923c', link: 'H>F', at: { x: 99, y: 98.25 } },
  { id: 'perpus', name: 'Perpustakaan', color: '#60a5fa', link: 'F>B', at: { x: 118.25, y: 19 } },
  { id: 'rektorat', name: 'Rektorat', color: '#a3e635', link: 'B>D', at: { x: 25, y: 1.75 } },
];
export const SHUTTLE_LEN = 5;
export const HALTE = HALTE_DEFS.map((d, index) => {
  const L = LINKS[d.link];
  const s = L.lane.closest(d.at.x, d.at.y).s; // posisi bemper depan shuttle saat berhenti
  const mid = L.lane.sample(s - SHUTTLE_LEN / 2);
  const h = mid.heading;
  const left = { x: Math.sin(h), y: -Math.cos(h) };
  const fwd = { x: Math.cos(h), y: Math.sin(h) };
  const at = (lat, lon = 0) => ({ x: mid.x + left.x * lat + fwd.x * lon, y: mid.y + left.y * lat + fwd.y * lon });
  const c = at(3.25);
  const H = {
    ...d,
    index,
    link: L,
    s,
    heading: h,
    left,
    fwd,
    shelter: { x: c.x, y: c.y, heading: h, length: 5.5, width: 1.6 },
    door: at(1.1, 0.4), // titik pintu kiri shuttle saat berhenti
    queueAt: (k) => at(2.3, 1.6 - k * 0.8), // posisi penumpang ke-k yang menunggu
    labelAt: at(5.2),
  };
  L.halte.push(H);
  return H;
});

// ---------- pemandangan ----------

const B = (x0, y0, x1, y1, name = '', extra = {}) => ({ ...rectBox(x0, y0, x1, y1), id: `gedung-${x0}-${y0}`, kind: 'building', label: name || 'Gedung', name, ...extra });

export const BUILDINGS = [
  B(14, 10, 46, 26, 'Rektorat'),
  B(30, 31, 52, 42, 'Gedung Kuliah A'),
  B(88, 15, 111, 42, 'Perpustakaan'),
  B(66, 8, 82, 24, 'Gedung Kuliah B'),
  B(66, 30, 82, 42, 'Laboratorium'),
  B(14, 70, 30, 88, 'Asrama Putra'),
  B(34, 70, 52, 90, 'Asrama Putri'),
  B(16, 58, 44, 65, 'Aula'),
  B(80, 76, 106, 91, 'Kantin'),
  B(66, 58, 86, 70, 'Gedung Kuliah C'),
  B(-24, 76, -14, 84, 'Pos'),
  B(20, -42, 46, -16, 'Masjid Kampus'),
  B(70, -44, 112, -16, 'Gedung Olahraga'),
  B(-52, -40, -16, -14, 'Gedung Pascasarjana'),
  B(74, 116, 110, 140, 'Auditorium'),
  B(126, 116, 170, 142, 'Asrama Mahasiswa'),
  B(-54, 96, -18, 124),
  B(146, -40, 176, -12, 'Gedung Riset'),
];
for (const b of BUILDINGS) b._br = Math.hypot(b.length, b.width) / 2;

const FIELD = { x0: 134, y0: 6, x1: 176, y1: 74 };
const PARKING = { x0: -52, y0: 8, x1: -16, y1: 44 };
const POND = { x: 34, y: 130, rx: 22, ry: 10 };
const GATE = { x: -9, y: 68 };
const WALK = [
  { x0: -60, y0: 66.2, x1: -6, y1: 69.8 }, // jalan setapak dari gerbang
  { x0: 22, y0: 26, x1: 26, y1: 44 },
  { x0: 97, y0: 42, x1: 101, y1: 44 },
];

// mobil parkir (hiasan, tetap menjadi objek bagi sensor)
export const PARKED = [];
for (let i = 0; i < 6; i++) {
  if (i === 2) continue;
  PARKED.push({ id: `parkir-${i}`, kind: 'car', label: 'Mobil parkir', x: -47 + i * 5.6, y: 13.2, heading: Math.PI / 2, length: 4.5, width: 1.8, color: COLORS.vehicles[i % 6] });
}
for (let i = 0; i < 6; i++) {
  if (i === 4) continue;
  PARKED.push({ id: `parkir-b${i}`, kind: 'car', label: 'Mobil parkir', x: -47 + i * 5.6, y: 38.8, heading: -Math.PI / 2, length: 4.5, width: 1.8, color: COLORS.vehicles[(i + 3) % 6] });
}

function hash(a, b) {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function distToRoads(x, y) {
  let best = Infinity;
  for (const R of ROAD_LIST) {
    const pts = R.points;
    for (let i = 1; i < pts.length; i++) {
      const q = closestPointOnSegment(x, y, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
      best = Math.min(best, Math.hypot(x - q.x, y - q.y));
    }
  }
  return best;
}

function isFree(x, y, r) {
  if (distToRoads(x, y) < HALF_W + SIDEWALK + r + 0.4) return false;
  for (const b of BUILDINGS) if (Math.abs(x - b.x) < b.length / 2 + r + 1 && Math.abs(y - b.y) < b.width / 2 + r + 1) return false;
  const inRect = (R, m) => x > R.x0 - m && x < R.x1 + m && y > R.y0 - m && y < R.y1 + m;
  if (inRect(FIELD, r + 1) || inRect(PARKING, r + 1)) return false;
  for (const w of WALK) if (inRect(w, r)) return false;
  if (((x - POND.x) / (POND.rx + r + 1)) ** 2 + ((y - POND.y) / (POND.ry + r + 1)) ** 2 < 1) return false;
  if (Math.hypot(x - GATE.x, y - GATE.y) < 7 + r) return false;
  return true;
}

// pohon: sebar semu-acak yang tetap (hash), tidak menimpa jalan, gedung, atau lapangan
export const TREES = [];
for (let gx = EXT.minX + 3; gx < EXT.maxX; gx += 7) {
  for (let gy = EXT.minY + 3; gy < EXT.maxY; gy += 7) {
    const h1 = hash(gx, gy);
    if (h1 < 0.42) continue;
    const x = gx + (hash(gy, gx) - 0.5) * 4;
    const y = gy + (hash(gx + 3, gy - 7) - 0.5) * 4;
    const r = 1.6 + hash(gx - 1, gy + 5) * 1.4;
    if (!isFree(x, y, r)) continue;
    TREES.push({ x, y, r });
  }
}
// batang pohon di dekat jalan menjadi objek sensor
export const TRUNKS = TREES.filter((t) => distToRoads(t.x, t.y) < 22).map((t, i) => ({ id: `pohon-${i}`, kind: 'tree', label: 'Pohon', x: t.x, y: t.y, radius: 0.35 }));

export const SHELTERS = HALTE.map((h) => ({ ...h.shelter, id: `halte-${h.id}`, kind: 'building', label: `Halte ${h.name}` }));
export const SPEED_SIGNS = [
  { x: 5.6, y: 60.5 },
  { x: 114.4, y: 39.5 },
  { x: 71, y: 5.6 },
];

// ---------- pencarian di peta ----------

/** Ruas jalan terdekat dari titik (x, y) dalam toleransi `tol` (m), tidak termasuk kotak persimpangan. */
export function roadAt(x, y, tol = 0) {
  for (const N of NODE_LIST) if (Math.abs(x - N.x) < HALF_W + 1 && Math.abs(y - N.y) < HALF_W + 1) return null;
  let best = null;
  let bestD = HALF_W + tol;
  for (const R of ROAD_LIST) {
    const c = R.path.closest(x, y);
    if (c.dist < bestD && c.s > HALF_W && c.s < R.length - HALF_W) {
      bestD = c.dist;
      best = R;
    }
  }
  return best;
}

/** Halte terdekat dari titik (x, y) dalam toleransi `tol` (m). */
export function halteAt(x, y, tol = 0) {
  let best = null;
  let bestD = 3.2 + tol;
  for (const H of HALTE) {
    const d = Math.min(Math.hypot(x - H.shelter.x, y - H.shelter.y), Math.hypot(x - H.labelAt.x, y - H.labelAt.y) + 0.8);
    if (d < bestD) {
      bestD = d;
      best = H;
    }
  }
  return best;
}

/** Derajat node dengan ruas yang masih terbuka. */
export function openDegree(node, closed) {
  let n = 0;
  for (const R of ROAD_LIST) if ((R.a === node.id || R.b === node.id) && !closed.has(R.id)) n++;
  return n;
}

// ---------- gambar statis ----------

function drawFillets(g) {
  g.fillStyle = COLORS.asphalt;
  for (const N of NODE_LIST) {
    g.fillRect(N.x - HALF_W, N.y - HALF_W, 2 * HALF_W, 2 * HALF_W);
    for (let i = 0; i < N.arms.length; i++) {
      for (let j = 0; j < N.arms.length; j++) {
        if (i === j) continue;
        const d1 = N.arms[i];
        const d2 = N.arms[j];
        if (Math.abs(d1.x * d2.x + d1.y * d2.y) > 0.1 || i > j) continue;
        const r = FILLET_R;
        const q = { x: N.x + (d1.x + d2.x) * HALF_W, y: N.y + (d1.y + d2.y) * HALF_W };
        const c = { x: N.x + (d1.x + d2.x) * (HALF_W + r), y: N.y + (d1.y + d2.y) * (HALF_W + r) };
        const t1 = { x: q.x + d1.x * r, y: q.y + d1.y * r };
        const a1 = Math.atan2(t1.y - c.y, t1.x - c.x);
        const a2 = Math.atan2(q.y + d2.y * r - c.y, q.x + d2.x * r - c.x);
        const sweep = wrapAngle(a2 - a1);
        g.beginPath();
        g.moveTo(q.x, q.y);
        g.lineTo(t1.x, t1.y);
        g.arc(c.x, c.y, r, a1, a1 + sweep, sweep < 0);
        g.closePath();
        g.fill();
      }
    }
  }
}

function drawField(g, px) {
  const F = FIELD;
  g.fillStyle = '#1a4a33';
  g.fillRect(F.x0, F.y0, F.x1 - F.x0, F.y1 - F.y0);
  // garis lapangan sepak bola (lapangan tegak)
  g.fillStyle = 'rgba(255,255,255,0.05)';
  for (let y = F.y0; y < F.y1; y += 8) g.fillRect(F.x0, y, F.x1 - F.x0, 4);
  g.strokeStyle = 'rgba(229,231,235,0.55)';
  g.lineWidth = 0.25;
  const m = 3;
  g.strokeRect(F.x0 + m, F.y0 + m, F.x1 - F.x0 - 2 * m, F.y1 - F.y0 - 2 * m);
  const cx = (F.x0 + F.x1) / 2;
  const cy = (F.y0 + F.y1) / 2;
  g.beginPath();
  g.moveTo(F.x0 + m, cy);
  g.lineTo(F.x1 - m, cy);
  g.stroke();
  g.beginPath();
  g.arc(cx, cy, 6, 0, TAU);
  g.stroke();
  g.strokeRect(cx - 9, F.y0 + m, 18, 9);
  g.strokeRect(cx - 9, F.y1 - m - 9, 18, 9);
}

function drawParking(g) {
  const P = PARKING;
  g.fillStyle = COLORS.asphaltDark;
  g.fillRect(P.x0, P.y0, P.x1 - P.x0, P.y1 - P.y0);
  g.strokeStyle = 'rgba(229,231,235,0.4)';
  g.lineWidth = 0.12;
  g.beginPath();
  for (let i = 0; i <= 6; i++) {
    const x = P.x0 + 2.2 + i * 5.6;
    g.moveTo(x, P.y0 + 1);
    g.lineTo(x, P.y0 + 9);
    g.moveTo(x, P.y1 - 9);
    g.lineTo(x, P.y1 - 1);
  }
  g.stroke();
  // jalan masuk parkir dari jalan lingkar
  g.fillStyle = COLORS.asphaltDark;
  g.fillRect(P.x1, 22.5, -3.5 - P.x1 + 0.1, 7);
  for (const c of PARKED) drawCar(g, c, { shadow: true });
}

function drawPond(g) {
  const P = POND;
  g.fillStyle = '#0f3147';
  g.beginPath();
  g.ellipse(P.x, P.y, P.rx + 1.2, P.ry + 1.2, 0, 0, TAU);
  g.fill();
  g.fillStyle = '#123a52';
  g.beginPath();
  g.ellipse(P.x, P.y, P.rx, P.ry, 0, 0, TAU);
  g.fill();
  g.fillStyle = 'rgba(96,165,250,0.12)';
  g.beginPath();
  g.ellipse(P.x - 5, P.y - 2.5, P.rx * 0.5, P.ry * 0.35, 0, 0, TAU);
  g.fill();
}

function drawGate(g) {
  // gerbang pejalan kaki di sisi barat, menghadap zebra cross Gerbang Utama
  g.fillStyle = COLORS.sidewalk;
  for (const w of WALK) g.fillRect(w.x0, w.y0, w.x1 - w.x0, w.y1 - w.y0);
  g.fillStyle = '#475569';
  g.fillRect(GATE.x - 1, GATE.y - 4.4, 2, 1.6);
  g.fillRect(GATE.x - 1, GATE.y + 2.8, 2, 1.6);
  g.fillStyle = '#2dd4bf';
  g.fillRect(GATE.x - 0.35, GATE.y - 3.2, 0.7, 6.4);
  // pagar kampus
  g.strokeStyle = 'rgba(148,163,184,0.45)';
  g.lineWidth = 0.3;
  g.setLineDash([1.2, 0.8]);
  g.beginPath();
  g.moveTo(GATE.x, EXT.minY);
  g.lineTo(GATE.x, GATE.y - 4.4);
  g.moveTo(GATE.x, GATE.y + 4.4);
  g.lineTo(GATE.x, EXT.maxY);
  g.stroke();
  g.setLineDash([]);
}

function drawNames(g, px) {
  const size = 10;
  g.font = `600 ${size * px}px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const b of BUILDINGS) {
    if (!b.name) continue;
    const w = g.measureText(b.name).width;
    if (w > b.length - 1.5 || size * px > b.width - 1) continue; // tulis hanya bila muat
    g.fillStyle = 'rgba(11,18,32,0.55)';
    g.fillText(b.name, b.x + 0.4 * px, b.y + 0.8 * px);
    g.fillStyle = 'rgba(203,213,225,0.72)';
    g.fillText(b.name, b.x, b.y);
  }
  const gateText = 'Gerbang Utama';
  g.fillStyle = 'rgba(203,213,225,0.8)';
  g.fillText(gateText, GATE.x - 3 - g.measureText(gateText).width / 2, GATE.y - 7.5);
  if (FIELD.x1 - FIELD.x0 > g.measureText('Lapangan').width) {
    g.fillStyle = 'rgba(229,231,235,0.5)';
    g.fillText('Lapangan', (FIELD.x0 + FIELD.x1) / 2, FIELD.y0 + 20);
  }
  g.fillStyle = 'rgba(203,213,225,0.55)';
  g.fillText('Parkir', (PARKING.x0 + PARKING.x1) / 2, (PARKING.y0 + PARKING.y1) / 2);
  g.fillText('Kolam', POND.x, POND.y);
}

/**
 * Gambar semua bagian peta yang tidak berubah: tanah, gedung, pohon, jalan, marka, zebra cross.
 * `px` = ukuran satu piksel layar dalam meter (untuk teks dan garis tipis).
 */
export function drawStatic(g, px) {
  g.fillStyle = COLORS.ground;
  g.fillRect(EXT.minX, EXT.minY, EXT.maxX - EXT.minX, EXT.maxY - EXT.minY);
  // taman di dalam jalan lingkar sedikit lebih terang
  g.fillStyle = COLORS.groundAlt;
  g.fillRect(6, 6, 108, 88);
  drawField(g, px);
  drawPond(g);
  drawGate(g);
  drawParking(g);
  // halaman gedung
  g.fillStyle = 'rgba(148,163,184,0.08)';
  for (const b of BUILDINGS) g.fillRect(b.x - b.length / 2 - 1.5, b.y - b.width / 2 - 1.5, b.length + 3, b.width + 3);
  for (const b of BUILDINGS) drawBuilding(g, b);

  // jalan: trotoar dulu, lalu aspal dan persimpangan, lalu marka
  g.fillStyle = COLORS.sidewalk;
  for (const R of ROAD_LIST) {
    polygonPath(g, R.road.sidewalkPolygon);
    g.fill();
  }
  for (const N of NODE_LIST) g.fillRect(N.x - HALF_W - SIDEWALK, N.y - HALF_W - SIDEWALK, 2 * (HALF_W + SIDEWALK), 2 * (HALF_W + SIDEWALK));
  g.fillStyle = COLORS.asphalt;
  for (const R of ROAD_LIST) {
    polygonPath(g, R.road.polygon);
    g.fill();
  }
  drawFillets(g);
  for (const R of ROAD_LIST) drawRoadMarkings(g, R.road);
  for (const m of STOP_MARKS) {
    if (m.signal) drawStopLine(g, m.line);
    else {
      // garis beri jalan (putus-putus) di persimpangan tanpa lampu
      const c = Math.cos(m.heading + Math.PI / 2);
      const s = Math.sin(m.heading + Math.PI / 2);
      drawLine(g, [{ x: m.x - c * 1.65, y: m.y - s * 1.65 }, { x: m.x + c * 1.65, y: m.y + s * 1.65 }], { color: withAlpha(COLORS.laneMark, 0.85), width: 0.3, dash: [0.6, 0.45], cap: 'butt' });
    }
  }
  for (const Z of ZEBRAS) drawCrosswalk(g, Z.cw);

  for (const t of TREES) drawTree(g, t.x, t.y, t.r);
  drawNames(g, px);
}

