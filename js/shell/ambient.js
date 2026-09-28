// Kanvas tenang untuk beranda: potongan peta asli di selatan Universitas Ma Chung (data
// OpenStreetMap) dengan shuttle otonom yang berkeliling di boulevard Villa Puncak Tidar, beberapa
// kendaraan lain, dan titik LiDAR yang memudar pelan. Ini ilustrasi: posisi kendaraan tidak nyata.
// Menghormati prefers-reduced-motion (satu gambar diam, tanpa sapuan).

import { View } from '../engine/canvas.js';
import { Loop } from '../engine/loop.js';
import { Rng } from '../engine/math.js';
import { Path } from '../engine/geometry.js';
import { PathAgent } from '../engine/vehicle.js';
import { followingSpeed } from '../engine/traffic.js';
import { Sensor, SensorRig } from '../engine/sensors.js';
import { COLORS } from '../engine/theme.js';
import { drawVehicle, createLidarTrail, drawLidarRange, drawLidarSweep, lidarSweepAngle } from '../engine/draw.js';
import { loadMap, createMapRenderer } from '../engine/osm2d.js';

// area peta (meter, titik asal = pusat kampus, y ke selatan)
const WIDE = { minX: -175, minY: 20, maxX: 265, maxY: 300 };
const NARROW = { minX: -150, minY: -10, maxX: 245, maxY: 325 };
// dua bundaran di ujung boulevard: rute shuttle bolak-balik lewat dua jalur satu arahnya
const WAYPOINTS = [
  [-130, 109],
  [223, 254],
];
const LIDAR_RANGE = 55;

