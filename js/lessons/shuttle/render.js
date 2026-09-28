// Gambar pelajaran Misi Shuttle Otonom.
//
// Peta statis (tanah, gedung, pohon, jalan, marka) digambar sekali ke kanvas cadangan pada skala
// kamera saat ini, lalu tiap frame cukup ditempel. Ini penting supaya tetap lancar di ponsel.
// Bagian yang bergerak atau berubah (lampu, kendaraan, penumpang, jalan ditutup) digambar
// ulang setiap frame.

import { COLORS, FONT, withAlpha } from '../../engine/theme.js';
import { clamp } from '../../engine/math.js';
import { slicePolyline } from '../../engine/road.js';
import {
  drawCar,
  drawShuttle,
  drawPedestrian,
  drawTrafficLight,
  drawSpeedSign,
  drawHalte,
  drawCone,
  drawPath,
  drawRing,
  drawLine,
  drawPointCloud,
  drawBracketBox,
  roundRectPath,
} from '../../engine/draw.js';
import { EXT, drawStatic, HALTE, LIGHTS, ROADS, SPEED_SIGNS, TRIM } from './campus.js';

/** Lapisan peta statis dengan cadangan gambar. */
export function createStaticLayer() {
  let cache = null;
  return {
    draw(g, view) {
      const k = view.camera.scale * view.dpr;
      const w = Math.ceil((EXT.maxX - EXT.minX) * k);
      const h = Math.ceil((EXT.maxY - EXT.minY) * k);
      if (w * h > 14e6) {
        // terlalu besar untuk cadangan: gambar langsung
        drawStatic(g, view.px(1));
        return;
      }
      if (!cache || Math.abs(cache.k - k) > 1e-6) {
        const canvas = cache?.canvas || document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const c = canvas.getContext('2d');
        c.setTransform(k, 0, 0, k, -EXT.minX * k, -EXT.minY * k);
        drawStatic(c, 1 / view.camera.scale);
        cache = { canvas, k };
      }
      const p = view.worldToScreen(EXT.minX, EXT.minY);
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(cache.canvas, Math.round(p.x * view.dpr), Math.round(p.y * view.dpr));
      g.restore();
      view.world();
    },
    invalidate() {
      cache = null;
    },
  };
}

const closedLines = new Map();
function closedLine(R) {
  let pts = closedLines.get(R.id);
  if (!pts) {
    pts = slicePolyline(R.points, TRIM + 0.6, R.length - TRIM - 0.6);
    closedLines.set(R.id, pts);
  }
  return pts;
}

/** Ukuran kendaraan di layar kecil sedikit dibesarkan supaya tetap terlihat. */
export function vehicleScale(view) {
  return clamp(3.3 / view.camera.scale, 1, 1.35);
}

function scaled(o, k) {
  return k === 1 ? o : { ...o, length: o.length * k, width: o.width * k };
}

