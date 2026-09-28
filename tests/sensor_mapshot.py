"""Tangkapan pratinjau peta (tests/sensor_mapview.html) untuk memilih lokasi adegan pelajaran Sensor.

Pemakaian: python3 tests/sensor_mapshot.py NAMA x y skala [ids]
"""
import sys
from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
name, x, y, s = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
ids = "&ids=1" if len(sys.argv) > 5 else ""
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, headless=True)
    p = b.new_page(viewport={"width": 920, "height": 560})
    p.goto(f"http://127.0.0.1:8242/tests/sensor_mapview.html?x={x}&y={y}&s={s}{ids}")
    p.wait_for_function("window.__ready === true", timeout=15000)
    p.wait_for_timeout(300)
    p.screenshot(path=f"/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/sensor/map-{name}.png")
    b.close()
