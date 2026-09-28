// Perisai keselamatan: lapisan terakhir sebelum aktuator, dijalankan tiap langkah fisika untuk
// SETIAP kendaraan (shuttle otonom, shuttle yang dikemudikan manual, mobil dan motor NPC).
//
// Aturan dari pengguna: "Apa pun yang terjadi, tidak ada kendaraan yang bisa menerobos lampu
// merah atau menabrak pejalan kaki."
//
// Cara kerjanya:
// 1. Cari batasan terdekat di sepanjang jalur kendaraan: garis henti lampu merah, garis henti
//    lampu kuning bila kendaraan belum memutuskan jalan terus (dan masih bisa berhenti), zebra
//    cross yang sedang dipakai atau dipesan pejalan kaki, dan pejalan kaki di dalam koridor
//    kendaraan (lebar kendaraan ditambah sela) atau yang diperkirakan masuk koridor dalam
//    beberapa detik.
// 2. Jarak henti = v x jeda aktuator + v^2 / (2 a_rem), dengan a_rem = perlambatan yang BENAR-BENAR
//    bisa dicapai model kendaraan pada gesekan jalan saat ini (cuaca).
// 3. Percepatan dibatasi supaya setelah langkah ini kendaraan tetap bisa berhenti sebelum
//    batasan. Bila perlu, posisi dijepit sehingga kendaraan tidak pernah maju melewati batasan.
// Pejalan kaki juga hanya melangkah ke jalan bila semua kendaraan yang datang masih bisa berhenti
// (lihat pedestrians.js), jadi penjepitan hampir tidak pernah dibutuhkan. Penjepitan dicatat.

import { sweepAt } from './city.js';

export const G = 9.81;

export const SHIELD = {
  /** Jeda aktuator yang diasumsikan (detik). NPC mengerem langsung, jadi ini sisa pengaman. */
  tLatency: 0.15,
  /** Sisa jarak di depan garis henti lampu (m). */
  gapStop: 0.6,
  /** Sisa jarak di depan zebra cross yang dipakai (m). */
  gapCrossing: 1.2,
  /** Sisa jarak di depan pejalan kaki di koridor (m). */
  gapPed: 1.5,
  /** Sela koridor di tiap sisi kendaraan (m). */
  latMargin: 0.45,
  /** Jari-jari badan pejalan kaki untuk koridor (m). */
  pedR: 0.3,
  /** Jarak pandang tambahan di atas jarak henti (m). */
  horizonExtra: 25,
  /** Kecepatan maksimum semua kendaraan (m/s), 40 km/jam. Durasi lampu kuning dihitung dari ini. */
  vMaxGlobal: 40 / 3.6,
  /** Waktu reaksi keputusan di lampu kuning (detik) dan perlambatan nyaman (m/s²). */
  tDecision: 0.5,
  aComfort: 2.5,
};

/** Perlambatan maksimum yang benar-benar bisa dicapai kendaraan pada gesekan mu. */
export function brakeLimit(veh, mu) {
  return Math.min(veh.dyn.aBrake, mu * G);
}

/** Perlambatan nyaman (dipakai keputusan lampu kuning dan penerimaan celah pejalan kaki). */
export function comfortDecel(veh, mu) {
  return Math.min(SHIELD.aComfort, 0.5 * brakeLimit(veh, mu));
}

export function stopDistance(v, aB, tLat = SHIELD.tLatency) {
  return v * tLat + (v * v) / (2 * aB);
}

/** Kecepatan terbesar yang masih bisa berhenti dalam jarak d. */
export function speedForDistance(d, aB, tLat = SHIELD.tLatency) {
  if (d <= 0) return 0;
  const k = aB * tLat;
  return -k + Math.sqrt(k * k + 2 * aB * d);
}

/** Bisakah kendaraan berkecepatan v berhenti dengan nyaman dalam jarak d? */
export function canStopComfortably(veh, d, mu) {
  const a = comfortDecel(veh, mu);
  return d >= veh.v * SHIELD.tDecision + (veh.v * veh.v) / (2 * a);
}

