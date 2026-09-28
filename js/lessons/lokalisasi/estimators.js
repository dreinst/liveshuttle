// Model sensor posisi dan estimator untuk pelajaran Lokalisasi.
//
//   GpsReceiver     posisi GPS sekali per detik. Galatnya terdiri dari bias yang berubah pelan
//                   (proses Gauss-Markov) dan noise acak. Di zona gedung tinggi satelit yang
//                   terlihat berkurang, bias bertambah, dan sinyal pantulan (multipath) membuat
//                   posisi melompat. Penerima tidak tahu kapan posisinya melompat.
//   WheelImu        laju roda (odometri) dan kecepatan belok (giroskop IMU) dengan bias kecil yang tetap.
//   DeadReckoning   menjumlahkan gerak dari WheelImu tanpa koreksi apa pun, sehingga drift.
//   PoseFilter      filter Kalman diperluas (EKF) dengan keadaan x, y, arah hadap, faktor skala
//                   laju roda, dan bias giroskop. Prediksi memakai odometri, koreksi memakai GPS
//                   dan/atau hasil pencocokan LiDAR dengan peta.
//                   Ukuran yang terlalu jauh dari prediksi ditolak (uji jarak Mahalanobis).
//   LidarLandmarks  jarak dan sudut dari LiDAR ke tiang dan rambu di sekitar mobil.
//
// Penyederhanaan: semuanya di bidang datar dan lintang serta bujur diganti meter. Semua acak memakai Rng berbiji supaya Ulangi memberi hasil yang sama.

import { Rng, wrapAngle } from '../../engine/math.js';
import { lineOfSight } from '../../engine/geometry.js';

export const GPS_PERIOD = 1; // detik antara dua posisi GPS
export const LIDAR_PERIOD = 0.1; // LiDAR 10 kali per detik
export const CHI2_95 = 5.991; // chi-kuadrat 2 derajat bebas, 95%
const GPS_GATE = 13.82; // chi-kuadrat 2 derajat bebas, 99,9%
const LM_MATCH_DIST = 5; // jarak maksimum (m) untuk memasangkan hasil LiDAR dengan landmark peta

// ---------- GPS ----------

export class GpsReceiver {
  constructor(seed = 7) {
    this.seed = seed;
    this.rng = new Rng(seed);
    this.reset();
  }

  reset() {
    this.rng.reseed(this.seed);
    this.bn = { x: this.rng.gaussian(), y: this.rng.gaussian() }; // bias ternormalisasi
    this.cb = { x: 0, y: 0 }; // bias tambahan di zona gedung tinggi
    this.timer = GPS_PERIOD; // posisi pertama langsung keluar
    this.fix = null;
    this.history = [];
    this.sinceJump = 0;
    this.sats = 11;
  }

  /** Panggil tiap langkah simulasi. Mengembalikan posisi GPS baru, atau null. */
  update(dt, t, truth, sigma, canyon) {
    this.timer += dt;
    if (this.timer + 1e-9 < GPS_PERIOD) return null;
    this.timer = Math.min(this.timer - GPS_PERIOD, GPS_PERIOD);
    return this.measure(t, truth, sigma, canyon);
  }

