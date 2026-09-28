"""Uji kebocoran: destroy() lalu mount() lima kali. Bandingkan jumlah node DOM, listener, dan memori JS."""
import time

from sim3d_common import BASE, launch, new_page, snap, wait_ready, sync_playwright


def counters(page, cdp):
    cdp.send("HeapProfiler.collectGarbage")
    time.sleep(0.3)
    cdp.send("HeapProfiler.collectGarbage")
    dom = cdp.send("Memory.getDOMCounters")
    heap = page.evaluate("() => performance.memory ? performance.memory.usedJSHeapSize : 0")
    extra = page.evaluate("""() => ({
      canvases: document.querySelectorAll('canvas').length,
      links: document.querySelectorAll('link[data-sim3d]').length,
      roots: document.querySelectorAll('.s3d').length,
      hook: typeof window.__sim3d,
    })""")
    return {"nodes": dom["nodes"], "listeners": dom["jsEventListeners"], "docs": dom["documents"], "heapMB": round(heap / 1e6, 1), **extra}


with sync_playwright() as p:
    b = launch(p, ["--enable-precise-memory-info", "--js-flags=--expose-gc"])
    ctx, page, log = new_page(b)
    cdp = ctx.new_cdp_session(page)
    page.goto(f"{BASE}/tests/sim3d_harness.html?mode=tutorial")
    wait_ready(page)
    time.sleep(2)
    page.evaluate("() => window.__harness.destroy()")
    base = counters(page, cdp)
    print("setelah destroy pertama", base)
    rows = []
    for i in range(int(__import__("sys").argv[1]) if len(__import__("sys").argv) > 1 else 5):
        mode = "bebas" if i % 2 == 0 else "tutorial"
        page.evaluate(f"() => window.__harness.mount('{mode}')")
        wait_ready(page)
        time.sleep(2.0)
        s = snap(page)
        mounted = counters(page, cdp)
        page.evaluate("() => window.__harness.destroy()")
        time.sleep(0.3)
        after = counters(page, cdp)
        rows.append((i + 1, mode, s["mode"], s["render"]["calls"], mounted["nodes"], after))
        print("siklus", i + 1, mode, "calls", s["render"]["calls"], "terpasang", mounted, "sesudah", after)
    final = rows[-1][-1]
    print("SELISIH node", final["nodes"] - base["nodes"], "listener", final["listeners"] - base["listeners"], "heapMB", round(final["heapMB"] - base["heapMB"], 1))
    print("LOG:", "\n".join(log[:30]) or "(kosong)")
    b.close()
