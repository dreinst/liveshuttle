// Perisai keselamatan untuk pelajaran Sensor (2D).
//
// Aturan dari pengguna: "Apa pun yang terjadi, tidak ada kendaraan yang bisa menerobos lampu merah
// atau menabrak pejalan kaki."
//
// Cara kerjanya (dijalankan tiap langkah fisika 1/60 detik untuk SETIAP kendaraan: mobil otonom
// yang dikemudikan pelajar, mobil, angkot, dan sepeda motor latar):
// 1. Perencana (atau tombol Maju dan Mundur) meminta kecepatan baru.
// 2. Perisai mencari batasan terdekat di jalur kendaraan: garis henti lampu merah, garis henti
//    lampu kuning bila kendaraan masih bisa berhenti dengan nyaman, zebra cross yang sedang dipakai
//    atau sudah dipesan pejalan kaki, dan pejalan kaki di dalam koridor kendaraan (lebar kendaraan
//    ditambah sela) sekarang atau dalam 3 detik ke depan.
// 3. Jarak henti = v x jeda aktuator + v^2 / (2 a_rem). a_rem adalah perlambatan yang benar-benar
//    bisa dicapai kendaraan pada gesekan jalan saat ini (hujan membuat jalan licin).
// 4. Kecepatan dibatasi sehingga setelah langkah ini kendaraan masih bisa berhenti sebelum batasan.
//    Bila tetap tidak cukup (seharusnya tidak pernah terjadi), posisi dijepit tepat di batasan
//    dan kejadian itu dicatat.
// Pejalan kaki hanya mulai menyeberang bila semua kendaraan yang menuju zebra cross masih bisa
// berhenti dengan hitungan yang sama (penerimaan celah).

import { G } from '../../engine/math.js';
import { boxCorners, boxesOverlap, distanceToBox } from '../../engine/geometry.js';

export const SAFETY = Object.freeze({
  /** Jeda aktuator yang diasumsikan (detik). */
  tLatency: 0.15,
  /** Sisa jarak sebelum garis henti (m). */
  gapStop: 0.6,
  /** Sisa jarak sebelum zebra cross yang dipakai (m). */
  gapCrossing: 1.2,
  /** Sisa jarak sebelum pejalan kaki di koridor (m). */
  gapPed: 1.5,
  /** Sela koridor di tiap sisi kendaraan (m). */
  latMargin: 0.45,
  /** Waktu keputusan di lampu kuning (detik) dan perlambatan nyaman maksimum (m/s²). */
  tDecision: 1,
  aComfort: 2.5,
  /** Kecepatan maksimum semua kendaraan di adegan (m/s), sekitar 31 km/jam. */
  vMax: 8.5,
  /** Waktu prakiraan gerak pejalan kaki (detik). */
  predict: Object.freeze([0.5, 1, 1.5, 2, 2.5, 3]),
  /** Sisa jarak saat posisi terpaksa dijepit (m). */
  clampRoom: 0.005,
});

/** Koefisien gesek jalan per cuaca (penyederhanaan): aspal kering 0,8, basah 0,5. */
export const FRICTION = Object.freeze({ cerah: 0.8, hujan: 0.5, kabut: 0.7, malam: 0.8 });

/** Perlambatan maksimum yang benar-benar bisa dicapai: dibatasi rem kendaraan dan gesekan jalan. */
export function brakeLimit(maxBrake, mu) {
  return Math.min(maxBrake, mu * G);
}

/** Perlambatan nyaman (keputusan lampu kuning, penerimaan celah). */
export function comfortDecel(aBrake) {
  return Math.min(SAFETY.aComfort, 0.5 * aBrake);
}

/** Jarak henti (m) dari kecepatan v dengan perlambatan aBrake, termasuk jeda aktuator. */
export function stopDistance(v, aBrake) {
  const a = Math.abs(v);
  return a * SAFETY.tLatency + (a * a) / (2 * aBrake);
}

/**
 * Kecepatan terbesar untuk langkah ini (m/s) sehingga setelah bergerak v x dt kendaraan masih bisa
 * berhenti dalam sisa jarak: D - v dt >= v tLat + v^2 / (2 a).
 */
