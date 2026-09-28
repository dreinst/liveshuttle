// Panel HUD di atas kanvas 3D. Di desktop panel berada di kolom kiri (tutorial) dan kanan.
// Di ponsel semua panel pindah ke lembar bawah (bottom sheet) dengan tab.
import { el, fmt, kmh } from './util.js';
import { CLASSES } from './perception.js';
import { CAMERA_MODES, CAMERA_LABEL } from './cameras.js';
import { WEATHER_LABEL } from './weather.js';
import { OBSTACLE_TYPES } from './scenarios.js';
import { TIMING } from './signals.js';

const TABS = [
  ['tutorial', 'Tutorial'],
  ['persepsi', 'Persepsi'],
  ['rencana', 'Rencana'],
  ['kontrol', 'Kontrol'],
  ['uji', 'Uji'],
  ['kota', 'Kota'],
  ['tampilan', 'Tampilan'],
];
const BEHAVIOR_TONE = {
  Melaju: 'ok',
  Mengikuti: 'info',
  'Berhenti di lampu': 'warn',
  'Memberi jalan': 'warn',
  Menyalip: 'accent',
  'Pindah lajur': 'accent',
  'Menunggu celah': 'warn',
  'Rem darurat': 'danger',
  Manual: 'info',
};
const SPEED_STEPS = [0.25, 0.5, 1, 2, 4];

export class Hud {
  constructor(app) {
    this.app = app;
    this.d = app.disposer;
    this.tab = app.mode === 'tutorial' ? 'tutorial' : 'persepsi';
    this.sheetOpen = true;
    this.toasts = [];
    this.build();
  }

  on(target, type, fn, opts) {
    this.d.on(target, type, fn, opts);
  }

  button(text, cls, onClick, attrs = {}) {
    const b = el('button', { type: 'button', class: `s3d-btn ${cls || ''}`.trim(), ...attrs }, text);
    if (onClick) this.on(b, 'click', onClick);
    return b;
  }

  kbd(k) {
    return el('kbd', {}, k);
  }

  /** Kelompok tombol pilihan (segmented control). */
  seg(label, options, onPick, cls = '') {
    const wrap = el('div', { class: `s3d-seg ${cls}`.trim(), role: 'group', 'aria-label': label });
    const btns = new Map();
    for (const [value, text, key] of options) {
      const b = el('button', { type: 'button', class: 's3d-seg-btn', 'aria-pressed': 'false', dataset: { value } }, text, key ? el('span', { class: 's3d-key', 'aria-hidden': 'true' }, key) : null);
      if (key) b.setAttribute('aria-keyshortcuts', key);
      this.on(b, 'click', () => onPick(value));
      wrap.append(b);
      btns.set(value, b);
    }
    return {
      el: wrap,
      set(v) {
        for (const [val, b] of btns) b.setAttribute('aria-pressed', String(val === v));
      },
    };
  }

  toggle(text, key, onClick) {
    const b = el('button', { type: 'button', class: 's3d-toggle', 'aria-pressed': 'true' }, el('span', { class: 's3d-toggle-dot', 'aria-hidden': 'true' }), text, key ? el('span', { class: 's3d-key', 'aria-hidden': 'true' }, key) : null);
    if (key) b.setAttribute('aria-keyshortcuts', key);
    this.on(b, 'click', onClick);
    return b;
  }

  bar(label, centered = false) {
    const fill = el('span', { class: 's3d-bar-fill' });
    const val = el('span', { class: 's3d-bar-val' }, '0%');
    const track = el('span', { class: `s3d-bar-track${centered ? ' is-centered' : ''}` }, centered ? el('span', { class: 's3d-bar-mid' }) : null, fill);
    const row = el('div', { class: 's3d-bar' }, el('span', { class: 's3d-bar-label' }, label), track, val);
    return { el: row, fill, val };
  }

  panel(id, title, ...children) {
    const body = el('div', { class: 's3d-panel-body', id: `s3d-body-${id}` }, ...children);
    const head = el('button', { type: 'button', class: 's3d-panel-head', 'aria-expanded': 'true', 'aria-controls': `s3d-body-${id}` }, el('span', {}, title), el('span', { class: 's3d-chev', 'aria-hidden': 'true' }));
    const sec = el('section', { class: 's3d-panel', dataset: { tab: id }, 'aria-label': title }, head, body);
    this.on(head, 'click', () => {
      if (this.mobile) return;
      const open = head.getAttribute('aria-expanded') !== 'true';
      head.setAttribute('aria-expanded', String(open));
      sec.classList.toggle('is-collapsed', !open);
    });
    return sec;
  }

  setCollapsed(sec, collapsed) {
    const head = sec.querySelector('.s3d-panel-head');
    head.setAttribute('aria-expanded', String(!collapsed));
    sec.classList.toggle('is-collapsed', collapsed);
  }

