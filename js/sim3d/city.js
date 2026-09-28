// Jaringan kota dari data OpenStreetMap (js/sim3d/data/machung-city.json, dibuat oleh
// tools/osm_to_city.py, format di docs/MAPDATA.md).
// Di sini data diubah menjadi "link" yang bisa dilalui kendaraan: lajur jalan dan konektor di
// dalam persimpangan. Tiap link punya polyline (Poly), batas kecepatan, daftar link berikutnya,
// konflik dengan konektor lain, zebra cross yang dilewatinya, dan garis henti lampu.
// Juga: jaringan trotoar, grid spasial, raster permukaan jalan, dan pencarian rute A*.
import { Poly } from './geom.js';

/** Percepatan samping nyaman di tikungan (m/s²), dipakai untuk batas kecepatan tikungan. */
export const A_LAT = 2.0;
/** Jarak ambang dua konektor dianggap berkonflik (m): dua setengah lebar kendaraan terlebar + sela. */
const CONFLICT_GAP = 2.6;
/** Jarak ambang zona lajur (m): setengah lebar shuttle 1,05 dua kali + sela. */
const LANE_ZONE_GAP = 2.3;
/** Batas atas sapuan bodi (m), hanya pengaman terhadap lonjakan kelengkungan di data. */
const SWEEP_MAX = 2.5;

export async function loadCityData() {
  const url = new URL('./data/machung-city.json', import.meta.url).href;
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(attempt ? `${url}?ulang=${attempt}` : url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('peta tidak bisa dimuat');
}

function bezierPts(b) {
  const [p0, p1, p2, p3] = b;
  const approx = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) + Math.hypot(p3[0] - p2[0], p3[1] - p2[1]);
  const n = Math.max(6, Math.min(60, Math.ceil(approx / 0.75)));
  const out = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const u = 1 - t;
    const a = u * u * u;
    const bb = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    out.push([a * p0[0] + bb * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + bb * p1[1] + c * p2[1] + d * p3[1]]);
  }
  return out;
}

function dedupe(pts) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    const q = out[out.length - 1];
    if (Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.02) out.push(p);
  }
  if (out.length < 2) out.push([pts[pts.length - 1][0] + 0.01, pts[pts.length - 1][1]]);
  return out;
}

/** Satu link yang bisa dilalui kendaraan: lajur ('lane') atau konektor persimpangan ('conn'). */
/** Sapuan bodi ke luar tikungan di posisi s pada link (m). */
export function sweepAt(link, s) {
  const a = link.sweepArr;
  if (!a) return 0;
  const i = Math.round(s / link.sweepStep);
  return a[i < 0 ? 0 : i >= a.length ? a.length - 1 : i];
}

export class Link {
  constructor(id, kind, pts) {
    this.id = id;
    this.kind = kind;
    this.poly = new Poly(dedupe(pts));
    this.len = this.poly.len;
    this.next = [];
    this.prev = [];
    this.vmax = 8;
    this.width = 3;
    this.xings = []; // { x: zebra cross, s0, s1 }
    this.sig = null; // { ctl, arm } untuk lajur yang berakhir di garis henti lampu
    this.spdS = []; // titik batas kecepatan tikungan
    this.spdV = [];
    // diisi ulang tiap langkah
    this.occ = []; // kendaraan di link ini ({ veh, s })
    this.occN = 0;
    this.peds = []; // pejalan kaki di dekat link ini ({ ped, s, lat, pred })
    this.pedN = 0;
    this.sweep = 0; // sapuan bodi terbesar di link ini (m), lihat City.sweeps
    this.sweepArr = null; // sapuan bodi per meter
    this.sweepStep = 1;
    this.closed = false;
    this.zones = null; // zona lajur (lihat City.computeLaneZones)
    this.stopLen = 0; // panjang lajur sebelum zona di ujungnya (tempat kendaraan boleh menunggu)
    this.laneZones = null;
  }
}

export class City {
  constructor(data) {
    this.data = data;
    this.meta = data.meta;
    this.bounds = data.meta.bounds;
    this.links = [];
    this.lanes = [];
    this.conns = [];
    this.roads = data.roads;
    this.roadById = new Map(data.roads.map((r) => [r.id, r]));
    this.build();
  }

