// Otak LiveShuttle (ego).
//
// Mode otomatis:
// - Rute: A* di graf lajur OSM dari posisi sekarang ke halte berikutnya (lajur inti, tanpa putar balik,
//   menghindari jalan privat, jalan ditutup, dan lajur yang tertutup penghalang tanpa jalan lewat).
// - Kecepatan: batas kecepatan simulator (10 sampai 40 km/jam, bawaan 30), batas tiap jalan, batas
//   tikungan, dan batas cuaca. Mengikuti kendaraan di depan (IDM), menunggu izin persimpangan (memberi
//   jalan di bundaran dan di jalan kecil), berhenti di lampu merah, lampu kuning bila masih bisa
//   berhenti nyaman, dan di zebra cross yang dipakai. Berhenti tepat di halte.
// - Kemudi: pure pursuit di koordinat lajur dengan laju setir terbatas (lihat drive.js).
// - Melewati kendaraan parkir atau galian dengan passing.js bila lajur lain kosong, bila tidak menunggu.
// - Perisai keselamatan (egoshield.js) selalu dijalankan sesudah rencana dan sebelum gerak.
//
// Mode manual ("Ambil kemudi"): panah atau WASD. Perisai tetap aktif dan boleh menahan gas maupun
// kemudi. Tabrakan dengan kendaraan lain atau penghalang dihitung terpisah, trotoar menahan shuttle.
import { Vehicle } from './traffic.js';
import { shuttle as shuttleModel } from './models/index.js';
import { SH, shuttleBrake, stopDistJerk, maxSafeAccel, stopAccel, idmShuttle, slew, pathCurvature } from './drive.js';
import { EgoShield, boxCircle, boxBox } from './egoshield.js';
import { SHIELD, yellowDecision } from './shield.js';
import { Nav } from './nav.js';
import { Passengers } from './passengers.js';
import { fmt, clamp } from './util.js';

/** Batas kecepatan shuttle per cuaca (km/jam). Alasannya dijelaskan di weatherNote(). */
export const WEATHER_CAP = { cerah: 40, hujan: 25, kabut: 20, malam: 25 };
export const SPEED_MIN = 10;
export const SPEED_MAX = 40;
const DOOR_T = 1.6;
const MIN_DWELL = 7;

const REASON_TEXT = {
  melaju: 'melaju sesuai batas kecepatan',
  tikungan: 'melambat untuk tikungan',
  mengikuti: 'menjaga jarak dengan kendaraan di depan',
  'menunggu-simpang': 'menunggu giliran masuk persimpangan',
  'memberi-jalan': 'memberi jalan kepada kendaraan di jalan utama',
  bundaran: 'memberi jalan kepada kendaraan di dalam bundaran',
  'lampu-merah': 'berhenti di lampu merah',
  'lampu-kuning': 'berhenti karena lampu kuning dan masih sempat berhenti',
  zebra: 'berhenti untuk pejalan kaki di zebra cross',
  halte: 'mendekati halte dan berhenti tepat di depannya',
  menyalip: 'melewati penghalang lewat lajur sebelah',
  'menunggu-lawan': 'menunggu lajur sebelah kosong untuk melewati penghalang',
  'di-halte': 'berhenti di halte',
};

const XING_WHY = {
  simpang: 'di depan shuttle ada persimpangan atau bundaran',
  rute: 'jalan di depan belum cukup panjang',
  dekat: 'ada kendaraan yang terlalu dekat untuk berhenti dengan aman',
  badan: 'ada kendaraan di tempat menyeberang',
  lampu: 'lampu pejalan kaki masih merah',
  halte: 'shuttle sedang berhenti di halte',
  manual: 'arah shuttle belum sejajar dengan jalan',
  tunggu: 'masih ada pejalan kaki uji yang menyeberang',
};

export class Ego {
  constructor(app) {
    this.app = app;
    this.city = app.city;
    const veh = new Vehicle('shuttle', { ego: true, rng: app.rng });
    veh.vDesBase = 30 / 3.6;
    veh.psi = 0;
    veh.kappa = 0;
    veh.lat = 0;
    veh.manual = false;
    this.veh = veh;
    this.mode = 'otomatis';
    this.speedLimitKmh = 30;
    this.halteIdx = 0;
    this.lastHalte = 0;
    this.state = 'melaju';
    this.phase = '';
    this.phaseT = 0;
    this.dwellT = 0;
    this.door = 0;
    this.replans = 0;
    this.legDriven = [];
    this.reason = 'melaju';
    this.blink = 0;
    this.pass = null;
    this.passWhy = '';
    this.vs = 0; // kecepatan bertanda (mundur negatif) untuk mode manual
    this.input = { up: 0, down: 0, left: 0, right: 0 };
    this.revHold = 0;
    this.shieldActive = false;
    this.shieldT = 0;
    this.steerOverride = false;
    this.consView = { kind: '', name: '', d: 0 };
    this.stats = { interventions: 0, manualInterventions: 0, clamps: 0, geomBlocks: 0, stops: 0, stopErr: [], collisions: 0, curb: 0, manualDist: 0, reroutes: 0, passes: 0, skipped: 0 };
    this.collideSet = new Set();
    this.collideNow = new Set();
    this.curbT = -9;
    this.shield = new EgoShield(app);
    this.nav = new Nav(app, this);
    this.pax = new Passengers(app, this);
    this.model = shuttleModel.createShuttle({ res: app.res, scene: app.scene });
    this.latRefFn = (L, s) => (this.pass && L === this.pass.lane ? app.passing.latAt(this.pass, s) : 0);
    this.P = { a: 0, hardStop: Infinity, leaderGap: Infinity, leaderV: 0 };
    this.T1 = {};
    this.T2 = {};
    this.LOC = { link: null, s: 0 };
    this.PR = {};
    this.lead = { gap: 0, v: 0 };
    this.xingReq = null;
    this.proxies = [];
    this.textT = 0;
  }

  get x() {
    return this.veh.x;
  }
  get z() {
    return this.veh.z;
  }
  get h() {
    return this.veh.h;
  }
  get v() {
    return this.veh.v;
  }

  get target() {
    return this.city.halte[this.halteIdx];
  }

  /** Mulai di halte pertama, lalu menuju halte berikutnya. */
  start() {
    const H = this.city.halte;
    const h0 = H[0];
    const veh = this.veh;
    veh.place(h0.link, Math.min(h0.link.len - veh.len / 2 - 1, h0.s), 0);
    veh.psi = 0;
    this.app.traffic.all.push(veh);
    this.lastHalte = 0;
    this.halteIdx = 1 % H.length;
    this.nav.buildLoop();
    this.planToHalte('mulai');
  }

  // ===== kecepatan =====

  /** Kecepatan jelajah yang dipilih shuttle (m/s): batas simulator, batas cuaca, dan batas global. */
  cruiseSpeed() {
    const w = this.app.weather;
    const cap = Math.min(WEATHER_CAP[w.name] || 40, w.fadeT < 15 ? WEATHER_CAP[w.prev] || 40 : 40);
    return Math.min(this.speedLimitKmh, cap, SPEED_MAX) / 3.6;
  }

  setSpeedLimit(kmh) {
    const v = Math.round(clamp(Number(kmh) || 30, SPEED_MIN, SPEED_MAX));
    this.speedLimitKmh = v;
    return v;
  }

  routeOpts() {
    const obs = this.app.obstacles;
    return { core: true, avoidPrivate: true, noU: true, blocked: obs ? (l) => obs.impassable(l) : null };
  }

  // ===== rute =====

