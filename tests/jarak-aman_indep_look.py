"""Tangkapan layar cepat pelajaran Jarak Aman (QA mandiri) untuk diperiksa dengan mata.

Pemakaian: python3 tests/jarak-aman_indep_look.py [--mobile] [--port 8138] [--prefix nama]
"""
import json
import sys

from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
MOBILE = "--mobile" in sys.argv
PORT = sys.argv[sys.argv.index("--port") + 1] if "--port" in sys.argv else "8138"
PREFIX = sys.argv[sys.argv.index("--prefix") + 1] if "--prefix" in sys.argv else "look"
BASE = f"http://127.0.0.1:{PORT}/"
SHOTS = "/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/jarak-aman-qa/"
TAG = "m" if MOBILE else "d"
errors = []

with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, headless=True)
    if MOBILE:
        c = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    else:
        c = b.new_context(viewport={"width": 1366, "height": 900}, device_scale_factor=1)
    p = c.new_page()
    p.on("console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    p.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    p.goto(BASE + "#/", wait_until="load")
    p.evaluate("() => localStorage.clear()")
    p.goto(BASE + "#/pelajaran/jarak-aman", wait_until="load")
    p.wait_for_timeout(2000)
    p.screenshot(path=SHOTS + f"{PREFIX}-{TAG}-0-top.png")
    p.screenshot(path=SHOTS + f"{PREFIX}-{TAG}-0-full.png", full_page=True)
    for i in range(1, 5):
        p.locator(f'.step-dot[data-go="{i}"]').dispatch_event("click")
        p.wait_for_timeout(900)
        p.evaluate("() => document.querySelector('.stage').scrollIntoView({block: 'start'})")
        p.wait_for_timeout(200)
        p.locator(".sim-area").first.screenshot(path=SHOTS + f"{PREFIX}-{TAG}-{i}-stage.png")
    print(json.dumps(p.evaluate("() => JSON.parse(JSON.stringify(window.__simotonom))")))
    b.close()
print("errors", errors)
