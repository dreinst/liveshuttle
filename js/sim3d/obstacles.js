// Penghalang di jalan untuk mode Jelajah: kendaraan parkir di lajur, galian jalan, dan jalan ditutup.
//
// Kendaraan parkir dan galian menutup satu lajur. Semua kendaraan melihatnya sebagai kendaraan diam
// di lajur itu (lewat data okupansi) dan melewatinya dengan passing.js bila bisa. Jalan yang ditutup
// tidak dipakai rute A* dan tidak dipilih NPC; kendaraan yang sudah di jalan itu keluar seperti biasa.
import * as THREE from '../vendor/three.bundle.min.js';
import { VEHICLE_MODELS, VEHICLE_DIMS } from './models/index.js';
import { buildRoadworks, buildClosure, DIMS as WORKS } from './models/roadworks.js';
import { DYN } from './traffic.js';
import { disposeTree } from './util.js';

const MAX_OBSTACLES = 6;
export const OBSTACLE_LABEL = { parkir: 'Kendaraan parkir di lajur', galian: 'Galian jalan' };

export class Obstacles {
  constructor(app) {
    this.app = app;
    this.city = app.city;
    this.list = [];
    this.nextId = 1;
    this.closed = new Map(); // roadId -> { x, z, name, meshes }
    this.group = new THREE.Group();
    this.group.name = 'penghalang';
    app.scene.add(this.group);
    const ctx = { res: app.res, scene: this.group };
    this.parked = { car: VEHICLE_MODELS.car.createInstanced(ctx, MAX_OBSTACLES), angkot: VEHICLE_MODELS.angkot.createInstanced(ctx, MAX_OBSTACLES) };
    this.PR = {};
    this.O = {};
    this.changed = 0;
  }

  // ===== kendaraan parkir dan galian =====

  /** Periksa apakah penghalang jenis kind boleh diletakkan di lajur lane, titik s. '' bila boleh. */
  validate(kind, lane, s) {
    const len = kind === 'galian' ? WORKS.len : VEHICLE_DIMS.car.len + 0.4;
    if (!lane || lane.kind !== 'lane') return 'bukan-lajur';
    if (lane.ring !== null) return 'bundaran';
    if (lane.portal) return 'tepi-peta';
    const side = this.app.passing.sideLane(lane);
    if (!side) return 'satu-lajur';
    const s0 = s - len / 2;
    const s1 = s + len / 2;
    if (s0 < 24 || s1 > lane.stopLen - 24) return 'dekat-simpang';
    if (this.list.length >= MAX_OBSTACLES) return 'penuh';
    const P = lane.poly.at(s, this.O);
    const px = P.x;
    const pz = P.z;
    for (const X of this.city.crossings) if (Math.hypot(X.x - px, X.z - pz) < 26 + len / 2) return 'dekat-zebra';
    for (const h of this.city.halte) if (Math.hypot(h.x - px, h.z - pz) < 28 + len / 2) return 'dekat-halte';
    for (const ob of this.list) if (Math.hypot(ob.x - px, ob.z - pz) < 45) return 'dekat-penghalang';
    // jangan menimpa kendaraan, dan kendaraan yang mendekat harus masih bisa berhenti dengan nyaman
    for (const w of this.app.traffic.all) {
      if (Math.hypot(w.x - px, w.z - pz) < len / 2 + w.len / 2 + 3) return 'ada-kendaraan';
      if (w.link === lane && w.s < s0) {
        const gap = s0 - (w.s + w.len / 2);
        const need = w.v * 1.0 + (w.v * w.v) / (2 * 2.0) + 6;
        if (gap < need) return 'terlalu-dekat';
      }
      if (w.path && w.link !== lane && w.path[0] && (w.path[0] === lane || (w.path[1] === lane && w.path[0].kind === 'conn'))) {
        const gap = w.link.len - w.s - w.len / 2 + (w.path[0] === lane ? 0 : w.path[0].len) + s0;
        const need = w.v * 1.0 + (w.v * w.v) / (2 * 2.0) + 6;
        if (gap < need) return 'terlalu-dekat';
      }
    }
    for (const p of this.app.peds.peds) if (Math.hypot(p.x - px, p.z - pz) < len / 2 + 2.5 && p.state === 'cross') return 'ada-pejalan';
    return '';
  }

