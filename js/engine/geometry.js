// Geometri 2D: raycast, kotak berorientasi, poligon, polyline, dan kelas Path.
//
// Bentuk (shape) yang dikenali raycast dan uji tabrakan:
//   kotak   { x, y, heading, length, width }   titik tengah, length searah heading
//   lingkaran { x, y, radius }
//   poligon { points: [{x, y}, ...] }
// Semua objek kendaraan dari vehicle.js otomatis berbentuk kotak.

import { wrapAngle } from './math.js';

// ---------- raycast dasar (argumen angka supaya cepat, arah d sebaiknya satuan) ----------

/** Jarak t sepanjang sinar o + t*d ke segmen a-b, atau Infinity bila tidak kena. */
export function raySegment(ox, oy, dx, dy, ax, ay, bx, by) {
  const ex = bx - ax;
  const ey = by - ay;
  const denom = dx * ey - dy * ex;
  if (denom > -1e-12 && denom < 1e-12) return Infinity;
  const wx = ax - ox;
  const wy = ay - oy;
  const t = (wx * ey - wy * ex) / denom;
  const u = (wx * dy - wy * dx) / denom;
  return t >= 0 && u >= 0 && u <= 1 ? t : Infinity;
}

/** Jarak t sinar ke lingkaran, atau Infinity. Bila titik awal di dalam lingkaran hasilnya 0. */
export function rayCircle(ox, oy, dx, dy, cx, cy, r) {
  const fx = ox - cx;
  const fy = oy - cy;
  const c = fx * fx + fy * fy - r * r;
  if (c <= 0) return 0;
  const b = fx * dx + fy * dy;
  if (b > 0) return Infinity;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : Infinity;
}

/** Jarak t sinar ke kotak berorientasi, atau Infinity. Bila titik awal di dalam kotak hasilnya 0. */
export function rayBox(ox, oy, dx, dy, box) {
  const c = Math.cos(box.heading || 0);
  const s = Math.sin(box.heading || 0);
  const rx = ox - box.x;
  const ry = oy - box.y;
  // pindah ke kerangka lokal kotak
  const lox = rx * c + ry * s;
  const loy = -rx * s + ry * c;
  const ldx = dx * c + dy * s;
  const ldy = -dx * s + dy * c;
  const hx = box.length / 2;
  const hy = box.width / 2;
  let tmin = -Infinity;
  let tmax = Infinity;
  if (Math.abs(ldx) < 1e-12) {
    if (lox < -hx || lox > hx) return Infinity;
  } else {
    let t1 = (-hx - lox) / ldx;
    let t2 = (hx - lox) / ldx;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
  }
  if (Math.abs(ldy) < 1e-12) {
    if (loy < -hy || loy > hy) return Infinity;
  } else {
    let t1 = (-hy - loy) / ldy;
    let t2 = (hy - loy) / ldy;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
  }
  if (tmax < tmin || tmax < 0) return Infinity;
  return tmin >= 0 ? tmin : 0;
}

/** Jarak t sinar ke poligon (tepi-tepinya), atau Infinity. */
export function rayPolygon(ox, oy, dx, dy, points) {
  let best = Infinity;
  for (let i = 0, n = points.length; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const t = raySegment(ox, oy, dx, dy, a.x, a.y, b.x, b.y);
    if (t < best) best = t;
  }
  return best;
}

/** Jenis bentuk sebuah objek: 'circle', 'polygon', atau 'box'. */
export function shapeType(obj) {
  if (obj.shape) return obj.shape;
  if (obj.points) return 'polygon';
  if (obj.radius != null) return 'circle';
  return 'box';
}

/** Raycast ke satu objek dengan bentuk apa pun. */
export function rayShape(ox, oy, dx, dy, obj) {
  switch (shapeType(obj)) {
    case 'circle':
      return rayCircle(ox, oy, dx, dy, obj.x, obj.y, obj.radius);
    case 'polygon':
      return rayPolygon(ox, oy, dx, dy, obj.points);
    default:
      return rayBox(ox, oy, dx, dy, obj);
  }
}

/** Jari-jari lingkaran pembatas sebuah objek (untuk penyaringan cepat). */
export function boundingRadius(obj) {
  switch (shapeType(obj)) {
    case 'circle':
      return obj.radius;
    case 'polygon': {
      const c = polygonCentroid(obj.points);
      let r = 0;
      for (const p of obj.points) r = Math.max(r, Math.hypot(p.x - c.x, p.y - c.y));
      return r;
    }
    default:
      return Math.hypot(obj.length, obj.width) / 2;
  }
}

