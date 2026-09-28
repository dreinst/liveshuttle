// Perisai keselamatan khusus LiveShuttle (mode otomatis dan mode manual).
//
// Perisai ini memakai "koridor lintasan": jejak badan shuttle digeser di sepanjang lintasan yang akan
// dilalui (mode otomatis: garis tengah lajur ditambah geser lateral rencana; mode manual: busur dari
// kelengkungan setir sekarang, maju atau mundur). Di setiap titik sampel (tiap 0,4 m) diperiksa:
// - pejalan kaki (posisi sekarang dan perkiraan 0,8, 1,6, dan 2,4 detik ke depan bila sedang
//   menyeberang) di dalam jejak badan yang diperlebar sela samping,
// - garis henti lampu merah, atau lampu kuning bila shuttle masih bisa berhenti nyaman,
// - zebra cross yang sedang dipakai pejalan kaki.
// Hasilnya jarak tempuh terjauh (titik pusat) yang masih boleh dilalui. Ego lalu memilih percepatan
// sehingga jarak henti (dengan jeda aktuator, sentakan rem, dan gesekan jalan saat ini) tidak pernah
// melebihi jarak itu, dan menjepit posisi bila perlu. Sesudah bergerak, jejak baru diperiksa sekali
// lagi secara geometris: bila menyentuh pejalan kaki atau melewati garis henti saat merah, gerakan
// dibatalkan. Jadi aturan keselamatan tidak bergantung pada perkiraan saja.
import { SHIELD, yellowDecision, committedGo } from './shield.js';
import { SH } from './drive.js';

const STEP = 0.4;
const MAXS = 200;
const PRED = [0.8, 1.6, 2.4];

/** Kotak berorientasi (pusat, arah h, setengah panjang hl, setengah lebar hw) vs lingkaran. */
export function boxCircle(bx, bz, c, s, hl, hw, px, pz, r) {
  const rx = px - bx;
  const rz = pz - bz;
  const lx = rx * c + rz * s;
  const lz = -rx * s + rz * c;
  const qx = lx < -hl ? -hl : lx > hl ? hl : lx;
  const qz = lz < -hw ? -hw : lz > hw ? hw : lz;
  const ex = lx - qx;
  const ez = lz - qz;
  return ex * ex + ez * ez < r * r;
}

/** Dua kotak berorientasi bertumpang tindih (SAT). */
export function boxBox(ax, az, ah, ahl, ahw, bx, bz, bh, bhl, bhw) {
  const ac = Math.cos(ah);
  const as = Math.sin(ah);
  const bc = Math.cos(bh);
  const bs = Math.sin(bh);
  const tx = bx - ax;
  const tz = bz - az;
  const axes = AX;
  axes[0] = ac;
  axes[1] = as;
  axes[2] = -as;
  axes[3] = ac;
  axes[4] = bc;
  axes[5] = bs;
  axes[6] = -bs;
  axes[7] = bc;
  for (let i = 0; i < 8; i += 2) {
    const ux = axes[i];
    const uz = axes[i + 1];
    const ra = ahl * Math.abs(ac * ux + as * uz) + ahw * Math.abs(-as * ux + ac * uz);
    const rb = bhl * Math.abs(bc * ux + bs * uz) + bhw * Math.abs(-bs * ux + bc * uz);
    if (Math.abs(tx * ux + tz * uz) > ra + rb) return false;
  }
  return true;
}
const AX = new Float64Array(8);

export class EgoShield {
  constructor(app) {
    this.app = app;
    this.n = 0;
    this.x = new Float64Array(MAXS);
    this.z = new Float64Array(MAXS);
    this.h = new Float64Array(MAXS);
    this.u = new Float64Array(MAXS); // ketidakpastian lateral tambahan (m)
    this.dir = 1;
    this.cons = { d: Infinity, kind: '', name: '', ped: null, px: 0, pz: 0, arm: null };
    this.tmp = { d: Infinity, kind: '', name: '', ped: null, px: 0, pz: 0, arm: null };
    this.pedBuf = [];
    this.O = {};
  }

