// Uji model pelajaran Lokalisasi (rute Alun-alun Merdeka Malang) tanpa browser.
// Meniru urutan update() di js/lessons/lokalisasi.js: gerak mobil (dengan perisai keselamatan),
// odometri, fusi, GPS, pencocokan peta. Mengukur galat tiap estimasi, waktu drift odometri,
// lompatan GPS di zona gedung tinggi, keluar lajur saat menyetir dengan estimasi, dan penghitung
// aturan keselamatan (harus 0).
//
// Pemakaian: node tests/lokalisasi_model.mjs [detik] [sigma] [steer: none|gps|odo|fus|map] [spawnEvery]
import fs from 'node:fs';
import { parseMap } from '../js/engine/osm2d.js';
import { wrapAngle } from '../js/engine/math.js';
import { buildRoute } from '../js/lessons/lokalisasi/route.js';
import { createScene, LANE_OUT, PP } from '../js/lessons/lokalisasi/scene.js';
import { GpsReceiver, WheelImu, DeadReckoning, PoseFilter, LidarLandmarks, LIDAR_PERIOD, CHI2_95 } from '../js/lessons/lokalisasi/estimators.js';

const SECONDS = Number(process.argv[2] || 300);
const SIGMA = Number(process.argv[3] || 2);
const STEER = process.argv[4] || 'none';
const SPAWN_EVERY = Number(process.argv[5] || 0); // detik; 0 = hanya jadwal bawaan
const dt = 1 / 60;
if (process.env.PP_LOOK) PP.lookahead = Number(process.env.PP_LOOK);
if (process.env.PP_GAIN) PP.gain = Number(process.env.PP_GAIN);

const map = parseMap(JSON.parse(fs.readFileSync(new URL('../js/data/malang-center.json', import.meta.url), 'utf8')));
const route = buildRoute(map);
const scene = createScene(route);
const ego = scene.ego;
const gps = new GpsReceiver(7);
const imu = new WheelImu(3);
const odo = new DeadReckoning();
const fus = new PoseFilter();
const mapF = new PoseFilter();
const lidar = new LidarLandmarks(scene.landmarks, (x, y, r) => map.buildingsNear(x, y, r), 5);

let simT = 0;
let lidarT = 0;
const truth = () => ({ x: ego.x, y: ego.y, vx: ego.vx, vy: ego.vy });
const f0 = gps.measure(0, truth(), SIGMA, scene.canyonAt(ego.x, ego.y));
gps.history = [f0];
gps.timer = 0;
odo.init(ego.x, ego.y, ego.heading);
fus.init(f0.x, f0.y, Math.atan2(f0.vy, f0.vx), f0.sigmaRep, 0.05);
mapF.initFrom(fus);

