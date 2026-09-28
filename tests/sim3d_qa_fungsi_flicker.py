"""Seberapa sering label perilaku berganti selama satu kali menyalip (sampel 50 ms, teks di HUD)."""
import time
from sim3d_qa_fungsi_util import BASE, launch, new_page, snap, wait_ready, wait_until, sync_playwright

with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b)
    page.goto(f"{BASE}/#/simulator/bebas")
    wait_ready(page)
    time.sleep(1)
    page.click(".s3d-panel[data-tab=uji] .s3d-panel-head")
    for run in range(3):
        wait_until(page, lambda s: s["ego"]["behavior"] == "Melaju" and s["ego"]["speedKmh"] > 25 and s["traffic"]["obstacles"] == 0, timeout=40)
        s0 = snap(page)
        page.click(".s3d-obs[data-type=mogok]")
        seq = []
        t0 = time.time()
        while time.time() - t0 < 30:
            r = page.evaluate("() => { const s = window.__sim3d; return [+s.simTime.toFixed(2), document.querySelector('.s3d-badge').textContent, s.ego.behavior, s.ego.lane, s.ego.reason.slice(0, 60), s.counters.overtakes]; }")
            if not seq or seq[-1][1] != r[1] or seq[-1][3] != r[3]:
                seq.append(r)
            if r[5] > s0["counters"]["overtakes"] and time.time() - t0 > 2:
                if len([x for x in seq if x[5] > s0["counters"]["overtakes"]]) > 0 and time.time() - t0 > 3:
                    pass
            if r[5] > s0["counters"]["overtakes"] + 0 and r[3] == "kiri" and seq[-1][5] > s0["counters"]["overtakes"]:
                break
            time.sleep(0.05)
        print("run", run, "perubahan label:", len(seq))
        for x in seq:
            print("   ", x)
        page.click(".s3d-panel[data-tab=uji] button:has-text('Hapus rintangan')")
        time.sleep(1)
    b.close()
