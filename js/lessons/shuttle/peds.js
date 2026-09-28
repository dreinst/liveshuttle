// Pejalan kaki pelajaran Misi Shuttle Otonom: berjalan di trotoar (jaringan trotoar dari data kota
// yang sama dengan Shuttle 3D), menunggu di tepi zebra cross, dan menyeberang hanya bila aman.
//
// Aturan sama dengan js/sim3d/pedestrians.js (disalin tanpa bagian Three.js):
// - Penerimaan celah: pejalan kaki baru melangkah ke jalan bila SETIAP kendaraan yang akan melewati
//   zebra cross masih bisa berhenti dengan nyaman sebelum garisnya (v x waktu reaksi +
//   v^2 / (2 a_nyaman), a_nyaman dari gesekan jalan saat ini). Setelah melangkah, zebra cross
//   dipesan dan semua kendaraan melihatnya sebagai batasan perisai.
// - Di lampu, pejalan kaki hanya mulai saat lampu pejalan kaki hijau.
// - Pejalan kaki tidak pernah melangkah ke badan kendaraan.
// - Pejalan kaki uji (tombol "Pejalan kaki menyeberang") muncul di depan shuttle hanya pada jarak
//   yang masih cukup bagi SEMUA kendaraan untuk berhenti dengan rem penuh (jarak henti + sela).
//   Bila belum mungkin, permintaan menunggu dan alasannya dicatat.
// Pejalan kaki hanya dibuat di sekitar shuttle supaya ringan.

import { comfortDecel, stopDistance, brakeLimit } from '../../sim3d/shield.js';
import { Poly } from '../../sim3d/geom.js';
import { COLORS } from '../../engine/theme.js';

const REACT = 0.6;
const XGAP = 1.5;
const UPSTREAM = 60;
const REG_LAT = 2.6;
const PRED_T = [0.8, 1.6];
/**
 * Sela tambahan pejalan kaki uji di atas jarak henti rem penuh (m), diukur dari bumper depan ke garis
 * tengah zebra cross sementara. Setelah dikurangi setengah lebar zebra cross (1,7 m) dan sela berhenti
 * (1,5 m) masih tersisa sekitar 2,8 m.
 */
export const TEST_MARGIN = 6;
/** Jarak paling dekat pejalan kaki uji dari bumper depan shuttle (m). */
export const TEST_MIN = 12;

class PedGrid {
  constructor(C = 8) {
    this.C = C;
    this.map = new Map();
    this.keys = [];
  }
  clear() {
    for (const k of this.keys) this.map.get(k).length = 0;
    this.keys.length = 0;
  }
  add(p) {
    const k = Math.floor(p.x / this.C) * 100000 + Math.floor(p.z / this.C);
    let arr = this.map.get(k);
    if (!arr) this.map.set(k, (arr = []));
    if (!arr.length) this.keys.push(k);
    arr.push(p);
  }
  query(x, z, r, cb) {
    const C = this.C;
    const i0 = Math.floor((x - r) / C);
    const i1 = Math.floor((x + r) / C);
    const j0 = Math.floor((z - r) / C);
    const j1 = Math.floor((z + r) / C);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const arr = this.map.get(i * 100000 + j);
        if (!arr) continue;
        for (let k = 0; k < arr.length; k++) cb(arr[k]);
      }
    }
  }
}

const O = {};
const PR = {};
const STACK = [];
const VARIANTS = ['default', 'default', 'hijab', 'backpack', 'default', 'hijab'];
const SHIRTS = ['#fb7185', '#f59e0b', '#a78bfa', '#38bdf8', '#34d399', '#f472b6', '#e2e8f0', '#fbbf24'];

