// Pejalan kaki: berjalan di trotoar hasil peta, menunggu di tepi zebra cross, dan menyeberang
// hanya bila aman.
//
// Penerimaan celah (gap acceptance) memakai rumus jarak henti yang sama dengan perisai:
// pejalan kaki baru melangkah ke jalan bila SETIAP kendaraan yang akan melewati zebra cross masih
// bisa berhenti dengan nyaman sebelum garisnya (v x waktu reaksi + v^2 / (2 a_nyaman), dengan
// a_nyaman dari gesekan jalan saat ini). Setelah melangkah, zebra cross dipesan dan semua kendaraan
// melihatnya sebagai batasan. Di lampu, pejalan kaki hanya mulai saat lampu pejalan kaki hijau.
// Pejalan kaki juga tidak pernah melangkah ke badan kendaraan.
import * as THREE from '../vendor/three.bundle.min.js';
import { pedestrian as pedModel } from './models/index.js';
import { comfortDecel, stopDistance, brakeLimit } from './shield.js';

const REACT = 0.6; // waktu reaksi yang diasumsikan untuk pengemudi (detik)
const XGAP = 1.5; // sela di depan zebra cross (m)
const UPSTREAM = 60; // jarak ke hulu yang diperiksa (m)
const REG_LAT = 2.6; // pejalan kaki didaftarkan ke link bila sedekat ini dari garis tengahnya

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
const Q = {}; // posisi calon untuk blocked()
const BODY_GAP = 0.6; // jarak terdekat pejalan kaki (titik tengah) ke badan kendaraan (m)

export class Pedestrians {
  constructor(app) {
    this.app = app;
    this.city = app.city;
    this.peds = [];
    this.nextId = 1;
    this.target = 46;
    this.max = 90;
    this.grid = new PedGrid(8);
    this.touched = [];
    this.pool = [];
    this.poolN = 0;
    this.stats = { crossings: 0, gaveUp: 0, blockedSteps: 0 };
    this.temp = []; // zebra cross sementara (uji "Pejalan kaki menyeberang")
    const ctx = { res: app.res, scene: app.scene };
    this.renderer = pedModel.createInstanced(ctx, this.max + 10);
    // lebih banyak pejalan kaki di sekitar kampus dan di blok yang punya zebra cross
    this.weights = this.city.walkEdges.map((e) => {
      const mx = e.poly.x[0];
      const mz = e.poly.z[0];
      const d = Math.hypot(mx, mz);
      return (d < 330 ? 3 : 1) * (e.nearX ? 5 : 1) * Math.min(1, e.len / 10);
    });
    this.wTotal = this.weights.reduce((a, b) => a + b, 0);
  }

  pickEdge() {
    let r = this.app.rng() * this.wTotal;
    const list = this.city.walkEdges;
    for (let i = 0; i < list.length; i++) {
      r -= this.weights[i];
      if (r <= 0) return list[i];
    }
    return list[list.length - 1];
  }

  make(edge, t, fwd) {
    const rng = this.app.rng;
    const p = {
      id: this.nextId++,
      edge,
      fwd,
      t,
      speed: 1.05 + rng() * 0.45,
      off: 0.1 + rng() * 0.35, // geser ke kiri arah jalan, paling jauh 0,45 m (sama dengan tools/osm_to_city.py)
      state: 'walk',
      x: 0,
      z: 0,
      h: 0,
      px: 0,
      pz: 0,
      ph: 0,
      vx: 0,
      vz: 0,
      phase: rng() * 6,
      waitT: 0,
      next: null,
      xing: null,
      scale: 0.9 + rng() * 0.18,
      body: new THREE.Color(pedModel.CLOTH[Math.floor(rng() * pedModel.CLOTH.length)]),
      skin: new THREE.Color(pedModel.SKIN[Math.floor(rng() * pedModel.SKIN.length)]),
      pants: new THREE.Color(['#2b3445', '#3d3a36', '#58606b', '#1f2a3a', '#6b5a4a'][Math.floor(rng() * 5)]),
      moving: true,
    };
    this.place(p);
    p.px = p.x;
    p.pz = p.z;
    p.ph = p.h;
    return p;
  }

  spawnRandom(minDist = 0) {
    const app = this.app;
    for (let tries = 0; tries < 20; tries++) {
      const e = this.pickEdge();
      const t = app.rng() * e.len;
      const p = this.make(e, t, app.rng() < 0.5);
      if (minDist && Math.hypot(p.x - app.focus.x, p.z - app.focus.z) < minDist) continue;
      this.peds.push(p);
      return p;
    }
    return null;
  }

