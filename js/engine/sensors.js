// Model sensor kendaraan otonom: kamera, LiDAR, radar, dan ultrasonik, lengkap dengan efek cuaca.
//
// Model ini penyederhanaan 2D (tampak atas) yang jujur secara kualitatif:
//   kamera      : sudut pandang lebar, satu-satunya yang mengenali jenis objek, warna lampu,
//                 dan tulisan rambu. Jarak hanya perkiraan (makin jauh makin meleset).
//                 Lemah di malam hari (kecuali objek yang bercahaya sendiri) dan di kabut.
//   LiDAR       : 360 derajat, memancarkan laser sendiri, jarak sangat presisi, hasilnya
//                 berupa awan titik. Jangkauan turun dan banyak titik hilang di kabut dan hujan.
//   radar       : kerucut sempit ke depan, jangkauan jauh, mengukur kecepatan relatif secara
//                 langsung (efek Doppler). Hampir tidak terganggu hujan, kabut, atau gelap.
//                 Resolusi sudut rendah dan tidak mengenali jenis objek.
//   ultrasonik  : jarak sangat dekat (sekitar 5 m) di bemper, untuk parkir.
//
// Setiap deteksi menyimpan `targetId` dan `target` (objek aslinya). Keduanya adalah
// "kunci jawaban" untuk tampilan pelajaran, bukan sesuatu yang benar-benar diketahui sensor.

import { castRay, lineOfSight, rayShape, boundingRadius } from './geometry.js';
import { Rng, wrapAngle, degToRad, angleDiff, TAU, clamp } from './math.js';
import { COLORS } from './theme.js';

export const WEATHER = Object.freeze({
  cerah: { id: 'cerah', label: 'Cerah' },
  hujan: { id: 'hujan', label: 'Hujan' },
  kabut: { id: 'kabut', label: 'Kabut' },
  malam: { id: 'malam', label: 'Malam' },
});
export const WEATHER_IDS = Object.freeze(['cerah', 'hujan', 'kabut', 'malam']);

/**
 * Pengaruh cuaca per jenis sensor.
 *   range    pengali jangkauan
 *   litRange pengali jangkauan kamera untuk objek bercahaya sendiri (lampu lalu lintas)
 *   noise    pengali derau pengukuran
 *   dropout  peluang satu pantulan LiDAR hilang
 *   clutter  peluang satu sinar LiDAR memantul dari butiran air (titik palsu dekat)
 *   confidence pengali keyakinan kamera saat mengenali objek
 */
export const WEATHER_EFFECTS = Object.freeze({
  kamera: {
    cerah: { range: 1, litRange: 1, noise: 1, confidence: 1 },
    hujan: { range: 0.65, litRange: 0.85, noise: 1.5, confidence: 0.8 },
    kabut: { range: 0.3, litRange: 0.55, noise: 2, confidence: 0.55 },
    malam: { range: 0.45, litRange: 1, noise: 1.6, confidence: 0.65 },
  },
  lidar: {
    cerah: { range: 1, dropout: 0, clutter: 0, noise: 1 },
    hujan: { range: 0.8, dropout: 0.12, clutter: 0.015, noise: 1.5 },
    kabut: { range: 0.45, dropout: 0.3, clutter: 0.04, noise: 2 },
    malam: { range: 1, dropout: 0, clutter: 0, noise: 1 },
  },
  radar: {
    cerah: { range: 1, noise: 1 },
    hujan: { range: 0.92, noise: 1.2 },
    kabut: { range: 0.97, noise: 1.05 },
    malam: { range: 1, noise: 1 },
  },
  ultrasonik: {
    cerah: { range: 1, noise: 1 },
    hujan: { range: 0.95, noise: 1.4 },
    kabut: { range: 1, noise: 1 },
    malam: { range: 1, noise: 1 },
  },
});

const EFFECT_DEFAULTS = { range: 1, litRange: 1, noise: 1, dropout: 0, clutter: 0, confidence: 1 };

/** Efek cuaca untuk satu jenis sensor, sudah dilengkapi nilai bawaan. */
export function weatherEffect(type, weather = 'cerah') {
  const table = WEATHER_EFFECTS[type] || {};
  return { ...EFFECT_DEFAULTS, ...(table[weather] || table.cerah || {}) };
}

