// Geometri 2D di bidang x,z (y ke atas hanya untuk tampilan).
// Arah maju untuk heading h adalah (cos h, sin h). Sisi kanan pengemudi = (-sin h, cos h).
// Semua uji sinar di sini analitik (kotak, lingkaran), tidak memakai Raycaster three.js.

/** Polyline dengan panjang kumulatif, dipakai untuk lajur dan jalur rencana. */
export class Poly {
  constructor(pts) {
    const n = pts.length;
    this.n = n;
    this.x = new Float64Array(n);
    this.z = new Float64Array(n);
    this.cum = new Float64Array(n);
    this.h = new Float64Array(Math.max(1, n - 1));
    let L = 0;
    for (let i = 0; i < n; i++) {
      this.x[i] = pts[i][0];
      this.z[i] = pts[i][1];
      if (i > 0) {
        const dx = this.x[i] - this.x[i - 1];
        const dz = this.z[i] - this.z[i - 1];
        L += Math.hypot(dx, dz);
        this.h[i - 1] = Math.atan2(dz, dx);
      }
      this.cum[i] = L;
    }
    this.len = L;
  }

  /** Titik pada jarak s dari awal. Hasil ditulis ke out {x, z, h}. */
  at(s, out = {}) {
    const n = this.n;
    if (s <= 0) {
      out.x = this.x[0] + Math.cos(this.h[0]) * s;
      out.z = this.z[0] + Math.sin(this.h[0]) * s;
      out.h = this.h[0];
      return out;
    }
    if (s >= this.len) {
      const hl = this.h[n - 2];
      const e = s - this.len;
      out.x = this.x[n - 1] + Math.cos(hl) * e;
      out.z = this.z[n - 1] + Math.sin(hl) * e;
      out.h = hl;
      return out;
    }
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] <= s) lo = mid;
      else hi = mid;
    }
    const segLen = this.cum[hi] - this.cum[lo] || 1;
    const t = (s - this.cum[lo]) / segLen;
    out.x = this.x[lo] + (this.x[hi] - this.x[lo]) * t;
    out.z = this.z[lo] + (this.z[hi] - this.z[lo]) * t;
    out.h = this.h[lo];
    return out;
  }

  /** Proyeksi titik ke polyline: s, lat (positif = kanan arah jalan), jarak kuadrat. */
  project(px, pz, out = {}) {
    let best = Infinity;
    let bs = 0;
    let blat = 0;
    for (let i = 0; i < this.n - 1; i++) {
      const ax = this.x[i];
      const az = this.z[i];
      const dx = this.x[i + 1] - ax;
      const dz = this.z[i + 1] - az;
      const L2 = dx * dx + dz * dz || 1e-9;
      let t = ((px - ax) * dx + (pz - az) * dz) / L2;
      const first = i === 0;
      const last = i === this.n - 2;
      if (t < 0 && !first) t = 0;
      if (t > 1 && !last) t = 1;
      const qx = ax + dx * t;
      const qz = az + dz * t;
      const ex = px - qx;
      const ez = pz - qz;
      // Titik di luar ujung (t < 0 atau t > 1) dihitung jarak lateralnya saja.
      const L = Math.sqrt(L2);
      const lat = (-dz * ex + dx * ez) / L;
      const d2 = t < 0 || t > 1 ? lat * lat + Math.pow((t < 0 ? -t : t - 1) * L, 2) * 0.25 : ex * ex + ez * ez;
      if (d2 < best) {
        best = d2;
        bs = this.cum[i] + t * L;
        blat = lat;
      }
    }
    out.s = bs;
    out.lat = blat;
    out.d2 = best;
    return out;
  }
}

/** Sinar vs kotak sejajar sumbu. Mengembalikan t masuk (>= 0) atau Infinity. */
export function rayAabb(ox, oz, dx, dz, minx, minz, maxx, maxz) {
  let tmin = -Infinity;
  let tmax = Infinity;
  if (Math.abs(dx) < 1e-12) {
    if (ox < minx || ox > maxx) return Infinity;
  } else {
    let t1 = (minx - ox) / dx;
    let t2 = (maxx - ox) / dx;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
  }
  if (Math.abs(dz) < 1e-12) {
    if (oz < minz || oz > maxz) return Infinity;
  } else {
    let t1 = (minz - oz) / dz;
    let t2 = (maxz - oz) / dz;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
  }
  if (tmax < tmin || tmax < 0) return Infinity;
  return tmin >= 0 ? tmin : 0;
}

/** Sinar vs lingkaran. */
export function rayCircle(ox, oz, dx, dz, cx, cz, r) {
  const fx = ox - cx;
  const fz = oz - cz;
  const b = fx * dx + fz * dz;
  const c = fx * fx + fz * fz - r * r;
  if (c <= 0) return 0;
  const disc = b * b - c;
  if (disc < 0 || b > 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : Infinity;
}

/** Sinar vs kotak berorientasi (pusat cx,cz, heading dengan cos c dan sin s, setengah panjang hl, setengah lebar hw). */
export function rayObb(ox, oz, dx, dz, cx, cz, c, s, hl, hw) {
  const rx = ox - cx;
  const rz = oz - cz;
  const lox = rx * c + rz * s;
  const loz = -rx * s + rz * c;
  const ldx = dx * c + dz * s;
  const ldz = -dx * s + dz * c;
  return rayAabb(lox, loz, ldx, ldz, -hl, -hw, hl, hw);
}

/** Uji tumpang tindih dua kotak berorientasi {x, z, h, hl, hw} dengan SAT. */
export function obbOverlap(a, b) {
  const ac = Math.cos(a.h);
  const as = Math.sin(a.h);
  const bc = Math.cos(b.h);
  const bs = Math.sin(b.h);
  const axes = [
    [ac, as],
    [-as, ac],
    [bc, bs],
    [-bs, bc],
  ];
  const tx = b.x - a.x;
  const tz = b.z - a.z;
  for (const [ux, uz] of axes) {
    const ra = a.hl * Math.abs(ac * ux + as * uz) + a.hw * Math.abs(-as * ux + ac * uz);
    const rb = b.hl * Math.abs(bc * ux + bs * uz) + b.hw * Math.abs(-bs * ux + bc * uz);
    if (Math.abs(tx * ux + tz * uz) > ra + rb) return false;
  }
  return true;
}

/** Uji kotak berorientasi vs lingkaran. */
export function obbCircle(a, cx, cz, r) {
  const c = Math.cos(a.h);
  const s = Math.sin(a.h);
  const rx = cx - a.x;
  const rz = cz - a.z;
  const lx = rx * c + rz * s;
  const lz = -rx * s + rz * c;
  const qx = Math.max(-a.hl, Math.min(a.hl, lx));
  const qz = Math.max(-a.hw, Math.min(a.hw, lz));
  const ex = lx - qx;
  const ez = lz - qz;
  return ex * ex + ez * ez < r * r;
}

/** Uji kotak berorientasi vs kotak sejajar sumbu (bangunan). */
export function obbAabb(a, minx, minz, maxx, maxz) {
  return obbOverlap(a, { x: (minx + maxx) / 2, z: (minz + maxz) / 2, h: 0, hl: (maxx - minx) / 2, hw: (maxz - minz) / 2 });
}