  balance() {
    const app = this.app;
    const normal = this.peds.filter((p) => !p.test);
    if (normal.length < Math.min(this.target, this.max)) this.spawnRandom(60);
    else if (normal.length > this.target) {
      let far = null;
      let fd = 0;
      for (const p of normal) {
        if (p.state !== 'walk') continue;
        const d = Math.hypot(p.x - app.focus.x, p.z - app.focus.z);
        if (d > fd) {
          fd = d;
          far = p;
        }
      }
      if (far && fd > 60) this.remove(far);
    }
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
    // bergeser ke kiri arah jalannya supaya yang berpapasan tidak bertabrakan
    const off = e.kind === 'x' ? (p.off - 0.275) * 2 : p.off;
    p.x = O.x + Math.sin(h) * off;
    p.z = O.z - Math.cos(h) * off;
    p.h = h;
  }

  endNode(p) {
    return p.fwd ? p.edge.b : p.edge.a;
  }

  chooseNext(p) {
    const node = this.city.wnodes[this.endNode(p)];
    const rng = this.app.rng;
    // zebra cross yang ujungnya buntu tidak dipilih; bila tidak ada pilihan lain, berbalik arah
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

  /** Bisakah semua kendaraan yang menuju zebra cross X berhenti dengan nyaman? */
  canCross(X, why) {
    if (X.signal && !X.signal.pedWalk()) {
      if (why) why.reason = 'lampu';
      return false;
    }
    const mu = this.app.weather.mu;
    for (const e of X.links) {
      if (!this.linkClear(e.link, e.s0, e.s1, mu, why)) return false;
    }
    // shuttle yang dikemudikan manual bisa datang dari arah mana pun: periksa jaraknya langsung
    const ego = this.app.ego;
    if (ego && !ego.allowsCrossing(X, mu)) {
      if (why) why.reason = 'dekat';
      return false;
    }
    return true;
  }

  linkClear(link, s0, s1, mu, why) {
    // kendaraan di link ini
    for (let i = 0; i < link.occN; i++) {
      const o = link.occ[i];
      const W = o.veh;
      const front = o.s + W.len / 2;
      const rear = o.s - W.len / 2;
      if (rear < s1 + 0.8 && front > s0 - 0.8) {
        if (why) why.reason = 'badan';
        return false;
      }
      if (front <= s0 - 0.8 && !this.canStop(W, s0 - front - XGAP, mu)) {
        if (why) why.reason = 'dekat';
        return false;
      }
    }
    // kendaraan di hulu (lajur dan konektor sebelumnya)
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
        if (!this.canStop(W, d, mu)) {
          if (why) why.reason = 'dekat';
          return false;
        }
      }
      const acc2 = acc + l.len;
      if (acc2 < UPSTREAM) for (const pl of l.prev) stack.push(pl, acc2);
    }
    return true;
  }

  canStop(W, d, mu) {
    if (d < 0) return W.v < 0.05 && d > -XGAP; // sudah berhenti tepat di depan garis
    const a = comfortDecel(W, mu);
    return d >= W.v * REACT + (W.v * W.v) / (2 * a);
  }

  /** Jarak terdekat dari (x, z) ke badan kendaraan (hanya shuttle bila onlyEgo). */
  bodyGap(x, z, onlyEgo = false) {
    let best = Infinity;
    for (const v of this.app.traffic.all) {
      if (onlyEgo && !v.ego) continue;
      const dx = x - v.x;
      const dz = z - v.z;
      const R = v.len / 2 + 2;
      if (dx * dx + dz * dz > R * R) continue;
      const c = Math.cos(v.h);
      const s = Math.sin(v.h);
      const lx = Math.abs(dx * c + dz * s) - v.len / 2;
      const lz = Math.abs(-dx * s + dz * c) - v.hw;
      best = Math.min(best, Math.hypot(Math.max(lx, 0), Math.max(lz, 0)));
    }
    return best;
  }

  // ===== langkah =====

  step(dt) {
    for (const p of this.peds) {
      p.px = p.x;
      p.pz = p.z;
      p.ph = p.h;
    }
    for (let i = this.peds.length - 1; i >= 0; i--) {
      const p = this.peds[i];
      if (p.state === 'wait') this.stepWait(p, dt);
      else this.stepWalk(p, dt);
    }
    this.register();
  }

  /**
   * Apakah pejalan kaki p terlalu dekat ke badan kendaraan bila pindah ke (x, z)? Dalam jarak 0,6 m
   * ia tidak boleh mendekat lagi, hanya menjauh atau diam. Di jalan diperiksa semua kendaraan, di
   * trotoar hanya shuttle (hanya ia yang bisa menepi rapat ke trotoar).
   */
  blocked(p, x, z, road) {
    const g = this.bodyGap(x, z, !road);
    return g < BODY_GAP && g < this.bodyGap(p.x, p.z, !road);
  }

  /** blocked() untuk posisi di edge pada jarak t. */
  blockedAt(p, edge, fwd, t, road) {
    Q.edge = edge;
    Q.fwd = fwd;
    Q.t = t;
    Q.off = p.off;
    this.place(Q);
    return this.blocked(p, Q.x, Q.z, road);
  }

  hold(p) {
    p.moving = false;
    p.vx = p.vz = 0;
    this.stats.blockedSteps++;
  }

  /** Tempat berdiri di tepi zebra cross nx, menghadap ke seberang. */
  waitSpot(o, nx) {
    const ne = nx.edge;
    ne.poly.at(nx.fwd ? 0.01 : ne.len - 0.01, O);
    const h = nx.fwd ? O.h : O.h + Math.PI;
    const node = this.city.wnodes[nx.fwd ? ne.a : ne.b];
    o.x = node.x - Math.cos(h) * 0.45 + Math.sin(h) * (o.off - 0.275) * 2;
    o.z = node.z - Math.sin(h) * 0.45 - Math.cos(h) * (o.off - 0.275) * 2;
    o.h = h;
  }

  stepWait(p, dt) {
    p.waitT += dt;
    p.moving = false;
    p.vx = p.vz = 0;
    const X = p.next.edge.xing;
    const why = WHY;
    why.reason = '';
    if (X && this.canCross(X, why) && !this.blockedAt(p, p.next.edge, p.next.fwd, 0, true)) {
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
    const limit = X && X.signal ? 150 : 50;
    if (p.waitT > limit && !this.blockedAt(p, p.edge, !p.fwd, 0, false)) {
      // menyerah dan berjalan kembali
      this.stats.gaveUp++;
      p.state = 'walk';
      p.fwd = !p.fwd;
      p.t = 0;
      p.next = null;
      p.waitT = 0;
      this.place(p);
      return;
    }
    this.waitSpot(p, p.next);
  }

  // Setiap perpindahan (juga pindah edge, mulai menunggu, dan selesai menyeberang) diperiksa dulu
  // dengan blocked(), jadi pejalan kaki tidak pernah melangkah atau melompat ke badan kendaraan.
  stepWalk(p, dt) {
    const e = p.edge;
    const road = p.state === 'cross';
    let sp = p.speed;
    if (road && p.xing && p.xing.signal && !p.xing.signal.pedWalk()) sp = Math.max(sp, 1.6); // bergegas saat lampu hampir habis
    const tNew = p.t + sp * dt;
    if (tNew < e.len) {
      if (this.blockedAt(p, e, p.fwd, tNew, road)) return this.hold(p);
      p.t = tNew;
    } else {
      if (road && p.test) return this.finishTest(p);
      const over = tNew - e.len;
      const nx = this.chooseNext(p);
      const toWait = nx.edge.kind === 'x' && nx.edge.xing;
      if (toWait) {
        Q.off = p.off;
        this.waitSpot(Q, nx);
      }
      if (toWait ? this.blocked(p, Q.x, Q.z, false) : this.blockedAt(p, nx.edge, nx.fwd, Math.min(over, nx.edge.len), road)) return this.hold(p);
      if (road && p.xing) {
        p.xing.reserved.delete(p);
        p.xing = null;
      }
      if (toWait) {
        p.state = 'wait';
        p.next = nx;
        p.t = e.len;
        p.waitT = 0;
        this.waitSpot(p, nx);
        p.moving = false;
        p.vx = p.vz = 0;
        return;
      }
      p.state = 'walk';
      p.edge = nx.edge;
      p.fwd = nx.fwd;
      p.t = Math.min(over, nx.edge.len);
    }
    p.moving = true;
    p.phase += sp * dt * 2.6;
    const ox = p.x;
    const oz = p.z;
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
        const extra = L.regExtra || 0;
        const m = REG_LAT + 1 + extra;
        if (p.x < bb[0] - m || p.x > bb[2] + m || p.z < bb[1] - m || p.z > bb[3] + m) continue;
        L.poly.project(p.x, p.z, PR);
        if (PR.s < -1 || PR.s > L.len + 1) continue;
        const lim = REG_LAT + L.sweep + extra;
        if (Math.abs(PR.lat) < lim) this.addEntry(L, p, PR.s, PR.lat, false);
        if (moving && (p.vx || p.vz)) {
          // perkiraan 0,8 dan 1,6 detik ke depan (proyeksi linear terhadap arah link di titik itu)
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

  // ===== uji: pejalan kaki menyeberang di depan shuttle =====

  /**
   * Munculkan pejalan kaki yang menyeberang di depan kendaraan veh, hanya pada jarak yang masih
   * cukup untuk berhenti (jarak henti + sela). Mengembalikan { ok, reason, dist }.
   */
  spawnCrossingAhead(veh, opts = null) {
    const mu = this.app.weather.mu;
    const aB = brakeLimit(veh, mu);
    // jarak henti kendaraan saat ini (untuk shuttle memakai model sentakan rem yang sebenarnya)
    const stopD = opts && opts.stopDist !== undefined ? opts.stopDist : stopDistance(veh.v, aB);
    const need = stopD + 12 + veh.len / 2;
    const want = Math.max(need, 22);
    const from = opts && opts.start ? opts.start : { link: veh.link, s: veh.s, path: veh.path };
    // cari lajur lurus di jalur veh sejauh want
    let link = from.link;
    let s = from.s + want;
    let k = -1;
    while (link && s > link.len) {
      s -= link.len;
      k++;
      link = from.path[k];
    }
    if (!link) return { ok: false, reason: 'rute' };
    if (link.kind !== 'lane' || link.ring !== null || s < 3 || s > link.len - 3) return { ok: false, reason: 'simpang' };
    const P = link.poly.at(s, {});
    const road = this.city.roadById.get(link.roadId);
    const half = road ? road.half : 3;
    // pusat jalan: lajur kiri berada setengah lebar lajur ke kiri dari garis tengah jalan dua arah
    const lx = Math.sin(P.h);
    const lz = -Math.cos(P.h);
    const cOff = road && !road.ow ? link.width / 2 : 0;
    const cx = P.x - lx * cOff;
    const cz = P.z - lz * cOff;
    const X = this.makeTempCrossing(cx, cz, P.h, 2 * half + 0.4);
    const why = { reason: '' };
    if (!this.canCross(X, why)) {
      this.dropTempCrossing(X);
      return { ok: false, reason: why.reason || 'dekat' };
    }
    // pejalan kaki muncul di tepi kiri (trotoar), berjalan menyeberang ke kanan
    const start = [cx + lx * (half + 0.9), cz + lz * (half + 0.9)];
    const end = [cx - lx * (half + 0.9), cz - lz * (half + 0.9)];
    const edge = { id: -1, a: -1, b: -1, kind: 'x', poly: null, len: 0, xing: X };
    edge.poly = new (this.city.links[0].poly.constructor)([start, end]);
    edge.len = edge.poly.len;
    const p = this.make(edge, 0, true);
    p.state = 'cross';
    p.test = true;
    p.xing = X;
    p.speed = 1.35;
    X.reserved.add(p);
    this.peds.push(p);
    return { ok: true, dist: want - veh.len / 2, need: stopD, reason: '' };
  }

  makeTempCrossing(x, z, h, len) {
    const X = { id: -1 - this.temp.length, x, z, h, len, w: 3, ux: Math.cos(h), uz: Math.sin(h), links: [], reserved: new Set(), signal: null, temp: true };
    this.city.linkCrossing(X);
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
    // lanjut berjalan di trotoar terdekat bila ada, bila tidak menghilang
    let best = null;
    for (const e of this.city.walkEdges) {
      e.poly.project(p.x, p.z, PR);
      const d = Math.sqrt(PR.d2);
      if (d < 3 && (!best || d < best.d)) best = { e, t: PR.s, d };
    }
    if (best && !this.blockedAt(p, best.e, true, Math.max(0, Math.min(best.e.len, best.t)), true)) {
      p.test = false;
      p.state = 'walk';
      p.edge = best.e;
      p.fwd = true;
      p.t = Math.max(0, Math.min(best.e.len, best.t));
      p.xing = null;
      this.place(p);
    } else this.remove(p);
  }

  // ===== tampilan =====

  sync(alpha) {
    const st = SYNC;
    const ps = this.peds;
    st.rain = this.app.weather.cur.rain;
    let n = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      let dh = p.h - p.ph;
      if (dh > Math.PI) dh -= Math.PI * 2;
      if (dh < -Math.PI) dh += Math.PI * 2;
      st.x = p.px + (p.x - p.px) * alpha;
      st.z = p.pz + (p.z - p.pz) * alpha;
      st.h = p.ph + dh * alpha;
      st.y = p.state === 'cross' ? 0.06 : 0.04;
      st.scale = p.scale;
      st.phase = p.phase;
      st.moving = p.moving;
      st.body = p.body;
      st.skin = p.skin;
      st.pants = p.pants;
      this.renderer.set(n++, st);
      if (n >= this.max + 10) break;
    }
    this.renderer.commit(n);
  }
}

const SYNC = { x: 0, z: 0, h: 0, y: 0, scale: 1, phase: 0, moving: false, body: null, skin: null, pants: null, rain: 0 };
const STACK = [];
const WHY = { reason: '' };
const PRED_T = [0.8, 1.6];
