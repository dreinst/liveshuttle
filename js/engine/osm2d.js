// Peta OpenStreetMap untuk pelajaran 2D: memuat berkas ringkas di js/data/, proyeksi ke meter
// lokal, uji klik (jalan atau simpang terdekat), graf rute yang cocok dengan planning.js, dan
// penggambar peta bergaya situs (jalan dengan tepi, area hijau, gedung, nama jalan, atribusi).
//
//   import { loadMap, createMapRenderer } from '../engine/osm2d.js';
//   const map = await loadMap('machung');            // 'machung' | 'malang-roads' | 'malang-center'
//   const renderer = createMapRenderer(map);
//   // di render():  const g = view.begin();  renderer.draw(g, view);  ...gambar kendaraan...
//   const graph = map.graph({ cost: 'time' });       // RoadGraph, turunan Graph dari planning.js
//   const search = graph.search(startNode, goalNode, { algorithm: 'astar' });
//
// Data peta © Kontributor OpenStreetMap (ODbL). Atribusi wajib tampil di setiap peta; penggambar
// menggambarnya otomatis di pojok kanan bawah. Lebar jalan, jumlah lajur, kecepatan, dan tinggi
// gedung sebagian besar PERKIRAAN (lihat docs/ENGINE.md bagian osm2d).
// Semua koordinat dalam meter, x ke timur, y ke SELATAN (sama dengan konvensi engine).

import { COLORS, FONT, withAlpha } from './theme.js';
import { TAU, clamp } from './math.js';
import { Graph, createSearch, findPath } from './planning.js';
import { Path, closestPointOnSegment, pointInPolygon, polygonCentroid, offsetPolyline, polylineLength } from './geometry.js';

export const OSM_ATTRIBUTION = '© Kontributor OpenStreetMap';

/** Berkas data bawaan. Kunci dipakai oleh loadMap(id). */
export const MAP_FILES = Object.freeze({
  machung: new URL('../data/machung-2d.json', import.meta.url).href,
  'malang-roads': new URL('../data/malang-roads.json', import.meta.url).href,
  'malang-center': new URL('../data/malang-center.json', import.meta.url).href,
});

/** Kelas jalan dari yang terpenting. Indeks = peringkat (rank). */
export const ROAD_CLASSES = Object.freeze([
  'trunk',
  'trunk_link',
  'primary',
  'primary_link',
  'secondary',
  'secondary_link',
  'tertiary',
  'tertiary_link',
  'unclassified',
  'residential',
  'living_street',
  'service',
  'track',
  'pedestrian',
  'footway',
  'path',
  'steps',
  'cycleway',
]);

/** Kelas yang boleh dilalui mobil dan shuttle (dipakai graf rute secara bawaan). */
export const DRIVABLE_CLASSES = Object.freeze([
  'trunk',
  'trunk_link',
  'primary',
  'primary_link',
  'secondary',
  'secondary_link',
  'tertiary',
  'tertiary_link',
  'unclassified',
  'residential',
  'living_street',
  'service',
]);

/** Nama kelas jalan dalam bahasa Indonesia untuk teks pelajaran. */
export const ROAD_CLASS_LABELS = Object.freeze({
  trunk: 'jalan arteri utama',
  trunk_link: 'jalan penghubung arteri',
  primary: 'jalan arteri',
  primary_link: 'jalan penghubung arteri',
  secondary: 'jalan kolektor',
  secondary_link: 'jalan penghubung kolektor',
  tertiary: 'jalan kolektor kecil',
  tertiary_link: 'jalan penghubung',
  unclassified: 'jalan lokal',
  residential: 'jalan perumahan',
  living_street: 'gang',
  service: 'jalan layanan',
  track: 'jalan tanah',
  pedestrian: 'jalan pejalan kaki',
  footway: 'jalan setapak',
  path: 'jalan setapak',
  steps: 'tangga',
  cycleway: 'jalur sepeda',
});

const PED_CLASSES = new Set(['pedestrian', 'footway', 'path', 'steps', 'cycleway', 'track']);
const RANK = new Map(ROAD_CLASSES.map((c, i) => [c, i]));
const DRIVABLE = new Set(DRIVABLE_CLASSES);

// ---------- proyeksi ----------

/** Meter per derajat lintang dan bujur pada lintang lat0 (rumus deret WGS84). */
export function metersPerDegree(lat0) {
  const p = (lat0 * Math.PI) / 180;
  return {
    lat: 111132.954 - 559.822 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p),
    lon: 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p) + 0.118 * Math.cos(5 * p),
  };
}

/** Lintang/bujur ke meter lokal { x (timur), y (selatan) } menurut proyeksi sebuah berkas. */
export function project(lat, lon, proj) {
  return { x: (lon - proj.lon0) * proj.mPerDegLon, y: (proj.lat0 - lat) * proj.mPerDegLat };
}

/** Meter lokal ke { lat, lon }. */
export function unproject(x, y, proj) {
  return { lat: proj.lat0 - y / proj.mPerDegLat, lon: proj.lon0 + x / proj.mPerDegLon };
}

// ---------- indeks ruang sederhana ----------

class GridIndex {
  constructor(cell) {
    this.cell = cell;
    this.cells = new Map();
    this.stamp = 0;
  }
  _key(ix, iy) {
    return ix * 73856093 + iy * 19349663;
  }
  insert(item, minX, minY, maxX, maxY) {
    const c = this.cell;
    for (let ix = Math.floor(minX / c); ix <= Math.floor(maxX / c); ix++) {
      for (let iy = Math.floor(minY / c); iy <= Math.floor(maxY / c); iy++) {
        const k = this._key(ix, iy);
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, (list = []));
        list.push(item);
      }
    }
  }
  /** Semua item yang sel-nya menyentuh persegi. Tiap item hanya sekali. */
  query(minX, minY, maxX, maxY) {
    const c = this.cell;
    const out = [];
    const stamp = ++this.stamp;
    for (let ix = Math.floor(minX / c); ix <= Math.floor(maxX / c); ix++) {
      for (let iy = Math.floor(minY / c); iy <= Math.floor(maxY / c); iy++) {
        const list = this.cells.get(this._key(ix, iy));
        if (!list) continue;
        for (const it of list) {
          if (it._q === stamp) continue;
          it._q = stamp;
          out.push(it);
        }
      }
    }
    return out;
  }
}

function bboxOf(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

function polyArea(points) {
  let a = 0;
  for (let i = 0, n = points.length; i < n; i++) {
    const p = points[i];
    const q = points[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a / 2);
}

const overlaps = (b, r) => b.maxX >= r.minX && b.minX <= r.maxX && b.maxY >= r.minY && b.minY <= r.maxY;

function unpackPoints(coords, start, i) {
  const out = [];
  for (let k = start[i]; k < start[i + 1]; k++) out.push({ x: coords[2 * k], y: coords[2 * k + 1] });
  return out;
}

// ---------- geometri jalur ----------

/**
 * Geser polyline ke samping dengan besar geseran per titik (positif = ke KIRI arah gerak).
 * Sama seperti geometry.offsetPolyline, tetapi offsets boleh berbeda di tiap titik.
 */
export function offsetPolylineVar(points, offsets) {
  const n = points.length;
  if (n < 2) return points.map((p) => ({ x: p.x, y: p.y }));
  const normals = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    const l = Math.hypot(dx, dy) || 1;
    normals.push({ x: dy / l, y: -dx / l });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    let nx;
    let ny;
    if (i === 0) ({ x: nx, y: ny } = normals[0]);
    else if (i === n - 1) ({ x: nx, y: ny } = normals[n - 2]);
    else {
      const a = normals[i - 1];
      const b = normals[i];
      nx = a.x + b.x;
      ny = a.y + b.y;
      const l = Math.hypot(nx, ny);
      if (l < 1e-6) ({ x: nx, y: ny } = b);
      else {
        nx /= l;
        ny /= l;
        const k = 1 / Math.max(nx * b.x + ny * b.y, 0.35);
        nx *= k;
        ny *= k;
      }
    }
    const o = offsets[i] ?? 0;
    out.push({ x: points[i].x + nx * o, y: points[i].y + ny * o });
  }
  return out;
}

/**
 * Bulatkan sudut polyline dengan kurva Bezier kuadrat berjari-jari kira-kira `radius` meter.
 * Cocok supaya kendaraan tidak berbelok patah di simpang. Titik awal dan akhir tetap.
 */
export function smoothCorners(points, radius = 4, segments = 6) {
  if (points.length < 3 || radius <= 0) return points.map((p) => ({ x: p.x, y: p.y }));
  const out = [{ x: points[0].x, y: points[0].y }];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1];
    const p = points[i];
    const b = points[i + 1];
    const la = Math.hypot(p.x - a.x, p.y - a.y);
    const lb = Math.hypot(b.x - p.x, b.y - p.y);
    if (la < 1e-6 || lb < 1e-6) continue;
    const turn = Math.abs(Math.atan2((p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x), (p.x - a.x) * (b.x - p.x) + (p.y - a.y) * (b.y - p.y)));
    if (turn < 0.12) {
      out.push({ x: p.x, y: p.y });
      continue;
    }
    const r = Math.min(radius, la * 0.45, lb * 0.45);
    const p0 = { x: p.x - ((p.x - a.x) / la) * r, y: p.y - ((p.y - a.y) / la) * r };
    const p2 = { x: p.x + ((b.x - p.x) / lb) * r, y: p.y + ((b.y - p.y) / lb) * r };
    for (let k = 0; k <= segments; k++) {
      const t = k / segments;
      const u = 1 - t;
      out.push({ x: u * u * p0.x + 2 * u * t * p.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * p.y + t * t * p2.y });
    }
  }
  const last = points[points.length - 1];
  out.push({ x: last.x, y: last.y });
  // buang titik yang berimpit
  return out.filter((p, i) => i === 0 || Math.hypot(p.x - out[i - 1].x, p.y - out[i - 1].y) > 1e-4);
}

