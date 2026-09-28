// Uji skenario: menaruh rintangan (mobil mogok, kerucut, kardus) dan memicu pejalan kaki
// yang menyeberang mendadak di depan mobil otonom.
import * as THREE from '../vendor/three.bundle.min.js';
import { segPoint } from './roadgraph.js';
import { clamp } from './util.js';

export const OBSTACLE_TYPES = {
  mogok: { label: 'Mobil mogok', hl: 2.15, hw: 0.9, height: 1.5, kind: 'obb', gap: 9 },
  kerucut: { label: 'Kerucut', hl: 0.3, hw: 0.3, height: 0.75, kind: 'circle', gap: 1.5 },
  kardus: { label: 'Kardus', hl: 0.35, hw: 0.31, height: 0.56, kind: 'obb', gap: 2 },
};
const MAX_OBS = 12;

export class Scenarios {
  constructor(app) {
    this.app = app;
    this.obstacles = [];
    this.nextId = 1;
    this.selected = 'mogok';
    this.clickArmed = false;
    this.blink = 0;
    this.tmp = {};
    this.buildTemplates();
  }

  buildTemplates() {
    const res = this.app.res;
    const lam = (c) => res.add(new THREE.MeshLambertMaterial({ color: c }));
    const g = (geo) => res.add(geo);
    this.T = {
      body: g(new THREE.BoxGeometry(4.3, 0.7, 1.8).translate(0, 0.62, 0)),
      cabin: g(new THREE.BoxGeometry(2.25, 0.56, 1.6).translate(-0.25, 1.24, 0)),
      skirt: g(new THREE.BoxGeometry(3.8, 0.36, 1.84).translate(0, 0.3, 0)),
      hazard: g(new THREE.BoxGeometry(0.12, 0.12, 0.3)),
      tri: g(new THREE.ConeGeometry(0.42, 0.75, 3).translate(0, 0.37, 0)),
      cone: g(new THREE.ConeGeometry(0.3, 0.75, 14).translate(0, 0.4, 0)),
      band: g(new THREE.CylinderGeometry(0.19, 0.23, 0.13, 14).translate(0, 0.42, 0)),
      coneBase: g(new THREE.BoxGeometry(0.56, 0.05, 0.56).translate(0, 0.025, 0)),
      box: g(new THREE.BoxGeometry(0.7, 0.55, 0.62).translate(0, 0.275, 0)),
      tape: g(new THREE.BoxGeometry(0.72, 0.56, 0.1).translate(0, 0.275, 0)),
    };
    this.M = {
      body: lam('#7b8494'),
      cabin: lam('#1b2433'),
      skirt: lam('#15191f'),
      hazard: res.add(new THREE.MeshBasicMaterial({ color: '#f59e0b' })),
      tri: lam('#ef4444'),
      cone: lam('#f97316'),
      band: lam('#f8fafc'),
      coneBase: lam('#1f2937'),
      box: lam('#b07a4a'),
      tape: lam('#d9b98c'),
    };
  }

  makeMesh(type) {
    const { T, M } = this;
    const g = new THREE.Group();
    const add = (geo, mat, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      g.add(m);
      return m;
    };
    if (type === 'mogok') {
      add(T.body, M.body);
      add(T.cabin, M.cabin);
      add(T.skirt, M.skirt);
      for (const [x, z] of [
        [2.1, 0.75],
        [2.1, -0.75],
        [-2.1, 0.75],
        [-2.1, -0.75],
      ])
        add(T.hazard, M.hazard, x, 0.78, z);
      add(T.tri, M.tri, -6.5, 0, 0);
    } else if (type === 'kerucut') {
      add(T.coneBase, M.coneBase);
      add(T.cone, M.cone);
      add(T.band, M.band);
    } else {
      add(T.box, M.box);
      add(T.tape, M.tape);
    }
    return g;
  }

  /** Tambah rintangan di lajur jalan pada posisi s. */
  add(type, lane, s) {
    const { app } = this;
    const def = OBSTACLE_TYPES[type];
    const p = lane.poly.at(s, this.tmp);
    const o = {
      id: `obs:${this.nextId++}`,
      type,
      cls: type,
      lane,
      s,
      x: p.x,
      z: p.z,
      h: p.h,
      hl: def.hl,
      hw: def.hw,
      r: def.hl,
      height: def.height,
      kind: def.kind,
      vx: 0,
      vz: 0,
    };
    o.mesh = this.makeMesh(type);
    o.mesh.position.set(o.x, 0, o.z);
    o.mesh.rotation.y = -o.h + (type === 'kardus' ? 0.35 : 0);
    app.scene.add(o.mesh);
    this.obstacles.push(o);
    while (this.obstacles.length > MAX_OBS) this.remove(this.obstacles[0]);
    return o;
  }

