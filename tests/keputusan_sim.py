"""Uji tanpa peramban untuk model pelajaran Pengambilan Keputusan (butuh Node.js).

Menjalankan dunia dan perencana langsung di Node selama 15 menit waktu simulasi untuk setiap
kombinasi kepadatan lalu lintas (kosong sampai padat) dan kecepatan target (20, 40, 60 km/jam),
dengan lampu otomatis, mobil mogok, dan pejalan kaki yang muncul berkala. Memeriksa tidak ada
tabrakan, tidak ada rem darurat, jarak aman saat menyalip, dan mobil tidak macet di satu keadaan.
Pemakaian: python3 tests/keputusan_sim.py
"""
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LESSON = os.path.join(ROOT, "js", "lessons", "keputusan")

JS = r"""
const root = process.argv[1];
const { createWorld } = await import(root + '/world.js');
const { createPlanner } = await import(root + '/planner.js');
const { boxesOverlap } = await import(root + '/../../engine/geometry.js');
const dt = 1 / 60;
const out = [];
for (const density of ['kosong', 'sepi', 'sedang', 'padat']) for (const kmh of [20, 40, 60]) {
  const w = createWorld(); const p = createPlanner(w);
  w.signal.mode = 'otomatis'; w.setDensity(density); w.stalled.active = true; p.setTarget(kmh / 3.6);
  w.reset(0, kmh / 3.6); p.reset();
  const r = { density, kmh, collisions: 0, aeb: 0, overtakes: 0, yields: 0, redStops: 0, minClearance: 99, maxInState: 0, distance: 0 };
  let cur = p.P.state, since = 0;
  for (let i = 0; i < 60 * 900; i++) {
    if (i % (60 * 37) === 0) w.spawnPed();
    const x0 = w.ego.x;
    w.update(dt, p);
    let dx = w.ego.x - x0; if (dx < -100) dx += 280; r.distance += dx;
    if (p.P.state !== cur) { r.maxInState = Math.max(r.maxInState, since); cur = p.P.state; since = 0; } else since += dt;
    const k = Math.round((w.ego.x - 225) / 280);
    if (k >= w.stalled.fromK) {
      const b = w.stallBox(k);
      if (Math.abs(b.x - w.ego.x) < 16) {
        let m = 0; while (m < 3 && !boxesOverlap(w.ego, b, m + 0.05)) m += 0.05;
        r.minClearance = Math.min(r.minClearance, m);
      }
    }
    for (const e of p.drainEvents()) {
      if (e.type === 'bahaya') r.aeb++;
      if (e.type === 'salip-selesai') r.overtakes++;
      if (e.type === 'yield-selesai') r.yields++;
      if (e.type === 'transisi' && e.to === 'lampu') r.redStops++;
    }
    for (const e of w.drainEvents()) if (e.type === 'tabrakan') r.collisions++;
  }
  r.maxInState = Math.max(r.maxInState, since);
  r.distance = Math.round(r.distance); r.maxInState = +r.maxInState.toFixed(1); r.minClearance = +r.minClearance.toFixed(2);
  out.push(r);
}
console.log(JSON.stringify(out));
"""


def main():
    proc = subprocess.run(["node", "--input-type=module", "-e", JS, LESSON], capture_output=True, text=True, timeout=600)
    if proc.returncode != 0:
        print(proc.stderr)
        sys.exit(1)
    rows = json.loads(proc.stdout.strip().splitlines()[-1])
    ok = True
    for r in rows:
        bad = r["collisions"] or r["aeb"] or r["minClearance"] < 1.0 or r["maxInState"] > 45 or r["overtakes"] < 5
        ok = ok and not bad
        print(("GAGAL " if bad else "ok    ") + json.dumps(r))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