  /**
   * Buat satu posisi GPS.
   * truth: { x, y, vx, vy } posisi dan kecepatan sebenarnya. sigma: noise per sumbu di tempat terbuka (m).
   * canyon: null, atau { normal, biasX, biasY } di zona gedung tinggi.
   */
  measure(t, truth, sigma, canyon) {
    const r = this.rng;
    // bias yang berubah pelan (waktu korelasi 25 detik), sekitar separuh galat total
    const a = Math.exp(-GPS_PERIOD / 25);
    const k = Math.sqrt(1 - a * a);
    this.bn.x = a * this.bn.x + k * r.gaussian();
    this.bn.y = a * this.bn.y + k * r.gaussian();
    const sb = 0.5 * sigma;
    const sw = 0.85 * sigma;
    // bias zona gedung tinggi muncul dan hilang dalam beberapa detik
    const ca = Math.exp(-GPS_PERIOD / 3);
    const tx = canyon ? canyon.biasX : 0;
    const ty = canyon ? canyon.biasY : 0;
    this.cb.x = tx + (this.cb.x - tx) * ca;
    this.cb.y = ty + (this.cb.y - ty) * ca;

    let white = sw;
    let jump = null;
    if (canyon) {
      white = sw * 1.4 + 0.8;
      this.sinceJump++;
      if (r.chance(0.3) || this.sinceJump >= 4) {
        const mag = r.range(8, 16);
        const ang = canyon.normal + (r.chance(0.5) ? 0 : Math.PI) + r.range(-0.5, 0.5);
        jump = { x: Math.cos(ang) * mag, y: Math.sin(ang) * mag, mag };
        this.sinceJump = 0;
      }
      if (r.chance(0.3) || this.sats > 6) this.sats = r.int(4, 6);
    } else {
      this.sinceJump = 0;
      if (r.chance(0.2) || this.sats < 9) this.sats = r.int(9, 12);
    }
    const ex = this.bn.x * sb + this.cb.x + r.gaussian(0, white) + (jump ? jump.x : 0);
    const ey = this.bn.y * sb + this.cb.y + r.gaussian(0, white) + (jump ? jump.y : 0);
    const vs = canyon ? 0.3 : 0.08; // noise kecepatan Doppler (m/s)
    const fix = {
      t,
      x: truth.x + ex,
      y: truth.y + ey,
      vx: truth.vx + r.gaussian(0, vs),
      vy: truth.vy + r.gaussian(0, vs),
      // akurasi yang DILAPORKAN penerima (1 sigma). Di zona gedung tinggi penerima tahu satelitnya
      // sedikit, jadi angkanya membesar, tetapi lompatan multipath tidak ikut dihitung.
      sigmaRep: canyon ? sigma * 1.4 + 0.5 : sigma,
      sats: this.sats,
      canyon: !!canyon,
      jump,
      err: Math.hypot(ex, ey), // kunci jawaban, mobil tidak tahu angka ini
      truthX: truth.x,
      truthY: truth.y,
    };
    this.fix = fix;
    this.history.push(fix);
    if (this.history.length > 10) this.history.shift();
    return fix;
  }

  /** Posisi menurut GPS saja pada waktu t: posisi terakhir diteruskan dengan kecepatan GPS. */
  estimate(t) {
    const f = this.fix;
    if (!f) return null;
    const dt = Math.max(0, t - f.t);
    return { x: f.x + f.vx * dt, y: f.y + f.vy * dt, heading: Math.atan2(f.vy, f.vx) };
  }
}

// ---------- odometri roda dan IMU ----------

export class WheelImu {
  /**
   * scale: galat skala laju roda (0,02 = terbaca 2% terlalu cepat, misalnya karena ban).
   * gyroBias: bias giroskop (rad/s). Sengaja cukup besar supaya drift terlihat dalam setengah menit.
   */
  constructor(seed = 3, { scale = 0.02, gyroBias = 0.0025, speedNoise = 0.05, gyroNoise = 0.005 } = {}) {
    this.seed = seed;
    this.rng = new Rng(seed);
    Object.assign(this, { scale, gyroBias, speedNoise, gyroNoise });
  }

  reset() {
    this.rng.reseed(this.seed);
  }

  measure(v, w) {
    return {
      v: v * (1 + this.scale) + this.rng.gaussian(0, this.speedNoise),
      w: w + this.gyroBias + this.rng.gaussian(0, this.gyroNoise),
    };
  }
}

export class DeadReckoning {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.h = 0;
    this.trail = [];
    this.trailT = 0;
    this.age = 0;
  }

  init(x, y, h) {
    this.x = x;
    this.y = y;
    this.h = h;
    this.trail = [{ x, y }];
    this.trailT = 0;
    this.age = 0;
  }

  /** v: laju terukur, w: kecepatan belok terukur, beta: sudut slip dari sudut setir, dt: detik. */
  predict(v, w, beta, dt) {
    this.x += v * Math.cos(this.h + beta) * dt;
    this.y += v * Math.sin(this.h + beta) * dt;
    this.h = wrapAngle(this.h + w * dt);
    this.age += dt;
    this.trailT += dt;
    if (this.trailT >= 0.25) {
      this.trailT -= 0.25;
      this.trail.push({ x: this.x, y: this.y });
      if (this.trail.length > 240) this.trail.shift();
    }
  }

  pose() {
    return { x: this.x, y: this.y, heading: this.h };
  }
}

// ---------- filter Kalman diperluas ----------

const N = 5; // keadaan: x, y, arah hadap, faktor skala laju roda, bias giroskop

const zeros = () => Array.from({ length: N }, () => new Array(N).fill(0));

export class PoseFilter {
  constructor() {
    this.s = [0, 0, 0, 1, 0];
    this.P = zeros();
    this.gpsCount = 0;
    this.rejectRun = 0;
    this.rejected = 0;
    this.lastGain = null;
    this.lastGpsAccepted = true;
    this.lmUsed = 0;
  }

