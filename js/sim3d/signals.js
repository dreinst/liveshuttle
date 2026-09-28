// Lampu lalu lintas. Tiap arah masuk mendapat fase hijau sendiri (fase terlindung), lalu
// kuning dan merah semua sebagai jeda pengosongan. Fase pejalan kaki menghentikan semua kendaraan.
// Dua mode: "Adaptif" (hijau hanya untuk arah yang ada antreannya) dan "Waktu tetap".
import * as THREE from '../vendor/three.bundle.min.js';
import { GeoBuf } from './world.js';
import { DX, DZ, GRID } from './roadgraph.js';

export const TIMING = {
  yellow: 3,
  allRed: 1.5,
  fixedGreen: 12,
  walk: 6,
  pedClear: 9,
  minGreen: 4,
  maxGreen: 15,
  gapOut: 2,
  // Batas merah untuk arah yang punya antrean (lebih pendek dari satu siklus waktu tetap).
  maxRed: 60,
};

class Controller {
  constructor(node, rng) {
    this.node = node;
    this.apps = node.approaches.slice().sort((a, b) => a - b);
    this.order = [...this.apps, 'ped'];
    this.cursor = Math.floor(rng() * this.order.length);
    this.phase = this.order[this.cursor];
    this.stage = this.phase === 'ped' ? 'walk' : 'green';
    this.t = rng() * 6;
    this.demand = [0, 0, 0, 0];
    this.queue = [0, 0, 0, 0];
    this.queueLen = [0, 0, 0, 0];
    this.noDemandT = 0;
    this.pedWait = 0;
    this.pedWaitT = 0;
    this.sincePed = rng() * 30;
  }

  colorFor(k) {
    if (this.phase !== k) return 'red';
    if (this.stage === 'green') return 'green';
    if (this.stage === 'yellow') return 'yellow';
    return 'red';
  }

  pedWalk() {
    return this.phase === 'ped' && this.stage === 'walk';
  }

  hasVehDemand() {
    for (const k of this.apps) if (this.demand[k] > 0) return true;
    return false;
  }

  /** Ada arah lain dengan antrean yang hampir melewati batas merah? */
  starvingOther(k) {
    const redT = this.redT;
    if (!redT) return false;
    const limit = TIMING.maxRed - TIMING.yellow - TIMING.allRed;
    for (const a of this.apps) if (a !== k && this.demand[a] > 0 && redT[a] > limit) return true;
    return false;
  }

  pickNext(mode) {
    if (mode === 'tetap') {
      this.cursor = (this.cursor + 1) % this.order.length;
      return this.order[this.cursor];
    }
    const redT = this.redT || (this.redT = [0, 0, 0, 0]);
    // Arah yang sudah terlalu lama merah padahal ada antrean didahulukan (yang paling lama lebih dulu).
    let starving = -1;
    for (const k of this.apps) {
      if (this.demand[k] > 0 && redT[k] > TIMING.maxRed && (starving < 0 || redT[k] > redT[starving])) starving = k;
    }
    if (starving >= 0 && !(this.pedWait > 0 && this.pedWaitT > redT[starving])) return starving;
    const pedUrgent = this.pedWait > 0 && (this.pedWaitT > 20 || !this.hasVehDemand() || this.sincePed > 45);
    if (pedUrgent) return 'ped';
    // Giliran berputar dilanjutkan dari arah kendaraan yang terakhir mendapat hijau,
    // termasuk setelah fase pejalan kaki, supaya tidak ada arah yang terlewat terus.
    const n = this.apps.length;
    const last = typeof this.lastVeh === 'number' ? this.lastVeh : typeof this.phase === 'number' ? this.phase : -1;
    const lastIdx = this.apps.indexOf(last);
    for (let i = 1; i <= n; i++) {
      const k = this.apps[(lastIdx + i + n) % n];
      if (this.demand[k] > 0) return k;
    }
    if (this.pedWait > 0) return 'ped';
    return 'rest';
  }

  start(phase) {
    this.phase = phase;
    this.t = 0;
    this.noDemandT = 0;
    if (phase === 'rest') this.stage = 'rest';
    else if (phase === 'ped') {
      this.stage = 'walk';
      this.sincePed = 0;
    } else this.stage = 'green';
    if (typeof phase === 'number') {
      const idx = this.order.indexOf(phase);
      if (idx >= 0) this.cursor = idx;
      this.lastVeh = phase;
      if (this.redT) this.redT[phase] = 0;
    } else if (phase === 'ped') this.cursor = this.order.length - 1;
  }