  remove(o) {
    const i = this.obstacles.indexOf(o);
    if (i >= 0) this.obstacles.splice(i, 1);
    o.removed = true;
    this.app.scene.remove(o.mesh);
    if (this.app.perception) this.app.perception.forget(o.id);
  }

  clear() {
    for (const o of this.obstacles.slice()) this.remove(o);
  }

  /** Mobil NPC yang terlalu dekat dengan titik rintangan. */
  carsNear(lane, s, margin) {
    return this.app.traffic.cars.filter((c) => (c.lane === lane || c.oldLane === lane) && Math.abs(c.s - s) < margin);
  }

  spotTaken(lane, s, type) {
    const gap = OBSTACLE_TYPES[type].gap;
    return this.obstacles.some((o) => o.lane === lane && Math.abs(o.s - s) < Math.max(gap, OBSTACLE_TYPES[o.type].gap));
  }

  /** Cari titik di rute mobil sekitar dist meter di depan, di tengah ruas jalan. */
  pointAhead(dist, minS = 14, endMargin = 14, exact = false) {
    const pl = this.app.planner;
    const r = pl.route;
    if (!r) return null;
    let left = dist;
    for (let i = r.ri; i < r.items.length; i++) {
      const it = r.items[i];
      const s0 = i === r.ri ? r.s : 0;
      const remain = it.len - s0;
      if (it.type === 'road') {
        const s = s0 + left;
        if (s <= it.len - endMargin) {
          if (s >= minS) return { item: it, s, current: i === r.ri, index: i };
          if (i !== r.ri && !exact) return { item: it, s: minS, current: false, index: i };
        }
      }
      left -= remain;
      if (left < 0) left = 0;
    }
    return null;
  }

  /**
   * Titik untuk rintangan, sedekat mungkin dengan 40 m di depan. Bila 40 m jatuh di ujung ruas atau
   * di persimpangan, pilih yang lebih dekat ke 40 m: ujung ruas sekarang (asal masih cukup jauh
   * untuk mengerem dengan nyaman) atau ruas berikutnya, minimal 30 m setelah persimpangan supaya
   * mobil sempat berhenti di jalan lurus dan menyalip.
   */
  obstacleSpot() {
    const { app } = this;
    const r = app.planner.route;
    if (!r) return null;
    const want = 40;
    const later = this.pointAhead(want, 30, 14);
    const cur = r.items[r.ri];
    let best = later;
    let bestD = later ? this.distAlong(later) : Infinity;
    if (cur.type === 'road' && !(later && later.current)) {
      const sA = cur.len - 14;
      const dA = sA - r.s;
      const v = Math.max(0, app.ego.v);
      if (dA >= Math.max(25, v * 2.6 + 8) && Math.abs(dA - want) <= Math.abs(bestD - want)) {
        best = { item: cur, s: sA, current: true, index: r.ri };
        bestD = dA;
      }
    }
    return best;
  }

  /** Jarak sepanjang rute dari mobil ke titik hasil pointAhead. */
  distAlong(at) {
    const r = this.app.planner.route;
    let d = 0;
    for (let i = r.ri; i < at.index; i++) d += r.items[i].len - (i === r.ri ? r.s : 0);
    return d + at.s - (at.index === r.ri ? r.s : 0);
  }

  /** Taruh rintangan sekitar 40 m di depan pada lajur mobil. */
  placeAhead(type = this.selected) {
    const { app } = this;
    this.selected = type;
    const at = this.obstacleSpot();
    if (!at) {
      app.toast('Belum ada ruas jalan yang cocok di depan. Coba lagi sebentar.');
      return null;
    }
    const k = at.current ? app.planner.kNow : at.item.kStart;
    const lane = at.item.seg.lanes[k];
    let s = at.s;
    let tries = 0;
    while (tries < 6 && (this.carsNear(lane, s, 6.5).length || this.spotTaken(lane, s, type)) && s + 6 < lane.len - 12) {
      s += 6;
      tries++;
    }
    for (const c of this.carsNear(lane, s, 6.5)) app.traffic.removeCar(c);
    if (this.spotTaken(lane, s, type)) {
      app.toast('Tempat itu sudah ada rintangan.');
      return null;
    }
    const o = this.add(type, lane, s);
    const d = Math.round(this.distAlong({ index: at.index, s }));
    const where = at.current ? '' : ', setelah persimpangan';
    app.toast(`${OBSTACLE_TYPES[type].label} ditaruh ${d} m di depan${where}, di ${k === 0 ? 'lajur kiri' : 'lajur kanan'}.`);
    app.counters.placed++;
    return o;
  }

