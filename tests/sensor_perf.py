"""Biaya CPU per langkah fisika pelajaran Sensor (model dunia, perisai keselamatan, dan semua sensor).

Pemakaian: python3 tests/sensor_perf.py
Butuh server di port 8242.
"""
import json
from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, headless=True)
    p = b.new_page(viewport={"width": 1366, "height": 900})
    p.goto("http://127.0.0.1:8242/#/pelajaran/sensor")
    p.wait_for_function("window.__lessonSafety && window.__simotonom.lessonStatus === 'ready'", timeout=20000)
    for n in ["Kamera", "LiDAR", "Radar", "Ultrasonik"]:
        p.locator(".ctl-toggle", has_text=n).first.click()
    p.locator('[data-act="pause"]').click()
    out = p.evaluate("""() => {
      const h = window.__lessonSafety; const sc = h.scene; const rig = h.rig; const dt = 1 / 60;
      const res = {};
      for (const w of ['cerah', 'hujan']) {
        let t = 100; const n = 1200;
        const t0 = performance.now();
        for (let i = 0; i < n; i++) { sc.update(dt, t); rig.update(dt, sc.objects, w); t += dt; }
        const t1 = performance.now();
        for (let i = 0; i < n; i++) { sc.update(dt, t); t += dt; }
        const t2 = performance.now();
        res[w] = { msPerTickAll: +((t1 - t0) / n).toFixed(3), msPerTickModelOnly: +((t2 - t1) / n).toFixed(3), objects: sc.objects.length };
      }
      return res;
    }""")
    print(json.dumps(out, indent=1))
    b.close()
