// Dunia simulasi pelajaran Level Otomasi: perjalanan dari kampus Universitas Ma Chung ke pusat kota
// Malang di jalan bermedian dua lajur per arah (ilustrasi, lalu lintas kiri). Ada mobil otonom,
// satu kendaraan di depan (angkot atau mobil kota), sepeda motor yang menyalip lewat lajur kanan,
// lalu lintas arah berlawanan di balik median, zona pekerjaan jalan, dan batas area operasi (ODD)
// level 4 di ujung kawasan kampus Ma Chung dan Villa Puncak Tidar.
// File ini berisi model dan perilaku tiap level SAE J3016. Teks, panel, dan deteksi tugas ada di
// ../level-otomasi.js, peta perjalanan di ./tripmap.js.
//
// Penyederhanaan yang disengaja (disebut juga di teks pelajaran):
//   - Satu kendaraan depan di lajur kiri. Sepeda motor di arah kita hanya menyalip lewat lajur kanan.
//   - Sensor dianggap sempurna: sistem langsung tahu jarak dan kecepatan kendaraan depan.
//   - Aturan tiap level dibuat sederhana dan angka seperti hitungan mundur 10 detik adalah pilihan
//     untuk simulasi ini, bukan nilai baku.
//   - Jalan ilustrasi ini tidak punya persimpangan, jadi juga tidak ada lampu pengatur simpang atau
//     tempat orang menyeberang.
//
// Koordinat jalan (s, d) dijelaskan di ./road.js. Jarak perjalanan di rute nyata: trip = s + tripOffset.
// Mobil otonom memakai model sepeda kinematik di koordinat dunia; posisinya di jalan dihitung ulang.

import { Vehicle } from '../../engine/vehicle.js';
import { Path, boxesOverlap, pointInBox } from '../../engine/geometry.js';
import { purePursuit } from '../../engine/control.js';
import { followingSpeed } from '../../engine/traffic.js';
import { clamp, smoothstep, approach, kmhToMs, angleDiff, Rng, TAU, fmt, toWorld } from '../../engine/math.js';
import { COLORS, SIZES, withAlpha } from '../../engine/theme.js';
import { drawCar, drawVehicle, drawCone, drawPath, drawSensorCone, drawRing, drawBracketBox, drawLine, drawLidarRange, drawSpeedSign, roundRectPath } from '../../engine/draw.js';
import { createRoad, PERIOD, LEFT_LANE, RIGHT_LANE, SHOULDER, EDGE_LEFT, EDGE_RIGHT, SHOULDER_OUT, MEDIAN_IN, OPP_LANES } from './road.js';
import { TRIP } from './data/trip.js';

export const V_CITY = kmhToMs(40); // batas kecepatan jalan kota di simulasi ini
export const V_KAWASAN = kmhToMs(30); // batas kecepatan di kawasan kampus dan perumahan
export const V_SET = V_CITY; // kecepatan tertinggi yang dipilih untuk sistem (ACC dan level 2 sampai 5)
const TIME_GAP = 1.5; // jarak waktu ACC (detik)
const MIN_GAP = 4; // jarak saat berhenti (m)
const ACC_RANGE = 90; // jangkauan radar ACC di simulasi (m)
const TOR_TIME = 10; // hitungan mundur permintaan ambil alih level 3 (detik)
export const MANUAL_DIST = 150; // tugas level 0 (m)
export const ODD_EXIT = TRIP.oddExit; // jarak di rute nyata tempat rute keluar dari area operasi level 4 (m)

const L3_MRM_DECEL = 2.2; // perlambatan berhenti darurat di lajur (m/s^2)
const L4_MRM_DECEL = 1.3; // perlambatan saat menepi (m/s^2)
const L4_MRM_LANE = 30; // panjang perpindahan ke tepi kiri saat menepi (m)
const ZONE_SPEED = kmhToMs(25); // kecepatan sistem saat melewati zona pekerjaan jalan
const ATT_FIRST = 3.5; // detik sampai pesan pertama "Pegang kemudi" setelah level 2 aktif
const ATT_EVERY = 12; // selang pesan berikutnya
const ATT_PROMPT = 4; // lama pesan sebelum peringatan keras
const ATT_WARN = 4; // lama peringatan keras sebelum kemudi diserahkan
const HUMAN_FCW_TTC = 2.6; // peringatan tabrakan depan (detik)
const BIKE_D = RIGHT_LANE - 0.45; // posisi lateral sepeda motor yang menyalip (sedikit ke kanan lajur kanan)
const BIKE_HL = SIZES.motor.length / 2;
const BIKE_HW = SIZES.motor.width / 2;

