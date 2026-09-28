// Gambar dunia pelajaran Jarak Aman, dilihat dari atas.
//
// Ada dua tempat, keduanya gambar ilustrasi:
//   'kota'  Jalan Soekarno-Hatta, Malang (sampai 50 km/jam). Nama jalan, dua lajur per arah dengan
//           jalur terpisah, dan batas 50 km/jam diambil dari data OpenStreetMap. Lebar lajur,
//           trotoar, median, ruko, pohon, dan lalu lintas lain hanya perkiraan atau hiasan.
//   'tol'   jalan tol dua lajur per arah (di atas 50 km/jam), bukan lokasi tertentu.
//
// Koordinat dalam meter, y ke bawah, lalu lintas kiri. Arah kita ke timur (+x), jadi lajur kiri
// (lajur mobilmu) berada di sisi utara: y = -1,75. Lajur kanan (untuk mendahului) di y = +1,75.
// Median di y sekitar +4,3 sampai +5,8, lalu jalur arah berlawanan (ke barat) di bawahnya.
//
// Semua fungsi di sini hanya menggambar. Keadaan simulasi ada di model.js, street.js, dan jarak-aman.js.

import { COLORS, FONT, withAlpha } from '../../engine/theme.js';
import { TAU } from '../../engine/math.js';
import { drawCar, drawAngkot, drawPedestrian, drawSpeedSign, drawVehicle } from '../../engine/draw.js';
import { CITY_MAX_KMH } from './model.js';

export const LANE_Y = -1.75; // lajur kiri, lajur mobilmu
export const FOCUS_Y = -0.2; // titik tengah vertikal yang dijaga kamera

export const PLACES = Object.freeze({
  kota: { id: 'kota', name: 'Jalan Soekarno-Hatta', chip: 'Jl. Soekarno-Hatta, Malang (ilustrasi)', tag: 'Jl. Soekarno-Hatta (ilustrasi)' },
  tol: { id: 'tol', name: 'jalan tol', chip: 'jalan tol (ilustrasi)', tag: 'Jalan tol (ilustrasi)' },
});

/** Tempat untuk kecepatan tertentu: jalan kota sampai batas kecepatannya, di atasnya jalan tol. */
export const placeFor = (kmh) => (kmh <= CITY_MAX_KMH ? 'kota' : 'tol');

// Tata letak jalan tol
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

// Tata letak Jalan Soekarno-Hatta (ilustrasi)
export const CITY = Object.freeze({
  buildingFront: -8.0,
  sidewalkOut: -7.4,
  sidewalkIn: -3.75,
  curbFace: -3.6,
  edgeTop: -3.5,
  edgeBottom: 3.5,
  medianTop: 3.6,
  medianBottom: 5.8,
  oppTop: 5.9,
  oppBottom: 12.9,
  farCurbFace: 13.0,
  farSidewalkIn: 13.15,
  farSidewalkOut: 16.5,
  farBuildingFront: 17.1,
});

/** Posisi garis ukur jarak (di bahu jalan tol atau di trotoar). */
export const dimensionY = (place) => (place === 'kota' ? -5.35 : -4.9);

// jalur lalu lintas arah berlawanan (ke barat): lajur tepi dan lajur dekat median
export const ONCOMING_LANES = Object.freeze({ curb: 11.15, fast: 7.65 });

const hash = (a, b = 0) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** Latar, jalan, dan hiasan untuk area yang terlihat. */
export function drawWorld(g, view, place, opts = {}) {
  if (place === 'kota') drawCity(g, view, opts);
  else drawToll(g, view);
}

// ---------- jalan tol (ilustrasi) ----------

