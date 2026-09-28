"""Mode Bebas: menaruh rintangan dengan klik di jalan, dan klik di luar jalan."""
import time
from sim3d_qa_fungsi_util import BASE, launch, new_page, snap, wait_ready, shot, text, dump, sync_playwright

R = {}


def toasts(page):
    return page.evaluate("() => [...document.querySelectorAll('.s3d-toast')].map(t => t.textContent)")


def blur(page):
    page.evaluate("() => document.activeElement && document.activeElement.blur()")


with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b)
    page.goto(f"{BASE}/#/simulator/bebas")
    wait_ready(page)
    time.sleep(1.5)
    page.click(".s3d-panel[data-tab=uji] .s3d-panel-head")
    page.click(".s3d-group[data-hl=kamera] button[data-value=atas]")
    time.sleep(1)
    page.click(".s3d-obs[data-type=kardus]")
    page.click(".s3d-panel[data-tab=uji] button:has-text('Hapus rintangan')")
    page.click(".s3d-toggle:has-text('Taruh dengan klik')")
    blur(page)
    page.keyboard.press("p")
    time.sleep(0.4)
    s = snap(page)
    R["armed_paused"] = (s["traffic"]["clickArmed"], s["paused"])
    results = []
    for d, lat in [(32, 0), (45, 0), (60, 3.5), (30, 3.5), (10, 0), (38, -8)]:
        pt = page.evaluate(f"() => {{ const s = window.__sim3d; const e = s.ego; const h = e.heading; const x = e.x + Math.cos(h) * {d} - Math.sin(h) * {lat}, z = e.z + Math.sin(h) * {d} + Math.cos(h) * {lat}; return s.screenOf(x, z); }}")
        n0 = snap(page)["traffic"]["obstacles"]
        page.mouse.click(pt["x"], pt["y"])
        time.sleep(0.4)
        results.append((d, lat, round(pt["x"]), round(pt["y"]), snap(page)["traffic"]["obstacles"] - n0, toasts(page)[-1:]))
    R["clicks"] = results
    shot(page, "klik_taruh.png")
    # seret (bukan klik) tidak menaruh
    n0 = snap(page)["traffic"]["obstacles"]
    page.mouse.move(700, 500)
    page.mouse.down()
    page.mouse.move(760, 540, steps=5)
    page.mouse.up()
    time.sleep(0.3)
    R["drag_no_place"] = snap(page)["traffic"]["obstacles"] - n0
    page.click(".s3d-placehint button")
    time.sleep(0.3)
    R["selesai_btn"] = snap(page)["traffic"]["clickArmed"]
    page.keyboard.press("p")
    time.sleep(0.3)
    # tunggu mobil otonom bereaksi terhadap rintangan yang ditaruh
    time.sleep(12)
    s = snap(page)
    R["after"] = (s["counters"], s["ego"]["behavior"], s["ego"]["reason"])
    # mode tutorial: klik tidak tersedia
    page.click(".s3d-modes button[data-mode=tutorial]")
    time.sleep(0.6)
    R["tut_clicknote_visible"] = page.evaluate("() => { const n = document.querySelector('.s3d-tutonly'); return n && getComputedStyle(n).display !== 'none'; }")
    R["tut_toggle_visible"] = page.evaluate("() => { const n = document.querySelector('.s3d-bebasonly'); return n && getComputedStyle(n).display !== 'none'; }")
    dump(R)
    print("LOG", log)
    b.close()
