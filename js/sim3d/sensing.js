// Sensor: LiDAR di atap dan kamera depan.
// LiDAR: 12 kanal vertikal x 240 arah (1,5 derajat), diperbarui 10 kali per detik.
// Tiap arah memakai satu sinar 2D analitik ke jejak sederhana (kotak dan lingkaran),
// lalu tiap kanal menentukan apakah sinarnya mengenai benda (sesuai tinggi benda) atau tanah.
import * as THREE from '../vendor/three.bundle.min.js';
import { rayAabb, rayCircle, rayObb } from './geom.js';
import { EGO } from './ego.js';

const CHANNELS = [-15, -11, -8, -6, -4.6, -3.6, -2.8, -2.1, -1.5, -0.9, 0.4, 2.2].map((d) => Math.tan((d * Math.PI) / 180));
const AZ = 240;
const MAX_POINTS = AZ * CHANNELS.length + 200;
const RAY_EVERY = 8;
export const BASE_RANGE = { lidar: 60, kamera: 60 };
export const CAM_FOV = Math.PI / 2;

export class Sensing {
  constructor(app) {
    this.app = app;
    this.showLidar = true;
    this.showFov = true;
    this.seen = new Map(); // id objek -> { pts, cam }
    this.pointCount = 0;
    this.scanCount = 0;
    this.phase = 0;
    this.hits = [];
    for (let i = 0; i < 64; i++) this.hits.push({ t: 0, o: null });
    this.buildVisuals();
  }

  ranges() {
    const fx = this.app.weather.fx;
    return { lidar: BASE_RANGE.lidar * fx.lidarRange, kamera: BASE_RANGE.kamera * fx.camRange, lampu: BASE_RANGE.kamera * fx.camLitRange };
  }

  /** Kumpulkan kandidat yang mungkin terkena sinar dalam jangkauan R. */
  candidates(R) {
    const { app } = this;
    const e = app.ego;
    const out = [];
    const near = (x, z, r) => {
      const dx = x - e.x;
      const dz = z - e.z;
      const lim = R + r;
      return dx * dx + dz * dz <= lim * lim;
    };
    for (const o of app.objects) if (near(o.x, o.z, o.hl + o.hw)) out.push(o);
    for (const b of app.world.buildings) {
      const cx = Math.max(b.minx, Math.min(e.x, b.maxx));
      const cz = Math.max(b.minz, Math.min(e.z, b.maxz));
      if (near(cx, cz, 0)) out.push({ kind: 'aabb', b, height: b.h, id: null, isStatic: true });
    }
    for (const t of app.world.trees) if (near(t.x, t.z, t.r)) out.push({ kind: 'circle', x: t.x, z: t.z, r: t.r, height: t.h, id: null, isStatic: true });
    for (const p of app.world.poles) if (near(p.x, p.z, p.r)) out.push({ kind: 'circle', x: p.x, z: p.z, r: p.r, height: p.h, id: null, isStatic: true });
    return out;
  }

  hitT(o, ox, oz, dx, dz) {
    if (o.kind === 'aabb') return rayAabb(ox, oz, dx, dz, o.b.minx, o.b.minz, o.b.maxx, o.b.maxz);
    if (o.kind === 'circle') return rayCircle(ox, oz, dx, dz, o.x, o.z, o.r);
    return rayObb(ox, oz, dx, dz, o.x, o.z, o._cos, o._sin, o.hl, o.hw);
  }

