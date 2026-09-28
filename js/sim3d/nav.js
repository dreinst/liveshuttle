// Model navigasi rute shuttle untuk peta rute langsung: daftar manuver (arah belok, nomor jalan
// keluar bundaran, nama jalan, jarak), sisa jarak dan perkiraan waktu tiba ke halte berikutnya,
// geometri rute (bagian yang sudah dilalui dan yang belum), garis seluruh putaran halte, dan
// kejadian di jalan (jalan ditutup, galian, kendaraan parkir, pejalan kaki menyeberang).
// Diperbarui terus selama shuttle bergerak dan setelah rute berubah.
import { fmt } from './util.js';

/** Jarak untuk dibaca: "40 m", "120 m", "1,2 km". */
export function fmtDist(d) {
  if (!(d >= 0)) return '-';
  if (d < 50) return `${Math.max(5, Math.round(d / 5) * 5)} m`;
  if (d < 1000) return `${Math.round(d / 10) * 10} m`;
  return `${fmt(d / 1000, 1)} km`;
}

const TURN_TEXT = { kiri: 'Belok kiri', kanan: 'Belok kanan', lurus: 'Lurus', putar: 'Putar balik' };

function instruction(m) {
  if (m.kind === 'tiba') return `Tiba di Halte ${m.street}`;
  if (m.kind === 'bundaran') return `Di bundaran, ambil jalan keluar ke-${m.exit}${m.street ? ` ke ${m.street}` : ''}`;
  if (m.kind === 'lurus') return `Lurus ke ${m.street}`;
  return `${TURN_TEXT[m.kind]}${m.street ? ` ke ${m.street}` : ''}`;
}

export class Nav {
  constructor(app, ego) {
    this.app = app;
    this.ego = ego;
    this.version = 0;
    this.legAll = [];
    this.legCum = [];
    this.legLen = 0;
    this.legIndex = 0;
    this.maneuvers = [];
    this.route = new Float32Array(0);
    this.routeCum = new Float32Array(0);
    this.loop = new Float32Array(0);
    this.loopLegs = [];
    this.loopVersion = 0;
    this.progress = 0;
    this.remaining = 0;
    this.etaSec = 0;
    this.incidents = [];
    this.O = {};
  }

  /** Dipanggil Ego setiap kali rute ke halte berikutnya dibuat atau diperbarui. */
  setLeg(links, driven) {
    this.version++;
    this.legAll = driven.concat(links);
    const cum = [];
    let acc = 0;
    for (const l of this.legAll) {
      cum.push(acc);
      acc += l.len;
    }
    this.legCum = cum;
    this.legLen = acc;
    this.legIndex = driven.length;
    this.buildRoutePoints();
    this.buildManeuvers();
  }

  /** Shuttle masuk ke link berikutnya. */
  advance(link) {
    const L = this.legAll;
    for (let i = this.legIndex + 1; i < Math.min(L.length, this.legIndex + 4); i++) {
      if (L[i] === link) {
        this.legIndex = i;
        return;
      }
    }
  }

  buildRoutePoints() {
    const pts = [];
    const cum = [];
    let acc = 0;
    let lx = null;
    let lz = null;
    for (const l of this.legAll) {
      const P = l.poly;
      for (let i = 0; i < P.n; i++) {
        const x = P.x[i];
        const z = P.z[i];
        if (lx !== null) {
          const d = Math.hypot(x - lx, z - lz);
          if (d < 0.5) continue;
          acc += d;
        }
        pts.push(x, z);
        cum.push(acc);
        lx = x;
        lz = z;
      }
    }
    this.route = new Float32Array(pts);
    this.routeCum = new Float32Array(cum);
  }

  buildManeuvers() {
    const L = this.legAll;
    const out = [];
    for (let i = 0; i < L.length; i++) {
      const c = L[i];
      if (c.kind !== 'conn') continue;
      const at = this.legCum[i];
      if (c.entry) {
        // bundaran: hitung jalan keluar yang dilewati sampai konektor keluar kita
        let count = 0;
        let exitConn = null;
        for (let k = i + 1; k < L.length; k++) {
          const l = L[k];
          if (l.kind === 'lane') {
            const nx = L[k + 1];
            if (!nx) break;
            if (nx.exit) {
              count++;
              exitConn = nx;
              i = k + 1;
              break;
            }
            if (l.next.some((q) => q.exit)) count++;
          }
        }
        if (exitConn) {
          out.push({ kind: 'bundaran', exit: count, street: exitConn.to.name || '', at, x: c.poly.x[0], z: c.poly.z[0] });
          continue;
        }
      }
      if (c.ringc || c.exit) continue;
      let kind = null;
      if (c.move === 'L') kind = 'kiri';
      else if (c.move === 'R') kind = 'kanan';
      else if (c.move === 'U') kind = 'putar';
      else if (c.move === 'S') {
        const before = c.from.name || null;
        const after = c.to.name || null;
        if (after && after !== before) kind = 'lurus';
      }
      if (!kind) continue;
      out.push({ kind, exit: 0, street: c.to.name || '', at, x: c.poly.x[0], z: c.poly.z[0] });
    }
    const tgt = this.ego.target;
    if (tgt) out.push({ kind: 'tiba', exit: 0, street: tgt.name, at: this.legLen - (tgt.link.len - tgt.s), x: tgt.x, z: tgt.z });
    for (const m of out) m.text = instruction(m);
    this.maneuvers = out;
  }

