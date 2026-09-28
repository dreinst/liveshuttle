// Dunia simulasi pelajaran Lokalisasi: kota kecil dengan jalan melingkar, zona gedung tinggi,
// dan landmark (tiang lampu dan rambu) yang posisinya tercatat di peta HD.
//
// Koordinat dalam meter, y ke bawah, lalu lintas kiri.
//   Garis tengah jalan berbentuk persegi panjang bersudut bulat: x -90 sampai 90, y -55 sampai 55,
//   jari-jari tikungan 28 m. Jalan dua lajur (satu per arah) dengan trotoar 2,5 m di kedua sisi.
//   Mobil otonom berjalan searah jarum jam di layar (ke timur di sisi atas). Karena lalu lintas
//   kiri, lajurnya adalah lajur luar, 1,75 m di kiri garis tengah.
//   Zona gedung tinggi ada di sisi atas, x -45 sampai 45.
//
// File ini hanya berisi model dunia (membangun, mengemudikan mobil, menggambar). Model sensor
// dan estimasi posisi ada di ./estimators.js, logika pelajaran di ../lokalisasi.js.

import { Vehicle } from '../../engine/vehicle.js';
import { Path, arcPoints, joinPolylines, offsetPolyline } from '../../engine/geometry.js';
import { purePursuit } from '../../engine/control.js';
import { Rng } from '../../engine/math.js';
import { COLORS, withAlpha } from '../../engine/theme.js';
import { rectBox, drawBuilding, drawTree, drawSpeedSign, drawCar } from '../../engine/draw.js';

export const LOOP = Object.freeze({ halfW: 90, halfH: 55, radius: 28 });
export const ROAD_HALF = 3.5; // setengah lebar aspal (dua lajur 3,5 m)
export const SIDEWALK = 2.5;
export const LANE_OFFSET = 1.75; // lajur mobil otonom: 1,75 m di kiri garis tengah
export const LANE_WIDTH = 3.5;
export const CRUISE = 9; // m/s, sekitar 32 km/jam
export const CANYON = Object.freeze({ x0: -45, x1: 45, y0: -72, y1: -40 });
/** Batas area kota untuk peta mini. */
export const CITY = Object.freeze({ minX: -112, minY: -78, maxX: 112, maxY: 78 });

const TALL = { color: '#141d2f', roof: '#2a3a56', shadow: 7 };

/** Garis tengah jalan melingkar (titik pertama diulang di akhir). Mulai di tengah sisi atas. */
function centerline() {
  const { halfW: X, halfH: Y, radius: R } = LOOP;
  const n = 14;
  return joinPolylines(
    [{ x: 0, y: -Y }, { x: X - R, y: -Y }],
    arcPoints(X - R, -Y + R, R, -Math.PI / 2, 0, n),
    [{ x: X, y: Y - R }],
    arcPoints(X - R, Y - R, R, 0, Math.PI / 2, n),
    [{ x: -X + R, y: Y }],
    arcPoints(-X + R, Y - R, R, Math.PI / 2, Math.PI, n),
    [{ x: -X, y: -Y + R }],
    arcPoints(-X + R, -Y + R, R, Math.PI, Math.PI * 1.5, n),
    [{ x: 0, y: -Y }],
  );
}

/** Deretan gedung sepanjang satu sisi jalan. axis 'x' = deretan mendatar, near = tepi yang menghadap jalan. */
function buildingRow(rng, out, { axis, from, to, near, dir, width, gap, depth, tall = false }) {
  let p = from + rng.range(0, gap[1]);
  while (p < to - 6) {
    const w = Math.min(rng.range(width[0], width[1]), to - p);
    const d = rng.range(depth[0], depth[1]);
    const a = near;
    const b = near + dir * d;
    const box = axis === 'x' ? rectBox(p, Math.min(a, b), p + w, Math.max(a, b)) : rectBox(Math.min(a, b), p, Math.max(a, b), p + w);
    out.push({ ...box, tall, id: `gedung-${out.length}`, kind: 'building' });
    p += w + rng.range(gap[0], gap[1]);
  }
}

