// Model persepsi pelajaran 3: deteksi tiap sensor, fusi, pelacakan, dan prediksi.
//
// Semua di sini penyederhanaan yang jujur dan disebutkan di teks pelajaran:
//   - Ketiga sensor dibaca bersamaan 10 kali per detik. Di mobil sungguhan tiap sensor punya
//     jadwal sendiri, jadi fusi juga harus menyamakan waktu pengukurannya.
//   - Kamera: kelas objek benar, sudut cukup tepat, jarak ditebak dari gambar sehingga galatnya
//     membesar dengan jarak. Poster orang di papan iklan halte bisa dikira pejalan kaki.
//   - LiDAR: awan titik dari raycast engine. Detektor klaster memperkirakan pusat objek dengan
//     tepat, tetapi tidak tahu kelasnya. Titik di gedung, pohon, dan halte dianggap latar
//     (disaring dengan peta) sehingga tidak menjadi objek.
//   - Radar: jarak tepat, sudut kurang tepat (posisi ke samping berderau), kecepatan relatif
//     dari efek Doppler. Tutup gorong-gorong dari logam kadang memberi pantulan hantu.
//   - Fusi: asosiasi tetangga terdekat di dalam gerbang Mahalanobis, rata-rata berbobot
//     kebalikan varians (bentuk informasi 2D), keyakinan digabung dengan 1 - (1 - p1)(1 - p2)...
//     Deteksi yang hanya dari radar ditolak bila kamera atau LiDAR seharusnya bisa melihatnya.
//   - Pelacakan: filter Kalman kecepatan konstan dengan keadaan [x, y, vx, vy].
//   - Prediksi: model kecepatan konstan 3 detik ke depan, kovarians membesar seiring waktu.
//
// Setiap deteksi menyimpan `truth` (id objek aslinya, atau null untuk deteksi palsu). Itu
// kunci jawaban untuk tampilan pelajaran, bukan sesuatu yang diketahui mobil.

import { Sensor } from '../../engine/sensors.js';
import { lineOfSight } from '../../engine/geometry.js';
import { Rng, angleDiff, clamp, degToRad } from '../../engine/math.js';

export const SCAN_DT = 0.1; // detik antar siklus persepsi (10 Hz)
export const HORIZON = 3; // detik prediksi ke depan

export const CAMERA = { forward: 0.7, fov: degToRad(90), range: 65, bearingSd: degToRad(0.35) };
export const LIDAR = { forward: -0.2, range: 45, rays: 720 };
export const RADAR = { forward: 2.25, fov: degToRad(24), range: 90, rangeSd: 0.25, bearingSd: degToRad(1.6), speedSd: 0.15 };

/** Pengali jangkauan radar dan kuat pantulan per jenis objek (logam besar memantul kuat). */
const REFLECT = { car: 1, cyclist: 0.6, pedestrian: 0.5 };
/** Kamera lebih mudah mengenali mobil daripada pejalan kaki atau pesepeda yang kecil. */
const CLASS_FACTOR = { car: 1, cyclist: 0.9, pedestrian: 0.86 };

export const CLASS_NAMES = { car: 'mobil', pedestrian: 'pejalan kaki', cyclist: 'pesepeda', unknown: 'belum dikenali' };
export const CLASS_SIZE = {
  car: { length: 4.5, width: 1.8 },
  pedestrian: { length: 0.8, width: 0.8 },
  cyclist: { length: 1.8, width: 0.7 },
};

const GATE = 13.82; // chi-kuadrat 2 derajat kebebasan, peluang 99,9%
const TRACK_GATE = 18.42; // gerbang pelacak sedikit lebih longgar (99,99%) agar tahan manuver
const MAX_ASSOC = 10; // m, batas jarak asosiasi apa pun kovariansnya
/** Kerapatan spektral derau percepatan (m^2/s^3) untuk model kecepatan konstan. */
const Q_ACCEL = { car: 0.8, cyclist: 0.6, pedestrian: 0.5, unknown: 0.8 };
const CONFIRM_HITS = 3;
const MAX_MISSES_CONFIRMED = 10; // jejak terkonfirmasi bertahan sekitar 1 detik tanpa pengukuran (misalnya saat tertutup)
const MAX_MISSES_TENTATIVE = 2;
const TRAIL_LEN = 30; // 3 detik jejak

// ---------- bantuan matriks 2x2 simetris, disimpan sebagai [xx, xy, yy] ----------