  /**
   * Potong rencana jalur di konektor pertama yang belum diizinkan dan masih cukup jauh untuk
   * berhenti. Bagian sebelumnya sudah menjadi komitmen (izin persimpangan, atau terlalu dekat).
   */
  trimPath() {
    const veh = this.veh;
    const J = this.app.junctions;
    const aB = shuttleBrake(this.app.weather.mu);
    const need = stopDistJerk(veh.v, Math.max(0, veh.a), aB) + 3;
    let base = veh.link.len - veh.s - SH.hl;
    let cut = veh.path.length;
    for (let i = 0; i < veh.path.length; i++) {
      const l = veh.path[i];
      if (l.kind === 'conn' && !J.hasGrant(veh, l) && base > need) {
        cut = i;
        break;
      }
      base += l.len;
    }
    if (cut < veh.path.length) {
      veh.path.length = cut;
      let L = 0;
      for (const l of veh.path) L += l.len;
      veh.pathLen = L;
      veh.reqConn = null;
    }
  }

  /** A* ke halte h. Jalan pribadi hanya dihindari bila ada pilihan lain (misalnya sesudah kemudi manual). */
  routeTo(link, s, h) {
    return this.city.route(link, s, h.link, h.s, this.routeOpts()) || this.city.route(link, s, h.link, h.s, { ...this.routeOpts(), avoidPrivate: false });
  }

  planToHalte(reason) {
    const veh = this.veh;
    const tgt = this.target;
    this.trimPath();
    const startLink = veh.path.length ? veh.path[veh.path.length - 1] : veh.link;
    const startS = veh.path.length ? 0 : veh.s;
    const r = this.routeTo(startLink, startS, tgt);
    if (!r) {
      this.state = 'tanpa-rute';
      this.dwellT = 0;
      veh.route = [];
      this.noRouteT = (this.noRouteT || 0) + 1;
      return false;
    }
    this.noRouteT = 0;
    veh.route = r.links.slice(1);
    if (this.state !== 'di-halte') this.state = 'melaju';
    this.replans++;
    this.nav.setLeg([veh.link].concat(veh.path, veh.route), this.legDriven);
    this.routeReason = reason;
    return true;
  }

  /** Jalan ditutup atau penghalang berubah: perbarui rute bila rute sekarang terkena. */
  onRoadChange(kind, info) {
    this.nav.buildLoop();
    if (this.mode !== 'otomatis') return;
    const veh = this.veh;
    const obs = this.app.obstacles;
    const bad = (l) => l.closed || obs.impassable(l);
    let affected = false;
    for (const l of veh.path) if (bad(l)) affected = true;
    for (const l of veh.route || []) if (bad(l)) affected = true;
    const reopened = kind === 'buka' || kind === 'penghalang-diangkat';
    if (!affected && !reopened) return;
    const before = this.nav.legLen;
    const oldVersion = this.nav.version;
    if (this.planToHalte(affected ? 'tutup' : 'buka')) {
      this.stats.reroutes++;
      const changed = Math.abs(this.nav.legLen - before) > 1;
      if (affected || changed) {
        const why = kind === 'tutup' ? `${info.name || 'Jalan di depan'} ditutup` : kind === 'penghalang' ? 'ada penghalang di rute' : 'jalan dibuka lagi';
        this.app.toast(`Rute diperbarui: ${why}.`, 'rute');
        this.app.guideEvent('reroute', kind);
      }
    } else if (oldVersion === this.nav.version && this.state === 'tanpa-rute') {
      this.app.toast(`Belum ada rute ke Halte ${this.target.name}. Shuttle menunggu jalan dibuka.`, 'warn');
    }
  }

  /** Jarak tersisa kira-kira ke halte tujuan (m). */
  remaining() {
    const veh = this.veh;
    if (this.mode === 'manual') return NaN;
    let d = veh.link.len - veh.s;
    for (const l of veh.path) d += l.len;
    for (const l of veh.route || []) d += l.len;
    const tgt = this.target;
    return Math.max(0, d - (tgt.link.len - tgt.s));
  }

  dwellLeft() {
    if (this.state !== 'di-halte') return 0;
    return Math.max(2, MIN_DWELL - this.dwellT) + DOOR_T;
  }

  // ===== langkah fisika =====

  /** Dipanggil tiap langkah fisika sesudah NPC bergerak. */
  step(dt) {
    if (this.mode === 'manual') this.stepManual(dt);
    else this.stepAuto(dt);
    this.pax.step(dt);
    this.service(dt);
    this.stepCrossingRequest(dt);
    this.textT -= dt;
    if (this.textT <= 0) {
      this.textT = 0.25;
      this.nav.update();
    }
  }

  // ----- mode otomatis -----

  stepAuto(dt) {
    const app = this.app;
    const veh = this.veh;
    const J = app.junctions;
    const mu = app.weather.mu;
    const aB = shuttleBrake(mu);
    if (this.pass && (veh.link !== this.pass.lane || veh.s >= this.pass.sD)) {
      app.passing.finish(this.pass);
      this.pass = null;
    }
    const P = this.plan(dt, mu);
    // ===== perisai keselamatan =====
    const horizon = stopDistJerk(veh.v, Math.max(0, veh.a), aB) + SHIELD.horizonExtra + 6;
    this.shield.buildAuto(veh, this.latRefFn, horizon);
    const cons = this.shield.scan(veh, mu, { links: true, extraPeople: this.pax.walkers });
    const aPrev = veh.a;
    const jDown = P.a < aPrev - 1.2 || P.a < -2.0 ? SH.jFirm : SH.jComf * 1.6;
    let a = clamp(P.a, aPrev - jDown * dt, aPrev + SH.jComf * dt);
    a = clamp(a, -aB, SH.aMax);
    const aLo = Math.max(-aB, aPrev - SH.jEmerg * dt);
    let intervene = false;
    if (cons.d < Infinity) {
      const aSafe = maxSafeAccel(veh.v, cons.d, aB, dt, aLo, Math.max(a, aLo));
      const aS = aSafe === null ? aLo : aSafe;
      if (aS < a - 1e-6) {
        if (aS < P.a - 0.3 && aS < 0.5) intervene = true;
        a = aS;
      }
    }
    this.noteShield(intervene, cons, false);
    // ===== gerak memanjang =====
    const v = veh.v;
    let vNew = Math.max(0, v + a * dt);
    let dist = vNew <= 0 && a < 0 ? Math.min(v * dt, (v * v) / (-2 * a)) : ((v + vNew) / 2) * dt;
    if (cons.d < Infinity && dist > Math.max(0, cons.d)) {
      if (dist - Math.max(0, cons.d) > 0.01) {
        this.stats.clamps++;
        app.noteClamp(veh, { kind: cons.kind, d: cons.d, ped: null });
      }
      dist = Math.max(0, cons.d);
      vNew = 0;
    }
    if (dist > P.hardStop) {
      dist = Math.max(0, P.hardStop);
      if (P.hardStop < 0.03) vNew = 0;
    }
    if (P.leaderGap < Infinity && dist > P.leaderGap - 0.25) {
      dist = Math.max(0, P.leaderGap - 0.25);
      vNew = Math.min(vNew, P.leaderV);
    }
    // ===== kemudi =====
    this.steerAuto(dt);
    // ===== pemeriksaan geometris terakhir sebelum bergerak =====
    const nx = this.probe(dist, this.T1);
    if (dist > 0 && this.violates(nx.x, nx.z, nx.h, dist)) {
      this.stats.geomBlocks++;
      dist = 0;
      vNew = 0;
      a = Math.min(0, a);
      this.probe(0, nx);
    }
    this.commit(nx, dist);
    veh.a = vNew <= 0 && dist <= 1e-6 ? 0 : a;
    veh.v = vNew;
    veh.braking = a < -0.4 || (vNew < 0.15 && P.a < 0);
    J.releasePassed(veh);
    if (veh.grants.length && veh.v < 0.05) {
      veh.idleGrantT = (veh.idleGrantT || 0) + dt;
      if (veh.idleGrantT > 1.5) J.cancelUnused(veh);
    } else veh.idleGrantT = 0;
    veh.stuckT = veh.v < 0.1 ? veh.stuckT + dt : 0;
    this.vs = veh.v;
  }

