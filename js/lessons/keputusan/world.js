// Dunia simulasi pelajaran Pengambilan Keputusan di Jalan Kawi, Malang.
//
// Tata letak berasal dari data OpenStreetMap (lihat scene.js): Jalan Kawi dua arah dengan satu
// lajur per arah (lebar perkiraan), simpang berlampu dengan Jalan Kelud dan Jalan Arjuno, dua
// penyeberangan di kaki simpang, dan satu zebra cross tanpa lampu di timur simpang.
//
// Mobil otonom melaju ke timur di lajur kiri (lalu lintas kiri). Lajur kanan dipakai kendaraan dari
// arah berlawanan (mobil, angkot, sepeda motor) dan boleh dipakai untuk menyalip saat kosong.
// Kendaraan di Jalan Kelud dan Jalan Arjuno melintas lurus saat lampu mereka hijau.
// Ruas yang disimulasikan sekitar 340 m. Setelah sampai di ujung, mobil otonom mulai lagi dari
// awal ruas (pelajaran memberi tahu hal ini lewat log).
//
// Koordinat Jalan Kawi memakai kerangka jalan dari scene.js: x = s (m sepanjang jalan),
// y = geseran ke samping (positif = kanan arah timur). Kendaraan di jalan simpang memakai
// koordinat peta langsung.
//
// Setiap langkah fisika, SETIAP kendaraan melewati perisai keselamatan (shield.js) sebelum
// percepatannya dipakai. Pemeriksa invarian terpisah menghitung terobos lampu merah dan kontak
// dengan pejalan kaki, yang harus selalu 0.

import { Vehicle } from '../../engine/vehicle.js';
import { boxesOverlap, distanceToBox } from '../../engine/geometry.js';
import { speedToStop, followingSpeed } from '../../engine/traffic.js';
import { Rng, clamp, kmhToMs } from '../../engine/math.js';
import { COLORS } from '../../engine/theme.js';
import { SAFETY, brakeLimit, yellowMustStop, canStopForPed, limitAccel, createCounters } from './shield.js';
import { ROAD_HALF, EGO_LAT, ONC_LAT, CW_HALF } from './scene.js';

export const RANGE = 80; // jangkauan persepsi dekat (kamera dan LiDAR), m
export const RANGE_FAR = 250; // jangkauan radar jarak jauh untuk kendaraan dari arah berlawanan, m
export const PED_Y = ROAD_HALF + 1.1; // posisi menunggu pejalan kaki di trotoar
export const PED_SPEED = 1.35; // m/s
export const YIELD_GAP = 1.5; // jarak garis beri jalan ke tepi zebra cross
export const ANGKOT_LAT = EGO_LAT - 0.55; // angkot ngetem menepi ke kiri, dekat kerb
export const EGO_BRAKE = brakeLimit(8);

// jarak antarkendaraan dari arah berlawanan (m). Setiap `every` kendaraan ada satu celah panjang
// supaya mobil otonom tidak menunggu selamanya untuk menyalip.
export const DENSITY = {
  kosong: null,
  sepi: { min: 110, max: 210, every: 2, gapMin: 240, gapMax: 320 },
  sedang: { min: 40, max: 90, every: 3, gapMin: 210, gapMax: 260 },
  padat: { min: 22, max: 42, every: 5, gapMin: 200, gapMax: 230 },
};

// ---------- lampu lalu lintas ----------

export const DUR = Object.freeze({ MAIN_GREEN: 14, MAIN_YELLOW: SAFETY.yellow, ALL_RED_1: 2, SIDE_GREEN: 10, SIDE_YELLOW: SAFETY.yellow, ALL_RED_2: 2 });

/**
 * Pengatur lampu simpang. Arah utama = Jalan Kawi, arah simpang = Jalan Kelud dan Jalan Arjuno.
 * Titik lampunya ada di data OSM. Durasi fase buatan simulasi.
 * mode: 'otomatis' (bergiliran), 'merah' (Jalan Kawi dipaksa merah), 'hijau' (Jalan Kawi dipaksa hijau).
 * Hijau selalu berganti ke kuning dulu, lalu semua merah sebentar, baru arah lain hijau.
 */
export class Signal {
  constructor() {
    this.mode = 'otomatis';
    this.phase = 'MAIN_GREEN';
    this.t = 0;
    this.yellowId = 0; // bertambah setiap Jalan Kawi mulai kuning
    this.sideYellowId = 0;
  }

  reset() {
    this.phase = 'MAIN_GREEN';
    this.t = 0;
  }

  get main() {
    return this.phase === 'MAIN_GREEN' ? 'green' : this.phase === 'MAIN_YELLOW' ? 'yellow' : 'red';
  }

  get side() {
    return this.phase === 'SIDE_GREEN' ? 'green' : this.phase === 'SIDE_YELLOW' ? 'yellow' : 'red';
  }

  go(phase) {
    this.phase = phase;
    this.t = 0;
    if (phase === 'MAIN_YELLOW') this.yellowId += 1;
    if (phase === 'SIDE_YELLOW') this.sideYellowId += 1;
  }

  update(dt) {
    this.t += dt;
    const m = this.mode;
    switch (this.phase) {
      case 'MAIN_GREEN':
        if (m === 'merah' || (m === 'otomatis' && this.t >= DUR.MAIN_GREEN)) this.go('MAIN_YELLOW');
        break;
      case 'MAIN_YELLOW':
        if (this.t >= DUR.MAIN_YELLOW) this.go('ALL_RED_1');
        break;
      case 'ALL_RED_1':
        if (this.t >= DUR.ALL_RED_1) this.go(m === 'hijau' ? 'MAIN_GREEN' : 'SIDE_GREEN');
        break;
      case 'SIDE_GREEN':
        if (m === 'hijau' || (m === 'otomatis' && this.t >= DUR.SIDE_GREEN)) this.go('SIDE_YELLOW');
        break;
      case 'SIDE_YELLOW':
        if (this.t >= DUR.SIDE_YELLOW) this.go('ALL_RED_2');
        break;
      case 'ALL_RED_2':
        if (this.t >= DUR.ALL_RED_2) this.go(m === 'merah' ? 'SIDE_GREEN' : 'MAIN_GREEN');
        break;
      default:
        break;
    }
  }

