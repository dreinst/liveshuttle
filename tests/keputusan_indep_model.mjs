// Uji model independen untuk pelajaran Pengambilan Keputusan (QA terpisah dari pembuat).
// Pemakaian: node tests/keputusan_indep_model.mjs
// Memeriksa dilema lampu kuning di banyak jarak dan kecepatan, berhenti di lampu merah,
// memberi jalan pejalan kaki, keamanan menyalip, dan mobil lawan yang muncul tiba-tiba
// saat kepadatan diganti.

const root = new URL('../js/lessons/keputusan/', import.meta.url).href;
const { createWorld, STOP_E, ZEBRA_X, ZEBRA_HALF, YIELD_GAP, L, EGO_Y } = await import(root + 'world.js');
const { createPlanner } = await import(root + 'planner.js');
const { boxesOverlap } = await import(new URL('../js/engine/geometry.js', import.meta.url).href);

const dt = 1 / 60;
const kmh = (v) => v / 3.6;
const problems = [];
const out = {};

function mk({ egoX, v, light = 'hijau', density = 'kosong', stalled = false }) {
  const w = createWorld();
  const p = createPlanner(w);
  w.signal.mode = light;
  w.density = density;
  w.stalled.active = stalled;
  p.setTarget(v);
  w.reset(egoX, v);
  p.reset();
  w.viewMaxX = egoX + 70;
  return { w, p };
}

// ---------- A. dilema lampu kuning ----------
{
  const rows = [];
  let wrong = 0;
  let hardBrake = 0;
  let ranRed = 0;
  let maxDecStop = 0;
  let minLeftGo = Infinity;
  for (const s of [20, 25, 30, 35, 40, 45, 50, 55, 60]) {
    const v = kmh(s);
    for (let d0 = 2; d0 <= 100; d0 += 1) {
      const front0 = STOP_E - 0.2 - d0;
      const { w, p } = mk({ egoX: front0 - 2.25, v, light: 'hijau' });
      // tekan "Paksa merah" saat garis henti tepat d0 di depan
      w.signal.mode = 'merah';
      let crossedRed = false;
      let crossTimeLeft = null;
      let peak = 0;
      for (let i = 0; i < 60 * 40; i++) {
        const f0 = w.ego.x + 2.25;
        w.update(dt, p);
        p.drainEvents();
        const f1 = w.ego.x + 2.25;
        if (w.ego.speed > 1) peak = Math.max(peak, -w.ego.accel);
        if (f0 <= STOP_E && f1 > STOP_E) {
          if (w.signal.main === 'red') crossedRed = true;
          crossTimeLeft = w.signal.yellowLeft();
          break;
        }
        if (p.P.yellow?.result?.kind === 'stop') break;
      }
      const rec = p.P.yellow;
      if (!rec) {
        rows.push({ s, d0, rec: null });
        continue;
      }
      const expectStop = rec.d > (rec.v * rec.v) / 6;
      if (expectStop !== rec.stop) wrong++;
      if (rec.stop) {
        maxDecStop = Math.max(maxDecStop, peak);
        if (peak > 3.15) hardBrake++;
        if (crossedRed || (rec.result && rec.result.gap > 1.5)) problems.push(`kuning berhenti buruk v=${s} d0=${d0} gap=${rec.result?.gap} crossedRed=${crossedRed}`);
      } else {
        if (crossedRed) ranRed++;
        if (crossTimeLeft != null) minLeftGo = Math.min(minLeftGo, crossTimeLeft);
      }
    }
  }
  out.yellow = { wrongDecisions: wrong, stopsAbove3_15: hardBrake, maxDecelOnStop: +maxDecStop.toFixed(2), goRanRed: ranRed, minYellowLeftAtCrossing: +minLeftGo.toFixed(2) };
  if (wrong) problems.push(`keputusan kuning salah ${wrong} kali`);
  if (ranRed) problems.push(`mobil memilih terus tetapi melewati garis saat merah ${ranRed} kali`);
  if (hardBrake) problems.push(`pengereman kuning di atas 3,15 m/s2: ${hardBrake} kali`);
}

// ---------- B. lampu merah dari jauh ----------
{
  const res = [];
  for (const s of [20, 30, 40, 50, 60]) {
    const v = kmh(s);
    const { w, p } = mk({ egoX: -150, v, light: 'merah' });
    let peak = 0;
    let crossed = false;
    let stoppedAt = null;
    for (let i = 0; i < 60 * 60; i++) {
      w.update(dt, p);
      p.drainEvents();
      if (w.ego.speed > 1) peak = Math.max(peak, -w.ego.accel);
      if (w.ego.x + 2.25 > STOP_E) crossed = true;
      if (w.ego.speed < 0.02 && p.P.state === 'lampu') {
        stoppedAt = STOP_E - (w.ego.x + 2.25);
        break;
      }
    }
    res.push({ kmh: s, gapToLine: stoppedAt == null ? null : +stoppedAt.toFixed(2), peakDecel: +peak.toFixed(2), crossed });
    if (crossed || stoppedAt == null || stoppedAt > 1.5 || stoppedAt < 0 || peak > 2.4) problems.push(`lampu merah buruk ${JSON.stringify(res[res.length - 1])}`);
  }
  out.red = res;
}

