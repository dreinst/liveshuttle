// Dunia simulasi pelajaran Pengambilan Keputusan.
//
// Jalan lurus dua arah membentang timur-barat di y = 0 dengan lalu lintas kiri. Mobil otonom
// melaju ke timur di lajur kiri (y = -1,75). Lajur kanan (y = +1,75) dipakai kendaraan dari
// arah berlawanan, dan boleh dipakai untuk menyalip saat kosong.
//
// Dunia berulang setiap L meter: persimpangan berlampu, zebra cross, dan tempat mobil mogok
// muncul lagi di setiap putaran, jadi kejadian yang sama bisa diamati berkali-kali.
// Mobil otonom, mobil dari arah berlawanan, dan pejalan kaki memakai koordinat mutlak. Saat
// mobil otonom sudah lewat satu putaran, semuanya digeser mundur L meter. Pergeseran ini tidak
// terlihat karena pemandangannya sama persis.
//
// File ini berisi model dunia (lampu, lalu lintas lain, pejalan kaki, mobil mogok) dan cara
// menggambarnya. Logika keputusan mobil otonom ada di ./planner.js.

import { Vehicle, PathAgent } from '../../engine/vehicle.js';
import { Path, boxesOverlap, distanceToBox } from '../../engine/geometry.js';
import { speedToStop, followingSpeed, shouldStopForYellow, laneTargetSpeed } from '../../engine/traffic.js';
import { stopLine, crosswalk } from '../../engine/road.js';
import { Rng, mulberry32, approach, kmhToMs } from '../../engine/math.js';
import { COLORS, withAlpha } from '../../engine/theme.js';
import {
  rectBox,
  drawBuilding,
  drawTree,
  drawCar,
  drawPedestrian,
  drawTrafficLight,
  drawCrosswalk,
  drawStopLine,
  drawLine,
  drawRing,
} from '../../engine/draw.js';

// ---------- tata letak satu putaran (koordinat lokal 0 sampai L) ----------

export const L = 280; // panjang satu putaran dunia (m)
export const EGO_Y = -1.75; // tengah lajur kiri (arah timur)
export const ONC_Y = 1.75; // tengah lajur kanan (arah barat)
export const ROAD_HALF = 3.5;
export const WALK = 2.5; // lebar trotoar
export const INT_X = 70; // tengah jalan simpang
export const SIDE_HALF = 3.5;
export const STOP_E = 64; // garis henti arah timur (lajur mobil otonom)
export const STOP_W = 76; // garis henti arah barat
export const ZEBRA_X = 150;
export const ZEBRA_HALF = 2; // setengah lebar pita zebra searah jalan
export const YIELD_GAP = 1.5; // jarak garis berhenti ke tepi zebra
export const STALL_X = 225; // tempat mobil mogok (titik tengah)
export const STALL_Y = -2.0; // sedikit menepi ke kiri
export const PASS_A = 185; // ruas garis tengah putus-putus (boleh menyalip)
export const PASS_B = 268;
export const ONC_CRUISE = kmhToMs(40);
export const RANGE = 80; // jangkauan persepsi dekat (kamera dan LiDAR), m
export const RANGE_FAR = 250; // jangkauan radar jarak jauh untuk mobil lawan, m
export const PED_Y = ROAD_HALF + 1.1; // posisi menunggu pejalan kaki di trotoar
export const PED_SPEED = 1.35; // m/s

const GEN_AHEAD = 380; // mobil lawan dibuat sampai sejauh ini di depan mobil otonom
const GEN_BEHIND = 120;
const EAST_LIGHT = { x: 65.2, y: -5.0, heading: Math.PI };
const WEST_LIGHT = { x: 74.8, y: 5.0, heading: 0 };
const SOUTH_LIGHT = { x: 74.8, y: -5.0, heading: -Math.PI / 2 };
const NORTH_LIGHT = { x: 65.2, y: 5.0, heading: Math.PI / 2 };