  build() {
    const d = this.data;
    // lajur
    for (const L of d.lanes) {
      const link = new Link(this.links.length, 'lane', L.p);
      link.src = L;
      link.laneId = L.id;
      link.roadId = L.e;
      link.dir = L.d;
      link.index = L.i;
      link.width = L.w;
      link.vmax = L.v / 3.6;
      link.ring = L.rb === undefined ? null : L.rb;
      link.portal = L.portal || null;
      link.core = !!L.core;
      link.private = !!L.priv;
      link.name = L.name || null;
      link.j0 = L.j0;
      link.j1 = L.j1;
      const road = this.roadById.get(L.e);
      link.cls = road ? road.cls : 'ring';
      this.links.push(link);
      this.lanes.push(link);
    }
    // konektor
    this.junctions = d.junctions.map((j) => ({ ...j, conns: [], signal: null, hasPriority: false }));
    for (const C of d.connectors) {
      const pts = C.b ? bezierPts(C.b) : C.p;
      const link = new Link(this.links.length, 'conn', pts);
      link.src = C;
      link.connId = C.id;
      link.from = this.lanes[C.f];
      link.to = this.lanes[C.t];
      link.move = C.m;
      link.rank = C.r;
      link.junction = this.junctions[C.j];
      link.ringc = !!C.ringc;
      link.entry = !!C.entry;
      link.exit = !!C.exit;
      link.core = !!C.core;
      link.width = Math.max(link.from.width, link.to.width);
      link.name = link.to.name;
      link.cls = link.to.cls;
      link.conflicts = [];
      link.holders = [];
      link.approach = [];
      link.vmax = Math.min(link.from.vmax, link.to.vmax);
      this.links.push(link);
      this.conns.push(link);
      link.from.next.push(link);
      link.next.push(link.to);
      link.to.prev.push(link);
      link.prev.push(link.from);
      link.junction.conns.push(link);
      if (link.rank > 0) link.junction.hasPriority = true;
    }
    for (const link of this.links) this.curveSpeeds(link);
    for (const j of this.junctions) this.computeConflicts(j);
    for (const j of this.junctions) this.computeLaneZones(j);
    this.zoneConflicts();
    this.buildCrossings();
    this.buildSignalsRefs();
    this.buildHalte();
    this.buildWalks();
    this.buildGrid();
    this.buildRaster();
    // kendaraan dari luar peta hanya masuk lewat lajur tepi yang cukup panjang untuk berhenti sebelum
    // persimpangan pertamanya (ada lajur tepi yang hanya 1 m karena persimpangan tepat di batas potongan)
    this.portalIn = this.lanes.filter((l) => l.portal === 'in' && l.len >= 14);
    // dua jalan berbeda yang bertemu tepat di batas potongan: ujung lajur keluar dan awal lajur masuk
    // hampir berimpit. Lajur masuk seperti itu tidak dipakai untuk memunculkan kendaraan.
    const clash = new Set();
    for (const a of this.lanes) {
      if (a.portal !== 'in') continue;
      const ax = a.poly.x[0];
      const az = a.poly.z[0];
      for (const b of this.lanes) {
        if (b.portal !== 'out' || b.roadId === a.roadId) continue;
        const bx = b.poly.x[b.poly.n - 1];
        const bz = b.poly.z[b.poly.n - 1];
        if (Math.hypot(ax - bx, az - bz) < 8) clash.add(a);
      }
    }
    this.portalIn = this.portalIn.filter((l) => !clash.has(l));
    this.portalClash = clash;
    this.portalOut = this.lanes.filter((l) => l.portal === 'out');
    this.spawnLanes = this.lanes.filter((l) => l.ring === null && l.len > 30 && !clash.has(l));
  }

  /** Batas kecepatan tikungan: v = akar(a_lat x R) di titik yang kelengkungannya besar. */
  curveSpeeds(link) {
    const P = link.poly;
    if (P.n < 3) return;
    const step = 1.5;
    let lastV = Infinity;
    for (let s = step; s < link.len - step * 0.5; s += step) {
      const a = P.at(Math.max(0, s - step), {});
      const b = P.at(Math.min(link.len, s + step), {});
      let dh = b.h - a.h;
      if (dh > Math.PI) dh -= Math.PI * 2;
      if (dh < -Math.PI) dh += Math.PI * 2;
      const k = Math.abs(dh) / (2 * step);
      if (k < 1e-4) continue;
      const v = Math.sqrt(A_LAT / k);
      if (v < link.vmax && Math.abs(v - lastV) > 0.05) {
        link.spdS.push(s);
        link.spdV.push(v);
        lastV = v;
      }
    }
    this.sweeps(link);
    // konektor: batas kecepatan keseluruhan = tikungan tertajam
    if (link.kind === 'conn' && link.spdV.length) {
      let m = link.vmax;
      for (const v of link.spdV) m = Math.min(m, v);
      link.vmax = Math.max(2.2, m);
    }
  }

  /**
   * Sapuan bodi ke luar tikungan per titik (sampel tiap 1 m): (L/2)^2 / (2R) untuk kendaraan
   * terpanjang (shuttle, L/2 = 3 m), R = jari-jari tertajam dalam jarak 3 m dari titik itu, dibatasi
   * 2,5 m. Rumus yang sama dipakai tools/osm_to_city.py untuk menjauhkan trotoar dari jalur belok.
   */
  sweeps(link) {
    const P = link.poly;
    const n = Math.max(2, Math.ceil(link.len) + 1);
    const k = new Float32Array(n);
    const a = {};
    const b = {};
    for (let i = 0; i < n; i++) {
      const s = (i / (n - 1)) * link.len;
      P.at(Math.max(0, s - 1.5), a);
      P.at(Math.min(link.len, s + 1.5), b);
      let dh = b.h - a.h;
      if (dh > Math.PI) dh -= Math.PI * 2;
      if (dh < -Math.PI) dh += Math.PI * 2;
      const ds = Math.min(link.len, s + 1.5) - Math.max(0, s - 1.5);
      k[i] = ds > 0.2 ? Math.abs(dh) / ds : 0;
    }
    const sw = new Float32Array(n);
    const step = link.len / (n - 1);
    const W = Math.max(1, Math.round(3 / Math.max(step, 0.05)));
    let mx = 0;
    for (let i = 0; i < n; i++) {
      let km = 0;
      for (let j = Math.max(0, i - W); j <= Math.min(n - 1, i + W); j++) if (k[j] > km) km = k[j];
      sw[i] = Math.min(SWEEP_MAX, (9 * km) / 2);
      if (sw[i] > mx) mx = sw[i];
    }
    link.sweepArr = mx > 0.01 ? sw : null;
    link.sweepStep = step;
    link.sweep = mx;
  }