  /** Sisa waktu kuning Jalan Kawi (detik), 0 bila tidak kuning. */
  yellowLeft() {
    return this.phase === 'MAIN_YELLOW' ? Math.max(0, DUR.MAIN_YELLOW - this.t) : 0;
  }

  /** Pejalan kaki boleh mulai menyeberangi Jalan Kawi di kaki simpang (Jalan Kawi merah cukup lama). */
  pedPhaseOk() {
    if (this.phase !== 'SIDE_GREEN') return false;
    if (this.mode === 'merah') return true;
    return this.mode === 'otomatis' && DUR.SIDE_GREEN - this.t >= 3;
  }

  /** Detik sampai warna lampu Jalan Kawi berganti, atau null bila warnanya ditahan. */
  mainTimeLeft() {
    const { mode: m, t } = this;
    switch (this.phase) {
      case 'MAIN_GREEN':
        return m === 'otomatis' ? DUR.MAIN_GREEN - t : m === 'merah' ? 0 : null;
      case 'MAIN_YELLOW':
        return DUR.MAIN_YELLOW - t;
      case 'ALL_RED_1':
        if (m === 'hijau') return DUR.ALL_RED_1 - t;
        return m === 'otomatis' ? DUR.ALL_RED_1 - t + DUR.SIDE_GREEN + DUR.SIDE_YELLOW + DUR.ALL_RED_2 : null;
      case 'SIDE_GREEN':
        if (m === 'otomatis') return DUR.SIDE_GREEN - t + DUR.SIDE_YELLOW + DUR.ALL_RED_2;
        return m === 'hijau' ? DUR.SIDE_YELLOW + DUR.ALL_RED_2 : null;
      case 'SIDE_YELLOW':
        return m === 'merah' ? null : DUR.SIDE_YELLOW - t + DUR.ALL_RED_2;
      case 'ALL_RED_2':
        return m === 'merah' ? null : DUR.ALL_RED_2 - t;
      default:
        return null;
    }
  }
}

// ---------- jenis kendaraan lain ----------

const KIND_SPEC = {
  motor: { length: 1.9, width: 0.72, maxBrake: 6, aMax: 2.6 },
  city: { length: 3.7, width: 1.65, maxBrake: 7, aMax: 2 },
  mpv: { length: 4.4, width: 1.73, maxBrake: 7, aMax: 1.8 },
  car: { length: 4.5, width: 1.8, maxBrake: 7, aMax: 2 },
  angkot: { length: 4.1, width: 1.62, maxBrake: 6.5, aMax: 1.6 },
};

/** Jarak minimal (m) dari zebra cross supaya pejalan kaki uji boleh muncul: jarak henti nyaman ditambah cadangan. */
export function pedSpawnNeed(v) {
  return (v * v) / (2 * 2) + 8;
}

/** Jarak minimal (m) dari angkot ngetem supaya angkot boleh ditaruh di depan mobil otonom. */
export function angkotSpawnNeed(v) {
  return (v * v) / (2 * 1.5) + 8 + 14;
}

// ---------- dunia ----------

