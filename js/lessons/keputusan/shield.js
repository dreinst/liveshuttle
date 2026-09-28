// Perisai keselamatan: lapisan terakhir sebelum aktuator, dijalankan tiap langkah fisika (1/60 detik)
// untuk SETIAP kendaraan di pelajaran ini: mobil otonom, kendaraan dari arah berlawanan, dan
// kendaraan di Jalan Kelud dan Jalan Arjuno.
//
// Aturan dari pengguna: "Apa pun yang terjadi, tidak ada kendaraan yang bisa menerobos lampu merah
// atau menabrak pejalan kaki."
//
// Cara kerjanya (dalam satu dimensi, sepanjang jalur kendaraan):
// 1. Dunia mengumpulkan batasan di depan bemper depan: garis henti lampu merah, garis henti lampu
//    kuning bila kendaraan wajib berhenti (masih bisa berhenti dengan nyaman saat kuning mulai),
//    penyeberangan yang sedang dipakai pejalan kaki, pejalan kaki di koridor kendaraan (lebar
//    kendaraan ditambah sela) atau yang diperkirakan masuk koridor dalam beberapa detik, serta
//    area simpang yang masih terisi kendaraan dari arah lain.
// 2. Jarak henti = v x jeda aktuator + v² / (2 a_rem). a_rem adalah perlambatan terbesar yang
//    benar-benar bisa dicapai model kendaraan (batas rem kendaraan dan gesekan aspal kering).
// 3. Percepatan dibatasi supaya setelah langkah ini kendaraan masih bisa berhenti sebelum batasan.
//    Posisi juga dijepit: kendaraan tidak pernah bisa maju melewati batasan. Penjepitan dihitung
//    tersendiri dan seharusnya selalu 0 karena pengereman sudah cukup.
// 4. Kendaraan yang saat kuning mulai TIDAK bisa berhenti dengan nyaman memutuskan terus. Setelah
//    itu perisai melarangnya melambat karena alasan lain selain kendaraan di depannya, supaya ia
//    pasti melewati garis henti sebelum merah (kuning 3 detik lebih lama dari waktu yang dibutuhkan).
// Pejalan kaki hanya mulai menyeberang bila semua kendaraan yang datang masih bisa berhenti dengan
// nyaman sebelum penyeberangan (penerimaan celah), dan tidak pernah melangkah ke badan kendaraan.

import { G } from '../../engine/math.js';

export const SAFETY = Object.freeze({
  /** Gesekan aspal kering. Pelajaran ini tidak punya cuaca. */
  mu: 0.8,
  /** Jeda aktuator yang diasumsikan (detik). */
  tLat: 0.1,
  /** Sisa jarak di depan garis henti atau tepi penyeberangan (m). */
  gapLine: 0.3,
  /** Sisa jarak di depan pejalan kaki di koridor (m). */
  gapPed: 1.2,
  /** Sela koridor di tiap sisi kendaraan (m). */
  latMargin: 0.5,
  /** Horizon perkiraan pejalan kaki masuk koridor (detik). */
  tPredict: 3,
  /** Perlambatan nyaman untuk keputusan lampu kuning (m/s²), sama dengan rumus di pelajaran. */
  aComfort: 3,
  /** Perlambatan yang dipakai pejalan kaki saat menilai apakah kendaraan masih bisa berhenti (m/s²). */
  aGap: 2.5,
  /** Sisa jarak pejalan kaki saat menilai celah (m). */
  gapMargin: 2,
  /** Sisa penjepitan (m). */
  clampGap: 0.05,
  /** Kecepatan terbesar mobil otonom (m/s): 50 km/jam, batas jalan perkotaan. */
  vMaxEgo: 50 / 3.6,
  /** Kecepatan terbesar kendaraan lain (m/s): 40 km/jam. */
  vMaxNpc: 40 / 3.6,
  /**
   * Lama lampu kuning (detik). Syaratnya: jeda aktuator + v_max / (2 a_nyaman) + sisa. Dengan
   * v_max 50 km/jam hasilnya 0,1 + 2,31 + sisa, jadi kuning 3 detik menyisakan sekitar 0,6 detik.
   */
  yellow: 3,
});

/** Perlambatan terbesar yang bisa dicapai kendaraan (batas rem dan gesekan jalan). */
export function brakeLimit(maxBrake, mu = SAFETY.mu) {
  return Math.min(maxBrake, mu * G);
}

/** Jarak henti dengan jeda aktuator. */
export function stopDistance(v, a, tLat = SAFETY.tLat) {
  return v * tLat + (v * v) / (2 * a);
}

/**
 * Keputusan lampu kuning, sama persis dengan rumus di pelajaran: berhenti bila jarak ke garis
 * henti d lebih besar dari jarak henti nyaman v² / (2 x 3).
 */
export function yellowMustStop(d, v, aComfort = SAFETY.aComfort) {
  return d > (v * v) / (2 * aComfort);
}

/** Penerimaan celah pejalan kaki: kendaraan sejauh d (m) dengan kecepatan v masih bisa berhenti nyaman? */
export function canStopForPed(d, v) {
  return d - SAFETY.gapMargin >= stopDistance(v, SAFETY.aGap);
}

/**
 * Batasi percepatan supaya kendaraan tetap bisa berhenti sebelum batasan sejauh d (m, dari bemper
 * depan). Menghasilkan { accel, limited }. Model memakai Euler semi implisit (kecepatan dulu, lalu
 * posisi), sehingga jarak henti diskretnya tidak lebih panjang dari v² / (2 a).
 */
export function limitAccel(v, aCmd, d, aBrake, dt) {
  if (!(d < Infinity)) return { accel: aCmd, limited: false };
  const dd = d - SAFETY.gapLine - v * SAFETY.tLat;
  const k = aBrake * dt;
  const v1 = dd <= 0 ? 0 : -k + Math.sqrt(k * k + 2 * aBrake * dd);
  const aMax = (v1 - v) / dt;
  if (aCmd <= aMax) return { accel: aCmd, limited: false };
  return { accel: Math.max(aMax, -aBrake), limited: true };
}

/**
 * Pencatat pelanggaran yang terpisah dari perisai (pemeriksa invarian). Angka terobos merah dan kontak
 * pejalan kaki harus selalu 0.
 */
export function createCounters() {
  const c = {
    events: [],
    reset() {
      Object.assign(c, { redRuns: 0, pedContacts: 0, otherCollisions: 0, clamps: 0, interventions: 0, egoInterventions: 0 });
      c.events.length = 0;
    },
    note(kind, info) {
      if (c.events.length < 40) c.events.push({ kind, ...info });
    },
  };
  c.reset();
  return c;
}
