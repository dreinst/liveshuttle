"""Uji aturan keselamatan model pelajaran Pengambilan Keputusan di Jalan Kawi (tanpa peramban, butuh Node.js).

Aturan dari pengguna: apa pun yang terjadi, tidak ada kendaraan yang menerobos lampu merah atau menabrak
pejalan kaki. Skrip ini menjalankan scene.js, world.js, dan planner.js langsung di Node dengan data OSM
asli (js/data/malang-center.json), lalu memeriksa dengan pemantau SENDIRI (terpisah dari penghitung di
dalam pelajaran):

- terobos merah: bemper depan kendaraan melewati tepi dekat garis henti saat lampunya merah
  (mobil otonom, kendaraan dari arah berlawanan, kendaraan di Jalan Kelud dan Jalan Arjuno);
- kontak pejalan kaki: kotak kendaraan (koordinat peta) bersinggungan dengan lingkaran pejalan kaki.

Skenario serangan:
  A  lampu otomatis lama di setiap kepadatan dan kecepatan target, angkot ngetem, pejalan kaki berkala
  B  mobil otonom memutuskan terus saat kuning, lalu pelajar menurunkan kecepatan target ke 20 km/jam
  C  Paksa merah, Paksa hijau, dan Otomatis bergantian dengan cepat di dekat simpang
  D  fuzz: tombol acak (lampu, kecepatan, pejalan kaki, kepadatan, angkot, Ulangi) untuk banyak seed
  E  pejalan kaki diminta terus-menerus (tiap 0,5 detik) di lalu lintas padat
  F  mode kacau: kendaraan lain mengabaikan lampu dan penyeberangan, mobil otonom tancap gas penuh
     (perencana diganti), hanya perisai yang menjaga
  G  mode kacau ditambah lampu yang diganti-ganti cepat
Kecepatan simulasi 2x di peramban hanya menjalankan langkah 1/60 detik lebih banyak per frame, jadi
cukup diuji dengan langkah tetap di sini.

Pemakaian: python3 tests/keputusan_safety_model.py [--quick]
Keluar dengan kode 0 bila semua penghitung pelanggaran 0, penjepitan posisi 0, dan tidak ada tabrakan lain
di skenario A sampai E (mode kacau F dan G hanya dilaporkan).
"""
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QUICK = "--quick" in sys.argv

