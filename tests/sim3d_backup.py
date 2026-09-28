"""Uji mundur: mobil dibawa manual sampai dekat mobil mogok, lalu autopilot dinyalakan lagi."""
import re
import time

from sim3d_common import BASE, launch, new_page, snap, wait_ready, wait_until, shot, sync_playwright

with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b)
    page.goto(f"{BASE}/tests/sim3d_harness.html?mode=bebas")
    wait_ready(page)
    page.keyboard.press("3")
    wait_until(page, lambda s: s["ego"]["speedKmh"] > 25 and s["ego"]["behavior"] == "Melaju", 60)
    page.keyboard.press("o")
    time.sleep(0.3)
    page.keyboard.press("m")
    # biarkan mobil menggelinding sampai sekitar 5 m di belakang rintangan
    t0 = time.time()
    gap = None
    while time.time() - t0 < 30:
        s = snap(page)
        m = re.search(r"Mobil mogok, (\d+) m", s["ego"]["limiter"])
        gap = int(m.group(1)) if m else None
        if gap is not None and gap <= 12 and s["ego"]["speedKmh"] > 1:
            page.keyboard.down("KeyS")
        if gap is not None and gap <= 12 and s["ego"]["speedKmh"] <= 1:
            page.keyboard.up("KeyS")
            break
        if gap is not None and gap > 12 and s["ego"]["speedKmh"] < 12:
            page.keyboard.down("ArrowUp")
            time.sleep(0.3)
            page.keyboard.up("ArrowUp")
        time.sleep(0.15)
    page.keyboard.up("KeyS")
    s = snap(page)
    print("berhenti dekat:", gap, "m, kecepatan", round(s["ego"]["speedKmh"], 1), "tabrakan", s["counters"]["collisions"])
    before = s["counters"]["overtakes"]
    page.keyboard.press("m")
    reasons = set()
    t0 = time.time()
    ok = False
    lastp = None
    while time.time() - t0 < 40:
        s = snap(page)
        reasons.add(s["ego"]["reason"][:70])
        pl = s["ego"]["plan"]
        key = (pl["active"], pl["held"], pl["backup"], pl["overtake"], pl["events"])
        if key != lastp:
            print("PLAN", round(s["simTime"], 1), pl, round(s["ego"]["speedKmh"], 1))
            lastp = key
        if s["counters"]["overtakes"] > before:
            ok = True
            break
        time.sleep(0.2)
    print("menyalip setelah autopilot:", ok, "tabrakan", s["counters"]["collisions"])
    for r in sorted(reasons):
        if "Lampu" not in r:
            print("  -", r)
    shot(page, "backup_end.png")
    for d in snap(page).get("debug", []): print("DEBUG", d)
    print("LOG:", "\n".join(log[:20]) or "(kosong)")
    b.close()
