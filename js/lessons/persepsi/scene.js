// Dunia simulasi pelajaran Persepsi di Jalan Karangampel Timur, Malang (dekat Universitas Ma Chung).
//
// Semua pengguna jalan bergerak dalam kerangka Frenet ruas jalan (lihat ./street.js):
// s = jarak sepanjang jalan ke timur, d = geseran ke samping (positif = sisi utara). Posisi dunia
// (x, y, heading) dihitung dari (s, d) setiap langkah, jadi sensor, fusi, dan gambar tetap memakai
// koordinat dunia biasa.
//
// Pengguna jalan:
//   - mobil otonom (ego) ke timur di lajur utara, sekitar 18 km/jam;
//   - mobil, angkot, sepeda motor, dan pesepeda ke barat di lajur selatan;
//   - sepeda motor ke timur yang datang dari belakang lalu menyelip di sisi kanan mobil otonom;
//   - angkot yang menepi di halte untuk menaikkan penumpang (pintu geser di sisi kiri);
//   - pejalan kaki di trotoar, penyeberang di zebra cross, dan calon penumpang angkot.
//
// Aturan keselamatan (SPEC aturan 9): tidak ada kendaraan yang boleh menabrak pejalan kaki.
// Dijamin dengan tiga lapis, bukan kebetulan:
//   1. Penerimaan celah: penyeberang baru melangkah ke jalan bila setiap kendaraan yang mendekat
//      masih bisa berhenti dengan nyaman sebelum zebra cross dan tidak ada kendaraan di atas zebra.
//   2. Perisai keselamatan: setiap langkah fisika, untuk SETIAP kendaraan, sesudah perencana dan
//      sebelum gerak diterapkan. Perisai mencari batasan terdekat di depan (zebra cross yang sedang
//      dipakai, pejalan kaki di koridor kendaraan atau yang diperkirakan masuk ke sana). Bila jarak
//      sisa tidak lebih dari jarak henti v^2 / (2 a_rem) + v * jeda aktuasi, perisai mengerem penuh
//      dengan perlambatan yang memang bisa dicapai model (dibatasi gesekan jalan saat ini).
//      Setelah integrasi, posisi dijepit sehingga bagian depan kendaraan tidak pernah melewati batas.
//   3. Pemantau invarian: memeriksa tumpang tindih lingkaran pejalan kaki dengan kotak kendaraan
//      secara geometris di koordinat dunia. Penghitungnya harus selalu 0.
// Di ruas ini tidak ada lampu lalu lintas, jadi penghitung terobos lampu merah juga tetap 0.

import { Rng, clamp, approach, angleDiff, G } from '../../engine/math.js';
import { speedToStop, followingSpeed } from '../../engine/traffic.js';
import { boxesOverlap, distanceToBox } from '../../engine/geometry.js';
import { COLORS } from '../../engine/theme.js';
import { drawVehicle, drawCar, drawPedestrian } from '../../engine/draw.js';
import { LINES } from './street.js';

export const EGO_CRUISE = 5; // m/s, sekitar 18 km/jam
export const ROAD_MU = 0.7; // gesekan aspal kering (cuaca cerah)
export const LATENCY = 0.25; // detik, jeda aktuasi rem yang diperhitungkan perisai
const SHIELD_MARGIN = 0.4; // m, jarak sisa yang dijaga perisai saat mengerem
const LAT_MARGIN = 0.3; // m, tambahan lebar koridor perisai di kiri dan kanan
const PED_BUFFER = 1.0; // m, batas berhenti di depan pejalan kaki
const CW_BUFFER = 1.5; // m, batas berhenti sebelum tepi zebra cross
const GAP_MARGIN = 1.5; // m, cadangan saat pejalan kaki menilai celah
const PRED_HORIZON = 4; // detik, pejalan kaki yang diperkirakan masuk koridor
const CROSS_SPEED = 1.35;
const DOOR_OFFSET = 0.37; // m, pintu angkot sedikit di depan titik tengahnya

const TYPES = {
  ego: { length: 4.5, width: 1.8, aMax: 1.2, aComfort: 2, aBrake: 4, latRate: 0.5 },
  car: { length: 4.5, width: 1.8, aMax: 1.8, aComfort: 2.5, aBrake: 5, latRate: 0.5, cruise: [7, 8.5] },
  city: { length: 3.7, width: 1.65, aMax: 1.8, aComfort: 2.5, aBrake: 5, latRate: 0.5, cruise: [7, 8.5] },
  mpv: { length: 4.4, width: 1.73, aMax: 1.6, aComfort: 2.5, aBrake: 5, latRate: 0.5, cruise: [7, 8.2] },
  angkot: { length: 4.1, width: 1.62, aMax: 1.5, aComfort: 2, aBrake: 4.5, latRate: 0.7, cruise: [6.5, 7.5] },
  motor: { length: 1.9, width: 0.72, aMax: 2.5, aComfort: 3, aBrake: 5.5, latRate: 0.9, cruise: [8.5, 10] },
  cyclist: { length: 1.8, width: 0.6, aMax: 0.8, aComfort: 1.5, aBrake: 3, latRate: 0.4, cruise: [4, 4.6] },
};
const CLS_OF = { car: 'car', city: 'car', mpv: 'car', angkot: 'angkot', motor: 'motor', cyclist: 'cyclist' };
const MOTOR_HALF = TYPES.motor.width / 2;
// pita tengah jalan yang dipakai sepeda motor saat menyelip (kedua arah bergantian)
const STRIP = [LINES.westPass - MOTOR_HALF - 0.05, LINES.eastPass + MOTOR_HALF + 0.05];
const VARIANTS = ['default', 'default', 'hijab', 'hijab', 'backpack', 'default', 'hijab', 'umbrella'];
const SHIRTS = ['#fb7185', '#f59e0b', '#60a5fa', '#34d399', '#e879f9', '#f97316', '#a3e635', '#94a3b8'];
const JACKETS = ['#334155', '#1e3a8a', '#7f1d1d', '#14532d', '#78350f', '#312e81'];

