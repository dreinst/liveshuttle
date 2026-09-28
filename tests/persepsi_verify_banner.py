"""Berapa sering spanduk peringatan prediksi hanya berkedip sebentar? Menghitung episode spanduk
(teks peringatan tidak kosong, berganti teks dihitung episode baru) dan durasinya, di model yang
dijalankan seperti di pelajaran (persepsi 10 Hz, ambang 50%, Prediksi menyala)."""
import json
import sys

from playwright.sync_api import sync_playwright
from persepsi_verify_util import CHROME, BASE

SIM = float(sys.argv[1]) if len(sys.argv) > 1 else 400
SEEDS = [int(x) for x in sys.argv[2].split(",")] if len(sys.argv) > 2 else [11, 24, 37]
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
  const eps = [];
  let cur = null;
  for (let i = 0; i < N; i++) {
    scene.update(DT);
    if (scene.state.lap !== lastLap) { lastLap = scene.state.lap; perc.restart(); acc = 0; perc.tick(scene.world()); }
    else { acc += DT; while (acc >= P.SCAN_DT - 1e-9) { acc -= P.SCAN_DT; perc.tick(scene.world(), P.SCAN_DT); } }
    const ego = scene.ego;
    const s0 = ego.s + ego.length / 2;
    const cor = { frenet: (x, y, h) => street.frenet(x, y, h, 60), heading: street.heading, s0, s1: s0 + 35, d: ego.d, half: ego.width / 2 + 0.45, egoSpeed: ego.v };
    const cands = perc.tracks.filter((t) => t.confirmed && Math.round(t.conf * 100) >= 50 && P.predictable(t)).map((t) => ({ track: t, cls: t.cls, halfWidth: halfWidth(t) }));
    const c = P.findConflict(cands, cor, P.HORIZON);
    const key = c ? c.cls + (c.inPath ? ':in' : ':pred') : '';
    if (cur && cur.key !== key) { eps.push(cur); cur = null; }
    if (key && !cur) cur = { key, t0: scene.state.time, dur: 0, id: c.track.truth };
    if (cur) cur.dur += DT;
  }
  if (cur) eps.push(cur);
  return eps.map((e) => ({ ...e, t0: +e.t0.toFixed(1), dur: +e.dur.toFixed(2) }));
}
"""
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, headless=True)
    pg = b.new_page()
    pg.goto(BASE + "tests/persepsi_verify_blank.html")
    eps = []
    for sd in SEEDS:
        eps += pg.evaluate(JS, {"sim": SIM, "seed": sd})
    b.close()
short = [e for e in eps if e["dur"] < 0.35]
print(json.dumps({"episodes": len(eps), "short(<0,35 s)": len(short), "perMinute": round(len(eps) / (SIM * len(SEEDS) / 60), 1),
                  "shortPerMinute": round(len(short) / (SIM * len(SEEDS) / 60), 2), "shortByKey": {k: sum(1 for e in short if e["key"] == k) for k in set(e["key"] for e in short)},
                  "sample": short[:12]}, ensure_ascii=False, indent=1))
