"""Siapa saja yang memicu peringatan prediksi (spanduk merah) dan berapa lama, per peran pejalan kaki.
Model dijalankan seperti di pelajaran (persepsi 10 Hz, ambang 50%)."""
import json
import sys

from playwright.sync_api import sync_playwright
from persepsi_verify_util import CHROME, BASE

SIM = float(sys.argv[1]) if len(sys.argv) > 1 else 400
SEEDS = [int(x) for x in sys.argv[2].split(",")] if len(sys.argv) > 2 else [11]
JS = r"""
async ({ sim, seed }) => {
  const { loadMap } = await import('/js/engine/osm2d.js');
  const { buildStreet } = await import('/js/lessons/persepsi/street.js');
  const { createScene } = await import('/js/lessons/persepsi/scene.js');
  const P = await import('/js/lessons/persepsi/perception.js');
  const map = await loadMap('machung');
  const street = buildStreet(map);
  const scene = createScene({ street, seed });
  const perc = P.createPerception({ seed: 23 });
  const DT = 1 / 60;
  let acc = 0, lastLap = 0;
  perc.tick(scene.world());
  const halfWidth = (t) => (t.cls === 'pedestrian' || t.cls === 'cyclist' ? 0.35 : t.cls === 'motor' ? 0.36 : t.size.width / 2);
  const N = Math.round(sim / DT);
  const ev = new Map();
  for (let i = 0; i < N; i++) {
    scene.update(DT);
    if (scene.state.lap !== lastLap) { lastLap = scene.state.lap; perc.restart(); acc = 0; perc.tick(scene.world()); }
    else { acc += DT; while (acc >= P.SCAN_DT - 1e-9) { acc -= P.SCAN_DT; perc.tick(scene.world(), P.SCAN_DT); } }
    const ego = scene.ego;
    const s0 = ego.s + ego.length / 2;
    const cor = { frenet: (x, y, h) => street.frenet(x, y, h, 60), heading: street.heading, s0, s1: s0 + 35, d: ego.d, half: ego.width / 2 + 0.45, egoSpeed: ego.v };
    const cands = perc.tracks.filter((t) => t.confirmed && Math.round(t.conf * 100) >= 50 && P.predictable(t)).map((t) => ({ track: t, cls: t.cls, halfWidth: halfWidth(t) }));
    const c = P.findConflict(cands, cor, P.HORIZON);
    if (!c) continue;
    const id = c.track.truth;
    const obj = [...scene.peds, ...scene.traffic].find((o) => o.id === id);
    const key = id + (c.inPath ? '|in' : '|pred');
    let e = ev.get(key);
    if (!e) { e = { id, cls: c.cls, inPath: c.inPath, role: obj?.role, state: obj?.state, d: obj ? +obj.d.toFixed(2) : null, vd: obj ? +(obj.vd || 0).toFixed(2) : null,
      tvd: null, t0: +scene.state.time.toFixed(1), dur: 0, tau: +c.tau.toFixed(1) }; ev.set(key, e);
      const h = street.heading(ego.s); e.tvd = +(c.track.x[2] * Math.sin(h) - c.track.x[3] * Math.cos(h)).toFixed(2); }
    e.dur += DT;
  }
  return [...ev.values()].map((e) => ({ ...e, dur: +e.dur.toFixed(1) }));
}
"""
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, headless=True)
    pg = b.new_page()
    pg.goto(BASE + "tests/persepsi_verify_blank.html")
    allev = []
    for sd in SEEDS:
        r = pg.evaluate(JS, {"sim": SIM, "seed": sd})
        for e in r:
            e["seed"] = sd
        allev += r
    b.close()
from collections import defaultdict
agg = defaultdict(lambda: [0, 0.0])
for e in allev:
    k = f"{e['cls']}|{e['role']}|{'in' if e['inPath'] else 'pred'}"
    agg[k][0] += 1
    agg[k][1] += e["dur"]
print(json.dumps({k: {"n": v[0], "sec": round(v[1], 1)} for k, v in agg.items()}, ensure_ascii=False, indent=1))
for e in allev:
    if e["role"] != "crosser" and not e["inPath"]:
        print(e)
