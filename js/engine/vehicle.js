// Kendaraan dengan model sepeda kinematik (kinematic bicycle model) dan agen pengikut jalur.
//
// Vehicle: posisi (x, y) adalah TITIK TENGAH bodi. Model sepeda diukur di pusat massa yang
// dianggap di tengah jarak sumbu roda. Setir positif = belok KANAN (searah jarum jam di layar,
// karena y ke bawah). Kecepatan positif = maju.
//
// PathAgent: pelaku sederhana (mobil lain, pejalan kaki, pesepeda) yang bergerak sepanjang
// Path dengan kecepatan yang mendekati kecepatan target.

import { approach, clamp, wrapAngle, msToKmh } from './math.js';
import { boxCorners, Path } from './geometry.js';
import { SIZES } from './theme.js';

let nextId = 1;
const newId = (prefix) => `${prefix}-${nextId++}`;

export class Vehicle {
  /**
   * @param {object} [o]
   * @param {string} [o.id]
   * @param {string} [o.kind='car'] 'car' | 'bus' | 'shuttle' | 'truck'
   * @param {number} [o.x=0] @param {number} [o.y=0] @param {number} [o.heading=0]
   * @param {number} [o.speed=0] m/s
   * @param {number} [o.length=4.5] @param {number} [o.width=1.8] @param {number} [o.wheelbase=2.7]
   * @param {number} [o.maxSteer=0.6] batas sudut roda depan (rad)
   * @param {number} [o.steerRate=1.2] kecepatan putar setir maksimum (rad/s)
   * @param {number} [o.maxAccel=3] m/s^2
   * @param {number} [o.maxBrake=8] perlambatan maksimum (m/s^2), kira-kira 0,8 g di aspal kering
   * @param {number} [o.maxSpeed=25] m/s
   * @param {number} [o.maxReverse=0] kecepatan mundur maksimum (m/s), 0 = tidak bisa mundur
   * @param {string} [o.color] @param {boolean} [o.ego=false] kendaraan otonom milik pelajar
   */
  constructor(o = {}) {
    const size = SIZES[o.kind] || SIZES.car;
    this.id = o.id ?? newId(o.kind || 'car');
    this.kind = o.kind ?? 'car';
    this.x = o.x ?? 0;
    this.y = o.y ?? 0;
    this.heading = o.heading ?? 0;
    this.speed = o.speed ?? 0;
    this.steer = o.steer ?? 0;
    this.length = o.length ?? size.length;
    this.width = o.width ?? size.width;
    this.wheelbase = o.wheelbase ?? size.wheelbase ?? this.length * 0.6;
    this.maxSteer = o.maxSteer ?? 0.6;
    this.steerRate = o.steerRate ?? 1.2;
    this.maxAccel = o.maxAccel ?? 3;
    this.maxBrake = o.maxBrake ?? 8;
    this.maxSpeed = o.maxSpeed ?? 25;
    this.maxReverse = o.maxReverse ?? 0;
    this.color = o.color ?? null;
    this.ego = o.ego ?? false;
    this.label = o.label ?? '';
    this.accel = 0; // percepatan hasil langkah terakhir (m/s^2)
    this.braking = false;
    this.odometer = 0;
    this._slip = 0;
  }

  /**
   * Maju satu langkah waktu.
   * @param {number} dt detik
   * @param {object} [input]
   * @param {number} [input.accel=0] percepatan bertanda searah hadap (m/s^2)
   * @param {number} [input.brake=0] besar pengereman (m/s^2, >= 0). Mendorong kecepatan ke 0 tanpa melewatinya.
   * @param {number} [input.steer] sudut setir yang diminta (rad). Tanpa nilai: setir tetap.
   */
  step(dt, { accel = 0, brake = 0, steer = this.steer } = {}) {
    this.steer = approach(this.steer, clamp(steer, -this.maxSteer, this.maxSteer), this.steerRate * dt);
    const prev = this.speed;
    let v = prev + clamp(accel, -this.maxBrake, this.maxAccel) * dt;
    if (brake > 0) {
      const b = Math.min(brake, this.maxBrake) * dt;
      v = Math.abs(v) <= b ? 0 : v - Math.sign(v) * b;
    }
    this.speed = clamp(v, -this.maxReverse, this.maxSpeed);
    this.accel = (this.speed - prev) / dt;
    this.braking = brake > 0.5 || (this.accel < -0.5 && this.speed > 0.1);

    // model sepeda kinematik di pusat massa (lr = setengah jarak sumbu roda)
    const lr = this.wheelbase / 2;
    const beta = Math.atan(0.5 * Math.tan(this.steer));
    this._slip = beta;
    this.x += this.speed * Math.cos(this.heading + beta) * dt;
    this.y += this.speed * Math.sin(this.heading + beta) * dt;
    this.heading = wrapAngle(this.heading + (this.speed / lr) * Math.sin(beta) * dt);
    this.odometer += Math.abs(this.speed) * dt;
    return this;
  }

  /** Percepatan sederhana untuk menuju kecepatan target (pengendali P yang dibatasi). */
  accelToward(targetSpeed, gain = 1.5) {
    return clamp((targetSpeed - this.speed) * gain, -this.maxBrake, this.maxAccel);
  }

  /** Letakkan kendaraan di pose tertentu dan hentikan. */
  setPose(x, y, heading = this.heading) {
    this.x = x;
    this.y = y;
    this.heading = heading;
    this.speed = 0;
    this.steer = 0;
    this.accel = 0;
    this.braking = false;
    return this;
  }

