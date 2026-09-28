// Simulasi pelajaran Misi Shuttle Otonom: shuttle, mobil lain, pejalan kaki, penumpang.
//
// Semua kendaraan memakai aturan yang sama:
//   - rute berupa deretan link (lajur berarah) yang disambung kurva penghubung di persimpangan;
//   - jarak ke kendaraan di depan diatur dengan Intelligent Driver Model (IDM);
//   - berhenti di garis henti bila lampu merah, atau kuning dan masih sempat berhenti nyaman;
//   - masuk persimpangan hanya dengan "reservasi": lintasannya tidak boleh bersilangan dengan
//     kendaraan yang sudah memegang reservasi, dan lajur tujuannya harus ada ruang;
//   - memberi jalan ke pejalan kaki di zebra cross.
// Shuttle memakai model sepeda kinematik (engine Vehicle) dengan kemudi pure pursuit. Mobil lain
// disederhanakan: posisinya mengikuti garis lajur dengan tepat.
//
// Rute shuttle antarhalte dicari dengan A* dari engine/planning.js. Karena shuttle tidak bisa
// putar balik, keadaan pencarian adalah link (ruas beserta arah datangnya). Node saja tidak cukup.
// Biaya pindah ke link = panjang ruasnya, heuristik = jarak garis lurus (admissible).

import { Vehicle } from '../../engine/vehicle.js';
import { Path, joinPolylines, boxesOverlap, distanceToBox } from '../../engine/geometry.js';
import { findPath } from '../../engine/planning.js';
import { purePursuit } from '../../engine/control.js';
import { Rng, clamp, kmhToMs, angleDiff, wrapAngle } from '../../engine/math.js';
import { shouldStopForYellow } from '../../engine/traffic.js';
import { Sensor, SensorRig } from '../../engine/sensors.js';
import { COLORS } from '../../engine/theme.js';
import {
  LINKS,
  MOVES,
  NODE_LIST,
  ROADS,
  PLANS,
  LIGHTS,
  ZEBRAS,
  HALTE,
  HALF_W,
  BUILDINGS,
  TRUNKS,
  SHELTERS,
  PARKED,
  openDegree,
} from './campus.js';

export const CAPACITY = 12;
export const MAX_CLOSED = 2;
export const EMERGENCY_DECEL = 3; // m/s^2, di atas ini dihitung pengereman darurat
export const RAIN_FACTOR = 0.7;
export const COMFORT_YELLOW = 2.5; // perlambatan nyaman untuk dilema lampu kuning
const START = '__mulai__';
const SHUTTLE_START = { link: 'B>D', x: 1.75, y: 24 };
const CAR_STARTS = [
  { link: 'E>F', at: 22, cruiseF: 0.86, color: COLORS.vehicles[0] },
  { link: 'H>E', at: 12, cruiseF: 0.95, color: COLORS.vehicles[2] },
  { link: 'D>B', at: 30, cruiseF: 0.9, color: COLORS.vehicles[4] },
];
const INITIAL_PAX = [
  [0, 1],
  [0, 2],
  [0, 3],
  [1, 3],
  [2, 4],
  [2, 0],
  [3, 4],
  [4, 0],
  [4, 2],
];

// ---------- rute ----------

/** Susun rute dari daftar id link: path gabungan, posisi tiap link, kurva, dan zebra cross. */
export function buildRoute(ids) {
  const polys = [];
  const segs = [];
  const zebras = [];
  let s = 0;
  for (let i = 0; i < ids.length; i++) {
    const L = LINKS[ids[i]];
    const seg = { link: L, s0: s, s1: s + L.length, move: null, b1: s + L.length };
    polys.push(L.pts);
    s = seg.s1;
    for (const z of L.zebras) zebras.push({ zebra: z.zebra, s0: seg.s0 + z.s0, s1: seg.s0 + z.s1 });
    if (i + 1 < ids.length) {
      const M = MOVES.get(`${L.id}|${ids[i + 1]}`);
      if (!M) throw new Error(`Tidak ada gerakan ${L.id} ke ${ids[i + 1]}`);
      polys.push(M.points);
      s += M.length;
      seg.move = M;
      seg.b1 = s;
    }
    segs.push(seg);
  }
  const pts = joinPolylines(...polys);
  const path = new Path(pts);
  // jari-jari lengkung di tiap titik, untuk batas kecepatan belok
  const radius = new Float64Array(pts.length).fill(Infinity);
  for (let i = 1; i < pts.length - 1; i++) {
    const l1 = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    const l2 = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    const h1 = Math.atan2(pts[i].y - pts[i - 1].y, pts[i].x - pts[i - 1].x);
    const h2 = Math.atan2(pts[i + 1].y - pts[i].y, pts[i + 1].x - pts[i].x);
    const k = Math.abs(wrapAngle(h2 - h1)) / Math.max(0.3, (l1 + l2) / 2);
    if (k > 1e-3) radius[i] = 1 / k;
  }
  return { ids: [...ids], segs, zebras, path, radius };
}

function indexAt(path, s) {
  const cum = path.cum;
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  return lo;
}

// ---------- dunia ----------

