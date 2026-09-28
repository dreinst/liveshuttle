"""Ukur laju bingkai di tiap kamera. Pemakaian: python3 sim3d_peta_perf.py [swift|gpu]"""
import sys
import time

from sim3d_peta_common import launch, new_page, open_harness, snap, sync_playwright

mode = sys.argv[1] if len(sys.argv) > 1 else "gpu"
with sync_playwright() as p:
    b = launch(p, mode)
    ctx, page, log = new_page(b)
    open_harness(page, "jelajah")
    info = page.evaluate("""() => { const c = document.createElement('canvas'); const gl = c.getContext('webgl2'); const e = gl && gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'tidak diketahui'; }""")
    print("renderer", info)
    time.sleep(3)
    for key, name in [("2", "drone"), ("1", "kabin"), ("3", "sinematik"), ("4", "peta")]:
        page.keyboard.press(key)
        time.sleep(1.5)
        f0 = page.evaluate("() => performance.now()")
        n0 = page.evaluate("() => new Promise(r => { let n = 0; const t0 = performance.now(); function f() { n++; if (performance.now() - t0 < 4000) requestAnimationFrame(f); else r(n / ((performance.now() - t0) / 1000)); } requestAnimationFrame(f); })")
        s = snap(page)
        print(f"{name:10} rAF fps {n0:5.1f}  sim fps {s['render']['fps']:5.1f} frameMs {s['render']['frameMs']:5.1f} calls {s['render']['calls']} tris {s['render']['triangles']} ratio {s['render']['pixelRatio']}")
    print("LOG", log)
    b.close()
