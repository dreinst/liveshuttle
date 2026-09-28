// Serangan acak terhadap aturan keselamatan pelajaran Lokalisasi (tanpa browser).
// Meniru update() di js/lessons/lokalisasi.js, lalu melakukan semua yang bisa dilakukan pelajar
// secara acak dan sering: kemudi dengan estimasi apa pun, sigma GPS 0,5 sampai 5, menyalakan ulang
// odometri dan peta, pindah ke langkah 2 (mobil dipindah ke depan zona), Ulangi, ditambah
// penyeberang tambahan di tepi zebra cross. Menghitung kontak, penjepit, jarak terkecil, dan
// lama berhenti terpanjang.
// Pemakaian: node tests/lokalisasi_verify_attack.mjs [detik] [biji] [spawnEvery]
import fs from 'node:fs';
import { parseMap } from '../js/engine/osm2d.js';
import { wrapAngle, Rng } from '../js/engine/math.js';
import { distanceToBox } from '../js/engine/geometry.js';
import { buildRoute } from '../js/lessons/lokalisasi/route.js';
import { createScene } from '../js/lessons/lokalisasi/scene.js';
import { bodyBox } from '../js/lessons/lokalisasi/safety.js';
import { GpsReceiver, WheelImu, DeadReckoning, PoseFilter, LidarLandmarks, LIDAR_PERIOD } from '../js/lessons/lokalisasi/estimators.js';

const SECONDS = Number(process.argv[2] || 600);
const SEED = Number(process.argv[3] || 1);
const SPAWN_EVERY = Number(process.argv[4] || 3);
const dt = 1 / 60;
const HARD = process.env.HARD === '1';
const TRACE = process.env.TRACE ? process.env.TRACE.split(',').map(Number) : null;
const R = new Rng(SEED);

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
const zone0 = scene.zones[0];

let simT = 0;
let lidarT = 0;
let sigma = 2;
const show = { gps: true, odo: true, fus: true, map: true };
const steer = { on: false, sel: 'gps' };
const truth = () => ({ x: ego.x, y: ego.y, vx: ego.vx, vy: ego.vy });
function resetEstimates() {
  const f = gps.measure(simT, truth(), sigma, scene.canyonAt(ego.x, ego.y));
  gps.history.length = 0;
  gps.history.push(f);
  gps.timer = 0;
  odo.init(ego.x, ego.y, ego.heading);
  fus.init(f.x, f.y, Math.atan2(f.vy, f.vx), f.sigmaRep, 0.05);
  mapF.initFrom(fus);
}
resetEstimates();
const poseOf = (id) => (id === 'gps' ? gps.estimate(simT) : id === 'odo' ? odo.pose() : id === 'fus' ? fus.pose() : mapF.pose());

