// Cuaca otomatis: Cerah, Hujan, Kabut, Malam, lalu kembali ke Cerah. Cuaca berganti sendiri tiap
// 5 menit waktu simulasi (waktu jeda tidak dihitung, percepatan waktu membuatnya lebih cepat).
// Tidak ada tombol cuaca di layar. Peralihan tampilan memudar sekitar 15 detik.
// Cuaca memengaruhi gesekan jalan (jarak pengereman di perisai keselamatan), kecepatan NPC,
// dan jangkauan sensor (dipakai tahap sensor).
import * as THREE from '../vendor/three.bundle.min.js';

export const WEATHER_ORDER = ['cerah', 'hujan', 'kabut', 'malam'];
export const WEATHER_LABEL = { cerah: 'Cerah', hujan: 'Hujan', kabut: 'Kabut', malam: 'Malam' };
const WEATHER_PERIOD = 300; // detik waktu simulasi
const FADE = 15;

// Pengali jangkauan sensor, sama dengan pelajaran Sensor (js/engine/sensors.js) bila tersedia.
const FALLBACK_EFFECTS = {
  kamera: { cerah: { range: 1 }, hujan: { range: 0.65 }, kabut: { range: 0.3 }, malam: { range: 0.45 } },
  lidar: { cerah: { range: 1 }, hujan: { range: 0.8 }, kabut: { range: 0.45 }, malam: { range: 1 } },
};

const LOOK = {
  cerah: { top: '#8cc4ee', hor: '#e2eef5', fog: '#dde9ef', near: 280, far: 1300, hemi: 1.9, hemiSky: '#eef6ff', hemiGround: '#bba98a', sun: 2.3, sunCol: '#fff0d6', road: '#80868f', rough: 0.92, metal: 0, win: 0, pools: 0, lampHead: '#c9ced4', ground: '#dadcc2', mu: 0.8, lights: 0, rain: 0 },
  hujan: { top: '#71808f', hor: '#aeb9c2', fog: '#a7b3bd', near: 40, far: 420, hemi: 1.25, hemiSky: '#dfe6ee', hemiGround: '#8e8a7c', sun: 0.55, sunCol: '#dbe4ee', road: '#5c6169', rough: 0.3, metal: 0.12, win: 0.3, pools: 0.12, lampHead: '#fde8b8', ground: '#c3c8b1', mu: 0.5, lights: 1, rain: 1 },
  kabut: { top: '#c4cbd1', hor: '#e1e5e8', fog: '#d6dce0', near: 6, far: 125, hemi: 1.65, hemiSky: '#f2f5f7', hemiGround: '#a7a494', sun: 0.45, sunCol: '#f0f3f6', road: '#7b8189', rough: 0.8, metal: 0, win: 0.15, pools: 0.08, lampHead: '#fde8b8', ground: '#d2d5c3', mu: 0.72, lights: 1, rain: 0 },
  malam: { top: '#0c162b', hor: '#22324f', fog: '#18253d', near: 90, far: 650, hemi: 0.42, hemiSky: '#5a70a0', hemiGround: '#23262c', sun: 0.32, sunCol: '#a9bdff', road: '#4f545d', rough: 0.85, metal: 0, win: 1.0, pools: 0.55, lampHead: '#fff2c4', ground: '#59624f', mu: 0.8, lights: 1, rain: 0 },
};

const NUM_KEYS = ['near', 'far', 'hemi', 'sun', 'rough', 'metal', 'win', 'pools', 'lights', 'rain'];
const COL_KEYS = ['top', 'hor', 'fog', 'hemiSky', 'hemiGround', 'sunCol', 'road', 'lampHead', 'ground'];

export class Weather {
  constructor(app, effects) {
    this.app = app;
    this.effects = effects || FALLBACK_EFFECTS;
    this.name = 'cerah';
    this.prev = 'cerah';
    this.fadeT = FADE;
    this.elapsed = 0;
    this.changes = 0;
    this.cur = {};
    for (const k of COL_KEYS) this.cur[k] = new THREE.Color(LOOK.cerah[k]);
    for (const k of NUM_KEYS) this.cur[k] = LOOK.cerah[k];
    this.tmpA = new THREE.Color();
    this.build();
    this.apply(true);
  }

  get mu() {
    // selama peralihan dipakai gesekan terkecil (paling aman)
    if (this.fadeT < FADE) return Math.min(LOOK[this.prev].mu, LOOK[this.name].mu);
    return LOOK[this.name].mu;
  }

  get night() {
    return this.name === 'malam';
  }

  get lightsOn() {
    return this.cur.lights > 0.5;
  }

  get countdown() {
    return Math.max(0, WEATHER_PERIOD - this.elapsed);
  }

  get nextName() {
    return WEATHER_ORDER[(WEATHER_ORDER.indexOf(this.name) + 1) % WEATHER_ORDER.length];
  }

  /** Pengali jangkauan sensor untuk cuaca sekarang. */
  sensorRange() {
    const lid = this.effects.lidar[this.name] || { range: 1 };
    const cam = this.effects.kamera[this.name] || { range: 1 };
    return { lidar: lid.range, kamera: cam.range };
  }

