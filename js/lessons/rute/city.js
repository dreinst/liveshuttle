// Peta kota untuk pelajaran Perencanaan Rute.
//
// Kota berupa grid 24 x 16 sel. Tiap sel mewakili potongan 25 m x 25 m. Sel jalan menjadi
// node graf; dua sel jalan yang bersebelahan (atas, bawah, kiri, kanan) terhubung. Sungai di
// tengah hanya bisa diseberangi lewat tiga jembatan.
//
// Koordinat dunia dalam meter, titik (0, 0) di pojok kiri atas peta, y ke bawah.
// File ini berisi model (jenis sel, penutupan, macet, GridMap untuk pencarian) dan cara
// menggambar kota. Logika pelajaran ada di ../rute.js, gerak mobil di ./car.js.

import { GridMap } from '../../engine/planning.js';
import { COLORS, FONT, withAlpha } from '../../engine/theme.js';
import { drawBuilding, drawTree } from '../../engine/draw.js';

export const COLS = 24;
export const ROWS = 16;
export const CELL = 25; // m per sel
export const MAP_W = COLS * CELL;
export const MAP_H = ROWS * CELL;
export const FREE_SPEED = 10; // m/s, sama dengan 36 km/jam saat jalan lancar
export const JAM_FACTOR = 5; // sel macet lima kali lebih lambat

export const ROAD = 1;
export const BUILDING = 2;
export const PARK = 3;
export const WATER = 4;

const V_ROADS = [1, 5, 9, 14, 18, 22];
const H_ROADS = [1, 5, 10, 14];
const RIVER = [11, 12];
const BRIDGES = [1, 10, 14];

// Warna khusus peta ini.
export const MAP_COLORS = Object.freeze({
  base: '#1a2233',
  sidewalk: '#323b4d',
  water: '#123a52',
  waterLight: '#1b4d6b',
  park: COLORS.ground,
  bridge: '#4a5468',
  jam: '#f97316',
  closed: '#ef4444',
});

function baseType(c, r) {
  if (RIVER.includes(c)) return BRIDGES.includes(r) ? ROAD : WATER;
  const westSpan = c >= 1 && c <= 9;
  const eastSpan = c >= 14 && c <= 22;
  if (H_ROADS.includes(r)) {
    if (r === 5 && c >= 19 && c <= 21) return BUILDING; // pusat belanja memotong jalan
    if (westSpan || eastSpan) return ROAD;
    if ((c === 10 || c === 13) && BRIDGES.includes(r)) return ROAD;
  }
  if (V_ROADS.includes(c) && r >= 1 && r <= 14) {
    if (c === 5 && r >= 6 && r <= 9) return PARK; // taman besar memotong jalan
    return ROAD;
  }
  if (c === 10 || c === 13) return PARK; // tepi sungai
  if (c >= 2 && c <= 8 && r >= 6 && r <= 9) return PARK;
  if (c >= 15 && c <= 17 && r >= 11 && r <= 13) return PARK;
  return BUILDING;
}

/** Tutupi sel sejenis dengan persegi panjang serakah (untuk menggambar blok). */
function coverRects(types, kind) {
  const used = new Uint8Array(COLS * ROWS);
  const rects = [];
  const same = (c, r) => c < COLS && r < ROWS && types[r * COLS + c] === kind && !used[r * COLS + c];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!same(c, r)) continue;
      let w = 1;
      while (same(c + w, r)) w++;
      let h = 1;
      while (r + h < ROWS) {
        let ok = true;
        for (let k = 0; k < w; k++) if (!same(c + k, r + h)) ok = false;
        if (!ok) break;
        h++;
      }
      for (let rr = r; rr < r + h; rr++) for (let cc = c; cc < c + w; cc++) used[rr * COLS + cc] = 1;
      rects.push({ c, r, w, h });
    }
  }
  return rects;
}

