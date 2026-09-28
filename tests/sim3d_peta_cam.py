"""Periksa posisi kamera Kabin terhadap shuttle."""
import time
from sim3d_peta_common import launch, new_page, open_harness, snap, shot, sync_playwright

with sync_playwright() as p:
    b = launch(p, "swift")
    ctx, page, log = new_page(b)
    open_harness(page, "jelajah")
    page.keyboard.press("1")
    for i in range(4):
        time.sleep(1)
        s = snap(page)
        print(round(s["simTime"], 1), "cam", [round(v, 1) for v in s["render"]["cam"]], "ego", round(s["shuttle"]["x"], 1), round(s["shuttle"]["z"], 1), round(s["shuttle"]["heading"], 2))
    shot(page, "cam_kabin.png")
    print(log)
    b.close()
