"""Ukur laju gambar pelajaran Kendali (kanvas 2D dengan peta OSM) di Chromium headless.

Membandingkan jalur bawaan headless dengan bendera GPU (--use-angle=metal --enable-gpu) dan
SwiftShader. Diukur: jumlah frame per detik (rAF) dan waktu JS terpanjang per frame, di tampilan
Ikuti mobil (peta digambar ulang ke cache tiap beberapa detik) dan Seluruh lintasan.

Pemakaian: python3 tests/kontrol_perf.py [--port 8246]
"""
import json
import sys

from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
PORT = sys.argv[sys.argv.index("--port") + 1] if "--port" in sys.argv else "8246"
MEASURE = """async (ms) => {
  let n = 0, worst = 0, last = performance.now();
  const gaps = [];
  await new Promise((res) => {
    const t0 = performance.now();
    function f(t) { const d = t - last; last = t; gaps.push(d); worst = Math.max(worst, d); n++; if (t - t0 < ms) requestAnimationFrame(f); else res(); }
    requestAnimationFrame(f);
  });
  gaps.sort((a, b) => a - b);
  return { fps: +(n / (ms / 1000)).toFixed(1), p95FrameMs: +gaps[Math.floor(gaps.length * 0.95)].toFixed(1), worstFrameMs: +worst.toFixed(1) };
}"""

MODES = {
    "headless-bawaan": [],
    "gpu-metal": ["--use-angle=metal", "--enable-gpu"],
    "swiftshader": ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
}
out = {}
with sync_playwright() as pw:
    for name, args in MODES.items():
        b = pw.chromium.launch(executable_path=CHROME, headless=True, args=args)
        for dev in ("desktop", "mobile"):
            if dev == "mobile":
                ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
            else:
                ctx = b.new_context(viewport={"width": 1366, "height": 900})
            p = ctx.new_page()
            errs = []
            p.on("console", lambda m: errs.append(m.text) if m.type in ("error", "warning") else None)
            p.goto(f"http://127.0.0.1:{PORT}/#/pelajaran/kontrol", wait_until="load")
            p.wait_for_timeout(2500)
            gpu = p.evaluate("""() => { const c = document.createElement('canvas'); const gl = c.getContext('webgl');
                if (!gl) return 'tanpa webgl'; const e = gl.getExtension('WEBGL_debug_renderer_info');
                return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'tidak diketahui'; }""")
            follow = p.evaluate(MEASURE, 5000)
            p.locator(".seg-btn", has_text="2x").first.dispatch_event("click")
            follow2x = p.evaluate(MEASURE, 5000)
            p.locator(".seg-btn", has_text="Seluruh lintasan").dispatch_event("click")
            p.wait_for_timeout(500)
            overview = p.evaluate(MEASURE, 5000)
            out[f"{name}/{dev}"] = {"renderer": gpu, "ikuti_1x": follow, "ikuti_2x": follow2x, "seluruh_2x": overview, "errors": errs}
            ctx.close()
        b.close()
print(json.dumps(out, indent=1, ensure_ascii=False))
