"""Uji empiris model pelajaran Kendali (js/lessons/kontrol/sim.js) dengan Node, tanpa peramban.

Lintasan dibangun dari peta OpenStreetMap js/data/machung-2d.json (boulevard Villa Puncak Tidar)
dengan track.js yang sama dengan pelajaran. Yang diperiksa (klaim di teks pelajaran):
  1. Lintasan: tertutup, sekitar 890 m, dua zona bundaran, jalur acuan tidak menempel ke pulau
     bundaran, garis start sekitar 280 m sebelum zona bundaran timur.
  2. Lookahead 2 sampai 3 m pada 40 km/jam atau lebih: pengemudi cadangan mengambil alih dalam
     beberapa detik (mobil berayun), dan saat itu mobil melaju 30 km/jam atau lebih.
  3. Lookahead 5 sampai 10 m pada 40 km/jam: RMS galat satu putaran di bawah 0,3 m tanpa
     pengambilalihan. Rata-rata kecepatan dicatat.
  4. Lookahead 15 m atau lebih: mobil memotong sisi dalam tikungan di bundaran pertama (>= 0,6 m
     selama 0,4 detik, atau diambil alih saat sedang memotong).
  5. PID dari diam ke 40 km/jam: bawaan overshoot < 5% dan uji selesai sebelum zona bundaran,
     Ki 1 > 10%, Kp saja berhenti di bawah target.
  6. Tidak ada pengambilalihan palsu untuk pengaturan wajar (Ld 6 sampai 10 m, adaptif k 0,5 sampai
     1,4, pelan di tikungan menyala atau mati).
  7. Pengaturan paling ekstrem (Ld 2 m sampai 20 m, 10 sampai 50 km/jam): simpangan terbesar
     sumbu roda belakang tetap di bawah 2,5 m dan bodi mobil tidak masuk lebih dari 0,3 m ke
     pulau bundaran (pengemudi cadangan mengambil alih lebih dulu).
  8. Aturan keselamatan: peta 'machung' tidak punya lampu lalu lintas, dan pelajaran tidak membuat
     pejalan kaki, kendaraan lain, atau lampu (diperiksa dari kode sumbernya).

Pemakaian: python3 tests/kontrol_model.py   (butuh node 22 atau lebih baru)
"""
import json
import os
import re
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LESSON = os.path.join(ROOT, "js", "lessons", "kontrol")
ENGINE = os.path.join(ROOT, "js", "engine")
DATA = os.path.join(ROOT, "js", "data", "machung-2d.json")

