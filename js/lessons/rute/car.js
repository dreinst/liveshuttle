// Gerak mobil otonom di sepanjang rute sel pada peta grid.
//
// Rute berupa daftar sel. Mobil berjalan di lajur KIRI (lalu lintas Indonesia), jadi garis
// lintasannya digeser ke kiri dari garis tengah jalan. Di tikungan lintasan dibulatkan, dan
// putar balik dibuat melengkung ke kanan melewati lajur lawan.
//
// Posisi mobil disimpan sebagai u: jarak sepanjang rute yang diukur dari pusat sel ke pusat
// sel (satu sel = CELL meter). Dengan begitu waktu tempuh di layar sama dengan perkiraan waktu
// rute (sel macet ditempuh lebih lambat), walau lintasan di tikungan sedikit lebih pendek.
// Kesamaan ini berlaku karena sel start dan tujuan tidak pernah macet (dijaga oleh ../rute.js).

import { Path, bezierPoints } from '../../engine/geometry.js';
import { clamp } from '../../engine/math.js';
import { CELL, FREE_SPEED, JAM_FACTOR } from './city.js';

export const LANE_OFFSET = CELL * 0.2; // 5 m ke kiri dari garis tengah jalan

const left = (d) => ({ x: d.y, y: -d.x }); // kiri dari arah gerak (y ke bawah)
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a, k) => ({ x: a.x * k, y: a.y * k });

/** Bangun lintasan lajur kiri untuk daftar sel. Hasil: { path, entryS, cells }. */
export function buildLane(city, cells) {
  const n = cells.length;
  const P = cells.map((i) => city.center(i));
  const dirs = [];
  for (let k = 0; k < n - 1; k++) {
    const dx = Math.sign(P[k + 1].x - P[k].x);
    const dy = Math.sign(P[k + 1].y - P[k].y);
    dirs.push({ x: dx, y: dy });
  }
  const half = CELL / 2;
  const pts = [];
  const entryIdx = [0];
  const push = (p) => {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(last.x - p.x, last.y - p.y) > 1e-6) pts.push(p);
  };
  if (n === 1) {
    push(P[0]);
    push({ x: P[0].x + 0.01, y: P[0].y });
    const path = new Path(pts);
    return { path, entryS: [0], cells };
  }
  push(add(P[0], mul(left(dirs[0]), LANE_OFFSET)));
  for (let k = 1; k < n; k++) {
    const din = dirs[k - 1];
    const Lin = mul(left(din), LANE_OFFSET);
    const entry = add(add(P[k], mul(din, -half)), Lin);
    push(entry);
    entryIdx.push(pts.length - 1);
    if (k === n - 1) {
      push(add(P[k], Lin));
      break;
    }
    const dout = dirs[k];
    const Lout = mul(left(dout), LANE_OFFSET);
    const exit = add(add(P[k], mul(dout, half)), Lout);
    if (din.x === dout.x && din.y === dout.y) continue; // lurus: titik masuk sel berikutnya = titik keluar
    if (din.x === -dout.x && din.y === -dout.y) {
      // putar balik: maju sedikit, melengkung ke kanan, lalu kembali di lajur seberang
      const reach = mul(din, CELL * 0.42);
      const pts3 = bezierPoints(entry, add(add(P[k], reach), Lin), add(add(P[k], reach), Lout), exit, 16);
      for (const p of pts3.slice(1)) push(p);
    } else {
      const ctrl = add(add(P[k], Lin), Lout);
      const pts2 = bezierPoints(entry, ctrl, exit, null, 10);
      for (const p of pts2.slice(1)) push(p);
    }
  }
  const path = new Path(pts);
  const entryS = entryIdx.map((idx) => path.cum[idx]);
  return { path, entryS, cells };
}