  /** Rencana percepatan mode otomatis (belum melewati perisai). */
  plan(dt, mu) {
    const app = this.app;
    const veh = this.veh;
    const J = app.junctions;
    const v = veh.v;
    const hl = SH.hl;
    const P = this.P;
    let v0 = Math.min(this.cruiseSpeed(), veh.link.vmax, SHIELD.vMaxGlobal);
    if (this.pass) v0 = Math.min(v0, this.pass.vMax);
    const aComf = Math.min(SH.bComf, 0.5 * shuttleBrake(mu));
    let a = idmShuttle(v, v0, Infinity, 0);
    let reason = 'melaju';
    let hardStop = Infinity;
    let leaderGap = Infinity;
    let leaderV = 0;
    let leaderW = null;
    let blink = 0;
    const horizon = Math.max(90, v * 9);
    const tgt = this.target;
    const cruise = this.cruiseSpeed();
    let base = -veh.s;
    let link = veh.link;
    let k = -1;
    this.sigName = '';
    if (this.state !== 'melaju') {
      // di halte atau tanpa rute: tetap diam di tempat
      P.a = stopAccel(v, 0);
      P.hardStop = 0;
      P.leaderGap = Infinity;
      P.leaderV = 0;
      this.reason = this.state === 'di-halte' ? 'di-halte' : 'menunggu-simpang';
      this.blink = this.state === 'di-halte' && this.phase === 'tutup' ? 1 : 0;
      return P;
    }
    while (link) {
      // batas kecepatan link di depan dan tikungan
      if (k >= 0) {
        const vl = Math.min(link.vmax, SHIELD.vMaxGlobal, cruise);
        if (v > vl) {
          const d = Math.max(base - hl * 0.5, 0.5);
          if (v * v > vl * vl + 2 * aComf * d * 0.9) {
            const aa = (vl * vl - v * v) / (2 * d);
            if (aa < a) {
              a = aa;
              reason = 'tikungan';
            }
          }
        }
      }
      for (let i = 0; i < link.spdS.length; i++) {
        const d = base + link.spdS[i] - hl * 0.5;
        if (d < -hl) continue;
        const vl2 = link.spdV[i];
        if (v <= vl2) continue;
        const dd = Math.max(d, 0.5);
        if (v * v > vl2 * vl2 + 2 * aComf * dd * 0.9) {
          const aa = (vl2 * vl2 - v * v) / (2 * dd);
          if (aa < a) {
            a = aa;
            reason = 'tikungan';
          }
        }
      }
      // kendaraan dan penghalang di depan pada link ini
      for (let i = 0; i < link.occN; i++) {
        const o = link.occ[i];
        const W = o.veh;
        if (W === veh) continue;
        if (k < 0 && o.s <= veh.s) continue;
        if (W.obstacle && this.pass && this.pass.ob === W.obstacle) continue;
        const gap = base + o.s - W.len / 2 - hl;
        if (k < 0 && gap < -0.5) continue;
        if (gap < leaderGap) {
          leaderGap = gap;
          leaderV = W.v;
          leaderW = W;
        }
      }
      if (link.kind === 'conn') {
        // kendaraan di konektor saudara (berpisah dari lajur yang sama) yang masih berdekatan
        const sibs = link.from.next;
        for (let si = 0; si < sibs.length; si++) {
          const sib = sibs[si];
          if (sib === link) continue;
          for (let i = 0; i < sib.occN; i++) {
            const o = sib.occ[i];
            if (o.veh === veh) continue;
            const r = o.s - o.veh.len / 2;
            const sep = link.sibSep ? link.sibSep.get(sib) : undefined;
            if (r > (sep === undefined ? 9 : Math.max(3, sep))) continue;
            const gap = base + r - hl;
            if (gap > -0.5 && gap < leaderGap) {
              leaderGap = gap;
              leaderV = o.veh.v;
              leaderW = o.veh;
            }
          }
        }
        if (!J.hasGrant(veh, link)) {
          const d = base - hl - 0.3;
          if (d < hardStop) hardStop = Math.max(0, d);
          const aa = stopAccel(v, Math.max(0, d));
          if (aa < a) {
            a = aa;
            reason = link.rank > 0 ? (link.entry ? 'bundaran' : 'memberi-jalan') : 'menunggu-simpang';
          }
          if (!blink && link.move === 'L') blink = -1;
          if (!blink && link.move === 'R') blink = 1;
          break;
        }
        if (!blink && base < 40 && link.move === 'L') blink = -1;
        if (!blink && base < 40 && link.move === 'R') blink = 1;
      }
      // zona di ujung lajur: tunggu sebelum zona bila konektor berikutnya belum diizinkan
      if (link.zones && link.stopLen < link.len) {
        const nx = k + 1 < veh.path.length ? veh.path[k + 1] : null;
        const d = base + link.stopLen - hl;
        if (d > -0.05 && !(nx && nx.kind === 'conn' && J.hasGrant(veh, nx))) {
          const dd = Math.max(0, d - 0.3);
          if (dd < hardStop) hardStop = dd;
          const aa = stopAccel(v, dd);
          if (aa < a) {
            a = aa;
            reason = 'menunggu-simpang';
          }
        }
      }
      // lampu lalu lintas di ujung lajur
      if (link.sig) {
        const dLine = base + link.len - hl;
        if (dLine > -0.05) {
          const dWait = base + Math.min(link.len, link.stopLen) - hl;
          const dStop = dWait > -0.05 ? dWait : dLine;
          const ctl = link.sig.ctl;
          const col = ctl.color(link.sig.arm);
          let stop = col === 'red';
          if (col === 'yellow') {
            const lEta = leaderGap < dLine ? (dLine + 2) / Math.max(leaderV, 0.5) : 0;
            const dec = yellowDecision(veh, ctl, link.sig.arm, dWait > -0.05 ? dWait : -1, mu, lEta, dLine);
            if (dec === 'stop') {
              stop = true;
              J.cancelUnused(veh);
            }
          }
          if (stop) {
            const dd = dStop - SHIELD.gapStop - 0.2;
            const aa = stopAccel(v, Math.max(0, dd));
            if (aa < a) {
              a = aa;
              reason = col === 'red' ? 'lampu-merah' : 'lampu-kuning';
              this.sigName = link.name || '';
            }
          }
        }
      }
      // zebra cross yang dipakai
      for (let i = 0; i < link.xings.length; i++) {
        const xg = link.xings[i];
        if (!xg.x.reserved.size) continue;
        const fr = base + xg.s0 - hl;
        if (fr < -0.2) continue;
        const d = fr - SHIELD.gapCrossing - 0.3;
        const aa = stopAccel(v, Math.max(0, d));
        if (aa < a) {
          a = aa;
          reason = 'zebra';
        }
      }
      // halte tujuan (ujung rute)
      if (tgt && link === tgt.link && (k >= 0 || tgt.s >= veh.s - 0.6) && !(veh.route && veh.route.length) && k === veh.path.length - 1) {
        const d = base + tgt.s;
        if (d > -0.6) {
          const aa = stopAccel(v, Math.max(0, d));
          if (aa < a) {
            a = aa;
            reason = 'halte';
          }
          if (d < hardStop) hardStop = Math.max(0, d);
        }
      }
      base += link.len;
      if (base > horizon) break;
      k++;
      link = veh.path[k];
    }
    // penghalang di lajur: rencanakan melewatinya, atau tunggu cukup jauh di belakangnya
    this.passWhy = '';
    if (leaderW && leaderW.obstacle && !this.pass) {
      const ob = leaderW.obstacle;
      if (veh.link === ob.lane && leaderGap < 60) {
        const p = app.passing.plan(veh, ob, 0);
        if (p.ok) {
          const why = app.passing.clearWhy(p);
          if (!why) {
            app.passing.activate(p);
            this.pass = p;
            this.stats.passes++;
          } else this.passWhy = why;
        } else this.passWhy = p.why;
      }
      if (!this.pass) {
        leaderGap -= 10;
        leaderV = 0;
      } else leaderGap = Infinity;
    }
    if (this.pass) {
      const e = app.passing.leaderOn(this.pass, veh, this.lead);
      if (e && e.gap < leaderGap) {
        leaderGap = e.gap;
        leaderV = e.v;
      }
      const s = veh.s;
      if (s < this.pass.sB + 2) blink = this.pass.off > 0 ? 1 : -1;
      else if (s > this.pass.sC - 2) blink = this.pass.off > 0 ? -1 : 1;
    }
    if (leaderGap < Infinity) {
      const aa = idmShuttle(v, v0, leaderGap - 0.4, v - leaderV);
      if (aa < a) {
        a = aa;
        reason = leaderW && leaderW.obstacle && !this.pass ? 'menunggu-lawan' : 'mengikuti';
      }
    }
    if (this.pass && reason === 'melaju') reason = 'menyalip';
    // sein kanan sebentar saat berangkat dari halte
    if (!blink && this.departT > 0) blink = 1;
    this.blink = blink;
    this.reason = reason;
    P.a = a;
    P.hardStop = hardStop;
    P.leaderGap = leaderGap;
    P.leaderV = leaderV;
    return P;
  }

