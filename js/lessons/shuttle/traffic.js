// Lalu lintas pelajaran Misi Shuttle Otonom: shuttle, mobil, MPV, angkot, pikap, dan sepeda motor
// yang berjalan di lajur OSM sekitar Universitas Ma Chung.
//
// Aturan mengemudi sama dengan Shuttle 3D Ma Chung (js/sim3d/traffic.js, disalin tanpa bagian
// Three.js). Tiap langkah fisika (dt tetap 1/60 detik) setiap kendaraan:
// 1. memperpanjang rencana jalur (kendaraan lain: belokan acak; shuttle: rute A* ke halte),
// 2. mencatat diri sebagai "mendekat" dan, bila cukup dekat, meminta izin masuk persimpangan
//    (js/sim3d/junctions.js: rantai konektor, prioritas, lajur keluar harus ada ruang),
// 3. menghitung percepatan rencana: IDM untuk mengikuti kendaraan di depan, batas kecepatan
//    tikungan, berhenti di garis bila belum diberi izin, lampu merah, lampu kuning, zebra cross
//    yang dipakai, dan titik henti halte,
// 4. melewati PERISAI KESELAMATAN (js/sim3d/shield.js): batasan terdekat di depan (garis henti
//    merah, garis henti kuning yang wajib dipatuhi, zebra cross terpakai, pejalan kaki di koridor
//    kendaraan atau yang diperkirakan masuk koridor) dan percepatan dibatasi supaya kendaraan
//    selalu bisa berhenti sebelum batasan itu dengan perlambatan yang benar-benar bisa dicapai
//    pada gesekan jalan saat ini,
// 5. bergerak, dengan penjepitan keras: bumper depan tidak pernah maju melewati batasan perisai,
//    garis tunggu tanpa izin, atau bumper belakang kendaraan di depannya.
// Kendaraan lain hanya dibuat di sekitar shuttle (sekitar 250 m) supaya ringan.

import { Junctions } from '../../sim3d/junctions.js';
import { SHIELD, brakeLimit, nearestConstraint, allowedAccel, newConstraint, yellowDecision, committedGo } from '../../sim3d/shield.js';
import { COLORS } from '../../engine/theme.js';
import { boxesOverlap } from '../../engine/geometry.js';

/** Parameter dinamika per jenis, sama dengan Shuttle 3D (percepatan, rem maksimum yang bisa dicapai, IDM). */
export const DYN = {
  car: { aMax: 1.6, aBrake: 7.0, b: 2.0, T: 1.2, s0: 2.0, vDes: [8.6, 11.1] },
  mpv: { aMax: 1.4, aBrake: 6.8, b: 2.0, T: 1.3, s0: 2.0, vDes: [8.3, 10.8] },
  angkot: { aMax: 1.2, aBrake: 6.5, b: 1.8, T: 1.4, s0: 2.2, vDes: [7.5, 9.7] },
  pickup: { aMax: 1.2, aBrake: 6.3, b: 1.8, T: 1.4, s0: 2.2, vDes: [7.8, 9.7] },
  motorbike: { aMax: 2.0, aBrake: 6.5, b: 2.2, T: 1.0, s0: 1.6, vDes: [8.9, 11.1] },
  shuttle: { aMax: 1.0, aBrake: 5.5, b: 1.6, T: 1.5, s0: 3.0, vDes: [8.33, 8.33] },
};
/** Shuttle saat hujan: jarak waktu 3 detik dan jarak minimum 5 m (teks pelajaran langkah 3). */
export const SHUTTLE_WET = { ...DYN.shuttle, T: 3.0, s0: 5.0 };

/** Ukuran kendaraan (m), sama dengan model 3D. */
export const DIMS = {
  car: { len: 3.7, wid: 1.62 },
  mpv: { len: 4.4, wid: 1.74 },
  angkot: { len: 4.15, wid: 1.65 },
  pickup: { len: 4.2, wid: 1.7 },
  motorbike: { len: 1.9, wid: 0.72 },
  shuttle: { len: 6.0, wid: 2.1 },
};