/**
 * Keputusan di lampu kuning, dipakai perencana NPC dan (nanti) shuttle.
 * Kendaraan yang bisa berhenti nyaman WAJIB berhenti. Yang tidak bisa berhenti nyaman hanya boleh
 * jalan terus bila perkiraan sampai garis henti masih di dalam sisa waktu kuning.
 * d = jarak ke titik henti yang direncanakan (negatif bila sudah terlewati), dLine = jarak ke garis
 * henti yang sebenarnya (untuk perkiraan waktu tiba).
 * Mengembalikan 'stop' atau 'go' dan menyimpannya di kendaraan untuk fase kuning ini.
 */
export function yellowDecision(veh, ctl, arm, d, mu, leaderEta = 0, dLine = d) {
  const key = ctl.phaseKey;
  if (veh.sigKey === key && veh.sigArmCtl === ctl) return veh.sigDecision;
  let decision;
  if (d >= 0 && canStopComfortably(veh, d - SHIELD.gapStop, mu)) decision = 'stop';
  else {
    const eta = Math.max(dLine / Math.max(veh.v, 0.3), leaderEta);
    decision = eta < ctl.yellowLeft() - 0.4 ? 'go' : 'stop';
  }
  veh.sigKey = key;
  veh.sigArmCtl = ctl;
  veh.sigDecision = decision;
  return decision;
}

export function committedGo(veh, ctl) {
  return veh.sigArmCtl === ctl && veh.sigKey === ctl.phaseKey && veh.sigDecision === 'go';
}

/** Hasil pencarian batasan (dipakai ulang supaya tidak membuat objek tiap langkah). */
export function newConstraint() {
  return { d: Infinity, kind: '', what: '', link: null, ped: null, name: '' };
}

/**
 * Batasan terdekat di depan kendaraan yang mengikuti lajur (NPC atau shuttle di mode otomatis).
 * veh: { link, s (pusat), len, hw, v, lat, path[] }. Hasil ditulis ke out, jarak d diukur dari
 * bumper depan ke titik berhenti (sudah termasuk sela).
 */
export function nearestConstraint(veh, mu, out) {
  out.d = Infinity;
  out.kind = '';
  out.what = '';
  out.link = null;
  out.ped = null;
  out.name = '';
  const aB = brakeLimit(veh, mu);
  const horizon = stopDistance(veh.v, aB) + SHIELD.horizonExtra;
  const front = veh.s + veh.len / 2;
  let base = -front; // jarak dari bumper depan ke awal link yang sedang diperiksa
  let link = veh.link;
  let k = -1;
  const corr = veh.hw + SHIELD.latMargin + SHIELD.pedR;
  while (link) {
    // 1. lampu lalu lintas di ujung lajur
    if (link.sig) {
      const d = base + link.len;
      if (d > -0.05) {
        const ctl = link.sig.ctl;
        const col = ctl.color(link.sig.arm);
        let stop = col === 'red';
        if (col === 'yellow' && !committedGo(veh, ctl)) stop = true;
        if (stop) {
          const dd = d - SHIELD.gapStop;
          if (dd < out.d) {
            out.d = dd;
            out.kind = col === 'red' ? 'merah' : 'kuning';
            out.link = link;
            out.name = link.name || '';
          }
        }
      }
    }
    // 2. zebra cross yang dipakai pejalan kaki
    for (let i = 0; i < link.xings.length; i++) {
      const xg = link.xings[i];
      if (!xg.x.reserved.size) continue;
      if (base + xg.s1 < -veh.len) continue; // sudah terlewati seluruhnya
      if (base + xg.s0 < -0.2) continue; // bumper sudah di atas zebra cross sebelum dipesan (tidak terjadi bila pejalan kaki patuh celah)
      const dd = base + xg.s0 - SHIELD.gapCrossing;
      if (dd < out.d) {
        out.d = dd;
        out.kind = 'zebra';
        out.link = link;
        out.name = link.name || '';
      }
    }
    // 3. pejalan kaki di dalam koridor (atau diperkirakan masuk koridor)
    const lat0 = k < 0 ? veh.lat || 0 : 0;
    for (let i = 0; i < link.pedN; i++) {
      const pe = link.peds[i];
      // koridor = setengah lebar + sela + badan pejalan kaki + sapuan bodi di tikungan setempat
      if (Math.abs(pe.lat - lat0) >= corr + sweepAt(link, pe.s)) continue;
      const sp = base + pe.s;
      if (sp + SHIELD.pedR < 0) continue; // di belakang bumper depan
      const dd = sp - SHIELD.pedR - SHIELD.gapPed;
      if (dd < out.d) {
        out.d = dd;
        out.kind = pe.pred ? 'pejalan-arah' : 'pejalan';
        out.ped = pe.ped;
        out.link = link;
        out.name = link.name || '';
      }
    }
    base += link.len;
    if (base > horizon) break;
    k++;
    link = veh.path[k];
  }
  return out;
}