export function createCar(city) {
  const car = {
    state: 'idle', // 'idle' | 'driving' | 'arrived' | 'blocked'
    cells: [],
    lane: null,
    u: 0,
    elapsed: 0, // detik perjalanan (waktu dunia nyata yang disimulasikan)
    pose: { x: 0, y: 0, heading: 0 },
  };

  function setRoute(cells) {
    car.cells = cells.slice();
    car.lane = cells.length ? buildLane(city, car.cells) : null;
    car.u = 0;
    car.elapsed = 0;
    car.state = 'idle';
    updatePose();
  }

  /** Ganti daftar sel tanpa memindahkan mobil (dipakai saat rute dihitung ulang). */
  function replaceCells(cells) {
    car.cells = cells.slice();
    car.lane = buildLane(city, car.cells);
    car.u = Math.min(car.u, (car.cells.length - 1) * CELL);
    updatePose();
  }

  const totalU = () => Math.max(0, (car.cells.length - 1) * CELL);

  /** Indeks sel (di daftar rute) tempat mobil berada sekarang. */
  const index = () => clamp(Math.round(car.u / CELL), 0, Math.max(0, car.cells.length - 1));

  function uToS(u) {
    const lane = car.lane;
    const n = car.cells.length;
    if (!lane || n < 2) return 0;
    const i = clamp(Math.round(u / CELL), 0, n - 1);
    const u0 = i === 0 ? 0 : (i - 0.5) * CELL;
    const u1 = i === n - 1 ? (n - 1) * CELL : (i + 0.5) * CELL;
    const s0 = i === 0 ? 0 : lane.entryS[i];
    const s1 = i === n - 1 ? lane.path.length : lane.entryS[i + 1];
    return s0 + ((s1 - s0) * (u - u0)) / (u1 - u0 || 1);
  }

  function updatePose() {
    if (!car.lane) return;
    if (car.cells.length < 2) {
      const p = city.center(car.cells[0]);
      car.pose = { x: p.x, y: p.y, heading: car.pose.heading };
      return;
    }
    const s = uToS(car.u);
    const a = car.lane.path.sample(Math.max(0, s - 0.6));
    const b = car.lane.path.sample(Math.min(car.lane.path.length, s + 0.6));
    const p = car.lane.path.sample(s);
    car.pose = { x: p.x, y: p.y, heading: Math.atan2(b.y - a.y, b.x - a.x) };
  }

  /** Kecepatan (m/s) di sel tempat mobil berada. */
  const speedNow = () => (car.cells.length ? FREE_SPEED / (city.jam[car.cells[index()]] ? JAM_FACTOR : 1) : 0);

  /**
   * Majukan mobil. dt = detik simulasi dunia nyata (sudah dikali percepatan animasi).
   * Mengembalikan true bila mobil baru saja sampai di ujung rute.
   */
  function update(dt) {
    if (car.state !== 'driving' && car.state !== 'blocked') return false;
    const end = totalU();
    if (car.u >= end) return false;
    let left = dt;
    // pecah langkah di batas sel supaya kecepatan tiap sel tepat
    while (left > 1e-9 && car.u < end) {
      const v = speedNow();
      const i = index();
      const boundary = Math.min(end, (i + 0.5) * CELL);
      const need = (boundary - car.u) / v;
      if (need > left) {
        car.u += v * left;
        car.elapsed += left;
        left = 0;
      } else {
        car.u = boundary + 1e-6;
        car.elapsed += need;
        left -= need;
      }
    }
    if (car.u >= end) {
      car.u = end;
      updatePose();
      if (car.state === 'driving') {
        car.state = 'arrived';
        return true;
      }
      return false;
    }
    updatePose();
    return false;
  }

  /** Sisa jarak (m) dan sisa waktu (detik) dari posisi mobil ke ujung rute. */
  function remaining() {
    const n = car.cells.length;
    if (n < 2) return { length: 0, time: 0 };
    const end = totalU();
    let time = 0;
    let u = car.u;
    while (u < end - 1e-6) {
      const i = clamp(Math.round(u / CELL), 0, n - 1);
      const boundary = Math.min(end, (i + 0.5) * CELL);
      time += (boundary - u) / (FREE_SPEED / (city.jam[car.cells[i]] ? JAM_FACTOR : 1));
      u = boundary + 1e-6;
    }
    return { length: end - car.u, time };
  }

  return {
    car,
    setRoute,
    replaceCells,
    update,
    index,
    remaining,
    updatePose,
    uToS,
    speedNow,
  };
}
