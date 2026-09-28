// Rute keliling dan data jalan untuk pelajaran Lokalisasi, dibangun dari peta OpenStreetMap
// sekitar Alun-alun Merdeka Malang (js/data/malang-center.json, dimuat dengan ctx.loadMap).
//
// Rute: Jalan Merdeka Utara (sisi utara Alun-alun, ke barat), jalan penghubung ke Jalan Jenderal
// Basuki Rachmat (Kayutangan, ke utara), Jalan Majapahit, lalu Jalan Mgr. Sugiyopranoto kembali ke
// Jalan Merdeka Utara. Semua ruas ini satu arah di data OSM, jadi rute ini memang searah lalu lintas.
//
// Semua yang dihitung di sini berasal dari data peta:
//   - garis tengah lajur kiri (lalu lintas kiri) dari graf jalan, sudutnya dibulatkan;
//   - "langit terlihat" di tiap titik rute dari tinggi gedung di kiri dan kanan jalan. Tinggi gedung
//     hampir semuanya PERKIRAAN (hanya 18 dari 3.816 gedung punya data tinggi di OSM);
//   - zona gedung tinggi = bagian rute yang langitnya sempit;
//   - landmark peta: sudut gedung bernama dari OSM, ditambah tiang lampu dan rambu contoh
//     (posisi tiang dan rambu dibuat simulator, bukan data OSM);
//   - zebra cross bertanda (crossing=marked) dari OSM, dan trotoar untuk pejalan kaki.
//
// Koordinat dalam meter, x ke timur, y ke selatan (konvensi engine).

import { Path, rayPolygon, distanceToShape } from '../../engine/geometry.js';
import { angleDiff } from '../../engine/math.js';
import { laneOffset, shortStreetName } from '../../engine/osm2d.js';

/** Titik jalan yang dilewati berurutan (dicari simpang terdekat di graf). Titik pertama di tengah jalan lurus. */
const WAYPOINTS = Object.freeze([
  { x: 52, y: -77 }, // Jalan Merdeka Utara, depan Alun-alun
  { x: -23, y: -99 }, // ujung barat Jalan Merdeka Utara
  { x: -48, y: -150 }, // Jalan Jenderal Basuki Rachmat
  { x: -42, y: -216 }, // Jalan Jenderal Basuki Rachmat, simpang Jalan Majapahit
  { x: -5, y: -248 }, // Jalan Majapahit, simpang Jalan Mgr. Sugiyopranoto
  { x: 92, y: -81 }, // Jalan Mgr. Sugiyopranoto, simpang Jalan Merdeka Utara dan Merdeka Timur
]);

const STEP = 2; // jarak antarsampel data sepanjang rute (m)
const ANTENNA = 1.5; // tinggi antena GPS di atap mobil (m)
const SKY_LIMIT = 130; // lebar langit terlihat (derajat) di bawah batas ini = zona gedung tinggi
const LM_SPACING = 17; // jarak antartiang contoh sepanjang rute (m)
const LM_MIN_GAP = 6; // jarak minimum antarlandmark, supaya pemasangan LiDAR ke peta tidak tertukar

const wrap = (s, L) => ((s % L) + L) % L;

/**
 * Bangun semua data rute dari peta malang-center.
 * Hasil: { map, lanePath, length, samples, zones, landmarks, crossing, walkways, speedAt, infoAt, streetNames }
 */
