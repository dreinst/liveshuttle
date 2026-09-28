// Aturan keselamatan untuk pelajaran Lokalisasi (SPEC aturan 9): tidak ada kendaraan yang boleh
// menerobos lampu merah atau menabrak pejalan kaki, apa pun yang dilakukan pelajar.
//
//   Perisai keselamatan  lapisan terakhir sebelum aktuasi, dijalankan setiap langkah fisika untuk
//                        setiap kendaraan (di pelajaran ini hanya mobil otonom). Perisai memakai
//                        posisi relatif yang diukur langsung, bukan posisi hasil lokalisasi, jadi
//                        tetap bekerja walaupun tebakan posisi mobil meleset jauh.
//   Gap acceptance       pejalan kaki baru melangkah ke jalan bila setiap kendaraan yang mendekat
//                        masih bisa berhenti sebelum lintasannya (hitungan jarak henti yang sama).
//   Pemantau             penghitung "Terobos lampu merah" dan "Kontak dengan pejalan kaki" yang
//                        harus selalu 0. Di rute ini tidak ada lampu lalu lintas (OSM tidak mencatat
//                        lampu di ruas-ruas ini), jadi penghitung lampu merah hanya berjaga.

import { distanceToBox } from '../../engine/geometry.js';

export const SHIELD = Object.freeze({
  latency: 0.1, // jeda aktuasi rem (detik)
  margin: 1.2, // jarak sisa yang dijaga di depan hambatan (m)
  lateral: 0.45, // ruang tambahan di kiri dan kanan bodi (m)
  predict: 2, // pejalan kaki yang bergerak diperkirakan posisinya sampai 2 detik ke depan
  comfort: 2.5, // perlambatan nyaman untuk berhenti biasa dan untuk gap acceptance (m/s^2)
});

/** Jarak henti: jarak selama jeda aktuasi ditambah v^2 / (2 a). */
export function stoppingDistance(v, aBrake, latency = SHIELD.latency) {
  const s = Math.max(0, v);
  return (s * s) / (2 * aBrake) + s * latency;
}

/** Kotak bodi kendaraan (untuk uji jarak). */
export const bodyBox = (v, grow = 0) => ({ x: v.x, y: v.y, heading: v.heading, length: v.length + 2 * grow, width: v.width + 2 * grow });

/**
 * Jarak tempuh pusat kendaraan (m) sampai bodinya, diperlebar `lateral`, pertama kali menyentuh
 * salah satu hambatan di depan. Lintasan diperkirakan sebagai busur dengan sudut setir sekarang
 * (model sepeda kinematik yang sama dengan Vehicle.step). Hambatan = { pts: [{x, y}], radius }.
 * Hambatan yang sudah bersebelahan atau di belakang bodi tidak dihitung.
 */
export function corridorDistance(v, obstacles, maxDist, { lateral = SHIELD.lateral, ds = 0.35 } = {}) {
  if (!obstacles.length) return Infinity;
  const lr = v.wheelbase / 2;
  const beta = Math.atan(0.5 * Math.tan(v.steer || 0));
  const k = Math.sin(beta) / lr;
  const c0 = Math.cos(v.heading);
  const s0 = Math.sin(v.heading);
  // Titik di depan bemper depan diuji dengan bodi yang diperlebar `lateral`. Titik yang sudah di
  // samping bodi hanya dihitung bila bodi (tanpa pelebaran) makin mendekatinya sampai kurang dari
  // 0,15 m, misalnya saat mobil berbelok ke arah pejalan kaki di sebelahnya. Sisa kasus ditangani
  // penjepit setelah aktuasi (touchesPedestrian di scene.js).
  const front = v.length / 2 - 0.2;
  const body = { x: v.x, y: v.y, heading: v.heading, length: v.length, width: v.width };
  const pts = [];
  for (const o of obstacles) {
    for (const p of o.pts) {
      const dx = p.x - v.x;
      const dy = p.y - v.y;
      const along = dx * c0 + dy * s0;
      if (along < -v.length / 2 || Math.hypot(dx, dy) > maxDist + v.length + 4) continue;
      const side = along < front;
      pts.push({ x: p.x, y: p.y, r: o.radius, side, d0: side ? distanceToBox(p.x, p.y, body) : 0 });
    }
  }
  if (!pts.length) return Infinity;
  let x = v.x;
  let y = v.y;
  let h = v.heading;
  const box = { x, y, heading: h, length: v.length, width: v.width + 2 * lateral };
  for (let d = 0; d <= maxDist; d += ds) {
    box.x = body.x = x;
    box.y = body.y = y;
    box.heading = body.heading = h;
    for (const p of pts) {
      if (!p.side) {
        if (distanceToBox(p.x, p.y, box) <= p.r) return d;
      } else if (d > 0) {
        const e = distanceToBox(p.x, p.y, body);
        if (e <= p.r + 0.15 && e < p.d0 - 0.02) return d;
      }
    }
    x += Math.cos(h + beta) * ds;
    y += Math.sin(h + beta) * ds;
    h += k * ds;
  }
  return Infinity;
}

