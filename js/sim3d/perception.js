// Persepsi: mengubah titik LiDAR dan gambar kamera menjadi daftar objek (kelas, jarak, kecepatan).
// Penyederhanaan jujur: pengelompokan titik memakai identitas objek yang terkena sinar,
// dan kelas diambil dari kamera atau dari bentuk titik bila titiknya cukup banyak.
import * as THREE from '../vendor/three.bundle.min.js';
import { fmt } from './util.js';

export const CLASSES = {
  mobil: { label: 'Mobil', color: '#60a5fa' },
  pejalan: { label: 'Pejalan kaki', color: '#f472b6' },
  kerucut: { label: 'Kerucut', color: '#fb923c' },
  kardus: { label: 'Kardus', color: '#d6a36b' },
  mogok: { label: 'Mobil mogok', color: '#f59e0b' },
  objek: { label: 'Objek', color: '#cbd5e1' },
};
export const STATIC_CLASSES = new Set(['kerucut', 'kardus', 'mogok']);

/**
 * Jarak antarbadan dari mobil otonom ke objek (x, z = posisi objek): jarak pusat dikurangi
 * setengah panjang atau lebar kedua badan ke arah satu sama lain. Untuk objek tepat di depan,
 * nilainya sama dengan jarak bumper depan ke bagian belakang objek. Dipakai label 3D,
 * daftar objek, dan objek pembatas supaya angkanya sama.
 */
export function footGap(e, t, x, z) {
  const dx = x - e.x;
  const dz = z - e.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return 0;
  const ux = dx / d;
  const uz = dz / d;
  const ce = Math.cos(e.h);
  const se = Math.sin(e.h);
  const extE = Math.abs(ux * ce + uz * se) * e.hl + Math.abs(-ux * se + uz * ce) * e.hw;
  const h = t.h || 0;
  const ct = Math.cos(h);
  const st = Math.sin(h);
  const extT = Math.abs(ux * ct + uz * st) * (t.hl || 0) + Math.abs(-ux * st + uz * ct) * (t.hw || 0);
  return Math.max(0, d - extE - extT);
}
const MAX_BOXES = 48;
const MAX_LABELS = 9;

export class Perception {
  constructor(app) {
    this.app = app;
    this.tracks = new Map();
    this.list = [];
    this.showBoxes = true;
    this.pedSeen = false;
    this.light = null;
    this.buildVisuals();
  }

  update(now) {
    const { app } = this;
    const seen = app.sensing.seen;
    const e = app.ego;
    for (const [id, s] of seen) {
      const o = s.o;
      const small = o.cls === 'pejalan' || o.cls === 'kerucut' || o.cls === 'kardus';
      if (!(s.cam || s.pts >= (small ? 1 : 2))) continue;
      let t = this.tracks.get(id);
      const known = s.cam || s.pts >= 5;
      if (!t) {
        t = { id, cls: o.cls, x: o.x, z: o.z, vx: 0, vz: 0, n: 0, t: now, known: false };
        this.tracks.set(id, t);
      } else {
        const dt = Math.max(1e-3, now - t.t);
        const mvx = (o.x - t.x) / dt;
        const mvz = (o.z - t.z) / dt;
        const k = t.n < 2 ? 1 : 0.6;
        t.vx += (mvx - t.vx) * k;
        t.vz += (mvz - t.vz) * k;
      }
      t.n++;
      t.x = o.x;
      t.z = o.z;
      t.h = o.h;
      t.hl = o.hl;
      t.hw = o.hw;
      t.height = o.height;
      t.t = now;
      t.pts = s.pts;
      t.cam = s.cam;
      t.known = t.known || known;
      t.cls = o.cls;
      t.ref = o;
      // Laju perubahan jarak dibagi selang waktu yang sebenarnya sejak jarak terakhir diukur
      // (objek bisa beberapa pindaian tidak terlihat, misalnya terhalang atau saat hujan).
      const dPrev = t.dist;
      const tPrev = t.tDist;
      t.dist = Math.hypot(o.x - e.x, o.z - e.z);
      t.tDist = now;
      if (dPrev === undefined) t.rate = 0;
      else {
        const r = (t.dist - dPrev) / Math.max(0.05, now - tPrev);
        t.rate = t.n <= 2 ? r : t.rate * 0.4 + r * 0.6;
      }
    }
    for (const [id, t] of this.tracks) if (now - t.t > 0.35 || (t.ref && t.ref.removed)) this.tracks.delete(id);
    this.list = [...this.tracks.values()];
    for (const t of this.list) if (t.cls === 'pejalan') this.pedSeen = true;
  }

