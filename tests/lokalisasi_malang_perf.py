"""Waktu bingkai pelajaran Lokalisasi di langkah terberat (pencocokan peta dan titik LiDAR menyala,
kemudi dengan estimasi, kecepatan 2x). Membandingkan Chromium headless bawaan (GPU Metal di Mac ini)
dengan SwiftShader (render perangkat lunak).

Pemakaian: python3 tests/lokalisasi_malang_perf.py [--port 8244]
"""
import json
import sys

from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
PORT = sys.argv[sys.argv.index("--port") + 1] if "--port" in sys.argv else "8244"
BASE = f"http://127.0.0.1:{PORT}/"
MODES = {
    "gpu-metal": ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
    "swiftshader": ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
}
FRAMES = """() => new Promise((res) => {
  const t = []; let last = performance.now();
  function f(now) { t.push(now - last); last = now; if (t.length < 300) requestAnimationFrame(f); else {
    t.sort((a, b) => a - b); res({ median: +t[150].toFixed(1), p95: +t[285].toFixed(1), max: +t[299].toFixed(1) }); } }
  requestAnimationFrame(f); })"""
out = {}
with sync_playwright() as pw:
    for mode, args in MODES.items():
        browser = pw.chromium.launch(executable_path=CHROME, headless=True, args=args)
        for vp in ("desktop", "mobile"):
            if vp == "mobile":
                ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
            else:
                ctx = browser.new_context(viewport={"width": 1366, "height": 900})
            page = ctx.new_page()
            page.goto(BASE + "#/", wait_until="load")
            page.evaluate("() => localStorage.clear()")
            page.goto(BASE + "#/pelajaran/lokalisasi", wait_until="load")
            page.wait_for_function("() => window.__lokalisasi && window.__simotonom.lessonStatus === 'ready'")
            page.locator('.step-dot[data-go="4"]').dispatch_event("click")
            page.wait_for_timeout(300)
            page.locator(".ctl-toggle", has_text="Pencocokan peta").first.dispatch_event("click")
            page.locator(".ctl-toggle", has_text="Kemudikan dengan estimasi").first.dispatch_event("click")
            page.locator(".speed-wrap .seg-btn", has_text="2x").dispatch_event("click")
            page.wait_for_timeout(2500)
            renderer = page.evaluate("""() => { const c = document.createElement('canvas').getContext('webgl');
              if (!c) return 'tanpa webgl'; const d = c.getExtension('WEBGL_debug_renderer_info'); return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : '?'; }""")
            out[f"{mode}/{vp}"] = {"renderer": renderer, "frames": page.evaluate(FRAMES), "lidarPoints": page.evaluate("() => window.__lokalisasi.state.lidarPoints")}
            ctx.close()
        browser.close()
print(json.dumps(out, indent=1))
