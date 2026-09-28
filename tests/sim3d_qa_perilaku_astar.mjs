// A* dari lajur kanan (lajur 1) dengan lockLane, tujuan lurus 1 sampai 3 ruas ke depan.
// Pada lalu lintas kiri, mobil seharusnya kembali ke lajur kiri (lajur 0) begitu bisa.
import { buildGraph, findRoute, routeItems } from '../js/sim3d/roadgraph.js';
const g = buildGraph();
const start = g.segs.find((s) => s.a.i === 0 && s.a.j === 2 && s.k === 0); // ruas ke timur
const chain = [start];
for (let i = 0; i < 3; i++) {
  const last = chain[chain.length - 1];
  chain.push(g.segs.find((s) => s.a === last.b && s.k === 0));
}
for (let n = 1; n <= 3; n++) {
  const goal = chain[n];
  for (const lock of [true, false]) {
    const res = findRoute(g, start.lanes[1], 60, goal, 38, { lockLane: lock });
    const items = routeItems(res.lanes).map((it) => (it.type === 'road' ? `R[${it.kStart}->${it.kEnd}]` : `C${it.lane.move}${it.lane.fromLane.k}${it.lane.toLane.k}`)).join(' ');
    console.log(`tujuan ${n} ruas ke depan, lockLane=${lock}: ${items}`);
  }
}