  /** Taruh rintangan di titik yang diklik atau diketuk (Mode Bebas). */
  placeAt(x, z, type = this.selected) {
    const { app } = this;
    let best = null;
    let bd = Infinity;
    const pr = {};
    for (const lane of app.graph.roadLanes) {
      lane.poly.project(x, z, pr);
      if (pr.s < 0 || pr.s > lane.len) continue;
      const d = Math.abs(pr.lat);
      if (d < 1.75 && d < bd) {
        bd = d;
        best = { lane, s: pr.s };
      }
    }
    if (!best) {
      app.toast('Klik atau ketuk tepat di lajur jalan, bukan di persimpangan atau trotoar.');
      return null;
    }
    // Minimal 22 m dari persimpangan supaya mobil sempat berhenti di jalan lurus sebelum menyalip.
    const s = clamp(best.s, 22, best.lane.len - 10);
    const p = best.lane.poly.at(s, this.tmp);
    if (Math.hypot(p.x - app.ego.x, p.z - app.ego.z) < 25) {
      app.toast('Terlalu dekat dengan mobil otonom. Pilih titik yang lebih jauh.');
      return null;
    }
    if (this.carsNear(best.lane, s, 5.5).length) {
      app.toast('Ada mobil yang sedang lewat di situ. Coba titik lain.');
      return null;
    }
    if (this.spotTaken(best.lane, s, type)) {
      app.toast('Tempat itu sudah ada rintangan.');
      return null;
    }
    const o = this.add(type, best.lane, s);
    app.toast(`${OBSTACLE_TYPES[type].label} ditaruh di ${best.lane.k === 0 ? 'lajur kiri' : 'lajur kanan'}.`);
    app.counters.placed++;
    return o;
  }

  /**
   * Pejalan kaki menyeberang mendadak. Jaraknya dihitung dari kecepatan mobil (dan licinnya jalan)
   * supaya mobil harus mengerem keras tetapi masih sempat berhenti. Bila titik itu jatuh di
   * persimpangan, pejalan kaki muncul sesaat kemudian saat mobil sudah di ruas yang lurus.
   */
  jaywalker() {
    const { app } = this;
    if (this.pendingJay) return null;
    this.pendingJay = { t: app.simTime };
    const p = this.trySpawnJay();
    if (!p && this.pendingJay) app.toast('Pejalan kaki akan muncul begitu mobil berada di ruas jalan yang lurus.');
    return p;
  }

  trySpawnJay() {
    const { app } = this;
    const pend = this.pendingJay;
    if (!pend) return null;
    const v = Math.max(0, app.ego.v);
    const bm = app.weather.fx.brakeMax;
    const extra = Math.max(0, (v * v) / (2 * bm) - (v * v) / (2 * 8.1));
    const D = clamp(v * 1.25 + 4 + extra, 12, 55);
    let at = this.pointAhead(D, 8, 6, true);
    if (!at && app.simTime - pend.t < 12) return null;
    if (!at) at = this.pointAhead(D, 8, 6);
    this.pendingJay = null;
    if (!at) {
      app.toast('Belum ada ruas jalan yang cocok di depan. Coba lagi sebentar.');
      return null;
    }
    const p = app.peds.spawnJaywalker(at.item.seg, at.s);
    app.counters.jaywalkers++;
    if (v < 5) app.toast('Pejalan kaki menyeberang. Mobil sedang pelan, jadi mungkin cukup mengerem biasa.');
    else app.toast('Awas, pejalan kaki menyeberang mendadak!', 'warn');
    return p;
  }

  register(idx) {
    for (const o of this.obstacles) idx.add(o.lane.id, o.s - o.hl, o.s + o.hl, 0, 'obs', o);
  }

  sync(dt) {
    this.blink += dt;
    const on = Math.floor(this.blink * 2) % 2 === 0;
    this.M.hazard.color.set(on ? '#fbbf24' : '#5a3b06');
  }

  /** Titik di tengah ruas untuk skenario tutorial. */
  segPoint(seg, s, lat) {
    return segPoint(seg, s, lat, {});
  }
}