/** Kovarians dari simpangan baku searah garis pandang (along) dan melintang (across). */
export function covFromPolar(bearing, sdAlong, sdAcross) {
  const c = Math.cos(bearing);
  const s = Math.sin(bearing);
  const a = sdAlong * sdAlong;
  const b = sdAcross * sdAcross;
  return [a * c * c + b * s * s, (a - b) * c * s, a * s * s + b * c * c];
}

function inv2(m) {
  const det = m[0] * m[2] - m[1] * m[1] || 1e-12;
  return [m[2] / det, -m[1] / det, m[0] / det];
}

const add2 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

function mahal2(dx, dy, S) {
  const i = inv2(S);
  return dx * dx * i[0] + 2 * dx * dy * i[1] + dy * dy * i[2];
}

/** Elips simpangan baku dari kovarians 2x2: { rx, ry, angle }. k = pengali simpangan baku. */
export function ellipseOf(cov, k = 1) {
  const a = cov[0];
  const b = cov[1];
  const c = cov[2];
  const m = (a + c) / 2;
  const d = Math.sqrt(((a - c) / 2) ** 2 + b * b);
  return { rx: k * Math.sqrt(Math.max(m + d, 1e-6)), ry: k * Math.sqrt(Math.max(m - d, 1e-6)), angle: 0.5 * Math.atan2(2 * b, a - c) };
}

// ---------- geometri sensor ----------

function mountPose(ego, forward) {
  const c = Math.cos(ego.heading);
  const s = Math.sin(ego.heading);
  return { x: ego.x + c * forward, y: ego.y + s * forward, heading: ego.heading };
}

const sizeRadius = (o) => (o.radius != null ? o.radius : Math.hypot(o.length, o.width) / 2);

/**
 * Bagian objek yang terlihat dari titik `from`: 0, 1/3, 2/3, atau 1.
 * Diuji dengan garis pandang ke tengah objek dan ke dua sisi terluarnya.
 */
function visibility(objects, ego, from, o) {
  const dx = o.x - from.x;
  const dy = o.y - from.y;
  const d = Math.hypot(dx, dy) || 1e-6;
  const br = Math.min(sizeRadius(o), 2.5) * 0.8;
  const px = -dy / d;
  const py = dx / d;
  let n = 0;
  for (const k of [0, 1, -1]) {
    if (lineOfSight(objects, from.x, from.y, o.x + px * br * k, o.y + py * br * k, { target: o, ignore: ego })) n++;
  }
  return n / 3;
}

/** Keyakinan gabungan dengan anggapan tiap sensor keliru secara terpisah. */
export function combineConfidence(list) {
  let miss = 1;
  for (const p of list) miss *= 1 - p;
  return 1 - miss;
}

/**
 * Buat pipeline persepsi.
 * @param {object} opts { seed }
 */
