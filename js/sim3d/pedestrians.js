// Pejalan kaki: berjalan di trotoar, menunggu di sudut, dan menyeberang di zebra cross
// hanya saat fase pejalan kaki. Ada juga pejalan kaki "mendadak" yang menyeberang di tengah
// ruas di depan mobil otonom (tombol J) untuk menguji rem darurat.
import * as THREE from '../vendor/three.bundle.min.js';
import { GRID } from './roadgraph.js';

const BODY_COLORS = ['#f472b6', '#60a5fa', '#fbbf24', '#34d399', '#f87171', '#a78bfa', '#e5e7eb', '#fb923c', '#38bdf8', '#94a3b8'];
const SKIN = ['#f1c9a5', '#d9a47c', '#b37a52', '#8a5a3c', '#e8b98f'];

export class Pedestrians {
  constructor(app) {
    this.app = app;
    this.sw = app.graph.sidewalk;
    this.peds = [];
    this.nextId = 1;
    this.target = 40;
    this.max = 90;
    this.tmp = {};
    this.walkEdges = this.sw.edges.filter((e) => e.type === 'walk');
    this.buildMeshes();
  }

  add(edge, t, forward) {
    const rng = this.app.rng;
    const p = {
      id: this.nextId++,
      mode: 'walk',
      edge,
      fwd: forward,
      t,
      speed: 1.15 + rng() * 0.45,
      off: 0.35 + rng() * 0.9,
      x: 0,
      z: 0,
      h: 0,
      vx: 0,
      vz: 0,
      phase: rng() * 6,
      waitT: 0,
      body: new THREE.Color(BODY_COLORS[Math.floor(rng() * BODY_COLORS.length)]),
      skin: new THREE.Color(SKIN[Math.floor(rng() * SKIN.length)]),
      scale: 0.92 + rng() * 0.16,
      next: null,
      jay: null,
    };
    this.peds.push(p);
    this.place(p, 0);
    return p;
  }

  spawnRandom(minEgoDist = 0) {
    const { app } = this;
    for (let tries = 0; tries < 20; tries++) {
      const e = this.walkEdges[Math.floor(app.rng() * this.walkEdges.length)];
      const t = app.rng() * e.len;
      const A = this.sw.corners[e.a];
      const B = this.sw.corners[e.b];
      const x = A.x + ((B.x - A.x) * t) / e.len;
      const z = A.z + ((B.z - A.z) * t) / e.len;
      if (minEgoDist && Math.hypot(x - app.ego.x, z - app.ego.z) < minEgoDist) continue;
      return this.add(e, t, app.rng() < 0.5);
    }
    return null;
  }

  balance() {
    const { app } = this;
    const normal = this.peds.filter((p) => !p.jay);
    if (normal.length < Math.min(this.target, this.max)) this.spawnRandom(45);
    else if (normal.length > this.target) {
      let far = null;
      let fd = 0;
      for (const p of normal) {
        if (p.mode !== 'walk') continue;
        const d = Math.hypot(p.x - app.ego.x, p.z - app.ego.z);
        if (d > fd) {
          fd = d;
          far = p;
        }
      }
      if (far && (fd > 50 || normal.length > this.target + 8)) this.peds.splice(this.peds.indexOf(far), 1);
    }
  }

  /** Sudut tujuan dan asal pada tepi sesuai arah jalan. */
  ends(p) {
    const e = p.edge;
    return p.fwd ? [this.sw.corners[e.a], this.sw.corners[e.b]] : [this.sw.corners[e.b], this.sw.corners[e.a]];
  }

  chooseNext(p) {
    const [, B] = this.ends(p);
    const opts = B.edges.filter((e) => e !== p.edge);
    const list = opts.length ? opts : B.edges;
    // Sedikit lebih suka menyusuri trotoar daripada menyeberang
    let pick = list[Math.floor(this.app.rng() * list.length)];
    if (pick.type === 'cross' && this.app.rng() < 0.35) {
      const walk = list.filter((e) => e.type === 'walk');
      if (walk.length) pick = walk[Math.floor(this.app.rng() * walk.length)];
    }
    return { edge: pick, fwd: pick.a === B.id };
  }

  step(dt) {
    const { app } = this;
    // hitung pejalan kaki yang menunggu per persimpangan
    for (const c of app.signals.list) c.pedWait = 0;
    for (const p of this.peds.slice()) {
      if (p.jay) {
        this.stepJay(p, dt);
        continue;
      }
      if (p.mode === 'wait') {
        const nodeId = p.next.edge.node.id;
        const ctl = app.signals.byNode.get(nodeId);
        if (ctl) ctl.pedWait++;
        p.waitT += dt;
        if (app.signals.pedWalk(nodeId)) {
          p.mode = 'cross';
          p.edge = p.next.edge;
          p.fwd = p.next.fwd;
          p.t = 0;
          p.next = null;
          p.waitT = 0;
        }
        this.place(p, 0);
        continue;
      }
      let sp = p.speed;
      if (p.mode === 'cross') {
        const ctl = app.signals.byNode.get(p.edge.node.id);
        if (ctl && ctl.phase === 'ped' && ctl.stage === 'pedclear') sp = Math.max(sp, 1.8);
        else if (ctl && ctl.phase !== 'ped') sp = Math.max(sp, 2.0);
      }
      p.t += sp * dt;
      p.phase += sp * dt * 2.6;
      if (p.t >= p.edge.len) {
        const over = p.t - p.edge.len;
        const nx = this.chooseNext(p);
        if (nx.edge.type === 'cross') {
          p.mode = 'wait';
          p.next = nx;
          p.t = p.edge.len;
          p.waitT = 0;
        } else {
          p.mode = 'walk';
          p.edge = nx.edge;
          p.fwd = nx.fwd;
          p.t = Math.min(over, nx.edge.len);
        }
      }
      this.place(p, sp);
    }
  }

