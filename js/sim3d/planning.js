// Perencanaan: rute A* di graf lajur, pemilihan lajur, menyalip rintangan diam,
// keputusan di lampu lalu lintas, jalur lokal untuk beberapa detik ke depan,
// dan target percepatan (model IDM) beserta rem darurat otomatis (AEB).
//
// Gerak menyamping direncanakan sebagai "manuver" pindah lajur dengan titik mulai dan
// panjang yang tetap setelah dimulai. Manuver baru hanya dimulai bila lajur tujuan aman
// dan ruangnya cukup pada kecepatan sekarang. Kalau belum, mobil tetap di lajurnya.
import * as THREE from '../vendor/three.bundle.min.js';
import { findRoute, routeItems, segPoint, segProject, MOVE_TEXT } from './roadgraph.js';
import { idmAccel } from './traffic.js';
import { CLASSES, STATIC_CLASSES, footGap } from './perception.js';
import { EGO } from './ego.js';
import { clamp, fmt, kmh, smooth } from './util.js';

const EGO_IDM = { a: 1.8, b: 2.6, s0: 3.2, T: 1.5 };
// Di belakang benda diam mobil berhenti lebih jauh supaya masih ada ruang untuk berbelok keluar.
const EGO_IDM_STATIC = { a: 1.8, b: 2.6, s0: 14, T: 1.0 };
/** Perlambatan nyaman menjelang tikungan (m/s²). */
const TURN_B = 1.3;
/**
 * Panjang manuver pindah lajur: makin cepat makin panjang (sekitar 2,5 detik perjalanan).
 * Minimal 12 m supaya belokannya landai dan mobil tidak jauh menyimpang dari rencana.
 */
const dlc = (v) => clamp(v * 2.5, 12, 32);
/** Tahan tampilan perilaku sebentar supaya label tidak berkedip saat keputusan bolak-balik. */
const BEH_HOLD = 0.7;
const LANE = 3.5;
const PATH_DS = 1.5;
const PATH_H = 110;
const MAX_PATH = Math.ceil(PATH_H / PATH_DS) + 4;

export class Planner {
  constructor(app) {
    this.app = app;
    this.route = null;
    this.path = [];
    for (let i = 0; i < MAX_PATH; i++) this.path.push({ x: 0, z: 0, h: 0, ri: 0, s: 0, lat: 0, d: 0 });
    this.pathN = 0;
    this.overtake = null;
    this.ovUid = 1;
    this.behavior = 'Melaju';
    this.reason = '';
    this.limiter = 'Tidak ada';
    this.ttc = Infinity;
    this.aeb = false;
    this.aebHold = 0;
    this.manualBrakeT = 0;
    this.aDes = 0;
    this.kNow = 0;
    this.inTransition = false;
    this.commitNode = -1;
    this.laneText = 'Lajur kiri';
    this.laneWhy = '';
    this.routeText = '';
    this.deviation = 0;
    this.lastReloc = -10;
    this.tmp = {};
    this.tmp2 = {};
    this.inPath = [];
    this.dlcNow = 8;
    this.active = null; // manuver yang sedang berjalan
    this.evs = []; // manuver yang direncanakan pada ruas target
    this.doneIds = new Set();
    this.latCtx = null;
    this.held = null; // manuver yang ditahan: { kind, why: 'gate'|'ruang' }
    this.backup = null; // mundur sedikit supaya ada ruang untuk menyalip
    this.buildVisuals();
  }

  // ===== rute =====

  chooseDest(fromSeg) {
    const { app } = this;
    const segs = app.graph.segs;
    for (let i = 0; i < 60; i++) {
      const s = segs[Math.floor(app.rng() * segs.length)];
      if (s === fromSeg || app.closedSegs.has(s.id)) continue;
      const mx = (s.a.x + s.b.x) / 2;
      const mz = (s.a.z + s.b.z) / 2;
      const d = Math.hypot(mx - app.ego.x, mz - app.ego.z);
      if (d > 150 && d < 360) return s;
    }
    return segs[(segs.indexOf(fromSeg) + 7) % segs.length];
  }

  /** Hitung rute dari lajur tertentu. lockLane = jangan pindah lajur di ruas awal. */
  planFrom(lane, s, opts = {}) {
    const { app } = this;
    let dest = opts.keepDest && this.route ? this.route.dest : null;
    let res = null;
    const fromSeg = lane.seg || lane.toLane.seg;
    for (let tries = 0; tries < 8 && !res; tries++) {
      // tujuan baru bila belum ada, bila percobaan sebelumnya gagal, atau bila ruas tujuan ditutup
      if (!dest || tries > 0 || app.closedSegs.has(dest.seg.id)) dest = { seg: this.chooseDest(fromSeg), s: 38 };
      res = findRoute(app.graph, lane, s, dest.seg, dest.s, { lockLane: opts.lockLane, closed: app.closedSegs });
    }
    if (!res) return false;
    const items = routeItems(res.lanes);
    const oldItems = this.route ? this.route.items : null;
    this.route = { items, ri: 0, s, lat: 0, dest, expanded: res.expanded, cost: res.cost };
    // Manuver dan rencana menyalip di ruas yang sama tetap dipertahankan.
    const first = items[0];
    const keepActive = this.active && first.type === 'road' && this.active.seg === first.seg;
    this.active = keepActive ? { ...this.active, ri: 0 } : null;
    const ov = this.overtake;
    const ovItem = ov && oldItems ? oldItems[ov.ri] : null;
    const keepOv = ov && ovItem && ovItem.type === 'road' && first.type === 'road' && ovItem.seg === first.seg;
    this.overtake = keepOv ? { ...ov, ri: 0, noBack: first.kEnd === ov.passK && ov.sOut > first.len - 60 } : null;
    const keepIds = keepOv ? [...this.doneIds].filter((id) => id.endsWith(`:${ov.uid}`)) : [];
    this.backup = null;
    this.evs = [];
    this.doneIds.clear();
    for (const id of keepIds) this.doneIds.add(id);
    this.replans = (this.replans || 0) + 1;
    this.track();
    return true;
  }

  /** Ada ruas yang ditutup: bila rute di depan melewatinya, hitung ulang rute. */
  onClosures() {
    const r = this.route;
    if (!r || !this.app.autopilot) return;
    const closed = this.app.closedSegs;
    let hit = false;
    for (let i = r.ri + 1; i < r.items.length; i++) {
      const it = r.items[i];
      if (it.type === 'road' && closed.has(it.seg.id)) hit = true;
    }
    if (!hit) return;
    const it = r.items[r.ri];
    // Di persimpangan tunggu sampai keluar; rute dihitung lagi pada pemeriksaan berikutnya.
    if (it.type !== 'road') {
      this.pendingClosure = true;
      return;
    }
    if (this.planFrom(it.seg.lanes[this.kNow], r.s, { keepDest: true, lockLane: this.inTransition })) {
      this.app.toast('Jalan di depan tertutup rintangan di kedua lajur. Rute dihitung ulang.', 'warn');
    }
  }

  /** Cari lajur terdekat yang arahnya cocok dengan mobil (dipakai saat mulai atau keluar rute). */
  relocate() {
    const { app } = this;
    const e = app.ego;
    let best = null;
    let bd = Infinity;
    const pr = this.tmp;
    for (const lane of app.graph.lanes) {
      lane.poly.project(e.x, e.z, pr);
      if (pr.s < -2 || pr.s > lane.len + 2) continue;
      const p = lane.poly.at(clamp(pr.s, 0, lane.len), this.tmp2);
      const dh = Math.abs(Math.atan2(Math.sin(p.h - e.h), Math.cos(p.h - e.h)));
      const cost = pr.d2 + dh * dh * 60;
      if (dh < 1.3 && cost < bd) {
        bd = cost;
        best = { lane, s: clamp(pr.s, 0, lane.len), d2: pr.d2 };
      }
    }
    if (!best) return false;
    this.lastReloc = app.simTime;
    this.active = null;
    return this.planFrom(best.lane, best.s) ? best : false;
  }