  /** Letakkan penghalang. Mengembalikan { ok, reason, ob }. */
  add(kind, lane, s, opts = {}) {
    const why = this.validate(kind, lane, s);
    if (why) return { ok: false, reason: why };
    const rng = this.app.rng;
    const vtype = kind === 'parkir' ? opts.vtype || (rng() < 0.5 ? 'angkot' : 'car') : null;
    const len = kind === 'galian' ? WORKS.len : VEHICLE_DIMS[vtype].len;
    const hw = kind === 'galian' ? WORKS.wid / 2 : VEHICLE_DIMS[vtype].wid / 2;
    // geser sedikit ke tepi kiri lajur (sisi trotoar), tetap menutup lajur
    const lat = kind === 'galian' ? -0.15 : -Math.min(0.45, Math.max(0, lane.width / 2 - hw - 0.25));
    const o = lane.poly.atSmooth(s, {});
    const ob = {
      id: this.nextId++,
      kind,
      vtype,
      lane,
      s,
      s0: s - len / 2 - (kind === 'galian' ? 0.2 : 0),
      s1: s + len / 2 + (kind === 'galian' ? 0.2 : 0),
      len,
      hw,
      lat,
      x: o.x - Math.sin(o.h) * lat,
      z: o.z + Math.cos(o.h) * lat,
      h: o.h,
      name: lane.name || '',
      mesh: null,
      color: null,
    };
    ob.proxy = { id: 700000 + ob.id, type: kind, len: ob.s1 - ob.s0, hw, wid: hw * 2, v: 0, dyn: DYN.car, static: true, obstacle: ob, grants: [], x: ob.x, z: ob.z, h: ob.h };
    if (kind === 'galian') {
      ob.mesh = buildRoadworks(this.app.res, ob.x, ob.z, ob.h);
      this.group.add(ob.mesh);
    } else {
      const pal = VEHICLE_MODELS[vtype].PALETTE;
      ob.color = new THREE.Color(pal[Math.floor(rng() * pal.length)]);
    }
    this.list.push(ob);
    this.changed++;
    this.app.onRoadChange('penghalang', ob);
    return { ok: true, ob, reason: '' };
  }

  remove(ob) {
    const i = this.list.indexOf(ob);
    if (i < 0) return false;
    this.list.splice(i, 1);
    if (ob.mesh) {
      this.group.remove(ob.mesh);
      ob.mesh.geometry.dispose();
    }
    this.changed++;
    this.app.onRoadChange('penghalang-diangkat', ob);
    return true;
  }

  clear() {
    for (const ob of this.list.slice()) this.remove(ob);
  }

  /**
   * Letakkan penghalang di depan shuttle, di lajur rutenya, pada jarak yang aman (mulai sekitar 45 m,
   * dicari sampai 250 m ke depan). Mengembalikan { ok, reason, ob, dist }.
   */
  placeAhead(kind) {
    const ego = this.app.ego;
    const veh = ego.veh;
    if (ego.mode === 'manual') return { ok: false, reason: 'manual' };
    if (ego.state === 'di-halte') return { ok: false, reason: 'di-halte' };
    const links = [veh.link].concat(veh.path, veh.route || []);
    let base = -veh.s;
    let lastWhy = 'tidak-ada-tempat';
    const minAhead = Math.max(45, (veh.v * veh.v) / 2 + 30);
    for (const L of links) {
      if (L.kind === 'lane') {
        for (let s = 30; s < L.len - 30; s += 6) {
          const ahead = base + s;
          if (ahead < minAhead || ahead > 260) continue;
          const why = this.validate(kind, L, s);
          if (!why) {
            const r = this.add(kind, L, s);
            if (r.ok) r.dist = ahead;
            return r;
          }
          lastWhy = why;
        }
      }
      base += L.len;
      if (base > 260) break;
    }
    return { ok: false, reason: lastWhy };
  }

  /** Letakkan penghalang di lajur terdekat dari titik (x, z) (misalnya klik di jalan). */
  placeNear(kind, x, z) {
    const best = this.city.nearestLink(x, z, (l) => l.kind === 'lane' && l.ring === null);
    if (!best || best.d > 4) return { ok: false, reason: 'bukan-jalan' };
    return this.add(kind, best.link, best.s);
  }

