// Gambar pelajaran Misi Shuttle Otonom.
//
// Peta statis (area hijau, jalan, gedung, nama jalan dan tempat) digambar createMapRenderer dari
// js/engine/osm2d.js dengan cache, jadi tetap ringan di ponsel. Di atasnya digambar setiap frame:
// permukaan persimpangan, zebra cross, garis henti, jalan yang ditutup, rute, halte, kendaraan,
// pejalan kaki, lampu lalu lintas simulasi, hujan, LiDAR yang tenang, dan label.
//
// LiDAR: tidak ada garis sinar yang berputar atau berkedip. Titik pantulan digabung per sel dan
// memudar pelan (createLidarTrail), cakupannya lingkaran diam yang lembut, dan sapuan lembut hanya
// berputar sekali tiap 10 detik (dilewati bila pengguna memilih gerak dikurangi).

import { COLORS, FONT, withAlpha } from '../../engine/theme.js';
import { clamp } from '../../engine/math.js';
import { crosswalk, stopLine } from '../../engine/road.js';
import {
  drawVehicle,
  drawShuttle,
  drawPedestrian,
  drawTrafficSignal,
  drawHalte,
  drawHalteSign,
  drawCone,
  drawPath,
  drawRing,
  drawCrosswalk,
  drawStopLine,
  drawBracketBox,
  roundRectPath,
  createLidarTrail,
  drawLidarRange,
  drawLidarSweep,
  lidarSweepAngle,
  drawWeather,
} from '../../engine/draw.js';
import { createMapRenderer, highlightRoad, MAP_STYLE, STREET_SCALE } from '../../engine/osm2d.js';
import { MAP_STYLE_EXTRA } from './network.js';

const STOP_COLORS = { red: COLORS.lightRed, yellow: COLORS.lightYellow, green: COLORS.lightGreen };