export function createPerception({ seed = 7 } = {}) {
  const rng = new Rng(seed);
  const lidarSensor = new Sensor('lidar', { id: 'lidar', mount: { forward: LIDAR.forward, left: 0, yaw: 0 }, range: LIDAR.range, rays: LIDAR.rays, rangeNoise: 0.02 });
  const ar = new Map(); // derau berkorelasi per sensor dan objek
  let noise = 1;
  let tick = 0;
  let time = 0;
  let nextTrackId = 1;
  let nextGhostId = 1;
  let ghosts = []; // sumber pantulan hantu radar yang sedang aktif
  let candidates = []; // deteksi radar saja di daerah yang diawasi sensor lain
  const tracks = [];
  const stats = { rejectedTotal: 0 };
  const empty = () => ({
    time: 0,
    camera: { pose: null, dets: [] },
    lidar: { pose: null, points: [], dets: [] },
    radar: { pose: null, dets: [] },
    fused: [],
    rejected: [],
    tentative: [],
  });
  let last = empty();

  /** Derau normal baku yang berkorelasi dengan siklus sebelumnya (a = 0 berarti derau putih). */
  function arNoise(key, a) {
    let s = ar.get(key);
    if (!s) {
      s = { v: rng.gaussian(), t: tick };
      ar.set(key, s);
    } else {
      s.v = a * s.v + Math.sqrt(1 - a * a) * rng.gaussian();
      s.t = tick;
    }
    return s.v;
  }

  // ---------- kamera ----------
  function scanCamera(world) {
    const { ego, objects, relevant, adPanels } = world;
    const pose = mountPose(ego, CAMERA.forward);
    const dets = [];
    for (const o of relevant) {
      const dx = o.x - pose.x;
      const dy = o.y - pose.y;
      const r = Math.hypot(dx, dy);
      if (r > CAMERA.range || r < 1.5) continue;
      const bearing = Math.atan2(dy, dx);
      if (Math.abs(angleDiff(bearing, pose.heading)) > CAMERA.fov / 2) continue;
      const vis = visibility(objects, ego, pose, o);
      if (vis <= 0) continue;
      // kamera tunggal menebak jarak dari ukuran objek di gambar: galat membesar dengan jarak
      const sdR = noise * Math.max(0.25, 0.05 * r);
      const sdB = noise * CAMERA.bearingSd;
      const rm = Math.max(1, r + sdR * arNoise(`k:${o.id}`, 0.3));
      const bm = bearing + sdB * rng.gaussian();
      const conf = clamp((0.98 - 0.006 * r) * CLASS_FACTOR[o.kind] * (0.5 + 0.5 * vis) + rng.gaussian(0, 0.012), 0.15, 0.97);
      dets.push({
        sensor: 'kamera',
        x: pose.x + Math.cos(bm) * rm,
        y: pose.y + Math.sin(bm) * rm,
        r: rm,
        bearing: bm,
        cov: covFromPolar(bm, sdR, Math.max(0.05, rm * sdB)),
        conf,
        cls: o.kind,
        truth: o.id,
        heading: o.heading || 0,
        target: o,
      });
    }
    // poster orang di papan iklan halte: kamera keliru menganggapnya pejalan kaki (positif palsu)
    for (const ad of adPanels) {
      const dx = ad.x - pose.x;
      const dy = ad.y - pose.y;
      const r = Math.hypot(dx, dy);
      if (r < 6 || r > 36) continue;
      const bearing = Math.atan2(dy, dx);
      if (Math.abs(angleDiff(bearing, pose.heading)) > CAMERA.fov / 2) continue;
      const toCam = Math.atan2(pose.y - ad.y, pose.x - ad.x);
      if (Math.cos(angleDiff(ad.facing, toCam)) < 0.3) continue; // muka poster harus menghadap kamera
      if (!lineOfSight(objects, pose.x, pose.y, ad.x, ad.y, { target: ad.halte, ignore: ego })) continue;
      const sdR = noise * Math.max(0.25, 0.05 * r);
      const sdB = noise * CAMERA.bearingSd;
      const rm = Math.max(1, r + sdR * arNoise(`k:${ad.id}`, 0.3));
      const bm = bearing + sdB * rng.gaussian();
      dets.push({
        sensor: 'kamera',
        x: pose.x + Math.cos(bm) * rm,
        y: pose.y + Math.sin(bm) * rm,
        r: rm,
        bearing: bm,
        cov: covFromPolar(bm, sdR, Math.max(0.05, rm * sdB)),
        conf: clamp(0.33 + 0.06 * arNoise(`fp:${ad.id}`, 0.85), 0.2, 0.45),
        cls: 'pedestrian',
        truth: null,
        fake: 'iklan',
        heading: -Math.PI / 2,
        target: null,
      });
    }
    return { pose, dets };
  }

  // ---------- LiDAR ----------
  function scanLidar(world) {
    const { ego, objects, relevant } = world;
    lidarSensor.rangeNoise = 0.02 * noise;
    const reading = lidarSensor.sense(ego, objects, { weather: 'cerah', rng, time });
    const pose = reading.pose;
    const rel = new Map(relevant.map((o) => [o.id, o]));
    const boxes = new Map();
    for (const p of reading.points) {
      if (!rel.has(p.targetId)) continue;
      p.rel = true;
      let b = boxes.get(p.targetId);
      if (!b) boxes.set(p.targetId, (b = { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y }));
      b.minX = Math.min(b.minX, p.x);
      b.minY = Math.min(b.minY, p.y);
      b.maxX = Math.max(b.maxX, p.x);
      b.maxY = Math.max(b.maxY, p.y);
    }
    const dets = [];
    for (const d of reading.detections) {
      const o = rel.get(d.targetId);
      if (!o || d.points < 2) continue;
      const r = Math.hypot(o.x - pose.x, o.y - pose.y);
      // pusat klaster diperkirakan dengan menempelkan kotak ke titik-titiknya
      const sd = noise * (0.06 + 0.002 * r) * (1 + 1.5 / d.points);
      dets.push({
        sensor: 'lidar',
        x: o.x + rng.gaussian(0, sd),
        y: o.y + rng.gaussian(0, sd),
        r,
        cov: [sd * sd, 0, sd * sd],
        conf: 1 - Math.exp(-d.points / 5),
        cls: null,
        truth: o.id,
        heading: o.heading || 0,
        points: d.points,
        box: boxes.get(o.id) || null,
        target: o,
      });
    }
    return { pose, points: reading.points, dets };
  }

  // ---------- radar ----------
  function scanRadar(world) {
    const { ego, objects, relevant, manholes } = world;
    const pose = mountPose(ego, RADAR.forward);
    const evx = ego.vx;
    const evy = ego.vy;
    const dets = [];
    const inView = (x, y) => {
      const dx = x - pose.x;
      const dy = y - pose.y;
      const r = Math.hypot(dx, dy);
      const b = Math.atan2(dy, dx);
      return { r, b, ok: Math.abs(angleDiff(b, pose.heading)) <= RADAR.fov / 2 };
    };
    const measure = (x, y, vx, vy, key) => {
      const { r, b } = inView(x, y);
      const sdR = noise * RADAR.rangeSd;
      const sdB = noise * RADAR.bearingSd;
      const rm = Math.max(0.5, r + sdR * rng.gaussian());
      const bm = b + sdB * arNoise(key, 0.5);
      const ux = Math.cos(b);
      const uy = Math.sin(b);
      // efek Doppler: yang terukur hanya kecepatan relatif SEPANJANG garis pandang
      const rel = (vx - evx) * ux + (vy - evy) * uy;
      return {
        sensor: 'radar',
        x: pose.x + Math.cos(bm) * rm,
        y: pose.y + Math.sin(bm) * rm,
        r: rm,
        bearing: bm,
        cov: covFromPolar(bm, sdR, Math.max(0.1, rm * sdB)),
        relSpeed: rel + noise * RADAR.speedSd * rng.gaussian(),
        cls: null,
      };
    };
    for (const o of relevant) {
      const v = inView(o.x, o.y);
      if (!v.ok || v.r < 1.5 || v.r > RADAR.range * REFLECT[o.kind]) continue;
      if (visibility(objects, ego, pose, o) <= 0) continue;
      dets.push({ ...measure(o.x, o.y, o.vx || 0, o.vy || 0, `r:${o.id}`), conf: 0.3 + 0.45 * REFLECT[o.kind], truth: o.id, heading: o.heading || 0, target: o });
    }
    // pantulan hantu yang muncul sendiri sesekali dari tutup gorong-gorong di depan
    for (const m of manholes) {
      const v = inView(m.x, m.y);
      if (!v.ok || v.r < 10 || v.r > 45) continue;
      if (ghosts.some((g) => g.source === m)) continue;
      if (rng.next() < 0.004) ghosts.push({ id: `hantu-${nextGhostId++}`, x: m.x, y: m.y, source: m, until: time + rng.range(0.5, 1.1), manual: false });
    }
    ghosts = ghosts.filter((g) => g.until > time && inView(g.x, g.y).r > 4);
    for (const g of ghosts) {
      const v = inView(g.x, g.y);
      if (!v.ok || v.r > 60) continue;
      dets.push({ ...measure(g.x, g.y, 0, 0, `r:${g.id}`), conf: 0.62, truth: null, ghost: true, manual: g.manual, heading: 0, target: null, source: g });
    }
    return { pose, dets };
  }

  // ---------- fusi ----------
  function finalize(g) {
    let info = [0, 0, 0];
    let vx = 0;
    let vy = 0;
    for (const d of g.members) {
      const i = inv2(d.cov);
      info = add2(info, i);
      vx += i[0] * d.x + i[1] * d.y;
      vy += i[1] * d.x + i[2] * d.y;
    }
    const cov = inv2(info);
    g.cov = cov;
    // rata-rata berbobot kebalikan varians (versi 2D: bobotnya matriks informasi)
    g.x = cov[0] * vx + cov[1] * vy;
    g.y = cov[1] * vx + cov[2] * vy;
    g.sensors = new Set(g.members.map((d) => d.sensor));
    g.conf = combineConfidence(g.members.map((d) => d.conf));
    const cam = g.members.find((d) => d.sensor === 'kamera');
    const lid = g.members.find((d) => d.sensor === 'lidar');
    const rad = g.members.find((d) => d.sensor === 'radar');
    g.cls = cam ? cam.cls : 'unknown';
    g.truth = lid ? lid.truth : cam ? cam.truth : rad ? rad.truth : null;
    g.fake = !lid && cam && cam.fake ? cam.fake : null;
    g.heading = lid ? lid.heading : cam ? cam.heading : 0;
    const t = (lid || cam || rad)?.target;
    g.size = CLASS_SIZE[g.cls] || (t && t.length ? { length: t.length, width: t.width } : { length: 1.2, width: 1.2 });
    g.relSpeed = rad ? rad.relSpeed : null;
    return g;
  }

  function associate(list, groups) {
    const pairs = [];
    list.forEach((d, i) => {
      groups.forEach((g, j) => {
        if (g.sensors.has(d.sensor)) return;
        const dx = d.x - g.x;
        const dy = d.y - g.y;
        if (dx * dx + dy * dy > MAX_ASSOC * MAX_ASSOC) return;
        const d2 = mahal2(dx, dy, add2(d.cov, g.cov));
        if (d2 < GATE) pairs.push([d2, i, j]);
      });
    });
    pairs.sort((a, b) => a[0] - b[0]);
    const usedD = new Set();
    const usedG = new Set();
    for (const [, i, j] of pairs) {
      if (usedD.has(i) || usedG.has(j)) continue;
      usedD.add(i);
      usedG.add(j);
      groups[j].members.push(list[i]);
    }
    for (const j of usedG) finalize(groups[j]);
    list.forEach((d, i) => {
      if (!usedD.has(i)) groups.push(finalize({ members: [d] }));
    });
  }

  /**
   * Apakah kamera atau LiDAR seharusnya bisa melihat objek di sekitar deteksi radar `g` bila
   * memang ada? Seluruh daerah ketidakpastian radar (tengah dan satu simpangan baku ke samping)
   * harus terlihat jelas, dan jaraknya di dalam jangkauan andal kedua sensor itu.
   */
  function coveredByOthers(world, g) {
    const { ego, objects } = world;
    const e = ellipseOf(g.cov);
    const ux = Math.cos(e.angle) * e.rx;
    const uy = Math.sin(e.angle) * e.rx;
    const pts = [
      { x: g.x, y: g.y },
      { x: g.x + ux, y: g.y + uy },
      { x: g.x - ux, y: g.y - uy },
    ];
    const seesAll = (pose, range, fov) =>
      pts.every((p) => {
        if (Math.hypot(p.x - pose.x, p.y - pose.y) > range) return false;
        if (fov < Math.PI * 2 && Math.abs(angleDiff(Math.atan2(p.y - pose.y, p.x - pose.x), pose.heading)) > fov / 2) return false;
        return lineOfSight(objects, pose.x, pose.y, p.x, p.y, { ignore: ego });
      });
    return seesAll(mountPose(ego, CAMERA.forward), 40, CAMERA.fov) || seesAll(mountPose(ego, LIDAR.forward), LIDAR.range, Math.PI * 2);
  }

  function fuse(world, cam, lid, rad) {
    // LiDAR paling tepat posisinya, jadi klasternya menjadi titik awal kelompok
    const groups = lid.dets.map((d) => finalize({ members: [d] }));
    associate(cam.dets, groups);
    associate(rad.dets, groups);
    const fused = [];
    const radarOnly = [];
    for (const g of groups) {
      if (g.sensors.has('kamera') || g.sensors.has('lidar')) fused.push(g);
      else radarOnly.push(g);
    }
    // deteksi radar saja: ditolak bila kamera atau LiDAR seharusnya melihatnya, tetapi tidak.
    // Supaya objek nyata tidak ikut terbuang karena satu kali gagal dipasangkan, deteksi baru
    // ditolak setelah muncul di dua siklus berturut-turut.
    const rejected = [];
    const tentative = [];
    const nextCands = [];
    for (const g of radarOnly) {
      if (!coveredByOthers(world, g)) {
        tentative.push(g);
        continue;
      }
      let prev = null;
      let best = 2.5;
      for (const c of candidates) {
        const d = Math.hypot(c.x - g.x, c.y - g.y);
        if (d < best && c.tick === tick - 1) {
          best = d;
          prev = c;
        }
      }
      const n = prev ? prev.n + 1 : 1;
      const cand = { x: g.x, y: g.y, n, tick, counted: prev ? prev.counted : false };
      g.manual = g.members.some((d) => d.manual);
      if (n >= 2) {
        rejected.push(g);
        if (!cand.counted) {
          cand.counted = true;
          stats.rejectedTotal++;
        }
      }
      nextCands.push(cand);
    }
    candidates = nextCands;
    return { fused, rejected, tentative };
  }

  // ---------- pelacakan (filter Kalman kecepatan konstan) ----------
  function newTrack(f) {
    const P = new Float64Array(16);
    P[0] = f.cov[0];
    P[1] = f.cov[1];
    P[4] = f.cov[1];
    P[5] = f.cov[2];
    P[10] = 16; // kecepatan awal belum diketahui: simpangan baku 4 m/s
    P[15] = 16;
    return {
      id: nextTrackId++,
      x: new Float64Array([f.x, f.y, 0, 0]),
      P,
      cls: f.cls,
      conf: f.conf,
      hits: 1,
      misses: 0,
      age: 0,
      confirmed: false,
      trail: [{ x: f.x, y: f.y }],
      truth: f.truth,
      fake: f.fake,
      heading: f.heading,
      size: f.size,
      last: f,
      sincePrecise: f.sensors.has('lidar') ? 0 : 99,
    };
  }

  function predictStep(t, dt) {
    const x = t.x;
    const P = t.P;
    x[0] += x[2] * dt;
    x[1] += x[3] * dt;
    // P = F P F^T + Q, dengan F = [[I, dt I], [0, I]]
    for (let j = 0; j < 4; j++) {
      P[j] += dt * P[8 + j];
      P[4 + j] += dt * P[12 + j];
    }
    for (let i = 0; i < 4; i++) {
      P[i * 4] += dt * P[i * 4 + 2];
      P[i * 4 + 1] += dt * P[i * 4 + 3];
    }
    const q = Q_ACCEL[t.cls] ?? Q_ACCEL.unknown;
    const q11 = (q * dt * dt * dt) / 3;
    const q12 = (q * dt * dt) / 2;
    const q22 = q * dt;
    P[0] += q11;
    P[5] += q11;
    P[2] += q12;
    P[8] += q12;
    P[7] += q12;
    P[13] += q12;
    P[10] += q22;
    P[15] += q22;
  }

  const innovationCov = (t, R) => [t.P[0] + R[0], t.P[1] + R[1], t.P[5] + R[2]];
  const measNoise = (f) => [f.cov[0] + 0.01, f.cov[1], f.cov[2] + 0.01];

  function updateStep(t, f) {
    const R = measNoise(f);
    const Si = inv2(innovationCov(t, R));
    const P = t.P;
    const yx = f.x - t.x[0];
    const yy = f.y - t.x[1];
    const K = new Float64Array(8);
    for (let i = 0; i < 4; i++) {
      K[i * 2] = P[i * 4] * Si[0] + P[i * 4 + 1] * Si[1];
      K[i * 2 + 1] = P[i * 4] * Si[1] + P[i * 4 + 1] * Si[2];
    }
    for (let i = 0; i < 4; i++) t.x[i] += K[i * 2] * yx + K[i * 2 + 1] * yy;
    const row0 = P.slice(0, 4);
    const row1 = P.slice(4, 8);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) P[i * 4 + j] -= K[i * 2] * row0[j] + K[i * 2 + 1] * row1[j];
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        const m = (P[i * 4 + j] + P[j * 4 + i]) / 2;
        P[i * 4 + j] = m;
        P[j * 4 + i] = m;
      }
    }
  }

  function trackStep(fused, dt) {
    for (const t of tracks) predictStep(t, dt);
    const pairs = [];
    tracks.forEach((t, i) => {
      fused.forEach((f, j) => {
        const dx = f.x - t.x[0];
        const dy = f.y - t.x[1];
        if (dx * dx + dy * dy > 25) return;
        const d2 = mahal2(dx, dy, innovationCov(t, measNoise(f)));
        if (d2 < TRACK_GATE) pairs.push([d2, i, j]);
      });
    });
    pairs.sort((a, b) => a[0] - b[0]);
    const usedT = new Set();
    const usedF = new Set();
    for (const [, i, j] of pairs) {
      if (usedT.has(i) || usedF.has(j)) continue;
      usedT.add(i);
      usedF.add(j);
      const t = tracks[i];
      const f = fused[j];
      updateStep(t, f);
      t.hits++;
      t.misses = 0;
      if (t.hits >= CONFIRM_HITS) t.confirmed = true;
      // pelacakan mengingat kelas walau kamera sudah tidak melihat objeknya
      if (f.cls !== 'unknown') t.cls = f.cls;
      t.conf += 0.4 * (f.conf - t.conf);
      t.truth = f.truth;
      t.fake = f.fake;
      t.heading = f.heading;
      t.size = CLASS_SIZE[t.cls] || f.size;
      t.last = f;
      if (f.sensors.has('lidar')) t.sincePrecise = -dt;
    }
    tracks.forEach((t, i) => {
      t.age += dt;
      t.sincePrecise += dt;
      if (!usedT.has(i)) {
        t.misses++;
        t.conf *= 0.8;
        t.last = null;
      }
      t.trail.push({ x: t.x[0], y: t.x[1] });
      if (t.trail.length > TRAIL_LEN) t.trail.shift();
    });
    for (let i = tracks.length - 1; i >= 0; i--) {
      const t = tracks[i];
      if (t.misses > (t.confirmed ? MAX_MISSES_CONFIRMED : MAX_MISSES_TENTATIVE)) tracks.splice(i, 1);
    }
    // objek baru hanya dibuat bila tidak berada di dalam gerbang jejak yang sudah ada,
    // supaya satu objek tidak mendapat dua jejak saat satu deteksi gagal dipasangkan
    fused.forEach((f, j) => {
      if (usedF.has(j)) return;
      const near = tracks.some((t) => mahal2(f.x - t.x[0], f.y - t.x[1], innovationCov(t, measNoise(f))) < 3 * TRACK_GATE);
      if (!near) tracks.push(newTrack(f));
    });
  }

  // ---------- siklus ----------
  function perceive(world) {
    const cam = scanCamera(world);
    const lid = scanLidar(world);
    const rad = scanRadar(world);
    const res = fuse(world, cam, lid, rad);
    last = { time, camera: cam, lidar: lid, radar: rad, ...res };
    tick++;
    if (tick % 50 === 0) for (const [k, s] of ar) if (tick - s.t > 30) ar.delete(k);
    return res;
  }

  return {
    get last() {
      return last;
    },
    get tracks() {
      return tracks;
    },
    get stats() {
      return stats;
    },
    get ghosts() {
      return ghosts;
    },
    get noise() {
      return noise;
    },
    setNoise(v) {
      noise = clamp(Number(v) || 1, 0.25, 4);
    },

    /** Satu siklus persepsi: pindai, fusi, lalu lacak. */
    tick(world, dt = SCAN_DT) {
      time = world.time;
      const res = perceive(world);
      trackStep(res.fused, dt);
    },

    /** Pindai dan fusi ulang tanpa memajukan pelacak (dipakai saat simulasi dijeda). */
    rescan(world) {
      time = world.time;
      perceive(world);
      perceive(world);
    },

    /**
     * Munculkan pantulan hantu radar dari tutup gorong-gorong di depan mobil.
     * Mengembalikan sumber hantu, atau null bila tidak ada tutup gorong-gorong yang cocok.
     */
    spawnGhost(world) {
      const pose = mountPose(world.ego, RADAR.forward);
      let best = null;
      let bestScore = Infinity;
      for (const m of world.manholes) {
        const dx = m.x - pose.x;
        const dy = m.y - pose.y;
        const r = Math.hypot(dx, dy);
        if (r < 12 || r > 44) continue;
        if (Math.abs(angleDiff(Math.atan2(dy, dx), pose.heading)) > RADAR.fov / 2 - degToRad(2)) continue;
        const score = Math.abs(r - 24);
        if (score < bestScore) {
          bestScore = score;
          best = m;
        }
      }
      if (!best) return null;
      ghosts = ghosts.filter((g) => g.source !== best && !g.manual);
      const g = { id: `hantu-${nextGhostId++}`, x: best.x, y: best.y, source: best, until: world.time + 4.5, manual: true };
      ghosts.push(g);
      return g;
    },

    /** Pantulan hantu buatan pelajar yang sedang ditolak fusi, atau null. */
    manualGhostRejected() {
      return last.rejected.find((g) => g.manual) || null;
    },

    reset() {
      rng.reseed(seed);
      ar.clear();
      tick = 0;
      time = 0;
      nextTrackId = 1;
      nextGhostId = 1;
      ghosts = [];
      candidates = [];
      tracks.length = 0;
      stats.rejectedTotal = 0;
      last = empty();
    },
  };
}

