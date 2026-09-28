"""Uji model pelajaran Perencanaan Rute di peramban (QA independen, port 8135).

Memeriksa: biaya A* = biaya Dijkstra, A* dengan h = 0 sama dengan Dijkstra, heuristik
admissible dan konsisten, waktu rute = biaya / kecepatan, dan waktu tempuh mobil di simulasi
sama dengan perkiraan waktu rute.
"""
import json
import sys

sys.path.insert(0, "/Users/mcdonny/Downloads/ndur/driverless-sim/tests")
from rute_indep_util import Session  # noqa: E402

JS = """
async () => {
  const { createCity, FREE_SPEED, CELL } = await import('/js/lessons/rute/city.js');
  const { createCar } = await import('/js/lessons/rute/car.js');
  const { findPath, createSearch } = await import('/js/engine/planning.js');
  const city = createCity();
  const mover = createCar(city);
  let seed = 987654321;
  const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
  const roads = city.roadCells;
  const r = { trials: 0, costMismatch: 0, foundMismatch: 0, h0Mismatch: 0, aFewer: 0, aEqual: 0, aMore: 0,
              timeMismatch: 0, hViolation: 0, hInconsistent: 0, driveMismatch: [], driveChecked: 0 };
  for (let t = 0; t < 400; t++) {
    city.clear();
    const nClose = Math.floor(rnd() * 16);
    const nJam = Math.floor(rnd() * 50);
    for (let k = 0; k < nClose; k++) city.setClosed(roads[Math.floor(rnd() * roads.length)], true);
    for (let k = 0; k < nJam; k++) { const c = roads[Math.floor(rnd() * roads.length)]; if (!city.closed[c]) city.setJam(c, true); }
    const open = roads.filter((i) => !city.closed[i]);
    const s = open[Math.floor(rnd() * open.length)];
    const g = open[Math.floor(rnd() * open.length)];
    if (s === g) continue;
    // pelajaran menjaga start dan tujuan tidak pernah macet
    city.setJam(s, false);
    city.setJam(g, false);
    const m = city.minCost();
    const hL = (a, b) => city.grid.heuristic(a, b) * m * (1 + 1e-4);
    const A = findPath(city.grid, s, g, { algorithm: 'astar', heuristic: hL });
    const D = findPath(city.grid, s, g, { algorithm: 'dijkstra' });
    const Z = findPath(city.grid, s, g, { algorithm: 'astar', heuristic: () => 0 });
    r.trials++;
    if (A.found !== D.found) { r.foundMismatch++; continue; }
    if (Z.expanded !== D.expanded || Z.cost !== D.cost) r.h0Mismatch++;
    if (!A.found) continue;
    if (Math.abs(A.cost - D.cost) > 1e-6) r.costMismatch++;
    if (A.expanded < D.expanded) r.aFewer++; else if (A.expanded === D.expanded) r.aEqual++; else r.aMore++;
    const meas = city.measure(A.path);
    if (Math.abs(meas.time - A.cost / FREE_SPEED) > 1e-6) r.timeMismatch++;
    // admissible dan konsisten (tanpa faktor pemecah seri)
    const h = (a) => city.grid.heuristic(a, g) * m;
    for (const n of open) {
      for (const [nb, c] of city.grid.neighbors(n)) if (h(n) > c + h(nb) + 1e-9) r.hInconsistent++;
    }
    // admissible: h(n) <= biaya sebenarnya n -> g (hitung dengan Dijkstra dari n, sampel 10 node)
    for (let k = 0; k < 10; k++) {
      const n = open[Math.floor(rnd() * open.length)];
      const P = findPath(city.grid, n, g, { algorithm: 'dijkstra' });
      if (P.found && h(n) > P.cost + 1e-9) r.hViolation++;
    }
    // waktu tempuh mobil (simulasi) dibanding perkiraan
    if (r.driveChecked < 60) {
      mover.setRoute(A.path);
      mover.car.state = 'driving';
      let steps = 0;
      while (mover.car.state === 'driving' && steps < 1e6) { mover.update(1 / 60); steps++; }
      const endJam = !!city.jam[s] || !!city.jam[g];
      const diff = mover.car.elapsed - meas.time;
      if (Math.abs(diff) > 0.05) r.driveMismatch.push({ plan: meas.time, drive: +mover.car.elapsed.toFixed(2), startJam: !!city.jam[s], goalJam: !!city.jam[g] });
      r.driveChecked++;
    }
  }
  return r;
}
"""

with Session() as S:
    S.go("#/pelajaran/rute", 800)
    res = S.page.evaluate(JS)
    res["errors"] = S.errors
    print(json.dumps(res, indent=1))
