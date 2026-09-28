// QA mandiri model pelajaran Kendali (Node): pengaturan ekstrem, bodi mobil terhadap aspal dan
// pulau bundaran, pengemudi cadangan, klaim angka di teks pelajaran.
// Pemakaian: node tests/kontrol_verify_model.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { parseMap } = await import(ROOT + '/js/engine/osm2d.js');
const { buildTrack, zoneAt } = await import(ROOT + '/js/lessons/kontrol/track.js');
const { createSim, CFG } = await import(ROOT + '/js/lessons/kontrol/sim.js');
const map = parseMap(JSON.parse(fs.readFileSync(ROOT + '/js/data/machung-2d.json', 'utf8')));
const track = buildTrack(map);
const islands = track.roundabouts.map((rb) => ({ x: rb.x, y: rb.y, r: rb.radius - Math.max(...rb.roads.map((r) => r.width)) / 2 - 0.4 }));
const routeIds = new Set(track.roads.map((r) => r.id));

function offAsphalt(p) {
  // jarak titik di luar aspal jalan terdekat (0 bila di atas aspal)
  const hit = map.nearestRoad(p.x, p.y);
  if (!hit) return 99;
  return Math.max(0, hit.dist - hit.road.width / 2);
}

function run(set, seconds = 150, opts = {}) {
  const sim = createSim(track);
  Object.assign(sim.settings, set);
  sim.reset();
  const res = { maxCte: 0, maxOff: 0, maxIsland: 0, takeovers: 0, reasons: {}, laps: [], wrongRoad: 0, maxLat: 0, minSpeed: 99, maxKmh: 0, firstTakeoverAt: null, cutHold: 0, insideTakeover: false };
  let cutRun = 0;
  let lastLap = 0;
  let lastTo = 0;
  for (let i = 0; i < seconds * 60; i++) {
    if (opts.onStep) opts.onStep(sim, i);
    sim.step(1 / 60);
    const st = sim.state;
    res.maxCte = Math.max(res.maxCte, Math.abs(st.cte));
    res.maxLat = Math.max(res.maxLat, Math.abs(st.latAccel));
    res.maxKmh = Math.max(res.maxKmh, sim.ego.speed * 3.6);
    // memotong sisi dalam tikungan (sama dengan deteksi tugas lookahead-large di kontrol.js)
    const kk = st.curvatureHere;
    const cutting = !st.takeover && sim.ego.speed >= 15 / 3.6 && Math.abs(kk) > 0.01 && Math.sign(kk) === Math.sign(st.cte) && Math.abs(st.cte) >= 0.6;
    cutRun = cutting ? cutRun + 1 / 60 : 0;
    res.cutHold = Math.max(res.cutHold, cutRun);
    if (i % 3 === 0) {
      for (const c of sim.ego.corners()) {
        res.maxOff = Math.max(res.maxOff, offAsphalt(c));
        for (const is of islands) res.maxIsland = Math.max(res.maxIsland, is.r - Math.hypot(c.x - is.x, c.y - is.y));
      }
    }
    if (st.takeovers > lastTo) {
      lastTo = st.takeovers;
      res.takeovers++;
      res.reasons[st.lastTakeover.reason] = (res.reasons[st.lastTakeover.reason] || 0) + 1;
      if (st.lastTakeover.inside) res.insideTakeover = true;
      if (res.firstTakeoverAt == null) res.firstTakeoverAt = { t: +st.time.toFixed(1), s: +st.s.toFixed(0), kmh: +(sim.ego.speed * 3.6).toFixed(0), inside: st.lastTakeover.inside, reason: st.lastTakeover.reason };
    }
    const l = st.lastLap;
    if (l && l.index !== lastLap) {
      lastLap = l.index;
      res.laps.push({ rms: +l.rms.toFixed(3), max: +l.max.toFixed(2), time: +l.time.toFixed(1), avg: +l.avgKmh.toFixed(1), to: l.takeover });
    }
  }
  res.maxCte = +res.maxCte.toFixed(2);
  res.maxOff = +res.maxOff.toFixed(2);
  res.maxIsland = +res.maxIsland.toFixed(2);
  res.maxLat = +res.maxLat.toFixed(1);
  res.maxKmh = +res.maxKmh.toFixed(1);
  return { sim, res };
}

