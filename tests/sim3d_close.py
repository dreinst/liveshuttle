"""Uji rintangan tepat setelah tikungan: mobil tidak boleh terkunci terlalu dekat dengan rintangan."""
import time

from sim3d_common import BASE, launch, new_page, snap, wait_ready, wait_until, shot, sync_playwright

with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b)
    page.goto(f"{BASE}/tests/sim3d_harness.html?mode=bebas")
    wait_ready(page)
    page.keyboard.press("3")
    results = []
    for attempt in range(6):
        # tunggu mobil sedang di persimpangan (di konektor), lalu taruh mobil mogok di ruas berikutnya
        s = wait_until(page, lambda s: s["ego"]["limiter"].startswith("Tikungan") or "persimpangan" in s["ego"]["reason"].lower(), 60)
        before = snap(page)["counters"]["overtakes"]
        page.keyboard.press("o")
        t0 = time.time()
        ok = False
        seen = set()
        while time.time() - t0 < 40:
            s = snap(page)
            seen.add(s["ego"]["behavior"])
            if s["counters"]["overtakes"] > before:
                ok = True
                break
            time.sleep(0.25)
        results.append((attempt, ok, sorted(seen), s["counters"]["collisions"]))
        page.click(".s3d-panel[data-tab='uji'] .s3d-panel-head") if attempt == 0 else None
        page.click("button:has-text('Hapus rintangan')")
        time.sleep(1)
    for r in results:
        print(r)
    shot(page, "close_end.png")
    for d in snap(page).get("debug", []):
        print("DEBUG", d)
    print("LOG:", "\n".join(log[:20]) or "(kosong)")
    b.close()
