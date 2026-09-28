"""Tangkapan layar pelajaran Level Otomasi (versi Malang) untuk diperiksa dengan mata.

Membuka tiap langkah, menjalankan simulasi sebentar (2x), lalu menyimpan tangkapan panggung,
peta perjalanan, dan halaman. Juga mengumpulkan galat dan peringatan konsol.
Pemakaian: python3 tests/level-otomasi_malang_look.py [--mobile] [--port 8241] [--steps 0,1,2]
"""
import json
import os
import sys

from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
MOBILE = "--mobile" in sys.argv
PORT = sys.argv[sys.argv.index("--port") + 1] if "--port" in sys.argv else "8241"
STEPS = [int(x) for x in sys.argv[sys.argv.index("--steps") + 1].split(",")] if "--steps" in sys.argv else [0, 1, 2, 3, 4, 5]
WAIT = float(sys.argv[sys.argv.index("--wait") + 1]) if "--wait" in sys.argv else 3.0
BASE = f"http://127.0.0.1:{PORT}/"
SHOTS = "/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/level-otomasi-malang/"
TAG = "m" if MOBILE else "d"
os.makedirs(SHOTS, exist_ok=True)

errors = []
out = {}
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=CHROME, headless=True)
    if MOBILE:
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    else:
        ctx = browser.new_context(viewport={"width": 1366, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.goto(BASE + "#/", wait_until="load")
    page.evaluate("() => localStorage.clear()")
    page.goto(BASE + "#/pelajaran/level-otomasi", wait_until="load")
    page.reload(wait_until="load")
    page.wait_for_timeout(1500)
    for i in STEPS:
        page.locator(f'.step-dot[data-go="{i}"]').dispatch_event("click")
        page.wait_for_timeout(300)
        page.locator(".speed-wrap .seg-btn", has_text="2x").click()
        page.wait_for_timeout(int(WAIT * 1000))
        page.locator('[data-act="pause"]').click()
        page.wait_for_timeout(250)
        st = page.evaluate("() => window.__levelOtomasi && window.__levelOtomasi.state")
        out[i] = {
            "status": page.locator(".sim-status").inner_text(),
            "where": page.locator(".trip-where").inner_text(),
            "state": st,
        }
        page.evaluate("() => window.scrollTo(0, 0)")
        page.locator(".stage").screenshot(path=SHOTS + f"look-{TAG}-{i}-stage.png")
        page.locator(".grp-trip").scroll_into_view_if_needed()
        page.locator(".grp-trip").screenshot(path=SHOTS + f"look-{TAG}-{i}-trip.png")
        page.locator('[data-act="pause"]').click()
        page.locator(".speed-wrap .seg-btn", has_text="1x").click()
    page.evaluate("() => window.scrollTo(0, 0)")
    page.screenshot(path=SHOTS + f"look-{TAG}-page.png", full_page=True)
    browser.close()
out["errors"] = errors
print(json.dumps(out, indent=1, ensure_ascii=False))
