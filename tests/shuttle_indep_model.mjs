// QA independen pelajaran Misi Shuttle Otonom: uji model dunia tanpa peramban.
//
// Pemakaian: node tests/shuttle_indep_model.mjs [menit] [jumlahSkenarioAcak]
//
// Yang diperiksa sendiri (tidak memakai penghitung milik model):
//   - pelanggaran lampu merah untuk SEMUA kendaraan, dihitung dari geometri garis henti;
//   - tabrakan antarkendaraan dan dengan pejalan kaki yang sedang menyeberang;
//   - kendaraan diam terlalu lama (macet atau buntu);
//   - shuttle tetap di lajur kiri dan dekat garis rutenya;
//   - posisi berhenti di halte (pintu dekat halte);
//   - rute A* sama panjang dengan Dijkstra buatan sendiri di graf link.

const ROOT = '/Users/mcdonny/Downloads/ndur/driverless-sim';
const { createWorld } = await import(`${ROOT}/js/lessons/shuttle/world.js`);
const C = await import(`${ROOT}/js/lessons/shuttle/campus.js`);
const { boxesOverlap, distanceToBox } = await import(`${ROOT}/js/engine/geometry.js`);

const MINUTES = Number(process.argv[2] || 12);
const RANDOM_RUNS = Number(process.argv[3] || 6);
const DT = 1 / 60;

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

// garis henti berlampu: titik, arah, lampu
const STOPS = C.LINK_LIST.filter((L) => L.light).map((L) => {
  const p = L.lane.sample(L.length - 0.4);
  return { L, x: p.x, y: p.y, h: L.endHeading, light: L.light };
});

function frontPoint(m) {
  const len = m.isShuttle ? m.length : m.length;
  return { x: m.x + Math.cos(m.heading) * len / 2, y: m.y + Math.sin(m.heading) * len / 2 };
}

function stopRel(stop, p) {
  const dx = p.x - stop.x;
  const dy = p.y - stop.y;
  return { lon: dx * Math.cos(stop.h) + dy * Math.sin(stop.h), lat: -dx * Math.sin(stop.h) + dy * Math.cos(stop.h) };
}

// Dijkstra sendiri pada graf link (tanpa putar balik)
function dijkstra(fromId, goalId, closed) {
  const dist = new Map([[fromId, 0]]);
  const done = new Set();
  const open = [[0, fromId]];
  while (open.length) {
    open.sort((a, b) => a[0] - b[0]);
    const [d, id] = open.shift();
    if (done.has(id)) continue;
    done.add(id);
    if (id === goalId && id !== fromId) return d;
    for (const n of C.LINKS[id].next) {
      if (closed.has(C.LINKS[n].road.id)) continue;
      const nd = d + C.LINKS[n].cost;
      if (n === goalId && goalId === fromId) return nd;
      if (!dist.has(n) || nd < dist.get(n)) {
        dist.set(n, nd);
        open.push([nd, n]);
      }
    }
  }
  return Infinity;
}