const out = [];
// sapuan pengaturan tetap
for (const ld of [2, 2.5, 3, 3.5, 4, 5, 6, 8, 10, 12, 15, 18, 20]) {
  for (const kmh of [10, 20, 30, 40, 50]) {
    for (const curveSlow of [false, true]) {
      const { res } = run({ ld, targetKmh: kmh, curveSlow, adaptive: false }, 130);
      out.push({ ld, kmh, curveSlow, ...res });
    }
  }
}
// adaptif
for (const k of [0.2, 0.3, 0.5, 0.7, 1, 1.4, 2]) {
  for (const kmh of [10, 30, 40, 50]) {
    const { res } = run({ adaptive: true, k, targetKmh: kmh }, 130);
    out.push({ adaptive: k, kmh, ...res });
  }
}
// PID ekstrem
for (const [kp, ki, kd] of [[5, 2, 1], [0, 2, 0], [5, 0, 1], [0.1, 0, 0], [0, 0, 0], [5, 2, 0], [0.8, 2, 1]]) {
  for (const ld of [2, 8, 20]) {
    const { res } = run({ kp, ki, kd, ld, targetKmh: 50 }, 130);
    out.push({ kp, ki, kd, ld, kmh: 50, ...res });
  }
}
// pengaturan diganti-ganti cepat (seperti pelajar menggeser slider bolak-balik)
{
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const { res } = run({}, 400, {
    onStep(sim, i) {
      if (i % 30 === 0) {
        const s = sim.settings;
        s.ld = 2 + Math.round(rnd() * 36) / 2;
        s.targetKmh = 10 + Math.round(rnd() * 40);
        s.adaptive = rnd() < 0.3;
        s.k = 0.2 + rnd() * 1.8;
        s.kp = rnd() * 5; s.ki = rnd() * 2; s.kd = rnd();
        s.curveSlow = rnd() < 0.5;
        sim.notifyTrackingChange(); sim.notifyTargetChange(); sim.notifyGainChange();
      }
      if (i % 700 === 0) sim.reset();
    },
  });
  out.push({ random: true, ...res });
}
const worst = (key) => out.reduce((a, b) => (b[key] > a[key] ? b : a));
console.log('runs', out.length);
for (const key of ['maxCte', 'maxOff', 'maxIsland', 'maxLat', 'maxKmh']) {
  const w = worst(key);
  console.log('worst', key, w[key], JSON.stringify({ ...w, laps: w.laps.slice(0, 2) }));
}
// ringkas per Ld pada 40 km/jam
console.log('\nLd sweep @40, curveSlow off: ld | takeovers | first takeover | laps(rms,max,time,avg,takeover) | maxCte | maxOff | island');
for (const r of out.filter((r) => r.kmh === 40 && r.ld != null && !r.curveSlow && r.kp == null)) {
  console.log(r.ld, '|', r.takeovers, JSON.stringify(r.reasons), JSON.stringify(r.firstTakeoverAt), '|', JSON.stringify(r.laps), '|', r.maxCte, r.maxOff, r.maxIsland);
}
console.log('\nLd sweep @50:');
for (const r of out.filter((r) => r.kmh === 50 && r.ld != null && !r.curveSlow && r.kp == null)) {
  console.log(r.ld, '|', r.takeovers, JSON.stringify(r.reasons), JSON.stringify(r.firstTakeoverAt), '|', JSON.stringify(r.laps), '|', r.maxCte, r.maxOff, r.maxIsland);
}
console.log('\nLd sweep @10/20/30 takeovers:');
for (const r of out.filter((r) => r.kmh <= 30 && r.ld != null && !r.curveSlow && r.kp == null)) {
  console.log(r.kmh, r.ld, '|', r.takeovers, JSON.stringify(r.reasons), '| laps', r.laps.length, r.laps[0] ? JSON.stringify(r.laps[0]) : '', '|', r.maxCte, r.maxOff);
}
console.log('\nadaptive:');
for (const r of out.filter((r) => r.adaptive != null)) console.log(r.adaptive, r.kmh, '|', r.takeovers, JSON.stringify(r.reasons), '|', JSON.stringify(r.laps.slice(0, 1)), '|', r.maxCte, r.maxOff, r.maxIsland);
console.log('\nPID extremes:');
for (const r of out.filter((r) => r.kp != null)) console.log(r.kp, r.ki, r.kd, r.ld, '|', r.takeovers, JSON.stringify(r.reasons), '|', r.maxKmh, '|', r.maxCte, r.maxOff, r.maxIsland);
const rnd = out.find((r) => r.random);
console.log('\nrandom:', JSON.stringify({ ...rnd, laps: rnd.laps.length }));
fs.writeFileSync(ROOT + '/tests/shots/kontrol-verify/model.json', JSON.stringify(out, null, 1));

