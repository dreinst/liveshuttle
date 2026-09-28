"""Tangkapan layar Lokalisasi untuk diperiksa mata: LiDAR tenang di Kayutangan, zebra cross dengan
penyeberang, dan waktu bingkai (rAF).

Pemakaian: python3 tests/lokalisasi_malang_look.py [--mobile] [--port 8244] [--gpu]
"""
import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
MOBILE = "--mobile" in sys.argv
GPU = "--gpu" in sys.argv
PORT = sys.argv[sys.argv.index("--port") + 1] if "--port" in sys.argv else "8244"
BASE = f"http://127.0.0.1:{PORT}/"
SHOTS = "/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/lokalisasi-malang/"
TAG = ("m" if MOBILE else "d") + ("-gpu" if GPU else "")
os.makedirs(SHOTS, exist_ok=True)
msgs = []
R = {}


def st(page):
    return page.evaluate("() => window.__lokalisasi.state")


def wait_s(page, lo, hi, timeout=90):
    t0 = time.time()
    while time.time() - t0 < timeout:
        s = st(page)["s"]
        if lo <= s <= hi:
            return True
        page.wait_for_timeout(60)
    return False


def shot(page, name):
    page.evaluate("() => window.scrollTo(0, 0)")
    page.locator(".stage").screenshot(path=f"{SHOTS}look-{TAG}-{name}.png")


with sync_playwright() as pw:
    args = ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] if GPU else []
    browser = pw.chromium.launch(executable_path=CHROME, headless=True, args=args)
    if MOBILE:
        bctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    else:
        bctx = browser.new_context(viewport={"width": 1366, "height": 900})
    page = bctx.new_page()
    page.on("console", lambda m: msgs.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: msgs.append(f"pageerror: {e}"))
    page.goto(BASE + "#/", wait_until="load")
    page.evaluate("() => localStorage.clear()")
    page.goto(BASE + "#/pelajaran/lokalisasi", wait_until="load")
    page.wait_for_function("() => window.__lokalisasi && window.__simotonom.lessonStatus === 'ready'")

    # waktu bingkai
    R["frames"] = page.evaluate("""() => new Promise((res) => {
      const t = []; let last = performance.now();
      function f(now) { t.push(now - last); last = now; if (t.length < 120) requestAnimationFrame(f); else {
        t.sort((a, b) => a - b); res({ median: +t[60].toFixed(1), p95: +t[114].toFixed(1), max: +t[119].toFixed(1) }); } }
      requestAnimationFrame(f); })""")
    R["renderer"] = page.evaluate("""() => { const c = document.createElement('canvas').getContext('webgl');
      if (!c) return 'tanpa webgl'; const d = c.getExtension('WEBGL_debug_renderer_info'); return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'tidak diketahui'; }""")

    # ke langkah 5, nyalakan pencocokan peta, tunggu mobil di Kayutangan
    page.locator('.step-dot[data-go="4"]').dispatch_event("click")
    page.wait_for_timeout(400)
    page.locator(".ctl-toggle", has_text="Pencocokan peta").first.dispatch_event("click")
    page.locator(".speed-wrap .seg-btn", has_text="2x").dispatch_event("click")
    R["kayutangan"] = wait_s(page, 170, 185)
    page.locator(".speed-wrap .seg-btn", has_text="1x").dispatch_event("click")
    page.wait_for_timeout(1500)
    shot(page, "lidar-kayutangan")
    R["lidarState"] = st(page)
    page.wait_for_timeout(2500)
    shot(page, "lidar-kayutangan-2")

    # zebra cross: munculkan penyeberang saat mobil mendekat
    page.locator(".speed-wrap .seg-btn", has_text="2x").dispatch_event("click")
    wait_s(page, 128, 134)
    page.locator(".speed-wrap .seg-btn", has_text="1x").dispatch_event("click")
    for name in ("GPS", "Fusi (filter Kalman)"):
        page.locator(".ctl-toggle", has_text=name).first.dispatch_event("click")
    R["spawn"] = page.evaluate("() => [window.__lokalisasi.spawnPedestrian(true), window.__lokalisasi.spawnPedestrian(false)]")
    t0 = time.time()
    got = False
    while time.time() - t0 < 20:
        s = st(page)
        if s["yielding"] and s["speed"] < 0.2 and "cross" in s["crossers"]:
            shot(page, "zebra-menyeberang")
            R["zebraState"] = s
            got = True
            break
        page.wait_for_timeout(100)
    R["zebraShot"] = got
    R["status"] = page.locator(".sim-status").inner_text()
    R["safety"] = page.evaluate("() => window.__lokalisasi.safety")
    R["console"] = [m for m in msgs if "GPU stall due to ReadPixels" not in m]
    browser.close()

print(json.dumps(R, indent=1, ensure_ascii=False))
