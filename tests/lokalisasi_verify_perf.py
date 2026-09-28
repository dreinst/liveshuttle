"""Waktu bingkai pelajaran Lokalisasi (langkah pencocokan peta, LiDAR menyala, 2x).

Membandingkan Chrome headless bawaan, jalur GPU (--use-angle=metal) dan SwiftShader, lalu
melaporkan renderer WebGL yang dipakai (penanda jalur grafis) dan median, p95 selang bingkai.
Pemakaian: python3 tests/lokalisasi_verify_perf.py
"""
import json

from lokalisasi_verify_util import sync_playwright, CHROME, new_page, open_lesson, go_step, toggle, press, console

MODES = {
    "bawaan": [],
    "metal": ["--use-angle=metal", "--enable-gpu"],
    "swiftshader": ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
}
R = {}
with sync_playwright() as pw:
    for name, args in MODES.items():
        br = pw.chromium.launch(executable_path=CHROME, headless=True, args=args)
        for mobile in (False, True):
            page = new_page(br, mobile)
            open_lesson(page)
            go_step(page, 4)
            toggle(page, "Pencocokan peta (LiDAR)")
            press(page, page.locator(".speed-wrap .seg-btn", has_text="2x"))
            page.wait_for_timeout(3000)
            res = page.evaluate("""() => new Promise((done) => {
                const gl = document.createElement('canvas').getContext('webgl');
                const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
                const renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : (gl ? 'webgl' : 'tanpa webgl');
                const d = []; let last = performance.now(); const t0 = last;
                function f(t) { d.push(t - last); last = t; if (t - t0 < 5000) requestAnimationFrame(f); else {
                    d.sort((a, b) => a - b);
                    done({ renderer, frames: d.length, median: +d[Math.floor(d.length / 2)].toFixed(1), p95: +d[Math.floor(d.length * 0.95)].toFixed(1), max: +d[d.length - 1].toFixed(1) });
                } }
                requestAnimationFrame(f);
            })""")
            res["console"] = console(page)
            R[f"{name}-{'mobile' if mobile else 'desktop'}"] = res
            page.context.close()
        br.close()
print(json.dumps(R, indent=1, ensure_ascii=False))
