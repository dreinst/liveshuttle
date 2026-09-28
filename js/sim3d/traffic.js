// Lalu lintas: mobil, MPV, angkot, pikap, dan sepeda motor (NPC) yang berjalan di graf lajur OSM.
// LiveShuttle punya otak sendiri (ego.js), tetapi tetap tercatat di data okupansi dan izin persimpangan
// yang sama sehingga NPC dan pejalan kaki memperhitungkannya.
//
// Tiap langkah fisika (1/60 detik) setiap kendaraan:
// 1. memperpanjang rencana jalur (NPC: belokan acak; shuttle: rute A* ke halte berikutnya),
// 2. mencatat diri sebagai "mendekat" dan, bila cukup dekat, meminta izin masuk persimpangan,
// 3. menghitung percepatan rencana (IDM: mengikuti kendaraan di depan, batas kecepatan tikungan,
//    berhenti di garis bila belum diberi izin, lampu merah, lampu kuning, zebra cross terpakai),
// 4. melewati perisai keselamatan (shield.js), lalu
// 5. bergerak, dengan penjepitan keras supaya tidak pernah menembus kendaraan di depan, garis henti
//    tanpa izin, atau batasan perisai.
import * as THREE from '../vendor/three.bundle.min.js';
import { VEHICLE_MODELS, VEHICLE_DIMS } from './models/index.js';
import { SHIELD, brakeLimit, nearestConstraint, allowedAccel, newConstraint, yellowDecision, committedGo } from './shield.js';
import { clamp } from './util.js';

/** Parameter dinamika per jenis (percepatan maks, perlambatan maks yang bisa dicapai model, IDM). */
export const DYN = {
  car: { aMax: 1.6, aBrake: 7.0, b: 2.0, T: 1.2, s0: 2.0, vDes: [8.6, 11.1] },
  mpv: { aMax: 1.4, aBrake: 6.8, b: 2.0, T: 1.3, s0: 2.0, vDes: [8.3, 10.8] },
  angkot: { aMax: 1.2, aBrake: 6.5, b: 1.8, T: 1.4, s0: 2.2, vDes: [7.5, 9.7] },
  pickup: { aMax: 1.2, aBrake: 6.3, b: 1.8, T: 1.4, s0: 2.2, vDes: [7.8, 9.7] },
  motorbike: { aMax: 2.0, aBrake: 6.5, b: 2.2, T: 1.0, s0: 1.6, vDes: [8.9, 11.1] },
  shuttle: { aMax: 1.0, aBrake: 5.5, b: 1.6, T: 1.5, s0: 2.5, vDes: [8.33, 8.33] },
};

const MIX = [
  ['motorbike', 0.4],
  ['car', 0.25],
  ['mpv', 0.15],
  ['angkot', 0.12],
  ['pickup', 0.08],
];

const WEATHER_SPEED = { cerah: 1, hujan: 0.8, kabut: 0.7, malam: 0.9 };

function idm(v, v0, gap, dv, p) {
  const free = 1 - Math.pow(v / Math.max(v0, 0.1), 4);
  if (gap === Infinity) return p.aMax * free;
  const sStar = p.s0 + Math.max(0, v * p.T + (v * dv) / (2 * Math.sqrt(p.aMax * p.b)));
  const g = Math.max(gap, 0.05);
  return p.aMax * (free - (sStar / g) * (sStar / g));
}

/** Berhenti tepat di titik: perlambatan konstan yang dibutuhkan, dibatasi percepatan maks. */
function stopAt(v, d, p) {
  if (d <= 0.05) return -p.aBrake;
  const need = (v * v) / (2 * d);
  // mulai mengerem sedikit lebih awal dari batas nyaman, pelan mendekat bila masih jauh
  if (need > p.b * 0.6) return -Math.min(p.aBrake, need * 1.05);
  return idm(v, Math.min(v + 2, Math.sqrt(2 * p.b * 0.6 * d) + 0.3), d, v, { ...p, s0: 0.3, T: 0.6 });
}

let nextVehId = 1;