  get x() {
    return this.s[0];
  }
  get y() {
    return this.s[1];
  }
  get h() {
    return this.s[2];
  }

  /** Mulai dari posisi (x, y) dan arah h dengan simpangan baku sxy (m) dan sh (rad). */
  init(x, y, h, sxy, sh) {
    this.s = [x, y, h, 1, 0];
    this.P = zeros();
    this.P[0][0] = sxy * sxy;
    this.P[1][1] = sxy * sxy;
    this.P[2][2] = sh * sh;
    this.P[3][3] = 0.03 * 0.03; // skala roda belum diketahui, kira-kira 3%
    this.P[4][4] = 0.005 * 0.005; // bias giroskop belum diketahui (rad/s)
    this.gpsCount = 0;
    this.rejectRun = 0;
    this.rejected = 0;
    this.lastGain = null;
    this.lastGpsAccepted = true;
    this.lmUsed = 0;
  }

  /** Salin keadaan filter lain, lalu lebarkan ketidakpastian posisinya sedikit. */
  initFrom(o, extraXY = 0.8, extraH = 0.03) {
    this.init(0, 0, 0, 0, 0);
    this.s = o.s.slice();
    this.P = o.P.map((row) => row.slice());
    this.P[0][0] += extraXY * extraXY;
    this.P[1][1] += extraXY * extraXY;
    this.P[2][2] += extraH * extraH;
  }

  pose() {
    return { x: this.s[0], y: this.s[1], heading: this.s[2] };
  }

  /** Prediksi dengan odometri: v dan w terukur, beta (sudut slip) dari sudut setir. */
  predict(v, w, beta, dt) {
    const [, , h, k, bg] = this.s;
    const a = h + beta;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    const vv = k * v;
    this.s[0] += vv * c * dt;
    this.s[1] += vv * sn * dt;
    this.s[2] = wrapAngle(h + (w - bg) * dt);
    // Jacobian F = I kecuali baris x, y, dan arah hadap
    const F = [
      [1, 0, -vv * sn * dt, v * c * dt, 0],
      [0, 1, vv * c * dt, v * sn * dt, 0],
      [0, 0, 1, 0, -dt],
      [0, 0, 0, 1, 0],
      [0, 0, 0, 0, 1],
    ];
    const P = mul(mul(F, this.P), transpose(F));
    // noise proses: searah gerak, melintang (slip), arah hadap, skala roda, dan bias giroskop
    const qa = ((0.004 * v) ** 2 + 0.002) * dt;
    const qc = 0.004 * dt;
    P[0][0] += qa * c * c + qc * sn * sn;
    P[1][1] += qa * sn * sn + qc * c * c;
    P[0][1] += (qa - qc) * c * sn;
    P[1][0] += (qa - qc) * c * sn;
    P[2][2] += 2e-6 * dt;
    P[3][3] += 1e-7 * dt;
    P[4][4] += 1e-9 * dt;
    this.P = P;
  }

  /** Koreksi Kalman umum dengan ukuran 2 dimensi. Mengembalikan d2 atau null bila ditolak gerbang. */
  correct(H, y0, y1, r0, r1, gate, force = false) {
    const P = this.P;
    const PHt = P.map((row) => [0, 1].map((k) => row.reduce((acc, p, j) => acc + p * H[k][j], 0)));
    const s00 = H[0].reduce((acc, h, j) => acc + h * PHt[j][0], 0) + r0;
    const s01 = H[0].reduce((acc, h, j) => acc + h * PHt[j][1], 0);
    const s11 = H[1].reduce((acc, h, j) => acc + h * PHt[j][1], 0) + r1;
    const det = s00 * s11 - s01 * s01;
    const i00 = s11 / det;
    const i01 = -s01 / det;
    const i11 = s00 / det;
    const d2 = y0 * (i00 * y0 + i01 * y1) + y1 * (i01 * y0 + i11 * y1);
    if (!force && !(d2 < gate)) return { d2, K: null };
    const K = PHt.map((row) => [row[0] * i00 + row[1] * i01, row[0] * i01 + row[1] * i11]);
    for (let i = 0; i < N; i++) this.s[i] += K[i][0] * y0 + K[i][1] * y1;
    this.s[2] = wrapAngle(this.s[2]);
    // P = P - K (H P), dan H P = (P H^T)^T karena P simetris
    this.P = P.map((row, i) => row.map((p, j) => p - (K[i][0] * PHt[j][0] + K[i][1] * PHt[j][1])));
    this.symmetrize();
    return { d2, K };
  }

