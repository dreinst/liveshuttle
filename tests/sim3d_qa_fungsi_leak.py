"""Harness tanpa shell: mount lalu destroy 6 kali. Hitung node DOM, listener, heap, konteks WebGL hidup."""
import time
from sim3d_qa_fungsi_util import BASE, launch, new_page, snap, wait_ready, sync_playwright

INIT = r"""(() => { const ctxs = []; window.__glctx = ctxs; const orig = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (t, ...r) { const c = orig.call(this, t, ...r); if (c && /webgl/.test(t) && !ctxs.includes(c)) ctxs.push(c); return c; }; })();"""

with sync_playwright() as p:
    b = launch(p, ["--enable-precise-memory-info"])
    ctx, page, log = new_page(b, init_script=INIT)
    cdp = ctx.new_cdp_session(page)
    page.goto(f"{BASE}/tests/sim3d_harness.html?mode=tutorial")
    wait_ready(page)
    time.sleep(1)
    page.evaluate("() => window.__harness.destroy()")

    def m():
        cdp.send("HeapProfiler.collectGarbage")
        time.sleep(0.3)
        cdp.send("HeapProfiler.collectGarbage")
        d = cdp.send("Memory.getDOMCounters")
        gl = page.evaluate("() => window.__glctx.filter(c => !c.isContextLost()).length")
        h = page.evaluate("() => Math.round(performance.memory.usedJSHeapSize / 1e5) / 10")
        return (d["nodes"], d["jsEventListeners"], h, gl)

    print("awal", m())
    for i in range(6):
        page.evaluate(f"() => window.__harness.mount('{'bebas' if i % 2 else 'tutorial'}')")
        wait_ready(page)
        time.sleep(1.0)
        page.evaluate("() => window.__harness.destroy()")
        time.sleep(0.3)
        print("siklus", i + 1, m())
    time.sleep(5)
    print("5 detik kemudian", m())
    print("LOG", log)
    b.close()