/** Titik pusat objek: titik berat untuk poligon (disimpan di obj._centroid), selain itu (x, y). */
export function shapeCenter(obj) {
  if (shapeType(obj) === 'polygon') {
    if (!obj._centroid) obj._centroid = polygonCentroid(obj.points);
    return obj._centroid;
  }
  return obj;
}

/**
 * Tembakkan satu sinar ke daftar objek dan kembalikan tabrakan terdekat.
 * @param {Array} objects objek berbentuk kotak, lingkaran, atau poligon
 * @param {number} maxRange jarak maksimum (m)
 * @param {object} [opts] { ignore: objek atau id yang dilewati, filter: (obj) => boolean }
 * @returns {{t:number, x:number, y:number, object:object}|null}
 */
export function castRay(objects, ox, oy, dx, dy, maxRange, opts = {}) {
  const { ignore = null, filter = null } = opts;
  let bestT = maxRange;
  let bestObj = null;
  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];
    if (obj === ignore || (ignore != null && obj.id === ignore)) continue;
    if (filter && !filter(obj)) continue;
    // penyaringan cepat dengan lingkaran pembatas
    const center = shapeCenter(obj);
    const r = obj._br ?? boundingRadius(obj);
    const cx = center.x - ox;
    const cy = center.y - oy;
    const proj = cx * dx + cy * dy;
    if (proj < -r || proj - r > bestT) continue;
    const perp2 = cx * cx + cy * cy - proj * proj;
    if (perp2 > r * r) continue;
    const t = rayShape(ox, oy, dx, dy, obj);
    if (t < bestT) {
      bestT = t;
      bestObj = obj;
    }
  }
  if (!bestObj) return null;
  return { t: bestT, x: ox + dx * bestT, y: oy + dy * bestT, object: bestObj };
}

/**
 * Apakah garis pandang dari (ax, ay) ke (bx, by) bebas halangan?
 * Objek `target` dan `ignore` tidak dihitung sebagai penghalang.
 */
export function lineOfSight(objects, ax, ay, bx, by, { target = null, ignore = null, filter = null } = {}) {
  const dx = bx - ax;
  const dy = by - ay;
  const d = Math.hypot(dx, dy);
  if (d < 1e-9) return true;
  const hit = castRay(objects, ax, ay, dx / d, dy / d, d - 0.05, {
    ignore,
    filter: (o) => o !== target && (!filter || filter(o)),
  });
  return !hit;
}

// ---------- kotak berorientasi ----------

/** Empat sudut kotak: depan-kiri, depan-kanan, belakang-kanan, belakang-kiri. */
export function boxCorners(box) {
  const c = Math.cos(box.heading || 0);
  const s = Math.sin(box.heading || 0);
  const hl = box.length / 2;
  const hw = box.width / 2;
  // sumbu maju (c, s), sumbu kiri (s, -c)
  const fx = c * hl;
  const fy = s * hl;
  const lx = s * hw;
  const ly = -c * hw;
  return [
    { x: box.x + fx + lx, y: box.y + fy + ly },
    { x: box.x + fx - lx, y: box.y + fy - ly },
    { x: box.x - fx - lx, y: box.y - fy - ly },
    { x: box.x - fx + lx, y: box.y - fy + ly },
  ];
}

export function pointInBox(px, py, box, margin = 0) {
  const c = Math.cos(box.heading || 0);
  const s = Math.sin(box.heading || 0);
  const rx = px - box.x;
  const ry = py - box.y;
  const lx = rx * c + ry * s;
  const ly = -rx * s + ry * c;
  return Math.abs(lx) <= box.length / 2 + margin && Math.abs(ly) <= box.width / 2 + margin;
}