  /** Cari link dan s pada jarak tempuh sig di depan (di jalur rencana). */
  locate(sig, out) {
    const veh = this.veh;
    let L = veh.link;
    let s = veh.s + sig;
    let k = -1;
    while (s > L.len) {
      const nx = veh.path[k + 1];
      if (!nx) {
        s = L.len;
        break;
      }
      s -= L.len;
      k++;
      L = nx;
    }
    out.link = L;
    out.s = s;
    return out;
  }

  /** Pure pursuit di koordinat lajur dengan kelengkungan jalan sebagai umpan maju. */
  steerAuto(dt) {
    const veh = this.veh;
    const v = veh.v;
    const Ld = clamp(3.2 + 0.35 * v, 3.5, 9);
    const T = this.locate(Ld, this.LOC);
    const latT = this.latRefFn(T.link, T.s);
    const alpha = Math.atan2(latT - veh.lat, Ld) - veh.psi;
    const kfb = (2 * Math.sin(alpha)) / Ld;
    const F = this.locate(Math.min(4, 0.4 * v + 0.4), this.LOC);
    const kp = pathCurvature(F.link, F.s);
    const lr = this.latRefFn(F.link, F.s);
    const kff = kp / Math.max(0.3, 1 - kp * lr);
    const kCmd = clamp(kff + kfb, -SH.kMax, SH.kMax);
    const rate = SH.kRate * (v < 2 ? 1.5 : 1);
    veh.kappa = slew(veh.kappa, kCmd, rate, rate, dt);
  }

  /** Hitung keadaan sesudah menempuh dist (tanpa mengubah kendaraan). */
  probe(dist, out) {
    const veh = this.veh;
    let L = veh.link;
    let k = -1;
    let s = veh.s;
    let lat = veh.lat;
    let psi = veh.psi;
    if (dist > 0) {
      const kp = pathCurvature(L, s);
      const denom = Math.max(0.3, 1 - kp * lat);
      const ds = (dist * Math.cos(psi)) / denom;
      lat += dist * Math.sin(psi);
      psi += dist * veh.kappa - kp * ds;
      s += ds;
      while (s > L.len) {
        const nx = veh.path[k + 1];
        if (!nx) {
          s = L.len;
          break;
        }
        s -= L.len;
        k++;
        L = nx;
      }
    }
    const O = L.poly.atSmooth(s, this.T2);
    out.k = k;
    out.link = L;
    out.s = s;
    out.lat = lat;
    out.psi = psi;
    out.x = O.x - Math.sin(O.h) * lat;
    out.z = O.z + Math.cos(O.h) * lat;
    out.h = O.h + psi;
    return out;
  }

  /** Terapkan hasil probe ke kendaraan (geser rencana jalur bila pindah link). */
  commit(nx, dist) {
    const veh = this.veh;
    const app = this.app;
    // pemantau lampu merah: bumper depan melewati garis henti di ujung lajur berlampu
    const front0 = veh.s + SH.hl;
    let sAbs = nx.s;
    for (let i = 0; i <= nx.k; i++) sAbs += i === 0 ? veh.link.len : veh.path[i - 1].len;
    const front1 = sAbs + SH.hl;
    let end = 0;
    for (let j = -1; j < veh.path.length; j++) {
      const L = j < 0 ? veh.link : veh.path[j];
      end += L.len;
      if (end > front1) break;
      if (L.sig && front0 < end) app.invariants.stopLineCrossed(veh, L);
    }
    for (let i = 0; i <= nx.k; i++) {
      const nxt = veh.path.shift();
      veh.pathLen -= nxt.len;
      veh.prevLink = veh.link;
      this.legDriven.push(veh.link);
      veh.link = nxt;
      if (veh.rbExit && nxt === veh.rbExit) veh.rbExit = null;
      this.nav.advance(nxt);
    }
    veh.s = nx.s;
    veh.lat = nx.lat;
    veh.psi = nx.psi;
    veh.x = nx.x;
    veh.z = nx.z;
    veh.h = nx.h;
    veh.odo += dist;
  }

  /**
   * Pemeriksaan geometris jejak baru: menyentuh pejalan kaki (termasuk orang di halte), atau
   * bumper depan melewati garis henti saat lampu merah. Dipakai di kedua mode.
   */
  violates(x, z, h, dist) {
    const c = Math.cos(h);
    const s = Math.sin(h);
    const hl = SH.hl + 0.03;
    const hw = SH.hw + 0.03;
    let bad = false;
    this.app.peds.grid.query(x, z, SH.hl + 2, (p) => {
      if (!bad && boxCircle(x, z, c, s, hl, hw, p.x, p.z, 0.28)) bad = true;
    });
    if (bad) return true;
    for (const w of this.pax.walkers) if (boxCircle(x, z, c, s, hl, hw, w.x, w.z, 0.28)) return true;
    // garis henti (untuk kedua mode, garis selebar jalan di lengan lampu, searah lengan)
    const veh = this.veh;
    const dir = this.mode === 'manual' ? (this.vs < 0 ? -1 : 1) : 1;
    const ox = veh.x + dir * Math.cos(veh.h) * SH.hl;
    const oz = veh.z + dir * Math.sin(veh.h) * SH.hl;
    const nx = x + dir * c * SH.hl;
    const nz = z + dir * s * SH.hl;
    for (const ctl of this.app.signals.list) {
      for (let ai = 0; ai < ctl.arms.length; ai++) {
        if (ctl.color(ai) !== 'red') continue;
        const a = ctl.arms[ai];
        const ux = Math.cos(a.h);
        const uz = Math.sin(a.h);
        const q0 = (ox - a.x) * ux + (oz - a.z) * uz;
        const q1 = (nx - a.x) * ux + (nz - a.z) * uz;
        if (q0 < 0 && q1 >= 0) {
          const lat = -(nx - a.x) * uz + (nz - a.z) * ux;
          const moveDot = dir * (c * ux + s * uz);
          if (Math.abs(lat) <= a.half + SH.hw && moveDot > 0.1) return true;
        }
      }
    }
    void dist;
    return false;
  }

