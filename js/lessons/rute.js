// Pelajaran 5: Perencanaan Rute.
//
// Peta kota grid (./rute/city.js), A* dan Dijkstra dari engine/planning.js yang dijalankan
// selangkah demi selangkah supaya pencariannya terlihat, dan mobil yang mengikuti rute di lajur
// kiri (./rute/car.js). Pelajar bisa menutup jalan, menandai macet, dan memindahkan start atau
// tujuan. Saat mobil melaju, penutupan jalan di depan memicu hitung ulang rute dari posisi mobil.
//
// Pola mengikuti pelajaran contoh sensor.js: teks di objek default, model di folder pelajaran,
// satu loop terkelola, panel diperbarui sekitar 8 kali per detik dari render(), dan tugas
// dideteksi dari keadaan simulasi untuk langkah yang sedang dibuka saja.

import { COLORS, FONT, withAlpha } from '../engine/theme.js';
import { fmt } from '../engine/math.js';
import { createSearch } from '../engine/planning.js';
import { drawCar, drawPath, drawScaleBar, roundRectPath, createLabelLayer } from '../engine/draw.js';
import * as ui from '../engine/ui.js';
import { createCity, CELL, MAP_W, MAP_H, FREE_SPEED, JAM_FACTOR, MAP_COLORS } from './rute/city.js';
import { createCar, LANE_OFFSET } from './rute/car.js';

const TIME_LAPSE = 5; // gerak mobil di layar dipercepat 5 kali
// Pemecah seri: heuristik dikali (1 + TIE) supaya di antara node dengan f sama, node yang lebih
// dekat ke tujuan diperiksa dulu. Semua biaya rute kelipatan 25, sedangkan tambahan ini paling
// banyak beberapa meter, jadi rute yang ditemukan tetap optimal.
const TIE = 1e-4;
const START0 = [1, 14];
const GOAL0 = [22, 1];
const ALGO_NAMES = { astar: 'A*', dijkstra: 'Dijkstra' };
const OPEN_COLOR = '#a78bfa';
const CLOSED_COLOR = '#60a5fa';
const PATH_COLOR = COLORS.path;
const GOAL_COLOR = COLORS.target;

const TOOL_HINTS = {
  tutup: 'Klik atau ketuk sel jalan untuk menutupnya. Ketuk sekali lagi untuk membukanya.',
  macet: 'Klik atau ketuk sel jalan untuk menandai macet. Seret untuk menandai beberapa sel sekaligus. Ketuk sel macet sekali lagi untuk menghapusnya.',
  pindah: 'Pilih Start atau Tujuan, lalu ketuk sel jalan tempat barunya. Penandanya juga bisa diseret.',
};

// Preset tiap langkah: algoritma, alat peta, dan apakah rute A* langsung disiapkan.
const STEP_PRESETS = [
  { algorithm: 'astar', tool: 'tutup', route: false },
  { algorithm: 'dijkstra', tool: 'tutup', route: false },
  { algorithm: 'astar', tool: 'tutup', route: true },
  { algorithm: 'astar', tool: 'macet', route: true },
  { algorithm: 'astar', tool: 'tutup', route: true },
];

const secs = (t) => fmt(t, Math.abs(t - Math.round(t)) > 0.05 ? 1 : 0, 'detik');
const meters = (m) => fmt(m, 0, 'm');

