// Menggambar Jalan Kawi dan semua pelaku di atas peta OSM yang sudah diputar (lihat scene.js).
// Peta latar (gedung, jalan lain, nama tempat) digambar oleh createMapRenderer di keputusan.js.
// Di sini: badan Jalan Kawi dengan trotoar dan marka, garis henti, penyeberangan, empat lampu
// lalu lintas (titiknya dari OSM), kendaraan, dan pejalan kaki.

import { COLORS, FONT, withAlpha } from '../../engine/theme.js';
import { crosswalk, stopLine } from '../../engine/road.js';
import {
  polygonPath,
  drawCrosswalk,
  drawStopLine,
  drawLine,
  drawCar,
  drawAngkot,
  drawMotor,
  drawPedestrian,
  drawTrafficSignal,
  drawRing,
} from '../../engine/draw.js';
import { ROAD_HALF, WALK, CW_HALF, SIDE_HALF } from './scene.js';

const HAZARD = '#fbbf24';

/** Rentang s di [a, b] setelah dikurangi celah-celah [g0, g1]. */
function subtract(a, b, gaps) {
  const sorted = gaps.filter((g) => g[1] > a && g[0] < b).sort((p, q) => p[0] - q[0]);
  const out = [];
  let cur = a;
  for (const [g0, g1] of sorted) {
    if (g0 > cur) out.push([cur, Math.min(g0, b)]);
    cur = Math.max(cur, g1);
    if (cur >= b) break;
  }
  if (cur < b) out.push([cur, b]);
  return out.filter(([p, q]) => q - p > 0.5);
}