// jeda antarmobil dari arah berlawanan (m). Setiap `every` mobil ada satu celah panjang supaya
// mobil otonom tidak menunggu selamanya.
export const DENSITY = {
  kosong: null,
  sepi: { min: 130, max: 230, every: 2, gapMin: 240, gapMax: 320 },
  sedang: { min: 45, max: 100, every: 3, gapMin: 210, gapMax: 260 },
  padat: { min: 26, max: 48, every: 5, gapMin: 200, gapMax: 230 },
};

// ---------- lampu lalu lintas ----------

const DUR = { MAIN_GREEN: 14, MAIN_YELLOW: 3, ALL_RED_1: 2, SIDE_GREEN: 10, SIDE_YELLOW: 3, ALL_RED_2: 2 };
export const YELLOW_TIME = DUR.MAIN_YELLOW;

/**
 * Pengatur lampu persimpangan. Arah utama = jalan lurus (timur-barat), arah simpang = utara-selatan.
 * mode: 'otomatis' (bergiliran), 'merah' (arah utama dipaksa merah), 'hijau' (arah utama dipaksa hijau).
 * Hijau selalu berganti ke kuning dulu, lalu semua merah sebentar, baru arah lain hijau.
 */
export class Signal {
  constructor() {
    this.mode = 'otomatis';
    this.phase = 'MAIN_GREEN';
    this.t = 0;
    this.yellowId = 0; // bertambah setiap arah utama mulai kuning
  }

