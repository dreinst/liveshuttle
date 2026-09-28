"""Tangkapan layar pelajaran Sensor yang diperbesar di titik tertentu (bingkai jalan s, d).

Pemakaian: python3 tests/sensor_zoom.py NAMA s d skala [detik_tunggu] [cuaca] [sensor,sensor]
"""
import sys
from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
name, s, d, sc = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4])
wait = float(sys.argv[5]) if len(sys.argv) > 5 else 1.0
weather = sys.argv[6] if len(sys.argv) > 6 else "cerah"
sensors = sys.argv[7].split(",") if len(sys.argv) > 7 and sys.argv[7] else []
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, headless=True)
    p = b.new_page(viewport={"width": 1366, "height": 900})
    msgs = []
    p.on("console", lambda m: msgs.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    p.on("pageerror", lambda e: msgs.append(f"pageerror: {e}"))
    p.goto("http://127.0.0.1:8242/#/pelajaran/sensor")
    p.wait_for_function("window.__lessonSafety && window.__lessonSafety.view", timeout=15000)
    if weather != "cerah":
        p.locator(".seg-btn", has_text=weather.capitalize()).first.click()
    for sn in sensors:
        p.locator(".ctl-toggle", has_text=sn).first.click()
    p.wait_for_timeout(int(wait * 1000))
    p.evaluate("""([s, d, sc]) => { const h = window.__lessonSafety; const w = h.scene.frame.toWorld(s, d);
      h.view.fit(null); h.view.setScale(sc); h.view.centerOn(w.x, w.y); }""", [s, d, sc])
    p.wait_for_timeout(300)
    p.locator(".sim-canvas").first.screenshot(path=f"/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/sensor/zoom-{name}.png")
    print("\n".join(msgs) or "no console problems")
    b.close()