function allowedSpeed(D, aBrake, dt) {
  if (!(D > 0)) return 0;
  if (!Number.isFinite(D)) return Infinity;
  const k = aBrake * (SAFETY.tLatency + dt);
  return -k + Math.sqrt(k * k + 2 * aBrake * D);
}

/** Bisakah kendaraan berkecepatan v berhenti dengan nyaman dalam jarak D (keputusan lampu kuning)? */
export function canStopComfortably(v, D, aBrake) {
  const a = comfortDecel(aBrake);
  return D >= v * SAFETY.tDecision + (v * v) / (2 * a);
}

/**
 * Durasi kuning minimum (detik): waktu keputusan + v_max / (2 a_nyaman) + 0,5 detik cadangan.
 * Kendaraan yang tidak bisa berhenti nyaman saat kuning mulai masih sempat melewati garis henti.
 */
export function minYellow(vMax, aBrakeMin) {
  return SAFETY.tDecision + vMax / (2 * comfortDecel(aBrakeMin)) + 0.5;
}

/**
 * Terapkan perisai untuk satu kendaraan yang bergerak di satu arah.
 * v0: kecepatan sekarang (>= 0, di arah gerak), vCmd: kecepatan yang diminta perencana atau pelajar,
 * D: jarak bebas ke batasan terdekat (sudah dikurangi sisa jarak), hard: jarak ke titik batasan itu
 * sendiri (tanpa sisa jarak), aBrake: perlambatan yang bisa dicapai.
 * Hasil: { v, limited (perisai mengubah permintaan), clamped (posisi harus dijepit) }.
 */
export function shieldSpeed(v0, vCmd, D, hard, aBrake, dt) {
  const vAllow = allowedSpeed(D, aBrake, dt);
  let v = Math.min(vCmd, vAllow);
  const limited = v < vCmd - 1e-9;
  // rem tidak bisa lebih kuat dari aBrake
  v = Math.max(v, v0 - aBrake * dt, 0);
  let clamped = false;
  // Jepitan menyisakan beberapa milimeter, jadi bemper tidak pernah tepat menyentuh garis atau
  // benda (galat pembulatan bisa membuatnya tercatat sudah lewat).
  const room = Math.max(0, hard - SAFETY.clampRoom);
  if (Number.isFinite(hard) && v * dt > room) {
    v = room / dt;
    clamped = true;
  }
  return { v, limited, clamped };
}

/**
 * Jarak dari bemper (titik o, arah satuan dir) ke benda terdekat di koridor selebar halfW + margin.
 * Benda kotak diuji lewat titik-titik di kelilingnya, lingkaran lewat pusat dan jari-jarinya.
 * Hasil: { dist, object } atau { dist: Infinity }.
 */
export function corridorGap(o, dir, halfW, objects, { margin = SAFETY.latMargin, maxDist = 60, predict = false } = {}) {
  let best = Infinity;
  let bestObj = null;
  const lx = -dir.y;
  const ly = dir.x;
  const test = (px, py, r, obj) => {
    const rx = px - o.x;
    const ry = py - o.y;
    const along = rx * dir.x + ry * dir.y;
    if (along < -r || along > maxDist + r) return;
    const lat = rx * lx + ry * ly;
    if (Math.abs(lat) > halfW + margin + r) return;
    const d = Math.max(0, along - r);
    if (d < best) {
      best = d;
      bestObj = obj;
    }
  };
  for (const obj of objects) {
    if (obj.radius != null && obj.length == null) {
      test(obj.x, obj.y, obj.radius, obj);
      if (predict && (obj.vx || obj.vy)) for (const t of SAFETY.predict) test(obj.x + obj.vx * t, obj.y + obj.vy * t, obj.radius, obj);
    } else {
      for (const p of perimeter(obj)) test(p.x, p.y, 0, obj);
    }
  }
  return { dist: best, object: bestObj };
}

