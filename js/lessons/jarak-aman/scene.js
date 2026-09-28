// Gambar dunia pelajaran Jarak Aman: jalan tol lurus dua lajur per arah, dilihat dari atas.
//
// Koordinat dalam meter, y ke bawah, lalu lintas kiri. Arah kita ke timur (+x), jadi lajur kiri
// (lajur mobilmu) berada di sisi utara: y = -1,75. Lajur kanan (untuk menyalip) di y = +1,75.
// Median beton di y sekitar +4,7, lalu jalur arah berlawanan (ke barat) di bawahnya.
//
// Semua fungsi di sini hanya menggambar. Keadaan simulasi ada di model.js dan jarak-aman.js.

import { COLORS, FONT, withAlpha } from '../../engine/theme.js';
import { TAU } from '../../engine/math.js';
import { drawCar } from '../../engine/draw.js';

export const LANE_Y = -1.75; // lajur kiri, lajur mobilmu
export const LANE_RIGHT_Y = 1.75;
export const FOCUS_Y = -0.2; // titik tengah vertikal yang dijaga kamera
const Y = {
  shoulderTop: -6.5,
  edgeTop: -3.5,
  edgeBottom: 3.5,
  barrierTop: 4.3,
  barrierBottom: 5.1,
  oppTop: 5.9,
  oppBottom: 12.9,
  oppShoulder: 15.4,
};

const hash = (a, b = 0) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

// kendaraan arah berlawanan (hiasan), posisi dunia dihitung dari waktu
const ONCOMING = [
  { off: 0, speed: 24, y: 11.15, color: '#6b7a90', len: 4.5 },
  { off: 150, speed: 21, y: 11.15, color: '#8d9ab3', len: 4.6 },
  { off: 260, speed: 27, y: 7.65, color: '#5b7aa6', len: 4.4 },
];
const ONCOMING_PERIOD = 420;

/** Latar, rumput, pohon, dan jalan untuk area yang terlihat. */
export function drawWorld(g, view, time) {
  const b = view.visibleBounds();
  const x0 = b.minX - 6;
  const x1 = b.maxX + 6;
  const w = x1 - x0;

  // rumput dengan jalur potong halus
  g.fillStyle = COLORS.groundAlt;
  for (let k = Math.floor(x0 / 16); k * 16 < x1; k++) {
    if (k % 2) g.fillRect(k * 16, b.minY - 2, 8, b.maxY - b.minY + 4);
  }

  // bahu jalan dan lajur arah kita
  g.fillStyle = COLORS.asphaltDark;
  g.fillRect(x0, Y.shoulderTop, w, Y.edgeTop - Y.shoulderTop);
  g.fillStyle = COLORS.asphalt;
  g.fillRect(x0, Y.edgeTop, w, Y.edgeBottom - Y.edgeTop);
  g.fillStyle = COLORS.asphaltDark;
  g.fillRect(x0, Y.edgeBottom, w, Y.barrierTop - Y.edgeBottom);
  // tepi bahu (batas dengan rumput)
  g.fillStyle = COLORS.curb;
  g.fillRect(x0, Y.shoulderTop - 0.12, w, 0.12);

  // median beton
  g.fillStyle = COLORS.wallDark;
  g.fillRect(x0, Y.barrierTop, w, Y.barrierBottom - Y.barrierTop);
  g.fillStyle = COLORS.wall;
  g.fillRect(x0, Y.barrierTop + 0.18, w, Y.barrierBottom - Y.barrierTop - 0.36);

  // jalur arah berlawanan
  g.fillStyle = COLORS.asphaltDark;
  g.fillRect(x0, Y.barrierBottom, w, Y.oppTop - Y.barrierBottom);
  g.fillStyle = COLORS.asphalt;
  g.fillRect(x0, Y.oppTop, w, Y.oppBottom - Y.oppTop);
  g.fillStyle = COLORS.asphaltDark;
  g.fillRect(x0, Y.oppBottom, w, Y.oppShoulder - Y.oppBottom);
  g.fillStyle = COLORS.curb;
  g.fillRect(x0, Y.oppShoulder, w, 0.12);

  // marka: garis tepi utuh, pembagi lajur putus-putus (4,5 m garis, 7,5 m celah)
  const white = withAlpha(COLORS.laneMark, 0.75);
  g.fillStyle = white;
  for (const y of [Y.edgeTop, Y.edgeBottom, Y.oppTop, Y.oppBottom]) g.fillRect(x0, y - 0.07, w, 0.14);
  g.fillStyle = withAlpha(COLORS.laneMark, 0.85);
  for (const yc of [0, (Y.oppTop + Y.oppBottom) / 2]) {
    for (let k = Math.floor(x0 / 12); k * 12 < x1; k++) g.fillRect(k * 12, yc - 0.07, 4.5, 0.14);
  }

  // patok pengarah di tepi bahu, tiap 25 m
  const post = Math.max(0.28, view.px(3));
  for (let k = Math.floor(x0 / 25); k * 25 < x1; k++) {
    const x = k * 25;
    g.fillStyle = '#e2e8f0';
    g.fillRect(x - post / 2, Y.shoulderTop + 0.25, post, post);
    g.fillStyle = '#ef4444';
    g.fillRect(x - post / 2, Y.shoulderTop + 0.25 + post * 0.55, post, post * 0.45);
  }

  // kendaraan arah berlawanan (ke barat)
  const ref = b.minX - 30;
  for (const c of ONCOMING) {
    const raw = c.off - c.speed * time;
    const x = ref + ((((raw - ref) % ONCOMING_PERIOD) + ONCOMING_PERIOD) % ONCOMING_PERIOD);
    if (x > b.maxX + 10) continue;
    drawCar(g, { x, y: c.y, heading: Math.PI, length: c.len, width: 1.8 }, { color: c.color, alpha: 0.9 });
  }

  // pohon di kedua sisi
  for (let k = Math.floor(x0 / 11) - 1; k * 11 < x1 + 11; k++) {
    for (const side of [-1, 1]) {
      const h = hash(k, side);
      if (h < 0.3) continue;
      const tx = k * 11 + hash(k, side + 7) * 8;
      const ty = side < 0 ? -10.2 - hash(k, side + 3) * 6 : Y.oppShoulder + 3.6 + hash(k, side + 5) * 6;
      const r = 1.4 + hash(k, side + 9) * 1.1;
      drawTreeSoft(g, tx, ty, r);
    }
  }
}

