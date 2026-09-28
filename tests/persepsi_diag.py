"""Diagnosis pelacak Persepsi: konflik palsu, pertukaran jejak, dan jejak penyeberang.

Pemakaian: python3 tests/persepsi_diag.py [detik] [derau]
"""
import sys
sys.path.insert(0, "/Users/mcdonny/Downloads/ndur/driverless-sim/tests")
from persepsi_util import Session, dump  # noqa: E402

SECONDS = float(sys.argv[1]) if len(sys.argv) > 1 else 120
NOISE = float(sys.argv[2]) if len(sys.argv) > 2 else 1

JS = """
async ([seconds, noise]) => {
  const { createScene, LANE_Y } = await import('/js/lessons/persepsi/scene.js?' + Date.now());
  const P = await import('/js/lessons/persepsi/perception.js?' + Date.now());
  const scene = createScene({ seed: 11 });
  const perc = P.createPerception({ seed: 23 });
  perc.setNoise(noise);
  const dt = 1 / 60;
  let acc = 0;
  const out = { falseConflicts: [], truthSwaps: [], crosserTracks: {}, fastParked: [], ghostRejectedReal: 0, manual: null };
  const lastTruth = new Map();
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    scene.update(dt);
    acc += dt;
    if (acc < P.SCAN_DT - 1e-9) continue;
    acc -= P.SCAN_DT;
    perc.tick(scene.world(), P.SCAN_DT);
    const t = +scene.state.time.toFixed(1);
    const ego = scene.ego;
    const x0 = ego.x + ego.length / 2;
    const corridor = { x0, x1: x0 + 35, y: LANE_Y, half: ego.width / 2 + 0.6 };
    const cands = [];
    for (const tr of perc.tracks) {
      if (!tr.confirmed) continue;
      const prev = lastTruth.get(tr.id);
      if (prev && tr.truth && prev !== tr.truth && out.truthSwaps.length < 12) out.truthSwaps.push({ t, id: tr.id, from: prev, to: tr.truth });
      if (tr.truth) lastTruth.set(tr.id, tr.truth);
      const m = P.trackMotion(tr);
      if (tr.truth && tr.truth.startsWith('penyeberang')) {
        const k = tr.truth;
        out.crosserTracks[k] = out.crosserTracks[k] || new Set();
        out.crosserTracks[k].add(tr.id);
      }
      if (tr.truth && tr.truth.startsWith('parkir') && m.speed > 1.5 && out.fastParked.length < 8) {
        out.fastParked.push({ t, id: tr.id, truth: tr.truth, age: +tr.age.toFixed(1), speed: +m.speed.toFixed(2), sd: +m.speedSd.toFixed(2), vx: +tr.x[2].toFixed(2), vy: +tr.x[3].toFixed(2), sensors: tr.last ? [...tr.last.sensors].join('+') : 'miss', dx: +(tr.x[0] - ego.x).toFixed(1) });
      }
      if (tr.conf >= 0.5 && P.predictable(tr)) cands.push({ track: tr, cls: tr.cls, halfWidth: tr.cls === 'pedestrian' || tr.cls === 'cyclist' ? 0.35 : tr.size.width / 2 });
    }
    const c = P.findConflict(cands, corridor, P.HORIZON);
    if (c && c.cls !== 'pedestrian' && out.falseConflicts.length < 10) {
      const tr = c.track; const m = P.trackMotion(tr);
      out.falseConflicts.push({ t, truth: tr.truth, cls: c.cls, tau: +c.tau.toFixed(1), inPath: c.inPath, x: +(tr.x[0] - ego.x).toFixed(1), y: +tr.x[1].toFixed(2), vx: +tr.x[2].toFixed(2), vy: +tr.x[3].toFixed(2), sd: +m.speedSd.toFixed(2), age: +tr.age.toFixed(1), sensors: tr.last ? [...tr.last.sensors].join('+') : 'miss' });
    }
    for (const r of perc.last.rejected) if (r.truth != null) out.ghostRejectedReal++;
  }
  for (const k of Object.keys(out.crosserTracks)) out.crosserTracks[k] = [...out.crosserTracks[k]];
  return out;
}
"""

with Session() as s:
    s.go("#/", 300)
    res = s.page.evaluate(JS, [SECONDS, NOISE])
    res["errors"] = s.errors
    dump(res)
