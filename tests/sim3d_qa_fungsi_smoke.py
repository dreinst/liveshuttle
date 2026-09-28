"""Smoke: rute nyata #/simulator/tutorial dan #/simulator/bebas, desktop."""
import sys
import time
from sim3d_qa_fungsi_util import BASE, launch, new_page, snap, wait_ready, shot, dump, sync_playwright

swift = "--swift" in sys.argv
with sync_playwright() as p:
    b = launch(p, swift=swift)
    ctx, page, log = new_page(b)
    page.goto(f"{BASE}/#/simulator/tutorial")
    s = wait_ready(page)
    time.sleep(2)
    s = snap(page)
    dump({k: s[k] for k in ("mode", "camera", "weather", "quality", "signalMode", "layers", "tutorial", "render", "sensing", "counters")})
    shot(page, "smoke_tutorial.png")
    page.goto(f"{BASE}/#/simulator/bebas")
    time.sleep(3)
    s = snap(page)
    dump({k: s[k] for k in ("mode", "camera", "render")})
    shot(page, "smoke_bebas.png")
    print("LOG", log)
    b.close()