/** Lapisan gambar untuk satu mount. */
export function createRenderer(api) {
  const net = api.net;
  const mapR = createMapRenderer(net.map, { layers: { places: true }, style: MAP_STYLE_EXTRA, attribution: false });
  // pengaturan LiDAR tenang, sama dengan beranda: titik kecil, memudar 2,4 detik, sel 1,8 x ukuran titik
  const trail = createLidarTrail({ fade: 2.4, max: 3500 });
  const seen = new Map(); // id objek -> { obj, t } untuk kotak deteksi yang memudar halus
  let lastScan = null;
  const cones = new Map();

  function conesFor(R) {
    let list = cones.get(R.id);
    if (!list) {
      list = [];
      for (const L of R.lanes) {
        const P = L.poly;
        const o = P.at(Math.min(2.5, P.len / 2), {});
        const lx = Math.sin(o.h);
        const ly = -Math.cos(o.h);
        const w = (L.width || 3) / 2 - 0.3;
        for (const k of [-w, 0, w]) list.push({ x: o.x + lx * k, y: o.z + ly * k, radius: 0.3 });
      }
      cones.set(R.id, list);
    }
    return list;
  }

  /** Masukkan pindaian LiDAR baru ke jejak (dipanggil dari update, dengan jam tampilan). */
  function addScan(time) {
    const r = api.rig.reading('lidar');
    if (!r || r === lastScan) return;
    lastScan = r;
    trail.addReading(r, time, { skipClutter: false });
    for (const d of r.detections) {
      const o = d.target;
      if (!o || (o.kind === 'building' || o.kind === 'trafficLight')) continue;
      seen.set(o, { obj: o, t: time });
    }
  }

  function clear() {
    trail.clear();
    seen.clear();
    lastScan = null;
  }

  /**
   * opts: { time (jam tampilan), labels (label layer), narrow, reducedMotion, labelRects (Map) }
   */
  function draw(g, view, opts) {
    const { W, sh, traffic, peds } = api;
    const { time, labels, narrow } = opts;
    const px = view.px(1);
    const scale = view.camera.scale;
    const street = scale >= STREET_SCALE;
    const vb = view.visibleBounds();
    const pad = 30;
    const vis = (x, y, m = 0) => x > vb.minX - m && x < vb.maxX + m && y > vb.minY - m && y < vb.maxY + m;
    const visBox = (b) => b.maxX > vb.minX - pad && b.minX < vb.maxX + pad && b.maxY > vb.minY - pad && b.minY < vb.maxY + pad;
    const addLabel = (x, y, text, o) => {
      if (vis(x, y, -2)) labels.add(x, y, text, o);
    };

    mapR.draw(g, view, { attribution: false });

    // permukaan persimpangan dan ujung jalan buntu (menutup sambungan aspal dan ujung marka)
    if (street) {
      for (const j of net.junctions) {
        if (!visBox(j.bbox)) continue;
        g.fillStyle = j.major ? MAP_STYLE.asphaltMajor : MAP_STYLE.asphalt;
        if (j.poly.length >= 3) {
          g.beginPath();
          j.poly.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
          g.closePath();
          g.fill();
        }
        if (j.bulb) {
          g.beginPath();
          g.arc(j.bulb.x, j.bulb.y, j.bulb.r, 0, Math.PI * 2);
          g.fill();
        }
      }
    }

    // zebra cross dan garis henti di lampu
    if (scale >= 1.8) {
      for (const c of net.crossings) {
        if (!vis(c.x, c.y, 10)) continue;
        if (!c.cw) c.cw = crosswalk({ x: c.x, y: c.y, heading: c.walk, length: c.len, width: c.w });
        drawCrosswalk(g, c.cw, { alpha: 0.8 });
      }
      for (const hd of net.heads) {
        const L = hd.line;
        if (!vis(L.cx, L.cy, 10)) continue;
        if (!hd.sl) hd.sl = stopLine({ x: L.cx, y: L.cy, heading: L.h, length: L.half, width: 0.4 });
        drawStopLine(g, hd.sl);
      }
    }

    // jalan yang ditutup: garis merah putus-putus dan kerucut di tiap ujung
    for (const id of net.closed) {
      const R = net.roadById.get(id);
      if (!R || !visBox(R.bbox)) continue;
      highlightRoad(g, view, R.points, { color: COLORS.danger, width: street ? 4 : 3, dash: [7, 5], alpha: 0.85, casing: false });
      if (street) for (const c of conesFor(R)) drawCone(g, c, { view, minPx: 7 });
      const mid = R.points[Math.floor(R.points.length / 2)];
      addLabel(mid.x, mid.y, 'Ditutup', { color: '#fecaca', bg: 'rgba(127, 29, 29, 0.9)', size: 11, dy: 0, priority: 2 });
    }

    // rute lama (sebentar setelah dihitung ulang) dan rute sekarang
    if (W.oldRoute && W.time - W.oldRoute.time < 6) {
      const fade = 1 - (W.time - W.oldRoute.time) / 6;
      drawPath(g, W.oldRoute.pts, { color: '#f87171', width: 3, view, dash: [5, 6], alpha: 0.9 * fade });
    }
    if (W.target != null) {
      const pts = api.routePoints();
      if (pts.length > 1) {
        drawPath(g, pts, { color: withAlpha('#042f2e', 0.7), width: street ? 7 : 5.5, view });
        drawPath(g, pts, { color: COLORS.path, width: street ? 3.5 : 3, view, arrows: street ? (narrow ? 26 : 20) * px * 3 : 0, alpha: 0.95 });
      }
    }

    // halte, penumpang yang menunggu, dan namanya
    const dotR = Math.max(0.34, px * 3.2);
    for (const h of net.halte) {
      const active = W.active[h.index];
      const color = active ? h.color : '#64748b';
      if (!vis(h.x, h.y, 40)) continue;
      if (street) drawHalte(g, h.shelter, { color });
      drawHalteSign(g, h.sign, { view, minPx: street ? 16 : 13, color: active ? COLORS.halte : '#475569' });
      if (street) {
        const q = W.queues[h.index];
        const shown = Math.min(q.length, 6);
        for (let i = 0; i < shown; i++) {
          const p = h.queueAt(i);
          dot(g, p.x, p.y, dotR, net.halte[q[i].to].color);
        }
      }
      if (W.target === h.index && W.mode === 'drive') drawRing(g, h.x, h.y, Math.max(3.4, px * 11), { color: h.color, width: 2, view, dash: [4, 3] });
      let text = h.name;
      if (!active) text += ' (tidak dilayani)';
      else if (W.unreachable.has(h.index) || h.link.closed) text += ' (jalan ditutup)';
      else if (W.queues[h.index].length) text += ` (${W.queues[h.index].length})`;
      const size = narrow ? 10 : 11;
      const dx = h.left.x > 0.35 ? 12 : h.left.x < -0.35 ? -12 : 0;
      const dy = h.left.y > 0.35 ? 22 : h.left.y < -0.35 ? -26 : -24;
      const o = { color: active ? h.color : '#94a3b8', size, dx, dy, align: dx > 0 ? 'left' : dx < 0 ? 'right' : 'center', priority: 1 };
      if (opts.labelRects) opts.labelRects.delete(h.index);
      if (vis(h.sign.x, h.sign.y, -2)) {
        labels.add(h.sign.x, h.sign.y, text, o);
        if (opts.labelRects) {
          g.save();
          g.font = `600 ${size}px ${FONT}`;
          const w = g.measureText(text).width + 14;
          g.restore();
          const p = view.worldToScreen(h.sign.x, h.sign.y);
          const left = o.align === 'left' ? p.x + dx : o.align === 'right' ? p.x + dx - w : p.x - w / 2;
          opts.labelRects.set(h.index, { left, top: p.y + dy - (size + 8) / 2, w, h: size + 8 });
        }
      }
    }

    // kendaraan lain
    const carMin = street ? 11 : 8;
    for (const c of traffic.cars) {
      if (!vis(c.x, c.z, 8)) continue;
      const o = { view, minPx: c.type === 'motorbike' ? (street ? 15 : 7) : carMin, alpha: clamp(c.alpha, 0, 1), braking: c.braking };
      drawVehicle(g, c, o);
    }

    // shuttle, pintu, dan penumpang yang naik atau turun
    drawShuttle(g, sh, { ego: true, braking: sh.braking, view, minPx: street ? 14 : 12 });
    drawDoors(g, api, view);
    const D = W.dwell;
    if (D && D.anim && street) {
      const h = D.halte;
      const t = clamp(D.anim.t / D.anim.dur, 0, 1);
      const a = D.anim.kind === 'naik' ? h.queueAt(0) : h.door;
      const b = D.anim.kind === 'naik' ? h.door : h.queueAt(1.5);
      dot(g, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, dotR, net.halte[D.anim.pax.to].color, D.anim.kind === 'turun' ? 1 - t * 0.6 : 1);
    }

    // pejalan kaki
    if (scale >= 1.4) {
      const wet = W.weather === 'hujan';
      for (const p of peds.peds) {
        if (!vis(p.x, p.z, 4)) continue;
        drawPedestrian(g, p, { view, minPx: narrow ? 9 : 10, phase: p.moving ? p.phase : 0, alpha: clamp(p.alpha, 0, 1), variant: wet && p.umbrella && !p.test ? 'umbrella' : p.variant, accent: p.accent, color: p.color, highlight: p.test ? COLORS.warn : null });
        if (p.test) addLabel(p.x, p.z, 'menyeberang', { color: '#fde68a', bg: 'rgba(120, 53, 15, 0.9)', size: 10, dy: -20, priority: 3 });
      }
    }

    // lampu lalu lintas simulasi (sama letak dan waktunya dengan Shuttle 3D)
    for (const hd of net.heads) {
      if (!vis(hd.x, hd.y, 10)) continue;
      hd.state = hd.ctl.color(hd.arm);
      if (street) drawTrafficSignal(g, hd, { arm: 2.6, view, minPx: narrow ? 16 : 18, simulated: hd.first && scale >= 2.5 });
      else {
        g.fillStyle = STOP_COLORS[hd.state];
        g.beginPath();
        g.arc(hd.line.cx, hd.line.cy, px * 3.2, 0, Math.PI * 2);
        g.fill();
      }
    }
    // lampu pejalan kaki kecil di ujung zebra cross berlampu
    if (street && scale >= 2.5) {
      for (const c of net.crossings) {
        if (!c.signal || !vis(c.x, c.y, 10)) continue;
        const st = c.signal.pedState();
        const on = st === 'hijau' || (st === 'kedip' && Math.floor(time * 2) % 2 === 0);
        const col = st === 'merah' ? COLORS.lightRed : on ? COLORS.lightGreen : '#1f3b2a';
        const ux = Math.cos(c.walk);
        const uy = Math.sin(c.walk);
        for (const sgn of [1, -1]) {
          const x = c.x + ux * sgn * (c.len / 2 + 0.6);
          const y = c.y + uy * sgn * (c.len / 2 + 0.6);
          g.fillStyle = '#0f172a';
          g.fillRect(x - px * 4, y - px * 4, px * 8, px * 8);
          g.fillStyle = col;
          g.fillRect(x - px * 2.6, y - px * 2.6, px * 5.2, px * 5.2);
        }
      }
    }

    if (W.weather === 'hujan') drawWeather(g, view, 'hujan', time);

    drawLidar(g, view, opts);

    // label SHUTTLE 01 selalu menempel di shuttle
    labels.add(sh.x, sh.z, 'SHUTTLE 01', { color: COLORS.accent, size: narrow ? 10 : 11, dy: -(Math.max(14, 3.2 * scale) + 10), priority: 5, nudge: 'up' });
  }

  function drawLidar(g, view, opts) {
    const { sh, lidar, W } = api;
    const pose = lidar.pose(sh);
    const range = lidar.effectiveRange(W.weather);
    drawLidarRange(g, pose, range, COLORS.lidar, { view, alpha: 0.045, edgeAlpha: 0.22 });
    if (!opts.reducedMotion) drawLidarSweep(g, pose, lidarSweepAngle(opts.time, { period: 10 }), range, COLORS.lidar, { alpha: 0.1 });
    trail.draw(g, opts.time, COLORS.lidar, { view, size: 2, alpha: 0.6, halo: 0.5, spacing: 1.8 });
    // kotak deteksi memudar halus (tidak berkedip saat pindaian baru datang)
    for (const [k, e] of seen) {
      const age = opts.time - e.t;
      if (age > 0.9 || age < 0) {
        seen.delete(k);
        continue;
      }
      const o = e.obj;
      if (o.alive === false) continue;
      const a = age < 0.4 ? 0.85 : 0.85 * (1 - (age - 0.4) / 0.5);
      const box = o.kind === 'pedestrian' ? o : { x: o.x, y: o.z, heading: o.h, length: o.len, width: o.wid };
      drawBracketBox(g, box, COLORS.lidar, { view, pad: 0.45, width: 1.4, alpha: a });
    }
  }

  return { draw, addScan, clear };
}

function dot(g, x, y, r, color, alpha = 1) {
  g.globalAlpha = alpha;
  g.fillStyle = 'rgba(11, 18, 32, 0.85)';
  g.beginPath();
  g.arc(x, y, r * 1.28, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = color;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 1;
}

function drawDoors(g, api, view) {
  const D = api.W.dwell;
  const sh = api.sh;
  if (!D || D.door <= 0) return;
  const k = Math.max(1, 14 / (sh.len * view.camera.scale));
  const L = sh.len * k;
  const Wd = sh.wid * k;
  const open = D.door;
  g.save();
  g.translate(sh.x, sh.z);
  g.rotate(sh.h);
  // pintu geser di sisi kiri (sisi trotoar)
  g.fillStyle = `rgba(254, 249, 195, ${0.85 * open})`;
  g.fillRect(L * 0.08 - 0.6 * open * k, -Wd / 2 - 0.08 * k, 1.2 * open * k, 0.3 * k);
  g.fillStyle = `rgba(148, 163, 184, ${0.7 * open})`;
  roundRectPath(g, L * 0.08 - 0.55 * k, -Wd / 2 - 0.7 * open * k, 1.1 * k, 0.7 * open * k, 0.12 * k);
  g.fill();
  g.restore();
}