  /** Perbarui posisi mobil pada rute (item ke berapa, s, dan lat). */
  track() {
    const r = this.route;
    if (!r) return;
    const e = this.app.ego;
    const pr = this.tmp;
    for (let guard = 0; guard < 4; guard++) {
      const it = r.items[r.ri];
      if (it.type === 'road') {
        segProject(it.seg, e.x, e.z, pr);
        r.s = pr.s;
        r.lat = pr.lat;
      } else {
        it.lane.poly.project(e.x, e.z, pr);
        r.s = pr.s;
        r.lat = pr.lat;
      }
      if (r.s > it.len && r.ri < r.items.length - 1) {
        const prev = it;
        r.ri++;
        if (prev.type === 'road' && prev.seg.b.signalized) {
          this.app.signals.recordWait(e.waitT);
          e.waitT = 0;
        }
        if (r.items[r.ri].type === 'road') this.commitNode = -1;
        continue;
      }
      break;
    }
    const it = r.items[r.ri];
    if (it.type === 'road') {
      this.kNow = r.lat > LANE / 2 ? 1 : 0;
      const off = r.lat - this.kNow * LANE;
      this.inTransition = Math.abs(off) > 0.45;
      this.deviation = r.lat < -0.2 ? -r.lat : r.lat > LANE + 0.2 ? r.lat - LANE : 0;
    } else {
      this.kNow = it.lane.k;
      this.inTransition = false;
      this.deviation = Math.abs(r.lat);
    }
  }

  /** Ego terdaftar di lajur mana (untuk NPC dan hitungan persimpangan). */
  egoLanes() {
    const r = this.route;
    if (!r) return [];
    const it = r.items[r.ri];
    if (it.type === 'conn') return [{ lane: it.lane, s: r.s }];
    const out = [];
    if (r.lat < LANE - 0.9) out.push({ lane: it.seg.lanes[0], s: r.s });
    if (r.lat > 0.9) out.push({ lane: it.seg.lanes[1], s: r.s });
    if (!out.length) out.push({ lane: it.seg.lanes[this.kNow], s: r.s });
    return out;
  }

  // ===== lateral =====

  /**
   * Aman pindah ke lajur targetLat? Memakai objek hasil persepsi, bukan data asli.
   * staticReach: benda diam di lajur tujuan yang lebih dekat dari jarak ini dianggap menutup
   * (dipakai saat kembali ke lajur asal, supaya mobil tidak masuk ke depan rintangan berikutnya).
   */
  laneClear(it, sEgo, targetLat, sUntil, ignoreBehindS = -Infinity, staticReach = 0) {
    const { app } = this;
    const e = app.ego;
    const v = Math.max(0, e.v);
    const pr = this.tmp2;
    for (const t of app.perception.list) {
      if (t.cls === 'pejalan' || (t.ref && t.ref.removed)) continue;
      const dx = t.px - e.x;
      const dz = t.pz - e.z;
      if (dx * dx + dz * dz > 80 * 80) continue;
      segProject(it.seg, t.px, t.pz, pr);
      if (pr.s < -45 || pr.s > it.len + 25) continue;
      if (pr.s < ignoreBehindS) continue; // terhalang rintangan yang baru disalip, tidak bisa menyusul
      if (Math.abs(pr.lat - targetLat) > 2.4) continue;
      const vAlong = t.vx * it.seg.dx + t.vz * it.seg.dz;
      if (!STATIC_CLASSES.has(t.cls) && vAlong < -1) continue; // arah berlawanan, bukan lajur ini
      const ds = pr.s - sEgo;
      if (staticReach > 0 && t.known && STATIC_CLASSES.has(t.cls) && ds >= 0 && ds - t.hl < staticReach) return false;
      const still = STATIC_CLASSES.has(t.cls) || Math.abs(vAlong) < 0.5;
      if (ds < 0 && still) {
        if (-ds < t.hl + EGO.len / 2 + 1.5) return false;
        continue;
      }
      if (ds >= 0) {
        if (ds < 8 + t.hl + Math.max(0, v - vAlong) * 2.2) return false;
        if (sUntil !== undefined && pr.s < sUntil && vAlong < v - 1.5) return false;
      } else if (-ds < 7 + t.hl + Math.max(0, vAlong - v) * 2.5 + Math.max(0, vAlong) * 0.6) return false;
    }
    return true;
  }

  /** Tidak ada objek di belakang mobil pada lajur ini sejauh dist meter (untuk mundur). */
  rearClear(it, sEgo, laneLat, dist) {
    const pr = this.tmp2;
    for (const t of this.app.perception.list) {
      segProject(it.seg, t.px, t.pz, pr);
      if (Math.abs(pr.lat - laneLat) > 2.4) continue;
      const behind = sEgo - pr.s;
      if (behind > 0 && behind < dist + EGO.len / 2 + t.hl) return false;
    }
    return true;
  }

  /** Ruas jalan tempat manuver direncanakan: ruas sekarang, atau ruas berikutnya saat di persimpangan. */
  lateralContext() {
    const r = this.route;
    const cur = r.items[r.ri];
    if (cur.type === 'road') return { ri: r.ri, it: cur, sRef: r.s, laneNow: this.kNow };
    const nx = r.items[r.ri + 1];
    if (!nx || nx.type !== 'road') return null;
    return { ri: r.ri + 1, it: nx, sRef: -(cur.len - r.s), laneNow: cur.lane.toLane.k };
  }

  dbgOv(why, ov) {
    const r = this.route;
    this.app.logDebug({ t: Math.round(this.app.simTime * 10) / 10, type: `salip-${why}`, uid: ov.uid, ri: ov.ri, rri: r.ri, s: Math.round(r.s), lat: Math.round(r.lat * 10) / 10, counted: ov.counted, sPassed: Math.round(ov.sPassed) });
  }

  /** Benda diam yang sudah dikenali dan masih ada di jalan. */
  staticTrack(t) {
    return STATIC_CLASSES.has(t.cls) && t.known && !(t.ref && t.ref.removed);
  }

  /**
   * Lajur untuk menyalip tertutup benda diam? Jendela yang sama dipakai saat membuat dan saat
   * membatalkan rencana, supaya rencana tidak dibuat lalu dibatalkan bergantian.
   */
  passLaneBlocked(it, passLat, sFirst, sOut, ids) {
    const pr = this.tmp2;
    for (const t of this.app.perception.list) {
      if (!this.staticTrack(t) || (ids && ids.includes(t.id))) continue;
      segProject(it.seg, t.px, t.pz, pr);
      if (Math.abs(pr.lat - passLat) < 1.4 && pr.s > sFirst - 14 && pr.s < sOut + 12) return true;
    }
    return false;
  }

  /** Ada benda diam yang dikenali di lajur lat antara sFrom dan sTo (yang di belakang skipBehind diabaikan)? */
  staticInLane(it, lat, sFrom, sTo, skipBehind = -Infinity) {
    const pr = this.tmp2;
    for (const t of this.app.perception.list) {
      if (!this.staticTrack(t)) continue;
      segProject(it.seg, t.px, t.pz, pr);
      if (Math.abs(pr.lat - lat) >= 1.4 || pr.s < skipBehind) continue;
      if (pr.s + t.hl > sFrom && pr.s - t.hl < sTo) return true;
    }
    return false;
  }

  /** Ruang yang harus bebas benda diam di lajur asal setelah titik kembali. */
  returnReach() {
    return this.dlcNow + EGO_IDM_STATIC.s0 + EGO.len + 4;
  }