  build() {
    const { app } = this;
    const root = el('div', { class: 's3d', dataset: { mode: app.mode, layout: 'desktop' } });
    this.root = root;
    const stage = el('div', { class: 's3d-stage' });
    this.stage = stage;
    this.labels = el('div', { class: 's3d-labels', 'aria-hidden': 'true' });

    // ===== bar atas =====
    this.modeTabs = new Map();
    const modes = el('div', { class: 's3d-modes', role: 'tablist', 'aria-label': 'Mode simulator' });
    for (const [m, t] of [
      ['tutorial', 'Mode Tutorial'],
      ['bebas', 'Mode Bebas'],
    ]) {
      const b = el('button', { type: 'button', role: 'tab', class: 's3d-mode', dataset: { mode: m }, 'aria-selected': String(app.mode === m) }, el('span', { class: 's3d-long' }, 'Mode '), t.replace('Mode ', ''));
      this.on(b, 'click', () => app.setMode(m));
      modes.append(b);
      this.modeTabs.set(m, b);
    }
    this.camSeg = this.seg(
      'Sudut kamera',
      CAMERA_MODES.map((m, i) => [m, CAMERA_LABEL[m], String(i + 1)]),
      (m) => app.setCamera(m),
    );
    this.camGroup = el('div', { class: 's3d-group', dataset: { hl: 'kamera' } }, el('span', { class: 's3d-glabel' }, 'Kamera'), this.camSeg.el);
    this.wxSeg = this.seg(
      'Cuaca',
      Object.entries(WEATHER_LABEL).map(([k, v]) => [k, v]),
      (w) => app.setWeather(w),
    );
    this.wxGroup = el('div', { class: 's3d-group', dataset: { hl: 'cuaca' } }, el('span', { class: 's3d-glabel' }, 'Cuaca'), this.wxSeg.el);
    this.topMid = el('div', { class: 's3d-topmid' }, this.camGroup, this.wxGroup);

    this.pauseText = el('span', { class: 's3d-pt' }, 'Jeda');
    this.pauseBtn = this.button([el('span', { class: 's3d-pi', 'aria-hidden': 'true' }), this.pauseText], 's3d-pause', () => app.togglePause(), { 'aria-keyshortcuts': 'Space P', title: 'Jeda atau lanjutkan (Spasi atau P)', 'aria-pressed': 'false' });
    this.slowBtn = this.button('−', 's3d-icon', () => app.changeSpeed(-1), { 'aria-label': 'Perlambat simulasi', title: 'Perlambat ([ atau -)' });
    this.speedOut = el('output', { class: 's3d-speed', 'aria-live': 'off' }, '1x');
    this.fastBtn = this.button('+', 's3d-icon', () => app.changeSpeed(1), { 'aria-label': 'Percepat simulasi', title: 'Percepat (] atau +)' });
    const time = el('div', { class: 's3d-time', role: 'group', 'aria-label': 'Waktu simulasi' }, this.pauseBtn, this.slowBtn, this.speedOut, this.fastBtn);
    this.qualSel = el('select', { class: 's3d-select', 'aria-label': 'Kualitas grafis' }, el('option', { value: 'hemat' }, 'Hemat'), el('option', { value: 'standar' }, 'Standar'), el('option', { value: 'tinggi' }, 'Tinggi'));
    this.on(this.qualSel, 'change', () => app.setQuality(this.qualSel.value));
    this.qualLabel = el('label', { class: 's3d-quality' }, el('span', {}, 'Kualitas'), this.qualSel);
    this.helpBtn = this.button('?', 's3d-icon s3d-help-btn', () => app.toggleHelp(), { 'aria-label': 'Bantuan pintasan papan ketik', 'aria-keyshortcuts': 'H', title: 'Pintasan papan ketik (H atau ?)' });
    this.topRight = el('div', { class: 's3d-topright' }, time, this.qualLabel, this.helpBtn);
    this.top = el('header', { class: 's3d-top' }, modes, this.topMid, this.topRight);

    // ===== panel tutorial =====
    this.tut = {};
    this.tut.step = el('span', { class: 's3d-tut-step' });
    this.tut.min = this.button('', 's3d-icon s3d-tut-min', () => this.toggleTutMin(), { 'aria-label': 'Perkecil kartu tutorial', 'aria-expanded': 'true' });
    this.tut.dots = el('ol', { class: 's3d-dots', 'aria-label': 'Kemajuan tutorial' });
    this.tut.title = el('h2', { class: 's3d-tut-title', tabindex: '-1' });
    this.tut.body = el('div', { class: 's3d-tut-body' });
    this.tut.actions = el('div', { class: 's3d-tut-actions' });
    this.tut.taskText = el('p', { class: 's3d-task-text' });
    this.tut.taskState = el('span', { class: 's3d-task-state' });
    this.tut.task = el('div', { class: 's3d-task', dataset: { done: 'false' } }, el('span', { class: 's3d-task-icon', 'aria-hidden': 'true' }), el('div', {}, el('span', { class: 's3d-task-label' }, 'Tugas'), this.tut.taskText, this.tut.taskState));
    this.tut.note = el('p', { class: 's3d-tut-note', hidden: true, role: 'note' }, 'Autopilot sedang mati, jadi mobil tidak mengemudi sendiri. Nyalakan lagi dengan tombol Autopilot di panel Kontrol (atau tekan M).');
    this.tut.prev = this.button('Sebelumnya', 's3d-ghost', () => app.tutorial.prev());
    this.tut.next = this.button('Lanjut', 's3d-primary', () => app.tutorial.next());
    this.tut.pill = this.button('', 's3d-tut-pill', () => this.toggleTutMin(false));
    const tutInner = el('div', { class: 's3d-tut-inner' }, el('div', { class: 's3d-tut-head' }, this.tut.step, this.tut.min), this.tut.dots, this.tut.title, this.tut.body, this.tut.actions, this.tut.task, this.tut.note, el('div', { class: 's3d-tut-nav' }, this.tut.prev, this.tut.next));
    this.tutPanel = el('section', { class: 's3d-panel s3d-tut', dataset: { tab: 'tutorial' }, 'aria-label': 'Tutorial' }, tutInner, this.tut.pill);

    // ===== panel persepsi =====
    this.lidarTg = this.toggle('LiDAR', 'L', () => app.toggleLidar());
    this.boxTg = this.toggle('Kotak deteksi', 'K', () => app.toggleBoxes());
    this.fovTg = this.toggle('Bidang kamera', null, () => app.toggleFov());
    this.sensLine = el('p', { class: 's3d-muted s3d-small' });
    this.objList = el('ul', { class: 's3d-objs', 'aria-label': 'Objek terdekat' });
    this.objRows = [];
    for (let i = 0; i < 5; i++) {
      const dot = el('span', { class: 's3d-dot' });
      const name = el('span', { class: 's3d-obj-name' });
      const dist = el('span', { class: 's3d-obj-dist' });
      const rel = el('span', { class: 's3d-obj-rel' });
      const li = el('li', { hidden: true }, dot, name, dist, rel);
      this.objList.append(li);
      this.objRows.push({ li, dot, name, dist, rel });
    }
    this.objEmpty = el('p', { class: 's3d-muted s3d-small' }, 'Belum ada objek terdeteksi di sekitar mobil.');
    this.counts = el('div', { class: 's3d-chips', 'aria-label': 'Jumlah objek per kelas' });
    this.limiter = el('dd', {});
    this.lightDot = el('span', { class: 's3d-dot s3d-light' });
    this.lightText = el('span', {});
    this.pPersepsi = this.panel(
      'persepsi',
      'Apa yang dilihat mobil',
      el('div', { class: 's3d-toggles' }, this.lidarTg, this.boxTg, this.fovTg),
      this.sensLine,
      el('h3', { class: 's3d-sub' }, 'Objek terdekat'),
      this.objList,
      this.objEmpty,
      this.counts,
      el('dl', { class: 's3d-dl' }, el('dt', {}, 'Objek pembatas'), this.limiter, el('dt', {}, 'Lampu lalu lintas berikutnya'), el('dd', {}, this.lightDot, this.lightText)),
    );

    // ===== panel perencanaan =====
    this.behBadge = el('span', { class: 's3d-badge' }, 'Melaju');
    this.behWhy = el('p', { class: 's3d-why' });
    this.laneOut = el('dd', {});
    this.routeOut = el('dd', {});
    this.pathTg = this.toggle('Jalur rencana', null, () => app.togglePath());
    this.pRencana = this.panel(
      'rencana',
      'Perencanaan',
      el('div', { class: 's3d-beh' }, el('span', { class: 's3d-small s3d-muted' }, 'Perilaku'), this.behBadge),
      this.behWhy,
      el('dl', { class: 's3d-dl' }, el('dt', {}, 'Pilihan lajur'), this.laneOut, el('dt', {}, 'Rute (A*)'), this.routeOut),
      el('div', { class: 's3d-toggles' }, this.pathTg),
      el('p', { class: 's3d-legend s3d-small' }, el('span', { class: 's3d-swatch is-path' }), 'jalur beberapa detik ke depan', el('span', { class: 's3d-swatch is-route' }), 'sisa rute'),
    );

    // ===== panel kontrol =====
    this.apBtn = el('button', { type: 'button', class: 's3d-switch', role: 'switch', 'aria-checked': 'true', 'aria-keyshortcuts': 'M' }, el('span', { class: 's3d-switch-knob', 'aria-hidden': 'true' }), el('span', { class: 's3d-switch-text' }, 'Autopilot'), el('span', { class: 's3d-key', 'aria-hidden': 'true' }, 'M'));
    this.on(this.apBtn, 'click', () => app.toggleAutopilot());
    this.speedIn = el('input', { type: 'range', min: '10', max: '70', step: '5', value: '50', id: 's3d-target', 'aria-describedby': 's3d-target-out' });
    this.speedOutT = el('output', { id: 's3d-target-out', for: 's3d-target' }, '50 km/jam');
    this.on(this.speedIn, 'input', () => app.setTargetSpeed(Number(this.speedIn.value)));
    this.speedBig = el('span', { class: 's3d-bigspeed' }, '0');
    this.gasBar = this.bar('Gas');
    this.brakeBar = this.bar('Rem');
    this.steerBar = this.bar('Kemudi', true);
    this.gasBar.el.classList.add('is-gas');
    this.brakeBar.el.classList.add('is-brake');
    this.steerBar.el.classList.add('is-steer');
    this.aebBtn = this.button('Rem darurat', 's3d-danger', () => app.emergencyBrake(), { 'aria-keyshortcuts': 'B' });
    this.aebBtn.append(el('span', { class: 's3d-key', 'aria-hidden': 'true' }, 'B'));
    this.manualHint = el('p', { class: 's3d-small s3d-muted', hidden: true }, 'Kemudikan dengan tombol panah atau W, A, S, D, atau pakai tombol di bawah layar.');
    this.manualHintTouch = 'Kemudikan dengan tombol Kiri, Gas, Rem, dan Kanan di layar.';
    this.manualHintKeys = this.manualHint.textContent;
    this.pKontrol = this.panel(
      'kontrol',
      'Kontrol',
      el('div', { class: 's3d-row' }, this.apBtn, el('div', { class: 's3d-speedbox' }, this.speedBig, el('span', { class: 's3d-small s3d-muted' }, 'km/jam'))),
      el('label', { class: 's3d-range', for: 's3d-target' }, el('span', {}, 'Kecepatan target'), this.speedOutT),
      this.speedIn,
      this.gasBar.el,
      this.brakeBar.el,
      this.steerBar.el,
      this.aebBtn,
      this.manualHint,
    );

    // ===== panel uji skenario =====
    const obsBtns = el('div', { class: 's3d-grid3' });
    this.obsBtns = new Map();
    for (const [k, def] of Object.entries(OBSTACLE_TYPES)) {
      const b = this.button(def.label, 's3d-obs', () => app.placeObstacle(k), { dataset: { type: k }, title: `Taruh ${def.label.toLowerCase()} sekitar 40 m di depan` });
      obsBtns.append(b);
      this.obsBtns.set(k, b);
    }
    this.clickTg = this.toggle('Taruh dengan klik di jalan', null, () => app.armClick());
    this.clickTg.setAttribute('aria-pressed', 'false');
    this.clickNote = el('p', { class: 's3d-small s3d-muted s3d-tutonly' }, 'Menaruh dengan klik tersedia di Mode Bebas.');
    this.jayBtn = this.button('Pejalan kaki menyeberang', 's3d-warnbtn', () => app.jaywalker(), { 'aria-keyshortcuts': 'J' });
    this.jayBtn.append(el('span', { class: 's3d-key', 'aria-hidden': 'true' }, 'J'));
    this.clearBtn = this.button('Hapus rintangan', 's3d-ghost', () => app.clearObstacles());
    this.trafIn = el('input', { type: 'range', min: '0', max: '60', step: '2', value: '30', id: 's3d-traf' });
    this.trafOut = el('output', { for: 's3d-traf' }, '30 mobil');
    this.on(this.trafIn, 'input', () => app.setTrafficDensity(Number(this.trafIn.value)));
    this.pedIn = el('input', { type: 'range', min: '0', max: '80', step: '2', value: '40', id: 's3d-ped' });
    this.pedOut = el('output', { for: 's3d-ped' }, '40 orang');
    this.on(this.pedIn, 'input', () => app.setPedDensity(Number(this.pedIn.value)));
    this.pUji = this.panel(
      'uji',
      'Uji skenario',
      el('p', { class: 's3d-small s3d-muted s3d-keyhint' }, 'Taruh rintangan sekitar 40 m di depan, di lajur mobil (tombol O mengulang pilihan terakhir).'),
      el('p', { class: 's3d-small s3d-muted s3d-touchhint' }, 'Taruh rintangan sekitar 40 m di depan, di lajur mobil.'),
      obsBtns,
      el('div', { class: 's3d-toggles s3d-bebasonly' }, this.clickTg),
      this.clickNote,
      el('div', { class: 's3d-row2' }, this.jayBtn, this.clearBtn),
      el('label', { class: 's3d-range', for: 's3d-traf' }, el('span', {}, 'Kepadatan lalu lintas'), this.trafOut),
      this.trafIn,
      el('label', { class: 's3d-range', for: 's3d-ped' }, el('span', {}, 'Kepadatan pejalan kaki'), this.pedOut),
      this.pedIn,
    );

    // ===== panel kota pintar =====
    this.sigSeg = this.seg(
      'Mode lampu lalu lintas',
      [
        ['adaptif', 'Adaptif'],
        ['tetap', 'Waktu tetap'],
      ],
      (m) => app.setSignalMode(m),
      's3d-seg-wide',
    );
    this.sigWhy = el('p', { class: 's3d-small s3d-muted' });
    this.waitA = el('dd', {});
    this.waitT = el('dd', {});
    this.waitNow = el('dd', {});
    this.nearSig = el('dd', {});
    this.queueTg = this.toggle('Garis antrean', null, () => app.toggleQueues());
    this.pKota = this.panel(
      'kota',
      'Kota pintar',
      this.sigSeg.el,
      this.sigWhy,
      el('dl', { class: 's3d-dl s3d-dl-grid' }, el('dt', {}, 'Rata-rata tunggu, Adaptif'), this.waitA, el('dt', {}, 'Rata-rata tunggu, Waktu tetap'), this.waitT, el('dt', {}, 'Berhenti di lampu'), this.waitNow, el('dt', {}, 'Lampu di depan'), this.nearSig),
      el('div', { class: 's3d-toggles' }, this.queueTg),
    );

    // ===== panel tampilan (khusus ponsel) =====
    this.tampilBody = el('div', { class: 's3d-tampil' });
    this.pTampil = this.panel('tampilan', 'Tampilan', this.tampilBody);

    this.panels = [this.pPersepsi, this.pRencana, this.pKontrol, this.pUji, this.pKota];
    this.left = el('aside', { class: 's3d-left', 'aria-label': 'Tutorial' });
    this.right = el('aside', { class: 's3d-right', 'aria-label': 'Panel simulator' });

    // ===== indikator keselamatan =====
    const cell = (label, unit, hint) => {
      const v = el('span', { class: 's3d-safe-val' }, '0');
      const c = el('div', { class: 's3d-safe', title: hint }, el('span', { class: 's3d-safe-label' }, label), v, unit ? el('span', { class: 's3d-safe-unit' }, unit) : null);
      return { c, v };
    };
    this.sSpeed = cell('Kecepatan', 'km/jam', 'Kecepatan mobil otonom sekarang');
    this.sTtc = cell('TTC', '', 'Waktu sampai tabrakan bila tidak ada yang berubah');
    this.sDev = cell('Simpangan lajur', 'm', 'Jarak titik tengah mobil dari jalur rencana');
    this.sCol = cell('Tabrakan', '', 'Jumlah tabrakan mobil otonom');
    this.sAeb = cell('Rem darurat', '', 'Berapa kali rem darurat bekerja');
    this.sOvt = cell('Menyalip', '', 'Berapa kali mobil menyalip rintangan');
    this.safety = el('div', { class: 's3d-safety', role: 'group', 'aria-label': 'Indikator keselamatan', dataset: { hl: 'safety' } }, this.sSpeed.c, this.sTtc.c, this.sDev.c, this.sCol.c, this.sAeb.c, this.sOvt.c);

    // ===== tombol mengemudi manual =====
    this.drive = el('div', { class: 's3d-drive', hidden: true, role: 'group', 'aria-label': 'Kemudi manual' });
    for (const [key, text] of [
      ['left', 'Kiri'],
      ['up', 'Gas'],
      ['down', 'Rem'],
      ['right', 'Kanan'],
    ]) {
      const b = el('button', { type: 'button', class: 's3d-btn s3d-drive-btn', dataset: { key } }, text);
      const set = (v) => (ev) => {
        ev.preventDefault();
        app.control.keys[key] = v;
        b.classList.toggle('is-down', v);
      };
      this.on(b, 'pointerdown', set(true));
      this.on(b, 'pointerup', set(false));
      this.on(b, 'pointerleave', set(false));
      this.on(b, 'pointercancel', set(false));
      this.on(b, 'contextmenu', (ev) => ev.preventDefault());
      this.drive.append(b);
    }

    this.toastBox = el('div', { class: 's3d-toasts', role: 'status', 'aria-live': 'polite' });
    this.placeHint = el('div', { class: 's3d-placehint', hidden: true }, el('span', {}), this.button('Selesai', 's3d-ghost s3d-small-btn', () => app.armClick(false)));
    this.pausedBadge = el('div', { class: 's3d-paused', hidden: true }, 'Dijeda');

    // ===== lembar bawah (ponsel) =====
    this.tabBtns = new Map();
    const tabs = el('div', { class: 's3d-tabs', role: 'tablist', 'aria-label': 'Panel' });
    for (const [id, text] of TABS) {
      const b = el('button', { type: 'button', role: 'tab', class: 's3d-tab', dataset: { tab: id }, 'aria-selected': 'false' }, text);
      this.on(b, 'click', () => this.setTab(id, true));
      tabs.append(b);
      this.tabBtns.set(id, b);
    }
    this.sheetBtn = this.button('', 's3d-icon s3d-sheet-btn', () => this.toggleSheet(), { 'aria-label': 'Perkecil panel', 'aria-expanded': 'true' });
    this.sheetHead = el('div', { class: 's3d-sheet-head' }, el('div', { class: 's3d-tabrow' }, tabs, this.sheetBtn));
    this.sheetBody = el('div', { class: 's3d-sheet-body' });
    this.sheet = el('div', { class: 's3d-sheet' }, this.sheetHead, this.sheetBody);

    // ===== bantuan =====
    const keys = [
      [['1 2 3 4'], 'Pilih kamera Orbit, Kejar, Atas, atau Kokpit'],
      [['C'], 'Ganti ke kamera berikutnya'],
      [['Spasi', 'P'], 'Jeda atau lanjutkan simulasi'],
      [['[', '-'], 'Perlambat waktu (sampai 0,25x)'],
      [[']', '+'], 'Percepat waktu (sampai 4x)'],
      [['J'], 'Pejalan kaki menyeberang mendadak'],
      [['O'], 'Taruh rintangan sekitar 40 m di depan'],
      [['B'], 'Rem darurat'],
      [['M'], 'Autopilot nyala atau mati'],
      [['L'], 'Tampilan LiDAR'],
      [['K'], 'Kotak deteksi'],
      [['Panah', 'W A S D'], 'Mengemudi saat autopilot mati'],
      [['H', '?'], 'Buka atau tutup bantuan ini'],
    ];
    const dl = el('dl', { class: 's3d-keys' });
    for (const [ks, text] of keys) {
      dl.append(el('dt', {}, ks.map((k, i) => [i ? el('span', { class: 's3d-or' }, 'atau') : null, this.kbd(k)])), el('dd', {}, text));
    }
    this.helpClose = this.button('Tutup', 's3d-primary', () => app.toggleHelp(false));
    this.helpCard = el('div', { class: 's3d-help-card' }, el('h2', { id: 's3d-help-title' }, 'Pintasan papan ketik'), el('p', { class: 's3d-muted s3d-small' }, 'Setiap pintasan juga punya tombol di layar. Pintasan tidak aktif saat kamu sedang mengetik. Tombol P selalu menjeda atau melanjutkan simulasi.'), dl, this.helpClose);
    this.help = el('div', { class: 's3d-help', hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 's3d-help-title' }, this.helpCard);
    this.on(this.help, 'click', (ev) => {
      if (ev.target === this.help) app.toggleHelp(false);
    });

    this.sr = el('p', { class: 's3d-sr', 'aria-live': 'polite' });
    stage.append(this.labels, this.top, this.left, this.right, this.safety, this.drive, this.toastBox, this.placeHint, this.pausedBadge);
    root.append(stage, this.sheet, this.help, this.sr);
    // Setelah tombol diklik atau diketuk, lepaskan fokusnya. Dengan begitu Spasi kembali menjeda
    // simulasi dan tidak mengulang aksi tombol. Aktivasi dengan papan ketik (detail 0) tidak diubah.
    this.on(root, 'click', (ev) => {
      if (!ev.detail) return;
      const b = ev.target && ev.target.closest ? ev.target.closest('button') : null;
      if (b && b === document.activeElement) b.blur();
    });
    this.occ = [];
    this.applyLayout(false);
  }

