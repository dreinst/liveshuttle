// Gambar untuk pelajaran Kendali: lintasan uji, jejak mobil, visual pure pursuit, peta mini,
// dan penunjuk sudut setir. Semua fungsi hanya menggambar, model ada di ./sim.js.

import { COLORS, FONT, MONO, withAlpha } from '../../engine/theme.js';
import { Rng, fmt, fmtSigned, TAU } from '../../engine/math.js';
import { offsetPolyline } from '../../engine/geometry.js';
import {
  drawGround,
  drawRoadSurface,
  drawRoadMarkings,
  drawTree,
  drawPath,
  drawLine,
  drawRing,
  drawMarker,
  drawCar,
  roundRectPath,
  polylinePath,
} from '../../engine/draw.js';
import { arcPoints } from './sim.js';
import { LANE_WIDTH } from './track.js';

export const TRAIL_COLORS = { ok: COLORS.ok, warn: COLORS.warn, danger: COLORS.danger };
export const ARC_COLOR = COLORS.pathAlt;
export const CIRCLE_COLOR = '#e2e8f0';
const KERB_RED = '#dc2626';
const KERB_WHITE = '#f1f5f9';

/** Kelas warna jejak menurut besar galat lintasan. */
export const errorTone = (e) => (Math.abs(e) < 0.3 ? 'ok' : Math.abs(e) < 1 ? 'warn' : 'danger');

