"""Tangkapan layar pelajaran Sensor dalam beberapa keadaan (desktop dan ponsel).

Pemakaian: python3 tests/sensor_visual.py [awalan]
Butuh server di port 8242 (python3 tests/serve.py 8242).
"""
import json
import sys
from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
BASE = "http://127.0.0.1:8242/"
OUT = "/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/sensor/"
prefix = sys.argv[1] if len(sys.argv) > 1 else "vis"


def toggle(page, name, want):
    t = page.locator(".ctl-toggle", has_text=name).first
    if (t.get_attribute("aria-checked") == "true") != want:
        t.click()


def run(mobile):
    tag = "mobile" if mobile else "desktop"
    msgs = []
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=CHROME, headless=True)
        if mobile:
            c = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, device_scale_factor=2)
        else:
            c = b.new_context(viewport={"width": 1366, "height": 900})
        p = c.new_page()
        p.on("console", lambda m: msgs.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
        p.on("pageerror", lambda e: msgs.append(f"pageerror: {e}"))
        p.goto(BASE + "#/pelajaran/sensor")
        p.wait_for_function("window.__lessonSafety && window.__lessonSafety.view", timeout=15000)
        canvas = p.locator(".sim-canvas").first
        # semua sensor menyala, cerah, tunggu sampai lampu jalan utama hijau dan kendaraan lewat
        for n in ["Kamera", "LiDAR", "Radar", "Ultrasonik"]:
            toggle(p, n, True)
        p.wait_for_timeout(20000)
        canvas.screenshot(path=f"{OUT}{prefix}-{tag}-all-cerah.png")
        for w in ["Hujan", "Kabut", "Malam"]:
            p.locator(".seg-btn", has_text=w).first.click()
            p.wait_for_timeout(2500)
            canvas.screenshot(path=f"{OUT}{prefix}-{tag}-all-{w.lower()}.png")
        p.locator(".seg-btn", has_text="Cerah").first.click()
        for n in ["Kamera", "Radar", "Ultrasonik"]:
            toggle(p, n, False)
        p.wait_for_timeout(2500)
        canvas.screenshot(path=f"{OUT}{prefix}-{tag}-lidar-only.png")
        p.screenshot(path=f"{OUT}{prefix}-{tag}-page.png", full_page=True)
        snap = p.evaluate("() => window.__lessonSafety.snapshot()")
        b.close()
    return {"tag": tag, "console": msgs, "safety": {k: snap[k] for k in ["redRuns", "pedContacts", "otherCollisions", "clamps", "minPedGap"]}}


print(json.dumps([run(False), run(True)], indent=1))