/** Titik-titik di keliling kotak (tiap sekitar 0,5 m). */
export function perimeter(box, step = 0.5) {
  const c = boxCorners(box);
  const out = [];
  for (let i = 0; i < 4; i++) {
    const a = c[i];
    const b = c[(i + 1) % 4];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return out;
}

/**
 * Pemantau invarian yang keras: menghitung pelanggaran yang TIDAK BOLEH terjadi.
 *   redRuns      "Terobos lampu merah": bemper depan melewati garis henti saat lampunya merah.
 *   pedContacts  "Kontak dengan pejalan kaki": kotak kendaraan bersentuhan dengan lingkaran pejalan kaki.
 * Dicatat terpisah (boleh terjadi saat mengemudi manual, tetapi di adegan ini pun dicegah):
 *   otherCollisions  tabrakan antarkendaraan.
 * Juga: clamps (perisai harus menjepit posisi), interventions (perisai mengubah permintaan).
 */
export function createMonitor() {
  const m = {
    redRuns: 0,
    pedContacts: 0,
    otherCollisions: 0,
    clamps: 0,
    interventions: 0,
    egoInterventions: 0,
    ticks: 0,
    minPedGap: Infinity,
    events: [],
    _contacts: new Set(),
    _crash: new Set(),
    _prevAlong: new Map(),
    /** Lupakan posisi sebelumnya (setelah Ulangi, supaya lompatan posisi tidak dianggap pelanggaran). */
    resetTracking() {
      m._contacts.clear();
      m._crash.clear();
      m._prevAlong.clear();
    },
    log(type, detail) {
      if (m.events.length < 40) m.events.push({ type, ...detail });
    },
    /**
     * Periksa satu langkah. vehicles: kotak kendaraan aktif; peds: lingkaran pejalan kaki;
     * lines: [{ id, x, y, heading (arah gerak), halfWidth, light }] garis henti.
     */
    check(vehicles, peds, lines, time) {
      m.ticks++;
      // kontak pejalan kaki (geometri murni, tanpa sela)
      for (const v of vehicles) {
        for (const p of peds) {
          const gap = distanceToBox(p.x, p.y, v) - p.radius;
          if (gap < m.minPedGap) m.minPedGap = gap;
          const key = `${v.id}|${p.id}`;
          if (gap <= 0) {
            if (!m._contacts.has(key)) {
              m._contacts.add(key);
              m.pedContacts++;
              m.log('kontak-pejalan', { time, vehicle: v.id, ped: p.id });
            }
          } else m._contacts.delete(key);
        }
      }
      // lampu merah: bemper depan berpindah dari sebelum ke sesudah garis saat merah
      for (const v of vehicles) {
        if (v.parked) continue;
        const half = v.length / 2;
        const fx = v.x + Math.cos(v.heading) * half;
        const fy = v.y + Math.sin(v.heading) * half;
        for (const L of lines) {
          const align = Math.cos(v.heading - L.heading);
          const along = (fx - L.x) * Math.cos(L.heading) + (fy - L.y) * Math.sin(L.heading);
          const lat = -(fx - L.x) * Math.sin(L.heading) + (fy - L.y) * Math.cos(L.heading);
          const key = `${v.id}|${L.id}`;
          const inLane = align > 0.6 && Math.abs(lat) <= L.halfWidth + 0.6;
          const prev = m._prevAlong.get(key);
          if (inLane && prev != null && prev < 0 && along >= 0 && L.light.state === 'red') {
            m.redRuns++;
            m.log('terobos-merah', { time, vehicle: v.id, line: L.id });
          }
          m._prevAlong.set(key, inLane ? along : null);
        }
      }
      // tabrakan antarkendaraan
      for (let i = 0; i < vehicles.length; i++) {
        for (let j = i + 1; j < vehicles.length; j++) {
          const a = vehicles[i];
          const b = vehicles[j];
          const key = `${a.id}|${b.id}`;
          if (boxesOverlap(a, b)) {
            if (!m._crash.has(key)) {
              m._crash.add(key);
              m.otherCollisions++;
              m.log('tabrakan', { time, a: a.id, b: b.id });
            }
          } else m._crash.delete(key);
        }
      }
    },
    snapshot() {
      return {
        redRuns: m.redRuns,
        pedContacts: m.pedContacts,
        otherCollisions: m.otherCollisions,
        clamps: m.clamps,
        interventions: m.interventions,
        egoInterventions: m.egoInterventions,
        ticks: m.ticks,
        minPedGap: Number.isFinite(m.minPedGap) ? m.minPedGap : null,
        events: m.events.slice(),
      };
    },
  };
  return m;
}

