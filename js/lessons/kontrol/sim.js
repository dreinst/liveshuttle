// Model simulasi pelajaran Kendali: mobil di lintasan tertutup, pure pursuit untuk setir, PID
// untuk kecepatan, dan pengukuran (galat lintasan, osilasi, overshoot).
//
// Berkas ini tidak menyentuh DOM, jadi bisa diuji langsung dengan Node (lihat tests/kontrol_model.py).
//
// Hal yang dibuat mirip mobil sungguhan:
//   - setir punya jeda aktuator (STEER_DELAY) dan batas kecepatan putar roda (STEER_RATE);
//   - gas dan rem punya batas (ACCEL_MAX, BRAKE_MAX) dan tanggapan yang tertunda (ACCEL_LAG);
//   - ada hambatan gulir dan hambatan udara, jadi pengendali P saja menyisakan selisih kecepatan;
//   - sensor kecepatan sedikit berderau, jadi Kd yang besar membuat perintah gas bergetar.
// Penyederhanaan: model sepeda kinematik (ban tidak pernah selip) dan posisi mobil diketahui
// tepat (lokalisasi sempurna).

import { Vehicle } from '../../engine/vehicle.js';
import { PID } from '../../engine/control.js';
import { clamp, wrapAngle, Rng } from '../../engine/math.js';
import { closestNear, curvatureAt } from './track.js';

export const CFG = Object.freeze({
  wheelbase: 2.7,
  maxSteer: 0.6, // rad, sekitar 34 derajat di roda
  steerRate: 0.6, // rad/s, kecepatan putar roda maksimum (sekitar 34 derajat per detik)
  steerDelay: 0.18, // detik, jeda dari perintah sampai motor setir mulai bergerak
  accelMax: 2.5, // m/s^2, percepatan terbesar yang boleh diminta pengendali (batas nyaman)
  brakeMax: 4, // m/s^2, perlambatan terbesar untuk pengendali kecepatan (rem darurat bisa sekitar 8)
  accelDelay: 0.1, // detik, jeda sebelum mesin atau rem mulai menanggapi
  accelLag: 0.3, // detik, konstanta waktu mesin dan rem
  rolling: 0.12, // m/s^2, hambatan gulir
  aero: 0.0004, // 1/m, hambatan udara = aero * v^2
  speedNoise: 0.02, // m/s, simpangan baku derau sensor kecepatan
  gripAccel: 8.5, // m/s^2, percepatan samping terbesar yang masih ditahan ban (sekitar 0,87 g)
  latAccel: 3, // m/s^2, batas percepatan samping saat "pelan di tikungan"
  comfortDecel: 2, // m/s^2, perlambatan nyaman sebelum tikungan
  ldMin: 1,
  ldMax: 20,
  ldAdaptiveMin: 2,
  takeoverCte: 3.5, // m, bila sumbu roda belakang sejauh ini dari jalur, pengemudi cadangan mengambil alih
  takeoverHeading: 0.52, // rad (30 derajat), atau bila arah mobil menyimpang sebesar ini dari arah jalur
  takeoverBrake: 6, // m/s^2, pengemudi cadangan boleh mengerem lebih keras daripada pengendali
  takeoverKmh: 25, // km/jam, kecepatan saat pengemudi cadangan mengemudi
  takeoverMin: 2.5, // detik, lama minimum pengambilalihan
});

export const DEFAULTS = Object.freeze({
  ld: 7,
  adaptive: false,
  k: 0.7,
  targetKmh: 40,
  kp: 0.8,
  ki: 0.2,
  kd: 0,
  curveSlow: false,
});

const KMH = 1 / 3.6;

/**
 * Pure pursuit klasik: titik tujuan adalah perpotongan lingkaran berjari-jari Ld (berpusat di
 * sumbu roda belakang) dengan jalur, di depan titik terdekat. Lalu
 *   delta = atan(2 L sin(alpha) / Ld).
 * Bila mobil lebih jauh dari Ld terhadap jalur, lingkaran tidak memotong jalur. Titik tujuan lalu
 * diambil sejauh Ld di sepanjang jalur dan rumus memakai jarak sebenarnya ke titik itu.
 */