  /**
   * Gabungkan benda diam lain di lajur asal yang terlalu dekat dengan titik kembali ke rencana
   * menyalip yang sedang berjalan. Mobil lalu tetap di lajur sebelah sampai semuanya terlewati.
   */
  absorb(ov, ctx) {
    if (ov.counted && this.doneIds.has(`kembali:${ov.uid}`)) return false;
    const pr = this.tmp2;
    const fromLat = ov.fromK * LANE;
    let merged = false;
    for (let pass = 0; pass < 4; pass++) {
      let any = false;
      const reach = ov.sOut + this.returnReach();
      for (const t of this.app.perception.list) {
        if (!this.staticTrack(t) || ov.ids.includes(t.id)) continue;
        segProject(ctx.it.seg, t.px, t.pz, pr);
        if (Math.abs(pr.lat - fromLat) >= 1.4 || pr.s < ov.sEnd || pr.s - t.hl > reach || pr.s > ctx.it.len + 2) continue;
        ov.ids.push(t.id);
        ov.sPassed = Math.max(ov.sPassed, pr.s + t.hl);
        ov.sOut = Math.max(ov.sOut, pr.s + t.hl + EGO.len / 2 + 3);
        any = merged = true;
      }
      if (!any) break;
    }
    if (merged) {
      ov.noBack = ctx.it.kEnd === ov.passK && ov.sOut > ctx.it.len - 60;
      this.dbgOv('gabung', ov);
    }
    return merged;
  }

  /** Batalkan manuver kembali yang sedang berjalan dan pindah lagi ke lajur untuk menyalip. */
  abortReturn(ov, ctx) {
    const r = this.route;
    if (!this.active || ctx.ri !== r.ri || !this.app.autopilot) return false;
    if (!this.laneClear(ctx.it, ctx.sRef, ov.passLat, ov.sOut)) return false;
    this.active = { id: `balik:${ov.uid}:${this.ovUid++}`, kind: 'salip', ri: ctx.ri, seg: ctx.it.seg, lane: ov.passK, from: r.lat, start: ctx.sRef, len: Math.max(8, this.dlcNow * 0.8) };
    this.dbgOv('batal-kembali', ov);
    return true;
  }

  /** Cari rintangan diam di lajur mobil dan siapkan rencana menyalip. */
  detectOvertake(ctx) {
    const { app } = this;
    const pr = this.tmp2;
    const ov = this.overtake;
    const r = this.route;
    if (ov) {
      const alive = ov.ids.some((id) => app.scen.obstacles.some((o) => o.id === id));
      if (!alive && !ov.counted) {
        this.dbgOv('hilang', ov);
        this.overtake = null;
        this.bothBlocked = false;
        return;
      }
      if (ov.ri === r.ri && !ov.counted && r.s - EGO.len / 2 > ov.sPassed && Math.abs(r.lat - ov.passLat) < 1.3) {
        ov.counted = true;
        app.counters.overtakes++;
        app.toast(`Berhasil menyalip ${CLASSES[ov.cls].label.toLowerCase()}.`, 'ok');
      }
      const backDone = this.doneIds.has(`kembali:${ov.uid}`) || ov.noBack;
      if (r.ri > ov.ri || (ov.counted && backDone && r.ri === ov.ri && r.s > ov.sOut)) {
        this.dbgOv('selesai', ov);
        this.overtake = null;
        this.bothBlocked = false;
        return;
      }
      ov.passBlocked = false;
      if (ov.ri === ctx.ri) {
        // Rintangan berikutnya di lajur asal terlalu dekat dengan titik kembali: gabungkan.
        const merged = this.absorb(ov, ctx);
        if (merged && this.active && this.active.id === `kembali:${ov.uid}`) this.abortReturn(ov, ctx);
        // Lajur untuk menyalip ternyata juga tertutup benda diam?
        ov.passBlocked = this.passLaneBlocked(ctx.it, ov.passLat, ov.sFirst, ov.sOut, ov.ids);
      }
      this.bothBlocked = ov.passBlocked;
      const started = (this.active && this.active.id === `salip:${ov.uid}`) || this.doneIds.has(`salip:${ov.uid}`);
      if (ov.passBlocked && !started && !ov.counted) {
        this.dbgOv('tertutup', ov);
        this.overtake = null;
      }
      return;
    }
    this.bothBlocked = false;
    const { it, sRef, ri } = ctx;
    const laneAt = this.active && this.active.ri === ri ? this.active.lane : ctx.laneNow;
    const myLat = laneAt * LANE;
    let first = null;
    let fs = Infinity;
    const statics = [];
    for (const t of app.perception.list) {
      if (!this.staticTrack(t)) continue;
      segProject(it.seg, t.px, t.pz, pr);
      if (pr.s < sRef - 2 || pr.s > it.len + 2 || Math.abs(pr.lat - LANE / 2) > 4.5) continue;
      statics.push({ t, s: pr.s, lat: pr.lat });
      const ds = pr.s - sRef;
      if (ds > 2 && ds < 70 && Math.abs(pr.lat - myLat) < 1.4 && pr.s < fs) {
        fs = pr.s;
        first = { t, s: pr.s };
      }
    }
    if (!first) return;
    const passK = laneAt === 0 ? 1 : 0;
    const passLat = passK * LANE;
    let sLast = first.s;
    const ids = [first.t.id];
    let halfMax = first.t.hl;
    for (const o of statics) {
      if (o.t === first.t) continue;
      if (Math.abs(o.lat - myLat) < 1.4 && o.s > first.s && o.s < sLast + 20) {
        sLast = Math.max(sLast, o.s);
        ids.push(o.t.id);
        halfMax = Math.max(halfMax, o.t.hl);
      }
    }
    const ov2 = {
      uid: this.ovUid++,
      ri,
      ids,
      cls: first.t.cls,
      fromK: laneAt,
      passK,
      passLat,
      sFirst: first.s,
      // lajur sebelah harus sudah dicapai sebelum bumper depan sampai di belakang rintangan
      sEnd: first.s - halfMax - EGO.len / 2 - 1.2,
      sOut: sLast + halfMax + EGO.len / 2 + 3,
      sPassed: sLast + halfMax,
      counted: false,
    };
    this.absorb(ov2, ctx);
    // bila lajur sebelah memang lajur yang dibutuhkan di ujung ruas, tidak perlu kembali
    ov2.noBack = it.kEnd === passK && ov2.sOut > it.len - 60;
    // kedua lajur tertutup: tidak bisa menyalip
    if (this.passLaneBlocked(it, passLat, ov2.sFirst, ov2.sOut, ov2.ids)) {
      this.bothBlocked = true;
      return;
    }
    this.overtake = ov2;
  }

