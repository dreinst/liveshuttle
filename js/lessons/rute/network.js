// Bantuan jaringan jalan untuk pelajaran Perencanaan Rute (peta 'malang-roads').
//
// Isi file ini:
//   - stretchFrom(): potongan jalan bernama (sampai sekitar 300 m) untuk ditutup atau ditandai macet.
//   - buildSignals(): pengendali lampu lalu lintas dari titik lampu ASLI di OSM. Fase dan durasinya
//     disimulasikan (OSM tidak menyimpan jadwal lampu).
//   - buildRoute() dan joinAt(): lintasan lajur kiri untuk mobil, lengkap dengan jarak s tiap
//     simpang di sepanjang lintasan.
//   - stopLinesFor(): garis henti lampu yang dilewati sebuah rute.
//
// Koordinat dalam meter, x ke timur, y ke selatan (konvensi engine).

import { Path, bezierPoints } from '../../engine/geometry.js';
import { angleDiff, dist } from '../../engine/math.js';
import { shortStreetName, laneOffset } from '../../engine/osm2d.js';

/** Arah keluar dari simpang `nodeId` menyusuri ruas `road` (radian). */
function leaveHeading(road, nodeId) {
  const p = road.points;
  if (road.a === nodeId) return Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x);
  const n = p.length;
  return Math.atan2(p[n - 2].y - p[n - 1].y, p[n - 2].x - p[n - 1].x);
}

/**
 * Potongan jalan di sekitar `road`: ruas bernama sama yang bersambung lurus (belokan paling banyak
 * 60 derajat), diperpanjang ke dua arah sampai panjangnya sekitar maxLen. Jalan tanpa nama hanya
 * diteruskan lewat simpang yang bukan persimpangan (derajat 2).
 * opts: { maxLen = 320, usable(road) => boolean (misalnya ada di graf dan tidak dilindungi) }
 * Hasil: { roads, length, name, label }.
 */
export function stretchFrom(map, road, { maxLen = 320, usable = () => true } = {}) {
  const roads = [road];
  const used = new Set([road.id]);
  let length = road.length;
  const ends = [
    { node: road.b, from: road },
    { node: road.a, from: road },
  ];
  const next = (end) => {
    const node = map.nodes[end.node];
    if (!node) return null;
    const arrive = leaveHeading(end.from, end.node) + Math.PI; // arah datang ke simpang
    let best = null;
    let bestTurn = 1.05; // sekitar 60 derajat
    for (const r of node.roads) {
      if (used.has(r.id) || !r.drivable || !usable(r)) continue;
      if (r.roundabout && !road.roundabout) continue;
      if (road.name ? r.name !== road.name : r.name || node.degree !== 2) continue;
      const t = Math.abs(angleDiff(leaveHeading(r, end.node), arrive));
      if (t < bestTurn) {
        bestTurn = t;
        best = r;
      }
    }
    return best;
  };
  let grew = true;
  while (length < maxLen && grew) {
    grew = false;
    for (const end of ends) {
      if (length >= maxLen) break;
      const r = next(end);
      if (!r) continue;
      used.add(r.id);
      roads.push(r);
      length += r.length;
      end.node = r.a === end.node ? r.b : r.a;
      end.from = r;
      grew = true;
    }
  }
  const label = road.name ? shortStreetName(road.name) : 'jalan tanpa nama';
  return { roads, length, name: road.name, label };
}

// ---------- lampu lalu lintas ----------

/**
 * Durasi fase lampu (detik simulasi). Kuning dihitung dari kecepatan tertinggi kendaraan supaya
 * mobil yang tidak bisa berhenti dengan nyaman saat kuning menyala pasti sudah melewati garis henti
 * sebelum merah: kuning >= waktu reaksi + vMax / (2 a_nyaman) + cadangan 1 detik, dibulatkan ke atas
 * per 0,5 detik. Setelah kuning ada fase semua merah.
 */