  /**
   * Kotak panel di atas kanvas (relatif terhadap panggung). Label 3D yang jatuh di belakang panel
   * disembunyikan supaya tidak tembus pandang di balik panel kaca.
   */
  measureOccluders() {
    const st = this.stage.getBoundingClientRect();
    const out = [];
    const add = (node) => {
      if (!node || node.hidden) return;
      const r = node.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      out.push({ l: r.left - st.left, t: r.top - st.top, r: r.right - st.left, b: r.bottom - st.top });
    };
    for (const c of this.top.children) {
      if (c === this.topMid || c === this.topRight) for (const g of c.children) add(g);
      else add(c);
    }
    for (const p of this.left.children) add(p);
    for (const p of this.right.children) add(p);
    if (!this.mobile) for (const c of this.safety.children) add(c);
    add(this.placeHint);
    add(this.drive);
    this.occ = out;
  }

  /** Pindahkan panel antara tata letak desktop dan ponsel. */
  applyLayout(mobile) {
    this.mobile = mobile;
    this.root.dataset.layout = mobile ? 'mobile' : 'desktop';
    if (mobile) {
      this.sheetHead.prepend(this.safety);
      this.tampilBody.append(this.camGroup, this.wxGroup, this.qualLabel);
      this.sheetBody.append(this.tutPanel, ...this.panels, this.pTampil);
      for (const p of [...this.panels, this.pTampil]) this.setCollapsed(p, false);
      this.setTab(this.app.mode === 'bebas' && this.tab === 'tutorial' ? 'persepsi' : this.tab);
    } else {
      this.stage.insertBefore(this.safety, this.drive);
      this.topMid.append(this.camGroup, this.wxGroup);
      this.topRight.insertBefore(this.qualLabel, this.helpBtn);
      this.left.append(this.tutPanel);
      this.right.append(...this.panels);
      for (const p of [...this.panels, this.tutPanel]) p.classList.remove('is-active');
      this.setCollapsed(this.pUji, !this.uJiOpen);
      this.setCollapsed(this.pKota, !this.kotaOpen);
    }
  }