export class Pedestrians {
  /** app: { city, rng(), mu, weather, focus {x, y}, traffic } */
  constructor(app) {
    this.app = app;
    this.city = app.city;
    this.peds = [];
    this.nextId = 1;
    this.target = 18;
    this.radius = 150;
    this.grid = new PedGrid(8);
    this.touched = [];
    this.pool = [];
    this.poolN = 0;
    this.stats = { crossings: 0, gaveUp: 0, blockedSteps: 0, tests: 0 };
    this.temp = [];
    this.request = null; // permintaan pejalan kaki uji: { t, reason, veh }
  }

  make(edge, t, fwd) {
    const rng = this.app.rng;
    const p = {
      id: this.nextId++,
      kind: 'pedestrian',
      label: 'Pejalan kaki',
      radius: 0.3,
      edge,
      fwd,
      t,
      speed: 1.05 + rng() * 0.45,
      off: 0.1 + rng() * 0.35,
      state: 'walk',
      x: 0,
      z: 0,
      h: 0,
      vx: 0,
      vz: 0,
      phase: rng() * 6,
      waitT: 0,
      next: null,
      xing: null,
      moving: true,
      alpha: 0,
      fade: 1,
      variant: VARIANTS[Math.floor(rng() * VARIANTS.length)],
      accent: COLORS.hijab[Math.floor(rng() * COLORS.hijab.length)],
      color: SHIRTS[Math.floor(rng() * SHIRTS.length)],
      umbrella: rng() < 0.7,
    };
    this.place(p);
    return p;
  }

  pickEdgeNear(rMin, rMax) {
    const list = this.city.walkEdges;
    const f = this.app.focus;
    for (let tries = 0; tries < 40; tries++) {
      const e = list[Math.floor(this.app.rng() * list.length)];
      const d = Math.hypot(e.poly.x[0] - f.x, e.poly.z[0] - f.y);
      if (d < rMin || d > rMax) continue;
      // lebih sering di blok yang punya zebra cross
      if (!e.nearX && this.app.rng() < 0.5) continue;
      return e;
    }
    return null;
  }

  spawnNear(rMin, rMax, fadeIn = true) {
    const e = this.pickEdgeNear(rMin, rMax);
    if (!e) return null;
    const p = this.make(e, this.app.rng() * e.len, this.app.rng() < 0.5);
    p.alpha = fadeIn ? 0 : 1;
    p.fade = fadeIn ? 1 : 0;
    this.peds.push(p);
    return p;
  }

  balance() {
    const f = this.app.focus;
    let n = 0;
    for (const p of this.peds) {
      if (p.test) continue;
      const d = Math.hypot(p.x - f.x, p.z - f.y);
      if (d > this.radius + 30 && p.state === 'walk' && p.fade >= 0) p.fade = -1;
      if (p.fade >= 0) n++;
    }
    if (n < this.target) this.spawnNear(20, this.radius);
  }

  remove(p) {
    if (p.xing) p.xing.reserved.delete(p);
    const i = this.peds.indexOf(p);
    if (i >= 0) this.peds.splice(i, 1);
  }

  // ===== posisi =====

  place(p) {
    const e = p.edge;
    const s = p.fwd ? p.t : e.len - p.t;
    e.poly.atSmooth(Math.max(0, Math.min(e.len, s)), O);
    const h = p.fwd ? O.h : O.h + Math.PI;
    const off = e.kind === 'x' ? (p.off - 0.275) * 2 : p.off;
    p.x = O.x + Math.sin(h) * off;
    p.z = O.z - Math.cos(h) * off;
    p.h = h;
    p.y = p.z;
    p.heading = h;
  }

  endNode(p) {
    return p.fwd ? p.edge.b : p.edge.a;
  }

  chooseNext(p) {
    const node = this.city.wnodes[this.endNode(p)];
    const rng = this.app.rng;
    const list = node.edges.filter((e) => e !== p.edge && (e.kind !== 'x' || e.usable));
    if (!list.length) return { edge: p.edge, fwd: !p.fwd };
    let tot = 0;
    const ws = list.map((e) => {
      const w = e.kind === 'x' ? 2.5 : 1;
      tot += w;
      return w;
    });
    let r = rng() * tot;
    let pick = list[list.length - 1];
    for (let i = 0; i < list.length; i++) {
      r -= ws[i];
      if (r <= 0) {
        pick = list[i];
        break;
      }
    }
    return { edge: pick, fwd: pick.a === node.id };
  }

