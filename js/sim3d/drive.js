// Model gerak LiveShuttle dan pengendali dasarnya.
//
// Memanjang: percepatan dibatasi sentakan (jerk). Rencana biasa memakai sentakan nyaman, perisai
// keselamatan memakai sentakan darurat. Perlambatan maksimum = min(kemampuan rem, mu x g), jadi di
// jalan basah jarak henti benar-benar lebih panjang.
//
// Melintang (mode otomatis): pure pursuit di koordinat lajur (Frenet). Titik incar berada Ld meter di
// depan pada garis tengah lajur yang sudah dihaluskan (ditambah geser lateral saat melewati mobil
// parkir). Kelengkungan perintah = kelengkungan jalan (umpan maju) + koreksi pure pursuit, lalu laju
// perubahannya dibatasi (setir tidak pernah menyentak).
//
// Mode manual: model sepeda kinematik (bicycle model) dengan titik acuan di tengah kendaraan.
import { G } from './shield.js';

export const SH = {
  len: 6.0,
  hl: 3.0,
  hw: 1.05,
  wheelbase: 4.0,
  /** Percepatan nyaman maksimum (m/s²). */
  aMax: 1.2,
  /** Perlambatan maksimum yang bisa dibuat rem di jalan kering (m/s²). */
  aBrake: 5.5,
  /** Perlambatan nyaman untuk berhenti terencana (m/s²). */
  bComf: 1.3,
  /** Sentakan nyaman (m/s³) dan sentakan saat rem harus lebih tegas. */
  jComf: 1.4,
  jFirm: 6,
  /** Sentakan rem terkuat yang bisa dicapai aktuator (m/s³). Dipakai perisai. */
  jEmerg: 30,
  /** Jeda aktuator (detik). */
  tLat: 0.1,
  /** Kelengkungan maksimum (1/m), jari-jari putar terkecil sekitar 5,4 m. */
  kMax: 1 / 5.4,
  /** Laju perubahan kelengkungan maksimum (1/m per detik). */
  kRate: 0.32,
  /** Percepatan samping maksimum saat mengemudi manual (m/s²). */
  aLatManual: 3.2,
  /** Kecepatan mundur maksimum (m/s). */
  vRev: 5 / 3.6,
};

/** Perlambatan terbesar yang bisa dicapai shuttle pada gesekan mu. */
export function shuttleBrake(mu) {
  return Math.min(SH.aBrake, mu * G);
}

/**
 * Jarak henti shuttle dari kecepatan v (>= 0) dan percepatan sekarang a, bila mulai sekarang rem
 * darurat: jeda aktuator tLat, lalu percepatan turun dengan sentakan jEmerg sampai -aB, lalu
 * perlambatan tetap aB. Rumus ini sama persis dengan cara shuttle bergerak (lihat Ego).
 */
export function stopDistJerk(v, a, aB, tLat = SH.tLat, J = SH.jEmerg) {
  if (v <= 0) return 0;
  let d = 0;
  // 1. jeda: percepatan tetap a
  let t = tLat;
  if (a < 0 && v + a * t <= 0) return (v * v) / (-2 * a);
  d += v * t + 0.5 * a * t * t;
  v += a * t;
  // 2. ramp sentakan dari a ke -aB
  if (a > -aB) {
    const tau = (a + aB) / J;
    // cari waktu kecepatan habis di dalam ramp: v + a t - J t²/2 = 0
    const disc = a * a + 2 * J * v;
    const tz = (a + Math.sqrt(disc)) / J;
    if (tz <= tau) {
      return d + v * tz + 0.5 * a * tz * tz - (J * tz * tz * tz) / 6;
    }
    d += v * tau + 0.5 * a * tau * tau - (J * tau * tau * tau) / 6;
    v += a * tau - 0.5 * J * tau * tau;
  }
  // 3. perlambatan tetap
  return d + (v * v) / (2 * aB);
}