/** Geseran pusat lajur dari garis tengah jalan (positif = kiri arah gerak), lalu lintas kiri. */
export function laneOffset(road, lane = 0) {
  const total = Math.max(1, road.lanes || 1);
  const perDir = road.oneway ? total : Math.max(1, Math.floor(total / 2));
  const laneW = road.width / (road.oneway ? total : Math.max(2, perDir * 2));
  const i = clamp(lane, 0, perDir - 1);
  return road.width / 2 - (i + 0.5) * laneW;
}

// ---------- peta ----------

/** Peta hasil loadMap(). Perlakukan datanya sebagai baca saja (dipakai bersama). */
export class OsmMap {
  constructor(json) {
    const meta = json.meta || {};
    this.meta = meta;
    this.id = meta.id || 'peta';
    this.title = meta.title || '';
    this.attribution = meta.attribution || OSM_ATTRIBUTION;
    this.projection = meta.projection;
    this.bounds = { ...json.bounds };
    this.speedKmh = meta.speedKmh || {};
    const classes = meta.classes || ROAD_CLASSES;
    const names = json.names || [''];
    this.names = names;

    // simpang
    const nf = json.nodes || [];
    this.nodes = [];
    for (let i = 0; i < nf.length; i += 2) this.nodes.push({ id: i / 2, x: nf[i], y: nf[i + 1], roads: [] });

    // ruas jalan
    const E = json.edges || { count: 0 };
    const geom = json.edgeGeom || [];
    this.roads = [];
    for (let i = 0; i < (E.count || 0); i++) {
      const a = this.nodes[E.a[i]];
      const b = this.nodes[E.b[i]];
      const points = [{ x: a.x, y: a.y }];
      for (let k = E.geomStart[i]; k < E.geomStart[i + 1]; k++) points.push({ x: geom[2 * k], y: geom[2 * k + 1] });
      points.push({ x: b.x, y: b.y });
      const cls = classes[E.cls[i]] || 'unclassified';
      const flags = E.flags[i] || 0;
      const maxspeed = E.maxspeed?.[i] || 0;
      const road = {
        id: i,
        a: a.id,
        b: b.id,
        cls,
        rank: RANK.get(cls) ?? 99,
        classLabel: ROAD_CLASS_LABELS[cls] || cls,
        name: names[E.name[i]] || '',
        oneway: !!(flags & 1),
        roundabout: !!(flags & 2),
        widthFromOsm: !!(flags & 4),
        lanesFromOsm: !!(flags & 8),
        bridge: !!(flags & 16),
        maxspeedFromOsm: !!(flags & 32),
        drivable: DRIVABLE.has(cls),
        width: E.width[i],
        lanes: E.lanes[i],
        maxspeed,
        speed: (maxspeed || this.speedKmh[cls] || 20) / 3.6,
        length: E.length[i],
        points,
        bbox: bboxOf(points),
        osm: E.osm ? E.osm[i] : null,
      };
      this.roads.push(road);
      a.roads.push(road);
      if (b !== a) b.roads.push(road);
    }
    for (const n of this.nodes) n.degree = n.roads.length;

    // gedung, hijau, air
    this.buildings = [];
    const B = json.buildings;
    const btypes = json.buildingTypes || [''];
    if (B) {
      for (let i = 0; i < B.count; i++) {
        const points = unpackPoints(B.coords, B.start, i);
        if (points.length < 3) continue;
        const c = polygonCentroid(points);
        const bb = bboxOf(points);
        this.buildings.push({
          // id berupa teks supaya tidak bentrok dengan id kendaraan saat dipakai sebagai target sensor
          id: `${this.id}-gedung-${i}`,
          index: i,
          kind: 'building',
          label: 'Gedung',
          // pusat (titik berat) juga sebagai x, y: sensors.js dan pemilih objek memakai x, y
          x: c.x,
          y: c.y,
          points,
          type: btypes[B.type[i]] || 'yes',
          name: names[B.name[i]] || '',
          height: B.height ? B.height[i] : null,
          heightFromOsm: B.heightFromOsm ? !!B.heightFromOsm[i] : false,
          area: polyArea(points),
          bbox: bb,
          _centroid: c,
          _br: Math.hypot(bb.maxX - bb.minX, bb.maxY - bb.minY) / 2 + Math.hypot(c.x - (bb.minX + bb.maxX) / 2, c.y - (bb.minY + bb.maxY) / 2),
        });
      }
    }
    this.green = this._areas(json.green, names);
    this.water = [];
    const W = json.water;
    if (W) {
      for (let i = 0; i < W.count; i++) {
        const points = unpackPoints(W.coords, W.start, i);
        if (points.length >= 2) this.water.push({ id: i, points, kind: W.kind[i], name: names[W.name[i]] || '', bbox: bboxOf(points) });
      }
    }
    this.places = (json.places || []).map((p) => ({ ...p }));
    this.campus = null;
    if (json.campus) {
      const pts = [];
      const cc = json.campus.coords;
      for (let i = 0; i < cc.length; i += 2) pts.push({ x: cc[i], y: cc[i + 1] });
      this.campus = { name: json.campus.name, x: json.campus.x, y: json.campus.y, area: json.campus.area, points: pts, bbox: bboxOf(pts) };
    }
    this.roundabouts = (json.roundabouts || []).map((r) => ({
      x: r.x,
      y: r.y,
      radius: r.radius,
      closed: r.closed,
      name: typeof r.name === 'number' ? names[r.name] || '' : r.name || '',
      roads: r.edges.map((i) => this.roads[i]).filter(Boolean),
    }));
    const point = (s) => ({
      x: s.x,
      y: s.y,
      node: this.nodes[s.node] || null,
      road: s.edge >= 0 ? this.roads[s.edge] || null : null,
      s: s.s || 0,
      type: s.type,
      osm: s.osm,
    });
    this.signals = (json.signals || []).map(point);
    this.crossings = (json.crossings || []).map(point);

    this._roadIndex = null;
    this._nodeIndex = null;
    this._buildingIndex = null;
    this._streets = null;
  }

  _areas(A, names) {
    const out = [];
    if (!A) return out;
    for (let i = 0; i < A.count; i++) {
      const points = unpackPoints(A.coords, A.start, i);
      if (points.length >= 3) out.push({ id: i, points, kind: A.kind[i], name: names[A.name[i]] || '', bbox: bboxOf(points) });
    }
    return out;
  }

  /** Lintang/bujur ke meter di peta ini. */
  project(lat, lon) {
    return project(lat, lon, this.projection);
  }