  place(p, sp) {
    const [A, B] = this.ends(p);
    const e = p.edge;
    const dx = (B.x - A.x) / (e.len || 1);
    const dz = (B.z - A.z) / (e.len || 1);
    // berjalan di sisi kiri arah jalannya supaya yang berpapasan tidak bertabrakan
    const lx = dz;
    const lz = -dx;
    let t = p.t;
    let off = p.off;
    if (p.mode === 'wait') {
      // berdiri di dekat awal zebra cross
      const [NA, NB] = p.next.fwd ? [this.sw.corners[p.next.edge.a], this.sw.corners[p.next.edge.b]] : [this.sw.corners[p.next.edge.b], this.sw.corners[p.next.edge.a]];
      const cdx = (NB.x - NA.x) / p.next.edge.len;
      const cdz = (NB.z - NA.z) / p.next.edge.len;
      p.x = NA.x - cdx * 0.6 + cdz * (p.off - 0.8);
      p.z = NA.z - cdz * 0.6 - cdx * (p.off - 0.8);
      p.h = Math.atan2(cdz, cdx);
      p.vx = p.vz = 0;
      p.onRoad = false;
      return;
    }
    if (p.mode === 'cross') off = (p.off - 0.8) * 1.2;
    p.onRoad = p.mode === 'cross' && t > 2 && t < e.len - 2;
    p.x = A.x + dx * t + lx * off;
    p.z = A.z + dz * t + lz * off;
    p.h = Math.atan2(dz, dx);
    p.vx = dx * sp;
    p.vz = dz * sp;
  }

  /**
   * Pejalan kaki mendadak di depan mobil otonom. seg = ruas tempat mobil berada,
   * s = posisi sepanjang ruas. Ia muncul di tepi trotoar kiri (dekat lajur kiri) lalu berlari menyeberang.
   */
  spawnJaywalker(seg, s) {
    const rng = this.app.rng;
    const lx = seg.dz;
    const lz = -seg.dx;
    // pusat jalan di s
    const cx = seg.lanes[0].poly.x[0] - lx * 5.25 + seg.dx * s;
    const cz = seg.lanes[0].poly.z[0] - lz * 5.25 + seg.dz * s;
    const p = this.add(this.walkEdges[0], 0, true);
    p.jay = {
      seg,
      s,
      cx,
      cz,
      lx,
      lz,
      w: 7.25, // posisi melintang, dari kiri (+7) ke kanan (-9)
      stage: 'dash',
      pause: 0,
    };
    p.mode = 'jay';
    p.speed = 2.3;
    p.off = 0;
    p.body = new THREE.Color('#facc15');
    p.skin = new THREE.Color(SKIN[Math.floor(rng() * SKIN.length)]);
    this.placeJay(p, 0);
    return p;
  }

  stepJay(p, dt) {
    const j = p.jay;
    let sp = j.stage === 'dash' ? 2.3 : 1.5;
    // Setelah melewati lajur mobil otonom, ia berhati-hati di lajur berikutnya.
    if (j.stage === 'careful' && this.vehicleNear(p)) sp = 0;
    // Jangan menabrak badan mobil lain yang sedang berhenti (misalnya antrean di lampu merah).
    if (sp > 0 && this.carBodyAhead(p, j.w - 0.9)) sp = 0;
    if (j.w < 0.2 && j.stage === 'dash') j.stage = 'careful';
    j.w -= sp * dt;
    p.phase += sp * dt * 2.6;
    if (j.w <= -GRID.CROSS) {
      // sampai di trotoar seberang: lanjut sebagai pejalan kaki biasa
      const walk = this.nearestWalkEdge(p.x, p.z);
      p.jay = null;
      p.mode = 'walk';
      p.speed = 1.3;
      if (walk) {
        p.edge = walk.edge;
        p.fwd = walk.fwd;
        p.t = walk.t;
        p.off = 0.6;
      } else {
        this.peds.splice(this.peds.indexOf(p), 1);
      }
      return;
    }
    this.placeJay(p, sp);
  }

