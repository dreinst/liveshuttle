// Lampu lalu lintas, rencana fase sinyal, dan aturan kecepatan sederhana untuk lalu lintas latar.

import { clamp } from './math.js';

/**
 * Satu lampu lalu lintas. state: 'red' | 'yellow' | 'green'.
 * Posisi (x, y) adalah tiang lampu. heading = arah muka lampu (menghadap kendaraan yang datang).
 * Sebagai target sensor, lampu berbentuk lingkaran kecil (tiang) dan memancarkan cahaya sendiri.
 */
export class TrafficLight {
  constructor({ id, x = 0, y = 0, heading = 0, state = 'red', radius = 0.25, label = 'Lampu lalu lintas' } = {}) {
    this.id = id ?? `lampu-${Math.random().toString(36).slice(2, 7)}`;
    this.kind = 'trafficLight';
    this.x = x;
    this.y = y;
    this.heading = heading;
    this.radius = radius;
    this.state = state;
    this.label = label;
    this.selfLit = true;
    this.timeLeft = 0; // detik sampai state berganti (diisi oleh SignalPlan)
  }
  get isGreen() {
    return this.state === 'green';
  }
}

/**
 * Rencana sinyal untuk satu persimpangan: fase-fase bergiliran, masing-masing memberi hijau
 * ke sekelompok lampu. Setelah hijau ada kuning, lalu semua merah sebentar (all-red clearance).
 *
 *   const plan = new SignalPlan([
 *     { lights: [lampuTimur, lampuBarat], green: 12 },
 *     { lights: [lampuUtara, lampuSelatan], green: 9 },
 *   ], { yellow: 3, allRed: 1.5 });
 *   plan.update(loop.time);
 */
export class SignalPlan {
  constructor(phases, { yellow = 3, allRed = 1.5, offset = 0 } = {}) {
    this.phases = phases;
    this.yellow = yellow;
    this.allRed = allRed;
    this.offset = offset;
    this.cycle = phases.reduce((sum, p) => sum + p.green + yellow + allRed, 0);
    this.phaseIndex = 0;
    this.phaseTime = 0; // detik sejak fase aktif mulai (hijau)
    this.lights = phases.flatMap((p) => p.lights);
  }

  /** Hitung state semua lampu untuk waktu simulasi t (detik). */
  update(t) {
    let local = (((t + this.offset) % this.cycle) + this.cycle) % this.cycle;
    for (const l of this.lights) l.state = 'red';
    for (let i = 0; i < this.phases.length; i++) {
      const p = this.phases[i];
      const span = p.green + this.yellow + this.allRed;
      if (local < span) {
        this.phaseIndex = i;
        this.phaseTime = local;
        let state = 'red';
        let left = span - local;
        if (local < p.green) {
          state = 'green';
          left = p.green - local;
        } else if (local < p.green + this.yellow) {
          state = 'yellow';
          left = p.green + this.yellow - local;
        }
        for (const l of p.lights) {
          l.state = state;
          l.timeLeft = left;
        }
        break;
      }
      local -= span;
    }
    return this;
  }

  /** Detik sejak fase i mulai hijau, atau null bila fase i tidak sedang aktif. */
  timeInPhase(i) {
    return this.phaseIndex === i ? this.phaseTime : null;
  }
}

/**
 * Kecepatan maksimum agar bisa berhenti dalam jarak `distance` dengan perlambatan `decel`.
 * v = akar(2 * a * d). Jarak negatif menghasilkan 0.
 */
export function speedToStop(distance, decel = 3) {
  return distance > 0 ? Math.sqrt(2 * decel * distance) : 0;
}

/**
 * Kecepatan target sederhana untuk kendaraan latar yang mengikuti kendaraan di depan.
 * gap = jarak bersih bemper ke bemper (m).
 * Hasil tidak melebihi cruise dan tetap bisa berhenti bila pemimpin mengerem (bySafeStop).
 * Catatan jujur: dengan bawaan (strict = false), jarak mantap saat mengikuti pada kecepatan v adalah
 * minGap + 0,5 * v * timeGap, jadi hanya setengah jarak waktu. Berikan strict: true agar jarak
 * mantapnya minGap + v * timeGap (sesuai definisi jarak waktu). Bawaan dibiarkan demi pelajaran lama.
 */
export function followingSpeed(gap, leaderSpeed, { cruise = 10, minGap = 2.5, timeGap = 1.2, decel = 3, strict = false } = {}) {
  const free = gap - minGap;
  if (free <= 0) return 0;
  if (strict) {
    const bySafeStop = Math.sqrt(Math.max(0, leaderSpeed * leaderSpeed + 2 * decel * free));
    return clamp(Math.min(free / timeGap, bySafeStop), 0, cruise);
  }
  const byTimeGap = free / timeGap;
  const bySafeStop = Math.sqrt(Math.max(0, leaderSpeed * leaderSpeed + 2 * decel * free));
  return clamp(Math.min(byTimeGap + leaderSpeed * 0.5, bySafeStop), 0, cruise);
}

/**
 * Apakah kendaraan harus berhenti di garis henti saat lampu kuning?
 * Berhenti bila jarak cukup untuk mengerem dengan nyaman, bila tidak lebih aman terus.
 */
export function shouldStopForYellow(distance, speed, comfortDecel = 3) {
  return distance > (speed * speed) / (2 * comfortDecel);
}

/**
 * Kecepatan target kendaraan latar di sebuah jalur yang punya garis henti berlampu.
 * @param {object} agent PathAgent (butuh s, speed, cruise, dan length atau radius)
 * @param {Array<{s:number, light:TrafficLight}>} stops posisi garis henti sepanjang jalur
 * @param {object} [opts] { leaderGap, leaderSpeed, decel, margin, timeGap, strict (lihat followingSpeed) }
 */
export function laneTargetSpeed(agent, stops = [], { leaderGap = Infinity, leaderSpeed = 0, decel = 3, margin = 0.8, timeGap = 1.2, strict = false } = {}) {
  const half = agent.length != null ? agent.length / 2 : agent.radius ?? 0;
  let v = agent.cruise;
  for (const stop of stops) {
    const d = stop.s - (agent.s + half) - margin;
    if (d < -0.5) continue; // bagian depan sudah melewati garis henti, teruskan
    const st = stop.light.state;
    if (st === 'red' || (st === 'yellow' && shouldStopForYellow(d, agent.speed, decel))) {
      v = Math.min(v, d <= 0.05 ? 0 : speedToStop(d, decel));
    }
  }
  if (leaderGap < Infinity) v = Math.min(v, followingSpeed(leaderGap, leaderSpeed, { cruise: agent.cruise, decel, timeGap, strict }));
  return v;
}