  /** Lupakan objek yang dihapus dari jalan (misalnya rintangan), tanpa menunggu pindaian berikutnya. */
  forget(id) {
    if (!this.tracks.delete(id)) return;
    this.list = this.list.filter((t) => t.id !== id);
  }

  /** Jarak antarbadan dari mobil ke objek pada posisi perkiraannya. */
  gap(t) {
    return footGap(this.app.ego, t, t.px ?? t.x, t.pz ?? t.z);
  }

  /** Posisi objek diperkirakan maju sesuai kecepatannya sejak pembaruan terakhir. */
  predict(now) {
    for (const t of this.list) {
      const dt = Math.min(0.3, now - t.t);
      t.px = t.x + t.vx * dt;
      t.pz = t.z + t.vz * dt;
    }
    return this.list;
  }

  /** Label (kira-kira 90 x 20 piksel, di atas titik sx, sy) bertumpuk dengan panel HUD? */
  hiddenBehindPanel(sx, sy) {
    const occ = this.app.hud ? this.app.hud.occ : null;
    if (!occ) return false;
    const l = sx - 45;
    const r = sx + 45;
    const t = sy - 22;
    for (const o of occ) if (r > o.l && l < o.r && sy > o.t && t < o.b) return true;
    return false;
  }

  label(t) {
    return CLASSES[t.known ? t.cls : 'objek'].label;
  }

  counts() {
    const c = {};
    for (const t of this.list) {
      const k = t.known ? t.cls : 'objek';
      c[k] = (c[k] || 0) + 1;
    }
    return c;
  }