  /** Garis seluruh putaran halte (dipakai peta rute sebagai garis tipis). */
  buildLoop() {
    const city = this.app.city;
    const H = city.halte;
    const pts = [];
    const legs = [];
    for (let i = 0; i < H.length; i++) {
      const a = H[i];
      const b = H[(i + 1) % H.length];
      const r = city.route(a.link, a.s, b.link, b.s, this.ego.routeOpts());
      if (!r) {
        legs.push(null);
        continue;
      }
      let len = 0;
      const seg = [];
      r.links.forEach((l, k) => {
        const P = l.poly;
        const s0 = k === 0 ? a.s : 0;
        const s1 = k === r.links.length - 1 ? b.s : l.len;
        for (let s = s0; s < s1; s += 4) {
          P.at(s, this.O);
          seg.push(this.O.x, this.O.z);
        }
        len += s1 - s0;
      });
      P_AT(b.link, b.s, this.O);
      seg.push(this.O.x, this.O.z);
      legs.push(Math.round(len));
      for (const v of seg) pts.push(v);
    }
    this.loop = new Float32Array(pts);
    this.loopLegs = legs;
    this.loopVersion++;
  }

  /** Perbarui jarak, waktu tiba, manuver berikutnya, dan kejadian di jalan. */
  update() {
    const ego = this.ego;
    const veh = ego.veh;
    if (ego.mode === 'manual' || !this.legAll.length) {
      this.progress = 0;
      this.remaining = ego.mode === 'manual' ? NaN : 0;
      this.etaSec = NaN;
    } else {
      const cumHere = this.legCum[this.legIndex] || 0;
      this.progress = Math.min(this.legLen, cumHere + (this.legAll[this.legIndex] === veh.link ? veh.s : 0));
      this.remaining = ego.remaining();
      this.etaSec = this.estimateTime();
    }
    for (const m of this.maneuvers) m.dist = m.at - this.progress;
    this.updateIncidents();
  }

  /** Perkiraan waktu tempuh ke halte berikutnya (detik). Sederhana: kecepatan wajar per ruas plus tunggu di lampu dan simpang. */
  estimateTime() {
    const ego = this.ego;
    const veh = ego.veh;
    const cruise = ego.cruiseSpeed();
    const L = this.legAll;
    let t = 0;
    const tgt = ego.target;
    for (let i = this.legIndex; i < L.length; i++) {
      const l = L[i];
      let len = l.len;
      if (i === this.legIndex && l === veh.link) len -= veh.s;
      if (i === L.length - 1 && tgt && l === tgt.link) len -= l.len - tgt.s;
      if (len <= 0) continue;
      let v = Math.min(cruise, l.vmax);
      for (const sv of l.spdV) v = Math.min(v, sv);
      t += len / Math.max(1.5, v * 0.88);
      if (l.sig) t += 12;
      if (l.kind === 'conn' && l.rank === 2) t += 2;
    }
    if (ego.state === 'di-halte') t += ego.dwellLeft();
    return t;
  }

  updateIncidents() {
    const app = this.app;
    const ego = this.ego;
    const out = [];
    const onRoute = (x, z) => {
      const R = this.route;
      for (let i = 0; i < R.length; i += 2) {
        const dx = R[i] - x;
        const dz = R[i + 1] - z;
        if (dx * dx + dz * dz < 36) return true;
      }
      return false;
    };
    if (app.obstacles) {
      for (const ob of app.obstacles.list) out.push({ kind: ob.kind, x: ob.x, z: ob.z, text: ob.kind === 'galian' ? 'Galian jalan' : 'Kendaraan parkir di lajur', onRoute: onRoute(ob.x, ob.z) });
      for (const c of app.obstacles.closedList()) out.push({ kind: 'tutup', x: c.x, z: c.z, text: `Jalan ditutup${c.name ? `: ${c.name}` : ''}`, onRoute: false });
    }
    for (const p of app.peds.peds) {
      if (p.state !== 'cross' && !p.test) continue;
      const dx = p.x - ego.veh.x;
      const dz = p.z - ego.veh.z;
      if (!p.test && dx * dx + dz * dz > 250 * 250) continue;
      out.push({ kind: 'pejalan', x: p.x, z: p.z, text: 'Pejalan kaki menyeberang', onRoute: onRoute(p.x, p.z) });
    }
    this.incidents = out;
  }

  /** Manuver berikutnya yang belum dilewati. */
  next() {
    for (const m of this.maneuvers) if (m.dist > -2) return m;
    return null;
  }

  /** Ringkasan untuk panel dan uji. */
  summary() {
    const ego = this.ego;
    const nx = this.next();
    const H = ego.city.halte;
    return {
      version: this.version,
      target: ego.target ? ego.target.name : null,
      status: ego.statusText(),
      remaining: this.remaining,
      etaSec: this.etaSec,
      etaMin: Number.isFinite(this.etaSec) ? Math.max(1, Math.round(this.etaSec / 60)) : null,
      next: nx ? { kind: nx.kind, exit: nx.exit, street: nx.street, dist: nx.dist, text: nx.text, banner: `${nx.text}, ${fmtDist(Math.max(0, nx.dist))}` } : null,
      maneuvers: this.maneuvers.filter((m) => m.dist > -2).map((m) => ({ kind: m.kind, exit: m.exit, street: m.street, dist: Math.round(m.dist), text: m.text })),
      progress: this.progress,
      legLen: this.legLen,
      routePoints: this.route.length / 2,
      loopLegs: this.loopLegs,
      passengers: ego.pax.onboard.length,
      capacity: ego.pax.capacity,
      stops: H.map((h, i) => ({ name: h.name, next: i === ego.halteIdx, waiting: ego.pax.waiting[i].length })),
      incidents: this.incidents.map((i) => ({ kind: i.kind, text: i.text, onRoute: i.onRoute, x: Math.round(i.x), z: Math.round(i.z) })),
    };
  }
}

function P_AT(link, s, o) {
  return link.poly.at(s, o);
}
