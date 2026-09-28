// Pemeriksaan mandiri lintasan pelajaran Kendali terhadap data OSM (dijalankan dengan Node).
// Pemakaian: node tests/kontrol_verify_route.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { parseMap } = await import(ROOT + '/js/engine/osm2d.js');
const { buildTrack, zoneAt } = await import(ROOT + '/js/lessons/kontrol/track.js');
const map = parseMap(JSON.parse(fs.readFileSync(ROOT + '/js/data/machung-2d.json', 'utf8')));
const track = buildTrack(map);
const graph = map.graph({ cost: 'length' });
console.log('length', track.length.toFixed(1), 'n', track.ref.points.length, 'roadWidth', track.roadWidth, 'widthFromOsm', track.widthFromOsm);
console.log('zones', track.zones.map((z) => ({ s0: +z.s0.toFixed(1), s1: +z.s1.toFixed(1), rb: { x: z.roundabout.x, y: z.roundabout.y, r: z.roundabout.radius } })));
// ruas yang dilalui: nama, satu arah, arah dilalui
const rr = [];
for (const r of track.roads) rr.push(r);
const names = {};
for (const r of track.roads) names[r.name || '(tanpa nama)'] = (names[r.name || '(tanpa nama)'] || 0) + r.length;
console.log('road names (m):', Object.fromEntries(Object.entries(names).map(([k, v]) => [k, Math.round(v)])));
console.log('classes:', [...new Set(track.roads.map((r) => r.cls || r.class || r.highway))]);
console.log('oneway flags:', track.roads.map((r) => (r.oneway ? 1 : 0)).join(''));
console.log('lanes:', [...new Set(track.roads.map((r) => r.lanes))], 'widths:', [...new Set(track.roads.map((r) => r.width))], 'widthFromOsm:', [...new Set(track.roads.map((r) => r.widthFromOsm))]);
// cek arah: untuk tiap ruas satu arah, arah jalur acuan harus searah a->b (oneway=1) atau sesuai tag
const ref = track.ref;
let bad = 0, checked = 0;
for (const r of track.roads) {
  if (!r.oneway) continue;
  const pts = r.points;
  const mid = Math.floor(pts.length / 2);
  const a = pts[Math.max(0, mid - 1)], b = pts[Math.min(pts.length - 1, mid)];
  if (a === b) continue;
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const c = ref.closest(mx, my);
  if (c.dist > 4) continue;
  const dirRoad = Math.atan2(b.y - a.y, b.x - a.x) + (r.oneway === -1 ? Math.PI : 0);
  const d = Math.atan2(Math.sin(c.heading - dirRoad), Math.cos(c.heading - dirRoad));
  checked++;
  if (Math.abs(d) > Math.PI / 2) { bad++; console.log('WRONG WAY', r.id, r.name, r.oneway, d.toFixed(2)); }
}
console.log('oneway direction check: checked', checked, 'wrong', bad);
console.log('oneway values seen', [...new Set(map.roads.map((r) => r.oneway))]);
// jarak jalur acuan ke garis tengah jalan terdekat (harus kecil, jalur mengikuti jalan)
let maxOff = 0, sumOff = 0, cnt = 0, worst = null;
for (let s = 0; s < track.length; s += 1) {
  const p = ref.sample(s);
  const hit = map.nearestRoad(p.x, p.y);
  if (!hit) continue;
  const w = hit.road.width / 2;
  if (hit.dist > maxOff) { maxOff = hit.dist; worst = { s, name: hit.road.name, w: hit.road.width, x: p.x.toFixed(1), y: p.y.toFixed(1) }; }
  sumOff += hit.dist; cnt++;
}
console.log('ref offset from nearest road centerline: max', maxOff.toFixed(2), 'mean', (sumOff / cnt).toFixed(2), worst);
// bundaran: arah putaran (searah jarum jam di layar untuk lalu lintas kiri)
for (const z of track.zones) {
  const rb = z.roundabout;
  let turn = 0;
  const L = track.length;
  const len = (((z.s1 - z.s0) % L) + L) % L;
  let prev = null;
  for (let d = 0; d <= len; d += 1) {
    const p = ref.sample(z.s0 + d);
    const ang = Math.atan2(p.y - rb.y, p.x - rb.x);
    if (prev != null) turn += Math.atan2(Math.sin(ang - prev), Math.cos(ang - prev));
    prev = ang;
  }
  console.log('roundabout', rb.x, rb.y, 'r', rb.radius, 'sweep deg', (turn * 180 / Math.PI).toFixed(0), turn > 0 ? 'clockwise on screen (y down)' : 'counterclockwise on screen');
  console.log('  rb roads', rb.roads.map((r) => ({ id: r.id, w: r.width, name: r.name, oneway: r.oneway })).slice(0, 3), 'keys', Object.keys(rb));
  // jarak minimum jalur ke pusat
  let dmin = Infinity;
  for (let d = 0; d <= len; d += 0.5) { const p = ref.sample(z.s0 + d); dmin = Math.min(dmin, Math.hypot(p.x - rb.x, p.y - rb.y)); }
  console.log('  min dist ref to rb center', dmin.toFixed(2));
}
// nama tempat di dekat lintasan
const places = map.places || [];
console.log('places near loop:', places.filter((pl) => pl.x > track.bounds.minX - 150 && pl.x < track.bounds.maxX + 150 && pl.y > track.bounds.minY - 150 && pl.y < track.bounds.maxY + 150).map((p) => p.name));
console.log('signals in map', (map.signals || []).length);
console.log('start', ref.sample(0), 'bounds', track.bounds);
// kelengkungan
let kmax = 0; let smax = 0;
for (let i = 0; i < track.curvature.length; i++) { if (Math.abs(track.curvature[i]) > kmax) { kmax = Math.abs(track.curvature[i]); smax = i * track.spacing; } }
console.log('max curvature', kmax.toFixed(4), 'radius', (1 / kmax).toFixed(1), 'at s', smax.toFixed(0), 'zone', !!zoneAt(track, smax));
let kmaxOut = 0, sOut = 0;
for (let i = 0; i < track.curvature.length; i++) { const s = i * track.spacing; if (!zoneAt(track, s) && Math.abs(track.curvature[i]) > kmaxOut) { kmaxOut = Math.abs(track.curvature[i]); sOut = s; } }
console.log('max curvature outside zones', kmaxOut.toFixed(4), 'radius', (1 / kmaxOut).toFixed(1), 'at s', sOut.toFixed(0));