function drawTreeSoft(g, x, y, r) {
  g.fillStyle = 'rgba(0, 0, 0, 0.28)';
  g.beginPath();
  g.arc(x + r * 0.25, y + r * 0.35, r, 0, TAU);
  g.fill();
  g.fillStyle = COLORS.tree;
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
  g.fillStyle = COLORS.treeLight;
  g.beginPath();
  g.arc(x - r * 0.25, y - r * 0.25, r * 0.58, 0, TAU);
  g.fill();
}

/** Kotak berwarna tembus pandang di lajur mobilmu, dari x0 sampai x1. */
export function drawLaneBand(g, view, x0, x1, color, { alpha = 0.26, edge = true } = {}) {
  if (x1 <= x0) return;
  const top = LANE_Y - 1.55;
  const h = 3.1;
  g.fillStyle = withAlpha(color, alpha);
  g.fillRect(x0, top, x1 - x0, h);
  if (edge) {
    g.fillStyle = withAlpha(color, 0.85);
    const t = view.px(2);
    g.fillRect(x0, top, x1 - x0, t);
    g.fillRect(x0, top + h - t, x1 - x0, t);
  }
}

/** Garis melintang lajur (titik henti). dashed untuk perkiraan milik mobil lain. */
export function drawStopMark(g, view, x, color, { dashed = false, width = 3 } = {}) {
  g.save();
  g.strokeStyle = color;
  g.lineWidth = view.px(width);
  if (dashed) g.setLineDash([view.px(6), view.px(4)]);
  g.beginPath();
  g.moveTo(x, LANE_Y - 1.7);
  g.lineTo(x, LANE_Y + 1.7);
  g.stroke();
  g.restore();
}

