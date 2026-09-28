// Kendali: pure pursuit untuk setir dan PID untuk kecepatan.

import { clamp, wrapAngle } from './math.js';

/**
 * Pure pursuit: pilih titik di jalur sejauh `lookahead` di depan sumbu roda belakang,
 * lalu hitung sudut setir agar kendaraan melengkung tepat melewati titik itu.
 *   delta = atan(2 * L * sin(alpha) / ld)
 * dengan L = jarak sumbu roda, alpha = sudut titik tujuan relatif terhadap arah hadap.
 *
 * @param {object} vehicle Vehicle, atau pose biasa { x, y, heading, wheelbase, maxSteer, speed }
 *        (misalnya pose hasil perkiraan lokalisasi). Bila rearAxle() tidak ada, sumbu belakang
 *        dihitung dari titik tengah: mundur wheelbase / 2 searah heading.
 * @param {Path} path jalur yang diikuti
 * @param {object} [opts]
 * @param {number} [opts.lookahead=6] jarak pandang ke depan (m)
 * @param {number} [opts.gain=0] tambahan lookahead per m/s (ld = lookahead + gain * speed)
 * @param {number} [opts.hintS] posisi s sebelumnya supaya pencarian titik terdekat tidak melompat
 * @param {'arc'|'circle'} [opts.target='arc'] 'arc': titik tujuan ld meter di depan titik terdekat
 *        (menurut panjang jalur). 'circle': titik pertama di jalur yang berjarak lurus ld dari sumbu
 *        belakang (bentuk klasik pure pursuit, lebih tepat di tikungan tajam).
 * @returns {{steer:number, target:{x,y}, alpha:number, s:number, ld:number, crossTrack:number}}
 */
export function purePursuit(vehicle, path, { lookahead = 6, gain = 0, hintS = null, target: mode = 'arc' } = {}) {
  const L = vehicle.wheelbase ?? 2.7;
  const maxSteer = vehicle.maxSteer ?? 0.6;
  const ra =
    typeof vehicle.rearAxle === 'function'
      ? vehicle.rearAxle()
      : { x: vehicle.x - Math.cos(vehicle.heading) * (L / 2), y: vehicle.y - Math.sin(vehicle.heading) * (L / 2) };
  const ld = Math.max(1, lookahead + gain * Math.abs(vehicle.speed || 0));
  const near = path.closest(ra.x, ra.y, hintS);
  let target = path.sample(near.s + ld);
  if (mode === 'circle') {
    // cari titik pertama sepanjang jalur yang jarak lurusnya dari sumbu belakang >= ld
    const step = Math.max(0.25, ld / 24);
    const limit = near.s + ld * 3;
    for (let s = near.s; s <= limit; s += step) {
      const p = path.sample(s);
      if (Math.hypot(p.x - ra.x, p.y - ra.y) >= ld) {
        target = p;
        break;
      }
      if (!path.closed && s >= path.length) {
        target = p;
        break;
      }
    }
  }
  const alpha = wrapAngle(Math.atan2(target.y - ra.y, target.x - ra.x) - vehicle.heading);
  const dist = Math.max(0.5, Math.hypot(target.x - ra.x, target.y - ra.y));
  const steer = clamp(Math.atan2(2 * L * Math.sin(alpha), dist), -maxSteer, maxSteer);
  return { steer, target: { x: target.x, y: target.y }, alpha, s: near.s, ld, crossTrack: -near.lateral };
}

/**
 * Galat lintasan (cross-track error) bertanda: positif bila kendaraan di KANAN jalur,
 * negatif bila di kiri. Dihitung dari titik tengah kendaraan.
 */
export function crossTrackError(x, y, path, hintS = null) {
  return -path.closest(x, y, hintS).lateral;
}

/**
 * Pengendali PID.
 *   u = kp * e + ki * integral(e) + kd * de/dt
 * Keluaran dibatasi [min, max]. Integral dibatasi integralLimit dan berhenti menumpuk saat
 * keluaran jenuh (anti-windup). Turunan bisa dihaluskan dengan derivativeFilter (0 sampai 1).
 * derivativeOnMeasurement: true memakai -d(terukur)/dt sebagai ganti de/dt, sehingga tidak ada
 * lonjakan (derivative kick) saat target berubah mendadak. Berikan nilai terukur sebagai argumen
 * ketiga update(error, dt, measured).
 */
export class PID {
  constructor({ kp = 1, ki = 0, kd = 0, min = -Infinity, max = Infinity, integralLimit = Infinity, derivativeFilter = 0, derivativeOnMeasurement = false } = {}) {
    Object.assign(this, { kp, ki, kd, min, max, integralLimit, derivativeFilter, derivativeOnMeasurement });
    this.reset();
  }

  reset() {
    this.integral = 0;
    this.prevError = null;
    this.prevMeasured = null;
    this.derivative = 0;
    this.output = 0;
    this.terms = { p: 0, i: 0, d: 0 };
  }

  /** Hitung keluaran untuk galat `error` (target - terukur) setelah dt detik. `measured` opsional. */
  update(error, dt, measured = null) {
    if (dt <= 0) return this.output;
    let rawD;
    if (this.derivativeOnMeasurement && measured != null) {
      rawD = this.prevMeasured == null ? 0 : -(measured - this.prevMeasured) / dt;
      this.prevMeasured = measured;
    } else rawD = this.prevError == null ? 0 : (error - this.prevError) / dt;
    this.derivative = this.derivativeFilter > 0 ? this.derivative + (1 - this.derivativeFilter) * (rawD - this.derivative) : rawD;
    this.prevError = error;
    const nextIntegral = clamp(this.integral + error * dt, -this.integralLimit, this.integralLimit);
    const p = this.kp * error;
    const d = this.kd * this.derivative;
    let u = p + this.ki * nextIntegral + d;
    const saturated = u > this.max || u < this.min;
    // anti-windup: jangan tambah integral bila keluaran jenuh ke arah yang sama
    if (!saturated || Math.sign(error) !== Math.sign(u)) this.integral = nextIntegral;
    u = clamp(p + this.ki * this.integral + d, this.min, this.max);
    this.terms = { p, i: this.ki * this.integral, d };
    this.output = u;
    return u;
  }
}
