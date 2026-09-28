// Utilitas kecil untuk simulator 3D: angka, RNG berbiji, DOM, dan pembersihan sumber daya.
import { fmt as engineFmt } from '../engine/math.js';

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);
export const kmh = (ms) => ms * 3.6;
export const ms = (kmhValue) => kmhValue / 3.6;

export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

export function mulberry32(seed) {
  let t = seed >>> 0;
  return function rng() {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Format angka gaya Indonesia (koma desimal). Memakai fmt() dari engine. */
export function fmt(value, digits = 0, unit = '') {
  return engineFmt(value, digits, unit);
}

/** Membuat elemen DOM kecil tanpa pustaka. */
export function el(tag, props = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'style') n.style.cssText = v;
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else n.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    n.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return n;
}

/** Mencatat semua listener dan fungsi pembersih supaya destroy() bisa melepas semuanya. */
export class Disposer {
  constructor() {
    this.fns = [];
  }
  on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this.fns.push(() => target.removeEventListener(type, fn, opts));
    return fn;
  }
  add(fn) {
    this.fns.push(fn);
  }
  run() {
    const list = this.fns.splice(0).reverse();
    for (const f of list) {
      try {
        f();
      } catch (e) {
        /* abaikan kegagalan saat membersihkan */
      }
    }
  }
}

/** Daftar geometri, material, dan tekstur yang harus di-dispose saat simulator ditutup. */
export class Res {
  constructor() {
    this.items = new Set();
  }
  add(x) {
    if (x) this.items.add(x);
    return x;
  }
  dispose() {
    for (const x of this.items) {
      try {
        x.dispose();
      } catch (e) {
        /* abaikan */
      }
    }
    this.items.clear();
  }
}

/** Dispose semua geometri, material, dan tekstur di bawah satu objek 3D. */
export function disposeTree(root) {
  const geos = new Set();
  const mats = new Set();
  const texs = new Set();
  root.traverse((o) => {
    if (o.geometry) geos.add(o.geometry);
    const m = o.material;
    if (m) (Array.isArray(m) ? m : [m]).forEach((mm) => mats.add(mm));
    if (o.isInstancedMesh && typeof o.dispose === 'function') o.dispose();
  });
  for (const m of mats) {
    for (const key of Object.keys(m)) {
      const v = m[key];
      if (v && v.isTexture) texs.add(v);
    }
    m.dispose();
  }
  geos.forEach((g) => g.dispose());
  texs.forEach((t) => t.dispose());
}
