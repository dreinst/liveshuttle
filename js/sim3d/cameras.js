// Empat sudut pandang: Orbit (bebas diputar di sekitar mobil), Kejar, Atas, dan Kokpit.
import * as THREE from '../vendor/three.bundle.min.js';

export const CAMERA_MODES = ['orbit', 'kejar', 'atas', 'kokpit'];
export const CAMERA_LABEL = { orbit: 'Orbit', kejar: 'Kejar', atas: 'Atas', kokpit: 'Kokpit' };

export class Cameras {
  constructor(app, camera, dom) {
    this.app = app;
    this.camera = camera;
    this.mode = 'kejar';
    this.controls = new THREE.OrbitControls(camera, dom);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 260;
    this.controls.maxPolarAngle = 1.48;
    this.controls.enabled = false;
    this.last = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.tmp = new THREE.Vector3();
    this.fresh = true;
  }

  set(mode, opts = {}) {
    if (!CAMERA_MODES.includes(mode)) return;
    const prev = this.mode;
    this.mode = mode;
    const cam = this.camera;
    const e = this.app.ego;
    cam.up.set(0, 1, 0);
    this.controls.enabled = mode === 'orbit';
    if (mode === 'orbit' && (prev !== 'orbit' || opts.reset)) {
      const dist = opts.dist || 46;
      const back = opts.back ?? 0.7;
      cam.position.set(e.x - Math.cos(e.h) * dist * back - Math.sin(e.h) * dist * 0.3, dist * 0.9, e.z - Math.sin(e.h) * dist * back + Math.cos(e.h) * dist * 0.3);
      this.controls.target.set(e.x, 0, e.z);
      this.controls.update();
    }
    if (mode === 'atas') this.topHeight = opts.height || 95;
    cam.fov = mode === 'kokpit' ? 70 : mode === 'atas' ? 50 : 55;
    cam.near = mode === 'kokpit' ? 0.08 : 0.3;
    cam.updateProjectionMatrix();
    this.last.set(e.x, 0, e.z);
    this.fresh = true;
    this.app.ego.setCockpit(mode === 'kokpit');
  }

  update(dt) {
    const cam = this.camera;
    const e = this.app.ego;
    const f = 1 - Math.exp(-dt * 5);
    const c = Math.cos(e.h);
    const s = Math.sin(e.h);
    switch (this.mode) {
      case 'orbit': {
        const dx = e.x - this.last.x;
        const dz = e.z - this.last.z;
        cam.position.x += dx;
        cam.position.z += dz;
        this.controls.target.x += dx;
        this.controls.target.z += dz;
        this.controls.update();
        break;
      }
      case 'kejar': {
        // 10 m di belakang, 6,2 m di atas, dan sedikit ke kanan (ke arah marka tengah) supaya
        // kamera tidak menembus tiang lampu di trotoar kiri.
        const tx = e.x - c * 10 - s * 0.8;
        const tz = e.z - s * 10 + c * 0.8;
        const k = this.fresh ? 1 : f;
        cam.position.x += (tx - cam.position.x) * k;
        cam.position.y += (6.2 - cam.position.y) * k;
        cam.position.z += (tz - cam.position.z) * k;
        const lx = e.x + c * 9;
        const lz = e.z + s * 9;
        if (this.fresh) this.look.set(lx, 1.2, lz);
        else this.look.set(this.look.x + (lx - this.look.x) * f * 1.6, 1.2, this.look.z + (lz - this.look.z) * f * 1.6);
        cam.lookAt(this.look);
        break;
      }
      case 'atas': {
        const k = this.fresh ? 1 : 1 - Math.exp(-dt * 6);
        cam.position.x += (e.x - cam.position.x) * k;
        cam.position.z += (e.z + 0.01 - cam.position.z) * k;
        cam.position.y = this.topHeight;
        cam.up.set(0, 0, -1);
        cam.lookAt(cam.position.x, 0, cam.position.z - 0.01);
        break;
      }
      case 'kokpit': {
        // setir kanan (Indonesia): pengemudi duduk di sisi kanan mobil
        cam.position.set(e.x + c * 0.1 - s * 0.38, 1.3, e.z + s * 0.1 + c * 0.38);
        this.tmp.set(e.x + c * 30 - s * 0.38, 0.6, e.z + s * 30 + c * 0.38);
        cam.lookAt(this.tmp);
        break;
      }
      default:
        break;
    }
    this.last.set(e.x, 0, e.z);
    this.fresh = false;
  }

  dispose() {
    this.controls.dispose();
  }
}
