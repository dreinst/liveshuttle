"""Uji lewat rute asli: #/simulator/tutorial dan #/simulator/bebas di index.html (js/main.js)."""
import sys
import time

from sim3d_common import BASE, launch, new_page, snap, wait_ready, wait_until, shot, sync_playwright

mobile = len(sys.argv) > 1 and sys.argv[1] == "mobile"
tag = "m" if mobile else "d"
with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b, mobile)
    page.goto(f"{BASE}/#/simulator/tutorial")
    s = wait_ready(page)
    time.sleep(2)
    print("mode", s["mode"], "size", s["render"]["width"], s["render"]["height"])
    shot(page, f"route_{tag}_tutorial.png")
    # ganti mode lewat tab di simulator
    page.click(".s3d-mode[data-mode='bebas']")
    time.sleep(1.0)
    print("setelah tab Bebas:", snap(page)["mode"], page.evaluate("() => location.hash"))
    shot(page, f"route_{tag}_bebas_tab.png")
    # tautan header ke simulator tutorial (tanpa pasang ulang)
    page.evaluate("() => { location.hash = '#/simulator/tutorial'; }")
    time.sleep(1.0)
    print("setelah hash tutorial:", snap(page)["mode"])
    # pindah ke beranda: simulator harus dibongkar
    page.evaluate("() => { location.hash = '#/'; }")
    time.sleep(1.5)
    info = page.evaluate("() => ({ hook: typeof window.__sim3d, canvases: document.querySelectorAll('.s3d canvas').length, links: document.querySelectorAll('link[data-sim3d]').length })")
    print("di beranda:", info)
    shot(page, f"route_{tag}_home.png")
    # kembali ke simulator bebas
    page.evaluate("() => { location.hash = '#/simulator/bebas'; }")
    s = wait_ready(page)
    time.sleep(1.5)
    print("kembali:", s["mode"])
    shot(page, f"route_{tag}_bebas.png")
    print("LOG:", "\n".join(log[:30]) or "(kosong)")
    b.close()
