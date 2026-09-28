// Pelajaran 4: Lokalisasi.
//
// Mobil otonom berkeliling blok Kayutangan di utara Alun-alun Merdeka Malang, di jalan-jalan asli
// dari OpenStreetMap (Jalan Merdeka Utara, Jalan Jenderal Basuki Rachmat, Jalan Majapahit, Jalan
// Mgr. Sugiyopranoto). Pelajar membandingkan beberapa cara menebak posisi mobil dengan posisi
// sebenarnya (kotak putus-putus putih):
//   GPS        posisi dari satelit, galat beberapa meter, melompat di zona gedung tinggi
//   Odometri   dead reckoning dari laju roda dan giroskop, halus tetapi drift
//   Fusi       filter Kalman: prediksi dengan odometri, koreksi dengan GPS (selalu berjalan
//              di latar, sakelarnya hanya menampilkan)
//   Peta       filter yang sama ditambah pencocokan LiDAR dengan landmark di peta HD
//
// Pola sama dengan pelajaran contoh (sensor.js): rute dan data jalan di ./lokalisasi/route.js,
// dunia di ./lokalisasi/scene.js, perisai keselamatan di ./lokalisasi/safety.js, model sensor dan
// estimator di ./lokalisasi/estimators.js, grafik galat di ./lokalisasi/chart.js.
// Tugas diperiksa di update() memakai waktu simulasi, hanya untuk langkah yang sedang dibuka.

import { COLORS, withAlpha, FONT } from '../engine/theme.js';
import { fmt, clamp, approach, wrapAngle, TAU, Rng } from '../engine/math.js';
import { drawLine, drawRing, drawScaleBar, createLabelLayer, drawLabel, createLidarTrail, drawLidarRange, drawLidarSweep, lidarSweepAngle, roundRectPath } from '../engine/draw.js';
import { rayPolygon } from '../engine/geometry.js';
import { Sensor } from '../engine/sensors.js';
import * as ui from '../engine/ui.js';
import { buildRoute, streetLabel } from './lokalisasi/route.js';
import { createScene, LANE_OUT, TAKEOVER_AT } from './lokalisasi/scene.js';
import { GpsReceiver, WheelImu, DeadReckoning, PoseFilter, LidarLandmarks, LIDAR_PERIOD, CHI2_95 } from './lokalisasi/estimators.js';
import { logChart } from './lokalisasi/chart.js';

const EST = [
  { id: 'gps', name: 'GPS', color: '#f472b6', toggle: 'GPS' },
  { id: 'odo', name: 'Odometri', color: '#a3e635', toggle: 'Odometri dan IMU' },
  { id: 'fus', name: 'Fusi', color: '#a78bfa', toggle: 'Fusi (filter Kalman)' },
  { id: 'map', name: 'Peta', color: '#22d3ee', toggle: 'Pencocokan peta (LiDAR)' },
];
const EST_BY_ID = Object.fromEntries(EST.map((e) => [e.id, e]));
const K95 = Math.sqrt(CHI2_95); // jari-jari 95% dalam satuan simpangan baku (2D)
const AVG_WINDOW = 20; // detik untuk rata-rata galat
const MINI_HEAD = 16; // tinggi baris judul peta mini (px)
const LIDAR_VIEW = { range: 40, rays: 240, rate: 5 }; // tampilan titik LiDAR (jangkauan dipendekkan supaya muat di layar)

// Preset tiap langkah: estimasi yang tampil, estimasi untuk kemudi, dan posisi mobil.
// Estimasi yang diuji tiap langkah selalu dimatikan dulu, jadi tugasnya butuh aksi pelajar.
const STEP_PRESETS = [
  { show: { gps: false, odo: false, fus: false, map: false }, sel: 'gps', sigma: 2 },
  { show: { gps: false, odo: false, fus: false, map: false }, sel: 'gps', beforeCanyon: true },
  { show: { gps: false, odo: false, fus: false, map: false }, sel: 'odo' },
  { show: { gps: true, odo: true, fus: false, map: false }, sel: 'fus' },
  { show: { gps: true, odo: false, fus: true, map: false }, sel: 'map' },
];

const fmtErr = (e) => (!Number.isFinite(e) ? '-' : e < 0.995 ? fmt(e, 2, 'm') : fmt(e, 1, 'm'));