function projectCorners(corners, ax, ay) {
  let min = Infinity;
  let max = -Infinity;
  for (const p of corners) {
    const d = p.x * ax + p.y * ay;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return [min, max];
}

/** Uji tumpang tindih dua kotak berorientasi (Separating Axis Theorem). */
export function boxesOverlap(a, b, margin = 0) {
  const ca = boxCorners(margin ? { ...a, length: a.length + 2 * margin, width: a.width + 2 * margin } : a);
  const cb = boxCorners(b);
  const axes = [a.heading || 0, (a.heading || 0) + Math.PI / 2, b.heading || 0, (b.heading || 0) + Math.PI / 2];
  for (const ang of axes) {
    const ax = Math.cos(ang);
    const ay = Math.sin(ang);
    const [amin, amax] = projectCorners(ca, ax, ay);
    const [bmin, bmax] = projectCorners(cb, ax, ay);
    if (amax < bmin || bmax < amin) return false;
  }
  return true;
}

/** Jarak dari titik ke tepi kotak (0 bila di dalam). */
export function distanceToBox(px, py, box) {
  const c = Math.cos(box.heading || 0);
  const s = Math.sin(box.heading || 0);
  const rx = px - box.x;
  const ry = py - box.y;
  const lx = Math.abs(rx * c + ry * s) - box.length / 2;
  const ly = Math.abs(-rx * s + ry * c) - box.width / 2;
  return Math.hypot(Math.max(lx, 0), Math.max(ly, 0));
}

/** Jarak dari titik ke objek berbentuk apa pun (0 bila di dalam). */
export function distanceToShape(px, py, obj) {
  switch (shapeType(obj)) {
    case 'circle':
      return Math.max(0, Math.hypot(px - obj.x, py - obj.y) - obj.radius);
    case 'polygon': {
      if (pointInPolygon(px, py, obj.points)) return 0;
      let best = Infinity;
      const pts = obj.points;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        const q = closestPointOnSegment(px, py, a.x, a.y, b.x, b.y);
        best = Math.min(best, Math.hypot(px - q.x, py - q.y));
      }
      return best;
    }
    default:
      return distanceToBox(px, py, obj);
  }
}

/** Apakah titik berada di dalam (atau dekat, dengan margin) sebuah objek? Cocok untuk klik. */
export function hitTest(px, py, obj, margin = 0) {
  return distanceToShape(px, py, obj) <= margin;
}

// ---------- poligon ----------

export function pointInPolygon(px, py, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function polygonCentroid(points) {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}

// ---------- segmen dan polyline ----------

/** Titik terdekat pada segmen a-b dari titik p. t = posisi relatif 0 sampai 1. */
export function closestPointOnSegment(px, py, ax, ay, bx, by) {
  const ex = bx - ax;
  const ey = by - ay;
  const l2 = ex * ex + ey * ey;
  let t = l2 > 0 ? ((px - ax) * ex + (py - ay) * ey) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { x: ax + ex * t, y: ay + ey * t, t };
}

/** Titik potong dua segmen, atau null. */
export function segmentIntersection(a, b, c, d) {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-12) return null;
  const qx = c.x - a.x;
  const qy = c.y - a.y;
  const t = (qx * sy - qy * sx) / denom;
  const u = (qx * ry - qy * rx) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: a.x + rx * t, y: a.y + ry * t, t, u };
}

export function polylineLength(points) {
  let L = 0;
  for (let i = 1; i < points.length; i++) L += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return L;
}

/** Panjang kumulatif tiap titik polyline (elemen pertama 0). */
export function cumulativeLengths(points) {
  const out = new Array(points.length);
  out[0] = 0;
  for (let i = 1; i < points.length; i++) {
    out[i] = out[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return out;
}

/** Titik-titik busur lingkaran. Sudut dalam radian, mengikuti konvensi y ke bawah. */
export function arcPoints(cx, cy, r, a0, a1, segments = 16) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const a = a0 + ((a1 - a0) * i) / segments;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}

/** Titik-titik kurva Bezier kuadrat (3 titik kontrol) atau kubik (4 titik kontrol). */
export function bezierPoints(p0, p1, p2, p3 = null, segments = 16) {
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const u = 1 - t;
    if (p3) {
      pts.push({
        x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
        y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
      });
    } else {
      pts.push({
        x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
        y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
      });
    }
  }
  return pts;
}

/** Gabungkan beberapa polyline, titik yang berimpit di sambungan dibuang. */
export function joinPolylines(...parts) {
  const out = [];
  for (const part of parts) {
    for (const p of part) {
      const last = out[out.length - 1];
      if (last && Math.hypot(last.x - p.x, last.y - p.y) < 1e-6) continue;
      out.push({ x: p.x, y: p.y });
    }
  }
  return out;
}

/**
 * Geser polyline ke samping. offset positif = ke KIRI arah gerak (y ke bawah).
 * Sambungan memakai miter yang dibatasi supaya tikungan tajam tidak meledak.
 */
export function offsetPolyline(points, offset) {
  const n = points.length;
  if (n < 2) return points.map((p) => ({ ...p }));
  const normals = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    const l = Math.hypot(dx, dy) || 1;
    normals.push({ x: dy / l, y: -dx / l }); // kiri dari arah gerak
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
      if (l < 1e-6) {
        nx = b.x;
        ny = b.y;
      } else {
        nx /= l;
        ny /= l;
        const cosHalf = nx * b.x + ny * b.y;
        const k = 1 / Math.max(cosHalf, 0.35);
        nx *= k;
        ny *= k;
      }
    }
    out.push({ x: points[i].x + nx * offset, y: points[i].y + ny * offset });
  }
  return out;
}