SCRIPT = r"""
import fs from 'fs';
import { parseMap } from '%(engine)s/osm2d.js';
import { buildTrack, zoneAt } from '%(lesson)s/track.js';
import { createSim, CFG } from '%(lesson)s/sim.js';
const map = parseMap(JSON.parse(fs.readFileSync('%(data)s', 'utf8')));
const track = buildTrack(map);
function run(set, seconds, onStep) {
  const sim = createSim(track);
  Object.assign(sim.settings, set);
  sim.reset();
  const laps = [];
  let last = 0;
  for (let i = 0; i < seconds * 60; i++) {
    sim.step(1 / 60);
    if (onStep) onStep(sim, i);
    const l = sim.state.lastLap;
    if (l && l.index !== last) { last = l.index; laps.push(l); }
  }
  return { sim, laps };
}
const islands = track.roundabouts.map((rb) => ({ x: rb.x, y: rb.y, r: rb.radius - Math.max(...rb.roads.map((r) => r.width)) / 2 - 0.4 }));
const out = {};

// 1. lintasan
let refToIsland = Infinity;
for (const i of islands) for (const p of track.ref.points) refToIsland = Math.min(refToIsland, Math.hypot(p.x - i.x, p.y - i.y) - i.r);
const east = track.zones.reduce((a, z) => (z.s0 < a.s0 ? z : a));
out.track = { length: track.length, zones: track.zones.map((z) => [z.s0, z.s1]), roadWidth: track.roadWidth, refToIsland, startToEastZone: east.s0, signals: map.signals.length, closedGap: Math.hypot(track.ref.points[0].x - track.ref.points[track.ref.points.length - 1].x, track.ref.points[0].y - track.ref.points[track.ref.points.length - 1].y) };

// 2. lookahead pendek, diubah saat mobil sudah melaju 40 atau 50 km/jam
out.small = [];
for (const [ld, v, t0] of [[3, 40, 10], [3, 40, 20], [3, 50, 10], [2, 40, 10], [2.5, 50, 55]]) {
  let tk = null;
  run({ ld: 8, targetKmh: v }, t0 + 20, (sim, i) => {
    if (i === t0 * 60) { sim.settings.ld = ld; sim.notifyTrackingChange(); }
    const t = sim.state.takeover;
    if (i > t0 * 60 && t && !tk) tk = { after: sim.state.time - t0, kmh: t.kmh, reason: t.reason };
  });
  out.small.push({ ld, v, t0, takeover: tk });
}

// 3. lookahead pas
out.tuned = [];
for (const ld of [5, 6, 7, 8, 10]) {
  const r = run({ ld, targetKmh: 40 }, 230);
  const full = r.laps.filter((l) => !l.takeover).slice(-1)[0];
  out.tuned.push({ ld, v: 40, rms: full ? full.rms : null, avg: full ? full.avgKmh : null, lapTime: full ? full.time : null, takeovers: r.sim.state.takeovers });
}

// 4. lookahead panjang: memotong ke sisi dalam di bundaran pertama
out.large = [];
for (const v of [20, 30, 40, 50]) for (const ld of [15, 18, 20]) {
  let at = null, hold = 0, maxInside = 0;
  run({ ld, targetKmh: v }, 90, (sim) => {
    const st = sim.state;
    const k = st.curvatureHere;
    const cut = Math.abs(k) > 0.01 && Math.sign(k) === Math.sign(st.cte) && Math.abs(st.cte) >= 0.6;
    if (cut && !st.takeover) maxInside = Math.max(maxInside, Math.abs(st.cte));
    hold = cut && !st.takeover && sim.ego.speed >= 15 / 3.6 ? hold + 1 / 60 : 0;
    const t = st.takeover;
    if (at == null && (hold >= 0.4 || (t && t.inside && st.time - t.at < 0.05))) at = st.s;
  });
  out.large.push({ ld, v, firstCutAt: at, maxInside });
}

// 5. PID dari diam ke 40 km/jam
out.pid = [];
for (const g of [{ kp: 0.8, ki: 0.2, kd: 0 }, { kp: 0.8, ki: 1, kd: 0 }, { kp: 0.5, ki: 0, kd: 0 }, { kp: 1.2, ki: 0.3, kd: 0 }]) {
  let doneAtS = null;
  const r = run({ ...g, targetKmh: 40, ld: 8 }, 30, (sim) => { if (doneAtS == null && sim.state.episode.done) doneAtS = sim.state.s; });
  const ep = r.sim.state.episode;
  out.pid.push({ ...g, overshoot: ep.overshoot, reachedAt: ep.reachedAt, spoiled: ep.spoiled, doneAtS, endKmh: r.sim.ego.speed * 3.6 });
}

// 6. tidak ada pengambilalihan palsu
out.falseTakeovers = [];
for (const v of [10, 30, 40, 50]) for (const ld of [6, 8, 10]) for (const curveSlow of [false, true]) {
  const r = run({ ld, targetKmh: v, curveSlow }, 120);
  if (r.sim.state.takeovers) out.falseTakeovers.push({ ld, v, curveSlow, n: r.sim.state.takeovers });
}
for (const v of [20, 40, 50]) for (const k of [0.5, 0.7, 1, 1.4]) {
  const r = run({ adaptive: true, k, targetKmh: v }, 120);
  if (r.sim.state.takeovers) out.falseTakeovers.push({ k, v, n: r.sim.state.takeovers });
}

// 7. pengaturan ekstrem
out.extreme = { maxCte: 0, maxCteAt: null, islandIntrusion: -Infinity, intrusionAt: null };
for (const v of [10, 20, 30, 40, 50]) for (const ld of [2, 2.5, 3, 15, 18, 20]) for (const kp of [0.8, 5]) {
  run({ ld, targetKmh: v, kp, ki: kp > 1 ? 2 : 0.2 }, 150, (sim) => {
    const c = Math.abs(sim.state.cte);
    if (c > out.extreme.maxCte) { out.extreme.maxCte = c; out.extreme.maxCteAt = { ld, v, kp }; }
    const cs = sim.ego.corners();
    for (const i of islands) for (let a = 0; a < 4; a++) {
      const p = cs[a], q = cs[(a + 1) %% 4];
      const ex = q.x - p.x, ey = q.y - p.y;
      let t = ((i.x - p.x) * ex + (i.y - p.y) * ey) / (ex * ex + ey * ey);
      t = Math.max(0, Math.min(1, t));
      const pen = i.r - Math.hypot(p.x + ex * t - i.x, p.y + ey * t - i.y);
      if (pen > out.extreme.islandIntrusion) { out.extreme.islandIntrusion = pen; out.extreme.intrusionAt = { ld, v, kp }; }
    }
  });
}
console.log(JSON.stringify(out));
"""


