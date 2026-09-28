// Mobil lain (NPC) yang dikemudikan manusia. Mereka bergerak di graf lajur dengan model
// mengikuti kendaraan IDM, patuh lampu, tidak masuk persimpangan yang masih dipakai arah lain,
// dan tidak masuk bila lajur tujuan penuh. Dengan aturan ini mobil tidak saling tabrak dan
// tidak terkunci. Sebagai pengaman terakhir, mobil yang macet terlalu lama dipindahkan.
import * as THREE from '../vendor/three.bundle.min.js';
import { clamp } from './util.js';

/** Daftar objek per lajur (mobil, ego, rintangan, pejalan kaki) yang dibangun ulang tiap langkah. */
export class LaneIndex {
  constructor(n) {
    this.lists = Array.from({ length: n }, () => []);
    this.touched = [];
    this.pool = [];
    this.used = 0;
  }
  clear() {
    for (const id of this.touched) this.lists[id].length = 0;
    this.touched.length = 0;
    this.used = 0;
  }
  add(laneId, sB, sF, v, kind, ref) {
    let it = this.pool[this.used];
    if (!it) {
      it = {};
      this.pool.push(it);
    }
    this.used++;
    it.sB = sB;
    it.sF = sF;
    it.v = v;
    it.kind = kind;
    it.ref = ref;
    const l = this.lists[laneId];
    if (!l.length) this.touched.push(laneId);
    l.push(it);
    return it;
  }
}

export const CAR_LEN = 4.3;
export const CAR_WID = 1.8;
const IDM = { a: 1.7, b: 2.3, s0: 2.3, T: 1.25 };
/** Perlambatan nyaman menjelang tikungan (m/s²). */
const TURN_B = 1.3;
const COLORS = ['#94a3b8', '#64748b', '#cbd5e1', '#475569', '#1e3a8a', '#7c8aa5', '#9f1d1d', '#e5e7eb', '#334155', '#a16207', '#3f4b5f', '#5b6b7f'];

export function idmAccel(v, v0, gap, dv, p = IDM) {
  const free = 1 - Math.pow(v / Math.max(v0, 0.1), 4);
  if (gap === Infinity) return p.a * free;
  const sStar = p.s0 + Math.max(0, v * p.T + (v * dv) / (2 * Math.sqrt(p.a * p.b)));
  const g = Math.max(gap, 0.05);
  return p.a * (free - (sStar / g) * (sStar / g));
}

export class Traffic {
  constructor(app) {
    this.app = app;
    this.cars = [];
    this.nextId = 1;
    this.target = 30;
    this.max = 64;
    this.overlaps = 0;
    this.respawns = 0;
    this.tmp = {};
    this.buildMeshes();
  }

  /** Pilih gerakan berikutnya di persimpangan sesuai lajur yang sedang dipakai. */
  pickPlan(car) {
    const L = car.lane;
    if (L.type === 'road') {
      const closed = this.app.closedSegs;
      const open = L.next.filter((c) => !closed.has(c.next[0].seg.id));
      const opts = open.length ? open : L.next;
      let pick = opts[0];
      if (opts.length > 1) {
        const straight = opts.find((c) => c.move === 'S');
        const r = this.app.rng();
        if (straight && r < 0.5) pick = straight;
        else {
          const turns = opts.filter((c) => c !== straight);
          pick = turns.length ? turns[Math.floor(this.app.rng() * turns.length)] : opts[0];
        }
      }
      car.plan = [pick, pick.next[0]];
    } else {
      car.plan = [L.next[0]];
    }
  }

  addCar(lane, s, v = 0) {
    const rng = this.app.rng;
    const car = {
      id: this.nextId++,
      lane,
      s,
      v,
      acc: 0,
      len: CAR_LEN,
      wid: CAR_WID,
      v0: 10.5 + rng() * 3.4,
      color: new THREE.Color(COLORS[Math.floor(rng() * COLORS.length)]),
      plan: [],
      latOff: 0,
      oldLane: null,
      commit: -1,
      stuckT: 0,
      waitT: 0,
      wantLeft: false,
      braking: false,
      x: 0,
      z: 0,
      h: 0,
      vx: 0,
      vz: 0,
    };
    this.pickPlan(car);
    this.cars.push(car);
    this.place(car);
    return car;
  }

