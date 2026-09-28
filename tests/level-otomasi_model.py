"""Uji model pelajaran Level Otomasi (versi perjalanan Ma Chung ke Alun-alun Merdeka) tanpa UI.

Modul scene.js dijalankan langsung di Node (tidak butuh server atau peramban). Yang diperiksa:
- pengemudi sederhana (tombol kiri/kanan saja) bisa mengikuti tikungan pada 40 km/jam;
- galat lajur sistem level 2, 3, dan 5 dalam satu periode tikungan penuh;
- ACC di belakang angkot yang kecepatannya berubah: tanpa tabrakan dan tanpa rem darurat;
- level 3 tanpa respons berhenti di lajur sebelum zona pekerjaan jalan;
- level 4 menepi dan berhenti di tepi kiri sebelum batas kawasan (area operasi), dari preset langkah 5;
- level 5 melewati batas kawasan lalu naik ke batas kecepatan kota 40 km/jam;
- level 4 dan 5 melewati zona pekerjaan jalan lewat lajur kanan tanpa tabrakan, dengan sepeda motor;
- 10 menit level 5: sepeda motor menyalip, tidak ada tabrakan, jarak perjalanan kontinu saat rebase;
- level 4 ditolak di luar kawasan, level 3 ditolak saat zona terlalu dekat;
- tidak pernah ada pejalan kaki atau lampu lalu lintas di antara pelaku simulasi.
Pemakaian: python3 tests/level-otomasi_model.py
"""
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

