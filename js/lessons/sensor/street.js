// Lokasi adegan pelajaran Sensor: Jalan Karangampel Timur di sisi utara Universitas Ma Chung,
// beberapa puluh meter sebelum jalan ini berbelok ke utara di pojok timur laut kampus.
//
// Semua angka di sini diukur dari js/data/machung-2d.json (OpenStreetMap, peta 'machung').
// Supaya adegan mudah disusun, dipakai "bingkai jalan" (s, d):
//   s = jarak sepanjang garis tengah jalan ke arah timur-tenggara (meter),
//   d = jarak ke kiri dari garis tengah (positif = sisi utara, sisi lajur mobil otonom).
// Titik asal bingkai dan arahnya diambil dari ruas OSM Jalan Karangampel Timur (ruas nomor 26,
// titik (112,6; -201,0) sampai (186,7; -174,6)). Bila data berubah, bingkai dihitung ulang dari
// ruas jalan terdekat bernama sama (lihat streetFrame).
//
// Yang berasal dari OSM: jalan, gedung, saluran air, batas kampus, nama jalan, lebar jalan
// (perkiraan 7 m dari kelas jalan). Yang ditambahkan untuk simulasi: lampu lalu lintas, garis henti,
// zebra cross, rambu, lampu jalan, dan semua pengguna jalan.

import { Path, bezierPoints, joinPolylines } from '../../engine/geometry.js';
import { angleDiff } from '../../engine/math.js';

// bingkai bawaan (hasil ukur dari data)
const DEFAULT_ORIGIN = { x: 112.6, y: -201.0 };
const DEFAULT_HEADING = Math.atan2(26.4, 74.1);

// ---------- ukuran adegan dalam bingkai (s, d) ----------
export const ROAD_HALF = 3.5; // jalan utama 7 m (perkiraan dari kelas jalan tersier)
export const LANE = 1.75; // pusat lajur: d = +1,75 lajur ke timur, d = -1,75 lajur ke barat
// Lengan utara (lanjutan Jalan Karangampel Timur) memotong garis jalan di s = 83,46 dan sedikit miring.
export const N_ARM = { s0: 83.46, slope: 0.0498, half: 3.5 };
// Lengan selatan (jalan kecil ke sisi timur kampus): pusat sekitar s = 83.
export const S_ARM = { s: 83.0, half: 2.5 };
export const ZEBRA = { s: 76.4, halfS: 1.6, halfD: 3.8 };
export const STOP_EAST = 73.8; // garis henti lajur ke timur (s)
export const STOP_NORTH = 5.0; // garis henti lengan utara (d), untuk kendaraan ke selatan
export const STOP_SOUTH = -4.4; // garis henti lengan selatan (d), untuk kendaraan ke utara
export const EGO_START = { s: 31.6, d: LANE };
export const EGO_FRONT_LIMIT = 71.6; // bemper depan mobil otonom tidak melewati s ini (adegan berhenti di sini)
export const CAR_AHEAD_START = 51.6;
export const ANGKOT_PARK = { s: 20.3, d: LANE + 0.3 };
export const SIGN_POS = { s: 52, d: 4.4 };
// posisi tunggu pejalan kaki di kedua ujung zebra cross
export const PED_WAIT_D = 4.6;
export const PED_LANES = { hijab: 75.9, ransel: 77.2 };

/** Pusat lengan utara pada jarak d dari garis jalan. */
export const nArmS = (d) => N_ARM.s0 + N_ARM.slope * d;

/**
 * Bingkai jalan dari peta. Mengembalikan { origin, heading, name, toWorld, toFrame, headings }.
 * Bingkai diselaraskan dengan ruas tersier terdekat di titik acuan adegan.
 */