  /** Koreksi dengan posisi GPS. Mengembalikan { accepted, d2, gain }. */
  updateGps(fix) {
    const R = fix.sigmaRep * fix.sigmaRep;
    const H = [
      [1, 0, 0, 0, 0],
      [0, 1, 0, 0, 0],
    ];
    const yx = fix.x - this.s[0];
    const yy = fix.y - this.s[1];
    let res = this.correct(H, yx, yy, R, R, GPS_GATE);
    if (!res.K) {
      this.rejectRun++;
      if (this.rejectRun < 5) {
        this.rejected++;
        this.lastGpsAccepted = false;
        return { accepted: false, d2: res.d2, gain: 0 };
      }
      // terlalu sering menolak tanpa koreksi lain: mungkin filter yang tersesat, jadi lebarkan
      // ketidakpastiannya dan terima posisi GPS ini
      this.P[0][0] += R;
      this.P[1][1] += R;
      res = this.correct(H, yx, yy, R, R, GPS_GATE, true);
    }
    this.rejectRun = 0;
    this.gpsCount++;
    this.lastGain = (res.K[0][0] + res.K[1][1]) / 2;
    this.lastGpsAccepted = true;
    return { accepted: true, d2: res.d2, gain: this.lastGain };
  }

  /** Koreksi arah hadap saja (ukuran satu dimensi). */
  correctHeading(zh, sh) {
    const P = this.P;
    const y = wrapAngle(zh - this.s[2]);
    const S = P[2][2] + sh * sh;
    const K = P.map((row) => row[2] / S);
    for (let i = 0; i < N; i++) this.s[i] += K[i] * y;
    this.s[2] = wrapAngle(this.s[2]);
    this.P = P.map((row, i) => row.map((p, j) => p - K[i] * P[2][j]));
    this.symmetrize();
  }

  /**
   * Pencocokan peta. Tiap hasil LiDAR dipasangkan dengan landmark peta terdekat menurut posisi
   * tebakan, lalu dicari posisi dan arah mobil yang membuat semua pasangan paling berimpit
   * (kuadrat terkecil, diulang tiga kali seperti ICP). Hasilnya dipakai sebagai ukuran posisi
   * untuk filter. Mengembalikan { used, accepted, pairs } untuk digambar.
   */
  matchScan(scan, landmarks) {
    let px = this.s[0];
    let py = this.s[1];
    let ph = this.s[2];
    let pairs = [];
    let used = [];
    for (let it = 0; it < 3; it++) {
      pairs = associate(scan, landmarks, px, py, ph);
      used = pairs.filter((p) => p.lm);
      if (used.length < 2) break;
      const fit = register(used);
      px = fit.x;
      py = fit.y;
      ph = fit.h;
    }
    if (used.length < 2) return { used: used.length, accepted: false, pairs };
    const n = used.length;
    const sxy = 0.03 + 0.1 / Math.sqrt(n);
    const sh = 0.008 / Math.sqrt(n);
    const res = this.correct(
      [
        [1, 0, 0, 0, 0],
        [0, 1, 0, 0, 0],
      ],
      px - this.s[0],
      py - this.s[1],
      sxy * sxy,
      sxy * sxy,
      GPS_GATE,
    );
    if (!res.K) return { used: n, accepted: false, pairs };
    this.correctHeading(ph, sh);
    this.lmUsed = n;
    // filter jelas tidak tersesat, jadi hitungan GPS yang ditolak dimulai dari nol lagi
    this.rejectRun = 0;
    return { used: n, accepted: true, pairs };
  }

  symmetrize() {
    const P = this.P;
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const v = (P[i][j] + P[j][i]) / 2;
        P[i][j] = v;
        P[j][i] = v;
      }
      if (P[i][i] < 1e-12) P[i][i] = 1e-12;
    }
  }

  /** Elips ketidakpastian posisi. k = sqrt(chi2): 2,45 untuk 95%. Hasil { a, b, angle } (a >= b). */
  ellipse(k = Math.sqrt(CHI2_95)) {
    const a = this.P[0][0];
    const c = this.P[1][1];
    const b = this.P[0][1];
    const tr = (a + c) / 2;
    const disc = Math.sqrt(Math.max(0, ((a - c) / 2) ** 2 + b * b));
    const l1 = Math.max(0, tr + disc);
    const l2 = Math.max(0, tr - disc);
    const angle = 0.5 * Math.atan2(2 * b, a - c);
    return { a: k * Math.sqrt(l1), b: k * Math.sqrt(l2), angle };
  }
}

