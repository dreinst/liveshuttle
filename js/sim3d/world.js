// Kota statis: tanah, jalan, marka, trotoar, bangunan, pohon, dan lampu jalan.
// Geometri statis digabung per material supaya jumlah draw call kecil.
// Benda yang berulang (pohon, kepala lampu) memakai InstancedMesh.
import * as THREE from '../vendor/three.bundle.min.js';
import { GRID, DX, DZ } from './roadgraph.js';
import { mulberry32 } from './util.js';

const col = (hex) => new THREE.Color(hex);

/** Penampung geometri gabungan: posisi, normal, warna per titik, dan UV. */
export class GeoBuf {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.uv = [];
    this.idx = [];
    this.n = 0;
  }
  quad(a, b, c, d, nx, ny, nz, color, uvs) {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    const flip = cx * nx + cy * ny + cz * nz < 0;
    const base = this.n;
    for (const p of [a, b, c, d]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(nx, ny, nz);
      this.col.push(color.r, color.g, color.b);
    }
    if (uvs) this.uv.push(...uvs);
    else this.uv.push(0, 0, 0, 0, 0, 0, 0, 0);
    if (flip) this.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    else this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    this.n += 4;
  }
  /** Segitiga dengan normal (nx, ny, nz). Urutan titik dibalik bila perlu. */
  tri(a, b, c, nx, ny, nz, color) {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    const flip = cx * nx + cy * ny + cz * nz < 0;
    const base = this.n;
    for (const p of [a, b, c]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(nx, ny, nz);
      this.col.push(color.r, color.g, color.b);
      this.uv.push(0, 0);
    }
    if (flip) this.idx.push(base, base + 2, base + 1);
    else this.idx.push(base, base + 1, base + 2);
    this.n += 3;
  }
  /**
   * Blok trotoar dengan sudut membulat (jari-jari r). Atas berwarna top, sisi (kerb) berwarna side.
   */
  roundedBlock(x0, z0, x1, z1, r, y0, y1, top, side) {
    const pts = [];
    const seg = 6;
    const corners = [
      [x1 - r, z1 - r, 0],
      [x0 + r, z1 - r, Math.PI / 2],
      [x0 + r, z0 + r, Math.PI],
      [x1 - r, z0 + r, (Math.PI * 3) / 2],
    ];
    for (const [cx, cz, a0] of corners) {
      for (let i = 0; i <= seg; i++) {
        const a = a0 + (i / seg) * (Math.PI / 2);
        pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
      }
    }
    const mx = (x0 + x1) / 2;
    const mz = (z0 + z1) / 2;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[(i + 1) % n];
      this.tri([mx, y1, mz], [ax, y1, az], [bx, y1, bz], 0, 1, 0, top);
      let nx = bz - az;
      let nz = -(bx - ax);
      const l = Math.hypot(nx, nz) || 1;
      nx /= l;
      nz /= l;
      // normal harus menghadap keluar dari pusat blok
      if (nx * (ax - mx) + nz * (az - mz) < 0) {
        nx = -nx;
        nz = -nz;
      }
      if (Math.hypot(bx - ax, bz - az) > 1e-4) this.quad([ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], nx, 0, nz, side);
    }
  }
  /** Persegi datar menghadap ke atas. */
  flat(x0, z0, x1, z1, y, color) {
    this.quad([x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0], 0, 1, 0, color);
  }
  /** Kotak sejajar sumbu. opts.side = warna sisi, opts.bottom = buat alas. */
  box(x0, y0, z0, x1, y1, z1, color, opts = {}) {
    const side = opts.side || color;
    if (opts.top !== false) this.quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], 0, 1, 0, color);
    this.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], 1, 0, 0, side);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], -1, 0, 0, side);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], 0, 0, 1, side);
    this.quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], 0, 0, -1, side);
    if (opts.bottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], 0, -1, 0, side);
  }
  /** Dinding vertikal dari (xa,za) ke (xb,zb) dengan UV untuk tekstur jendela. */
  wall(xa, za, xb, zb, y0, y1, nx, nz, color, u0, v0) {
    const len = Math.hypot(xb - xa, zb - za);
    const u1 = u0 + len / 32;
    const v1 = v0 + (y1 - y0) / 28;
    this.quad([xa, y0, za], [xb, y0, zb], [xb, y1, zb], [xa, y1, za], nx, 0, nz, color, [u0, v0, u1, v0, u1, v1, u0, v1]);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.n > 65000 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

function windowTextures(res) {
  const size = 256;
  const cells = 8;
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
      const x = i * cs + cs * 0.18;
      const y = j * cs + cs * 0.2;
      const w = cs * 0.64;
      const h = cs * 0.55;
      g1.fillStyle = '#56647d';
      g1.fillRect(x, y, w, h);
      g1.fillStyle = '#7d8aa3';
      g1.fillRect(x, y, w, 2);
      if (rng() < 0.45) {
        const warm = rng() < 0.78;
        const b = 0.55 + rng() * 0.45;
        g2.fillStyle = warm ? `rgba(255,196,120,${b})` : `rgba(185,215,255,${b})`;
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

/**
 * Membangun kota statis. Mengembalikan data jejak (footprint) sederhana untuk
 * sinar LiDAR dan tabrakan, serta material yang diubah oleh cuaca.
 */
export function buildWorld(scene, res, graph) {
  const { S, HALF, SIDE, CONN, CROSS, CROSS_W, CURB_R } = GRID;
  const rng = mulberry32(20260928);
  const nodes = graph.nodes;
  const minC = nodes[0].x;
  const maxC = nodes[nodes.length - 1].x;
  const out = { buildings: [], trees: [], poles: [], mats: {}, lamps: [], bounds: { min: minC - HALF - SIDE, max: maxC + HALF + SIDE } };
  const group = new THREE.Group();
  group.name = 'kota';
  scene.add(group);

  // Tanah
  const groundGeo = res.add(new THREE.PlaneGeometry(1600, 1600));
  groundGeo.rotateX(-Math.PI / 2);
  const groundMat = res.add(new THREE.MeshLambertMaterial({ color: '#2a4636' }));
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.position.y = -0.04;
  ground.receiveShadow = true;
  group.add(ground);
  out.mats.ground = groundMat;

  // Aspal: satu persegi per ruas, diperpanjang menutup kotak persimpangan.
  const road = new GeoBuf();
  const white = col('#ffffff');
  for (const r of graph.roads) {
    const a = r.a;
    const b = r.b;
    if (r.k === 0) road.flat(a.x - HALF, a.z - HALF, b.x + HALF, a.z + HALF, 0, white);
    else road.flat(a.x - HALF, a.z - HALF, a.x + HALF, b.z + HALF, 0, white);
  }
  // Aspal di bawah lengkung kerb tiap sudut blok (bagian sudut yang tidak tertutup trotoar).
  for (let bj = 0; bj < GRID.N - 1; bj++) {
    for (let bi = 0; bi < GRID.N - 1; bi++) {
      const x0 = minC + bi * S + HALF;
      const x1 = minC + (bi + 1) * S - HALF;
      const z0 = minC + bj * S + HALF;
      const z1 = minC + (bj + 1) * S - HALF;
      road.flat(x0, z0, x0 + CURB_R, z0 + CURB_R, 0, white);
      road.flat(x1 - CURB_R, z0, x1, z0 + CURB_R, 0, white);
      road.flat(x0, z1 - CURB_R, x0 + CURB_R, z1, 0, white);
      road.flat(x1 - CURB_R, z1 - CURB_R, x1, z1, 0, white);
    }
  }
  const roadMat = res.add(new THREE.MeshStandardMaterial({ color: '#3a414f', roughness: 0.92, metalness: 0 }));
  const roadMesh = new THREE.Mesh(res.add(road.build()), roadMat);
  roadMesh.receiveShadow = true;
  group.add(roadMesh);
  out.mats.road = roadMat;

  // Trotoar dan kavling blok
  const pave = new GeoBuf();
  const walkTop = col('#6f7784');
  const curb = col('#a3aab5');
  const grass = col('#335a40');
  const plaza = col('#465264');
  const parks = new Set(['1,2', '3,0']);
  const blockTypes = [];
  for (let bj = 0; bj < GRID.N - 1; bj++) {
    for (let bi = 0; bi < GRID.N - 1; bi++) {
      const x0 = minC + bi * S + HALF;
      const x1 = minC + (bi + 1) * S - HALF;
      const z0 = minC + bj * S + HALF;
      const z1 = minC + (bj + 1) * S - HALF;
      pave.roundedBlock(x0, z0, x1, z1, CURB_R, -0.04, 0.15, walkTop, curb);
      const park = parks.has(`${bi},${bj}`);
      pave.flat(x0 + SIDE, z0 + SIDE, x1 - SIDE, z1 - SIDE, 0.17, park ? grass : plaza);
      blockTypes.push({ bi, bj, x0: x0 + SIDE, x1: x1 - SIDE, z0: z0 + SIDE, z1: z1 - SIDE, park });
    }
  }
  // Trotoar luar di sekeliling kota
  const o0 = minC - HALF - SIDE;
  const o1 = maxC + HALF + SIDE;
  pave.box(o0, -0.04, o0, o1, 0.15, o0 + SIDE, walkTop, { side: curb });
  pave.box(o0, -0.04, o1 - SIDE, o1, 0.15, o1, walkTop, { side: curb });
  pave.box(o0, -0.04, o0 + SIDE, o0 + SIDE, 0.15, o1 - SIDE, walkTop, { side: curb });
  pave.box(o1 - SIDE, -0.04, o0 + SIDE, o1, 0.15, o1 - SIDE, walkTop, { side: curb });
  const paveMat = res.add(new THREE.MeshLambertMaterial({ vertexColors: true }));
  const paveMesh = new THREE.Mesh(res.add(pave.build()), paveMat);
  paveMesh.receiveShadow = true;
  group.add(paveMesh);

  // Marka jalan
  const mk = new GeoBuf();
  const yellow = col('#f5c518');
  const mw = col('#e5e7eb');
  const y = 0.02;
  const rect = (x0, z0, x1, z1, c) => mk.flat(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1), y, c);
  // Sumbu u sepanjang jalan, w melintang. Fungsi ini memetakan (u,w) ke (x,z).
  for (const r of graph.roads) {
    const a = r.a;
    const horiz = r.k === 0;
    const P = (u, w) => (horiz ? [a.x + u, a.z + w] : [a.x + w, a.z + u]);
    const R = (u0, w0, u1, w1, c) => {
      const p0 = P(u0, w0);
      const p1 = P(u1, w1);
      rect(p0[0], p0[1], p1[0], p1[1], c);
    };
    const uA = CONN;
    const uB = S - CONN;
    // Garis tengah ganda kuning
    R(uA, -0.22, uB, -0.1, yellow);
    R(uA, 0.1, uB, 0.22, yellow);
    // Garis tepi
    R(uA, -6.85, uB, -6.7, mw);
    R(uA, 6.7, uB, 6.85, mw);
    // Garis putus-putus pemisah lajur searah
    for (let u = uA + 3; u < uB - 3; u += 8) {
      const e = Math.min(u + 3, uB - 2);
      R(u, -3.56, e, -3.44, mw);
      R(u, 3.44, e, 3.56, mw);
    }
  }
  // Garis henti dan zebra cross di persimpangan berlampu
  for (const n of nodes) {
    if (!n.signalized) continue;
    for (let k = 0; k < 4; k++) {
      if (n.nb[k] < 0) continue;
      // lengan persimpangan ke arah k; kendaraan yang MASUK bergerak ke arah oppDir(k)
      const dx = DX[k];
      const dz = DZ[k];
      const px = -dz; // tegak lurus
      const pz = dx;
      const Pt = (u, w) => [n.x + dx * u + px * w, n.z + dz * u + pz * w];
      const Rr = (u0, w0, u1, w1, c) => {
        const p0 = Pt(u0, w0);
        const p1 = Pt(u1, w1);
        rect(p0[0], p0[1], p1[0], p1[1], c);
      };
      // Kendaraan masuk bergerak ke arah -d. Kiri dari -d adalah (-dz, dx)... = (px, pz) dengan tanda:
      // kiri(v) = (vz, -vx); v = (-dx, -dz) -> kiri = (-dz, dx) = (px, pz). Lajur masuk ada di w > 0.
      Rr(CONN - 0.2, 0.3, CONN + 0.35, HALF - 0.2, mw);
      // Zebra cross: garis-garis sejajar arah jalan
      const u0 = CROSS - CROSS_W / 2;
      const u1 = CROSS + CROSS_W / 2;
      for (let w = -HALF + 0.5; w < HALF - 0.4; w += 1.1) Rr(u0, w, u1, w + 0.55, mw);
    }
  }
  const mkMat = res.add(new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  const mkMesh = new THREE.Mesh(res.add(mk.build()), mkMat);
  mkMesh.receiveShadow = true;
  mkMesh.renderOrder = 1;
  group.add(mkMesh);
  out.mats.markings = mkMat;

  // Bangunan
  const tex = windowTextures(res);
  const walls = new GeoBuf();
  const roofs = new GeoBuf();
  const palette = ['#c9d0dc', '#aab5c7', '#8f9bb0', '#d8d1c4', '#b9ab99', '#9ea9b5', '#cbbba8', '#8392a7', '#b7c3cf'];
  const roofCol = col('#4a5361');
  const hvac = col('#6b7482');
  const treeSpots = [];
  for (const blk of blockTypes) {
    if (blk.park) {
      for (let i = 0; i < 22; i++) {
        treeSpots.push([blk.x0 + 4 + rng() * (blk.x1 - blk.x0 - 8), blk.z0 + 4 + rng() * (blk.z1 - blk.z0 - 8), 0.9 + rng() * 0.5]);
      }
      continue;
    }
    const cx = (blk.x0 + blk.x1) / 2;
    const cz = (blk.z0 + blk.z1) / 2;
    const central = Math.max(0, 1 - Math.hypot(cx, cz) / 260);
    const cols = rng() < 0.5 ? 2 : 3;
    const rows = rng() < 0.5 ? 2 : 3;
    const cw = (blk.x1 - blk.x0) / cols;
    const ch = (blk.z1 - blk.z0) / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const bx0 = blk.x0 + c * cw;
        const bz0 = blk.z0 + r * ch;
        if (rng() < 0.1) {
          treeSpots.push([bx0 + cw / 2, bz0 + ch / 2, 1.1]);
          continue;
        }
        const m = 1.8 + rng() * 2.6;
        const x0 = bx0 + m;
        const x1 = bx0 + cw - m;
        const z0 = bz0 + m;
        const z1 = bz0 + ch - m;
        const floors = Math.round(3 + rng() * 4 + central * rng() * 11);
        const h = floors * 3.5;
        const color = col(palette[Math.floor(rng() * palette.length)]);
        const u0 = Math.floor(rng() * 8) / 8;
        const v0 = Math.floor(rng() * 8) / 8;
        walls.wall(x0, z1, x1, z1, 0.17, h, 0, 1, color, u0, v0);
        walls.wall(x1, z0, x0, z0, 0.17, h, 0, -1, color, u0 + 0.25, v0);
        walls.wall(x1, z1, x1, z0, 0.17, h, 1, 0, color, u0 + 0.5, v0);
        walls.wall(x0, z0, x0, z1, 0.17, h, -1, 0, color, u0 + 0.75, v0);
        roofs.flat(x0, z0, x1, z1, h, roofCol);
        // pembatas atap tipis dan mesin AC
        roofs.box(x0, h, z0, x1, h + 0.5, z0 + 0.3, roofCol);
        roofs.box(x0, h, z1 - 0.3, x1, h + 0.5, z1, roofCol);
        if (rng() < 0.7) {
          const ax = x0 + 3 + rng() * Math.max(1, x1 - x0 - 9);
          const az = z0 + 3 + rng() * Math.max(1, z1 - z0 - 9);
          roofs.box(ax, h, az, ax + 3 + rng() * 3, h + 1.2 + rng() * 1.5, az + 2.5 + rng() * 2, hvac);
        }
        out.buildings.push({ minx: x0, minz: z0, maxx: x1, maxz: z1, h });
      }
    }
  }
  const wallMat = res.add(
    new THREE.MeshLambertMaterial({ vertexColors: true, map: tex.map, emissive: 0xffffff, emissiveMap: tex.emi, emissiveIntensity: 0 }),
  );
  const wallMesh = new THREE.Mesh(res.add(walls.build()), wallMat);
  wallMesh.castShadow = true;
  wallMesh.receiveShadow = true;
  group.add(wallMesh);
  const roofMat = res.add(new THREE.MeshLambertMaterial({ vertexColors: true }));
  const roofMesh = new THREE.Mesh(res.add(roofs.build()), roofMat);
  roofMesh.castShadow = true;
  roofMesh.receiveShadow = true;
  group.add(roofMesh);
  out.mats.windows = wallMat;

  // Pohon di trotoar dan lampu jalan
  const lampSpots = [];
  for (const r of graph.roads) {
    const a = r.a;
    const horiz = r.k === 0;
    const P = (u, w) => (horiz ? [a.x + u, a.z + w] : [a.x + w, a.z + u]);
    for (const u of [22, 40, 60, 78]) {
      for (const side of [-1, 1]) {
        if (rng() < 0.15) continue;
        const p = P(u + (rng() - 0.5) * 3, side * 10.1);
        treeSpots.push([p[0], p[1], 0.85 + rng() * 0.35]);
      }
    }
    for (const [u, side] of [
      [30, -1],
      [70, -1],
      [50, 1],
    ]) {
      const base = P(u, side * 7.7);
      const head = P(u, side * 5.9);
      lampSpots.push({ bx: base[0], bz: base[1], hx: head[0], hz: head[1], horiz });
    }
  }
  // Pohon di luar kota
  for (let i = 0, n = 0; n < 120 && i < 2000; i++) {
    const x = (rng() * 2 - 1) * (o1 + 75);
    const z = (rng() * 2 - 1) * (o1 + 75);
    if (Math.max(Math.abs(x), Math.abs(z)) < o1 + 7) continue;
    treeSpots.push([x, z, 0.9 + rng() * 0.6]);
    n++;
  }

  const trunkGeo = res.add(new THREE.CylinderGeometry(0.16, 0.24, 2.4, 6));
  trunkGeo.translate(0, 1.2, 0);
  const crownGeo = res.add(new THREE.IcosahedronGeometry(1.9, 0));
  crownGeo.translate(0, 3.9, 0);
  const trunkMat = res.add(new THREE.MeshLambertMaterial({ color: '#5b4636' }));
  const crownMat = res.add(new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true }));
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeSpots.length);
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, treeSpots.length);
  const greens = ['#2f6b3f', '#3b7a47', '#2a5c38', '#4b8a52', '#356f45'].map(col);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  treeSpots.forEach(([x, z, s], i) => {
    q.setFromAxisAngle(up, rng() * Math.PI * 2);
    m4.compose(new THREE.Vector3(x, 0.15, z), q, new THREE.Vector3(s, s * (0.9 + rng() * 0.25), s));
    trunks.setMatrixAt(i, m4);
    crowns.setMatrixAt(i, m4);
    crowns.setColorAt(i, greens[Math.floor(rng() * greens.length)]);
    out.trees.push({ x, z, r: 0.5 * s, h: 6 * s });
  });
  trunks.castShadow = crowns.castShadow = true;
  group.add(trunks, crowns);

  // Tiang lampu jalan (digabung) dan kepala lampu (instanced)
  const props = new GeoBuf();
  const poleCol = col('#39414f');
  for (const L of lampSpots) {
    props.box(L.bx - 0.09, 0.15, L.bz - 0.09, L.bx + 0.09, 6.6, L.bz + 0.09, poleCol);
    const ax0 = Math.min(L.bx, L.hx) - 0.06;
    const ax1 = Math.max(L.bx, L.hx) + 0.06;
    const az0 = Math.min(L.bz, L.hz) - 0.06;
    const az1 = Math.max(L.bz, L.hz) + 0.06;
    props.box(ax0, 6.5, az0, ax1, 6.62, az1, poleCol);
    out.poles.push({ x: L.bx, z: L.bz, r: 0.12, h: 6.6 });
  }
  const propMat = res.add(new THREE.MeshLambertMaterial({ vertexColors: true }));
  const propMesh = new THREE.Mesh(res.add(props.build()), propMat);
  propMesh.castShadow = true;
  group.add(propMesh);

  const headGeo = res.add(new THREE.BoxGeometry(0.9, 0.14, 0.42));
  const headMat = res.add(new THREE.MeshBasicMaterial({ color: '#9aa3ae' }));
  const heads = new THREE.InstancedMesh(headGeo, headMat, lampSpots.length);
  const poolGeo = res.add(new THREE.CircleGeometry(7.5, 24));
  poolGeo.rotateX(-Math.PI / 2);
  // Cahaya paling terang di bawah lampu lalu memudar ke tepi (warna titik: pusat 1, tepi 0).
  const poolCol = new Float32Array(poolGeo.attributes.position.count * 3);
  for (let i = 0; i < poolGeo.attributes.position.count; i++) {
    const r = Math.hypot(poolGeo.attributes.position.getX(i), poolGeo.attributes.position.getZ(i)) / 7.5;
    const k = Math.max(0, 1 - r) ** 1.4;
    poolCol[i * 3] = poolCol[i * 3 + 1] = poolCol[i * 3 + 2] = k;
  }
  poolGeo.setAttribute('color', new THREE.BufferAttribute(poolCol, 3));
  const poolMat = res.add(
    new THREE.MeshBasicMaterial({ color: '#ffc27a', vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
  );
  const pools = new THREE.InstancedMesh(poolGeo, poolMat, lampSpots.length);
  lampSpots.forEach((L, i) => {
    q.setFromAxisAngle(up, L.horiz ? Math.PI / 2 : 0);
    m4.compose(new THREE.Vector3(L.hx, 6.45, L.hz), q, new THREE.Vector3(1, 1, 1));
    heads.setMatrixAt(i, m4);
    // sedikit di atas trotoar (0,15 m) supaya lingkaran cahaya tidak terpotong kerb
    m4.compose(new THREE.Vector3(L.hx, 0.17, L.hz), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
    pools.setMatrixAt(i, m4);
  });
  pools.renderOrder = 2;
  pools.visible = false;
  group.add(heads, pools);
  out.mats.lampHead = headMat;
  out.mats.lampPool = poolMat;
  out.pools = pools;
  out.group = group;
  return out;
}
