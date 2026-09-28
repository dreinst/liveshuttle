"""Uji aturan keselamatan pelajaran Lokalisasi: berusaha keras membuat mobil menabrak pejalan kaki.

Skenario (lewat UI, kecepatan 2x): kemudi dengan GPS pada noise 5 m (mobil oleng sampai trotoar),
lalu odometri dan fusi, penyeberang dimunculkan berulang-ulang lewat kait uji
(window.__lokalisasi.spawnPedestrian, tetap memakai gap acceptance), Ulangi di tengah
penyeberangan, Jeda dan Lanjutkan, pindah langkah. Setiap detik penghitung dibaca:
"Kontak dengan pejalan kaki" dan "Terobos lampu merah" harus tetap 0. Mobil juga tidak boleh
macet selamanya (lama berhenti terpanjang dicatat dalam detik simulasi).

Pemakaian: python3 tests/lokalisasi_safety.py [--mobile] [--port 8244] [--minutes 3]
"""
import json
import sys
import time

from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
MOBILE = "--mobile" in sys.argv
PORT = sys.argv[sys.argv.index("--port") + 1] if "--port" in sys.argv else "8244"
MINUTES = float(sys.argv[sys.argv.index("--minutes") + 1]) if "--minutes" in sys.argv else 3.0
BASE = f"http://127.0.0.1:{PORT}/"
msgs = []
R = {"viewport": "mobile" if MOBILE else "desktop", "violations": [], "samples": 0}


def state(page):
    return page.evaluate("() => ({ safety: window.__lokalisasi.safety, state: window.__lokalisasi.state })")


def click(page, loc):
    loc.scroll_into_view_if_needed()
    if MOBILE:
        loc.tap(timeout=3000)
    else:
        loc.click(timeout=3000)


def toggle(page, text):
    click(page, page.locator(".ctl-toggle", has_text=text).first)
    page.wait_for_timeout(120)


def is_on(page, text):
    return page.locator(".ctl-toggle", has_text=text).first.get_attribute("aria-checked") == "true"


def seg(page, text):
    click(page, page.locator(".grp-steer .seg-btn", has_text=text).first)


with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=CHROME, headless=True)
    if MOBILE:
        bctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    else:
        bctx = browser.new_context(viewport={"width": 1366, "height": 900})
    page = bctx.new_page()
    page.on("console", lambda m: msgs.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: msgs.append(f"pageerror: {e}"))
    page.goto(BASE + "#/", wait_until="load")
    page.evaluate("() => localStorage.clear()")
    page.goto(BASE + "#/pelajaran/lokalisasi", wait_until="load")
    page.wait_for_function("() => window.__lokalisasi && window.__simotonom.lessonStatus === 'ready'")

    # noise GPS maksimum, GPS menyala, kemudi dengan GPS, kecepatan 2x
    toggle(page, "GPS")
    slider = page.locator(".ctl-slider input[type=range]").first
    slider.scroll_into_view_if_needed()
    slider.focus()
    page.keyboard.press("End")
    toggle(page, "Kemudikan dengan estimasi")
    click(page, page.locator(".speed-wrap .seg-btn", has_text="2x"))

    t_end = time.time() + MINUTES * 60
    last_spawn = 0
    last_action = time.time()
    action = 0
    stopped_since = None
    max_stopped = 0.0
    spawned = 0
    phases = ["gps", "odo", "fus", "reset", "pause", "gps", "step2", "gps"]
    while time.time() < t_end:
        now = time.time()
        # penyeberang berulang-ulang (2 per 1,5 detik), dari kedua sisi
        if now - last_spawn > 1.5:
            last_spawn = now
            got = page.evaluate("() => [window.__lokalisasi.spawnPedestrian(true), window.__lokalisasi.spawnPedestrian(false)]")
            spawned += sum(1 for g in got if g)
        # aksi pelajar bergantian tiap 12 detik
        if now - last_action > 12:
            last_action = now
            ph = phases[action % len(phases)]
            action += 1
            if ph == "gps":
                seg(page, "GPS")
                if not is_on(page, "Kemudikan dengan estimasi"):
                    toggle(page, "Kemudikan dengan estimasi")
            elif ph == "odo":
                seg(page, "Odometri")
            elif ph == "fus":
                seg(page, "Fusi")
            elif ph == "reset":
                click(page, page.locator('[data-act="reset"]'))
            elif ph == "pause":
                click(page, page.locator('[data-act="pause"]'))
                page.wait_for_timeout(700)
                click(page, page.locator('[data-act="pause"]'))
            elif ph == "step2":
                page.locator('.step-dot[data-go="1"]').dispatch_event("click")
                page.wait_for_timeout(300)
                toggle(page, "GPS")  # langkah 2 memindah mobil ke dekat zona (dan dekat zebra cross)
                toggle(page, "Kemudikan dengan estimasi")
                click(page, page.locator(".speed-wrap .seg-btn", has_text="2x"))
        s = state(page)
        R["samples"] += 1
        sf = s["safety"]
        if sf["pedestrianContacts"] or sf["redLightViolations"]:
            R["violations"].append({"t": round(MINUTES * 60 - (t_end - now), 1), "safety": sf, "state": s["state"]})
        sim = s["state"]["simT"]
        if s["state"]["speed"] < 0.05 and not page.evaluate("() => window.__simotonom.paused"):
            if stopped_since is None:
                stopped_since = sim
            max_stopped = max(max_stopped, sim - stopped_since)
        else:
            stopped_since = None
        page.wait_for_timeout(250)

    final = state(page)
    R["final"] = final
    R["spawnedAccepted"] = spawned
    R["maxStoppedSimSeconds"] = round(max_stopped, 1)
    R["console"] = [m for m in msgs if "GPU stall due to ReadPixels" not in m]
    browser.close()

print(json.dumps(R, indent=1, ensure_ascii=False))
ok = not R["violations"] and R["final"]["safety"]["pedestrianContacts"] == 0 and R["final"]["safety"]["redLightViolations"] == 0 and not R["console"]
sys.exit(0 if ok else 1)