export function streetFrame(map) {
  let origin = DEFAULT_ORIGIN;
  let heading = DEFAULT_HEADING;
  let name = 'Jalan Karangampel Timur';
  const ref = { x: 150, y: -188 };
  const hit = map?.nearestRoad?.(ref.x, ref.y, { maxDist: 15, filter: (r) => r.cls === 'tertiary' });
  if (hit?.road) {
    if (hit.road.name) name = hit.road.name;
    // cari segmen yang memuat titik acuan, lalu pakai segmen itu sebagai garis bingkai
    const pts = hit.road.points;
    let best = null;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 40) continue;
      const t = ((ref.x - a.x) * (b.x - a.x) + (ref.y - a.y) * (b.y - a.y)) / (len * len);
      if (t < -0.1 || t > 1.1) continue;
      if (!best || len > best.len) best = { a, b, len };
    }
    // hanya dipakai bila dekat dengan bingkai bawaan (data sama), supaya ukuran adegan tetap cocok
    if (best) {
      const h = Math.atan2(best.b.y - best.a.y, best.b.x - best.a.x);
      if (Math.abs(h - DEFAULT_HEADING) < 0.05 && Math.hypot(best.a.x - DEFAULT_ORIGIN.x, best.a.y - DEFAULT_ORIGIN.y) < 5) {
        origin = { x: best.a.x, y: best.a.y };
        heading = h;
      }
    }
  }
  const C = Math.cos(heading);
  const S = Math.sin(heading);
  const toWorld = (s, d) => ({ x: origin.x + s * C + d * S, y: origin.y + s * S - d * C });
  const toFrame = (x, y) => {
    const dx = x - origin.x;
    const dy = y - origin.y;
    return { s: dx * C + dy * S, d: dx * S - dy * C };
  };
  return {
    origin,
    heading,
    name,
    toWorld,
    toFrame,
    headings: { east: heading, west: heading + Math.PI, north: heading - Math.PI / 2, south: heading + Math.PI / 2 },
    /** Batas dunia (sumbu x, y) dari persegi panjang di bingkai. */
    bounds(sMin, sMax, dMin, dMax) {
      const corners = [toWorld(sMin, dMin), toWorld(sMin, dMax), toWorld(sMax, dMin), toWorld(sMax, dMax)];
      return {
        minX: Math.min(...corners.map((p) => p.x)),
        maxX: Math.max(...corners.map((p) => p.x)),
        minY: Math.min(...corners.map((p) => p.y)),
        maxY: Math.max(...corners.map((p) => p.y)),
      };
    },
    /** Kotak {x, y, heading, length, width} dari persegi panjang di bingkai (sisi sejajar jalan). */
    box(s0, s1, d0, d1) {
      const c = toWorld((s0 + s1) / 2, (d0 + d1) / 2);
      return { x: c.x, y: c.y, heading, length: Math.abs(s1 - s0), width: Math.abs(d1 - d0) };
    },
  };
}

// ---------- jalur kendaraan ----------

/** Garis lurus di bingkai, dipecah tiap `step` meter supaya pencarian titik terdekat tetap teliti. */
function straight(F, a, b, step = 2) {
  const n = Math.max(1, Math.ceil(Math.hypot(b.s - a.s, b.d - a.d) / step));
  const out = [];
  for (let i = 0; i <= n; i++) out.push(F.toWorld(a.s + ((b.s - a.s) * i) / n, a.d + ((b.d - a.d) * i) / n));
  return out;
}

/** Belokan halus (Bezier kubik) dari titik a arah ha ke titik b arah hb, semuanya di bingkai. */
function turn(F, a, dirA, b, dirB, k = 0.55) {
  const len = Math.hypot(b.s - a.s, b.d - a.d) * k;
  const c0 = { s: a.s + dirA.s * len, d: a.d + dirA.d * len };
  const c1 = { s: b.s - dirB.s * len, d: b.d - dirB.d * len };
  return bezierPoints(F.toWorld(a.s, a.d), F.toWorld(c0.s, c0.d), F.toWorld(c1.s, c1.d), F.toWorld(b.s, b.d), 18);
}

const E = { s: 1, d: 0 };
const W = { s: -1, d: 0 };
const N = { s: N_ARM.slope, d: 1 };
const S = { s: -N_ARM.slope, d: -1 };

/**
 * Tiga rute kendaraan latar (semua mengikuti lajur kiri):
 *   'timur-utara'  : lajur ke timur, belok kiri ke lengan utara (mobil yang ada di depan mobil otonom)
 *   'utara-barat'  : dari lengan utara ke selatan, belok kanan ke lajur ke barat (lawan arah mobil otonom)
 *   'selatan-utara': dari jalan kecil di sisi timur kampus lurus ke utara
 * Setiap rute: { id, path, stop (titik garis henti), light (id lampu) }, ditambah stopS, curve, dan zones.
 */