function run(name, { seed = 1, actions = false, rain = false, limit = 20, pedEvery = 0, leader = false } = {}) {
  const api = createWorld();
  const { W, sh } = api;
  if (rain) api.setWeather('hujan');
  if (limit !== 20) api.setLimit(limit);
  const rnd = mulberry(seed);
  const res = {
    name,
    violationsGeom: 0,
    violationsGeomCars: 0,
    violationsModel: 0,
    collisions: 0,
    maxStill: 0,
    maxStillWhere: '',
    maxCarStill: 0,
    maxLat: 0,
    wrongSide: 0,
    dwellErrMax: 0,
    doorErrMax: 0,
    dwells: 0,
    delivered: 0,
    loops: 0,
    loopEvents: [],
    emergencies: 0,
    astarChecks: 0,
    astarBad: [],
    served: new Set(),
    errors: [],
    closures: 0,
    rejects: 0,
    peds: 0,
    maxSpeedKmh: 0,
    rainOverSpeed: 0,
    staleFlags: 0,
    flagChecks: 0,
  };
  // halte bertanda "jalan ditutup" harus benar-benar tidak terjangkau dari link terakhir yang pasti
  function checkFlags() {
    const comm = api.committedIds();
    const last = comm[comm.length - 1];
    for (const i of W.unreachable) {
      if (!W.active[i] || i === sh.target) continue;
      const H = C.HALTE[i];
      res.flagChecks++;
      const reach = dijkstra(last, H.link.id, W.closed) < Infinity || (H.link.id === last && !W.closed.has(H.link.road.id));
      if (reach) res.staleFlags++;
    }
  }
  const prevLon = new Map();
  let still = 0;
  const carStill = new Map();
  let inContact = false;
  const steps = Math.round((MINUTES * 60) / DT);
  let nextAction = 20;
  let lastMode = sh.mode;
  if (leader) api.placeLeader();
  for (let k = 0; k < steps; k++) {
    try {
      api.update(DT);
    } catch (e) {
      res.errors.push(`${W.time.toFixed(1)} ${e.stack.split('\n').slice(0, 3).join(' | ')}`);
      break;
    }
    const t = W.time;
    // pelanggaran geometris
    for (const m of W.movers) {
      const fp = frontPoint(m);
      for (const S of STOPS) {
        const r = stopRel(S, fp);
        const key = `${m.id}|${S.L.id}`;
        const inLane = Math.abs(r.lat) < 1.9 && Math.abs(((m.heading - S.h + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) < 0.5;
        const prev = prevLon.get(key);
        if (inLane && prev != null && prev < 0 && r.lon >= 0 && r.lon < 1.5 && S.light.state === 'red') {
          if (m.isShuttle) res.violationsGeom++;
          else res.violationsGeomCars++;
        }
        prevLon.set(key, inLane ? r.lon : null);
      }
    }
    // tabrakan
    let contact = false;
    const all = W.movers;
    for (let i = 0; i < all.length && !contact; i++) {
      for (let j = i + 1; j < all.length; j++) {
        if (Math.abs(all[i].x - all[j].x) > 9 || Math.abs(all[i].y - all[j].y) > 9) continue;
        if (boxesOverlap(all[i], all[j], 0)) {
          contact = true;
          break;
        }
      }
      for (const p of W.peds) {
        if (p.state === 'cross' && distanceToBox(p.x, p.y, all[i]) < p.radius * 0.9) contact = true;
      }
    }
    if (contact && !inContact) res.collisions++;
    inContact = contact;
    // diam terlalu lama
    if (sh.mode === 'drive' && sh.speed < 0.05) still += DT;
    else still = 0;
    if (still > res.maxStill) {
      res.maxStill = still;
      res.maxStillWhere = `${sh.dec?.code} t=${t.toFixed(0)}`;
    }
    for (const c of W.cars) {
      const v = (carStill.get(c.id) || 0) + DT;
      carStill.set(c.id, c.speed < 0.05 ? v : 0);
      res.maxCarStill = Math.max(res.maxCarStill, carStill.get(c.id));
    }
    // lajur: jarak ke garis rute, dan sisi kiri ruas (bukan di dalam persimpangan)
    if (sh.mode === 'drive' && sh.pp) res.maxLat = Math.max(res.maxLat, Math.abs(sh.pp.crossTrack ?? 0));
    const pos = W.linkPos(sh);
    if (!pos.inBox && pos.sRear > 1 && pos.sFront < pos.link.length - 1) {
      const R = pos.link.road;
      const c = R.path.closest(sh.x, sh.y);
      // lateral > 0 = kiri garis tengah ruas menurut arah titik ruas
      const dirSign = pos.link.from.id === R.a ? 1 : -1;
      if (c.lateral * dirSign < 0.3) res.wrongSide++;
    }
    res.maxSpeedKmh = Math.max(res.maxSpeedKmh, sh.speed * 3.6);
    if (W.weather === 'hujan' && sh.speed > api.params(sh).v0 + 0.25) res.rainOverSpeed++;
    // mulai berhenti di halte
    if (lastMode === 'drive' && sh.mode === 'dwell') {
      const H = sh.dwell.halte;
      res.dwells++;
      res.served.add(H.name);
      const sS = W.stopS();
      const stopPt = H.link.lane.sample(H.s);
      const f = frontPoint(sh);
      res.dwellErrMax = Math.max(res.dwellErrMax, Math.hypot(f.x - stopPt.x, f.y - stopPt.y));
      // pintu (sisi kiri) harus menghadap halte: jarak titik tengah sisi kiri ke halte
      const lx = sh.x + Math.sin(sh.heading) * sh.width / 2;
      const ly = sh.y - Math.cos(sh.heading) * sh.width / 2;
      res.doorErrMax = Math.max(res.doorErrMax, Math.hypot(lx - H.shelter.x, ly - H.shelter.y));
    }
    lastMode = sh.mode;
    // A* vs Dijkstra (setiap 7 detik)
    if (k % 420 === 0 && sh.target != null) {
      const comm = api.committedIds();
      const ids = sh.route.ids;
      const H = C.HALTE[sh.target];
      const rest = ids.slice(comm.length);
      if (rest.length) {
        const last = comm[comm.length - 1];
        const cost = rest.reduce((a, id) => a + C.LINKS[id].cost, 0);
        const best = dijkstra(last, H.link.id, W.closed);
        res.astarChecks++;
        if (Math.abs(cost - best) > 1e-6 && cost > best) res.astarBad.push(`${t.toFixed(0)} ${last}->${H.link.id} cost ${cost.toFixed(1)} best ${best.toFixed(1)}`);
      }
    }
    // aksi acak seperti pelajar
    if (actions && t > nextAction) {
      nextAction = t + 6 + rnd() * 20;
      const r = rnd();
      if (r < 0.35) {
        const R = C.ROAD_LIST[Math.floor(rnd() * C.ROAD_LIST.length)];
        const out = api.toggleRoad(R.id);
        if (out.ok) res.closures++;
        else res.rejects++;
        checkFlags();
      } else if (r < 0.45) {
        api.openAll();
        checkFlags();
      }
      else if (r < 0.55) api.setWeather(W.weather === 'hujan' ? 'cerah' : 'hujan');
      else if (r < 0.65) api.setLimit(10 + Math.floor(rnd() * 21));
      else if (r < 0.8) {
        const i = Math.floor(rnd() * 5);
        api.setActive(i, !W.active[i]);
      } else if (r < 0.9) {
        if (api.addPedestrian().ok) res.peds++;
      } else if (r < 0.95) api.placeLeader();
      else api.releaseLeader();
    }
    if (pedEvery && k % Math.round(pedEvery / DT) === 0 && k > 0) {
      if (api.addPedestrian().ok) res.peds++;
    }
    for (const ev of W.events) if (ev.type === 'loop') res.loopEvents.push(`${ev.clean ? 'bersih' : 'kotor'} ${ev.time.toFixed(0)}s`);
    W.events.length = 0;
  }
  res.violationsModel = W.stats.violations;
  res.delivered = W.stats.delivered;
  res.loops = W.stats.loops;
  res.emergencies = W.stats.emergencies;
  res.modelCollisions = W.collisions;
  res.served = [...res.served];
  res.maxStill = +res.maxStill.toFixed(1);
  res.maxCarStill = +res.maxCarStill.toFixed(1);
  res.maxLat = +res.maxLat.toFixed(2);
  res.dwellErrMax = +res.dwellErrMax.toFixed(2);
  res.doorErrMax = +res.doorErrMax.toFixed(2);
  res.maxSpeedKmh = +res.maxSpeedKmh.toFixed(1);
  res.astarBad = res.astarBad.slice(0, 5);
  res.loopEvents = res.loopEvents.slice(0, 8);
  return res;
}

const results = [];
results.push(run('dasar'));
results.push(run('hujan', { rain: true }));
results.push(run('batas-10', { limit: 10 }));
results.push(run('batas-30', { limit: 30 }));
results.push(run('pejalan-tiap-9s', { pedEvery: 9 }));
results.push(run('mobil-pelan', { leader: true }));
for (let i = 0; i < RANDOM_RUNS; i++) results.push(run(`acak-${i + 1}`, { seed: 100 + i * 7, actions: true }));
for (const r of results) console.log(JSON.stringify(r));
