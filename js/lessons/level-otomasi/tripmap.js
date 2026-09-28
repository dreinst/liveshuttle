// Peta perjalanan pelajaran Level Otomasi: rute nyata dari kampus Universitas Ma Chung ke
// Alun-alun Merdeka (OpenStreetMap), area operasi level 4 (kampus Ma Chung dan kawasan Villa Puncak
// Tidar), dan perkiraan posisi mobil menurut jarak yang sudah ditempuh di jalan ilustrasi.
// Latar peta memakai js/data/malang-roads.json lewat ctx.loadMap; selama peta dimuat, rute dan area
// tetap tampil di latar polos. Atribusi "© Kontributor OpenStreetMap" selalu digambar terakhir.

import { View } from '../../engine/canvas.js';
import { COLORS, FONT, withAlpha } from '../../engine/theme.js';
import { createMapRenderer, drawAttribution, highlightRoad } from '../../engine/osm2d.js';
import { createLabelLayer, drawRing, roundRectPath } from '../../engine/draw.js';
import { Path } from '../../engine/geometry.js';
import { TAU } from '../../engine/math.js';
import { TRIP } from './data/trip.js';

const pt = ([x, y]) => ({ x, y });
const ROUTE = new Path(TRIP.route.map(pt));
// jarak di data dihitung dari geometri lengkap; polyline yang disederhanakan sedikit lebih pendek
const K = ROUTE.length / TRIP.length;
const VILLA = TRIP.villa.points.map(pt);
const CAMPUS = TRIP.campus.points.map(pt);
const START = ROUTE.points[0];
const GOAL = ROUTE.points[ROUTE.points.length - 1];

/** Nama jalan (atau jenisnya) di jarak perjalanan t. */
export function streetAt(t) {
  const list = TRIP.streets;
  let st = list[0];
  for (const x of list) if (t >= x.from) st = x;
  if (st.name) return st.name;
  return t < TRIP.oddExit ? 'jalan perumahan Villa Puncak Tidar' : st.classLabel;
}

/** Jarak awal jalan bernama (untuk titik awal skenario), atau fallback bila tidak ada. */
export function streetStart(name, fallback) {
  const x = TRIP.streets.find((s) => s.name === name);
  return x ? x.from : fallback;
}

export const TRIP_LENGTH = TRIP.length;

function polyPath(g, pts) {
  pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
  g.closePath();
}

/**
 * Buat peta perjalanan di dalam `container` (elemen dengan tinggi tetap, position relative).
 * Mengembalikan fungsi draw({ trip, zoneTrip }): gambar ulang hanya bila ada yang berubah.
 */
