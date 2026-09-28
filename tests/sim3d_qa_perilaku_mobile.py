"""Cek singkat perilaku di ponsel (390x844): J memicu AEB tanpa tabrakan, rintangan disalip, tidak ada galat."""
import time
from sim3d_qa_perilaku_common import *  # noqa

STATE = r"""() => { const a = window.__qaApp, pl = a.planner, r = pl.route, it = r.items[r.ri];
  return { v: a.ego.v * 3.6, item: it.type, remain: it.type === 'road' ? it.len - r.s : 0, k: pl.kNow, kEnd: it.kEnd, aeb: a.counters.aebAuto, col: a.counters.collisions, ov: a.counters.overtakes, beh: pl.behavior }; }"""

with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b, mobile=True)
    open_sim(page, "bebas")
    install_monitor(page)
    t0 = time.time()
    while time.time() - t0 < 120:
        s = ev(page, STATE)
        if s["item"] == "road" and s["remain"] > 45 and s["v"] > 40:
            break
        time.sleep(0.05)
    before = s
    ev(page, "() => window.__qaApp.jaywalker()")
    time.sleep(3)
    shot(page, "mobile_jay.png")
    time.sleep(3)
    after = ev(page, STATE)
    print("J di ponsel: v awal", round(before["v"], 1), "AEB +", after["aeb"] - before["aeb"], "tabrakan +", after["col"] - before["col"])
    t0 = time.time()
    while time.time() - t0 < 120:
        s = ev(page, STATE)
        if s["item"] == "road" and 60 < s["remain"] < 76 and s["k"] == 0 and s["v"] > 15 and s["kEnd"] == 0:
            break
        time.sleep(0.05)
    ev(page, "() => window.__qaApp.placeObstacle('mogok')")
    time.sleep(14)
    s2 = ev(page, STATE)
    shot(page, "mobile_after_salip.png")
    print("menyalip +", s2["ov"] - s["ov"], "tabrakan", s2["col"], "perilaku", s2["beh"])
    S = summary(page)
    print("npcOverlap", S["npcOverlapEvents"], "egoRed", S["egoRed"], "nan", S["nan"])
    print("LOG", [l for l in log if "CONNECTION_RESET" not in l][:10])
    b.close()