export function createWorld(scene) {
  const S = scene.S;
  const frame = scene.frame;
  const signal = new Signal();
  const rng = new Rng(11);
  const counters = createCounters();
  const ego = new Vehicle({
    id: 'ego',
    label: 'Mobil otonom',
    ego: true,
    x: S.start,
    y: EGO_LAT,
    heading: 0,
    maxAccel: 2,
    maxBrake: EGO_BRAKE,
    maxSpeed: SAFETY.vMaxEgo,
    steerRate: 1.4,
  });
  ego.dir = 1;
  const cws = {
    west: { key: 'west', s: S.cwWest, half: CW_HALF, kind: 'lampu', exitFor: -1 },
    east: { key: 'east', s: S.cwEast, half: CW_HALF, kind: 'lampu', exitFor: 1 },
    zebra: { key: 'zebra', s: S.zebra, half: CW_HALF, kind: 'zebra', exitFor: 0 },
  };
  const cwList = [cws.west, cws.east, cws.zebra];
  const oncoming = []; // arah barat, terurut x naik: indeks 0 paling barat (paling depan)
  const cross = { utara: [], selatan: [] };
  const peds = [];
  const angkot = { active: false, id: 'angkot-ngetem', x: S.angkot, y: ANGKOT_LAT, length: KIND_SPEC.angkot.length, width: KIND_SPEC.angkot.width, since: 0 };
  const pending = { ped: 0, angkot: false };
  const events = [];
  const W = {
    S,
    ego,
    signal,
    oncoming,
    cross,
    peds,
    cws,
    angkot,
    pending,
    counters,
    time: 0,
    density: 'sepi',
    viewMaxS: S.start + 70, // batas kanan area terlihat (s), diisi dari render
    wraps: 0,
    lastWrapAt: -10,
    shieldNote: null,
    // Khusus uji otomatis: kendaraan lain mengabaikan lampu dan penyeberangan di perencanaannya
    // sendiri, sehingga hanya perisai yang menjaga aturan. Pelajaran tidak pernah menyalakannya.
    chaos: { npcIgnoreRules: false },
  };
  let nextId = 1;
  let sinceGap = 0;
  let pendingSpacing = null;
  let pedSide = 'utara';
  let colorIdx = 0;
  let ambientTimer = 6;
  let contactPairs = new Set(); // pasangan yang bersinggungan di langkah sebelumnya
  let hitPairs = new Set();

  // ---------- pembantu ----------

  const egoFront = () => ego.x + ego.length / 2;
  const kawiVehicles = () => [ego, ...oncoming];
  const crossList = () => [...cross.utara, ...cross.selatan];
  const egoInOncomingLane = () => ego.y > -0.6;

  function worldBox(v) {
    const p = frame.toWorld(v.x, v.y);
    return { x: p.x, y: p.y, heading: p.heading + (v.dir < 0 ? Math.PI : 0) + (v === ego ? ego.heading : 0), length: v.length, width: v.width };
  }

  // ---------- batasan untuk kendaraan di Jalan Kawi ----------

  /**
   * Batasan keras terdekat di depan kendaraan di Jalan Kawi (dir 1 = timur, -1 = barat).
   * Hasil { pos (s), d, what, rule, go }. go = keputusan terus saat kuning (perisai menahan kecepatan).
   */
  function kawiConstraint(v, dir) {
    const front = v.x + (dir * v.length) / 2;
    const qf = dir * front;
    let best = { pos: null, d: Infinity, what: null, rule: false, go: false };
    const take = (pos, what, rule) => {
      const d = dir * pos - qf;
      if (d < best.d) best = { ...best, pos, d, what, rule };
    };
    // garis henti lampu
    const lineS = dir > 0 ? S.stopEB : S.stopWB;
    const beforeLine = dir * lineS - qf >= -0.01;
    if (beforeLine) {
      const st = signal.main;
      if (st === 'red') take(lineS, 'lampu merah', true);
      else if (st === 'yellow') {
        if (!v.yc || v.yc.id !== signal.yellowId) v.yc = { id: signal.yellowId, stop: yellowMustStop(Math.max(0, dir * lineS - qf), v.speed) };
        if (v.yc.stop) take(lineS, 'lampu kuning', true);
        else best.go = true;
      }
    }
    // penyeberangan yang dipakai pejalan kaki
    for (const cw of cwList) {
      const edge = cw.s - dir * cw.half;
      if (dir * edge - qf < -0.01 || dir * edge - qf > 160) continue;
      if (!peds.some((p) => p.cw === cw && p.state === 'menyeberang')) continue;
      // penyeberangan di sisi keluar simpang: jangan masuk simpang bila jalan keluarnya belum kosong
      if (cw.exitFor === dir && beforeLine) take(lineS, 'penyeberangan dipakai', true);
      else take(edge, 'penyeberangan dipakai', true);
    }
    // pejalan kaki di koridor atau diperkirakan masuk koridor
    const half = v.width / 2 + SAFETY.latMargin;
    for (const p of peds) {
      if (p.state === 'selesai' || Math.abs(p.y) > ROAD_HALF + 1.5) continue;
      const ahead = dir * p.x - qf;
      if (ahead < -p.radius || ahead > 160) continue;
      const off = Math.abs(p.y - v.y) - half - p.radius;
      let hit = off <= 0;
      if (!hit && Math.abs(p.vy) > 0.05 && Math.sign(v.y - p.y) === Math.sign(p.vy)) hit = off / Math.abs(p.vy) <= SAFETY.tPredict;
      if (hit) take(p.x - dir * (p.radius + SAFETY.gapPed), 'pejalan kaki', true);
    }
    // area simpang yang masih dipakai kendaraan dari Jalan Kelud atau Jalan Arjuno (bukan aturan pengguna, tetap dijaga)
    const boxNear = dir > 0 ? S.boxA : S.boxB;
    if (dir * boxNear - qf >= -0.01 && crossOnKawi()) take(boxNear, 'simpang belum kosong', false);
    // benda diam atau kendaraan lain di koridor
    if (dir > 0 && angkot.active && Math.abs(angkot.y - v.y) < (angkot.width + v.width) / 2 + 0.2) {
      const rear = angkot.x - angkot.length / 2;
      if (rear - qf > -0.5) take(rear - 0.5, 'angkot ngetem', false);
    }
    if (dir < 0 && v !== ego && egoInOncomingLane() && ego.x < v.x) take(ego.x + ego.length / 2 + 1, 'mobil otonom di lajur ini', false);
    // kendaraan di depan di lajur yang sama: tetap bisa berhenti walau ia mengerem sekuat-kuatnya
    if (dir < 0 && v !== ego) {
      let lead = null;
      for (const o of oncoming) if (o !== v && o.x < v.x && (!lead || o.x > lead.x)) lead = o;
      if (lead) take(lead.x + lead.length / 2 - (lead.speed * lead.speed) / (2 * lead.maxBrake) + 1, 'kendaraan di depan', false);
    }
    return best;
  }

  function crossOnKawi() {
    for (const k of ['utara', 'selatan']) {
      const sd = scene.side[k];
      for (const a of cross[k]) if (a.s + a.length / 2 > sd.sIn && a.s - a.length / 2 < sd.sOut) return true;
    }
    return false;
  }

  function kawiInBox() {
    for (const v of kawiVehicles()) if (v.x + v.length / 2 > S.boxA && v.x - v.length / 2 < S.boxB) return true;
    return false;
  }

  /** Terapkan perisai ke percepatan yang diminta. Mencatat campur tangan per episode. */
  function shieldApply(v, aDesire, aLead, dir, cons, dt, maxBrake, who) {
    let a = cons.go ? Math.max(aDesire, 0) : aDesire;
    const held = cons.go && aDesire < -0.3;
    a = Math.min(a, aLead);
    const lim = limitAccel(v.speed, a, cons.d, maxBrake, dt);
    const active = lim.limited || held;
    if (active && !v._shield) {
      counters.interventions += 1;
      if (who === 'ego') {
        counters.egoInterventions += 1;
        W.shieldNote = { time: W.time, what: held ? 'tahan-kuning' : cons.what };
      }
    }
    v._shield = active;
    return lim.accel;
  }

  // ---------- mobil otonom ----------

  function stepEgo(cmd, dt) {
    const f0 = egoFront();
    ego._f0 = f0;
    const cons = kawiConstraint(ego, 1);
    const a = shieldApply(ego, cmd.aDesire, cmd.aSafety ?? Infinity, 1, cons, dt, EGO_BRAKE, 'ego');
    ego.step(dt, { accel: a, steer: cmd.steer });
    // jepit: tidak pernah maju melewati batasan keras
    if (cons.pos != null && f0 <= cons.pos + 1e-6 && egoFront() > cons.pos - SAFETY.clampGap) {
      ego.x = cons.pos - SAFETY.clampGap - ego.length / 2;
      ego.speed = 0;
      counters.clamps += 1;
      counters.note('jepit', { who: 'ego', what: cons.what, t: W.time });
    }
  }

  // ---------- kendaraan dari arah berlawanan (arah barat) ----------

  function pickKind() {
    const r = rng.next();
    if (r < 0.42) return 'motor';
    if (r < 0.62) return 'city';
    if (r < 0.74) return 'mpv';
    if (r < 0.84) return 'car';
    return 'angkot';
  }

  function makeVehicle(kind, extra = {}) {
    const spec = KIND_SPEC[kind];
    const id = `${kind}-${nextId++}`;
    const v = {
      id,
      kind,
      length: spec.length,
      width: spec.width,
      maxBrake: brakeLimit(spec.maxBrake),
      aMax: spec.aMax,
      speed: 0,
      braking: false,
      yc: null,
      ...extra,
    };
    if (kind === 'motor') {
      v.cruise = kmhToMs(rng.range(34, 40));
      v.color = ['#64748b', '#1f2937', '#b91c1c', '#1d4ed8', '#e2e8f0'][rng.int(0, 4)];
      v.helmet = COLORS.helmets[rng.int(0, COLORS.helmets.length - 1)];
      v.jacket = ['#334155', '#7c2d12', '#1e3a8a', '#365314', '#6b21a8'][rng.int(0, 4)];
      v.passenger = rng.chance(0.3);
      v.passengerHelmet = COLORS.helmets[rng.int(0, COLORS.helmets.length - 1)];
    } else if (kind === 'angkot') {
      v.cruise = kmhToMs(rng.range(30, 34));
      v.color = COLORS.angkot;
    } else {
      v.cruise = kmhToMs(rng.range(34, 40));
      v.color = COLORS.vehicles[(colorIdx++ * 2 + 1) % COLORS.vehicles.length];
    }
    return v;
  }

  function makeOncoming(x) {
    const kind = pickKind();
    const c = makeVehicle(kind, { x, y: ONC_LAT + (kind === 'motor' ? 0.55 : 0), heading: Math.PI, dir: -1 });
    c.speed = c.cruise;
    c.laneY = c.y;
    // sebagian angkot berhenti sebentar menurunkan penumpang di mulut Jalan Kawi Gang 9A
    if (kind === 'angkot' && rng.chance(0.55)) c.pickup = { s: S.cwWest - 62 + rng.range(-6, 6), dwell: rng.range(3, 5.5), t: 0, done: false };
    return c;
  }

  /**
   * Kendaraan baru yang muncul di tengah ruas (setelah kepadatan diganti) tidak boleh muncul di atas
   * penyeberangan atau di dalam simpang, dan kecepatan awalnya harus masih bisa berhenti dengan nyaman
   * sebelum batasan di depannya (garis henti merah, penyeberangan yang dipakai, kendaraan di depan).
   */
  function placeOncoming(x) {
    const zones = [...cwList.map((cw) => [cw.s - cw.half - 3, cw.s + cw.half + 3]), [S.stopEB - 3, S.stopWB + 3]];
    for (let k = 0; k < 4; k++) for (const [a, b] of zones) if (x + 3 > a && x - 3 < b) x = b + 3.1;
    const c = makeOncoming(x);
    c.speed = 0;
    const cons = kawiConstraint(c, -1);
    let v = c.cruise;
    if (cons.d < Infinity) v = Math.min(v, Math.sqrt(2 * 2.5 * Math.max(0, cons.d - 3)));
    let lead = null;
    for (const o of oncoming) if (o.x < c.x && (!lead || o.x > lead.x)) lead = o;
    if (lead) v = Math.min(v, followingSpeed(c.x - c.length / 2 - (lead.x + lead.length / 2), lead.speed, { cruise: c.cruise, minGap: 2.5, timeGap: 1.2, decel: 2.5, strict: true }));
    c.speed = Math.max(0, v);
    return c;
  }

  function nextSpacing(cfg) {
    sinceGap += 1;
    if (sinceGap >= cfg.every) {
      sinceGap = 0;
      return rng.range(cfg.gapMin, cfg.gapMax);
    }
    return rng.range(cfg.min, cfg.max);
  }

  /** Tambah kendaraan dari arah berlawanan di titik muncul (jauh di luar layar) bila jaraknya cukup. */
  function fillOncoming() {
    const cfg = DENSITY[W.density];
    if (!cfg) return;
    const last = oncoming[oncoming.length - 1];
    if (pendingSpacing == null) pendingSpacing = nextSpacing(cfg);
    if (!last || S.spawn - last.x >= pendingSpacing) {
      oncoming.push(makeOncoming(S.spawn));
      pendingSpacing = null;
    }
  }

  function seedOncoming() {
    oncoming.length = 0;
    pendingSpacing = null;
    sinceGap = 0;
    const cfg = DENSITY[W.density];
    if (!cfg) return;
    let x = S.despawn + 20 + rng.range(0, cfg.min);
    while (x <= S.spawn) {
      oncoming.push(makeOncoming(x));
      x += nextSpacing(cfg);
    }
  }

  /**
   * Ganti kepadatan. Kendaraan yang belum terlihat dibuang lalu dibuat ulang dengan kepadatan baru,
   * selalu di luar layar. clearUntil (s) dipakai saat mobil otonom sedang menyalip: kendaraan baru
   * baru boleh muncul setelah titik itu, jadi celah yang sudah dihitung tetap aman.
   */
  function setDensity(d, clearUntil = -Infinity) {
    W.density = d;
    pendingSpacing = null;
    sinceGap = 0;
    const floor = Math.max(W.viewMaxS + 12, clearUntil);
    for (let i = oncoming.length - 1; i >= 0; i--) if (oncoming[i].x - oncoming[i].length / 2 > floor) oncoming.splice(i, 1);
    const cfg = DENSITY[d];
    if (!cfg) return;
    let x = Math.max(floor + 5, (oncoming[oncoming.length - 1]?.x ?? -Infinity) + cfg.min);
    while (x <= S.spawn) {
      const c = placeOncoming(x);
      oncoming.push(c);
      x = c.x + nextSpacing(cfg);
    }
  }

  /** Ruang kosong (m) setelah zona sampai bemper belakang kendaraan di depan (arah barat). */
  function keepClear(c, lead, zoneNear, zoneFar) {
    const F = c.x - c.length / 2;
    if (F < zoneNear - 0.01) return Infinity; // sudah masuk zona: jangan berhenti di dalamnya
    if (F - zoneNear > 45) return Infinity;
    if (!lead) return Infinity;
    const room = zoneFar - (lead.x + lead.length / 2);
    if (lead.speed > 2 || room >= c.length + 2) return Infinity;
    return F - zoneNear; // berhenti sebelum zona
  }

  function updateOncoming(dt) {
    for (let i = 0; i < oncoming.length; i++) {
      const c = oncoming[i];
      const lead = oncoming[i - 1] || null;
      const F = c.x - c.length / 2;
      c._f0 = F;
      let vDes = c.cruise;
      const stopAt = (d) => {
        vDes = Math.min(vDes, d <= 0.05 ? 0 : speedToStop(d, 3));
      };
      const obey = !W.chaos.npcIgnoreRules;
      if (!obey) vDes = SAFETY.vMaxNpc;
      // lampu (keputusan kuning sama dengan perisai)
      const dLine = F - S.stopWB;
      if (dLine > -0.01 && obey) {
        const st = signal.main;
        if (st === 'yellow' && (!c.yc || c.yc.id !== signal.yellowId)) c.yc = { id: signal.yellowId, stop: yellowMustStop(Math.max(0, dLine), c.speed) };
        if (st === 'red' || (st === 'yellow' && c.yc.stop)) stopAt(dLine - 0.8);
      }
      // penyeberangan yang dipakai (sisi keluar simpang: tunggu di garis henti)
      for (const cw of cwList) {
        const edge = cw.s + cw.half;
        const d = F - edge;
        if (!obey || d < -0.01 || d > 90) continue;
        if (!peds.some((p) => p.cw === cw && p.state === 'menyeberang')) continue;
        if (cw.exitFor === -1 && dLine > -0.01) stopAt(dLine - 0.8);
        else stopAt(d - 1.2);
      }
      // jangan berhenti di atas penyeberangan atau di tengah simpang
      for (const [near, far] of [
        [S.zebra + CW_HALF, S.zebra - CW_HALF],
        [S.stopWB, S.cwWest - CW_HALF],
      ]) {
        const d = keepClear(c, lead, near, far);
        if (d < Infinity) stopAt(d - 0.8);
      }
      // angkot berhenti sebentar menurunkan penumpang
      if (c.pickup && !c.pickup.done) {
        const d = F - (c.pickup.s - c.length / 2);
        if (d < 40) {
          c.y = c.laneY + 0.3 * clamp(1 - d / 25, 0, 1);
          if (d <= 0.3 && c.speed < 0.2) {
            c.pickup.t += dt;
            c.doorOpen = c.pickup.t > 0.6 && c.pickup.t < c.pickup.dwell - 0.4;
            if (c.pickup.t >= c.pickup.dwell) {
              c.pickup.done = true;
              c.doorOpen = false;
            }
            vDes = 0;
          } else stopAt(d);
        }
      } else if (c.pickup?.done && c.y > c.laneY) c.y = Math.max(c.laneY, c.y - 0.25 * dt);
      c.hazard = !!(c.pickup && !c.pickup.done && F - (c.pickup.s - c.length / 2) < 12);
      let aDes = clamp((vDes - c.speed) / dt, -4.5, c.aMax);
      // kendaraan di depan (dan mobil otonom yang sedang menyalip di lajur ini)
      let aLead = Infinity;
      const follow = (gap, lv) => {
        const vf = followingSpeed(gap, lv, { cruise: c.cruise, minGap: 2.5, timeGap: 1.2, decel: 3, strict: true });
        if (vf < c.speed) aLead = Math.min(aLead, clamp((vf - c.speed) / dt, -c.maxBrake, c.aMax));
      };
      if (lead) follow(F - (lead.x + lead.length / 2), lead.speed);
      if (egoInOncomingLane() && ego.x < c.x) {
        const gap = F - (ego.x + ego.length / 2);
        if (gap < 90) follow(gap - 0.5, 0);
      }
      const cons = kawiConstraint(c, -1);
      const a = shieldApply(c, aDes, aLead, -1, cons, dt, c.maxBrake, 'npc');
      const v0 = c.speed;
      c.speed = clamp(c.speed + a * dt, 0, SAFETY.vMaxNpc);
      c.accel = (c.speed - v0) / dt;
      c.braking = c.accel < -0.5 && c.speed > 0.1;
      c.x -= c.speed * dt;
      if (cons.pos != null && F >= cons.pos - 1e-6 && c.x - c.length / 2 < cons.pos + SAFETY.clampGap) {
        c.x = cons.pos + SAFETY.clampGap + c.length / 2;
        c.speed = 0;
        counters.clamps += 1;
        counters.note('jepit', { who: c.id, what: cons.what, t: W.time });
      }
    }
    while (oncoming.length && oncoming[0].x < S.despawn) oncoming.shift();
    fillOncoming();
  }

  // ---------- kendaraan di Jalan Kelud dan Jalan Arjuno ----------

  function resetCross() {
    for (const k of ['utara', 'selatan']) {
      cross[k].length = 0;
      const sd = scene.side[k];
      const kinds = k === 'utara' ? ['motor', 'city', 'motor'] : ['motor', 'angkot', 'motor'];
      const starts = k === 'utara' ? [40, 95, 250] : [30, 110, 240];
      kinds.forEach((kind, i) => {
        const a = makeVehicle(kind, { s: starts[i], side: k });
        a.cruise = kmhToMs(kind === 'motor' ? rng.range(22, 26) : rng.range(18, 22));
        syncCross(a, sd);
        cross[k].push(a);
      });
      cross[k].sort((p, q) => q.s - p.s);
    }
  }

  function syncCross(a, sd) {
    const p = sd.path.sample(a.s);
    a.x = p.x;
    a.y = p.y;
    a.heading = p.heading;
  }

  function updateCross(dt) {
    const kawiBusy = kawiInBox();
    for (const k of ['utara', 'selatan']) {
      const sd = scene.side[k];
      const list = cross[k];
      list.sort((p, q) => q.s - p.s);
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        const lead = list[i - 1] || null;
        const F = a.s + a.length / 2;
        a._f0 = F;
        let vDes = a.cruise;
        const stopAt = (d) => {
          vDes = Math.min(vDes, d <= 0.05 ? 0 : speedToStop(d, 3));
        };
        let cons = { pos: null, d: Infinity, what: null, go: false };
        const take = (pos, what) => {
          if (pos - F < cons.d) cons = { ...cons, pos, d: pos - F, what };
        };
        const dLine = sd.stopS - F;
        const obey = !W.chaos.npcIgnoreRules;
        if (!obey) vDes = SAFETY.vMaxNpc;
        if (dLine > -0.01) {
          // aturan lampu di perisai (selalu), keinginan berhenti di perencana (kecuali mode uji)
          const st = signal.side;
          if (st === 'yellow' && (!a.yc || a.yc.id !== signal.sideYellowId)) a.yc = { id: signal.sideYellowId, stop: yellowMustStop(Math.max(0, dLine), a.speed) };
          if (st === 'red' || (st === 'yellow' && a.yc.stop)) {
            if (obey) stopAt(dLine - 0.8);
            take(sd.stopS, st === 'red' ? 'lampu merah' : 'lampu kuning');
          } else if (st === 'yellow') cons.go = true;
        }
        // kendaraan di depan: tetap bisa berhenti walau ia mengerem sekuat-kuatnya
        if (lead) take(lead.s - lead.length / 2 + (lead.speed * lead.speed) / (2 * lead.maxBrake) - 1, 'kendaraan di depan');
        // jangan masuk badan Jalan Kawi bila masih ada kendaraan Jalan Kawi di area simpang
        const dBox = sd.sIn - F;
        if (dBox > -0.01 && kawiBusy) {
          stopAt(dBox - 0.8);
          take(sd.sIn, 'simpang belum kosong');
        }
        let aDes = clamp((vDes - a.speed) / dt, -4.5, a.aMax);
        let aLead = Infinity;
        if (lead) {
          const vf = followingSpeed(lead.s - lead.length / 2 - F, lead.speed, { cruise: a.cruise, minGap: 2.5, timeGap: 1.2, decel: 3, strict: true });
          if (vf < a.speed) aLead = clamp((vf - a.speed) / dt, -a.maxBrake, a.aMax);
        }
        const acc = shieldApply(a, aDes, aLead, 1, cons, dt, a.maxBrake, 'npc');
        const v0 = a.speed;
        a.speed = clamp(a.speed + acc * dt, 0, SAFETY.vMaxNpc);
        a.accel = (a.speed - v0) / dt;
        a.braking = a.accel < -0.5 && a.speed > 0.1;
        a.s += a.speed * dt;
        if (cons.pos != null && F <= cons.pos + 1e-6 && a.s + a.length / 2 > cons.pos - SAFETY.clampGap) {
          a.s = cons.pos - SAFETY.clampGap - a.length / 2;
          a.speed = 0;
          counters.clamps += 1;
          counters.note('jepit', { who: a.id, what: cons.what, t: W.time });
        }
        // ujung jalur (jauh di luar layar): kembali ke awal bila awal jalur kosong
        if (a.s > sd.path.length - 3) {
          const free = !list.some((b) => b !== a && b.s < 14);
          if (free) {
            a.s = 2;
            a.yc = null;
          } else {
            a.s = sd.path.length - 3;
            a.speed = 0;
          }
        }
        syncCross(a, sd);
      }
    }
  }

  // ---------- pejalan kaki ----------

  function makePed(cw, side, { test = false } = {}) {
    const north = side === 'utara';
    const variants = ['default', 'hijab', 'backpack', 'default', 'hijab'];
    const p = {
      id: `pejalan-${nextId++}`,
      cw,
      side,
      x: cw.s + (north ? -0.8 : 0.8),
      y: north ? -PED_Y : PED_Y,
      heading: north ? Math.PI / 2 : -Math.PI / 2,
      radius: 0.3,
      speed: 0,
      vy: 0,
      state: 'menunggu',
      wait: 0,
      t: 0,
      phase: 0,
      alpha: 1,
      held: false,
      test,
      variant: variants[rng.int(0, variants.length - 1)],
      accent: COLORS.hijab[rng.int(0, COLORS.hijab.length - 1)],
      color: ['#fb7185', '#f59e0b', '#60a5fa', '#34d399', '#e879f9'][rng.int(0, 4)],
    };
    peds.push(p);
    return p;
  }

  const pedDist = () => S.zebra - CW_HALF - egoFront(); // bemper depan mobil otonom ke tepi zebra cross

  function spawnTestPed() {
    const active = peds.filter((p) => p.test && p.state !== 'selesai' && p.cw === cws.zebra);
    let side = pedSide;
    if (active.some((p) => p.side === side && p.state === 'menunggu')) side = side === 'utara' ? 'selatan' : 'utara';
    pedSide = side === 'utara' ? 'selatan' : 'utara';
    const p = makePed(cws.zebra, side, { test: true });
    events.push({ type: 'pejalan-muncul', ped: p, distance: pedDist() });
    return p;
  }

  /**
   * Tombol "Munculkan pejalan kaki": pejalan kaki muncul di zebra cross hanya bila mobil otonom masih
   * bisa berhenti dengan nyaman sebelum zebra cross. Bila tidak, permintaan ditunda sampai mobil
   * otonom datang lagi dari awal ruas. Hasil: { ok, queued, reason, distance, need }.
   */
  function requestPed() {
    const active = peds.filter((p) => p.test && p.state !== 'selesai');
    if (active.length + pending.ped >= 2) return { ok: false, reason: 'penuh' };
    const dist = pedDist();
    const need = pedSpawnNeed(ego.speed);
    if (dist >= need) return { ok: true, ped: spawnTestPed(), distance: dist, need };
    pending.ped += 1;
    return { ok: false, queued: true, reason: dist < -1 ? 'lewat' : 'dekat', distance: dist, need };
  }

  function updatePendingPed() {
    if (pending.ped && pedDist() >= pedSpawnNeed(ego.speed)) {
      pending.ped -= 1;
      spawnTestPed();
    }
  }

  /** Penerimaan celah: semua kendaraan Jalan Kawi yang datang masih bisa berhenti sebelum penyeberangan. */
  function gapOk(cw) {
    for (const v of kawiVehicles()) {
      const dir = v === ego ? 1 : -1;
      const front = v.x + (dir * v.length) / 2;
      const rear = v.x - (dir * v.length) / 2;
      const qNear = dir * (cw.s - dir * cw.half);
      const qFar = dir * (cw.s + dir * cw.half);
      if (dir * rear > qFar + 0.5) continue; // sudah lewat seluruhnya
      if (dir * front > qNear - 0.3) return false; // sedang di atas atau tepat di tepi penyeberangan
      const d = qNear - dir * front;
      if (v.speed < 0.1 ? d < 0.4 : !canStopForPed(d, v.speed)) return false;
    }
    return true;
  }

  function pedCanStart(p, planner) {
    const cw = p.cw;
    if (cw.kind === 'lampu' && !signal.pedPhaseOk()) return false;
    if (p.test) {
      // Pejalan kaki uji menunggu mobil otonom berhenti untuknya atau lewat lebih dulu.
      const egoPassed = ego.x - ego.length / 2 > cw.s + cw.half + 0.5;
      const egoYielding = planner?.P.yieldTest === p.id && ego.speed < 1.5 && egoFront() < cw.s - cw.half - 0.5;
      if (!(egoPassed || egoYielding)) return false;
    }
    return gapOk(cw);
  }

  function pedBlocked(p, nx, ny) {
    const w = frame.toWorld(nx, ny);
    const boxes = [...kawiVehicles().map(worldBox), ...crossList()];
    if (angkot.active) boxes.push(worldBox(angkot));
    for (const b of boxes) {
      if (Math.hypot(b.x - w.x, b.y - w.y) > 8) continue;
      if (distanceToBox(w.x, w.y, b) < p.radius + 0.25) return true;
    }
    return false;
  }

  function updatePeds(dt, planner) {
    for (let i = peds.length - 1; i >= 0; i--) {
      const p = peds[i];
      const north = p.side === 'utara';
      if (p.state === 'menunggu') {
        p.wait += dt;
        p.speed = 0;
        p.vy = 0;
        if (pedCanStart(p, planner)) {
          p.state = 'menyeberang';
          events.push({ type: 'pejalan-mulai', ped: p });
        } else if (!p.test && p.wait > 45) {
          // pejalan kaki latar yang terlalu lama menunggu berjalan pergi
          p.state = 'selesai';
          p.t = 0;
          p.heading = north ? Math.PI : 0;
        }
      } else if (p.state === 'menyeberang') {
        const dir = north ? 1 : -1;
        const ny = p.y + dir * PED_SPEED * dt;
        if (pedBlocked(p, p.x, ny)) {
          p.held = true;
          p.speed = 0;
          p.vy = 0;
        } else {
          p.held = false;
          p.speed = PED_SPEED;
          p.vy = dir * PED_SPEED;
          p.y = ny;
          p.phase += dt * 7;
        }
        if ((dir > 0 && p.y >= PED_Y) || (dir < 0 && p.y <= -PED_Y)) {
          p.y = dir * PED_Y;
          p.vy = 0;
          p.state = 'selesai';
          p.t = 0;
          p.heading = north ? 0 : Math.PI; // berjalan menjauh di trotoar
        }
      } else {
        p.t += dt;
        p.speed = 1.2;
        p.x += Math.cos(p.heading) * p.speed * dt;
        p.vy = 0;
        p.phase += dt * 6;
        p.alpha = Math.max(0, 1 - p.t / 3);
        if (p.t > 3) peds.splice(i, 1);
      }
    }
    // pejalan kaki latar di penyeberangan kaki simpang
    ambientTimer -= dt;
    if (ambientTimer <= 0) {
      ambientTimer = rng.range(8, 16);
      const amb = peds.filter((p) => !p.test && p.state !== 'selesai');
      if (amb.length < 2) {
        const cw = rng.chance(0.5) ? cws.west : cws.east;
        const side = rng.chance(0.5) ? 'utara' : 'selatan';
        if (!peds.some((p) => p.cw === cw && p.side === side && p.state === 'menunggu')) makePed(cw, side);
      }
    }
  }

  // ---------- angkot ngetem ----------

  /**
   * Tombol "Taruh angkot ngetem": angkot berhenti lama di lajur kiri menunggu penumpang. Hanya
   * ditaruh bila mobil otonom masih bisa berhenti dengan nyaman di belakangnya, atau sudah lewat.
   */
  const angkotGap = () => angkot.x - angkot.length / 2 - egoFront(); // bemper depan mobil otonom ke belakang angkot
  const angkotFits = () => ego.x - ego.length / 2 > angkot.x + angkot.length / 2 + 1 || angkotGap() >= angkotSpawnNeed(ego.speed);

  function requestAngkot() {
    if (angkot.active || pending.angkot) {
      angkot.active = false;
      pending.angkot = false;
      return { removed: true };
    }
    const dist = angkotGap();
    if (angkotFits()) {
      placeAngkot();
      return { ok: true, distance: dist };
    }
    pending.angkot = true;
    return { ok: false, queued: true, distance: dist, need: angkotSpawnNeed(ego.speed) };
  }

  function placeAngkot() {
    angkot.active = true;
    angkot.since = W.time;
    pending.angkot = false;
    events.push({ type: 'angkot-ditaruh', distance: angkotGap() });
  }

  function updatePendingAngkot() {
    if (pending.angkot && angkotFits()) placeAngkot();
  }

  // ---------- pemeriksa invarian (terpisah dari perisai) ----------

  function monitor() {
    const red = signal.main === 'red';
    const sideRed = signal.side === 'red';
    // terobos lampu merah: bemper depan melewati tepi dekat garis henti saat lampunya merah
    if (ego._f0 != null && ego._f0 < S.stopEB && egoFront() >= S.stopEB && red) {
      counters.redRuns += 1;
      counters.note('merah', { who: 'ego', t: W.time, v: ego.speed });
    }
    for (const c of oncoming) {
      const F = c.x - c.length / 2;
      if (c._f0 != null && c._f0 > S.stopWB && F <= S.stopWB && red) {
        counters.redRuns += 1;
        counters.note('merah', { who: c.id, t: W.time, v: c.speed });
      }
    }
    for (const k of ['utara', 'selatan']) {
      const sd = scene.side[k];
      for (const a of cross[k]) {
        const F = a.s + a.length / 2;
        if (a._f0 != null && a._f0 < sd.stopS && F >= sd.stopS && F - a._f0 < 5 && sideRed) {
          counters.redRuns += 1;
          counters.note('merah', { who: a.id, t: W.time, v: a.speed });
        }
      }
    }
    // kontak pejalan kaki: kotak kendaraan bersinggungan dengan lingkaran pejalan kaki
    const boxes = [];
    boxes.push({ id: 'ego', b: worldBox(ego) });
    for (const c of oncoming) if (c.x > S.despawn + 5 && c.x < S.end + 30) boxes.push({ id: c.id, b: worldBox(c) });
    for (const a of crossList()) boxes.push({ id: a.id, b: a });
    if (angkot.active) boxes.push({ id: angkot.id, b: worldBox(angkot) });
    const nowContacts = new Set();
    for (const p of peds) {
      const w = frame.toWorld(p.x, p.y);
      for (const { id, b } of boxes) {
        if (Math.abs(b.x - w.x) > 8 || Math.abs(b.y - w.y) > 8) continue;
        if (distanceToBox(w.x, w.y, b) < p.radius) {
          const key = `${p.id}|${id}`;
          nowContacts.add(key);
          if (!contactPairs.has(key)) {
            counters.pedContacts += 1;
            counters.note('kontak', { ped: p.id, veh: id, t: W.time, state: p.state });
          }
        }
      }
    }
    contactPairs = nowContacts;
    // tabrakan lain (kendaraan dengan kendaraan atau angkot ngetem)
    const nowHits = new Set();
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const A = boxes[i].b;
        const B = boxes[j].b;
        if (Math.abs(A.x - B.x) > 7 || Math.abs(A.y - B.y) > 7) continue;
        if (boxesOverlap(A, B)) {
          const key = `${boxes[i].id}|${boxes[j].id}`;
          nowHits.add(key);
          if (!hitPairs.has(key)) {
            counters.otherCollisions += 1;
            counters.note('tabrakan', { a: boxes[i].id, b: boxes[j].id, t: W.time });
            if (boxes[i].id === 'ego' || boxes[j].id === 'ego') events.push({ type: 'tabrakan', what: boxes[i].id === 'ego' ? boxes[j].id : boxes[i].id });
          }
        }
      }
    }
    hitPairs = nowHits;
  }

  // ---------- langkah simulasi ----------

  /** planner: { update(dt) -> { aDesire, aSafety, steer }, P, onWrap() } dari planner.js */
  function update(dt, planner) {
    W.time += dt;
    signal.update(dt);
    const cmd = planner.update(dt);
    stepEgo(cmd, dt);
    updateOncoming(dt);
    updateCross(dt);
    updatePeds(dt, planner);
    updatePendingPed();
    updatePendingAngkot();
    monitor();
    // ujung ruas: mobil otonom mulai lagi dari awal Jalan Kawi
    if (ego.x >= S.wrap && planner.P.state === 'melaju' && !planner.P.man) {
      const over = ego.x - S.wrap;
      ego.x = S.start + over;
      ego._f0 = null;
      ego.yc = null;
      W.wraps += 1;
      W.lastWrapAt = W.time;
      planner.onWrap();
      events.push({ type: 'putaran' });
    }
  }

  /** Mulai ulang dunia dengan mobil otonom di s tertentu dan melaju pada kecepatan v. */
  function reset(egoS, v) {
    W.time = 0;
    rng.reseed(11);
    nextId = 1;
    colorIdx = 0;
    counters.reset();
    contactPairs.clear();
    hitPairs.clear();
    pedSide = 'utara';
    ambientTimer = 5;
    ego.setPose(egoS, EGO_LAT, 0);
    ego.speed = Math.min(v, SAFETY.vMaxEgo);
    ego._f0 = null;
    ego.yc = null;
    ego._shield = false;
    W.viewMaxS = egoS + 70;
    W.wraps = 0;
    W.lastWrapAt = -10;
    W.shieldNote = null;
    peds.length = 0;
    events.length = 0;
    pending.ped = 0;
    pending.angkot = false;
    angkot.since = 0;
    signal.reset();
    resetCross();
    seedOncoming();
  }

  function drainEvents() {
    return events.splice(0);
  }

  /** Ringkasan untuk uji otomatis (window.__keputusan). */
  function snapshot() {
    return {
      time: W.time,
      egoS: ego.x,
      egoLat: ego.y,
      egoSpeed: ego.speed,
      egoFront: egoFront(),
      light: signal.main,
      sideLight: signal.side,
      phase: signal.phase,
      mode: signal.mode,
      density: W.density,
      oncoming: oncoming.length,
      cross: crossList().length,
      peds: peds.map((p) => ({ id: p.id, cw: p.cw.key, state: p.state, test: p.test, s: p.x, lat: p.y })),
      pendingPed: pending.ped,
      pendingAngkot: pending.angkot,
      angkot: angkot.active,
      wraps: W.wraps,
      S: { ...S },
      counters: {
        redRuns: counters.redRuns,
        pedContacts: counters.pedContacts,
        otherCollisions: counters.otherCollisions,
        clamps: counters.clamps,
        interventions: counters.interventions,
        egoInterventions: counters.egoInterventions,
      },
      events: counters.events.slice(0, 12),
    };
  }

  Object.assign(W, {
    update,
    reset,
    setDensity,
    requestPed,
    requestAngkot,
    drainEvents,
    snapshot,
    worldBox,
  });
  return W;
}
