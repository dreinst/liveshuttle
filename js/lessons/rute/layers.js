// Bantuan gambar untuk pelajaran Perencanaan Rute.
//
// createEdgeLayer(): lapisan ruas yang sudah dijelajahi pencarian. Ribuan ruas digambar sekali ke
// kanvas tersembunyi seukuran layar, lalu hanya disalin tiap frame. Ruas baru ditambahkan satu per
// satu, jadi animasi pencarian tetap ringan di ponsel. Bila kamera berubah, lapisan digambar ulang.

import { FONT } from '../../engine/theme.js';
import { fmt } from '../../engine/math.js';

export function createEdgeLayer({ color, width = 2 }) {
  const edges = [];
  let drawn = 0;
  let key = '';
  let canvas = null;
  let cg = null;

  function setup(view) {
    const w = Math.max(1, Math.round(view.width * view.dpr));
    const h = Math.max(1, Math.round(view.height * view.dpr));
    if (!canvas) {
      canvas = document.createElement('canvas');
      cg = canvas.getContext('2d');
    }
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    } else cg.clearRect(0, 0, w, h);
    const s = view.camera.scale * view.dpr;
    cg.setTransform(s, 0, 0, s, (view.width / 2 - view.camera.x * view.camera.scale) * view.dpr, (view.height / 2 - view.camera.y * view.camera.scale) * view.dpr);
    cg.lineCap = 'round';
    cg.lineJoin = 'round';
    drawn = 0;
  }

  function paint(view, from) {
    if (from >= edges.length) return;
    cg.strokeStyle = color;
    cg.lineWidth = width / view.camera.scale;
    cg.beginPath();
    for (let i = from; i < edges.length; i++) {
      const pts = edges[i];
      cg.moveTo(pts[0].x, pts[0].y);
      for (let k = 1; k < pts.length; k++) cg.lineTo(pts[k].x, pts[k].y);
    }
    cg.stroke();
  }

  return {
    /** Tambahkan satu ruas (daftar titik dunia). */
    add(points) {
      if (points && points.length > 1) edges.push(points);
    },
    clear() {
      edges.length = 0;
      drawn = 0;
      key = '';
    },
    /** Salin lapisan ke kanvas utama (transformasi dunia aktif). */
    draw(g, view, { alpha = 1 } = {}) {
      if (!edges.length || view.width < 1) return;
      const k = `${view.width}x${view.height}@${view.dpr}|${view.camera.x.toFixed(3)},${view.camera.y.toFixed(3)},${view.camera.scale.toFixed(6)}`;
      if (k !== key) {
        key = k;
        setup(view);
      }
      if (drawn < edges.length) {
        paint(view, drawn);
        drawn = edges.length;
      }
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha *= alpha;
      g.drawImage(canvas, 0, 0);
      g.restore();
    },
  };
}

/** Jarak untuk pembaca: "850 m" atau "6,03 km". */
export function fmtDist(m) {
  if (!Number.isFinite(m)) return '-';
  return m < 1000 ? fmt(m, 0, 'm') : fmt(m / 1000, 2, 'km');
}

/** Lama waktu untuk pembaca: "45 detik" atau "14 menit 47 detik". */
export function fmtDur(sec) {
  if (!Number.isFinite(sec)) return '-';
  const t = Math.max(0, Math.round(sec));
  if (t < 60) return `${fmt(t)} detik`;
  const m = Math.floor(t / 60);
  const s = t % 60;
  return s ? `${fmt(m)} menit ${fmt(s)} detik` : `${fmt(m)} menit`;
}

/** Skala jarak di kiri bawah, dengan satuan km untuk peta kota. */
export function drawScaleBarKm(g, view, { x = 12, y = null, target = 80, color = 'rgba(226, 232, 240, 0.85)' } = {}) {
  const steps = [5, 10, 20, 50, 100, 200, 250, 500, 1000, 2000, 5000];
  const m = steps.find((c) => c * view.camera.scale >= target * 0.6) ?? 5000;
  const len = m * view.camera.scale;
  const yy = y ?? view.height - 14;
  g.save();
  view.screen();
  g.strokeStyle = 'rgba(11, 18, 32, 0.7)';
  g.lineWidth = 4;
  g.lineCap = 'round';
  const bar = () => {
    g.beginPath();
    g.moveTo(x, yy - 5);
    g.lineTo(x, yy);
    g.lineTo(x + len, yy);
    g.lineTo(x + len, yy - 5);
    g.stroke();
  };
  bar();
  g.strokeStyle = color;
  g.lineWidth = 2;
  bar();
  const text = m >= 1000 ? `${fmt(m / 1000)} km` : `${fmt(m)} m`;
  g.font = `600 11px ${FONT}`;
  g.textAlign = 'left';
  g.textBaseline = 'bottom';
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(11, 18, 32, 0.8)';
  g.strokeText(text, x + len + 6, yy + 1);
  g.fillStyle = color;
  g.fillText(text, x + len + 6, yy + 1);
  g.restore();
}
