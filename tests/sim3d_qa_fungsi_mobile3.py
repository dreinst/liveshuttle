"""Ponsel: ketuk jalan untuk menaruh rintangan, titik diambil dari jalur rencana (probe) 28 m di depan."""
import time
from sim3d_qa_fungsi_util import BASE, launch, new_page, snap, wait_ready, wait_until, shot, dump, sync_playwright


def toasts(page):
    return page.evaluate("() => [...document.querySelectorAll('.s3d-toast')].map(t => t.textContent)")


for mobile in (True, False):
    with sync_playwright() as p:
        b = launch(p)
        ctx, page, log = new_page(b, mobile=mobile)
        page.goto(f"{BASE}/#/simulator/bebas")
        wait_ready(page)
        time.sleep(1)
        if mobile:
            page.tap(".s3d-tab[data-tab=uji]")
            page.tap(".s3d-obs[data-type=kardus]")
            page.tap(".s3d-panel[data-tab=uji] button:has-text('Hapus rintangan')")
            page.tap(".s3d-toggle:has-text('Taruh dengan klik')")
        else:
            page.click(".s3d-panel[data-tab=uji] .s3d-panel-head")
            page.click(".s3d-obs[data-type=kardus]")
            page.click(".s3d-panel[data-tab=uji] button:has-text('Hapus rintangan')")
            page.click(".s3d-toggle:has-text('Taruh dengan klik')")
        res = []
        for attempt in range(8):
            page.evaluate("() => document.activeElement && document.activeElement.blur()")
            page.keyboard.press("p")  # jeda
            time.sleep(0.3)
            pt = page.evaluate("() => { const s = window.__sim3d; const pr = s.probe; if (!pr) return null; const p = s.screenOf(pr.x, pr.z); const el = document.elementFromPoint(p.x, p.y); return { ...p, onCanvas: !!(el && el.classList.contains('s3d-canvas')), el: el && el.className }; }")
            n0 = snap(page)["traffic"]["obstacles"]
            if pt and pt["onCanvas"]:
                if mobile:
                    page.touchscreen.tap(pt["x"], pt["y"])
                else:
                    page.mouse.click(pt["x"], pt["y"])
                time.sleep(0.35)
                res.append((attempt, round(pt["x"]), round(pt["y"]), snap(page)["traffic"]["obstacles"] - n0, (toasts(page) or [""])[-1][:60]))
            else:
                res.append((attempt, pt and pt.get("el"), "tidak di kanvas"))
            page.keyboard.press("p")
            time.sleep(2.5)
        print("ponsel" if mobile else "desktop", snap(page)["camera"])
        for r in res:
            print("  ", r)
        shot(page, f"tap_probe_{'m' if mobile else 'd'}.png")
        print("LOG", log)
        b.close()
