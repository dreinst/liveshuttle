// Panel di atas kanvas 3D. Desktop: bar atas, Panduan di kiri, peta rute di kiri bawah, Perisai
// dan Kendali di kanan, Lapisan otonomi di bawah, kontrol waktu kecil di pojok. Ponsel: panel pindah
// ke lembar bawah bertab (ketuk tab yang aktif untuk mengecilkannya) dengan tombol besar.
import * as THREE from '../vendor/three.bundle.min.js';
import { el } from './util.js';
import { CAMERA_MODES, CAMERA_LABEL } from './cameras.js';
import { WEATHER_LABEL, WEATHER_ORDER } from './weather.js';
import { OBSTACLE_LABEL } from './obstacles.js';
import { RouteMap } from './routemap.js';

const SPEEDS = [1, 2, 4];
const NUM_WORD = ['nol', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam'];
const DENSITY = [
  ['Sepi', 20],
  ['Sedang', 42],
  ['Ramai', 64],
];
const LAYERS = [
  ['indra', 'Indra', 'sensor'],
  ['pahami', 'Pahami', 'persepsi'],
  ['rencana', 'Rencana', 'perencanaan'],
  ['gerak', 'Gerak', 'kendali'],
];
const TOOL_HINT = {
  parkir: 'Klik lajur di tampilan 3D atau di peta rute untuk menaruh kendaraan parkir.',
  galian: 'Klik lajur di tampilan 3D atau di peta rute untuk memasang galian jalan.',
  tutup: 'Klik ruas jalan di tampilan 3D atau di peta rute untuk menutupnya. Klik lagi untuk membukanya.',
};
const WHY = {
  'bukan-jalan': 'Klik tepat di jalan.',
  'bukan-lajur': 'Klik tepat di lajur jalan.',
  'ada-halte': 'Jalan ini punya halte, jadi tidak bisa ditutup.',
  bundaran: 'Penghalang tidak bisa dipasang di bundaran.',
  'tepi-peta': 'Terlalu dekat dengan tepi peta.',
  'satu-lajur': 'Jalan ini hanya punya satu lajur searah, kendaraan lain tidak bisa lewat.',
  'dekat-simpang': 'Terlalu dekat dengan persimpangan.',
  penuh: 'Sudah ada 6 penghalang. Angkat dulu salah satunya.',
  'dekat-zebra': 'Terlalu dekat dengan zebra cross.',
  'dekat-halte': 'Terlalu dekat dengan halte.',
  'dekat-penghalang': 'Terlalu dekat dengan penghalang lain.',
  'ada-kendaraan': 'Ada kendaraan di tempat itu.',
  'terlalu-dekat': 'Ada kendaraan yang terlalu dekat untuk berhenti dengan nyaman.',
  'ada-pejalan': 'Ada pejalan kaki di tempat itu.',
  manual: 'Serahkan dulu kemudi ke autopilot.',
  'di-halte': 'Shuttle sedang berhenti di halte. Tunggu ia berangkat, atau klik jalan di tampilan 3D.',
  'tidak-ada-tempat': 'Belum ada tempat yang aman di depan shuttle. Coba lagi sebentar.',
};

function signalNote(signals) {
  const names = [];
  for (const sg of signals) for (const a of sg.arms) if (a.name && !names.includes(a.name)) names.push(a.name);
  const n = signals.length;
  const where = names.length ? ` di ${names.length > 1 ? `${names.slice(0, -1).join(', ')} dan ${names[names.length - 1]}` : names[0]}` : '';
  return `Lampu lalu lintas. Data OSM di area ini tidak punya lampu, jadi lampu di ${NUM_WORD[n] || n} persimpangan${where} adalah lampu simulasi, dengan waktu tetap dan fase khusus untuk pejalan kaki.`;
}

function mmss(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function set(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

const WEATHER_ICON = {
  cerah: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5" fill="currentColor"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.2 5.2l1.8 1.8M17 17l1.8 1.8M5.2 18.8 7 17M17 7l1.8-1.8"/></g></svg>',
  hujan: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 15a4.5 4.5 0 1 1 1.3-8.8A5.5 5.5 0 0 1 18.5 9 3.5 3.5 0 0 1 17.5 15z" fill="currentColor"/><g stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 18l-1 2.5M12 18l-1 2.5M16 18l-1 2.5"/></g></svg>',
  kabut: '<svg viewBox="0 0 24 24" aria-hidden="true"><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 8h13M6 12h14M3 16h12M8 20h10"/></g></svg>',
  malam: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 3.5a8.5 8.5 0 1 0 5 13.9A7 7 0 0 1 15.5 3.5z" fill="currentColor"/></svg>',
};

export class Hud {
  constructor(app) {
    this.app = app;
    this.d = app.disposer;
    this.logShown = '';
    this.sheetTab = 'peta';
    this.tool = null;
    this.build();
  }

  on(t, type, fn, opts) {
    this.d.on(t, type, fn, opts);
  }

  button(content, cls, onClick, attrs = {}) {
    const b = el('button', { type: 'button', class: `s3d-btn ${cls || ''}`.trim(), ...attrs }, content);
    if (onClick) this.on(b, 'click', onClick);
    return b;
  }

  /** Kelompok tombol pilihan (aria-pressed). Mengembalikan [wadah, Map nilai ke tombol]. */
  seg(label, items, onPick, cls = 's3d-speed') {
    const box = el('div', { class: 's3d-seg', role: 'group', 'aria-label': label });
    const map = new Map();
    for (const [v, t, attrs] of items) {
      const b = el('button', { type: 'button', class: cls, 'aria-pressed': 'false', ...attrs }, t);
      this.on(b, 'click', () => onPick(v));
      box.append(b);
      map.set(v, b);
    }
    return [box, map];
  }

  build() {
    const app = this.app;
    const root = el('div', { class: 's3d', dataset: { mode: app.mode, layout: 'desktop', sheet: 'besar', mapBig: 'false' } });
    this.root = root;
    this.stage = el('div', { class: 's3d-stage' });
    root.append(this.stage);

    // ===== bar atas =====
    const [modes, modeBtns] = this.seg('Mode', [['panduan', 'Panduan'], ['jelajah', 'Jelajah']], (m) => app.setMode(m), 's3d-mode');
    modes.className = 's3d-modes';
    this.modeBtns = modeBtns;
    const [cams, camBtns] = this.seg(
      'Kamera',
      CAMERA_MODES.map((m, i) => [m, [el('span', { class: 's3d-key', 'aria-hidden': 'true' }, String(i + 1)), CAMERA_LABEL[m]], { 'aria-keyshortcuts': String(i + 1), title: `Kamera ${CAMERA_LABEL[m]} (tombol ${i + 1})` }]),
      (m) => app.setCamera(m),
      's3d-cam',
    );
    cams.className = 's3d-cams';
    this.camBtns = camBtns;
    this.wxIcon = el('span', { class: 's3d-wx-icon' });
    this.wxName = el('span', { class: 's3d-wx-name' });
    this.wxNext = el('span', { class: 's3d-wx-next' });
    this.weather = el(
      'div',
      { class: 's3d-weather', title: 'Cuaca berganti sendiri tiap 5 menit waktu simulasi. Saat dijeda hitungan berhenti, saat dipercepat pergantian datang lebih cepat.' },
      this.wxIcon,
      el('span', { class: 's3d-wx-text' }, this.wxName, this.wxNext),
    );
    this.aboutBtn = this.button([el('span', { class: 's3d-long' }, 'Tentang peta'), el('span', { class: 's3d-short', 'aria-hidden': 'true' }, 'i')], 's3d-ghost s3d-about-btn', () => this.showAbout(true), { 'aria-label': 'Tentang peta' });
    this.helpBtn = this.button('?', 's3d-icon s3d-help-btn', () => app.toggleHelp(), { 'aria-label': 'Bantuan pintasan papan ketik', 'aria-keyshortcuts': '?', title: 'Bantuan (tombol ?)' });
    this.top = el(
      'header',
      { class: 's3d-top' },
      el('div', { class: 's3d-brand' }, el('span', { class: 's3d-logo', 'aria-hidden': 'true' }), el('span', {}, 'Shuttle 3D Ma Chung')),
      modes,
      cams,
      el('div', { class: 's3d-top-right' }, this.weather, this.aboutBtn, this.helpBtn),
    );
    root.append(this.top);

    // ===== Lapisan otonomi =====
    this.layerText = {};
    this.layers = el('section', { class: 's3d-layers', 'aria-label': 'Lapisan otonomi', dataset: { tab: 'otonomi' } });
    LAYERS.forEach(([k, t, sub], i) => {
      this.layerText[k] = el('p', {});
      this.layers.append(el('div', { class: 's3d-layer', dataset: { k } }, el('h3', {}, el('span', { class: 's3d-layer-n' }, String(i + 1)), t, el('small', {}, ` ${sub}`)), this.layerText[k]));
    });
    root.append(this.layers);

    // ===== Perisai keselamatan =====
    this.redOut = el('span', { class: 's3d-inv-val' }, '0');
    this.pedOut = el('span', { class: 's3d-inv-val' }, '0');
    this.intOut = el('strong', {}, '0');
    this.npcOut = el('span', {}, '0');
    this.logList = el('ol', { class: 's3d-log', 'aria-label': 'Intervensi terakhir' });
    this.logEmpty = el('p', { class: 's3d-muted s3d-small' }, 'Belum ada intervensi. Perisai diam selama rencana sudah aman.');
    this.pShield = el(
      'section',
      { class: 's3d-card s3d-shield', 'aria-labelledby': 's3d-shield-title', dataset: { tab: 'perisai' } },
      el('h2', { id: 's3d-shield-title' }, 'Perisai keselamatan'),
      el(
        'div',
        { class: 's3d-inv' },
        el('div', { class: 's3d-inv-cell' }, this.redOut, el('span', { class: 's3d-inv-label' }, 'Terobos lampu merah')),
        el('div', { class: 's3d-inv-cell' }, this.pedOut, el('span', { class: 's3d-inv-label' }, 'Kontak dengan pejalan kaki')),
      ),
      el('p', { class: 's3d-small' }, 'Intervensi pada shuttle: ', this.intOut, el('span', { class: 's3d-muted' }, ', pada mobil, motor, dan angkot: ', this.npcOut)),
      this.logList,
      this.logEmpty,
    );

    // ===== Kendali dan alat =====
    this.manualBtn = this.button('Ambil kemudi', 's3d-primary', () => app.toggleManual(), { 'aria-keyshortcuts': 'M', 'aria-pressed': 'false', title: 'Ambil kemudi atau serahkan ke autopilot (tombol M)' });
    const xingBtn = this.button('Pejalan kaki menyeberang', '', () => app.ego.requestCrossing(), { 'aria-keyshortcuts': 'Y', title: 'Pejalan kaki menyeberang di depan shuttle (tombol Y)' });
    this.raysBtn = this.button('Sinar LiDAR', '', () => app.sensors.setRays(!app.sensors.rays), { 'aria-keyshortcuts': 'L', 'aria-pressed': 'false', title: 'Tampilkan sinar LiDAR (tombol L)' });
    const [views, viewBtns] = this.seg('Tampilan sensor', [['tenang', 'Tenang'], ['detail', 'Detail']], (v) => app.sensors.setView(v));
    this.viewBtns = viewBtns;
    const [dens, densBtns] = this.seg('Kepadatan lalu lintas', DENSITY.map(([t, n]) => [n, t]), (n) => (app.traffic.target = n));
    this.densBtns = densBtns;
    this.limitOut = el('output', { for: 's3d-limit' });
    const limit = el('input', { type: 'range', id: 's3d-limit', min: '10', max: '40', step: '5', value: String(app.ego.speedLimitKmh) });
    this.on(limit, 'input', () => app.ego.setSpeedLimit(Number(limit.value)));
    const [tools, toolBtns] = this.seg('Alat jalan', [['parkir', OBSTACLE_LABEL.parkir], ['galian', OBSTACLE_LABEL.galian], ['tutup', 'Tutup jalan']], (t) => this.setTool(this.tool === t ? null : t), 's3d-btn');
    tools.className = 's3d-ctl-row';
    this.toolBtns = toolBtns;
    this.aheadBtn = this.button('Taruh di depan shuttle', 's3d-ghost', () => this.placeAhead());
    this.toolHint = el('p', { class: 's3d-small s3d-hint' });
    this.toolBox = el('div', { class: 's3d-toolbox', hidden: true }, this.toolHint, this.aheadBtn);
    const clearBtn = this.button('Angkat semua penghalang', 's3d-ghost', () => app.obstacles.clear());
    this.halteSel = el('select', { id: 's3d-halte', 'aria-label': 'Halte' }, app.city.halte.map((h, i) => el('option', { value: String(i) }, h.name)));
    const callBtn = this.button('Panggil penumpang', '', () => {
      const i = Number(this.halteSel.value);
      const k = app.ego.pax.call(i, 3);
      app.toast(k ? `${k} penumpang menunggu di Halte ${app.city.halte[i].name}.` : `Antrean di Halte ${app.city.halte[i].name} sudah penuh.`);
    });
    this.pCtl = el(
      'section',
      { class: 's3d-card s3d-ctl', 'aria-labelledby': 's3d-ctl-title', dataset: { tab: 'kendali' } },
      el('h2', { id: 's3d-ctl-title' }, 'Kendali dan alat'),
      el('div', { class: 's3d-ctl-row' }, this.manualBtn, xingBtn),
      el('div', { class: 's3d-ctl-row' }, el('span', { class: 's3d-small' }, 'Tampilan sensor'), views, this.raysBtn),
      el('label', { class: 's3d-small s3d-limit', for: 's3d-limit' }, 'Batas kecepatan (pengaturan simulator): ', this.limitOut),
      limit,
      el('div', { class: 's3d-ctl-row' }, el('span', { class: 's3d-small' }, 'Kepadatan lalu lintas'), dens),
      el('h3', {}, 'Alat jalan'),
      tools,
      this.toolBox,
      el('div', { class: 's3d-ctl-row' }, clearBtn),
      el('div', { class: 's3d-ctl-row' }, this.halteSel, callBtn),
    );
    this.side = el('aside', { class: 's3d-side', 'aria-label': 'Panel simulator' }, this.pShield, this.pCtl);
    root.append(this.side);

    this.map = new RouteMap(app);

    // ===== tombol kemudi di layar (mode manual) =====
    this.pad = el('div', { class: 's3d-pad', role: 'group', 'aria-label': 'Kemudi manual', hidden: true });
    for (const [k, t, lab] of [
      ['up', '▲', 'Gas (panah atas atau W)'],
      ['left', '◀', 'Belok kiri (panah kiri atau A)'],
      ['down', '▼', 'Rem dan mundur (panah bawah atau S)'],
      ['right', '▶', 'Belok kanan (panah kanan atau D)'],
    ]) {
      const b = el('button', { type: 'button', class: 's3d-btn s3d-pad-btn', dataset: { k }, 'aria-label': lab, title: lab }, t);
      const hold = (v) => (ev) => {
        ev.preventDefault();
        app.ego.input[k] = v;
      };
      this.on(b, 'pointerdown', hold(1));
      for (const type of ['pointerup', 'pointerleave', 'pointercancel']) this.on(b, type, hold(0));
      this.pad.append(b);
    }
    root.append(this.pad);
    this.shieldBadge = el('div', { class: 's3d-shield-badge', hidden: true, 'aria-hidden': 'true' }, 'Perisai keselamatan mengerem');
    root.append(this.shieldBadge);

    // ===== kartu Panduan =====
    this.guideStep = el('span', { class: 's3d-guide-step' });
    this.guideTitle = el('h2', { class: 's3d-guide-title', tabindex: '-1' });
    this.guideBody = el('div', { class: 's3d-guide-body' });
    this.guideLive = el('p', { class: 's3d-live s3d-small' });
    this.guideTask = el('p', { class: 's3d-task-text' });
    this.guideTaskBox = el('div', { class: 's3d-task', dataset: { done: 'false' } }, el('span', { class: 's3d-task-label' }, 'Tugas'), this.guideTask);
    this.guidePrev = this.button('Sebelumnya', 's3d-ghost', () => app.guide.prev());
    this.guideNext = this.button('Lanjut', 's3d-primary', () => app.guide.next());
    this.guide = el('section', { class: 's3d-card s3d-guide', 'aria-label': 'Panduan', dataset: { tab: 'panduan' } }, this.guideStep, this.guideTitle, this.guideBody, this.guideLive, this.guideTaskBox, el('div', { class: 's3d-guide-nav' }, this.guidePrev, this.guideNext));
    this.left = el('div', { class: 's3d-left' }, this.guide, this.map.root);
    root.append(this.left);

    // ===== kontrol waktu kecil di pojok =====
    this.pauseBtn = this.button('', 's3d-icon s3d-pause', () => app.togglePause(), { 'aria-label': 'Jeda', 'aria-keyshortcuts': 'Space', title: 'Jeda atau lanjutkan (Spasi)', 'aria-pressed': 'false' });
    const [speeds, speedBtns] = this.seg('Kecepatan waktu', SPEEDS.map((s) => [s, `${s}x`]), (s) => app.setTimeScale(s));
    speeds.className = 's3d-speeds';
    this.speedBtns = speedBtns;
    this.corner = el('div', { class: 's3d-corner' }, this.pauseBtn, speeds);
    root.append(this.corner);

    root.append(el('div', { class: 's3d-attrib' }, el('a', { href: 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener' }, '© Kontributor OpenStreetMap')));
    this.toastBox = el('div', { class: 's3d-toasts', role: 'status', 'aria-live': 'polite' });
    this.paused = el('div', { class: 's3d-paused', hidden: true }, 'Dijeda');
    this.status = el('p', { class: 's3d-sr', role: 'status', 'aria-live': 'polite' });
    root.append(this.toastBox, this.paused, this.status);

    // ===== lembar bawah (ponsel) =====
    const [tabs, sheetTabs] = this.seg('Panel', [['panduan', 'Panduan'], ['peta', 'Peta'], ['otonomi', 'Otonomi'], ['perisai', 'Perisai'], ['kendali', 'Kendali']], (id) => this.setSheetTab(id, true), 's3d-sheet-tab');
    tabs.className = 's3d-sheet-tabs';
    this.sheetTabs = sheetTabs;
    this.sheetBody = el('div', { class: 's3d-sheet-body' });
    this.sheet = el('div', { class: 's3d-sheet' }, tabs, this.sheetBody);
    root.append(this.sheet);
    this.panels = [this.guide, this.map.root, this.layers, this.pShield, this.pCtl];

    // ===== dialog bantuan =====
    const keys = [
      [['1', '2', '3', '4'], 'Kamera Kabin, Drone, Sinematik, atau Peta'],
      [['Spasi'], 'Jeda atau lanjutkan simulasi'],
      [['M'], 'Ambil kemudi, atau serahkan lagi ke autopilot'],
      [['↑', '↓', '←', '→'], 'Mengemudi manual (juga W, S, A, D). Perisai keselamatan tetap aktif'],
      [['Y'], 'Pejalan kaki menyeberang di depan shuttle'],
      [['L'], 'Tampilkan atau sembunyikan sinar LiDAR'],
      [['?'], 'Buka atau tutup bantuan ini'],
      [['Esc'], 'Tutup jendela yang terbuka, atau lepas alat jalan'],
    ];
    const dl = el('dl', { class: 's3d-keys' });
    for (const [ks, t] of keys) dl.append(el('dt', {}, ks.map((k) => el('kbd', {}, k))), el('dd', {}, t));
    this.helpClose = this.button('Tutup', 's3d-primary', () => app.toggleHelp(false));
    this.help = this.dialog(
      's3d-help',
      'Pintasan papan ketik',
      el('p', { class: 's3d-muted s3d-small' }, 'Setiap pintasan juga punya tombol di layar. Pintasan tidak aktif saat kamu sedang mengetik.'),
      dl,
      el('p', { class: 's3d-small' }, 'Cuaca berganti sendiri tiap 5 menit waktu simulasi. Saat dijeda hitungan berhenti, saat dipercepat pergantian datang lebih cepat.'),
      this.helpClose,
    );
    this.on(this.help, 'click', (ev) => ev.target === this.help && app.toggleHelp(false));

    // ===== dialog tentang peta =====
    this.aboutClose = this.button('Tutup', 's3d-primary', () => this.showAbout(false));
    this.about = this.dialog(
      's3d-about',
      'Tentang peta',
      el('p', {}, 'Jalan, bundaran, gedung, dan taman di sini berasal dari OpenStreetMap, peta dunia yang dibuat bersama oleh para kontributornya. Datanya diambil pada 28 September 2026 untuk area sekitar Universitas Ma Chung, Malang, lalu dipotong kira-kira 1 km x 1 km.'),
      el('p', {}, 'Kendaraan otonom sungguhan memakai peta HD yang mencatat setiap lajur dengan ketelitian sentimeter. OpenStreetMap adalah peta komunitas yang tidak serinci itu, jadi beberapa hal di sini kami perkirakan:'),
      el(
        'ul',
        {},
        el('li', {}, 'Jumlah dan lebar lajur, dari kelas jalan dan jarak antarjalur di jalan satu arah.'),
        el('li', {}, 'Garis tengah lajur dan bentuk persimpangan, yang dihaluskan supaya kendaraan bisa berbelok mulus.'),
        el('li', {}, 'Tinggi gedung. Rumah dibuat 1 sampai 2 lantai, gedung kampus 3 sampai 5 lantai.'),
        el('li', {}, signalNote(app.city.data.signals)),
        el('li', {}, 'Trotoar, zebra cross, pohon peneduh, dan halte shuttle.'),
        el('li', {}, 'Beberapa ujung jalan yang di data berhenti beberapa meter sebelum jalan lain kami sambungkan.'),
      ),
      el('p', {}, 'Tanah dibuat datar, padahal aslinya daerah ini berbukit. Kendaraan berjalan di lajur kiri dan bundaran berputar searah jarum jam, sesuai data dan aturan lalu lintas di Indonesia.'),
      el('p', { class: 's3d-small' }, 'Sumber data: ', el('a', { href: 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener' }, '© Kontributor OpenStreetMap'), ', lisensi ODbL.'),
      this.aboutClose,
    );
    this.on(this.about, 'click', (ev) => ev.target === this.about && this.showAbout(false));

    // ===== klik jalan di tampilan 3D untuk alat jalan =====
    this.ray = new THREE.Raycaster();
    this.ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.hit = new THREE.Vector3();
    this.down = null;
    this.on(this.stage, 'pointerdown', (ev) => (this.down = { x: ev.clientX, y: ev.clientY }));
    this.on(this.stage, 'pointerup', (ev) => {
      const d = this.down;
      this.down = null;
      if (!this.tool || !d || Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > 6) return;
      const r = this.stage.getBoundingClientRect();
      this.ray.setFromCamera({ x: ((ev.clientX - r.left) / r.width) * 2 - 1, y: -((ev.clientY - r.top) / r.height) * 2 + 1 }, app.camera);
      if (this.ray.ray.intersectPlane(this.ground, this.hit)) this.applyTool(this.hit.x, this.hit.z);
    });
  }

  dialog(cls, title, ...children) {
    const id = `${cls}-title`;
    const d = el('div', { class: `s3d-dialog ${cls}`, hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': id }, el('div', { class: 's3d-dialog-card' }, el('h2', { id }, title), ...children));
    this.root.append(d);
    return d;
  }

  showAbout(open) {
    this.about.hidden = !open;
    (open ? this.aboutClose : this.aboutBtn).focus();
  }

  showHelp(open) {
    this.help.hidden = !open;
    if (open) this.helpClose.focus();
  }

  // ===== alat jalan =====

  setTool(t) {
    this.tool = t;
    for (const [k, b] of this.toolBtns) b.setAttribute('aria-pressed', String(k === t));
    this.toolBox.hidden = !t;
    this.aheadBtn.hidden = t === 'tutup';
    if (t) this.toolHint.textContent = TOOL_HINT[t];
    this.root.dataset.tool = t || '';
  }

  applyTool(x, z) {
    const app = this.app;
    const t = this.tool;
    if (t === 'tutup') {
      const id = app.obstacles.roadAt(x, z);
      const r = id === null ? { ok: false, reason: 'bukan-jalan' } : app.obstacles.toggleRoad(id);
      if (r.ok) app.toast(`${r.name || 'Ruas jalan'} ${r.closed ? 'ditutup' : 'dibuka lagi'}.`);
      else app.toast(WHY[r.reason] || r.reason, 'warn');
    } else if (t) this.placed(t, app.obstacles.placeNear(t, x, z));
  }

  placeAhead() {
    if (this.tool) this.placed(this.tool, this.app.obstacles.placeAhead(this.tool));
  }

  placed(t, r) {
    if (r.ok) this.app.toast(`${OBSTACLE_LABEL[t]} dipasang${r.ob.name ? ` di ${r.ob.name}` : ''}.`);
    else this.app.toast(WHY[r.reason] || r.reason, 'warn');
  }

  // ===== tata letak =====

  applyLayout(mobile) {
    this.mobile = mobile;
    this.root.dataset.layout = mobile ? 'mobile' : 'desktop';
    if (mobile) {
      this.sheetBody.append(...this.panels);
      this.setSheetTab(this.app.mode === 'panduan' ? 'panduan' : 'peta');
    } else {
      this.side.append(this.pShield, this.pCtl);
      this.left.append(this.guide, this.map.root);
      this.root.insertBefore(this.layers, this.corner);
      for (const p of this.panels) p.hidden = false;
      this.setMode(this.app.mode);
    }
  }

  setSheetTab(id, tapped) {
    // ketuk tab yang sedang aktif untuk mengecilkan atau membesarkan lembar
    if (tapped && id === this.sheetTab) this.root.dataset.sheet = this.root.dataset.sheet === 'kecil' ? 'besar' : 'kecil';
    else this.root.dataset.sheet = 'besar';
    this.sheetTab = id;
    for (const [k, b] of this.sheetTabs) b.setAttribute('aria-pressed', String(k === id));
    for (const p of this.panels) p.hidden = p.dataset.tab !== id;
  }

  setMode(mode) {
    this.root.dataset.mode = mode;
    for (const [m, b] of this.modeBtns) b.setAttribute('aria-pressed', String(m === mode));
    this.sheetTabs.get('panduan').hidden = mode !== 'panduan';
    if (!this.mobile) this.guide.hidden = mode !== 'panduan';
    else if (mode === 'panduan') this.setSheetTab('panduan');
    else if (this.sheetTab === 'panduan') this.setSheetTab('peta');
  }

  setCamera(mode) {
    for (const [m, b] of this.camBtns) b.setAttribute('aria-pressed', String(m === mode));
  }

  renderGuide(step, index, total, done) {
    this.guideStep.textContent = `Langkah ${index + 1} dari ${total}`;
    this.guideTitle.textContent = step.title;
    this.guideBody.innerHTML = step.body;
    this.guideTaskBox.hidden = !step.task;
    if (step.task) this.guideTask.textContent = step.task;
    this.guideTaskBox.dataset.done = String(!!done);
    this.guidePrev.disabled = index === 0;
    this.guideNext.textContent = index === total - 1 ? 'Ke Jelajah' : 'Lanjut';
    this.guideLive.hidden = !step.live;
    this.layers.dataset.focus = step.layer || '';
    this.step = step;
  }

  toast(text, kind = '') {
    const t = el('div', { class: `s3d-toast ${kind}`.trim() }, text);
    this.toastBox.append(t);
    const timer = setTimeout(() => t.remove(), 4200);
    this.app.timers.add(timer);
    while (this.toastBox.children.length > 3) this.toastBox.firstChild.remove();
  }

  /** Perbarui teks panel (beberapa kali per detik). */
  update() {
    const app = this.app;
    const w = app.weather;
    const ego = app.ego;
    if (this.wxShown !== w.name) {
      this.wxShown = w.name;
      this.wxIcon.innerHTML = WEATHER_ICON[w.name] || '';
      this.weather.dataset.wx = w.name;
      set(this.wxName, WEATHER_LABEL[w.name]);
    }
    const nextWx = WEATHER_LABEL[WEATHER_ORDER[(WEATHER_ORDER.indexOf(w.name) + 1) % 4]];
    // ponsel: teks pendek supaya tidak terpotong
    set(this.wxNext, this.root.dataset.layout === 'mobile' ? `${nextWx} ${mmss(w.countdown)}` : `${mmss(w.countdown)} lagi jadi ${nextWx}`);
    set(this.redOut, String(app.invariants.redLight));
    set(this.pedOut, String(app.invariants.pedContact));
    this.redOut.dataset.bad = String(app.invariants.redLight > 0);
    this.pedOut.dataset.bad = String(app.invariants.pedContact > 0);
    set(this.intOut, String(app.shieldStats.shuttle));
    set(this.npcOut, String(app.shieldStats.npc));
    const key = app.shieldLogList.length ? app.shieldLogList[app.shieldLogList.length - 1].id : 0;
    if (key !== this.logShown) {
      this.logShown = key;
      this.logList.textContent = '';
      for (const l of app.shieldLogList.slice(-3).reverse()) this.logList.append(el('li', {}, el('span', { class: 's3d-log-t' }, mmss(l.t)), l.text));
      this.logEmpty.hidden = app.shieldLogList.length > 0;
    }
    const L = app.sensors.layers();
    for (const k in this.layerText) set(this.layerText[k], L[k]);
    this.map.updateText();
    if (this.step && this.step.live) set(this.guideLive, this.step.live(app));
    app.guide.check();
    const manual = ego.mode === 'manual';
    set(this.manualBtn, manual ? 'Serahkan ke autopilot' : 'Ambil kemudi');
    this.manualBtn.setAttribute('aria-pressed', String(manual));
    this.pad.hidden = !manual;
    this.shieldBadge.hidden = !(ego.shieldT > 0);
    this.raysBtn.setAttribute('aria-pressed', String(app.sensors.rays));
    for (const [v, b] of this.viewBtns) b.setAttribute('aria-pressed', String(v === app.sensors.view));
    for (const [n, b] of this.densBtns) b.setAttribute('aria-pressed', String(n === app.traffic.target));
    set(this.limitOut, `${ego.speedLimitKmh} km/jam`);
    this.pauseBtn.setAttribute('aria-pressed', String(app.paused));
    this.pauseBtn.setAttribute('aria-label', app.paused ? 'Lanjutkan' : 'Jeda');
    this.pauseBtn.dataset.paused = String(app.paused);
    this.paused.hidden = !app.paused;
    for (const [sp, b] of this.speedBtns) b.setAttribute('aria-pressed', String(sp === app.timeScale));
    const statusText = `${ego.statusText()}. ${WEATHER_LABEL[w.name]}, cuaca berganti dalam ${Math.ceil(w.countdown / 60)} menit.`;
    if (statusText !== this.status.textContent && (!this.lastStatusT || app.simTime - this.lastStatusT > 8)) {
      this.status.textContent = statusText;
      this.lastStatusT = app.simTime;
    }
  }
}

