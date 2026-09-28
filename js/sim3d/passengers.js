// Penumpang LiveShuttle: menunggu di halte dengan tujuan halte lain, naik dan turun lewat pintu kiri
// saat shuttle berhenti, lalu duduk di kabin (terlihat dari luar kaca).
//
// Orang yang sedang berjalan dari atau ke pintu disebut "pejalan halte". Mereka berjalan hanya saat
// shuttle diam dengan pintu terbuka dan berhenti 0,5 m dari badan shuttle, jadi tidak pernah
// bersentuhan dengan kendaraan. Penumpang yang turun berjalan ke trotoar lalu menjadi pejalan kaki
// biasa.
import * as THREE from '../vendor/three.bundle.min.js';
import { pedestrian as pedModel } from './models/index.js';
import { SH } from './drive.js';

const MAX_WAIT = 6;
const WALK_V = 1.25;
const SLOTS = [-0.4, 0.4, -1.2, 1.2, -2.0, 2.0];
const PANTS = ['#2b3445', '#3d3a36', '#58606b', '#1f2a3a', '#6b5a4a'];

export class Passengers {
  constructor(app, ego) {
    this.app = app;
    this.ego = ego;
    this.city = app.city;
    this.capacity = SH.seats || 12;
    this.waiting = this.city.halte.map(() => []);
    this.onboard = [];
    this.walkers = [];
    this.nextId = 1;
    this.stats = { boarded: 0, alighted: 0, called: 0 };
    this.renderer = pedModel.createInstanced({ res: app.res, scene: app.scene }, 48);
    const rng = app.rng;
    this.spawnT = this.city.halte.map(() => 20 + rng() * 50);
    this.O = {};
    this.PR = {};
    // beberapa penumpang sudah menunggu saat simulasi dimulai
    this.city.halte.forEach((h, i) => {
      const n = 1 + Math.floor(rng() * 3);
      for (let k = 0; k < n; k++) this.addWaiting(i);
    });
    this.stop = null;
  }

  makePerson(from) {
    const rng = this.app.rng;
    const H = this.city.halte.length;
    let dest = Math.floor(rng() * (H - 1));
    if (dest >= from) dest++;
    return {
      id: this.nextId++,
      from,
      dest,
      scale: 0.9 + rng() * 0.18,
      body: new THREE.Color(pedModel.CLOTH[Math.floor(rng() * pedModel.CLOTH.length)]),
      skin: new THREE.Color(pedModel.SKIN[Math.floor(rng() * pedModel.SKIN.length)]),
      pants: new THREE.Color(PANTS[Math.floor(rng() * PANTS.length)]),
      phase: rng() * 6,
    };
  }

  addWaiting(i) {
    const list = this.waiting[i];
    if (list.length >= MAX_WAIT) return null;
    const p = this.makePerson(i);
    list.push(p);
    return p;
  }

  /** Panggil penumpang di halte i (alat Jelajah). */
  call(i, n = 3) {
    if (!(i >= 0 && i < this.waiting.length)) return 0;
    let k = 0;
    for (let j = 0; j < n; j++) if (this.addWaiting(i)) k++;
    this.stats.called += k;
    return k;
  }

  /** Posisi menunggu ke-k di halte i (di bawah atap halte, menghadap jalan). */
  slot(i, k, out) {
    const h = this.city.halte[i];
    const [sx, sz] = h.shelter;
    const c = Math.cos(h.h);
    const s = Math.sin(h.h);
    const u = SLOTS[k % SLOTS.length];
    // sedikit ke arah jalan dari pusat atap (sisi kanan halte = arah jalan)
    const toward = 0.35;
    out.x = sx + c * u - s * toward;
    out.z = sz + s * u + c * toward;
    out.h = h.h + Math.PI / 2; // menghadap ke kanan arah jalan, yaitu ke badan jalan
    return out;
  }

  /** Titik di luar pintu shuttle (0,5 m dari badan). */
  doorPoint(out, extra = 0) {
    const v = this.ego.veh;
    const c = Math.cos(v.h);
    const s = Math.sin(v.h);
    const u = 0.33;
    const w = SH.hw + 0.5 + extra; // ke kiri
    out.x = v.x + c * u + s * w;
    out.z = v.z + s * u - c * w;
    return out;
  }

