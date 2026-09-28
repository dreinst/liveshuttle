// Dunia simulasi pelajaran Persepsi: jalan kota lurus yang polanya berulang tiap TILE meter.
//
// Koordinat dalam meter, y ke bawah, lalu lintas kiri. Mobil otonom melaju ke timur (+x) di
// lajur utara (y = -1,75). Dari utara ke selatan:
//   gedung | trotoar utara | lajur parkir | lajur mobil otonom | garis tengah |
//   lajur arah berlawanan (ke barat) | trotoar selatan dengan halte | gedung
// Tiap petak punya satu zebra cross. Satu pejalan kaki menunggu di sisi selatan dan mulai
// menyeberang ketika mobil otonom mendekat. Mobil otonom dan kendaraan lain berhenti untuknya.
//
// Kamera tampilan mengikuti mobil otonom, jadi dunia tampak bergulir. Benda diam dibangun per
// petak dari pola yang sama. Pelaku bergerak dimunculkan di depan (di luar layar) dan dihapus
// setelah jauh di belakang. File ini hanya berisi model dunia; sensor dan fusi ada di
// ./perception.js, teks dan panel ada di ../persepsi.js.

import { Vehicle } from '../../engine/vehicle.js';
import { speedToStop, followingSpeed } from '../../engine/traffic.js';
import { clamp, approach, Rng } from '../../engine/math.js';
import { COLORS } from '../../engine/theme.js';
import { crosswalk } from '../../engine/road.js';
import { rectBox, drawBuilding, drawTree, drawCar, drawPedestrian, drawCyclist, drawHalte, drawCrosswalk, drawLine } from '../../engine/draw.js';

export const TILE = 80;
export const LANE_Y = -1.75; // tengah lajur mobil otonom
export const EGO_CRUISE = 5; // m/s, sekitar 18 km/jam

const Y_BLD_N = -9.8; // batas gedung utara
const Y_PARK = -6; // tepi utara lajur parkir (batas trotoar utara)
const Y_PARK_EDGE = -3.5; // batas lajur parkir dan lajur mobil otonom
const Y_ROAD_S = 3.5; // tepi selatan jalan
const Y_BLD_S = 7.4; // batas gedung selatan
const PARK_Y = -4.75;
const ONCOMING_Y = 1.75;
const CYCLE_Y = 3.0;

const ZEBRA_U = 56;
const ZEBRA_W = 4;
const HALTE_U = 22;
const PARK_SLOTS = [6, 12.5, 29, 35.5, 69, 75.5];
const MANHOLE_U = [8, 24, 40, 68];
const TREES_N = [17, 47, 64];
const TREES_S = [6, 38, 66];
const BLD_N = [[1, 15], [17, 33], [35, 52], [54, 67], [69, 79]];
const BLD_S = [[1, 17], [19, 36], [38, 50], [52, 64], [66, 79]];
const BLD_DEPTH_N = [14, 11, 15, 12, 13];
const BLD_DEPTH_S = [12, 15, 11, 14, 12];
// garis jalan pejalan kaki di trotoar (dir 1 = ke timur, -1 = ke barat)
const WALK_LINES = [
  { y: -8.8, dir: 1 },
  { y: -7.8, dir: -1 },
  { y: 4.9, dir: 1 },
  { y: 5.55, dir: -1 },
];
const CROSS_WAIT_Y = 4.15;
const CROSS_END_Y = -8.8;
const CROSS_SPEED = 1.35;

