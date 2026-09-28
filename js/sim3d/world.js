// Kota statis dari data OSM: tanah, area hijau, trotoar, jalan, persimpangan, bundaran, marka,
// gedung (rumah beratap limasan, gedung kampus berwarna aksen, masjid dengan kubah), pohon,
// lampu jalan, label, dan halte. Geometri statis digabung per material (sedikit draw call).
// Benda yang berulang (pohon, kepala lampu) memakai InstancedMesh.
// Tanah dibuat datar. Aslinya daerah Ma Chung berbukit (disebutkan di panel Tentang peta).
import * as THREE from '../vendor/three.bundle.min.js';
import { GeoBuf, TiledBuf } from './geobuf.js';
import { mulberry32 } from './util.js';
import { halte as halteModel } from './models/index.js';

export const Y = { ground: 0, area: 0.015, walk: 0.035, road: 0.06, mark: 0.075 };
/** Ukuran petak geometri statis (m). Peta sekitar 1 km x 1 km menjadi 3 x 3 petak. */
const TILE = 350;

const col = (hex) => new THREE.Color(hex);

const AREA_COL = {
  grass: '#bddb93',
  park: '#a9d487',
  garden: '#b3da8e',
  wood: '#93c67d',
  scrub: '#a8cf8a',
  orchard: '#b7d88c',
  farmland: '#e4e0b0',
  pitch: '#9fd08a',
  water: '#94c8ea',
  cemetery: '#c6d8a8',
  campus: '#efe6d6',
};
const HOUSE_WALL = ['#f5e6cc', '#f3d6c6', '#e2ecda', '#dae8f1', '#efe2ef', '#f7edc9', '#eadfcc', '#f3dbb8'];
const HOUSE_ROOF = ['#c9694b', '#b95d45', '#d47b58', '#aa5540', '#c26f55'];
// warna aksen gedung kampus (hijau toska lembut, serasi dengan LiveShuttle), beda jelas dari atap rumah
const CAMPUS_WALL = '#9ed8cd';
const CAMPUS_ROOF = '#c4ebe3';
const CAMPUS_TRIM = '#4fae9f';

function windowTextures(res) {
  const size = 256;
  const cells = 4;
  const cs = size / cells;
  const c1 = document.createElement('canvas');
  const c2 = document.createElement('canvas');
  c1.width = c1.height = c2.width = c2.height = size;
  const g1 = c1.getContext('2d');
  const g2 = c2.getContext('2d');
  g1.fillStyle = '#ffffff';
  g1.fillRect(0, 0, size, size);
  g2.fillStyle = '#000000';
  g2.fillRect(0, 0, size, size);
  const rng = mulberry32(77);
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const x = i * cs + cs * 0.3;
      const y = j * cs + cs * 0.28;
      const w = cs * 0.4;
      const h = cs * 0.42;
      g1.fillStyle = '#c7d2d8';
      g1.fillRect(x - 3, y - 3, w + 6, h + 6);
      g1.fillStyle = '#7f95a3';
      g1.fillRect(x, y, w, h);
      g1.fillStyle = '#a9bcc7';
      g1.fillRect(x, y, w, 4);
      if (rng() < 0.55) {
        const b = 0.6 + rng() * 0.4;
        g2.fillStyle = `rgba(255,${190 + Math.floor(rng() * 30)},120,${b})`;
        g2.fillRect(x, y, w, h);
      }
    }
  }
  const map = res.add(new THREE.CanvasTexture(c1));
  const emi = res.add(new THREE.CanvasTexture(c2));
  for (const t of [map, emi]) {
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
  }
  return { map, emi };
}

function labelTexture(res, text, opts) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const font = opts.font;
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + opts.pad * 2;
  c.width = Math.min(2048, w);
  c.height = opts.h;
  g.font = font;
  g.textBaseline = 'middle';
  if (opts.bg) {
    g.fillStyle = opts.bg;
    const r = opts.h / 2;
    g.beginPath();
    g.moveTo(r, 0);
    g.lineTo(c.width - r, 0);
    g.arc(c.width - r, r, r, -Math.PI / 2, Math.PI / 2);
    g.lineTo(r, opts.h);
    g.arc(r, r, r, Math.PI / 2, (Math.PI * 3) / 2);
    g.fill();
  }
  if (opts.stroke) {
    g.lineWidth = opts.strokeW;
    g.strokeStyle = opts.stroke;
    g.lineJoin = 'round';
    g.strokeText(text, opts.pad, opts.h / 2 + 2);
  }
  g.fillStyle = opts.color;
  g.fillText(text, opts.pad, opts.h / 2 + 2);
  const tex = res.add(new THREE.CanvasTexture(c));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { tex, aspect: c.width / c.height };
}