export function createWorld() {
  const rng = new Rng(20250901);
  const W = {
    time: 0,
    weather: 'cerah',
    limitKmh: 20,
    closed: new Set(),
    cones: [],
    active: HALTE.map(() => true),
    queues: HALTE.map(() => []),
    unreachable: new Set(),
    skipped: new Set(), // halte yang dilewati karena tak terjangkau sejak halte terakhir
    lastDone: null,
    cars: [],
    peds: [],
    movers: [],
    events: [],
    stats: null,
    loop: null,
    oldRoute: null,
    lastSearch: null,
    pendingLeader: false,
    collisions: 0,
    paxSeq: 0,
    pedSeq: 0,
    nextPax: 3,
  };

  // ---------- shuttle ----------
  const sh = new Vehicle({
    id: 'shuttle',
    kind: 'shuttle',
    label: 'SHUTTLE 01',
    ego: true,
    length: 5,
    width: 2.1,
    wheelbase: 3.2,
    maxSteer: 0.6,
    steerRate: 1.1,
    maxAccel: 1.2,
    maxBrake: 6,
    maxSpeed: 10,
    color: COLORS.ego,
  });
  sh.isShuttle = true;
  W.sh = sh;

  const rig = new SensorRig(
    sh,
    [new Sensor('lidar', { rays: 360, rate: 10, mount: { forward: 0.3 } }), new Sensor('kamera', { rate: 8, mount: { forward: 2.3 } })],
    { seed: 11 },
  );
  W.rig = rig;
  const staticObjects = [...BUILDINGS, ...SHELTERS, ...TRUNKS, ...LIGHTS, ...PARKED];
  const sensorObjects = [];

  // ---------- parameter per kendaraan ----------
  function params(m) {
    const wet = W.weather === 'hujan';
    const limit = kmhToMs(W.limitKmh);
    if (m.isShuttle) {
      return { v0: limit * (wet ? RAIN_FACTOR : 1), a: 1.0, b: 1.5, tau: wet ? 3 : 1.5, g0: wet ? 5 : 3, aMax: wet ? 4 : 6, lat: 1.2 };
    }
    return { v0: limit * m.cruiseF * (wet ? 0.8 : 1), a: 1.6, b: 2.0, tau: wet ? 2.2 : 1.2, g0: wet ? 4 : 2.5, aMax: wet ? 4 : 6, lat: 1.8 };
  }
  W.params = params;

  // ---------- posisi di rute ----------
  const front = (m) => m.s + m.length / 2;
  const rear = (m) => m.s - m.length / 2;

  function locate(m) {
    const segs = m.route.segs;
    let i = 0;
    while (i + 1 < segs.length && m.s >= segs[i + 1].s0) i++;
    return i;
  }

  /** Link tempat kendaraan berada dan jarak bagian belakangnya dari awal lajur itu. */
  function linkPos(m) {
    const segs = m.route.segs;
    const i = locate(m);
    const seg = segs[i];
    if (m.s <= seg.s1 || !seg.move) return { link: seg.link, sRear: rear(m) - seg.s0, sFront: front(m) - seg.s0, inBox: false };
    return { link: seg.move.out, sRear: rear(m) - seg.b1, sFront: front(m) - seg.b1, inBox: true, node: seg.move.node };
  }
  W.linkPos = linkPos;

  function committedIds(m) {
    const segs = m.route.segs;
    const i = locate(m);
    const ids = m.route.ids.slice(0, i + 1);
    const seg = segs[i];
    if (seg.move && (front(m) > seg.s1 - 0.2 || (m.res && m.res.move === seg.move))) ids.push(seg.move.out.id);
    return ids;
  }

  function release(m) {
    if (!m.res) return;
    m.res.node.res.delete(m.id);
    m.res = null;
  }

  function setRoute(m, ids) {
    const keepS = m.s;
    m.route = buildRoute(ids);
    m.s = keepS;
    if (m.res && !m.route.segs.some((sg) => sg.move === m.res.move)) release(m);
  }

  /** Buang link yang sudah dilewati supaya path tetap pendek. */
  function shiftRoute(m) {
    const segs = m.route.segs;
    if (segs.length > 1 && rear(m) > segs[1].s0 + 1.5) {
      const off = segs[1].s0;
      m.route = buildRoute(m.route.ids.slice(1));
      m.s -= off;
    }
  }

  // ---------- A* ----------
  const isOpen = (linkId) => !W.closed.has(LINKS[linkId].road.id);

  function astar(fromId, goalId) {
    const L0 = LINKS[fromId];
    const G = LINKS[goalId];
    const space = {
      neighbors(id) {
        const L = id === START ? L0 : LINKS[id];
        const out = [];
        for (const n of L.next) if (isOpen(n)) out.push([n, LINKS[n].cost]);
        return out;
      },
      heuristic(id, goal) {
        if (id === goal) return 0;
        const L = id === START ? L0 : LINKS[id];
        return Math.hypot(L.to.x - G.from.x, L.to.y - G.from.y) + G.cost;
      },
    };
    return findPath(space, START, goalId, { algorithm: 'astar' });
  }

  /** Rencana rute shuttle ke halte H dari posisinya sekarang. Mengembalikan daftar id link atau null. */
  function planTo(H, { forceLoop = false } = {}) {
    const comm = committedIds(sh);
    const last = comm[comm.length - 1];
    const i = locate(sh);
    const cur = sh.route.segs[i];
    const frontOnLast = last === cur.link.id && comm.length === i + 1 ? front(sh) - cur.s0 : -Infinity;
    // saat sedang menepi ke halte ini, titik henti yang tinggal beberapa sentimeter tetap dianggap di depan
    const arriving = sh.mode === 'drive' && sh.target === H.index && sh.stopDecision === 'stop';
    if (!forceLoop && H.link.id === last && H.s > frontOnLast + (arriving ? -1.0 : 0.3)) {
      W.lastSearch = { expanded: 0, cost: 0, trivial: true };
      return comm;
    }
    if (!isOpen(H.link.id)) return null;
    const res = astar(last, H.link.id);
    if (!res.found) return null;
    W.lastSearch = { expanded: res.expanded, cost: res.cost, trivial: false };
    return [...comm, ...res.path.slice(1)];
  }

  const isNeeded = (i) => W.active[i] || sh.onboard.some((p) => p.to === i);

  function processHalte(i, how) {
    const L = W.loop;
    if (!L) return;
    if (L.start == null) {
      if (how === 'dilayani' || how === 'dilewati') {
        L.start = i;
        L.count = 0;
        L.viol0 = W.stats.violations;
        L.t0 = W.time;
      }
      return;
    }
    if (i === L.start) {
      if (how === 'dilayani' || how === 'dilewati') {
        if (L.count > 0) {
          const clean = W.stats.violations === L.viol0;
          W.stats.loops++;
          W.events.push({ type: 'loop', clean, time: W.time - L.t0 });
        }
        L.count = 0;
        L.viol0 = W.stats.violations;
        L.t0 = W.time;
      } else L.start = null;
      return;
    }
    L.count++;
  }

  /** Pilih halte berikutnya mulai dari indeks `from`, lalu susun rutenya. */
  function chooseTarget(from, { notNow = null } = {}) {
    const before = sh.route.ids.join(',');
    for (let k = 0; k < HALTE.length; k++) {
      const i = (from + k) % HALTE.length;
      const H = HALTE[i];
      if (!isNeeded(i)) {
        if (k > 0 || sh.target !== i) processHalte(i, 'tidak-dilayani');
        continue;
      }
      // halte yang baru saja dilayani atau dilewati baru bisa dikunjungi lagi setelah satu putaran
      const ids = planTo(H, { forceLoop: i === notNow });
      if (ids) {
        W.unreachable.delete(i);
        if (sh.target !== i) {
          sh.target = i;
          sh.stopDecision = null;
        }
        setRoute(sh, ids);
        refreshReach();
        return { ok: true, changed: before !== ids.join(','), target: i };
      }
      W.unreachable.add(i);
      W.skipped.add(i);
      processHalte(i, 'tak-terjangkau');
    }
    sh.target = null;
    sh.stopDecision = null;
    setRoute(sh, committedIds(sh));
    refreshReach();
    return { ok: false, changed: true, target: null };
  }

  /** Hapus tanda "jalannya ditutup" dari halte yang ternyata sudah bisa dicapai lagi. */
  function refreshReach() {
    const saved = W.lastSearch;
    for (const i of [...W.unreachable]) if (i !== sh.target && planTo(HALTE[i])) W.unreachable.delete(i);
    W.lastSearch = saved;
  }

  /**
   * Setelah jalan dibuka: halte yang tadi dilewati karena jalannya ditutup (di antara halte terakhir
   * dan target sekarang) dilayani lagi, asalkan letaknya searah, yaitu lebih dekat dari target sekarang.
   * Mengembalikan indeks halte itu, atau null.
   */
  function reconsiderSkipped() {
    if (sh.target == null || W.lastDone == null) return null;
    const curS = stopSOnRoute(HALTE[sh.target]);
    if (curS == null) return null;
    const curLeft = curS - front(sh);
    const n = HALTE.length;
    for (let k = 1; k < n; k++) {
      const i = (W.lastDone + k) % n;
      if (i === sh.target) break;
      if (!W.skipped.has(i) || !isNeeded(i)) continue;
      const saved = W.lastSearch;
      const ids = planTo(HALTE[i]);
      if (ids) {
        const R = buildRoute(ids);
        let sS = null;
        for (const sg of R.segs) if (sg.link === HALTE[i].link) sS = sg.s0 + HALTE[i].s;
        if (sS != null && sS - front(sh) < curLeft) {
          W.skipped.delete(i);
          W.unreachable.delete(i);
          sh.target = i;
          sh.stopDecision = null;
          setRoute(sh, ids);
          return i;
        }
      }
      W.lastSearch = saved;
    }
    return null;
  }

  function stopSOnRoute(H) {
    const segs = sh.route.segs;
    for (let k = segs.length - 1; k >= 0; k--) if (segs[k].link === H.link) return segs[k].s0 + H.s;
    return null;
  }
  W.stopS = () => (sh.target == null ? null : stopSOnRoute(HALTE[sh.target]));

  // ---------- mobil lain ----------
  function makeCar(spec, i) {
    return {
      id: `mobil-${i + 1}`,
      kind: 'car',
      label: 'Mobil',
      length: 4.5,
      width: 1.8,
      color: spec.color,
      cruiseF: spec.cruiseF,
      baseCruiseF: spec.cruiseF,
      x: 0,
      y: 0,
      heading: 0,
      speed: 0,
      vx: 0,
      vy: 0,
      braking: false,
      route: null,
      s: 0,
      res: null,
      yellow: new Map(),
      dec: { code: 'melaju' },
      accel: 0,
    };
  }

  // urutan jalan lingkar searah layanan shuttle (untuk mobil pelan di depan shuttle)
  const RING_NEXT = { 'D>H': 'H>F', 'H>F': 'F>B', 'F>B': 'B>D', 'B>D': 'D>H' };

  function extendCar(c) {
    let guard = 0;
    while (c.route.ids.length < 3 && guard++ < 5) {
      const last = LINKS[c.route.ids[c.route.ids.length - 1]];
      const opts = last.next.filter(isOpen);
      if (!opts.length) break;
      const ring = c.leader ? RING_NEXT[last.id] : null;
      c.route = buildRoute([...c.route.ids, ring && opts.includes(ring) ? ring : rng.pick(opts)]);
    }
  }

  function syncCarPose(c) {
    const p = c.route.path.sample(c.s);
    c.x = p.x;
    c.y = p.y;
    c.heading = p.heading;
    c.vx = Math.cos(p.heading) * c.speed;
    c.vy = Math.sin(p.heading) * c.speed;
  }

  // ---------- pengambilan keputusan (dipakai semua kendaraan) ----------

  function findLeader(m) {
    const path = m.route.path;
    const hint = m.s + 30;
    let best = null;
    for (const o of W.movers) {
      if (o === m) continue;
      const dx = o.x - m.x;
      const dy = o.y - m.y;
      if (dx * dx + dy * dy > 75 * 75) continue;
      const c = path.closest(o.x, o.y, hint, 48);
      if (c.s <= m.s + 0.3 || Math.abs(c.lateral) > 2.1) continue;
      const dh = Math.abs(angleDiff(o.heading, c.heading));
      const ext = Math.abs(Math.cos(dh)) * (o.length / 2) + Math.abs(Math.sin(dh)) * (o.width / 2);
      const gap = c.s - front(m) - ext;
      if (!best || gap < best.gap) best = { gap, v: Math.max(0, o.speed * Math.cos(dh)), obj: o, sRear: c.s - ext, ped: false };
    }
    for (const p of W.peds) {
      if (p.state !== 'cross' || Math.abs(p.off) > HALF_W + 0.3) continue;
      const dx = p.x - m.x;
      const dy = p.y - m.y;
      if (dx * dx + dy * dy > 40 * 40) continue;
      const c = path.closest(p.x, p.y, hint, 48);
      if (c.s <= m.s || Math.abs(c.lateral) > m.width / 2 + 0.8) continue;
      const gap = c.s - front(m) - p.radius;
      if (!best || gap < best.gap) best = { gap, v: 0, obj: p, sRear: c.s, ped: true };
    }
    return best;
  }

  function tryReserve(m, node, move) {
    for (const [id, r] of node.res) {
      if (id === m.id) continue;
      if (move.conflicts.has(r.move)) return { ok: false, why: 'silang', other: r.mover };
    }
    const need = m.length + 3;
    for (const o of W.movers) {
      if (o === m) continue;
      const pos = linkPos(o);
      if (pos.link === move.out && pos.sRear < need && o.speed < 1.2) return { ok: false, why: 'penuh', other: o };
    }
    release(m);
    node.res.set(m.id, { move, mover: m });
    m.res = { node, move, go: false };
    return { ok: true };
  }

  /** Keadaan persimpangan berikutnya: batas kecepatan dan/atau titik henti. */
  function junction(m, P, lead) {
    const v = m.speed;
    const f = front(m);
    for (const seg of m.route.segs) {
      if (!seg.move) return null;
      const d = seg.s1 - f;
      if (d < -0.2) continue;
      if (d > 70) return null;
      const node = seg.move.node;
      const light = seg.link.light;
      const cap = light ? null : { v: Math.sqrt(3.2 * 3.2 + 2 * 1.0 * Math.max(0, d - 1)), code: 'simpang', info: { node } };
      if (m.res && m.res.move === seg.move) {
        if (light && !m.res.go) {
          if (light.state === 'red') {
            release(m);
            return { stop: d, code: 'merah', info: { node, light } };
          }
          if (light.state === 'yellow') {
            if (shouldStopForYellow(d, v, COMFORT_YELLOW)) {
              release(m);
              return { stop: d, code: 'kuning', info: { node, light } };
            }
            m.res.go = true;
          }
        }
        return m.res.go && light && light.state !== 'green' ? { go: 'kuning-terus', info: { node, light }, cap } : { go: 'lewat', info: { node, move: seg.move }, cap };
      }
      if (light) {
        if (light.state === 'red') return { stop: d, code: 'merah', info: { node, light } };
        if (light.state === 'yellow') {
          let dec = m.yellow.get(light.id);
          if (!dec || dec.t < W.time - 6) {
            dec = { t: W.time, stop: shouldStopForYellow(d, v, COMFORT_YELLOW), d, v };
            m.yellow.set(light.id, dec);
          }
          if (dec.stop) return { stop: d, code: 'kuning', info: { node, light, dec } };
        }
      }
      const dDecide = (v * v) / (2 * P.b) + 6;
      if (d > dDecide) return cap ? { cap } : null;
      // kendaraan di depan belum masuk persimpangan: cukup ikuti, reservasi nanti
      if (lead && !lead.ped && lead.sRear < seg.s1 + 0.5) return cap ? { cap } : null;
      const r = tryReserve(m, node, seg.move);
      if (r.ok) {
        m.res.go = !!light && light.state === 'yellow';
        return cap ? { cap } : null;
      }
      return { stop: d, code: r.why, info: { node, other: r.other }, cap };
    }
    return null;
  }

  function curveCap(m, f, P) {
    const R = m.route;
    const cum = R.path.cum;
    let best = null;
    for (let j = indexAt(R.path, f); j < cum.length; j++) {
      const ahead = cum[j] - f;
      if (ahead > 40) break;
      const rad = R.radius[j];
      if (rad === Infinity) continue;
      const vc = Math.sqrt(P.lat * rad);
      const allowed = Math.sqrt(vc * vc + 2 * 1.0 * Math.max(0, ahead));
      if (!best || allowed < best.v) best = { v: allowed, radius: rad, ahead: Math.max(0, ahead) };
    }
    return best;
  }

  /** Hitung percepatan satu kendaraan dan catat alasan keputusannya. */
  function control(m) {
    const P = params(m);
    const v = m.speed;
    const f = front(m);
    const R = m.route;
    const lead = findLeader(m);
    const jn = junction(m, P, lead);

    let v0 = P.v0;
    let capCode = null;
    let capInfo = null;
    const curve = curveCap(m, f, P);
    if (curve && curve.v < v0) {
      v0 = curve.v;
      capCode = 'belok';
      capInfo = curve;
    }
    if (jn && jn.cap && jn.cap.v < v0) {
      v0 = jn.cap.v;
      capCode = jn.cap.code;
      capInfo = jn.cap.info;
    }
    let best = clamp(P.a * (1 - (v / Math.max(0.3, v0)) ** 4), -1.2, P.a);
    let code = capCode && v0 < P.v0 - 0.2 && best < 0.3 ? capCode : 'melaju';
    let info = code === 'melaju' ? null : capInfo;
    let near = null;
    const take = (a, c, i) => {
      if (a < best) {
        best = a;
        code = c;
        info = i;
      }
    };
    const stopAt = (d, g0, c, i, soft = false) => {
      const room = d - g0;
      const req = room > 0.01 ? (v * v) / (2 * room) : Infinity;
      if (!near || d < near.d) near = { d, code: c, info: i };
      let a;
      if (room <= 0.05 || (room < 1.5 && v < 0.6)) a = v > 0.05 ? -Math.max(P.b, Math.min(req, P.aMax)) : -P.b;
      else if (req >= 0.6 * P.b) a = -req;
      else return;
      if (soft && a < -P.b * 1.15) return;
      take(a, c, i);
    };

    if (lead) {
      const g0 = lead.ped ? 2 : P.g0;
      const tau = lead.ped ? 1 : P.tau;
      const s = Math.max(0.2, lead.gap);
      const dv = v - lead.v;
      const sStar = g0 + Math.max(0, v * tau + (v * dv) / (2 * Math.sqrt(P.a * P.b)));
      const inter = (sStar / s) ** 2;
      const a = P.a * (1 - (v / Math.max(0.3, P.v0)) ** 4 - inter);
      lead.target = sStar;
      // label "mengikuti" hanya bila kendaraan di depan benar-benar memengaruhi percepatan
      if (inter < 0.12) best = Math.min(best, a);
      else take(a, lead.ped ? 'pejalan' : 'ikuti', lead);
    }
    if (jn && jn.stop != null) stopAt(jn.stop, 0.8, jn.code, jn.info);

    for (const z of R.zebras) {
      if (f > z.s0 - 0.3) continue;
      const d = z.s0 - f;
      if (d > 45) continue;
      let crossing = false;
      let waiting = false;
      for (const p of W.peds) {
        if (p.zebra !== z.zebra) continue;
        if (p.state === 'cross') crossing = true;
        else if (p.state === 'wait' && !p.sudden) waiting = true; // pejalan kaki "mendadak" tidak memberi tanda akan menyeberang
      }
      if (crossing) stopAt(d, 1.2, 'pejalan', { zebra: z.zebra });
      else if (waiting) stopAt(d, 1.2, 'pejalan', { zebra: z.zebra, waiting: true }, true);
      // jangan berhenti di atas zebra cross karena antrean
      if (lead && !lead.ped && lead.v < 0.8 && lead.sRear > z.s0 && lead.sRear < z.s1 + m.length + 1) stopAt(d, 1.0, 'antre', { zebra: z.zebra }, true);
    }

    if (m.isShuttle) {
      if (m.target != null && m.stopDecision === 'stop') {
        const sS = stopSOnRoute(HALTE[m.target]);
        if (sS != null) stopAt(sS - f, 0, 'halte', { halte: HALTE[m.target] });
      }
    }
    // pengaman: jangan pernah melewati ujung rute
    if (R.path.length - f < 60) stopAt(R.path.length - f, 0.5, 'buntu', null);

    if (code === 'melaju' && jn && jn.go) {
      code = jn.go;
      info = jn.info;
    }
    const a = clamp(best, -P.aMax, P.a);
    m.dec = { code, info, near, lead, v0, a };
    return a;
  }

  // ---------- pejalan kaki ----------

  function zebraAhead(m, Z) {
    const r = rear(m);
    for (const z of m.route.zebras) if (z.zebra === Z && z.s1 + 0.2 > r) return z;
    return null;
  }

  function canCross(p) {
    let tightest = Infinity;
    let moving = false;
    for (const m of W.movers) {
      const z = zebraAhead(m, p.zebra);
      if (!z) continue;
      const f = front(m);
      if (f > z.s0 - 0.2 && rear(m) < z.s1 + 0.2) return false; // kendaraan di atas zebra
      if (f >= z.s0) continue;
      const d = z.s0 - f;
      const v = m.speed;
      if (p.sudden) {
        const phys = 0.25 * v + (v * v) / (2 * params(m).aMax) + 1.2;
        if (d < phys) return false;
        if (v > 0.5 && d < 40) {
          moving = true;
          tightest = Math.min(tightest, d - phys);
        }
      } else if (!(v < 0.4 || d > (v * v) / 2 + 1.5 * v + 4)) return false;
    }
    if (p.sudden) {
      // pejalan kaki dari tombol menunggu shuttle mendekat, lalu melangkah pada saat terakhir yang
      // masih aman secara fisik (shuttle masih bisa berhenti dengan rem penuh)
      const z = p.forShuttle && p.t < 25 ? zebraAhead(sh, p.zebra) : null;
      if (z && front(sh) < z.s0 && z.s0 - front(sh) < 70) {
        const v = sh.speed;
        const phys = 0.25 * v + (v * v) / (2 * params(sh).aMax) + 1.2;
        return v > 0.5 && z.s0 - front(sh) - phys < 0.5;
      }
      return moving ? tightest < 0.5 : p.t > 1.2;
    }
    return true;
  }

  function spawnPed(Z, sudden) {
    const side = rng.chance(0.5) ? 1 : -1;
    const p = {
      id: `pejalan-${++W.pedSeq}`,
      kind: 'pedestrian',
      label: 'Pejalan kaki',
      radius: 0.35,
      zebra: Z,
      dir: side,
      off: -side * Z.curb,
      off1: side * Z.curb,
      along: rng.range(-0.8, 0.8),
      state: 'wait',
      sudden,
      alpha: 0,
      phase: 0,
      speed: 0,
      t: 0,
      x: 0,
      y: 0,
      heading: 0,
      vx: 0,
      vy: 0,
      leave: 1,
    };
    placePed(p);
    W.peds.push(p);
    return p;
  }

  function placePed(p) {
    const Z = p.zebra;
    p.x = Z.x + Z.u.x * p.off + Z.v.x * p.along;
    p.y = Z.y + Z.u.y * p.off + Z.v.y * p.along;
    if (p.state === 'leave') {
      p.heading = Math.atan2(Z.v.y * p.leave, Z.v.x * p.leave);
      p.vx = Z.v.x * p.leave * 1.2;
      p.vy = Z.v.y * p.leave * 1.2;
    } else {
      p.heading = Math.atan2(Z.u.y * p.dir, Z.u.x * p.dir);
      p.vx = p.state === 'cross' ? Z.u.x * p.dir * p.speed : 0;
      p.vy = p.state === 'cross' ? Z.u.y * p.dir * p.speed : 0;
    }
  }

  function updatePeds(dt) {
    for (const Z of ZEBRAS) {
      Z.timer -= dt;
      if (Z.timer <= 0) {
        Z.timer = rng.range(16, 34);
        const here = W.peds.filter((p) => p.zebra === Z && p.state !== 'leave').length;
        if (here < 2 && W.peds.length < 8) spawnPed(Z, false);
      }
    }
    for (const p of W.peds) {
      p.t += dt;
      if (p.state === 'wait') {
        p.alpha = Math.min(1, p.alpha + dt * 2.5);
        if (p.t > (p.sudden ? 0.15 : 0.6) && canCross(p)) {
          p.state = 'cross';
          p.speed = p.sudden ? 1.6 : 1.3;
          if (p.sudden) W.events.push({ type: 'ped-step', ped: p });
        }
      } else if (p.state === 'cross') {
        p.off += p.dir * p.speed * dt;
        p.phase += dt * 7;
        if ((p.dir > 0 && p.off >= p.off1) || (p.dir < 0 && p.off <= p.off1)) {
          p.off = p.off1;
          p.state = 'leave';
          p.leave = rng.chance(0.5) ? 1 : -1;
        }
      } else {
        p.along += p.leave * 1.2 * dt;
        p.phase += dt * 6;
        p.alpha -= dt / 2.5;
      }
      placePed(p);
    }
    W.peds = W.peds.filter((p) => p.alpha > 0 || p.state !== 'leave');
  }

  function addPedestrian() {
    const f = front(sh);
    const v = sh.speed;
    const phys = 0.25 * v + (v * v) / (2 * params(sh).aMax) + 1.2;
    let Z = null;
    for (const z of sh.route.zebras) {
      const d = z.s0 - f;
      if (d > phys + 3 && d < 110) {
        Z = z.zebra;
        break;
      }
    }
    const onRoute = !!Z;
    if (!Z) {
      let bestD = Infinity;
      for (const z of ZEBRAS) {
        const d = Math.hypot(z.x - sh.x, z.y - sh.y);
        if (d < bestD && d > 12) {
          bestD = d;
          Z = z;
        }
      }
    }
    if (W.peds.filter((p) => p.zebra === Z && p.state !== 'leave').length >= 3) return { ok: false, msg: 'Zebra cross itu sedang ramai. Coba lagi beberapa detik lagi.' };
    const p = spawnPed(Z, true);
    p.forShuttle = onRoute;
    return { ok: true, zebra: Z, onRoute };
  }

  // ---------- penumpang ----------

  function addPax(from, to, t0 = W.time) {
    W.queues[from].push({ id: ++W.paxSeq, from, to, t0 });
  }

  function servable(i) {
    return W.active[i] && !W.closed.has(HALTE[i].link.road.id);
  }

  function spawnPax() {
    const origins = HALTE.map((h, i) => i).filter((i) => servable(i) && W.queues[i].length < 8);
    if (!origins.length) return;
    const from = rng.pick(origins);
    const dests = HALTE.map((h, i) => i).filter((i) => i !== from && servable(i));
    if (!dests.length) return;
    addPax(from, rng.pick(dests));
  }

  function needStop(i) {
    return sh.onboard.some((p) => p.to === i) || (W.queues[i].length > 0 && sh.onboard.length < CAPACITY);
  }

  function markDone(i) {
    W.lastDone = i;
    W.skipped.clear();
  }

  function startDwell(H) {
    sh.mode = 'dwell';
    sh.dwell = { halte: H, phase: 'buka', t: 0, door: 0, anim: null, off: 0, on: 0 };
    markDone(H.index);
    processHalte(H.index, 'dilayani');
    // rute ke halte berikutnya langsung disiapkan, jadi tetap terlihat selama pintu terbuka
    chooseTarget(H.index + 1, { notNow: H.index });
  }

  function updateDwell(dt) {
    const D = sh.dwell;
    const H = D.halte;
    D.t += dt;
    if (D.anim) {
      D.anim.t += dt;
      if (D.anim.t >= D.anim.dur) {
        if (D.anim.kind === 'turun') {
          W.stats.delivered++;
          D.off++;
        } else {
          sh.onboard.push(D.anim.pax);
          D.on++;
          W.events.push({ type: 'board', halte: H });
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
      const k = sh.onboard.findIndex((p) => p.to === H.index);
      if (k >= 0) {
        const pax = sh.onboard.splice(k, 1)[0];
        D.anim = { kind: 'turun', pax, t: 0, dur: 0.55 };
      } else {
        D.phase = 'naik';
        D.t = 0;
      }
    } else if (D.phase === 'naik') {
      const q = W.queues[H.index];
      if (q.length && sh.onboard.length < CAPACITY) {
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
        sh.mode = 'drive';
        sh.dwell = null;
        sh.lastServed = { halte: H, off: D.off, on: D.on, time: W.time };
        if (sh.target != null) sh.stopDecision = null;
        chooseTarget(sh.target ?? H.index + 1, { notNow: H.index });
      }
    }
  }

  function updateHalteDecision() {
    if (sh.target == null || sh.mode !== 'drive') return;
    const H = HALTE[sh.target];
    const sS = stopSOnRoute(H);
    if (sS == null) return;
    const d = sS - front(sh);
    const lock = (sh.speed * sh.speed) / (2 * 0.9) + 12;
    if (d > lock) sh.stopDecision = needStop(H.index) ? 'stop' : 'pass';
    else if (sh.stopDecision == null) {
      // keputusan pertama saat sudah dekat: berhenti hanya bila masih bisa mengerem dengan nyaman
      const comfy = d > (sh.speed * sh.speed) / (2 * 1.2) + 1;
      sh.stopDecision = comfy && needStop(H.index) ? 'stop' : 'pass';
    }
    if (d <= lock && sh.stopDecision === 'pass') {
      sh.lastPassed = { halte: H, time: W.time };
      markDone(H.index);
      processHalte(H.index, 'dilewati');
      chooseTarget(H.index + 1, { notNow: H.index });
      return;
    }
    if (sh.stopDecision === 'stop' && d < 0.7 && d > -1.5 && sh.speed < 0.2) startDwell(H);
    else if (d <= -1.5) {
      // terlewat (seharusnya tidak terjadi): anggap dilewati dan lanjut ke halte berikutnya
      markDone(H.index);
      processHalte(H.index, 'dilewati');
      chooseTarget(H.index + 1, { notNow: H.index });
    }
  }

  // ---------- gerak ----------

  function stepShuttle(dt) {
    const P = params(sh);
    sh.maxBrake = P.aMax;
    let a;
    if (sh.mode === 'dwell') {
      updateDwell(dt);
      a = -P.b;
      sh.dec = { code: 'dwell', info: { halte: sh.dwell ? sh.dwell.halte : null }, a: 0 };
    } else {
      updateHalteDecision();
      a = control(sh);
    }
    const pp = purePursuit(sh, sh.route.path, { lookahead: 2.5, gain: 0.55, hintS: sh.s - sh.wheelbase / 2 });
    sh.pp = pp;
    const f0 = front(sh);
    sh.step(dt, { accel: a, steer: pp.steer });
    sh.cmdAccel = a;
    sh.s = sh.route.path.closest(sh.x, sh.y, sh.s, 12).s;
    // pengereman darurat (tepi naik)
    const emergency = a < -EMERGENCY_DECEL && sh.speed > 0.3;
    if (emergency && !sh.emergency) {
      W.stats.emergencies++;
      W.events.push({ type: 'emergency', dec: sh.dec });
      sh.emergencyAt = W.time;
    }
    sh.emergency = emergency;
    // pelanggaran lampu merah: bemper depan melewati garis henti saat merah
    const f1 = front(sh);
    for (const seg of sh.route.segs) {
      const light = seg.link.light;
      if (!light || !seg.move) continue;
      const line = seg.s1 - 0.4;
      if (f0 < line && f1 >= line && light.state === 'red') {
        W.stats.violations++;
        W.events.push({ type: 'violation', light });
      }
    }
  }

  function stepCar(c, dt) {
    // mobil pelan di depan shuttle (langkah hujan): merayap bila shuttle tertinggal jauh
    if (c.leader) c.cruiseF = Math.hypot(c.x - sh.x, c.y - sh.y) > 30 ? 0.35 : 0.6;
    const a = control(c);
    c.accel = a;
    c.speed = Math.max(0, c.speed + a * dt);
    c.braking = a < -0.6 && c.speed > 0.2;
    c.s += c.speed * dt;
    syncCarPose(c);
  }

  function releasePassed(m) {
    if (!m.res) return;
    const seg = m.route.segs.find((sg) => sg.move === m.res.move);
    if (!seg || rear(m) > seg.b1 + 0.3) release(m);
  }

  function checkCollisions() {
    const all = [sh, ...W.cars];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        if (Math.abs(all[i].x - all[j].x) > 8 || Math.abs(all[i].y - all[j].y) > 8) continue;
        if (boxesOverlap(all[i], all[j], -0.05)) {
          if (!W.inContact) W.collisions++;
          W.inContact = true;
          return;
        }
      }
      for (const p of W.peds) {
        if (p.state !== 'cross') continue;
        if (distanceToBox(p.x, p.y, all[i]) < p.radius * 0.6) {
          if (!W.inContact) W.collisions++;
          W.inContact = true;
          return;
        }
      }
    }
    W.inContact = false;
  }

  function updateSensorObjects() {
    sensorObjects.length = 0;
    for (const o of staticObjects) sensorObjects.push(o);
    for (const c of W.cars) sensorObjects.push(c);
    for (const p of W.peds) sensorObjects.push(p);
    for (const c of W.cones) sensorObjects.push(c);
  }

  function placeLeaderNow() {
    const f = front(sh);
    let targetS = f + 26;
    // jangan menaruh mobil di dalam kotak persimpangan
    for (const seg of sh.route.segs) {
      if (seg.move && targetS > seg.s1 - 2.5 && targetS < seg.b1 + 2.5) targetS = seg.b1 + 2.5;
    }
    // jangan pula di atas atau tepat sebelum zebra cross
    for (const z of sh.route.zebras) {
      if (targetS > z.s0 - 5 && targetS < z.s1 + 1) targetS = z.s1 + 1.5;
    }
    if (targetS > sh.route.path.length - 8) return false;
    for (const o of W.movers) {
      if (o === sh) continue;
      const c = sh.route.path.closest(o.x, o.y, targetS, 20);
      if (Math.abs(c.lateral) < 3 && Math.abs(c.s - targetS) < 9) return false;
    }
    // mobil yang paling jauh dari shuttle dipindahkan ke depan shuttle
    let car = null;
    let far = -1;
    for (const c of W.cars) {
      const d = Math.hypot(c.x - sh.x, c.y - sh.y);
      if (d > far) {
        far = d;
        car = c;
      }
    }
    if (!car) return false;
    release(car);
    // rute mobil = rute shuttle sampai halte berikutnya, lalu terus mengikuti jalan lingkar
    car.route = buildRoute(sh.route.ids);
    car.s = targetS + car.length / 2;
    car.speed = Math.min(sh.speed, kmhToMs(W.limitKmh) * 0.6);
    car.cruiseF = 0.6;
    car.leader = true;
    extendCar(car);
    syncCarPose(car);
    W.leaderCar = car;
    return true;
  }

  function releaseLeader() {
    W.pendingLeader = false;
    const c = W.leaderCar;
    if (!c) return;
    c.leader = false;
    c.cruiseF = c.baseCruiseF;
    W.leaderCar = null;
  }

  function update(dt) {
    W.time += dt;
    W.stats.time = W.time;
    for (const plan of PLANS) plan.update(W.time);

    W.nextPax -= dt;
    if (W.nextPax <= 0) {
      spawnPax();
      W.nextPax = rng.range(6, 14);
    }
    updatePeds(dt);

    if (W.pendingLeader && sh.mode === 'drive' && sh.speed > 1) {
      if (placeLeaderNow()) W.pendingLeader = false;
    }

    const odo0 = sh.odometer;
    stepShuttle(dt);
    W.stats.distance += sh.odometer - odo0;
    for (const c of W.cars) stepCar(c, dt);

    for (const m of W.movers) {
      releasePassed(m);
      shiftRoute(m);
      if (!m.isShuttle) extendCar(m);
    }
    checkCollisions();
    updateSensorObjects();
    rig.update(dt, sensorObjects, W.weather);
  }

  // ---------- aksi dari panel ----------

  function rebuildCones() {
    W.cones = [];
    for (const id of W.closed) {
      for (const L of ROADS[id].links) {
        const p = L.lane.sample(0.9);
        const lx = Math.sin(p.heading);
        const ly = -Math.cos(p.heading);
        for (const k of [-1.25, 0, 1.25]) W.cones.push({ id: `kerucut-${L.id}-${k}`, kind: 'cone', label: 'Kerucut', x: p.x + lx * k, y: p.y + ly * k, radius: 0.3 });
      }
    }
  }

  function fixCarRoutes() {
    for (const c of W.cars) {
      const comm = committedIds(c);
      const rest = c.route.ids.slice(comm.length);
      if (rest.some((id) => !isOpen(id))) {
        setRoute(c, comm);
        extendCar(c);
      }
    }
  }

  function onShuttleRoad(roadId) {
    return LINKS[sh.route.ids[locate(sh)]].road.id === roadId;
  }

  function toggleRoad(roadId) {
    const R = ROADS[roadId];
    if (W.closed.has(roadId)) {
      W.closed.delete(roadId);
      rebuildCones();
      fixCarRoutes();
      chooseTarget(sh.target ?? 0);
      const back = reconsiderSkipped();
      return { ok: true, closed: false, back, msg: `${R.name} dibuka lagi.${back != null ? ` Shuttle kembali melayani halte ${HALTE[back].name}.` : ''}` };
    }
    if (W.closed.size >= MAX_CLOSED) return { ok: false, msg: `Paling banyak ${MAX_CLOSED} ruas bisa ditutup sekaligus. Buka salah satu dulu.` };
    const test = new Set(W.closed);
    test.add(roadId);
    for (const n of NODE_LIST) {
      if (openDegree(n, test) < 2) return { ok: false, msg: `${R.name} tidak bisa ditutup karena ${n.name} akan menjadi jalan buntu. Kendaraan di sini tidak bisa putar balik.` };
    }
    for (const m of W.movers) {
      if (m.res && m.res.move.out.road === R && linkPos(m).link.road !== R) return { ok: false, msg: 'Ada kendaraan yang sedang masuk ke ruas ini. Coba lagi beberapa detik lagi.' };
    }
    const comm = committedIds(sh);
    const ahead = sh.route.ids.slice(comm.length);
    const onRoute = ahead.some((id) => LINKS[id].road === R);
    const onCommitted = comm.some((id) => LINKS[id].road === R);
    const oldPts = routePoints();
    W.closed.add(roadId);
    rebuildCones();
    fixCarRoutes();
    const prevTarget = sh.target;
    const res = chooseTarget(sh.target ?? 0);
    const rerouted = onRoute && res.changed;
    if (rerouted) {
      W.oldRoute = { pts: oldPts, time: W.time };
      W.events.push({ type: 'reroute', road: R, target: sh.target, prevTarget, expanded: W.lastSearch?.expanded ?? 0 });
    }
    return { ok: true, closed: true, road: R, onRoute, onCommitted: onCommitted && onShuttleRoad(roadId), rerouted, target: sh.target, prevTarget };
  }

  /** Tutup ruas pertama di rute shuttle yang boleh ditutup. */
  function closeAhead() {
    if (W.closed.size >= MAX_CLOSED) return { ok: false, msg: `Paling banyak ${MAX_CLOSED} ruas bisa ditutup sekaligus. Buka salah satu dulu.` };
    const comm = committedIds(sh);
    const ahead = [...new Set(sh.route.ids.slice(comm.length).map((id) => LINKS[id].road))].filter((R) => !W.closed.has(R.id));
    // utamakan ruas yang bukan ruas halte tujuan, supaya shuttle benar-benar mencari jalan memutar
    const goalRoad = sh.target != null ? HALTE[sh.target].link.road : null;
    ahead.sort((a, b) => (a === goalRoad) - (b === goalRoad));
    let lastMsg = null;
    for (const R of ahead) {
      const r = toggleRoad(R.id);
      if (r.ok) return r;
      lastMsg = r.msg;
    }
    return { ok: false, msg: lastMsg || 'Belum ada ruas di depan shuttle yang bisa ditutup. Tunggu sampai rute berikutnya melewati persimpangan.' };
  }

  function openAll() {
    if (!W.closed.size) return { ok: false, back: null };
    W.closed.clear();
    rebuildCones();
    fixCarRoutes();
    chooseTarget(sh.target ?? 0);
    return { ok: true, back: reconsiderSkipped() };
  }

  function setActive(i, on) {
    if (!on && W.active.filter(Boolean).length <= 2) return { ok: false, msg: 'Minimal dua halte harus tetap dilayani.' };
    W.active[i] = on;
    let left = 0;
    if (!on) {
      left = W.queues[i].length;
      W.queues[i].length = 0;
      // penumpang yang menunggu di halte lain dengan tujuan halte ini membatalkan perjalanan
      for (const q of W.queues) {
        const n = q.length;
        for (let k = q.length - 1; k >= 0; k--) if (q[k].to === i) q.splice(k, 1);
        left += n - q.length;
      }
    }
    if (sh.target != null) {
      const sS = stopSOnRoute(HALTE[sh.target]);
      const locked = sh.mode === 'drive' && sS != null && sS - front(sh) <= (sh.speed * sh.speed) / (2 * 0.9) + 12;
      if (!locked && !isNeeded(sh.target)) chooseTarget(sh.target + 1);
    } else chooseTarget(i);
    return { ok: true, left };
  }

  function setWeather(w) {
    W.weather = w;
  }

  function setLimit(kmh) {
    W.limitKmh = kmh;
  }

  function resetLoop() {
    W.loop = { start: null, count: 0, viol0: W.stats.violations, t0: W.time };
  }

  function placeLeader() {
    W.pendingLeader = true;
  }

  /** Pastikan ada penumpang yang menunggu di halte i (untuk preset langkah pertama). */
  function seedPassengers(i, n = 2) {
    if (!servable(i)) return;
    const dests = HALTE.map((h, k) => k).filter((k) => k !== i && servable(k));
    for (let k = W.queues[i].length; k < n && dests.length; k++) addPax(i, dests[(k + i) % dests.length]);
  }

  function routePoints() {
    const path = sh.route.path;
    const f = front(sh);
    const end = W.stopS() ?? path.length;
    const pts = [path.sample(f)];
    for (let i = indexAt(path, f) + 1; i < path.points.length && path.cum[i] < end; i++) pts.push(path.points[i]);
    if (end > f) pts.push(path.sample(end));
    return pts.map((p) => ({ x: p.x, y: p.y }));
  }

  // ---------- ulang ----------
  function reset() {
    W.time = 0;
    W.stats = { delivered: 0, distance: 0, time: 0, waitSum: 0, waitN: 0, violations: 0, emergencies: 0, loops: 0 };
    W.events.length = 0;
    W.peds = [];
    W.queues = HALTE.map(() => []);
    W.unreachable.clear();
    W.skipped.clear();
    W.lastDone = null;
    W.oldRoute = null;
    W.pendingLeader = false;
    W.leaderCar = null;
    W.collisions = 0;
    W.inContact = false;
    W.nextPax = 5;
    W.paxSeq = 0;
    rng.reseed(20250901);
    for (const n of NODE_LIST) n.res.clear();
    ZEBRAS.forEach((Z, i) => (Z.timer = 6 + i * 7));
    for (const [from, to] of INITIAL_PAX) if (servable(from) && servable(to)) addPax(from, to, 0);
    for (const plan of PLANS) plan.update(0);
    resetLoop();

    // shuttle di Jl. Rektorat, menuju halte pertama (Gerbang Utama)
    const L = LINKS[SHUTTLE_START.link];
    const s0 = L.lane.closest(SHUTTLE_START.x, SHUTTLE_START.y).s;
    const p = L.lane.sample(s0);
    sh.setPose(p.x, p.y, p.heading);
    sh.odometer = 0;
    sh.onboard = [];
    sh.mode = 'drive';
    sh.dwell = null;
    sh.res = null;
    sh.yellow = new Map();
    sh.target = null;
    sh.stopDecision = null;
    sh.emergency = false;
    sh.emergencyAt = -10;
    sh.lastServed = null;
    sh.lastPassed = null;
    sh.cmdAccel = 0;
    sh.dec = { code: 'melaju' };
    sh.route = buildRoute([L.id]);
    sh.s = s0;
    chooseTarget(0);

    W.cars = CAR_STARTS.map((spec, i) => {
      const c = makeCar(spec, i);
      c.route = buildRoute([spec.link]);
      c.s = spec.at;
      extendCar(c);
      syncCarPose(c);
      return c;
    });
    W.movers = [sh, ...W.cars];
    rig.clear();
    updateSensorObjects();
    rig.scanNow(sensorObjects, W.weather);
  }

  reset();

  return {
    W,
    sh,
    rig,
    reset,
    update,
    params,
    toggleRoad,
    closeAhead,
    openAll,
    setActive,
    setWeather,
    setLimit,
    addPedestrian,
    placeLeader,
    releaseLeader,
    seedPassengers,
    resetLoop,
    routePoints,
    committedIds: () => committedIds(sh),
    locate: (m) => locate(m),
    front,
    sensorObjects,
    isNeeded,
  };
}
