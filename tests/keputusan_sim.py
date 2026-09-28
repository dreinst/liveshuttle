"""Uji perilaku tanpa peramban untuk model pelajaran Pengambilan Keputusan di Jalan Kawi (butuh Node.js).

Menjalankan scene.js, world.js, dan planner.js langsung di Node dengan data OSM asli selama 10 menit waktu
simulasi untuk setiap kombinasi kepadatan lalu lintas (kosong sampai padat) dan kecepatan target
(20, 35, 50 km/jam), dengan lampu otomatis, angkot ngetem, dan pejalan kaki uji yang diminta berkala.
Memeriksa: tidak ada tabrakan, tidak ada rem darurat, perisai tidak perlu ikut mengerem mobil otonom,
jarak bebas saat menyalip angkot, perlambatan tetap nyaman, mobil terus berputar (tidak macet di satu
keadaan), dan setiap putaran ada kejadian lampu, pejalan kaki, dan menyalip.
Pemakaian: python3 tests/keputusan_sim.py
"""
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

JS = r"""
import { readFileSync } from 'fs';
const root = process.argv[1];
const L = root + '/js/lessons/keputusan/';
const { buildScene } = await import(L + 'scene.js');
const { createWorld } = await import(L + 'world.js');
const { createPlanner } = await import(L + 'planner.js');
const { boxesOverlap } = await import(root + '/js/engine/geometry.js');
const scene = buildScene(JSON.parse(readFileSync(root + '/js/data/malang-center.json', 'utf8')));
const S = scene.S;
const dt = 1 / 60;
const out = [];
for (const density of ['kosong', 'sepi', 'sedang', 'padat']) for (const kmh of [20, 35, 50]) {
  const w = createWorld(scene);
  const p = createPlanner(w);
  w.signal.mode = 'otomatis';
  w.density = density;
  w.angkot.active = true;
  p.setTarget(kmh / 3.6);
  w.reset(S.start, kmh / 3.6);
  p.reset();
  const r = { density, kmh, collisions: 0, aeb: 0, overtakes: 0, yields: 0, redStops: 0, wraps: 0, minClearance: 99, maxInState: 0, maxInStateName: '', maxDecel: 0 };
  let cur = p.P.state, since = 0;
  for (let i = 0; i < 60 * 600; i++) {
    if (i % (60 * 29) === 0) w.requestPed();
    w.update(dt, p);
    if (p.P.state !== cur) {
      if (since > r.maxInState) { r.maxInState = +since.toFixed(1); r.maxInStateName = cur; }
      if (p.P.state === 'lampu') r.redStops++;
      cur = p.P.state;
      since = 0;
    } else since += dt;
    if (w.angkot.active && Math.abs(w.angkot.x - w.ego.x) < 12) {
      const A = w.worldBox(w.angkot), E = w.worldBox(w.ego);
      let m = 0;
      while (m < 3 && !boxesOverlap(A, E, m + 0.05)) m += 0.05;
      r.minClearance = Math.min(r.minClearance, +m.toFixed(2));
    }
    if (w.ego.speed > 1) r.maxDecel = Math.max(r.maxDecel, +(-w.ego.accel).toFixed(2));
    for (const e of p.drainEvents()) {
      if (e.type === 'bahaya') r.aeb++;
      if (e.type === 'salip-selesai') r.overtakes++;
      if (e.type === 'yield-selesai') r.yields++;
    }
    for (const e of w.drainEvents()) if (e.type === 'tabrakan') r.collisions++;
  }
  r.wraps = w.wraps;
  r.egoInterventions = w.counters.egoInterventions;
  r.otherCollisions = w.counters.otherCollisions;
  r.redRuns = w.counters.redRuns;
  r.pedContacts = w.counters.pedContacts;
  out.push(r);
}
console.log(JSON.stringify(out));
"""


def main():
    proc = subprocess.run(["node", "--input-type=module", "-e", JS, ROOT], capture_output=True, text=True, timeout=1800)
    if proc.returncode != 0:
        print(proc.stderr)
        sys.exit(1)
    rows = json.loads(proc.stdout.strip().splitlines()[-1])
    bad = []
    for r in rows:
        print(json.dumps(r, ensure_ascii=False))
        if r["collisions"] or r["otherCollisions"] or r["aeb"] or r["redRuns"] or r["pedContacts"] or r["egoInterventions"]:
            bad.append((r["density"], r["kmh"], "tabrakan, rem darurat, pelanggaran, atau perisai ikut mengerem"))
        if r["wraps"] < 3 or r["overtakes"] < 2 or r["yields"] < 2:
            bad.append((r["density"], r["kmh"], f"kurang bergerak: {r['wraps']} putaran, {r['overtakes']} salip, {r['yields']} beri jalan"))
        if r["minClearance"] < 0.8:
            bad.append((r["density"], r["kmh"], f"jarak bebas saat menyalip {r['minClearance']} m"))
        if r["maxDecel"] > 3.6:
            bad.append((r["density"], r["kmh"], f"perlambatan terbesar {r['maxDecel']} m/s2"))
        if r["maxInState"] > 90:
            bad.append((r["density"], r["kmh"], f"tertahan {r['maxInState']} detik di {r['maxInStateName']}"))
    print("MASALAH:" if bad else "LULUS", bad if bad else "")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
