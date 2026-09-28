// Model fisika satu dimensi untuk pelajaran Jarak Aman dan Rem Darurat.
//
// Semua posisi diukur sepanjang lajur dalam meter (x bertambah ke arah depan).
// Mobilmu diwakili bemper depannya, mobil depan (atau angkot) dan mobil mogok diwakili bemper
// belakangnya, jadi jarak bersih = x target dikurangi x mobilmu.
// Posisi samping (lat) diukur dari tengah lajur kiri, lajur mobilmu: negatif ke arah trotoar
// (kiri), positif ke arah lajur kanan.
//
// Penyederhanaan yang disengaja (disebutkan juga di teks pelajaran):
//   - rem langsung mencapai perlambatan yang diminta, tanpa jeda penumpukan tekanan rem;
//   - perlambatan maksimum = mu * g (ABS mencegah roda terkunci), sama untuk semua kendaraan;
//   - sebelum kejadian, ACC menjaga jarak waktu dengan sempurna;
//   - peringatan FCW tidak mempercepat reaksi pengemudi;
//   - AEB bereaksi seketika saat TTC melewati ambang, tanpa jeda deteksi;
//   - setelah benturan simulasi berhenti, tabrakannya sendiri tidak dimodelkan.
//
// Perisai keselamatan (safety.js) ikut dijalankan tiap langkah untuk mobilmu dan kendaraan di
// depannya, setelah keputusan pengemudi, ACC, dan AEB. Perisai hanya menjaga pejalan kaki. Di
// pelajaran ini pejalan kaki tidak pernah masuk ke koridor kendaraan, jadi perisai tidak mengubah
// hasil percobaan; tabrakan dengan mobil depan, angkot, atau mobil mogok tetap bisa terjadi.
//
// File ini tidak menyentuh DOM, jadi bisa diuji langsung.

import { SAFETY, pedConstraint, shieldDecel, gapAccepted } from './safety.js';

export const G = 9.8; // m/s^2
export const DT = 1 / 60;
export const CAR_LENGTH = 4.5;
export const CAR_WIDTH = 1.8;
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
export const ANGKOT_PRE = 1.2; // detik mengikuti angkot sebelum ia berhenti (calon penumpang terlihat)
export const LANE_CHANGE = 2.0; // lama mobil depan pindah lajur (detik)
export const LANE_OFFSET = 3.5; // jarak antarpusat lajur (m)
export const REVEAL_LAT = 1.9; // rintangan terlihat saat mobil depan sudah bergeser sejauh ini (m)
export const OBSTACLE_AHEAD = 1.0; // mobil mogok berada 1 detik perjalanan di depan mobil depan

// Jalan Soekarno-Hatta, Malang: batas kecepatan 50 km/jam dan 2 lajur per arah (jalur terpisah)
// menurut tag maxspeed, lanes, dan oneway di OpenStreetMap (js/data/malang-roads.json). Angkot
// tidak masuk jalan tol, jadi skenario angkot hanya berjalan sampai kecepatan ini.
export const CITY_MAX_KMH = 50;

// Angkot (ukuran SIZES.angkot). Saat berjalan ia menepi sedikit ke kiri, saat berhenti untuk
// menaikkan penumpang ia merapat ke trotoar sambil mengerem.
export const ANGKOT = Object.freeze({ length: 4.1, width: 1.62, cruiseLat: -0.7, stopLat: -0.9, doorAt: 0.59 });

// Trotoar dan calon penumpang (posisi samping dari tengah lajur kiri).
export const PED_RADIUS = SAFETY.pedRadius;
export const PASSENGER = Object.freeze({
  waitLat: -3.1, // menunggu di trotoar, sekitar 1,25 m dari kerb
  waitAhead: 0.8, // sedikit di depan pintu angkot
  doorGap: 0.05, // berhenti 5 cm dari sisi angkot, lalu naik
  walkSpeed: 1.2, // m/s
  doorDelay: 0.35, // pintu dibuka setelah angkot diam sekian detik
  walkDelay: 0.7, // penumpang melangkah setelah angkot diam sekian detik
  boardTime: 0.6, // lama naik ke dalam angkot
  closeDelay: 0.5, // pintu ditutup setelah penumpang di dalam
});

