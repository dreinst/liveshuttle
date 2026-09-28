"""Uji asap: simulator termuat, tidak ada galat konsol, dan tangkapan layar awal."""
import sys
import time

from sim3d_peta_common import launch, new_page, open_harness, snap, shot, dump, sync_playwright

mode = sys.argv[1] if len(sys.argv) > 1 else "swift"
with sync_playwright() as p:
    b = launch(p, mode)
    ctx, page, log = new_page(b)
    s = open_harness(page, "panduan")
    time.sleep(4)
    s = snap(page)
    dump({k: s[k] for k in ("mode", "camera", "weather", "shuttle", "invariants", "shield", "collisions", "traffic", "render", "map")})
    shot(page, f"smoke_{mode}_drone.png")
    for cam in ("kabin", "sinematik", "peta"):
        page.keyboard.press(str(["kabin", "drone", "sinematik", "peta"].index(cam) + 1))
        time.sleep(2.5)
        shot(page, f"smoke_{mode}_{cam}.png")
    print("LOG", log[:20])
    b.close()
