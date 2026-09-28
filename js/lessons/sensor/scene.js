// Dunia simulasi pelajaran Sensor: jalan buntu dengan tembok di belakang mobil otonom,
// persimpangan berlampu di depan, zebra cross, dan beberapa pengguna jalan lain.
//
// Koordinat dalam meter, y ke bawah, lalu lintas kiri:
//   jalan utama membentang timur-barat di y = 0. Lajur ke timur (lajur mobil otonom) di sisi
//   utara (y = -1,75), lajur ke barat di sisi selatan (y = +1,75).
//   Jalan simpang utara-selatan di x = 48. Lajur ke selatan di sisi timur (x = 49,75).
//
// File ini hanya berisi "model" dunia (membangun, memperbarui, menggambar). Logika pelajaran,
// sensor, tugas, dan panel kontrol ada di ../sensor.js.

import { Vehicle, PathAgent } from '../../engine/vehicle.js';
import { Path, bezierPoints, joinPolylines, castRay } from '../../engine/geometry.js';
import { TrafficLight, SignalPlan, laneTargetSpeed } from '../../engine/traffic.js';
import { crosswalk, stopLine } from '../../engine/road.js';
import { clamp } from '../../engine/math.js';
import { COLORS } from '../../engine/theme.js';
import {
  rectBox,
  drawBuilding,
  drawTree,
  drawWall,
  drawCar,
  drawPedestrian,
  drawCyclist,
  drawTrafficLight,
  drawSpeedSign,
  drawCrosswalk,
  drawStopLine,
  drawLine,
} from '../../engine/draw.js';

export const EGO_START = { x: -4, y: -1.75 };
const FRONT_LIMIT_X = 36; // mobil otonom tidak boleh maju melewati garis ini (sebelum zebra cross)

// ---------- jalur kendaraan dan pejalan kaki ----------

// mobil di depan: lurus ke timur di lajur mobil otonom
const PATH_EAST = new Path([
  { x: -10, y: -1.75 },
  { x: 175, y: -1.75 },
]);
// mobil yang sama setelah muncul lagi: dari utara, belok kiri ke lajur timur
const PATH_SIDE = new Path(
  joinPolylines(
    [{ x: 49.75, y: -95 }, { x: 49.75, y: -5.5 }],
    bezierPoints({ x: 49.75, y: -5.5 }, { x: 49.75, y: -1.75 }, { x: 53.5, y: -1.75 }, null, 10),
    [{ x: 175, y: -1.75 }],
  ),
);
// mobil dari arah berlawanan: ke barat, lalu belok kiri ke selatan di persimpangan
const PATH_WEST = new Path(
  joinPolylines(
    [{ x: 175, y: 1.75 }, { x: 53.5, y: 1.75 }],
    bezierPoints({ x: 53.5, y: 1.75 }, { x: 49.75, y: 1.75 }, { x: 49.75, y: 5.5 }, null, 10),
    [{ x: 49.75, y: 95 }],
  ),
);
// pesepeda: ke utara di tepi kiri lajur utara
const PATH_CYCLE = new Path([
  { x: 45.2, y: 70 },
  { x: 45.2, y: -70 },
]);

const PED_NORTH = -7.2;
const PED_SOUTH = 5.0;
const PED_X = 41.2;