function drawToll(g, view) {
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
  g.fillStyle = withAlpha(COLORS.laneMark, 0.75);
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

// ---------- Jalan Soekarno-Hatta (ilustrasi) ----------

const ROOFS = ['#3b3f4c', '#4a4038', '#3c4a57', '#514548', '#3f4b43', '#474a55', '#56473b'];
const AWNINGS = ['#7f1d1d', '#1e3a8a', '#166534', '#92400e', '#6b21a8', '#334155', '#0f766e'];
const LOT = 6.5; // lebar satu ruko (m), hiasan

function drawCity(g, view, { labels = null } = {}) {
  const b = view.visibleBounds();
  const x0 = b.minX - 8;
  const x1 = b.maxX + 8;
  const w = x1 - x0;
  const C = CITY;

  // latar kota
  g.fillStyle = '#18202c';
  g.fillRect(x0, b.minY - 2, w, b.maxY - b.minY + 4);

  // deretan ruko di kedua sisi (atap dilihat dari atas, tenda toko menghadap jalan)
  drawShopRow(g, view, x0, x1, C.buildingFront, -1);
  drawShopRow(g, view, x0, x1, C.farBuildingFront, 1);

  // halaman depan ruko, trotoar, dan kerb
  g.fillStyle = '#2a3140';
  g.fillRect(x0, C.buildingFront, w, C.sidewalkOut - C.buildingFront);
  g.fillRect(x0, C.farSidewalkOut, w, C.farBuildingFront - C.farSidewalkOut);
  g.fillStyle = COLORS.sidewalk;
  g.fillRect(x0, C.sidewalkOut, w, C.sidewalkIn - C.sidewalkOut);
  g.fillRect(x0, C.farSidewalkIn, w, C.farSidewalkOut - C.farSidewalkIn);
  // sambungan ubin trotoar, samar
  g.fillStyle = 'rgba(15, 23, 42, 0.18)';
  const joint = Math.max(0.05, view.px(1));
  for (let k = Math.floor(x0 / 3); k * 3 < x1; k++) {
    g.fillRect(k * 3, C.sidewalkOut, joint, C.sidewalkIn - C.sidewalkOut);
    g.fillRect(k * 3, C.farSidewalkIn, joint, C.farSidewalkOut - C.farSidewalkIn);
  }
  g.fillStyle = '#6b7488';
  g.fillRect(x0, C.sidewalkIn, w, C.curbFace - C.sidewalkIn);
  g.fillRect(x0, C.farCurbFace, w, C.farSidewalkIn - C.farCurbFace);

  // badan jalan dan median
  g.fillStyle = COLORS.asphaltDark;
  g.fillRect(x0, C.curbFace, w, C.edgeTop - C.curbFace);
  g.fillStyle = COLORS.asphalt;
  g.fillRect(x0, C.edgeTop, w, C.edgeBottom - C.edgeTop);
  g.fillStyle = COLORS.asphaltDark;
  g.fillRect(x0, C.edgeBottom, w, C.medianTop - C.edgeBottom);
  g.fillRect(x0, C.medianBottom, w, C.oppTop - C.medianBottom);
  g.fillStyle = COLORS.asphalt;
  g.fillRect(x0, C.oppTop, w, C.oppBottom - C.oppTop);
  g.fillStyle = COLORS.asphaltDark;
  g.fillRect(x0, C.oppBottom, w, C.farCurbFace - C.oppBottom);
  g.fillStyle = '#6b7488';
  g.fillRect(x0, C.medianTop, w, C.medianBottom - C.medianTop);
  g.fillStyle = '#1f3b2b';
  g.fillRect(x0, C.medianTop + 0.15, w, C.medianBottom - C.medianTop - 0.3);

  // marka: garis tepi tipis, pembagi lajur putus-putus (3 m garis, 5 m celah)
  g.fillStyle = withAlpha(COLORS.laneMark, 0.6);
  for (const y of [C.edgeTop, C.edgeBottom, C.oppTop, C.oppBottom]) g.fillRect(x0, y - 0.06, w, 0.12);
  g.fillStyle = withAlpha(COLORS.laneMark, 0.85);
  for (const yc of [0, (C.oppTop + C.oppBottom) / 2]) {
    for (let k = Math.floor(x0 / 8); k * 8 < x1; k++) g.fillRect(k * 8, yc - 0.07, 3, 0.14);
  }

  // tanaman median dan pohon trotoar
  for (let k = Math.floor(x0 / 9); k * 9 < x1 + 9; k++) {
    if (hash(k, 21) < 0.35) continue;
    drawTreeSoft(g, k * 9 + hash(k, 22) * 4, (C.medianTop + C.medianBottom) / 2, 0.75 + hash(k, 23) * 0.3);
  }
  for (let k = Math.floor(x0 / 14) - 1; k * 14 < x1 + 14; k++) {
    if (hash(k, 31) > 0.45) drawTreeSoft(g, k * 14 + hash(k, 32) * 6, C.sidewalkOut + 0.35, 1.35 + hash(k, 33) * 0.6);
    if (hash(k, 41) > 0.45) drawTreeSoft(g, k * 14 + hash(k, 42) * 6, C.farSidewalkOut - 0.35, 1.35 + hash(k, 43) * 0.6);
  }

  // rambu batas kecepatan 50 dan papan nama jalan, bergantian tiap 45 m
  for (let k = Math.floor(x0 / 90); k * 90 < x1 + 90; k++) {
    const xs = k * 90 + 20;
    drawSpeedSign(g, { x: xs, y: C.sidewalkIn - 0.45, text: String(CITY_MAX_KMH), radius: 0.4 }, { view, minPx: 16 });
    if (labels) {
      const xn = k * 90 + 65;
      labels.add(xn, C.sidewalkOut + 0.9, 'Jl. Soekarno-Hatta', {
        bg: 'rgba(20, 83, 45, 0.94)',
        color: '#dcfce7',
        size: 10,
        dy: 0,
        priority: -3,
        optional: true,
        nudge: 'none',
      });
    }
  }
}

function drawShopRow(g, view, x0, x1, front, side) {
  // side -1: ruko di utara (atap ke arah y negatif), +1: di selatan
  for (let k = Math.floor(x0 / LOT) - 1; k * LOT < x1 + LOT; k++) {
    const hk = hash(k, side * 5 + 1);
    if (hk < 0.09) continue; // gang atau lahan kosong
    const depth = 9 + hash(k, side * 5 + 2) * 8;
    const xa = k * LOT + 0.15;
    const wLot = LOT - 0.3;
    const y0 = side < 0 ? front - depth : front;
    g.fillStyle = 'rgba(0, 0, 0, 0.35)';
    g.fillRect(xa + 0.4, y0 + (side < 0 ? 0.4 : 0.4), wLot, depth);
    g.fillStyle = ROOFS[Math.floor(hash(k, side * 5 + 3) * ROOFS.length)];
    g.fillRect(xa, y0, wLot, depth);
    // garis bubungan atap
    g.fillStyle = 'rgba(255, 255, 255, 0.05)';
    g.fillRect(xa, y0 + depth / 2 - 0.1, wLot, 0.2);
    // tenda toko di sisi jalan
    g.fillStyle = withAlpha(AWNINGS[Math.floor(hash(k, side * 5 + 4) * AWNINGS.length)], 0.8);
    const ay = side < 0 ? front - 0.8 : front;
    g.fillRect(xa, ay, wLot, 0.8);
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

// ---------- lalu lintas dan pejalan kaki latar ----------

/** Kendaraan arah berlawanan dan pejalan kaki di trotoar (dari street.js). */
export function drawStreetLife(g, view, street, time) {
  const b = view.visibleBounds();
  for (const n of street.npcs) {
    if (n.x + n.length < b.minX - 2 || n.x - n.length > b.maxX + 2) continue;
    drawVehicle(g, n, { view, minPx: n.kind === 'motor' ? 28 : 0, alpha: 0.95, braking: n.braking });
  }
  for (const p of street.walkers) {
    if (p.x < b.minX - 2 || p.x > b.maxX + 2) continue;
    drawPedestrian(g, p, { view, minPx: 15, phase: time * 7 + p.phaseOffset, variant: p.variant, accent: p.accent, color: p.color });
  }
}

/** Calon penumpang angkot. ped dalam koordinat dunia { x, y, heading, state, alpha }. */
export function drawPassenger(g, view, ped, time) {
  if (!ped || ped.alpha <= 0) return;
  // lingkaran lembut di bawah kaki supaya calon penumpang mudah ditemukan
  g.save();
  g.globalAlpha *= ped.alpha;
  g.fillStyle = 'rgba(240, 171, 252, 0.16)';
  g.strokeStyle = 'rgba(240, 171, 252, 0.7)';
  g.lineWidth = view.px(1.5);
  g.beginPath();
  g.arc(ped.x, ped.y, Math.max(0.9, view.px(15)), 0, TAU);
  g.fill();
  g.stroke();
  g.restore();
  drawPedestrian(g, { x: ped.x, y: ped.y, heading: ped.heading, radius: 0.35 }, {
    view,
    minPx: 18,
    phase: ped.state === 'jalan' ? time * 8 : 0,
    variant: 'backpack',
    accent: '#f59e0b',
    color: '#e879f9',
    alpha: ped.alpha,
  });
}

// ---------- alat bantu gambar pelajaran ----------

/** Label lokasi kecil di pojok kiri atas kanvas (dipakai di layar sempit, pengganti chip HUD). */
export function drawPlaceTag(g, view, text, { top = 10, left = 10 } = {}) {
  g.save();
  view.screen();
  g.font = `600 10.5px ${FONT}`;
  const w = g.measureText(text).width + 24;
  const h = 20;
  g.fillStyle = 'rgba(11, 18, 32, 0.8)';
  g.beginPath();
  if (g.roundRect) g.roundRect(left, top, w, h, 10);
  else g.rect(left, top, w, h);
  g.fill();
  g.fillStyle = '#4ade80';
  g.beginPath();
  g.arc(left + 9, top + h / 2, 3, 0, TAU);
  g.fill();
  g.fillStyle = 'rgba(226, 232, 240, 0.95)';
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillText(text, left + 16, top + h / 2 + 0.5);
  g.restore();
  view.world();
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

/** Garis ukur dengan ujung bertanda di bahu jalan atau trotoar, dari x0 ke x1. */
export function drawDimension(g, view, x0, x1, color = 'rgba(226, 232, 240, 0.85)', y = -4.9) {
  if (x1 - x0 < view.px(6)) return;
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

/** Mistar jarak di tepi kiri jalan dengan titik nol di origin. */
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
  // angka dalam piksel layar, dengan latar tipis supaya terbaca di atas trotoar
  view.screen();
  g.font = `600 10px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'bottom';
  for (let d = 0; origin + d <= Math.min(toX, b.maxX + 1); d += step) {
    const x = origin + d;
    if (x < b.minX - 1) continue;
    const p = view.worldToScreen(x, y0);
    const text = `${d} m`;
    const tw = g.measureText(text).width;
    g.fillStyle = 'rgba(11, 18, 32, 0.55)';
    g.fillRect(p.x - tw / 2 - 3, p.y - 23, tw + 6, 13);
    g.fillStyle = 'rgba(203, 213, 225, 0.9)';
    g.fillText(text, p.x, p.y - 11);
  }
  g.restore();
  view.world();
}

/** Mobil (mobilmu, mobil depan, atau mobil mogok). */
export function drawCarBox(g, view, car, opts = {}) {
  drawCar(g, car, { view, ...opts });
}

/** Angkot di depan mobilmu. */
export function drawLeadAngkot(g, view, a, { braking = false, doorOpen = false } = {}) {
  drawAngkot(g, a, { view, code: 'AL', braking, doorOpen });
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