/** Hambatan dari daftar pejalan kaki: posisi sekarang dan perkiraan posisi sampai 2 detik ke depan. */
export function pedestrianObstacles(peds) {
  const out = [];
  for (const p of peds) {
    if (!p.active) continue;
    const pts = [{ x: p.x, y: p.y }];
    const sp = p.moving ? p.speed : 0;
    if (sp > 0.05) {
      for (let t = 0.5; t <= SHIELD.predict + 1e-9; t += 0.5) pts.push({ x: p.x + Math.cos(p.heading) * sp * t, y: p.y + Math.sin(p.heading) * sp * t });
    }
    out.push({ pts, radius: p.radius, ped: p });
  }
  return out;
}

/**
 * Perisai keselamatan untuk satu kendaraan pada satu langkah fisika.
 * cmd = { accel, brake, steer } dari perencana atau pengemudi. extraStop = jarak tempuh pusat kendaraan
 * ke batas lain yang tidak boleh dilewati (misalnya tepi zebra cross yang sedang dipakai), atau Infinity.
 * friction = faktor gesekan jalan saat ini (1 = aspal kering). Hasil: { cmd, active, distance }.
 */
export function shieldCommand(v, cmd, obstacles, dt, { extraStop = Infinity, friction = 1 } = {}) {
  const aBrake = v.maxBrake * friction; // perlambatan yang memang bisa dicapai model kendaraan
  const speed = Math.max(0, v.speed);
  const dStop = stoppingDistance(speed, aBrake) + speed * dt;
  const look = dStop + SHIELD.margin + 10;
  const d = Math.min(corridorDistance(v, obstacles, look), extraStop);
  if (!Number.isFinite(d)) return { cmd, active: false, distance: Infinity };
  const room = d - SHIELD.margin;
  if (room <= dStop) {
    // Selama mengerem, setir ditahan di sudutnya sekarang. Lintasan yang dipakai untuk menghitung
    // jarak di atas (busur dengan sudut setir sekarang) jadi tetap sama sampai mobil berhenti, dan
    // perencana dengan posisi tebakan yang meleset tidak bisa membelokkan mobil ke arah pejalan kaki.
    // Saat mobil sudah diam, setir boleh bergerak lagi (tanpa laju, mobil tidak berpindah).
    const steer = speed > 0.05 ? v.steer : cmd.steer;
    return { cmd: { accel: 0, brake: aBrake, steer }, active: true, distance: d };
  }
  // batasi percepatan supaya kecepatan langkah berikutnya masih bisa berhenti sebelum hambatan
  const vAllowed = Math.sqrt(Math.max(0, 2 * aBrake * (room - speed * SHIELD.latency)));
  const maxAccel = (vAllowed - speed) / dt;
  if ((cmd.accel || 0) > maxAccel) return { cmd: { ...cmd, accel: Math.max(-aBrake, maxAccel) }, active: true, distance: d };
  return { cmd, active: false, distance: d };
}

/** Apakah bodi kendaraan (diperbesar `grow`) menyentuh salah satu pejalan kaki? */
export function touchesPedestrian(v, peds, grow = 0) {
  const box = bodyBox(v);
  for (const p of peds) {
    if (!p.active) continue;
    if (distanceToBox(p.x, p.y, box) <= p.radius + grow) return p;
  }
  return null;
}

/**
 * Pemantau aturan keselamatan. Hitungan tidak pernah direset selama pelajaran terbuka, supaya
 * pelanggaran (yang seharusnya tidak mungkin) tidak tersembunyi oleh tombol Ulangi.
 */
export function createMonitor() {
  const m = {
    redLightViolations: 0, // "Terobos lampu merah"
    pedestrianContacts: 0, // "Kontak dengan pejalan kaki"
    shieldInterventions: 0,
    shieldHardBrakes: 0,
    clamps: 0,
    minClearance: Infinity, // jarak terkecil bodi mobil ke pejalan kaki yang pernah tercatat (m)
    crossings: 0, // pejalan kaki yang selesai menyeberang
    touching: new Set(),
  };
  return {
    state: m,
    /** Periksa kontak geometris bodi kendaraan dengan lingkaran pejalan kaki. */
    check(vehicles, peds) {
      for (const v of vehicles) {
        const box = bodyBox(v);
        for (const p of peds) {
          if (!p.active) continue;
          const gap = distanceToBox(p.x, p.y, box) - p.radius;
          if (gap < m.minClearance) m.minClearance = gap;
          const key = `${v.id}|${p.id}`;
          if (gap <= 0) {
            if (!m.touching.has(key)) {
              m.touching.add(key);
              m.pedestrianContacts++;
            }
          } else m.touching.delete(key);
        }
      }
    },
    snapshot() {
      return {
        redLightViolations: m.redLightViolations,
        pedestrianContacts: m.pedestrianContacts,
        shieldInterventions: m.shieldInterventions,
        shieldHardBrakes: m.shieldHardBrakes,
        clamps: m.clamps,
        minClearance: Number.isFinite(m.minClearance) ? Math.round(m.minClearance * 1000) / 1000 : null,
        crossings: m.crossings,
      };
    },
  };
}
