"""Uji tahan: 4x, lalu lintas padat, rintangan dan pejalan kaki acak, pergantian cuaca dan lampu. Catat galat dan penghitung."""
import random
import time
from sim3d_qa_fungsi_util import BASE, launch, new_page, snap, wait_ready, shot, sync_playwright

random.seed(7)
with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b)
    page.goto(f"{BASE}/#/simulator/bebas")
    wait_ready(page)
    time.sleep(1)
    page.evaluate("() => { const e = document.querySelector('#s3d-traf'); e.value = '50'; e.dispatchEvent(new Event('input', { bubbles: true })); }")
    page.evaluate("() => document.activeElement && document.activeElement.blur()")
    page.keyboard.press("]")
    page.keyboard.press("]")
    t0 = time.time()
    samples = []
    maxov = 0
    stuck = 0
    last_pos = None
    still_since = None
    longest_still = 0
    while time.time() - t0 < 150:
        s = snap(page)
        maxov = max(maxov, s["traffic"]["npcOverlaps"])
        pos = (round(s["ego"]["x"]), round(s["ego"]["z"]))
        if last_pos == pos:
            if still_since is None:
                still_since = s["simTime"]
            longest_still = max(longest_still, s["simTime"] - still_since)
            dur = s["simTime"] - still_since
            if dur > 40 and not getattr(page, "_shotdone", False):
                page._shotdone = True
                shot(page, "soak_stuck.png")
                print("MACET", round(dur), s["ego"]["behavior"], "|", s["ego"]["reason"], "|", s["ego"]["limiter"], "| obst", s["traffic"]["obstacles"], "| weather", s["weather"], "| plan", s["ego"]["plan"])
            if dur > 40 and int(dur) % 60 < 2:
                print("  masih macet", round(dur), s["ego"]["behavior"], "|", s["ego"]["reason"][:80], "|", s["ego"]["limiter"])
        else:
            still_since = None
        last_pos = pos
        r = random.random()
        if r < 0.08:
            page.keyboard.press("j")
        elif r < 0.14:
            page.keyboard.press("o")
        elif r < 0.17:
            page.keyboard.press(random.choice(["1", "2", "3", "4"]))
        elif r < 0.19:
            w = random.choice(["cerah", "hujan", "kabut", "malam"])
            page.click(f".s3d-group[data-hl=cuaca] button[data-value={w}]")
            page.evaluate("() => document.activeElement && document.activeElement.blur()")
        elif r < 0.2:
            page.evaluate("() => { const b = document.querySelectorAll('.s3d-panel[data-tab=uji] .s3d-ghost'); for (const x of b) if (x.textContent.includes('Hapus')) x.click(); }")
        time.sleep(0.5)
    s = snap(page)
    shot(page, "soak_end.png")
    print("simTime", round(s["simTime"]), "counters", s["counters"], "maxNpcOverlap", maxov, "respawns", s["traffic"]["respawns"], "longest ego standstill (sim s)", round(longest_still, 1), "cars", s["traffic"]["cars"], "fps", round(s["render"]["fps"]))
    print("debug", s["debug"][-8:])
    print("LOG", log)
    b.close()
