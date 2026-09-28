"""Jejak rinci mengemudi manual: kenapa mobil berhenti walaupun gas ditekan."""
import time
from sim3d_qa_fungsi_util import BASE, launch, new_page, snap, wait_ready, shot, dump, sync_playwright

TR = """() => { const s = window.__sim3d; return { t: +s.simTime.toFixed(2), x: +s.ego.x.toFixed(1), z: +s.ego.z.toFixed(1), h: +s.ego.heading.toFixed(2), v: +s.ego.speedKmh.toFixed(1), beh: s.ego.behavior, aeb: s.ego.aeb, ttc: s.ego.ttc && +s.ego.ttc.toFixed(2), lim: s.ego.limiter, gas: document.querySelector('.is-gas .s3d-bar-val').textContent, rem: document.querySelector('.is-brake .s3d-bar-val').textContent, col: s.counters.collisions, aebc: s.counters.aebAuto, toast: [...document.querySelectorAll('.s3d-toast')].map(t => t.textContent).slice(-1)[0] }; }"""

with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b)
    page.goto(f"{BASE}/#/simulator/bebas")
    wait_ready(page)
    time.sleep(1.5)
    page.evaluate("() => document.activeElement && document.activeElement.blur()")
    page.keyboard.press("m")
    time.sleep(0.3)
    page.keyboard.down("ArrowUp")
    for i in range(40):
        r = page.evaluate(TR)
        if i % 2 == 0:
            print(r)
        if i == 20:
            shot(page, "manual_trace_mid.png")
        time.sleep(0.2)
    page.keyboard.up("ArrowUp")
    print("--- kanan + gas")
    page.keyboard.down("ArrowUp")
    page.keyboard.down("ArrowRight")
    for i in range(30):
        r = page.evaluate(TR)
        if i % 3 == 0:
            print(r)
        time.sleep(0.2)
    page.keyboard.up("ArrowRight")
    page.keyboard.up("ArrowUp")
    shot(page, "manual_trace_end.png")
    print("debug", snap(page)["debug"][-5:])
    print("LOG", log)
    b.close()
