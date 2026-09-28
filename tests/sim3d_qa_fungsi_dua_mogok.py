"""Dua mobil mogok berurutan di lajur kiri (tombol Mobil mogok ditekan dua kali dengan jeda). Apakah mobil otonom macet?"""
import sys
import time
from sim3d_qa_fungsi_util import BASE, launch, new_page, snap, wait_ready, wait_until, shot, sync_playwright


def toasts(page):
    return page.evaluate("() => [...document.querySelectorAll('.s3d-toast')].map(t => t.textContent)")


gaps = [float(x) for x in sys.argv[1:]] or [1.0, 2.0, 3.0]
with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b)
    page.goto(f"{BASE}/#/simulator/bebas")
    wait_ready(page)
    time.sleep(1)
    page.click(".s3d-panel[data-tab=uji] .s3d-panel-head")
    for g in gaps:
        s = wait_until(page, lambda s: s["ego"]["behavior"] == "Melaju" and s["ego"]["speedKmh"] > 25 and s["traffic"]["obstacles"] == 0 and s["ego"]["lane"] == "kiri", timeout=60)
        s0 = snap(page)
        page.click(".s3d-obs[data-type=mogok]")
        t1 = toasts(page)[-1:]
        time.sleep(g)
        page.click(".s3d-obs[data-type=mogok]")
        t2 = toasts(page)[-1:]
        t0 = time.time()
        still = 0
        last = None
        worst = None
        while time.time() - t0 < 60:
            s = snap(page)
            if s["ego"]["speedKmh"] < 0.5:
                still += 0.5
                if still >= 20 and worst is None:
                    worst = (s["ego"]["behavior"], s["ego"]["reason"], s["ego"]["limiter"], s["ego"]["lane"], s["ego"]["plan"])
                    shot(page, f"dua_mogok_{g}.png")
            else:
                still = 0
            if s["counters"]["overtakes"] - s0["counters"]["overtakes"] >= 2 and s["ego"]["lane"] == "kiri":
                break
            time.sleep(0.5)
        s = snap(page)
        print(f"jeda {g}s:", t1, t2, "| menyalip +", s["counters"]["overtakes"] - s0["counters"]["overtakes"], "| diam terlama", still, "s nyata | tabrakan +", s["counters"]["collisions"] - s0["counters"]["collisions"], "| waktu", round(time.time() - t0), "s")
        if worst:
            print("   MACET:", worst)
        page.click(".s3d-panel[data-tab=uji] button:has-text('Hapus rintangan')")
        time.sleep(2)
    print("LOG", log)
    b.close()
