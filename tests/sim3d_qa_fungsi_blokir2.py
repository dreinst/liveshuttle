"""Kedua lajur tertutup di ruas yang sedang dilalui mobil otonom (rintangan sekitar 40 m di depan, kiri dan kanan)."""
import re
import sys
import time
from sim3d_qa_fungsi_util import BASE, launch, new_page, snap, wait_ready, wait_until, shot, dump, sync_playwright

TYPE = sys.argv[1] if len(sys.argv) > 1 else "kerucut"


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
    setup = None
    for attempt in range(10):
        wait_until(page, lambda s: s["ego"]["behavior"] == "Melaju" and s["ego"]["speedKmh"] > 20 and s["ego"]["plan"]["s"] < 25 and s["ego"]["plan"]["ri"] == 0 or (s["ego"]["behavior"] == "Melaju" and s["ego"]["speedKmh"] > 20 and s["ego"]["plan"]["s"] < 20), timeout=40)
        page.click(f".s3d-obs[data-type={TYPE}]")
        blur(page)
        page.keyboard.press("p")
        time.sleep(0.2)
        tx = " ".join(toasts(page))
        m = re.search(r"ditaruh (\d+) m di depan, di lajur kiri", tx)
        if not m:
            page.keyboard.press("p")
            page.click(".s3d-panel[data-tab=uji] button:has-text('Hapus rintangan')")
            blur(page)
            time.sleep(2)
            continue
        N = int(m.group(1))
        page.click(".s3d-toggle:has-text('Taruh dengan klik')")
        blur(page)
        placed = False
        for d in [N, N + 1, N - 1]:
            pt = page.evaluate(f"() => {{ const s = window.__sim3d; const e = s.ego; const h = e.heading; const x = e.x + Math.cos(h) * {d} - Math.sin(h) * 3.5, z = e.z + Math.sin(h) * {d} + Math.cos(h) * 3.5; const p = s.screenOf(x, z); const el = document.elementFromPoint(p.x, p.y); return {{ ...p, on: !!(el && el.classList.contains('s3d-canvas')) }}; }}")
            if not pt["on"]:
                continue
            n0 = snap(page)["traffic"]["obstacles"]
            page.mouse.click(pt["x"], pt["y"])
            time.sleep(0.25)
            if snap(page)["traffic"]["obstacles"] > n0:
                placed = True
                break
        page.keyboard.press("Escape")
        if placed and snap(page)["traffic"]["obstacles"] == 2:
            setup = (N, toasts(page)[-2:])
            page.keyboard.press("p")
            break
        page.click(".s3d-panel[data-tab=uji] button:has-text('Hapus rintangan')")
        blur(page)
        page.keyboard.press("p")
        time.sleep(2)
    print("setup", setup)
    page.click(".s3d-group[data-hl=kamera] button[data-value=atas]")
    blur(page)
    trace = []
    t0 = time.time()
    while time.time() - t0 < 90:
        s = snap(page)
        r = (round(s["simTime"]), round(s["ego"]["speedKmh"]), s["ego"]["behavior"], s["ego"]["reason"][:90], s["ego"]["plan"]["held"], s["ego"]["replans"], s["counters"]["collisions"])
        if not trace or trace[-1][1:5] != r[1:5]:
            trace.append(r)
        if abs(time.time() - t0 - 30) < 0.3:
            shot(page, f"blokir2_{TYPE}_30s.png")
        time.sleep(0.5)
    shot(page, f"blokir2_{TYPE}_end.png")
    for r in trace:
        print(r)
    print("debug", snap(page)["debug"][-6:])
    print("LOG", log)
    b.close()
