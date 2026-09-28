"""Dua rintangan di lajur kiri dengan jarak tertentu (tombol lalu klik di jalan). Cari jarak yang membuat mobil otonom diam lama."""
import re
import sys
import time
from sim3d_qa_fungsi_util import BASE, launch, new_page, snap, wait_ready, wait_until, shot, sync_playwright

cases = [(a.split(":")[0], float(a.split(":")[1])) for a in sys.argv[1:]] or [("kerucut", 12), ("kerucut", 18), ("mogok", 18), ("mogok", 25)]


def toasts(page):
    return page.evaluate("() => [...document.querySelectorAll('.s3d-toast')].map(t => t.textContent)")


def blur(page):
    page.evaluate("() => document.activeElement && document.activeElement.blur()")


with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b)
    page.goto(f"{BASE}/#/simulator/bebas")
    wait_ready(page)
    time.sleep(1)
    page.click(".s3d-panel[data-tab=uji] .s3d-panel-head")
    for typ, gap in cases:
        done = False
        for attempt in range(8):
            blur(page)
            wait_until(page, lambda s: s["ego"]["behavior"] == "Melaju" and s["ego"]["speedKmh"] > 20 and s["traffic"]["obstacles"] == 0 and s["ego"]["lane"] == "kiri" and s["ego"]["plan"]["s"] < 30, timeout=60)
            page.keyboard.press("p")
            time.sleep(0.1)
            page.click(f".s3d-obs[data-type={typ}]")
            m = re.search(r"ditaruh (\d+) m di depan, di lajur kiri", " ".join(toasts(page)[-1:]))
            ok = False
            if m and int(m.group(1)) < 50:
                N = int(m.group(1))
                page.click(".s3d-toggle:has-text('Taruh dengan klik')")
                blur(page)
                pt = page.evaluate(f"() => {{ const s = window.__sim3d; const e = s.ego; const h = e.heading; const d = {N + gap}; const x = e.x + Math.cos(h) * d, z = e.z + Math.sin(h) * d; const p = s.screenOf(x, z); const el = document.elementFromPoint(p.x, p.y); return {{ ...p, on: !!(el && el.classList.contains('s3d-canvas')) }}; }}")
                if pt["on"]:
                    n0 = snap(page)["traffic"]["obstacles"]
                    page.mouse.click(pt["x"], pt["y"])
                    time.sleep(0.2)
                    ok = snap(page)["traffic"]["obstacles"] == n0 + 1 and "kiri" in toasts(page)[-1]
                page.keyboard.press("Escape")
            if ok:
                done = True
                break
            page.click(".s3d-panel[data-tab=uji] button:has-text('Hapus rintangan')")
            blur(page)
            page.keyboard.press("p")
            time.sleep(3)
        if not done:
            print(typ, gap, "tidak bisa disiapkan")
            continue
        blur(page)
        page.keyboard.press("p")
        page.keyboard.press("]")
        page.keyboard.press("]")
        s0 = snap(page)
        still_since = None
        longest = 0
        info = None
        t0 = time.time()
        while time.time() - t0 < 60:
            s = snap(page)
            if s["ego"]["speedKmh"] < 0.5:
                if still_since is None:
                    still_since = s["simTime"]
                d = s["simTime"] - still_since
                if d > longest:
                    longest = d
                    if d > 30 and info is None:
                        info = (s["ego"]["behavior"], s["ego"]["reason"], s["ego"]["lane"], s["ego"]["limiter"])
                        shot(page, f"jarak_{typ}_{int(gap)}.png")
            else:
                still_since = None
            if s["counters"]["overtakes"] > s0["counters"]["overtakes"] and s["ego"]["lane"] == "kiri" and s["ego"]["speedKmh"] > 10:
                break
            time.sleep(0.25)
        s = snap(page)
        print(f"{typ} jarak {gap} m: diam terlama {round(longest)} s simulasi, total {round(s['simTime'] - s0['simTime'])} s, menyalip +{s['counters']['overtakes'] - s0['counters']['overtakes']}", info or "")
        page.keyboard.press("-")
        page.keyboard.press("-")
        page.click(".s3d-panel[data-tab=uji] button:has-text('Hapus rintangan')")
        time.sleep(2)
    print("LOG", log)
    b.close()
