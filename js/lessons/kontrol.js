// Pelajaran 6: Kendali Kemudi dan Kecepatan.
//
// Susunan mengikuti pelajaran contoh (sensor.js):
//   - teks pelajaran di objek default export;
//   - lintasan di ./kontrol/track.js, model (pure pursuit, PID, pengukuran) di ./kontrol/sim.js,
//     gambar di ./kontrol/scene.js;
//   - mount(ctx) menyusun kanvas, loop, panel kontrol, deteksi tugas, dan preset tiap langkah.
//
// Hasil uji model (tests/kontrol_model.py, dijalankan dengan Node):
//   - Ld 3 m pada 40 km/jam: ayunan membesar sampai pengemudi cadangan mengambil alih (jeda setir 0,18 detik).
//   - Ld 5 sampai 12 m pada 30 sampai 50 km/jam: RMS galat satu putaran di bawah 0,3 m.
//   - Ld 15 m atau lebih: mobil memotong sisi dalam tikungan sekitar 1 sampai 2,6 m.
//   - dari diam ke 40 km/jam: Kp 0,8 dan Ki 0,2 memberi overshoot sekitar 3%, Ki 1 sekitar 12%.

import { COLORS } from '../engine/theme.js';
import { fmt, fmtSigned, clamp } from '../engine/math.js';
import { drawScaleBar, createLabelLayer } from '../engine/draw.js';
import * as ui from '../engine/ui.js';
import { buildTrack } from './kontrol/track.js';
import { createSim, CFG, DEFAULTS } from './kontrol/sim.js';
import { createScene, TRAIL_COLORS, ARC_COLOR, CIRCLE_COLOR } from './kontrol/scene.js';

const KMH = 1 / 3.6;
const MIN_STEP_KMH = 10; // lonjakan kecepatan terkecil yang dihitung untuk tugas PID
const OVERSHOOT_GAINS = { kp: 0.8, ki: 1, kd: 0 };

// Preset tiap langkah. Nilai yang tidak disebut dibiarkan sesuai pilihan pelajar.
// restart = mobil kembali ke garis start dan melaju dari diam.
const STEP_PRESETS = [
  { adaptive: false, ld: 8, targetKmh: 40, curveSlow: false },
  { adaptive: false, ld: 8, targetKmh: 40, curveSlow: false },
  { adaptive: false, ld: 18, targetKmh: 40, curveSlow: false },
  { adaptive: false, ld: 8, targetKmh: 40, curveSlow: false, gains: { kp: DEFAULTS.kp, ki: DEFAULTS.ki, kd: DEFAULTS.kd }, restart: true },
  { adaptive: false, ld: 8, targetKmh: 40, curveSlow: false, gains: OVERSHOOT_GAINS, restart: true },
];

const fmtLd = (ld) => fmt(ld, Math.abs(ld - Math.round(ld)) > 0.05 ? 1 : 0, 'm');

