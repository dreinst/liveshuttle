// Pelajaran 9: Misi Shuttle Otonom.
//
// Pelajaran "kotak pasir" yang menyatukan semua materi. Shuttle SHUTTLE 01 berkeliling kawasan
// kampus, menjemput dan mengantar penumpang di lima halte. Rute antarhalte dicari dengan A*,
// kendaraan berhenti di lampu merah, memberi jalan ke pejalan kaki, menjaga jarak, dan
// menghitung ulang rute saat jalan ditutup.
//
// Susunan file:
//   ./shuttle/campus.js  peta kampus (graf jalan, lajur, lampu, zebra cross, halte, gambar statis)
//   ./shuttle/world.js   simulasi (rute, keputusan, pejalan kaki, penumpang, sensor, statistik)
//   ./shuttle/render.js  gambar dinamis dan lapisan peta statis yang disimpan
// File ini berisi teks pelajaran, panel kontrol, deteksi tugas, dan penghubung ke shell.

import { COLORS } from '../engine/theme.js';
import { fmt, msToKmh, radToDeg, clamp } from '../engine/math.js';
import { drawWeather, drawScaleBar, createLabelLayer } from '../engine/draw.js';
import * as ui from '../engine/ui.js';
import { HALTE, MAP_BOUNDS, EXT, roadAt, halteAt } from './shuttle/campus.js';
import { createWorld, CAPACITY, RAIN_FACTOR, EMERGENCY_DECEL } from './shuttle/world.js';
import { createStaticLayer, drawDynamic, drawSensorOverlay, vehicleScale } from './shuttle/render.js';

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

const kmh = (ms, d = 0) => fmt(msToKmh(ms), d, 'km/jam');
const meters = (m) => fmt(Math.max(0, m), 0, 'm');
const seconds = (s) => fmt(Math.max(0, Math.floor(s)), 0, 'detik');