  /** Meter di peta ini ke { lat, lon }. */
  unproject(x, y) {
    return unproject(x, y, this.projection);
  }

  /** Ubah titik dari peta ini ke koordinat peta lain (misalnya machung ke malang-center). */
  toMap(other, x, y) {
    const ll = this.unproject(x, y);
    return other.project(ll.lat, ll.lon);
  }

  // ---------- indeks dan uji klik ----------

  _roads() {
    if (!this._roadIndex) {
      this._roadIndex = new GridIndex(60);
      for (const r of this.roads) {
        const pts = r.points;
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i];
          const b = pts[i + 1];
          const seg = { road: r, i };
          this._roadIndex.insert(seg, Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y));
        }
      }
    }
    return this._roadIndex;
  }

  /**
   * Jalan terdekat dari titik (x, y).
   * opts: { maxDist = 80 (m), filter(road) => boolean, drivable (hanya kelas yang bisa dilalui mobil) }
   * Hasil: { road, x, y, dist, s (m dari simpang a), heading (arah a ke b di titik itu), lateral (positif = kiri arah a ke b) } atau null.
   */
  nearestRoad(x, y, { maxDist = 80, filter = null, drivable = false } = {}) {
    const index = this._roads();
    let r = Math.min(maxDist, 40);
    let best = null;
    for (;;) {
      for (const seg of index.query(x - r, y - r, x + r, y + r)) {
        const road = seg.road;
        if (drivable && !road.drivable) continue;
        if (filter && !filter(road)) continue;
        const a = road.points[seg.i];
        const b = road.points[seg.i + 1];
        const q = closestPointOnSegment(x, y, a.x, a.y, b.x, b.y);
        const d = Math.hypot(x - q.x, y - q.y);
        if (d <= maxDist && (!best || d < best.dist)) best = { road, seg: seg.i, q, a, b, dist: d };
      }
      if ((best && best.dist <= r) || r >= maxDist) break;
      r = Math.min(maxDist, r * 2);
    }
    if (!best) return null;
    const { road, seg, q, a, b } = best;
    let s = 0;
    for (let i = 0; i < seg; i++) s += Math.hypot(road.points[i + 1].x - road.points[i].x, road.points[i + 1].y - road.points[i].y);
    s += Math.hypot(q.x - a.x, q.y - a.y);
    const heading = Math.atan2(b.y - a.y, b.x - a.x);
    const lateral = (x - q.x) * Math.sin(heading) - (y - q.y) * Math.cos(heading);
    return { road, x: q.x, y: q.y, dist: best.dist, s, heading, lateral };
  }

  /** Simpang terdekat. opts: { maxDist = Infinity, filter(node) }. Hasil { node, dist } atau null. */
  nearestNode(x, y, { maxDist = Infinity, filter = null } = {}) {
    if (!this._nodeIndex) {
      this._nodeIndex = new GridIndex(80);
      for (const n of this.nodes) this._nodeIndex.insert(n, n.x, n.y, n.x, n.y);
    }
    const span = Math.max(this.bounds.maxX - this.bounds.minX, this.bounds.maxY - this.bounds.minY) * 2;
    let r = 60;
    let best = null;
    for (;;) {
      for (const n of this._nodeIndex.query(x - r, y - r, x + r, y + r)) {
        if (filter && !filter(n)) continue;
        const d = Math.hypot(n.x - x, n.y - y);
        if (d <= maxDist && (!best || d < best.dist)) best = { node: n, dist: d };
      }
      if ((best && best.dist <= r) || r >= Math.min(maxDist, span)) break;
      r *= 2;
    }
    return best;
  }

  /** Gedung yang memuat titik (x, y), atau null. */
  buildingAt(x, y) {
    if (!this._buildingIndex) {
      this._buildingIndex = new GridIndex(50);
      for (const b of this.buildings) this._buildingIndex.insert(b, b.bbox.minX, b.bbox.minY, b.bbox.maxX, b.bbox.maxY);
    }
    for (const b of this._buildingIndex.query(x, y, x, y)) {
      if (x >= b.bbox.minX && x <= b.bbox.maxX && y >= b.bbox.minY && y <= b.bbox.maxY && pointInPolygon(x, y, b.points)) return b;
    }
    return null;
  }

  /**
   * Gedung di dekat titik, siap dipakai sebagai target sensor atau castRay (bentuk poligon statis).
   * Tambahkan objekmu sendiri ke daftar ini, lalu berikan ke SensorRig.update().
   */
  buildingsNear(x, y, radius) {
    this.buildingAt(x, y); // pastikan indeks ada
    return this._buildingIndex
      .query(x - radius, y - radius, x + radius, y + radius)
      .filter((b) => Math.hypot(b._centroid.x - x, b._centroid.y - y) <= radius + b._br);
  }

  /** Semua ruas dengan nama tertentu (perbandingan tanpa huruf besar kecil). */
  roadsNamed(name) {
    const q = String(name).toLowerCase();
    return this.roads.filter((r) => r.name.toLowerCase() === q);
  }

  /** Tempat bernama pertama yang namanya memuat teks `query`, atau null. */
  findPlace(query) {
    const q = String(query).toLowerCase();
    return this.places.find((p) => p.name.toLowerCase().includes(q)) || null;
  }

  /** Persegi pembatas sekelompok benda (ruas, gedung, titik) ditambah padding meter. */
  boundsOf(items, pad = 0) {
    let b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const it of items) {
      const bb = it.bbox || (it.points ? bboxOf(it.points) : { minX: it.x, minY: it.y, maxX: it.x, maxY: it.y });
      b = { minX: Math.min(b.minX, bb.minX), minY: Math.min(b.minY, bb.minY), maxX: Math.max(b.maxX, bb.maxX), maxY: Math.max(b.maxY, bb.maxY) };
    }
    return { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
  }

  /** Persegi pembatas di sekitar titik (untuk view.fit). */
  boundsAround(x, y, halfWidth, halfHeight = halfWidth) {
    return { minX: x - halfWidth, minY: y - halfHeight, maxX: x + halfWidth, maxY: y + halfHeight };
  }

  /**
   * Garis pusat lajur di sebuah ruas (lalu lintas kiri).
   * opts: { forward = true (arah a ke b), lane = 0 (0 = lajur paling kiri) }. Hasil: Path.
   */
  lanePath(road, { forward = true, lane = 0 } = {}) {
    const pts = forward ? road.points : [...road.points].reverse();
    return new Path(offsetPolyline(pts, laneOffset(road, lane)));
  }

  /**
   * Jalan bernama yang disambung menjadi rantai panjang (untuk label dan daftar jalan).
   * Hasil: [{ name, rank, cls, points, length, roads }], diurutkan dari kelas terpenting.
   */
  streets() {
    if (this._streets) return this._streets;
    const byName = new Map();
    for (const r of this.roads) {
      if (!r.name || PED_CLASSES.has(r.cls)) continue;
      if (!byName.has(r.name)) byName.set(r.name, []);
      byName.get(r.name).push(r);
    }
    const out = [];
    for (const [name, roads] of byName) {
      const used = new Set();
      const atNode = new Map();
      for (const r of roads) {
        for (const n of [r.a, r.b]) {
          if (!atNode.has(n)) atNode.set(n, []);
          atNode.get(n).push(r);
        }
      }
      const other = (r, n) => (r.a === n ? r.b : r.a);
      const oriented = (r, from) => (r.a === from ? r.points : [...r.points].reverse());
      for (const start of roads) {
        if (used.has(start)) continue;
        used.add(start);
        let pts = [...start.points];
        const chainRoads = [start];
        // perpanjang ke depan dan ke belakang selama ada ruas bernama sama yang belum dipakai
        for (const dir of [1, -1]) {
          let node = dir === 1 ? start.b : start.a;
          for (;;) {
            const tail = dir === 1 ? pts[pts.length - 1] : pts[0];
            const prev = dir === 1 ? pts[pts.length - 2] : pts[1];
            const h0 = Math.atan2(tail.y - prev.y, tail.x - prev.x);
            let pick = null;
            let bestTurn = Infinity;
            for (const r of atNode.get(node) || []) {
              if (used.has(r)) continue;
              const rp = oriented(r, node);
              const h1 = Math.atan2(rp[1].y - rp[0].y, rp[1].x - rp[0].x);
              const turn = Math.abs(Math.atan2(Math.sin(h1 - h0), Math.cos(h1 - h0)));
              if (turn < bestTurn) {
                bestTurn = turn;
                pick = r;
              }
            }
            if (!pick || bestTurn > 1.2) break;
            used.add(pick);
            chainRoads.push(pick);
            const rp = oriented(pick, node);
            if (dir === 1) pts = pts.concat(rp.slice(1));
            else pts = [...rp].reverse().slice(0, -1).concat(pts);
            node = other(pick, node);
          }
        }
        const rank = Math.min(...chainRoads.map((r) => r.rank));
        out.push({ name, rank, cls: ROAD_CLASSES[rank] || chainRoads[0].cls, points: pts, length: polylineLength(pts), roads: chainRoads, bbox: bboxOf(pts) });
      }
    }
    out.sort((a, b) => a.rank - b.rank || b.length - a.length);
    this._streets = out;
    return out;
  }

  /** Graf rute baru (bisa diubah tanpa memengaruhi peta). Lihat RoadGraph. */
  graph(opts = {}) {
    return new RoadGraph(this, opts);
  }
}