  setTab(id, user = false) {
    if (this.app.mode === 'bebas' && id === 'tutorial') id = 'persepsi';
    this.tab = id;
    for (const [t, b] of this.tabBtns) {
      b.setAttribute('aria-selected', String(t === id));
      b.tabIndex = t === id ? 0 : -1;
    }
    for (const p of [this.tutPanel, ...this.panels, this.pTampil]) p.classList.toggle('is-active', p.dataset.tab === id);
    if (user && !this.sheetOpen) this.toggleSheet(true);
    if (this.mobile) this.sheetBody.scrollTop = 0;
    if (user) this.tabBtns.get(id).classList.remove('is-pulse');
  }

  toggleSheet(force) {
    this.sheetOpen = force === undefined ? !this.sheetOpen : force;
    this.root.classList.toggle('is-sheet-min', !this.sheetOpen);
    this.sheetBtn.setAttribute('aria-expanded', String(this.sheetOpen));
    this.sheetBtn.setAttribute('aria-label', this.sheetOpen ? 'Perkecil panel' : 'Perbesar panel');
  }

  toggleTutMin(force) {
    const min = force === undefined ? !this.tutPanel.classList.contains('is-min') : force;
    this.tutPanel.classList.toggle('is-min', min);
    this.tut.min.setAttribute('aria-expanded', String(!min));
  }

