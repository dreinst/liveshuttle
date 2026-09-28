"""Pratinjau peta OSM untuk memilih ruas jalan pelajaran Persepsi.

Pemakaian: python3 tests/persepsi_mapview.py CX CY HALFW HALFH NAMA [skala]
Butuh server di port 8243.
"""
import sys

from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
BASE = "http://127.0.0.1:8243/"
SHOTS = "/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/persepsi-malang/"
cx, cy, hw, hh = (float(a) for a in sys.argv[1:5])
name = sys.argv[5]
mapid = sys.argv[6] if len(sys.argv) > 6 else "machung"

JS = r"""
async ({ cx, cy, hw, hh, mapid }) => {
  document.body.innerHTML = '<div id="c" style="position:relative;width:1300px;height:800px"></div>';
  const { View } = await import('/js/engine/canvas.js');
  const { loadMap, createMapRenderer } = await import('/js/engine/osm2d.js');
  const map = await loadMap(mapid);
  const view = new View(document.getElementById('c'), { bounds: map.boundsAround(cx, cy, hw, hh) });
  const r = createMapRenderer(map, { layers: { places: true } });
  const g = view.begin();
  r.draw(g, view);
  return { scale: view.camera.scale };
}
"""
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, headless=True)
    p = b.new_page(viewport={"width": 1300, "height": 800})
    errs = []
    p.on("console", lambda m: errs.append(m.text) if m.type in ("error", "warning") else None)
    p.goto(BASE + "js/data/")
    print(p.evaluate(JS, {"cx": cx, "cy": cy, "hw": hw, "hh": hh, "mapid": mapid}))
    p.wait_for_timeout(300)
    p.screenshot(path=SHOTS + name + ".png")
    print(errs)
    b.close()