export function createScene(track) {
  const ref = track.ref;
  const loop = [...ref.points]; // untuk Path tertutup, titik terakhir sudah sama dengan titik pertama

  // ---------- kerb merah putih di tikungan (tepi luar jalan kiri dan kanan) ----------
  const leftKerbLine = offsetPolyline(loop, LANE_WIDTH / 2 + 0.35);
  const rightKerbLine = offsetPolyline(loop, -(LANE_WIDTH * 1.5 + 0.35));
  const kerbs = [];
  const n = track.curvature.length;
  let startI = null;
  for (let i = 0; i <= n; i++) {
    const curvy = i < n && Math.abs(track.curvature[i]) > 1 / 45;
    if (curvy && startI == null) startI = i;
    if (!curvy && startI != null) {
      // titik offset punya indeks yang sama dengan titik jalur acuan
      kerbs.push(leftKerbLine.slice(startI, i + 1), rightKerbLine.slice(startI, i + 1));
      startI = null;
    }
  }

  // ---------- pepohonan di luar jalan (acak tetapi selalu sama) ----------
  const rng = new Rng(11);
  const trees = [];
  const b = track.bounds;
  const tries = 900;
  for (let k = 0; k < tries && trees.length < 90; k++) {
    const x = rng.range(b.minX - 40, b.maxX + 40);
    const y = rng.range(b.minY - 40, b.maxY + 40);
    const near = ref.closest(x, y);
    if (near.dist < 11) continue;
    const r = rng.range(1.4, 2.6);
    if (trees.some((t) => Math.hypot(t.x - x, t.y - y) < t.r + r + 1.5)) continue;
    trees.push({ x, y, r });
  }

  // ---------- garis start kotak-kotak melintang seluruh jalan ----------
  const p0 = ref.sample(0);
  const start = { x: p0.x, y: p0.y, heading: p0.heading };

  // ---------- peta mini: titik lintasan yang dijarangkan ----------
  const miniPts = ref.points.filter((_, i) => i % 4 === 0);

  function drawStartLine(g) {
    const cell = 0.5;
    const across = LANE_WIDTH * 2;
    const cols = Math.round(across / cell);
    g.save();
    g.translate(start.x, start.y);
    g.rotate(start.heading);
    // sisi kiri jalan ada di -y lokal (kiri arah gerak), tepi kiri = +1,75 m ke kiri dari jalur acuan
    const top = -LANE_WIDTH / 2;
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < cols; c++) {
        g.fillStyle = (r + c) % 2 ? '#0f172a' : '#f8fafc';
        g.fillRect(-cell + r * cell, top + c * cell, cell, cell);
      }
    }
    g.restore();
  }

  function drawKerbs(g, view) {
    g.save();
    g.lineCap = 'butt';
    g.lineJoin = 'round';
    for (const k of kerbs) {
      if (k.length < 2) continue;
      g.strokeStyle = KERB_WHITE;
      g.lineWidth = 0.7;
      g.setLineDash([]);
      polylinePath(g, k);
      g.stroke();
      g.strokeStyle = KERB_RED;
      g.setLineDash([1.2, 1.2]);
      polylinePath(g, k);
      g.stroke();
    }
    g.setLineDash([]);
    g.restore();
  }

  function drawTrail(g, view, trail, { width = 3, alpha = 0.95 } = {}) {
    if (trail.length < 2) return;
    g.save();
    g.globalAlpha = alpha;
    g.lineWidth = view.px(width);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    let tone = errorTone(trail[1].cte);
    g.strokeStyle = TRAIL_COLORS[tone];
    g.beginPath();
    g.moveTo(trail[0].x, trail[0].y);
    for (let i = 1; i < trail.length; i++) {
      const p = trail[i];
      const t = errorTone(p.cte);
      g.lineTo(p.x, p.y);
      if (t !== tone) {
        g.stroke();
        tone = t;
        g.strokeStyle = TRAIL_COLORS[tone];
        g.beginPath();
        g.moveTo(p.x, p.y);
      }
    }
    g.stroke();
    g.restore();
  }

  /**
   * Apakah label (lebar kira-kira w piksel) di titik dunia (x, y), digeser dy piksel, muat utuh di
   * kanvas dan tidak tertutup kotak lain (chip HUD, penunjuk setir, peta mini)?
   */
  function labelFits(view, x, y, text, { dy = 0, size = 11, avoid = [] } = {}) {
    const p = view.worldToScreen(x, y);
    const w = text.length * size * 0.62 + 16;
    const h = size + 10;
    const box = { x: p.x - w / 2, y: p.y + dy - h / 2, w, h };
    if (box.x < 4 || box.y < 4 || box.x + w > view.width - 4 || box.y + h > view.height - 4) return false;
    return !avoid.some((r) => box.x < r.x + r.w && box.x + w > r.x && box.y < r.y + r.h && box.y + h > r.y);
  }

  /**
   * Gambar dunia. opts: { view, sim, overview, labels, avoid }
   * avoid: kotak-kotak layar (piksel CSS) yang tidak boleh ditimpa label.
   */
  function draw(g, { view, sim, overview = false, labels, avoid = [] }) {
    const st = sim.state;
    const ego = sim.ego;
    drawGround(g, view, { color: COLORS.ground, grid: overview ? 0 : 10, gridColor: 'rgba(255,255,255,0.03)' });

    // pohon yang terlihat saja
    const vb = view.visibleBounds();
    for (const t of trees) {
      if (t.x + t.r < vb.minX || t.x - t.r > vb.maxX || t.y + t.r < vb.minY || t.y - t.r > vb.maxY) continue;
      drawTree(g, t.x, t.y, t.r);
    }

    drawKerbs(g, view);
    drawRoadSurface(g, track.road);
    drawRoadMarkings(g, track.road, { center: 'dashed' });
    drawStartLine(g);

    // jalur acuan (tengah lajur kiri)
    drawPath(g, ref.points, { color: withAlpha(COLORS.path, 0.75), width: overview ? 1.5 : 2, view, arrows: overview ? 0 : 24 });

    // jejak sumbu roda belakang, diwarnai menurut galat
    drawTrail(g, view, st.trail, { width: overview ? 2.5 : 3.5 });

    // visual pure pursuit (pengendali yang sedang memegang setir)
    const active = st.takeover ? st.safePp : st.pp;
    const ra = ego.rearAxle();
    if (active) {
      const takeover = !!st.takeover;
      const ld = takeover ? active.dist : st.ldEff;
      const circleColor = takeover ? COLORS.warn : CIRCLE_COLOR;
      drawRing(g, ra.x, ra.y, ld, { color: circleColor, width: 1.5, view, dash: [6, 5], alpha: 0.7, fill: withAlpha(circleColor, 0.05) });
      // busur setir: lintasan yang akan dilalui sumbu roda belakang bila setir tepat sesuai perintah
      const arcLen = Math.abs(active.curvature) < 1e-4 ? active.dist : Math.abs((2 * active.alpha) / active.curvature);
      const arc = arcPoints(ra, ego.heading, active.curvature, Math.min(arcLen, 60), 28);
      drawLine(g, arc, { color: ARC_COLOR, width: 3, view, alpha: 0.95 });
      drawLine(g, [ra, active.target], { color: COLORS.target, width: 1.5, view, dash: [3, 4], alpha: 0.8 });
      drawMarker(g, active.target.x, active.target.y, { color: takeover ? COLORS.warn : COLORS.target, view, size: overview ? 4 : 6 });
      if (labels && !overview) {
        // label hanya bila lingkaran cukup besar di layar, supaya tidak menumpuk di atas mobil,
        // dan hanya bila label terlihat utuh (tidak terpotong tepi atau tertutup chip dan kotak)
        const radiusPx = ld * view.camera.scale;
        const targetText = takeover ? 'tujuan cadangan' : 'titik tujuan';
        if (radiusPx > 70 && labelFits(view, active.target.x, active.target.y, targetText, { dy: -20, avoid })) {
          labels.add(active.target.x, active.target.y, targetText, { color: takeover ? COLORS.warn : COLORS.target, dy: -20, size: 11 });
        }
        if (!takeover) {
          // label Ld di tepi lingkaran: kiri mobil dulu (tidak menutupi jalur di depan), lalu kanan,
          // lalu belakang. Bila tidak ada yang muat, chip Ld di HUD sudah menampilkan nilainya.
          const h = ego.heading;
          // sama dengan chip HUD: satu angka desimal bila Ld bukan bilangan bulat
          const text = `Ld ${fmt(ld, Math.abs(ld - Math.round(ld)) > 0.05 ? 1 : 0, 'm')}`;
          const spots = [
            { x: ra.x + Math.sin(h) * ld, y: ra.y - Math.cos(h) * ld },
            { x: ra.x - Math.sin(h) * ld, y: ra.y + Math.cos(h) * ld },
            { x: ra.x - Math.cos(h) * ld, y: ra.y - Math.sin(h) * ld },
          ];
          const spot = spots.find((p) => labelFits(view, p.x, p.y, text, { avoid }));
          if (spot) labels.add(spot.x, spot.y, text, { color: CIRCLE_COLOR, dy: 0, size: 11, mono: true });
        }
      }
    }

    drawCar(g, ego, { ego: true, braking: ego.braking, view, highlight: st.takeover ? COLORS.warn : null });
    // titik acuan pure pursuit: tengah sumbu roda belakang
    drawRing(g, ra.x, ra.y, view.px(overview ? 2 : 3), { color: '#0b1220', width: 1.5, view, fill: '#f8fafc' });
  }

  /** Peta mini seluruh lintasan di sudut layar. rect dalam piksel CSS { x, y, w, h }. */
  function drawMinimap(g, view, sim, rect) {
    const bb = track.bounds;
    const pad = 8;
    const sc = Math.min((rect.w - 2 * pad) / (bb.maxX - bb.minX), (rect.h - 2 * pad) / (bb.maxY - bb.minY));
    const ox = rect.x + rect.w / 2 - ((bb.minX + bb.maxX) / 2) * sc;
    const oy = rect.y + rect.h / 2 - ((bb.minY + bb.maxY) / 2) * sc;
    const X = (x) => ox + x * sc;
    const Y = (y) => oy + y * sc;
    g.save();
    view.screen();
    g.fillStyle = 'rgba(11, 18, 32, 0.82)';
    roundRectPath(g, rect.x, rect.y, rect.w, rect.h, 10);
    g.fill();
    g.strokeStyle = 'rgba(148, 163, 184, 0.28)';
    g.lineWidth = 1;
    g.stroke();
    // lintasan
    g.strokeStyle = '#3b4658';
    g.lineWidth = 4;
    g.lineJoin = 'round';
    g.beginPath();
    miniPts.forEach((p, i) => (i ? g.lineTo(X(p.x), Y(p.y)) : g.moveTo(X(p.x), Y(p.y))));
    g.closePath();
    g.stroke();
    // jejak
    const tr = sim.state.trail;
    g.lineWidth = 2;
    g.lineCap = 'round';
    for (let i = 1; i < tr.length; i += 1) {
      const a = tr[i - 1];
      const p = tr[i];
      g.strokeStyle = TRAIL_COLORS[errorTone(p.cte)];
      g.beginPath();
      g.moveTo(X(a.x), Y(a.y));
      g.lineTo(X(p.x), Y(p.y));
      g.stroke();
    }
    // garis start
    const nx = Math.sin(start.heading);
    const ny = -Math.cos(start.heading);
    g.strokeStyle = '#f8fafc';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(X(start.x + nx * 3), Y(start.y + ny * 3));
    g.lineTo(X(start.x - nx * 8), Y(start.y - ny * 8));
    g.stroke();
    // mobil
    const e = sim.ego;
    g.fillStyle = sim.state.takeover ? COLORS.warn : COLORS.ego;
    g.strokeStyle = '#0b1220';
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(X(e.x), Y(e.y), 4.5, 0, TAU);
    g.fill();
    g.stroke();
    g.restore();
  }

  /**
   * Penunjuk sudut setir: jarum hijau toska = sudut roda sebenarnya, segitiga merah muda = perintah
   * pengendali. Selisih keduanya memperlihatkan jeda dan batas kecepatan putar setir.
   */
  function drawGauge(g, view, sim, rect, maxDeg = 20) {
    const st = sim.state;
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h - 16;
    const r = Math.min(rect.w / 2 - 12, rect.h - 34);
    const ang = (deg) => -Math.PI / 2 + (Math.max(-maxDeg, Math.min(maxDeg, deg)) / maxDeg) * (Math.PI * 0.42);
    g.save();
    view.screen();
    g.fillStyle = 'rgba(11, 18, 32, 0.82)';
    roundRectPath(g, rect.x, rect.y, rect.w, rect.h, 10);
    g.fill();
    g.strokeStyle = 'rgba(148, 163, 184, 0.28)';
    g.lineWidth = 1;
    g.stroke();
    // busur skala
    g.strokeStyle = 'rgba(148, 163, 184, 0.45)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(cx, cy, r, ang(-maxDeg), ang(maxDeg));
    g.stroke();
    g.lineWidth = 1.5;
    for (const d of [-20, -10, 0, 10, 20]) {
      if (Math.abs(d) > maxDeg) continue;
      const a = ang(d);
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * (r - 6), cy + Math.sin(a) * (r - 6));
      g.lineTo(cx + Math.cos(a) * (r + 3), cy + Math.sin(a) * (r + 3));
      g.stroke();
    }
    const deg = (rad) => (rad * 180) / Math.PI;
    // perintah (segitiga di tepi)
    const ac = ang(deg(st.steerCmd));
    g.fillStyle = COLORS.target;
    g.beginPath();
    g.moveTo(cx + Math.cos(ac) * (r + 1), cy + Math.sin(ac) * (r + 1));
    g.lineTo(cx + Math.cos(ac - 0.13) * (r + 11), cy + Math.sin(ac - 0.13) * (r + 11));
    g.lineTo(cx + Math.cos(ac + 0.13) * (r + 11), cy + Math.sin(ac + 0.13) * (r + 11));
    g.closePath();
    g.fill();
    // sudut roda sebenarnya (jarum)
    const aa = ang(deg(sim.ego.steer));
    g.strokeStyle = COLORS.ego;
    g.lineWidth = 3;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(aa) * (r - 4), cy + Math.sin(aa) * (r - 4));
    g.stroke();
    g.fillStyle = COLORS.ego;
    g.beginPath();
    g.arc(cx, cy, 3.5, 0, TAU);
    g.fill();
    // teks
    g.fillStyle = 'rgba(226, 232, 240, 0.92)';
    g.font = `600 11px ${FONT}`;
    g.textAlign = 'left';
    g.textBaseline = 'top';
    g.fillText('Setir', rect.x + 9, rect.y + 7);
    g.font = `600 11px ${MONO}`;
    g.textAlign = 'right';
    g.fillText(`${fmtSigned(deg(sim.ego.steer), 1)}°`, rect.x + rect.w - 9, rect.y + 7);
    g.font = `500 10px ${FONT}`;
    g.fillStyle = 'rgba(148, 163, 184, 0.95)';
    g.textAlign = 'left';
    g.textBaseline = 'bottom';
    g.fillText('kiri', rect.x + 8, rect.y + rect.h - 4);
    g.textAlign = 'right';
    g.fillText('kanan', rect.x + rect.w - 8, rect.y + rect.h - 4);
    g.restore();
  }

  return { draw, drawMinimap, drawGauge, trees, kerbs };
}