JS = r"""
import { readFileSync } from 'fs';
const root = process.argv[1];
const QUICK = process.argv[2] === '1';
const L = root + '/js/lessons/keputusan/';
const { buildScene } = await import(L + 'scene.js');
const { createWorld } = await import(L + 'world.js');
const { createPlanner } = await import(L + 'planner.js');
const { distanceToBox } = await import(root + '/js/engine/geometry.js');
const { mulberry32 } = await import(root + '/js/engine/math.js');
const json = JSON.parse(readFileSync(root + '/js/data/malang-center.json', 'utf8'));
const scene = buildScene(json);
const S = scene.S;
const F = scene.frame;
const dt = 1 / 60;
const STARTS = [S.start, S.zebra - 140, S.start, S.cwEast + 10, S.start];

function mk({ egoS = S.start, kmh = 40, mode = 'otomatis', density = 'sepi', angkot = false, chaos = false, fullThrottle = false }) {
  const w = createWorld(scene);
  const p = createPlanner(w);
  w.signal.mode = mode;
  w.density = density;
  w.angkot.active = angkot;
  w.chaos.npcIgnoreRules = chaos;
  p.setTarget(kmh / 3.6);
  w.reset(egoS, kmh / 3.6);
  p.reset();
  // penghitung dunia direset oleh Ulangi: jumlahkan dulu supaya tidak ada yang tersembunyi
  w.acc = { clamps: 0, other: 0, red: 0, contact: 0 };
  const origReset = w.reset;
  w.reset = (...args) => {
    w.acc.clamps += w.counters.clamps;
    w.acc.other += w.counters.otherCollisions;
    w.acc.red += w.counters.redRuns;
    w.acc.contact += w.counters.pedContacts;
    return origReset(...args);
  };
  if (fullThrottle) {
    const inner = p.update;
    p.update = (h) => { inner(h); return { aDesire: 5, aSafety: Infinity, steer: 0 }; };
  }
  return { w, p };
}

const box = (v, dir, isEgo) => {
  const q = F.toWorld(v.x, v.y);
  return { x: q.x, y: q.y, heading: q.heading + (dir < 0 ? Math.PI : 0) + (isEgo ? v.heading : 0), length: v.length, width: v.width };
};

// Pemantau independen. Dipanggil sebelum dan sesudah setiap w.update().
function monitor(w) {
  const m = { red: 0, redWhere: [], contact: 0, contactWhere: [], maxDecelEgo: 0, egoDist: 0 };
  let prev = null;
  const snap = () => {
    const ego = w.ego;
    const onc = new Map();
    for (const c of w.oncoming) onc.set(c.id, c.x - c.length / 2);
    const cr = new Map();
    for (const k of ['utara', 'selatan']) for (const a of w.cross[k]) cr.set(a.id, a.s + a.length / 2);
    return { egoF: ego.x + ego.length / 2, egoX: ego.x, onc, cr };
  };
  function before() { prev = snap(); }
  function after() {
    const now = snap();
    const red = w.signal.main === 'red';
    const sideRed = w.signal.side === 'red';
    if (now.egoX >= prev.egoX - 50) m.egoDist += now.egoX - prev.egoX;
    if (prev.egoF < S.stopEB && now.egoF >= S.stopEB && red) { m.red++; m.redWhere.push({ who: 'ego', t: +w.time.toFixed(2), v: +w.ego.speed.toFixed(2) }); }
    for (const c of w.oncoming) {
      if (!prev.onc.has(c.id)) continue;
      const F0 = prev.onc.get(c.id), F1 = c.x - c.length / 2;
      if (F0 > S.stopWB && F1 <= S.stopWB && red) { m.red++; m.redWhere.push({ who: c.id, t: +w.time.toFixed(2), v: +c.speed.toFixed(2) }); }
    }
    for (const k of ['utara', 'selatan']) {
      const stopS = scene.side[k].stopS;
      for (const a of w.cross[k]) {
        const s0 = prev.cr.get(a.id), s1 = a.s + a.length / 2;
        if (s0 == null || s1 < s0) continue;
        if (s0 < stopS && s1 >= stopS && sideRed) { m.red++; m.redWhere.push({ who: a.id, t: +w.time.toFixed(2), v: +a.speed.toFixed(2) }); }
      }
    }
    const vs = [{ id: 'ego', b: box(w.ego, 1, true) }];
    for (const c of w.oncoming) vs.push({ id: c.id, b: box(c, -1, false) });
    for (const k of ['utara', 'selatan']) for (const a of w.cross[k]) vs.push({ id: a.id, b: a });
    if (w.angkot.active) vs.push({ id: 'angkot', b: box(w.angkot, 1, false) });
    for (const p of w.peds) {
      const q = F.toWorld(p.x, p.y);
      for (const v of vs) {
        if (Math.abs(v.b.x - q.x) > 8 || Math.abs(v.b.y - q.y) > 8) continue;
        if (distanceToBox(q.x, q.y, v.b) < p.radius) { m.contact++; if (m.contactWhere.length < 4) m.contactWhere.push({ ped: p.id, state: p.state, veh: v.id, t: +w.time.toFixed(2) }); }
      }
    }
    if (w.ego.speed > 1) m.maxDecelEgo = Math.max(m.maxDecelEgo, -w.ego.accel);
    prev = now;
  }
  return { m, before, after };
}

function run(w, p, mon, seconds, each) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    if (each) each(i * dt, i);
    mon.before();
    w.update(dt, p);
    mon.after();
    p.drainEvents();
    w.drainEvents();
  }
}

const out = {};
const brief = (w, m) => ({
  red: m.red,
  contact: m.contact,
  clamps: w.acc.clamps + w.counters.clamps,
  other: w.acc.other + w.counters.otherCollisions,
  inworld: { red: w.acc.red + w.counters.redRuns, contact: w.acc.contact + w.counters.pedContacts },
  redWhere: m.redWhere.slice(0, 3),
  contactWhere: m.contactWhere.slice(0, 3),
});
const tot = (rows) => ({
  red: rows.reduce((a, r) => a + r.red, 0),
  contact: rows.reduce((a, r) => a + r.contact, 0),
  clamps: rows.reduce((a, r) => a + r.clamps, 0),
  other: rows.reduce((a, r) => a + r.other, 0),
  worldRed: rows.reduce((a, r) => a + r.inworld.red, 0),
  worldContact: rows.reduce((a, r) => a + r.inworld.contact, 0),
});

// ---------- A. lampu otomatis lama ----------
{
  const rows = [];
  for (const density of ['kosong', 'sepi', 'sedang', 'padat']) for (const kmh of [20, 35, 50]) {
    const { w, p } = mk({ density, kmh, angkot: true });
    const mon = monitor(w);
    run(w, p, mon, QUICK ? 180 : 600, (t, i) => { if (i % (60 * 23) === 0) w.requestPed(); });
    rows.push({ density, kmh, wraps: w.wraps, interventions: w.counters.egoInterventions, maxDecel: +mon.m.maxDecelEgo.toFixed(2), ...brief(w, mon.m) });
  }
  out.A = { ...tot(rows), minWraps: Math.min(...rows.map((r) => r.wraps)), maxEgoInterventions: Math.max(...rows.map((r) => r.interventions)), maxDecel: Math.max(...rows.map((r) => r.maxDecel)), bad: rows.filter((r) => r.red || r.contact || r.clamps).slice(0, 3) };
}

// ---------- B. terus saat kuning lalu kecepatan diturunkan ----------
{
  const rows = [];
  let cases = 0, results = 0, redResults = 0;
  for (const kmh of [30, 40, 45, 50]) for (let d0 = 2; d0 <= 50; d0 += 0.5) {
    const front0 = S.stopEB - d0;
    const { w, p } = mk({ egoS: front0 - 2.25, kmh, mode: 'hijau', density: 'kosong' });
    w.signal.mode = 'merah';
    const mon = monitor(w);
    let lowered = false;
    run(w, p, mon, 12, () => { if (!lowered && p.P.goCommit) { p.setTarget(20 / 3.6); lowered = true; cases++; } });
    if (p.P.yellow?.result) { results++; if (p.P.yellow.result.red) redResults++; }
    rows.push({ kmh, d0, ...brief(w, mon.m) });
  }
  out.B = { cases, results, redResults, ...tot(rows), bad: rows.filter((r) => r.red || r.contact || r.clamps).slice(0, 3) };
}

// ---------- C. lampu diganti-ganti cepat ----------
{
  const rows = [];
  const rnd = mulberry32(5);
  for (let trial = 0; trial < (QUICK ? 60 : 300); trial++) {
    const kmh = 20 + 5 * Math.floor(rnd() * 7);
    const density = ['sepi', 'sedang', 'padat'][Math.floor(rnd() * 3)];
    const { w, p } = mk({ egoS: S.stopEB - 2.25 - (5 + rnd() * 110), kmh, mode: 'hijau', density });
    const mon = monitor(w);
    let next = rnd() * 3;
    run(w, p, mon, 25, (t) => {
      if (t >= next) { w.signal.mode = ['merah', 'hijau', 'otomatis'][Math.floor(rnd() * 3)]; next = t + 0.2 + rnd() * 4; }
    });
    rows.push({ trial, kmh, density, ...brief(w, mon.m) });
  }
  out.C = { ...tot(rows), bad: rows.filter((r) => r.red || r.contact || r.clamps).slice(0, 3) };
}

// ---------- D. fuzz tombol acak ----------
{
  const rows = [];
  const seeds = QUICK ? 12 : 60;
  for (let seed = 1; seed <= seeds; seed++) {
    const rnd = mulberry32(seed * 7919);
    const { w, p } = mk({ egoS: STARTS[seed % 5], kmh: 40, density: 'sedang' });
    const mon = monitor(w);
    let next = 0.5;
    run(w, p, mon, QUICK ? 120 : 300, (t) => {
      w.viewMaxS = w.ego.x + 40 + rnd() * 35; // meniru render (lebar layar ponsel sampai desktop)
      if (t < next) return;
      next = t + 0.1 + rnd() * 3;
      const r = rnd();
      if (r < 0.22) w.signal.mode = ['merah', 'hijau', 'otomatis'][Math.floor(rnd() * 3)];
      else if (r < 0.40) p.setTarget((20 + 5 * Math.floor(rnd() * 7)) / 3.6);
      else if (r < 0.62) w.requestPed();
      else if (r < 0.74) w.setDensity(['kosong', 'sepi', 'sedang', 'padat'][Math.floor(rnd() * 4)], p.P.man ? w.ego.x + 250 : -Infinity);
      else if (r < 0.86) w.requestAngkot();
      else if (r < 0.90) { w.reset(STARTS[Math.floor(rnd() * 5)], p.P.targetSpeed); p.reset(); }
    });
    rows.push({ seed, ...brief(w, mon.m) });
  }
  out.D = { seeds, ...tot(rows), bad: rows.filter((r) => r.red || r.contact || r.clamps).slice(0, 3) };
}

// ---------- E. pejalan kaki terus diminta ----------
{
  const rows = [];
  for (const kmh of [20, 50]) {
    const { w, p } = mk({ kmh, density: 'padat', angkot: true });
    const mon = monitor(w);
    run(w, p, mon, QUICK ? 180 : 600, (t, i) => { if (i % 30 === 0) w.requestPed(); });
    rows.push({ kmh, wraps: w.wraps, ...brief(w, mon.m) });
  }
  out.E = { ...tot(rows), wraps: rows.map((r) => r.wraps), bad: rows.filter((r) => r.red || r.contact || r.clamps).slice(0, 3) };
}

// ---------- F. mode kacau: hanya perisai yang menjaga ----------
{
  const rows = [];
  for (const density of ['sepi', 'sedang', 'padat']) for (const mode of ['otomatis', 'merah']) {
    const { w, p } = mk({ density, mode, chaos: true, fullThrottle: true, angkot: false });
    const mon = monitor(w);
    run(w, p, mon, QUICK ? 150 : 480, (t, i) => { if (i % 120 === 0) w.requestPed(); });
    rows.push({ density, mode, wraps: w.wraps, interventions: w.counters.interventions, ...brief(w, mon.m) });
  }
  out.F = { ...tot(rows), interventions: rows.reduce((a, r) => a + r.interventions, 0), bad: rows.filter((r) => r.red || r.contact || r.clamps).slice(0, 3) };
}

// ---------- G. mode kacau dan lampu diganti-ganti cepat ----------
{
  const rows = [];
  const rnd = mulberry32(77);
  for (let trial = 0; trial < (QUICK ? 30 : 120); trial++) {
    const { w, p } = mk({ egoS: S.start + rnd() * 200, density: ['sepi', 'sedang', 'padat'][trial % 3], chaos: true, fullThrottle: rnd() < 0.7 });
    const mon = monitor(w);
    let next = rnd() * 2;
    run(w, p, mon, 40, (t, i) => {
      if (t >= next) { w.signal.mode = ['merah', 'hijau', 'otomatis'][Math.floor(rnd() * 3)]; next = t + 0.2 + rnd() * 3; }
      if (i % 90 === 0) w.requestPed();
    });
    rows.push({ trial, ...brief(w, mon.m) });
  }
  out.G = { ...tot(rows), bad: rows.filter((r) => r.red || r.contact || r.clamps).slice(0, 3) };
}

console.log(JSON.stringify(out));
"""


def main():
    proc = subprocess.run(["node", "--input-type=module", "-e", JS, ROOT, "1" if QUICK else "0"],
                          capture_output=True, text=True, timeout=3600)
    if proc.returncode != 0:
        print(proc.stderr)
        sys.exit(1)
    res = json.loads(proc.stdout.strip().splitlines()[-1])
    print(json.dumps(res, indent=1, ensure_ascii=False))
    total_red = sum(res[k]["red"] + res[k]["worldRed"] for k in res)
    total_contact = sum(res[k]["contact"] + res[k]["worldContact"] for k in res)
    total_clamps = sum(res[k]["clamps"] for k in res)
    other_normal = sum(res[k]["other"] for k in "ABCDE")
    print(f"TOTAL terobos merah = {total_red}, kontak pejalan kaki = {total_contact}, penjepitan posisi = {total_clamps}, "
          f"tabrakan lain (A sampai E) = {other_normal}, tabrakan lain mode kacau = {res['F']['other'] + res['G']['other']}")
    sys.exit(0 if total_red == 0 and total_contact == 0 and total_clamps == 0 and other_normal == 0 else 1)


if __name__ == "__main__":
    main()
