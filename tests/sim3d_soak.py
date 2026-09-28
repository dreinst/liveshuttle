"""Uji rendam: jalankan simulasi lama pada 4x dan pantau tabrakan, tumpang tindih NPC, macet, dan perilaku."""
import sys
import time
from collections import Counter

from sim3d_common import BASE, launch, new_page, snap, wait_ready, shot, sync_playwright

secs = float(sys.argv[1]) if len(sys.argv) > 1 else 60
weather = sys.argv[2] if len(sys.argv) > 2 else "cerah"
signal = sys.argv[3] if len(sys.argv) > 3 else "adaptif"
cars = int(sys.argv[4]) if len(sys.argv) > 4 else 30
peds = int(sys.argv[5]) if len(sys.argv) > 5 else 40

with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b)
    page.goto(f"{BASE}/tests/sim3d_harness.html?mode=bebas")
    wait_ready(page)
    page.keyboard.press("2")
    for _ in range(2):
        page.keyboard.press("]")
    if weather != "cerah":
        page.click(f".s3d-seg-btn[data-value='{weather}']")
    if signal != "adaptif":
        page.click(".s3d-panel[data-tab='kota'] .s3d-panel-head")
        page.click(f".s3d-seg-btn[data-value='{signal}']")
    page.evaluate(f"""() => {{
      for (const [id, v] of [['s3d-traf', {cars}], ['s3d-ped', {peds}]]) {{
        const el = document.getElementById(id); el.value = String(v); el.dispatchEvent(new Event('input', {{ bubbles: true }}));
      }}
    }}""")
    beh = Counter()
    max_dev = 0
    max_overlap = 0
    still = 0
    max_still = 0
    last_t = 0
    t0 = time.time()
    samples = 0
    while time.time() - t0 < secs:
        s = snap(page)
        e = s["ego"]
        beh[e["behavior"]] += 1
        max_dev = max(max_dev, e["deviation"])
        max_overlap = max(max_overlap, s["traffic"]["npcOverlaps"])
        dt = s["simTime"] - last_t
        last_t = s["simTime"]
        if e["speedKmh"] < 1:
            still += dt
        else:
            still = 0
        max_still = max(max_still, still)
        if still > 60 and samples % 10 == 0:
            print("MACET", round(s["simTime"]), e["behavior"], e["reason"], e["limiter"])
            shot(page, f"soak_stuck_{int(s['simTime'])}.png")
        samples += 1
        time.sleep(0.5)
    s = snap(page)
    print("simTime", round(s["simTime"]), "fps", round(s["render"]["fps"]))
    print("counters", s["counters"])
    print("traffic", s["traffic"])
    print("behaviors", dict(beh))
    print("max deviation", round(max_dev, 2), "max npc overlaps", max_overlap, "max still", round(max_still, 1))
    print("replans", s["ego"]["replans"])
    for d in s.get("debug", []): print("DEBUG", d)
    shot(page, f"soak_end_{weather}.png")
    print("LOG:", "\n".join(log[:30]) or "(kosong)")
    b.close()
