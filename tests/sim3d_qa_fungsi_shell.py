"""Integrasi shell: rute nyata, keluar ke beranda dan kembali 5 kali. Hitung konteks WebGL, laju rAF,
listener di window/document, node DOM, dan heap. Juga uji jeda saat tab tersembunyi."""
import time
from sim3d_qa_fungsi_util import BASE, launch, new_page, snap, wait_ready, shot, dump, sync_playwright

INIT = r"""
(() => {
  const ctxs = [];
  window.__glctx = ctxs;
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const c = orig.call(this, type, ...rest);
    if (c && /webgl/.test(type) && !ctxs.includes(c)) ctxs.push(c);
    return c;
  };
  let n = 0;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((t) => { n++; cb(t); });
  window.__rafCount = () => n;
})();
"""


def measure(page, cdp):
    r0 = page.evaluate("window.__rafCount()")
    time.sleep(1.0)
    r1 = page.evaluate("window.__rafCount()")
    cdp.send("HeapProfiler.collectGarbage")
    time.sleep(0.2)
    dom = cdp.send("Memory.getDOMCounters")
    gl = page.evaluate("() => ({ total: window.__glctx.length, live: window.__glctx.filter(c => !c.isContextLost()).length })")
    win = cdp.send("Runtime.evaluate", {"expression": "window"})["result"]["objectId"]
    docu = cdp.send("Runtime.evaluate", {"expression": "document"})["result"]["objectId"]
    lw = cdp.send("DOMDebugger.getEventListeners", {"objectId": win})["listeners"]
    ld = cdp.send("DOMDebugger.getEventListeners", {"objectId": docu})["listeners"]
    heap = page.evaluate("() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e5) / 10 : 0")
    extra = page.evaluate("() => ({ links: document.querySelectorAll('link[data-sim3d]').length, roots: document.querySelectorAll('.s3d').length, canvases: document.querySelectorAll('canvas').length, hook: typeof window.__sim3d, activeLoops: window.__simotonom ? window.__simotonom.activeLoops : null })")
    return {"rafPerSec": r1 - r0, "gl": gl, "winL": len(lw), "docL": len(ld), "winTypes": sorted(set(l["type"] for l in lw)), "nodes": dom["nodes"], "listeners": dom["jsEventListeners"], "heapMB": heap, **extra}


with sync_playwright() as p:
    b = launch(p, ["--enable-precise-memory-info"])
    ctx, page, log = new_page(b, init_script=INIT)
    cdp = ctx.new_cdp_session(page)
    page.goto(f"{BASE}/#/")
    time.sleep(2)
    base = measure(page, cdp)
    print("beranda awal", base)
    rows = []
    for i in range(5):
        mode = "tutorial" if i % 2 == 0 else "bebas"
        # lewat tombol di beranda
        sel = f"a[href='#/simulator/{mode}']"
        page.locator(sel).last.click()
        wait_ready(page)
        time.sleep(1.5)
        # sedikit interaksi
        page.evaluate("() => document.activeElement && document.activeElement.blur()")
        page.keyboard.press("o")
        page.keyboard.press("2")
        time.sleep(0.5)
        inside = measure(page, cdp)
        s = snap(page)
        # kembali ke beranda lewat header
        page.click("a.nav-link[href='#/']")
        time.sleep(1.5)
        out = measure(page, cdp)
        rows.append((i + 1, mode, s["mode"], inside, out))
        print(f"siklus {i+1} {mode}: di simulator", inside)
        print(f"   di beranda", out)
    shot(page, "shell_home_after.png")
    # jeda saat tab tersembunyi (simulasikan visibilitychange)
    page.goto(f"{BASE}/#/simulator/bebas")
    wait_ready(page)
    time.sleep(1)
    t0 = snap(page)["simTime"]
    r0 = page.evaluate("window.__rafCount()")
    page.evaluate("() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); }")
    time.sleep(1.5)
    t1 = snap(page)["simTime"]
    r1 = page.evaluate("window.__rafCount()")
    page.evaluate("() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); }")
    time.sleep(1.0)
    t2 = snap(page)["simTime"]
    print("tersembunyi: simTime maju", round(t1 - t0, 2), "rAF selama 1,5 s", r1 - r0, "; setelah terlihat lagi maju", round(t2 - t1, 2))
    # tautan header Simulator 3D saat di Mode Bebas (hash bebas): apakah dipasang ulang?
    page.evaluate("() => window.__mark = 1")
    before = snap(page)["simTime"]
    page.click("a.nav-link[data-nav=sim]")
    time.sleep(0.3)
    try:
        wait_ready(page)
    except Exception as e:
        print("tidak siap", e)
    time.sleep(0.5)
    s = snap(page)
    print("klik header Simulator 3D dari bebas:", s["mode"], "simTime sebelum", round(before, 1), "sesudah", round(s["simTime"], 1), "hash", page.evaluate("location.hash"), "gl", page.evaluate("() => window.__glctx.filter(c => !c.isContextLost()).length"))
    # mode bebas lewat tab di tutorial, lalu tombol kembali browser
    page.click(".s3d-modes button[data-mode=bebas]")
    time.sleep(0.5)
    print("tab bebas: hash", page.evaluate("location.hash"), "history.length", page.evaluate("history.length"))
    page.go_back()
    time.sleep(1.5)
    print("setelah back:", page.evaluate("location.hash"), page.evaluate("() => document.querySelectorAll('.s3d').length"))
    page.go_forward()
    try:
        wait_ready(page)
        time.sleep(0.5)
        print("setelah forward:", page.evaluate("location.hash"), snap(page)["mode"])
    except Exception as e:
        print("forward tidak siap", e)
    print("LOG", log, "resets", len(page.resets))
    b.close()
