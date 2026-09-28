// Ruas Jalan Karangampel Timur (dari barat laut sampai sisi utara kampus Universitas Ma Chung)
// dari data OpenStreetMap, dipakai sebagai kerangka jalan pelajaran Persepsi.
//
// Sumber: js/data/machung-2d.json (OpenStreetMap, ODbL). Garis tengah jalan, gedung, dan nama
// jalan berasal dari data. Lebar jalan 7 m adalah perkiraan dari kelas jalan. Trotoar, bahu
// jalan, zebra cross, halte, papan iklan, tutup gorong-gorong, dan mobil parkir DITAMBAHKAN untuk
// simulasi; letaknya tidak sama dengan keadaan aslinya.
//
// Kerangka Frenet: s = jarak sepanjang garis tengah ke arah timur (m), d = geseran ke samping
// (positif = kiri arah timur, yaitu sisi utara). Lalu lintas kiri: kendaraan ke timur memakai
// lajur d > 0, kendaraan ke barat memakai lajur d < 0.

import { Path } from '../../engine/geometry.js';
import { crosswalk } from '../../engine/road.js';
import { COLORS } from '../../engine/theme.js';
import { wrapAngle } from '../../engine/math.js';
import { drawCrosswalk, drawHalte } from '../../engine/draw.js';

export const STREET_NAME = 'Jalan Karangampel Timur';
export const HALF_ROAD = 3.5; // setengah lebar aspal (lebar 7 m, perkiraan)

/** Posisi melintang (d, m) tiap jalur gerak. Positif = sisi utara. */
export const LINES = Object.freeze({
  ego: 1.75, // lajur ke timur, mobil otonom
  eastMotor: 2.35, // sepeda motor ke timur di lajur yang sama
  eastPass: 0.2, // sepeda motor ke timur yang menyelip di sisi kanan
  westCar: -1.65, // mobil dan angkot ke barat
  westCurb: -2.6, // angkot yang menepi di halte
  westMotor: -2.2,
  westPass: -0.25, // sepeda motor ke barat yang menyelip di sisi kanan
  westCycle: -3.05,
  walkNorthEast: 4.2, // pejalan kaki di trotoar utara, ke timur
  walkNorthWest: 4.95, // trotoar utara, ke barat
  walkSouth: -4.2, // bahu jalan selatan, ke barat
  crossWait: -4.2,
  passengerWait: -5.1,
  door: -3.85,
  parked: -5.7,
  halte: -6.45,
});

const STRIP_N = [HALF_ROAD, 5.6];
const SIDEWALK = '#4a5468';
const SHOULDER = '#454e61';
const CURB = '#8d97ad';
const STRIP_S = [-7.2, -HALF_ROAD];

// Ujung ruas yang dipakai (titik OSM terdekat) dan posisi benda tambahan (s, m).
const START = { x: -622, y: -389 };
const END = { x: 191, y: -175 };
export const ROUTE = Object.freeze({ start: 165, end: 790 });
const CROSSWALK_S = [225, 345, 415, 545, 645, 765];
const HALTE_S = [295, 590, 740];
const MANHOLE_STEP = 17;