export function signalTiming(vMax, { reaction, comfortDecel }) {
  const yellow = Math.ceil((reaction + vMax / (2 * comfortDecel) + 1) * 2) / 2;
  return { green: 18, yellow, allRed: 2, crossGreen: 26, crossRed: 12 };
}

function hashKey(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/**
 * Pengendali lampu dari map.signals (posisi asli OSM).
 *   - Lampu di dekat persimpangan (derajat 3 atau lebih, paling jauh 45 m) digabung menjadi satu
 *     pengendali 'junction' dengan dua kelompok arah (A dan B) yang bergantian hijau.
 *   - Lampu lain (misalnya lampu penyeberangan di tengah ruas) menjadi pengendali 'crossing':
 *     kendaraan hijau, kuning, lalu merah saat giliran penyeberang.
 * Hasil: { controllers, byRoad: Map(roadId -> [{ sig, ctrl }]), byNode: Map(nodeId -> ctrl), stateFor, groupFor, cycleIndex }.
 */
export function buildSignals(map, timing) {
  const byKey = new Map();
  const byRoad = new Map();
  const byNode = new Map();
  const T = timing;
  map.signals.forEach((sig, i) => {
    let key;
    let kind;
    let node = sig.node;
    if (sig.road) {
      const d = node ? Math.hypot(node.x - sig.x, node.y - sig.y) : Infinity;
      if (node && node.degree >= 3 && d <= 45) {
        key = `n${node.id}`;
        kind = 'junction';
      } else {
        key = `s${i}`;
        kind = 'crossing';
        node = null;
      }
    } else if (node) {
      key = `n${node.id}`;
      kind = node.degree >= 3 ? 'junction' : 'crossing';
    } else return;
    let c = byKey.get(key);
    if (!c) {
      c = { id: key, kind, node, x: node ? node.x : sig.x, y: node ? node.y : sig.y, axis: 0 };
      c.cycle = kind === 'junction' ? 2 * (T.green + T.yellow + T.allRed) : T.crossGreen + T.yellow + T.crossRed;
      c.offset = hashKey(key) * c.cycle;
      byKey.set(key, c);
      // sumbu kelompok A: arah datang lampu pertama (untuk lampu di simpang: arah jalan pertama)
      if (sig.road && node) c.axis = leaveHeading(sig.road, node.id) + Math.PI;
      else if (node && node.roads.length) c.axis = leaveHeading(node.roads[0], node.id);
    }
    if (sig.road) {
      if (!byRoad.has(sig.road.id)) byRoad.set(sig.road.id, []);
      byRoad.get(sig.road.id).push({ sig, ctrl: c });
    } else byNode.set(node.id, c);
  });
  const controllers = [...byKey.values()];

  /** Keadaan lampu ('green' | 'yellow' | 'red') untuk kelompok arah `group` pada waktu t. */
  function stateFor(c, group, t) {
    const u = (((t + c.offset) % c.cycle) + c.cycle) % c.cycle;
    if (c.kind === 'crossing') {
      if (u < T.crossGreen) return 'green';
      if (u < T.crossGreen + T.yellow) return 'yellow';
      return 'red';
    }
    const half = T.green + T.yellow + T.allRed;
    const mine = group === 0 ? u : (u - half + c.cycle) % c.cycle;
    if (mine < T.green) return 'green';
    if (mine < T.green + T.yellow) return 'yellow';
    return 'red';
  }

  /** Kelompok arah untuk kendaraan yang datang dengan arah `heading`. */
  function groupFor(c, heading) {
    if (c.kind === 'crossing') return 0;
    return Math.abs(Math.sin(heading - c.axis)) < Math.SQRT1_2 ? 0 : 1;
  }

  /** Nomor siklus (untuk mengingat keputusan saat kuning satu kali per siklus). */
  function cycleIndex(c, t) {
    return Math.floor((t + c.offset) / c.cycle);
  }

  return { controllers, byRoad, byNode, stateFor, groupFor, cycleIndex };
}

// ---------- lintasan rute ----------

function dedupe(points) {
  const out = [];
  for (const p of points) {
    const q = out[out.length - 1];
    if (!q || dist(p, q) > 0.05) out.push({ x: p.x, y: p.y });
  }
  return out;
}

/**
 * Lintasan lajur kiri untuk daftar node (id simpang). Tikungan dibulatkan (jari-jari 5 m). Putar
 * balik di sebuah simpang (A, B, A) dibuat melengkung ke kanan, sesuai lalu lintas lajur kiri.
 * Hasil: { nodes, edges (graph.routeRoads), path (Path), nodeS (jarak tiap node di lintasan) } atau null.
 */
export function buildRoute(graph, nodes) {
  if (!nodes || nodes.length < 2) return null;
  const edges = graph.routeRoads(nodes);
  if (edges.length !== nodes.length - 1) return null;
  const parts = [];
  let cur = [nodes[0]];
  for (let i = 1; i < nodes.length; i++) {
    cur.push(nodes[i]);
    if (i < nodes.length - 1 && nodes[i + 1] === nodes[i - 1]) {
      parts.push(cur);
      cur = [nodes[i]];
    }
  }
  parts.push(cur);
  let pts = [];
  for (const part of parts) {
    const pp = graph.routePoints(part, { keepLeft: true, smooth: 5 });
    if (!pts.length) {
      pts = pp;
      continue;
    }
    // putar balik: maju sedikit, melengkung ke kanan, lalu kembali di lajur seberang
    const a = pts[pts.length - 1];
    const a0 = pts[pts.length - 2] || a;
    const b = pp[0];
    const h = Math.atan2(a.y - a0.y, a.x - a0.x);
    const reach = Math.max(4, dist(a, b) * 1.2);
    const f = { x: Math.cos(h) * reach, y: Math.sin(h) * reach };
    const arc = bezierPoints(a, { x: a.x + f.x, y: a.y + f.y }, { x: b.x + f.x, y: b.y + f.y }, b, 14);
    pts = pts.concat(arc.slice(1, -1), pp);
  }
  pts = dedupe(pts);
  if (pts.length < 2) return null;
  const path = new Path(pts);
  const nodeS = [0];
  for (let i = 1; i < nodes.length; i++) {
    if (i === nodes.length - 1) {
      nodeS.push(path.length);
      break;
    }
    const n = graph.nodes.get(nodes[i]);
    const len = edges[i - 1].road.length;
    const guess = nodeS[i - 1] + len;
    const q = path.closest(n.x, n.y, guess, Math.max(25, len * 0.6));
    nodeS.push(Math.min(path.length, Math.max(nodeS[i - 1], q.s)));
  }
  return { nodes: nodes.slice(), edges, path, nodeS };
}

/**
 * Sambungkan lintasan lama (sampai sKeep) dengan lintasan `full`. Hasil: rute dengan path baru,
 * nodeS yang disesuaikan, dan `keep` (jarak sampai mana geometri lama dipakai).
 */
export function joinAt(old, full, sKeep, commitIdx) {
  const keepPt = old.path.sample(sKeep);
  const q = full.path.closest(keepPt.x, keepPt.y, Math.min(full.path.length, sKeep), 40);
  const oldPts = [];
  const P = old.path.points;
  for (let i = 0; i < P.length && old.path.cum[i] < sKeep - 1e-6; i++) oldPts.push(P[i]);
  oldPts.push({ x: keepPt.x, y: keepPt.y });
  const newPts = [{ x: q.x, y: q.y }];
  const F = full.path.points;
  for (let i = 0; i < F.length; i++) if (full.path.cum[i] > q.s + 1e-6) newPts.push(F[i]);
  const pts = dedupe(oldPts.concat(newPts));
  if (pts.length < 2) return null;
  const path = new Path(pts);
  const shift = sKeep + dist(keepPt, q) - q.s;
  const nodeS = full.nodes.map((_, i) => {
    if (i <= commitIdx && old.nodeS[i] <= sKeep) return old.nodeS[i];
    return Math.min(path.length, Math.max(sKeep, full.nodeS[i] + shift));
  });
  nodeS[nodeS.length - 1] = path.length;
  return { nodes: full.nodes, edges: full.edges, path, nodeS, keep: sKeep };
}

/**
 * Garis henti lampu di sepanjang rute, urut menurut s. Setiap garis:
 * { id, ctrl, s, group, x, y, heading, a, b (ujung segmen garis di dunia), curb }.
 * minS: hanya garis dengan s > minS (garis sebelumnya dipertahankan dari rute lama).
 */
export function stopLinesFor(signals, route, { minS = -Infinity } = {}) {
  const { nodes, edges, path, nodeS } = route;
  const raw = [];
  for (let i = 0; i < edges.length; i++) {
    const { road, forward } = edges[i];
    const to = nodes[i + 1];
    const s0 = nodeS[i];
    const s1 = nodeS[i + 1];
    const k = (s1 - s0) / Math.max(1e-6, road.length);
    for (const m of signals.byRoad.get(road.id) || []) {
      const c = m.ctrl;
      if (c.kind === 'junction' && c.node.id !== to) continue; // lampu arah lain di persimpangan asal
      const along = forward ? m.sig.s : road.length - m.sig.s;
      const guess = s0 + along * k;
      const q = path.closest(m.sig.x, m.sig.y, guess, Math.max(12, (s1 - s0) * 0.3));
      raw.push({ ctrl: c, s: Math.max(s0, Math.min(s1, q.s - 1)), road });
    }
    const c = signals.byNode.get(to);
    if (c) {
      const back = c.kind === 'junction' ? junctionSetback(c.node) : 3;
      raw.push({ ctrl: c, s: Math.max(s0, s1 - back), road });
    }
  }
  raw.sort((p, q) => p.s - q.s);
  const out = [];
  for (const r of raw) {
    // satu garis per pengendali per lintasan (lampu kembar di pendekat yang sama)
    const prev = out[out.length - 1];
    if (prev && prev.ctrl === r.ctrl && r.s - prev.s < 60) continue;
    if (r.s <= minS) continue;
    const p = path.sample(r.s);
    const a = path.sample(Math.max(0, r.s - 1.5));
    const b = path.sample(Math.min(path.length, r.s + 1.5));
    const heading = Math.atan2(b.y - a.y, b.x - a.x);
    const nx = Math.sin(heading);
    const ny = -Math.cos(heading);
    const half = 1.5;
    out.push({
      id: `${r.ctrl.id}@${Math.round(r.s)}`,
      ctrl: r.ctrl,
      s: r.s,
      group: signals.groupFor(r.ctrl, heading),
      x: p.x,
      y: p.y,
      heading,
      a: { x: p.x + nx * half, y: p.y + ny * half },
      b: { x: p.x - nx * half, y: p.y - ny * half },
      // jarak dari pusat lajur ke tepi kiri jalan (untuk tiang lampu)
      curb: Math.max(0.8, r.road.width / 2 - laneOffset(r.road, 0)),
    });
  }
  return out;
}

/**
 * Jarak garis henti dari titik simpang: separuh lebar jalan terlebar di simpang itu ditambah 2 m,
 * paling sedikit 4 m. Mobil berhenti di sini supaya tidak masuk ke area persimpangan.
 */
export function junctionSetback(node) {
  if (!node) return 4;
  return Math.max(4, ...node.roads.map((r) => (r.width || 5) / 2 + 2));
}

/** Nama singkat simpang (dari jalan terpenting yang bernama), untuk titik yang dipilih di peta. */
export function nodeLabel(map, nodeId) {
  const node = map.nodes[nodeId];
  if (!node) return 'Titik di peta';
  const named = node.roads.filter((r) => r.name).sort((a, b) => a.rank - b.rank);
  return named.length ? shortStreetName(named[0].name) : 'Simpang tanpa nama';
}

