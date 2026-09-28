// Cuaca dan pencahayaan: Cerah, Hujan, Kabut, Malam.
// Pengali jangkauan sensor sama dengan pelajaran Sensor (WEATHER_EFFECTS di js/engine/sensors.js).
import * as THREE from '../vendor/three.bundle.min.js';
import { fmt } from './util.js';

// Nilai cadangan bila modul engine belum bisa dimuat. Angkanya sama dengan engine.
const FALLBACK_EFFECTS = {
  kamera: {
    cerah: { range: 1, litRange: 1 },
    hujan: { range: 0.65, litRange: 0.85 },
    kabut: { range: 0.3, litRange: 0.55 },
    malam: { range: 0.45, litRange: 1 },
  },
  lidar: {
    cerah: { range: 1, dropout: 0, clutter: 0 },
    hujan: { range: 0.8, dropout: 0.12, clutter: 0.015 },
    kabut: { range: 0.45, dropout: 0.3, clutter: 0.04 },
    malam: { range: 1, dropout: 0, clutter: 0 },
  },
};

const LOOK = {
  cerah: { sky: ['#6fa3d8', '#b9d5ee'], fog: '#b3cde6', near: 220, far: 820, hemi: 1.55, sun: 2.6, sunCol: '#fff3dc', road: '#3a414f', rough: 0.92, win: 0, pools: 0, head: '#9aa3ae', light: 0, mu: 0.9, npc: 1, capKmh: null },
  hujan: { sky: ['#3f4b59', '#6b7886'], fog: '#657280', near: 25, far: 250, hemi: 1.0, sun: 0.7, sunCol: '#dbe4ee', road: '#20252c', rough: 0.34, win: 0.35, pools: 0.12, head: '#fde7b0', light: 12, mu: 0.6, npc: 0.85, capKmh: 40 },
  kabut: { sky: ['#9aa5b0', '#b8c1c9'], fog: '#b3bcc5', near: 3, far: 95, hemi: 1.35, sun: 0.55, sunCol: '#eef2f6', road: '#3a414f', rough: 0.85, win: 0.12, pools: 0.05, head: '#fde7b0', light: 6, mu: 0.85, npc: 0.7, capKmh: 30 },
  malam: { sky: ['#03060d', '#0d1628'], fog: '#0a1120', near: 70, far: 460, hemi: 0.22, sun: 0.4, sunCol: '#9db4ff', road: '#2f3542', rough: 0.8, win: 1.0, pools: 0.5, head: '#fff3c4', light: 60, mu: 0.9, npc: 0.92, capKmh: 45 },
};
export const WEATHER_LABEL = { cerah: 'Cerah', hujan: 'Hujan', kabut: 'Kabut', malam: 'Malam' };

export class Weather {
  constructor(app, effects) {
    this.app = app;
    this.effects = effects || FALLBACK_EFFECTS;
    this.name = 'cerah';
    this.fx = {};
    this.build();
    this.set('cerah');
  }

  get night() {
    return this.name === 'malam';
  }