function mul(A, B) {
  return A.map((row) => B[0].map((_, j) => row.reduce((acc, a, k) => acc + a * B[k][j], 0)));
}

function transpose(A) {
  return A[0].map((_, j) => A.map((row) => row[j]));
}

/** Pasangkan tiap ukuran LiDAR dengan landmark peta terdekat, dilihat dari pose (px, py, ph). */
function associate(scan, landmarks, px, py, ph) {
  return scan.map((m) => {
    const wx = px + m.r * Math.cos(ph + m.b);
    const wy = py + m.r * Math.sin(ph + m.b);
    let best = null;
    let bd = LM_MATCH_DIST;
    for (const lm of landmarks) {
      const d = Math.hypot(lm.x - wx, lm.y - wy);
      if (d < bd) {
        bd = d;
        best = lm;
      }
    }
    // vx, vy: titik ukur di kerangka mobil (x ke depan, y ke kanan)
    return { r: m.r, b: m.b, vx: m.r * Math.cos(m.b), vy: m.r * Math.sin(m.b), lm: best, correct: !!best && best.id === m.id };
  });
}

/** Pose mobil yang paling pas memetakan titik ukur (kerangka mobil) ke landmark peta (Kabsch 2D). */
function register(pairs) {
  const n = pairs.length;
  let vx = 0;
  let vy = 0;
  let qx = 0;
  let qy = 0;
  for (const p of pairs) {
    vx += p.vx;
    vy += p.vy;
    qx += p.lm.x;
    qy += p.lm.y;
  }
  vx /= n;
  vy /= n;
  qx /= n;
  qy /= n;
  let sc = 0;
  let ss = 0;
  for (const p of pairs) {
    const ax = p.vx - vx;
    const ay = p.vy - vy;
    const bx = p.lm.x - qx;
    const by = p.lm.y - qy;
    sc += ax * bx + ay * by;
    ss += ax * by - ay * bx;
  }
  const h = Math.atan2(ss, sc);
  const c = Math.cos(h);
  const sn = Math.sin(h);
  return { x: qx - (c * vx - sn * vy), y: qy - (sn * vx + c * vy), h };
}

// ---------- LiDAR ke landmark ----------

export class LidarLandmarks {
  /**
   * landmarks: [{ id, x, y }] benda di peta HD. occluders: gedung yang menghalangi pandangan.
   * Jangkauan 40 m, galat jarak 5 cm, galat sudut 0,005 rad (sekitar 0,3 derajat).
   * Posisi di peta HD juga tidak sempurna: tiap landmark meleset sekitar 5 cm dari posisi aslinya.
   */
  constructor(landmarks, occluders, seed = 5, { range = 40, rangeSd = 0.05, bearingSd = 0.005, miss = 0.05, mapSd = 0.05 } = {}) {
    this.landmarks = landmarks;
    this.occluders = occluders;
    this.seed = seed;
    this.rng = new Rng(seed);
    Object.assign(this, { range, rangeSd, bearingSd, miss });
    // posisi sebenarnya tiap landmark (peta HD menyimpan lm.x, lm.y yang sedikit meleset)
    const mr = new Rng(seed + 1000);
    this.truth = new Map(landmarks.map((lm) => [lm.id, { x: lm.x + mr.gaussian(0, mapSd), y: lm.y + mr.gaussian(0, mapSd) }]));
  }

  reset() {
    this.rng.reseed(this.seed);
  }

  /** Ukur semua landmark yang terlihat dari pose sebenarnya mobil. */
  scan(ego) {
    const out = [];
    for (const lm of this.landmarks) {
      const real = this.truth.get(lm.id);
      const dx = real.x - ego.x;
      const dy = real.y - ego.y;
      const d = Math.hypot(dx, dy);
      if (d > this.range || d < 1.5) continue;
      if (this.rng.chance(this.miss)) continue;
      if (!lineOfSight(this.occluders, ego.x, ego.y, real.x, real.y)) continue;
      out.push({
        id: lm.id, // kunci jawaban untuk pengecekan, tidak dipakai saat mencocokkan
        r: d + this.rng.gaussian(0, this.rangeSd),
        b: wrapAngle(Math.atan2(dy, dx) - ego.heading + this.rng.gaussian(0, this.bearingSd)),
      });
    }
    return out;
  }
}
