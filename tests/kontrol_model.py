"""Uji empiris model pelajaran Kendali (js/lessons/kontrol/sim.js) dengan Node, tanpa peramban.

Memeriksa klaim yang dipakai di teks pelajaran:
  1. Lookahead 1 sampai 3 m pada 40 km/jam atau lebih: mobil berayun dan ayunannya membesar
     (tidak stabil) sampai pengemudi cadangan mengambil alih.
  2. Lookahead 5 sampai 12 m pada 30 sampai 50 km/jam: RMS galat satu putaran di bawah 0,3 m.
  3. Lookahead 15 m atau lebih: mobil memotong sisi dalam tikungan (>= 0,6 m), tanpa pengambilalihan.
  4. PID bawaan: overshoot dari diam ke 40 km/jam di bawah 5%. Ki 1: di atas 10%.
     Hanya Kp (Ki 0): kecepatan berhenti di bawah target.
  5. Tidak ada pengambilalihan palsu untuk pengaturan wajar (termasuk mode adaptif dan pelan di tikungan).

Pemakaian: python3 tests/kontrol_model.py   (butuh node 22 atau lebih baru)
"""
import json
import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LESSON = os.path.join(ROOT, "js", "lessons", "kontrol")

SCRIPT = r"""
import { buildTrack, curvatureAt } from '%(lesson)s/track.js';
import { createSim } from '%(lesson)s/sim.js';
const track = buildTrack();
function run(set, seconds, onStep) {
  const sim = createSim(track);
  Object.assign(sim.settings, set);
  sim.reset();
  const laps = [];
  let last = 0;
  for (let i = 0; i < seconds * 60; i++) {
    if (onStep) onStep(sim, i);
    sim.step(1 / 60);
    const l = sim.state.lastLap;
    if (l && l.index !== last) { last = l.index; laps.push(l); }
  }
  return { sim, laps };
}
const out = { track: { length: track.length, minRadius: 1 / Math.max(...track.curvature.map(Math.abs)) } };

// 1. lookahead pendek: ayunan membesar lalu diambil alih
out.small = [];
for (const [ld, v] of [[1, 40], [2, 40], [3, 40], [3, 50]]) {
  let firstTk = null, maxSwings = 0; const peaks = [];
  run({ ld, targetKmh: v }, 40, (sim) => {
    const st = sim.state;
    if (firstTk == null && st.takeover) firstTk = st.time;
    if (firstTk == null) maxSwings = Math.max(maxSwings, sim.swingSummary(6, 0.3).swings);
  });
  // pertumbuhan: simpangan puncak sebelum pengambilalihan pertama
  run({ ld, targetKmh: v }, 40, (sim) => {
    const st = sim.state;
    if (st.takeovers === 0 && st.time > 5) peaks.push(Math.abs(st.cte));
  });
  const q = Math.floor(peaks.length / 3);
  const early = Math.max(0, ...peaks.slice(0, q));
  const late = Math.max(0, ...peaks.slice(2 * q));
  out.small.push({ ld, v, firstTakeover: firstTk, swingsBefore: maxSwings, earlyPeak: early, latePeak: late });
}

// 2. lookahead pas
out.tuned = [];
for (const v of [30, 40, 50]) for (const ld of [5, 7, 10, 12]) {
  const r = run({ ld, targetKmh: v }, 100);
  const full = r.laps.filter((l) => !l.takeover).slice(-1)[0];
  out.tuned.push({ ld, v, rms: full ? full.rms : null, avg: full ? full.avgKmh : null, takeovers: r.sim.state.takeovers });
}

// 3. lookahead panjang: memotong ke sisi dalam
out.large = [];
for (const v of [20, 30, 40, 50]) for (const ld of [15, 20]) {
  let inside = 0;
  const r = run({ ld, targetKmh: v }, 60, (sim) => {
    const st = sim.state;
    if (st.time > 10 && Math.abs(st.curvatureHere) > 0.01 && Math.sign(st.curvatureHere) === Math.sign(st.cte)) inside = Math.max(inside, Math.abs(st.cte));
  });
  out.large.push({ ld, v, maxInside: inside, takeovers: r.sim.state.takeovers });
}

// 4. PID dari diam ke 40 km/jam
out.pid = [];
for (const g of [{ kp: 0.8, ki: 0.2, kd: 0 }, { kp: 0.8, ki: 1, kd: 0 }, { kp: 0.5, ki: 0, kd: 0 }, { kp: 1.2, ki: 0.3, kd: 0 }]) {
  const r = run({ ...g, targetKmh: 40, ld: 8 }, 30);
  const ep = r.sim.state.episode;
  out.pid.push({ ...g, overshoot: ep.overshoot, reachedAt: ep.reachedAt, endKmh: r.sim.ego.speed * 3.6 });
}

// 5. tidak ada pengambilalihan palsu
out.falseTakeovers = [];
for (const v of [10, 30, 50]) for (const ld of [5, 10, 20]) for (const curveSlow of [false, true]) {
  const r = run({ ld, targetKmh: v, curveSlow }, 50);
  if (r.sim.state.takeovers) out.falseTakeovers.push({ ld, v, curveSlow });
}
for (const v of [20, 40, 50]) for (const k of [0.6, 1, 2]) {
  const r = run({ adaptive: true, k, targetKmh: v }, 50);
  if (r.sim.state.takeovers) out.falseTakeovers.push({ k, v });
}
console.log(JSON.stringify(out));
"""


def main():
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "kontrol_check.mjs")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(SCRIPT % {"lesson": LESSON})
        res = subprocess.run(["node", path], capture_output=True, text=True, timeout=600)
    if res.returncode != 0:
        print(res.stderr)
        sys.exit(2)
    out = json.loads(res.stdout)
    fails = []

    for r in out["small"]:
        if r["firstTakeover"] is None:
            fails.append(f"Ld {r['ld']} m @ {r['v']} km/jam tidak kehilangan kestabilan")
        if r["latePeak"] <= r["earlyPeak"]:
            fails.append(f"Ld {r['ld']} m @ {r['v']} km/jam: ayunan tidak membesar")
    if not any(r["swingsBefore"] >= 2 for r in out["small"] if r["ld"] == 3):
        fails.append("Ld 3 m tidak memperlihatkan ayunan yang terlihat sebelum diambil alih")
    for r in out["tuned"]:
        if r["takeovers"] or r["rms"] is None or r["rms"] >= 0.3:
            fails.append(f"Ld {r['ld']} m @ {r['v']} km/jam: RMS {r['rms']} (harus < 0,3 m tanpa pengambilalihan)")
    for r in out["large"]:
        if r["takeovers"] or r["maxInside"] < 0.6:
            fails.append(f"Ld {r['ld']} m @ {r['v']} km/jam: potong tikungan {r['maxInside']:.2f} m")
    pid = {(p["kp"], p["ki"]): p for p in out["pid"]}
    if pid[(0.8, 0.2)]["overshoot"] >= 0.05:
        fails.append("PID bawaan overshoot >= 5%")
    if pid[(0.8, 1)]["overshoot"] <= 0.10:
        fails.append("Ki 1 tidak memberi overshoot > 10%")
    if pid[(0.5, 0)]["endKmh"] > 39.5:
        fails.append("Kp saja tidak menyisakan selisih kecepatan")
    if out["falseTakeovers"]:
        fails.append(f"pengambilalihan palsu: {out['falseTakeovers']}")

    print(json.dumps(out, indent=1))
    print("\nGAGAL:\n  " + "\n  ".join(fails) if fails else "\nSemua pemeriksaan model lulus.")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
