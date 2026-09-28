"""Tangkapan layar tahap peta: kamera utama, tampilan atas seluruh kota (untuk dibandingkan dengan
data/osm/preview.png), beberapa sudut dekat, dan ponsel. Pemakaian: python3 sim3d_peta_shots.py [swift|gpu]"""
import sys
import time

from sim3d_peta_common import launch, new_page, open_harness, snap, shot, sync_playwright

mode = sys.argv[1] if len(sys.argv) > 1 else "swift"
with sync_playwright() as p:
    b = launch(p, mode)
    ctx, page, log = new_page(b)
    open_harness(page, "jelajah")
    time.sleep(3)
    shot(page, f"{mode}_drone.png")
    page.keyboard.press("1")
    time.sleep(2)
    shot(page, f"{mode}_kabin.png")
    page.keyboard.press("3")
    time.sleep(3)
    shot(page, f"{mode}_sinematik.png")
    page.keyboard.press("4")
    time.sleep(2)
    shot(page, f"{mode}_peta.png")
    # seluruh kota dari atas (utara di atas)
    page.evaluate("() => window.__sim3d.debug.lookAt(110, 70, 1150)")
    time.sleep(2.5)
    shot(page, f"{mode}_overview.png")
    for name, x, z, h in [("kampus", 40, -120, 330), ("gerbang", 90, -215, 110), ("lampu0", 216, -234, 90), ("lampu1", -66, -277, 90), ("bundaran", 220, 255, 120), ("tidar", 330, 230, 150), ("cincin10", -160, 550, 110)]:
        page.evaluate(f"() => window.__sim3d.debug.lookAt({x}, {z}, {h})")
        time.sleep(1.8)
        shot(page, f"{mode}_atas_{name}.png")
    page.evaluate("() => window.__sim3d.debug.clearView()")
    s = snap(page)
    print("render", s["render"])
    print("map", s["map"])
    print("LOG", log)
    ctx.close()
    ctx, page, log = new_page(b, mobile=True)
    open_harness(page, "panduan")
    time.sleep(3)
    shot(page, f"{mode}_mobile_panduan.png")
    print("mobile LOG", log)
    b.close()