export class Vehicle {
  constructor(type, opts = {}) {
    this.id = nextVehId++;
    this.type = type;
    const D = VEHICLE_DIMS[type];
    this.len = D.len;
    this.wid = D.wid;
    this.hw = D.wid / 2;
    this.dyn = DYN[type];
    this.rng = opts.rng || Math.random;
    this.vDesBase = this.dyn.vDes[0] + (this.dyn.vDes[1] - this.dyn.vDes[0]) * this.rng();
    this.link = null;
    this.s = 0;
    this.v = 0;
    this.a = 0;
    this.lat = type === 'motorbike' ? -0.45 + this.rng() * 0.25 : 0;
    this.latBase = this.lat;
    this.psi = 0; // beda arah terhadap garis lajur (saat melewati penghalang)
    this.pass = null; // rencana melewati penghalang (passing.js)
    this.path = [];
    this.pathLen = 0;
    this.odo = 0;
    this.grants = [];
    this.reqConn = null;
    this.reqT = 0;
    this.reqDist = 0;
    this.rbExit = null;
    this.rbExitPending = null;
    this.x = 0;
    this.z = 0;
    this.h = 0;
    this.px = 0;
    this.pz = 0;
    this.ph = 0;
    this.braking = false;
    this.blink = 0;
    this.stuckT = 0;
    this.shieldOn = false;
    this.shieldEvents = 0;
    this.cons = newConstraint();
    this.sigKey = 0;
    this.sigArmCtl = null;
    this.sigDecision = '';
    this.color = null;
    this.ego = !!opts.ego;
    this.route = null; // untuk shuttle: rute tetap (link) dari A*
    this.alive = true;
    this.lastReason = '';
  }

  footprint() {
    return { x: this.x, z: this.z, h: this.h, hl: this.len / 2, hw: this.hw };
  }

  place(link, s, v) {
    this.link = link;
    this.s = s;
    this.v = v;
    this.path.length = 0;
    this.pathLen = 0;
    this.updatePose();
    this.px = this.x;
    this.pz = this.z;
    this.ph = this.h;
  }

  updatePose() {
    const o = this.link.poly.atSmooth(this.s, TMP);
    const h = o.h;
    this.x = o.x - Math.sin(h) * this.lat;
    this.z = o.z + Math.cos(h) * this.lat;
    this.h = h + this.psi;
  }
}

const TMP = {};

export class Traffic {
  constructor(app) {
    this.app = app;
    this.city = app.city;
    this.cars = []; // NPC
    this.all = []; // NPC + shuttle
    this.target = 42;
    this.max = 70;
    this.outside = []; // kendaraan yang keluar peta dan menunggu masuk lagi
    this.touched = [];
    this.pool = [];
    this.poolN = 0;
    this.stats = { overlaps: 0, offRoad: 0, clamps: 0, followClamps: 0, recovered: 0, stuckMax: 0, exits: 0, entries: 0, lineClamps: 0, dilemma: 0 };
    this.overlapPairs = new Set();
    this.overlapNow = new Set();
    this.offRoadSet = new Set();
    this.tick = 0;
    this.buildRenderers();
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
    const veh = new Vehicle(type, { rng: this.app.rng });
    const pal = VEHICLE_MODELS[type].PALETTE;
    veh.color = new THREE.Color(pal[Math.floor(this.app.rng() * pal.length)]);
    return veh;
  }

  // ===== muncul, keluar, dan masuk lagi =====

  /** Apakah posisi (link, s) aman untuk memunculkan kendaraan sepanjang len? */
  spawnFree(link, s, len, margin) {
    const lo = s - len / 2 - margin;
    const hi = s + len / 2 + margin;
    for (const w of this.all) {
      if (w.link === link && w.s + w.len / 2 > lo && w.s - w.len / 2 < hi) return false;
      for (let i = 0; i < w.path.length && i < 2; i++) if (w.path[i] === link && hi > 0 && w.link.len - w.s < margin + len) return false;
    }
    // jangan muncul di atas atau tepat sebelum zebra cross yang dipakai
    for (const xg of link.xings) if (xg.x.reserved.size && xg.s1 > lo - 20 && xg.s0 < hi + 25) return false;
    for (const xg of link.xings) if (xg.s1 > lo - 2 && xg.s0 < hi + 2) return false;
    // jangan terlalu dekat dengan garis henti lampu atau di zona ujung lajur
    if (link.sig && link.len - hi < 25) return false;
    if (link.kind === 'lane' && hi > link.stopLen - 1) return false;
    // tidak ada pejalan kaki di dekatnya
    for (let i = 0; i < link.pedN; i++) {
      const pe = link.peds[i];
      if (pe.s > lo - 25 && pe.s < hi + 30) return false;
    }
    return true;
  }

