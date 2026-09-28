"""Tangkapan layar halaman penuh pelajaran Level Otomasi di langkah tertentu (desktop dan mobile).

Pemakaian: python3 tests/level-otomasi_pages.py [--port 8111] [langkah ...]
"""
import sys

from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
args = [a for a in sys.argv[1:]]
PORT = "8111"
if "--port" in args:
    PORT = args[args.index("--port") + 1]
    del args[args.index("--port"):args.index("--port") + 2]
STEPS = [int(a) for a in args] or [3]
SHOTS = "/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/level-otomasi/"
errors = []

with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=CHROME, headless=True)
    for mobile in (False, True):
        if mobile:
            ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        else:
            ctx = browser.new_context(viewport={"width": 1366, "height": 900})
        page = ctx.new_page()
        page.on("console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        for attempt in range(3):
            page.goto(f"http://127.0.0.1:{PORT}/#/pelajaran/level-otomasi", wait_until="load")
            try:
                page.wait_for_function("() => window.__simotonom.lessonStatus === 'ready'", timeout=8000)
                break
            except Exception:
                # http.server kadang memutus koneksi saat banyak modul dimuat bersamaan; coba lagi
                errors.append(f"muat ulang ke-{attempt + 1}")
        page.wait_for_timeout(800)
        for st in STEPS:
            page.locator(f'.step-dot[data-go="{st}"]').dispatch_event("click")
            page.wait_for_timeout(4200)
            tag = "m" if mobile else "d"
            page.screenshot(path=f"{SHOTS}page-{tag}-step{st}.png", full_page=True)
        ctx.close()
    browser.close()
print("errors:", errors)