const loaded = new Map();

/**
 * Muat peta. `id`: 'machung', 'malang-roads', 'malang-center', atau URL berkas lain berformat sama.
 * Hasil di-cache, jadi memanggilnya berkali-kali tidak mengunduh ulang.
 * opts.signal (AbortSignal): bila dibatalkan, janji ditolak dengan AbortError (unduhan tetap di-cache).
 */
export function loadMap(id, { signal = null } = {}) {
  const url = MAP_FILES[id] || id;
  if (!loaded.has(url)) {
    const p = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`Peta ${id} gagal dimuat (HTTP ${res.status}).`);
        return res.json();
      })
      .then((json) => new OsmMap(json));
    p.catch(() => loaded.delete(url));
    loaded.set(url, p);
  }
  const p = loaded.get(url);
  if (!signal) return p;
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Dibatalkan', 'AbortError'));
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** Buat OsmMap dari objek JSON yang sudah ada (misalnya untuk uji). */
export function parseMap(json) {
  return new OsmMap(json);
}

// ---------- graf rute ----------

/**
 * Graf rute di atas peta OSM. Turunan Graph dari planning.js, jadi createSearch, findPath,
 * setBlocked, dan setMultiplier bekerja seperti biasa. Node = id simpang peta (angka).
 * Setiap sisi punya data = { road, forward } (forward: bergerak dari road.a ke road.b).
 *
 * opts:
 *   classes         kelas jalan yang dipakai (bawaan DRIVABLE_CLASSES)
 *   cost            'length' (meter, bawaan) atau 'time' (detik, dari perkiraan kecepatan kelas)
 *   respectOneway   true (bawaan): jalan satu arah hanya punya sisi searah lalu lintas
 *   filter(road)    saringan tambahan
 *   component       'largest' (bawaan): hanya simpang di komponen terhubung kuat terbesar, jadi
 *                   dari simpang mana pun di graf selalu ada rute ke simpang lain di graf (selama
 *                   tidak ada ruas yang ditutup). 'all': semua simpang, rute bisa tidak ada karena
 *                   potongan peta dan jalan satu arah di tepi area.
 * Dua ruas sejajar di antara simpang yang sama digabung menjadi satu sisi (yang lebih murah).
 */
export class RoadGraph extends Graph {
  constructor(map, { classes = DRIVABLE_CLASSES, cost = 'length', respectOneway = true, filter = null, component = 'largest' } = {}) {
    super();
    this.map = map;
    this.costMode = cost === 'time' ? 'time' : 'length';
    const allow = new Set(classes);
    this.maxSpeed = 1;
    for (const road of map.roads) {
      if (!allow.has(road.cls)) continue;
      if (filter && !filter(road)) continue;
      if (road.a === road.b) continue;
      for (const id of [road.a, road.b]) if (!this.nodes.has(id)) this.addNode(id, { x: map.nodes[id].x, y: map.nodes[id].y });
      this.maxSpeed = Math.max(this.maxSpeed, road.speed);
      this._add(road, true);
      if (!road.oneway || !respectOneway) this._add(road, false);
    }
    this.droppedNodes = 0;
    if (component === 'largest') this._keepLargestComponent();
  }

  /** Buang simpang di luar komponen terhubung kuat (strongly connected) terbesar (Tarjan, iteratif). */
  _keepLargestComponent() {
    const index = new Map();
    const low = new Map();
    const onStack = new Set();
    const stack = [];
    let counter = 0;
    let best = null;
    for (const root of this.nodes.keys()) {
      if (index.has(root)) continue;
      const work = [[root, [...this.edges.get(root).keys()], 0]];
      index.set(root, counter);
      low.set(root, counter++);
      stack.push(root);
      onStack.add(root);
      while (work.length) {
        const top = work[work.length - 1];
        const [v, next] = top;
        if (top[2] < next.length) {
          const w = next[top[2]++];
          if (!index.has(w)) {
            index.set(w, counter);
            low.set(w, counter++);
            stack.push(w);
            onStack.add(w);
            work.push([w, [...this.edges.get(w).keys()], 0]);
          } else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
          continue;
        }
        work.pop();
        if (work.length) {
          const u = work[work.length - 1][0];
          low.set(u, Math.min(low.get(u), low.get(v)));
        }
        if (low.get(v) === index.get(v)) {
          const comp = [];
          let w;
          do {
            w = stack.pop();
            onStack.delete(w);
            comp.push(w);
          } while (w !== v);
          if (!best || comp.length > best.length) best = comp;
        }
      }
    }
    if (!best || best.length === this.nodes.size) return;
    const keep = new Set(best);
    for (const id of [...this.nodes.keys()]) {
      if (keep.has(id)) continue;
      this.nodes.delete(id);
      this.edges.delete(id);
      this.droppedNodes++;
    }
    for (const m of this.edges.values()) for (const to of [...m.keys()]) if (!keep.has(to)) m.delete(to);
  }

  _add(road, forward) {
    const from = forward ? road.a : road.b;
    const to = forward ? road.b : road.a;
    const base = this.costMode === 'time' ? road.length / road.speed : road.length;
    const old = this.edges.get(from).get(to);
    // dua ruas sejajar di antara simpang yang sama: simpan yang lebih murah
    if (old && old.base <= base) return;
    this.edges.get(from).set(to, { from, to, length: road.length, base, multiplier: 1, blocked: false, data: { road, forward } });
  }

  /** Jarak garis lurus (dibagi kecepatan tertinggi bila biaya berupa waktu). Selalu admissible. */
  heuristic(a, b) {
    const A = this.nodes.get(a);
    const B = this.nodes.get(b);
    if (!A || !B) return 0;
    const d = Math.hypot(B.x - A.x, B.y - A.y);
    return this.costMode === 'time' ? d / this.maxSpeed : d;
  }

  /** Simpang terdekat yang ada di graf ini. Hasil { node (objek simpang peta), id, dist } atau null. */
  nearestNode(x, y, opts = {}) {
    const hit = this.map.nearestNode(x, y, { ...opts, filter: (n) => this.nodes.has(n.id) && (!opts.filter || opts.filter(n)) });
    return hit ? { node: hit.node, id: hit.node.id, dist: hit.dist } : null;
  }

  /** Jalan terdekat yang dipakai graf ini, lihat OsmMap.nearestRoad. */
  nearestRoad(x, y, opts = {}) {
    return this.map.nearestRoad(x, y, { ...opts, filter: (r) => !!(this.edgeFor(r, true) || this.edgeFor(r, false)) && (!opts.filter || opts.filter(r)) });
  }

  /**
   * Sisi graf terdekat dari titik (misalnya klik). Arah dipilih dari sisi jalan yang diklik:
   * dengan lalu lintas kiri, klik di sisi kiri garis tengah (arah a ke b) berarti arah a ke b.
   * Jalan satu arah selalu memberi arah lalu lintasnya. Hasil { edge, road, forward, x, y, dist } atau null.
   */
  nearestEdge(x, y, opts = {}) {
    const hit = this.nearestRoad(x, y, opts);
    if (!hit) return null;
    const fwd = this.edgeFor(hit.road, true);
    const back = this.edgeFor(hit.road, false);
    const forward = !back ? true : !fwd ? false : hit.lateral >= 0;
    return { edge: forward ? fwd : back, road: hit.road, forward, x: hit.x, y: hit.y, dist: hit.dist };
  }

