// Indra (sensor) dan Pahami (persepsi) LiveShuttle, plus tampilan sensor yang tenang.
//
// Indra: LiDAR 360 derajat di atap, kamera depan, radar depan, dan radar pendek di keempat sudut.
// Sinar LiDAR dihitung secara analitik (tanpa Raycaster three.js) terhadap jejak sederhana: sisi gedung
// dan batang pohon dari kisi ruang statis, lalu kotak kendaraan dan lingkaran pejalan kaki di dekat
// shuttle. Tiap bingkai hanya sudut yang baru dilewati putaran yang ditembakkan (satu putaran tiap
// 5 detik, sama dengan LiDAR di atap), jadi bebannya tersebar ke banyak bingkai.
// Pahami: 10 kali per detik tiap objek diperiksa. Objek terlihat bila ada dalam jangkauan dan sudut
// pandang sensor dan tidak terhalang gedung. Jangkauan kamera dan LiDAR mengikuti cuaca.
// Tampilan: titik LiDAR muncul dan memudar pelan. Sinar LiDAR tersembunyi kecuali dinyalakan, lalu
// hanya beberapa sinar lembut yang berputar pelan. Mode Detail menambah bidang cakupan kamera dan
// radar yang memudar ke tepi, satu cincin jangkauan yang samar, dan penanda objek yang dilacak.
import * as THREE from '../vendor/three.bundle.min.js';
import { fmt } from './util.js';
import { SH } from './drive.js';

export const RANGE = { lidar: 50, kamera: 70, radar: 120, sudut: 25 };
const CAM_HALF = (50 * Math.PI) / 180;
const RADAR_HALF = (12 * Math.PI) / 180;
const SPIN = (Math.PI * 2) / 5;
const RAY_STEP = (Math.PI * 2) / 900;
const CH = [0.45, 1.15, 1.85];
const MAXP = 3200;
const LIFE = 1.7;
const CELL = 16;
const TRAIL = 9;
const MAXT = 24;
export const CLASS = { pejalan: 'pejalan kaki', motorbike: 'sepeda motor', car: 'mobil', mpv: 'mobil', angkot: 'angkot', pickup: 'pikap', parkir: 'kendaraan parkir', galian: 'galian jalan' };
const CLASS_COL = { pejalan: '#f97316', motorbike: '#8b5cf6', parkir: '#ef4444', galian: '#ef4444' };
const HEIGHT = { motorbike: 1.5, angkot: 2.2, pickup: 1.8, mpv: 1.75, car: 1.5, parkir: 1.6, galian: 1.1 };
const key = (i, j) => (i + 512) * 1024 + j + 512;

/** Kipas datar dari pusat: alfa a0 di pusat, a1 di tepi (tepi lembut). */
function fan(half, a0, a1, color, n = 28) {
  const pos = [0, 0, 0];
  const col = [color.r, color.g, color.b, a0];
  for (let i = 0; i <= n; i++) {
    const t = -half + (2 * half * i) / n;
    pos.push(Math.cos(t), 0, Math.sin(t));
    col.push(color.r, color.g, color.b, a1);
  }
  const idx = [];
  for (let i = 1; i <= n; i++) idx.push(0, i + 1, i);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  return g;
}

