"""Autopilot mati, mengemudi manual dengan papan ketik dan tombol layar, lalu autopilot nyala lagi."""
import time
from sim3d_qa_fungsi_util import BASE, launch, new_page, snap, wait_ready, wait_until, shot, text, dump, sync_playwright

R = {}


def toasts(page):
    return page.evaluate("() => [...document.querySelectorAll('.s3d-toast')].map(t => t.textContent)")


def blur(page):
    page.evaluate("() => document.activeElement && document.activeElement.blur()")


def safety(page):
    return page.evaluate("() => Object.fromEntries([...document.querySelectorAll('.s3d-safe')].map(c => [c.querySelector('.s3d-safe-label').textContent, c.querySelector('.s3d-safe-val').textContent]))")


with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b)
    page.goto(f"{BASE}/#/simulator/bebas")
    wait_ready(page)
    time.sleep(1.5)
    blur(page)
    page.keyboard.press("m")
    time.sleep(0.5)
    s = snap(page)
    R["M_off"] = (s["ego"]["autopilot"], s["ego"]["behavior"], toasts(page)[-1:], page.evaluate("() => !document.querySelector('.s3d-drive').hidden"), page.evaluate("() => document.querySelector('.s3d-switch').getAttribute('aria-checked')"))
    shot(page, "manual_off.png")
    # tunggu mobil berhenti sendiri (tanpa gas)
    time.sleep(3)
    v_coast = snap(page)["ego"]["speedKmh"]
    # gas 3 detik
    page.keyboard.down("ArrowUp")
    time.sleep(3)
    s = snap(page)
    page.keyboard.up("ArrowUp")
    R["gas_3s"] = (round(v_coast, 1), round(s["ego"]["speedKmh"], 1), text(page, ".is-gas .s3d-bar-val"))
    # kemudi kiri sambil gas
    h0 = snap(page)["ego"]["heading"]
    page.keyboard.down("w")
    page.keyboard.down("a")
    time.sleep(0.8)
    st = text(page, ".is-steer .s3d-bar-val")
    page.keyboard.up("a")
    page.keyboard.up("w")
    h1 = snap(page)["ego"]["heading"]
    R["steer_left"] = (round(h1 - h0, 3), st)
    time.sleep(0.4)
    # rem
    v0 = snap(page)["ego"]["speedKmh"]
    page.keyboard.down("ArrowDown")
    time.sleep(1.5)
    v1 = snap(page)["ego"]["speedKmh"]
    br = text(page, ".is-brake .s3d-bar-val")
    time.sleep(2)
    v2 = snap(page)["ego"]["speedKmh"]
    page.keyboard.up("ArrowDown")
    R["brake"] = (round(v0, 1), round(v1, 1), br, round(v2, 1))
    s = snap(page)
    R["dev_after_manual"] = (round(s["ego"]["deviation"], 2), safety(page).get("Simpangan lajur"), s["ego"]["behavior"], s["ego"]["reason"])
    shot(page, "manual_driving.png")
    # tombol layar Gas (pointer)
    box = page.locator(".s3d-drive-btn[data-key=up]").bounding_box()
    v0 = snap(page)["ego"]["speedKmh"]
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.mouse.down()
    time.sleep(1.5)
    v1 = snap(page)["ego"]["speedKmh"]
    page.mouse.up()
    R["drive_btn_gas"] = (round(v0, 1), round(v1, 1))
    blur(page)
    # rem darurat otomatis saat manual: pejalan kaki
    page.keyboard.down("ArrowUp")
    time.sleep(3)
    page.keyboard.up("ArrowUp")
    c0 = snap(page)["counters"]
    page.keyboard.press("j")
    time.sleep(3)
    s = snap(page)
    R["manual_jay"] = (s["counters"]["jaywalkers"] - c0["jaywalkers"], s["counters"]["aebAuto"] - c0["aebAuto"], s["counters"]["collisions"] - c0["collisions"])
    # tabrak gedung: belok kanan penuh dan gas
    c0 = snap(page)["counters"]["collisions"]
    page.keyboard.down("ArrowUp")
    page.keyboard.down("ArrowRight")
    s = wait_until(page, lambda s: s["counters"]["collisions"] > c0, timeout=12)
    page.keyboard.up("ArrowRight")
    page.keyboard.up("ArrowUp")
    s = snap(page)
    R["crash"] = (s["counters"]["collisions"] - c0, toasts(page)[-2:], safety(page).get("Tabrakan"), round(s["ego"]["deviation"], 2), safety(page).get("Simpangan lajur"))
    shot(page, "manual_crash.png")
    # autopilot nyala lagi (mungkin ditolak bila jauh dari jalan)
    page.keyboard.press("m")
    time.sleep(0.6)
    s = snap(page)
    R["M_on_after_crash"] = (s["ego"]["autopilot"], toasts(page)[-1:])
    if not s["ego"]["autopilot"]:
        # mundur sedikit lalu coba lagi
        page.keyboard.down("ArrowDown")
        time.sleep(2.5)
        page.keyboard.up("ArrowDown")
        page.click(".s3d-switch")
        time.sleep(0.6)
        s = snap(page)
        R["switch_on_retry"] = (s["ego"]["autopilot"], toasts(page)[-1:])
    time.sleep(8)
    s = snap(page)
    R["after_on"] = (s["ego"]["autopilot"], round(s["ego"]["speedKmh"]), s["ego"]["behavior"], s["ego"]["reason"], round(s["ego"]["deviation"], 2), s["counters"]["collisions"])
    shot(page, "manual_back_auto.png")
    # tombol panah tidak mengemudi saat autopilot nyala
    dump(R)
    print("LOG", log)
    b.close()
