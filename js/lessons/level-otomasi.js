// Pelajaran 1: Level Otomasi (SAE J3016, level 0 sampai 5).
//
// Pola sama dengan pelajaran contoh (sensor.js):
//   1. Teks pelajaran (intro, steps, summary) ada di objek default export.
//   2. Model dunia dan perilaku tiap level ada di ./level-otomasi/scene.js, geometri jalan di
//      ./level-otomasi/road.js.
//   3. mount(ctx) menyusun kanvas, loop, panel kontrol, HUD, dan kotak peringatan di atas kanvas.
//   4. Tugas dideteksi otomatis dari keadaan simulasi (waktu simulasi, bukan waktu nyata) atau dari
//      kejadian yang dicatat model, dan hanya untuk langkah yang sedang dibuka.
//   5. onStep(i) memasang skenario langkah, reset() mengulang skenario dengan level yang sedang
//      dipilih pelajar.

import { COLORS } from '../engine/theme.js';
import { fmt, msToKmh, kmhToMs, clamp } from '../engine/math.js';
import { createLabelLayer, drawScaleBar } from '../engine/draw.js';
import { icon } from '../engine/icons.js';
import * as ui from '../engine/ui.js';
import { createScene, V_SET, MANUAL_DIST } from './level-otomasi/scene.js';
import { EDGE_LEFT } from './level-otomasi/road.js';

const LEVELS = [
  { name: 'Tanpa otomasi', desc: 'Kamu mengemudi penuh. Sistem hanya memperingatkan atau mengerem darurat sesaat.' },
  { name: 'Bantuan pengemudi', desc: 'ACC mengatur gas dan rem. Kamu menyetir dan memantau jalan.' },
  { name: 'Otomasi sebagian', desc: 'Sistem menyetir dan mengatur kecepatan. Kamu wajib terus mengawasi.' },
  { name: 'Otomasi bersyarat', desc: 'Sistem mengemudi di dalam ODD. Kamu harus siap saat diminta mengambil alih.' },
  { name: 'Otomasi tinggi', desc: 'Sistem mengemudi dan menangani keadaan darurat sendiri di dalam ODD.' },
  { name: 'Otomasi penuh', desc: 'Sistem mengemudi di mana saja. Belum ada di pasaran.' },
];

// Tabel tanggung jawab menurut SAE J3016 (kolom = level 0 sampai 5).
const PILLS = {
  kamu: ['Kamu', 'you'],
  sistem: ['Sistem', 'sys'],
  both: ['Kamu dan sistem', 'mix'],
  ask: ['Kamu, saat diminta', 'you'],
  na: ['Tidak berlaku', 'na'],
  lim: ['Terbatas', 'lim'],
  all: ['Tidak terbatas', 'sys'],
};
const RESP_ROWS = [
  { task: 'Kemudi dan kecepatan', cells: ['kamu', 'both', 'sistem', 'sistem', 'sistem', 'sistem'] },
  { task: 'Memantau jalan', cells: ['kamu', 'kamu', 'kamu', 'sistem', 'sistem', 'sistem'] },
  { task: 'Cadangan saat sistem tidak mampu', cells: ['kamu', 'kamu', 'kamu', 'ask', 'sistem', 'sistem'] },
  { task: 'Area kerja (ODD)', cells: ['na', 'lim', 'lim', 'lim', 'lim', 'all'] },
];
const EXAMPLES = ['Peringatan dan rem darurat', 'ACC', 'ACC dan penjaga lajur', 'Pilot jalan tol', { html: 'Robotaksi, <em>shuttle</em> tanpa sopir' }, 'Belum ada'];

// Skenario tiap langkah. egoAt = posisi awal di pola jalan (0 sampai 350 m lurus, lalu tikungan S).
const PRESETS = [
  { level: 0, egoAt: 10, speed: 0, lead: { gap: 30, speed: 0, wait: true } },
  { level: 0, egoAt: 10, speed: 0, lead: { gap: 24, speed: 0, wait: true } },
  { level: 2, egoAt: 250, speed: kmhToMs(55), lead: { gap: 34, speed: kmhToMs(50) } },
  { level: 3, egoAt: 650, speed: V_SET, lead: null, zone: 300 },
  { level: 4, egoAt: 650, speed: V_SET, lead: null, boundary: 230 },
  { level: 5, egoAt: 650, speed: V_SET, lead: null, boundary: 200 },
];

const TONE_COLORS = { danger: COLORS.danger, warn: COLORS.warn, ok: COLORS.ok, info: COLORS.accent };