  // ===== penerimaan celah =====

  /** Bisakah semua kendaraan yang menuju zebra cross X berhenti? hard = pakai rem penuh (pejalan kaki uji). */
  canCross(X, why, hard = false) {
    if (X.signal && !X.signal.pedWalk()) {
      if (why) why.reason = 'lampu';
      return false;
    }
    const mu = this.app.mu;
    for (const e of X.links) {
      if (!this.linkClear(e.link, e.s0, e.s1, mu, why, hard)) return false;
    }
    return true;
  }

  linkClear(link, s0, s1, mu, why, hard) {
    for (let i = 0; i < link.occN; i++) {
      const o = link.occ[i];
      const W = o.veh;
      const front = o.s + W.len / 2;
      const rear = o.s - W.len / 2;
      if (rear < s1 + 0.8 && front > s0 - 0.8) {
        if (why) why.reason = 'badan';
        return false;
      }
      if (front <= s0 - 0.8 && !this.canStop(W, s0 - front - XGAP, mu, hard)) {
        if (why) why.reason = 'dekat';
        return false;
      }
    }
    const stack = STACK;
    stack.length = 0;
    for (const pl of link.prev) stack.push(pl, s0);
    let guard = 0;
    while (stack.length && guard++ < 200) {
      const acc = stack.pop();
      const l = stack.pop();
      for (let i = 0; i < l.occN; i++) {
        const o = l.occ[i];
        const W = o.veh;
        const front = o.s + W.len / 2;
        const d = l.len - front + acc - XGAP;
        if (!this.canStop(W, d, mu, hard)) {
          if (why) why.reason = 'dekat';
          return false;
        }
      }
      const acc2 = acc + l.len;
      if (acc2 < UPSTREAM) for (const pl of l.prev) stack.push(pl, acc2);
    }
    return true;
  }

  canStop(W, d, mu, hard = false) {
    if (d < 0) return W.v < 0.05 && d > -XGAP;
    if (hard) return d >= stopDistance(W.v, brakeLimit(W, mu)) + 1;
    const a = comfortDecel(W, mu);
    return d >= W.v * REACT + (W.v * W.v) / (2 * a);
  }

  /** Apakah langkah ke (x, z) akan menyentuh badan kendaraan (dengan sela 0,35 m)? */
  touchesVehicle(x, z) {
    for (const v of this.app.traffic.all) {
      const dx = x - v.x;
      const dz = z - v.z;
      const R = v.len / 2 + 1;
      if (dx * dx + dz * dz > R * R) continue;
      const c = Math.cos(v.h);
      const s = Math.sin(v.h);
      const lx = dx * c + dz * s;
      const lz = -dx * s + dz * c;
      const hl = v.len / 2 + 0.35;
      const hw = v.hw + 0.35;
      const qx = Math.max(-hl, Math.min(hl, lx));
      const qz = Math.max(-hw, Math.min(hw, lz));
      const ex = lx - qx;
      const ez = lz - qz;
      if (ex * ex + ez * ez < 0.25 * 0.25) return true;
    }
    return false;
  }

  // ===== langkah =====

  step(dt) {
    this.lastTest = this.stepTest(dt);
    for (let i = this.peds.length - 1; i >= 0; i--) {
      const p = this.peds[i];
      if (p.fade > 0) {
        p.alpha = Math.min(1, p.alpha + dt / 0.8);
        if (p.alpha >= 1) p.fade = 0;
      } else if (p.fade < 0 && !p.xing) {
        p.alpha -= dt / 0.8;
        if (p.alpha <= 0) {
          this.remove(p);
          continue;
        }
      }
      if (p.state === 'wait') this.stepWait(p, dt);
      else if (p.state !== 'diam') this.stepWalk(p, dt);
    }
    this.register();
  }