function hash(k, i) {
  const v = Math.sin(k * 127.1 + i * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

/** Rangkai ruas tersier bernama STREET_NAME dari barat ke timur. */
function chainPoints(map) {
  const roads = map.roadsNamed(STREET_NAME).filter((r) => r.cls === 'tertiary');
  const byNode = new Map();
  for (const r of roads) {
    for (const n of [r.a, r.b]) {
      if (!byNode.has(n)) byNode.set(n, []);
      byNode.get(n).push(r);
    }
  }
  const nearest = (p) => {
    let best = null;
    let bd = Infinity;
    for (const id of byNode.keys()) {
      const n = map.nodes[id];
      const d = Math.hypot(n.x - p.x, n.y - p.y);
      if (d < bd) {
        bd = d;
        best = id;
      }
    }
    return best;
  };
  const endNode = nearest(END);
  let node = nearest(START);
  const used = new Set();
  const pts = [];
  const nodes = [node];
  for (let guard = 0; guard < 200 && node !== endNode; guard++) {
    const here = map.nodes[node];
    const next = (byNode.get(node) || []).filter((r) => !used.has(r)).map((r) => {
      const fwd = r.a === node;
      const far = fwd ? r.points[r.points.length - 1] : r.points[0];
      return { r, fwd, far };
    }).filter((c) => c.far.x > here.x - 1).sort((a, b) => b.far.x - a.far.x)[0];
    if (!next) break;
    used.add(next.r);
    const seq = next.fwd ? next.r.points : next.r.points.slice().reverse();
    for (const p of seq) {
      const l = pts[pts.length - 1];
      if (!l || Math.hypot(l.x - p.x, l.y - p.y) > 0.05) pts.push({ x: p.x, y: p.y });
    }
    node = next.fwd ? next.r.b : next.r.a;
    nodes.push(node);
  }
  return { pts, nodes, roads: [...used] };
}

/** Haluskan polyline: sampel ulang tiap `step` m lalu rata-rata bergerak (ujung tetap). */
function smoothLine(points, step = 2, win = 6, passes = 2) {
  const path = new Path(points);
  const n = Math.max(2, Math.round(path.length / step));
  let pts = [];
  for (let i = 0; i <= n; i++) {
    const p = path.sample((i / n) * path.length);
    pts.push({ x: p.x, y: p.y });
  }
  for (let k = 0; k < passes; k++) {
    const out = pts.map((p) => ({ ...p }));
    for (let i = 1; i < pts.length - 1; i++) {
      const w = Math.min(win, i, pts.length - 1 - i);
      let sx = 0;
      let sy = 0;
      for (let j = i - w; j <= i + w; j++) {
        sx += pts[j].x;
        sy += pts[j].y;
      }
      out[i] = { x: sx / (2 * w + 1), y: sy / (2 * w + 1) };
    }
    pts = out;
  }
  return pts;
}

/**
 * Kerangka jalan dari peta OSM. Hasil: { map, length, route, pose(s, d), frenet(x, y, hint),
 * heading(s), crosswalks, haltes, manholes, parked, mouths, drawBase(g, view), drawProps(g, view) }.
 */
export function buildStreet(map) {
  const chain = chainPoints(map);
  const pts = smoothLine(chain.pts);
  const n = pts.length;
  const cum = new Float64Array(n);
  const segH = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    cum[i] = cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    segH[i - 1] = Math.atan2(pts[i].y - pts[i - 1].y, pts[i].x - pts[i - 1].x);
  }
  segH[n - 1] = segH[n - 2];
  // arah di tiap titik = rata-rata dua ruas di sekitarnya, supaya arah berubah halus
  const vH = new Float64Array(n);
  vH[0] = segH[0];
  vH[n - 1] = segH[n - 2];
  for (let i = 1; i < n - 1; i++) vH[i] = segH[i - 1] + wrapAngle(segH[i] - segH[i - 1]) / 2;
  const length = cum[n - 1];

  function seg(s) {
    let lo = 0;
    let hi = n - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (cum[mid] <= s) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** Titik dan arah pada jarak s dengan geseran d (positif = kiri arah timur). */
  function pose(s, d = 0) {
    const sc = Math.max(0, Math.min(length, s));
    const i = seg(sc);
    const L = cum[i + 1] - cum[i] || 1;
    const t = (sc - cum[i]) / L;
    const h = vH[i] + wrapAngle(vH[i + 1] - vH[i]) * t;
    // di luar ujung ruas: teruskan lurus
    const extra = s - sc;
    const x = pts[i].x + (pts[i + 1].x - pts[i].x) * t + Math.cos(h) * extra;
    const y = pts[i].y + (pts[i + 1].y - pts[i].y) * t + Math.sin(h) * extra;
    return { x: x + Math.sin(h) * d, y: y - Math.cos(h) * d, heading: h };
  }

  const heading = (s) => pose(s, 0).heading;

  /** Koordinat Frenet { s, d } titik dunia (x, y). hint mempercepat pencarian. */
  function frenet(x, y, hint = null, win = 40) {
    let i0 = 0;
    let i1 = n - 2;
    if (hint != null && Number.isFinite(hint)) {
      i0 = Math.max(0, seg(Math.max(0, hint - win)));
      i1 = Math.min(n - 2, seg(Math.min(length, hint + win)));
    }
    let best = null;
    let bd = Infinity;
    for (let i = i0; i <= i1; i++) {
      const ax = pts[i].x;
      const ay = pts[i].y;
      const dx = pts[i + 1].x - ax;
      const dy = pts[i + 1].y - ay;
      const L2 = dx * dx + dy * dy || 1e-9;
      let t = ((x - ax) * dx + (y - ay) * dy) / L2;
      if (i === 0) t = Math.min(t, 1);
      else if (i === n - 2) t = Math.max(t, 0);
      else t = Math.max(0, Math.min(1, t));
      const qx = ax + dx * t;
      const qy = ay + dy * t;
      const dist = Math.hypot(x - qx, y - qy);
      if (dist < bd) {
        bd = dist;
        const h = segH[i];
        best = { s: cum[i] + t * Math.sqrt(L2), d: (x - qx) * Math.sin(h) - (y - qy) * Math.cos(h) };
      }
    }
    return best;
  }

  // ---------- mulut jalan samping (trotoar diputus di sini) ----------
  const chainNodes = new Set(chain.nodes);
  const chainRoads = new Set(chain.roads);
  const mouths = [];
  for (const id of chainNodes) {
    const node = map.nodes[id];
    if (!node || node.degree < 3) continue;
    const f = frenet(node.x, node.y);
    if (!f || Math.abs(f.d) > 3) continue;
    for (const r of node.roads) {
      if (chainRoads.has(r) || !r.drivable) continue;
      const far = r.a === id ? r.points[Math.min(1, r.points.length - 1)] : r.points[Math.max(0, r.points.length - 2)];
      const ff = frenet(far.x, far.y, f.s);
      if (!ff || Math.abs(ff.d) < 0.5) continue;
      mouths.push({ s: f.s, side: Math.sign(ff.d), half: r.width / 2 + 1.2, name: r.name });
    }
  }

  // ---------- jarak bebas ke gedung dan saluran air per sisi (untuk mobil parkir) ----------
  const N = Math.ceil(length) + 1;
  const clearN = new Float32Array(N).fill(99);
  const clearS = new Float32Array(N).fill(99);
  const mark = (x, y, hint) => {
    const f = frenet(x, y, hint);
    if (!f || f.s < 0 || f.s > length || Math.abs(f.d) > 12) return;
    const arr = f.d >= 0 ? clearN : clearS;
    const ad = Math.abs(f.d);
    for (let k = Math.floor(f.s) - 1; k <= Math.ceil(f.s) + 1; k++) if (k >= 0 && k < N && ad < arr[k]) arr[k] = ad;
  };
  const sampleEdges = (points, closed, hint) => {
    const m = points.length;
    for (let i = 0; i < (closed ? m : m - 1); i++) {
      const a = points[i];
      const b = points[(i + 1) % m];
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      const k = Math.max(1, Math.ceil(L / 0.7));
      for (let j = 0; j <= k; j++) mark(a.x + ((b.x - a.x) * j) / k, a.y + ((b.y - a.y) * j) / k, hint);
    }
  };
  const seenB = new Set();
  for (let s = 0; s <= length; s += 20) {
    const p = pose(s, 0);
    for (const b of map.buildingsNear(p.x, p.y, 28)) {
      if (seenB.has(b)) continue;
      seenB.add(b);
      sampleEdges(b.points, true, s);
    }
  }
  const lo = { x: Math.min(pts[0].x, pts[n - 1].x) - 20, y: Math.min(...pts.map((p) => p.y)) - 20 };
  const hi = { x: Math.max(pts[0].x, pts[n - 1].x) + 20, y: Math.max(...pts.map((p) => p.y)) + 20 };
  for (const w of map.water) {
    if (!w.bbox || w.bbox.maxX < lo.x || w.bbox.minX > hi.x || w.bbox.maxY < lo.y || w.bbox.minY > hi.y) continue;
    sampleEdges(w.points, false, null);
  }
  const minClear = (arr, s0, s1) => {
    let m = 99;
    for (let k = Math.max(0, Math.floor(s0)); k <= Math.min(N - 1, Math.ceil(s1)); k++) m = Math.min(m, arr[k]);
    return m;
  };

  // ---------- benda tambahan untuk simulasi ----------
  const crosswalks = CROSSWALK_S.filter((s) => s < length - 5).map((s, i) => {
    const p = pose(s, 0);
    return {
      id: `zebra-${i}`,
      s,
      half: 2, // setengah lebar zebra sepanjang jalan
      zebra: crosswalk({ id: `zebra-${i}`, x: p.x, y: p.y, heading: p.heading - Math.PI / 2, length: 7.6, width: 4 }),
    };
  });

  const haltes = HALTE_S.filter((s) => s < length - 5).map((s, i) => {
    const p = pose(s, LINES.halte);
    const ad = pose(s - 2.65, LINES.halte);
    const box = { id: `halte-${i}`, kind: 'halte', x: p.x, y: p.y, heading: p.heading + Math.PI, length: 5, width: 1.2 };
    box._br = Math.hypot(5, 1.2) / 2;
    return {
      id: `halte-${i}`,
      s,
      box,
      // papan iklan di ujung barat halte, mukanya menghadap ke barat (ke arah mobil otonom datang)
      ad: { id: `iklan-${i}`, x: ad.x, y: ad.y, heading: ad.heading, facing: ad.heading + Math.PI, halte: box, s: s - 2.65 },
      waiting: null,
      claimedBy: null,
      nextSpawn: 0,
    };
  });

  const near = (list, s, r) => list.some((o) => Math.abs(o.s - s) < r);
  const manholes = [];
  for (let s = ROUTE.start + 8, i = 0; s < length - 5; s += MANHOLE_STEP, i++) {
    if (near(crosswalks, s, 5)) continue;
    const p = pose(s, 1.35);
    manholes.push({ id: `gorong-${i}`, s, x: p.x, y: p.y, r: 0.42, heading: p.heading });
  }

  const parked = [];
  const variants = [
    { kind: 'car', length: 4.5, width: 1.8 },
    { kind: 'city', length: 3.7, width: 1.65 },
    { kind: 'mpv', length: 4.4, width: 1.73 },
  ];
  for (let s = ROUTE.start - 30, i = 0; s < length - 8; s += 6.8, i++) {
    if (near(crosswalks, s, 9) || near(haltes, s, 11)) continue;
    if (mouths.some((m) => m.side < 0 && Math.abs(m.s - s) < m.half + 4)) continue;
    if (minClear(clearS, s - 3, s + 3) < 6.9) continue;
    if (hash(i, 3) < 0.35) continue;
    const v = variants[Math.floor(hash(i, 5) * variants.length)];
    const p = pose(s, LINES.parked);
    parked.push({
      id: `parkir-${i}`,
      kind: v.kind,
      cls: 'car',
      role: 'parked',
      s,
      d: LINES.parked,
      x: p.x,
      y: p.y,
      heading: p.heading + Math.PI, // menghadap ke barat, searah lalu lintas sisi selatan
      length: v.length,
      width: v.width,
      speed: 0,
      vx: 0,
      vy: 0,
      _br: Math.hypot(v.length, v.width) / 2,
      color: COLORS.vehicles[Math.floor(hash(i, 11) * COLORS.vehicles.length)],
    });
  }

  // ---------- gambar statis (Path2D dalam koordinat dunia, dibuat sekali) ----------
  const sampleS = (s0, s1, d) => {
    const out = [];
    const k = Math.max(1, Math.ceil((s1 - s0) / 2));
    for (let j = 0; j <= k; j++) {
      const p = pose(s0 + ((s1 - s0) * j) / k, d);
      out.push(p);
    }
    return out;
  };
  const pieces = (side, s0, s1) => {
    const cuts = mouths.filter((m) => m.side === side).map((m) => [m.s - m.half, m.s + m.half]).sort((a, b) => a[0] - b[0]);
    const out = [];
    let a = s0;
    for (const [c0, c1] of cuts) {
      if (c1 <= a || c0 >= s1) continue;
      if (c0 > a) out.push([a, c0]);
      a = Math.max(a, c1);
    }
    if (a < s1) out.push([a, s1]);
    return out.filter(([x0, x1]) => x1 - x0 > 0.5);
  };
  const strips = { 1: new Path2D(), [-1]: new Path2D() };
  const curb = new Path2D();
  for (const [side, [dIn, dOut]] of [[1, [STRIP_N[0], STRIP_N[1]]], [-1, [STRIP_S[1], STRIP_S[0]]]]) {
    const strip = strips[side];
    for (const [a, b] of pieces(side, 0, length)) {
      const inner = sampleS(a, b, dIn);
      const outer = sampleS(a, b, dOut);
      strip.moveTo(inner[0].x, inner[0].y);
      for (const p of inner) strip.lineTo(p.x, p.y);
      for (let j = outer.length - 1; j >= 0; j--) strip.lineTo(outer[j].x, outer[j].y);
      strip.closePath();
      curb.moveTo(inner[0].x, inner[0].y);
      for (const p of inner) curb.lineTo(p.x, p.y);
    }
  }

  function drawManhole(g, m) {
    g.save();
    g.translate(m.x, m.y);
    g.rotate(m.heading);
    g.fillStyle = '#1d222c';
    g.beginPath();
    g.arc(0, 0, m.r, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#5b6578';
    g.lineWidth = 0.07;
    g.stroke();
    g.strokeStyle = 'rgba(91, 101, 120, 0.7)';
    g.lineWidth = 0.05;
    g.beginPath();
    for (const d of [-0.18, 0, 0.18]) {
      const h = Math.sqrt(m.r * m.r - d * d) * 0.85;
      g.moveTo(d, -h);
      g.lineTo(d, h);
    }
    g.stroke();
    g.restore();
  }

  function drawAdPanel(g, ad) {
    g.save();
    g.translate(ad.x, ad.y);
    g.rotate(ad.heading);
    g.fillStyle = '#0f172a';
    g.fillRect(-0.12, -0.62, 0.24, 1.24);
    g.fillStyle = '#f9a8d4';
    g.fillRect(-0.2, -0.55, 0.1, 1.1);
    g.restore();
  }

  const inView = (s, b, r = 12) => {
    const p = pose(s, 0);
    return p.x > b.minX - r && p.x < b.maxX + r && p.y > b.minY - r && p.y < b.maxY + r;
  };

  /** Lapisan bawah: trotoar, bahu jalan, kerb, zebra cross, tutup gorong-gorong (di bawah gedung). */
  function drawBase(g, view) {
    // trotoar utara berpaving (lebih terang), bahu jalan selatan untuk parkir (sedikit lebih gelap)
    g.fillStyle = SIDEWALK;
    g.fill(strips[1]);
    g.fillStyle = SHOULDER;
    g.fill(strips[-1]);
    g.strokeStyle = CURB;
    g.lineWidth = Math.max(0.16, view.px(1.6));
    g.lineJoin = 'round';
    g.stroke(curb);
    const b = view.visibleBounds();
    for (const c of crosswalks) if (inView(c.s, b)) drawCrosswalk(g, c.zebra, { alpha: 0.8 });
    for (const m of manholes) if (inView(m.s, b, 3)) drawManhole(g, m);
  }

  /** Lapisan atas benda diam tambahan: halte dan papan iklan. */
  function drawProps(g, view) {
    const b = view.visibleBounds();
    for (const h of haltes) {
      if (!inView(h.s, b, 10)) continue;
      drawHalte(g, h.box, { color: '#38bdf8' });
      drawAdPanel(g, h.ad);
    }
  }

  return {
    map,
    length,
    route: ROUTE,
    pose,
    frenet,
    heading,
    crosswalks,
    haltes,
    manholes,
    parked,
    mouths,
    drawBase,
    drawProps,
  };
}
