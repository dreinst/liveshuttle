"""QA independen: tangkapan layar tahap demi tahap pelajaran Misi Shuttle Otonom (port 8139).

Mengambil gambar panggung pada beberapa waktu misi (kecepatan 2x), di desktop dan di ponsel
dengan tampilan Seluruh kampus (label paling padat), untuk memeriksa label, halte, dan shuttle.
Pemakaian: python3 tests/shuttle_indep_look.py
"""
import json
import re

from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
BASE = "http://127.0.0.1:8139/"
SHOTS = "/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/shuttle-qa/"
TIMES = [20, 32, 44, 70, 100, 130]

errors = []
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=CHROME, headless=True)
    for tag, mobile in [("d", False), ("m", True)]:
        if mobile:
            ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        else:
            ctx = browser.new_context(viewport={"width": 1366, "height": 900})
        page = ctx.new_page()
        page.on("console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.goto(BASE + "#/", wait_until="load")
        page.evaluate("() => localStorage.clear()")
        page.goto(BASE + "#/pelajaran/shuttle", wait_until="load")
        page.wait_for_timeout(1000)
        if mobile:
            page.locator(".seg-btn", has_text="Seluruh kampus").click()
        page.locator(".speed-wrap .seg-btn", has_text="2x").click()
        page.locator(".sim-canvas").scroll_into_view_if_needed()
        for t in TIMES:
            while True:
                txt = page.evaluate("""() => [...document.querySelectorAll('.readout')].find(e => e.querySelector('.readout-label')?.textContent === 'Waktu misi').querySelector('.readout-value').textContent""")
                if int(re.sub(r"\D", "", txt) or 0) >= t:
                    break
                page.wait_for_timeout(100)
            page.locator(".stage").screenshot(path=f"{SHOTS}look-{tag}-{t:03d}.png")
        ctx.close()
    browser.close()
print(json.dumps({"errors": errors}))
