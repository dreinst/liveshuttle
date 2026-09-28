"""Periksa chip HUD pelajaran Kendali di layar ringkasan (teksnya harus tetap terlihat).

Pemakaian: python3 tests/kontrol_summary_check.py [--port 8246]
"""
import json
import sys

from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
PORT = sys.argv[sys.argv.index("--port") + 1] if "--port" in sys.argv else "8246"
SHOTS = "/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/kontrol/"

with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, headless=True)
    p = b.new_page(viewport={"width": 1366, "height": 900})
    errs = []
    p.on("console", lambda m: errs.append(m.text) if m.type in ("error", "warning") else None)
    p.goto(f"http://127.0.0.1:{PORT}/#/pelajaran/kontrol", wait_until="load")
    p.wait_for_timeout(2000)
    p.locator('.step-dot.is-summary, .step-dot[data-go="5"]').first.click()
    p.wait_for_timeout(1500)
    chips = p.evaluate("""() => [...document.querySelectorAll('.hud-chip')].map(c => ({ hidden: c.hidden, text: c.textContent,
        color: getComputedStyle(c).color, opacity: getComputedStyle(c).opacity, vis: getComputedStyle(c).visibility }))""")
    p.locator(".stage").screenshot(path=SHOTS + "summary-stage.png")
    print(json.dumps({"chips": chips, "errors": errs}, indent=1, ensure_ascii=False))
    b.close()
