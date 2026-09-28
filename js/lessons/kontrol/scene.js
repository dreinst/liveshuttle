// Gambar untuk pelajaran Kendali: peta OpenStreetMap di sekitar boulevard Villa Puncak Tidar,
// jalur acuan dan zona bundaran, jejak mobil, visual pure pursuit, peta mini, dan penunjuk sudut
// setir. Semua fungsi hanya menggambar, model ada di ./sim.js.

import { COLORS, FONT, MONO, withAlpha } from '../../engine/theme.js';
import { fmt, fmtSigned, TAU } from '../../engine/math.js';
import { drawPath, drawLine, drawRing, drawMarker, drawCar, roundRectPath } from '../../engine/draw.js';
import { createMapRenderer } from '../../engine/osm2d.js';
import { arcPoints } from './sim.js';

export const TRAIL_COLORS = { ok: COLORS.ok, warn: COLORS.warn, danger: COLORS.danger };
export const ARC_COLOR = COLORS.pathAlt;
export const CIRCLE_COLOR = '#e2e8f0';
export const ZONE_COLOR = COLORS.warn;

/** Kelas warna jejak menurut besar galat lintasan. */
export const errorTone = (e) => (Math.abs(e) < 0.3 ? 'ok' : Math.abs(e) < 1 ? 'warn' : 'danger');

/** Lookahead untuk ditampilkan: satu angka desimal bila Ld bukan bilangan bulat. */
export const fmtLd = (ld) => fmt(ld, Math.abs(ld - Math.round(ld)) > 0.05 ? 1 : 0, 'm');

/** Potongan titik jalur tertutup dari s0 ke s1 (boleh melewati titik start). */
function slicePath(path, s0, s1, step = 0.5) {
  const L = path.length;
  const len = (((s1 - s0) % L) + L) % L;
  const pts = [];
  for (let d = 0; d <= len; d += step) pts.push(path.sample(s0 + d));
  pts.push(path.sample(s0 + len));
  return pts.map((p) => ({ x: p.x, y: p.y }));
}

/** Kotak latar semi gelap untuk peta mini dan penunjuk setir (piksel CSS, transform layar). */
function panel(g, rect) {
  g.fillStyle = 'rgba(11, 18, 32, 0.82)';
  roundRectPath(g, rect.x, rect.y, rect.w, rect.h, 10);
  g.fill();
  g.strokeStyle = 'rgba(148, 163, 184, 0.28)';
  g.lineWidth = 1;
  g.stroke();
}

