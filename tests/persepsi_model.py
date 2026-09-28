"""Uji model Persepsi tanpa UI: jalankan scene dan pipeline persepsi di halaman, lalu catat peristiwa.

Pemakaian: python3 tests/persepsi_model.py [detik] [derau]
"""
import sys
sys.path.insert(0, "/Users/mcdonny/Downloads/ndur/driverless-sim/tests")
from persepsi_util import Session, dump  # noqa: E402

SECONDS = float(sys.argv[1]) if len(sys.argv) > 1 else 60
NOISE = float(sys.argv[2]) if len(sys.argv) > 2 else 1

JS = """
async ([seconds, noise]) => {
  const { createScene, LANE_Y } = await import('/js/lessons/persepsi/scene.js');
  const P = await import('/js/lessons/persepsi/perception.js');
  const scene = createScene({ seed: 11 });
  const perc = P.createPerception({ seed: 23 });
  perc.setNoise(noise);
  const dt = 1 / 60;
  let acc = 0;
  const log = [];
  const stats = { conflicts: 0, inPath: 0, firstConflictAt: null, crossStarts: [], yieldTime: 0, minEgoSpeed: 99,
    parkedSpeed: [], pedSpeedSd: [], filtered50: {}, filteredReal50: 0, samples: 0, reportedReal90: 0, filteredReal90: 0,
    fpShown20: 0, ghostsRejected: 0, rejectedReal: 0, trackCount: 0, confirmed: 0, clsCount: {} };
  const crossState = new Map();
  let lastConf = null;
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    scene.update(dt);
    acc += dt;
    if (acc >= P.SCAN_DT - 1e-9) {
      acc -= P.SCAN_DT;
      perc.tick(scene.world(), P.SCAN_DT);
      const t = scene.state.time;
      for (const a of scene.actors) if (a.role === 'crosser') {
        const prev = crossState.get(a.id);
        if (prev !== a.state) { crossState.set(a.id, a.state); if (a.state === 'cross') stats.crossStarts.push({ id: a.id, t: +t.toFixed(1), egoDist: +(a.zebraX - scene.ego.x - 2.25).toFixed(1) }); }
      }
      if (scene.state.yielding) stats.yieldTime += P.SCAN_DT;
      for (const a of scene.actors) if (a.role === 'crosser' && a.state === 'cross' && a.y < 0.2 && a.y > -3.7) {
        const gap = a.x - (scene.ego.x + scene.ego.length / 2);
        if (gap > -2) { stats.minGapPedInLane = Math.min(stats.minGapPedInLane ?? 99, gap); stats.egoSpeedAtMinGap = stats.minGapPedInLane === gap ? scene.ego.speed : stats.egoSpeedAtMinGap; }
      }
      stats.minEgoSpeed = Math.min(stats.minEgoSpeed, scene.ego.speed);
      const ego = scene.ego;
      const x0 = ego.x + ego.length / 2;
      const corridor = { x0, x1: x0 + 35, y: LANE_Y, half: ego.width / 2 + 0.6 };
      const confirmed = perc.tracks.filter(tr => tr.confirmed);
      stats.trackCount = Math.max(stats.trackCount, perc.tracks.length);
      const cands = [];
      for (const tr of confirmed) {
        const m = P.trackMotion(tr);
        if (tr.truth && tr.truth.startsWith('parkir')) stats.parkedSpeed.push(m.speed);
        if (tr.truth && tr.truth.startsWith('penyeberang') && m.speed > 0.8) stats.pedSpeedSd.push(m.speedSd);
        if (tr.conf >= 0.5 && P.predictable(tr)) {
          cands.push({ track: tr, cls: tr.cls, halfWidth: tr.cls === 'pedestrian' || tr.cls === 'cyclist' ? 0.35 : tr.size.width / 2 });
        }
      }
      const c = P.findConflict(cands, corridor, P.HORIZON);
      if (c && !c.inPath) { stats.conflicts++; if (stats.firstConflictAt == null) stats.firstConflictAt = +t.toFixed(1); }
      if (c && c.inPath) stats.inPath++;
      if (c && (!lastConf || lastConf.track !== c.track || lastConf.inPath !== c.inPath)) log.push({ t: +t.toFixed(1), cls: c.cls, tau: +c.tau.toFixed(1), inPath: c.inPath, truth: c.track.truth });
      lastConf = c;
      // pemeriksaan per-frame fusi
      const L = perc.last;
      stats.samples++;
      for (const f of L.fused) {
        if (f.truth != null && f.conf < 0.5) {
          const k = f.truth.split('-')[0] + (f.x < ego.x ? ':belakang' : ':depan') + ':' + [...f.sensors].sort().join('+');
          stats.filtered50[k] = (stats.filtered50[k] || 0) + 1;
          stats.filteredReal50++;
        }
        if (f.truth != null && f.x > ego.x - 3 && f.x < ego.x + 44) { if (f.conf >= 0.9) stats.reportedReal90++; else stats.filteredReal90++; }
        if (f.truth == null && f.conf >= 0.2) stats.fpShown20++;
      }
      for (const r of L.rejected) { if (r.truth != null) { stats.rejectedReal++; const tr = r.truth; const cs = L.camera.dets.filter(d => d.truth === tr).length; const ls = L.lidar.dets.filter(d => d.truth === tr).length; const obj = r.members[0].target; stats.rejectedWhy = stats.rejectedWhy || []; if (stats.rejectedWhy.length < 8) stats.rejectedWhy.push({ t: +scene.state.time.toFixed(1), truth: tr, cam: cs, lid: ls, dx: +(obj.x - ego.x).toFixed(1), y: +obj.y.toFixed(1), rx: +r.x.toFixed(1), ry: +r.y.toFixed(1), camDet: L.camera.dets.filter(d => d.truth === tr).map(d => [+d.x.toFixed(1), +d.y.toFixed(1)]), lidDet: L.lidar.dets.filter(d => d.truth === tr).map(d => [+d.x.toFixed(1), +d.y.toFixed(1), d.points]) }); } }
      stats.ghostsRejected = perc.stats.rejectedTotal;
    }
  }
  const avg = (a) => a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(3) : null;
  const max = (a) => a.length ? +Math.max(...a).toFixed(3) : null;
  stats.parkedSpeedAvg = avg(stats.parkedSpeed); stats.parkedSpeedMax = max(stats.parkedSpeed); delete stats.parkedSpeed;
  stats.pedSpeedSdAvg = avg(stats.pedSpeedSd); stats.pedSpeedSdMax = max(stats.pedSpeedSd); delete stats.pedSpeedSd;
  stats.egoX = +scene.ego.x.toFixed(1);
  return { stats, log: log.slice(0, 40) };
}
"""

with Session() as s:
    s.go("#/", 300)
    res = s.page.evaluate(JS, [SECONDS, NOISE])
    res["errors"] = s.errors
    dump(res)
