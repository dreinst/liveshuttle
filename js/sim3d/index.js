// Shuttle 3D Ma Chung: bagian 3D situs LiveShuttle.
// Kontrak: mount(container, { mode: 'panduan' | 'jelajah', navigate }) mengembalikan { destroy() }.
// Fisika berjalan dengan langkah tetap 1/60 detik. Percepatan waktu menjalankan lebih banyak
// langkah, tidak pernah langkah yang lebih besar. Tampilan diinterpolasi di antara langkah fisika.
import * as THREE from '../vendor/three.bundle.min.js';
import { Disposer, Res, disposeTree, el, mulberry32, fmt } from './util.js';
import { City, loadCityData } from './city.js';
import { buildWorld, updateLabels } from './world.js';
import { Signals } from './signals.js';
import { Junctions } from './junctions.js';
import { Traffic } from './traffic.js';
import { Pedestrians } from './pedestrians.js';
import { Ego } from './ego.js';
import { Passing } from './passing.js';
import { Obstacles } from './obstacles.js';
import { Sensors } from './sensors.js';
import { Weather, WEATHER_LABEL } from './weather.js';
import { Cameras } from './cameras.js';
import { Hud } from './hud.js';
import { Guide } from './guide.js';
import { bindKeys } from './input.js';
import { InvariantMonitor, SHIELD } from './shield.js';

const DT = 1 / 60;
const MAX_STEPS = 24;
const TIME_SCALES = [1, 2, 4];

let webglChecked = null;
function webglAvailable() {
  if (webglChecked !== null) return webglChecked;
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    webglChecked = !!gl;
    if (gl) {
      const ext = gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    }
  } catch (e) {
    webglChecked = false;
  }
  return webglChecked;
}

/** Muat css/sim3d.css (sekali coba ulang bila koneksi terputus). */
function loadStyles() {
  const href = new URL('../../css/sim3d.css', import.meta.url).href;
  const state = { link: null };
  const attempt = (url) =>
    new Promise((resolve) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = url;
      link.dataset.sim3d = '';
      if (state.link) state.link.remove();
      state.link = link;
      const done = (ev) => {
        link.removeEventListener('load', done);
        link.removeEventListener('error', done);
        resolve(ev.type === 'load');
      };
      link.addEventListener('load', done);
      link.addEventListener('error', done);
      document.head.append(link);
    });
  const timeout = new Promise((resolve) => setTimeout(() => resolve(true), 4000));
  const done = Promise.race([attempt(href).then((ok) => ok || attempt(`${href}?ulang=1`)), timeout]);
  return { state, done };
}

async function loadWeatherEffects() {
  try {
    const mod = await import('../engine/sensors.js');
    return mod.WEATHER_EFFECTS || null;
  } catch (e) {
    return null;
  }
}

class App {
  constructor(container, mode, navigate) {
    this.container = container;
    this.mode = mode;
    this.navigate = typeof navigate === 'function' ? navigate : (h) => (location.hash = h);
    this.disposer = new Disposer();
    this.res = new Res();
    this.timers = new Set();
    this.destroyed = false;
    // biji acak tetap supaya kota selalu sama; uji boleh mengganti lewat window.__sim3dSeed
    this.rng = mulberry32(Number(window.__sim3dSeed) || 20260928);
    this.simTime = 0;
    this.paused = false;
    this.timeScale = 1;
    this.acc = 0;
    this.stepN = 0;
    this.fps = 60;
    this.frameMs = 16;
    this.slowT = 0;
    this.fastT = 0;
    this.droppedSteps = 0;
    this.focus = { x: 0, z: 0 };
    this.egoPose = { x: 0, z: 0, h: 0 };
    this.shieldStats = { shuttle: 0, npc: 0 };
    this.shieldLogList = [];
    this.shieldLogId = 0;
    this.debugLog = [];
    this.clampLog = [];
  }