export function createScene() {
  // ---------- lampu lalu lintas ----------
  const light = new TrafficLight({ id: 'lampu', x: 37.9, y: -7.3, heading: Math.PI, label: 'Lampu lalu lintas' });
  const lightWest = new TrafficLight({ id: 'lampu-barat', x: 54.4, y: 7.3, heading: 0 });
  const lightSouth = new TrafficLight({ id: 'lampu-selatan', x: 53.3, y: -7.3, heading: -Math.PI / 2 });
  const lightNorth = new TrafficLight({ id: 'lampu-utara', x: 42.7, y: 7.4, heading: Math.PI / 2 });
  // fase 0: jalan utama (timur-barat) hijau, fase 1: jalan simpang hijau
  const plan = new SignalPlan(
    [
      { lights: [light, lightWest], green: 11 },
      { lights: [lightSouth, lightNorth], green: 9 },
    ],
    { yellow: 3, allRed: 1.5, offset: 15.5 },
  );

  // ---------- benda diam ----------
  const wall = { id: 'tembok', kind: 'wall', label: 'Tembok', ...rectBox(-15.2, -9.2, -14, 6.6) };
  const parked = new Vehicle({ id: 'mobil-parkir', label: 'Mobil parkir', x: -9, y: -4.75, heading: 0, color: '#6b7a90' });
  const sign = { id: 'rambu', kind: 'sign', label: 'Rambu batas kecepatan', x: 22, y: -7.4, radius: 0.3, text: '40' };
  const buildings = [
    rectBox(-40, -32, -15.2, 32),
    rectBox(-12, -26, 4, -11),
    rectBox(6.5, -23, 22, -11),
    rectBox(24.5, -28, 39.5, -11.5),
    rectBox(56.5, -24, 72, -9),
    rectBox(74.5, -21, 93, -9.5),
    rectBox(-12, 8.5, 5.5, 25),
    rectBox(8, 8.5, 23.5, 21),
    rectBox(26, 9, 39.5, 24),
    rectBox(56.5, 9, 75, 23),
    rectBox(77.5, 8.5, 96, 21),
  ].map((b, i) => ({ ...b, id: `gedung-${i}`, kind: 'building', label: 'Gedung' }));
  const trees = [
    { x: 2, y: -7.6, r: 1.7 },
    { x: 16, y: -7.6, r: 1.5 },
    { x: 31, y: -7.7, r: 1.6 },
    { x: -5, y: 5.2, r: 1.6 },
    { x: 12, y: 5.2, r: 1.5 },
    { x: 27, y: 5.2, r: 1.7 },
    { x: 62, y: -5.2, r: 1.5 },
    { x: 66, y: 5.2, r: 1.6 },
  ];
  const trunks = trees.map((t, i) => ({ id: `pohon-${i}`, kind: 'tree', label: 'Pohon', x: t.x, y: t.y, radius: 0.3 }));
  const streetLamps = [
    { x: 8, y: -8.4 },
    { x: 26, y: -8.4 },
    { x: -9, y: 6 },
    { x: 19, y: 6 },
    { x: 36, y: 6 },
    { x: 58, y: -7.5 },
    { x: 60, y: 7.5 },
  ];

  // ---------- marka ----------
  const zebra = crosswalk({ x: PED_X, y: 0, heading: Math.PI / 2, length: 7, width: 3.6 });
  const stops = [
    stopLine({ x: 38.4, y: -1.75, heading: 0 }),
    stopLine({ x: 53.7, y: 1.75, heading: Math.PI }),
    stopLine({ x: 49.75, y: -5.7, heading: Math.PI / 2 }),
    stopLine({ x: 46.25, y: 5.7, heading: -Math.PI / 2 }),
  ];

  // ---------- pelaku bergerak ----------
  const ego = new Vehicle({ id: 'ego', label: 'Mobil otonom', ego: true, x: EGO_START.x, y: EGO_START.y, heading: 0, maxSpeed: 2.5, maxReverse: 1.6, maxAccel: 1.5, maxBrake: 4 });
  const carAhead = new PathAgent({ id: 'mobil-depan', label: 'Mobil di depan', path: PATH_EAST, cruise: 9, color: '#7d8fb0' });
  const oncoming = new PathAgent({ id: 'mobil-lawan', label: 'Mobil dari arah berlawanan', path: PATH_WEST, cruise: 10, color: '#8d9ab3' });
  const cyclist = new PathAgent({ id: 'pesepeda', kind: 'cyclist', label: 'Pesepeda', path: PATH_CYCLE, cruise: 4.5, accel: 1.2 });
  const pedestrian = {
    id: 'pejalan',
    kind: 'pedestrian',
    label: 'Pejalan kaki',
    radius: 0.35,
    x: PED_X,
    y: PED_NORTH,
    heading: Math.PI / 2,
    speed: 0,
    vx: 0,
    vy: 0,
    side: 'north',
    walking: false,
    step: 0,
  };

  const stopsFor = (path) => {
    if (path === PATH_EAST) return [{ s: PATH_EAST.closest(38.4, -1.75).s, light }];
    if (path === PATH_SIDE) return [{ s: PATH_SIDE.closest(49.75, -5.7).s, light: lightSouth }];
    if (path === PATH_WEST) return [{ s: PATH_WEST.closest(53.7, 1.75).s, light: lightWest }];
    return [{ s: PATH_CYCLE.closest(45.2, 5.9).s, light: lightNorth }];
  };

  // objek yang bisa dideteksi sensor (target)
  const objects = [light, sign, carAhead, oncoming, pedestrian, cyclist, parked, wall, ...buildings, ...trunks];
  for (const b of buildings) b._br = Math.hypot(b.length, b.width) / 2;
  // objek penting yang ditampilkan di tabel dan bisa dipilih
  const tracked = [light, sign, carAhead, oncoming, pedestrian, cyclist, parked, wall];

  const drive = { forward: false, back: false };
  const state = { blocked: null };

  function reset() {
    ego.setPose(EGO_START.x, EGO_START.y, 0);
    carAhead.setPath(PATH_EAST, PATH_EAST.closest(16, -1.75).s);
    carAhead.speed = 0;
    oncoming.setPath(PATH_WEST, PATH_WEST.closest(118, 1.75).s);
    oncoming.speed = oncoming.cruise;
    cyclist.setPath(PATH_CYCLE, PATH_CYCLE.closest(45.2, 14).s);
    cyclist.speed = 0;
    Object.assign(pedestrian, { x: PED_X, y: PED_NORTH, heading: Math.PI / 2, speed: 0, vx: 0, vy: 0, side: 'north', walking: false, step: 0 });
    drive.forward = false;
    drive.back = false;
    state.blocked = null;
    plan.update(0);
  }

  /** Jarak bebas dari bemper (arah 1 = depan, -1 = belakang) ke objek terdekat. */
  function gap(dir) {
    const c = Math.cos(ego.heading) * dir;
    const s = Math.sin(ego.heading) * dir;
    let best = Infinity;
    for (const off of [-0.8, 0, 0.8]) {
      const ox = ego.x + c * (ego.length / 2) - s * off;
      const oy = ego.y + s * (ego.length / 2) + c * off;
      const hit = castRay(objects, ox, oy, c, s, 40, { ignore: ego });
      if (hit) best = Math.min(best, hit.t);
    }
    return best;
  }

  function updateEgo(dt) {
    const target = drive.forward && !drive.back ? 2.2 : drive.back && !drive.forward ? -1.4 : 0;
    const accel = clamp((target - ego.speed) * 2.5, -ego.maxBrake, ego.maxAccel);
    ego.step(dt, { accel, steer: 0 });
    // pengaman sederhana: berhenti sebelum menabrak (mobil otonom sungguhan punya rem darurat otomatis)
    state.blocked = null;
    if (ego.speed < 0 && gap(-1) < 0.2) {
      ego.speed = 0;
      state.blocked = 'belakang';
    }
    if (ego.speed > 0 && gap(1) < 1.2) {
      ego.speed = 0;
      state.blocked = 'depan';
    }
    if (ego.x + ego.length / 2 > FRONT_LIMIT_X && ego.speed > 0) {
      ego.speed = 0;
      state.blocked = 'batas';
    }
  }

  function updateAgent(agent, dt) {
    agent.step(dt, laneTargetSpeed(agent, stopsFor(agent.path), { decel: 3 }));
    if (agent.done) {
      if (agent === carAhead) agent.setPath(PATH_SIDE, 0);
      else agent.setPath(agent.path, 0);
      agent.speed = agent.cruise * 0.8;
    }
  }

  function updatePedestrian(dt) {
    const p = pedestrian;
    if (!p.walking) {
      // menyeberang saat jalan utama merah (fase 1 baru mulai)
      if (plan.phaseIndex === 1 && plan.phaseTime < 2.5) p.walking = true;
    }
    if (p.walking) {
      const dir = p.side === 'north' ? 1 : -1;
      p.speed = 1.35;
      p.y += dir * p.speed * dt;
      p.heading = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      p.step += dt * 7;
      const goal = dir > 0 ? PED_SOUTH : PED_NORTH;
      if ((dir > 0 && p.y >= goal) || (dir < 0 && p.y <= goal)) {
        p.y = goal;
        p.walking = false;
        p.side = p.side === 'north' ? 'south' : 'north';
        p.speed = 0;
      }
      p.vx = 0;
      p.vy = dir * p.speed;
    } else {
      p.vx = 0;
      p.vy = 0;
      p.heading = p.side === 'north' ? Math.PI / 2 : -Math.PI / 2;
    }
  }

  function update(dt, time) {
    plan.update(time);
    updateEgo(dt);
    updateAgent(carAhead, dt);
    updateAgent(oncoming, dt);
    updateAgent(cyclist, dt);
    updatePedestrian(dt);
  }

  // ---------- menggambar ----------

  function drawGroundAndRoads(g) {
    // latar sudah berwarna trotoar (view.begin). Isi blok dengan rumput.
    g.fillStyle = COLORS.ground;
    for (const [x0, y0, x1, y1] of [
      [-60, -60, 41.5, -9],
      [54.5, -60, 220, -6.5],
      [-60, 6.5, 41.5, 60],
      [54.5, 6.5, 220, 60],
    ]) {
      g.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
    // aspal
    g.fillStyle = COLORS.asphalt;
    g.fillRect(-14, -3.5, 240, 7);
    g.fillRect(44.5, -100, 7, 200);
    g.fillStyle = COLORS.asphaltDark;
    g.fillRect(-14, -6, 44, 2.5); // lajur parkir
    // garis tepi lajur parkir dan petak parkir
    drawLine(g, [{ x: -14, y: -3.5 }, { x: 30, y: -3.5 }], { color: 'rgba(229,231,235,0.55)', width: 0.12 });
    for (let x = -14; x <= 30; x += 6.5) drawLine(g, [{ x, y: -6 }, { x, y: -3.5 }], { color: 'rgba(229,231,235,0.45)', width: 0.12 });
    // garis tengah kuning dan garis tepi
    const yellow = { color: COLORS.centerLine, width: 0.15 };
    drawLine(g, [{ x: -13.5, y: 0 }, { x: 38.4, y: 0 }], yellow);
    drawLine(g, [{ x: 53.7, y: 0 }, { x: 220, y: 0 }], yellow);
    drawLine(g, [{ x: 48, y: -100 }, { x: 48, y: -5.7 }], yellow);
    drawLine(g, [{ x: 48, y: 5.7 }, { x: 48, y: 100 }], yellow);
    const edge = { color: 'rgba(229,231,235,0.5)', width: 0.12 };
    drawLine(g, [{ x: -14, y: 3.3 }, { x: 39, y: 3.3 }], edge);
    drawLine(g, [{ x: 30, y: -3.3 }, { x: 39, y: -3.3 }], edge);
    drawLine(g, [{ x: 55, y: -3.3 }, { x: 220, y: -3.3 }], edge);
    drawLine(g, [{ x: 55, y: 3.3 }, { x: 220, y: 3.3 }], edge);
    drawCrosswalk(g, zebra);
    for (const s of stops) drawStopLine(g, s);
  }

  /**
   * Gambar seluruh dunia.
   * opts: { view, night }
   */
  function draw(g, { view, night = false }) {
    drawGroundAndRoads(g);
    for (const b of buildings) drawBuilding(g, b);
    drawWall(g, wall);
    // tiang lampu jalan
    for (const l of streetLamps) {
      g.fillStyle = '#64748b';
      g.beginPath();
      g.arc(l.x, l.y, 0.22, 0, Math.PI * 2);
      g.fill();
    }
    drawCar(g, parked);
    drawCar(g, carAhead, { headlights: night });
    drawCar(g, oncoming, { headlights: night });
    drawCyclist(g, cyclist, { view });
    drawPedestrian(g, pedestrian, { view, phase: pedestrian.step });
    for (const t of trees) drawTree(g, t.x, t.y, t.r);
    for (const l of [lightWest, lightSouth, lightNorth]) drawTrafficLight(g, l, { view, minPx: 16, alpha: 0.85 });
    drawTrafficLight(g, light, { view, minPx: 34 });
    drawSpeedSign(g, sign, { view });
    drawCar(g, ego, { headlights: night });
  }

  /** Sumber cahaya untuk efek malam (lampu mobil, lampu jalan, lampu lalu lintas). */
  function nightLights() {
    const out = [];
    for (const car of [ego, carAhead, oncoming]) {
      const f = car.length / 2;
      out.push({ type: 'cone', x: car.x + Math.cos(car.heading) * f, y: car.y + Math.sin(car.heading) * f, heading: car.heading, fov: 0.9, range: car === ego ? 28 : 20 });
    }
    for (const l of streetLamps) out.push({ type: 'point', x: l.x, y: l.y, radius: 7, strength: 0.55 });
    for (const l of [light, lightWest, lightSouth, lightNorth]) out.push({ type: 'point', x: l.x, y: l.y, radius: 3, strength: 0.6 });
    return out;
  }

  reset();

  return {
    ego,
    objects,
    tracked,
    plan,
    light,
    drive,
    state,
    reset,
    update,
    draw,
    nightLights,
    rearGap: () => gap(-1),
    frontGap: () => gap(1),
  };
}