  /** Susun daftar manuver pada ruas target, lalu jadwalkan (dengan gerbang keamanan dan cek ruang). */
  scheduleLateral(dt = 1 / 60) {
    const { app } = this;
    const e = app.ego;
    const v = Math.max(0, e.v);
    const ctx = this.lateralContext();
    this.latCtx = ctx;
    this.held = null;
    if (!ctx) {
      this.evs = [];
      return;
    }
    const { it, ri, sRef } = ctx;
    // manuver aktif selesai?
    const A = this.active;
    if (A && (A.ri < ri || (A.ri === ri && sRef > A.start + A.len))) {
      this.doneIds.add(A.id);
      this.active = null;
    }
    if (app.autopilot) this.detectOvertake(ctx);
    // Pengaman terakhir: manuver kembali macet di belakang benda diam (misalnya benda baru
    // terlihat saat manuver sudah berjalan). Pindah lagi ke lajur sebelah, atau akhiri manuvernya
    // supaya rencana menyalip yang baru bisa dibuat.
    const B = this.binding;
    const stuckReturn = this.active && this.active.kind === 'kembali' && v < 0.3 && app.autopilot && B && B.kind === 'objek' && B.o.isStatic && !this.aeb;
    this.stuckRetT = stuckReturn ? (this.stuckRetT || 0) + dt : 0;
    if (this.stuckRetT > 2.5) {
      this.stuckRetT = 0;
      const ovS = this.overtake && this.overtake.ri === ri ? this.overtake : null;
      if (!(ovS && this.abortReturn(ovS, ctx))) {
        this.doneIds.add(this.active.id);
        this.active = null;
      }
    }
    // daftar manuver (belum selesai, belum aktif)
    const list = [];
    const ov = this.overtake && this.overtake.ri === ri ? this.overtake : null;
    if (ov) {
      list.push({ id: `salip:${ov.uid}`, kind: 'salip', lane: ov.passK, sc: ov.sEnd - this.dlcNow, deadline: ov.sEnd });
      if (!ov.noBack) list.push({ id: `kembali:${ov.uid}`, kind: 'kembali', lane: ov.fromK, sc: ov.sOut, endBy: it.len - 4 });
    }
    // lajur yang dibutuhkan di ujung ruas (untuk gerakan di persimpangan berikutnya)
    let laneAfter = this.active ? this.active.lane : ctx.laneNow;
    for (const ev of list) if (!this.doneIds.has(ev.id) && (!this.active || this.active.id !== ev.id)) laneAfter = ev.lane;
    if (laneAfter !== it.kEnd) {
      const toRight = it.kEnd === 1;
      list.push({ id: `rute:${ri}:${it.kEnd}`, kind: toRight ? 'belok' : 'kiri', lane: it.kEnd, sc: toRight ? it.len - 50 : 3, endBy: it.len - 6 });
    }
    let evs = list.filter((ev) => !this.doneIds.has(ev.id) && !(this.active && this.active.id === ev.id));
    evs.sort((a, b) => a.sc - b.sc);
    // pasangan manuver yang saling membatalkan (kembali ke kiri lalu segera ke kanan lagi)
    let lane = this.active ? this.active.lane : ctx.laneNow;
    const kept = [];
    for (let i = 0; i < evs.length; i++) {
      const ev = evs[i];
      if (ev.lane === lane) continue;
      const nx = evs[i + 1];
      if (nx && ev.kind !== 'salip' && nx.lane === lane && nx.sc - ev.sc < this.dlcNow + 14) {
        i++;
        continue;
      }
      kept.push(ev);
      lane = ev.lane;
    }
    evs = kept;
    // penjadwalan
    const look = 6 + Math.max(4, v * 0.9);
    let cursor = this.active ? this.active.start + this.active.len + 2 : sRef + 0.3;
    lane = this.active ? this.active.lane : ctx.laneNow;
    let blocked = false;
    for (let i = 0; i < evs.length; i++) {
      const ev = evs[i];
      ev.from = lane * LANE;
      ev.len = this.dlcNow;
      ev.start = blocked ? Infinity : Math.max(ev.sc, cursor);
      // Manuver ke lajur yang di depannya ada benda diam belum bisa dijadwalkan. Jalur rencana tetap
      // lurus, jadi mobil tidak mengerem untuk benda yang sebenarnya tidak akan dilalui.
      if (Number.isFinite(ev.start) && ev.kind !== 'salip') {
        const skipBehind = ev.kind === 'kembali' && ov ? ov.sPassed : -Infinity;
        if (this.staticInLane(it, ev.lane * LANE, ev.start - 2, ev.start + ev.len + this.returnReach(), skipBehind)) {
          if (i === 0 && !this.active) this.held = { kind: ev.kind, why: 'gate', lane: ev.lane };
          ev.start = Infinity;
        }
      }
      if (!blocked && Number.isFinite(ev.start) && i === 0 && !this.active && ev.start <= sRef + look) {
        const feasible = (ev.deadline === undefined || ev.start + ev.len <= ev.deadline + 0.05) && (ev.endBy === undefined || ev.start + ev.len <= ev.endBy);
        const until = ev.kind === 'salip' && ov ? ov.sOut : undefined;
        const ignore = ev.kind === 'kembali' && ov ? ov.sPassed : -Infinity;
        // Kembali hanya bila lajur asal di depan cukup lega dari benda diam berikutnya.
        const reach = ev.kind === 'kembali' ? this.returnReach() : 0;
        const clear = feasible && app.autopilot ? this.laneClear(it, sRef, ev.lane * LANE, until, ignore, reach) : false;
        if (!feasible || !clear) {
          this.held = { kind: ev.kind, why: feasible ? 'gate' : 'ruang', lane: ev.lane };
          ev.start = Infinity;
          blocked = true;
          // Sudah berhenti tetapi terlalu dekat dengan rintangan: mundur sedikit bila belakang kosong.
          if (!feasible && ev.kind === 'salip' && ov && v < 0.2 && ctx.ri === this.route.ri && !this.backup && app.autopilot) {
            const need = dlc(0) + 0.6 - (ov.sEnd - sRef);
            if (need > 0.2 && this.rearClear(it, sRef, ctx.laneNow * LANE, need + 6)) this.backup = { until: sRef - need - 0.4, t: app.simTime };
          }
        } else if (sRef >= ev.start - 0.3 && ctx.ri === this.route.ri) {
          // mulai: titik mulai dan panjang dikunci
          this.active = { id: ev.id, kind: ev.kind, ri, seg: it.seg, lane: ev.lane, from: ev.from, start: ev.start, len: ev.len };
          evs.splice(i, 1);
          i--;
          cursor = this.active.start + this.active.len + 2;
          lane = this.active.lane;
          continue;
        }
      }
      if (ev.start === Infinity) blocked = true;
      else {
        cursor = ev.start + ev.len + 2;
        lane = ev.lane;
      }
    }
    this.evs = evs;
  }

  /** Posisi lateral rencana (0 = pusat lajur kiri, 3,5 = pusat lajur kanan) pada ruas ri, jarak s. */
  latPlan(ri, s) {
    const ctx = this.latCtx;
    const it = this.route.items[ri];
    if (!ctx || ri !== ctx.ri) return it.kStart * LANE;
    const A = this.active && this.active.ri === ri ? this.active : null;
    let lat = A ? A.from : ctx.laneNow * LANE;
    const blend = (ev) => {
      if (s <= ev.start) return;
      if (s >= ev.start + ev.len) {
        lat = ev.lane * LANE;
        return;
      }
      const u = (s - ev.start) / ev.len;
      lat = ev.from + (ev.lane * LANE - ev.from) * smooth(u);
    };
    if (A) blend(A);
    for (const ev of this.evs) if (Number.isFinite(ev.start)) blend(ev);
    return lat;
  }

  /** Jika lajur yang dibutuhkan untuk belok belum tercapai menjelang ujung ruas, hitung ulang rute. */
  checkReplan() {
    const r = this.route;
    const it = r.items[r.ri];
    if (it.type !== 'road' || this.active) return;
    const next = r.items[r.ri + 1];
    if (!next || next.type !== 'conn') return;
    const needK = next.lane.k;
    // Lajur di ujung ruas menurut rencana. Bila ada rintangan yang belum disalip dan tidak cukup
    // ruang untuk kembali sebelum persimpangan, mobil akan tetap di lajur sebelah.
    let endK = this.latPlan(r.ri, it.len) > LANE / 2 ? 1 : 0;
    const ov = this.overtake;
    if (ov && ov.ri === r.ri && !this.doneIds.has(`kembali:${ov.uid}`)) {
      const roomAfter = it.len - 4 - ov.sOut;
      if (ov.noBack || roomAfter < this.dlcNow) endK = ov.passK;
    }
    if (endK === needK) return;
    const remaining = it.len - r.s;
    const v = this.app.ego.v;
    if (remaining < 12 + v * 1.4) {
      const ok = this.planFrom(it.seg.lanes[endK], r.s, { lockLane: true, keepDest: true });
      if (ok) this.app.toast('Rute dihitung ulang karena belum bisa pindah lajur.');
    }
  }

