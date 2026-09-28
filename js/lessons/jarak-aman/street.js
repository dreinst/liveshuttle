// Lalu lintas latar pelajaran Jarak Aman: kendaraan di jalur arah berlawanan dan pejalan kaki di
// trotoar Jalan Soekarno-Hatta (ilustrasi). Semuanya hiasan, tetapi tetap tunduk pada aturan
// keselamatan: setiap kendaraan melewati perisai keselamatan tiap langkah, dan pejalan kaki di
// trotoar tidak pernah turun ke jalan.
//
// Dunia tidak berujung: kendaraan dan pejalan kaki yang tertinggal jauh di belakang mobilmu
// dipindah ke depan (cincin sepanjang RING meter), jadi jarak antarsesama tetap terjaga.

import { COLORS, SIZES } from '../../engine/theme.js';
import { SAFETY, pedConstraint, shieldSpeed } from './safety.js';
import { G } from './model.js';
import { CITY, ONCOMING_LANES } from './scene.js';

const RING = 480; // m
const BEHIND = 160; // kendaraan lebih dari ini di belakang mobilmu dipindah ke depan
const WALK_RING = 360;
const WALK_BEHIND = 120;

// kendaraan per lajur (urut dari barat ke timur), kecepatan jelajah dalam m/s
const TRAFFIC = {
  kota: [
    { y: ONCOMING_LANES.curb, speed: 8.5, kinds: ['angkot', 'motor', 'city', 'motor2', 'angkot', 'motor', 'mpv'] },
    { y: ONCOMING_LANES.fast, speed: 11, kinds: ['city', 'motor', 'mpv', 'car', 'motor2', 'city'] },
  ],
  tol: [
    { y: ONCOMING_LANES.curb, speed: 22, kinds: ['car', 'bus', 'mpv'] },
    { y: ONCOMING_LANES.fast, speed: 27, kinds: ['car', 'city', 'mpv'] },
  ],
};
const ANGKOT_CODES = ['AL', 'GL', 'ADL'];

// pejalan kaki di trotoar (hanya di jalan kota; jalan tol tidak boleh dilewati pejalan kaki)
const WALK_LINES = [
  { y: -6.3, dir: 1, speed: 1.25, count: 6 },
  { y: -7.0, dir: -1, speed: 1.15, count: 5 },
  { y: CITY.farSidewalkIn + 1.2, dir: -1, speed: 1.2, count: 5 },
  { y: CITY.farSidewalkIn + 2.2, dir: 1, speed: 1.3, count: 4 },
];
const SHIRTS = ['#fb7185', '#60a5fa', '#fbbf24', '#a3e635', '#f472b6', '#38bdf8', '#e2e8f0'];

const hash = (a, b = 0) => {
  const s = Math.sin(a * 91.7 + b * 47.3) * 24634.6345;
  return s - Math.floor(s);
};

function makeVehicle(kind, i, lane, x) {
  const k = kind === 'motor2' ? 'motor' : kind;
  const size = SIZES[k] || SIZES.car;
  const v = {
    id: `lawan-${lane.y}-${i}`,
    kind: k,
    x,
    // sepeda motor berjalan di sisi kiri lajurnya (untuk arah ke barat, kiri = y lebih besar)
    y: lane.y + (k === 'motor' ? 0.9 : 0),
    heading: Math.PI,
    length: size.length,
    width: size.width,
    v: lane.speed,
    cruise: lane.speed,
    laneY: lane.y,
    braking: false,
  };
  if (k === 'angkot') v.code = ANGKOT_CODES[i % ANGKOT_CODES.length];
  if (k === 'motor') {
    v.passenger = kind === 'motor2';
    v.helmet = COLORS.helmets[i % COLORS.helmets.length];
    v.passengerHelmet = COLORS.helmets[(i + 3) % COLORS.helmets.length];
    v.jacket = ['#334155', '#7c2d12', '#1e3a8a', '#365314'][i % 4];
  }
  if (k === 'car' || k === 'city' || k === 'mpv') v.color = COLORS.vehicles[(i * 2 + 1) % COLORS.vehicles.length];
  if (k === 'bus') v.code = '';
  return v;
}

function makeWalker(line, j, x, wet) {
  const h = hash(j * 7 + line.y, line.dir);
  const variant = wet ? 'umbrella' : h < 0.35 ? 'hijab' : h < 0.6 ? 'backpack' : 'default';
  return {
    id: `pejalan-${line.y}-${j}`,
    x,
    y: line.y,
    r: SAFETY.pedRadius,
    heading: line.dir > 0 ? 0 : Math.PI,
    dir: line.dir,
    speed: line.speed,
    variant,
    accent: variant === 'hijab' ? COLORS.hijab[j % COLORS.hijab.length] : variant === 'umbrella' ? ['#1d4ed8', '#be123c', '#0f766e', '#a16207'][j % 4] : '#b45309',
    color: SHIRTS[(j * 3 + (line.dir > 0 ? 1 : 0)) % SHIRTS.length],
    phaseOffset: h * 6,
  };
}