export function createScene() {
  const rng = new Rng(2024);
  const { halfW: X, halfH: Y, radius: R } = LOOP;

  // ---------- jalan ----------
  const center = centerline();
  const centerPath = new Path(center.slice(0, -1), { closed: true });
  const lanePts = offsetPolyline(center, LANE_OFFSET);
  const lanePath = new Path(lanePts.slice(0, -1), { closed: true });
  const edges = {
    curbOut: offsetPolyline(center, ROAD_HALF),
    curbIn: offsetPolyline(center, -ROAD_HALF),
    lineOut: offsetPolyline(center, ROAD_HALF - 0.25),
    lineIn: offsetPolyline(center, -ROAD_HALF + 0.25),
  };

  // ---------- gedung ----------
  const buildings = [];
  const out = ROAD_HALF + SIDEWALK + 1.5; // jarak garis tengah ke muka gedung
  const normal = { width: [11, 20], gap: [3, 7], depth: [12, 20] };
  const tall = { width: [19, 27], gap: [1.2, 2], depth: [26, 34], tall: true };
  // sisi atas (luar dan dalam): zona gedung tinggi di tengah
  buildingRow(rng, buildings, { axis: 'x', from: -62, to: CANYON.x0 - 1, near: -Y - out, dir: -1, ...normal });
  buildingRow(rng, buildings, { axis: 'x', from: CANYON.x0, to: CANYON.x1, near: -Y - out, dir: -1, ...tall });
  buildingRow(rng, buildings, { axis: 'x', from: CANYON.x1 + 2, to: 64, near: -Y - out, dir: -1, ...normal });
  buildingRow(rng, buildings, { axis: 'x', from: CANYON.x0, to: CANYON.x1, near: -Y + out, dir: 1, ...tall, depth: [22, 26] });
  // sisi kanan dan kiri
  buildingRow(rng, buildings, { axis: 'y', from: -26, to: 27, near: X + out, dir: 1, ...normal });
  buildingRow(rng, buildings, { axis: 'y', from: -20, to: 21, near: X - out, dir: -1, ...normal, depth: [10, 14] });
  buildingRow(rng, buildings, { axis: 'y', from: -26, to: 27, near: -X - out, dir: -1, ...normal });
  buildingRow(rng, buildings, { axis: 'y', from: -20, to: 21, near: -X + out, dir: 1, ...normal, depth: [10, 14] });
  // sisi bawah
  buildingRow(rng, buildings, { axis: 'x', from: -62, to: 64, near: Y + out, dir: 1, ...normal });
  buildingRow(rng, buildings, { axis: 'x', from: -52, to: 54, near: Y - out, dir: -1, ...normal, depth: [11, 16] });
  for (const b of buildings) b._br = Math.hypot(b.length, b.width) / 2;

  // ---------- pohon ----------
  const trees = [];
  // taman di tengah lingkaran jalan
  for (let x = -54; x <= 54; x += 9) {
    for (let y = -12; y <= 24; y += 9) {
      if (rng.chance(0.25)) continue;
      trees.push({ x: x + rng.range(-2.5, 2.5), y: y + rng.range(-2.5, 2.5), r: rng.range(1.6, 2.6) });
    }
  }
  // pojok luar dan dalam di tiap tikungan
  const corners = [
    { cx: X - R, cy: -Y + R, a0: -Math.PI / 2 },
    { cx: X - R, cy: Y - R, a0: 0 },
    { cx: -X + R, cy: Y - R, a0: Math.PI / 2 },
    { cx: -X + R, cy: -Y + R, a0: Math.PI },
  ];
  for (const c of corners) {
    for (let i = 0; i < 6; i++) {
      const a = c.a0 + ((i + 0.5) / 6) * (Math.PI / 2);
      const r = R + 11 + rng.range(0, 7);
      trees.push({ x: c.cx + Math.cos(a) * r, y: c.cy + Math.sin(a) * r, r: rng.range(1.8, 2.8) });
    }
    for (let i = 0; i < 3; i++) {
      const a = c.a0 + ((i + 0.5) / 3) * (Math.PI / 2);
      const r = R - 13 - rng.range(0, 4);
      trees.push({ x: c.cx + Math.cos(a) * r, y: c.cy + Math.sin(a) * r, r: rng.range(1.6, 2.3) });
    }
  }

  // ---------- landmark (isi peta HD) ----------
  // tiang lampu dan rambu di trotoar, bergantian di sisi luar dan dalam, tiap 17 m
  const landmarks = [];
  const lmOffset = ROAD_HALF + 1.2;
  let k = 0;
  for (let s = 6; s < centerPath.length - 8; s += 17, k++) {
    const p = centerPath.sample(s);
    const side = k % 2 === 0 ? 1 : -1; // 1 = kiri arah gerak = sisi luar
    const lx = Math.sin(p.heading) * lmOffset * side;
    const ly = -Math.cos(p.heading) * lmOffset * side;
    const kind = k % 3 === 2 ? 'rambu' : 'tiang';
    landmarks.push({ id: `lm-${k}`, kind, x: p.x + lx, y: p.y + ly, radius: kind === 'rambu' ? 0.3 : 0.2 });
  }

  // ---------- mobil otonom ----------
  const ego = new Vehicle({ id: 'ego', label: 'Mobil otonom', ego: true, maxSpeed: 14, maxAccel: 2, maxBrake: 6 });
  const laneLen = lanePath.length;
  const sOf = (x, y) => lanePath.closest(x, y).s;
  const canyonStartS = sOf(CANYON.x0, -Y - LANE_OFFSET);
  const START_S = sOf(34, Y + LANE_OFFSET); // sisi bawah, menuju barat

  /** Jarak sepanjang lajur dari s0 maju ke s1 (0 sampai panjang lajur). */
  const ahead = (s0, s1) => (((s1 - s0) % laneLen) + laneLen) % laneLen;

  function placeAt(s) {
    const p = lanePath.sample(s);
    ego.setPose(p.x, p.y, p.heading);
    ego.speed = CRUISE;
  }

  /**
   * Satu langkah mobil. Setir memakai pure pursuit ke garis tengah lajur, dihitung dari `pose`.
   * pose null berarti simulator memakai posisi sebenarnya. cruise = kecepatan target (m/s).
   */
  function drive(dt, pose = null, cruise = CRUISE) {
    const p = pose || ego;
    const h = p.heading;
    const d = ego.wheelbase / 2;
    const proxy = {
      heading: h,
      wheelbase: ego.wheelbase,
      maxSteer: ego.maxSteer,
      speed: ego.speed,
      rearAxle: () => ({ x: p.x - Math.cos(h) * d, y: p.y - Math.sin(h) * d }),
    };
    const pp = purePursuit(proxy, lanePath, { lookahead: 6, gain: 0.55 });
    ego.step(dt, { accel: ego.accelToward(cruise), steer: pp.steer });
  }

  /** Simpangan titik tengah mobil dari garis tengah lajur (positif = ke kiri). */
  function laneOffset() {
    return lanePath.closest(ego.x, ego.y).lateral;
  }

  const inCanyon = (x, y) => x >= CANYON.x0 && x <= CANYON.x1 && y >= CANYON.y0 && y <= CANYON.y1;

  /** Parameter galat GPS di zona gedung tinggi, atau null di tempat terbuka. */
  function canyonAt(x, y) {
    if (!inCanyon(x, y)) return null;
    // jalan di zona ini membentang barat-timur, jadi arah melintang jalan adalah sumbu y
    return { normal: Math.PI / 2, biasX: 1.4 * Math.sin(x / 17), biasY: 2.8 };
  }

  // ---------- menggambar ----------
  let paths = null;
  function ringPath(pts) {
    const p = new Path2D();
    pts.forEach((q, i) => (i ? p.lineTo(q.x, q.y) : p.moveTo(q.x, q.y)));
    p.closePath();
    return p;
  }
  function buildPaths() {
    paths = {
      center: ringPath(center),
      curbOut: ringPath(edges.curbOut),
      curbIn: ringPath(edges.curbIn),
      lineOut: ringPath(edges.lineOut),
      lineIn: ringPath(edges.lineIn),
    };
  }

  const visible = (b, vb, m = 8) => b.x + b.length / 2 > vb.minX - m && b.x - b.length / 2 < vb.maxX + m && b.y + b.width / 2 > vb.minY - m && b.y - b.width / 2 < vb.maxY + m;
  const near = (p, vb, m = 4) => p.x > vb.minX - m && p.x < vb.maxX + m && p.y > vb.minY - m && p.y < vb.maxY + m;

  function drawGround(g, view) {
    const vb = view.visibleBounds();
    g.fillStyle = COLORS.ground;
    g.fillRect(vb.minX, vb.minY, vb.maxX - vb.minX, vb.maxY - vb.minY);
    // taman di dalam lingkaran, sedikit lebih terang
    g.fillStyle = COLORS.groundAlt;
    g.beginPath();
    g.roundRect ? g.roundRect(-X + out, -Y + out, 2 * (X - out), 2 * (Y - out), R - out) : g.rect(-X + out, -Y + out, 2 * (X - out), 2 * (Y - out));
    g.fill();
  }

  function drawRoads(g) {
    if (!paths) buildPaths();
    g.save();
    g.lineJoin = 'round';
    g.strokeStyle = COLORS.sidewalk;
    g.lineWidth = 2 * (ROAD_HALF + SIDEWALK);
    g.stroke(paths.center);
    g.strokeStyle = COLORS.asphalt;
    g.lineWidth = 2 * ROAD_HALF;
    g.stroke(paths.center);
    g.strokeStyle = COLORS.curb;
    g.lineWidth = 0.22;
    g.stroke(paths.curbOut);
    g.stroke(paths.curbIn);
    g.strokeStyle = withAlpha(COLORS.laneMark, 0.5);
    g.lineWidth = 0.12;
    g.stroke(paths.lineOut);
    g.stroke(paths.lineIn);
    g.strokeStyle = COLORS.centerLine;
    g.lineWidth = 0.15;
    g.setLineDash([3, 3]);
    g.stroke(paths.center);
    g.setLineDash([]);
    g.restore();
  }

  function drawCanyonZone(g, view) {
    const y0 = -Y - ROAD_HALF - SIDEWALK;
    const y1 = -Y + ROAD_HALF + SIDEWALK;
    g.save();
    g.fillStyle = withAlpha(COLORS.warn, 0.06);
    g.fillRect(CANYON.x0, y0, CANYON.x1 - CANYON.x0, y1 - y0);
    g.strokeStyle = withAlpha(COLORS.warn, 0.75);
    g.lineWidth = view.px(2);
    g.setLineDash([view.px(7), view.px(5)]);
    for (const x of [CANYON.x0, CANYON.x1]) {
      g.beginPath();
      g.moveTo(x, y0);
      g.lineTo(x, y1);
      g.stroke();
    }
    g.restore();
  }

  function drawLandmark(g, lm, view) {
    if (lm.kind === 'rambu') {
      drawSpeedSign(g, { x: lm.x, y: lm.y, text: '30', radius: 0.35 }, { view, minPx: 13 });
      return;
    }
    const r = Math.max(lm.radius, view.px(4.2));
    g.fillStyle = 'rgba(0, 0, 0, 0.35)';
    g.beginPath();
    g.arc(lm.x + r * 0.35, lm.y + r * 0.5, r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#cbd5e1';
    g.beginPath();
    g.arc(lm.x, lm.y, r, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#475569';
    g.lineWidth = view.px(1.2);
    g.stroke();
  }

  /** Gambar dunia (tanpa mobil). */
  function draw(g, view) {
    const vb = view.visibleBounds();
    drawGround(g, view);
    drawRoads(g);
    drawCanyonZone(g, view);
    for (const t of trees) if (near(t, vb, t.r + 2)) drawTree(g, t.x, t.y, t.r);
    for (const lm of landmarks) if (near(lm, vb)) drawLandmark(g, lm, view);
    for (const b of buildings) {
      if (!visible(b, vb, b.tall ? 12 : 4)) continue;
      if (b.tall) drawBuilding(g, b, TALL);
      else drawBuilding(g, b);
    }
  }

  /** Mobil di posisi sebenarnya, digambar samar dengan garis putus-putus (hantu). */
  function drawGhost(g, view) {
    drawCar(g, ego, { alpha: 0.42, shadow: false });
    g.save();
    g.translate(ego.x, ego.y);
    g.rotate(ego.heading);
    g.strokeStyle = 'rgba(248, 250, 252, 0.95)';
    g.lineWidth = view.px(2);
    g.setLineDash([view.px(5), view.px(4)]);
    const L = ego.length + 0.3;
    const W = ego.width + 0.3;
    g.beginPath();
    g.roundRect ? g.roundRect(-L / 2, -W / 2, L, W, 0.5) : g.rect(-L / 2, -W / 2, L, W);
    g.stroke();
    g.restore();
  }

  placeAt(START_S);

  return {
    ego,
    center,
    centerPath,
    lanePath,
    laneLen,
    buildings,
    landmarks,
    trees,
    canyonStartS,
    START_S,
    ahead,
    sOf,
    placeAt,
    drive,
    laneOffset,
    inCanyon,
    canyonAt,
    draw,
    drawGhost,
  };
}