export function pursuit(track, ra, heading, ld, near, wheelbase = CFG.wheelbase, maxSteer = CFG.maxSteer) {
  const path = track.ref;
  let target = null;
  let onCircle = false;
  if (near.dist < ld) {
    const pts = path.points;
    const segs = pts.length - 1;
    let i = near.index;
    let ax = near.x;
    let ay = near.y;
    let walked = 0;
    const limit = ld * 3 + 10;
    while (walked < limit) {
      const b = pts[i + 1];
      const ex = b.x - ax;
      const ey = b.y - ay;
      const fx = ax - ra.x;
      const fy = ay - ra.y;
      const A = ex * ex + ey * ey;
      if (A > 1e-9) {
        const B = 2 * (fx * ex + fy * ey);
        const C = fx * fx + fy * fy - ld * ld;
        const disc = B * B - 4 * A * C;
        if (disc >= 0) {
          const t = (-B + Math.sqrt(disc)) / (2 * A); // titik keluar lingkaran
          if (t >= 0 && t <= 1) {
            target = { x: ax + ex * t, y: ay + ey * t };
            onCircle = true;
            break;
          }
        }
      }
      walked += Math.sqrt(A);
      i = (i + 1) % segs;
      ax = pts[i].x;
      ay = pts[i].y;
    }
  }
  if (!target) {
    const p = path.sample(near.s + ld);
    target = { x: p.x, y: p.y };
  }
  const dx = target.x - ra.x;
  const dy = target.y - ra.y;
  const dist = Math.max(0.3, Math.hypot(dx, dy));
  const alpha = wrapAngle(Math.atan2(dy, dx) - heading);
  const curvature = (2 * Math.sin(alpha)) / dist;
  const steer = clamp(Math.atan(wheelbase * curvature), -maxSteer, maxSteer);
  return { target, onCircle, alpha, dist, curvature, steer };
}

/** Titik-titik busur yang akan dilalui sumbu roda belakang dengan kelengkungan tertentu. */
export function arcPoints(ra, heading, curvature, length, n = 24) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const s = (length * i) / n;
    if (Math.abs(curvature) < 1e-4) pts.push({ x: ra.x + Math.cos(heading) * s, y: ra.y + Math.sin(heading) * s });
    else {
      const th = heading + curvature * s;
      pts.push({ x: ra.x + (Math.sin(th) - Math.sin(heading)) / curvature, y: ra.y - (Math.cos(th) - Math.cos(heading)) / curvature });
    }
  }
  return pts;
}

/**
 * Pendeteksi ayunan: mencatat titik balik (puncak dan lembah) galat lintasan dengan histeresis,
 * lalu menilai apakah mobil berayun kiri kanan berulang kali.
 */
class SwingDetector {
  constructor(hysteresis = 0.08) {
    this.h = hysteresis;
    this.reset();
  }
  reset() {
    this.mode = 0; // 1 = sedang naik, -1 = sedang turun, 0 = belum tahu
    this.base = null;
    this.ext = 0;
    this.extT = 0;
    this.turns = []; // titik balik { t, v }
  }
  push(t, v) {
    if (this.base == null) {
      this.base = v;
      return;
    }
    if (this.mode === 0) {
      if (Math.abs(v - this.base) > this.h) {
        this.mode = v > this.base ? 1 : -1;
        this.ext = v;
        this.extT = t;
      }
      return;
    }
    const rising = this.mode === 1;
    if (rising ? v > this.ext : v < this.ext) {
      this.ext = v;
      this.extT = t;
    } else if (Math.abs(v - this.ext) > this.h) {
      this.turns.push({ t: this.extT, v: this.ext });
      this.mode = -this.mode;
      this.ext = v;
      this.extT = t;
    }
    while (this.turns.length && this.turns[0].t < t - 8) this.turns.shift();
  }
  /**
   * Ringkasan ayunan dalam `window` detik terakhir: jumlah ayunan besar berturut-turut,
   * amplitudo rata-rata (m) dan frekuensi (Hz).
   */
  summary(now, window = 5, minPeakToPeak = 0.3) {
    const recent = this.turns.filter((p) => p.t >= now - window);
    let run = 0;
    let best = 0;
    let amp = 0;
    let ampN = 0;
    for (let i = 1; i < recent.length; i++) {
      const d = Math.abs(recent[i].v - recent[i - 1].v);
      if (d >= minPeakToPeak) {
        run++;
        amp += d / 2;
        ampN++;
      } else run = 0;
      best = Math.max(best, run);
    }
    const span = recent.length > 1 ? recent[recent.length - 1].t - recent[0].t : 0;
    return {
      swings: best,
      amplitude: ampN ? amp / ampN : 0,
      frequency: span > 0 ? (recent.length - 1) / (2 * span) : 0,
    };
  }
}

