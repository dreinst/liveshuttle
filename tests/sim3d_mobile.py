"""Tangkapan layar tab di lembar bawah ponsel, lembar diperkecil, dan menaruh rintangan dengan ketuk."""
import time

from sim3d_common import BASE, launch, new_page, snap, wait_ready, wait_until, shot, sync_playwright

with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b, True)
    page.goto(f"{BASE}/tests/sim3d_harness.html?mode=bebas")
    wait_ready(page)
    time.sleep(1)
    for tab in ("persepsi", "rencana", "kontrol", "uji", "kota", "tampilan"):
        page.tap(f".s3d-tab[data-tab='{tab}']")
        time.sleep(0.5)
        shot(page, f"mob_tab_{tab}.png")
    # kamera dan cuaca dari tab Tampilan
    page.tap(".s3d-tampil .s3d-seg-btn[data-value='atas']")
    page.tap(".s3d-tampil .s3d-seg-btn[data-value='malam']")
    time.sleep(1)
    s = snap(page)
    print("tampilan:", s["camera"], s["weather"])
    shot(page, "mob_malam_atas.png")
    page.tap(".s3d-tampil .s3d-seg-btn[data-value='cerah']")
    # perkecil lembar
    page.tap(".s3d-sheet-btn")
    time.sleep(0.6)
    s = snap(page)
    print("lembar kecil, tinggi kanvas:", s["render"]["height"])
    shot(page, "mob_sheet_min.png")
    page.tap(".s3d-sheet-btn")
    time.sleep(0.4)
    # ketuk jalan untuk menaruh kerucut
    page.tap(".s3d-tab[data-tab='uji']")
    page.tap(".s3d-obs[data-type='kerucut']")
    time.sleep(0.3)
    page.tap(".s3d-toggle:has-text('Taruh dengan klik')")
    n0 = snap(page)["traffic"]["obstacles"]
    ok = False
    for attempt in range(8):
        s = wait_until(page, lambda s: s["ego"]["speedKmh"] > 20 and s["ego"]["behavior"] == "Melaju", 30) or snap(page)
        pr = s["probe"]
        sc = page.evaluate(f"() => window.__sim3d.screenOf({pr['x']}, {pr['z']})")
        box = page.evaluate("() => { const r = document.querySelector('.s3d-canvas').getBoundingClientRect(); return [r.top, r.bottom]; }")
        if sc["visible"] and box[0] + 60 < sc["y"] < box[1] - 10:
            page.touchscreen.tap(sc["x"], sc["y"])
            time.sleep(0.4)
            if snap(page)["traffic"]["obstacles"] > n0:
                ok = True
                break
        time.sleep(0.8)
    print("ketuk menaruh kerucut:", ok)
    shot(page, "mob_tap_place.png")
    # bantuan
    page.tap(".s3d-help-btn")
    time.sleep(0.3)
    shot(page, "mob_help.png")
    page.tap(".s3d-help .s3d-primary")
    # tombol mengemudi manual
    page.tap(".s3d-tab[data-tab='kontrol']")
    page.tap(".s3d-switch")
    time.sleep(0.5)
    shot(page, "mob_manual.png")
    print("autopilot:", snap(page)["ego"]["autopilot"])
    print("LOG:", "\n".join(log[:20]) or "(kosong)")
    b.close()