/** Nama jenis untuk drawVehicle (js/engine/draw.js). */
export const DRAW_KIND = { car: 'city', mpv: 'mpv', angkot: 'angkot', pickup: 'car', motorbike: 'motor', shuttle: 'shuttle' };
export const TYPE_LABEL = { car: 'mobil', mpv: 'mobil', angkot: 'angkot', pickup: 'mobil bak', motorbike: 'sepeda motor', shuttle: 'shuttle' };

const MIX = [
  ['motorbike', 0.4],
  ['car', 0.25],
  ['mpv', 0.15],
  ['angkot', 0.12],
  ['pickup', 0.08],
];

const WEATHER_SPEED = { cerah: 1, hujan: 0.8 };
const CAR_COLORS = ['#e2e8f0', '#94a3b8', '#475569', '#b91c1c', '#1d4ed8', '#0f766e', '#a16207', '#f8fafc', '#334155'];
const MOTOR_COLORS = ['#1f2937', '#b91c1c', '#1d4ed8', '#e2e8f0', '#0f172a', '#7c3aed'];
const JACKETS = ['#334155', '#9f1239', '#1e3a8a', '#065f46', '#78350f', '#475569', '#0f172a'];

function idm(v, v0, gap, dv, p) {
  const free = 1 - Math.pow(v / Math.max(v0, 0.1), 4);
  if (gap === Infinity) return p.aMax * free;
  const sStar = p.s0 + Math.max(0, v * p.T + (v * dv) / (2 * Math.sqrt(p.aMax * p.b)));
  const g = Math.max(gap, 0.05);
  return p.aMax * (free - (sStar / g) * (sStar / g));
}