const smooth = (f) => {
  const t = Math.min(1, Math.max(0, f));
  return t * t * (3 - 2 * t);
};
const smoothSlope = (f) => (f <= 0 || f >= 1 ? 0 : 6 * f * (1 - f));

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
 * @param {'rem'|'rintangan'|'angkot'} scenario
 * @param {number} x0 posisi bemper depan mobilmu saat tombol ditekan
 */
export function createRun(p, scenario, x0 = 0) {
  const a = p.mu * G;
  const gap = p.v * p.tau;
  const pre = scenario === 'rintangan' ? REVEAL_TIME : scenario === 'angkot' ? ANGKOT_PRE : PRE_ROLL;
  const preSteps = Math.round(pre / DT);
  const angkot = scenario === 'angkot';
  const run = {
    scenario,
    p: { ...p },
    a,
    k: 0,
    preSteps,
    t: -preSteps * DT,
    ego: { x: x0, v: p.v, decel: 0 },
    lead: {
      x: x0 + gap,
      v: p.v,
      decel: 0,
      lat: angkot ? ANGKOT.cruiseLat : 0,
      yaw: 0,
      kind: angkot ? 'angkot' : 'car',
      length: angkot ? ANGKOT.length : CAR_LENGTH,
      width: angkot ? ANGKOT.width : CAR_WIDTH,
      brakeX0: null,
      stopped: 0,
      door: 0,
    },
    obstacle: null,
    ped: null,
    extraPeds: [], // pejalan kaki lain dari pelajaran (trotoar), dalam koordinat lajur
    x0,
    eventX: x0 + p.v * preSteps * DT, // bemper depan mobilmu saat kejadian
    eventGap: gap,
    driverBraking: false,
    brakeStart: null, // { t, x } saat mobilmu mulai melambat
    driverStart: null, // { t, x } saat pengemudi atau sistem mulai mengerem penuh
    aebStage: 0,
    aebTimes: {},
    minGap: Infinity,
    shieldActs: 0,
    clamps: 0,
    done: false,
    outcome: null,
  };
  if (scenario === 'rintangan') {
    const d0 = obstacleDistance(p.v, p.tau);
    run.obstacle = { x: run.eventX + d0, v: 0 };
    run.eventGap = d0;
  }
  if (angkot) {
    // titik henti angkot sudah pasti: mengerem mu * g sejak kejadian
    const leadEventX = x0 + gap + p.v * preSteps * DT;
    const doorX = leadEventX + (p.v * p.v) / (2 * a) + ANGKOT.length * ANGKOT.doorAt;
    run.ped = {
      id: 'penumpang',
      r: PED_RADIUS,
      x: doorX + PASSENGER.waitAhead,
      lat: PASSENGER.waitLat,
      heading: Math.PI / 2, // menghadap jalan
      state: 'tunggu', // 'tunggu' | 'jalan' | 'naik' | 'dalam'
      t: 0,
      walked: 0,
      alpha: 1,
      board: { x: doorX, lat: boardLat(ANGKOT.stopLat) },
    };
  }
  return run;
}

/** Posisi samping tempat penumpang berhenti di depan pintu angkot. */
function boardLat(angkotLat) {
  return angkotLat - ANGKOT.width / 2 - PASSENGER.doorGap - PED_RADIUS;
}

/** Objek di lajurmu yang sedang diperhatikan (mobil depan, angkot, atau mobil mogok setelah terlihat). */
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

// ---------- pejalan kaki dan perisai ----------

/** Titik-titik lurus dari a ke b setiap `step` meter (untuk uji koridor). */
function segmentPoints(a, b, step = 0.25) {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(1, Math.ceil(d / step));
  const out = [];
  for (let i = 0; i <= n; i++) out.push({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n });
  return out;
}

/** Posisi penumpang sekarang dan (bila belum naik) titik-titik jalurnya ke pintu angkot. */
function passengerPoints(ped, withPath) {
  if (!ped || ped.state === 'dalam') return [];
  const here = { x: ped.x, y: ped.lat };
  if (!withPath || ped.state === 'naik') return [here];
  return segmentPoints(here, { x: ped.board.x, y: ped.board.lat });
}

