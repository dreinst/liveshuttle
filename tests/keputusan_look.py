"""Tangkapan layar cepat pelajaran Pengambilan Keputusan (Jalan Kawi) untuk diperiksa mata.

Pemakaian: python3 tests/keputusan_look.py [--mobile] [--port 8247] [--step N] [--wait MS] [--name NAMA]
Menyimpan tangkapan panggung dan halaman ke tests/shots/keputusan-malang/ dan mencetak galat console.
"""
import json
import sys

from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
arg = lambda k, d: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
PORT = arg("--port", "8247")
STEP = int(arg("--step", "0"))
WAIT = int(arg("--wait", "3000"))
NAME = arg("--name", "look")
MOBILE = "--mobile" in sys.argv
TAG = "m" if MOBILE else "d"
SHOTS = "/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/keputusan-malang/"

with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=CHROME, headless=True)
    if MOBILE:
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    else:
        ctx = browser.new_context(viewport={"width": 1366, "height": 900})
    page = ctx.new_page()
    errors = []
    page.on("console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.goto(f"http://127.0.0.1:{PORT}/#/pelajaran/keputusan", wait_until="load")
    page.wait_for_function("() => window.__simotonom && window.__simotonom.lessonStatus === 'ready'", timeout=15000)
    if STEP:
        page.locator(f'.step-dot[data-go="{STEP}"]').dispatch_event("click")
    page.wait_for_timeout(WAIT)
    page.evaluate("() => window.scrollTo(0, 0)")
    page.wait_for_timeout(150)
    page.locator(".stage").first.screenshot(path=SHOTS + f"{NAME}-{TAG}-stage.png")
    page.screenshot(path=SHOTS + f"{NAME}-{TAG}-page.png", full_page=True)
    snap = page.evaluate("() => window.__keputusan && JSON.parse(JSON.stringify(window.__keputusan))")
    print(json.dumps({"errors": errors, "status": page.locator('.sim-status').inner_text(), "snap": {k: snap[k] for k in ('time', 'egoS', 'egoSpeed', 'state', 'light', 'counters', 'oncoming', 'peds')} if snap else None}, indent=1, ensure_ascii=False))
    browser.close()
