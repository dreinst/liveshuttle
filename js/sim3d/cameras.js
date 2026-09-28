// Empat sudut pandang: Kabin (di dalam shuttle menghadap ke depan), Drone (bebas diputar di
// sekitar shuttle), Sinematik (bidikan otomatis yang pelan dan berganti sudut), dan Peta (dari
// atas, utara di atas). Pergantian mode memudar sekitar 0,8 detik. Kamera mengikuti shuttle
// dengan pegas teredam kritis supaya tidak bergetar.
import * as THREE from '../vendor/three.bundle.min.js';

export const CAMERA_MODES = ['kabin', 'drone', 'sinematik', 'peta'];
export const CAMERA_LABEL = { kabin: 'Kabin', drone: 'Drone', sinematik: 'Sinematik', peta: 'Peta' };
const TWEEN = 0.8;

/** Pegas teredam kritis 1D (tanpa lonjakan). */
class Spring {
  constructor(omega) {
    this.w = omega;
    this.x = 0;
    this.v = 0;
  }
  reset(x) {
    this.x = x;
    this.v = 0;
  }
  step(target, dt) {
    const w = this.w;
    const x = this.x - target;
    const e = Math.exp(-w * dt);
    const nx = (x + (this.v + w * x) * dt) * e;
    this.v = (this.v - w * (this.v + w * x) * dt) * e;
    this.x = target + nx;
    return this.x;
  }
}

export class Cameras {
  constructor(app, camera, dom) {
    this.app = app;
    this.camera = camera;
    this.dom = dom;
    this.mode = 'drone';
    // OrbitControls menggerakkan kamera bayangan; kamera asli mengikuti lewat peralihan halus
    this.orbit = new THREE.PerspectiveCamera();
    this.controls = new THREE.OrbitControls(this.orbit, dom);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 320;
    this.controls.maxPolarAngle = 1.42;
    this.controls.enablePan = false;
    this.controls.enabled = false;
    this.fx = new Spring(5);
    this.fz = new Spring(5);
    this.fh = new Spring(3);
    this.dummy = new THREE.PerspectiveCamera(); // kamera: lookAt mengarahkan sumbu -z ke target
    this.tw = { t: TWEEN, pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: 55 };
    this.look = new THREE.Vector3();
    this.mapHeight = 230;
    this.shot = 0;
    this.shotT = 0;
    this.orbitAng = 0;
    this.fresh = true;
    this.onWheel = (ev) => {
      if (this.mode !== 'peta') return;
      ev.preventDefault();
      this.mapHeight = Math.max(70, Math.min(700, this.mapHeight * (ev.deltaY > 0 ? 1.12 : 1 / 1.12)));
    };
    dom.addEventListener('wheel', this.onWheel, { passive: false });
  }

  /** Pose shuttle yang sudah diinterpolasi (dari app). */
  ego() {
    return this.app.viewOverride || this.app.egoPose;
  }

  set(mode, opts = {}) {
    if (!CAMERA_MODES.includes(mode)) return;
    const cam = this.camera;
    const prev = this.mode;
    this.mode = mode;
    // simpan pose awal untuk peralihan halus
    this.tw.pos.copy(cam.position);
    this.tw.quat.copy(cam.quaternion);
    this.tw.fov = cam.fov;
    this.tw.t = opts.instant || this.fresh ? TWEEN : 0;
    const e = this.ego();
    if (mode === 'drone') {
      if (prev !== 'drone' || opts.reset) {
        const dist = 34;
        const tgt = this.controls.target;
        tgt.set(e.x, 1.5, e.z);
        const c = Math.cos(e.h);
        const s = Math.sin(e.h);
        this.orbit.position.set(e.x - c * dist * 0.72 + s * dist * 0.25, dist * 0.62, e.z - s * dist * 0.72 - c * dist * 0.25);
      }
    }
    if (mode === 'sinematik') {
      this.shot = 0;
      this.shotT = 0;
    }
    this.controls.enabled = mode === 'drone';
    this.app.setCabinView(mode === 'kabin');
    this.fresh = false;
  }