  // ===== proses di halte =====

  beginStop(i) {
    const alight = this.onboard.filter((p) => p.dest === i);
    this.stop = { i, t: 0, next: 0.6, alightLeft: alight.length, boarded: 0, alighted: 0, phase: alight.length ? 'turun' : 'naik' };
  }

  /** Langkah proses naik turun. Mengembalikan true bila selesai (tidak ada lagi yang naik atau turun). */
  stepStop(dt) {
    const st = this.stop;
    if (!st) return true;
    st.t += dt;
    st.next -= dt;
    if (st.phase === 'turun') {
      if (st.next <= 0) {
        const k = this.onboard.findIndex((p) => p.dest === st.i);
        if (k < 0) st.phase = 'naik';
        else {
          const p = this.onboard.splice(k, 1)[0];
          this.spawnAlight(p, st.i);
          st.alighted++;
          this.stats.alighted++;
          st.next = 1.0;
        }
      }
    } else if (st.phase === 'naik') {
      if (st.next <= 0) {
        const q = this.waiting[st.i];
        const busy = this.walkers.filter((w) => w.kind === 'naik').length;
        if (q.length && this.onboard.length + busy < this.capacity) {
          const p = q.shift();
          this.spawnBoard(p, st.i);
          st.next = 1.1;
        } else if (!busy) st.phase = 'selesai';
      }
    }
    if (st.phase !== 'selesai') return false;
    // tunggu sampai semua pejalan halte cukup jauh dari pintu
    for (const w of this.walkers) if (w.kind === 'naik' || w.near) return false;
    return true;
  }

  endStop() {
    this.stop = null;
  }

  spawnBoard(p, i) {
    const a = this.slot(i, 0, {});
    const d = this.doorPoint({});
    this.walkers.push({ p, kind: 'naik', x: a.x, z: a.z, h: a.h, px: a.x, pz: a.z, ph: a.h, pts: [[d.x, d.z]], near: true, moving: true, t: 0 });
  }

  spawnAlight(p, i) {
    const d = this.doorPoint({});
    const a = this.slot(i, 1, {});
    // tujuan: titik trotoar terdekat dari halte, lalu menjadi pejalan kaki biasa
    const walk = this.nearestWalk(a.x, a.z);
    const pts = [[a.x, a.z]];
    if (walk) pts.push([walk.x, walk.z]);
    this.walkers.push({ p, kind: 'turun', x: d.x, z: d.z, h: a.h + Math.PI, px: d.x, pz: d.z, ph: a.h + Math.PI, pts, walk, near: true, moving: true, t: 0 });
  }

  nearestWalk(x, z) {
    let best = null;
    for (const e of this.city.walkEdges) {
      const bb = e.poly.bb;
      if (x < bb[0] - 12 || x > bb[2] + 12 || z < bb[1] - 12 || z > bb[3] + 12) continue;
      e.poly.project(x, z, this.PR);
      const s = Math.max(0, Math.min(e.len, this.PR.s));
      const o = e.poly.at(s, this.O);
      const d = Math.hypot(o.x - x, o.z - z);
      if (!best || d < best.d) best = { e, s, d, x: o.x, z: o.z };
    }
    return best && best.d < 10 ? best : null;
  }

  // ===== langkah =====