  stepWait(p, dt) {
    p.waitT += dt;
    p.moving = false;
    p.vx = p.vz = 0;
    const X = p.next.edge.xing;
    const why = { reason: '' };
    if (X && this.canCross(X, why)) {
      X.reserved.add(p);
      p.xing = X;
      p.edge = p.next.edge;
      p.fwd = p.next.fwd;
      p.t = 0;
      p.next = null;
      p.state = 'cross';
      p.waitT = 0;
      this.stats.crossings++;
      this.place(p);
      return;
    }
    p.waitWhy = why.reason;
    const limit = X && X.signal ? 150 : 50;
    if (p.waitT > limit) {
      this.stats.gaveUp++;
      p.state = 'walk';
      p.fwd = !p.fwd;
      p.t = 0;
      p.next = null;
      p.waitT = 0;
      this.place(p);
      return;
    }
    const ne = p.next.edge;
    const s = p.next.fwd ? 0.01 : ne.len - 0.01;
    ne.poly.at(s, O);
    const h = p.next.fwd ? O.h : O.h + Math.PI;
    const node = this.city.wnodes[p.next.fwd ? ne.a : ne.b];
    p.x = node.x - Math.cos(h) * 0.45 + Math.sin(h) * (p.off - 0.275) * 2;
    p.z = node.z - Math.sin(h) * 0.45 - Math.cos(h) * (p.off - 0.275) * 2;
    p.y = p.z;
    p.h = h;
    p.heading = h;
  }

  stepWalk(p, dt) {
    const e = p.edge;
    let sp = p.speed;
    if (p.state === 'cross' && p.xing && p.xing.signal && !p.xing.signal.pedWalk()) sp = Math.max(sp, 1.6);
    const tNew = p.t + sp * dt;
    const ox = p.x;
    const oz = p.z;
    if (p.state === 'cross') {
      const tOld = p.t;
      p.t = tNew;
      const oh = p.h;
      this.place(p);
      if (this.touchesVehicle(p.x, p.z) && !this.touchesVehicle(ox, oz)) {
        p.t = tOld;
        p.x = ox;
        p.z = oz;
        p.y = oz;
        p.h = oh;
        p.heading = oh;
        p.moving = false;
        p.vx = p.vz = 0;
        this.stats.blockedSteps++;
        return;
      }
      p.t = tOld;
    }
    p.moving = true;
    p.phase += sp * dt * 6;
    if (tNew >= e.len) {
      const over = tNew - e.len;
      if (p.state === 'cross' && p.xing) {
        p.xing.reserved.delete(p);
        p.xing = null;
        if (p.test) {
          this.finishTest(p);
          return;
        }
      }
      const nx = this.chooseNext(p);
      if (nx.edge.kind === 'x' && nx.edge.xing) {
        p.state = 'wait';
        p.next = nx;
        p.t = e.len;
        p.waitT = 0;
        this.place(p);
        p.vx = p.vz = 0;
        return;
      }
      p.state = 'walk';
      p.edge = nx.edge;
      p.fwd = nx.fwd;
      p.t = Math.min(over, nx.edge.len);
    } else p.t = tNew;
    this.place(p);
    p.vx = (p.x - ox) / dt;
    p.vz = (p.z - oz) / dt;
  }