export function buildRoute(map) {
  const graph = map.graph({ cost: 'length' });
  const ids = WAYPOINTS.map((p) => graph.nearestNode(p.x, p.y).id);
  let nodes = [ids[0]];
  for (let i = 0; i < ids.length; i++) {
    const r = graph.findRoute(ids[i], ids[(i + 1) % ids.length]);
    if (!r.found) throw new Error('Rute keliling Alun-alun tidak ditemukan di data peta.');
    nodes = nodes.concat(r.path.slice(1));
  }
  const roads = graph.routeRoads(nodes).map((r) => r.road);
  const roadSet = new Set(roads.map((r) => r.id));
  let pts = graph.routePoints(nodes, { keepLeft: true, lane: 0, smooth: 7 });
  if (Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 0.5) pts = pts.slice(0, -1);
  const lanePath = new Path(pts, { closed: true });
  const L = lanePath.length;

  // ---------- data per sampel ----------
  const n = Math.ceil(L / STEP);
  const samples = [];
  for (let i = 0; i < n; i++) {
    const s = i * STEP;
    const p = lanePath.sample(s);
    const hit = map.nearestRoad(p.x, p.y, { maxDist: 12, filter: (r) => roadSet.has(r.id) });
    const road = hit ? hit.road : roads[0];
    const o0 = laneOffset(road, 0);
    samples.push({
      s,
      x: p.x,
      y: p.y,
      heading: p.heading,
      road,
      name: road.name,
      // jarak dari tengah lajur ke tepi kiri dan kanan aspal (lebar jalan dari data, sebagian besar perkiraan)
      leftEdge: road.width / 2 - o0,
      rightEdge: road.width / 2 + o0,
    });
  }

  // ---------- langit terlihat dan zona gedung tinggi ----------
  for (const smp of samples) {
    const near = map.buildingsNear(smp.x, smp.y, 50);
    const side = (sign) => {
      let sum = 0;
      const hits = [];
      for (const k of [-0.5, -0.25, 0, 0.25, 0.5]) {
        const a = smp.heading + sign * (Math.PI / 2) + k;
        const dx = Math.cos(a);
        const dy = Math.sin(a);
        let best = 0;
        let bestB = null;
        for (const b of near) {
          const t = rayPolygon(smp.x, smp.y, dx, dy, b.points);
          if (!(t < 45)) continue;
          const m = (Math.atan2(Math.max(0, (b.height ?? 6) - ANTENNA), Math.max(t, 1)) * 180) / Math.PI;
          if (m > best) {
            best = m;
            bestB = b;
          }
        }
        sum += best;
        if (bestB) hits.push(bestB);
      }
      return { mask: sum / 5, hits };
    };
    // kiri arah gerak = heading - 90 derajat (y ke bawah)
    const left = side(-1);
    const right = side(1);
    smp.maskLeft = left.mask;
    smp.maskRight = right.mask;
    smp.sky = 180 - left.mask - right.mask;
    smp.blockers = [...left.hits, ...right.hits];
  }
  const zones = findZones(samples, L);
  for (const z of zones) {
    const set = new Map();
    for (const smp of samples) {
      if (!inZoneS(z, smp.s, L)) continue;
      smp.zone = z;
      for (const b of smp.blockers) if ((b.height ?? 0) >= 8) set.set(b.id, b);
    }
    z.buildings = [...set.values()];
    z.name = dominantName(samples.filter((smp) => smp.zone === z));
    z.maxHeight = Math.max(0, ...z.buildings.map((b) => b.height ?? 0));
    z.osmHeights = z.buildings.filter((b) => b.heightFromOsm).length;
  }
  for (const smp of samples) delete smp.blockers;

  const indexOf = (s) => Math.min(samples.length - 1, Math.max(0, Math.round(wrap(s, L) / STEP) % samples.length));
  const infoAt = (s) => samples[indexOf(s)];

  // ---------- profil kecepatan: pelan di tikungan ----------
  const speedSamples = new Float32Array(Math.ceil(L));
  const CURVE_ACC = 1.8; // percepatan ke samping yang nyaman (m/s^2)
  for (let i = 0; i < speedSamples.length; i++) {
    const h0 = lanePath.sample(i - 5).heading;
    const h1 = lanePath.sample(i + 5).heading;
    const k = Math.abs(angleDiff(h1, h0)) / 10;
    speedSamples[i] = k > 1e-4 ? Math.sqrt(CURVE_ACC / k) : 99;
  }
  // rem pelan sebelum tikungan: v^2 <= v_depan^2 + 2 a ds (diulang dua kali karena jalurnya melingkar)
  const DEC = 1.2;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = speedSamples.length - 1; i >= 0; i--) {
      const next = speedSamples[(i + 1) % speedSamples.length];
      speedSamples[i] = Math.min(speedSamples[i], Math.sqrt(next * next + 2 * DEC));
    }
  }
  const speedAt = (s) => speedSamples[Math.floor(wrap(s, L)) % speedSamples.length];

  // ---------- landmark peta ----------
  const landmarks = buildLandmarks(map, lanePath, samples, roadSet);

  // ---------- zebra cross dari OSM ----------
  const crossing = buildCrossing(map, lanePath, samples, roadSet);

  // ---------- trotoar untuk pejalan kaki ----------
  const walkways = buildWalkways(map, lanePath, samples);

  // nama jalan yang dilalui, sesuai urutan
  const streetNames = [];
  for (const smp of samples) if (smp.name && !streetNames.includes(smp.name)) streetNames.push(smp.name);

  return { map, lanePath, length: L, samples, zones, landmarks, crossing, walkways, speedAt, infoAt, streetNames };
}

