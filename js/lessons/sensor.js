// Pelajaran 2: Sensor Kendaraan.
//
// Pola yang dipakai (acuan untuk pelajaran lain):
//   1. Teks pelajaran (intro, steps, summary) di objek default export.
//   2. Model dunia di file terpisah (./sensor/scene.js): membangun, memperbarui, menggambar.
//      Adegannya di Jalan Karangampel Timur, sisi utara Universitas Ma Chung, di atas peta
//      OpenStreetMap (ctx.loadMap('machung')). Perisai keselamatan ada di ./sensor/safety.js.
//   3. mount(ctx) memuat peta, lalu menyusun kanvas lewat ctx.createView, loop lewat ctx.createLoop,
//      dan panel kontrol lewat widget engine/ui.js di dalam ctx.controls.
//   4. Tugas dideteksi otomatis dari keadaan simulasi, hanya untuk langkah yang sedang aktif,
//      dan harus bertahan sebentar (hold) supaya tidak selesai karena kebetulan.
//   5. onStep(i) memasang preset langkah dan reset() mengulang skenario. destroy() tidak perlu
//      karena semuanya (termasuk kait uji window.__lessonSafety) dibersihkan lewat ctx.

import { COLORS, withAlpha } from '../engine/theme.js';
import { fmt, fmtSigned, msToKmh, angleDiff, TAU } from '../engine/math.js';
import { distanceToShape } from '../engine/geometry.js';
import { SensorRig, standardSensors, WEATHER, WEATHER_IDS } from '../engine/sensors.js';
import {
  drawWeather,
  drawSensorCone,
  drawBracketBox,
  drawRing,
  drawScaleBar,
  createLabelLayer,
  createLidarTrail,
  drawLidarRange,
  drawLidarSweep,
  lidarSweepAngle,
} from '../engine/draw.js';
import { createMapRenderer } from '../engine/osm2d.js';
import { icon } from '../engine/icons.js';
import * as ui from '../engine/ui.js';
import { createScene } from './sensor/scene.js';

const SENSOR_TYPES = ['kamera', 'lidar', 'radar', 'ultrasonik'];
const SENSOR_LABELS = { kamera: 'Kamera', lidar: 'LiDAR', radar: 'Radar', ultrasonik: 'Ultrasonik' };
const KIND_NAMES = {
  car: 'mobil',
  city: 'mobil',
  mpv: 'mobil',
  angkot: 'angkot',
  motor: 'sepeda motor',
  pedestrian: 'pejalan kaki',
  cyclist: 'pesepeda',
  trafficLight: 'lampu lalu lintas',
  sign: 'rambu',
  wall: 'tembok',
  building: 'gedung',
  tree: 'pohon',
};
// kendaraan yang bergerak (untuk tugas radar dan label kecepatan)
const VEHICLE_KINDS = new Set(['car', 'city', 'mpv', 'angkot', 'motor']);
const MOVER_KINDS = new Set([...VEHICLE_KINDS, 'cyclist', 'pedestrian']);
const COLOR_NAMES = { red: 'merah', yellow: 'kuning', green: 'hijau' };
const LIGHT_COLORS = { red: COLORS.lightRed, yellow: COLORS.lightYellow, green: COLORS.lightGreen };
const WEATHER_NOTES = {
  cerah: 'Cuaca cerah. Semua sensor bekerja dengan jangkauan penuh.',
  hujan: 'Sore hari di Malang sering hujan. Hujan memperpendek jangkauan kamera, dan sebagian pulsa LiDAR memantul dari butiran air. Radar hampir tidak terpengaruh. Jalan juga licin, jadi jarak henti semua kendaraan lebih panjang.',
  kabut: 'Kabut paling merugikan kamera dan LiDAR, keduanya hanya melihat dekat. Radar tetap melihat jauh.',
  malam: 'Malam hari kamera hanya melihat sejauh sorot lampu, kecuali benda yang bercahaya sendiri. LiDAR dan radar memancarkan sinyal sendiri, jadi tetap bekerja.',
};
const BLOCK_NOTES = {
  belakang: 'Mobil berhenti otomatis tepat sebelum angkot di belakangnya',
  depan: 'Mobil berhenti otomatis di belakang kendaraan di depannya',
  batas: 'Mobil berhenti sebelum garis henti. Di pelajaran ini mobil tidak masuk persimpangan',
  lampu: 'Mobil berhenti karena lampu merah',
  zebra: 'Mobil berhenti karena ada pejalan kaki di zebra cross',
  pejalan: 'Mobil berhenti karena ada pejalan kaki',
};

// Preset tiap langkah. Sensor yang tidak disebut dibiarkan sesuai pilihan pelajar.
// weather null = cuaca tidak diubah.
const STEP_PRESETS = [
  { sensors: { kamera: false, lidar: false, radar: false, ultrasonik: false }, weather: 'cerah' },
  { sensors: { lidar: false, radar: false, ultrasonik: false }, weather: 'cerah' },
  { sensors: { radar: false, ultrasonik: false }, weather: 'cerah' },
  { sensors: { ultrasonik: false }, weather: 'cerah' },
  { sensors: { ultrasonik: false }, weather: null, egoToStart: true },
  { sensors: { kamera: true, lidar: true, radar: true, ultrasonik: true }, weather: null },
];