  /**
   * Konflik antarkonektor dalam satu persimpangan (bersilangan, bergabung ke lajur yang sama, atau
   * saling mendekat kurang dari CONFLICT_GAP). Jalur tiap konektor diperpanjang 8 m ke lajur asal dan
   * lajur tujuan supaya kendaraan yang baru masuk atau baru keluar juga dihitung. Rentang konflik
   * tetap dicatat di dalam konektor (0 sampai panjangnya).
   */
  computeConflicts(j) {
    const cs = j.conns;
    const EXT = 8;
    const samp = cs.map((c) => {
      const pts = [];
      const o = {};
      const fromL = c.from;
      const toL = c.to;
      for (let t = EXT; t > 0.01; t -= 0.5) {
        if (fromL.len - t < 0) continue;
        fromL.poly.at(fromL.len - t, o);
        pts.push([o.x, o.z, -t]);
      }
      const n = Math.max(2, Math.ceil(c.len / 0.5));
      for (let k = 0; k <= n; k++) {
        const s = (c.len * k) / n;
        c.poly.at(s, o);
        pts.push([o.x, o.z, s]);
      }
      for (let t = 0.5; t <= EXT && t <= toL.len; t += 0.5) {
        toL.poly.at(t, o);
        pts.push([o.x, o.z, c.len + t]);
      }
      let x0 = Infinity;
      let z0 = Infinity;
      let x1 = -Infinity;
      let z1 = -Infinity;
      for (const p of pts) {
        if (p[0] < x0) x0 = p[0];
        if (p[0] > x1) x1 = p[0];
        if (p[1] < z0) z0 = p[1];
        if (p[1] > z1) z1 = p[1];
      }
      pts.bb = [x0, z0, x1, z1];
      return pts;
    });
    for (let a = 0; a < cs.length; a++) {
      for (let b = a + 1; b < cs.length; b++) {
        const A = cs[a];
        const B = cs[b];
        if (A.from === B.from) {
          // berpisah dari lajur yang sama: saling mengikuti sampai jalurnya cukup berjauhan
          this.siblingSeparation(A, B, samp[a], samp[b]);
          continue;
        }
        const ba = samp[a].bb;
        const bb = samp[b].bb;
        const g = CONFLICT_GAP;
        if (ba[0] > bb[2] + g || bb[0] > ba[2] + g || ba[1] > bb[3] + g || bb[1] > ba[3] + g) continue;
        let a0 = Infinity;
        let a1 = -Infinity;
        let b0 = Infinity;
        let b1 = -Infinity;
        const g2 = g * g;
        for (const p of samp[a]) {
          for (const q of samp[b]) {
            const dx = p[0] - q[0];
            const dz = p[1] - q[1];
            if (dx * dx + dz * dz < g2) {
              if (p[2] < a0) a0 = p[2];
              if (p[2] > a1) a1 = p[2];
              if (q[2] < b0) b0 = q[2];
              if (q[2] > b1) b1 = q[2];
            }
          }
        }
        const merge = A.to === B.to;
        if (!merge && a0 === Infinity) continue;
        if (merge) {
          if (a0 === Infinity) {
            a0 = A.len - 1;
            b0 = B.len - 1;
          }
          a1 = A.len;
          b1 = B.len;
        }
        const cl = (v, L) => Math.max(0, Math.min(L, v));
        A.conflicts.push({ o: B, my: [cl(a0 - 0.5, A.len), cl(a1 + 0.5, A.len)], ot: [cl(b0 - 0.5, B.len), cl(b1 + 0.5, B.len)], merge });
        B.conflicts.push({ o: A, my: [cl(b0 - 0.5, B.len), cl(b1 + 0.5, B.len)], ot: [cl(a0 - 0.5, A.len), cl(a1 + 0.5, A.len)], merge });
      }
    }
  }

