"""Tambahan: J dan O saat autopilot mati, Spasi setelah menekan tombol di layar, batas kecepatan cuaca di jalan lurus."""
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
    time.sleep(1.5)
    page.click(".s3d-panel[data-tab=uji] .s3d-panel-head")
    # Spasi setelah klik tombol Pejalan kaki
    c0 = snap(page)["counters"]
    page.click(".s3d-warnbtn")
    time.sleep(0.3)
    page.keyboard.press(" ")
    time.sleep(0.5)
    s = snap(page)
    R["space_after_jaybtn"] = {"paused": s["paused"], "pendingOrJay": s["counters"]["jaywalkers"] - c0["jaywalkers"], "toasts": toasts(page)}
    page.click(".s3d-danger:has-text('Rem darurat')")
    time.sleep(0.2)
    page.keyboard.press(" ")
    time.sleep(0.3)
    s = snap(page)
    R["space_after_aebbtn"] = {"paused": s["paused"], "aebManual": s["counters"]["aebManual"] - c0["aebManual"]}
    if s["paused"]:
        page.keyboard.press("p")
    blur(page)
    time.sleep(3)
    # autopilot mati, J dan O
    page.keyboard.press("m")
    time.sleep(0.3)
    page.keyboard.down("ArrowUp")
    time.sleep(2)
    page.keyboard.up("ArrowUp")
    c0 = snap(page)["counters"]
    n0 = snap(page)["traffic"]["obstacles"]
    page.keyboard.press("j")
    time.sleep(0.3)
    t1 = toasts(page)
    page.keyboard.press("o")
    time.sleep(0.3)
    t2 = toasts(page)
    time.sleep(3)
    s = snap(page)
    R["manual_J_O"] = {"jay": s["counters"]["jaywalkers"] - c0["jaywalkers"], "obs": s["traffic"]["obstacles"] - n0, "toastJ": t1[-1:], "toastO": t2[-1:], "speed": round(s["ego"]["speedKmh"])}
    shot(page, "extra_manual_jo.png")
    page.keyboard.press("m")
    time.sleep(0.5)
    R["M_back"] = (snap(page)["ego"]["autopilot"], toasts(page)[-1:])
    page.click(".s3d-panel[data-tab=uji] button:has-text('Hapus rintangan')")
    blur(page)
    # batas cuaca: ambil kecepatan maksimum selama 25 detik di tiap cuaca
    for w in ["hujan", "kabut", "malam", "cerah"]:
        page.click(f".s3d-group[data-hl=cuaca] button[data-value={w}]")
        blur(page)
        time.sleep(2)
        mx = 0
        reasons = set()
        t0 = time.time()
        while time.time() - t0 < 25:
            s = snap(page)
            mx = max(mx, s["ego"]["speedKmh"])
            if "uaca" in s["ego"]["limiter"] or "abut" in s["ego"]["reason"] or "ujan" in s["ego"]["reason"] or "alam" in s["ego"]["reason"]:
                reasons.add(s["ego"]["limiter"] + " | " + s["ego"]["reason"])
            time.sleep(0.25)
        R["cap_" + w] = (round(mx, 1), sorted(reasons)[:3])
    dump(R)
    print("LOG", log)
    b.close()
