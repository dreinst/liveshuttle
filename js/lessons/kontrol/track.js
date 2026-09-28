// Lintasan uji tertutup untuk pelajaran Kendali.
//
// Jalur acuan (tengah lajur kiri) dibangun dari PROFIL KELENGKUNGAN: potongan lurus, busur, dan
// potongan peralihan yang kelengkungannya berubah linear (mirip klotoid, seperti jalan sungguhan).
// Profil setengah lintasan dipakai dua kali. Setengah kedua adalah setengah pertama yang diputar
// 180 derajat, sehingga lintasan pasti tertutup dan total perubahan arahnya 360 derajat.
//
// Koordinat dalam meter, y ke bawah. Kelengkungan positif = belok KANAN (searah jarum jam di layar).
// Mobil berjalan searah jarum jam di lajur kiri, jadi jalan dua arah ini tetap berlalu lintas kiri:
// garis tengah kuning ada di sisi kanan mobil.

import { Path, offsetPolyline } from '../../engine/geometry.js';
import { makeRoad } from '../../engine/road.js';

export const LANE_WIDTH = 3.5;

// [panjang (m), kelengkungan di akhir potongan (1/m)]. Kelengkungan berubah linear dari nilai
// akhir potongan sebelumnya. Nilai di bawah membentuk: lurus, tikungan kanan panjang, tikungan S
// (kiri lalu kanan), lalu tikungan kanan penutup setengah lintasan.
const HALF_PROFILE = [
  [28, 0],
  [12, 1 / 28],
  [24, 1 / 28],
  [12, 0],
  [7, 0],
  [10, -1 / 25],
  [16, -1 / 25],
  [18, 1 / 27],
  [30, 1 / 27],
  [12, 0],
  [6, 0],
];

function integrate(profile, { x = 0, y = 0, heading = 0, ds = 0.05 } = {}) {
  const pts = [{ x, y, k: 0 }];
  let k = 0;
  let h = heading;
  for (const [len, kEnd] of profile) {
    const n = Math.max(1, Math.round(len / ds));
    const step = len / n;
    const k0 = k;
    for (let i = 0; i < n; i++) {
      const kMid = k0 + (kEnd - k0) * ((i + 0.5) / n);
      const hMid = h + (kMid * step) / 2;
      x += Math.cos(hMid) * step;
      y += Math.sin(hMid) * step;
      h += kMid * step;
      pts.push({ x, y, k: k0 + (kEnd - k0) * ((i + 1) / n) });
    }
    k = kEnd;
  }
  return { pts, heading: h };
}

/** Total perubahan arah setengah profil (radian). */
function halfTurn(profile) {
  let k = 0;
  let sum = 0;
  for (const [len, kEnd] of profile) {
    sum += ((k + kEnd) / 2) * len;
    k = kEnd;
  }
  return sum;
}

/**
 * Bangun lintasan. Hasil:
 *   ref: Path tertutup (jalur acuan = tengah lajur kiri), titik tiap 0,5 m
 *   curvature: array kelengkungan per titik ref (1/m)
 *   road: jalan dua arah dari engine/road.js (garis tengah = tepi kanan lajur mobil)
 *   bounds: kotak pembatas seluruh lintasan
 */
export function buildTrack() {
  // Paksa total setengah profil tepat PI dengan menyesuaikan panjang busur terakhir.
  const profile = HALF_PROFILE.map((s) => [...s]);
  const lastArc = 8;
  const turn = halfTurn(profile);
  profile[lastArc][0] += (Math.PI - turn) / profile[lastArc][1];

  const first = integrate(profile, { x: 0, y: 0, heading: 0 });
  const end = first.pts[first.pts.length - 1];
  const second = integrate(profile, { x: end.x, y: end.y, heading: first.heading });
  const raw = [...first.pts, ...second.pts.slice(1)];

  // sisa galat numerik (beberapa milimeter) disebar merata supaya ujung tepat bertemu awal
  const last = raw[raw.length - 1];
  const ex = last.x - raw[0].x;
  const ey = last.y - raw[0].y;
  const n = raw.length - 1;
  const fixed = raw.map((p, i) => ({ x: p.x - (ex * i) / n, y: p.y - (ey * i) / n, k: p.k }));

  // sampel ulang tiap 0,5 m (titik terakhir = titik awal dibuang, Path closed menyambungnya)
  const dense = new Path(fixed);
  const count = Math.round(dense.length / 0.5);
  const spacing = dense.length / count;
  const pts = [];
  const curvature = [];
  let j = 0;
  for (let i = 0; i < count; i++) {
    const s = i * spacing;
    const p = dense.sample(s);
    pts.push({ x: p.x, y: p.y });
    while (j < dense.cum.length - 2 && dense.cum[j + 1] < s) j++;
    curvature.push(fixed[j].k);
  }

  // geser supaya titik tengah lintasan ada di (0, 0)
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  for (const p of pts) {
    p.x -= cx;
    p.y -= cy;
  }

  const ref = new Path(pts, { closed: true });
  // garis tengah jalan ada di KANAN jalur acuan (offset negatif = ke kanan)
  const loop = [...pts, pts[0]];
  const center = offsetPolyline(loop, -LANE_WIDTH / 2);
  center[center.length - 1] = { ...center[0] };
  const road = makeRoad({ id: 'lintasan', points: center, laneWidth: LANE_WIDTH });

  const half = LANE_WIDTH + 1;
  const bounds = { minX: minX - cx - half, minY: minY - cy - half, maxX: maxX - cx + half, maxY: maxY - cy + half };
  return { ref, curvature, road, bounds, length: ref.length, spacing };
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

/**
 * Titik terdekat pada jalur tertutup, hanya dicari di sekitar hintS (plus minus window meter).
 * Path.closest() di engine selalu mencari di seluruh jalur bila jalurnya tertutup, sehingga
 * bisa melompat ke bagian lintasan lain yang kebetulan dekat. Fungsi ini mencegahnya.
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
