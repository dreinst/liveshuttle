"""Uji lama pelajaran Level Otomasi: rebase dunia setelah perjalanan jauh, level 4 ke level 5 dari
bahu jalan, level 2 di tikungan, dan laju frame.

Pemakaian: python3 tests/level-otomasi_soak.py [--port 8111]
"""
import json
import sys
import time

from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
PORT = sys.argv[sys.argv.index("--port") + 1] if "--port" in sys.argv else "8111"
SHOTS = "/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/level-otomasi/"
R = {}
errors = []


def readout(page, i):
    return page.locator(".grp-data .readout-value").nth(i).inner_text()


def alert(page):
    el = page.locator(".lvl-alert")
    return None if el.get_attribute("hidden") is not None else el.locator(".lvl-alert-title").inner_text()


with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=CHROME, headless=True)
    ctx = browser.new_context(viewport={"width": 1366, "height": 900})
    page = ctx.new_page()
    page.on("console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.goto(f"http://127.0.0.1:{PORT}/#/pelajaran/level-otomasi", wait_until="load")
    page.wait_for_timeout(1200)

    # laju frame
    fps = page.evaluate("""() => new Promise((res) => { let n = 0; const t0 = performance.now();
      const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(n / ((performance.now() - t0) / 1000)); };
      requestAnimationFrame(f); })""")
    R["fps"] = round(fps, 1)

    # level 4 berhenti di bahu jalan, lalu level 5 kembali ke lajur kiri
    page.locator('.step-dot[data-go="4"]').dispatch_event("click")
    page.locator(".speed-wrap .seg-btn", has_text="2x").click()
    t0 = time.time()
    while time.time() - t0 < 30 and "Berhenti aman" not in (alert(page) or ""):
        page.wait_for_timeout(200)
    R["l4-stop"] = {"alert": alert(page), "pos": readout(page, 3)}
    page.locator(".grp-level .seg-btn", has_text="5").click()
    page.wait_for_timeout(4000)
    R["l5-from-shoulder"] = {"pos": readout(page, 3), "speed": readout(page, 0), "alert": alert(page)}
    page.locator(".stage").screenshot(path=SHOTS + "soak-l5-merge.png")

    # level 5 jalan jauh (melewati beberapa periode jalan dan beberapa batas area operasi)
    samples = []
    for i in range(12):
        page.wait_for_timeout(5000)
        samples.append({"pos": readout(page, 3), "speed": readout(page, 0), "alert": alert(page), "status": page.locator(".sim-status").inner_text()[:90]})
    R["l5-long"] = samples
    page.locator(".stage").screenshot(path=SHOTS + "soak-l5-long.png")

    # level 2 lewat tikungan: harus tetap di lajur tanpa peringatan keluar lajur
    page.locator('.step-dot[data-go="2"]').dispatch_event("click")
    lanes = set()
    ldw = 0
    for i in range(40):
        page.wait_for_timeout(500)
        lanes.add(readout(page, 3))
        a = alert(page) or ""
        if a == "Pegang kemudi" or a == "Pegang kemudi sekarang":
            page.locator('[data-act="pegang"]').click()
        if "Keluar" in a:
            ldw += 1
    R["l2-curves"] = {"lanes": sorted(lanes), "ldwSeen": ldw, "status": page.locator(".sim-status").inner_text()}
    page.locator(".stage").screenshot(path=SHOTS + "soak-l2-curve.png")
    R["errors"] = errors
    browser.close()

print(json.dumps(R, indent=1, ensure_ascii=False))
