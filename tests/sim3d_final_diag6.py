"""Diagnosis: jalani tutorial sampai langkah 6 lalu catat keadaan mobil tiap 2 detik."""
import sys
import time
from sim3d_final_common import *  # noqa

SPEED = sys.argv[1] if len(sys.argv) > 1 else "50"


def act(page, text):
    loc = page.locator(".s3d-tut-actions button", has_text=text).first
    loc.scroll_into_view_if_needed()
    loc.click()


def nxt(page):
    page.locator(".s3d-tut-nav .s3d-primary").click()


with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b)
    open_route(page, "tutorial")
    time.sleep(1)
    act(page, "Kejar"); time.sleep(0.4); act(page, "Atas"); time.sleep(0.3); nxt(page); time.sleep(1.2)
    act(page, "LiDAR"); time.sleep(0.5); act(page, "LiDAR"); time.sleep(0.3); nxt(page)
    wait_until(page, lambda s: s["tutorial"]["done"][2], 40); nxt(page); time.sleep(0.8)
    act(page, "Taruh mobil mogok")
    wait_until(page, lambda s: s["tutorial"]["done"][3], 90); nxt(page); time.sleep(0.6)
    if SPEED != "50":
        act(page, f"{SPEED} km/jam")
    time.sleep(5)
    nxt(page)
    for i in range(25):
        s = snap(page)
        e = s["ego"]
        print(round(s["simTime"], 1), round(e["speedKmh"], 1), e["behavior"], "|", e["reason"][:90], "| lim", e["limiter"], "| plan", e["plan"], "x", round(e["x"]), "z", round(e["z"]))
        time.sleep(2)
    page.screenshot(path=f"{SHOTS}/diag6_{SPEED}.png")
    print("debug", s["debug"][-8:])
    print("LOG", log)
    b.close()
