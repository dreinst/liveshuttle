// Uji model independen pelajaran Level Otomasi (Node, tanpa peramban).
// Pemakaian: node tests/level-otomasi_verify_model.mjs
//
// Yang diperiksa:
//  1. Tidak ada tumpang tindih antarpelaku lain (kendaraan depan, sepeda motor searah, lalu lintas
//     berlawanan) di semua preset langkah, termasuk saat sistem level 3 sampai 5 mengemudi.
//  2. Saat sistem level 3 sampai 5 mengemudi tanpa masukan: tidak ada tabrakan jenis apa pun, dan
//     kecepatan tidak melewati batas di posisi bagian depan mobil.
//  3. Level 4 di langkah 5: bagian depan mobil tidak pernah melewati garis batas, mobil berhenti di
//     tepi kiri dan tetap berhenti selama 60 detik, tanpa disenggol sepeda motor.
//  4. Level 5 dari langkah 6 selama 9 menit: jarak perjalanan kontinu (rebase), sampai di sekitar
//     Alun-alun Merdeka, tanpa tabrakan.
//  5. Fuzz pengemudi manusia (level 0 sampai 2 dan sistem mati) 20 menit: tidak ada nilai NaN,
//     tabrakan hanya jenis kendaraan atau zona pekerjaan jalan.
//  6. Rute tidak punya pelaku berjenis orang berjalan kaki atau pesepeda.
import { boxesOverlap } from '../js/engine/geometry.js';