  /** Kecepatan dalam km/jam. */
  get kmh() {
    return msToKmh(this.speed);
  }
  /** Komponen kecepatan dunia (m/s). */
  get vx() {
    return this.speed * Math.cos(this.heading + this._slip);
  }
  get vy() {
    return this.speed * Math.sin(this.heading + this._slip);
  }
  /** Vektor satuan arah hadap. */
  forward() {
    return { x: Math.cos(this.heading), y: Math.sin(this.heading) };
  }
  /** Titik tengah sumbu roda belakang (acuan pure pursuit). */
  rearAxle() {
    const d = this.wheelbase / 2;
    return { x: this.x - Math.cos(this.heading) * d, y: this.y - Math.sin(this.heading) * d, heading: this.heading };
  }
  frontAxle() {
    const d = this.wheelbase / 2;
    return { x: this.x + Math.cos(this.heading) * d, y: this.y + Math.sin(this.heading) * d, heading: this.heading };
  }
  /** Titik tengah bemper depan. */
  front() {
    const d = this.length / 2;
    return { x: this.x + Math.cos(this.heading) * d, y: this.y + Math.sin(this.heading) * d };
  }
  /** Titik tengah bemper belakang. */
  rear() {
    const d = this.length / 2;
    return { x: this.x - Math.cos(this.heading) * d, y: this.y - Math.sin(this.heading) * d };
  }
  /** Empat sudut bodi: depan-kiri, depan-kanan, belakang-kanan, belakang-kiri. */
  corners() {
    return boxCorners(this);
  }
  /** Jarak henti (m) dari kecepatan sekarang dengan perlambatan tertentu (tanpa waktu reaksi). */
  brakingDistance(decel = this.maxBrake) {
    return (this.speed * this.speed) / (2 * decel);
  }
}

export class PathAgent {
  /**
   * @param {object} o
   * @param {Path|Array<{x,y}>} o.path jalur yang diikuti
   * @param {string} [o.kind='car'] 'car' | 'bus' | 'truck' | 'pedestrian' | 'cyclist' | ...
   * @param {number} [o.s=0] posisi awal sepanjang jalur (m)
   * @param {number} [o.speed=0] kecepatan awal (m/s)
   * @param {number} [o.cruise=8] kecepatan target default (m/s)
   * @param {number} [o.accel=2] percepatan (m/s^2)
   * @param {number} [o.decel=4] perlambatan normal (m/s^2)
   * @param {boolean} [o.loop=false] kembali ke awal saat sampai ujung jalur
   * @param {number} [o.length] @param {number} [o.width] untuk bentuk kotak
   * @param {number} [o.radius] bila diisi, agen berbentuk lingkaran (pejalan kaki)
   */
  constructor(o) {
    const size = SIZES[o.kind] || (o.kind === 'pedestrian' ? null : SIZES.car);
    this.id = o.id ?? newId(o.kind || 'agent');
    this.kind = o.kind ?? 'car';
    this.path = o.path instanceof Path ? o.path : new Path(o.path);
    this.s = o.s ?? 0;
    this.speed = o.speed ?? 0;
    this.cruise = o.cruise ?? 8;
    this.accelRate = o.accel ?? 2;
    this.decelRate = o.decel ?? 4;
    this.loop = o.loop ?? false;
    this.color = o.color ?? null;
    this.label = o.label ?? '';
    this.done = false;
    this.braking = false;
    if (o.radius != null || this.kind === 'pedestrian') {
      this.radius = o.radius ?? SIZES.pedestrian.radius;
    } else {
      this.length = o.length ?? size?.length ?? 4.5;
      this.width = o.width ?? size?.width ?? 1.8;
    }
    this.x = 0;
    this.y = 0;
    this.heading = 0;
    this.vx = 0;
    this.vy = 0;
    this._syncPose();
  }

  /** Ganti jalur dan posisi. */
  setPath(path, s = 0) {
    this.path = path instanceof Path ? path : new Path(path);
    this.s = s;
    this.done = false;
    this._syncPose();
    return this;
  }

  /** Pindah ke posisi s tanpa mengubah jalur. */
  setS(s) {
    this.s = s;
    this.done = false;
    this._syncPose();
    return this;
  }

  /** Jarak tersisa sampai ujung jalur (m). */
  get remaining() {
    return this.path.length - this.s;
  }

  /**
   * Maju satu langkah. targetSpeed (m/s) menggantikan cruise untuk langkah ini,
   * misalnya dari speedToStop() atau followingSpeed() di traffic.js.
   */
  step(dt, targetSpeed = this.cruise) {
    const target = Math.max(0, targetSpeed);
    const rate = target > this.speed ? this.accelRate : this.decelRate;
    this.speed = approach(this.speed, target, rate * dt);
    this.braking = target < this.speed - 0.2;
    this.s += this.speed * dt;
    if (this.s >= this.path.length) {
      if (this.loop) this.s -= this.path.length;
      else {
        this.s = this.path.length;
        this.speed = 0;
        this.done = true;
      }
    }
    this._syncPose();
    return this;
  }

  _syncPose() {
    const p = this.path.sample(this.s);
    this.x = p.x;
    this.y = p.y;
    this.heading = p.heading;
    this.vx = Math.cos(p.heading) * this.speed;
    this.vy = Math.sin(p.heading) * this.speed;
  }
}
