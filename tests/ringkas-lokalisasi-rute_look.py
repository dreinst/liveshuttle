"""Tangkapan layar jalur gambar yang diubah saat merampingkan kode Lokalisasi dan Rute.

Lokalisasi: semua estimasi menyala (mobil tebakan, elips, titik LiDAR, peta mini).
Rute: mobil melaju, jalan di depannya ditutup (penanda tutup di tengah potongan, rute terpotong).
Pemakaian: python3 tests/serve.py 8272 (di latar), lalu python3 tests/ringkas-lokalisasi-rute_look.py
"""
import json
from playwright.sync_api import sync_playwright

CHROME = "/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
BASE = "http://127.0.0.1:8272/"
SHOTS = "/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/ringkas-lokalisasi-rute/"
DEVICES = {
    "desktop": dict(viewport={"width": 1366, "height": 900}),
    "mobile": dict(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, device_scale_factor=2),
}


def run(pw, name, opts):
    browser = pw.chromium.launch(executable_path=CHROME, headless=True)
    page = browser.new_page(**opts)
    logs = []
    page.on("console", lambda m: logs.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: logs.append(f"pageerror: {e}"))
    ready = "() => window.__simotonom && window.__simotonom.lessonStatus === 'ready'"

    page.goto(BASE + "#/pelajaran/lokalisasi")
    page.wait_for_function(ready)
    page.click('.step-dot[data-go="4"]')
    page.wait_for_timeout(300)
    for label in ("Odometri dan IMU", "Pencocokan peta"):  # GPS dan Fusi sudah menyala di preset langkah 5
        page.locator(".ctl-toggle", has_text=label).first.click()
    page.wait_for_timeout(6000)
    lok = page.evaluate("() => window.__lokalisasi.state")
    page.locator(".sim-canvas").first.screenshot(path=f"{SHOTS}look-lokalisasi-{name}.png")

    page.goto(BASE + "#/pelajaran/rute")
    page.wait_for_function(ready)
    page.click('.step-dot[data-go="4"]')
    page.wait_for_function("() => window.__rute && window.__rute.snapshot().route")
    page.locator("button", has_text="Jalankan mobil").first.click()
    page.wait_for_timeout(1500)
    page.locator("button[aria-label='Ikuti mobil']").click()
    page.wait_for_timeout(400)
    page.locator("button", has_text="Tutup jalan di rute").first.click()
    page.wait_for_timeout(2500)
    snap = page.evaluate("() => window.__rute.snapshot()")
    page.locator(".sim-canvas").first.screenshot(path=f"{SHOTS}look-rute-{name}.png")
    page.locator("button[aria-label='Tampilkan start dan tujuan']").click()
    page.wait_for_timeout(500)
    page.locator(".sim-canvas").first.screenshot(path=f"{SHOTS}look-rute-fit-{name}.png")
    browser.close()
    return {
        "lokalisasi": {k: lok[k] for k in ("errors", "lidarPoints", "shield")},
        "rute": {"car": snap["car"]["state"], "replanned": snap["route"]["replanned"], "closed": len(snap["stretches"]), "redRuns": snap["safety"]["redRuns"]},
        "console": logs,
    }


with sync_playwright() as pw:
    out = {name: run(pw, name, opts) for name, opts in DEVICES.items()}
print(json.dumps(out, indent=1))
bad = any(v["console"] for v in out.values())
raise SystemExit(1 if bad else 0)
