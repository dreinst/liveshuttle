// Dunia simulasi pelajaran Level Otomasi: jalan tol dua lajur searah (lalu lintas kiri), mobil
// otonom, satu mobil di depan, lalu lintas arah berlawanan di balik median, zona konstruksi, dan
// rambu batas area operasi (ODD). File ini berisi model dan perilaku tiap level SAE J3016.
// Teks, panel, dan deteksi tugas ada di ../level-otomasi.js.
//
// Penyederhanaan yang disengaja (disebut juga di teks pelajaran):
//   - Satu mobil depan dengan kecepatan berubah-ubah, tanpa lalu lintas lain di jalur kita.
//   - Sensor dianggap sempurna: sistem langsung tahu jarak dan kecepatan mobil depan.
//   - Aturan tiap level dibuat sederhana dan angka seperti hitungan mundur 10 detik adalah pilihan
//     untuk simulasi ini, bukan nilai baku.
//
// Koordinat jalan (s, d) dijelaskan di ./road.js. Mobil otonom (ego) memakai model sepeda
// kinematik di koordinat dunia; posisinya di jalan dihitung ulang setiap langkah.

import { Vehicle } from '../../engine/vehicle.js';
import { Path, boxesOverlap, pointInBox } from '../../engine/geometry.js';
import { purePursuit } from '../../engine/control.js';
import { followingSpeed } from '../../engine/traffic.js';
import { clamp, smoothstep, approach, kmhToMs, angleDiff, Rng, TAU, fmt } from '../../engine/math.js';
import { COLORS, withAlpha } from '../../engine/theme.js';
import { drawCar, drawBus, drawCone, drawPath, drawSensorCone, drawRing, drawBracketBox, drawLine, roundRectPath } from '../../engine/draw.js';
import { createRoad, PERIOD, LEFT_LANE, RIGHT_LANE, SHOULDER, EDGE_LEFT, EDGE_RIGHT, SHOULDER_OUT, MEDIAN_IN, OPP_LANES } from './road.js';

export const V_SET = kmhToMs(60); // kecepatan yang dipilih untuk sistem (ACC dan level 2 sampai 5)
export const TIME_GAP = 1.5; // jarak waktu ACC (detik)
export const MIN_GAP = 4; // jarak saat berhenti (m)
export const ACC_RANGE = 90; // jangkauan radar ACC di simulasi (m)
export const TOR_TIME = 10; // hitungan mundur permintaan ambil alih level 3 (detik)
export const MANUAL_DIST = 150; // tugas level 0 (m)

const L3_MRM_DECEL = 2.2; // perlambatan berhenti darurat di lajur (m/s^2)
const L4_MRM_DECEL = 1.3; // perlambatan saat menepi (m/s^2)
const ATT_FIRST = 3.5; // detik sampai pesan pertama "Pegang kemudi" setelah level 2 aktif
const ATT_EVERY = 12; // selang pesan berikutnya
const ATT_PROMPT = 4; // lama pesan sebelum peringatan keras
const ATT_WARN = 4; // lama peringatan keras sebelum kemudi diserahkan
const HUMAN_FCW_TTC = 2.6; // peringatan tabrakan depan (detik)

/** Jarak (m) sebelum kejadian di luar ODD saat level 3 harus mulai meminta ambil alih. */
export function torDistance(v) {
  return v * TOR_TIME + (v * v) / (2 * L3_MRM_DECEL) + 20;
}