  /**
   * Sampel lintasan mode otomatis. path: link sekarang lalu veh.path. latRef(link, s) = geser lateral
   * rencana. Titik pertama = pose shuttle sebenarnya; selisih lateralnya meluruh (pure pursuit
   * mengejar garis rencana) dan dipakai sebagai sela tambahan.
   */
  buildAuto(veh, latRef, horizon) {
    const O = this.O;
    const lat0 = veh.lat;
    const err0 = lat0 - latRef(veh.link, veh.s);
    let L = veh.link;
    let kk = -1;
    let start = -veh.s; // jarak tempuh pusat saat berada di awal link L
    let n = 0;
    this.dir = 1;
    for (let sig = 0; sig <= horizon && n < MAXS; sig += STEP) {
      let ss = sig - start;
      while (L && ss > L.len) {
        start += L.len;
        kk++;
        L = veh.path[kk];
        ss = sig - start;
      }
      if (!L) break;
      L.poly.atSmooth(ss, O);
      const decay = Math.exp(-sig / 5);
      const lr = latRef(L, ss) + err0 * decay;
      const lr2 = latRef(L, ss + 0.5) + err0 * Math.exp(-(sig + 0.5) / 5);
      const psi = Math.atan2(lr2 - lr, 0.5);
      this.x[n] = O.x - Math.sin(O.h) * lr;
      this.z[n] = O.z + Math.cos(O.h) * lr;
      this.h[n] = O.h + psi;
      this.u[n] = Math.abs(err0) * decay * 0.5;
      n++;
    }
    // sampel pertama = pose sebenarnya
    if (n > 0) {
      this.x[0] = veh.x;
      this.z[0] = veh.z;
      this.h[0] = veh.h;
    }
    this.n = n;
  }

  /** Sampel busur mode manual: dari pose (x, z, h), kelengkungan kappa, arah gerak dir (1 maju, -1 mundur). */
  buildArc(x, z, h, kappa, dir, horizon) {
    let n = 0;
    this.dir = dir;
    let cx = x;
    let cz = z;
    let ch = h;
    for (let sig = 0; sig <= horizon && n < MAXS; sig += STEP) {
      this.x[n] = cx;
      this.z[n] = cz;
      this.h[n] = ch;
      this.u[n] = 0;
      n++;
      const hm = ch + dir * kappa * STEP * 0.5;
      cx += dir * Math.cos(hm) * STEP;
      cz += dir * Math.sin(hm) * STEP;
      ch += dir * kappa * STEP;
    }
    this.n = n;
  }

  /** Kumpulkan pejalan kaki di sekitar sampel (sekali per pemindaian). */
  gatherPeds(extraPeople) {
    const out = this.pedBuf;
    out.length = 0;
    if (!this.n) return out;
    const n = this.n;
    const mx = (this.x[0] + this.x[n - 1]) / 2;
    const mz = (this.z[0] + this.z[n - 1]) / 2;
    let r = 0;
    for (let i = 0; i < n; i += 8) r = Math.max(r, Math.hypot(this.x[i] - mx, this.z[i] - mz));
    r = Math.max(r, Math.hypot(this.x[n - 1] - mx, this.z[n - 1] - mz)) + SH.hl + 4;
    this.app.peds.grid.query(mx, mz, r, (p) => out.push(p));
    if (extraPeople) for (const p of extraPeople) if (Math.hypot(p.x - mx, p.z - mz) < r) out.push(p);
    return out;
  }