function hash(a, b) {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Bagi satu blok gedung menjadi beberapa kavling. */
function lotsFor(rect) {
  const x0 = rect.c * CELL;
  const y0 = rect.r * CELL;
  const w = rect.w * CELL;
  const h = rect.h * CELL;
  const inset = 4;
  const gap = 3;
  const big = rect.w * rect.h >= 18;
  const nx = big ? 1 : Math.max(1, Math.round(rect.w / 1.5));
  const ny = big ? Math.max(1, Math.round(rect.h / 4)) : Math.max(1, Math.round(rect.h / 1.5));
  const lots = [];
  const lw = (w - 2 * inset - (nx - 1) * gap) / nx;
  const lh = (h - 2 * inset - (ny - 1) * gap) / ny;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const lx = x0 + inset + i * (lw + gap);
      const ly = y0 + inset + j * (lh + gap);
      // sedikit variasi ukuran supaya kota tidak terlihat seperti papan catur
      const shrinkX = hash(lx, ly) * 3;
      const shrinkY = hash(ly, lx) * 3;
      lots.push({ x: lx + lw / 2, y: ly + lh / 2, heading: 0, length: lw - shrinkX, width: lh - shrinkY, tall: hash(lx + 1, ly + 2) });
    }
  }
  return lots;
}

function treesFor(rect) {
  const trees = [];
  const x0 = rect.c * CELL;
  const y0 = rect.r * CELL;
  const cols = rect.w * 2;
  const rows = rect.h * 2;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const hx = hash(i + rect.c * 7, j + rect.r * 13);
      if (hx < 0.38) continue;
      const hy = hash(j * 3 + rect.r, i * 5 + rect.c);
      trees.push({
        x: x0 + (i + 0.5) * (CELL / 2) + (hx - 0.5) * 5,
        y: y0 + (j + 0.5) * (CELL / 2) + (hy - 0.5) * 5,
        r: 3.2 + hy * 2.4,
      });
    }
  }
  return trees;
}