  /** Sisi graf untuk ruas tertentu dan arahnya, atau null. */
  edgeFor(road, forward = true) {
    const e = forward ? this.edge(road.a, road.b) : this.edge(road.b, road.a);
    return e && e.data.road === road ? e : null;
  }

  /** Tutup atau buka ruas (kedua arah). */
  closeRoad(road, closed = true) {
    for (const f of [true, false]) {
      const e = this.edgeFor(road, f);
      if (e) e.blocked = closed;
    }
  }

  isClosed(road) {
    const e = this.edgeFor(road, true) || this.edgeFor(road, false);
    return !!e?.blocked;
  }

  /** Pengali biaya ruas (misalnya 3 = macet). */
  setRoadMultiplier(road, multiplier) {
    for (const f of [true, false]) {
      const e = this.edgeFor(road, f);
      if (e) e.multiplier = multiplier;
    }
  }

  /** Titik ruas searah sisi e. */
  edgePoints(e) {
    const pts = e.data.road.points;
    return e.data.forward ? pts : [...pts].reverse();
  }

  /** Daftar { road, forward, edge } untuk jalur node. */
  routeRoads(nodePath) {
    const out = [];
    for (let i = 0; i < nodePath.length - 1; i++) {
      const e = this.edge(nodePath[i], nodePath[i + 1]);
      if (e) out.push({ road: e.data.road, forward: e.data.forward, edge: e });
    }
    return out;
  }

  /** Panjang jalur node dalam meter (menurut geometri jalan). */
  routeLength(nodePath) {
    return this.routeRoads(nodePath).reduce((sum, r) => sum + r.road.length, 0);
  }

  /** Perkiraan waktu tempuh (detik) dari kecepatan kelas jalan dan pengali macet. */
  routeTime(nodePath) {
    return this.routeRoads(nodePath).reduce((sum, r) => sum + (r.road.length / r.road.speed) * (r.edge.multiplier || 1), 0);
  }

  /**
   * Titik-titik rute mengikuti bentuk jalan.
   * opts: { keepLeft = false (geser ke pusat lajur kiri), lane = 0, smooth = 0 (jari-jari pembulatan sudut, m) }
   */
  routePoints(nodePath, { keepLeft = false, lane = 0, smooth = 0 } = {}) {
    const pts = [];
    const offs = [];
    for (const r of this.routeRoads(nodePath)) {
      const seg = r.forward ? r.road.points : [...r.road.points].reverse();
      const o = keepLeft ? laneOffset(r.road, lane) : 0;
      seg.forEach((p, i) => {
        if (i === 0 && pts.length) {
          const last = pts.length - 1;
          offs[last] = (offs[last] + o) / 2;
          return;
        }
        pts.push({ x: p.x, y: p.y });
        offs.push(o);
      });
    }
    let out = keepLeft ? offsetPolylineVar(pts, offs) : pts;
    if (smooth > 0) out = smoothCorners(out, smooth);
    return out;
  }

  /** Path (geometry.js) siap diikuti kendaraan. Opsi sama dengan routePoints. */
  routePath(nodePath, opts = {}) {
    const pts = this.routePoints(nodePath, opts);
    return pts.length >= 2 ? new Path(pts) : null;
  }

  /** Pencarian bertahap (lihat planning.createSearch). */
  search(start, goal, opts = {}) {
    return createSearch(this, start, goal, opts);
  }

  /** Cari rute langsung sampai selesai: { found, path, cost, expanded }. */
  findRoute(start, goal, opts = {}) {
    return findPath(this, start, goal, opts);
  }
}

// ---------- gaya gambar ----------

export const MAP_STYLE = Object.freeze({
  ground: COLORS.ground,
  green: { park: '#1a3a2a', grass: '#193626', wood: '#163324', farm: '#1c3524', pitch: '#1c4230', cemetery: '#1b3128' },
  pitchLine: 'rgba(163, 230, 53, 0.22)',
  water: '#1e4d6b',
  campusFill: 'rgba(45, 212, 191, 0.07)',
  campusLine: 'rgba(45, 212, 191, 0.6)',
  buildingShadow: 'rgba(0, 0, 0, 0.3)',
  building: '#2a3750',
  buildingEdge: '#3b4a66',
  buildingNamed: '#33415e',
  casing: '#3a4354',
  casingMajor: '#56607a',
  asphalt: COLORS.asphalt,
  asphaltMajor: '#343c4c',
  asphaltMinor: '#282e3a',
  footway: 'rgba(148, 163, 184, 0.45)',
  island: '#1d4a33',
  centerLine: COLORS.centerLine,
  laneLine: 'rgba(229, 231, 235, 0.7)',
  arrow: 'rgba(226, 232, 240, 0.32)',
  // mode ikhtisar (skala kecil): garis berwarna per kelas
  overview: {
    trunk: ['#f59e0b', 3.2],
    primary: ['#f59e0b', 3],
    secondary: ['#fbbf24', 2.4],
    tertiary: ['#e2e8f0', 1.7],
    link: ['#fcd34d', 1.4],
    minor: ['rgba(148, 163, 184, 0.55)', 1],
    tiny: ['rgba(100, 116, 139, 0.45)', 0.7],
  },
  label: '#e2e8f0',
  labelMinor: '#cbd5e1',
  labelHalo: 'rgba(11, 18, 32, 0.92)',
  place: 'rgba(203, 213, 225, 0.72)',
});

/** Batas skala (piksel per meter) antara mode ikhtisar (garis) dan mode jalan (aspal bertepi). */
export const STREET_SCALE = 1.2;

function overviewStyle(cls, S) {
  const o = S.overview;
  if (cls === 'trunk') return o.trunk;
  if (cls === 'primary') return o.primary;
  if (cls === 'secondary') return o.secondary;
  if (cls === 'tertiary') return o.tertiary;
  if (cls.endsWith('_link')) return o.link;
  if (cls === 'unclassified' || cls === 'residential') return o.minor;
  return o.tiny;
}

/** Lapisan bawaan. Semua bisa dimatikan lewat opsi layers. */
const DEFAULT_LAYERS = Object.freeze({
  green: true,
  water: true,
  campus: true,
  footways: true,
  roads: true,
  islands: true,
  markings: true,
  arrows: true,
  buildings: true,
  labels: true,
  places: false,
});

// "Permukaan" gambar: view asli atau kanvas cache. origin = titik dunia di kiri atas.
function surfaceFor(view) {
  const s = view.camera.scale;
  return {
    scale: s,
    dpr: view.dpr,
    width: view.width,
    height: view.height,
    originX: view.camera.x - view.width / 2 / s,
    originY: view.camera.y - view.height / 2 / s,
  };
}

function worldTransform(g, sf) {
  const k = sf.scale * sf.dpr;
  g.setTransform(k, 0, 0, k, -sf.originX * k, -sf.originY * k);
}

function screenTransform(g, sf) {
  g.setTransform(sf.dpr, 0, 0, sf.dpr, 0, 0);
}

function surfaceBounds(sf, pad = 0) {
  return {
    minX: sf.originX - pad,
    minY: sf.originY - pad,
    maxX: sf.originX + sf.width / sf.scale + pad,
    maxY: sf.originY + sf.height / sf.scale + pad,
  };
}

function strokeGroups(g, groups, color, cap = 'round') {
  g.strokeStyle = color;
  g.lineCap = cap;
  g.lineJoin = 'round';
  for (const [w, list] of groups) {
    g.lineWidth = w;
    g.beginPath();
    for (const pts of list) {
      g.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    }
    g.stroke();
  }
}

function sliceByLength(points, s0, s1) {
  const out = [];
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L <= 0) continue;
    const t0 = (s0 - acc) / L;
    const t1 = (s1 - acc) / L;
    if (t1 >= 0 && t0 <= 1) {
      const u0 = Math.max(0, t0);
      const u1 = Math.min(1, t1);
      if (!out.length) out.push({ x: a.x + (b.x - a.x) * u0, y: a.y + (b.y - a.y) * u0 });
      out.push({ x: a.x + (b.x - a.x) * u1, y: a.y + (b.y - a.y) * u1 });
    }
    acc += L;
  }
  return out;
}