  /** Daftarkan pejalan kaki ke link di dekatnya untuk perisai kendaraan (posisi kini dan perkiraan). */
  register() {
    for (const l of this.touched) l.pedN = 0;
    this.touched.length = 0;
    this.poolN = 0;
    this.grid.clear();
    const city = this.city;
    for (const p of this.peds) {
      this.grid.add(p);
      const links = city.linksNear(p.x, p.z);
      const moving = p.state === 'cross' || p.test;
      for (let i = 0; i < links.length; i++) {
        const L = links[i];
        const bb = L.poly.bb;
        const m = REG_LAT + 1;
        if (p.x < bb[0] - m || p.x > bb[2] + m || p.z < bb[1] - m || p.z > bb[3] + m) continue;
        L.poly.project(p.x, p.z, PR);
        if (PR.s < -1 || PR.s > L.len + 1) continue;
        const lim = REG_LAT + L.sweep;
        if (Math.abs(PR.lat) < lim) this.addEntry(L, p, PR.s, PR.lat, false);
        if (moving && (p.vx || p.vz)) {
          L.poly.at(Math.max(0, Math.min(L.len, PR.s)), O);
          const c = Math.cos(O.h);
          const s = Math.sin(O.h);
          const along = p.vx * c + p.vz * s;
          const lateral = -p.vx * s + p.vz * c;
          for (const tt of PRED_T) {
            const lat2 = PR.lat + lateral * tt;
            if (Math.abs(lat2) < lim) this.addEntry(L, p, PR.s + along * tt, lat2, true);
          }
        }
      }
    }
  }

  addEntry(L, p, s, lat, pred) {
    let e = this.pool[this.poolN];
    if (!e) {
      e = { ped: null, s: 0, lat: 0, pred: false };
      this.pool.push(e);
    }
    this.poolN++;
    e.ped = p;
    e.s = s;
    e.lat = lat;
    e.pred = pred;
    if (!L.pedN) this.touched.push(L);
    L.peds[L.pedN++] = e;
  }

  // ===== pejalan kaki uji: menyeberang di depan shuttle =====

  /** Pelajar meminta pejalan kaki menyeberang di depan kendaraan veh. */
  requestTest(veh) {
    if (this.request) return { ok: false, reason: 'antre' };
    if (this.peds.some((p) => p.test)) return { ok: false, reason: 'masih' };
    this.request = { veh, t: 0, reason: '' };
    return { ok: true };
  }

  cancelTest() {
    this.request = null;
  }

  /**
   * Dipanggil tiap langkah. Pejalan kaki uji hanya muncul pada jarak jarak henti rem penuh + sela di
   * depan bumper shuttle, dan hanya bila SEMUA kendaraan yang menuju titik itu masih bisa berhenti.
   * Mengembalikan pejalan kaki yang baru muncul, atau null (alasan menunggu di request.reason).
   */
  stepTest(dt) {
    const R = this.request;
    if (!R) return null;
    R.t += dt;
    const res = this.spawnCrossingAhead(R.veh);
    if (res.ok) {
      this.request = null;
      this.stats.tests++;
      return res.ped;
    }
    R.reason = res.reason;
    R.dist = res.dist;
    if (R.t > 25) {
      this.lastExpired = true;
      this.request = null;
    }
    return null;
  }

  spawnCrossingAhead(veh) {
    if (veh.holdAtHalte) return { ok: false, reason: 'halte' };
    const mu = this.app.mu;
    const aB = brakeLimit(veh, mu);
    const need = stopDistance(veh.v, aB) + TEST_MARGIN;
    const want = Math.max(need, TEST_MIN);
    // cari titik di lajur lurus di jalur veh sejauh want dari bumper depan
    let s = veh.s + veh.len / 2 + want;
    let link = veh.link;
    let k = -1;
    while (link && s > link.len) {
      s -= link.len;
      k++;
      link = veh.path[k];
    }
    if (!link) return { ok: false, reason: 'rute', dist: want };
    if (link.kind !== 'lane' || link.ring !== null || s < 4 || s > link.stopLen - 6) return { ok: false, reason: 'simpang', dist: want };
    // jangan di atas zebra cross atau halte
    for (const xg of link.xings) if (s > xg.s0 - 6 && s < xg.s1 + 6) return { ok: false, reason: 'zebra', dist: want };
    const P = link.poly.at(s, {});
    const road = this.city.roadById.get(link.roadId);
    const half = road ? road.half : 3;
    const lx = Math.sin(P.h);
    const lz = -Math.cos(P.h);
    const cOff = road && !road.ow ? link.width / 2 : 0;
    const cx = P.x - lx * cOff;
    const cz = P.z - lz * cOff;
    const X = this.makeTempCrossing(cx, cz, P.h, 2 * half + 0.4);
    const why = { reason: '' };
    if (!this.canCross(X, why, true)) {
      this.dropTempCrossing(X);
      return { ok: false, reason: why.reason || 'dekat', dist: want };
    }
    // muncul di trotoar kiri, lalu menyeberang ke kanan
    const start = [cx + lx * (half + 0.9), cz + lz * (half + 0.9)];
    const end = [cx - lx * (half + 0.9), cz - lz * (half + 0.9)];
    const poly = new Poly([start, end]);
    const edge = { id: -1, a: -1, b: -1, kind: 'x', poly, len: poly.len, xing: X };
    const p = this.make(edge, 0, true);
    p.state = 'cross';
    p.test = true;
    p.xing = X;
    p.speed = 1.35;
    p.alpha = 1;
    p.fade = 0;
    p.variant = 'backpack';
    X.reserved.add(p);
    this.peds.push(p);
    return { ok: true, ped: p, dist: want };
  }

