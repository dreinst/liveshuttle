// Fungsi gambar yang seragam untuk semua pelajaran.
//
// Semua fungsi menerima konteks kanvas `g` yang sedang memakai transformasi DUNIA
// (panggil view.begin() atau view.world() dulu), sehingga ukuran dalam meter.
// Bila sebuah fungsi butuh ukuran konstan di layar (garis tipis, titik, teks), berikan
// opsi `view` supaya fungsi bisa mengubah piksel menjadi meter lewat view.px().

import { COLORS, FONT, MONO, withAlpha } from './theme.js';
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
  const { alpha = 1, highlight = null, shadow = true, headlights = false, view = null } = opts;
  const L = car.length ?? 4.5;
  const W = car.width ?? 1.8;
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
  roundRectPath(g, -L * 0.26, -W * 0.39, L * 0.38, W * 0.78, W * 0.14);
  g.fill();
  // kaca depan dan belakang
  g.fillStyle = 'rgba(12, 20, 36, 0.88)';
  g.beginPath();
  g.moveTo(L * 0.12, -W * 0.4);
  g.lineTo(L * 0.3, -W * 0.36);
  g.lineTo(L * 0.3, W * 0.36);
  g.lineTo(L * 0.12, W * 0.4);
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(-L * 0.26, -W * 0.38);
  g.lineTo(-L * 0.37, -W * 0.33);
  g.lineTo(-L * 0.37, W * 0.33);
  g.lineTo(-L * 0.26, W * 0.38);
  g.closePath();
  g.fill();
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

/** Bus kota tampak atas. */
export function drawBus(g, bus, opts = {}) {
  const color = opts.color ?? bus.color ?? COLORS.bus;
  const { alpha = 1, highlight = null, view = null } = opts;
  const L = bus.length ?? 12;
  const W = bus.width ?? 2.5;
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
  g.fillStyle = lighten(color, 0.2);
  for (let i = 0; i < 3; i++) g.fillRect(-L / 2 + 1.5 + i * 3.2, -W * 0.25, 1.6, W * 0.5);
  g.fillStyle = '#fef9c3';
  g.fillRect(L / 2 - 0.12, -W / 2 + 0.15, 0.1, 0.35);
  g.fillRect(L / 2 - 0.12, W / 2 - 0.5, 0.1, 0.35);
  g.fillStyle = bus.braking ? '#ff3b3b' : '#9f1d1d';
  g.fillRect(-L / 2 + 0.02, -W / 2 + 0.15, 0.1, 0.4);
  g.fillRect(-L / 2 + 0.02, W / 2 - 0.55, 0.1, 0.4);
  if (highlight) {
    g.strokeStyle = highlight;
    g.lineWidth = lw(view, 2, 0.15);
    roundRectPath(g, -L / 2 - 0.3, -W / 2 - 0.3, L + 0.6, W + 0.6, 0.7);
    g.stroke();
  }
  g.restore();
}

/** Shuttle otonom kecil (bentuk kapsul dengan modul sensor di atap). */
export function drawShuttle(g, s, opts = {}) {
  const color = opts.color ?? s.color ?? COLORS.shuttle;
  const { alpha = 1, highlight = null, view = null, ego = s.ego } = opts;
  const L = s.length ?? 5;
  const W = s.width ?? 2.1;
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
  if (highlight) {
    g.strokeStyle = highlight;
    g.lineWidth = lw(view, 2, 0.15);
    roundRectPath(g, -L / 2 - 0.3, -W / 2 - 0.3, L + 0.6, W + 0.6, W * 0.6);
    g.stroke();
  }
  g.restore();
}

/**
 * Pejalan kaki tampak atas. p = { x, y, heading, radius? }.
 * opts: { color, phase (fase langkah, misalnya waktu * 6), view, minPx }
 */
export function drawPedestrian(g, p, opts = {}) {
  const { color = p.color ?? COLORS.pedestrian, phase = 0, view = null, minPx = 9, alpha = 1, highlight = null } = opts;
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
  // kepala
  g.fillStyle = '#f5d0b5';
  g.beginPath();
  g.arc(r * 0.08, 0, r * 0.42, 0, TAU);
  g.fill();
  g.fillStyle = '#3b2a20';
  g.beginPath();
  g.arc(-r * 0.02, 0, r * 0.36, Math.PI * 0.55, Math.PI * 1.45);
  g.fill();
  if (highlight) {
    g.strokeStyle = highlight;
    g.lineWidth = lw(view, 2, 0.1);
    g.beginPath();
    g.arc(0, 0, r * 1.6, 0, TAU);
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

/** Kardus di jalan. b = kotak { x, y, length, width, heading? }. */
export function drawCardboard(g, b) {
  g.save();
  g.translate(b.x, b.y);
  g.rotate(b.heading || 0);
  const L = b.length;
  const W = b.width;
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.fillRect(-L / 2 + 0.1, -W / 2 + 0.15, L, W);
  g.fillStyle = COLORS.cardboard;
  g.fillRect(-L / 2, -W / 2, L, W);
  g.strokeStyle = lighten(COLORS.cardboard, 0.35);
  g.lineWidth = Math.min(L, W) * 0.12;
  g.beginPath();
  g.moveTo(-L / 2, 0);
  g.lineTo(L / 2, 0);
  g.stroke();
  g.restore();
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
  return { left, cy: p.y + dy, w: w + 2 * padX, h, padX };
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
 * opts: { color (teks), bg, border, size (px), dx, dy (geser px), align: 'center'|'left'|'right', mono, bold, alpha }
 * Transformasi dunia dipulihkan setelah menggambar.
 * Bila ada banyak label yang bisa bertumpuk, pakai createLabelLayer().
 */
export function drawLabel(g, view, x, y, text, opts = {}) {
  g.save();
  view.screen();
  const box = labelBox(g, view, x, y, text, opts);
  paintLabel(g, view, box, text, { ...opts, alpha: (opts.alpha ?? 1) * g.globalAlpha });
  g.restore();
}

/**
 * Kumpulan label yang digambar sekaligus tanpa saling menimpa.
 * Label yang bertabrakan digeser ke atas atau ke bawah secukupnya.
 *
 *   const labels = createLabelLayer();
 *   labels.add(x, y, 'pejalan kaki', { color: COLORS.kamera });
 *   labels.add(x2, y2, 'lampu merah', { color: COLORS.kamera });
 *   labels.draw(g, view);   // panggil sekali di akhir render
 */
export function createLabelLayer() {
  const items = [];
  return {
    add(x, y, text, opts = {}) {
      items.push({ x, y, text, opts });
    },
    draw(g, view) {
      g.save();
      view.screen();
      const placed = [];
      for (const it of items) {
        const box = labelBox(g, view, it.x, it.y, it.text, it.opts);
        const step = box.h + 3;
        const base = box.cy;
        for (const k of [0, -1, 1, -2, 2, -3, 3]) {
          box.cy = base + k * step;
          const top = box.cy - box.h / 2;
          const hit = placed.some((r) => box.left < r.left + r.w && box.left + box.w > r.left && top < r.top + r.h && top + box.h > r.top);
          if (!hit) break;
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

/** Garis sinar dari titik asal ke setiap titik tabrakan. */
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
