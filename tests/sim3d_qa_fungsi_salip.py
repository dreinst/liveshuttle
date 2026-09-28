"""Menyalip tiap jenis rintangan: penghitung Menyalip naik tepat satu per rintangan, tanpa tabrakan."""
import time
from sim3d_qa_fungsi_util import BASE, launch, new_page, snap, wait_ready, wait_until, shot, dump, sync_playwright

with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b)
    page.goto(f"{BASE}/#/simulator/bebas")
    wait_ready(page)
    time.sleep(1)
    page.click(".s3d-panel[data-tab=uji] .s3d-panel-head")
    rows = []
    for t in ["kerucut", "kardus", "mogok", "kerucut", "mogok"]:
        wait_until(page, lambda s: s["ego"]["behavior"] == "Melaju" and s["ego"]["speedKmh"] > 20 and s["traffic"]["obstacles"] == 0, timeout=40)
        s0 = snap(page)
        page.click(f".s3d-obs[data-type={t}]")
        t0 = time.time()
        behs = []
        ov_at = None
        while time.time() - t0 < 45:
            s = snap(page)
            if not behs or behs[-1] != s["ego"]["behavior"]:
                behs.append(s["ego"]["behavior"])
            if s["counters"]["overtakes"] > s0["counters"]["overtakes"] and ov_at is None:
                ov_at = round(time.time() - t0, 1)
                time.sleep(4)
                break
            time.sleep(0.2)
        s = snap(page)
        rows.append((t, "overtake+", s["counters"]["overtakes"] - s0["counters"]["overtakes"], "t", ov_at, "col+", s["counters"]["collisions"] - s0["counters"]["collisions"], "aeb+", s["counters"]["aebAuto"] - s0["counters"]["aebAuto"], "lane", s["ego"]["lane"], behs))
        page.click(".s3d-panel[data-tab=uji] button:has-text('Hapus rintangan')")
        time.sleep(1)
    for r in rows:
        print(r)
    print("LOG", log)
    b.close()