/**
 * Seberapa kuat pantulan radar dari tiap jenis objek, dipakai sebagai pengali jangkauan radar.
 * Logam besar memantul kuat, manusia lebih lemah, kardus hampir tembus gelombang radar.
 */
export const RADAR_REFLECTIVITY = Object.freeze({
  car: 1,
  bus: 1,
  truck: 1,
  shuttle: 1,
  wall: 1,
  building: 1,
  trafficLight: 0.6,
  sign: 0.6,
  pole: 0.6,
  cyclist: 0.6,
  pedestrian: 0.5,
  tree: 0.4,
  cone: 0.35,
  cardboard: 0.2,
});

/** Nilai bawaan tiap jenis sensor. Jangkauan dipendekkan agar muat di layar simulasi. */
export const SENSOR_DEFAULTS = Object.freeze({
  kamera: { type: 'kamera', label: 'Kamera', color: COLORS.kamera, fov: degToRad(90), range: 65, rate: 30, rangeNoise: 0.06, bearingNoise: degToRad(0.2) },
  lidar: { type: 'lidar', label: 'LiDAR', color: COLORS.lidar, fov: TAU, range: 45, rate: 10, rays: 720, rangeNoise: 0.02, minPoints: 1 },
  radar: {
    type: 'radar',
    label: 'Radar',
    color: COLORS.radar,
    fov: degToRad(24),
    range: 90,
    rate: 20,
    rangeNoise: 0.2,
    bearingNoise: degToRad(1.2),
    speedNoise: 0.1,
    resolution: degToRad(4),
    ghostRate: 0,
  },
  ultrasonik: { type: 'ultrasonik', label: 'Ultrasonik', color: COLORS.ultrasonik, fov: degToRad(60), range: 5, rate: 15, rays: 9, rangeNoise: 0.02, minRange: 0.15 },
});

/**
 * Satu sensor yang terpasang di kendaraan.
 * mount: { forward, left, yaw } relatif terhadap titik tengah kendaraan (m, m, rad).
 */
export class Sensor {
  /**
   * @param {'kamera'|'lidar'|'radar'|'ultrasonik'} type
   * @param {object} [opts] menimpa nilai SENSOR_DEFAULTS, ditambah { id, mount, enabled }
   */
  constructor(type, opts = {}) {
    const base = SENSOR_DEFAULTS[type];
    if (!base) throw new Error(`Jenis sensor tidak dikenal: ${type}`);
    Object.assign(this, base, opts);
    this.type = type;
    this.id = opts.id ?? type;
    this.mount = { forward: 0, left: 0, yaw: 0, ...(opts.mount || {}) };
    this.enabled = opts.enabled ?? true;
  }

  /** Pose sensor di dunia untuk kendaraan tertentu: { x, y, heading }. */
  pose(vehicle) {
    const c = Math.cos(vehicle.heading);
    const s = Math.sin(vehicle.heading);
    const { forward, left, yaw } = this.mount;
    return {
      x: vehicle.x + c * forward + s * left,
      y: vehicle.y + s * forward - c * left,
      heading: wrapAngle(vehicle.heading + yaw),
    };
  }

  /** Jangkauan efektif (m) pada cuaca tertentu, opsional untuk target tertentu. */
  effectiveRange(weather = 'cerah', target = null) {
    const fx = weatherEffect(this.type, weather);
    let r = this.range * fx.range;
    if (target) {
      if (this.type === 'kamera' && target.selfLit) r = this.range * fx.litRange;
      if (this.type === 'radar') r *= RADAR_REFLECTIVITY[target.kind] ?? 0.8;
    }
    return r;
  }