  /** Catat intervensi perisai (tepi naik) dan simpan teksnya untuk panel. */
  noteShield(active, cons, manual) {
    const veh = this.veh;
    if (active && !this.shieldActive) {
      this.stats.interventions++;
      if (manual) {
        this.stats.manualInterventions++;
        this.app.guideEvent('perisai-manual', cons.kind);
      }
      const view = this.consView;
      view.kind = cons.kind;
      view.name = cons.name;
      if (cons.ped) {
        const dx = cons.ped.x - veh.x;
        const dz = cons.ped.z - veh.z;
        view.d = Math.max(0, Math.hypot(dx, dz) - SH.hl);
      } else view.d = Math.max(0, cons.d + SHIELD.gapStop);
      this.app.shieldLog(veh, view);
    }
    this.shieldActive = active;
    if (active) this.shieldT = 1.2;
    else if (this.shieldT > 0) this.shieldT -= 1 / 60;
  }

  // ----- mode manual -----

  /** Nyalakan atau matikan kemudi manual. Mengembalikan { ok, reason }. */
  setManual(on) {
    const app = this.app;
    const veh = this.veh;
    if (on) {
      if (this.mode === 'manual') return { ok: true };
      if (this.state === 'di-halte' && this.door > 0.01) return { ok: false, reason: 'Tunggu sampai pintu tertutup, lalu coba lagi.' };
      this.mode = 'manual';
      veh.manual = true;
      if (this.pass) {
        app.passing.finish(this.pass);
        this.pass = null;
      }
      app.junctions.cancelUnused(veh);
      veh.reqConn = null;
      veh.path.length = 0;
      veh.pathLen = 0;
      veh.route = null;
      this.vs = veh.v;
      this.state = 'manual';
      this.manualStart = veh.odo;
      this.input.up = this.input.down = this.input.left = this.input.right = 0;
      app.toast('Kamu memegang kemudi. Panah atau WASD untuk mengemudi. Perisai keselamatan tetap aktif.');
      return { ok: true };
    }
    if (this.mode !== 'manual') return { ok: true };
    const j = this.findLane();
    if (!j) return { ok: false, reason: 'Arahkan shuttle ke lajur kiri, searah jalan, lalu serahkan lagi ke autopilot.' };
    if (!this.city.halte.some((h) => this.routeTo(j.link, j.s, h))) return { ok: false, reason: 'Dari lajur ini autopilot belum menemukan rute ke halte, misalnya karena jalan buntu. Putar balik dulu, lalu serahkan lagi.' };
    if (Math.abs(this.vs) > 0.2 && this.vs < 0) return { ok: false, reason: 'Hentikan shuttle dulu sebelum menyerahkan kemudi.' };
    this.mode = 'otomatis';
    veh.manual = false;
    veh.link = j.link;
    veh.s = j.s;
    veh.lat = j.lat;
    veh.psi = j.dh;
    veh.path.length = 0;
    veh.pathLen = 0;
    veh.route = [];
    veh.v = Math.max(0, this.vs);
    this.vs = veh.v;
    this.state = 'melaju';
    this.legDriven = [];
    this.planToHalte('kembali');
    app.toast(`Autopilot kembali memegang kemudi dan menuju Halte ${this.target.name}.`);
    return { ok: true };
  }