/**
 * Buat dunia. opts: { street (dari buildStreet), seed }.
 */
export function createScene({ street, seed = 11 } = {}) {
  const rng = new Rng(seed);
  const T = TYPES.ego;
  const ego = {
    id: 'ego',
    kind: 'car',
    cls: 'car',
    ego: true,
    label: 'Mobil otonom',
    dir: 1,
    s: street.route.start,
    d: LINES.ego,
    dTarget: LINES.ego,
    v: EGO_CRUISE,
    vd: 0,
    cruise: EGO_CRUISE,
    vmax: 8,
    length: T.length,
    width: T.width,
    aMax: T.aMax,
    aComfort: T.aComfort,
    aBrake: T.aBrake,
    latRate: T.latRate,
    braking: false,
    mode: 'cruise',
  };
  const traffic = []; // kendaraan selain mobil otonom
  const peds = []; // pejalan kaki
  // stress: mode uji beban (dipakai skrip uji, bukan oleh pelajar): lalu lintas padat dan penyeberang terus-menerus
  const state = { time: 0, lap: 0, yielding: false, serial: 1, nextWalker: 0, nextWest: 0, nextCyclist: 0, nextEastMotor: 0, stress: false };
  const safety = {
    lesson: 'persepsi',
    signals: 0, // tidak ada lampu lalu lintas di ruas ini
    redLightViolations: 0, // "Terobos lampu merah"
    pedestrianContacts: 0, // "Kontak dengan pejalan kaki" (kejadian)
    pedestrianContactTicks: 0,
    otherCollisions: 0, // tabrakan kendaraan dengan kendaraan (dihitung terpisah)
    shieldBrakes: 0, // berapa kali perisai mengambil alih rem
    shieldClamps: 0, // berapa kali posisi harus dijepit (seharusnya 0)
    vehicleClamps: 0, // penjepitan di belakang kendaraan lain
    gapWaits: 0, // berapa kali penyeberang menunggu karena celah belum aman
    crossings: 0,
    boardings: 0,
    minPedGap: Infinity, // jarak terkecil pejalan kaki ke kendaraan yang bergerak (m)
    ticks: 0,
    log: [], // contoh campur tangan perisai (untuk uji)
    clampLog: [],
  };
  const contactPairs = new Set();
  const collisionPairs = new Set();

  // ---------- pembuat pelaku ----------
  function makeVehicle(kind, dir, s, d, extra = {}) {
    const t = TYPES[kind];
    const cruise = extra.cruise ?? rng.range(t.cruise[0], t.cruise[1]);
    const v = {
      id: `${kind === 'city' || kind === 'mpv' ? 'mobil' : kind}-${state.serial++}`,
      kind,
      cls: CLS_OF[kind],
      role: 'traffic',
      dir,
      s,
      d,
      dTarget: d,
      v: extra.v ?? cruise,
      vd: 0,
      cruise,
      vmax: cruise + 1,
      length: t.length,
      width: t.width,
      aMax: t.aMax,
      aComfort: t.aComfort,
      aBrake: t.aBrake,
      latRate: t.latRate,
      braking: false,
      mode: 'cruise',
      color: kind === 'angkot' ? COLORS.angkot : kind === 'motor' ? rng.pick(['#64748b', '#1f2937', '#b91c1c', '#1d4ed8', '#e2e8f0']) : rng.pick(COLORS.vehicles),
      ...extra,
    };
    if (kind === 'motor') {
      v.helmet = rng.pick(COLORS.helmets);
      v.jacket = rng.pick(JACKETS);
      v.passenger = rng.chance(0.3);
      v.passengerHelmet = rng.pick(COLORS.helmets);
    }
    syncVehicle(v, true);
    traffic.push(v);
    return v;
  }

  function makePed(role, s, d, extra = {}) {
    const variant = rng.pick(VARIANTS);
    const p = {
      id: `${role === 'crosser' ? 'penyeberang' : role === 'passenger' ? 'penumpang' : 'pejalan'}-${state.serial++}`,
      kind: 'pedestrian',
      cls: 'pedestrian',
      role,
      radius: 0.35,
      s,
      d,
      line: d,
      dir: 1,
      vs: 0,
      vd: 0,
      cruise: rng.range(1.1, 1.45),
      goalD: d,
      step: rng.range(0, 6),
      variant,
      accent: variant === 'hijab' ? rng.pick(COLORS.hijab) : variant === 'umbrella' ? rng.pick(['#1d4ed8', '#be123c', '#0f766e', '#7c3aed']) : rng.pick(['#b45309', '#1e3a8a', '#374151', '#9d174d']),
      color: rng.pick(SHIRTS),
      alpha: 1,
      state: 'walk',
      x: 0,
      y: 0,
      heading: 0,
      speed: 0,
      vx: 0,
      vy: 0,
      ...extra,
    };
    syncPed(p);
    peds.push(p);
    return p;
  }

  function spawnWalker(s) {
    const r = rng.next();
    const line = r < 0.36 ? { d: LINES.walkNorthEast, dir: 1 } : r < 0.68 ? { d: LINES.walkNorthWest, dir: -1 } : { d: LINES.walkSouth, dir: -1 };
    const p = makePed('walker', s, line.d, { dir: line.dir, line: line.d, goalD: line.d });
    p.vs = p.cruise;
    return p;
  }

  // ---------- pose dunia ----------
  function syncVehicle(v, init = false) {
    const p = street.pose(v.s, v.d);
    const h = p.heading;
    const vx = v.dir * v.v * Math.cos(h) + v.vd * Math.sin(h);
    const vy = v.dir * v.v * Math.sin(h) - v.vd * Math.cos(h);
    v.x = p.x;
    v.y = p.y;
    v.vx = vx;
    v.vy = vy;
    v.speed = v.v;
    if (init || Math.hypot(vx, vy) > 0.3) v.heading = init ? h + (v.dir < 0 ? Math.PI : 0) : Math.atan2(vy, vx);
    else {
      // hampir diam: arah pelan-pelan kembali sejajar jalan
      const target = h + (v.dir < 0 ? Math.PI : 0);
      const diff = angleDiff(target, v.heading);
      if (Math.abs(diff) > 0.2) v.heading = target - Math.sign(diff) * 0.2;
    }
  }

  function syncPed(p) {
    const q = street.pose(p.s, p.d);
    const h = q.heading;
    const along = p.dir * p.vs;
    p.x = q.x;
    p.y = q.y;
    p.vx = along * Math.cos(h) + p.vd * Math.sin(h);
    p.vy = along * Math.sin(h) - p.vd * Math.cos(h);
    p.speed = Math.hypot(p.vx, p.vy);
    if (p.speed > 0.05) p.heading = Math.atan2(p.vy, p.vx);
    else if (p.face != null) p.heading = h + p.face;
  }

  // ---------- bantuan geometri Frenet ----------
  const front = (v) => v.s + (v.dir * v.length) / 2;
  const rear = (v) => v.s - (v.dir * v.length) / 2;
  const bandOf = (v, tol = 0) => [Math.min(v.d, v.dTarget) - v.width / 2 - tol, Math.max(v.d, v.dTarget) + v.width / 2 + tol];
  const overlaps = (a, b) => a[0] < b[1] && b[0] < a[1];
  const movers = () => [ego, ...traffic];
  const aBrakeOf = (v) => Math.min(v.aBrake, ROAD_MU * G);
  const stopDist = (v, a) => (v.v * v.v) / (2 * a) + v.v * LATENCY;

  /** Kendaraan terdekat di depan `v` yang melebar ke pita lateralnya. */
  function leaderOf(v, band = bandOf(v, 0.15)) {
    let best = null;
    let bestGap = Infinity;
    for (const o of movers()) {
      if (o === v) continue;
      const ahead = v.dir * (o.s - v.s);
      if (ahead <= 0) continue;
      if (!overlaps(band, bandOf(o))) continue;
      const gap = ahead - (v.length + o.length) / 2;
      if (gap < bestGap) {
        bestGap = gap;
        best = o;
      }
    }
    return best ? { o: best, gap: bestGap, v: best.dir === v.dir ? best.v : 0 } : null;
  }

  function crosserOf(cw) {
    return peds.find((p) => p.role === 'crosser' && p.cw === cw) || null;
  }

  const occupied = (cw) => peds.some((p) => p.role === 'crosser' && p.cw === cw && p.state === 'cross');
  const wallOf = (v, cw) => cw.s - v.dir * (cw.half + CW_BUFFER);

  /**
   * Semua batas keras di depan kendaraan: zebra cross yang sedang dipakai dan pejalan kaki di
   * koridornya (sekarang atau dalam PRED_HORIZON detik). Hasil: s posisi dinding, terurut.
   */
  function wallsFor(v) {
    const walls = [];
    const f = front(v);
    for (const cw of street.crosswalks) {
      if (!occupied(cw)) continue;
      const w = wallOf(v, cw);
      if (v.dir * (w - f) >= -0.05) walls.push({ s: w, why: cw.id });
    }
    const band = bandOf(v, LAT_MARGIN);
    for (const p of peds) {
      const ahead = v.dir * (p.s - f);
      if (ahead < -0.05 || ahead > 60) continue;
      let lo = p.d;
      let hi = p.d;
      if (Math.abs(p.vd) > 0.02) {
        const end = p.d + p.vd * PRED_HORIZON;
        const goal = p.goalD ?? end;
        const lim = p.vd > 0 ? Math.min(end, Math.max(goal, p.d)) : Math.max(end, Math.min(goal, p.d));
        lo = Math.min(p.d, lim);
        hi = Math.max(p.d, lim);
      }
      if (overlaps([lo - p.radius, hi + p.radius], band)) walls.push({ s: p.s - v.dir * (p.radius + PED_BUFFER), why: p.id });
    }
    return walls;
  }

  // ---------- pejalan kaki ----------
  function gapOK(cw) {
    for (const v of movers()) {
      const lo = Math.min(v.s - v.length / 2, v.s + v.length / 2);
      const hi = Math.max(v.s - v.length / 2, v.s + v.length / 2);
      if (hi > cw.s - cw.half - 1 && lo < cw.s + cw.half + 1) return false; // ada kendaraan di atas zebra
      const dist = v.dir * (wallOf(v, cw) - front(v));
      const passed = v.dir * (rear(v) - (cw.s + v.dir * (cw.half + 1))) > 0;
      if (passed) continue;
      if (dist < 0) return false;
      // bisa berhenti dengan NYAMAN (lebih ketat daripada rem penuh perisai)
      if (dist < stopDist(v, Math.min(v.aComfort, aBrakeOf(v))) + GAP_MARGIN) return false;
    }
    return true;
  }

  function crossTrigger(cw) {
    if (state.stress) return true; // uji beban: menyeberang kapan pun celahnya aman
    const dz = cw.s - cw.half - front(ego);
    return (dz >= 10 && dz <= 33) || rear(ego) > cw.s + cw.half + 1;
  }

  function updatePed(p, dt) {
    if (p.role === 'crosser') {
      if (p.state === 'wait') {
        p.vs = 0;
        p.vd = 0;
        if (crossTrigger(p.cw)) {
          if (gapOK(p.cw)) {
            p.state = 'cross';
            p.goalD = LINES.walkNorthEast;
            safety.crossings++;
          } else if (!p.waitedCounted) {
            p.waitedCounted = true;
            safety.gapWaits++;
          }
        }
        return;
      }
      if (p.state === 'cross') {
        p.vd = approach(p.vd, CROSS_SPEED, 1.2 * dt);
        p.d += p.vd * dt;
        p.step += dt * 7;
        if (p.d >= LINES.walkNorthEast) {
          p.d = LINES.walkNorthEast;
          p.vd = 0;
          p.role = 'walker';
          p.state = 'walk';
          p.line = LINES.walkNorthEast;
          p.goalD = p.line;
          p.dir = 1;
          p.vs = 0.3;
          p.cw.crosser = null;
          p.cw = null;
        }
        return;
      }
    }
    if (p.role === 'passenger') {
      const h = p.halte;
      if (p.state === 'wait') {
        p.vs = 0;
        p.vd = 0;
        const a = h.claimedBy;
        if (a && a.mode === 'board' && a.doorOpen) p.state = 'toDoor';
        return;
      }
      if (p.state === 'toDoor' || p.state === 'back') {
        const a = h.claimedBy;
        if (p.state === 'toDoor' && !a) p.state = 'back';
        const ts = p.state === 'back' ? h.s + 0.3 : a.s + a.dir * DOOR_OFFSET;
        const td = p.state === 'back' ? LINES.passengerWait : LINES.door;
        const ds = ts - p.s;
        const dd = td - p.d;
        const dist = Math.hypot(ds, dd);
        const sp = Math.min(1.1, dist / dt);
        if (dist < 0.05) {
          p.state = p.state === 'back' ? 'wait' : 'board';
          p.t0 = state.time;
          p.vs = 0;
          p.vd = 0;
          return;
        }
        p.dir = Math.sign(ds) || 1;
        p.vs = (Math.abs(ds) / dist) * sp;
        p.vd = (dd / dist) * sp;
        p.s += p.dir * p.vs * dt;
        p.d += p.vd * dt;
        p.step += dt * 6;
        return;
      }
      if (p.state === 'board') {
        p.alpha = Math.max(0, 1 - (state.time - p.t0) / 0.6);
        if (p.alpha <= 0) {
          p.gone = true;
          const a = h.claimedBy;
          if (a) a.boardedAt = state.time;
          h.waiting = null;
          safety.boardings++;
        }
        return;
      }
    }
    // pejalan kaki di trotoar
    let target = p.cruise;
    let side = 0;
    for (const o of peds) {
      if (o === p || o.gone) continue;
      const ahead = p.dir * (o.s - p.s);
      if (ahead <= 0 || ahead > 3) continue;
      const dd = Math.abs(o.d - p.d);
      const still = o.speed < 0.1 && o.role !== 'walker';
      if (still && Math.abs(o.d - p.line) < 0.8) side = 1;
      else if (dd < 0.72 && ahead < 1.3) target = Math.min(target, o.dir === p.dir ? o.vs : 0);
    }
    p.goalD = p.line + (side ? Math.sign(p.line) * 0.8 : 0);
    p.vs = approach(p.vs, target, 1.5 * dt);
    p.s += p.dir * p.vs * dt;
    const nd = approach(p.d, p.goalD, 0.45 * dt);
    p.vd = (nd - p.d) / dt;
    p.d = nd;
    p.step += dt * 5.5 * p.vs;
  }

  // ---------- kendaraan ----------
  function stripFree(v) {
    for (const o of movers()) {
      if (o === v || o.dir === v.dir) continue;
      const rel = v.dir * (o.s - v.s);
      if (rel < -20 || rel > 110) continue;
      if (o.mode === 'pass' || o.mode === 'merge' || overlaps(bandOf(o), STRIP)) return false;
    }
    return true;
  }

  function laneGapFor(v, d) {
    const band = [d - v.width / 2 - 0.2, d + v.width / 2 + 0.2];
    for (const o of movers()) {
      if (o === v) continue;
      if (!overlaps(band, bandOf(o))) continue;
      const rel = v.dir * (o.s - v.s);
      const ov = o.dir === v.dir ? o.v : -o.v;
      const need = rel >= 0 ? (v.length + o.length) / 2 + 6 + Math.max(0, v.v - ov) * 2 : (v.length + o.length) / 2 + 4 + Math.max(0, ov - v.v) * 2.5;
      if (Math.abs(rel) < need) return false;
    }
    return true;
  }

  function planMotor(v) {
    const cruiseD = v.dir > 0 ? LINES.eastMotor : LINES.westMotor;
    const passD = v.dir > 0 ? LINES.eastPass : LINES.westPass;
    if (v.mode === 'cruise') {
      const lead = leaderOf(v, [v.d - v.width / 2 - 0.15, v.d + v.width / 2 + 0.15]);
      if (lead && lead.gap < 22 && lead.v < v.cruise - 1 && v.v > 1 && stripFree(v) && laneGapFor(v, passD)) {
        v.mode = 'pass';
        v.dTarget = passD;
      }
    } else if (v.mode === 'pass') {
      if (!stripFree(v) && laneGapFor(v, cruiseD)) {
        v.mode = 'merge';
        v.dTarget = cruiseD;
      } else if (Math.abs(v.d - passD) < 0.05 && laneGapFor(v, cruiseD)) {
        v.mode = 'merge';
        v.dTarget = cruiseD;
      }
    } else if (v.mode === 'merge' && Math.abs(v.d - cruiseD) < 0.03) v.mode = 'cruise';
  }

  /** Keadaan angkot yang menepi di halte. Mengembalikan jarak ke titik berhenti, atau null. */
  function planAngkot(v) {
    if (v.dir > 0) return null;
    if (v.mode === 'cruise' && !v.served) {
      for (const h of street.haltes) {
        if (!h.waiting || h.claimedBy || h.waiting.state !== 'wait') continue;
        const stopS = h.waiting.s + DOOR_OFFSET;
        const dist = v.s - stopS;
        if (dist > (v.v * v.v) / (2 * 0.8) + 15 && dist < 140) {
          v.mode = 'approach';
          v.pickup = h;
          v.stopS = stopS;
          h.claimedBy = v;
          break;
        }
      }
    }
    if (v.mode === 'approach') {
      const dist = v.s - v.stopS;
      if (dist < 45 && v.dTarget !== LINES.westCurb) {
        // menepi hanya bila sisi kiri (pesepeda, sepeda motor) kosong
        if (laneGapFor(v, LINES.westCurb)) v.dTarget = LINES.westCurb;
        else if (dist < 14) {
          v.mode = 'cruise';
          v.served = true;
          v.pickup.claimedBy = null;
          v.pickup = null;
          return null;
        }
      }
      if (dist < 0.3 && v.v < 0.05 && Math.abs(v.d - LINES.westCurb) < 0.05) {
        v.mode = 'board';
        v.t0 = state.time;
      }
      return dist;
    }
    if (v.mode === 'board') {
      const t = state.time - v.t0;
      const boarded = v.boardedAt != null;
      const pax = v.pickup ? v.pickup.waiting : null;
      const closing = (boarded && state.time - v.boardedAt > 0.7) || (!boarded && !pax && t > 1.5) || t > 14;
      if (closing && v.closeAt == null) v.closeAt = state.time;
      v.doorOpen = t > 0.6 && !closing;
      if (closing && state.time - v.closeAt > 0.5 && laneGapFor(v, LINES.westCar)) {
        v.mode = 'depart';
        v.served = true;
        v.dTarget = LINES.westCar;
        if (v.pickup) v.pickup.claimedBy = null;
        v.pickup = null;
        return null;
      }
      return 0;
    }
    if (v.mode === 'depart' && Math.abs(v.d - LINES.westCar) < 0.03) v.mode = 'cruise';
    return null;
  }

  /**
   * Perlambatan untuk berhenti tepat dalam jarak D (m). Mulai mengerem saat perlambatan yang
   * dibutuhkan mencapai separuh perlambatan nyaman, lalu mengerem rata sampai berhenti.
   */
  function stopAccel(v, D) {
    if (D <= 0.05) return -Math.min(4, aBrakeOf(v));
    const req = (v.v * v.v) / (2 * D);
    return req >= 0.5 * v.aComfort ? -req : Infinity;
  }

  /** Percepatan yang diminta perencana (belum melewati perisai keselamatan). */
  function planAccel(v) {
    let target = v.cruise;
    const stops = [];
    if (v.kind === 'motor') planMotor(v);
    if (v.kind === 'angkot') {
      const D = planAngkot(v);
      if (D != null) stops.push(D);
    }
    const lead = leaderOf(v);
    if (lead) {
      target = Math.min(target, followingSpeed(lead.gap, lead.v, { cruise: v.cruise, minGap: v.kind === 'motor' || v.kind === 'cyclist' ? 1.6 : 2.5, timeGap: 1.2, decel: 3 }));
      // jangan berhenti di atas zebra cross saat antre
      if (lead.v < 0.5) {
        const stopFront = rear(lead.o) - v.dir * 2.5;
        const tail = stopFront - v.dir * v.length;
        for (const cw of street.crosswalks) {
          const lo = cw.s - cw.half - 0.5;
          const hi = cw.s + cw.half + 0.5;
          const dist = v.dir * (wallOf(v, cw) - front(v));
          if (Math.min(stopFront, tail) < hi && Math.max(stopFront, tail) > lo && dist > -0.05) stops.push(dist - 1);
        }
      }
    }
    // zebra cross yang sedang dipakai: berhenti 1 m sebelum batas perisai
    for (const cw of street.crosswalks) {
      if (!occupied(cw)) continue;
      const dist = v.dir * (wallOf(v, cw) - front(v));
      if (dist > -0.05) stops.push(dist - 1);
    }
    for (const D of stops) target = Math.min(target, D <= 0.05 ? 0 : speedToStop(D, 0.5 * v.aComfort));
    let a = clamp((target - v.v) * (v.ego ? 2.2 : 2), -Math.min(4, aBrakeOf(v)), v.aMax);
    for (const D of stops) a = Math.min(a, stopAccel(v, D));
    return clamp(a, -Math.min(4, aBrakeOf(v)), v.aMax);
  }

  /** Satu langkah fisika untuk kendaraan v: perencana, perisai keselamatan, integrasi, penjepit. */
  function stepVehicle(v, dt) {
    let a = planAccel(v);

    // ----- perisai keselamatan -----
    const walls = wallsFor(v);
    let wall = null;
    let wallDist = Infinity;
    let why = '';
    for (const w of walls) {
      const dist = v.dir * (w.s - front(v));
      if (dist < wallDist) {
        wallDist = dist;
        wall = w.s;
        why = w.why;
      }
    }
    const aB = aBrakeOf(v);
    let shield = false;
    if (wall != null && wallDist - SHIELD_MARGIN <= stopDist(v, aB) + v.v * dt) {
      // hanya dihitung bila perisai benar-benar mengubah perintah kendaraan yang masih bergerak
      if (v.v > 0.05 && a > -aB * 0.9 && !v.shielding) {
        safety.shieldBrakes++;
        if (safety.log.length < 40) safety.log.push({ t: +state.time.toFixed(2), id: v.id, v: +v.v.toFixed(2), a: +a.toFixed(2), wallDist: +wallDist.toFixed(2), why, d: +v.d.toFixed(2), mode: v.mode });
      }
      a = -aB;
      shield = true;
    }
    v.shielding = shield;

    // ----- integrasi (dt tetap) -----
    const v0 = v.v;
    let v1 = clamp(v0 + a * dt, 0, v.vmax);
    let s1 = v.s + (v.dir * (v0 + v1) * dt) / 2;
    if (wall != null && v.dir * (s1 + (v.dir * v.length) / 2 - wall) > 0) {
      s1 = wall - (v.dir * v.length) / 2;
      v1 = 0;
      safety.shieldClamps++;
    }
    // jangan pernah menumpuk di belakang kendaraan lain
    const lead = leaderOf(v, bandOf(v, 0.05));
    if (lead) {
      const limit = rear(lead.o) - v.dir * 0.3;
      if (v.dir * (s1 + (v.dir * v.length) / 2 - limit) > 0) {
        const held = limit - (v.dir * v.length) / 2;
        s1 = v.dir * (held - v.s) >= 0 ? held : v.s;
        v1 = Math.min(v1, lead.v);
        safety.vehicleClamps++;
        if (safety.clampLog.length < 20) safety.clampLog.push({ t: +state.time.toFixed(2), id: v.id, mode: v.mode, d: +v.d.toFixed(2), dT: +v.dTarget.toFixed(2), lead: lead.o.id, lmode: lead.o.mode, ld: +lead.o.d.toFixed(2), gap: +lead.gap.toFixed(2), v: +v.v.toFixed(2), lv: +lead.o.v.toFixed(2) });
      }
    }
    const maxVd = Math.min(v.latRate, 0.12 * Math.max(v0, v1));
    const nd = approach(v.d, v.dTarget, maxVd * dt);
    v.vd = (nd - v.d) / dt;
    v.d = nd;
    v.accel = (v1 - v0) / dt;
    v.v = v1;
    v.s = s1;
    v.braking = v.accel < -0.6 || (v1 < 0.05 && a < 0);
  }

  // ---------- kemunculan ----------
  function spawnClear(dir, s, d, width, length, speed) {
    const band = [d - width / 2 - 0.2, d + width / 2 + 0.2];
    for (const o of movers()) {
      if (!overlaps(band, bandOf(o))) continue;
      if (Math.abs(o.s - s) < (length + o.length) / 2 + 12) return false;
    }
    // kendaraan baru harus bisa berhenti dengan nyaman untuk setiap batas keras di depannya,
    // dan tidak boleh muncul di atas atau di dekat zebra cross yang dipakai atau ditunggu
    const probe = { dir, s, d, dTarget: d, width, length, v: speed, aComfort: 2, aBrake: 4 };
    const need = stopDist(probe, 2) + 8;
    for (const w of wallsFor(probe)) if (dir * (w.s - front(probe)) < need) return false;
    for (const cw of street.crosswalks) {
      if (!occupied(cw) && !(crosserOf(cw)?.state === 'wait')) continue;
      const lo = cw.s - cw.half - CW_BUFFER - 1;
      const hi = cw.s + cw.half + CW_BUFFER + 1;
      if (s + length / 2 > lo && s - length / 2 < hi) return false;
      const dist = dir * (wallOf(probe, cw) - front(probe));
      if (dist >= 0 && dist < need) return false;
    }
    return true;
  }

  function spawnWest(s) {
    const waiting = street.haltes.some((h) => h.waiting && !h.claimedBy && h.s < s - 30);
    const r = rng.next();
    const kind = waiting && r < 0.55 ? 'angkot' : r < 0.3 ? rng.pick(['car', 'city', 'mpv', 'city']) : r < 0.5 ? 'angkot' : r < 0.78 ? 'motor' : rng.pick(['car', 'city', 'mpv']);
    const d = kind === 'motor' ? LINES.westMotor : LINES.westCar;
    const t = TYPES[kind];
    const cruise = rng.range(t.cruise[0], t.cruise[1]);
    if (!spawnClear(-1, s, d, t.width, t.length, cruise)) return false;
    makeVehicle(kind, -1, s, d, { cruise });
    return true;
  }

  function spawn() {
    const t = state.time;
    const L = street.length;
    if (t >= state.nextWalker) {
      if (peds.filter((p) => p.role === 'walker').length < 12) {
        const s = ego.s + rng.range(70, 95);
        if (s < L - 2) spawnWalker(s);
      }
      state.nextWalker = t + rng.range(2.5, 5);
    }
    if (t >= state.nextWest) {
      const s = Math.min(ego.s + rng.range(115, 135), L - 3);
      if (s > ego.s + 55 && spawnWest(s)) state.nextWest = t + (state.stress ? rng.range(1.5, 3) : rng.range(4.5, 8));
      else state.nextWest = t + (state.stress ? 0.3 : 1);
    }
    if (t >= state.nextCyclist) {
      const s = Math.min(ego.s + 110, L - 3);
      const tt = TYPES.cyclist;
      if (s > ego.s + 55 && spawnClear(-1, s, LINES.westCycle, tt.width, tt.length, 4.3)) {
        makeVehicle('cyclist', -1, s, LINES.westCycle, { cruise: rng.range(4, 4.6) });
        state.nextCyclist = t + rng.range(16, 24);
      } else state.nextCyclist = t + 1.5;
    }
    if (t >= state.nextEastMotor) {
      const s = ego.s - 45;
      const tt = TYPES.motor;
      const cruise = rng.range(tt.cruise[0], tt.cruise[1]);
      if (s > 3 && spawnClear(1, s, LINES.eastMotor, tt.width, tt.length, cruise)) {
        makeVehicle('motor', 1, s, LINES.eastMotor, { cruise });
        state.nextEastMotor = t + (state.stress ? rng.range(2, 4) : rng.range(8, 14));
      } else state.nextEastMotor = t + (state.stress ? 0.3 : 1.5);
    }
    for (const h of street.haltes) {
      if (!h.waiting && h.s > ego.s + 25 && h.s < ego.s + 150 && t >= h.nextSpawn) {
        h.waiting = makePed('passenger', h.s + 0.3, LINES.passengerWait, { state: 'wait', halte: h, face: -Math.PI / 2, dir: 1 });
        h.nextSpawn = t + 45;
        state.nextWest = Math.min(state.nextWest, t + 1);
      }
    }
    for (const cw of street.crosswalks) {
      if (cw.crosser || (cw.lap === state.lap && !state.stress)) continue;
      if (state.stress ? cw.s > ego.s - 60 && cw.s < ego.s + 140 : cw.s > ego.s + 22 && cw.s < ego.s + 140) {
        cw.lap = state.lap;
        cw.crosser = makePed('crosser', cw.s + 0.9, LINES.crossWait, { state: 'wait', cw, face: -Math.PI / 2, goalD: LINES.crossWait });
      }
    }
  }

  function cleanup() {
    const L = street.length;
    for (let i = traffic.length - 1; i >= 0; i--) {
      const v = traffic[i];
      const gone = v.dir < 0 ? v.s < ego.s - 60 || v.s < 1 : v.s > ego.s + 150 || v.s > L - 2;
      if (gone) {
        if (v.pickup) v.pickup.claimedBy = null;
        traffic.splice(i, 1);
      }
    }
    for (let i = peds.length - 1; i >= 0; i--) {
      const p = peds[i];
      const far = p.s < ego.s - 50 || p.s > ego.s + 170 || p.s < 1 || p.s > L - 1;
      if (p.gone || (far && p.role === 'walker') || (far && p.role === 'passenger' && p.state === 'wait')) {
        if (p.role === 'passenger' && p.halte && p.halte.waiting === p) {
          p.halte.waiting = null;
          if (p.halte.claimedBy) {
            p.halte.claimedBy.pickup = null;
            p.halte.claimedBy = null;
          }
        }
        if (p.cw && p.cw.crosser === p) p.cw.crosser = null;
        peds.splice(i, 1);
      }
    }
  }

  // ---------- pemantau invarian (geometri dunia, mandiri dari perisai) ----------
  function monitor() {
    safety.ticks++;
    const mv = movers();
    const parked = street.parked.filter((c) => Math.abs(c.s - ego.s) < 120);
    const nowContact = new Set();
    for (const p of peds) {
      if (p.gone) continue;
      for (const v of mv) {
        if (Math.abs(v.s - p.s) > v.length / 2 + 3) continue;
        const g = distanceToBox(p.x, p.y, v) - p.radius;
        if (v.v > 0.05 && g < safety.minPedGap) safety.minPedGap = g;
        if (g < 0) nowContact.add(`${p.id}|${v.id}`);
      }
      for (const c of parked) {
        if (Math.abs(c.s - p.s) > 4) continue;
        if (distanceToBox(p.x, p.y, c) < p.radius) nowContact.add(`${p.id}|${c.id}`);
      }
    }
    if (nowContact.size) safety.pedestrianContactTicks++;
    for (const k of nowContact) if (!contactPairs.has(k)) safety.pedestrianContacts++;
    contactPairs.clear();
    for (const k of nowContact) contactPairs.add(k);

    const nowCol = new Set();
    for (let i = 0; i < mv.length; i++) {
      for (let j = i + 1; j < mv.length; j++) {
        const a = mv[i];
        const b = mv[j];
        if (Math.abs(a.s - b.s) > (a.length + b.length) / 2 + 0.5) continue;
        if (boxesOverlap(a, b)) nowCol.add(`${a.id}|${b.id}`);
      }
    }
    for (const k of nowCol) if (!collisionPairs.has(k)) safety.otherCollisions++;
    collisionPairs.clear();
    for (const k of nowCol) collisionPairs.add(k);
  }

  // ---------- siklus ----------
  function populate() {
    for (const dx of [8, 20, 33, 47, 60, 74]) spawnWalker(ego.s + dx + rng.range(-2, 2));
    makeVehicle('city', -1, ego.s + 64, LINES.westCar, { cruise: 7.6 });
    makeVehicle('cyclist', -1, ego.s + 38, LINES.westCycle, { cruise: 4.3 });
    makeVehicle('motor', 1, ego.s - 22, LINES.eastMotor, { cruise: 9 });
    state.nextWalker = state.time + 3;
    state.nextWest = state.time + 5;
    state.nextCyclist = state.time + 17;
    state.nextEastMotor = state.time + 9;
    for (const h of street.haltes) {
      h.waiting = null;
      h.claimedBy = null;
      h.nextSpawn = state.time;
    }
    for (const cw of street.crosswalks) {
      cw.crosser = null;
      cw.lap = -1;
    }
  }

  function startLap() {
    traffic.length = 0;
    peds.length = 0;
    contactPairs.clear();
    collisionPairs.clear();
    ego.s = street.route.start;
    ego.d = LINES.ego;
    ego.dTarget = LINES.ego;
    ego.v = EGO_CRUISE;
    ego.vd = 0;
    ego.shielding = false;
    syncVehicle(ego, true);
    populate();
  }

  function update(dt) {
    state.time += dt;
    if (ego.s >= street.route.end) {
      state.lap++;
      startLap();
    }
    spawn();
    for (const p of peds) updatePed(p, dt);
    stepVehicle(ego, dt);
    const cwNear = street.crosswalks.some((cw) => occupied(cw) && egoApproaching(cw));
    state.yielding = ego.v < EGO_CRUISE - 0.05 && cwNear;
    for (const v of traffic) stepVehicle(v, dt);
    syncVehicle(ego);
    for (const v of traffic) syncVehicle(v);
    for (const p of peds) syncPed(p);
    cleanup();
    monitor();
  }

  function egoApproaching(cw) {
    const dist = wallOf(ego, cw) - front(ego);
    return dist > -0.5 && dist < 30;
  }

  function reset() {
    rng.reseed(seed);
    state.time = 0;
    state.lap = 0;
    state.serial = 1;
    state.yielding = false;
    startLap();
  }

  // ---------- data untuk sensor ----------
  /** Semua yang dibutuhkan pipeline persepsi pada saat ini (koordinat dunia). */
  function world() {
    const buildings = street.map.buildingsNear(ego.x, ego.y, 75);
    const near = (o, r) => Math.abs(o.s - ego.s) < r;
    const parked = street.parked.filter((c) => near(c, 90));
    const haltes = street.haltes.filter((h) => near(h, 90));
    const actors = [...traffic.filter((v) => near(v, 110)), ...peds.filter((p) => !p.gone && near(p, 110))];
    return {
      time: state.time,
      ego,
      objects: [...buildings, ...haltes.map((h) => h.box), ...parked, ...actors],
      relevant: [...parked, ...actors],
      adPanels: haltes.map((h) => h.ad),
      manholes: street.manholes.filter((m) => near(m, 70)),
    };
  }

  // ---------- menggambar ----------
  /** Gambar pengguna jalan. opts: { view, underlay(g) } (underlay di bawah kendaraan, misalnya jalur rencana). */
  function draw(g, { view, underlay = null }) {
    const b = view.visibleBounds();
    const vis = (o, r = 6) => o.x > b.minX - r && o.x < b.maxX + r && o.y > b.minY - r && o.y < b.maxY + r;
    const small = view.camera.scale < 13;
    for (const c of street.parked) if (vis(c)) drawVehicle(g, c, { view });
    underlay?.(g);
    for (const p of peds) {
      if (!vis(p, 2)) continue;
      drawPedestrian(g, p, { view, phase: p.step, minPx: small ? 11 : 12, variant: p.variant, accent: p.accent, color: p.color, alpha: p.alpha });
    }
    for (const v of traffic) {
      if (!vis(v) || (v.kind !== 'motor' && v.kind !== 'cyclist')) continue;
      drawVehicle(g, v, { view, minPx: v.kind === 'motor' ? 26 : 18, braking: v.braking, helmet: v.helmet, jacket: v.jacket, passenger: v.passenger, passengerHelmet: v.passengerHelmet });
    }
    for (const v of traffic) {
      if (!vis(v) || v.kind === 'motor' || v.kind === 'cyclist') continue;
      drawVehicle(g, v, { view, braking: v.braking, doorOpen: !!v.doorOpen });
    }
    drawCar(g, ego, { ego: true, braking: ego.braking, view });
  }

  reset();

  return {
    ego,
    traffic,
    peds,
    get actors() {
      return [...traffic, ...peds];
    },
    state,
    safety,
    street,
    update,
    reset,
    world,
    draw,
    occupied,
  };
}