  /**
   * Dua konektor dari lajur yang sama berawal di titik yang sama lalu berpisah. Catat sampai sejauh
   * mana (di sepanjang konektor saudara) kendaraan di sana masih harus dianggap kendaraan di depan:
   * A.sibSep.get(B) = jarak di B sampai jalur B berjarak lebih dari CONFLICT_GAP dari jalur A.
   * Bila keduanya mendekat lagi setelah berpisah, bagian itu dicatat sebagai konflik biasa.
   */
  siblingSeparation(A, B, sa, sb) {
    const g2 = CONFLICT_GAP * CONFLICT_GAP;
    const near = (p, list) => {
      for (const q of list) {
        const dx = p[0] - q[0];
        const dz = p[1] - q[1];
        if (dx * dx + dz * dz < g2) return true;
      }
      return false;
    };
    const ca = sa.filter((p) => p[2] >= 0 && p[2] <= A.len);
    const cb = sb.filter((p) => p[2] >= 0 && p[2] <= B.len);
    let sepA = 0;
    for (const p of ca) {
      if (near(p, cb)) sepA = p[2];
      else break;
    }
    let sepB = 0;
    for (const q of cb) {
      if (near(q, ca)) sepB = q[2];
      else break;
    }
    if (!A.sibSep) A.sibSep = new Map();
    if (!B.sibSep) B.sibSep = new Map();
    A.sibSep.set(B, sepB + 0.5);
    B.sibSep.set(A, sepA + 0.5);
    // mendekat lagi setelah berpisah
    let a0 = Infinity;
    let a1 = -Infinity;
    let b0 = Infinity;
    let b1 = -Infinity;
    for (const p of ca) {
      if (p[2] <= sepA + 1) continue;
      for (const q of cb) {
        if (q[2] <= sepB + 1) continue;
        const dx = p[0] - q[0];
        const dz = p[1] - q[1];
        if (dx * dx + dz * dz < g2) {
          if (p[2] < a0) a0 = p[2];
          if (p[2] > a1) a1 = p[2];
          if (q[2] < b0) b0 = q[2];
          if (q[2] > b1) b1 = q[2];
        }
      }
    }
    if (a0 !== Infinity) {
      const cl = (v, L) => Math.max(0, Math.min(L, v));
      A.conflicts.push({ o: B, my: [cl(a0 - 0.5, A.len), cl(a1 + 0.5, A.len)], ot: [cl(b0 - 0.5, B.len), cl(b1 + 0.5, B.len)], merge: false, sib: true });
      B.conflicts.push({ o: A, my: [cl(b0 - 0.5, B.len), cl(b1 + 0.5, B.len)], ot: [cl(a0 - 0.5, A.len), cl(a1 + 0.5, A.len)], merge: false, sib: true });
    }
  }

  /**
   * Zona lajur: ujung lajur yang masuk ke persimpangan (atau awal lajur yang keluar) yang dilewati
   * sangat dekat oleh konektor lain di persimpangan itu, misalnya di persimpangan dua jalan yang
   * hampir sejajar. Kendaraan yang menunggu di ujung lajur itu akan tersenggol kendaraan yang lewat
   * di konektor. Aturannya: konektor tidak diizinkan selama ada badan kendaraan di zona (atau
   * kendaraan yang tidak bisa lagi berhenti sebelum zona), dan kendaraan di lajur itu berhenti
   * sebelum zona selama konektor sedang dipakai.
   */
  computeLaneZones(j) {
    const G = LANE_ZONE_GAP;
    const REACH = 10;
    const lanes = this.lanes.filter((L) => L.j0 === j.id || L.j1 === j.id);
    const o = {};
    for (const c of j.conns) {
      const cp = [];
      const n = Math.max(2, Math.ceil(c.len / 0.5));
      for (let k = 0; k <= n; k++) {
        const s = (c.len * k) / n;
        c.poly.at(s, o);
        cp.push([o.x, o.z, s]);
      }
      for (const L of lanes) {
        if (L === c.from || L === c.to) continue;
        for (const kind of ['in', 'out']) {
          if (kind === 'in' && L.j1 !== j.id) continue;
          if (kind === 'out' && L.j0 !== j.id) continue;
          let lo = Infinity;
          let hi = -Infinity;
          let chi = -Infinity;
          const t0 = kind === 'in' ? Math.max(0, L.len - REACH) : 0;
          const t1 = kind === 'in' ? L.len : Math.min(L.len, REACH);
          for (let t = t0; t <= t1 + 1e-6; t += 0.5) {
            L.poly.at(t, o);
            for (const q of cp) {
              const dx = o.x - q[0];
              const dz = o.z - q[1];
              const g = G + sweepAt(c, q[2]);
              if (dx * dx + dz * dz < g * g) {
                if (t < lo) lo = t;
                if (t > hi) hi = t;
                if (q[2] > chi) chi = q[2];
              }
            }
          }
          if (lo === Infinity) continue;
          const z = { c, lane: L, kind, s0: Math.max(0, lo - 0.5), s1: Math.min(L.len, hi + 0.5), cs1: Math.min(c.len, chi + 0.5) };
          (L.zones || (L.zones = [])).push(z);
          (c.laneZones || (c.laneZones = [])).push(z);
          this.laneZoneCount = (this.laneZoneCount || 0) + 1;
        }
      }
    }
  }

