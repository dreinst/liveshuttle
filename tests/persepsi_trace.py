"""Lacak satu objek (berdasarkan id kunci jawaban) di pipeline Persepsi dari waktu ke waktu.

Pemakaian: python3 tests/persepsi_trace.py TRUTH_ID T0 T1
"""
import sys
sys.path.insert(0, "/Users/mcdonny/Downloads/ndur/driverless-sim/tests")
from persepsi_util import Session, dump  # noqa: E402

TRUTH = sys.argv[1]
T0 = float(sys.argv[2])
T1 = float(sys.argv[3])

JS = """
async ([truth, t0, t1]) => {
  const { createScene } = await import('/js/lessons/persepsi/scene.js?' + Date.now());
  const P = await import('/js/lessons/persepsi/perception.js?' + Date.now());
  const scene = createScene({ seed: 11 });
  const perc = P.createPerception({ seed: 23 });
  const dt = 1 / 60;
  let acc = 0;
  const rows = [];
  const r2 = (v) => Math.round(v * 100) / 100;
  for (let i = 0; i < Math.round(t1 / dt); i++) {
    scene.update(dt);
    acc += dt;
    if (acc < P.SCAN_DT - 1e-9) continue;
    acc -= P.SCAN_DT;
    perc.tick(scene.world(), P.SCAN_DT);
    const t = scene.state.time;
    if (t < t0) continue;
    const obj = scene.world().relevant.find((o) => o.id === truth);
    const L = perc.last;
    const f = L.fused.filter((g) => g.members.some((m) => m.truth === truth)).map((g) => ({ x: r2(g.x - scene.ego.x), y: r2(g.y), s: [...g.sensors].join('+'), mem: g.members.map((m) => m.sensor[0] + ':' + (m.truth || 'null') + '@' + r2(m.y)).join(' ') }));
    const tr = perc.tracks.filter((k) => k.truth === truth).map((k) => ({ id: k.id, x: r2(k.x[0] - scene.ego.x), y: r2(k.x[1]), vx: r2(k.x[2]), vy: r2(k.x[3]), c: k.confirmed, miss: k.misses, last: k.last ? [...k.last.sensors].join('+') : '-' }));
    rows.push({ t: r2(t), true: obj ? [r2(obj.x - scene.ego.x), r2(obj.y)] : null, fused: f, tracks: tr });
  }
  return rows;
}
"""

with Session() as s:
    s.go("#/", 300)
    rows = s.page.evaluate(JS, [TRUTH, T0, T1])
    for r in rows:
        print(r)
