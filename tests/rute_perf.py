"""Ukur kelancaran pelajaran Perencanaan Rute (waktu antarframe dan waktu render per frame).

Skenario: animasi Dijkstra 3.000 node/detik, mobil melaju dengan kamera mengikuti (percepatan 30 kali,
shell 2x) dan mobil melaju di peta jauh. Desktop 1366x900, dan ponsel 390x844 dengan CPU diperlambat
4 kali lewat CDP (perkiraan kasar ponsel kelas menengah). Dijalankan tiga kali: headless bawaan (di Mac
ini sudah memakai ANGLE Metal), headless dengan bendera GPU (--use-angle=metal --enable-gpu), dan
alur perangkat lunak SwiftShader tanpa kanvas 2D berakselerasi.

Pemakaian: python3 tests/serve.py 8245 (di latar), lalu python3 tests/rute_perf.py
"""
import json
import sys

sys.path.insert(0, "/Users/mcdonny/Downloads/ndur/driverless-sim/tests")
from rute_util import Session  # noqa: E402

MEASURE = """(ms) => new Promise((resolve) => {
  const gaps = [];
  let last = performance.now();
  const t0 = last;
  const f = (now) => {
    gaps.push(now - last);
    last = now;
    if (now - t0 < ms) requestAnimationFrame(f);
    else {
      gaps.sort((a, b) => a - b);
      const q = (p) => gaps[Math.min(gaps.length - 1, Math.floor(p * gaps.length))];
      resolve({ frames: gaps.length, fps: gaps.length / (ms / 1000), p50: q(0.5), p95: q(0.95), max: gaps[gaps.length - 1], long: gaps.filter((g) => g > 50).length });
    }
  };
  requestAnimationFrame(f);
})"""


def measure(S, label, ms=4000):
    r = S.page.evaluate(MEASURE, ms)
    print(f"   {label:38s} fps {r['fps']:5.1f}  p50 {r['p50']:5.1f} ms  p95 {r['p95']:5.1f} ms  maks {r['max']:6.1f} ms  frame > 50 ms: {r['long']}")
    return r


def run(mobile, mode):
    tag = f"{'ponsel (CPU 4x lebih lambat)' if mobile else 'desktop'}, {mode}"
    print(f"== {tag}")
    out = {}
    with Session(mobile=mobile, gpu=mode == "gpu", swiftshader=mode == "swiftshader") as S:
        p = S.page
        S.go()
        if mobile:
            cdp = S.ctx.new_cdp_session(p)
            cdp.send("Emulation.setCPUThrottlingRate", {"rate": 4})
        renderer = p.evaluate("() => { const c = document.createElement('canvas').getContext('webgl'); const d = c && c.getExtension('WEBGL_debug_renderer_info'); return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'tanpa WebGL'; }")
        print("   renderer:", renderer)
        S.scroll_stage()
        out["idle"] = measure(S, "peta diam", 2500)
        S.seg("Dijkstra")
        p.locator(".ctl-slider input[type=range]").first.fill("3000")
        S.click_button("Cari rute")
        out["search"] = measure(S, "animasi Dijkstra 3.000 node/detik", 3000)
        S.wait_until("() => !window.__rute.snapshot().searching", 60000)
        S.goto_step(4)
        S.seg("30 kali")
        p.locator(".speed-wrap .seg-btn").nth(2).click()
        S.click_button("Jalankan mobil")
        p.wait_for_timeout(300)
        out["overview"] = measure(S, "melaju, peta jauh (30 kali, 2x)", 3000)
        p.locator('button[aria-label="Ikuti mobil"]').click()
        out["follow"] = measure(S, "melaju, kamera mengikuti", 4000)
        S.shot(f"perf-{'mobile' if mobile else 'desktop'}-{mode}", selector=".stage")
        if S.errors:
            print("   galat:", S.errors[:3])
    return out


if __name__ == "__main__":
    res = {}
    for mode in ("bawaan", "gpu", "swiftshader"):
        for mobile in (False, True):
            res[f"{'m' if mobile else 'd'}-{mode}"] = run(mobile, mode)
    print(json.dumps({k: {kk: round(vv["fps"], 1) for kk, vv in v.items()} for k, v in res.items()}))
