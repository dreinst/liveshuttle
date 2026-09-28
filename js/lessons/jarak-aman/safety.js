// Perisai keselamatan dan pemantau untuk pelajaran Jarak Aman.
//
// Aturan dari pengguna: "Apa pun yang terjadi, tidak ada kendaraan yang bisa menerobos lampu merah
// atau menabrak pejalan kaki."
//
// Di pelajaran ini tidak ada lampu lalu lintas. Pejalan kaki ada di adegan Jalan Soekarno-Hatta:
// orang yang berjalan di trotoar dan calon penumpang angkot. Cara aturan itu dijaga:
//   1. Perisai berjalan tiap langkah fisika (1/60 detik) untuk SETIAP kendaraan yang bergerak
//      (mobilmu, mobil depan atau angkot, dan kendaraan di jalur seberang), setelah keputusan
//      pengemudi, ACC, atau AEB dan sebelum gerak dijalankan.
//   2. Semua kendaraan di sini bergerak lurus sepanjang sumbu x (ke timur atau ke barat). Perisai
//      mencari pejalan kaki di koridor kendaraan (lebar kendaraan ditambah sela di kiri dan kanan),
//      baik posisi sekarang maupun titik-titik yang akan dilalui pejalan kaki itu.
//   3. Jarak henti = v x jeda aktuator + v^2 / (2 a). a adalah perlambatan yang benar-benar bisa
//      dicapai mobil pada kondisi jalan saat ini (mu x g), sama dengan yang dipakai model gerak.
//   4. Kecepatan dibatasi sehingga setelah langkah ini kendaraan masih bisa berhenti sebelum
//      pejalan kaki. Bila tetap tidak cukup, posisi dijepit tepat sebelum titik sentuh dan kejadian
//      itu dicatat (seharusnya tidak pernah terjadi).
//   5. Pejalan kaki hanya melangkah ke jalur kendaraan bila setiap kendaraan yang menuju jalurnya
//      masih bisa berhenti dengan hitungan yang sama (penerimaan celah).
//   6. Pemantau memeriksa secara geometris (kotak kendaraan dan lingkaran pejalan kaki) tiap langkah.
//      Angka "Kontak dengan pejalan kaki" dan "Terobos lampu merah" harus selalu 0.
//
// File ini tidak menyentuh DOM, jadi bisa diuji langsung.

import { distanceToBox } from '../../engine/geometry.js';

export const SAFETY = Object.freeze({
  /** Jeda aktuator yang diasumsikan (detik). */
  tLatency: 0.15,
  /** Sisa jarak yang dijaga sebelum pejalan kaki (m). */
  gapPed: 1.5,
  /** Sela koridor di tiap sisi kendaraan (m). */
  latMargin: 0.45,
  /** Jari-jari pejalan kaki (m). */
  pedRadius: 0.35,
});

/** Jarak henti (m) dari kecepatan v dengan perlambatan a, termasuk jeda aktuator. */
export function stopDistance(v, a) {
  const s = Math.max(0, v);
  return s * SAFETY.tLatency + (s * s) / (2 * a);
}

/**
 * Kecepatan terbesar untuk langkah ini (m/s) sehingga setelah bergerak v x dt kendaraan masih bisa
 * berhenti dalam sisa jarak D: D - v dt >= v tLat + v^2 / (2 a).
 */
export function allowedSpeed(D, a, dt) {
  if (!(D > 0)) return 0;
  if (!Number.isFinite(D)) return Infinity;
  const k = a * (SAFETY.tLatency + dt);
  return -k + Math.sqrt(k * k + 2 * a * D);
}

/**
 * Batasan pejalan kaki terdekat untuk kendaraan yang bergerak lurus.
 * veh: { front (x bemper depan), length, y (pusat samping), halfW, dir (+1 ke timur, -1 ke barat) }.
 * peds: [{ r, points: [{ x, y }] }], points berisi posisi sekarang dan titik yang akan dilalui.
 * Hasil: { hard, D } dengan hard = jarak bemper ke titik sentuh, D = hard dikurangi sisa jarak.
 * Pejalan kaki di samping badan kendaraan (di dalam koridor) memberi hard = 0: kendaraan harus diam.
 */
export function pedConstraint(veh, peds) {
  let hard = Infinity;
  for (const p of peds) {
    const r = p.r ?? SAFETY.pedRadius;
    const lat = veh.halfW + SAFETY.latMargin + r;
    for (const q of p.points) {
      if (Math.abs(q.y - veh.y) >= lat) continue;
      const s = (q.x - veh.front) * veh.dir; // jarak di depan bemper
      if (s < -(veh.length + r)) continue; // sudah di belakang kendaraan
      const h = Math.max(0, s - r);
      if (h < hard) hard = h;
    }
  }
  return { hard, D: Number.isFinite(hard) ? hard - SAFETY.gapPed : Infinity };
}

