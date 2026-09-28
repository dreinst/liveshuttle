// Tempat kejadian pelajaran Pengambilan Keputusan: Jalan Kawi, Malang, dari data OpenStreetMap.
//
// Semua posisi penting diambil dari berkas js/data/malang-center.json (ODbL, diambil
// 28 September 2026):
//   - garis tengah Jalan Kawi (dari tepi barat data sampai simpang Jalan Kyai Haji Hasyim Asy'ari
//     dan Jalan Arif Rahman Hakim), sekitar 396 m;
//   - simpang berlampu Jalan Kawi dengan Jalan Kelud dan Jalan Arjuno: empat titik
//     traffic_signals ASLI di OSM, satu di tiap kaki simpang;
//   - dua penyeberangan di kaki simpang itu dan satu zebra cross tanpa lampu (crossing=uncontrolled)
//     sekitar 85 m di timur simpang;
//   - gedung, jalan lain, dan nama tempat untuk latar.
// Lebar jalan, jumlah lajur, dan tinggi gedung di data sebagian besar PERKIRAAN.
//
// Peta diputar supaya Jalan Kawi mendatar di layar (arah mobil otonom ke kanan, kira-kira ke timur
// menuju pusat kota). Pelajaran menggambar panah utara supaya arah aslinya tetap terbaca.
//
// Koordinat simulasi di sepanjang Jalan Kawi memakai kerangka jalan (Frenet): s = jarak sepanjang
// garis tengah dari ujung barat data (m), lat = geseran ke samping (positif = kanan arah timur,
// sama dengan sumbu y layar). toWorld(s, lat) mengubahnya ke koordinat peta yang sudah diputar.
// Jalan Kawi di ruas ini hampir lurus (arah berubah paling banyak sekitar 5 derajat), jadi
// menghitung gerak di kerangka jalan lalu memetakannya ke peta hanya penyederhanaan kecil.

import { parseMap, MAP_FILES } from '../../engine/osm2d.js';
import { Path, offsetPolyline, resamplePolyline } from '../../engine/geometry.js';

const KAWI_NAME = 'Jalan Kawi';
export const ROAD_HALF = 3.25; // setengah lebar Jalan Kawi (perkiraan dari data: 6,5 m, dua lajur)
export const EGO_LAT = -1.625; // tengah lajur kiri arah timur (lalu lintas kiri)
export const ONC_LAT = 1.625; // tengah lajur arah barat
export const SIDE_HALF = 2.5; // setengah lebar Jalan Kelud dan Jalan Arjuno (perkiraan dari data: 5 m)
export const CW_HALF = 2; // setengah lebar pita penyeberangan searah jalan (m)
export const WALK = 2; // lebar trotoar yang digambar (perkiraan)

/** Unduh data mentah peta pusat kota Malang (dipakai pelajaran, dibatalkan saat keluar). */
export async function fetchSceneJson(signal) {
  const res = await fetch(MAP_FILES['malang-center'], { signal });
  if (!res.ok) throw new Error(`Peta pusat kota Malang gagal dimuat (HTTP ${res.status}).`);
  return res.json();
}

// ---------- pembantu data ----------

function rotatePairs(arr, f) {
  const out = new Array(arr.length);
  for (let i = 0; i < arr.length; i += 2) {
    const p = f(arr[i], arr[i + 1]);
    out[i] = Math.round(p.x * 100) / 100;
    out[i + 1] = Math.round(p.y * 100) / 100;
  }
  return out;
}

/**
 * Salinan JSON peta dengan semua koordinat diputar lewat f, tanpa ruas bernama dropName
 * (Jalan Kawi digambar sendiri oleh pelajaran, lengkap dengan marka yang dipakai simulasi).
 */
