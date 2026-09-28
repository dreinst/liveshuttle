"""QA kinerja: waktu antarbingkai (selisih requestAnimationFrame selama 10 detik) per kualitas,
draw call dan segitiga (renderer.info), rasio piksel pada layar DPR 2, dan jeda saat tab tersembunyi.
Pemakaian: python3 sim3d_qa_tampilan_perf.py [gpu|swift] [throttle]"""
import sys
import time

from playwright.sync_api import sync_playwright

from sim3d_qa_tampilan_common import BASE, launch, new_page, snap, wait_ready, dump

SWIFT = len(sys.argv) > 1 and sys.argv[1] == "swift"
THROTTLE = int(sys.argv[2]) if len(sys.argv) > 2 else 0

RAF_JS = r"""
(ms) => new Promise((resolve) => {
  const d = [];
  let last = performance.now();
  const t0 = last;
  let longTasks = 0;
  let po = null;
  try { po = new PerformanceObserver((l) => { longTasks += l.getEntries().length; }); po.observe({ type: 'longtask', buffered: false }); } catch (e) {}
  const f = (now) => {
    d.push(now - last);
    last = now;
    if (now - t0 < ms) requestAnimationFrame(f);
    else {
      if (po) po.disconnect();
      d.shift();
      const s = d.slice().sort((a, b) => a - b);
      const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
      const mean = d.reduce((a, b) => a + b, 0) / d.length;
      const r = window.__sim3d.render;
      resolve({ frames: d.length, meanMs: +mean.toFixed(2), p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), p99: +q(0.99).toFixed(2), max: +s[s.length - 1].toFixed(2), over33: d.filter((x) => x > 33.4).length, longTasks, calls: r.calls, triangles: r.triangles, pixelRatio: r.pixelRatio, canvas: [r.width, r.height] });
    }
  };
  requestAnimationFrame(f);
})
"""

with sync_playwright() as p:
    b = launch(p, swift=SWIFT)
    ctx, page, log = new_page(b)
    page.goto(f"{BASE}/index.html#/simulator/bebas")
    wait_ready(page)
    gl = page.evaluate("() => { const c = document.createElement('canvas'); const g = c.getContext('webgl2'); const e = g && g.getExtension('WEBGL_debug_renderer_info'); return g ? (e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'webgl2') : 'none'; }")
    print("GL renderer:", gl, "throttle", THROTTLE)
    if THROTTLE:
        cdp = ctx.new_cdp_session(page)
        cdp.send("Emulation.setCPUThrottlingRate", {"rate": THROTTLE})
    time.sleep(2)
    for wx in ["cerah", "hujan", "malam"]:
        page.click(f".s3d-top [aria-label='Cuaca'] [data-value='{wx}']")
        for q in ["hemat", "standar", "tinggi"]:
            page.select_option(".s3d-select", q)
            time.sleep(1.0)
            r = page.evaluate(RAF_JS, 10000)
            print(wx, q, r)
    # kamera atas di malam tinggi (paling banyak objek di layar)
    page.keyboard.press("3")
    time.sleep(1.5)
    print("malam tinggi atas", page.evaluate(RAF_JS, 5000))
    page.keyboard.press("2")

    # tab tersembunyi: buka tab lain di depan lalu lihat apakah simTime berhenti
    s0 = snap(page)["simTime"]
    p2 = ctx.new_page()
    p2.goto("about:blank")
    p2.bring_to_front()
    time.sleep(0.5)
    hidden = page.evaluate("() => document.hidden")
    s1 = snap(page)["simTime"]
    time.sleep(3)
    s2 = snap(page)["simTime"]
    print("hidden", hidden, "simTime maju saat tersembunyi:", round(s2 - s1, 2))
    page.bring_to_front()
    time.sleep(1.5)
    s3 = snap(page)["simTime"]
    print("simTime maju setelah kembali:", round(s3 - s2, 2))
    print("logs", log)
    ctx.close()

    # DPR 2: batas rasio piksel 1,5
    ctx = b.new_context(viewport={"width": 1366, "height": 900}, device_scale_factor=2)
    page = ctx.new_page()
    page.goto(f"{BASE}/index.html#/simulator/bebas")
    wait_ready(page)
    for q in ["hemat", "standar", "tinggi"]:
        page.select_option(".s3d-select", q)
        time.sleep(0.8)
        info = page.evaluate("() => { const c = document.querySelector('.s3d-canvas'); return { pr: window.__sim3d.render.pixelRatio, w: c.width, h: c.height, cssW: c.clientWidth }; }")
        print("DPR2", q, info)
    ctx.close()
    b.close()
