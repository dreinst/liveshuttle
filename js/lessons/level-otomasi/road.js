// Jalan bermedian dua lajur per arah yang tidak berujung untuk pelajaran Level Otomasi.
//
// Jalan ini ILUSTRASI perjalanan dari kampus Universitas Ma Chung ke pusat kota Malang. Rute
// sebenarnya (dari OpenStreetMap) ada di ./data/trip.js dan tampil di peta perjalanan; bentuk
// tikungan, jumlah lajur, median, dan bangunan di sini disederhanakan.
//
// Garis tengah jalur kita (arah timur, lalu lintas kiri) dibangun dari profil kelengkungan yang
// berulang setiap PERIOD meter: lurus, tikungan S, lurus, lalu tikungan S ke arah sebaliknya.
// Posisi di jalan ditulis dalam koordinat jalan (s, d):
//   s = jarak sepanjang garis tengah (m)
//   d = jarak ke samping, positif ke KIRI arah jalan (lalu lintas kiri: lajur normal di kiri)
// Karena polanya berulang tepat setiap PERIOD, dunia bisa digeser mundur satu periode (rebase)
// tanpa terlihat, sehingga angka koordinat tetap kecil walaupun mobil berjalan berkilo-kilometer.
// Bangunan dan pohon di tepi jalan diatur menurut jarak perjalanan (trip = s + tripOffset), jadi
// ikut bergeser dengan benar saat rebase.
//
// Penampang melintang (d dalam meter):
//   11 ke luar          bangunan (ruko dan rumah di kota, rumah bertembok di kawasan perumahan)
//    9 sampai 6,5       trotoar dengan pohon peneduh
//    6,5 sampai 3,5     tepi kiri jalan (tempat menepi dan berhenti)
//    3,5 sampai 0       lajur kiri (lajur normal), tengahnya 1,75
//    0 sampai -3,5      lajur kanan (untuk menyalip), tengahnya -1,75
//   -3,5 sampai -4,2    bahu dalam
//   -4,2 sampai -7,0    median berumput dengan pohon dan lampu jalan
//   -7,0 sampai -17,4   jalur arah berlawanan (dua lajur ke barat) beserta tepinya
//  -17,4 sampai -19,9   trotoar seberang, lalu bangunan

import { Path } from '../../engine/geometry.js';
import { COLORS, withAlpha } from '../../engine/theme.js';
import { drawTree, drawSpeedSign, drawBuilding, fillBox, polygonPath } from '../../engine/draw.js';
import { TAU, clamp } from '../../engine/math.js';

const DS = 2; // jarak antartitik garis tengah (m)
export const PERIOD = 1300; // panjang satu pola tikungan (m)
const S_MIN = -PERIOD;
const S_MAX = 3 * PERIOD;

export const LEFT_LANE = 1.75;
export const RIGHT_LANE = -1.75;
export const SHOULDER = 5.0;
export const EDGE_LEFT = 3.5;
export const EDGE_RIGHT = -3.5;
export const SHOULDER_OUT = 6.5;
export const MEDIAN_IN = -4.2;
const MEDIAN_OUT = -7.0;
const MEDIAN_MID = -5.6;
export const OPP_LANES = [-9.35, -12.85]; // lajur arah berlawanan: dekat median (menyalip) dan lajur normal
const OPP_EDGE = -17.4;
const SIDEWALK = 2.5; // lebar trotoar (m)
const DASH = [5, 8]; // marka putus-putus: garis 5 m, celah 8 m (periode 13 m, 1300 habis dibagi 13)

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

// hash deterministik dari bilangan bulat, dipakai untuk menaruh bangunan dan pohon
function hash(n) {
  const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
}