  /**
   * Zona lajur sebagai konflik biasa: konektor yang keluar dari ujung lajur itu (kendaraan harus
   * melewati zona untuk masuk ke sana) dan konektor yang masuk ke awal lajur itu berkonflik dengan
   * konektor yang lewat dekat zona. Jadi keduanya tidak pernah diizinkan bersamaan.
   */
  zoneConflicts() {
    // panjang lajur yang bisa dipakai untuk berhenti menunggu (sebelum zona di ujungnya)
    for (const L of this.lanes) {
      L.stopLen = L.len;
      if (L.zones) for (const z of L.zones) if (z.kind === 'in') L.stopLen = Math.min(L.stopLen, z.s0);
    }
    const add = (A, B, my, ot) => {
      if (A === B || A.from === B.from) return;
      const k = A.conflicts.find((q) => q.o === B);
      if (k) {
        k.my[0] = Math.min(k.my[0], my[0]);
        k.my[1] = Math.max(k.my[1], my[1]);
        k.ot[0] = Math.min(k.ot[0], ot[0]);
        k.ot[1] = Math.max(k.ot[1], ot[1]);
      } else A.conflicts.push({ o: B, my: [my[0], my[1]], ot: [ot[0], ot[1]], merge: false, zone: true });
    };
    for (const L of this.lanes) {
      if (!L.zones) continue;
      for (const z of L.zones) {
        const c = z.c;
        const cr = [0, z.cs1];
        const others = z.kind === 'in' ? L.next : L.prev;
        for (const a of others) {
          const ar = z.kind === 'in' ? [0, Math.min(a.len, 0.5)] : [0, a.len];
          add(a, c, ar, cr);
          add(c, a, cr, ar);
        }
      }
    }
  }

  /** Bagian tiap link yang melintasi zebra cross (interval s0 sampai s1). */
  buildCrossings() {
    this.crossings = this.data.crossings.map((X) => ({
      ...X,
      links: [],
      reserved: new Set(),
      signal: null,
      ux: Math.cos(X.h),
      uz: Math.sin(X.h),
    }));
    for (const X of this.crossings) this.linkCrossing(X);
  }

  /** Hubungkan zebra cross X (tetap atau sementara) ke setiap link yang melintasinya. */
  linkCrossing(X) {
    const hl = X.len / 2 + 0.6;
    const hw = X.w / 2;
    for (const link of this.links) {
      const bb = link.poly.bb;
      const R = hl + hw + 1;
      if (X.x < bb[0] - R || X.x > bb[2] + R || X.z < bb[1] - R || X.z > bb[3] + R) continue;
      const P = link.poly;
      let s0 = Infinity;
      let s1 = -Infinity;
      // tiap ruas polyline dipotong dengan persegi zebra cross (di koordinat lokal zebra cross)
      for (let i = 0; i < P.n - 1; i++) {
        const ax = P.x[i] - X.x;
        const az = P.z[i] - X.z;
        const bx = P.x[i + 1] - X.x;
        const bz = P.z[i + 1] - X.z;
        // u searah jalan, v melintang
        const au = ax * X.ux + az * X.uz;
        const av = -ax * X.uz + az * X.ux;
        const bu = bx * X.ux + bz * X.uz;
        const bv = -bx * X.uz + bz * X.ux;
        let t0 = 0;
        let t1 = 1;
        const du = bu - au;
        const dv = bv - av;
        const clip = (p, q) => {
          if (Math.abs(p) < 1e-12) return q >= 0;
          const r = q / p;
          if (p < 0) {
            if (r > t1) return false;
            if (r > t0) t0 = r;
          } else {
            if (r < t0) return false;
            if (r < t1) t1 = r;
          }
          return true;
        };
        if (!clip(-du, au + hw) || !clip(du, hw - au) || !clip(-dv, av + hl) || !clip(dv, hl - av)) continue;
        if (t1 < t0) continue;
        const segL = P.cum[i + 1] - P.cum[i];
        s0 = Math.min(s0, P.cum[i] + t0 * segL);
        s1 = Math.max(s1, P.cum[i] + t1 * segL);
      }
      if (s0 < s1) {
        const e = { x: X, s0, s1, link };
        link.xings.push(e);
        link.xings.sort((a, b) => a.s0 - b.s0);
        X.links.push(e);
      }
    }
  }

  buildSignalsRefs() {
    this.signalsData = this.data.signals;
    for (const s of this.data.signals) {
      this.junctions[s.j].signalId = s.id;
    }
  }

  buildHalte() {
    this.halte = this.data.halte.map((h, i) => {
      const link = this.lanes[h.lane];
      return { ...h, index: i, link, sStop: h.s, waiting: [] };
    });
  }