/** Garis ukur dengan ujung bertanda di bahu jalan, dari x0 ke x1. */
export function drawDimension(g, view, x0, x1, color = 'rgba(226, 232, 240, 0.85)') {
  if (x1 - x0 < view.px(6)) return;
  const y = -4.9;
  const tick = view.px(6);
  g.save();
  g.strokeStyle = color;
  g.lineWidth = view.px(1.5);
  g.beginPath();
  g.moveTo(x0, y);
  g.lineTo(x1, y);
  g.moveTo(x0, y - tick);
  g.lineTo(x0, y + tick);
  g.moveTo(x1, y - tick);
  g.lineTo(x1, y + tick);
  g.stroke();
  g.restore();
}

/** Mistar jarak di bahu jalan dengan titik nol di origin. */
export function drawRuler(g, view, origin, toX) {
  const scale = view.camera.scale;
  const step = scale >= 9 ? 10 : scale >= 4.5 ? 20 : 50;
  const b = view.visibleBounds();
  const y0 = Y.edgeTop - 0.35;
  g.save();
  g.strokeStyle = 'rgba(226, 232, 240, 0.55)';
  g.lineWidth = view.px(1.5);
  g.beginPath();
  for (let d = 0; origin + d <= Math.min(toX, b.maxX + 1); d += step) {
    const x = origin + d;
    if (x < b.minX - 1) continue;
    g.moveTo(x, y0);
    g.lineTo(x, y0 - view.px(d % (step * 2) === 0 ? 9 : 6));
  }
  g.stroke();
  // angka dalam piksel layar
  view.screen();
  g.fillStyle = 'rgba(203, 213, 225, 0.85)';
  g.font = `600 10px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'bottom';
  for (let d = 0; origin + d <= Math.min(toX, b.maxX + 1); d += step) {
    const x = origin + d;
    if (x < b.minX - 1) continue;
    const p = view.worldToScreen(x, y0);
    g.fillText(`${d} m`, p.x, p.y - 11);
  }
  g.restore();
  view.world();
}

/** Mobil (mobilmu, mobil depan, atau mobil mogok). */
export function drawVehicle(g, view, car, opts = {}) {
  drawCar(g, car, { view, ...opts });
}

/** Lampu hazard berkedip untuk mobil mogok. */
export function drawHazard(g, view, car, on) {
  if (!on) return;
  const L = car.length;
  const W = car.width;
  const r = Math.max(0.28, view.px(3.5));
  g.save();
  g.fillStyle = 'rgba(251, 146, 60, 0.95)';
  for (const [fx, fy] of [
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, -0.5],
    [-0.5, 0.5],
  ]) {
    g.beginPath();
    g.arc(car.x + fx * (L - 0.3), car.y + fy * (W - 0.3), r, 0, TAU);
    g.fill();
  }
  g.fillStyle = 'rgba(251, 146, 60, 0.18)';
  g.beginPath();
  g.arc(car.x, car.y, Math.max(L * 0.75, view.px(26)), 0, TAU);
  g.fill();
  g.restore();
}

/** Tanda benturan di titik sentuh. */
export function drawImpact(g, view, x, y, phase = 0) {
  const R = Math.max(1.6, view.px(20));
  g.save();
  g.translate(x, y);
  g.fillStyle = 'rgba(239, 68, 68, 0.22)';
  g.beginPath();
  g.arc(0, 0, R * (1.5 + 0.12 * Math.sin(phase * 5)), 0, TAU);
  g.fill();
  g.beginPath();
  const n = 9;
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * TAU + 0.2;
    const r = i % 2 ? R * 0.45 : R;
    const px = Math.cos(a) * r;
    const py = Math.sin(a) * r;
    if (i) g.lineTo(px, py);
    else g.moveTo(px, py);
  }
  g.closePath();
  g.fillStyle = '#f97316';
  g.fill();
  g.strokeStyle = '#fee2e2';
  g.lineWidth = view.px(1.5);
  g.stroke();
  g.fillStyle = '#fef3c7';
  g.beginPath();
  g.arc(0, 0, R * 0.28, 0, TAU);
  g.fill();
  g.restore();
}

/** Panah kecil di tepi kanan kanvas bila titik henti berada di luar layar. */
export function drawOffscreenArrow(g, view, y, color) {
  const p = view.worldToScreen(0, y);
  g.save();
  view.screen();
  const x = view.width - 12;
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(x, p.y);
  g.lineTo(x - 11, p.y - 7);
  g.lineTo(x - 11, p.y + 7);
  g.closePath();
  g.fill();
  g.restore();
  view.world();
}

