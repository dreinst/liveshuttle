"""Tangkapan layar keadaan khusus pelajaran Pengambilan Keputusan (Jalan Kawi, Malang) untuk diperiksa mata.

Pemakaian: python3 tests/keputusan_visual.py [--mobile] [--port 8247]
Menyimpan gambar panggung (stage) ke tests/shots/keputusan-malang/vis-*.png dan mencetak galat console.
Juga memotret pejalan kaki yang menyeberang di kaki simpang saat Jalan Kawi merah, angkot yang
menurunkan penumpang, dan panggung dengan prefers-reduced-motion.
"""
import json
import re
import sys
import time

from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
PORT = sys.argv[sys.argv.index("--port") + 1] if "--port" in sys.argv else "8247"
BASE = f"http://127.0.0.1:{PORT}/"
SHOTS = "/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/keputusan-malang/"
MOBILE = "--mobile" in sys.argv
TAG = "m" if MOBILE else "d"


def num(text):
    m = re.search(r"-?[\d.]+(?:,\d+)?", text or "")
    return float(m.group(0).replace(".", "").replace(",", ".")) if m else None


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

    def boot(route):
        for _ in range(4):
            page.goto(BASE + route, wait_until="load")
            try:
                page.wait_for_function("() => window.__simotonom && window.__simotonom.lessonStatus === 'ready'", timeout=15000)
                return
            except Exception:
                errors.clear()
        raise RuntimeError("gagal dimuat")

    status = lambda: page.locator(".sim-status").inner_text()
    readout = lambda label: page.locator(".readout", has_text=label).first.locator(".readout-value").inner_text()

    def go_step(i):
        page.locator(f'.step-dot[data-go="{i}"]').dispatch_event("click")
        page.wait_for_timeout(300)

    def stage(name):
        page.evaluate("() => window.scrollTo(0, 0)")
        page.wait_for_timeout(120)
        page.locator(".stage").first.screenshot(path=SHOTS + f"vis-{TAG}-{name}.png")

    def wait(pred, timeout):
        t0 = time.time()
        while time.time() - t0 < timeout:
            if pred():
                return True
            page.wait_for_timeout(60)
        return False

    boot("#/pelajaran/keputusan")
    page.locator(".speed-wrap .seg-btn", has_text="2x").click()

    # kuning saat masih jauh: keputusan berhenti
    go_step(2)
    wait(lambda: (num(readout("Ke garis henti")) or 999) < 45, 40)
    page.locator(".seg-btn", has_text="Paksa merah").first.click()
    page.wait_for_timeout(700)
    stage("kuning-berhenti")
    wait(lambda: "menunggu di belakang" in status(), 20)
    stage("kuning-berhenti-diam")
    print("panel:", page.locator(".ctl-group", has_text="Dilema lampu kuning").first.inner_text().replace("\n", " | "))

    # pejalan kaki menunggu saat mobil masih jauh
    go_step(1)
    page.locator(".btn", has_text="Munculkan pejalan kaki").first.click()
    wait(lambda: "melambat" in status(), 20)
    page.wait_for_timeout(300)
    stage("pejalan-menunggu")

    # jeda: lencana Dijeda tidak boleh menutupi diagram
    page.locator('[data-act="pause"]').click()
    page.wait_for_timeout(300)
    stage("dijeda")
    page.locator('[data-act="pause"]').click()

    # kembali ke lajur
    go_step(3)
    page.locator(".btn", has_text="Taruh angkot ngetem").first.click()
    wait(lambda: "kembali ke lajur kiri" in status().lower(), 90)
    page.wait_for_timeout(250)
    stage("kembali")

    # pejalan kaki latar menyeberang di kaki simpang saat Jalan Kawi merah
    go_step(0)
    page.locator(".seg-btn", has_text="Paksa merah").first.click()
    wait(lambda: page.evaluate("() => (window.__keputusan?.peds || []).some((p) => !p.test && p.state === 'menyeberang')"), 60)
    page.wait_for_timeout(400)
    stage("simpang-pejalan")

    # langkah 5 berjalan beberapa saat dengan lampu otomatis
    go_step(4)
    page.wait_for_timeout(9000)
    stage("otomatis")
    snap = page.evaluate("() => window.__keputusan.counters")
    print("perisai:", json.dumps(snap))
    print("errors:", json.dumps(errors))
    browser.close()

# gerak dikurangi (prefers-reduced-motion): simulasi tetap jalan, animasi hiasan diam
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=CHROME, headless=True)
    opts = {"viewport": {"width": 390, "height": 844}, "device_scale_factor": 2, "is_mobile": True, "has_touch": True} if MOBILE else {"viewport": {"width": 1366, "height": 900}}
    ctx = browser.new_context(reduced_motion="reduce", **opts)
    page = ctx.new_page()
    errs = []
    page.on("console", lambda m: errs.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))
    page.goto(BASE + "#/pelajaran/keputusan", wait_until="load")
    page.wait_for_function("() => window.__simotonom && window.__simotonom.lessonStatus === 'ready'", timeout=15000)
    page.locator('.step-dot[data-go="4"]').dispatch_event("click")
    page.wait_for_timeout(5000)
    page.evaluate("() => window.scrollTo(0, 0)")
    page.locator(".stage").first.screenshot(path=SHOTS + f"vis-{TAG}-gerak-dikurangi.png")
    print("reduced motion time:", page.evaluate("() => window.__keputusan.time"), "errors:", json.dumps(errs))
    browser.close()