  /**
   * Ambil satu pembacaan.
   * @param {object} vehicle kendaraan pembawa sensor (butuh x, y, heading, dan vx, vy untuk radar)
   * @param {Array} objects objek dunia (kotak, lingkaran, poligon) dengan id, kind, dan vx/vy bila bergerak
   * @param {object} [opts] { weather, rng (Rng), time }
   * @returns {object} { sensorId, type, time, pose, range, detections, points? }
   */
  sense(vehicle, objects, { weather = 'cerah', rng = defaultRng, time = 0 } = {}) {
    const pose = this.pose(vehicle);
    const fx = weatherEffect(this.type, weather);
    const ctx = { vehicle, objects, pose, fx, rng, weather };
    const reading = { sensorId: this.id, type: this.type, time, pose, range: this.range * fx.range, detections: [] };
    switch (this.type) {
      case 'kamera':
        reading.detections = this._camera(ctx);
        break;
      case 'lidar':
        Object.assign(reading, this._lidar(ctx));
        break;
      case 'radar':
        reading.detections = this._radar(ctx);
        break;
      case 'ultrasonik':
        Object.assign(reading, this._ultrasonic(ctx));
        break;
      default:
        break;
    }
    return reading;
  }

  _skip(o, vehicle) {
    return o === vehicle || o.id === vehicle.id || o[this.type] === false || o.sensorIgnore === true;
  }

  /** Titik yang dicoba untuk garis pandang: tengah objek dan dua sisi terluarnya. */
  _visiblePoint(o, pose, objects, vehicle) {
    const dx = o.x - pose.x;
    const dy = o.y - pose.y;
    const d = Math.hypot(dx, dy) || 1e-6;
    const br = Math.min(boundingRadius(o), 3) * 0.8;
    const px = -dy / d;
    const py = dx / d;
    const candidates = [
      { x: o.x, y: o.y },
      { x: o.x + px * br, y: o.y + py * br },
      { x: o.x - px * br, y: o.y - py * br },
    ];
    for (const p of candidates) {
      const rel = angleDiff(Math.atan2(p.y - pose.y, p.x - pose.x), pose.heading);
      if (this.fov < TAU && Math.abs(rel) > this.fov / 2) continue;
      if (lineOfSight(objects, pose.x, pose.y, p.x, p.y, { target: o, ignore: vehicle })) return p;
    }
    return null;
  }

  /** Jarak sebenarnya ke permukaan objek sepanjang garis ke titik p. */
  _surfaceRange(o, pose, p) {
    const dx = p.x - pose.x;
    const dy = p.y - pose.y;
    const d = Math.hypot(dx, dy) || 1e-6;
    const t = rayShape(pose.x, pose.y, dx / d, dy / d, o);
    return Number.isFinite(t) ? t : d;
  }

  _roughlyInView(o, pose, range) {
    const dx = o.x - pose.x;
    const dy = o.y - pose.y;
    const d = Math.hypot(dx, dy);
    const br = boundingRadius(o);
    if (d - br > range) return false;
    if (this.fov >= TAU) return true;
    const rel = Math.abs(angleDiff(Math.atan2(dy, dx), pose.heading));
    return rel <= this.fov / 2 + Math.atan2(br, Math.max(d, 0.1));
  }

  _camera({ vehicle, objects, pose, fx, rng, weather }) {
    const out = [];
    for (const o of objects) {
      if (this._skip(o, vehicle)) continue;
      const range = this.effectiveRange(weather, o);
      if (!this._roughlyInView(o, pose, range)) continue;
      const p = this._visiblePoint(o, pose, objects, vehicle);
      if (!p) continue;
      const trueRange = this._surfaceRange(o, pose, p);
      if (trueRange > range) continue;
      // kamera tunggal menebak jarak dari ukuran objek di gambar: galat membesar dengan jarak
      const sd = trueRange * this.rangeNoise * fx.noise * (1 + trueRange / this.range);
      const measured = Math.max(0.5, trueRange + rng.gaussian(0, sd));
      const bearing = Math.atan2(p.y - pose.y, p.x - pose.x) + rng.gaussian(0, this.bearingNoise * fx.noise);
      const det = {
        sensor: 'kamera',
        sensorId: this.id,
        targetId: o.id,
        target: o,
        kind: o.kind,
        label: o.label || null,
        range: measured,
        trueRange,
        rangeSd: sd,
        bearing,
        x: pose.x + Math.cos(bearing) * measured,
        y: pose.y + Math.sin(bearing) * measured,
        confidence: clamp(1 - (trueRange / Math.max(range, 1)) * 0.6, 0.2, 1) * fx.confidence,
      };
      if (o.kind === 'trafficLight') {
        // warna hanya terbaca bila muka lampu menghadap kamera
        const toCam = Math.atan2(pose.y - o.y, pose.x - o.x);
        det.color = Math.cos(angleDiff(o.heading ?? toCam, toCam)) > 0.25 ? o.state : null;
      }
      if (o.text != null) det.text = o.text;
      out.push(det);
    }
    return out;
  }

