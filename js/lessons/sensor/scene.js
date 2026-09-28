// Dunia simulasi pelajaran Sensor: Jalan Karangampel Timur di sisi utara Universitas Ma Chung,
// di atas peta OpenStreetMap. Mobil otonom berhenti di lajur ke timur, angkot ngetem di belakangnya,
// dan di depan ada persimpangan (tempat jalan ini berbelok ke utara) dengan lampu lalu lintas
// simulasi dan zebra cross.
//
// Koordinat dunia sama dengan peta 'machung' (meter, x ke timur, y ke selatan). Adegan disusun di
// "bingkai jalan" (s sepanjang jalan, d ke kiri), lihat ./street.js. Lalu lintas kiri.
//
// File ini hanya berisi model dunia (membangun, memperbarui, menggambar). Logika pelajaran,
// sensor, tugas, dan panel kontrol ada di ../sensor.js. Perisai keselamatan ada di ./safety.js.

import { Vehicle, PathAgent } from '../../engine/vehicle.js';
import { TrafficLight, SignalPlan, followingSpeed, speedToStop } from '../../engine/traffic.js';
import { crosswalk, stopLine } from '../../engine/road.js';
import { distanceToBox } from '../../engine/geometry.js';
import { clamp, approach, mulberry32 } from '../../engine/math.js';
import { COLORS } from '../../engine/theme.js';
import {
  drawCar,
  drawVehicle,
  drawAngkot,
  drawPedestrian,
  drawTrafficSignal,
  drawSpeedSign,
  drawCrosswalk,
  drawStopLine,
  fillBox,
} from '../../engine/draw.js';
import * as ST from './street.js';
import {
  SAFETY,
  FRICTION,
  brakeLimit,
  comfortDecel,
  stopDistance,
  shieldSpeed,
  canStopComfortably,
  minYellow,
  corridorGap,
  perimeter,
  createMonitor,
} from './safety.js';

const EGO_FWD = 2.2; // kecepatan maju saat tombol Maju ditahan (m/s)
const EGO_REV = 1.4; // kecepatan mundur (m/s)
const PED_SPEED = 1.3; // kecepatan jalan pejalan kaki (m/s)
const GREEN_MAIN = 12;
const GREEN_SIDE = 10;
const ALL_RED = 2;

/**
 * Bangun adegan di atas peta OSM (hasil ctx.loadMap('machung')).
 * opts hanya untuk uji ketahanan (tidak dipakai pelajaran):
 *   extraTraffic  jumlah kendaraan latar tambahan (lalu lintas padat)
 *   pedAnytime    pejalan kaki boleh mulai menyeberang kapan saja selama penerimaan celah terpenuhi
 *   plannerBlind  perencana kendaraan latar mengabaikan lampu, zebra cross, pejalan kaki, dan kendaraan
 *                 di depan, sehingga hanya perisai keselamatan yang mencegah pelanggaran
 *   egoLimit      batas maju mobil otonom (s); isi Infinity supaya mobil bisa masuk persimpangan
 *   egoSpeed      kecepatan maju mobil otonom saat tombol Maju ditahan (m/s)
 */
