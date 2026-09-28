// Model fisika satu dimensi untuk pelajaran Jarak Aman dan Rem Darurat.
//
// Semua posisi diukur sepanjang lajur dalam meter (x bertambah ke arah depan).
// Mobilmu diwakili bemper depannya, mobil depan dan mobil mogok diwakili bemper belakangnya,
// jadi jarak bersih = x target dikurangi x mobilmu.
//
// Penyederhanaan yang disengaja (disebutkan juga di teks pelajaran):
//   - rem langsung mencapai perlambatan yang diminta, tanpa jeda penumpukan tekanan rem;
//   - perlambatan maksimum = mu * g (ABS mencegah roda terkunci), sama untuk kedua mobil;
//   - sebelum kejadian, ACC menjaga jarak waktu dengan sempurna;
//   - peringatan FCW tidak mempercepat reaksi pengemudi;
//   - AEB bereaksi seketika saat TTC melewati ambang, tanpa jeda deteksi;
//   - setelah benturan simulasi berhenti, tabrakannya sendiri tidak dimodelkan.
//
// File ini tidak menyentuh DOM, jadi bisa diuji langsung dengan node.

export const G = 9.8; // m/s^2
export const DT = 1 / 60;
export const CAR_LENGTH = 4.5;
// Toleransi sentuh (m). Bila jarak waktu tepat sama dengan waktu reaksi, kedua mobil berhenti
// dengan bemper bersentuhan pada kecepatan relatif nol. Itu dihitung sebagai berhenti dengan sisa
// 0 m, tidak sebagai benturan 0 km/jam akibat galat pembulatan.
const CONTACT_EPS = 1e-6;

// Koefisien gesek ban dengan jalan (perkiraan kasar).
export const ROADS = {
  kering: { label: 'Kering', mu: 0.8 },
  basah: { label: 'Basah', mu: 0.5 },
  licin: { label: 'Licin', mu: 0.25 },
};
export const ROAD_IDS = ['kering', 'basah', 'licin'];

// Waktu reaksi: 1,5 detik untuk manusia (nilai yang umum dipakai), 0,3 detik untuk sistem (ilustrasi).
export const REACTIONS = {
  manusia: { label: 'Pengemudi manusia', short: 'Manusia', t: 1.5 },
  sistem: { label: 'Sistem otomatis', short: 'Sistem', t: 0.3 },
};

// Ambang AEB (contoh). Tahap: 0 siaga, 1 peringatan, 2 rem sebagian, 3 rem penuh.
export const AEB_TTC = { fcw: 2.5, partial: 1.6, full: 1.0 };
export const AEB_PARTIAL = 0.5; // rem sebagian = setengah dari rem penuh
export const AEB_STAGES = ['siaga', 'peringatan', 'rem sebagian', 'rem penuh'];

// Skenario
export const PRE_ROLL = 0.6; // detik mengikuti dulu sebelum mobil depan mengerem
export const LANE_CHANGE = 2.0; // lama mobil depan pindah lajur (detik)
export const LANE_OFFSET = 3.5; // jarak antarpusat lajur (m)
export const REVEAL_LAT = 1.9; // rintangan terlihat saat mobil depan sudah bergeser sejauh ini (m)
export const OBSTACLE_AHEAD = 1.0; // mobil mogok berada 1 detik perjalanan di depan mobil depan

const smooth = (f) => {
  const t = Math.min(1, Math.max(0, f));
  return t * t * (3 - 2 * t);
};

/** Waktu sejak mobil depan mulai pindah lajur sampai rintangan terlihat (detik). */
export const REVEAL_TIME = (() => {
  let lo = 0;
  let hi = 1;
  const want = REVEAL_LAT / LANE_OFFSET;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (smooth(mid) < want) lo = mid;
    else hi = mid;
  }
  return Math.round(((lo + hi) / 2) * LANE_CHANGE / DT) * DT;
})();

/** Pergeseran samping mobil depan (m) setelah s detik pindah lajur. */
export const laneShift = (s) => LANE_OFFSET * smooth(s / LANE_CHANGE);

/**
 * Jarak henti d = v * tr + v^2 / (2 * mu * g).
 * @returns {{decel, reaction, braking, total}}
 */
export function stoppingDistance(v, tr, mu) {
  const decel = mu * G;
  const reaction = v * tr;
  const braking = (v * v) / (2 * decel);
  return { decel, reaction, braking, total: reaction + braking };
}

/** Jarak rintangan saat terlihat, untuk kecepatan v dan jarak waktu tau. */
export const obstacleDistance = (v, tau) => v * tau + CAR_LENGTH + v * OBSTACLE_AHEAD;

