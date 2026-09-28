// Kanvas animasi tenang untuk beranda: kota mini dengan lampu lalu lintas dan satu mobil
// otonom yang memindai sekitarnya dengan LiDAR. Menghormati prefers-reduced-motion.

import { View } from '../engine/canvas.js';
import { Loop } from '../engine/loop.js';
import { Rng } from '../engine/math.js';
import { Path, bezierPoints } from '../engine/geometry.js';
import { makeRoad, intersection } from '../engine/road.js';
import { PathAgent } from '../engine/vehicle.js';
import { TrafficLight, SignalPlan, laneTargetSpeed } from '../engine/traffic.js';
import { Sensor, SensorRig } from '../engine/sensors.js';
import { COLORS, withAlpha } from '../engine/theme.js';
import {
  drawSidewalk,
  drawRoadSurface,
  drawRoadMarkings,
  drawIntersection,
  drawCar,
  drawBuilding,
  drawTree,
  drawSensorCone,
  drawPointCloud,
  drawRing,
  rectBox,
  drawCrosswalk,
} from '../engine/draw.js';
import { crosswalk } from '../engine/road.js';

const XS = [-45, 0, 45];
const YS = [-20, 20];
const HALF = 3.5; // setengah lebar jalan
const SIDEWALK = 2.5;
const EXTENT_X = 115;
const EXTENT_Y = 85;

