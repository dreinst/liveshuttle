// Simulasi pelajaran Misi Shuttle Otonom di jalan asli sekitar Universitas Ma Chung.
//
// Isi:
//   - SHUTTLE 01 melayani lima halte yang sama dengan Shuttle 3D Ma Chung, berurutan, dengan rute A*;
//   - penumpang datang secara acak, naik dan turun di halte (pintu kiri, sisi trotoar);
//   - lalu lintas lokal (sepeda motor, mobil, angkot) dan pejalan kaki di sekitar shuttle;
//   - lampu lalu lintas simulasi di dua simpang Jalan Karangampel Timur;
//   - penutupan jalan dengan hitung ulang rute, hujan, statistik misi;
//   - pemantau aturan keras: "Terobos lampu merah" dan "Kontak dengan pejalan kaki" harus selalu 0.
//
// Fisika memakai langkah tetap (dt 1/60 detik). Percepatan waktu menjalankan lebih banyak langkah,
// tidak pernah dt yang lebih besar.

import { Traffic, Vehicle } from './traffic.js';
import { Pedestrians } from './peds.js';
import { brakeLimit, stopDistance, InvariantMonitor } from '../../sim3d/shield.js';
import { Sensor, SensorRig } from '../../engine/sensors.js';
import { mulberry32, kmhToMs } from '../../engine/math.js';
import { segmentIntersection } from '../../engine/geometry.js';
import { COLORS } from '../../engine/theme.js';

export const DT = 1 / 60;
export const CAPACITY = 12;
export const MAX_CLOSED = 2;
/** Perlambatan di atas nilai ini dihitung sebagai pengereman darurat (m/s²). */
export const EMERGENCY_DECEL = 3;
export const RAIN_FACTOR = 0.7;
/** Koefisien gesek ban dengan aspal (perkiraan): kering 0,8, basah 0,5. */
export const MU = { cerah: 0.8, hujan: 0.5 };
export const HALTE_COLORS = ['#f472b6', '#c084fc', '#fb923c', '#60a5fa', '#a3e635'];
export const LIDAR_RANGE = 45;

const INITIAL_PAX = [
  [0, 1],
  [0, 2],
  [1, 3],
  [2, 4],
  [2, 0],
  [3, 4],
  [4, 0],
  [4, 2],
];
/** Posisi awal shuttle: di lajur halte Gerbang Ma Chung, sekitar 80 m sebelum halte. */
const START_BEFORE_HALTE = 78;

