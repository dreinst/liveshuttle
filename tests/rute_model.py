"""Uji model pelajaran Perencanaan Rute tanpa peramban (Node menjalankan modul pelajaran langsung).

Pemakaian: python3 tests/rute_model.py

Yang diperiksa:
  - durasi kuning memenuhi waktu reaksi + vMax / (2 a_nyaman) + cadangan, ada fase semua merah;
  - kecepatan tertinggi di graf 60 km/jam (angka ini disebut di teks langkah 2);
  - A* dan Dijkstra menemukan biaya sama, A* menjelajahi lebih sedikit node (Ma Chung ke Alun-Alun Merdeka);
  - rute tidak pernah melawan arah jalan satu arah;
  - mobil menempuh semua pasangan tempat tanpa menerobos lampu merah dan tanpa penjepitan darurat;
  - perjalanan acak dengan penutupan jalan dan hitung ulang berulang: tetap 0 terobos, pose tidak melompat;
  - perisai sendiri (perencana dibuat buta lampu) tetap mencegah semua terobosan;
  - tanpa perisai dan dengan perencana buta, pemantau benar-benar menghitung terobosan (pemantau tidak buta).
Keluar dengan kode 1 bila ada yang gagal.
"""
import json
import os
import subprocess
import sys
import tempfile

ROOT = "/Users/mcdonny/Downloads/ndur/driverless-sim/"

