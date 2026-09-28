"""Uji skenario: menyalip mobil mogok dan rem darurat untuk pejalan kaki mendadak."""
import sys
import time

from sim3d_common import BASE, launch, new_page, snap, wait_ready, wait_until, shot, sync_playwright

which = sys.argv[1] if len(sys.argv) > 1 else "both"

with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b)
    page.goto(f"{BASE}/tests/sim3d_harness.html?mode=bebas")
    wait_ready(page)
    page.keyboard.press("3")
    page.click(".s3d-panel[data-tab='uji'] .s3d-panel-head")
    if which in ("both", "mogok"):
        for attempt in range(4):
            s = wait_until(page, lambda s: s["ego"]["speedKmh"] > 30 and s["ego"]["behavior"] == "Melaju", 60)
            before = snap(page)["counters"]["overtakes"]
            page.click(".s3d-obs[data-type='mogok']")
            time.sleep(0.3)
            shot(page, f"scen_mogok_placed_{attempt}.png")
            behs = set()
            t0 = time.time()
            done = False
            while time.time() - t0 < 25:
                s = snap(page)
                behs.add(s["ego"]["behavior"])
                if s["counters"]["overtakes"] > before:
                    done = True
                    break
                if s["ego"]["behavior"] == "Menyalip" and "mid" not in behs:
                    behs.add("mid")
                    shot(page, f"scen_mogok_mid_{attempt}.png")
                time.sleep(0.2)
            print("attempt", attempt, "overtake", done, behs, s["ego"]["reason"])
            if done:
                break
        shot(page, "scen_mogok_after.png")
        page.click("button:has-text('Hapus rintangan')")
    if which in ("both", "jay"):
        page.keyboard.press("2")
        for attempt in range(4):
            s = wait_until(page, lambda s: s["ego"]["speedKmh"] > 38 and s["ego"]["behavior"] == "Melaju", 90)
            before = snap(page)["counters"]["aebAuto"]
            page.keyboard.press("j")
            t0 = time.time()
            done = False
            min_ttc = 99
            while time.time() - t0 < 6:
                s = snap(page)
                if s["ego"]["ttc"] is not None:
                    min_ttc = min(min_ttc, s["ego"]["ttc"])
                if s["counters"]["aebAuto"] > before and not done:
                    done = True
                    time.sleep(0.25)
                    shot(page, f"scen_jay_aeb_{attempt}.png")
                time.sleep(0.1)
            s = snap(page)
            print("attempt", attempt, "aeb", done, "min ttc", round(min_ttc, 2), "collisions", s["counters"]["collisions"], s["ego"]["behavior"])
            if done:
                break
    s = snap(page)
    print("counters", s["counters"])
    for d in s.get("debug", []):
        print("DEBUG", d)
    print("LOG:", "\n".join(log[:20]) or "(kosong)")
    b.close()