// ---------- prediksi ----------

const Q_OF = (t) => Q_ACCEL[t.cls] ?? Q_ACCEL.unknown;

/** Kecepatan (m/s) dan ketidakpastian kecepatan (simpangan baku terbesar, m/s) sebuah jejak. */
export function trackMotion(t) {
  const speed = Math.hypot(t.x[2], t.x[3]);
  const vcov = [t.P[10], t.P[11], t.P[15]];
  const e = ellipseOf(vcov);
  return { speed, speedSd: e.rx };
}

/**
 * Apakah jejak layak diprediksi: sudah terkonfirmasi minimal 1 detik, jelas bergerak (kecepatan
 * minimal dua kali ketidakpastiannya), dan baru saja diukur LiDAR. Tanpa LiDAR, posisi dari kamera
 * dan radar kurang tepat ke salah satu arah, jadi kecepatannya belum bisa dipercaya.
 */
export function predictable(t) {
  if (!t.confirmed || t.age < 1 || t.sincePrecise > 0.5) return false;
  const { speed, speedSd } = trackMotion(t);
  return speed >= 0.5 && speed >= 2 * speedSd;
}

/**
 * Posisi dan kovarians jejak `tau` detik ke depan dengan model kecepatan konstan:
 * P(tau) = F P F^T + Q(tau). Hanya blok posisi yang dihitung.
 */
