// Jalan tol berkelok lembut yang tidak berujung untuk pelajaran Level Otomasi.
//
// Garis tengah jalur kita (arah timur, lalu lintas kiri) dibangun dari profil kelengkungan yang
// berulang setiap PERIOD meter: lurus, tikungan S, lurus, lalu tikungan S ke arah sebaliknya.
// Posisi di jalan ditulis dalam koordinat jalan (s, d):
//   s = jarak sepanjang garis tengah (m)
//   d = jarak ke samping, positif ke KIRI arah jalan (lalu lintas kiri: lajur normal di kiri)
// Karena polanya berulang tepat setiap PERIOD, dunia bisa digeser mundur satu periode (rebase)
// tanpa terlihat, sehingga angka koordinat tetap kecil walaupun mobil berjalan berkilo-kilometer.
//
// Penampang melintang (d dalam meter):
//    6,5 sampai 3,5     bahu jalan kiri (tempat menepi)
//    3,5 sampai 0       lajur kiri (lajur normal), tengahnya 1,75
//    0 sampai -3,5      lajur kanan (untuk menyalip), tengahnya -1,75
//   -3,5 sampai -4,2    bahu dalam
//   -4,2 sampai -7,0    median berumput dengan pembatas beton
//   -7,0 sampai -17,4   jalur arah berlawanan (dua lajur ke barat) beserta bahunya

import { Path } from '../../engine/geometry.js';
import { COLORS, withAlpha } from '../../engine/theme.js';
import { drawTree, drawSpeedSign, drawBuilding } from '../../engine/draw.js';
import { TAU } from '../../engine/math.js';

export const DS = 2; // jarak antartitik garis tengah (m)
export const PERIOD = 1300; // panjang satu pola tikungan (m)
export const S_MIN = -PERIOD;
export const S_MAX = 3 * PERIOD;

export const LEFT_LANE = 1.75;
export const RIGHT_LANE = -1.75;
export const SHOULDER = 5.0;
export const EDGE_LEFT = 3.5;
export const EDGE_RIGHT = -3.5;
export const SHOULDER_OUT = 6.5;
export const MEDIAN_IN = -4.2;
export const BARRIER = -5.6;
export const OPP_LANES = [-9.35, -12.85]; // lajur arah berlawanan: dekat median (menyalip) dan lajur normal
export const DASH = [5, 8]; // marka putus-putus: garis 5 m, celah 8 m (periode 13 m, 1300 habis dibagi 13)

// Profil kelengkungan: tonjolan setengah kosinus sepanjang BUMP meter, radius terkecil 1 / K.
const BUMP = 150;
const K = 1 / 450;
const BUMPS = [
  [350, 1],
  [500, -1],
  [1000, -1],
  [1150, 1],
];

const mod = (a, b) => ((a % b) + b) % b;

/** Arah garis tengah di s (integral analitik dari kelengkungan). Bernilai 0 di bagian lurus. */
export function headingAt(s) {
  const u = mod(s, PERIOD);
  let th = 0;
  for (const [a, sign] of BUMPS) {
    if (u <= a) continue;
    const t = Math.min(u - a, BUMP);
    th += (sign * K * (t - (BUMP / TAU) * Math.sin((TAU * t) / BUMP))) / 2;
  }
  return th;
}

/** Kelengkungan garis tengah di s (1/m, positif = belok kanan di layar). */
export function curvatureAt(s) {
  const u = mod(s, PERIOD);
  for (const [a, sign] of BUMPS) {
    if (u > a && u < a + BUMP) return (sign * K * (1 - Math.cos((TAU * (u - a)) / BUMP))) / 2;
  }
  return 0;
}

// hash deterministik dari bilangan bulat, dipakai untuk menaruh pohon dan petak sawah
function hash(n) {
  const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
}

