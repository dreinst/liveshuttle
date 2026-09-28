// Gambar bantu di atas jalan: jalur rencana, titik berhenti, pita dilema lampu kuning,
// zona celah untuk menyalip, dan penunjuk objek penting yang masih di luar layar.
// Posisi dihitung di kerangka Jalan Kawi (s, lat) lalu dipetakan ke peta lewat scene.frame.

import { COLORS, withAlpha } from '../../engine/theme.js';
import { fmt } from '../../engine/math.js';
import { drawLine, drawPath, polygonPath } from '../../engine/draw.js';
import { STATES } from './diagram.js';
import { ROAD_HALF, CW_HALF } from './scene.js';

export const LIGHT_COLOR = { red: COLORS.lightRed, yellow: COLORS.lightYellow, green: COLORS.lightGreen };
const LIGHT_WORD = { red: 'merah', yellow: 'kuning', green: 'hijau' };
const AMBER = '#fbbf24';

/**
 * opts: { world, planner, view, labels, vis, scene }
 * vis = persegi dunia yang terlihat di pita peta { minX, maxX, minY, maxY }.
 */
export function drawOverlays(g, { world, planner, view, labels, vis, scene }) {
  const F = scene.frame;
  const S = scene.S;
  const ego = world.ego;
  const P = planner.P;
  const front = ego.x + ego.length / 2;
  const color = STATES[P.state].color;
  const W = (s, lat) => F.toWorld(s, lat);
  const band = (s0, s1, lat0, lat1) => {
    const a = [];
    const b = [];
    const n = Math.max(2, Math.ceil((s1 - s0) / 2));
    for (let i = 0; i <= n; i++) {
      const s = s0 + ((s1 - s0) * i) / n;
      a.push(W(s, lat0));
      b.push(W(s, lat1));
    }
    return [...a, ...b.reverse()];
  };
  const across = (s, lat0, lat1) => [W(s, lat0), W(s, lat1)];
  const edgeS = world.viewMaxS;
  const edgeAt = (lat) => ({ x: vis.maxX, y: W(edgeS, lat).y });

  // Label yang ditambahkan lebih dulu mendapat tempat pertama di lapisan label, jadi penunjuk
  // tepi dan nama objek didahulukan agar tidak tergeser ke bawah HUD atau menutupi objeknya.
  // ---------- penunjuk di tepi kanan untuk objek di luar layar ----------
  const per = P.per;
  if (per) {
    const line = per.line;
    if (line.x - 0.5 > edgeS && line.dLine < 190) {
      const st = world.signal.main;
      const e = edgeAt(-ROAD_HALF - 1.4);
      labels.add(e.x, e.y, `Lampu ${LIGHT_WORD[st]} ${fmt(line.dLine, 0)} m ›`, { color: LIGHT_COLOR[st], align: 'right', dx: -6, dy: 0, size: 11 });
    }
    for (const p of world.peds) {
      if (!p.test || p.state === 'selesai' || p.x <= edgeS - 3) continue;
      const d = p.cw.s - CW_HALF - front;
      if (d > 0 && d < 330) {
        const e = edgeAt(0);
        labels.add(e.x, e.y, `Pejalan kaki ${fmt(d, 0)} m ›`, { color: COLORS.target, align: 'right', dx: -6, dy: 0, size: 11 });
      }
      break;
    }
    const ak = world.angkot;
    if (ak.active) {
      const rear = ak.x - ak.length / 2;
      if (rear > edgeS - 3 && rear - front > 0) {
        const e = edgeAt(ROAD_HALF + 1.4);
        labels.add(e.x, e.y, `Angkot ngetem ${fmt(rear - front, 0)} m ›`, { color: AMBER, align: 'right', dx: -6, dy: 0, size: 11 });
      }
    }
  }
  // ---------- label objek penting ----------
  for (const p of world.peds) {
    if (p.state === 'selesai' || (!p.test && p.state !== 'menyeberang')) continue;
    const w = W(p.x, p.y);
    if (w.x < vis.minX || w.x > vis.maxX - 3) continue;
    // label di atas pejalan kaki yang berada di separuh utara jalan, di bawah bila di separuh selatan
    const up = p.y < 0;
    const text = p.state === 'menunggu' ? 'ingin menyeberang' : p.held ? 'menunggu kendaraan' : 'menyeberang';
    labels.add(w.x, w.y, text, { color: COLORS.target, dy: up ? -20 : 20, size: 11, optional: !p.test });
  }
  if (world.angkot.active) {
    const a = W(world.angkot.x, world.angkot.y - 1);
    if (a.x > vis.minX && a.x < vis.maxX - 3) labels.add(a.x, a.y, 'angkot ngetem', { color: AMBER, dy: -18, size: 11 });
  }
  for (const c of world.oncoming) {
    if (!c.doorOpen) continue;
    const a = W(c.x, c.y + 1);
    if (a.x > vis.minX && a.x < vis.maxX - 3) labels.add(a.x, a.y, 'angkot menurunkan penumpang', { color: COLORS.angkot, dy: 18, size: 10.5, optional: true });
  }

  // ---------- pita dilema lampu kuning ----------
  const rec = P.yellow;
  if (rec && world.time - rec.time < 6 && world.time >= rec.time) {
    const fade = Math.min(1, (6 - (world.time - rec.time)) / 1.2);
    g.save();
    g.globalAlpha = fade;
    const x0 = rec.frontX;
    const x1 = rec.frontX + rec.sd;
    if (x1 > x0 + 0.1) {
      g.fillStyle = withAlpha(AMBER, 0.16);
      polygonPath(g, band(x0, x1, -ROAD_HALF + 0.2, -0.2));
      g.fill();
    }
    drawLine(g, across(x1, -ROAD_HALF + 0.2, -0.2), { color: AMBER, width: 2.5, view });
    drawLine(g, across(rec.lineX, -ROAD_HALF + 0.2, -0.2), { color: '#f8fafc', width: 3, view });
    g.restore();
    if (fade > 0.3) {
      const a = W(x1, -ROAD_HALF);
      const b = W(rec.lineX, 0);
      labels.add(a.x, a.y, `henti nyaman ${fmt(rec.sd, 1)} m`, { color: AMBER, dy: -12, size: 11 });
      labels.add(b.x, b.y, `garis henti, d = ${fmt(rec.d, 1)} m`, { color: '#f8fafc', dy: 14, size: 11 });
    }
  }

  // ---------- zona celah untuk menyalip ----------
  const gap = P.gap;
  if (gap && P.state === 'celah') {
    const ok = gap.ok;
    const c = ok ? COLORS.ok : COLORS.danger;
    const zx0 = ego.x - ego.length / 2;
    g.fillStyle = withAlpha(c, 0.2);
    polygonPath(g, band(zx0, gap.zoneEnd, 0.2, ROAD_HALF - 0.2));
    g.fill();
    const far = gap.zoneEnd + gap.need * gap.vOnc;
    const p0 = W(gap.zoneEnd, ROAD_HALF / 2);
    const p1 = W(far, ROAD_HALF / 2);
    const grad = g.createLinearGradient(p0.x, p0.y, p1.x, p1.y);
    grad.addColorStop(0, withAlpha(c, 0.14));
    grad.addColorStop(1, withAlpha(c, 0));
    g.fillStyle = grad;
    polygonPath(g, band(gap.zoneEnd, Math.min(far, S.end + 20), 0.2, ROAD_HALF - 0.2));
    g.fill();
    const edgePts = [];
    for (let s = zx0; s < gap.zoneEnd; s += 2) edgePts.push(W(s, 0.2));
    edgePts.push(W(gap.zoneEnd, 0.2));
    drawLine(g, edgePts, { color: c, width: 1.5, view, dash: [5, 4] });
    const lxS = Math.min(gap.zoneEnd, edgeS - 2);
    const lp = W(lxS, ROAD_HALF);
    const text = ok ? 'celah cukup' : gap.minT < 0.05 ? 'kendaraan lawan sedang di zona salip' : `kendaraan lawan tiba ${fmt(gap.minT, 1)} detik, butuh ${fmt(gap.need, 1)} detik`;
    labels.add(lp.x, lp.y, text, { color: c, dy: 14, size: 11, align: lxS < gap.zoneEnd ? 'right' : 'center' });
  }

  // ---------- jalur rencana ----------
  let stopX = Infinity;
  if (P.limit) stopX = front + Math.max(0, P.limit.d);
  const ahead = P.refPts.filter((p) => p.x >= ego.x && p.x <= Math.min(stopX - ego.length / 2, ego.x + 44));
  if (ahead.length > 1) {
    const pts = [{ x: front, y: ahead[0].y }, ...ahead.filter((p) => p.x > front)];
    if (P.limit && stopX - ego.length / 2 < ego.x + 44 && pts[pts.length - 1].x < stopX) pts.push({ x: stopX, y: pts[pts.length - 1].y });
    drawPath(
      g,
      pts.map((p) => W(p.x, p.y)),
      { color: withAlpha(color, 0.85), width: 2.5, view, dash: [7, 6] },
    );
  }

  // ---------- titik berhenti ----------
  if (P.limit && P.limit.d < 100) {
    drawLine(g, across(stopX, -ROAD_HALF + 0.3, -0.3), { color, width: 4, view });
    if (P.limit.d > 2.5) {
      const narrow = view.width < 560;
      const a = W(stopX, -ROAD_HALF);
      labels.add(a.x, a.y, narrow ? `${fmt(P.limit.d, 0)} m lagi` : `berhenti ${fmt(P.limit.d, 0)} m lagi`, { color, dy: -30, size: 11 });
    }
  }
}