def main():
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "kontrol_check.mjs")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(SCRIPT % {"lesson": LESSON, "engine": ENGINE, "data": DATA})
        res = subprocess.run(["node", path], capture_output=True, text=True, timeout=1200)
    if res.returncode != 0:
        print(res.stderr)
        sys.exit(2)
    out = json.loads(res.stdout)
    fails = []

    tr = out["track"]
    if not 850 <= tr["length"] <= 930:
        fails.append(f"panjang lintasan {tr['length']:.0f} m, bukan sekitar 890 m")
    if len(tr["zones"]) != 2:
        fails.append(f"jumlah zona bundaran {len(tr['zones'])}, harus 2")
    if tr["refToIsland"] < 2.0:
        fails.append(f"jalur acuan hanya {tr['refToIsland']:.2f} m dari pulau bundaran")
    if not 250 <= tr["startToEastZone"] <= 320:
        fails.append(f"garis start {tr['startToEastZone']:.0f} m sebelum bundaran timur, teks bilang sekitar 280 m")
    if tr["signals"] != 0:
        fails.append("peta machung ternyata punya lampu lalu lintas, teks pelajaran perlu diubah")

    for r in out["small"]:
        t = r["takeover"]
        if not t or t["after"] > 6:
            fails.append(f"Ld {r['ld']} m @ {r['v']} km/jam: tidak diambil alih dalam 6 detik ({t})")
        elif t["kmh"] < 30 and r["t0"] < 60:
            fails.append(f"Ld {r['ld']} m @ {r['v']} km/jam: diambil alih pada {t['kmh']:.0f} km/jam (< 30)")
    for r in out["tuned"]:
        if r["takeovers"] or r["rms"] is None or r["rms"] >= 0.3:
            fails.append(f"Ld {r['ld']} m @ {r['v']} km/jam: RMS {r['rms']} (harus < 0,3 m tanpa pengambilalihan)")
        elif not 90 <= r["lapTime"] <= 115:
            fails.append(f"Ld {r['ld']} m: waktu satu putaran {r['lapTime']:.0f} detik, teks bilang sekitar 1 menit 40 detik")
    for r in out["large"]:
        s = r["firstCutAt"]
        if s is None or not tr["zones"][0][0] - 10 <= s <= tr["zones"][0][1]:
            fails.append(f"Ld {r['ld']} m @ {r['v']} km/jam: tidak memotong di bundaran pertama (s = {s})")
    pid = {(p["kp"], p["ki"]): p for p in out["pid"]}
    if pid[(0.8, 0.2)]["overshoot"] >= 0.05 or pid[(0.8, 0.2)]["spoiled"] or pid[(0.8, 0.2)]["doneAtS"] is None:
        fails.append(f"PID bawaan: {pid[(0.8, 0.2)]}")
    if pid[(0.8, 1)]["overshoot"] <= 0.10:
        fails.append("Ki 1 tidak memberi overshoot > 10%")
    if pid[(0.5, 0)]["endKmh"] > 39.5:
        fails.append("Kp saja tidak menyisakan selisih kecepatan")
    if pid[(1.2, 0.3)]["overshoot"] >= 0.05 or pid[(1.2, 0.3)]["doneAtS"] is None:
        fails.append(f"Kp 1,2 Ki 0,3 tidak lulus tugas pid-tuned: {pid[(1.2, 0.3)]}")
    if out["falseTakeovers"]:
        fails.append(f"pengambilalihan palsu: {out['falseTakeovers']}")
    ex = out["extreme"]
    if ex["maxCte"] > 2.5:
        fails.append(f"simpangan ekstrem {ex['maxCte']:.2f} m pada {ex['maxCteAt']}")
    if ex["islandIntrusion"] > 0.3:
        fails.append(f"bodi mobil masuk {ex['islandIntrusion']:.2f} m ke pulau bundaran pada {ex['intrusionAt']}")

    # 8. aturan keselamatan: tidak ada pejalan kaki, kendaraan lain, atau lampu di pelajaran ini
    src = ""
    for name in ("kontrol.js",):
        src += open(os.path.join(ROOT, "js", "lessons", name), encoding="utf-8").read()
    for name in os.listdir(LESSON):
        if name.endswith(".js"):
            src += open(os.path.join(LESSON, name), encoding="utf-8").read()
    code = re.sub(r"//[^\n]*", "", src)
    for word in ("drawPedestrian", "PathAgent", "TrafficLight", "drawTrafficSignal", "SignalPlan", "drawVehicle", "drawAngkot", "drawMotor"):
        if word in code:
            fails.append(f"kode pelajaran memakai {word}: aturan keselamatan harus diperiksa ulang")
    out["safety_static"] = "tidak ada pejalan kaki, kendaraan lain, atau lampu lalu lintas di kode pelajaran"

    print(json.dumps(out, indent=1))
    print("\nGAGAL:\n  " + "\n  ".join(fails) if fails else "\nSemua pemeriksaan model lulus.")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
