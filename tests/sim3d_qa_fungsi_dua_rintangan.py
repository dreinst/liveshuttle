"""Dua rintangan sejenis berdekatan di lajur kiri (dua klik cepat). Ukur lama mobil otonom diam (waktu simulasi) dengan 4x."""
import sys
import time
from sim3d_qa_fungsi_util import BASE, launch, new_page, snap, wait_ready, wait_until, shot, sync_playwright


def toasts(page):
    return page.evaluate("() => [...document.querySelectorAll('.s3d-toast')].map(t => t.textContent)")


TYPE = sys.argv[1] if len(sys.argv) > 1 else "kerucut"
with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b)
    page.goto(f"{BASE}/#/simulator/bebas")
    wait_ready(page)
    time.sleep(1)
    page.click(".s3d-panel[data-tab=uji] .s3d-panel-head")
    trials = 0
    for attempt in range(12):
        if trials >= 2:
            break
        page.evaluate("() => document.activeElement && document.activeElement.blur()")
        wait_until(page, lambda s: s["ego"]["behavior"] == "Melaju" and s["ego"]["speedKmh"] > 20 and s["traffic"]["obstacles"] == 0 and s["ego"]["lane"] == "kiri", timeout=60)
        page.keyboard.press("p")
        time.sleep(0.1)
        page.click(f".s3d-obs[data-type={TYPE}]")
        page.click(f".s3d-obs[data-type={TYPE}]")
        tx = toasts(page)[-2:]
        page.evaluate("() => document.activeElement && document.activeElement.blur()")
        import re
        ds = [int(x) for x in re.findall(r"ditaruh (\d+) m di depan, di lajur kiri", " ".join(tx))]
        if len(ds) != 2 or abs(ds[1] - ds[0]) > 16:
            page.click(".s3d-panel[data-tab=uji] button:has-text('Hapus rintangan')")
            page.evaluate("() => document.activeElement && document.activeElement.blur()")
            page.keyboard.press("p")
            time.sleep(3)
            continue
        trials += 1
        page.keyboard.press("p")
        page.keyboard.press("]")
        page.keyboard.press("]")
        s0 = snap(page)
        t_start = s0["simTime"]
        still_since = None
        longest = 0
        info = None
        t0 = time.time()
        while time.time() - t0 < 100:
            s = snap(page)
            if s["ego"]["speedKmh"] < 0.5:
                if still_since is None:
                    still_since = s["simTime"]
                d = s["simTime"] - still_since
                if d > longest:
                    longest = d
                    if d > 20 and info is None:
                        info = (s["ego"]["behavior"], s["ego"]["reason"], s["ego"]["lane"], s["ego"]["limiter"])
            else:
                still_since = None
            if s["counters"]["overtakes"] > s0["counters"]["overtakes"] and s["ego"]["lane"] == "kiri" and s["ego"]["speedKmh"] > 10:
                break
            time.sleep(0.25)
        s = snap(page)
        print(f"uji {trials}: jarak {ds} | diam terlama {round(longest)} s simulasi | selesai setelah {round(s['simTime'] - t_start)} s simulasi | menyalip +{s['counters']['overtakes'] - s0['counters']['overtakes']}")
        if info:
            print("    saat diam:", info)
        page.keyboard.press("-")
        page.keyboard.press("-")
        page.click(".s3d-panel[data-tab=uji] button:has-text('Hapus rintangan')")
        time.sleep(2)
    print("debug", snap(page)["debug"][-6:])
    print("LOG", log)
    b.close()
