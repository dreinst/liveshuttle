// Mobil otonom (ego): model sepeda kinematik, aktuator gas/rem dengan jeda kecil, dan model 3D-nya.
// Status simulasi (x, z, heading, kecepatan) terpisah dari tampilan. Tampilan hanya menyalin status.
import * as THREE from '../vendor/three.bundle.min.js';
import { clamp } from './util.js';

export const EGO = { len: 4.5, wid: 1.86, wb: 2.7, maxSteer: 0.6, steerRate: 1.8, maxAccel: 2.6, lidarH: 1.95 };

export class Ego {
  constructor(app) {
    this.app = app;
    this.x = 0;
    this.z = 0;
    this.h = 0;
    this.v = 0;
    this.steer = 0;
    this.a = 0;
    this.aCmd = 0;
    this.len = EGO.len;
    this.wid = EGO.wid;
    this.hl = EGO.len / 2;
    this.hw = EGO.wid / 2;
    this.spin = 0;
    this.waitT = 0;
    this.buildMesh();
  }

  /** Satu langkah fisika. steerCmd dalam radian (positif = kanan), accCmd dalam m/s^2. */
  integrate(dt, steerCmd, accCmd, allowReverse) {
    const fx = this.app.weather.fx;
    const target = clamp(steerCmd, -EGO.maxSteer, EGO.maxSteer);
    const dMax = EGO.steerRate * dt;
    this.steer += clamp(target - this.steer, -dMax, dMax);
    this.aCmd = accCmd;
    // aktuator: percepatan nyata mengikuti perintah dengan jeda sekitar 0,15 detik
    this.a += (accCmd - this.a) * Math.min(1, dt / 0.15);
    this.a = clamp(this.a, -fx.brakeMax, EGO.maxAccel);
    const vOld = this.v;
    let v = this.v + this.a * dt;
    if (allowReverse) v = clamp(v, -3, 30);
    else if (vOld >= 0 && v < 0) v = 0;
    this.v = v;
    const vm = (vOld + v) / 2;
    const beta = Math.atan(0.5 * Math.tan(this.steer));
    this.x += vm * Math.cos(this.h + beta) * dt;
    this.z += vm * Math.sin(this.h + beta) * dt;
    this.h += ((vm * Math.cos(beta)) / EGO.wb) * Math.tan(this.steer) * dt;
    if (this.h > Math.PI) this.h -= Math.PI * 2;
    if (this.h < -Math.PI) this.h += Math.PI * 2;
  }

  footprint() {
    return { x: this.x, z: this.z, h: this.h, hl: this.hl, hw: this.hw };
  }