/** Gerak dengan perlambatan tetap selama dt, berhenti tepat di 0 (tidak mundur). */
function advance(x, v, decel, dt) {
  if (decel <= 0 || v <= 0) return [x + v * dt, v];
  const tStop = v / decel;
  if (tStop <= dt) return [x + (v * v) / (2 * decel), 0];
  return [x + v * dt - 0.5 * decel * dt * dt, v - decel * dt];
}

/** TTC = jarak / kecepatan mendekat. Tak terhingga bila tidak mendekat. */
export function ttcOf(gap, closing) {
  if (closing <= 0.05) return Infinity;
  return Math.max(0, gap) / closing;
}

/**
 * Buat satu percobaan.
 * @param {object} p { v (m/s), tau (detik), mu, tr (detik), aeb (bool) }
 * @param {'rem'|'rintangan'} scenario
 * @param {number} x0 posisi bemper depan mobilmu saat tombol ditekan
 */
export function createRun(p, scenario, x0 = 0) {
  const a = p.mu * G;
  const gap = p.v * p.tau;
  const pre = scenario === 'rintangan' ? REVEAL_TIME : PRE_ROLL;
  const preSteps = Math.round(pre / DT);
  const run = {
    scenario,
    p: { ...p },
    a,
    k: 0,
    preSteps,
    t: -preSteps * DT,
    ego: { x: x0, v: p.v, decel: 0 },
    lead: { x: x0 + gap, v: p.v, decel: 0, lat: 0, yaw: 0 },
    obstacle: null,
    x0,
    eventX: x0 + p.v * preSteps * DT, // bemper depan mobilmu saat kejadian
    eventGap: gap,
    driverBraking: false,
    brakeStart: null, // { t, x } saat mobilmu mulai melambat
    driverStart: null, // { t, x } saat pengemudi atau sistem mulai mengerem penuh
    aebStage: 0,
    aebTimes: {},
    minGap: Infinity,
    done: false,
    outcome: null,
  };
  if (scenario === 'rintangan') {
    const d0 = obstacleDistance(p.v, p.tau);
    run.obstacle = { x: run.eventX + d0, v: 0 };
    run.eventGap = d0;
  }
  return run;
}

/** Objek di lajurmu yang sedang diperhatikan (mobil depan, atau mobil mogok setelah terlihat). */
export function targetOf(run) {
  if (run.scenario === 'rintangan' && run.t >= -1e-9) return run.obstacle;
  return run.lead;
}

/** Jarak bersih dan TTC ke target saat ini. */
export function measure(run) {
  const tgt = targetOf(run);
  const gap = tgt.x - run.ego.x;
  const closing = run.ego.v - tgt.v;
  return { gap, closing, ttc: ttcOf(gap, closing), target: tgt };
}

/**
 * Maju satu langkah waktu. ghost = true mengabaikan benturan (dipakai untuk mencari titik henti).
 */
