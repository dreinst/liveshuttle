"""Kedua lajur tertutup rintangan di depan mobil: apakah mobil mencari rute lain atau macet selamanya?
Juga: beralih ke Tutorial saat mode klik aktif dan saat autopilot mati."""
import time
from sim3d_qa_fungsi_util import BASE, launch, new_page, snap, wait_ready, wait_until, shot, text, dump, sync_playwright

R = {}


def toasts(page):
    return page.evaluate("() => [...document.querySelectorAll('.s3d-toast')].map(t => t.textContent)")


def blur(page):
    page.evaluate("() => document.activeElement && document.activeElement.blur()")


with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b)
    page.goto(f"{BASE}/#/simulator/bebas")
    wait_ready(page)
    time.sleep(1)
    page.click(".s3d-panel[data-tab=uji] .s3d-panel-head")
    # tunggu mobil di ruas lurus lalu taruh mogok di lajur kiri, kemudian mogok di lajur kanan pada titik yang sama
    ok = False
    for attempt in range(8):
        wait_until(page, lambda s: s["ego"]["behavior"] == "Melaju" and s["ego"]["speedKmh"] > 20, timeout=30)
        page.click(".s3d-obs[data-type=mogok]")
        time.sleep(0.2)
        blur(page)
        page.keyboard.press("p")
        time.sleep(0.2)
        s = snap(page)
        if s["traffic"]["obstacles"] < 1:
            page.keyboard.press("p")
            continue
        # posisi rintangan terakhir tidak ada di snapshot; gunakan klik di lajur kanan sejajar titik 40 m di depan
        page.click(".s3d-toggle:has-text('Taruh dengan klik')")
        blur(page)
        placed = False
        import re
        m = re.search(r"ditaruh (\d+) m", " ".join(toasts(page)))
        N = int(m.group(1)) if m else 40
        R.setdefault("N", []).append(N)
        for d in [N, N + 1, N - 1, N + 2, N - 2]:
            pt = page.evaluate(f"() => {{ const s = window.__sim3d; const e = s.ego; const h = e.heading; const x = e.x + Math.cos(h) * {d} - Math.sin(h) * 3.5, z = e.z + Math.sin(h) * {d} + Math.cos(h) * 3.5; const p = s.screenOf(x, z); const el = document.elementFromPoint(p.x, p.y); return {{ ...p, on: !!(el && el.classList.contains('s3d-canvas')) }}; }}")
            if not pt["on"]:
                continue
            n0 = snap(page)["traffic"]["obstacles"]
            page.mouse.click(pt["x"], pt["y"])
            time.sleep(0.25)
            if snap(page)["traffic"]["obstacles"] > n0 and "kanan" in (toasts(page) or [""])[-1]:
                placed = True
                break
        page.keyboard.press("Escape")
        if placed:
            ok = True
            page.keyboard.press("p")
            break
        page.click(".s3d-panel[data-tab=uji] button:has-text('Hapus rintangan')")
        blur(page)
        page.keyboard.press("p")
        time.sleep(3)
    R["both_blocked_setup"] = ok
    page.click(".s3d-group[data-hl=kamera] button[data-value=atas]")
    blur(page)
    trace = []
    t0 = time.time()
    while time.time() - t0 < 60:
        s = snap(page)
        trace.append((round(s["simTime"]), round(s["ego"]["speedKmh"]), s["ego"]["behavior"], s["ego"]["reason"][:70], s["ego"]["replans"], s["counters"]["collisions"]))
        if len(trace) == 12:
            shot(page, "blokir_mid.png")
        time.sleep(2)
    shot(page, "blokir_end.png")
    R["trace"] = trace
    # beralih ke Tutorial saat mode klik aktif
    page.click(".s3d-toggle:has-text('Taruh dengan klik')")
    time.sleep(0.2)
    page.click(".s3d-modes button[data-mode=tutorial]")
    time.sleep(0.6)
    R["tutorial_with_click_armed"] = (snap(page)["traffic"]["clickArmed"], page.evaluate("() => !document.querySelector('.s3d-placehint').hidden"), text(page, ".s3d-placehint span"))
    shot(page, "blokir_tutorial_armed.png")
    page.click(".s3d-modes button[data-mode=bebas]")
    time.sleep(0.4)
    blur(page)
    page.keyboard.press("m")
    time.sleep(0.3)
    page.click(".s3d-modes button[data-mode=tutorial]")
    time.sleep(0.5)
    s = snap(page)
    R["tutorial_with_autopilot_off"] = (s["ego"]["autopilot"], s["ego"]["behavior"], s["tutorial"]["step"])
    dump(R)
    print("LOG", log)
    b.close()