  addAt(veh, link, s, v) {
    veh.place(link, s, v);
    this.extendPath(veh);
    this.cars.push(veh);
    this.all.push(veh);
    return veh;
  }

  spawnRandom(minDistFromEgo) {
    const lanes = this.city.spawnLanes;
    const app = this.app;
    for (let tries = 0; tries < 30; tries++) {
      const link = lanes[Math.floor(app.rng() * lanes.length)];
      const type = this.pickType();
      const len = VEHICLE_DIMS[type].len;
      const s = 6 + len / 2 + app.rng() * (link.len - 20 - len);
      if (s < len / 2 + 2 || s > link.len - len / 2 - 8) continue;
      const p = link.poly.at(s, TMP);
      if (minDistFromEgo && app.ego && Math.hypot(p.x - app.ego.x, p.z - app.ego.z) < minDistFromEgo) continue;
      if (!this.spawnFree(link, s, len, 9)) continue;
      const veh = this.makeNpc(type);
      return this.addAt(veh, link, s, Math.min(link.vmax, 6));
    }
    return null;
  }

  /** Kendaraan dari luar peta masuk lewat ujung lajur di tepi peta. */
  enterFromPortal(veh) {
    const lanes = this.city.portalIn;
    const app = this.app;
    for (let tries = 0; tries < 6; tries++) {
      const link = lanes[Math.floor(app.rng() * lanes.length)];
      const s = veh.len / 2 + 0.5;
      if (!this.spawnFree(link, s, veh.len, 14)) continue;
      veh.alive = true;
      veh.grants.length = 0;
      veh.reqConn = null;
      veh.rbExit = null;
      veh.stuckT = 0;
      this.addAt(veh, link, s, Math.min(link.vmax, 7));
      this.stats.entries++;
      return true;
    }
    return false;
  }

  removeVeh(veh) {
    this.app.junctions.releaseAll(veh);
    veh.alive = false;
    let i = this.cars.indexOf(veh);
    if (i >= 0) this.cars.splice(i, 1);
    i = this.all.indexOf(veh);
    if (i >= 0) this.all.splice(i, 1);
  }

  exitMap(veh) {
    this.removeVeh(veh);
    this.stats.exits++;
    if (this.cars.length + this.outside.length < this.target) this.outside.push({ veh, t: this.app.simTime + 2 + this.app.rng() * 8 });
  }

  balance() {
    const app = this.app;
    // masuk lagi dari tepi peta
    for (let i = this.outside.length - 1; i >= 0; i--) {
      const o = this.outside[i];
      if (app.simTime < o.t) continue;
      if (this.enterFromPortal(o.veh)) this.outside.splice(i, 1);
      else o.t = app.simTime + 1.5;
    }
    const total = this.cars.length + this.outside.length;
    if (total < this.target) {
      if (app.rng() < 0.5 && this.city.portalIn.length) {
        const veh = this.makeNpc(this.pickType());
        this.outside.push({ veh, t: app.simTime });
      } else this.spawnRandom(90);
    } else if (this.cars.length > this.target + 2) {
      // kurangi dari yang terjauh dan tidak sedang di persimpangan
      let far = null;
      let fd = 0;
      for (const c of this.cars) {
        if (c.grants.length || c.link.kind !== 'lane') continue;
        const d = Math.hypot(c.x - app.focus.x, c.z - app.focus.z);
        if (d > fd) {
          fd = d;
          far = c;
        }
      }
      if (far && fd > 120) this.removeVeh(far);
    }
  }

  // ===== rencana jalur =====

