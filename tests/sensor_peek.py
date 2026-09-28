"""Tangkapan layar cepat untuk melihat keadaan (pelajaran Sensor dan halaman contoh toolkit).

Pemakaian: python3 tests/sensor_peek.py URL_PATH NAMA [tunggu_ms] [mobile]
"""
import sys
from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
BASE = "http://127.0.0.1:8242/"
OUT = "/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/sensor/"

path = sys.argv[1]
name = sys.argv[2]
wait = int(sys.argv[3]) if len(sys.argv) > 3 else 2500
mobile = len(sys.argv) > 4 and sys.argv[4] == "mobile"
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, headless=True)
    if mobile:
        c = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, device_scale_factor=2)
    else:
        c = b.new_context(viewport={"width": 1366, "height": 900})
    p = c.new_page()
    msgs = []
    p.on("console", lambda m: msgs.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    p.on("pageerror", lambda e: msgs.append(f"pageerror: {e}"))
    p.goto(BASE + path)
    p.wait_for_timeout(wait)
    p.screenshot(path=OUT + name + ".png", full_page="full" in name)
    print("\n".join(msgs) or "no console problems")
    b.close()
