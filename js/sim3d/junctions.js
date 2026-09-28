// Pengatur persimpangan: reservasi zona konflik yang bebas kebuntuan (deadlock).
//
// Aturan masuk persimpangan:
// - Izin diberikan untuk satu RANTAI konektor sekaligus (semua atau tidak sama sekali). Rantai
//   dimulai dari konektor berikutnya di jalur kendaraan dan diteruskan selama lajur sesudahnya
//   terlalu pendek untuk menampung kendaraan itu (misalnya lajur 1 m di antara dua persimpangan
//   yang berdempetan, atau lajur cincin bundaran kecil). Jadi kendaraan tidak pernah berhenti
//   menunggu izin di dalam persimpangan.
// - Kendaraan hanya masuk bila SEMUA zona konflik di rantainya bebas, dan lajur keluar di ujung
//   rantai punya ruang (termasuk kendaraan lain yang sudah mendapat izin ke lajur itu). Ruang
//   dihitung hanya di lajur itu sendiri, karena kendaraan mungkin harus berhenti di ujungnya.
// - Di bundaran, ruang di lajur keluar bundaran dipesan sejak masuk, jadi kendaraan di cincin
//   selalu bisa keluar dan cincin tidak pernah macet total.
// - Prioritas: konektor rank 0 (jalan utama, arus di cincin bundaran) didahulukan. Rank 1 (jalan
//   utama belok kanan) dan rank 2 (jalan kecil, masuk bundaran) hanya masuk bila tidak ada kendaraan
//   prioritas lebih tinggi yang akan tiba sebelum mereka selesai melintas.
// - Di antara rank yang sama berlaku siapa datang lebih dulu (FCFS): kendaraan yang siap di garis
//   tetapi tertahan karena zona masih terpakai "mengklaim" rantainya, sehingga kendaraan yang datang
//   belakangan tidak menyerobot. Kendaraan yang tertahan karena mengalah, lampu, atau lajur keluar
//   penuh tidak mengklaim apa pun, supaya tidak ada dua kendaraan yang saling menunggu.
// - Di persimpangan berlampu, izin hanya diberikan saat lampu lengan itu hijau (atau kendaraan
//   sudah memutuskan jalan terus di lampu kuning).
import { committedGo } from './shield.js';

const REQ_READY = 8; // kendaraan dianggap "siap" (menunggu di garis) bila jaraknya kurang dari ini
/** Lajur bisa menampung kendaraan yang berhenti bila panjangnya >= panjang kendaraan + sela ini (m). */
const STORE_GAP = 2.5;
// alasan permintaan izin belum dikabulkan
const OK = 0;
const BUSY = 1;
const CLAIMED = 2;
const YIELD = 3;
const EXIT = 4;
const SIGNAL = 5;
const WAIT_PATH = 6;
const ZONE = 7;
export const WAIT_LABEL = ['', 'zona terpakai', 'antre', 'memberi jalan', 'lajur keluar penuh', 'lampu', 'rencana', 'zona lajur'];

export class Junctions {
  constructor(app) {
    this.app = app;
    this.city = app.city;
    this.pending = [];
    this.touched = [];
    this.claimed = [];
    this.pool = [];
    this.poolN = 0;
    this.grants = 0;
    for (const c of this.city.conns) c.conflictSet = new Set(c.conflicts.map((k) => k.o));
    this.chainBuf = { n: 0, c: [], d: [] };
  }

  beginTick() {
    for (const c of this.touched) c.approach.length = 0;
    this.touched.length = 0;
    this.pending.length = 0;
    this.poolN = 0;
  }

  /** Catat kendaraan yang mendekati konektor c (jarak d dari bumper depan ke awal konektor). */
  addApproach(veh, c, d) {
    let e = this.pool[this.poolN];
    if (!e) {
      e = { veh: null, d: 0 };
      this.pool.push(e);
    }
    this.poolN++;
    e.veh = veh;
    e.d = d;
    if (!c.approach.length) this.touched.push(c);
    c.approach.push(e);
  }

  addRequest(veh, c, d) {
    if (veh.reqConn !== c) {
      veh.reqConn = c;
      veh.reqT = this.app.simTime;
    }
    veh.reqDist = d;
    this.pending.push(veh);
  }