  /** Ada badan mobil NPC di titik melintang w berikutnya (dengan jarak aman 0,4 m)? */
  carBodyAhead(p, w) {
    const j = p.jay;
    const x = j.cx + j.lx * w;
    const z = j.cz + j.lz * w;
    for (const c of this.app.traffic.cars) {
      const dx = x - c.x;
      const dz = z - c.z;
      if (dx * dx + dz * dz > 16) continue;
      const along = dx * Math.cos(c.h) + dz * Math.sin(c.h);
      const lat = -dx * Math.sin(c.h) + dz * Math.cos(c.h);
      if (Math.abs(along) < c.len / 2 + 0.4 && Math.abs(lat) < c.wid / 2 + 0.4) return true;
    }
    return false;
  }

  vehicleNear(p) {
    const { app } = this;
    const pts = app.traffic.cars;
    for (const c of pts) {
      const dx = p.x - c.x;
      const dz = p.z - c.z;
      const d = Math.hypot(dx, dz);
      if (d > 30) continue;
      const along = (dx * Math.cos(c.h) + dz * Math.sin(c.h));
      const lat = Math.abs(-dx * Math.sin(c.h) + dz * Math.cos(c.h));
      if (along > 0 && lat < 3.2 && along / Math.max(c.v, 0.5) < 3.5) return true;
    }
    return false;
  }

  placeJay(p, sp) {
    const j = p.jay;
    p.x = j.cx + j.lx * j.w;
    p.z = j.cz + j.lz * j.w;
    p.h = Math.atan2(-j.lz, -j.lx);
    p.onRoad = Math.abs(j.w) < GRID.HALF;
    p.vx = -j.lx * sp;
    p.vz = -j.lz * sp;
  }

  nearestWalkEdge(x, z) {
    let best = null;
    let bd = Infinity;
    for (const e of this.walkEdges) {
      const A = this.sw.corners[e.a];
      const B = this.sw.corners[e.b];
      const dx = B.x - A.x;
      const dz = B.z - A.z;
      const L2 = dx * dx + dz * dz;
      let t = ((x - A.x) * dx + (z - A.z) * dz) / L2;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(A.x + dx * t - x, A.z + dz * t - z);
      if (d < bd) {
        bd = d;
        best = { edge: e, t: t * e.len, fwd: true };
      }
    }
    return bd < 4 ? best : null;
  }

  /** Pejalan kaki yang berada di badan jalan, didaftarkan sebagai rintangan pada lajur terkait. */
  register(idx) {
    const { app } = this;
    const pr = this.tmp;
    for (const p of this.peds) {
      let lanes = null;
      if (p.mode === 'cross') lanes = p.edge.node.conns;
      else if (p.jay) lanes = p.jay.seg.lanes.concat(this.oppositeLanes(p.jay.seg));
      else continue;
      for (const lane of lanes) {
        for (const ahead of [0, 1.2]) {
          const x = p.x + p.vx * ahead;
          const z = p.z + p.vz * ahead;
          lane.poly.project(x, z, pr);
          if (Math.abs(pr.lat) < 1.95 && pr.s > -1 && pr.s < lane.len + 1) {
            idx.add(lane.id, pr.s - 0.4, pr.s + 0.4, 0, 'ped', p);
            break;
          }
        }
      }
    }
    void app;
  }

  oppositeLanes(seg) {
    if (!seg._opp) {
      const back = this.app.graph.segs.find((s) => s.a === seg.b && s.b === seg.a);
      seg._opp = back ? back.lanes : [];
    }
    return seg._opp;
  }

  buildMeshes() {
    const { app } = this;
    const res = app.res;
    const bodyGeo = res.add(new THREE.CapsuleGeometry(0.22, 0.78, 3, 8));
    bodyGeo.translate(0, 0.68, 0);
    const headGeo = res.add(new THREE.SphereGeometry(0.13, 10, 8));
    headGeo.translate(0, 1.5, 0);
    const n = this.max + 12;
    this.mBody = new THREE.InstancedMesh(bodyGeo, res.add(new THREE.MeshLambertMaterial({ color: '#ffffff' })), n);
    this.mHead = new THREE.InstancedMesh(headGeo, res.add(new THREE.MeshLambertMaterial({ color: '#ffffff' })), n);
    for (const m of [this.mBody, this.mHead]) {
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = true;
      app.scene.add(m);
    }
  }

  sync() {
    const m4 = this.m4 || (this.m4 = new THREE.Matrix4());
    const sc = this.v3 || (this.v3 = new THREE.Vector3());
    const q = this.q || (this.q = new THREE.Quaternion());
    const pos = this.p3 || (this.p3 = new THREE.Vector3());
    const up = this.up || (this.up = new THREE.Vector3(0, 1, 0));
    const ps = this.peds;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      const moving = p.mode === 'walk' || p.mode === 'cross' || p.jay;
      const bob = moving ? Math.abs(Math.sin(p.phase)) * 0.05 : 0;
      const base = p.onRoad ? 0 : 0.15;
      q.setFromAxisAngle(up, -p.h);
      sc.set(p.scale, p.scale, p.scale);
      pos.set(p.x, base + bob, p.z);
      m4.compose(pos, q, sc);
      this.mBody.setMatrixAt(i, m4);
      this.mHead.setMatrixAt(i, m4);
      this.mBody.setColorAt(i, p.body);
      this.mHead.setColorAt(i, p.skin);
    }
    for (const m of [this.mBody, this.mHead]) {
      m.count = ps.length;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
}