  _lidar({ vehicle, objects, pose, fx, rng }) {
    const range = this.range * fx.range;
    const candidates = objects.filter((o) => !this._skip(o, vehicle) && Math.hypot(o.x - pose.x, o.y - pose.y) - boundingRadius(o) <= range);
    const points = [];
    const byTarget = new Map();
    const n = this.rays;
    const full = this.fov >= TAU;
    for (let i = 0; i < n; i++) {
      const a = full ? pose.heading + (i * TAU) / n : pose.heading - this.fov / 2 + (i * this.fov) / Math.max(1, n - 1);
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      const hit = castRay(candidates, pose.x, pose.y, dx, dy, range);
      if (hit) {
        if (fx.dropout > 0 && rng.next() < fx.dropout) continue;
        const r = Math.max(0.05, hit.t + rng.gaussian(0, this.rangeNoise * fx.noise));
        const pt = { x: pose.x + dx * r, y: pose.y + dy * r, range: r, angle: a, targetId: hit.object.id };
        points.push(pt);
        let rec = byTarget.get(hit.object);
        if (!rec) byTarget.set(hit.object, (rec = { n: 0, min: Infinity, sx: 0, sy: 0 }));
        rec.n++;
        rec.min = Math.min(rec.min, r);
        rec.sx += pt.x;
        rec.sy += pt.y;
      } else if (fx.clutter > 0 && rng.next() < fx.clutter) {
        const r = rng.range(0.8, Math.min(range, 7));
        points.push({ x: pose.x + dx * r, y: pose.y + dy * r, range: r, angle: a, targetId: null, clutter: true });
      }
    }
    const detections = [];
    for (const [o, rec] of byTarget) {
      if (rec.n < this.minPoints) continue;
      const cx = rec.sx / rec.n;
      const cy = rec.sy / rec.n;
      detections.push({
        sensor: 'lidar',
        sensorId: this.id,
        targetId: o.id,
        target: o,
        kind: null,
        range: rec.min,
        trueRange: rec.min,
        bearing: Math.atan2(cy - pose.y, cx - pose.x),
        x: cx,
        y: cy,
        points: rec.n,
      });
    }
    return { points, detections };
  }

  _radar({ vehicle, objects, pose, fx, rng, weather }) {
    const raw = [];
    const evx = vehicle.vx ?? Math.cos(vehicle.heading) * (vehicle.speed || 0);
    const evy = vehicle.vy ?? Math.sin(vehicle.heading) * (vehicle.speed || 0);
    for (const o of objects) {
      if (this._skip(o, vehicle)) continue;
      const range = this.effectiveRange(weather, o);
      if (!this._roughlyInView(o, pose, range)) continue;
      const p = this._visiblePoint(o, pose, objects, vehicle);
      if (!p) continue;
      const trueRange = this._surfaceRange(o, pose, p);
      if (trueRange > range) continue;
      const dx = p.x - pose.x;
      const dy = p.y - pose.y;
      const d = Math.hypot(dx, dy) || 1e-6;
      const ux = dx / d;
      const uy = dy / d;
      // efek Doppler: radar mengukur komponen kecepatan relatif SEPANJANG garis pandang
      const trueRel = ((o.vx ?? 0) - evx) * ux + ((o.vy ?? 0) - evy) * uy;
      const measured = Math.max(0.3, trueRange + rng.gaussian(0, this.rangeNoise * fx.noise));
      const bearing = Math.atan2(dy, dx) + rng.gaussian(0, this.bearingNoise * fx.noise);
      raw.push({
        sensor: 'radar',
        sensorId: this.id,
        targetId: o.id,
        target: o,
        kind: null,
        range: measured,
        trueRange,
        bearing,
        x: pose.x + Math.cos(bearing) * measured,
        y: pose.y + Math.sin(bearing) * measured,
        relSpeed: trueRel + rng.gaussian(0, this.speedNoise * fx.noise),
        trueRelSpeed: trueRel,
        strength: RADAR_REFLECTIVITY[o.kind] ?? 0.8,
        merged: 1,
      });
    }
    // resolusi sudut rendah: pantulan yang berdekatan menyatu menjadi satu deteksi
    raw.sort((a, b) => a.range - b.range);
    const out = [];
    for (const det of raw) {
      const twin = out.find((m) => Math.abs(m.range - det.range) < 1.5 && Math.abs(angleDiff(m.bearing, det.bearing)) < this.resolution);
      if (twin) {
        twin.merged++;
        if (det.strength > twin.strength) Object.assign(twin, { ...det, merged: twin.merged });
      } else out.push(det);
    }
    // deteksi hantu (misalnya pantulan dari tutup gorong-gorong), hanya bila ghostRate > 0
    if (this.ghostRate > 0 && rng.next() < this.ghostRate) {
      const r = rng.range(8, this.range * fx.range);
      const b = pose.heading + rng.range(-this.fov / 2, this.fov / 2);
      const u = { x: Math.cos(b), y: Math.sin(b) };
      out.push({
        sensor: 'radar',
        sensorId: this.id,
        targetId: null,
        target: null,
        kind: null,
        ghost: true,
        range: r,
        trueRange: null,
        bearing: b,
        x: pose.x + u.x * r,
        y: pose.y + u.y * r,
        relSpeed: -(evx * u.x + evy * u.y),
        trueRelSpeed: null,
        strength: 0.3,
        merged: 1,
      });
    }
    return out;
  }

