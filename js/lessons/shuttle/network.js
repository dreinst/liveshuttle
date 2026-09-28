// Jaringan jalan pelajaran Misi Shuttle Otonom: jalan asli di sekitar Universitas Ma Chung dari
// OpenStreetMap, sama dengan yang dipakai Shuttle 3D Ma Chung.
//
// Sumber data: js/sim3d/data/machung-city.json (format di docs/MAPDATA.md). Lajur, konektor di
// dalam persimpangan, konflik antarkonektor, zebra cross, halte, dan pencarian rute A* dibangun oleh
// js/sim3d/city.js. Modul itu tidak memakai Three.js, jadi bisa dipakai langsung di sini. Dengan
// begitu kedua simulasi memakai lajur, lampu, zebra cross, halte, dan rute yang persis sama.
//
// File ini menambahkan bagian yang khusus 2D:
//   - lampu lalu lintas simulasi (./signals.js) dengan waktu dan geseran siklus yang sama;
//   - peta 2D bergaya situs untuk createMapRenderer (jalan selebar aspal 3D, gedung, area hijau,
//     nama tempat dan sungai dari js/data/machung-2d.json);
//   - data gambar: permukaan persimpangan, zebra cross, garis henti, tiang lampu, halte;
//   - penutupan jalan untuk pelajar.
// Koordinat: meter, x ke timur, y ke selatan. z di data 3D sama dengan y di sini.

import { City, loadCityData } from '../../sim3d/city.js';
import { parseMap, ROAD_CLASSES, OSM_ATTRIBUTION } from '../../engine/osm2d.js';
import { TrafficLight } from '../../engine/traffic.js';
import { SignalCtl } from './signals.js';

/** City tanpa raster permukaan jalan (hanya dipakai uji keluar jalan di Shuttle 3D). */
class LessonCity extends City {
  buildRaster() {
    this.raster = null;
    this.rasterBase = null;
  }
}

let dataPromise = null;

/** Muat data kota sekali per halaman (dibagi dengan kunjungan berikutnya ke pelajaran ini). */
export function loadNetworkData() {
  if (!dataPromise) {
    dataPromise = loadCityData().catch((e) => {
      dataPromise = null;
      throw e;
    });
  }
  return dataPromise;
}

const AREA_KIND = {
  grass: 'grass',
  garden: 'park',
  park: 'park',
  farmland: 'farm',
  orchard: 'farm',
  scrub: 'wood',
  wood: 'wood',
  cemetery: 'cemetery',
  pitch: 'pitch',
  water: 'kolam',
};

/** Gaya tambahan untuk createMapRenderer: kolam dari data 3D digambar sebagai air. */
export const MAP_STYLE_EXTRA = { green: { kolam: '#1e4d6b' } };

const len2 = (pts) => {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
};

/**
 * Susun peta berformat liveshuttle-osm2d/1 (lihat docs/ENGINE.md bagian 8) dari data kota 3D, supaya
 * aspal yang digambar sama lebar dengan lajur yang dipakai kendaraan. Nama tempat, garis kampus,
 * dan sungai kecil diambil dari peta 2D machung (sumber OSM yang sama).
 */