/** Berhenti tepat di titik: perlambatan konstan yang dibutuhkan, dibatasi rem maksimum. */
function stopAt(v, d, p) {
  if (d <= 0.05) return -p.aBrake;
  const need = (v * v) / (2 * d);
  if (need > p.b * 0.6) return -Math.min(p.aBrake, need * 1.05);
  return idm(v, Math.min(v + 2, Math.sqrt(2 * p.b * 0.6 * d) + 0.3), d, v, { ...p, s0: 0.3, T: 0.6 });
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
/** Kotak jejak kendaraan, dikecilkan 0,08 m tiap sisi supaya kendaraan yang hanya bersentuhan tidak dihitung. */
const shrunk = (v) => ({ x: v.x, y: v.z, heading: v.h, length: v.len - 0.16, width: v.wid - 0.16 });
const TMP = {};
const WEIGHTS = [];
let nextVehId = 1;

export class Vehicle {
  constructor(type, opts = {}) {
    this.id = nextVehId++;
    this.type = type;
    const D = DIMS[type];
    this.len = D.len;
    this.wid = D.wid;
    this.hw = D.wid / 2;
    this.dyn = DYN[type];
    this.rng = opts.rng || Math.random;
    this.vDesBase = this.dyn.vDes[0] + (this.dyn.vDes[1] - this.dyn.vDes[0]) * this.rng();
    this.link = null;
    this.prevLink = null;
    this.s = 0;
    this.v = 0;
    this.a = 0;
    this.lat = type === 'motorbike' ? -0.45 + this.rng() * 0.25 : 0;
    this.path = [];
    this.pathLen = 0;
    this.odo = 0;
    this.grants = [];
    this.reqConn = null;
    this.reqT = 0;
    this.reqDist = 0;
    this.rbExit = null;
    this.rbExitPending = null;
    this.waitWhy = 0;
    this.x = 0;
    this.z = 0;
    this.h = 0;
    this.braking = false;
    this.stuckT = 0;
    this.shieldOn = false;
    this.shieldEvents = 0;
    this.cons = newConstraint();
    this.sigKey = 0;
    this.sigArmCtl = null;
    this.sigDecision = '';
    this.ego = !!opts.ego;
    this.route = null;
    this.stopTarget = null;
    this.holdAtHalte = false;
    this.alive = true;
    this.planReason = '';
    this.leaderGap = Infinity;
    this.leaderV = 0;
    this.leaderVeh = null;
    this.aPlan = 0;
    this.exitNow = false;
    this.idleGrantT = 0;
    // tampilan 2D
    this.kind = DRAW_KIND[type];
    this.label = TYPE_LABEL[type];
    this.length = D.len;
    this.width = D.wid;
    this.alpha = 1;
    this.fade = 0; // +1 muncul, -1 menghilang
    this.color = null;
  }

  // nama bidang yang dipakai modul engine (sensor, gambar)
  get y() {
    return this.z;
  }
  get heading() {
    return this.h;
  }
  get speed() {
    return this.v;
  }
  get vx() {
    return Math.cos(this.h) * this.v;
  }
  get vy() {
    return Math.sin(this.h) * this.v;
  }

  place(link, s, v) {
    this.link = link;
    this.prevLink = null;
    this.s = s;
    this.v = v;
    this.path.length = 0;
    this.pathLen = 0;
    this.updatePose();
  }

  updatePose() {
    const o = this.link.poly.atSmooth(this.s, TMP);
    const h = o.h;
    this.x = o.x - Math.sin(h) * this.lat;
    this.z = o.z + Math.cos(h) * this.lat;
    this.h = h;
  }

  /** Bumper depan (titik tengah). */
  frontPoint() {
    return { x: this.x + Math.cos(this.h) * (this.len / 2), y: this.z + Math.sin(this.h) * (this.len / 2) };
  }
}

export class Traffic {
  /**
   * app: { city, rng(), simTime, focus {x, y}, mu, weather, egoSpeedLimit(), monitor, onShield(veh, cons) }
   */
  constructor(app) {
    this.app = app;
    this.city = app.city;
    this.cars = [];
    this.all = [];
    this.target = 12;
    this.radius = 250;
    this.touched = [];
    this.pool = [];
    this.poolN = 0;
    this.stats = { clamps: 0, followClamps: 0, lineClamps: 0, recovered: 0, overlaps: 0, spawned: 0, removed: 0 };
    this.overlapPairs = new Set();
    this.overlapNow = new Set();
    this.junctions = new Junctions({
      city: app.city,
      traffic: this,
      get simTime() {
        return app.simTime;
      },
    });
  }

  pickType() {
    const r = this.app.rng();
    let acc = 0;
    for (const [t, w] of MIX) {
      acc += w;
      if (r < acc) return t;
    }
    return 'car';
  }

  makeNpc(type) {
    const rng = this.app.rng;
    const veh = new Vehicle(type, { rng });
    const pick = (arr) => arr[Math.floor(rng() * arr.length)];
    if (type === 'angkot') veh.color = COLORS.angkot;
    else if (type === 'motorbike') {
      veh.color = pick(MOTOR_COLORS);
      veh.helmet = pick(COLORS.helmets);
      veh.jacket = pick(JACKETS);
      veh.passenger = rng() < 0.25;
      veh.passengerHelmet = pick(COLORS.helmets);
    } else veh.color = pick(CAR_COLORS);
    return veh;
  }

  // ===== muncul dan hilang (hanya di sekitar shuttle) =====

  /** Apakah posisi (link, s) aman untuk memunculkan kendaraan sepanjang len? (sama dengan Shuttle 3D) */
  spawnFree(link, s, len, margin) {
    const lo = s - len / 2 - margin;
    const hi = s + len / 2 + margin;
    for (const w of this.all) {
      if (w.link === link && w.s + w.len / 2 > lo && w.s - w.len / 2 < hi) return false;
      for (let i = 0; i < w.path.length && i < 2; i++) if (w.path[i] === link && hi > 0 && w.link.len - w.s < margin + len) return false;
    }
    for (const xg of link.xings) if (xg.x.reserved.size && xg.s1 > lo - 20 && xg.s0 < hi + 25) return false;
    for (const xg of link.xings) if (xg.s1 > lo - 2 && xg.s0 < hi + 2) return false;
    if (link.sig && link.len - hi < 25) return false;
    if (link.kind === 'lane' && hi > link.stopLen - 1) return false;
    if (link.closed) return false;
    for (let i = 0; i < link.pedN; i++) {
      const pe = link.peds[i];
      if (pe.s > lo - 25 && pe.s < hi + 30) return false;
    }
    return true;
  }

  addAt(veh, link, s, v) {
    veh.place(link, s, v);
    this.extendPath(veh);
    if (!veh.ego) this.cars.push(veh);
    this.all.push(veh);
    return veh;
  }

  /**
   * Munculkan satu kendaraan di lajur antara rMin dan rMax dari titik fokus. hidden(x, y) = true
   * untuk titik yang tidak terlihat di layar (kendaraan muncul di luar layar bila bisa).
   */
  spawnNear(rMin, rMax, hidden = null, fadeIn = true) {
    const lanes = this.city.spawnLanes;
    const app = this.app;
    const f = app.focus;
    for (let tries = 0; tries < 40; tries++) {
      const link = lanes[Math.floor(app.rng() * lanes.length)];
      const bb = link.poly.bb;
      const cx = (bb[0] + bb[2]) / 2;
      const cy = (bb[1] + bb[3]) / 2;
      if (Math.hypot(cx - f.x, cy - f.y) > rMax + link.len / 2) continue;
      const type = this.pickType();
      const len = DIMS[type].len;
      const s = 6 + len / 2 + app.rng() * (link.len - 20 - len);
      if (s < len / 2 + 2 || s > link.len - len / 2 - 8) continue;
      const p = link.poly.at(s, TMP);
      const d = Math.hypot(p.x - f.x, p.z - f.y);
      if (d < rMin || d > rMax) continue;
      if (hidden && tries < 30 && !hidden(p.x, p.z)) continue;
      if (!this.spawnFree(link, s, len, 9)) continue;
      const veh = this.makeNpc(type);
      veh.alpha = fadeIn ? 0 : 1;
      veh.fade = fadeIn ? 1 : 0;
      this.stats.spawned++;
      return this.addAt(veh, link, s, Math.min(link.vmax, 6));
    }
    return null;
  }

  removeVeh(veh) {
    this.junctions.releaseAll(veh);
    veh.alive = false;
    let i = this.cars.indexOf(veh);
    if (i >= 0) this.cars.splice(i, 1);
    i = this.all.indexOf(veh);
    if (i >= 0) this.all.splice(i, 1);
    this.stats.removed++;
  }

  /** Jaga jumlah kendaraan di sekitar shuttle. Dipanggil dua kali per detik simulasi. */
  balance(hidden) {
    const f = this.app.focus;
    let near = 0;
    for (const c of this.cars) {
      const d = Math.hypot(c.x - f.x, c.z - f.y);
      // terlalu jauh dari shuttle dan tidak sedang di persimpangan: memudar lalu dihapus
      if (d > this.radius + 20 && c.fade >= 0 && !c.grants.length && c.link.kind === 'lane' && !c.leader) c.fade = -1;
      if (c.fade >= 0) near++;
    }
    if (near < this.target) this.spawnNear(90, this.radius - 20, hidden);
  }

  /** Kendaraan yang lama diam (bukan karena lampu atau halte) dianggap macet dan dihapus pelan-pelan. */
  watchdog() {
    for (const v of this.cars) {
      if (v.stuckT > 60 && v.fade >= 0 && v.planReason !== 'lampu-merah' && v.planReason !== 'lampu-kuning') {
        v.fade = -1;
        this.stats.recovered++;
      }
    }
  }

  /** Perbarui tampilan muncul atau hilang (alpha). Kendaraan yang sudah hilang dihapus. */
  updateFades(dt) {
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      if (c.fade > 0) {
        c.alpha = Math.min(1, c.alpha + dt / 0.8);
        if (c.alpha >= 1) c.fade = 0;
      } else if (c.fade < 0) {
        c.alpha -= dt / 0.8;
        if (c.alpha <= 0) this.removeVeh(c);
      }
    }
  }

  // ===== rencana jalur =====

  /** Kendaraan lain: perpanjang rencana dengan belokan acak sampai 90 m ke depan. */
  extendPath(veh) {
    if (veh.route) return this.extendRoute(veh);
    const rng = this.app.rng;
    let guard = 0;
    while (guard++ < 20) {
      const last = veh.path.length ? veh.path[veh.path.length - 1] : veh.link;
      const endsInRing = last.ring !== null || (last.kind === 'conn' && (last.ringc || last.entry));
      const storable = last.kind === 'lane' && (last.portal === 'out' || last.len >= veh.len + 2.5);
      if (veh.link.len - veh.s + veh.pathLen > 90 && !endsInRing && storable) break;
      const nexts = last.next;
      if (!nexts.length) break;
      let pick;
      if (nexts.length === 1) pick = nexts[0];
      else {
        let tot = 0;
        const ws = WEIGHTS;
        ws.length = 0;
        for (const n of nexts) {
          let w = n.kind === 'conn' ? (n.move === 'S' ? 1 : n.move === 'U' ? 0.12 : 0.7) : 1;
          if (n.kind === 'conn' && (n.to === veh.link || veh.path.includes(n.to))) w *= 0.02;
          if (n.closed) w = 0;
          if (n.kind === 'conn' && n.to.private) w *= 0.35;
          if (n.kind === 'conn' && n.to.closed) w = 0;
          // jalan keluar area peta dihindari supaya lalu lintas tetap di sekitar kampus
          if (n.kind === 'conn' && n.to.portal === 'out') w *= 0.1;
          ws.push(w);
          tot += w;
        }
        if (tot <= 0) pick = nexts.find((n) => !(n.kind === 'conn' && n.to.closed)) || nexts[0];
        else {
          let r = rng() * tot;
          pick = nexts[nexts.length - 1];
          for (let i = 0; i < nexts.length; i++) {
            r -= ws[i];
            if (r <= 0) {
              pick = nexts[i];
              break;
            }
          }
        }
      }
      veh.path.push(pick);
      veh.pathLen += pick.len;
    }
  }

  /** Shuttle (dan angkot pelan di langkah hujan): ambil link berikutnya dari rute tetap. */
  extendRoute(veh) {
    while (veh.route.length && veh.link.len - veh.s + veh.pathLen < 160) {
      const l = veh.route.shift();
      veh.path.push(l);
      veh.pathLen += l.len;
    }
    // rute habis: kendaraan lain kembali memilih belokan acak
    if (!veh.route.length && !veh.ego) {
      veh.route = null;
      this.extendPath(veh);
    }
  }

  // ===== indeks per link =====

  beginTick() {
    for (const l of this.touched) l.occN = 0;
    this.touched.length = 0;
    this.poolN = 0;
    for (const veh of this.all) {
      this.occAdd(veh.link, veh, veh.s);
      const rear = veh.s - veh.len / 2;
      if (rear < 0 && veh.prevLink) this.occAdd(veh.prevLink, veh, veh.s + veh.prevLink.len);
      const front = veh.s + veh.len / 2;
      if (front > veh.link.len && veh.path[0]) this.occAdd(veh.path[0], veh, veh.s - veh.link.len);
    }
  }

  occAdd(link, veh, s) {
    let e = this.pool[this.poolN];
    if (!e) {
      e = { veh: null, s: 0 };
      this.pool.push(e);
    }
    this.poolN++;
    e.veh = veh;
    e.s = s;
    if (!link.occN) {
      link.occN = 0;
      this.touched.push(link);
    }
    link.occ[link.occN++] = e;
  }

  // ===== langkah fisika =====

  /** Fase 1: catat pendekatan dan permintaan izin persimpangan untuk semua kendaraan. */
  requestAll() {
    const J = this.junctions;
    for (const veh of this.all) {
      this.extendPath(veh);
      const front = veh.s + veh.len / 2;
      let base = veh.link.len - front;
      let requested = false;
      for (let i = 0; i < veh.path.length; i++) {
        const l = veh.path[i];
        if (base > 70) break;
        if (l.kind === 'conn' && !J.hasGrant(veh, l)) {
          J.addApproach(veh, l, base);
          if (!requested) {
            requested = true;
            const reqD = Math.max(12, (veh.v * veh.v) / (2 * 1.4) + 8);
            const from = l.from;
            let sigOk = true;
            if (from.sig) {
              const col = from.sig.ctl.color(from.sig.arm);
              sigOk = col === 'green' || (col === 'yellow' && committedGo(veh, from.sig.ctl));
            }
            if (base < reqD && sigOk && !veh.holdAtHalte) J.addRequest(veh, l, base);
          }
        }
        base += l.len;
      }
    }
  }

  /** Fase 2: rencana, perisai, dan gerak untuk tiap kendaraan. */
  stepAll(dt) {
    const app = this.app;
    const mu = app.mu;
    const wx = WEATHER_SPEED[app.weather] || 1;
    for (let i = 0; i < this.all.length; i++) {
      const veh = this.all[i];
      if (!veh.alive) continue;
      this.stepVehicle(veh, dt, mu, wx);
    }
    for (let i = this.all.length - 1; i >= 0; i--) {
      const veh = this.all[i];
      if (veh.exitNow) {
        veh.exitNow = false;
        if (!veh.ego) this.removeVeh(veh);
      }
    }
  }

  stepVehicle(veh, dt, mu, wx) {
    const app = this.app;
    const J = this.junctions;
    const p = veh.ego && app.weather === 'hujan' ? SHUTTLE_WET : veh.dyn;
    const front = veh.s + veh.len / 2;
    let v0 = Math.min(veh.vDesBase * (veh.ego ? 1 : wx), SHIELD.vMaxGlobal, veh.link.vmax, veh.ego ? app.egoSpeedLimit() : Infinity);
    let aPlan = idm(veh.v, v0, Infinity, 0, p);
    let reason = '';
    let hardStop = Infinity;
    let leaderGap = Infinity;
    let leaderV = 0;
    let leaderVeh = null;
    const horizon = Math.max(70, veh.v * 7);
    let base = -front;
    let link = veh.link;
    let k = -1;
    const aComf = Math.min(p.b, 0.5 * brakeLimit(veh, mu));
    const ego = veh.ego;
    const vCap = ego ? app.egoSpeedLimit() : Infinity;
    while (link) {
      // batas kecepatan link dan tikungan di depan
      {
        const vl = Math.min(link.vmax, SHIELD.vMaxGlobal, vCap);
        if (k >= 0 && veh.v > vl) {
          const d = Math.max(base, 0.5);
          if (veh.v * veh.v > vl * vl + 2 * aComf * d * 0.9) {
            const a = (vl * vl - veh.v * veh.v) / (2 * d);
            if (a < aPlan) {
              aPlan = a;
              reason = 'tikungan';
            }
          }
        }
        for (let i = 0; i < link.spdS.length; i++) {
          const d = base + link.spdS[i];
          if (d < -veh.len / 2) continue;
          const vl2 = link.spdV[i];
          if (veh.v <= vl2) continue;
          const dd = Math.max(d, 0.5);
          if (veh.v * veh.v > vl2 * vl2 + 2 * aComf * dd * 0.9) {
            const a = (vl2 * vl2 - veh.v * veh.v) / (2 * dd);
            if (a < aPlan) {
              aPlan = a;
              reason = 'tikungan';
            }
          }
        }
      }
      // kendaraan di depan pada link ini
      for (let i = 0; i < link.occN; i++) {
        const o = link.occ[i];
        const W = o.veh;
        if (W === veh) continue;
        if (k < 0 && o.s <= veh.s) continue;
        const gap = base + o.s - W.len / 2;
        if (gap < -0.5 && k < 0) continue;
        if (gap < leaderGap) {
          leaderGap = gap;
          leaderV = W.v;
          leaderVeh = W;
        }
      }
      if (link.kind === 'conn') {
        const sibs = link.from.next;
        for (let si = 0; si < sibs.length; si++) {
          const sib = sibs[si];
          if (sib === link) continue;
          for (let i = 0; i < sib.occN; i++) {
            const o = sib.occ[i];
            if (o.veh === veh) continue;
            const r = o.s - o.veh.len / 2;
            const sep = link.sibSep ? link.sibSep.get(sib) : undefined;
            if (r > (sep === undefined ? 9 : Math.max(3, sep))) continue;
            const gap = base + r;
            if (gap > -0.5 && gap < leaderGap) {
              leaderGap = gap;
              leaderV = o.veh.v;
              leaderVeh = o.veh;
            }
          }
        }
        // belum diberi izin masuk persimpangan: berhenti di garis
        if (!J.hasGrant(veh, link)) {
          const d = base - 0.3;
          if (d < hardStop) hardStop = Math.max(0, d);
          const a = stopAt(veh.v, Math.max(0, d), p);
          if (a < aPlan) {
            aPlan = a;
            reason = link.rank > 0 ? 'memberi-jalan' : 'menunggu-simpang';
          }
          break;
        }
      }
      // zona lajur: tanpa izin keluar dari lajur ini, kendaraan menunggu sebelum zona di ujung lajur
      if (link.zones && link.stopLen < link.len) {
        const nx = k + 1 < veh.path.length ? veh.path[k + 1] : null;
        const d = base + link.stopLen;
        if (d > -0.05 && !(nx && nx.kind === 'conn' && J.hasGrant(veh, nx))) {
          const dd = Math.max(0, d - 0.3);
          if (dd < hardStop) hardStop = dd;
          const a = stopAt(veh.v, dd, p);
          if (a < aPlan) {
            aPlan = a;
            reason = 'menunggu-simpang';
          }
        }
      }
      // lampu lalu lintas di ujung lajur
      if (link.sig) {
        const d = base + link.len;
        if (d > -0.05) {
          const dWait = base + Math.min(link.len, link.stopLen);
          const dStop = dWait > -0.05 ? dWait : d;
          const ctl = link.sig.ctl;
          const col = ctl.color(link.sig.arm);
          let stop = false;
          if (col === 'red') stop = true;
          else if (col === 'yellow') {
            const lEta = leaderGap < d ? (d + 2) / Math.max(leaderV, 0.5) : 0;
            const dec = yellowDecision(veh, ctl, link.sig.arm, dWait > -0.05 ? dWait : -1, mu, lEta, d);
            if (dec === 'stop') {
              stop = true;
              J.cancelUnused(veh);
            }
          }
          if (stop) {
            const dd = dStop - SHIELD.gapStop - 0.2;
            const a = stopAt(veh.v, Math.max(0, dd), p);
            if (a < aPlan) {
              aPlan = a;
              reason = col === 'red' ? 'lampu-merah' : 'lampu-kuning';
            }
          } else if (col === 'yellow' && d < 40 && !reason) reason = 'kuning-terus';
        }
      }
      // zebra cross yang dipakai pejalan kaki
      for (let i = 0; i < link.xings.length; i++) {
        const xg = link.xings[i];
        if (!xg.x.reserved.size) continue;
        const d = base + xg.s0 - SHIELD.gapCrossing - 0.3;
        if (base + xg.s0 < -0.2) continue;
        const a = stopAt(veh.v, Math.max(0, d), p);
        if (a < aPlan) {
          aPlan = a;
          reason = 'zebra';
        }
      }
      // titik henti halte (shuttle)
      if (veh.stopTarget && veh.stopTarget.link === link) {
        const d = base + veh.stopTarget.s + veh.len / 2;
        if (d > -0.5) {
          const a = stopAt(veh.v, Math.max(0, d), p);
          if (a < aPlan) {
            aPlan = a;
            reason = 'halte';
          }
          if (d < hardStop) hardStop = Math.max(0, d);
        }
      }
      base += link.len;
      if (base > horizon) break;
      k++;
      link = veh.path[k];
      // ujung rencana (misalnya tidak ada rute): berhenti sebelum ujung lajur terakhir
      if (!link && base < horizon) {
        const d = Math.max(0, base - 1);
        if (d < hardStop) hardStop = d;
        const a = stopAt(veh.v, d, p);
        if (a < aPlan) {
          aPlan = a;
          reason = 'buntu';
        }
      }
    }
    if (leaderGap < Infinity) {
      const a = idm(veh.v, v0, leaderGap - 0.4, veh.v - leaderV, p);
      if (a < aPlan) {
        aPlan = a;
        reason = 'mengikuti';
      }
    }
    // uji saja: pengemudi "buta" menginjak gas penuh terus (meniru pengemudi manual yang nekat).
    // Dipakai uji model untuk membuktikan perisai sendiri sudah cukup menjaga aturan keras.
    if (app.faults && app.faults.plannerBlind && (veh.ego || app.faults.all)) aPlan = p.aMax;
    veh.planReason = reason;
    veh.leaderGap = leaderGap;
    veh.leaderV = leaderV;
    veh.leaderVeh = leaderVeh;
    veh.aPlan = aPlan;
    // ===== perisai keselamatan =====
    const cons = nearestConstraint(veh, mu, veh.cons);
    const aAllow = allowedAccel(veh, cons.d, mu, dt);
    const aB = brakeLimit(veh, mu);
    let a = Math.min(aPlan, aAllow);
    const shieldActive = aAllow < aPlan - 0.3 && aAllow < 0.5;
    if (shieldActive && !veh.shieldOn) {
      veh.shieldEvents++;
      if (app.onShield) app.onShield(veh, cons);
    }
    veh.shieldOn = shieldActive;
    a = clamp(a, -aB, p.aMax);
    // ===== gerak =====
    const vOld = veh.v;
    let vNew = Math.max(0, vOld + a * dt);
    let ds = ((vOld + vNew) / 2) * dt;
    if (cons.d !== Infinity && ds > Math.max(0, cons.d)) {
      if (ds - Math.max(0, cons.d) > 0.01) {
        this.stats.clamps++;
        if (app.onClamp) app.onClamp(veh, cons);
      }
      ds = Math.max(0, cons.d);
      vNew = 0;
    }
    if (ds > hardStop) {
      if (ds - hardStop > 0.02) this.stats.lineClamps++;
      ds = hardStop;
      vNew = Math.min(vNew, hardStop < 0.05 ? 0 : vNew);
    }
    if (leaderGap < Infinity && ds > leaderGap - 0.25) {
      const lim = Math.max(0, leaderGap - 0.25);
      if (ds - lim > 0.01) this.stats.followClamps++;
      ds = lim;
      vNew = Math.min(vNew, leaderV);
    }
    veh.a = ds > 0 || vNew > 0 ? a : Math.min(a, 0);
    veh.braking = a < -0.5 || (vNew < 0.2 && aPlan < 0);
    veh.v = vNew;
    veh.s += ds;
    veh.odo += ds;
    while (veh.s > veh.link.len) {
      const nxt = veh.path.shift();
      if (!nxt) {
        veh.s = veh.link.len;
        veh.v = 0;
        if (veh.link.portal === 'out' && !veh.ego) veh.exitNow = true;
        break;
      }
      veh.s -= veh.link.len;
      veh.pathLen -= nxt.len;
      veh.prevLink = veh.link;
      veh.link = nxt;
      if (veh.rbExit && nxt === veh.rbExit) veh.rbExit = null;
    }
    if (veh.link.portal === 'out' && !veh.ego && veh.s > veh.link.len - veh.len / 2 - 0.3) veh.exitNow = true;
    J.releasePassed(veh);
    if (veh.grants.length && veh.v < 0.05) {
      veh.idleGrantT += dt;
      if (veh.idleGrantT > 1.5) J.cancelUnused(veh);
    } else veh.idleGrantT = 0;
    const waitingOk = reason === 'lampu-merah' || reason === 'lampu-kuning' || reason === 'halte' || veh.holdAtHalte;
    veh.stuckT = veh.v < 0.1 && !waitingOk ? veh.stuckT + dt : 0;
    veh.updatePose();
  }

  /** Tumpang tindih antarkendaraan (jejak kotak). Seharusnya selalu 0. */
  checkOverlaps() {
    const all = this.all;
    const now = this.overlapNow;
    now.clear();
    let fresh = 0;
    for (let i = 0; i < all.length; i++) {
      const a = all[i];
      for (let j = i + 1; j < all.length; j++) {
        const b = all[j];
        const dx = a.x - b.x;
        const dz = a.z - b.z;
        const r = (a.len + b.len) / 2;
        if (dx * dx + dz * dz > r * r) continue;
        if (boxesOverlap(shrunk(a), shrunk(b))) {
          const key = a.id < b.id ? a.id * 100000 + b.id : b.id * 100000 + a.id;
          now.add(key);
          if (!this.overlapPairs.has(key)) {
            this.stats.overlaps++;
            fresh++;
          }
        }
      }
    }
    const t = this.overlapPairs;
    this.overlapPairs = now;
    this.overlapNow = t;
    return fresh;
  }
}
