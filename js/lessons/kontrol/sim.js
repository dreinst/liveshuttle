// Model simulasi pelajaran Kendali: mobil di lintasan tertutup, pure pursuit untuk setir, PID
// untuk kecepatan, dan pengukuran (galat lintasan, osilasi, overshoot).
//
// Berkas ini tidak menyentuh DOM, jadi bisa diuji langsung dengan Node (lihat tests/kontrol_model.py).
//
// Hal yang dibuat mirip mobil sungguhan:
//   - setir punya jeda aktuator (steerDelay) dan batas kecepatan putar roda (steerRate);
//   - gas dan rem punya batas (accelMax, brakeMax) dan tanggapan yang tertunda (accelLag);
//   - ada hambatan gulir dan hambatan udara, jadi pengendali P saja menyisakan selisih kecepatan;
//   - sensor kecepatan sedikit berderau, jadi Kd yang besar membuat perintah gas bergetar;
//   - pengemudi cadangan mengambil alih sebelum terlambat: ia menghitung ke depan apa yang terjadi
//     bila ia memegang setir sekarang, dan tidak menunggu sampai bodi mobil keluar dari badan jalan.
// Penyederhanaan: model sepeda kinematik (ban tidak pernah selip) dan posisi mobil diketahui
// tepat (lokalisasi sempurna).

import { Vehicle } from '../../engine/vehicle.js';
import { PID } from '../../engine/control.js';
import { clamp, wrapAngle, approach, Rng } from '../../engine/math.js';
import { boxCorners } from '../../engine/geometry.js';
import { closestNear, curvatureAt, zoneAt } from './track.js';

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
  ldMin: 2,
  ldMax: 20,
  ldAdaptiveMin: 2,
  takeoverCte: 1.5, // m, bila sumbu roda belakang (kini atau sesaat lagi) sejauh ini dari jalur, pengemudi cadangan mengambil alih
  takeoverPredict: 0.6, // detik, pengemudi cadangan melihat ke mana mobil bergerak sejauh ini ke depan
  takeoverLatAccel: 7, // m/s^2, atau bila mobil menyentak ke samping sekeras ini (sekitar 0,7 g)
  flipSteer: 0.3, // rad, perintah setir sebesar ini dihitung "besar"
  flipCount: 2, // atau bila perintah setir besar berganti arah sebanyak ini
  flipWindow: 2, // detik, dalam rentang waktu ini
  takeoverHeading: 0.44, // rad (25 derajat), atau bila arah mobil menyimpang sebesar ini dari arah jalur
  takeoverLd: [0.6, 5, 12], // lookahead pengemudi cadangan: k (detik), batas bawah dan atas (m)
  takeoverBrake: 8, // m/s^2, pengemudi cadangan boleh mengerem lebih keras daripada pengendali (rem penuh)
  takeoverKmh: 25, // km/jam, kecepatan saat pengemudi cadangan mengemudi
  takeoverCrawlKmh: 8, // km/jam, selama mobil masih jauh dari jalur, pengemudi cadangan melambat sampai merayap
  takeoverMin: 2.5, // detik, lama minimum pengambilalihan
  takeoverBody: 2.3, // m, atau bila sudut bodi mobil akan sejauh ini dari jalur (badan jalan sekitar 5 m)
  recoverHorizon: 1.6, // detik, pengawas menghitung sejauh ini ke depan bila pengemudi cadangan mengambil alih sekarang
  zoneKmh: 20, // km/jam, batas kecepatan perencana di zona bundaran
  settleHold: 3, // detik, kecepatan harus tenang selama ini sebelum uji respons dianggap selesai
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

/** Mobil memotong tikungan ke sisi dalam (ciri Ld terlalu panjang)? `st` = state simulasi. */
export const cuttingInside = (st) => Math.abs(st.curvatureHere) > 0.01 && Math.sign(st.curvatureHere) === Math.sign(st.cte) && Math.abs(st.cte) >= 0.6;