  buildMesh() {
    const res = this.app.res;
    const g = new THREE.Group();
    g.name = 'ego';
    const lam = (c) => res.add(new THREE.MeshLambertMaterial({ color: c }));
    const basic = (c) => res.add(new THREE.MeshBasicMaterial({ color: c }));
    const box = (sx, sy, sz, x, y, z, m) => {
      const mesh = new THREE.Mesh(res.add(new THREE.BoxGeometry(sx, sy, sz)), m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      g.add(mesh);
      return mesh;
    };
    const teal = lam('#2dd4bf');
    box(EGO.len, 0.66, EGO.wid, 0, 0.62, 0, teal);
    box(EGO.len - 0.4, 0.34, EGO.wid + 0.04, 0, 0.3, 0, lam('#0f766e'));
    box(2.35, 0.56, 1.66, -0.2, 1.23, 0, lam('#10202e'));
    // sensor kamera di atas kaca depan
    box(0.2, 0.12, 0.34, 0.9, 1.56, 0, basic('#a78bfa'));
    // LiDAR di atap: dudukan dan kepala yang berputar
    const baseGeo = res.add(new THREE.CylinderGeometry(0.26, 0.3, 0.1, 18));
    const base = new THREE.Mesh(baseGeo, lam('#1f2937'));
    base.position.set(-0.2, 1.56, 0);
    g.add(base);
    this.lidarHead = new THREE.Group();
    this.lidarHead.position.set(-0.2, 1.74, 0);
    const headGeo = res.add(new THREE.CylinderGeometry(0.21, 0.21, 0.26, 20));
    const head = new THREE.Mesh(headGeo, lam('#0b1220'));
    this.lidarHead.add(head);
    const stripe = new THREE.Mesh(res.add(new THREE.BoxGeometry(0.06, 0.1, 0.24)), basic('#22d3ee'));
    stripe.position.set(0.2, 0, 0);
    this.lidarHead.add(stripe);
    const ring = new THREE.Mesh(res.add(new THREE.TorusGeometry(0.215, 0.018, 6, 24)), basic('#22d3ee'));
    ring.rotation.x = Math.PI / 2;
    this.lidarHead.add(ring);
    g.add(this.lidarHead);
    // roda
    const wheelGeo = res.add(new THREE.CylinderGeometry(0.34, 0.34, 0.26, 14));
    wheelGeo.rotateX(Math.PI / 2);
    const wheelMat = lam('#111418');
    this.frontWheels = [];
    for (const [x, z] of [
      [1.35, 0.86],
      [1.35, -0.86],
      [-1.35, 0.86],
      [-1.35, -0.86],
    ]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.position.set(x, 0.34, z);
      g.add(w);
      if (x > 0) this.frontWheels.push(w);
    }
    // lampu
    const headMat = basic('#fef3c7');
    box(0.06, 0.14, 0.46, EGO.len / 2 + 0.01, 0.74, 0.6, headMat);
    box(0.06, 0.14, 0.46, EGO.len / 2 + 0.01, 0.74, -0.6, headMat);
    this.tailMat = basic('#7f1d1d');
    box(0.06, 0.14, 0.46, -EGO.len / 2 - 0.01, 0.78, 0.6, this.tailMat);
    box(0.06, 0.14, 0.46, -EGO.len / 2 - 0.01, 0.78, -0.6, this.tailMat);
    // lingkaran penanda di tanah supaya mudah ditemukan dari atas
    const haloGeo = res.add(new THREE.RingGeometry(3.0, 3.35, 48));
    haloGeo.rotateX(-Math.PI / 2);
    const halo = new THREE.Mesh(haloGeo, res.add(new THREE.MeshBasicMaterial({ color: '#2dd4bf', transparent: true, opacity: 0.45, depthWrite: false, fog: false })));
    halo.position.y = 0.05;
    halo.renderOrder = 4;
    g.add(halo);
    // lampu depan untuk malam (intensitas 0 saat siang)
    this.headlight = new THREE.SpotLight('#fff1d6', 0, 70, 0.55, 0.5, 1);
    this.headlight.position.set(2.1, 0.9, 0);
    this.headlight.target.position.set(18, 0, 0);
    g.add(this.headlight, this.headlight.target);
    // dasbor sederhana untuk kamera kokpit (bodi mobil disembunyikan saat kokpit)
    this.bodyParts = g.children.filter((c) => c !== this.headlight && c !== this.headlight.target);
    const dash = new THREE.Group();
    const dashBox = new THREE.Mesh(res.add(new THREE.BoxGeometry(0.6, 0.12, 1.78)), lam('#0b1220'));
    dashBox.position.set(0.65, 0.91, 0);
    const dashLine = new THREE.Mesh(res.add(new THREE.BoxGeometry(0.03, 0.02, 1.7)), basic('#2dd4bf'));
    dashLine.position.set(0.95, 0.975, 0);
    dash.add(dashBox, dashLine);
    dash.visible = false;
    g.add(dash);
    this.dash = dash;
    this.mesh = g;
    this.app.scene.add(g);
  }

  /** Mode kokpit: sembunyikan bodi, tampilkan dasbor. */
  setCockpit(on) {
    for (const p of this.bodyParts) p.visible = !on;
    this.dash.visible = on;
  }

  sync(dtReal) {
    const g = this.mesh;
    g.position.set(this.x, 0, this.z);
    g.rotation.y = -this.h;
    this.spin += dtReal * Math.PI * 2 * 2.5;
    this.lidarHead.rotation.y = -this.spin;
    for (const w of this.frontWheels) w.rotation.y = -this.steer;
    const braking = this.a < -0.8 || (Math.abs(this.v) < 0.2 && this.aCmd < -0.1);
    this.tailMat.color.set(braking ? '#ff2b2b' : this.app.weather.night ? '#b91c1c' : '#7f1d1d');
  }
}
