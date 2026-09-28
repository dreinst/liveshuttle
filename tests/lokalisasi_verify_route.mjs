// Pemeriksaan data rute Lokalisasi terhadap peta OSM (tanpa browser): arah satu arah, nama jalan,
// sisi lajur (lalu lintas kiri), zona gedung tinggi, landmark, zebra cross, trotoar.
// Pemakaian: node tests/lokalisasi_verify_route.mjs
import fs from 'node:fs';
import { parseMap } from '../js/engine/osm2d.js';
import { buildRoute } from '../js/lessons/lokalisasi/route.js';

const map = parseMap(JSON.parse(fs.readFileSync(new URL('../js/data/malang-center.json', import.meta.url), 'utf8')));
const route = buildRoute(map);
const { lanePath, samples } = route;
const out = { length: +route.length.toFixed(1), streets: route.streetNames, roads: [], wrongWay: 0, sideViolations: 0 };
// arah: untuk tiap sampel, bandingkan arah rute dengan arah poligaris jalan satu arah (a -> b)
function roadDir(road, x, y) {
  let best = null;
  for (let i = 0; i < road.points.length - 1; i++) {
    const a = road.points[i], b = road.points[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2));
    const d = Math.hypot(x - a.x - dx * t, y - a.y - dy * t);
    if (!best || d < best.d) best = { d, h: Math.atan2(dy, dx), side: (dx * (y - a.y) - dy * (x - a.x)) / Math.sqrt(l2) };
  }
  return best;
}
const perRoad = new Map();
for (const s of samples) {
  const r = s.road;
  const d = roadDir(r, s.x, s.y);
  const dh = Math.atan2(Math.sin(s.heading - d.h), Math.cos(s.heading - d.h));
  const along = Math.abs(dh) < Math.PI / 2 ? 1 : -1;
  // side > 0: titik di kanan poligaris (y ke bawah, cross dx*dy'... ) ; hitung sisi relatif arah gerak
  const leftOfTravel = -d.side * along; // positif = kiri arah gerak
  let e = perRoad.get(r.id);
  if (!e) perRoad.set(r.id, (e = { id: r.id, name: r.name, cls: r.cls, oneway: r.oneway, lanes: r.lanes, width: r.width, widthFromOsm: r.widthFromOsm, osm: r.osm, n: 0, against: 0, leftSum: 0 }));
  e.n++;
  if (along < 0) e.against++;
  e.leftSum += leftOfTravel;
}
for (const e of perRoad.values()) {
  e.meanLeftOfCenter = +(e.leftSum / e.n).toFixed(2);
  delete e.leftSum;
  if (e.oneway && e.against > e.n * 0.2) out.wrongWay++;
  if (!e.oneway && e.meanLeftOfCenter <= 0) out.sideViolations++;
  out.roads.push(e);
}
out.zones = route.zones.map((z) => ({ s0: +z.s0.toFixed(0), len: z.length, name: z.name, maxH: z.maxHeight, osmHeights: z.osmHeights, named: z.buildings.filter((b) => b.name).map((b) => `${b.name} ${b.height}m${b.heightFromOsm ? ' OSM' : ''}`) }));
out.skyMin = Math.min(...samples.map((s) => s.sky)).toFixed(0);
out.landmarks = { total: route.landmarks.length, corners: route.landmarks.filter((l) => l.kind === 'sudut').length, names: [...new Set(route.landmarks.filter((l) => l.name).map((l) => l.name))] };
out.crossing = route.crossing ? { street: route.crossing.street, marked: route.crossing.marked, osm: route.crossing.osm, s: +route.crossing.s.toFixed(1), length: route.crossing.length } : null;
out.walkways = route.walkways.map((w) => ({ s0: w.s0, side: w.side, n: w.pts.length }));
out.buildings = { total: map.buildings.length, withOsmHeight: map.buildings.filter((b) => b.heightFromOsm).length };
// nama tempat di peta dekat rute
out.placesNear = map.places.filter((p) => lanePath.closest(p.x, p.y).dist < 60).map((p) => p.name);
// jalan dua arah di rute: apakah lajur berada di kiri garis tengah?
fs.writeFileSync('/tmp/lv/route.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