/** Kendaraan dalam bentuk yang dipakai perisai (koordinat lajur: y = lat). */
function egoVeh(run) {
  return { id: 'mobilmu', front: run.ego.x, length: CAR_LENGTH, y: 0, halfW: CAR_WIDTH / 2, dir: 1, v: run.ego.v, a: run.a };
}
function leadVeh(run) {
  const l = run.lead;
  // Koridor kendaraan depan mencakup seluruh gerak sampingnya yang sudah diketahui: angkot merapat
  // ke trotoar, mobil depan di skenario rintangan pindah ke lajur kanan. Saat kendaraan sedikit
  // berbelok, sudut depannya menjorok lebih jauh ke depan dan ke samping; itu ikut dihitung.
  const target = run.scenario === 'angkot' ? ANGKOT.stopLat : run.scenario === 'rintangan' ? LANE_OFFSET : l.lat;
  const c = Math.cos(l.yaw);
  const s = Math.abs(Math.sin(l.yaw));
  const cx = l.x + l.length / 2;
  const front = cx + (l.length / 2) * c + (l.width / 2) * s;
  const corner = Math.max(0, (l.length / 2) * s - (l.width / 2) * (1 - c));
  const halfW = Math.abs(l.lat - target) / 2 + l.width / 2 + corner;
  return { id: l.kind, front, length: front - l.x, y: (l.lat + target) / 2, halfW, dir: 1, v: l.v, a: run.a };
}

/**
 * Pejalan kaki yang harus dihindari satu kendaraan. Untuk mobilmu dan kendaraan lain jalur penumpang
 * dihitung penuh (prakiraan konservatif). Angkot yang ditunggu hanya melihat posisi penumpang
 * sekarang: penumpang baru melangkah setelah angkot diam, dan selama ia berjalan atau naik,
 * angkot harus tetap diam.
 */
function pedsFor(run, who) {
  const list = [];
  const ped = run.ped;
  if (ped && ped.state !== 'dalam') {
    if (who === 'lead' && (ped.state === 'jalan' || ped.state === 'naik')) {
      list.push({ r: ped.r, points: [{ x: run.lead.x + run.lead.length * 0.5, y: run.lead.lat }] }); // tahan di tempat
    } else {
      list.push({ r: ped.r, points: passengerPoints(ped, who !== 'lead') });
    }
  }
  for (const e of run.extraPeds) list.push(e);
  return list;
}

/** Perisai untuk satu kendaraan: naikkan perlambatan bila perlu. Hasil: batas maju (m). */
function applyShield(run, who, body, dt) {
  const veh = who === 'ego' ? egoVeh(run) : leadVeh(run);
  const con = pedConstraint(veh, pedsFor(run, who));
  if (!Number.isFinite(con.hard)) return Infinity;
  const sd = shieldDecel(body.v, body.decel, con.D, run.a, dt);
  if (sd.limited) {
    body.decel = sd.decel;
    run.shieldActs += 1;
  }
  return con.hard;
}

/**
 * Langkah calon penumpang angkot. Dipanggil oleh stepRun, dan oleh pelajaran setelah percobaan
 * selesai (supaya penumpang tetap naik walau mobilmu sudah berhenti).
 */
export function stepPassenger(run, dt = DT) {
  const ped = run.ped;
  if (!ped) return;
  const lead = run.lead;
  const stopped = run.t >= -1e-9 && lead.brakeX0 !== null && lead.v <= 0;
  lead.stopped = stopped ? lead.stopped + dt : 0;
  const doorWanted = stopped && lead.stopped >= PASSENGER.doorDelay && !(ped.state === 'dalam' && ped.t >= PASSENGER.closeDelay);
  lead.door = Math.max(0, Math.min(1, lead.door + (doorWanted ? dt : -dt) / 0.3));
  const collided = !!(run.outcome && run.outcome.collided);
  if (ped.state === 'tunggu') {
    if (stopped && lead.stopped >= PASSENGER.walkDelay && lead.door >= 1 && !collided) {
      // titik naik dari posisi angkot yang sebenarnya
      ped.board = { x: lead.x + lead.length * ANGKOT.doorAt, lat: boardLat(lead.lat) };
      const path = segmentPoints({ x: ped.x, y: ped.lat }, { x: ped.board.x, y: ped.board.lat });
      // penerimaan celah: kendaraan lain yang koridornya memotong jalur harus masih bisa berhenti
      const others = [egoVeh(run)];
      if (gapAccepted(path, others, ped.r)) {
        ped.state = 'jalan';
        ped.t = 0;
      }
    }
    return;
  }
  if (ped.state === 'jalan') {
    const dx = ped.board.x - ped.x;
    const dy = ped.board.lat - ped.lat;
    const d = Math.hypot(dx, dy);
    const step = PASSENGER.walkSpeed * dt;
    if (d <= step) {
      ped.x = ped.board.x;
      ped.lat = ped.board.lat;
      ped.state = 'naik';
      ped.t = 0;
    } else {
      ped.x += (dx / d) * step;
      ped.lat += (dy / d) * step;
      ped.heading = Math.atan2(dy, dx);
    }
    ped.walked += Math.min(step, d);
    return;
  }
  ped.t += dt;
  if (ped.state === 'naik') {
    ped.heading = Math.PI / 2;
    ped.alpha = Math.max(0, 1 - ped.t / PASSENGER.boardTime);
    if (ped.t >= PASSENGER.boardTime) {
      ped.state = 'dalam';
      ped.t = 0;
      ped.alpha = 0;
    }
  }
}