function buildMapJson(data, map2d) {
  const b = data.meta.bounds;
  const bounds = { minX: b.minX, minY: b.minZ, maxX: b.maxX, maxY: b.maxZ };
  const inside = (bb, pad = 0) => bb.maxX >= bounds.minX - pad && bb.minX <= bounds.maxX + pad && bb.maxY >= bounds.minY - pad && bb.minY <= bounds.maxY + pad;
  const names = [''];
  const nameIdx = new Map([['', 0]]);
  const nid = (n) => {
    if (!n) return 0;
    let i = nameIdx.get(n);
    if (i == null) {
      i = names.length;
      names.push(n);
      nameIdx.set(n, i);
    }
    return i;
  };
  const nodes = [];
  const nodeKey = new Map();
  const node = (x, y) => {
    const k = `${Math.round(x * 2)},${Math.round(y * 2)}`;
    let i = nodeKey.get(k);
    if (i == null) {
      i = nodes.length / 2;
      nodes.push(x, y);
      nodeKey.set(k, i);
    }
    return i;
  };
  const clsIdx = new Map(ROAD_CLASSES.map((c, i) => [c, i]));
  const E = { count: 0, a: [], b: [], cls: [], name: [], flags: [], width: [], lanes: [], maxspeed: [], length: [], geomStart: [0], osm: [] };
  const geom = [];
  const addEdge = (pts, cls, name, flags, width, lanes) => {
    const n = pts.length;
    E.a.push(node(pts[0][0], pts[0][1]));
    E.b.push(node(pts[n - 1][0], pts[n - 1][1]));
    for (let i = 1; i < n - 1; i++) geom.push(pts[i][0], pts[i][1]);
    E.geomStart.push(geom.length / 2);
    E.cls.push(clsIdx.get(cls) ?? clsIdx.get('residential'));
    E.name.push(nid(name));
    E.flags.push(flags);
    E.width.push(width);
    E.lanes.push(lanes);
    E.maxspeed.push(0);
    E.length.push(len2(pts));
    E.osm.push(null);
    return E.count++;
  };
  for (const r of data.roads) {
    if (r.p.length < 2) continue;
    addEdge(r.p, r.cls, r.name, r.ow ? 1 : 0, 2 * r.half, Math.max(1, r.nf + r.nb));
  }
  // cincin bundaran: jalan melingkar searah jarum jam (arah sudut naik karena y ke selatan)
  const roundabouts = [];
  for (const rb of data.roundabouts) {
    const n = Math.max(24, Math.ceil((2 * Math.PI * rb.r) / 2));
    const pts = [];
    for (let k = 0; k <= n; k++) {
      const a = (k / n) * Math.PI * 2;
      pts.push([rb.x + Math.cos(a) * rb.r, rb.z + Math.sin(a) * rb.r]);
    }
    pts[n] = pts[0];
    const e = addEdge(pts, 'residential', '', 1 | 2, rb.w, 1);
    roundabouts.push({ x: rb.x, y: rb.z, radius: rb.r, closed: true, edges: [e], name: 0 });
  }
  // gedung (tinggi perkiraan: jumlah lantai dari data 3D x 3,2 m)
  const types = ['yes', 'house', 'commercial', 'campus', 'mosque'];
  const B = { count: 0, start: [0], type: [], name: [], height: [], heightFromOsm: [], coords: [] };
  for (const bl of data.buildings) {
    for (const p of bl.p) B.coords.push(p[0], p[1]);
    B.start.push(B.coords.length / 2);
    B.type.push(Math.max(0, types.indexOf(bl.k)));
    B.name.push(0);
    B.height.push(Math.round(bl.f * 3.2 * 10) / 10);
    B.heightFromOsm.push(0);
    B.count++;
  }
  const G = { count: 0, start: [0], kind: [], name: [], coords: [] };
  for (const a of data.areas) {
    if (a.k === 'campus') continue;
    for (const p of a.p) G.coords.push(p[0], p[1]);
    G.start.push(G.coords.length / 2);
    G.kind.push(AREA_KIND[a.k] || 'grass');
    G.name.push(0);
    G.count++;
  }
  const Wt = { count: 0, start: [0], kind: [], name: [], coords: [] };
  for (const w of map2d?.water || []) {
    if (!inside(w.bbox, 20)) continue;
    for (const p of w.points) Wt.coords.push(p.x, p.y);
    Wt.start.push(Wt.coords.length / 2);
    Wt.kind.push(w.kind);
    Wt.name.push(nid(w.name));
    Wt.count++;
  }
  const places = (map2d?.places || []).filter((p) => p.x > bounds.minX && p.x < bounds.maxX && p.y > bounds.minY && p.y < bounds.maxY).map((p) => ({ ...p }));
  let campus = null;
  if (map2d?.campus) {
    const c = map2d.campus;
    campus = { name: c.name, x: c.x, y: c.y, area: c.area, coords: c.points.flatMap((p) => [p.x, p.y]) };
  }
  return {
    meta: {
      format: 'liveshuttle-osm2d/1',
      id: 'shuttle-machung',
      title: data.meta.title,
      attribution: data.meta.attribution || OSM_ATTRIBUTION,
      projection: data.meta.projection,
      classes: ROAD_CLASSES,
      speedKmh: {},
    },
    bounds,
    nodes,
    edges: E,
    edgeGeom: geom,
    roundabouts,
    buildings: B,
    buildingTypes: types,
    green: G,
    water: Wt,
    places,
    campus,
    signals: [],
    names,
  };
}