export function buildRoutes(F) {
  const nbS = (d) => nArmS(d) - LANE; // lajur ke utara di lengan utara (sisi barat)
  const sbS = (d) => nArmS(d) + LANE; // lajur ke selatan di lengan utara (sisi timur)
  const routes = {};

  routes['timur-utara'] = {
    id: 'timur-utara',
    path: new Path(joinPolylines(
      straight(F, { s: 20, d: LANE }, { s: 77.2, d: LANE }),
      turn(F, { s: 77.2, d: LANE }, E, { s: nbS(6.2), d: 6.2 }, N, 0.5),
      straight(F, { s: nbS(6.2), d: 6.2 }, { s: nbS(62), d: 62 }),
    )),
    stop: F.toWorld(STOP_EAST, LANE),
    light: 'lampu',
  };

  routes['utara-barat'] = {
    id: 'utara-barat',
    path: new Path(joinPolylines(
      straight(F, { s: sbS(62), d: 62 }, { s: sbS(4.4), d: 4.4 }),
      turn(F, { s: sbS(4.4), d: 4.4 }, S, { s: 78.6, d: -LANE }, W, 0.55),
      straight(F, { s: 78.6, d: -LANE }, { s: -70, d: -LANE }),
    )),
    stop: F.toWorld(sbS(STOP_NORTH), STOP_NORTH),
    light: 'lampu-utara',
  };

  routes['selatan-utara'] = {
    id: 'selatan-utara',
    path: new Path(joinPolylines(
      straight(F, { s: 84.0, d: -58 }, { s: 82.8, d: -19 }),
      straight(F, { s: 82.8, d: -19 }, { s: 81.9, d: -8 }),
      straight(F, { s: 81.9, d: -8 }, { s: nbS(4), d: 4 }),
      straight(F, { s: nbS(4), d: 4 }, { s: nbS(62), d: 62 }),
    )),
    stop: F.toWorld(81.9, STOP_SOUTH),
    light: 'lampu-selatan',
  };

  for (const r of Object.values(routes)) {
    // posisi garis henti di sepanjang jalur
    r.stopS = r.path.closest(r.stop.x, r.stop.y).s;
    // batas kecepatan belokan: v <= akar(a_lateral / kelengkungan), dicuplik tiap 1 m
    r.curve = curveSpeeds(r.path, 2.2);
    r.zones = new Map(); // cache zona zebra per setengah lebar kendaraan
  }
  return routes;
}

/** Kecepatan maksimum di belokan per meter jalur (m/s), dengan percepatan samping aLat. */
function curveSpeeds(path, aLat) {
  const n = Math.floor(path.length);
  const out = new Float32Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const a = path.sample(Math.max(0, i - 1.5));
    const b = path.sample(Math.min(path.length, i + 1.5));
    const dh = Math.abs(angleDiff(b.heading, a.heading));
    const ds = Math.max(0.5, Math.min(path.length, i + 1.5) - Math.max(0, i - 1.5));
    const kappa = dh / ds;
    out[i] = kappa > 1e-4 ? Math.sqrt(aLat / kappa) : 99;
  }
  return out;
}

/**
 * Zona zebra cross di sepanjang rute untuk kendaraan dengan setengah lebar halfW:
 * { sIn, sOut } (posisi titik tengah kendaraan di sepanjang jalur) atau null bila rute tidak melewati zebra.
 */
export function zebraZone(route, F, halfW) {
  const key = Math.round(halfW * 100);
  if (route.zones.has(key)) return route.zones.get(key);
  let sIn = null;
  let sOut = null;
  const pad = halfW + 0.25;
  for (let s = 0; s <= route.path.length; s += 0.2) {
    const p = route.path.sample(s);
    const f = F.toFrame(p.x, p.y);
    const inside = Math.abs(f.s - ZEBRA.s) <= ZEBRA.halfS + pad && Math.abs(f.d) <= ZEBRA.halfD;
    if (inside) {
      if (sIn == null) sIn = s;
      sOut = s;
    }
  }
  const z = sIn == null ? null : { sIn, sOut };
  route.zones.set(key, z);
  return z;
}