export function stepRun(run, dt = DT, { ghost = false } = {}) {
  if (run.done) return run;
  const { a, p, ego, lead } = run;
  const t = run.t;
  const afterEvent = t >= -1e-9;

  // mobil depan
  if (run.scenario === 'rem' && afterEvent) lead.decel = a;
  const [lx, lv] = advance(lead.x, lead.v, lead.decel, dt);
  if (run.scenario === 'rintangan') {
    const s0 = run.k * dt;
    const s1 = (run.k + 1) * dt;
    lead.lat = laneShift(s1);
    lead.yaw = Math.atan2(laneShift(s1) - laneShift(s0), Math.max(0.5, lead.v) * dt);
  }

  // keputusan rem mobilmu, dari keadaan di awal langkah
  const tgt = targetOf(run);
  let driverDecel = 0;
  if (afterEvent && t >= p.tr - 1e-9) {
    driverDecel = a;
    if (!run.driverBraking) {
      run.driverBraking = true;
      run.driverStart = { t, x: ego.x };
    }
  }
  let aebDecel = 0;
  if (p.aeb) {
    const gap = tgt.x - ego.x;
    const ttc = gap <= 0 ? 0 : ttcOf(gap, ego.v - tgt.v);
    const stage = ttc < AEB_TTC.full ? 3 : ttc < AEB_TTC.partial ? 2 : ttc < AEB_TTC.fcw ? 1 : 0;
    if (stage > run.aebStage && ego.v > 0) {
      for (let s = run.aebStage + 1; s <= stage; s++) run.aebTimes[s] = { t, x: ego.x };
      run.aebStage = stage;
    }
    aebDecel = run.aebStage === 3 ? a : run.aebStage === 2 ? a * AEB_PARTIAL : 0;
  }
  ego.decel = Math.min(a, Math.max(driverDecel, aebDecel));
  if (ego.decel > 0 && !run.brakeStart && ego.v > 0) run.brakeStart = { t, x: ego.x };
  const [ex, ev] = advance(ego.x, ego.v, ego.decel, dt);

  // target baru (mobil mogok diam)
  const tgtX1 = tgt === lead ? lx : tgt.x;
  const tgtV1 = tgt === lead ? lv : tgt.v;

  if (!ghost && tgtX1 - ex < -CONTACT_EPS) {
    // benturan di dalam langkah ini: cari waktu sentuh dengan bagi dua
    let lo = 0;
    let hi = dt;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      const e = advance(ego.x, ego.v, ego.decel, mid)[0];
      const g = tgt === lead ? advance(lead.x, lead.v, lead.decel, mid)[0] : tgt.x;
      if (g - e > 0) lo = mid;
      else hi = mid;
    }
    const s = hi;
    const [ex2, ev2] = advance(ego.x, ego.v, ego.decel, s);
    const [lx2, lv2] = advance(lead.x, lead.v, lead.decel, s);
    ego.x = ex2;
    ego.v = ev2;
    lead.x = lx2;
    lead.v = lv2;
    if (tgt !== lead) ego.x = Math.min(ego.x, tgt.x);
    else ego.x = Math.min(ego.x, lead.x);
    run.t = t + s;
    run.k += 1;
    run.minGap = 0;
    const closing = ego.v - (tgt === lead ? lead.v : tgt.v);
    finish(run, { collided: true, impact: Math.max(0, closing), egoSpeed: ego.v });
    return run;
  }

  ego.x = ex;
  ego.v = ev;
  lead.x = lx;
  lead.v = lv;
  run.k += 1;
  run.t = t + dt;
  const left = Math.max(0, tgtX1 - ex);
  if (run.t >= -1e-9) run.minGap = Math.min(run.minGap, left);

  // selesai bila mobilmu sudah berhenti dan target tidak lagi mendekat
  if (run.t > 0 && ego.v <= 0 && tgtV1 <= 1e-6) {
    finish(run, { collided: false, remaining: left });
  } else if (run.t > 0 && ego.v <= 0 && run.scenario === 'rintangan') {
    finish(run, { collided: false, remaining: left });
  } else if (run.t > 90) {
    finish(run, { collided: false, remaining: left, timeout: true });
  }
  return run;
}

function finish(run, o) {
  run.done = true;
  run.outcome = {
    ...o,
    scenario: run.scenario,
    t: run.t,
    minGap: run.minGap,
    eventGap: run.eventGap,
    tau: run.p.tau,
    aeb: run.p.aeb,
    aebMax: run.aebStage,
    aebTimes: { ...run.aebTimes },
    brakeStart: run.brakeStart,
    driverStart: run.driverStart,
    stopX: run.ego.x,
  };
}

/** Jalankan satu percobaan sampai selesai dan kembalikan run terakhir. */
export function simulate(p, scenario, opts = {}) {
  const run = createRun(p, scenario, 0);
  let n = 0;
  while (!run.done && n < 20000) {
    stepRun(run, DT, opts);
    n++;
  }
  return run;
}

/**
 * Jarak waktu terkecil (detik) agar percobaan selesai tanpa benturan, dengan pengaturan lain tetap.
 * Mengembalikan Infinity bila 12 detik pun belum cukup.
 */
export function neededGap(p, scenario) {
  const safe = (tau) => !simulate({ ...p, tau }, scenario).outcome.collided;
  if (!safe(12)) return Infinity;
  if (safe(0.05)) return 0.05;
  let lo = 0.05;
  let hi = 12;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (safe(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

/**
 * Jarak waktu terkecil pada kelipatan 0,1 detik (langkah slider) yang benar-benar tanpa benturan.
 * Mengembalikan 0 bila jarak berapa pun cukup, dan Infinity bila 12 detik pun belum cukup.
 */
export function neededGapStep(p, scenario) {
  const x = neededGap(p, scenario);
  if (!Number.isFinite(x)) return x;
  if (x <= 0.05) return 0;
  let n = Math.max(1, Math.floor(x * 10 + 1e-6));
  while (n < 120 && simulate({ ...p, tau: n / 10 }, scenario).outcome.collided) n++;
  return n / 10;
}