// ---------- C. pejalan kaki ----------
{
  const res = [];
  for (const s of [20, 40, 60]) {
    for (const off of [60, 100, 140]) {
      const v = kmh(s);
      const { w, p } = mk({ egoX: ZEBRA_X - off, v, light: 'hijau', density: 'sedang' });
      const r0 = w.spawnPed();
      let minGap = Infinity;
      let movedWhileCrossing = 0;
      let yieldDone = false;
      let aeb = 0;
      let enteredZebra = false;
      for (let i = 0; i < 60 * 60; i++) {
        w.update(dt, p);
        for (const e of p.drainEvents()) {
          if (e.type === 'yield-selesai') yieldDone = true;
          if (e.type === 'bahaya') aeb++;
        }
        w.drainEvents();
        const ped = w.peds.find((q) => q.id === r0.ped?.id);
        if (ped && ped.state === 'menyeberang') {
          const zA = ped.zx - ZEBRA_HALF;
          const front = w.ego.x + 2.25;
          if (front < zA + 10) minGap = Math.min(minGap, zA - front);
          if (w.ego.speed > 0.3 && front < zA) movedWhileCrossing++;
          if (front > zA && w.ego.x - 2.25 < ped.zx + ZEBRA_HALF) enteredZebra = true;
        }
        if (yieldDone) break;
      }
      res.push({ kmh: s, off, nextLap: r0.nextLap, yieldDone, minGapToZebra: +minGap.toFixed(2), movedWhileCrossing, aeb, enteredZebra, collisions: w.collisions });
      if (!r0.nextLap && (!yieldDone || enteredZebra || aeb || w.collisions || minGap < YIELD_GAP - 0.1)) problems.push(`pejalan buruk ${JSON.stringify(res[res.length - 1])}`);
    }
  }
  out.ped = res;
}

// ---------- D. menyalip: celah benar-benar aman? ----------
{
  const res = [];
  for (const density of ['sepi', 'sedang', 'padat']) {
    for (const s of [20, 40, 60]) {
      const v = kmh(s);
      const { w, p } = mk({ egoX: 95, v, light: 'hijau', density, stalled: true });
      let overtakes = 0;
      let aeb = 0;
      let minGapOnc = Infinity; // jarak bemper ke bemper saat mobil otonom memakai lajur kanan
      let minTTC = Infinity;
      let oncBraked = 0; // mobil lawan terpaksa melambat karena mobil otonom di lajurnya
      let maxLat = 0;
      let offRoad = false;
      let waitMax = 0;
      let waitT = 0;
      for (let i = 0; i < 60 * 600; i++) {
        w.update(dt, p);
        for (const e of p.drainEvents()) {
          if (e.type === 'salip-selesai') overtakes++;
          if (e.type === 'bahaya') aeb++;
        }
        w.drainEvents();
        const e = w.ego;
        if (p.P.state === 'celah') waitT += dt;
        else {
          waitMax = Math.max(waitMax, waitT);
          waitT = 0;
        }
        if (e.y - e.width / 2 < -3.5 || e.y + e.width / 2 > 3.5) offRoad = true;
        const inRight = e.y + e.width / 2 > 0.05;
        if (inRight) {
          for (const c of w.oncoming) {
            if (c.x < e.x) continue;
            const gap = c.x - c.length / 2 - (e.x + e.length / 2);
            if (gap < minGapOnc) minGapOnc = gap;
            const cl = e.speed + c.speed;
            if (cl > 0.1) minTTC = Math.min(minTTC, gap / cl);
            if (gap < 90 && c.speed < c.cruise - 0.5) oncBraked++;
          }
          // percepatan lateral kira-kira v^2 * kelengkungan dari laju belok heading
          maxLat = Math.max(maxLat, Math.abs(e.speed * e.speed * Math.tan(e.steer) / e.wheelbase));
        }
      }
      res.push({ density, kmh: s, overtakes, aeb, collisions: w.collisions, minGapOnc: +minGapOnc.toFixed(1), minTTC: +minTTC.toFixed(2), oncBrakedFrames: oncBraked, maxLatAccel: +maxLat.toFixed(2), offRoad, maxWait: +waitMax.toFixed(1) });
      const r = res[res.length - 1];
      if (r.aeb || r.collisions || r.overtakes < 3 || r.minTTC < 2 || r.offRoad) problems.push(`salip buruk ${JSON.stringify(r)}`);
    }
  }
  out.overtake = res;
}