  /**
   * Cari batasan terdekat di sepanjang sampel. veh: kendaraan ego. mu: gesekan jalan.
   * opts.links: true bila memakai data lajur (mode otomatis: lampu di ujung lajur dan zebra cross
   * dari link). Hasil di this.cons: d = jarak tempuh pusat terjauh yang diizinkan.
   */
  scan(veh, mu, opts, out = this.cons) {
    out.d = Infinity;
    out.kind = '';
    out.name = '';
    out.ped = null;
    out.arm = null;
    const n = this.n;
    if (!n) return out;
    const hl = SH.hl;
    const hw = SH.hw;
    const dir = this.dir;
    // ===== pejalan kaki =====
    const peds = opts.peds || this.gatherPeds(opts.extraPeople);
    const wMargin = hw + SHIELD.latMargin;
    const R = SHIELD.pedR;
    for (let pi = 0; pi < peds.length; pi++) {
      const p = peds[pi];
      const moving = (p.state === 'cross' || p.test) && (p.vx || p.vz);
      const nPos = moving ? PRED.length + 1 : 1;
      for (let q = 0; q < nPos; q++) {
        const t = q === 0 ? 0 : PRED[q - 1];
        const px = p.x + (p.vx || 0) * t;
        const pz = p.z + (p.vz || 0) * t;
        // apakah pejalan kaki di depan arah gerak saat ini (bukan di samping atau di belakang)?
        const c0 = Math.cos(this.h[0]);
        const s0 = Math.sin(this.h[0]);
        const lx0 = ((px - this.x[0]) * c0 + (pz - this.z[0]) * s0) * dir;
        const ahead = lx0 > hl - 0.15;
        const reach = hl + wMargin + R + 1;
        for (let i = ahead ? 0 : 1; i < n; i++) {
          const dx = px - this.x[i];
          const dz = pz - this.z[i];
          if (dx * dx + dz * dz > reach * reach) continue;
          const c = Math.cos(this.h[i]);
          const s = Math.sin(this.h[i]);
          const hit = ahead ? boxCircle(this.x[i], this.z[i], c, s, hl, wMargin + this.u[i], px, pz, R) : boxCircle(this.x[i], this.z[i], c, s, hl + 0.12, hw + 0.12, px, pz, R);
          if (hit) {
            const d = (i - 1) * STEP - SHIELD.gapPed;
            if (d < out.d) {
              out.d = d;
              out.kind = q === 0 ? 'pejalan' : 'pejalan-arah';
              out.ped = p;
              out.px = p.x;
              out.pz = p.z;
              out.name = '';
            }
            break;
          }
        }
      }
    }
    // ===== lampu lalu lintas dan zebra cross =====
    if (opts.links) this.scanLinks(veh, mu, out);
    else this.scanSignalsFree(veh, mu, out);
    if (!opts.links) this.scanCrossingsFree(out);
    return out;
  }

  /** Mode otomatis: lampu di ujung lajur dan zebra cross yang dipakai, dari data link. */
  scanLinks(veh, mu, out) {
    const hl = SH.hl;
    let base = -veh.s;
    let link = veh.link;
    let k = -1;
    const horizon = (this.n - 1) * STEP + 2;
    while (link) {
      if (link.sig) {
        const dFront = base + link.len - hl; // jarak tempuh pusat sampai bumper depan di garis henti
        if (dFront > -0.05) {
          const ctl = link.sig.ctl;
          const col = ctl.color(link.sig.arm);
          let stop = col === 'red';
          if (col === 'yellow' && !committedGo(veh, ctl)) {
            const dec = yellowDecision(veh, ctl, link.sig.arm, dFront - SHIELD.gapStop, mu, 0, dFront);
            stop = dec === 'stop';
          }
          if (stop) {
            const d = dFront - SHIELD.gapStop;
            if (d < out.d) {
              out.d = d;
              out.kind = col === 'red' ? 'merah' : 'kuning';
              out.name = link.name || '';
              out.ped = null;
            }
          }
        }
      }
      for (let i = 0; i < link.xings.length; i++) {
        const xg = link.xings[i];
        if (!xg.x.reserved.size) continue;
        const fr = base + xg.s0 - hl; // pusat saat bumper depan di tepi zebra cross
        if (fr < -0.2) continue; // bumper sudah di atas zebra cross sebelum dipesan
        const d = fr - SHIELD.gapCrossing;
        if (d < out.d) {
          out.d = d;
          out.kind = 'zebra';
          out.name = link.name || '';
          out.ped = null;
        }
      }
      base += link.len;
      if (base > horizon) break;
      k++;
      link = veh.path[k];
    }
  }

