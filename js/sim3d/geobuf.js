// Penampung geometri gabungan (posisi, normal, warna per titik, UV) supaya banyak benda statis
// bisa digambar dengan sedikit draw call. Dipakai kota, lampu lalu lintas, dan model.
import * as THREE from '../vendor/three.bundle.min.js';

export class GeoBuf {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.uv = [];
    this.idx = [];
    this.n = 0;
  }

  get empty() {
    return this.n === 0;
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

  /** Poligon datar (menghadap ke atas) di ketinggian y. pts = [[x, z], ...]. */
  flatPoly(pts, y, color) {
    if (pts.length < 3) return;
    const contour = pts.map((p) => new THREE.Vector2(p[0], p[1]));
    let faces;
    try {
      faces = THREE.ShapeUtils.triangulateShape(contour, []);
    } catch (e) {
      return;
    }
    const base = this.n;
    for (const p of pts) {
      this.pos.push(p[0], y, p[1]);
      this.nor.push(0, 1, 0);
      this.col.push(color.r, color.g, color.b);
      this.uv.push(p[0] / 8, p[1] / 8);
    }
    for (const f of faces) {
      // pastikan segitiga menghadap ke atas
      const [i, j, k] = f;
      const ax = pts[j][0] - pts[i][0];
      const az = pts[j][1] - pts[i][1];
      const bx = pts[k][0] - pts[i][0];
      const bz = pts[k][1] - pts[i][1];
      const ny = az * bx - ax * bz; // komponen y dari (b-a) x (c-a) di bidang x,z
      if (ny >= 0) this.idx.push(base + i, base + j, base + k);
      else this.idx.push(base + i, base + k, base + j);
    }
    this.n += pts.length;
  }

  /** Pita datar selebar w di sepanjang polyline pts (x, z) pada ketinggian y. */
  ribbon(pts, w, y, color, off = 0) {
    const n = pts.length;
    if (n < 2) return;
    const L = [];
    const R = [];
    for (let i = 0; i < n; i++) {
      let nx;
      let nz;
      if (i === 0 || i === n - 1) {
        const a = pts[i === 0 ? 0 : n - 2];
        const b = pts[i === 0 ? 1 : n - 1];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        nx = (b[1] - a[1]) / len;
        nz = -(b[0] - a[0]) / len;
      } else {
        const a = pts[i - 1];
        const b = pts[i];
        const c = pts[i + 1];
        const l1 = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const l2 = Math.hypot(c[0] - b[0], c[1] - b[1]) || 1;
        const n1x = (b[1] - a[1]) / l1;
        const n1z = -(b[0] - a[0]) / l1;
        const n2x = (c[1] - b[1]) / l2;
        const n2z = -(c[0] - b[0]) / l2;
        let mx = n1x + n2x;
        let mz = n1z + n2z;
        const ml = Math.hypot(mx, mz) || 1;
        mx /= ml;
        mz /= ml;
        const cs = Math.max(0.5, mx * n1x + mz * n1z);
        nx = mx / cs;
        nz = mz / cs;
      }
      const p = pts[i];
      L.push([p[0] + nx * (off + w / 2), y, p[1] + nz * (off + w / 2)]);
      R.push([p[0] + nx * (off - w / 2), y, p[1] + nz * (off - w / 2)]);
    }
    for (let i = 0; i < n - 1; i++) this.quad(L[i], L[i + 1], R[i + 1], R[i], 0, 1, 0, color);
  }

  /** Persegi panjang berorientasi datar: pusat (cx, cz), arah h, panjang len, lebar wid. */
  rect(cx, cz, h, len, wid, y, color) {
    const c = Math.cos(h);
    const s = Math.sin(h);
    const hl = len / 2;
    const hw = wid / 2;
    const P = (u, v) => [cx + c * u - s * v, y, cz + s * u + c * v];
    this.quad(P(-hl, -hw), P(hl, -hw), P(hl, hw), P(-hl, hw), 0, 1, 0, color);
  }

  /** Kotak sejajar sumbu. */
  box(x0, y0, z0, x1, y1, z1, color, opts = {}) {
    const side = opts.side || color;
    if (opts.top !== false) this.quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], 0, 1, 0, color);
    this.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], 1, 0, 0, side);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], -1, 0, 0, side);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], 0, 0, 1, side);
    this.quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], 0, 0, -1, side);
    if (opts.bottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], 0, -1, 0, side);
  }

  /** Kotak berorientasi: pusat (cx, cz), arah h, ukuran len x wid, dari y0 sampai y1. */
  obox(cx, cz, h, len, wid, y0, y1, color, side) {
    const c = Math.cos(h);
    const s = Math.sin(h);
    const hl = len / 2;
    const hw = wid / 2;
    const P = (u, v, y) => [cx + c * u - s * v, y, cz + s * u + c * v];
    const sc = side || color;
    this.quad(P(-hl, -hw, y1), P(hl, -hw, y1), P(hl, hw, y1), P(-hl, hw, y1), 0, 1, 0, color);
    const faces = [
      [[hl, -hw], [hl, hw], [c, s]],
      [[-hl, hw], [-hl, -hw], [-c, -s]],
      [[hl, hw], [-hl, hw], [-s, c]],
      [[-hl, -hw], [hl, -hw], [s, -c]],
    ];
    for (const [a, b, n] of faces) this.quad(P(a[0], a[1], y0), P(b[0], b[1], y0), P(b[0], b[1], y1), P(a[0], a[1], y1), n[0], 0, n[1], sc);
  }

  /** Dinding tegak di sepanjang poligon (ekstrusi) dari y0 ke y1, dengan UV untuk tekstur jendela. */
  walls(pts, y0, y1, color, uScale = 1 / 6, vScale = 1 / 3.2, u0 = 0) {
    const n = pts.length;
    let u = u0;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1e-3) continue;
      // poligon berlawanan arah jarum jam di bidang x,z (luas positif): normal keluar = (dz, -dx)
      const nx = (b[1] - a[1]) / len;
      const nz = -(b[0] - a[0]) / len;
      const u1 = u + len * uScale;
      this.quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], nx, 0, nz, color, [u, y0 * vScale, u1, y0 * vScale, u1, y1 * vScale, u, y1 * vScale]);
      u = u1;
    }
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.n > 65000 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/**
 * Beberapa GeoBuf per petak (tile) persegi. Geometri statis kota dibagi ke petak supaya three.js
 * bisa membuang petak di luar pandangan kamera (frustum culling), juga saat menggambar bayangan.
 * Pakai at(x, z) untuk mengambil GeoBuf petak di titik itu.
 */
export class TiledBuf {
  constructor(tile, x0, z0) {
    this.tile = tile;
    this.x0 = x0;
    this.z0 = z0;
    this.bufs = new Map();
  }

  at(x, z) {
    const i = Math.floor((x - this.x0) / this.tile);
    const j = Math.floor((z - this.z0) / this.tile);
    const k = i * 1000 + j;
    let b = this.bufs.get(k);
    if (!b) {
      b = new GeoBuf();
      this.bufs.set(k, b);
    }
    return b;
  }

  get empty() {
    for (const b of this.bufs.values()) if (!b.empty) return false;
    return true;
  }

  /** Satu BufferGeometry per petak yang tidak kosong. */
  build() {
    const out = [];
    for (const b of this.bufs.values()) if (!b.empty) out.push(b.build());
    return out;
  }
}
