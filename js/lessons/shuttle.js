// Pelajaran 9: Misi Shuttle Otonom.
//
// Pelajaran "kotak pasir" yang menyatukan semua materi, di jalan asli sekitar Universitas Ma Chung
// (OpenStreetMap). SHUTTLE 01 melayani lima halte yang sama dengan Shuttle 3D Ma Chung, menjemput dan
// mengantar penumpang, berbagi jalan dengan sepeda motor, mobil, angkot, dan pejalan kaki, berhenti di
// lampu lalu lintas simulasi, dan menghitung ulang rute saat jalan ditutup.
//
// Susunan file:
//   ./shuttle/network.js  jaringan jalan dari data kota Shuttle 3D, peta 2D, penutupan jalan, rute A*
//   ./shuttle/signals.js  lampu lalu lintas simulasi (waktu sama dengan Shuttle 3D)
//   ./shuttle/traffic.js  pengemudi semua kendaraan, izin persimpangan, perisai keselamatan
//   ./shuttle/peds.js     pejalan kaki, penerimaan celah, pejalan kaki uji
//   ./shuttle/world.js    misi shuttle: halte, penumpang, statistik, pemantau aturan keras, sensor
//   ./shuttle/render.js   gambar di atas peta, LiDAR yang tenang
// File ini berisi teks pelajaran, panel kontrol, deteksi tugas, dan penghubung ke shell.

import { COLORS } from '../engine/theme.js';
import { fmt, msToKmh, radToDeg, clamp } from '../engine/math.js';
import { drawScaleBar, createLabelLayer } from '../engine/draw.js';
import { drawAttribution } from '../engine/osm2d.js';
import { purePursuit } from '../engine/control.js';
import { Path } from '../engine/geometry.js';
import * as ui from '../engine/ui.js';
import { loadNetworkData, buildNetwork } from './shuttle/network.js';
import { createWorld, CAPACITY, RAIN_FACTOR, EMERGENCY_DECEL, MAX_CLOSED } from './shuttle/world.js';
import { createRenderer } from './shuttle/render.js';
import { TYPE_LABEL } from './shuttle/traffic.js';

const RAIN_COLOR = '#60a5fa';

// Preset tiap langkah. weather null = cuaca tidak diubah.
const STEP_PRESETS = [
  { weather: 'cerah', tool: 'tutup' },
  { weather: 'cerah', tool: 'tutup', openRoads: true },
  { weather: 'cerah', tool: 'tutup', leader: true },
  { weather: null, tool: 'halte' },
  { weather: null, tool: 'tutup', loopReset: true },
];

const LAYERS = [
  { id: 'sensor', label: 'Sensor', color: 'var(--kamera)' },
  { id: 'persepsi', label: 'Persepsi', color: 'var(--lidar)' },
  { id: 'lokalisasi', label: 'Lokalisasi', color: 'var(--lidar)' },
  { id: 'rute', label: 'Rute', color: 'var(--radar)' },
  { id: 'keputusan', label: 'Keputusan', color: 'var(--radar)' },
  { id: 'kendali', label: 'Kendali', color: 'var(--ultrasonik)' },
];

const COLOR_WORDS = { red: 'merah', yellow: 'kuning', green: 'hijau' };
const DOOR_WORDS = { buka: 'pintu dibuka', turun: 'penumpang turun', naik: 'penumpang naik', tutup: 'pintu ditutup' };
const SHIELD_WORDS = {
  merah: 'lampu merah di depan',
  kuning: 'lampu kuning yang wajib dipatuhi',
  zebra: 'zebra cross sedang dipakai',
  pejalan: 'ada pejalan kaki di jalur shuttle',
  'pejalan-arah': 'pejalan kaki akan masuk ke jalur shuttle',
};
const PED_WAIT = {
  halte: 'shuttle sedang berhenti di halte',
  simpang: 'di depan shuttle ada persimpangan atau bundaran',
  rute: 'rute di depan shuttle belum cukup panjang',
  zebra: 'titik itu terlalu dekat dengan zebra cross',
  badan: 'ada kendaraan di titik itu',
  dekat: 'ada kendaraan lain yang belum sempat berhenti',
};

const kmh = (ms, d = 0) => fmt(msToKmh(ms), d, 'km/jam');
const meters = (m) => fmt(Math.max(0, m), 0, 'm');
const seconds = (s) => fmt(Math.max(0, Math.floor(s)), 0, 'detik');
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

