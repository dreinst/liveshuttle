// Melewati kendaraan parkir atau galian yang menutup lajur.
//
// Dipakai shuttle dan kendaraan NPC. Di jalan dua arah, kendaraan memakai lajur lawan (menyalip dari
// kanan, UU 22 Tahun 2009 Pasal 109 ayat (1)) HANYA bila lajur lawan kosong cukup jauh untuk seluruh
// manuver. Selama manuver, bagian lajur lawan yang dipakai "dipesan": kendaraan dari arah depan
// melihatnya sebagai penghalang diam dan berhenti sebelum bagian itu. Di jalan satu arah dua lajur,
// kendaraan pindah ke lajur sebelahnya bila lajur itu kosong di sekitarnya.
// Rencana berupa profil geser lateral halus (fungsi s di lajur semula): keluar, sejajar penghalang,
// lalu kembali.
import { smoothStep01, smoothStep01d } from './drive.js';
import { DYN } from './traffic.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Passing {
  constructor(app) {
    this.app = app;
    this.city = app.city;
    this.byRoad = new Map();
    for (const l of this.city.lanes) {
      if (l.roadId === undefined || l.roadId < 0) continue;
      let arr = this.byRoad.get(l.roadId);
      if (!arr) this.byRoad.set(l.roadId, (arr = []));
      arr.push(l);
    }
    this.active = [];
    this.ghostN = 0;
    this.PR = {};
    this.O = {};
  }

  /** Lajur yang bisa dipakai untuk melewati penghalang di lajur A: { lane, kind, off } atau null. */
  sideLane(A) {
    const lanes = this.byRoad.get(A.roadId);
    if (!lanes) return null;
    const road = this.city.roadById.get(A.roadId);
    if (!road) return null;
    for (const l of lanes) {
      if (l !== A && l.dir === A.dir) return { lane: l, kind: 'sejajar', off: (l.index > A.index ? 1 : -1) * ((A.width + l.width) / 2) };
    }
    if (!road.ow) {
      for (const l of lanes) if (l.dir === -A.dir) return { lane: l, kind: 'lawan', off: (A.width + l.width) / 2 };
    }
    return null;
  }

  /** s di lajur L untuk titik dunia (x, z). */
  proj(L, x, z) {
    L.poly.project(x, z, this.PR);
    return clamp(this.PR.s, 0, L.len);
  }

  /**
   * Rencana melewati penghalang ob untuk kendaraan veh (di lajur yang sama dengan ob).
   * Mengembalikan { ok: false, why } atau rencana lengkap.
   */
  plan(veh, ob, latBase = 0) {
    const A = ob.lane;
    if (veh.link !== A) return { ok: false, why: 'belum-di-lajur' };
    const side = this.sideLane(A);
    if (!side) return { ok: false, why: 'satu-lajur' };
    const len = veh.len;
    const v = veh.v;
    const Lout = clamp(8 + 1.6 * v, 12, 24);
    const sB = ob.s0 - 1.2 - len / 2;
    let sA = sB - Lout;
    if (sA < veh.s) {
      if (v > 1.2) return { ok: false, why: 'dekat' };
      sA = veh.s;
      if (sB - sA < 9) return { ok: false, why: 'dekat' };
    }
    const sC = ob.s1 + 1.2 + len / 2;
    const Lin = clamp(8 + 1.6 * Math.max(v, 4), 12, 24);
    const sD = sC + Lin;
    if (sD + len / 2 > A.stopLen - 1.5) return { ok: false, why: 'ujung' };
    const O = this.O;
    A.poly.at(Math.max(0, sA - len / 2), O);
    const s1 = this.proj(side.lane, O.x, O.z);
    A.poly.at(Math.min(A.len, sD + len / 2), O);
    const s2 = this.proj(side.lane, O.x, O.z);
    const lo = Math.max(0, Math.min(s1, s2) - 3);
    const hi = Math.min(side.lane.len, Math.max(s1, s2) + 3);
    // kelengkungan terbesar profil (untuk batas kecepatan selama manuver)
    const kMax = (5.78 * Math.abs(side.off)) / Math.pow(Math.min(sB - sA, sD - sC), 2);
    return { ok: true, veh, ob, lane: A, other: side.lane, kind: side.kind, off: side.off, latBase, sA, sB, sC, sD, lo, hi, kMax, vMax: Math.sqrt(2.0 / Math.max(kMax, 1e-3)), ghost: null };
  }

  latAt(p, s) {
    if (s <= p.sA || s >= p.sD) return p.latBase;
    if (s < p.sB) return p.latBase + p.off * smoothStep01((s - p.sA) / (p.sB - p.sA));
    if (s <= p.sC) return p.latBase + p.off;
    return p.latBase + p.off * (1 - smoothStep01((s - p.sC) / (p.sD - p.sC)));
  }

  dlatAt(p, s) {
    if (s <= p.sA || s >= p.sD) return 0;
    if (s < p.sB) return (p.off * smoothStep01d((s - p.sA) / (p.sB - p.sA))) / (p.sB - p.sA);
    if (s <= p.sC) return 0;
    return (-p.off * smoothStep01d((s - p.sC) / (p.sD - p.sC))) / (p.sD - p.sC);
  }

  /** Apakah lajur lain cukup kosong untuk seluruh manuver sekarang? Mengembalikan '' atau alasan. */
  clearWhy(p) {
    const veh = p.veh;
    const other = p.other;
    // manuver lain yang memakai lajur yang sama
    for (const q of this.active) {
      if (q === p) continue;
      if (q.other === other || q.lane === other || q.other === p.lane) return 'manuver-lain';
    }
    const T = (p.sD - veh.s) / Math.max(veh.v, 3.2) + 2;
    for (let i = 0; i < other.occN; i++) {
      const o = other.occ[i];
      const W = o.veh;
      if (W === veh || W.ghost) continue;
      const front = o.s + W.len / 2;
      const rear = o.s - W.len / 2;
      if (p.kind === 'lawan') {
        if (rear < p.hi && front > p.lo) return 'lawan-dekat';
        if (front <= p.lo && (p.lo - front) / Math.max(W.v, 5) < T + 2) return 'lawan-dekat';
      } else {
        const sv = this.proj(other, veh.x, veh.z);
        if (front > sv - 26 && rear < p.hi + 10) return 'lajur-sebelah';
      }
    }
    if (p.kind === 'lawan') {
      // kendaraan di link sebelum lajur lawan (masih jauh tetapi datang)
      const stack = STACK;
      stack.length = 0;
      for (const pl of other.prev) stack.push(pl, p.lo);
      let guard = 0;
      while (stack.length && guard++ < 200) {
        const acc = stack.pop();
        const l = stack.pop();
        for (let i = 0; i < l.occN; i++) {
          const o = l.occ[i];
          const W = o.veh;
          if (W === veh || W.ghost) continue;
          const d = l.len - (o.s + W.len / 2) + acc;
          if (d / Math.max(W.v, 5) < T + 2) return 'lawan-dekat';
        }
        const acc2 = acc + l.len;
        if (acc2 < 160) for (const pl of l.prev) stack.push(pl, acc2);
      }
    }
    return '';
  }

  activate(p) {
    this.active.push(p);
    // pejalan kaki di sekitar lajur ini didaftarkan lebih lebar selama manuver (lihat pedestrians.js)
    p.lane.regExtra = Math.abs(p.off) + 0.6;
    if (p.kind === 'lawan') {
      p.ghost = { id: 800000 + ++this.ghostN, type: 'pesan', len: p.hi - p.lo, hw: 1.3, wid: 2.6, v: 0, dyn: DYN.car, static: true, ghost: true, plan: p, grants: [] };
    }
    p.veh.pass = p;
  }

  finish(p) {
    const i = this.active.indexOf(p);
    if (i >= 0) this.active.splice(i, 1);
    if (p.veh.pass === p) p.veh.pass = null;
    if (!this.active.some((q) => q.lane === p.lane)) p.lane.regExtra = 0;
  }

  /** Buang rencana kendaraan yang sudah selesai atau hilang. Dipanggil tiap langkah. */
  prune() {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      const veh = p.veh;
      if (!veh.alive || veh.link !== p.lane || veh.s >= p.sD || veh.manual) this.finish(p);
    }
  }

  /** Daftarkan pesanan lajur lawan dan kendaraan yang sedang di lajur sebelah ke data okupansi. */
  register(traffic) {
    for (const p of this.active) {
      if (p.kind === 'lawan' && p.ghost) traffic.occAdd(p.other, p.ghost, (p.lo + p.hi) / 2);
      else if (p.kind === 'sejajar') {
        const veh = p.veh;
        if (Math.abs(this.latAt(p, veh.s) - p.latBase) > 0.35 * Math.abs(p.off)) traffic.occAdd(p.other, veh, this.proj(p.other, veh.x, veh.z));
      }
    }
  }

  /**
   * Pemimpin (kendaraan di depan) tambahan selama manuver: di lajur sebelah (searah) atau kendaraan
   * yang ada di bagian lajur lawan yang dipesan. Mengembalikan { gap, v } di koordinat lajur semula
   * (gap = jarak bumper depan ke bumper belakang pemimpin) atau null.
   */
  leaderOn(p, veh, out) {
    const other = p.other;
    const sv = this.proj(other, veh.x, veh.z);
    let best = Infinity;
    let bv = 0;
    for (let i = 0; i < other.occN; i++) {
      const o = other.occ[i];
      const W = o.veh;
      if (W === veh || W.ghost) continue;
      if (p.kind === 'sejajar') {
        const gap = o.s - W.len / 2 - (sv + veh.len / 2);
        if (gap > -0.5 && gap < best) {
          best = Math.max(0, gap);
          bv = W.v;
        }
      } else if (o.s + W.len / 2 > p.lo && o.s - W.len / 2 < p.hi) {
        // kendaraan dari depan di bagian yang dipesan (seharusnya tidak terjadi): anggap diam di depannya
        const gap = sv - (o.s + W.len / 2) - veh.len / 2;
        if (gap > -2 && gap < best) {
          best = Math.max(0, gap);
          bv = 0;
        }
      }
    }
    if (best === Infinity) return null;
    out.gap = best;
    out.v = bv;
    return out;
  }
}

const STACK = [];