  buildVisuals() {
    const { app } = this;
    const res = app.res;
    this.boxPos = new Float32Array(MAX_BOXES * 24 * 3);
    this.boxCol = new Float32Array(MAX_BOXES * 24 * 3);
    const g = res.add(new THREE.BufferGeometry());
    this.boxPosAttr = new THREE.BufferAttribute(this.boxPos, 3).setUsage(THREE.DynamicDrawUsage);
    this.boxColAttr = new THREE.BufferAttribute(this.boxCol, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.boxPosAttr);
    g.setAttribute('color', this.boxColAttr);
    g.setDrawRange(0, 0);
    this.boxes = new THREE.LineSegments(g, res.add(new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, depthTest: true, fog: false })));
    this.boxes.frustumCulled = false;
    this.boxes.renderOrder = 7;
    app.scene.add(this.boxes);
    this.colors = {};
    for (const [k, v] of Object.entries(CLASSES)) this.colors[k] = new THREE.Color(v.color);
    this.v3 = new THREE.Vector3();
  }

  sync(camera, labelsEl, width, height) {
    const { app } = this;
    const e = app.ego;
    const now = app.simTime;
    const list = this.predict(now);
    let nb = 0;
    const P = this.boxPos;
    const C = this.boxCol;
    if (this.showBoxes) {
      for (const t of list) {
        if (nb >= MAX_BOXES) break;
        const c = Math.cos(t.h);
        const s = Math.sin(t.h);
        const hl = t.hl + 0.12;
        const hw = t.hw + 0.12;
        const y0 = t.ref && t.ref.onRoad === false && t.cls === 'pejalan' ? 0.15 : 0.02;
        const y1 = y0 + t.height + 0.08;
        const cx = [];
        const cz = [];
        for (const [a, b] of [
          [hl, hw],
          [hl, -hw],
          [-hl, -hw],
          [-hl, hw],
        ]) {
          cx.push(t.px + c * a - s * b);
          cz.push(t.pz + s * a + c * b);
        }
        let o = nb * 72;
        const col = this.colors[t.known ? t.cls : 'objek'];
        const seg = (x0, yA, z0, x1, yB, z1) => {
          P[o] = x0;
          P[o + 1] = yA;
          P[o + 2] = z0;
          P[o + 3] = x1;
          P[o + 4] = yB;
          P[o + 5] = z1;
          C[o] = C[o + 3] = col.r;
          C[o + 1] = C[o + 4] = col.g;
          C[o + 2] = C[o + 5] = col.b;
          o += 6;
        };
        for (let i = 0; i < 4; i++) {
          const j = (i + 1) & 3;
          seg(cx[i], y0, cz[i], cx[j], y0, cz[j]);
          seg(cx[i], y1, cz[i], cx[j], y1, cz[j]);
          seg(cx[i], y0, cz[i], cx[i], y1, cz[i]);
        }
        nb++;
      }
    }
    this.boxes.geometry.setDrawRange(0, nb * 24);
    this.boxPosAttr.needsUpdate = true;
    this.boxColAttr.needsUpdate = true;
    this.boxes.visible = this.showBoxes;

    // Label HTML untuk objek terdekat yang terlihat di layar
    if (!this.labelEls) {
      this.labelEls = [];
      for (let i = 0; i < MAX_LABELS; i++) {
        const d = document.createElement('div');
        d.className = 's3d-label';
        d.hidden = true;
        labelsEl.append(d);
        this.labelEls.push(d);
      }
      this.rangeLabel = document.createElement('div');
      this.rangeLabel.className = 's3d-label s3d-label-range';
      this.rangeLabel.hidden = true;
      labelsEl.append(this.rangeLabel);
    }
    const v = this.v3;
    let li = 0;
    if (this.showBoxes) {
      const sorted = list.slice().sort((a, b) => a.dist - b.dist);
      for (const t of sorted) {
        if (li >= MAX_LABELS) break;
        if (t.dist > 70) break;
        v.set(t.px, t.height + 0.55, t.pz);
        v.project(camera);
        if (v.z > 1 || v.x < -1.05 || v.x > 1.05 || v.y < -1.05 || v.y > 1.05) continue;
        const sx = ((v.x + 1) / 2) * width;
        const sy = ((1 - v.y) / 2) * height;
        if (this.hiddenBehindPanel(sx, sy)) continue;
        const el = this.labelEls[li++];
        const txt = `${this.label(t)} ${fmt(this.gap(t), 0)} m`;
        if (el.textContent !== txt) el.textContent = txt;
        const cls = t.known ? t.cls : 'objek';
        if (el.dataset.cls !== cls) el.dataset.cls = cls;
        el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -100%)`;
        el.hidden = false;
      }
    }
    for (let i = li; i < MAX_LABELS; i++) if (!this.labelEls[i].hidden) this.labelEls[i].hidden = true;

    // Label jangkauan LiDAR di tepi cincin (sebelah kanan depan mobil)
    const sens = app.sensing;
    if (sens.showLidar && app.cameras.mode !== 'kokpit') {
      const R = sens.ranges().lidar;
      const a = e.h - 0.75;
      v.set(e.x + Math.cos(a) * R, 0.2, e.z + Math.sin(a) * R);
      v.project(camera);
      const sy = ((1 - v.y) / 2) * height;
      const sx = ((v.x + 1) / 2) * width;
      if (v.z < 1 && Math.abs(v.x) < 0.95 && Math.abs(v.y) < 0.95 && sy > 72 && !this.hiddenBehindPanel(sx, sy + 11)) {
        const txt = `Jangkauan LiDAR ${fmt(R, 0)} m`;
        if (this.rangeLabel.textContent !== txt) this.rangeLabel.textContent = txt;
        this.rangeLabel.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -50%)`;
        this.rangeLabel.hidden = false;
      } else this.rangeLabel.hidden = true;
    } else this.rangeLabel.hidden = true;
  }
}