export function mountAmbient(container, { reducedMotion = false } = {}) {
  const rng = new Rng(11);
  const view = new View(container, {
    label: 'Animasi kota mini tampak atas. Mobil otonom berwarna hijau toska memindai sekitarnya dengan LiDAR.',
    bounds: (v) => (v.aspect < 1.25 ? { minX: -50, minY: -42, maxX: 50, maxY: 42 } : { minX: -57, minY: -36, maxX: 57, maxY: 36 }),
    padding: 0,
  });

  // ---------- jalan ----------
  const roads = [];
  for (const y of YS) roads.push(makeRoad({ id: `h${y}`, points: [{ x: -EXTENT_X, y }, { x: EXTENT_X, y }], sidewalk: SIDEWALK }));
  for (const x of XS) roads.push(makeRoad({ id: `v${x}`, points: [{ x, y: -EXTENT_Y }, { x, y: EXTENT_Y }], sidewalk: SIDEWALK }));
  const boxes = [];
  const crossings = [];
  const plans = [];
  const lights = new Map(); // `${x},${y}` -> { ew, ns }
  XS.forEach((x, i) => {
    YS.forEach((y, j) => {
      boxes.push(intersection({ x, y, width: HALF * 2 + 0.2, height: HALF * 2 + 0.2 }));
      crossings.push(crosswalk({ x: x - HALF - 2, y, heading: Math.PI / 2, length: HALF * 2, width: 2.6 }));
      crossings.push(crosswalk({ x: x + HALF + 2, y, heading: Math.PI / 2, length: HALF * 2, width: 2.6 }));
      const ew = new TrafficLight({ id: `ew${x},${y}` });
      const ns = new TrafficLight({ id: `ns${x},${y}` });
      lights.set(`${x},${y}`, { ew, ns });
      plans.push(new SignalPlan([{ lights: [ew], green: 9 }, { lights: [ns], green: 7 }], { yellow: 2.5, allRed: 1.5, offset: (i * 7 + j * 11) % 23 }));
    });
  });

  // ---------- lajur dengan garis henti ----------
  const lanes = [];
  for (const y of YS) {
    // timur (lajur kiri = sisi utara), barat (sisi selatan)
    lanes.push({ id: `e${y}`, dir: 'e', points: [{ x: -EXTENT_X, y: y - 1.75 }, { x: EXTENT_X, y: y - 1.75 }], stopsAt: XS.map((x) => ({ at: x - HALF - 4, key: `${x},${y}`, axis: 'ew' })) });
    lanes.push({ id: `w${y}`, dir: 'w', points: [{ x: EXTENT_X, y: y + 1.75 }, { x: -EXTENT_X, y: y + 1.75 }], stopsAt: XS.map((x) => ({ at: x + HALF + 4, key: `${x},${y}`, axis: 'ew' })) });
  }
  for (const x of XS) {
    // selatan (lajur kiri = sisi timur), utara (sisi barat)
    lanes.push({ id: `s${x}`, dir: 's', points: [{ x: x + 1.75, y: -EXTENT_Y }, { x: x + 1.75, y: EXTENT_Y }], stopsAt: YS.map((y) => ({ at: y - HALF - 4, key: `${x},${y}`, axis: 'ns' })) });
    lanes.push({ id: `n${x}`, dir: 'n', points: [{ x: x - 1.75, y: EXTENT_Y }, { x: x - 1.75, y: -EXTENT_Y }], stopsAt: YS.map((y) => ({ at: y + HALF + 4, key: `${x},${y}`, axis: 'ns' })) });
  }
  // Mobil otonom berkeliling dua blok (selalu belok kiri, lalu lintas kiri).
  // Lajur yang dipakainya dikosongkan dari mobil lain supaya tidak bertabrakan.
  const EGO_LANES = new Set(['e20', 'n45', 'w-20', 's-45']);
  const corners = [
    { x: -43.25, y: 18.25 },
    { x: 43.25, y: 18.25 },
    { x: 43.25, y: -18.25 },
    { x: -43.25, y: -18.25 },
  ];
  const loopPts = [];
  const R = 4;
  corners.forEach((p, i) => {
    const prev = corners[(i + corners.length - 1) % corners.length];
    const next = corners[(i + 1) % corners.length];
    const u = { x: Math.sign(p.x - prev.x), y: Math.sign(p.y - prev.y) };
    const v = { x: Math.sign(next.x - p.x), y: Math.sign(next.y - p.y) };
    loopPts.push(...bezierPoints({ x: p.x - u.x * R, y: p.y - u.y * R }, p, { x: p.x + v.x * R, y: p.y + v.y * R }, null, 8));
  });
  const egoPath = new Path(loopPts, { closed: true });
  const ego = new PathAgent({ kind: 'car', path: egoPath, s: 20, cruise: 7, speed: 4, loop: true, color: COLORS.ego });
  ego.ego = true;
  const egoStopDefs = [
    { x: -7.5, y: 18.25, key: '0,20', axis: 'ew' },
    { x: 37.5, y: 18.25, key: '45,20', axis: 'ew' },
    { x: 43.25, y: -12.5, key: '45,-20', axis: 'ns' },
    { x: 7.5, y: -18.25, key: '0,-20', axis: 'ew' },
    { x: -37.5, y: -18.25, key: '-45,-20', axis: 'ew' },
    { x: -43.25, y: 12.5, key: '-45,20', axis: 'ns' },
  ];
  const egoStops = egoStopDefs.map((d) => ({ s: egoPath.closest(d.x, d.y).s, light: lights.get(d.key)[d.axis] }));

  const agents = [ego];
  lanes.forEach((lane) => {
    const start = lane.points[0];
    lane.stops = lane.stopsAt.map((s) => {
      const dist = lane.dir === 'e' || lane.dir === 'w' ? Math.abs(s.at - start.x) : Math.abs(s.at - start.y);
      return { s: dist, light: lights.get(s.key)[s.axis] };
    });
    lane.agents = [];
    lane.path = new Path(lane.points);
    if (EGO_LANES.has(lane.id)) return;
    const L = lane.dir === 'e' || lane.dir === 'w' ? 2 * EXTENT_X : 2 * EXTENT_Y;
    const count = lane.dir === 'e' || lane.dir === 'w' ? 4 : 3;
    for (let k = 0; k < count; k++) {
      const a = new PathAgent({
        kind: 'car',
        path: lane.points,
        s: (L / count) * k + rng.range(0, L / count - 12),
        cruise: rng.range(6, 8.5),
        speed: 5,
        loop: true,
        color: rng.pick(COLORS.vehicles),
      });
      lane.agents.push(a);
      agents.push(a);
    }
  });

  // ---------- gedung dan pohon ----------
  const buildings = [];
  const trees = [];
  const xEdges = [-EXTENT_X, ...XS, EXTENT_X];
  const yEdges = [-EXTENT_Y, ...YS, EXTENT_Y];
  const m = HALF + SIDEWALK + 1.2;
  for (let i = 0; i < xEdges.length - 1; i++) {
    for (let j = 0; j < yEdges.length - 1; j++) {
      const x0 = xEdges[i] + (i === 0 ? 0 : m);
      const x1 = xEdges[i + 1] - (i === xEdges.length - 2 ? 0 : m);
      const y0 = yEdges[j] + (j === 0 ? 0 : m);
      const y1 = yEdges[j + 1] - (j === yEdges.length - 2 ? 0 : m);
      // dua sampai tiga gedung per blok, sisa ruang untuk pohon
      let cx = x0;
      while (cx < x1 - 8) {
        const w = Math.min(x1 - cx, rng.range(10, 18));
        const hTop = rng.range(0, 3);
        const hBot = rng.range(0, 3);
        buildings.push(rectBox(cx, y0 + hTop, cx + w - 2.5, y1 - hBot, { kind: 'building' }));
        if (rng.chance(0.7)) trees.push({ x: cx + w - 1.25, y: y0 + rng.range(2, Math.max(2.5, y1 - y0 - 2)), r: rng.range(1.3, 2) });
        cx += w;
      }
    }
  }
  for (const b of buildings) b._br = Math.hypot(b.length, b.width) / 2;

  // ---------- LiDAR pada mobil otonom ----------
  const lidar = new Sensor('lidar', { range: 26, rays: 360, rate: 12 });
  const rig = new SensorRig(ego, [lidar], { seed: 3 });
  const lidarObjects = [...buildings, ...agents];
  let time = 0;

  function update(dt) {
    time += dt;
    for (const p of plans) p.update(time);
    // jalur ego melingkar: garis henti yang sudah lewat dihitung sebagai putaran berikutnya
    const stopsAhead = egoStops.map((st) => (st.s < ego.s - 1 ? { s: st.s + egoPath.length, light: st.light } : st));
    ego.step(dt, laneTargetSpeed(ego, stopsAhead, { decel: 3 }));
    for (const lane of lanes) {
      const list = lane.agents;
      if (!list.length) continue;
      const L = list[0].path.length;
      const sorted = [...list].sort((a, b) => a.s - b.s);
      sorted.forEach((a, idx) => {
        const leader = sorted[(idx + 1) % sorted.length];
        let gap = leader.s - a.s;
        if (gap <= 0) gap += L;
        gap -= (a.length + leader.length) / 2;
        const v = laneTargetSpeed(a, lane.stops, { leaderGap: gap, leaderSpeed: leader.speed, decel: 3 });
        a.step(dt, v);
      });
    }
    rig.update(dt, lidarObjects, 'cerah');
  }

  function drawSignals(g) {
    for (const lane of lanes) {
      for (const stop of lane.stops) {
        const p = lane.path.sample(stop.s);
        const c = stop.light.state === 'green' ? COLORS.lightGreen : stop.light.state === 'yellow' ? COLORS.lightYellow : COLORS.lightRed;
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.heading);
        g.fillStyle = withAlpha(c, 0.9);
        g.fillRect(-0.25, -1.6, 0.5, 3.2);
        g.restore();
      }
    }
  }

  function render() {
    const g = view.begin(COLORS.ground);
    for (const r of roads) drawSidewalk(g, r);
    for (const r of roads) drawRoadSurface(g, r);
    for (const b of boxes) drawIntersection(g, b);
    for (const r of roads) drawRoadMarkings(g, r);
    for (const c of crossings) drawCrosswalk(g, c, { alpha: 0.5 });
    drawSignals(g);
    for (const b of buildings) drawBuilding(g, b);
    for (const t of trees) drawTree(g, t.x, t.y, t.r);
    // sensor mobil otonom
    const pose = lidar.pose(ego);
    const reading = rig.reading('lidar');
    drawSensorCone(g, pose, ego.heading, Math.PI / 2, 30, COLORS.kamera, { view, fillAlpha: 0.06, strokeAlpha: 0.25 });
    drawRing(g, pose.x, pose.y, lidar.range, { color: withAlpha(COLORS.lidar, 0.25), width: 1, view, dash: [3, 5] });
    const sweep = (time * 2.2) % 1;
    drawRing(g, pose.x, pose.y, 2 + sweep * (lidar.range - 2), { color: withAlpha(COLORS.lidar, 0.35 * (1 - sweep)), width: 2, view });
    for (const a of agents) drawCar(g, a, { braking: a.braking });
    if (reading) drawPointCloud(g, reading.points, COLORS.lidar, { view, size: 2.2, alpha: 0.9 });
  }

  let loop = null;
  let io = null;
  if (reducedMotion) {
    for (let i = 0; i < 240; i++) update(1 / 60);
    render();
    view.onResize(render);
  } else {
    for (let i = 0; i < 60; i++) update(1 / 60);
    loop = new Loop({ update, render }).start();
    io = new IntersectionObserver((entries) => {
      const visible = entries.some((e) => e.isIntersecting);
      if (visible) loop.start();
      else loop.stop();
    });
    io.observe(container);
  }

  return {
    destroy() {
      io?.disconnect();
      loop?.destroy();
      view.destroy();
    },
  };
}