/** Rentang s (bisa melewati titik awal) dari sampel yang langitnya sempit. */
function findZones(samples, L) {
  const flag = samples.map((smp) => smp.sky < SKY_LIMIT);
  const n = flag.length;
  // isi celah pendek (di bawah 20 m) supaya satu blok tidak pecah menjadi beberapa zona
  const gap = Math.round(20 / STEP);
  for (let i = 0; i < n; i++) {
    if (flag[i] || !flag[(i - 1 + n) % n]) continue;
    let j = 0;
    while (j < gap && !flag[(i + j) % n]) j++;
    if (j < gap) for (let k = 0; k < j; k++) flag[(i + k) % n] = true;
  }
  if (flag.every(Boolean) || !flag.some(Boolean)) return [];
  // mulai dari sampel yang bukan zona, lalu kumpulkan deretan
  const start = flag.findIndex((f) => !f);
  const zones = [];
  let cur = null;
  for (let k = 1; k <= n; k++) {
    const i = (start + k) % n;
    if (flag[i]) {
      if (!cur) cur = { i0: i, i1: i };
      else cur.i1 = i;
    } else if (cur) {
      zones.push(cur);
      cur = null;
    }
  }
  if (cur) zones.push(cur);
  return zones
    .map((z) => {
      const s0 = samples[z.i0].s - STEP / 2;
      const len = (((z.i1 - z.i0 + n) % n) + 1) * STEP;
      return { s0: wrap(s0, L), s1: wrap(s0 + len, L), length: len };
    })
    .filter((z) => z.length >= 24)
    .map((z, i) => ({ ...z, id: i }));
}

export function inZoneS(z, s, L) {
  const d = wrap(s - z.s0, L);
  return d <= z.length;
}

function dominantName(list) {
  const count = new Map();
  for (const smp of list) if (smp.name) count.set(smp.name, (count.get(smp.name) || 0) + 1);
  let best = '';
  let bn = 0;
  for (const [k, v] of count) if (v > bn) [best, bn] = [k, v];
  return best;
}

/** Aman untuk benda di trotoar: tidak di dalam gedung, tidak di atas jalan lain, tidak di atas lajur. */
function freeSpot(map, lanePath, roadSet, x, y, laneClear) {
  if (map.buildingAt(x, y)) return false;
  if (map.buildingsNear(x, y, 3).some((b) => distanceToShape(x, y, b) < 0.6)) return false;
  const other = map.nearestRoad(x, y, { drivable: true, maxDist: 6, filter: (r) => !roadSet.has(r.id) });
  if (other && other.dist < other.road.width / 2 + 1) return false;
  return lanePath.closest(x, y).dist >= laneClear;
}

function buildLandmarks(map, lanePath, samples, roadSet) {
  const L = lanePath.length;
  const corners = [];
  // 1. sudut gedung bernama dari OSM yang menghadap rute
  const named = new Map();
  for (const smp of samples) for (const b of map.buildingsNear(smp.x, smp.y, 40)) if (b.name) named.set(b.id, b);
  for (const b of named.values()) {
    const P = b.points;
    const m = P.length;
    let area = 0;
    for (let i = 0; i < m; i++) area += P[i].x * P[(i + 1) % m].y - P[(i + 1) % m].x * P[i].y;
    const orient = Math.sign(area) || 1;
    for (let i = 0; i < m; i++) {
      const a = P[(i - 1 + m) % m];
      const p = P[i];
      const c = P[(i + 1) % m];
      const ux = p.x - a.x;
      const uy = p.y - a.y;
      const vx = c.x - p.x;
      const vy = c.y - p.y;
      const lu = Math.hypot(ux, uy);
      const lv = Math.hypot(vx, vy);
      if (lu < 3 || lv < 3) continue; // sisi terlalu pendek untuk dikenali LiDAR sebagai sudut
      const turn = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
      // sudut cembung yang cukup tegas (belok 50 sampai 130 derajat searah orientasi poligon)
      if (turn * orient < (50 * Math.PI) / 180 || turn * orient > (130 * Math.PI) / 180) continue;
      // arah keluar: rata-rata arah dari kedua sisi menjauhi sudut
      let bx = ux / lu - vx / lv;
      let by = uy / lu - vy / lv;
      const bl = Math.hypot(bx, by) || 1;
      bx /= bl;
      by /= bl;
      const x = p.x + bx * 0.3;
      const y = p.y + by * 0.3;
      const q = lanePath.closest(x, y);
      if (q.dist < 4 || q.dist > 28) continue;
      corners.push({ id: `sudut-${b.index}-${i}`, kind: 'sudut', name: b.name, building: b, x, y, radius: 0.2, s: q.s });
    }
  }
  // 2. tiang lampu dan rambu contoh di trotoar, bergantian kiri dan kanan
  const poles = [];
  let k = 0;
  for (let s = 6; s < L - 4; s += LM_SPACING, k++) {
    const p = lanePath.sample(s);
    const smp = samples[Math.min(samples.length - 1, Math.round(s / STEP))];
    const left = k % 2 === 0;
    const off = left ? smp.leftEdge + 0.9 : -(smp.rightEdge + 0.9);
    const x = p.x + Math.sin(p.heading) * off;
    const y = p.y - Math.cos(p.heading) * off;
    if (!freeSpot(map, lanePath, roadSet, x, y, Math.abs(off) - 0.3)) continue;
    const kind = k % 3 === 2 ? 'rambu' : 'tiang';
    poles.push({ id: `lm-${k}`, kind, x, y, radius: kind === 'rambu' ? 0.3 : 0.2, s });
  }
  // 3. saring: landmark tidak boleh terlalu rapat. Sudut gedung bernama didahulukan.
  const kept = [];
  for (const lm of [...corners, ...poles]) {
    if (kept.every((o) => Math.hypot(o.x - lm.x, o.y - lm.y) >= LM_MIN_GAP)) kept.push(lm);
  }
  return kept;
}