  /** Hitung pose tujuan untuk mode sekarang, lalu terapkan (dengan peralihan bila baru berganti). */
  update(dtReal) {
    const cam = this.camera;
    const e = this.ego();
    const dt = Math.min(0.1, dtReal);
    const fx = this.fx.step(e.x, dt);
    const fz = this.fz.step(e.z, dt);
    let dh = e.h - this.fh.x;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    this.fh.x = e.h - dh;
    const fh = this.fh.step(e.h, dt);
    const c = Math.cos(e.h);
    const s = Math.sin(e.h);
    let fov = 55;
    let near = 0.5;
    const d = this.dummy;
    d.up.set(0, 1, 0);
    switch (this.mode) {
      case 'kabin': {
        // di dalam kabin, di belakang dasbor, memandang ke depan lewat kaca depan
        d.position.set(e.x + c * 1.25, 1.85, e.z + s * 1.25);
        this.look.set(e.x + c * 30, 0.6, e.z + s * 30);
        fov = 60;
        near = 0.08;
        break;
      }
      case 'drone': {
        const tgt = this.controls.target;
        const ox = fx - tgt.x;
        const oz = fz - tgt.z;
        tgt.x += ox;
        tgt.z += oz;
        this.orbit.position.x += ox;
        this.orbit.position.z += oz;
        this.controls.update();
        d.position.copy(this.orbit.position);
        this.look.copy(tgt);
        break;
      }
      case 'sinematik': {
        this.shotT += dt;
        if (this.shotT > 9) {
          this.shotT = 0;
          this.shot = (this.shot + 1) % 4;
          this.tw.t = TWEEN; // potong langsung (cut) ke sudut berikutnya
        }
        const k = this.shotT / 9;
        const hc = Math.cos(fh);
        const hs = Math.sin(fh);
        if (this.shot === 0) {
          // menyamping rendah, bergeser pelan dari depan ke samping
          const side = 9;
          const along = 6 - k * 10;
          d.position.set(fx + hc * along - hs * side, 2.4, fz + hs * along + hc * side);
          this.look.set(fx, 1.4, fz);
          fov = 50;
        } else if (this.shot === 1) {
          // orbit tinggi yang sangat pelan
          const a = fh + Math.PI * 0.75 + k * 0.6;
          d.position.set(fx + Math.cos(a) * 46, 30, fz + Math.sin(a) * 46);
          this.look.set(fx, 0, fz);
          fov = 50;
        } else if (this.shot === 2) {
          // dari depan, rendah, menatap shuttle yang datang
          d.position.set(fx + hc * (16 - k * 3) + hs * 2.5, 1.7, fz + hs * (16 - k * 3) - hc * 2.5);
          this.look.set(fx, 1.5, fz);
          fov = 45;
        } else {
          // dari atas agak miring, perlahan naik
          d.position.set(fx - hc * 22, 48 + k * 10, fz - hs * 22);
          this.look.set(fx + hc * 8, 0, fz + hs * 8);
          fov = 48;
        }
        break;
      }
      case 'peta':
      default: {
        d.position.set(fx, this.mapHeight, fz + 0.001);
        d.up.set(0, 0, -1); // utara (z negatif) di atas layar
        this.look.set(fx, 0, fz);
        fov = 45;
        near = 1;
        break;
      }
    }
    d.lookAt(this.look);
    if (this.tw.t < TWEEN) {
      this.tw.t += dtReal;
      let t = Math.min(1, this.tw.t / TWEEN);
      t = t * t * (3 - 2 * t);
      cam.position.lerpVectors(this.tw.pos, d.position, t);
      cam.quaternion.slerpQuaternions(this.tw.quat, d.quaternion, t);
      cam.fov = this.tw.fov + (fov - this.tw.fov) * t;
      cam.near = t < 1 ? Math.min(near, 0.1) : near;
    } else {
      cam.position.copy(d.position);
      cam.quaternion.copy(d.quaternion);
      cam.fov = fov;
      cam.near = near;
    }
    cam.up.copy(d.up);
    cam.updateProjectionMatrix();
  }

  snapFocus() {
    const e = this.ego();
    this.fx.reset(e.x);
    this.fz.reset(e.z);
    this.fh.reset(e.h);
  }

  dispose() {
    this.dom.removeEventListener('wheel', this.onWheel);
    this.controls.dispose();
  }
}
