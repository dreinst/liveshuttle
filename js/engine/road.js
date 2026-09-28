// Jalan, lajur, persimpangan, zebra cross, dan garis henti untuk LALU LINTAS KIRI (Indonesia).
//
// Sebuah jalan didefinisikan oleh garis tengahnya (polyline). Untuk jalan dua arah, lajur
// arah maju (dir = 1, searah urutan titik) berada di sisi KIRI garis tengah, lajur arah
// sebaliknya (dir = -1) di sisi kanan. Indeks lajur 0 = lajur paling kiri (dekat trotoar,
// lajur normal). Indeks lebih besar = lebih ke kanan (lajur untuk menyalip).

import { Path, offsetPolyline, bezierPoints } from './geometry.js';
import { SIZES } from './theme.js';

/**
 * Buat jalan dari polyline garis tengah.
 * @param {object} o
 * @param {Array<{x,y}>} o.points garis tengah
 * @param {number} [o.lanesPerDir=1] jumlah lajur per arah
 * @param {number} [o.laneWidth=3.5]
 * @param {boolean} [o.twoWay=true] false = jalan satu arah (semua lajur dir = 1)
 * @param {number} [o.sidewalk=0] lebar trotoar di tiap sisi (m), 0 = tanpa trotoar
 * @param {number} [o.trimStart=0] @param {number} [o.trimEnd=0] panjang tanpa marka di awal/akhir (untuk persimpangan)
 * @returns {Road} { id, points, path, length, width, laneWidth, lanes, leftEdge, rightEdge, polygon, sidewalkPolygon, markings }
 */
export function makeRoad(o) {
  const { id = 'jalan', points, lanesPerDir = 1, laneWidth = SIZES.laneWidth, twoWay = true, sidewalk = 0, trimStart = 0, trimEnd = 0 } = o;
  const path = new Path(points);
  const lanesTotal = twoWay ? lanesPerDir * 2 : lanesPerDir;
  const width = lanesTotal * laneWidth;
  const half = width / 2;
  const reversed = [...points].reverse();

  const lanes = [];
  for (let i = 0; i < lanesPerDir; i++) {
    const off = twoWay ? (lanesPerDir - i - 0.5) * laneWidth : (lanesPerDir / 2 - i - 0.5) * laneWidth;
    const fwd = offsetPolyline(points, off);
    lanes.push({ id: `${id}:f${i}`, dir: 1, index: i, offset: off, points: fwd, path: new Path(fwd) });
    if (twoWay) {
      const back = offsetPolyline(reversed, off);
      lanes.push({ id: `${id}:b${i}`, dir: -1, index: i, offset: -off, points: back, path: new Path(back) });
    }
  }

  const leftEdge = offsetPolyline(points, half);
  const rightEdge = offsetPolyline(points, -half);
  const polygon = [...leftEdge, ...[...rightEdge].reverse()];
  let sidewalkPolygon = null;
  if (sidewalk > 0) {
    const l = offsetPolyline(points, half + sidewalk);
    const r = offsetPolyline(points, -half - sidewalk);
    sidewalkPolygon = [...l, ...[...r].reverse()];
  }

  // marka jalan (dipotong di ujung yang masuk persimpangan)
  const s0 = trimStart;
  const s1 = path.length - trimEnd;
  const trimmed = (off) => slicePolyline(offsetPolyline(points, off), s0, s1);
  const markings = [];
  if (s1 > s0) {
    if (twoWay) {
      markings.push({ kind: 'center', points: trimmed(0) });
      for (let k = 1; k < lanesPerDir; k++) {
        markings.push({ kind: 'divider', points: trimmed(k * laneWidth) });
        markings.push({ kind: 'divider', points: trimmed(-k * laneWidth) });
      }
    } else {
      for (let k = 1; k < lanesTotal; k++) markings.push({ kind: 'divider', points: trimmed(half - k * laneWidth) });
    }
    markings.push({ kind: 'edge', points: trimmed(half - 0.2) });
    markings.push({ kind: 'edge', points: trimmed(-half + 0.2) });
  }

  return {
    id,
    points: points.map((p) => ({ x: p.x, y: p.y })),
    path,
    length: path.length,
    width,
    laneWidth,
    lanesPerDir,
    lanesTotal,
    twoWay,
    sidewalk,
    lanes,
    leftEdge,
    rightEdge,
    polygon,
    sidewalkPolygon,
    markings,
  };
}