const st = { actions: {}, stoppedMax: 0, minGapMoving: Infinity, speedMax: 0, spawned: 0, overlapAfterStep: 0 };
const act = (k) => (st.actions[k] = (st.actions[k] || 0) + 1);
let stopped = 0;
let nextAct = 1;
let spawnT = SPAWN_EVERY;
for (let i = 0; i < Math.round(SECONDS / dt); i++) {
  // ---------- aksi pelajar acak ----------
  nextAct -= dt;
  if (HARD) {
    // mode keras: selalu menyetir dengan GPS sigma 5 atau odometri yang drift
    steer.on = true;
    sigma = 5;
    if (nextAct <= 0 && R.chance(0.5)) steer.sel = R.chance(0.5) ? 'gps' : 'odo';
  }
  if (nextAct <= 0) {
    nextAct = R.range(0.3, 6);
    const r = R.next();
    if (r < 0.25) {
      steer.on = !steer.on;
      if (steer.on) scene.resetBackup();
      act('steer');
    } else if (r < 0.45) {
      steer.sel = ['gps', 'odo', 'fus', 'map'][R.int(0, 3)];
      scene.backup.take = 0;
      act('sel');
    } else if (r < 0.6) {
      sigma = [0.5, 1, 2, 3, 4, 5][R.int(0, 5)];
      act('sigma');
    } else if (r < 0.7) {
      odo.init(ego.x, ego.y, ego.heading);
      act('odoOn');
    } else if (r < 0.78) {
      mapF.initFrom(fus);
      act('mapOn');
    } else if (r < 0.86) {
      // langkah 2 dengan GPS dinyalakan: mobil dipindah ke depan zona pertama
      const nz = scene.nextZone(scene.s);
      if (!(scene.zoneAtS(scene.s) || (nz && nz.dist < 80))) {
        scene.placeAt(zone0.s0 - 55);
        resetEstimates();
        act('relocate');
      }
    } else if (r < 0.92) {
      // Ulangi
      simT = 0;
      gps.reset();
      imu.reset();
      lidar.reset();
      scene.reset();
      scene.placeAt(R.chance(0.5) ? scene.START_S : zone0.s0 - 55);
      scene.resetBackup();
      resetEstimates();
      act('reset');
    } else {
      // pindah ke posisi acak di rute (lebih keras dari yang bisa dilakukan UI)
      scene.placeAt(R.range(0, scene.length));
      resetEstimates();
      act('teleport');
    }
  }
  if (SPAWN_EVERY > 0) {
    spawnT -= dt;
    if (spawnT <= 0) {
      if (scene.spawnCrosser({ atCurb: HARD || R.chance(0.6), fromLeft: R.chance(0.5) })) st.spawned++;
      spawnT = SPAWN_EVERY * R.range(0.3, 1.7);
    }
  }

  // ---------- update() pelajaran ----------
  const prevH = ego.heading;
  if (TRACE && i * dt >= TRACE[0] && i * dt <= TRACE[1]) {
    const w0 = scene.walkers[0];
    const g0 = distanceToBox(w0.x, w0.y, bodyBox(ego)) - w0.radius;
    console.error('T', simT.toFixed(3), 'v', ego.speed.toFixed(2), 'steer', ego.steer.toFixed(3), 'h', ego.heading.toFixed(3), 'lat', scene.laneOffset().toFixed(2), 'take', scene.backup.take.toFixed(2), 'shield', scene.shield.active, (scene.shield.distance ?? 0).toFixed?.(2), 'w0', w0.state, w0.moving, 'gap', g0.toFixed(3), 'rel', ((w0.x - ego.x) * Math.cos(ego.heading) + (w0.y - ego.y) * Math.sin(ego.heading)).toFixed(2), ((w0.x - ego.x) * Math.sin(ego.heading) - (w0.y - ego.y) * Math.cos(ego.heading)).toFixed(2));
  }
  scene.step(dt, steer.on ? poseOf(steer.sel) : null);
  simT += dt;
  const w = wrapAngle(ego.heading - prevH) / dt;
  const beta = Math.atan(0.5 * Math.tan(ego.steer));
  const m = imu.measure(ego.speed, w);
  odo.predict(m.v, m.w, beta, dt);
  fus.predict(m.v, m.w, beta, dt);
  mapF.predict(m.v, m.w, beta, dt);
  const fix = gps.update(dt, simT, truth(), sigma, scene.canyonAt(ego.x, ego.y));
  if (fix) {
    fus.updateGps(fix);
    mapF.updateGps(fix);
  }
  lidarT += dt;
  if (lidarT >= LIDAR_PERIOD) {
    lidarT -= LIDAR_PERIOD;
    mapF.matchScan(lidar.scan(ego), scene.landmarks);
  }

  // ---------- pengukuran ----------
  const box = bodyBox(ego);
  for (const p of scene.allPeds()) {
    if (!p.active) continue;
    const gap = distanceToBox(p.x, p.y, box) - p.radius;
    if (gap <= 0) st.overlapAfterStep++;
    if (ego.speed > 0.5 && gap < st.minGapMoving) st.minGapMoving = gap;
    if (process.env.DEBUG_GAP && ego.speed > 0.5 && gap < 0.3) console.error('gap', gap.toFixed(3), 't', simT.toFixed(2), 'v', ego.speed.toFixed(2), 'lat', scene.laneOffset().toFixed(2), 'take', scene.backup.take > 0, 'steer', steer.on && steer.sel, 'ped', p.id, p.state, 'moving', p.moving, 'rel', ((p.x - ego.x) * Math.cos(ego.heading) + (p.y - ego.y) * Math.sin(ego.heading)).toFixed(2));
  }
  st.speedMax = Math.max(st.speedMax, ego.speed);
  stopped = ego.speed < 0.05 ? stopped + dt : 0;
  if (stopped > st.stoppedMax) {
    st.stoppedMax = stopped;
    st.stoppedAt = { t: Math.round(simT), s: Math.round(scene.s), lat: +scene.laneOffset().toFixed(2), yielding: scene.shield.yielding, shield: scene.shield.active };
  }
  if (scene.monitor.state.clamps > (st.clampSeen || 0)) {
    st.clampSeen = scene.monitor.state.clamps;
    if (process.env.DEBUG_CLAMP) {
      console.error("CLAMP gt", (i * dt).toFixed(2), "t", simT.toFixed(2), 's', scene.s.toFixed(1), 'lat', scene.laneOffset().toFixed(2), 'take', scene.backup.take.toFixed(2), 'steer', ego.steer.toFixed(3), 'h', ego.heading.toFixed(3), 'sel', steer.on && steer.sel);
      for (const p of scene.allPeds()) {
        const d = Math.hypot(p.x - ego.x, p.y - ego.y);
        if (p.active && d < 6) console.error('  ped', p.id, p.state, 'moving', p.moving, 'gap', (distanceToBox(p.x, p.y, bodyBox(ego)) - p.radius).toFixed(3), 'rel', ((p.x - ego.x) * Math.cos(ego.heading) + (p.y - ego.y) * Math.sin(ego.heading)).toFixed(2), ((p.x - ego.x) * Math.sin(ego.heading) - (p.y - ego.y) * Math.cos(ego.heading)).toFixed(2));
      }
    }
  }
  if (!Number.isFinite(ego.x) || !Number.isFinite(mapF.x) || !Number.isFinite(fus.x)) {
    st.nan = simT;
    break;
  }
}
const res = {
  seconds: SECONDS,
  seed: SEED,
  spawnEvery: SPAWN_EVERY,
  spawned: st.spawned,
  actions: st.actions,
  safety: scene.monitor.snapshot(),
  overlapAfterStep: st.overlapAfterStep,
  minGapMoving: +st.minGapMoving.toFixed(3),
  speedMaxKmh: +(st.speedMax * 3.6).toFixed(1),
  stoppedMax: +st.stoppedMax.toFixed(1),
  stoppedAt: st.stoppedAt,
  takeovers: scene.backup.takeovers,
  nan: st.nan ?? null,
};
console.log(JSON.stringify(res));
process.exit(res.safety.pedestrianContacts || res.overlapAfterStep || res.nan != null ? 1 : 0);