/** Cincin jangkauan: alfa 0 di dalam, puncak samar dekat tepi, 0 di tepi luar. */
function ring(color, n = 96) {
  const R = [0.9, 0.985, 1];
  const A = [0, 0.2, 0];
  const pos = [];
  const col = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    for (let k = 0; k < 3; k++) {
      pos.push(Math.cos(t) * R[k], 0, Math.sin(t) * R[k]);
      col.push(color.r, color.g, color.b, A[k]);
    }
  }
  const idx = [];
  for (let i = 0; i < n; i++) for (let k = 0; k < 2; k++) {
    const a = i * 3 + k;
    idx.push(a, a + 1, a + 3, a + 1, a + 4, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  return g;
}

export class Sensors {
  constructor(app) {
    this.app = app;
    this.view = 'tenang';
    this.rays = false;
    this.spin = 0;
    this.carry = 0;
    this.pT = 0;
    this.tracks = new Map();
    this.list = [];
    this.counts = {};
    this.dyn = [];
    this.dynN = 0;
    this.hist = new Float32Array(64 * 2);
    this.histN = 0;
    this.hitsPerSec = 0;
    this.hitAcc = 0;
    this.buildGrid();
    this.buildVisuals();
  }

  // ===== kisi ruang statis (gedung, pohon, tiang) =====

  buildGrid() {
    const segs = [];
    const circ = [];
    for (const b of this.app.city.data.buildings) {
      const p = b.p;
      for (let i = 0; i < p.length; i++) {
        const q = p[(i + 1) % p.length];
        segs.push(p[i][0], p[i][1], q[0], q[1], b.f * 3.2);
      }
    }
    for (const t of this.app.world.trees.concat(this.app.world.poles)) circ.push(t.x, t.z, t.r, t.h);
    this.segs = Float32Array.from(segs);
    this.circ = Float32Array.from(circ);
    const cells = (this.cells = new Map());
    const put = (x0, z0, x1, z1, v) => {
      for (let i = Math.floor(Math.min(x0, x1) / CELL); i <= Math.floor(Math.max(x0, x1) / CELL); i++)
        for (let j = Math.floor(Math.min(z0, z1) / CELL); j <= Math.floor(Math.max(z0, z1) / CELL); j++) {
          const k = key(i, j);
          const a = cells.get(k);
          if (a) a.push(v);
          else cells.set(k, [v]);
        }
    };
    const S = this.segs;
    for (let i = 0; i < S.length; i += 5) put(S[i], S[i + 1], S[i + 2], S[i + 3], i);
    const Q = this.circ;
    for (let i = 0; i < Q.length; i += 4) put(Q[i] - Q[i + 2], Q[i + 1] - Q[i + 2], Q[i] + Q[i + 2], Q[i + 1] + Q[i + 2], -1 - i);
    this.stamp = new Uint32Array(S.length + Q.length + 1);
    this.rayId = 0;
  }

  /**
   * Tembakkan satu sinar dari (ox, oz) arah (dx, dz) (vektor satuan) sejauh max. Menelusuri sel kisi
   * yang dilewati (DDA), lalu objek bergerak bila withDyn. Mengembalikan jarak; tinggi objek yang
   * kena ada di this.hitH dan objeknya di this.hitRef.
   */
  cast(ox, oz, dx, dz, max, withDyn) {
    let best = max;
    this.hitH = 0;
    this.hitRef = null;
    const id = ++this.rayId;
    const S = this.segs;
    const Q = this.circ;
    let i = Math.floor(ox / CELL);
    let j = Math.floor(oz / CELL);
    const si = dx > 0 ? 1 : -1;
    const sj = dz > 0 ? 1 : -1;
    const tdx = Math.abs(CELL / dx);
    const tdz = Math.abs(CELL / dz);
    let tx = dx ? ((dx > 0 ? (i + 1) * CELL - ox : ox - i * CELL) / Math.abs(dx)) : Infinity;
    let tz = dz ? ((dz > 0 ? (j + 1) * CELL - oz : oz - j * CELL) / Math.abs(dz)) : Infinity;
    let t = 0;
    while (t < best) {
      const arr = this.cells.get(key(i, j));
      if (arr) {
        for (let n = 0; n < arr.length; n++) {
          const v = arr[n];
          const sIdx = v >= 0 ? v : S.length - v;
          if (this.stamp[sIdx] === id) continue;
          this.stamp[sIdx] = id;
          if (v >= 0) {
            const ex = S[v + 2] - S[v];
            const ez = S[v + 3] - S[v + 1];
            const den = dx * ez - dz * ex;
            if (den > -1e-9 && den < 1e-9) continue;
            const wx = S[v] - ox;
            const wz = S[v + 1] - oz;
            const tt = (wx * ez - wz * ex) / den;
            const u = (wx * dz - wz * dx) / den;
            if (tt > 0 && tt < best && u >= 0 && u <= 1) {
              best = tt;
              this.hitH = S[v + 4];
              this.hitRef = null;
            }
          } else {
            const c = -1 - v;
            const tt = circleHit(ox - Q[c], oz - Q[c + 1], dx, dz, Q[c + 2]);
            if (tt < best) {
              best = tt;
              this.hitH = Q[c + 3];
              this.hitRef = null;
            }
          }
        }
      }
      if (tx < tz) {
        t = tx;
        tx += tdx;
        i += si;
      } else {
        t = tz;
        tz += tdz;
        j += sj;
      }
    }
    if (withDyn) {
      for (let n = 0; n < this.dynN; n++) {
        const o = this.dyn[n];
        const tt = o.r ? circleHit(ox - o.x, oz - o.z, dx, dz, o.r) : boxHit(ox - o.x, oz - o.z, dx, dz, o.c, o.s, o.hl, o.hw);
        if (tt < best) {
          best = tt;
          this.hitH = o.ht;
          this.hitRef = o.ref;
        }
      }
    }
    return best;
  }

  /** Objek bergerak di sekitar titik (x, z), untuk sinar LiDAR bingkai ini. */
  gatherDyn(x, z, R) {
    const app = this.app;
    let n = 0;
    const push = (ref, ox, oz, h, hl, hw, r, ht) => {
      if ((ox - x) * (ox - x) + (oz - z) * (oz - z) > (R + 8) * (R + 8)) return;
      const o = this.dyn[n] || (this.dyn[n] = {});
      n++;
      o.ref = ref;
      o.x = ox;
      o.z = oz;
      o.c = Math.cos(h);
      o.s = Math.sin(h);
      o.hl = hl;
      o.hw = hw;
      o.r = r;
      o.ht = ht;
    };
    const ego = app.ego.veh;
    for (const W of app.traffic.all) if (W !== ego) push(W, W.x, W.z, W.h, W.len / 2, W.hw, 0, HEIGHT[W.type] || 1.6);
    for (const ob of app.obstacles.list) push(ob, ob.x, ob.z, ob.h, (ob.s1 - ob.s0) / 2, ob.hw, 0, HEIGHT[ob.kind]);
    for (const p of app.peds.peds) push(p, p.x, p.z, 0, 0, 0, 0.3, 1.7);
    for (const w of app.ego.pax.walkers) push(w, w.x, w.z, 0, 0, 0, 0.3, 1.7);
    this.dynN = n;
  }

  // ===== Pahami: pelacakan objek =====

  step(dt) {
    this.pT += dt;
    if (this.pT < 0.1) return;
    this.perceive(this.pT);
    this.pT = 0;
  }

  ranges() {
    const w = this.app.weather.sensorRange();
    const cam = RANGE.kamera * w.kamera * (this.app.weather.name === 'malam' ? 1.4 : 1);
    return { lidar: RANGE.lidar * w.lidar, kamera: Math.min(RANGE.kamera, cam), radar: RANGE.radar };
  }

  perceive(dt) {
    const app = this.app;
    const veh = app.ego.veh;
    const R = this.ranges();
    const far = Math.max(R.lidar, R.kamera, R.radar);
    const c = Math.cos(veh.h);
    const s = Math.sin(veh.h);
    const now = app.simTime;
    const see = (ref, id, cls, x, z, ohl, ohw, isVeh) => {
      const dx = x - veh.x;
      const dz = z - veh.z;
      const d = Math.hypot(dx, dz);
      if (d > far || d < 0.1) return;
      const ang = Math.acos(Math.max(-1, Math.min(1, (dx * c + dz * s) / d)));
      let by = '';
      if (d < R.lidar) by += 'L';
      if (d < R.kamera && ang < CAM_HALF) by += 'K';
      if (isVeh && ((d < R.radar && ang < RADAR_HALF) || d < RANGE.sudut)) by += 'R';
      if (!by || (d > 6 && this.cast(veh.x, veh.z, dx / d, dz / d, d, false) < d - 1)) return;
      let t = this.tracks.get(id);
      if (!t) this.tracks.set(id, (t = { id, ref, cls, name: CLASS[cls], x, z, v: 0, first: now }));
      else t.v += (Math.hypot(x - t.x, z - t.z) / Math.max(dt, 0.05) - t.v) * 0.4;
      t.x = x;
      t.z = z;
      // jarak antartepi (kira-kira, arah objek diabaikan) dan apakah objek ada di koridor depan
      const lx = dx * c + dz * s;
      const lz = -dx * s + dz * c;
      t.d = Math.hypot(Math.max(0, Math.abs(lx) - SH.hl - ohl), Math.max(0, Math.abs(lz) - SH.hw - ohw));
      t.ahead = lx > SH.hl && Math.abs(lz) < 3.5;
      t.by = by;
      t.seen = now;
    };
    for (const W of app.traffic.all) if (W !== veh) see(W, W.id, W.type, W.x, W.z, W.len / 2, W.hw, true);
    for (const ob of app.obstacles.list) see(ob, 2e6 + ob.id, ob.kind, ob.x, ob.z, (ob.s1 - ob.s0) / 2, ob.hw, true);
    for (const p of app.peds.peds) see(p, 1e6 + p.id, 'pejalan', p.x, p.z, 0.3, 0.3, false);
    const list = this.list;
    list.length = 0;
    for (const [id, t] of this.tracks) {
      if (now - t.seen > 0.6 || !(t.ref.alive !== false)) this.tracks.delete(id);
      else list.push(t);
    }
    list.sort((a, b) => a.d - b.d);
    const cnt = this.counts;
    for (const k in cnt) cnt[k] = 0;
    for (const t of list) cnt[t.name] = (cnt[t.name] || 0) + 1;
    if (list.some((t) => t.cls === 'pejalan' && t.ahead && t.d < 40)) app.guideEvent('deteksi-pejalan');
  }

  // ===== tampilan =====

  buildVisuals() {
    const app = this.app;
    const res = app.res;
    const g = (this.group = new THREE.Group());
    g.name = 'sensor';
    app.scene.add(g);
    const lid = new THREE.Color('#0fb5d4');
    const mat = (extra) => res.add(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, opacity: 0, side: THREE.DoubleSide, ...extra }));
    // titik LiDAR: titik bulat lembut dengan alfa per titik
    const cv = document.createElement('canvas');
    cv.width = cv.height = 32;
    const cx = cv.getContext('2d');
    const gr = cx.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.5, 'rgba(255,255,255,0.7)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    cx.fillStyle = gr;
    cx.fillRect(0, 0, 32, 32);
    const tex = res.add(new THREE.CanvasTexture(cv));
    const pg = res.add(new THREE.BufferGeometry());
    this.pPos = new THREE.BufferAttribute(new Float32Array(MAXP * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.pCol = new THREE.BufferAttribute(new Float32Array(MAXP * 4), 4).setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAXP; i++) this.pCol.setXYZW(i, lid.r, lid.g, lid.b, 0);
    pg.setAttribute('position', this.pPos);
    pg.setAttribute('color', this.pCol);
    this.pBorn = new Float32Array(MAXP).fill(-99);
    this.clock = 0;
    this.pMax = new Float32Array(MAXP);
    this.pW = 0;
    this.points = new THREE.Points(pg, res.add(new THREE.PointsMaterial({ size: 0.3, map: tex, vertexColors: true, transparent: true, depthWrite: false, opacity: 0 })));
    this.points.frustumCulled = false;
    // sinar LiDAR: beberapa garis lembut dengan jejak yang memudar
    const rg = res.add(new THREE.BufferGeometry());
    this.rPos = new THREE.BufferAttribute(new Float32Array(TRAIL * 6), 3).setUsage(THREE.DynamicDrawUsage);
    const rc = new Float32Array(TRAIL * 8);
    for (let k = 0; k < TRAIL; k++) {
      const a = 0.42 * Math.pow(1 - k / TRAIL, 1.6);
      rc.set([lid.r, lid.g, lid.b, a, lid.r, lid.g, lid.b, a * 0.25], k * 8);
    }
    rg.setAttribute('position', this.rPos);
    rg.setAttribute('color', new THREE.BufferAttribute(rc, 4));
    this.rayLines = new THREE.LineSegments(rg, res.add(new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, opacity: 0 })));
    this.rayLines.frustumCulled = false;
    // cakupan kamera dan radar (ikut shuttle), cincin jangkauan LiDAR
    this.cover = new THREE.Group();
    this.camFan = new THREE.Mesh(res.add(fan(CAM_HALF, 0.16, 0.0, new THREE.Color('#8b5cf6'))), mat());
    this.radFan = new THREE.Mesh(res.add(fan(RADAR_HALF, 0.14, 0.02, new THREE.Color('#f59e0b'))), mat());
    this.ring = new THREE.Mesh(res.add(ring(lid)), mat());
    this.camFan.position.y = 0.14;
    this.radFan.position.y = 0.16;
    this.ring.position.y = 0.12;
    this.cover.add(this.camFan, this.radFan, this.ring);
    // penanda objek yang dilacak (cincin tipis di tanah)
    this.marks = new THREE.InstancedMesh(res.add(new THREE.RingGeometry(0.86, 1, 36).rotateX(-Math.PI / 2)), res.add(new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, opacity: 0 })), MAXT);
    this.marks.count = 0;
    this.marks.frustumCulled = false;
    this.marks.position.y = 0.1;
    g.add(this.points, this.rayLines, this.cover, this.marks);
    this.fade = { points: 0, rays: 0, cover: 0 };
    this.lidCol = lid;
    this.col = new THREE.Color();
    this.m4 = new THREE.Matrix4();
  }

  setView(v) {
    if (v !== 'tenang' && v !== 'detail') return this.view;
    this.view = v;
    return v;
  }

  setRays(on) {
    this.rays = !!on;
    if (this.rays) this.app.guideEvent('sinar-lidar');
    return this.rays;
  }

  /** Dipanggil tiap bingkai tampilan (dtReal = waktu nyata, supaya putaran tetap pelan saat dipercepat). */
  sync(dtReal) {
    const app = this.app;
    const P = app.egoPose;
    const R = this.ranges();
    const detail = this.view === 'detail';
    const cabin = app.cameras && app.cameras.mode === 'kabin';
    const k = Math.min(1, dtReal * 3.5);
    const F = this.fade;
    F.points += (1 - F.points) * k;
    F.rays += ((this.rays ? 1 : 0) - F.rays) * k;
    F.cover += ((detail ? 1 : 0) - F.cover) * k;
    // sapuan LiDAR sesuai putaran polong di atap
    const a0 = P.h + this.spin;
    this.spin = (this.spin + dtReal * SPIN) % (Math.PI * 2);
    this.carry += (dtReal * SPIN) / RAY_STEP;
    const n = Math.min(60, Math.floor(this.carry));
    this.carry -= n;
    if (n > 0 && !app.paused) {
      this.gatherDyn(P.x, P.z, R.lidar);
      for (let r = 0; r < n; r++) {
        const a = a0 + r * RAY_STEP;
        const dx = Math.cos(a);
        const dz = Math.sin(a);
        const d = this.cast(P.x, P.z, dx, dz, R.lidar, true);
        const hi = this.histN++ % 64;
        this.hist[hi * 2] = a;
        this.hist[hi * 2 + 1] = d;
        if (d >= R.lidar) continue;
        for (let c = detail ? 0 : 1; c < (detail ? 3 : 2); c++) {
          if (CH[c] > this.hitH) continue;
          const i = this.pW;
          this.pW = (this.pW + 1) % MAXP;
          this.pPos.setXYZ(i, P.x + dx * d, CH[c], P.z + dz * d);
          this.pBorn[i] = this.clock;
          this.pMax[i] = this.hitRef ? 0.95 : 0.55;
          this.hitAcc++;
        }
      }
      this.pPos.needsUpdate = true;
    }
    // alfa titik: muncul cepat, lalu memudar pelan (umur dihitung dari waktu nyata)
    this.clock += dtReal;
    const cA = this.pCol.array;
    const dim = detail ? 1 : 0.6;
    for (let i = 0; i < MAXP; i++) {
      const age = this.clock - this.pBorn[i];
      cA[i * 4 + 3] = age > LIFE ? 0 : this.pMax[i] * dim * (age < 0.15 ? age / 0.15 : 1 - (age - 0.15) / (LIFE - 0.15));
    }
    this.pCol.needsUpdate = true;
    this.points.material.opacity = F.points;
    this.points.visible = F.points > 0.01 && !cabin;
    // sinar
    this.rayLines.material.opacity = F.rays;
    this.rayLines.visible = F.rays > 0.01;
    if (this.rayLines.visible) {
      for (let t = 0; t < TRAIL; t++) {
        const hi = (this.histN - 1 - t * 5 + 6400) % 64;
        const a = this.hist[hi * 2];
        const d = this.hist[hi * 2 + 1];
        this.rPos.setXYZ(t * 2, P.x, 2.85, P.z);
        this.rPos.setXYZ(t * 2 + 1, P.x + Math.cos(a) * d, 0.9, P.z + Math.sin(a) * d);
      }
      this.rPos.needsUpdate = true;
    }
    // cakupan
    this.cover.visible = F.cover > 0.01;
    if (this.cover.visible) {
      this.cover.position.set(P.x, 0, P.z);
      this.cover.rotation.y = -P.h;
      this.camFan.scale.setScalar(this.camFan.scale.x + (R.kamera - this.camFan.scale.x) * k);
      this.radFan.scale.setScalar(this.radFan.scale.x + (R.radar - this.radFan.scale.x) * k);
      this.ring.scale.setScalar(this.ring.scale.x + (R.lidar - this.ring.scale.x) * k);
      this.camFan.material.opacity = this.radFan.material.opacity = this.ring.material.opacity = F.cover;
    }
    // penanda objek
    this.marks.visible = F.cover > 0.01;
    this.marks.material.opacity = 0.55 * F.cover;
    if (this.marks.visible) {
      let m = 0;
      for (const t of this.list) {
        if (m >= MAXT) break;
        const r = t.cls === 'pejalan' ? 0.7 : t.cls === 'motorbike' ? 1.2 : 2.6;
        this.m4.makeScale(r, 1, r).setPosition(t.ref.x, 0, t.ref.z);
        this.marks.setMatrixAt(m, this.m4);
        this.marks.setColorAt(m, this.col.set(CLASS_COL[t.cls] || '#0ea5e9'));
        m++;
      }
      this.marks.count = m;
      this.marks.instanceMatrix.needsUpdate = true;
      if (this.marks.instanceColor) this.marks.instanceColor.needsUpdate = true;
    }
    this.hitsPerSec += (this.hitAcc / Math.max(dtReal, 1e-3) - this.hitsPerSec) * 0.05;
    this.hitAcc = 0;
  }

  // ===== teks lapisan otonomi =====

  layers() {
    const app = this.app;
    const ego = app.ego;
    const R = this.ranges();
    const wx = app.weather.name;
    const indra = `LiDAR menjangkau ${fmt(R.lidar, 0)} m ke segala arah, kamera ${fmt(R.kamera, 0)} m ke depan, radar ${R.radar} m ke depan${wx === 'kabut' ? ' (radar tetap tembus kabut)' : ''}.`;
    const parts = Object.entries(this.counts).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${k}`);
    const near = this.list.find((t) => t.ahead);
    const pahami = parts.length ? `Melacak ${parts.join(', ')}.${near ? ` Terdekat di depan: ${near.name} ${fmt(near.d, 0)} m.` : ''}` : 'Belum ada kendaraan atau pejalan kaki di sekitar.';
    const nav = ego.nav;
    const rencana = ego.mode === 'manual' ? 'Rute ditunda selama kamu mengemudi. Perisai tetap memeriksa jalur di depan.' : `${ego.statusText()}${Number.isFinite(nav.remaining) && ego.state === 'melaju' ? `, ${fmt(nav.remaining, 0)} m lagi` : ''}. Sekarang ${ego.reasonText()}.`;
    const v = ego.veh;
    const steer = (Math.atan(4 * v.kappa) * 180) / Math.PI;
    const act = ego.shieldT > 0 ? 'perisai sedang menahan gas' : v.a > 0.25 ? 'menambah kecepatan' : v.a < -0.25 ? 'mengerem halus' : 'menjaga kecepatan';
    const gerak = `${fmt(v.v * 3.6, 0)} km/jam, setir ${Math.abs(steer) < 1 ? 'lurus' : `${fmt(Math.abs(steer), 0)}° ke ${steer > 0 ? 'kanan' : 'kiri'}`}, ${act}.`;
    return { indra, pahami, rencana, gerak };
  }

  summary() {
    return {
      view: this.view,
      rays: this.rays,
      ranges: this.ranges(),
      pointsPerSec: Math.round(this.hitsPerSec),
      tracks: this.list.slice(0, 12).map((t) => ({ cls: t.cls, name: t.name, d: Math.round(t.d * 10) / 10, v: Math.round(t.v * 36) / 10, by: t.by, ahead: t.ahead })),
      counts: { ...this.counts },
      layers: this.layers(),
    };
  }
}

function circleHit(fx, fz, dx, dz, r) {
  const b = fx * dx + fz * dz;
  const c = fx * fx + fz * fz - r * r;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? t : Infinity;
}

function boxHit(fx, fz, dx, dz, c, s, hl, hw) {
  const lx = fx * c + fz * s;
  const lz = -fx * s + fz * c;
  const ux = dx * c + dz * s;
  const uz = -dx * s + dz * c;
  const ax = slab(lx, ux, hl);
  const az = slab(lz, uz, hw);
  const t0 = Math.max(ax[0], az[0], 0);
  const t1 = Math.min(ax[1], az[1]);
  return t0 > 0 && t0 <= t1 ? t0 : Infinity;
}

const SLAB = [[0, 0], [0, 0]];
let slabI = 0;
function slab(o, u, h) {
  const r = SLAB[(slabI = 1 - slabI)];
  if (Math.abs(u) < 1e-9) {
    r[0] = o < -h || o > h ? Infinity : -Infinity;
    r[1] = Infinity;
    return r;
  }
  const a = (-h - o) / u;
  const b = (h - o) / u;
  r[0] = Math.min(a, b);
  r[1] = Math.max(a, b);
  return r;
}
