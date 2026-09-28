// Lampu lalu lintas SIMULASI (data OSM di area ini tidak punya lampu). Waktu tetap:
// tiap lengan mendapat hijau sendiri (fase terlindung), lalu kuning dan merah semua sebagai jeda
// pengosongan. Setelah semua lengan, ada fase pejalan kaki eksklusif (semua kendaraan merah).
//
// Durasi kuning dipilih supaya aturan keselamatan terpenuhi:
//   kuning >= waktu reaksi + v_maks / (2 x perlambatan nyaman) + sela
//          = 1,0 + 11,1 / (2 x 2,2) + 0,5 = 4,0 detik (kondisi paling licin), jadi dipakai 4,5 detik.
import * as THREE from '../vendor/three.bundle.min.js';
import { GeoBuf } from './geobuf.js';
import { SHIELD } from './shield.js';

export const YELLOW_MIN = 1.0 + SHIELD.vMaxGlobal / (2 * 2.2) + 0.5;

export class SignalCtl {
  constructor(data, city, offset) {
    this.id = data.id;
    this.data = data;
    this.arms = data.arms;
    this.junction = city.junctions[data.j];
    const plan = data.plan;
    this.plan = plan;
    if (plan.yellow < YELLOW_MIN) throw new Error('durasi kuning terlalu pendek untuk aturan keselamatan');
    this.stages = [];
    this.arms.forEach((a, i) => {
      const major = a.cls === 'tertiary';
      this.stages.push({ type: 'green', arm: i, dur: major ? plan.green : plan.greenMinor });
      this.stages.push({ type: 'yellow', arm: i, dur: plan.yellow });
      this.stages.push({ type: 'allred', arm: -1, dur: plan.allRed });
    });
    // lama fase hijau pejalan kaki dan pengosongan mengikuti zebra cross terpanjang
    let longest = 0;
    for (const xid of data.xw) longest = Math.max(longest, city.crossings[xid].len);
    this.pedClearDur = Math.max(plan.pedClear, Math.ceil(longest / 1.1) + 1);
    if (data.xw.length) {
      this.stages.push({ type: 'walk', arm: -1, dur: plan.walk });
      this.stages.push({ type: 'pedclear', arm: -1, dur: this.pedClearDur });
      this.stages.push({ type: 'allred', arm: -1, dur: plan.allRed });
    }
    this.cycle = this.stages.reduce((a, s) => a + s.dur, 0);
    this.k = 0;
    this.t = 0;
    this.phaseKey = 1;
    this.advance(offset % this.cycle);
    this.crossings = data.xw.map((id) => city.crossings[id]);
    for (const X of this.crossings) X.signal = this;
    this.arms.forEach((a, i) => {
      for (const lid of a.lanes) city.lanes[lid].sig = { ctl: this, arm: i };
    });
  }

  advance(dt) {
    this.t += dt;
    let st = this.stages[this.k];
    while (this.t >= st.dur) {
      this.t -= st.dur;
      this.k = (this.k + 1) % this.stages.length;
      this.phaseKey++;
      st = this.stages[this.k];
    }
  }

  step(dt) {
    this.advance(dt);
  }

  get stage() {
    return this.stages[this.k];
  }

  color(arm) {
    const st = this.stages[this.k];
    if (st.arm !== arm) return 'red';
    return st.type === 'green' ? 'green' : st.type === 'yellow' ? 'yellow' : 'red';
  }

  yellowLeft() {
    const st = this.stages[this.k];
    return st.type === 'yellow' ? st.dur - this.t : 0;
  }

  pedWalk() {
    return this.stages[this.k].type === 'walk';
  }

  /** Detik sampai lengan arm hijau lagi (0 bila sedang hijau). */
  timeToGreen(arm) {
    let t = 0;
    let k = this.k;
    let first = true;
    for (let n = 0; n < this.stages.length + 1; n++) {
      const st = this.stages[k];
      if (st.type === 'green' && st.arm === arm) return t;
      t += first ? st.dur - this.t : st.dur;
      first = false;
      k = (k + 1) % this.stages.length;
    }
    return t;
  }
}

const LAMP_ON = { red: new THREE.Color('#ff3b30'), yellow: new THREE.Color('#ffc400'), green: new THREE.Color('#2ee06f') };
const LAMP_OFF = { red: new THREE.Color('#3b1a18'), yellow: new THREE.Color('#3b3218'), green: new THREE.Color('#16361f') };
const PED_ON = { red: new THREE.Color('#ff4d3d'), green: new THREE.Color('#3cf07d') };
const PED_OFF = new THREE.Color('#2a2f36');

export class Signals {
  constructor(app) {
    this.app = app;
    const city = app.city;
    this.list = city.signalsData.map((d, i) => new SignalCtl(d, city, i * 23.5));
    this.buildMeshes();
  }

  step(dt) {
    for (const c of this.list) c.step(dt);
  }