/**
 * Maju satu langkah waktu. ghost = true mengabaikan benturan (dipakai untuk mencari titik henti).
 */
export function stepRun(run, dt = DT, { ghost = false } = {}) {
  if (run.done) return run;
  const { a, p, ego, lead } = run;
  const t = run.t;
  const afterEvent = t >= -1e-9;

  stepPassenger(run, dt);

  // mobil depan atau angkot: rem penuh setelah kejadian, lalu perisai
  if ((run.scenario === 'rem' || run.scenario === 'angkot') && afterEvent) {
    lead.decel = a;
    if (lead.brakeX0 === null) lead.brakeX0 = lead.x;
  }
  const leadHard = applyShield(run, 'lead', lead, dt);
  let [lx, lv] = advance(lead.x, lead.v, lead.decel, dt);
  if (lx - lead.x > leadHard) {
    lx = lead.x + Math.max(0, leadHard);
    lv = 0;
    run.clamps += 1;
  }
  if (run.scenario === 'rintangan') {
    const s0 = run.k * dt;
    const s1 = (run.k + 1) * dt;
    lead.lat = laneShift(s1);
    lead.yaw = Math.atan2(laneShift(s1) - laneShift(s0), Math.max(0.5, lead.v) * dt);
  } else if (run.scenario === 'angkot' && lead.brakeX0 !== null) {
    // merapat ke trotoar sepanjang jarak pengeremannya
    const brakeDist = Math.max(1e-6, (p.v * p.v) / (2 * a));
    const u = (lx - lead.brakeX0) / brakeDist;
    const span = ANGKOT.stopLat - ANGKOT.cruiseLat;
    lead.lat = ANGKOT.cruiseLat + span * smooth(u);
    lead.yaw = lv > 0 ? Math.atan((span * smoothSlope(u)) / brakeDist) : 0;
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
  // perisai keselamatan: lapisan terakhir sebelum gerak dijalankan
  const egoHard = applyShield(run, 'ego', ego, dt);
  if (ego.decel > 0 && !run.brakeStart && ego.v > 0) run.brakeStart = { t, x: ego.x };
  let [ex, ev] = advance(ego.x, ego.v, ego.decel, dt);
  if (ex - ego.x > egoHard) {
    ex = ego.x + Math.max(0, egoHard);
    ev = 0;
    run.clamps += 1;
  }

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

/**
 * Kotak kendaraan dalam koordinat lajur (y = lat) untuk pemantau: mobilmu, mobil depan atau
 * angkot, dan mobil mogok. Semua dalam format { id, x, y, heading, length, width }.
 */
export function runBoxes(run) {
  const out = [{ id: 'mobilmu', x: run.ego.x - CAR_LENGTH / 2, y: 0, heading: 0, length: CAR_LENGTH, width: CAR_WIDTH }];
  const l = run.lead;
  out.push({ id: l.kind === 'angkot' ? 'angkot' : 'mobil-depan', x: l.x + l.length / 2, y: l.lat, heading: l.yaw, length: l.length, width: l.width });
  if (run.obstacle) out.push({ id: 'mobil-mogok', x: run.obstacle.x + CAR_LENGTH / 2, y: 0, heading: 0, length: CAR_LENGTH, width: CAR_WIDTH });
  return out;
}

/** Penumpang yang masih di luar angkot, dalam koordinat lajur, atau null. */
export function passengerCircle(run) {
  const ped = run.ped;
  if (!ped || ped.state === 'dalam') return null;
  return { id: ped.id, x: ped.x, y: ped.lat, r: ped.r };
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