/** Percepatan maksimum yang diizinkan perisai supaya tetap bisa berhenti sebelum batasan d. */
export function allowedAccel(veh, d, mu, dt) {
  if (d === Infinity) return Infinity;
  const aB = brakeLimit(veh, mu);
  const dRem = d - veh.v * dt;
  const vAllow = speedForDistance(dRem, aB);
  return (vAllow - veh.v) / dt;
}

/**
 * Pemantau aturan keras. Penghitung "Terobos lampu merah" dan "Kontak dengan pejalan kaki"
 * harus selalu 0. Pemeriksaan kontak memakai tumpang tindih geometri jejak kendaraan (kotak)
 * dan lingkaran badan pejalan kaki.
 */
export class InvariantMonitor {
  constructor(app) {
    this.app = app;
    this.redLight = 0;
    this.pedContact = 0;
    this.contacts = new Set();
    this.nowSet = new Set();
    this.events = [];
  }

  /** Dipanggil saat bumper depan kendaraan melewati garis henti lajur berlampu. */
  stopLineCrossed(veh, link) {
    const col = link.sig.ctl.color(link.sig.arm);
    if (col === 'red') {
      this.redLight++;
      this.note({ type: 'lampu-merah', veh: veh.id, kind: veh.type, where: link.name || '' });
    }
  }

  note(e) {
    e.t = Math.round(this.app.simTime * 10) / 10;
    this.events.push(e);
    if (this.events.length > 30) this.events.shift();
  }

  /** Kontak kendaraan dengan pejalan kaki (tumpang tindih kotak dan lingkaran). */
  checkContacts(vehicles, pedGrid) {
    const now = this.nowSet;
    now.clear();
    for (const v of vehicles) {
      const c = Math.cos(v.h);
      const s = Math.sin(v.h);
      const hl = v.len / 2;
      const hw = v.hw;
      pedGrid.query(v.x, v.z, hl + 1, (p) => {
        const rx = p.x - v.x;
        const rz = p.z - v.z;
        const lx = rx * c + rz * s;
        const lz = -rx * s + rz * c;
        const qx = Math.max(-hl, Math.min(hl, lx));
        const qz = Math.max(-hw, Math.min(hw, lz));
        const ex = lx - qx;
        const ez = lz - qz;
        const r = 0.25;
        if (ex * ex + ez * ez < r * r) {
          const key = v.id * 100000 + p.id;
          now.add(key);
          if (!this.contacts.has(key)) {
            this.pedContact++;
            this.note({ type: 'kontak-pejalan', veh: v.id, kind: v.type, ped: p.id, pstate: p.state, v: Math.round(v.v * 36) / 10, x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10, link: v.link.id, lk: v.link.kind });
          }
        }
      });
    }
    const tmp = this.contacts;
    this.contacts = now;
    this.nowSet = tmp;
  }
}