export default {
  id: 'lokalisasi',
  title: 'Lokalisasi',
  layout: 'sim',
  intro:
    '<p>Sebelum bisa menjaga lajur, mobil otonom harus tahu di mana ia berada. Tugas ini disebut <strong>lokalisasi</strong>. Di pelajaran ini mobil berkeliling blok Kayutangan di utara Alun-alun Merdeka Malang, lewat jalan-jalan asli dari peta OpenStreetMap. Kamu membandingkan beberapa cara menebak posisinya dengan posisi yang sebenarnya.</p>',
  steps: [
    {
      title: 'GPS saja',
      body:
        '<p>Penerima <span class="chip" style="--c: #f472b6">GPS</span> menghitung posisi dari sinyal beberapa satelit. GPS biasa di mobil memberi posisi baru sekitar sekali per detik, dengan galat beberapa meter.</p>' +
        '<p>Lajur di jalan-jalan sekitar Alun-alun lebarnya sekitar 3,2 m (perkiraan dari data OSM), sedangkan mobil selebar 1,8 m. Sisa ruang di kiri dan kanan mobil hanya sekitar 0,7 m. Galat 2 m sudah cukup membuat mobil mengira dirinya ada di lajur sebelah atau di trotoar.</p>' +
        '<p class="note">Kotak putus-putus putih adalah posisi sebenarnya. Mobil sendiri tidak tahu posisi ini. Simulator menampilkannya sebagai kunci jawaban supaya kamu bisa mengukur galat tiap tebakan.</p>' +
        '<p>Coba juga nyalakan <strong>Kemudikan dengan estimasi</strong> di panel Kemudi. Mobil lalu menyetir memakai posisi GPS dan mulai oleng keluar lajur. Pejalan kaki tetap aman. Perisai keselamatan mengerem memakai jarak ke pejalan kaki yang diukur langsung oleh sensor, jadi tetap bekerja walaupun tebakan posisi mobil di peta meleset.</p>',
      task: { id: 'gps-only', text: 'Nyalakan <strong>GPS saja</strong> (estimasi lain mati), lalu amati titik GPS selama beberapa detik. Galatnya akan sering melebihi 2 m.' },
    },
    {
      title: 'Zona gedung tinggi',
      body:
        '<p>Di antara gedung tinggi, sebagian langit tertutup. Penerima hanya menangkap sedikit satelit, dan sebagian sinyal baru sampai setelah memantul di dinding gedung. Sinyal pantulan menempuh jalan yang lebih panjang, sehingga jarak ke satelit terukur terlalu jauh. Gejala ini disebut <strong>multipath</strong>.</p>' +
        '<p>Di rute ini, gedung paling rapat ada di Jalan Jenderal Basuki Rachmat (Kayutangan, dekat Sarinah Mall dan Gramedia) dan di Jalan Mgr. Sugiyopranoto. Zona gedung tinggi (garis kuning putus-putus) dihitung dari tinggi gedung dan jaraknya ke jalan, yaitu seberapa banyak langit yang tertutup di kiri dan kanan mobil.</p>' +
        '<p class="note">Tinggi gedung hampir semuanya perkiraan. Dari 3.816 gedung di data OSM sekitar Alun-alun, hanya 18 yang punya data tinggi. Sisanya ditebak dari jenis dan luas gedung, misalnya Sarinah Mall sekitar 15 m.</p>' +
        '<p>Akibatnya posisi GPS bisa melompat belasan meter, bahkan ke atas gedung. Penerima biasanya tidak sadar posisinya salah. Akurasi yang diklaimnya memang membesar (lingkaran putus-putus merah muda), tetapi lompatannya sering jatuh di luar lingkaran itu.</p>',
      task: { id: 'urban-canyon', text: 'Nyalakan <strong>GPS</strong>, lalu biarkan mobil melewati <strong>zona gedung tinggi</strong> (dibatasi garis kuning putus-putus) dan lihat posisi GPS melompat.' },
    },
    {
      title: 'Odometri dan IMU',
      body:
        '<p>Cara lain adalah <strong>dead reckoning</strong>. Mulai dari posisi yang diketahui, lalu jumlahkan gerak mobil sedikit demi sedikit. Sensor putaran roda (<span class="chip" style="--c: #a3e635">odometri</span>) mengukur laju, dan giroskop di dalam IMU mengukur kecepatan belok.</p>' +
        '<p>Hasilnya halus dan tidak terganggu gedung. Masalahnya, tiap sensor punya galat kecil yang tetap (bias). Di sini laju roda terbaca 2% terlalu cepat dan giroskop meleset 0,14 derajat per detik. Galat kecil itu ikut dijumlahkan terus, sehingga posisi makin lama makin melenceng. Gejala ini disebut <strong>drift</strong>.</p>' +
        '<p class="note">Bias di simulasi ini sengaja dibuat cukup besar supaya drift terlihat dalam setengah menit. Pada mobil sungguhan drift tumbuh lebih lambat, tetapi tetap tumbuh selama tidak ada koreksi.</p>',
      task: { id: 'odometry-drift', text: 'Nyalakan <strong>odometri saja</strong>, lalu tunggu sampai galatnya melebihi 3 m.' },
    },
    {
      title: 'Fusi dengan filter Kalman',
      body:
        '<p>GPS tidak drift tetapi melompat-lompat. Odometri halus tetapi drift. <span class="chip" style="--c: #a78bfa">Filter Kalman</span> menggabungkan keduanya dengan dua langkah yang terus berulang:</p>' +
        '<ol><li>Prediksi. Tebakan digeser memakai odometri, dan ketidakpastiannya membesar.</li>' +
        '<li>Koreksi. Saat posisi GPS datang, tebakan ditarik ke arahnya. Kuatnya tarikan bergantung pada perbandingan ketidakpastian keduanya (lihat <em>Bobot GPS</em>).</li></ol>' +
        '<p>Elips ungu adalah ketidakpastian menurut filter. Filter yakin 95% bahwa posisi sebenarnya ada di dalamnya. Posisi GPS yang terlalu jauh dari prediksi ditolak. Filter ini juga menebak bias roda dan giroskop, jadi drift ikut terkoreksi.</p>' +
        '<p>Hasilnya jauh lebih halus, tetapi galatnya masih sekitar 1 sampai 2 m. Bias GPS yang berubah pelan tidak bisa dihapus dengan odometri. Filter ini menganggap galat GPS berganti acak tiap detik, padahal biasnya bertahan lama. Karena itu filter sering terlalu yakin, dan kotak putus-putus putih cukup sering berada di luar elips.</p>',
      task: { id: 'fusion', text: 'Nyalakan <strong>Fusi</strong>, lalu bandingkan garisnya dengan GPS di grafik galat selama beberapa detik.' },
    },
    {
      title: 'Pencocokan peta',
      body:
        '<p>Mobil otonom membawa <strong>peta HD</strong> yang mencatat posisi benda tetap di sekitar jalan sampai hitungan sentimeter. <span class="chip" style="--c: #22d3ee">LiDAR</span> mengukur jarak dan arah ke benda-benda itu. Komputer lalu mencari posisi mobil yang membuat hasil ukur LiDAR paling berimpit dengan peta, dan hasilnya dipakai untuk mengoreksi filter.</p>' +
        '<p>Di sini peta HD berisi sudut gedung bernama dari OSM, misalnya Sarinah Mall, Gramedia, Gereja Kayutangan, dan Mall Pelayanan Publik Merdeka, ditambah tiang lampu dan rambu. Titik LiDAR digambar dari posisi tebakan. Saat tebakannya tepat, titik-titik itu jatuh pas di dinding gedung.</p>' +
        '<p>Galat turun ke beberapa sentimeter. Ketelitian setingkat desimeter atau lebih baik inilah yang dibutuhkan untuk tetap di tengah lajur. Coba nyalakan <strong>Kemudikan dengan estimasi</strong> dengan pilihan Peta.</p>' +
        '<p class="note">Tiang lampu dan rambu di simulasi ini adalah contoh. Posisinya dibuat oleh simulator dan tidak berasal dari OSM. Pencocokan butuh tebakan awal yang cukup dekat supaya tiap benda dipasangkan dengan benda yang benar di peta, jadi GPS dan odometri tetap dipakai. Cara lain untuk ketelitian sentimeter adalah <strong>GPS RTK</strong>, yang memakai data koreksi dari stasiun referensi di darat. RTK bekerja baik di tempat terbuka, tetapi ikut terganggu di antara gedung tinggi.</p>',
      task: { id: 'landmark', text: 'Nyalakan <strong>Pencocokan peta</strong>, lalu tunggu sampai galatnya bertahan di bawah 0,3 m selama 5 detik.' },
    },
  ],
  summary:
    '<p>Lokalisasi menjawab pertanyaan "di mana aku?" dengan ketelitian yang cukup untuk memilih lajur.</p>' +
    '<ul><li>GPS memberi posisi tanpa drift, tetapi galatnya beberapa meter dan bisa melompat jauh di antara gedung tinggi, seperti di Kayutangan.</li>' +
    '<li>Odometri dan IMU halus, tetapi galat kecilnya menumpuk menjadi drift.</li>' +
    '<li>Filter Kalman menggabungkan keduanya sesuai ketidakpastian masing-masing dan menolak ukuran yang tidak masuk akal. Galatnya masih sekitar 1 sampai 2 m.</li>' +
    '<li>Pencocokan LiDAR dengan peta HD menurunkan galat ke beberapa sentimeter, cukup untuk menjaga lajur yang lebarnya hanya sekitar 3,2 m.</li></ul>' +
    '<p class="note">Model di sini disederhanakan. Semuanya terjadi di bidang datar, posisi GPS langsung dalam meter, tinggi gedung sebagian besar perkiraan, dan peta HD hanya berisi sudut gedung serta tiang dan rambu. Sistem sungguhan juga menebak ketinggian dan kemiringan, lalu mencocokkan seluruh awan titik LiDAR dengan peta atau memakai GPS RTK. Peta jalan dan gedung: © Kontributor OpenStreetMap.</p>',

  // Gaya khusus pelajaran ini, selalu diawali .lesson-lokalisasi.
  styles: `
    .lesson-lokalisasi .err-body { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 16px; align-items: start; }
    .lesson-lokalisasi .err-side { display: grid; gap: 8px; }
    .lesson-lokalisasi .est-name { display: inline-flex; align-items: center; gap: 7px; }
    .lesson-lokalisasi .est-name::before { content: ''; flex: none; width: 9px; height: 9px; border-radius: 50%; background: var(--c); }
    .lesson-lokalisasi .err-table td { font-family: var(--mono); }
    .lesson-lokalisasi .err-table tr.is-off > * { color: var(--muted); opacity: .6; }
    .lesson-lokalisasi .v-ok { color: var(--ok); }
    .lesson-lokalisasi .v-warn { color: var(--warn); }
    .lesson-lokalisasi .v-bad { color: #f87171; }
    .lesson-lokalisasi .chart-key.is-off { opacity: .45; }
    .lesson-lokalisasi .grp-steer .ctl-seg { margin-top: 2px; }
    @media (max-width: 900px) {
      .lesson-lokalisasi .err-body { grid-template-columns: minmax(0, 1fr); }
    }
    @media (max-width: 600px) {
      .lesson-lokalisasi .err-table th, .lesson-lokalisasi .err-table td { padding: 7px 6px; }
      .lesson-lokalisasi .err-table thead th { white-space: normal; }
    }
  `,

  async mount(ctx) {
    // ---------- peta dan model ----------
    const map = await ctx.loadMap('malang-center');
    if (ctx.signal.aborted) return {};
    const route = buildRoute(map);
    const scene = createScene(route);
    const ego = scene.ego;
    const gps = new GpsReceiver(7);
    const imu = new WheelImu(3);
    const odo = new DeadReckoning();
    const fus = new PoseFilter(); // GPS + odometri, selalu berjalan
    const mapF = new PoseFilter(); // GPS + odometri + pencocokan peta, berjalan saat sakelarnya menyala
    const lidar = new LidarLandmarks(scene.landmarks, (x, y, r) => map.buildingsNear(x, y, r), 5);
    // titik LiDAR untuk tampilan (dinding gedung, tiang, pejalan kaki), digambar dari posisi tebakan
    const lidarView = new Sensor('lidar', { ...LIDAR_VIEW, rangeNoise: 0.02 });
    const lidarRng = new Rng(11);
    const trail = createLidarTrail({ fade: 2.4, max: 6000 });
    const poles = scene.landmarks.filter((lm) => lm.kind !== 'sudut').map((lm) => ({ id: lm.id, x: lm.x, y: lm.y, radius: lm.radius, kind: 'tiang' }));
    const zone0 = scene.zones[0] || null;

    const show = { gps: false, odo: false, fus: false, map: false };
    const steer = { on: false, sel: 'gps', warned: false, lastEvents: 0 };
    let sigma = 2;
    let simT = 0;
    let lidarT = 0;
    let viewT = 0;
    let sampleT = 0;
    let lastScan = null;
    const matchedAt = new Map(); // id landmark -> waktu terakhir cocok
    const hist = { gps: [], odo: [], fus: [], map: [] }; // [t, galat] untuk rata-rata
    const freshTask = () => ({ fixes: 0, above: 0, jumpAt: null, hold: 0, fusShown: 0 });
    const task = freshTask();

    const truthState = () => ({ x: ego.x, y: ego.y, vx: ego.vx, vy: ego.vy });
    const canyonNow = () => scene.canyonAt(ego.x, ego.y);

    function poseOf(id) {
      if (id === 'gps') return gps.estimate(simT);
      if (id === 'odo') return odo.pose();
      if (id === 'fus') return fus.pose();
      return mapF.pose();
    }
    const errOf = (id) => {
      if (!show[id]) return NaN;
      const p = poseOf(id);
      return p ? Math.hypot(p.x - ego.x, p.y - ego.y) : NaN;
    };

    /** Mulai ulang semua estimasi dari keadaan sekarang (dipakai saat Ulangi atau mobil dipindah). */
    function resetEstimates() {
      const f = gps.measure(simT, truthState(), sigma, canyonNow());
      gps.history.length = 0;
      gps.history.push(f);
      gps.timer = 0;
      odo.init(ego.x, ego.y, ego.heading);
      fus.init(f.x, f.y, Math.atan2(f.vy, f.vx), f.sigmaRep, 0.05);
      mapF.initFrom(fus);
      lastScan = null;
      matchedAt.clear();
      trail.clear();
      for (const k of Object.keys(hist)) hist[k].length = 0;
    }

    // ---------- kanvas dan loop ----------
    const labels = createLabelLayer();
    const LABEL_OPEN = 'Peta jalan sekitar Alun-alun Merdeka Malang dari atas. Mobil otonom berkeliling blok Kayutangan. Kotak putus-putus putih menandai posisi sebenarnya, penanda berwarna menandai posisi hasil tebakan.';
    const view = ctx.createView({ label: LABEL_OPEN, background: COLORS.ground });
    ctx.createLoop({ update, render });

    // ---------- panel kontrol ----------
    const estGroup = ui.group(ctx.controls, { title: 'Estimasi posisi' });
    const toggles = {};
    for (const e of EST) {
      toggles[e.id] = ui.toggle(estGroup, { label: e.toggle, color: e.color, hint: 'Mati', onChange: (on) => setShow(e.id, on) });
    }
    ui.legend(estGroup, [
      { color: '#f8fafc', label: 'Posisi sebenarnya', shape: 'line' },
      { color: COLORS.lidar, label: 'Landmark di peta HD', shape: 'square' },
      { color: COLORS.warn, label: 'Zona gedung tinggi', shape: 'square' },
    ]);

    const gpsGroup = ui.group(ctx.controls, { title: 'GPS' });
    const sigmaSlider = ui.slider(gpsGroup, {
      label: 'Noise GPS (sigma)',
      min: 0.5,
      max: 5,
      step: 0.5,
      value: sigma,
      unit: 'm',
      digits: 1,
      hint: 'Galat per sumbu di tempat terbuka. Posisi baru datang sekali per detik.',
      onInput: (v) => {
        sigma = v;
      },
    });
    const gpsReadouts = ui.readoutGrid(gpsGroup);
    const satOut = ui.readout(gpsReadouts, { label: 'Satelit', value: '-' });
    const accOut = ui.readout(gpsReadouts, { label: 'Akurasi klaim', value: '-' });
    const gainOut = ui.readout(gpsReadouts, { label: 'Bobot GPS', value: '-' });
    gpsGroup.append(ui.el('p', { class: 'ctl-hint', text: 'Akurasi klaim adalah jari-jari 95% menurut penerima GPS. Bobot GPS adalah seberapa kuat fusi menarik tebakannya ke posisi GPS terakhir.' }));

    const steerGroup = ui.group(ctx.controls, { title: 'Kemudi', className: 'grp-steer', hint: 'Saat sakelar mati, simulator menyetir dengan posisi sebenarnya.' });
    const steerToggle = ui.toggle(steerGroup, { label: 'Kemudikan dengan estimasi', color: COLORS.accent, hint: 'Mati', onChange: (on) => setSteer(on) });
    const steerSeg = ui.segmented(steerGroup, {
      label: 'Estimasi yang dipakai',
      options: EST.map((e) => ({ value: e.id, label: e.name })),
      value: steer.sel,
      onChange: (v) => setSteerSel(v),
    });
    const steerReadouts = ui.readoutGrid(steerGroup);
    const latOut = ui.readout(steerReadouts, { label: 'Jarak ke tengah lajur', value: '0,00 m' });
    const exitOut = ui.readout(steerReadouts, { label: 'Keluar lajur', value: '0 kali' });
    const takeOut = ui.readout(steerReadouts, { label: 'Diambil alih', value: '0 kali' });
    steerGroup.append(
      ui.el('p', {
        class: 'ctl-hint',
        text: 'Perisai keselamatan tetap bekerja dengan estimasi apa pun: mobil selalu berhenti untuk pejalan kaki, termasuk di zebra cross Jalan Jenderal Basuki Rachmat.',
      }),
    );

    const errGroup = ui.group(ctx.controls, { title: 'Galat posisi', wide: true });
    const errBody = ui.el('div', { class: 'err-body' });
    errGroup.append(errBody);
    const chart = logChart(errBody, {
      label: 'Galat terhadap posisi sebenarnya, 30 detik terakhir',
      series: EST.map((e) => ({ label: e.name, color: e.color })),
      span: 30,
      min: 0.01,
      max: 40,
      height: 170,
      ticks: [0.1, 1, 10],
      target: { value: 0.3, label: '0,3 m' },
    });
    const side = ui.el('div', { class: 'err-side' });
    errBody.append(side);
    const table = ui.dataTable(side, {
      caption: 'Galat tiap estimasi posisi',
      columns: [
        { key: 'name', label: 'Estimasi' },
        { key: 'now', label: 'Sekarang', align: 'right' },
        { key: 'avg', label: 'Rata-rata', align: 'right' },
        { key: 'unc', label: 'Radius 95%', align: 'right' },
      ],
    });
    table.table.classList.add('err-table');
    side.append(
      ui.el('p', {
        class: 'ctl-hint',
        text: 'Rata-rata dihitung dari 20 detik terakhir. Radius 95% adalah ketidakpastian menurut estimasi itu sendiri: posisi sebenarnya diperkirakan ada di dalam lingkaran sebesar itu dengan keyakinan 95%. Odometri saja tidak menghitung ketidakpastiannya. Sumbu grafik memakai skala logaritmik supaya galat 0,01 m dan 10 m sama-sama terbaca.',
      }),
    );

    // HUD di atas kanvas: nama jalan dan jumlah satelit, lalu chip zona gedung tinggi (hanya di zona).
    // Keduanya dibuat pendek supaya masing-masing muat satu baris di layar ponsel.
    const zoneChip = ui.hudChip(ctx.hud, { label: 'Jl. Merdeka Utara', color: COLORS.accent });
    const canyonChip = ui.hudChip(ctx.hud, { color: COLORS.warn });
    canyonChip.set('Zona gedung tinggi');
    canyonChip.setTone('warn');
    canyonChip.show(false);
    const steerChip = ui.hudChip(ctx.hud, { label: 'Kemudi', color: COLORS.accent });
    steerChip.show(false);
    const safeChip = ui.hudChip(ctx.hud, { label: 'Perisai', color: COLORS.ok });
    safeChip.show(false);

    // ---------- aksi ----------
    function setShow(id, on) {
      const was = show[id];
      show[id] = !!on;
      toggles[id].set(show[id]);
      if (on && !was) {
        if (id === 'odo') odo.init(ego.x, ego.y, ego.heading);
        if (id === 'map') {
          mapF.initFrom(fus);
          lastScan = null;
          matchedAt.clear();
          trail.clear();
        }
        hist[id].length = 0;
        // Langkah 2: bila mobil sudah lewat atau masih jauh dari zona gedung tinggi saat GPS
        // dinyalakan, pindahkan mobil ke depan zona supaya pelajar tidak menunggu satu putaran.
        if (id === 'gps' && ctx.currentStep() === 1 && !ctx.isTaskDone('urban-canyon') && relocateBeforeCanyon()) {
          ctx.toast('Mobil dipindah ke dekat zona gedung tinggi di Jalan Jenderal Basuki Rachmat supaya kamu tidak perlu menunggu satu putaran.');
        }
      }
      if (id === 'fus' && !on) task.fusShown = 0;
      // kemudi hanya boleh memakai estimasi yang sedang tampil
      if (!on && steer.on && steer.sel === id) setSteer(false);
      refreshPanels();
    }

    function setSteer(on) {
      if (on && !steer.on) {
        // hitungan keluar lajur dan ambil alih dimulai lagi tiap kali kemudi dengan estimasi dinyalakan
        scene.resetBackup();
        steer.lastEvents = 0;
      }
      steer.on = !!on;
      steer.warned = false;
      steerToggle.set(steer.on);
      if (steer.on && !show[steer.sel]) setShow(steer.sel, true);
      refreshPanels();
    }

    function setSteerSel(id) {
      steer.sel = id;
      steerSeg.set(id);
      scene.backup.take = 0;
      if (steer.on && !show[id]) setShow(id, true);
      refreshPanels();
    }

    function relocateBeforeCanyon() {
      if (!zone0) return false;
      const nz = scene.nextZone(scene.s);
      if (scene.zoneAtS(scene.s) || (nz && nz.dist < 80)) return false;
      scene.placeAt(zone0.s0 - 55);
      resetEstimates();
      return true;
    }

    // ---------- langkah simulasi ----------
    function update(dt) {
      const prevH = ego.heading;
      scene.step(dt, steer.on ? poseOf(steer.sel) : null);
      simT += dt;

      // sensor gerak dan estimasi
      const w = wrapAngle(ego.heading - prevH) / dt;
      const beta = Math.atan(0.5 * Math.tan(ego.steer));
      const m = imu.measure(ego.speed, w);
      if (show.odo) odo.predict(m.v, m.w, beta, dt);
      fus.predict(m.v, m.w, beta, dt);
      if (show.map) mapF.predict(m.v, m.w, beta, dt);

      const fix = gps.update(dt, simT, truthState(), sigma, canyonNow());
      if (fix) {
        fus.updateGps(fix);
        if (show.map) mapF.updateGps(fix);
        onFix(fix);
      }
      lidarT += dt;
      if (lidarT >= LIDAR_PERIOD) {
        lidarT -= LIDAR_PERIOD;
        if (show.map) {
          lastScan = mapF.matchScan(lidar.scan(ego), scene.landmarks);
          if (lastScan.accepted) for (const p of lastScan.pairs) if (p.lm) matchedAt.set(p.lm.id, simT);
        }
      }
      // titik LiDAR untuk tampilan: dipindai dari posisi sebenarnya, digambar dari posisi tebakan
      viewT += dt;
      if (show.map && viewT >= 1 / LIDAR_VIEW.rate) {
        viewT = 0;
        scanForView();
      }

      // pengemudi cadangan (dijalankan di scene.step): beri tahu sekali saat pertama mengambil alih
      if (steer.on && scene.backup.events > steer.lastEvents) {
        steer.lastEvents = scene.backup.events;
        if (!steer.warned) {
          steer.warned = true;
          ctx.toast('Mobil keluar lajur. Pengemudi cadangan mengambil alih sebentar, lalu mengembalikan kemudi.', { tone: 'warn', duration: 4000 });
        }
      }

      // cuplikan galat untuk grafik dan rata-rata (10 kali per detik)
      sampleT += dt;
      if (sampleT >= 0.1) {
        sampleT -= 0.1;
        const vals = EST.map((e) => errOf(e.id));
        chart.push(simT, vals);
        EST.forEach((e, i) => {
          const h = hist[e.id];
          if (Number.isFinite(vals[i])) h.push([simT, vals[i]]);
          while (h.length && h[0][0] < simT - AVG_WINDOW) h.shift();
        });
      }

      checkTasks(dt);
    }

    function scanForView() {
      const objects = [...map.buildingsNear(ego.x, ego.y, LIDAR_VIEW.range + 8), ...poles, ...scene.allPeds().filter((p) => p.active)];
      const reading = lidarView.sense(ego, objects, { rng: lidarRng, time: simT });
      // ubah titik dari posisi sebenarnya ke posisi tebakan filter peta
      const c = Math.cos(mapF.h - ego.heading);
      const s = Math.sin(mapF.h - ego.heading);
      const pts = reading.points.map((p) => {
        const dx = p.x - ego.x;
        const dy = p.y - ego.y;
        return { x: mapF.x + dx * c - dy * s, y: mapF.y + dx * s + dy * c };
      });
      trail.add(pts, simT);
    }

    function onFix(fix) {
      const step = ctx.currentStep();
      if (step === 0) {
        if (gpsOnly()) {
          task.fixes++;
          if (fix.err > 2) task.above++;
        } else {
          task.fixes = 0;
          task.above = 0;
        }
      }
      if (fix.jump && show.gps) task.jumpAt = simT;
    }

    const others = (id) => EST.some((e) => e.id !== id && show[e.id]);
    const gpsOnly = () => show.gps && !others('gps');

    // ---------- deteksi tugas ----------
    function checkTasks(dt) {
      const taskId = ctx.lesson.steps[ctx.currentStep()]?.taskId;
      if (show.fus) task.fusShown += dt;
      if (!taskId || ctx.isTaskDone(taskId)) return;
      let done = false;
      if (taskId === 'gps-only') done = gpsOnly() && task.fixes >= 5 && task.above >= 3;
      else if (taskId === 'urban-canyon') done = show.gps && task.jumpAt != null && simT - task.jumpAt >= 1.2;
      else if (taskId === 'odometry-drift') {
        task.hold = show.odo && !others('odo') && errOf('odo') > 3 ? task.hold + dt : 0;
        done = task.hold >= 0.5;
      } else if (taskId === 'fusion') done = show.fus && task.fusShown >= 4;
      else if (taskId === 'landmark') {
        task.hold = show.map && errOf('map') < 0.3 ? task.hold + dt : 0;
        done = task.hold >= 5;
      }
      if (done) ctx.completeTask(taskId);
    }

    // ---------- panel (dipanggil dari render, sekitar 8 kali per detik) ----------
    let lastPanel = 0;
    let lastFrame = 0;
    let miniAlpha = 1;
    let lastLabel = '';
    function refreshPanels() {
      const errs = Object.fromEntries(EST.map((e) => [e.id, errOf(e.id)]));
      const avg = (id) => (hist[id].length ? hist[id].reduce((a, r) => a + r[1], 0) / hist[id].length : NaN);
      const fix = gps.fix;
      const ell = fus.ellipse();
      const ellMap = mapF.ellipse();
      const tone = (e) => (!Number.isFinite(e) ? '' : e < 0.3 ? 'v-ok' : e < LANE_OUT ? 'v-warn' : 'v-bad');

      // sakelar dan legenda grafik
      EST.forEach((e, i) => {
        toggles[e.id].setHint(show[e.id] ? `Galat ${fmtErr(errs[e.id])}` : 'Mati');
        chart.setValue(i, show[e.id] ? fmtErr(errs[e.id]) : 'mati');
        chart.setActive(i, show[e.id]);
      });

      // tabel
      const unc = {
        gps: fix ? `±${fmt(K95 * fix.sigmaRep, 1, 'm')}` : '-',
        odo: 'terus naik',
        fus: `±${fmtErr(ell.a)}`,
        map: `±${fmtErr(ellMap.a)}`,
      };
      table.setRows(
        EST.map((e) => {
          const on = show[e.id];
          const a = avg(e.id);
          return {
            _class: on ? '' : 'is-off',
            name: { html: `<span class="est-name" style="--c: ${e.color}">${e.name}</span>` },
            now: on ? { html: `<span class="${tone(errs[e.id])}">${fmtErr(errs[e.id])}</span>` } : 'mati',
            avg: on ? { html: `<span class="${tone(a)}">${fmtErr(a)}</span>` } : '-',
            unc: on ? unc[e.id] : '-',
          };
        }),
      );

      // GPS
      satOut.set(fix ? fmt(fix.sats) : '-');
      satOut.setTone(fix && fix.sats < 7 ? 'warn' : '');
      accOut.set(fix ? `±${fmt(K95 * fix.sigmaRep, 1, 'm')}` : '-');
      gainOut.set(fus.lastGain == null ? '-' : fus.lastGpsAccepted ? `${fmt(fus.lastGain * 100, 0)}%` : 'ditolak');
      gainOut.setTone(fus.lastGpsAccepted ? '' : 'warn');

      // kemudi
      const b = scene.backup;
      const lat = scene.laneOffset();
      latOut.set(fmt(Math.abs(lat), 2, 'm'));
      latOut.setTone(Math.abs(lat) > TAKEOVER_AT ? 'danger' : Math.abs(lat) > LANE_OUT ? 'warn' : 'ok');
      exitOut.set(`${fmt(b.exits)} kali`);
      takeOut.set(`${fmt(b.takeovers)} kali`);
      steerToggle.setHint(steer.on ? `Memakai ${EST_BY_ID[steer.sel].name}` : 'Mati');

      // HUD
      const zone = scene.zoneAtS(scene.s);
      const info = route.infoAt(scene.s);
      zoneChip.setLabel(streetLabel(info.name).replace('Jenderal ', 'Jend. '));
      zoneChip.set(`${fix ? fix.sats : '-'} satelit`);
      zoneChip.setTone(zone ? 'warn' : '');
      canyonChip.show(!!zone);
      steerChip.show(steer.on);
      steerChip.set(b.take > 0 ? 'Diambil alih' : `Estimasi ${EST_BY_ID[steer.sel].name}`);
      steerChip.setTone(b.take > 0 ? 'danger' : b.out ? 'warn' : '');
      const yielding = scene.shield.yielding && ego.speed < 3;
      safeChip.show(scene.shield.active || yielding);
      safeChip.set(scene.shield.active ? 'mengerem untuk pejalan kaki' : 'memberi jalan di zebra cross');
      safeChip.setTone(scene.shield.active ? 'warn' : '');
      measureHud();
      const label = zone
        ? `Peta jalan sekitar Alun-alun Merdeka Malang dari atas. Mobil otonom sedang melewati zona gedung tinggi di ${info.name || 'jalan penghubung'}. Kotak putus-putus putih menandai posisi sebenarnya, penanda berwarna menandai posisi hasil tebakan.`
        : LABEL_OPEN;
      if (label !== lastLabel) {
        lastLabel = label;
        view.setLabel(label);
      }

      updateStatus(errs, avg);
    }

    // ---------- baris status ----------
    function updateStatus(errs, avg) {
      const step = ctx.currentStep();
      const fix = gps.fix;
      const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
      let text = '';
      if (steer.on && scene.backup.take > 0) {
        text = `Mobil keluar lajur karena estimasi ${EST_BY_ID[steer.sel].name} meleset. Pengemudi cadangan mengambil alih sebentar.`;
      } else if (show.gps && fix && fix.jump && simT - fix.t < 2.5) {
        text = `Sinyal satelit memantul di dinding gedung. Posisi GPS melompat, galatnya ${fmtErr(fix.err)}.`;
      } else if (scene.shield.yielding && ego.speed < 1 && step !== 4) {
        text = 'Mobil berhenti memberi jalan kepada pejalan kaki di zebra cross Jalan Jenderal Basuki Rachmat.';
      } else if (step === 0) {
        if (!show.gps) text = 'Nyalakan GPS di panel Estimasi posisi.';
        else if (others('gps')) text = 'Matikan estimasi selain GPS supaya GPS terlihat sendiri.';
        else text = `Galat GPS ${fmtErr(errs.gps)}, rata-rata ${fmtErr(avg('gps'))}. Lajur di sini hanya sekitar 3,2 m.`;
      } else if (step === 1) {
        const nz = scene.nextZone(scene.s);
        if (!show.gps) text = 'Nyalakan GPS supaya lompatannya terlihat.';
        else if (scene.zoneAtS(scene.s)) text = `Mobil di zona gedung tinggi. Hanya ${fix ? fix.sats : '-'} satelit terlihat, galat GPS ${fmtErr(errs.gps)}.`;
        else text = `Zona gedung tinggi ${fmt(nz ? nz.dist : 0, 0, 'm')} lagi. Galat GPS sekarang ${fmtErr(errs.gps)}.`;
      } else if (step === 2) {
        if (!show.odo) text = 'Nyalakan Odometri dan IMU. Tebakan dimulai dari posisi sebenarnya.';
        else if (others('odo')) text = 'Matikan estimasi lain supaya odometri terlihat sendiri.';
        else text = `Odometri melenceng ${fmtErr(errs.odo)} setelah ${fmt(odo.age, 0)} detik tanpa koreksi.`;
      } else if (step === 3) {
        if (!show.fus) text = 'Nyalakan Fusi di panel Estimasi posisi.';
        else text = `Galat fusi ${fmtErr(errs.fus)}, rata-rata ${fmtErr(avg('fus'))}. GPS rata-rata ${fmtErr(avg('gps'))}.`;
      } else if (step === 4) {
        if (!show.map) text = 'Nyalakan Pencocokan peta di panel Estimasi posisi.';
        else {
          const n = lastScan ? lastScan.used : 0;
          const named = matchedName();
          text = `Galat peta ${fmtErr(errs.map)}, ${fmt(n)} landmark cocok${named ? `, termasuk sudut ${named}` : ''}.${errs.map < 0.3 ? ` Di bawah 0,3 m selama ${fmt(Math.min(task.hold, 5), 1)} detik.` : ''}`;
        }
      } else {
        const parts = EST.filter((e) => show[e.id]).map((e) => `${e.name} ${fmtErr(errs[e.id])}`);
        text = parts.length ? `Galat: ${parts.join(', ')}.` : 'Semua estimasi mati. Nyalakan salah satu di panel Estimasi posisi.';
      }
      ctx.setStatus(cap(text));
    }

    /** Nama gedung yang sudutnya baru saja cocok dengan peta, atau ''. */
    function matchedName() {
      if (!lastScan) return '';
      for (const p of lastScan.pairs) if (p.lm && p.lm.kind === 'sudut' && p.lm.name) return p.lm.name;
      return '';
    }

    // ---------- menggambar ----------
    function updateCamera() {
      const s = Math.min(view.width, view.height) / 38; // sisi pendek kanvas sekitar 38 m
      view.setScale(s);
      const vw = view.width / s;
      const vh = view.height / s;
      const lead = 0.2 * Math.min(vw, vh);
      view.centerOn(ego.x + Math.cos(ego.heading) * lead, ego.y + Math.sin(ego.heading) * lead);
    }

    function render() {
      if (view.width < 1 || view.height < 1) return;
      updateCamera();
      const g = view.begin(COLORS.ground);
      scene.renderer.draw(g, view, { attribution: false });
      scene.draw(g, view);
      zoneLabels();
      if (show.map) drawLidar(g);
      drawEstimates(g);
      labels.draw(g, view);
      drawOffscreen(g);
      const now = performance.now();
      const mini = minimapBox();
      // peta mini memudar saat ada estimasi di bawahnya (misalnya lompatan GPS di layar ponsel)
      const fadeDt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0;
      lastFrame = now;
      miniAlpha = approach(miniAlpha, minimapCovered(mini) ? 0.15 : 1, fadeDt * 5);
      if (view.width < 600) drawScaleBar(g, view, { x: mini.x + 4, y: mini.y - 8, target: 70 });
      else drawScaleBar(g, view, { x: mini.x + mini.w + 14 });
      drawMinimap(g, mini, miniAlpha);
      scene.renderer.drawAttribution(g, view); // "© Kontributor OpenStreetMap", selalu paling akhir
      chart.draw();

      if (now - lastPanel > 120) {
        lastPanel = now;
        refreshPanels();
      }
    }

    const onScreen = (x, y, m = 0) => {
      const p = view.worldToScreen(x, y);
      return p.x >= -m && p.x <= view.width + m && p.y >= -m && p.y <= view.height + m;
    };

    // Daerah layar yang tertutup chip HUD dan peta mini. Label tambahan (zona, tinggi gedung, nama
    // landmark) tidak diletakkan di sana supaya tidak tertimpa. Chip diukur ulang di refreshPanels().
    let hudRects = [];
    function measureHud() {
      const c = view.canvas.getBoundingClientRect();
      hudRects = [...ctx.hud.children]
        .filter((el) => !el.hidden && el.offsetParent)
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.left - c.left - 8, y: r.top - c.top - 8, w: r.width + 16, h: r.height + 16 };
        });
    }
    /**
     * Apakah label selebar sekitar 2 x halfW piksel, digambar dy piksel di bawah titik dunia (x, y),
     * tidak tertutup chip HUD atau peta mini.
     */
    function labelFree(x, y, halfW = 70, dy = 0) {
      const p = view.worldToScreen(x, y);
      const cy = p.y + dy;
      const mini = minimapBox();
      const rects = [...hudRects, { x: mini.x, y: mini.y - 6, w: mini.w, h: mini.h + 12 }];
      return !rects.some((r) => p.x > r.x - halfW && p.x < r.x + r.w + halfW && cy > r.y - 12 && cy < r.y + r.h + 12);
    }

    function zoneLabels() {
      for (const z of scene.zones) {
        for (const s of [z.s0, z.s0 + z.length]) {
          const p = scene.lanePath.sample(s);
          const info = route.infoAt(s);
          const x = p.x + Math.sin(p.heading) * (info.leftEdge + 3.4);
          const y = p.y - Math.cos(p.heading) * (info.leftEdge + 3.4);
          if (onScreen(x, y, -30) && labelFree(x, y, 70, -4)) labels.add(x, y, 'Zona gedung tinggi', { color: COLORS.warn, size: 11, dy: -4, priority: 1 });
        }
        // tinggi perkiraan gedung bernama di zona yang sedang terlihat
        for (const b of z.buildings) {
          if (!b.name || !onScreen(b.x, b.y, -20) || !labelFree(b.x, b.y, 80, 14)) continue;
          labels.add(b.x, b.y, `tinggi ±${fmt(b.height, 0)} m, perkiraan`, { color: '#fde68a', size: 10.5, dy: 14, optional: true, priority: -1 });
        }
      }
    }

    function drawEstimateCar(g, pose, color, strong) {
      const L = ego.length;
      const W = ego.width;
      g.save();
      g.translate(pose.x, pose.y);
      g.rotate(pose.heading);
      g.fillStyle = withAlpha(color, 0.14);
      g.strokeStyle = color;
      g.lineWidth = view.px(strong ? 3 : 2);
      roundRectPath(g, -L / 2, -W / 2, L, W, 0.45);
      g.fill();
      g.stroke();
      // penanda arah depan
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(L / 2 - 0.1, 0);
      g.lineTo(L / 2 - 1.1, -0.55);
      g.lineTo(L / 2 - 1.1, 0.55);
      g.closePath();
      g.fill();
      g.restore();
      g.fillStyle = color;
      g.beginPath();
      g.arc(pose.x, pose.y, view.px(3.5), 0, TAU);
      g.fill();
    }

    function drawEllipse(g, f, color) {
      const e = f.ellipse();
      g.save();
      g.beginPath();
      g.ellipse(f.x, f.y, Math.max(e.a, view.px(2)), Math.max(e.b, view.px(2)), e.angle, 0, TAU);
      g.fillStyle = withAlpha(color, 0.13);
      g.fill();
      g.strokeStyle = withAlpha(color, 0.85);
      g.lineWidth = view.px(1.5);
      g.stroke();
      g.restore();
    }

    function drawEstimates(g) {
      // jejak odometri
      if (show.odo && odo.trail.length > 1) {
        drawLine(g, [...odo.trail, { x: odo.x, y: odo.y }], { color: EST_BY_ID.odo.color, width: 2, view, alpha: 0.6, dash: [7, 5] });
      }
      // riwayat posisi GPS dan akurasi yang dilaporkan
      if (show.gps && gps.fix) {
        const n = gps.history.length;
        gps.history.forEach((f, i) => {
          const a = 0.2 + 0.6 * ((i + 1) / n);
          g.fillStyle = withAlpha(EST_BY_ID.gps.color, a);
          g.beginPath();
          g.arc(f.x, f.y, view.px(3.2), 0, TAU);
          g.fill();
        });
        const p = gps.estimate(simT);
        drawRing(g, p.x, p.y, K95 * gps.fix.sigmaRep, { color: withAlpha(EST_BY_ID.gps.color, 0.55), width: 1.3, view, dash: [5, 5] });
        drawMultipath(g);
      }
      if (show.fus) drawEllipse(g, fus, EST_BY_ID.fus.color);
      if (show.map) drawMapMatching(g);

      scene.drawGhost(g, view);

      for (const e of EST) {
        if (!show[e.id]) continue;
        const p = poseOf(e.id);
        if (!p) continue;
        drawEstimateCar(g, p, e.color, steer.on && steer.sel === e.id);
        if (onScreen(p.x, p.y, -8)) labels.add(p.x, p.y, `${e.name} ${fmtErr(Math.hypot(p.x - ego.x, p.y - ego.y))}`, { color: e.color, size: 11, dy: -26, priority: 3 });
      }
    }

    /**
     * Sinyal pantulan saat terjadi lompatan multipath (memudar pelan): dari langit ke dinding gedung
     * yang sungguh ada di peta, lalu memantul ke mobil. Tanpa dinding di dekat mobil, tidak digambar.
     */
    let mpFix = null;
    let mpWall = null;
    function multipathWall(f) {
      const q = scene.lanePath.closest(f.truthX, f.truthY);
      const n = q.heading + Math.PI / 2; // ke kanan arah gerak
      const sgn = f.jump.x * Math.cos(n) + f.jump.y * Math.sin(n) > 0 ? 1 : -1;
      const near = map.buildingsNear(f.truthX, f.truthY, 45);
      // kipas sinar ke sisi arah lompatan (lalu sisi lainnya). Sinar yang condong ke depan
      // didahulukan supaya garis datang dan garis pantul tidak berimpit.
      for (const side of [sgn, -sgn]) {
        let best = null;
        for (const k of [0.45, 0.3, 0.6, 0.15, 0, -0.15, -0.3]) {
          const a = n + (side < 0 ? Math.PI : 0) - side * k;
          const dx = Math.cos(a);
          const dy = Math.sin(a);
          let t = Infinity;
          for (const b of near) t = Math.min(t, rayPolygon(f.truthX, f.truthY, dx, dy, b.points));
          if (t > 1 && t < 40 && (!best || t < best.t)) best = { t, dx, dy };
          if (best && k > 0.1) break;
        }
        if (best) {
          const W = { x: f.truthX + best.dx * (best.t - 0.15), y: f.truthY + best.dy * (best.t - 0.15) };
          // normal dinding kira-kira tegak lurus jalan, menghadap ke jalan
          const N = { x: -Math.cos(n) * side, y: -Math.sin(n) * side };
          return { W, N };
        }
      }
      return null;
    }
    function drawMultipath(g) {
      const f = gps.fix;
      const age = simT - f.t;
      if (!f.jump || age > 1.6) return;
      if (mpFix !== f) {
        mpFix = f;
        mpWall = multipathWall(f);
      }
      if (!mpWall) return;
      const { W, N } = mpWall;
      // arah pantul r (dinding ke mobil) dan arah datang i = r - 2 (r.N) N (pemantulan cermin)
      const rx = ego.x - W.x;
      const ry = ego.y - W.y;
      const rl = Math.hypot(rx, ry) || 1;
      const rn = (rx * N.x + ry * N.y) / rl;
      const ix = rx / rl - 2 * rn * N.x;
      const iy = ry / rl - 2 * rn * N.y;
      const from = { x: W.x - ix * 12, y: W.y - iy * 12 };
      const alpha = 1 - age / 1.6;
      drawLine(g, [from, W, { x: ego.x, y: ego.y }], { color: EST_BY_ID.gps.color, width: 2, view, alpha, dash: [6, 4] });
      drawRing(g, W.x, W.y, view.px(7), { color: EST_BY_ID.gps.color, width: 2, view, alpha });
      if (onScreen(W.x, W.y, -10)) labels.add(W.x, W.y, 'pantulan', { color: EST_BY_ID.gps.color, size: 11, dy: -16, alpha, priority: 2 });
    }

    /** LiDAR yang tenang: cakupan diam, sapuan pelan, dan titik yang memudar (tanpa garis sinar). */
    function drawLidar(g) {
      const pose = lidarView.pose(ego);
      drawLidarRange(g, pose, LIDAR_VIEW.range, COLORS.lidar, { view, alpha: 0.035, edgeAlpha: 0.22 });
      if (!ctx.reducedMotion) drawLidarSweep(g, pose, lidarSweepAngle(simT, { period: 10 }), LIDAR_VIEW.range, COLORS.lidar, { alpha: 0.1 });
      trail.draw(g, simT, COLORS.lidar, { view, size: 2.4, alpha: 0.8, halo: 0.5, spacing: 1.8 });
    }

    function drawMapMatching(g) {
      const vb = view.visibleBounds();
      const c = COLORS.lidar;
      // isi peta HD: posisi landmark yang tercatat, landmark yang baru cocok diberi lingkaran yang memudar pelan
      g.save();
      const d = view.px(6);
      const named = new Set(); // satu label per gedung
      for (const lm of scene.landmarks) {
        if (lm.x < vb.minX - 2 || lm.x > vb.maxX + 2 || lm.y < vb.minY - 2 || lm.y > vb.maxY + 2) continue;
        g.strokeStyle = withAlpha(c, 0.85);
        g.lineWidth = view.px(1.5);
        g.beginPath();
        g.moveTo(lm.x, lm.y - d);
        g.lineTo(lm.x + d, lm.y);
        g.lineTo(lm.x, lm.y + d);
        g.lineTo(lm.x - d, lm.y);
        g.closePath();
        g.stroke();
        const t = matchedAt.get(lm.id);
        if (t == null) continue;
        const age = simT - t;
        const a = age < 0.4 ? 1 : Math.max(0, 1 - (age - 0.4) / 1.2);
        if (a <= 0.01) continue;
        g.fillStyle = withAlpha(c, 0.28 * a);
        g.beginPath();
        g.arc(lm.x, lm.y, view.px(9), 0, TAU);
        g.fill();
        if (lm.kind === 'sudut' && !named.has(lm.name) && onScreen(lm.x, lm.y, -10) && labelFree(lm.x, lm.y, 90, -14)) {
          named.add(lm.name);
          labels.add(lm.x, lm.y, lm.name, { color: c, size: 10.5, dy: -14, optional: true, alpha: a });
        }
      }
      g.restore();
      drawEllipse(g, mapF, c);
    }

    /** Panah di tepi kanvas untuk estimasi yang berada di luar layar. */
    function drawOffscreen(g) {
      const m = 16;
      for (const e of EST) {
        if (!show[e.id]) continue;
        const p = poseOf(e.id);
        if (!p) continue;
        const s = view.worldToScreen(p.x, p.y);
        if (s.x >= 0 && s.x <= view.width && s.y >= 0 && s.y <= view.height) continue;
        const cx = view.width / 2;
        const cy = view.height / 2;
        const ang = Math.atan2(s.y - cy, s.x - cx);
        const k = Math.min((view.width / 2 - m) / Math.abs(Math.cos(ang) || 1e-6), (view.height / 2 - m) / Math.abs(Math.sin(ang) || 1e-6));
        const ex = cx + Math.cos(ang) * k;
        const ey = cy + Math.sin(ang) * k;
        g.save();
        view.screen();
        g.translate(ex, ey);
        g.rotate(ang);
        g.fillStyle = e.color;
        g.beginPath();
        g.moveTo(9, 0);
        g.lineTo(-6, -7);
        g.lineTo(-6, 7);
        g.closePath();
        g.fill();
        g.restore();
        view.world();
        const w = view.screenToWorld(ex - Math.cos(ang) * 16, ey - Math.sin(ang) * 16);
        drawLabel(g, view, w.x, w.y, `${e.name} ${fmtErr(Math.hypot(p.x - ego.x, p.y - ego.y))}`, { color: e.color, size: 11, dy: Math.sin(ang) > 0.3 ? -14 : 14 });
      }
    }

    // ---------- peta mini: rute di antara jalan-jalan sekitar Alun-alun ----------
    const MINI = (() => {
      const bb = map.boundsOf([{ points: scene.lanePath.points }], 14);
      return { minX: bb.minX, minY: bb.minY, maxX: bb.maxX, maxY: bb.maxY + 45 };
    })();
    const miniRoads = map.roads.filter((r) => r.drivable && r.rank <= 9 && r.bbox.maxX > MINI.minX && r.bbox.minX < MINI.maxX && r.bbox.maxY > MINI.minY && r.bbox.minY < MINI.maxY);
    const alun = map.green.find((a) => /alun-alun merdeka/i.test(a.name)) || null;

    function minimapBox() {
      const aspect = (MINI.maxY - MINI.minY) / (MINI.maxX - MINI.minX);
      let w = clamp(view.width * 0.2, 96, 160);
      const maxH = view.height * 0.42;
      if (w * aspect + MINI_HEAD > maxH) w = Math.max(70, (maxH - MINI_HEAD) / aspect);
      const h = w * aspect + MINI_HEAD;
      return { x: 10, y: view.height - h - 10, w, h };
    }

    /** Apakah ada estimasi yang tampil (beserta labelnya) di bawah kotak peta mini. */
    function minimapCovered(box) {
      const m = 32; // setengah panjang mobil di layar, ditambah sedikit ruang untuk label
      return EST.some((e) => {
        if (!show[e.id]) return false;
        const p = poseOf(e.id);
        if (!p) return false;
        const s = view.worldToScreen(p.x, p.y);
        return s.x > box.x - m && s.x < box.x + box.w + m && s.y > box.y - m && s.y < box.y + box.h + m;
      });
    }

    function drawMinimap(g, box, alpha = 1) {
      const k = box.w / (MINI.maxX - MINI.minX);
      const M = (x, y) => ({ x: box.x + (x - MINI.minX) * k, y: box.y + MINI_HEAD + (y - MINI.minY) * k });
      const trace = (pts, close = false) => {
        pts.forEach((p, i) => {
          const q = M(p.x, p.y);
          if (i) g.lineTo(q.x, q.y);
          else g.moveTo(q.x, q.y);
        });
        if (close) g.closePath();
      };
      g.save();
      view.screen();
      g.globalAlpha = alpha;
      g.fillStyle = 'rgba(11, 18, 32, 0.92)';
      g.strokeStyle = 'rgba(148, 163, 184, 0.3)';
      g.lineWidth = 1;
      roundRectPath(g, box.x, box.y, box.w, box.h, 8);
      g.fill();
      g.stroke();
      g.beginPath();
      g.rect(box.x + 1, box.y + MINI_HEAD, box.w - 2, box.h - MINI_HEAD - 1);
      g.clip();
      // Alun-alun dan jalan-jalan di sekitarnya
      if (alun) {
        g.fillStyle = 'rgba(34, 197, 94, 0.22)';
        g.beginPath();
        trace(alun.points, true);
        g.fill();
      }
      g.strokeStyle = 'rgba(100, 116, 139, 0.55)';
      g.lineWidth = 1.2;
      g.lineJoin = 'round';
      g.beginPath();
      for (const r of miniRoads) trace(r.points);
      g.stroke();
      // rute keliling
      g.strokeStyle = withAlpha(COLORS.accent, 0.75);
      g.lineWidth = 2.5;
      g.beginPath();
      trace(scene.lanePath.points, true);
      g.stroke();
      // zona gedung tinggi
      g.strokeStyle = COLORS.warn;
      g.lineWidth = 4;
      g.lineCap = 'round';
      for (const z of scene.zones) {
        const pts = [];
        for (let s = z.s0; s <= z.s0 + z.length; s += 3) pts.push(scene.lanePath.sample(s));
        g.beginPath();
        trace(pts);
        g.stroke();
      }
      // area yang terlihat di kanvas
      const vb = view.visibleBounds();
      const v0 = M(vb.minX, vb.minY);
      const v1 = M(vb.maxX, vb.maxY);
      g.strokeStyle = 'rgba(226, 232, 240, 0.5)';
      g.lineWidth = 1;
      g.strokeRect(v0.x, v0.y, v1.x - v0.x, v1.y - v0.y);
      // mobil
      const e = M(ego.x, ego.y);
      g.fillStyle = COLORS.ego;
      g.beginPath();
      g.arc(e.x, e.y, 3.5, 0, TAU);
      g.fill();
      g.restore();
      g.save();
      view.screen();
      g.globalAlpha = alpha;
      g.fillStyle = 'rgba(148, 163, 184, 0.95)';
      g.font = `600 10px ${FONT}`;
      g.textAlign = 'left';
      g.textBaseline = 'top';
      g.fillText(box.w < 120 ? 'Kayutangan' : 'Blok Kayutangan', box.x + 7, box.y + 5);
      if (alun) {
        const c = M(alun.bbox.minX + (alun.bbox.maxX - alun.bbox.minX) / 2, Math.min(MINI.maxY - 6, alun.bbox.minY + 14));
        g.fillStyle = 'rgba(134, 239, 172, 0.9)';
        g.font = `500 9.5px ${FONT}`;
        g.textAlign = 'center';
        if (c.y < box.y + box.h - 4) g.fillText('Alun-alun', c.x, c.y);
      }
      g.restore();
      view.world();
    }

    // ---------- kait uji (baca saja): penghitung aturan keselamatan dan keadaan singkat ----------
    const testHook = {
      get safety() {
        return scene.monitor.snapshot();
      },
      get state() {
        return {
          s: Math.round(scene.s * 10) / 10,
          speed: Math.round(ego.speed * 100) / 100,
          lateral: Math.round(scene.laneOffset() * 100) / 100,
          street: route.infoAt(scene.s).name,
          zone: !!scene.zoneAtS(scene.s),
          shield: scene.shield.active,
          yielding: scene.shield.yielding,
          takeover: scene.backup.take > 0,
          crossers: scene.crossers.filter((c) => c.active).map((c) => c.state),
          errors: Object.fromEntries(EST.map((e) => [e.id, Number.isFinite(errOf(e.id)) ? Math.round(errOf(e.id) * 1000) / 1000 : null])),
          lidarPoints: trail.count,
          simT: Math.round(simT * 10) / 10,
        };
      },
      route: { length: route.length, zones: scene.zones.map((z) => ({ s0: z.s0, length: z.length, name: z.name })), streets: route.streetNames, landmarks: scene.landmarks.length, crossing: scene.crossing ? { s0: scene.crossing.s0, street: scene.crossing.street } : null },
      /** Munculkan penyeberang di tepi zebra cross (tetap memakai gap acceptance). Hasil: true bila muncul. */
      spawnPedestrian(fromLeft = true) {
        return !!scene.spawnCrosser({ atCurb: true, fromLeft });
      },
    };
    window.__lokalisasi = testHook;
    ctx.onCleanup(() => {
      if (window.__lokalisasi === testHook) delete window.__lokalisasi;
    });

    // ---------- mulai ----------
    resetEstimates();

    // ---------- antarmuka ke shell ----------
    return {
      onStep(i) {
        const preset = STEP_PRESETS[i];
        if (!preset) return;
        setSteer(false);
        setSteerSel(preset.sel);
        if (preset.sigma != null) {
          sigma = preset.sigma;
          sigmaSlider.set(sigma);
        }
        if (preset.beforeCanyon) relocateBeforeCanyon();
        for (const e of EST) setShow(e.id, preset.show[e.id]);
        Object.assign(task, freshTask());
        refreshPanels();
      },
      reset() {
        simT = 0;
        lidarT = 0;
        viewT = 0;
        sampleT = 0;
        gps.reset();
        imu.reset();
        lidar.reset();
        lidarRng.reseed(11);
        scene.reset();
        const step = ctx.currentStep();
        scene.placeAt(step === 1 && zone0 ? zone0.s0 - 55 : scene.START_S);
        scene.resetBackup();
        steer.lastEvents = 0;
        steer.warned = false;
        resetEstimates();
        chart.clear();
        Object.assign(task, freshTask());
        refreshPanels();
      },
    };
  },
};