JS = r"""
const m = await import('__ROOT__/js/lessons/level-otomasi/scene.js');
const T = await import('__ROOT__/js/lessons/level-otomasi/data/trip.js');
const R = {};
const dt = 1 / 60;
const kmh = (v) => v / 3.6;
const EXIT = m.ODD_EXIT;
const kindsSeen = new Set();
const seeKinds = (sc) => { for (const k of Object.keys(sc.actorKinds())) kindsSeen.add(k); };
const run = (sc, seconds, fn) => {
  const st = sc.st;
  for (let i = 0; i < 60 * seconds; i++) {
    if (fn) fn(i);
    sc.update(dt);
    if (i % 30 === 0) seeKinds(sc);
    st.events.length = 0;
  }
};
const bang = (sc) => {
  const st = sc.st;
  const e = st.egoD - 1.75 + st.headErr * -8; // d positif = kiri; headErr positif = mengarah ke kanan
  sc.setInput('right', e > 0.25);
  sc.setInput('left', e < -0.25);
};

// 1. level 0: pengemudi bang-bang dengan tombol kiri dan kanan, gas dijaga sekitar 40 km/jam
{
  const sc = m.createScene();
  sc.applyPreset({ level: 0, egoAt: 300, trip: 2300, speed: kmh(40), lead: null });
  const st = sc.st;
  let maxErr = 0, offroad = 0;
  for (let i = 0; i < 60 * 120; i++) {
    bang(sc);
    sc.setInput('gas', sc.ego.speed < kmh(40));
    sc.update(dt);
    maxErr = Math.max(maxErr, Math.abs(st.egoD - 1.75));
    if (st.events.includes('offroad')) offroad++;
    st.events.length = 0;
  }
  R.manual = { maxLaneErr: +maxErr.toFixed(2), offroad, dist: Math.round(st.counters.manualDist), crashes: st.crashes };
}

// 2. level 2, 3, 5: galat lajur saat sistem menyetir melewati satu periode penuh (1300 m)
for (const L of [2, 3, 5]) {
  const sc = m.createScene();
  sc.applyPreset({ level: L, egoAt: 300, trip: 2300, speed: kmh(40), lead: null });
  const st = sc.st;
  let maxErr = 0;
  run(sc, 125, (i) => {
    if (L === 2 && st.attention.stage !== 'ok') sc.pressHold();
    if (i > 60 * 3) maxErr = Math.max(maxErr, Math.abs(st.egoD - 1.75));
  });
  R['laneKeep' + L] = { maxLaneErr: +maxErr.toFixed(3), engaged: st.engaged, speedKmh: Math.round(sc.ego.speed * 3.6), crashes: st.crashes };
}

// 3. level 1: ACC di belakang angkot yang kecepatannya berubah, pengemudi menyetir bang-bang
{
  const sc = m.createScene();
  sc.applyPreset({ level: 1, egoAt: 10, trip: 3000, speed: 0, lead: { kind: 'angkot', code: 'GL', gap: 22, speed: 0, wait: true } });
  const st = sc.st;
  let minGap = Infinity, aeb = 0, crash = 0, follow = 0, maxKmh = 0;
  for (let i = 0; i < 60 * 150; i++) {
    bang(sc);
    sc.update(dt);
    if (st.acc.mode === 'follow') { follow += dt; minGap = Math.min(minGap, st.acc.gap); }
    maxKmh = Math.max(maxKmh, sc.ego.speed * 3.6);
    for (const ev of st.events) { if (ev === 'aeb') aeb++; if (ev === 'crash') crash++; }
    st.events.length = 0;
  }
  R.acc = { minGap: +minGap.toFixed(1), aeb, crash, followSec: Math.round(follow), engaged: st.engaged, maxKmh: +maxKmh.toFixed(1), leadKind: sc.lead.kind };
}

// 4. level 3 tanpa respons: berhenti di lajur sebelum zona (preset langkah 4)
{
  const sc = m.createScene();
  sc.applyPreset({ level: 3, egoAt: 650, trip: 4566, speed: m.V_CITY, lead: null, zone: 200 });
  const st = sc.st;
  let torAt = null, mrcAt = null, maxDecel = 0, crash = 0;
  for (let i = 0; i < 60 * 40; i++) {
    const v0 = sc.ego.speed;
    sc.update(dt);
    maxDecel = Math.max(maxDecel, (v0 - sc.ego.speed) / dt);
    if (st.events.includes('tor') && torAt == null) torAt = +(i * dt).toFixed(1);
    if (st.events.includes('l3-mrc')) mrcAt = +(i * dt).toFixed(1);
    if (st.events.includes('crash')) crash++;
    st.events.length = 0;
  }
  const front = st.egoS + sc.EGO_HL;
  R.l3 = { torAt, mrcAt, stopBeforeZone: +(st.zone.s0 - front).toFixed(1), lane: +st.egoD.toFixed(2), maxDecel: +maxDecel.toFixed(2), hazard: st.signal.hazard, crash };
}

// 5. level 4: menepi dan berhenti di tepi kiri sebelum batas kawasan (preset langkah 5)
{
  const sc = m.createScene();
  sc.applyPreset({ level: 4, egoAt: 650, trip: EXIT - 115, speed: m.V_KAWASAN, lead: null });
  const st = sc.st;
  let mrmAt = null, mrcAt = null, maxDecel = 0, maxSteer = 0, holdAt = null;
  for (let i = 0; i < 60 * 40; i++) {
    const v0 = sc.ego.speed;
    sc.update(dt);
    maxDecel = Math.max(maxDecel, (v0 - sc.ego.speed) / dt);
    maxSteer = Math.max(maxSteer, Math.abs(sc.ego.steer));
    if (st.events.includes('l4-mrm') && mrmAt == null) mrmAt = +(i * dt).toFixed(1);
    if (st.events.includes('l4-mrc')) mrcAt = +(i * dt).toFixed(1);
    if (holdAt == null && st.counters.mrcHold >= 0.6) holdAt = +(i * dt).toFixed(1);
    st.events.length = 0;
  }
  const front = st.egoS + sc.EGO_HL;
  R.l4 = {
    startInside: true, mrmAt, mrcAt, taskAt: holdAt, stopBeforeBoundary: +(st.boundary.s - front).toFixed(1), d: +st.egoD.toFixed(2),
    onShoulder: st.egoD - sc.ego.width / 2 > 3.5 && st.egoD + sc.ego.width / 2 < 6.5, maxDecel: +maxDecel.toFixed(2),
    maxSteerRad: +maxSteer.toFixed(3), hazard: st.signal.hazard, tripAtStop: +sc.tripAt(front).toFixed(1), exit: EXIT, inside: sc.inKawasan(front),
  };
}

// 6. level 5 melewati batas kawasan dan naik ke 40 km/jam
{
  const sc = m.createScene();
  sc.applyPreset({ level: 5, egoAt: 650, trip: EXIT - 105, speed: m.V_KAWASAN, lead: null });
  const st = sc.st;
  let maxInside = 0;
  // kecepatan diukur selama bagian depan mobil masih di dalam kawasan (rambu 40 ada tepat di batas)
  run(sc, 40, () => { if (sc.inKawasan(st.egoS + sc.EGO_HL)) maxInside = Math.max(maxInside, sc.ego.speed * 3.6); });
  R.l5 = { passed: !sc.inKawasan(st.egoS), maxKmhInside: +maxInside.toFixed(1), kmhAfter: +(sc.ego.speed * 3.6).toFixed(1), trip: Math.round(sc.tripAt(st.egoS)), engaged: st.engaged };
}

// 7. level 4 dan 5 melewati zona pekerjaan jalan lewat lajur kanan (dengan sepeda motor di lajur kanan)
for (const L of [4, 5]) {
  const out = [];
  for (let k = 0; k < 6; k++) {
    const sc = m.createScene();
    // level 4 hanya bisa aktif di dalam kawasan: pakai zona di dalam kawasan untuk uji ini
    const trip = L === 4 ? 100 : 4566 + k * 37;
    sc.applyPreset({ level: L, egoAt: 650, trip, speed: L === 4 ? m.V_KAWASAN : m.V_CITY, lead: null, zone: 200 + k * 23 });
    const st = sc.st;
    // beri waktu motor muncul dulu: majukan motor ke dekat mobil
    let minD = Infinity, crash = 0, aeb = 0, passedAt = null, waited = 0;
    for (let i = 0; i < 60 * 70; i++) {
      sc.update(dt);
      minD = Math.min(minD, st.egoD);
      if (st.wantRight) waited += dt;
      for (const ev of st.events) { if (ev === 'crash') crash++; if (ev === 'aeb') aeb++; }
      st.events.length = 0;
      if (passedAt == null && st.zone && st.egoS > st.zone.s1 + 20) passedAt = +(i * dt).toFixed(1);
      if (i % 30 === 0) seeKinds(sc);
    }
    out.push({ engaged: st.engaged, minD: +minD.toFixed(2), crash, aeb, passedAt, waitedForGap: +waited.toFixed(1), bikesCrashed: st.crashLog.motor });
  }
  R['zone' + L] = out;
}

// 7b. sepeda motor tepat di samping saat sistem ingin pindah ke lajur kanan: sistem menunggu dengan sein
for (const L of [5]) {
  const out = [];
  for (const rel of [-1, 1.5, -6, -12]) {
    const sc = m.createScene();
    sc.applyPreset({ level: L, egoAt: 650, trip: 4566, speed: m.V_CITY, lead: null, zone: 200 });
    const st = sc.st;
    while (st.egoS < st.zone.s0 - 111) { sc.update(dt); st.events.length = 0; }
    const b = sc.bikes[0];
    b.active = true; b.extra = 2; b.s = st.egoS + rel; b.d = -2.2; b.v = sc.ego.speed + 0.8;
    sc.bikes[1].active = false; sc.bikes[1].wait = 99;
    let waited = 0, minLat = Infinity, crash = 0, passedAt = null, changeAt = null;
    for (let i = 0; i < 60 * 60; i++) {
      sc.update(dt);
      if (st.wantRight) waited += dt;
      if (changeAt == null && st.plan.d1 < 0) changeAt = +(i * dt).toFixed(2);
      if (b.active && Math.abs(b.s - st.egoS) < 3.2) minLat = Math.min(minLat, (st.egoD - 0.9) - (b.d + 0.36));
      for (const ev of st.events) if (ev === 'crash') crash++;
      st.events.length = 0;
      if (passedAt == null && st.egoS > st.zone.s1 + 20) passedAt = +(i * dt).toFixed(1);
    }
    out.push({ rel, waited: +waited.toFixed(2), changeAt, minLateralGap: +minLat.toFixed(2), crash, passedAt });
  }
  R.laneChangeWait = out;
}

// 8. level 5 selama 10 menit: sepeda motor menyalip, tanpa tabrakan, jarak perjalanan kontinu saat rebase
{
  const sc = m.createScene();
  sc.applyPreset({ level: 5, egoAt: 1200, trip: EXIT + 100, speed: m.V_CITY, lead: null });
  const st = sc.st;
  let jumps = 0, rebased = 0, prevTrip = sc.tripAt(st.egoS), prevS = st.egoS, crash = 0, passes = 0;
  const seen = new Map();
  for (let i = 0; i < 60 * 600; i++) {
    sc.update(dt);
    const trip = sc.tripAt(st.egoS);
    if (Math.abs(trip - prevTrip - sc.ego.speed * dt) > 0.05) jumps++;
    if (st.egoS - prevS < -1000) rebased++;
    prevTrip = trip;
    prevS = st.egoS;
    for (const b of sc.bikes) {
      if (!b.active) { seen.delete(b.id); continue; }
      const rel = b.s - st.egoS;
      const was = seen.get(b.id);
      if (was != null && was < 0 && rel >= 0) passes++;
      seen.set(b.id, rel);
    }
    for (const ev of st.events) if (ev === 'crash') crash++;
    st.events.length = 0;
    if (i % 30 === 0) seeKinds(sc);
  }
  R.long = { rebased, tripJumps: jumps, crash, bikePasses: passes, tripKm: +(sc.tripAt(st.egoS) / 1000).toFixed(2) };
}

// 9. pengemudi manual yang membanting setir ke kanan terus: motor mengalah, tabrakan dihitung terpisah
{
  const sc = m.createScene();
  sc.applyPreset({ level: 0, egoAt: 10, trip: 2300, speed: kmh(20), lead: null });
  const st = sc.st;
  let crashes = 0;
  run(sc, 240, (i) => {
    // zig-zag antara lajur kiri dan kanan setiap 6 detik, kecepatan sekitar 25 km/jam
    const wantRight = Math.floor(i / 360) % 2 === 1;
    const target = wantRight ? -1.75 : 1.75;
    const e = st.egoD - target + st.headErr * -8;
    sc.setInput('right', e > 0.3);
    sc.setInput('left', e < -0.3);
    sc.setInput('gas', sc.ego.speed < kmh(25));
    if (st.events.includes('crash')) crashes++;
  });
  R.zigzag = { crashLog: st.crashLog, offroad: 0 };
}

// 10. level 4 ditolak di luar kawasan, level 3 ditolak saat zona terlalu dekat
{
  const sc = m.createScene();
  sc.applyPreset({ level: 0, egoAt: 10, trip: 3000, speed: kmh(30), lead: null });
  const ok4 = sc.setLevel(4);
  const flash4 = sc.flashKey();
  const sc2 = m.createScene();
  sc2.applyPreset({ level: 0, egoAt: 650, trip: 4566, speed: m.V_CITY, lead: null, zone: 120 });
  const ok3 = sc2.setLevel(3);
  const flash3 = sc2.flashKey();
  const sc3 = m.createScene();
  sc3.applyPreset({ level: 0, egoAt: 650, trip: EXIT - 200, speed: m.V_KAWASAN, lead: null });
  const ok4in = sc3.setLevel(4);
  R.refuse = { l4Outside: ok4, flash4, l3NearZone: ok3, flash3, l4Inside: ok4in };
}

R.kindsSeen = [...kindsSeen].sort();
R.trip = { length: T.TRIP.length, oddExit: T.TRIP.oddExit, streets: T.TRIP.streets.length };
process.stdout.write(JSON.stringify(R));
"""