export function predictAt(t, tau) {
  const P = t.P;
  const q3 = (Q_OF(t) * tau * tau * tau) / 3;
  return {
    t: tau,
    x: t.x[0] + t.x[2] * tau,
    y: t.x[1] + t.x[3] * tau,
    cov: [
      P[0] + 2 * tau * P[2] + tau * tau * P[10] + q3,
      P[1] + tau * (P[3] + P[6]) + tau * tau * P[11],
      P[5] + 2 * tau * P[7] + tau * tau * P[15] + q3,
    ],
  };
}

/** Deretan titik prediksi dari 0 sampai `horizon` detik. */
export function predictTrack(t, horizon = HORIZON, step = 0.25) {
  const out = [];
  for (let tau = 0; tau <= horizon + 1e-9; tau += step) out.push(predictAt(t, tau));
  return out;
}

/**
 * Cari objek yang diprediksi masuk koridor jalur rencana mobil otonom.
 * corridor: { x0, x1, y, half } (lajur lurus ke arah +x).
 * objects: [{ track, cls, halfWidth }] yang sudah lolos ambang keyakinan.
 * Hasil: { track, cls, tau (detik, 0 bila sudah di dalam), inPath, x, y } paling awal, atau null.
 */
export function findConflict(objects, corridor, horizon = HORIZON) {
  let best = null;
  for (const o of objects) {
    const t = o.track;
    const half = corridor.half + o.halfWidth;
    const inside = (x, y) => x >= corridor.x0 && x <= corridor.x1 && Math.abs(y - corridor.y) <= half;
    // hanya objek yang bergerak MELINTANG menuju jalur (misalnya menyeberang) yang diperiksa.
    // Kendaraan yang melaju sejajar di lajur sebelah tidak dianggap memotong jalur.
    const vx = t.x[2];
    const vy = t.x[3];
    const toward = Math.sign(corridor.y - t.x[1]) * vy;
    const crossing = toward > 0.3 && Math.abs(vy) >= Math.abs(vx) * Math.tan((20 * Math.PI) / 180);
    if (inside(t.x[0], t.x[1])) {
      if (Math.hypot(vx, vy) < 0.5) continue;
      const hit = { track: t, cls: o.cls, tau: 0, inPath: true, x: t.x[0], y: t.x[1] };
      if (!best || !best.inPath || best.tau > 0) best = hit;
      continue;
    }
    if (!crossing) continue;
    for (let tau = 0.1; tau <= horizon + 1e-9; tau += 0.1) {
      const p = predictAt(t, tau);
      if (inside(p.x, p.y)) {
        if (!best || (!best.inPath && tau < best.tau)) best = { track: t, cls: o.cls, tau, inPath: false, x: p.x, y: p.y };
        break;
      }
    }
  }
  return best;
}