  build() {
    const { app } = this;
    const res = app.res;
    const scene = app.scene;
    scene.fog = new THREE.Fog('#dde9ef', 280, 1300);
    const skyGeo = res.add(new THREE.SphereGeometry(1500, 24, 14));
    const n = skyGeo.attributes.position.count;
    skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
    this.skyGeo = skyGeo;
    this.sky = new THREE.Mesh(skyGeo, res.add(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })));
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    scene.add(this.sky);
    this.hemi = new THREE.HemisphereLight('#eef6ff', '#bba98a', 1.9);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff0d6', 2.3);
    this.sun.position.set(90, 160, 60);
    this.sun.castShadow = false;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -90;
    sc.right = 90;
    sc.top = 90;
    sc.bottom = -90;
    sc.near = 10;
    sc.far = 450;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.02;
    scene.add(this.sun, this.sun.target);
    // hujan: garis pendek di sekitar kamera
    const N = 1400;
    this.rainN = N;
    this.rainSeed = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      this.rainSeed[i * 3] = app.rng() * 80 - 40;
      this.rainSeed[i * 3 + 1] = app.rng() * 30;
      this.rainSeed[i * 3 + 2] = app.rng() * 80 - 40;
    }
    const g = res.add(new THREE.BufferGeometry());
    this.rainAttr = new THREE.BufferAttribute(new Float32Array(N * 6), 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.rainAttr);
    this.rainMat = res.add(new THREE.LineBasicMaterial({ color: '#c3d0dd', transparent: true, opacity: 0, depthWrite: false }));
    this.rain = new THREE.LineSegments(g, this.rainMat);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.rainT = 0;
    scene.add(this.rain);
  }

  /** Langkah waktu simulasi: hitung mundur pergantian cuaca dan peralihan. */
  step(dt) {
    this.elapsed += dt;
    if (this.elapsed >= WEATHER_PERIOD) this.change(this.nextName);
    if (this.fadeT < FADE) this.fadeT = Math.min(FADE, this.fadeT + dt);
  }

  change(name, instant = false) {
    if (!LOOK[name]) return;
    this.prev = instant ? name : this.name;
    this.name = name;
    this.elapsed = 0;
    this.fadeT = instant ? FADE : 0;
    this.changes++;
    if (instant) this.apply(true);
    if (this.app.onWeatherChange) this.app.onWeatherChange(name);
  }

  skip() {
    this.change(this.nextName, true);
  }

  /** Terapkan tampilan (dipanggil tiap bingkai). Campuran cuaca lama dan baru selama peralihan. */
  apply(force = false) {
    const A = LOOK[this.prev];
    const B = LOOK[this.name];
    let t = Math.min(1, this.fadeT / FADE);
    t = t * t * (3 - 2 * t);
    if (!force && t >= 1 && this.applied === this.name) return;
    this.applied = t >= 1 ? this.name : null;
    const c = this.cur;
    for (const k of NUM_KEYS) c[k] = A[k] + (B[k] - A[k]) * t;
    for (const k of COL_KEYS) c[k].set(A[k]).lerp(this.tmpA.set(B[k]), t);
    const { app } = this;
    const scene = app.scene;
    scene.fog.color.copy(c.fog);
    this.fogNear = c.near;
    this.fogFar = c.far;
    scene.background = scene.background || new THREE.Color();
    scene.background.copy(c.fog);
    const pos = this.skyGeo.attributes.position;
    const colr = this.skyGeo.attributes.color;
    const cc = this.tmpB || (this.tmpB = new THREE.Color());
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 1500;
      const tt = Math.max(0, Math.min(1, y * 2.4));
      cc.copy(c.hor).lerp(c.top, tt);
      colr.setXYZ(i, cc.r, cc.g, cc.b);
    }
    colr.needsUpdate = true;
    this.hemi.intensity = c.hemi;
    this.hemi.color.copy(c.hemiSky);
    this.hemi.groundColor.copy(c.hemiGround);
    this.sun.intensity = c.sun;
    this.sun.color.copy(c.sunCol);
    const w = app.world.mats;
    w.road.color.copy(c.road);
    w.road.roughness = c.rough;
    w.road.metalness = c.metal;
    w.windows.emissiveIntensity = c.win;
    w.lampHead.color.copy(c.lampHead);
    w.lampPool.opacity = c.pools;
    w.ground.color.copy(c.ground);
    app.world.pools.visible = c.pools > 0.01 && !app.lite;
    this.rainMat.opacity = 0.5 * c.rain;
    this.rain.visible = c.rain > 0.02;
  }

  /** Kabut diukur dari fokus (shuttle). Bila kamera jauh (Peta atau Drone jauh), batas kabut digeser. */
  fitFog(camPos, fx, fz) {
    const fog = this.app.scene.fog;
    const d = Math.hypot(camPos.x - fx, camPos.y, camPos.z - fz);
    const extra = Math.max(0, d - 14);
    fog.near = this.fogNear + extra;
    fog.far = this.fogFar + extra;
  }

  update(dtReal, simDt, camPos) {
    this.apply();
    this.sky.position.copy(camPos);
    if (!this.rain.visible) return;
    this.rainT += simDt;
    const pos = this.rainAttr.array;
    const seed = this.rainSeed;
    const fall = 20;
    const n = this.app.lite ? this.rainN / 2 : this.rainN;
    for (let i = 0; i < n; i++) {
      let y = seed[i * 3 + 1] - ((this.rainT * fall) % 30);
      if (y < 0) y += 30;
      const x = camPos.x + seed[i * 3];
      const z = camPos.z + seed[i * 3 + 2];
      const o = i * 6;
      pos[o] = x;
      pos[o + 1] = y;
      pos[o + 2] = z;
      pos[o + 3] = x + 0.1;
      pos[o + 4] = y + 0.8;
      pos[o + 5] = z + 0.04;
    }
    this.rain.geometry.setDrawRange(0, n * 2);
    this.rainAttr.needsUpdate = true;
  }

  follow(x, z) {
    this.sun.position.set(x + 80, 170, z + 50);
    this.sun.target.position.set(x, 0, z);
  }
}