  /** Cari tempat kosong di lajur jalan acak. minEgoDist menjauhkan dari mobil otonom. */
  spawnRandom(minEgoDist = 0) {
    const { app } = this;
    const lanes = app.graph.roadLanes;
    for (let tries = 0; tries < 40; tries++) {
      const lane = lanes[Math.floor(app.rng() * lanes.length)];
      const s = 6 + app.rng() * (lane.len - 20);
      const p = lane.poly.at(s, this.tmp);
      if (minEgoDist > 0 && Math.hypot(p.x - app.ego.x, p.z - app.ego.z) < minEgoDist) continue;
      if (!this.isFree(lane, s, 9)) continue;
      return this.addCar(lane, s, 6 + app.rng() * 4);
    }
    return null;
  }

  isFree(lane, s, margin) {
    const { app } = this;
    for (const c of this.cars) {
      if ((c.lane === lane || c.oldLane === lane) && Math.abs(c.s - s) < margin) return false;
    }
    for (const o of app.scen.obstacles) if (o.lane === lane && Math.abs(o.s - s) < margin) return false;
    const e = app.ego;
    if (Math.hypot(lane.poly.at(s, this.tmp).x - e.x, this.tmp.z - e.z) < margin + 3) return false;
    return true;
  }

  removeCar(car) {
    const i = this.cars.indexOf(car);
    if (i >= 0) this.cars.splice(i, 1);
  }

  /** Samakan jumlah mobil dengan kepadatan yang dipilih. Mobil dibuang dari yang terjauh. */
  balance() {
    const { app } = this;
    const target = Math.min(this.max, this.target);
    if (this.cars.length < target) {
      this.spawnRandom(70);
    } else if (this.cars.length > target) {
      let far = null;
      let fd = 0;
      for (const c of this.cars) {
        const d = Math.hypot(c.x - app.ego.x, c.z - app.ego.z);
        if (d > fd) {
          fd = d;
          far = c;
        }
      }
      if (far && (fd > 60 || this.cars.length > target + 6)) this.removeCar(far);
    }
  }

  /** Daftarkan mobil ke indeks lajur, hitung okupansi kotak persimpangan dan permintaan lampu. */
  register(idx) {
    for (const c of this.cars) {
      idx.add(c.lane.id, c.s - c.len / 2, c.s + c.len / 2, c.v, 'car', c);
      if (c.oldLane && Math.abs(c.latOff) > 1.1) idx.add(c.oldLane.id, c.s - c.len / 2, c.s + c.len / 2, c.v, 'car', c);
    }
  }

  findLeader(car, horizon = 90) {
    const idx = this.app.laneIdx;
    let best = null;
    let bestGap = Infinity;
    let offset = -car.s;
    const half = car.len / 2;
    const check = (list, off, first, maxS) => {
      for (const it of list) {
        if (it.ref === car) continue;
        if (maxS !== undefined && it.sB > maxS) continue;
        if (first && (it.sB + it.sF) / 2 <= car.s + 0.01) continue;
        const gap = off + it.sB - half;
        if (gap < bestGap) {
          bestGap = gap;
          best = it;
        }
      }
    };
    let lane = car.lane;
    for (let li = 0; li <= car.plan.length; li++) {
      if (li > 0) lane = car.plan[li - 1];
      if (!lane) break;
      check(idx.lists[lane.id], offset, li === 0);
      if (lane.type === 'conn') {
        for (const sib of lane.fromLane.next) if (sib !== lane) check(idx.lists[sib.id], offset, li === 0, 9);
      }
      if (best) break;
      offset += lane.len;
      if (offset > horizon) break;
    }
    if (!best) return null;
    this.leadOut = this.leadOut || {};
    this.leadOut.gap = bestGap;
    this.leadOut.v = best.v;
    this.leadOut.kind = best.kind;
    this.leadOut.item = best;
    this.leadOut.same = best && idx.lists[car.lane.id].includes(best);
    return this.leadOut;
  }

  /** Apakah lajur tujuan punya ruang untuk satu mobil lagi setelah keluar dari persimpangan. */
  exitFree(R, car) {
    const list = this.app.laneIdx.lists[R.id];
    let minB = Infinity;
    for (const it of list) {
      if (it.kind === 'ped' || it.ref === car) continue;
      // Rintangan diam yang masih menyisakan ruang satu mobil bisa disalip setelah masuk lajur.
      if (it.kind === 'obs' && it.sB > car.len + 3) continue;
      if (it.sB < minB) minB = it.sB;
    }
    const pending = this.app.connTarget[R.id] || 0;
    return minB - pending * 7.5 >= car.len + 1.5;
  }

