// Dunia simulasi pelajaran Lokalisasi: jalan-jalan asli di sekitar Alun-alun Merdeka Malang dari
// OpenStreetMap (lihat ./route.js), mobil otonom yang berkeliling, pejalan kaki di trotoar dan di
// zebra cross Jalan Jenderal Basuki Rachmat, serta perisai keselamatan (./safety.js).
//
// Koordinat dalam meter, x ke timur, y ke selatan, lalu lintas kiri. Mobil berjalan di lajur
// paling kiri. File ini hanya berisi model dunia (menggerakkan dan menggambar). Model sensor dan
// estimasi posisi ada di ./estimators.js, logika pelajaran di ../lokalisasi.js.

import { Vehicle } from '../../engine/vehicle.js';
import { Path, distanceToBox } from '../../engine/geometry.js';
import { purePursuit } from '../../engine/control.js';
import { Rng, TAU } from '../../engine/math.js';
import { COLORS, withAlpha } from '../../engine/theme.js';
import { drawCar, drawPedestrian, drawCrosswalk, roundRectPath } from '../../engine/draw.js';
import { crosswalk as makeCrosswalk } from '../../engine/road.js';
import { createMapRenderer } from '../../engine/osm2d.js';
import { inZoneS } from './route.js';
import { SHIELD, stoppingDistance, pedestrianObstacles, shieldCommand, corridorDistance, touchesPedestrian, bodyBox, createMonitor } from './safety.js';

const CRUISE = 8.5; // m/s, sekitar 31 km/jam (perkiraan kecepatan rata-rata jalan kota di data)
const STOP_BEFORE = 1.8; // mobil berhenti 1,8 m sebelum tepi zebra cross
export const PP = { lookahead: 3.5, gain: 0.35 }; // pure pursuit: jarak pandang = 3,5 m + 0,35 x laju
export const LANE_OUT = 0.7; // simpangan (m) saat bodi mobil mulai melewati garis lajur (lajur sekitar 3,2 m)
export const TAKEOVER_AT = 1; // simpangan (m) saat pengemudi cadangan pasti mengambil alih
const TAKEOVER_SPEED = 5; // m/s selama pengemudi cadangan memegang kemudi
const PED_VARIANTS = ['default', 'hijab', 'backpack', 'umbrella', 'hijab', 'default'];