export function mountAmbient(container, { reducedMotion = false } = {}) {
  const rng = new Rng(7);
  const view = new View(container, {
    label: 'Peta sekitar Universitas Ma Chung dari OpenStreetMap. Shuttle otonom berwarna hijau toska berkeliling di boulevard Villa Puncak Tidar dan memindai sekitarnya dengan LiDAR. Gerakannya ilustrasi, bukan posisi kendaraan sebenarnya.',
    bounds: (v) => (v.aspect < 1.25 ? NARROW : WIDE),
    padding: 0,
  });
  const abort = new AbortController();
  let destroyed = false;
  let loop = null;
  let io = null;
  let scene = null;

  const renderEmpty = () => {
    view.begin(COLORS.ground);
  };
  renderEmpty();
  view.onResize(() => {
    if (!loop || reducedMotion) (scene ? render : renderEmpty)();
  });

  function buildScene(map) {
    const graph = map.graph({ cost: 'length' });
    const ids = WAYPOINTS.map(([x, y]) => graph.nearestNode(x, y).id);
    const nodePath = [];
    for (let i = 0; i < ids.length; i++) {
      const r = graph.findRoute(ids[i], ids[(i + 1) % ids.length]);
      if (!r.found) return null;
      nodePath.push(...(i ? r.path.slice(1) : r.path));
    }
    const pts = graph.routePoints(nodePath, { keepLeft: true, smooth: 5 });
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (Math.hypot(a.x - b.x, a.y - b.y) < 0.5) pts.pop();
    const path = new Path(pts, { closed: true });

    const agents = [];
    const add = (kind, s, cruise, extra = {}) => {
      const ag = new PathAgent({ kind, path, s, cruise, speed: cruise * 0.8, loop: true, accel: 1.2, decel: 3, ...extra });
      agents.push(ag);
      return ag;
    };
    const L = path.length;
    const shuttle = add('shuttle', L * 0.08, 5.5, { color: COLORS.ego });
    shuttle.ego = true;
    add('motor', L * 0.2, 6.5, { color: '#475569' }).rider = { helmet: COLORS.helmets[2], passenger: true };
    add('city', L * 0.32, 6.2, { color: rng.pick(COLORS.vehicles) });
    add('mpv', L * 0.47, 6, { color: '#cbd5e1' });
    add('motor', L * 0.6, 6.8, { color: '#1f2937' }).rider = { helmet: COLORS.helmets[4], passenger: false };
    add('car', L * 0.72, 6.2, { color: rng.pick(COLORS.vehicles) });
    add('city', L * 0.86, 6, { color: '#94a3b8' });

    // LiDAR shuttle: hanya gedung di sekitar rute dan kendaraan lain
    const bb = map.boundsOf([{ points: pts }], LIDAR_RANGE + 10);
    const buildings = map.buildings.filter((bd) => bd.bbox.maxX > bb.minX && bd.bbox.minX < bb.maxX && bd.bbox.maxY > bb.minY && bd.bbox.minY < bb.maxY);
    const lidar = new Sensor('lidar', { range: LIDAR_RANGE, rays: 180, rate: 5 });
    const rig = new SensorRig(shuttle, [lidar], { seed: 3 });
    const trail = createLidarTrail({ fade: 2.4, max: 2400 });
    return { path, agents, shuttle, lidar, rig, trail, objects: [...buildings, ...agents.filter((x) => x !== shuttle)], time: 0 };
  }

  function update(dt) {
    const S = scene;
    S.time += dt;
    const L = S.path.length;
    const sorted = [...S.agents].sort((p, q) => p.s - q.s);
    sorted.forEach((ag, i) => {
      const lead = sorted[(i + 1) % sorted.length];
      let gap = lead.s - ag.s;
      if (gap <= 0) gap += L;
      gap -= (ag.length + lead.length) / 2;
      ag.step(dt, Math.min(ag.cruise, followingSpeed(gap, lead.speed, { cruise: ag.cruise, minGap: 3, timeGap: 1.4, decel: 3, strict: true })));
    });
    S.rig.update(dt, S.objects, 'cerah');
    S.trail.addReading(S.rig.reading('lidar'), S.time, { skipClutter: true });
  }

  let renderer = null;
  function render() {
    const S = scene;
    const g = view.begin(COLORS.ground);
    renderer.draw(g, view, { attribution: false });
    const pose = S.lidar.pose(S.shuttle);
    drawLidarRange(g, pose, LIDAR_RANGE, COLORS.lidar, { view, alpha: 0.05, edgeAlpha: 0.22 });
    if (!reducedMotion) drawLidarSweep(g, pose, lidarSweepAngle(S.time, { period: 10 }), LIDAR_RANGE, COLORS.lidar, { alpha: 0.1, width: 0.9 });
    for (const ag of S.agents) {
      if (ag === S.shuttle) continue;
      const minPx = ag.kind === 'motor' ? 11 : 16;
      drawVehicle(g, ag, { view, minPx, braking: ag.braking, ...(ag.rider || {}) });
    }
    S.trail.draw(g, S.time, COLORS.lidar, { view, size: 2, alpha: 0.6, halo: 0.5, spacing: 1.8 });
    drawVehicle(g, S.shuttle, { view, minPx: 22, ego: true, braking: S.shuttle.braking });
    // atribusi paling akhir supaya tidak tertutup kendaraan atau titik LiDAR
    renderer.drawAttribution(g, view);
  }

  loadMap('machung', { signal: abort.signal })
    .then((map) => {
      if (destroyed) return;
      scene = buildScene(map);
      if (!scene) return;
      renderer = createMapRenderer(map, { layers: { arrows: false, places: false }, labelRank: 10, attribution: { corner: 'bottom-right', margin: 6 } });
      if (reducedMotion) {
        for (let i = 0; i < 300; i++) update(1 / 60);
        render();
        return;
      }
      for (let i = 0; i < 90; i++) update(1 / 60);
      loop = new Loop({ update, render }).start();
      io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) loop.start();
        else loop.stop();
      });
      io.observe(container);
    })
    .catch((err) => {
      if (err?.name === 'AbortError' || destroyed) return;
      // peta gagal dimuat (misalnya koneksi putus): beranda tetap bisa dipakai tanpa animasi
      renderEmpty();
    });

  return {
    destroy() {
      destroyed = true;
      abort.abort();
      io?.disconnect();
      loop?.destroy();
      view.destroy();
    },
  };
}