  /** Posisi bumper belakang kendaraan W di sepanjang konektor c (negatif = belum masuk). */
  static rearOn(W, c) {
    for (let i = 0; i < W.grants.length; i++) {
      const g = W.grants[i];
      if (g.c === c) return W.odo - g.startOdo - W.len / 2;
    }
    return Infinity;
  }

  process() {
    const P = this.pending;
    if (!P.length) return;
    P.sort((a, b) => a.reqConn.rank - b.reqConn.rank || a.reqT - b.reqT || a.id - b.id);
    const claimed = this.claimed;
    claimed.length = 0;
    for (const veh of P) {
      const chain = this.chainOf(veh, veh.reqConn);
      const why = chain ? this.grantable(veh, chain, claimed) : WAIT_PATH;
      if (why === OK) this.grantChain(veh, chain);
      else if ((why === BUSY || why === CLAIMED) && veh.reqDist < REQ_READY) for (let i = 0; i < chain.n; i++) claimed.push(chain.c[i]);
      veh.waitWhy = why;
    }
  }

  /** Bisakah lajur menampung kendaraan veh yang berhenti di ujungnya tanpa ekor di persimpangan? */
  static storable(lane, veh) {
    return lane.portal === 'out' || (lane.kind === 'lane' ? lane.stopLen : lane.len) >= veh.len + STORE_GAP;
  }

  /**
   * Rantai konektor yang harus diizinkan bersama mulai dari c: diteruskan melewati lajur yang
   * terlalu pendek untuk berhenti. Mengembalikan objek yang dipakai ulang { n, c[], d[] } dengan
   * d = jarak bumper depan ke awal konektor, atau null bila rencana jalur belum cukup panjang.
   */
  chainOf(veh, c) {
    const ch = this.chainBuf;
    ch.n = 0;
    let idx = veh.path.indexOf(c);
    if (idx < 0) return null;
    let d = veh.reqDist;
    let cur = c;
    for (;;) {
      ch.c[ch.n] = cur;
      ch.d[ch.n] = d;
      ch.n++;
      const lane = veh.path[idx + 1] || cur.to;
      if (Junctions.storable(lane, veh)) return ch;
      const nc = veh.path[idx + 2];
      if (!nc) return null; // rencana belum sampai lajur tempat berhenti: tunggu
      if (nc.kind !== 'conn' || ch.n >= 12) return ch;
      d += cur.len + lane.len;
      cur = nc;
      idx += 2;
    }
  }