/**
 * Buat lalu lintas latar.
 * update(dt, { refX, place, mu, wet, peds }) menggerakkan semuanya; peds adalah pejalan kaki lain
 * (misalnya calon penumpang angkot) dalam koordinat dunia { x, y, r, points }.
 */
export function createStreet() {
  const street = {
    place: null,
    npcs: [],
    walkers: [],
    shieldActs: 0,
    clamps: 0,
    wet: false,
    init(place, refX, wet) {
      street.place = place;
      street.wet = wet;
      street.npcs = [];
      for (const lane of TRAFFIC[place]) {
        const n = lane.kinds.length;
        lane.kinds.forEach((kind, i) => {
          const x = refX - BEHIND + ((i + 0.5) / n) * RING + (hash(i, lane.y) - 0.5) * 12;
          street.npcs.push(makeVehicle(kind, i, lane, x));
        });
      }
      street.walkers = [];
      if (place === 'kota') {
        for (const line of WALK_LINES) {
          for (let j = 0; j < line.count; j++) {
            const x = refX - WALK_BEHIND + ((j + hash(j, line.y)) / line.count) * WALK_RING;
            street.walkers.push(makeWalker(line, j, x, wet));
          }
        }
      }
    },
    setWet(wet) {
      if (wet === street.wet) return;
      street.wet = wet;
      street.walkers.forEach((p, j) => {
        const fresh = makeWalker({ y: p.y, dir: p.dir, speed: p.speed }, j, p.x, wet);
        p.variant = fresh.variant;
        p.accent = fresh.accent;
      });
    },
    /** Pejalan kaki trotoar dalam bentuk untuk perisai (posisi sekarang dan 3 detik ke depan). */
    walkerConstraints() {
      return street.walkers.map((p) => ({ r: p.r, points: [{ x: p.x, y: p.y }, { x: p.x + p.dir * p.speed * 3, y: p.y }] }));
    },
    update(dt, { refX, mu, peds = [] }) {
      const a = mu * G;
      const allPeds = street.walkerConstraints().concat(peds);
      // kendaraan: ikuti kendaraan di depan (arah ke barat = x lebih kecil), lalu perisai
      const byLane = new Map();
      for (const n of street.npcs) {
        if (!byLane.has(n.laneY)) byLane.set(n.laneY, []);
        byLane.get(n.laneY).push(n);
      }
      for (const list of byLane.values()) {
        list.sort((p, q) => p.x - q.x);
        for (let i = 0; i < list.length; i++) {
          const n = list[i];
          let vCmd = n.cruise;
          const lead = i > 0 ? list[i - 1] : null;
          if (lead) {
            const gap = n.x - n.length / 2 - (lead.x + lead.length / 2);
            if (gap < 80) vCmd = Math.min(vCmd, Math.sqrt(2 * 3 * Math.max(0, gap - 4)));
          }
          vCmd = Math.min(vCmd, n.v + 2.5 * dt);
          const con = pedConstraint({ front: n.x - n.length / 2, length: n.length, y: n.y, halfW: n.width / 2, dir: -1 }, allPeds);
          const sh = shieldSpeed(n.v, vCmd, con, a, dt);
          if (sh.limited) street.shieldActs += 1;
          // rem tidak bisa lebih kuat dari a (perisai sudah memperhitungkannya bila ia membatasi)
          let v = Math.max(sh.v, n.v - a * dt, 0);
          let dx = v * dt;
          if (dx > sh.clampTo) {
            dx = Math.max(0, sh.clampTo);
            v = 0;
            street.clamps += 1;
          }
          n.braking = v < n.v - 0.02;
          n.v = v;
          n.x -= dx;
        }
      }
      for (const n of street.npcs) {
        let moved = false;
        if (n.x < refX - BEHIND) {
          n.x += RING;
          moved = true;
        } else if (n.x > refX - BEHIND + RING) {
          n.x -= RING;
          moved = true;
        }
        if (!moved) continue;
        // kendaraan yang dipindah tidak boleh muncul tepat di atas atau di samping pejalan kaki
        // (di adegan ini pejalan kaki tidak pernah ada di jalur, jadi ini hanya pengaman)
        for (let k = 0; k < 20; k++) {
          const con = pedConstraint({ front: n.x - n.length / 2, length: n.length, y: n.y, halfW: n.width / 2, dir: -1 }, allPeds);
          if (!(con.hard < 2)) break;
          n.x += 10;
        }
      }
      // pejalan kaki trotoar: berjalan lurus di trotoar, tidak pernah turun ke jalan
      for (const p of street.walkers) {
        p.x += p.dir * p.speed * dt;
        if (p.x < refX - WALK_BEHIND) p.x += WALK_RING;
        else if (p.x > refX - WALK_BEHIND + WALK_RING) p.x -= WALK_RING;
      }
    },
    /** Kotak kendaraan untuk pemantau. */
    boxes() {
      return street.npcs.map((n) => ({ id: n.id, x: n.x, y: n.y, heading: n.heading, length: n.length, width: n.width }));
    },
  };
  return street;
}