export function createSceneArt(scene) {
  const { frame, S } = scene;
  const sMin = S.viewMin - 40;
  const sMax = S.end;
  const strip = (s0, s1, lat0, lat1, step = 2) => {
    const a = [];
    const b = [];
    for (let s = s0; s < s1; s += step) {
      a.push(frame.toWorld(s, lat0));
      b.push(frame.toWorld(s, lat1));
    }
    a.push(frame.toWorld(s1, lat0));
    b.push(frame.toWorld(s1, lat1));
    return [...a, ...b.reverse()];
  };
  const line = (s0, s1, lat, step = 2) => {
    const pts = [];
    for (let s = s0; s < s1; s += step) pts.push(frame.toWorld(s, lat));
    pts.push(frame.toWorld(s1, lat));
    return pts;
  };

  // badan jalan dan trotoar
  const asphalt = strip(sMin, sMax, -ROAD_HALF, ROAD_HALF);
  const mouth = (side) => scene.junctions.filter((j) => j.side === side).map((j) => [j.s - j.half, j.s + j.half]);
  const walks = [];
  const curbs = [];
  for (const side of [-1, 1]) {
    for (const [a, b] of subtract(sMin, sMax, mouth(side))) {
      walks.push(strip(a, b, side * ROAD_HALF, side * (ROAD_HALF + WALK)));
      curbs.push(line(a, b, side * (ROAD_HALF + 0.05)));
    }
  }
  // garis tepi (putus di mulut simpang, di simpang, dan di penyeberangan)
  const cwGaps = [S.cwWest, S.cwEast, S.zebra].map((s) => [s - CW_HALF - 0.3, s + CW_HALF + 0.3]);
  const edges = [];
  for (const side of [-1, 1]) {
    for (const [a, b] of subtract(sMin, sMax - 2, [...mouth(side), ...cwGaps, [S.stopEB, S.stopWB]])) edges.push(line(a, b, side * (ROAD_HALF - 0.25)));
  }
  // garis tengah: utuh, putus-putus di zona boleh menyalip, tidak ada di dalam simpang dan penyeberangan
  const centerSolid = [];
  const centerDash = [];
  for (const [a, b] of subtract(sMin, sMax - 1, [...cwGaps, [S.stopEB, S.stopWB], [S.passA, S.passB]])) centerSolid.push(line(a, b, 0));
  centerDash.push(line(S.passA, S.passB, 0));
  // garis henti dan garis beri jalan
  const sl = (s, lat0, lat1, heading, width = 0.4) => {
    const p = frame.toWorld(s, (lat0 + lat1) / 2);
    return stopLine({ x: p.x, y: p.y, heading: p.heading + heading, length: Math.abs(lat1 - lat0), width });
  };
  const stopLines = [sl(S.stopEB + 0.2, -ROAD_HALF, 0, 0), sl(S.stopWB - 0.2, 0, ROAD_HALF, Math.PI)];
  const yieldLines = [sl(S.zebra - CW_HALF - 1.5, -ROAD_HALF, 0, 0, 0.2), sl(S.zebra + CW_HALF + 1.5, 0, ROAD_HALF, Math.PI, 0.2)];
  // penyeberangan (tiga titik crossing asli di Jalan Kawi)
  const zebras = [S.cwWest, S.cwEast, S.zebra].map((s) => {
    const p = frame.toWorld(s, 0);
    return crosswalk({ x: p.x, y: p.y, heading: p.heading + Math.PI / 2, length: 2 * ROAD_HALF, width: 2 * CW_HALF });
  });
  // Jalan Kelud dan Jalan Arjuno: garis henti di titik lampu asli, penyeberangan di Jalan Arjuno
  const sideStops = [];
  const sideZebras = [];
  const poles = [];
  for (const k of ['utara', 'selatan']) {
    const sd = scene.side[k];
    const p = sd.path.sample(sd.stopS + 0.2);
    sideStops.push(stopLine({ x: p.x, y: p.y, heading: p.heading, length: SIDE_HALF, width: 0.35 }));
    if (sd.crossingOsm) {
      const c = sd.path.sample(sd.stopS + 1 + CW_HALF);
      const cx = c.x + Math.sin(c.heading) * (-SIDE_HALF / 2);
      const cy = c.y - Math.cos(c.heading) * (-SIDE_HALF / 2);
      sideZebras.push(crosswalk({ x: cx, y: cy, heading: c.heading + Math.PI / 2, length: 2 * SIDE_HALF, width: 2 * CW_HALF }));
    }
    const q = sd.path.sample(sd.stopS - 1.2);
    const off = SIDE_HALF / 2 + 0.7; // dari tengah lajur ke luar kerb kiri
    poles.push({ key: k, x: q.x + Math.sin(q.heading) * off, y: q.y - Math.cos(q.heading) * off, heading: q.heading + Math.PI, side: true });
  }
  {
    const p = frame.toWorld(S.stopEB - 1.2, -(ROAD_HALF + 0.7));
    poles.push({ key: 'timur', x: p.x, y: p.y, heading: p.heading + Math.PI, side: false });
    const q = frame.toWorld(S.stopWB + 1.2, ROAD_HALF + 0.7);
    poles.push({ key: 'barat', x: q.x, y: q.y, heading: q.heading, side: false });
  }

  function drawRoad(g) {
    g.fillStyle = COLORS.sidewalk;
    for (const w of walks) {
      polygonPath(g, w);
      g.fill();
    }
    g.fillStyle = COLORS.asphalt;
    polygonPath(g, asphalt);
    g.fill();
    for (const c of curbs) drawLine(g, c, { color: COLORS.curb, width: 0.2, cap: 'butt' });
    const edge = { color: 'rgba(229, 231, 235, 0.5)', width: 0.12, cap: 'butt' };
    for (const e of edges) drawLine(g, e, edge);
    const yellow = { color: COLORS.centerLine, width: 0.15, cap: 'butt' };
    for (const c of centerSolid) drawLine(g, c, yellow);
    for (const c of centerDash) drawLine(g, c, { ...yellow, dash: [3, 3] });
    for (const z of zebras) drawCrosswalk(g, z);
    for (const z of sideZebras) drawCrosswalk(g, z, { alpha: 0.7 });
    for (const s of stopLines) drawStopLine(g, s);
    for (const s of sideStops) drawStopLine(g, s, { color: '#cbd5e1' });
    for (const s of yieldLines) drawStopLine(g, s, { color: '#cbd5e1' });
  }

  /** Nama jalan bergaya label peta (teks dengan halo), dalam piksel layar. */
  function streetName(g, view, x, y, angle, text) {
    const p = view.worldToScreen(x, y);
    g.save();
    view.screen();
    g.translate(p.x, p.y);
    let a = angle;
    if (a > Math.PI / 2) a -= Math.PI;
    if (a < -Math.PI / 2) a += Math.PI;
    g.rotate(a);
    g.font = `650 12px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(11, 18, 32, 0.92)';
    g.lineWidth = 3.5;
    g.strokeText(text, 0, 0.5);
    g.fillStyle = '#e2e8f0';
    g.fillText(text, 0, 0.5);
    g.restore();
    view.world();
  }

  function hazardLights(g, box, on) {
    const hl = box.length / 2 - 0.12;
    const hw = box.width / 2 - 0.12;
    const c = Math.cos(box.heading);
    const s = Math.sin(box.heading);
    for (const [sx, sy] of [
      [hl, -hw],
      [hl, hw],
      [-hl, -hw],
      [-hl, hw],
    ]) {
      const x = box.x + sx * c - sy * s;
      const y = box.y + sx * s + sy * c;
      if (on) {
        g.fillStyle = withAlpha(HAZARD, 0.32);
        g.beginPath();
        g.arc(x, y, 0.5, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = on ? HAZARD : '#7c5a12';
      g.beginPath();
      g.arc(x, y, 0.18, 0, Math.PI * 2);
      g.fill();
    }
  }

  function drawVehicleAt(g, view, v, pose, { alpha = 1 } = {}) {
    const obj = { ...pose, length: v.length, width: v.width, color: v.color, braking: v.braking };
    if (v.kind === 'motor') {
      drawMotor(g, obj, { view, minPx: 22, passenger: v.passenger, helmet: v.helmet, jacket: v.jacket, passengerHelmet: v.passengerHelmet, color: v.color, alpha });
    } else if (v.kind === 'angkot') {
      drawAngkot(g, obj, { view, doorOpen: !!v.doorOpen, alpha });
    } else {
      drawCar(g, obj, { variant: v.kind === 'city' ? 'city' : v.kind === 'mpv' ? 'mpv' : 'sedan', alpha });
    }
  }

  /** Gambar semua pelaku kecuali mobil otonom. vis: persegi dunia yang terlihat. */
  function drawActors(g, view, world, { vis, time, reducedMotion }) {
    const inView = (x, y, pad = 8) => x > vis.minX - pad && x < vis.maxX + pad && y > vis.minY - pad && y < vis.maxY + pad;
    const blinkOn = reducedMotion || Math.floor(time * 1.6) % 2 === 0;
    // Jalan Kelud dan Jalan Arjuno
    for (const a of [...world.cross.utara, ...world.cross.selatan]) {
      if (!inView(a.x, a.y)) continue;
      drawVehicleAt(g, view, a, { x: a.x, y: a.y, heading: a.heading });
    }
    // dari arah berlawanan
    for (const c of world.oncoming) {
      if (c.x > S.end + 2) continue; // masih di simpang ujung, di luar ruas yang digambar
      const p = frame.toWorld(c.x, c.y);
      if (!inView(p.x, p.y)) continue;
      const pose = { x: p.x, y: p.y, heading: p.heading + Math.PI };
      drawVehicleAt(g, view, c, pose);
      if (c.hazard) hazardLights(g, { ...pose, length: c.length, width: c.width }, blinkOn);
    }
    // angkot ngetem
    const ak = world.angkot;
    if (ak.active) {
      const p = frame.toWorld(ak.x, ak.y);
      if (inView(p.x, p.y)) {
        const alpha = Math.min(1, (world.time - ak.since) / 0.6 + (reducedMotion ? 1 : 0));
        const pose = { x: p.x, y: p.y, heading: p.heading };
        drawAngkot(g, { ...pose, length: ak.length, width: ak.width }, { view, doorOpen: true, alpha: Math.max(0.15, alpha) });
        hazardLights(g, { ...pose, length: ak.length, width: ak.width }, blinkOn);
      }
    }
    // pejalan kaki
    for (const q of world.peds) {
      const p = frame.toWorld(q.x, q.y);
      if (!inView(p.x, p.y, 4)) continue;
      if (q.test && q.state === 'menunggu') {
        const pulse = reducedMotion ? 0 : (Math.sin(time * 2.2) + 1) * 1.5;
        drawRing(g, p.x, p.y, view.px(12 + pulse), { color: COLORS.target, width: 1.5, view, alpha: 0.8 });
      }
      drawPedestrian(g, { x: p.x, y: p.y, heading: p.heading + q.heading, radius: q.radius }, { view, phase: q.phase, minPx: q.test ? 15 : 13, alpha: q.alpha, variant: q.variant, accent: q.accent, color: q.color });
    }
  }

  function drawSignals(g, view, world) {
    const main = world.signal.main;
    const side = world.signal.side;
    for (const p of poles) {
      drawTrafficSignal(g, { x: p.x, y: p.y, heading: p.heading, state: p.side ? side : main }, { view, minPx: p.key === 'timur' ? 24 : 18, alpha: p.key === 'timur' ? 1 : 0.9 });
    }
  }

  return { drawRoad, drawActors, drawSignals, streetName };
}

/** Panah utara kecil (peta diputar supaya Jalan Kawi mendatar). x, y dalam piksel layar. */
export function drawNorthArrow(g, view, x, y, angle) {
  g.save();
  view.screen();
  g.translate(x, y);
  g.fillStyle = 'rgba(11, 18, 32, 0.78)';
  g.beginPath();
  g.arc(0, 0, 15, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(148, 163, 184, 0.5)';
  g.lineWidth = 1;
  g.stroke();
  g.rotate(angle + Math.PI / 2);
  g.fillStyle = '#e2e8f0';
  g.beginPath();
  g.moveTo(0, -11);
  g.lineTo(4.5, 1);
  g.lineTo(0, -1.5);
  g.lineTo(-4.5, 1);
  g.closePath();
  g.fill();
  g.fillStyle = '#64748b';
  g.beginPath();
  g.moveTo(0, 10);
  g.lineTo(4.5, 1);
  g.lineTo(0, 3.5);
  g.lineTo(-4.5, 1);
  g.closePath();
  g.fill();
  g.restore();
  // huruf U tegak di ujung panah
  g.save();
  view.screen();
  g.font = `800 9.5px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#f8fafc';
  g.fillText('U', x + Math.cos(angle) * 22, y + Math.sin(angle) * 22);
  g.restore();
  view.world();
}