  genPath() {
    const r = this.route;
    const items = r.items;
    const pts = this.path;
    let n = 0;
    let ri = r.ri;
    let s = r.s;
    const cur = items[ri];
    // selisih posisi nyata terhadap rencana, dihilangkan perlahan dalam beberapa meter pertama
    const err = cur.type === 'road' ? r.lat - this.latPlan(ri, r.s) : r.lat;
    this.trackErr = Math.abs(err);
    const s0 = r.s;
    let d = 0;
    while (d <= PATH_H && n < MAX_PATH) {
      const it = items[ri];
      const P = pts[n];
      const fade = ri === r.ri ? Math.max(0, 1 - (s - s0) / 5) : 0;
      if (it.type === 'road') {
        const lat = this.latPlan(ri, s) + err * fade;
        segPoint(it.seg, s, lat, P);
        P.lat = lat;
      } else {
        it.lane.poly.at(s, P);
        if (fade > 0 && err) {
          P.x += -Math.sin(P.h) * err * fade;
          P.z += Math.cos(P.h) * err * fade;
        }
        P.lat = 0;
      }
      P.ri = ri;
      P.s = s;
      P.d = d;
      n++;
      s += PATH_DS;
      d += PATH_DS;
      let end = false;
      while (s > items[ri].len) {
        if (ri + 1 >= items.length) {
          end = true;
          break;
        }
        s -= items[ri].len;
        ri++;
      }
      if (end) break;
    }
    this.pathN = n;
    for (let i = 0; i < n - 1; i++) pts[i].h = Math.atan2(pts[i + 1].z - pts[i].z, pts[i + 1].x - pts[i].x);
    if (n > 1) pts[n - 1].h = pts[n - 2].h;
  }