  /** Lajur (bukan konektor) di bawah shuttle yang searah dengannya, untuk kembali ke autopilot. */
  findLane() {
    const veh = this.veh;
    const PR = this.PR;
    let best = null;
    const C = this.city.gridC;
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const arr = this.city.grid.get(this.city.gridKey(Math.floor(veh.x / C) + di, Math.floor(veh.z / C) + dj));
        if (!arr) continue;
        for (const L of arr) {
          if (L.kind !== 'lane' || L.closed || !L.core) continue;
          L.poly.project(veh.x, veh.z, PR);
          if (PR.s < 1 || PR.s > L.stopLen) continue;
          if (Math.abs(PR.lat) > 1.4) continue;
          const o = L.poly.atSmooth(PR.s, this.T2);
          let dh = veh.h - o.h;
          while (dh > Math.PI) dh -= Math.PI * 2;
          while (dh < -Math.PI) dh += Math.PI * 2;
          if (Math.abs(dh) > 0.5) continue;
          const cost = Math.abs(PR.lat) + 3 * Math.abs(dh);
          if (!best || cost < best.cost) best = { link: L, s: PR.s, lat: PR.lat, dh, cost };
        }
      }
    }
    return best;
  }

  stepManual(dt) {
    const app = this.app;
    const veh = this.veh;
    const mu = app.weather.mu;
    const aB = shuttleBrake(mu);
    const inp = this.input;
    const vs = this.vs;
    const sp = Math.abs(vs);
    const up = inp.up > 0.1;
    const down = inp.down > 0.1;
    // ----- gas dan rem dari masukan -----
    let aDes;
    if (up && !down) aDes = vs < -0.05 ? 3.0 : 1.5 * inp.up;
    else if (down && !up) {
      if (vs > 0.05) aDes = -3.6 * inp.down;
      else {
        this.revHold += dt;
        aDes = this.revHold > 0.35 ? -0.9 : 0;
      }
    } else aDes = vs > 0.05 ? -0.35 : vs < -0.05 ? 0.35 : 0;
    if (!(down && !up)) this.revHold = 0;
    const vmax = Math.min(this.speedLimitKmh / 3.6, SHIELD.vMaxGlobal);
    if (vs > vmax) aDes = Math.min(aDes, -0.8);
    else if (vs > vmax - 0.6 && aDes > 0) aDes = Math.min(aDes, (vmax - vs) * 2);
    if (vs < -SH.vRev) aDes = Math.max(aDes, 0.8);
    else if (vs < -SH.vRev + 0.3 && aDes < 0) aDes = Math.max(aDes, (-SH.vRev - vs) * 2);
    const aPrev = this.aSigned || 0;
    let a = clamp(aDes, aPrev - SH.jFirm * dt, aPrev + SH.jComf * 2.5 * dt);
    // ----- kemudi -----
    const kLim = Math.min(SH.kMax, SH.aLatManual / Math.max(sp * sp, 0.01));
    const kIn = clamp(inp.right - inp.left, -1, 1) * kLim;
    const rate = SH.kRate * 1.3;
    let kCand = clamp(slew(veh.kappa, kIn, rate, rate, dt), -kLim, kLim);
    // ----- arah gerak -----
    const dir = vs > 0.05 ? 1 : vs < -0.05 ? -1 : a < 0 ? -1 : 1;
    const along = dir * a; // positif = makin cepat ke arah gerak
    const horizon = stopDistJerk(sp, Math.max(0, along), aB) + SHIELD.horizonExtra;
    // ----- perisai kemudi: tolak belokan yang membawa shuttle ke batasan yang tidak sempat dihindari -----
    this.shield.buildArc(veh.x, veh.z, veh.h, kCand, dir, horizon);
    let cons = this.shield.scan(veh, mu, { links: false, extraPeople: this.pax.walkers });
    const need = stopDistJerk(sp, Math.max(0, along), aB);
    this.steerOverride = false;
    if (kCand !== veh.kappa && cons.d < need + 0.3) {
      const cCand = { d: cons.d, kind: cons.kind, name: cons.name, ped: cons.ped };
      this.shield.buildArc(veh.x, veh.z, veh.h, veh.kappa, dir, horizon);
      const cPrev = this.shield.scan(veh, mu, { links: false, extraPeople: this.pax.walkers }, this.shield.tmp);
      if (cPrev.d > cCand.d + 0.05) {
        kCand = veh.kappa;
        cons = cPrev;
        this.steerOverride = true;
      } else {
        this.shield.buildArc(veh.x, veh.z, veh.h, kCand, dir, horizon);
        cons = this.shield.scan(veh, mu, { links: false, extraPeople: this.pax.walkers });
      }
    }
    veh.kappa = kCand;
    // ----- perisai gas dan rem -----
    const aLo = Math.max(-aB, along - SH.jEmerg * dt);
    let alongUse = clamp(along, -aB, 3.0);
    let intervene = this.steerOverride;
    if (cons.d < Infinity) {
      const aSafe = maxSafeAccel(sp, cons.d, aB, dt, Math.min(aLo, alongUse), alongUse);
      const aS = aSafe === null ? Math.min(aLo, alongUse) : aSafe;
      if (aS < alongUse - 1e-6) {
        if (aS < alongUse - 0.3 && (aS < 0.5 || along > 0.3)) intervene = true;
        alongUse = aS;
      }
    }
    this.noteShield(intervene && sp + Math.max(0, along) > 0.05, cons, true);
    a = dir * alongUse;
    // ----- gerak -----
    let spNew = sp + alongUse * dt;
    let dist;
    if (spNew <= 0) {
      dist = alongUse < 0 ? Math.min(sp * dt, (sp * sp) / (-2 * alongUse)) : 0;
      spNew = 0;
    } else dist = ((sp + spNew) / 2) * dt;
    if (cons.d < Infinity && dist > Math.max(0, cons.d)) {
      if (dist - Math.max(0, cons.d) > 0.01) this.stats.clamps++;
      dist = Math.max(0, cons.d);
      spNew = 0;
    }
    const hm = veh.h + dir * veh.kappa * dist * 0.5;
    const nx = veh.x + dir * Math.cos(hm) * dist;
    const nz = veh.z + dir * Math.sin(hm) * dist;
    const nh = veh.h + dir * veh.kappa * dist;
    let blocked = false;
    if (dist > 0) {
      if (this.violates(nx, nz, nh, dist)) {
        this.stats.geomBlocks++;
        blocked = true;
      } else if (this.hitsSomething(nx, nz, nh)) blocked = true;
    }
    if (blocked) {
      spNew = 0;
      a = 0;
      dist = 0;
    } else {
      // pemantau lampu merah untuk mode manual (garis selebar jalan)
      this.monitorManualRed(veh.x, veh.z, veh.h, nx, nz, nh, dir);
      veh.x = nx;
      veh.z = nz;
      veh.h = nh;
    }
    this.vs = dir * spNew;
    this.aSigned = a;
    veh.v = spNew;
    veh.a = alongUse;
    veh.odo += dist;
    veh.braking = alongUse < -0.4 || (down && sp < 0.3);
    this.stats.manualDist += dist;
    if (veh.odo - (this.manualStart || 0) > 15) this.app.guideEvent('manual-jalan', 1);
    this.blink = Math.abs(inp.right - inp.left) > 0.1 && sp < 6 ? Math.sign(inp.right - inp.left) : 0;
    this.reason = 'manual';
    // link terdekat (untuk data okupansi dan panel)
    this.snapToLink();
    this.app.junctions.releasePassed(veh);
    veh.stuckT = 0;
  }

  /** Tabrakan dengan kendaraan lain, penghalang, atau tepi jalan (trotoar). */
  hitsSomething(x, z, h) {
    const app = this.app;
    const now = this.collideNow;
    now.clear();
    let hit = false;
    for (const W of app.traffic.cars) {
      const dx = W.x - x;
      const dz = W.z - z;
      if (dx * dx + dz * dz > 100) continue;
      if (boxBox(x, z, h, SH.hl, SH.hw, W.x, W.z, W.h, W.len / 2 - 0.05, W.hw - 0.05)) {
        now.add(W.id);
        hit = true;
      }
    }
    for (const ob of app.obstacles.list) {
      const dx = ob.x - x;
      const dz = ob.z - z;
      if (dx * dx + dz * dz > 150) continue;
      if (boxBox(x, z, h, SH.hl, SH.hw, ob.x, ob.z, ob.h, (ob.s1 - ob.s0) / 2, ob.hw)) {
        now.add(-ob.id);
        hit = true;
      }
    }
    for (const id of now) {
      if (!this.collideSet.has(id)) {
        this.stats.collisions++;
        app.toast('Tabrakan! Shuttle menyentuh kendaraan atau penghalang lain. Perisai hanya menjamin lampu merah dan pejalan kaki.', 'warn');
      }
    }
    const t = this.collideSet;
    this.collideSet = now;
    this.collideNow = t;
    if (hit) return true;
    // trotoar: sudut yang masih di permukaan jalan tidak boleh keluar (sudut yang sudah di luar,
    // misalnya saat menepi di halte, boleh bergerak supaya shuttle bisa menjauh dari tepi)
    if (!(this.offMask(x, z, h) & ~this.offMask(this.veh.x, this.veh.z, this.veh.h))) return false;
    if (app.simTime - this.curbT > 3) {
      this.stats.curb++;
      app.toast('Roda menyentuh trotoar. Shuttle ditahan di tepi jalan. Mundur atau belokkan menjauh.', 'warn');
    }
    this.curbT = app.simTime;
    return true;
  }

  /** Bit sudut badan shuttle yang berada di luar permukaan jalan. */
  offMask(x, z, h) {
    const c = Math.cos(h);
    const s = Math.sin(h);
    let m = 0;
    for (let i = 0; i < 4; i++) {
      const u = i < 2 ? 1 : -1;
      const w = i % 2 ? -1 : 1;
      if (!this.app.city.onRoad(x + c * u * (SH.hl - 0.1) - s * w * (SH.hw - 0.05), z + s * u * (SH.hl - 0.1) + c * w * (SH.hw - 0.05))) m |= 1 << i;
    }
    return m;
  }

  monitorManualRed(x0, z0, h0, x1, z1, h1, dir) {
    const inv = this.app.invariants;
    for (const ctl of this.app.signals.list) {
      for (let ai = 0; ai < ctl.arms.length; ai++) {
        const a = ctl.arms[ai];
        const ux = Math.cos(a.h);
        const uz = Math.sin(a.h);
        const fx0 = x0 + dir * Math.cos(h0) * SH.hl;
        const fz0 = z0 + dir * Math.sin(h0) * SH.hl;
        const fx1 = x1 + dir * Math.cos(h1) * SH.hl;
        const fz1 = z1 + dir * Math.sin(h1) * SH.hl;
        const q0 = (fx0 - a.x) * ux + (fz0 - a.z) * uz;
        const q1 = (fx1 - a.x) * ux + (fz1 - a.z) * uz;
        if (!(q0 < 0 && q1 >= 0)) continue;
        const lat = -(fx1 - a.x) * uz + (fz1 - a.z) * ux;
        if (Math.abs(lat) > a.half + SH.hw) continue;
        if (dir * (Math.cos(h1) * ux + Math.sin(h1) * uz) <= 0.1) continue;
        if (ctl.color(ai) === 'red') {
          inv.redLight++;
          inv.note({ type: 'lampu-merah', veh: this.veh.id, kind: 'shuttle-manual', where: a.name || '' });
        }
      }
    }
  }

  /** Mode manual: tentukan link, s, dan lat terdekat yang searah untuk data okupansi. */
  snapToLink() {
    const veh = this.veh;
    const PR = this.PR;
    let best = null;
    const C = this.city.gridC;
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const arr = this.city.grid.get(this.city.gridKey(Math.floor(veh.x / C) + di, Math.floor(veh.z / C) + dj));
        if (!arr) continue;
        for (const L of arr) {
          L.poly.project(veh.x, veh.z, PR);
          if (PR.s < -1 || PR.s > L.len + 1) continue;
          const o = L.poly.atSmooth(clamp(PR.s, 0, L.len), this.T2);
          let dh = veh.h - o.h;
          while (dh > Math.PI) dh -= Math.PI * 2;
          while (dh < -Math.PI) dh += Math.PI * 2;
          const cost = Math.abs(PR.lat) + 2.5 * Math.abs(dh);
          if (!best || cost < best.cost) best = { L, s: clamp(PR.s, 0, L.len), lat: PR.lat, cost };
        }
      }
    }
    if (best) {
      veh.link = best.L;
      veh.s = best.s;
      veh.lat = best.lat;
    }
  }

  /**
   * Mode manual: daftarkan shuttle di SEMUA link yang dilewati jejaknya, supaya NPC berhenti di
   * belakangnya, pejalan kaki memperhitungkannya, dan persimpangan tidak memberi izin melintasinya.
   */
  registerManual(traffic) {
    const veh = this.veh;
    const c = Math.cos(veh.h);
    const s = Math.sin(veh.h);
    const PR = this.PR;
    const C = this.city.gridC;
    let used = 0;
    const seen = SEEN;
    seen.clear();
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const arr = this.city.grid.get(this.city.gridKey(Math.floor(veh.x / C) + di, Math.floor(veh.z / C) + dj));
        if (!arr) continue;
        for (const L of arr) {
          if (seen.has(L)) continue;
          seen.add(L);
          let smin = Infinity;
          let smax = -Infinity;
          let hit = false;
          const reach = L.width / 2 + 1.1;
          for (const [u, w] of CORNERS5) {
            const px = veh.x + c * u * SH.hl - s * w * SH.hw;
            const pz = veh.z + s * u * SH.hl + c * w * SH.hw;
            L.poly.project(px, pz, PR);
            if (PR.s < smin) smin = PR.s;
            if (PR.s > smax) smax = PR.s;
            if (Math.abs(PR.lat) < reach && PR.s > -1 && PR.s < L.len + 1) hit = true;
          }
          if (!hit) continue;
          let px = this.proxies[used];
          if (!px) {
            px = { id: veh.id, type: 'shuttle', len: SH.len, hw: SH.hw, wid: SH.len, v: 0, dyn: veh.dyn, ego: true, manualProxy: true, grants: [], static: false, x: 0, z: 0, h: 0 };
            this.proxies.push(px);
          }
          used++;
          const ext = Math.max(SH.len, smax - smin);
          px.len = ext;
          px.x = veh.x;
          px.z = veh.z;
          px.h = veh.h;
          const o = L.poly.atSmooth(clamp((smin + smax) / 2, 0, L.len), this.T2);
          const along = this.vs * (Math.cos(veh.h) * Math.cos(o.h) + Math.sin(veh.h) * Math.sin(o.h));
          px.v = Math.max(0, along);
          traffic.occAdd(L, px, (smin + smax) / 2);
        }
      }
    }
  }

  // ----- halte dan penumpang -----

  service(dt) {
    const veh = this.veh;
    if (this.departT > 0) this.departT -= dt;
    if (this.mode === 'manual') {
      this.door = Math.max(0, this.door - dt / DOOR_T);
      return;
    }
    const tgt = this.target;
    if (this.state === 'melaju') {
      if (veh.link === tgt.link && Math.abs(veh.s - tgt.s) < 0.4 && veh.v < 0.03) this.arrive();
    } else if (this.state === 'di-halte') {
      this.dwellT += dt;
      this.phaseT += dt;
      if (this.phase === 'buka') {
        this.door = Math.min(1, this.door + dt / DOOR_T);
        if (this.door >= 1) {
          this.phase = 'naik-turun';
          this.phaseT = 0;
          this.pax.beginStop(this.lastHalte);
        }
      } else if (this.phase === 'naik-turun') {
        const done = this.pax.stepStop(dt);
        if (done && this.dwellT >= MIN_DWELL) {
          this.phase = 'tutup';
          this.phaseT = 0;
          this.pax.endStop();
        }
      } else if (this.phase === 'tutup') {
        this.door = Math.max(0, this.door - dt / DOOR_T);
        if (this.door <= 0) this.depart();
      }
    } else if (this.state === 'tanpa-rute') {
      this.dwellT += dt;
      if (this.dwellT > 3) {
        this.dwellT = 0;
        if (!this.planToHalte('coba-lagi') && this.noRouteT > 3) {
          // halte ini tidak bisa dicapai (jalan ditutup): lewati ke halte berikutnya
          this.stats.skipped++;
          this.app.toast(`Halte ${tgt.name} tidak bisa dicapai. Shuttle lanjut ke halte berikutnya.`, 'warn');
          this.halteIdx = (this.halteIdx + 1) % this.city.halte.length;
          this.noRouteT = 0;
          this.planToHalte('lewati');
        }
      }
    }
  }

  arrive() {
    const veh = this.veh;
    const tgt = this.target;
    this.state = 'di-halte';
    this.phase = 'buka';
    this.phaseT = 0;
    this.dwellT = 0;
    veh.holdAtHalte = true;
    veh.v = 0;
    veh.a = 0;
    this.stats.stops++;
    this.stats.stopErr.push(Math.round((veh.s - tgt.s) * 100) / 100);
    if (this.stats.stopErr.length > 30) this.stats.stopErr.shift();
    this.lastHalte = this.halteIdx;
    this.app.guideEvent('halte', tgt.id);
  }

  depart() {
    const veh = this.veh;
    veh.holdAtHalte = false;
    this.halteIdx = (this.halteIdx + 1) % this.city.halte.length;
    this.state = 'melaju';
    this.phase = '';
    this.legDriven = [];
    this.departT = 2.5;
    this.planToHalte('lanjut');
  }

  // ----- uji pejalan kaki menyeberang -----

  /** Tombol "Pejalan kaki menyeberang". Bila belum aman, permintaan menunggu dan alasannya ditampilkan. */
  requestCrossing() {
    if (this.xingReq) return { ok: false, reason: this.xingReq.reason, waiting: true };
    const r = this.trySpawnCrossing();
    if (r.ok) return r;
    this.xingReq = { t: 0, reason: r.reason, tries: 1 };
    this.app.toast(`Pejalan kaki menunggu: ${XING_WHY[r.reason] || r.reason}.`);
    return { ok: false, reason: r.reason, waiting: true };
  }

  trySpawnCrossing() {
    const peds = this.app.peds;
    if (peds.peds.some((p) => p.test)) return { ok: false, reason: 'tunggu' };
    if (this.state === 'di-halte') return { ok: false, reason: 'halte' };
    const veh = this.veh;
    if (this.mode === 'manual') {
      if (this.vs < -0.05) return { ok: false, reason: 'manual' };
      const j = this.findLane();
      if (!j) return { ok: false, reason: 'manual' };
    }
    const mu = this.app.weather.mu;
    // manual: jarak henti nyaman yang sama dengan penerimaan celah (allowsCrossing), ditambah setengah diagonal zebra
    const stopDist = this.mode === 'manual' ? this.comfortStop(mu) + 5 : stopDistJerk(veh.v, Math.max(0, veh.a), shuttleBrake(mu));
    const r = peds.spawnCrossingAhead(veh, { stopDist, start: this.mode === 'manual' ? this.manualAheadPath() : null });
    if (r.ok) {
      this.app.toast(`Pejalan kaki menyeberang ${fmt(r.dist, 0)} m di depan shuttle. Jarak henti sekarang ${fmt(r.need, 1)} m.`);
      this.lastCrossing = { dist: r.dist, need: r.need, v: veh.v, mu: this.app.weather.mu, t: this.app.simTime };
      this.app.guideEvent('menyeberang', r.dist);
    }
    return r;
  }

  /** Mode manual: jalur lurus di lajur yang searah (dipakai uji pejalan kaki menyeberang). */
  manualAheadPath() {
    const j = this.findLane();
    if (!j) return null;
    return { link: j.link, s: j.s, path: [] };
  }

  stepCrossingRequest(dt) {
    const q = this.xingReq;
    if (!q) return;
    q.t += dt;
    if (q.t < q.tries * 0.5) return;
    q.tries++;
    const r = this.trySpawnCrossing();
    if (r.ok) this.xingReq = null;
    else {
      q.reason = r.reason;
      if (q.t > 25) {
        this.xingReq = null;
        this.app.toast(`Uji pejalan kaki dibatalkan: ${XING_WHY[r.reason] || r.reason}. Coba lagi di jalan lurus.`, 'warn');
      }
    }
  }

  /**
   * Penerimaan celah pejalan kaki terhadap shuttle manual (yang bisa datang dari arah mana saja):
   * zebra cross X hanya boleh dipakai bila shuttle tidak berada di atasnya dan masih bisa berhenti
   * dengan nyaman sebelum mencapainya.
   */
  allowsCrossing(X, mu) {
    if (this.mode !== 'manual') return true;
    const veh = this.veh;
    const xh = X.h + Math.PI / 2;
    if (boxBox(veh.x, veh.z, veh.h, SH.hl + 0.6, SH.hw + 0.6, X.x, X.z, xh, X.len / 2, X.w / 2)) return false;
    if (Math.abs(this.vs) < 0.05 && Math.abs(this.input.up) < 0.1 && Math.abs(this.input.down) < 0.1) return true;
    const D = this.comfortStop(mu);
    const dx = X.x - veh.x;
    const dz = X.z - veh.z;
    const dir = this.vs < -0.05 ? -1 : 1;
    const along = dir * (dx * Math.cos(veh.h) + dz * Math.sin(veh.h));
    if (along < -(X.len / 2 + SH.hl + 1)) return true;
    return Math.hypot(dx, dz) - Math.hypot(X.len / 2, X.w / 2) > D;
  }

  /** Jarak henti nyaman shuttle manual dari pusatnya (reaksi 0,8 detik, perlambatan nyaman). */
  comfortStop(mu) {
    const sp = Math.abs(this.vs);
    return sp * 0.8 + (sp * sp) / (2 * Math.min(SHIELD.aComfort, 0.5 * shuttleBrake(mu))) + SH.hl + 4;
  }

  // ----- teks untuk panel -----

  statusText() {
    if (this.mode === 'manual') return 'Kamu yang mengemudi';
    const H = this.city.halte;
    if (this.state === 'di-halte') {
      const here = H[this.lastHalte].name;
      if (this.phase === 'buka') return `Berhenti di Halte ${here}, pintu membuka`;
      if (this.phase === 'tutup') return `Pintu menutup, siap menuju Halte ${this.target.name}`;
      const st = this.pax.stop;
      if (st && st.phase === 'turun') return `Berhenti di Halte ${here}, penumpang turun`;
      return `Berhenti di Halte ${here}, penumpang naik`;
    }
    if (this.state === 'tanpa-rute') return `Mencari rute ke Halte ${this.target.name}`;
    return `Menuju Halte ${this.target.name}`;
  }

  reasonText() {
    if (this.mode === 'manual') return 'Kamu yang mengemudi. Perisai keselamatan tetap mengawasi.';
    let t = REASON_TEXT[this.reason] || this.reason;
    if ((this.reason === 'lampu-merah' || this.reason === 'lampu-kuning') && this.sigName) t += ` di ${this.sigName}`;
    return t;
  }

  /** Alasan batas kecepatan cuaca, dengan angka jarak henti. */
  weatherNote() {
    const w = this.app.weather;
    const lim = this.speedLimitKmh;
    const cap = WEATHER_CAP[w.name];
    const v = Math.min(lim, cap) / 3.6;
    const dDry = stopDistJerk(v, 0, shuttleBrake(0.8)) + v * 0.5;
    const dNow = stopDistJerk(v, 0, shuttleBrake(w.mu)) + v * 0.5;
    const rng = w.sensorRange();
    const kept = cap < lim ? ` Shuttle membatasi diri ${cap} km/jam.` : '';
    if (w.name === 'hujan') return `Jalan basah, gesekan turun dari 0,8 menjadi ${fmt(w.mu, 1)}. Pada ${fmt(v * 3.6, 0)} km/jam jarak henti naik dari ${fmt(dDry, 1)} m menjadi ${fmt(dNow, 1)} m.${kept}`;
    if (w.name === 'kabut') return `Kabut memperpendek jarak pandang: kamera sekitar ${fmt(70 * rng.kamera, 0)} m, LiDAR sekitar ${fmt(50 * rng.lidar, 0)} m. Radar tetap tembus kabut.${kept}`;
    if (w.name === 'malam') return `Malam: kamera kurang peka di luar sorot lampu, LiDAR dan radar tetap bekerja. Lampu shuttle menyala.${kept}`;
    return `Cuaca cerah, jalan kering. Sensor bekerja penuh dan shuttle memakai batas kecepatan ${lim} km/jam.`;
  }

  // ----- tampilan -----

  sync(pose, dtReal, simDt, night) {
    const veh = this.veh;
    const steer = Math.atan(SH.wheelbase * veh.kappa);
    const st = SYNCST;
    st.x = pose.x;
    st.z = pose.z;
    st.h = pose.h;
    st.v = Math.abs(this.vs);
    st.steer = steer;
    st.braking = veh.braking;
    st.night = night;
    st.dtReal = dtReal;
    st.simDt = simDt;
    st.blink = this.blink;
    st.door = this.door;
    this.model.update(st);
    this.model.setPassengers(this.pax.onboard.length);
    const dest = this.mode === 'manual' ? 'Mode manual' : this.state === 'di-halte' && this.phase !== 'tutup' ? this.city.halte[this.lastHalte].name : this.target.name;
    this.model.setDestination(dest);
    this.pax.sync(this.app.renderAlpha || 1);
  }

  /** Ringkasan untuk window.__sim3d. */
  snapshot() {
    const veh = this.veh;
    return {
      x: veh.x,
      z: veh.z,
      heading: veh.h,
      speedKmh: veh.v * 3.6,
      speedSigned: this.vs * 3.6,
      accel: veh.a,
      steerDeg: (Math.atan(SH.wheelbase * veh.kappa) * 180) / Math.PI,
      lat: veh.lat,
      mode: this.mode,
      state: this.state,
      phase: this.phase,
      reason: this.reason,
      reasonText: this.reasonText(),
      nextHalte: this.target ? this.target.name : null,
      halteIdx: this.halteIdx,
      remaining: this.remaining(),
      link: veh.link.id,
      replans: this.replans,
      speedLimit: this.speedLimitKmh,
      cruiseKmh: this.cruiseSpeed() * 3.6,
      door: this.door,
      passengers: this.pax.onboard.length,
      waiting: this.pax.waiting.map((w) => w.length),
      boarded: this.pax.stats.boarded,
      alighted: this.pax.stats.alighted,
      passing: this.pass ? { kind: this.pass.kind, sA: this.pass.sA, sD: this.pass.sD } : null,
      passWhy: this.passWhy,
      shieldActive: this.shieldActive,
      steerOverride: this.steerOverride,
      crossingWait: this.xingReq ? this.xingReq.reason : null,
      lastCrossing: this.lastCrossing || null,
      weatherNote: this.weatherNote(),
      stats: { ...this.stats, stopErr: this.stats.stopErr.slice(-10) },
    };
  }
}

const CORNERS5 = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
  [0, 0],
];
const SEEN = new Set();
const SYNCST = { x: 0, z: 0, h: 0, v: 0, steer: 0, braking: false, night: false, dtReal: 0, simDt: 0, blink: 0, door: 0 };
