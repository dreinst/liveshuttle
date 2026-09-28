// Pelajaran 7: Pengambilan Keputusan, di Jalan Kawi, Malang.
//
// Struktur mengikuti pelajaran contoh (sensor.js):
//   ./keputusan/scene.js     tempat kejadian dari data OpenStreetMap (Jalan Kawi, simpang berlampu, penyeberangan)
//   ./keputusan/world.js     lampu, lalu lintas lain (angkot, sepeda motor, mobil), pejalan kaki, angkot ngetem
//   ./keputusan/shield.js    perisai keselamatan untuk setiap kendaraan dan pencatat pelanggaran
//   ./keputusan/planner.js   mesin keadaan mobil otonom, keputusan, dan perintah kecepatan/setir
//   ./keputusan/render.js    gambar Jalan Kawi, marka, lampu, dan pelaku
//   ./keputusan/overlays.js  gambar bantu di atas jalan
//   ./keputusan/diagram.js   diagram mesin keadaan di bagian bawah kanvas
// File ini berisi teks pelajaran, panel kontrol, log keputusan, deteksi tugas, dan perekat.

import { COLORS } from '../engine/theme.js';
import { clamp, fmt, fmtSpeed, kmhToMs, msToKmh } from '../engine/math.js';
import { createLabelLayer, drawCar, drawScaleBar } from '../engine/draw.js';
import { createMapRenderer } from '../engine/osm2d.js';
import { icon } from '../engine/icons.js';
import * as ui from '../engine/ui.js';
import { fetchSceneJson, buildScene, ROAD_HALF, WALK } from './keputusan/scene.js';
import { createWorld, RANGE_FAR } from './keputusan/world.js';
import { createPlanner, A_COMFORT, V_MIN_KMH, V_MAX_KMH } from './keputusan/planner.js';
import { STATES, drawDiagram, diagramHeight } from './keputusan/diagram.js';
import { drawOverlays, LIGHT_COLOR } from './keputusan/overlays.js';
import { createSceneArt, drawNorthArrow } from './keputusan/render.js';

const LIGHT_WORD = { red: 'Merah', yellow: 'Kuning', green: 'Hijau' };
const DENSITY_OPTIONS = [
  { value: 'kosong', label: 'Kosong' },
  { value: 'sepi', label: 'Sepi' },
  { value: 'sedang', label: 'Sedang' },
  { value: 'padat', label: 'Padat' },
];
const MAX_LOG = 40;
// event perencana yang menyelesaikan tugas langkah
const EVENT_TASK = { 'kuning-selesai': 'yellow-decision', 'yield-selesai': 'yield-ped', 'salip-selesai': 'overtake' };

// Preset tiap langkah. start: 'awal' = awal ruas (tepat setelah tepi data di barat),
// 'zebra' = 140 m sebelum zebra cross, 'simpang' = tepat setelah simpang berlampu.
const STEP_PRESETS = [
  { light: 'hijau', angkot: false, density: 'sepi', start: 'awal' },
  { light: 'hijau', angkot: false, density: 'sepi', start: 'zebra' },
  { light: 'hijau', angkot: false, density: 'sepi', start: 'awal' },
  { light: 'hijau', angkot: false, density: 'sedang', start: 'simpang' },
  { light: 'otomatis', angkot: true, density: 'sedang', start: 'awal' },
];