  buildMeshes() {
    const { app } = this;
    const res = app.res;
    const buf = new GeoBuf();
    const poleCol = new THREE.Color('#4a5260');
    const housing = new THREE.Color('#1d232b');
    const lamps = [];
    const peds = [];
    this.heads = [];
    for (const ctl of this.list) {
      ctl.arms.forEach((a, i) => {
        // tiang di trotoar kiri, sedikit sebelum garis henti; kepala lampu menghadap kendaraan datang
        const c = Math.cos(a.h);
        const s = Math.sin(a.h);
        const lx = s; // kiri dari arah datang = (sin h, -cos h)
        const lz = -c;
        const px = a.x - c * 1.2 + lx * (a.half + 0.7);
        const pz = a.z - s * 1.2 + lz * (a.half + 0.7);
        buf.box(px - 0.08, 0, pz - 0.08, px + 0.08, 3.6, pz + 0.08, poleCol);
        // lengan menjulur ke atas lajur
        const ex = px - lx * 2.6;
        const ez = pz - lz * 2.6;
        buf.box(Math.min(px, ex) - 0.05, 3.45, Math.min(pz, ez) - 0.05, Math.max(px, ex) + 0.05, 3.55, Math.max(pz, ez) + 0.05, poleCol);
        const heads = [
          [px - lx * 2.2, 3.05, pz - lz * 2.2],
          [px - c * 0.18, 2.3, pz - s * 0.18],
        ];
        const idx = [];
        for (const [hx, hy, hz] of heads) {
          buf.box(hx - 0.2, hy - 0.5, hz - 0.2, hx + 0.2, hy + 0.5, hz + 0.2, housing, { bottom: true });
          for (const [dy, name] of [
            [0.3, 'red'],
            [0, 'yellow'],
            [-0.3, 'green'],
          ]) {
            idx.push({ i: lamps.length, name });
            lamps.push([hx - c * 0.21, hy + dy, hz - s * 0.21]);
          }
        }
        this.heads.push({ ctl, arm: i, lamps: idx, last: '' });
        app.world.poles.push({ x: px, z: pz, r: 0.1, h: 3.6 });
      });
      // lampu pejalan kaki kecil di kedua ujung zebra cross
      for (const X of ctl.crossings) {
        const nx = -X.uz;
        const nz = X.ux;
        for (const sg of [1, -1]) {
          const qx = X.x + nx * sg * (X.len / 2 + 0.5) + X.ux * (X.w / 2 + 0.3);
          const qz = X.z + nz * sg * (X.len / 2 + 0.5) + X.uz * (X.w / 2 + 0.3);
          buf.box(qx - 0.05, 0, qz - 0.05, qx + 0.05, 2.1, qz + 0.05, poleCol);
          buf.box(qx - 0.14, 2.1, qz - 0.14, qx + 0.14, 2.55, qz + 0.14, housing);
          peds.push({ ctl, p: [qx - nx * sg * 0.15, 2.42, qz - nz * sg * 0.15], color: 'red' });
          peds.push({ ctl, p: [qx - nx * sg * 0.15, 2.22, qz - nz * sg * 0.15], color: 'green' });
        }
      }
    }
    const mesh = new THREE.Mesh(res.add(buf.build()), res.add(new THREE.MeshLambertMaterial({ vertexColors: true })));
    mesh.castShadow = true;
    app.scene.add(mesh);
    this.hwMesh = mesh;
    const lampGeo = res.add(new THREE.SphereGeometry(0.11, 10, 8));
    const lampMat = res.add(new THREE.MeshBasicMaterial({ color: '#ffffff', fog: false }));
    this.lamps = new THREE.InstancedMesh(lampGeo, lampMat, Math.max(1, lamps.length));
    const m4 = new THREE.Matrix4();
    lamps.forEach(([x, y, z], i) => {
      m4.makeTranslation(x, y, z);
      this.lamps.setMatrixAt(i, m4);
      this.lamps.setColorAt(i, LAMP_OFF.red);
    });
    this.lamps.count = lamps.length;
    app.scene.add(this.lamps);
    const pedGeo = res.add(new THREE.BoxGeometry(0.16, 0.14, 0.16));
    this.pedLamps = new THREE.InstancedMesh(pedGeo, res.add(new THREE.MeshBasicMaterial({ color: '#ffffff', fog: false })), Math.max(1, peds.length));
    peds.forEach((pl, i) => {
      m4.makeTranslation(pl.p[0], pl.p[1], pl.p[2]);
      this.pedLamps.setMatrixAt(i, m4);
      this.pedLamps.setColorAt(i, PED_OFF);
    });
    this.pedLamps.count = peds.length;
    this.pedList = peds;
    app.scene.add(this.pedLamps);
  }

  sync() {
    let dirty = false;
    for (const hd of this.heads) {
      const state = hd.ctl.color(hd.arm);
      if (state === hd.last) continue;
      hd.last = state;
      dirty = true;
      for (const l of hd.lamps) this.lamps.setColorAt(l.i, l.name === state ? LAMP_ON[l.name] : LAMP_OFF[l.name]);
    }
    if (dirty) this.lamps.instanceColor.needsUpdate = true;
    let pd = false;
    this.pedList.forEach((pl, i) => {
      const walk = pl.ctl.pedWalk();
      const clear = pl.ctl.stage.type === 'pedclear';
      // saat pengosongan, lampu hijau pejalan kaki berkedip pelan
      const blinkOn = Math.floor(this.app.simTime * 2) % 2 === 0;
      const want = pl.color === 'green' ? (walk || (clear && blinkOn) ? PED_ON.green : PED_OFF) : walk || clear ? PED_OFF : PED_ON.red;
      if (pl.cur !== want) {
        pl.cur = want;
        this.pedLamps.setColorAt(i, want);
        pd = true;
      }
    });
    if (pd) this.pedLamps.instanceColor.needsUpdate = true;
  }
}