function transformJson(json, f, dropName) {
  const names = json.names || [''];
  const dropIdx = names.indexOf(dropName);
  const E = json.edges;
  const geom = json.edgeGeom || [];
  const keep = [];
  for (let i = 0; i < E.count; i++) if (E.name[i] !== dropIdx) keep.push(i);
  const remap = new Map(keep.map((old, i) => [old, i]));
  const cols = ['a', 'b', 'cls', 'name', 'flags', 'width', 'lanes', 'maxspeed', 'length', 'osm'];
  const edges = { count: keep.length, geomStart: [0] };
  for (const c of cols) if (E[c]) edges[c] = [];
  const newGeom = [];
  for (const i of keep) {
    for (const c of cols) if (E[c]) edges[c].push(E[c][i]);
    for (let k = E.geomStart[i]; k < E.geomStart[i + 1]; k++) newGeom.push(geom[2 * k], geom[2 * k + 1]);
    edges.geomStart.push(newGeom.length / 2);
  }
  const rp = (o) => ({ ...o, ...f(o.x, o.y) });
  const out = {
    ...json,
    meta: { ...json.meta, id: `${json.meta?.id || 'peta'}-kawi` },
    nodes: rotatePairs(json.nodes, f),
    edges,
    edgeGeom: rotatePairs(newGeom, f),
    roundabouts: (json.roundabouts || []).map((r) => ({ ...rp(r), edges: r.edges.map((e) => remap.get(e)).filter((e) => e != null) })),
    places: (json.places || []).map(rp),
    signals: (json.signals || []).map((s) => ({ ...rp(s), edge: remap.get(s.edge) ?? -1 })),
    crossings: (json.crossings || []).map((s) => ({ ...rp(s), edge: remap.get(s.edge) ?? -1 })),
  };
  for (const k of ['buildings', 'green', 'water']) if (json[k]) out[k] = { ...json[k], coords: rotatePairs(json[k].coords, f) };
  if (json.campus) out.campus = { ...json.campus, ...f(json.campus.x, json.campus.y), coords: rotatePairs(json.campus.coords, f) };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < out.nodes.length; i += 2) {
    minX = Math.min(minX, out.nodes[i]);
    maxX = Math.max(maxX, out.nodes[i]);
    minY = Math.min(minY, out.nodes[i + 1]);
    maxY = Math.max(maxY, out.nodes[i + 1]);
  }
  out.bounds = { minX, minY, maxX, maxY };
  return out;
}

/** Rangkai ruas bernama `name` mulai dari simpang nodeId menjauh, sampai sepanjang maxLen. */
function chainFrom(map, nodeId, name, maxLen) {
  const pts = [{ x: map.nodes[nodeId].x, y: map.nodes[nodeId].y }];
  const used = new Set();
  let node = nodeId;
  let len = 0;
  while (len < maxLen) {
    const r = map.nodes[node].roads.find((q) => q.name === name && !used.has(q));
    if (!r) break;
    used.add(r);
    const rp = r.a === node ? r.points : [...r.points].reverse();
    for (let i = 1; i < rp.length; i++) {
      len += Math.hypot(rp[i].x - pts[pts.length - 1].x, rp[i].y - pts[pts.length - 1].y);
      pts.push({ x: rp[i].x, y: rp[i].y });
    }
    node = r.a === node ? r.b : r.a;
  }
  return pts;
}

/** Rata-rata bergerak titik berjarak 1 m (ujung tetap), untuk menghaluskan patahan kecil data. */
function smoothPoints(pts, half) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(pts.length - 1, i + half);
    const k = Math.min(i - a, b - i);
    let sx = 0;
    let sy = 0;
    for (let j = i - k; j <= i + k; j++) {
      sx += pts[j].x;
      sy += pts[j].y;
    }
    out.push({ x: sx / (2 * k + 1), y: sy / (2 * k + 1) });
  }
  return out;
}

// ---------- kerangka jalan (Frenet) sepanjang Jalan Kawi ----------

function makeFrame(points) {
  const pts = smoothPoints(resamplePolyline(points, 1), 4);
  const last = pts.length - 1;
  const H = pts.map((_, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(last, i + 1)];
    return Math.atan2(b.y - a.y, b.x - a.x);
  });
  function sample(s) {
    // di luar ujung data: lanjut lurus searah ujung terdekat
    const e = s <= 0 ? 0 : s >= last ? last : -1;
    if (e >= 0) return { x: pts[e].x + Math.cos(H[e]) * (s - e), y: pts[e].y + Math.sin(H[e]) * (s - e), h: H[e] };
    const i = Math.floor(s);
    const t = s - i;
    const a = pts[i];
    const b = pts[i + 1];
    let dh = H[i + 1] - H[i];
    if (dh > Math.PI) dh -= 2 * Math.PI;
    if (dh < -Math.PI) dh += 2 * Math.PI;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, h: H[i] + dh * t };
  }
  const path = new Path(pts);
  return {
    /** Titik dunia (peta yang diputar) untuk posisi s dan geseran lat (positif = kanan arah timur). */
    toWorld(s, lat = 0) {
      const p = sample(s);
      return { x: p.x - Math.sin(p.h) * lat, y: p.y + Math.cos(p.h) * lat, heading: p.h };
    },
    /** Kebalikan toWorld (untuk menyiapkan data, bukan untuk tiap langkah). */
    fromWorld(x, y) {
      const c = path.closest(x, y);
      return { s: c.s, lat: -c.lateral };
    },
  };
}