function paintMap(g, sf, map, opts) {
  const S = opts.style;
  const L = opts.layers;
  const px = (n) => n / sf.scale;
  const vb = surfaceBounds(sf, 30);
  const street = sf.scale >= STREET_SCALE;
  const roadFilter = opts.roadFilter;
  worldTransform(g, sf);

  // area hijau
  if (L.green) {
    const byKind = new Map();
    for (const a of map.green) {
      if (!overlaps(a.bbox, vb)) continue;
      if (!byKind.has(a.kind)) byKind.set(a.kind, []);
      byKind.get(a.kind).push(a);
    }
    for (const [kind, list] of byKind) {
      g.fillStyle = S.green[kind] || S.green.grass;
      g.beginPath();
      for (const a of list) {
        a.points.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
        g.closePath();
      }
      g.fill();
      if (kind === 'pitch' && street) {
        g.strokeStyle = S.pitchLine;
        g.lineWidth = px(1);
        g.stroke();
      }
    }
  }

  // sungai dan saluran
  if (L.water && map.water.length) {
    g.strokeStyle = S.water;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const w of map.water) {
      if (!overlaps(w.bbox, vb)) continue;
      g.lineWidth = Math.max(px(1), w.kind === 'river' ? 8 : w.kind === 'stream' ? 2.5 : 1.2);
      g.beginPath();
      w.points.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.stroke();
    }
  }

  // kampus
  if (L.campus && map.campus && overlaps(map.campus.bbox, vb)) {
    g.fillStyle = S.campusFill;
    g.beginPath();
    map.campus.points.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    g.closePath();
    g.fill();
  }

  const visibleRoads = map.roads.filter((r) => overlaps(r.bbox, vb) && (!roadFilter || roadFilter(r)));

  // jalan setapak (di bawah jalan kendaraan)
  if (L.footways) {
    const minor = visibleRoads.filter((r) => PED_CLASSES.has(r.cls));
    if (minor.length && sf.scale >= 0.6) {
      g.save();
      g.strokeStyle = S.footway;
      g.lineWidth = Math.max(px(1.2), street ? 1.2 : 0);
      g.setLineDash(street ? [px(4), px(3)] : []);
      g.lineCap = 'butt';
      g.beginPath();
      for (const r of minor) r.points.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.stroke();
      g.restore();
    }
  }

  const roads = visibleRoads.filter((r) => !PED_CLASSES.has(r.cls)).sort((a, b) => b.rank - a.rank);

  if (L.roads) {
    if (street) {
      // tepi (trotoar/kerb) lalu aspal, dikelompokkan per lebar supaya cepat
      const casing = new Map();
      const casingMajor = new Map();
      const fillMajor = new Map();
      const fill = new Map();
      const fillMinor = new Map();
      for (const r of roads) {
        const major = r.rank <= 7;
        const w = Math.max(r.width, px(2));
        const wc = Math.round((w + Math.max(1.6, px(2))) * 4) / 4;
        const wf = Math.round(w * 4) / 4;
        const cg = major ? casingMajor : casing;
        if (!cg.has(wc)) cg.set(wc, []);
        cg.get(wc).push(r.points);
        const fg = major ? fillMajor : r.cls === 'service' || r.cls === 'living_street' || r.cls === 'track' ? fillMinor : fill;
        if (!fg.has(wf)) fg.set(wf, []);
        fg.get(wf).push(r.points);
      }
      strokeGroups(g, casing, S.casing);
      strokeGroups(g, casingMajor, S.casingMajor);
      strokeGroups(g, fillMinor, S.asphaltMinor);
      strokeGroups(g, fill, S.asphalt);
      strokeGroups(g, fillMajor, S.asphaltMajor);
    } else {
      const groups = new Map();
      for (const r of roads) {
        const [color, w] = overviewStyle(r.cls, S);
        const key = `${color}|${w}`;
        if (!groups.has(key)) groups.set(key, { color, w: Math.max(px(w), Math.min(r.width, px(w * 2.2))), list: [] });
        groups.get(key).list.push(r.points);
      }
      for (const grp of groups.values()) strokeGroups(g, new Map([[grp.w, grp.list]]), grp.color);
    }
  }

  // pulau bundaran
  if (L.islands && street) {
    g.fillStyle = S.island;
    for (const rb of map.roundabouts) {
      if (!rb.closed) continue;
      const w = Math.max(...rb.roads.map((r) => r.width));
      const r = rb.radius - w / 2 - 0.4;
      if (r < 1 || rb.x < vb.minX - 30 || rb.x > vb.maxX + 30 || rb.y < vb.minY - 30 || rb.y > vb.maxY + 30) continue;
      g.beginPath();
      g.arc(rb.x, rb.y, r, 0, TAU);
      g.fill();
    }
  }

  // marka: garis tengah kuning putus-putus di jalan dua arah, garis lajur di jalan satu arah
  if (L.markings && sf.scale >= 3) {
    g.save();
    g.lineCap = 'butt';
    const center = [];
    const lanes = [];
    for (const r of roads) {
      if (r.roundabout || r.cls === 'service' || r.cls === 'track' || r.cls === 'living_street') continue;
      const trimA = map.nodes[r.a].degree > 1 ? r.width / 2 + 2.5 : 0;
      const trimB = map.nodes[r.b].degree > 1 ? r.width / 2 + 2.5 : 0;
      if (r.length - trimA - trimB < 4) continue;
      const pts = sliceByLength(r.points, trimA, r.length - trimB);
      if (pts.length < 2) continue;
      if (!r.oneway && r.lanes >= 2) center.push(pts);
      else if (r.oneway && r.lanes >= 2) lanes.push({ r, pts });
    }
    g.strokeStyle = S.centerLine;
    g.lineWidth = Math.max(0.15, px(1));
    g.setLineDash([3, 4]);
    g.beginPath();
    for (const pts of center) pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    g.stroke();
    g.strokeStyle = S.laneLine;
    g.setLineDash([3, 5]);
    g.beginPath();
    for (const { r, pts } of lanes) {
      const lw = r.width / r.lanes;
      for (let k = 1; k < r.lanes; k++) {
        const off = offsetPolyline(pts, r.width / 2 - k * lw);
        off.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      }
    }
    g.stroke();
    g.restore();
  }

  // panah jalan satu arah
  if (L.arrows && sf.scale >= 1.6) {
    g.fillStyle = S.arrow;
    const size = Math.max(1.4, px(7));
    const spacing = Math.max(35, px(160));
    for (const r of roads) {
      if (!r.oneway || r.length < spacing * 0.6) continue;
      const n = Math.max(1, Math.floor(r.length / spacing));
      const path = new Path(r.points);
      for (let k = 0; k < n; k++) {
        const p = path.sample(((k + 0.5) * r.length) / n);
        if (p.x < vb.minX || p.x > vb.maxX || p.y < vb.minY || p.y > vb.maxY) continue;
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.heading);
        g.beginPath();
        g.moveTo(size * 0.7, 0);
        g.lineTo(-size * 0.5, -size * 0.55);
        g.lineTo(-size * 0.2, 0);
        g.lineTo(-size * 0.5, size * 0.55);
        g.closePath();
        g.fill();
        g.restore();
      }
    }
  }

  // gedung
  if (L.buildings && map.buildings.length) {
    const vis = map.buildings.filter((b) => overlaps(b.bbox, vb));
    const trace = (list) => {
      g.beginPath();
      for (const b of list) {
        b.points.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
        g.closePath();
      }
    };
    if (street) {
      // bayangan: makin tinggi gedung, makin jauh bayangannya (tinggi sebagian besar perkiraan)
      const buckets = new Map();
      for (const b of vis) {
        const h = b.height ?? 6;
        const k = h <= 6 ? 0.5 : h <= 9 ? 0.9 : h <= 14 ? 1.4 : 2.2;
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k).push(b);
      }
      g.fillStyle = S.buildingShadow;
      for (const [k, list] of buckets) {
        g.save();
        g.translate(k * 0.7, k);
        trace(list);
        g.fill();
        g.restore();
      }
    }
    g.fillStyle = S.building;
    trace(vis);
    g.fill();
    if (street) {
      const named = vis.filter((b) => b.name);
      if (named.length) {
        g.fillStyle = S.buildingNamed;
        trace(named);
        g.fill();
      }
      g.strokeStyle = S.buildingEdge;
      g.lineWidth = px(1);
      g.lineJoin = 'round';
      trace(vis);
      g.stroke();
    }
  }

  if (L.campus && map.campus && overlaps(map.campus.bbox, vb)) {
    g.save();
    g.strokeStyle = S.campusLine;
    g.lineWidth = px(1.5);
    g.setLineDash([px(7), px(5)]);
    g.beginPath();
    map.campus.points.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    g.closePath();
    g.stroke();
    g.restore();
  }

  if (L.labels) paintLabels(g, sf, map, opts);
  worldTransform(g, sf);
}

