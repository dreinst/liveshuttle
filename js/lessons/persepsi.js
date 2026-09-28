// Pelajaran 3: Persepsi dan Fusi Sensor.
//
// Struktur mengikuti pelajaran contoh (sensor.js):
//   1. Teks pelajaran (intro, steps, summary) di objek default export.
//   2. Model dunia di ./persepsi/scene.js (jalan kota yang bergulir, pelaku, mobil otonom).
//   3. Model persepsi di ./persepsi/perception.js (deteksi tiap sensor, fusi, pelacakan, prediksi).
//   4. File ini menyusun kanvas, panel kontrol, gambar lapisan persepsi, deteksi tugas, dan
//      preset tiap langkah.
// Semua tahap persepsi selalu berjalan di dalam simulasi. Sakelar hanya memilih tahap mana
// yang digambar, sama seperti layar diagnosis di mobil uji.

import { COLORS, withAlpha } from '../engine/theme.js';
import { fmt, fmtSigned, msToKmh, TAU } from '../engine/math.js';
import { drawSensorCone, drawPointCloud, drawBracketBox, drawRing, drawLine, drawArrow, drawScaleBar, createLabelLayer } from '../engine/draw.js';
import { icon } from '../engine/icons.js';
import * as ui from '../engine/ui.js';
import { createScene, LANE_Y } from './persepsi/scene.js';
import {
  createPerception,
  CLASS_NAMES,
  CAMERA,
  LIDAR,
  RADAR,
  SCAN_DT,
  HORIZON,
  ellipseOf,
  predictTrack,
  trackMotion,
  findConflict,
  predictable,
} from './persepsi/perception.js';

const FUSED = '#f8fafc';
const PRED = '#f472b6';
const DANGER = COLORS.danger;
const DANGER_TEXT = '#fecaca';
const DANGER_BG = 'rgba(69, 10, 10, 0.9)';
const CORRIDOR_LEN = 35; // m, panjang jalur rencana yang diperiksa
const SENSOR_KEYS = ['kamera', 'lidar', 'radar'];
const SENSOR_LABELS = { kamera: 'Kamera', lidar: 'LiDAR', radar: 'Radar' };
const SENSOR_HINTS = { kamera: 'Kotak berlabel kelas', lidar: 'Titik dan klaster', radar: 'Titik dan kecepatan relatif' };
const SUBJECT = { pedestrian: 'Pejalan kaki', cyclist: 'Pesepeda', car: 'Mobil', unknown: 'Objek' };
const STAGES = [
  { key: 'raw', name: 'Data mentah', sub: 'titik, pantulan, gambar' },
  { key: 'det', name: 'Deteksi', sub: 'kotak, klaster, target' },
  { key: 'fusion', name: 'Fusi', sub: 'gabung antarsensor' },
  { key: 'tracking', name: 'Pelacakan', sub: 'ID, jejak, kecepatan' },
  { key: 'prediction', name: 'Prediksi', sub: '3 detik ke depan' },
];

// Preset tiap langkah. raw null = tampilan data mentah dibiarkan sesuai pilihan pelajar.
// Ambang dan derau selalu dikembalikan ke nilai awal supaya fenomena tiap langkah terlihat.
const STEP_PRESETS = [
  { raw: { kamera: true, lidar: false, radar: false }, fusion: false, tracking: false, prediction: false },
  { raw: { kamera: true, lidar: true, radar: true }, fusion: false, tracking: false, prediction: false },
  { raw: { kamera: true, lidar: true, radar: true }, fusion: true, tracking: false, prediction: false },
  { raw: null, fusion: true, tracking: false, prediction: false },
  { raw: { kamera: false, lidar: false, radar: false }, fusion: true, tracking: true, prediction: false },
];
const DEFAULT_THRESHOLD = 50; // persen
const DEFAULT_NOISE = 1;

const pct = (p) => `${fmt(p * 100, 0)}%`;

