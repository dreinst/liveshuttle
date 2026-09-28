"""Uji model Persepsi tanpa UI di Jalan Karangampel Timur: jalankan dunia dan pipeline persepsi, lalu catat peristiwa.

Pemakaian: python3 tests/persepsi_model.py [detik] [derau]
Butuh server: python3 tests/serve.py 8243

Yang dicatat (kunci jawaban `truth` dipakai untuk menilai):
  - kelas hasil fusi per kelas asli (mobil, angkot, sepeda motor, pesepeda, pejalan kaki);
  - objek nyata yang keliru ditolak sebagai hantu (harus 0 atau sangat jarang);
  - positif palsu poster halte pada ambang 20%, objek nyata di bawah ambang 90%;
  - konflik prediksi: kelas, waktu ke konflik, dan apakah pejalan kaki terdeteksi sebelum masuk lajur;
  - kecepatan jejak mobil parkir (harus mendekati 0) dan sepeda motor yang menyelip.
"""
import sys
sys.path.insert(0, "/Users/mcdonny/Downloads/ndur/driverless-sim/tests")
from persepsi_util import Session, dump  # noqa: E402

args = [a for a in sys.argv[1:] if not a.startswith("--")]
SECONDS = float(args[0]) if args else 120
NOISE = float(args[1]) if len(args) > 1 else 1

JS = """
async ([seconds, noise]) => {
  const { loadMap } = await import('/js/engine/osm2d.js');
  const { buildStreet } = await import('/js/lessons/persepsi/street.js');
  const { createScene } = await import('/js/lessons/persepsi/scene.js');
  const P = await import('/js/lessons/persepsi/perception.js');
  const map = await loadMap('machung');
  const street = buildStreet(map);
  const scene = createScene({ street, seed: 11 });
  const perc = P.createPerception({ seed: 23 });
  perc.setNoise(noise);
  const dt = 1 / 60;
  let acc = 0;
  let lap = 0;
  const log = [];
  const stats = { scans: 0, clsConfusion: {}, rejectedReal: 0, rejectedWhy: [], fpShown20: 0, reportedReal90: 0, filteredReal90: 0,
    conflicts: 0, inPath: 0, conflictByCls: {}, pedWarnedBeforeLane: 0, pedEnteredLane: 0, parkedSpeed: [], motorPassTracked: 0,
    ghostsRejected: 0, maxTracks: 0 };
  const warned = new Set();
  const entered = new Set();
  let lastConf = null;
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    scene.update(dt);
    if (scene.state.lap !== lap) { lap = scene.state.lap; perc.restart(); acc = 0; }
    acc += dt;
    if (acc < P.SCAN_DT - 1e-9) continue;
    acc -= P.SCAN_DT;
    perc.tick(scene.world(), P.SCAN_DT);
    stats.scans++;
    const t = scene.state.time;
    const ego = scene.ego;
    const L = perc.last;
    const byId = new Map([...scene.traffic, ...scene.peds, ...street.parked].map((o) => [o.id, o]));
    for (const f of L.fused) {
      if (f.truth == null) { if (f.conf >= 0.2) stats.fpShown20++; continue; }
      const o = byId.get(f.truth);
      if (!o) continue;
      const k = `${o.cls}->${f.cls}`;
      stats.clsConfusion[k] = (stats.clsConfusion[k] || 0) + 1;
      const fr = street.frenet(f.x, f.y, ego.s, 140);
      if (fr && fr.s > ego.s - 3 && fr.s < ego.s + 44) { if (f.conf >= 0.9) stats.reportedReal90++; else stats.filteredReal90++; }
    }
    for (const r of L.rejected) if (r.truth != null) { stats.rejectedReal++; if (stats.rejectedWhy.length < 6) stats.rejectedWhy.push({ t: +t.toFixed(1), truth: r.truth }); }
    stats.maxTracks = Math.max(stats.maxTracks, perc.tracks.length);
    const cands = [];
    for (const tr of perc.tracks) {
      if (!tr.confirmed) continue;
      const m = P.trackMotion(tr);
      if (tr.truth && tr.truth.startsWith('parkir')) stats.parkedSpeed.push(m.speed);
      const o = tr.truth ? byId.get(tr.truth) : null;
      if (o && o.kind === 'motor' && o.mode === 'pass') stats.motorPassTracked++;
      if (tr.conf >= 0.5 && P.predictable(tr)) cands.push({ track: tr, cls: tr.cls, halfWidth: tr.cls === 'pedestrian' || tr.cls === 'cyclist' ? 0.35 : tr.cls === 'motor' ? 0.36 : tr.size.width / 2 });
    }
    const corridor = { frenet: (x, y, h) => street.frenet(x, y, h, 60), heading: street.heading, s0: ego.s + ego.length / 2, s1: ego.s + ego.length / 2 + 35, d: ego.d, half: ego.width / 2 + 0.45, egoSpeed: ego.v };
    const c = P.findConflict(cands, corridor, P.HORIZON);
    if (c && !c.inPath) { stats.conflicts++; if (c.track.truth) warned.add(c.track.truth); }
    if (c && c.inPath) stats.inPath++;
    if (c) stats.conflictByCls[c.cls + (c.inPath ? ':dalam' : ':prediksi')] = (stats.conflictByCls[c.cls + (c.inPath ? ':dalam' : ':prediksi')] || 0) + 1;
    if (c && (!lastConf || lastConf.track !== c.track || lastConf.inPath !== c.inPath)) log.push({ t: +t.toFixed(1), cls: c.cls, tau: +c.tau.toFixed(1), inPath: c.inPath, truth: c.track.truth });
    lastConf = c;
    // penyeberang yang masuk lajur mobil otonom di depannya: apakah sudah diperingatkan lebih dulu?
    for (const p of scene.peds) {
      if (p.role !== 'crosser' || p.state !== 'cross' || entered.has(p.id)) continue;
      const ahead = p.s - (ego.s + ego.length / 2);
      if (p.d > ego.d - ego.width / 2 - 0.45 - 0.35 && ahead > 0 && ahead < 35) {
        entered.add(p.id);
        stats.pedEnteredLane++;
        if (warned.has(p.id)) stats.pedWarnedBeforeLane++;
      }
    }
    stats.ghostsRejected = perc.stats.rejectedTotal;
  }
  const avg = (a) => (a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(3) : null);
  stats.parkedSpeedAvg = avg(stats.parkedSpeed);
  stats.parkedSpeedMax = stats.parkedSpeed.length ? +Math.max(...stats.parkedSpeed).toFixed(3) : null;
  delete stats.parkedSpeed;
  stats.laps = scene.state.lap;
  stats.safety = { pedestrianContacts: scene.safety.pedestrianContacts, otherCollisions: scene.safety.otherCollisions, shieldBrakes: scene.safety.shieldBrakes, boardings: scene.safety.boardings, crossings: scene.safety.crossings };
  return { stats, log: log.slice(0, 30) };
}
"""

with Session() as s:
    s.go("js/data/", 200)
    res = s.page.evaluate(JS, [SECONDS, NOISE])
    res["errors"] = [e for e in s.errors if "status of 404" not in e]
    dump(res)
