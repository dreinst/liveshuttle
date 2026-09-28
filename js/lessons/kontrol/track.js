// Lintasan uji tertutup untuk pelajaran Kendali, diambil dari jalan sungguhan.
//
// Bentuknya berasal dari data OpenStreetMap (berkas js/data/machung-2d.json): boulevard satu arah
// di kawasan Villa Puncak Tidar, selatan Universitas Ma Chung, dari bundaran besar di barat daya
// kampus sampai bundaran di timur, lalu kembali lewat jalur satu arah di sisi seberang. Rute yang
// sama dipakai kanvas beranda.
//
// Langkah membangun jalur acuan:
//   1. rute graf dari bundaran barat ke bundaran timur dan kembali (jalan satu arah dipatuhi);
//   2. garis rute digeser ke tengah lajur kiri (boulevard ini satu lajur per arah menurut data,
//      jadi tengah lajur = tengah badan jalan);
//   3. dicuplik ulang tiap 1 m, lalu dihaluskan dengan rata-rata berbobot Gauss (sigma 5 m) supaya
//      sudut-sudut kecil garis OSM tidak menjadi lonjakan kelengkungan;
//   4. penghalusan menarik jalur di bundaran ke arah pulau tengah, jadi titik yang terlalu dekat ke
//      pusat bundaran didorong kembali ke garis tengah cincin, lalu dihaluskan tipis (sigma 2 m);
//   5. dicuplik ulang tiap 0,5 m, kelengkungan dihitung dari perubahan arah.
//
// Koordinat dalam meter (x ke timur, y ke selatan, titik asal = pusat kampus). Kelengkungan positif
// = belok KANAN (searah jarum jam di layar). Bundaran di Indonesia diputari searah jarum jam.

import { Path } from '../../engine/geometry.js';

/** Bundaran di ujung boulevard (titik dekat simpangnya, dari data peta). */
const LOOP_WAYPOINTS = [
  { x: -130, y: 109 }, // bundaran besar di barat daya kampus
  { x: 223, y: 254 }, // bundaran di timur, dekat Villa Puncak Tidar
];

const SMOOTH_SIGMA = 5; // m
const FINISH_SIGMA = 2; // m, penghalusan tipis sesudah cincin bundaran dikembalikan
const RING_INSET = 0.2; // m, jalur di cincin bundaran paling dekat sejauh ini di dalam garis tengah cincin
const SPACING = 0.5; // m, jarak titik jalur acuan
const ZONE_PAD = 14; // m, zona bundaran = cincin plus mulut masuk dan keluarnya
const START_AFTER_ZONE = 22; // m, garis start sesudah keluar dari bundaran barat

/** Rata-rata berbobot Gauss untuk titik-titik jalur tertutup berjarak ds. */
function smoothClosed(pts, ds, sigma) {
  const n = pts.length;
  const r = Math.ceil((3 * sigma) / ds);
  const w = [];
  let ws = 0;
  for (let k = -r; k <= r; k++) {
    const v = Math.exp(-0.5 * ((k * ds) / sigma) ** 2);
    w.push(v);
    ws += v;
  }
  return pts.map((_, i) => {
    let x = 0;
    let y = 0;
    for (let k = -r; k <= r; k++) {
      const q = pts[(((i + k) % n) + n) % n];
      x += q.x * w[k + r];
      y += q.y * w[k + r];
    }
    return { x: x / ws, y: y / ws };
  });
}

/** Cuplik ulang jalur tertutup menjadi titik berjarak sama, sekitar `spacing` m. Hasil { pts, ds }. */
function resampleClosed(pts, spacing) {
  const p = new Path(pts, { closed: true });
  const n = Math.round(p.length / spacing);
  const out = [];
  for (let i = 0; i < n; i++) {
    const q = p.sample((i * p.length) / n);
    out.push({ x: q.x, y: q.y });
  }
  return { pts: out, ds: p.length / n };
}

