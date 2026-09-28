// Pelajaran 5: Perencanaan Rute.
//
// Peta jalan asli kota Malang dari OpenStreetMap ('malang-roads', dari Universitas Ma Chung sampai
// pusat kota). Simpang menjadi node graf, ruas jalan menjadi sisi berbiaya waktu tempuh, dan jalan
// satu arah hanya punya sisi searah lalu lintas. A* dan Dijkstra (engine/planning.js lewat
// RoadGraph) dijalankan selangkah demi selangkah supaya pencariannya terlihat. Pelajar bisa menutup
// jalan, menandai macet, memindahkan start atau tujuan, lalu menjalankan mobil di rute itu. Saat mobil
// melaju, penutupan di depan memicu hitung ulang rute dari simpang berikutnya.
//
// Mobil berhenti di lampu lalu lintas. Posisi lampu asli dari OSM, fasenya disimulasikan. Perisai
// keselamatan di ./rute/drive.js menjamin mobil tidak pernah melewati garis henti saat merah.
//
// Pola mengikuti sensor.js: teks di objek default, model di folder pelajaran, satu loop terkelola,
// panel diperbarui sekitar 8 kali per detik dari render(), tugas dideteksi dari keadaan simulasi.

import { COLORS, FONT, withAlpha } from '../engine/theme.js';
import { fmt, clamp } from '../engine/math.js';
import { closestPointOnSegment, Path } from '../engine/geometry.js';
import { slicePolyline } from '../engine/road.js';
import { drawCar, drawTrafficSignal, createLabelLayer } from '../engine/draw.js';
import { createMapRenderer, highlightRoad, drawSignalDots, shortStreetName, STREET_SCALE, MAP_STYLE } from '../engine/osm2d.js';
import { icon } from '../engine/icons.js';
import * as ui from '../engine/ui.js';
import { PLACES, DEFAULT_START, DEFAULT_GOAL } from './rute/data/places.js';
import { buildSignals, signalTiming, buildRoute, joinAt, stretchFrom, nodeLabel, junctionSetback } from './rute/network.js';
import { createDriver, DRIVE } from './rute/drive.js';
import { createEdgeLayer, fmtDist, fmtDur, drawScaleBarKm } from './rute/layers.js';

const ALGO_NAMES = { astar: 'A*', dijkstra: 'Dijkstra' };
const OPEN_COLOR = '#a78bfa';
const CLOSED_COLOR = '#60a5fa';
const PATH_COLOR = COLORS.path;
const GOAL_COLOR = COLORS.target;
const JAM_COLORS = { 2: '#fbbf24', 4: '#f97316', 8: '#fb7185' };
const ONEWAY_COLOR = '#f0abfc';
const HALF = DRIVE.LENGTH / 2;
const MIN_SCALE = 0.03;
const MAX_SCALE = 6;
const FOLLOW_SCALE = 2.4;

const TOOL_HINTS = {
  tutup: 'Klik atau ketuk sebuah jalan untuk menutupnya (sampai sekitar 300 m). Ketuk jalan yang ditutup sekali lagi untuk membukanya.',
  macet: 'Klik atau ketuk sebuah jalan untuk menandainya macet dengan pengali yang dipilih. Ketuk sekali lagi untuk menghapus tandanya.',
  pindah: 'Pilih Start atau Tujuan, lalu ketuk titik di peta. Titik bernama bisa juga dipilih dari daftar di atas.',
};

// Preset tiap langkah: algoritma, alat peta, dan apakah rute A* langsung disiapkan.
const STEP_PRESETS = [
  { algorithm: 'astar', tool: 'tutup', route: false },
  { algorithm: 'dijkstra', tool: 'tutup', route: false },
  { algorithm: 'astar', tool: 'tutup', route: true },
  { algorithm: 'astar', tool: 'macet', route: true },
  { algorithm: 'astar', tool: 'tutup', route: true },
];

