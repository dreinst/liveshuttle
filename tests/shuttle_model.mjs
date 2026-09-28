// Uji model pelajaran Misi Shuttle Otonom tanpa peramban (Node).
//
// Pemakaian: node tests/shuttle_model.mjs [menit per skenario] [jumlah seed] [--blind]
//
// Menjalankan dunia pelajaran (js/lessons/shuttle/world.js) dengan langkah tetap 1/60 detik dan
// tindakan pelajar acak: hujan nyala dan mati, batas kecepatan 10 sampai 30 km/jam, jalan ditutup dan
// dibuka, pejalan kaki uji berulang, halte dimatikan dan dinyalakan, lalu lintas ramai.
// Yang diperiksa:
//   - penghitung pemantau "Terobos lampu merah" dan "Kontak dengan pejalan kaki" harus 0;
//   - pemeriksa sendiri (terpisah dari pemantau): bumper depan melewati ujung lajur berlampu saat
//     merah, dan jarak pusat pejalan kaki ke kotak kendaraan kurang dari 0,25 m;
//   - tumpang tindih antarkendaraan, penjepitan perisai, shuttle macet, putaran selesai.
// --blind: perencana SEMUA kendaraan diganti "gas penuh terus" (seperti pengemudi nekat). Hanya
// perisai yang menjaga, dan kedua penghitung aturan keras tetap harus 0.

import fs from 'fs';

const ROOT = new URL('..', import.meta.url).pathname;
const { buildNetwork } = await import(`${ROOT}js/lessons/shuttle/network.js`);
const { createWorld, DT } = await import(`${ROOT}js/lessons/shuttle/world.js`);
const { parseMap } = await import(`${ROOT}js/engine/osm2d.js`);

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const MINUTES = Number(args[0] || 20);
const SEEDS = Number(args[1] || 4);
const BLIND = process.argv.includes('--blind');

const data = JSON.parse(fs.readFileSync(`${ROOT}js/sim3d/data/machung-city.json`));
const map2d = parseMap(JSON.parse(fs.readFileSync(`${ROOT}js/data/machung-2d.json`)));

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const totals = { simMin: 0, red: 0, ped: 0, indepRed: 0, indepPed: 0, overlaps: 0, clamps: 0, followClamps: 0, lineClamps: 0, loops: 0, delivered: 0, stuckMax: 0, recovered: 0, tests: 0, emergencies: 0, closures: 0, rejected: 0, shield: 0 };
const problems = [];