  scan() {
    const { app } = this;
    const e = app.ego;
    const fx = app.weather.fx;
    const rng = app.rng;
    const R = this.ranges();
    const cands = this.candidates(Math.max(R.lidar, R.kamera) + 2);
    // cos/sin arah disimpan dengan nama khusus (jangan menimpa properti s milik rintangan)
    for (const o of cands) {
      if (o.kind === 'obb') {
        o._cos = Math.cos(o.h);
        o._sin = Math.sin(o.h);
      }
    }
    this.seen.clear();
    const pos = this.pos;
    const colr = this.col;
    let n = 0;
    const h0 = EGO.lidarH;
    const ox = e.x;
    const oz = e.z;
    this.phase = (this.phase + 3) % RAY_EVERY;
    let rayN = 0;
    const rpos = this.rayPos;
    const hits = this.hits;
    for (let a = 0; a < AZ; a++) {
      const ang = e.h + (a / AZ) * Math.PI * 2;
      const dx = Math.cos(ang);
      const dz = Math.sin(ang);
      let nh = 0;
      for (const o of cands) {
        const t = this.hitT(o, ox, oz, dx, dz);
        if (t < R.lidar && t > 0.3) {
          if (nh >= hits.length) break;
          const hh = hits[nh++];
          hh.t = t;
          hh.o = o;
        }
      }
      // urutkan hit dari yang terdekat (sisipan, jumlahnya kecil)
      for (let i = 1; i < nh; i++) {
        const cur = hits[i];
        let j = i - 1;
        while (j >= 0 && hits[j].t > cur.t) {
          hits[j + 1] = hits[j];
          j--;
        }
        hits[j + 1] = cur;
      }
      let rayDone = a % RAY_EVERY !== this.phase;
      for (let c = 0; c < CHANNELS.length; c++) {
        const tanE = CHANNELS[c];
        const tg = tanE < 0 ? h0 / -tanE : Infinity;
        let px = 0;
        let py = 0;
        let pz = 0;
        let kind = 0;
        for (let i = 0; i < nh; i++) {
          const hh = hits[i];
          if (hh.t > tg) break;
          const y = h0 + hh.t * tanE;
          if (y >= 0.05 && y <= hh.o.height) {
            px = ox + dx * hh.t;
            pz = oz + dz * hh.t;
            py = y;
            kind = hh.o.isStatic ? 2 : 1;
            if (hh.o.id) {
              const s = this.seen.get(hh.o.id);
              if (s) s.pts++;
              else this.seen.set(hh.o.id, { pts: 1, cam: false, o: hh.o });
            }
            break;
          }
        }
        if (!kind && tg <= R.lidar) {
          px = ox + dx * tg;
          pz = oz + dz * tg;
          py = 0.03;
          kind = 3;
        }
        if (!kind) continue;
        if (fx.dropout && rng() < fx.dropout) continue;
        pos[n * 3] = px;
        pos[n * 3 + 1] = py;
        pos[n * 3 + 2] = pz;
        const k = kind === 1 ? 1 : kind === 2 ? 0.75 : 0.45;
        colr[n * 3] = 0.13 * k;
        colr[n * 3 + 1] = 0.83 * k;
        colr[n * 3 + 2] = 0.93 * k;
        n++;
        if (!rayDone && kind !== 3 && rayN < 64) {
          rpos.set([ox, h0, oz, px, py, pz], rayN * 6);
          rayN++;
          rayDone = true;
        } else if (!rayDone && c === 3) {
          rpos.set([ox, h0, oz, px, py, pz], rayN * 6);
          rayN++;
          rayDone = true;
        }
      }
      if (fx.clutter && rng() < fx.clutter * 6) {
        // pantulan palsu dari butiran hujan atau kabut, tidak terlalu dekat dengan kamera kokpit
        const r = 4 + rng() * 8;
        pos[n * 3] = ox + dx * r;
        pos[n * 3 + 1] = 0.3 + rng() * 0.9;
        pos[n * 3 + 2] = oz + dz * r;
        colr[n * 3] = 0.5;
        colr[n * 3 + 1] = 0.75;
        colr[n * 3 + 2] = 0.85;
        n++;
      }
    }
    this.pointCount = n;
    this.rayCount = rayN;
    this.scanCount++;
    this.dirty = true;

    // Kamera: objek di dalam bidang pandang 90 derajat, dalam jangkauan, dan tidak terhalang.
    const camX = e.x + Math.cos(e.h) * 0.9;
    const camZ = e.z + Math.sin(e.h) * 0.9;
    for (const o of app.objects) {
      const dx = o.x - camX;
      const dz = o.z - camZ;
      const d = Math.hypot(dx, dz);
      if (d > R.kamera || d < 0.5) continue;
      let rel = Math.atan2(dz, dx) - e.h;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      if (Math.abs(rel) > CAM_FOV / 2) continue;
      const ux = dx / d;
      const uz = dz / d;
      let firstT = Infinity;
      let first = null;
      for (const c of cands) {
        if (c.height < 1.0 && c !== o) continue; // benda rendah tidak menutupi pandangan
        const t = this.hitT(c, camX, camZ, ux, uz);
        if (t < firstT) {
          firstT = t;
          first = c;
        }
      }
      if (first === o) {
        const s = this.seen.get(o.id);
        if (s) s.cam = true;
        else this.seen.set(o.id, { pts: 0, cam: true, o });
      }
    }
  }

