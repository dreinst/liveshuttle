"""Diagnosa: kumpulkan kejadian keluar jalan dan kontak pejalan kaki, lalu gambar di peta."""
import json, sys, time
from sim3d_peta_common import launch, new_page, open_harness, snap, sync_playwright
minutes = float(sys.argv[1]) if len(sys.argv) > 1 else 4
with sync_playwright() as p:
    b = launch(p, "swift")
    ctx, page, log = new_page(b)
    open_harness(page, "jelajah")
    page.keyboard.press("Space")
    page.evaluate(f"() => window.__sim3d.debug.runSteps({int(minutes*3600)})")
    ev = page.evaluate("() => window.__sim3d.debug.offRoadEvents()")
    s = snap(page)
    inv = s["invariants"]
    links = sorted(set(e[2] for e in ev))
    info = {l: page.evaluate(f"() => window.__sim3d.debug.linkInfo({l})") for l in links}
    json.dump({"off": ev, "inv": inv, "info": info, "shield": s["shield"], "debug": s["debugLog"]}, open("/tmp/diag.json", "w"))
    print("offroad", len(ev), "links", len(links), "inv", inv["redLight"], inv["pedContact"])
    for l in links[:40]: print(l, info[l])
    for e in inv["events"]: print(e)
    b.close()