  grantable(veh, ch, claimed) {
    // apakah rantai ini kembali ke lajur tempat veh sekarang (putaran pendek)?
    let loops = false;
    for (let q = 0; q < ch.n; q++) if (ch.c[q].to === veh.link) loops = true;
    for (let q = 0; q < ch.n; q++) {
      const c = ch.c[q];
      // lampu lalu lintas
      const from = c.from;
      if (from.sig) {
        const col = from.sig.ctl.color(from.sig.arm);
        if (col === 'red') return SIGNAL;
        if (col === 'yellow' && !committedGo(veh, from.sig.ctl)) return SIGNAL;
      }
      // konflik dengan kendaraan yang sudah mendapat izin
      for (let i = 0; i < c.conflicts.length; i++) {
        const k = c.conflicts[i];
        const hs = k.o.holders;
        for (let j = 0; j < hs.length; j++) {
          const W = hs[j];
          if (W === veh) continue;
          // W sedang di konektor yang bermuara ke lajur tempat veh berada, di belakang veh: W hanya
          // bisa maju mengikuti veh, jadi W pasti sudah lewat sebelum veh sampai ke konektor ini
          if (!loops && k.o.to === veh.link && (W.link === k.o || (W.link === veh.link && W.prevLink === k.o && W.s < veh.s))) continue;
          if (Junctions.rearOn(W, k.o) < k.ot[1]) return BUSY;
        }
      }
      // zona lajur di dekat konektor: tidak boleh ada badan kendaraan di sana, dan kendaraan yang
      // menuju zona itu harus masih bisa berhenti dengan nyaman sebelum zona
      if (c.laneZones && this.zoneBusy(veh, c)) return ZONE;
      // siapa datang lebih dulu: jangan menyerobot permintaan yang lebih awal dan sudah menunggu
      for (let i = 0; i < claimed.length; i++) {
        const c2 = claimed[i];
        if (c2 !== c && c.conflictSet.has(c2)) return CLAIMED;
      }
      // memberi jalan kepada arus prioritas yang akan segera tiba
      if (c.rank > 0) {
        const d0 = Math.max(0, ch.d[q]);
        for (let i = 0; i < c.conflicts.length; i++) {
          const k = c.conflicts[i];
          if (k.o.rank >= c.rank) continue;
          const dist = d0 + k.my[1] + veh.len;
          const v = Math.max(veh.v, 0);
          const tNeed = (-v + Math.sqrt(v * v + 2 * 1.2 * dist)) / 1.2 + 1.2;
          const ap = k.o.approach;
          for (let j = 0; j < ap.length; j++) {
            const U = ap[j].veh;
            if (U === veh) continue;
            const dU = ap[j].d + k.ot[0];
            if (U.v < 0.3 && ap[j].d > 3) continue; // berhenti jauh dari garis, bukan ancaman
            const eta = dU / Math.max(U.v, 1.5);
            if (eta < tNeed + 1.5) return YIELD;
          }
        }
      }
    }
    // ruang di lajur keluar (ujung rantai)
    const last = ch.c[ch.n - 1];
    if (last.entry) {
      if (!this.ringExitFree(veh, last)) return EXIT;
    } else if (last.ringc) {
      // di dalam cincin: lajur cincin sesudahnya bisa menampung kendaraan (lihat chainOf)
    } else if (last.exit && veh.rbExit === last.to) {
      // ruang di lajur keluar sudah dipesan sejak masuk bundaran
    } else if (!this.exitFree(veh, last)) return EXIT;
    return OK;
  }

  zoneBusy(veh, c) {
    const zs = c.laneZones;
    for (let i = 0; i < zs.length; i++) {
      const z = zs[i];
      const L = z.lane;
      for (let k = 0; k < L.occN; k++) {
        const o = L.occ[k];
        const W = o.veh;
        if (W === veh) continue;
        const rear = o.s - W.len / 2;
        const front = o.s + W.len / 2;
        if (front > z.s0 && rear < z.s1) return true;
        // masih bergerak menuju zona dan tidak bisa lagi berhenti nyaman sebelum zona
        if (z.kind === 'in' && front <= z.s0 && W.v * 0.5 + (W.v * W.v) / (2 * 2.0) > z.s0 - front) return true;
      }
      if (z.kind === 'in') {
        // kendaraan di link sebelumnya yang sudah terlalu dekat untuk berhenti sebelum zona
        for (let p = 0; p < L.prev.length; p++) {
          const U = L.prev[p];
          for (let k = 0; k < U.occN; k++) {
            const o = U.occ[k];
            const W = o.veh;
            if (W === veh) continue;
            const gap = U.len - (o.s + W.len / 2) + z.s0;
            if (gap > 0 && W.v * 0.5 + (W.v * W.v) / (2 * 2.0) > gap) return true;
          }
        }
      }
    }
    return false;
  }

  /** Ruang bebas di lajur (m) dari awal lajur sampai bumper belakang kendaraan terdekat. */
  laneSpace(veh, lane) {
    let m = Infinity;
    for (let i = 0; i < lane.occN; i++) {
      const o = lane.occ[i];
      if (o.veh === veh) continue;
      const r = o.s - o.veh.len / 2;
      if (r < m) m = r;
    }
    if (m !== Infinity) return Math.min(m, lane.stopLen);
    return lane.portal === 'out' ? Infinity : lane.stopLen;
  }