// warna atap: ruko dan gedung di kota, rumah (sebagian genteng tanah liat yang diredupkan)
const ROOF_SHOP = ['#2c3a52', '#33415e', '#2f3d4f', '#39435a', '#2b3748'];
const ROOF_HOUSE = ['#4a3833', '#43352f', '#3b3f4f', '#2c3a52', '#4b3b35', '#3e3a3a'];
const GROUND_YARD = '#162c24';
const FORECOURT = '#262d39';

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

  /** Koordinat jalan (s, d) ke dunia. d positif = kiri arah jalan. */
  function toWorld(s, d = 0) {
    const f = (s - S_MIN) / DS;
    const i = clamp(Math.floor(f), 0, n - 2);
    const t = f - i;
    const h = headingAt(s);
    return { x: xs[i] + (xs[i + 1] - xs[i]) * t + Math.sin(h) * d, y: ys[i] + (ys[i + 1] - ys[i]) * t - Math.cos(h) * d, heading: h };
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
    g.beginPath(); // lineTo pada path kosong berlaku seperti moveTo
    for (let i = a; i <= b; i++) g.lineTo(offX(i, d0), offY(i, d0));
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
    for (let i = a; i <= b; i++) g.lineTo(offX(i, d), offY(i, d));
    g.stroke();
    if (dash) {
      g.setLineDash([]);
      g.lineDashOffset = 0;
    }
  }

  /** Poligon dengan s dari s0 sampai s1 dan d dari dFn0(s) sampai dFn1(s) dalam koordinat dunia, untuk area khusus seperti zona tertutup. */
  function areaPath(g, s0, s1, dFn0, dFn1) {
    const [a, b] = range(s0, s1);
    const ss = [s0];
    for (let i = a; i <= b; i++) {
      const s = S_MIN + i * DS;
      if (s > s0 && s < s1) ss.push(s);
    }
    ss.push(s1);
    polygonPath(g, [...ss.map((s) => toWorld(s, dFn0(s))), ...ss.reverse().map((s) => toWorld(s, dFn1(s)))]);
  }

  /** Kotak searah jalan dengan s dari s0 sampai s1 dan d dari d0 sampai d1. */
  function boxAt(s0, s1, d0, d1) {
    const c = toWorld((s0 + s1) / 2, (d0 + d1) / 2);
    return { x: c.x, y: c.y, heading: c.heading, length: Math.abs(s1 - s0), width: Math.abs(d1 - d0) };
  }

  const BLOCK = 26; // panjang satu blok bangunan (m, dalam jarak perjalanan)

  /**
   * Isi satu blok di satu sisi jalan. dir = 1 untuk sisi kiri (d positif), -1 untuk seberang.
   * base = d tempat bangunan mulai (tepi luar halaman depan). Mengembalikan pohon yang perlu digambar.
   */
  function fillBlock(g, s0, s1, key, dir, base, zone, trees) {
    const L = s1 - s0;
    const at = (d) => base + dir * d; // d diukur menjauhi jalan
    if (zone === 'kawasan') {
      // kawasan perumahan: tembok keliling, rumah dengan taman depan, pohon di halaman
      const wall = boxAt(s0 + (hash(key * 3 + 1) < 0.18 ? 7 : 0), s1, at(-1.2), at(-0.9));
      g.fillStyle = '#4b5263';
      fillBox(g, wall);
      for (let k = 0; k < 2; k++) {
        const r = hash(key * 13 + k * 7 + dir * 3);
        if (r < 0.12) continue;
        const a = s0 + 1.5 + k * (L / 2);
        const b = a + L / 2 - 3;
        drawBuilding(g, boxAt(a, b, at(2.6), at(2.6 + 8.5 + r * 2)), { roof: ROOF_HOUSE[Math.floor(r * 97) % ROOF_HOUSE.length], shadow: 0.9 });
        if (hash(key * 5 + k + dir) > 0.4) trees.push([(a + b) / 2 + (r - 0.5) * 4, at(0.9), 1.3 + r * 0.8]);
        // baris rumah kedua
        const r2 = hash(key * 17 + k * 11 + dir * 5);
        if (r2 > 0.25) drawBuilding(g, boxAt(a + 0.5, b - 0.5, at(15.5), at(15.5 + 8 + r2 * 2)), { roof: ROOF_HOUSE[Math.floor(r2 * 89) % ROOF_HOUSE.length], shadow: 0.9 });
      }
      return;
    }
    // kota: deretan ruko, kadang lahan kosong atau gedung yang lebih besar dengan pelataran
    const r = hash(key * 7 + dir * 131);
    if (r < 0.1) {
      trees.push([s0 + L * 0.3, at(4 + r * 20), 2 + r * 4]);
      trees.push([s0 + L * 0.72, at(9 + r * 30), 1.8]);
    } else if (r < 0.24) {
      g.fillStyle = FORECOURT;
      fillBox(g, boxAt(s0 + 2, s1 - 2, at(0), at(3.5)));
      drawBuilding(g, boxAt(s0 + 3, s1 - 3, at(3.5), at(3.5 + 13)), { roof: ROOF_SHOP[Math.floor(r * 50) % ROOF_SHOP.length], shadow: 1.4 });
    } else {
      const depth = 11 + hash(key * 3 + dir) * 4;
      let a = s0 + 0.6;
      let u = 0;
      g.fillStyle = FORECOURT;
      fillBox(g, boxAt(s0 + 0.6, s1 - 0.6, at(0), at(1.4)));
      while (a < s1 - 3.5) {
        const w = Math.min(s1 - 0.6 - a, 4.2 + hash(key * 19 + u * 5 + dir) * 1.8);
        const rr = hash(key * 23 + u * 3 + dir * 7);
        drawBuilding(g, boxAt(a, a + w, at(1.4), at(1.4 + depth - rr * 2)), { roof: ROOF_SHOP[Math.floor(rr * 71) % ROOF_SHOP.length], shadow: 1.1 });
        a += w;
        u++;
      }
    }
    // baris belakang: rumah
    for (let k = 0; k < 2; k++) {
      const r2 = hash(key * 29 + k * 13 + dir * 17);
      if (r2 < 0.3) continue;
      const a = s0 + 1 + k * (L / 2);
      drawBuilding(g, boxAt(a, a + L / 2 - 2.5, at(19 + r2 * 3), at(27 + r2 * 4)), { roof: ROOF_HOUSE[Math.floor(r2 * 61) % ROOF_HOUSE.length], shadow: 0.9 });
    }
  }

  /**
   * Gambar trotoar, bangunan, jalan, marka, median, lampu jalan, rambu, dan pohon untuk s di [sA, sB].
   * opts.tripOffset: jarak perjalanan = s + tripOffset. opts.oddExit: jarak perjalanan tempat
   * kawasan perumahan (area operasi level 4) berakhir. opts.limitText(s): teks rambu batas kecepatan.
   */
  function draw(g, view, sA, sB, { tripOffset = 0, oddExit = -Infinity, limitText = () => '40' } = {}) {
    const [a, b] = range(sA, sB);
    if (b - a < 1) return;
    const zoneOf = (trip) => (trip < oddExit ? 'kawasan' : 'kota');

    // halaman dan trotoar kedua sisi
    band(g, 9 + 2.1, 9, a, b, FORECOURT);
    band(g, 9, SHOULDER_OUT, a, b, COLORS.sidewalk);
    band(g, OPP_EDGE, OPP_EDGE - SIDEWALK, a, b, COLORS.sidewalk);
    band(g, OPP_EDGE - SIDEWALK, OPP_EDGE - SIDEWALK - 2.1, a, b, FORECOURT);
    // di kawasan perumahan halaman depan berumput
    const tA = sA + tripOffset;
    const tB = sB + tripOffset;
    if (tA < oddExit) {
      const [ka, kb] = range(sA, Math.min(sB, oddExit - tripOffset));
      if (kb - ka >= 1) {
        band(g, 9 + 2.1, 9, ka, kb, GROUND_YARD);
        band(g, OPP_EDGE - SIDEWALK, OPP_EDGE - SIDEWALK - 2.1, ka, kb, GROUND_YARD);
      }
    }

    // blok bangunan, diatur menurut jarak perjalanan; blok 0 dimulai tepat di batas kawasan
    const trees = [];
    const k0 = Math.floor((tA - oddExit) / BLOCK) - 1;
    const k1 = Math.ceil((tB - oddExit) / BLOCK);
    for (let k = k0; k <= k1; k++) {
      const t0 = oddExit + k * BLOCK;
      const zone = zoneOf(t0 + 1);
      const s0 = t0 - tripOffset;
      const s1 = s0 + BLOCK;
      const key = k + 7919;
      fillBlock(g, s0, s1, key, 1, 11.1, zone, trees);
      fillBlock(g, s0, s1, key + 50021, -1, OPP_EDGE - SIDEWALK - 2.1, zone, trees);
    }

    // permukaan jalan
    band(g, SHOULDER_OUT, EDGE_LEFT, a, b, COLORS.asphaltDark);
    band(g, EDGE_LEFT, EDGE_RIGHT, a, b, COLORS.asphalt);
    band(g, EDGE_RIGHT, MEDIAN_IN, a, b, COLORS.asphaltDark);
    band(g, MEDIAN_IN, MEDIAN_OUT, a, b, '#1a3327'); // median berumput
    band(g, MEDIAN_OUT, -7.6, a, b, COLORS.asphaltDark);
    band(g, -7.6, -14.6, a, b, COLORS.asphalt);
    band(g, -14.6, OPP_EDGE, a, b, COLORS.asphaltDark);

    // marka: garis tepi utuh putih, pembagi lajur putus-putus
    const white = withAlpha(COLORS.laneMark, 0.9);
    const edge = withAlpha(COLORS.laneMark, 0.75);
    line(g, EDGE_LEFT, a, b, { color: edge, width: 0.15 });
    line(g, 0, a, b, { color: white, width: 0.15, dash: DASH });
    line(g, EDGE_RIGHT, a, b, { color: edge, width: 0.15 });
    line(g, -7.6, a, b, { color: edge, width: 0.15 });
    line(g, -11.1, a, b, { color: white, width: 0.15, dash: DASH });
    line(g, -14.6, a, b, { color: edge, width: 0.15 });
    // kerb trotoar dan median
    line(g, SHOULDER_OUT, a, b, { color: COLORS.curb, width: 0.2 });
    line(g, OPP_EDGE, a, b, { color: COLORS.curb, width: 0.2 });
    line(g, MEDIAN_IN, a, b, { color: COLORS.curb, width: 0.18 });
    line(g, MEDIAN_OUT, a, b, { color: COLORS.curb, width: 0.18 });

    // pohon di median dan di trotoar (menurut jarak perjalanan)
    const TB = 13;
    for (let k = Math.floor(tA / TB) - 1; k <= Math.ceil(tB / TB) + 1; k++) {
      const t = k * TB;
      const kawasan = zoneOf(t) === 'kawasan';
      const s = t - tripOffset + hash(k * 5.7) * 4;
      if (hash(k * 3.1 + 11) < (kawasan ? 0.85 : 0.55)) trees.push([s, MEDIAN_MID, kawasan ? 1.05 : 1.2 + hash(k * 1.3) * 0.3]);
      if (hash(k * 2.3 + 41) < (kawasan ? 0.7 : 0.5)) trees.push([s + 5, 7.9, 1.6 + hash(k * 1.9) * 0.8]);
      if (hash(k * 4.7 + 73) < (kawasan ? 0.7 : 0.45)) trees.push([s + 2, OPP_EDGE - 1.3, 1.5 + hash(k * 2.9) * 0.8]);
    }
    for (const [s, d, r] of trees) {
      const p = toWorld(s, d);
      drawTree(g, p.x, p.y, r);
    }

    // lampu jalan di median setiap 50 m
    const LAMP = 50;
    for (let k = Math.floor(sA / LAMP); k <= Math.ceil(sB / LAMP); k++) {
      const s = k * LAMP + 6;
      const p = toWorld(s, MEDIAN_MID);
      const l1 = toWorld(s, MEDIAN_MID + 1.4);
      const l2 = toWorld(s, MEDIAN_MID - 1.4);
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

    // rambu batas kecepatan setiap setengah periode (teksnya mengikuti kawasan atau kota)
    const SIGN = PERIOD / 2;
    for (let k = Math.floor(sA / SIGN); k <= Math.ceil(sB / SIGN); k++) {
      const s = k * SIGN + 40;
      const p = toWorld(s, SHOULDER_OUT + 1.2);
      drawSpeedSign(g, { x: p.x, y: p.y, text: limitText(s), radius: 0.45 }, { view, minPx: 18 });
    }
  }

  return { SHIFT, toWorld, project, areaPath, draw, headingAt };
}