  boxClear(nodeId, k) {
    const occ = this.app.boxOcc[nodeId];
    if (!occ) return true;
    for (let a = 0; a < 4; a++) if (a !== k && occ[a] > 0) return false;
    return true;
  }

  /** Keputusan di garis henti: 'go', 'commit' (sudah pasti lewat), atau 'stop'. */
  entryDecision(car, L, dStop, conn, v) {
    const { app } = this;
    const node = L.node;
    if (dStop < -0.5) return 'commit';
    if (node.signalized) {
      const colr = app.signals.colorAt(node.id, L.dir);
      if (colr === 'red') return 'stop';
      if (colr === 'yellow') {
        const need = (v * v) / (2 * 3.2);
        return dStop > need + 0.5 ? 'stop' : 'commit';
      }
    }
    if (dStop > 14) return 'go';
    if (node.signalized && !this.boxClear(node.id, L.dir)) return 'stop';
    if (!this.exitFree(conn.next[0], car)) return 'stop';
    return dStop < 1.5 ? 'commit' : 'go';
  }

  /** Ada rintangan diam di lajur itu di depan posisi s? (supaya tidak kembali ke lajur yang tertutup) */
  obstacleAhead(lane, s) {
    for (const it of this.app.laneIdx.lists[lane.id]) if (it.kind === 'obs' && it.sF > s - 6 && it.sB < s + 45) return true;
    return false;
  }

  laneChangeSafe(car, target) {
    const list = this.app.laneIdx.lists[target.id];
    const sB = car.s - car.len / 2;
    const sF = car.s + car.len / 2;
    for (const it of list) {
      if (it.ref === car) continue;
      const rear = 5 + it.v * 1.3;
      const front = 5 + Math.max(0, car.v - it.v) * 1.6;
      if (it.sF > sB - rear && it.sB < sF + front) return false;
    }
    return true;
  }

  startLaneChange(car, target) {
    car.oldLane = car.lane;
    car.latOff = target.k > car.lane.k ? -3.5 : 3.5;
    car.lane = target;
    car.wantLeft = false;
    this.pickPlan(car);
  }