/**
 * Perlambatan minimum yang diminta perisai agar kendaraan tetap bisa berhenti sebelum batasan.
 * v: kecepatan sekarang, decel: perlambatan yang sudah direncanakan, a: perlambatan maksimum.
 * Hasil: { decel, limited }.
 */
export function shieldDecel(v, decel, D, a, dt) {
  if (v <= 0 || !Number.isFinite(D)) return { decel, limited: false };
  const vAllow = allowedSpeed(D, a, dt);
  const vNext = Math.max(0, v - decel * dt);
  if (vNext <= vAllow + 1e-9) return { decel, limited: false };
  const need = Math.min(a, (v - vAllow) / dt);
  return need > decel ? { decel: need, limited: true } : { decel, limited: false };
}

/**
 * Kecepatan yang diizinkan perisai untuk kendaraan dengan pengendali kecepatan sederhana
 * (lalu lintas latar dan mode ikut ACC). Hasil: { v, limited, clampTo } dengan clampTo jarak maju
 * terbesar pada langkah ini (Infinity bila tidak dibatasi).
 */
export function shieldSpeed(v0, vCmd, con, a, dt) {
  if (!Number.isFinite(con.hard)) return { v: vCmd, limited: false, clampTo: Infinity };
  let v = Math.min(vCmd, allowedSpeed(con.D, a, dt));
  const limited = v < vCmd - 1e-9;
  v = Math.max(v, v0 - a * dt, 0); // rem tidak bisa lebih kuat dari a
  return { v, limited, clampTo: con.hard };
}

/**
 * Penerimaan celah: bolehkah pejalan kaki memakai jalur `path` (titik-titik { x, y }) sekarang?
 * Setiap kendaraan yang koridornya memotong jalur itu harus masih bisa berhenti sebelum jalur,
 * dengan hitungan jarak henti yang sama dengan perisai. vehicles: [{ front, length, y, halfW, dir, v, a }].
 */
export function gapAccepted(path, vehicles, r = SAFETY.pedRadius) {
  for (const veh of vehicles) {
    const con = pedConstraint(veh, [{ r, points: path }]);
    if (!Number.isFinite(con.hard)) continue;
    if (veh.v <= 0 && con.hard > 0) continue; // kendaraan diam di luar jalur
    if (con.D < stopDistance(veh.v, veh.a)) return false;
  }
  return true;
}

/** Apakah lingkaran pejalan kaki bersentuhan dengan kotak kendaraan? */
export function touches(box, ped) {
  return distanceToBox(ped.x, ped.y, box) < (ped.r ?? SAFETY.pedRadius) - 1e-9;
}

/**
 * Pemantau aturan keselamatan. check() dipanggil tiap langkah dengan semua kotak kendaraan dan
 * semua pejalan kaki; kontak dihitung sekali per pasangan (saat mulai bersentuhan).
 */
export function createMonitor() {
  const live = new Set();
  const m = {
    redRuns: 0, // "Terobos lampu merah" (tidak ada lampu lalu lintas di pelajaran ini)
    pedContacts: 0, // "Kontak dengan pejalan kaki"
    otherCollisions: 0, // tabrakan dengan mobil depan, angkot, atau mobil mogok (bagian pelajaran)
    shieldActs: 0, // langkah ketika perisai mengubah perintah
    clamps: 0, // posisi dijepit (harus 0)
    checks: 0,
    pairsChecked: 0,
    peds: 0,
    last: null,
    check(boxes, peds) {
      m.checks += 1;
      m.peds = peds.length;
      const now = new Set();
      for (const p of peds) {
        const r = p.r ?? SAFETY.pedRadius;
        for (const b of boxes) {
          const reach = Math.max(b.length, b.width) / 2 + r + 0.5;
          if (Math.abs(b.x - p.x) > reach || Math.abs(b.y - p.y) > reach) continue;
          m.pairsChecked += 1;
          if (touches(b, p)) {
            const key = `${b.id}|${p.id}`;
            now.add(key);
            if (!live.has(key)) {
              m.pedContacts += 1;
              m.last = { vehicle: b.id, ped: p.id, x: p.x, y: p.y };
            }
          }
        }
      }
      live.clear();
      for (const k of now) live.add(k);
    },
    reset() {
      live.clear();
    },
    snapshot() {
      return {
        redRuns: m.redRuns,
        pedContacts: m.pedContacts,
        otherCollisions: m.otherCollisions,
        shieldActs: m.shieldActs,
        clamps: m.clamps,
        checks: m.checks,
        pairsChecked: m.pairsChecked,
        peds: m.peds,
        last: m.last,
      };
    },
  };
  return m;
}
