"""Tangkapan layar empat kamera, empat cuaca, dan kualitas Tinggi (bayangan)."""
import time

from sim3d_common import BASE, launch, new_page, snap, wait_ready, wait_until, shot, sync_playwright

with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b)
    page.goto(f"{BASE}/tests/sim3d_harness.html?mode=bebas")
    wait_ready(page)
    wait_until(page, lambda s: s["ego"]["speedKmh"] > 25, 40)
    info = []
    for key, name in (("1", "orbit"), ("2", "kejar"), ("3", "atas"), ("4", "kokpit")):
        page.keyboard.press(key)
        time.sleep(1.6)
        s = snap(page)
        info.append((name, s["camera"], s["render"]["calls"], round(s["render"]["fps"])))
        shot(page, f"vis_cam_{name}.png")
    page.keyboard.press("2")
    for w in ("cerah", "hujan", "kabut", "malam"):
        page.click(f".s3d-seg-btn[data-value='{w}']")
        time.sleep(2.2)
        s = snap(page)
        info.append((w, s["weather"], s["sensing"]["lidarRange"], s["sensing"]["cameraRange"], round(s["ego"]["speedKmh"]), s["ego"]["reason"][:60]))
        shot(page, f"vis_wx_{w}.png")
    page.keyboard.press("1")
    time.sleep(1.5)
    shot(page, "vis_wx_malam_orbit.png")
    page.keyboard.press("4")
    time.sleep(1.2)
    shot(page, "vis_wx_malam_kokpit.png")
    page.click(".s3d-seg-btn[data-value='hujan']")
    page.keyboard.press("1")
    time.sleep(1.5)
    shot(page, "vis_wx_hujan_orbit.png")
    page.click(".s3d-seg-btn[data-value='cerah']")
    page.select_option(".s3d-select", "tinggi")
    page.keyboard.press("2")
    time.sleep(2.0)
    s = snap(page)
    info.append(("tinggi", s["quality"], s["render"]["pixelRatio"], s["render"]["calls"], round(s["render"]["fps"])))
    shot(page, "vis_quality_tinggi.png")
    page.select_option(".s3d-select", "hemat")
    time.sleep(1.0)
    s = snap(page)
    info.append(("hemat", s["quality"], s["render"]["pixelRatio"]))
    page.keyboard.press("3")
    time.sleep(8)
    shot(page, "vis_atas_antrean.png")
    for i in info:
        print(i)
    print("LOG:", "\n".join(log[:20]) or "(kosong)")
    b.close()