/** Sampel ulang polyline dengan jarak antartitik yang sama. */
export function resamplePolyline(points, spacing) {
  const path = new Path(points);
  const n = Math.max(1, Math.round(path.length / spacing));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const p = path.sample((path.length * i) / n);
    out.push({ x: p.x, y: p.y });
  }
  return out;
}

/**
 * Path: polyline dengan panjang kumulatif, dipakai untuk mengikuti jalur.
 * s = jarak sepanjang jalur (m) dari titik awal.
 */
export class Path {
  /**
   * @param {Array<{x:number,y:number}>} points minimal 2 titik
   * @param {{closed?: boolean}} [opts] closed: jalur melingkar (titik akhir tersambung ke awal)
   */
  constructor(points, { closed = false } = {}) {
    if (!points || points.length < 2) throw new Error('Path butuh minimal 2 titik');
    this.points = points.map((p) => ({ x: p.x, y: p.y }));
    this.closed = closed;
    if (closed) this.points.push({ x: this.points[0].x, y: this.points[0].y });
    this.cum = cumulativeLengths(this.points);
    this.length = this.cum[this.cum.length - 1];
  }

  _wrap(s) {
    if (this.closed) return ((s % this.length) + this.length) % this.length;
    return s < 0 ? 0 : s > this.length ? this.length : s;
  }

  _segmentAt(s) {
    // pencarian biner pada panjang kumulatif
    let lo = 0;
    let hi = this.cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] <= s) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  /**
   * Arah segmen i. Segmen dengan panjang nol (titik kembar) memakai arah segmen terdekat yang
   * punya panjang, supaya arah tidak tiba-tiba menjadi 0 (menghadap timur).
   */
  segmentHeading(i) {
    const pts = this.points;
    const n = pts.length - 1;
    for (let d = 0; d < n; d++) {
      for (const j of d === 0 ? [i] : [i + d, i - d]) {
        if (j < 0 || j >= n) continue;
        const dx = pts[j + 1].x - pts[j].x;
        const dy = pts[j + 1].y - pts[j].y;
        if (dx * dx + dy * dy > 1e-18) return Math.atan2(dy, dx);
      }
    }
    return 0;
  }

  /** Posisi dan arah pada jarak s. Hasil: { x, y, heading, s, index }. */
  sample(s) {
    s = this._wrap(s);
    const i = this._segmentAt(s);
    const a = this.points[i];
    const b = this.points[i + 1];
    const segLen = this.cum[i + 1] - this.cum[i];
    const t = segLen > 0 ? (s - this.cum[i]) / segLen : 0;
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      heading: segLen > 0 ? Math.atan2(b.y - a.y, b.x - a.x) : this.segmentHeading(i),
      s,
      index: i,
    };
  }

  /**
   * Titik terdekat pada jalur dari (px, py).
   * Hasil: { x, y, s, dist, heading, lateral, index }. lateral positif = titik ada di KIRI jalur.
   * Beri hintS dan window (m) untuk mencari hanya di sekitar posisi sebelumnya (lebih cepat, tidak lompat).
   * Pada jalur tertutup (closed) hintS diabaikan dan semua segmen diperiksa: hasil selalu benar,
   * hanya lebih lambat untuk jalur yang sangat panjang.
   */
  closest(px, py, hintS = null, window = 30) {
    let best = null;
    let bestD = Infinity;
    const pts = this.points;
    let i0 = 0;
    let i1 = pts.length - 1;
    if (hintS != null && !this.closed) {
      i0 = Math.max(0, this._segmentAt(this._wrap(hintS - window)));
      i1 = Math.min(pts.length - 1, this._segmentAt(this._wrap(hintS + window)) + 1);
    }
    for (let i = i0; i < i1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const q = closestPointOnSegment(px, py, a.x, a.y, b.x, b.y);
      const d = (px - q.x) ** 2 + (py - q.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = { q, i, a, b };
      }
    }
    const { q, i, a, b } = best;
    const heading = a.x === b.x && a.y === b.y ? this.segmentHeading(i) : Math.atan2(b.y - a.y, b.x - a.x);
    const s = this.cum[i] + q.t * (this.cum[i + 1] - this.cum[i]);
    // kiri dari arah jalur = (sin h, -cos h)
    const lateral = (px - q.x) * Math.sin(heading) - (py - q.y) * Math.cos(heading);
    return { x: q.x, y: q.y, s, dist: Math.sqrt(bestD), heading, lateral, index: i };
  }

  /** Selisih arah kendaraan terhadap arah jalur di s, hasil (-PI, PI]. */
  headingError(heading, s) {
    return wrapAngle(heading - this.sample(s).heading);
  }
}