for (let k = 0; k < SEEDS; k++) {
  const seed = 1000 + k * 7919;
  const net = buildNetwork(data, map2d);
  const w = createWorld(net, { seed, npcTarget: k % 2 ? 22 : 12, pedTarget: k % 2 ? 30 : 18 });
  if (BLIND) w.app.faults = { plannerBlind: true, all: true };
  const rnd = mulberry(seed * 3 + 1);
  let nextAct = 15;
  let stuck = 0;
  let stuckMax = 0;
  let indepRed = 0;
  let indepPed = 0;
  const contacts = new Set();
  const prev = new Map();
  const steps = MINUTES * 3600;
  for (let i = 0; i < steps; i++) {
    // posisi bumper depan sebelum langkah (lajur dan s)
    prev.clear();
    for (const v of w.traffic.all) prev.set(v, { link: v.link, front: v.s + v.len / 2, path0: v.path[0] });
    w.update(DT);
    w.W.events.length = 0;
    // pemeriksa sendiri: melewati ujung lajur berlampu saat merah
    for (const v of w.traffic.all) {
      const p = prev.get(v);
      if (!p) continue;
      const L = p.link;
      if (!L.sig) continue;
      const frontNow = v.link === L ? v.s + v.len / 2 : v.link === p.path0 ? L.len + v.s + v.len / 2 : Infinity;
      if (p.front < L.len && frontNow >= L.len && L.sig.ctl.color(L.sig.arm) === 'red') {
        indepRed++;
        problems.push({ seed, t: w.W.time.toFixed(1), what: 'merah (pemeriksa sendiri)', veh: v.type, link: L.id });
      }
    }
    // pemeriksa sendiri: kontak pejalan kaki
    for (const v of w.traffic.all) {
      const c = Math.cos(v.h);
      const s = Math.sin(v.h);
      for (const pd of w.peds.peds) {
        const dx = pd.x - v.x;
        const dz = pd.z - v.z;
        if (dx * dx + dz * dz > (v.len / 2 + 1) ** 2) continue;
        const lx = dx * c + dz * s;
        const lz = -dx * s + dz * c;
        const ex = lx - Math.max(-v.len / 2, Math.min(v.len / 2, lx));
        const ez = lz - Math.max(-v.hw, Math.min(v.hw, lz));
        const key = `${v.id}:${pd.id}`;
        if (ex * ex + ez * ez < 0.0625) {
          if (!contacts.has(key)) {
            indepPed++;
            problems.push({ seed, t: w.W.time.toFixed(1), what: 'kontak pejalan kaki (pemeriksa sendiri)', veh: v.type, v: v.v.toFixed(2), ped: pd.state });
          }
          contacts.add(key);
        } else contacts.delete(key);
      }
    }
    // shuttle macet (bukan di halte)
    if (w.sh.v < 0.1 && w.W.mode !== 'dwell') stuck += DT;
    else stuck = 0;
    stuckMax = Math.max(stuckMax, stuck);
    if (stuck > 150 && !problems.some((q) => q.seed === seed && q.what === 'shuttle macet')) {
      problems.push({ seed, t: w.W.time.toFixed(1), what: 'shuttle macet', reason: w.sh.planReason, wait: w.sh.waitWhy, link: w.sh.link.id, target: w.W.target });
    }
    // tindakan pelajar acak
    if (w.W.time >= nextAct) {
      nextAct = w.W.time + 8 + rnd() * 25;
      const r = rnd();
      if (r < 0.15) w.setWeather(w.W.weather === 'hujan' ? 'cerah' : 'hujan');
      else if (r < 0.3) w.setLimit(10 + Math.floor(rnd() * 21));
      else if (r < 0.45) {
        const res = w.closeAhead();
        totals.closures++;
        if (!res.ok) totals.rejected++;
      } else if (r < 0.55) w.openAll();
      else if (r < 0.8) w.requestTestPed();
      else if (r < 0.9) {
        const i = Math.floor(rnd() * 5);
        w.setActive(i, !w.W.active[i]);
      } else {
        // tutup jalan acak di dekat shuttle
        const R = net.roadAt(w.sh.x + (rnd() - 0.5) * 200, w.sh.z + (rnd() - 0.5) * 200, 30);
        if (R) {
          const res = w.toggleRoad(R.id);
          totals.closures++;
          if (!res.ok) totals.rejected++;
        }
      }
    }
  }
  const M = w.monitor;
  const T = w.traffic.stats;
  totals.simMin += MINUTES;
  totals.red += M.redRuns;
  totals.ped += M.pedContacts;
  totals.indepRed += indepRed;
  totals.indepPed += indepPed;
  totals.overlaps += M.otherCollisions;
  totals.clamps += T.clamps;
  totals.followClamps += T.followClamps;
  totals.lineClamps += T.lineClamps;
  totals.loops += w.W.stats.loops;
  totals.delivered += w.W.stats.delivered;
  totals.stuckMax = Math.max(totals.stuckMax, stuckMax);
  totals.recovered += T.recovered;
  totals.tests += w.peds.stats.tests;
  totals.emergencies += w.W.stats.emergencies;
  totals.shield += M.shuttleShield;
  console.log(
    `seed ${seed}: ${MINUTES} menit, merah ${M.redRuns}/${indepRed}, pejalan ${M.pedContacts}/${indepPed}, tumpang tindih ${M.otherCollisions}, jepit ${T.clamps}/${T.followClamps}/${T.lineClamps}, putaran ${w.W.stats.loops}, diantar ${w.W.stats.delivered}, uji pejalan ${w.peds.stats.tests}, darurat ${w.W.stats.emergencies}, macet maks ${stuckMax.toFixed(0)} detik, NPC dipulihkan ${T.recovered}, jarak ${(w.W.stats.distance / 1000).toFixed(2)} km`,
  );
}

console.log(JSON.stringify({ blind: BLIND, totals, problems: problems.slice(0, 30) }, null, 2));
const hardOk = totals.red === 0 && totals.ped === 0 && totals.indepRed === 0 && totals.indepPed === 0;
console.log(hardOk ? 'ATURAN KERAS: LOLOS (0 terobos lampu merah, 0 kontak pejalan kaki)' : 'ATURAN KERAS: GAGAL');
process.exit(hardOk ? 0 : 1);