/**
 * Buat simulasi. `track` dari buildTrack(). `settings` boleh diubah langsung oleh pelajaran
 * (ld, adaptive, k, targetKmh, kp, ki, kd, curveSlow); panggil notify*() supaya pengukuran tahu.
 */
export function createSim(track, { seed = 7, cfg = null } = {}) {
  const C = cfg ? { ...CFG, ...cfg } : CFG;
  const settings = { ...DEFAULTS };
  const rng = new Rng(seed);
  const ego = new Vehicle({
    id: 'ego',
    label: 'Mobil otonom',
    ego: true,
    wheelbase: C.wheelbase,
    maxSteer: C.maxSteer,
    steerRate: C.steerRate,
    maxAccel: 10, // batas sebenarnya diterapkan di bawah (C.accelMax dan C.brakeMax)
    maxBrake: 12,
    maxSpeed: 30,
  });
  const pid = new PID({ kp: settings.kp, ki: settings.ki, kd: settings.kd, min: -C.brakeMax, max: C.accelMax, integralLimit: 20, derivativeFilter: 0.8 });
  const swing = new SwingDetector(0.08);

  const state = {
    time: 0,
    s: 0, // posisi sepanjang jalur acuan (sumbu roda belakang)
    progress: 0, // jarak tempuh sepanjang jalur sejak mulai (tidak dibungkus)
    cte: 0, // galat lintasan (m), positif = di kanan jalur acuan
    curvatureHere: 0,
    ldEff: settings.ld,
    pp: null, // hasil pure pursuit terakhir
    steerCmd: 0,
    steerDelayed: 0,
    aCmd: 0,
    aAct: 0,
    vMeas: 0,
    vRef: 0,
    vSet: 0,
    latAccel: 0,
    lap: null, // putaran yang sedang diukur
    lastLap: null, // putaran penuh terakhir { rms, max, avgKmh, time, ... }
    laps: 0,
    episode: null, // uji respons kecepatan terakhir
    trail: [], // jejak sumbu roda belakang { x, y, cte }
    takeover: null, // { time, at, ld, targetKmh, kmh } saat pengemudi cadangan mengemudi
    lastTakeover: null,
    takeovers: 0,
    headingError: 0,
  };

  const delaySteps = Math.max(0, Math.round(C.steerDelay * 60));
  const accelSteps = Math.max(0, Math.round(C.accelDelay * 60));
  let steerQueue = [];
  let accelQueue = [];

  function placeAtStart() {
    const p = track.ref.sample(0);
    const L2 = C.wheelbase / 2;
    // sumbu roda belakang tepat di garis start, di tengah lajur
    ego.setPose(p.x + Math.cos(p.heading) * L2, p.y + Math.sin(p.heading) * L2, p.heading);
    ego.odometer = 0;
    rng.reseed(seed); // derau sensor sama setiap kali diulang
    steerQueue = new Array(delaySteps).fill(0);
    accelQueue = new Array(accelSteps).fill(0);
    pid.reset();
    swing.reset();
    Object.assign(state, {
      time: 0,
      s: 0,
      progress: 0,
      cte: 0,
      pp: null,
      steerCmd: 0,
      steerDelayed: 0,
      aCmd: 0,
      aAct: 0,
      vMeas: 0,
      latAccel: 0,
      lastLap: null,
      laps: 0,
      trail: [],
      takeover: null,
      lastTakeover: null,
      takeovers: 0,
      headingError: 0,
    });
    state.lap = newLap();
    state.episode = null;
    startEpisode(true);
    evaluate();
  }

  function newLap() {
    return { start: state.progress, startTime: state.time, sumSq: 0, sumW: 0, max: 0, dist: 0, minSpeed: Infinity, takeover: !!state.takeover, settings: snapshot() };
  }

  const snapshot = () => ({ ld: settings.ld, adaptive: settings.adaptive, k: settings.k, targetKmh: settings.targetKmh, curveSlow: settings.curveSlow });

  function ldNow(v = ego.speed) {
    if (settings.adaptive) return clamp(settings.k * v, C.ldAdaptiveMin, C.ldMax);
    return clamp(settings.ld, C.ldMin, C.ldMax);
  }

  /** Kecepatan acuan: target, atau lebih pelan menjelang dan di dalam tikungan. */
  function speedRef() {
    const vSet = settings.targetKmh * KMH;
    if (!settings.curveSlow) return vSet;
    let v = vSet;
    for (let d = 0; d <= 90; d += 1.5) {
      const k = Math.abs(curvatureAt(track, state.s + d));
      if (k < 1e-4) continue;
      const vCurve = Math.sqrt(C.latAccel / k);
      v = Math.min(v, Math.sqrt(vCurve * vCurve + 2 * C.comfortDecel * d));
    }
    return v;
  }

  // ---------- uji respons kecepatan (overshoot dan waktu mencapai target) ----------
  // Overshoot hanya diukur saat target NAIK. Saat target turun, hambatan udara dan gulir ikut
  // mengerem, dan pengendali P saja berhenti sedikit di bawah target. Selisih tetap itu bukan
  // overshoot, jadi lonjakan turun tidak dihitung.
  // spoiled: alasan uji tidak sah ('tikungan' = Pelan di tikungan menyala, 'cadangan' = diambil alih).
  const refreshValid = (ep) => {
    ep.valid = !ep.spoiled && ep.dir > 0;
  };

  function startEpisode(fromStandstill = false) {
    const vSet = settings.targetKmh * KMH;
    const ep = state.episode;
    // saat slider sedang digeser, lonjakan-lonjakan kecil digabung menjadi satu uji
    if (!fromStandstill && ep && !ep.reachedAt && state.time - ep.lastChange < 1) {
      ep.target = vSet;
      ep.lastChange = state.time;
      ep.dir = Math.sign(vSet - ep.v0) || 1;
      ep.step = Math.abs(vSet - ep.v0);
      if (settings.curveSlow) ep.spoiled = ep.spoiled || 'tikungan';
      refreshValid(ep);
      return;
    }
    const v0 = ego.speed;
    state.episode = {
      t0: state.time,
      lastChange: state.time,
      v0,
      target: vSet,
      dir: Math.sign(vSet - v0) || 1,
      step: Math.abs(vSet - v0),
      extreme: v0,
      overshoot: 0,
      reachedAt: null,
      valid: false,
      spoiled: settings.curveSlow ? 'tikungan' : state.takeover ? 'cadangan' : null,
      stale: false,
      fromStandstill,
      settledSince: null,
    };
    refreshValid(state.episode);
  }

  function spoilEpisode(reason) {
    const ep = state.episode;
    if (!ep) return;
    ep.spoiled = ep.spoiled || reason;
    ep.valid = false;
  }

  function trackEpisode() {
    const ep = state.episode;
    if (!ep) return;
    const v = ego.speed;
    if (settings.curveSlow) spoilEpisode('tikungan');
    if (ep.dir > 0) ep.extreme = Math.max(ep.extreme, v);
    else ep.extreme = Math.min(ep.extreme, v);
    const beyond = ep.dir > 0 ? ep.extreme - ep.target : ep.target - ep.extreme;
    ep.overshoot = ep.step > 1e-6 ? Math.max(0, beyond) / ep.step : 0;
    const tol = Math.max(0.3 * KMH, 0.02 * ep.step);
    if (ep.reachedAt == null && (Math.abs(v - ep.target) <= tol || (ep.dir > 0 ? v >= ep.target : v <= ep.target))) {
      ep.reachedAt = state.time - ep.t0;
    }
    // "tenang": kecepatan bertahan dekat target (dipakai untuk memastikan puncak overshoot sudah lewat)
    const band = Math.max(0.5 * KMH, 0.03 * ep.step);
    if (ep.reachedAt != null && Math.abs(v - ep.target) <= band) {
      if (ep.settledSince == null) ep.settledSince = state.time;
    } else ep.settledSince = null;
  }

  // ---------- satu langkah simulasi ----------
  function evaluate() {
    const ra = ego.rearAxle();
    const near = closestNear(track.ref, ra.x, ra.y, state.s, 14);
    state.s = near.s;
    state.cte = -near.lateral;
    state.curvatureHere = curvatureAt(track, near.s);
    state.ldEff = ldNow();
    state.pp = pursuit(track, ra, ego.heading, state.ldEff, near);
    state.headingError = wrapAngle(ego.heading - near.heading);
    state.vSet = settings.targetKmh * KMH;
    state.vRef = speedRef();
    if (state.takeover) {
      // pengemudi cadangan memakai lookahead panjang yang pasti stabil dan kecepatan rendah
      const safeLd = clamp(0.9 * ego.speed, 8, 14);
      state.safePp = pursuit(track, ra, ego.heading, safeLd, near);
      state.vRef = Math.min(state.vRef, C.takeoverKmh * KMH);
    } else state.safePp = null;
    return near;
  }

  function step(dt) {
    evaluate();
    const pp = state.pp;

    // setir: pengendali tidak meminta belokan yang melebihi cengkeram ban, lalu perintah masuk
    // antrean jeda, dan motor setir mengejar dengan kecepatan putar terbatas
    const v0 = Math.max(ego.speed, 0.1);
    const gripSteer = Math.min(C.maxSteer, Math.atan((C.wheelbase * C.gripAccel) / (v0 * v0)));
    const active = state.takeover ? state.safePp : pp;
    state.steerCmd = clamp(active.steer, -gripSteer, gripSteer);
    state.gripLimited = Math.abs(active.steer) > gripSteer;
    if (state.takeover) {
      // pengemudi cadangan memegang setir langsung: tanpa jeda aktuator dan memutar lebih cepat
      steerQueue.fill(state.steerCmd);
      state.steerDelayed = state.steerCmd;
      ego.steerRate = C.steerRate * 2;
    } else {
      steerQueue.push(state.steerCmd);
      state.steerDelayed = steerQueue.length > delaySteps ? steerQueue.shift() : state.steerDelayed;
      ego.steerRate = C.steerRate;
    }

    // kecepatan: PID menghitung percepatan yang diminta dari selisih kecepatan terukur
    state.vMeas = ego.speed + rng.gaussian(0, C.speedNoise);
    pid.kp = settings.kp;
    pid.ki = settings.ki;
    pid.kd = settings.kd;
    if (state.takeover) {
      // pengemudi cadangan mengerem sendiri, tidak memakai PID pelajar
      state.aCmd = clamp(1.5 * (state.vRef - ego.speed), -C.takeoverBrake, C.accelMax);
    } else state.aCmd = pid.update(state.vRef - state.vMeas, dt);
    accelQueue.push(state.aCmd);
    const aDelayed = accelQueue.length > accelSteps ? accelQueue.shift() : 0;
    state.aAct += (aDelayed - state.aAct) * (1 - Math.exp(-dt / C.accelLag));

    const v = ego.speed;
    let net = state.aAct - C.aero * v * v;
    if (v > 0.01) net -= C.rolling;
    else net = Math.max(0, net - C.rolling); // diam: gaya kecil belum cukup untuk bergerak
    const sPrev = state.s;
    ego.step(dt, { accel: net, steer: state.steerDelayed });
    ego.braking = state.aAct < -0.4;
    state.time += dt;
    state.latAccel = ego.speed * ego.speed * Math.tan(ego.steer) / C.wheelbase;

    // ukur setelah bergerak
    const near = evaluate();
    let ds = near.s - sPrev;
    const L = track.length;
    if (ds > L / 2) ds -= L;
    if (ds < -L / 2) ds += L;
    state.progress += ds;

    const lap = state.lap;
    const w = Math.abs(ds);
    lap.sumSq += state.cte * state.cte * w;
    lap.sumW += w;
    lap.dist += ds;
    lap.max = Math.max(lap.max, Math.abs(state.cte));
    if (ego.speed * 3.6 < lap.minSpeed) lap.minSpeed = ego.speed * 3.6;
    if (state.progress - lap.start >= L) {
      const time = state.time - lap.startTime;
      state.lastLap = {
        rms: Math.sqrt(lap.sumSq / Math.max(1e-6, lap.sumW)),
        max: lap.max,
        time,
        avgKmh: (lap.dist / Math.max(1e-6, time)) * 3.6,
        minKmh: lap.minSpeed,
        settings: lap.settings,
        takeover: lap.takeover,
        endTime: state.time,
        index: ++state.laps,
      };
      state.lap = newLap();
    }

    // pengawas: mobil terlalu jauh dari jalur, pengemudi cadangan mengambil alih
    const swerving = ego.speed > 3 && Math.abs(state.headingError) > C.takeoverHeading;
    if (!state.takeover && (Math.abs(state.cte) > C.takeoverCte || swerving)) {
      state.takeover = { time: 0, at: state.time, ld: state.ldEff, targetKmh: settings.targetKmh, kmh: ego.speed * 3.6 };
      state.lastTakeover = state.takeover;
      state.takeovers++;
      state.lap.takeover = true;
      spoilEpisode('cadangan');
    } else if (state.takeover) {
      state.takeover.time += dt;
      if (state.takeover.time > C.takeoverMin && Math.abs(state.cte) < 0.3 && Math.abs(state.headingError) < 0.06) {
        state.takeover = null;
        swing.reset();
        pid.reset();
        state.lap = newLap();
      }
    }

    if (!state.takeover) swing.push(state.time, state.cte);
    trackEpisode();

    const tr = state.trail;
    const last = tr[tr.length - 1];
    const ra = ego.rearAxle();
    if (!last || Math.hypot(ra.x - last.x, ra.y - last.y) > 0.4) {
      tr.push({ x: ra.x, y: ra.y, cte: state.cte });
      if (tr.length > 1150) tr.splice(0, tr.length - 1150);
    }
  }

  placeAtStart();

  return {
    track,
    ego,
    pid,
    state,
    settings,
    step,
    evaluate,
    reset: placeAtStart,
    ldNow,
    /** Pengaturan kemudi atau kecepatan target berubah: mulai ukur putaran baru dari sini. */
    notifyTrackingChange() {
      state.lap = newLap();
      swing.reset();
    },
    /** Kecepatan target berubah: mulai uji respons baru. */
    notifyTargetChange() {
      state.lap = newLap();
      startEpisode(false);
    },
    /** Kp, Ki, atau Kd berubah: hasil uji lama tidak lagi mewakili pengaturan baru. */
    notifyGainChange() {
      if (state.episode) state.episode.stale = true;
    },
    swingSummary: (window, minP2P) => swing.summary(state.time, window, minP2P),
    lapProgress: () => clamp((state.progress - state.lap.start) / track.length, 0, 1),
    currentLapRms: () => (state.lap.sumW > 0 ? Math.sqrt(state.lap.sumSq / state.lap.sumW) : 0),
  };
}