export default {
  id: 'kontrol',
  title: 'Kendali Kemudi dan Kecepatan',
  layout: 'sim',
  intro:
    '<p>Mobil otonom sudah punya jalur. Sekarang ia harus memutar setir, menginjak gas, dan mengerem supaya tetap di jalur itu. Kamu akan menyetel dua pengendali di lintasan uji yang berkelok: <strong>pure pursuit</strong> untuk setir dan <strong>PID</strong> untuk kecepatan.</p>',
  steps: [
    {
      title: 'Lookahead terlalu pendek',
      body:
        '<p>Pure pursuit memilih <strong>titik tujuan</strong> di jalur, sejauh <em>Ld</em> (lookahead) dari tengah sumbu roda belakang. Lalu ia memutar roda depan sebesar δ supaya mobil melengkung tepat melewati titik itu.</p>' +
        '<div class="formula">δ = atan(2 · L · sin α / Ld)</div>' +
        '<p>L adalah jarak sumbu roda (2,7 m) dan α sudut titik tujuan dilihat dari arah hadap mobil. Seperti setir sungguhan, setir di sini baru bergerak 0,18 detik setelah diperintah. Di penunjuk Setir, segitiga adalah perintah dan jarum adalah sudut roda sebenarnya.</p>',
      task: { id: 'lookahead-small', text: 'Kecilkan lookahead menjadi <strong>3 m atau kurang</strong> dengan kecepatan target 40 km/jam atau lebih, lalu amati mobil berayun kiri kanan.' },
    },
    {
      title: 'Lookahead terlalu panjang',
      body:
        '<p>Dengan Ld pendek, simpangan sekecil apa pun dibalas dengan belokan tajam. Karena setir selalu sedikit terlambat, mobil kebablasan ke sisi lain dan ayunannya makin besar. Bila mobil menyimpang lebih dari 3,5 m atau arahnya melenceng lebih dari 30 derajat, pengemudi cadangan mengambil alih, seperti pada uji jalan mobil otonom sungguhan.</p>' +
        '<p>Ld yang panjang membuat setir tenang. Masalahnya, titik tujuan sudah masuk tikungan saat mobil masih di jalan lurus. Mobil berbelok terlalu awal dan <strong>memotong tikungan</strong> ke sisi dalam. Di tikungan kanan, sisi dalam berarti lajur lawan.</p>',
      task: { id: 'lookahead-large', text: 'Besarkan lookahead menjadi <strong>15 m atau lebih</strong>, lalu lihat mobil memotong tikungan.' },
    },
    {
      title: 'Cari lookahead yang pas',
      body:
        '<p><strong>Galat lintasan</strong> adalah jarak tengah sumbu roda belakang dari jalur acuan. Nilai positif berarti mobil ada di kanan jalur. RMS (akar dari rata-rata kuadrat galat) merangkum galat satu putaran menjadi satu angka. Jejak berwarna di lintasan menunjukkan di mana galatnya besar.</p>' +
        '<p>Makin cepat mobil, makin panjang Ld yang dibutuhkan. Karena itu Ld sering dibuat sebanding dengan kecepatan, Ld = k · v dengan v dalam m/s. Mode <strong>Adaptif</strong> di panel Kemudi memakai rumus ini.</p>' +
        '<p class="note">Putaran diukur ulang setiap kali kamu mengubah pengaturan kemudi atau kecepatan. Sakelar Pelan di tikungan menurunkan kecepatan sebelum tikungan supaya percepatan samping tidak lebih dari 3 m/s².</p>',
      task: { id: 'tuned', text: 'Cari lookahead yang membuat <strong>RMS galat lintasan di bawah 0,3 m</strong> selama satu putaran penuh, dengan kecepatan rata-rata 30 km/jam atau lebih.' },
    },
    {
      title: 'PID untuk kecepatan',
      body:
        '<p>Kecepatan diatur oleh pengendali PID. Setiap saat ia menghitung selisih <em>e</em> antara kecepatan target dan kecepatan terukur, lalu meminta percepatan <em>u</em>.</p>' +
        '<div class="formula">u = Kp·e + Ki·∫e dt + Kd·de/dt</div>' +
        '<ul><li>Kp bereaksi pada selisih saat ini. Kalau hanya ada Kp, kecepatan berhenti sedikit di bawah target karena hambatan udara dan hambatan gulir ban terus memperlambat mobil.</li>' +
        '<li>Ki menjumlahkan selisih dari waktu ke waktu, sehingga sisa selisih itu lama-lama habis.</li>' +
        '<li>Kd bereaksi pada laju perubahan selisih.</li></ul>' +
        '<p><strong>Overshoot</strong> adalah seberapa jauh kecepatan melewati target, dibandingkan besar lonjakannya. Contohnya, target naik dari 0 ke 40 km/jam dan kecepatan sempat mencapai 44 km/jam. Overshoot-nya 4 dari 40, yaitu 10%.</p>',
      task: { id: 'pid-overshoot', text: 'Buat <strong>overshoot kecepatan lebih dari 10%</strong>. Naikkan Ki sampai sekitar 1, lalu tekan <strong>Uji dari diam</strong> di panel Hasil.' },
    },
    {
      title: 'Setel PID',
      body:
        '<p>Sekarang Ki sengaja dibuat terlalu besar. Selama mobil belum sampai target, suku I terus menumpuk. Saat target tercapai, tumpukan itu masih mendorong gas, jadi kecepatan kebablasan.</p>' +
        '<p>Gas dan rem juga punya batas. Pengendali ini paling kuat meminta 2,5 m/s² saat mempercepat dan 4 m/s² saat mengerem, dan mesin baru menanggapi sekitar 0,1 detik setelah diperintah. Selama gas atau rem sudah mentok, integral berhenti menumpuk (anti-windup).</p>' +
        '<p>Pada lonjakan kecil saat mobil sudah melaju, gas tidak sampai mentok. Suku I terus menumpuk, jadi overshoot-nya biasanya lebih besar daripada uji dari diam.</p>' +
        '<p class="note">Kd jarang dipakai untuk kecepatan. Sensor kecepatan selalu sedikit berderau, dan Kd yang besar membuat perintah gas dan rem ikut bergetar.</p>',
      task: { id: 'pid-tuned', text: 'Setel Kp, Ki, dan Kd sampai kecepatan mencapai target dengan <strong>overshoot di bawah 5%</strong>, untuk lonjakan minimal 10 km/jam. Tekan <strong>Uji dari diam</strong> setelah mengubah nilai.' },
    },
  ],
  summary:
    '<ul><li>Pure pursuit mengarahkan mobil ke titik tujuan sejauh Ld di depan. Ld terlalu pendek membuat mobil berayun karena setir selalu terlambat. Ld terlalu panjang membuat mobil memotong tikungan.</li>' +
    '<li>Ld yang baik bertambah seiring kecepatan, sehingga rumus Ld = k · v sering dipakai.</li>' +
    '<li>PID mengatur kecepatan. Kp mempercepat tanggapan dan Ki menghapus selisih yang tersisa, tetapi Ki yang besar menimbulkan overshoot.</li>' +
    '<li>Setir, gas, dan rem punya jeda dan batas. Karena itu pengendali tidak bisa dibuat seagresif mungkin.</li></ul>' +
    '<p class="note">Penyederhanaan di simulasi ini: model sepeda kinematik (ban tidak pernah selip), posisi mobil diketahui tepat, dan pengendali tidak pernah meminta belokan melebihi cengkeram ban (sekitar 0,87 g). Mobil sungguhan juga memakai pengendali lain, misalnya Stanley (mengoreksi galat dari posisi roda depan) atau MPC (menghitung gerakan beberapa detik ke depan dengan model kendaraan).</p>',

  styles: `
    .lesson-kontrol .chart-pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    .lesson-kontrol .result-grid { grid-template-columns: repeat(auto-fill, minmax(128px, 1fr)); }
    .lesson-kontrol .result-row { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; }
    .lesson-kontrol .result-row .btn { flex: none; min-height: 44px; }
    .lesson-kontrol .result-note { flex: 1 1 260px; margin: 0; }
    .lesson-kontrol .readout { justify-content: space-between; }
    .lesson-kontrol .grp-view .ctl-seg { max-width: 380px; }
    .lesson-kontrol .ctl-slider.is-hidden { display: none; }
    @media (min-width: 1240px) {
      .lesson-kontrol .controls { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .lesson-kontrol .grp-steer { grid-column: 1; grid-row: 1; }
      .lesson-kontrol .grp-speed { grid-column: 2; grid-row: 1; }
      .lesson-kontrol .grp-pid { grid-column: 3; grid-row: 1 / span 2; }
      .lesson-kontrol .grp-view { grid-column: 1 / span 2; grid-row: 2; }
      .lesson-kontrol .grp-result { grid-column: 1 / -1; grid-row: 3; }
      .lesson-kontrol .grp-chart { grid-column: 1 / -1; grid-row: 4; }
    }
    @media (max-width: 700px) {
      .lesson-kontrol .chart-pair { grid-template-columns: minmax(0, 1fr); }
      .lesson-kontrol .result-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .lesson-kontrol .result-row .btn { flex: 1 1 100%; }
    }
  `,

  mount(ctx) {
    // ---------- model ----------
    const track = buildTrack();
    const sim = createSim(track, { seed: 7 });
    const scene = createScene(track);
    const st = sim.state;
    const set = sim.settings;
    const holds = {};
    let stepStart = 0; // waktu simulasi saat langkah sekarang dibuka
    let camera = 'ikuti';
    let takeoverToastAt = -Infinity;
    let lastTakeoverCount = 0;

    // ---------- kanvas dan loop ----------
    const labels = createLabelLayer();
    // Kotak penunjuk setir dan peta mini (piksel CSS). Dipakai untuk menggambar dan untuk
    // memastikan label di kanvas tidak tertutup kotak-kotak itu.
    const overlaySizes = (narrow) => ({
      m: narrow ? 8 : 12,
      gauge: narrow ? { w: 118, h: 80 } : { w: 150, h: 92 },
      mini: narrow ? { w: 116, h: 88 } : { w: 172, h: 130 },
    });
    // Seluruh lintasan: sisakan tempat untuk chip HUD di atas, dan untuk penunjuk setir di kanan
    // bawah (layar lebar) atau di bawah (layar tegak), mana yang membuat lintasan tampak lebih besar.
    const OVERVIEW_PAD = 14;
    let fitHudBottom = 0; // tinggi HUD yang dipakai saat fit terakhir
    const overviewBounds = (v) => {
      const b = track.bounds;
      const base = { minX: b.minX - 4, minY: b.minY - 4, maxX: b.maxX + 4, maxY: b.maxY + 4 };
      const { m, gauge } = overlaySizes(v.width < 600);
      fitHudBottom = hudRect ? hudRect.y + hudRect.h : 0;
      const roomTop = Math.max(0, fitHudBottom - OVERVIEW_PAD);
      const tw = base.maxX - base.minX;
      const th = base.maxY - base.minY;
      const aw = v.width - 2 * OVERVIEW_PAD;
      const ah = v.height - 2 * OVERVIEW_PAD - roomTop;
      const roomX = gauge.w + m;
      const roomY = gauge.h + m;
      const sRight = Math.min((aw - roomX) / tw, ah / th);
      const sBottom = Math.min(aw / tw, (ah - roomY) / th);
      if (sRight <= 0 && sBottom <= 0) return base;
      const s = Math.max(sRight, sBottom);
      const out = { ...base, minY: base.minY - roomTop / s };
      if (sRight >= sBottom) out.maxX += roomX / s;
      else out.maxY += roomY / s;
      return out;
    };
    const view = ctx.createView({
      label: 'Lintasan uji dari atas. Mobil otonom hijau toska mengikuti jalur acuan di lajur kiri.',
      background: COLORS.ground,
      padding: 14,
    });

    let chartTick = 0;
    const loop = ctx.createLoop({
      update(dt) {
        sim.step(dt);
        if (++chartTick >= 4) {
          chartTick = 0;
          cteChart.push(st.time, st.cte);
          speedChart.push(st.time, sim.ego.speed * 3.6, st.vRef * 3.6);
        }
      },
      render,
    });

    // ---------- panel kontrol ----------
    // Kemudi
    const steerGroup = ui.group(ctx.controls, { title: 'Kemudi (pure pursuit)', className: 'grp-steer' });
    const modeCtl = ui.segmented(steerGroup, {
      label: 'Mode lookahead',
      options: [
        { value: 'tetap', label: 'Tetap' },
        { value: 'adaptif', label: 'Adaptif (k · v)' },
      ],
      value: 'tetap',
      onChange: (v) => setMode(v === 'adaptif'),
    });
    const ldSlider = ui.slider(steerGroup, {
      label: 'Lookahead Ld',
      min: CFG.ldMin,
      max: CFG.ldMax,
      step: 0.5,
      value: set.ld,
      format: (v) => fmtLd(v),
      onInput: (v) => {
        set.ld = v;
        sim.notifyTrackingChange();
      },
    });
    const kSlider = ui.slider(steerGroup, {
      label: 'Faktor k',
      min: 0.2,
      max: 2,
      step: 0.05,
      value: set.k,
      format: (v) => fmt(v, 2, 'detik'),
      hint: 'Ld = k · v, dibatasi 2 sampai 20 m.',
      onInput: (v) => {
        set.k = v;
        sim.notifyTrackingChange();
      },
    });
    const steerReadouts = ui.readoutGrid(steerGroup);
    const ldOut = ui.readout(steerReadouts, { label: 'Ld dipakai', value: '-' });
    const steerOut = ui.readout(steerReadouts, { label: 'Sudut roda', value: '-' });

    // Kecepatan
    const speedGroup = ui.group(ctx.controls, { title: 'Kecepatan', className: 'grp-speed' });
    const targetSlider = ui.slider(speedGroup, {
      label: 'Kecepatan target',
      min: 10,
      max: 50,
      step: 1,
      value: set.targetKmh,
      unit: 'km/jam',
      onInput: (v) => {
        set.targetKmh = v;
        sim.notifyTargetChange();
      },
    });
    const curveToggle = ui.toggle(speedGroup, {
      label: 'Pelan di tikungan',
      hint: 'Batas percepatan samping 3 m/s²', // spasi tak terputus: angka dan satuan tidak terpisah baris
      color: COLORS.warn,
      checked: set.curveSlow,
      onChange: (on) => {
        set.curveSlow = on;
        sim.notifyTrackingChange();
      },
    });
    const speedReadouts = ui.readoutGrid(speedGroup);
    const speedOut = ui.readout(speedReadouts, { label: 'Kecepatan', value: '-' });
    const latOut = ui.readout(speedReadouts, { label: 'Percepatan samping', value: '-' });

    // PID
    const pidGroup = ui.group(ctx.controls, { title: 'Pengendali PID', className: 'grp-pid' });
    const gainSlider = (label, key, max, step) =>
      ui.slider(pidGroup, {
        label,
        min: 0,
        max,
        step,
        value: set[key],
        digits: 2,
        onInput: (v) => {
          set[key] = v;
          sim.notifyGainChange();
        },
      });
    const kpSlider = gainSlider('Kp', 'kp', 5, 0.1);
    const kiSlider = gainSlider('Ki', 'ki', 2, 0.05);
    const kdSlider = gainSlider('Kd', 'kd', 1, 0.05);
    const pidReadouts = ui.readoutGrid(pidGroup);
    const pOut = ui.readout(pidReadouts, { label: 'Suku P', value: '-' });
    const iOut = ui.readout(pidReadouts, { label: 'Suku I', value: '-' });
    const dOut = ui.readout(pidReadouts, { label: 'Suku D', value: '-' });
    const uOut = ui.readout(pidReadouts, { label: 'Perintah u', value: '-' });
    pidGroup.append(ui.el('p', { class: 'ctl-hint', text: 'Suku P, I, D, dan perintah u dalam m/s². Positif berarti gas, negatif berarti rem.' }));

    // Hasil
    const resultGroup = ui.group(ctx.controls, { title: 'Hasil', wide: true, className: 'grp-result' });
    const resultGrid = ui.readoutGrid(resultGroup);
    resultGrid.classList.add('result-grid');
    const rmsOut = ui.readout(resultGrid, { label: 'RMS putaran terakhir', value: '-' });
    const maxOut = ui.readout(resultGrid, { label: 'Galat maks putaran', value: '-' });
    const avgOut = ui.readout(resultGrid, { label: 'Rata-rata kecepatan', value: '-' });
    const lapOut = ui.readout(resultGrid, { label: 'Putaran berjalan', value: '-' });
    const osOut = ui.readout(resultGrid, { label: 'Overshoot kecepatan', value: '-' });
    const reachOut = ui.readout(resultGrid, { label: 'Waktu mencapai target', value: '-' });
    const resultRow = ui.el('div', { class: 'result-row' });
    resultGroup.append(resultRow);
    ui.button(resultRow, { label: 'Uji dari diam', icon: 'reset', onClick: () => restartFromStandstill() });
    const resultNote = ui.el('p', { class: 'ctl-hint result-note', text: 'Uji dari diam mengembalikan mobil ke garis start, lalu mobil melaju lagi dari 0 km/jam.' });
    resultRow.append(resultNote);

    // Grafik
    const chartGroup = ui.group(ctx.controls, { title: 'Grafik 12 detik terakhir', wide: true, className: 'grp-chart' });
    const pair = ui.el('div', { class: 'chart-pair' });
    chartGroup.append(pair);
    const cteChart = ui.timeChart(pair, {
      label: 'Galat lintasan (positif = kanan jalur)',
      series: [{ label: 'galat', color: COLORS.accent }],
      span: 12,
      min: -2,
      max: 2,
      unit: 'm',
      digits: 2,
      height: 118,
    });
    const speedChart = ui.timeChart(pair, {
      label: 'Kecepatan',
      series: [
        { label: 'kecepatan', color: COLORS.accent },
        { label: 'target', color: COLORS.warn },
      ],
      span: 12,
      min: 0,
      max: 60,
      unit: 'km/jam',
      digits: 0,
      height: 118,
    });

    // Tampilan
    const viewGroup = ui.group(ctx.controls, { title: 'Tampilan', wide: true, className: 'grp-view' });
    ui.segmented(viewGroup, {
      ariaLabel: 'Sudut pandang kamera',
      options: [
        { value: 'ikuti', label: 'Ikuti mobil' },
        { value: 'semua', label: 'Seluruh lintasan' },
      ],
      value: camera,
      onChange: (v) => setCamera(v),
    });
    ui.legend(viewGroup, [
      { color: COLORS.path, label: 'jalur acuan', shape: 'line' },
      { color: CIRCLE_COLOR, label: 'lingkaran Ld', shape: 'dot' },
      { color: COLORS.target, label: 'titik tujuan', shape: 'dot' },
      { color: ARC_COLOR, label: 'busur setir', shape: 'line' },
      { color: TRAIL_COLORS.ok, label: 'jejak, galat < 0,3 m', shape: 'line' },
      { color: TRAIL_COLORS.warn, label: '0,3 sampai 1 m', shape: 'line' },
      { color: TRAIL_COLORS.danger, label: '> 1 m', shape: 'line' },
    ]);

    // HUD di atas kanvas
    const ldChip = ui.hudChip(ctx.hud, { label: 'Ld', color: CIRCLE_COLOR });
    const speedChip = ui.hudChip(ctx.hud, { label: 'Kecepatan', color: COLORS.accent });
    const cteChip = ui.hudChip(ctx.hud, { label: 'Galat', color: COLORS.ok });
    const takeoverChip = ui.hudChip(ctx.hud, { label: 'Pengemudi cadangan', color: COLORS.warn });
    takeoverChip.setTone('warn');
    takeoverChip.set('aktif');
    takeoverChip.show(false);

    // ---------- aksi ----------
    function setMode(adaptive) {
      set.adaptive = adaptive;
      modeCtl.set(adaptive ? 'adaptif' : 'tetap');
      ldSlider.setDisabled(adaptive);
      kSlider.el.classList.toggle('is-hidden', !adaptive);
      sim.notifyTrackingChange();
    }

    function setLd(ld) {
      set.ld = ld;
      ldSlider.set(ld);
      sim.notifyTrackingChange();
    }

    function setTarget(kmh) {
      if (set.targetKmh === kmh) return;
      set.targetKmh = kmh;
      targetSlider.set(kmh);
      sim.notifyTargetChange();
    }

    function setCurveSlow(on) {
      set.curveSlow = on;
      curveToggle.set(on);
      sim.notifyTrackingChange();
    }

    function setGains({ kp, ki, kd }) {
      Object.assign(set, { kp, ki, kd });
      kpSlider.set(kp);
      kiSlider.set(ki);
      kdSlider.set(kd);
      sim.notifyGainChange();
    }

    function setCamera(v) {
      camera = v;
      if (v === 'semua') view.fit(overviewBounds, OVERVIEW_PAD);
      else view.fit(null);
    }

    function clearCharts() {
      chartTick = 0;
      cteChart.clear();
      speedChart.clear();
    }

    function restartFromStandstill() {
      sim.reset();
      clearCharts();
      stepStart = 0;
      lastTakeoverCount = 0;
      loop.resetTime();
      for (const k of Object.keys(holds)) holds[k] = 0;
      ctx.resume();
      refreshPanels(0);
    }

    // ---------- deteksi tugas ----------
    const weaving = () => sim.swingSummary(6, 0.3);
    const cuttingInside = () => {
      const k = st.curvatureHere;
      return Math.abs(k) > 0.01 && Math.sign(k) === Math.sign(st.cte) && Math.abs(st.cte) >= 0.6;
    };
    const recentTakeover = () => {
      const t = st.lastTakeover;
      return !!t && st.time - t.at < 5 && t.at >= stepStart && t.ld <= 3 + 1e-6 && t.targetKmh >= 40 && t.kmh >= 30;
    };
    const episodeCounts = (ep) => !!ep && ep.valid && !ep.stale && ep.t0 >= stepStart && ep.step >= MIN_STEP_KMH * KMH - 1e-6;

    const TASK_CHECKS = {
      'lookahead-small': {
        hold: 0.2,
        test: () => st.ldEff <= 3 + 1e-6 && set.targetKmh >= 40 && ((weaving().swings >= 2 && sim.ego.speed >= 30 * KMH) || recentTakeover()),
      },
      'lookahead-large': {
        hold: 0.6,
        test: () => st.ldEff >= 15 - 1e-6 && !st.takeover && sim.ego.speed >= 15 * KMH && cuttingInside(),
      },
      tuned: {
        hold: 0,
        test: () => {
          const lap = st.lastLap;
          return !!lap && lap.endTime > stepStart && !lap.takeover && lap.rms < 0.3 && lap.avgKmh >= 29.5;
        },
      },
      'pid-overshoot': { hold: 0, test: () => episodeCounts(st.episode) && st.episode.overshoot > 0.1 },
      'pid-tuned': {
        hold: 0,
        test: () => {
          const ep = st.episode;
          return episodeCounts(ep) && ep.reachedAt != null && ep.settledSince != null && st.time - ep.settledSince >= 3 && ep.overshoot < 0.05;
        },
      },
    };

    function checkTasks(realDt) {
      const taskId = ctx.lesson.steps[ctx.currentStep()]?.taskId;
      if (!taskId || ctx.isTaskDone(taskId)) return;
      const check = TASK_CHECKS[taskId];
      if (!check) return;
      holds[taskId] = check.test() ? (holds[taskId] || 0) + realDt : 0;
      if (check.test() && holds[taskId] >= check.hold) ctx.completeTask(taskId);
    }

    // ---------- pembaruan panel (sekitar 8 kali per detik) ----------
    let lastPanel = 0;
    function refreshPanels(realDt) {
      const ego = sim.ego;
      const kmh = ego.speed * 3.6;
      const ld = st.ldEff;
      const deg = (ego.steer * 180) / Math.PI;

      ldOut.set(set.adaptive ? `${fmtLd(ld)} (adaptif)` : fmtLd(ld));
      steerOut.set(`${fmtSigned(deg, 1)}°`);
      speedOut.set(fmt(kmh, 0, 'km/jam'));
      latOut.set(fmt(Math.abs(st.latAccel), 1, 'm/s²'));
      latOut.setTone(Math.abs(st.latAccel) > 7 ? 'danger' : Math.abs(st.latAccel) > 4.5 ? 'warn' : '');

      const terms = sim.pid.terms;
      pOut.set(fmtSigned(terms.p, 2));
      iOut.set(fmtSigned(terms.i, 2));
      dOut.set(fmtSigned(terms.d, 2));
      uOut.set(fmt(st.aCmd, 2, 'm/s²'));
      uOut.setTone(st.aCmd >= CFG.accelMax - 1e-3 || st.aCmd <= -CFG.brakeMax + 1e-3 ? 'warn' : '');

      // hasil putaran
      const lap = st.lastLap;
      if (lap) {
        rmsOut.set(fmt(lap.rms, 2, 'm'));
        rmsOut.setTone(lap.takeover ? 'off' : lap.rms < 0.3 ? 'ok' : lap.rms < 1 ? 'warn' : 'danger');
        maxOut.set(fmt(lap.max, 2, 'm'));
        maxOut.setTone(lap.takeover ? 'off' : '');
        avgOut.set(fmt(lap.avgKmh, 0, 'km/jam'));
        avgOut.setTone(lap.takeover ? 'off' : '');
      } else {
        rmsOut.set('-');
        maxOut.set('-');
        avgOut.set('-');
        for (const r of [rmsOut, maxOut, avgOut]) r.setTone('');
      }
      lapOut.set(st.takeover ? 'diambil alih' : `${fmt(sim.lapProgress() * 100, 0)}%`);
      lapOut.setTone(st.takeover ? 'warn' : '');

      // hasil uji kecepatan
      const ep = st.episode;
      let epNote = '';
      if (ep) {
        const measured = ep.valid;
        osOut.set(measured ? `${fmt(ep.overshoot * 100, 1)}%` : 'tidak diukur');
        osOut.setTone(!measured || ep.stale ? 'off' : ep.reachedAt == null ? '' : ep.overshoot > 0.1 ? 'danger' : ep.overshoot >= 0.05 ? 'warn' : 'ok');
        // waktu mencapai target tetap berarti untuk lonjakan turun, selama uji tidak terganggu
        reachOut.set(ep.spoiled ? '-' : ep.reachedAt != null ? fmt(ep.reachedAt, 1, 'detik') : 'belum');
        reachOut.setTone(ep.spoiled || ep.stale ? 'off' : '');
        if (ep.spoiled === 'tikungan') epNote = 'Overshoot tidak diukur karena Pelan di tikungan sempat menyala. Matikan sakelarnya, lalu tekan Uji dari diam.';
        else if (ep.spoiled) epNote = 'Overshoot tidak diukur karena pengemudi cadangan sempat mengambil alih.';
        else if (ep.dir < 0) epNote = 'Overshoot hanya diukur saat kecepatan target naik, misalnya dengan Uji dari diam.';
        else if (ep.stale) epNote = 'Nilai Kp, Ki, atau Kd berubah. Tekan Uji dari diam untuk mengukur lagi.';
        else if (ep.step < MIN_STEP_KMH * KMH - 1e-6) epNote = 'Lonjakan kecepatan kurang dari 10 km/jam, terlalu kecil untuk tugas.';
      }
      let lapNote = '';
      if (lap?.takeover && !st.takeover) lapNote = 'Putaran terakhir tidak dihitung karena pengemudi cadangan sempat mengambil alih.';
      const noteText = [lapNote, epNote].filter(Boolean).join(' ') || 'Uji dari diam mengembalikan mobil ke garis start, lalu mobil melaju lagi dari 0 km/jam.';
      if (resultNote.textContent !== noteText) resultNote.textContent = noteText;

      // HUD
      ldChip.set(set.adaptive ? `${fmtLd(ld)} adaptif` : fmtLd(ld));
      speedChip.set(`${fmt(kmh, 0)} / ${fmt(st.vRef * 3.6, 0)} km/jam`);
      cteChip.set(fmtSigned(st.cte, 2, 'm'));
      const tone = Math.abs(st.cte) < 0.3 ? 'ok' : Math.abs(st.cte) < 1 ? 'warn' : 'danger';
      cteChip.setTone(tone);
      cteChip.el.style.setProperty('--tone', TRAIL_COLORS[tone]);
      takeoverChip.show(!!st.takeover);

      // pemberitahuan pengambilalihan (paling sering sekali per 20 detik)
      if (st.takeovers > lastTakeoverCount) {
        lastTakeoverCount = st.takeovers;
        const now = performance.now();
        if (now - takeoverToastAt > 20000) {
          takeoverToastAt = now;
          ctx.toast('Mobil berayun terlalu keras. Pengemudi cadangan mengambil alih sebentar.', { tone: 'warn', duration: 3500 });
        }
      }

      checkTasks(realDt);
      updateStatus();
    }

    // ---------- baris status ----------
    function updateStatus() {
      const kmh = sim.ego.speed * 3.6;
      const ld = fmtLd(st.ldEff);
      const sw = weaving();
      let text;
      if (st.takeover) {
        text = 'Mobil berayun terlalu keras. Pengemudi cadangan mengambil alih dan membawanya pelan-pelan kembali ke tengah lajur.';
      } else if (kmh < 1 && sim.ego.speed < st.vRef) {
        text = `Mobil mulai melaju dari garis start menuju ${fmt(st.vRef * 3.6, 0)} km/jam.`;
      } else if (sw.swings >= 2) {
        text = `Mobil berayun kiri kanan ${fmt(sw.frequency, 1)} kali per detik (simpangan ${fmt(sw.amplitude, 1)} m). Ld ${ld} terlalu pendek untuk ${fmt(kmh, 0)} km/jam.`;
      } else if (cuttingInside() && st.ldEff >= 10) {
        text = `Mobil memotong tikungan ${fmt(Math.abs(st.cte), 1)} m ke sisi dalam karena titik tujuannya terlalu jauh.`;
      } else {
        text = `Mobil melaju ${fmt(kmh, 0)} km/jam dengan Ld ${ld}. Galat lintasan ${fmt(Math.abs(st.cte), 2)} m${Math.abs(st.cte) >= 0.005 ? (st.cte > 0 ? ' ke kanan' : ' ke kiri') : ''}.`;
      }
      ctx.setStatus(text);
    }

    // ---------- menggambar ----------
    let lastFrame = 0;
    const camOffset = { x: 0, y: 0 };
    function placeCamera(realDt) {
      if (camera === 'semua') return;
      const scale = clamp(Math.min(view.width / 58, view.height / 36), 7, 18);
      view.setScale(scale);
      const ra = sim.ego.rearAxle();
      const target = (st.takeover ? st.safePp : st.pp)?.target || ra;
      // geser kamera sedikit ke arah titik tujuan supaya bagian depan terlihat, dihaluskan
      const gx = (target.x - ra.x) * 0.4;
      const gy = (target.y - ra.y) * 0.4;
      const k = realDt > 0 ? 1 - Math.exp(-realDt * 3) : 1;
      camOffset.x += (gx - camOffset.x) * k;
      camOffset.y += (gy - camOffset.y) * k;
      view.centerOn(ra.x + camOffset.x, ra.y + camOffset.y);
    }

    /** Letak penunjuk setir, peta mini, dan skala jarak (piksel CSS) untuk ukuran kanvas sekarang. */
    function overlayLayout() {
      const W = view.width;
      const H = view.height;
      const narrow = W < 600;
      const { m, gauge, mini } = overlaySizes(narrow);
      const follow = camera === 'ikuti';
      const gaugeRect = narrow && follow ? { x: m, y: H - gauge.h - m, ...gauge } : { x: W - gauge.w - m, y: H - gauge.h - m, ...gauge };
      let miniRect = null;
      let scaleAt = { x: 14, y: H - 16 };
      if (follow) {
        miniRect = narrow ? { x: W - mini.w - m, y: H - mini.h - m, ...mini } : { x: m, y: H - mini.h - m, ...mini };
        // skala jarak di atas kotak kiri bawah
        scaleAt = { x: m + 4, y: H - (narrow ? gauge.h : mini.h) - m - 12 };
      }
      const scaleRect = { x: scaleAt.x - 2, y: scaleAt.y - 16, w: 140, h: 20 };
      return { gaugeRect, miniRect, scaleAt, avoid: [gaugeRect, miniRect, scaleRect, hudRect].filter(Boolean) };
    }

    // Kotak gabungan chip HUD yang terlihat (piksel CSS relatif ke kanvas), diukur bersama panel.
    let hudRect = null;
    function measureHud() {
      const chips = [...ctx.hud.children].filter((c) => !c.hidden);
      if (!chips.length || !view.canvas) {
        hudRect = null;
        return;
      }
      const cr = view.canvas.getBoundingClientRect();
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const c of chips) {
        const r = c.getBoundingClientRect();
        x0 = Math.min(x0, r.left);
        y0 = Math.min(y0, r.top);
        x1 = Math.max(x1, r.right);
        y1 = Math.max(y1, r.bottom);
      }
      hudRect = { x: x0 - cr.left - 4, y: y0 - cr.top - 4, w: x1 - x0 + 8, h: y1 - y0 + 8 };
      // tinggi HUD berubah (misalnya chip pengemudi cadangan muncul): atur ulang tampilan seluruh lintasan
      if (camera === 'semua' && Math.abs(hudRect.y + hudRect.h - fitHudBottom) > 2) view.fit(overviewBounds, OVERVIEW_PAD);
    }

    function overlays(g, layout) {
      scene.drawGauge(g, view, sim, layout.gaugeRect);
      if (layout.miniRect) scene.drawMinimap(g, view, sim, layout.miniRect);
      drawScaleBar(g, view, layout.scaleAt);
    }

    function render() {
      const now = performance.now();
      const realDt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0;
      lastFrame = now;
      placeCamera(ctx.paused ? 0 : realDt);
      const layout = overlayLayout();
      const g = view.begin(COLORS.ground);
      scene.draw(g, { view, sim, overview: camera === 'semua', labels, avoid: layout.avoid });
      labels.draw(g, view);
      overlays(g, layout);

      if (now - lastPanel > 120) {
        refreshPanels(lastPanel ? Math.min(0.5, (now - lastPanel) / 1000) : 0);
        measureHud();
        lastPanel = now;
        view.setLabel(`Lintasan uji dari atas. Mobil otonom melaju ${fmt(sim.ego.speed * 3.6, 0)} km/jam dengan lookahead ${fmtLd(st.ldEff)}, galat lintasan ${fmt(Math.abs(st.cte), 1)} m.`);
      }
    }

    setMode(false);
    placeCamera(0);

    // ---------- antarmuka ke shell ----------
    return {
      onStep(i) {
        const p = STEP_PRESETS[i];
        if (!p) return;
        if (p.adaptive != null) setMode(p.adaptive);
        if (p.ld != null) setLd(p.ld);
        if (p.targetKmh != null) setTarget(p.targetKmh);
        if (p.curveSlow != null) setCurveSlow(p.curveSlow);
        if (p.gains) setGains(p.gains);
        st.lastLap = null;
        sim.notifyTrackingChange();
        if (p.restart) restartFromStandstill();
        stepStart = st.time;
        for (const k of Object.keys(holds)) holds[k] = 0;
        refreshPanels(0);
      },
      reset() {
        sim.reset();
        clearCharts();
        stepStart = 0;
        lastTakeoverCount = 0;
        for (const k of Object.keys(holds)) holds[k] = 0;
        refreshPanels(0);
      },
      destroy() {
        // Kanvas, loop, dan listener dibersihkan otomatis oleh ctx.
      },
    };
  },
};
