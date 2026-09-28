"""Diagnosa kebuntuan: jalankan fisika tanpa menggambar, lalu tampilkan kendaraan yang diam lama
dan keadaan pejalan kaki. Pemakaian: python3 sim3d_peta_stuck.py MENIT [MIN_DIAM]"""
import json
import sys

from sim3d_peta_common import launch, new_page, open_harness, snap, sync_playwright

minutes = float(sys.argv[1]) if len(sys.argv) > 1 else 3
min_stuck = float(sys.argv[2]) if len(sys.argv) > 2 else 30
seed = int(sys.argv[3]) if len(sys.argv) > 3 else 0
density = int(sys.argv[4]) if len(sys.argv) > 4 else 0
with sync_playwright() as p:
    b = launch(p, "swift")
    ctx, page, log = new_page(b)
    if seed:
        page.add_init_script(f"window.__sim3dSeed = {seed};")
    open_harness(page, "jelajah")
    page.keyboard.press("Space")
    if density:
        page.evaluate(f"() => window.__sim3d.debug.setTraffic({density})")
    steps = int(minutes * 3600)
    done = 0
    while done < steps:
        page.evaluate("() => window.__sim3d.debug.runSteps(1800)")
        done += 1800
        ps = page.evaluate("() => window.__sim3d.debug.pedStates()")
        s = snap(page)
        print(round(s["simTime"]), ps, "xing", s["traffic"]["crossings"], "stuckMax", round(s["traffic"]["stuckMax"]))
    vs = page.evaluate(f"() => window.__sim3d.debug.vehicles({min_stuck})")
    for v in sorted(vs, key=lambda v: -v["stuck"]):
        print(json.dumps(v))
    links = sorted(set([v["link"] for v in vs] + [g for v in vs for g in v["grants"]] + [v["req"] for v in vs if v["req"] is not None] + []))
    for l in links:
        print(l, page.evaluate(f"() => window.__sim3d.debug.linkInfo({l})"))
    print("LOG", log[:10])
    b.close()