// LiDAR yang tenang: tanpa garis sinar, titik memudar pelan, sapuan lambat (lihat ENGINE.md 8.4)
const LIDAR_RAYS = 360;
const LIDAR_FADE = 1.5;
const SWEEP_PERIOD = 10;

export default {
  id: 'sensor',
  title: 'Sensor Kendaraan',
  layout: 'sim',
  intro:
    '<p>Mobil otonom tidak punya mata seperti kita. Ia mengandalkan beberapa jenis sensor yang masing-masing punya kelebihan dan kelemahan. Di pelajaran ini kamu menyalakan sensor satu per satu, mengganti cuaca, lalu melihat apa yang masih bisa dideteksi.</p>' +
    '<p class="note">Lokasinya Jalan Karangampel Timur di sisi utara kampus Universitas Ma Chung. Jalan dan gedung berasal dari OpenStreetMap. Lampu lalu lintas, zebra cross, rambu, dan semua pengguna jalan ditambahkan untuk simulasi.</p>',
  steps: [
    {
      title: 'Kamera',
      body:
        '<p><span class="chip chip-kamera">Kamera</span> di balik kaca depan menangkap gambar berwarna. Sudut pandangnya lebar, sekitar 90 derajat, dan jangkauannya jauh.</p>' +
        '<p>Hanya kamera yang bisa membaca <strong>warna lampu lalu lintas</strong> dan <strong>tulisan rambu</strong>. Kamera juga bisa membedakan angkot, sepeda motor, dan pejalan kaki. Kelemahannya, kamera tunggal menebak jarak dari ukuran benda di gambar, jadi angka jaraknya kurang tepat.</p>',
      task: { id: 'kamera-lampu', text: 'Nyalakan <strong>kamera saja</strong> (sensor lain mati), lalu lihat warna lampu lalu lintas yang dibacanya.' },
    },
    {
      title: 'LiDAR',
      body:
        '<p><span class="chip chip-lidar">LiDAR</span> di atap berputar sambil menembakkan pulsa laser ke segala arah, ratusan ribu kali per detik. Waktu pantul tiap pulsa diubah menjadi jarak. Hasilnya berupa <strong>awan titik</strong> 360 derajat.</p>' +
        '<p>Jarak dari LiDAR sangat presisi, sampai hitungan sentimeter. Perhatikan bentuk gedung di tepi jalan dan angkot yang ngetem di belakang mobil. Namun LiDAR tidak melihat warna, jadi ia tidak tahu apakah lampu sedang merah atau hijau.</p>' +
        `<p class="note">Simulasi ini memakai ${LIDAR_RAYS} sinar di satu bidang datar supaya ringan. Setiap titik pantulan memudar pelan dalam sekitar ${fmt(LIDAR_FADE, 1)} detik. LiDAR sungguhan punya banyak lapisan sinar dari atas ke bawah.</p>`,
      task: { id: 'lidar-on', text: 'Nyalakan LiDAR dan amati awan titik di sekeliling mobil.' },
    },
    {
      title: 'Radar',
      body:
        '<p><span class="chip chip-radar">Radar</span> di bemper depan memancarkan gelombang radio. Jangkauannya jauh, tetapi kerucutnya sempit dan resolusinya rendah, sehingga radar tidak bisa membedakan jenis objek.</p>' +
        '<p>Keunggulannya, radar mengukur <strong>kecepatan relatif</strong> secara langsung lewat efek Doppler. Tanda minus berarti objek mendekat, tanda plus berarti menjauh. Yang terukur hanya bagian kecepatan yang searah garis pandang radar.</p>',
      task: { id: 'radar-kecepatan', text: 'Nyalakan radar, lalu baca kecepatan relatif kendaraan yang sedang bergerak, misalnya angkot atau sepeda motor dari arah berlawanan.' },
    },
    {
      title: 'Pengaruh cuaca',
      body:
        '<p>Cuaca memengaruhi tiap sensor dengan cara berbeda.</p>' +
        '<ul><li>Hujan memperpendek jangkauan kamera, dan sebagian pulsa LiDAR memantul dari butiran air. Di Malang, hujan sore cukup sering turun.</li>' +
        '<li>Kabut paling merugikan kamera dan LiDAR karena cahaya dan laser tersebar oleh titik-titik air.</li>' +
        '<li>Malam menyulitkan kamera, kecuali untuk benda yang bercahaya sendiri seperti lampu lalu lintas. LiDAR dan radar tetap bekerja karena memancarkan sinyalnya sendiri.</li></ul>' +
        '<p>Gelombang radio radar hampir tidak terganggu oleh ketiganya.</p>',
      task: { id: 'kabut-radar', text: 'Ubah cuaca ke <strong>kabut</strong> dengan kamera dan radar menyala, lalu bandingkan objek yang masih terdeteksi di tabel.' },
    },
    {
      title: 'Ultrasonik',
      body:
        '<p><span class="chip chip-ultrasonik">Ultrasonik</span> adalah sensor kecil di bemper yang memancarkan bunyi berfrekuensi tinggi lalu mengukur waktu gemanya. Jangkauannya hanya sekitar 5 m, cukup untuk parkir dan manuver pelan.</p>' +
        '<p>Mobil ini punya empat sensor di bemper depan dan empat di belakang. Ultrasonik hanya tahu jarak, tidak tahu arah pasti atau jenis benda.</p>',
      task: { id: 'ultrasonik-dekat', text: 'Nyalakan ultrasonik, lalu mundurkan mobil mendekati angkot yang ngetem di belakangnya sampai jarak ultrasonik belakang kurang dari 1 m. Pakai tombol Mundur atau tombol panah bawah.' },
    },
    {
      title: 'Kenapa perlu banyak sensor',
      body:
        '<p>Sekarang semua sensor menyala. Coba ganti cuacanya dan perhatikan tabel. Tidak ada satu sensor pun yang unggul di semua keadaan.</p>' +
        '<ul><li>Kamera mengenali jenis objek dan warna, tetapi jaraknya kurang tepat dan mudah terganggu gelap atau kabut.</li>' +
        '<li>LiDAR mengukur jarak dan bentuk dengan presisi, tetapi melemah di kabut dan tidak melihat warna.</li>' +
        '<li>Radar tahan cuaca dan langsung mengukur kecepatan, tetapi kasar dan tidak tahu jenis objek.</li>' +
        '<li>Ultrasonik murah dan andal, tetapi hanya untuk jarak dekat.</li></ul>' +
        '<p>Karena itu mobil otonom menggabungkan data semua sensornya. Proses ini disebut <strong>fusi sensor</strong> dan menjadi topik pelajaran berikutnya.</p>',
    },
  ],
  summary:
    '<p>Setiap sensor punya peran sendiri:</p>' +
    '<ul><li><span class="chip chip-kamera">Kamera</span> mengenali jenis objek, warna lampu, dan rambu. Jaraknya hanya perkiraan.</li>' +
    '<li><span class="chip chip-lidar">LiDAR</span> memberi awan titik 360 derajat dengan jarak presisi, tetapi melemah di kabut dan hujan.</li>' +
    '<li><span class="chip chip-radar">Radar</span> melihat jauh dan mengukur kecepatan relatif, tahan cuaca, tetapi resolusinya rendah.</li>' +
    '<li><span class="chip chip-ultrasonik">Ultrasonik</span> mengukur jarak dekat untuk parkir.</li></ul>' +
    '<p class="note">Jangkauan di simulasi ini dipendekkan agar muat di layar. Di dunia nyata kamera, LiDAR, dan radar mobil bisa melihat sampai ratusan meter.</p>',

  // Gaya khusus pelajaran ini, selalu diawali .lesson-sensor supaya tidak bocor ke halaman lain.
  styles: `
    .lesson-sensor .grp-table { grid-column: span 2; }
    .lesson-sensor .tick { display: inline-grid; place-items: center; width: 24px; height: 24px; border-radius: 7px;
      background: color-mix(in srgb, var(--c) 18%, transparent); color: var(--c); }
    .lesson-sensor .nope { color: var(--muted); opacity: .55; }
    .lesson-sensor .th-sensor, .lesson-sensor .dot-label { display: inline-flex; align-items: center; gap: 6px; }
    .lesson-sensor .th-sensor::before, .lesson-sensor .dot-label::before { content: ''; flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--c); }
    .lesson-sensor .table-legend { display: none; }
    .lesson-sensor .th-sensor.is-off { opacity: .45; }
    .lesson-sensor .pick { min-height: 40px; min-width: 40px; padding: 0; border: 0; background: none; color: var(--text); font-weight: 600;
      text-align: left; cursor: pointer; }
    .lesson-sensor .pick:hover { color: var(--accent); }
    .lesson-sensor .row-range > * { background: var(--bg); color: var(--muted); font-size: .78rem; font-weight: 600; }
    .lesson-sensor .inspector td, .lesson-sensor .inspector th { white-space: normal; }
    .lesson-sensor .insp-title { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
    .lesson-sensor .insp-name { font-weight: 700; }
    .lesson-sensor .insp-kind { color: var(--muted); font-size: .82rem; }
    .lesson-sensor .res-ok { color: var(--text); }
    .lesson-sensor .res-no { color: var(--muted); }
    .lesson-sensor .drive-row .btn { flex: 1 1 0; min-height: 48px; }
    @media (max-width: 900px) {
      .lesson-sensor .grp-table { grid-column: auto; }
    }
    @media (max-width: 600px) {
      .lesson-sensor .grid-table th, .lesson-sensor .grid-table td { padding: 2px 4px; white-space: normal; }
      .lesson-sensor .grid-table tbody th, .lesson-sensor .grid-table thead th:first-child { padding-left: 10px; }
      .lesson-sensor .th-name { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
      .lesson-sensor .th-sensor::before { width: 12px; height: 12px; }
      .lesson-sensor .table-legend { display: flex; }
      .lesson-sensor .row-range td { white-space: nowrap; font-size: .72rem; }
    }
  `,

  async mount(ctx) {
    // ---------- peta dan model ----------
    const map = await ctx.loadMap('machung');
    if (ctx.signal.aborted) return {};
    const scene = createScene(map);
    const ego = scene.ego;
    const rig = new SensorRig(ego, standardSensors(ego, { lidar: { rays: LIDAR_RAYS } }), { seed: 42 });
    const trail = createLidarTrail({ fade: LIDAR_FADE });
    // titik gangguan dari butiran air (hujan, kabut) digambar terpisah dan lebih redup, supaya
    // tampak sebagai kabut halus, tidak berkelip di sekitar mobil
    const clutterTrail = createLidarTrail({ fade: LIDAR_FADE, max: 1500 });
    let weather = 'cerah';
    let selectedId = null;
    const holds = {}; // lama (detik) syarat tugas terpenuhi berturut-turut

    // ---------- kanvas dan loop ----------
    const labels = createLabelLayer();
    // nama jalan digambar sendiri (lihat render) supaya tidak menimpa zebra cross
    const mapRenderer = createMapRenderer(map, { layers: { labels: false } });
    const view = ctx.createView({
      label: `Peta ${scene.streetName} di sisi utara Universitas Ma Chung dari atas: mobil otonom berwarna hijau toska, angkot, sepeda motor, pejalan kaki, dan persimpangan dengan lampu lalu lintas simulasi.`,
      background: COLORS.ground,
      bounds: (v) => scene.viewBounds(v.aspect < 1.4),
      padding: 10,
    });

    const loop = ctx.createLoop({
      update(dt) {
        scene.update(dt, loop.time);
        rig.update(dt, scene.objects, weather);
        if (on('lidar')) addLidarScan(rig.reading('lidar'));
      },
      render,
    });

    // ---------- panel kontrol ----------
    const sensorGroup = ui.group(ctx.controls, { title: 'Sensor' });
    const toggles = {};
    for (const type of SENSOR_TYPES) {
      toggles[type] = ui.toggle(sensorGroup, {
        label: SENSOR_LABELS[type],
        color: COLORS[type],
        onChange: (value) => setSensor(type, value),
      });
    }

    const weatherGroup = ui.group(ctx.controls, { title: 'Cuaca' });
    const weatherCtl = ui.segmented(weatherGroup, {
      ariaLabel: 'Kondisi cuaca',
      options: WEATHER_IDS.map((id) => ({ value: id, label: WEATHER[id].label })),
      value: weather,
      onChange: (w) => setWeather(w),
    });
    const weatherNote = ui.note(weatherGroup, WEATHER_NOTES.cerah);

    const driveGroup = ui.group(ctx.controls, { title: 'Gerak mobil' });
    const driveRow = ui.buttonRow(driveGroup, { className: 'drive-row' });
    const fwdBtn = ui.holdButton(driveRow, { label: 'Maju', icon: 'arrowUp', onChange: (value) => (scene.drive.forward = value) });
    const backBtn = ui.holdButton(driveRow, { label: 'Mundur', icon: 'arrowDown', onChange: (value) => (scene.drive.back = value) });
    driveGroup.append(
      ui.el('p', {
        class: 'ctl-hint',
        html: 'Tahan tombolnya, atau pakai <kbd>↑</kbd> dan <kbd>↓</kbd> di keyboard. Jarak depan dan belakang diukur oleh ultrasonik. Mobil berhenti sendiri sebelum menabrak dan tidak masuk persimpangan.',
      }),
    );
    const readouts = ui.readoutGrid(driveGroup);
    const speedOut = ui.readout(readouts, { label: 'Kecepatan', value: '0 km/jam' });
    const usFrontOut = ui.readout(readouts, { label: 'Jarak depan', value: 'mati' });
    const usRearOut = ui.readout(readouts, { label: 'Jarak belakang', value: 'mati' });

    const tableGroup = ui.group(ctx.controls, { title: 'Apa yang dideteksi tiap sensor', className: 'grp-table' });
    const table = ui.dataTable(tableGroup, {
      caption: 'Objek yang dideteksi tiap sensor',
      columns: [
        { key: 'name', label: 'Objek' },
        ...SENSOR_TYPES.map((t) => ({
          key: t,
          html: `<span class="th-sensor" data-th="${t}" style="--c: var(--${t})"><span class="th-name">${SENSOR_LABELS[t]}</span></span>`,
          align: 'center',
        })),
      ],
    });
    table.table.classList.add('grid-table');
    // di layar sempit judul kolom hanya berupa titik warna, jadi tampilkan legendanya
    ui.legend(tableGroup, SENSOR_TYPES.map((t) => ({ color: COLORS[t], label: SENSOR_LABELS[t] }))).classList.add('table-legend');
    table.el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pick]');
      if (b) select(b.dataset.pick);
    });

    const inspGroup = ui.group(ctx.controls, { title: 'Inspektor objek' });
    const inspTitle = ui.el('div', { class: 'insp-title' });
    inspGroup.append(inspTitle);
    const inspTable = ui.dataTable(inspGroup, {
      caption: 'Hasil tiap sensor untuk objek terpilih',
      columns: [
        { key: 's', label: 'Sensor' },
        { key: 'r', label: 'Hasil', rowHeader: false },
      ],
      empty: 'Klik atau ketuk objek di simulasi, atau pilih nama objek di tabel.',
    });
    inspTable.table.classList.add('inspector');

    // HUD di atas kanvas
    const weatherChip = ui.hudChip(ctx.hud, { label: 'Cuaca', color: COLORS.accent });
    const lightChip = ui.hudChip(ctx.hud, { label: 'Lampu terbaca', color: COLORS.kamera });
    const rearChip = ui.hudChip(ctx.hud, { label: 'Ultrasonik belakang', color: COLORS.ultrasonik });

    // keyboard (dilepas otomatis saat pelajaran ditutup)
    ctx.keys({
      ArrowUp: { down: () => fwdBtn.setActive(true), up: () => fwdBtn.setActive(false) },
      ArrowDown: { down: () => backBtn.setActive(true), up: () => backBtn.setActive(false) },
    });

    // klik atau ketuk objek di kanvas
    view.onPointer({
      tap(e) {
        const hit = pick(e.x, e.y, e.hitRadius);
        select(hit ? hit.id : null);
      },
      move(e) {
        view.setCursor(pick(e.x, e.y, e.hitRadius) ? 'pointer' : 'default');
      },
    });

    // kait uji (baca saja): penghitung invarian keselamatan, dihapus saat pelajaran ditutup
    const hook = { lesson: 'sensor', snapshot: () => ({ ...scene.safety.snapshot(), weather, friction: scene.friction, time: loop.time }), scene, rig, trail, view };
    for (const k of ['redRuns', 'pedContacts', 'otherCollisions', 'clamps']) Object.defineProperty(hook, k, { get: () => scene.safety[k], enumerable: true });
    window.__lessonSafety = hook;
    ctx.onCleanup(() => {
      if (window.__lessonSafety === hook) delete window.__lessonSafety;
    });

    // ---------- aksi ----------
    /** Masukkan pindaian LiDAR baru ke jejak (sekali per pindaian). */
    function addLidarScan(reading) {
      if (trail.addReading(reading, loop.time, { skipClutter: true })) clutterTrail.add(reading.points.filter((p) => p.clutter), loop.time);
    }

    function clearLidar() {
      trail.clear();
      clutterTrail.clear();
    }

    function rescanIfPaused() {
      if (!ctx.paused) return;
      rig.scanNow(scene.objects, weather);
      // saat dijeda waktu tidak maju, jadi pindaian baru menggantikan jejak lama
      clearLidar();
      if (on('lidar')) addLidarScan(rig.reading('lidar'));
    }

    function setSensor(type, value) {
      rig.setEnabled(type, value);
      toggles[type].set(value);
      if (type === 'lidar' && !value) clearLidar();
      rescanIfPaused();
    }

    function setWeather(w) {
      weather = w;
      scene.setWeather(w);
      weatherCtl.set(w);
      weatherNote.querySelector('div').textContent = WEATHER_NOTES[w];
      rescanIfPaused();
    }

    function pick(x, y, radius) {
      let best = null;
      let bestD = Infinity;
      for (const o of scene.tracked) {
        if (o.active === false) continue;
        const d = distanceToShape(x, y, o);
        if (d <= radius + 0.6 && d < bestD) {
          best = o;
          bestD = d;
        }
      }
      return best;
    }

    function select(id) {
      selectedId = id;
      refreshPanels(0);
    }

    // ---------- membaca hasil sensor ----------
    const on = (type) => rig.isEnabled(type);
    const detOf = (type, id) => rig.detections(type).filter((d) => d.targetId === id);
    const cameraLight = () => rig.detections('kamera').find((d) => d.kind === 'trafficLight' && d.color);
    const nearestUs = (group) => {
      let best = null;
      for (const d of rig.detections(group)) if (!best || d.range < best.range) best = d;
      return best;
    };

    function describe(type, obj) {
      if (!on(type)) return { ok: false, text: 'Sensor mati' };
      const dets = obj.active === false ? [] : detOf(type, obj.id);
      if (dets.length) {
        const d = dets.reduce((a, b) => (b.range < a.range ? b : a));
        if (type === 'kamera') {
          let t = `Terlihat sebagai ${KIND_NAMES[d.kind] || 'objek'}, jarak kira-kira ${fmt(d.range, 0)} m`;
          if (d.kind === 'trafficLight') t += d.color ? `, lampu ${COLOR_NAMES[d.color]}` : ', warna tidak terbaca';
          if (d.text) t += `, tulisan "${d.text}"`;
          return { ok: true, text: t };
        }
        if (type === 'lidar') return { ok: true, text: `${fmt(d.points)} titik, jarak ${fmt(d.range, 2)} m` };
        if (type === 'radar') {
          const kmh = msToKmh(d.relSpeed);
          const dir = Math.abs(kmh) < 1 ? 'tidak mendekat atau menjauh' : kmh < 0 ? 'mendekat' : 'menjauh';
          return { ok: true, text: `Jarak ${fmt(d.range, 1)} m, kecepatan relatif ${fmtSigned(kmh, 0, 'km/jam')} (${dir})` };
        }
        return { ok: true, text: `Jarak ${fmt(d.range, 2)} m` };
      }
      if (obj.active === false) return { ok: false, text: 'Sedang di luar peta' };
      // jelaskan kenapa tidak terdeteksi
      const sensors = rig.select(type);
      if (type === 'ultrasonik') {
        const nearest = Math.min(
          ...sensors.map((s) => {
            const p = s.pose(ego);
            return distanceToShape(p.x, p.y, obj);
          }),
        );
        return { ok: false, text: nearest > sensors[0].effectiveRange(weather) ? `Di luar jangkauan ${fmt(sensors[0].effectiveRange(weather), 0)} m` : 'Tidak di depan sensor' };
      }
      const s = sensors[0];
      const pose = s.pose(ego);
      const range = s.effectiveRange(weather, obj);
      if (distanceToShape(pose.x, pose.y, obj) > range) return { ok: false, text: `Di luar jangkauan ${fmt(range, 0)} m` };
      const rel = angleDiff(Math.atan2(obj.y - pose.y, obj.x - pose.x), pose.heading);
      if (s.fov < TAU && Math.abs(rel) > s.fov / 2) return { ok: false, text: 'Di luar sudut pandang' };
      if (type === 'lidar') return { ok: false, text: 'Tidak ada pulsa yang kembali' };
      return { ok: false, text: 'Terhalang objek lain' };
    }

    // ---------- pembaruan panel (dipanggil dari render, sekitar 8 kali per detik) ----------
    let lastPanel = 0;
    function refreshPanels(realDt) {
      // tabel deteksi
      const rows = [
        {
          _class: 'row-range',
          name: 'Jangkauan saat ini',
          ...Object.fromEntries(SENSOR_TYPES.map((t) => [t, on(t) ? fmt(rig.select(t)[0].effectiveRange(weather), 0, 'm') : 'mati'])),
        },
      ];
      for (const o of scene.tracked) {
        const row = { _class: o.id === selectedId ? 'is-selected' : '', name: { html: `<button type="button" class="pick" data-pick="${o.id}">${o.label}</button>` } };
        for (const t of SENSOR_TYPES) {
          const seen = on(t) && o.active !== false && detOf(t, o.id).length > 0;
          row[t] = seen
            ? { html: `<span class="tick" style="--c: var(--${t})">${icon('check')}<span class="visually-hidden">terdeteksi</span></span>` }
            : { html: `<span class="nope" aria-label="${on(t) ? 'tidak terdeteksi' : 'sensor mati'}">·</span>` };
        }
        rows.push(row);
      }
      table.setRows(rows);
      for (const t of SENSOR_TYPES) tableGroup.querySelector(`[data-th="${t}"]`)?.classList.toggle('is-off', !on(t));

      // hint jangkauan di sakelar
      for (const t of SENSOR_TYPES) {
        const r = rig.select(t)[0].effectiveRange(weather);
        toggles[t].setHint(t === 'ultrasonik' ? `Jangkauan ${fmt(r, 0)} m, 8 sensor` : `Jangkauan ${fmt(r, 0)} m`);
      }

      // inspektor
      const sel = scene.tracked.find((o) => o.id === selectedId);
      if (sel) {
        inspTitle.replaceChildren(ui.el('span', { class: 'insp-name', text: sel.label }), ui.el('span', { class: 'insp-kind', text: KIND_NAMES[sel.kind] || '' }));
        inspTable.setRows(
          SENSOR_TYPES.map((t) => {
            const r = describe(t, sel);
            return {
              s: { html: `<span class="dot-label" style="--c: var(--${t})">${SENSOR_LABELS[t]}</span>` },
              r: { html: `<span class="${r.ok ? 'res-ok' : 'res-no'}">${escapeHtml(r.text)}</span>` },
            };
          }),
        );
      } else {
        inspTitle.textContent = '';
        inspTable.setRows([]);
      }

      // readout dan HUD
      const v = ego.speed;
      speedOut.set(Math.abs(v) < 0.05 ? '0 km/jam' : `${fmt(msToKmh(Math.abs(v)), 0, 'km/jam')} ${v > 0 ? 'maju' : 'mundur'}`);
      const front = nearestUs('depan');
      const rear = nearestUs('belakang');
      usFrontOut.set(!on('ultrasonik') ? 'mati' : front ? fmt(front.range, 2, 'm') : 'tidak ada');
      usRearOut.set(!on('ultrasonik') ? 'mati' : rear ? fmt(rear.range, 2, 'm') : 'tidak ada');
      usFrontOut.setTone(on('ultrasonik') ? '' : 'off');
      usRearOut.setTone(!on('ultrasonik') ? 'off' : rear && rear.range < 1 ? 'warn' : '');
      weatherChip.set(WEATHER[weather].label);
      const cl = on('kamera') ? cameraLight() : null;
      lightChip.show(!!cl);
      if (cl) {
        lightChip.set(COLOR_NAMES[cl.color]);
        lightChip.el.style.setProperty('--tone', LIGHT_COLORS[cl.color]);
      }
      rearChip.show(on('ultrasonik'));
      rearChip.set(rear ? fmt(rear.range, 2, 'm') : 'bebas');
      rearChip.setTone(rear && rear.range < 1 ? 'warn' : '');

      checkTasks(realDt);
      updateStatus();
    }

    // ---------- deteksi tugas ----------
    const TASK_CHECKS = {
      'kamera-lampu': { hold: 0.5, test: () => on('kamera') && !on('lidar') && !on('radar') && !on('ultrasonik') && !!cameraLight() },
      'lidar-on': { hold: 0.4, test: () => on('lidar') && (rig.reading('lidar')?.points.length ?? 0) >= 100 },
      'radar-kecepatan': {
        hold: 1,
        test: () => on('radar') && rig.detections('radar').some((d) => VEHICLE_KINDS.has(d.target?.kind) && d.target.speed > 1 && Math.abs(d.relSpeed) > 1),
      },
      'kabut-radar': { hold: 1.2, test: () => weather === 'kabut' && on('kamera') && on('radar') },
      'ultrasonik-dekat': {
        hold: 0.2,
        test: () => {
          const rear = nearestUs('belakang');
          return on('ultrasonik') && !!rear && rear.targetId === 'angkot-ngetem' && rear.range < 1;
        },
      },
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

    // ---------- baris status (teks untuk pembaca layar dan keterangan singkat) ----------
    function updateStatus() {
      const parts = [];
      if (scene.state.blocked) parts.push(BLOCK_NOTES[scene.state.blocked]);
      const tracked = (t) => rig.detections(t).filter((d) => scene.tracked.some((o) => o.id === d.targetId));
      if (on('kamera')) {
        const cl = cameraLight();
        parts.push(`Kamera melihat ${tracked('kamera').length} objek${cl ? `, lampu ${COLOR_NAMES[cl.color]}` : ''}`);
      }
      if (on('lidar')) parts.push(`LiDAR ${fmt(rig.reading('lidar')?.points.length ?? 0)} titik`);
      if (on('radar')) parts.push(`radar ${tracked('radar').length} objek`);
      if (on('ultrasonik')) {
        const rear = nearestUs('belakang');
        parts.push(`ultrasonik belakang ${rear ? fmt(rear.range, 1, 'm') : 'bebas'}`);
      }
      if (!SENSOR_TYPES.some(on)) parts.push('Semua sensor mati. Nyalakan sensor di panel Sensor');
      parts.push(`Cuaca ${WEATHER[weather].label.toLowerCase()}`);
      ctx.setStatus(`${parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('. ')}.`);
    }

    // ---------- menggambar ----------
    function render() {
      const g = view.begin(COLORS.ground);
      mapRenderer.draw(g, view, { attribution: false }); // jalan dan gedung asli dari OpenStreetMap
      scene.draw(g, { view, night: weather === 'malam' });
      drawWeather(g, view, weather, loop.time, { lights: weather === 'malam' ? scene.nightLights() : [] });
      drawSensors(g);
      drawSelection(g);
      // semua lampu lalu lintas di adegan ini simulasi
      for (const t of scene.signalTags(view)) {
        labels.add(t.x, t.y, 'simulasi', { size: 10, color: '#fde68a', bg: 'rgba(11, 18, 32, 0.8)', priority: 5, maxNudge: 1 });
      }
      if (scene.campusLabel) {
        labels.add(scene.campusLabel.x, scene.campusLabel.y, scene.campusLabel.name, { color: 'rgba(94, 234, 212, 0.85)', size: 11, dy: 0, priority: -1, optional: true });
      }
      labels.add(scene.streetLabel.x, scene.streetLabel.y, scene.streetName, { color: '#cbd5e1', size: 11, dy: 0, priority: -2, optional: true });
      labels.draw(g, view); // semua label sekaligus, tanpa saling menimpa
      drawScaleBar(g, view);
      mapRenderer.drawAttribution(g, view); // "© Kontributor OpenStreetMap", selalu paling akhir

      const now = performance.now();
      if (now - lastPanel > 120) {
        refreshPanels(lastPanel ? Math.min(0.5, (now - lastPanel) / 1000) : 0);
        lastPanel = now;
      }
    }

    function drawSensors(g) {
      const trackedIds = new Set(scene.tracked.map((o) => o.id));
      const narrow = view.width < 560;

      if (on('ultrasonik')) {
        for (const s of rig.select('ultrasonik')) {
          const p = s.pose(ego);
          const reading = rig.reading(s.id);
          const d = reading?.detections[0];
          drawSensorCone(g, p, p.heading, s.fov, s.effectiveRange(weather), COLORS.ultrasonik, { view, fillAlpha: d ? 0.14 : 0.05, strokeAlpha: d ? 0.5 : 0.18, width: 1 });
          if (d) {
            g.save();
            g.strokeStyle = COLORS.ultrasonik;
            g.lineWidth = view.px(2.5);
            g.beginPath();
            g.arc(p.x, p.y, d.range, p.heading - s.fov / 2, p.heading + s.fov / 2);
            g.stroke();
            g.restore();
          }
        }
        const rear = nearestUs('belakang');
        if (rear) {
          const r = ego.rear();
          // di layar sempit label diletakkan di atas mobil supaya angkot di belakangnya tetap terlihat
          const at = narrow ? { dx: 0, dy: -22 } : { dx: -34, dy: 0 };
          labels.add(r.x, r.y, fmt(rear.range, 2, 'm'), { color: COLORS.ultrasonik, ...at, mono: true, priority: 4 });
        }
      }

      if (on('radar')) {
        const s = rig.select('radar')[0];
        const p = s.pose(ego);
        drawSensorCone(g, p, p.heading, s.fov, s.effectiveRange(weather), COLORS.radar, { view, fillAlpha: 0.1 });
      }

      if (on('kamera')) {
        const s = rig.select('kamera')[0];
        const p = s.pose(ego);
        drawSensorCone(g, p, p.heading, s.fov, s.effectiveRange(weather), COLORS.kamera, { view, fillAlpha: 0.08 });
      }

      if (on('lidar')) {
        // tanpa garis sinar: cakupan diam, sapuan lembut yang sangat pelan, dan titik yang memudar
        const s = rig.select('lidar')[0];
        const p = s.pose(ego);
        const range = s.effectiveRange(weather);
        drawLidarRange(g, p, range, COLORS.lidar, { view });
        if (!ctx.reducedMotion) drawLidarSweep(g, p, lidarSweepAngle(loop.time, { period: SWEEP_PERIOD }), range, COLORS.lidar, { alpha: 0.1 });
        clutterTrail.draw(g, loop.time, COLORS.lidar, { view, size: 1.6, alpha: 0.28, halo: 0, spacing: 2.2 });
        trail.draw(g, loop.time, COLORS.lidar, { view, size: 2.6, alpha: 0.8, halo: 0.5, spacing: 1.5 });
      }

      if (on('radar')) {
        for (const d of rig.detections('radar')) {
          drawRing(g, d.x, d.y, view.px(5), { color: COLORS.radar, width: 2, view, fill: withAlpha(COLORS.radar, 0.35) });
          if (trackedIds.has(d.targetId) && (narrow ? VEHICLE_KINDS : MOVER_KINDS).has(d.target?.kind)) {
            labels.add(d.x, d.y, fmtSigned(msToKmh(d.relSpeed), 0, 'km/jam'), { color: COLORS.radar, dy: 22, mono: true, size: 11, priority: VEHICLE_KINDS.has(d.target.kind) ? 2 : 0, optional: true });
          }
        }
      }

      if (on('kamera')) {
        for (const d of rig.detections('kamera')) {
          if (!trackedIds.has(d.targetId)) continue;
          drawBracketBox(g, d.target, COLORS.kamera, { view, pad: 0.4 });
          let text = KIND_NAMES[d.kind] || 'objek';
          if (d.kind === 'trafficLight') text = d.color ? `lampu ${COLOR_NAMES[d.color]}` : 'lampu (warna tidak terbaca)';
          if (d.kind === 'sign') text = `rambu ${d.text}`;
          // di layar sempit label yang tidak kebagian tempat dilewati (lampu dan rambu diutamakan)
          const prio = d.kind === 'trafficLight' ? 4 : d.kind === 'sign' ? 1 : 3;
          labels.add(d.target.x, d.target.y, text, { color: COLORS.kamera, dy: -24, size: 11, priority: prio, optional: narrow && d.kind !== 'trafficLight' });
        }
      }
    }

    function drawSelection(g) {
      const sel = scene.tracked.find((o) => o.id === selectedId);
      if (!sel || sel.active === false) return;
      const r = sel.radius != null ? sel.radius + 1.2 : Math.hypot(sel.length, sel.width) / 2 + 0.8;
      const ringR = Math.max(r, view.px(16));
      drawRing(g, sel.x, sel.y, ringR, { color: COLORS.accent, width: 2, view, dash: [5, 4] });
      labels.add(sel.x, sel.y + ringR, sel.label, { color: COLORS.accent, dy: 14, size: 11, priority: 6 });
    }

    function escapeHtml(s) {
      return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    }

    // ---------- antarmuka ke shell ----------
    return {
      onStep(i) {
        const preset = STEP_PRESETS[i];
        if (!preset) return;
        for (const [type, value] of Object.entries(preset.sensors)) setSensor(type, value);
        if (preset.weather) setWeather(preset.weather);
        if (preset.egoToStart && scene.rearGap() < 3) scene.egoToStart();
        for (const k of Object.keys(holds)) holds[k] = 0;
        refreshPanels(0);
      },
      reset() {
        scene.reset();
        rig.clear();
        clearLidar();
        for (const k of Object.keys(holds)) holds[k] = 0;
        refreshPanels(0);
      },
    };
  },
};
