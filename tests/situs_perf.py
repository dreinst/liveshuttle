"""Ukur waktu antarframe (requestAnimationFrame) di beranda dan satu pelajaran, jalur GPU vs SwiftShader.

Pemakaian: python3 tests/situs_perf.py
"""

import json

from situs_util import BASE, GPU, SWIFTSHADER, browser, new_page

MEASURE = """() => new Promise((resolve) => {
  const t = []; let last = performance.now(); const end = last + 3000;
  const tick = (now) => { t.push(now - last); last = now; if (now < end) requestAnimationFrame(tick); else {
    t.sort((a, b) => a - b); const avg = t.reduce((a, b) => a + b, 0) / t.length;
    resolve({ frames: t.length, avgMs: +avg.toFixed(2), p95Ms: +t[Math.floor(t.length * 0.95)].toFixed(2), maxMs: +t[t.length - 1].toFixed(2) }); } };
  requestAnimationFrame(tick);
})"""

out = {}
for name, args in (("gpu-metal", GPU), ("swiftshader", SWIFTSHADER)):
    with browser(args) as b:
        for mobile in (False, True):
            ctx, page, con = new_page(b, mobile)
            tag = f"{name}-{'m' if mobile else 'd'}"
            page.goto(BASE + "#/", wait_until="load")
            page.wait_for_timeout(2000)
            gl = page.evaluate("() => { const c = document.createElement('canvas').getContext('webgl'); const d = c && c.getExtension('WEBGL_debug_renderer_info'); return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : null; }")
            home = page.evaluate(MEASURE)
            page.goto(BASE + "#/pelajaran/shuttle", wait_until="load")
            page.wait_for_function("() => window.__simotonom.lessonStatus === 'ready'", timeout=20000)
            page.wait_for_timeout(1000)
            lesson = page.evaluate(MEASURE)
            out[tag] = {"renderer": gl, "home": home, "lesson-shuttle": lesson, **con.summary()}
            ctx.close()
print(json.dumps(out, indent=1))
