"""QA waktu muat: dari navigasi sampai simulator siap, dan tugas panjang (long task) di utas utama saat init."""
import time
from playwright.sync_api import sync_playwright
from sim3d_qa_tampilan_common import BASE, launch, new_page, wait_ready

INIT = """
window.__lt = [];
try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: true }); } catch (e) {}
"""
with sync_playwright() as p:
    b = launch(p)
    for mobile in [False, True]:
        ctx, page, log = new_page(b, mobile=mobile)
        page.add_init_script(INIT)
        page.goto(f"{BASE}/index.html#/")
        page.wait_for_load_state("networkidle")
        t0 = time.time()
        page.evaluate("() => { location.hash = '#/simulator/tutorial'; }")
        wait_ready(page)
        dt = time.time() - t0
        time.sleep(1)
        print("mobile" if mobile else "desktop", "siap dalam", round(dt, 2), "detik; long tasks (ms):", page.evaluate("() => window.__lt"))
        # pindah mode tanpa muat ulang dan kembali ke beranda (destroy)
        ctx.close()
    b.close()
