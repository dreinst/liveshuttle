// Matematika dasar: skalar, sudut, vektor 2D, RNG berbiji, dan format angka Indonesia.
//
// Konvensi koordinat dunia (berlaku di seluruh engine):
//   x ke kanan, y ke BAWAH (sama seperti layar), satuan meter.
//   heading dalam radian, 0 = menghadap +x, bertambah searah jarum jam di layar.
//   Arah maju = (cos h, sin h). Sisi kiri kendaraan = (sin h, -cos h).

export const TAU = Math.PI * 2;
export const G = 9.81; // percepatan gravitasi (m/s^2)

// ---------- skalar ----------

export const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (a === b ? 0 : (v - a) / (b - a));
export const remap = (v, a0, a1, b0, b1) => lerp(b0, b1, invLerp(a0, a1, v));
export const smoothstep = (a, b, v) => {
  const t = clamp(invLerp(a, b, v), 0, 1);
  return t * t * (3 - 2 * t);
};
/** Gerakkan `current` menuju `target` paling jauh `maxDelta`. */
export const approach = (current, target, maxDelta) =>
  current < target ? Math.min(current + maxDelta, target) : Math.max(current - maxDelta, target);
export const round = (v, digits = 0) => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

// ---------- sudut ----------

export const degToRad = (d) => (d * Math.PI) / 180;
export const radToDeg = (r) => (r * 180) / Math.PI;
/** Bungkus sudut ke rentang (-PI, PI]. */
export function wrapAngle(a) {
  a = ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return a === -Math.PI ? Math.PI : a;
}
/** Selisih sudut terpendek a - b, hasil di (-PI, PI]. */
export const angleDiff = (a, b) => wrapAngle(a - b);

// ---------- satuan ----------

export const kmhToMs = (kmh) => kmh / 3.6;
export const msToKmh = (ms) => ms * 3.6;

// ---------- vektor 2D (objek {x, y}, tidak diubah di tempat) ----------

export const vec = (x = 0, y = 0) => ({ x, y });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a, s) => ({ x: a.x * s, y: a.y * s });
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const cross = (a, b) => a.x * b.y - a.y * b.x;
export const length = (a) => Math.hypot(a.x, a.y);
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
export function normalize(a) {
  const l = Math.hypot(a.x, a.y);
  return l > 1e-12 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
}
export function rotate(a, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
}
/** Vektor satuan dari sudut. */
export const fromAngle = (angle, len = 1) => ({ x: Math.cos(angle) * len, y: Math.sin(angle) * len });
export const angleOf = (a) => Math.atan2(a.y, a.x);
/** Arah kiri dari vektor arah d (ingat: y ke bawah). */
export const leftOf = (d) => ({ x: d.y, y: -d.x });
/** Arah kanan dari vektor arah d. */
export const rightOf = (d) => ({ x: -d.y, y: d.x });
export const lerpVec = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/**
 * Ubah titik dunia ke kerangka lokal sebuah pose.
 * Hasil: x = jarak ke depan, y = jarak ke KANAN (positif) atau kiri (negatif).
 */
export function toLocal(pose, p) {
  const dx = p.x - pose.x;
  const dy = p.y - pose.y;
  const c = Math.cos(pose.heading);
  const s = Math.sin(pose.heading);
  return { x: dx * c + dy * s, y: -dx * s + dy * c };
}
/** Kebalikan toLocal. */
export function toWorld(pose, p) {
  const c = Math.cos(pose.heading);
  const s = Math.sin(pose.heading);
  return { x: pose.x + p.x * c - p.y * s, y: pose.y + p.x * s + p.y * c };
}

// ---------- angka acak berbiji ----------

/** PRNG mulberry32: cepat dan deterministik. Mengembalikan fungsi () => [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Noise gaussian (Box-Muller) dari sumber acak uniform. */
export function gaussian(rand = Math.random, mean = 0, sd = 1) {
  let u = 0;
  while (u === 0) u = rand();
  const v = rand();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
}

/** Pembangkit acak berbiji dengan fungsi bantu. Pakai seed yang sama untuk hasil yang bisa diulang. */
export class Rng {
  constructor(seed = 1) {
    this.reseed(seed);
  }
  reseed(seed) {
    this.seed = seed >>> 0;
    this._next = mulberry32(this.seed);
    return this;
  }
  /** Angka uniform [0, 1). */
  next() {
    return this._next();
  }
  /** Angka uniform [min, max). */
  range(min, max) {
    return min + (max - min) * this._next();
  }
  /** Bilangan bulat [min, max] (inklusif). */
  int(min, max) {
    return Math.floor(min + (max - min + 1) * this._next());
  }
  chance(p) {
    return this._next() < p;
  }
  pick(arr) {
    return arr[Math.floor(this._next() * arr.length)];
  }
  gaussian(mean = 0, sd = 1) {
    return gaussian(this._next, mean, sd);
  }
}

// ---------- format angka Indonesia ----------

const formatters = new Map();
function formatter(digits, signed) {
  const key = `${digits}|${signed}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat('id-ID', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      signDisplay: signed ? 'exceptZero' : 'auto',
    });
    formatters.set(key, f);
  }
  return f;
}

/**
 * Format angka dengan koma desimal gaya Indonesia.
 *   fmt(12.345, 1)        -> "12,3"
 *   fmt(12.345, 1, 'm')   -> "12,3 m"
 *   fmt(1500)             -> "1.500"
 * Nilai kosong atau NaN menjadi "-".
 */
export function fmt(value, digits = 0, unit = '') {
  return format(value, digits, unit, false);
}

/** Seperti fmt, tetapi angka positif diberi tanda "+" (contoh: "+3,2 m/s"). */
export function fmtSigned(value, digits = 0, unit = '') {
  return format(value, digits, unit, true);
}

function format(value, digits, unit, signed) {
  if (value == null || Number.isNaN(value)) return '-';
  if (!Number.isFinite(value)) return value > 0 ? '∞' : '-∞';
  let n = round(value, digits);
  if (n === 0) n = 0; // buang -0
  const s = formatter(digits, signed).format(n);
  return unit ? `${s} ${unit}` : s;
}

/** Kecepatan dari m/s ke teks km/jam, contoh fmtSpeed(10) -> "36 km/jam". */
export const fmtSpeed = (ms, digits = 0) => fmt(msToKmh(ms), digits, 'km/jam');
/** Jarak dalam meter, contoh fmtDist(3.456) -> "3,5 m". */
export const fmtDist = (m, digits = 1) => fmt(m, digits, 'm');
/** Waktu dalam detik, contoh fmtTime(2.25) -> "2,3 detik". */
export const fmtTime = (s, digits = 1) => fmt(s, digits, 'detik');
/** Rasio 0 sampai 1 menjadi persen, contoh fmtPercent(0.42) -> "42%". */
export const fmtPercent = (ratio, digits = 0) => `${fmt(ratio * 100, digits)}%`;