  /**
   * Mode manual: garis henti selebar jalan di tiap lengan lampu. Berlaku bila bumper depan (atau
   * belakang saat mundur) akan melewatinya searah lengan itu.
   */
  scanSignalsFree(veh, mu, out) {
    const n = this.n;
    const hl = SH.hl;
    const dir = this.dir;
    const sigs = this.app.signals.list;
    for (let si = 0; si < sigs.length; si++) {
      const ctl = sigs[si];
      const dx0 = ctl.data.x - this.x[0];
      const dz0 = ctl.data.z - this.z[0];
      if (dx0 * dx0 + dz0 * dz0 > Math.pow(n * STEP + 40, 2)) continue;
      for (let ai = 0; ai < ctl.arms.length; ai++) {
        const a = ctl.arms[ai];
        const col = ctl.color(ai);
        if (col === 'green') continue;
        const ux = Math.cos(a.h);
        const uz = Math.sin(a.h);
        let prevQ = NaN;
        for (let i = 0; i < n; i++) {
          const c = Math.cos(this.h[i]);
          const s = Math.sin(this.h[i]);
          const fx = this.x[i] + dir * c * hl;
          const fz = this.z[i] + dir * s * hl;
          const q = (fx - a.x) * ux + (fz - a.z) * uz;
          const lat = -(fx - a.x) * uz + (fz - a.z) * ux;
          const moveDot = dir * (c * ux + s * uz);
          if (i > 0 && prevQ < 0 && q >= 0 && Math.abs(lat) <= a.half + SH.hw + 0.3 && moveDot > 0.2) {
            const dLine = (i - 1) * STEP + (-prevQ / Math.max(1e-6, q - prevQ)) * STEP;
            let stop = col === 'red';
            if (col === 'yellow' && !committedGo(veh, ctl)) stop = yellowDecision(veh, ctl, ai, dLine - SHIELD.gapStop, mu, 0, dLine) === 'stop';
            if (stop) {
              const d = dLine - SHIELD.gapStop - STEP;
              if (d < out.d) {
                out.d = d;
                out.kind = col === 'red' ? 'merah' : 'kuning';
                out.name = a.name || '';
                out.ped = null;
                out.arm = a;
              }
            }
            break;
          }
          prevQ = q;
        }
      }
    }
  }

  /** Mode manual: zebra cross (tetap dan sementara) yang sedang dipakai pejalan kaki. */
  scanCrossingsFree(out) {
    const list = this.app.city.crossings;
    const temp = this.app.peds.temp;
    const total = list.length + temp.length;
    for (let ci = 0; ci < total; ci++) {
      const X = ci < list.length ? list[ci] : temp[ci - list.length];
      if (!X.reserved.size) continue;
      // persegi zebra cross: panjang X.len melintang jalan, lebar X.w searah jalan
      const xh = X.h + Math.PI / 2;
      for (let i = 0; i < this.n; i++) {
        const dx = X.x - this.x[i];
        const dz = X.z - this.z[i];
        if (dx * dx + dz * dz > Math.pow(SH.hl + X.len / 2 + 3, 2)) continue;
        if (boxBox(this.x[i], this.z[i], this.h[i], SH.hl, SH.hw, X.x, X.z, xh, X.len / 2, X.w / 2)) {
          if (i === 0) break; // sudah di atas zebra cross sebelum dipesan
          const d = (i - 1) * STEP - SHIELD.gapCrossing;
          if (d < out.d) {
            out.d = d;
            out.kind = 'zebra';
            out.name = '';
            out.ped = null;
          }
          break;
        }
      }
    }
  }
}