/**
 * Bangun lintasan dari peta 'machung' (OsmMap dari ctx.loadMap). Hasil:
 *   ref        Path tertutup (jalur acuan = tengah lajur kiri), titik tiap 0,5 m, s = 0 di garis start
 *   curvature  kelengkungan per titik ref (1/m)
 *   zones      [{ s0, s1, roundabout }] bagian jalur di zona bundaran (s0 bisa > s1 bila melewati start)
 *   roads      ruas OSM yang dilalui (untuk disorot di peta)
 *   roadWidth  lebar badan jalan (m, perkiraan dari data)
 *   bounds     kotak pembatas lintasan
 */
export function buildTrack(map) {
  const graph = map.graph({ cost: 'length' });
  const ids = LOOP_WAYPOINTS.map((p) => graph.nearestNode(p.x, p.y).id);
  const nodePath = [];
  for (let i = 0; i < ids.length; i++) {
    const r = graph.findRoute(ids[i], ids[(i + 1) % ids.length]);
    if (!r.found) throw new Error('Rute lintasan uji tidak ditemukan di peta.');
    nodePath.push(...(i ? r.path.slice(1) : r.path));
  }
  const routeRoads = graph.routeRoads(nodePath).map((r) => r.road);
  let raw = graph.routePoints(nodePath, { keepLeft: true });
  if (Math.hypot(raw[0].x - raw[raw.length - 1].x, raw[0].y - raw[raw.length - 1].y) < 0.5) raw = raw.slice(0, -1);

  // bundaran yang dilalui rute
  const used = new Set(routeRoads.map((r) => r.id));
  const rbs = map.roundabouts.filter((rb) => rb.roads.some((r) => used.has(typeof r === 'object' ? r.id : r)));

  // 1 m, dihaluskan, lalu 0,5 m
  const { pts: coarse, ds } = resampleClosed(raw, 1);
  let smooth = smoothClosed(coarse, ds, SMOOTH_SIGMA);
  // Penghalusan membuat lingkaran bundaran sedikit menyempit ke arah pulau tengahnya. Titik yang
  // terlalu dekat ke pusat bundaran didorong kembali ke garis tengah cincin, lalu dihaluskan tipis.
  smooth = smooth.map((p) => {
    for (const rb of rbs) {
      const dx = p.x - rb.x;
      const dy = p.y - rb.y;
      const d = Math.hypot(dx, dy);
      const r0 = rb.radius - RING_INSET;
      if (d > 1e-6 && d < r0) return { x: rb.x + (dx / d) * r0, y: rb.y + (dy / d) * r0 };
    }
    return p;
  });
  smooth = smoothClosed(smooth, ds, FINISH_SIGMA);
  let { pts } = resampleClosed(smooth, SPACING);
  const n = pts.length;
  const zoneOf = (p) => {
    for (let j = 0; j < rbs.length; j++) if (Math.hypot(p.x - rbs[j].x, p.y - rbs[j].y) - rbs[j].radius < ZONE_PAD) return j;
    return -1;
  };

  // garis start: sesudah keluar dari bundaran barat (bundaran terdekat dengan titik rute pertama)
  const west = rbs.reduce((best, rb, j) => (Math.hypot(rb.x - LOOP_WAYPOINTS[0].x, rb.y - LOOP_WAYPOINTS[0].y) < Math.hypot(rbs[best].x - LOOP_WAYPOINTS[0].x, rbs[best].y - LOOP_WAYPOINTS[0].y) ? j : best), 0);
  const inZone = pts.map(zoneOf);
  let exit = -1;
  for (let i = 0; i < n; i++) {
    if (inZone[i] === west && inZone[(i + 1) % n] !== west) {
      exit = (i + 1) % n;
      break;
    }
  }
  const shift = exit < 0 ? 0 : (exit + Math.round(START_AFTER_ZONE / SPACING)) % n;
  pts = [...pts.slice(shift), ...pts.slice(0, shift)];
  const zoneIdx = [...inZone.slice(shift), ...inZone.slice(0, shift)];

  const ref = new Path(pts, { closed: true });
  const spacing = ref.length / n;

  // kelengkungan: perubahan arah antara titik i-2 dan i+2 (plus minus 1 m), lalu dirata-rata sedikit
  const kRaw = pts.map((p, i) => {
    const a = pts[(i - 2 + n) % n];
    const b = pts[(i + 2) % n];
    const h1 = Math.atan2(p.y - a.y, p.x - a.x);
    const h2 = Math.atan2(b.y - p.y, b.x - p.x);
    const d = Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1));
    return d / (Math.hypot(p.x - a.x, p.y - a.y) / 2 + Math.hypot(b.x - p.x, b.y - p.y) / 2);
  });
  const curvature = kRaw.map((_, i) => {
    let sum = 0;
    for (let o = -2; o <= 2; o++) sum += kRaw[(i + o + n) % n];
    return sum / 5;
  });

  // zona bundaran sebagai rentang s
  const zones = [];
  for (let i = 0; i < n; i++) {
    const z = zoneIdx[i];
    if (z >= 0 && zoneIdx[(i - 1 + n) % n] !== z) {
      let j = i;
      while (zoneIdx[(j + 1) % n] === z && (j + 1) % n !== i) j = (j + 1) % n;
      zones.push({ s0: i * spacing, s1: ((j + 1) % n) * spacing, roundabout: rbs[z] });
    }
  }

  const roadWidth = routeRoads.reduce((w, r) => Math.max(w, r.width || 0), 0) || 5;
  return {
    ref,
    curvature,
    zones,
    roads: routeRoads,
    roundabouts: rbs,
    roadWidth,
    widthFromOsm: routeRoads.every((r) => r.widthFromOsm),
    bounds: map.boundsOf([{ points: pts }], roadWidth / 2 + 2),
    length: ref.length,
    spacing,
  };
}

