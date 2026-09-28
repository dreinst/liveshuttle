// Gerak mobil otonom di sepanjang rute, lampu lalu lintas, dan perisai keselamatan.
//
// Model memanjang sederhana: mobil selalu berada di lintasan lajur kiri (Path), posisinya s (jarak
// pusat mobil dari awal lintasan) dan kecepatannya v. Setiap langkah fisika (dt tetap 1/60 detik):
//   1. Perencana kecepatan memilih percepatan: mengikuti profil kecepatan (perkiraan kecepatan kelas
//      jalan dibagi pengali macet, melambat di tikungan, berhenti di ujung rute) dan berhenti dengan
//      nyaman di garis henti lampu merah atau kuning.
//   2. Perisai keselamatan memeriksa kendala terdekat di depan (garis henti lampu merah, atau lampu
//      kuning yang masih bisa dihentikan dengan nyaman). Bila jarak tersisa sudah sama dengan jarak
//      henti (v * latensi + v^2 / (2 a_rem)), perisai memaksa rem penuh. Setelah itu posisi dijepit
//      sehingga bagian depan mobil tidak mungkin melewati garis henti yang sedang merah.
//   3. Pemantau independen memeriksa secara geometris apakah bumper depan memotong garis henti saat
//      merah. Penghitungnya harus selalu 0.
// Percepatan waktu (5, 15, 30 kali) menjalankan lebih banyak langkah, bukan dt yang lebih besar.
// Pelajaran ini tidak punya pejalan kaki, jadi penghitung kontak pejalan kaki tetap 0.

import { segmentIntersection } from '../../engine/geometry.js';
import { clamp } from '../../engine/math.js';
import { stopLinesFor } from './network.js';

export const DRIVE = Object.freeze({
  DT: 1 / 60,
  LENGTH: 4.5, // panjang mobil (m), SIZES.car
  WIDTH: 1.8,
  A_ACC: 1.5, // percepatan maju (m/s^2)
  A_COMF: 3, // perlambatan nyaman untuk rencana berhenti (m/s^2)
  A_PLAN: 3.5, // perlambatan paling besar yang diminta perencana
  A_HARD: 6, // perlambatan rem penuh yang bisa dicapai model (jalan kering), dipakai juga oleh perisai
  T_LAT: 0.1, // latensi aktuasi yang diperhitungkan perisai (detik)
  T_REACT: 0.5, // waktu reaksi perencana saat lampu berubah kuning (detik)
  STOP_MARGIN: 0.8, // jarak berhenti yang dituju di depan garis henti (m)
  A_LAT: 2, // percepatan samping nyaman di tikungan (m/s^2)
  DS: 2, // jarak antarsampel profil kecepatan (m)
});

const HALF = DRIVE.LENGTH / 2;

/**
 * Buat pengemudi otomatis. opts: { signals (buildSignals), vMax (m/s), setbackOf(nodeId) (jarak garis
 * henti dari titik simpang, m), faults (khusus pengujian) }. Rute boleh punya `stopAt` (s pusat mobil tempat mobil harus
 * berhenti, misalnya sebelum simpang terakhir saat tidak ada rute ke tujuan).
 */
