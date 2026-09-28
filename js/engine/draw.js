// Fungsi gambar yang seragam untuk semua pelajaran.
//
// Semua fungsi menerima konteks kanvas `g` yang sedang memakai transformasi DUNIA
// (panggil view.begin() atau view.world() dulu), sehingga ukuran dalam meter.
// Bila sebuah fungsi butuh ukuran konstan di layar (garis tipis, titik, teks), berikan
// opsi `view` supaya fungsi bisa mengubah piksel menjadi meter lewat view.px().

import { COLORS, FONT, MONO, SIZES, withAlpha } from './theme.js';
import { TAU } from './math.js';
import { boxCorners, shapeType } from './geometry.js';

// ---------- bantuan warna dan path ----------

function parseHex(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Campur dua warna hex, t = 0 memberi a, t = 1 memberi b. */
export function mix(a, b, t) {
  const ca = parseHex(a);
  const cb = parseHex(b);
  const c = ca.map((v, i) => Math.round(v + (cb[i] - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
export const lighten = (hex, t) => mix(hex, '#ffffff', t);
export const darken = (hex, t) => mix(hex, '#000000', t);

/** Path persegi panjang bersudut bulat (belum diisi). */
export function roundRectPath(g, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export function polygonPath(g, pts) {
  g.beginPath();
  pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
  g.closePath();
}

export function polylinePath(g, pts) {
  g.beginPath();
  pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
}

const lw = (view, px, fallback) => (view ? view.px(px) : fallback);

/** Faktor perbesaran agar objek kecil tetap terlihat minimal `minPx` piksel. */
function minScale(view, sizeM, minPx) {
  if (!view || !minPx) return 1;
  const px = sizeM * view.camera.scale;
  return px < minPx ? minPx / px : 1;
}

// ---------- latar ----------

/** Isi seluruh area terlihat dengan warna tanah dan grid halus opsional. */
export function drawGround(g, view, { color = COLORS.ground, grid = 0, gridColor = 'rgba(255,255,255,0.035)' } = {}) {
  const b = view.visibleBounds();
  g.fillStyle = color;
  g.fillRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
  if (grid > 0) drawGrid(g, view, { spacing: grid, color: gridColor });
}

export function drawGrid(g, view, { spacing = 10, color = 'rgba(255,255,255,0.05)' } = {}) {
  const b = view.visibleBounds();
  g.strokeStyle = color;
  g.lineWidth = view.px(1);
  g.beginPath();
  for (let x = Math.floor(b.minX / spacing) * spacing; x <= b.maxX; x += spacing) {
    g.moveTo(x, b.minY);
    g.lineTo(x, b.maxY);
  }
  for (let y = Math.floor(b.minY / spacing) * spacing; y <= b.maxY; y += spacing) {
    g.moveTo(b.minX, y);
    g.lineTo(b.maxX, y);
  }
  g.stroke();
}

// ---------- jalan ----------

/** Trotoar di kedua sisi jalan (bila road.sidewalk > 0). */
export function drawSidewalk(g, road, { color = COLORS.sidewalk, curb = COLORS.curb } = {}) {
  if (!road.sidewalkPolygon) return;
  g.fillStyle = color;
  polygonPath(g, road.sidewalkPolygon);
  g.fill();
  g.strokeStyle = curb;
  g.lineWidth = 0.25;
  polylinePath(g, road.leftEdge);
  g.stroke();
  polylinePath(g, road.rightEdge);
  g.stroke();
}

/** Permukaan aspal jalan. */
export function drawRoadSurface(g, road, { color = COLORS.asphalt } = {}) {
  g.fillStyle = color;
  polygonPath(g, road.polygon);
  g.fill();
}

/** Marka jalan: garis tengah kuning, pembagi lajur putus-putus, garis tepi putih. */
export function drawRoadMarkings(g, road, { center = 'solid', edges = true } = {}) {
  g.lineCap = 'butt';
  for (const m of road.markings) {
    if (m.points.length < 2) continue;
    if (m.kind === 'edge' && !edges) continue;
    g.beginPath();
    polylinePath(g, m.points);
    if (m.kind === 'center') {
      g.strokeStyle = COLORS.centerLine;
      g.lineWidth = 0.15;
      g.setLineDash(center === 'dashed' ? [3, 3] : []);
    } else if (m.kind === 'divider') {
      g.strokeStyle = withAlpha(COLORS.laneMark, 0.85);
      g.lineWidth = 0.13;
      g.setLineDash([3, 5]);
    } else {
      g.strokeStyle = withAlpha(COLORS.laneMark, 0.55);
      g.lineWidth = 0.12;
      g.setLineDash([]);
    }
    g.stroke();
  }
  g.setLineDash([]);
}

/** Trotoar, aspal, dan marka sekaligus. Untuk beberapa jalan yang bertemu, gambar per lapisan. */
export function drawRoad(g, road, opts = {}) {
  drawSidewalk(g, road, opts);
  drawRoadSurface(g, road, opts);
  drawRoadMarkings(g, road, opts);
}

export function drawIntersection(g, ix, { color = COLORS.asphalt } = {}) {
  g.fillStyle = color;
  polygonPath(g, ix.polygon);
  g.fill();
}

export function drawCrosswalk(g, cw, { color = COLORS.laneMark, alpha = 0.85 } = {}) {
  g.fillStyle = withAlpha(color, alpha);
  for (const s of cw.stripes) fillBox(g, s);
}

export function drawStopLine(g, sl, { color = COLORS.laneMark } = {}) {
  g.fillStyle = withAlpha(color, 0.9);
  fillBox(g, sl);
}

/** Isi kotak berorientasi {x, y, heading, length, width}. */
export function fillBox(g, box) {
  polygonPath(g, boxCorners(box));
  g.fill();
}

/** Garis lurus atau polyline sederhana. width dalam piksel bila view diberikan. */
export function drawLine(g, pts, { color = COLORS.laneMark, width = 1.5, view = null, dash = null, alpha = 1, cap = 'round' } = {}) {
  if (pts.length < 2) return;
  g.save();
  g.globalAlpha *= alpha;
  g.strokeStyle = color;
  g.lineWidth = view ? view.px(width) : width;
  g.lineCap = cap;
  g.lineJoin = 'round';
  if (dash) g.setLineDash(view ? dash.map((d) => view.px(d)) : dash);
  polylinePath(g, pts);
  g.stroke();
  g.restore();
}

// ---------- kendaraan ----------

/**
 * Mobil tampak atas. car = { x, y, heading, length, width, color?, ego?, braking? }.
 * opts: { color, alpha, ego, braking, highlight (warna garis sorot), shadow, headlights }
 */
export function drawCar(g, car, opts = {}) {
  const ego = opts.ego ?? car.ego;
  const color = opts.color ?? car.color ?? (ego ? COLORS.ego : COLORS.vehicles[0]);
  const braking = opts.braking ?? car.braking;
  const { alpha = 1, highlight = null, shadow = true, headlights = false, view = null, minPx = 0, variant = car.variant ?? 'sedan' } = opts;
  const k = minScale(view, car.length ?? 4.5, minPx);
  const L = (car.length ?? 4.5) * k;
  const W = (car.width ?? 1.8) * k;
  // proporsi atap dan kaca per jenis mobil
  const V = CAR_VARIANTS[variant] || CAR_VARIANTS.sedan;
  g.save();
  g.translate(car.x, car.y);
  g.rotate(car.heading || 0);
  g.globalAlpha *= alpha;

  if (headlights) {
    const grad = g.createLinearGradient(L / 2, 0, L / 2 + 16, 0);
    grad.addColorStop(0, 'rgba(254, 249, 195, 0.35)');
    grad.addColorStop(1, 'rgba(254, 249, 195, 0)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(L / 2 - 0.1, -W * 0.35);
    g.lineTo(L / 2 + 16, -W * 2.6);
    g.lineTo(L / 2 + 16, W * 2.6);
    g.lineTo(L / 2 - 0.1, W * 0.35);
    g.closePath();
    g.fill();
  }
  if (shadow) {
    g.fillStyle = 'rgba(0, 0, 0, 0.35)';
    roundRectPath(g, -L / 2 + 0.15, -W / 2 + 0.25, L, W, W * 0.3);
    g.fill();
  }
  if (ego) {
    g.fillStyle = withAlpha(COLORS.ego, 0.16);
    roundRectPath(g, -L / 2 - 0.45, -W / 2 - 0.45, L + 0.9, W + 0.9, W * 0.5);
    g.fill();
  }
  // bodi
  g.fillStyle = color;
  roundRectPath(g, -L / 2, -W / 2, L, W, Math.min(0.6, W * 0.32));
  g.fill();
  // kilap tengah
  g.fillStyle = withAlpha('#ffffff', 0.08);
  roundRectPath(g, -L * 0.42, -W * 0.18, L * 0.84, W * 0.36, W * 0.15);
  g.fill();
  // atap
  g.fillStyle = lighten(color, 0.16);
  roundRectPath(g, -L * V.roofBack, -W * 0.39, L * (V.roofBack + V.roofFront), W * 0.78, W * 0.14);
  g.fill();
  // kaca depan dan belakang
  g.fillStyle = 'rgba(12, 20, 36, 0.88)';
  g.beginPath();
  g.moveTo(L * V.roofFront, -W * 0.4);
  g.lineTo(L * V.hood, -W * 0.36);
  g.lineTo(L * V.hood, W * 0.36);
  g.lineTo(L * V.roofFront, W * 0.4);
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(-L * V.roofBack, -W * 0.38);
  g.lineTo(-L * V.rear, -W * 0.33);
  g.lineTo(-L * V.rear, W * 0.33);
  g.lineTo(-L * V.roofBack, W * 0.38);
  g.closePath();
  g.fill();
  if (V.rails) {
    // rel atap MPV
    g.fillStyle = darken(color, 0.3);
    g.fillRect(-L * V.roofBack + 0.1, -W * 0.36, L * (V.roofBack + V.roofFront) - 0.2, 0.07);
    g.fillRect(-L * V.roofBack + 0.1, W * 0.36 - 0.07, L * (V.roofBack + V.roofFront) - 0.2, 0.07);
  }
  // spion
  g.fillStyle = darken(color, 0.25);
  g.fillRect(L * 0.1, -W / 2 - 0.12, 0.16, 0.14);
  g.fillRect(L * 0.1, W / 2 - 0.02, 0.16, 0.14);
  // lampu depan
  g.fillStyle = '#fef9c3';
  g.fillRect(L / 2 - 0.14, -W / 2 + 0.16, 0.12, 0.34);
  g.fillRect(L / 2 - 0.14, W / 2 - 0.5, 0.12, 0.34);
  // lampu belakang
  g.fillStyle = braking ? '#ff3b3b' : '#9f1d1d';
  g.fillRect(-L / 2 + 0.02, -W / 2 + 0.14, 0.12, 0.36);
  g.fillRect(-L / 2 + 0.02, W / 2 - 0.5, 0.12, 0.36);
  if (braking) {
    g.fillStyle = 'rgba(255, 59, 59, 0.28)';
    g.beginPath();
    g.arc(-L / 2 - 0.2, -W / 2 + 0.32, 0.55, 0, TAU);
    g.arc(-L / 2 - 0.2, W / 2 - 0.32, 0.55, 0, TAU);
    g.fill();
  }
  if (highlight) {
    g.strokeStyle = highlight;
    g.lineWidth = lw(view, 2, 0.15);
    roundRectPath(g, -L / 2 - 0.3, -W / 2 - 0.3, L + 0.6, W + 0.6, W * 0.45);
    g.stroke();
  }
  g.restore();
}

// roofFront/roofBack: batas atap dari tengah (bagian dari panjang), hood: ujung kaca depan, rear: ujung kaca belakang
const CAR_VARIANTS = {
  sedan: { roofFront: 0.12, roofBack: 0.26, hood: 0.3, rear: 0.37, rails: false },
  city: { roofFront: 0.16, roofBack: 0.3, hood: 0.3, rear: 0.4, rails: false },
  mpv: { roofFront: 0.2, roofBack: 0.4, hood: 0.33, rear: 0.45, rails: true },
};

/** Mobil kota kecil (hatchback) seperti yang banyak dipakai di Malang. Ukuran bawaan SIZES.cityCar. */
export function drawCityCar(g, car, opts = {}) {
  drawCar(g, { length: SIZES.cityCar.length, width: SIZES.cityCar.width, ...car }, { ...opts, variant: 'city' });
}

/** MPV tujuh penumpang (atap panjang dengan rel). Ukuran bawaan SIZES.mpv. */
export function drawMPV(g, car, opts = {}) {
  drawCar(g, { length: SIZES.mpv.length, width: SIZES.mpv.width, ...car }, { ...opts, variant: 'mpv' });
}

/** Tulis teks pendek di atas kendaraan dalam piksel layar (tegak, mengikuti arah bila muat). */
function vehicleText(g, view, x, y, heading, text, { color = '#0b1220', bg = null, size = 10, maxPx = 999 } = {}) {
  if (!view || !text) return;
  const p = view.worldToScreen(x, y);
  g.save();
  view.screen();
  let a = heading || 0;
  a = Math.atan2(Math.sin(a), Math.cos(a));
  if (a > Math.PI / 2) a -= Math.PI;
  if (a < -Math.PI / 2) a += Math.PI;
  g.translate(p.x, p.y);
  g.rotate(a);
  g.font = `800 ${size}px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const w = g.measureText(text).width;
  if (w <= maxPx) {
    if (bg) {
      g.fillStyle = bg;
      roundRectPath(g, -w / 2 - 3, -size / 2 - 2, w + 6, size + 4, 3);
      g.fill();
    }
    g.fillStyle = color;
    g.fillText(text, 0, 0.5);
  }
  g.restore();
  view.world();
}

/**
 * Angkot (mikrolet) Malang tampak atas: minibus biru muda dengan kode trayek di atap.
 * a = { x, y, heading, length?, width?, code?, braking? }
 * opts: { code (misalnya 'AL', 'ADL', 'GL'), color, view (perlu untuk tulisan kode), minPx, braking, highlight, alpha, doorOpen }
 * Pintu geser ada di sisi kiri (sisi trotoar untuk lalu lintas kiri).
 */
export function drawAngkot(g, a, opts = {}) {
  const { color = a.color ?? COLORS.angkot, view = null, minPx = 0, alpha = 1, highlight = null, doorOpen = false } = opts;
  const code = opts.code ?? a.code ?? '';
  const braking = opts.braking ?? a.braking;
  const k = minScale(view, a.length ?? SIZES.angkot.length, minPx);
  const L = (a.length ?? SIZES.angkot.length) * k;
  const W = (a.width ?? SIZES.angkot.width) * k;
  g.save();
  g.translate(a.x, a.y);
  g.rotate(a.heading || 0);
  g.globalAlpha *= alpha;
  g.fillStyle = 'rgba(0, 0, 0, 0.35)';
  roundRectPath(g, -L / 2 + 0.15, -W / 2 + 0.25, L, W, 0.35);
  g.fill();
  // bodi kotak dengan moncong pendek
  g.fillStyle = color;
  roundRectPath(g, -L / 2, -W / 2, L, W, 0.32);
  g.fill();
  g.fillStyle = darken(color, 0.12);
  roundRectPath(g, L / 2 - L * 0.16, -W / 2 + 0.05, L * 0.16 - 0.05, W - 0.1, 0.25);
  g.fill();
  // kaca depan
  g.fillStyle = 'rgba(12, 20, 36, 0.88)';
  g.fillRect(L / 2 - L * 0.2, -W * 0.42, L * 0.06, W * 0.84);
  // atap dengan papan kode trayek
  g.fillStyle = lighten(color, 0.22);
  roundRectPath(g, -L / 2 + 0.2, -W * 0.4, L * 0.7, W * 0.8, 0.2);
  g.fill();
  g.fillStyle = '#f8fafc';
  roundRectPath(g, -L * 0.2, -W * 0.22, L * 0.34, W * 0.44, 0.12);
  g.fill();
  // pintu geser di sisi kiri (y negatif)
  g.fillStyle = doorOpen ? '#0f172a' : darken(color, 0.28);
  g.fillRect(-L * 0.05, -W / 2 - (doorOpen ? 0.08 : 0), L * 0.28, doorOpen ? 0.2 : 0.07);
  // lampu
  g.fillStyle = '#fef9c3';
  g.fillRect(L / 2 - 0.12, -W / 2 + 0.15, 0.1, 0.3);
  g.fillRect(L / 2 - 0.12, W / 2 - 0.45, 0.1, 0.3);
  g.fillStyle = braking ? '#ff3b3b' : '#9f1d1d';
  g.fillRect(-L / 2 + 0.02, -W / 2 + 0.12, 0.1, 0.34);
  g.fillRect(-L / 2 + 0.02, W / 2 - 0.46, 0.1, 0.34);
  if (braking) {
    g.fillStyle = 'rgba(255, 59, 59, 0.28)';
    g.beginPath();
    g.arc(-L / 2 - 0.2, -W / 2 + 0.3, 0.5, 0, TAU);
    g.arc(-L / 2 - 0.2, W / 2 - 0.3, 0.5, 0, TAU);
    g.fill();
  }
  if (highlight) {
    g.strokeStyle = highlight;
    g.lineWidth = lw(view, 2, 0.15);
    roundRectPath(g, -L / 2 - 0.3, -W / 2 - 0.3, L + 0.6, W + 0.6, 0.6);
    g.stroke();
  }
  g.restore();
  if (code && view) {
    const px = W * 0.44 * view.camera.scale;
    if (px >= 7) vehicleText(g, view, a.x - Math.cos(a.heading || 0) * L * 0.03, a.y - Math.sin(a.heading || 0) * L * 0.03, a.heading, code, { size: Math.min(12, Math.max(7, px * 0.72)), maxPx: L * 0.34 * view.camera.scale + 2 });
  }
}

/**
 * Sepeda motor dengan pengendara tampak atas, opsional berboncengan.
 * m = { x, y, heading, length?, braking? }
 * opts: { passenger (false), color (bodi motor), jacket (baju pengendara), helmet, passengerHelmet,
 *         passengerJacket, view, minPx (bawaan 12), braking, highlight, alpha }
 */
export function drawMotor(g, m, opts = {}) {
  const {
    passenger = m.passenger ?? false,
    color = m.color ?? COLORS.motor,
    jacket = m.jacket ?? '#334155',
    helmet = m.helmet ?? COLORS.helmets[0],
    passengerHelmet = m.passengerHelmet ?? COLORS.helmets[3],
    passengerJacket = m.passengerJacket ?? '#9f1239',
    view = null,
    minPx = 12,
    alpha = 1,
    highlight = null,
  } = opts;
  const braking = opts.braking ?? m.braking;
  const L0 = m.length ?? SIZES.motor.length;
  const k = minScale(view, L0, minPx);
  const L = L0 * k;
  const u = k; // satuan meter yang ikut diperbesar
  g.save();
  g.translate(m.x, m.y);
  g.rotate(m.heading || 0);
  g.globalAlpha *= alpha;
  g.fillStyle = 'rgba(0, 0, 0, 0.3)';
  g.beginPath();
  g.ellipse(0.08 * u, 0.12 * u, L * 0.52, 0.34 * u, 0, 0, TAU);
  g.fill();
  // roda depan dan belakang
  g.fillStyle = '#0f172a';
  roundRectPath(g, L * 0.3, -0.07 * u, L * 0.2, 0.14 * u, 0.07 * u);
  g.fill();
  roundRectPath(g, -L * 0.5, -0.08 * u, L * 0.2, 0.16 * u, 0.08 * u);
  g.fill();
  // bodi
  g.fillStyle = color;
  roundRectPath(g, -L * 0.36, -0.17 * u, L * 0.68, 0.34 * u, 0.15 * u);
  g.fill();
  g.fillStyle = lighten(color, 0.25);
  roundRectPath(g, -L * 0.3, -0.09 * u, L * 0.26, 0.18 * u, 0.08 * u);
  g.fill();
  // setang
  g.strokeStyle = '#1e293b';
  g.lineCap = 'round';
  g.lineWidth = 0.06 * u;
  g.beginPath();
  g.moveTo(L * 0.26, -0.36 * u);
  g.lineTo(L * 0.26, 0.36 * u);
  g.stroke();
  // lampu
  g.fillStyle = '#fef9c3';
  g.beginPath();
  g.arc(L * 0.34, 0, 0.06 * u, 0, TAU);
  g.fill();
  g.fillStyle = braking ? '#ff3b3b' : '#9f1d1d';
  g.fillRect(-L * 0.4, -0.06 * u, 0.06 * u, 0.12 * u);
  if (braking) {
    g.fillStyle = 'rgba(255, 59, 59, 0.3)';
    g.beginPath();
    g.arc(-L * 0.45, 0, 0.28 * u, 0, TAU);
    g.fill();
  }
  const rider = (x, jacketColor, helmetColor, arms) => {
    // lengan ke setang
    if (arms) {
      g.strokeStyle = darken(jacketColor, 0.15);
      g.lineWidth = 0.1 * u;
      g.beginPath();
      g.moveTo(x + 0.05 * u, -0.22 * u);
      g.lineTo(L * 0.24, -0.32 * u);
      g.moveTo(x + 0.05 * u, 0.22 * u);
      g.lineTo(L * 0.24, 0.32 * u);
      g.stroke();
    }
    g.fillStyle = jacketColor;
    g.beginPath();
    g.ellipse(x, 0, 0.2 * u, 0.29 * u, 0, 0, TAU);
    g.fill();
    g.fillStyle = helmetColor;
    g.beginPath();
    g.arc(x + 0.04 * u, 0, 0.14 * u, 0, TAU);
    g.fill();
    g.fillStyle = 'rgba(12, 20, 36, 0.7)';
    g.beginPath();
    g.arc(x + 0.06 * u, 0, 0.14 * u, -0.9, 0.9);
    g.closePath();
    g.fill();
  };
  if (passenger) rider(-L * 0.25, passengerJacket, passengerHelmet, false);
  rider(-L * 0.02, jacket, helmet, true);
  if (highlight) {
    g.strokeStyle = highlight;
    g.lineWidth = lw(view, 2, 0.1);
    g.beginPath();
    g.ellipse(0, 0, L * 0.7, 0.62 * u, 0, 0, TAU);
    g.stroke();
  }
  g.restore();
}

/** Bus kota tampak atas. */
export function drawBus(g, bus, opts = {}) {
  const color = opts.color ?? bus.color ?? COLORS.bus;
  const { alpha = 1, highlight = null, view = null, minPx = 0 } = opts;
  const braking = opts.braking ?? bus.braking;
  const code = opts.code ?? bus.code ?? '';
  const k = minScale(view, bus.length ?? 12, minPx);
  const L = (bus.length ?? 12) * k;
  const W = (bus.width ?? 2.5) * k;
  g.save();
  g.translate(bus.x, bus.y);
  g.rotate(bus.heading || 0);
  g.globalAlpha *= alpha;
  g.fillStyle = 'rgba(0, 0, 0, 0.35)';
  roundRectPath(g, -L / 2 + 0.2, -W / 2 + 0.3, L, W, 0.4);
  g.fill();
  g.fillStyle = color;
  roundRectPath(g, -L / 2, -W / 2, L, W, 0.45);
  g.fill();
  g.fillStyle = 'rgba(12, 20, 36, 0.85)';
  g.fillRect(L / 2 - 0.55, -W / 2 + 0.2, 0.4, W - 0.4);
  // panel atap (AC dan ventilasi), jumlahnya menyesuaikan panjang bus
  g.fillStyle = lighten(color, 0.2);
  const span = Math.max(1, L - 2.7);
  const panels = Math.max(1, Math.round(span / 3.2));
  const slot = span / panels;
  for (let i = 0; i < panels; i++) g.fillRect(-L / 2 + 1.1 + i * slot + slot * 0.25, -W * 0.25, slot * 0.5, W * 0.5);
  g.fillStyle = '#fef9c3';
  g.fillRect(L / 2 - 0.12, -W / 2 + 0.15, 0.1, 0.35);
  g.fillRect(L / 2 - 0.12, W / 2 - 0.5, 0.1, 0.35);
  g.fillStyle = braking ? '#ff3b3b' : '#9f1d1d';
  g.fillRect(-L / 2 + 0.02, -W / 2 + 0.15, 0.1, 0.4);
  g.fillRect(-L / 2 + 0.02, W / 2 - 0.55, 0.1, 0.4);
  if (braking) {
    g.fillStyle = 'rgba(255, 59, 59, 0.28)';
    g.beginPath();
    g.arc(-L / 2 - 0.25, -W / 2 + 0.35, 0.6, 0, TAU);
    g.arc(-L / 2 - 0.25, W / 2 - 0.35, 0.6, 0, TAU);
    g.fill();
  }
  if (highlight) {
    g.strokeStyle = highlight;
    g.lineWidth = lw(view, 2, 0.15);
    roundRectPath(g, -L / 2 - 0.3, -W / 2 - 0.3, L + 0.6, W + 0.6, 0.7);
    g.stroke();
  }
  g.restore();
  if (code && view && W * view.camera.scale >= 12) {
    vehicleText(g, view, bus.x, bus.y, bus.heading, code, { color: '#0b1220', bg: '#f8fafc', size: Math.min(12, Math.max(8, W * view.camera.scale * 0.4)) });
  }
}

/** Shuttle otonom kecil (bentuk kapsul dengan modul sensor di atap). */
export function drawShuttle(g, s, opts = {}) {
  const color = opts.color ?? s.color ?? COLORS.shuttle;
  const { alpha = 1, highlight = null, view = null, ego = s.ego, minPx = 0 } = opts;
  const braking = opts.braking ?? s.braking;
  const k = minScale(view, s.length ?? 5, minPx);
  const L = (s.length ?? 5) * k;
  const W = (s.width ?? 2.1) * k;
  g.save();
  g.translate(s.x, s.y);
  g.rotate(s.heading || 0);
  g.globalAlpha *= alpha;
  g.fillStyle = 'rgba(0, 0, 0, 0.35)';
  roundRectPath(g, -L / 2 + 0.15, -W / 2 + 0.25, L, W, W * 0.45);
  g.fill();
  if (ego) {
    g.fillStyle = withAlpha(COLORS.ego, 0.16);
    roundRectPath(g, -L / 2 - 0.45, -W / 2 - 0.45, L + 0.9, W + 0.9, W * 0.6);
    g.fill();
  }
  g.fillStyle = color;
  roundRectPath(g, -L / 2, -W / 2, L, W, W * 0.42);
  g.fill();
  g.fillStyle = 'rgba(12, 20, 36, 0.82)';
  roundRectPath(g, -L / 2 + 0.3, -W / 2 + 0.22, L - 0.6, W - 0.44, W * 0.3);
  g.fill();
  g.fillStyle = lighten(color, 0.05);
  roundRectPath(g, -L * 0.3, -W * 0.28, L * 0.6, W * 0.56, W * 0.18);
  g.fill();
  g.fillStyle = COLORS.ego;
  g.beginPath();
  g.arc(0, 0, 0.32, 0, TAU);
  g.fill();
  g.fillStyle = '#0b1220';
  g.beginPath();
  g.arc(0, 0, 0.16, 0, TAU);
  g.fill();
  g.fillStyle = '#fef9c3';
  g.fillRect(L / 2 - 0.12, -W / 2 + 0.3, 0.1, 0.3);
  g.fillRect(L / 2 - 0.12, W / 2 - 0.6, 0.1, 0.3);
  // lampu rem (belakang)
  g.fillStyle = braking ? '#ff3b3b' : '#9f1d1d';
  g.fillRect(-L / 2 + 0.03, -W / 2 + 0.3, 0.1, 0.34);
  g.fillRect(-L / 2 + 0.03, W / 2 - 0.64, 0.1, 0.34);
  if (braking) {
    g.fillStyle = 'rgba(255, 59, 59, 0.28)';
    g.beginPath();
    g.arc(-L / 2 - 0.2, -W / 2 + 0.47, 0.55, 0, TAU);
    g.arc(-L / 2 - 0.2, W / 2 - 0.47, 0.55, 0, TAU);
    g.fill();
  }
  if (highlight) {
    g.strokeStyle = highlight;
    g.lineWidth = lw(view, 2, 0.15);
    roundRectPath(g, -L / 2 - 0.3, -W / 2 - 0.3, L + 0.6, W + 0.6, W * 0.6);
    g.stroke();
  }
  g.restore();
}

/**
 * Pejalan kaki tampak atas. p = { x, y, heading, radius?, variant?, accent? }.
 * opts: { color (baju), phase (fase langkah, misalnya waktu * 6), view, minPx, alpha, highlight,
 *         variant: 'default' | 'hijab' | 'backpack' | 'umbrella', accent (warna hijab, tas, atau payung) }
 */
export function drawPedestrian(g, p, opts = {}) {
  const { color = p.color ?? COLORS.pedestrian, phase = 0, view = null, minPx = 9, alpha = 1, highlight = null } = opts;
  const variant = opts.variant ?? p.variant ?? 'default';
  const accent = opts.accent ?? p.accent ?? (variant === 'hijab' ? COLORS.hijab[0] : variant === 'umbrella' ? '#1d4ed8' : '#b45309');
  const r0 = p.radius ?? 0.35;
  const r = r0 * minScale(view, r0 * 2, minPx);
  g.save();
  g.translate(p.x, p.y);
  g.rotate(p.heading || 0);
  g.globalAlpha *= alpha;
  g.fillStyle = 'rgba(0, 0, 0, 0.3)';
  g.beginPath();
  g.ellipse(0.08 * r / r0, 0.12 * r / r0, r * 0.75, r * 1.1, 0, 0, TAU);
  g.fill();
  // lengan berayun
  const swing = Math.sin(phase) * r * 0.55;
  g.fillStyle = darken(color, 0.25);
  g.beginPath();
  g.ellipse(swing, -r * 0.95, r * 0.28, r * 0.18, 0, 0, TAU);
  g.ellipse(-swing, r * 0.95, r * 0.28, r * 0.18, 0, 0, TAU);
  g.fill();
  // bahu
  g.fillStyle = color;
  g.beginPath();
  g.ellipse(0, 0, r * 0.55, r * 1.0, 0, 0, TAU);
  g.fill();
  if (variant === 'backpack') {
    g.fillStyle = accent;
    roundRectPath(g, -r * 0.95, -r * 0.62, r * 0.55, r * 1.24, r * 0.2);
    g.fill();
    g.fillStyle = darken(accent, 0.3);
    g.fillRect(-r * 0.62, -r * 0.5, r * 0.1, r * 1.0);
  }
  if (variant === 'hijab') {
    // kerudung menutup kepala dan jatuh ke bahu
    g.fillStyle = darken(accent, 0.12);
    g.beginPath();
    g.ellipse(-r * 0.12, 0, r * 0.42, r * 0.7, 0, 0, TAU);
    g.fill();
    g.fillStyle = accent;
    g.beginPath();
    g.arc(r * 0.06, 0, r * 0.46, 0, TAU);
    g.fill();
    g.fillStyle = '#f5d0b5';
    g.beginPath();
    g.ellipse(r * 0.38, 0, r * 0.1, r * 0.2, 0, 0, TAU);
    g.fill();
  } else {
    // kepala
    g.fillStyle = '#f5d0b5';
    g.beginPath();
    g.arc(r * 0.08, 0, r * 0.42, 0, TAU);
    g.fill();
    g.fillStyle = '#3b2a20';
    g.beginPath();
    g.arc(-r * 0.02, 0, r * 0.36, Math.PI * 0.55, Math.PI * 1.45);
    g.fill();
  }
  if (variant === 'umbrella') {
    // payung terbuka menutupi badan
    const R = r * 1.55;
    g.fillStyle = withAlpha(accent, 0.94);
    g.beginPath();
    g.arc(r * 0.1, 0, R, 0, TAU);
    g.fill();
    g.strokeStyle = lighten(accent, 0.35);
    g.lineWidth = R * 0.06;
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      g.moveTo(r * 0.1, 0);
      g.lineTo(r * 0.1 + Math.cos(a) * R, Math.sin(a) * R);
    }
    g.stroke();
    g.fillStyle = '#e2e8f0';
    g.beginPath();
    g.arc(r * 0.1, 0, R * 0.12, 0, TAU);
    g.fill();
  }
  if (highlight) {
    g.strokeStyle = highlight;
    g.lineWidth = lw(view, 2, 0.1);
    g.beginPath();
    g.arc(0, 0, r * (variant === 'umbrella' ? 1.9 : 1.6), 0, TAU);
    g.stroke();
  }
  g.restore();
}

/** Pesepeda tampak atas. c = { x, y, heading, length? }. */
export function drawCyclist(g, c, opts = {}) {
  const { color = c.color ?? COLORS.cyclist, view = null, minPx = 15, alpha = 1, highlight = null } = opts;
  const L0 = c.length ?? 1.8;
  const k = minScale(view, L0, minPx);
  const L = L0 * k;
  g.save();
  g.translate(c.x, c.y);
  g.rotate(c.heading || 0);
  g.globalAlpha *= alpha;
  g.fillStyle = 'rgba(0, 0, 0, 0.3)';
  g.beginPath();
  g.ellipse(0.1 * k, 0.15 * k, L * 0.5, 0.3 * k, 0, 0, TAU);
  g.fill();
  // roda dan rangka
  g.strokeStyle = '#111827';
  g.lineCap = 'round';
  g.lineWidth = 0.12 * k;
  g.beginPath();
  g.moveTo(-L * 0.5, 0);
  g.lineTo(-L * 0.18, 0);
  g.moveTo(L * 0.18, 0);
  g.lineTo(L * 0.5, 0);
  g.stroke();
  g.strokeStyle = '#94a3b8';
  g.lineWidth = 0.07 * k;
  g.beginPath();
  g.moveTo(-L * 0.35, 0);
  g.lineTo(L * 0.35, 0);
  g.moveTo(L * 0.28, -0.28 * k);
  g.lineTo(L * 0.28, 0.28 * k);
  g.stroke();
  // pengendara
  g.fillStyle = color;
  g.beginPath();
  g.ellipse(-L * 0.02, 0, 0.32 * k, 0.3 * k, 0, 0, TAU);
  g.fill();
  g.fillStyle = darken(color, 0.35);
  g.beginPath();
  g.arc(L * 0.1, 0, 0.17 * k, 0, TAU);
  g.fill();
  if (highlight) {
    g.strokeStyle = highlight;
    g.lineWidth = lw(view, 2, 0.1);
    g.beginPath();
    g.ellipse(0, 0, L * 0.7, 0.7 * k, 0, 0, TAU);
    g.stroke();
  }
  g.restore();
}

// ---------- infrastruktur dan objek ----------

/**
 * Lampu lalu lintas tampak atas: tiang dan rumah lampu dengan tiga lampu.
 * light = { x, y, heading (arah muka lampu), state: 'red' | 'yellow' | 'green' }.
 * opts: { view, minPx, glow, dim (redup, misalnya saat tidak relevan) }
 */
export function drawTrafficLight(g, light, opts = {}) {
  const { view = null, minPx = 26, glow = true, alpha = 1, highlight = null } = opts;
  const k = minScale(view, 1.5, minPx);
  const colors = { red: COLORS.lightRed, yellow: COLORS.lightYellow, green: COLORS.lightGreen };
  g.save();
  g.translate(light.x, light.y);
  g.rotate(light.heading || 0);
  g.globalAlpha *= alpha;
  g.scale(k, k);
  // tiang
  g.fillStyle = '#475569';
  g.beginPath();
  g.arc(0, 0, 0.2, 0, TAU);
  g.fill();
  // rumah lampu sedikit di depan tiang, melintang arah muka
  g.fillStyle = 'rgba(0,0,0,0.35)';
  roundRectPath(g, 0.12, -0.72, 0.62, 1.5, 0.18);
  g.fill();
  g.fillStyle = '#0f172a';
  roundRectPath(g, 0.05, -0.78, 0.55, 1.56, 0.16);
  g.fill();
  g.strokeStyle = '#334155';
  g.lineWidth = 0.06;
  g.stroke();
  const order = ['red', 'yellow', 'green'];
  order.forEach((st, i) => {
    const y = -0.48 + i * 0.48;
    const on = light.state === st;
    if (on && glow) {
      const grad = g.createRadialGradient(0.33, y, 0.05, 0.33, y, 1.1);
      grad.addColorStop(0, withAlpha(colors[st], 0.55));
      grad.addColorStop(1, withAlpha(colors[st], 0));
      g.fillStyle = grad;
      g.beginPath();
      g.arc(0.33, y, 1.1, 0, TAU);
      g.fill();
    }
    g.fillStyle = on ? colors[st] : COLORS.lightOff;
    g.beginPath();
    g.arc(0.33, y, 0.17, 0, TAU);
    g.fill();
  });
  if (highlight) {
    g.strokeStyle = highlight;
    g.lineWidth = lw(view, 2, 0.1) / k;
    g.beginPath();
    g.arc(0.2, 0, 1.2, 0, TAU);
    g.stroke();
  }
  g.restore();
}

/** Rambu batas kecepatan (lingkaran putih bercincin merah). sign = { x, y, text }. */
export function drawSpeedSign(g, sign, opts = {}) {
  const { view = null, minPx = 16, highlight = null } = opts;
  const r0 = sign.radius ?? 0.45;
  const r = r0 * minScale(view, r0 * 2, minPx);
  g.save();
  g.fillStyle = '#475569';
  g.beginPath();
  g.arc(sign.x, sign.y, r * 0.3, 0, TAU);
  g.fill();
  g.fillStyle = '#f8fafc';
  g.beginPath();
  g.arc(sign.x, sign.y, r, 0, TAU);
  g.fill();
  g.strokeStyle = '#dc2626';
  g.lineWidth = r * 0.22;
  g.stroke();
  if (view && sign.text) {
    const p = view.worldToScreen(sign.x, sign.y);
    view.screen();
    g.fillStyle = '#0f172a';
    g.font = `700 ${Math.max(8, r * view.camera.scale * 0.9)}px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(sign.text, p.x, p.y + 0.5);
    view.world();
  }
  if (highlight) {
    g.strokeStyle = highlight;
    g.lineWidth = lw(view, 2, 0.1);
    g.beginPath();
    g.arc(sign.x, sign.y, r * 1.6, 0, TAU);
    g.stroke();
  }
  g.restore();
}

/** Kotak dari dua sudut: rectBox(x0, y0, x1, y1) -> { x, y, heading: 0, length, width }. */
export function rectBox(x0, y0, x1, y1, extra = {}) {
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, heading: 0, length: Math.abs(x1 - x0), width: Math.abs(y1 - y0), ...extra };
}

function hash2(x, y) {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/** Gedung tampak atas. b = kotak { x, y, length, width, heading? }. */
export function drawBuilding(g, b, { color = COLORS.building, roof = COLORS.roof, shadow = 1.2 } = {}) {
  g.save();
  g.translate(b.x, b.y);
  g.rotate(b.heading || 0);
  const L = b.length;
  const W = b.width;
  g.fillStyle = 'rgba(0, 0, 0, 0.35)';
  g.fillRect(-L / 2 + shadow * 0.6, -W / 2 + shadow, L, W);
  g.fillStyle = color;
  g.fillRect(-L / 2, -W / 2, L, W);
  const inset = Math.min(0.9, L * 0.08, W * 0.08);
  g.fillStyle = roof;
  g.fillRect(-L / 2 + inset, -W / 2 + inset, L - 2 * inset, W - 2 * inset);
  g.strokeStyle = COLORS.roofEdge;
  g.lineWidth = 0.18;
  g.strokeRect(-L / 2 + inset, -W / 2 + inset, L - 2 * inset, W - 2 * inset);
  // detail atap (unit AC, tangki air) dengan posisi tetap dari hash
  const n = 1 + Math.floor(hash2(b.x, b.y) * 3);
  g.fillStyle = lighten(roof, 0.12);
  for (let i = 0; i < n; i++) {
    const hx = hash2(b.x + i * 3.1, b.y - i * 1.7);
    const hy = hash2(b.y + i * 2.3, b.x + i * 0.9);
    const w = 1.2 + hx * 1.2;
    const h = 1 + hy;
    const x = -L / 2 + inset + 0.6 + hx * Math.max(0, L - 2 * inset - w - 1.2);
    const y = -W / 2 + inset + 0.6 + hy * Math.max(0, W - 2 * inset - h - 1.2);
    g.fillRect(x, y, w, h);
  }
  g.restore();
}

/** Pohon tampak atas (kanopi). */
export function drawTree(g, x, y, r = 2) {
  g.fillStyle = 'rgba(0, 0, 0, 0.3)';
  g.beginPath();
  g.arc(x + r * 0.25, y + r * 0.35, r, 0, TAU);
  g.fill();
  g.fillStyle = COLORS.tree;
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
  g.fillStyle = COLORS.treeLight;
  g.beginPath();
  g.arc(x - r * 0.25, y - r * 0.25, r * 0.6, 0, TAU);
  g.fill();
}

/** Tembok atau pembatas beton. w = kotak { x, y, length, width, heading? }. */
export function drawWall(g, w, { color = COLORS.wall } = {}) {
  g.save();
  g.translate(w.x, w.y);
  g.rotate(w.heading || 0);
  const L = w.length;
  const W = w.width;
  g.fillStyle = 'rgba(0, 0, 0, 0.35)';
  g.fillRect(-L / 2 + 0.2, -W / 2 + 0.3, L, W);
  g.fillStyle = color;
  g.fillRect(-L / 2, -W / 2, L, W);
  g.save();
  g.beginPath();
  g.rect(-L / 2, -W / 2, L, W);
  g.clip();
  g.strokeStyle = darken(color, 0.25);
  g.lineWidth = 0.08;
  g.beginPath();
  for (let t = -L / 2 - W; t < L / 2 + W; t += 0.6) {
    g.moveTo(t, -W / 2);
    g.lineTo(t + W, W / 2);
  }
  g.stroke();
  g.restore();
  g.strokeStyle = lighten(color, 0.2);
  g.lineWidth = 0.08;
  g.strokeRect(-L / 2, -W / 2, L, W);
  g.restore();
}

/** Kerucut lalu lintas. c = { x, y, radius? }. */
export function drawCone(g, c, { view = null, minPx = 8 } = {}) {
  const r0 = c.radius ?? 0.3;
  const r = r0 * minScale(view, r0 * 2, minPx);
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.beginPath();
  g.arc(c.x + r * 0.2, c.y + r * 0.3, r, 0, TAU);
  g.fill();
  g.fillStyle = COLORS.cone;
  g.beginPath();
  g.arc(c.x, c.y, r, 0, TAU);
  g.fill();
  g.strokeStyle = '#fff7ed';
  g.lineWidth = r * 0.25;
  g.beginPath();
  g.arc(c.x, c.y, r * 0.55, 0, TAU);
  g.stroke();
  g.fillStyle = lighten(COLORS.cone, 0.3);
  g.beginPath();
  g.arc(c.x, c.y, r * 0.2, 0, TAU);
  g.fill();
}

/** Halte (tempat pemberhentian bus/shuttle). h = kotak { x, y, length, width, heading? }. */
export function drawHalte(g, h, { color = '#38bdf8' } = {}) {
  g.save();
  g.translate(h.x, h.y);
  g.rotate(h.heading || 0);
  const L = h.length;
  const W = h.width;
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect(-L / 2 + 0.2, -W / 2 + 0.3, L, W);
  g.fillStyle = withAlpha(color, 0.25);
  g.fillRect(-L / 2, -W / 2, L, W);
  g.strokeStyle = color;
  g.lineWidth = 0.15;
  g.strokeRect(-L / 2, -W / 2, L, W);
  g.fillStyle = color;
  g.fillRect(-L / 2, -W / 2, L, 0.3);
  g.restore();
}

/**
 * Rambu halte (tempat pemberhentian bus/angkot/shuttle): pelat biru dengan gambar bus putih di tiang.
 * sign = { x, y, heading? (arah muka rambu), label? }
 * opts: { view, minPx (bawaan 18, ukuran pelat di layar), color, highlight, label (teks di bawah, perlu view) }
 */
export function drawHalteSign(g, sign, opts = {}) {
  const { view = null, minPx = 18, color = COLORS.halte, highlight = null, alpha = 1 } = opts;
  const label = opts.label ?? sign.label ?? '';
  const s0 = 0.7;
  const k = minScale(view, s0, minPx);
  const s = s0 * k;
  g.save();
  g.translate(sign.x, sign.y);
  g.globalAlpha *= alpha;
  // tiang
  g.fillStyle = '#475569';
  g.beginPath();
  g.arc(0, 0, 0.08 * k, 0, TAU);
  g.fill();
  // pelat biru bertepi putih, selalu tegak di layar supaya mudah dibaca
  g.fillStyle = 'rgba(0, 0, 0, 0.35)';
  roundRectPath(g, -s / 2 + 0.05 * k, -s * 1.25 + 0.08 * k, s, s, s * 0.18);
  g.fill();
  g.fillStyle = '#f8fafc';
  roundRectPath(g, -s / 2 - 0.04 * k, -s * 1.25 - 0.04 * k, s + 0.08 * k, s + 0.08 * k, s * 0.2);
  g.fill();
  g.fillStyle = color;
  roundRectPath(g, -s / 2, -s * 1.25, s, s, s * 0.18);
  g.fill();
  // gambar bus
  const bx = -s * 0.3;
  const by = -s * 1.25 + s * 0.22;
  g.fillStyle = '#f8fafc';
  roundRectPath(g, bx, by, s * 0.6, s * 0.46, s * 0.07);
  g.fill();
  g.fillStyle = color;
  g.fillRect(bx + s * 0.07, by + s * 0.07, s * 0.2, s * 0.14);
  g.fillRect(bx + s * 0.33, by + s * 0.07, s * 0.2, s * 0.14);
  g.fillStyle = '#f8fafc';
  g.beginPath();
  g.arc(bx + s * 0.14, by + s * 0.5, s * 0.06, 0, TAU);
  g.arc(bx + s * 0.46, by + s * 0.5, s * 0.06, 0, TAU);
  g.fill();
  if (highlight) {
    g.strokeStyle = highlight;
    g.lineWidth = lw(view, 2, 0.1);
    g.beginPath();
    g.arc(0, -s * 0.75, s * 1.05, 0, TAU);
    g.stroke();
  }
  g.restore();
  if (label && view) drawLabel(g, view, sign.x, sign.y, label, { dy: 14, size: 11, color: '#bfdbfe' });
}

// warna lampu sama dengan lampu di Shuttle 3D (js/sim3d)
export const SIGNAL_LAMPS = Object.freeze({
  on: Object.freeze({ red: '#ff3b30', yellow: '#ffc400', green: '#2ee06f' }),
  off: Object.freeze({ red: '#3b1a18', yellow: '#3b3218', green: '#16361f' }),
  housing: '#1d232b',
  pole: '#4a5260',
});

/**
 * Lampu lalu lintas bergaya Shuttle 3D: tiang di trotoar kiri, lengan melintang di atas lajur,
 * dan kepala lampu (merah, kuning, hijau) di ujung lengan.
 * light = { x, y (posisi tiang), heading (arah muka lampu, menghadap kendaraan yang datang), state }
 * opts: { arm (panjang lengan m, bawaan 2,6 seperti di 3D; 0 = tanpa lengan), view, minPx (bawaan 22, ukuran kepala di layar),
 *         glow, alpha, highlight, simulated (true: beri tanda kecil bahwa lampu ini simulasi, perlu view) }
 * Lengan mengarah ke kiri dari arah muka lampu, yaitu ke kanan dari arah kendaraan yang datang,
 * sesuai tiang di sisi kiri jalan untuk lalu lintas kiri.
 */
export function drawTrafficSignal(g, light, opts = {}) {
  const { arm = 2.6, view = null, minPx = 22, glow = true, alpha = 1, highlight = null, simulated = false } = opts;
  const k = minScale(view, 1.5, minPx);
  const state = light.state;
  g.save();
  g.translate(light.x, light.y);
  g.rotate(light.heading || 0);
  g.globalAlpha *= alpha;
  const headY = -arm * 0.9;
  if (arm > 0) {
    g.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    g.lineWidth = Math.max(0.16, view ? view.px(3) : 0);
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(0.2, 0.25);
    g.lineTo(0.2, -arm + 0.25);
    g.stroke();
    g.strokeStyle = SIGNAL_LAMPS.pole;
    g.lineWidth = Math.max(0.14, view ? view.px(2.5) : 0);
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(0, -arm);
    g.stroke();
  }
  // tiang
  g.fillStyle = SIGNAL_LAMPS.pole;
  g.beginPath();
  g.arc(0, 0, 0.2 * k, 0, TAU);
  g.fill();
  const head = (y, scale) => {
    g.save();
    g.translate(0, y);
    g.scale(k * scale, k * scale);
    g.fillStyle = 'rgba(0, 0, 0, 0.35)';
    roundRectPath(g, 0.12, -0.72, 0.62, 1.5, 0.18);
    g.fill();
    g.fillStyle = SIGNAL_LAMPS.housing;
    roundRectPath(g, 0.05, -0.78, 0.55, 1.56, 0.16);
    g.fill();
    g.strokeStyle = '#334155';
    g.lineWidth = 0.06;
    g.stroke();
    ['red', 'yellow', 'green'].forEach((st, i) => {
      const ly = -0.48 + i * 0.48;
      const on = state === st;
      if (on && glow) {
        const grad = g.createRadialGradient(0.33, ly, 0.05, 0.33, ly, 1.1);
        grad.addColorStop(0, withAlpha(SIGNAL_LAMPS.on[st], 0.55));
        grad.addColorStop(1, withAlpha(SIGNAL_LAMPS.on[st], 0));
        g.fillStyle = grad;
        g.beginPath();
        g.arc(0.33, ly, 1.1, 0, TAU);
        g.fill();
      }
      g.fillStyle = on ? SIGNAL_LAMPS.on[st] : SIGNAL_LAMPS.off[st];
      g.beginPath();
      g.arc(0.33, ly, 0.17, 0, TAU);
      g.fill();
    });
    g.restore();
  };
  if (arm > 0) head(headY, 1);
  else head(0, 1);
  if (highlight) {
    g.strokeStyle = highlight;
    g.lineWidth = lw(view, 2, 0.1);
    g.beginPath();
    g.arc(0.2 * k, arm > 0 ? headY : 0, 1.2 * k, 0, TAU);
    g.stroke();
  }
  g.restore();
  if (simulated && view) {
    // tanda "simulasi" di sisi luar tiang (menjauhi lengan dan lajur), supaya kepala lampu tetap terlihat
    const tag = { size: 10, color: '#fde68a', bg: 'rgba(11, 18, 32, 0.8)' };
    if (arm > 0) {
      const d = view.px(13) + 0.2 * k;
      drawLabel(g, view, light.x - Math.sin(light.heading || 0) * d, light.y + Math.cos(light.heading || 0) * d, 'simulasi', tag);
    } else drawLabel(g, view, light.x, light.y, 'simulasi', { ...tag, dy: -(view.camera.scale * 0.8 * k + 12) });
  }
}

/**
 * Gambar kendaraan atau pejalan kaki menurut `kind`:
 * 'car' | 'city' | 'mpv' | 'angkot' | 'motor' | 'bus' | 'minibus' | 'shuttle' | 'cyclist' | 'pedestrian'.
 * Praktis untuk lalu lintas campuran. opts diteruskan ke fungsi gambar yang sesuai.
 */
export function drawVehicle(g, v, opts = {}) {
  switch (v.kind) {
    case 'city':
      return drawCityCar(g, v, opts);
    case 'mpv':
      return drawMPV(g, v, opts);
    case 'angkot':
      return drawAngkot(g, v, opts);
    case 'motor':
      return drawMotor(g, v, opts);
    case 'bus':
    case 'minibus':
      return drawBus(g, v, opts);
    case 'shuttle':
      return drawShuttle(g, v, opts);
    case 'cyclist':
      return drawCyclist(g, v, opts);
    case 'pedestrian':
      return drawPedestrian(g, v, opts);
    default:
      return drawCar(g, v, opts);
  }
}

// ---------- jalur, panah, penanda, label ----------

/** Jalur (polyline) dengan panah arah opsional. width dalam piksel. */
export function drawPath(g, pts, { color = COLORS.path, width = 3, view = null, dash = null, alpha = 1, arrows = 0 } = {}) {
  drawLine(g, pts, { color, width, view, dash, alpha });
  if (arrows > 0 && pts.length > 1) {
    const total = pts.reduce((acc, p, i) => (i ? acc + Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) : 0), 0);
    let next = arrows / 2;
    let acc = 0;
    for (let i = 1; i < pts.length && next < total; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const seg = Math.hypot(b.x - a.x, b.y - a.y);
      while (next <= acc + seg && next < total) {
        const t = (next - acc) / seg;
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        arrowHead(g, x, y, Math.atan2(b.y - a.y, b.x - a.x), color, view ? view.px(width * 3) : width * 3, alpha);
        next += arrows;
      }
      acc += seg;
    }
  }
}

function arrowHead(g, x, y, angle, color, size, alpha = 1) {
  g.save();
  g.globalAlpha *= alpha;
  g.translate(x, y);
  g.rotate(angle);
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(size * 0.6, 0);
  g.lineTo(-size * 0.4, -size * 0.45);
  g.lineTo(-size * 0.4, size * 0.45);
  g.closePath();
  g.fill();
  g.restore();
}

/** Panah dari `from` ke `to` (titik dunia). width dalam piksel bila view diberikan. */
export function drawArrow(g, from, to, { color = COLORS.accent, width = 2.5, view = null, head = null, alpha = 1 } = {}) {
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  const hs = head ?? (view ? view.px(width * 4) : width * 4);
  const end = { x: to.x - Math.cos(ang) * hs * 0.5, y: to.y - Math.sin(ang) * hs * 0.5 };
  drawLine(g, [from, end], { color, width, view, alpha });
  arrowHead(g, to.x - Math.cos(ang) * hs * 0.1, to.y - Math.sin(ang) * hs * 0.1, ang, color, hs, alpha);
}

/** Lingkaran (cincin). width dalam piksel bila view diberikan. */
export function drawRing(g, x, y, r, { color = COLORS.accent, width = 2, view = null, dash = null, alpha = 1, fill = null } = {}) {
  g.save();
  g.globalAlpha *= alpha;
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  if (fill) {
    g.fillStyle = fill;
    g.fill();
  }
  g.strokeStyle = color;
  g.lineWidth = view ? view.px(width) : width;
  if (dash) g.setLineDash(view ? dash.map((d) => view.px(d)) : dash);
  g.stroke();
  g.restore();
}

/** Penanda tujuan atau titik penting (pin bulat). */
export function drawMarker(g, x, y, { color = COLORS.target, view = null, size = 9 } = {}) {
  const r = view ? view.px(size) : size * 0.1;
  g.save();
  g.fillStyle = withAlpha(color, 0.25);
  g.beginPath();
  g.arc(x, y, r * 1.9, 0, TAU);
  g.fill();
  g.fillStyle = color;
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
  g.fillStyle = '#0b1220';
  g.beginPath();
  g.arc(x, y, r * 0.4, 0, TAU);
  g.fill();
  g.restore();
}

function labelBox(g, view, x, y, text, opts) {
  const { size = 12, dx = 0, dy = -18, align = 'center', mono = false, bold = true } = opts;
  const p = view.worldToScreen(x, y);
  g.font = `${bold ? 600 : 400} ${size}px ${mono ? MONO : FONT}`;
  const w = g.measureText(text).width;
  const padX = 7;
  const h = size + 8;
  let left = p.x + dx - w / 2 - padX;
  if (align === 'left') left = p.x + dx;
  if (align === 'right') left = p.x + dx - w - 2 * padX;
  left = Math.max(2, Math.min(view.width - w - 2 * padX - 2, left));
  const m = 2; // toleransi piksel untuk titik tepat di tepi (misalnya visibleBounds().maxX)
  const offscreen = p.x < -m || p.y < -m || p.x > view.width + m || p.y > view.height + m;
  return { left, cy: p.y + dy, w: w + 2 * padX, h, padX, offscreen };
}

function paintLabel(g, view, box, text, opts) {
  const { color = COLORS.text, bg = 'rgba(11, 18, 32, 0.86)', border = null, alpha = 1 } = opts;
  const top = Math.max(2, Math.min(view.height - box.h - 2, box.cy - box.h / 2));
  g.globalAlpha = alpha;
  g.fillStyle = bg;
  roundRectPath(g, box.left, top, box.w, box.h, box.h / 2);
  g.fill();
  if (border) {
    g.strokeStyle = border;
    g.lineWidth = 1;
    g.stroke();
  }
  g.fillStyle = color;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillText(text, box.left + box.padX, top + box.h / 2 + 0.5);
  return top;
}

/**
 * Label teks dengan latar kapsul, digambar dalam piksel layar di posisi dunia (x, y).
 * opts: { color (teks), bg, border, size (px), dx, dy (geser px), align: 'center'|'left'|'right', mono, bold, alpha,
 *         offscreen: 'hide' (bawaan, label untuk titik di luar layar tidak digambar) | 'clamp' (tempel di tepi) }
 * Label yang titiknya terlihat tetapi kapsulnya melewati tepi tetap digeser masuk agar terbaca.
 * Transformasi dunia dipulihkan setelah menggambar.
 * Bila ada banyak label yang bisa bertumpuk, pakai createLabelLayer().
 */
export function drawLabel(g, view, x, y, text, opts = {}) {
  g.save();
  view.screen();
  const box = labelBox(g, view, x, y, text, opts);
  if (!box.offscreen || opts.offscreen === 'clamp') paintLabel(g, view, box, text, { ...opts, alpha: (opts.alpha ?? 1) * g.globalAlpha });
  g.restore();
}

/**
 * Kumpulan label yang digambar sekaligus tanpa saling menimpa.
 * Label yang bertabrakan digeser ke atas atau ke bawah secukupnya.
 *
 *   const labels = createLabelLayer();
 *   labels.add(x, y, 'pejalan kaki', { color: COLORS.kamera, priority: 2 });
 *   labels.add(x2, y2, 'lampu merah', { color: COLORS.kamera, optional: true });
 *   labels.draw(g, view);   // panggil sekali di akhir render
 *
 * Opsi tambahan per label (selain opsi drawLabel):
 *   priority  angka, label berprioritas tinggi ditempatkan lebih dulu (bawaan 0, urutan tambah dipertahankan)
 *   nudge     'both' (bawaan) | 'up' | 'down' | 'none': arah geser saat bertabrakan
 *   maxNudge  berapa langkah geser paling jauh (bawaan 3, satu langkah = tinggi label)
 *   optional  true: sembunyikan label bila tidak ada tempat kosong (bawaan: tetap digambar di posisi terakhir)
 *   offscreen 'hide' (bawaan) atau 'clamp'
 */
export function createLabelLayer() {
  const items = [];
  return {
    add(x, y, text, opts = {}) {
      items.push({ x, y, text, opts, order: items.length });
    },
    get size() {
      return items.length;
    },
    clear() {
      items.length = 0;
    },
    draw(g, view) {
      g.save();
      view.screen();
      const placed = [];
      const list = [...items].sort((a, b) => (b.opts.priority ?? 0) - (a.opts.priority ?? 0) || a.order - b.order);
      for (const it of list) {
        const box = labelBox(g, view, it.x, it.y, it.text, it.opts);
        if (box.offscreen && it.opts.offscreen !== 'clamp') continue;
        const step = box.h + 3;
        const base = box.cy;
        const nudge = it.opts.nudge ?? 'both';
        const maxN = Math.max(0, it.opts.maxNudge ?? 3);
        const ks = [0];
        for (let n = 1; n <= maxN; n++) {
          if (nudge === 'both' || nudge === 'up') ks.push(-n);
          if (nudge === 'both' || nudge === 'down') ks.push(n);
        }
        let free = false;
        for (const k of nudge === 'none' ? [0] : ks) {
          box.cy = base + k * step;
          const top = Math.max(2, Math.min(view.height - box.h - 2, box.cy - box.h / 2));
          const hit = placed.some((r) => box.left < r.left + r.w && box.left + box.w > r.left && top < r.top + r.h && top + box.h > r.top);
          if (!hit) {
            free = true;
            break;
          }
        }
        if (!free) {
          if (it.opts.optional) continue;
          box.cy = base;
        }
        const top = paintLabel(g, view, box, it.text, it.opts);
        placed.push({ left: box.left, top, w: box.w, h: box.h });
      }
      g.restore();
      items.length = 0;
    },
  };
}

/** Skala jarak di pojok kiri bawah (misalnya "10 m"). */
export function drawScaleBar(g, view, { x = 14, y = null, color = 'rgba(226, 232, 240, 0.8)', target = 90 } = {}) {
  const candidates = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500];
  const m = candidates.find((c) => c * view.camera.scale >= target * 0.6) ?? 500;
  const len = m * view.camera.scale;
  const yy = y ?? view.height - 16;
  g.save();
  view.screen();
  g.strokeStyle = color;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(x, yy - 5);
  g.lineTo(x, yy);
  g.lineTo(x + len, yy);
  g.lineTo(x + len, yy - 5);
  g.stroke();
  g.fillStyle = color;
  g.font = `600 11px ${FONT}`;
  g.textAlign = 'left';
  g.textBaseline = 'bottom';
  g.fillText(`${m} m`, x + len + 6, yy + 1);
  g.restore();
}

// ---------- visual sensor ----------

/**
 * Kerucut jangkauan sensor. fov dalam radian (>= 2*PI berarti lingkaran penuh).
 * opts: { view, fillAlpha, strokeAlpha, width (px), dash }
 */
export function drawSensorCone(g, origin, heading, fov, range, color, opts = {}) {
  const { view = null, fillAlpha = 0.14, strokeAlpha = 0.6, width = 1.5, dash = null } = opts;
  if (range <= 0) return;
  g.save();
  const grad = g.createRadialGradient(origin.x, origin.y, 0, origin.x, origin.y, range);
  grad.addColorStop(0, withAlpha(color, fillAlpha * 1.6));
  grad.addColorStop(0.7, withAlpha(color, fillAlpha * 0.7));
  grad.addColorStop(1, withAlpha(color, fillAlpha * 0.25));
  g.fillStyle = grad;
  g.beginPath();
  const full = fov >= TAU - 1e-6;
  if (full) g.arc(origin.x, origin.y, range, 0, TAU);
  else {
    g.moveTo(origin.x, origin.y);
    g.arc(origin.x, origin.y, range, heading - fov / 2, heading + fov / 2);
    g.closePath();
  }
  g.fill();
  g.strokeStyle = withAlpha(color, strokeAlpha);
  g.lineWidth = view ? view.px(width) : width * 0.05;
  if (dash) g.setLineDash(view ? dash.map((d) => view.px(d)) : dash);
  g.stroke();
  g.restore();
}

/**
 * Garis sinar dari titik asal ke setiap titik tabrakan.
 * Catatan: untuk LiDAR, garis yang berganti tiap pindaian terasa berkedip. Pakai createLidarTrail,
 * drawSoftPoints, drawLidarRange, atau drawLidarSweep.
 */
export function drawRays(g, origin, points, color, { view = null, alpha = 0.18, width = 1, every = 1 } = {}) {
  g.save();
  g.strokeStyle = withAlpha(color, alpha);
  g.lineWidth = view ? view.px(width) : 0.03;
  g.beginPath();
  for (let i = 0; i < points.length; i += every) {
    g.moveTo(origin.x, origin.y);
    g.lineTo(points[i].x, points[i].y);
  }
  g.stroke();
  g.restore();
}

/** Titik-titik awan titik (point cloud). size dalam piksel. */
export function drawPointCloud(g, points, color, { view = null, size = 2.4, alpha = 1 } = {}) {
  const s = view ? view.px(size) : 0.12;
  g.save();
  g.globalAlpha *= alpha;
  g.fillStyle = color;
  for (const p of points) g.fillRect(p.x - s / 2, p.y - s / 2, s, s);
  g.restore();
}

// ---------- LiDAR yang tenang ----------
//
// Pengguna merasa garis sinar LiDAR yang berkedip mengganggu. Untuk LiDAR, pakai titik lembut yang
// memudar pelan (createLidarTrail atau drawSoftPoints), cakupan statis (drawLidarRange), dan bila
// perlu sapuan yang berputar pelan (drawLidarSweep). Hindari drawRays untuk LiDAR.

/**
 * Titik bulat lembut (inti kecil dan lingkaran cahaya samar). size dalam piksel.
 * opts: { view, size = 2.4, alpha = 0.9, halo = true }
 */
export function drawSoftPoints(g, points, color, { view = null, size = 2.4, alpha = 0.9, halo = true } = {}) {
  if (!points || !points.length) return;
  const r = view ? view.px(size / 2) : 0.06;
  // halo: true (penuh), false (tanpa), atau angka 0 sampai 1 (kekuatan halo)
  const haloK = halo === true ? 1 : Number(halo) || 0;
  const base = g.globalAlpha;
  g.save();
  if (haloK > 0.01) {
    g.globalAlpha = base * alpha * 0.22 * Math.min(1, haloK);
    g.fillStyle = color;
    g.beginPath();
    for (const p of points) {
      g.moveTo(p.x + r * 2.4, p.y);
      g.arc(p.x, p.y, r * 2.4, 0, TAU);
    }
    g.fill();
  }
  g.globalAlpha = base * alpha;
  g.fillStyle = color;
  g.beginPath();
  for (const p of points) {
    g.moveTo(p.x + r, p.y);
    g.arc(p.x, p.y, r, 0, TAU);
  }
  g.fill();
  g.restore();
}

/**
 * Jejak titik LiDAR yang memudar pelan. Setiap hasil pindai ditambahkan dengan waktunya, lalu
 * digambar makin transparan sampai hilang setelah `fade` detik. Hasilnya tenang: titik tidak
 * muncul dan hilang mendadak setiap pindaian, dan tidak ada garis sinar.
 *
 *   const trail = createLidarTrail({ fade: 1.2, decimate: 2 });
 *   // di update(), setelah rig.update(): hanya pindaian baru yang ditambahkan
 *   trail.addReading(rig.reading('lidar'), loop.time);
 *   // di render():
 *   trail.draw(g, loop.time, COLORS.lidar, { view });
 *
 * opts: { fade (detik, bawaan 1,2), max (jumlah titik maksimum, bawaan 4000), decimate (ambil tiap n titik, bawaan 1) }
 * Titik disimpan dalam koordinat dunia, jadi tetap di tempatnya saat kendaraan bergerak.
 * Hasil: { addReading(reading, time, { skipClutter }), add(points, time),
 *          draw(g, time, color, { view, size, alpha, halo, merge, spacing }), clear(), count }
 *
 * Supaya tenang, draw() secara bawaan (merge: true) menyimpan satu titik per sel kecil di dunia
 * (lebar sel kira-kira size * spacing piksel di layar). Sel mengingat posisi titik PERTAMA yang
 * mengenainya dan waktu pindaian TERBARU yang mengenainya. Dinding yang terus terkena sinar tampil
 * sebagai deretan titik yang diam dan redup: tidak menumpuk menjadi garis terang, tidak bergetar
 * setiap pindaian, dan tidak membentuk pola kisi. Benda yang bergerak meninggalkan jejak yang memudar.
 * Titik baru tetap terang penuh selama sekitar sepertiga waktu fade, lalu memudar halus.
 * merge: false menggambar setiap titik setiap pindaian apa adanya (posisi persis, boleh bertumpuk).
 */
export function createLidarTrail({ fade = 1.2, max = 4000, decimate = 1 } = {}) {
  let scans = [];
  let count = 0;
  let lastReading = null;
  let lastTime = -Infinity;
  // sel gabungan: kunci -> { x, y, t }. Urutan Map = urutan sentuhan terakhir (terlama di depan).
  let cells = new Map();
  let cellM = 0; // lebar sel (m); 0 = belum dibangun
  const keyOf = (x, y) => Math.floor(x / cellM) * 2097152 + Math.floor(y / cellM);
  const touch = (p, t) => {
    const k = keyOf(p.x, p.y);
    const c = cells.get(k);
    if (!c) cells.set(k, { x: p.x, y: p.y, t });
    else if (t >= c.t) {
      c.t = t;
      cells.delete(k);
      cells.set(k, c);
    }
  };
  const trim = () => {
    for (const k of cells.keys()) {
      if (cells.size <= max) break;
      cells.delete(k);
    }
  };
  // bangun ulang sel dari pindaian yang tersimpan (pertama kali, atau setelah zoom berubah jauh)
  const rebuild = (size) => {
    cellM = size;
    cells = new Map();
    for (const sc of scans) for (const p of sc.pts) touch(p, sc.time);
    trim();
  };
  // kecerahan menurut umur: tetap penuh sebentar, lalu turun halus (kurva kosinus) sampai 0
  const HOLD = 0.35;
  const level = (age, alpha) => {
    const u = Math.max(0, age) / fade;
    if (u <= HOLD) return alpha;
    return alpha * 0.5 * (1 + Math.cos(Math.PI * Math.min(1, (u - HOLD) / (1 - HOLD))));
  };
  return {
    /**
     * Tambahkan hasil pindai dari SensorRig (rig.reading('lidar')) hanya bila pindaiannya baru.
     * Aman dipanggil di setiap update(). opts.skipClutter: buang titik gangguan hujan.
     * Mengembalikan true bila ada pindaian baru yang ditambahkan.
     */
    addReading(reading, time, { skipClutter = false } = {}) {
      if (!reading || !reading.points || reading.time === lastReading) return false;
      lastReading = reading.time;
      this.add(skipClutter ? reading.points.filter((p) => !p.clutter) : reading.points, time);
      return true;
    },
    add(points, time) {
      if (!points || !points.length) return;
      const step = Math.max(1, Math.round(decimate));
      const pts = [];
      for (let i = 0; i < points.length; i += step) pts.push({ x: points[i].x, y: points[i].y });
      scans.push({ time, pts });
      count += pts.length;
      while (count > max && scans.length > 1) count -= scans.shift().pts.length;
      if (cellM) {
        for (const p of pts) touch(p, time);
        trim();
      }
    },
    draw(g, time, color = COLORS.lidar, { view = null, size = 2.2, alpha = 0.85, halo = 0.6, merge = true, spacing = 1.5 } = {}) {
      // waktu mundur (loop direset): buang semua yang berasal dari "masa depan"
      const rewound = time < lastTime - 1e-6;
      lastTime = time;
      scans = scans.filter((sc) => time - sc.time < fade && sc.time <= time + 1e-6);
      count = scans.reduce((n, sc) => n + sc.pts.length, 0);
      if (!merge) {
        for (const sc of scans) {
          const a = level(time - sc.time, alpha);
          if (a > 0.01) drawSoftPoints(g, sc.pts, color, { view, size, alpha: a, halo: halo * (a / alpha) });
        }
        return;
      }
      const want = view ? view.px(Math.max(1.5, size * spacing)) : 0.12;
      if (!cellM || rewound || Math.abs(want / cellM - 1) > 0.25) rebuild(want);
      if (!cells.size) return;
      // kelompokkan per tingkat kecerahan supaya jumlah panggilan gambar sedikit
      const LEVELS = 16;
      const buckets = new Map();
      for (const [k, c] of cells) {
        const age = time - c.t;
        if (age >= fade) {
          cells.delete(k);
          continue;
        }
        const lv = Math.round((level(age, alpha) / alpha) * LEVELS);
        if (lv <= 0) continue;
        let list = buckets.get(lv);
        if (!list) buckets.set(lv, (list = []));
        list.push(c);
      }
      for (const [lv, list] of buckets) {
        const a = (alpha * lv) / LEVELS;
        drawSoftPoints(g, list, color, { view, size, alpha: a, halo: halo * (lv / LEVELS) });
      }
    },
    clear() {
      scans = [];
      count = 0;
      lastReading = null;
      cells = new Map();
      cellM = 0;
      lastTime = -Infinity;
    },
    /** Jumlah titik mentah yang tersimpan (pindaian dalam jendela fade). */
    get count() {
      return count;
    },
  };
}

/** Sudut sapuan untuk drawLidarSweep: satu putaran setiap `period` detik (bawaan 8, pelan). */
export function lidarSweepAngle(time, { period = 8, offset = 0 } = {}) {
  return offset + ((time % period) / period) * TAU;
}

/**
 * Cakupan LiDAR yang diam: lingkaran lembut dengan tepi tipis putus-putus.
 * opts: { view, alpha (bawaan 0,06), edgeAlpha (bawaan 0,3), dash (px) }
 */
export function drawLidarRange(g, origin, range, color = COLORS.lidar, { view = null, alpha = 0.06, edgeAlpha = 0.3, dash = [3, 6] } = {}) {
  if (range <= 0) return;
  g.save();
  const grad = g.createRadialGradient(origin.x, origin.y, 0, origin.x, origin.y, range);
  grad.addColorStop(0, withAlpha(color, alpha * 1.6));
  grad.addColorStop(0.75, withAlpha(color, alpha * 0.6));
  grad.addColorStop(1, withAlpha(color, alpha * 0.15));
  g.fillStyle = grad;
  g.beginPath();
  g.arc(origin.x, origin.y, range, 0, TAU);
  g.fill();
  g.strokeStyle = withAlpha(color, edgeAlpha);
  g.lineWidth = view ? view.px(1) : 0.05;
  if (dash && view) g.setLineDash(dash.map((d) => view.px(d)));
  g.stroke();
  g.restore();
}

/**
 * Sapuan LiDAR yang berputar pelan: irisan lembut yang memudar ke belakang, tanpa garis sinar.
 * angle = sudut ujung sapuan (pakai lidarSweepAngle(time)). Dengan prefers-reduced-motion,
 * lewati fungsi ini atau berikan sudut tetap.
 * opts: { width (lebar ekor, radian, bawaan 0,9), alpha (bawaan 0,18) }
 */
export function drawLidarSweep(g, origin, angle, range, color = COLORS.lidar, { width = 0.9, alpha = 0.18 } = {}) {
  if (range <= 0 || width <= 0 || alpha <= 0) return;
  // Irisan ditumpuk dari beberapa irisan sepusat yang makin kecil. Setiap lapis sangat tipis, jadi
  // kecerahan turun perlahan dari pusat ke tepi luar tanpa garis batas. Menurut sudut: ekor
  // (angle - width) transparan, makin terang ke depan, lalu turun lagi ke 0 tepat di ujung depan.
  // Tidak ada tepi tajam yang terlihat seperti garis yang berputar.
  const N = 8;
  const layer = 1 - Math.pow(1 - Math.min(0.95, alpha), 1 / N);
  const a0 = angle - width;
  const f = Math.min(1, width / TAU);
  g.save();
  let fill;
  if (typeof g.createConicGradient === 'function') {
    fill = g.createConicGradient(a0, origin.x, origin.y);
    fill.addColorStop(0, withAlpha(color, 0));
    fill.addColorStop(f * 0.8, withAlpha(color, layer));
    fill.addColorStop(f, withAlpha(color, 0));
    if (f < 1) fill.addColorStop(1, withAlpha(color, 0));
  } else fill = withAlpha(color, layer * 0.5);
  g.fillStyle = fill;
  for (let i = 0; i < N; i++) {
    g.beginPath();
    g.moveTo(origin.x, origin.y);
    g.arc(origin.x, origin.y, range * (1 - i / N), a0, angle);
    g.closePath();
    g.fill();
  }
  g.restore();
}

/**
 * Kotak deteksi bergaya siku di sekeliling objek (kotak atau lingkaran).
 * opts: { view, pad (m), width (px), dashed }
 */
export function drawBracketBox(g, obj, color, { view = null, pad = 0.35, width = 2, alpha = 1 } = {}) {
  let box;
  if (shapeType(obj) === 'circle') box = { x: obj.x, y: obj.y, heading: 0, length: obj.radius * 2, width: obj.radius * 2 };
  else box = obj;
  const L = box.length + pad * 2;
  const W = box.width + pad * 2;
  const minLen = view ? view.px(14) : 0.6;
  const cl = Math.max(Math.min(L, W) * 0.3, Math.min(minLen, Math.min(L, W) * 0.5));
  g.save();
  g.globalAlpha *= alpha;
  g.translate(box.x, box.y);
  g.rotate(box.heading || 0);
  g.strokeStyle = color;
  g.lineWidth = view ? view.px(width) : 0.08;
  g.lineCap = 'round';
  g.beginPath();
  const hx = L / 2;
  const hy = W / 2;
  for (const [sx, sy] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    g.moveTo(sx * hx, sy * (hy - cl));
    g.lineTo(sx * hx, sy * hy);
    g.lineTo(sx * (hx - cl), sy * hy);
  }
  g.stroke();
  g.restore();
}

// ---------- cuaca ----------

const nightLayers = new WeakMap();

/**
 * Efek cuaca di atas pemandangan. Panggil setelah menggambar dunia, sebelum visual sensor.
 * weather: 'cerah' | 'hujan' | 'kabut' | 'malam'
 * lights (khusus malam): [{ type: 'cone', x, y, heading, fov, range } | { type: 'point', x, y, radius }]
 */
export function drawWeather(g, view, weather, time = 0, { lights = [] } = {}) {
  if (weather === 'cerah' || !weather) return;
  g.save();
  view.screen();
  const W = view.width;
  const H = view.height;
  if (weather === 'hujan') {
    g.fillStyle = 'rgba(30, 41, 59, 0.28)';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(191, 219, 254, 0.32)';
    g.lineWidth = 1;
    g.beginPath();
    const n = Math.round((W * H) / 2600);
    for (let i = 0; i < n; i++) {
      const hx = hash2(i, 1.3);
      const hy = hash2(i, 7.1);
      const speed = 380 + hash2(i, 3.3) * 220;
      const x = (hx * (W + 60) + time * 60) % (W + 60) - 30;
      const y = (hy * (H + 60) + time * speed) % (H + 60) - 30;
      g.moveTo(x, y);
      g.lineTo(x - 3, y + 11);
    }
    g.stroke();
  } else if (weather === 'kabut') {
    g.fillStyle = 'rgba(203, 213, 225, 0.30)';
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 7; i++) {
      const cx = ((hash2(i, 2.2) * W * 1.4 + time * (6 + i * 2)) % (W * 1.4)) - W * 0.2;
      const cy = hash2(i, 5.5) * H;
      const r = (0.25 + hash2(i, 9.1) * 0.3) * Math.max(W, H);
      const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad.addColorStop(0, 'rgba(226, 232, 240, 0.22)');
      grad.addColorStop(1, 'rgba(226, 232, 240, 0)');
      g.fillStyle = grad;
      g.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
  } else if (weather === 'malam') {
    let layer = nightLayers.get(view);
    if (!layer) {
      layer = document.createElement('canvas');
      nightLayers.set(view, layer);
    }
    const cw = view.canvas.width;
    const ch = view.canvas.height;
    if (layer.width !== cw || layer.height !== ch) {
      layer.width = cw;
      layer.height = ch;
    }
    const lg = layer.getContext('2d');
    lg.setTransform(1, 0, 0, 1, 0, 0);
    lg.globalCompositeOperation = 'source-over';
    lg.clearRect(0, 0, cw, ch);
    lg.fillStyle = 'rgba(2, 6, 23, 0.74)';
    lg.fillRect(0, 0, cw, ch);
    lg.globalCompositeOperation = 'destination-out';
    const s = view.camera.scale * view.dpr;
    for (const L of lights) {
      const p = view.worldToScreen(L.x, L.y);
      const px = p.x * view.dpr;
      const py = p.y * view.dpr;
      if (L.type === 'cone') {
        const r = L.range * s;
        const grad = lg.createRadialGradient(px, py, 0, px, py, r);
        grad.addColorStop(0, 'rgba(0,0,0,0.85)');
        grad.addColorStop(0.6, 'rgba(0,0,0,0.45)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        lg.fillStyle = grad;
        lg.beginPath();
        lg.moveTo(px, py);
        lg.arc(px, py, r, L.heading - L.fov / 2, L.heading + L.fov / 2);
        lg.closePath();
        lg.fill();
      } else {
        const r = (L.radius ?? 6) * s;
        const grad = lg.createRadialGradient(px, py, 0, px, py, r);
        grad.addColorStop(0, `rgba(0,0,0,${L.strength ?? 0.7})`);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        lg.fillStyle = grad;
        lg.beginPath();
        lg.arc(px, py, r, 0, TAU);
        lg.fill();
      }
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(layer, 0, 0);
  }
  g.restore();
  view.world();
}