export function createRoad() {
  const n = Math.round((S_MAX - S_MIN) / DS) + 1;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const hs = new Float64Array(n);
  const sn = new Float64Array(n); // sin(heading)
  const cs = new Float64Array(n); // cos(heading)

  // integrasi numerik posisi dari arah (4 sublangkah per titik, cukup teliti untuk tikungan landai)
  let x = 0;
  let y = 0;
  const sub = 4;
  const h = DS / sub;
  for (let i = 0; i < n; i++) {
    const s = S_MIN + i * DS;
    xs[i] = x;
    ys[i] = y;
    hs[i] = headingAt(s);
    sn[i] = Math.sin(hs[i]);
    cs[i] = Math.cos(hs[i]);
    for (let k = 0; k < sub; k++) {
      const th = headingAt(s + (k + 0.5) * h);
      x += Math.cos(th) * h;
      y += Math.sin(th) * h;
    }
  }
  const idx = (s) => Math.round((s - S_MIN) / DS);
  // s = 0 diletakkan di titik asal dunia
  const i0 = idx(0);
  const ox = xs[i0];
  const oy = ys[i0];
  const points = [];
  for (let i = 0; i < n; i++) {
    xs[i] -= ox;
    ys[i] -= oy;
    points.push({ x: xs[i], y: ys[i] });
  }
  const path = new Path(points);
  // pergeseran dunia untuk satu periode (dipakai saat rebase)
  const SHIFT = { x: xs[idx(PERIOD)] - xs[i0], y: ys[idx(PERIOD)] - ys[i0] };

  /** Titik garis tengah dan arah di s. */
  function frame(s) {
    const f = (s - S_MIN) / DS;
    let i = Math.floor(f);
    if (i < 0) i = 0;
    if (i > n - 2) i = n - 2;
    const t = f - i;
    return { x: xs[i] + (xs[i + 1] - xs[i]) * t, y: ys[i] + (ys[i + 1] - ys[i]) * t, heading: headingAt(s) };
  }

  /** Koordinat jalan (s, d) ke dunia. d positif = kiri arah jalan. */
  function toWorld(s, d = 0) {
    const f = frame(s);
    return { x: f.x + Math.sin(f.heading) * d, y: f.y - Math.cos(f.heading) * d, heading: f.heading };
  }

  /** Dunia ke koordinat jalan. hintS mempercepat pencarian dan mencegah lompatan. */
  function project(px, py, hintS = null) {
    const c = path.closest(px, py, hintS == null ? null : hintS - S_MIN, 40);
    return { s: c.s + S_MIN, d: c.lateral };
  }

  const offX = (i, d) => xs[i] + sn[i] * d;
  const offY = (i, d) => ys[i] - cs[i] * d;

  function range(sA, sB) {
    const a = Math.max(0, Math.floor((sA - S_MIN) / DS));
    const b = Math.min(n - 1, Math.ceil((sB - S_MIN) / DS));
    return [a, b];
  }

  // ---------- menggambar ----------

  function band(g, d0, d1, a, b, color) {
    g.fillStyle = color;
    g.beginPath();
    for (let i = a; i <= b; i++) {
      if (i === a) g.moveTo(offX(i, d0), offY(i, d0));
      else g.lineTo(offX(i, d0), offY(i, d0));
    }
    for (let i = b; i >= a; i--) g.lineTo(offX(i, d1), offY(i, d1));
    g.closePath();
    g.fill();
  }

  function line(g, d, a, b, { color, width, dash = null }) {
    g.strokeStyle = color;
    g.lineWidth = width;
    g.lineCap = 'butt';
    g.lineJoin = 'round';
    if (dash) {
      g.setLineDash(dash);
      // panjang garis offset = s + d * arah, jadi pola putus-putus tetap menempel di dunia
      const period = dash[0] + dash[1];
      g.lineDashOffset = mod(S_MIN + a * DS + d * hs[a], period);
    }
    g.beginPath();
    for (let i = a; i <= b; i++) {
      if (i === a) g.moveTo(offX(i, d), offY(i, d));
      else g.lineTo(offX(i, d), offY(i, d));
    }
    g.stroke();
    if (dash) {
      g.setLineDash([]);
      g.lineDashOffset = 0;
    }
  }

  /** Poligon dengan s dari s0 sampai s1 dan d dari dFn0(s) sampai dFn1(s) dalam koordinat dunia, untuk area khusus seperti zona tertutup. */
  function areaPath(g, s0, s1, dFn0, dFn1) {
    const [a, b] = range(s0, s1);
    const pts = [];
    const push = (s, d) => {
      const w = toWorld(s, d);
      pts.push(w);
    };
    push(s0, dFn0(s0));
    for (let i = a; i <= b; i++) {
      const s = S_MIN + i * DS;
      if (s > s0 && s < s1) push(s, dFn0(s));
    }
    push(s1, dFn0(s1));
    push(s1, dFn1(s1));
    for (let i = b; i >= a; i--) {
      const s = S_MIN + i * DS;
      if (s > s0 && s < s1) push(s, dFn1(s));
    }
    push(s0, dFn1(s0));
    g.beginPath();
    pts.forEach((p, k) => (k ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    g.closePath();
  }

  const FIELD_COLORS = ['#142a20', '#163024', '#12271d', '#173226', '#15291f'];

  /**
   * Gambar tanah, sawah, jalan, marka, median, tiang lampu, rambu, dan pohon untuk s di [sA, sB].
   */
  function draw(g, view, sA, sB) {
    const [a, b] = range(sA, sB);
    if (b - a < 1) return;

    // petak sawah di kedua sisi (blok 26 m, 1300 habis dibagi 26 sehingga tetap sama setelah rebase)
    const BLOCK = 26;
    const k0 = Math.floor(sA / BLOCK);
    const k1 = Math.ceil(sB / BLOCK);
    for (let k = k0; k <= k1; k++) {
      const s0 = k * BLOCK + 0.4;
      const s1 = (k + 1) * BLOCK - 0.4;
      const key = mod(k, PERIOD / BLOCK);
      const [ia, ib] = range(s0, s1);
      if (ib - ia < 1) continue;
      const rows = [
        [11.5, 27.5, 0],
        [28, 46, 1],
        [46.5, 70, 2],
        [-21.5, -37.5, 3],
        [-38, -56, 4],
        [-56.5, -80, 5],
      ];
      for (const [d0, d1, r] of rows) {
        band(g, d0, d1, ia, ib, FIELD_COLORS[Math.floor(hash(key * 7 + r * 13) * FIELD_COLORS.length)]);
        // barisan tanaman padi sebagai tekstur halus
        const dir = d1 > d0 ? 1 : -1;
        for (let d = d0 + 1.2 * dir; dir * (d1 - d) > 0.6; d += 2.2 * dir) line(g, d, ia, ib, { color: 'rgba(163, 230, 53, 0.07)', width: 0.4 });
      }
      // sesekali ada rumah di petak terdekat jalan
      if (hash(key * 11 + 5) > 0.78) {
        for (const [d, side] of [
          [19, 0],
          [-29, 1],
        ]) {
          if (hash(key * 17 + side) < 0.5) continue;
          const c = toWorld((s0 + s1) / 2, d);
          drawBuilding(g, { x: c.x, y: c.y, heading: c.heading, length: 9, width: 7.5 });
        }
      }
    }

    // bahu dan permukaan jalan
    band(g, SHOULDER_OUT + 0.9, SHOULDER_OUT, a, b, '#2a3a31'); // tepi berumput tipis
    band(g, SHOULDER_OUT, EDGE_LEFT, a, b, COLORS.asphaltDark);
    band(g, EDGE_LEFT, EDGE_RIGHT, a, b, COLORS.asphalt);
    band(g, EDGE_RIGHT, MEDIAN_IN, a, b, COLORS.asphaltDark);
    band(g, MEDIAN_IN, -7.0, a, b, '#1a3327'); // median berumput
    band(g, -7.0, -7.6, a, b, COLORS.asphaltDark);
    band(g, -7.6, -14.6, a, b, COLORS.asphalt);
    band(g, -14.6, -17.4, a, b, COLORS.asphaltDark);
    band(g, -17.4, -18.3, a, b, '#2a3a31');
    // pembatas beton di tengah median
    band(g, BARRIER + 0.22, BARRIER - 0.22, a, b, COLORS.wall);
    line(g, BARRIER, a, b, { color: COLORS.wallDark, width: 0.08 });

    // marka: garis tepi utuh putih, pembagi lajur putus-putus
    const white = withAlpha(COLORS.laneMark, 0.9);
    const edge = withAlpha(COLORS.laneMark, 0.75);
    line(g, EDGE_LEFT, a, b, { color: edge, width: 0.15 });
    line(g, 0, a, b, { color: white, width: 0.15, dash: DASH });
    line(g, EDGE_RIGHT, a, b, { color: edge, width: 0.15 });
    line(g, -7.6, a, b, { color: edge, width: 0.15 });
    line(g, -11.1, a, b, { color: white, width: 0.15, dash: DASH });
    line(g, -14.6, a, b, { color: edge, width: 0.15 });
    // kerb luar
    line(g, SHOULDER_OUT, a, b, { color: COLORS.curb, width: 0.2 });
    line(g, -17.4, a, b, { color: COLORS.curb, width: 0.2 });

    // tiang lampu di median setiap 50 m
    const LAMP = 50;
    for (let k = Math.floor(sA / LAMP); k <= Math.ceil(sB / LAMP); k++) {
      const s = k * LAMP;
      const p = toWorld(s, BARRIER);
      const l1 = toWorld(s, BARRIER + 1.4);
      const l2 = toWorld(s, BARRIER - 1.4);
      g.strokeStyle = '#64748b';
      g.lineWidth = 0.14;
      g.beginPath();
      g.moveTo(l1.x, l1.y);
      g.lineTo(l2.x, l2.y);
      g.stroke();
      g.fillStyle = '#cbd5e1';
      for (const q of [l1, l2]) {
        g.beginPath();
        g.arc(q.x, q.y, 0.2, 0, TAU);
        g.fill();
      }
      g.fillStyle = '#475569';
      g.beginPath();
      g.arc(p.x, p.y, 0.26, 0, TAU);
      g.fill();
    }

    // rambu batas kecepatan 60 setiap setengah periode
    const SIGN = PERIOD / 2;
    for (let k = Math.floor(sA / SIGN); k <= Math.ceil(sB / SIGN); k++) {
      const p = toWorld(k * SIGN + 40, SHOULDER_OUT + 1.6);
      drawSpeedSign(g, { x: p.x, y: p.y, text: '60', radius: 0.45 }, { view, minPx: 18 });
    }

    // pohon di tepi luar kedua sisi
    const TB = 13;
    for (let k = Math.floor(sA / TB) - 1; k <= Math.ceil(sB / TB) + 1; k++) {
      const key = mod(k, PERIOD / TB);
      for (const side of [0, 1]) {
        const r0 = hash(key * 3.1 + side * 71);
        if (r0 > 0.62) continue;
        const s = k * TB + hash(key * 5.7 + side) * 9;
        const d = side === 0 ? 8.6 + hash(key + 17 + side) * 2 : -19.6 - hash(key + 29) * 1.6;
        const p = toWorld(s, d);
        drawTree(g, p.x, p.y, 1.3 + hash(key * 1.9 + side * 5) * 0.9);
      }
    }
  }

  return {
    n,
    path,
    SHIFT,
    frame,
    toWorld,
    project,
    range,
    areaPath,
    draw,
    headingAt,
    curvatureAt,
  };
}