  setMode(mode) {
    this.root.dataset.mode = mode;
    for (const [m, b] of this.modeTabs) b.setAttribute('aria-selected', String(m === mode));
    this.tabBtns.get('tutorial').hidden = mode !== 'tutorial';
    if (mode === 'bebas' && this.tab === 'tutorial') this.setTab('persepsi');
    if (mode === 'tutorial' && this.mobile) this.setTab('tutorial');
  }

  /** Sorot panel yang sedang dibahas tutorial. */
  highlight(targets) {
    const all = [this.pPersepsi, this.pRencana, this.pKontrol, this.pUji, this.pKota, this.safety, this.camGroup, this.wxGroup, this.modeTabs.get('bebas')];
    for (const x of all) x.classList.remove('is-pulse');
    for (const b of this.tabBtns.values()) b.classList.remove('is-pulse');
    const map = { persepsi: this.pPersepsi, rencana: this.pRencana, kontrol: this.pKontrol, uji: this.pUji, kota: this.pKota, safety: this.safety, kamera: this.camGroup, cuaca: this.wxGroup, bebas: this.modeTabs.get('bebas') };
    const tabOf = { persepsi: 'persepsi', rencana: 'rencana', kontrol: 'kontrol', uji: 'uji', kota: 'kota', kamera: 'tampilan', cuaca: 'tampilan' };
    for (const t of targets || []) {
      const x = map[t];
      if (!x) continue;
      x.classList.add('is-pulse');
      if (x.classList.contains('s3d-panel') && !this.mobile) {
        this.setCollapsed(x, false);
        if (x === this.pUji) this.uJiOpen = true;
        if (x === this.pKota) this.kotaOpen = true;
      }
      if (this.mobile && tabOf[t]) this.tabBtns.get(tabOf[t]).classList.add('is-pulse');
    }
    if (!this.mobile && targets && targets.length) {
      // panel tambahan yang tidak dibahas dilipat supaya panel yang dibahas terlihat utuh
      if (!targets.includes('uji')) {
        this.setCollapsed(this.pUji, true);
        this.uJiOpen = false;
      }
      if (!targets.includes('kota')) {
        this.setCollapsed(this.pKota, true);
        this.kotaOpen = false;
      }
      const last = map[targets[targets.length - 1]];
      const first = map[targets[0]];
      if (last && this.right.contains(last)) last.scrollIntoView({ block: 'nearest' });
      if (first && this.right.contains(first)) first.scrollIntoView({ block: 'nearest' });
    }
  }

