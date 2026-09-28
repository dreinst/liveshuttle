"""Lewat rute asli #/simulator/bebas: pengait siap, J memicu AEB tanpa tabrakan, tanpa galat konsol."""
import time
from sim3d_qa_perilaku_common import *  # noqa

with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b)
    page.goto(f"{BASE}/index.html#/simulator/bebas")
    t0 = time.time()
    ok = False
    while time.time() - t0 < 60:
        try:
            ok = page.evaluate("() => !!(window.__sim3d && window.__sim3d.ready && window.__qaApp)")
        except Exception:
            ok = False
        if ok:
            break
        if time.time() - t0 > 15 and time.time() - t0 < 15.3:
            page.reload()
        time.sleep(0.25)
    print("siap lewat rute asli:", ok, page.evaluate("() => location.hash"))
    if ok:
        install_monitor(page)
        t0 = time.time()
        while time.time() - t0 < 90:
            s = ev(page, "() => { const a = window.__qaApp, r = a.planner.route, it = r.items[r.ri]; return { v: a.ego.v * 3.6, item: it.type, remain: it.type === 'road' ? it.len - r.s : 0 }; }")
            if s["item"] == "road" and s["remain"] > 45 and s["v"] > 40:
                break
            time.sleep(0.05)
        page.keyboard.press("j")
        time.sleep(6)
        S = summary(page)
        print("J: v", round(s["v"], 1), "AEB", S["counters"]["aebAuto"], "tabrakan", S["counters"]["collisions"], "jarak min pejalan", round(S["pedMinDist"], 2))
        shot(page, "rute_asli_bebas.png")
    print("LOG", [l for l in log if "CONNECTION_RESET" not in l][:10])
    b.close()