/**
 * Percepatan terbesar untuk langkah ini (dalam [aLo, aHi]) sehingga sesudah langkah dt shuttle masih
 * bisa berhenti dalam jarak d (m, jarak tempuh titik pusat). Mengembalikan null bila bahkan aLo tidak
 * cukup (perisai lalu menjepit posisi).
 */
export function maxSafeAccel(v, d, aB, dt, aLo, aHi) {
  const ok = (a) => {
    const v1 = Math.max(0, v + a * dt);
    const ds = v1 <= 0 && a < 0 ? (v * v) / (-2 * a) : v * dt + 0.5 * a * dt * dt;
    return ds + stopDistJerk(v1, a, aB) <= d + 1e-9;
  };
  if (ok(aHi)) return aHi;
  if (!ok(aLo)) return null;
  let lo = aLo;
  let hi = aHi;
  for (let i = 0; i < 18; i++) {
    const m = (lo + hi) / 2;
    if (ok(m)) lo = m;
    else hi = m;
  }
  return lo;
}

/**
 * Pengendali berhenti yang halus: kecepatan acuan sqrt(2 b d), lalu mendekat eksponensial di
 * ujungnya supaya perlambatan kembali ke nol tepat saat berhenti (tanpa sentakan di akhir).
 * d = jarak ke titik henti (m). Mengembalikan percepatan yang diinginkan.
 */
export function stopAccel(v, d, b = SH.bComf) {
  if (d <= 0.02) return v > 0.02 ? -Math.max(b, (v * v) / 0.04) : 0;
  const K = 1.0; // 1/detik, pendekatan akhir
  const vSq = Math.sqrt(2 * b * d);
  const vLin = K * d + 0.08;
  let vr;
  let ff;
  if (vLin < vSq) {
    vr = vLin;
    ff = -K * v;
  } else {
    vr = vSq;
    ff = -(b / Math.max(vr, 0.2)) * v;
  }
  let a = ff + 1.6 * (vr - v);
  // bila sudah terlalu cepat untuk profil nyaman, rem sebanyak yang dibutuhkan (sedikit lebih)
  const need = (v * v) / (2 * Math.max(d, 0.05));
  if (need > b) a = Math.min(a, -need * 1.08);
  return Math.min(a, SH.aMax);
}

/** IDM dengan parameter shuttle. */
export function idmShuttle(v, v0, gap, dv) {
  const a = SH.aMax;
  const b = 1.5;
  const T = 1.5;
  const s0 = 2.6;
  const free = 1 - Math.pow(v / Math.max(v0, 0.1), 4);
  if (gap === Infinity) return a * free;
  const sStar = s0 + Math.max(0, v * T + (v * dv) / (2 * Math.sqrt(a * b)));
  const g = Math.max(gap, 0.05);
  return a * (free - (sStar / g) * (sStar / g));
}

/** Batasi perubahan x menuju target dengan laju maksimum rate x dt. */
export function slew(x, target, rateUp, rateDown, dt) {
  const d = target - x;
  if (d > rateUp * dt) return x + rateUp * dt;
  if (d < -rateDown * dt) return x - rateDown * dt;
  return target;
}

/** Kelengkungan garis tengah link di s (dari arah yang diinterpolasi di antara titik sudut). */
export function pathCurvature(link, s) {
  const P = link.poly;
  if (P.n < 3) return 0;
  if (s <= 0 || s >= link.len) return 0;
  const i = P.seg(s);
  const L = P.cum[i + 1] - P.cum[i];
  if (L < 1e-6) return 0;
  let d = P.hv[i + 1] - P.hv[i];
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d / L;
}

/** Profil geser lateral halus (smoothstep) dari 0 ke off sepanjang panjang ramp. */
export function smoothStep01(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function smoothStep01d(t) {
  if (t <= 0 || t >= 1) return 0;
  return 30 * t * t * (t - 1) * (t - 1);
}
