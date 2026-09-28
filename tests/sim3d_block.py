"""Uji dua lajur tertutup: mobil harus berhenti dan menjelaskan, lalu jalan lagi setelah rintangan dihapus."""
import math
import time

from sim3d_common import BASE, launch, new_page, snap, wait_ready, wait_until, shot, sync_playwright

with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b)
    page.goto(f"{BASE}/tests/sim3d_harness.html?mode=bebas")
    wait_ready(page)
    page.keyboard.press("3")
    page.click(".s3d-panel[data-tab='uji'] .s3d-panel-head")
    page.click(".s3d-obs[data-type='kardus']")
    page.click("button:has-text('Hapus rintangan')")
    page.click("text=Taruh dengan klik di jalan")
    placed = 0
    for attempt in range(20):
        s = wait_until(page, lambda s: s["ego"]["speedKmh"] > 20 and s["ego"]["behavior"] == "Melaju", 30)
        pr = s["probe"]
        h = s["ego"]["heading"]
        rx, rz = -math.sin(h), math.cos(h)
        pts = [(pr["x"], pr["z"]), (pr["x"] + rx * 3.5, pr["z"] + rz * 3.5)]
        n0 = s["traffic"]["obstacles"]
        for x, z in pts:
            sc = page.evaluate(f"() => window.__sim3d.screenOf({x}, {z})")
            page.mouse.click(sc["x"], sc["y"])
            time.sleep(0.15)
        if snap(page)["traffic"]["obstacles"] >= n0 + 2:
            placed = 2
            break
        page.click("button:has-text('Hapus rintangan')")
    print("ditaruh", placed)
    s = wait_until(page, lambda s: s["ego"]["speedKmh"] < 0.5, 25)
    time.sleep(1.0)
    s = snap(page)
    print("berhenti:", s["ego"]["behavior"], "|", s["ego"]["reason"])
    shot(page, "block_both.png")
    page.keyboard.press("Escape")
    page.click("button:has-text('Hapus rintangan')")
    s = wait_until(page, lambda s: s["ego"]["speedKmh"] > 15, 25)
    s2 = snap(page)
    print("jalan lagi:", bool(s), s2["traffic"]["obstacles"], s2["ego"]["behavior"], s2["ego"]["reason"], s2["ego"]["limiter"], s2["ego"]["speedKmh"])
    shot(page, "block_after.png")
    print("LOG:", "\n".join(log[:20]) or "(kosong)")
    b.close()