const bboxOf = (pts) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
};

/**
 * Bangun jaringan lengkap untuk satu kali mount.
 * data = isi machung-city.json, map2d = OsmMap 'machung' (boleh null di uji Node).
 */
export function buildNetwork(data, map2d = null) {
  const city = new LessonCity(data);
  const signals = data.signals.map((d, i) => new SignalCtl(d, city, i * 23.5));
  const map = parseMap(buildMapJson(data, map2d));

  // jalan per id beserta lajurnya (untuk penutupan)
  const roadLanes = new Map();
  for (const L of city.lanes) {
    if (L.roadId < 0) continue;
    if (!roadLanes.has(L.roadId)) roadLanes.set(L.roadId, []);
    roadLanes.get(L.roadId).push(L);
  }
  const roads = data.roads.map((r) => {
    const points = r.p.map(([x, y]) => ({ x, y }));
    return { id: r.id, name: r.name || '', cls: r.cls, oneway: !!r.ow, half: r.half, points, length: len2(r.p), lanes: roadLanes.get(r.id) || [], private: !!r.priv, bbox: bboxOf(points) };
  });
  const roadById = new Map(roads.map((r) => [r.id, r]));

  // permukaan persimpangan (menutup sambungan aspal dan ujung marka di simpang)
  const junctions = city.junctions.map((j) => {
    const poly = (j.poly || []).map(([x, y]) => ({ x, y }));
    const bulb = j.bulb ? { x: j.bulb[0], y: j.bulb[1], r: j.bulb[2] } : null;
    const pts = bulb ? [...poly, { x: bulb.x - bulb.r, y: bulb.y - bulb.r }, { x: bulb.x + bulb.r, y: bulb.y + bulb.r }] : poly;
    let major = false;
    for (const c of j.conns) if (c.from.cls === 'tertiary' || c.to.cls === 'tertiary') major = true;
    return { id: j.id, kind: j.k, x: j.x, y: j.z, poly, bulb, major, bbox: pts.length ? bboxOf(pts) : { minX: j.x, minY: j.z, maxX: j.x, maxY: j.z }, sig: j.sig };
  });

  // lampu: tiang di tepi kiri 0,7 m di luar aspal dan 1,2 m sebelum garis henti, lengan 2,6 m
  const heads = [];
  for (const ctl of signals) {
    ctl.arms.forEach((a, i) => {
      const c = Math.cos(a.h);
      const s = Math.sin(a.h);
      const lx = s;
      const ly = -c;
      const px = a.x - c * 1.2 + lx * (a.half + 0.7);
      const py = a.z - s * 1.2 + ly * (a.half + 0.7);
      // lampu kepala untuk kamera shuttle: di atas lajur, menghadap kendaraan yang datang
      const light = new TrafficLight({ id: `lampu-${ctl.id}-${i}`, x: px - lx * 2.2, y: py - ly * 2.2, heading: a.h + Math.PI, state: 'red', label: 'Lampu lalu lintas' });
      heads.push({
        ctl,
        arm: i,
        name: a.name || '',
        x: px,
        y: py,
        heading: a.h + Math.PI,
        state: 'red',
        first: i === 0,
        light,
        // garis henti: dari garis tengah jalan ke tepi kiri (lajur yang datang)
        line: { x0: a.x, y0: a.z, x1: a.x + lx * a.half, y1: a.z + ly * a.half, h: a.h, cx: a.x + (lx * a.half) / 2, cy: a.z + (ly * a.half) / 2, half: a.half },
      });
    });
  }

  // halte: titik henti, bangunan halte, tiang rambu, antrean penumpang
  const halte = city.halte.map((h, index) => {
    const hx = Math.cos(h.h);
    const hy = Math.sin(h.h);
    const lx = hy;
    const ly = -hx;
    const sx = h.shelter[0];
    const sy = h.shelter[1];
    return {
      id: h.id,
      index,
      name: h.name,
      street: h.street,
      link: h.link,
      s: h.s,
      x: h.x,
      y: h.z,
      heading: h.h,
      left: { x: lx, y: ly },
      fwd: { x: hx, y: hy },
      shelter: { x: sx, y: sy, heading: h.h, length: 4.2, width: 1.6 },
      sign: { x: sx + hx * 3.0 + lx * 0.3, y: sy + hy * 3.0 + ly * 0.3 },
      // penumpang menunggu berjajar di depan bangunan halte (sisi jalan)
      queueAt: (k) => ({ x: sx - lx * 1.15 + hx * (1.6 - k * 0.75), y: sy - ly * 1.15 + hy * (1.6 - k * 0.75) }),
      // pintu kiri shuttle saat berhenti (pusat shuttle di h.x, h.z)
      door: { x: h.x + lx * 1.35 + hx * 0.9, y: h.z + ly * 1.35 + hy * 0.9 },
      labelAt: { x: sx + lx * 1.6, y: sy + ly * 1.6 },
    };
  });

  const crossings = city.crossings.map((X) => {
    const walk = X.h + Math.PI / 2;
    return { X, id: X.id, x: X.x, y: X.z, h: X.h, walk, len: X.len, w: X.w, signal: X.signal || null };
  });

  // batas tampilan seluruh rute: semua halte dan rute putaran, ditambah tepi
  const loopLinks = [];
  let loopLen = 0;
  for (let i = 0; i < city.halte.length; i++) {
    const a = city.halte[i];
    const b = city.halte[(i + 1) % city.halte.length];
    const r = city.route(a.link, a.s, b.link, b.s, { core: true, avoidPrivate: true, noU: true });
    if (!r) continue;
    loopLinks.push(...r.links);
    for (const l of r.links) loopLen += l.len;
    loopLen -= a.s + (b.link.len - b.s);
  }
  const lp = [];
  for (const l of loopLinks) {
    const P = l.poly;
    for (let i = 0; i < P.n; i += 3) lp.push({ x: P.x[i], y: P.z[i] });
  }
  const lb = bboxOf(lp);
  const loopBounds = { minX: lb.minX - 30, minY: lb.minY - 30, maxX: lb.maxX + 30, maxY: lb.maxY + 30 };

  const net = {
    city,
    data,
    map,
    signals,
    heads,
    roads,
    roadById,
    junctions,
    halte,
    crossings,
    bounds: map.bounds,
    loopBounds,
    loopLength: loopLen,
    closed: new Set(),

    /** Tutup atau buka satu jalan (kedua arah). Kendaraan yang sudah di jalan itu tetap boleh keluar. */
    setClosed(roadId, on) {
      const R = roadById.get(roadId);
      if (!R) return;
      if (on) net.closed.add(roadId);
      else net.closed.delete(roadId);
      for (const L of R.lanes) L.closed = !!on;
    },

    /** Jalan terdekat dari titik (x, y) dalam toleransi tol (m), atau null. Cincin bundaran tidak bisa ditutup. */
    roadAt(x, y, tol = 0) {
      const hit = city.nearestLink(x, y, (l) => l.kind === 'lane' && l.roadId >= 0);
      if (!hit) return null;
      const R = roadById.get(hit.link.roadId);
      if (!R || hit.d > R.half + 1.2 + tol) return null;
      return R;
    },

    /**
     * Rute A* untuk shuttle dari (link, s) ke halte H. Sama dengan Shuttle 3D: hanya link inti,
     * tanpa jalan privat, tanpa putar balik, jalan yang ditutup dilewati.
     */
    route(startLink, startS, H) {
      return city.route(startLink, startS, H.link, H.s, { core: true, avoidPrivate: true, noU: true });
    },
  };
  return net;
}
