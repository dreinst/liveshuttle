"""Bandingkan jalan OSM dengan kerangka jalan pelajaran (garis tengah hasil penghalusan, trotoar,
zebra cross) sepanjang ruas yang dipakai. Satu gambar ikhtisar dan beberapa potongan per 100 m."""
import sys
from playwright.sync_api import sync_playwright
from persepsi_verify_util import CHROME, BASE, SHOTS

JS = r"""
async ({ s0, s1, w, h, full }) => {
  document.body.style.margin = '0';
  document.body.innerHTML = `<div id="c" style="position:relative;width:${w}px;height:${h}px"></div>`;
  const { View } = await import('/js/engine/canvas.js');
  const { loadMap, createMapRenderer } = await import('/js/engine/osm2d.js');
  const { buildStreet } = await import('/js/lessons/persepsi/street.js');
  const map = await loadMap('machung');
  const st = buildStreet(map);
  const pts = [];
  for (let s = s0; s <= s1; s += 2) pts.push(st.pose(s, 0));
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const pad = full ? 30 : 14;
  const view = new View(document.getElementById('c'), { bounds: { minX: Math.min(...xs) - pad, minY: Math.min(...ys) - pad, maxX: Math.max(...xs) + pad, maxY: Math.max(...ys) + pad } });
  const r = createMapRenderer(map, { layers: { places: true } });
  const g = view.begin();
  r.draw(g, view);
  g.globalAlpha = 0.55;
  st.drawBase(g, view);
  g.globalAlpha = 1;
  // garis tengah pelajaran (magenta) dan tepi aspal +-3,5 m (kuning tipis)
  const line = (d, color, wpx, dash) => { g.save(); g.strokeStyle = color; g.lineWidth = view.px(wpx); if (dash) g.setLineDash(dash.map((x) => view.px(x))); g.beginPath();
    for (let s = s0; s <= s1; s += 1) { const p = st.pose(s, d); s === s0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y); } g.stroke(); g.restore(); };
  line(0, '#ff00ff', 2);
  line(3.5, '#fde047', 1, [4, 4]);
  line(-3.5, '#fde047', 1, [4, 4]);
  g.save(); g.fillStyle = '#fff'; g.font = `${view.px(12)}px sans-serif`;
  for (let s = Math.ceil(s0 / 25) * 25; s <= s1; s += 25) { const p = st.pose(s, 9); g.fillText('s' + s, p.x, p.y); }
  g.restore();
  // jalan OSM terdekat: garis tengah OSM (cyan)
  const roads = map.roadsNamed('Jalan Karangampel Timur');
  g.save(); g.strokeStyle = '#22d3ee'; g.lineWidth = view.px(1.5);
  for (const rd of roads) { g.beginPath(); rd.points.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.stroke(); }
  g.restore();
  // simpangan maksimum garis tengah pelajaran dari garis tengah OSM terdekat
  let worst = 0, worstS = 0;
  for (let s = s0; s <= s1; s += 1) {
    const p = st.pose(s, 0);
    let best = Infinity;
    for (const rd of roads) for (let i = 0; i + 1 < rd.points.length; i++) {
      const a = rd.points[i], b = rd.points[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1e-9;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2));
      best = Math.min(best, Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t));
    }
    if (best > worst) { worst = best; worstS = s; }
  }
  const cls = [...new Set(roads.map((r) => r.cls + (r.oneway ? ':oneway' : '')))];
  return { worst: +worst.toFixed(2), worstS, scale: view.camera.scale, cls, length: st.length, route: st.route, mouths: st.mouths.map((m) => ({ s: +m.s.toFixed(0), side: m.side, name: m.name })) };
}
"""
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, headless=True)
    p = b.new_page(viewport={"width": 1400, "height": 900})
    errs = []
    p.on("console", lambda m: errs.append(m.text) if m.type in ("error", "warning") else None)
    p.on("pageerror", lambda e: errs.append(str(e)))
    p.goto(BASE + "tests/persepsi_verify_blank.html")
    print("full", p.evaluate(JS, {"s0": 150, "s1": 800, "w": 1400, "h": 900, "full": True}))
    p.screenshot(path=SHOTS + "route-full.png")
    segs = [(150, 270), (260, 380), (370, 490), (480, 600), (590, 710), (690, 810)]
    for s0, s1 in segs:
        p.goto(BASE + "tests/persepsi_verify_blank.html")
        print(s0, s1, p.evaluate(JS, {"s0": s0, "s1": s1, "w": 1400, "h": 700, "full": False}))
        p.screenshot(path=SHOTS + f"route-{s0}.png", clip={"x": 0, "y": 0, "width": 1400, "height": 700})
    print(errs)
    b.close()
