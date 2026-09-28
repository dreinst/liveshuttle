// Pelajaran 4: Lokalisasi.
//
// Mobil otonom berkeliling jalan melingkar di kota kecil. Pelajar membandingkan beberapa cara
// menebak posisi mobil dengan posisi sebenarnya (kotak putus-putus putih):
//   GPS        posisi dari satelit, galat beberapa meter, melompat di zona gedung tinggi
//   Odometri   dead reckoning dari laju roda dan giroskop, halus tetapi drift
//   Fusi       filter Kalman: prediksi dengan odometri, koreksi dengan GPS (selalu berjalan
//              di latar, sakelarnya hanya menampilkan)
//   Peta       filter yang sama ditambah pencocokan LiDAR dengan landmark di peta HD
//
// Pola sama dengan pelajaran contoh (sensor.js): model dunia di ./lokalisasi/scene.js, model
// sensor dan estimator di ./lokalisasi/estimators.js, grafik galat di ./lokalisasi/chart.js.
// Tugas diperiksa di update() memakai waktu simulasi, hanya untuk langkah yang sedang dibuka.

import { COLORS, withAlpha, FONT } from '../engine/theme.js';
import { fmt, clamp, approach, wrapAngle, TAU } from '../engine/math.js';
import { drawLine, drawRing, drawScaleBar, createLabelLayer, drawLabel } from '../engine/draw.js';
import * as ui from '../engine/ui.js';
import { createScene, CANYON, CITY, CRUISE, LOOP, ROAD_HALF, SIDEWALK } from './lokalisasi/scene.js';
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
const LANE_OUT = 0.85; // simpangan (m) saat bodi mobil mulai melewati garis lajur
const TAKEOVER_AT = 1; // simpangan (m) saat pengemudi cadangan mengambil alih
const MINI_HEAD = 16; // tinggi baris judul peta mini (px)

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
    '<p>Sebelum bisa menjaga lajur, mobil otonom harus tahu di mana ia berada. Tugas ini disebut <strong>lokalisasi</strong>. Di pelajaran ini mobil berkeliling kota, dan kamu membandingkan beberapa cara menebak posisinya dengan posisi yang sebenarnya.</p>',
  steps: [
    {
      title: 'GPS saja',
      body:
        '<p>Penerima <span class="chip" style="--c: #f472b6">GPS</span> menghitung posisi dari sinyal beberapa satelit. GPS biasa di mobil memberi posisi baru sekitar sekali per detik, dengan galat beberapa meter.</p>' +
        '<p>Satu lajur lebarnya hanya sekitar 3,5 m, sedangkan mobil selebar 1,8 m. Sisa ruang di kiri dan kanan mobil kurang dari 1 m. Galat 2 m sudah cukup membuat mobil mengira dirinya ada di lajur sebelah atau di trotoar.</p>' +
        '<p class="note">Kotak putus-putus putih adalah posisi sebenarnya. Mobil sendiri tidak tahu posisi ini. Simulator menampilkannya sebagai kunci jawaban supaya kamu bisa mengukur galat tiap tebakan.</p>' +
        '<p>Coba juga nyalakan <strong>Kemudikan dengan estimasi</strong> di panel Kemudi. Mobil lalu menyetir memakai posisi GPS dan mulai oleng keluar lajur.</p>',
      task: { id: 'gps-only', text: 'Nyalakan <strong>GPS saja</strong> (estimasi lain mati), lalu amati titik GPS selama beberapa detik. Galatnya akan sering melebihi 2 m.' },
    },
    {
      title: 'Zona gedung tinggi',
      body:
        '<p>Di antara gedung tinggi, sebagian besar langit tertutup. Penerima hanya menangkap sedikit satelit, dan sebagian sinyal baru sampai setelah memantul di dinding gedung. Sinyal pantulan menempuh jalan yang lebih panjang, sehingga jarak ke satelit terukur terlalu jauh. Gejala ini disebut <strong>multipath</strong>.</p>' +
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
        '<p>Mobil otonom membawa <strong>peta HD</strong> yang mencatat posisi tiang lampu dan rambu sampai hitungan sentimeter. <span class="chip" style="--c: #22d3ee">LiDAR</span> mengukur jarak dan arah ke benda-benda itu. Komputer lalu mencari posisi mobil yang membuat hasil ukur LiDAR paling berimpit dengan peta, dan hasilnya dipakai untuk mengoreksi filter.</p>' +
        '<p>Galat turun ke beberapa sentimeter. Ketelitian setingkat desimeter atau lebih baik inilah yang dibutuhkan untuk tetap di tengah lajur. Coba nyalakan <strong>Kemudikan dengan estimasi</strong> dengan pilihan Peta.</p>' +
        '<p class="note">Pencocokan butuh tebakan awal yang cukup dekat supaya tiap tiang dipasangkan dengan tiang yang benar di peta, jadi GPS dan odometri tetap dipakai. Cara lain untuk ketelitian sentimeter adalah <strong>GPS RTK</strong>, yang memakai data koreksi dari stasiun referensi di darat. RTK bekerja baik di tempat terbuka, tetapi ikut terganggu di antara gedung tinggi.</p>',
      task: { id: 'landmark', text: 'Nyalakan <strong>Pencocokan peta</strong>, lalu tunggu sampai galatnya bertahan di bawah 0,3 m selama 5 detik.' },
    },
  ],
  summary:
    '<p>Lokalisasi menjawab pertanyaan "di mana aku?" dengan ketelitian yang cukup untuk memilih lajur.</p>' +
    '<ul><li>GPS memberi posisi tanpa drift, tetapi galatnya beberapa meter dan bisa melompat jauh di antara gedung tinggi.</li>' +
    '<li>Odometri dan IMU halus, tetapi galat kecilnya menumpuk menjadi drift.</li>' +
    '<li>Filter Kalman menggabungkan keduanya sesuai ketidakpastian masing-masing dan menolak ukuran yang tidak masuk akal. Galatnya masih sekitar 1 sampai 2 m.</li>' +
    '<li>Pencocokan LiDAR dengan peta HD menurunkan galat ke beberapa sentimeter, cukup untuk menjaga lajur selebar 3,5 m.</li></ul>' +
    '<p class="note">Model di sini disederhanakan. Semuanya terjadi di bidang datar, posisi GPS langsung dalam meter, dan peta hanya berisi tiang serta rambu. Sistem sungguhan juga menebak ketinggian dan kemiringan, lalu mencocokkan seluruh awan titik LiDAR dengan peta atau memakai GPS RTK.</p>',

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

  mount(ctx) {
    // ---------- model ----------
    const scene = createScene();
    const ego = scene.ego;
    const gps = new GpsReceiver(7);
    const imu = new WheelImu(3);
    const odo = new DeadReckoning();
    const fus = new PoseFilter(); // GPS + odometri, selalu berjalan
    const mapF = new PoseFilter(); // GPS + odometri + pencocokan peta, berjalan saat sakelarnya menyala
    const lidar = new LidarLandmarks(scene.landmarks, scene.buildings, 5);

    const show = { gps: false, odo: false, fus: false, map: false };
    const steer = { on: false, sel: 'gps', take: 0, takeovers: 0, exits: 0, out: false, warned: false };
    let sigma = 2;
    let simT = 0;
    let lidarT = 0;
    let sampleT = 0;
    let lastScan = null;
    const hist = { gps: [], odo: [], fus: [], map: [] }; // [t, galat] untuk rata-rata
    const task = { fixes: 0, above: 0, jumpAt: null, hold: 0, fusShown: 0 };

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
      for (const k of Object.keys(hist)) hist[k].length = 0;
    }

    // ---------- kanvas dan loop ----------
    const labels = createLabelLayer();
    const view = ctx.createView({
      label: 'Kota dari atas. Mobil otonom berkeliling jalan melingkar. Kotak putus-putus putih menandai posisi sebenarnya, penanda berwarna menandai posisi hasil tebakan.',
      background: COLORS.ground,
    });

    const loop = ctx.createLoop({ update, render });

    // ---------- panel kontrol ----------
    const estGroup = ui.group(ctx.controls, { title: 'Estimasi posisi' });
    const toggles = {};
    for (const e of EST) {
      toggles[e.id] = ui.toggle(estGroup, { label: e.toggle, color: e.color, hint: 'Mati', onChange: (on) => setShow(e.id, on) });
    }
    ui.legend(estGroup, [
      { color: '#f8fafc', label: 'Posisi sebenarnya', shape: 'line' },
      { color: COLORS.lidar, label: 'Landmark di peta HD', shape: 'square' },
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
    const latOut = ui.readout(steerReadouts, { label: 'Simpangan lajur', value: '0,00 m' });
    const exitOut = ui.readout(steerReadouts, { label: 'Keluar lajur', value: '0 kali' });
    const takeOut = ui.readout(steerReadouts, { label: 'Diambil alih', value: '0 kali' });

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

    // HUD di atas kanvas
    const zoneChip = ui.hudChip(ctx.hud, { label: 'Zona', color: COLORS.accent });
    const steerChip = ui.hudChip(ctx.hud, { label: 'Kemudi', color: COLORS.accent });
    steerChip.show(false);

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
        }
        hist[id].length = 0;
        // Langkah 2: bila mobil sudah lewat atau masih jauh dari zona gedung tinggi saat GPS
        // dinyalakan, pindahkan mobil ke depan zona supaya pelajar tidak menunggu satu putaran.
        if (id === 'gps' && ctx.currentStep() === 1 && !ctx.isTaskDone('urban-canyon') && relocateBeforeCanyon()) {
          ctx.toast('Mobil dipindah ke dekat zona gedung tinggi supaya kamu tidak perlu menunggu satu putaran.');
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
        steer.exits = 0;
        steer.takeovers = 0;
      }
      steer.on = !!on;
      steer.take = 0;
      steer.warned = false;
      steerToggle.set(steer.on);
      if (steer.on && !show[steer.sel]) setShow(steer.sel, true);
      refreshPanels();
    }

    function setSteerSel(id) {
      steer.sel = id;
      steerSeg.set(id);
      steer.take = 0;
      if (steer.on && !show[id]) setShow(id, true);
      refreshPanels();
    }

    function relocateBeforeCanyon() {
      const s = scene.sOf(ego.x, ego.y);
      if (scene.inCanyon(ego.x, ego.y) || scene.ahead(s, scene.canyonStartS) < 80) return false;
      scene.placeAt(scene.canyonStartS - 55);
      resetEstimates();
      return true;
    }

    // ---------- langkah simulasi ----------
    function update(dt) {
      const prevH = ego.heading;
      let pose = null;
      if (steer.on && steer.take <= 0) pose = poseOf(steer.sel);
      scene.drive(dt, pose, steer.take > 0 ? 5 : CRUISE);
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
        if (show.map) lastScan = mapF.matchScan(lidar.scan(ego), scene.landmarks);
      }

      // simpangan lajur dan pengemudi cadangan
      const lat = scene.laneOffset();
      steer.lat = lat;
      const out = Math.abs(lat) > LANE_OUT;
      if (out && !steer.out && steer.on) steer.exits++;
      steer.out = out;
      if (steer.on) {
        if (steer.take > 0) {
          steer.take -= dt;
          if (steer.take <= 0 && Math.abs(lat) > 0.3) steer.take = 0.1;
        } else if (Math.abs(lat) > TAKEOVER_AT) {
          steer.take = 1.5;
          steer.takeovers++;
          if (!steer.warned) {
            steer.warned = true;
            ctx.toast('Mobil keluar lajur. Pengemudi cadangan mengambil alih sebentar, lalu mengembalikan kemudi.', { tone: 'warn', duration: 4000 });
          }
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
    let lastZone = null;
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
      const lat = steer.lat ?? 0;
      latOut.set(fmt(Math.abs(lat), 2, 'm'));
      latOut.setTone(Math.abs(lat) > TAKEOVER_AT ? 'danger' : Math.abs(lat) > LANE_OUT ? 'warn' : 'ok');
      exitOut.set(`${fmt(steer.exits)} kali`);
      takeOut.set(`${fmt(steer.takeovers)} kali`);
      steerToggle.setHint(steer.on ? `Memakai ${EST_BY_ID[steer.sel].name}` : 'Mati');

      // HUD
      const canyon = scene.inCanyon(ego.x, ego.y);
      zoneChip.set(canyon ? `Gedung tinggi, ${fix ? fix.sats : '-'} satelit` : `Langit terbuka, ${fix ? fix.sats : '-'} satelit`);
      zoneChip.setTone(canyon ? 'warn' : '');
      steerChip.show(steer.on);
      steerChip.set(steer.take > 0 ? 'Diambil alih' : `Estimasi ${EST_BY_ID[steer.sel].name}`);
      steerChip.setTone(steer.take > 0 ? 'danger' : steer.out ? 'warn' : '');
      if (canyon !== lastZone) {
        lastZone = canyon;
        view.setLabel(
          canyon
            ? 'Kota dari atas. Mobil otonom sedang melewati zona gedung tinggi. Kotak putus-putus putih menandai posisi sebenarnya, penanda berwarna menandai posisi hasil tebakan.'
            : 'Kota dari atas. Mobil otonom berkeliling jalan melingkar. Kotak putus-putus putih menandai posisi sebenarnya, penanda berwarna menandai posisi hasil tebakan.',
        );
      }

      updateStatus(errs, avg);
    }

    // ---------- baris status ----------
    function updateStatus(errs, avg) {
      const step = ctx.currentStep();
      const fix = gps.fix;
      const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
      let text = '';
      if (steer.on && steer.take > 0) {
        text = `Mobil keluar lajur karena estimasi ${EST_BY_ID[steer.sel].name} meleset. Pengemudi cadangan mengambil alih sebentar.`;
      } else if (show.gps && fix && fix.jump && simT - fix.t < 2.5) {
        text = `Sinyal satelit memantul di dinding gedung. Posisi GPS melompat, galatnya ${fmtErr(fix.err)}.`;
      } else if (step === 0) {
        if (!show.gps) text = 'Nyalakan GPS di panel Estimasi posisi.';
        else if (others('gps')) text = 'Matikan estimasi selain GPS supaya GPS terlihat sendiri.';
        else text = `Galat GPS ${fmtErr(errs.gps)}, rata-rata ${fmtErr(avg('gps'))}. Satu lajur hanya 3,5 m.`;
      } else if (step === 1) {
        const d = scene.ahead(scene.sOf(ego.x, ego.y), scene.canyonStartS);
        if (!show.gps) text = 'Nyalakan GPS supaya lompatannya terlihat.';
        else if (scene.inCanyon(ego.x, ego.y)) text = `Mobil di zona gedung tinggi. Hanya ${fix ? fix.sats : '-'} satelit terlihat, galat GPS ${fmtErr(errs.gps)}.`;
        else text = `Zona gedung tinggi ${fmt(d, 0, 'm')} lagi. Galat GPS sekarang ${fmtErr(errs.gps)}.`;
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
          text = `Galat peta ${fmtErr(errs.map)}, ${fmt(n)} landmark cocok.${errs.map < 0.3 ? ` Di bawah 0,3 m selama ${fmt(Math.min(task.hold, 5), 1)} detik.` : ''}`;
        }
      } else {
        const parts = EST.filter((e) => show[e.id]).map((e) => `${e.name} ${fmtErr(errs[e.id])}`);
        text = parts.length ? `Galat: ${parts.join(', ')}.` : 'Semua estimasi mati. Nyalakan salah satu di panel Estimasi posisi.';
      }
      ctx.setStatus(cap(text));
    }

    // ---------- menggambar ----------
    function updateCamera() {
      const s = Math.min(view.width, view.height) / 36; // sisi pendek kanvas sekitar 36 m
      view.setScale(s);
      const vw = view.width / s;
      const vh = view.height / s;
      const lead = 0.2 * Math.min(vw, vh);
      view.centerOn(ego.x + Math.cos(ego.heading) * lead, ego.y + Math.sin(ego.heading) * lead);
    }

    function render() {
      updateCamera();
      const g = view.begin(COLORS.ground);
      scene.draw(g, view);
      zoneLabel();
      drawEstimates(g);
      labels.draw(g, view);
      drawOffscreen(g);
      const now = performance.now();
      const mini = minimapBox();
      // peta mini memudar saat ada estimasi di bawahnya (misalnya lompatan GPS di layar ponsel)
      const fadeDt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0;
      lastFrame = now;
      miniAlpha = approach(miniAlpha, minimapCovered(mini) ? 0.15 : 1, fadeDt * 5);
      drawScaleBar(g, view, { x: mini.x + mini.w + 14 });
      drawMinimap(g, mini, miniAlpha);
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

    function zoneLabel() {
      const y = -LOOP.halfH - ROAD_HALF - SIDEWALK - 1.2;
      for (const x of [CANYON.x0, CANYON.x1]) {
        if (onScreen(x, y, -30)) labels.add(x, y, 'Zona gedung tinggi', { color: COLORS.warn, size: 11, dy: -4 });
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
      g.beginPath();
      if (g.roundRect) g.roundRect(-L / 2, -W / 2, L, W, 0.45);
      else g.rect(-L / 2, -W / 2, L, W);
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
        if (onScreen(p.x, p.y, -8)) labels.add(p.x, p.y, `${e.name} ${fmtErr(Math.hypot(p.x - ego.x, p.y - ego.y))}`, { color: e.color, size: 11, dy: -26 });
      }
    }

    /** Sinar pantulan singkat dari dinding gedung ke mobil saat terjadi lompatan multipath. */
    function drawMultipath(g) {
      const f = gps.fix;
      const age = simT - f.t;
      if (!f.jump || age > 1.6) return;
      const wallY = f.jump.y < 0 ? -LOOP.halfH - (ROAD_HALF + SIDEWALK + 1.5) : -LOOP.halfH + ROAD_HALF + SIDEWALK + 1.5;
      const hit = { x: f.truthX + 6, y: wallY };
      const alpha = 1 - age / 1.6;
      drawLine(g, [{ x: hit.x + 9, y: hit.y + (wallY < -LOOP.halfH ? -12 : 12) }, hit, { x: ego.x, y: ego.y }], {
        color: EST_BY_ID.gps.color,
        width: 2,
        view,
        alpha,
        dash: [6, 4],
      });
      drawRing(g, hit.x, hit.y, view.px(7), { color: EST_BY_ID.gps.color, width: 2, view, alpha });
      if (onScreen(hit.x, hit.y, -10)) labels.add(hit.x, hit.y, 'pantulan', { color: EST_BY_ID.gps.color, size: 11, dy: wallY < -LOOP.halfH ? -16 : 16, alpha });
    }

    function drawMapMatching(g) {
      const vb = view.visibleBounds();
      const c = COLORS.lidar;
      // isi peta HD: posisi landmark yang tercatat
      g.save();
      g.strokeStyle = withAlpha(c, 0.8);
      g.lineWidth = view.px(1.5);
      const d = view.px(7);
      for (const lm of scene.landmarks) {
        if (lm.x < vb.minX - 2 || lm.x > vb.maxX + 2 || lm.y < vb.minY - 2 || lm.y > vb.maxY + 2) continue;
        g.beginPath();
        g.moveTo(lm.x, lm.y - d);
        g.lineTo(lm.x + d, lm.y);
        g.lineTo(lm.x, lm.y + d);
        g.lineTo(lm.x - d, lm.y);
        g.closePath();
        g.stroke();
      }
      g.restore();
      drawEllipse(g, mapF, c);
      if (!lastScan) return;
      // hasil ukur LiDAR dilihat dari posisi tebakan: sinar, titik ukur, dan garis ke pasangan di peta
      const px = mapF.x;
      const py = mapF.y;
      const ph = mapF.h;
      const pts = lastScan.pairs.map((p) => ({ x: px + p.r * Math.cos(ph + p.b), y: py + p.r * Math.sin(ph + p.b), lm: p.lm }));
      g.save();
      g.strokeStyle = withAlpha(c, 0.35);
      g.lineWidth = view.px(1.2);
      g.beginPath();
      for (const p of pts) {
        g.moveTo(px, py);
        g.lineTo(p.x, p.y);
      }
      g.stroke();
      const s = view.px(4.5);
      g.strokeStyle = c;
      g.lineWidth = view.px(2);
      g.beginPath();
      for (const p of pts) {
        g.moveTo(p.x - s, p.y - s);
        g.lineTo(p.x + s, p.y + s);
        g.moveTo(p.x - s, p.y + s);
        g.lineTo(p.x + s, p.y - s);
        if (p.lm) {
          g.moveTo(p.x, p.y);
          g.lineTo(p.lm.x, p.lm.y);
        }
      }
      g.stroke();
      g.restore();
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

    function minimapBox() {
      const w = clamp(view.width * 0.2, 96, 168);
      const h = w * ((CITY.maxY - CITY.minY) / (CITY.maxX - CITY.minX)) + MINI_HEAD;
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
      const k = box.w / (CITY.maxX - CITY.minX);
      const M = (x, y) => ({ x: box.x + (x - CITY.minX) * k, y: box.y + MINI_HEAD + (y - CITY.minY) * k });
      g.save();
      view.screen();
      g.globalAlpha = alpha;
      g.fillStyle = 'rgba(11, 18, 32, 0.92)';
      g.strokeStyle = 'rgba(148, 163, 184, 0.3)';
      g.lineWidth = 1;
      g.beginPath();
      if (g.roundRect) g.roundRect(box.x, box.y, box.w, box.h, 8);
      else g.rect(box.x, box.y, box.w, box.h);
      g.fill();
      g.stroke();
      // jalan
      g.strokeStyle = '#56607a';
      g.lineWidth = 3;
      g.lineJoin = 'round';
      g.beginPath();
      scene.center.forEach((p, i) => {
        const q = M(p.x, p.y);
        if (i) g.lineTo(q.x, q.y);
        else g.moveTo(q.x, q.y);
      });
      g.stroke();
      // zona gedung tinggi
      const a = M(CANYON.x0, -LOOP.halfH);
      const b = M(CANYON.x1, -LOOP.halfH);
      g.strokeStyle = COLORS.warn;
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
      // area yang terlihat di kanvas
      const vb = view.visibleBounds();
      const v0 = M(Math.max(CITY.minX, vb.minX), Math.max(CITY.minY, vb.minY));
      const v1 = M(Math.min(CITY.maxX, vb.maxX), Math.min(CITY.maxY, vb.maxY));
      g.strokeStyle = 'rgba(226, 232, 240, 0.45)';
      g.lineWidth = 1;
      g.strokeRect(v0.x, v0.y, Math.max(0, v1.x - v0.x), Math.max(0, v1.y - v0.y));
      // mobil
      const e = M(ego.x, ego.y);
      g.fillStyle = COLORS.ego;
      g.beginPath();
      g.arc(e.x, e.y, 3.5, 0, TAU);
      g.fill();
      g.fillStyle = 'rgba(148, 163, 184, 0.95)';
      g.font = `600 10px ${FONT}`;
      g.textAlign = 'left';
      g.textBaseline = 'top';
      g.fillText('Peta kota', box.x + 7, box.y + 5);
      g.restore();
      view.world();
    }

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
        task.fixes = 0;
        task.above = 0;
        task.jumpAt = null;
        task.hold = 0;
        task.fusShown = 0;
        refreshPanels();
      },
      reset() {
        simT = 0;
        lidarT = 0;
        sampleT = 0;
        gps.reset();
        imu.reset();
        lidar.reset();
        const step = ctx.currentStep();
        scene.placeAt(step === 1 ? scene.canyonStartS - 55 : scene.START_S);
        resetEstimates();
        chart.clear();
        Object.assign(steer, { take: 0, takeovers: 0, exits: 0, out: false, warned: false });
        Object.assign(task, { fixes: 0, above: 0, jumpAt: null, hold: 0, fusShown: 0 });
        refreshPanels();
      },
      destroy() {
        // Kanvas, loop, dan listener dibersihkan otomatis oleh ctx.
      },
    };
  },
};