export default {
  id: 'rute',
  title: 'Perencanaan Rute',
  layout: 'sim',
  intro:
    '<p>Sebelum berangkat, mobil otonom harus tahu jalan mana yang akan dilewatinya. Tugas ini disebut <strong>perencanaan rute</strong>. Di pelajaran ini kamu memakai peta jalan asli kota Malang dari OpenStreetMap, dari Universitas Ma Chung sampai pusat kota. Kamu menjalankan A* dan Dijkstra, lalu menutup jalan dan membuat macet untuk melihat rutenya berubah.</p>',
  steps: [
    {
      title: 'Mencari rute dengan A*',
      body:
        '<p>Bagi komputer, peta jalan adalah sebuah <strong>graf</strong>. Setiap simpang dan ujung jalan menjadi satu <em>node</em> (simpul). Ruas jalan di antara dua simpang menjadi <em>sisi</em> yang menghubungkannya. Peta Malang di sini punya sekitar 10.600 node dan 13.400 ruas.</p>' +
        '<p>Biaya sebuah sisi adalah perkiraan waktu tempuhnya: panjang ruas dibagi perkiraan kecepatan rata-rata di jalan itu, misalnya 20 km/jam di jalan perumahan dan 30 km/jam di jalan kolektor. Jalan satu arah hanya punya sisi searah lalu lintas, jadi rute tidak pernah melawan arah.</p>' +
        '<p>A* selalu memeriksa node dengan nilai f paling kecil:</p>' +
        '<div class="formula">f(n) = g(n) + h(n)</div>' +
        '<ul><li><code>g(n)</code> adalah waktu tempuh sebenarnya dari start sampai node n.</li>' +
        '<li><code>h(n)</code> adalah <strong>heuristik</strong>, yaitu perkiraan sisa waktu ke tujuan. Di sini h sama dengan jarak garis lurus dibagi kecepatan tertinggi di peta.</li></ul>' +
        '<p>Titik <span class="chip chip-open">antrean</span> sudah ditemukan tetapi belum diperiksa. Garis <span class="chip chip-closed">dijelajahi</span> menghubungkan node yang sudah diperiksa. Begitu tujuan diperiksa, A* menelusuri balik asal tiap node untuk mendapatkan <span class="chip chip-path">rute</span>.</p>',
      task: { id: 'first-route', text: 'Pastikan algoritma <strong>A*</strong> terpilih, lalu tekan <strong>Cari rute</strong> dan tunggu sampai rute dari start ke tujuan ditemukan.' },
    },
    {
      title: 'A* dibanding Dijkstra',
      body:
        '<p>Dijkstra memeriksa node hanya menurut biaya dari start. Pencariannya melebar ke segala arah seperti riak air, termasuk ke arah yang menjauhi tujuan.</p>' +
        '<p>A* adalah Dijkstra yang ditambah heuristik. Kalau h selalu 0, A* bekerja persis seperti Dijkstra. Heuristik menarik pencarian ke arah tujuan, jadi A* biasanya memeriksa lebih sedikit node.</p>' +
        '<p>A* tetap menemukan rute tercepat asalkan heuristiknya tidak pernah melebihi biaya sebenarnya. Syarat ini disebut <em>admissible</em>. Jarak garis lurus tidak pernah lebih panjang dari jalan mana pun, dan tidak ada jalan di peta ini yang lebih cepat dari 60 km/jam (batas kecepatan Jalan Kahuripan menurut OSM), jadi h tidak pernah melebihi waktu tempuh sebenarnya.</p>' +
        '<p class="note">Kebanyakan jalan di Malang jauh lebih lambat dari 60 km/jam, jadi h cukup rendah. A* tetap lebih hemat, tetapi selisihnya tidak sebesar di peta yang semua jalannya berkecepatan sama. Coba juga tukar start dan tujuan: Ma Chung ada di tepi barat peta, jadi pencarian ke arah Ma Chung jauh lebih berat.</p>',
      task: { id: 'compare', text: 'Jalankan <strong>Dijkstra</strong> dan <strong>A*</strong> dengan start dan tujuan yang sama, lalu bandingkan jumlah node dijelajahi di tabel Perbandingan.' },
    },
    {
      title: 'Jalan ditutup',
      body:
        '<p>Jalan bisa ditutup, misalnya karena perbaikan, acara, atau banjir. Di graf, sisi dari ruas yang ditutup dianggap hilang, jadi rute yang lewat sana tidak berlaku lagi.</p>' +
        '<p>Pilih alat <strong>Tutup jalan</strong>, lalu klik atau ketuk jalan di rute. Potongan jalan itu (sampai sekitar 300 m) ditutup di kedua arah. Ketuk sekali lagi untuk membukanya. Setelah itu cari rute baru.</p>' +
        '<p>Perhatikan jumlah node yang dijelajahi. Kalau penutupan memaksa rute memutar jauh, A* ikut memeriksa lebih banyak node.</p>',
      task: { id: 'closure', text: 'Tutup satu jalan yang dilewati rute sekarang, lalu tekan <strong>Cari rute</strong> lagi.' },
    },
    {
      title: 'Macet mengubah biaya',
      body:
        '<p>Mobil otonom biasanya mencari rute dengan <strong>waktu tempuh</strong> terkecil. Data lalu lintas dari peta digital memberi tahu ruas mana yang sedang padat.</p>' +
        '<p>Di simulasi ini, jalan yang kamu tandai <span class="chip chip-jam">macet</span> mendapat pengali biaya 2, 4, atau 8 kali. Contohnya, ruas 400 m di jalan 30 km/jam biasanya ditempuh dalam 48 detik. Dengan pengali 4, ruas itu butuh 192 detik. Karena itu rute tercepat bisa lebih panjang dari rute terpendek.</p>' +
        '<p class="note">A* hanya menghindari macet kalau jalan memutarnya lebih cepat. Kalau memutarnya terlalu jauh, rute tetap lewat jalan macet. Pengali tidak pernah kurang dari 1, jadi heuristik tetap admissible.</p>',
      task: { id: 'traffic', text: 'Pilih alat <strong>Macet</strong>, tandai jalan di rute sekarang, lalu tekan <strong>Cari rute</strong> sampai rute baru menghindari jalan macet itu.' },
    },
    {
      title: 'Hitung ulang saat melaju',
      body:
        '<p>Keadaan jalan bisa berubah ketika mobil sudah berangkat. Mobil otonom lalu menghitung ulang rute dari posisinya sekarang. Proses ini disebut <strong>perencanaan ulang</strong> atau <em>replanning</em>.</p>' +
        '<p>Pencarian ulang dimulai dari simpang berikutnya yang masih sempat dibelokkan, karena mobil tidak bisa berbelok di tengah ruas. Kalau satu-satunya jalan adalah berbalik arah, mobil putar balik ke kanan sesuai lalu lintas lajur kiri.</p>' +
        '<p>Mobil juga berhenti di lampu merah. Posisi 69 lampu lalu lintas diambil dari OpenStreetMap, tetapi fase dan durasinya disimulasikan. Lapisan terakhir sebelum gas dan rem, yaitu <strong>perisai keselamatan</strong>, memeriksa setiap langkah gerak. Mobil tidak mungkin melewati garis henti saat lampu merah.</p>' +
        '<p class="note">Gerak mobil dipercepat 5, 15, atau 30 kali. Perkiraan waktu rute belum menghitung waktu menunggu lampu merah dan melambat di tikungan, jadi waktu perjalanannya sedikit lebih lama.</p>',
      task: { id: 'replan-live', text: 'Tekan <strong>Jalankan mobil</strong>. Saat mobil melaju, tutup jalan di rute depannya dan lihat rutenya dihitung ulang.' },
    },
  ],
  summary:
    '<p>Perencanaan rute mencari jalan dengan biaya terkecil dari start ke tujuan pada graf jalan.</p>' +
    '<ul><li>Dijkstra memeriksa node menurut biaya dari start. Rutenya optimal, tetapi banyak node yang diperiksa ternyata tidak dipakai.</li>' +
    '<li>A* menambahkan heuristik h(n). Selama heuristik tidak melebihi biaya sebenarnya, rutenya tetap optimal dan node yang diperiksa lebih sedikit.</li>' +
    '<li>Jalan yang ditutup menghapus sisi dari graf. Macet menaikkan biaya, sehingga rute tercepat bisa pindah ke jalan lain. Jalan satu arah hanya bisa dilalui searah.</li>' +
    '<li>Saat keadaan berubah di tengah perjalanan, mobil menghitung ulang rute dari simpang berikutnya.</li></ul>' +
    '<p class="note">Peta jalan berasal dari OpenStreetMap (© Kontributor OpenStreetMap). Kecepatan tiap jalan adalah perkiraan dari kelas jalannya, kecuali jalan yang punya tag batas kecepatan. Fase lampu lalu lintas disimulasikan, dan ukuran mobil di peta dibesarkan supaya terlihat. Sistem navigasi sungguhan juga memakai larangan belok, jumlah lajur, dan data lalu lintas yang terus diperbarui. Cara mobil mengikuti lintasan di lajurnya dengan mulus dibahas di pelajaran berikutnya.</p>',

  styles: `
    .lesson-rute .chip-open { --c: ${OPEN_COLOR}; }
    .lesson-rute .chip-closed { --c: ${CLOSED_COLOR}; }
    .lesson-rute .chip-path { --c: var(--accent); }
    .lesson-rute .chip-jam { --c: ${JAM_COLORS[4]}; }
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
    .lesson-rute .rute-field { display: grid; gap: 6px; margin-bottom: 10px; }
    .lesson-rute .rute-field label { font-size: 0.9rem; font-weight: 600; color: var(--muted); }
    .lesson-rute .rute-select {
      width: 100%; min-height: 42px; padding: 0 36px 0 12px; border: 1px solid var(--border);
      border-radius: var(--radius-sm); background: var(--raised); color: var(--text); font-weight: 600;
      appearance: none; -webkit-appearance: none; cursor: pointer;
      background-image: linear-gradient(45deg, transparent 50%, var(--muted) 50%), linear-gradient(135deg, var(--muted) 50%, transparent 50%);
      background-position: calc(100% - 18px) 50%, calc(100% - 13px) 50%;
      background-size: 5px 5px, 5px 5px; background-repeat: no-repeat;
    }
    .lesson-rute .rute-select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .lesson-rute .rute-select:disabled { opacity: 0.55; cursor: not-allowed; }
    .lesson-rute .rute-loading {
      position: absolute; inset: 0; z-index: 1; display: grid; place-items: center; color: var(--muted); font-weight: 600;
    }
    .lesson-rute .rute-loading > div { display: inline-flex; align-items: center; gap: 10px; }
    .lesson-rute .rute-cam {
      position: absolute; right: 10px; top: 50%; transform: translateY(-50%); z-index: 3;
      display: flex; flex-direction: column; gap: 6px;
    }
    .lesson-rute .rute-cam button {
      width: 40px; height: 40px; display: grid; place-items: center; padding: 0;
      border: 1px solid var(--border); border-radius: 10px; background: rgba(17, 26, 46, 0.92);
      color: var(--text); font-size: 1.25rem; font-weight: 700; line-height: 1; cursor: pointer;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3); -webkit-tap-highlight-color: transparent;
    }
    .lesson-rute .rute-cam button svg { width: 18px; height: 18px; }
    .lesson-rute .rute-cam button:hover { border-color: var(--muted); }
    .lesson-rute .rute-cam button[aria-pressed='true'] { border-color: var(--accent); color: var(--accent); }
    .lesson-rute .rute-cam button:disabled { opacity: 0.45; cursor: not-allowed; }
    .lesson-rute .rute-cam button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .lesson-rute .safety-out[data-tone='ok'] .readout-value { color: var(--ok); }
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

  async mount(ctx) {
    // ---------- muat peta ----------
    const loading = ui.el(
      'div',
      { class: 'rute-loading' },
      ui.el('div', {}, ui.el('span', { class: 'spinner', 'aria-hidden': 'true' }), ui.el('span', { text: 'Memuat peta jalan Malang...' })),
    );
    ctx.stage.append(loading);
    ctx.setStatus('Memuat peta jalan Malang dari data OpenStreetMap.');
    const map = await ctx.loadMap('malang-roads');
    loading.remove();

    // ---------- model ----------
    const graph = map.graph({ cost: 'time' });
    const vMax = graph.maxSpeed; // 60 km/jam (Jalan Kahuripan), juga batas kecepatan mobil
    const timing = signalTiming(vMax, { reaction: DRIVE.T_REACT, comfortDecel: DRIVE.A_COMF });
    const signals = buildSignals(map, timing);
    const setbackOf = (id) => junctionSetback(map.nodes[id]);
    const driver = createDriver({ signals, vMax, setbackOf });
    const car = driver.car;
    const placeNode = new Map(PLACES.map((p) => [p.id, graph.nearestNode(p.x, p.y).id]));
    const placeById = new Map(PLACES.map((p) => [p.id, p]));
    const inGraph = (r) => !!(graph.edgeFor(r, true) || graph.edgeFor(r, false));

    const ends = {
      start: { place: DEFAULT_START, node: placeNode.get(DEFAULT_START), label: placeById.get(DEFAULT_START).name },
      goal: { place: DEFAULT_GOAL, node: placeNode.get(DEFAULT_GOAL), label: placeById.get(DEFAULT_GOAL).name },
    };
    let algorithm = 'astar';
    let tool = 'tutup';
    let moveTarget = 'start';
    let jamLevel = 4;
    let nodesPerSec = 400;
    let lapse = 15;
    let showOneway = false;
    let simT = 0; // jam simulasi lampu dan mobil (detik, sudah termasuk percepatan waktu)
    let search = null; // pencarian beranimasi
    let overlay = null; // { search, algorithm, stale, flashUntil }
    let route = null; // rute aktif (buildRoute + info)
    let lastResult = null;
    let results = { astar: null, dijkstra: null };
    let banner = null; // { text, tone, until } di dekat mobil
    let notice = null; // { text, until } di baris status
    let hover = null; // { stretch, kind } sorotan alat saat mouse di atas jalan
    let flags = freshFlags();
    let wasState = 'idle';
    const holds = {};
    const stretches = new Map(); // id -> { id, kind: 'tutup' | 'macet', mult, roads, label, length }
    const stretchOfRoad = new Map(); // road.id -> stretch
    let stretchSeq = 0;

    function freshFlags() {
      return { closedOnRoute: new Set(), closureReplanned: false, jamOnRoute: new Set(), jamAvoided: false, jamStillUsed: false, liveReplan: false };
    }

    const isDriving = () => car.state === 'driving' || car.state === 'blocked';
    const mapSig = () => {
      const parts = [];
      for (const st of stretches.values()) parts.push(`${st.kind === 'tutup' ? 'x' : `m${st.mult}`}:${st.roads.map((r) => r.id).join(',')}`);
      return parts.sort().join('|');
    };
    const currentKey = () => `${ends.start.node}>${ends.goal.node}|${mapSig()}`;
    const nodePos = (id) => graph.nodes.get(id);

    // ---------- kanvas dan loop ----------
    const labels = createLabelLayer();
    const layer = createEdgeLayer({ color: withAlpha(CLOSED_COLOR, 0.8), width: 1.8 });
    let cam = 'fit'; // 'fit' | 'follow' | 'manual'
    let followScale = FOLLOW_SCALE;
    const view = ctx.createView({
      label: 'Peta jalan kota Malang dari OpenStreetMap, dari Universitas Ma Chung sampai pusat kota.',
      background: MAP_STYLE.ground,
      padding: 0,
      bounds: fitBounds,
    });
    const renderer = createMapRenderer(map, { layers: { places: false } });

    function fitBox() {
      const a = nodePos(ends.start.node);
      const b = nodePos(ends.goal.node);
      const minX = Math.min(a.x, b.x);
      const maxX = Math.max(a.x, b.x);
      const minY = Math.min(a.y, b.y);
      const maxY = Math.max(a.y, b.y);
      const pad = Math.max(300, Math.max(maxX - minX, maxY - minY) * 0.1);
      return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
    }

    // Area dunia seluas kanvas, dengan kotak start dan tujuan di tengah area yang bebas dari chip HUD
    // (atas), tombol kamera (kanan), serta skala dan atribusi (bawah).
    function fitBounds(v) {
      const box = fitBox();
      const top = Math.max(14, (ctx.hud.offsetHeight || 30) + 16);
      const bottom = 30;
      const left = 12;
      const right = 58;
      const aw = Math.max(40, v.width - left - right);
      const ah = Math.max(40, v.height - top - bottom);
      const s = Math.max(MIN_SCALE * 0.5, Math.min(aw / (box.maxX - box.minX), ah / (box.maxY - box.minY)));
      const cx = (box.minX + box.maxX) / 2;
      const cy = (box.minY + box.maxY) / 2;
      const minX = cx - (left + aw / 2) / s;
      const minY = cy - (top + ah / 2) / s;
      return { minX, minY, maxX: minX + v.width / s, maxY: minY + v.height / s };
    }

    const loop = ctx.createLoop({ update, render });

    // ---------- tombol kamera di atas kanvas ----------
    const camBox = ui.el('div', { class: 'rute-cam', role: 'group', 'aria-label': 'Tampilan peta' });
    const camBtn = (label, html, onClick) => {
      const b = ui.el('button', { type: 'button', 'aria-label': label, title: label, html });
      b.addEventListener('click', (e) => {
        onClick();
        if (e.detail > 0) b.blur();
      });
      camBox.append(b);
      return b;
    };
    const zoomInBtn = camBtn('Perbesar peta', '<span aria-hidden="true">+</span>', () => zoomBy(1.6));
    const zoomOutBtn = camBtn('Perkecil peta', '<span aria-hidden="true">−</span>', () => zoomBy(1 / 1.6));
    const fitBtn = camBtn('Tampilkan start dan tujuan', icon('route'), () => setCam('fit'));
    const followBtn = camBtn('Ikuti mobil', icon('car'), () => setCam(cam === 'follow' ? 'fit' : 'follow'));
    ctx.stage.append(camBox);

    // ---------- panel kontrol ----------
    const endGroup = ui.group(ctx.controls, { title: 'Start dan tujuan' });
    const makeSelect = (which, text) => {
      const id = ui.uniqueId(`rute-${which}`);
      const sel = ui.el('select', { id, class: 'rute-select' });
      for (const p of PLACES) sel.append(ui.el('option', { value: p.id, text: p.name }));
      sel.addEventListener('change', () => {
        if (sel.value === 'peta') return;
        setEndpoint(which, { place: sel.value });
      });
      endGroup.append(ui.el('div', { class: 'rute-field' }, ui.el('label', { for: id, text }), sel));
      return sel;
    };
    const startSel = makeSelect('start', 'Start');
    const goalSel = makeSelect('goal', 'Tujuan');
    const endRow = ui.buttonRow(endGroup, { className: 'quick-row' });
    const swapBtn = ui.button(endRow, { label: 'Tukar start dan tujuan', icon: 'reset', small: true, onClick: () => swapEnds() });

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
      min: 100,
      max: 3000,
      step: 100,
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
    const jamCtl = ui.segmented(toolGroup, {
      label: 'Pengali biaya macet',
      options: [
        { value: 2, label: '2 kali' },
        { value: 4, label: '4 kali' },
        { value: 8, label: '8 kali' },
      ],
      value: jamLevel,
      onChange: (v) => (jamLevel = v),
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
    const closeBtn = ui.button(quickRow, { label: 'Tutup jalan di rute', icon: 'lock', small: true, onClick: () => act(closeOnRoute) });
    const jamBtn = ui.button(quickRow, { label: 'Macet di rute', icon: 'gauge', small: true, onClick: () => act(jamOnRoute) });
    const clearBtn = ui.button(quickRow, { label: 'Buka semua jalan', icon: 'reset', small: true, onClick: () => clearStretches() });

    const carGroup = ui.group(ctx.controls, { title: 'Mobil otonom' });
    const driveRow = ui.buttonRow(carGroup);
    const driveBtn = ui.button(driveRow, { label: 'Jalankan mobil', icon: 'car', onClick: () => act(toggleDrive) });
    const lapseCtl = ui.segmented(carGroup, {
      label: 'Percepatan waktu',
      options: [
        { value: 5, label: '5 kali' },
        { value: 15, label: '15 kali' },
        { value: 30, label: '30 kali' },
      ],
      value: lapse,
      onChange: (v) => (lapse = v),
    });
    const carReadouts = ui.readoutGrid(carGroup);
    const carStateOut = ui.readout(carReadouts, { label: 'Keadaan', value: 'di start' });
    const carSpeedOut = ui.readout(carReadouts, { label: 'Kecepatan', value: '-' });
    const carDistOut = ui.readout(carReadouts, { label: 'Sisa jarak', value: '-' });
    const carLeftOut = ui.readout(carReadouts, { label: 'Sisa waktu (perkiraan)', value: '-' });
    const carTimeOut = ui.readout(carReadouts, { label: 'Waktu perjalanan', value: '-' });
    const lightOut = ui.readout(carReadouts, { label: 'Lampu berikutnya', value: '-' });
    const shieldOut = ui.readout(carReadouts, { label: 'Perisai keselamatan', value: 'siaga' });
    const redOut = ui.readout(carReadouts, { label: 'Terobos lampu merah', value: '0' });
    redOut.el.classList.add('safety-out');
    carGroup.append(
      ui.el('p', {
        class: 'ctl-hint',
        text: 'Mobil berjalan di lajur kiri dengan perkiraan kecepatan tiap jalan. Posisi lampu lalu lintas asli dari OSM, fasenya disimulasikan. Waktu perjalanan dihitung dalam waktu simulasi.',
      }),
    );

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
        { key: 'time', label: 'Perkiraan waktu', align: 'right' },
      ],
    });
    const compareNote = ui.el('p', { class: 'ctl-hint compare-note' });
    compareGroup.append(compareNote);

    const keyGroup = ui.group(ctx.controls, { title: 'Keterangan peta' });
    ui.legend(keyGroup, [
      { color: OPEN_COLOR, label: 'Antrean', shape: 'dot' },
      { color: CLOSED_COLOR, label: 'Dijelajahi', shape: 'line' },
      { color: PATH_COLOR, label: 'Rute', shape: 'line' },
      { color: JAM_COLORS[4], label: 'Macet', shape: 'line' },
      { color: COLORS.danger, label: 'Ditutup', shape: 'line' },
      { color: COLORS.lightYellow, label: 'Lampu lalu lintas (OSM)', shape: 'dot' },
    ]);
    const onewayCtl = ui.toggle(keyGroup, {
      label: 'Tandai jalan satu arah',
      color: ONEWAY_COLOR,
      checked: showOneway,
      onChange: (on) => (showOneway = on),
    });
    keyGroup.append(
      ui.el('p', {
        class: 'ctl-hint',
        text: 'Geser peta dengan mouse. Perbesar dengan tombol + atau Ctrl sambil menggulir. Di ponsel, peta bisa digeser setelah diperbesar. Lebar jalan dan kecepatan adalah perkiraan dari kelas jalan.',
      }),
    );

    // HUD di atas kanvas
    const algoChip = ui.hudChip(ctx.hud, { label: 'Algoritma', color: COLORS.accent });
    const nodesChip = ui.hudChip(ctx.hud, { label: 'Dijelajahi', color: CLOSED_COLOR });
    const carChip = ui.hudChip(ctx.hud, { label: 'Mobil', color: COLORS.ego });

    // ---------- kamera ----------
    const finePointer = !!window.matchMedia?.('(pointer: fine)').matches;
    let panOff = null;
    let panStart = null;

    function setCam(mode) {
      if (mode === 'follow' && !route) mode = 'fit';
      cam = mode;
      if (mode === 'fit') view.fit(fitBounds, 0);
      else view.fit(null);
      if (mode === 'follow') {
        followDefault();
        view.setScale(followScale);
        view.centerOn(car.x, car.y);
      }
      syncPan();
      paintCamButtons();
    }

    function paintCamButtons() {
      fitBtn.setAttribute('aria-pressed', String(cam === 'fit'));
      followBtn.setAttribute('aria-pressed', String(cam === 'follow'));
      followBtn.disabled = !route;
      zoomInBtn.disabled = (cam === 'follow' ? followScale : view.camera.scale) >= MAX_SCALE - 1e-6;
      zoomOutBtn.disabled = (cam === 'follow' ? followScale : view.camera.scale) <= MIN_SCALE + 1e-6;
    }

    function zoomBy(k, sx = view.width / 2, sy = view.height / 2) {
      if (cam === 'follow') {
        followScale = clamp(followScale * k, MIN_SCALE, MAX_SCALE);
        view.setScale(followScale);
        paintCamButtons();
        return;
      }
      const before = view.screenToWorld(sx, sy);
      if (cam === 'fit') {
        cam = 'manual';
        view.fit(null);
        syncPan();
      }
      view.setScale(clamp(view.camera.scale * k, MIN_SCALE, MAX_SCALE));
      const after = view.screenToWorld(sx, sy);
      view.centerOn(view.camera.x + before.x - after.x, view.camera.y + before.y - after.y);
      paintCamButtons();
    }

    // Menggeser peta: selalu dengan mouse; dengan sentuhan hanya setelah peta diperbesar, supaya di
    // ponsel halaman tetap bisa digulir lewat kanvas selama peta menampilkan start dan tujuan.
    const panHandlers = {
      down(e) {
        panStart = { sx: e.sx, sy: e.sy, cx: view.camera.x, cy: view.camera.y };
      },
      drag(e) {
        if (!panStart) return;
        if (cam !== 'manual') {
          const keep = { x: view.camera.x, y: view.camera.y };
          cam = 'manual';
          view.fit(null);
          view.centerOn(keep.x, keep.y);
          paintCamButtons();
        }
        view.centerOn(panStart.cx - (e.sx - panStart.sx) / view.camera.scale, panStart.cy - (e.sy - panStart.sy) / view.camera.scale);
        view.setCursor('grabbing');
      },
      up() {
        panStart = null;
      },
    };
    function syncPan() {
      const want = finePointer || cam !== 'fit';
      if (want && !panOff) panOff = view.onPointer(panHandlers);
      if (!want && panOff) {
        panOff();
        panOff = null;
        panStart = null;
      }
    }
    ctx.listen(
      view.canvas,
      'wheel',
      (e) => {
        if (!e.ctrlKey && !e.metaKey) return; // gulir biasa tetap menggulir halaman
        e.preventDefault();
        const r = view.canvas.getBoundingClientRect();
        zoomBy(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
      },
      { passive: false },
    );

    // ---------- penunjuk di kanvas ----------
    view.onPointer({
      tap: (e) => handleTap(e),
      move(e) {
        if (panStart && view.pointer) return;
        if (e.pointerType !== 'mouse' || tool === 'pindah') {
          hover = null;
          view.setCursor(tool === 'pindah' ? 'crosshair' : finePointer ? 'grab' : 'default');
          return;
        }
        const road = pickRoad(e.x, e.y, e.hitRadius);
        if (!road) {
          hover = null;
          view.setCursor('grab');
          return;
        }
        if (!hover || hover.road !== road || hover.kind !== tool) {
          const existing = stretchOfRoad.get(road.id);
          const st = existing || stretchFrom(map, road, { usable: (r) => inGraph(r) && !stretchOfRoad.has(r.id) });
          hover = { road, kind: tool, stretch: st };
        }
        view.setCursor('pointer');
      },
      leave() {
        hover = null;
      },
    });

    function distToRoad(road, x, y) {
      const p = road.points;
      let best = Infinity;
      for (let i = 0; i < p.length - 1; i++) {
        const q = closestPointOnSegment(x, y, p[i].x, p[i].y, p[i + 1].x, p[i + 1].y);
        best = Math.min(best, Math.hypot(q.x - x, q.y - y));
      }
      return best;
    }

    /** Jalan yang dimaksud klik: jalan di rute lebih dulu, lalu jalan besar saat peta diperkecil. */
    function pickRoad(x, y, radius) {
      const tol = Math.max(radius, view.px(12));
      if (route) {
        let best = null;
        for (const e of route.edges) {
          const b = e.road.bbox;
          if (x < b.minX - tol || x > b.maxX + tol || y < b.minY - tol || y > b.maxY + tol) continue;
          const d = distToRoad(e.road, x, y);
          if (d <= tol && (!best || d < best.d)) best = { road: e.road, d };
        }
        if (best) return best.road;
      }
      const hit = graph.nearestRoad(x, y, { maxDist: tol });
      if (!hit) return null;
      if (view.camera.scale < STREET_SCALE && hit.road.rank > 6) {
        const major = graph.nearestRoad(x, y, { maxDist: tol, filter: (r) => r.rank <= 6 });
        if (major && major.dist < hit.dist + tol * 0.5) return major.road;
      }
      return hit.road;
    }

    function handleTap(e) {
      if (tool === 'pindah') {
        tapMove(e);
        return;
      }
      const road = pickRoad(e.x, e.y, e.hitRadius);
      if (!road) {
        say('Ketuk lebih dekat ke sebuah jalan.');
        return;
      }
      if (tool === 'tutup') toggleClosure(road);
      else toggleJam(road);
      hover = null;
    }

    function tapMove(e) {
      if (isDriving()) {
        say('Batalkan perjalanan dulu sebelum memindahkan start atau tujuan.');
        return;
      }
      const tol = Math.max(e.hitRadius, view.px(14));
      let best = null;
      for (const p of PLACES) {
        const n = nodePos(placeNode.get(p.id));
        const d = Math.hypot(n.x - e.x, n.y - e.y);
        if (d <= tol && (!best || d < best.d)) best = { p, d };
      }
      if (best) {
        setEndpoint(moveTarget, { place: best.p.id });
        return;
      }
      const hit = graph.nearestNode(e.x, e.y, { maxDist: Math.max(tol * 2, 40) });
      if (!hit) {
        say('Ketuk lebih dekat ke sebuah jalan.');
        return;
      }
      setEndpoint(moveTarget, { node: hit.id, label: nodeLabel(map, hit.id) });
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

    function say(text, seconds = 3.5) {
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
      jamCtl.el.hidden = v !== 'macet';
      hover = null;
    }

    function clearOverlay() {
      overlay = null;
      layer.clear();
    }

    function fillLayer(s) {
      layer.clear();
      for (const n of s.closed) {
        const prev = s.cameFrom.get(n);
        if (prev === undefined) continue;
        const e = graph.edge(prev, n);
        if (e) layer.add(graph.edgePoints(e));
      }
    }

    function makeSearch(from, to, algo = algorithm) {
      return { s: graph.search(from, to, { algorithm: algo, tieBreak: 'g' }), algorithm: algo, from, to, key: currentKey(), acc: 0 };
    }

    function describeRoute(built, algo, key) {
      return {
        ...built,
        algorithm: algo,
        key,
        stale: false,
        replanned: false,
        length: graph.routeLength(built.nodes),
        time: graph.routeTime(built.nodes),
      };
    }

    function startSearch({ instant = false } = {}) {
      if (isDriving()) return;
      search = makeSearch(ends.start.node, ends.goal.node);
      layer.clear();
      overlay = { search: search.s, algorithm: search.algorithm, stale: false, flashUntil: null };
      route = null;
      banner = null;
      notice = null;
      driver.setRoute(null);
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
      fillLayer(s);
      const res = { algorithm: search.algorithm, found: s.found, expanded: s.expanded, open: s.open.size, key, length: null, time: null };
      let built = s.found ? buildRoute(graph, s.path) : null;
      if (built) {
        route = describeRoute(built, search.algorithm, key);
        res.length = route.length;
        res.time = route.time;
        driver.setRoute(route);
        afterRouteFound(route);
      } else {
        route = null;
        driver.setRoute(null);
      }
      results[search.algorithm] = res;
      lastResult = res;
      search = null;
      paintCamButtons();
    }

    /** Periksa syarat tugas setelah ada rute baru. */
    function afterRouteFound(r, fromEdge = 0) {
      const ids = new Set(r.edges.slice(fromEdge).map((e) => e.road.id));
      const still = [...flags.closedOnRoute].filter((id) => stretchOfRoad.get(id)?.kind === 'tutup');
      if (still.length) flags.closureReplanned = true;
      const jammed = [...flags.jamOnRoute].filter((id) => stretchOfRoad.get(id)?.kind === 'macet');
      if (jammed.length) {
        const used = jammed.filter((id) => ids.has(id));
        flags.jamStillUsed = used.length > 0;
        if (!used.length) flags.jamAvoided = true;
      }
    }

    function presetRoute() {
      const job = makeSearch(ends.start.node, ends.goal.node, 'astar');
      job.s.run();
      if (!job.s.found) return;
      const built = buildRoute(graph, job.s.path);
      if (!built) return;
      route = describeRoute(built, 'astar', job.key);
      lastResult = { algorithm: 'astar', found: true, expanded: job.s.expanded, open: job.s.open.size, key: job.key, length: route.length, time: route.time };
      // catat juga di tabel perbandingan, supaya baris A* sesuai dengan rute yang terlihat
      results.astar = lastResult;
      driver.setRoute(route);
    }

    // ---------- tutup jalan dan macet ----------
    const touchesEnd = (r) => [ends.start.node, ends.goal.node].some((n) => r.a === n || r.b === n);

    /** Ruas yang tidak boleh ditutup lagi karena mobil sudah pasti melewatinya. */
    function protectedRoads() {
      const out = new Set();
      if (!isDriving() || !route) return out;
      const i = driver.edgeIndex();
      const c = driver.commitIndex();
      for (let k = i; k < Math.min(route.edges.length, Math.max(c, i + 1)); k++) out.add(route.edges[k].road.id);
      return out;
    }

    function addStretch(kind, st, mult = 1) {
      const rec = { id: ++stretchSeq, kind, mult, roads: st.roads, label: st.label, length: st.roads.reduce((a, r) => a + r.length, 0) };
      stretches.set(rec.id, rec);
      for (const r of rec.roads) {
        stretchOfRoad.set(r.id, rec);
        if (kind === 'tutup') graph.closeRoad(r, true);
        else graph.setRoadMultiplier(r, mult);
      }
      return rec;
    }

    function removeStretch(rec) {
      stretches.delete(rec.id);
      for (const r of rec.roads) {
        if (stretchOfRoad.get(r.id) === rec) stretchOfRoad.delete(r.id);
        if (rec.kind === 'tutup') graph.closeRoad(r, false);
        else graph.setRoadMultiplier(r, 1);
      }
    }

    function toggleClosure(road) {
      const existing = stretchOfRoad.get(road.id);
      if (existing && existing.kind === 'tutup') {
        removeStretch(existing);
        mapChanged('open', existing);
        return;
      }
      if (!inGraph(road)) {
        say('Jalan ini tidak dipakai untuk rute mobil.');
        return;
      }
      if (touchesEnd(road)) {
        say('Jalan yang menyentuh start atau tujuan tidak bisa ditutup.');
        return;
      }
      const guard = protectedRoads();
      if (guard.has(road.id)) {
        say('Mobil sudah terlalu dekat dengan jalan ini. Pilih jalan yang lebih jauh di depan.');
        return;
      }
      if (existing && existing.kind === 'macet') removeStretch(existing);
      const st = stretchFrom(map, road, { usable: (r) => inGraph(r) && !touchesEnd(r) && !guard.has(r.id) && stretchOfRoad.get(r.id)?.kind !== 'tutup' });
      // macet yang tertimpa penutupan dihapus dari ruas itu
      for (const r of st.roads) {
        const j = stretchOfRoad.get(r.id);
        if (j && j.kind === 'macet') {
          j.roads = j.roads.filter((x) => x !== r);
          stretchOfRoad.delete(r.id);
          graph.setRoadMultiplier(r, 1);
          if (!j.roads.length) stretches.delete(j.id);
        }
      }
      const rec = addStretch('tutup', st);
      if (route && !isDriving()) {
        const ids = new Set(route.edges.map((e) => e.road.id));
        for (const r of rec.roads) if (ids.has(r.id)) flags.closedOnRoute.add(r.id);
      }
      mapChanged('close', rec);
    }

    function toggleJam(road) {
      const existing = stretchOfRoad.get(road.id);
      if (existing && existing.kind === 'tutup') {
        say('Jalan ini sedang ditutup. Buka dulu kalau mau menandainya macet.');
        return;
      }
      if (existing && existing.kind === 'macet') {
        removeStretch(existing);
        if (existing.mult !== jamLevel) {
          const rec = addStretch('macet', existing, jamLevel);
          markJamOnRoute(rec);
          mapChanged('jam', rec);
        } else mapChanged('unjam', existing);
        return;
      }
      if (!inGraph(road)) {
        say('Jalan ini tidak dipakai untuk rute mobil.');
        return;
      }
      const st = stretchFrom(map, road, { usable: (r) => inGraph(r) && !stretchOfRoad.has(r.id) });
      const rec = addStretch('macet', st, jamLevel);
      markJamOnRoute(rec);
      mapChanged('jam', rec);
    }

    function markJamOnRoute(rec) {
      if (!route || isDriving()) return;
      const ids = new Set(route.edges.map((e) => e.road.id));
      for (const r of rec.roads) if (ids.has(r.id)) flags.jamOnRoute.add(r.id);
    }

    function clearStretches() {
      if (!stretches.size) {
        say('Belum ada jalan yang ditutup atau ditandai macet.');
        return;
      }
      for (const rec of [...stretches.values()]) removeStretch(rec);
      mapChanged('open', null);
    }

    function mapChanged(kind, rec) {
      hover = null;
      if (search) {
        search = null;
        clearOverlay();
        say('Peta berubah, jadi pencarian dihentikan. Tekan Cari rute lagi.');
      }
      if (route) driver.refresh();
      if (isDriving()) liveChange(kind, rec);
      else {
        if (route) route.stale = true;
        if (overlay) overlay.stale = true;
        if (rec && kind === 'close') say(`${capital(rec.label)} ditutup sepanjang ${fmtDist(rec.length)}. Tekan Cari rute untuk rute baru.`);
        else if (rec && kind === 'jam') say(`${capital(rec.label)} ditandai macet (biaya ${rec.mult} kali) sepanjang ${fmtDist(rec.length)}.`);
      }
      refreshPanels(0);
    }

    const capital = (t) => t.charAt(0).toUpperCase() + t.slice(1);

    // ---------- start dan tujuan ----------
    function setEndpoint(which, spec) {
      if (isDriving()) {
        say('Batalkan perjalanan dulu sebelum memindahkan start atau tujuan.');
        syncSelects();
        return;
      }
      const node = spec.place ? placeNode.get(spec.place) : spec.node;
      const other = which === 'start' ? ends.goal : ends.start;
      if (node === other.node) {
        say('Start dan tujuan harus berada di tempat yang berbeda.');
        syncSelects();
        return;
      }
      ends[which] = { place: spec.place || null, node, label: spec.place ? placeById.get(spec.place).name : spec.label };
      resetPlan();
      syncSelects();
      if (cam === 'fit') view.fit(fitBounds, 0);
      say(`${which === 'start' ? 'Start' : 'Tujuan'} sekarang ${ends[which].label}. Tekan Cari rute untuk rute baru.`);
    }

    function swapEnds() {
      if (isDriving()) {
        say('Batalkan perjalanan dulu sebelum menukar start dan tujuan.');
        return;
      }
      const s = ends.start;
      ends.start = ends.goal;
      ends.goal = s;
      resetPlan();
      syncSelects();
      if (cam === 'fit') view.fit(fitBounds, 0);
      say('Start dan tujuan ditukar. Jalan satu arah bisa membuat rute pulang berbeda dari rute pergi.');
    }

    function resetPlan() {
      search = null;
      clearOverlay();
      route = null;
      lastResult = null;
      banner = null;
      driver.setRoute(null);
      if (cam === 'follow') setCam('fit');
      paintCamButtons();
    }

    function syncSelects() {
      for (const [which, sel] of [
        ['start', startSel],
        ['goal', goalSel],
      ]) {
        const e = ends[which];
        let custom = sel.querySelector('option[value="peta"]');
        if (e.place) {
          custom?.remove();
          sel.value = e.place;
        } else {
          if (!custom) {
            custom = ui.el('option', { value: 'peta' });
            sel.append(custom);
          }
          custom.textContent = `Titik di peta: ${e.label}`;
          sel.value = 'peta';
        }
        sel.disabled = isDriving();
      }
    }

    // ---------- mobil ----------
    function toggleDrive() {
      if (isDriving()) {
        // batalkan perjalanan: mobil kembali ke start
        if (route) route.stale = route.stale || route.replanned;
        driver.setRoute(route && !route.stale ? route : null);
        banner = null;
        say('Perjalanan dibatalkan. Mobil kembali ke start.');
        refreshPanels(0);
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
      driver.setRoute(route);
      driver.start();
      clearOverlay();
      banner = null;
      notice = null;
      refreshPanels(0);
    }

    function liveChange(kind, rec) {
      if (car.state === 'blocked') {
        if (kind === 'open') replanFrom(route.nodes.length - 1, kind);
        return;
      }
      if (!rec) return;
      const c = driver.commitIndex();
      const ahead = new Set(route.edges.slice(c).map((e) => e.road.id));
      if ((kind === 'close' || kind === 'jam') && rec.roads.some((r) => ahead.has(r.id))) replanFrom(c, kind);
      else if (kind === 'close') say('Jalan yang ditutup tidak ada di rute depan mobil, jadi rutenya tetap.');
    }

    /** Hitung ulang rute dari node ke-c di rute mobil (simpang yang masih sempat dibelokkan). */
    function replanFrom(c, kind) {
      const from = route.nodes[c];
      const goal = ends.goal.node;
      const prev = c > 0 ? route.nodes[c - 1] : null;
      // coba dulu tanpa putar balik di simpang itu
      const back = prev != null ? graph.edge(from, prev) : null;
      const blockBack = !!back && !back.blocked;
      if (blockBack) back.blocked = true;
      let job = makeSearch(from, goal);
      job.s.run();
      if (blockBack) back.blocked = false;
      if (!job.s.found && blockBack) {
        job = makeSearch(from, goal);
        job.s.run();
      }
      const front = car.s + HALF;
      const sKeep = Math.min(route.path.length, Math.max(front + 0.5, route.nodeS[c] - setbackOf(from) - 1));
      lastResult = { algorithm: job.algorithm, found: job.s.found, expanded: job.s.expanded, open: job.s.open.size, key: job.key, length: null, time: null, replan: true };
      overlay = { search: job.s, algorithm: job.algorithm, stale: false, flashUntil: loop.time + 2.5 };
      fillLayer(job.s);
      if (job.s.found) {
        const full = buildRoute(graph, route.nodes.slice(0, c + 1).concat(job.s.path.slice(1)));
        const joined = full && joinAt(route, full, sKeep, c);
        if (joined) {
          route = { ...describeRoute(joined, job.algorithm, job.key), replanned: true };
          driver.replace(route, 'driving');
          lastResult.length = graph.routeLength(job.s.path);
          lastResult.time = graph.routeTime(job.s.path);
          banner = { text: 'Rute dihitung ulang', tone: 'warn', until: loop.time + 3 };
          if (kind === 'close') flags.liveReplan = true;
          afterRouteFound(route, c);
          return;
        }
      }
      // tidak ada rute: berhenti sebelum simpang c dan menunggu
      const prefix = buildRoute(graph, route.nodes.slice(0, c + 1));
      const joined = prefix && joinAt(route, prefix, sKeep, c);
      if (joined) {
        joined.stopAt = Math.max(car.s, joined.nodeS[c] - setbackOf(from) - 0.5 - HALF);
        route = { ...describeRoute(joined, job.algorithm, job.key), stale: true, replanned: true };
        driver.replace(route, 'blocked');
      }
      banner = { text: 'Tidak ada rute ke tujuan', tone: 'danger', until: loop.time + 3 };
    }

    // ---------- tombol cepat (juga alternatif tanpa mouse) ----------
    /** Calon jalan di rute (mulai dari sisi ke-fromIdx), diurutkan: jalan besar di sekitar sasaran dulu. */
    function routeCandidates(fromIdx, ok) {
      if (!route) return [];
      const n = route.edges.length;
      const target = isDriving() ? fromIdx + 1 : Math.floor(n / 2);
      const out = [];
      for (let i = fromIdx; i < n; i++) {
        const r = route.edges[i].road;
        if (!ok(r)) continue;
        const score = (r.rank <= 6 ? 0 : 400) + Math.abs(i - target) * (isDriving() ? 30 : 4) + (r.length < 25 ? 60 : 0);
        out.push({ road: r, score });
      }
      return out.sort((p, q) => p.score - q.score).map((x) => x.road);
    }

    function closeOnRoute() {
      if (!route) {
        say('Belum ada rute. Tekan Cari rute dulu.');
        return;
      }
      if (car.state === 'blocked') {
        say('Mobil sedang menunggu karena tidak ada rute. Buka lagi jalan yang ditutup.');
        return;
      }
      const guard = protectedRoads();
      const from = isDriving() ? driver.commitIndex() : 1;
      const fromNode = isDriving() ? route.nodes[from] : ends.start.node;
      const usable = (r) => inGraph(r) && !touchesEnd(r) && !guard.has(r.id) && stretchOfRoad.get(r.id)?.kind !== 'tutup';
      const cands = routeCandidates(from, (r) => usable(r) && !stretchOfRoad.has(r.id)).slice(0, 8);
      // pilih jalan yang penutupannya masih menyisakan rute lain, supaya hitung ulang terlihat
      for (const road of cands) {
        const st = stretchFrom(map, road, { usable });
        for (const r of st.roads) graph.closeRoad(r, true);
        const ok = graph.findRoute(fromNode, ends.goal.node, { algorithm: 'astar' }).found;
        for (const r of st.roads) graph.closeRoad(r, false);
        if (ok) {
          toggleClosure(road);
          return;
        }
      }
      if (cands.length) toggleClosure(cands[0]);
      else say('Mobil sudah terlalu dekat dengan tujuan.');
    }

    function jamOnRoute() {
      if (!route) {
        say('Belum ada rute. Tekan Cari rute dulu.');
        return;
      }
      const from = isDriving() ? driver.commitIndex() : 1;
      const road = routeCandidates(from, (r) => !stretchOfRoad.has(r.id) && !touchesEnd(r))[0];
      if (!road) {
        say('Tidak ada jalan lagi di rute yang bisa ditandai macet.');
        return;
      }
      toggleJam(road);
    }

    // ---------- loop ----------
    function addTreeEdge(s, n) {
      const prev = s.cameFrom.get(n);
      if (prev === undefined) return;
      const e = graph.edge(prev, n);
      if (e) layer.add(graph.edgePoints(e));
    }

    function update(dt) {
      if (search) {
        const s = search.s;
        search.acc += dt * nodesPerSec;
        let n = 0;
        while (search.acc >= 1 && !s.done && n < 800) {
          const before = s.expanded;
          s.step();
          if (s.expanded > before) addTreeEdge(s, s.current);
          search.acc -= 1;
          n++;
        }
        if (s.done) finishSearch();
      }
      // percepatan waktu: lebih banyak langkah fisika dengan dt tetap
      for (let i = 0; i < lapse; i++) {
        simT += DRIVE.DT;
        driver.tick(DRIVE.DT, simT);
      }
      if (car.state !== wasState) {
        if (car.state === 'arrived') banner = { text: 'Sampai di tujuan', tone: 'ok', until: loop.time + 3 };
        wasState = car.state;
      }
    }

    // ---------- menggambar ----------
    let lastPanel = 0;
    let onewayPath = null;

    // Saat kamera mengikuti mobil, peta tidak boleh bergeser terlalu cepat di layar. Setiap kali
    // percepatan waktu atau kecepatan shell berubah, skala awal dipilih supaya mobil berkecepatan
    // sekitar 32 km/jam bergerak paling cepat sekitar 300 piksel per detik. Tombol + dan - tetap bisa
    // mengubahnya sesudah itu.
    let followRate = 0;
    function followDefault() {
      const rate = lapse * (ctx.speed || 1);
      followRate = rate;
      followScale = clamp(Math.min(FOLLOW_SCALE, 300 / (9 * rate)), 0.4, FOLLOW_SCALE);
    }

    function render() {
      if (cam === 'follow' && route) {
        if (lapse * (ctx.speed || 1) !== followRate) followDefault();
        view.setScale(followScale);
        view.centerOn(car.x, car.y);
      }
      const g = view.begin(MAP_STYLE.ground);
      renderer.draw(g, view, { attribution: false });
      if (showOneway) drawOneway(g);
      drawSearch(g);
      drawStretches(g);
      drawRoute(g);
      drawSignals(g, 'ground');
      drawHover(g);
      drawPlaces(g);
      drawEnds(g);
      drawCarAndBanner(g);
      // tiang dan kepala lampu berada di atas jalan, jadi digambar di atas mobil
      drawSignals(g, 'heads');
      labels.draw(g, view);
      drawScaleBarKm(g, view, { x: 12, y: view.height - 12 });
      renderer.drawAttribution(g, view);

      const now = performance.now();
      if (now - lastPanel > 120) {
        refreshPanels(lastPanel ? Math.min(0.5, (now - lastPanel) / 1000) : 0);
        lastPanel = now;
      }
    }

    function drawOneway(g) {
      if (!onewayPath) {
        onewayPath = new Path2D();
        for (const r of map.roads) {
          if (!r.oneway || !r.drivable) continue;
          r.points.forEach((p, i) => (i ? onewayPath.lineTo(p.x, p.y) : onewayPath.moveTo(p.x, p.y)));
        }
      }
      g.save();
      g.strokeStyle = withAlpha(ONEWAY_COLOR, 0.8);
      g.lineWidth = view.px(view.camera.scale < STREET_SCALE ? 2 : 3);
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.stroke(onewayPath);
      g.restore();
    }

    function drawStretches(g) {
      for (const rec of stretches.values()) {
        const color = rec.kind === 'tutup' ? COLORS.danger : JAM_COLORS[rec.mult] || JAM_COLORS[4];
        for (const r of rec.roads) {
          highlightRoad(g, view, r, rec.kind === 'tutup' ? { color, width: 5, dash: [6, 4] } : { color, width: rec.mult >= 8 ? 7 : rec.mult >= 4 ? 6 : 5, alpha: 0.9 });
        }
      }
      // penanda "ditutup" di tengah tiap potongan
      for (const rec of stretches.values()) {
        if (rec.kind !== 'tutup') continue;
        const mid = stretchMid(rec);
        const r = view.px(8);
        g.save();
        g.fillStyle = COLORS.danger;
        g.strokeStyle = 'rgba(11, 18, 32, 0.9)';
        g.lineWidth = view.px(2);
        g.beginPath();
        g.arc(mid.x, mid.y, r, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        g.fillStyle = '#ffffff';
        g.fillRect(mid.x - r * 0.6, mid.y - r * 0.18, r * 1.2, r * 0.36);
        g.restore();
      }
    }

    function stretchMid(rec) {
      if (!rec._mid) {
        const best = rec.roads.reduce((a, r) => (r.length > a.length ? r : a));
        rec._mid = new Path(best.points).sample(best.length / 2);
      }
      return rec._mid;
    }

    function drawSearch(g) {
      if (!overlay) return;
      let alpha = overlay.stale ? 0.35 : 1;
      if (overlay.flashUntil != null) {
        const left = overlay.flashUntil - loop.time;
        if (left <= 0) {
          clearOverlay();
          return;
        }
        alpha = Math.min(1, left / 1.2) * 0.9;
      } else if (isDriving() || car.state === 'arrived') return;
      layer.draw(g, view, { alpha });
      const s = overlay.search;
      g.save();
      g.globalAlpha = alpha;
      g.fillStyle = OPEN_COLOR;
      g.beginPath();
      const r = view.px(2.6);
      for (const id of s.open) {
        const n = nodePos(id);
        if (!n) continue;
        g.moveTo(n.x + r, n.y);
        g.arc(n.x, n.y, r, 0, Math.PI * 2);
      }
      g.fill();
      g.restore();
    }

    function drawChevrons(g, path, s0, s1) {
      const step = view.px(110);
      if (s1 - s0 < step * 0.6) return;
      const size = view.px(5);
      g.save();
      g.fillStyle = 'rgba(4, 47, 46, 0.95)';
      for (let s = s0 + step / 2; s < s1; s += step) {
        const p = path.sample(s);
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.heading);
        g.beginPath();
        g.moveTo(size * 0.9, 0);
        g.lineTo(-size * 0.6, -size * 0.75);
        g.lineTo(-size * 0.2, 0);
        g.lineTo(-size * 0.6, size * 0.75);
        g.closePath();
        g.fill();
        g.restore();
      }
      g.restore();
    }

    function drawRoute(g) {
      if (!route) return;
      const path = route.path;
      if (route.stale && !isDriving() && car.state !== 'arrived') {
        highlightRoad(g, view, path.points, { color: '#94a3b8', width: 3, dash: [7, 6], alpha: 0.85, casing: false });
        return;
      }
      if (isDriving() || car.state === 'arrived') {
        const s = clamp(car.s, 0, path.length);
        if (s > 0.5) highlightRoad(g, view, slicePolyline(path.points, 0, s), { color: PATH_COLOR, width: 3, alpha: 0.35, casing: false });
        const end = Math.min(path.length, route.stopAt ?? path.length);
        if (end - s > 0.5) {
          highlightRoad(g, view, slicePolyline(path.points, s, end), { color: PATH_COLOR, width: 5 });
          drawChevrons(g, path, s, end);
        }
        return;
      }
      highlightRoad(g, view, path.points, { color: PATH_COLOR, width: 5 });
      drawChevrons(g, path, 0, path.length);
    }

    function drawSignals(g, layerName) {
      const street = view.camera.scale >= STREET_SCALE;
      if (layerName === 'ground') {
        drawSignalDots(g, view, map.signals, { size: street ? 3.5 : 2.4 });
        if (street && route) drawStopLines(g);
        return;
      }
      if (!route) return;
      const lines = driver.lines;
      if (!street) {
        // peta jauh: hanya lampu berikutnya di depan mobil yang diberi warna, supaya tidak berkedip
        if (!isDriving()) return;
        const nx = driver.nextLine(simT);
        if (!nx || nx.dist > 400) return;
        const col = nx.state === 'red' ? COLORS.lightRed : nx.state === 'yellow' ? COLORS.lightYellow : COLORS.lightGreen;
        g.save();
        g.fillStyle = 'rgba(11, 18, 32, 0.9)';
        g.beginPath();
        g.arc(nx.line.x, nx.line.y, view.px(7), 0, Math.PI * 2);
        g.fill();
        g.fillStyle = col;
        g.beginPath();
        g.arc(nx.line.x, nx.line.y, view.px(5), 0, Math.PI * 2);
        g.fill();
        g.restore();
        return;
      }
      const vb = view.visibleBounds();
      for (const ln of lines) {
        if (ln.x < vb.minX - 30 || ln.x > vb.maxX + 30 || ln.y < vb.minY - 30 || ln.y > vb.maxY + 30) continue;
        const st = driver.stateOf(ln, simT);
        const nx = Math.sin(ln.heading);
        const ny = -Math.cos(ln.heading);
        // tiang di tepi kiri, lengan di atas lajur, lampu menghadap mobil yang datang
        const fx = Math.cos(ln.heading);
        const fy = Math.sin(ln.heading);
        const off = ln.curb + 0.7;
        const pole = { x: ln.x + nx * off + fx * 1.2, y: ln.y + ny * off + fy * 1.2, heading: ln.heading + Math.PI, state: st };
        drawTrafficSignal(g, pole, { arm: off + 0.6, view, minPx: 26 });
      }
    }

    /** Garis henti putih di lajur mobil, untuk setiap lampu di rute yang terlihat. */
    function drawStopLines(g) {
      const vb = view.visibleBounds();
      g.save();
      g.strokeStyle = 'rgba(241, 245, 249, 0.9)';
      g.lineWidth = Math.max(0.35, view.px(2));
      g.beginPath();
      for (const ln of driver.lines) {
        if (ln.x < vb.minX - 10 || ln.x > vb.maxX + 10 || ln.y < vb.minY - 10 || ln.y > vb.maxY + 10) continue;
        const nx = Math.sin(ln.heading);
        const ny = -Math.cos(ln.heading);
        g.moveTo(ln.x + nx * 1.6, ln.y + ny * 1.6);
        g.lineTo(ln.x - nx * 1.6, ln.y - ny * 1.6);
      }
      g.stroke();
      g.restore();
    }

    function drawHover(g) {
      if (!hover || tool === 'pindah') return;
      const color = hover.kind === 'tutup' ? COLORS.danger : JAM_COLORS[jamLevel];
      for (const r of hover.stretch.roads) highlightRoad(g, view, r, { color, width: 7, alpha: 0.45, casing: false });
      const p = view.pointer;
      if (p) {
        const existing = stretchOfRoad.get(hover.road.id);
        const verb = hover.kind === 'tutup' ? (existing?.kind === 'tutup' ? 'Buka' : 'Tutup') : existing?.kind === 'macet' ? 'Hapus macet' : 'Macet';
        labels.add(p.x, p.y, `${verb}: ${hover.stretch.label}`, { color, size: 11, dy: -22, priority: 5 });
      }
    }

    function drawPlaces(g) {
      const showNames = view.width >= 560 || view.camera.scale > 0.12;
      g.save();
      for (const p of PLACES) {
        const id = placeNode.get(p.id);
        if (id === ends.start.node || id === ends.goal.node) continue;
        const n = nodePos(id);
        g.fillStyle = 'rgba(11, 18, 32, 0.85)';
        g.beginPath();
        g.arc(n.x, n.y, view.px(5), 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#cbd5e1';
        g.beginPath();
        g.arc(n.x, n.y, view.px(3.2), 0, Math.PI * 2);
        g.fill();
        if (showNames) labels.add(n.x, n.y, p.short, { color: '#cbd5e1', size: 10, dy: -14, optional: true, priority: -1, bg: 'rgba(11, 18, 32, 0.72)' });
      }
      g.restore();
    }

    function drawFlag(g, x, y) {
      const u = view.px(1);
      const h = 22 * u;
      const w = h * 0.6;
      g.save();
      g.strokeStyle = '#e2e8f0';
      g.lineWidth = 2 * u;
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
      g.beginPath();
      g.arc(x, y, 3.5 * u, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }

    function drawEnds(g) {
      const a = nodePos(ends.start.node);
      const b = nodePos(ends.goal.node);
      const u = view.px(1);
      g.save();
      g.fillStyle = withAlpha(COLORS.accent, 0.22);
      g.strokeStyle = COLORS.accent;
      g.lineWidth = 2 * u;
      g.beginPath();
      g.arc(a.x, a.y, 11 * u, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = withAlpha(GOAL_COLOR, 0.22);
      g.beginPath();
      g.arc(b.x, b.y, 11 * u, 0, Math.PI * 2);
      g.fill();
      g.restore();
      drawFlag(g, b.x, b.y);
      endLabel(g, a, `Start: ${ends.start.label}`, COLORS.accent, 24);
      endLabel(g, b, `Tujuan: ${ends.goal.label}`, GOAL_COLOR, -34);
    }

    // Label start dan tujuan tidak boleh tertutup tombol kamera di kanan: geser ke kiri titiknya.
    function endLabel(g, p, text, color, dy) {
      const q = view.worldToScreen(p.x, p.y);
      g.save();
      g.font = `600 11px ${FONT}`;
      const w = g.measureText(text).width + 14;
      g.restore();
      const opts = { color, size: 11, dy, priority: 3 };
      if (q.x + w / 2 > view.width - 62) Object.assign(opts, { align: 'right', dx: -4 });
      else if (q.x - w / 2 < 4) Object.assign(opts, { align: 'left', dx: 4 });
      labels.add(p.x, p.y, text, opts);
    }

    function idlePose() {
      const a = nodePos(ends.start.node);
      const b = nodePos(ends.goal.node);
      return { x: a.x, y: a.y, heading: Math.atan2(b.y - a.y, b.x - a.x) };
    }

    function drawCarAndBanner(g) {
      const pose = route && car.route ? { x: car.x, y: car.y, heading: car.heading } : idlePose();
      const minPx = 20;
      const k = Math.max(1, minPx / (DRIVE.LENGTH * view.camera.scale));
      // Mobil yang digambar lebih besar dari aslinya digeser ke belakang, supaya bumper depan gambar
      // tetap di bumper depan sebenarnya dan tidak tampak melewati garis henti.
      const back = ((k - 1) * DRIVE.LENGTH) / 2;
      const drawn = { x: pose.x - Math.cos(pose.heading) * back, y: pose.y - Math.sin(pose.heading) * back, heading: pose.heading, length: DRIVE.LENGTH, width: DRIVE.WIDTH };
      if (view.camera.scale < STREET_SCALE) {
        // peta jauh: lingkaran gelap di bawah mobil supaya mudah ditemukan
        g.save();
        g.fillStyle = 'rgba(11, 18, 32, 0.85)';
        g.strokeStyle = withAlpha(COLORS.accent, 0.9);
        g.lineWidth = view.px(2);
        g.beginPath();
        g.arc(drawn.x, drawn.y, view.px(15), 0, Math.PI * 2);
        g.fill();
        g.stroke();
        g.restore();
      }
      drawCar(g, drawn, { ego: true, braking: isDriving() && car.braking, view, minPx });
      if (banner && banner.until <= loop.time) banner = null;
      let text = banner?.text;
      let tone = banner?.tone;
      if (!text && isDriving() && car.holdLine) {
        text = 'Berhenti: lampu merah';
        tone = 'danger';
      }
      if (!text) return;
      const color = tone === 'danger' ? '#fca5a5' : tone === 'ok' ? COLORS.ok : COLORS.warn;
      // di bawah mobil, supaya kepala lampu lalu lintas di depan mobil tidak tertutup
      labels.add(drawn.x, drawn.y, text, { color, border: tone === 'danger' ? COLORS.danger : color, size: 12, dy: 30, priority: 6 });
    }

    // ---------- panel (sekitar 8 kali per detik) ----------
    let lastButtons = '';
    const stateNames = { idle: 'di start', driving: 'melaju', arrived: 'sampai', blocked: 'tidak ada rute' };
    const lightNames = { red: 'merah', yellow: 'kuning', green: 'hijau' };

    function carStateText() {
      if (car.state === 'driving' && car.holdLine) return 'menunggu lampu';
      return stateNames[car.state];
    }

    function refreshPanels(realDt) {
      const s = search?.s || null;
      const shown = s ? { expanded: s.expanded, open: s.open.size } : lastResult ? { expanded: lastResult.expanded, open: lastResult.open ?? 0 } : { expanded: 0, open: 0 };
      exploredOut.set(`${fmt(shown.expanded)} node`);
      openOut.set(`${fmt(shown.open)} node`);
      const r = route && !route.stale ? route : null;
      lengthOut.set(r ? fmtDist(r.length) : '-');
      timeOut.set(r ? fmtDur(r.time) : '-');

      // g + h = f untuk node yang terakhir diperiksa (detik)
      const os = overlay?.search;
      if (os && os.current != null && os.g.has(os.current)) {
        const gv = os.g.get(os.current);
        const hv = overlay.algorithm === 'dijkstra' ? 0 : graph.heuristic(os.current, os.goal);
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
          len: ok ? (res.found ? fmtDist(res.length) : 'tidak ada') : '-',
          time: ok ? (res.found ? fmtDur(res.time) : '-') : '-',
          _class: ok ? '' : 'is-muted',
        };
      };
      compareTable.setRows([row('astar'), row('dijkstra')]);
      const a = results.astar?.key === key ? results.astar : null;
      const d = results.dijkstra?.key === key ? results.dijkstra : null;
      let note;
      if (a && d) {
        if (a.found && d.found) {
          const same = Math.abs(a.time - d.time) < 0.5;
          const pct = d.expanded > 0 ? Math.round((100 * a.expanded) / d.expanded) : 100;
          note = a.expanded < d.expanded
            ? `A* cukup memeriksa ${fmt(a.expanded)} node, sekitar ${fmt(pct)} persen dari ${fmt(d.expanded)} node milik Dijkstra.`
            : `Kali ini A* memeriksa ${fmt(a.expanded)} node dan Dijkstra ${fmt(d.expanded)} node.`;
          note += same ? ` Waktu tempuh rutenya sama, ${fmtDur(a.time)}.` : '';
        } else note = `Tidak ada rute ke tujuan. Kedua algoritma memeriksa semua node yang bisa dicapai (${fmt(d.expanded)} node).`;
      } else if (a || d) note = `Sekarang jalankan ${a ? 'Dijkstra' : 'A*'} dengan start, tujuan, dan peta yang sama.`;
      else if (results.astar || results.dijkstra) note = 'Peta, start, atau tujuan sudah berubah. Jalankan kedua algoritma lagi.';
      else note = 'Jalankan kedua algoritma dengan start dan tujuan yang sama untuk mengisi tabel ini.';
      if (compareNote.textContent !== note) compareNote.textContent = note;

      // mobil
      const stateText = carStateText();
      carStateOut.set(stateText);
      carStateOut.setTone(car.state === 'blocked' ? 'danger' : car.state === 'arrived' ? 'ok' : car.holdLine ? 'warn' : '');
      const driving = isDriving() || car.state === 'arrived';
      carSpeedOut.set(driving ? fmt(car.v * 3.6, 0, 'km/jam') : '-');
      const rem = driving ? driver.remaining() : null;
      carDistOut.set(rem ? fmtDist(rem.length) : r ? fmtDist(r.length) : '-');
      carLeftOut.set(car.state === 'blocked' ? '-' : rem ? fmtDur(rem.time) : r ? fmtDur(r.time) : '-');
      carTimeOut.set(driving ? fmtDur(car.elapsed) : '-');
      const nx = isDriving() ? driver.nextLine(simT) : null;
      lightOut.set(nx ? `${lightNames[nx.state]}, ${fmtDist(nx.dist)}` : isDriving() ? 'tidak ada' : '-');
      lightOut.setTone(nx ? (nx.state === 'red' ? 'danger' : nx.state === 'yellow' ? 'warn' : 'ok') : '');
      shieldOut.set(car.shieldOn ? 'mengerem' : 'siaga');
      shieldOut.setTone(car.shieldOn ? 'warn' : '');
      redOut.set(fmt(driver.safety.redRuns));
      redOut.setTone(driver.safety.redRuns === 0 ? 'ok' : 'danger');

      // HUD
      algoChip.set(ALGO_NAMES[search?.algorithm || algorithm]);
      nodesChip.set(`${fmt(shown.expanded)} node`);
      carChip.set(stateText);
      carChip.setTone(car.state === 'blocked' ? 'danger' : car.state === 'arrived' ? 'ok' : isDriving() ? 'warn' : '');

      updateButtons();
      checkTasks(realDt);
      updateStatus();
    }

    function updateButtons() {
      const driving = isDriving();
      const searchLabel = search ? 'Lewati animasi' : 'Cari rute';
      const driveLabel = driving ? 'Batalkan perjalanan' : car.state === 'arrived' ? 'Jalankan lagi' : 'Jalankan mobil';
      const sig = `${searchLabel}|${driveLabel}|${driving}|${!!route}|${stretches.size}|${cam}`;
      if (sig === lastButtons) return;
      lastButtons = sig;
      searchBtn.querySelector('.btn-label').textContent = searchLabel;
      searchBtn.disabled = driving;
      driveBtn.querySelector('.btn-label').textContent = driveLabel;
      driveBtn.classList.toggle('btn-danger', driving);
      driveBtn.classList.toggle('btn-secondary', !driving);
      closeBtn.disabled = !route;
      jamBtn.disabled = !route;
      clearBtn.disabled = !stretches.size;
      swapBtn.disabled = driving;
      startSel.disabled = driving;
      goalSel.disabled = driving;
      paintCamButtons();
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
      closure: { hold: 0.3, test: () => !search && flags.closureReplanned && !!route && !route.stale },
      traffic: { hold: 0.3, test: () => !search && flags.jamAvoided && !!route && !route.stale },
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
    function currentStreet() {
      if (!route) return '';
      const e = route.edges[driver.edgeIndex()];
      return e?.road.name ? shortStreetName(e.road.name) : 'jalan tanpa nama';
    }

    function updateStatus() {
      let text;
      const name = ALGO_NAMES[search?.algorithm || lastResult?.algorithm || algorithm];
      if (notice && notice.until > performance.now()) text = notice.text;
      else if (search) text = `${name} sedang mencari. ${fmt(search.s.expanded)} node dijelajahi, ${fmt(search.s.open.size)} node di antrean.`;
      else if (car.state === 'blocked') text = 'Tidak ada rute ke tujuan, jadi mobil berhenti sebelum simpang dan menunggu. Buka lagi salah satu jalan yang ditutup.';
      else if (car.state === 'driving') {
        const rem = driver.remaining();
        const replanned = banner && banner.tone === 'warn' ? `Rute dihitung ulang dari simpang berikutnya (${fmt(lastResult?.expanded ?? 0)} node dijelajahi). ` : '';
        const wait = car.holdLine ? ' Mobil berhenti di lampu merah.' : '';
        text = `${replanned}Mobil melaju di ${currentStreet()}. Sisa ${fmtDist(rem.length)}, sekitar ${fmtDur(rem.time)} lagi.${wait}`;
      } else if (car.state === 'arrived') text = `Mobil sampai di ${ends.goal.label} setelah ${fmtDur(car.elapsed)} waktu simulasi.`;
      else if (route && route.stale) text = 'Peta berubah. Tekan Cari rute untuk menghitung ulang rute.';
      else if (lastResult && !lastResult.found) text = `${name} tidak menemukan rute. Semua jalan menuju tujuan tertutup.`;
      else if (route) {
        text = `${ALGO_NAMES[route.algorithm]} menemukan rute ${fmtDist(route.length)}, sekitar ${fmtDur(route.time)}, setelah menjelajahi ${fmt(lastResult?.expanded ?? 0)} node.`;
        if (flags.jamStillUsed && !flags.jamAvoided && ctx.currentStep() === 3) text += ' Rute masih lewat jalan macet karena jalan memutar lebih lama.';
      } else text = `Belum ada rute dari ${ends.start.label} ke ${ends.goal.label}. Tekan Cari rute untuk menjalankan ${ALGO_NAMES[algorithm]}.`;
      ctx.setStatus(text);
      view.setLabel(
        route && !route.stale
          ? `Peta jalan Malang dari OpenStreetMap. Rute ${fmtDist(route.length)} dari ${ends.start.label} ke ${ends.goal.label}. Mobil ${carStateText()}.`
          : `Peta jalan Malang dari OpenStreetMap. Start ${ends.start.label}, tujuan ${ends.goal.label}. Belum ada rute yang berlaku.`,
      );
    }

    // ---------- data untuk pengujian (baca saja) ----------
    const toScreen = (p) => view.worldToScreen(p.x, p.y);
    const testApi = {
      snapshot: () => ({
        algorithm,
        tool,
        cam,
        scale: view.camera.scale,
        lapse,
        searching: !!search,
        expanded: search ? search.s.expanded : lastResult?.expanded ?? 0,
        start: { ...ends.start },
        goal: { ...ends.goal },
        route: route
          ? { nodes: route.nodes.length, length: route.length, time: route.time, stale: route.stale, replanned: route.replanned, key: route.key, roads: route.edges.map((e) => e.road.id) }
          : null,
        results: JSON.parse(JSON.stringify(results)),
        stretches: [...stretches.values()].map((r) => ({ kind: r.kind, mult: r.mult, roads: r.roads.map((x) => x.id), label: r.label })),
        car: { state: car.state, s: car.s, v: car.v, x: car.x, y: car.y, elapsed: car.elapsed, hold: !!car.holdLine, lines: driver.lines.length, shield: car.shieldOn },
        next: (() => {
          const nx = isDriving() ? driver.nextLine(simT) : null;
          return nx ? { dist: nx.dist, state: nx.state, s: nx.line.s } : null;
        })(),
        lines: driver.lines.map((l) => ({ s: l.s, state: driver.stateOf(l, simT) })),
        safety: { ...driver.safety },
        simT,
        timing: { ...timing },
        vMaxKmh: vMax * 3.6,
      }),
      /** Titik layar (px relatif kanvas) pada rute di pecahan panjang tertentu. */
      routePoint(frac) {
        if (!route) return null;
        const p = route.path.sample(clamp(frac, 0, 1) * route.path.length);
        return toScreen(p);
      },
      /** Titik layar di rute sejauh `meters` di depan bumper mobil. */
      aheadPoint(meters) {
        if (!route) return null;
        const p = route.path.sample(Math.min(route.path.length, car.s + HALF + meters));
        return toScreen(p);
      },
      placePoint(id) {
        const n = nodePos(placeNode.get(id));
        return n ? toScreen(n) : null;
      },
    };
    window.__rute = testApi;
    ctx.onCleanup(() => {
      if (window.__rute === testApi) delete window.__rute;
    });

    // ---------- preset ----------
    function applyPreset(i, { keepChoices = false } = {}) {
      const p = STEP_PRESETS[Math.min(i, STEP_PRESETS.length - 1)];
      search = null;
      clearOverlay();
      route = null;
      lastResult = null;
      banner = null;
      notice = null;
      hover = null;
      for (const rec of [...stretches.values()]) removeStretch(rec);
      driver.setRoute(null);
      flags = freshFlags();
      if (!keepChoices) {
        setAlgorithm(p.algorithm);
        setTool(p.tool);
      }
      if (i === 1) results = { astar: null, dijkstra: null };
      if (p.route) presetRoute();
      for (const k of Object.keys(holds)) holds[k] = 0;
      if (cam === 'follow') setCam('fit');
      lastButtons = '';
      syncSelects();
      refreshPanels(0);
    }

    setTool(tool);
    speedCtl.set(nodesPerSec);
    jamCtl.set(jamLevel);
    lapseCtl.set(lapse);
    onewayCtl.set(showOneway);
    setCam('fit');
    syncSelects();

    // ---------- antarmuka ke shell ----------
    return {
      onStep(i) {
        applyPreset(i);
      },
      reset() {
        applyPreset(ctx.currentStep(), { keepChoices: true });
      },
    };
  },
};