export function createWorld(net, { seed = 20260928, npcTarget = 12, pedTarget = 18 } = {}) {
  const city = net.city;
  let rand = mulberry32(seed);
  const rng = () => rand();
  const H = net.halte;
  H.forEach((h, i) => (h.color = HALTE_COLORS[i]));

  const W = {
    time: 0,
    weather: 'cerah',
    limitKmh: 25,
    active: H.map(() => true),
    queues: H.map(() => []),
    unreachable: new Set(),
    skipped: new Set(),
    lastDone: null,
    target: null,
    stopDecision: null,
    mode: 'drive',
    dwell: null,
    onboard: [],
    events: [],
    stats: null,
    loop: null,
    oldRoute: null,
    lastSearch: null,
    pendingLeader: false,
    leader: null,
    nextPax: 5,
    paxSeq: 0,
    emergency: false,
    emergencyAt: -10,
    shieldAt: -10,
    shieldWhat: null,
  };

  // ---------- pemantau aturan keras (terpisah dari perisai) ----------
  // kontak pejalan kaki dihitung InvariantMonitor milik Shuttle 3D (kotak kendaraan vs lingkaran badan)
  const inv = new InvariantMonitor({
    get simTime() {
      return W.time;
    },
  });
  const monitor = {
    redRuns: 0,
    otherCollisions: 0,
    shuttleShield: 0,
    events: inv.events,
    get pedContacts() {
      return inv.pedContact;
    },
    note: (e) => inv.note(e),
    reset() {
      this.redRuns = this.otherCollisions = this.shuttleShield = 0;
      inv.pedContact = 0;
      inv.events.length = 0;
      inv.contacts.clear();
    },
  };

  const app = {
    city,
    rng,
    get simTime() {
      return W.time;
    },
    focus: { x: 0, y: 0 },
    get mu() {
      return MU[W.weather];
    },
    get weather() {
      return W.weather;
    },
    egoSpeedLimit() {
      return kmhToMs(W.limitKmh) * (W.weather === 'hujan' ? RAIN_FACTOR : 1);
    },
    onShield(veh, cons) {
      if (!veh.ego) return;
      monitor.shuttleShield++;
      W.shieldAt = W.time;
      W.shieldWhat = cons.kind;
    },
    onClamp(veh, cons) {
      monitor.note({ type: 'jepit', veh: veh.id, kind: veh.type, what: cons.kind });
    },
  };
  const traffic = new Traffic(app);
  app.traffic = traffic;
  traffic.target = npcTarget;
  const peds = new Pedestrians(app);
  peds.target = pedTarget;
  const J = traffic.junctions;

  // ---------- shuttle ----------
  const sh = new Vehicle('shuttle', { ego: true, rng });
  sh.vDesBase = 30 / 3.6;
  sh.label = 'SHUTTLE 01';
  sh.color = COLORS.ego;
  sh.route = [];

  const lidar = new Sensor('lidar', { range: LIDAR_RANGE, rays: 240, rate: 10, mount: { forward: 0.4 } });
  const kamera = new Sensor('kamera', { rate: 6, mount: { forward: 2.9 } });
  const rig = new SensorRig(sh, [lidar, kamera], { seed: 11 });
  const sensorObjects = [];
  const shelters = H.map((h) => ({ ...h.shelter, id: `halte-${h.id}`, kind: 'building', label: `Halte ${h.name}` }));

  // ---------- posisi di rute ----------

  /** Jarak pusat shuttle ke titik henti halte h di sepanjang rencananya (m), atau null. */
  function distToHalte(h) {
    if (sh.link === h.link && h.s >= sh.s - 1.5) return h.s - sh.s;
    let d = sh.link.len - sh.s;
    for (const l of sh.path) {
      if (l === h.link) return d + h.s;
      d += l.len;
    }
    for (const l of sh.route) {
      if (l === h.link) return d + h.s;
      d += l.len;
    }
    return null;
  }

  /** Titik-titik rute shuttle dari posisinya sampai halte tujuan (untuk digambar). */
  function routePoints(maxLen = 4000) {
    const pts = [];
    const T = W.target != null ? H[W.target] : null;
    const push = (link, s0, s1) => {
      const P = link.poly;
      const a = P.at(Math.max(0, s0), {});
      pts.push({ x: a.x, y: a.z });
      for (let i = 0; i < P.n; i++) if (P.cum[i] > s0 && P.cum[i] < s1) pts.push({ x: P.x[i], y: P.z[i] });
      const b = P.at(Math.min(P.len, s1), {});
      pts.push({ x: b.x, y: b.z });
    };
    let total = 0;
    const links = [sh.link, ...sh.path, ...sh.route];
    for (let i = 0; i < links.length; i++) {
      const l = links[i];
      const s0 = i === 0 ? sh.s : 0;
      let s1 = l.len;
      const end = T && l === T.link && (i > 0 || T.s >= sh.s);
      if (end) s1 = T.s;
      if (s1 > s0) push(l, s0, s1);
      total += s1 - s0;
      if (end || total > maxLen) break;
    }
    return pts;
  }

  // ---------- rencana rute ----------

  /** Potong rencana jalur sampai bagian yang sudah pasti (izin simpang dan jarak henti). */
  function commitPath() {
    const aB = brakeLimit(sh, MU[W.weather]);
    const reach = stopDistance(sh.v, aB) + 8;
    let base = sh.link.len - (sh.s + sh.len / 2);
    let keep = 0;
    let lastGrant = -1;
    for (let i = 0; i < sh.path.length; i++) if (sh.path[i].kind === 'conn' && J.hasGrant(sh, sh.path[i])) lastGrant = i;
    for (let i = 0; i < sh.path.length; i++) {
      if (base > reach && i > lastGrant + 1) break;
      keep = i + 1;
      base += sh.path[i].len;
    }
    if (keep > 0 && sh.path[keep - 1].kind === 'conn' && keep < sh.path.length) keep++;
    if (keep < sh.path.length) {
      sh.path.length = keep;
      sh.pathLen = sh.path.reduce((a, l) => a + l.len, 0);
    }
    sh.route = [];
  }

  /** Rute A* dari ujung rencana jalur sekarang ke halte h. Mengembalikan { links, expanded } atau null. */
  function planFromPathEnd(h) {
    const last = sh.path.length ? sh.path[sh.path.length - 1] : sh.link;
    const startS = sh.path.length ? 0 : sh.s;
    if (last.kind !== 'lane' && last.kind !== 'conn') return null;
    return net.route(last, startS, h);
  }

  const isNeeded = (i) => W.active[i] || W.onboard.some((p) => p.to === i);

  function processHalte(i, how) {
    const L = W.loop;
    if (!L) return;
    if (L.start == null) {
      if (how === 'dilayani' || how === 'dilewati') {
        L.start = i;
        L.count = 0;
        L.red0 = monitor.redRuns;
        L.ped0 = monitor.pedContacts;
        L.t0 = W.time;
      }
      return;
    }
    if (i === L.start) {
      if (how === 'dilayani' || how === 'dilewati') {
        if (L.count > 0) {
          const clean = monitor.redRuns === L.red0 && monitor.pedContacts === L.ped0;
          W.stats.loops++;
          W.events.push({ type: 'loop', clean, time: W.time - L.t0 });
        }
        L.count = 0;
        L.red0 = monitor.redRuns;
        L.ped0 = monitor.pedContacts;
        L.t0 = W.time;
      } else L.start = null;
      return;
    }
    L.count++;
  }

  /** Pilih halte berikutnya mulai dari indeks from, lalu susun rutenya dari ujung rencana jalur. */
  function chooseTarget(from) {
    const before = sh.route.map((l) => l.id).join(',');
    for (let k = 0; k < H.length; k++) {
      const i = (((from + k) % H.length) + H.length) % H.length;
      if (!isNeeded(i)) {
        if (k > 0 || W.target !== i) processHalte(i, 'tidak-dilayani');
        continue;
      }
      const r = H[i].link.closed ? null : planFromPathEnd(H[i]);
      if (r) {
        W.unreachable.delete(i);
        if (W.target !== i) {
          W.target = i;
          W.stopDecision = null;
          sh.stopTarget = null;
        }
        sh.route = r.links.slice(1);
        W.lastSearch = { expanded: r.expanded, cost: r.cost };
        refreshReach();
        return { ok: true, changed: before !== sh.route.map((l) => l.id).join(','), target: i };
      }
      W.unreachable.add(i);
      W.skipped.add(i);
      processHalte(i, 'tak-terjangkau');
    }
    W.target = null;
    W.stopDecision = null;
    sh.stopTarget = null;
    sh.route = [];
    refreshReach();
    return { ok: false, changed: true, target: null };
  }

  /** Hapus tanda "jalannya ditutup" dari halte yang ternyata sudah bisa dicapai lagi. */
  function refreshReach() {
    for (const i of [...W.unreachable]) if (i !== W.target && !H[i].link.closed && planFromPathEnd(H[i])) W.unreachable.delete(i);
  }

  /** Setelah jalan dibuka: layani lagi halte yang tadi dilewati, bila letaknya lebih dekat dari target sekarang. */
  function reconsiderSkipped() {
    if (W.target == null || W.lastDone == null) return null;
    const cur = distToHalte(H[W.target]);
    if (cur == null) return null;
    for (let k = 1; k < H.length; k++) {
      const i = (W.lastDone + k) % H.length;
      if (i === W.target) break;
      if (!W.skipped.has(i) || !isNeeded(i) || H[i].link.closed) continue;
      const r = planFromPathEnd(H[i]);
      if (!r) continue;
      let d = sh.link.len - sh.s + sh.pathLen;
      for (const l of r.links.slice(1)) d += l.len;
      d -= H[i].link.len - H[i].s;
      if (d < cur) {
        W.skipped.delete(i);
        W.unreachable.delete(i);
        W.target = i;
        W.stopDecision = null;
        sh.stopTarget = null;
        sh.route = r.links.slice(1);
        W.lastSearch = { expanded: r.expanded, cost: r.cost };
        return i;
      }
    }
    return null;
  }

  // ---------- penumpang ----------

  function addPax(from, to, t0 = W.time) {
    W.queues[from].push({ id: ++W.paxSeq, from, to, t0 });
  }

  function servable(i) {
    return W.active[i] && !H[i].link.closed;
  }

  function spawnPax() {
    const origins = H.map((h, i) => i).filter((i) => servable(i) && W.queues[i].length < 8);
    if (!origins.length) return;
    const from = origins[Math.floor(rng() * origins.length)];
    const dests = H.map((h, i) => i).filter((i) => i !== from && servable(i));
    if (!dests.length) return;
    addPax(from, dests[Math.floor(rng() * dests.length)]);
  }

  function needStop(i) {
    return W.onboard.some((p) => p.to === i) || (W.queues[i].length > 0 && W.onboard.length < CAPACITY);
  }

  function markDone(i) {
    W.lastDone = i;
    W.skipped.clear();
  }

  function startDwell(h) {
    W.mode = 'dwell';
    W.dwell = { halte: h, phase: 'buka', t: 0, door: 0, anim: null, off: 0, on: 0 };
    sh.holdAtHalte = true;
    markDone(h.index);
    processHalte(h.index, 'dilayani');
    // rute ke halte berikutnya langsung disiapkan, jadi tetap terlihat selama pintu terbuka
    chooseTarget(h.index + 1);
    // shuttle tetap ditahan di halte ini sampai pintu tertutup
    sh.stopTarget = { link: h.link, s: h.s };
  }

  function updateDwell(dt) {
    const D = W.dwell;
    const h = D.halte;
    D.t += dt;
    if (D.anim) {
      D.anim.t += dt;
      if (D.anim.t >= D.anim.dur) {
        if (D.anim.kind === 'turun') {
          W.stats.delivered++;
          D.off++;
        } else {
          W.onboard.push(D.anim.pax);
          D.on++;
          W.events.push({ type: 'board', halte: h });
        }
        D.anim = null;
      }
      return;
    }
    if (D.phase === 'buka') {
      D.door = Math.min(1, D.t / 1.0);
      if (D.t >= 1.0) {
        D.phase = 'turun';
        D.t = 0;
      }
    } else if (D.phase === 'turun') {
      const k = W.onboard.findIndex((p) => p.to === h.index);
      if (k >= 0) {
        const pax = W.onboard.splice(k, 1)[0];
        D.anim = { kind: 'turun', pax, t: 0, dur: 0.55 };
      } else {
        D.phase = 'naik';
        D.t = 0;
      }
    } else if (D.phase === 'naik') {
      const q = W.queues[h.index];
      if (q.length && W.onboard.length < CAPACITY) {
        const pax = q.shift();
        pax.tBoard = W.time;
        W.stats.waitSum += pax.tBoard - pax.t0;
        W.stats.waitN++;
        D.anim = { kind: 'naik', pax, t: 0, dur: 0.65 };
      } else {
        D.phase = 'tutup';
        D.t = 0;
      }
    } else if (D.phase === 'tutup') {
      D.door = Math.max(0, 1 - D.t / 1.0);
      if (D.t >= 1.0) {
        W.mode = 'drive';
        W.dwell = null;
        sh.holdAtHalte = false;
        sh.stopTarget = null;
        W.stopDecision = null;
        // rencana diperbarui (jalan bisa saja ditutup atau dibuka selama pintu terbuka)
        commitPath();
        chooseTarget(W.target ?? h.index + 1);
      }
    }
  }

  function updateHalteDecision() {
    if (W.target == null || W.mode !== 'drive') return;
    const h = H[W.target];
    const d = distToHalte(h);
    if (d == null) return;
    const lock = (sh.v * sh.v) / (2 * 0.9) + 12;
    if (d > lock) W.stopDecision = needStop(h.index) ? 'stop' : 'pass';
    else if (W.stopDecision == null) {
      const comfy = d > (sh.v * sh.v) / (2 * 1.2) + 1;
      W.stopDecision = comfy && needStop(h.index) ? 'stop' : 'pass';
    }
    sh.stopTarget = W.stopDecision === 'stop' ? { link: h.link, s: h.s } : null;
    if (d <= lock && W.stopDecision === 'pass') {
      markDone(h.index);
      processHalte(h.index, 'dilewati');
      chooseTarget(h.index + 1);
      return;
    }
    if (W.stopDecision === 'stop' && sh.link === h.link && Math.abs(sh.s - h.s) < 0.7 && sh.v < 0.05) startDwell(h);
    else if (d < -2) {
      markDone(h.index);
      processHalte(h.index, 'dilewati');
      chooseTarget(h.index + 1);
    }
  }

  // ---------- pemantau ----------

  const prevFront = new Map();

  function recordFronts() {
    prevFront.clear();
    for (const v of traffic.all) prevFront.set(v, v.frontPoint());
  }

  /** Terobos lampu merah: bumper depan memotong garis henti lengan yang sedang merah (geometri). */
  function checkRedRuns() {
    for (const v of traffic.all) {
      const a = prevFront.get(v);
      if (!a) continue;
      const b = v.frontPoint();
      if (a.x === b.x && a.y === b.y) continue;
      for (const hd of net.heads) {
        const L = hd.line;
        const minX = Math.min(L.x0, L.x1) - 1;
        const maxX = Math.max(L.x0, L.x1) + 1;
        const minY = Math.min(L.y0, L.y1) - 1;
        const maxY = Math.max(L.y0, L.y1) + 1;
        if (Math.max(a.x, b.x) < minX || Math.min(a.x, b.x) > maxX || Math.max(a.y, b.y) < minY || Math.min(a.y, b.y) > maxY) continue;
        // hanya kendaraan yang bergerak searah lengan (masuk ke persimpangan)
        if ((b.x - a.x) * Math.cos(L.h) + (b.y - a.y) * Math.sin(L.h) <= 0) continue;
        // garis henti diperpanjang 0,3 m di kedua ujung
        const ux = (L.x1 - L.x0) / L.half;
        const uy = (L.y1 - L.y0) / L.half;
        const p0 = { x: L.x0 - ux * 0.3, y: L.y0 - uy * 0.3 };
        const p1 = { x: L.x1 + ux * 0.3, y: L.y1 + uy * 0.3 };
        if (!segmentIntersection(a, b, p0, p1)) continue;
        if (hd.ctl.color(hd.arm) === 'red') {
          monitor.redRuns++;
          monitor.note({ type: 'lampu-merah', veh: v.id, kind: v.type, where: hd.name });
        }
      }
    }
  }

  // ---------- langkah ----------

  let balanceAt = 0;
  let hiddenFn = null;

  function update(dt) {
    W.time += dt;
    W.stats.time = W.time;
    for (const ctl of net.signals) ctl.step(dt);
    app.focus.x = sh.x;
    app.focus.y = sh.z;

    W.nextPax -= dt;
    if (W.nextPax <= 0) {
      spawnPax();
      W.nextPax = 6 + rng() * 8;
    }

    if (W.pendingLeader && W.mode === 'drive' && sh.v > 1) placeLeaderNow();
    if (W.leader) {
      const Lv = W.leader;
      if (!Lv.alive) W.leader = null;
      else {
        // angkot pelan tetap di depan shuttle: merayap bila shuttle tertinggal jauh
        const far = Math.hypot(Lv.x - sh.x, Lv.z - sh.z) > 45;
        Lv.vDesBase = kmhToMs(W.limitKmh) * (far ? 0.3 : 0.55);
      }
    }

    traffic.beginTick();
    peds.step(dt);
    if (peds.lastTest) W.events.push({ type: 'test-ped', ped: peds.lastTest });
    J.beginTick();
    traffic.requestAll();
    J.process();
    recordFronts();
    const odo0 = sh.odo;
    traffic.stepAll(dt);
    W.stats.distance += sh.odo - odo0;

    if (W.mode === 'dwell') updateDwell(dt);
    else updateHalteDecision();

    // pengereman darurat (tepi naik)
    const emergency = sh.a < -EMERGENCY_DECEL && sh.v > 0.3;
    if (emergency && !W.emergency) {
      W.stats.emergencies++;
      W.emergencyAt = W.time;
      W.events.push({ type: 'emergency', reason: sh.planReason });
    }
    W.emergency = emergency;

    checkRedRuns();
    inv.checkContacts(traffic.all, peds.grid);
    const fresh = traffic.checkOverlaps();
    if (fresh) monitor.otherCollisions += fresh;

    if (W.time >= balanceAt) {
      balanceAt = W.time + 0.5;
      traffic.balance(hiddenFn);
      peds.balance();
      traffic.watchdog();
    }
    traffic.updateFades(dt);
  }

  // ---------- sensor (untuk tampilan dan panel, tidak dipakai keputusan) ----------

  function updateSensorObjects() {
    sensorObjects.length = 0;
    const r = LIDAR_RANGE + 12;
    for (const b of net.map.buildingsNear(sh.x, sh.z, r)) sensorObjects.push(b);
    for (const s of shelters) if (Math.hypot(s.x - sh.x, s.y - sh.z) < r) sensorObjects.push(s);
    for (const c of traffic.cars) if (Math.hypot(c.x - sh.x, c.z - sh.z) < r && c.alpha > 0.3) sensorObjects.push(c);
    for (const p of peds.peds) if (Math.hypot(p.x - sh.x, p.z - sh.z) < r && p.alpha > 0.3) sensorObjects.push(p);
    for (const hd of net.heads) {
      hd.light.state = hd.ctl.color(hd.arm);
      if (Math.hypot(hd.light.x - sh.x, hd.light.y - sh.z) < 80) sensorObjects.push(hd.light);
    }
  }

  /** Pindai sensor. lapse = percepatan waktu: pindaian tetap sekitar 10 kali per detik waktu nyata. */
  function scanSensors(dt, lapse = 1) {
    lidar.rate = 10 / Math.max(1, lapse);
    kamera.rate = 6 / Math.max(1, lapse);
    updateSensorObjects();
    rig.update(dt, sensorObjects, W.weather);
  }

  // ---------- aksi dari panel ----------

  function placeLeaderNow() {
    // cari tempat di lajur lurus 25 sampai 45 m di depan bumper shuttle
    const front = sh.s + sh.len / 2;
    let base = sh.link.len - front;
    for (let i = 0; i < sh.path.length; i++) {
      const l = sh.path[i];
      if (l.kind === 'lane' && l.ring === null && !l.sig) {
        for (let want = 25; want <= 45; want += 5) {
          const s = want - base;
          if (s < 4 || s > l.len - 8) continue;
          if (!traffic.spawnFree(l, s, 4.15, 6)) continue;
          const a = traffic.makeNpc('angkot');
          a.leader = true;
          a.alpha = 0;
          a.fade = 1;
          a.route = [...sh.path.slice(i + 1), ...sh.route];
          traffic.addAt(a, l, s, Math.min(sh.v, 4));
          W.leader = a;
          W.pendingLeader = false;
          return true;
        }
      }
      base += l.len;
      if (base > 60) break;
    }
    return false;
  }

  function releaseLeader() {
    W.pendingLeader = false;
    if (W.leader) {
      W.leader.leader = false;
      W.leader.vDesBase = W.leader.dyn.vDes[0];
    }
    W.leader = null;
  }

  /** Jalan-jalan di rute shuttle yang belum pasti dilewati (setelah bagian yang sudah pasti). */
  function roadsAhead() {
    const aB = brakeLimit(sh, MU[W.weather]);
    const reach = stopDistance(sh.v, aB) + 8;
    const all = [...sh.path, ...sh.route];
    let lastGrant = -1;
    for (let i = 0; i < all.length; i++) if (all[i].kind === 'conn' && J.hasGrant(sh, all[i])) lastGrant = i;
    let base = sh.link.len - (sh.s + sh.len / 2);
    const out = [];
    for (let i = 0; i < all.length; i++) {
      const l = all[i];
      if (base > reach && i > lastGrant + 1 && l.kind === 'lane' && l.roadId >= 0 && l !== sh.link) {
        const R = net.roadById.get(l.roadId);
        if (R && !out.includes(R)) out.push(R);
      }
      base += l.len;
    }
    return out;
  }

  /** Apakah putaran masih bisa dijalankan setelah penutupan? */
  function loopFeasible() {
    const act = H.map((h, i) => i).filter((i) => W.active[i] && !H[i].link.closed);
    if (act.length < 2) return false;
    for (let k = 0; k < act.length; k++) {
      const a = H[act[k]];
      const b = H[act[(k + 1) % act.length]];
      if (!net.route(a.link, a.s, b)) return false;
    }
    return true;
  }

  /** Kendaraan lain yang rencananya melewati jalan yang ditutup memilih belokan lain (bila belum terlanjur). */
  function fixCarPaths() {
    for (const c of traffic.cars) {
      const f = c.path.findIndex((l) => l.closed || (l.kind === 'conn' && l.to.closed));
      if (f < 0) continue;
      let lastGrant = -1;
      for (let i = 0; i < c.path.length; i++) if (c.path[i].kind === 'conn' && J.hasGrant(c, c.path[i])) lastGrant = i;
      let keep = f;
      if (lastGrant >= 0) keep = Math.max(keep, lastGrant + 2);
      if (c.link.kind === 'conn') keep = Math.max(keep, 1);
      keep = Math.min(keep, c.path.length);
      if (keep < c.path.length) {
        c.path.length = keep;
        c.pathLen = c.path.reduce((a, l) => a + l.len, 0);
        c.route = null;
        traffic.extendPath(c);
      }
    }
  }

  function toggleRoad(roadId) {
    const R = net.roadById.get(roadId);
    if (!R) return { ok: false, msg: 'Jalan tidak dikenal.' };
    if (net.closed.has(roadId)) {
      net.setClosed(roadId, false);
      fixCarPaths();
      commitPath();
      chooseTarget(W.target ?? 0);
      const back = reconsiderSkipped();
      return { ok: true, closed: false, road: R, back };
    }
    if (net.closed.size >= MAX_CLOSED) return { ok: false, msg: `Paling banyak ${MAX_CLOSED} jalan bisa ditutup sekaligus. Buka salah satu dulu.` };
    const onRoute = [sh.link, ...sh.path, ...sh.route].some((l) => l.roadId === roadId);
    const oldPts = routePoints();
    const beforeIds = [...sh.path, ...sh.route].map((l) => l.id).join(',');
    const saved = { path: sh.path.slice(), pathLen: sh.pathLen, route: sh.route.slice() };
    net.setClosed(roadId, true);
    // shuttle harus tetap punya jalan: putaran halte masih bisa dijalankan dan ada halte yang terjangkau
    let ok = loopFeasible();
    if (ok && W.mode === 'drive') {
      commitPath();
      ok = H.some((h, i) => isNeeded(i) && !h.link.closed && planFromPathEnd(h));
    }
    if (!ok) {
      net.setClosed(roadId, false);
      sh.path = saved.path;
      sh.pathLen = saved.pathLen;
      sh.route = saved.route;
      return { ok: false, msg: `${R.name || 'Jalan ini'} tidak bisa ditutup. Shuttle tidak punya jalan lain untuk menyelesaikan putarannya (shuttle tidak putar balik).` };
    }
    fixCarPaths();
    const prevTarget = W.target;
    let res = { ok: true, target: W.target };
    if (W.mode === 'drive') res = chooseTarget(W.target ?? 0);
    const changed = beforeIds !== [...sh.path, ...sh.route].map((l) => l.id).join(',');
    const rerouted = onRoute && changed;
    if (rerouted) {
      W.oldRoute = { pts: oldPts, time: W.time };
      W.events.push({ type: 'reroute', road: R, target: W.target, prevTarget, expanded: W.lastSearch?.expanded ?? 0 });
    }
    return { ok: true, closed: true, road: R, onRoute, rerouted, target: res.target ?? W.target, prevTarget };
  }

  /** Tutup jalan pertama di rute shuttle yang boleh ditutup. */
  function closeAhead() {
    if (net.closed.size >= MAX_CLOSED) return { ok: false, msg: `Paling banyak ${MAX_CLOSED} jalan bisa ditutup sekaligus. Buka salah satu dulu.` };
    const goalRoad = W.target != null ? H[W.target].link.roadId : -1;
    const ahead = roadsAhead().filter((R) => !net.closed.has(R.id));
    ahead.sort((a, b) => (a.id === goalRoad) - (b.id === goalRoad));
    let lastMsg = null;
    for (const R of ahead) {
      const r = toggleRoad(R.id);
      if (r.ok) return r;
      lastMsg = r.msg;
    }
    return { ok: false, msg: lastMsg || 'Belum ada jalan di depan shuttle yang bisa ditutup. Tunggu sebentar lalu coba lagi.' };
  }

  function openAll() {
    if (!net.closed.size) return { ok: false, back: null };
    for (const id of [...net.closed]) net.setClosed(id, false);
    fixCarPaths();
    commitPath();
    chooseTarget(W.target ?? 0);
    return { ok: true, back: reconsiderSkipped() };
  }

  function setActive(i, on) {
    if (!on && W.active.filter(Boolean).length <= 2) return { ok: false, msg: 'Minimal dua halte harus tetap dilayani.' };
    W.active[i] = on;
    if (!on && !loopFeasible()) {
      W.active[i] = true;
      return { ok: false, msg: 'Halte ini masih dibutuhkan karena ada jalan yang ditutup. Buka jalannya dulu.' };
    }
    let left = 0;
    if (!on) {
      left = W.queues[i].length;
      W.queues[i].length = 0;
      for (const q of W.queues) {
        const n = q.length;
        for (let k = q.length - 1; k >= 0; k--) if (q[k].to === i) q.splice(k, 1);
        left += n - q.length;
      }
    }
    if (W.target != null) {
      const d = distToHalte(H[W.target]);
      const locked = W.mode === 'drive' && d != null && d <= (sh.v * sh.v) / (2 * 0.9) + 12;
      if (!locked && !isNeeded(W.target) && W.mode === 'drive') {
        commitPath();
        chooseTarget(W.target + 1);
      }
    } else if (W.mode === 'drive') {
      commitPath();
      chooseTarget(i);
    }
    return { ok: true, left };
  }

  function setWeather(w) {
    W.weather = w;
  }

  function setLimit(kmh) {
    W.limitKmh = kmh;
  }

  function resetLoop() {
    W.loop = { start: null, count: 0, red0: monitor.redRuns, ped0: monitor.pedContacts, t0: W.time };
  }

  function placeLeader() {
    W.pendingLeader = true;
  }

  /** Pastikan ada penumpang yang menunggu di halte i (preset langkah pertama). */
  function seedPassengers(i, n = 2) {
    if (!servable(i)) return;
    const dests = H.map((h, k) => k).filter((k) => k !== i && servable(k));
    for (let k = W.queues[i].length; k < n && dests.length; k++) addPax(i, dests[(k + i) % dests.length]);
  }

  function requestTestPed() {
    return peds.requestTest(sh);
  }

  // ---------- ulang ----------

  function reset() {
    rand = mulberry32(seed);
    W.time = 0;
    W.stats = { delivered: 0, distance: 0, time: 0, waitSum: 0, waitN: 0, emergencies: 0, loops: 0 };
    W.events.length = 0;
    W.queues = H.map(() => []);
    W.unreachable.clear();
    W.skipped.clear();
    W.lastDone = null;
    W.oldRoute = null;
    W.pendingLeader = false;
    W.leader = null;
    W.nextPax = 5;
    W.paxSeq = 0;
    W.mode = 'drive';
    W.dwell = null;
    W.onboard = [];
    W.target = null;
    W.stopDecision = null;
    W.emergency = false;
    W.emergencyAt = -10;
    W.shieldAt = -10;
    W.shieldWhat = null;
    balanceAt = 0;
    monitor.reset();
    for (const ctl of net.signals) ctl.reset();
    // semua kendaraan dan pejalan kaki dibuang
    for (const v of traffic.all.slice()) traffic.removeVeh(v);
    traffic.stats.clamps = traffic.stats.followClamps = traffic.stats.lineClamps = 0;
    traffic.stats.recovered = traffic.stats.overlaps = 0;
    traffic.overlapPairs.clear();
    peds.clear();
    for (const l of city.links) {
      l.occN = 0;
      l.pedN = 0;
      if (l.holders) l.holders.length = 0;
      if (l.approach) l.approach.length = 0;
    }
    for (const [from, to] of INITIAL_PAX) if (servable(from) && servable(to)) addPax(from, to, 0);
    resetLoop();

    // shuttle di lajur halte Gerbang Ma Chung, menuju halte itu
    const h0 = H[0];
    sh.alive = true;
    sh.grants.length = 0;
    sh.reqConn = null;
    sh.rbExit = null;
    sh.rbExitPending = null;
    sh.holdAtHalte = false;
    sh.stopTarget = null;
    sh.sigKey = 0;
    sh.sigArmCtl = null;
    sh.sigDecision = '';
    sh.stuckT = 0;
    sh.shieldOn = false;
    sh.odo = 0;
    sh.route = [];
    sh.place(h0.link, Math.max(sh.len / 2 + 1, h0.s - START_BEFORE_HALTE), 0);
    traffic.all.push(sh);
    app.focus.x = sh.x;
    app.focus.y = sh.z;
    chooseTarget(0);
    traffic.extendPath(sh);
    // lalu lintas dan pejalan kaki awal di sekitar shuttle (langsung terlihat, tanpa memudar)
    traffic.beginTick();
    peds.register();
    for (let i = 0; i < traffic.target * 3 && traffic.cars.length < traffic.target; i++) traffic.spawnNear(25, traffic.radius - 20, null, false);
    for (let i = 0; i < peds.target * 3 && peds.peds.length < peds.target; i++) peds.spawnNear(10, peds.radius, false);
    traffic.beginTick();
    peds.register();
    rig.clear();
    updateSensorObjects();
    rig.scanNow(sensorObjects, W.weather);
  }

  reset();

  return {
    W,
    sh,
    net,
    traffic,
    peds,
    rig,
    lidar,
    kamera,
    monitor,
    app,
    reset,
    update,
    scanSensors,
    toggleRoad,
    closeAhead,
    openAll,
    setActive,
    setWeather,
    setLimit,
    placeLeader,
    releaseLeader,
    seedPassengers,
    resetLoop,
    requestTestPed,
    routePoints,
    distToHalte,
    isNeeded,
    setHidden(fn) {
      hiddenFn = fn;
    },
    get sensorObjects() {
      return sensorObjects;
    },
  };
}