function buildCrossing(map, lanePath, samples, roadSet) {
  // zebra cross bertanda di rute (OSM crossing=marked); bila tidak ada, pakai penyeberangan terdekat
  const cands = map.crossings
    .map((c) => ({ c, q: lanePath.closest(c.x, c.y) }))
    .filter(({ q }) => q.dist < 4)
    .sort((a, b) => (a.c.type === 'marked' ? 0 : 1) - (b.c.type === 'marked' ? 0 : 1) || a.q.dist - b.q.dist);
  if (!cands.length) return null;
  const { c, q } = cands[0];
  const smp = samples[Math.min(samples.length - 1, Math.round(q.s / STEP))];
  const h = q.heading;
  const lx = Math.sin(h);
  const ly = -Math.cos(h);
  // tengah jalan di titik penyeberangan (tepi kiri aspal ada leftEdge m di kiri tengah lajur)
  const cx = q.x + lx * (smp.leftEdge - smp.road.width / 2);
  const cy = q.y + ly * (smp.leftEdge - smp.road.width / 2);
  const half = smp.road.width / 2;
  const width = 3; // lebar zebra (m) searah jalan
  const curbL = { x: cx + lx * half, y: cy + ly * half };
  const curbR = { x: cx - lx * half, y: cy - ly * half };
  return {
    x: cx,
    y: cy,
    heading: h, // arah lalu lintas
    s: q.s,
    s0: q.s - width / 2, // tepi zebra yang lebih dulu dicapai mobil
    width,
    length: smp.road.width,
    curbL,
    curbR,
    left: { x: lx, y: ly },
    marked: c.type === 'marked',
    street: smp.name,
    osm: c.osm,
  };
}

// Potongan trotoar tempat pejalan kaki berjalan bolak-balik: [awal s, panjang, sisi (1 = kiri arah gerak)].
const WALK_SPECS = Object.freeze([
  [20, 50, -1], // Merdeka Utara, sisi utara (sisi selatan sudah jalur arah timur)
  [140, 56, 1], // Basuki Rachmat (Kayutangan), sisi barat, melewati zebra cross
  [150, 50, -1], // Basuki Rachmat, sisi timur
  [300, 56, 1], // Mgr. Sugiyopranoto
  [455, 50, -1], // Mgr. Sugiyopranoto, depan Mall Pelayanan Publik
]);

/** Apakah titik berada di atas aspal jalan mana pun (lebar jalan dari data, sebagian besar perkiraan)? */
function onAsphalt(map, x, y) {
  const hit = map.nearestRoad(x, y, { drivable: true, maxDist: 12, filter: (r) => r.cls !== 'service' && r.cls !== 'living_street' });
  return !!hit && hit.dist < hit.road.width / 2 + 0.6;
}

function buildWalkways(map, lanePath, samples) {
  // Trotoar: garis sejajar tepi aspal, 1,4 m di luar tepi jalan (lebar jalan sebagian besar perkiraan).
  const out = [];
  const n = samples.length;
  for (const [s0, len, side] of WALK_SPECS) {
    const i0 = Math.round(s0 / STEP);
    const pts = [];
    let ok = true;
    for (let k = 0; k <= Math.round(len / STEP); k++) {
      const smp = samples[(i0 + k) % n];
      const o = side > 0 ? smp.leftEdge + 1.4 : -(smp.rightEdge + 1.4);
      const p = { x: smp.x + Math.sin(smp.heading) * o, y: smp.y - Math.cos(smp.heading) * o };
      if (map.buildingAt(p.x, p.y) || lanePath.closest(p.x, p.y).dist < 2.4 || onAsphalt(map, p.x, p.y)) ok = false;
      pts.push(p);
    }
    if (ok) out.push({ side, pts, s0 });
  }
  return out;
}

/** Nama jalan pendek untuk HUD (Jalan menjadi Jl.). Ruas tanpa nama diberi keterangan. */
export function streetLabel(name) {
  return name ? shortStreetName(name) : 'Jalan penghubung';
}
