// Simulator Kendaraan Otonom 3D.
// Kontrak: mount(container, { mode, navigate }) mengembalikan { destroy() }.
// Simulasi berjalan dengan langkah tetap 1/60 detik dan terpisah dari tampilan.
import * as THREE from '../vendor/three.bundle.min.js';
import { Disposer, Res, disposeTree, el, mulberry32, ms, kmh, clamp } from './util.js';
import { buildGraph } from './roadgraph.js';
import { buildWorld } from './world.js';
import { Signals } from './signals.js';
import { Traffic, LaneIndex, CAR_LEN, CAR_WID } from './traffic.js';
import { Pedestrians } from './pedestrians.js';
import { Scenarios } from './scenarios.js';
import { Ego } from './ego.js';
import { Sensing } from './sensing.js';
import { Perception } from './perception.js';
import { Planner } from './planning.js';
import { Controller } from './control.js';
import { Weather } from './weather.js';
import { Cameras, CAMERA_MODES } from './cameras.js';
import { Hud } from './hud.js';
import { Tutorial } from './tutorial.js';
import { bindKeys } from './input.js';
import { obbOverlap, obbCircle, obbAabb } from './geom.js';

const DT = 1 / 60;
const SPEED_STEPS = [0.25, 0.5, 1, 2, 4];
// Hemat benar-benar mengurangi beban: resolusi lebih rendah (juga di layar 1x), tanpa bayangan,
// tanpa genangan cahaya lampu jalan, hujan lebih sedikit, dan jarak pandang kamera lebih pendek.
const QUALITY = {
  hemat: { ratio: 0.8, shadows: false, lite: true, far: 700 },
  standar: { ratio: 1.25, shadows: false, lite: false, far: 1400 },
  tinggi: { ratio: 1.5, shadows: true, lite: false, far: 1400 },
};

let webglChecked = null;
function webglAvailable() {
  if (webglChecked !== null) return webglChecked;
  webglChecked = probeWebgl();
  return webglChecked;
}

function probeWebgl() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return false;
    const ext = gl.getExtension('WEBGL_lose_context');
    if (ext) ext.loseContext();
    return true;
  } catch (e) {
    return false;
  }
}