/** Singkat "Jalan X" menjadi "Jl. X" seperti peta pada umumnya. */
export function shortStreetName(name) {
  return String(name).replace(/^Jalan\s+/i, 'Jl. ').replace(/^Gang\s+/i, 'Gg. ');
}

function labelRankLimit(scale) {
  if (scale < 0.25) return 3;
  if (scale < 0.6) return 5;
  if (scale < 1.5) return 7;
  return 10;
}

function paintLabels(g, sf, map, opts) {
  const S = opts.style;
  const placed = opts.placedLabels || [];
  const vb = surfaceBounds(sf, 0);
  const toS = (p) => ({ x: (p.x - sf.originX) * sf.scale, y: (p.y - sf.originY) * sf.scale });
  const hits = (box) => placed.some((r) => box.x0 < r.x1 && box.x1 > r.x0 && box.y0 < r.y1 && box.y1 > r.y0);
  screenTransform(g, sf);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';

  const drawText = (text, x, y, angle, font, color) => {
    g.save();
    g.translate(x, y);
    g.rotate(angle);
    g.font = font;
    g.strokeStyle = S.labelHalo;
    g.lineWidth = 3.5;
    g.strokeText(text, 0, 0.5);
    g.fillStyle = color;
    g.fillText(text, 0, 0.5);
    g.restore();
  };

  // nama kampus lebih dulu (prioritas)
  if (map.campus && overlaps(map.campus.bbox, vb) && opts.layers.campus) {
    const c = toS(map.campus);
    const font = `700 12px ${FONT}`;
    g.font = font;
    const w = g.measureText(map.campus.name).width;
    const box = { x0: c.x - w / 2 - 4, x1: c.x + w / 2 + 4, y0: c.y - 10, y1: c.y + 10 };
    if (c.x > 0 && c.y > 0 && c.x < sf.width && c.y < sf.height && !hits(box)) {
      drawText(map.campus.name, c.x, c.y, 0, font, '#99f6e4');
      placed.push(box);
    }
  }

  // peta tanpa jalan besar (misalnya sekitar Ma Chung, yang terbesar jalan tersier) tetap diberi nama
  // jalan utamanya saat diperkecil: kelas bernama terpenting di peta dan kelas sesudahnya selalu boleh
  let topRank = map._topNamedRank;
  if (topRank == null) {
    topRank = Infinity;
    for (const st of map.streets()) topRank = Math.min(topRank, st.rank);
    map._topNamedRank = topRank;
  }
  const limit = opts.labelRank ?? Math.max(labelRankLimit(sf.scale), topRank + 1);
  const byName = new Map();
  for (const st of map.streets()) {
    if (st.rank > limit || !overlaps(st.bbox, vb)) continue;
    const text = opts.abbreviate === false ? st.name : shortStreetName(st.name);
    const major = st.rank <= 5;
    const font = `${major ? 650 : 550} ${major ? 12 : 11}px ${FONT}`;
    g.font = font;
    const tw = g.measureText(text).width;
    const half = (tw / 2 + 6) / sf.scale;
    if (st.length < half * 2.2) continue;
    const path = new Path(st.points);
    const mine = byName.get(st.name) || [];
    for (const f of [0.5, 0.3, 0.7, 0.15, 0.85]) {
      const sMid = f * path.length;
      if (sMid - half < 0 || sMid + half > path.length) continue;
      const a = toS(path.sample(sMid - half));
      const b = toS(path.sample(sMid + half));
      const m = toS(path.sample(sMid));
      const chord = Math.hypot(b.x - a.x, b.y - a.y);
      if (chord < tw * 0.92) continue; // tikungan terlalu tajam untuk teks lurus
      if (m.x < 8 || m.y < 8 || m.x > sf.width - 8 || m.y > sf.height - 8) continue;
      let ang = Math.atan2(b.y - a.y, b.x - a.x);
      if (ang > Math.PI / 2) ang -= Math.PI;
      if (ang < -Math.PI / 2) ang += Math.PI;
      const c = Math.abs(Math.cos(ang));
      const s = Math.abs(Math.sin(ang));
      const hw = (tw / 2) * c + 8 * s + 3;
      const hh = (tw / 2) * s + 8 * c + 2;
      const box = { x0: m.x - hw, x1: m.x + hw, y0: m.y - hh, y1: m.y + hh };
      if (hits(box)) continue;
      if (mine.some((q) => Math.hypot(q.x - m.x, q.y - m.y) < 260)) continue;
      drawText(text, m.x, m.y, ang, font, major ? S.label : S.labelMinor);
      placed.push(box);
      mine.push(m);
      byName.set(st.name, mine);
      break;
    }
  }

  if (opts.layers.places) {
    const font = `italic 500 11px ${FONT}`;
    g.font = font;
    for (const p of map.places) {
      const c = toS(p);
      if (c.x < 0 || c.y < 0 || c.x > sf.width || c.y > sf.height) continue;
      const w = g.measureText(p.name).width;
      if (p.area * sf.scale * sf.scale < w * 30) continue;
      const box = { x0: c.x - w / 2 - 3, x1: c.x + w / 2 + 3, y0: c.y - 8, y1: c.y + 8 };
      if (hits(box)) continue;
      drawText(p.name, c.x, c.y, 0, font, S.place);
      placed.push(box);
    }
  }
}

/**
 * Lencana atribusi OpenStreetMap (wajib tampil pada setiap peta dari data ini).
 * opts: { text, corner: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left', margin (px), offsetY (px) }
 * Dipanggil dengan transformasi dunia aktif; transformasi dipulihkan setelahnya.
 */
export function drawAttribution(g, view, { text = OSM_ATTRIBUTION, corner = 'bottom-right', margin = 6, offsetY = 0, alpha = 1 } = {}) {
  g.save();
  view.screen();
  g.globalAlpha = alpha;
  g.font = `500 10.5px ${FONT}`;
  const w = g.measureText(text).width + 12;
  const h = 18;
  const right = corner.endsWith('right');
  const bottom = corner.startsWith('bottom');
  const x = right ? view.width - w - margin : margin;
  const y = bottom ? view.height - h - margin - offsetY : margin + offsetY;
  g.fillStyle = 'rgba(11, 18, 32, 0.78)';
  g.beginPath();
  g.roundRect ? g.roundRect(x, y, w, h, 6) : g.rect(x, y, w, h);
  g.fill();
  g.fillStyle = 'rgba(203, 213, 225, 0.92)';
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillText(text, x + 6, y + h / 2 + 0.5);
  g.restore();
}

/** Gambar peta langsung tanpa cache (cukup untuk gambar diam). Opsi sama dengan createMapRenderer. */
export function drawMap(g, view, map, opts = {}) {
  const o = normalizeOpts(opts);
  g.save();
  paintMap(g, surfaceFor(view), map, o);
  g.restore();
  view.world();
  if (o.attribution) drawAttribution(g, view, o.attribution === true ? {} : o.attribution);
}

function normalizeOpts(opts) {
  return {
    layers: { ...DEFAULT_LAYERS, ...(opts.layers || {}) },
    style: { ...MAP_STYLE, ...(opts.style || {}), green: { ...MAP_STYLE.green, ...(opts.style?.green || {}) }, overview: { ...MAP_STYLE.overview, ...(opts.style?.overview || {}) } },
    roadFilter: opts.roadFilter || null,
    labelRank: opts.labelRank ?? null,
    abbreviate: opts.abbreviate ?? true,
    attribution: opts.attribution ?? true,
    cache: opts.cache ?? true,
  };
}