  makeTempCrossing(x, z, h, len) {
    const X = { id: -1 - this.temp.length, x, z, h, len, w: 3, links: [], reserved: new Set(), signal: null, temp: true };
    // semua link yang garis tengahnya melewati kotak zebra cross (proyeksi, jadi ruas lurus yang panjang tidak terlewat)
    const R = len / 2 + 0.6;
    for (const link of this.city.links) {
      const bb = link.poly.bb;
      if (x < bb[0] - R || x > bb[2] + R || z < bb[1] - R || z > bb[3] + R) continue;
      link.poly.project(x, z, PR);
      if (Math.abs(PR.lat) > R || PR.s < -X.w / 2 || PR.s > link.len + X.w / 2) continue;
      const e = { x: X, s0: Math.max(0, PR.s - X.w / 2 - 0.2), s1: PR.s + X.w / 2 + 0.2, link };
      X.links.push(e);
      link.xings.push(e);
      link.xings.sort((a, b) => a.s0 - b.s0);
    }
    this.temp.push(X);
    return X;
  }

  dropTempCrossing(X) {
    for (const e of X.links) {
      const i = e.link.xings.indexOf(e);
      if (i >= 0) e.link.xings.splice(i, 1);
    }
    const i = this.temp.indexOf(X);
    if (i >= 0) this.temp.splice(i, 1);
  }

  finishTest(p) {
    if (p.xing) p.xing.reserved.delete(p);
    const X = p.edge.xing;
    if (X && X.temp) this.dropTempCrossing(X);
    let best = null;
    for (const e of this.city.walkEdges) {
      const bb = e.poly.bb;
      if (p.x < bb[0] - 4 || p.x > bb[2] + 4 || p.z < bb[1] - 4 || p.z > bb[3] + 4) continue;
      e.poly.project(p.x, p.z, PR);
      const d = Math.sqrt(PR.d2);
      if (d < 3 && (!best || d < best.d)) best = { e, t: PR.s, d };
    }
    if (best) {
      p.test = false;
      p.state = 'walk';
      p.edge = best.e;
      p.fwd = true;
      p.t = Math.max(0, Math.min(best.e.len, best.t));
      p.xing = null;
      this.place(p);
    } else {
      // tidak ada trotoar di dekatnya: berdiri di tepi jalan lalu menghilang pelan
      p.test = false;
      p.state = 'diam';
      p.moving = false;
      p.vx = p.vz = 0;
      p.fade = -1;
    }
  }

  /** Hapus semua pejalan kaki dan zebra cross sementara. */
  clear() {
    for (const p of this.peds) if (p.xing) p.xing.reserved.delete(p);
    for (const X of this.temp.slice()) this.dropTempCrossing(X);
    this.peds.length = 0;
    this.request = null;
    this.register();
  }
}