function hash(k, i) {
  const s = Math.sin(k * 127.1 + i * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export function createScene({ seed = 3 } = {}) {
  const rng = new Rng(seed);
  const ego = new Vehicle({ id: 'ego', label: 'Mobil otonom', ego: true, x: 0, y: LANE_Y, heading: 0, maxSpeed: 8, maxAccel: 1.2, maxBrake: 4 });
  const tiles = new Map();
  const actors = [];
  const state = { time: 0, yielding: false, nextWalker: 0, nextCar: 0, nextCyclist: 0, serial: 1 };

  // ---------- petak benda diam ----------
  function buildTile(k) {
    const x0 = k * TILE;
    const buildings = [];
    BLD_N.forEach(([a, b], i) => buildings.push(rectBox(x0 + a, Y_BLD_N - BLD_DEPTH_N[i], x0 + b, Y_BLD_N, { id: `gedung-${k}-u${i}`, kind: 'building' })));
    BLD_S.forEach(([a, b], i) => buildings.push(rectBox(x0 + a, Y_BLD_S + 0.2, x0 + b, Y_BLD_S + 0.2 + BLD_DEPTH_S[i], { id: `gedung-${k}-s${i}`, kind: 'building' })));
    for (const b of buildings) b._br = Math.hypot(b.length, b.width) / 2;
    const trees = [
      ...TREES_N.map((u, i) => ({ id: `pohon-${k}-u${i}`, kind: 'tree', x: x0 + u, y: -6.4, radius: 0.3, canopy: 1.25 })),
      ...TREES_S.map((u, i) => ({ id: `pohon-${k}-s${i}`, kind: 'tree', x: x0 + u, y: 4.2, radius: 0.3, canopy: 1.15 })),
    ];
    const parked = [];
    PARK_SLOTS.forEach((u, i) => {
      if (hash(k, i) < 0.22) return; // sebagian petak parkir kosong
      parked.push({
        id: `parkir-${k}-${i}`,
        kind: 'car',
        role: 'parked',
        x: x0 + u,
        y: PARK_Y,
        heading: 0,
        length: 4.5,
        width: 1.8,
        speed: 0,
        vx: 0,
        vy: 0,
        color: COLORS.vehicles[Math.floor(hash(k, i + 10) * COLORS.vehicles.length)],
      });
    });
    const halte = { id: `halte-${k}`, kind: 'halte', x: x0 + HALTE_U, y: 6.6, heading: 0, length: 5, width: 1.2 };
    // papan iklan di ujung barat halte, menghadap ke barat (ke arah mobil otonom datang)
    const ad = { id: `iklan-${k}`, x: x0 + HALTE_U - 2.65, y: 6.6, facing: Math.PI, halte };
    const manholes = MANHOLE_U.map((u, i) => ({ id: `gorong-${k}-${i}`, x: x0 + u, y: -1.35, r: 0.42 }));
    const zebraX = x0 + ZEBRA_U;
    const zebra = crosswalk({ x: zebraX, y: 0, heading: -Math.PI / 2, length: 7, width: ZEBRA_W });
    const tile = { k, x0, buildings, trees, parked, halte, ad, manholes, zebra, zebraX, statics: [...buildings, ...trees, ...parked, halte] };
    tiles.set(k, tile);
    // pejalan kaki yang akan menyeberang di zebra cross petak ini
    if (zebraX > ego.x + 20) {
      actors.push({
        id: `penyeberang-${k}`,
        kind: 'pedestrian',
        role: 'crosser',
        radius: 0.35,
        x: zebraX + 0.6,
        y: CROSS_WAIT_Y,
        heading: -Math.PI / 2,
        speed: 0,
        vx: 0,
        vy: 0,
        step: 0,
        state: 'wait',
        zebraX,
      });
    }
    return tile;
  }

  function ensureTiles() {
    const k0 = Math.floor((ego.x - 70) / TILE);
    const k1 = Math.floor((ego.x + 130) / TILE);
    for (let k = k0; k <= k1; k++) if (!tiles.has(k)) buildTile(k);
    for (const k of tiles.keys()) if (k < k0 || k > k1) tiles.delete(k);
  }

  // ---------- pelaku bergerak ----------
  function spawnWalker(x, line = rng.pick(WALK_LINES)) {
    actors.push({
      id: `pejalan-${state.serial++}`,
      kind: 'pedestrian',
      role: 'walker',
      radius: 0.35,
      x,
      y: line.y,
      dir: line.dir,
      heading: line.dir > 0 ? 0 : Math.PI,
      cruise: rng.range(1.1, 1.5),
      speed: 0,
      vx: 0,
      vy: 0,
      step: rng.range(0, 6),
    });
  }

  function spawnCar(x, speed = null) {
    const cruise = rng.range(7.5, 9.5);
    actors.push({
      id: `mobil-${state.serial++}`,
      kind: 'car',
      role: 'car',
      x,
      y: ONCOMING_Y,
      heading: Math.PI,
      length: 4.5,
      width: 1.8,
      cruise,
      speed: speed ?? cruise,
      vx: 0,
      vy: 0,
      braking: false,
      color: rng.pick(COLORS.vehicles),
    });
  }

  function spawnCyclist(x) {
    actors.push({
      id: `pesepeda-${state.serial++}`,
      kind: 'cyclist',
      role: 'cyclist',
      x,
      y: CYCLE_Y,
      heading: Math.PI,
      length: 1.8,
      width: 0.6,
      cruise: 4.2,
      speed: 4.2,
      vx: 0,
      vy: 0,
      step: 0,
    });
  }

  const vehicles = () => actors.filter((a) => a.role === 'car' || a.role === 'cyclist');
  const crossers = () => actors.filter((a) => a.role === 'crosser');
  const spawnClear = (x) => !vehicles().some((v) => Math.abs(v.x - x) < 16);

  function spawn() {
    const t = state.time;
    if (t >= state.nextWalker) {
      if (actors.filter((a) => a.role === 'walker').length < 8) spawnWalker(ego.x + rng.range(72, 95));
      state.nextWalker = t + rng.range(3, 6);
    }
    if (t >= state.nextCyclist) {
      const x = ego.x + 108;
      if (spawnClear(x)) {
        spawnCyclist(x);
        state.nextCyclist = t + rng.range(15, 22);
        // beri jarak supaya mobil berikutnya tidak menyusul pesepeda di layar
        state.nextCar = Math.max(state.nextCar, t + 11);
      } else state.nextCyclist = t + 1;
    }
    if (t >= state.nextCar) {
      const x = ego.x + 110 + rng.range(0, 10);
      if (spawnClear(x)) {
        spawnCar(x);
        state.nextCar = t + rng.range(6, 10);
      } else state.nextCar = t + 1;
    }
  }

  function updateEgo(dt) {
    let target = EGO_CRUISE;
    const front = ego.x + ego.length / 2;
    for (const p of crossers()) {
      if (p.state !== 'cross' || p.y < -4.3) continue;
      const stopX = p.zebraX - ZEBRA_W / 2 - 1.5;
      const d = stopX - front;
      // mobil otonom mengerem lebih awal dan pelan (0,8 m/s^2) supaya nyaman dan aman
      if (d > -1) target = Math.min(target, d <= 0.05 ? 0 : speedToStop(d, 0.8));
    }
    state.yielding = target < EGO_CRUISE - 0.05;
    const accel = clamp((target - ego.speed) * 2.2, -3.5, ego.maxAccel);
    ego.step(dt, { accel, steer: 0 });
  }

  function updateCrosser(p, dt) {
    if (p.state === 'wait') {
      const front = ego.x + ego.length / 2;
      const rear = ego.x - ego.length / 2;
      const dz = p.zebraX - front;
      // tunggu hanya kendaraan yang sudah terlalu dekat untuk berhenti dengan nyaman
      const stopFront = p.zebraX + ZEBRA_W / 2 + 1.5;
      const busy = vehicles().some((v) => {
        const front = v.x - v.length / 2;
        return v.x + v.length / 2 > p.zebraX - ZEBRA_W / 2 - 1 && front < stopFront + (v.speed * v.speed) / (2 * 2.5) + 1.5;
      });
      if (!busy && ((dz <= 33 && dz >= 10) || rear > p.zebraX + ZEBRA_W / 2 + 1)) p.state = 'cross';
      p.speed = 0;
      p.vx = 0;
      p.vy = 0;
      p.heading = -Math.PI / 2;
      return;
    }
    if (p.state === 'cross') {
      p.speed = approach(p.speed, CROSS_SPEED, 1.2 * dt);
      p.heading = -Math.PI / 2;
      p.y -= p.speed * dt;
      p.vx = 0;
      p.vy = -p.speed;
      p.step += dt * 7;
      if (p.y <= CROSS_END_Y) {
        p.y = CROSS_END_Y;
        p.state = 'walk';
      }
      return;
    }
    p.speed = approach(p.speed, 1.3, 1.2 * dt);
    p.heading = 0;
    p.x += p.speed * dt;
    p.vx = p.speed;
    p.vy = 0;
    p.step += dt * 7;
  }

  function updateWalker(w, walkers, dt) {
    let target = w.cruise;
    // jangan menembus pejalan kaki lain di depannya pada garis yang sama
    for (const o of walkers) {
      if (o === w || o.y !== w.y) continue;
      const ahead = (o.x - w.x) * w.dir;
      if (ahead > 0 && ahead < 1.4) target = Math.min(target, o.speed);
    }
    w.speed = approach(w.speed, target, 1.5 * dt);
    w.x += w.dir * w.speed * dt;
    w.vx = w.dir * w.speed;
    w.vy = 0;
    w.step += dt * 5.5 * w.speed;
  }

  function updateVehicle(v, all, dt) {
    let target = v.cruise;
    // ikuti kendaraan di depan pada lajur yang sama (arah ke barat berarti x lebih kecil)
    let leader = null;
    for (const o of all) {
      if (o === v || o.x >= v.x) continue;
      if (!leader || o.x > leader.x) leader = o;
    }
    if (leader) {
      const gap = v.x - v.length / 2 - (leader.x + leader.length / 2);
      target = Math.min(target, followingSpeed(gap, leader.speed, { cruise: v.cruise, minGap: 2.5, timeGap: 1.2, decel: 3 }));
    }
    // berhenti untuk pejalan kaki yang menyeberang
    for (const p of crossers()) {
      if (p.state !== 'cross' || p.y < -0.8) continue;
      const stopFront = p.zebraX + ZEBRA_W / 2 + 1.5;
      const d = v.x - v.length / 2 - stopFront;
      if (d > -1) target = Math.min(target, d <= 0.05 ? 0 : speedToStop(d, 2.5));
    }
    const rate = target > v.speed ? 1.5 : 4;
    v.braking = target < v.speed - 0.2;
    v.speed = approach(v.speed, target, rate * dt);
    v.x -= v.speed * dt;
    v.vx = -v.speed;
    v.vy = 0;
    if (v.role === 'cyclist') v.step += dt * v.speed;
  }

  function update(dt) {
    state.time += dt;
    ensureTiles();
    spawn();
    updateEgo(dt);
    const walkers = actors.filter((a) => a.role === 'walker');
    const vehs = vehicles();
    for (const a of actors) {
      if (a.role === 'crosser') updateCrosser(a, dt);
      else if (a.role === 'walker') updateWalker(a, walkers, dt);
      else updateVehicle(a, vehs, dt);
    }
    // hapus pelaku yang sudah jauh di belakang
    for (let i = actors.length - 1; i >= 0; i--) {
      const a = actors[i];
      if (a.x < ego.x - 55 || a.x > ego.x + 260) actors.splice(i, 1);
    }
  }

  function reset() {
    rng.reseed(seed);
    tiles.clear();
    actors.length = 0;
    ego.setPose(0, LANE_Y, 0);
    ego.speed = EGO_CRUISE;
    state.time = 0;
    state.yielding = false;
    state.serial = 1;
    ensureTiles();
    for (const dx of [7, 19, 32, 45, 59, 73]) spawnWalker(ego.x + dx + rng.range(-2, 2));
    spawnCar(ego.x + 64);
    spawnCyclist(ego.x + 38);
    state.nextWalker = 3;
    state.nextCar = 6;
    state.nextCyclist = 17;
  }

  // ---------- data untuk sensor ----------

  /** Semua yang dibutuhkan pipeline persepsi pada saat ini. */
  function world() {
    const statics = [];
    const parked = [];
    const adPanels = [];
    const manholes = [];
    for (const t of tiles.values()) {
      statics.push(...t.statics);
      parked.push(...t.parked);
      adPanels.push(t.ad);
      manholes.push(...t.manholes);
    }
    return {
      time: state.time,
      ego,
      objects: [...statics, ...actors],
      relevant: [...parked, ...actors],
      adPanels,
      manholes,
    };
  }

  // ---------- menggambar ----------

  function drawManhole(g, m) {
    g.fillStyle = '#1d222c';
    g.beginPath();
    g.arc(m.x, m.y, m.r, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#5b6578';
    g.lineWidth = 0.07;
    g.stroke();
    g.strokeStyle = 'rgba(91, 101, 120, 0.7)';
    g.lineWidth = 0.05;
    g.beginPath();
    for (const d of [-0.18, 0, 0.18]) {
      const h = Math.sqrt(m.r * m.r - d * d) * 0.85;
      g.moveTo(m.x + d, m.y - h);
      g.lineTo(m.x + d, m.y + h);
    }
    g.stroke();
  }

  function drawAdPanel(g, ad) {
    g.fillStyle = '#0f172a';
    g.fillRect(ad.x - 0.12, ad.y - 0.62, 0.24, 1.24);
    g.fillStyle = '#f9a8d4';
    g.fillRect(ad.x - 0.2, ad.y - 0.55, 0.1, 1.1);
  }

  /**
   * Gambar dunia. opts: { view, underlay(g) } dengan underlay dipanggil setelah jalan
   * dan sebelum kendaraan serta pejalan kaki (untuk jalur rencana).
   */
  function draw(g, { view, underlay = null }) {
    const b = view.visibleBounds();
    const x0 = b.minX - 6;
    const x1 = b.maxX + 6;
    const w = x1 - x0;
    // blok di belakang gedung (latar kanvas sudah berwarna trotoar)
    g.fillStyle = COLORS.ground;
    g.fillRect(x0, b.minY - 6, w, Y_BLD_N - (b.minY - 6));
    g.fillRect(x0, Y_BLD_S, w, b.maxY + 6 - Y_BLD_S);
    // aspal: lajur parkir, lajur mobil otonom, lajur arah berlawanan
    g.fillStyle = COLORS.asphalt;
    g.fillRect(x0, Y_PARK, w, Y_ROAD_S - Y_PARK);
    g.fillStyle = COLORS.asphaltDark;
    g.fillRect(x0, Y_PARK, w, Y_PARK_EDGE - Y_PARK);
    const vis = [...tiles.values()].filter((t) => t.x0 < x1 && t.x0 + TILE > x0);
    // trotoar menjorok di zebra cross (tidak boleh parkir dekat penyeberangan)
    g.fillStyle = COLORS.sidewalk;
    for (const t of vis) g.fillRect(t.zebraX - 5, Y_PARK - 0.05, 10, Y_PARK_EDGE - Y_PARK + 0.05);
    // kerb
    const curb = { color: COLORS.curb, width: 0.22 };
    drawLine(g, [{ x: x0, y: Y_ROAD_S }, { x: x1, y: Y_ROAD_S }], curb);
    for (const t of vis) {
      drawLine(g, [{ x: t.x0, y: Y_PARK }, { x: t.zebraX - 5, y: Y_PARK }], curb);
      drawLine(g, [{ x: t.zebraX - 5, y: Y_PARK }, { x: t.zebraX - 5, y: Y_PARK_EDGE }, { x: t.zebraX + 5, y: Y_PARK_EDGE }, { x: t.zebraX + 5, y: Y_PARK }], curb);
      drawLine(g, [{ x: t.zebraX + 5, y: Y_PARK }, { x: t.x0 + TILE, y: Y_PARK }], curb);
    }
    // marka: garis tengah kuning, garis lajur parkir, garis tepi
    const edge = { color: 'rgba(229, 231, 235, 0.5)', width: 0.12 };
    for (const t of vis) {
      drawLine(g, [{ x: t.x0, y: Y_PARK_EDGE }, { x: t.zebraX - 5, y: Y_PARK_EDGE }], edge);
      drawLine(g, [{ x: t.zebraX + 5, y: Y_PARK_EDGE }, { x: t.x0 + TILE, y: Y_PARK_EDGE }], edge);
      for (const u of [2.75, 9.25, 15.75, 25.75, 32.25, 38.75, 65.75, 72.25, 78.75]) {
        drawLine(g, [{ x: t.x0 + u, y: Y_PARK }, { x: t.x0 + u, y: Y_PARK_EDGE }], { color: 'rgba(229, 231, 235, 0.3)', width: 0.1 });
      }
      drawLine(g, [{ x: t.x0, y: 0 }, { x: t.zebraX - ZEBRA_W / 2 - 1, y: 0 }], { color: COLORS.centerLine, width: 0.15 });
      drawLine(g, [{ x: t.zebraX + ZEBRA_W / 2 + 1, y: 0 }, { x: t.x0 + TILE, y: 0 }], { color: COLORS.centerLine, width: 0.15 });
    }
    drawLine(g, [{ x: x0, y: Y_ROAD_S - 0.2 }, { x: x1, y: Y_ROAD_S - 0.2 }], edge);
    for (const t of vis) {
      drawCrosswalk(g, t.zebra);
      for (const m of t.manholes) drawManhole(g, m);
    }
    for (const t of vis) for (const bd of t.buildings) drawBuilding(g, bd);
    for (const t of vis) {
      drawHalte(g, t.halte);
      drawAdPanel(g, t.ad);
    }
    for (const t of vis) for (const c of t.parked) drawCar(g, c);
    for (const t of vis) for (const tr of t.trees) drawTree(g, tr.x, tr.y, tr.canopy);
    underlay?.(g);
    for (const a of actors) {
      if (a.kind === 'pedestrian') drawPedestrian(g, a, { view, phase: a.step });
      else if (a.kind === 'cyclist') drawCyclist(g, a, { view });
    }
    for (const a of actors) if (a.kind === 'car') drawCar(g, a);
    drawCar(g, ego);
  }

  reset();

  return {
    ego,
    actors,
    state,
    update,
    reset,
    world,
    draw,
  };
}