export function createTripMap(ctx, container) {
  const B = TRIP.bounds;
  const pad = 140;
  const bounds = { minX: B.minX - pad, minY: B.minY - pad, maxX: B.maxX + pad, maxY: B.maxY + pad };
  const PAD_PX = 10;
  // Lencana atribusi ada di pojok kanan bawah. Di kanvas sempit (ponsel) titik tujuan bisa jatuh di
  // bawahnya, jadi peta diberi ruang tambahan di bawah sampai titik tujuan berada di atas lencana.
  const ATTR_W = 196;
  const ATTR_H = 38;
  function fitBounds(v) {
    const b = { ...bounds };
    if (v.width < 60 || v.height < 60) return b;
    for (let k = 0; k < 5; k++) {
      const s = Math.min((v.width - 2 * PAD_PX) / (b.maxX - b.minX), (v.height - 2 * PAD_PX) / (b.maxY - b.minY));
      const gx = v.width / 2 + (GOAL.x - (b.minX + b.maxX) / 2) * s;
      const gy = v.height / 2 + (GOAL.y - (b.minY + b.maxY) / 2) * s;
      const free = v.height - gy;
      if (gx < v.width - ATTR_W || free >= ATTR_H) break;
      b.maxY += (2 * (ATTR_H - free) + 2) / s;
    }
    return b;
  }
  const view = new View(container, {
    bounds: fitBounds,
    padding: PAD_PX,
    label: 'Peta perjalanan dari kampus Universitas Ma Chung ke Alun-alun Merdeka, Malang, dari data OpenStreetMap.',
  });
  ctx.onCleanup(() => view.destroy());
  const labels = createLabelLayer();
  let renderer = null;
  let mapState = 'loading'; // 'loading' | 'ready' | 'failed'
  let lastKey = '';

  ctx
    .loadMap('malang-roads')
    .then((map) => {
      if (ctx.signal.aborted) return;
      renderer = createMapRenderer(map, {
        layers: { buildings: false, footways: false, arrows: false, markings: false, green: true, water: true, campus: false },
      });
      mapState = 'ready';
      lastKey = '';
    })
    .catch((err) => {
      if (err && err.name === 'AbortError') return;
      mapState = 'failed';
      lastKey = '';
    });

  function draw({ trip, zoneTrip = null }) {
    const key = [Math.round(trip / 2), zoneTrip == null ? '-' : Math.round(zoneTrip), mapState, view.width, view.height].join('|');
    if (key === lastKey) return;
    lastKey = key;
    const g = view.begin();
    if (renderer) renderer.draw(g, view, { attribution: false });

    // area operasi level 4: kawasan Villa Puncak Tidar dan kampus Ma Chung (arah putaran sama, jadi isian menyatu)
    g.beginPath();
    polyPath(g, VILLA);
    polyPath(g, CAMPUS);
    g.fillStyle = withAlpha(COLORS.accent, 0.16);
    g.fill('nonzero');
    g.save();
    g.strokeStyle = withAlpha(COLORS.accent, 0.8);
    g.lineWidth = view.px(1.4);
    g.setLineDash([view.px(5), view.px(4)]);
    g.stroke();
    g.restore();

    // rute penuh, lalu bagian yang sudah ditempuh
    highlightRoad(g, view, ROUTE.points, { color: COLORS.pathAlt, width: 3, alpha: 0.85 });
    const u = Math.min(ROUTE.length, trip * K);
    const done = [...ROUTE.points.filter((_, i) => ROUTE.cum[i] < u), ROUTE.sample(u)];
    if (u > 0) highlightRoad(g, view, done, { color: COLORS.accent, width: 3.5, alpha: 0.95, casing: false });

    // batas area operasi di rute
    const ex = { x: TRIP.exitPoint[0], y: TRIP.exitPoint[1] };
    g.fillStyle = COLORS.target;
    g.beginPath();
    g.arc(ex.x, ex.y, view.px(4), 0, TAU);
    g.fill();
    labels.add(ex.x, ex.y, 'Batas ODD', { color: COLORS.target, dy: 15, size: 10, optional: true, priority: 1, nudge: 'down' });

    // zona pekerjaan jalan (ilustrasi) bila ada di skenario
    if (zoneTrip != null && zoneTrip > 0 && zoneTrip < TRIP.length) {
      const z = ROUTE.sample(zoneTrip * K);
      g.save();
      g.translate(z.x, z.y);
      g.rotate(Math.PI / 4);
      const r = view.px(5);
      g.fillStyle = '#f97316';
      g.fillRect(-r, -r, 2 * r, 2 * r);
      g.restore();
    }

    // awal dan tujuan
    drawRing(g, GOAL.x, GOAL.y, view.px(5), { color: '#e2e8f0', width: 2, view, fill: 'rgba(11, 18, 32, 0.9)' });
    labels.add(TRIP.campus.x, TRIP.campus.y, 'Kampus Ma Chung', { color: '#99f6e4', dy: -14, size: 10, priority: 2 });
    labels.add(GOAL.x, GOAL.y, 'Alun-alun Merdeka', { color: COLORS.text, dy: -14, size: 10, priority: 2 });
    if (view.width >= 520) labels.add(TRIP.villa.x, TRIP.villa.y + 260, 'Area operasi level 4', { color: COLORS.accent, dy: 0, size: 10, optional: true });
    g.fillStyle = '#e2e8f0';
    g.beginPath();
    g.arc(START.x, START.y, view.px(3), 0, TAU);
    g.fill();
    labels.draw(g, view);

    // posisi mobil (di atas label supaya selalu terlihat)
    const p = ROUTE.sample(trip * K);
    g.fillStyle = withAlpha(COLORS.accent, 0.28);
    g.beginPath();
    g.arc(p.x, p.y, view.px(10), 0, TAU);
    g.fill();
    g.fillStyle = COLORS.accent;
    g.strokeStyle = '#0b1220';
    g.lineWidth = view.px(2);
    g.beginPath();
    g.arc(p.x, p.y, view.px(5.5), 0, TAU);
    g.fill();
    g.stroke();

    if (mapState !== 'ready') {
      // pesan di pojok kiri bawah (bagian peta yang kosong), satu baris di atas atribusi bila tidak muat
      const narrow = view.width < 520;
      const msg = mapState === 'loading' ? 'Memuat peta jalan Malang...' : narrow ? 'Peta jalan gagal dimuat.' : 'Peta jalan tidak bisa dimuat. Rute tetap ditampilkan.';
      g.save();
      view.screen();
      g.font = `600 10.5px ${FONT}`;
      const w = g.measureText(msg).width + 12;
      const h = 18;
      const x = 6;
      const y = view.height - h - 6 - (x + w > view.width - ATTR_W ? h + 6 : 0);
      g.fillStyle = 'rgba(11, 18, 32, 0.78)';
      roundRectPath(g, x, y, w, h, 6);
      g.fill();
      g.fillStyle = 'rgba(203, 213, 225, 0.92)';
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.fillText(msg, x + 6, y + h / 2 + 0.5);
      g.restore();
      view.world();
    }
    drawAttribution(g, view);
  }

  return draw;
}
