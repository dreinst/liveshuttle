"""QA independen pelajaran Sensor: cocokkan adegan dengan data OSM 'machung'.

Mencetak jalan di sekitar adegan (nama, kelas, satu arah, lebar), nama kampus, tempat bernama di dekatnya,
dan posisi rute kendaraan latar terhadap jalan OSM (apakah tiap titik rute berada di atas jalan).
Pemakaian: python3 tests/sensor_verify_map.py   (server di port 8262)
"""
import json
from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
JS = r"""
async () => {
  const { loadMap } = await import('/js/engine/osm2d.js');
  const ST = await import('/js/lessons/sensor/street.js');
  const map = await loadMap('machung');
  const F = ST.streetFrame(map);
  const routes = ST.buildRoutes(F);
  const out = { frame: { origin: F.origin, heading: F.heading, name: F.name }, keys: Object.keys(map) };
  // jalan dekat adegan
  const c = F.toWorld(60, 0);
  const roads = [];
  for (const r of map.roads) {
    let near = Infinity;
    for (const p of r.points) near = Math.min(near, Math.hypot(p.x - c.x, p.y - c.y));
    if (near < 90) roads.push({ id: r.id, name: r.name, cls: r.cls, oneway: r.oneway, width: r.width, lanes: r.lanes, near: +near.toFixed(1),
      pts: r.points.map((p) => { const f = F.toFrame(p.x, p.y); return [+f.s.toFixed(1), +f.d.toFixed(1)]; }) });
  }
  out.roads = roads;
  out.campus = map.campus ? { name: map.campus.name } : null;
  out.places = (map.places || []).map((p) => { const f = F.toFrame(p.x, p.y); return { name: p.name, type: p.type, s: +f.s.toFixed(0), d: +f.d.toFixed(0) }; })
    .filter((p) => Math.abs(p.s - 60) < 250 && Math.abs(p.d) < 250);
  // rute: jarak tiap titik ke jalan OSM terdekat yang bisa dilewati mobil
  out.routes = {};
  for (const [id, r] of Object.entries(routes)) {
    let worst = 0; let worstAt = null; const names = new Set();
    for (let s = 0; s <= r.path.length; s += 1) {
      const p = r.path.sample(s);
      const hit = map.nearestRoad(p.x, p.y, { maxDist: 30 });
      const d = hit ? hit.dist : 99;
      if (hit?.road) names.add(`${hit.road.name || '(tanpa nama)'}|${hit.road.cls}|oneway=${hit.road.oneway}`);
      const allow = hit?.road ? (hit.road.width || 6) / 2 + 0.3 : 0;
      if (d - allow > worst) { worst = d - allow; const f = F.toFrame(p.x, p.y); worstAt = [+f.s.toFixed(1), +f.d.toFixed(1)]; }
    }
    out.routes[id] = { length: +r.path.length.toFixed(1), worstOffRoad: +worst.toFixed(2), worstAt, roads: [...names] };
  }
  return out;
}
"""
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, headless=True)
    pg = b.new_page()
    errs = []
    pg.on("console", lambda m: m.type in ("error", "warning") and errs.append(m.text))
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto("http://127.0.0.1:8262/tests/sensor_mapview.html")
    res = pg.evaluate(JS)
    print(json.dumps(res, indent=1, ensure_ascii=False)[:20000])
    print("errors", errs)
    b.close()