/** Muat css/sim3d.css. Bila gagal (misalnya koneksi terputus), coba sekali lagi. */
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
    this.rng = mulberry32(12345);
    this.simTime = 0;
    this.paused = false;
    this.timeScale = 1;
    this.acc = 0;
    this.autopilot = true;
    this.targetSpeed = ms(50);
    this.quality = 'standar';
    this.lateralError = 0;
    this.waitingNow = 0;
    this.objects = [];
    this.counters = { collisions: 0, aebAuto: 0, aebManual: 0, overtakes: 0, placed: 0, jaywalkers: 0, destinations: 0 };
    this.contacts = new Set();
    this.closedSegs = new Set();
    this.debugLog = [];
    this.fps = 60;
    this.frames = 0;
    this.stepN = 0;
  }

  async init() {
    const styles = loadStyles();
    this.styleState = styles.state;
    const effects = await loadWeatherEffects();
    await styles.done;
    if (this.destroyed) return;
    if (!webglAvailable()) {
      this.fail();
      return;
    }
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
    renderer.domElement.setAttribute('aria-label', 'Tampilan 3D kota dengan mobil otonom berwarna toska. Keadaan mobil dijelaskan di panel samping.');

    // Ponsel memakai Standar (rasio piksel 1,25) supaya marka dan titik LiDAR tetap tajam.
    this.quality = 'standar';

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.3, 1400);
    this.graph = buildGraph();
    this.world = buildWorld(this.scene, this.res, this.graph);
    this.laneIdx = new LaneIndex(this.graph.lanes.length);
    this.connTarget = new Int16Array(this.graph.lanes.length);
    this.boxOcc = {};
    for (const n of this.graph.nodes) this.boxOcc[n.id] = new Int8Array(4);

    this.ego = new Ego(this);
    this.signals = new Signals(this);
    this.weather = new Weather(this, effects);
    this.traffic = new Traffic(this);
    this.peds = new Pedestrians(this);
    this.scen = new Scenarios(this);
    this.sensing = new Sensing(this);
    this.perception = new Perception(this);
    this.planner = new Planner(this);
    this.control = new Controller(this);

    // Posisi awal mobil otonom: lajur kiri, menghadap timur, dekat pusat kota.
    const startSeg = this.graph.segs.find((s) => s.a.i === 1 && s.a.j === 2 && s.k === 0) || this.graph.segs[0];
    const lane = startSeg.lanes[0];
    const p = lane.poly.at(14, {});
    this.ego.x = p.x;
    this.ego.z = p.z;
    this.ego.h = p.h;
    this.ego.v = 6;
    this.planner.planFrom(lane, 14);
    for (let i = 0; i < this.traffic.target; i++) this.traffic.spawnRandom(28);
    for (let i = 0; i < this.peds.target; i++) this.peds.spawnRandom(0);

    // DOM
    this.hud = new Hud(this);
    this.help = this.hud.help;
    this.root = this.hud.root;
    this.hud.stage.prepend(renderer.domElement);
    this.container.append(this.root);
    this.cameras = new Cameras(this, this.camera, renderer.domElement);
    this.tutorial = new Tutorial(this);
    this.hud.qualSel.value = this.quality;
    this.applyQuality();

    // Lembar bawah dengan tab dipakai di ponsel dan tablet tegak (lebar sampai 900 px).
    const mq = matchMedia('(max-width: 900px)');
    const onMq = () => {
      this.hud.applyLayout(mq.matches);
      this.resize();
    };
    this.disposer.on(mq, 'change', onMq);
    this.hud.applyLayout(mq.matches);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.hud.stage);
    this.disposer.add(() => this.ro.disconnect());
    this.resize();

    this.bindPointer();
    bindKeys(this);
    // Tautan ke #/simulator/tutorial atau /bebas saat simulator sudah terbuka: ganti mode tanpa memuat ulang.
    this.disposer.on(window, 'hashchange', () => {
      const m = /^#\/simulator\/(tutorial|bebas)$/.exec(location.hash);
      if (m && m[1] !== this.mode) this.setMode(m[1]);
    });
    // Tautan lain di halaman (misalnya menu Simulator 3D di kepala halaman) ke mode simulator:
    // ganti mode di tempat supaya kemajuan tutorial dan penghitung tidak hilang karena dimuat ulang.
    this.disposer.on(
      document,
      'click',
      (ev) => {
        if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
        const a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
        if (!a || (this.root && this.root.contains(a)) || a.target === '_blank') return;
        const m = /^#\/simulator(?:\/(tutorial|bebas))?$/.exec(a.getAttribute('href') || '');
        if (!m) return;
        ev.preventDefault();
        this.setMode(m[1] || 'tutorial');
      },
      true,
    );
    this.disposer.on(document, 'visibilitychange', () => {
      if (document.hidden) this.stopLoop();
      else this.startLoop();
    });

    this.setCamera(this.mode === 'tutorial' ? 'orbit' : 'kejar', { reset: true });
    this.hud.setMode(this.mode);
    this.tutorial.go(0);
    if (this.mode !== 'tutorial') this.hud.highlight([]);

    // Pengait baca saja untuk uji otomatis
    Object.defineProperty(window, '__sim3d', { configurable: true, get: () => this.snapshot() });
    this.disposer.add(() => {
      delete window.__sim3d;
    });

    // Beberapa langkah awal supaya lampu dan mobil sudah bergerak saat pertama tampil
    for (let i = 0; i < 30; i++) this.step(DT);
    this.frame = this.frame.bind(this);
    this.startLoop();
    this.ready = true;
  }

  fail() {
    if (!this.styleState) this.styleState = loadStyles().state;
    const link = el('a', { class: 's3d-btn s3d-primary', href: '#/pelajaran/level-otomasi' }, 'Buka pelajaran pertama');
    const home = el('a', { class: 's3d-btn s3d-ghost', href: '#/' }, 'Kembali ke beranda');
    for (const [a, h] of [
      [link, '#/pelajaran/level-otomasi'],
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
        el('h2', {}, 'Simulator 3D belum bisa berjalan di perangkat ini'),
        el('p', {}, 'Simulator ini membutuhkan WebGL 2, dan browser kamu belum bisa menjalankannya. Coba aktifkan akselerasi perangkat keras di pengaturan browser, atau buka dengan Chrome, Edge, Firefox, atau Safari versi terbaru.'),
        el('p', {}, 'Sementara itu, kamu tetap bisa belajar lewat pelajaran interaktif yang memakai tampilan 2D.'),
        el('div', { class: 's3d-fail-actions' }, link, home),
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
    this.fps += (1 / Math.max(dt, 1e-3) - this.fps) * 0.05;
    if (!this.paused) {
      this.acc += dt * this.timeScale;
      let n = 0;
      while (this.acc >= DT && n < 8) {
        this.step(DT);
        this.acc -= DT;
        n++;
      }
      if (n >= 8) this.acc = 0;
    }
    this.render(dt);
    this.frames++;
  }

  // ===== simulasi =====

  step(dt) {
    this.simTime += dt;
    const idx = this.laneIdx;
    idx.clear();
    this.scen.register(idx);
    this.peds.register(idx);
    this.traffic.register(idx);
    const e = this.ego;
    for (const { lane, s } of this.planner.egoLanes()) idx.add(lane.id, s - e.hl, s + e.hl, Math.max(0, e.v), 'ego', e);
    this.countBoxes();
    this.signals.step(dt);
    this.traffic.step(dt);
    this.peds.step(dt);
    if (this.scen.pendingJay) this.scen.trySpawnJay();
    // Pindaian sensor tepat tiap 6 langkah (0,1 detik waktu simulasi, 10 kali per detik).
    if (this.stepN++ % 6 === 0) {
      this.buildObjects();
      this.sensing.scan();
      this.perception.update(this.simTime);
    }
    this.perception.predict(this.simTime);
    this.planner.step(dt);
    const cmd = this.control.step();
    e.integrate(dt, cmd.steer, cmd.acc, cmd.reverse);
    this.planner.track();
    this.lateralError = this.planner.trackErr || 0;
    this.checkCollisions();
    this.tutorial.check();
    if (this.simTime >= (this.nextBalance || 0)) {
      this.nextBalance = this.simTime + 0.4;
      this.updateClosures();
      this.traffic.balance();
      this.peds.balance();
    }
  }

  /** Ruas yang kedua lajurnya tertutup rintangan dianggap ditutup (kendaraan mencari jalan lain). */
  updateClosures() {
    const by = new Map();
    for (const o of this.scen.obstacles) {
      const seg = o.lane.seg;
      let e = by.get(seg.id);
      if (!e) by.set(seg.id, (e = [false, false]));
      e[o.lane.k] = true;
    }
    const closed = new Set();
    for (const [id, e] of by) if (e[0] && e[1]) closed.add(id);
    const changed = closed.size !== this.closedSegs.size || [...closed].some((id) => !this.closedSegs.has(id));
    this.closedSegs = closed;
    if (changed) this.planner.onClosures();
  }

  /** Okupansi kotak persimpangan, jumlah kendaraan menuju tiap lajur keluar, dan antrean di lampu. */
  countBoxes() {
    for (const k in this.boxOcc) this.boxOcc[k].fill(0);
    this.connTarget.fill(0);
    for (const c of this.signals.list) {
      c.demand.fill(0);
      c.queueLen.fill(0);
    }
    let waiting = 0;
    const stopped = this.stoppedBuf || (this.stoppedBuf = new Map());
    for (const arr of stopped.values()) arr.length = 0;
    const visit = (lane, s, len, v) => {
      if (lane.type === 'conn') {
        this.boxOcc[lane.node.id][lane.approach]++;
        this.connTarget[lane.toLane.id]++;
        return;
      }
      if (!lane.node.signalized) return;
      const ctl = this.signals.byNode.get(lane.node.id);
      const dStop = lane.len - (s + len / 2);
      if (dStop < 45) ctl.demand[lane.dir]++;
      if (v < 1.5 && dStop < 100) {
        const key = lane.node.id * 4 + lane.dir;
        let arr = stopped.get(key);
        if (!arr) stopped.set(key, (arr = []));
        arr.push(dStop, dStop + len);
      }
    };
    for (const car of this.traffic.cars) visit(car.lane, car.s, car.len, car.v);
    const el0 = this.planner.egoLanes()[0];
    if (el0) visit(el0.lane, el0.s, this.ego.len, this.ego.v);
    // Antrean = rangkaian kendaraan berhenti yang bersambung dari garis henti ke belakang.
    for (const [key, arr] of stopped) {
      if (!arr.length) continue;
      const pairs = [];
      for (let i = 0; i < arr.length; i += 2) pairs.push([arr[i], arr[i + 1]]);
      pairs.sort((a, b) => a[0] - b[0]);
      let end = 8;
      let len = 0;
      for (const [front, back] of pairs) {
        if (front > end) break;
        len = Math.max(len, back);
        end = back + 9;
        waiting++;
      }
      const ctl = this.signals.byNode.get(Math.floor(key / 4));
      ctl.queueLen[key % 4] = len;
    }
    this.waitingNow = waiting;
  }

  buildObjects() {
    const out = [];
    for (const c of this.traffic.cars) {
      out.push({ id: `car:${c.id}`, cls: 'mobil', kind: 'obb', x: c.x, z: c.z, h: c.h, hl: CAR_LEN / 2, hw: CAR_WID / 2, height: 1.5, vx: c.vx, vz: c.vz, ref: c });
    }
    for (const p of this.peds.peds) {
      out.push({ id: `ped:${p.id}`, cls: 'pejalan', kind: 'circle', x: p.x, z: p.z, h: p.h, hl: 0.3, hw: 0.3, r: 0.3, height: 1.7, vx: p.vx, vz: p.vz, onRoad: p.onRoad, ref: p });
    }
    for (const o of this.scen.obstacles) out.push(o);
    this.objects = out;
  }

  checkCollisions() {
    const e = this.ego;
    const fp = e.footprint();
    const now = new Set();
    const near = (x, z, r) => {
      const dx = x - e.x;
      const dz = z - e.z;
      return dx * dx + dz * dz < (r + 3.5) * (r + 3.5);
    };
    for (const c of this.traffic.cars) {
      if (!near(c.x, c.z, 2.3)) continue;
      if (obbOverlap(fp, { x: c.x, z: c.z, h: c.h, hl: CAR_LEN / 2, hw: CAR_WID / 2 })) now.add(`car:${c.id}`);
    }
    for (const o of this.scen.obstacles) {
      if (!near(o.x, o.z, o.hl + 0.5)) continue;
      const hit = o.kind === 'circle' ? obbCircle(fp, o.x, o.z, o.r) : obbOverlap(fp, o);
      if (hit) now.add(o.id);
    }
    for (const p of this.peds.peds) {
      if (!near(p.x, p.z, 0.3)) continue;
      if (obbCircle(fp, p.x, p.z, 0.28)) now.add(`ped:${p.id}`);
    }
    for (const b of this.world.buildings) {
      if (e.x < b.minx - 4 || e.x > b.maxx + 4 || e.z < b.minz - 4 || e.z > b.maxz + 4) continue;
      if (obbAabb(fp, b.minx, b.minz, b.maxx, b.maxz)) now.add(`bld:${b.minx}:${b.minz}`);
    }
    for (const t of this.world.trees) {
      if (!near(t.x, t.z, t.r)) continue;
      if (obbCircle(fp, t.x, t.z, t.r * 0.6)) now.add(`tree:${t.x}:${t.z}`);
    }
    for (const p of this.world.poles) {
      if (!near(p.x, p.z, p.r)) continue;
      if (obbCircle(fp, p.x, p.z, p.r)) now.add(`pole:${p.x}:${p.z}`);
    }
    for (const id of now) {
      if (!this.contacts.has(id)) {
        this.counters.collisions++;
        this.logDebug({ t: Math.round(this.simTime * 10) / 10, type: 'tabrakan', id, v: Math.round(kmh(e.v)), beh: this.planner.behavior, auto: this.autopilot, x: Math.round(e.x), z: Math.round(e.z) });
        e.v = 0;
        e.a = 0;
        const what = id.startsWith('ped') ? 'pejalan kaki' : id.startsWith('car') ? 'mobil lain' : id.startsWith('obs') ? 'rintangan' : 'benda di pinggir jalan';
        this.toast(`Tabrakan dengan ${what}.`, 'danger');
      }
    }
    this.contacts = now;
  }

  // ===== tampilan =====

  render(dt) {
    const simDt = this.paused ? 0 : dt * this.timeScale;
    this.traffic.sync();
    this.peds.sync();
    this.ego.sync(simDt);
    this.scen.sync(dt);
    this.signals.sync();
    this.sensing.sync();
    this.planner.sync();
    this.cameras.update(dt);
    this.weather.fitFog(this.camera.position, this.ego.x, this.ego.z);
    this.weather.update(simDt, this.camera.position);
    this.weather.follow(this.ego.x, this.ego.z);
    this.weather.sky.position.copy(this.camera.position);
    this.perception.sync(this.camera, this.hud.labels, this.width, this.height);
    this.renderer.render(this.scene, this.camera);
    this.hudT = (this.hudT || 0) + dt;
    if (this.hudT > 0.12 || !this.hudOnce) {
      this.hudT = 0;
      this.hudOnce = true;
      this.hud.update();
    }
  }

  resize() {
    if (!this.renderer) return;
    const st = this.hud.stage;
    const w = Math.max(1, st.clientWidth);
    const h = Math.max(1, st.clientHeight);
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  applyQuality() {
    const q = QUALITY[this.quality] || QUALITY.standar;
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(Math.min(dpr, q.ratio));
    this.lite = q.lite;
    this.camera.far = q.far;
    this.camera.updateProjectionMatrix();
    if (this.weather) this.weather.setLite(q.lite);
    if (this.sensing) this.sensing.setPixelRatio(this.renderer.getPixelRatio());
    if (this.renderer.shadowMap.enabled !== q.shadows) {
      this.renderer.shadowMap.enabled = q.shadows;
      this.scene.traverse((o) => {
        const m = o.material;
        if (m) (Array.isArray(m) ? m : [m]).forEach((mm) => (mm.needsUpdate = true));
      });
    }
    this.resize();
  }

  bindPointer() {
    const cv = this.renderer.domElement;
    let down = null;
    this.disposer.on(cv, 'pointerdown', (ev) => {
      down = { x: ev.clientX, y: ev.clientY, t: performance.now() };
    });
    this.disposer.on(cv, 'pointerup', (ev) => {
      if (!down) return;
      const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
      const quick = performance.now() - down.t < 450;
      down = null;
      if (moved > 6 || !quick || !this.scen.clickArmed || this.mode !== 'bebas') return;
      const rect = cv.getBoundingClientRect();
      const ndc = new THREE.Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, this.camera);
      const hit = new THREE.Vector3();
      if (ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit)) this.scen.placeAt(hit.x, hit.z);
    });
  }

  // ===== aksi (dipakai tombol dan papan ketik) =====

  toast(text, kind) {
    if (this.hud) this.hud.toast(text, kind);
  }

  setMode(mode) {
    if (mode !== 'tutorial' && mode !== 'bebas') return;
    if (mode === this.mode) return;
    this.mode = mode;
    this.hud.setMode(mode);
    try {
      history.replaceState(history.state, '', `#/simulator/${mode}`);
    } catch (e) {
      /* abaikan */
    }
    // Mode menaruh dengan klik hanya ada di Mode Bebas, jadi selalu dimatikan saat pindah mode.
    this.armClick(false);
    if (mode === 'tutorial') {
      // Tugas tutorial (misalnya menyalip) butuh autopilot, jadi nyalakan lagi bila tadi dimatikan.
      if (!this.autopilot) this.toggleAutopilot();
      this.tutorial.go(this.tutorial.i);
    } else {
      this.hud.highlight([]);
      this.toast(this.hud.mobile ? 'Mode Bebas: semua alat tersedia. Coba taruh rintangan dengan mengetuk jalan.' : 'Mode Bebas: semua alat tersedia. Coba taruh rintangan dengan klik di jalan.');
    }
    this.resize();
  }

  setCamera(mode, opts = {}) {
    this.cameras.set(mode, opts);
    if (!opts.fromTutorial && this.tutorial) this.tutorial.event('camera', mode);
  }

  cycleCamera() {
    const i = CAMERA_MODES.indexOf(this.cameras.mode);
    this.setCamera(CAMERA_MODES[(i + 1) % CAMERA_MODES.length]);
  }

  togglePause() {
    this.paused = !this.paused;
    this.acc = 0;
  }

  changeSpeed(dir) {
    let i = SPEED_STEPS.indexOf(this.timeScale);
    if (i < 0) i = 2;
    i = clamp(i + dir, 0, SPEED_STEPS.length - 1);
    this.timeScale = SPEED_STEPS[i];
  }

  toggleHelp(force) {
    const open = force === undefined ? this.help.hidden : force;
    this.hud.showHelp(open);
  }

  setWeather(name) {
    if (name === this.weather.name) return;
    this.weather.set(name);
    this.tutorial.event('weather', name);
    const cap = this.weather.capReason();
    if (cap) this.toast(cap);
  }

  setQuality(q) {
    if (!QUALITY[q]) return;
    this.quality = q;
    this.applyQuality();
  }

  setLayer(name, on) {
    if (name === 'lidar') this.sensing.showLidar = on;
    if (name === 'boxes') this.perception.showBoxes = on;
    if (name === 'fov') this.sensing.showFov = on;
    if (name === 'path') this.planner.showPath = on;
    if (name === 'queues') this.signals.showQueues = on;
  }

  toggleLidar() {
    this.sensing.showLidar = !this.sensing.showLidar;
    this.tutorial.event('lidar', this.sensing.showLidar);
  }

  toggleBoxes() {
    this.perception.showBoxes = !this.perception.showBoxes;
  }

  toggleFov() {
    this.sensing.showFov = !this.sensing.showFov;
  }

  togglePath() {
    this.planner.showPath = !this.planner.showPath;
  }

  toggleQueues() {
    this.signals.showQueues = !this.signals.showQueues;
  }

  setTargetSpeed(kmhValue) {
    const v = clamp(Math.round(kmhValue / 5) * 5, 10, 70);
    if (Math.round(kmh(this.targetSpeed)) === v) return;
    this.targetSpeed = ms(v);
    this.tutorial.event('speed', v);
  }

  toggleAutopilot() {
    this.autopilot = !this.autopilot;
    for (const k of Object.keys(this.control.keys)) this.control.keys[k] = false;
    if (this.autopilot) {
      // kembali ke jalan: cari lajur terdekat dan hitung ulang rute
      const ok = this.planner.relocate();
      if (!ok || this.planner.deviation > 6) {
        this.toast('Mobil terlalu jauh dari jalan. Kemudikan kembali ke lajur dulu.', 'warn');
        this.autopilot = false;
        return;
      }
      this.toast('Autopilot menyala. Mobil mengemudi sendiri lagi.');
    } else this.toast(this.hud.mobile ? 'Autopilot mati. Kemudikan dengan tombol Kiri, Gas, Rem, dan Kanan di layar.' : 'Autopilot mati. Kemudikan dengan panah atau W, A, S, D.');
  }

  emergencyBrake() {
    this.planner.manualBrakeT = 2.5;
    this.counters.aebManual++;
    this.toast('Rem darurat ditekan.', 'danger');
  }

  placeObstacle(type) {
    this.scen.placeAhead(type || this.scen.selected);
  }

  armClick(force) {
    if (this.mode !== 'bebas') {
      this.scen.clickArmed = false;
      this.renderer.domElement.classList.remove('is-armed');
      if (force !== false) this.toast('Menaruh dengan klik tersedia di Mode Bebas.');
      return;
    }
    this.scen.clickArmed = force === undefined ? !this.scen.clickArmed : force;
    this.renderer.domElement.classList.toggle('is-armed', this.scen.clickArmed);
  }

  clearObstacles() {
    const n = this.scen.obstacles.length;
    this.scen.clear();
    this.toast(n ? 'Semua rintangan dihapus.' : 'Tidak ada rintangan untuk dihapus.');
  }

  jaywalker() {
    this.scen.jaywalker();
  }

  setSignalMode(mode) {
    if (mode === this.signals.mode) return;
    this.signals.setMode(mode);
    this.tutorial.event('signal', mode);
    this.toast(mode === 'adaptif' ? 'Lampu adaptif: hijau hanya untuk arah yang ada antreannya.' : 'Lampu waktu tetap: setiap arah mendapat giliran yang sama.');
  }

  setTrafficDensity(n) {
    this.traffic.target = clamp(Math.round(n), 0, this.traffic.max);
  }

  setPedDensity(n) {
    this.peds.target = clamp(Math.round(n), 0, this.peds.max);
  }

  // ===== pengait uji =====

  snapshot() {
    const e = this.ego;
    const pl = this.planner;
    const per = this.perception;
    return Object.freeze({
      ready: !!this.ready,
      mode: this.mode,
      paused: this.paused,
      timeScale: this.timeScale,
      simTime: this.simTime,
      camera: this.cameras ? this.cameras.mode : null,
      weather: this.weather ? this.weather.name : null,
      quality: this.quality,
      signalMode: this.signals ? this.signals.mode : null,
      helpOpen: this.help ? !this.help.hidden : false,
      layers: { lidar: this.sensing.showLidar, boxes: per.showBoxes, fov: this.sensing.showFov, path: pl.showPath, queues: this.signals.showQueues },
      ego: {
        x: e.x,
        z: e.z,
        heading: e.h,
        speedKmh: kmh(e.v),
        targetKmh: kmh(this.targetSpeed),
        lane: pl.kNow === 0 ? 'kiri' : 'kanan',
        autopilot: this.autopilot,
        behavior: pl.behavior,
        reason: pl.reason,
        limiter: pl.limiter,
        ttc: Number.isFinite(pl.ttc) ? pl.ttc : null,
        deviation: this.lateralError,
        aeb: pl.aeb,
        routeItems: pl.route ? pl.route.items.length : 0,
        destLeft: pl.destLeft,
        replans: pl.replans || 0,
        plan: pl.route
          ? {
              ri: pl.route.ri,
              s: Math.round(pl.route.s * 10) / 10,
              lat: Math.round(pl.route.lat * 100) / 100,
              active: pl.active ? `${pl.active.kind}:${Math.round(pl.active.start)}+${Math.round(pl.active.len)}` : null,
              held: pl.held ? `${pl.held.kind}:${pl.held.why}` : null,
              backup: !!pl.backup,
              overtake: pl.overtake ? `${pl.overtake.uid}:${Math.round(pl.overtake.sEnd)}:${Math.round(pl.overtake.sOut)}` : null,
              events: pl.evs.map((e) => `${e.kind}:${Number.isFinite(e.start) ? Math.round(e.start) : 'tahan'}`).join(','),
            }
          : null,
      },
      counters: { ...this.counters, emergencyBrakes: this.counters.aebAuto + this.counters.aebManual },
      perception: { count: per.list.length, byClass: per.counts(), pedSeen: per.pedSeen, nextLight: per.light ? { ...per.light } : null },
      sensing: { lidarRange: this.sensing.ranges().lidar, cameraRange: this.sensing.ranges().kamera, points: this.sensing.pointCount, scans: this.sensing.scanCount },
      traffic: {
        cars: this.traffic.cars.length,
        peds: this.peds.peds.length,
        obstacles: this.scen.obstacles.length,
        npcOverlaps: this.traffic.countOverlaps(),
        respawns: this.traffic.respawns,
        waiting: this.waitingNow,
        avgWait: { adaptif: this.signals.avgWait('adaptif'), tetap: this.signals.avgWait('tetap') },
        clickArmed: this.scen.clickArmed,
        queues: this.signals.list.reduce((m, c) => Math.max(m, ...c.queueLen), 0),
        queueBars: this.signals.approaches.filter((ap) => ap.ctl.queueLen[ap.k] >= 1).length,
      },
      tutorial: this.tutorial ? this.tutorial.summary() : null,
      debug: this.debugLog.slice(-20),
      probe: this.probe(),
      screenOf: (x, z) => this.screenOf(x, z),
      render: { fps: this.fps, calls: this.renderer ? this.renderer.info.render.calls : 0, triangles: this.renderer ? this.renderer.info.render.triangles : 0, width: this.width, height: this.height, pixelRatio: this.renderer ? this.renderer.getPixelRatio() : 0 },
    });
  }

  /** Catatan kejadian penting untuk uji otomatis (dibatasi 40 terakhir). */
  logDebug(entry) {
    this.debugLog.push(entry);
    if (this.debugLog.length > 40) this.debugLog.shift();
  }

  /** Titik di jalur rencana sekitar 28 m di depan (untuk uji klik di jalan). */
  probe() {
    const pl = this.planner;
    const i = Math.min(pl.pathN - 1, Math.round(28 / 1.5));
    if (i < 0 || !pl.path[i]) return null;
    return { x: pl.path[i].x, z: pl.path[i].z };
  }

  /** Posisi layar (piksel, relatif halaman) untuk titik dunia di tanah. Tidak mengubah apa pun. */
  screenOf(x, z) {
    if (!this.camera || !this.renderer) return null;
    const v = new THREE.Vector3(x, 0, z).project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height, visible: v.z < 1 };
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
    this.graph = null;
  }
}

export async function mount(container, { mode = 'tutorial', navigate } = {}) {
  const app = new App(container, mode === 'bebas' ? 'bebas' : 'tutorial', navigate);
  try {
    await app.init();
  } catch (err) {
    // Jika gagal di tengah jalan, bersihkan dan tampilkan pesan ramah.
    console.warn('Simulator 3D gagal dimuat:', err);
    const nav = app.navigate;
    app.destroy();
    const again = new App(container, app.mode, nav);
    again.fail();
    return { destroy: () => again.destroy() };
  }
  return { destroy: () => app.destroy() };
}