export function createScene(track, map) {
  const ref = track.ref;
  const refPts = ref.points;

  // peta: nama jalan di tampilan dekat, nama kawasan (Villa Puncak Tidar, kampus) di tampilan seluruh lintasan
  // (garis batas kampus dibuat abu-abu supaya tidak tertukar dengan jalur acuan yang hijau toska)
  const renderer = createMapRenderer(map, { layers: { places: false }, style: { campusLine: 'rgba(203, 213, 225, 0.4)' } });
  let placesOn = false;

  // zona bundaran sebagai garis, dan titik masuknya untuk label
  const zones = track.zones.map((z) => ({ ...z, pts: slicePath(ref, z.s0, z.s1), entry: ref.sample(z.s0) }));

  // garis start melintang badan jalan
  const p0 = ref.sample(0);
  const start = { x: p0.x, y: p0.y, heading: p0.heading };

  // peta mini: titik lintasan yang dijarangkan
  const miniPts = refPts.filter((_, i) => i % 6 === 0);

  function drawStartLine(g) {
    const cell = 0.5;
    const across = track.roadWidth;
    const cols = Math.round(across / cell);
    g.save();
    g.translate(start.x, start.y);
    g.rotate(start.heading);
    const top = -across / 2;
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < cols; c++) {
        g.fillStyle = (r + c) % 2 ? '#0f172a' : '#f8fafc';
        g.fillRect(-cell + r * cell, top + c * cell, cell, cell);
      }
    }
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
      // lompatan besar (misalnya sesudah Uji dari diam) tidak disambung
      if (Math.hypot(p.x - trail[i - 1].x, p.y - trail[i - 1].y) > 5) {
        g.stroke();
        g.beginPath();
        g.moveTo(p.x, p.y);
        continue;
      }
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
   * kanvas dan tidak tertutup kotak lain (chip HUD, penunjuk setir, peta mini, atribusi)?
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
   * Gambar dunia. opts: { view, sim, overview, labels, avoid, zoneKmh }
   * avoid: kotak-kotak layar (piksel CSS) yang tidak boleh ditimpa label.
   */
  function draw(g, { view, sim, overview = false, labels, avoid = [], zoneKmh = 20 }) {
    const st = sim.state;
    const ego = sim.ego;
    if (placesOn !== overview) {
      placesOn = overview;
      renderer.set({ layers: { places: overview } });
    }
    renderer.draw(g, view, { attribution: false });
    drawStartLine(g);

    // jalur acuan (tengah lajur kiri) dan bagian yang masuk zona bundaran
    drawPath(g, refPts, { color: withAlpha(COLORS.path, 0.75), width: overview ? 1.5 : 2, view, arrows: overview ? 0 : 24 });
    for (const z of zones) drawLine(g, z.pts, { color: ZONE_COLOR, width: overview ? 2 : 2.5, view, dash: [5, 5], alpha: 0.85 });

    // jejak sumbu roda belakang, diwarnai menurut galat
    drawTrail(g, view, st.trail, { width: overview ? 2.5 : 3.5 });

    // label zona bundaran (hanya bila titik masuknya terlihat dan labelnya tidak menutupi kotak lain)
    if (labels) {
      const text = `bundaran, maks ${fmt(zoneKmh, 0)} km/jam`;
      for (const z of zones) {
        if (labelFits(view, z.entry.x, z.entry.y, text, { dy: -18, size: 11, avoid })) {
          labels.add(z.entry.x, z.entry.y, text, { color: ZONE_COLOR, dy: -18, size: 11, optional: true, priority: -1 });
        }
      }
      if (!overview && labelFits(view, start.x, start.y, 'garis start', { dy: 18, size: 11, avoid })) {
        labels.add(start.x, start.y, 'garis start', { color: '#f8fafc', dy: 18, size: 11, optional: true, priority: -2 });
      }
    }

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
          labels.add(active.target.x, active.target.y, targetText, { color: takeover ? COLORS.warn : COLORS.target, dy: -20, size: 11, priority: 2 });
        }
        if (!takeover) {
          // label Ld di tepi lingkaran: kiri mobil dulu (tidak menutupi jalur di depan), lalu kanan,
          // lalu belakang. Bila tidak ada yang muat, chip Ld di HUD sudah menampilkan nilainya.
          const h = ego.heading;
          const text = `Ld ${fmtLd(ld)}`;
          const spots = [
            { x: ra.x + Math.sin(h) * ld, y: ra.y - Math.cos(h) * ld },
            { x: ra.x - Math.sin(h) * ld, y: ra.y + Math.cos(h) * ld },
            { x: ra.x - Math.cos(h) * ld, y: ra.y - Math.sin(h) * ld },
          ];
          const spot = spots.find((p) => labelFits(view, p.x, p.y, text, { avoid }));
          if (spot) labels.add(spot.x, spot.y, text, { color: CIRCLE_COLOR, dy: 0, size: 11, mono: true, priority: 1 });
        }
      }
    }

    drawCar(g, ego, { ego: true, braking: ego.braking, view, minPx: overview ? 14 : 0, highlight: st.takeover ? COLORS.warn : null });
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
    panel(g, rect);
    // lintasan
    g.strokeStyle = '#3b4658';
    g.lineWidth = 3;
    g.lineJoin = 'round';
    g.beginPath();
    miniPts.forEach((p, i) => (i ? g.lineTo(X(p.x), Y(p.y)) : g.moveTo(X(p.x), Y(p.y))));
    g.closePath();
    g.stroke();
    // zona bundaran
    g.strokeStyle = withAlpha(ZONE_COLOR, 0.8);
    g.lineWidth = 2;
    for (const z of zones) {
      g.beginPath();
      z.pts.forEach((p, i) => (i % 4 ? null : i ? g.lineTo(X(p.x), Y(p.y)) : g.moveTo(X(p.x), Y(p.y))));
      g.stroke();
    }
    // jejak
    const tr = sim.state.trail;
    g.lineWidth = 2;
    g.lineCap = 'round';
    for (let i = 2; i < tr.length; i += 2) {
      const a = tr[i - 2];
      const p = tr[i];
      if (Math.hypot(p.x - a.x, p.y - a.y) > 5) continue;
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
    g.moveTo(X(start.x + nx * 8), Y(start.y + ny * 8));
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
  function drawGauge(g, view, sim, rect) {
    const maxDeg = 20;
    const st = sim.state;
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h - 16;
    const r = Math.min(rect.w / 2 - 12, rect.h - 34);
    const ang = (deg) => -Math.PI / 2 + (Math.max(-maxDeg, Math.min(maxDeg, deg)) / maxDeg) * (Math.PI * 0.42);
    g.save();
    view.screen();
    panel(g, rect);
    // busur skala
    g.strokeStyle = 'rgba(148, 163, 184, 0.45)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(cx, cy, r, ang(-maxDeg), ang(maxDeg));
    g.stroke();
    g.lineWidth = 1.5;
    for (const d of [-20, -10, 0, 10, 20]) {
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

  // lencana "© Kontributor OpenStreetMap", dipanggil paling akhir di render()
  return { draw, drawMinimap, drawGauge, drawAttribution: (g, view, opts) => renderer.drawAttribution(g, view, opts) };
}