SCRIPT = r"""
import { readFileSync } from 'fs';
const ROOT = %ROOT%;
const { parseMap } = await import(ROOT + 'js/engine/osm2d.js');
const { buildSignals, signalTiming, buildRoute, joinAt, junctionSetback, stretchFrom } = await import(ROOT + 'js/lessons/rute/network.js');
const { createDriver, DRIVE } = await import(ROOT + 'js/lessons/rute/drive.js');
const { PLACES } = await import(ROOT + 'js/lessons/rute/data/places.js');
const map = parseMap(JSON.parse(readFileSync(ROOT + 'js/data/malang-roads.json')));
const graph = map.graph({ cost: 'time' });
const vMax = graph.maxSpeed;
const timing = signalTiming(vMax, { reaction: DRIVE.T_REACT, comfortDecel: DRIVE.A_COMF });
const signals = buildSignals(map, timing);
const setbackOf = (id) => junctionSetback(map.nodes[id]);
const placeNode = new Map(PLACES.map((p) => [p.id, graph.nearestNode(p.x, p.y).id]));
const out = { timing, vMaxKmh: vMax * 3.6, controllers: signals.controllers.length, checks: [] };
const check = (name, ok, info = null) => out.checks.push({ name, ok: !!ok, info });

check('kuning cukup panjang', timing.yellow >= DRIVE.T_REACT + vMax / (2 * DRIVE.A_COMF) + 0.5 && timing.allRed > 0, timing);
check('kecepatan tertinggi 60 km/jam', Math.abs(vMax * 3.6 - 60) < 1e-6, vMax * 3.6);

const a0 = placeNode.get('machung');
const b0 = placeNode.get('alun-merdeka');
const ra = graph.findRoute(a0, b0, { algorithm: 'astar', tieBreak: 'g' });
const rd = graph.findRoute(a0, b0, { algorithm: 'dijkstra', tieBreak: 'g' });
check('A* dan Dijkstra biaya sama', ra.found && rd.found && Math.abs(ra.cost - rd.cost) < 1e-6, { a: ra.cost, d: rd.cost });
check('A* menjelajahi lebih sedikit', ra.expanded < rd.expanded, { a: ra.expanded, d: rd.expanded });

function onewayOk(nodes) {
  const rr = graph.routeRoads(nodes);
  if (rr.length !== nodes.length - 1) return false;
  return rr.every((e) => !e.road.oneway || e.forward);
}

function makeDriver(faults) {
  return createDriver({ signals, vMax, setbackOf, faults });
}

const totals = { trips: 0, arrived: 0, redRuns: 0, clamps: 0, shieldBrakes: 0, yellowGo: 0, yellowStop: 0, replans: 0, maxJump: 0, onewayBad: 0, simHours: 0 };
function drive(a, b, { t0 = 0, closeEvery = 0, faults = {}, tally = totals, maxReplans = 6, stretch = true, keepRoute = false } = {}) {
  const r = graph.findRoute(a, b, { algorithm: 'astar' });
  if (!r.found) return null;
  let route = buildRoute(graph, r.path);
  if (!onewayOk(route.nodes)) tally.onewayBad++;
  const d = makeDriver(faults);
  d.setRoute(route);
  d.start();
  let t = t0;
  let steps = 0;
  let replans = 0;
  const closed = [];
  while (d.car.state === 'driving' || d.car.state === 'blocked') {
    t += DRIVE.DT;
    d.tick(DRIVE.DT, t);
    steps++;
    if (d.car.state === 'blocked' && d.car.v === 0) break;
    if (closeEvery && steps % closeEvery === 0 && d.car.state === 'driving' && replans < maxReplans) {
      const c = d.commitIndex();
      // keepRoute: seperti tombol "Tutup jalan di rute", pilih jalan yang penutupannya masih
      // menyisakan rute dari simpang c. Tanpa itu, penutupan boleh menjebak mobil (uji keras).
      const leavesRoute = (x) => {
        if (!keepRoute) return true;
        graph.closeRoad(x, true);
        const ok = graph.findRoute(route.nodes[c], b, { algorithm: 'astar' }).found;
        graph.closeRoad(x, false);
        return ok;
      };
      const cand = route.edges.slice(c, c + 8).map((e) => e.road).find((x) => x.a !== b && x.b !== b && !graph.isClosed(x) && leavesRoute(x));
      if (cand) {
        const st = stretch ? stretchFrom(map, cand, { usable: (x) => x.a !== b && x.b !== b }) : { roads: [cand] };
        for (const x of st.roads) {
          graph.closeRoad(x, true);
          closed.push(x);
        }
        const from = route.nodes[c];
        const prev = c > 0 ? route.nodes[c - 1] : null;
        const back = prev != null ? graph.edge(from, prev) : null;
        const blockBack = !!back && !back.blocked;
        if (blockBack) back.blocked = true;
        let res = graph.findRoute(from, b, { algorithm: 'astar' });
        if (blockBack) back.blocked = false;
        if (!res.found && blockBack) res = graph.findRoute(from, b, { algorithm: 'astar' });
        const front = d.car.s + DRIVE.LENGTH / 2;
        const sKeep = Math.min(route.path.length, Math.max(front + 0.5, route.nodeS[c] - setbackOf(from) - 1));
        const before = { x: d.car.x, y: d.car.y };
        if (res.found) {
          const full = buildRoute(graph, route.nodes.slice(0, c + 1).concat(res.path.slice(1)));
          const joined = full && joinAt(route, full, sKeep, c);
          if (joined) {
            route = joined;
            d.replace(route, 'driving');
            replans++;
            if (!onewayOk(route.nodes)) tally.onewayBad++;
          }
        } else {
          const prefix = buildRoute(graph, route.nodes.slice(0, c + 1));
          const joined = prefix && joinAt(route, prefix, sKeep, c);
          if (joined) {
            joined.stopAt = Math.max(d.car.s, joined.nodeS[c] - setbackOf(from) - 0.5 - DRIVE.LENGTH / 2);
            route = joined;
            d.replace(route, 'blocked');
          }
        }
        tally.maxJump = Math.max(tally.maxJump, Math.hypot(d.car.x - before.x, d.car.y - before.y));
      }
    }
    if (steps > 60 * 60 * 90) break;
  }
  for (const x of closed) graph.closeRoad(x, false);
  const s = d.safety;
  tally.trips++;
  if (d.car.state === 'arrived') tally.arrived++;
  if (d.car.state === 'blocked') tally.blocked = (tally.blocked || 0) + 1;
  tally.redRuns += s.redRuns;
  tally.clamps += s.clamps;
  tally.shieldBrakes += s.shieldBrakes;
  tally.yellowGo += s.yellowGo;
  tally.yellowStop += s.yellowStop;
  tally.replans += replans;
  tally.simHours += d.car.elapsed / 3600;
  return d;
}

// 1. semua pasangan tempat bernama, waktu mulai berbeda-beda
const ids = PLACES.map((p) => placeNode.get(p.id));
let t0 = 0;
for (const a of ids) for (const b of ids) {
  if (a === b) continue;
  drive(a, b, { t0 });
  t0 += 23.7;
}
const pairs = { ...totals };
check('semua pasangan sampai', pairs.arrived === pairs.trips, pairs);
check('pasangan: 0 terobos lampu merah', pairs.redRuns === 0, pairs.redRuns);
check('pasangan: perisai tidak perlu menjepit', pairs.clamps === 0, pairs.clamps);
check('pasangan: rute tidak melawan satu arah', pairs.onewayBad === 0, pairs.onewayBad);

// 2. perjalanan acak dengan penutupan jalan dan hitung ulang berulang. Separuh perjalanan
//    berangkat dan berakhir di dekat lampu lalu lintas supaya lampu ikut teruji.
let seed = 11;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const nodeIds = [...graph.nodes.keys()];
const nearSignal = signals.controllers.map((c) => graph.nearestNode(c.x, c.y).id);
const rand = { trips: 0, arrived: 0, redRuns: 0, clamps: 0, shieldBrakes: 0, yellowGo: 0, yellowStop: 0, replans: 0, maxJump: 0, onewayBad: 0, simHours: 0 };
for (let k = 0; k < 160; k++) {
  const pool = k % 2 ? nearSignal : nodeIds;
  const a = pool[Math.floor(rnd() * pool.length)];
  const b = pool[Math.floor(rnd() * pool.length)];
  if (a === b) continue;
  drive(a, b, { t0: rnd() * 5000, closeEvery: 300 + Math.floor(rnd() * 1500), tally: rand, maxReplans: 3, stretch: false, keepRoute: true });
}
// uji keras: potongan jalan sampai 300 m ditutup tepat di depan simpang c, boleh menjebak mobil
const trap = { trips: 0, arrived: 0, redRuns: 0, clamps: 0, shieldBrakes: 0, yellowGo: 0, yellowStop: 0, replans: 0, maxJump: 0, onewayBad: 0, simHours: 0 };
for (let k = 0; k < 120; k++) {
  const pool = k % 2 ? nearSignal : nodeIds;
  const a = pool[Math.floor(rnd() * pool.length)];
  const b = pool[Math.floor(rnd() * pool.length)];
  if (a === b) continue;
  drive(a, b, { t0: rnd() * 5000, closeEvery: 120 + Math.floor(rnd() * 900), tally: trap, maxReplans: 6, stretch: true });
}
check('uji keras: 0 terobos lampu merah', trap.redRuns === 0, trap);
check('uji keras: tidak ada penjepitan', trap.clamps === 0, trap.clamps);
check('uji keras: pose tidak melompat', trap.maxJump < 0.01, trap.maxJump);
check('acak: 0 terobos lampu merah', rand.redRuns === 0, rand);
check('acak: tidak ada penjepitan', rand.clamps === 0, rand.clamps);
check('acak: ada hitung ulang', rand.replans > 40, rand.replans);
check('acak: hampir semua tetap sampai', rand.arrived >= rand.trips * 0.9, { arrived: rand.arrived, trips: rand.trips, blocked: rand.blocked });
check('acak: lampu ikut teruji', rand.yellowStop + rand.yellowGo > 10, { stop: rand.yellowStop, go: rand.yellowGo });
check('acak: pose tidak melompat saat hitung ulang', rand.maxJump < 0.01, rand.maxJump);
check('acak: rute tidak melawan satu arah', rand.onewayBad === 0, rand.onewayBad);

// 3. perencana buta lampu, perisai menyala: perisai sendiri harus mencegah semua terobosan
const blind = { trips: 0, arrived: 0, redRuns: 0, clamps: 0, shieldBrakes: 0, yellowGo: 0, yellowStop: 0, replans: 0, maxJump: 0, onewayBad: 0, simHours: 0 };
t0 = 3;
for (const a of ids) for (const b of ids) {
  if (a === b) continue;
  drive(a, b, { t0, faults: { plannerBlind: true }, tally: blind });
  t0 += 17.1;
}
check('perisai sendiri: 0 terobos lampu merah', blind.redRuns === 0, blind);
check('perisai sendiri: perisai benar-benar bekerja', blind.shieldBrakes > 0, blind.shieldBrakes);

// 4. perencana buta dan perisai mati: pemantau harus menghitung terobosan
const broken = { trips: 0, arrived: 0, redRuns: 0, clamps: 0, shieldBrakes: 0, yellowGo: 0, yellowStop: 0, replans: 0, maxJump: 0, onewayBad: 0, simHours: 0 };
t0 = 5;
for (const a of ids) for (const b of ids) {
  if (a === b) continue;
  drive(a, b, { t0, faults: { plannerBlind: true, shieldOff: true }, tally: broken });
  t0 += 13.3;
}
check('pemantau mendeteksi terobosan saat perisai mati', broken.redRuns > 0, broken.redRuns);

out.totals = { pairs, rand, trap, blind, broken };
console.log(JSON.stringify(out));
"""


def main():
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "rute_model.mjs")
        with open(path, "w") as f:
            f.write(SCRIPT.replace("%ROOT%", json.dumps(ROOT)))
        res = subprocess.run(["node", path], capture_output=True, text=True, timeout=600)
    if res.returncode != 0:
        print(res.stdout)
        print(res.stderr)
        sys.exit(1)
    out = json.loads(res.stdout.strip().splitlines()[-1])
    failed = [c for c in out["checks"] if not c["ok"]]
    for c in out["checks"]:
        print(("OK   " if c["ok"] else "GAGAL") + " " + c["name"] + ("" if c["ok"] else f"  {c['info']}"))
    print("timing:", out["timing"], "vMax km/jam:", round(out["vMaxKmh"], 1), "pengendali lampu:", out["controllers"])
    for k, v in out["totals"].items():
        print(k, {kk: (round(vv, 3) if isinstance(vv, float) else vv) for kk, vv in v.items()})
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