  /** Jaringan trotoar untuk pejalan kaki. */
  buildWalks() {
    const W = this.data.walks;
    this.wnodes = W.nodes.map((p, i) => ({ id: i, x: p[0], z: p[1], edges: [] }));
    this.wedges = W.edges.map((e, i) => {
      const poly = new Poly(dedupe(e.p));
      const edge = { id: i, a: e.a, b: e.b, kind: e.k, poly, len: poly.len, xing: e.x !== undefined ? this.crossings[e.x] : null };
      return edge;
    });
    for (const e of this.wedges) {
      // pastikan arah polyline dari a ke b
      const A = this.wnodes[e.a];
      const p0x = e.poly.x[0];
      const p0z = e.poly.z[0];
      const pnx = e.poly.x[e.poly.n - 1];
      const pnz = e.poly.z[e.poly.n - 1];
      const dA0 = Math.hypot(p0x - A.x, p0z - A.z);
      const dAn = Math.hypot(pnx - A.x, pnz - A.z);
      if (dAn < dA0) {
        const pts = [];
        for (let i = e.poly.n - 1; i >= 0; i--) pts.push([e.poly.x[i], e.poly.z[i]]);
        e.poly = new Poly(pts);
      }
      this.wnodes[e.a].edges.push(e);
      this.wnodes[e.b].edges.push(e);
      if (e.xing) e.xing.walk = e;
    }
    this.walkEdges = this.wedges.filter((e) => e.kind === 'w' && e.len > 3);
    // komponen trotoar yang tersambung; komponen dengan zebra cross yang bisa dipakai ditandai
    const parent = this.wnodes.map((n) => n.id);
    const find = (a) => {
      while (parent[a] !== a) a = parent[a] = parent[parent[a]];
      return a;
    };
    for (const e of this.wedges) parent[find(e.a)] = find(e.b);
    const withX = new Set();
    for (const e of this.wedges) {
      e.comp = find(e.a);
      // zebra cross yang ujungnya buntu (misalnya berakhir di jalur hijau di antara dua jalan) tidak dipakai
      e.usable = e.kind !== 'x' || (this.wnodes[e.a].edges.length > 1 && this.wnodes[e.b].edges.length > 1);
      if (e.kind === 'x' && e.usable) withX.add(e.comp);
    }
    for (const e of this.wedges) e.nearX = withX.has(e.comp);
  }

