// Gambar bantu di atas jalan: jalur rencana, titik berhenti, pita dilema lampu kuning,
// zona celah untuk menyalip, dan penunjuk objek penting yang masih di luar layar.

import { COLORS, withAlpha } from '../../engine/theme.js';
import { fmt } from '../../engine/math.js';
import { drawLine, drawPath } from '../../engine/draw.js';
import { STATES } from './diagram.js';
import { L, ROAD_HALF, ZEBRA_HALF, STALL_X, STALL_Y } from './world.js';

const LIGHT_COLOR = { red: COLORS.lightRed, yellow: COLORS.lightYellow, green: COLORS.lightGreen };
const LIGHT_WORD = { red: 'merah', yellow: 'kuning', green: 'hijau' };
const AMBER = '#fbbf24';

/**
 * opts: { world, planner, view, labels, vis }
 * vis = area dunia yang terlihat di pita jalan { minX, maxX, minY, maxY }.
 */
export function drawOverlays(g, { world, planner, view, labels, vis }) {
  const ego = world.ego;
  const P = planner.P;
  const front = ego.x + ego.length / 2;
  const color = STATES[P.state].color;

  // Label yang ditambahkan lebih dulu mendapat tempat pertama di lapisan label, jadi penunjuk
  // tepi dan nama objek didahulukan agar tidak tergeser ke bawah HUD atau menutupi objeknya.
  // ---------- penunjuk di tepi kanan untuk objek di luar layar ----------
  // (pejalan kaki dan mobil mogok bisa muncul sampai hampir satu putaran di depan, jadi batasnya 320 m)
  const edgeX = vis.maxX;
  const per = P.per;
  if (per) {
    const line = per.line;
    if (line.x - 0.5 > edgeX && line.dLine < 170) {
      const st = world.signal.main;
      labels.add(edgeX, -ROAD_HALF - 1.2, `Lampu ${LIGHT_WORD[st]} ${fmt(line.dLine, 0)} m ›`, { color: LIGHT_COLOR[st], align: 'right', dx: -6, dy: 0, size: 11 });
    }
    for (const p of world.peds) {
      if (p.state === 'selesai' || p.x <= edgeX - 3) continue;
      const d = p.zx - ZEBRA_HALF - front;
      if (d < 320) labels.add(edgeX, 0, `Pejalan kaki ${fmt(d, 0)} m ›`, { color: COLORS.target, align: 'right', dx: -6, dy: 0, size: 11 });
      break;
    }
    if (world.stalled.active) {
      const k = Math.max(world.stalled.fromK, Math.floor((front - STALL_X + 2.25) / L) + 1);
      const rear = STALL_X + k * L - 2.25;
      if (rear + 2.25 > edgeX - 3 && rear - front < 320) labels.add(edgeX, ROAD_HALF + 1.2, `Mobil mogok ${fmt(rear - front, 0)} m ›`, { color: AMBER, align: 'right', dx: -6, dy: 0, size: 11 });
    }
  }
  // ---------- label objek penting ----------
  for (const p of world.peds) {
    if (p.state === 'selesai' || p.x < vis.minX || p.x > vis.maxX - 3) continue;
    const up = p.side === 'utara';
    labels.add(p.x, up ? -ROAD_HALF - 1.1 : ROAD_HALF + 1.1, p.state === 'menunggu' ? 'ingin menyeberang' : 'menyeberang', { color: COLORS.target, dy: up ? -22 : 22, size: 11 });
  }
  if (world.stalled.active) {
    const k = Math.max(world.stalled.fromK, Math.floor((vis.minX - STALL_X) / L));
    for (let kk = k; kk <= k + 1; kk++) {
      const sx = STALL_X + kk * L;
      if (kk >= world.stalled.fromK && sx > vis.minX && sx < vis.maxX - 3) labels.add(sx, STALL_Y - 1, 'mobil mogok', { color: AMBER, dy: -18, size: 11 });
    }
  }

  // ---------- pita dilema lampu kuning ----------
  const rec = P.yellow;
  if (rec && world.time - rec.time < 6) {
    const fade = Math.min(1, (6 - (world.time - rec.time)) / 1.2);
    g.save();
    g.globalAlpha = fade;
    const x0 = rec.frontX;
    const x1 = rec.frontX + rec.sd;
    g.fillStyle = withAlpha(AMBER, 0.16);
    g.fillRect(x0, -ROAD_HALF + 0.2, Math.max(0, x1 - x0), ROAD_HALF - 0.4);
    drawLine(g, [{ x: x1, y: -ROAD_HALF + 0.2 }, { x: x1, y: -0.2 }], { color: AMBER, width: 2.5, view });
    drawLine(g, [{ x: rec.lineX, y: -ROAD_HALF + 0.2 }, { x: rec.lineX, y: -0.2 }], { color: '#f8fafc', width: 3, view });
    g.restore();
    if (fade > 0.3) {
      labels.add(x1, -ROAD_HALF, `henti nyaman ${fmt(rec.sd, 1)} m`, { color: AMBER, dy: -12, size: 11 });
      labels.add(rec.lineX, 0, `garis henti, d = ${fmt(rec.d, 1)} m`, { color: '#f8fafc', dy: 14, size: 11 });
    }
  }

  // ---------- zona celah untuk menyalip ----------
  const gap = P.gap;
  if (gap && P.state === 'celah') {
    const ok = gap.ok;
    const c = ok ? COLORS.ok : COLORS.danger;
    const zx0 = ego.x - ego.length / 2;
    g.fillStyle = withAlpha(c, 0.2);
    g.fillRect(zx0, 0.2, gap.zoneEnd - zx0, ROAD_HALF - 0.4);
    const far = gap.zoneEnd + gap.need * gap.vOnc;
    const grad = g.createLinearGradient(gap.zoneEnd, 0, far, 0);
    grad.addColorStop(0, withAlpha(c, 0.14));
    grad.addColorStop(1, withAlpha(c, 0));
    g.fillStyle = grad;
    g.fillRect(gap.zoneEnd, 0.2, far - gap.zoneEnd, ROAD_HALF - 0.4);
    drawLine(g, [{ x: zx0, y: 0.2 }, { x: gap.zoneEnd, y: 0.2 }], { color: c, width: 1.5, view, dash: [5, 4] });
    const lx = Math.min(gap.zoneEnd, vis.maxX - 2);
    const text = ok ? 'celah cukup' : gap.minT < 0.05 ? 'mobil lawan sedang di zona salip' : `mobil lawan tiba ${fmt(gap.minT, 1)} detik, butuh ${fmt(gap.need, 1)} detik`;
    labels.add(lx, ROAD_HALF, text, { color: c, dy: 14, size: 11, align: lx < gap.zoneEnd ? 'right' : 'center' });
  }

  // ---------- jalur rencana ----------
  let stopX = Infinity;
  if (P.limit) stopX = front + Math.max(0, P.limit.d);
  const ahead = P.refPts.filter((p) => p.x >= ego.x && p.x <= Math.min(stopX - ego.length / 2, ego.x + 44));
  if (ahead.length > 1) {
    const pts = [{ x: front, y: ahead[0].y }, ...ahead.filter((p) => p.x > front)];
    if (P.limit && stopX - ego.length / 2 < ego.x + 44 && pts[pts.length - 1].x < stopX) pts.push({ x: stopX, y: pts[pts.length - 1].y });
    drawPath(g, pts, { color: withAlpha(color, 0.85), width: 2.5, view, dash: [7, 6] });
  }

  // ---------- titik berhenti ----------
  if (P.limit && P.limit.d < 100) {
    drawLine(g, [{ x: stopX, y: -ROAD_HALF + 0.3 }, { x: stopX, y: -0.3 }], { color, width: 4, view });
    if (P.limit.d > 2.5) {
      const narrow = view.width < 560;
      labels.add(stopX, -ROAD_HALF, narrow ? `${fmt(P.limit.d, 0)} m lagi` : `berhenti ${fmt(P.limit.d, 0)} m lagi`, { color, dy: -30, size: 11 });
    }
  }

}