export function createScene(map, { extraTraffic = 0, pedAnytime = false, plannerBlind = false, egoLimit = ST.EGO_FRONT_LIMIT, egoSpeed = EGO_FWD } = {}) {
  const F = ST.streetFrame(map);
  const H = F.headings;
  const W = F.toWorld;
  const routes = ST.buildRoutes(F);
  const monitor = createMonitor();
  // gesekan jalan berubah bertahap (jalan butuh waktu untuk basah atau kering)
  let muTarget = FRICTION.cerah;
  let mu = muTarget;
  const MU_RATE = 0.15; // per detik
  let rand = mulberry32(2026);

  // ---------- lampu lalu lintas (simulasi: di OSM tidak ada lampu di sekitar Ma Chung) ----------
  const light = new TrafficLight({ id: 'lampu', ...W(ST.STOP_EAST - 1.2, ST.ROAD_HALF + 0.7), heading: H.west, label: 'Lampu lalu lintas (simulasi)' });
  const lightNorth = new TrafficLight({ id: 'lampu-utara', ...W(ST.nArmS(ST.STOP_NORTH + 1.2) + ST.N_ARM.half + 0.7, ST.STOP_NORTH + 1.2), heading: H.north, label: 'Lampu lengan utara' });
  const lightSouth = new TrafficLight({ id: 'lampu-selatan', ...W(ST.S_ARM.s - ST.S_ARM.half - 0.7, ST.STOP_SOUTH - 1.2), heading: H.south, label: 'Lampu lengan selatan' });
  const lights = { lampu: light, 'lampu-utara': lightNorth, 'lampu-selatan': lightSouth };
  // Kuning cukup panjang untuk kendaraan tercepat di jalan paling licin (hujan).
  const yellow = Math.max(4, Math.ceil(minYellow(SAFETY.vMax, brakeLimit(5, FRICTION.hujan)) * 2) / 2);
  // fase 0: jalan utama (lengan barat dan utara) hijau, fase 1: lengan selatan hijau dan pejalan kaki menyeberang
  const plan = new SignalPlan(
    [
      { lights: [light, lightNorth], green: GREEN_MAIN },
      { lights: [lightSouth], green: GREEN_SIDE },
    ],
    { yellow, allRed: ALL_RED, offset: GREEN_MAIN + yellow + ALL_RED },
  );
  const sideSpan = GREEN_SIDE + yellow + ALL_RED;
  const stopLines = [
    { id: 'garis-timur', ...W(ST.STOP_EAST, ST.LANE), heading: H.east, halfWidth: ST.LANE, light },
    { id: 'garis-utara', ...W(ST.nArmS(ST.STOP_NORTH) + ST.LANE, ST.STOP_NORTH), heading: H.south, halfWidth: ST.LANE, light: lightNorth },
    { id: 'garis-selatan', ...W(ST.S_ARM.s - ST.S_ARM.half / 2, ST.STOP_SOUTH), heading: H.north, halfWidth: ST.S_ARM.half / 2, light: lightSouth },
  ];

  // ---------- benda diam ----------
  const angkotPark = {
    id: 'angkot-ngetem',
    kind: 'angkot',
    label: 'Angkot ngetem',
    ...W(ST.ANGKOT_PARK.s, ST.ANGKOT_PARK.d),
    heading: H.east,
    length: 4.1,
    width: 1.62,
    speed: 0,
    vx: 0,
    vy: 0,
    parked: true,
  };
  const sign = { id: 'rambu', kind: 'sign', label: 'Rambu batas kecepatan', ...W(ST.SIGN_POS.s, ST.SIGN_POS.d), radius: 0.3, text: '30' };
  // lampu jalan (hiasan dan sumber cahaya malam, bukan data OSM)
  const streetLamps = [
    [6, 4.5],
    [26, 4.5],
    [46, 4.5],
    [64, 4.5],
    [16, -4.7],
    [36, -4.7],
    [56, -4.7],
  ].map(([s, d]) => W(s, d));
  const zebra = crosswalk({ ...W(ST.ZEBRA.s, 0), heading: H.north, length: 2 * ST.ZEBRA.halfD, width: 2 * ST.ZEBRA.halfS });
  const zebraBox = F.box(ST.ZEBRA.s - ST.ZEBRA.halfS, ST.ZEBRA.s + ST.ZEBRA.halfS, -ST.ZEBRA.halfD, ST.ZEBRA.halfD);
  const pads = [F.box(74.5, 78.3, ST.ROAD_HALF, 5.4), F.box(74.5, 78.3, -5.6, -ST.ROAD_HALF)];
  const stopMarks = [
    stopLine({ ...W(ST.STOP_EAST, ST.LANE), heading: H.east, length: ST.ROAD_HALF }),
    stopLine({ ...W(ST.nArmS(ST.STOP_NORTH) + ST.LANE, ST.STOP_NORTH), heading: H.south, length: ST.N_ARM.half }),
    stopLine({ ...W(ST.S_ARM.s - ST.S_ARM.half / 2, ST.STOP_SOUTH), heading: H.north, length: ST.S_ARM.half }),
  ];

  // gedung OSM di sekitar adegan: target sensor (sudah digambar oleh peta)
  const center = W(50, 0);
  const buildings = map?.buildingsNear ? map.buildingsNear(center.x, center.y, 110) : [];

  // ---------- pelaku bergerak ----------
  const ego = new Vehicle({
    id: 'ego',
    label: 'Mobil otonom',
    ego: true,
    ...W(ST.EGO_START.s, ST.EGO_START.d),
    heading: H.east,
    maxSpeed: Math.max(2.5, egoSpeed),
    maxReverse: 1.6,
    maxAccel: 1.5,
    maxBrake: 4,
  });

  const npc = (o) => {
    const a = new PathAgent({ path: routes[o.route].path, ...o });
    a.route = routes[o.route];
    a.homeRoute = o.route;
    a.nextRoute = o.nextRoute || o.route;
    a.maxBrake = o.maxBrake;
    a.active = true;
    a.idle = 0;
    a.yellow = null;
    return a;
  };
  const carAhead = npc({ id: 'mobil-depan', kind: 'city', label: 'Mobil putih', route: 'timur-utara', nextRoute: 'utara-barat', cruise: 7, accel: 1.6, decel: 3, maxBrake: 6, color: '#e5e7eb' });
  const angkot = npc({ id: 'angkot', kind: 'angkot', label: 'Angkot', route: 'utara-barat', cruise: 6.5, accel: 1.4, decel: 3, maxBrake: 5 });
  const motor = npc({ id: 'motor', kind: 'motor', label: 'Sepeda motor', route: 'utara-barat', cruise: 7.5, accel: 2, decel: 3, maxBrake: 5.5, color: '#1e3a8a' });
  motor.helmet = COLORS.helmets[2];
  motor.jacket = '#0f766e';
  const motor2 = npc({ id: 'motor-boncengan', kind: 'motor', label: 'Motor berboncengan', route: 'selatan-utara', cruise: 7, accel: 2, decel: 3, maxBrake: 5.5, color: '#7f1d1d' });
  motor2.passenger = true;
  motor2.helmet = COLORS.helmets[3];
  motor2.jacket = '#334155';
  motor2.passengerHelmet = COLORS.helmets[0];
  motor2.passengerJacket = '#be185d';
  const npcs = [carAhead, angkot, motor, motor2];
  const EXTRA_KINDS = [
    { kind: 'city', cruise: 7, maxBrake: 6, color: '#8d9ab3' },
    { kind: 'motor', cruise: 7.5, maxBrake: 5.5, color: '#334155' },
    { kind: 'mpv', cruise: 6.8, maxBrake: 6, color: '#5b7aa6' },
    { kind: 'angkot', cruise: 6.5, maxBrake: 5 },
  ];
  for (let i = 0; i < extraTraffic; i++) {
    const k = EXTRA_KINDS[i % EXTRA_KINDS.length];
    const route = i % 3 === 2 ? 'selatan-utara' : 'utara-barat';
    const a = npc({ id: `tambahan-${i}`, label: 'Kendaraan tambahan', route, accel: 1.8, decel: 3, ...k });
    a.extra = true;
    npcs.push(a);
  }

  const ped = (o) => ({
    kind: 'pedestrian',
    radius: 0.35,
    heading: 0,
    speed: 0,
    vx: 0,
    vy: 0,
    state: 'wait',
    wait: 0,
    step: 0,
    ...o,
  });
  const pedHijab = ped({ id: 'pejalan', label: 'Pejalan kaki berhijab', variant: 'hijab', accent: COLORS.hijab[1], color: '#475569', laneS: ST.PED_LANES.hijab, home: 'north', minWait: 1.2 });
  const pedStudent = ped({ id: 'mahasiswa', label: 'Mahasiswa dengan ransel', variant: 'backpack', accent: '#b45309', color: '#2563eb', laneS: ST.PED_LANES.ransel, home: 'south', minWait: 2 });
  const peds = [pedHijab, pedStudent];

  // objek penting yang ditampilkan di tabel dan bisa dipilih
  const tracked = [light, sign, carAhead, angkot, motor, motor2, pedHijab, pedStudent, angkotPark];

  const drive = { forward: false, back: false };
  const state = { blocked: null };
  let objects = [];

  function rebuildObjects() {
    objects = [light, lightNorth, lightSouth, sign, ...npcs.filter((a) => a.active), ...peds, angkotPark, ...buildings];
  }

  function placeNpc(a, routeId, frameS, frameD, speed) {
    a.route = routes[routeId];
    const p = W(frameS, frameD);
    a.setPath(a.route.path, a.route.path.closest(p.x, p.y).s);
    a.speed = speed;
    a._syncPose();
    a.active = true;
    a.idle = 0;
    a.yellow = null;
  }

  function placePed(p, side) {
    p.side = side;
    const d = side === 'north' ? ST.PED_WAIT_D : -ST.PED_WAIT_D;
    Object.assign(p, W(p.laneS, d));
    p.heading = side === 'north' ? H.south : H.north;
    p.state = 'wait';
    p.wait = 0;
    p.speed = 0;
    p.vx = 0;
    p.vy = 0;
    p.step = 0;
  }

  function reset() {
    rand = mulberry32(2026);
    egoToStart();
    carAhead.nextRoute = 'utara-barat';
    placeNpc(carAhead, 'timur-utara', ST.CAR_AHEAD_START, ST.LANE, 0);
    // angkot dan motor antre di garis henti lengan utara (lampu merah saat mulai)
    const qa = routes['utara-barat'];
    angkot.route = qa;
    angkot.setPath(qa.path, qa.stopS - SAFETY.gapStop - 0.3 - angkot.length / 2);
    angkot.speed = 0;
    motor.route = qa;
    motor.setPath(qa.path, angkot.s - angkot.length / 2 - 2.6 - motor.length / 2);
    motor.speed = 0;
    for (const a of [angkot, motor]) {
      a.active = true;
      a.idle = 0;
      a.yellow = null;
    }
    // motor berboncengan keluar dari jalan kecil di sisi timur kampus
    placeNpc(motor2, 'selatan-utara', 82.6, -26, 6);
    // kendaraan tambahan (hanya uji): masuk bergiliran dari awal rutenya
    npcs.forEach((a, i) => {
      if (!a.extra) return;
      a.route = routes[a.homeRoute];
      a.setPath(a.route.path, a.route.path.length);
      a.active = false;
      a.idle = 0;
      a.respawnAfter = 1 + i * 1.3;
    });
    mu = muTarget;
    placePed(pedHijab, pedHijab.home);
    placePed(pedStudent, pedStudent.home);
    drive.forward = false;
    drive.back = false;
    state.blocked = null;
    plan.update(0);
    monitor.resetTracking();
    rebuildObjects();
  }

  function setWeather(w) {
    muTarget = FRICTION[w] ?? FRICTION.cerah;
  }

  // ---------- pembantu geometri ----------

  const frontS = (a) => a.s + a.length / 2;

  /** Kendaraan aktif (termasuk mobil otonom dan angkot ngetem) sebagai kotak. */
  function vehicleBoxes() {
    return [ego, angkotPark, ...npcs.filter((a) => a.active)];
  }

  /**
   * Benda terdekat di koridor sepanjang jalur kendaraan latar a.
   * Hasil { dist (dari bemper depan, sepanjang jalur), object }.
   */
  function pathObstacle(a, list, { predict = false, reach = 45 } = {}) {
    const path = a.route.path;
    const front = frontS(a);
    const halfW = a.width / 2;
    const fx = a.x + Math.cos(a.heading) * (a.length / 2);
    const fy = a.y + Math.sin(a.heading) * (a.length / 2);
    let best = Infinity;
    let bestObj = null;
    const test = (px, py, r, obj) => {
      if (Math.hypot(px - fx, py - fy) > reach + 6) return;
      const c = path.closest(px, py, front + reach / 2, reach / 2 + 8);
      const along = c.s - front;
      if (along < -a.length - r || along > reach) return;
      if (Math.abs(c.lateral) > halfW + SAFETY.latMargin + r) return;
      const d = Math.max(0, along - r);
      if (d < best) {
        best = d;
        bestObj = obj;
      }
    };
    for (const o of list) {
      if (o === a) continue;
      if (o.radius != null && o.length == null) {
        test(o.x, o.y, o.radius, o);
        if (predict && (o.vx || o.vy)) for (const t of SAFETY.predict) test(o.x + o.vx * t, o.y + o.vy * t, o.radius, o);
      } else {
        if (Math.hypot(o.x - fx, o.y - fy) > reach + 8) continue;
        for (const p of perimeter(o, 1)) test(p.x, p.y, 0, o);
      }
    }
    return { dist: best, object: bestObj };
  }

  /** Zebra cross sedang dipakai atau sudah dipesan pejalan kaki. */
  function zebraBusy() {
    for (const p of peds) {
      if (p.state === 'walk') return true;
      const f = F.toFrame(p.x, p.y);
      if (Math.abs(f.s - ST.ZEBRA.s) <= ST.ZEBRA.halfS + 0.4 && Math.abs(f.d) <= ST.ROAD_HALF + 0.3) return true;
    }
    return false;
  }

  // ---------- kendaraan latar ----------

  function updateNpc(a, dt, time) {
    const r = a.route;
    const front = frontS(a);
    const aB = brakeLimit(a.maxBrake, mu);
    const aC = comfortDecel(aB);

    // 1) perencana: kecepatan yang diinginkan
    let vT = a.cruise;
    const k0 = Math.max(0, Math.floor(a.s));
    const k1 = Math.min(r.curve.length - 1, Math.floor(a.s + 40));
    for (let k = k0; k <= k1; k++) vT = Math.min(vT, Math.sqrt(r.curve[k] * r.curve[k] + 2 * aC * Math.max(0, k - a.s)));

    const L = lights[r.light];
    const dLine = r.stopS - front;
    let stopAtLine = false;
    if (L.state === 'green') a.yellow = null;
    if (dLine > -0.05) {
      if (L.state === 'red') stopAtLine = true;
      else if (L.state === 'yellow') {
        // keputusan kuning dikunci sekali: yang masih bisa berhenti nyaman WAJIB berhenti
        if (a.yellow == null) a.yellow = canStopComfortably(a.speed, dLine - SAFETY.gapStop, aB) ? 'stop' : 'go';
        if (a.yellow === 'stop') stopAtLine = true;
      }
    }
    const zone = ST.zebraZone(r, F, a.width / 2);
    let dZone = Infinity;
    if (zone && front < zone.sIn && zebraBusy()) dZone = zone.sIn - front;
    const lead = pathObstacle(a, vehicleBoxes());
    const pedHit = pathObstacle(a, peds, { predict: true });
    if (!plannerBlind) {
      if (stopAtLine) vT = Math.min(vT, speedToStop(dLine - SAFETY.gapStop - 0.3, aC));
      if (dZone < Infinity) vT = Math.min(vT, speedToStop(dZone - SAFETY.gapCrossing - 0.3, aC));
      if (lead.dist < Infinity) {
        vT = Math.min(vT, followingSpeed(lead.dist, Math.max(0, lead.object.speed || 0), { cruise: a.cruise, minGap: 2.5, timeGap: 1.2, decel: aC, strict: true }));
      }
      if (pedHit.dist < Infinity) vT = Math.min(vT, speedToStop(pedHit.dist - SAFETY.gapPed - 0.3, aC));
    }
    vT = Math.min(vT, SAFETY.vMax);
    const rate = vT > a.speed ? a.accelRate : Math.min(a.decelRate, aB);
    const vCmd = approach(a.speed, vT, rate * dt);

    // 2) perisai keselamatan: batasan terdekat, pakai perlambatan yang benar-benar bisa dicapai
    let D = Infinity;
    let hard = Infinity;
    if (stopAtLine) {
      D = Math.min(D, dLine - SAFETY.gapStop);
      hard = Math.min(hard, dLine);
    }
    if (dZone < Infinity) {
      D = Math.min(D, dZone - SAFETY.gapCrossing);
      hard = Math.min(hard, dZone);
    }
    if (pedHit.dist < Infinity) {
      D = Math.min(D, pedHit.dist - SAFETY.gapPed);
      hard = Math.min(hard, pedHit.dist);
    }
    if (lead.dist < Infinity) {
      D = Math.min(D, lead.dist - 1);
      hard = Math.min(hard, Math.max(0, lead.dist - 0.05));
    }
    const res = shieldSpeed(a.speed, vCmd, D, hard, aB, dt);
    if (res.limited) monitor.interventions++;
    if (res.clamped) {
      monitor.clamps++;
      monitor.log('jepit', { time, vehicle: a.id });
    }

    // 3) aktuator
    const v0 = a.speed;
    a.speed = res.v;
    a.braking = res.v < v0 - 0.4 * dt || (res.v < 0.2 && vT < 0.5);
    a.s += res.v * dt;
    if (a.s >= r.path.length - 0.01) {
      // keluar dari adegan: tunggu, lalu muncul lagi di awal rute berikutnya
      a.s = r.path.length;
      a.active = false;
      a.idle = 0;
      a.respawnAfter = 2 + rand() * 6;
      a.route = routes[a.nextRoute];
    }
    a._syncPose();
  }

  function tryRespawn(a, dt) {
    a.idle += dt;
    if (a.idle < a.respawnAfter) return;
    const r = a.route;
    const start = r.path.sample(0);
    // awal rute harus kosong
    for (const o of npcs) {
      if (o === a || !o.active) continue;
      if (Math.hypot(o.x - start.x, o.y - start.y) < 14) return;
    }
    a.setPath(r.path, 0);
    a.speed = Math.min(a.cruise, 6);
    a.active = true;
    a.yellow = null;
    a._syncPose();
  }

  // ---------- mobil otonom (dikemudikan pelajar lewat tombol Maju dan Mundur) ----------

  function updateEgo(dt, time) {
    const aB = brakeLimit(ego.maxBrake, mu);
    const target = drive.forward && !drive.back ? egoSpeed : drive.back && !drive.forward ? -EGO_REV : 0;
    const accel = clamp((target - ego.speed) * 2.5, -aB, ego.maxAccel);
    const vCmd = ego.speed + accel * dt;
    const v0 = ego.speed;
    let dir = vCmd > 1e-9 ? 1 : vCmd < -1e-9 ? -1 : 0;
    if (dir === 0 && v0 !== 0) dir = Math.sign(v0);
    state.blocked = null;
    if (dir === 0) {
      ego.speed = 0;
      ego.accel = 0;
      ego.braking = false;
      return;
    }
    const hx = Math.cos(ego.heading);
    const hy = Math.sin(ego.heading);
    const f = F.toFrame(ego.x, ego.y);
    const bumperS = f.s + (dir * ego.length) / 2;
    const bumper = { x: ego.x + hx * dir * (ego.length / 2), y: ego.y + hy * dir * (ego.length / 2) };
    const dirVec = { x: hx * dir, y: hy * dir };
    const cons = []; // { D, hard, why }
    const others = [angkotPark, ...npcs.filter((a) => a.active)];
    const veh = corridorGap(bumper, dirVec, ego.width / 2, others, { margin: 0.25 });
    if (veh.dist < Infinity) cons.push({ D: veh.dist - (dir > 0 ? 1.2 : 0.2), hard: veh.dist, why: dir > 0 ? 'depan' : 'belakang' });
    const pedGap = corridorGap(bumper, dirVec, ego.width / 2, peds, { predict: true });
    if (pedGap.dist < Infinity) cons.push({ D: pedGap.dist - SAFETY.gapPed, hard: pedGap.dist, why: 'pejalan' });
    if (dir > 0) {
      if (Number.isFinite(egoLimit)) cons.push({ D: egoLimit - bumperS, hard: egoLimit - bumperS + 0.3, why: 'batas' });
      const dLine = ST.STOP_EAST - bumperS;
      if (dLine > -0.05) {
        if (light.state === 'green') ego.yellowDecision = null;
        let stop = light.state === 'red';
        if (light.state === 'yellow') {
          if (ego.yellowDecision == null) ego.yellowDecision = canStopComfortably(Math.abs(v0), dLine - SAFETY.gapStop, aB) ? 'stop' : 'go';
          stop = ego.yellowDecision === 'stop';
        }
        if (stop) cons.push({ D: dLine - SAFETY.gapStop, hard: dLine, why: 'lampu' });
      }
      if (zebraBusy()) {
        const dz = ST.ZEBRA.s - ST.ZEBRA.halfS - bumperS;
        if (dz > -0.05) cons.push({ D: dz - SAFETY.gapCrossing, hard: dz, why: 'zebra' });
      }
    }
    let D = Infinity;
    let hard = Infinity;
    let why = null;
    for (const c of cons) {
      if (c.D < D) {
        D = c.D;
        why = c.why;
      }
      hard = Math.min(hard, c.hard);
    }
    const res = shieldSpeed(Math.abs(v0) * (Math.sign(v0) === dir ? 1 : 0), Math.max(0, vCmd * dir), D, hard, aB, dt);
    // mengganti arah (misalnya dari mundur ke maju) selalu lewat 0
    let vNew = dir * res.v;
    if (Math.sign(v0) === -dir && v0 !== 0) vNew = approach(v0, 0, aB * dt);
    if (res.clamped) {
      monitor.clamps++;
      monitor.log('jepit', { time, vehicle: 'ego' });
    }
    const pressing = (dir > 0 && drive.forward) || (dir < 0 && drive.back);
    if (res.limited) monitor.egoInterventions++;
    if (res.limited && pressing && Math.abs(vNew) < 0.05) state.blocked = why;
    ego.accel = (vNew - v0) / dt;
    ego.braking = Math.abs(vNew) < Math.abs(v0) - 1e-4;
    ego.speed = vNew;
    ego.x += hx * vNew * dt;
    ego.y += hy * vNew * dt;
    ego.odometer += Math.abs(vNew) * dt;
  }

  // ---------- pejalan kaki ----------

  /** Pejalan kaki boleh mulai menyeberang? (fase pejalan kaki dan penerimaan celah) */
  function crossingAllowed() {
    if (!pedAnytime) {
      if (plan.phaseIndex !== 1) return false;
      const crossTime = (2 * ST.PED_WAIT_D) / PED_SPEED;
      if (plan.phaseTime < 0.5 || sideSpan - plan.phaseTime < crossTime + 2) return false;
    }
    // tidak ada kendaraan di atas zebra cross
    for (const v of vehicleBoxes()) {
      const f = F.toFrame(v.x, v.y);
      const reach = Math.hypot(v.length, v.width) / 2 + 0.5;
      if (Math.abs(f.s - ST.ZEBRA.s) <= ST.ZEBRA.halfS + reach && Math.abs(f.d) <= ST.ZEBRA.halfD + reach) {
        const corners = [v, ...perimeter(v, 1)];
        if (corners.some((p) => distanceToBox(p.x, p.y, zebraBox) < 0.5)) return false;
      }
    }
    // setiap kendaraan yang menuju zebra cross harus masih bisa berhenti sebelum zebra
    for (const a of npcs) {
      if (!a.active) continue;
      const zone = ST.zebraZone(a.route, F, a.width / 2);
      if (!zone) continue;
      if (a.s - a.length / 2 > zone.sOut) continue; // sudah lewat
      const front = frontS(a);
      if (front >= zone.sIn) return false;
      const D = zone.sIn - front - SAFETY.gapCrossing;
      const aB = brakeLimit(a.maxBrake, mu);
      if (D < stopDistance(a.speed, aB) + 1) return false;
      // sopan: jangan memaksa kendaraan yang sedang melaju mengerem mendadak
      if (a.speed > 0.5 && D < 3 * a.speed + 4) return false;
    }
    // mobil otonom: hanya bila jangkauan geraknya bisa mencapai zebra cross
    if (egoLimit >= ST.ZEBRA.s - ST.ZEBRA.halfS - SAFETY.gapCrossing) {
      const f = F.toFrame(ego.x, ego.y);
      if (f.s - ego.length / 2 <= ST.ZEBRA.s + ST.ZEBRA.halfS) {
        const D = ST.ZEBRA.s - ST.ZEBRA.halfS - (f.s + ego.length / 2) - SAFETY.gapCrossing;
        if (D < stopDistance(Math.max(0, ego.speed), brakeLimit(ego.maxBrake, mu)) + 1) return false;
      }
    }
    return true;
  }

  function updatePed(p, dt, boxes) {
    if (p.state === 'wait') {
      p.wait += dt;
      p.speed = 0;
      p.vx = 0;
      p.vy = 0;
      if (p.wait >= p.minWait && crossingAllowed()) p.state = 'walk';
      else return;
    }
    const f = F.toFrame(p.x, p.y);
    const dirD = p.side === 'north' ? -1 : 1;
    const goal = dirD * ST.PED_WAIT_D;
    const nd = f.d + dirD * PED_SPEED * dt;
    const next = W(p.laneS, nd);
    // jangan pernah melangkah ke badan kendaraan
    const blocked = boxes.some((b) => distanceToBox(next.x, next.y, b) < p.radius + 0.3);
    if (blocked) {
      p.speed = 0;
      p.vx = 0;
      p.vy = 0;
      return;
    }
    p.x = next.x;
    p.y = next.y;
    p.speed = PED_SPEED;
    p.heading = dirD > 0 ? H.north : H.south;
    p.vx = Math.cos(p.heading) * PED_SPEED;
    p.vy = Math.sin(p.heading) * PED_SPEED;
    p.step += dt * 7;
    if ((dirD > 0 && nd >= goal) || (dirD < 0 && nd <= goal)) {
      Object.assign(p, W(p.laneS, goal));
      p.side = p.side === 'north' ? 'south' : 'north';
      p.state = 'wait';
      p.wait = 0;
      p.speed = 0;
      p.vx = 0;
      p.vy = 0;
      p.heading = p.side === 'north' ? H.south : H.north;
    }
  }

  // ---------- satu langkah fisika ----------

  function update(dt, time) {
    mu = approach(mu, muTarget, MU_RATE * dt);
    plan.update(time);
    const boxes = vehicleBoxes();
    for (const p of peds) updatePed(p, dt, boxes);
    for (const a of npcs) {
      if (a.active) updateNpc(a, dt, time);
      else tryRespawn(a, dt);
    }
    updateEgo(dt, time);
    monitor.check(vehicleBoxes(), peds, stopLines, time);
    rebuildObjects();
  }

  // ---------- menggambar ----------

  /**
   * Gambar isi adegan di atas peta (peta digambar oleh ../sensor.js lewat createMapRenderer).
   * opts: { view, night }
   */
  function draw(g, { view, night = false }) {
    // trotoar kecil di ujung zebra cross, marka
    g.fillStyle = COLORS.sidewalk;
    for (const b of pads) fillBox(g, b);
    drawCrosswalk(g, zebra);
    for (const s of stopMarks) drawStopLine(g, s);
    // tiang lampu jalan
    g.fillStyle = '#64748b';
    for (const l of streetLamps) {
      g.beginPath();
      g.arc(l.x, l.y, Math.max(0.22, view.px(2.5)), 0, Math.PI * 2);
      g.fill();
    }
    drawAngkot(g, angkotPark, { view, doorOpen: true });
    for (const a of npcs) {
      if (!a.active) continue;
      drawVehicle(g, a, { view, minPx: a.kind === 'motor' ? 24 : 0, braking: a.braking, headlights: night });
    }
    for (const p of peds) drawPedestrian(g, p, { view, phase: p.step, minPx: view.width < 560 ? 16 : 18, variant: p.variant, accent: p.accent, color: p.color });
    drawSpeedSign(g, sign, { view });
    drawCar(g, ego, { headlights: night });
    // Tanda "simulasi" tiap lampu digambar lewat lapisan label pelajaran (signalTags) supaya tidak
    // bertumpuk dengan label sensor. Semua lampu di sini simulasi: di OSM tidak ada lampu di sekitar Ma Chung.
    drawTrafficSignal(g, lightSouth, { view, minPx: 16, alpha: 0.9 });
    drawTrafficSignal(g, lightNorth, { view, minPx: 16, alpha: 0.9 });
    drawTrafficSignal(g, light, { view, minPx: 22 });
  }

  /** Posisi tanda "simulasi" di sisi luar tiang tiap lampu (sama seperti drawTrafficSignal). */
  function signalTags(view) {
    return [light, lightNorth, lightSouth].map((l) => {
      const d = view.px(13) + 0.25;
      return { x: l.x - Math.sin(l.heading) * d, y: l.y + Math.cos(l.heading) * d, id: l.id };
    });
  }

  /** Sumber cahaya untuk efek malam (lampu kendaraan, lampu jalan, lampu lalu lintas). */
  function nightLights() {
    const out = [];
    for (const car of [ego, ...npcs.filter((a) => a.active)]) {
      const f = car.length / 2;
      out.push({ type: 'cone', x: car.x + Math.cos(car.heading) * f, y: car.y + Math.sin(car.heading) * f, heading: car.heading, fov: car.kind === 'motor' ? 0.6 : 0.9, range: car === ego ? 28 : car.kind === 'motor' ? 14 : 20 });
    }
    for (const l of streetLamps) out.push({ type: 'point', x: l.x, y: l.y, radius: 7, strength: 0.55 });
    for (const l of [light, lightNorth, lightSouth]) out.push({ type: 'point', x: l.x, y: l.y, radius: 3, strength: 0.6 });
    return out;
  }

  /** Letakkan mobil otonom kembali di posisi awal. */
  function egoToStart() {
    const p = W(ST.EGO_START.s, ST.EGO_START.d);
    ego.setPose(p.x, p.y, H.east);
  }

  reset();

  return {
    frame: F,
    streetName: F.name,
    ego,
    get objects() {
      return objects;
    },
    tracked,
    npcs,
    peds,
    plan,
    light,
    lights,
    stopLines,
    drive,
    state,
    safety: monitor,
    get friction() {
      return mu;
    },
    reset,
    update,
    draw,
    signalTags,
    nightLights,
    setWeather,
    egoToStart,
    /** Jarak bebas dari bemper belakang ke kendaraan terdekat di belakang. */
    rearGap() {
      const back = { x: -Math.cos(ego.heading), y: -Math.sin(ego.heading) };
      return corridorGap(ego.rear(), back, ego.width / 2, [angkotPark, ...npcs.filter((a) => a.active)], { margin: 0.25 }).dist;
    },
    /** Batas tampilan untuk panggung lebar dan sempit (dunia, sumbu x dan y). */
    viewBounds(narrow) {
      return narrow ? F.bounds(15, 87, -6, 7) : F.bounds(16, 94, -10, 12);
    },
    /** Titik label nama kampus (di dalam batas kampus OSM, dekat jalan). */
    campusLabel: map?.campus ? { ...W(40, -16), name: map.campus.name } : null,
    /** Titik label nama jalan (bahu jalan sisi selatan, jauh dari zebra cross). */
    streetLabel: W(48, -5.6),
  };
}