  toast(text, kind = 'info') {
    // pesan yang sama tidak ditumpuk
    const same = this.toasts.find((x) => x.textContent === text);
    if (same) {
      same.remove();
      this.toasts.splice(this.toasts.indexOf(same), 1);
    }
    const t = el('div', { class: `s3d-toast is-${kind}` }, text);
    this.toastBox.append(t);
    this.toasts.push(t);
    while (this.toasts.length > (this.mobile ? 2 : 3)) this.toasts.shift().remove();
    const timers = this.app.timers;
    const id = setTimeout(() => {
      timers.delete(id);
      t.classList.add('is-out');
      const id2 = setTimeout(() => {
        timers.delete(id2);
        t.remove();
        const i = this.toasts.indexOf(t);
        if (i >= 0) this.toasts.splice(i, 1);
      }, 300);
      timers.add(id2);
    }, 3000);
    timers.add(id);
  }

  showHelp(open) {
    this.help.hidden = !open;
    if (open) {
      // mulai dari atas supaya judul dan penjelasan terlihat, terutama di ponsel
      this.helpCard.scrollTop = 0;
      this.helpClose.focus({ preventScroll: true });
    } else this.helpBtn.focus({ preventScroll: true });
  }

  // ===== pembaruan berkala =====

  update() {
    const { app } = this;
    const e = app.ego;
    this.measureOccluders();
    const pl = app.planner;
    const per = app.perception;
    const sens = app.sensing;
    const R = sens.ranges();
    // bar atas
    this.camSeg.set(app.cameras.mode);
    this.wxSeg.set(app.weather.name);
    const ts = app.timeScale;
    this.speedOut.textContent = `${fmt(ts, ts < 1 ? 2 : 0)}x`;
    if (ts === 0.5) this.speedOut.textContent = '0,5x';
    this.pauseText.textContent = app.paused ? 'Lanjutkan' : 'Jeda';
    this.pauseBtn.setAttribute('aria-label', app.paused ? 'Lanjutkan simulasi' : 'Jeda simulasi');
    this.pauseBtn.setAttribute('aria-pressed', String(app.paused));
    this.pausedBadge.hidden = !app.paused;
    this.slowBtn.disabled = ts <= SPEED_STEPS[0];
    this.fastBtn.disabled = ts >= SPEED_STEPS[SPEED_STEPS.length - 1];
    if (this.qualSel.value !== app.quality) this.qualSel.value = app.quality;

    // keselamatan
    this.sSpeed.v.textContent = fmt(Math.abs(kmh(e.v)), 0);
    const ttc = pl.ttc;
    const ttcTxt = ttc < 20 ? `${fmt(ttc, 1)} detik` : 'tidak ada konflik';
    this.sTtc.v.textContent = ttcTxt;
    this.sTtc.v.classList.toggle('is-long', ttcTxt.length > 12);
    this.sTtc.c.dataset.tone = ttc < 1.8 ? 'danger' : ttc < 3.5 ? 'warn' : 'ok';
    this.sDev.v.textContent = fmt(app.lateralError, 2);
    this.sCol.v.textContent = fmt(app.counters.collisions, 0);
    this.sCol.c.dataset.tone = app.counters.collisions ? 'danger' : 'ok';
    this.sAeb.v.textContent = fmt(app.counters.aebAuto + app.counters.aebManual, 0);
    this.sAeb.c.dataset.tone = pl.aeb || pl.manualBrakeT > 0 ? 'danger' : '';
    this.sOvt.v.textContent = fmt(app.counters.overtakes, 0);

    // persepsi
    this.lidarTg.setAttribute('aria-pressed', String(sens.showLidar));
    this.boxTg.setAttribute('aria-pressed', String(per.showBoxes));
    this.fovTg.setAttribute('aria-pressed', String(sens.showFov));
    this.sensLine.textContent = `Jangkauan LiDAR ${fmt(R.lidar, 0)} m, kamera ${fmt(R.kamera, 0)} m. ${fmt(sens.pointCount, 0)} titik LiDAR per putaran.`;
    const sorted = per.list.slice().sort((a, b) => a.dist - b.dist);
    for (let i = 0; i < this.objRows.length; i++) {
      const row = this.objRows[i];
      const t = sorted[i];
      if (!t) {
        row.li.hidden = true;
        continue;
      }
      row.li.hidden = false;
      const cls = t.known ? t.cls : 'objek';
      row.dot.style.background = CLASSES[cls].color;
      row.name.textContent = CLASSES[cls].label;
      row.dist.textContent = `${fmt(per.gap(t), 0)} m`;
      const rate = t.rate || 0;
      row.rel.textContent = Math.abs(rate) < 0.3 ? 'jarak tetap' : rate < 0 ? `mendekat ${fmt(-rate, 1)} m/s` : `menjauh ${fmt(rate, 1)} m/s`;
      row.rel.dataset.tone = rate < -0.3 ? 'warn' : '';
    }
    this.objEmpty.hidden = sorted.length > 0;
    const counts = per.counts();
    const chips = Object.keys(CLASSES)
      .filter((k) => counts[k])
      .map((k) => `<span class="s3d-chip"><span class="s3d-dot" style="background:${CLASSES[k].color}"></span>${CLASSES[k].label} ${counts[k]}</span>`)
      .join('');
    if (this.counts.innerHTML !== chips) this.counts.innerHTML = chips;
    this.limiter.textContent = pl.limiter;
    const L = per.light;
    const colName = { red: 'Merah', yellow: 'Kuning', green: 'Hijau' };
    if (L) {
      this.lightDot.dataset.color = L.color;
      this.lightText.textContent = L.color === 'unknown' ? `Belum terbaca, ${fmt(L.dist, 0)} m` : `${colName[L.color]}, ${fmt(L.dist, 0)} m`;
    } else {
      this.lightDot.dataset.color = 'none';
      const st = pl.stopInfo;
      this.lightText.textContent = st && !st.signalized ? 'Tidak ada, tikungan tanpa lampu' : 'Tidak ada dalam 150 m';
    }

    // perencanaan
    this.behBadge.textContent = pl.behavior;
    this.behBadge.dataset.tone = BEHAVIOR_TONE[pl.behavior] || 'info';
    this.behWhy.textContent = pl.reason;
    this.laneOut.textContent = pl.laneWhy ? `${pl.laneText} (${pl.laneWhy})` : pl.laneText;
    this.routeOut.textContent = `${pl.routeText}. Tujuan ${fmt(pl.destLeft || 0, 0)} m lagi.`;
    this.pathTg.setAttribute('aria-pressed', String(pl.showPath));

    // kontrol
    this.apBtn.setAttribute('aria-checked', String(app.autopilot));
    this.speedBig.textContent = fmt(Math.abs(kmh(e.v)), 0);
    const tk = Math.round(kmh(app.targetSpeed));
    if (Number(this.speedIn.value) !== tk && document.activeElement !== this.speedIn) this.speedIn.value = String(tk);
    this.speedOutT.textContent = `${fmt(tk, 0)} km/jam`;
    const c = app.control;
    this.gasBar.fill.style.width = `${Math.round(c.gas * 100)}%`;
    this.gasBar.val.textContent = `${Math.round(c.gas * 100)}%`;
    this.brakeBar.fill.style.width = `${Math.round(c.brake * 100)}%`;
    this.brakeBar.val.textContent = `${Math.round(c.brake * 100)}%`;
    const st = e.steer / 0.6;
    const pct = Math.min(50, Math.abs(st) * 50);
    this.steerBar.fill.style.left = st < 0 ? `${50 - pct}%` : '50%';
    this.steerBar.fill.style.width = `${pct}%`;
    const deg = Math.abs((e.steer * 180) / Math.PI);
    this.steerBar.val.textContent = deg < 1 ? 'lurus' : `${st < 0 ? 'kiri' : 'kanan'} ${fmt(deg, 0)}°`;
    this.manualHint.hidden = app.autopilot;
    const mh = this.mobile ? this.manualHintTouch : this.manualHintKeys;
    if (this.manualHint.textContent !== mh) this.manualHint.textContent = mh;
    this.drive.hidden = app.autopilot;
    if (this.tut.note) {
      this.tut.note.hidden = app.autopilot || app.mode !== 'tutorial';
      const nt = this.mobile ? 'Autopilot sedang mati, jadi mobil tidak mengemudi sendiri. Nyalakan lagi dengan tombol Autopilot di tab Kontrol.' : 'Autopilot sedang mati, jadi mobil tidak mengemudi sendiri. Nyalakan lagi dengan tombol Autopilot di panel Kontrol (atau tekan M).';
      if (this.tut.note.textContent !== nt) this.tut.note.textContent = nt;
    }

    // uji skenario
    this.clickTg.setAttribute('aria-pressed', String(app.scen.clickArmed));
    this.trafOut.textContent = `${fmt(app.traffic.target, 0)} mobil`;
    this.pedOut.textContent = `${fmt(app.peds.target, 0)} orang`;
    for (const [k, b] of this.obsBtns) b.classList.toggle('is-selected', app.scen.selected === k);
    this.placeHint.hidden = !app.scen.clickArmed;
    if (app.scen.clickArmed) this.placeHint.firstChild.textContent = `${this.mobile ? 'Ketuk' : 'Klik'} jalan untuk menaruh ${OBSTACLE_TYPES[app.scen.selected].label.toLowerCase()}.`;

    // kota pintar
    const sig = app.signals;
    this.sigSeg.set(sig.mode);
    this.sigWhy.textContent = sig.mode === 'adaptif' ? `Hijau hanya untuk arah yang antreannya terdeteksi, minimal ${TIMING.minGreen} detik dan maksimal ${TIMING.maxGreen} detik.` : `Setiap arah mendapat hijau ${TIMING.fixedGreen} detik bergiliran, walaupun jalannya kosong.`;
    const wa = sig.avgWait('adaptif');
    const wt = sig.avgWait('tetap');
    this.waitA.textContent = wa === null ? 'belum ada data' : `${fmt(wa, 1)} detik (${fmt(sig.waits.adaptif.count, 0)} kendaraan)`;
    this.waitT.textContent = wt === null ? 'belum ada data' : `${fmt(wt, 1)} detik (${fmt(sig.waits.tetap.count, 0)} kendaraan)`;
    this.waitNow.textContent = `${fmt(app.waitingNow, 0)} kendaraan`;
    const stp = pl.stopInfo;
    const ctl = stp && stp.signalized ? sig.byNode.get(stp.node.id) : null;
    this.nearSig.textContent = ctl ? ctl.describe() : 'Tidak ada lampu dekat di rute';
    this.queueTg.setAttribute('aria-pressed', String(sig.showQueues));

    // status untuk pembaca layar, hanya saat perilaku berubah
    const status = `${pl.behavior}. ${pl.reason}`;
    if (status !== this.lastStatus && app.simTime - (this.lastStatusT || -10) > 2.5) {
      this.lastStatus = status;
      this.lastStatusT = app.simTime;
      this.sr.textContent = `Mobil ${fmt(Math.abs(kmh(e.v)), 0)} km/jam. ${status}`;
    }
  }
}