export default {
  id: 'shuttle',
  title: 'Misi Shuttle Otonom',
  layout: 'sim',
  intro:
    '<p>Di pelajaran ini semua materi sebelumnya bekerja bersama. Shuttle otonom <strong>SHUTTLE 01</strong> berkeliling kawasan kampus, menjemput penumpang di lima halte, lalu mengantar mereka ke halte tujuan.</p>' +
    '<p>Panel <strong>Lapisan otak shuttle</strong> di bawah simulasi menunjukkan apa yang sedang dikerjakan tiap lapisan sistemnya, dari sensor sampai kendali.</p>',
  steps: [
    {
      title: 'Halte pertama',
      body:
        '<p>SHUTTLE 01 memuat paling banyak 12 penumpang. Ia melayani halte secara berurutan: Gerbang Utama, Asrama, Kantin, Perpustakaan, dan Rektorat, lalu kembali ke awal. Warna titik penumpang di halte menunjukkan halte tujuannya.</p>' +
        '<p>Untuk setiap perjalanan ke halte berikutnya, shuttle mencari rute dengan <strong>A*</strong> pada graf jalan kampus. Persimpangan menjadi node dan ruas jalan menjadi sisi, dengan biaya berupa panjang ruas itu. Shuttle tidak bisa putar balik di jalan sempit, jadi A* juga mencatat dari ruas mana shuttle datang. <span class="chip chip-accent">Garis hijau toska</span> adalah rute yang sedang dipakai.</p>' +
        '<p>Di halte, shuttle menepi di lajur kiri dan membuka pintu di sisi kiri, yaitu sisi trotoar. Penumpang yang sudah sampai turun dulu, baru penumpang baru naik.</p>',
      task: { id: 'first-stop', text: 'Perhatikan shuttle sampai di halte pertama, membuka pintu, lalu menaikkan penumpang.' },
    },
    {
      title: 'Jalan ditutup',
      body:
        '<p>Ruas jalan kampus bisa ditutup, misalnya karena ada acara atau perbaikan. Ruas yang ditutup dihapus dari graf, lalu shuttle menghitung ulang rute dengan A*.</p>' +
        '<p>Pencarian ulang dimulai dari ruas yang sedang dilalui shuttle. Kalau shuttle sudah masuk persimpangan, ruas tujuannya juga dianggap pasti karena shuttle tidak boleh berbelok mendadak di tengah persimpangan.</p>' +
        '<p>Pilih <strong>Tutup jalan</strong> di panel Peta kampus, lalu klik atau ketuk ruas yang dilewati garis rute. Ketuk sekali lagi untuk membukanya. Tombol <strong>Tutup ruas di depan</strong> melakukan hal yang sama untuk ruas pertama di depan shuttle. Setelah rute dihitung ulang, rute lama tampil sebentar sebagai garis merah putus-putus.</p>' +
        '<p class="note">Simulasi ini membatasi dua ruas tertutup sekaligus dan menolak penutupan yang membuat jalan buntu karena kendaraan di sini tidak bisa putar balik. Kendaraan yang sudah berada di ruas tertutup tetap boleh keluar.</p>',
      task: { id: 'closure', text: 'Tutup satu ruas jalan yang dilewati rute shuttle, lalu lihat rutenya dihitung ulang.' },
    },
    {
      title: 'Hujan',
      body:
        '<p>Hujan membuat jalan basah. Koefisien gesek ban μ turun dari sekitar 0,8 menjadi sekitar 0,5, jadi jarak pengereman lebih panjang. Butiran air juga memperpendek jangkauan sensor. Di simulasi ini jangkauan LiDAR turun dari 45 m menjadi 36 m (jangkauan di sini sengaja dipendekkan supaya muat di layar).</p>' +
        '<p>Karena itu shuttle melaju paling cepat 70% dari batas kampus, misalnya 14 km/jam kalau batasnya 20 km/jam. Jarak waktunya ke kendaraan di depan naik dari 1,5 detik menjadi 3 detik, dan jarak minimum saat berhenti naik dari 3 m menjadi 5 m.</p>' +
        '<div class="formula">jarak aman ≈ jarak minimum + v × jarak waktu</div>' +
        '<p>Ada mobil yang berjalan pelan di depan shuttle. Bandingkan angka <strong>Jarak ke depan</strong> di HUD sebelum dan sesudah hujan.</p>' +
        '<p class="note">Percepatan shuttle dihitung dengan Intelligent Driver Model (IDM), model pengikut kendaraan yang banyak dipakai di simulasi lalu lintas. Rumus di atas adalah jarak yang dituju IDM saat melaju stabil.</p>',
      task: { id: 'rain', text: 'Nyalakan <strong>Hujan</strong>, lalu perhatikan shuttle melambat dan menjaga jarak lebih jauh dari mobil di depannya.' },
    },
    {
      title: 'Antar penumpang',
      body:
        '<p>Penumpang datang ke halte secara acak. Waktu tunggu setiap penumpang dihitung sejak ia tiba di halte sampai naik ke shuttle. Rata-ratanya tampil di panel Statistik misi.</p>' +
        '<p>Halte yang tidak punya penumpang untuk naik atau turun dilewati saja supaya waktu tidak terbuang. Kalau shuttle penuh, penumpang di halte menunggu putaran berikutnya.</p>' +
        '<p>Kamu bisa memilih halte yang dilayani. Pakai alat <strong>Pilih halte</strong>, lalu klik atau ketuk halte (atau namanya) di peta. Bisa juga lewat sakelar di panel Halte. Putaran menjadi lebih pendek, tetapi calon penumpang di halte itu dan yang menuju ke sana membatalkan perjalanan. Penumpang yang sudah di dalam shuttle tetap diantar.</p>' +
        '<p class="note">Pakai kecepatan simulasi 2x kalau ingin lebih cepat.</p>',
      task: { id: 'deliver-10', text: 'Antar total 10 penumpang. Pantau angka <strong>Penumpang diantar</strong> di panel Statistik misi.' },
    },
    {
      title: 'Satu putaran tanpa pelanggaran',
      body:
        '<p>Aturan keselamatan ditulis sebagai batas yang tidak boleh dilanggar. Shuttle berhenti di lampu merah, memberi jalan ke pejalan kaki, dan masuk persimpangan hanya kalau lintasannya tidak bersilangan dengan kendaraan lain. Karena itu angka <strong>Pelanggaran lampu merah</strong> seharusnya tetap 0.</p>' +
        '<p>Pengereman darurat berbeda: shuttle mengerem lebih keras dari 3 m/s² hanya kalau terpaksa. Tekan <strong>Tambah pejalan kaki</strong> (<kbd>J</kbd>) saat shuttle mendekati zebra cross. Pejalan kaki itu melangkah pada saat terakhir shuttle masih bisa berhenti. Di jalan kering, kalau shuttle melaju di atas sekitar 16 km/jam, angka <strong>Pengereman darurat</strong> bertambah. Kalau lebih pelan atau sedang hujan, rem biasa sudah cukup.</p>' +
        '<p>Satu putaran dihitung dari halte berikutnya sampai shuttle kembali ke halte itu. Kemajuannya tampil di <strong>Putaran sekarang</strong>.</p>',
      task: { id: 'clean-run', text: 'Biarkan shuttle menyelesaikan satu putaran penuh tanpa pelanggaran lampu merah.' },
    },
  ],
  summary:
    '<p>SHUTTLE 01 memakai semua lapisan yang sudah kamu pelajari:</p>' +
    '<ul><li><span class="chip chip-kamera">Sensor</span> LiDAR dan kamera mengumpulkan data di sekitar shuttle.</li>' +
    '<li><span class="chip chip-lidar">Persepsi dan lokalisasi</span> mengenali kendaraan, pejalan kaki, dan warna lampu, lalu menentukan ruas dan lajur tempat shuttle berada.</li>' +
    '<li><span class="chip chip-radar">Perencanaan</span> memakai A* untuk rute antarhalte dan aturan tegas untuk keputusan: melaju, mengikuti, berhenti di lampu merah, memberi jalan, atau menepi di halte.</li>' +
    '<li><span class="chip chip-ultrasonik">Kendali</span> mengubah keputusan menjadi sudut setir (pure pursuit) serta gas dan rem.</li></ul>' +
    '<p>Saat jalan ditutup, rute dihitung ulang. Saat hujan, shuttle melambat dan menjaga jarak lebih jauh.</p>' +
    '<p class="note">Banyak hal di sini disederhanakan. Persepsi dianggap tepat untuk objek dalam jangkauan sensor, posisi shuttle dianggap diketahui, lampu lalu lintas berganti dengan waktu tetap, dan penumpang muncul secara acak. Waktu naik dan turun penumpang dibuat lebih singkat dari aslinya. Aturan persimpangannya juga sederhana: kendaraan hanya masuk kalau lintasannya tidak bersilangan dengan kendaraan yang sudah ada di dalam. Di layar kecil, gambar kendaraan sedikit dibesarkan. Shuttle otonom sungguhan di kampus atau kawasan wisata umumnya melaju sekitar 15 sampai 25 km/jam dan masih dipantau operator.</p>',

  styles: `
    .lesson-shuttle .sh-grp-brain { grid-column: span 2; }
    .lesson-shuttle .sh-brain { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0; list-style: none; }
    .lesson-shuttle .sh-brain li { display: grid; grid-template-columns: 96px minmax(0, 1fr); align-items: baseline; gap: 10px; padding: 7px 10px;
      border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg); }
    .lesson-shuttle .sh-brain li.is-alert { border-color: rgba(239, 68, 68, .6); background: rgba(239, 68, 68, .08); }
    .lesson-shuttle .sh-layer { display: inline-flex; align-items: center; gap: 7px; color: var(--c); font-size: .8rem; font-weight: 750; white-space: nowrap; }
    .lesson-shuttle .sh-layer::before { content: ''; flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--c); }
    .lesson-shuttle .sh-text { min-height: 1.4em; color: var(--text-soft); font-size: .88rem; line-height: 1.4; }
    .lesson-shuttle .sh-seats { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 4px; margin-top: 2px; }
    .lesson-shuttle .sh-seat { aspect-ratio: 1; max-width: 18px; border: 1.5px solid var(--border); border-radius: 50%; }
    .lesson-shuttle .sh-seat.is-on { border-color: rgba(11, 18, 32, .6); background: var(--c); }
    .lesson-shuttle .sh-seat-label { display: flex; justify-content: space-between; color: var(--muted); font-size: .76rem; font-weight: 600; }
    .lesson-shuttle .sh-row .btn { flex: 1 1 150px; min-height: 44px; }
    .lesson-shuttle .sh-legend { margin-top: 2px; }
    @media (max-width: 900px) {
      .lesson-shuttle .sh-grp-brain { grid-column: auto; }
    }
    @media (max-width: 600px) {
      .lesson-shuttle .sh-brain li { grid-template-columns: 84px minmax(0, 1fr); gap: 8px; padding: 7px 9px; }
      .lesson-shuttle .sh-text { font-size: .84rem; }
    }
  `,

  mount(ctx) {
    // ---------- model ----------
    const api = createWorld();
    const { W, sh } = api;
    let tool = 'tutup';
    let camMode = 'peta';
    const cam = { x: sh.x, y: sh.y };
    const holds = {};
    let rerouteNote = null; // { text, until }

    // ---------- kanvas dan loop ----------
    const labels = createLabelLayer();
    const labelRects = new Map(); // kotak label halte di layar (px), diisi saat menggambar
    const staticLayer = createStaticLayer();
    const view = ctx.createView({
      label: 'Peta kawasan kampus dari atas. Shuttle otonom hijau toska melayani lima halte, dengan lampu lalu lintas, zebra cross, pejalan kaki, dan mobil lain.',
      background: COLORS.ground,
      bounds: () => MAP_BOUNDS,
      padding: 10,
    });

    const loop = ctx.createLoop({
      update(dt) {
        api.update(dt);
      },
      render,
    });

    // ---------- panel: lapisan otak ----------
    const brainGroup = ui.group(ctx.controls, { title: 'Lapisan otak shuttle', className: 'sh-grp-brain' });
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
      label: 'Kecepatan maksimum',
      min: 10,
      max: 30,
      step: 1,
      value: W.limitKmh,
      unit: 'km/jam',
      hint: 'Batas kecepatan kampus yang diikuti shuttle dan mobil lain.',
      onInput: (v) => api.setLimit(v),
    });
    const pedRow = ui.buttonRow(condGroup, { className: 'sh-row' });
    ui.button(pedRow, { label: 'Tambah pejalan kaki', icon: 'hand', kbd: 'J', onClick: () => addPedestrian() });

    // ---------- panel: peta kampus ----------
    const mapGroup = ui.group(ctx.controls, { title: 'Peta kampus' });
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
    ui.button(roadRow, { label: 'Tutup ruas di depan', icon: 'lock', onClick: () => closeAhead() });
    ui.button(roadRow, { label: 'Buka semua jalan', icon: 'reset', onClick: () => openAll() });
    const camCtl = ui.segmented(mapGroup, {
      label: 'Tampilan',
      options: [
        { value: 'peta', label: 'Seluruh kampus' },
        { value: 'ikuti', label: 'Ikuti shuttle' },
      ],
      value: camMode,
      onChange: (v) => setCamMode(v),
    });
    ui.legend(mapGroup, [
      { color: COLORS.path, label: 'Rute shuttle', shape: 'line' },
      { color: '#f87171', label: 'Rute lama', shape: 'line' },
      { color: COLORS.lidar, label: 'Titik LiDAR', shape: 'dot' },
    ]).classList.add('sh-legend');

    // ---------- panel: halte ----------
    const halteGroup = ui.group(ctx.controls, { title: 'Halte' });
    const halteToggles = HALTE.map((H) =>
      ui.toggle(halteGroup, { label: H.name, color: H.color, checked: true, onChange: (on) => setHalte(H.index, on) }),
    );

    // ---------- panel: statistik ----------
    const statGroup = ui.group(ctx.controls, { title: 'Statistik misi' });
    const statGrid = ui.readoutGrid(statGroup);
    const out = {
      delivered: ui.readout(statGrid, { label: 'Penumpang diantar', value: '0' }),
      distance: ui.readout(statGrid, { label: 'Jarak tempuh', value: '0 m' }),
      time: ui.readout(statGrid, { label: 'Waktu misi', value: '0 detik' }),
      wait: ui.readout(statGrid, { label: 'Rata-rata waktu tunggu', value: '-' }),
      violations: ui.readout(statGrid, { label: 'Pelanggaran lampu merah', value: '0' }),
      emergencies: ui.readout(statGrid, { label: 'Pengereman darurat', value: '0' }),
      loops: ui.readout(statGrid, { label: 'Putaran selesai', value: '0' }),
      loopNow: ui.readout(statGrid, { label: 'Putaran sekarang', value: '-' }),
    };
    const seatLabel = ui.el('div', { class: 'sh-seat-label' }, ui.el('span', { text: 'Di dalam shuttle' }), ui.el('span', { text: '0/12' }));
    const seats = ui.el('div', { class: 'sh-seats', role: 'img', 'aria-label': 'Kursi shuttle' });
    const seatEls = [];
    for (let i = 0; i < CAPACITY; i++) {
      const s = ui.el('span', { class: 'sh-seat' });
      seats.append(s);
      seatEls.push(s);
    }
    statGroup.append(seatLabel, seats);

    // ---------- HUD ----------
    const speedChip = ui.hudChip(ctx.hud, { label: 'Shuttle', color: COLORS.accent });
    const targetChip = ui.hudChip(ctx.hud, { label: 'Menuju', color: COLORS.path });
    const gapChip = ui.hudChip(ctx.hud, { label: 'Jarak ke depan', color: COLORS.radar });
    const rainChip = ui.hudChip(ctx.hud, { label: 'Cuaca', color: RAIN_COLOR });

    ctx.keys({ j: () => addPedestrian() });

    // ---------- interaksi kanvas ----------
    // halte kena ketuk: gedung halte, atau label namanya
    function halteHit(e) {
      const H = halteAt(e.x, e.y, e.hitRadius);
      if (H) return H;
      for (const [i, r] of labelRects) {
        if (e.sx >= r.left - 4 && e.sx <= r.left + r.w + 4 && e.sy >= r.top - 4 && e.sy <= r.top + r.h + 4) return HALTE[i];
      }
      return null;
    }

    view.onPointer({
      tap(e) {
        if (tool === 'tutup') {
          const R = roadAt(e.x, e.y, e.hitRadius);
          if (R) toggleRoad(R.id);
          else if (halteHit(e)) ctx.toast('Untuk memilih halte, ganti alat ke Pilih halte.', { tone: 'info' });
        } else {
          const H = halteHit(e);
          if (H) {
            halteToggles[H.index].set(!W.active[H.index]);
            setHalte(H.index, !W.active[H.index]);
          } else if (roadAt(e.x, e.y, e.hitRadius)) ctx.toast('Untuk menutup jalan, ganti alat ke Tutup jalan.', { tone: 'info' });
        }
        refreshPanels(0);
      },
      move(e) {
        const hit = tool === 'tutup' ? roadAt(e.x, e.y, e.hitRadius) : halteHit(e);
        view.setCursor(hit ? 'pointer' : 'default');
      },
    });

    view.onResize(() => {
      if (camMode === 'ikuti') view.setScale(followScale());
    });

    // ---------- aksi ----------
    function setTool(v) {
      tool = v;
      toolCtl.set(v);
      toolHint.textContent =
        v === 'tutup'
          ? 'Klik atau ketuk ruas jalan untuk menutup atau membukanya. Paling banyak 2 ruas.'
          : 'Klik atau ketuk halte untuk berhenti atau mulai melayaninya. Minimal dua halte tetap dilayani.';
    }

    function setWeather(w) {
      api.setWeather(w);
      rainToggle.set(w === 'hujan');
      if (ctx.paused) api.rig.scanNow(api.sensorObjects, w);
    }

    function followScale() {
      const fit = Math.min((view.width - 20) / (MAP_BOUNDS.maxX - MAP_BOUNDS.minX), (view.height - 20) / (MAP_BOUNDS.maxY - MAP_BOUNDS.minY));
      return clamp(fit * 1.6, 3.2, 6.5);
    }

    function setCamMode(mode) {
      camMode = mode;
      camCtl.set(mode);
      if (mode === 'peta') view.fit(() => MAP_BOUNDS);
      else {
        view.fit(null);
        view.setScale(followScale());
        cam.x = sh.x;
        cam.y = sh.y;
        clampCamera();
      }
    }

    function clampCamera() {
      const hw = view.width / 2 / view.camera.scale;
      const hh = view.height / 2 / view.camera.scale;
      const x = clamp(cam.x, EXT.minX + hw, EXT.maxX - hw);
      const y = clamp(cam.y, EXT.minY + hh, EXT.maxY - hh);
      view.centerOn(x, y);
    }

    function describeToggle(r) {
      if (!r.ok) {
        ctx.toast(r.msg, { tone: 'warn' });
        return;
      }
      if (!r.closed) {
        ctx.toast(r.msg, { tone: 'info' });
        rerouteNote = null;
        return;
      }
      const name = r.road.name;
      if (r.rerouted) {
        const t = HALTE[api.sh.target ?? 0];
        rerouteNote = {
          text: r.target !== r.prevTarget && r.target != null ? `Halte ${HALTE[r.prevTarget].name} tidak bisa dicapai karena ${name} ditutup, jadi shuttle lanjut ke ${t.name}` : `Rute baru karena ${name} ditutup`,
          until: W.time + 10,
        };
      } else if (r.onCommitted) {
        const more = sh.route.ids.length > api.committedIds().length;
        ctx.toast(
          `${name} ditutup. Shuttle sudah berada di ruas ini, jadi ia tetap keluar lewat ujungnya. ${more ? 'Coba tutup ruas lain yang dilewati garis rute.' : 'Rute sekarang belum melewati persimpangan, jadi tunggu sampai shuttle menuju halte berikutnya.'}`,
          { tone: 'info', duration: 5000 },
        );
      }
      else if (!r.onRoute) ctx.toast(`${name} ditutup. Ruas ini tidak ada di rute shuttle sekarang, jadi rutenya tetap.`, { tone: 'info' });
    }

    function toggleRoad(id) {
      describeToggle(api.toggleRoad(id));
    }

    function closeAhead() {
      describeToggle(api.closeAhead());
      refreshPanels(0);
    }

    function openAll() {
      const r = api.openAll();
      if (r.ok) ctx.toast(`Semua jalan dibuka lagi.${r.back != null ? ` Shuttle kembali melayani halte ${HALTE[r.back].name}.` : ''}`, { tone: 'info' });
      rerouteNote = null;
      refreshPanels(0);
    }

    function setHalte(i, on) {
      const r = api.setActive(i, on);
      if (!r.ok) {
        halteToggles[i].set(true);
        ctx.toast(r.msg, { tone: 'warn' });
      } else if (!on && r.left) ctx.toast(`Halte ${HALTE[i].name} tidak dilayani. ${fmt(r.left)} calon penumpang membatalkan perjalanan.`, { tone: 'info' });
      refreshPanels(0);
    }

    function addPedestrian() {
      const r = api.addPedestrian();
      if (!r.ok) ctx.toast(r.msg, { tone: 'warn' });
      else if (!r.onRoute) ctx.toast(`Pejalan kaki muncul di zebra cross ${r.zebra.name}. Zebra cross itu tidak ada di rute shuttle sekarang.`, { tone: 'info' });
      else pedNote = { text: `Pejalan kaki akan menyeberang mendadak di zebra cross ${r.zebra.name}.`, until: W.time + 6 };
    }
    let pedNote = null;

    // ---------- teks lapisan otak ----------
    function decisionText() {
      const d = sh.dec || { code: 'melaju' };
      const i = d.info || {};
      const n = i.node?.name;
      if (W.time - sh.emergencyAt < 1.6) return { text: `Rem darurat, perlambatan lebih dari ${fmt(EMERGENCY_DECEL)} m/s². ${d.code === 'pejalan' ? 'Pejalan kaki menyeberang mendadak.' : 'Ada rintangan dekat di depan.'}`, alert: true };
      switch (d.code) {
        case 'dwell': {
          const D = sh.dwell;
          const phase = !D ? '' : D.phase === 'buka' ? 'pintu dibuka' : D.phase === 'turun' ? 'penumpang turun' : D.phase === 'naik' ? 'penumpang naik' : 'pintu ditutup';
          return { text: `Berhenti di halte ${i.halte?.name ?? ''}, ${phase}.` };
        }
        case 'halte':
          return { text: `Menepi ke halte ${i.halte.name}.` };
        case 'merah':
          return { text: `Berhenti, lampu merah di ${n}.` };
        case 'kuning':
          return { text: 'Berhenti, lampu kuning dan masih sempat mengerem dengan nyaman.' };
        case 'kuning-terus':
          return { text: 'Terus, lampu kuning tetapi sudah terlalu dekat untuk berhenti dengan nyaman.' };
        case 'silang':
          return { text: `Menunggu, ada kendaraan yang sedang melintas di ${n}.` };
        case 'penuh':
          return { text: `Menunggu, lajur setelah ${n} masih penuh.` };
        case 'simpang':
          return { text: `Melambat, ${n} tidak berlampu.` };
        case 'lewat':
          return { text: `Melewati ${n}${i.node?.signal ? ', lampu hijau' : ', lintasannya bebas'}.` };
        case 'belok':
          return { text: `Melambat untuk berbelok, jari-jari tikungan sekitar ${fmt(i.radius, 0)} m.` };
        case 'ikuti': {
          const P = api.params(sh);
          return { text: `Mengikuti mobil di depan. Jarak ${meters(i.gap)}, sasaran ${fmt(P.g0 + sh.speed * P.tau, 0)} m (${fmt(P.g0)} m + ${fmt(P.tau, P.tau % 1 ? 1 : 0)} detik × kecepatan).` };
        }
        case 'pejalan':
          return { text: i.waiting ? 'Memberi jalan, ada pejalan kaki menunggu di zebra cross.' : 'Berhenti, pejalan kaki sedang menyeberang.' };
        case 'antre':
          return { text: 'Berhenti sebelum zebra cross supaya tidak menutupinya.' };
        case 'buntu':
          return { text: 'Berhenti, tidak ada halte yang bisa dicapai. Buka salah satu jalan.', alert: true };
        default:
          if (d.near && d.near.d < 30 && (d.near.code === 'merah' || d.near.code === 'pejalan')) return { text: d.near.code === 'merah' ? 'Mendekati lampu merah, bersiap mengerem.' : 'Mendekati zebra cross yang ada pejalan kakinya.' };
          return { text: `Melaju, kecepatan target ${kmh(api.params(sh).v0)}.` };
      }
    }

    function layerTexts() {
      const lidar = api.rig.get('lidar');
      const lr = api.rig.reading('lidar');
      const range = lidar.effectiveRange(W.weather);
      const camDet = api.rig.detections('kamera');
      const t = {};
      t.sensor = `LiDAR ${fmt(lr ? lr.points.length : 0)} titik dalam ${fmt(range, 0)} m, kamera ${fmt(camDet.length)} objek.${W.weather === 'hujan' ? ' Hujan memperpendek jangkauan.' : ''}`;

      // persepsi: objek penting dari deteksi LiDAR, warna lampu dari kamera
      let cars = 0;
      let peds = 0;
      for (const d of api.rig.detections('lidar')) {
        if (d.target?.kind === 'pedestrian') peds++;
        else if (d.target?.kind === 'car' && d.target.label !== 'Mobil parkir') cars++;
      }
      const parts = [];
      if (cars) parts.push(`${fmt(cars)} mobil`);
      if (peds) parts.push(`${fmt(peds)} pejalan kaki`);
      let lightText = '';
      const seg = sh.route.segs.find((sg) => sg.move && sg.link.light && sg.s1 - api.front(sh) > -0.2);
      if (seg) {
        const dist = seg.s1 - api.front(sh);
        const seen = camDet.find((d) => d.target === seg.link.light && d.color);
        if (dist < 60) lightText = seen ? `lampu ${COLOR_WORDS[seen.color]} ${meters(dist)} di depan` : `lampu ${meters(dist)} di depan belum terbaca`;
      }
      if (lightText) parts.push(lightText);
      t.persepsi = parts.length ? `${parts.join(', ')}.` : 'Tidak ada kendaraan atau pejalan kaki di sekitar.';
      t.persepsi = t.persepsi.charAt(0).toUpperCase() + t.persepsi.slice(1);

      const pos = W.linkPos(sh);
      if (pos.inBox) t.lokalisasi = `Di dalam ${pos.node.name}, masuk ke ${pos.link.road.name}.`;
      else {
        const toNode = pos.link.length - pos.sFront;
        t.lokalisasi = toNode < 1 ? `${pos.link.road.name}, lajur kiri, tepat di depan ${pos.link.to.name}.` : `${pos.link.road.name}, lajur kiri, ${meters(toNode)} lagi ke ${pos.link.to.name}.`;
      }

      if (sh.target == null) t.rute = 'Tidak ada rute ke halte mana pun.';
      else {
        const H = HALTE[sh.target];
        const sS = W.stopS();
        const dist = sS == null ? 0 : sS - api.front(sh);
        t.rute = `Menuju ${H.name}, ${meters(dist)}.`;
        const skipped = [...W.unreachable].filter((k) => W.active[k]).map((k) => HALTE[k].name);
        if (rerouteNote && W.time < rerouteNote.until) t.rute += ` ${rerouteNote.text}.`;
        else if (skipped.length) t.rute += ` Halte ${skipped.join(' dan ')} dilewati karena jalannya ditutup.`;
        else if (W.lastSearch && !W.lastSearch.trivial && W.lastSearch.expanded) t.rute += ` A* memeriksa ${fmt(W.lastSearch.expanded)} keadaan.`;
      }
      const dec = decisionText();
      t.keputusan = dec.text;
      t.keputusanAlert = !!dec.alert;
      const deg = radToDeg(sh.steer);
      const steer = Math.abs(deg) < 1 ? 'setir lurus' : `setir ${fmt(Math.abs(deg), 0)}° ke ${deg > 0 ? 'kanan' : 'kiri'}`;
      const a = sh.cmdAccel;
      const pedal = sh.speed < 0.05 && a <= 0 ? 'rem ditahan' : a > 0.05 ? `gas ${fmt(a, 1)} m/s²` : a < -0.05 ? `rem ${fmt(-a, 1)} m/s²` : 'kecepatan tetap';
      t.kendali = `${kmh(sh.speed)}, ${steer}, ${pedal}.`;
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
      out.distance.set(fmt(S.distance, 0, 'm'));
      out.time.set(seconds(S.time));
      out.wait.set(S.waitN ? fmt(S.waitSum / S.waitN, 1, 'detik') : '-');
      out.violations.set(fmt(S.violations));
      out.violations.setTone(S.violations ? 'danger' : 'ok');
      out.emergencies.set(fmt(S.emergencies));
      out.emergencies.setTone(S.emergencies ? 'warn' : '');
      const L = W.loop;
      out.loops.set(fmt(S.loops));
      out.loopNow.set(L && L.start != null ? `${fmt(Math.min(L.count + 1, HALTE.length))}/${fmt(HALTE.length)} halte` : 'belum mulai');
      seatLabel.lastChild.textContent = `${fmt(sh.onboard.length)}/${fmt(CAPACITY)}`;
      seatEls.forEach((el, k) => {
        const p = sh.onboard[k];
        el.classList.toggle('is-on', !!p);
        el.style.setProperty('--c', p ? HALTE[p.to].color : 'transparent');
      });
      seats.setAttribute('aria-label', `${fmt(sh.onboard.length)} dari ${fmt(CAPACITY)} kursi terisi`);

      HALTE.forEach((H, k) => {
        const q = W.queues[k].length;
        const hint = !W.active[k] ? 'Tidak dilayani' : W.unreachable.has(k) ? 'Jalannya ditutup' : q ? `${fmt(q)} menunggu` : 'Belum ada yang menunggu';
        halteToggles[k].setHint(hint);
      });
      rainToggle.setHint(
        W.weather === 'hujan'
          ? `Batas ${fmt(W.limitKmh * RAIN_FACTOR, 0)} km/jam, jarak waktu 3 detik`
          : `Batas ${fmt(W.limitKmh)} km/jam, jarak waktu 1,5 detik`,
      );

      speedChip.set(kmh(sh.speed));
      targetChip.show(sh.target != null);
      if (sh.target != null) targetChip.set(HALTE[sh.target].name);
      const lead = sh.dec?.lead;
      const showGap = lead && !lead.ped && lead.gap < 45 && sh.mode === 'drive';
      gapChip.show(!!showGap);
      if (showGap) gapChip.set(meters(lead.gap));
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
        else if (ev.type === 'violation') ctx.toast('Shuttle melanggar lampu merah. Ini seharusnya tidak terjadi.', { tone: 'warn' });
      }
      W.events.length = 0;
    }

    function checkTasks(realDt) {
      const id = currentTask();
      if (!id || ctx.isTaskDone(id)) return;
      if (id === 'closure' && holds.reroute != null) {
        // beri waktu sebentar supaya pelajar sempat melihat rute baru
        holds.reroute += realDt;
        if (holds.reroute > 1.2) done('closure');
      }
      if (id === 'rain') {
        const limit = api.params(sh).v0;
        const ok = W.weather === 'hujan' && sh.mode === 'drive' && sh.speed > 0.8 && sh.speed <= limit + 0.3;
        holds.rain = ok ? (holds.rain || 0) + realDt : 0;
        if (holds.rain >= 2.5) done('rain');
      }
      if (id === 'deliver-10' && W.stats.delivered >= 10) done('deliver-10');
    }

    // ---------- baris status ----------
    function updateStatus(t) {
      let first = t.keputusan;
      if (pedNote && W.time < pedNote.until) first = pedNote.text;
      const second = sh.target != null ? t.rute.split('. ')[0].replace(/\.$/, '') : 'Tidak ada rute';
      ctx.setStatus(`${first} ${second}.`);
    }

    // ---------- menggambar ----------
    // Label SHUTTLE 01 dicoba berurutan di sisi kanan shuttle (sisi jalan, menjauhi label halte
    // di trotoar), di depan, di belakang, lalu di sisi kiri. Dipakai tempat pertama yang muat utuh
    // di kanvas dan tidak tertutup chip HUD. Jaraknya berubah halus mengikuti arah shuttle.
    function shuttleLabelOffset(narrow) {
      const px = view.camera.scale * vehicleScale(view);
      const halfW = narrow ? 38 : 42;
      const halfH = narrow ? 9 : 9.5;
      const p = view.worldToScreen(sh.x, sh.y);
      const c = Math.cos(sh.heading);
      const sn = Math.sin(sh.heading);
      const cands = [
        [-sn, c, sh.width / 2],
        [c, sn, sh.length / 2],
        [-c, -sn, sh.length / 2],
        [sn, -c, sh.width / 2],
      ];
      // kotak label halte dari frame sebelumnya: tempat yang menimpanya dihindari
      const hitsHalte = (cx, cy) => {
        for (const r of labelRects.values()) {
          if (cx + halfW > r.left - 2 && cx - halfW < r.left + r.w + 2 && cy + halfH > r.top - 2 && cy - halfH < r.top + r.h + 2) return true;
        }
        return false;
      };
      let first = null;
      let inside = null;
      for (const [ux, uy, half] of cands) {
        const d = Math.abs(ux) * halfW + Math.abs(uy) * halfH + half * px + 3;
        const o = { dx: ux * d, dy: uy * d };
        if (!first) first = o;
        const cx = p.x + o.dx;
        const cy = p.y + o.dy;
        if (cx - halfW >= 2 && cx + halfW <= view.width - 2 && cy - halfH >= 62 && cy + halfH <= view.height - 2) {
          if (!hitsHalte(cx, cy)) return o;
          if (!inside) inside = o;
        }
      }
      return inside || first;
    }

    let lastFrame = 0;
    function render() {
      const now = performance.now();
      const realDt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0;
      lastFrame = now;
      if (camMode === 'ikuti') {
        const k = Math.min(1, realDt * 3);
        const tx = sh.x + Math.cos(sh.heading) * 10;
        const ty = sh.y + Math.sin(sh.heading) * 10;
        cam.x += (tx - cam.x) * k;
        cam.y += (ty - cam.y) * k;
        clampCamera();
      }
      const narrow = view.width < 600;
      const g = view.begin(COLORS.ground);
      // label shuttle ditambahkan pertama supaya tetap menempel di shuttle (label lain yang digeser)
      labels.add(sh.x, sh.y, 'SHUTTLE 01', { color: COLORS.accent, size: narrow ? 10 : 11, ...shuttleLabelOffset(narrow) });
      staticLayer.draw(g, view);
      drawDynamic(g, view, api, { time: loop.time, labels, narrow, labelRects });
      drawWeather(g, view, W.weather, loop.time);
      drawSensorOverlay(g, view, api);
      labels.draw(g, view);
      drawScaleBar(g, view);

      if (now - lastPanel > 125) {
        refreshPanels(lastPanel ? Math.min(0.5, (now - lastPanel) / 1000) : 0);
        lastPanel = now;
      }
    }

    // tampilan awal: di layar tegak, kamera mengikuti shuttle supaya kendaraan tidak terlalu kecil
    setTool('tutup');
    if (view.aspect < 1.2) setCamMode('ikuti');

    // ---------- antarmuka ke shell ----------
    return {
      onStep(i) {
        const preset = STEP_PRESETS[i];
        if (!preset) return;
        if (preset.weather) setWeather(preset.weather);
        if (preset.tool) setTool(preset.tool);
        if (preset.openRoads && W.closed.size) api.openAll();
        if (preset.leader) {
          if (!W.leaderCar) api.placeLeader();
        } else api.releaseLeader();
        if (preset.loopReset) api.resetLoop();
        if (i === 0 && !ctx.isTaskDone('first-stop') && sh.target != null) api.seedPassengers(sh.target, 2);
        for (const k of Object.keys(holds)) delete holds[k];
        rerouteNote = null;
        refreshPanels(0);
      },
      reset() {
        api.reset();
        for (const k of Object.keys(holds)) delete holds[k];
        rerouteNote = null;
        pedNote = null;
        cam.x = sh.x;
        cam.y = sh.y;
        if (ctx.currentStep() === 2) api.placeLeader();
        refreshPanels(0);
      },
      destroy() {
        // Kanvas, loop, keyboard, dan listener dibersihkan otomatis oleh ctx.
      },
    };
  },
};
