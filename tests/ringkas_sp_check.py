"""Cek kecil sesudah perapian: inspektor objek Sensor dan jalur rencana Persepsi (port 8271)."""
import sys
from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
BASE = "http://127.0.0.1:8271/"
SHOTS = "/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/ringkas-sensor-persepsi/"
bad = []

with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=CHROME, headless=True)
    for mobile in (False, True):
        opts = dict(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True) if mobile else dict(viewport={"width": 1366, "height": 900})
        ctx = browser.new_context(**opts)
        page = ctx.new_page()
        msgs = []
        page.on("console", lambda m: m.type in ("error", "warning") and "ReadPixels" not in m.text and msgs.append(m.text))
        page.on("pageerror", lambda e: msgs.append(str(e)))
        tag = "m" if mobile else "d"
        page.goto(BASE + "#/pelajaran/sensor")
        page.wait_for_function("window.__lessonSafety && window.__simotonom.lessonStatus === 'ready'", timeout=20000)
        page.locator('[data-pick="angkot-ngetem"]').click()
        page.wait_for_timeout(400)
        title = page.locator(".insp-title").inner_text()
        rows = page.locator(".inspector tbody tr").count()
        hook = page.evaluate("() => { const h = window.__lessonSafety; return [h.redRuns, h.pedContacts, h.otherCollisions, h.clamps, Object.keys(h).includes('redRuns')]; }")
        print(tag, "inspektor:", repr(title), rows, "kait:", hook)
        if "Angkot ngetem" not in title or "angkot" not in title or rows != 4 or hook != [0, 0, 0, 0, True]:
            bad.append(f"{tag}-sensor")
        page.locator(".inspector").screenshot(path=f"{SHOTS}check-{tag}-inspektor.png")
        page.goto(BASE + "#/pelajaran/persepsi")
        page.wait_for_function("window.__simotonom.lessonId === 'persepsi' && window.__simotonom.lessonStatus === 'ready'", timeout=20000)
        page.locator('.step-dot[data-go="4"]').click()
        page.locator(".ctl-toggle", has_text="Prediksi").click()
        page.wait_for_timeout(7000)
        page.locator(".sim-canvas").first.screenshot(path=f"{SHOTS}check-{tag}-prediksi.png")
        print(tag, "status:", page.locator(".sim-status, [role=status]").first.inner_text())
        if msgs:
            bad.append(f"{tag}-console: {msgs[:3]}")
        ctx.close()
    browser.close()

print("gagal:", bad)
sys.exit(1 if bad else 0)