/**
 * Pure pursuit klasik: titik tujuan adalah perpotongan lingkaran berjari-jari Ld (berpusat di
 * sumbu roda belakang) dengan jalur, di depan titik terdekat. Lalu
 *   delta = atan(2 L sin(alpha) / Ld).
 * Bila mobil lebih jauh dari Ld terhadap jalur, lingkaran tidak memotong jalur. Titik tujuan lalu
 * diambil sejauh Ld di sepanjang jalur dan rumus memakai jarak sebenarnya ke titik itu.
 */
export function pursuit(track, ra, heading, ld, near) {
  const path = track.ref;
  let target = null;
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
  const steer = clamp(Math.atan(CFG.wheelbase * curvature), -CFG.maxSteer, CFG.maxSteer);
  return { target, alpha, dist, curvature, steer };
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
  constructor() {
    this.h = 0.08; // histeresis (m)
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
export function createSim(track, { seed = 7 } = {}) {
  const C = CFG;
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
  const swing = new SwingDetector();
  const state = {}; // diisi placeAtStart() dan evaluate()

  const delaySteps = Math.max(0, Math.round(C.steerDelay * 60));
  const accelSteps = Math.max(0, Math.round(C.accelDelay * 60));
  let steerQueue = [];
  let accelQueue = [];
  const steerFlips = []; // waktu perintah setir besar berganti arah
  let lastBigSteer = 0;

  function placeAtStart() {
    const p = track.ref.sample(0);
    const L2 = C.wheelbase / 2;
    // sumbu roda belakang tepat di garis start, di tengah lajur
    ego.setPose(p.x + Math.cos(p.heading) * L2, p.y + Math.sin(p.heading) * L2, p.heading);
    ego.odometer = 0;
    rng.reseed(seed); // derau sensor sama setiap kali diulang
    steerQueue = new Array(delaySteps).fill(0);
    steerFlips.length = 0;
    lastBigSteer = 0;
    accelQueue = new Array(accelSteps).fill(0);
    pid.reset();
    swing.reset();
    Object.assign(state, {
      time: 0,
      s: 0, // posisi sepanjang jalur acuan (sumbu roda belakang)
      progress: 0, // jarak tempuh sepanjang jalur sejak mulai (tidak dibungkus)
      cte: 0, // galat lintasan (m), positif = di kanan jalur acuan
      pp: null, // hasil pure pursuit terakhir
      steerCmd: 0,
      steerDelayed: 0,
      aCmd: 0,
      aAct: 0,
      vMeas: 0,
      latAccel: 0,
      lastLap: null, // putaran penuh terakhir { rms, max, avgKmh, time, ... }
      laps: 0,
      episode: null, // uji respons kecepatan terakhir
      trail: [], // jejak sumbu roda belakang { x, y, cte }
      takeover: null, // { time, at, ld, targetKmh, kmh, reason, inside, s } saat pengemudi cadangan mengemudi
      lastTakeover: null,
      takeovers: 0,
      headingError: 0,
    });
    state.lap = newLap(); // putaran yang sedang diukur
    startEpisode(true);
    evaluate();
  }

  function newLap() {
    return { start: state.progress, startTime: state.time, sumSq: 0, sumW: 0, max: 0, dist: 0, takeover: !!state.takeover, settings: snapshot() };
  }

  const snapshot = () => ({ ld: settings.ld, adaptive: settings.adaptive, k: settings.k, targetKmh: settings.targetKmh, curveSlow: settings.curveSlow });

  function ldNow() {
    if (settings.adaptive) return clamp(settings.k * ego.speed, C.ldAdaptiveMin, C.ldMax);
    return clamp(settings.ld, C.ldMin, C.ldMax);
  }

  /**
   * Kecepatan acuan: target, tetapi selalu paling tinggi C.zoneKmh di zona bundaran (mobil sudah
   * melambat pelan-pelan sebelum masuk), dan bila "pelan di tikungan" menyala, juga lebih pelan
   * menjelang dan di dalam setiap tikungan.
   */
  function speedRef() {
    const vSet = settings.targetKmh * KMH;
    const vZone = C.zoneKmh * KMH;
    let v = vSet;
    state.zoneLimited = false;
    if (vSet > vZone) {
      for (let d = 0; d <= 90; d += 1.5) {
        if (!zoneAt(track, state.s + d)) continue;
        const vz = Math.sqrt(vZone * vZone + 2 * C.comfortDecel * d);
        if (vz < v) {
          v = vz;
          state.zoneLimited = true;
        }
        break;
      }
    }
    if (!settings.curveSlow) return v;
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
      settledSince: null,
      done: false,
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
    if (!ep || ep.done) return;
    const v = ego.speed;
    if (settings.curveSlow) spoilEpisode('tikungan');
    // perencana menurunkan kecepatan acuan menjelang bundaran sebelum uji selesai: uji terganggu
    if (state.zoneLimited) spoilEpisode('bundaran');
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
    // uji selesai: kecepatan sudah tenang di dekat target selama C.settleHold detik. Hasilnya
    // dibekukan, jadi perlambatan di bundaran sesudahnya tidak mengubah angka overshoot.
    if (ep.settledSince != null && state.time - ep.settledSince >= C.settleHold) ep.done = true;
  }

  /**
   * Pengawas menghitung apa yang terjadi bila pengemudi cadangan mengambil alih SEKARANG: model
   * sepeda kinematik yang sama dijalankan maju C.recoverHorizon detik dengan setir dan rem pengemudi
   * cadangan (setir langsung dan dua kali lebih cepat, rem sampai merayap). Setir yang sedang
   * terbanting ke arah yang salah butuh waktu untuk berbalik, dan selama itu mobil masih bergeser.
   * Hasil: { axle, body } = simpangan terbesar sumbu roda belakang dan sudut bodi dari jalur (m).
   */
  function recoveryExcursion() {
    const h = 1 / 20;
    const lr = C.wheelbase / 2;
    const [kLd, minLd, maxLd] = C.takeoverLd;
    const box = { x: ego.x, y: ego.y, heading: ego.heading, length: ego.length, width: ego.width };
    let v = ego.speed;
    let steer = ego.steer;
    let a = state.aAct;
    let sHint = state.s;
    let axle = 0;
    let body = 0;
    for (let t = 0; t <= C.recoverHorizon; t += h) {
      const ra = { x: box.x - Math.cos(box.heading) * lr, y: box.y - Math.sin(box.heading) * lr };
      const near = closestNear(track.ref, ra.x, ra.y, sHint, 14);
      sHint = near.s;
      axle = Math.max(axle, Math.abs(near.lateral));
      for (const p of boxCorners(box)) body = Math.max(body, Math.abs(closestNear(track.ref, p.x, p.y, sHint + lr, 12).lateral));
      if (axle > C.takeoverCte || body > C.takeoverBody) break;
      const pp = pursuit(track, ra, box.heading, clamp(kLd * v, minLd, maxLd), near);
      const v0 = Math.max(v, 0.1);
      const grip = Math.min(C.maxSteer, Math.atan((C.wheelbase * C.gripAccel) / (v0 * v0)));
      steer = approach(steer, clamp(pp.steer, -grip, grip), 2 * C.steerRate * h);
      // rem baru bekerja sesudah jeda aktuator
      const aCmd = t < C.accelDelay ? a : clamp(1.5 * (C.takeoverCrawlKmh * KMH - v), -C.takeoverBrake, C.accelMax);
      a += (aCmd - a) * (1 - Math.exp(-h / C.accelLag));
      v = Math.max(0, v + (a - C.aero * v * v - (v > 0.01 ? C.rolling : 0)) * h);
      const beta = Math.atan(0.5 * Math.tan(steer));
      box.x += v * Math.cos(box.heading + beta) * h;
      box.y += v * Math.sin(box.heading + beta) * h;
      box.heading += (v / lr) * Math.sin(beta) * h;
    }
    return { axle, body };
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
    state.vRef = speedRef();
    if (state.takeover) {
      // pengemudi cadangan memegang setir sendiri (tanpa jeda aktuator, jadi lookahead sedang pun stabil)
      // dan melaju pelan
      const [kLd, minLd, maxLd] = C.takeoverLd;
      const safeLd = clamp(kLd * ego.speed, minLd, maxLd);
      state.safePp = pursuit(track, ra, ego.heading, safeLd, near);
      // selama mobil masih jauh dari jalur atau miring, pengemudi cadangan mengerem sampai merayap
      const offLine = Math.abs(near.lateral) > 0.8 || Math.abs(state.headingError) > 0.2;
      state.vRef = Math.min(state.vRef, (offLine ? C.takeoverCrawlKmh : C.takeoverKmh) * KMH);
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
    if (state.takeover) {
      // pengemudi cadangan memegang setir langsung: tanpa jeda aktuator dan memutar lebih cepat
      steerQueue.fill(state.steerCmd);
      state.steerDelayed = state.steerCmd;
      ego.steerRate = C.steerRate * 2;
    } else {
      steerQueue.push(state.steerCmd);
      state.steerDelayed = steerQueue.length > delaySteps ? steerQueue.shift() : state.steerDelayed;
      ego.steerRate = C.steerRate;
      // catat saat perintah setir besar berganti arah (kiri penuh lalu kanan penuh): ciri ayunan
      if (Math.abs(state.steerCmd) >= C.flipSteer) {
        const sign = Math.sign(state.steerCmd);
        if (lastBigSteer && sign !== lastBigSteer) steerFlips.push(state.time);
        lastBigSteer = sign;
      }
      while (steerFlips.length && steerFlips[0] < state.time - C.flipWindow) steerFlips.shift();
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
    if (state.progress - lap.start >= L) {
      const time = state.time - lap.startTime;
      state.lastLap = {
        rms: Math.sqrt(lap.sumSq / Math.max(1e-6, lap.sumW)),
        max: lap.max,
        time,
        avgKmh: (lap.dist / Math.max(1e-6, time)) * 3.6,
        settings: lap.settings,
        takeover: lap.takeover,
        endTime: state.time,
        index: ++state.laps,
      };
      state.lap = newLap();
    }

    // pengawas: mobil terlalu jauh dari jalur, pengemudi cadangan mengambil alih
    const swerving = ego.speed > 3 && Math.abs(state.headingError) > C.takeoverHeading;
    // galat yang diperkirakan sesaat lagi: galat sekarang ditambah laju menyampingnya
    const ctePredicted = state.cte + ego.speed * Math.sin(state.headingError) * C.takeoverPredict;
    // mobil menyentak ke samping jauh lebih keras daripada yang dibutuhkan jalan (ciri ayunan)
    const jerky = Math.abs(state.latAccel) > C.takeoverLatAccel;
    const flipping = steerFlips.length >= C.flipCount;
    // Bila menunggu lebih lama, pengemudi cadangan tidak sempat lagi menahan mobil di badan jalan.
    // Hanya dihitung saat mobil tidak tenang di jalurnya (hemat hitungan).
    const calm = Math.abs(state.cte) < 0.25 && Math.abs(state.headingError) < 0.07 && Math.abs(ego.steer - Math.atan(C.wheelbase * state.curvatureHere)) < 0.1;
    const recovery = state.takeover || calm ? null : recoveryExcursion();
    const lateTakeover = !!recovery && (recovery.axle > C.takeoverCte || recovery.body > C.takeoverBody);
    const reason = Math.abs(state.cte) > C.takeoverCte
      ? 'galat'
      : Math.abs(ctePredicted) > C.takeoverCte || lateTakeover
        ? 'arah-galat'
        : swerving
          ? 'arah'
          : jerky
            ? 'sentakan'
            : flipping
              ? 'setir'
              : null;
    if (!state.takeover && reason) {
      // inside: mobil sedang memotong tikungan saat diambil alih
      state.takeover = { time: 0, at: state.time, ld: state.ldEff, targetKmh: settings.targetKmh, kmh: ego.speed * 3.6, reason, inside: cuttingInside(state), s: state.s };
      state.lastTakeover = state.takeover;
      state.takeovers++;
      state.lap.takeover = true;
      spoilEpisode('cadangan');
    } else if (state.takeover) {
      state.takeover.time += dt;
      if (state.takeover.time > C.takeoverMin && Math.abs(state.cte) < 0.3 && Math.abs(state.headingError) < 0.06) {
        state.takeover = null;
        steerFlips.length = 0;
        lastBigSteer = 0;
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
      if (tr.length > 2300) tr.splice(0, tr.length - 2300);
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
    reset: placeAtStart,
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
  };
}