export default {
  id: 'rute',
  title: 'Perencanaan Rute',
  layout: 'sim',
  intro:
    '<p>Sebelum berangkat, mobil otonom harus tahu jalan mana yang akan dilewatinya. Tugas ini disebut <strong>perencanaan rute</strong>. Di pelajaran ini kamu menjalankan A* dan Dijkstra di peta kota berbentuk grid, lalu menutup jalan dan membuat macet untuk melihat rutenya berubah.</p>',
  steps: [
    {
      title: 'Mencari rute dengan A*',
      body:
        '<p>Bagi komputer, peta kota adalah sebuah <strong>graf</strong>. Setiap sel jalan menjadi satu <em>node</em> (simpul), dan node yang bersebelahan saling terhubung. Satu sel mewakili ruas jalan sepanjang 25 m. Biaya pindah ke sel berikutnya adalah waktu tempuhnya, yaitu 2,5 detik saat jalan lancar (36 km/jam).</p>' +
        '<p>A* selalu memeriksa node dengan nilai f paling kecil:</p>' +
        '<div class="formula">f(n) = g(n) + h(n)</div>' +
        '<ul><li><code>g(n)</code> adalah biaya sebenarnya dari start sampai node n.</li>' +
        '<li><code>h(n)</code> adalah <strong>heuristik</strong>, yaitu perkiraan sisa biaya ke tujuan. Di sini h memakai jarak Manhattan (jumlah langkah mendatar dan tegak) dikali biaya sel termurah.</li></ul>' +
        '<p>Sel <span class="chip chip-open">antrean</span> sudah ditemukan tetapi belum diperiksa. Sel <span class="chip chip-closed">dijelajahi</span> sudah diperiksa. Begitu tujuan diperiksa, A* menelusuri balik asal tiap node untuk mendapatkan <span class="chip chip-path">rute</span>.</p>',
      task: { id: 'first-route', text: 'Pastikan algoritma <strong>A*</strong> terpilih, lalu tekan <strong>Cari rute</strong> dan tunggu sampai rute ditemukan.' },
    },
    {
      title: 'A* dibanding Dijkstra',
      body:
        '<p>Dijkstra memeriksa node hanya menurut biaya dari start. Pencariannya melebar ke segala arah seperti riak air, termasuk ke arah yang menjauhi tujuan.</p>' +
        '<p>A* adalah Dijkstra yang ditambah heuristik. Kalau h selalu 0, A* bekerja persis seperti Dijkstra. Heuristik menarik pencarian ke arah tujuan, jadi A* biasanya memeriksa jauh lebih sedikit node.</p>' +
        '<p>Dijkstra selalu menemukan rute dengan waktu tempuh terkecil. A* juga, asalkan heuristiknya tidak pernah melebihi biaya sebenarnya (disebut <em>admissible</em>). Mobil di peta ini hanya bergerak mendatar dan tegak, dan biaya setiap langkah paling sedikit sama dengan biaya sel termurah, jadi jarak Manhattan dikali biaya sel termurah memenuhi syarat itu.</p>' +
        '<p>Heuristik ini juga <em>konsisten</em>: nilainya turun paling banyak sebesar biaya satu langkah. Karena itu A* tidak perlu memeriksa ulang node yang sudah dijelajahi.</p>' +
        '<p class="note">Kalau beberapa node punya nilai f yang sama, simulasi ini mendahulukan node yang lebih dekat ke tujuan. Rutenya tetap optimal.</p>',
      task: { id: 'compare', text: 'Jalankan <strong>Dijkstra</strong> dan <strong>A*</strong> dengan start dan tujuan yang sama, lalu bandingkan jumlah node dijelajahi di tabel Perbandingan.' },
    },
    {
      title: 'Jalan ditutup',
      body:
        '<p>Jalan bisa ditutup, misalnya karena perbaikan atau banjir. Di graf, sel yang ditutup dianggap hilang bersama semua sambungannya, jadi rute yang lewat sana tidak berlaku lagi.</p>' +
        '<p>Pilih alat <strong>Tutup jalan</strong>, lalu klik atau ketuk sel jalan di rute. Ketuk sekali lagi untuk membukanya kembali. Setelah itu cari rute baru.</p>' +
        '<p>Heuristik paling membantu kalau ada jalan yang cukup lurus ke tujuan. Kalau penutupan memaksa rute memutar jauh, misalnya ke jembatan lain, A* ikut memeriksa lebih banyak node dan keunggulannya atas Dijkstra berkurang.</p>',
      task: { id: 'closure', text: 'Tutup satu sel jalan yang dilewati rute sekarang, lalu tekan <strong>Cari rute</strong> lagi.' },
    },
    {
      title: 'Macet mengubah biaya',
      body:
        '<p>Mobil otonom biasanya mencari rute dengan <strong>waktu tempuh</strong> terkecil. Data lalu lintas dari peta digital memberi tahu ruas mana yang sedang padat.</p>' +
        '<p>Di simulasi ini, sel <span class="chip chip-jam">macet</span> punya biaya 5 kali lipat. Saat lancar, satu sel ditempuh dalam 2,5 detik. Saat macet, satu sel butuh 12,5 detik. Karena itu rute tercepat bisa lebih panjang dari rute terpendek.</p>' +
        '<p class="note">A* hanya menghindari macet kalau jalan memutarnya lebih cepat. Kalau memutarnya terlalu jauh, rute tetap lewat sel macet.</p>',
      task: { id: 'traffic', text: 'Pilih alat <strong>Macet</strong>, tandai beberapa sel di rute sekarang, lalu tekan <strong>Cari rute</strong> sampai rute baru menghindari sel macet itu.' },
    },
    {
      title: 'Hitung ulang saat melaju',
      body:
        '<p>Keadaan jalan bisa berubah ketika mobil sudah berangkat. Mobil otonom lalu menghitung ulang rute dari posisinya sekarang. Proses ini disebut <strong>perencanaan ulang</strong> atau <em>replanning</em>.</p>' +
        '<p>Pencarian ulang dimulai dari sel berikutnya yang akan dimasuki mobil, karena mobil tidak bisa berhenti mendadak di tengah ruas. Kalau rute baru mengharuskan berbalik arah, mobil putar balik ke kanan sesuai lalu lintas lajur kiri.</p>' +
        '<p class="note">Pencarian ulang langsung selesai tanpa animasi, karena untuk peta sekecil ini komputer menyelesaikannya dalam hitungan milidetik. Gerak mobil di layar dipercepat 5 kali.</p>',
      task: { id: 'replan-live', text: 'Tekan <strong>Jalankan mobil</strong>. Saat mobil melaju, tutup sel jalan di rute depannya dan lihat rutenya dihitung ulang.' },
    },
  ],
  summary:
    '<p>Perencanaan rute mencari jalan dengan biaya terkecil dari start ke tujuan pada graf jalan.</p>' +
    '<ul><li>Dijkstra memeriksa node menurut biaya dari start. Rutenya optimal, tetapi banyak node yang diperiksa ternyata tidak dipakai.</li>' +
    '<li>A* menambahkan heuristik h(n). Selama heuristik tidak melebihi biaya sebenarnya, rutenya tetap optimal dan node yang diperiksa biasanya jauh lebih sedikit.</li>' +
    '<li>Jalan yang ditutup menghapus node dari graf. Macet menaikkan biaya, sehingga rute tercepat bisa pindah ke jalan lain.</li>' +
    '<li>Saat keadaan berubah di tengah perjalanan, mobil menghitung ulang rute dari posisinya.</li></ul>' +
    '<p class="note">Peta ini disederhanakan menjadi grid dengan gerak empat arah. Sistem navigasi sungguhan memakai graf jalan yang memuat lajur, jalan satu arah, larangan belok, dan data lalu lintas yang terus diperbarui. Ukuran mobil di peta juga dibesarkan supaya terlihat. Rute di sini baru rencana tingkat jalan. Cara mobil mengikuti lintasan di lajurnya dengan mulus dibahas di pelajaran berikutnya.</p>',

  styles: `
    .lesson-rute .chip-open { --c: ${OPEN_COLOR}; }
    .lesson-rute .chip-closed { --c: ${CLOSED_COLOR}; }
    .lesson-rute .chip-path { --c: var(--accent); }
    .lesson-rute .chip-jam { --c: ${MAP_COLORS.jam}; }
    .lesson-rute .grp-compare { grid-column: span 2; }
    .lesson-rute .grp-compare tr.is-muted td { color: var(--muted); }
    .lesson-rute .compare-note { min-height: 2.6em; }
    .lesson-rute .algo-name { display: inline-flex; align-items: center; gap: 6px; font-weight: 700; }
    .lesson-rute .algo-name::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: var(--c); }
    .lesson-rute .ctl-row .btn { flex: 1 1 0; min-height: 44px; }
    .lesson-rute .quick-row .btn { min-height: 40px; }
    .lesson-rute .fgh .readout-value { font-size: 0.92rem; }
    .lesson-rute .fgh { grid-column: 1 / -1; }
    .lesson-rute .ctl-seg[hidden] { display: none; }
    @media (max-width: 900px) {
      .lesson-rute .grp-compare { grid-column: auto; }
    }
    @media (max-width: 600px) {
      .lesson-rute .grp-compare .data-table th, .lesson-rute .grp-compare .data-table td { padding: 7px 6px; }
      .lesson-rute .grp-compare .data-table thead th { white-space: normal; vertical-align: bottom; }
      .lesson-rute .grp-compare .data-table tbody th,
      .lesson-rute .grp-compare .data-table thead th:first-child { padding-left: 10px; }
    }
  `,

  mount(ctx) {
    // ---------- model ----------
    const city = createCity();
    const mover = createCar(city);
    const car = mover.car;
    const S0 = city.cellOf(...START0);
    const G0 = city.cellOf(...GOAL0);
    let start = S0;
    let goal = G0;
    let algorithm = 'astar';
    let tool = 'tutup';
    let moveTarget = 'start';
    let nodesPerSec = 30;
    let search = null; // pencarian beranimasi yang sedang berjalan
    let overlay = null; // sel antrean dan dijelajahi yang sedang ditampilkan
    let route = null; // rute aktif
    let lastResult = null; // hasil pencarian terakhir (untuk panel)
    let results = { astar: null, dijkstra: null }; // untuk tabel perbandingan
    let banner = null; // pesan di dekat mobil, { text, tone, until }
    let notice = null; // pesan singkat di baris status, { text, until }
    let hoverCell = -1;
    let drag = null;
    let flags = freshFlags();
    const holds = {};

    function freshFlags() {
      return { closedOnPath: new Set(), closureReplanned: false, jamOnPath: new Set(), jamAvoided: false, jamStillUsed: false, liveReplan: false };
    }

    const isDriving = () => car.state === 'driving' || car.state === 'blocked';
    const currentKey = () => `${start}>${goal}|${city.signature()}`;

    // ---------- kanvas dan loop ----------
    const labels = createLabelLayer();
    const layout = { narrow: false, mapTop: 0, mapBottom: 0, mapLeft: 0, mapRight: 0 };
    const view = ctx.createView({
      label: 'Peta kota berbentuk grid dengan jalan, sungai, dan tiga jembatan. Mobil otonom ada di start, bendera merah muda menandai tujuan.',
      background: MAP_COLORS.base,
      padding: 0,
      bounds: (v) => boundsFor(v),
    });

    // Letakkan peta di bawah pita HUD dan di atas pita legenda. Mengembalikan area dunia yang
    // tepat seluas kanvas, jadi skala dan posisi peta bisa diatur persis.
    function boundsFor(v) {
      const narrow = v.aspect < 1.2;
      const topPx = narrow ? 58 : 46;
      const botPx = narrow ? 70 : 34;
      const sidePx = narrow ? 6 : 12;
      const avail = Math.max(60, v.height - topPx - botPx);
      const s = Math.max(0.05, Math.min((v.width - 2 * sidePx) / MAP_W, avail / MAP_H));
      const topOff = topPx + Math.max(0, (avail - MAP_H * s) / 2);
      const worldW = v.width / s;
      const worldH = v.height / s;
      const minX = MAP_W / 2 - worldW / 2;
      const minY = -topOff / s;
      layout.narrow = narrow;
      layout.mapTop = topOff;
      layout.mapBottom = topOff + MAP_H * s;
      layout.mapLeft = (v.width - MAP_W * s) / 2;
      layout.mapRight = layout.mapLeft + MAP_W * s;
      return { minX, minY, maxX: minX + worldW, maxY: minY + worldH };
    }

    const loop = ctx.createLoop({ update, render });

    // ---------- panel kontrol ----------
    const searchGroup = ui.group(ctx.controls, { title: 'Pencarian rute' });
    const algoCtl = ui.segmented(searchGroup, {
      label: 'Algoritma',
      options: [
        { value: 'astar', label: 'A*' },
        { value: 'dijkstra', label: 'Dijkstra' },
      ],
      value: algorithm,
      onChange: (v) => setAlgorithm(v),
    });
    const speedCtl = ui.slider(searchGroup, {
      label: 'Kecepatan animasi',
      min: 5,
      max: 120,
      step: 5,
      value: nodesPerSec,
      format: (v) => `${fmt(v)} node/detik`,
      onInput: (v) => (nodesPerSec = v),
    });
    const searchRow = ui.buttonRow(searchGroup);
    const searchBtn = ui.button(searchRow, { label: 'Cari rute', icon: 'route', variant: 'primary', onClick: () => act(onSearchButton) });

    const toolGroup = ui.group(ctx.controls, { title: 'Alat peta' });
    const toolCtl = ui.segmented(toolGroup, {
      ariaLabel: 'Alat untuk mengubah peta',
      options: [
        { value: 'tutup', label: 'Tutup jalan' },
        { value: 'macet', label: 'Macet' },
        { value: 'pindah', label: 'Pindah' },
      ],
      value: tool,
      onChange: (v) => setTool(v),
    });
    const moveCtl = ui.segmented(toolGroup, {
      label: 'Yang dipindah',
      options: [
        { value: 'start', label: 'Start' },
        { value: 'goal', label: 'Tujuan' },
      ],
      value: moveTarget,
      onChange: (v) => (moveTarget = v),
    });
    const toolHint = ui.el('p', { class: 'ctl-hint', text: TOOL_HINTS[tool] });
    toolGroup.append(toolHint);
    const quickRow = ui.buttonRow(toolGroup, { className: 'quick-row' });
    const closeBtn = ui.button(quickRow, { label: 'Tutup ruas di rute', icon: 'lock', small: true, onClick: () => act(closeOnRoute) });
    const jamBtn = ui.button(quickRow, { label: 'Macet di rute', icon: 'gauge', small: true, onClick: () => act(jamOnRoute) });

    const carGroup = ui.group(ctx.controls, { title: 'Mobil otonom' });
    const driveRow = ui.buttonRow(carGroup);
    const driveBtn = ui.button(driveRow, { label: 'Jalankan mobil', icon: 'car', onClick: () => act(toggleDrive) });
    const carReadouts = ui.readoutGrid(carGroup);
    const carStateOut = ui.readout(carReadouts, { label: 'Keadaan', value: 'di start' });
    const carLeftOut = ui.readout(carReadouts, { label: 'Sisa waktu', value: '-' });
    carGroup.append(ui.el('p', { class: 'ctl-hint', text: `Mobil berjalan di lajur kiri. Gerak mobil di layar dipercepat ${TIME_LAPSE} kali.` }));

    const statGroup = ui.group(ctx.controls, { title: 'Hasil pencarian' });
    const statGrid = ui.readoutGrid(statGroup);
    const exploredOut = ui.readout(statGrid, { label: 'Node dijelajahi', value: '0', color: CLOSED_COLOR });
    const openOut = ui.readout(statGrid, { label: 'Di antrean', value: '0', color: OPEN_COLOR });
    const lengthOut = ui.readout(statGrid, { label: 'Panjang rute', value: '-' });
    const timeOut = ui.readout(statGrid, { label: 'Perkiraan waktu', value: '-' });
    const fghOut = ui.readout(statGrid, { label: 'Node terakhir: g + h = f', value: '-' });
    fghOut.el.classList.add('fgh');

    const compareGroup = ui.group(ctx.controls, { title: 'Perbandingan A* dan Dijkstra', className: 'grp-compare' });
    const compareTable = ui.dataTable(compareGroup, {
      caption: 'Perbandingan hasil A* dan Dijkstra untuk start, tujuan, dan peta yang sama',
      columns: [
        { key: 'algo', label: 'Algoritma' },
        { key: 'nodes', label: 'Node dijelajahi', align: 'right' },
        { key: 'len', label: 'Panjang rute', align: 'right' },
        { key: 'time', label: 'Waktu tempuh', align: 'right' },
      ],
    });
    const compareNote = ui.el('p', { class: 'ctl-hint compare-note' });
    compareGroup.append(compareNote);

    // HUD di atas kanvas
    const algoChip = ui.hudChip(ctx.hud, { label: 'Algoritma', color: COLORS.accent });
    const nodesChip = ui.hudChip(ctx.hud, { label: 'Dijelajahi', color: CLOSED_COLOR });
    const carChip = ui.hudChip(ctx.hud, { label: 'Mobil', color: COLORS.ego });

    // ---------- penunjuk di kanvas ----------
    view.onPointer({
      tap: (e) => handleTap(e),
      move(e) {
        if (drag) return;
        // sorotan sel hanya untuk mouse; di layar sentuh tidak ada hover
        hoverCell = e.pointerType === 'mouse' ? city.roadCellAt(e.x, e.y, 0) : -1;
        const onMarker = tool === 'pindah' && markerAt(e.x, e.y, e.hitRadius);
        view.setCursor(onMarker ? 'grab' : hoverCell >= 0 ? 'pointer' : 'default');
      },
      leave() {
        hoverCell = -1;
      },
    });
    // Seret hanya dipasang untuk alat Macet dan Pindah, supaya di ponsel kanvas tetap bisa digulir
    // saat alat Tutup jalan dipakai.
    let dragOff = null;
    const dragHandlers = {
      down(e) {
        if (tool === 'pindah') {
          const m = markerAt(e.x, e.y, e.hitRadius);
          drag = m ? { kind: 'marker', marker: m, x: e.x, y: e.y, moved: false } : null;
        } else if (tool === 'macet') {
          const cell = city.roadCellAt(e.x, e.y, e.hitRadius);
          drag = cell >= 0 && !city.closed[cell] ? { kind: 'paint', on: !city.jam[cell], first: cell, last: -1, started: false } : null;
        }
      },
      drag(e) {
        if (!drag) return;
        if (drag.kind === 'marker') {
          drag.x = e.x;
          drag.y = e.y;
          drag.moved = true;
          hoverCell = city.roadCellAt(e.x, e.y, e.hitRadius);
          view.setCursor('grabbing');
          return;
        }
        if (!drag.started) {
          drag.started = true;
          paintJam(drag.first, drag.on);
          drag.last = drag.first;
        }
        const cell = city.roadCellAt(e.x, e.y, 0);
        if (cell >= 0 && cell !== drag.last) {
          paintJam(cell, drag.on);
          drag.last = cell;
        }
      },
      up(e) {
        if (drag?.kind === 'marker' && drag.moved) {
          const cell = city.roadCellAt(e.x, e.y, e.hitRadius);
          moveMarker(drag.marker, cell);
        }
        drag = null;
      },
    };
    function syncDragHandler() {
      const want = tool === 'macet' || tool === 'pindah';
      if (want && !dragOff) dragOff = view.onPointer(dragHandlers);
      if (!want && dragOff) {
        dragOff();
        dragOff = null;
      }
    }

    function markerAt(x, y, radius) {
      const r = Math.max(CELL * 0.6, radius);
      const s = markerPos('start');
      const g = markerPos('goal');
      const ds = Math.hypot(x - s.x, y - s.y);
      const dg = Math.hypot(x - g.x, y - g.y);
      if (ds <= r && ds <= dg) return 'start';
      if (dg <= r) return 'goal';
      return null;
    }

    function markerPos(which) {
      if (which === 'start' && car.cells.length && !isDriving() && car.state !== 'arrived') return car.pose;
      return city.center(which === 'start' ? start : goal);
    }

    function handleTap(e) {
      const radius = e.hitRadius;
      if (tool === 'pindah') {
        const m = markerAt(e.x, e.y, e.hitRadius);
        if (m) {
          moveTarget = m;
          moveCtl.set(m);
          say(m === 'start' ? 'Start dipilih. Ketuk sel jalan tempat barunya.' : 'Tujuan dipilih. Ketuk sel jalan tempat barunya.');
          return;
        }
        moveMarker(moveTarget, city.roadCellAt(e.x, e.y, radius));
        return;
      }
      const cell = city.roadCellAt(e.x, e.y, radius);
      if (cell < 0) return;
      if (tool === 'tutup') toggleClosure(cell);
      else if (tool === 'macet') {
        if (city.closed[cell]) say('Jalan ini sedang ditutup. Buka dulu kalau mau menandainya macet.');
        else if (cell === start || cell === goal) say('Start dan tujuan tidak bisa ditandai macet.');
        else paintJam(cell, !city.jam[cell]);
      }
    }

    // ---------- aksi ----------
    // Di ponsel panel kontrol ada di bawah kanvas. Setelah tombol yang memulai sesuatu untuk
    // ditonton ditekan, gulir kanvas ke layar bila sebagian besar kanvas tidak terlihat.
    function act(fn) {
      fn();
      showStage();
    }

    function showStage() {
      if (!ctx.isMobile) return;
      const r = ctx.stage.getBoundingClientRect();
      const visible = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
      if (visible < r.height * 0.6) ctx.stage.scrollIntoView({ block: 'center', behavior: ctx.reducedMotion ? 'auto' : 'smooth' });
    }

    function say(text, seconds = 3) {
      notice = { text, until: performance.now() + seconds * 1000 };
      refreshPanels(0);
    }

    function setAlgorithm(v) {
      algorithm = v;
      algoCtl.set(v);
      refreshPanels(0);
    }

    function setTool(v) {
      tool = v;
      toolCtl.set(v);
      toolHint.textContent = TOOL_HINTS[v];
      moveCtl.el.hidden = v !== 'pindah';
      hoverCell = -1;
      drag = null;
      syncDragHandler();
    }

    function makeSearch(from, to) {
      const hScale = city.minCost();
      const s = createSearch(city.grid, from, to, {
        algorithm,
        heuristic: (a, b) => city.grid.heuristic(a, b) * hScale * (1 + TIE),
      });
      return { s, algorithm, hScale, from, to, key: currentKey(), acc: 0 };
    }

    function startSearch({ instant = false } = {}) {
      if (isDriving()) return;
      search = makeSearch(start, goal);
      overlay = { search: search.s, hScale: search.hScale, algorithm: search.algorithm, stale: false, flashUntil: null };
      route = null;
      banner = null;
      notice = null;
      mover.setRoute([start]);
      if (instant) {
        search.s.run();
        finishSearch();
      }
      refreshPanels(0);
    }

    function onSearchButton() {
      if (isDriving()) return;
      if (search) {
        // lewati animasi: selesaikan pencarian yang sama sekaligus
        search.s.run();
        finishSearch();
        refreshPanels(0);
        return;
      }
      startSearch();
    }

    function finishSearch() {
      const { s, key } = search;
      const res = { algorithm: search.algorithm, found: s.found, expanded: s.expanded, open: s.open.size, key, length: null, time: null };
      if (s.found) Object.assign(res, city.measure(s.path));
      results[search.algorithm] = res;
      lastResult = res;
      if (s.found) {
        route = { cells: s.path, algorithm: search.algorithm, key, stale: false, replanned: false, ...city.measure(s.path) };
        mover.setRoute(s.path);
        afterRouteFound(s.path);
      } else {
        route = null;
        mover.setRoute([start]);
      }
      search = null;
    }

    /** Periksa syarat tugas setelah ada rute baru. */
    function afterRouteFound(cells) {
      const still = [...flags.closedOnPath].filter((i) => city.closed[i]);
      if (still.length) flags.closureReplanned = true;
      const jammed = [...flags.jamOnPath].filter((i) => city.jam[i]);
      if (jammed.length) {
        const used = jammed.filter((i) => cells.includes(i));
        flags.jamStillUsed = used.length > 0;
        if (!used.length) flags.jamAvoided = true;
      }
    }

    function presetRoute() {
      const saved = algorithm;
      algorithm = 'astar';
      const job = makeSearch(start, goal);
      algorithm = saved;
      job.s.run();
      if (!job.s.found) return;
      route = { cells: job.s.path, algorithm: 'astar', key: job.key, stale: false, replanned: false, ...city.measure(job.s.path) };
      lastResult = { algorithm: 'astar', found: true, expanded: job.s.expanded, open: job.s.open.size, key: job.key, ...city.measure(job.s.path) };
      // catat juga di tabel perbandingan, supaya baris A* sesuai dengan rute yang terlihat
      results.astar = lastResult;
      mover.setRoute(job.s.path);
    }

    function toggleClosure(cell) {
      if (cell < 0) return;
      if (cell === start || cell === goal) {
        say('Start dan tujuan tidak bisa ditutup.');
        return;
      }
      const on = !city.closed[cell];
      if (on && isDriving()) {
        const i = mover.index();
        if (car.cells[i] === cell || car.cells[i + 1] === cell) {
          say('Sel ini terlalu dekat dengan mobil. Pilih jalan yang lebih jauh di depan.');
          return;
        }
      }
      const onRoute = !!route && route.cells.includes(cell);
      city.setClosed(cell, on);
      if (on && onRoute) flags.closedOnPath.add(cell);
      mapChanged(on ? 'close' : 'open', cell);
    }

    // Start dan tujuan tidak pernah macet. Dengan begitu waktu tempuh mobil di layar (setengah sel
    // start, sel-sel di antaranya, setengah sel tujuan) sama persis dengan perkiraan waktu rute.
    function paintJam(cell, on) {
      if (cell < 0 || cell === start || cell === goal || city.closed[cell] || !!city.jam[cell] === on) return;
      city.setJam(cell, on);
      if (on && route && route.cells.includes(cell)) flags.jamOnPath.add(cell);
      mapChanged(on ? 'jam' : 'unjam', cell);
    }

    function moveMarker(which, cell) {
      if (isDriving()) {
        say('Hentikan mobil dulu sebelum memindahkan start atau tujuan.');
        return;
      }
      if (cell < 0) return;
      if (city.closed[cell]) {
        say('Sel itu ditutup. Pilih sel jalan yang terbuka.');
        return;
      }
      if (city.jam[cell]) {
        say('Sel itu sedang macet. Pilih sel jalan yang lancar.');
        return;
      }
      if ((which === 'start' && cell === goal) || (which === 'goal' && cell === start)) {
        say('Start dan tujuan harus berada di sel yang berbeda.');
        return;
      }
      if (which === 'start') start = cell;
      else goal = cell;
      search = null;
      overlay = null;
      route = null;
      lastResult = null;
      banner = null;
      mover.setRoute([start]);
      say(which === 'start' ? 'Start dipindah. Tekan Cari rute untuk rute baru.' : 'Tujuan dipindah. Tekan Cari rute untuk rute baru.');
    }

    function mapChanged(kind, cell) {
      if (search) {
        search = null;
        overlay = null;
        say('Peta berubah, jadi pencarian dihentikan. Tekan Cari rute lagi.');
      }
      if (isDriving()) {
        liveChange(kind, cell);
      } else {
        if (route) route.stale = true;
        if (overlay) overlay.stale = true;
      }
      refreshPanels(0);
    }

    // ---------- mobil ----------
    function toggleDrive() {
      if (isDriving()) {
        stopDriving();
        return;
      }
      if (search) {
        search.s.run();
        finishSearch();
      }
      if (!route || route.stale || route.replanned || route.key !== currentKey()) startSearch({ instant: true });
      if (!route) {
        say('Tidak ada rute ke tujuan. Buka lagi jalan yang ditutup.');
        return;
      }
      mover.setRoute(route.cells);
      car.state = 'driving';
      overlay = null;
      banner = null;
      notice = null;
      refreshPanels(0);
    }

    function stopDriving() {
      if (route) route.stale = route.stale || route.replanned;
      mover.setRoute(route ? route.cells : [start]);
      banner = null;
      refreshPanels(0);
    }

    function liveChange(kind, cell) {
      if (car.state === 'blocked') {
        if (kind === 'open') replanFrom(car.cells.length - 1, kind);
        return;
      }
      const i = mover.index();
      const ahead = car.cells.slice(i + 2);
      if ((kind === 'close' || kind === 'jam') && ahead.includes(cell)) replanFrom(i + 1, kind);
      else if (kind === 'close') say('Jalan yang ditutup tidak ada di rute depan mobil, jadi rutenya tetap.');
    }

    /** Hitung ulang rute dari sel ke-commitIdx di rute mobil (sel yang pasti dimasuki). */
    function replanFrom(commitIdx, kind) {
      const from = car.cells[commitIdx];
      const job = makeSearch(from, goal);
      job.s.run();
      const prefix = car.cells.slice(0, commitIdx + 1);
      notice = null;
      lastResult = { algorithm: job.algorithm, found: job.s.found, expanded: job.s.expanded, open: job.s.open.size, key: job.key, length: null, time: null, replan: true };
      overlay = { search: job.s, hScale: job.hScale, algorithm: job.algorithm, stale: false, flashUntil: loop.time + 2.5 };
      if (job.s.found) {
        mover.replaceCells(prefix.concat(job.s.path.slice(1)));
        car.state = 'driving';
        route = { cells: car.cells.slice(), algorithm: job.algorithm, key: job.key, stale: false, replanned: true, ...city.measure(car.cells) };
        Object.assign(lastResult, city.measure(job.s.path));
        banner = { text: 'Rute dihitung ulang', tone: 'warn', until: loop.time + 3 };
        if (kind === 'close') flags.liveReplan = true;
        afterRouteFound(car.cells.slice(commitIdx));
      } else {
        mover.replaceCells(prefix);
        car.state = 'blocked';
        route = { cells: car.cells.slice(), algorithm: job.algorithm, key: job.key, stale: true, replanned: true, ...city.measure(car.cells) };
        banner = { text: 'Tidak ada rute ke tujuan', tone: 'danger', until: loop.time + 3 };
      }
    }

    // ---------- tombol cepat (juga alternatif tanpa mouse) ----------
    function routeCandidates(fromIdx) {
      const cells = isDriving() ? car.cells : route?.cells;
      if (!cells) return [];
      const out = [];
      for (let k = fromIdx; k < cells.length - 1; k++) {
        const c = cells[k];
        if (c !== start && c !== goal && !city.closed[c]) out.push({ k, c });
      }
      return out;
    }

    function closeOnRoute() {
      if (!route) {
        say('Belum ada rute. Tekan Cari rute dulu.');
        return;
      }
      const from = isDriving() ? mover.index() + 3 : 1;
      const cand = routeCandidates(from);
      if (!cand.length) {
        say('Mobil sudah terlalu dekat dengan tujuan.');
        return;
      }
      const straight = cand.filter((x) => city.isStraight(x.c));
      const pool = straight.length ? straight : cand;
      const pick = isDriving() ? pool[0] : pool[Math.floor(pool.length / 2)];
      toggleClosure(pick.c);
    }

    function jamOnRoute() {
      if (!route) {
        say('Belum ada rute. Tekan Cari rute dulu.');
        return;
      }
      const from = isDriving() ? mover.index() + 3 : 1;
      const cand = routeCandidates(from).filter((x) => !city.jam[x.c]);
      if (!cand.length) {
        say('Tidak ada sel lagi di rute yang bisa ditandai macet.');
        return;
      }
      const straight = cand.filter((x) => city.isStraight(x.c));
      const pool = straight.length >= 3 ? straight : cand;
      const mid = isDriving() ? 0 : Math.max(0, Math.floor(pool.length / 2) - 1);
      for (const x of pool.slice(mid, mid + 3)) paintJam(x.c, true);
    }

    // ---------- loop ----------
    function update(dt) {
      if (search) {
        search.acc += dt * nodesPerSec;
        let n = 0;
        while (search.acc >= 1 && !search.s.done && n < 400) {
          search.s.step();
          search.acc -= 1;
          n++;
        }
        if (search.s.done) finishSearch();
      }
      if (isDriving()) {
        const arrived = mover.update(dt * TIME_LAPSE);
        if (arrived) {
          banner = { text: 'Sampai di tujuan', tone: 'ok', until: loop.time + 2.5 };
        }
      }
    }

    // ---------- menggambar ----------
    function render() {
      const g = view.begin(MAP_COLORS.base);
      city.drawBase(g, view);
      city.drawJam(g, view);
      city.drawClosed(g, view);
      drawSearch(g);
      drawRoute(g);
      drawHover(g);
      drawGoal(g);
      drawStartAndCar(g);
      city.drawPlaceLabels(g, view);
      drawBanner();
      labels.draw(g, view);
      drawLegend(g);

      const now = performance.now();
      if (now - lastPanel > 120) {
        refreshPanels(lastPanel ? Math.min(0.5, (now - lastPanel) / 1000) : 0);
        lastPanel = now;
      }
    }

    function drawSearch(g) {
      if (!overlay) return;
      let alpha = overlay.stale ? 0.35 : 1;
      if (overlay.flashUntil != null) {
        const left = overlay.flashUntil - loop.time;
        if (left <= 0) {
          overlay = null;
          return;
        }
        alpha = Math.min(1, left / 1.2) * 0.9;
      } else if (isDriving() || car.state === 'arrived') return;
      const s = overlay.search;
      g.save();
      g.globalAlpha = alpha;
      g.fillStyle = withAlpha(CLOSED_COLOR, 0.42);
      for (const i of s.closed) {
        const q = city.roadRect(i, 1.5);
        g.fillRect(q.x, q.y, q.w, q.h);
      }
      g.fillStyle = withAlpha(OPEN_COLOR, 0.55);
      g.strokeStyle = OPEN_COLOR;
      g.lineWidth = view.px(1.5);
      for (const i of s.open) {
        const q = city.roadRect(i, 1.5);
        g.fillRect(q.x, q.y, q.w, q.h);
        g.strokeRect(q.x, q.y, q.w, q.h);
      }
      if (s.current != null && !s.done) {
        const q = city.roadRect(s.current, 0.5);
        g.strokeStyle = '#ffffff';
        g.lineWidth = view.px(2);
        g.strokeRect(q.x, q.y, q.w, q.h);
        // jalur sementara ke node yang sedang diperiksa
        const pts = s.pathTo(s.current).map((i) => city.center(i));
        if (pts.length > 1) drawPath(g, pts, { color: 'rgba(255,255,255,0.85)', width: 2, view, dash: [5, 5] });
      }
      g.restore();
    }

    function drawRoute(g) {
      if (!route || route.cells.length < 2) return;
      const pts = route.cells.map((i) => city.center(i));
      if (route.stale && !isDriving()) {
        drawPath(g, pts, { color: '#94a3b8', width: 3, view, dash: [7, 6], alpha: 0.85 });
        return;
      }
      if (isDriving() || car.state === 'arrived') {
        // bagian yang sudah dilewati tipis, sisa rute tebal
        const k = Math.min(pts.length - 2, Math.floor(car.u / CELL));
        const t = car.u / CELL - k;
        const here = { x: pts[k].x + (pts[k + 1].x - pts[k].x) * t, y: pts[k].y + (pts[k + 1].y - pts[k].y) * t };
        const done = pts.slice(0, k + 1).concat([here]);
        const rest = [here].concat(pts.slice(k + 1));
        drawPath(g, done, { color: PATH_COLOR, width: 3, view, alpha: 0.3 });
        if (car.u < (pts.length - 1) * CELL - 0.5) {
          drawPath(g, rest, { color: 'rgba(4, 47, 46, 0.7)', width: 8, view });
          drawPath(g, rest, { color: PATH_COLOR, width: 4.5, view, arrows: CELL * 3 });
        }
        return;
      }
      drawPath(g, pts, { color: 'rgba(4, 47, 46, 0.7)', width: 8, view });
      drawPath(g, pts, { color: PATH_COLOR, width: 4.5, view, arrows: CELL * 3 });
    }

    function drawHover(g) {
      if (hoverCell < 0 || !city.isRoad(hoverCell)) return;
      const target = drag?.kind === 'marker' ? drag.marker : moveTarget;
      const color = tool === 'tutup' ? MAP_COLORS.closed : tool === 'macet' ? MAP_COLORS.jam : target === 'goal' ? GOAL_COLOR : COLORS.accent;
      const q = city.roadRect(hoverCell, -2.5);
      g.save();
      g.strokeStyle = color;
      g.lineWidth = view.px(2);
      g.setLineDash([view.px(4), view.px(3)]);
      g.strokeRect(q.x, q.y, q.w, q.h);
      g.restore();
      if (drag?.kind === 'marker') {
        if (drag.marker === 'goal') drawFlag(g, drag.x, drag.y, 0.6);
        else drawCarIcon(g, { x: drag.x, y: drag.y, heading: car.pose.heading }, 0.6);
      }
    }

    function drawFlag(g, x, y, alpha = 1) {
      const u = Math.max(1, view.px(1)); // satu piksel dalam meter
      const h = Math.max(CELL * 0.75, 20 * u);
      const w = h * 0.55;
      g.save();
      g.globalAlpha *= alpha;
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.beginPath();
      g.ellipse(x + 1.5 * u, y + 1 * u, w * 0.35, w * 0.16, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#e2e8f0';
      g.lineWidth = Math.max(1.2, 2 * u);
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x, y - h);
      g.stroke();
      g.fillStyle = GOAL_COLOR;
      g.beginPath();
      g.moveTo(x, y - h);
      g.lineTo(x + w, y - h + h * 0.22);
      g.lineTo(x, y - h + h * 0.44);
      g.closePath();
      g.fill();
      g.fillStyle = GOAL_COLOR;
      g.beginPath();
      g.arc(x, y, Math.max(1.6, 3 * u), 0, Math.PI * 2);
      g.fill();
      g.restore();
    }

    function drawGoal(g) {
      const p = city.center(goal);
      const u = view.px(1);
      g.save();
      g.fillStyle = withAlpha(GOAL_COLOR, 0.22);
      g.beginPath();
      g.arc(p.x, p.y, Math.max(CELL * 0.45, 9 * u), 0, Math.PI * 2);
      g.fill();
      g.restore();
      drawFlag(g, p.x - 2 * u, p.y + CELL * 0.18);
      labels.add(p.x, p.y, 'Tujuan', { color: GOAL_COLOR, dy: -(CELL * view.camera.scale * 0.5 + 24), size: 11 });
    }

    function carSize() {
      const L = Math.max(CELL * 0.7, view.px(17));
      return { length: L, width: L * 0.44 };
    }

    function drawCarIcon(g, pose, alpha = 1) {
      const size = carSize();
      const inJam = isDriving() && car.cells.length && city.jam[car.cells[mover.index()]];
      drawCar(g, { ...pose, ...size }, { ego: true, alpha, braking: !!inJam, view });
    }

    function idlePose() {
      // mobil di start tanpa rute: hadap ke sel jalan tetangga yang paling dekat ke tujuan
      const p = city.center(start);
      const q = city.center(goal);
      let best = null;
      for (const n of city.roadNeighbors(start)) {
        const c = city.center(n);
        const d = Math.abs(c.x - q.x) + Math.abs(c.y - q.y);
        if (!best || d < best.d) best = { c, d };
      }
      const heading = best ? Math.atan2(best.c.y - p.y, best.c.x - p.x) : 0;
      const off = LANE_OFFSET;
      return { x: p.x + Math.sin(heading) * off, y: p.y - Math.cos(heading) * off, heading };
    }

    function drawStartAndCar(g) {
      const p = city.center(start);
      const u = view.px(1);
      const pose = car.cells.length >= 2 ? car.pose : idlePose();
      const carAtStart = !isDriving() && car.state !== 'arrived';
      // penanda start (terlihat jelas saat mobil sudah pergi)
      g.save();
      g.fillStyle = withAlpha(COLORS.accent, carAtStart ? 0.2 : 0.28);
      g.beginPath();
      g.arc(p.x, p.y, Math.max(CELL * 0.45, 9 * u), 0, Math.PI * 2);
      g.fill();
      if (!carAtStart) {
        g.strokeStyle = COLORS.accent;
        g.lineWidth = view.px(2);
        g.stroke();
      }
      g.restore();
      labels.add(p.x, p.y, 'Start', { color: COLORS.accent, dy: CELL * view.camera.scale * 0.5 + 16, size: 11 });
      if (drag?.kind === 'marker' && drag.marker === 'start') return;
      drawCarIcon(g, pose);
      if (banner && banner.tone === 'warn' && banner.until > loop.time) {
        // cincin berdenyut; statis bila pengguna memilih gerak dikurangi
        const k = ctx.reducedMotion ? 0.25 : ((1 - (banner.until - loop.time) / 3) * 2) % 1;
        const r = CELL * (0.6 + 0.8 * k);
        g.save();
        g.strokeStyle = withAlpha(COLORS.warn, 0.8 * (1 - k));
        g.lineWidth = view.px(2.5);
        g.beginPath();
        g.arc(pose.x, pose.y, r, 0, Math.PI * 2);
        g.stroke();
        g.restore();
      }
    }

    function drawBanner() {
      if (!banner) return;
      if (banner.until <= loop.time) {
        banner = null;
        return;
      }
      const color = banner.tone === 'danger' ? '#fca5a5' : banner.tone === 'ok' ? COLORS.ok : COLORS.warn;
      const border = banner.tone === 'danger' ? COLORS.danger : color;
      labels.add(car.pose.x, car.pose.y, banner.text, { color, border, size: 13, dy: -(carSize().length * view.camera.scale * 0.5 + 22) });
    }

    function drawLegend(g) {
      const items = [
        { label: 'Antrean', color: OPEN_COLOR, kind: 'square' },
        { label: 'Dijelajahi', color: CLOSED_COLOR, kind: 'square' },
        { label: 'Rute', color: PATH_COLOR, kind: 'line' },
        { label: 'Macet', color: MAP_COLORS.jam, kind: 'square' },
        { label: 'Ditutup', color: MAP_COLORS.closed, kind: 'cross' },
      ];
      g.save();
      view.screen();
      g.font = `600 11px ${FONT}`;
      g.textBaseline = 'middle';
      g.textAlign = 'left';
      const sw = 11;
      const gap = 14;
      const widths = items.map((it) => sw + 6 + g.measureText(it.label).width);
      const maxW = view.width - 24;
      const rows = [[]];
      let rowW = 0;
      items.forEach((it, i) => {
        const w = widths[i];
        if (rows[rows.length - 1].length && rowW + gap + w > maxW) {
          rows.push([]);
          rowW = 0;
        }
        rowW += (rows[rows.length - 1].length ? gap : 0) + w;
        rows[rows.length - 1].push(i);
      });
      const rowH = 18;
      let y;
      let scaleY;
      if (layout.narrow) {
        scaleY = layout.mapBottom + 22;
        y = scaleY + 14;
      } else {
        y = view.height - 17;
        scaleY = view.height - 12;
      }
      for (const row of rows) {
        const total = row.reduce((a, i, k) => a + widths[i] + (k ? gap : 0), 0);
        let x = layout.narrow ? (view.width - total) / 2 : Math.max((view.width - total) / 2, 150);
        for (const i of row) {
          const it = items[i];
          const cy = y;
          if (it.kind === 'line') {
            g.strokeStyle = it.color;
            g.lineWidth = 3;
            g.lineCap = 'round';
            g.beginPath();
            g.moveTo(x, cy);
            g.lineTo(x + sw, cy);
            g.stroke();
          } else {
            g.fillStyle = withAlpha(it.color, it.kind === 'cross' ? 0.35 : 0.6);
            roundRectPath(g, x, cy - sw / 2, sw, sw, 3);
            g.fill();
            g.strokeStyle = it.color;
            g.lineWidth = 1.2;
            g.stroke();
            if (it.kind === 'cross') {
              g.strokeStyle = '#ffffff';
              g.lineWidth = 1.5;
              g.beginPath();
              g.moveTo(x + 3, cy - 2.5);
              g.lineTo(x + sw - 3, cy + 2.5);
              g.moveTo(x + sw - 3, cy - 2.5);
              g.lineTo(x + 3, cy + 2.5);
              g.stroke();
            }
          }
          g.fillStyle = 'rgba(226, 232, 240, 0.85)';
          g.fillText(it.label, x + sw + 6, cy + 0.5);
          x += widths[i] + gap;
        }
        y += rowH;
      }
      g.restore();
      drawScaleBar(g, view, { x: layout.narrow ? 12 : 14, y: scaleY, target: layout.narrow ? 60 : 90 });
    }

    // ---------- panel (sekitar 8 kali per detik) ----------
    let lastPanel = 0;
    let lastButtons = '';

    function refreshPanels(realDt) {
      const s = search?.s || null;
      const shown = s ? { expanded: s.expanded, open: s.open.size } : lastResult ? { expanded: lastResult.expanded, open: lastResult.open ?? 0 } : { expanded: 0, open: 0 };
      exploredOut.set(`${fmt(shown.expanded)} node`);
      openOut.set(`${fmt(shown.open)} node`);
      const r = route && !route.stale ? route : null;
      lengthOut.set(r ? meters(r.length) : '-');
      timeOut.set(r ? secs(r.time) : '-');

      // g + h = f untuk node yang terakhir diperiksa
      const os = overlay?.search;
      if (os && os.current != null && os.g.has(os.current)) {
        const gv = os.g.get(os.current) / FREE_SPEED;
        const hv = overlay.algorithm === 'dijkstra' ? 0 : (city.grid.heuristic(os.current, os.goal) * overlay.hScale) / FREE_SPEED;
        fghOut.set(`${fmt(gv, 1)} + ${fmt(hv, 1)} = ${fmt(gv + hv, 1)} detik`);
      } else fghOut.set('-');

      // tabel perbandingan
      const key = currentKey();
      const row = (id) => {
        const res = results[id];
        const ok = res && res.key === key;
        return {
          algo: { html: `<span class="algo-name" style="--c: ${id === 'astar' ? COLORS.accent : CLOSED_COLOR}">${ALGO_NAMES[id]}</span>` },
          nodes: ok ? fmt(res.expanded) : 'belum',
          len: ok ? (res.found ? meters(res.length) : 'tidak ada') : '-',
          time: ok ? (res.found ? secs(res.time) : '-') : '-',
          _class: ok ? '' : 'is-muted',
        };
      };
      compareTable.setRows([row('astar'), row('dijkstra')]);
      const a = results.astar?.key === key ? results.astar : null;
      const d = results.dijkstra?.key === key ? results.dijkstra : null;
      let note;
      if (a && d) {
        if (a.found && d.found) {
          note = a.expanded < d.expanded
            ? `A* cukup memeriksa ${fmt(a.expanded)} node, Dijkstra ${fmt(d.expanded)} node. Waktu tempuh rutenya sama, ${secs(a.time)}.`
            : `Kali ini A* memeriksa ${fmt(a.expanded)} node dan Dijkstra ${fmt(d.expanded)} node. Waktu tempuh rutenya sama, ${secs(a.time)}.`;
        } else note = `Tidak ada rute ke tujuan. Kedua algoritma memeriksa semua node yang bisa dicapai (${fmt(d.expanded)} node).`;
      } else if (a || d) note = `Sekarang jalankan ${a ? 'Dijkstra' : 'A*'} dengan start, tujuan, dan peta yang sama.`;
      else if (results.astar || results.dijkstra) note = 'Peta, start, atau tujuan sudah berubah. Jalankan kedua algoritma lagi.';
      else note = 'Jalankan kedua algoritma dengan start dan tujuan yang sama untuk mengisi tabel ini.';
      if (compareNote.textContent !== note) compareNote.textContent = note;

      // mobil
      const stateText = { idle: 'di start', driving: 'melaju', arrived: 'sampai', blocked: 'menunggu' }[car.state];
      carStateOut.set(stateText);
      carStateOut.setTone(car.state === 'blocked' ? 'danger' : car.state === 'arrived' ? 'ok' : '');
      // saat menunggu tidak ada rute ke tujuan, jadi sisa waktunya tidak diketahui
      const rem = car.state === 'driving' ? mover.remaining() : null;
      carLeftOut.set(rem ? secs(rem.time) : car.state === 'arrived' ? secs(0) : car.state === 'blocked' ? '-' : route && !route.stale ? secs(route.time) : '-');

      // HUD
      algoChip.set(ALGO_NAMES[algorithm]);
      nodesChip.set(`${fmt(shown.expanded)} node`);
      carChip.set(stateText);
      carChip.setTone(car.state === 'blocked' ? 'danger' : car.state === 'arrived' ? 'ok' : car.state === 'driving' ? 'warn' : '');

      updateButtons();
      checkTasks(realDt);
      updateStatus();
    }

    function updateButtons() {
      const driving = isDriving();
      const searchLabel = search ? 'Lewati animasi' : 'Cari rute';
      const driveLabel = driving ? 'Hentikan mobil' : car.state === 'arrived' ? 'Jalankan lagi' : 'Jalankan mobil';
      const sig = `${searchLabel}|${driveLabel}|${driving}|${!!route}`;
      if (sig === lastButtons) return;
      lastButtons = sig;
      searchBtn.querySelector('.btn-label').textContent = searchLabel;
      searchBtn.disabled = driving;
      driveBtn.querySelector('.btn-label').textContent = driveLabel;
      driveBtn.classList.toggle('btn-danger', driving);
      driveBtn.classList.toggle('btn-secondary', !driving);
      closeBtn.disabled = !route;
      jamBtn.disabled = !route;
    }

    // ---------- deteksi tugas ----------
    const TASK_CHECKS = {
      'first-route': { hold: 0.3, test: () => !search && !!lastResult && lastResult.algorithm === 'astar' && lastResult.found && !lastResult.replan },
      compare: {
        hold: 0.4,
        test: () => {
          const key = currentKey();
          return !search && results.astar?.key === key && results.dijkstra?.key === key;
        },
      },
      closure: { hold: 0.3, test: () => !search && flags.closureReplanned && !!route },
      traffic: { hold: 0.3, test: () => !search && flags.jamAvoided && !!route },
      'replan-live': { hold: 1.2, test: () => flags.liveReplan && (car.state === 'driving' || car.state === 'arrived') },
    };

    function checkTasks(realDt) {
      const taskId = ctx.lesson.steps[ctx.currentStep()]?.taskId;
      if (!taskId || ctx.isTaskDone(taskId)) return;
      const check = TASK_CHECKS[taskId];
      if (!check) return;
      holds[taskId] = check.test() ? (holds[taskId] || 0) + realDt : 0;
      if (holds[taskId] >= check.hold) ctx.completeTask(taskId);
    }

    // ---------- baris status ----------
    function updateStatus() {
      let text;
      const name = ALGO_NAMES[search?.algorithm || lastResult?.algorithm || algorithm];
      if (notice && notice.until > performance.now()) text = notice.text;
      else if (search) text = `${name} sedang mencari. ${fmt(search.s.expanded)} node dijelajahi, ${fmt(search.s.open.size)} node di antrean.`;
      else if (car.state === 'blocked') text = 'Tidak ada rute ke tujuan, jadi mobil menunggu. Buka lagi salah satu jalan yang ditutup.';
      else if (car.state === 'driving') {
        const rem = mover.remaining();
        const replanned = banner && banner.tone === 'warn' ? `Rute dihitung ulang dari posisi mobil (${fmt(lastResult?.expanded ?? 0)} node dijelajahi). ` : '';
        const slow = city.jam[car.cells[mover.index()]] ? ' Mobil melambat di jalan macet.' : '';
        text = `${replanned}Mobil melaju. Sisa ${meters(rem.length)}, sekitar ${secs(rem.time)} lagi.${slow}`;
      } else if (car.state === 'arrived') text = `Mobil sampai di tujuan setelah ${secs(car.elapsed)}.`;
      else if (route && route.stale) text = 'Peta berubah. Tekan Cari rute untuk menghitung ulang rute.';
      else if (lastResult && !lastResult.found) text = `${name} tidak menemukan rute. Semua jalan menuju tujuan tertutup.`;
      else if (route) {
        text = `${ALGO_NAMES[route.algorithm]} menemukan rute ${meters(route.length)}, sekitar ${secs(route.time)}, setelah menjelajahi ${fmt(lastResult?.expanded ?? 0)} node.`;
        if (flags.jamStillUsed && !flags.jamAvoided && ctx.currentStep() === 3) text += ' Rute masih lewat macet karena jalan memutar lebih lama.';
      } else text = `Belum ada rute. Tekan Cari rute untuk menjalankan ${ALGO_NAMES[algorithm]}.`;
      ctx.setStatus(text);
      view.setLabel(
        route && !route.stale
          ? `Peta kota grid 24 kali 16 sel. Rute ${meters(route.length)} dari start ke tujuan. Mobil ${car.state === 'driving' ? 'sedang melaju' : car.state === 'arrived' ? 'sudah sampai' : 'di start'}.`
          : 'Peta kota grid 24 kali 16 sel dengan jalan, sungai, dan tiga jembatan. Belum ada rute yang berlaku.',
      );
    }

    // ---------- preset ----------
    function applyPreset(i, { keepChoices = false } = {}) {
      const p = STEP_PRESETS[Math.min(i, STEP_PRESETS.length - 1)];
      search = null;
      overlay = null;
      route = null;
      lastResult = null;
      banner = null;
      notice = null;
      drag = null;
      city.clear();
      start = S0;
      goal = G0;
      mover.setRoute([start]);
      flags = freshFlags();
      if (!keepChoices) {
        setAlgorithm(p.algorithm);
        setTool(p.tool);
      }
      if (i === 1) results = { astar: null, dijkstra: null };
      if (p.route) presetRoute();
      for (const k of Object.keys(holds)) holds[k] = 0;
      lastButtons = '';
      refreshPanels(0);
    }

    setTool(tool);
    speedCtl.set(nodesPerSec);

    // ---------- antarmuka ke shell ----------
    return {
      onStep(i) {
        applyPreset(i);
      },
      reset() {
        applyPreset(ctx.currentStep(), { keepChoices: true });
      },
      destroy() {
        // Kanvas, loop, dan listener dibersihkan otomatis oleh ctx.
      },
    };
  },
};