  /** Proyeksikan titik ke jalur lokal: jarak sepanjang jalur dan offset lateral. */
  projectOnPath(x, z, out) {
    const pts = this.path;
    const n = this.pathN;
    let bi = -1;
    let bd = Infinity;
    for (let i = 0; i < n; i += 1) {
      const dx = pts[i].x - x;
      const dz = pts[i].z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bd) {
        bd = d2;
        bi = i;
      }
    }
    if (bi < 0) return null;
    const P = pts[bi];
    const c = Math.cos(P.h);
    const s = Math.sin(P.h);
    const ex = x - P.x;
    const ez = z - P.z;
    out.along = P.d + ex * c + ez * s;
    out.lat = -ex * s + ez * c;
    out.h = P.h;
    out.i = bi;
    out.far = bi === n - 1;
    return out;
  }

  /** Indeks titik jalur pada jarak d dari mobil (-1 bila di luar jalur). */
  pathIndexAt(d) {
    if (d <= 0) return 0;
    const i = Math.round(d / PATH_DS);
    return i < this.pathN ? i : -1;
  }

  /** Objek yang berada (atau akan berada) di jalur mobil. */
  findInPath() {
    const { app } = this;
    const e = app.ego;
    const v = Math.max(0, e.v);
    const res = this.inPath;
    res.length = 0;
    const pr = this.tmp;
    const ch = Math.cos(e.h);
    const sh = Math.sin(e.h);
    for (const t of app.perception.list) {
      const dx = t.px - e.x;
      const dz = t.pz - e.z;
      if (dx * dx + dz * dz > 115 * 115) continue;
      if (dx * ch + dz * sh < -2) continue;
      const isStatic = STATIC_CLASSES.has(t.cls);
      const margin = isStatic ? 0.6 : 0.45;
      const check = (x, z) => {
        const q = this.projectOnPath(x, z, pr);
        if (!q || q.far) return null;
        const dh = t.h - q.h;
        const across = Math.abs(t.hl * Math.sin(dh)) + Math.abs(t.hw * Math.cos(dh));
        const alongExt = Math.abs(t.hl * Math.cos(dh)) + Math.abs(t.hw * Math.sin(dh));
        let clear = Math.abs(q.lat) - across - EGO.wid / 2;
        // Periksa juga saat bumper depan mencapai objek (titik pusat mobil masih di belakang),
        // karena saat pindah lajur posisi lateral mobil di titik itu belum sejauh titik objek.
        const j = this.pathIndexAt(q.along - alongExt - EGO.len / 2);
        const Pj = j >= 0 ? this.path[j] : null;
        if (Pj && Math.abs(Math.atan2(Math.sin(Pj.h - q.h), Math.cos(Pj.h - q.h))) < 0.2) {
          const lat2 = -(x - Pj.x) * Math.sin(Pj.h) + (z - Pj.z) * Math.cos(Pj.h);
          clear = Math.min(clear, Math.abs(lat2) - across - EGO.wid / 2);
        }
        if (clear > margin) return null;
        return { along: q.along, alongExt, h: q.h };
      };
      const hit = check(t.px, t.pz);
      if (hit) {
        const gap = hit.along - hit.alongExt - EGO.len / 2;
        if (gap < -EGO.len) continue; // sudah di belakang
        const vAlong = t.vx * Math.cos(hit.h) + t.vz * Math.sin(hit.h);
        res.push({ t, gap, vAlong, predicted: false, isStatic });
        continue;
      }
      // Prediksi gerak pejalan kaki beberapa detik ke depan
      if (t.cls === 'pejalan' && Math.hypot(t.vx, t.vz) > 0.4) {
        for (const tp of [0.5, 1, 1.5, 2, 2.5]) {
          const h2 = check(t.px + t.vx * tp, t.pz + t.vz * tp);
          if (!h2) continue;
          const gap = h2.along - h2.alongExt - EGO.len / 2;
          if (gap < 0) break;
          const arrive = gap / Math.max(v, 1);
          if (arrive > tp - 1.2 && arrive < tp + 1.5) res.push({ t, gap, vAlong: 0, predicted: true, isStatic: false });
          break;
        }
      }
    }
    return res;
  }

  /** Lampu berikutnya pada rute dalam 150 m. */
  nextStop() {
    const r = this.route;
    const items = r.items;
    let acc = 0;
    for (let i = r.ri; i < items.length; i++) {
      const it = items[i];
      const remain = i === r.ri ? it.len - r.s : it.len;
      if (it.type === 'road') {
        const nx = items[i + 1];
        const endD = acc + remain;
        if (endD > 150) return null;
        if (nx && nx.type === 'conn') {
          return { node: it.seg.b, dist: endD, dir: it.seg.k, conn: nx.lane, itemIndex: i, signalized: it.seg.b.signalized };
        }
      }
      acc += remain;
      if (acc > 150) return null;
    }
    return null;
  }

  // ===== langkah utama =====

  step(dt) {
    const { app } = this;
    const e = app.ego;
    if (!this.route) this.relocate();
    if (!this.route) return;
    this.track();
    // keluar dari rute (misalnya setelah dikemudikan manual)
    const it0 = this.route.items[this.route.ri];
    const offRoute = this.deviation > 4.5 || (it0.type === 'road' && Math.abs(Math.atan2(Math.sin(e.h - it0.seg.h), Math.cos(e.h - it0.seg.h))) > 1.2);
    if (offRoute && app.simTime - this.lastReloc > 0.6) {
      this.relocate();
      this.lastReloc = app.simTime;
    }
    // sampai tujuan: pilih tujuan baru dan lanjut
    const r = this.route;
    const last = r.items.length - 1;
    if (r.ri === last && r.s >= r.dest.s - 2) {
      const it = r.items[r.ri];
      const lane = it.type === 'road' ? it.seg.lanes[this.kNow] : it.lane;
      this.planFrom(lane, r.s);
      app.counters.destinations++;
    }
    if (this.pendingClosure && this.route.items[this.route.ri].type === 'road') {
      this.pendingClosure = false;
      this.onClosures();
    }
    this.dlcNow = dlc(Math.max(0, e.v));
    this.scheduleLateral(dt);
    if (app.autopilot) this.checkReplan();
    this.genPath();
    this.longitudinal(dt);
    this.describe();
  }

  longitudinal(dt) {
    const { app } = this;
    const e = app.ego;
    const v = Math.max(0, e.v);
    const fx = app.weather.fx;
    const target = app.targetSpeed;
    const cap = fx.speedCap;
    const v0 = Math.min(target, cap);
    const r = this.route;
    const items = r.items;
    const cons = [];
    const aFree = idmAccel(v, v0, Infinity, 0, EGO_IDM);
    cons.push({ a: aFree, kind: cap < target ? 'cuaca' : 'target' });

    // Tikungan di depan. Kecepatan yang diizinkan mengikuti profil pengereman nyaman (TURN_B)
    // menuju kecepatan aman tikungan. Di jalan lurus mobil tetap melaju dan baru mengerem saat perlu.
    let acc = 0;
    for (let i = r.ri; i < items.length && acc < 110; i++) {
      const it = items[i];
      const remain = i === r.ri ? it.len - r.s : it.len;
      if (it.type === 'conn' && it.lane.vmax < 50) {
        const vm = it.lane.vmax;
        if (i === r.ri) {
          if (v > vm) cons.push({ a: idmAccel(v, vm, Infinity, 0, EGO_IDM), kind: 'tikungan', move: it.lane.move });
        } else {
          const d = Math.max(acc - 1, 0.5);
          const vAllow = Math.sqrt(vm * vm + 2 * TURN_B * d);
          if (v > vAllow) cons.push({ a: (vm * vm - v * v) / (2 * d), kind: 'tikungan', move: it.lane.move, dist: acc });
          else if (vAllow < v0 && v > 0.8 * vAllow) cons.push({ a: idmAccel(v, vAllow, Infinity, 0, EGO_IDM), kind: 'tikungan', move: it.lane.move, dist: acc });
        }
      }
      acc += remain;
    }

    // Objek di jalur
    const objs = this.findInPath();
    let ttc = Infinity;
    let aebNeed = false;
    let aebObj = null;
    for (const o of objs) {
      // benda diam yang bukan kendaraan antre (atau belum dikenali) dijaga lebih jauh
      const stillThing = (o.isStatic && o.t.known) || (!o.t.known && Math.hypot(o.t.vx, o.t.vz) < 0.3 && !o.predicted);
      const a = idmAccel(v, v0, o.gap, v - Math.max(0, o.vAlong), stillThing ? EGO_IDM_STATIC : EGO_IDM);
      cons.push({ a, kind: 'objek', o });
      if (!o.predicted) {
        // Kecepatan saling mendekat: objek yang bergerak ke arah mobil menambah kecepatan ini.
        const closing = v - o.vAlong;
        if (closing > 0.5 && o.gap > -1) {
          const tt = Math.max(0, o.gap) / closing;
          if (tt < ttc) ttc = tt;
          const aReq = (closing * closing) / (2 * Math.max(o.gap - 1, 0.3));
          if (v > 2.5 && tt < 1.8 && aReq > 3.0) {
            aebNeed = true;
            aebObj = o;
          }
        }
      }
    }

    // Lampu lalu lintas dan persimpangan
    const stop = this.nextStop();
    this.stopInfo = stop;
    app.perception.light = null;
    if (stop) {
      const dStop = stop.dist - EGO.len / 2;
      const R = app.sensing.ranges();
      let color = null;
      if (stop.signalized) {
        const readable = stop.dist <= R.lampu;
        color = readable ? app.signals.colorAt(stop.node.id, stop.dir) : 'unknown';
        app.perception.light = { color, dist: stop.dist };
      }
      const committed = this.commitNode === stop.node.id;
      if (!committed && stop.itemIndex === r.ri && dStop < 90) {
        let decision = 'go';
        let why = '';
        if (dStop < -0.5) decision = 'commit';
        else if (color === 'red') {
          decision = 'stop';
          why = 'merah';
        } else if (color === 'yellow') {
          const need = (v * v) / (2 * 3.2);
          if (dStop > need + 0.5) {
            decision = 'stop';
            why = 'kuning';
          } else decision = 'commit';
        } else if (color === 'unknown') {
          // warna belum terbaca: siap berhenti bila perlu
          const vAllow = Math.sqrt(2 * 2.2 * Math.max(dStop - 1, 0));
          if (v > vAllow) cons.push({ a: -1.8, kind: 'lampu-belum', dist: stop.dist });
        }
        if (decision === 'go' && dStop < 14) {
          if (stop.signalized && !app.traffic.boxClear(stop.node.id, stop.dir)) {
            decision = 'stop';
            why = 'kotak';
          } else if (!app.traffic.exitFree(stop.conn.next[0], e)) {
            decision = 'stop';
            why = 'penuh';
          } else if (dStop < 1.5) decision = 'commit';
        }
        if (decision === 'commit') this.commitNode = stop.node.id;
        if (decision === 'stop') {
          const a = idmAccel(v, v0, Math.max(dStop - 0.3, 0.05), v, EGO_IDM);
          cons.push({ a, kind: 'stop', why, dist: stop.dist });
        }
      }
      if (e.waitT >= 0 && stop.signalized && stop.itemIndex === r.ri && v < 0.6 && stop.dist < 80) e.waitT += dt;
    }

    let best = cons[0];
    for (const c of cons) if (c.a < best.a) best = c;
    let aDes = clamp(best.a, -fx.brakeMax, 2.4);

    // Rem darurat otomatis
    if (aebNeed && !this.aeb) {
      this.aeb = true;
      this.aebObj = aebObj;
      app.counters.aebAuto++;
      app.logDebug({ t: Math.round(app.simTime * 10) / 10, type: 'aeb', cls: aebObj.t.cls, gap: Math.round(aebObj.gap * 10) / 10, v: Math.round(kmh(v)), ttc: Math.round(ttc * 100) / 100, beh: this.behavior, act: this.active ? this.active.kind : null, item: this.route.items[this.route.ri].type });
      app.toast(`Rem darurat! TTC ${fmt(ttc, 1)} detik ke ${CLASSES[aebObj.t.known ? aebObj.t.cls : 'objek'].label.toLowerCase()}.`, 'danger');
    }
    if (this.aeb) {
      if (aebNeed) this.aebHold = 0;
      else this.aebHold += dt;
      const safe = !aebNeed && (v < 0.3 || ttc > 3) && this.aebHold > 0.6;
      if (safe) this.aeb = false;
      else aDes = -fx.brakeMax;
    }
    if (this.manualBrakeT > 0) {
      this.manualBrakeT -= dt;
      if (v < 0.2 && this.manualBrakeT > 1) this.manualBrakeT = 1;
      aDes = -fx.brakeMax;
    }
    // Mundur pelan (sekitar 1 m/s) sampai ada ruang, lalu berhenti.
    const bk = this.backup;
    if (bk && !this.aeb && this.manualBrakeT <= 0) {
      const it = r.items[r.ri];
      const blockedBehind = it.type === 'road' && !this.rearClear(it, r.s, this.kNow * LANE, 1.2);
      const done = r.s <= bk.until || app.simTime - bk.t > 12 || it.type !== 'road' || blockedBehind;
      if (!done) aDes = e.v > -1.0 ? -0.8 : 0.3;
      else if (e.v < -0.05) aDes = 1.5;
      else this.backup = null;
    }
    this.aDes = aDes;
    this.binding = best;
    this.ttc = ttc;
    this.objs = objs;
  }

  /** Jarak antarbadan (bumper ke sisi terdekat) dari mobil ke objek persepsi, sama seperti di label dan panel. */
  gapOf(o) {
    const t = o.t;
    return footGap(this.app.ego, t, t.px, t.pz);
  }

  /** Apakah objek berada di ruas jalan tempat mobil sekarang (bukan di balik persimpangan)? */
  onCurrentRoad(o) {
    const r = this.route;
    const it = r.items[r.ri];
    if (it.type !== 'road') return false;
    const pr = this.tmp2;
    segProject(it.seg, o.t.px, o.t.pz, pr);
    return pr.s > -2 && pr.s < it.len + 2 && pr.lat > -3 && pr.lat < LANE + 3;
  }

  /** Susun teks perilaku, alasan, objek pembatas, lajur, dan rute dalam bahasa sehari-hari. */
  describe() {
    const { app } = this;
    const e = app.ego;
    const v = Math.max(0, e.v);
    const b = this.binding;
    const r = this.route;
    const it = r.items[r.ri];
    const fx = app.weather.fx;
    const ov = this.overtake;
    const A = this.active;
    const H = this.held;
    let beh = 'Melaju';
    let why = '';
    let key = '';
    let lim = 'Tidak ada, jalan di depan kosong';
    const objName = (o) => CLASSES[o.t.known ? o.t.cls : 'objek'].label;
    const tgtK = fmt(kmh(Math.min(app.targetSpeed, fx.speedCap)), 0);
    if (b) {
      if (b.kind === 'objek') lim = `${objName(b.o)}, ${fmt(this.gapOf(b.o), 0)} m di depan`;
      else if (b.kind === 'stop') lim = b.why === 'merah' ? `Lampu merah, ${fmt(b.dist, 0)} m` : b.why === 'kuning' ? `Lampu kuning, ${fmt(b.dist, 0)} m` : `Persimpangan, ${fmt(b.dist, 0)} m`;
      else if (b.kind === 'tikungan') lim = `Tikungan (${MOVE_TEXT[b.move]})`;
      else if (b.kind === 'cuaca') lim = `Cuaca ${fx.label.toLowerCase()}, batas ${tgtK} km/jam`;
      else if (b.kind === 'lampu-belum') lim = 'Lampu belum terbaca';
      else lim = `Kecepatan target ${fmt(kmh(app.targetSpeed), 0)} km/jam`;
    }
    const binding = b && b.kind !== 'target' && b.kind !== 'cuaca' && b.a < 0.4;
    const ovName = ov ? CLASSES[ov.cls].label.toLowerCase() : '';
    const ovCap = ovName ? ovName[0].toUpperCase() + ovName.slice(1) : 'Rintangan';
    const sideTo = ov && ov.passK === 1 ? 'kanan' : 'kiri';
    const sideFrom = ov && ov.passK === 1 ? 'kiri' : 'kanan';
    const salipStarted = ov && ((A && A.id === `salip:${ov.uid}`) || this.doneIds.has(`salip:${ov.uid}`));
    const backDone = ov && (this.doneIds.has(`kembali:${ov.uid}`) || ov.noBack);
    const inPass = ov && r.ri === ov.ri && Math.abs(r.lat - ov.passLat) < 1.2 && !backDone;
    const movingAhead = binding && b.kind === 'objek' && !b.o.isStatic && b.o.t.cls !== 'pejalan';
    if (this.aeb || this.manualBrakeT > 0) {
      beh = 'Rem darurat';
      key = 'aeb';
      if (this.manualBrakeT > 0) why = 'Kamu menekan tombol rem darurat. Mobil mengerem penuh sesuai daya cengkeram ban di jalan.';
      else {
        const o = this.aebObj;
        why = o ? `${objName(o)} tiba-tiba ada di jalur, TTC terlalu kecil. Mobil mengerem penuh.` : 'TTC terlalu kecil. Mobil mengerem penuh.';
      }
    } else if (!app.autopilot) {
      beh = 'Manual';
      key = 'manual';
      why = 'Autopilot mati, kamu yang mengemudi. Rem darurat otomatis tetap aktif.';
    } else if (binding && b.kind === 'stop') {
      key = `stop:${b.why}`;
      if (b.why === 'merah' || b.why === 'kuning') {
        beh = 'Berhenti di lampu';
        why = b.why === 'merah' ? `Lampu merah ${fmt(b.dist, 0)} m di depan.` : 'Lampu kuning dan masih sempat berhenti dengan nyaman.';
      } else {
        beh = 'Memberi jalan';
        why = b.why === 'kotak' ? 'Persimpangan masih dipakai kendaraan dari arah lain.' : 'Lajur tujuan di seberang masih penuh. Mobil menunggu supaya tidak menutup persimpangan.';
      }
    } else if (binding && b.kind === 'objek' && b.o.t.cls === 'pejalan') {
      beh = 'Memberi jalan';
      key = 'pejalan';
      why = b.o.predicted ? 'Pejalan kaki diperkirakan akan melintas di depan.' : `Pejalan kaki di jalur, ${fmt(this.gapOf(b.o), 0)} m di depan.`;
    } else if (this.bothBlocked && ((binding && b.kind === 'objek' && b.o.isStatic) || ov)) {
      beh = 'Menunggu celah';
      key = 'tertutup';
      const nm = binding && b.kind === 'objek' ? objName(b.o) : ovCap;
      why = `${nm} menutup jalan dan lajur sebelah juga terhalang. Hapus rintangan supaya mobil bisa lewat.`;
    } else if (ov && !(ov.counted && backDone)) {
      // Ada rencana menyalip yang belum selesai.
      if (this.backup) {
        beh = 'Menyalip';
        key = 'salip:mundur';
        why = `Mobil terlalu dekat dengan ${ovName}, jadi mundur sedikit supaya ada ruang untuk berbelok keluar.`;
      } else if (H && H.why === 'gate' && H.kind === 'salip') {
        beh = 'Menunggu celah';
        key = 'salip:gerbang';
        why = `${ovCap} menghalangi lajur ini. Lajur ${sideTo} belum aman untuk menyalip.`;
      } else if (H && H.why === 'gate' && H.kind === 'kembali') {
        beh = 'Menunggu celah';
        key = 'kembali:gerbang';
        why = `Sudah melewati ${ovName}. Ingin kembali ke lajur ${sideFrom}, menunggu celah yang aman.`;
      } else if (inPass && movingAhead) {
        beh = 'Mengikuti';
        key = 'salip:ikuti';
        why = `Mengikuti ${objName(b.o).toLowerCase()} di lajur ${sideTo} sambil menyalip ${ovName}.`;
      } else if (!salipStarted && ov.ri !== r.ri) {
        beh = 'Menyalip';
        key = 'salip:simpang';
        why = `Ada ${ovName} di depan. Mobil bersiap menyalip setelah keluar dari persimpangan.`;
      } else if (!salipStarted && H && H.kind === 'salip' && H.why === 'ruang') {
        beh = 'Menyalip';
        key = 'salip:ruang';
        why = `Ada ${ovName} di depan. Mobil memperlambat dulu supaya ada ruang untuk pindah lajur.`;
      } else if (!salipStarted) {
        beh = 'Menyalip';
        key = 'salip:siap';
        why = `Ada ${ovName} di depan. Mobil bersiap pindah ke lajur ${sideTo} untuk menyalip.`;
      } else if (!ov.counted) {
        beh = 'Menyalip';
        key = 'salip:lewat';
        why = ov.passK === 1 ? `Ada ${ovName} di lajur kiri. Lajur kanan aman, jadi mobil menyalip lalu kembali ke kiri.` : `Ada ${ovName} di lajur kanan. Mobil lewat lajur kiri yang kosong.`;
      } else if (A && A.kind === 'kembali') {
        beh = 'Pindah lajur';
        key = 'kembali';
        why = `Sudah melewati ${ovName}. Kembali ke lajur kiri, lajur normal di Indonesia.`;
      } else if (H && H.kind === 'kembali' && H.why === 'ruang') {
        beh = 'Melaju';
        key = 'kembali:ruang';
        why = `Sudah melewati ${ovName}. Ruang sebelum persimpangan terlalu pendek, jadi mobil kembali ke lajur kiri setelah persimpangan.`;
      } else {
        beh = 'Menyalip';
        key = 'salip:akhir';
        why = `Sudah melewati ${ovName}. Sebentar lagi mobil kembali ke lajur ${sideFrom}.`;
      }
    } else if (H && H.why === 'gate') {
      beh = 'Menunggu celah';
      key = `gerbang:${H.kind}`;
      const side = H.lane === 1 ? 'kanan' : 'kiri';
      if (H.kind === 'belok') why = 'Perlu pindah ke lajur kanan untuk belok kanan, tetapi lajurnya belum aman.';
      else why = `Ingin pindah ke lajur ${side}, menunggu celah yang aman.`;
    } else if (binding && b.kind === 'objek') {
      const o = b.o;
      const nm = objName(o);
      if (o.isStatic && o.t.known) {
        if (this.onCurrentRoad(o)) {
          beh = 'Menunggu celah';
          key = 'diam:ruas';
          why = `${nm} menghalangi lajur ini. Mobil menunggu ruang yang aman untuk menyalip.`;
        } else {
          beh = 'Mengikuti';
          key = 'diam:simpang';
          why = `${nm} ada di balik persimpangan. Mobil akan menyalip setelah melewati persimpangan.`;
        }
      } else {
        beh = 'Mengikuti';
        key = 'ikuti';
        const gap = this.gapOf(o);
        const gapT = v > 1 ? gap / v : 0;
        why = o.vAlong < 0.5 ? `Antre di belakang ${nm.toLowerCase()} yang berhenti.` : `Mengikuti ${nm.toLowerCase()} ${fmt(gap, 0)} m di depan (jarak waktu ${fmt(gapT, 1)} detik).`;
      }
    } else if (A && (A.kind === 'belok' || A.kind === 'kiri' || A.kind === 'kembali')) {
      beh = 'Pindah lajur';
      key = `pindah:${A.kind}`;
      why = A.kind === 'belok' ? 'Pindah ke lajur kanan untuk bersiap belok kanan.' : 'Kembali ke lajur kiri, lajur normal di Indonesia.';
    } else if (b && b.kind === 'tikungan' && b.a < 0.3) {
      key = 'tikungan';
      why = `Melambat untuk ${MOVE_TEXT[b.move]}.`;
    } else if (b && b.kind === 'lampu-belum') {
      key = 'lampu-belum';
      why = 'Warna lampu di depan belum terbaca kamera, mobil bersiap berhenti.';
    } else if (fx.speedCap < app.targetSpeed) {
      key = 'cuaca';
      why = app.weather.capReason();
    } else {
      key = 'kosong';
      why = `Jalan di depan kosong. Melaju dengan kecepatan target ${tgtK} km/jam.`;
    }
    // Tahan perilaku yang tampil minimal BEH_HOLD detik, kecuali rem darurat dan mode manual.
    const now = app.simTime;
    const urgent = key === 'aeb' || key === 'manual' || this.behKey === 'aeb' || this.behKey === 'manual';
    if (key === this.behKey) {
      this.reason = why;
      this.behavior = beh;
    } else if (urgent || now - (this.behSince ?? -10) >= BEH_HOLD) {
      this.behKey = key;
      this.behSince = now;
      this.behavior = beh;
      this.reason = why;
    }
    this.limiter = lim;

    // lajur
    if (it.type === 'conn') {
      this.laneText = `Di persimpangan, ${MOVE_TEXT[it.lane.move]}`;
      this.laneWhy = '';
    } else {
      if (A) this.laneText = A.lane === 1 ? 'Pindah ke lajur kanan' : 'Pindah ke lajur kiri';
      else this.laneText = this.kNow === 0 ? 'Lajur kiri' : 'Lajur kanan';
      const nx = r.items[r.ri + 1];
      const turnRight = nx && nx.type === 'conn' && nx.lane.move === 'R';
      if (ov && ov.ri === r.ri && (A || inPass)) this.laneWhy = 'untuk menyalip';
      else if ((A && A.kind === 'belok') || (this.kNow === 1 && turnRight)) this.laneWhy = 'bersiap belok kanan';
      else if (this.kNow === 0 && !A) this.laneWhy = 'lajur normal, lalu lintas kiri';
      else this.laneWhy = this.kNow === 1 ? 'kembali ke kiri saat aman' : '';
    }
    // rute
    let acc = 0;
    let nextTurn = null;
    for (let i = r.ri; i < r.items.length; i++) {
      const x = r.items[i];
      const remain = i === r.ri ? x.len - r.s : x.len;
      if (!nextTurn && x.type === 'conn' && x.lane.move !== 'S') nextTurn = { move: x.lane.move, dist: acc };
      acc += remain;
    }
    const destLeft = Math.max(0, acc - (r.items[r.items.length - 1].len - r.dest.s));
    this.destLeft = destLeft;
    this.nextTurn = nextTurn;
    this.routeText = nextTurn ? `${MOVE_TEXT[nextTurn.move][0].toUpperCase()}${MOVE_TEXT[nextTurn.move].slice(1)} ${fmt(nextTurn.dist, 0)} m lagi` : 'Lurus sampai tujuan';
  }

  // ===== tampilan =====

  buildVisuals() {
    const { app } = this;
    const res = app.res;
    const mk = (maxPts, color, opacity, order) => {
      const pos = new Float32Array(maxPts * 2 * 3);
      const g = res.add(new THREE.BufferGeometry());
      const attr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('position', attr);
      const idx = [];
      for (let i = 0; i < maxPts - 1; i++) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      g.setIndex(idx);
      g.setDrawRange(0, 0);
      const m = new THREE.Mesh(g, res.add(new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, fog: false })));
      m.frustumCulled = false;
      m.renderOrder = order;
      app.scene.add(m);
      return { mesh: m, pos, attr };
    };
    this.ribbon = mk(MAX_PATH, '#2dd4bf', 0.55, 8);
    this.routeLine = mk(900, '#5eead4', 0.22, 7);
    // penanda tujuan
    const pinGeo = res.add(new THREE.CylinderGeometry(0.35, 0.35, 14, 12, 1, true));
    pinGeo.translate(0, 7, 0);
    this.pin = new THREE.Mesh(pinGeo, res.add(new THREE.MeshBasicMaterial({ color: '#2dd4bf', transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending })));
    const ringGeo = res.add(new THREE.RingGeometry(1.4, 2.0, 32));
    ringGeo.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(ringGeo, res.add(new THREE.MeshBasicMaterial({ color: '#2dd4bf', transparent: true, opacity: 0.8, depthWrite: false })));
    ring.position.y = 0.06;
    this.pinGroup = new THREE.Group();
    this.pinGroup.add(this.pin, ring);
    app.scene.add(this.pinGroup);
    this.showPath = true;
  }

  fillRibbon(target, pts, n, width, y) {
    const pos = target.pos;
    for (let i = 0; i < n; i++) {
      const P = pts[i];
      const h = P.h;
      const rx = -Math.sin(h) * width * 0.5;
      const rz = Math.cos(h) * width * 0.5;
      const o = i * 6;
      pos[o] = P.x - rx;
      pos[o + 1] = y;
      pos[o + 2] = P.z - rz;
      pos[o + 3] = P.x + rx;
      pos[o + 4] = y;
      pos[o + 5] = P.z + rz;
    }
    target.attr.needsUpdate = true;
    target.mesh.geometry.setDrawRange(0, Math.max(0, (n - 1) * 6));
  }

  sync() {
    const r = this.route;
    const show = this.showPath && !!r;
    this.ribbon.mesh.visible = show;
    this.routeLine.mesh.visible = show;
    this.pinGroup.visible = !!r;
    if (!r) return;
    const nPlan = Math.min(this.pathN, Math.ceil(Math.max(22, this.app.ego.v * 4.5) / PATH_DS));
    this.fillRibbon(this.ribbon, this.path, nPlan, 1.7, 0.08);
    // sisa rute (redup), dari posisi mobil sampai tujuan
    if (!this.routePts) this.routePts = [];
    const rp = this.routePts;
    let n = 0;
    const items = r.items;
    const tmp = this.tmp2;
    let s = r.s;
    for (let i = r.ri; i < items.length && n < 890; i++) {
      const it = items[i];
      const end = i === items.length - 1 ? r.dest.s : it.len;
      for (; s <= end && n < 890; s += 3) {
        const p = rp[n] || (rp[n] = {});
        if (it.type === 'road') {
          const k = i === r.ri ? this.kNow : it.kEnd;
          segPoint(it.seg, s, k * LANE, tmp);
        } else it.lane.poly.at(s, tmp);
        p.x = tmp.x;
        p.z = tmp.z;
        p.h = tmp.h;
        n++;
      }
      s = 0;
    }
    this.fillRibbon(this.routeLine, rp, n, 0.7, 0.06);
    const last = items[items.length - 1];
    if (last.type === 'road') {
      segPoint(last.seg, r.dest.s, 0, tmp);
      this.pinGroup.position.set(tmp.x, 0, tmp.z);
    }
  }
}