  buildVisuals() {
    const { app } = this;
    const res = app.res;
    this.pos = new Float32Array(MAX_POINTS * 3);
    this.col = new Float32Array(MAX_POINTS * 3);
    const g = res.add(new THREE.BufferGeometry());
    this.posAttr = new THREE.BufferAttribute(this.pos, 3);
    this.colAttr = new THREE.BufferAttribute(this.col, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.colAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('color', this.colAttr);
    g.setDrawRange(0, 0);
    // Ukuran titik mengecil sesuai jarak, tetapi dibatasi di layar (1,5 sampai 7 piksel CSS) dan
    // digambar bulat, supaya titik yang sangat dekat dengan kamera tidak menjadi kotak besar.
    this.pointPx = { value: 1 };
    const pmat = new THREE.PointsMaterial({ size: 0.26, vertexColors: true, sizeAttenuation: true, transparent: true, opacity: 0.95, depthWrite: false });
    pmat.onBeforeCompile = (shader) => {
      shader.uniforms.uPx = this.pointPx;
      shader.vertexShader = `uniform float uPx;\n${shader.vertexShader}`.replace('#include <fog_vertex>', '#include <fog_vertex>\n\tgl_PointSize = clamp(gl_PointSize, 1.5 * uPx, 7.0 * uPx);');
      shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n\tif (length(gl_PointCoord - vec2(0.5)) > 0.5) discard;');
    };
    this.points = new THREE.Points(g, res.add(pmat));
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    app.scene.add(this.points);

    this.rayPos = new Float32Array(64 * 6);
    const rg = res.add(new THREE.BufferGeometry());
    this.rayAttr = new THREE.BufferAttribute(this.rayPos, 3);
    this.rayAttr.setUsage(THREE.DynamicDrawUsage);
    rg.setAttribute('position', this.rayAttr);
    rg.setDrawRange(0, 0);
    this.rays = new THREE.LineSegments(rg, res.add(new THREE.LineBasicMaterial({ color: '#22d3ee', transparent: true, opacity: 0.4, depthWrite: false })));
    this.rays.frustumCulled = false;
    this.rays.renderOrder = 6;
    app.scene.add(this.rays);

    // Cincin jangkauan deteksi (skala = jangkauan LiDAR)
    const ringGeo = res.add(new THREE.RingGeometry(0.97, 1, 128));
    ringGeo.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(ringGeo, res.add(new THREE.MeshBasicMaterial({ color: '#22d3ee', transparent: true, opacity: 0.6, depthWrite: false, fog: false })));
    this.ring.renderOrder = 5;
    app.scene.add(this.ring);

    // Bidang pandang kamera 90 derajat (ungu), skala = jangkauan kamera
    const fovGeo = res.add(new THREE.CircleGeometry(1, 32, -CAM_FOV / 2, CAM_FOV));
    fovGeo.rotateX(-Math.PI / 2);
    this.fov = new THREE.Mesh(fovGeo, res.add(new THREE.MeshBasicMaterial({ color: '#a78bfa', transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, fog: false })));
    this.fov.renderOrder = 5;
    const edgePts = [];
    edgePts.push(0, 0, 0, Math.cos(-CAM_FOV / 2), 0, -Math.sin(-CAM_FOV / 2));
    edgePts.push(0, 0, 0, Math.cos(CAM_FOV / 2), 0, -Math.sin(CAM_FOV / 2));
    for (let i = 0; i < 24; i++) {
      const a0 = -CAM_FOV / 2 + (CAM_FOV * i) / 24;
      const a1 = -CAM_FOV / 2 + (CAM_FOV * (i + 1)) / 24;
      edgePts.push(Math.cos(a0), 0, -Math.sin(a0), Math.cos(a1), 0, -Math.sin(a1));
    }
    const eg = res.add(new THREE.BufferGeometry());
    eg.setAttribute('position', new THREE.Float32BufferAttribute(edgePts, 3));
    this.fovEdge = new THREE.LineSegments(eg, res.add(new THREE.LineBasicMaterial({ color: '#a78bfa', transparent: true, opacity: 0.8, depthWrite: false, fog: false })));
    this.fovEdge.renderOrder = 5;
    this.fovGroup = new THREE.Group();
    this.fovGroup.add(this.fov, this.fovEdge);
    app.scene.add(this.fovGroup);
  }

  /** Batas ukuran titik LiDAR mengikuti rasio piksel kanvas. */
  setPixelRatio(pr) {
    this.pointPx.value = pr || 1;
  }

  sync() {
    const { app } = this;
    const e = app.ego;
    const R = this.ranges();
    this.points.visible = this.showLidar;
    this.rays.visible = this.showLidar;
    this.ring.visible = this.showLidar;
    if (this.dirty) {
      this.dirty = false;
      this.points.geometry.setDrawRange(0, this.pointCount);
      this.posAttr.needsUpdate = true;
      this.colAttr.needsUpdate = true;
      this.rays.geometry.setDrawRange(0, this.rayCount * 2);
      this.rayAttr.needsUpdate = true;
    }
    // Dari atas, cincin digambar di atas atap bangunan supaya batas jangkauan terbaca utuh seperti peta.
    const onTop = app.cameras.mode === 'atas';
    if (this.ring.material.depthTest === onTop) this.ring.material.depthTest = !onTop;
    this.ring.position.set(e.x, 0.06, e.z);
    this.ring.scale.set(R.lidar, 1, R.lidar);
    this.fovGroup.visible = this.showFov;
    this.fovGroup.position.set(e.x + Math.cos(e.h) * 0.9, 0.07, e.z + Math.sin(e.h) * 0.9);
    this.fovGroup.rotation.y = -e.h;
    this.fovGroup.scale.set(R.kamera, 1, R.kamera);
  }
}
