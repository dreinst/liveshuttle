// Uji model Lokalisasi tanpa browser (QA independen).
// Meniru urutan update() di js/lessons/lokalisasi.js lalu mengukur galat dan konsistensi elips 95%.
// Pemakaian: node tests/lokalisasi_indep_model.mjs [detik] [sigma]
import { createScene, CRUISE } from '../js/lessons/lokalisasi/scene.js';
import { GpsReceiver, WheelImu, DeadReckoning, PoseFilter, LidarLandmarks, LIDAR_PERIOD, CHI2_95 } from '../js/lessons/lokalisasi/estimators.js';
import { wrapAngle } from '../js/engine/math.js';

const SECONDS = Number(process.argv[2] || 600);
const SIGMA = Number(process.argv[3] || 2);
const dt = 1 / 60;

function run({ steerWith = null, sigma = SIGMA, seconds = SECONDS } = {}) {
  const scene = createScene();
  const ego = scene.ego;
  const gps = new GpsReceiver(7);
  const imu = new WheelImu(3);
  const odo = new DeadReckoning();
  const fus = new PoseFilter();
  const mapF = new PoseFilter();
  const lidar = new LidarLandmarks(scene.landmarks, scene.buildings, 5);
  let simT = 0;
  let lidarT = 0;
  const truth = () => ({ x: ego.x, y: ego.y, vx: ego.vx, vy: ego.vy });
  const f0 = gps.measure(0, truth(), sigma, scene.canyonAt(ego.x, ego.y));
  gps.history = [f0];
  gps.timer = 0;
  odo.init(ego.x, ego.y, ego.heading);
  fus.init(f0.x, f0.y, Math.atan2(f0.vy, f0.vx), f0.sigmaRep, 0.05);
  mapF.initFrom(fus);

  const st = {
    gpsOpen: [], gpsCanyon: [], fixOpen: [], fixCanyon: [], jumpsOutsideClaim: 0, jumps: 0,
    fus: [], map: [], fusIn: 0, mapIn: 0, n: 0, mapMax: 0, fusMax: 0, rejected: 0, fixes: 0,
    odo3At: null, nan: false, lat: [], exits: 0,
  };
  const inside = (f) => {
    // uji Mahalanobis posisi sebenarnya terhadap kovarians posisi filter
    const a = f.P[0][0], b = f.P[0][1], c = f.P[1][1];
    const dx = ego.x - f.x, dy = ego.y - f.y;
    const det = a * c - b * b;
    const d2 = (c * dx * dx - 2 * b * dx * dy + a * dy * dy) / det;
    return d2 <= CHI2_95;
  };
  let take = 0;
  let out = false;
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    const prevH = ego.heading;
    let pose = null;
    if (steerWith && take <= 0) {
      pose = steerWith === 'gps' ? gps.estimate(simT) : steerWith === 'fus' ? fus.pose() : steerWith === 'map' ? mapF.pose() : odo.pose();
    }
    scene.drive(dt, pose, take > 0 ? 5 : CRUISE);
    simT += dt;
    const w = wrapAngle(ego.heading - prevH) / dt;
    const beta = Math.atan(0.5 * Math.tan(ego.steer));
    const m = imu.measure(ego.speed, w);
    odo.predict(m.v, m.w, beta, dt);
    fus.predict(m.v, m.w, beta, dt);
    mapF.predict(m.v, m.w, beta, dt);
    const canyon = scene.canyonAt(ego.x, ego.y);
    const fix = gps.update(dt, simT, truth(), sigma, canyon);
    if (fix) {
      st.fixes++;
      const r = fus.updateGps(fix);
      if (!r.accepted) st.rejected++;
      mapF.updateGps(fix);
      (fix.canyon ? st.fixCanyon : st.fixOpen).push(fix.err);
      if (fix.jump) {
        st.jumps++;
        if (fix.err > Math.sqrt(CHI2_95) * fix.sigmaRep) st.jumpsOutsideClaim++;
      }
    }
    lidarT += dt;
    if (lidarT >= LIDAR_PERIOD) {
      lidarT -= LIDAR_PERIOD;
      mapF.matchScan(lidar.scan(ego), scene.landmarks);
    }
    const lat = scene.laneOffset();
    if (steerWith) {
      const o = Math.abs(lat) > 0.85;
      if (o && !out) st.exits++;
      out = o;
      if (take > 0) {
        take -= dt;
        if (take <= 0 && Math.abs(lat) > 0.3) take = 0.1;
      } else if (Math.abs(lat) > 1) take = 1.5;
      st.lat.push(Math.abs(lat));
    }
    const eo = Math.hypot(odo.x - ego.x, odo.y - ego.y);
    if (st.odo3At == null && eo > 3) st.odo3At = simT;
    if (i % 6 === 0) {
      const g = gps.estimate(simT);
      const eg = Math.hypot(g.x - ego.x, g.y - ego.y);
      (scene.inCanyon(ego.x, ego.y) ? st.gpsCanyon : st.gpsOpen).push(eg);
      const ef = Math.hypot(fus.x - ego.x, fus.y - ego.y);
      const em = Math.hypot(mapF.x - ego.x, mapF.y - ego.y);
      if (!Number.isFinite(ef) || !Number.isFinite(em) || !Number.isFinite(eg)) st.nan = true;
      st.fus.push(ef);
      st.map.push(em);
      st.fusMax = Math.max(st.fusMax, ef);
      st.mapMax = Math.max(st.mapMax, em);
      if (inside(fus)) st.fusIn++;
      if (inside(mapF)) st.mapIn++;
      st.n++;
    }
  }
  const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
  const frac = (a, t) => (a.length ? a.filter((v) => v > t).length / a.length : NaN);
  const r2 = (v) => Math.round(v * 1000) / 1000;
  return {
    sigma, seconds, steerWith,
    gpsOpenMean: r2(mean(st.gpsOpen)), gpsCanyonMean: r2(mean(st.gpsCanyon)),
    fixOpenAbove2: r2(frac(st.fixOpen, 2)), fixCanyonMean: r2(mean(st.fixCanyon)),
    jumps: st.jumps, jumpsOutsideClaim95: st.jumpsOutsideClaim,
    fusMean: r2(mean(st.fus)), fusMax: r2(st.fusMax), fusInside95: r2(st.fusIn / st.n),
    mapMean: r2(mean(st.map)), mapMax: r2(st.mapMax), mapInside95: r2(st.mapIn / st.n),
    mapAbove03: r2(frac(st.map, 0.3)),
    gpsRejectedPct: r2(st.rejected / st.fixes), odo3At: st.odo3At && r2(st.odo3At),
    wheelScaleEst: r2(fus.s[3]), gyroBiasEst: Math.round(fus.s[4] * 1e5) / 1e5,
    nan: st.nan,
    exits: st.exits, latMean: steerWith ? r2(mean(st.lat)) : null,
  };
}

const out = [];
for (const s of [0.5, 2, 5]) out.push(run({ sigma: s }));
for (const m of ['gps', 'fus', 'map']) out.push(run({ steerWith: m, seconds: 120, sigma: 2 }));
console.log(JSON.stringify(out, null, 1));