  build() {
    const { app } = this;
    const res = app.res;
    const scene = app.scene;
    scene.fog = new THREE.Fog('#b3cde6', 200, 800);
    // Kubah langit dengan gradasi warna per titik
    const skyGeo = res.add(new THREE.SphereGeometry(950, 24, 14));
    const n = skyGeo.attributes.position.count;
    skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
    this.skyGeo = skyGeo;
    this.sky = new THREE.Mesh(skyGeo, res.add(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })));
    this.sky.renderOrder = -10;
    scene.add(this.sky);

    this.hemi = new THREE.HemisphereLight('#dbeafe', '#3b4a3c', 1.5);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff3dc', 2.4);
    this.sun.position.set(80, 140, 60);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -80;
    sc.right = 80;
    sc.top = 80;
    sc.bottom = -80;
    sc.near = 10;
    sc.far = 400;
    this.sun.shadow.bias = -0.0006;
    scene.add(this.sun, this.sun.target);

    // Hujan: garis-garis pendek di sekitar kamera
    const N = 1600;
    this.rainN = N;
    const pos = new Float32Array(N * 6);
    const rng = app.rng;
    this.rainSeed = [];
    for (let i = 0; i < N; i++) this.rainSeed.push([rng() * 90 - 45, rng() * 32, rng() * 90 - 45]);
    const g = res.add(new THREE.BufferGeometry());
    this.rainAttr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.rainAttr);
    this.rain = new THREE.LineSegments(g, res.add(new THREE.LineBasicMaterial({ color: '#b8c7d9', transparent: true, opacity: 0.55, depthWrite: false })));
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.rainT = 0;
    scene.add(this.rain);
  }

  set(name) {
    if (!LOOK[name]) return;
    this.name = name;
    const L = LOOK[name];
    const { app } = this;
    const lid = this.effects.lidar[name] || this.effects.lidar.cerah;
    const cam = this.effects.kamera[name] || this.effects.kamera.cerah;
    const mu = L.mu;
    this.fx = {
      name,
      label: WEATHER_LABEL[name],
      lidarRange: lid.range,
      camRange: cam.range,
      camLitRange: cam.litRange,
      dropout: lid.dropout || 0,
      clutter: lid.clutter || 0,
      mu,
      brakeMax: mu * 9.81 * 0.92,
      npcSpeed: L.npc,
      speedCap: L.capKmh ? L.capKmh / 3.6 : Infinity,
      capKmh: L.capKmh,
    };
    // tampilan
    const scene = app.scene;
    scene.fog.color.set(L.fog);
    scene.fog.near = L.near;
    scene.fog.far = L.far;
    this.fogNear = L.near;
    this.fogFar = L.far;
    scene.background = new THREE.Color(L.fog);
    const top = new THREE.Color(L.sky[0]);
    const hor = new THREE.Color(L.sky[1]);
    const pos = this.skyGeo.attributes.position;
    const colr = this.skyGeo.attributes.color;
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 950;
      const t = Math.max(0, Math.min(1, y * 2.2));
      c.copy(hor).lerp(top, t);
      colr.setXYZ(i, c.r, c.g, c.b);
    }
    colr.needsUpdate = true;
    this.hemi.intensity = L.hemi;
    this.hemi.color.set(name === 'malam' ? '#2b3a5c' : '#dbeafe');
    this.hemi.groundColor.set(name === 'malam' ? '#0b1020' : '#3b4a3c');
    this.sun.intensity = L.sun;
    this.sun.color.set(L.sunCol);
    const w = app.world.mats;
    w.road.color.set(L.road);
    w.road.roughness = L.rough;
    w.road.metalness = name === 'hujan' ? 0.15 : 0;
    w.windows.emissiveIntensity = L.win;
    w.lampHead.color.set(L.head);
    w.lampPool.opacity = L.pools;
    this.pools = L.pools;
    app.world.pools.visible = L.pools > 0 && !this.lite;
    w.ground.color.set(name === 'malam' ? '#1b2c24' : '#2a4636');
    app.ego.headlight.intensity = L.light;
    this.rain.visible = name === 'hujan';
  }

  /** Alasan batas kecepatan cuaca dalam kalimat sederhana. */
  capReason() {
    const fx = this.fx;
    const lid = fmt(60 * fx.lidarRange, 0);
    const cam = fmt(60 * fx.camRange, 0);
    if (this.name === 'hujan') return `Hujan: jangkauan LiDAR turun ke ${lid} m dan jalan licin, jadi kecepatan dibatasi ${fx.capKmh} km/jam.`;
    if (this.name === 'kabut') return `Kabut: jangkauan LiDAR tinggal ${lid} m, jadi kecepatan dibatasi ${fx.capKmh} km/jam supaya mobil bisa berhenti dalam jarak yang terlihat.`;
    if (this.name === 'malam') return `Malam: kamera hanya melihat jelas sampai ${cam} m. LiDAR tetap ${lid} m karena memancarkan cahaya sendiri, jadi mobil cukup melambat ke ${fx.capKmh} km/jam.`;
    return '';
  }

  /**
   * Batas kabut diukur dari mobil otonom. Bila kamera jauh (Atas atau Orbit yang jauh), batas
   * kabut digeser sejauh jarak kamera ke mobil, jadi mobil dan sekitarnya tetap terlihat.
   * Jangkauan sensor tetap diperlihatkan oleh cincin dan titik LiDAR.
   */
  fitFog(camPos, ex, ez) {
    const fog = this.app.scene.fog;
    if (!fog) return;
    const d = Math.hypot(camPos.x - ex, camPos.y, camPos.z - ez);
    const extra = Math.max(0, d - 14);
    fog.near = this.fogNear + extra;
    fog.far = this.fogFar + extra;
  }

  /** Mode Hemat: hujan lebih sedikit, tanpa genangan cahaya lampu jalan, langit lebih kecil. */
  setLite(lite) {
    this.lite = !!lite;
    this.rain.geometry.setDrawRange(0, (this.lite ? this.rainN / 2 : this.rainN) * 2);
    this.app.world.pools.visible = (this.pools || 0) > 0 && !this.lite;
    this.sky.scale.setScalar(this.lite ? 0.65 : 1);
  }

  update(dt, camPos) {
    if (!this.rain.visible) return;
    this.rainT += dt;
    const pos = this.rainAttr.array;
    const fall = 22;
    for (let i = 0; i < this.rainN; i++) {
      const s = this.rainSeed[i];
      let y = s[1] - ((this.rainT * fall) % 32);
      if (y < 0) y += 32;
      const x = camPos.x + s[0];
      const z = camPos.z + s[2];
      const o = i * 6;
      pos[o] = x;
      pos[o + 1] = y;
      pos[o + 2] = z;
      pos[o + 3] = x + 0.12;
      pos[o + 4] = y + 0.9;
      pos[o + 5] = z + 0.05;
    }
    this.rainAttr.needsUpdate = true;
  }

  /** Matahari (dan bayangannya) mengikuti mobil supaya peta bayangan tetap tajam di sekitarnya. */
  follow(x, z) {
    this.sun.position.set(x + 70, 150, z + 45);
    this.sun.target.position.set(x, 0, z);
  }
}