/** Jalan lurus dari `from` ke `to`. Opsi lain sama dengan makeRoad. */
export function straightRoad({ from, to, ...rest }) {
  return makeRoad({ points: [from, to], ...rest });
}

/** Ambil lajur jalan: dir 1 (searah titik) atau -1, index 0 = lajur paling kiri. */
export function getLane(road, dir = 1, index = 0) {
  return road.lanes.find((l) => l.dir === dir && l.index === index) || null;
}

/** Potongan polyline antara jarak s0 dan s1 (m). */
export function slicePolyline(points, s0, s1) {
  const path = new Path(points);
  s0 = Math.max(0, s0);
  s1 = Math.min(path.length, s1);
  if (s1 <= s0) return [];
  const out = [path.sample(s0)];
  for (let i = 1; i < points.length - 1; i++) {
    if (path.cum[i] > s0 && path.cum[i] < s1) out.push({ x: points[i].x, y: points[i].y });
  }
  out.push(path.sample(s1));
  return out.map((p) => ({ x: p.x, y: p.y }));
}

/**
 * Kotak persimpangan (area aspal tanpa marka) dengan pusat (x, y).
 * width searah sumbu x, height searah sumbu y.
 */
export function intersection({ id = 'simpang', x, y, width, height = width }) {
  const hw = width / 2;
  const hh = height / 2;
  return {
    id,
    x,
    y,
    width,
    height,
    polygon: [
      { x: x - hw, y: y - hh },
      { x: x + hw, y: y - hh },
      { x: x + hw, y: y + hh },
      { x: x - hw, y: y + hh },
    ],
  };
}

/**
 * Zebra cross. heading = arah pejalan kaki menyeberang, length = panjang penyeberangan
 * (biasanya lebar jalan), width = lebar pita zebra searah jalan.
 */
export function crosswalk({ id = 'zebra', x, y, heading, length, width = 3, stripe = 0.5, gap = 0.5 }) {
  const stripes = [];
  const n = Math.floor((length + gap) / (stripe + gap));
  const used = n * stripe + (n - 1) * gap;
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  for (let i = 0; i < n; i++) {
    const along = -used / 2 + stripe / 2 + i * (stripe + gap);
    stripes.push({ x: x + c * along, y: y + s * along, heading: heading + Math.PI / 2, length: width, width: stripe });
  }
  return { id, kind: 'crosswalk', x, y, heading, length, width, stripes };
}

/** Garis henti melintang lajur. heading = arah gerak kendaraan, length = lebar yang ditutup. */
export function stopLine({ x, y, heading, length = SIZES.laneWidth, width = 0.4 }) {
  return { kind: 'stopLine', x, y, heading: heading + Math.PI / 2, length, width };
}

/**
 * Jalur belok halus antara dua pose (kurva Bezier kubik), misalnya dari ujung satu lajur
 * ke awal lajur lain di persimpangan.
 * @param {{x,y}} p0 titik awal @param {number} h0 arah di titik awal
 * @param {{x,y}} p1 titik akhir @param {number} h1 arah di titik akhir
 * @param {number} [tension=0.55] panjang titik kontrol relatif terhadap jarak p0 ke p1
 */
export function connector(p0, h0, p1, h1, { tension = 0.55, segments = 16 } = {}) {
  const d = Math.hypot(p1.x - p0.x, p1.y - p0.y) * tension;
  const c0 = { x: p0.x + Math.cos(h0) * d, y: p0.y + Math.sin(h0) * d };
  const c1 = { x: p1.x - Math.cos(h1) * d, y: p1.y - Math.sin(h1) * d };
  return bezierPoints(p0, c0, c1, p1, segments);
}