export function createScene() {
  const road = createRoad();
  const rngLead = new Rng(101);
  const rngTraffic = new Rng(202);

  const ego = new Vehicle({
    id: 'ego',
    ego: true,
    label: 'Mobil otonom',
    maxSpeed: kmhToMs(90),
    maxAccel: 2.5,
    maxBrake: 8,
    maxSteer: 0.5,
    steerRate: 0.9,
  });
  const EGO_HL = ego.length / 2;

  const lead = {
    id: 'mobil-depan',
    kind: 'car',
    active: false,
    s: 0,
    d: LEFT_LANE,
    v: 0,
    vSched: kmhToMs(48),
    timer: 0,
    waiting: false,
    length: 4.5,
    width: 1.8,
    color: '#7d8fb0',
    braking: false,
    x: 0,
    y: 0,
    heading: 0,
  };

  const opp = [
    { d: OPP_LANES[1], kind: 'car', length: 4.5, width: 1.8, color: COLORS.vehicles[0], base: 15 },
    { d: OPP_LANES[1], kind: 'bus', length: 12, width: 2.5, color: COLORS.bus, base: 12.5 },
    { d: OPP_LANES[0], kind: 'car', length: 4.5, width: 1.8, color: COLORS.vehicles[4], base: 21 },
    { d: OPP_LANES[1], kind: 'car', length: 4.6, width: 1.8, color: COLORS.vehicles[3], base: 16 },
    { d: OPP_LANES[0], kind: 'car', length: 4.5, width: 1.8, color: COLORS.vehicles[5], base: 22 },
  ].map((c, i) => ({ ...c, id: `lawan-${i}`, s: 0, v: c.base, vNow: c.base, x: 0, y: 0, heading: Math.PI }));

  const st = {
    t: 0,
    level: 0,
    engaged: false,
    egoS: PERIOD,
    egoD: LEFT_LANE,
    headErr: 0,
    input: { left: false, right: false, gas: false, brake: false },
    signal: { left: false, right: false, hazard: false },
    acc: { mode: 'off', gap: Infinity, want: 0 },
    attention: { stage: 'ok', timer: 0, next: ATT_FIRST },
    ads: { phase: 'drive', left: 0, reason: null, eventS: null, stopS: null },
    plan: { d0: LEFT_LANE, d1: LEFT_LANE, s0: 0, s1: 1 },
    laneOverride: false,
    aeb: { active: false, hold: 0, target: null },
    fcw: false,
    ldw: null,
    obs: null,
    flash: null,
    events: [],
    counters: { manualDist: 0, accFollow: 0, mrcHold: 0 },
    zone: null,
    boundary: null,
    keepZone: false,
    keepBoundary: false,
    crashes: 0,
  };

  // ---------- bantuan ----------

  function flash(key, dur = 4) {
    st.flash = { key, until: st.t + dur };
  }
  const flashKey = () => (st.flash && st.t < st.flash.until ? st.flash.key : null);
  const humanDrives = () => st.level <= 2 || !st.engaged;
  const nearestLane = (d) => (Math.abs(d - LEFT_LANE) <= Math.abs(d - RIGHT_LANE) ? LEFT_LANE : RIGHT_LANE);

  function planD(s) {
    const p = st.plan;
    return p.d0 + (p.d1 - p.d0) * smoothstep(p.s0, p.s1, s);
  }

  /** Mulai perpindahan lateral yang halus ke d, kecuali sedang menuju ke sana. */
  function setLaneTarget(d, len) {
    if (Math.abs(st.plan.d1 - d) < 0.01) return;
    st.plan = { d0: st.egoD, d1: d, s0: st.egoS, s1: st.egoS + Math.max(1, len) };
  }

  /** Arahkan rencana ke tengah lajur terdekat (dipakai saat sistem mulai menyetir). */
  function snapPlan() {
    const target = st.egoD > EDGE_LEFT ? LEFT_LANE : nearestLane(st.egoD);
    const dd = Math.abs(target - st.egoD);
    st.plan = { d0: st.egoD, d1: target, s0: st.egoS, s1: st.egoS + (dd < 0.3 ? 1 : Math.max(25, ego.speed * 2.2)) };
  }

  const laneChangeLen = (v) => Math.max(40, v * 3);

  // ---------- zona konstruksi dan batas ODD ----------

  /** Posisi lateral garis kerucut: lajur kiri ditutup di antara s0 dan s1. */
  function coneLine(z, s) {
    const u = s - z.s0;
    if (u <= 0 || u >= 116) return 3.3;
    if (u < 36) return 3.3 - 2.95 * (u / 36);
    if (u < 96) return 0.35;
    return 0.35 + 2.95 * ((u - 96) / 20);
  }

  function makeZone(s0) {
    const z = { s0, s1: s0 + 116, signS: s0 - 150, obstacles: [] };
    const cones = [];
    for (let k = 0; k <= 9; k++) cones.push(s0 + 4 * k);
    for (let s = s0 + 44; s <= s0 + 92; s += 8) cones.push(s);
    for (let k = 0; k <= 5; k++) cones.push(s0 + 96 + 4 * k);
    for (const s of cones) z.obstacles.push({ kind: 'cone', s, d: coneLine(z, s), hl: 0.3, hw: 0.3, r: 0.3, hit: false });
    z.board = { kind: 'papan', s: s0 + 30, d: 2.2, hl: 0.5, hw: 1.1 };
    z.truck = { kind: 'truk', s: s0 + 66, d: 1.95, hl: 3.25, hw: 1.15 };
    z.obstacles.push(z.board, z.truck);
    return z;
  }

  function oddEventAhead() {
    const front = st.egoS + EGO_HL;
    let ev = null;
    const z = st.zone;
    if (z && front < z.s1 + 2) ev = { kind: 'zona', s: z.s0, dist: Math.max(0, z.s0 - front) };
    const b = st.boundary;
    if (b && front < b.s + 2) {
      const dist = Math.max(0, b.s - front);
      if (!ev || dist < ev.dist) ev = { kind: 'batas', s: b.s, dist };
    }
    return ev;
  }

  const outsideOdd = () => !!st.boundary && st.egoS > st.boundary.s - 1;

  // ---------- level dan keterlibatan sistem ----------

  function freshState() {
    st.ads = { phase: 'drive', left: 0, reason: null, eventS: null, stopS: null };
    st.attention = { stage: 'ok', timer: 0, next: ATT_FIRST };
    st.laneOverride = false;
    st.counters.accFollow = 0;
    st.counters.mrcHold = 0;
  }

  /** Aktifkan sistem level yang dipilih. Mengembalikan true bila berhasil. */
  function engage() {
    freshState();
    snapPlan();
    const n = st.level;
    if (n === 0) {
      st.engaged = false;
      return false;
    }
    if ((n === 3 || n === 4) && outsideOdd()) {
      st.engaged = false;
      flash('odd-outside', 4.5);
      return false;
    }
    if (n === 3) {
      const ev = oddEventAhead();
      if (ev && ev.dist <= torDistance(Math.max(ego.speed, V_SET))) {
        st.engaged = false;
        flash('l3-refuse', 4.5);
        return false;
      }
    }
    st.engaged = true;
    return true;
  }

  function setLevel(n) {
    st.level = n;
    st.flash = null;
    return engage();
  }

  function disengage(reason) {
    st.engaged = false;
    freshState();
    flash(reason, 4.5);
    st.events.push(reason);
  }

  /** Tombol "Pegang kemudi". Mengembalikan true bila menjawab pesan level 2 yang sedang tampil. */
  function pressHold() {
    if (st.level !== 2 || !st.engaged) return false;
    return answerHands();
  }

  function answerHands() {
    const a = st.attention;
    const asked = a.stage !== 'ok';
    a.stage = 'ok';
    a.timer = 0;
    a.next = ATT_EVERY;
    if (asked) {
      flash('l2-thanks', 2.5);
      st.events.push('l2-answered');
    }
    return asked;
  }

  /** Tombol "Ambil alih". Mengembalikan fase level 3 saat ditekan, atau null bila tidak berlaku. */
  function pressTakeover() {
    if (st.level !== 3 || !st.engaged) return null;
    const phase = st.ads.phase;
    st.engaged = false;
    freshState();
    snapPlan();
    flash(phase === 'drive' ? 'l3-taken-free' : 'l3-taken', 5);
    st.events.push(phase === 'tor' ? 'takeover-tor' : 'takeover');
    return phase;
  }

  function setInput(key, on) {
    st.input[key] = !!on;
    // menginjak rem mematikan ACC dan level 2, seperti di mobil sungguhan
    if (key === 'brake' && on && st.engaged && (st.level === 1 || st.level === 2)) disengage('brake-cancel');
  }

  /** Tombol mana yang sedang dipegang pengemudi (true = boleh dipakai). */
  function controlsFor() {
    const manual = st.level === 0 || !st.engaged;
    return {
      steer: manual || st.level <= 2,
      gas: manual || st.level <= 2,
      brake: manual || st.level <= 2,
      hold: st.engaged && st.level === 2,
      takeover: st.engaged && st.level === 3,
    };
  }

  // ---------- pengendali ----------

  function manualSteer() {
    const dir = (st.input.right ? 1 : 0) - (st.input.left ? 1 : 0); // positif = kanan
    if (!dir) return 0;
    const v = Math.max(Math.abs(ego.speed), 4);
    // sudut roda untuk percepatan samping sekitar 1,9 m/s^2, makin kecil saat makin cepat
    return dir * clamp((1.9 * ego.wheelbase) / (v * v), 0.012, 0.45);
  }

  function manualCmd() {
    const v = ego.speed;
    let accel = -(0.15 + 0.0006 * v * v); // hambatan gulir dan udara saat gas dilepas
    let brake = 0;
    if (st.input.gas && !st.input.brake) accel = 2.4 * (1 - v / 26);
    if (st.input.brake) {
      brake = 6;
      accel = 0;
    }
    return { accel, brake, steer: manualSteer() };
  }

  /** ACC: jaga kecepatan pilihan, atau jarak waktu di belakang mobil depan bila ada. */
  function accAccel(obs, vSet) {
    const v = ego.speed;
    let a = clamp(0.7 * (vSet - v), -2.5, 1.4);
    st.acc.mode = 'cruise';
    if (obs && obs.kind === 'car' && obs.gap < ACC_RANGE) {
      const want = MIN_GAP + TIME_GAP * v;
      const af = clamp(0.22 * (obs.gap - want) + 0.75 * (obs.v - v), -4, 1.4);
      if (af < a) a = af;
      st.acc.mode = 'follow';
      st.acc.gap = obs.gap;
      st.acc.want = want;
    }
    return a;
  }

  /**
   * Percepatan agar berhenti tepat di stopS. Sebelum mencapai kurva pengereman (v^2 / 2d = decel)
   * mobil boleh terus melaju; sesudahnya mobil mengerem dengan perlambatan tetap v^2 / 2d.
   */
  function stopCap(stopS, decel) {
    const d = stopS - (st.egoS + EGO_HL) - 0.3;
    const v = ego.speed;
    if (d <= 0.05) return v > 0.05 ? -8 : 0;
    const need = (v * v) / (2 * d);
    if (need >= decel * 0.98) return -Math.min(8, need);
    return clamp(1.5 * (Math.sqrt(2 * decel * d) - v), 0, 1.5);
  }

  /** Sistem level 3 ke atas tidak menabrak benda diam di lajurnya (cadangan keselamatan). */
  function staticGuard(obs) {
    if (!obs || obs.kind === 'car') return Infinity;
    return stopCap(obs.s - obs.hl - 4, 3);
  }

  function systemSteer() {
    const pts = [];
    for (let k = -1; k <= 14; k++) {
      const s = st.egoS + k * 4;
      const w = road.toWorld(s, planD(s));
      pts.push({ x: w.x, y: w.y });
    }
    return purePursuit(ego, new Path(pts), { lookahead: 5, gain: 0.55 }).steer;
  }

  function attentionUpdate(dt) {
    const a = st.attention;
    a.timer += dt;
    if (a.stage === 'ok' && a.timer >= a.next) {
      a.stage = 'prompt';
      a.timer = 0;
    } else if (a.stage === 'prompt' && a.timer >= ATT_PROMPT) {
      a.stage = 'warn';
      a.timer = 0;
    } else if (a.stage === 'warn' && a.timer >= ATT_WARN) {
      disengage('l2-handback');
    }
  }

  function controlL1(obs) {
    const m = manualCmd();
    let a = accAccel(obs, V_SET);
    if (st.input.gas) a = Math.max(a, m.accel);
    return { accel: a, brake: 0, steer: m.steer };
  }

  function controlL2(dt, obs) {
    attentionUpdate(dt);
    if (!st.engaged) return manualCmd();
    const z = st.zone;
    if (z && z.s0 - (st.egoS + EGO_HL) < 100 && st.egoS < z.s1) {
      // level 2 tidak dirancang untuk zona konstruksi: kemudi diserahkan ke pengemudi
      disengage('l2-zone');
      return manualCmd();
    }
    const m = manualCmd();
    let a = accAccel(obs, V_SET);
    if (st.attention.stage === 'warn') a = Math.min(a, ego.speed > 8 ? -1.6 : 0);
    if (st.input.gas) a = Math.max(a, m.accel);
    let steer;
    if (st.input.left || st.input.right) {
      // pengemudi boleh menyetir sendiri kapan saja, dan itu juga tanda tangan di setir
      steer = m.steer;
      st.laneOverride = true;
      answerHands();
    } else {
      if (st.laneOverride) {
        st.laneOverride = false;
        snapPlan();
      }
      steer = systemSteer();
    }
    return { accel: a, brake: 0, steer };
  }

  function controlL3(dt, obs) {
    const v = ego.speed;
    const ads = st.ads;
    if (ads.phase === 'drive') {
      const ev = oddEventAhead();
      if (ev && ev.dist <= torDistance(v)) {
        ads.phase = 'tor';
        ads.left = TOR_TIME;
        ads.reason = ev.kind;
        ads.eventS = ev.s;
        st.events.push('tor');
      }
    }
    if (ads.phase === 'tor') {
      ads.left -= dt;
      if (ads.left <= 0) {
        ads.left = 0;
        ads.phase = 'mrm';
        ads.stopS = ads.eventS - 15;
        st.events.push('l3-mrm');
      }
    }
    let a = Math.min(accAccel(obs, V_SET), staticGuard(obs));
    let brake = 0;
    let steer = systemSteer();
    if (ads.phase === 'mrm' || ads.phase === 'mrc') {
      st.signal.hazard = true;
      a = Math.min(a, stopCap(ads.stopS, L3_MRM_DECEL));
      const left = ads.stopS - (st.egoS + EGO_HL);
      if (ads.phase === 'mrm' && ego.speed < 0.05 && left < 3) {
        ads.phase = 'mrc';
        st.events.push('l3-mrc');
      }
      if (ads.phase === 'mrc') {
        a = 0;
        brake = 8;
        steer = 0;
      }
    }
    return { accel: a, brake, steer };
  }

  function controlL45(obs) {
    const v = ego.speed;
    const ads = st.ads;
    const z = st.zone;
    let target = LEFT_LANE;
    let vSet = V_SET;
    // zona konstruksi: pindah ke lajur kanan lebih awal dan pelankan
    if (z && st.egoS > z.s0 - 110 && st.egoS < z.s1 + 6) target = RIGHT_LANE;
    if (z && st.egoS > z.s0 - 60 && st.egoS < z.s1 + 4) vSet = kmhToMs(40);
    if (st.level === 4) {
      const b = st.boundary;
      if (ads.phase === 'drive' && b && st.egoS < b.s) {
        const stopS = b.s - 12;
        const d = stopS - (st.egoS + EGO_HL);
        if (d <= (v * v) / (2 * L4_MRM_DECEL) + 8) {
          ads.phase = 'mrm';
          ads.stopS = stopS;
          ads.reason = 'batas';
          st.events.push('l4-mrm');
        }
      }
      if (ads.phase === 'mrm' || ads.phase === 'mrc') target = SHOULDER;
    }
    setLaneTarget(target, laneChangeLen(v));
    let a = Math.min(accAccel(obs, vSet), staticGuard(obs));
    let brake = 0;
    let steer = systemSteer();
    if (ads.phase === 'mrm' || ads.phase === 'mrc') {
      a = Math.min(a, stopCap(ads.stopS, L4_MRM_DECEL));
      const left = ads.stopS - (st.egoS + EGO_HL);
      if (ads.phase === 'mrm' && ego.speed < 0.05 && left < 3) {
        ads.phase = 'mrc';
        st.events.push('l4-mrc');
      }
      if (ads.phase === 'mrc') {
        st.signal.hazard = true;
        a = 0;
        brake = 8;
        steer = 0;
      }
    }
    return { accel: a, brake, steer };
  }

  function planSignals() {
    if (st.signal.hazard) return;
    const p = st.plan;
    const systemSteers = st.engaged && st.level >= 2 && !st.laneOverride;
    if (systemSteers && Math.abs(p.d1 - p.d0) > 1 && st.egoS < p.s1 - 4) {
      if (p.d1 > p.d0) st.signal.left = true;
      else st.signal.right = true;
    }
  }

  // ---------- rintangan, peringatan, dan rem darurat ----------

  function frontObstacle() {
    const front = st.egoS + EGO_HL;
    const corridor = 0.9 + 0.25;
    let best = null;
    const consider = (o, s, d, hl, hw, v, kind) => {
      if (s < st.egoS) return;
      if (Math.abs(d - st.egoD) > corridor + hw) return;
      const gap = s - hl - front;
      if (!best || gap < best.gap) best = { gap, v, kind, s, d, hl, ref: o };
    };
    if (lead.active) consider(lead, lead.s, lead.d, lead.length / 2, lead.width / 2, lead.v, 'car');
    if (st.zone) {
      for (const o of st.zone.obstacles) {
        if (o.hit || o.s < st.egoS - 5 || o.s > st.egoS + 160) continue;
        consider(o, o.s, o.d, o.hl, o.hw, 0, o.kind);
      }
    }
    return best;
  }

  function closingSpeed(obs) {
    return ego.speed * Math.cos(st.headErr) - obs.v;
  }

  function applyAeb(cmd, obs, dt) {
    // rem darurat otomatis (AEB) selalu siaga di semua level sebagai jaring pengaman
    if (obs && ego.speed > 0.3) {
      const closing = closingSpeed(obs);
      if (closing > 0.2 && obs.gap - 1.5 <= (closing * closing) / (2 * 7.5)) {
        if (!st.aeb.active) st.events.push('aeb');
        st.aeb.hold = 0.6;
        st.aeb.target = obs.ref;
      }
    }
    if (st.aeb.hold > 0) {
      st.aeb.hold -= dt;
      st.aeb.active = true;
      cmd.accel = Math.min(cmd.accel, 0);
      cmd.brake = 8;
      flash('aeb', 2.2);
    } else {
      st.aeb.active = false;
      st.aeb.target = null;
    }
  }

  function crossingLine() {
    for (const l of [EDGE_LEFT, 0, EDGE_RIGHT]) if (Math.abs(st.egoD - l) < 0.95) return l;
    return null;
  }

  // ---------- pelaku lain ----------

  function syncPose(o) {
    const w = road.toWorld(o.s, o.d);
    o.x = w.x;
    o.y = w.y;
    o.heading = o.v < 0 ? w.heading + Math.PI : w.heading;
  }

  function updateLead(dt) {
    if (!lead.active) return;
    lead.timer -= dt;
    if (lead.timer <= 0) {
      lead.vSched = rngLead.range(kmhToMs(38), kmhToMs(56));
      lead.timer = rngLead.range(6, 11);
    }
    let vCmd = lead.vSched;
    if (lead.waiting) {
      vCmd = 0;
      if (ego.speed > 0.4) lead.waiting = false;
    }
    const gap = lead.s - lead.length / 2 - (st.egoS + EGO_HL);
    // jangan terlalu jauh meninggalkan mobil otonom (supaya tetap terlihat di layar)
    if (gap > 55) vCmd = Math.min(vCmd, Math.max(0, ego.speed + (75 - gap) * 0.25));
    // bila mobil otonom sudah di depannya di lajur yang sama, ikuti dengan jarak aman
    const egoAhead = st.egoS - EGO_HL - (lead.s + lead.length / 2);
    if (egoAhead > -1 && Math.abs(st.egoD - lead.d) < 2.2) {
      vCmd = Math.min(vCmd, followingSpeed(Math.max(0, egoAhead), ego.speed, { cruise: Math.max(vCmd, 0.1), minGap: 3, timeGap: 1.2 }));
    }
    const before = lead.v;
    lead.v = approach(lead.v, vCmd, (vCmd > lead.v ? 1.3 : 3) * dt);
    lead.braking = lead.v < before - 0.002 || lead.v < 0.05;
    lead.s += lead.v * dt;
    // tertinggal jauh di belakang: muncul lagi sebagai mobil lain di depan
    if (lead.s < st.egoS - 45) {
      lead.s = st.egoS + 130;
      lead.v = Math.min(Math.max(ego.speed, 8), kmhToMs(45));
      lead.waiting = false;
    }
    syncPose(lead);
  }

  function respawnOpp(c, base) {
    for (let tries = 0; tries < 6; tries++) {
      const s = base + tries * 35;
      if (!opp.some((o) => o !== c && o.d === c.d && Math.abs(o.s - s) < 30)) {
        c.s = s;
        return;
      }
    }
    c.s = base + 240;
  }

  function updateOpp(dt) {
    for (const c of opp) {
      // mobil di depannya (arah barat = s mengecil) di lajur yang sama
      let ahead = null;
      for (const o of opp) if (o !== c && o.d === c.d && o.s < c.s && (!ahead || o.s > ahead.s)) ahead = o;
      let v = c.v;
      if (ahead) {
        const gap = c.s - c.length / 2 - (ahead.s + ahead.length / 2);
        if (gap < 28) v = Math.min(v, ahead.vNow * (gap < 12 ? 0.8 : 1));
      }
      c.vNow = approach(c.vNow, v, 3 * dt);
      c.s -= c.vNow * dt;
      if (c.s < st.egoS - 120) {
        c.v = c.base * rngTraffic.range(0.85, 1.15);
        c.vNow = c.v;
        respawnOpp(c, st.egoS + 140 + rngTraffic.range(0, 140));
      }
      const w = road.toWorld(c.s, c.d);
      c.x = w.x;
      c.y = w.y;
      c.heading = w.heading + Math.PI;
    }
  }

  // ---------- tabrakan dan keluar jalan ----------

  function placeEgo(s, d, speed = 0) {
    const w = road.toWorld(s, d);
    ego.setPose(w.x, w.y, w.heading);
    ego.speed = speed;
    st.egoS = s;
    st.egoD = d;
    st.headErr = 0;
  }

  function checkCollisions() {
    if (lead.active && boxesOverlap(ego, lead)) {
      st.crashes++;
      placeEgo(st.egoS - 3, st.egoD, 0);
      flash('crash', 4);
      st.events.push('crash');
      return;
    }
    if (st.zone) {
      for (const o of st.zone.obstacles) {
        if (o.hit || Math.abs(o.s - st.egoS) > 8) continue;
        const w = road.toWorld(o.s, o.d);
        const hit =
          o.kind === 'cone'
            ? pointInBox(w.x, w.y, ego, o.r)
            : boxesOverlap(ego, { x: w.x, y: w.y, heading: w.heading, length: o.hl * 2, width: o.hw * 2 });
        if (hit) {
          if (o.kind === 'cone') o.hit = true;
          st.crashes++;
          ego.speed = 0;
          if (o.kind !== 'cone') placeEgo(st.egoS - 2, st.egoD, 0);
          flash('crash-zone', 4);
          st.events.push('crash');
          return;
        }
      }
    }
  }

  function checkOffroad() {
    if (st.egoD > SHOULDER_OUT - 0.3 || st.egoD < MEDIAN_IN - 0.2 || Math.abs(st.headErr) > 1.1) {
      placeEgo(st.egoS, st.egoD > 0 ? LEFT_LANE : RIGHT_LANE, 0);
      snapPlan();
      flash('offroad', 4);
      st.events.push('offroad');
    }
  }

  // ---------- rebase dan kejadian ----------

  function rebase() {
    if (st.egoS < 2 * PERIOD) return;
    const S = road.SHIFT;
    ego.x -= S.x;
    ego.y -= S.y;
    st.egoS -= PERIOD;
    lead.s -= PERIOD;
    for (const c of opp) c.s -= PERIOD;
    if (st.zone) {
      const z = st.zone;
      z.s0 -= PERIOD;
      z.s1 -= PERIOD;
      z.signS -= PERIOD;
      for (const o of z.obstacles) o.s -= PERIOD;
    }
    if (st.boundary) st.boundary.s -= PERIOD;
    st.plan.s0 -= PERIOD;
    st.plan.s1 -= PERIOD;
    if (st.ads.eventS != null) st.ads.eventS -= PERIOD;
    if (st.ads.stopS != null) st.ads.stopS -= PERIOD;
  }

  function maintainEvents() {
    if (st.zone && st.egoS > st.zone.s1 + 150) st.zone = null;
    if (st.boundary && st.egoS > st.boundary.s + 250) st.boundary = null;
    if (st.keepZone && !st.zone) st.zone = makeZone(st.egoS + 400);
    if (st.keepBoundary && !st.boundary) st.boundary = { s: st.egoS + 400 };
  }

  // ---------- langkah simulasi ----------

  function update(dt) {
    st.t += dt;
    updateLead(dt);
    updateOpp(dt);

    const obs = frontObstacle();
    st.obs = obs;
    st.signal.left = false;
    st.signal.right = false;
    st.signal.hazard = false;
    st.acc.mode = 'off';

    let cmd;
    if (st.level === 0 || !st.engaged) cmd = manualCmd();
    else if (st.level === 1) cmd = controlL1(obs);
    else if (st.level === 2) cmd = controlL2(dt, obs);
    else if (st.level === 3) cmd = controlL3(dt, obs);
    else cmd = controlL45(obs);
    if (!st.engaged) st.acc.mode = 'off';
    planSignals();

    // peringatan untuk pengemudi manusia (level 0 sampai 2, atau saat sistem mati)
    const human = humanDrives();
    st.fcw = false;
    if (human && obs && ego.speed > 2 && obs.gap < 60) {
      const closing = closingSpeed(obs);
      st.fcw = closing > 0.3 && obs.gap / closing < HUMAN_FCW_TTC;
    }
    st.ldw = human && !(st.engaged && st.level === 2 && !st.laneOverride) && ego.speed > kmhToMs(30) ? crossingLine() : null;

    applyAeb(cmd, obs, dt);
    ego.step(dt, cmd);
    const pr = road.project(ego.x, ego.y, st.egoS);
    st.egoS = pr.s;
    st.egoD = pr.d;
    st.headErr = angleDiff(ego.heading, road.headingAt(pr.s));

    checkCollisions();
    checkOffroad();

    // penghitung untuk tugas
    const c = st.counters;
    if (st.level === 0) c.manualDist += Math.max(0, ego.speed) * dt;
    c.accFollow = st.level === 1 && st.engaged && st.acc.mode === 'follow' && !st.aeb.active ? c.accFollow + dt : 0;
    c.mrcHold = st.level === 4 && st.engaged && st.ads.phase === 'mrc' && st.egoD > EDGE_LEFT + 0.4 ? c.mrcHold + dt : 0;

    maintainEvents();
    rebase();
  }

  // ---------- preset langkah ----------

  /**
   * Susun ulang skenario. p = { level, egoAt (m dalam satu periode), speed (m/s),
   * lead: { gap, speed, wait } | null, zone: jarak (m) | null, boundary: jarak (m) | null }
   */
  function applyPreset(p) {
    rngLead.reseed(101);
    rngTraffic.reseed(202);
    const s = PERIOD + p.egoAt;
    placeEgo(s, LEFT_LANE, p.speed || 0);
    if (p.lead) {
      lead.active = true;
      lead.d = LEFT_LANE;
      lead.s = s + EGO_HL + p.lead.gap + lead.length / 2;
      lead.v = p.lead.speed;
      lead.vSched = p.lead.speed > 1 ? p.lead.speed : kmhToMs(48);
      lead.timer = 7;
      lead.waiting = !!p.lead.wait;
      lead.braking = lead.v < 0.05;
      syncPose(lead);
    } else {
      lead.active = false;
    }
    opp.forEach((c, i) => {
      c.v = c.base;
      c.vNow = c.base;
      c.s = s - 70 + i * 52 + rngTraffic.range(0, 18);
    });
    st.zone = p.zone ? makeZone(s + p.zone) : null;
    st.boundary = p.boundary ? { s: s + p.boundary } : null;
    st.keepZone = !!p.zone;
    st.keepBoundary = !!p.boundary;
    for (const k of Object.keys(st.input)) st.input[k] = false;
    st.aeb = { active: false, hold: 0, target: null };
    st.fcw = false;
    st.ldw = null;
    st.events.length = 0;
    st.counters = { manualDist: 0, accFollow: 0, mrcHold: 0 };
    st.crashes = 0;
    st.acc = { mode: 'off', gap: Infinity, want: 0 };
    updateOpp(0);
    return setLevel(p.level);
  }

  // ---------- menggambar ----------

  function hatch(g, view, color, spacing = 1.4) {
    // garis miring di dalam path yang sedang aktif (dipotong dengan clip)
    const b = view.visibleBounds();
    g.save();
    g.clip();
    g.strokeStyle = color;
    g.lineWidth = 0.14;
    g.beginPath();
    const span = b.maxX - b.minX + (b.maxY - b.minY);
    const start = Math.floor((b.minX + b.minY) / spacing) * spacing;
    for (let k = start; k < start + span + spacing; k += spacing) {
      g.moveTo(k - b.minY, b.minY);
      g.lineTo(k - b.maxY, b.maxY);
    }
    g.stroke();
    g.restore();
  }

  /** Label hanya dipasang bila titiknya terlihat (label di luar layar akan terjepit di tepi). */
  function inView(view, p, margin = 1.5) {
    const b = view.visibleBounds();
    return p.x > b.minX + margin && p.x < b.maxX - margin && p.y > b.minY + margin && p.y < b.maxY - margin;
  }

  function drawTruck(g, o, blink) {
    const w = road.toWorld(o.s, o.d);
    const L = o.hl * 2;
    const W = o.hw * 2;
    g.save();
    g.translate(w.x, w.y);
    g.rotate(w.heading);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(-L / 2 + 0.2, -W / 2 + 0.3, L, W);
    g.fillStyle = '#a16207';
    roundRectPath(g, -L / 2, -W / 2, L - 1.9, W, 0.25);
    g.fill();
    g.strokeStyle = '#ca8a04';
    g.lineWidth = 0.12;
    for (let x = -L / 2 + 0.8; x < L / 2 - 2.2; x += 0.9) {
      g.beginPath();
      g.moveTo(x, -W / 2 + 0.2);
      g.lineTo(x, W / 2 - 0.2);
      g.stroke();
    }
    g.fillStyle = '#eab308';
    roundRectPath(g, L / 2 - 1.8, -W / 2 + 0.05, 1.8, W - 0.1, 0.35);
    g.fill();
    g.fillStyle = 'rgba(12, 20, 36, 0.85)';
    g.fillRect(L / 2 - 0.75, -W / 2 + 0.3, 0.4, W - 0.6);
    // lampu rotator di atap kabin
    g.fillStyle = blink ? '#fbbf24' : '#78350f';
    g.beginPath();
    g.arc(L / 2 - 1.2, 0, 0.22, 0, TAU);
    g.fill();
    if (blink) {
      g.fillStyle = 'rgba(251, 191, 36, 0.25)';
      g.beginPath();
      g.arc(L / 2 - 1.2, 0, 0.9, 0, TAU);
      g.fill();
    }
    g.restore();
  }

  function drawArrowBoard(g, o, blink, view) {
    const w = road.toWorld(o.s, o.d);
    g.save();
    g.translate(w.x, w.y);
    g.rotate(w.heading);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(-0.4, -1.0, 1.0, 2.3);
    g.fillStyle = '#111827';
    g.fillRect(-0.5, -1.15, 1.0, 2.3);
    g.strokeStyle = '#f97316';
    g.lineWidth = 0.1;
    g.strokeRect(-0.5, -1.15, 1.0, 2.3);
    // panah ke kanan arah jalan (sumbu y lokal positif = kanan)
    g.strokeStyle = blink ? '#fbbf24' : '#57401a';
    g.lineWidth = Math.max(0.16, view.px(2));
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(0, -0.8);
    g.lineTo(0, 0.75);
    g.moveTo(-0.3, 0.4);
    g.lineTo(0, 0.8);
    g.lineTo(0.3, 0.4);
    g.stroke();
    g.restore();
  }

  function drawZone(g, view, labels, blink) {
    const z = st.zone;
    if (!z) return;
    // area lajur yang ditutup
    road.areaPath(g, z.s0, z.s1, (s) => coneLine(z, s), () => EDGE_LEFT);
    g.fillStyle = withAlpha(COLORS.cone, 0.1);
    g.fill();
    hatch(g, view, withAlpha(COLORS.cone, 0.22), 1.6);
    drawArrowBoard(g, z.board, blink, view);
    drawTruck(g, z.truck, blink);
    for (const o of z.obstacles) {
      if (o.kind !== 'cone') continue;
      const w = road.toWorld(o.s, o.d + (o.hit ? 0.5 : 0));
      if (o.hit) {
        g.save();
        g.globalAlpha = 0.6;
        drawCone(g, { x: w.x, y: w.y, radius: 0.3 }, { view, minPx: 7 });
        g.restore();
      } else drawCone(g, { x: w.x, y: w.y, radius: 0.3 }, { view, minPx: 7 });
    }
    // rambu peringatan 150 m sebelum zona
    const sw = road.toWorld(z.signS, SHOULDER_OUT + 1.6);
    g.save();
    g.translate(sw.x, sw.y);
    g.rotate(Math.PI / 4);
    const k = Math.max(1, view.px(16) / 1.1);
    g.fillStyle = '#f97316';
    g.fillRect(-0.55 * k, -0.55 * k, 1.1 * k, 1.1 * k);
    g.strokeStyle = '#111827';
    g.lineWidth = 0.12 * k;
    g.strokeRect(-0.45 * k, -0.45 * k, 0.9 * k, 0.9 * k);
    g.restore();
    if (inView(view, sw)) labels.add(sw.x, sw.y, 'Pekerjaan jalan 150 m', { color: '#fdba74', dy: -20, size: 11 });
    const bw = road.toWorld(z.s0 + 30, EDGE_LEFT + 1.5);
    if (inView(view, bw)) labels.add(bw.x, bw.y, 'Zona konstruksi', { color: '#fdba74', dy: -22, size: 11 });
  }

  function drawBoundary(g, view, labels) {
    const b = st.boundary;
    if (!b) return;
    road.areaPath(g, b.s, b.s + 70, () => SHOULDER_OUT, () => EDGE_RIGHT);
    g.fillStyle = withAlpha(COLORS.target, 0.07);
    g.fill();
    hatch(g, view, withAlpha(COLORS.target, 0.2), 1.8);
    const p1 = road.toWorld(b.s, SHOULDER_OUT);
    const p2 = road.toWorld(b.s, MEDIAN_IN);
    drawLine(g, [p1, p2], { color: COLORS.target, width: 3, view, dash: [9, 6] });
    // rambu di tepi kiri
    const sp = road.toWorld(b.s, SHOULDER_OUT + 1.7);
    g.save();
    g.translate(sp.x, sp.y);
    g.rotate(sp.heading);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(-0.1, -1.1, 0.45, 2.3);
    g.fillStyle = '#f8fafc';
    g.fillRect(-0.25, -1.25, 0.5, 2.5);
    g.fillStyle = COLORS.target;
    g.fillRect(-0.15, -1.15, 0.3, 2.3);
    g.restore();
    if (inView(view, sp)) labels.add(sp.x, sp.y, 'Batas area operasi', { color: COLORS.target, dy: -22, size: 12 });
  }

  function drawSignals(g, view, blink) {
    const sig = st.signal;
    if (!blink || !(sig.left || sig.right || sig.hazard)) return;
    const L = ego.length / 2;
    const W = ego.width / 2;
    const c = Math.cos(ego.heading);
    const s = Math.sin(ego.heading);
    const at = (fx, fy) => ({ x: ego.x + c * fx - s * fy, y: ego.y + s * fx + c * fy });
    const spots = [];
    // lokal y negatif = kiri
    if (sig.left || sig.hazard) spots.push(at(L - 0.2, -W + 0.1), at(-L + 0.2, -W + 0.1));
    if (sig.right || sig.hazard) spots.push(at(L - 0.2, W - 0.1), at(-L + 0.2, W - 0.1));
    // ukuran tetap dalam piksel supaya lampu tidak menutupi mobil saat skala kecil (layar ponsel)
    const r = Math.max(0.2, view.px(2.8));
    for (const p of spots) {
      g.fillStyle = 'rgba(251, 191, 36, 0.3)';
      g.beginPath();
      g.arc(p.x, p.y, r * 2, 0, TAU);
      g.fill();
      g.fillStyle = '#fbbf24';
      g.beginPath();
      g.arc(p.x, p.y, r, 0, TAU);
      g.fill();
    }
  }

  /** Apakah sistem sedang menyetir (untuk menampilkan rencana jalur). */
  function systemSteering() {
    if (!st.engaged || st.level < 2) return false;
    if (st.level === 2 && st.laneOverride) return false;
    return st.ads.phase !== 'mrc';
  }

  function draw(g, view, labels, { time }) {
    const vb = view.visibleBounds();
    const c = road.project(view.camera.x, view.camera.y, st.egoS + (view.camera.x - ego.x));
    const half = (vb.maxX - vb.minX) / 2 + 40;
    road.draw(g, view, c.s - half, c.s + half);
    const blink = Math.floor(time * 2.6) % 2 === 0;

    drawBoundary(g, view, labels);
    drawZone(g, view, labels, blink);

    // garis peringatan keluar lajur
    if (st.ldw != null) {
      const pts = [];
      for (let s = st.egoS - 8; s <= st.egoS + 14; s += 2) pts.push(road.toWorld(s, st.ldw));
      drawLine(g, pts, { color: COLORS.warn, width: 5, view, alpha: 0.9 });
    }

    // rencana jalur sistem
    if (systemSteering()) {
      const mrm = st.ads.phase === 'mrm';
      const pts = [];
      const end = mrm ? Math.min(st.egoS + 60, st.ads.stopS + EGO_HL) : st.egoS + 50;
      for (let s = st.egoS + 1; s <= end; s += 2.5) pts.push(road.toWorld(s, planD(s)));
      if (pts.length > 1) drawPath(g, pts, { color: mrm ? COLORS.warn : COLORS.path, width: 3, view, alpha: 0.6, arrows: 11 });
    }
    // titik henti darurat
    if ((st.ads.phase === 'mrm' || st.ads.phase === 'mrc') && st.engaged && st.ads.stopS != null) {
      const sd = planD(st.ads.stopS + EGO_HL);
      const a = road.toWorld(st.ads.stopS + EGO_HL, sd + 1.2);
      const bb = road.toWorld(st.ads.stopS + EGO_HL, sd - 1.2);
      drawLine(g, [a, bb], { color: COLORS.danger, width: 4, view });
    }

    // jarak ACC ke mobil depan
    if (st.engaged && st.acc.mode === 'follow' && lead.active && st.obs?.kind === 'car') {
      const s0 = st.egoS + EGO_HL + 0.3;
      const s1 = lead.s - lead.length / 2 - 0.3;
      if (s1 > s0 + 1) {
        const pts = [];
        const dd = st.egoD + 1.2; // di sisi kiri lajur supaya tidak menimpa rencana jalur
        for (let s = s0; s <= s1; s += 2) pts.push(road.toWorld(s, dd));
        pts.push(road.toWorld(s1, dd));
        drawLine(g, pts, { color: COLORS.radar, width: 2, view, dash: [6, 5], alpha: 0.9 });
        for (const s of [s0, s1]) drawLine(g, [road.toWorld(s, dd - 0.5), road.toWorld(s, dd + 0.5)], { color: COLORS.radar, width: 2, view, alpha: 0.9 });
        const mid = road.toWorld((s0 + s1) / 2, dd);
        labels.add(mid.x, mid.y, fmt(st.acc.gap, 0, 'm'), { color: COLORS.radar, dy: -16, size: 11, mono: true });
      }
    }

    for (const o of opp) {
      if (o.kind === 'bus') drawBus(g, o);
      else drawCar(g, o, { color: o.color });
    }
    if (lead.active) {
      drawCar(g, lead, { color: lead.color, braking: lead.braking });
      if ((st.level <= 2 || !st.engaged) && inView(view, lead)) labels.add(lead.x, lead.y, 'mobil depan', { color: COLORS.muted, dy: -18, size: 11 });
    }

    // sensor sistem: radar ACC (level 1 dan 2), pemantauan penuh (level 3 ke atas)
    if (st.engaged && (st.level === 1 || st.level === 2)) {
      const f = ego.front();
      drawSensorCone(g, f, ego.heading, 0.3, 55, COLORS.radar, { view, fillAlpha: 0.045, strokeAlpha: 0.2, width: 1 });
    }
    if (st.engaged && st.level >= 3) {
      drawSensorCone(g, ego, 0, TAU, 20, COLORS.lidar, { view, fillAlpha: 0.035, strokeAlpha: 0.3, width: 1, dash: [4, 6] });
    }

    drawCar(g, ego, { ego: true, braking: ego.braking });
    drawSignals(g, view, blink);

    // peringatan tabrakan depan dan rem darurat
    const target = st.aeb.active ? st.aeb.target : st.fcw ? st.obs?.ref : null;
    if (target) {
      if (target === lead) drawBracketBox(g, lead, COLORS.danger, { view, pad: 0.5 });
      else {
        const w = road.toWorld(target.s, target.d);
        drawRing(g, w.x, w.y, Math.max(1.2, view.px(14)), { color: COLORS.danger, width: 2, view });
      }
    }

    // penunjuk kejadian di luar layar
    const edgeX = vb.maxX - view.px(20);
    const edgeS = road.project(edgeX, view.camera.y, c.s + (edgeX - view.camera.x)).s;
    const ahead = [];
    if (st.zone && st.zone.s0 > edgeS) ahead.push({ s: st.zone.s0, text: 'Zona konstruksi', color: '#fdba74' });
    if (st.boundary && st.boundary.s > edgeS) ahead.push({ s: st.boundary.s, text: 'Batas area operasi', color: COLORS.target });
    for (const e of ahead) {
      const dist = e.s - (st.egoS + EGO_HL);
      if (dist > 450) continue;
      const p = road.toWorld(edgeS, EDGE_LEFT + 1);
      labels.add(p.x, p.y, `${e.text} ${fmt(dist, 0)} m ›`, { color: e.color, align: 'right', dx: 0, dy: -30, size: 11 });
    }
  }

  // tampilan awal
  applyPreset({ level: 0, egoAt: 10, speed: 0, lead: { gap: 30, speed: 0, wait: true } });

  return {
    road,
    ego,
    lead,
    opp,
    st,
    update,
    draw,
    applyPreset,
    setLevel,
    engage,
    setInput,
    pressHold,
    pressTakeover,
    controlsFor,
    oddEventAhead,
    outsideOdd,
    flashKey,
    humanDrives,
    systemSteering,
    EGO_HL,
  };
}