export function createScene(route, { seed = 2024 } = {}) {
  const { map, lanePath, samples, zones, landmarks, crossing, walkways } = route;
  const L = lanePath.length;
  const rng = new Rng(seed);
  const monitor = createMonitor(); // penghitung aturan keselamatan (harus selalu 0)

  // ---------- mobil otonom ----------
  const ego = new Vehicle({ id: 'ego', label: 'Mobil otonom', ego: true, maxSpeed: 14, maxAccel: 2, maxBrake: 6 });
  const wrap = (s) => ((s % L) + L) % L;
  /** Jarak sepanjang lajur dari s0 maju ke s1 (0 sampai panjang rute). */
  const ahead = (s0, s1) => wrap(s1 - s0);
  let egoS = 0;

  const START_S = 30; // Jalan Merdeka Utara, depan Alun-alun, langit terbuka

  function placeAt(s) {
    const p = lanePath.sample(s);
    ego.setPose(p.x, p.y, p.heading);
    ego.speed = CRUISE;
    egoS = wrap(s);
    // jangan pernah meletakkan mobil di atas atau tepat di depan pejalan kaki
    for (const w of walkers) if (distanceToBox(w.x, w.y, bodyBox(ego, 3)) <= w.radius) w.flip();
    for (const c of crossers) if (distanceToBox(c.x, c.y, bodyBox(ego, 3)) <= c.radius) c.remove();
    const room = shieldCommand(ego, { accel: 0, brake: 0, steer: 0 }, pedestrianObstacles(allPeds()), 1 / 60);
    if (room.active) ego.speed = 0;
  }

  /** Zona gedung tinggi di posisi s, atau null. */
  const zoneAtS = (s) => zones.find((z) => inZoneS(z, s, L)) || null;
  const inCanyon = (x, y) => !!zoneAtS(lanePath.closest(x, y).s);

  /** Zona berikutnya di depan s: { zone, dist }. */
  function nextZone(s) {
    let best = null;
    for (const z of zones) {
      const d = ahead(s, z.s0);
      if (!best || d < best.dist) best = { zone: z, dist: d };
    }
    return best;
  }

  /** Parameter galat GPS di zona gedung tinggi, atau null di tempat yang langitnya cukup terbuka. */
  function canyonAt(x, y) {
    const q = lanePath.closest(x, y);
    const z = zoneAtS(q.s);
    if (!z) return null;
    const smp = route.infoAt(q.s);
    // arah melintang jalan; bias condong ke sisi yang lebih terbuka (menjauhi dinding yang lebih tinggi)
    const normal = q.heading + Math.PI / 2; // ke kanan arah gerak
    const side = smp.maskLeft > smp.maskRight ? 1 : -1;
    const bn = 2.8 * side;
    const bt = 1.4 * Math.sin(q.s / 17);
    return {
      normal,
      biasX: Math.cos(normal) * bn + Math.cos(q.heading) * bt,
      biasY: Math.sin(normal) * bn + Math.sin(q.heading) * bt,
      zone: z,
    };
  }

  // ---------- pejalan kaki ----------
  const PED_GAP = 0.35; // jarak minimum yang dijaga pejalan kaki dari bodi kendaraan (m)
  /** Langkah pejalan kaki boleh bila tetap berjarak dari bodi mobil, atau tidak makin dekat. */
  function stepAllowed(p, nx, ny) {
    const box = bodyBox(ego);
    const next = distanceToBox(nx, ny, box);
    if (next > p.radius + PED_GAP) return true;
    return next > p.radius + 0.01 && next >= distanceToBox(p.x, p.y, box) - 1e-9;
  }
  // Pejalan kaki di trotoar: berjalan bolak-balik di satu potongan trotoar. Bila mobil menghalangi
  // terlalu lama (misalnya mobil keluar lajur dan berhenti di trotoar), ia masuk ke toko terdekat
  // (memudar) lalu muncul lagi nanti di ujung lain yang kosong. Jadi tidak ada yang saling menunggu.
  class Walker {
    constructor(id, pts, i) {
      this.id = id;
      this.kind = 'pedestrian';
      this.path = new Path(pts);
      this.radius = 0.35;
      this.variant = PED_VARIANTS[i % PED_VARIANTS.length];
      this.accent = COLORS.hijab[i % COLORS.hijab.length];
      this.color = ['#fb7185', '#fbbf24', '#60a5fa', '#34d399', '#f472b6', '#c084fc'][i % 6];
      this.reset(i);
    }
    reset(i = 0) {
      this.s = rng.range(0.2, 0.8) * this.path.length;
      this.dir = i % 2 ? 1 : -1;
      this.speed = rng.range(1.0, 1.35);
      this.blocked = 0;
      this.stuck = 0;
      this.phase = rng.range(0, 6);
      this.moving = true;
      this.active = true;
      this.state = 'walk';
      this.fade = 1;
      this.away = 0;
      this._pose();
    }
    _pose() {
      const p = this.path.sample(this.s);
      this.x = p.x;
      this.y = p.y;
      this.heading = p.heading + (this.dir < 0 ? Math.PI : 0);
    }
    /** Memberi jalan: masuk ke toko terdekat (memudar), muncul lagi nanti. */
    giveWay() {
      if (this.state === 'walk' || this.state === 'fadeIn') this.state = 'fadeOut';
    }
    /** Pindah ke ujung potongan yang jauh dari mobil (dipakai saat mobil diletakkan di dekatnya). */
    flip() {
      this.state = 'away';
      this.active = false;
      this.away = 2;
    }
    _respawn() {
      // muncul di ujung potongan yang paling jauh dari mobil, hanya bila tempatnya kosong
      const ends = [0.03, 0.97].map((f) => ({ f, p: this.path.sample(f * this.path.length) }));
      ends.sort((u, v) => Math.hypot(v.p.x - ego.x, v.p.y - ego.y) - Math.hypot(u.p.x - ego.x, u.p.y - ego.y));
      const e = ends[0];
      if (distanceToBox(e.p.x, e.p.y, bodyBox(ego)) < 4) return false;
      this.s = e.f * this.path.length;
      this.dir = e.f < 0.5 ? 1 : -1;
      this._pose();
      this.state = 'fadeIn';
      this.active = true;
      this.fade = 0;
      this.stuck = 0;
      this.blocked = 0;
      return true;
    }
    update(dt) {
      if (this.state === 'away') {
        this.away -= dt;
        if (this.away <= 0 && !this._respawn()) this.away = 1;
        return;
      }
      if (this.state === 'fadeOut') {
        this.moving = false;
        this.fade -= dt / 0.6;
        if (this.fade <= 0) {
          this.state = 'away';
          this.active = false;
          this.away = rng.range(6, 12);
        }
        return;
      }
      if (this.state === 'fadeIn') {
        this.fade = Math.min(1, this.fade + dt / 0.6);
        if (this.fade >= 1) this.state = 'walk';
      }
      const moved = this._walk(dt);
      this.stuck = moved ? 0 : this.stuck + dt;
      if (this.stuck > 3) this.state = 'fadeOut';
    }
    _walk(dt) {
      let ns = this.s + this.dir * this.speed * dt;
      if (ns < 0 || ns > this.path.length) {
        // ujung potongan trotoar: berbalik, kecuali mobil ada di dekat arah balik (tunggu dulu)
        const back = this.path.sample(this.s - this.dir * 2);
        const toCar = (back.x - this.x) * (ego.x - this.x) + (back.y - this.y) * (ego.y - this.y);
        if (toCar > 0 && Math.hypot(ego.x - this.x, ego.y - this.y) < 12) {
          this.moving = false;
          return false;
        }
        this.dir = -this.dir;
        ns = Math.max(0, Math.min(this.path.length, ns));
      }
      const p = this.path.sample(ns);
      // jangan pernah melangkah mendekati badan kendaraan (menjauh atau menyamping tetap boleh)
      if (!stepAllowed(this, p.x, p.y)) {
        this.moving = false;
        this.blocked += dt;
        if (this.blocked > 1.5) {
          this.dir = -this.dir;
          this.blocked = 0;
          this.heading += Math.PI;
        }
        return false;
      }
      this.blocked = 0;
      this.moving = true;
      this.s = ns;
      this.x = p.x;
      this.y = p.y;
      this.heading = p.heading + (this.dir < 0 ? Math.PI : 0);
      this.phase += dt * 6;
      return true;
    }
  }

  const walkers = walkways.map((w, i) => new Walker(`pejalan-${i}`, w.pts, i));

  // Penyeberang di zebra cross: mendekat, menunggu di tepi jalan, menyeberang bila aman, lalu pergi.
  let crosserId = 0;
  const crossers = [];
  class Crosser {
    constructor(fromLeft, { atCurb = false } = {}) {
      const cw = crossing;
      this.id = `penyeberang-${crosserId++}`;
      this.kind = 'pedestrian';
      this.radius = 0.35;
      const i = crosserId;
      this.variant = PED_VARIANTS[(i + 2) % PED_VARIANTS.length];
      this.accent = COLORS.hijab[(i + 3) % COLORS.hijab.length];
      this.color = ['#f59e0b', '#38bdf8', '#e879f9', '#4ade80'][i % 4];
      const out = (curb, sign) => ({ x: curb.x + cw.left.x * 0.7 * sign, y: curb.y + cw.left.y * 0.7 * sign });
      const along = { x: Math.cos(cw.heading), y: Math.sin(cw.heading) };
      const near = fromLeft ? out(cw.curbL, 1) : out(cw.curbR, -1);
      const far = fromLeft ? out(cw.curbR, -1) : out(cw.curbL, 1);
      const a0 = rng.chance(0.5) ? 1 : -1;
      const d0 = rng.range(6, 10);
      this.waitPt = near;
      this.farPt = far;
      this.startPt = { x: near.x + along.x * a0 * d0, y: near.y + along.y * a0 * d0 };
      const a1 = rng.chance(0.5) ? 1 : -1;
      this.exitPt = { x: far.x + along.x * a1 * 8, y: far.y + along.y * a1 * 8 };
      this.speed = rng.range(1.15, 1.4);
      this.state = atCurb ? 'wait' : 'approach';
      const p = atCurb ? near : this.startPt;
      this.x = p.x;
      this.y = p.y;
      this.heading = Math.atan2(near.y - p.y, near.x - p.x);
      if (atCurb) this.heading = Math.atan2(far.y - near.y, far.x - near.x);
      this.wait = 0;
      this.stuck = 0;
      this.fade = 1;
      this.active = true;
      this.moving = false;
      this.phase = 0;
    }
    remove() {
      this.state = 'done';
      this.active = false;
    }
    /** Memberi jalan: yang masih di trotoar mundur dan pergi (memudar). Yang sedang menyeberang terus berjalan. */
    giveWay() {
      if (this.state === 'approach' || this.state === 'wait' || this.state === 'leave') this.state = 'fade';
    }
    /** Gap acceptance: setiap kendaraan yang mendekat masih bisa berhenti sebelum zebra cross. */
    safeToCross() {
      // posisi bemper relatif terhadap tepi zebra (dengan kelonggaran 0,5 m), negatif = belum sampai
      const cw0 = crossing.s0 - 0.5;
      const span = crossing.width + 1;
      const rel = (x) => wrap(x - cw0 + L / 2) - L / 2;
      const f = rel(egoS + ego.length / 2);
      const r = f - ego.length;
      if (f >= 0 && r <= span) return false; // bodi mobil di atas zebra: tunggu
      if (f >= 0) return true; // mobil sudah lewat
      const d = -f; // jarak bemper depan ke zebra
      const v = Math.max(0, ego.speed);
      // mobil sudah lama menunggu: yang baru datang menahan diri sampai mobil lewat
      if (yieldWait > YIELD_TURN && d < 40) return false;
      if (v < 0.3) return d >= 1;
      return d >= stoppingDistance(v, SHIELD.comfort) + 2.5;
    }
    _walkTo(target, dt) {
      const dx = target.x - this.x;
      const dy = target.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.05) return true;
      const step = Math.min(d, this.speed * dt);
      const base = Math.atan2(dy, dx);
      // langsung ke tujuan; bila mobil menghalangi, coba memutarinya (tidak pernah mendekati bodi mobil)
      for (const turn of [0, 0.6, -0.6, 1.2, -1.2, 1.57, -1.57]) {
        const a = base + turn;
        const nx = this.x + Math.cos(a) * step;
        const ny = this.y + Math.sin(a) * step;
        if (!stepAllowed(this, nx, ny)) continue;
        this.x = nx;
        this.y = ny;
        this.heading = a;
        this.moving = true;
        this.stuck = 0;
        this.phase += dt * 6;
        return turn === 0 && d - step < 0.05;
      }
      this.moving = false;
      this.stuck += dt;
      return false;
    }
    update(dt) {
      if (this.state === 'approach') {
        if (this._walkTo(this.waitPt, dt)) {
          this.state = 'wait';
          this.moving = false;
          this.heading = Math.atan2(this.farPt.y - this.y, this.farPt.x - this.x);
        }
      } else if (this.state === 'wait') {
        this.moving = false;
        this.wait += dt;
        // sedikit jeda reaksi, lalu menyeberang hanya bila aman
        if (this.wait > 0.6 && this.safeToCross()) {
          this.state = 'cross';
        }
      } else if (this.state === 'cross') {
        if (this._walkTo(this.farPt, dt)) {
          this.state = 'leave';
          monitor.state.crossings++;
        }
      } else if (this.state === 'leave') {
        if (this._walkTo(this.exitPt, dt)) this.state = 'fade';
      }
      // terhalang mobil terlalu lama di trotoar: masuk ke toko terdekat (memudar)
      if ((this.state === 'approach' || this.state === 'leave') && this.stuck > 3) this.state = 'fade';
      if (this.state === 'cross' && this.stuck > 6) this.state = 'fade';
      if (this.state === 'fade') {
        this.moving = false;
        this.fade -= dt / 0.6;
        if (this.fade <= 0) this.remove();
      }
    }
  }

  let nextSpawn = 4;
  /** Munculkan penyeberang baru. Hanya bila titik munculnya jauh dari bodi mobil; bila tidak, null. */
  function spawnCrosser(opts = {}) {
    if (!crossing) return null;
    const c = new Crosser(opts.fromLeft ?? rng.chance(0.5), opts);
    if (distanceToBox(c.x, c.y, bodyBox(ego)) < c.radius + 1.5) return null;
    crossers.push(c);
    return c;
  }

  const allPeds = () => [...walkers, ...crossers];

  // ---------- perisai ----------
  const shield = { active: false, distance: Infinity, yielding: false, held: 0 };

  /**
   * Perencana memberi jalan di zebra cross: jarak bemper depan ke garis henti (m) bila mobil harus
   * berhenti, atau Infinity. Untuk pejalan kaki yang baru menunggu, mobil hanya berhenti bila masih
   * bisa berhenti dengan perlambatan nyaman; bila tidak, pejalan kaki menunggu mobil lewat.
   */
  let yieldLatch = false;
  let yieldWait = 0; // lama mobil berhenti menunggu di zebra cross (detik)
  const YIELD_TURN = 8; // setelah menunggu selama ini, mobil mendapat giliran lewat
  function yieldDistance() {
    if (!crossing) return Infinity;
    const front = egoS + ego.length / 2;
    const dLine = ahead(front, crossing.s0 - STOP_BEFORE);
    const busy = crossers.some((c) => c.state === 'cross');
    const waiting = crossers.some((c) => c.state === 'wait' || (c.state === 'approach' && Math.hypot(c.x - c.waitPt.x, c.y - c.waitPt.y) < 3));
    if (dLine > 70 || (!busy && !waiting)) {
      yieldLatch = false;
      return Infinity;
    }
    const v = Math.max(0, ego.speed);
    // sudah menunggu lama dan tidak ada yang sedang menyeberang: mobil lewat, yang menunggu menahan diri
    if (!busy && yieldWait > YIELD_TURN) {
      yieldLatch = false;
      return Infinity;
    }
    if (!busy && !yieldLatch && dLine < (v * v) / (2 * SHIELD.comfort) - 0.2) return Infinity;
    yieldLatch = true;
    return dLine;
  }

  /** Batas yang tidak boleh dilewati pusat mobil selama ada yang menyeberang (m), atau Infinity. */
  function crosswalkLimit() {
    if (!crossing || !crossers.some((c) => c.state === 'cross')) return Infinity;
    const front = egoS + ego.length / 2;
    const d = ahead(front, crossing.s0);
    if (d > 60) return Infinity; // sudah di atas atau melewati zebra
    return d;
  }

  // ---------- pengemudi cadangan ----------
  // Saat mobil menyetir dengan posisi tebakan, pengemudi cadangan mengambil alih bila mobil keluar
  // lajur, atau lebih awal bila mobil jelas sedang meluncur keluar lajur dengan cepat.
  const backup = { take: 0, takeovers: 0, exits: 0, out: false, lat: 0, rate: 0, events: 0 };
  function updateBackup(dt, steering) {
    const lat = laneOffset();
    backup.rate = (lat - backup.lat) / dt;
    backup.lat = lat;
    const out = Math.abs(lat) > LANE_OUT;
    if (out && !backup.out && steering) backup.exits++;
    backup.out = out;
    if (!steering) {
      backup.take = 0;
      return;
    }
    if (backup.take > 0) {
      backup.take -= dt;
      if (backup.take <= 0 && Math.abs(lat) > 0.3) backup.take = 0.1;
    } else if (Math.abs(lat) > TAKEOVER_AT || (Math.abs(lat) > 0.5 && Math.abs(lat + backup.rate * 0.4) > TAKEOVER_AT)) {
      backup.take = 1.5;
      backup.takeovers++;
      backup.events++;
    }
  }
  function resetBackup() {
    Object.assign(backup, { take: 0, takeovers: 0, exits: 0, out: false, rate: 0 });
    backup.lat = laneOffset();
  }

  /**
   * Satu langkah fisika. pose null = simulator menyetir dengan posisi sebenarnya. Selain itu mobil
   * menyetir dengan pose hasil estimasi, dan pengemudi cadangan boleh mengambil alih.
   */
  function step(dt, pose = null) {
    const steering = !!pose;
    if (backup.take > 0) pose = null;
    const cruise = backup.take > 0 ? TAKEOVER_SPEED : CRUISE;
    // pejalan kaki lebih dulu (mereka tidak pernah melangkah ke badan mobil)
    for (const w of walkers) w.update(dt);
    for (const c of crossers) c.update(dt);
    for (let i = crossers.length - 1; i >= 0; i--) if (crossers[i].state === 'done') crossers.splice(i, 1);
    nextSpawn -= dt;
    if (nextSpawn <= 0) {
      if (crossers.filter((c) => c.active).length < 2) spawnCrosser();
      nextSpawn = rng.range(12, 26);
    }

    // perencana: kemudi pure pursuit dari posisi (sebenarnya atau tebakan), kecepatan dari profil tikungan
    const p = pose || ego;
    const pp = purePursuit({ x: p.x, y: p.y, heading: p.heading, speed: ego.speed, wheelbase: ego.wheelbase, maxSteer: ego.maxSteer }, lanePath, PP);
    let accel = ego.accelToward(Math.min(cruise, route.speedAt(egoS)));
    // memberi jalan di zebra cross: perlambatan tetap v^2 / (2 d) supaya berhenti tepat di garis henti
    const dLine = yieldDistance();
    shield.yielding = Number.isFinite(dLine);
    if (shield.yielding && ego.speed < 0.3) yieldWait += dt;
    else if (!crossing || ahead(egoS + ego.length / 2, crossing.s0) > 40) yieldWait = 0; // sudah lewat atau masih jauh
    if (shield.yielding) {
      const v = Math.max(0, ego.speed);
      const need = (v * v) / (2 * Math.max(0.05, dLine));
      if (dLine < 0.3) accel = Math.min(accel, -ego.maxBrake);
      else if (need > 0.6 * SHIELD.comfort) accel = Math.min(accel, -need);
    }
    const plan = { accel, brake: 0, steer: pp.steer };

    // perisai keselamatan: lapisan terakhir sebelum aktuasi
    const peds = allPeds();
    const sh = shieldCommand(ego, plan, pedestrianObstacles(peds), dt, { extraStop: crosswalkLimit() });
    shield.active = sh.active;
    shield.distance = sh.distance;
    // Mobil tertahan perisai lebih dari 3 detik (misalnya berhenti miring di dekat trotoar): pejalan
    // kaki yang ada di lintasannya memberi jalan, supaya tidak ada yang saling menunggu selamanya.
    shield.held = sh.active && ego.speed < 0.05 ? shield.held + dt : 0;
    if (shield.held > 3) {
      shield.held = 0;
      const look = stoppingDistance(ego.speed, ego.maxBrake) + SHIELD.margin + 10;
      for (const ped of peds) if (ped.active && corridorDistance(ego, pedestrianObstacles([ped]), look) < Infinity) ped.giveWay();
    }
    if (sh.active) {
      monitor.state.shieldInterventions++;
      if (sh.cmd.brake > 0) monitor.state.shieldHardBrakes++;
    }

    // aktuasi, lalu penjepit: bodi tidak pernah boleh masuk ke pejalan kaki
    const prev = { x: ego.x, y: ego.y, heading: ego.heading, speed: ego.speed, steer: ego.steer, odometer: ego.odometer, slip: ego._slip };
    ego.step(dt, sh.cmd);
    if (touchesPedestrian(ego, peds, 0.05)) {
      ego.x = prev.x;
      ego.y = prev.y;
      ego.heading = prev.heading;
      ego.steer = prev.steer;
      ego.odometer = prev.odometer;
      ego._slip = prev.slip;
      ego.speed = 0;
      ego.accel = 0;
      ego.braking = true;
      monitor.state.clamps++;
    }
    egoS = lanePath.closest(ego.x, ego.y).s;
    monitor.check([ego], peds);
    updateBackup(dt, steering);
  }

  /** Simpangan titik tengah mobil dari garis tengah lajur (positif = ke kiri). */
  function laneOffset() {
    return lanePath.closest(ego.x, ego.y).lateral;
  }

  function reset() {
    rng.reseed(seed);
    crossers.length = 0;
    crosserId = 0;
    nextSpawn = 4;
    yieldLatch = false;
    yieldWait = 0;
    walkers.forEach((w, i) => w.reset(i));
  }

  // ---------- menggambar ----------
  // jalan setapak OSM tidak digambar: garis putus-putusnya mirip zebra cross dan bisa membingungkan
  const renderer = createMapRenderer(map, { layers: { places: true, footways: false } });
  // Path2D dibuat saat pertama kali menggambar (model juga dipakai di Node tanpa kanvas)
  let zoneShapes = null;
  let lanePath2D = null;
  function buildShapes() {
    zoneShapes = zones.map((z) => {
      const left = [];
      const right = [];
      for (let s = z.s0; s <= z.s0 + z.length + 0.01; s += 2) {
        const p = lanePath.sample(s);
        const smp = route.infoAt(s);
        const lx = Math.sin(p.heading);
        const ly = -Math.cos(p.heading);
        left.push({ x: p.x + lx * (smp.leftEdge + 2.6), y: p.y + ly * (smp.leftEdge + 2.6) });
        right.push({ x: p.x - lx * (smp.rightEdge + 2.6), y: p.y - ly * (smp.rightEdge + 2.6) });
      }
      const band = new Path2D();
      [...left, ...right.reverse()].forEach((q, i) => (i ? band.lineTo(q.x, q.y) : band.moveTo(q.x, q.y)));
      band.closePath();
      const ends = [z.s0, z.s0 + z.length].map((s) => {
        const p = lanePath.sample(s);
        const smp = route.infoAt(s);
        const lx = Math.sin(p.heading);
        const ly = -Math.cos(p.heading);
        return {
          a: { x: p.x + lx * (smp.leftEdge + 2.6), y: p.y + ly * (smp.leftEdge + 2.6) },
          b: { x: p.x - lx * (smp.rightEdge + 2.6), y: p.y - ly * (smp.rightEdge + 2.6) },
        };
      });
      const bld = new Path2D();
      for (const b of z.buildings) {
        b.points.forEach((q, i) => (i ? bld.lineTo(q.x, q.y) : bld.moveTo(q.x, q.y)));
        bld.closePath();
      }
      return { zone: z, band, ends, bld };
    });
    lanePath2D = new Path2D();
    lanePath.points.forEach((q, i) => (i ? lanePath2D.lineTo(q.x, q.y) : lanePath2D.moveTo(q.x, q.y)));
  }
  const zebra = crossing
    ? makeCrosswalk({ x: crossing.x, y: crossing.y, heading: crossing.heading + Math.PI / 2, length: crossing.length, width: crossing.width })
    : null;

  /** Zona gedung tinggi: pita di atas jalan, garis batas, dan gedung penyusunnya. */
  function drawZones(g, view) {
    if (!zoneShapes) buildShapes();
    const vb = view.visibleBounds();
    g.save();
    for (const zs of zoneShapes) {
      g.fillStyle = withAlpha(COLORS.warn, 0.07);
      g.fill(zs.band);
      g.fillStyle = withAlpha(COLORS.warn, 0.12);
      g.fill(zs.bld);
      g.strokeStyle = withAlpha(COLORS.warn, 0.7);
      g.lineWidth = view.px(1.5);
      g.stroke(zs.bld);
      g.setLineDash([view.px(7), view.px(5)]);
      g.lineWidth = view.px(2);
      g.strokeStyle = withAlpha(COLORS.warn, 0.8);
      for (const e of zs.ends) {
        if (Math.max(e.a.x, e.b.x) < vb.minX || Math.min(e.a.x, e.b.x) > vb.maxX || Math.max(e.a.y, e.b.y) < vb.minY || Math.min(e.a.y, e.b.y) > vb.maxY) continue;
        g.beginPath();
        g.moveTo(e.a.x, e.a.y);
        g.lineTo(e.b.x, e.b.y);
        g.stroke();
      }
      g.setLineDash([]);
    }
    g.restore();
  }

  /** Garis tengah lajur yang diikuti mobil (jalur rencana). */
  function drawLane(g, view) {
    if (!lanePath2D) buildShapes();
    g.save();
    g.strokeStyle = withAlpha(COLORS.accent, 0.32);
    g.lineWidth = view.px(1.5);
    g.setLineDash([view.px(2), view.px(7)]);
    g.lineCap = 'round';
    g.stroke(lanePath2D);
    g.restore();
  }

  function drawLandmark(g, lm, view) {
    if (lm.kind === 'sudut') return; // sudut gedung sudah tergambar sebagai bagian gedung
    const r = Math.max(lm.radius, view.px(4.2));
    g.fillStyle = 'rgba(0, 0, 0, 0.35)';
    g.beginPath();
    g.arc(lm.x + r * 0.35, lm.y + r * 0.5, r, 0, TAU);
    g.fill();
    if (lm.kind === 'rambu') {
      // rambu contoh: pelat biru bertepi putih di atas tiang
      const s = r * 1.15;
      g.fillStyle = '#f8fafc';
      g.fillRect(lm.x - s, lm.y - s, 2 * s, 2 * s);
      g.fillStyle = '#1d4ed8';
      g.fillRect(lm.x - s * 0.72, lm.y - s * 0.72, 1.44 * s, 1.44 * s);
      return;
    }
    g.fillStyle = '#cbd5e1';
    g.beginPath();
    g.arc(lm.x, lm.y, r, 0, TAU);
    g.fill();
    g.strokeStyle = '#475569';
    g.lineWidth = view.px(1.2);
    g.stroke();
  }

  function drawPeople(g, view) {
    const vb = view.visibleBounds();
    for (const p of allPeds()) {
      if (!p.active || p.x < vb.minX - 3 || p.x > vb.maxX + 3 || p.y < vb.minY - 3 || p.y > vb.maxY + 3) continue;
      g.save();
      g.globalAlpha *= p.fade ?? 1;
      drawPedestrian(g, p, { view, minPx: 16, phase: p.phase, variant: p.variant, accent: p.accent, color: p.color });
      g.restore();
    }
  }

  /** Gambar dunia di atas peta (tanpa mobil). */
  function draw(g, view) {
    const vb = view.visibleBounds();
    drawZones(g, view);
    if (zebra) drawCrosswalk(g, zebra, { alpha: 0.8 });
    drawLane(g, view);
    for (const lm of landmarks) if (lm.x > vb.minX - 3 && lm.x < vb.maxX + 3 && lm.y > vb.minY - 3 && lm.y < vb.maxY + 3) drawLandmark(g, lm, view);
    drawPeople(g, view);
  }

  /** Mobil di posisi sebenarnya, digambar samar dengan garis putus-putus (hantu). */
  function drawGhost(g, view) {
    drawCar(g, ego, { alpha: 0.5, shadow: false, braking: ego.braking });
    g.save();
    g.translate(ego.x, ego.y);
    g.rotate(ego.heading);
    g.strokeStyle = 'rgba(248, 250, 252, 0.95)';
    g.lineWidth = view.px(2);
    g.setLineDash([view.px(5), view.px(4)]);
    const Lc = ego.length + 0.3;
    const Wc = ego.width + 0.3;
    roundRectPath(g, -Lc / 2, -Wc / 2, Lc, Wc, 0.5);
    g.stroke();
    g.restore();
  }

  placeAt(START_S);

  return {
    ego,
    lanePath,
    length: L,
    landmarks,
    zones,
    crossing,
    walkers,
    crossers,
    START_S,
    get s() {
      return egoS;
    },
    placeAt,
    step,
    laneOffset,
    inCanyon,
    zoneAtS,
    nextZone,
    canyonAt,
    spawnCrosser,
    allPeds,
    monitor,
    shield,
    backup,
    resetBackup,
    reset,
    renderer,
    draw,
    drawGhost,
  };
}