export default {
  id: 'level-otomasi',
  title: 'Level Otomasi',
  layout: 'sim',
  intro:
    '<p>Tidak semua mobil yang disebut otonom benar-benar mengemudi sendiri. Standar <strong>SAE J3016</strong> membagi otomasi mengemudi menjadi enam level, dari 0 sampai 5. Pembedanya adalah siapa yang bertanggung jawab atas tiap bagian tugas mengemudi, kamu atau sistem.</p>' +
    '<p>Kamu akan mencoba tiap level di jalan tol dua lajur searah. Seperti di Indonesia, mobil berjalan di lajur kiri dan menyalip lewat lajur kanan.</p>',
  steps: [
    {
      title: 'Level 0: kamu yang mengemudi',
      body:
        '<p>Di <strong>level 0</strong> tidak ada otomasi mengemudi. Kamu yang menyetir, mengatur gas dan rem, serta memantau jalan.</p>' +
        '<p>Mobil level 0 tetap boleh punya fitur keselamatan, misalnya peringatan keluar lajur, peringatan tabrakan depan, atau rem darurat otomatis. Fitur itu hanya memperingatkan atau bertindak sesaat, jadi levelnya tetap 0.</p>' +
        '<p class="note">Pakai tombol Kiri, Gas, Rem, dan Kanan, atau tombol panah di keyboard. Jalannya berkelok landai, jadi sesekali kamu perlu menyetir.</p>',
      task: { id: 'l0-manual', text: 'Kemudikan mobil sendiri di <strong>level 0</strong> sejauh 150 m.' },
    },
    {
      title: 'Level 1: satu bantuan',
      body:
        '<p>Di <strong>level 1</strong> sistem membantu satu hal saja: mengatur kecepatan <em>atau</em> menyetir. Contoh yang paling umum adalah <strong>ACC</strong> (<em>adaptive cruise control</em>). ACC memakai radar untuk mengukur jarak ke mobil depan, lalu mengatur gas dan rem supaya jaraknya tetap aman.</p>' +
        '<p>Kamu tetap menyetir dan memantau jalan. ACC di sini menjaga jarak 4 m ditambah jarak tempuh 1,5 detik, dengan kecepatan paling tinggi 60 km/jam. Menginjak rem mematikan ACC.</p>',
      task: { id: 'l1-acc', text: 'Pilih <strong>level 1</strong>, lalu biarkan ACC menjaga jarak di belakang mobil depan selama 5 detik. Kamu tetap menyetir.' },
    },
    {
      title: 'Level 2: sistem menyetir, kamu mengawasi',
      body:
        '<p>Di <strong>level 2</strong> sistem menyetir sekaligus mengatur kecepatan. Kamu tetap pengemudinya. Tugas memantau jalan dan menanggapi kejadian masih milikmu, jadi matamu harus tetap di jalan.</p>' +
        '<p>Karena itu mobil level 2 memeriksa perhatian pengemudi. Bila kamu tidak merespons, sistem memberi peringatan keras, memperlambat mobil, lalu menyerahkan kemudi kembali kepadamu.</p>' +
        '<p class="note">Mobil sungguhan memakai sensor di setir atau kamera yang melihat wajah pengemudi. Di sini tombol Pegang kemudi menggantikannya.</p>',
      task: { id: 'l2-attention', text: 'Saat muncul pesan <strong>Pegang kemudi</strong>, tekan tombol Pegang kemudi atau <kbd>P</kbd>.' },
    },
    {
      title: 'Level 3: siap mengambil alih',
      body:
        '<p>Di <strong>level 3</strong> sistem mengemudi dan memantau jalan sendiri, tetapi hanya di dalam <strong>ODD</strong> (<em>operational design domain</em>). ODD adalah kondisi tempat sistem dirancang bekerja, misalnya jalan tol, siang hari, dan kecepatan tertentu.</p>' +
        '<p>Selama sistem aktif kamu boleh tidak memperhatikan jalan, tetapi harus tetap di kursi pengemudi dan siap. Sebelum keluar dari ODD, misalnya karena ada zona konstruksi, sistem memberi <strong>permintaan ambil alih</strong> dengan hitungan mundur. Di simulasi ini hitungan mundurnya 10 detik.</p>' +
        '<p class="note is-warn">Bila kamu diam saja, mobil ini melambat dan berhenti di lajurnya dengan lampu hazard. Itu hanya upaya terakhir. Di level 3 orang di kursi pengemudi tetap diharapkan mengambil alih.</p>',
      task: { id: 'l3-takeover', text: 'Tunggu permintaan ambil alih, lalu tekan <strong>Ambil alih</strong> atau <kbd>A</kbd> sebelum hitungan mundur habis.' },
    },
    {
      title: 'Level 4: sistem menjadi cadangannya sendiri',
      body:
        '<p>Di <strong>level 4</strong> sistem mengemudi dan memantau jalan. Bila ada masalah, sistem juga membawa mobil ke <strong>kondisi risiko minimal</strong> tanpa bantuan manusia. Semua itu berlaku selama mobil masih di dalam ODD. Contohnya robotaksi dan <em>shuttle</em> tanpa sopir yang melayani kawasan tertentu.</p>' +
        '<p>Saat mendekati batas ODD, sistem level 4 tidak bergantung pada bantuanmu. Ia melakukan manuver risiko minimal: menyalakan lampu sein, menepi ke bahu jalan kiri, lalu berhenti dengan aman.</p>' +
        '<p class="note">Robotaksi sungguhan biasanya memilih rute yang tetap di dalam ODD. Jalan di simulasi ini sengaja lurus melewati batas supaya kamu bisa melihat apa yang dilakukan sistem.</p>',
      task: { id: 'l4-mrm', text: 'Amati mobil level 4 menepi dan berhenti sendiri sebelum rambu <strong>Batas area operasi</strong>.' },
    },
    {
      title: 'Level 5: di mana saja',
      body:
        '<p>Di <strong>level 5</strong> sistem bisa mengemudi di semua jalan dan kondisi yang masih bisa ditangani pengemudi manusia. ODD-nya tidak terbatas, jadi rambu batas area operasi tidak menghentikannya.</p>' +
        '<p class="note is-warn">Sampai sekarang belum ada kendaraan level 5 yang dijual atau beroperasi secara komersial. Level 5 masih menjadi tujuan riset.</p>' +
        '<p>Coba pindah-pindah level di panel dan bandingkan isi tabel <strong>Siapa yang menangani</strong>. Level berlaku untuk fitur yang sedang aktif, jadi satu mobil bisa berganti level dalam satu perjalanan.</p>',
    },
  ],
  summary:
    '<p>Level SAE menjawab pertanyaan siapa yang bertanggung jawab atas tugas mengemudi.</p>' +
    '<ul><li>Level 0 sampai 2: kamu pengemudinya. Sistem hanya membantu, dan kamu harus terus memantau jalan.</li>' +
    '<li>Level 3: sistem mengemudi di dalam ODD. Kamu harus siap mengambil alih saat diminta.</li>' +
    '<li>Level 4: sistem menangani semuanya di dalam ODD, termasuk berhenti dengan aman saat tidak bisa melanjutkan.</li>' +
    '<li>Level 5: sistem mengemudi di mana saja. Level ini belum ada di pasaran.</li></ul>' +
    '<p class="note">Kereta punya skala serupa bernama <strong>GoA</strong> (<em>Grade of Automation</em>), dari GoA0 sampai GoA4, yang diatur dalam standar IEC 62290. Di GoA4 kereta berjalan tanpa petugas sama sekali di dalamnya.</p>' +
    '<p class="note">Simulasi ini disederhanakan. Hanya ada satu jalan dan satu mobil depan, sensor dianggap sempurna, dan angka seperti hitungan mundur 10 detik dipilih khusus untuk simulasi ini. Di dunia nyata, waktu dan cara pengalihan kendali ditentukan oleh regulasi dan produsen.</p>',

  styles: buildStyles(),

  mount(ctx) {
    // ---------- model ----------
    const scene = createScene();
    const { st, ego, lead } = scene;
    const N = ctx.stepCount;

    // ---------- kanvas dan loop ----------
    const labels = createLabelLayer();
    const view = ctx.createView({
      label: 'Jalan tol dua lajur dilihat dari atas dengan mobil otonom berwarna hijau toska di lajur kiri.',
      background: COLORS.ground,
    });

    const loop = ctx.createLoop({
      update(dt) {
        scene.update(dt);
        drainEvents();
        checkTasks();
      },
      render,
    });

    // ---------- panel: level ----------
    const levelGroup = ui.group(ctx.controls, { title: 'Level otomasi', className: 'grp-level' });
    const levelCtl = ui.segmented(levelGroup, {
      ariaLabel: 'Level otomasi SAE',
      options: LEVELS.map((_, n) => ({ value: n, label: String(n) })),
      value: 0,
      onChange: (n) => chooseLevel(n),
    });
    const levelInfo = ui.el('div', { class: 'lv-info' });
    levelGroup.append(levelInfo);
    const sysRow = ui.el('div', { class: 'lv-sys' });
    const sysText = ui.el('span', { class: 'lv-sys-text' });
    sysRow.append(sysText);
    levelGroup.append(sysRow);
    const engageBtn = ui.button(sysRow, { label: 'Aktifkan sistem', icon: 'play', small: true, onClick: () => engageAgain() });

    // ---------- panel: kemudi ----------
    const driveGroup = ui.group(ctx.controls, { title: 'Kemudi', className: 'grp-drive' });
    const pad = ui.buttonRow(driveGroup, { className: 'pad' });
    const holdLeft = ui.holdButton(pad, { label: 'Kiri', icon: 'arrowLeft', onChange: (on) => scene.setInput('left', on) });
    const holdGas = ui.holdButton(pad, { label: 'Gas', icon: 'arrowUp', onChange: (on) => scene.setInput('gas', on) });
    const holdBrake = ui.holdButton(pad, { label: 'Rem', icon: 'arrowDown', onChange: (on) => scene.setInput('brake', on) });
    const holdRight = ui.holdButton(pad, { label: 'Kanan', icon: 'arrowRight', onChange: (on) => scene.setInput('right', on) });
    const HOLDS = [
      [holdLeft, 'steer'],
      [holdGas, 'gas'],
      [holdBrake, 'brake'],
      [holdRight, 'steer'],
    ];
    const actRow = ui.buttonRow(driveGroup, { className: 'act-row' });
    const handBtn = ui.button(actRow, { label: 'Pegang kemudi', icon: 'hand', onClick: () => doHold() });
    handBtn.dataset.act = 'pegang';
    const takeBtn = ui.button(actRow, { label: 'Ambil alih', icon: 'steering', onClick: () => doTakeover() });
    takeBtn.dataset.act = 'ambil-alih';
    const driveHint = ui.el('p', { class: 'ctl-hint' });
    driveGroup.append(driveHint);
    driveGroup.append(
      ui.el('p', { class: 'ctl-hint', html: 'Pintasan: <kbd>P</kbd> Pegang kemudi, <kbd>A</kbd> Ambil alih, <kbd>0</kbd> sampai <kbd>5</kbd> pilih level.' }),
    );

    // ---------- panel: data ----------
    const dataGroup = ui.group(ctx.controls, { title: 'Data perjalanan', className: 'grp-data' });
    const grid = ui.readoutGrid(dataGroup);
    const speedOut = ui.readout(grid, { label: 'Kecepatan', value: '0 km/jam' });
    const gapOut = ui.readout(grid, { label: 'Jarak ke mobil depan', value: '-' });
    const accOut = ui.readout(grid, { label: 'Jarak aman sistem', value: '-' });
    const laneOut = ui.readout(grid, { label: 'Posisi', value: 'Lajur kiri' });
    ui.legend(dataGroup, [
      { color: COLORS.path, label: 'Rencana jalur sistem', shape: 'line' },
      { color: COLORS.radar, label: 'Radar ACC', shape: 'line' },
      { color: COLORS.target, label: 'Batas area operasi', shape: 'line' },
    ]);

    // ---------- panel: tabel tanggung jawab ----------
    const respGroup = ui.group(ctx.controls, { title: 'Siapa yang menangani', wide: true, className: 'grp-resp' });
    const pill = (key) => `<span class="pill pill-${PILLS[key][1]}">${PILLS[key][0]}</span>`;
    const respTable = ui.dataTable(respGroup, {
      caption: 'Pembagian tugas mengemudi antara kamu dan sistem di tiap level SAE',
      columns: [
        { key: 'task', label: 'Tugas mengemudi', className: 'c-task' },
        ...LEVELS.map((lv, n) => ({
          key: `l${n}`,
          html: `<span class="lv-th"><b>Level ${n}</b><small>${lv.name}</small></span>`,
          align: 'center',
          className: `c${n}`,
        })),
      ],
      rows: [
        ...RESP_ROWS.map((r) => ({ task: r.task, ...Object.fromEntries(r.cells.map((c, n) => [`l${n}`, { html: pill(c) }])) })),
        { _class: 'row-ex', task: 'Contoh', ...Object.fromEntries(EXAMPLES.map((e, n) => [`l${n}`, e])) },
      ],
    });
    respTable.table.classList.add('resp-table');
    respGroup.append(ui.el('p', { class: 'ctl-hint', text: 'Kolom yang disorot adalah level yang sedang kamu pilih. ODD adalah kondisi tempat sistem dirancang bekerja.' }));

    // ---------- HUD dan kotak peringatan di atas kanvas ----------
    const chipLevel = ui.hudChip(ctx.hud, { label: 'Level', color: COLORS.accent });
    const chipDriver = ui.hudChip(ctx.hud, { label: 'Kendali', color: COLORS.warn });
    const chipSpeed = ui.hudChip(ctx.hud, { label: 'Kecepatan', color: COLORS.text });
    const chipInfo = ui.hudChip(ctx.hud, { label: '', color: COLORS.target });
    const chipInfoLabel = ui.el('span', { class: 'hud-label' });
    chipInfo.el.insertBefore(chipInfoLabel, chipInfo.el.firstChild);

    const alertEl = ui.el('div', { class: 'lvl-alert', hidden: true });
    alertEl.innerHTML =
      '<span class="lvl-alert-icon"></span><div class="lvl-alert-body"><strong class="lvl-alert-title"></strong><span class="lvl-alert-text"></span></div><span class="lvl-alert-count" aria-hidden="true"></span>';
    const alertBtn = ui.button(alertEl, { label: 'Ambil alih', variant: 'primary', small: true, onClick: () => alertAction() });
    alertBtn.dataset.act = 'alert-action';
    ctx.stage.append(alertEl);
    const alertIcon = alertEl.querySelector('.lvl-alert-icon');
    const alertTitle = alertEl.querySelector('.lvl-alert-title');
    const alertText = alertEl.querySelector('.lvl-alert-text');
    const alertCount = alertEl.querySelector('.lvl-alert-count');
    let shownAlert = null;

    // ---------- masukan ----------
    const keyHold = (btn, kind) => ({
      down: () => {
        if (scene.controlsFor()[kind]) btn.setActive(true);
      },
      up: () => btn.setActive(false),
    });
    const levelKey = (n) => () => {
      // Sama seperti klik: memilih level yang sudah aktif tidak mengulang sistemnya (misalnya saat
      // permintaan ambil alih sedang berjalan). Bila sistemnya mati, tombol angka berfungsi seperti Aktifkan.
      if (st.level === n) {
        if (n > 0 && !st.engaged) engageAgain();
        return;
      }
      levelCtl.set(n);
      chooseLevel(n);
    };
    ctx.keys({
      ArrowLeft: keyHold(holdLeft, 'steer'),
      ArrowRight: keyHold(holdRight, 'steer'),
      ArrowUp: keyHold(holdGas, 'gas'),
      ArrowDown: keyHold(holdBrake, 'brake'),
      p: () => doHold(),
      a: () => doTakeover(),
      0: levelKey(0),
      1: levelKey(1),
      2: levelKey(2),
      3: levelKey(3),
      4: levelKey(4),
      5: levelKey(5),
    });
    // Tombol segmen yang diklik dengan mouse atau jari tetap memegang fokus, sehingga tombol panah
    // mengganti pilihan (level atau kecepatan) alih-alih menyetir. Lepas fokus hanya untuk klik
    // penunjuk; pengguna keyboard tetap bisa berpindah pilihan dengan panah.
    ctx.listen(ctx.root, 'click', (e) => {
      const b = e.target.closest?.('.seg-btn');
      if (b && e.detail > 0) b.blur();
    });

    // ---------- aksi ----------
    function releaseHolds() {
      for (const [b] of HOLDS) b.setActive(false);
    }

    function chooseLevel(n) {
      scene.setLevel(n);
      refreshPanels();
    }

    function engageAgain() {
      scene.engage();
      refreshPanels();
    }

    function doHold() {
      scene.pressHold();
      drainEvents();
      refreshPanels();
    }

    function doTakeover() {
      scene.pressTakeover();
      drainEvents();
      refreshPanels();
    }

    function alertAction() {
      const a = shownAlert;
      if (!a) return;
      if (a.action === 'takeover') doTakeover();
      else if (a.action === 'hold') doHold();
      else if (a.action === 'engage') engageAgain();
    }

    // ---------- tugas ----------
    function drainEvents() {
      if (!st.events.length) return;
      for (const e of st.events.splice(0)) {
        if (e === 'l2-answered') ctx.completeTask('l2-attention');
        else if (e === 'takeover-tor') ctx.completeTask('l3-takeover');
      }
    }

    function checkTasks() {
      const taskId = ctx.lesson.steps[ctx.currentStep()]?.taskId;
      if (!taskId || ctx.isTaskDone(taskId)) return;
      const c = st.counters;
      if (taskId === 'l0-manual' && c.manualDist >= MANUAL_DIST) ctx.completeTask(taskId);
      else if (taskId === 'l1-acc' && c.accFollow >= 5) ctx.completeTask(taskId);
      else if (taskId === 'l4-mrm' && c.mrcHold >= 0.6) ctx.completeTask(taskId);
    }

    // ---------- teks keadaan ----------
    const kmh = (v) => fmt(msToKmh(Math.max(0, v)), 0, 'km/jam');

    function leadGap() {
      if (!lead.active) return null;
      return lead.s - lead.length / 2 - (st.egoS + scene.EGO_HL);
    }

    function driverLabel() {
      const L = st.level;
      if (L === 0 || !st.engaged) return { text: 'Kamu', color: COLORS.warn, tone: '' };
      if (L === 1) return { text: 'Kamu dan ACC', color: COLORS.warn, tone: '' };
      if (L === 2) return { text: 'Sistem, kamu mengawasi', color: COLORS.warn, tone: st.attention.stage === 'ok' ? '' : 'warn' };
      if (L === 3 && st.ads.phase === 'tor') return { text: 'Minta ambil alih', color: COLORS.danger, tone: 'danger' };
      if (L === 3 && st.ads.phase !== 'drive') return { text: 'Sistem, berhenti darurat', color: COLORS.danger, tone: 'danger' };
      return { text: 'Sistem', color: COLORS.accent, tone: '' };
    }

    function statusText() {
      const L = st.level;
      const v = kmh(ego.speed);
      const step = ctx.currentStep();
      const ev = scene.oddEventAhead();
      const evText = ev && ev.dist > 0 && ev.dist < 450 ? ` ${ev.kind === 'zona' ? 'Zona konstruksi' : 'Batas area operasi'} ${fmt(ev.dist, 0)} m lagi.` : '';
      if (L === 0) {
        let t = `Level 0: kamu mengemudi penuh, ${v}.`;
        if (step === 0 && !ctx.isTaskDone('l0-manual')) t += ` Sudah ${fmt(Math.min(st.counters.manualDist, MANUAL_DIST), 0)} dari 150 m.`;
        if (ego.speed < 0.3) t += ' Tahan Gas untuk berjalan.';
        return t;
      }
      if (!st.engaged) return `Level ${L} dipilih, tetapi sistemnya mati. Kamu yang mengemudi, ${v}.${L >= 1 ? ' Tekan Aktifkan untuk menyalakannya.' : ''}`;
      if (L === 1) {
        let t =
          st.acc.mode === 'follow'
            ? `Level 1: ACC menjaga jarak ${fmt(st.acc.gap, 0)} m di belakang mobil depan, ${v}. Kamu yang menyetir.`
            : `Level 1: ACC menjaga kecepatan ${v}. Kamu yang menyetir.`;
        if (step === 1 && !ctx.isTaskDone('l1-acc') && st.acc.mode === 'follow') t += ` Sudah ${fmt(Math.min(st.counters.accFollow, 5), 0)} dari 5 detik.`;
        return t;
      }
      if (L === 2) {
        if (st.attention.stage === 'warn') return 'Level 2: kamu tidak merespons. Sistem memperlambat mobil. Tekan Pegang kemudi.';
        if (st.attention.stage === 'prompt') return 'Level 2: sistem meminta kamu memegang kemudi. Tekan Pegang kemudi.';
        return `Level 2: sistem menyetir dan mengatur kecepatan, ${v}. Kamu tetap mengawasi jalan.`;
      }
      if (L === 3) {
        const ph = st.ads.phase;
        if (ph === 'tor') return `Level 3: permintaan ambil alih, sisa ${fmt(Math.ceil(st.ads.left), 0)} detik. Tekan Ambil alih.`;
        if (ph === 'mrm') return 'Level 3: tidak ada respons. Sistem melambat dan berhenti di lajur dengan lampu hazard.';
        if (ph === 'mrc') {
          if (step === 3 && !ctx.isTaskDone('l3-takeover')) return 'Level 3: mobil berhenti di lajur. Tekan Ulangi untuk mencoba lagi, atau Ambil alih untuk mengemudi sendiri.';
          return 'Level 3: mobil berhenti di lajur. Tekan Ambil alih untuk mengemudi sendiri.';
        }
        return `Level 3: sistem mengemudi dan memantau jalan, ${v}.${evText}`;
      }
      if (L === 4) {
        const ph = st.ads.phase;
        if (ph === 'mrm') return 'Level 4: batas area operasi di depan. Sistem menepi ke bahu jalan kiri dan berhenti sendiri.';
        if (ph === 'mrc') return 'Level 4: mobil berhenti aman di bahu jalan dengan lampu hazard. Tidak ada yang perlu mengambil alih.';
        return `Level 4: sistem mengemudi sendiri, ${v}.${evText}`;
      }
      const passed = st.boundary && st.egoS + scene.EGO_HL > st.boundary.s && st.egoS < st.boundary.s + 120;
      return `Level 5: sistem mengemudi sendiri, ${v}.${passed ? ' Batas area operasi tidak menghentikannya.' : evText}`;
    }

    // ---------- kotak peringatan ----------
    function currentAlert() {
      const L = st.level;
      const fk = scene.flashKey();
      const ph = st.ads.phase;
      if (fk === 'crash') return { key: 'crash', tone: 'danger', icon: 'alert', title: 'Tabrakan', text: 'Mobil menabrak mobil depan. Rem lebih awal.' };
      if (fk === 'crash-zone') return { key: 'crash-zone', tone: 'danger', icon: 'alert', title: 'Tabrakan', text: 'Mobil menabrak zona konstruksi. Pindah lajur lebih awal.' };
      if (fk === 'offroad') return { key: 'offroad', tone: 'warn', icon: 'alert', title: 'Mobil keluar jalan', text: 'Posisi dikembalikan ke lajur. Setir pelan mengikuti tikungan.' };
      if (st.aeb.active || fk === 'aeb') {
        return { key: 'aeb', tone: 'danger', icon: 'alert', title: 'Rem darurat otomatis', text: 'Mengerem sesaat agar tidak menabrak. Ini tidak menaikkan level.' };
      }
      if (st.engaged && L === 3 && ph === 'tor') {
        return {
          key: 'tor',
          tone: 'danger',
          pulse: true,
          icon: 'steering',
          title: 'Ambil alih kemudi',
          text: st.ads.reason === 'zona' ? 'Zona konstruksi di depan, di luar ODD sistem.' : 'Batas area operasi sistem ada di depan.',
          count: fmt(Math.ceil(st.ads.left), 0),
          action: 'takeover',
        };
      }
      if (st.engaged && L === 3 && ph === 'mrm') {
        return { key: 'l3-mrm', tone: 'danger', icon: 'alert', title: 'Tidak ada respons', text: 'Sistem melambat dan berhenti di lajur dengan lampu hazard.', action: 'takeover' };
      }
      if (st.engaged && L === 3 && ph === 'mrc') {
        return { key: 'l3-mrc', tone: 'danger', icon: 'alert', title: 'Mobil berhenti di lajur', text: 'Di level 3 kamu seharusnya mengambil alih saat diminta.', action: 'takeover' };
      }
      if (st.engaged && L === 2 && st.attention.stage === 'warn') {
        return {
          key: 'l2-warn',
          tone: 'danger',
          pulse: true,
          icon: 'hand',
          title: 'Pegang kemudi sekarang',
          text: 'Sistem memperlambat mobil. Setelah ini kemudi diserahkan.',
          count: fmt(Math.max(1, Math.ceil(4 - st.attention.timer)), 0),
          action: 'hold',
        };
      }
      if (st.engaged && L === 2 && st.attention.stage === 'prompt') {
        return { key: 'l2-prompt', tone: 'warn', icon: 'hand', title: 'Pegang kemudi', text: 'Level 2 butuh pengawasanmu. Tunjukkan tanganmu di setir.', action: 'hold' };
      }
      if (fk === 'l2-thanks') return { key: 'l2-thanks', tone: 'ok', icon: 'check', title: 'Tangan di setir', text: 'Sistem level 2 tetap aktif. Terus awasi jalan.' };
      if (fk === 'l2-handback') return { key: 'l2-handback', tone: 'warn', icon: 'alert', title: 'Sistem level 2 mati', text: 'Kamu tidak merespons, jadi kemudi diserahkan kepadamu.', action: 'engage' };
      if (fk === 'l2-zone') return { key: 'l2-zone', tone: 'warn', icon: 'alert', title: 'Level 2 menyerahkan kemudi', text: 'Zona konstruksi di luar kemampuan sistem. Kamu yang menyetir.' };
      if (fk === 'brake-cancel') return { key: 'brake-cancel', tone: 'info', icon: 'info', title: 'Sistem mati karena kamu mengerem', text: 'Menginjak rem selalu mengembalikan kendali kepadamu.', action: 'engage' };
      if (fk === 'l3-refuse') return { key: 'l3-refuse', tone: 'warn', icon: 'alert', title: 'Level 3 belum bisa aktif', text: 'Kejadian di luar ODD terlalu dekat. Kamu mengemudi dulu.' };
      if (fk === 'odd-outside') return { key: 'odd-outside', tone: 'warn', icon: 'alert', title: `Level ${L} tidak bisa aktif`, text: 'Mobil sudah di luar area operasi sistem.' };
      if (fk === 'l3-taken') {
        return { key: 'l3-taken', tone: 'ok', icon: 'check', title: 'Kamu mengemudi', text: st.zone ? 'Pindah ke lajur kanan untuk melewati zona konstruksi.' : 'Sistem level 3 mati sampai kamu mengaktifkannya lagi.' };
      }
      if (fk === 'l3-taken-free') return { key: 'l3-taken-free', tone: 'info', icon: 'info', title: 'Kamu mengambil alih', text: 'Pengemudi level 3 boleh mengambil alih kapan saja.' };
      if (st.fcw) return { key: 'fcw', tone: 'danger', icon: 'alert', title: 'Awas tabrakan depan', text: 'Rem sekarang. Di level ini kamu yang harus bereaksi.' };
      if (st.ldw != null) return { key: 'ldw', tone: 'warn', icon: 'alert', title: 'Keluar lajur', text: 'Sistem hanya memperingatkan. Kamu yang menyetir kembali.' };
      if (st.engaged && L === 4 && ph === 'mrm') return { key: 'l4-mrm', tone: 'info', icon: 'info', title: 'Manuver risiko minimal', text: 'Batas area operasi di depan. Sistem menepi sendiri.' };
      if (st.engaged && L === 4 && ph === 'mrc') return { key: 'l4-mrc', tone: 'ok', icon: 'check', title: 'Berhenti aman di bahu jalan', text: 'Tidak ada yang perlu mengambil alih. Coba pilih level 5.' };
      const b = st.boundary;
      if (st.engaged && L === 5 && b && st.egoS > b.s - 90 && st.egoS < b.s + 50) {
        return { key: 'l5-pass', tone: 'info', icon: 'info', title: 'Level 5 terus berjalan', text: 'ODD level 5 tidak terbatas, jadi batas ini tidak berlaku.' };
      }
      const z = st.zone;
      if (st.engaged && L >= 4 && z && st.egoS > z.s0 - 130 && st.egoS < z.s1) {
        return { key: 'l45-zone', tone: 'info', icon: 'info', title: 'Sistem melewati zona konstruksi', text: 'Sistem pindah ke lajur kanan dan melambat sendiri.' };
      }
      return null;
    }

    function actionLabel(a) {
      if (a.action === 'takeover') return 'Ambil alih';
      if (a.action === 'hold') return 'Pegang kemudi';
      if (a.action === 'engage') return `Aktifkan level ${st.level}`;
      return '';
    }

    function paintAlert() {
      const a = currentAlert();
      if (!a) {
        if (shownAlert) {
          alertEl.hidden = true;
          shownAlert = null;
        }
        return;
      }
      if (!shownAlert || shownAlert.key !== a.key) {
        alertEl.hidden = false;
        alertEl.dataset.tone = a.tone;
        alertEl.style.setProperty('--tone', TONE_COLORS[a.tone]);
        alertEl.classList.toggle('is-pulse', !!a.pulse);
        alertIcon.innerHTML = icon(a.icon || 'info');
        alertTitle.textContent = a.title;
        alertText.textContent = a.text;
        alertBtn.hidden = !a.action;
        alertBtn.querySelector('.btn-label').textContent = actionLabel(a);
      }
      alertCount.hidden = a.count == null;
      if (a.count != null && alertCount.textContent !== a.count) alertCount.textContent = a.count;
      shownAlert = a;
    }

    // ---------- pembaruan panel (dari render, sekitar 8 kali per detik) ----------
    let lastPanel = 0;
    let lastLabel = '';
    function refreshPanels() {
      const L = st.level;
      if (levelCtl.value !== L) levelCtl.set(L);
      const lv = LEVELS[L];
      const infoHtml = `<p class="lv-name"><span class="lv-num">${L}</span><span>${lv.name}</span></p><p class="lv-desc">${lv.desc}</p>`;
      if (levelInfo.innerHTML !== infoHtml) levelInfo.innerHTML = infoHtml;
      respTable.table.dataset.sel = String(L);

      // status sistem dan tombol aktifkan
      let sys;
      if (L === 0) sys = 'Tidak ada sistem yang mengemudi.';
      else if (st.engaged) sys = L === 1 ? 'ACC <strong>aktif</strong>.' : 'Sistem <strong>aktif</strong>.';
      else sys = 'Sistem <strong>mati</strong>. Kamu yang mengemudi.';
      if (sysText.innerHTML !== sys) sysText.innerHTML = sys;
      engageBtn.hidden = L === 0 || st.engaged;
      engageBtn.querySelector('.btn-label').textContent = `Aktifkan level ${L}`;

      // tombol kemudi: yang dipegang sistem dibuat pudar
      const cf = scene.controlsFor();
      for (const [b, kind] of HOLDS) {
        const allowed = cf[kind];
        if (!allowed && b.active) b.setActive(false);
        b.el.disabled = !allowed;
      }
      handBtn.disabled = !cf.hold;
      takeBtn.disabled = !cf.takeover;
      handBtn.classList.toggle('is-asked', cf.hold && st.attention.stage !== 'ok');
      takeBtn.classList.toggle('is-asked', cf.takeover && st.ads.phase !== 'drive');
      let hint;
      if (L === 0 || !st.engaged) hint = 'Kamu memegang semua kendali. Tahan tombolnya, atau pakai <kbd>←</kbd> <kbd>↑</kbd> <kbd>↓</kbd> <kbd>→</kbd>.';
      else if (L === 1) hint = 'ACC memegang gas dan rem, kamu menyetir dengan <kbd>←</kbd> dan <kbd>→</kbd>. Rem mematikan ACC.';
      else if (L === 2) hint = 'Sistem menyetir, tetapi kamu boleh menyetir sendiri kapan saja. Rem mematikan sistem.';
      else if (L === 3) hint = 'Sistem memegang kemudi, gas, dan rem. Kamu hanya perlu siap menekan Ambil alih.';
      else hint = 'Sistem memegang semua kendali. Tidak ada yang perlu siap mengambil alih.';
      if (driveHint.innerHTML !== hint) driveHint.innerHTML = hint;

      // readout
      speedOut.set(kmh(ego.speed));
      const gap = leadGap();
      if (gap == null) {
        gapOut.set('tidak ada');
        gapOut.setTone('off');
      } else if (gap < -2) {
        gapOut.set('di belakangmu');
        gapOut.setTone('off');
      } else {
        const sameLane = Math.abs(lead.d - st.egoD) < 2;
        gapOut.set(`${fmt(Math.max(0, gap), 0, 'm')}${sameLane ? '' : ' (lajur lain)'}`);
        gapOut.setTone(st.fcw ? 'danger' : '');
      }
      if (!st.engaged) {
        accOut.set('mati');
        accOut.setTone('off');
      } else if (st.acc.mode === 'follow') {
        accOut.set(fmt(st.acc.want, 0, 'm'));
        accOut.setTone('ok');
      } else {
        accOut.set('bebas');
        accOut.setTone('');
      }
      laneOut.set(st.egoD > EDGE_LEFT ? 'Bahu jalan' : st.egoD >= 0 ? 'Lajur kiri' : 'Lajur kanan');

      // HUD
      chipLevel.set(String(L));
      const drv = driverLabel();
      chipDriver.set(drv.text);
      chipDriver.setTone(drv.tone);
      chipDriver.el.style.setProperty('--tone', drv.color);
      chipSpeed.set(kmh(ego.speed));
      let info = null;
      const ev = scene.oddEventAhead();
      if (ctx.currentStep() === 0 && L === 0 && !ctx.isTaskDone('l0-manual')) {
        info = ['Jarak manual', `${fmt(Math.min(st.counters.manualDist, MANUAL_DIST), 0)} dari 150 m`, COLORS.accent];
      } else if (ev && ev.dist > 0 && ev.dist < 450) {
        info = ev.kind === 'zona' ? ['Zona konstruksi', fmt(ev.dist, 0, 'm'), '#fdba74'] : ['Batas area operasi', fmt(ev.dist, 0, 'm'), COLORS.target];
      }
      chipInfo.show(!!info);
      if (info) {
        if (chipInfoLabel.textContent !== info[0]) chipInfoLabel.textContent = info[0];
        chipInfo.set(info[1]);
        chipInfo.el.style.setProperty('--tone', info[2]);
      }

      paintAlert();
      ctx.setStatus(statusText());
      drainEvents();

      const pos = st.egoD > EDGE_LEFT ? 'di bahu jalan kiri' : st.egoD >= 0 ? 'di lajur kiri' : 'di lajur kanan';
      const label = `Jalan tol dua lajur dilihat dari atas. Mobil otonom berwarna hijau toska ${pos}. Level ${L}, yang mengemudi: ${drv.text.toLowerCase()}.`;
      if (label !== lastLabel) {
        lastLabel = label;
        view.setLabel(label);
      }
    }

    // ---------- kamera dan menggambar ----------
    function updateCamera() {
      const narrow = view.aspect < 1.4;
      let scale = view.width / (narrow ? 58 : 90);
      scale = Math.min(scale, view.height / 34);
      view.setScale(scale);
      const vw = view.width / scale;
      const ahead = (0.5 - (narrow ? 0.26 : 0.3)) * vw;
      // kamera mengikuti jalan, bukan goyangan setir, supaya gambar tenang
      const c = scene.road.toWorld(st.egoS + ahead, -1.75);
      view.centerOn(c.x, c.y);
    }

    function render() {
      updateCamera();
      const g = view.begin(COLORS.ground);
      scene.draw(g, view, labels, { time: st.t });
      labels.draw(g, view);
      drawScaleBar(g, view);
      const now = performance.now();
      if (now - lastPanel > 120) {
        lastPanel = now;
        refreshPanels();
      }
    }

    function applyStep(i, level) {
      const p = PRESETS[clamp(i, 0, N - 1)];
      releaseHolds();
      scene.applyPreset(level == null ? p : { ...p, level });
      levelCtl.set(st.level);
      shownAlert = null;
      alertEl.hidden = true;
      refreshPanels();
    }

    // ---------- antarmuka ke shell ----------
    return {
      onStep(i) {
        applyStep(i);
      },
      reset() {
        // ulangi skenario langkah ini, dengan level yang sedang dipilih pelajar
        applyStep(ctx.currentStep(), st.level);
        loop.resetTime();
      },
      destroy() {
        // Kanvas, loop, keyboard, dan listener dibersihkan otomatis oleh ctx.
      },
    };
  },
};

