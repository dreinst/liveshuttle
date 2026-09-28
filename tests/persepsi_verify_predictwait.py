"""Berapa lama pelajar menunggu tugas Prediksi bila langkah 5 dibuka pada saat acak?
Model dijalankan seperti di pelajaran (persepsi 10 Hz, ambang 50%, koridor 35 m)."""
import json
import sys

from playwright.sync_api import sync_playwright
from persepsi_verify_util import CHROME, BASE

SIM = float(sys.argv[1]) if len(sys.argv) > 1 else 400
JS = r"""
async ({ sim, seed }) => {
  const { loadMap } = await import('/js/engine/osm2d.js');
  const { buildStreet } = await import('/js/lessons/persepsi/street.js');
  const { createScene } = await import('/js/lessons/persepsi/scene.js');
  const P = await import('/js/lessons/persepsi/perception.js');
  const map = await loadMap('machung');
  const street = buildStreet(map);
  const scene = createScene({ street, seed: 11 });
  const perc = P.createPerception({ seed: 23 });
  const DT = 1 / 60;
  const hold = [];
  let acc = 0, lastLap = 0;
  perc.tick(scene.world());
  const halfWidth = (t) => (t.cls === 'pedestrian' || t.cls === 'cyclist' ? 0.35 : t.cls === 'motor' ? 0.36 : t.size.width / 2);
  const N = Math.round(sim / DT);
  const who = [];
  for (let i = 0; i < N; i++) {
    scene.update(DT);
    if (scene.state.lap !== lastLap) { lastLap = scene.state.lap; perc.restart(); acc = 0; perc.tick(scene.world()); }
    else { acc += DT; while (acc >= P.SCAN_DT - 1e-9) { acc -= P.SCAN_DT; perc.tick(scene.world(), P.SCAN_DT); } }
    const ego = scene.ego;
    const s0 = ego.s + ego.length / 2;
    const cor = { frenet: (x, y, h) => street.frenet(x, y, h, 60), heading: street.heading, s0, s1: s0 + 35, d: ego.d, half: ego.width / 2 + 0.45, egoSpeed: ego.v };
    const cands = perc.tracks.filter((t) => t.confirmed && Math.round(t.conf * 100) >= 50 && P.predictable(t)).map((t) => ({ track: t, cls: t.cls, halfWidth: halfWidth(t) }));
    const c = P.findConflict(cands, cor, P.HORIZON);
    const ok = !!c && !c.inPath && c.cls === 'pedestrian';
    hold.push(ok ? 1 : 0);
    if (ok && (!who.length || scene.state.time - who[who.length - 1].t > 5)) who.push({ t: +scene.state.time.toFixed(1), truth: c.track.truth, s: +ego.s.toFixed(0) });
  }
  // waktu tuntas dari tiap saat masuk (tahan 0,4 detik)
  const need = Math.round(0.4 / DT);
  const waits = [];
  for (let t0 = 0; t0 < N - 1; t0 += Math.round(5 / DT)) {
    let run = 0, w = null;
    for (let i = t0; i < N; i++) { run = hold[i] ? run + 1 : 0; if (run >= need) { w = +((i - t0) * DT).toFixed(1); break; } }
    waits.push({ t0: +(t0 * DT).toFixed(0), wait: w });
  }
  return { waits, events: who, laps: scene.state.lap };
}
"""
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, headless=True)
    pg = b.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(BASE + "tests/persepsi_verify_blank.html")
    r = pg.evaluate(JS, {"sim": SIM, "seed": 11})
    b.close()
ws = [w["wait"] for w in r["waits"] if w["wait"] is not None]
none = [w["t0"] for w in r["waits"] if w["wait"] is None]
ws.sort()
print(json.dumps({"events": r["events"], "laps": r["laps"], "n": len(r["waits"]), "never": none,
                  "median": ws[len(ws)//2] if ws else None, "p90": ws[int(len(ws)*0.9)] if ws else None, "max": max(ws) if ws else None,
                  "waits": r["waits"], "errors": errs}, ensure_ascii=False))