// ---------- E. ganti kepadatan: mobil baru tidak boleh muncul di area yang terlihat ----------
{
  let popIns = 0;
  const samples = [];
  for (let trial = 0; trial < 200; trial++) {
    const { w, p } = mk({ egoX: 0, v: kmh(40), light: 'otomatis', density: 'sepi' });
    // jalankan acak 0 sampai 60 detik supaya posisi mobil lawan bervariasi
    const n = Math.floor(60 * 60 * (trial / 200));
    for (let i = 0; i < n; i++) {
      w.update(dt, p);
      p.drainEvents();
      w.drainEvents();
    }
    w.viewMaxX = w.ego.x + 71; // kira-kira tepi kanan layar desktop
    const before = new Set(w.oncoming.map((c) => c.id));
    for (const d of ['padat', 'sedang', 'sepi', 'padat']) {
      w.setDensity(d);
      for (const c of w.oncoming) {
        if (before.has(c.id)) continue;
        before.add(c.id);
        if (c.x - c.length / 2 < w.viewMaxX + 2) {
          popIns++;
          if (samples.length < 5) samples.push({ trial, density: d, newX: +(c.x - w.ego.x).toFixed(1), viewEdge: 71 });
        }
      }
    }
  }
  out.densityPopIn = { popIns, samples };
  if (popIns) problems.push(`mobil lawan baru muncul di dalam layar saat kepadatan diganti: ${popIns} kali`);
}

// ---------- F. tombol J ditekan terlambat di langkah 2: tugas tetap harus bisa selesai ----------
{
  const res = [];
  for (const delay of [0, 5, 10, 12, 15, 20, 25, 30]) {
    const { w, p } = mk({ egoX: 20, v: kmh(40), light: 'hijau', density: 'sepi' });
    for (let i = 0; i < 60 * delay; i++) {
      w.update(dt, p);
      p.drainEvents();
      w.drainEvents();
    }
    const r = w.spawnPed();
    let yielded = false;
    let t = 0;
    for (let i = 0; i < 60 * 90 && !yielded; i++) {
      w.update(dt, p);
      t += dt;
      for (const e of p.drainEvents()) if (e.type === 'yield-selesai') yielded = true;
      w.drainEvents();
    }
    res.push({ delay, dist: Math.round(r.distance), yielded, secondsToDone: +t.toFixed(1) });
    if (!yielded) problems.push(`pejalan kaki tidak pernah diberi jalan saat J ditekan ${delay} detik setelah mulai`);
  }
  out.lateJ = res;
}

// ---------- G. ganti kepadatan saat sedang menyalip ----------
{
  let bad = 0;
  let runs = 0;
  let minTTC = Infinity;
  for (let trial = 0; trial < 60; trial++) {
    const { w, p } = mk({ egoX: 95, v: kmh(40), light: 'hijau', density: 'sepi', stalled: true });
    let switched = false;
    for (let i = 0; i < 60 * 120; i++) {
      w.viewMaxX = w.ego.x + 71;
      if (!switched && p.P.state === 'salip' && p.P.stateTime > (trial % 6) * 0.4) {
        w.setDensity(trial % 2 ? 'padat' : 'sedang', p.P.man ? w.ego.x + 250 : -Infinity);
        switched = true;
        runs++;
      }
      w.update(dt, p);
      for (const e of p.drainEvents()) if (e.type === 'bahaya') bad++;
      w.drainEvents();
      const e = w.ego;
      if (e.y + e.width / 2 > 0.05) {
        for (const c of w.oncoming) {
          if (c.x < e.x) continue;
          const gap = c.x - c.length / 2 - (e.x + e.length / 2);
          const cl = e.speed + c.speed;
          if (cl > 0.1) minTTC = Math.min(minTTC, gap / cl);
        }
      }
      if (switched && p.P.state === 'melaju') break;
    }
    bad += w.collisions;
  }
  out.densityDuringOvertake = { runs, aebOrCollisions: bad, minTTC: +minTTC.toFixed(2) };
  if (bad || minTTC < 2) problems.push(`ganti kepadatan saat menyalip tidak aman ${JSON.stringify(out.densityDuringOvertake)}`);
}

// ---------- H. mobil mogok baru dianggap mogok setelah mobil otonom diam 1,5 detik ----------
{
  const { w, p } = mk({ egoX: 95, v: kmh(40), light: 'hijau', density: 'padat', stalled: true });
  let stopAt = null;
  let celahAt = null;
  for (let i = 0; i < 60 * 60 && celahAt == null; i++) {
    w.update(dt, p);
    p.drainEvents();
    w.drainEvents();
    if (stopAt == null && p.P.state === 'mengikuti' && w.ego.speed < 0.2) stopAt = w.time;
    if (p.P.state === 'celah') celahAt = w.time;
  }
  const lead = p.P.per.lead;
  out.stallObserve = { stoppedAt: stopAt && +stopAt.toFixed(2), celahAt: celahAt && +celahAt.toFixed(2), observed: stopAt && celahAt ? +(celahAt - stopAt).toFixed(2) : null, gapBehind: lead && +lead.d.toFixed(2) };
  if (!celahAt || celahAt - stopAt < 1.4 || Math.abs(lead.d - 8) > 0.6) problems.push(`pengamatan mobil mogok ${JSON.stringify(out.stallObserve)}`);
}

console.log(JSON.stringify(out, null, 1));
console.log(problems.length ? `MASALAH (${problems.length}):\n- ${problems.slice(0, 30).join('\n- ')}` : 'SEMUA OK');
process.exit(problems.length ? 1 : 0);