/** Kelengkungan jalur acuan di posisi s (interpolasi linear antar titik). */
export function curvatureAt(track, s) {
  const L = track.length;
  s = ((s % L) + L) % L;
  const f = s / track.spacing;
  const i = Math.floor(f);
  const t = f - i;
  const n = track.curvature.length;
  const a = track.curvature[i % n];
  const b = track.curvature[(i + 1) % n];
  return a + (b - a) * t;
}

/** Apakah posisi s ada di zona bundaran? Hasil: zona atau null. */
export function zoneAt(track, s) {
  const L = track.length;
  s = ((s % L) + L) % L;
  for (const z of track.zones) {
    if (z.s0 <= z.s1 ? s >= z.s0 && s < z.s1 : s >= z.s0 || s < z.s1) return z;
  }
  return null;
}

/**
 * Titik terdekat pada jalur tertutup, hanya dicari di sekitar hintS (plus minus window meter).
 * Path.closest() di engine selalu mencari di seluruh jalur bila jalurnya tertutup, sehingga
 * bisa melompat ke bagian lintasan lain yang kebetulan dekat (di sini jalur seberang boulevard
 * hanya belasan meter jauhnya). Fungsi ini mencegahnya.
 * Hasil sama dengan Path.closest: { x, y, s, dist, heading, lateral } (lateral > 0 = di KIRI jalur).
 */
export function closestNear(path, px, py, hintS, window = 12) {
  if (hintS == null) return path.closest(px, py);
  const pts = path.points; // untuk Path tertutup, titik terakhir = titik pertama
  const segs = pts.length - 1;
  const L = path.length;
  const avg = L / segs;
  const center = path._segmentAt(((hintS % L) + L) % L);
  const span = Math.ceil(window / avg) + 1;
  let best = null;
  let bestD = Infinity;
  for (let o = -span; o <= span; o++) {
    const i = (((center + o) % segs) + segs) % segs;
    const a = pts[i];
    const b = pts[i + 1];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const l2 = ex * ex + ey * ey;
    let t = l2 > 0 ? ((px - a.x) * ex + (py - a.y) * ey) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = a.x + ex * t;
    const qy = a.y + ey * t;
    const d = (px - qx) ** 2 + (py - qy) ** 2;
    if (d < bestD) {
      bestD = d;
      best = { i, t, qx, qy, a, b };
    }
  }
  const { i, t, qx, qy, a, b } = best;
  const heading = Math.atan2(b.y - a.y, b.x - a.x);
  const s = path.cum[i] + t * (path.cum[i + 1] - path.cum[i]);
  const lateral = (px - qx) * Math.sin(heading) - (py - qy) * Math.cos(heading);
  return { x: qx, y: qy, s, dist: Math.sqrt(bestD), heading, lateral, index: i };
}