export default {
  id: 'shuttle',
  title: 'Misi Shuttle Otonom',
  layout: 'sim',
  intro:
    '<p>Di pelajaran ini semua materi sebelumnya bekerja bersama di jalan asli sekitar Universitas Ma Chung, Malang. Shuttle otonom <strong>SHUTTLE 01</strong> menjemput penumpang di lima halte, lalu mengantar mereka ke halte tujuan, di antara sepeda motor, mobil, angkot, dan pejalan kaki.</p>' +
    '<p>Panel <strong>Lapisan otak shuttle</strong> di bawah simulasi menunjukkan apa yang sedang dikerjakan tiap lapisan sistemnya, dari sensor sampai kendali.</p>',
  steps: [
    {
      title: 'Halte pertama',
      body:
        '<p>SHUTTLE 01 melayani lima halte yang sama dengan Shuttle 3D Ma Chung, berurutan: Gerbang Ma Chung, Jalan Karangampel Timur, Jalan Puncak Tidar, Villa Puncak Lawu, dan Jalan Raya Candi V. Satu putaran panjangnya sekitar 3,1 km. Shuttle memuat paling banyak 12 penumpang. Warna titik penumpang di halte menunjukkan halte tujuannya.</p>' +
        '<p>Rute antarhalte dicari dengan <strong>A*</strong>. Setiap lajur dan setiap gerakan di persimpangan (lurus, belok kiri, belok kanan) menjadi node di graf. Biayanya perkiraan waktu tempuh, ditambah penalti kecil untuk belok dan simpang berlampu. Heuristiknya jarak garis lurus dibagi kecepatan tertinggi, jadi tidak pernah melebihi biaya sebenarnya. Shuttle sepanjang 6 m ini tidak putar balik, jadi gerakan putar balik tidak dipakai. <span class="chip chip-accent">Garis hijau toska</span> adalah rute yang sedang dipakai.</p>' +
        '<p>Di halte, shuttle berhenti di lajur kiri dan membuka pintu di sisi kiri, yaitu sisi trotoar. Penumpang yang sudah sampai turun dulu, baru penumpang baru naik.</p>',
      task: { id: 'first-stop', text: 'Perhatikan shuttle sampai di halte Gerbang Ma Chung, membuka pintu, lalu menaikkan penumpang.' },
    },
    {
      title: 'Jalan ditutup',
      body:
        '<p>Jalan bisa ditutup, misalnya karena ada perbaikan atau acara warga. Lajur di jalan yang ditutup dikeluarkan dari graf, lalu shuttle menghitung ulang rute dengan A*.</p>' +
        '<p>Pencarian ulang dimulai dari bagian rute yang sudah pasti: lajur tempat shuttle berada, persimpangan yang sudah diizinkan untuknya, dan jalan yang terlalu dekat untuk berhenti.</p>' +
        '<p>Pilih <strong>Tutup jalan</strong> di panel Peta, lalu klik atau ketuk jalan yang dilewati garis rute. Tampilan <strong>Seluruh rute</strong> memperlihatkan semua jalan di putaran. Ketuk sekali lagi untuk membukanya. Tombol <strong>Tutup jalan di depan</strong> menutup jalan pertama di rute shuttle. Setelah rute dihitung ulang, rute lama tampil sebentar sebagai garis merah putus-putus.</p>' +
        '<p class="note">Paling banyak dua jalan bisa ditutup sekaligus. Penutupan yang membuat shuttle tidak bisa menyelesaikan putarannya ditolak, karena shuttle tidak putar balik. Kendaraan yang sudah berada di jalan itu tetap boleh keluar.</p>',
      task: { id: 'closure', text: 'Tutup satu jalan yang dilewati rute shuttle, lalu lihat rutenya dihitung ulang.' },
    },
    {
      title: 'Hujan',
      body:
        '<p>Hujan membuat jalan basah. Koefisien gesek ban μ turun dari sekitar 0,8 menjadi sekitar 0,5, jadi jarak pengereman lebih panjang. Butiran air juga memperpendek jangkauan sensor. Di simulasi ini jangkauan LiDAR turun dari 45 m menjadi 36 m (jangkauan sengaja dipendekkan supaya muat di layar).</p>' +
        '<p>Karena itu shuttle melaju paling cepat 70% dari batas yang kamu pilih, misalnya 21 km/jam kalau batasnya 30 km/jam. Jarak waktunya ke kendaraan di depan naik dari 1,5 detik menjadi 3 detik, dan jarak minimum saat berhenti naik dari 3 m menjadi 5 m.</p>' +
        '<div class="formula">jarak aman ≈ jarak minimum + v × jarak waktu</div>' +
        '<p>Ada angkot yang berjalan pelan di depan shuttle. Bandingkan angka <strong>Jarak ke depan</strong> di HUD sebelum dan sesudah hujan.</p>' +
        '<p class="note">Percepatan shuttle dihitung dengan Intelligent Driver Model (IDM), model pengikut kendaraan yang banyak dipakai di simulasi lalu lintas. Rumus di atas adalah jarak yang dituju IDM saat melaju stabil.</p>',
      task: { id: 'rain', text: 'Nyalakan <strong>Hujan</strong>, lalu perhatikan shuttle melambat dan menjaga jarak lebih jauh dari kendaraan di depannya.' },
    },
    {
      title: 'Antar penumpang',
      body:
        '<p>Penumpang datang ke halte secara acak. Waktu tunggu setiap penumpang dihitung sejak ia tiba di halte sampai naik ke shuttle. Rata-ratanya tampil di panel Statistik misi.</p>' +
        '<p>Halte yang tidak punya penumpang untuk naik atau turun dilewati saja supaya waktu tidak terbuang. Kalau shuttle penuh, penumpang di halte menunggu putaran berikutnya.</p>' +
        '<p>Kamu bisa memilih halte yang dilayani. Pakai alat <strong>Pilih halte</strong>, lalu klik atau ketuk rambu halte (atau namanya) di peta. Bisa juga lewat sakelar di panel Halte. Calon penumpang di halte itu dan yang menuju ke sana membatalkan perjalanan. Penumpang yang sudah di dalam shuttle tetap diantar.</p>' +
        '<p class="note">Satu putaran di jalan asli cukup panjang. Pakai <strong>Percepatan waktu</strong> 4 atau 8 kali. Simulasi tetap memakai langkah fisika yang sama, hanya dijalankan lebih sering.</p>',
      task: { id: 'deliver-10', text: 'Antar total 10 penumpang. Pantau angka <strong>Penumpang diantar</strong> di panel Statistik misi.' },
    },
    {
      title: 'Satu putaran dengan perisai keselamatan',
      body:
        '<p>Aturan keselamatan di sini: apa pun yang terjadi, tidak ada kendaraan yang menerobos lampu merah atau menabrak pejalan kaki. Aturan itu dijaga <strong>perisai keselamatan</strong>, lapisan terakhir sebelum gas dan rem. Perisai bekerja setiap langkah fisika (1/60 detik) untuk shuttle dan untuk semua kendaraan lain.</p>' +
        '<p>Perisai mencari batasan terdekat di depan kendaraan: garis henti lampu merah, garis henti lampu kuning yang masih sempat dipatuhi, zebra cross yang sedang dipakai, dan pejalan kaki di jalur kendaraan. Lalu gas dibatasi supaya kendaraan selalu masih bisa berhenti sebelum batasan itu.</p>' +
        '<div class="formula">jarak henti = v × jeda + v² / (2 × a_rem)</div>' +
        '<p>Nilai a_rem adalah perlambatan yang benar-benar bisa dicapai pada gesekan jalan saat ini, jadi lebih kecil saat hujan. Pejalan kaki juga baru melangkah ke jalan kalau setiap kendaraan yang mendekat masih bisa berhenti.</p>' +
        '<p>Tekan <strong>Pejalan kaki menyeberang</strong>. Seseorang menyeberang di depan shuttle pada jarak henti ditambah sela. Kalau belum aman, misalnya shuttle sedang mendekati persimpangan, ia menunggu dan baris status menjelaskan alasannya. Di jalan kering di atas sekitar 26 km/jam, shuttle harus mengerem lebih keras dari 3 m/s² dan angka <strong>Pengereman darurat</strong> bertambah.</p>' +
        '<p>Satu putaran dihitung dari halte berikutnya sampai shuttle kembali ke halte itu. Kemajuannya tampil di <strong>Putaran sekarang</strong>.</p>',
      task: { id: 'clean-run', text: 'Biarkan shuttle menyelesaikan satu putaran penuh. Angka <strong>Terobos lampu merah</strong> dan <strong>Kontak dengan pejalan kaki</strong> tetap 0.' },
    },
  ],
  summary:
    '<p>SHUTTLE 01 memakai semua lapisan yang sudah kamu pelajari:</p>' +
    '<ul><li><span class="chip chip-kamera">Sensor</span> LiDAR dan kamera mengumpulkan data di sekitar shuttle.</li>' +
    '<li><span class="chip chip-lidar">Persepsi dan lokalisasi</span> mengenali kendaraan, pejalan kaki, dan warna lampu, lalu menentukan jalan dan lajur tempat shuttle berada.</li>' +
    '<li><span class="chip chip-radar">Perencanaan</span> memakai A* untuk rute antarhalte dan aturan tegas untuk keputusan: melaju, mengikuti, berhenti di lampu, memberi jalan, atau menepi di halte.</li>' +
    '<li><span class="chip chip-ultrasonik">Kendali</span> mengubah keputusan menjadi sudut setir (pure pursuit) serta gas dan rem, dengan perisai keselamatan sebagai penjaga terakhir.</li></ul>' +
    '<p>Shuttle yang sama bisa kamu ikuti dari dekat di <a href="#/shuttle-3d/panduan">Shuttle 3D Ma Chung</a>.</p>' +
    '<p class="note">Peta berasal dari OpenStreetMap (© Kontributor OpenStreetMap). Jumlah dan lebar lajur, kecepatan kendaraan lain, dan tinggi gedung adalah perkiraan. OpenStreetMap tidak mencatat lampu lalu lintas di sekitar Ma Chung, jadi dua lampu di Jalan Karangampel Timur adalah lampu simulasi, sama dengan di Shuttle 3D. Hal lain juga disederhanakan: persepsi dianggap tepat untuk objek dalam jangkauan sensor, posisi shuttle dianggap diketahui dan shuttle mengikuti garis lajur dengan tepat, jalan dianggap datar, penumpang muncul secara acak, dan waktu naik turun penumpang lebih singkat dari aslinya. Kendaraan lain dan pejalan kaki hanya disimulasikan di sekitar shuttle. Di layar kecil, gambar kendaraan sedikit dibesarkan. Shuttle otonom sungguhan di kampus umumnya melaju sekitar 15 sampai 25 km/jam dan masih dipantau operator.</p>',

  styles: `
    .lesson-shuttle .sh-brain { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0; list-style: none; }
    .lesson-shuttle .sh-brain li { display: grid; grid-template-columns: 96px minmax(0, 1fr); align-items: baseline; gap: 10px; padding: 7px 10px;
      border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg); }
    .lesson-shuttle .sh-brain li.is-alert { border-color: rgba(239, 68, 68, .6); background: rgba(239, 68, 68, .08); }
    .lesson-shuttle .sh-layer { display: inline-flex; align-items: center; gap: 7px; color: var(--c); font-size: .8rem; font-weight: 750; white-space: nowrap; }
    .lesson-shuttle .sh-layer::before { content: ''; flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--c); }
    .lesson-shuttle .sh-text { min-height: 1.4em; color: var(--text-soft, var(--text)); font-size: .88rem; line-height: 1.4; }
    .lesson-shuttle .sh-seats { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 4px; margin-top: 2px; }
    .lesson-shuttle .sh-seat { aspect-ratio: 1; max-width: 18px; border: 1.5px solid var(--border); border-radius: 50%; }
    .lesson-shuttle .sh-seat.is-on { border-color: rgba(11, 18, 32, .6); background: var(--c); }
    .lesson-shuttle .sh-seat-label { display: flex; justify-content: space-between; color: var(--muted); font-size: .76rem; font-weight: 600; }
    .lesson-shuttle .sh-row .btn { flex: 1 1 150px; min-height: 44px; }
    .lesson-shuttle .sh-legend { margin-top: 2px; }
    .lesson-shuttle .sh-safe .readout-value { font-variant-numeric: tabular-nums; }
    .lesson-shuttle .sh-pedwait { margin: 6px 0 0; color: var(--muted); font-size: .82rem; line-height: 1.35; min-height: 1.35em; }
    @media (max-width: 600px) {
      .lesson-shuttle .sh-brain li { grid-template-columns: 84px minmax(0, 1fr); gap: 8px; padding: 7px 9px; }
      .lesson-shuttle .sh-text { font-size: .84rem; }
    }
  `,

  async mount(ctx) {
    // ---------- data ----------
    const [data, map2d] = await Promise.all([
      loadNetworkData(),
      ctx.loadMap('machung').catch((e) => {
        if (e && e.name === 'AbortError') throw e;
        return null; // nama tempat tidak wajib
      }),
    ]);
    if (ctx.signal.aborted) throw new DOMException('Dibatalkan', 'AbortError');
    const net = buildNetwork(data, map2d);
    const api = createWorld(net);
    const { W, sh } = api;
    const H = net.halte;

    let tool = 'tutup';
    let camMode = 'ikuti';
    let lapse = 1;
    const cam = { x: sh.x, y: sh.z };
    const holds = {};
    let rerouteNote = null; // { text, until }
    let pedNote = null;

    // ---------- kanvas dan loop ----------
    const labels = createLabelLayer();
    const labelRects = new Map();
    const renderer = createRenderer(api);
    const view = ctx.createView({
      label: 'Peta jalan di sekitar Universitas Ma Chung dari atas. Shuttle otonom hijau toska melayani lima halte, di antara sepeda motor, mobil, angkot, pejalan kaki, dan dua lampu lalu lintas simulasi.',
      background: COLORS.ground,
      padding: 10,
    });

    const loop = ctx.createLoop({
      update(dt) {
        // percepatan waktu: lebih banyak langkah fisika dengan dt tetap, dibatasi anggaran waktu per frame
        const t0 = performance.now();
        for (let i = 0; i < lapse; i++) {
          api.update(dt);
          if (i > 0 && performance.now() - t0 > 10) break;
        }
        api.scanSensors(dt * lapse, lapse);
        renderer.addScan(loop.time);
      },
      render,
    });

    // kendaraan lain muncul di luar layar bila bisa
    api.setHidden((x, y) => {
      const b = view.visibleBounds();
      return x < b.minX - 8 || x > b.maxX + 8 || y < b.minY - 8 || y > b.maxY + 8;
    });

    // ---------- panel: lapisan otak ----------
    const brainGroup = ui.group(ctx.controls, { title: 'Lapisan otak shuttle', wide: true });
    const brainList = ui.el('ul', { class: 'sh-brain' });
    const brainRows = {};
    for (const L of LAYERS) {
      const text = ui.el('span', { class: 'sh-text' });
      const li = ui.el('li', { style: { '--c': L.color } }, ui.el('span', { class: 'sh-layer', text: L.label }), text);
      brainList.append(li);
      brainRows[L.id] = { li, text, last: '' };
    }
    brainGroup.append(brainList);

    // ---------- panel: kondisi ----------
    const condGroup = ui.group(ctx.controls, { title: 'Kondisi' });
    const rainToggle = ui.toggle(condGroup, { label: 'Hujan', color: RAIN_COLOR, onChange: (on) => setWeather(on ? 'hujan' : 'cerah') });
    ui.slider(condGroup, {
      label: 'Kecepatan maksimum shuttle',
      min: 10,
      max: 30,
      step: 1,
      value: W.limitKmh,
      unit: 'km/jam',
      hint: 'Kendaraan lain mengikuti perkiraan kecepatan rata-rata jalannya.',
      onInput: (v) => api.setLimit(v),
    });
    const lapseCtl = ui.segmented(condGroup, {
      label: 'Percepatan waktu',
      options: [
        { value: 1, label: '1 kali' },
        { value: 4, label: '4 kali' },
        { value: 8, label: '8 kali' },
      ],
      value: lapse,
      onChange: (v) => {
        lapse = v;
      },
    });
    const pedRow = ui.buttonRow(condGroup, { className: 'sh-row' });
    ui.button(pedRow, { label: 'Pejalan kaki menyeberang', icon: 'hand', onClick: () => addPedestrian() });
    const pedWait = ui.el('p', { class: 'sh-pedwait', 'aria-live': 'polite' });
    condGroup.append(pedWait);

    // ---------- panel: peta ----------
    const mapGroup = ui.group(ctx.controls, { title: 'Peta' });
    const toolCtl = ui.segmented(mapGroup, {
      label: 'Klik atau ketuk peta untuk',
      options: [
        { value: 'tutup', label: 'Tutup jalan' },
        { value: 'halte', label: 'Pilih halte' },
      ],
      value: tool,
      onChange: (v) => setTool(v),
    });
    const toolHint = ui.el('p', { class: 'ctl-hint' });
    mapGroup.append(toolHint);
    const roadRow = ui.buttonRow(mapGroup, { className: 'sh-row' });
    ui.button(roadRow, { label: 'Tutup jalan di depan', icon: 'lock', onClick: () => closeAhead() });
    ui.button(roadRow, { label: 'Buka semua jalan', icon: 'reset', onClick: () => openAll() });
    const camCtl = ui.segmented(mapGroup, {
      label: 'Tampilan',
      options: [
        { value: 'ikuti', label: 'Ikuti shuttle' },
        { value: 'rute', label: 'Seluruh rute' },
      ],
      value: camMode,
      onChange: (v) => setCamMode(v),
    });
    ui.legend(mapGroup, [
      { color: COLORS.path, label: 'Rute shuttle', shape: 'line' },
      { color: '#f87171', label: 'Rute lama atau jalan ditutup', shape: 'line' },
      { color: COLORS.lidar, label: 'Titik LiDAR', shape: 'dot' },
      { color: COLORS.lightYellow, label: 'Lampu lalu lintas simulasi', shape: 'dot' },
    ]).classList.add('sh-legend');

    // ---------- panel: halte ----------
    const halteGroup = ui.group(ctx.controls, { title: 'Halte' });
    const halteToggles = H.map((h) => ui.toggle(halteGroup, { label: h.name, color: h.color, checked: true, onChange: (on) => setHalte(h.index, on) }));

    // ---------- panel: statistik ----------
    const statGroup = ui.group(ctx.controls, { title: 'Statistik misi' });
    const statGrid = ui.readoutGrid(statGroup);
    const out = {
      delivered: ui.readout(statGrid, { label: 'Penumpang diantar', value: '0' }),
      distance: ui.readout(statGrid, { label: 'Jarak tempuh', value: '0 m' }),
      time: ui.readout(statGrid, { label: 'Waktu misi', value: '0 detik' }),
      wait: ui.readout(statGrid, { label: 'Rata-rata waktu tunggu', value: '-' }),
      emergencies: ui.readout(statGrid, { label: 'Pengereman darurat', value: '0' }),
      loops: ui.readout(statGrid, { label: 'Putaran selesai', value: '0' }),
      loopNow: ui.readout(statGrid, { label: 'Putaran sekarang', value: '-' }),
    };
    const seatLabel = ui.el('div', { class: 'sh-seat-label' }, ui.el('span', { text: 'Di dalam shuttle' }), ui.el('span', { text: `0/${CAPACITY}` }));
    const seats = ui.el('div', { class: 'sh-seats', role: 'img', 'aria-label': 'Kursi shuttle' });
    const seatEls = [];
    for (let i = 0; i < CAPACITY; i++) {
      const s = ui.el('span', { class: 'sh-seat' });
      seats.append(s);
      seatEls.push(s);
    }
    statGroup.append(seatLabel, seats);

    // ---------- panel: perisai keselamatan ----------
    const safeGroup = ui.group(ctx.controls, { title: 'Perisai keselamatan', className: 'sh-safe' });
    const safeGrid = ui.readoutGrid(safeGroup);
    const safe = {
      red: ui.readout(safeGrid, { label: 'Terobos lampu merah', value: '0' }),
      ped: ui.readout(safeGrid, { label: 'Kontak dengan pejalan kaki', value: '0' }),
      shield: ui.readout(safeGrid, { label: 'Intervensi pada shuttle', value: '0' }),
      other: ui.readout(safeGrid, { label: 'Tabrakan lain', value: '0' }),
    };
    safeGroup.append(ui.el('p', { class: 'ctl-hint', text: 'Dua angka pertama harus selalu 0 untuk semua kendaraan. Intervensi dihitung saat perisai membatasi gas shuttle lebih ketat dari rencananya.' }));

    // ---------- HUD ----------
    const speedChip = ui.hudChip(ctx.hud, { label: 'Shuttle', color: COLORS.accent });
    const targetChip = ui.hudChip(ctx.hud, { label: 'Menuju', color: COLORS.path });
    const gapChip = ui.hudChip(ctx.hud, { label: 'Jarak ke depan', color: COLORS.radar });
    const rainChip = ui.hudChip(ctx.hud, { label: 'Cuaca', color: RAIN_COLOR });

    // ---------- interaksi kanvas ----------
    function halteHit(e) {
      let best = null;
      let bestD = 4 + e.hitRadius;
      for (const h of H) {
        const d = Math.min(Math.hypot(e.x - h.sign.x, e.y - h.sign.y), Math.hypot(e.x - h.shelter.x, e.y - h.shelter.y));
        if (d < bestD) {
          bestD = d;
          best = h;
        }
      }
      if (best) return best;
      // label nama halte (kotak dalam piksel layar)
      for (const [i, r] of labelRects) {
        if (e.sx >= r.left - 4 && e.sx <= r.left + r.w + 4 && e.sy >= r.top - 4 && e.sy <= r.top + r.h + 4) return H[i];
      }
      // tampilan jauh: ketukan di sekitar rambu yang digambar diperbesar
      const k = view.px(14);
      for (const h of H) if (Math.hypot(e.x - h.sign.x, e.y - h.sign.y) < k + e.hitRadius) return h;
      return null;
    }

    const roadHit = (e) => net.roadAt(e.x, e.y, e.hitRadius + view.px(4));

    view.onPointer({
      tap(e) {
        if (tool === 'tutup') {
          const R = roadHit(e);
          if (R) describeToggle(api.toggleRoad(R.id));
          else if (halteHit(e)) ctx.toast('Untuk memilih halte, ganti alat ke Pilih halte.', { tone: 'info' });
        } else {
          const h = halteHit(e);
          if (h) {
            const on = !W.active[h.index];
            halteToggles[h.index].set(on);
            setHalte(h.index, on);
          } else if (roadHit(e)) ctx.toast('Untuk menutup jalan, ganti alat ke Tutup jalan.', { tone: 'info' });
        }
        refreshPanels(0);
      },
      move(e) {
        const hit = tool === 'tutup' ? roadHit(e) : halteHit(e);
        view.setCursor(hit ? 'pointer' : 'default');
      },
    });

    view.onResize(() => {
      if (camMode === 'ikuti') {
        view.setScale(followScale());
        clampCamera();
      }
    });

    // ---------- aksi ----------
    function setTool(v) {
      tool = v;
      toolCtl.set(v);
      toolHint.textContent =
        v === 'tutup'
          ? `Klik atau ketuk jalan untuk menutup atau membukanya. Paling banyak ${MAX_CLOSED} jalan.`
          : 'Klik atau ketuk rambu halte untuk berhenti atau mulai melayaninya. Minimal dua halte tetap dilayani.';
    }

    function setWeather(w) {
      api.setWeather(w);
      rainToggle.set(w === 'hujan');
      if (ctx.paused) api.rig.scanNow(api.sensorObjects, w);
    }

    function followScale() {
      return clamp(view.width / 140, 3.0, 6.5);
    }

    function setCamMode(mode) {
      camMode = mode;
      camCtl.set(mode);
      if (mode === 'rute') view.fit(() => net.loopBounds, 10);
      else {
        view.fit(null);
        view.setScale(followScale());
        cam.x = sh.x + Math.cos(sh.h) * 14;
        cam.y = sh.z + Math.sin(sh.h) * 14;
        clampCamera();
      }
    }

    function clampCamera() {
      const b = net.bounds;
      const hw = view.width / 2 / view.camera.scale;
      const hh = view.height / 2 / view.camera.scale;
      const x = hw * 2 >= b.maxX - b.minX ? (b.minX + b.maxX) / 2 : clamp(cam.x, b.minX + hw, b.maxX - hw);
      const y = hh * 2 >= b.maxY - b.minY ? (b.minY + b.maxY) / 2 : clamp(cam.y, b.minY + hh, b.maxY - hh);
      view.centerOn(x, y);
    }

    function describeToggle(r) {
      if (!r.ok) {
        ctx.toast(r.msg, { tone: 'warn', duration: 4500 });
        return;
      }
      const name = r.road.name || 'Jalan tanpa nama';
      if (!r.closed) {
        ctx.toast(`${name} dibuka lagi.${r.back != null ? ` Shuttle kembali melayani halte ${H[r.back].name}.` : ''}`, { tone: 'info' });
        rerouteNote = null;
        return;
      }
      if (r.rerouted) {
        const t = W.target != null ? H[W.target] : null;
        rerouteNote = {
          text: r.target !== r.prevTarget && t && r.prevTarget != null ? `Halte ${H[r.prevTarget].name} tidak bisa dicapai karena ${name} ditutup, jadi shuttle lanjut ke ${t.name}` : `Rute baru karena ${name} ditutup`,
          until: W.time + 10,
        };
      } else if (!r.onRoute) ctx.toast(`${name} ditutup. Jalan ini tidak ada di sisa rute shuttle, jadi rutenya tetap.`, { tone: 'info' });
      else ctx.toast(`${name} ditutup. Shuttle sudah terlalu dekat atau sudah berada di jalan ini, jadi ia tetap lewat sampai ujungnya.`, { tone: 'info', duration: 4500 });
    }

    function closeAhead() {
      describeToggle(api.closeAhead());
      refreshPanels(0);
    }

    function openAll() {
      const r = api.openAll();
      if (r.ok) ctx.toast(`Semua jalan dibuka lagi.${r.back != null ? ` Shuttle kembali melayani halte ${H[r.back].name}.` : ''}`, { tone: 'info' });
      rerouteNote = null;
      refreshPanels(0);
    }

    function setHalte(i, on) {
      const r = api.setActive(i, on);
      if (!r.ok) {
        halteToggles[i].set(true);
        ctx.toast(r.msg, { tone: 'warn' });
      } else if (!on && r.left) ctx.toast(`Halte ${H[i].name} tidak dilayani. ${fmt(r.left)} calon penumpang membatalkan perjalanan.`, { tone: 'info' });
      refreshPanels(0);
    }

    function addPedestrian() {
      const r = api.requestTestPed();
      if (!r.ok) {
        ctx.toast(r.reason === 'antre' ? 'Pejalan kaki sebelumnya masih menunggu saat yang aman.' : 'Pejalan kaki sebelumnya masih menyeberang. Tunggu sebentar.', { tone: 'info' });
        return;
      }
      pedNote = { text: 'Pejalan kaki bersiap menyeberang di depan shuttle.', until: W.time + 3 };
      refreshPanels(0);
    }

    // ---------- teks lapisan otak ----------
    function decisionText() {
      if (W.mode === 'dwell') {
        const D = W.dwell;
        return { text: `Berhenti di halte ${D.halte.name}, ${DOOR_WORDS[D.phase] || 'pintu dibuka'}.` };
      }
      if (W.time - W.emergencyAt < 1.6) return { text: `Rem darurat, perlambatan lebih dari ${fmt(EMERGENCY_DECEL)} m/s². ${sh.planReason === 'zebra' ? 'Pejalan kaki menyeberang di depan.' : 'Ada batasan dekat di depan.'}`, alert: true };
      if (W.time - W.shieldAt < 1.2 && sh.shieldOn) return { text: `Perisai keselamatan membatasi gas: ${SHIELD_WORDS[W.shieldWhat] || 'ada batasan di depan'}.`, alert: true };
      const r = sh.planReason;
      const lead = sh.leaderVeh;
      switch (r) {
        case 'halte':
          return { text: `Menepi ke halte ${W.target != null ? H[W.target].name : ''}.` };
        case 'lampu-merah':
          return { text: 'Berhenti, lampu merah di depan (lampu simulasi).' };
        case 'lampu-kuning':
          return { text: 'Berhenti, lampu kuning dan masih sempat mengerem dengan nyaman.' };
        case 'kuning-terus':
          return { text: 'Terus, lampu kuning tetapi sudah terlalu dekat untuk berhenti dengan nyaman.' };
        case 'menunggu-simpang': {
          const why = sh.waitWhy;
          if (why === 4) return { text: 'Menunggu, lajur setelah persimpangan masih penuh.' };
          if (why === 5) return { text: 'Menunggu lampu hijau.' };
          return { text: 'Menunggu, ada kendaraan yang sedang melintas di persimpangan.' };
        }
        case 'memberi-jalan':
          return { text: sh.path[0]?.entry || sh.link.kind === 'conn' ? 'Memberi jalan ke kendaraan di bundaran atau jalan utama.' : 'Memberi jalan ke kendaraan di jalan utama.' };
        case 'zebra':
          return { text: 'Berhenti, pejalan kaki sedang menyeberang di depan.' };
        case 'mengikuti': {
          const wet = W.weather === 'hujan';
          const T = wet ? 3 : 1.5;
          const s0 = wet ? 5 : 3;
          const who = lead ? TYPE_LABEL[lead.type] : 'kendaraan';
          return { text: `Mengikuti ${who} di depan. Jarak ${meters(sh.leaderGap)}, sasaran ${fmt(s0 + sh.v * T, 0)} m (${fmt(s0)} m + ${fmt(T, T % 1 ? 1 : 0)} detik × kecepatan).` };
        }
        case 'tikungan':
          return { text: 'Melambat untuk berbelok.' };
        case 'buntu':
          return { text: 'Berhenti, tidak ada rute ke halte mana pun. Buka salah satu jalan.', alert: true };
        default:
          return { text: `Melaju, kecepatan target ${kmh(Math.min(api.app.egoSpeedLimit(), sh.link.vmax))}.` };
      }
    }

    // kemudi pure pursuit dari garis lajur di depan shuttle (untuk panel Kendali)
    function steerAngle() {
      const pts = [];
      const o = {};
      let s = sh.s - 6;
      const links = [sh.link, ...sh.path];
      let li = 0;
      let rem = 36;
      if (s < 0 && sh.prevLink) {
        for (let q = sh.prevLink.len + s; q < sh.prevLink.len; q += 1) {
          sh.prevLink.poly.at(q, o);
          pts.push({ x: o.x, y: o.z });
        }
        s = 0;
      }
      while (li < links.length && rem > 0) {
        const L = links[li];
        for (let q = Math.max(0, s); q <= L.len && rem > 0; q += 1, rem -= 1) {
          L.poly.at(q, o);
          const p = { x: o.x, y: o.z };
          const last = pts[pts.length - 1];
          if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 0.2) pts.push(p);
        }
        s = 0;
        li++;
      }
      if (pts.length < 2) return 0;
      const pose = { x: sh.x, y: sh.z, heading: sh.h, speed: sh.v, wheelbase: 4.0, maxSteer: 0.6 };
      return purePursuit(pose, new Path(pts), { lookahead: 3, gain: 0.5 }).steer;
    }

    function layerTexts() {
      const lr = api.rig.reading('lidar');
      const range = api.lidar.effectiveRange(W.weather);
      const camDet = api.rig.detections('kamera');
      const t = {};
      t.sensor = `LiDAR ${fmt(lr ? lr.points.length : 0)} titik dalam ${fmt(range, 0)} m, kamera ${fmt(camDet.length)} objek.${W.weather === 'hujan' ? ' Hujan memperpendek jangkauan.' : ''}`;

      // persepsi: objek dari deteksi LiDAR, warna lampu dari kamera
      const counts = new Map();
      let peds = 0;
      for (const d of api.rig.detections('lidar')) {
        const o = d.target;
        if (!o) continue;
        if (o.kind === 'pedestrian') peds++;
        else if (o.dyn && o !== sh) counts.set(TYPE_LABEL[o.type], (counts.get(TYPE_LABEL[o.type]) || 0) + 1);
      }
      const parts = [];
      for (const [k, n] of counts) parts.push(`${fmt(n)} ${k}`);
      if (peds) parts.push(`${fmt(peds)} pejalan kaki`);
      // lampu berikutnya di rencana shuttle
      let base = sh.link.len - (sh.s + sh.len / 2);
      const links = [sh.link, ...sh.path];
      for (let i = 0; i < links.length; i++) {
        const L = links[i];
        const dEnd = i === 0 ? base : base + L.len;
        if (L.sig && dEnd > -0.5 && dEnd < 60) {
          const hd = net.heads.find((q) => q.ctl === L.sig.ctl && q.arm === L.sig.arm);
          const seenLight = hd && camDet.find((d) => d.target === hd.light && d.color);
          parts.push(seenLight ? `lampu ${COLOR_WORDS[seenLight.color]} ${meters(dEnd)} di depan` : `lampu ${meters(dEnd)} di depan belum terbaca`);
          break;
        }
        if (i > 0) base += L.len;
        if (dEnd > 60) break;
      }
      t.persepsi = parts.length ? cap(`${parts.join(', ')}.`) : 'Tidak ada kendaraan atau pejalan kaki di sekitar.';

      const L = sh.link;
      if (L.kind === 'conn') t.lokalisasi = L.ringc || L.entry || L.exit ? 'Di bundaran.' : `Di dalam persimpangan, menuju ${L.to.name || 'jalan tanpa nama'}.`;
      else if (L.ring !== null) t.lokalisasi = 'Di bundaran, lajur melingkar.';
      else {
        const toEnd = L.len - (sh.s + sh.len / 2);
        const nm = L.name || 'Jalan tanpa nama';
        t.lokalisasi = toEnd < 1 ? `${nm}, lajur kiri, tepat di depan persimpangan.` : `${nm}, lajur kiri, ${meters(toEnd)} lagi ke persimpangan.`;
      }

      if (W.target == null) t.rute = 'Tidak ada rute ke halte mana pun.';
      else {
        const h = H[W.target];
        const d = api.distToHalte(h);
        t.rute = `Menuju ${h.name}, ${meters(d ?? 0)}.`;
        const skipped = [...W.unreachable].filter((k) => W.active[k]).map((k) => H[k].name);
        if (rerouteNote && W.time < rerouteNote.until) t.rute += ` ${rerouteNote.text}.`;
        else if (skipped.length) t.rute += ` Halte ${skipped.join(' dan ')} dilewati karena jalannya ditutup.`;
        else if (W.lastSearch && W.lastSearch.expanded) t.rute += ` A* memeriksa ${fmt(W.lastSearch.expanded)} node.`;
      }
      const dec = decisionText();
      t.keputusan = dec.text;
      t.keputusanAlert = !!dec.alert;
      const deg = radToDeg(steerAngle());
      const steer = Math.abs(deg) < 1 ? 'setir lurus' : `setir ${fmt(Math.abs(deg), 0)}° ke ${deg > 0 ? 'kanan' : 'kiri'}`;
      const a = sh.a;
      const pedal = sh.v < 0.05 && a <= 0 ? 'rem ditahan' : a > 0.05 ? `gas ${fmt(a, 1)} m/s²` : a < -0.05 ? `rem ${fmt(-a, 1)} m/s²` : 'kecepatan tetap';
      t.kendali = `${kmh(sh.v)}, ${steer}, ${pedal}.`;
      return t;
    }

    // ---------- pembaruan panel ----------
    let lastPanel = 0;
    function refreshPanels(realDt) {
      handleEvents();
      const t = layerTexts();
      for (const L of LAYERS) {
        const row = brainRows[L.id];
        if (row.last !== t[L.id]) {
          row.last = t[L.id];
          row.text.textContent = t[L.id];
        }
      }
      brainRows.keputusan.li.classList.toggle('is-alert', t.keputusanAlert);

      const S = W.stats;
      out.delivered.set(fmt(S.delivered));
      out.distance.set(S.distance >= 1000 ? fmt(S.distance / 1000, 2, 'km') : fmt(S.distance, 0, 'm'));
      out.time.set(seconds(S.time));
      out.wait.set(S.waitN ? fmt(S.waitSum / S.waitN, 1, 'detik') : '-');
      out.emergencies.set(fmt(S.emergencies));
      out.emergencies.setTone(S.emergencies ? 'warn' : '');
      const Lp = W.loop;
      out.loops.set(fmt(S.loops));
      out.loopNow.set(Lp && Lp.start != null ? `${fmt(Math.min(Lp.count + 1, H.length))}/${fmt(H.length)} halte` : 'belum mulai');
      seatLabel.lastChild.textContent = `${fmt(W.onboard.length)}/${fmt(CAPACITY)}`;
      seatEls.forEach((el, k) => {
        const p = W.onboard[k];
        el.classList.toggle('is-on', !!p);
        el.style.setProperty('--c', p ? H[p.to].color : 'transparent');
      });
      seats.setAttribute('aria-label', `${fmt(W.onboard.length)} dari ${fmt(CAPACITY)} kursi terisi`);

      const M = api.monitor;
      safe.red.set(fmt(M.redRuns));
      safe.red.setTone(M.redRuns ? 'danger' : 'ok');
      safe.ped.set(fmt(M.pedContacts));
      safe.ped.setTone(M.pedContacts ? 'danger' : 'ok');
      safe.shield.set(fmt(M.shuttleShield));
      safe.other.set(fmt(M.otherCollisions));
      safe.other.setTone(M.otherCollisions ? 'warn' : '');

      H.forEach((h, k) => {
        const q = W.queues[k].length;
        const hint = !W.active[k] ? 'Tidak dilayani' : W.unreachable.has(k) || h.link.closed ? 'Jalannya ditutup' : q ? `${fmt(q)} menunggu` : 'Belum ada yang menunggu';
        halteToggles[k].setHint(hint);
      });
      rainToggle.setHint(
        W.weather === 'hujan' ? `Shuttle paling cepat ${fmt(W.limitKmh * RAIN_FACTOR, 0)} km/jam, jarak waktu 3 detik` : `Shuttle paling cepat ${fmt(W.limitKmh)} km/jam, jarak waktu 1,5 detik`,
      );

      // permintaan pejalan kaki uji
      const R = api.peds.request;
      if (R) pedWait.textContent = R.reason ? `Pejalan kaki menunggu saat yang aman: ${PED_WAIT[R.reason] || 'jarak belum cukup'}.` : 'Pejalan kaki bersiap menyeberang.';
      else pedWait.textContent = '';

      speedChip.set(kmh(sh.v));
      targetChip.show(W.target != null);
      if (W.target != null) targetChip.set(H[W.target].name);
      const lead = sh.leaderVeh;
      const showGap = lead && sh.leaderGap < 45 && W.mode === 'drive';
      gapChip.show(!!showGap);
      if (showGap) gapChip.set(meters(sh.leaderGap));
      rainChip.show(W.weather === 'hujan');
      rainChip.set('Hujan');

      checkTasks(realDt);
      updateStatus(t);
    }

    // ---------- tugas ----------
    const currentTask = () => ctx.lesson.steps[ctx.currentStep()]?.taskId;
    const done = (id) => currentTask() === id && !ctx.isTaskDone(id) && ctx.completeTask(id);

    function handleEvents() {
      for (const ev of W.events) {
        if (ev.type === 'board') done('first-stop');
        else if (ev.type === 'reroute') holds.reroute = 0;
        else if (ev.type === 'loop' && ev.clean) done('clean-run');
        else if (ev.type === 'test-ped') pedNote = { text: 'Pejalan kaki menyeberang di depan shuttle, pada jarak yang masih cukup untuk berhenti.', until: W.time + 5 };
      }
      W.events.length = 0;
      if (api.peds.lastExpired) {
        api.peds.lastExpired = false;
        ctx.toast('Pejalan kaki batal menyeberang karena belum ada saat yang aman. Coba lagi saat shuttle melaju di jalan lurus.', { tone: 'info', duration: 4500 });
      }
    }

    function checkTasks(realDt) {
      const id = currentTask();
      if (!id || ctx.isTaskDone(id)) return;
      if (id === 'closure' && holds.reroute != null) {
        holds.reroute += realDt;
        if (holds.reroute > 1.2) done('closure');
      }
      if (id === 'rain') {
        const limit = api.app.egoSpeedLimit();
        const ok = W.weather === 'hujan' && W.mode === 'drive' && sh.v > 0.8 && sh.v <= limit + 0.3;
        holds.rain = ok ? (holds.rain || 0) + realDt : 0;
        if (holds.rain >= 2.5) done('rain');
      }
      if (id === 'deliver-10' && W.stats.delivered >= 10) done('deliver-10');
    }

    // ---------- baris status ----------
    function updateStatus(t) {
      let first = t.keputusan;
      const R = api.peds.request;
      if (R && R.reason) first = `Pejalan kaki menunggu saat yang aman: ${PED_WAIT[R.reason] || 'jarak belum cukup'}.`;
      else if (pedNote && W.time < pedNote.until) first = pedNote.text;
      const second = W.target != null ? t.rute.split('. ')[0].replace(/\.$/, '') : 'Tidak ada rute';
      ctx.setStatus(`${first} ${second}.`);
    }

    // ---------- menggambar ----------
    let lastFrame = 0;
    function render() {
      const now = performance.now();
      const realDt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0;
      lastFrame = now;
      if (camMode === 'ikuti') {
        const rate = lapse * (ctx.speed || 1);
        const k = Math.min(1, realDt * 2.5 * Math.sqrt(rate));
        const tx = sh.x + Math.cos(sh.h) * 14;
        const ty = sh.z + Math.sin(sh.h) * 14;
        cam.x += (tx - cam.x) * k;
        cam.y += (ty - cam.y) * k;
        clampCamera();
      }
      const narrow = view.width < 600;
      const g = view.begin(COLORS.ground);
      renderer.draw(g, view, { time: loop.time, labels, narrow, reducedMotion: ctx.reducedMotion, labelRects });
      labels.draw(g, view);
      drawScaleBar(g, view);
      drawAttribution(g, view);

      if (now - lastPanel > 125) {
        refreshPanels(lastPanel ? Math.min(0.5, (now - lastPanel) / 1000) : 0);
        lastPanel = now;
      }
    }

    // ---------- kait uji (baca saja) ----------
    const hook = {
      lesson: 'shuttle',
      get redRuns() {
        return api.monitor.redRuns;
      },
      get pedContacts() {
        return api.monitor.pedContacts;
      },
      get otherCollisions() {
        return api.monitor.otherCollisions;
      },
      snapshot: () => ({
        redRuns: api.monitor.redRuns,
        pedContacts: api.monitor.pedContacts,
        otherCollisions: api.monitor.otherCollisions,
        clamps: api.traffic.stats.clamps,
        followClamps: api.traffic.stats.followClamps,
        lineClamps: api.traffic.stats.lineClamps,
        shuttleShield: api.monitor.shuttleShield,
        recovered: api.traffic.stats.recovered,
        events: api.monitor.events.slice(),
        time: W.time,
        weather: W.weather,
        limitKmh: W.limitKmh,
        lapse,
        target: W.target,
        mode: W.mode,
        delivered: W.stats.delivered,
        loops: W.stats.loops,
        emergencies: W.stats.emergencies,
        distance: W.stats.distance,
        speed: sh.v,
        reason: sh.planReason,
        x: sh.x,
        y: sh.z,
        link: sh.link.id,
        cars: api.traffic.cars.length,
        peds: api.peds.peds.length,
        closed: [...net.closed],
        pedRequest: api.peds.request ? { reason: api.peds.request.reason, t: api.peds.request.t } : null,
        pedTests: api.peds.stats.tests,
        camMode,
        scale: view.camera.scale,
      }),
      api,
      net,
      view,
      renderer,
      setLapse(v) {
        lapse = v;
        lapseCtl.set(v);
      },
    };
    window.__lessonSafety = hook;
    ctx.onCleanup(() => {
      if (window.__lessonSafety === hook) delete window.__lessonSafety;
    });

    setTool('tutup');
    setCamMode('ikuti');

    // ---------- antarmuka ke shell ----------
    return {
      onStep(i) {
        const preset = STEP_PRESETS[i];
        if (!preset) return;
        if (preset.weather) setWeather(preset.weather);
        if (preset.tool) setTool(preset.tool);
        if (preset.openRoads && net.closed.size) api.openAll();
        if (preset.leader) {
          if (!W.leader) api.placeLeader();
        } else api.releaseLeader();
        if (preset.loopReset) api.resetLoop();
        if (i === 0 && !ctx.isTaskDone('first-stop') && W.target != null) api.seedPassengers(W.target, 2);
        for (const k of Object.keys(holds)) delete holds[k];
        rerouteNote = null;
        refreshPanels(0);
      },
      reset() {
        api.reset();
        renderer.clear();
        for (const k of Object.keys(holds)) delete holds[k];
        rerouteNote = null;
        pedNote = null;
        cam.x = sh.x;
        cam.y = sh.z;
        if (ctx.currentStep() === 2) api.placeLeader();
        if (ctx.currentStep() === 0 && W.target != null) api.seedPassengers(W.target, 2);
        refreshPanels(0);
      },
      destroy() {
        // Kanvas, loop, dan listener dibersihkan otomatis oleh ctx.
      },
    };
  },
};