  _ultrasonic({ vehicle, objects, pose, fx, rng }) {
    const range = this.range * fx.range;
    const candidates = objects.filter((o) => !this._skip(o, vehicle) && Math.hypot(o.x - pose.x, o.y - pose.y) - boundingRadius(o) <= range);
    let best = null;
    const n = this.rays;
    for (let i = 0; i < n; i++) {
      const a = pose.heading - this.fov / 2 + (i * this.fov) / Math.max(1, n - 1);
      const hit = castRay(candidates, pose.x, pose.y, Math.cos(a), Math.sin(a), range);
      if (hit && (!best || hit.t < best.t)) best = { ...hit, angle: a };
    }
    if (!best) return { detections: [], nearest: null };
    const r = Math.max(this.minRange, best.t + rng.gaussian(0, this.rangeNoise * fx.noise));
    const det = {
      sensor: 'ultrasonik',
      sensorId: this.id,
      targetId: best.object.id,
      target: best.object,
      kind: null,
      range: r,
      trueRange: best.t,
      // ultrasonik hanya tahu jarak, bukan arah pasti: posisi dilaporkan di sumbu sensor
      bearing: pose.heading,
      x: pose.x + Math.cos(pose.heading) * r,
      y: pose.y + Math.sin(pose.heading) * r,
      hitX: best.x,
      hitY: best.y,
    };
    return { detections: [det], nearest: r };
  }
}

const defaultRng = new Rng(20240611);

/**
 * Delapan sensor ultrasonik: empat di bemper depan, empat di bemper belakang.
 * id: us-depan-kiri, us-depan-tengah-kiri, us-depan-tengah-kanan, us-depan-kanan, lalu us-belakang-...
 */
export function ultrasonicArray(vehicle, opts = {}) {
  const L = vehicle.length ?? 4.5;
  const W = vehicle.width ?? 1.8;
  const corner = degToRad(40);
  const specs = [
    ['kiri', W / 2 - 0.15, corner],
    ['tengah-kiri', W * 0.2, 0],
    ['tengah-kanan', -W * 0.2, 0],
    ['kanan', -(W / 2 - 0.15), -corner],
  ];
  const out = [];
  for (const [name, left, yaw] of specs) {
    out.push(new Sensor('ultrasonik', { ...opts, id: `us-depan-${name}`, group: 'depan', mount: { forward: L / 2 - 0.05, left, yaw } }));
  }
  for (const [name, left, yaw] of specs) {
    out.push(new Sensor('ultrasonik', { ...opts, id: `us-belakang-${name}`, group: 'belakang', mount: { forward: -L / 2 + 0.05, left, yaw: Math.PI - yaw } }));
  }
  return out;
}

