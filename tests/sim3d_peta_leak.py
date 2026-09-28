"""Pasang dan lepas simulator berulang kali: tidak boleh ada galat, konteks WebGL harus dilepas,
dan jumlah elemen DOM kembali seperti semula. Juga uji mode tanpa WebGL."""
import time

from sim3d_peta_common import BASE, CHROME, launch, new_page, snap, sync_playwright

with sync_playwright() as p:
    b = launch(p, "swift")
    ctx, page, log = new_page(b)
    page.goto(f"{BASE}/tests/sim3d_harness.html?mode=panduan")
    page.wait_for_function("() => window.__sim3d && window.__sim3d.ready", timeout=90000)
    base_nodes = None
    for i in range(6):
        page.evaluate("() => window.__harness.destroy()")
        n0 = page.evaluate("() => document.getElementsByTagName('*').length")
        links = page.evaluate("() => document.querySelectorAll('link[data-sim3d]').length")
        hook = page.evaluate("() => typeof window.__sim3d")
        if base_nodes is None:
            base_nodes = n0
        print(f"lepas #{i}: elemen={n0} link css={links} window.__sim3d={hook}")
        page.evaluate("() => window.__harness.mount(%s)" % ("'jelajah'" if i % 2 else "'panduan'"))
        page.wait_for_function("() => window.__sim3d && window.__sim3d.ready", timeout=90000)
        time.sleep(1)
        s = snap(page)
        print(f"pasang #{i}: mode={s['mode']} canvas={page.evaluate('() => document.querySelectorAll(\"canvas.s3d-canvas\").length')}")
    mem = page.evaluate("() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : -1")
    print("heap MB", mem)
    print("LOG", log)
    ctx.close()
    # tanpa WebGL
    b2 = p.chromium.launch(executable_path=CHROME, headless=True, args=["--disable-webgl", "--disable-webgl2", "--disable-3d-apis"])
    ctx2 = b2.new_context(viewport={"width": 1366, "height": 900})
    page2 = ctx2.new_page()
    errs = []
    page2.on("pageerror", lambda e: errs.append(str(e)))
    page2.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    page2.goto(f"{BASE}/tests/sim3d_harness.html?mode=panduan")
    time.sleep(4)
    txt = page2.evaluate("() => (document.querySelector('.s3d-failbox') || {}).innerText || ''")
    print("tanpa WebGL:", txt.replace("\n", " | ")[:300])
    page2.screenshot(path="shots/peta/nowebgl.png")
    print("errs", errs)
    b2.close()
    b.close()