  step(dt) {
    const { app } = this;
    const wx = app.weather.fx;
    const aMax = wx.brakeMax;
    for (const car of this.cars) {
      const L = car.lane;
      const v = car.v;
      let v0 = car.v0 * wx.npcSpeed;
      if (L.type === 'conn') v0 = Math.min(v0, L.vmax);
      let acc = idmAccel(v, v0, Infinity, 0);
      const lead = this.findLeader(car);
      let leadSame = null;
      if (lead) {
        acc = Math.min(acc, idmAccel(v, v0, lead.gap, v - lead.v));
        if (lead.same) leadSame = lead.item;
      }
      car.leadSame = leadSame;
      if (L.type === 'road') {
        const conn = car.plan[0];
        const dStop = L.len - (car.s + car.len / 2);
        // Menjelang tikungan: ikuti profil pengereman nyaman, jadi mobil tidak merayap sepanjang ruas.
        if (conn && conn.vmax < v0) {
          const d = Math.max(dStop, 1);
          const vm = conn.vmax;
          const vAllow = Math.sqrt(vm * vm + 2 * TURN_B * d);
          if (v > vAllow) acc = Math.min(acc, (vm * vm - v * v) / (2 * d));
          else if (v > 0.8 * vAllow) acc = Math.min(acc, idmAccel(v, vAllow, Infinity, 0));
        }
        if (car.commit !== L.node.id && dStop < 80 && conn) {
          const res = this.entryDecision(car, L, dStop, conn, v);
          car.decision = res;
          if (res === 'stop') acc = Math.min(acc, idmAccel(v, v0, Math.max(dStop - 0.3, 0.05), v));
          else if (res === 'commit') car.commit = L.node.id;
        }
        // Menyalip rintangan diam atau kembali ke lajur kiri
        if (!car.oldLane && car.s < L.len - 22) {
          let target = null;
          if (lead && lead.kind === 'obs' && lead.same && lead.gap < 32) target = L.sibling;
          else if (L.k === 1 && car.wantLeft && car.s > 8 && car.s < L.len - 35 && !this.obstacleAhead(L.sibling, car.s)) target = L.sibling;
          if (target && this.laneChangeSafe(car, target)) this.startLaneChange(car, target);
        }
        if (car.waitT >= 0 && L.node.signalized && dStop < 80 && v < 0.6) car.waitT += dt;
      }
      car.acc = clamp(acc, -aMax, IDM.a);
    }
    for (const car of this.cars) {
      const vOld = car.v;
      car.v = Math.max(0, car.v + car.acc * dt);
      car.braking = car.acc < -0.6 || (car.v < 0.3 && vOld < 0.3);
      car.s += ((vOld + car.v) / 2) * dt;
      // Pengaman: jangan pernah menembus mobil di depan pada lajur yang sama.
      const ls = car.leadSame;
      if (ls) {
        const gap = ls.sB - (car.s + car.len / 2);
        if (gap < 0.4) {
          car.s = ls.sB - car.len / 2 - 0.4;
          car.v = Math.min(car.v, ls.v);
        }
      }
      if (car.oldLane) {
        const step = Math.min(Math.abs(car.latOff), (1.1 + car.v * 0.08) * dt);
        car.latVel = -Math.sign(car.latOff) * step / dt;
        car.latOff -= Math.sign(car.latOff) * step;
        if (Math.abs(car.latOff) < 0.02) {
          car.latOff = 0;
          car.oldLane = null;
          car.latVel = 0;
        }
      } else car.latVel = 0;
      while (car.s > car.lane.len) {
        const prev = car.lane;
        const nxt = car.plan.shift();
        if (!nxt) break;
        car.s -= prev.len;
        if (prev.type === 'road') {
          if (prev.node.signalized) app.signals.recordWait(car.waitT);
          car.waitT = 0;
        }
        car.lane = nxt;
        car.oldLane = null;
        car.latOff = 0;
        if (nxt.type === 'road') {
          car.commit = -1;
          car.wantLeft = nxt.k === 1 && app.rng() < 0.6;
        }
        this.pickPlan(car);
      }
      car.stuckT = car.v < 0.15 ? car.stuckT + dt : 0;
      // "Terhalang" = diam di lampu hijau karena persimpangan atau lajur tujuan belum kosong.
      const blocked = car.v < 0.15 && car.decision === 'stop' && car.lane.type === 'road' && car.lane.node.signalized && app.signals.colorAt(car.lane.node.id, car.lane.dir) === 'green';
      // waktu terhalang tidak direset saat lampu merah, hanya saat mobil bergerak lagi
      car.blockedT = car.v >= 0.15 ? 0 : (car.blockedT || 0) + (blocked ? dt : 0);
      this.place(car);
    }
    // Pengaman macet: pindahkan mobil yang terlalu lama diam dan jauh dari mobil otonom.
    for (const car of this.cars.slice()) {
      if (car.stuckT < 40) continue;
      const d = Math.hypot(car.x - app.ego.x, car.z - app.ego.z);
      const L = car.lane;
      const atSignal = L.type === 'road' && L.node.signalized && L.len - car.s < 90;
      const behindObstacle = car.leadSame && car.leadSame.kind === 'obs';
      // Antre di lampu merah itu wajar. Yang dipindahkan hanya yang terhalang terlalu lama.
      const limit = car.blockedT > 30 || behindObstacle ? 30 : atSignal ? 180 : 45;
      if ((d > 55 && car.stuckT > limit) || car.stuckT > 300) {
        const lead = this.findLeader(car);
        app.logDebug({
          t: Math.round(app.simTime),
          type: 'npc-macet',
          stuck: Math.round(car.stuckT),
          blocked: Math.round(car.blockedT || 0),
          lane: L.type,
          node: L.node ? L.node.id : null,
          color: L.type === 'road' && L.node.signalized ? app.signals.colorAt(L.node.id, L.dir) : null,
          dStop: L.type === 'road' ? Math.round(L.len - car.s) : null,
          lead: lead ? `${lead.kind}:${Math.round(lead.gap)}` : null,
          commit: car.commit,
          exitFree: L.type === 'road' && car.plan[0] ? this.exitFree(car.plan[0].next[0], car) : null,
          exitItems: L.type === 'road' && car.plan[0] ? app.laneIdx.lists[car.plan[0].next[0].id].map((it) => `${it.kind}:${Math.round(it.sB)}`).join(' ') : null,
          pending: L.type === 'road' && car.plan[0] ? app.connTarget[car.plan[0].next[0].id] : null,
          box: L.type === 'road' && L.node.signalized ? this.boxClear(L.node.id, L.dir) : null,
        });
        this.removeCar(car);
        this.respawns++;
      }
    }
  }