function buildStyles() {
  const P = '.lesson-level-otomasi';
  const sel = [0, 1, 2, 3, 4, 5]
    .map(
      (n) =>
        `${P} .resp-table[data-sel="${n}"] td.c${n}, ${P} .resp-table[data-sel="${n}"] th.c${n} { background: rgba(45, 212, 191, 0.08); }\n` +
        `${P} .resp-table[data-sel="${n}"] thead th.c${n} { background: rgba(45, 212, 191, 0.16); box-shadow: inset 0 -2px 0 var(--accent); }\n` +
        `${P} .resp-table[data-sel="${n}"] thead th.c${n} b { color: var(--accent); }`,
    )
    .join('\n');
  const hide = [0, 1, 2, 3, 4, 5].map((n) => `${P} .resp-table:not([data-sel="${n}"]) .c${n} { display: none; }`).join('\n');
  return `
    ${P} .lvl-alert { --tone: var(--accent); position: absolute; left: 50%; bottom: 46px; z-index: 3; display: flex; align-items: center; gap: 12px;
      width: max-content; max-width: min(640px, calc(100% - 24px)); padding: 10px 12px 10px 12px; transform: translateX(-50%);
      border: 1px solid color-mix(in srgb, var(--tone) 55%, transparent); border-radius: 14px; background: rgba(11, 18, 32, 0.92);
      backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); box-shadow: var(--shadow); }
    ${P} .lvl-alert[hidden] { display: none; }
    ${P} .lvl-alert-icon { flex: none; display: grid; place-items: center; width: 36px; height: 36px; border-radius: 10px; font-size: 1.2rem;
      background: color-mix(in srgb, var(--tone) 18%, transparent); color: var(--tone); }
    ${P} .lvl-alert-body { display: flex; flex-direction: column; min-width: 0; line-height: 1.3; }
    ${P} .lvl-alert-title { color: var(--text); font-size: 0.95rem; }
    ${P} .lvl-alert-text { color: var(--text-soft); font-size: 0.84rem; }
    ${P} .lvl-alert-count { flex: none; min-width: 2ch; color: var(--tone); font-family: var(--mono); font-size: 1.6rem; font-weight: 800; text-align: center; }
    ${P} .lvl-alert-count[hidden], ${P} .lvl-alert .btn[hidden] { display: none; }
    ${P} .lvl-alert .btn { flex: none; }
    ${P} .lvl-alert.is-pulse { animation: lvl-otomasi-pulse 1s ease-in-out infinite; }
    @keyframes lvl-otomasi-pulse { 50% { box-shadow: 0 0 0 5px color-mix(in srgb, var(--tone) 35%, transparent), var(--shadow); } }

    ${P} .grp-level .seg-btn { min-height: 40px; font-family: var(--mono); font-size: 1rem; }
    ${P} .lv-info { display: flex; flex-direction: column; gap: 4px; }
    ${P} .lv-name { display: flex; align-items: center; gap: 10px; font-weight: 700; }
    ${P} .lv-num { display: inline-grid; place-items: center; min-width: 30px; height: 30px; border-radius: 9px; background: var(--accent-soft);
      color: var(--accent); font-family: var(--mono); font-weight: 800; }
    ${P} .lv-desc { color: var(--text-soft); font-size: 0.88rem; }
    ${P} .lv-sys { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; min-height: 40px; padding-top: 10px;
      border-top: 1px solid var(--border); font-size: 0.86rem; }
    ${P} .lv-sys-text { color: var(--muted); }
    ${P} .lv-sys-text strong { color: var(--text); }
    ${P} .lv-sys .btn[hidden] { display: none; }

    ${P} .pad { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
    ${P} .pad .btn { flex-direction: column; gap: 3px; min-height: 58px; padding: 6px 4px; font-size: 0.84rem; }
    ${P} .pad .btn .icon { font-size: 1.2rem; }
    ${P} .act-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
    ${P} .act-row .btn { min-height: 44px; padding: 0 8px; gap: 6px; font-size: 0.86rem; }
    ${P} .act-row .btn.is-asked { border-color: var(--warn); background: rgba(245, 158, 11, 0.16); color: #fcd34d; }

    ${P} .grp-resp .data-table-wrap { overflow-x: auto; }
    ${P} .resp-table th, ${P} .resp-table td { white-space: normal; }
    ${P} .resp-table thead th { text-align: center; vertical-align: bottom; }
    ${P} .resp-table thead th.c-task { text-align: left; }
    ${P} .resp-table tbody th { min-width: 150px; font-size: 0.84rem; }
    ${P} .lv-th { display: flex; flex-direction: column; align-items: center; gap: 1px; line-height: 1.2; }
    ${P} .lv-th b { color: var(--text-soft); font-size: 0.8rem; letter-spacing: 0; text-transform: none; }
    ${P} .lv-th small { color: var(--muted); font-size: 0.7rem; font-weight: 600; letter-spacing: 0; text-transform: none; }
    ${P} .pill { display: inline-block; padding: 3px 9px; border-radius: 999px; font-size: 0.78rem; font-weight: 700; line-height: 1.25; }
    ${P} .pill-you { background: rgba(245, 158, 11, 0.14); color: #fcd34d; }
    ${P} .pill-sys { background: rgba(45, 212, 191, 0.14); color: var(--accent); }
    ${P} .pill-mix { background: linear-gradient(90deg, rgba(245, 158, 11, 0.18), rgba(45, 212, 191, 0.18)); color: var(--text); }
    ${P} .pill-lim { background: rgba(148, 163, 184, 0.14); color: var(--text-soft); }
    ${P} .pill-na { border: 1px dashed var(--border-strong); color: var(--muted); }
    ${P} .row-ex > * { color: var(--muted); font-size: 0.78rem; }
    ${sel}

    @media (prefers-reduced-motion: reduce) {
      ${P} .lvl-alert.is-pulse { animation: none; }
    }
    @media (max-width: 600px) {
      ${P} .grp-drive { order: -1; }
      ${P} .lvl-alert { left: 8px; right: 8px; bottom: 38px; gap: 8px; width: auto; max-width: none; padding: 8px 8px 8px 10px; transform: none; }
      ${P} .lvl-alert-icon { display: none; }
      ${P} .lvl-alert-title { font-size: 0.86rem; }
      ${P} .lvl-alert-text { display: -webkit-box; overflow: hidden; font-size: 0.76rem; -webkit-box-orient: vertical; -webkit-line-clamp: 3; line-clamp: 3; }
      ${P} .lvl-alert-count { font-size: 1.3rem; }
      ${P} .lvl-alert-body { flex: 1; }
      ${hide}
      ${P} .resp-table tbody th { min-width: 0; }
    }
  `;
}