  async init() {
    const styles = loadStyles();
    this.styleState = styles.state;
    const effectsP = loadWeatherEffects();
    const dataP = loadCityData();
    await styles.done;
    if (this.destroyed) return;
    if (!webglAvailable()) {
      this.fail();
      return;
    }
    const [effects, data] = await Promise.all([effectsP, dataP]);
    if (this.destroyed) return;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch (e) {
      this.fail();
      return;
    }
    this.renderer = renderer;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.className = 's3d-canvas';
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.setAttribute('aria-label', 'Tampilan 3D jalan di sekitar Universitas Ma Chung dengan shuttle otonom berwarna toska. Keadaan shuttle dijelaskan di panel.');
    this.maxRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.ratio = this.maxRatio;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.5, 2600);
    this.city = new City(data);
    this.world = buildWorld(this);
    this.invariants = new InvariantMonitor(this);
    this.weather = new Weather(this, effects);
    this.signals = new Signals(this);
    this.junctions = new Junctions(this);
    this.traffic = new Traffic(this);
    this.peds = new Pedestrians(this);
    this.passing = new Passing(this);
    this.obstacles = new Obstacles(this);
    this.ego = new Ego(this);
    this.ego.start();
    this.sensors = new Sensors(this);
    this.egoPose.x = this.ego.x;
    this.egoPose.z = this.ego.z;
    this.egoPose.h = this.ego.h;
    this.focus.x = this.ego.x;
    this.focus.z = this.ego.z;
    for (let i = 0; i < this.peds.target; i++) this.peds.spawnRandom(0);
    this.peds.register();
    for (let i = 0; i < this.traffic.target; i++) this.traffic.spawnRandom(25);

