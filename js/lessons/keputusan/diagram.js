// Diagram mesin keadaan (state machine) yang digambar di bagian bawah kanvas.
// Keadaan aktif menyala dengan warnanya sendiri, dan panah perpindahan terakhir ikut menyala
// sebentar. Semua ukuran dalam piksel layar (panggil view.screen() sebelum menggambar).

import { FONT, withAlpha } from '../../engine/theme.js';
import { roundRectPath } from '../../engine/draw.js';

export const STATES = {
  melaju: { label: 'MELAJU', lines: ['MELAJU'], color: '#2dd4bf' },
  mengikuti: { label: 'MENGIKUTI', lines: ['MENGIKUTI'], color: '#60a5fa' },
  lampu: { label: 'BERHENTI DI LAMPU', lines: ['BERHENTI', 'DI LAMPU'], color: '#ef4444' },
  pejalan: { label: 'MEMBERI JALAN', lines: ['MEMBERI', 'JALAN'], color: '#f472b6' },
  celah: { label: 'MENUNGGU CELAH', lines: ['MENUNGGU', 'CELAH'], color: '#f59e0b' },
  salip: { label: 'MENYALIP', lines: ['MENYALIP'], color: '#a78bfa' },
  kembali: { label: 'KEMBALI KE LAJUR', lines: ['KEMBALI', 'KE LAJUR'], color: '#a3e635' },
};

// posisi [baris, kolom] di grid 3 x 3
const GRID = {
  lampu: [0, 0],
  melaju: [1, 0],
  pejalan: [2, 0],
  mengikuti: [0, 1],
  celah: [0, 2],
  kembali: [2, 1],
  salip: [2, 2],
};

const EDGES = [
  { a: 'melaju', b: 'lampu', both: true },
  { a: 'melaju', b: 'pejalan', both: true },
  { a: 'melaju', b: 'mengikuti', both: true },
  { a: 'mengikuti', b: 'celah' },
  { a: 'celah', b: 'salip' },
  { a: 'salip', b: 'kembali' },
  { a: 'kembali', b: 'melaju' },
];
// perpindahan jarang (angkot pergi saat mobil menunggu celah): digambar sebagai siku lewat baris tengah
const RARE = { a: 'celah', b: 'melaju' };

const EDGE_COLOR = 'rgba(148, 163, 184, 0.4)';
const GLOW_SECONDS = 2.5;

/** Tinggi area diagram (px) untuk kanvas selebar w dan setinggi h. */
export function diagramHeight(w, h) {
  const want = w < 560 ? 188 : 206;
  return Math.round(Math.min(want, h * 0.5));
}

function layout(rect) {
  const narrow = rect.w < 560;
  const padX = narrow ? 8 : 22;
  const padTop = narrow ? 12 : 16;
  const footer = 34;
  const colW = (rect.w - 2 * padX) / 3;
  const areaH = rect.h - padTop - footer;
  const nodeH = narrow ? Math.max(28, Math.min(34, areaH / 4.3)) : Math.max(26, Math.min(34, areaH / 4.8));
  const gap = (areaH - 3 * nodeH) / 2;
  const nodeW = Math.min(colW - (narrow ? 24 : 56), narrow ? 150 : 210);
  const nodes = {};
  for (const [id, [r, c]] of Object.entries(GRID)) {
    const cx = rect.x + padX + colW * (c + 0.5);
    const cy = rect.y + padTop + nodeH / 2 + r * (nodeH + gap);
    nodes[id] = { cx, cy, hw: nodeW / 2, hh: nodeH / 2 };
  }
  return { narrow, nodes, nodeW, nodeH, footerY: rect.y + rect.h - footer / 2 };
}

/** Titik di tepi kotak n pada arah (dx, dy) dari tengahnya. */
function edgePoint(n, dx, dy, pad = 4) {
  const tx = Math.abs(dx) > 1e-6 ? (n.hw + pad) / Math.abs(dx) : Infinity;
  const ty = Math.abs(dy) > 1e-6 ? (n.hh + pad) / Math.abs(dy) : Infinity;
  const t = Math.min(tx, ty);
  return { x: n.cx + dx * t, y: n.cy + dy * t };
}

function arrow(g, from, to, { color, width, dash = null }) {
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  const head = 6 + width * 1.5;
  g.save();
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = width;
  g.lineCap = 'round';
  if (dash) g.setLineDash(dash);
  g.beginPath();
  g.moveTo(from.x, from.y);
  g.lineTo(to.x - Math.cos(ang) * head * 0.7, to.y - Math.sin(ang) * head * 0.7);
  g.stroke();
  g.setLineDash([]);
  g.beginPath();
  g.moveTo(to.x, to.y);
  g.lineTo(to.x - Math.cos(ang - 0.45) * head, to.y - Math.sin(ang - 0.45) * head);
  g.lineTo(to.x - Math.cos(ang + 0.45) * head, to.y - Math.sin(ang + 0.45) * head);
  g.closePath();
  g.fill();
  g.restore();
}

/**
 * Gambar diagram.
 * rect: { x, y, w, h } area diagram dalam piksel.
 * opts: { state, prev, age (detik sejak perpindahan terakhir) }
 */