  place(car) {
    const p = car.lane.poly.at(car.s, this.tmp);
    let h = p.h;
    const rx = -Math.sin(h);
    const rz = Math.cos(h);
    car.x = p.x + rx * car.latOff;
    car.z = p.z + rz * car.latOff;
    if (car.latVel) h += Math.atan2(car.latVel, Math.max(car.v, 2));
    car.h = h;
    car.vx = Math.cos(h) * car.v;
    car.vz = Math.sin(h) * car.v;
  }

  /** Hitung tumpang tindih antar-NPC (untuk uji otomatis, seharusnya selalu 0). */
  countOverlaps() {
    let n = 0;
    const cs = this.cars;
    for (let i = 0; i < cs.length; i++) {
      for (let j = i + 1; j < cs.length; j++) {
        const a = cs[i];
        const b = cs[j];
        const dx = a.x - b.x;
        const dz = a.z - b.z;
        if (dx * dx + dz * dz > 25) continue;
        // lingkaran kecil di depan dan belakang tiap mobil
        let hit = false;
        for (const sa of [-1.2, 1.2]) {
          for (const sb of [-1.2, 1.2]) {
            const ax = a.x + Math.cos(a.h) * sa;
            const az = a.z + Math.sin(a.h) * sa;
            const bx = b.x + Math.cos(b.h) * sb;
            const bz = b.z + Math.sin(b.h) * sb;
            if (Math.hypot(ax - bx, az - bz) < 1.5) hit = true;
          }
        }
        if (hit) n++;
      }
    }
    return n;
  }

  buildMeshes() {
    const { app } = this;
    const res = app.res;
    const body = res.add(new THREE.BoxGeometry(CAR_LEN, 0.7, CAR_WID));
    body.translate(0, 0.62, 0);
    const cabin = res.add(new THREE.BoxGeometry(2.25, 0.56, 1.6));
    cabin.translate(-0.25, 1.24, 0);
    const skirt = res.add(new THREE.BoxGeometry(CAR_LEN - 0.5, 0.36, CAR_WID + 0.04));
    skirt.translate(0, 0.3, 0);
    const front = res.add(new THREE.BoxGeometry(0.06, 0.14, 1.45));
    front.translate(CAR_LEN / 2 + 0.01, 0.74, 0);
    const rear = res.add(new THREE.BoxGeometry(0.06, 0.14, 1.5));
    rear.translate(-CAR_LEN / 2 - 0.01, 0.78, 0);
    const n = this.max + 8;
    const mk = (g, m) => {
      const mesh = new THREE.InstancedMesh(g, m, n);
      mesh.count = 0;
      mesh.frustumCulled = false;
      app.scene.add(mesh);
      return mesh;
    };
    this.mBody = mk(body, res.add(new THREE.MeshLambertMaterial({ color: '#ffffff' })));
    this.mCabin = mk(cabin, res.add(new THREE.MeshLambertMaterial({ color: '#1b2433' })));
    this.mSkirt = mk(skirt, res.add(new THREE.MeshLambertMaterial({ color: '#15191f' })));
    this.mFront = mk(front, res.add(new THREE.MeshBasicMaterial({ color: '#ffffff' })));
    this.mRear = mk(rear, res.add(new THREE.MeshBasicMaterial({ color: '#ffffff' })));
    this.mBody.castShadow = this.mCabin.castShadow = true;
    this.colFrontDay = new THREE.Color('#d7dce3');
    this.colFrontNight = new THREE.Color('#fff6cf');
    this.colRearDay = new THREE.Color('#6b1a1a');
    this.colRearNight = new THREE.Color('#b91c1c');
    this.colBrake = new THREE.Color('#ff2d2d');
  }

  sync() {
    const m4 = this.m4 || (this.m4 = new THREE.Matrix4());
    const night = this.app.weather.night;
    const cars = this.cars;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      m4.makeRotationY(-c.h);
      m4.setPosition(c.x, 0, c.z);
      this.mBody.setMatrixAt(i, m4);
      this.mCabin.setMatrixAt(i, m4);
      this.mSkirt.setMatrixAt(i, m4);
      this.mFront.setMatrixAt(i, m4);
      this.mRear.setMatrixAt(i, m4);
      this.mBody.setColorAt(i, c.color);
      this.mFront.setColorAt(i, night ? this.colFrontNight : this.colFrontDay);
      this.mRear.setColorAt(i, c.braking ? this.colBrake : night ? this.colRearNight : this.colRearDay);
    }
    for (const m of [this.mBody, this.mCabin, this.mSkirt, this.mFront, this.mRear]) {
      m.count = cars.length;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
}