export default {
  id: 'persepsi',
  title: 'Persepsi dan Fusi Sensor',
  layout: 'sim',
  intro:
    '<p>Sensor hanya memberi data mentah: gambar kamera, titik LiDAR, dan pantulan radar. Mobil otonom harus mengubahnya menjadi daftar objek yang jelas, yaitu jenisnya, letaknya, arah geraknya, dan seberapa yakin mobil tentang semua itu. Proses ini disebut <strong>persepsi</strong>.</p>' +
    '<p>Di pelajaran ini mobilmu melaju pelan di jalan kota. Kamu akan menyalakan tahap persepsi satu per satu dan melihat hasilnya.</p>',
  steps: [
    {
      title: 'Data mentah tiga sensor',
      body:
        '<p>Tiap sensor mengolah data mentahnya menjadi deteksi. Hasilnya berbeda-beda.</p>' +
        '<ul><li><span class="chip chip-kamera">Kamera</span> memberi kotak berlabel jenis objek, misalnya pejalan kaki, lengkap dengan persen keyakinan. Jaraknya ditebak dari gambar, jadi kotaknya bergeser maju mundur.</li>' +
        '<li><span class="chip chip-lidar">LiDAR</span> memberi kumpulan titik (klaster) dengan posisi sangat tepat, tetapi tidak tahu jenis objeknya.</li>' +
        '<li><span class="chip chip-radar">Radar</span> memberi titik beserta kecepatan relatif. Jaraknya tepat, tetapi posisinya ke kiri dan kanan kurang tepat.</li></ul>' +
        '<p>Elips tipis di sekitar deteksi kamera dan radar menunjukkan besar ketidakpastian posisinya. Elips kamera memanjang searah pandang, sedangkan elips radar melebar ke samping.</p>' +
        '<p class="note">Mobilmu melaju sekitar 18 km/jam. Karena itu radar mencatat benda diam, misalnya mobil parkir, seolah mendekat dengan kecepatan hampir sama.</p>',
      task: { id: 'raw-view', text: 'Nyalakan data mentah <strong>LiDAR</strong> dan <strong>radar</strong> sehingga ketiga sensor tampil bersamaan, lalu cari objek yang terlihat oleh ketiganya.' },
    },
    {
      title: 'Fusi: satu objek, satu kotak',
      body:
        '<p>Satu pejalan kaki bisa muncul tiga kali, sekali di tiap sensor. <strong>Fusi</strong> menggabungkan deteksi yang berasal dari objek yang sama. Versi di simulasi ini disederhanakan menjadi tiga langkah.</p>' +
        '<ol><li>Deteksi dari sensor lain dipasangkan dengan deteksi terdekat (asosiasi tetangga terdekat), asalkan masih di dalam <em>gerbang</em> (gate). Gerbang adalah batas jarak yang memperhitungkan ketidakpastian kedua sensor.</li>' +
        '<li>Posisinya dirata-rata dengan bobot kebalikan varians. Sensor yang posisinya lebih pasti mendapat bobot lebih besar.</li>' +
        '<li>Keyakinannya digabung dengan anggapan kesalahan tiap sensor tidak saling berkaitan. Makin banyak sensor yang sepakat, makin tinggi keyakinannya.</li></ol>' +
        '<div class="formula">w = 1/σ²<br>x = (w₁x₁ + w₂x₂) / (w₁ + w₂)<br>p = 1 − (1 − p₁)(1 − p₂)(1 − p₃)</div>' +
        '<p>Hasilnya satu kotak putih per objek. Jenisnya datang dari kamera, posisinya hampir sama dengan LiDAR karena LiDAR paling tepat. Garis tipis menunjukkan deteksi mana saja yang digabung.</p>' +
        '<p>Coba juga naikkan <strong>Derau sensor</strong>. Makin besar derau, makin sering deteksi dipasangkan dengan objek yang salah.</p>',
      task: { id: 'fusion-on', text: 'Nyalakan <strong>Fusi</strong> dan lihat deteksi dari beberapa sensor menyatu menjadi satu kotak putih per objek.' },
    },
    {
      title: 'Menolak pantulan palsu',
      body:
        '<p>Radar kadang menerima pantulan kuat dari benda logam yang datar, misalnya tutup gorong-gorong di aspal atau pagar pembatas. Bagi radar, pantulan itu tampak seperti objek sungguhan di depan mobil. Deteksi seperti ini disebut <strong>hantu</strong> (ghost).</p>' +
        '<p>Fusi memeriksanya dengan sensor lain. Titik itu berada di daerah yang diawasi kamera dan LiDAR, tetapi keduanya tidak melihat apa pun di sana. Karena hanya radar yang melapor, deteksi itu ditolak.</p>' +
        '<p class="note">Aturan ini disederhanakan. Deteksi radar di luar jangkauan kamera dan LiDAR tidak langsung dibuang, hanya dianggap belum pasti. Di simulasi ini deteksi baru ditolak setelah muncul dua kali berturut-turut. Sistem sungguhan menimbang riwayat yang lebih panjang.</p>',
      task: { id: 'ghost-rejected', text: 'Tekan <strong>Munculkan pantulan palsu</strong>, lalu lihat fusi menandai pantulan itu sebagai <em>ditolak</em>.' },
    },
    {
      title: 'Ambang keyakinan',
      body:
        '<p>Setiap objek hasil fusi punya nilai keyakinan. Mobil hanya meneruskan objek yang keyakinannya mencapai <strong>ambang</strong> ke tahap perencanaan.</p>' +
        '<ul><li>Ambang yang terlalu rendah membuat benda yang bukan objek ikut dilaporkan. Ini disebut <strong>positif palsu</strong>. Coba turunkan ambang sampai sekitar 25% saat mobil mendekati halte. Kamera mengira gambar orang di papan iklan sebagai pejalan kaki.</li>' +
        '<li>Ambang yang terlalu tinggi membuat objek nyata terbuang. Ini disebut <strong>negatif palsu</strong>, dan akibatnya jauh lebih berbahaya.</li></ul>' +
        '<p>Pejalan kaki dan pesepeda paling cepat hilang. Tubuhnya kecil, jadi titik LiDAR-nya sedikit dan pantulan radarnya lemah.</p>' +
        '<p class="note">Tulisan merah <em>terlewat</em> dan <em>palsu</em> adalah kunci jawaban dari simulasi. Mobil sendiri tidak tahu mana objek yang nyata.</p>',
      task: { id: 'threshold', text: 'Naikkan <strong>Ambang keyakinan</strong> sampai minimal 90%, lalu perhatikan objek nyata yang tidak lagi dilaporkan (ditandai <em>terlewat</em>).' },
    },
    {
      title: 'Pelacakan dan prediksi',
      body:
        '<p><strong>Pelacakan</strong> menghubungkan objek dari satu pengukuran ke pengukuran berikutnya. Setiap objek mendapat nomor ID dan jejak. Filter Kalman dengan model kecepatan konstan menghaluskan posisi, lalu memperkirakan kecepatan dan arah gerak. Pelacakan juga mengingat jenis objek, jadi mobil parkir tetap dikenali walau sudah keluar dari pandangan kamera. Bila objek tertutup benda lain lebih dari sekitar 1 detik, jejaknya dihapus, dan objek itu mendapat ID baru saat terlihat lagi.</p>' +
        '<p><strong>Prediksi</strong> meneruskan gerak objek yang sedang bergerak sampai 3 detik ke depan. Pita di sekitar garis prediksi makin lebar karena makin jauh ke depan, makin tidak pasti. Elips putus-putus di ujungnya menunjukkan sebaran posisi pada detik ketiga. Bila prediksi memotong jalur rencana mobilmu (daerah hijau toska di depan mobil), perencana mendapat peringatan lebih awal.</p>' +
        '<p class="note">Model kecepatan konstan menganggap objek terus bergerak lurus dengan kecepatan yang sama. Prediksi di mobil sungguhan juga memakai peta, aturan lalu lintas, dan kebiasaan pengguna jalan.</p>',
      task: { id: 'predict', text: 'Nyalakan <strong>Prediksi</strong>, lalu tunggu sampai mobil mendekati zebra cross dan muncul peringatan bahwa pejalan kaki akan masuk jalurmu.' },
    },
  ],
  summary:
    '<p>Persepsi mengubah data mentah sensor menjadi daftar objek yang siap dipakai untuk mengambil keputusan.</p>' +
    '<ul><li>Tiap sensor menghasilkan deteksinya sendiri. Kamera tahu jenis objek, LiDAR tahu posisi yang tepat, dan radar tahu kecepatan relatif.</li>' +
    '<li>Fusi memasangkan deteksi dengan asosiasi tetangga terdekat, merata-ratakan posisi dengan bobot kebalikan varians, lalu menggabungkan keyakinan.</li>' +
    '<li>Deteksi yang hanya datang dari radar di daerah yang juga diawasi kamera dan LiDAR ditolak sebagai hantu.</li>' +
    '<li>Ambang keyakinan menentukan keseimbangan antara positif palsu dan negatif palsu. Negatif palsu lebih berbahaya, terutama untuk pejalan kaki dan pesepeda.</li>' +
    '<li>Pelacakan memberi ID, jejak, dan kecepatan. Prediksi memperkirakan posisi beberapa detik ke depan, lengkap dengan ketidakpastiannya.</li></ul>' +
    '<p class="note">Simulasi ini disederhanakan supaya mudah diamati: tampak atas dua dimensi, ketiga sensor dibaca bersamaan 10 kali per detik, dan jangkauan sensor dipendekkan agar muat di layar.</p>',

  // Gaya khusus pelajaran ini, selalu diawali .lesson-persepsi.
  styles: `
    .lesson-persepsi .pipe { display: flex; align-items: stretch; gap: 4px; margin: 0; padding: 0; list-style: none; }
    .lesson-persepsi .pipe-stage { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 2px;
      padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg); color: var(--muted);
      text-align: center; transition: border-color .2s ease, background-color .2s ease, color .2s ease; }
    .lesson-persepsi .pipe-stage.is-on { border-color: color-mix(in srgb, var(--accent) 55%, transparent);
      background: color-mix(in srgb, var(--accent) 12%, var(--raised)); color: var(--text); }
    .lesson-persepsi .pipe-name { font-size: .88rem; font-weight: 700; line-height: 1.2; }
    .lesson-persepsi .pipe-sub { font-size: .74rem; line-height: 1.25; color: var(--muted); }
    .lesson-persepsi .pipe-arrow { flex: none; display: grid; place-items: center; color: var(--border-strong); }
    .lesson-persepsi .pipe-arrow.is-on { color: var(--accent); }
    .lesson-persepsi .ghost-btn { width: 100%; min-height: 44px; }
    .lesson-persepsi .grp-list .readout-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .lesson-persepsi .grp-list .data-table td, .lesson-persepsi .grp-list .data-table th { padding-top: 6px; padding-bottom: 6px; }
    .lesson-persepsi .id-cell { font-family: var(--mono); font-weight: 650; }
    .lesson-persepsi .num { font-family: var(--mono); }
    .lesson-persepsi .conf { display: inline-flex; align-items: center; gap: 8px; font-family: var(--mono); }
    .lesson-persepsi .conf-bar { position: relative; width: 64px; height: 6px; border-radius: 99px; background: var(--raised); }
    .lesson-persepsi .conf-bar i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 99px; background: var(--accent); }
    .lesson-persepsi .conf-bar b { position: absolute; top: -3px; bottom: -3px; width: 2px; margin-left: -1px; border-radius: 1px; background: var(--text); }
    .lesson-persepsi tr.is-filtered > * { color: var(--muted); }
    .lesson-persepsi tr.is-filtered .conf-bar i { background: #475569; }
    .lesson-persepsi .tag { display: inline-block; margin-left: 6px; padding: 1px 7px; border-radius: 999px; font-size: .72rem; font-weight: 700; line-height: 1.5; vertical-align: 1px; }
    .lesson-persepsi .tag-danger { background: rgba(239, 68, 68, .16); color: #fca5a5; }
    .lesson-persepsi .tag-muted { background: var(--raised); color: var(--muted); }
    .lesson-persepsi .warn-banner { position: absolute; left: 10px; right: 10px; bottom: 46px; z-index: 2; width: fit-content; margin: 0 auto;
      display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 12px;
      border: 1px solid rgba(239, 68, 68, .65); background: rgba(69, 10, 10, .9); color: #fecaca; font-size: .9rem; font-weight: 700;
      line-height: 1.3; box-shadow: var(--shadow); pointer-events: none; }
    .lesson-persepsi .warn-banner .icon { color: #f87171; }
    .lesson-persepsi .warn-banner[hidden] { display: none; }
    @media (max-width: 1100px) {
      .lesson-persepsi .grp-list .readout-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 600px) {
      .lesson-persepsi .pipe { gap: 1px; }
      .lesson-persepsi .pipe-stage { flex: 1 1 auto; padding: 7px 4px; }
      .lesson-persepsi .pipe-name { font-size: .7rem; }
      .lesson-persepsi .pipe-sub { display: none; }
      .lesson-persepsi .pipe-arrow .icon { width: .75em; height: .75em; }
      .lesson-persepsi .grp-list .data-table { font-size: .8rem; }
      .lesson-persepsi .grp-list .data-table thead th { font-size: .68rem; }
      .lesson-persepsi .grp-list .data-table th, .lesson-persepsi .grp-list .data-table td { padding-left: 5px; padding-right: 5px; }
      .lesson-persepsi .grp-list .cls-cell { white-space: normal; }
      .lesson-persepsi .grp-list .tag { display: block; width: fit-content; margin: 3px 0 0; }
      .lesson-persepsi .conf-bar { display: none; }
      .lesson-persepsi .warn-banner { font-size: .8rem; padding: 7px 10px; bottom: 44px; }
    }
  `,

  mount(ctx) {
    // ---------- model ----------
    const scene = createScene({ seed: 11 });
    const perc = createPerception({ seed: 23 });
    const show = { kamera: true, lidar: false, radar: false, fusion: false, tracking: false, prediction: false };
    let threshold = DEFAULT_THRESHOLD / 100;
    let acc = 0;
    let items = []; // objek hasil fusi atau pelacakan yang sedang ditampilkan
    let conflict = null;
    const holds = {};

    // ---------- kanvas dan loop ----------
    const labels = createLabelLayer();
    const bounds = (v) => {
      const x = scene.ego.x;
      return v.aspect < 1.4 ? { minX: x - 6, minY: -10, maxX: x + 31, maxY: 8 } : { minX: x - 10, minY: -10.5, maxX: x + 44, maxY: 8.5 };
    };
    const view = ctx.createView({
      label: 'Jalan kota tampak atas. Mobil otonom berwarna hijau toska melaju ke kanan di lajur kiri, melewati mobil parkir, pejalan kaki, pesepeda, dan mobil dari arah berlawanan.',
      background: COLORS.sidewalk,
      bounds,
      padding: 10,
    });
    const banner = ui.el('div', { class: 'warn-banner', hidden: true, 'aria-hidden': 'true' });
    banner.innerHTML = `${icon('alert')}<span></span>`;
    ctx.stage.append(banner);

    perc.tick(scene.world());
    ctx.createLoop({
      update(dt) {
        scene.update(dt);
        acc += dt;
        while (acc >= SCAN_DT - 1e-9) {
          acc -= SCAN_DT;
          perc.tick(scene.world(), SCAN_DT);
        }
      },
      render,
    });

    // ---------- panel kontrol ----------
    const pipeGroup = ui.group(ctx.controls, { title: 'Alur persepsi', wide: true, className: 'grp-pipe' });
    const pipe = ui.el('ol', { class: 'pipe' });
    const stageEls = {};
    const arrowEls = [];
    STAGES.forEach((s, i) => {
      if (i > 0) {
        const arrow = ui.el('li', { class: 'pipe-arrow', 'aria-hidden': 'true', html: icon('chevronRight') });
        arrowEls.push(arrow);
        pipe.append(arrow);
      }
      const stateEl = ui.el('span', { class: 'visually-hidden' });
      const li = ui.el('li', { class: 'pipe-stage' }, ui.el('span', { class: 'pipe-name', text: s.name }), ui.el('span', { class: 'pipe-sub', text: s.sub }), stateEl);
      stageEls[s.key] = { li, stateEl };
      pipe.append(li);
    });
    pipeGroup.append(pipe);
    pipeGroup.append(ui.el('p', { class: 'ctl-hint', text: 'Tahap yang menyala sedang digambar di simulasi. Di dalam mobil, semua tahap selalu berjalan.' }));

    const rawGroup = ui.group(ctx.controls, { title: 'Data mentah sensor' });
    const rawToggles = {};
    for (const key of SENSOR_KEYS) {
      rawToggles[key] = ui.toggle(rawGroup, { label: SENSOR_LABELS[key], color: COLORS[key], hint: SENSOR_HINTS[key], onChange: (on) => setRaw(key, on) });
    }
    const ghostBtn = ui.button(rawGroup, { label: 'Munculkan pantulan palsu', icon: 'sparkle', onClick: spawnGhost });
    ghostBtn.classList.add('ghost-btn');
    rawGroup.append(ui.el('p', { class: 'ctl-hint', text: 'Radar menangkap pantulan dari tutup gorong-gorong di depan mobil.' }));

    const stageGroup = ui.group(ctx.controls, { title: 'Tahap pengolahan' });
    const stageToggles = {
      fusion: ui.toggle(stageGroup, { label: 'Fusi', color: FUSED, hint: 'Gabungkan deteksi antarsensor', onChange: (on) => setStage('fusion', on) }),
      tracking: ui.toggle(stageGroup, { label: 'Pelacakan', color: FUSED, hint: 'ID dan jejak, butuh fusi', onChange: (on) => setStage('tracking', on) }),
      prediction: ui.toggle(stageGroup, { label: 'Prediksi', color: PRED, hint: '3 detik ke depan, butuh pelacakan', onChange: (on) => setStage('prediction', on) }),
    };
    ui.legend(stageGroup, [
      { color: FUSED, label: 'Objek hasil fusi', shape: 'square' },
      { color: PRED, label: 'Prediksi', shape: 'line' },
      { color: COLORS.accent, label: 'Jalur rencana', shape: 'line' },
      { color: DANGER, label: 'Ditolak atau terlewat', shape: 'dot' },
    ]);

    const setGroup = ui.group(ctx.controls, { title: 'Pengaturan' });
    const noiseSlider = ui.slider(setGroup, {
      label: 'Derau sensor',
      min: 0.5,
      max: 3,
      step: 0.25,
      value: DEFAULT_NOISE,
      format: (v) => `${fmt(v, Number.isInteger(v) ? 0 : v * 2 === Math.round(v * 2) ? 1 : 2)}x`,
      hint: 'Mengalikan galat pengukuran ketiga sensor.',
      onInput: (v) => setNoise(v),
    });
    const thrSlider = ui.slider(setGroup, {
      label: 'Ambang keyakinan',
      min: 10,
      max: 99,
      step: 1,
      value: DEFAULT_THRESHOLD,
      format: (v) => `${fmt(v, 0)}%`,
      hint: 'Objek di bawah ambang tidak dilaporkan ke perencanaan.',
      onInput: (v) => setThreshold(v),
    });

    const listGroup = ui.group(ctx.controls, { title: 'Objek hasil persepsi', wide: true, className: 'grp-list' });
    const readouts = ui.readoutGrid(listGroup);
    const outReported = ui.readout(readouts, { label: 'Dilaporkan', value: '0' });
    const outFiltered = ui.readout(readouts, { label: 'Di bawah ambang', value: '0' });
    const outGhosts = ui.readout(readouts, { label: 'Pantulan ditolak', value: '0' });
    const outEgo = ui.readout(readouts, { label: 'Kecepatan mobilmu', value: '0 km/jam', color: COLORS.accent });
    const table = ui.dataTable(listGroup, {
      caption: 'Objek hasil fusi atau pelacakan, diurutkan dari yang terdekat',
      columns: [
        { key: 'id', label: 'ID', className: 'id-cell' },
        { key: 'cls', label: 'Kelas', className: 'cls-cell' },
        { key: 'dist', label: 'Jarak', align: 'right', className: 'num' },
        { key: 'speed', label: 'Kecepatan', align: 'right', className: 'num' },
        { key: 'conf', label: 'Keyakinan' },
      ],
      empty: 'Nyalakan Fusi untuk melihat daftar objek.',
    });
    const listHint = ui.el('p', { class: 'ctl-hint' });
    listGroup.append(listHint);

    // HUD di atas kanvas
    const speedChip = ui.hudChip(ctx.hud, { label: 'Mobilmu', color: COLORS.accent });
    const countChip = ui.hudChip(ctx.hud, { label: 'Objek dilaporkan', color: FUSED });

    // ---------- aksi ----------
    function syncToggles() {
      for (const key of SENSOR_KEYS) rawToggles[key].set(show[key]);
      for (const key of Object.keys(stageToggles)) stageToggles[key].set(show[key]);
    }

    function setRaw(key, on) {
      show[key] = !!on;
      syncToggles();
      refreshPanels(0);
    }

    // Tahap mengikuti urutan alur: pelacakan butuh fusi, prediksi butuh pelacakan.
    function setStage(key, on) {
      show[key] = !!on;
      if (on && key === 'tracking') show.fusion = true;
      if (on && key === 'prediction') {
        show.tracking = true;
        show.fusion = true;
      }
      if (!on && key === 'fusion') {
        show.tracking = false;
        show.prediction = false;
      }
      if (!on && key === 'tracking') show.prediction = false;
      syncToggles();
      refreshPanels(0);
    }

    function setNoise(v) {
      perc.setNoise(v);
      noiseSlider.set(v);
      if (ctx.paused) perc.rescan(scene.world());
    }

    function setThreshold(v) {
      threshold = v / 100;
      thrSlider.set(v);
      refreshPanels(0);
    }

    function spawnGhost() {
      const g = perc.spawnGhost(scene.world());
      if (!g) {
        ctx.toast('Belum ada tutup gorong-gorong di depan radar. Coba lagi sebentar lagi.', { tone: 'warn' });
        return;
      }
      if (!show.radar && !show.fusion) setRaw('radar', true);
      if (ctx.paused) perc.rescan(scene.world());
      refreshPanels(0);
    }

    // ---------- membaca hasil persepsi ----------
    function perceived() {
      if (!show.fusion) return [];
      const ego = scene.ego;
      const dist = (x, y) => Math.hypot(x - ego.x, y - ego.y);
      if (show.tracking) {
        return perc.tracks
          .filter((t) => t.confirmed)
          .map((t) => {
            const m = trackMotion(t);
            return {
              track: t,
              id: t.id,
              x: t.x[0],
              y: t.x[1],
              cls: t.cls,
              conf: t.conf,
              speed: m.speed,
              speedSd: m.speedSd,
              heading: t.heading,
              size: t.size,
              truth: t.truth,
              members: t.last ? t.last.members : [],
              dist: dist(t.x[0], t.x[1]),
            };
          });
      }
      return perc.last.fused.map((f) => ({
        track: null,
        id: null,
        x: f.x,
        y: f.y,
        cls: f.cls,
        conf: f.conf,
        speed: null,
        heading: f.heading,
        size: f.size,
        truth: f.truth,
        members: f.members,
        dist: dist(f.x, f.y),
      }));
    }

    // dibandingkan dalam persen bulat, sama dengan angka yang tampil di layar
    const reported = (o) => Math.round(o.conf * 100) >= Math.round(threshold * 100);
    const canPredict = (o) => !!o.track && predictable(o.track);
    // tanda kunci jawaban (terlewat, palsu) baru muncul mulai langkah Ambang keyakinan
    const answerKey = () => ctx.currentStep() >= 3;
    const onScreen = (x, y, margin = 1) => {
      const b = view.visibleBounds();
      return x >= b.minX - margin && x <= b.maxX + margin && y >= b.minY - margin && y <= b.maxY + margin;
    };
    const halfWidth = (o) => (o.cls === 'pedestrian' || o.cls === 'cyclist' ? 0.35 : o.size.width / 2);

    function corridor() {
      const ego = scene.ego;
      const x0 = ego.x + ego.length / 2;
      return { x0, x1: x0 + CORRIDOR_LEN, y: LANE_Y, half: ego.width / 2 + 0.6 };
    }

    function computeConflict() {
      if (!show.prediction) return null;
      const cands = items.filter((o) => reported(o) && canPredict(o)).map((o) => ({ track: o.track, cls: o.cls, halfWidth: halfWidth(o) }));
      return findConflict(cands, corridor(), HORIZON);
    }

    function seenByAllThree() {
      const L = perc.last;
      const ids = (dets) => new Set(dets.filter((d) => d.truth != null).map((d) => d.truth));
      const cam = ids(L.camera.dets);
      const lid = ids(L.lidar.dets);
      return L.radar.dets.some((d) => d.truth != null && cam.has(d.truth) && lid.has(d.truth));
    }

    // ---------- deteksi tugas ----------
    const TASK_CHECKS = {
      'raw-view': { hold: 1.5, test: () => show.kamera && show.lidar && show.radar && seenByAllThree() },
      'fusion-on': { hold: 1.5, test: () => show.fusion && perc.last.fused.filter((f) => f.sensors.size >= 2).length >= 2 },
      'ghost-rejected': { hold: 0.3, test: () => show.fusion && !!perc.manualGhostRejected() },
      threshold: { hold: 1, test: () => show.fusion && threshold >= 0.9 - 1e-9 && items.some((o) => o.truth != null && !reported(o) && o.x > scene.ego.x && onScreen(o.x, o.y, -1)) },
      predict: { hold: 0.4, test: () => show.prediction && !!conflict && !conflict.inPath && conflict.cls === 'pedestrian' },
    };

    function checkTasks(realDt) {
      // hanya tugas milik langkah yang sedang dibuka yang diperiksa
      const taskId = ctx.lesson.steps[ctx.currentStep()]?.taskId;
      if (!taskId || ctx.isTaskDone(taskId)) return;
      const check = TASK_CHECKS[taskId];
      if (!check) return;
      holds[taskId] = check.test() ? (holds[taskId] || 0) + realDt : 0;
      if (holds[taskId] >= check.hold) ctx.completeTask(taskId);
    }

    // ---------- pembaruan panel (dari render, sekitar 8 kali per detik) ----------
    let lastPanel = 0;
    function confHtml(p) {
      const w = Math.round(Math.max(0, Math.min(1, p)) * 100);
      const t = Math.round(threshold * 100);
      return `<span class="conf"><span class="conf-bar" aria-hidden="true"><i style="width: ${w}%"></i><b style="left: ${t}%"></b></span>${pct(p)}</span>`;
    }

    function refreshPanels(realDt) {
      if (realDt === 0) {
        items = perceived();
        conflict = computeConflict();
      }
      // alur persepsi
      const rawOn = SENSOR_KEYS.some((k) => show[k]);
      const on = { raw: rawOn, det: rawOn, fusion: show.fusion, tracking: show.tracking, prediction: show.prediction };
      STAGES.forEach((s, i) => {
        const el = stageEls[s.key];
        el.li.classList.toggle('is-on', on[s.key]);
        el.stateEl.textContent = on[s.key] ? ' (tampil)' : ' (tidak tampil)';
        if (i > 0) arrowEls[i - 1].classList.toggle('is-on', on[s.key] && on[STAGES[i - 1].key]);
      });

      // daftar objek
      const rep = items.filter(reported);
      const filtered = items.filter((o) => !reported(o));
      const rows = items
        .slice()
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 9)
        .map((o) => {
          const ok = reported(o);
          let tag = '';
          if (answerKey() && o.truth == null) tag = `<span class="tag ${ok ? 'tag-danger' : 'tag-muted'}">palsu</span>`;
          else if (answerKey() && !ok) tag = '<span class="tag tag-danger">terlewat</span>';
          return {
            _class: ok ? '' : 'is-filtered',
            id: o.id != null ? `#${o.id}` : '-',
            cls: { html: `${CLASS_NAMES[o.cls]}${tag}` },
            dist: fmt(o.dist, 1, 'm'),
            // kecepatan jejak yang baru lahir belum bisa dipercaya
            speed: o.speed != null && o.speedSd < 1 ? fmt(msToKmh(o.speed), 0, 'km/jam') : '-',
            conf: { html: confHtml(o.conf) },
          };
        });
      table.setRows(rows);
      let hint = 'Diurutkan dari yang terdekat. Baris redup berada di bawah ambang sehingga tidak diteruskan ke perencanaan.';
      if (show.fusion && !show.tracking) hint += ' ID dan kecepatan terisi setelah Pelacakan menyala.';
      else if (show.tracking) hint += ' Kecepatan kosong selama perkiraannya belum cukup pasti.';
      if (listHint.textContent !== hint) listHint.textContent = hint;

      outReported.set(show.fusion ? fmt(rep.length) : '-');
      outFiltered.set(show.fusion ? fmt(filtered.length) : '-');
      outFiltered.setTone(show.fusion && answerKey() && filtered.some((o) => o.truth != null) ? 'warn' : '');
      outGhosts.set(show.fusion ? fmt(perc.stats.rejectedTotal) : '-');
      outEgo.set(fmt(msToKmh(scene.ego.speed), 0, 'km/jam'));

      // HUD dan peringatan
      speedChip.set(fmt(msToKmh(scene.ego.speed), 0, 'km/jam'));
      countChip.show(show.fusion);
      countChip.set(fmt(rep.length));

      checkTasks(realDt);
      updateStatus(rep.length, filtered.length);
    }

    let bannerText = '';
    function updateBanner() {
      const text = conflictText();
      if (text === bannerText) return;
      bannerText = text;
      banner.hidden = !text;
      if (text) banner.querySelector('span').textContent = text;
    }

    function conflictText() {
      if (!conflict) return '';
      const who = SUBJECT[conflict.cls] || SUBJECT.unknown;
      return conflict.inPath ? `${who} sedang berada di jalurmu` : `${who} diprediksi masuk jalurmu dalam ${fmt(conflict.tau, 1, 'detik')}`;
    }

    // ---------- baris status ----------
    function updateStatus(nRep, nFilt) {
      const parts = [];
      const text = conflictText();
      if (text) parts.push(text);
      if (scene.state.yielding) parts.push('Mobil melambat untuk memberi jalan pejalan kaki');
      else if (!text) parts.push(`Mobil melaju ${fmt(msToKmh(scene.ego.speed), 0, 'km/jam')}`);
      const L = perc.last;
      if (show.fusion) {
        parts.push(`Fusi melaporkan ${nRep} objek${nFilt ? `, ${nFilt} di bawah ambang ${pct(threshold)}` : ''}`);
        if (L.rejected.length && !text) parts.push('Pantulan radar palsu ditolak');
      } else if (SENSOR_KEYS.some((k) => show[k])) {
        const seg = [];
        if (show.kamera) seg.push(`kamera ${L.camera.dets.length} deteksi`);
        if (show.lidar) seg.push(`LiDAR ${L.lidar.dets.length} klaster`);
        if (show.radar) seg.push(`radar ${L.radar.dets.length} target`);
        parts.push(seg.join(', '));
      } else parts.push('Semua tampilan mati. Nyalakan data mentah atau fusi di panel kontrol');
      // saat ada peringatan, cukup dua kalimat supaya tidak terpotong
      ctx.setStatus(`${parts.slice(0, text ? 2 : 3).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('. ')}.`);
    }

    // ---------- menggambar ----------
    function render() {
      view.fit(bounds); // kamera mengikuti mobil otonom
      items = perceived();
      conflict = computeConflict();
      const g = view.begin(COLORS.sidewalk);
      scene.draw(g, { view, underlay: show.prediction ? drawCorridor : null });
      addConflictLabel();
      drawRaw(g);
      drawFusion(g);
      drawPrediction(g);
      labels.draw(g, view);
      drawScaleBar(g, view);
      updateBanner();

      const now = performance.now();
      if (now - lastPanel > 120) {
        refreshPanels(lastPanel ? Math.min(0.5, (now - lastPanel) / 1000) : 0.001);
        lastPanel = now;
      }
    }

    function mountPose(forward) {
      const e = scene.ego;
      return { x: e.x + Math.cos(e.heading) * forward, y: e.y + Math.sin(e.heading) * forward, heading: e.heading };
    }

    function drawEllipse(g, x, y, cov, color, { alpha = 1, fill = 0.08, stroke = 0.6, width = 1, dash = null } = {}) {
      const e = ellipseOf(cov);
      g.save();
      g.globalAlpha *= alpha;
      g.beginPath();
      g.ellipse(x, y, Math.max(e.rx, view.px(2)), Math.max(e.ry, view.px(2)), e.angle, 0, TAU);
      if (fill) {
        g.fillStyle = withAlpha(color, fill);
        g.fill();
      }
      g.strokeStyle = withAlpha(color, stroke);
      g.lineWidth = view.px(width);
      if (dash) g.setLineDash(dash.map((d) => view.px(d)));
      g.stroke();
      g.restore();
    }

    function drawDiamond(g, x, y, color, alpha = 1, size = 5) {
      const s = view.px(size);
      g.save();
      g.globalAlpha *= alpha;
      g.fillStyle = color;
      g.strokeStyle = '#0b1220';
      g.lineWidth = view.px(1.2);
      g.beginPath();
      g.moveTo(x, y - s);
      g.lineTo(x + s, y);
      g.lineTo(x, y + s);
      g.lineTo(x - s, y);
      g.closePath();
      g.fill();
      g.stroke();
      g.restore();
    }

    const boxOf = (o, size = o.size) => ({ x: o.x, y: o.y, heading: o.heading || 0, length: size.length, width: size.width });
    // setengah tinggi kotak di layar (px), untuk menaruh label tepat di atas atau di bawahnya
    const halfPx = (size, heading) => ((Math.abs(Math.sin(heading)) * size.length + Math.abs(Math.cos(heading)) * size.width) / 2 + 0.35) * view.camera.scale;
    // Sisi label: 1 = di bawah objek, -1 = di atasnya. Label menjauhi tengah jalan supaya mobilmu
    // dan lajurnya tidak tertutup. Objek yang bergerak melintang (misalnya menyeberang) diberi
    // label di sisi belakang geraknya supaya panah dan garis prediksinya tetap terlihat.
    function labelSide(o) {
      if (show.tracking && canPredict(o)) {
        const vx = o.track.x[2];
        const vy = o.track.x[3];
        if (Math.abs(vy) > Math.abs(vx)) return vy < 0 ? 1 : -1;
      }
      return o.y > 0 ? 1 : -1;
    }

    function drawCorridor(g) {
      const c = corridor();
      g.save();
      g.fillStyle = withAlpha(COLORS.accent, conflict ? 0.16 : 0.1);
      g.fillRect(c.x0, c.y - c.half, c.x1 - c.x0, c.half * 2);
      g.restore();
      const edge = { color: withAlpha(COLORS.accent, 0.75), width: 1.5, view, dash: [7, 5] };
      drawLine(g, [{ x: c.x0, y: c.y - c.half }, { x: c.x1, y: c.y - c.half }], edge);
      drawLine(g, [{ x: c.x0, y: c.y + c.half }, { x: c.x1, y: c.y + c.half }], edge);
    }

    function drawRaw(g) {
      const L = perc.last;
      const a = show.fusion ? 0.4 : 1;
      const labelRaw = !show.fusion;
      if (show.radar) {
        const p = mountPose(RADAR.forward);
        drawSensorCone(g, p, p.heading, RADAR.fov, RADAR.range, COLORS.radar, { view, fillAlpha: 0.06, strokeAlpha: 0.35 });
      }
      if (show.kamera) {
        const p = mountPose(CAMERA.forward);
        drawSensorCone(g, p, p.heading, CAMERA.fov, CAMERA.range, COLORS.kamera, { view, fillAlpha: 0.04, strokeAlpha: 0.3 });
      }
      if (show.lidar) {
        const p = mountPose(LIDAR.forward);
        drawRing(g, p.x, p.y, LIDAR.range, { color: withAlpha(COLORS.lidar, 0.4), width: 1, view, dash: [4, 6] });
        const bg = [];
        const rel = [];
        for (const pt of L.lidar.points) (pt.rel ? rel : bg).push(pt);
        drawPointCloud(g, bg, COLORS.lidar, { view, size: 2, alpha: 0.55 * a });
        drawPointCloud(g, rel, COLORS.lidar, { view, size: 2.8, alpha: a });
        for (const d of L.lidar.dets) {
          if (!d.box) continue;
          const pad = 0.3;
          g.save();
          g.globalAlpha *= 0.8 * a;
          g.strokeStyle = COLORS.lidar;
          g.lineWidth = view.px(1.2);
          g.setLineDash([view.px(3), view.px(3)]);
          g.strokeRect(d.box.minX - pad, d.box.minY - pad, d.box.maxX - d.box.minX + 2 * pad, d.box.maxY - d.box.minY + 2 * pad);
          g.restore();
        }
      }
      if (show.kamera) {
        for (const d of L.camera.dets) {
          drawEllipse(g, d.x, d.y, d.cov, COLORS.kamera, { alpha: a });
          const size = { length: d.cls === 'car' ? 4.5 : d.cls === 'cyclist' ? 1.8 : 0.8, width: d.cls === 'car' ? 1.8 : d.cls === 'cyclist' ? 0.7 : 0.8 };
          drawBracketBox(g, boxOf(d, size), COLORS.kamera, { view, pad: 0.3, width: 1.8, alpha: a });
          // label kamera menjauhi tengah jalan, label radar ke arah sebaliknya
          const side = d.y > 0 ? 1 : -1;
          if (labelRaw && onScreen(d.x, d.y)) labels.add(d.x, d.y, `${CLASS_NAMES[d.cls]} ${pct(d.conf)}`, { color: COLORS.kamera, dy: side * (halfPx(size, d.heading) + 10), size: 10.5 });
        }
      }
      if (show.radar) {
        for (const d of L.radar.dets) {
          drawEllipse(g, d.x, d.y, d.cov, COLORS.radar, { alpha: a });
          drawDiamond(g, d.x, d.y, COLORS.radar, a);
          const side = d.y > 0 ? -1 : 1;
          if (labelRaw && onScreen(d.x, d.y)) labels.add(d.x, d.y, fmtSigned(msToKmh(d.relSpeed), 0, 'km/jam'), { color: COLORS.radar, dy: side * 17, size: 10.5, mono: true });
        }
      }
    }

    function drawFusion(g) {
      if (!show.fusion) return;
      const rawOn = SENSOR_KEYS.some((k) => show[k]);
      for (const o of items) {
        if (!reported(o)) {
          if (o.truth != null && answerKey() && onScreen(o.x, o.y)) {
            // kunci jawaban: objek nyata yang tidak dilaporkan
            const r = Math.max(Math.max(o.size.length, o.size.width) / 2 + 0.6, view.px(15));
            drawRing(g, o.x, o.y, r, { color: DANGER, width: 2, view, dash: [5, 4] });
            labels.add(o.x, o.y, 'terlewat', { color: DANGER_TEXT, bg: DANGER_BG, dy: labelSide(o) * (r * view.camera.scale + 10), size: 10.5 });
          }
          continue;
        }
        if (rawOn) {
          for (const m of o.members) {
            if (!show[m.sensor]) continue;
            drawLine(g, [{ x: m.x, y: m.y }, { x: o.x, y: o.y }], { color: FUSED, width: 1, view, alpha: 0.55 });
          }
        }
        if (show.tracking && o.track && o.track.trail.length > 1) {
          drawLine(g, o.track.trail, { color: FUSED, width: 1.5, view, alpha: 0.3 });
        }
        drawBracketBox(g, boxOf(o), FUSED, { view, pad: 0.35, width: 2.2 });
        if (show.tracking && !show.prediction && canPredict(o)) {
          drawArrow(g, { x: o.x, y: o.y }, { x: o.x + o.track.x[2], y: o.y + o.track.x[3] }, { color: FUSED, width: 2, view, alpha: 0.85 });
        }
        if (!onScreen(o.x, o.y)) continue;
        const hp = halfPx(o.size, o.heading);
        const side = labelSide(o);
        const text = show.tracking ? `#${o.id} ${CLASS_NAMES[o.cls]}` : `${CLASS_NAMES[o.cls]} ${pct(o.conf)}`;
        labels.add(o.x, o.y, text, { color: FUSED, dy: side * (hp + 11), size: 11 });
        // tanda kunci jawaban ditumpuk di sisi yang sama, sedikit lebih jauh
        if (o.truth == null && answerKey()) labels.add(o.x, o.y, 'positif palsu', { color: DANGER_TEXT, bg: DANGER_BG, dy: side * (hp + 32), size: 10.5 });
      }
      for (const r of perc.last.rejected) {
        const s = view.px(9);
        drawRing(g, r.x, r.y, view.px(13), { color: DANGER, width: 2, view, fill: withAlpha(DANGER, 0.15) });
        drawLine(g, [{ x: r.x - s, y: r.y - s }, { x: r.x + s, y: r.y + s }], { color: DANGER, width: 2.2, view });
        drawLine(g, [{ x: r.x - s, y: r.y + s }, { x: r.x + s, y: r.y - s }], { color: DANGER, width: 2.2, view });
        if (onScreen(r.x, r.y)) labels.add(r.x, r.y, 'ditolak: hanya radar', { color: DANGER_TEXT, bg: DANGER_BG, dy: 24, size: 10.5 });
      }
    }

    function drawPrediction(g) {
      if (!show.prediction) return;
      for (const o of items) {
        if (!reported(o) || !canPredict(o)) continue;
        const isConflict = conflict && conflict.track === o.track;
        const color = isConflict ? DANGER : PRED;
        const pts = predictTrack(o.track, HORIZON, 0.25);
        // pita ketidakpastian: lebarnya satu simpangan baku ke samping arah gerak, makin jauh makin lebar
        const v = Math.hypot(o.track.x[2], o.track.x[3]) || 1;
        const nx = -o.track.x[3] / v;
        const ny = o.track.x[2] / v;
        const side = (p, k) => {
          const sd = Math.sqrt(Math.max(1e-6, p.cov[0] * nx * nx + 2 * p.cov[1] * nx * ny + p.cov[2] * ny * ny));
          return { x: p.x + nx * sd * k, y: p.y + ny * sd * k };
        };
        g.save();
        g.fillStyle = withAlpha(color, 0.13);
        g.beginPath();
        pts.forEach((p, i) => {
          const q = side(p, 1);
          if (i) g.lineTo(q.x, q.y);
          else g.moveTo(q.x, q.y);
        });
        for (let i = pts.length - 1; i >= 0; i--) {
          const q = side(pts[i], -1);
          g.lineTo(q.x, q.y);
        }
        g.closePath();
        g.fill();
        g.restore();
        const end = pts[pts.length - 1];
        drawEllipse(g, end.x, end.y, end.cov, color, { fill: 0, stroke: 0.6, dash: [4, 4] });
        drawLine(g, pts, { color, width: 2.2, view, dash: [7, 5] });
        for (const p of pts) {
          if (p.t > 0 && Math.abs(p.t - Math.round(p.t)) < 1e-6) drawRing(g, p.x, p.y, view.px(p.t === HORIZON ? 3.5 : 2.5), { color, width: 1.5, view, fill: color });
        }
      }
      if (conflict && !conflict.inPath) {
        drawRing(g, conflict.x, conflict.y, view.px(7), { color: DANGER, width: 2.5, view, fill: withAlpha(DANGER, 0.35) });
      }
    }

    // Label waktu konflik ditambahkan paling awal supaya lapisan label memberinya tempat persis
    // di kanan titik konflik (di lajur mobilmu, bukan di atas pejalan kakinya).
    function addConflictLabel() {
      if (!show.prediction || !conflict || conflict.inPath || !onScreen(conflict.x, conflict.y)) return;
      labels.add(conflict.x, conflict.y, fmt(conflict.tau, 1, 'detik'), { color: DANGER_TEXT, bg: DANGER_BG, dx: 12, dy: 0, align: 'left', size: 11, mono: true });
    }

    // ---------- antarmuka ke shell ----------
    syncToggles();
    return {
      onStep(i) {
        const preset = STEP_PRESETS[i];
        if (!preset) return;
        if (preset.raw) for (const [k, v] of Object.entries(preset.raw)) show[k] = v;
        show.fusion = preset.fusion;
        show.tracking = preset.tracking;
        show.prediction = preset.prediction;
        syncToggles();
        setThreshold(DEFAULT_THRESHOLD);
        setNoise(DEFAULT_NOISE);
        for (const k of Object.keys(holds)) holds[k] = 0;
        refreshPanels(0);
      },
      reset() {
        scene.reset();
        perc.reset();
        acc = 0;
        perc.tick(scene.world());
        for (const k of Object.keys(holds)) holds[k] = 0;
        refreshPanels(0);
      },
      destroy() {
        // Kanvas, loop, dan listener dibersihkan otomatis oleh ctx. Banner ada di dalam stage
        // yang ikut dibuang bersama halaman.
      },
    };
  },
};