  /** NPC: perpanjang rencana dengan belokan acak sampai 90 m ke depan dan tidak berhenti di cincin. */
  extendPath(veh) {
    if (veh.route) return this.extendRoute(veh);
    const rng = this.app.rng;
    let guard = 0;
    while (guard++ < 20) {
      const last = veh.path.length ? veh.path[veh.path.length - 1] : veh.link;
      const endsInRing = last.ring !== null || (last.kind === 'conn' && (last.ringc || last.entry));
      // rencana selalu berakhir di lajur yang bisa menampung kendaraan (bukan lajur pendek di antara
      // dua persimpangan), supaya rantai izin persimpangan selalu punya ujung
      const storable = last.kind === 'lane' && (last.portal === 'out' || last.len >= veh.len + 2.5);
      if (veh.link.len - veh.s + veh.pathLen > 90 && !endsInRing && storable) break;
      const nexts = last.next;
      if (!nexts.length) break; // ujung peta
      let pick;
      if (nexts.length === 1) pick = nexts[0];
      else {
        let tot = 0;
        const ws = WEIGHTS;
        ws.length = 0;
        for (const n of nexts) {
          let w = n.kind === 'conn' ? (n.move === 'S' ? 1 : n.move === 'U' ? 0.12 : 0.7) : 1;
          // jangan kembali ke lajur yang sudah ada di rencana (misalnya memutari bundaran penuh)
          if (n.kind === 'conn' && (n.to === veh.link || veh.path.includes(n.to))) w *= 0.02;
          if (n.closed) w = 0;
          if (n.kind === 'conn' && n.to.private) w *= 0.35;
          if (n.kind === 'conn' && n.to.closed) w = 0;
          ws.push(w);
          tot += w;
        }
        if (tot <= 0) pick = nexts[0];
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

  /** Shuttle: ambil link berikutnya dari rute tetap. */
  extendRoute(veh) {
    while (veh.route.length && veh.link.len - veh.s + veh.pathLen < 160) {
      const l = veh.route.shift();
      veh.path.push(l);
      veh.pathLen += l.len;
    }
  }

  /**
   * Jalan ditutup: potong rencana NPC di link tertutup pertama yang belum diizinkan dan masih cukup
   * jauh untuk berhenti. Rencana lalu diperpanjang lagi lewat jalan lain.
   */
  onRoadChange() {
    const J = this.app.junctions;
    for (const veh of this.cars) {
      let base = veh.link.len - veh.s - veh.len / 2;
      for (let i = 0; i < veh.path.length; i++) {
        const l = veh.path[i];
        if (l.closed && base > (veh.v * veh.v) / 4 + 3) {
          let cut = i;
          if (l.kind === 'conn' && J.hasGrant(veh, l)) break;
          if (l.kind === 'lane' && i > 0 && veh.path[i - 1].kind === 'conn') {
            if (J.hasGrant(veh, veh.path[i - 1])) break;
            cut = i - 1;
          }
          veh.path.length = cut;
          let L = 0;
          for (const q of veh.path) L += q.len;
          veh.pathLen = L;
          veh.reqConn = null;
          break;
        }
        base += l.len;
      }
    }
  }

  // ===== indeks per link =====

  beginTick() {
    for (const l of this.touched) l.occN = 0;
    this.touched.length = 0;
    this.poolN = 0;
    for (const veh of this.all) {
      if (veh.manual) {
        this.app.ego.registerManual(this);
        continue;
      }
      this.occAdd(veh.link, veh, veh.s);
      const rear = veh.s - veh.len / 2;
      if (rear < 0 && veh.prevLink) this.occAdd(veh.prevLink, veh, veh.s + veh.prevLink.len);
      const front = veh.s + veh.len / 2;
      if (front > veh.link.len && veh.path[0]) this.occAdd(veh.path[0], veh, veh.s - veh.link.len);
    }
    // kendaraan parkir, galian, dan bagian lajur lawan yang sedang dipesan untuk menyalip
    if (this.app.obstacles) this.app.obstacles.register(this);
    if (this.app.passing) this.app.passing.register(this);
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
    const J = this.app.junctions;
    for (const veh of this.all) {
      if (veh.manual) continue;
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
          // izin berikutnya baru diminta setelah konektor ini diizinkan, tetapi pendekatan tetap dicatat
        }
        base += l.len;
      }
    }
  }

  /** Fase 2: rencana, perisai, dan gerak untuk tiap kendaraan. */
  stepAll(dt) {
    const app = this.app;
    const mu = app.weather.mu;
    const wx = WEATHER_SPEED[app.weather.name] || 1;
    for (let i = 0; i < this.all.length; i++) {
      const veh = this.all[i];
      if (!veh.alive || veh.ego) continue;
      this.stepVehicle(veh, dt, mu, wx);
    }
    // kendaraan yang keluar peta
    for (let i = this.all.length - 1; i >= 0; i--) {
      const veh = this.all[i];
      if (veh.exitNow) {
        veh.exitNow = false;
        if (veh.ego) continue;
        this.exitMap(veh);
      }
    }
  }

  stepVehicle(veh, dt, mu, wx) {
    const app = this.app;
    const J = app.junctions;
    const p = veh.dyn;
    const front = veh.s + veh.len / 2;
    let v0 = Math.min(veh.vDesBase * wx, SHIELD.vMaxGlobal, veh.link.vmax);
    if (veh.pass) v0 = Math.min(v0, veh.pass.vMax);
    let aPlan = idm(veh.v, v0, Infinity, 0, p);
    let reason = '';
    let hardStop = Infinity; // jarak maksimum bumper depan boleh maju (penjepitan perencana)
    let leaderGap = Infinity;
    let leaderV = 0;
    let leaderW = null;
    const horizon = Math.max(70, veh.v * 7);
    let base = -front;
    let link = veh.link;
    let k = -1;
    veh.blink = 0;
    const aComf = Math.min(p.b, 0.5 * brakeLimit(veh, mu));
    while (link) {
      // batas kecepatan link dan tikungan di depan
      {
        const vl = Math.min(link.vmax, SHIELD.vMaxGlobal);
        if (k >= 0 && veh.v > vl) {
          const d = Math.max(base, 0.5);
          if (veh.v * veh.v > vl * vl + 2 * aComf * d * 0.9) aPlan = Math.min(aPlan, (vl * vl - veh.v * veh.v) / (2 * d));
        }
        for (let i = 0; i < link.spdS.length; i++) {
          const d = base + link.spdS[i];
          if (d < -veh.len / 2) continue;
          const vl2 = link.spdV[i];
          if (veh.v <= vl2) continue;
          const dd = Math.max(d, 0.5);
          if (veh.v * veh.v > vl2 * vl2 + 2 * aComf * dd * 0.9) aPlan = Math.min(aPlan, (vl2 * vl2 - veh.v * veh.v) / (2 * dd));
        }
      }
      // kendaraan di depan pada link ini
      for (let i = 0; i < link.occN; i++) {
        const o = link.occ[i];
        const W = o.veh;
        if (W === veh) continue;
        if (W.obstacle && veh.pass && veh.pass.ob === W.obstacle) continue;
        if (W.manualProxy && k < 0) {
          // shuttle yang dikemudikan manual bisa berada miring di lajur ini: berhenti bila badannya
          // menjorok di depan bumper depan kendaraan ini
          if (o.s + W.len / 2 <= veh.s + veh.len / 2 - 0.2) continue;
          const gap = Math.max(0, base + o.s - W.len / 2);
          if (gap < leaderGap) {
            leaderGap = gap;
            leaderV = 0;
            leaderW = W;
          }
          continue;
        }
        if (k < 0 && o.s <= veh.s) continue;
        const gap = base + o.s - W.len / 2;
        if (gap < -0.5 && k < 0) continue;
        if (gap < leaderGap) {
          leaderGap = gap;
          leaderV = W.v;
          leaderW = W;
        }
      }
      // konektor: kendaraan di konektor saudara (berpisah dari lajur yang sama) di awal konektor
      if (link.kind === 'conn') {
        const sibs = link.from.next;
        for (let si = 0; si < sibs.length; si++) {
          const sib = sibs[si];
          if (sib === link) continue;
          for (let i = 0; i < sib.occN; i++) {
            const o = sib.occ[i];
            if (o.veh === veh) continue;
            const r = o.s - o.veh.len / 2;
            // hanya selama jalur konektor saudara masih berdekatan dengan jalur kendaraan ini
            const sep = link.sibSep ? link.sibSep.get(sib) : undefined;
            if (r > (sep === undefined ? 9 : Math.max(3, sep))) continue;
            const gap = base + r;
            if (gap > -0.5 && gap < leaderGap) {
              leaderGap = gap;
              leaderV = o.veh.v;
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
          if (!veh.blink && link.move === 'L') veh.blink = -1;
          if (!veh.blink && link.move === 'R') veh.blink = 1;
          break; // lebih jauh dari garis ini tidak relevan
        }
        if (!veh.blink && base < 40 && link.move === 'L') veh.blink = -1;
        if (!veh.blink && base < 40 && link.move === 'R') veh.blink = 1;
      }
      // zona lajur: tanpa izin keluar dari lajur ini, kendaraan menunggu SEBELUM zona di ujung lajur
      // (bukan di garis ujung), karena konektor lain lewat sangat dekat dengan ujung lajur itu.
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
      // lampu lalu lintas di ujung lajur. Kendaraan menunggu di titik henti (garis henti, atau
      // sebelum zona lajur bila ada, lihat City.computeLaneZones)
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
            // yang sudah melewati titik tunggu (di zona) sebisa mungkin jalan terus; perkiraan tiba
            // tetap dihitung ke garis henti yang sebenarnya
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
            if (col === 'yellow' && veh.sigDecision === 'stop' && (veh.v * veh.v) / (2 * aComf) > Math.max(0, dd) + 0.5) this.stats.dilemma++;
          }
        }
      }
      // zebra cross yang dipakai
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
      base += link.len;
      if (base > horizon) break;
      k++;
      link = veh.path[k];
    }
    // kendaraan parkir atau galian di lajur: berhenti cukup jauh di belakangnya, lalu lewati bila bisa
    if (leaderW && leaderW.obstacle && !veh.pass) {
      const ob = leaderW.obstacle;
      leaderGap -= 9;
      leaderV = 0;
      if (veh.link === ob.lane && veh.v < 0.4 && leaderGap < 6) {
        veh.passWait = (veh.passWait || 0) + dt;
        if (veh.passWait > 1 && (veh.passTry || 0) <= app.simTime) {
          veh.passTry = app.simTime + 0.5;
          const pl = app.passing.plan(veh, ob, veh.latBase);
          if (pl.ok && !app.passing.clearWhy(pl)) app.passing.activate(pl);
        }
        reason = 'menunggu-lawan';
      }
    } else veh.passWait = 0;
    if (veh.pass) {
      const e = app.passing.leaderOn(veh.pass, veh, LEAD);
      if (e && e.gap < leaderGap) {
        leaderGap = e.gap;
        leaderV = e.v;
      }
      if (!veh.blink) veh.blink = veh.s < veh.pass.sB + 2 ? Math.sign(veh.pass.off) : veh.s > veh.pass.sC - 2 ? -Math.sign(veh.pass.off) : 0;
    }
    if (leaderGap < Infinity) {
      const a = idm(veh.v, v0, leaderGap - 0.4, veh.v - leaderV, p);
      if (a < aPlan) {
        aPlan = a;
        reason = reason === 'menunggu-lawan' ? reason : 'mengikuti';
      }
    }
    veh.planReason = reason;
    // ===== perisai keselamatan =====
    const cons = nearestConstraint(veh, mu, veh.cons);
    const aAllow = allowedAccel(veh, cons.d, mu, dt);
    const aB = brakeLimit(veh, mu);
    let a = Math.min(aPlan, aAllow);
    const shieldActive = aAllow < aPlan - 0.3 && aAllow < 0.5;
    if (shieldActive && !veh.shieldOn) {
      veh.shieldEvents++;
      app.shieldLog(veh, cons);
    }
    veh.shieldOn = shieldActive;
    a = clamp(a, -aB, p.aMax);
    // ===== gerak =====
    const vOld = veh.v;
    let vNew = Math.max(0, vOld + a * dt);
    let ds = ((vOld + vNew) / 2) * dt;
    // penjepitan keras
    if (cons.d !== Infinity && ds > Math.max(0, cons.d)) {
      if (ds - Math.max(0, cons.d) > 0.01) {
        this.stats.clamps++;
        app.noteClamp(veh, cons);
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
    // garis henti lampu: pemantau lampu merah
    const frontNew = front + ds;
    if (veh.link.sig && front < veh.link.len && frontNew >= veh.link.len) app.invariants.stopLineCrossed(veh, veh.link);
    veh.s += ds;
    veh.odo += ds;
    while (veh.s > veh.link.len) {
      const nxt = veh.path.shift();
      if (!nxt) {
        // ujung jalan keluar peta
        veh.s = veh.link.len;
        veh.v = 0;
        if (veh.link.portal === 'out') veh.exitNow = true;
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
    // izin yang belum dipakai tapi kendaraan berhenti lama (misal karena pejalan kaki): lepas
    if (veh.grants.length && veh.v < 0.05) {
      veh.idleGrantT = (veh.idleGrantT || 0) + dt;
      if (veh.idleGrantT > 1.5) J.cancelUnused(veh);
    } else veh.idleGrantT = 0;
    veh.stuckT = veh.v < 0.1 ? veh.stuckT + dt : 0;
    // geser lateral saat melewati penghalang
    const pl = veh.pass;
    if (pl && veh.link === pl.lane && veh.s < pl.sD) {
      veh.lat = app.passing.latAt(pl, veh.s);
      veh.psi = Math.atan(app.passing.dlatAt(pl, veh.s));
    } else if (veh.lat !== veh.latBase || veh.psi) {
      veh.lat = veh.latBase;
      veh.psi = 0;
    }
    veh.updatePose();
  }

  /** Salin pose sebelum langkah (untuk interpolasi tampilan). */
  savePrev() {
    for (const v of this.all) {
      v.px = v.x;
      v.pz = v.z;
      v.ph = v.h;
    }
  }

  // ===== pemeriksaan (untuk uji dan panel) =====

  /** Tumpang tindih antarkendaraan (jejak kotak, dikecilkan sedikit). Seharusnya selalu 0. */
  checkOverlaps() {
    const all = this.all;
    const now = this.overlapNow;
    now.clear();
    for (let i = 0; i < all.length; i++) {
      const a = all[i];
      for (let j = i + 1; j < all.length; j++) {
        const b = all[j];
        const dx = a.x - b.x;
        const dz = a.z - b.z;
        const r = (a.len + b.len) / 2;
        if (dx * dx + dz * dz > r * r) continue;
        if (obbOverlap(a, b, 0.08)) {
          const key = a.id < b.id ? a.id * 100000 + b.id : b.id * 100000 + a.id;
          now.add(key);
          if (!this.overlapPairs.has(key)) {
            this.stats.overlaps++;
            this.app.logDebug({ type: 'tumpang-tindih', a: `${a.type}#${a.id}`, b: `${b.type}#${b.id}`, la: a.link.id, lb: b.link.id, x: Math.round(a.x), z: Math.round(a.z) });
          }
        }
      }
    }
    const t = this.overlapPairs;
    this.overlapPairs = now;
    this.overlapNow = t;
  }

  /** Sudut jejak kendaraan harus tetap di permukaan jalan. */
  checkOffRoad() {
    const city = this.city;
    for (const v of this.all) {
      const c = Math.cos(v.h);
      const s = Math.sin(v.h);
      const hl = v.len / 2 - 0.2;
      const hw = v.hw - 0.15;
      let off = false;
      for (const [u, w] of CORNERS) {
        const x = v.x + c * u * hl - s * w * hw;
        const z = v.z + s * u * hl + c * w * hw;
        if (!city.onRoad(x, z)) off = true;
      }
      if (off && !this.offRoadSet.has(v.id)) {
        this.offRoadSet.add(v.id);
        this.stats.offRoad++;
        this.app.logDebug({ type: 'keluar-jalan', v: `${v.type}#${v.id}`, link: v.link.id, lk: v.link.kind, x: Math.round(v.x * 10) / 10, z: Math.round(v.z * 10) / 10 });
        (this.offRoadEvents || (this.offRoadEvents = [])).push([v.x, v.z, v.link.id, v.link.kind, v.h, v.len, v.hw, v.type, v.lat, v.s]);
      } else if (!off) this.offRoadSet.delete(v.id);
    }
  }

  /** Pengawas macet: catat dan (sebagai jalan terakhir) pindahkan NPC yang diam terlalu lama. */
  watchdog() {
    const app = this.app;
    let mx = 0;
    for (const v of this.cars.slice()) {
      if (v.stuckT > mx) mx = v.stuckT;
      if (v.stuckT > 240) {
        const d = Math.hypot(v.x - app.focus.x, v.z - app.focus.z);
        if (d > 90) {
          app.logDebug({ type: 'npc-macet', v: `${v.type}#${v.id}`, link: v.link.id, reason: v.planReason, t: Math.round(v.stuckT) });
          this.stats.recovered++;
          this.removeVeh(v);
        }
      }
    }
    this.stats.stuckMax = Math.max(this.stats.stuckMax, mx);
    this.stuckNow = mx;
  }

  // ===== tampilan =====

  buildRenderers() {
    const ctx = { res: this.app.res, scene: this.app.scene };
    this.renderers = {};
    const cap = { car: 40, mpv: 30, angkot: 24, pickup: 20, motorbike: 50 };
    for (const [type, mod] of Object.entries(VEHICLE_MODELS)) this.renderers[type] = { r: mod.createInstanced(ctx, cap[type]), n: 0, cap: cap[type] };
  }

  sync(alpha, night, simTime) {
    for (const k in this.renderers) this.renderers[k].n = 0;
    const st = SYNC;
    const blinkOn = Math.floor(simTime * 2.5) % 2 === 0;
    for (const v of this.cars) {
      const R = this.renderers[v.type];
      if (!R || R.n >= R.cap) continue;
      let dh = v.h - v.ph;
      if (dh > Math.PI) dh -= Math.PI * 2;
      if (dh < -Math.PI) dh += Math.PI * 2;
      st.x = v.px + (v.x - v.px) * alpha;
      st.z = v.pz + (v.z - v.pz) * alpha;
      st.h = v.ph + dh * alpha;
      st.color = v.color;
      st.braking = v.braking;
      st.night = night;
      st.blink = v.blink;
      st.blinkOn = blinkOn;
      R.r.set(R.n++, st);
    }
    for (const k in this.renderers) this.renderers[k].r.commit(this.renderers[k].n);
  }
}

const SYNC = { x: 0, z: 0, h: 0, y: 0, color: null, braking: false, night: false, blink: 0, blinkOn: false };
const WEIGHTS = [];
const LEAD = { gap: 0, v: 0 };
const CORNERS = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

function obbOverlap(a, b, shrink) {
  const ac = Math.cos(a.h);
  const as = Math.sin(a.h);
  const bc = Math.cos(b.h);
  const bs = Math.sin(b.h);
  const ahl = a.len / 2 - shrink;
  const ahw = a.hw - shrink;
  const bhl = b.len / 2 - shrink;
  const bhw = b.hw - shrink;
  const tx = b.x - a.x;
  const tz = b.z - a.z;
  const axes = AXES;
  axes[0] = ac;
  axes[1] = as;
  axes[2] = -as;
  axes[3] = ac;
  axes[4] = bc;
  axes[5] = bs;
  axes[6] = -bs;
  axes[7] = bc;
  for (let i = 0; i < 8; i += 2) {
    const ux = axes[i];
    const uz = axes[i + 1];
    const ra = ahl * Math.abs(ac * ux + as * uz) + ahw * Math.abs(-as * ux + ac * uz);
    const rb = bhl * Math.abs(bc * ux + bs * uz) + bhw * Math.abs(-bs * ux + bc * uz);
    if (Math.abs(tx * ux + tz * uz) > ra + rb) return false;
  }
  return true;
}
const AXES = new Float64Array(8);