/**
 * Penggambar peta dengan cache: lapisan statis digambar ke kanvas tersembunyi yang sedikit lebih
 * luas dari layar, lalu hanya disalin tiap frame. Digambar ulang otomatis bila skala, ukuran, atau
 * area terlihat berubah terlalu jauh (misalnya kamera mengikuti kendaraan).
 *
 *   const renderer = createMapRenderer(map, { layers: { places: true }, roadFilter: (r) => r.drivable });
 *   renderer.draw(g, view);          // di awal render(), setelah view.begin()
 *
 * opts: { layers: { green, water, campus, footways, roads, islands, markings, arrows, buildings, labels, places },
 *         style (menimpa MAP_STYLE), roadFilter(road), labelRank (peringkat kelas terendah yang diberi nama),
 *         abbreviate (Jalan menjadi Jl.), attribution (true | false | opsi drawAttribution), cache (true) }
 * Hasil: { draw(g, view, { attribution }), set(opts), invalidate(), map }
 */
export function createMapRenderer(map, opts = {}) {
  let o = normalizeOpts(opts);
  let cache = null;
  let key = '';

  function render(view) {
    const s = view.camera.scale;
    const dpr = view.dpr;
    // area cache: layar ditambah 25 persen di tiap sisi, dibatasi agar memori tetap wajar
    let margin = 0.25;
    const maxPx = 12e6;
    while (margin > 0 && view.width * (1 + 2 * margin) * view.height * (1 + 2 * margin) * dpr * dpr > maxPx) margin -= 0.05;
    margin = Math.max(0, margin);
    const w = Math.ceil(view.width * (1 + 2 * margin));
    const h = Math.ceil(view.height * (1 + 2 * margin));
    const sf = {
      scale: s,
      dpr,
      width: w,
      height: h,
      originX: view.camera.x - w / 2 / s,
      originY: view.camera.y - h / 2 / s,
    };
    if (!cache) cache = { canvas: document.createElement('canvas') };
    const c = cache.canvas;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const cg = c.getContext('2d');
    cg.setTransform(1, 0, 0, 1, 0, 0);
    cg.clearRect(0, 0, c.width, c.height);
    paintMap(cg, sf, map, o);
    cache.sf = sf;
  }

  function fresh(view) {
    if (!cache?.sf) return false;
    const sf = cache.sf;
    if (Math.abs(sf.scale - view.camera.scale) > 1e-9 || sf.dpr !== view.dpr) return false;
    const vb = view.visibleBounds();
    const cb = surfaceBounds(sf, 0);
    return vb.minX >= cb.minX && vb.minY >= cb.minY && vb.maxX <= cb.maxX && vb.maxY <= cb.maxY;
  }

  return {
    map,
    draw(g, view, { attribution = o.attribution } = {}) {
      // kanvas belum punya ukuran (misalnya panggung masih tersembunyi): belum ada yang digambar
      if (view.width < 1 || view.height < 1) return;
      const k = `${view.width}x${view.height}`;
      if (!o.cache) {
        g.save();
        paintMap(g, surfaceFor(view), map, o);
        g.restore();
      } else {
        if (k !== key || !fresh(view)) {
          key = k;
          render(view);
        }
        const sf = cache.sf;
        const ox = Math.round((sf.originX - (view.camera.x - view.width / 2 / view.camera.scale)) * sf.scale * sf.dpr);
        const oy = Math.round((sf.originY - (view.camera.y - view.height / 2 / view.camera.scale)) * sf.scale * sf.dpr);
        g.save();
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.drawImage(cache.canvas, ox, oy);
        g.restore();
      }
      view.world();
      if (attribution) drawAttribution(g, view, attribution === true ? {} : attribution);
    },
    /**
     * Gambar hanya lencana atribusi dengan opsi renderer ini. Pakai bersama draw(g, view, { attribution: false })
     * bila ada lapisan lain (rute, penanda, lampu) yang bisa menimpa pojok kanan bawah: panggil di akhir render().
     */
    drawAttribution(g, view, opts = null) {
      if (view.width < 1 || view.height < 1) return;
      const a = opts || o.attribution || true;
      drawAttribution(g, view, a === true ? {} : a);
    },
    /** Ubah opsi (lapisan, gaya, saringan). Cache digambar ulang pada draw() berikutnya. */
    set(next = {}) {
      o = normalizeOpts({ ...o, ...next, layers: { ...o.layers, ...(next.layers || {}) }, style: { ...o.style, ...(next.style || {}) } });
      if (cache) cache.sf = null;
    },
    /** Paksa gambar ulang (misalnya setelah roadFilter bergantung pada keadaan yang berubah). */
    invalidate() {
      if (cache) cache.sf = null;
    },
  };
}

/**
 * Sorot satu ruas atau rute (daftar titik) di atas peta. width dalam piksel.
 * Contoh: highlightRoad(g, view, road, { color: COLORS.danger, dash: [6, 4] }) untuk jalan ditutup.
 */
export function highlightRoad(g, view, roadOrPoints, { color = COLORS.accent, width = 5, alpha = 0.9, dash = null, casing = true } = {}) {
  const pts = Array.isArray(roadOrPoints) ? roadOrPoints : roadOrPoints.points;
  if (!pts || pts.length < 2) return;
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
  if (casing) {
    g.strokeStyle = 'rgba(11, 18, 32, 0.75)';
    g.lineWidth = view.px(width + 4);
    g.stroke();
  }
  g.globalAlpha *= alpha;
  g.strokeStyle = color;
  g.lineWidth = view.px(width);
  if (dash) g.setLineDash(dash.map((d) => view.px(d)));
  g.stroke();
  g.restore();
}

/**
 * Gambar keadaan pencarian rute (createSearch atau graph.search) di atas peta: ruas yang sudah
 * dijelajahi (pohon cameFrom), simpang di antrean terbuka, dan jalur terbaik sementara.
 * Cocok untuk membandingkan A* dan Dijkstra di jaringan jalan asli. Lebar dalam piksel.
 * opts: { exploredColor, openColor, pathColor, width (bawaan 2), showPath (true), dotPx (bawaan 3) }
 */
export function drawSearch(g, view, graph, search, opts = {}) {
  const { exploredColor = 'rgba(251, 191, 36, 0.55)', openColor = COLORS.lidar, pathColor = COLORS.accent, width = 2, showPath = true, dotPx = 3 } = opts;
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = exploredColor;
  g.lineWidth = view.px(width);
  g.beginPath();
  for (const [node, prev] of search.cameFrom) {
    if (!search.closed.has(node)) continue;
    const e = graph.edge(prev, node);
    const pts = e ? graph.edgePoints(e) : null;
    if (!pts) continue;
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
  }
  g.stroke();
  g.fillStyle = openColor;
  g.beginPath();
  const r = view.px(dotPx);
  for (const id of search.open) {
    const n = graph.nodes.get(id);
    if (!n) continue;
    g.moveTo(n.x + r, n.y);
    g.arc(n.x, n.y, r, 0, TAU);
  }
  g.fill();
  g.restore();
  if (showPath) {
    const nodes = search.done ? search.path : search.current != null ? search.pathTo(search.current) : [];
    if (nodes && nodes.length > 1) highlightRoad(g, view, graph.routePoints(nodes), { color: pathColor, width: width + 2 });
  }
}

/** Titik lampu lalu lintas ASLI dari OSM sebagai penanda kecil (mis. di peta ikhtisar). */
export function drawSignalDots(g, view, signals, { color = COLORS.lightYellow, size = 4 } = {}) {
  g.save();
  for (const s of signals) {
    g.fillStyle = 'rgba(11, 18, 32, 0.85)';
    g.beginPath();
    g.arc(s.x, s.y, view.px(size + 2), 0, TAU);
    g.fill();
    g.fillStyle = withAlpha(color, 0.95);
    g.beginPath();
    g.arc(s.x, s.y, view.px(size), 0, TAU);
    g.fill();
  }
  g.restore();
}