  /** Daftarkan penghalang ke data okupansi lajur (dipanggil tiap langkah). */
  register(traffic) {
    for (const ob of this.list) traffic.occAdd(ob.lane, ob.proxy, (ob.s0 + ob.s1) / 2);
  }

  // ===== jalan ditutup =====

  roadAt(x, z) {
    const best = this.city.nearestLink(x, z, (l) => l.kind === 'lane' && l.roadId >= 0);
    if (!best || best.d > 5) return null;
    return best.link.roadId;
  }

  isClosed(roadId) {
    return this.closed.has(roadId);
  }

  toggleRoad(roadId) {
    if (this.closed.has(roadId)) return this.openRoad(roadId);
    return this.closeRoad(roadId);
  }

  closeRoad(roadId) {
    const lanes = this.app.passing.byRoad.get(roadId);
    if (!lanes || !lanes.length) return { ok: false, reason: 'bukan-jalan' };
    if (this.closed.has(roadId)) return { ok: true, closed: true };
    // halte di jalan ini tidak boleh ditutup (shuttle harus tetap bisa berhenti di sana)
    for (const h of this.city.halte) if (lanes.includes(h.link)) return { ok: false, reason: 'ada-halte' };
    const meshes = [];
    const road = this.city.roadById.get(roadId);
    for (const L of lanes) {
      L.closed = true;
      for (const c of L.prev) c.closed = true;
      // pembatas di awal tiap lajur (tempat kendaraan masuk)
      const s = Math.min(2.5, L.len / 2);
      const o = L.poly.at(s, {});
      const m = buildClosure(this.app.res, o.x, o.z, o.h, L.width - 0.2);
      this.group.add(m);
      meshes.push(m);
    }
    const mid = road.p[Math.floor(road.p.length / 2)];
    this.closed.set(roadId, { roadId, x: mid[0], z: mid[1], name: road.name || '', meshes });
    this.changed++;
    this.app.onRoadChange('tutup', { roadId, name: road.name || '' });
    return { ok: true, closed: true, name: road.name || '' };
  }

  openRoad(roadId) {
    const c = this.closed.get(roadId);
    if (!c) return { ok: false, reason: 'tidak-ditutup' };
    const lanes = this.app.passing.byRoad.get(roadId) || [];
    for (const L of lanes) {
      L.closed = false;
      for (const k of L.prev) k.closed = false;
    }
    for (const m of c.meshes) {
      this.group.remove(m);
      m.geometry.dispose();
    }
    this.closed.delete(roadId);
    this.changed++;
    this.app.onRoadChange('buka', { roadId, name: c.name });
    return { ok: true, closed: false, name: c.name };
  }

  closedList() {
    return Array.from(this.closed.values());
  }

  /** Lajur yang tertutup penghalang dan tidak bisa dilewati (untuk rute shuttle). */
  impassable(link) {
    for (const ob of this.list) if (ob.lane === link && !this.app.passing.sideLane(link)) return true;
    return false;
  }

  // ===== tampilan =====

  sync(night, simTime) {
    const blinkOn = Math.floor(simTime * 1.6) % 2 === 0;
    const R = this.parked;
    let nc = 0;
    let na = 0;
    for (const ob of this.list) {
      if (ob.kind !== 'parkir') continue;
      const r = ob.vtype === 'angkot' ? R.angkot : R.car;
      const i = ob.vtype === 'angkot' ? na++ : nc++;
      SYNC.x = ob.x;
      SYNC.z = ob.z;
      SYNC.h = ob.h;
      SYNC.color = ob.color;
      SYNC.braking = false;
      SYNC.night = night;
      SYNC.blink = 0;
      SYNC.hazard = true;
      SYNC.blinkOn = blinkOn;
      r.set(i, SYNC);
    }
    R.car.commit(nc);
    R.angkot.commit(na);
  }

  dispose() {
    disposeTree(this.group);
  }
}

const SYNC = { x: 0, z: 0, h: 0, y: 0, color: null, braking: false, night: false, blink: 0, hazard: false, blinkOn: false };