const SHIELD_TEXT = {
  'tahan-kuning': 'Perisai keselamatan menahan kecepatan. Mobil sudah memutuskan terus saat kuning, jadi tidak boleh melambat sebelum melewati garis henti.',
  'lampu merah': 'Perisai keselamatan ikut mengerem karena garis henti lampu merah sudah dekat.',
  'lampu kuning': 'Perisai keselamatan ikut mengerem karena mobil wajib berhenti di lampu kuning ini.',
  'penyeberangan dipakai': 'Perisai keselamatan ikut mengerem karena penyeberangan di depan sedang dipakai.',
  'pejalan kaki': 'Perisai keselamatan ikut mengerem karena ada pejalan kaki di depan mobil.',
  'angkot ngetem': 'Perisai keselamatan ikut mengerem karena angkot di depan terlalu dekat.',
  'simpang belum kosong': 'Perisai keselamatan menahan mobil karena simpang belum kosong.',
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export default {
  id: 'keputusan',
  title: 'Pengambilan Keputusan',
  layout: 'sim',
  intro:
    '<p>Setelah tahu apa yang ada di sekitarnya, mobil otonom harus memilih tindakan: tetap melaju, berhenti, memberi jalan, atau menyalip. Bagian ini disebut <strong>perencanaan perilaku</strong>. Di bawah peta ada diagram <strong>mesin keadaan</strong> (state machine) yang menunjukkan pilihan mobil saat ini.</p>' +
    '<p>Simulasinya ada di Jalan Kawi, Malang, di simpang berlampu dengan Jalan Kelud dan Jalan Arjuno. Letak jalan, lampu, penyeberangan, dan gedung diambil dari data OpenStreetMap. Supaya fokus pada keputusan, persepsi di sini dianggap sempurna. Dalam jarak 80 m mobil tahu posisi dan jenis setiap objek dengan tepat.</p>',
  steps: [
    {
      title: 'Berhenti di lampu merah',
      body:
        '<p>Mobil otonom selalu berada di satu <strong>keadaan</strong>, misalnya MELAJU. Keadaan hanya berganti kalau syaratnya terpenuhi, dan setiap pergantian dicatat di <strong>Log keputusan</strong> bersama alasannya.</p>' +
        '<p>Saat melihat lampu merah, mobil menghitung kapan harus mulai mengerem supaya bisa berhenti di belakang garis henti dengan perlambatan sekitar 2 m/s². Begitu saatnya tiba, keadaannya pindah ke BERHENTI DI LAMPU. Setelah lampu hijau, mobil kembali MELAJU.</p>' +
        '<p class="note">Keempat lampu di simpang ini tercatat di data OSM. Lama tiap warnanya buatan simulasi. Lampu sekarang diatur ke <strong>Paksa hijau</strong>, jadi kamu yang menentukan kapan merah. Seperti lampu sungguhan, lampu selalu kuning 3 detik dulu sebelum merah.</p>',
      task: { id: 'red-stop', text: 'Pilih <strong>Paksa merah</strong> di panel Lampu lalu lintas, lalu tunggu sampai mobil berhenti di belakang garis henti.' },
    },
    {
      title: 'Memberi jalan di zebra cross',
      body:
        '<p>Sekitar 85 m di timur simpang ada zebra cross tanpa lampu. Di zebra cross, pejalan kaki didahulukan. UU Nomor 22 Tahun 2009 Pasal 106 ayat (2) mewajibkan pengemudi kendaraan bermotor mengutamakan keselamatan pejalan kaki dan pesepeda. Mobil tanpa pengemudi juga perlu mengikuti aturan ini.</p>' +
        '<p>Kalau ada pejalan kaki yang menunggu atau sedang menyeberang, mobil pindah ke MEMBERI JALAN, melambat, lalu berhenti di garis sebelum zebra cross. Mobil baru jalan lagi setelah pejalan kaki sampai di trotoar seberang.</p>' +
        '<p class="note">Pejalan kaki hanya muncul kalau mobil otonom masih bisa berhenti dengan nyaman. Kalau mobil sudah terlalu dekat, permintaanmu ditunda sampai mobil datang lagi dari awal ruas. Pejalan kaki juga baru melangkah kalau semua kendaraan yang datang, termasuk dari arah berlawanan, masih sempat berhenti.</p>',
      task: { id: 'yield-ped', text: 'Tekan <strong>Munculkan pejalan kaki</strong> (atau <kbd>P</kbd>), lalu lihat mobil berhenti dan menunggu sampai pejalan kaki selesai menyeberang.' },
    },
    {
      title: 'Dilema lampu kuning',
      body:
        '<p>Lampu kuning memaksa mobil memilih. Kalau masih jauh, sebaiknya berhenti. Kalau sudah terlalu dekat, mengerem mendadak justru berbahaya, jadi lebih aman terus melaju.</p>' +
        '<p>Mobil ini memakai aturan sederhana. Saat lampu berubah kuning, ia membandingkan jarak ke garis henti <em>d</em> dengan jarak henti nyaman pada perlambatan 3 m/s².</p>' +
        '<div class="formula">jarak henti nyaman = v² / (2 × 3)<br>d lebih besar → berhenti<br>d lebih kecil atau sama → terus</div>' +
        '<p>Keputusan diambil sekali, lalu dipegang supaya mobil tidak ragu-ragu. Kalau mobil memilih terus dengan kecepatan tetap, ia sampai di garis henti paling lama v / 6 detik kemudian (v dalam m/s). Kecepatan tertinggi di pelajaran ini 50 km/jam, sama dengan batas kecepatan kawasan perkotaan. Pada kecepatan itu waktunya sekitar 2,3 detik, masih di dalam 3 detik lampu kuning.</p>' +
        '<p>Mobil baru bisa melihat lampu dari jarak 80 m. Jadi tekan Paksa merah saat angka <strong>Ke garis henti</strong> di panel Mobil otonom kurang dari 80 m. Coba sekali saat masih jauh dan sekali saat sudah dekat, lalu bandingkan hasilnya.</p>' +
        '<p class="note">Setelah memilih terus, mobil tidak boleh melambat sampai melewati garis henti. Kalau kamu menurunkan kecepatan target di saat itu, perisai keselamatan menahan kecepatannya supaya mobil tetap lewat sebelum merah.</p>',
      task: { id: 'yellow-decision', text: 'Saat mobil mendekati simpang, pilih <strong>Paksa merah</strong> supaya lampu menjadi kuning. Baca hitungannya di panel Dilema lampu kuning.' },
    },
    {
      title: 'Menyalip angkot ngetem',
      body:
        '<p>Angkot di Malang sering <strong>ngetem</strong>, yaitu berhenti lama di pinggir jalan menunggu penumpang. Angkot yang ngetem menutup lajur kiri. Mobil otonom mendekat sambil menjaga jarak (MENGIKUTI), berhenti 8 m di belakangnya, lalu mengamatinya sebentar. Kendaraan yang tetap diam selama 1,5 detik dengan lampu hazard menyala dianggap berhenti lama. Setelah itu mobil otonom MENUNGGU CELAH.</p>' +
        '<p>UU Nomor 22 Tahun 2009 Pasal 109 ayat (1) mengatur bahwa pengemudi yang akan melewati kendaraan lain memakai lajur sebelah kanan dari kendaraan yang dilewati, dengan jarak pandang bebas dan ruang yang cukup. Jalan Kawi dua arah, jadi lajur kanan itu dipakai kendaraan dari arah berlawanan dan mobil harus menghitung celahnya.</p>' +
        '<div class="formula">waktu tiba kendaraan lawan ≥ waktu menyalip + 2 detik cadangan</div>' +
        '<p>Pita di lajur kanan menandai <strong>zona salip</strong>, bagian jalan yang harus kosong selama mobil menyalip. Pita merah berarti celahnya belum cukup, hijau berarti cukup. Angkanya ada di panel Skenario. Sepeda motor dari arah berlawanan juga dihitung.</p>' +
        '<p>Kalau celahnya cukup, mobil MENYALIP, lalu KEMBALI KE LAJUR setelah bagian belakangnya berjarak 3 m di depan angkot.</p>' +
        '<p class="note">Radar jarak jauh di simulasi ini melihat kendaraan lawan sampai 250 m. Di simulasi ini garis tengah dekat simpang dan zebra cross dibuat utuh, dan baru putus-putus (boleh dilintasi) setelah zebra cross.</p>',
      task: { id: 'overtake', text: 'Tekan <strong>Taruh angkot ngetem</strong> (atau <kbd>A</kbd>). Lihat mobil menunggu celah, menyalip lewat lajur kanan, lalu kembali ke lajurnya.' },
    },
    {
      title: 'Aturan untuk mesin',
      body:
        '<p>Pengemudi manusia cukup diberi tahu "hati-hati" atau "utamakan pejalan kaki". Mesin tidak bisa menafsirkan kalimat seperti itu. Setiap aturan harus diubah menjadi syarat yang bisa diukur dengan angka, misalnya jarak dalam meter atau waktu dalam detik.</p>' +
        '<div class="formula">jika pejalan kaki di penyeberangan<br>&nbsp;&nbsp;→ MEMBERI JALAN<br>jika merah dan d ≤ jarak rem<br>&nbsp;&nbsp;→ BERHENTI DI LAMPU<br>jika kuning dan d > v² / (2 × 3)<br>&nbsp;&nbsp;→ BERHENTI DI LAMPU<br>jika angkot di depan berhenti lama<br>&nbsp;&nbsp;→ MENUNGGU CELAH<br>jika celah ≥ waktu salip + 2 detik<br>&nbsp;&nbsp;→ MENYALIP</div>' +
        '<p>Logika yang jelas juga membuat keputusan bisa diperiksa. Dari log kamu tahu persis kenapa mobil berhenti atau menyalip. Hal ini penting saat menguji sistem dan saat mencari penyebab sebuah kecelakaan.</p>' +
        '<p>Tantangannya ada pada situasi yang tidak tertulis, misalnya pejalan kaki yang ragu-ragu atau dua aturan yang bertabrakan. Karena itu aturan juga butuh urutan prioritas, dan keselamatan manusia selalu di urutan pertama.</p>' +
        '<p>Di simulasi ini keselamatan dijaga oleh satu lapisan lagi, <strong>perisai keselamatan</strong>. Enam puluh kali per detik, perisai memeriksa perintah setiap kendaraan sebelum dijalankan, termasuk angkot dan sepeda motor. Kalau jarak ke garis henti lampu merah atau ke pejalan kaki sudah hampir sama dengan jarak hentinya, perisai mengerem, apa pun keputusan perencananya. Angka <strong>Terobos lampu merah</strong> dan <strong>Kontak dengan pejalan kaki</strong> di panel Perisai keselamatan harus selalu 0.</p>' +
        '<p>Sekarang lampu berjalan otomatis dan angkot ngetem sudah ada. Tambahkan pejalan kaki kapan saja, lalu amati diagram, log, dan panel perisai selama beberapa putaran.</p>' +
        '<p class="note">Sistem sungguhan jauh lebih rumit. Banyak yang menggabungkan aturan seperti ini dengan perencana berbasis biaya atau pembelajaran mesin, dan batas keselamatannya biasanya tetap ditulis sebagai aturan yang tegas.</p>',
    },
  ],
  summary:
    '<p>Pengambilan keputusan mengubah hasil persepsi menjadi tindakan. Mobil di pelajaran ini memakai mesin keadaan dengan tujuh keadaan dan mencatat alasan setiap perpindahannya.</p>' +
    '<ul><li>Lampu merah: mobil mulai mengerem pada jarak yang dihitung dari kecepatannya, lalu berhenti di belakang garis henti.</li>' +
    '<li>Zebra cross: pejalan kaki didahulukan, sesuai Pasal 106 ayat (2) UU Nomor 22 Tahun 2009.</li>' +
    '<li>Lampu kuning: berhenti kalau d > v² / (2 × 3), terus kalau tidak.</li>' +
    '<li>Angkot ngetem: tunggu sampai celah di lajur kanan cukup, lalu menyalip dari kanan sesuai Pasal 109 ayat (1).</li>' +
    '<li>Perisai keselamatan memeriksa setiap kendaraan sebelum bergerak, jadi tidak ada yang menerobos lampu merah atau menyentuh pejalan kaki.</li></ul>' +
    '<p class="note">Perlambatan 3 m/s², cadangan celah 2 detik, jangkauan sensor, dan lama nyala lampu di sini hanya angka contoh. Lebar Jalan Kawi, jumlah lajur, dan tinggi gedung di peta adalah perkiraan dari data OpenStreetMap.</p>',

  styles: `
    .lesson-keputusan .kp-scen-row .btn { flex: 1 1 200px; min-height: 44px; }
    .lesson-keputusan .kp-log-group { grid-column: span 2; }
    .lesson-keputusan .kp-log { display: flex; flex-direction: column; gap: 6px; max-height: 360px; margin: 0; padding: 0; overflow-y: auto; list-style: none; scrollbar-width: thin; }
    .lesson-keputusan .kp-log li { display: grid; grid-template-columns: 46px minmax(0, 1fr); gap: 10px; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg); }
    .lesson-keputusan .kp-log li.is-danger { border-color: rgba(239, 68, 68, 0.5); }
    .lesson-keputusan .kp-log .kp-empty { display: block; color: var(--muted); font-size: .88rem; text-align: center; }
    .lesson-keputusan .kp-time { padding-top: 1px; color: var(--muted); font-family: var(--mono); font-size: .8rem; }
    .lesson-keputusan .kp-head { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; font-size: .72rem; font-weight: 800; letter-spacing: .04em; }
    .lesson-keputusan .kp-from { color: var(--muted); }
    .lesson-keputusan .kp-arrow { color: var(--muted); font-weight: 400; }
    .lesson-keputusan .kp-state, .lesson-keputusan .kp-tag { padding: 1px 7px; border-radius: 6px; background: color-mix(in srgb, var(--c) 16%, transparent); color: var(--c); }
    .lesson-keputusan .kp-text { margin: 3px 0 0; color: var(--text-soft); font-size: .88rem; line-height: 1.45; }
    .lesson-keputusan .kp-yellow-empty { color: var(--muted); font-size: .88rem; }
    .lesson-keputusan .kp-calc { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg); }
    .lesson-keputusan .kp-calc-row { display: flex; flex-direction: column; gap: 1px; }
    .lesson-keputusan .kp-calc-row span { color: var(--muted); font-size: .78rem; font-weight: 600; }
    .lesson-keputusan .kp-calc-row b { color: var(--text); font-family: var(--mono); font-size: .9rem; font-weight: 600; }
    .lesson-keputusan .kp-light-seg .seg-btn { padding: 0 4px; font-size: .82rem; }
    .lesson-keputusan .kp-verdict { padding: 9px 12px; border-radius: var(--radius-sm); font-family: var(--mono); font-size: .88rem; font-weight: 700; }
    .lesson-keputusan .kp-verdict.is-stop { background: rgba(239, 68, 68, .12); color: #fca5a5; }
    .lesson-keputusan .kp-verdict.is-go { background: rgba(34, 197, 94, .12); color: #86efac; }
    .lesson-keputusan .kp-result { margin: 0; color: var(--text-soft); font-size: .86rem; }
    @media (max-width: 600px) {
      .lesson-keputusan .kp-chip-speed { display: none; }
    }
    @media (max-width: 900px) {
      .lesson-keputusan .kp-log-group { grid-column: auto; }
      .lesson-keputusan .kp-log { max-height: 300px; }
    }
  `,

  async mount(ctx) {
    // ---------- kanvas (dibuat dulu supaya panggung tidak kosong selama peta dimuat) ----------
    const view = ctx.createView({ label: 'Peta Jalan Kawi, Malang, sedang dimuat.' });
    ctx.setStatus('Memuat peta Jalan Kawi dari data OpenStreetMap...');
    const json = await fetchSceneJson(ctx.signal);
    if (ctx.signal.aborted) return {};
    const scene = buildScene(json);
    const S = scene.S;
    const mapRenderer = createMapRenderer(scene.map, { layers: { places: true, footways: false } });
    const art = createSceneArt(scene);

    // ---------- model ----------
    const world = createWorld(scene);
    const planner = createPlanner(world);
    const ego = world.ego;
    const P = planner.P;
    const log = [];
    let logDirty = true;
    let flags = {}; // id tugas -> waktu dunia saat event penyelesainya terjadi
    let redHold = 0; // lama (detik) syarat tugas red-stop terpenuhi
    let stepStart = 0;
    let presetIndex = 0;
    let lastYellowKey = '';
    let lastShieldNote = null;

    const labels = createLabelLayer();
    view.setLabel('Peta Jalan Kawi, Malang, dari atas. Peta diputar supaya jalan mendatar. Mobil otonom hijau toska melaju ke timur di lajur kiri, dan diagram mesin keadaan ada di bawah peta.');

    ctx.createLoop({
      update(dt) {
        world.update(dt, planner);
        handleEvents();
      },
      render,
    });

    // ---------- panel kontrol ----------
    const lightGroup = ui.group(ctx.controls, { title: 'Lampu lalu lintas' });
    const lightCtl = ui.segmented(lightGroup, {
      ariaLabel: 'Mode lampu lalu lintas Jalan Kawi',
      options: [
        { value: 'otomatis', label: 'Otomatis' },
        { value: 'merah', label: 'Paksa merah' },
        { value: 'hijau', label: 'Paksa hijau' },
      ],
      value: 'otomatis',
      onChange: (m) => setLightMode(m),
    });
    lightCtl.el.classList.add('kp-light-seg');
    const lightReadouts = ui.readoutGrid(lightGroup);
    const lightOut = ui.readout(lightReadouts, { label: 'Lampu arah mobil', value: 'Hijau' });
    const lightTimeOut = ui.readout(lightReadouts, { label: 'Berganti dalam', value: '-' });
    lightGroup.append(ui.el('p', { class: 'ctl-hint', text: 'Lampu tidak pernah melompat dari hijau ke merah. Selalu ada kuning 3 detik lebih dulu, lalu semua arah merah 2 detik.' }));

    const scenGroup = ui.group(ctx.controls, { title: 'Skenario' });
    const scenRow = ui.buttonRow(scenGroup, { className: 'kp-scen-row' });
    ui.button(scenRow, { label: 'Munculkan pejalan kaki', icon: 'hand', kbd: 'P', onClick: () => spawnPed() });
    const angkotBtn = ui.button(scenRow, { label: 'Taruh angkot ngetem', icon: 'car', kbd: 'A', onClick: () => toggleAngkot(true) });
    const densityCtl = ui.segmented(scenGroup, {
      label: 'Lalu lintas arah berlawanan',
      options: DENSITY_OPTIONS,
      value: world.density,
      onChange: (d) => setDensity(d),
    });
    const gapReadouts = ui.readoutGrid(scenGroup);
    const gapOut = ui.readout(gapReadouts, { label: 'Kendaraan lawan tiba', value: '-' });
    const needOut = ui.readout(gapReadouts, { label: 'Menyalip butuh', value: '-' });

    const egoGroup = ui.group(ctx.controls, { title: 'Mobil otonom' });
    ui.slider(egoGroup, {
      label: 'Kecepatan target',
      min: V_MIN_KMH,
      max: V_MAX_KMH,
      step: 5,
      value: 40,
      unit: 'km/jam',
      hint: 'Paling tinggi 50 km/jam, batas kecepatan kawasan perkotaan.',
      onInput: (v) => planner.setTarget(kmhToMs(v)),
    });
    const egoReadouts = ui.readoutGrid(egoGroup);
    const vOut = ui.readout(egoReadouts, { label: 'Kecepatan', value: '0 km/jam' });
    const decOut = ui.readout(egoReadouts, { label: 'Perlambatan', value: '0 m/s²' });
    const lineOut = ui.readout(egoReadouts, { label: 'Ke garis henti', value: '-' });
    const sdOut = ui.readout(egoReadouts, { label: 'Henti nyaman', value: '-' });

    const yellowGroup = ui.group(ctx.controls, { title: 'Dilema lampu kuning' });
    const yellowBox = ui.el('div', { class: 'kp-yellow' });
    yellowGroup.append(yellowBox);

    const shieldGroup = ui.group(ctx.controls, { title: 'Perisai keselamatan', hint: 'Memeriksa perintah setiap kendaraan 60 kali per detik sebelum dijalankan. Dua angka pertama harus selalu 0.' });
    const shieldReadouts = ui.readoutGrid(shieldGroup);
    const redOut = ui.readout(shieldReadouts, { label: 'Terobos lampu merah', value: '0' });
    const pedOut = ui.readout(shieldReadouts, { label: 'Kontak dengan pejalan kaki', value: '0' });
    const interOut = ui.readout(shieldReadouts, { label: 'Perisai ikut mengerem', value: '0 kali' });
    const otherOut = ui.readout(shieldReadouts, { label: 'Tabrakan lain', value: '0' });

    const logGroup = ui.group(ctx.controls, { title: 'Log keputusan', hint: 'Terbaru di atas. Waktu dalam detik sejak simulasi dimulai.', className: 'kp-log-group' });
    const logList = ui.el('ol', { class: 'kp-log', 'aria-label': 'Log keputusan mobil otonom' });
    logGroup.append(logList);

    // HUD di atas kanvas
    const stateChip = ui.hudChip(ctx.hud, { label: 'Keadaan', color: STATES.melaju.color });
    const lightChip = ui.hudChip(ctx.hud, { label: 'Lampu', color: COLORS.lightGreen });
    const speedChip = ui.hudChip(ctx.hud, { label: 'Kecepatan', color: COLORS.accent });
    speedChip.el.classList.add('kp-chip-speed');

    ctx.keys({
      p: () => spawnPed(),
      a: () => toggleAngkot(true),
    });

    // kait uji otomatis (baca saja), dihapus saat pelajaran ditinggalkan
    Object.defineProperty(window, '__keputusan', {
      configurable: true,
      get: () => ({ ...world.snapshot(), state: P.state, targetKmh: msToKmh(P.targetSpeed), step: ctx.currentStep(), yellow: P.yellow ? { v: P.yellow.v, d: P.yellow.d, stop: P.yellow.stop, result: P.yellow.result } : null }),
    });
    ctx.onCleanup(() => {
      delete window.__keputusan;
    });

    // ---------- aksi ----------
    function setLightMode(m) {
      world.signal.mode = m;
      lightCtl.set(m);
    }

    function setDensity(d) {
      // saat menyalip, kendaraan lawan baru baru boleh muncul di luar jangkauan radar
      world.setDensity(d, P.man ? ego.x + RANGE_FAR : -Infinity);
      densityCtl.set(d);
    }

    function setAngkotButton() {
      const on = world.angkot.active || world.pending.angkot;
      angkotBtn.innerHTML = `${icon(on ? 'trash' : 'car')}<span class="btn-label"></span><kbd>A</kbd>`;
      angkotBtn.querySelector('.btn-label').textContent = on ? 'Suruh angkot pergi' : 'Taruh angkot ngetem';
    }

    function toggleAngkot(fromUser = false) {
      const r = world.requestAngkot();
      if (r.removed) {
        if (fromUser) addLog({ kind: 'catatan', tag: 'skenario', text: 'Angkot ngetem pergi dari lajur kiri.' });
      } else if (r.queued && fromUser) {
        const text = `Mobil otonom sudah terlalu dekat dengan tempat ngetem (${fmt(Math.max(0, r.distance), 0)} m, perlu ${fmt(r.need, 0)} m untuk berhenti dengan nyaman). Angkot datang setelah mobil lewat, jadi ditemui di putaran berikutnya.`;
        addLog({ kind: 'catatan', tag: 'skenario', text });
        ctx.toast(text);
      }
      setAngkotButton();
    }

    function spawnPed() {
      const r = world.requestPed();
      if (r.reason === 'penuh') {
        ctx.toast('Sudah ada dua pejalan kaki di zebra cross. Tunggu sampai mereka selesai menyeberang.', { tone: 'warn' });
        return;
      }
      if (r.queued) {
        const text =
          r.reason === 'lewat'
            ? 'Mobil otonom sudah melewati zebra cross. Pejalan kaki muncul saat mobil datang lagi dari awal ruas.'
            : `Mobil otonom tinggal ${fmt(Math.max(0, r.distance), 0)} m dari zebra cross, padahal perlu ${fmt(r.need, 0)} m untuk berhenti dengan nyaman. Pejalan kaki muncul saat mobil datang lagi dari awal ruas.`;
        addLog({ kind: 'catatan', tag: 'skenario', text });
        ctx.toast(text);
      }
    }

    // ---------- log keputusan ----------
    function addLog(entry) {
      log.unshift({ time: world.time, ...entry });
      if (log.length > MAX_LOG) log.length = MAX_LOG;
      logDirty = true;
    }

    function handleEvents() {
      // transisi, catatan, dan bahaya masuk log; event selesai menandai tugas
      for (const e of planner.drainEvents()) {
        if (EVENT_TASK[e.type]) flags[EVENT_TASK[e.type]] = world.time;
        else addLog({ ...e, kind: e.type });
      }
      for (const e of world.drainEvents()) {
        if (e.type === 'pejalan-muncul') addLog({ kind: 'catatan', tag: 'skenario', text: `Pejalan kaki muncul di tepi zebra cross, ${fmt(Math.max(0, e.distance), 0)} m di depan mobil otonom.` });
        else if (e.type === 'pejalan-mulai' && e.ped.test && e.ped.id === P.yieldTest) addLog({ kind: 'catatan', tag: 'pejalan kaki', text: 'Pejalan kaki mulai menyeberang. Mobil tetap berhenti sampai ia tiba di seberang.' });
        else if (e.type === 'angkot-ditaruh') {
          addLog({ kind: 'catatan', tag: 'skenario', text: e.distance > 0 ? `Angkot ngetem di lajur kiri, ${fmt(e.distance, 0)} m di depan.` : 'Angkot ngetem di lajur kiri, di belakang mobil otonom. Mobil akan menemuinya di putaran berikutnya.' });
          setAngkotButton();
        } else if (e.type === 'putaran') addLog({ kind: 'catatan', tag: 'skenario', text: `Mobil otonom sampai di ujung ruas dekat simpang ${scene.extName || 'berikutnya'}. Simulasi mengulang dari awal Jalan Kawi.` });
        else if (e.type === 'tabrakan') {
          addLog({ kind: 'bahaya', text: 'Tabrakan dengan kendaraan lain. Ini tidak seharusnya terjadi. Tekan Ulangi.' });
          ctx.pause();
        }
      }
      if (world.shieldNote && world.shieldNote !== lastShieldNote) {
        lastShieldNote = world.shieldNote;
        const text = SHIELD_TEXT[world.shieldNote.what];
        if (text) addLog({ kind: 'catatan', tag: 'perisai', text, time: world.shieldNote.time });
      }
    }

    const TAG_COLOR = { skenario: COLORS.muted, keputusan: COLORS.lightYellow, 'cek celah': STATES.celah.color, 'pejalan kaki': STATES.pejalan.color, perisai: COLORS.accent };

    function renderLog() {
      if (!logDirty) return;
      logDirty = false;
      if (!log.length) {
        logList.innerHTML = '<li><span class="kp-empty" style="grid-column: 1 / -1">Belum ada keputusan. Perpindahan keadaan akan muncul di sini.</span></li>';
        return;
      }
      logList.innerHTML = log
        .map((e) => {
          let head;
          if (e.kind === 'transisi') {
            head = `<span class="kp-from">${STATES[e.from].label}</span><span class="kp-arrow" aria-hidden="true">→</span><span class="visually-hidden"> menjadi </span><span class="kp-state" style="--c: ${STATES[e.to].color}">${STATES[e.to].label}</span>`;
          } else if (e.kind === 'bahaya') {
            head = `<span class="kp-tag" style="--c: ${COLORS.danger}">BAHAYA</span>`;
          } else {
            head = `<span class="kp-tag" style="--c: ${TAG_COLOR[e.tag] || COLORS.muted}">${esc((e.tag || 'catatan').toUpperCase())}</span>`;
          }
          return `<li class="${e.kind === 'bahaya' ? 'is-danger' : ''}"><span class="kp-time">${fmt(e.time, 1)}</span><div><div class="kp-head">${head}</div><p class="kp-text">${esc(e.text)}</p></div></li>`;
        })
        .join('');
    }

    // ---------- panel dilema lampu kuning ----------
    function renderYellow() {
      const rec = P.yellow;
      const key = rec ? `${rec.id}|${rec.time}|${rec.result ? rec.result.kind : ''}` : 'none';
      if (key === lastYellowKey) return;
      lastYellowKey = key;
      if (!rec) {
        yellowBox.innerHTML = '<p class="kp-yellow-empty">Belum ada lampu kuning yang dihadapi mobil. Saat lampu berubah kuning ketika mobil mendekat, hitungannya muncul di sini.</p>';
        return;
      }
      const v = rec.v;
      const verdict = rec.stop ? `${fmt(rec.d, 1)} m > ${fmt(rec.sd, 1)} m, jadi BERHENTI` : `${fmt(rec.d, 1)} m ≤ ${fmt(rec.sd, 1)} m, jadi TERUS`;
      let result = 'Menunggu hasil...';
      if (rec.result?.kind === 'stop') result = `Hasil: mobil berhenti ${fmt(rec.result.gap, 1)} m sebelum garis henti dengan perlambatan terbesar ${fmt(rec.result.maxDecel, 1)} m/s².`;
      else if (rec.result?.kind === 'go') result = rec.result.red ? 'Hasil: mobil melewati garis henti saat lampu sudah merah.' : `Hasil: mobil melewati garis henti ${fmt(rec.result.left, 1)} detik sebelum lampu merah.`;
      yellowBox.innerHTML = `
        <div class="kp-calc">
          <div class="kp-calc-row"><span>Kecepatan saat lampu kuning (v)</span><b>${fmt(v, 1)} m/s = ${fmt(msToKmh(v), 0)} km/jam</b></div>
          <div class="kp-calc-row"><span>Jarak ke garis henti (d)</span><b>${fmt(rec.d, 1)} m</b></div>
          <div class="kp-calc-row"><span>Jarak henti nyaman, v² / (2 × ${fmt(A_COMFORT)})</span><b>${fmt(v, 1)}² / ${fmt(2 * A_COMFORT)} = ${fmt(rec.sd, 1)} m</b></div>
        </div>
        <div class="kp-verdict ${rec.stop ? 'is-stop' : 'is-go'}">${verdict}</div>
        <p class="kp-result">${result}</p>
        <p class="ctl-hint">Keputusan diambil pada detik ${fmt(rec.time, 1)}.</p>`;
    }

    // ---------- deteksi tugas ----------
    // red-stop: mobil diam di belakang garis henti selama 0,8 detik; tugas lain dari event perencana
    function checkTasks(realDt) {
      const taskId = ctx.lesson.steps[ctx.currentStep()]?.taskId;
      if (!taskId || ctx.isTaskDone(taskId)) return;
      if (taskId === 'red-stop') {
        const line = P.per?.line;
        const stopped = P.state === 'lampu' && world.signal.main === 'red' && ego.speed < 0.05 && line && line.dLine < 2.5 && line.dLine > -0.05;
        redHold = stopped ? redHold + realDt : 0;
        if (redHold >= 0.8) ctx.completeTask(taskId);
      } else if (flags[taskId] >= stepStart) ctx.completeTask(taskId);
    }

    // ---------- pembaruan panel (sekitar 8 kali per detik) ----------
    let lastPanel = 0;
    let lastState = null;
    function refreshPanels(realDt) {
      const s = world.signal;
      const st = s.main;
      const left = s.mainTimeLeft();
      lightOut.set(LIGHT_WORD[st]);
      lightOut.el.style.setProperty('--tone', LIGHT_COLOR[st]);
      lightTimeOut.set(left == null ? 'ditahan' : fmt(Math.max(0, left), 1, 'detik'));
      lightChip.set(left == null ? LIGHT_WORD[st] : `${LIGHT_WORD[st]} ${fmt(Math.max(0, left), 0)} detik`);
      lightChip.el.style.setProperty('--tone', LIGHT_COLOR[st]);

      const meta = STATES[P.state];
      stateChip.set(meta.label);
      stateChip.el.style.setProperty('--tone', meta.color);
      speedChip.set(fmtSpeed(ego.speed));

      const v = ego.speed;
      vOut.set(fmtSpeed(v));
      const dec = Math.max(0, -ego.accel);
      decOut.set(v < 0.05 ? '0 m/s²' : fmt(dec, 1, 'm/s²'));
      decOut.setTone(dec > 3.5 && v > 0.05 ? 'danger' : dec > 0.3 && v > 0.05 ? 'warn' : '');
      const dLine = P.per ? P.per.line.dLine : Infinity;
      lineOut.set(dLine > -0.05 && dLine < 150 ? fmt(Math.max(0, dLine), 1, 'm') : dLine < 0 ? 'sudah lewat' : 'jauh');
      sdOut.set(fmt((v * v) / (2 * A_COMFORT), 1, 'm'));

      if (P.gap && (P.state === 'celah' || P.state === 'salip')) {
        gapOut.set(!Number.isFinite(P.gap.minT) ? 'tidak ada' : P.gap.minT < 0.05 ? 'di zona salip' : fmt(P.gap.minT, 1, 'detik'));
        gapOut.setTone(P.gap.ok ? 'ok' : 'warn');
        needOut.set(fmt(P.gap.need, 1, 'detik'));
      } else {
        gapOut.set('-');
        gapOut.setTone('off');
        needOut.set('-');
      }

      const c = world.counters;
      redOut.set(fmt(c.redRuns));
      redOut.setTone(c.redRuns ? 'danger' : 'ok');
      pedOut.set(fmt(c.pedContacts));
      pedOut.setTone(c.pedContacts ? 'danger' : 'ok');
      interOut.set(`${fmt(c.interventions)} kali`);
      otherOut.set(fmt(c.otherCollisions));
      otherOut.setTone(c.otherCollisions ? 'warn' : 'ok');

      renderYellow();
      renderLog();
      checkTasks(realDt);
      let status = `Keadaan ${meta.label}. ${P.short}`;
      if (world.pending.ped) status += ' Pejalan kaki menunggu mobil datang lagi.';
      ctx.setStatus(status);
      if (lastState !== P.state) {
        lastState = P.state;
        view.setLabel(`Peta Jalan Kawi, Malang, dari atas, diputar supaya jalan mendatar. Mobil otonom di lajur kiri. Diagram mesin keadaan di bawahnya menunjukkan keadaan aktif ${meta.label}.`);
      }
    }

    // ---------- menggambar ----------
    const F = scene.frame;
    function sAtX(x) {
      let lo = -60;
      let hi = S.end + 80;
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (F.toWorld(mid, 0).x < x) lo = mid;
        else hi = mid;
      }
      return (lo + hi) / 2;
    }

    function render() {
      const W = view.width;
      const H = view.height;
      if (W < 2 || H < 2) return;
      const diagH = diagramHeight(W, H);
      const bandH = H - diagH;
      const narrow = W < 560;

      // kamera mengikuti mobil otonom di sepanjang Jalan Kawi, tidak melewati tepi data
      const worldW = Math.max(50, W / 9.5);
      const scale = W / worldW;
      view.camera.scale = scale;
      const egoW = F.toWorld(ego.x, ego.y);
      const halfW = W / 2 / scale;
      let cx = egoW.x + (W / 2 - W * (narrow ? 0.2 : 0.24)) / scale;
      const xMin = F.toWorld(S.viewMin, 0).x + halfW;
      const xMax = F.toWorld(S.viewMax, 0).x - halfW;
      cx = xMax > xMin ? clamp(cx, xMin, xMax) : xMin;
      const yRoad = F.toWorld(sAtX(cx), 0).y;
      view.camera.x = cx;
      view.camera.y = yRoad + (H / 2 - bandH * (narrow ? 0.6 : 0.56)) / scale;
      const a = view.screenToWorld(0, 0);
      const b = view.screenToWorld(W, bandH);
      const vis = { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
      world.viewMaxS = sAtX(vis.maxX);

      const g = view.begin();
      g.save();
      view.screen();
      g.beginPath();
      g.rect(0, 0, W, bandH);
      g.clip();
      view.world();
      mapRenderer.draw(g, view, { attribution: false });
      art.drawRoad(g);
      art.drawActors(g, view, world, { vis, time: world.time, reducedMotion: ctx.reducedMotion });
      drawOverlays(g, { world, planner, view, labels, vis, scene });
      drawCar(g, { x: egoW.x, y: egoW.y, heading: egoW.heading + ego.heading, length: ego.length, width: ego.width, braking: ego.braking }, { ego: true });
      art.drawSignals(g, view, world);
      // nama jalan di trotoar utara, di tempat yang tidak dekat penyeberangan
      const sL = sAtX(vis.minX);
      const sR = world.viewMaxS;
      const busy = [S.cwWest, S.cwEast, S.zebra, S.center, ego.x];
      if (world.angkot.active) busy.push(world.angkot.x);
      // di layar sempit sepertiga kanan dipakai penunjuk tepi (misalnya "Lampu hijau 86 m")
      for (const f of narrow ? [0.5, 0.36, 0.12] : [0.42, 0.62, 0.25, 0.8]) {
        const s = sL + (sR - sL) * f;
        if (busy.some((q) => Math.abs(q - s) < (q === ego.x ? 8 : 12))) continue;
        const p = F.toWorld(s, -(ROAD_HALF + WALK / 2));
        art.streetName(g, view, p.x, p.y, p.heading, 'Jl. Kawi');
        break;
      }
      labels.draw(g, view);
      drawScaleBar(g, view, { y: bandH - 12 });
      // panah utara di kiri bawah (tepi kanan dipakai penunjuk objek di luar layar)
      drawNorthArrow(g, view, 30, bandH - 52, scene.northAngle);
      // jeda singkat saat mobil mulai lagi dari awal ruas
      const since = world.time - world.lastWrapAt;
      if (since >= 0 && since < 0.7) {
        view.screen();
        g.fillStyle = `rgba(11, 18, 32, ${(0.85 * (1 - since / 0.7)).toFixed(3)})`;
        g.fillRect(0, 0, W, bandH);
        view.world();
      }
      mapRenderer.drawAttribution(g, view, { corner: 'bottom-right', margin: 6, offsetY: diagH });
      g.restore();

      view.screen();
      drawDiagram(g, { x: 0, y: bandH, w: W, h: diagH }, { state: P.state, prev: P.prev, age: world.time - P.changedAt });
      view.world();

      const now = performance.now();
      if (now - lastPanel > 120) {
        refreshPanels(lastPanel ? Math.min(0.5, (now - lastPanel) / 1000) : 0);
        lastPanel = now;
      }
    }

    // ---------- preset dan reset ----------
    function startS(pr) {
      if (pr.start === 'zebra') return S.zebra - 140;
      if (pr.start === 'simpang') return S.cwEast + 10;
      return S.start;
    }

    function restartScenario(i) {
      presetIndex = i;
      const pr = STEP_PRESETS[Math.min(i, STEP_PRESETS.length - 1)];
      world.reset(startS(pr), P.targetSpeed);
      planner.reset();
      log.length = 0;
      logDirty = true;
      lastYellowKey = '';
      lastShieldNote = null;
      redHold = 0;
      flags = {};
      stepStart = world.time;
      setAngkotButton();
    }

    setAngkotButton();
    // nilai awal sebelum onStep pertama
    world.reset(S.start, P.targetSpeed);
    planner.reset();

    return {
      onStep(i) {
        const pr = STEP_PRESETS[i];
        if (!pr) return;
        setLightMode(pr.light);
        world.angkot.active = pr.angkot;
        world.density = pr.density;
        densityCtl.set(pr.density);
        restartScenario(i);
        refreshPanels(0);
      },
      reset() {
        restartScenario(presetIndex);
        refreshPanels(0);
      },
    };
  },
};
