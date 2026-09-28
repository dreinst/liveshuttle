"""Uji rendam dengan rintangan yang dibiarkan di jalan: NPC harus menyalip dan tidak saling tabrak atau terkunci."""
import time

from sim3d_common import BASE, launch, new_page, snap, wait_ready, wait_until, shot, sync_playwright

with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b)
    page.goto(f"{BASE}/tests/sim3d_harness.html?mode=bebas")
    wait_ready(page)
    page.evaluate("""() => { const el = document.getElementById('s3d-traf'); el.value = '50'; el.dispatchEvent(new Event('input', { bubbles: true })); }""")
    page.keyboard.press("]")
    page.keyboard.press("]")
    page.keyboard.press("3")
    t0 = time.time()
    placed = 0
    max_ov = 0
    while time.time() - t0 < 100:
        s = snap(page)
        max_ov = max(max_ov, s["traffic"]["npcOverlaps"])
        if placed < 8 and s["ego"]["behavior"] == "Melaju" and s["ego"]["speedKmh"] > 25:
            for t in ("mogok", "kerucut", "kardus"):
                pass
            page.keyboard.press("o")
            placed += 1
            time.sleep(4)
        time.sleep(0.5)
    s = snap(page)
    print("simTime", round(s["simTime"]), "ditaruh", placed, "rintangan", s["traffic"]["obstacles"])
    print("counters", s["counters"])
    print("traffic", {k: s["traffic"][k] for k in ("cars", "npcOverlaps", "respawns", "waiting")}, "max overlap", max_ov)
    for d in s.get("debug", []):
        print("DEBUG", d)
    shot(page, "obs_soak_end.png")
    print("LOG:", "\n".join(log[:20]) or "(kosong)")
    b.close()