def check(R):
    fails = []

    def need(cond, msg):
        if not cond:
            fails.append(msg)

    need(R["manual"]["offroad"] == 0 and R["manual"]["maxLaneErr"] < 1.2, "pengemudi manual keluar lajur")
    for L in (2, 3, 5):
        k = R["laneKeep%d" % L]
        need(k["maxLaneErr"] < 0.35 and k["engaged"] and k["crashes"] == 0, "galat lajur level %d" % L)
    a = R["acc"]
    need(a["crash"] == 0 and a["aeb"] == 0 and a["minGap"] > 3.5 and a["followSec"] > 60 and a["maxKmh"] < 40.5, "ACC di belakang angkot")
    l3 = R["l3"]
    need(l3["torAt"] is not None and l3["mrcAt"] is not None and 0 < l3["stopBeforeZone"] < 40 and l3["crash"] == 0 and l3["hazard"], "level 3 tanpa respons")
    l4 = R["l4"]
    need(l4["mrmAt"] is not None and l4["mrcAt"] is not None and l4["taskAt"] is not None and l4["onShoulder"] and l4["inside"] and 5 < l4["stopBeforeBoundary"] < 20, "level 4 menepi di dalam kawasan")
    l5 = R["l5"]
    need(l5["passed"] and l5["maxKmhInside"] <= 30.5 and l5["kmhAfter"] > 38, "level 5 melewati batas kawasan")
    for L in (4, 5):
        for i, z in enumerate(R["zone%d" % L]):
            need(z["crash"] == 0 and z["passedAt"] is not None and z["minD"] < -1.2 and z["engaged"], "zona level %d kasus %d" % (L, i))
    lg = R["long"]
    need(lg["crash"] == 0 and lg["tripJumps"] == 0 and lg["rebased"] >= 3 and lg["bikePasses"] >= 16, "10 menit level 5")
    for c in R["laneChangeWait"]:
        need(c["crash"] == 0 and c["passedAt"] is not None and c["minLateralGap"] > 0.4, "menunggu motor sebelum pindah lajur (rel %s)" % c["rel"])
    need(any(c["waited"] > 0.5 for c in R["laneChangeWait"]), "sistem tidak pernah menunggu motor di samping")
    rf = R["refuse"]
    need(rf["l4Outside"] is False and rf["flash4"] == "odd-outside" and rf["l3NearZone"] is False and rf["flash3"] == "l3-refuse" and rf["l4Inside"] is True, "penolakan level")
    need(not ({"pedestrian", "cyclist", "trafficLight", "signal"} & set(R["kindsSeen"])), "ada pejalan kaki atau lampu")
    need({"angkot", "motor"} <= set(R["kindsSeen"]) and ({"car", "city", "mpv"} & set(R["kindsSeen"])), "lalu lintas Malang (angkot, motor, mobil)")
    return fails


def main():
    js = JS.replace("__ROOT__", ROOT)
    out = subprocess.run(["node", "--input-type=module", "-e", js], capture_output=True, text=True)
    if out.returncode != 0:
        print(out.stderr)
        sys.exit(1)
    R = json.loads(out.stdout)
    fails = check(R)
    R["fails"] = fails
    R["passed"] = not fails
    print(json.dumps(R, indent=1, ensure_ascii=False))
    sys.exit(0 if not fails else 1)


if __name__ == "__main__":
    main()