  step(dt) {
    const rng = this.app.rng;
    // penumpang baru datang ke halte secara acak
    for (let i = 0; i < this.spawnT.length; i++) {
      this.spawnT[i] -= dt;
      if (this.spawnT[i] <= 0) {
        this.spawnT[i] = 35 + rng() * 55;
        if (!(this.stop && this.stop.i === i)) this.addWaiting(i);
      }
    }
    const veh = this.ego.veh;
    for (let k = this.walkers.length - 1; k >= 0; k--) {
      const w = this.walkers[k];
      w.px = w.x;
      w.pz = w.z;
      w.ph = w.h;
      w.t += dt;
      if (!w.pts.length) {
        this.finishWalker(w, k);
        continue;
      }
      // pintu harus terbuka penuh sebelum orang lewat
      if (this.ego.door < 0.98 && (w.kind === 'naik' ? w.pts.length === 1 : w.t < 0.2)) {
        w.moving = false;
        continue;
      }
      const [tx, tz] = w.pts[0];
      const dx = tx - w.x;
      const dz = tz - w.z;
      const d = Math.hypot(dx, dz);
      const stepLen = WALK_V * dt;
      w.moving = true;
      w.p.phase += stepLen * 2.6;
      if (d <= stepLen) {
        w.x = tx;
        w.z = tz;
        w.pts.shift();
      } else {
        w.x += (dx / d) * stepLen;
        w.z += (dz / d) * stepLen;
        w.h = Math.atan2(dz, dx);
      }
      // dekat pintu? (shuttle tidak boleh berangkat selama ada orang dalam 1,5 m dari badan)
      const c = Math.cos(veh.h);
      const s = Math.sin(veh.h);
      const rx = w.x - veh.x;
      const rz = w.z - veh.z;
      const lx = rx * c + rz * s;
      const lz = -rx * s + rz * c;
      const ex = Math.max(0, Math.abs(lx) - SH.hl);
      const ez = Math.max(0, Math.abs(lz) - SH.hw);
      w.near = Math.hypot(ex, ez) < 1.5;
    }
  }

  finishWalker(w, k) {
    this.walkers.splice(k, 1);
    if (w.kind === 'naik') {
      if (this.onboard.length < this.capacity) {
        this.onboard.push(w.p);
        this.stats.boarded++;
        if (this.stop) this.stop.boarded++;
        this.app.guideEvent('naik', this.onboard.length);
      } else this.waiting[w.p.from].unshift(w.p);
      return;
    }
    // turun: menjadi pejalan kaki biasa di trotoar terdekat
    const walk = w.walk;
    if (walk) {
      const peds = this.app.peds;
      const p = peds.make(walk.e, walk.s, this.app.rng() < 0.5);
      p.body = w.p.body;
      p.skin = w.p.skin;
      p.pants = w.p.pants;
      p.scale = w.p.scale;
      peds.peds.push(p);
    }
  }

  /** Orang di sekitar halte yang harus ikut diperiksa perisai dan pemantau kontak. */
  people() {
    return this.walkers;
  }

  // ===== tampilan =====

  sync(alpha) {
    const st = SYNC;
    st.rain = this.app.weather.cur.rain;
    let n = 0;
    const cap = 48;
    const O = this.O;
    for (let i = 0; i < this.waiting.length && n < cap; i++) {
      const list = this.waiting[i];
      for (let k = 0; k < list.length && n < cap; k++) {
        const p = list[k];
        this.slot(i, k + (this.stop && this.stop.i === i ? 1 : 0), O);
        st.x = O.x;
        st.z = O.z;
        st.h = O.h;
        st.y = 0.04;
        st.scale = p.scale;
        st.phase = p.phase;
        st.moving = false;
        st.body = p.body;
        st.skin = p.skin;
        st.pants = p.pants;
        this.renderer.set(n++, st);
      }
    }
    for (const w of this.walkers) {
      if (n >= cap) break;
      let dh = w.h - w.ph;
      if (dh > Math.PI) dh -= Math.PI * 2;
      if (dh < -Math.PI) dh += Math.PI * 2;
      st.x = w.px + (w.x - w.px) * alpha;
      st.z = w.pz + (w.z - w.pz) * alpha;
      st.h = w.ph + dh * alpha;
      st.y = 0.05;
      st.scale = w.p.scale;
      st.phase = w.p.phase;
      st.moving = w.moving;
      st.body = w.p.body;
      st.skin = w.p.skin;
      st.pants = w.p.pants;
      this.renderer.set(n++, st);
    }
    this.renderer.commit(n);
  }
}

const SYNC = { x: 0, z: 0, h: 0, y: 0, scale: 1, phase: 0, moving: false, body: null, skin: null, pants: null, rain: 0 };
