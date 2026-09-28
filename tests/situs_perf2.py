"""Kinerja toolkit Malang dan kanvas beranda: GPU (Metal) vs SwiftShader, desktop dan ponsel.

Mengukur: interval requestAnimationFrame di beranda, lama muat dan urai tiap peta, bangun graf,
A* dan Dijkstra dari kampus Ma Chung ke Alun-alun Merdeka, dan lama satu kali gambar peta penuh.
Pemakaian: python3 tests/situs_perf2.py
"""

import json

from situs_util import BASE, GPU, SWIFTSHADER, browser, new_page

MEASURE = """() => new Promise((resolve) => {
  const t = []; let last = performance.now(); const end = last + 3000;
  const tick = (now) => { t.push(now - last); last = now; if (now < end) requestAnimationFrame(tick); else {
    t.sort((a, b) => a - b); const avg = t.reduce((a, b) => a + b, 0) / t.length;
    resolve({ frames: t.length, avgMs: +avg.toFixed(2), p95Ms: +t[Math.floor(t.length * 0.95)].toFixed(2), maxMs: +t[t.length - 1].toFixed(2) }); } };
  requestAnimationFrame(tick);
})"""

TOOLKIT = """async () => {
  const osm = await import('./js/engine/osm2d.js');
  const { View } = await import('./js/engine/canvas.js');
  const r = {};
  for (const id of ['machung', 'malang-center', 'malang-roads']) {
    const t0 = performance.now();
    const map = await osm.loadMap(id + '?nocache=' + Math.random() === '' ? id : id);
    const t1 = performance.now();
    const graph = map.graph({ cost: 'time' });
    const t2 = performance.now();
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:0;top:0;width:800px;height:500px;visibility:hidden';
    document.body.append(host);
    const view = new View(host, { bounds: map.bounds });
    const renderer = osm.createMapRenderer(map);
    const g = view.begin();
    const t3 = performance.now();
    renderer.draw(g, view);
    const t4 = performance.now();
    renderer.draw(view.begin(), view);
    const t5 = performance.now();
    view.destroy(); host.remove();
    r[id] = { roads: map.roads.length, buildings: map.buildings.length, graphNodes: graph.nodes.size, loadParseMs: +(t1 - t0).toFixed(1), graphMs: +(t2 - t1).toFixed(1), firstPaintMs: +(t4 - t3).toFixed(1), cachedPaintMs: +(t5 - t4).toFixed(2) };
    if (id === 'malang-roads') {
      const a = graph.nearestNode(0, 0).id;
      const b = graph.nearestNode(4559, 2808).id;
      for (const alg of ['astar', 'dijkstra']) {
        const s0 = performance.now();
        const res = graph.findRoute(a, b, { algorithm: alg });
        const s1 = performance.now();
        r[id][alg] = { found: res.found, expanded: res.expanded, km: +(graph.routeLength(res.path) / 1000).toFixed(2), minutes: +(res.cost / 60).toFixed(1), ms: +(s1 - s0).toFixed(1) };
      }
    }
  }
  return r;
}"""

out = {}
for name, args in (("gpu-metal", GPU), ("swiftshader", SWIFTSHADER)):
    with browser(args) as b:
        for mobile in (False, True):
            ctx, page, con = new_page(b, mobile)
            tag = f"{name}-{'m' if mobile else 'd'}"
            page.goto(BASE + "#/", wait_until="load")
            page.wait_for_timeout(2000)
            gl = page.evaluate("() => { const c = document.createElement('canvas').getContext('webgl'); const d = c && c.getExtension('WEBGL_debug_renderer_info'); return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : null; }")
            home = page.evaluate(MEASURE)
            tk = page.evaluate(TOOLKIT) if not mobile else None
            out[tag] = {"renderer": gl, "home": home, "toolkit": tk, **con.summary()}
            ctx.close()
print(json.dumps(out, indent=1))