export function createDriver({ signals, vMax, setbackOf = () => 4, faults = {} }) {
  // faults hanya untuk pengujian: plannerBlind = perencana mengabaikan lampu, shieldOff = perisai mati.
  // Uji model memakai keduanya untuk membuktikan bahwa perisai sendiri sudah cukup dan pemantau benar.
  const plannerBlind = !!faults.plannerBlind;
  const shieldOff = !!faults.shieldOff;
  const car = {
    state: 'idle', // 'idle' | 'driving' | 'blocked' | 'arrived'
    route: null,
    s: 0,
    v: 0,
    elapsed: 0,
    braking: false,
    holdLine: null, // garis henti tempat mobil sedang menunggu
    shieldOn: false,
    x: 0,
    y: 0,
    heading: 0,
  };
  const safety = {
    redRuns: 0, // "Terobos lampu merah" (pemantau geometris)
    pedContacts: 0, // "Kontak dengan pejalan kaki" (tidak ada pejalan kaki di pelajaran ini)
    shieldBrakes: 0, // langkah ketika perisai memaksa rem penuh
    clamps: 0, // langkah ketika posisi dijepit di garis henti
    yellowStop: 0,
    yellowGo: 0,
  };
  let lines = [];
  let lineIdx = 0;
  let profile = null;
  const decisions = new Map();

  // ---------- profil kecepatan ----------
  function buildProfile() {
    const r = car.route;
    if (!r) {
      profile = null;
      return;
    }
    const { path, edges, nodeS } = r;
    const DS = DRIVE.DS;
    const end = Math.min(path.length, r.stopAt ?? path.length);
    const n = Math.max(2, Math.ceil(path.length / DS) + 1);
    const v = new Float32Array(n);
    let e = 0;
    for (let i = 0; i < n; i++) {
      const s = Math.min(path.length, i * DS);
      if (s >= end) {
        v[i] = 0;
        continue;
      }
      while (e < edges.length - 1 && s >= nodeS[e + 1]) e++;
      const ed = edges[e];
      const mult = Math.max(1, ed.edge.multiplier || 1);
      let lim = Math.min(ed.road.speed, vMax) / mult;
      // tikungan: v <= sqrt(a_samping / kelengkungan)
      const a = path.sample(Math.max(0, s - 4));
      const b = path.sample(Math.min(path.length, s + 4));
      const span = Math.max(1, b.s - a.s);
      const turn = Math.abs(Math.atan2(Math.sin(b.heading - a.heading), Math.cos(b.heading - a.heading)));
      const kappa = turn / span;
      if (kappa > 1e-4) lim = Math.min(lim, Math.max(2, Math.sqrt(DRIVE.A_LAT / kappa)));
      v[i] = lim;
    }
    v[n - 1] = 0;
    // mundur: perlambatan ke batas berikutnya paling besar A_COMF
    for (let i = n - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] * v[i + 1] + 2 * DRIVE.A_COMF * DS));
    profile = v;
  }

  function profileAt(s) {
    if (!profile) return 0;
    const f = s / DRIVE.DS;
    const i = Math.floor(f);
    if (i >= profile.length - 1) return profile[profile.length - 1];
    if (i < 0) return profile[0];
    const t = f - i;
    return profile[i] * (1 - t) + profile[i + 1] * t;
  }

  // ---------- pose ----------
  function updatePose() {
    const r = car.route;
    if (!r) return;
    const L = r.path.length;
    const p = r.path.sample(car.s);
    const a = r.path.sample(Math.max(0, car.s - 1.5));
    const b = r.path.sample(Math.min(L, car.s + 1.5));
    car.x = p.x;
    car.y = p.y;
    if (b.s - a.s > 0.2) car.heading = Math.atan2(b.y - a.y, b.x - a.x);
  }

  const frontWorld = () => ({ x: car.x + Math.cos(car.heading) * HALF, y: car.y + Math.sin(car.heading) * HALF });

  function relinkLines() {
    const front = car.s + HALF;
    lineIdx = 0;
    while (lineIdx < lines.length && lines[lineIdx].s <= front) lineIdx++;
  }

  // ---------- rute ----------
  /** Pasang rute baru dan taruh mobil di awalnya (diam). */
  function setRoute(route) {
    car.route = route;
    car.s = 0;
    car.v = 0;
    car.elapsed = 0;
    car.braking = false;
    car.holdLine = null;
    car.state = 'idle';
    lines = route ? stopLinesFor(signals, route) : [];
    buildProfile();
    relinkLines();
    updatePose();
  }

  /** Mulai melaju di rute yang terpasang. */
  function start() {
    if (!car.route) return;
    car.state = 'driving';
  }

  /**
   * Ganti rute tanpa memindahkan mobil (rute dihitung ulang saat melaju). Geometri rute baru sama
   * dengan rute lama sampai route.keep, jadi garis henti sampai titik itu dipertahankan apa adanya.
   */
  function replace(route, state = 'driving') {
    const keep = route.keep ?? car.s + HALF;
    const kept = lines.filter((l) => l.s <= keep);
    car.route = route;
    lines = kept.concat(stopLinesFor(signals, route, { minS: keep }));
    car.s = Math.min(car.s, route.path.length);
    car.state = state;
    buildProfile();
    relinkLines();
    updatePose();
  }

  /** Profil kecepatan dihitung ulang (misalnya setelah macet ditandai). */
  function refresh() {
    buildProfile();
  }

  // ---------- lampu ----------
  function stateOf(line, t) {
    return signals.stateFor(line.ctrl, line.group, t);
  }

  function decide(line, t, d) {
    const key = `${line.id}|${signals.cycleIndex(line.ctrl, t)}|${line.group}`;
    let dec = decisions.get(key);
    if (!dec) {
      const v = car.v;
      const canStop = d - DRIVE.STOP_MARGIN - 1 >= v * DRIVE.T_REACT + (v * v) / (2 * DRIVE.A_COMF);
      dec = canStop ? 'stop' : 'go';
      decisions.set(key, dec);
      if (dec === 'stop') safety.yellowStop++;
      else safety.yellowGo++;
      if (decisions.size > 400) decisions.delete(decisions.keys().next().value);
    }
    return dec;
  }

  /**
   * Percepatan perencana untuk berhenti setelah dd meter: perlambatan tetap v^2 / (2 dd), dimulai
   * saat perlambatan yang dibutuhkan mencapai 70 persen perlambatan nyaman. Sebelum itu kecepatan
   * hanya dijaga di bawah kurva henti nyaman.
   */
  function stopAccel(dd, v) {
    if (dd <= 0.02) return v > 0 ? -DRIVE.A_PLAN : 0;
    const req = (v * v) / (2 * dd);
    let a = 4 * (Math.sqrt(2 * DRIVE.A_COMF * dd) - v);
    if (req >= 0.7 * DRIVE.A_COMF) a = Math.min(a, -Math.min(DRIVE.A_PLAN, req * 1.02));
    return a;
  }

  // ---------- satu langkah fisika ----------
  function tick(dt, t) {
    if (car.state !== 'driving' && car.state !== 'blocked') return;
    const r = car.route;
    if (!r) return;
    const L = Math.min(r.path.length, Math.max(car.s, r.stopAt ?? r.path.length));
    const front = car.s + HALF;
    while (lineIdx < lines.length && lines[lineIdx].s <= front) lineIdx++;

    // 1. perencana
    let target = profileAt(car.s + car.v * 0.3);
    let hard = Infinity; // s garis henti aktif terdekat
    let hardLine = null;
    let goLine = null;
    const look = (car.v * car.v) / (2 * DRIVE.A_COMF) + 80;
    for (let k = lineIdx; k < lines.length; k++) {
      const ln = lines[k];
      const d = ln.s - front;
      if (d > look) break;
      const st = stateOf(ln, t);
      let active = st === 'red';
      if (st === 'yellow') active = decide(ln, t, d) === 'stop';
      if (active) {
        hard = ln.s;
        hardLine = ln;
        break;
      }
      if (st === 'yellow' && !goLine) goLine = ln;
    }
    // sudah memutuskan jalan terus saat kuning: jangan melambat sebelum melewati garis henti
    if (goLine && !plannerBlind) target = Math.max(target, Math.min(Math.max(car.v, 3), vMax));
    let aCmd = clamp(4 * (target - car.v), -DRIVE.A_PLAN, DRIVE.A_ACC);
    // berhenti tepat di depan garis henti yang aktif dan di ujung rute
    if (hardLine && !plannerBlind) aCmd = Math.min(aCmd, stopAccel(hard - front - DRIVE.STOP_MARGIN, car.v));
    aCmd = Math.min(aCmd, stopAccel(L - car.s, car.v));

    // 2. perisai keselamatan (setelah perencana, sebelum aktuasi)
    car.shieldOn = false;
    if (hardLine && !shieldOff) {
      const d = hard - front - 0.15;
      const vn = Math.max(0, car.v + aCmd * dt);
      const need = vn * dt + vn * DRIVE.T_LAT + (vn * vn) / (2 * DRIVE.A_HARD);
      if (need >= d) {
        aCmd = -DRIVE.A_HARD;
        car.shieldOn = true;
        safety.shieldBrakes++;
      }
    }

    // 3. aktuasi (model kendaraan): percepatan dibatasi kemampuan rem dan mesin
    const a = clamp(aCmd, -DRIVE.A_HARD, DRIVE.A_ACC);
    let v = clamp(car.v + a * dt, 0, vMax);
    let ds = v * dt;
    if (hardLine && !shieldOff && front + ds > hard - 0.05) {
      ds = Math.max(0, hard - 0.05 - front);
      v = 0;
      safety.clamps++;
    }
    if (car.s + ds >= L) {
      ds = Math.max(0, L - car.s);
      v = 0;
    }
    const before = frontWorld();
    car.s += ds;
    car.v = v;
    car.elapsed += dt;
    car.braking = a < -0.4 || (v < 0.05 && (!!hardLine || L - car.s < 0.5));
    car.holdLine = hardLine && v < 0.3 && hard - front < 8 ? hardLine : null;
    updatePose();

    // 4. pemantau independen: bumper depan memotong garis henti saat merah?
    const after = frontWorld();
    if (ds > 0) {
      const mx = after.x - before.x;
      const my = after.y - before.y;
      for (let k = Math.max(0, lineIdx - 2); k < lines.length; k++) {
        const ln = lines[k];
        if (ln.s > car.s + HALF + 10) break;
        if (Math.hypot(ln.x - after.x, ln.y - after.y) > 12) continue;
        if (!segmentIntersection(before, after, ln.a, ln.b)) continue;
        if (mx * Math.cos(ln.heading) + my * Math.sin(ln.heading) <= 0) continue; // arah berlawanan
        if (stateOf(ln, t) === 'red') safety.redRuns++;
      }
    }

    // ujung rute: mobil sudah hampir diam beberapa sentimeter sebelum ujung, tempatkan tepat di ujung
    if (L - car.s < 0.05 && car.v < 0.1) {
      car.s = L;
      car.v = 0;
      updatePose();
      if (car.state === 'driving' && L >= r.path.length - 1e-6) car.state = 'arrived';
    }
  }

  /** Garis henti berikutnya di depan: { line, dist, state } atau null. */
  function nextLine(t) {
    const front = car.s + HALF;
    for (let k = lineIdx; k < lines.length; k++) {
      const ln = lines[k];
      if (ln.s <= front) continue;
      return { line: ln, dist: ln.s - front, state: stateOf(ln, t) };
    }
    return null;
  }

  /** Indeks sisi (di route.edges) tempat pusat mobil berada. */
  function edgeIndex() {
    const r = car.route;
    if (!r) return 0;
    let i = 0;
    while (i < r.edges.length - 1 && car.s >= r.nodeS[i + 1]) i++;
    return i;
  }

  /**
   * Indeks node tempat rencana baru boleh berpisah dari rute lama: simpang pertama yang garis
   * hentinya masih cukup jauh di depan bumper, sehingga mobil masih bisa berhenti dengan nyaman
   * sebelum simpang itu bila ternyata tidak ada rute lain.
   */
  function commitIndex() {
    const r = car.route;
    if (!r) return 0;
    const v = car.v;
    const need = car.s + HALF + Math.max(3, v * DRIVE.T_REACT + (v * v) / (2 * DRIVE.A_COMF));
    for (let i = 1; i < r.nodes.length; i++) if (r.nodeS[i] - setbackOf(r.nodes[i]) - 1 >= need) return i;
    return r.nodes.length - 1;
  }

  /** Sisa jarak (m) dan perkiraan sisa waktu (detik, dari kecepatan kelas jalan dan pengali macet). */
  function remaining() {
    const r = car.route;
    if (!r) return { length: 0, time: 0 };
    const i = edgeIndex();
    let time = 0;
    for (let k = i; k < r.edges.length; k++) {
      const e = r.edges[k];
      const full = (e.road.length / e.road.speed) * Math.max(1, e.edge.multiplier || 1);
      if (k === i) {
        const span = Math.max(1e-6, r.nodeS[k + 1] - r.nodeS[k]);
        time += full * Math.max(0, Math.min(1, (r.nodeS[k + 1] - car.s) / span));
      } else time += full;
    }
    return { length: Math.max(0, r.path.length - car.s), time };
  }

  return {
    car,
    safety,
    get lines() {
      return lines;
    },
    setRoute,
    start,
    replace,
    refresh,
    tick,
    nextLine,
    edgeIndex,
    commitIndex,
    remaining,
    stateOf,
  };
}