    // DOM
    this.hud = new Hud(this);
    this.root = this.hud.root;
    this.hud.stage.append(renderer.domElement);
    this.container.append(this.root);
    this.cameras = new Cameras(this, this.camera, renderer.domElement);
    this.guide = new Guide(this);
    const mq = matchMedia('(max-width: 760px)');
    const onMq = () => {
      this.hud.applyLayout(mq.matches);
      this.applyQuality();
    };
    this.disposer.on(mq, 'change', onMq);
    this.hud.applyLayout(mq.matches);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.hud.stage);
    this.disposer.add(() => this.ro.disconnect());
    this.applyQuality();
    bindKeys(this);
    this.disposer.on(window, 'hashchange', () => {
      const m = /^#\/shuttle-3d\/(panduan|jelajah)$/.exec(location.hash);
      if (m && m[1] !== this.mode) this.setMode(m[1]);
    });
    this.disposer.on(document, 'visibilitychange', () => {
      if (document.hidden) this.stopLoop();
      else this.startLoop();
    });
    this.hud.setMode(this.mode);
    this.guide.go(0);
    this.cameras.snapFocus();
    this.setCamera('drone', { reset: true, silent: true });

    Object.defineProperty(window, '__sim3d', { configurable: true, get: () => this.snapshot() });
    this.disposer.add(() => {
      delete window.__sim3d;
    });

    // beberapa detik awal supaya lalu lintas sudah bergerak saat pertama tampil
    for (let i = 0; i < 120; i++) this.step(DT);
    this.frame = this.frame.bind(this);
    this.startLoop();
    this.ready = true;
  }

  fail() {
    if (!this.styleState) this.styleState = loadStyles().state;
    const lessons = el('a', { class: 's3d-btn s3d-primary', href: '#/pelajaran/level-otomasi' }, 'Buka pelajaran pertama');
    const home = el('a', { class: 's3d-btn s3d-ghost', href: '#/' }, 'Kembali ke beranda');
    for (const [a, h] of [
      [lessons, '#/pelajaran/level-otomasi'],
      [home, '#/'],
    ]) {
      this.disposer.on(a, 'click', (ev) => {
        ev.preventDefault();
        this.navigate(h);
      });
    }
    this.root = el(
      'div',
      { class: 's3d s3d-failbox', role: 'alert' },
      el(
        'div',
        { class: 's3d-fail' },
        el('h2', {}, 'Shuttle 3D belum bisa berjalan di perangkat ini'),
        el('p', {}, 'Tampilan 3D ini membutuhkan WebGL 2, dan browser kamu belum bisa menjalankannya. Coba aktifkan akselerasi perangkat keras di pengaturan browser, atau buka dengan Chrome, Edge, Firefox, atau Safari versi terbaru.'),
        el('p', {}, 'Sementara itu, kamu tetap bisa belajar lewat pelajaran interaktif yang memakai tampilan 2D.'),
        el('div', { class: 's3d-fail-actions' }, lessons, home),
      ),
    );
    this.container.append(this.root);
    this.failed = true;
  }

  // ===== loop =====

  startLoop() {
    if (this.destroyed || this.raf || !this.renderer) return;
    this.lastT = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stopLoop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  frame(now) {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.frame);
    let dt = (now - this.lastT) / 1000;
    this.lastT = now;
    if (!(dt > 0)) dt = 0;
    dt = Math.min(dt, 0.1);
    if (dt > 0) this.fps += (1 / dt - this.fps) * 0.05;
    if (!this.paused) {
      this.acc += dt * this.timeScale;
      let n = 0;
      while (this.acc >= DT && n < MAX_STEPS) {
        this.step(DT);
        this.acc -= DT;
        n++;
      }
      if (this.acc >= DT) {
        this.droppedSteps += Math.floor(this.acc / DT);
        this.acc = 0;
      }
    }
    const alpha = this.paused ? 1 : Math.min(1, this.acc / DT);
    const t0 = performance.now();
    this.render(dt, alpha);
    this.adapt(dt, performance.now() - t0);
  }

  /** Resolusi adaptif: turunkan rasio piksel bila waktu bingkai lama di atas sekitar 20 ms. */
  adapt(dt, renderMs) {
    this.frameMs += (dt * 1000 - this.frameMs) * 0.05;
    void renderMs;
    if (this.frameMs > 20) {
      this.slowT += dt;
      this.fastT = 0;
    } else if (this.frameMs < 13) {
      this.fastT += dt;
      this.slowT = 0;
    } else {
      this.slowT = 0;
      this.fastT = 0;
    }
    if (this.slowT > 2 && this.ratio > 0.75) {
      this.ratio = Math.max(0.75, this.ratio - 0.25);
      this.slowT = 0;
      this.applyRatio();
    } else if (this.fastT > 6 && this.ratio < this.maxRatio) {
      this.ratio = Math.min(this.maxRatio, this.ratio + 0.25);
      this.fastT = 0;
      this.applyRatio();
    }
  }

  applyRatio() {
    this.renderer.setPixelRatio(this.ratio);
    this.resize();
  }

  applyQuality() {
    const mobile = this.hud && this.hud.mobile;
    this.lite = !!mobile;
    const shadows = !mobile;
    if (this.renderer.shadowMap.enabled !== shadows) {
      this.renderer.shadowMap.enabled = shadows;
      this.weather.sun.castShadow = shadows;
      this.scene.traverse((o) => {
        const m = o.material;
        if (m) (Array.isArray(m) ? m : [m]).forEach((mm) => (mm.needsUpdate = true));
      });
    }
    this.applyRatio();
  }

  // ===== simulasi =====

  step(dt) {
    this.simTime += dt;
    this.stepN++;
    this.weather.step(dt);
    this.signals.step(dt);
    const T = this.traffic;
    this.passing.prune();
    T.savePrev();
    T.beginTick();
    this.peds.step(dt);
    this.junctions.beginTick();
    T.requestAll();
    this.junctions.process();
    T.stepAll(dt);
    this.ego.step(dt);
    this.sensors.step(dt);
    this.invariants.checkContacts(T.all, this.peds.grid);
    if (this.stepN % 6 === 0) {
      T.checkOverlaps();
      T.checkOffRoad();
    }
    if (this.simTime >= (this.nextBalance || 0)) {
      this.nextBalance = this.simTime + 0.5;
      T.balance();
      this.peds.balance();
      T.watchdog();
    }
  }

  // ===== tampilan =====

  render(dtReal, alpha) {
    const simDt = this.paused ? 0 : dtReal * this.timeScale;
    const v = this.ego.veh;
    let dh = v.h - v.ph;
    if (dh > Math.PI) dh -= Math.PI * 2;
    if (dh < -Math.PI) dh += Math.PI * 2;
    this.egoPose.x = v.px + (v.x - v.px) * alpha;
    this.egoPose.z = v.pz + (v.z - v.pz) * alpha;
    this.egoPose.h = v.ph + dh * alpha;
    this.focus.x = this.egoPose.x;
    this.focus.z = this.egoPose.z;
    const lights = this.weather.lightsOn;
    this.renderAlpha = alpha;
    this.traffic.sync(alpha, lights, this.simTime);
    this.peds.sync(alpha);
    this.ego.sync(this.egoPose, dtReal, simDt, lights);
    this.obstacles.sync(lights, this.simTime);
    this.sensors.sync(dtReal);
    this.signals.sync();
    this.cameras.update(dtReal);
    this.hud.map.draw(dtReal);
    updateLabels(this.world, this.camera.position.y);
    this.weather.fitFog(this.camera.position, this.focus.x, this.focus.z);
    this.weather.update(dtReal, simDt, this.camera.position);
    this.weather.follow(this.focus.x, this.focus.z);
    this.renderer.render(this.scene, this.camera);
    this.hudT = (this.hudT || 0) + dtReal;
    if (this.hudT > 0.15 || !this.hudOnce) {
      this.hudT = 0;
      this.hudOnce = true;
      this.hud.update();
    }
  }

  resize() {
    if (!this.renderer || !this.hud) return;
    const st = this.hud.stage;
    const w = Math.max(1, st.clientWidth);
    const h = Math.max(1, st.clientHeight);
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setCabinView(on) {
    this.ego.model.setCabin(on);
  }

  // ===== aksi =====

  toast(text, kind) {
    if (this.hud) this.hud.toast(text, kind);
  }

  setMode(mode) {
    if (mode !== 'panduan' && mode !== 'jelajah') return;
    if (mode === this.mode) return;
    this.mode = mode;
    this.hud.setMode(mode);
    try {
      history.replaceState(history.state, '', `#/shuttle-3d/${mode}`);
    } catch (e) {
      /* abaikan */
    }
    if (mode === 'panduan') this.guide.render();
    this.resize();
  }

  setCamera(mode, opts = {}) {
    this.cameras.set(mode, opts);
    this.hud.setCamera(mode);
    if (!opts.silent) this.guide.event('camera', mode);
  }

  toggleManual() {
    const r = this.ego.setManual(this.ego.mode !== 'manual');
    if (!r.ok) this.toast(r.reason, 'warn');
    this.hud.update();
  }

  togglePause() {
    this.paused = !this.paused;
    this.acc = 0;
    this.hud.update();
  }

  setTimeScale(s) {
    if (!TIME_SCALES.includes(s)) return;
    this.timeScale = s;
    this.hud.update();
  }

  toggleHelp(force) {
    const open = force === undefined ? this.hud.help.hidden : force;
    this.hud.showHelp(open);
  }

  guideEvent(type, value) {
    if (this.guide) this.guide.event(type, value);
  }

  /** Jalan ditutup atau dibuka, penghalang dipasang atau diangkat. */
  onRoadChange(kind, info) {
    this.traffic.onRoadChange();
    this.ego.onRoadChange(kind, info);
  }

  onWeatherChange(name) {
    if (this.hud) this.toast(`Cuaca berganti: ${WEATHER_LABEL[name]}. ${this.ego.weatherNote()}`);
  }

  /** Catatan intervensi perisai. Untuk shuttle ditulis dalam kalimat sederhana. */
  shieldLog(veh, cons) {
    if (!veh.ego) {
      this.shieldStats.npc++;
      return;
    }
    this.shieldStats.shuttle++;
    let text;
    const at = cons.name ? ` di ${cons.name}` : '';
    const d = Math.max(0, cons.d);
    if (cons.kind === 'merah') text = `Berhenti, lampu merah${at}`;
    else if (cons.kind === 'kuning') text = `Berhenti, lampu kuning${at}`;
    else if (cons.kind === 'zebra') text = `Mengerem, zebra cross sedang dipakai${at}`;
    else if (cons.kind === 'pejalan-arah') text = `Menahan gas, pejalan kaki akan menyeberang ${fmt(d, 0)} m di depan`;
    else text = `Menahan gas, pejalan kaki ${fmt(d, 0)} m di depan`;
    this.shieldLogList.push({ id: ++this.shieldLogId, t: this.simTime, text });
    if (this.shieldLogList.length > 20) this.shieldLogList.shift();
  }

  noteClamp(veh, cons) {
    const e = { t: Math.round(this.simTime * 10) / 10, v: `${veh.type}#${veh.id}`, kind: cons.kind, d: Math.round(cons.d * 100) / 100, link: veh.link.id, x: Math.round(veh.x * 10) / 10, z: Math.round(veh.z * 10) / 10, vv: Math.round(veh.v * 100) / 100 };
    if (cons.ped) {
      Object.assign(e, { ped: cons.ped.id, pstate: cons.ped.state, pedge: cons.ped.edge.id, px: Math.round(cons.ped.x * 10) / 10, pz: Math.round(cons.ped.z * 10) / 10 });
      const L = cons.link;
      if (L) {
        e.clink = L.id;
        e.ckind = L.kind;
        for (let i = 0; i < L.pedN; i++) {
          const pe = L.peds[i];
          if (pe.ped === cons.ped) {
            e.pes = Math.round(pe.s * 100) / 100;
            e.pelat = Math.round(pe.lat * 100) / 100;
            e.pred = pe.pred;
            e.sw = L.sweepArr ? Math.round(L.sweepArr[Math.max(0, Math.min(L.sweepArr.length - 1, Math.round(pe.s / L.sweepStep)))] * 100) / 100 : 0;
            break;
          }
        }
      }
    }
    this.clampLog.push(e);
    if (this.clampLog.length > 30) this.clampLog.shift();
  }

  logDebug(entry) {
    entry.t = Math.round(this.simTime * 10) / 10;
    this.debugLog.push(entry);
    if (this.debugLog.length > 60) this.debugLog.shift();
  }

  // ===== pengait uji (baca saja, plus fungsi uji tersembunyi) =====

  snapshot() {
    const T = this.traffic;
    const e = this.ego;
    const byType = {};
    for (const c of T.cars) byType[c.type] = (byType[c.type] || 0) + 1;
    const r = this.renderer;
    return Object.freeze({
      ready: !!this.ready,
      mode: this.mode,
      paused: this.paused,
      timeScale: this.timeScale,
      simTime: this.simTime,
      camera: this.cameras ? this.cameras.mode : null,
      guide: this.guide ? this.guide.summary() : null,
      weather: { name: this.weather.name, label: WEATHER_LABEL[this.weather.name], next: this.weather.nextName, countdown: this.weather.countdown, mu: this.weather.mu, changes: this.weather.changes },
      shuttle: e.snapshot(),
      nav: e.nav.summary(),
      sensors: this.sensors.summary(),
      invariants: { redLight: this.invariants.redLight, pedContact: this.invariants.pedContact, events: this.invariants.events.slice(-10) },
      shield: { shuttle: this.shieldStats.shuttle, npc: this.shieldStats.npc, clamps: T.stats.clamps, log: this.shieldLogList.slice(-5).map((l) => l.text), clampLog: this.clampLog.slice(-10) },
      collisions: { npcOverlaps: T.stats.overlaps, other: e.stats.collisions },
      traffic: {
        vehicles: T.cars.length,
        byType,
        outside: T.outside.length,
        peds: this.peds.peds.length,
        stuckNow: T.stuckNow || 0,
        stuckMax: T.stats.stuckMax,
        recovered: T.stats.recovered,
        offRoad: T.stats.offRoad,
        followClamps: T.stats.followClamps,
        lineClamps: T.stats.lineClamps,
        exits: T.stats.exits,
        entries: T.stats.entries,
        grants: this.junctions.grants,
        dilemma: T.stats.dilemma,
        crossings: this.peds.stats.crossings,
        gaveUp: this.peds.stats.gaveUp,
        blockedSteps: this.peds.stats.blockedSteps,
      },
      signals: this.signals.list.map((c) => ({ id: c.id, stage: c.stage.type, arm: c.stage.arm, yellow: c.plan.yellow })),
      map: { lanes: this.city.lanes.length, connectors: this.city.conns.length, laneZones: this.city.laneZoneCount || 0, junctions: this.city.junctions.length, signals: this.signals.list.length, crossings: this.city.crossings.length, halte: this.city.halte.map((h) => h.name), buildings: this.city.data.buildings.length },
      render: { cam: this.camera ? [this.camera.position.x, this.camera.position.y, this.camera.position.z] : null, fps: this.fps, frameMs: this.frameMs, calls: r ? r.info.render.calls : 0, triangles: r ? r.info.render.triangles : 0, width: this.width, height: this.height, pixelRatio: r ? r.getPixelRatio() : 0, droppedSteps: this.droppedSteps },
      debugLog: this.debugLog.slice(-20),
      debug: this.debugApi(),
    });
  }

  debugApi() {
    if (this._debug) return this._debug;
    this._debug = Object.freeze({
      setWeather: (name) => {
        this.weather.change(name, true);
        return this.weather.name;
      },
      skipWeather: () => {
        this.weather.skip();
        return this.weather.name;
      },
      spawnCrossing: () => this.ego.trySpawnCrossing(),
      requestCrossing: () => this.ego.requestCrossing(),
      setManual: (on) => this.ego.setManual(on),
      // khusus uji: masukan kemudi manual 0 sampai 1 (up, down, left, right)
      drive: (inp) => Object.assign(this.ego.input, inp),
      // khusus uji: letakkan shuttle manual di pose tertentu (seluruh badan di jalan, tidak menimpa pejalan kaki)
      placeShuttle: (x, z, h) => {
        const e = this.ego;
        const c = Math.cos(h);
        const s = Math.sin(h);
        const onPed = this.peds.peds.some((p) => Math.abs((p.x - x) * c + (p.z - z) * s) < 4 && Math.abs((p.z - z) * c - (p.x - x) * s) < 2);
        if (e.mode !== 'manual' || e.offMask(x, z, h) || onPed) return false;
        Object.assign(e.veh, { x, z, h, px: x, pz: z, ph: h, v: 0, kappa: 0 });
        e.vs = 0;
        e.aSigned = 0;
        e.snapToLink();
        return true;
      },
      speedLimit: (kmh) => this.ego.setSpeedLimit(kmh),
      obstacle: (kind) => {
        const r = this.obstacles.placeAhead(kind);
        return { ok: r.ok, reason: r.reason, dist: r.dist };
      },
      clearObstacles: () => this.obstacles.clear(),
      toggleRoad: (x, z) => {
        const id = this.obstacles.roadAt(x, z);
        return id === null ? { ok: false, reason: 'bukan-jalan' } : this.obstacles.toggleRoad(id);
      },
      // khusus uji: tutup jalan pertama di rute shuttle yang lebih dari minDist meter di depan
      closeAhead: (minDist = 80) => {
        const v = this.ego.veh;
        let d = -v.s;
        for (const l of [v.link].concat(v.path, v.route || [])) {
          if (d > minDist && l.kind === 'lane' && l.roadId >= 0) {
            const r = this.obstacles.closeRoad(l.roadId);
            if (r.ok) return { ...r, roadId: l.roadId, dist: d };
          }
          d += l.len;
        }
        return { ok: false };
      },
      openRoad: (id) => this.obstacles.openRoad(id),
      // khusus uji: pose di tengah lajur lurus yang panjang (untuk uji mengemudi manual)
      lanePoses: () =>
        this.city.lanes
          .filter((l) => l.core && !l.closed && l.ring === null && l.len > 70)
          .map((l) => {
            const s = l.len > 130 ? 8 : l.len / 2 - 20;
            const o = l.poly.atSmooth(s, {});
            return { id: l.id, x: o.x, z: o.z, h: o.h, len: l.len - s, name: l.name || '', routable: this.city.halte.some((hh) => this.ego.routeTo(l, s, hh)) };
          }),
      callPassengers: (i, n) => this.ego.pax.call(i, n),
      sensorView: (v) => this.sensors.setView(v),
      lidarRays: (on) => this.sensors.setRays(on),
      signalArms: () => this.signals.list.flatMap((c) => c.arms.map((a, i) => ({ ctl: c.id, arm: i, x: a.x, z: a.z, h: a.h, half: a.half, name: a.name, color: c.color(i) }))),
      egoRoute: () => [this.ego.veh.link].concat(this.ego.veh.path, this.ego.veh.route || []).map((l) => l.id),
      // khusus uji: jalankan n langkah fisika 1/60 detik tanpa menggambar
      runSteps: (n) => {
        const t0 = performance.now();
        for (let i = 0; i < n; i++) this.step(DT);
        return performance.now() - t0;
      },
      screenOf: (x, z) => {
        const v = new THREE.Vector3(x, 0, z).project(this.camera);
        const rc = this.renderer.domElement.getBoundingClientRect();
        return { x: rc.left + ((v.x + 1) / 2) * rc.width, y: rc.top + ((1 - v.y) / 2) * rc.height, visible: v.z < 1 };
      },
      lookAt: (x, z, height) => {
        this.cameras.set('peta', { instant: true });
        this.hud.setCamera('peta');
        this.cameras.mapHeight = height || 230;
        this.viewOverride = { x, z, h: 0 };
        this.cameras.fx.reset(x);
        this.cameras.fz.reset(z);
      },
      // khusus uji: titik rute shuttle d meter di depan, dan posisinya di layar peta rute
      routeAhead: (d) => {
        const n = this.ego.nav;
        const cum = n.routeCum;
        for (let i = 0; i < cum.length; i++) if (cum[i] >= n.progress + d) return { x: n.route[i * 2], z: n.route[i * 2 + 1] };
        return null;
      },
      mapScreenOf: (x, z) => {
        const p = this.hud.map.toScreen(x, z);
        const rc = this.hud.map.canvas.getBoundingClientRect();
        return { x: rc.left + p.x, y: rc.top + p.y };
      },
      clearView: () => {
        this.viewOverride = null;
      },
      shield: SHIELD,
      offRoadEvents: () => (this.traffic.offRoadEvents || []).slice(-400),
      linkInfo: (id) => { const l = this.city.links[id]; return l ? { kind: l.kind, len: l.len, stopLen: l.stopLen, name: l.name, cls: l.cls, j: l.junction ? l.junction.id : null, move: l.move, from: l.from ? l.from.id : null, to: l.to ? l.to.id : null } : null; },
      sceneStats: () => {
        const out = [];
        this.scene.traverse((o) => {
          if (!o.isMesh || !o.geometry) return;
          const g = o.geometry;
          const tri = (g.index ? g.index.count : g.attributes.position.count) / 3;
          const n = o.isInstancedMesh ? o.count : 1;
          out.push({ name: o.name || o.type, tris: Math.round(tri * n), inst: n, shadow: o.castShadow });
        });
        return out.sort((a, b) => b.tris - a.tris).slice(0, 25);
      },
      probe: (id, x, z) => {
        const l = this.city.links[id];
        const pr = l.poly.project(x, z, {});
        const a = l.sweepArr;
        return { s: pr.s, lat: pr.lat, len: l.len, sweep: a ? a[Math.max(0, Math.min(a.length - 1, Math.round(pr.s / l.sweepStep)))] : 0, maxSweep: l.sweep };
      },
      probeNear: (x, z) =>
        this.city.linksNear(x, z).map((l) => {
          const pr = l.poly.project(x, z, {});
          const a = l.sweepArr;
          return { id: l.id, kind: l.kind, s: Math.round(pr.s * 100) / 100, lat: Math.round(pr.lat * 100) / 100, len: Math.round(l.len * 100) / 100, sweep: a ? Math.round(a[Math.max(0, Math.min(a.length - 1, Math.round(pr.s / l.sweepStep)))] * 100) / 100 : 0 };
        }).filter((q) => Math.abs(q.lat) < 4 && q.s > -1 && q.s < q.len + 1),
      egoCons: () => {
        const v = this.ego.veh;
        const c = v.cons;
        const o = { d: c.d, kind: c.kind, link: c.link ? c.link.id : null, v: v.v, s: v.s, vlink: v.link.id, path: v.path.slice(0, 3).map((l) => l.id) };
        if (c.ped && c.link) {
          const L = c.link;
          for (let i = 0; i < L.pedN; i++) if (L.peds[i].ped === c.ped) Object.assign(o, { pes: L.peds[i].s, pelat: L.peds[i].lat, pred: L.peds[i].pred, px: c.ped.x, pz: c.ped.z, pstate: c.ped.state });
        }
        return o;
      },
      stopBacks: () => this.city.lanes.filter((l) => l.stopLen < l.len - 0.01).map((l) => Math.round((l.len - l.stopLen) * 10) / 10),
      // khusus uji: keadaan kendaraan yang diam paling lama (untuk mencari kebuntuan)
      vehicles: (minStuck = 0) =>
        this.traffic.all
          .filter((v) => v.stuckT >= minStuck)
          .map((v) => ({ id: v.id, type: v.type, link: v.link.id, lk: v.link.kind, s: Math.round(v.s * 10) / 10, len: Math.round(v.link.len * 10) / 10, v: Math.round(v.v * 100) / 100, stuck: Math.round(v.stuckT), reason: v.planReason, grants: v.grants.map((g) => g.c.id), req: v.reqConn ? v.reqConn.id : null, path: v.path.slice(0, 12).map((l) => `${l.kind === 'conn' ? 'c' : l.ring !== null ? 'r' : 'l'}${l.id}:${Math.round(l.len * 10) / 10}${l.portal ? l.portal : ''}${l.occN ? '*' + l.occN : ''}`), x: Math.round(v.x * 10) / 10, z: Math.round(v.z * 10) / 10, cons: v.cons.kind, consD: Math.round(v.cons.d * 10) / 10, rbExit: v.rbExit ? v.rbExit.id : null, why: v.waitWhy || 0 })),
      zoneInfo: (id) => {
        const c = this.city.links[id];
        if (!c) return null;
        return {
          laneZones: (c.laneZones || []).map((z) => ({ lane: z.lane.id, kind: z.kind, s0: z.s0, s1: z.s1, cs1: z.cs1, laneLen: z.lane.len, stopLen: z.lane.stopLen, occ: Array.from({ length: z.lane.occN }, (_, i) => ({ v: z.lane.occ[i].veh.id, s: z.lane.occ[i].s })) })),
          conflicts: (c.conflicts || []).map((k) => ({ o: k.o.id, my: k.my, ot: k.ot, zone: !!k.zone, holders: k.o.holders.map((w) => w.id) })),
          rank: c.rank,
          approach: (c.approach || []).map((a) => ({ v: a.veh.id, d: a.d })),
        };
      },
      // khusus uji: ubah jumlah kendaraan NPC yang dijaga (dipakai juga oleh pengatur kepadatan nanti)
      setTraffic: (n) => {
        this.traffic.target = Math.max(0, Math.min(this.traffic.max, Math.round(n)));
        return this.traffic.target;
      },
      pedList: () => this.peds.peds.map((p) => ({ id: p.id, state: p.state, edge: p.edge.id, t: Math.round(p.t * 10) / 10, fwd: p.fwd, x: Math.round(p.x), z: Math.round(p.z), wait: Math.round(p.waitT) })),
      // khusus uji: posisi tepat untuk pemantau geometri independen
      geo: () => ({
        v: this.traffic.all.map((v) => [v.x, v.z, v.h, v.len / 2, v.hw, v.v, v.id, v.ego ? 1 : 0]),
        p: this.peds.peds.map((p) => [p.x, p.z, p.id]).concat(this.ego.pax.walkers.map((w) => [w.x, w.z, -1])),
        a: this.signals.list.flatMap((c) => c.arms.map((a, i) => [a.x, a.z, a.h, a.half, c.color(i)])),
      }),
      pedStates: () => {
        const o = { walk: 0, wait: 0, cross: 0, test: 0 };
        for (const p of this.peds.peds) {
          o[p.state] = (o[p.state] || 0) + 1;
          if (p.test) o.test++;
        }
        return o;
      },
    });
    return this._debug;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopLoop();
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.disposer.run();
    if (this.cameras) this.cameras.dispose();
    if (this.scene) {
      disposeTree(this.scene);
      this.scene.clear();
    }
    this.res.dispose();
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      this.renderer.domElement.remove();
      this.renderer = null;
    }
    if (this.root) this.root.remove();
    if (this.styleState && this.styleState.link) this.styleState.link.remove();
    this.scene = null;
    this.world = null;
    this.city = null;
  }
}

export async function mount(container, { mode = 'panduan', navigate } = {}) {
  const m = mode === 'jelajah' || mode === 'bebas' ? 'jelajah' : 'panduan';
  const app = new App(container, m, navigate);
  try {
    await app.init();
  } catch (err) {
    console.warn('Shuttle 3D gagal dimuat:', err);
    const nav = app.navigate;
    app.destroy();
    const again = new App(container, m, nav);
    again.fail();
    return { destroy: () => again.destroy() };
  }
  return { destroy: () => app.destroy() };
}