  step(dt, mode) {
    this.t += dt;
    this.sincePed += dt;
    this.pedWaitT = this.pedWait > 0 ? this.pedWaitT + dt : 0;
    // lama merah tiap arah selama ada kendaraan yang menunggu
    const redT = this.redT || (this.redT = [0, 0, 0, 0]);
    for (const k of this.apps) {
      if (this.demand[k] === 0) redT[k] = 0;
      else if (this.colorFor(k) !== 'green') redT[k] += dt;
    }
    switch (this.stage) {
      case 'green': {
        const k = this.phase;
        if (this.demand[k] > 0) this.noDemandT = 0;
        else this.noDemandT += dt;
        let end = false;
        if (mode === 'tetap') end = this.t >= TIMING.fixedGreen;
        else if (this.t >= TIMING.minGreen) {
          const othersWant = this.pedWait > 0 || this.apps.some((a) => a !== k && this.demand[a] > 0);
          if (this.noDemandT >= TIMING.gapOut) end = true;
          else if (this.t >= TIMING.maxGreen && othersWant) end = true;
          else if (this.starvingOther(k)) end = true;
        }
        if (end) {
          this.stage = 'yellow';
          this.t = 0;
        }
        break;
      }
      case 'yellow':
        if (this.t >= TIMING.yellow) {
          this.stage = 'allred';
          this.t = 0;
        }
        break;
      case 'walk':
        if (this.t >= TIMING.walk) {
          this.stage = 'pedclear';
          this.t = 0;
        }
        break;
      case 'pedclear':
        if (this.t >= TIMING.pedClear) {
          this.stage = 'allred';
          this.t = 0;
        }
        break;
      case 'allred':
        if (this.t >= TIMING.allRed) this.start(this.pickNext(mode));
        break;
      case 'rest': {
        if (mode === 'tetap') this.start(this.pickNext(mode));
        else if (this.pedWait > 0 || this.hasVehDemand()) {
          const nx = this.pickNext(mode);
          if (nx !== 'rest') this.start(nx);
        }
        break;
      }
      default:
        break;
    }
  }

  /** Teks singkat fase saat ini, untuk panel Kota pintar. */
  describe() {
    if (this.stage === 'rest') return 'Semua merah, menunggu antrean';
    if (this.phase === 'ped') return this.stage === 'walk' ? 'Giliran pejalan kaki' : 'Pejalan kaki menyelesaikan penyeberangan';
    const names = ['dari barat', 'dari utara', 'dari timur', 'dari selatan'];
    if (this.stage === 'allred') return 'Semua merah (jeda pengosongan)';
    return `${this.stage === 'green' ? 'Hijau' : 'Kuning'} untuk arah ${names[this.phase]}`;
  }
}

const LAMP_ON = { red: new THREE.Color('#ff3b30'), yellow: new THREE.Color('#ffcc00'), green: new THREE.Color('#22e36b') };
const LAMP_OFF = { red: new THREE.Color('#3a1614'), yellow: new THREE.Color('#3a3214'), green: new THREE.Color('#10301d') };

export class Signals {
  constructor(app) {
    this.app = app;
    this.mode = 'adaptif';
    this.list = [];
    this.byNode = new Map();
    for (const n of app.graph.nodes) {
      if (!n.signalized) continue;
      const c = new Controller(n, app.rng);
      this.list.push(c);
      this.byNode.set(n.id, c);
    }
    this.waits = { adaptif: { sum: 0, count: 0, ring: [] }, tetap: { sum: 0, count: 0, ring: [] } };
    this.waitingNow = 0;
    this.buildMeshes();
  }

  setMode(mode) {
    if (mode !== 'adaptif' && mode !== 'tetap') return;
    this.mode = mode;
  }

  colorAt(nodeId, k) {
    const c = this.byNode.get(nodeId);
    return c ? c.colorFor(k) : 'green';
  }

  pedWalk(nodeId) {
    const c = this.byNode.get(nodeId);
    return c ? c.pedWalk() : false;
  }

  recordWait(sec) {
    const w = this.waits[this.mode];
    w.sum += sec;
    w.count++;
    w.ring.push(sec);
    if (w.ring.length > 120) w.ring.shift();
  }

  avgWait(mode) {
    const w = this.waits[mode];
    if (!w.ring.length) return null;
    let s = 0;
    for (const v of w.ring) s += v;
    return s / w.ring.length;
  }

  step(dt) {
    for (const c of this.list) c.step(dt, this.mode);
  }