// ---------- membangun tempat kejadian ----------

/**
 * Bangun tempat kejadian dari JSON malang-center (mentah, seperti di js/data). Fungsi murni: bisa
 * dipanggil di peramban dan di Node (uji model).
 */
export function buildScene(json) {
  const base = parseMap(json);
  const kawiStreet = base.streets().filter((st) => st.name === KAWI_NAME).sort((a, b) => b.length - a.length)[0];
  if (!kawiStreet) throw new Error('Jalan Kawi tidak ditemukan di data peta.');
  let chain = kawiStreet.points;
  if (chain[0].x > chain[chain.length - 1].x) chain = [...chain].reverse(); // barat ke timur

  // simpang Jalan Kawi dengan Jalan Kelud dan Jalan Arjuno
  const center = base.nodes.find((n) => {
    const names = new Set(n.roads.map((r) => r.name));
    return names.has(KAWI_NAME) && names.has('Jalan Kelud') && names.has('Jalan Arjuno');
  });
  if (!center) throw new Error('Simpang Jalan Kawi dengan Jalan Kelud dan Jalan Arjuno tidak ditemukan.');

  // putar peta: tali busur Jalan Kawi menjadi mendatar, pusat simpang menjadi titik (0, 0)
  const A = chain[0];
  const B = chain[chain.length - 1];
  const theta = Math.atan2(B.y - A.y, B.x - A.x);
  const c = Math.cos(-theta);
  const sn = Math.sin(-theta);
  const rot = (x, y) => {
    const dx = x - center.x;
    const dy = y - center.y;
    return { x: dx * c - dy * sn, y: dx * sn + dy * c };
  };
  const map = parseMap(transformJson(json, rot, KAWI_NAME));
  // arah utara di peta yang diputar (dipakai panah U)
  const north = rot(center.x, center.y - 1);
  const northAngle = Math.atan2(north.y, north.x);

  // ujung timur: sambung dengan jalan yang paling lurus di simpang ujung (arah datang lalu lintas lawan)
  const endNode = base.nearestNode(B.x, B.y).node;
  const hEnd = Math.atan2(B.y - chain[chain.length - 2].y, B.x - chain[chain.length - 2].x);
  let ext = null;
  let bestTurn = 1.2;
  for (const r of endNode.roads) {
    if (r.name === KAWI_NAME || !r.drivable) continue;
    const rp = r.a === endNode.id ? r.points : [...r.points].reverse();
    const h = Math.atan2(rp[1].y - rp[0].y, rp[1].x - rp[0].x);
    const turn = Math.abs(Math.atan2(Math.sin(h - hEnd), Math.cos(h - hEnd)));
    if (turn < bestTurn) {
      bestTurn = turn;
      ext = { road: r, points: rp };
    }
  }
  const extPts = ext ? ext.points.slice(1) : [];
  const kawiLen = kawiStreet.length;
  const frame = makeFrame([...chain, ...extPts].map((p) => rot(p.x, p.y)));

  const sOf = (x, y) => frame.fromWorld(...Object.values(rot(x, y)));
  const S = {};
  S.end = kawiLen;
  S.center = sOf(center.x, center.y).s;

  // titik lampu lalu lintas asli di sekitar simpang
  const signals = base.signals
    .filter((sg) => Math.hypot(sg.x - center.x, sg.y - center.y) <= 35)
    .map((sg) => ({ x: sg.x, y: sg.y, road: sg.road?.name || '', world: rot(sg.x, sg.y) }));
  // penyeberangan di Jalan Kawi
  const crossings = [];
  for (const cr of base.crossings) {
    const f = sOf(cr.x, cr.y);
    if (Math.abs(f.lat) > 1.5 || f.s < 0 || f.s > kawiLen) continue;
    crossings.push({ type: cr.type || '', s: f.s });
  }
  crossings.sort((a, b) => a.s - b.s);
  const westCw = crossings.filter((q) => q.s < S.center && S.center - q.s < 40).pop();
  const eastCw = crossings.find((q) => q.s > S.center && q.s - S.center < 40);
  const zebra = crossings.find((q) => q.s > S.center + 45 && q.type === 'uncontrolled');
  if (!westCw || !eastCw || !zebra) throw new Error('Penyeberangan di Jalan Kawi tidak lengkap di data.');

  S.cwWest = westCw.s;
  S.cwEast = eastCw.s;
  S.zebra = zebra.s;
  S.stopEB = S.cwWest - CW_HALF - 1; // tepi dekat garis henti arah timur (mobil otonom)
  S.stopWB = S.cwEast + CW_HALF + 1; // tepi dekat garis henti arah barat
  S.boxA = S.center - SIDE_HALF - 1; // area konflik dengan Jalan Kelud dan Jalan Arjuno
  S.boxB = S.center + SIDE_HALF + 1;
  // Tepi barat kotak data: sebelum titik ini belum ada gedung di berkas pusat kota.
  const chainPath = new Path(chain);
  S.dataWest = 0;
  for (let s = 0; s < Math.min(120, chainPath.length); s += 1) {
    if (chainPath.sample(s).x >= (json.bounds?.minX ?? -Infinity)) {
      S.dataWest = s;
      break;
    }
  }
  S.viewMin = S.dataWest - 4;
  S.viewMax = S.end + 16;
  S.start = S.dataWest + 4; // awal ruas untuk mobil otonom (tepat setelah tepi data)
  S.wrap = S.end - 9; // mobil otonom mulai lagi dari awal sebelum simpang ujung
  S.angkot = S.end - 51; // tempat angkot ngetem di lajur kiri (tengah kendaraan)
  S.passA = S.zebra + 14; // garis tengah putus-putus (boleh menyalip)
  S.passB = S.end - 12;
  S.spawn = S.end + 320; // mobil dari arah berlawanan muncul jauh di luar layar
  S.despawn = -40;

  // simpang lain di sepanjang Jalan Kawi (untuk memutus trotoar dan garis tepi)
  const junctions = [];
  const onChain = new Set(kawiStreet.roads.flatMap((r) => [r.a, r.b]));
  for (const id of onChain) {
    const n = base.nodes[id];
    for (const r of n.roads) {
      if (r.name === KAWI_NAME || r.cls === 'footway' || r.cls === 'path' || r.cls === 'steps' || r.cls === 'pedestrian' || r.cls === 'cycleway') continue;
      const rp = r.a === id ? r.points : [...r.points].reverse();
      const f0 = sOf(rp[0].x, rp[0].y);
      const k = Math.min(rp.length - 1, 1);
      const f1 = sOf(rp[k].x + (rp[k].x - rp[0].x) * 0.001, rp[k].y + (rp[k].y - rp[0].y) * 0.001);
      junctions.push({ s: f0.s, side: Math.sign(f1.lat - f0.lat) || 1, half: Math.max(1.75, r.width / 2) + 1 });
    }
  }

  // Jalan Kelud (kanan arah timur) dan Jalan Arjuno (kiri): jalur lalu lintas simpang
  const kelud = chainFrom(base, center.id, 'Jalan Kelud', 110).map((p) => rot(p.x, p.y));
  const arjuno = chainFrom(base, center.id, 'Jalan Arjuno', 110).map((p) => rot(p.x, p.y));
  const sideCenter = resamplePolyline([...[...kelud].reverse(), ...arjuno.slice(1)], 1); // dari Kelud ke Arjuno
  const laneOff = SIDE_HALF / 2;
  const mkSide = (pts, sigRoad) => {
    const path = new Path(offsetPolyline(pts, laneOff));
    // garis henti di titik lampu asli pada kaki simpang tempat kendaraan datang
    const sg = signals.find((q) => q.road === sigRoad);
    const sigS = path.closest(sg.world.x, sg.world.y).s;
    // di Jalan Arjuno titik lampu juga titik penyeberangan: garis henti sebelum pita penyeberangan
    const cr = base.crossings.find((q) => Math.hypot(q.x - sg.x, q.y - sg.y) < 2);
    const stopS = cr ? sigS - CW_HALF - 1 : sigS;
    // rentang s di jalur ini yang berada di atas badan Jalan Kawi
    let sIn = Infinity;
    let sOut = -Infinity;
    for (let s = 0; s <= path.length; s += 0.5) {
      const p = path.sample(s);
      const f = frame.fromWorld(p.x, p.y);
      if (Math.abs(f.lat) <= ROAD_HALF + 0.6 && Math.abs(f.s - S.center) < 20) {
        sIn = Math.min(sIn, s);
        sOut = Math.max(sOut, s);
      }
    }
    return { path, stopS, crossingOsm: cr ? cr.osm : null, sIn, sOut };
  };
  const side = {
    utara: mkSide(sideCenter, 'Jalan Kelud'),
    selatan: mkSide([...sideCenter].reverse(), 'Jalan Arjuno'),
  };

  return { map, frame, S, side, junctions, northAngle, extName: ext ? ext.road.name : '' };
}
