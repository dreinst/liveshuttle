"""QA mandiri: waktu frame pelajaran Kendali (desktop dan ponsel, tampilan ikuti dan seluruh lintasan,
1x dan 2x), dibandingkan antara jalur GPU headless bawaan dan SwiftShader (perangkat lunak).

Pemakaian: python3 tests/kontrol_verify_perf.py [--gpu default|metal|swiftshader]
"""
import json
import sys
import time

from kontrol_verify_util import Session

GPU = sys.argv[sys.argv.index("--gpu") + 1] if "--gpu" in sys.argv else "default"

MEASURE = """(ms) => new Promise((res) => {
  const d = []; let last = null; const t0 = performance.now();
  function f(t) { if (last != null) d.push(t - last); last = t; if (t - t0 < ms) requestAnimationFrame(f); else {
    d.sort((a, b) => a - b); const q = (p) => d[Math.min(d.length - 1, Math.floor(p * d.length))];
    res({ frames: d.length, fps: +(1000 * d.length / (t - t0)).toFixed(1), p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), max: +d[d.length - 1].toFixed(1) }); } }
  requestAnimationFrame(f);
})"""

RENDERER = """() => { try { const c = document.createElement('canvas'); const gl = c.getContext('webgl');
  const ext = gl && gl.getExtension('WEBGL_debug_renderer_info'); return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : (gl ? 'webgl tanpa info' : 'tanpa webgl'); } catch (e) { return String(e); } }"""

out = {}
for mobile in (False, True):
    with Session(mobile=mobile, gpu=None if GPU == "default" else GPU) as s:
        s.open_lesson()
        rend = s.page.evaluate(RENDERER)
        time.sleep(2)
        res = {}
        for view in ("Ikuti mobil", "Seluruh lintasan"):
            s.click_text(".lesson-kontrol .seg-btn", view)
            for sp in ("1x", "2x"):
                s.speed(sp)
                time.sleep(0.8)
                res[f"{view} {sp}"] = s.page.evaluate(MEASURE, 5000)
        # skenario berat: Ld 2 pada 50 km/jam (pengawas menghitung ke depan hampir tiap langkah), 2x
        s.click_text(".lesson-kontrol .seg-btn", "Ikuti mobil")
        s.set_slider("Lookahead Ld", 2)
        s.set_slider("Kecepatan target", 50)
        s.speed("2x")
        time.sleep(1)
        res["Ld 2, 50 km/jam, 2x"] = s.page.evaluate(MEASURE, 6000)
        key = "ponsel" if mobile else "desktop"
        out[key] = {"renderer": rend, **res}
        print(key, rend, flush=True)
        for k, v in res.items():
            print(f"  {k:28s} {json.dumps(v)}", flush=True)
        print("  msgs:", s.msgs, flush=True)