  /** Grid spasial link (sel 16 m) untuk mencari link di dekat suatu titik. */
  buildGrid() {
    const C = 16;
    this.gridC = C;
    this.grid = new Map();
    const key = (i, j) => i * 100000 + j;
    for (const link of this.links) {
      const bb = link.poly.bb;
      const pad = 4;
      const i0 = Math.floor((bb[0] - pad) / C);
      const i1 = Math.floor((bb[2] + pad) / C);
      const j0 = Math.floor((bb[1] - pad) / C);
      const j1 = Math.floor((bb[3] + pad) / C);
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const k = key(i, j);
          let arr = this.grid.get(k);
          if (!arr) this.grid.set(k, (arr = []));
          arr.push(link);
        }
      }
    }
    this.gridKey = key;
  }

  linksNear(x, z) {
    const C = this.gridC;
    return this.grid.get(this.gridKey(Math.floor(x / C), Math.floor(z / C))) || EMPTY;
  }

  /** Link terdekat dari titik (x, z): { link, s, lat, d }. */
  nearestLink(x, z, filter) {
    const pr = {};
    let best = null;
    const C = this.gridC;
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const arr = this.grid.get(this.gridKey(Math.floor(x / C) + di, Math.floor(z / C) + dj));
        if (!arr) continue;
        for (const link of arr) {
          if (filter && !filter(link)) continue;
          link.poly.project(x, z, pr);
          const d = Math.sqrt(pr.d2);
          if (!best || d < best.d) best = { link, s: Math.max(0, Math.min(link.len, pr.s)), lat: pr.lat, d };
        }
      }
    }
    return best;
  }

  // ===== raster permukaan jalan (untuk memeriksa kendaraan tetap di jalan) =====

  buildRaster() {
    const b = this.bounds;
    const res = 0.5;
    const w = Math.ceil((b.maxX - b.minX) / res) + 1;
    const h = Math.ceil((b.maxZ - b.minZ) / res) + 1;
    this.raster = { res, w, h, x0: b.minX, z0: b.minZ, data: new Uint8Array(w * h) };
    const fillQuad = (pts) => this.fillPoly(pts);
    for (const r of this.roads) {
      const pts = r.p;
      const half = r.half + 0.05;
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i];
        const [bx, bz] = pts[i + 1];
        const L = Math.hypot(bx - ax, bz - az) || 1;
        const nx = (bz - az) / L;
        const nz = -(bx - ax) / L;
        // sedikit diperpanjang supaya sambungan antarsegmen tidak berlubang
        const ex = ((bx - ax) / L) * 0.3;
        const ez = ((bz - az) / L) * 0.3;
        fillQuad([
          [ax - ex + nx * half, az - ez + nz * half],
          [bx + ex + nx * half, bz + ez + nz * half],
          [bx + ex - nx * half, bz + ez - nz * half],
          [ax - ex - nx * half, az - ez - nz * half],
        ]);
      }
    }
    for (const j of this.data.junctions) if (j.poly.length >= 3) this.fillPoly(j.poly);
    // lajur di tepi peta: kendaraan muncul dan menghilang sedikit di luar ujung lajur
    for (const link of this.lanes) {
      if (!link.portal) continue;
      const P = link.poly;
      const out = link.portal === 'out';
      const i0 = out ? P.n - 1 : 0;
      const h = out ? P.h[P.n - 2] : P.h[0] + Math.PI;
      const ex = Math.cos(h);
      const ez = Math.sin(h);
      const nx = -ez * 1.6;
      const nz = ex * 1.6;
      const x0 = P.x[i0];
      const z0 = P.z[i0];
      const x1 = x0 + ex * 10;
      const z1 = z0 + ez * 10;
      fillQuad([
        [x0 + nx, z0 + nz],
        [x1 + nx, z1 + nz],
        [x1 - nx, z1 - nz],
        [x0 - nx, z0 - nz],
      ]);
    }
    // salinan raster tanpa jejak sapuan: dipakai tampilan untuk menggambar aspal tambahan hanya
    // di tempat yang belum tertutup aspal jalan atau persimpangan
    this.rasterBase = this.raster.data.slice();
    // jejak sapuan kendaraan di tikungan tajam dan putar balik (gabungan lingkaran, tidak bisa terlipat)
    for (const link of this.links) {
      const sp = this.sweptPath(link);
      if (!sp) continue;
      for (let i = 0; i < sp.x.length; i++) this.fillDisc(sp.x[i], sp.z[i], Math.max(sp.left[i], sp.right[i]));
    }
    for (const rb of this.data.roundabouts) {
      const ro = rb.r + rb.w / 2 + 0.05;
      const ri = rb.r - rb.w / 2 - 0.05;
      const n = 48;
      for (let k = 0; k < n; k++) {
        const a0 = (k / n) * Math.PI * 2;
        const a1 = ((k + 1.05) / n) * Math.PI * 2;
        fillQuad([
          [rb.x + Math.cos(a0) * ri, rb.z + Math.sin(a0) * ri],
          [rb.x + Math.cos(a0) * ro, rb.z + Math.sin(a0) * ro],
          [rb.x + Math.cos(a1) * ro, rb.z + Math.sin(a1) * ro],
          [rb.x + Math.cos(a1) * ri, rb.z + Math.sin(a1) * ri],
        ]);
      }
    }
  }

  /**
   * Jejak sapuan kendaraan di sepanjang link: titik tengah dan setengah lebar ke kiri dan ke kanan.
   * Sisi luar tikungan: setengah lebar kendaraan terlebar (shuttle 1,05 m) + 0,1 m + sapuan bodi
   * setempat. Sisi dalam: 1,15 m (dibatasi jari-jari tikungan supaya tepinya tidak terlipat).
   * Paling sedikit setengah lebar lajur. Dipakai untuk aspal tambahan di tikungan tajam dan putar
   * balik (tampilan) dan raster permukaan jalan (pemeriksaan keluar jalan).
   * Mengembalikan null untuk lajur lurus (sudah tertutup aspal ruas jalan).
   */
  sweptPath(link) {
    if (link.kind === 'lane' && link.sweep < 0.02) return null;
    const P = link.poly;
    const n = Math.max(2, Math.ceil(link.len / 0.8));
    const out = { x: [], z: [], h: [], left: [], right: [] };
    const o = {};
    const a = {};
    const b = {};
    for (let i = 0; i <= n; i++) {
      const s = (link.len * i) / n;
      P.atSmooth(s, o);
      P.atSmooth(Math.max(0, s - 1.5), a);
      P.atSmooth(Math.min(link.len, s + 1.5), b);
      let turn = b.h - a.h;
      if (turn > Math.PI) turn -= Math.PI * 2;
      if (turn < -Math.PI) turn += Math.PI * 2;
      const ds = Math.min(link.len, s + 1.5) - Math.max(0, s - 1.5);
      const R = Math.abs(turn) > 1e-3 && ds > 0.2 ? ds / Math.abs(turn) : Infinity;
      const base = Math.max(link.width / 2, 1.15);
      const outer = Math.max(base, 1.15 + sweepAt(link, s));
      const inner = Math.min(base, Math.max(0.3, 0.8 * R));
      // h naik = berbelok ke kanan, jadi sisi luar = kiri
      const leftOuter = turn > 0;
      out.x.push(o.x);
      out.z.push(o.z);
      out.h.push(o.h);
      out.left.push(leftOuter ? outer : inner);
      out.right.push(leftOuter ? inner : outer);
    }
    return out;
  }

  /** Isi lingkaran di raster permukaan jalan. */
  fillDisc(x, z, r) {
    const R = this.raster;
    const i0 = Math.max(0, Math.floor((x - r - R.x0) / R.res));
    const i1 = Math.min(R.w - 1, Math.floor((x + r - R.x0) / R.res));
    const j0 = Math.max(0, Math.floor((z - r - R.z0) / R.res));
    const j1 = Math.min(R.h - 1, Math.floor((z + r - R.z0) / R.res));
    const r2 = r * r;
    for (let j = j0; j <= j1; j++) {
      const cz = R.z0 + (j + 0.5) * R.res - z;
      for (let i = i0; i <= i1; i++) {
        const cx = R.x0 + (i + 0.5) * R.res - x;
        if (cx * cx + cz * cz <= r2) R.data[j * R.w + i] = 1;
      }
    }
  }

  fillPoly(pts) {
    const R = this.raster;
    const n = pts.length;
    let zmin = Infinity;
    let zmax = -Infinity;
    for (const p of pts) {
      if (p[1] < zmin) zmin = p[1];
      if (p[1] > zmax) zmax = p[1];
    }
    const j0 = Math.max(0, Math.floor((zmin - R.z0) / R.res));
    const j1 = Math.min(R.h - 1, Math.ceil((zmax - R.z0) / R.res));
    const xs = [];
    for (let j = j0; j <= j1; j++) {
      const z = R.z0 + (j + 0.5) * R.res;
      xs.length = 0;
      for (let i = 0, k = n - 1; i < n; k = i++) {
        const [xi, zi] = pts[i];
        const [xk, zk] = pts[k];
        if (zi > z !== zk > z) xs.push(xi + ((z - zi) * (xk - xi)) / (zk - zi));
      }
      xs.sort((a, b) => a - b);
      for (let q = 0; q + 1 < xs.length; q += 2) {
        const i0 = Math.max(0, Math.floor((xs[q] - R.x0) / R.res));
        const i1 = Math.min(R.w - 1, Math.floor((xs[q + 1] - R.x0) / R.res));
        for (let i = i0; i <= i1; i++) R.data[j * R.w + i] = 1;
      }
    }
  }

  /** Apakah titik (x, z) sudah tertutup aspal jalan, persimpangan, atau bundaran (tanpa jejak sapuan)? */
  onBaseRoad(x, z) {
    const R = this.raster;
    const i = Math.floor((x - R.x0) / R.res);
    const j = Math.floor((z - R.z0) / R.res);
    if (i < 0 || j < 0 || i >= R.w || j >= R.h) return true;
    return this.rasterBase[j * R.w + i] === 1;
  }

  /** Apakah titik (x, z) berada di permukaan jalan? */
  onRoad(x, z) {
    const R = this.raster;
    const i = Math.floor((x - R.x0) / R.res);
    const j = Math.floor((z - R.z0) / R.res);
    if (i < 0 || j < 0 || i >= R.w || j >= R.h) return true; // di luar peta: dianggap jalan keluar
    return R.data[j * R.w + i] === 1;
  }

  // ===== rute A* =====

  /**
   * A* di graf link. Biaya = perkiraan waktu tempuh (detik) + penalti belok.
   * opts.core: hanya link inti (tanpa lewat tepi peta). opts.avoidPrivate: hindari jalan privat.
   * opts.noU: tanpa putar balik (shuttle 6 m tidak berputar di ujung jalan buntu).
   * opts.blocked(link): link yang tidak boleh dilewati (jalan ditutup).
   */
  route(startLink, startS, goalLink, goalS, opts = {}) {
    const N = this.links.length;
    const g = this.routeG || (this.routeG = new Float64Array(N));
    const prev = this.routeP || (this.routeP = new Int32Array(N));
    const closed = this.routeC || (this.routeC = new Uint8Array(N));
    g.fill(Infinity);
    prev.fill(-1);
    closed.fill(0);
    const gp = goalLink.poly.at(goalS, {});
    const hFn = (l) => {
      const p = l.poly;
      return Math.hypot(gp.x - p.x[p.n - 1], gp.z - p.z[p.n - 1]) / 12;
    };
    const cost = (l) => {
      let c = l.len / Math.max(3, Math.min(11, l.vmax));
      if (l.kind === 'conn') {
        if (l.move === 'L') c += 1.5;
        else if (l.move === 'R') c += 3;
        else if (l.move === 'U') c += 25;
        if (l.junction.signalId !== undefined) c += 8;
        if (l.rank === 2) c += 3;
      }
      return c;
    };
    const ok = (l) => {
      if (opts.core && !l.core) return false;
      if (opts.noU && l.kind === 'conn' && l.move === 'U') return false;
      if (opts.avoidPrivate && l.private) return false;
      if (l.closed) return false;
      if (opts.blocked && opts.blocked(l)) return false;
      return true;
    };
    const heap = [];
    const push = (f, id) => {
      heap.push([f, id]);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1;
          const r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    g[startLink.id] = (startLink.len - startS) / Math.max(3, startLink.vmax);
    push(g[startLink.id] + hFn(startLink), startLink.id);
    let found = -1;
    let expanded = 0;
    const sameStart = startLink === goalLink && startS <= goalS;
    if (sameStart) return { links: [startLink], cost: (goalS - startS) / Math.max(3, startLink.vmax), expanded: 0 };
    while (heap.length) {
      const [, id] = pop();
      if (closed[id]) continue;
      closed[id] = 1;
      expanded++;
      const link = this.links[id];
      if (link === goalLink && id !== startLink.id) {
        found = id;
        break;
      }
      for (const nb of link.next) {
        if (closed[nb.id] || !ok(nb)) continue;
        const ng = g[id] + cost(nb);
        if (ng < g[nb.id]) {
          g[nb.id] = ng;
          prev[nb.id] = id;
          push(ng + hFn(nb), nb.id);
        }
      }
    }
    if (found < 0) return null;
    const out = [];
    for (let id = found; id >= 0; id = prev[id]) {
      out.push(this.links[id]);
      if (id === startLink.id) break;
    }
    out.reverse();
    if (out[0] !== startLink) out.unshift(startLink);
    return { links: out, cost: g[found], expanded };
  }
}

const EMPTY = [];