export function buildWorld(app) {
  const { scene, res, city } = app;
  const data = city.data;
  const rng = mulberry32(20260928);
  const out = { mats: {}, poles: [], group: new THREE.Group(), labels: [] };
  const group = out.group;
  group.name = 'kota';
  scene.add(group);
  const b = city.bounds;
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;

  // ===== tanah =====
  const groundGeo = res.add(new THREE.PlaneGeometry(b.maxX - b.minX + 1600, b.maxZ - b.minZ + 1600));
  groundGeo.rotateX(-Math.PI / 2);
  const groundMat = res.add(new THREE.MeshLambertMaterial({ color: '#dadcc2' }));
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.position.set(cx, Y.ground, cz);
  ground.receiveShadow = true;
  group.add(ground);
  out.mats.ground = groundMat;

  // ===== area hijau dan halaman kampus =====
  // geometri statis dibagi ke petak 350 m supaya petak di luar pandangan tidak digambar
  const tiled = () => new TiledBuf(TILE, b.minX, b.minZ);
  const addTiles = (buf, mat, opts = {}) => {
    for (const g of buf.build()) {
      const m = new THREE.Mesh(res.add(g), mat);
      m.receiveShadow = opts.receive !== false;
      m.castShadow = !!opts.cast;
      group.add(m);
    }
  };
  // Area yang saling tumpang tindih (hutan di atas rumput, dan sebagainya) digambar dalam SATU mesh,
  // berurutan dari bawah ke atas, tanpa menulis kedalaman dan sesudah benda lain (renderOrder 1).
  // Jadi urutan gambar yang menentukan mana yang tampak, tanpa kedip z-fighting dari jauh.
  const areas = new GeoBuf();
  const order = ['campus', 'farmland', 'grass', 'cemetery', 'park', 'garden', 'pitch', 'scrub', 'orchard', 'wood', 'water'];
  const sorted = data.areas.slice().sort((a, c) => order.indexOf(a.k) - order.indexOf(c.k));
  sorted.forEach((a) => areas.flatPoly(a.p, Y.area, col(AREA_COL[a.k] || '#c9d9b0')));
  const areaMat = res.add(new THREE.MeshLambertMaterial({ vertexColors: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }));
  const areaMesh = new THREE.Mesh(res.add(areas.build()), areaMat);
  areaMesh.receiveShadow = true;
  areaMesh.renderOrder = 1;
  group.add(areaMesh);
  out.mats.area = areaMat;

  // ===== trotoar =====
  const walk = tiled();
  const walkCol = col('#ebe5d8');
  const midOf = (pts) => pts[Math.floor(pts.length / 2)];
  for (const e of data.walks.edges) {
    if (e.k !== 'w') continue;
    const m = midOf(e.p);
    walk.at(m[0], m[1]).ribbon(e.p, 1.8, Y.walk, walkCol);
  }
  // potongan trotoar hiasan (terlalu dekat jalur belok untuk dilalui, atau garis trotoar asli di
  // sudut yang jalurnya digeser); bagian yang menimpa aspal tertutup aspal karena aspal digambar di atas
  for (const pl of data.walks.deco || []) {
    if (pl.length < 2) continue;
    const m = midOf(pl);
    walk.at(m[0], m[1]).ribbon(pl, 1.8, Y.walk, walkCol);
  }
  const walkMat = res.add(new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  addTiles(walk, walkMat);
  out.mats.walk = walkMat;

  // ===== aspal: ruas, persimpangan, bundaran =====
  const road = tiled();
  const asphalt = col('#ffffff');
  const trimmed = (r) => {
    const pts = r.p;
    // potong t0 dari awal dan t1 dari akhir polyline
    const L = [];
    let acc = 0;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) {
      acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      cum.push(acc);
    }
    const s0 = r.route && r.ja !== 'batas' ? Math.max(0, r.t0 - 0.05) : 0;
    const s1 = r.route && r.jb !== 'batas' ? acc - Math.max(0, r.t1 - 0.05) : acc;
    if (s1 - s0 < 0.2) return null;
    const at = (s) => {
      for (let i = 1; i < pts.length; i++) {
        if (cum[i] >= s) {
          const t = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
          return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
        }
      }
      return pts[pts.length - 1];
    };
    L.push(at(s0));
    for (let i = 1; i < pts.length - 1; i++) if (cum[i] > s0 && cum[i] < s1) L.push(pts[i]);
    L.push(at(s1));
    return L;
  };
  const roadPaths = new Map();
  for (const r of data.roads) {
    const pts = r.route ? trimmed(r) : r.p;
    if (!pts || pts.length < 2) continue;
    roadPaths.set(r.id, pts);
    const m = midOf(pts);
    road.at(m[0], m[1]).ribbon(pts, r.half * 2, Y.road, asphalt);
  }
  for (const j of data.junctions) if (j.poly.length >= 3) road.at(j.x, j.z).flatPoly(j.poly, Y.road, asphalt);
  // aspal tambahan di jejak sapuan kendaraan (tikungan tajam, putar balik di ujung buntu)
  for (const link of city.links) {
    const sp = city.sweptPath(link);
    if (!sp) continue;
    // tiap sisi digambar terpisah: pusat ke tepi kiri, pusat ke tepi kanan
    const n = sp.x.length;
    const L = [];
    const R = [];
    const C = [];
    for (let i = 0; i < n; i++) {
      const nx = -Math.sin(sp.h[i]);
      const nz = Math.cos(sp.h[i]);
      C.push([sp.x[i], Y.road, sp.z[i]]);
      L.push([sp.x[i] - nx * sp.left[i], Y.road, sp.z[i] - nz * sp.left[i]]);
      R.push([sp.x[i] + nx * sp.right[i], Y.road, sp.z[i] + nz * sp.right[i]]);
    }
    // hanya bagian yang belum tertutup aspal lain (hemat segitiga)
    const cov = (p) => city.onBaseRoad(p[0], p[2]);
    for (let i = 0; i < n - 1; i++) {
      const rb = road.at(C[i][0], C[i][2]);
      if (!(cov(L[i]) && cov(L[i + 1]))) rb.quad(L[i], L[i + 1], C[i + 1], C[i], 0, 1, 0, asphalt);
      if (!(cov(R[i]) && cov(R[i + 1]))) rb.quad(C[i], C[i + 1], R[i + 1], R[i], 0, 1, 0, asphalt);
    }
  }
  for (const rb of data.roundabouts) {
    const ro = rb.r + rb.w / 2;
    const ri = rb.r - rb.w / 2;
    const n = 64;
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2;
      const a1 = ((k + 1) / n) * Math.PI * 2;
      road.at(rb.x, rb.z).quad([rb.x + Math.cos(a0) * ri, Y.road, rb.z + Math.sin(a0) * ri], [rb.x + Math.cos(a0) * ro, Y.road, rb.z + Math.sin(a0) * ro], [rb.x + Math.cos(a1) * ro, Y.road, rb.z + Math.sin(a1) * ro], [rb.x + Math.cos(a1) * ri, Y.road, rb.z + Math.sin(a1) * ri], 0, 1, 0, asphalt);
    }
  }
  const roadMat = res.add(new THREE.MeshStandardMaterial({ color: '#80868f', roughness: 0.92, metalness: 0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  addTiles(road, roadMat);
  out.mats.road = roadMat;

  // pulau tengah bundaran (rumput dengan tepi terang)
  const island = new GeoBuf();
  for (const rb of data.roundabouts) {
    const ri = rb.r - rb.w / 2 - 0.15;
    const pts = [];
    for (let k = 0; k < 40; k++) pts.push([rb.x + Math.cos((k / 40) * Math.PI * 2) * ri, rb.z + Math.sin((k / 40) * Math.PI * 2) * ri]);
    island.flatPoly(pts.slice().reverse(), 0.16, col('#a4d183'));
    for (let k = 0; k < 40; k++) {
      const a0 = (k / 40) * Math.PI * 2;
      const a1 = ((k + 1) / 40) * Math.PI * 2;
      const p0 = [rb.x + Math.cos(a0) * ri, rb.z + Math.sin(a0) * ri];
      const p1 = [rb.x + Math.cos(a1) * ri, rb.z + Math.sin(a1) * ri];
      island.quad([p0[0], Y.road, p0[1]], [p1[0], Y.road, p1[1]], [p1[0], 0.16, p1[1]], [p0[0], 0.16, p0[1]], Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2), col('#ece8df'));
    }
  }
  if (!island.empty) {
    const islandMesh = new THREE.Mesh(res.add(island.build()), res.add(new THREE.MeshLambertMaterial({ vertexColors: true })));
    islandMesh.receiveShadow = true;
    group.add(islandMesh);
  }

  // ===== marka =====
  const mk = tiled();
  const white = col('#fbfbf6');
  const kerb = col('#e2dccf');
  const dashAlong = (pts, off, dash, gap, w, color, skip0 = 1.5, skip1 = 1.5) => {
    // garis putus-putus di sepanjang polyline dengan geser lateral off
    let acc = 0;
    const segs = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const L = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      segs.push([acc, L]);
      acc += L;
    }
    const total = acc;
    const at = (s) => {
      for (let i = 0; i < segs.length; i++) {
        const [a, L] = segs[i];
        if (s <= a + L || i === segs.length - 1) {
          const t = Math.max(0, Math.min(1, (s - a) / (L || 1)));
          const x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t;
          const z = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t;
          const h = Math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0]);
          return [x + Math.sin(h) * off, z - Math.cos(h) * off, h];
        }
      }
      return [pts[0][0], pts[0][1], 0];
    };
    for (let s = skip0; s + dash <= total - skip1; s += dash + gap) {
      const [x, z, h] = at(s + dash / 2);
      mk.at(x, z).rect(x, z, h, dash, w, Y.mark, color);
    }
  };
  const solidAlong = (pts, off, w, color) => {
    const shifted = pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)];
      const c = pts[Math.min(pts.length - 1, i + 1)];
      const h = Math.atan2(c[1] - a[1], c[0] - a[0]);
      return [p[0] + Math.sin(h) * off, p[1] - Math.cos(h) * off];
    });
    const m = midOf(shifted);
    mk.at(m[0], m[1]).ribbon(shifted, w, Y.mark, color);
  };
  for (const r of data.roads) {
    const pts = roadPaths.get(r.id);
    if (!pts) continue;
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    // tepi aspal terang supaya batas jalan dan trotoar terbaca
    solidAlong(pts, r.half - 0.09, 0.18, kerb);
    solidAlong(pts, -(r.half - 0.09), 0.18, kerb);
    if (!r.route || L < 6) continue;
    if (!r.ow) dashAlong(pts, 0, r.cls === 'tertiary' ? 3 : 2.5, r.cls === 'tertiary' ? 4 : 4.5, 0.12, white);
    else if (r.nf === 2) dashAlong(pts, 0, 2.5, 4.5, 0.12, white);
    if (r.cls === 'tertiary') {
      solidAlong(pts, r.half - 0.45, 0.12, white);
      solidAlong(pts, -(r.half - 0.45), 0.12, white);
    }
  }
  // garis henti di lengan berlampu
  for (const s of data.signals) {
    for (const a of s.arms) {
      const lefts = [];
      const h = a.h;
      const lx = Math.sin(h);
      const lz = -Math.cos(h);
      for (const lid of a.lanes) {
        const lane = city.lanes[lid];
        const P = lane.poly;
        const ex = P.x[P.n - 1];
        const ez = P.z[P.n - 1];
        lefts.push((ex - a.x) * lx + (ez - a.z) * lz);
      }
      const w = city.lanes[a.lanes[0]].width;
      const lo = Math.min(...lefts) - w / 2;
      const hi = Math.max(...lefts) + w / 2;
      const mid = (lo + hi) / 2;
      mk.at(a.x, a.z).rect(a.x + lx * mid - Math.cos(h) * 0.25, a.z + lz * mid - Math.sin(h) * 0.25, h, 0.45, hi - lo, Y.mark, white);
    }
  }
  // garis beri jalan (putus-putus melintang) di ujung lajur yang harus mengalah
  for (const lane of city.lanes) {
    if (!lane.next.length || lane.sig) continue;
    if (!lane.next.every((c) => c.rank === 2)) continue;
    const P = lane.poly;
    const ex = P.x[P.n - 1];
    const ez = P.z[P.n - 1];
    const h = P.h[P.n - 2];
    const lx = Math.sin(h);
    const lz = -Math.cos(h);
    const w = lane.width;
    for (let v = -w / 2 + 0.25; v < w / 2 - 0.2; v += 0.9) {
      mk.at(ex, ez).rect(ex + lx * (v + 0.25) - Math.cos(h) * 0.2, ez + lz * (v + 0.25) - Math.sin(h) * 0.2, h, 0.3, 0.5, Y.mark, white);
    }
  }
  // zebra cross
  for (const X of data.crossings) {
    const ux = Math.cos(X.h);
    const uz = Math.sin(X.h);
    const nx = -uz;
    const nz = ux;
    for (let v = -X.len / 2 + 0.45; v <= X.len / 2 - 0.4; v += 1.0) {
      mk.at(X.x, X.z).rect(X.x + nx * v, X.z + nz * v, X.h, X.w, 0.5, Y.mark, white);
    }
  }
  // tepi cincin bundaran
  for (const rb of data.roundabouts) {
    for (const rr of [rb.r - rb.w / 2 + 0.3, rb.r + rb.w / 2 - 0.3]) {
      const pts = [];
      for (let k = 0; k <= 64; k++) pts.push([rb.x + Math.cos((k / 64) * Math.PI * 2) * rr, rb.z + Math.sin((k / 64) * Math.PI * 2) * rr]);
      mk.at(rb.x, rb.z).ribbon(pts, 0.12, Y.mark, white);
    }
  }
  const mkMat = res.add(new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  addTiles(mk, mkMat);
  out.mats.markings = mkMat;

  // ===== gedung =====
  const tex = windowTextures(res);
  const wallsT = tiled();
  const roofsT = tiled();
  const domes = [];
  for (const bl of data.buildings) {
    const floors = bl.f;
    const top = floors * 3.2 + 0.3;
    let wallCol;
    let roofCol;
    if (bl.k === 'campus') {
      wallCol = col(CAMPUS_WALL).offsetHSL(0, 0, (bl.c % 3) * 0.02 - 0.02);
      roofCol = col(CAMPUS_ROOF);
    } else if (bl.k === 'mosque') {
      wallCol = col('#f6f2e8');
      roofCol = col('#e9e4d8');
    } else {
      wallCol = col(HOUSE_WALL[bl.c % HOUSE_WALL.length]);
      roofCol = col(bl.r === 'hip' ? HOUSE_ROOF[bl.c % HOUSE_ROOF.length] : '#dcd8cf');
    }
    const walls = wallsT.at(bl.p[0][0], bl.p[0][1]);
    const roofs = roofsT.at(bl.p[0][0], bl.p[0][1]);
    walls.walls(bl.p, 0, top, wallCol, 1 / 12.8, 1 / 12.8, (bl.c * 0.37) % 1);
    if (bl.r === 'hip' && bl.obb) {
      const [ox, oz, L, W, h] = bl.obb;
      const c = Math.cos(h);
      const s = Math.sin(h);
      const ov = 0.35;
      const hl = L / 2 + ov;
      const hw = W / 2 + ov;
      const rh = Math.min(2.4, W * 0.38);
      const ridge = Math.max(0, hl - hw);
      const P = (u, v, y) => [ox + c * u - s * v, y, oz + s * u + c * v];
      const a = P(-hl, -hw, top);
      const b2 = P(hl, -hw, top);
      const c2 = P(hl, hw, top);
      const d = P(-hl, hw, top);
      const r0 = P(-ridge, 0, top + rh);
      const r1 = P(ridge, 0, top + rh);
      const nUp = (p, q, r) => {
        const ux = q[0] - p[0];
        const uy = q[1] - p[1];
        const uz = q[2] - p[2];
        const vx = r[0] - p[0];
        const vy = r[1] - p[1];
        const vz = r[2] - p[2];
        let nx = uy * vz - uz * vy;
        let ny = uz * vx - ux * vz;
        let nz = ux * vy - uy * vx;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l;
        ny /= l;
        nz /= l;
        if (ny < 0) {
          nx = -nx;
          ny = -ny;
          nz = -nz;
        }
        return [nx, ny, nz];
      };
      let n = nUp(a, b2, r1);
      roofs.quad(a, b2, r1, r0, n[0], n[1], n[2], roofCol);
      n = nUp(c2, d, r0);
      roofs.quad(c2, d, r0, r1, n[0], n[1], n[2], roofCol);
      const sh = roofCol.clone().offsetHSL(0, 0, -0.05);
      n = nUp(b2, c2, r1);
      roofs.tri(b2, c2, r1, n[0], n[1], n[2], sh);
      n = nUp(d, a, r0);
      roofs.tri(d, a, r0, n[0], n[1], n[2], sh);
      // plafon di bawah atap supaya tidak tembus pandang dari bawah
      roofs.flatPoly(bl.p, top - 0.02, wallCol);
    } else {
      roofs.flatPoly(bl.p, top, roofCol);
      if (bl.k === 'campus') {
        // pembatas atap tipis
        const pts = bl.p;
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          const q = pts[(i + 1) % pts.length];
          const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
          if (len < 0.5) continue;
          const nx = (q[1] - p[1]) / len;
          const nz = -(q[0] - p[0]) / len;
          roofs.quad([p[0], top, p[1]], [q[0], top, q[1]], [q[0], top + 0.6, q[1]], [p[0], top + 0.6, p[1]], nx, 0, nz, col(CAMPUS_TRIM));
        }
      }
    }
    if (bl.k === 'mosque') {
      let sx = 0;
      let sz = 0;
      for (const p of bl.p) {
        sx += p[0];
        sz += p[1];
      }
      domes.push({ x: sx / bl.p.length, z: sz / bl.p.length, y: top, r: Math.min(4.5, Math.max(2, Math.sqrt(Math.abs(areaOf(bl.p))) / 3.2)) });
    }
  }
  const wallMat = res.add(new THREE.MeshLambertMaterial({ vertexColors: true, map: tex.map, emissive: 0xffffff, emissiveMap: tex.emi, emissiveIntensity: 0 }));
  addTiles(wallsT, wallMat, { cast: true });
  const roofMat = res.add(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  addTiles(roofsT, roofMat, { cast: true });
  out.mats.windows = wallMat;
  if (domes.length) {
    const domeGeo = res.add(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2));
    const domeMat = res.add(new THREE.MeshLambertMaterial({ color: '#2f9e76' }));
    const towerGeo = res.add(new THREE.CylinderGeometry(0.45, 0.55, 1, 8));
    const towerMat = res.add(new THREE.MeshLambertMaterial({ color: '#f6f2e8' }));
    for (const d of domes) {
      const dome = new THREE.Mesh(domeGeo, domeMat);
      dome.position.set(d.x, d.y, d.z);
      dome.scale.set(d.r, d.r * 0.9, d.r);
      dome.castShadow = true;
      group.add(dome);
      const tw = new THREE.Mesh(towerGeo, towerMat);
      const th = d.y + 7;
      tw.scale.set(1, th, 1);
      tw.position.set(d.x + d.r + 1.2, th / 2, d.z);
      tw.castShadow = true;
      group.add(tw);
      const cap = new THREE.Mesh(domeGeo, domeMat);
      cap.position.set(d.x + d.r + 1.2, th, d.z);
      cap.scale.set(0.7, 0.9, 0.7);
      group.add(cap);
    }
  }

  // ===== pohon =====
  const trees = data.trees;
  const trunkGeo = res.add(new THREE.CylinderGeometry(0.14, 0.22, 2.2, 6, 1, true));
  trunkGeo.translate(0, 1.1, 0);
  const crownGeo = res.add(new THREE.IcosahedronGeometry(1.8, 0));
  crownGeo.translate(0, 3.6, 0);
  const bushGeo = res.add(new THREE.IcosahedronGeometry(1.3, 0));
  bushGeo.translate(0, 1.6, 0);
  const trunkMat = res.add(new THREE.MeshLambertMaterial({ color: '#7a5a42' }));
  const crownMat = res.add(new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true }));
  const big = trees.filter((t) => t[3] === 0);
  const small = trees.filter((t) => t[3] !== 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, Math.max(1, trees.length));
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, Math.max(1, big.length));
  const bushes = new THREE.InstancedMesh(bushGeo, crownMat, Math.max(1, small.length));
  const greens = ['#6fae5c', '#7dbb66', '#5f9f53', '#8cc26f', '#6aa75e', '#94c874'].map(col);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pv = new THREE.Vector3();
  const sv = new THREE.Vector3();
  out.trees = [];
  let ti = 0;
  big.forEach(([x, z, s], i) => {
    q.setFromAxisAngle(up, rng() * Math.PI * 2);
    pv.set(x, 0, z);
    sv.set(s, s * (0.9 + rng() * 0.25), s);
    m4.compose(pv, q, sv);
    trunks.setMatrixAt(ti++, m4);
    crowns.setMatrixAt(i, m4);
    crowns.setColorAt(i, greens[Math.floor(rng() * greens.length)]);
    out.trees.push({ x, z, r: 0.35 * s, h: 5.4 * s });
  });
  small.forEach(([x, z, s], i) => {
    q.setFromAxisAngle(up, rng() * Math.PI * 2);
    pv.set(x, 0, z);
    sv.set(s, s, s);
    m4.compose(pv, q, sv);
    const sm = m4.clone().scale(new THREE.Vector3(1, 0.55, 1));
    trunks.setMatrixAt(ti++, sm);
    bushes.setMatrixAt(i, m4);
    bushes.setColorAt(i, greens[Math.floor(rng() * greens.length)].clone().offsetHSL(0, 0, 0.04));
    out.trees.push({ x, z, r: 0.3 * s, h: 2.8 * s });
  });
  trunks.count = ti;
  crowns.count = big.length;
  bushes.count = small.length;
  for (const m of [trunks, crowns, bushes]) {
    m.castShadow = true;
    m.computeBoundingSphere();
    group.add(m);
  }

  // ===== lampu jalan di jalan utama dan sekitar kampus =====
  const lampSpots = [];
  for (const r of data.roads) {
    if (!r.route) continue;
    const mid = r.p[Math.floor(r.p.length / 2)];
    const nearCampus = Math.hypot(mid[0], mid[1]) < 260;
    if (!(r.cls === 'tertiary' || (nearCampus && (r.cls === 'service' || r.cls === 'residential')))) continue;
    const pts = roadPaths.get(r.id);
    if (!pts) continue;
    let acc = 0;
    let next = 12;
    for (let i = 0; i < pts.length - 1; i++) {
      const L = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      while (next <= acc + L) {
        const t = (next - acc) / L;
        const x = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t;
        const z = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t;
        const h = Math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0]);
        const side = lampSpots.length % 2 ? 1 : -1;
        const off = r.half + 0.35;
        lampSpots.push({ x: x + Math.sin(h) * off * side, z: z - Math.cos(h) * off * side, hx: x + Math.sin(h) * (off - 1.3) * side, hz: z - Math.cos(h) * (off - 1.3) * side });
        next += r.cls === 'tertiary' ? 34 : 42;
      }
      acc += L;
    }
  }
  const props = new GeoBuf();
  const poleCol = col('#8a929c');
  for (const L of lampSpots) {
    props.box(L.x - 0.07, 0, L.z - 0.07, L.x + 0.07, 6.2, L.z + 0.07, poleCol);
    props.box(Math.min(L.x, L.hx) - 0.05, 6.1, Math.min(L.z, L.hz) - 0.05, Math.max(L.x, L.hx) + 0.05, 6.2, Math.max(L.z, L.hz) + 0.05, poleCol);
    out.poles.push({ x: L.x, z: L.z, r: 0.1, h: 6.2 });
  }
  if (!props.empty) {
    const propMesh = new THREE.Mesh(res.add(props.build()), res.add(new THREE.MeshLambertMaterial({ vertexColors: true })));
    propMesh.castShadow = true;
    group.add(propMesh);
  }
  const headGeo = res.add(new THREE.BoxGeometry(0.7, 0.14, 0.34));
  const headMat = res.add(new THREE.MeshBasicMaterial({ color: '#c9ced4' }));
  const heads = new THREE.InstancedMesh(headGeo, headMat, Math.max(1, lampSpots.length));
  lampSpots.forEach((L, i) => {
    m4.makeTranslation(L.hx, 6.05, L.hz);
    heads.setMatrixAt(i, m4);
  });
  heads.count = lampSpots.length;
  group.add(heads);
  out.mats.lampHead = headMat;
  // genangan cahaya lampu jalan (hanya malam)
  const poolGeo = res.add(new THREE.CircleGeometry(7, 24));
  poolGeo.rotateX(-Math.PI / 2);
  const pc = new Float32Array(poolGeo.attributes.position.count * 3);
  for (let i = 0; i < poolGeo.attributes.position.count; i++) {
    const r = Math.hypot(poolGeo.attributes.position.getX(i), poolGeo.attributes.position.getZ(i)) / 7;
    const k = Math.max(0, 1 - r) ** 1.5;
    pc[i * 3] = pc[i * 3 + 1] = pc[i * 3 + 2] = k;
  }
  poolGeo.setAttribute('color', new THREE.BufferAttribute(pc, 3));
  const poolMat = res.add(new THREE.MeshBasicMaterial({ color: '#ffc98a', vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  const pools = new THREE.InstancedMesh(poolGeo, poolMat, Math.max(1, lampSpots.length));
  lampSpots.forEach((L, i) => {
    m4.makeTranslation(L.hx, Y.mark + 0.01, L.hz);
    pools.setMatrixAt(i, m4);
  });
  pools.count = lampSpots.length;
  pools.renderOrder = 2;
  pools.visible = false;
  group.add(pools);
  out.mats.lampPool = poolMat;
  out.pools = pools;

  // ===== label =====
  for (const lb of data.labels) {
    if (lb.k === 'campus') {
      const { tex: t, aspect } = labelTexture(res, lb.t, { font: '700 72px system-ui, sans-serif', h: 120, pad: 48, color: '#9a3412', bg: 'rgba(255,250,242,0.92)' });
      const sp = new THREE.Sprite(res.add(new THREE.SpriteMaterial({ map: t, depthWrite: false, transparent: true })));
      const hgt = 7;
      sp.scale.set(hgt * aspect, hgt, 1);
      sp.position.set(lb.x, 26, lb.z);
      sp.renderOrder = 8;
      group.add(sp);
      out.labels.push({ obj: sp, kind: 'campus' });
    } else {
      const { tex: t, aspect } = labelTexture(res, lb.t, { font: '600 64px system-ui, sans-serif', h: 96, pad: 24, color: '#3f4650', stroke: 'rgba(255,255,255,0.95)', strokeW: 10 });
      const hgt = 3.2;
      const geo = res.add(new THREE.PlaneGeometry(hgt * aspect, hgt));
      geo.rotateX(-Math.PI / 2);
      const mat = res.add(new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0, depthWrite: false }));
      const m = new THREE.Mesh(geo, mat);
      // label di sisi jalan (sedikit di luar trotoar) supaya tidak menutupi marka
      m.position.set(lb.x, Y.mark + 0.02, lb.z);
      m.rotation.y = -lb.h;
      m.renderOrder = 3;
      group.add(m);
      out.labels.push({ obj: m, kind: 'street', mat });
    }
  }

  // ===== halte =====
  out.halteGroup = halteModel.createHalteGroup({ res, scene: group }, data.halte);
  return out;
}

function areaOf(p) {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    a += p[i][0] * q[1] - q[0] * p[i][1];
  }
  return a / 2;
}

/** Label jalan hanya terlihat saat kamera cukup tinggi (tampilan peta atau drone jauh). */
export function updateLabels(world, camY) {
  const k = Math.max(0, Math.min(1, (camY - 30) / 60));
  for (const l of world.labels) {
    if (l.kind === 'street') {
      l.mat.opacity = 0.85 * k;
      l.obj.visible = k > 0.01;
    } else l.obj.visible = camY > 14;
  }
}