  exitFree(veh, c) {
    const out = c.to;
    let pend = 0;
    for (const c2 of out.prev) {
      for (const W of c2.holders) {
        if (W === veh) continue;
        if (Junctions.rearOn(W, c2) < c2.len) pend += W.len + 2.0;
      }
    }
    // kendaraan di bundaran yang sudah memesan lajur ini sejak masuk dan belum memegang konektornya
    const all = this.app.traffic.all;
    for (let i = 0; i < all.length; i++) {
      const W = all[i];
      if (W === veh || W.rbExit !== out) continue;
      let holds = false;
      for (let g = 0; g < W.grants.length; g++) if (W.grants[g].c.to === out) holds = true;
      if (!holds) pend += W.len + 2.0;
    }
    const need = veh.len + 2.5 + pend;
    return this.laneSpace(veh, out) >= need;
  }

  ringExitFree(veh, c) {
    // lajur keluar bundaran = lajur bukan cincin pertama sesudah konektor masuk yang bisa
    // menampung kendaraan (lajur pendek di antara bundaran dan persimpangan lain dilewati)
    const i0 = veh.path.indexOf(c);
    let exitLane = null;
    for (let i = i0 + 1; i < veh.path.length; i++) {
      const l = veh.path[i];
      if (l.kind === 'lane' && l.ring === null && Junctions.storable(l, veh)) {
        exitLane = l;
        break;
      }
    }
    if (!exitLane) return false; // rencana belum sampai lajur keluar: tunggu
    let pend = 0;
    for (const W of this.app.traffic.all) {
      if (W !== veh && W.rbExit === exitLane) pend += W.len + 2.0;
    }
    const need = veh.len + 2.5 + pend;
    if (this.laneSpace(veh, exitLane) < need) return false;
    veh.rbExitPending = exitLane;
    return true;
  }

  /** Beri izin untuk seluruh rantai. */
  grantChain(veh, ch) {
    // jarak dari pusat kendaraan ke awal konektor = d + setengah panjang
    for (let q = 0; q < ch.n; q++) {
      const c = ch.c[q];
      const startOdo = veh.odo + ch.d[q] + veh.len / 2;
      veh.grants.push({ c, startOdo, t: this.app.simTime });
      c.holders.push(veh);
      if (c.entry && veh.rbExitPending) {
        veh.rbExit = veh.rbExitPending;
        veh.rbExitPending = null;
      }
      this.grants++;
    }
    veh.reqConn = null;
    veh.rbExitPending = null;
  }

  hasGrant(veh, c) {
    for (let i = 0; i < veh.grants.length; i++) if (veh.grants[i].c === c) return true;
    return false;
  }

  /** Lepaskan izin yang sudah dilewati seluruhnya (bumper belakang melewati ujung konektor). */
  releasePassed(veh) {
    const gs = veh.grants;
    for (let i = gs.length - 1; i >= 0; i--) {
      const g = gs[i];
      if (veh.odo - g.startOdo - veh.len / 2 >= g.c.len) this.dropGrant(veh, i);
    }
  }

  dropGrant(veh, i) {
    const g = veh.grants[i];
    const hs = g.c.holders;
    const k = hs.indexOf(veh);
    if (k >= 0) hs.splice(k, 1);
    veh.grants.splice(i, 1);
  }

  /** Apakah kendaraan sudah mulai memakai salah satu izinnya (bumper depan melewati awal konektor)? */
  inside(veh) {
    for (let i = 0; i < veh.grants.length; i++) if (veh.odo + veh.len / 2 >= veh.grants[i].startOdo - 0.05) return true;
    return false;
  }

  /**
   * Batalkan izin yang belum dipakai (misalnya kendaraan memutuskan berhenti di lampu kuning).
   * Bila kendaraan sudah berada di dalam rantainya, izin tidak dibatalkan supaya kendaraan tidak
   * pernah perlu meminta izin lagi dari dalam persimpangan.
   */
  cancelUnused(veh) {
    if (this.inside(veh)) return;
    for (let i = veh.grants.length - 1; i >= 0; i--) {
      const g = veh.grants[i];
      if (veh.odo + veh.len / 2 < g.startOdo - 0.05) {
        if (g.c.entry && veh.rbExit) veh.rbExit = null;
        this.dropGrant(veh, i);
      }
    }
  }

  releaseAll(veh) {
    while (veh.grants.length) this.dropGrant(veh, veh.grants.length - 1);
    veh.reqConn = null;
    veh.rbExit = null;
  }
}