function dot(g, x, y, r, color, alpha = 1) {
  g.globalAlpha = alpha;
  g.fillStyle = 'rgba(11,18,32,0.85)';
  g.beginPath();
  g.arc(x, y, r * 1.28, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = color;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 1;
}

/**
 * Gambar semua bagian dinamis di bawah efek cuaca.
 * opts: { time, labels, narrow, labelRects }. `labelRects` (Map, opsional) diisi kotak label halte
 * dalam piksel layar, supaya ketukan pada nama halte juga bisa memilih halte itu.
 */
export function drawDynamic(g, view, api, { time, labels, narrow, labelRects = null }) {
  const { W, sh } = api;
  const px = view.px(1);
  const k = vehicleScale(view);
  // label layer menjepit label di luar layar ke tepi kanvas, jadi label di luar layar dilewati
  const vb = view.visibleBounds();
  const m = 2;
  const visible = (x, y) => x > vb.minX + m && x < vb.maxX - m && y > vb.minY + m && y < vb.maxY - m;
  const addLabel = (x, y, text, opts) => {
    if (visible(x, y)) labels.add(x, y, text, opts);
  };

  // jalan ditutup: pita merah dan kerucut
  for (const id of W.closed) {
    const R = ROADS[id];
    const pts = closedLine(R);
    drawLine(g, pts, { color: withAlpha(COLORS.danger, 0.2), width: 7, cap: 'butt' });
    drawLine(g, pts, { color: withAlpha(COLORS.danger, 0.75), width: 2, view, dash: [7, 6] });
    const mid = R.path.sample(R.length / 2);
    addLabel(mid.x, mid.y, 'Ditutup', { color: '#fecaca', bg: 'rgba(127,29,29,0.9)', size: 11, dy: 0 });
  }
  for (const c of W.cones) drawCone(g, c, { view, minPx: 6 });

  // rute lama (sebentar setelah dihitung ulang) dan rute sekarang
  if (W.oldRoute && W.time - W.oldRoute.time < 6) {
    const fade = 1 - (W.time - W.oldRoute.time) / 6;
    drawPath(g, W.oldRoute.pts, { color: '#f87171', width: 3, view, dash: [5, 6], alpha: 0.9 * fade });
  }
  if (sh.target != null) {
    const pts = api.routePoints();
    if (pts.length > 1) {
      drawPath(g, pts, { color: withAlpha('#042f2e', 0.7), width: 7, view });
      drawPath(g, pts, { color: COLORS.path, width: 3.5, view, arrows: narrow ? 22 : 16, alpha: 0.95 });
    }
  }

  // halte, penumpang yang menunggu, dan namanya
  for (const H of HALTE) {
    const active = W.active[H.index];
    const color = active ? H.color : '#64748b';
    drawHalte(g, H.shelter, { color });
    const q = W.queues[H.index];
    const r = Math.max(0.36, px * 3.2);
    const shown = Math.min(q.length, 7);
    for (let i = 0; i < shown; i++) {
      const p = H.queueAt(i);
      dot(g, p.x, p.y, r, HALTE[q[i].to].color);
    }
    if (sh.target === H.index) {
      const stop = H.link.lane.sample(H.s);
      drawRing(g, stop.x, stop.y, Math.max(1.6, px * 10), { color: H.color, width: 2, view, dash: [4, 3] });
    }
    let text = H.name;
    if (!active) text += ' (tidak dilayani)';
    else if (W.unreachable.has(H.index)) text += ' (jalan ditutup)';
    else if (q.length) text += ` (${q.length})`;
    // label di sisi luar halte, menjauhi jalan, supaya shuttle, pintu, dan penumpang tetap terlihat
    const size = narrow ? 10 : 11;
    const edge = H.shelter.width / 2 + 0.4;
    const lx = H.shelter.x + H.left.x * edge;
    const ly = H.shelter.y + H.left.y * edge;
    const side = Math.abs(H.left.x) > 0.7;
    const off = (size + 8) / 2 + 3;
    const opts = {
      color: active ? H.color : '#94a3b8',
      size,
      align: side ? (H.left.x > 0 ? 'left' : 'right') : 'center',
      dx: side ? Math.sign(H.left.x) * 3 : 0,
      // label di samping halte diletakkan di separuh atasnya, supaya tidak bertabrakan dengan label
      // halte di jalan mendatar dekat tikungan (Gerbang Utama dan Asrama) di layar kecil
      dy: side ? -(size + 8) / 2 : Math.sign(H.left.y) * off,
    };
    if (labelRects) labelRects.delete(H.index);
    if (visible(lx, ly)) {
      labels.add(lx, ly, text, opts);
      if (labelRects) {
        // perkiraan kotak label (sama dengan hitungan draw.js, tanpa geseran antarlabel)
        g.save();
        g.font = `600 ${size}px ${FONT}`;
        const w = g.measureText(text).width + 14;
        g.restore();
        const p = view.worldToScreen(lx, ly);
        const left = opts.align === 'left' ? p.x + opts.dx : opts.align === 'right' ? p.x + opts.dx - w : p.x - w / 2;
        labelRects.set(H.index, { left, top: p.y + opts.dy - (size + 8) / 2, w, h: size + 8 });
      }
    }
  }

  // rambu batas kecepatan dan lampu lalu lintas
  for (const s of SPEED_SIGNS) drawSpeedSign(g, { x: s.x, y: s.y, radius: 0.5, text: String(W.limitKmh) }, { view, minPx: narrow ? 13 : 15 });
  for (const L of LIGHTS) drawTrafficLight(g, L, { view, minPx: narrow ? 11 : 13 });

  // kendaraan
  for (const c of W.cars) drawCar(g, scaled(c, k), { color: c.color, braking: c.braking });
  const shv = scaled(sh, k);
  drawShuttle(g, shv, { color: COLORS.ego, ego: true });
  drawDoors(g, sh, shv, time);
  if (sh.braking || sh.cmdAccel < -0.6) {
    // lampu rem shuttle
    g.save();
    g.translate(sh.x, sh.y);
    g.rotate(sh.heading);
    g.fillStyle = sh.emergency ? '#ff3b3b' : 'rgba(255,59,59,0.85)';
    const L = shv.length;
    const Wd = shv.width;
    g.fillRect(-L / 2 - 0.02, -Wd / 2 + 0.25, 0.14, 0.4);
    g.fillRect(-L / 2 - 0.02, Wd / 2 - 0.65, 0.14, 0.4);
    g.restore();
  }

  // penumpang yang sedang turun atau naik
  const D = sh.dwell;
  if (D && D.anim) {
    const H = D.halte;
    const t = clamp(D.anim.t / D.anim.dur, 0, 1);
    const a = D.anim.kind === 'naik' ? H.queueAt(0) : H.door;
    const b = D.anim.kind === 'naik' ? H.door : H.queueAt(1.5);
    const r = Math.max(0.36, px * 3.2);
    dot(g, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, r, HALTE[D.anim.pax.to].color, D.anim.kind === 'turun' ? 1 - t * 0.6 : 1);
  }

  // pejalan kaki
  for (const p of W.peds) drawPedestrian(g, p, { view, phase: p.phase, alpha: clamp(p.alpha, 0, 1), minPx: narrow ? 8 : 9 });
}

function drawDoors(g, sh, shv, time) {
  const D = sh.dwell;
  if (!D || D.door <= 0) return;
  g.save();
  g.translate(sh.x, sh.y);
  g.rotate(sh.heading);
  const L = shv.length;
  const Wd = shv.width;
  const open = D.door;
  // pintu geser di sisi kiri (sisi trotoar) dan pijakan ke tepi jalan
  g.fillStyle = `rgba(254, 249, 195, ${0.85 * open})`;
  g.fillRect(-L * 0.18 - 0.55 * open, -Wd / 2 - 0.08, 1.1 * open, 0.3);
  g.fillStyle = `rgba(148, 163, 184, ${0.7 * open})`;
  roundRectPath(g, -L * 0.18 - 0.5, -Wd / 2 - 0.7 * open, 1.0, 0.7 * open, 0.12);
  g.fill();
  g.restore();
}

/** Titik LiDAR, cincin jangkauan, dan kotak deteksi di sekitar shuttle. */
export function drawSensorOverlay(g, view, api) {
  const { rig, sh, W } = api;
  const k = vehicleScale(view);
  const lidar = rig.get('lidar');
  const pose = lidar.pose(sh);
  const range = lidar.effectiveRange(W.weather);
  drawRing(g, pose.x, pose.y, range, { color: withAlpha(COLORS.lidar, 0.4), width: 1, view, dash: [4, 6] });
  const reading = rig.reading('lidar');
  if (reading) {
    drawPointCloud(g, reading.points, COLORS.lidar, { view, size: 2, alpha: 0.7 });
    for (const d of reading.detections) {
      const o = d.target;
      if (!o || (o.kind !== 'car' && o.kind !== 'pedestrian')) continue;
      if (o.label === 'Mobil parkir') continue;
      drawBracketBox(g, o.kind === 'car' ? scaled(o, k) : o, COLORS.lidar, { view, pad: 0.45, width: 1.6 });
    }
  }
}