/** Jarak (m) sebelum kejadian di luar ODD saat level 3 harus mulai meminta ambil alih. */
const torDistance = (v) => v * TOR_TIME + (v * v) / (2 * L3_MRM_DECEL) + 20;
/** Jarak (m) sebelum titik henti saat level 4 mulai menepi. */
const l4MrmDistance = (v) => Math.max((v * v) / (2 * L4_MRM_DECEL) + 8, L4_MRM_LANE + 14);

export function createScene() {
  const road = createRoad();
  const rngLead = new Rng(101);
  const rngTraffic = new Rng(202);
  const rngBike = new Rng(303);

  const ego = new Vehicle({
    id: 'ego',
    ego: true,
    label: 'Mobil otonom',
    maxSpeed: kmhToMs(70),
    maxAccel: 2.5,
    maxBrake: 8,
    maxSteer: 0.5,
    steerRate: 0.9,
  });
  const EGO_HL = ego.length / 2;

  // Keadaan pelaku dan simulasi diisi oleh applyPreset() di akhir createScene().
  // kendaraan di depan (lajur kiri): angkot atau mobil kota, bergantung pada langkah
  const lead = { id: 'kendaraan-depan' };

  // sepeda motor searah yang menyalip lewat lajur kanan
  const bikes = [
    { helmet: COLORS.helmets[2], jacket: '#1e3a8a', passenger: false, color: '#475569' },
    { helmet: COLORS.helmets[0], jacket: '#7c2d12', passenger: true, color: '#1f2937', passengerHelmet: COLORS.helmets[4], passengerJacket: '#9d174d' },
  ].map((look, i) => ({ ...look, id: `motor-searah-${i}`, kind: 'motor', length: SIZES.motor.length, width: SIZES.motor.width }));

  // lalu lintas arah berlawanan: lajur dekat median, lajur normal, dan sepeda motor di tepi kiri mereka
  const OPP_BIKE = -15.4;
  const opp = [
    { d: OPP_LANES[1], kind: 'angkot', code: 'AL', base: 9.5 },
    { d: OPP_LANES[0], kind: 'city', color: COLORS.vehicles[0], base: 12 },
    { d: OPP_BIKE, kind: 'motor', helmet: COLORS.helmets[3], jacket: '#334155', base: 10.5 },
    { d: OPP_LANES[1], kind: 'mpv', color: '#94a3b8', base: 10.5 },
    { d: OPP_BIKE, kind: 'motor', helmet: COLORS.helmets[1], jacket: '#b45309', passenger: true, passengerHelmet: COLORS.helmets[5], base: 9.8 },
    { d: OPP_LANES[0], kind: 'car', color: COLORS.vehicles[4], base: 12.5 },
    { d: OPP_LANES[1], kind: 'minibus', color: '#d9d2c3', base: 9 },
    { d: OPP_BIKE, kind: 'motor', helmet: COLORS.helmets[4], jacket: '#0f766e', base: 10.2 },
    { d: OPP_LANES[1], kind: 'angkot', code: 'GL', base: 9.2 },
  ].map((c, i) => ({ ...c, id: `lawan-${i}`, length: SIZES[c.kind].length, width: SIZES[c.kind].width }));

  const st = { t: 0, signal: { left: false, right: false, hazard: false }, events: [], obs: null };

  // ---------- bantuan ----------

  function flash(key, dur = 4) {
    st.flash = { key, until: st.t + dur };
  }
  const flashKey = () => (st.flash && st.t < st.flash.until ? st.flash.key : null);
  const humanDrives = () => st.level <= 2 || !st.engaged;

  /** Jarak perjalanan di rute nyata (m) untuk posisi jalan s. */
  const tripAt = (s) => s + st.tripOffset;
  /** Apakah posisi s masih di dalam kawasan (area operasi level 4). */
  const inKawasan = (s) => tripAt(s) < ODD_EXIT;
  /** Batas kecepatan (m/s) di posisi jalan s: kawasan kampus dan perumahan, atau jalan kota. */
  const limitAt = (s) => (inKawasan(s) ? V_KAWASAN : V_CITY);
  /** Kecepatan pilihan sistem saat ini: mengikuti batas di posisi bagian depan mobil. */
  const vSetNow = () => Math.min(V_SET, limitAt(st.egoS + EGO_HL));

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
    const target = st.egoD >= 0 ? LEFT_LANE : RIGHT_LANE;
    const dd = Math.abs(target - st.egoD);
    st.plan = { d0: st.egoD, d1: target, s0: st.egoS, s1: st.egoS + (dd < 0.3 ? 1 : Math.max(25, ego.speed * 2.2)) };
  }

  const laneChangeLen = (v) => Math.max(35, v * 3);

  // ---------- zona pekerjaan jalan dan batas ODD ----------

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

  /**
   * Kejadian di luar ODD di depan mobil. kinds: 'zona' (pekerjaan jalan), 'batas' (ujung kawasan,
   * batas ODD level 4). Mengembalikan { kind, s, dist } yang terdekat atau null.
   */
  function oddEventAhead(kinds = ['zona', 'batas']) {
    const front = st.egoS + EGO_HL;
    let ev = null;
    const z = st.zone;
    if (kinds.includes('zona') && z && front < z.s1 + 2) ev = { kind: 'zona', s: z.s0, dist: Math.max(0, z.s0 - front) };
    const b = st.boundary;
    if (kinds.includes('batas') && b && front < b.s + 2) {
      const dist = Math.max(0, b.s - front);
      if (!ev || dist < ev.dist) ev = { kind: 'batas', s: b.s, dist };
    }
    return ev;
  }

  /** Kejadian yang relevan untuk level yang dipilih (level 3: zona saja, level 4: zona dan batas). */
  const eventForLevel = (L = st.level) => oddEventAhead(L === 3 ? ['zona'] : undefined);

  // ---------- level dan keterlibatan sistem ----------

  function freshState() {
    st.ads = { phase: 'drive', left: 0, eventS: null, stopS: null };
    st.attention = { stage: 'ok', timer: 0, next: ATT_FIRST };
    st.laneOverride = false;
    st.wantRight = false;
    st.counters.accFollow = 0;
    st.counters.mrcHold = 0;
  }

  /** Aktifkan sistem level yang dipilih. Mengembalikan true bila berhasil. */
  function engage() {
    freshState();
    snapPlan();
    const n = st.level;
    const ev = n === 3 && eventForLevel(3);
    // level 4 hanya aktif di dalam kawasan, level 3 menolak bila kejadian di luar ODD sudah terlalu dekat
    const refuse =
      n === 4 && tripAt(st.egoS) > ODD_EXIT - 1 ? 'odd-outside' : ev && ev.dist <= torDistance(Math.max(ego.speed, vSetNow())) ? 'l3-refuse' : null;
    if (refuse) flash(refuse, 4.5);
    st.engaged = n > 0 && !refuse;
    return st.engaged;
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

  /** Tombol "Pegang kemudi" (hanya berlaku saat level 2 aktif). */
  function pressHold() {
    if (st.level === 2 && st.engaged) answerHands();
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
  }

  /** Tombol "Ambil alih" (hanya berlaku saat level 3 aktif). */
  function pressTakeover() {
    if (st.level !== 3 || !st.engaged) return;
    const phase = st.ads.phase;
    st.engaged = false;
    freshState();
    snapPlan();
    flash(phase === 'drive' ? 'l3-taken-free' : 'l3-taken', 5);
    st.events.push(phase === 'tor' ? 'takeover-tor' : 'takeover');
  }

  function setInput(key, on) {
    st.input[key] = !!on;
    // menginjak rem mematikan ACC dan level 2, seperti di mobil sungguhan
    if (key === 'brake' && on && st.engaged && (st.level === 1 || st.level === 2)) disengage('brake-cancel');
  }

  /** Tombol mana yang sedang dipegang pengemudi (true = boleh dipakai). */
  function controlsFor() {
    const human = humanDrives();
    return { steer: human, gas: human, brake: human, hold: st.engaged && st.level === 2, takeover: st.engaged && st.level === 3 };
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
    if (st.input.gas && !st.input.brake) accel = 2.4 * (1 - v / 18);
    if (st.input.brake) {
      brake = 6;
      accel = 0;
    }
    return { accel, brake, steer: manualSteer() };
  }

  /** ACC: jaga kecepatan pilihan, atau jarak waktu di belakang kendaraan depan bila ada. */
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
      pts.push(road.toWorld(s, planD(s)));
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
    let a = accAccel(obs, vSetNow());
    if (st.input.gas) a = Math.max(a, m.accel);
    return { accel: a, brake: 0, steer: m.steer };
  }

  function controlL2(dt, obs) {
    attentionUpdate(dt);
    if (!st.engaged) return manualCmd();
    const z = st.zone;
    if (z && z.s0 - (st.egoS + EGO_HL) < 100 && st.egoS < z.s1) {
      // level 2 tidak dirancang untuk zona pekerjaan jalan: kemudi diserahkan ke pengemudi
      disengage('l2-zone');
      return manualCmd();
    }
    const m = manualCmd();
    let a = accAccel(obs, vSetNow());
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

  /**
   * Perintah sistem level 3 sampai 5. Saat manuver risiko minimal (fase mrm) mobil berhenti di
   * ads.stopS, lalu tetap berhenti (fase mrc). Level 3 menyalakan hazard sejak mrm, level 4 saat mrc.
   */
  function systemCmd(obs, vSet, decel, tag) {
    const ads = st.ads;
    const cmd = { accel: Math.min(accAccel(obs, vSet), staticGuard(obs)), brake: 0, steer: systemSteer() };
    if (ads.phase !== 'mrm' && ads.phase !== 'mrc') return cmd;
    cmd.accel = Math.min(cmd.accel, stopCap(ads.stopS, decel));
    if (ads.phase === 'mrm' && ego.speed < 0.05 && ads.stopS - (st.egoS + EGO_HL) < 3) {
      ads.phase = 'mrc';
      st.events.push(`${tag}-mrc`);
    }
    if (tag === 'l3' || ads.phase === 'mrc') st.signal.hazard = true;
    return ads.phase === 'mrc' ? { accel: 0, brake: 8, steer: 0 } : cmd;
  }

  function controlL3(dt, obs) {
    const ads = st.ads;
    if (ads.phase === 'drive') {
      const ev = eventForLevel(3);
      if (ev && ev.dist <= torDistance(ego.speed)) {
        ads.phase = 'tor';
        ads.left = TOR_TIME;
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
    return systemCmd(obs, vSetNow(), L3_MRM_DECEL, 'l3');
  }

  /**
   * Lajur kanan cukup kosong untuk pindah lajur: tidak ada sepeda motor di samping, dan motor di
   * belakang masih sempat mengalah (mengerem pelan) sebelum mencapai buritan mobil.
   */
  function rightLaneClear() {
    const rear = st.egoS - EGO_HL;
    const front = st.egoS + EGO_HL;
    for (const m of bikes) {
      if (!m.active) continue;
      if (m.s - BIKE_HL > front + 6) continue; // sudah jauh di depan
      if (m.s + BIKE_HL < rear - 1) {
        const closing = Math.max(0, m.v - ego.speed);
        const gap = rear - (m.s + BIKE_HL);
        if ((closing * closing) / (2 * 4) < gap - 2) continue;
      }
      return false;
    }
    return true;
  }

  function controlL45(obs) {
    const v = ego.speed;
    const ads = st.ads;
    const z = st.zone;
    // zona pekerjaan jalan: pindah ke lajur kanan lebih awal (bila lajurnya kosong) dan pelankan
    let target = z && st.egoS > z.s0 - 110 && st.egoS < z.s1 + 6 ? RIGHT_LANE : LEFT_LANE;
    let vSet = vSetNow();
    if (z && st.egoS > z.s0 - 60 && st.egoS < z.s1 + 4) vSet = Math.min(vSet, ZONE_SPEED);
    if (st.level === 4) {
      const b = st.boundary;
      if (ads.phase === 'drive' && b && st.egoS < b.s) {
        const stopS = b.s - 12;
        const d = stopS - (st.egoS + EGO_HL);
        if (d <= l4MrmDistance(v)) {
          ads.phase = 'mrm';
          ads.stopS = stopS;
          st.events.push('l4-mrm');
        }
      }
      if (ads.phase === 'mrm' || ads.phase === 'mrc') target = SHOULDER;
    }
    st.wantRight = false;
    if (target === RIGHT_LANE && st.plan.d1 !== RIGHT_LANE && st.egoD > 0) {
      // nyalakan sein dulu; pindah setelah lajur kanan kosong
      st.wantRight = true;
      setLaneTarget(rightLaneClear() ? RIGHT_LANE : LEFT_LANE, laneChangeLen(v));
    } else setLaneTarget(target, target === SHOULDER ? Math.min(laneChangeLen(v), L4_MRM_LANE) : laneChangeLen(v));
    return systemCmd(obs, vSet, L4_MRM_DECEL, 'l4');
  }

  function planSignals() {
    if (st.signal.hazard) return;
    const p = st.plan;
    const systemSteers = st.engaged && st.level >= 2 && !st.laneOverride;
    if (systemSteers && Math.abs(p.d1 - p.d0) > 1 && st.egoS < p.s1 - 4) {
      if (p.d1 > p.d0) st.signal.left = true;
      else st.signal.right = true;
    }
    if (st.wantRight) st.signal.right = true;
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
    for (const m of bikes) if (m.active) consider(m, m.s, m.d, BIKE_HL, BIKE_HW, m.v, 'car');
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

  /** Pose dunia dari (s, d). back = true untuk kendaraan yang melaju ke arah s mengecil. */
  function syncPose(o, back = false) {
    const w = road.toWorld(o.s, o.d);
    o.x = w.x;
    o.y = w.y;
    o.heading = back ? w.heading + Math.PI : w.heading;
  }

  function setLeadKind(kind, code) {
    lead.kind = kind;
    lead.code = kind === 'angkot' ? code || 'ADL' : '';
    const size = SIZES[kind] || SIZES.car;
    lead.length = size.length;
    lead.width = size.width;
    lead.color = kind === 'angkot' ? undefined : '#7d8fb0';
  }

  function updateLead(dt) {
    if (!lead.active) return;
    lead.timer -= dt;
    if (lead.timer <= 0) {
      // angkot di kota berjalan lebih pelan dan lebih sering berubah kecepatan
      const [lo, hi] = lead.kind === 'angkot' ? [kmhToMs(18), kmhToMs(36)] : [kmhToMs(26), kmhToMs(40)];
      lead.vSched = rngLead.range(lo, hi);
      lead.timer = rngLead.range(5, 10);
    }
    let vCmd = Math.min(lead.vSched, limitAt(lead.s));
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
    // tertinggal jauh di belakang: muncul lagi sebagai kendaraan lain di depan
    if (lead.s < st.egoS - 45) {
      lead.s = st.egoS + 130;
      lead.v = Math.min(Math.max(ego.speed, 8), kmhToMs(34));
      lead.waiting = false;
    }
    syncPose(lead);
  }

  // --- sepeda motor searah ---

  /** Lebar setengah mobil otonom dalam arah d, termasuk sudut karena arah mobil tidak sejajar jalan. */
  const egoHalfWidth = () => ego.width / 2 + Math.abs(Math.sin(st.headErr)) * EGO_HL;

  function bikeCruise(m) {
    // sedikit lebih cepat dari batas kecepatan, seperti banyak sepeda motor di jalan sungguhan
    return limitAt(m.s) + m.extra;
  }

  function spawnBike(m) {
    m.wait = rngBike.range(2.5, 8);
    // hanya bila mobil otonom lebih lambat dari sepeda motor (kalau tidak, motor tidak akan menyusul)
    const extra = rngBike.range(kmhToMs(6), kmhToMs(12));
    if (ego.speed > limitAt(st.egoS) + extra - 1) return;
    if (st.egoD - egoHalfWidth() < 0.4) return; // mobil sedang di lajur kanan
    const s = st.egoS - rngBike.range(34, 50);
    if (bikes.some((o) => o !== m && o.active && Math.abs(o.s - s) < 14)) return;
    const z = st.zone;
    if (z && s > z.s0 - 170 && s < z.s1 + 20) return;
    m.active = true;
    m.extra = extra;
    m.s = s;
    m.d = BIKE_D;
    m.v = bikeCruise(m);
    m.braking = false;
    syncPose(m);
  }

  function updateBikes(dt) {
    const egoRear = st.egoS - EGO_HL;
    const egoFront = st.egoS + EGO_HL;
    const hw = egoHalfWidth();
    const egoRightSide = st.egoD - hw; // sisi kanan mobil (d mengecil ke kanan)
    const z = st.zone;
    // dekat zona pekerjaan jalan mobil kemungkinan pindah ke lajur kanan (kecuali sedang berhenti)
    const egoNearZone = z && st.egoS > z.s0 - 160 && st.egoS < z.s1 + 20 && ego.speed > 1;
    // motor tidak menyusul ke samping mobil bila mobil mungkin pindah ke lajur kanan
    const egoMayMoveRight = egoRightSide < 0.35 || st.signal.right || st.wantRight || egoNearZone;
    for (const m of bikes) {
      if (!m.active) {
        m.wait -= dt;
        if (m.wait <= 0) spawnBike(m);
        continue;
      }
      const cruise = bikeCruise(m);
      let vWant = cruise;
      let dWant = BIKE_D;
      const lateralConflict = m.d + BIKE_HW + 0.5 > egoRightSide;
      const behind = m.s + BIKE_HL < egoRear - 0.5;
      const alongside = !behind && m.s - BIKE_HL < egoFront + 0.5;
      if (behind && (lateralConflict || egoMayMoveRight)) {
        // tetap di belakang mobil dengan jarak aman
        const gap = egoRear - (m.s + BIKE_HL);
        vWant = Math.min(vWant, followingSpeed(Math.max(0, gap), Math.max(0, ego.speed), { cruise, minGap: 3, timeGap: 0.9, decel: 5, strict: true }));
      } else if (alongside && (lateralConflict || egoRightSide < BIKE_D + BIKE_HW + 1.2)) {
        // mobil masuk ke jalurnya saat motor di samping: menepi ke kanan lalu menjauh ke depan atau ke belakang
        dWant = EDGE_RIGHT - 0.2;
        const ahead = m.s - st.egoS + (m.v - ego.speed) * 0.8 > -1;
        vWant = ahead ? Math.max(cruise, ego.speed + 3) + 1 : Math.max(0, ego.speed - 5);
      }
      // motor lain di depannya di jalur yang sama
      for (const o of bikes) {
        if (o === m || !o.active || o.s <= m.s) continue;
        const gap = o.s - BIKE_HL - (m.s + BIKE_HL);
        if (gap < 30) vWant = Math.min(vWant, followingSpeed(Math.max(0, gap), o.v, { cruise, minGap: 3, timeGap: 0.8, decel: 5, strict: true }));
      }
      const before = m.v;
      m.v = approach(m.v, Math.max(0, vWant), (vWant > m.v ? 2.2 : 6) * dt);
      m.braking = m.v < before - 0.004;
      m.s += m.v * dt;
      m.d = approach(m.d, dWant, (dWant < m.d ? 2 : 0.8) * dt);
      syncPose(m);
      if (m.s > st.egoS + 72 || m.s < st.egoS - 95) {
        m.active = false;
        m.wait = rngBike.range(3, 9);
      }
    }
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
      // kendaraan di depannya (arah barat = s mengecil) di jalur yang sama
      let ahead = null;
      for (const o of opp) if (o !== c && o.d === c.d && o.s < c.s && (!ahead || o.s > ahead.s)) ahead = o;
      let v = c.v * (inKawasan(c.s) ? 0.8 : 1);
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
      syncPose(c, true);
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

  function crash(kind, key) {
    st.crashes++;
    st.crashLog[kind]++;
    flash(key, 4);
    st.events.push('crash');
  }

  function checkCollisions() {
    if (lead.active && boxesOverlap(ego, lead)) {
      crash('lead', 'crash');
      placeEgo(st.egoS - 3, st.egoD, 0);
      return;
    }
    for (const m of bikes) {
      if (!m.active || Math.abs(m.s - st.egoS) > 6) continue;
      if (boxesOverlap(ego, m)) {
        // hanya mungkin saat pelajar sendiri membanting setir ke samping sepeda motor
        crash('motor', 'crash-motor');
        m.active = false;
        m.wait = 6;
        ego.speed = Math.min(ego.speed, 1);
        return;
      }
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
          crash('zone', 'crash-zone');
          ego.speed = 0;
          if (o.kind !== 'cone') placeEgo(st.egoS - 2, st.egoD, 0);
          return;
        }
      }
    }
  }

  function checkOffroad() {
    if (st.egoD > SHOULDER_OUT - 0.3 || st.egoD < MEDIAN_IN - 0.2 || Math.abs(st.headErr) > 1.1) {
      const d = st.egoD > 0 ? LEFT_LANE : RIGHT_LANE;
      let s = st.egoS;
      // jangan menaruh mobil di atas kendaraan lain di lajur tujuan
      if (lead.active && d === LEFT_LANE && Math.abs(lead.s - s) < lead.length / 2 + EGO_HL + 2) s = lead.s - lead.length / 2 - EGO_HL - 3;
      placeEgo(s, d, 0);
      for (const m of bikes) {
        if (m.active && d === RIGHT_LANE && Math.abs(m.s - s) < BIKE_HL + EGO_HL + 2) {
          m.s = s - EGO_HL - BIKE_HL - 3;
          m.v = 0;
          syncPose(m);
        }
      }
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
    st.tripOffset += PERIOD;
    lead.s -= PERIOD;
    if (lead.active) syncPose(lead);
    for (const m of bikes) {
      m.s -= PERIOD;
      if (m.active) syncPose(m);
    }
    for (const c of opp) {
      c.s -= PERIOD;
      syncPose(c, true);
    }
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
  }

  // ---------- langkah simulasi ----------

  function update(dt) {
    st.t += dt;
    updateLead(dt);
    updateOpp(dt);
    updateBikes(dt);

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
    planSignals();

    // peringatan untuk pengemudi manusia (level 0 sampai 2, atau saat sistem mati)
    const human = humanDrives();
    st.fcw = false;
    if (human && obs && ego.speed > 2 && obs.gap < 60) {
      const closing = closingSpeed(obs);
      st.fcw = closing > 0.3 && obs.gap / closing < HUMAN_FCW_TTC;
    }
    st.ldw = human && !(st.engaged && st.level === 2 && !st.laneOverride) && ego.speed > kmhToMs(25) ? crossingLine() : null;

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
   * Susun ulang skenario. p = { level, egoAt (m dalam satu periode tikungan), trip (m di rute nyata),
   * speed (m/s), lead: { kind, code, gap, speed, wait } | null, zone: jarak (m) | null,
   * boundary: jarak (m) ke batas kawasan, dipakai bila trip tidak diberikan }
   * Tanpa trip dan boundary, skenario dimulai di jalan kota 500 m setelah batas kawasan.
   */
  function applyPreset(p) {
    rngLead.reseed(101);
    rngTraffic.reseed(202);
    rngBike.reseed(303);
    const s = PERIOD + p.egoAt;
    const trip = p.trip ?? (p.boundary != null ? ODD_EXIT - p.boundary : ODD_EXIT + 500);
    st.tripOffset = trip - s;
    placeEgo(s, LEFT_LANE, p.speed || 0);
    lead.active = !!p.lead;
    if (p.lead) {
      setLeadKind(p.lead.kind || 'city', p.lead.code);
      lead.d = LEFT_LANE;
      lead.s = s + EGO_HL + p.lead.gap + lead.length / 2;
      lead.v = p.lead.speed;
      lead.vSched = p.lead.speed > 1 ? p.lead.speed : kmhToMs(28);
      lead.timer = 7;
      lead.waiting = !!p.lead.wait;
      lead.braking = lead.v < 0.05;
      syncPose(lead);
    }
    bikes.forEach((m, i) => {
      m.active = false;
      m.wait = 2 + i * 4.5;
    });
    opp.forEach((c, i) => {
      c.v = c.base;
      c.vNow = c.base;
      c.s = s - 70 + i * 40 + rngTraffic.range(0, 16);
    });
    const bS = ODD_EXIT - st.tripOffset;
    Object.assign(st, {
      zone: p.zone ? makeZone(s + p.zone) : null,
      keepZone: !!p.zone,
      boundary: bS > s - 250 ? { s: bS } : null,
      input: { left: false, right: false, gas: false, brake: false },
      aeb: { active: false, hold: 0, target: null },
      acc: { mode: 'off', gap: Infinity, want: 0 },
      counters: { manualDist: 0, accFollow: 0, mrcHold: 0 },
      crashLog: { lead: 0, motor: 0, zone: 0 },
      crashes: 0,
      fcw: false,
      ldw: null,
    });
    st.events.length = 0;
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

  /** Label hanya dipasang bila titiknya terlihat. */
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
      // kerucut yang tertabrak bergeser dan memudar
      g.globalAlpha = o.hit ? 0.6 : 1;
      drawCone(g, road.toWorld(o.s, o.d + (o.hit ? 0.5 : 0)), { view, minPx: 7 });
    }
    g.globalAlpha = 1;
    // rambu peringatan 150 m sebelum zona
    const sw = road.toWorld(z.signS, SHOULDER_OUT + 1.2);
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
    if (inView(view, bw)) labels.add(bw.x, bw.y, 'Zona pekerjaan jalan', { color: '#fdba74', dy: -22, size: 11 });
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
    // rambu di trotoar kiri
    const sp = road.toWorld(b.s, SHOULDER_OUT + 1.3);
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
    if (inView(view, sp)) labels.add(sp.x, sp.y, 'Batas area operasi level 4', { color: COLORS.target, dy: -22, size: 12, priority: 2 });
    // di balik batas: jalan kota dengan batas kecepatan 40 km/jam
    const lp = road.toWorld(b.s + 14, SHOULDER_OUT + 1.2);
    drawSpeedSign(g, { x: lp.x, y: lp.y, text: '40', radius: 0.45 }, { view, minPx: 18 });
  }

  /** Nama kawasan di deretan rumah, hanya di dalam kawasan (area operasi level 4). */
  function drawKawasanLabels(view, labels, sA, sB) {
    const STEP = 110;
    for (let k = Math.floor(tripAt(sA) / STEP); k <= Math.ceil(tripAt(sB) / STEP); k++) {
      const t = k * STEP + 30;
      if (t > ODD_EXIT - 25) continue;
      const p = road.toWorld(t - st.tripOffset, SHOULDER_OUT + 11);
      if (inView(view, p, 4)) labels.add(p.x, p.y, 'Villa Puncak Tidar', { color: '#99f6e4', dy: 0, size: 11, optional: true });
    }
  }

  function drawSignals(g, view, blink) {
    const sig = st.signal;
    if (!blink || !(sig.left || sig.right || sig.hazard)) return;
    const L = ego.length / 2;
    const W = ego.width / 2;
    const at = (fx, fy) => toWorld(ego, { x: fx, y: fy });
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
  const systemSteering = () => st.engaged && st.level >= 2 && !(st.level === 2 && st.laneOverride) && st.ads.phase !== 'mrc';

  const leadName = () => (lead.kind === 'angkot' ? 'angkot' : 'mobil depan');

  function draw(g, view, labels, { time }) {
    const vb = view.visibleBounds();
    const c = road.project(view.camera.x, view.camera.y, st.egoS + (view.camera.x - ego.x));
    const half = (vb.maxX - vb.minX) / 2 + 40;
    road.draw(g, view, c.s - half, c.s + half, {
      tripOffset: st.tripOffset,
      oddExit: ODD_EXIT,
      limitText: (s) => (inKawasan(s) ? '30' : '40'),
    });
    const blink = Math.floor(time * 2.6) % 2 === 0;
    const motorPx = view.width < 500 ? 22 : 30;

    drawBoundary(g, view, labels);
    drawKawasanLabels(view, labels, c.s - half, c.s + half);
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

    // jarak ACC ke kendaraan depan
    if (st.engaged && st.acc.mode === 'follow' && st.obs?.kind === 'car') {
      const o = st.obs;
      const s0 = st.egoS + EGO_HL + 0.3;
      const s1 = o.s - o.hl - 0.3;
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

    for (const o of opp) drawVehicle(g, o, { view, minPx: o.kind === 'motor' ? motorPx : 0 });
    for (const m of bikes) if (m.active) drawVehicle(g, m, { view, minPx: motorPx });
    if (lead.active) {
      drawVehicle(g, lead, { view, braking: lead.braking });
      if ((st.level <= 2 || !st.engaged) && inView(view, lead)) labels.add(lead.x, lead.y, leadName(), { color: COLORS.muted, dy: -18, size: 11 });
    }

    // sensor sistem: radar ACC (level 1 dan 2), cakupan pemantauan penuh (level 3 ke atas), diam tanpa animasi
    if (st.engaged && (st.level === 1 || st.level === 2)) {
      const f = ego.front();
      drawSensorCone(g, f, ego.heading, 0.3, 55, COLORS.radar, { view, fillAlpha: 0.045, strokeAlpha: 0.2, width: 1 });
    }
    if (st.engaged && st.level >= 3) {
      drawLidarRange(g, ego, 20, COLORS.lidar, { view, alpha: 0.05, edgeAlpha: 0.28, dash: [4, 6] });
    }

    drawCar(g, ego, { ego: true, braking: ego.braking });
    drawSignals(g, view, blink);

    // peringatan tabrakan depan dan rem darurat
    const target = st.aeb.active ? st.aeb.target : st.fcw ? st.obs?.ref : null;
    if (target) {
      if (target === lead || bikes.includes(target)) drawBracketBox(g, target, COLORS.danger, { view, pad: 0.5 });
      else {
        const w = road.toWorld(target.s, target.d);
        drawRing(g, w.x, w.y, Math.max(1.2, view.px(14)), { color: COLORS.danger, width: 2, view });
      }
    }

    // penunjuk kejadian di luar layar
    const edgeX = vb.maxX - view.px(20);
    const edgeS = road.project(edgeX, view.camera.y, c.s + (edgeX - view.camera.x)).s;
    const ahead = [];
    if (st.zone && st.zone.s0 > edgeS) ahead.push({ s: st.zone.s0, text: 'Pekerjaan jalan', color: '#fdba74' });
    if (st.boundary && st.boundary.s > edgeS + 2) ahead.push({ s: st.boundary.s, text: 'Batas ODD level 4', color: COLORS.target });
    for (const e of ahead) {
      const dist = e.s - (st.egoS + EGO_HL);
      if (dist > 450) continue;
      const p = road.toWorld(edgeS, EDGE_LEFT + 1);
      labels.add(p.x, p.y, `${e.text} ${fmt(dist, 0)} m ›`, { color: e.color, align: 'right', dx: 0, dy: -30, size: 11, offscreen: 'clamp' });
    }
  }

  /** Ringkasan pelaku untuk pengujian: jenis dan jumlah (hanya kendaraan). */
  function actorKinds() {
    const kinds = {};
    const add = (k) => (kinds[k] = (kinds[k] || 0) + 1);
    add('ego');
    if (lead.active) add(lead.kind);
    for (const m of bikes) if (m.active) add('motor');
    for (const o of opp) add(o.kind);
    return kinds;
  }

  // tampilan awal
  applyPreset({ level: 0, egoAt: 10, trip: ODD_EXIT + 1500, speed: 0, lead: { kind: 'angkot', code: 'ADL', gap: 30, speed: 0, wait: true } });

  return {
    road, ego, lead, bikes, opp, st, update, draw, applyPreset, setLevel, engage, setInput, pressHold, pressTakeover,
    controlsFor, oddEventAhead, eventForLevel, flashKey, tripAt, limitAt, inKawasan, actorKinds, leadName, EGO_HL,
  };
}