const m = await import('../js/lessons/level-otomasi/scene.js');
const { TRIP } = await import('../js/lessons/level-otomasi/data/trip.js');
const dt = 1 / 60;
const fails = [];
const check = (ok, msg) => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`);
  if (!ok) fails.push(msg);
};
const kmh = (v) => v / 3.6;
const PRESETS = [
  { level: 0, egoAt: 10, trip: 2250, speed: 0, lead: { kind: 'angkot', code: 'ADL', gap: 26, speed: 0, wait: true } },
  { level: 0, egoAt: 10, trip: 3002, speed: 0, lead: { kind: 'angkot', code: 'GL', gap: 22, speed: 0, wait: true } },
  { level: 2, egoAt: 250, trip: 3628, speed: kmh(36), lead: { kind: 'city', gap: 30, speed: kmh(34) } },
  { level: 3, egoAt: 650, trip: 4566, speed: kmh(40), lead: null, zone: 200 },
  { level: 4, egoAt: 650, trip: m.ODD_EXIT - 115, speed: kmh(30), lead: null },
  { level: 5, egoAt: 650, trip: m.ODD_EXIT - 105, speed: kmh(30), lead: null },
];

function npcOverlaps(sc) {
  const { lead, bikes, opp } = sc;
  const list = [];
  if (lead.active) list.push(lead);
  for (const b of bikes) if (b.active) list.push(b);
  for (const o of opp) list.push(o);
  const hits = [];
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      if (Math.abs(a.x - b.x) > 12 || Math.abs(a.y - b.y) > 12) continue;
      if (boxesOverlap(a, b)) hits.push(`${a.id}/${b.id}`);
    }
  return hits;
}

const bang = (sc, lane = 1.75) => {
  const st = sc.st;
  const e = st.egoD - lane + st.headErr * -8;
  sc.setInput('right', e > 0.25);
  sc.setInput('left', e < -0.25);
};

// 1 dan 2: sistem mengemudi di setiap preset dengan level 3, 4 (bila bisa), dan 5
for (const [i, p] of PRESETS.entries()) {
  for (const level of [3, 4, 5]) {
    const sc = m.createScene();
    const ok = sc.applyPreset({ ...p, level });
    const st = sc.st;
    if (!ok) {
      console.log(`     step ${i + 1} level ${level}: refused (${sc.flashKey()})`);
      continue;
    }
    let npcHits = [];
    let overLimit = 0;
    let maxV = 0;
    for (let k = 0; k < 60 * 150; k++) {
      sc.update(dt);
      st.events.length = 0;
      if (k % 6 === 0) {
        const h = npcOverlaps(sc);
        if (h.length) npcHits.push(...h);
      }
      if (st.engaged) {
        const lim = sc.limitAt(st.egoS + sc.EGO_HL);
        if (sc.ego.speed > lim + kmh(1)) overLimit++;
      }
      maxV = Math.max(maxV, sc.ego.speed);
    }
    const c = st.crashLog;
    check(c.lead + c.motor + c.zone === 0, `step ${i + 1} level ${level}: no crash while the system drives 150 s (${JSON.stringify(c)})`);
    check(npcHits.length === 0, `step ${i + 1} level ${level}: other road users never overlap (${[...new Set(npcHits)].slice(0, 4)})`);
    check(overLimit === 0, `step ${i + 1} level ${level}: system speed within the limit at the car front (max ${(maxV * 3.6).toFixed(1)} km/jam, ${overLimit} ticks over)`);
  }
}

// 3: level 4 di langkah 5
{
  const sc = m.createScene();
  sc.applyPreset(PRESETS[4]);
  const st = sc.st;
  const bS = st.boundary.s;
  let maxFront = -Infinity;
  let stoppedAt = null;
  for (let k = 0; k < 60 * 90; k++) {
    sc.update(dt);
    st.events.length = 0;
    maxFront = Math.max(maxFront, st.egoS + sc.EGO_HL);
    if (stoppedAt == null && st.ads.phase === 'mrc') stoppedAt = k * dt;
  }
  check(maxFront < bS, `level 4 front never passes the boundary (max front ${(bS - maxFront).toFixed(1)} m before it)`);
  check(st.ads.phase === 'mrc' && sc.ego.speed < 0.05 && st.egoD > 3.5, `level 4 stopped on the left edge (egoD ${st.egoD.toFixed(2)}, stopped after ${stoppedAt?.toFixed(1)} s)`);
  check(st.crashLog.motor === 0 && st.crashLog.lead === 0, 'no vehicle touches the stopped level 4 car in 90 s');
  check(sc.inKawasan(st.egoS + sc.EGO_HL), 'level 4 car stays inside the operating area');
}

// 4: level 5 panjang
{
  const sc = m.createScene();
  sc.applyPreset(PRESETS[5]);
  const st = sc.st;
  let prev = sc.tripAt(st.egoS);
  let maxJump = 0;
  let rebases = 0;
  let lastOffset = st.tripOffset;
  let npcHits = 0;
  for (let k = 0; k < 60 * 540; k++) {
    sc.update(dt);
    st.events.length = 0;
    const t = sc.tripAt(st.egoS);
    maxJump = Math.max(maxJump, Math.abs(t - prev - sc.ego.speed * dt));
    prev = t;
    if (st.tripOffset !== lastOffset) {
      rebases++;
      lastOffset = st.tripOffset;
    }
    if (k % 12 === 0 && npcOverlaps(sc).length) npcHits++;
  }
  const t = sc.tripAt(st.egoS);
  check(maxJump < 0.2, `level 5 trip distance continuous over ${rebases} rebases (max jump ${maxJump.toFixed(3)} m)`);
  check(t >= TRIP.length - 5, `level 5 reaches Alun-alun Merdeka in 9 min (trip ${t.toFixed(0)} of ${TRIP.length} m)`);
  check(st.crashes === 0 && npcHits === 0, `level 5 long drive: 0 crashes, 0 NPC overlaps (${st.crashes}, ${npcHits})`);
}

// 5: fuzz pengemudi manusia
{
  let rng = 12345;
  const rnd = () => ((rng = (rng * 1103515245 + 12345) % 2147483648) / 2147483648);
  const kinds = new Set();
  let nan = 0;
  let total = { lead: 0, motor: 0, zone: 0 };
  let npcHits = 0;
  for (const [i, p] of PRESETS.entries()) {
    const sc = m.createScene();
    sc.applyPreset({ ...p, level: i % 3 });
    const st = sc.st;
    for (let k = 0; k < 60 * 200; k++) {
      if (k % 30 === 0) {
        const r = rnd();
        sc.setInput('gas', r < 0.7);
        sc.setInput('brake', r > 0.93);
        const s = rnd();
        sc.setInput('left', s < 0.2);
        sc.setInput('right', s > 0.8);
        if (rnd() < 0.04) sc.setLevel(Math.floor(rnd() * 6));
        if (rnd() < 0.05) sc.pressTakeover();
        if (rnd() < 0.05) sc.pressHold();
        if (rnd() < 0.02) sc.applyPreset({ ...PRESETS[Math.floor(rnd() * 6)], level: Math.floor(rnd() * 6) });
      }
      sc.update(dt);
      st.events.length = 0;
      for (const v of [st.egoS, st.egoD, sc.ego.speed, sc.ego.x, sc.ego.y]) if (!Number.isFinite(v)) nan++;
      if (k % 20 === 0) {
        for (const kk of Object.keys(sc.actorKinds())) kinds.add(kk);
        if (npcOverlaps(sc).length) npcHits++;
      }
    }
    for (const k of Object.keys(total)) total[k] += st.crashLog[k];
    for (const k of Object.keys(st.crashLog)) if (!(k in total)) total[k] = st.crashLog[k];
  }
  console.log('     human fuzz crashes by kind:', JSON.stringify(total), 'kinds seen:', [...kinds].join(','));
  check(nan === 0, 'human fuzz: no NaN or infinite values');
  check(Object.keys(total).every((k) => ['lead', 'motor', 'zone'].includes(k)), 'crash kinds are only vehicles or roadworks');
  check(npcHits === 0, `human fuzz: other road users never overlap each other (${npcHits})`);
  check(![...kinds].some((k) => /pedestrian|cyclist|person|pejalan/.test(k)), 'no pedestrian or cyclist actors exist');
}

console.log(`\nMODEL FAILS: ${fails.length}`);
for (const f of fails) console.log(' - ' + f);
process.exit(fails.length ? 1 : 0);