  buildMeshes() {
    const { app } = this;
    const res = app.res;
    const hw = new GeoBuf();
    const dark = new THREE.Color('#262d38');
    const housing = new THREE.Color('#141a22');
    this.approaches = [];
    const lampPos = [];
    const barPos = [];
    for (const c of this.list) {
      const n = c.node;
      for (const k of c.apps) {
        // Kendaraan masuk bergerak ke arah k. Tiang di trotoar kiri, sebelum garis henti.
        const dx = DX[k];
        const dz = DZ[k];
        const lx = dz;
        const lz = -dx;
        const px = n.x - dx * (GRID.CONN + 0.9) + lx * 7.9;
        const pz = n.z - dz * (GRID.CONN + 0.9) + lz * 7.9;
        hw.box(px - 0.11, 0.15, pz - 0.11, px + 0.11, 5.6, pz + 0.11, dark);
        // lengan di atas jalan ke arah kanan (menuju lajur)
        const ex = px - lx * 5.6;
        const ez = pz - lz * 5.6;
        hw.box(Math.min(px, ex) - 0.07, 5.42, Math.min(pz, ez) - 0.07, Math.max(px, ex) + 0.07, 5.56, Math.max(pz, ez) + 0.07, dark);
        const heads = [
          [px - lx * 5.0, 4.75, pz - lz * 5.0],
          [px - lx * 0.05 - dx * 0.25, 2.9, pz - lz * 0.05 - dz * 0.25],
        ];
        const idx = [];
        for (const [hx, hy, hz] of heads) {
          hw.box(hx - 0.24, hy - 0.62, hz - 0.24, hx + 0.24, hy + 0.62, hz + 0.24, housing, { bottom: true });
          // Lampu menghadap kendaraan yang datang (arah -d)
          for (const [dy, name] of [
            [0.36, 'red'],
            [0, 'yellow'],
            [-0.36, 'green'],
          ]) {
            idx.push({ i: lampPos.length, name });
            lampPos.push([hx - dx * 0.25, hy + dy, hz - dz * 0.25]);
          }
        }
        const bar = barPos.length;
        barPos.push({ n, k });
        this.approaches.push({ ctl: c, k, lamps: idx, bar, last: '' });
        app.world.poles.push({ x: px, z: pz, r: 0.13, h: 5.6 });
      }
    }
    const mat = res.add(new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.hwMesh = new THREE.Mesh(res.add(hw.build()), mat);
    this.hwMesh.castShadow = true;
    app.scene.add(this.hwMesh);

    const lampGeo = res.add(new THREE.SphereGeometry(0.15, 10, 8));
    const lampMat = res.add(new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    this.lamps = new THREE.InstancedMesh(lampGeo, lampMat, lampPos.length);
    const m4 = new THREE.Matrix4();
    lampPos.forEach(([x, y, z], i) => {
      m4.makeTranslation(x, y, z);
      this.lamps.setMatrixAt(i, m4);
      this.lamps.setColorAt(i, LAMP_OFF.red);
    });
    app.scene.add(this.lamps);

    // Garis antrean di aspal, panjangnya mengikuti antrean kendaraan yang berhenti.
    const barGeo = res.add(new THREE.PlaneGeometry(1, 1));
    barGeo.rotateX(-Math.PI / 2);
    const barMat = res.add(new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, depthWrite: false, fog: false }));
    this.bars = new THREE.InstancedMesh(barGeo, barMat, barPos.length);
    this.bars.frustumCulled = false;
    this.bars.renderOrder = 3;
    this.barInfo = barPos;
    barPos.forEach((b, i) => {
      m4.makeScale(0.0001, 1, 0.0001);
      this.bars.setMatrixAt(i, m4);
      this.bars.setColorAt(i, new THREE.Color('#22c55e'));
    });
    app.scene.add(this.bars);
    // Garis antrean baru dibahas di langkah Kota pintar, jadi awalnya disembunyikan.
    this.showQueues = false;
  }

  sync() {
    let dirty = false;
    for (const ap of this.approaches) {
      const state = ap.ctl.colorFor(ap.k);
      if (state === ap.last) continue;
      ap.last = state;
      dirty = true;
      for (const l of ap.lamps) this.lamps.setColorAt(l.i, l.name === state ? LAMP_ON[l.name] : LAMP_OFF[l.name]);
    }
    if (dirty) this.lamps.instanceColor.needsUpdate = true;

    this.bars.visible = this.showQueues;
    if (!this.showQueues) return;
    const m4 = this.m4 || (this.m4 = new THREE.Matrix4());
    const c = this.tmpC || (this.tmpC = new THREE.Color());
    for (const ap of this.approaches) {
      const b = this.barInfo[ap.bar];
      const len = ap.ctl.queueLen[ap.k];
      const dx = DX[ap.k];
      const dz = DZ[ap.k];
      const lx = dz;
      const lz = -dx;
      if (len < 1) {
        m4.makeScale(0.0001, 1, 0.0001);
      } else {
        const cx = b.n.x - dx * (GRID.CONN + len / 2) + lx * 3.5;
        const cz = b.n.z - dz * (GRID.CONN + len / 2) + lz * 3.5;
        // pita selebar 3 m di tengah kedua lajur masuk, tidak menutupi seluruh jalan
        const sx = dx !== 0 ? len : 3;
        const sz = dx !== 0 ? 3 : len;
        m4.makeScale(sx, 1, sz);
        m4.setPosition(cx, 0.04, cz);
        // hijau (antrean pendek) ke kuning ke merah (antrean panjang)
        const t = Math.min(1, len / 40);
        if (t < 0.5) c.setRGB(0.13 + t * 1.7, 0.85, 0.3 - t * 0.4, THREE.SRGBColorSpace);
        else c.setRGB(0.98, 0.85 - (t - 0.5) * 1.3, 0.1, THREE.SRGBColorSpace);
        this.bars.setColorAt(ap.bar, c);
      }
      this.bars.setMatrixAt(ap.bar, m4);
    }
    this.bars.instanceMatrix.needsUpdate = true;
    if (this.bars.instanceColor) this.bars.instanceColor.needsUpdate = true;
  }
}
