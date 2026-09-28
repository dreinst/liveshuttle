"""QA tampilan lain: bantuan di desktop, penempatan rintangan dan label, rem darurat (TTC) di kamera kejar,
label yang tertutup panel, dan fokus judul bantuan di ponsel."""
import time
from playwright.sync_api import sync_playwright
from sim3d_qa_tampilan_common import BASE, launch, new_page, snap, wait_ready, shot, wait_ready

with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b)
    page.goto(f"{BASE}/index.html#/simulator/bebas")
    wait_ready(page)
    time.sleep(1)
    page.keyboard.press("h")
    time.sleep(0.5)
    shot(page, "desk_help.png")
    page.keyboard.press("Escape")
    time.sleep(0.3)
    esc_open = snap(page)["helpOpen"]
    print("help masih terbuka setelah Escape:", esc_open)
    if esc_open:
        page.keyboard.press("h")
    time.sleep(0.3)
    # rintangan: buka panel Uji skenario, taruh mobil mogok, kerucut, kardus lalu kamera kejar
    page.click(".s3d-panel[data-tab='uji'] .s3d-panel-head")
    time.sleep(0.3)
    for t in ["mogok", "kerucut", "kardus"]:
        page.click(f".s3d-obs[data-type='{t}']")
        time.sleep(0.4)
    time.sleep(2.5)
    shot(page, "desk_obstacles_kejar.png")
    page.keyboard.press("1")
    time.sleep(1.5)
    shot(page, "desk_obstacles_orbit.png")
    # tunggu menyalip
    t0 = time.time()
    while time.time() - t0 < 25:
        s = snap(page)
        if s["ego"]["behavior"] == "Menyalip":
            page.keyboard.press("2")
            time.sleep(0.6)
            shot(page, "desk_menyalip_kejar.png")
            break
        time.sleep(0.2)
    print("perilaku", snap(page)["ego"]["behavior"], snap(page)["counters"])
    page.click(".s3d-btn:has-text('Hapus rintangan')")
    # pejalan kaki mendadak saat cepat
    t0 = time.time()
    while time.time() - t0 < 30 and snap(page)["ego"]["speedKmh"] < 38:
        time.sleep(0.2)
    page.keyboard.press("j")
    t0 = time.time()
    shotted = False
    while time.time() - t0 < 6:
        s = snap(page)
        if s["ego"]["behavior"] == "Rem darurat" and not shotted:
            shot(page, "desk_aeb_kejar.png")
            shotted = True
        time.sleep(0.1)
    print("aeb", snap(page)["counters"])
    print("logs", log)
    ctx.close()

    ctx, page, log = new_page(b, mobile=True)
    page.goto(f"{BASE}/index.html#/simulator/bebas")
    wait_ready(page)
    time.sleep(1)
    page.click(".s3d-help-btn")
    time.sleep(0.4)
    info = page.evaluate("() => { const c = document.querySelector('.s3d-help-card'); const h = c.querySelector('h2').getBoundingClientRect(); const r = c.getBoundingClientRect(); return { cardScrollTop: c.scrollTop, titleVisible: h.top >= r.top && h.bottom <= r.bottom }; }")
    print("ponsel bantuan", info)
    ctx.close()
    b.close()