const st = { gpsOpen: [], gpsCanyon: [], jumps: 0, fus: [], map: [], fusIn: 0, mapIn: 0, n: 0, odo3At: null, lat: [], exits: 0, takeovers: 0, laps: 0, stoppedMax: 0, matched: [] };
const inside = (f) => {
  const a = f.P[0][0], b = f.P[0][1], c = f.P[1][1];
  const dx = ego.x - f.x, dy = ego.y - f.y;
  const d2 = (c * dx * dx - 2 * b * dx * dy + a * dy * dy) / (a * c - b * b);
  return d2 <= CHI2_95;
};
let out = false;
let stopped = 0;
let lastS = scene.s;
let spawnT = SPAWN_EVERY;
const t0 = performance.now();
for (let i = 0; i < Math.round(SECONDS / dt); i++) {
  const prevH = ego.heading;
  let pose = null;
  if (STEER !== 'none') pose = STEER === 'gps' ? gps.estimate(simT) : STEER === 'odo' ? odo.pose() : STEER === 'fus' ? fus.pose() : mapF.pose();
  if (SPAWN_EVERY > 0) {
    spawnT -= dt;
    if (spawnT <= 0) {
      scene.spawnCrosser({ atCurb: true, fromLeft: Math.random() < 0.5 });
      spawnT = SPAWN_EVERY;
    }
  }
  scene.step(dt, pose);
  simT += dt;
  if (scene.s < lastS - 200) st.laps++;
  lastS = scene.s;
  const w = wrapAngle(ego.heading - prevH) / dt;
  const beta = Math.atan(0.5 * Math.tan(ego.steer));
  const m = imu.measure(ego.speed, w);
  odo.predict(m.v, m.w, beta, dt);
  fus.predict(m.v, m.w, beta, dt);
  mapF.predict(m.v, m.w, beta, dt);
  const canyon = scene.canyonAt(ego.x, ego.y);
  const fix = gps.update(dt, simT, truth(), SIGMA, canyon);
  if (fix) {
    fus.updateGps(fix);
    mapF.updateGps(fix);
    (fix.canyon ? st.gpsCanyon : st.gpsOpen).push(fix.err);
    if (fix.jump) st.jumps++;
  }
  lidarT += dt;
  if (lidarT >= LIDAR_PERIOD) {
    lidarT -= LIDAR_PERIOD;
    const r = mapF.matchScan(lidar.scan(ego), scene.landmarks);
    st.matched.push(r.used);
  }
  const eOdo = Math.hypot(odo.x - ego.x, odo.y - ego.y);
  if (st.odo3At == null && eOdo > 3) st.odo3At = simT;
  if (simT > 20) {
    st.n++;
    st.fus.push(Math.hypot(fus.x - ego.x, fus.y - ego.y));
    st.map.push(Math.hypot(mapF.x - ego.x, mapF.y - ego.y));
    if (inside(fus)) st.fusIn++;
    if (inside(mapF)) st.mapIn++;
  }
  const lat = scene.laneOffset();
  st.lat.push(Math.abs(lat));
  const o = Math.abs(lat) > LANE_OUT;
  if (o && !out) st.exits++;
  out = o;
  stopped = ego.speed < 0.05 ? stopped + dt : 0;
  st.stoppedMax = Math.max(st.stoppedMax, stopped);
  if (process.env.DEBUG_STUCK && stopped > 8 && (stopped < 8 + dt * 1.5 || (process.env.DEBUG_STUCK === '2' && Math.round(stopped * 60) % 30 === 0 && stopped < 20))) {
    console.error('STUCK t', simT.toFixed(1), 's', scene.s.toFixed(1), 'lat', lat.toFixed(2), 'take', scene.backup.take.toFixed(2), 'ego', ego.x.toFixed(1), ego.y.toFixed(1), 'h', ego.heading.toFixed(2), 'steer', ego.steer.toFixed(2), 'shield', scene.shield.active, scene.shield.distance, 'yield', scene.shield.yielding);
    for (const p of scene.allPeds()) {
      const d = Math.hypot(p.x - ego.x, p.y - ego.y);
      if (d < 15) console.error('  ped', p.id, p.state || 'jalan', p.x.toFixed(2), p.y.toFixed(2), 'd', d.toFixed(1), 'moving', p.moving, 'dir', p.dir, p.exitPt ? `exit ${p.exitPt.x.toFixed(1)},${p.exitPt.y.toFixed(1)}` : '');
    }
  }
}
const q = (arr, p) => {
  if (!arr.length) return NaN;
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(p * a.length))];
};
const mean = (a) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const r2 = (x) => Math.round(x * 100) / 100;
const res = {
  seconds: SECONDS, sigma: SIGMA, steer: STEER, wallMs: Math.round(performance.now() - t0),
  routeLength: r2(route.length), zones: route.zones.map((z) => ({ s0: Math.round(z.s0), len: z.length, name: z.name })),
  landmarks: scene.landmarks.length, laps: st.laps,
  gpsOpen: { mean: r2(mean(st.gpsOpen)), p95: r2(q(st.gpsOpen, 0.95)), n: st.gpsOpen.length },
  gpsCanyon: { mean: r2(mean(st.gpsCanyon)), p95: r2(q(st.gpsCanyon, 0.95)), n: st.gpsCanyon.length, jumps: st.jumps },
  odoOver3mAt: st.odo3At && r2(st.odo3At),
  fus: { mean: r2(mean(st.fus)), p95: r2(q(st.fus, 0.95)), in95: r2(st.fusIn / Math.max(1, st.n)) },
  map: { mean: r2(mean(st.map)), p95: r2(q(st.map, 0.95)), max: r2(Math.max(...st.map)), in95: r2(st.mapIn / Math.max(1, st.n)), matchedMedian: q(st.matched, 0.5) },
  lane: { p95: r2(q(st.lat, 0.95)), max: r2(Math.max(...st.lat)), exits: st.exits, takeovers: scene.backup.takeovers },
  stoppedMax: r2(st.stoppedMax),
  safety: scene.monitor.snapshot(),
};
console.log(JSON.stringify(res, null, 1));
const bad = res.safety.pedestrianContacts > 0 || res.safety.redLightViolations > 0 || Number.isNaN(res.map.mean);
process.exit(bad ? 1 : 0);