/**
 * Satu set sensor standar: kamera depan, LiDAR di atap, radar depan, dan 8 ultrasonik.
 * overrides: { kamera: {...}, lidar: {...}, radar: {...}, ultrasonik: {...} }
 */
export function standardSensors(vehicle, overrides = {}) {
  const L = vehicle.length ?? 4.5;
  return [
    new Sensor('kamera', { mount: { forward: L * 0.15, left: 0, yaw: 0 }, ...(overrides.kamera || {}) }),
    new Sensor('lidar', { mount: { forward: -L * 0.05, left: 0, yaw: 0 }, ...(overrides.lidar || {}) }),
    new Sensor('radar', { mount: { forward: L / 2, left: 0, yaw: 0 }, ...(overrides.radar || {}) }),
    ...ultrasonicArray(vehicle, overrides.ultrasonik || {}),
  ];
}

/**
 * Pengelola beberapa sensor pada satu kendaraan. Setiap sensor dipindai sesuai `rate`-nya
 * (misalnya LiDAR 10 kali per detik), hasil terakhir disimpan dan bisa dibaca kapan saja.
 *
 *   const rig = new SensorRig(ego, standardSensors(ego));
 *   rig.update(dt, objects, weather);         // di update()
 *   rig.detections('radar');                  // deteksi terakhir semua sensor radar
 */
export class SensorRig {
  constructor(vehicle, sensors, { seed = 7 } = {}) {
    this.vehicle = vehicle;
    this.sensors = sensors;
    this.rng = new Rng(seed);
    this.readings = new Map();
    this._timers = new Map();
    this.time = 0;
  }

  /** Sensor pertama dengan id tersebut, atau null. */
  get(id) {
    return this.sensors.find((s) => s.id === id) || null;
  }

  /** Semua sensor dengan id atau jenis tertentu. */
  select(idOrType) {
    return this.sensors.filter((s) => s.id === idOrType || s.type === idOrType || s.group === idOrType);
  }

  /** Nyalakan atau matikan sensor berdasarkan id atau jenis. Pembacaan sensor yang dimatikan dihapus. */
  setEnabled(idOrType, on) {
    for (const s of this.select(idOrType)) {
      s.enabled = !!on;
      if (!on) this.readings.delete(s.id);
      else this._timers.set(s.id, Infinity); // pindai pada update berikutnya
    }
  }

  isEnabled(idOrType) {
    return this.select(idOrType).some((s) => s.enabled);
  }

  /** Majukan waktu dan pindai sensor yang sudah waktunya. */
  update(dt, objects, weather = 'cerah') {
    this.time += dt;
    for (const s of this.sensors) {
      if (!s.enabled) continue;
      const t = (this._timers.get(s.id) ?? Infinity) + dt;
      if (t >= 1 / s.rate) {
        this.readings.set(s.id, s.sense(this.vehicle, objects, { weather, rng: this.rng, time: this.time }));
        this._timers.set(s.id, 0);
      } else this._timers.set(s.id, t);
    }
  }

  /** Pindai semua sensor aktif sekarang juga (misalnya setelah cuaca diganti saat dijeda). */
  scanNow(objects, weather = 'cerah') {
    for (const s of this.sensors) {
      if (!s.enabled) continue;
      this.readings.set(s.id, s.sense(this.vehicle, objects, { weather, rng: this.rng, time: this.time }));
      this._timers.set(s.id, 0);
    }
  }

  /** Pembacaan terakhir satu sensor (berdasarkan id), atau null. */
  reading(id) {
    return this.readings.get(id) || null;
  }

  /** Gabungan deteksi terakhir semua sensor aktif dengan id atau jenis tertentu. */
  detections(idOrType) {
    const out = [];
    for (const s of this.select(idOrType)) {
      const r = s.enabled && this.readings.get(s.id);
      if (r) out.push(...r.detections);
    }
    return out;
  }

  /** Himpunan id objek yang sedang terdeteksi oleh sensor dengan id atau jenis tertentu. */
  detectedIds(idOrType) {
    return new Set(this.detections(idOrType).map((d) => d.targetId).filter((id) => id != null));
  }

  /** Hapus semua pembacaan dan jadwalkan pindai ulang. */
  clear() {
    this.readings.clear();
    this._timers.clear();
  }
}