export function drawDiagram(g, rect, { state, prev, age = Infinity }) {
  const { narrow, nodes, nodeW, footerY } = layout(rect);

  // latar dan garis pemisah dengan jalan
  g.fillStyle = '#0d1528';
  g.fillRect(rect.x, rect.y, rect.w, rect.h);
  g.fillStyle = '#24314f';
  g.fillRect(rect.x, rect.y, rect.w, 1);

  // panah
  for (const e of EDGES) {
    const A = nodes[e.a];
    const B = nodes[e.b];
    let dx = B.cx - A.cx;
    let dy = B.cy - A.cy;
    const len = Math.hypot(dx, dy);
    dx /= len;
    dy /= len;
    const off = e.both ? 4 : 0;
    const ox = -dy * off;
    const oy = dx * off;
    const dirs = e.both
      ? [
          [e.a, e.b, 1],
          [e.b, e.a, -1],
        ]
      : [[e.a, e.b, 0]];
    for (const [from, to, side] of dirs) {
      const F = nodes[from];
      const T = nodes[to];
      const sx = from === e.a ? dx : -dx;
      const sy = from === e.a ? dy : -dy;
      const p0 = edgePoint(F, sx, sy);
      const p1 = edgePoint(T, -sx, -sy);
      const a = { x: p0.x + ox * side, y: p0.y + oy * side };
      const b = { x: p1.x + ox * side, y: p1.y + oy * side };
      const hot = prev === from && state === to && age < GLOW_SECONDS;
      if (hot) {
        const k = 1 - age / GLOW_SECONDS;
        arrow(g, a, b, { color: withAlpha(STATES[to].color, 0.35 + 0.65 * k), width: 2.5 });
      } else {
        arrow(g, a, b, { color: EDGE_COLOR, width: 1.3 });
      }
    }
  }

  // siku putus-putus MENUNGGU CELAH -> MELAJU
  {
    const A = nodes[RARE.a];
    const B = nodes[RARE.b];
    const hot = prev === RARE.a && state === RARE.b && age < GLOW_SECONDS;
    const color = hot ? withAlpha(STATES[RARE.b].color, 0.35 + 0.65 * (1 - age / GLOW_SECONDS)) : 'rgba(148, 163, 184, 0.3)';
    const x0 = A.cx - A.hw * 0.55;
    const y0 = A.cy + A.hh + 4;
    const yMid = B.cy;
    const r = Math.min(10, Math.abs(yMid - y0) / 2);
    g.save();
    g.strokeStyle = color;
    g.lineWidth = hot ? 2.5 : 1.3;
    if (!hot) g.setLineDash([4, 4]);
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x0, yMid - r);
    g.quadraticCurveTo(x0, yMid, x0 - r, yMid);
    g.lineTo(B.cx + B.hw + 14, yMid);
    g.stroke();
    g.restore();
    arrow(g, { x: B.cx + B.hw + 16, y: yMid }, { x: B.cx + B.hw + 4, y: yMid }, { color, width: hot ? 2.5 : 1.3 });
  }

  // kotak keadaan
  const fontSize = narrow ? 10 : 12;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const [id, n] of Object.entries(nodes)) {
    const meta = STATES[id];
    const active = id === state;
    const recent = id === prev && age < GLOW_SECONDS;
    const x = n.cx - n.hw;
    const y = n.cy - n.hh;
    g.save();
    if (active) {
      g.shadowColor = withAlpha(meta.color, 0.6);
      g.shadowBlur = 16;
      g.fillStyle = '#10192e';
      roundRectPath(g, x, y, n.hw * 2, n.hh * 2, 9);
      g.fill();
      g.shadowBlur = 0;
      g.fillStyle = withAlpha(meta.color, 0.2);
      g.fill();
      g.strokeStyle = meta.color;
      g.lineWidth = 2;
      g.stroke();
    } else {
      g.fillStyle = '#141e35';
      roundRectPath(g, x, y, n.hw * 2, n.hh * 2, 9);
      g.fill();
      g.strokeStyle = recent ? withAlpha(meta.color, 0.55) : '#2a3a5c';
      g.lineWidth = 1;
      g.stroke();
    }
    g.restore();

    // titik warna identitas keadaan (layar lebar saja)
    g.font = `700 ${fontSize}px ${FONT}`;
    const one = g.measureText(meta.label).width <= nodeW - (narrow ? 10 : 34);
    const lines = one ? [meta.label] : meta.lines;
    if (!narrow) {
      g.fillStyle = active ? meta.color : withAlpha(meta.color, 0.55);
      g.beginPath();
      g.arc(x + 13, n.cy, 3.5, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = active ? '#f8fafc' : '#8fa0b8';
    const lh = fontSize + 2;
    const textX = narrow ? n.cx : n.cx + 5;
    lines.forEach((t, i) => g.fillText(t, textX, n.cy + (i - (lines.length - 1) / 2) * lh + 0.5));
  }

  // judul di kiri bawah (kanan bawah dipakai lencana "Dijeda")
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.font = `800 ${narrow ? 9.5 : 10.5}px ${FONT}`;
  g.fillStyle = '#94a3b8';
  const title = 'MESIN KEADAAN';
  const tx = rect.x + (narrow ? 10 : 22);
  g.fillText(title, tx, footerY);
  if (!narrow) {
    const w = g.measureText(title).width;
    g.font = `400 11.5px ${FONT}`;
    g.fillStyle = '#64748b';
    g.fillText('Kotak yang menyala adalah keadaan mobil saat ini.', tx + w + 12, footerY);
  }
}