export function createCity() {
  const types = new Uint8Array(COLS * ROWS);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) types[r * COLS + c] = baseType(c, r);

  const grid = new GridMap({ cols: COLS, rows: ROWS, cellSize: CELL });
  const closed = new Uint8Array(COLS * ROWS);
  const jam = new Uint8Array(COLS * ROWS);
  const roadCells = [];
  for (let i = 0; i < types.length; i++) {
    if (types[i] === ROAD) roadCells.push(i);
    else grid.blocked[i] = 1;
  }

  const buildingRects = coverRects(types, BUILDING);
  const lots = buildingRects.flatMap(lotsFor);
  const parkRects = coverRects(types, PARK);
  const trees = parkRects.flatMap(treesFor);

  const isRoad = (i) => i >= 0 && i < types.length && types[i] === ROAD;
  const cellOf = (c, r) => (c >= 0 && r >= 0 && c < COLS && r < ROWS ? r * COLS + c : -1);
  const colRow = (i) => ({ c: i % COLS, r: Math.floor(i / COLS) });
  const center = (i) => ({ x: ((i % COLS) + 0.5) * CELL, y: (Math.floor(i / COLS) + 0.5) * CELL });
  const roadNeighbors = (i) => {
    const { c, r } = colRow(i);
    return [cellOf(c + 1, r), cellOf(c - 1, r), cellOf(c, r + 1), cellOf(c, r - 1)].filter(isRoad);
  };
  const isBridge = (i) => isRoad(i) && RIVER.includes(i % COLS);
  /** Sel di tengah ruas lurus (bukan persimpangan atau tikungan). */
  const isStraight = (i) => {
    const { c, r } = colRow(i);
    const e = isRoad(cellOf(c + 1, r));
    const w = isRoad(cellOf(c - 1, r));
    const n = isRoad(cellOf(c, r - 1));
    const s = isRoad(cellOf(c, r + 1));
    return (e && w && !n && !s) || (n && s && !e && !w);
  };

  function setClosed(i, on) {
    if (!isRoad(i)) return;
    closed[i] = on ? 1 : 0;
    grid.blocked[i] = on ? 1 : 0;
    if (on) setJam(i, false);
  }

  function setJam(i, on) {
    if (!isRoad(i)) return;
    jam[i] = on ? 1 : 0;
    grid.cost[i] = on ? JAM_FACTOR : 1;
  }

  function clear() {
    for (const i of roadCells) {
      setClosed(i, false);
      setJam(i, false);
    }
  }

  /** Biaya sel termurah di antara sel jalan yang masih terbuka (untuk heuristik). */
  function minCost() {
    let m = Infinity;
    for (const i of roadCells) if (!closed[i]) m = Math.min(m, grid.cost[i]);
    return Number.isFinite(m) ? m : 1;
  }

  /** Tanda tangan keadaan peta, untuk memastikan dua pencarian memakai peta yang sama. */
  function signature() {
    const cl = [];
    const jm = [];
    for (const i of roadCells) {
      if (closed[i]) cl.push(i);
      if (jam[i]) jm.push(i);
    }
    return `${cl.join(',')}|${jm.join(',')}`;
  }

  /** Waktu tempuh satu sel (detik) saat mobil melewatinya. */
  const cellTime = (i) => (CELL * (jam[i] ? JAM_FACTOR : 1)) / FREE_SPEED;

  /** Panjang (m) dan perkiraan waktu (detik) sebuah rute sel. Waktu = jumlah biaya sel yang dimasuki. */
  function measure(cells) {
    let time = 0;
    for (let k = 1; k < cells.length; k++) time += cellTime(cells[k]);
    return { length: Math.max(0, cells.length - 1) * CELL, time };
  }

  /**
   * Sel jalan pada posisi dunia (x, y). Bila titik tidak tepat di sel jalan, pilih sel jalan
   * terdekat dalam radius (untuk sentuhan jari yang kurang tepat).
   */
  function roadCellAt(x, y, radius = 0) {
    const c = Math.floor(x / CELL);
    const r = Math.floor(y / CELL);
    const i = cellOf(c, r);
    if (isRoad(i)) return i;
    let best = -1;
    let bestD = Infinity;
    const reach = Math.ceil(radius / CELL) + 1;
    for (let dr = -reach; dr <= reach; dr++) {
      for (let dc = -reach; dc <= reach; dc++) {
        const j = cellOf(c + dc, r + dr);
        if (!isRoad(j)) continue;
        const cx = (j % COLS) * CELL;
        const cy = Math.floor(j / COLS) * CELL;
        const dx = Math.max(cx - x, 0, x - (cx + CELL));
        const dy = Math.max(cy - y, 0, y - (cy + CELL));
        const d = Math.hypot(dx, dy);
        if (d <= radius && d < bestD) {
          best = j;
          bestD = d;
        }
      }
    }
    return best;
  }

  // ---------- menggambar ----------

  const ROAD_INSET = 3.5; // trotoar di sisi jalan yang berbatasan dengan blok

  function drawBase(g, view) {
    // dasar trotoar di seluruh peta
    g.fillStyle = MAP_COLORS.sidewalk;
    g.fillRect(0, 0, MAP_W, MAP_H);

    // sungai
    const rx = RIVER[0] * CELL;
    const rw = RIVER.length * CELL;
    g.fillStyle = MAP_COLORS.water;
    g.fillRect(rx, 0, rw, MAP_H);
    g.strokeStyle = withAlpha(MAP_COLORS.waterLight, 0.9);
    g.lineWidth = view.px(1.5);
    g.beginPath();
    for (let y = 12; y < MAP_H; y += 26) {
      for (const [ox, len] of [
        [10, 12],
        [30, 9],
      ]) {
        const yy = y + (ox > 20 ? 11 : 0);
        g.moveTo(rx + ox, yy);
        g.lineTo(rx + ox + len, yy);
      }
    }
    g.stroke();

    // taman dan tepi sungai
    for (const p of parkRects) {
      g.fillStyle = MAP_COLORS.park;
      g.fillRect(p.c * CELL + 2, p.r * CELL + 2, p.w * CELL - 4, p.h * CELL - 4);
    }
    // gedung
    for (const b of lots) {
      drawBuilding(g, b, { roof: b.tall > 0.6 ? '#33435f' : COLORS.roof, shadow: 2.4 });
    }
    for (const t of trees) drawTree(g, t.x, t.y, t.r);

    // aspal
    for (const i of roadCells) {
      const { c, r } = colRow(i);
      const x0 = c * CELL;
      const y0 = r * CELL;
      const n = isRoad(cellOf(c, r - 1));
      const s = isRoad(cellOf(c, r + 1));
      const w = isRoad(cellOf(c - 1, r));
      const e = isRoad(cellOf(c + 1, r));
      const bridge = isBridge(i);
      const l = x0 + (w ? 0 : ROAD_INSET);
      const t = y0 + (n ? 0 : ROAD_INSET);
      const rr = x0 + CELL - (e ? 0 : ROAD_INSET);
      const b = y0 + CELL - (s ? 0 : ROAD_INSET);
      if (bridge) {
        g.fillStyle = MAP_COLORS.bridge;
        g.fillRect(x0, y0 + 1.5, CELL, CELL - 3);
      }
      g.fillStyle = COLORS.asphalt;
      g.fillRect(l, t, rr - l, b - t);
    }

    // garis tengah putus-putus di ruas lurus
    g.save();
    g.strokeStyle = withAlpha(COLORS.laneMark, 0.5);
    g.lineWidth = view.px(1);
    g.setLineDash([view.px(5), view.px(6)]);
    g.beginPath();
    for (const i of roadCells) {
      const { c, r } = colRow(i);
      const p = center(i);
      const e = isRoad(cellOf(c + 1, r));
      const s = isRoad(cellOf(c, r + 1));
      const deg = roadNeighbors(i).length;
      if (e && deg <= 2 && roadNeighbors(cellOf(c + 1, r)).length <= 2) {
        g.moveTo(p.x, p.y);
        g.lineTo(p.x + CELL, p.y);
      }
      if (s && deg <= 2 && roadNeighbors(cellOf(c, r + 1)).length <= 2) {
        g.moveTo(p.x, p.y);
        g.lineTo(p.x, p.y + CELL);
      }
    }
    g.stroke();
    g.restore();

    // pagar jembatan
    g.strokeStyle = withAlpha('#cbd5e1', 0.55);
    g.lineWidth = view.px(1.5);
    g.beginPath();
    for (const r of BRIDGES) {
      g.moveTo(rx, r * CELL + 2);
      g.lineTo(rx + rw, r * CELL + 2);
      g.moveTo(rx, (r + 1) * CELL - 2);
      g.lineTo(rx + rw, (r + 1) * CELL - 2);
    }
    g.stroke();

    // garis batas sel di jalan, samar, supaya node grid terlihat
    g.strokeStyle = 'rgba(148, 163, 184, 0.10)';
    g.lineWidth = view.px(1);
    g.beginPath();
    for (const i of roadCells) {
      const { c, r } = colRow(i);
      if (isRoad(cellOf(c + 1, r))) {
        g.moveTo((c + 1) * CELL, r * CELL + ROAD_INSET);
        g.lineTo((c + 1) * CELL, (r + 1) * CELL - ROAD_INSET);
      }
      if (isRoad(cellOf(c, r + 1))) {
        g.moveTo(c * CELL + ROAD_INSET, (r + 1) * CELL);
        g.lineTo((c + 1) * CELL - ROAD_INSET, (r + 1) * CELL);
      }
    }
    g.stroke();
  }

  /** Kotak isi sel jalan (tanpa trotoar), untuk menandai antrean, dijelajahi, macet, dan tutup. */
  function roadRect(i, pad = 0) {
    const { c, r } = colRow(i);
    const x0 = c * CELL;
    const y0 = r * CELL;
    return { x: x0 + ROAD_INSET + pad, y: y0 + ROAD_INSET + pad, w: CELL - 2 * (ROAD_INSET + pad), h: CELL - 2 * (ROAD_INSET + pad) };
  }

  function drawJam(g, view, time) {
    for (const i of roadCells) {
      if (!jam[i]) continue;
      const q = roadRect(i, -1.5);
      g.fillStyle = withAlpha(MAP_COLORS.jam, 0.42);
      g.fillRect(q.x, q.y, q.w, q.h);
      // mobil kecil yang mengantre
      const p = center(i);
      const { c, r } = colRow(i);
      const vertical = isRoad(cellOf(c, r - 1)) || isRoad(cellOf(c, r + 1));
      const horizontal = isRoad(cellOf(c - 1, r)) || isRoad(cellOf(c + 1, r));
      const alongX = horizontal || !vertical;
      g.fillStyle = withAlpha('#fed7aa', 0.9);
      const carL = 5;
      const carW = 2.6;
      for (const lane of [-4.5, 4.5]) {
        for (const k of [-7, 0, 7]) {
          const jitter = (hash(i, k + lane) - 0.5) * 2;
          const x = alongX ? p.x + k + jitter : p.x + lane;
          const y = alongX ? p.y + lane : p.y + k + jitter;
          const w = alongX ? carL : carW;
          const h = alongX ? carW : carL;
          g.fillRect(x - w / 2, y - h / 2, w, h);
        }
      }
      g.strokeStyle = MAP_COLORS.jam;
      g.lineWidth = view.px(1.5);
      g.strokeRect(q.x, q.y, q.w, q.h);
    }
  }

  function drawClosed(g, view) {
    for (const i of roadCells) {
      if (!closed[i]) continue;
      const q = roadRect(i, -1.5);
      g.fillStyle = 'rgba(127, 29, 29, 0.55)';
      g.fillRect(q.x, q.y, q.w, q.h);
      // palang merah putih
      const p = center(i);
      g.save();
      g.beginPath();
      g.rect(q.x, q.y, q.w, q.h);
      g.clip();
      g.strokeStyle = withAlpha('#fecaca', 0.8);
      g.lineWidth = 2.2;
      g.beginPath();
      for (let k = -CELL; k < CELL; k += 6) {
        g.moveTo(q.x + k, q.y + q.h);
        g.lineTo(q.x + k + q.h, q.y);
      }
      g.stroke();
      g.restore();
      g.strokeStyle = MAP_COLORS.closed;
      g.lineWidth = view.px(2);
      g.strokeRect(q.x, q.y, q.w, q.h);
      // tanda silang
      const s = Math.max(5, view.px(6));
      g.strokeStyle = '#ffffff';
      g.lineWidth = Math.max(1.6, view.px(2.5));
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(p.x - s, p.y - s);
      g.lineTo(p.x + s, p.y + s);
      g.moveTo(p.x + s, p.y - s);
      g.lineTo(p.x - s, p.y + s);
      g.stroke();
    }
  }

  /** Label nama tempat (dalam piksel layar). */
  function drawPlaceLabels(g, view) {
    if (CELL * view.camera.scale < 20) return;
    g.save();
    view.screen();
    g.font = `600 11px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const put = (x, y, text, color) => {
      const p = view.worldToScreen(x, y);
      g.fillStyle = color;
      g.fillText(text, p.x, p.y);
    };
    put((RIVER[0] + 1) * CELL, 5.5 * CELL, 'Sungai', 'rgba(125, 211, 252, 0.75)');
    put(5 * CELL + CELL / 2, 8 * CELL, 'Taman kota', 'rgba(187, 247, 208, 0.7)');
    put(20 * CELL + CELL / 2, 5.5 * CELL, 'Pusat belanja', 'rgba(203, 213, 225, 0.7)');
    g.restore();
  }

  return {
    types,
    grid,
    closed,
    jam,
    roadCells,
    isRoad,
    isStraight,
    cellOf,
    colRow,
    center,
    roadNeighbors,
    roadRect,
    setClosed,
    setJam,
    clear,
    minCost,
    signature,
    measure,
    cellTime,
    roadCellAt,
    drawBase,
    drawJam,
    drawClosed,
    drawPlaceLabels,
  };
}