  reset(phase = 'MAIN_GREEN', t = 0) {
    this.phase = phase;
    this.t = t;
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

  /** Sisa waktu kuning arah utama (detik), 0 bila tidak kuning. */
  yellowLeft() {
    return this.phase === 'MAIN_YELLOW' ? Math.max(0, DUR.MAIN_YELLOW - this.t) : 0;
  }

  /** Detik sampai warna lampu arah utama berganti, atau null bila warnanya ditahan. */
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

// ---------- pemandangan tetap ----------

function buildStatic() {
  const rnd = mulberry32(7);
  const r = (a, b) => a + (b - a) * rnd();
  const buildings = [];
  const spans = [
    [3, 59],
    [81, 277],
  ];
  for (const side of [-1, 1]) {
    for (const [a, b] of spans) {
      let x = a + r(0, 3);
      while (x < b - 8) {
        const w = Math.min(r(12, 22), b - x);
        if (w < 8) break;
        const setback = 8.2 + r(0, 1.6);
        const depth = r(9, 15);
        const y0 = side < 0 ? -(setback + depth) : setback;
        const y1 = side < 0 ? -setback : setback + depth;
        buildings.push(rectBox(x, y0, x + w, y1));
        x += w + r(3, 6);
      }
    }
  }
  const trees = [];
  for (const side of [-1, 1]) {
    for (let x = 6 + (side > 0 ? 7 : 0); x < L - 4; x += 15 + r(0, 3)) {
      if (x > 55 && x < 85) continue; // persimpangan
      if (x > 143 && x < 157) continue; // zebra cross
      trees.push({ x, y: side * 7.0, r: 1.3 + r(0, 0.45) });
    }
  }
  const lamps = [];
  for (let x = 20; x < L; x += 40) {
    if (x > 55 && x < 85) continue;
    lamps.push({ x, y: -6.3 }, { x: x + 20, y: 6.3 });
  }
  const zebra = crosswalk({ x: ZEBRA_X, y: 0, heading: Math.PI / 2, length: 2 * ROAD_HALF, width: 2 * ZEBRA_HALF });
  const lines = [
    stopLine({ x: STOP_E, y: EGO_Y, heading: 0 }),
    stopLine({ x: STOP_W, y: ONC_Y, heading: Math.PI }),
    stopLine({ x: INT_X + 1.75, y: -6.3, heading: Math.PI / 2 }),
    stopLine({ x: INT_X - 1.75, y: 6.3, heading: -Math.PI / 2 }),
  ];
  const yieldLines = [
    stopLine({ x: ZEBRA_X - ZEBRA_HALF - YIELD_GAP, y: EGO_Y, heading: 0, width: 0.25 }),
    stopLine({ x: ZEBRA_X + ZEBRA_HALF + YIELD_GAP, y: ONC_Y, heading: Math.PI, width: 0.25 }),
  ];
  return { buildings, trees, lamps, zebra, lines, yieldLines };
}

// ---------- lalu lintas jalan simpang (koordinat lokal terhadap tengah persimpangan) ----------

function createCross() {
  const pathS = new Path([
    { x: 1.75, y: -85 },
    { x: 1.75, y: 85 },
  ]);
  const pathN = new Path([
    { x: -1.75, y: 85 },
    { x: -1.75, y: -85 },
  ]);
  const STOP_S = 85 - 6.5; // posisi s tepi garis henti jalan simpang
  const mk = (path, color) => new PathAgent({ path, cruise: 9, accel: 2, decel: 4, loop: true, color });
  const lanes = [
    { path: pathS, agents: [mk(pathS, COLORS.vehicles[0]), mk(pathS, COLORS.vehicles[3])], start: [30, 112] },
    { path: pathN, agents: [mk(pathN, COLORS.vehicles[4]), mk(pathN, COLORS.vehicles[1])], start: [18, 98] },
  ];

  function reset() {
    for (const lane of lanes) {
      lane.agents.forEach((a, i) => {
        a.setS(lane.start[i]);
        a.speed = 0;
      });
    }
  }

  function update(dt, sideState) {
    const light = { state: sideState };
    for (const lane of lanes) {
      const len = lane.path.length;
      for (const a of lane.agents) {
        let leaderGap = Infinity;
        let leaderSpeed = 0;
        for (const b of lane.agents) {
          if (b === a) continue;
          const gap = ((b.s - a.s + len) % len) - (a.length + b.length) / 2;
          if (gap < leaderGap) {
            leaderGap = gap;
            leaderSpeed = b.speed;
          }
        }
        const stopS = a.s + a.length / 2 > STOP_S + 0.5 ? STOP_S + len : STOP_S;
        a.step(dt, laneTargetSpeed(a, [{ s: stopS, light }], { leaderGap, leaderSpeed, decel: 3 }));
      }
    }
  }

  function draw(g) {
    for (const lane of lanes) for (const a of lane.agents) drawCar(g, a);
  }

  const agents = () => lanes.flatMap((l) => l.agents);
  reset();
  return { reset, update, draw, agents };
}

// ---------- dunia ----------

export function createWorld() {
  const signal = new Signal();
  const statics = buildStatic();
  const cross = createCross();
  const rng = new Rng(11);
  const ego = new Vehicle({
    id: 'ego',
    label: 'Mobil otonom',
    ego: true,
    x: 0,
    y: EGO_Y,
    heading: 0,
    maxAccel: 2,
    maxBrake: 8,
    maxSpeed: 20,
    steerRate: 1.4,
  });
  const oncoming = []; // terurut x naik: indeks 0 paling barat (paling depan)
  const peds = [];
  const stalled = { active: false, fromK: 0 };
  const events = [];
  const W = {
    ego,
    signal,
    oncoming,
    peds,
    stalled,
    cross,
    time: 0,
    density: 'sepi',
    viewMaxX: 60, // batas kanan area yang terlihat, diisi dari render
    collisions: 0,
  };
  let nextId = 1;
  let sinceGap = 0;
  let pending = null;
  let pedSide = 'utara';
  let colorIdx = 0;
  let lastHit = -10;

  // ---------- mobil dari arah berlawanan ----------

  function makeCar(x) {
    const color = COLORS.vehicles[(colorIdx++ * 2 + 1) % COLORS.vehicles.length];
    return { id: `lawan-${nextId++}`, kind: 'car', x, y: ONC_Y, heading: Math.PI, length: 4.5, width: 1.8, speed: ONC_CRUISE, cruise: ONC_CRUISE, color, braking: false, yieldTo: null };
  }

  function nextSpacing(cfg) {
    sinceGap += 1;
    if (sinceGap >= cfg.every) {
      sinceGap = 0;
      return rng.range(cfg.gapMin, cfg.gapMax);
    }
    return rng.range(cfg.min, cfg.max);
  }

  /**
   * Tambah mobil lawan di ujung depan antrean. floorX = batas terdekat untuk mobil baru, supaya
   * mobil tidak pernah muncul tiba-tiba di area yang terlihat (atau di zona salip).
   */
  function fillOncoming(floorX = W.viewMaxX + 15) {
    const cfg = DENSITY[W.density];
    if (!cfg) return;
    for (let guard = 0; guard < 60; guard++) {
      const last = oncoming[oncoming.length - 1];
      if (!last) {
        oncoming.push(makeCar(Math.max(ego.x + GEN_AHEAD, floorX)));
        continue;
      }
      if (pending == null) pending = nextSpacing(cfg);
      if (last.x + pending > ego.x + GEN_AHEAD) break;
      oncoming.push(makeCar(Math.max(last.x + pending, floorX)));
      pending = null;
    }
  }

  /** Isi ulang mobil lawan dari belakang mobil otonom sampai jauh di depan (dipakai saat reset). */
  function seedOncoming() {
    oncoming.length = 0;
    pending = null;
    sinceGap = 0;
    const cfg = DENSITY[W.density];
    if (!cfg) return;
    let x = ego.x - 70 + rng.range(0, cfg.min);
    while (x < ego.x + GEN_AHEAD) {
      oncoming.push(makeCar(x));
      x += nextSpacing(cfg);
    }
  }

  /**
   * Ganti kepadatan. Mobil yang belum terlihat dibuang lalu dibuat ulang dengan kepadatan baru,
   * selalu di luar layar. clearUntil (x mutlak) dipakai saat mobil otonom sedang menyalip: mobil
   * baru baru boleh muncul setelah titik itu, jadi celah yang sudah dihitung tetap aman.
   */
  function setDensity(d, clearUntil = -Infinity) {
    W.density = d;
    pending = null;
    sinceGap = 0;
    for (let i = oncoming.length - 1; i >= 0; i--) {
      if (oncoming[i].x - oncoming[i].length / 2 > W.viewMaxX + 12) oncoming.splice(i, 1);
    }
    fillOncoming(Math.max(W.viewMaxX + 15, clearUntil));
  }

  function updateOncoming(dt) {
    const s = signal;
    for (let i = 0; i < oncoming.length; i++) {
      const c = oncoming[i];
      const F = c.x - c.length / 2; // bemper depan (arah barat)
      let v = c.cruise;
      // lampu: garis henti arah barat berikutnya di depan
      const k = Math.floor((F + 0.2 - STOP_W) / L);
      const lineX = STOP_W + k * L;
      const d = F - (lineX + 0.2) - 0.8;
      if (d > -1) {
        const st = s.main;
        if (st === 'red' || (st === 'yellow' && shouldStopForYellow(Math.max(0, d), c.speed, 3))) v = Math.min(v, d <= 0.05 ? 0 : speedToStop(d, 3));
      }
      // pejalan kaki yang sedang menyeberang di depan
      for (const p of peds) {
        if (p.state !== 'menyeberang') continue;
        const line = p.zx + ZEBRA_HALF + YIELD_GAP;
        const dp = F - (line + 0.3);
        if (dp < -0.8) continue;
        if (c.yieldTo !== p.id && (c.speed * c.speed) / (2 * Math.max(0.1, dp)) > 6) continue; // terlalu dekat, tidak sempat
        c.yieldTo = p.id;
        v = Math.min(v, dp <= 0.05 ? 0 : speedToStop(dp, 3));
      }
      if (c.yieldTo && !peds.some((p) => p.id === c.yieldTo && p.state !== 'selesai')) c.yieldTo = null;
      // mobil di depannya
      const lead = oncoming[i - 1];
      if (lead) v = Math.min(v, followingSpeed(F - (lead.x + lead.length / 2), lead.speed, { cruise: c.cruise, minGap: 2.5, timeGap: 1.2, decel: 3 }));
      // mobil otonom yang sedang berada di lajur ini (saat menyalip)
      if (ego.y > -0.6 && ego.x < c.x) {
        const gap = F - (ego.x + ego.length / 2);
        if (gap < 90) v = Math.min(v, followingSpeed(gap, 0, { cruise: c.cruise, minGap: 3, timeGap: 1.2, decel: 3 }));
      }
      const target = Math.max(0, v);
      c.braking = target < c.speed - 0.2;
      c.speed = approach(c.speed, target, (target > c.speed ? 2 : 4.5) * dt);
      c.x -= c.speed * dt;
    }
    while (oncoming.length && oncoming[0].x < ego.x - GEN_BEHIND) oncoming.shift();
    fillOncoming();
  }

  // ---------- pejalan kaki ----------

  /**
   * Munculkan pejalan kaki di zebra cross berikutnya yang masih sempat didekati mobil otonom
   * dengan pengereman nyaman. Hasil: { ok, reason, ped, nextLap, distance }.
   */
  function spawnPed() {
    const active = peds.filter((p) => p.state !== 'selesai');
    if (active.length >= 2) return { ok: false, reason: 'penuh' };
    const front = ego.x + ego.length / 2;
    const yieldOff = ZEBRA_HALF + YIELD_GAP + 0.3;
    const need = (ego.speed * ego.speed) / (2 * 2) + 10;
    const k0 = Math.ceil((front + 0.5 - (ZEBRA_X - yieldOff)) / L);
    const k = Math.max(k0, Math.ceil((front + need - (ZEBRA_X - yieldOff)) / L));
    const zx = ZEBRA_X + k * L;
    let side = pedSide;
    if (active.some((p) => p.zx === zx && p.side === side && p.state === 'menunggu')) side = side === 'utara' ? 'selatan' : 'utara';
    pedSide = side === 'utara' ? 'selatan' : 'utara';
    const north = side === 'utara';
    const p = {
      id: `pejalan-${nextId++}`,
      kind: 'pedestrian',
      label: 'Pejalan kaki',
      zx,
      side,
      x: zx + (north ? -0.8 : 0.8),
      y: north ? -PED_Y : PED_Y,
      heading: north ? Math.PI / 2 : -Math.PI / 2,
      radius: 0.3,
      speed: 0,
      vx: 0,
      vy: 0,
      state: 'menunggu',
      wait: 0,
      t: 0,
      phase: 0,
      alpha: 1,
    };
    peds.push(p);
    return { ok: true, ped: p, nextLap: k > k0, distance: zx - ZEBRA_HALF - front };
  }

  function pedCanStart(p, yieldTo) {
    const zA = p.zx - ZEBRA_HALF;
    const zB = p.zx + ZEBRA_HALF;
    const eFront = ego.x + ego.length / 2;
    const eRear = ego.x - ego.length / 2;
    const egoPassed = eRear > zB + 0.5;
    const egoYielding = yieldTo === p.id && ego.speed < 1.5 && eFront < zA - 0.5;
    // Pejalan kaki selalu menunggu mobil otonom berhenti (sesuai catatan di langkah 2), sejauh
    // apa pun mobilnya. Kalau ia boleh menyeberang sendiri saat mobil masih jauh, tugas memberi
    // jalan tidak akan pernah terjadi bila tombol ditekan agak terlambat.
    if (!(egoPassed || egoYielding)) return false;
    for (const c of oncoming) {
      const F = c.x - c.length / 2;
      const R = c.x + c.length / 2;
      if (R < zA - 0.5) continue; // sudah lewat
      if (F <= zB + 0.8) return false; // sedang di atas zebra
      const d = F - (zB + YIELD_GAP + 0.3);
      if (d < 90 && c.yieldTo !== p.id && d < (c.speed * c.speed) / (2 * 3) + 6) return false;
    }
    return true;
  }

  function updatePeds(dt, yieldTo) {
    for (let i = peds.length - 1; i >= 0; i--) {
      const p = peds[i];
      const north = p.side === 'utara';
      if (p.state === 'menunggu') {
        p.wait += dt;
        p.speed = 0;
        p.vy = 0;
        if (pedCanStart(p, yieldTo)) {
          p.state = 'menyeberang';
          events.push({ type: 'pejalan-mulai', ped: p });
        }
      } else if (p.state === 'menyeberang') {
        const dir = north ? 1 : -1;
        p.speed = PED_SPEED;
        p.vy = dir * PED_SPEED;
        p.y += p.vy * dt;
        p.phase += dt * 7;
        if ((dir > 0 && p.y >= PED_Y) || (dir < 0 && p.y <= -PED_Y)) {
          p.y = dir * PED_Y;
          p.state = 'selesai';
          p.t = 0;
          p.heading = north ? 0 : Math.PI; // berjalan menjauh di trotoar
          events.push({ type: 'pejalan-selesai', ped: p });
        }
      } else {
        p.t += dt;
        p.speed = 1.2;
        p.x += Math.cos(p.heading) * p.speed * dt;
        p.vx = Math.cos(p.heading) * p.speed;
        p.vy = 0;
        p.phase += dt * 6;
        p.alpha = Math.max(0, 1 - p.t / 3);
        if (p.t > 3) peds.splice(i, 1);
        continue;
      }
      if (p.zx < ego.x - 160) peds.splice(i, 1);
    }
  }

  // ---------- mobil mogok ----------

  /** Taruh mobil mogok di tempat berikutnya yang masih bisa didekati dengan nyaman. */
  function placeStalled() {
    const front = ego.x + ego.length / 2;
    const rearOff = STALL_X - 2.25;
    const need = (ego.speed * ego.speed) / (2 * 1.5) + 8 + 14;
    const k0 = Math.ceil((front + 0.5 - rearOff) / L);
    const k = Math.max(k0, Math.ceil((front + need - rearOff) / L));
    stalled.active = true;
    stalled.fromK = k;
    return { nextLap: k > k0, distance: rearOff + k * L - front };
  }

  function removeStalled() {
    stalled.active = false;
  }

  function stallBox(k) {
    return { id: `mogok-${k}`, kind: 'car', x: STALL_X + k * L, y: STALL_Y, heading: 0, length: 4.5, width: 1.8 };
  }

  // ---------- tabrakan (jaring pengaman, seharusnya tidak pernah terjadi) ----------

  function checkCollisions() {
    if (W.time - lastHit < 2) return;
    let what = null;
    for (const c of oncoming) if (Math.abs(c.x - ego.x) < 6 && boxesOverlap(ego, c)) what = 'mobil dari arah berlawanan';
    if (stalled.active) {
      const k = Math.round((ego.x - STALL_X) / L);
      if (k >= stalled.fromK && boxesOverlap(ego, stallBox(k))) what = 'mobil mogok';
    }
    for (const p of peds) if (p.state !== 'selesai' && distanceToBox(p.x, p.y, ego) < p.radius) what = 'pejalan kaki';
    for (const c of oncoming) for (const p of peds) if (p.state === 'menyeberang' && distanceToBox(p.x, p.y, c) < p.radius) what = 'pejalan kaki dan mobil lawan';
    if (what) {
      lastHit = W.time;
      W.collisions += 1;
      events.push({ type: 'tabrakan', what });
    }
  }

  // ---------- langkah simulasi ----------

  /** planner: { update(dt), yieldTo, shift(dx) } dari planner.js */
  function update(dt, planner) {
    W.time += dt;
    signal.update(dt);
    planner.update(dt);
    updateOncoming(dt);
    cross.update(dt, signal.side);
    updatePeds(dt, planner.yieldTo);
    checkCollisions();
    // geser dunia mundur satu putaran bila mobil otonom sudah terlalu jauh
    if (ego.x > L + 20) shift(-L, planner);
  }

  function shift(dx, planner) {
    ego.x += dx;
    for (const c of oncoming) c.x += dx;
    for (const p of peds) {
      p.x += dx;
      p.zx += dx;
    }
    stalled.fromK += Math.round(dx / L);
    W.viewMaxX += dx;
    planner?.shift(dx);
  }

  /** Mulai ulang dunia dengan mobil otonom di x tertentu dan melaju pada kecepatan v. */
  function reset(egoX, v) {
    W.time = 0;
    rng.reseed(11);
    nextId = 1;
    colorIdx = 0;
    lastHit = -10;
    W.collisions = 0;
    pedSide = 'utara';
    ego.setPose(egoX, EGO_Y, 0);
    ego.speed = v;
    W.viewMaxX = egoX + 60; // diperbarui lagi oleh render berikutnya
    peds.length = 0;
    events.length = 0;
    signal.reset('MAIN_GREEN');
    cross.reset();
    seedOncoming();
    if (stalled.active) {
      stalled.fromK = 0;
      // jangan sampai mobil mogok muncul tepat di depan mobil otonom
      const front = ego.x + ego.length / 2;
      while (STALL_X + stalled.fromK * L - 2.25 - front < 40) stalled.fromK += 1;
      while (STALL_X + (stalled.fromK - 1) * L - 2.25 - front >= 40) stalled.fromK -= 1;
    }
  }

  function drainEvents() {
    return events.splice(0);
  }

  // ---------- menggambar ----------

  /**
   * Gambar pemandangan dan semua pelaku kecuali mobil otonom.
   * vis: area dunia yang terlihat { minX, minY, maxX, maxY }.
   */
  function draw(g, view, vis, { reducedMotion = false } = {}) {
    const kMin = Math.floor((vis.minX - 30) / L);
    const kMax = Math.floor((vis.maxX + 30) / L);
    const w = vis.maxX - vis.minX;
    const h = vis.maxY - vis.minY;

    g.fillStyle = COLORS.ground;
    g.fillRect(vis.minX, vis.minY, w, h);
    // trotoar
    g.fillStyle = COLORS.sidewalk;
    g.fillRect(vis.minX, -ROAD_HALF - WALK, w, 2 * (ROAD_HALF + WALK));
    for (let k = kMin; k <= kMax; k++) g.fillRect(k * L + INT_X - SIDE_HALF - WALK, vis.minY, 2 * (SIDE_HALF + WALK), h);
    // aspal
    g.fillStyle = COLORS.asphalt;
    g.fillRect(vis.minX, -ROAD_HALF, w, 2 * ROAD_HALF);
    for (let k = kMin; k <= kMax; k++) g.fillRect(k * L + INT_X - SIDE_HALF, vis.minY, 2 * SIDE_HALF, h);

    for (let k = kMin; k <= kMax; k++) {
      g.save();
      g.translate(k * L, 0);
      drawMarkings(g, vis);
      g.restore();
    }
    for (let k = kMin; k <= kMax; k++) {
      g.save();
      g.translate(k * L, 0);
      for (const b of statics.buildings) drawBuilding(g, b);
      for (const l of statics.lamps) {
        g.fillStyle = '#64748b';
        g.beginPath();
        g.arc(l.x, l.y, 0.22, 0, Math.PI * 2);
        g.fill();
      }
      g.translate(INT_X, 0);
      cross.draw(g);
      g.restore();
    }

    // mobil mogok (berulang di setiap putaran mulai fromK)
    if (stalled.active) {
      const blinkOn = reducedMotion || Math.floor(W.time * 3) % 2 === 0;
      for (let k = Math.max(kMin, stalled.fromK); k <= kMax; k++) drawStalled(g, stallBox(k), blinkOn);
    }
    for (const c of oncoming) if (c.x > vis.minX - 5 && c.x < vis.maxX + 5) drawCar(g, c);
    for (const p of peds) {
      if (p.x < vis.minX - 3 || p.x > vis.maxX + 3) continue;
      if (p.state === 'menunggu') {
        const pulse = reducedMotion ? 0 : (Math.sin(W.time * 4) + 1) * 2;
        drawRing(g, p.x, p.y, view.px(12 + pulse), { color: COLORS.target, width: 1.5, view, alpha: 0.85 });
      }
      drawPedestrian(g, p, { view, phase: p.phase, minPx: 15, alpha: p.alpha });
    }
    for (let k = kMin; k <= kMax; k++) {
      g.save();
      g.translate(k * L, 0);
      for (const t of statics.trees) drawTree(g, t.x, t.y, t.r);
      drawTrafficLight(g, { ...WEST_LIGHT, state: signal.main }, { view, minPx: 18, alpha: 0.85 });
      drawTrafficLight(g, { ...SOUTH_LIGHT, state: signal.side }, { view, minPx: 18, alpha: 0.85 });
      drawTrafficLight(g, { ...NORTH_LIGHT, state: signal.side }, { view, minPx: 18, alpha: 0.85 });
      drawTrafficLight(g, { ...EAST_LIGHT, state: signal.main }, { view, minPx: 30 });
      g.restore();
    }
  }

  function drawMarkings(g, vis) {
    const yellow = { color: COLORS.centerLine, width: 0.15, cap: 'butt' };
    const edge = { color: 'rgba(229, 231, 235, 0.5)', width: 0.12, cap: 'butt' };
    const seg = (x0, x1, y) => [
      { x: x0, y },
      { x: x1, y },
    ];
    drawLine(g, seg(0, STOP_E + 0.2, 0), yellow);
    drawLine(g, seg(STOP_W - 0.2, PASS_A, 0), yellow);
    drawLine(g, seg(PASS_A, PASS_B, 0), { ...yellow, dash: [3, 3] });
    drawLine(g, seg(PASS_B, L, 0), yellow);
    for (const y of [-ROAD_HALF + 0.25, ROAD_HALF - 0.25]) {
      drawLine(g, seg(0, INT_X - SIDE_HALF - 0.3, y), edge);
      drawLine(g, seg(INT_X + SIDE_HALF + 0.3, L, y), edge);
    }
    // kerb
    g.fillStyle = COLORS.curb;
    for (const y of [-ROAD_HALF - 0.1, ROAD_HALF - 0.1]) {
      g.fillRect(0, y, INT_X - SIDE_HALF, 0.2);
      g.fillRect(INT_X + SIDE_HALF, y, L - INT_X - SIDE_HALF, 0.2);
    }
    // garis tengah jalan simpang
    drawLine(g, seg(vis.minY - 5, -6.6, 0).map((p) => ({ x: INT_X, y: p.x })), yellow);
    drawLine(g, seg(6.6, vis.maxY + 5, 0).map((p) => ({ x: INT_X, y: p.x })), yellow);
    drawCrosswalk(g, statics.zebra);
    for (const s of statics.lines) drawStopLine(g, s);
    for (const s of statics.yieldLines) drawStopLine(g, s, { color: '#cbd5e1' });
  }

  function drawStalled(g, box, blinkOn) {
    drawCar(g, box, { color: '#7a8497' });
    const hl = box.length / 2 - 0.12;
    const hw = box.width / 2 - 0.14;
    for (const [sx, sy] of [
      [hl, -hw],
      [hl, hw],
      [-hl, -hw],
      [-hl, hw],
    ]) {
      const x = box.x + sx;
      const y = box.y + sy;
      if (blinkOn) {
        g.fillStyle = withAlpha('#fbbf24', 0.35);
        g.beginPath();
        g.arc(x, y, 0.5, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = blinkOn ? '#fbbf24' : '#7c5a12';
      g.beginPath();
      g.arc(x, y, 0.2, 0, Math.PI * 2);
      g.fill();
    }
  }

  Object.assign(W, {
    update,
    reset,
    shift,
    draw,
    setDensity,
    spawnPed,
    placeStalled,
    removeStalled,
    stallBox,
    drainEvents,
  });
  return W;
}