// ---------- pemeriksaan ----------
const fails = [];
const expect = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) fails.push(msg); };
expect(worst('maxIsland').maxIsland <= 0.05, `bodi mobil tidak masuk pulau bundaran di semua pengaturan (paling dalam ${worst('maxIsland').maxIsland} m)`);
expect(worst('maxCte').maxCte <= 1.6, `simpangan sumbu belakang terbesar ${worst('maxCte').maxCte} m (batas pengemudi cadangan 1,5 m)`);
expect(worst('maxOff').maxOff <= 1.2, `sudut bodi paling jauh ${worst('maxOff').maxOff} m di luar aspal (hanya di sudut simpang yang tajam di peta)`);
const normal = out.filter((r) => r.kp == null && !r.random && ((r.ld >= 4 && r.ld <= 10 && r.kmh === 40) || (r.ld >= 6 && r.ld <= 10) || (r.adaptive >= 0.5 && r.adaptive <= 1.4)));
expect(normal.every((r) => r.takeovers === 0), `tidak ada pengambilalihan palsu untuk pengaturan wajar (${normal.length} jalan)`);
const tuned = out.filter((r) => r.kp == null && r.ld >= 4 && r.ld <= 10 && r.kmh === 40 && !r.curveSlow);
expect(tuned.every((r) => r.laps.length && r.laps[0].rms < 0.3 && !r.laps[0].to), 'Ld 4 sampai 10 m pada 40 km/jam: RMS satu putaran di bawah 0,3 m');
const cut = out.filter((r) => r.kp == null && r.ld >= 15 && r.kmh >= 30);
expect(cut.every((r) => r.insideTakeover || r.cutHold >= 0.8), `Ld 15 m atau lebih pada 30 km/jam ke atas: mobil terlihat memotong tikungan (paling singkat ${Math.min(...cut.map((r) => (r.insideTakeover ? 99 : r.cutHold))).toFixed(1)} detik, atau diambil alih saat memotong)`);
const weave = out.filter((r) => r.kp == null && r.ld != null && r.ld <= 3 && r.kmh >= 40);
expect(weave.every((r) => r.firstTakeoverAt && r.firstTakeoverAt.t < 12 && r.firstTakeoverAt.kmh >= 30), 'Ld 3 m atau kurang pada 40 km/jam ke atas: diambil alih dalam 12 detik pada 30 km/jam atau lebih');
console.log(fails.length ? `\n${fails.length} GAGAL` : '\nSemua pemeriksaan lulus.');
process.exitCode = fails.length ? 1 : 0;
