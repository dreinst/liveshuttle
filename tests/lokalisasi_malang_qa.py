"""QA pelajaran Lokalisasi (rute Alun-alun Merdeka Malang) lewat UI, seperti pelajar.

Menyelesaikan kelima tugas dengan klik atau ketuk sungguhan, mencoba kemudi dengan estimasi,
jeda, kecepatan, Ulangi, ringkasan, dan uji kebocoran navigasi. Memeriksa juga nama jalan di HUD,
penghitung aturan keselamatan (window.__lokalisasi.safety harus 0), dan kesalahan konsol.

Pemakaian: python3 tests/lokalisasi_malang_qa.py [--mobile] [--port 8244] [--gpu]
Butuh server: python3 tests/serve.py 8244
"""
import json
import os
import re
import sys
import time

from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
MOBILE = "--mobile" in sys.argv
GPU = "--gpu" in sys.argv
PORT = sys.argv[sys.argv.index("--port") + 1] if "--port" in sys.argv else "8244"
BASE = f"http://127.0.0.1:{PORT}/"
SHOTS = "/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/lokalisasi-malang/"
TAG = "m" if MOBILE else "d"
os.makedirs(SHOTS, exist_ok=True)

msgs = []
R = {"viewport": "mobile 390x844" if MOBILE else "desktop 1366x900", "fallbackClicks": 0}


def hook(page):
    return page.evaluate("() => JSON.parse(JSON.stringify(window.__simotonom))")


def lok(page):
    return page.evaluate("() => window.__lokalisasi ? { safety: window.__lokalisasi.safety, state: window.__lokalisasi.state } : null")


def status(page):
    return page.locator(".sim-status").inner_text()


def press(page, loc):
    loc.scroll_into_view_if_needed()
    try:
        if MOBILE:
            loc.tap(timeout=3000)
        else:
            loc.click(timeout=3000)
    except Exception:
        R["fallbackClicks"] += 1
        loc.dispatch_event("click")


def toggle_loc(page, label):
    return page.locator(".ctl-toggle").filter(has=page.locator(".toggle-label", has_text=re.compile(f"^{re.escape(label)}")))


def toggle(page, label):
    press(page, toggle_loc(page, label).first)
    page.wait_for_timeout(150)


def is_on(page, label):
    return toggle_loc(page, label).first.get_attribute("aria-checked") == "true"


def readout(page, label):
    return page.locator(".readout", has_text=label).first.locator(".readout-value").inner_text()


def go_next(page):
    press(page, page.locator(".step-nav .btn-primary"))
    page.wait_for_timeout(400)


def wait_task(page, task, timeout=60, on_poll=None):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if task in hook(page)["completedTasks"]:
            return round(time.time() - t0, 1)
        if on_poll:
            on_poll()
        page.wait_for_timeout(200)
    return None


def top(page):
    page.evaluate("() => window.scrollTo(0, 0)")
    page.wait_for_timeout(150)


def stage_shot(page, name):
    top(page)
    page.locator(".stage").screenshot(path=f"{SHOTS}qa-{TAG}-{name}.png")


def page_shot(page, name, full=False):
    top(page)
    page.screenshot(path=f"{SHOTS}qa-{TAG}-{name}.png", full_page=full)


def chips(page):
    return page.evaluate("() => [...document.querySelectorAll('.hud-chip')].filter(c => !c.hidden).map(c => c.innerText.replace(/\\s+/g, ' ').trim())")


def text_problems(page):
    txt = page.evaluate("() => document.querySelector('.page-lesson') ? document.querySelector('.page-lesson').innerText : document.body.innerText")
    return re.findall(r"NaN|undefined|Infinity|\[object|\bnull\b|\d\.\d{1,2}\s?(?:m|detik|km/jam)\b|\u2014|\u2013", txt)


with sync_playwright() as pw:
    args = ["--use-angle=metal", "--enable-gpu"] if GPU else []
    browser = pw.chromium.launch(executable_path=CHROME, headless=True, args=args)
    if MOBILE:
        bctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    else:
        bctx = browser.new_context(viewport={"width": 1366, "height": 900}, device_scale_factor=1)
    page = bctx.new_page()
    page.on("console", lambda m: msgs.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: msgs.append(f"pageerror: {e}"))

    page.goto(BASE + "#/", wait_until="load")
    page.evaluate("() => localStorage.clear()")
    page.goto(BASE + "#/pelajaran/lokalisasi", wait_until="load")
    for _ in range(40):
        if hook(page)["lessonStatus"] == "ready" and lok(page):
            break
        page.wait_for_timeout(150)
    h = hook(page)
    R["start"] = {k: h[k] for k in ("stepIndex", "stepCount", "lessonStatus", "activeLoops", "completedTasks")}
    R["route"] = page.evaluate("() => window.__lokalisasi.route")
    page.wait_for_timeout(1200)
    R["chipsStart"] = chips(page)
    stage_shot(page, "0-awal")

    # ---------- langkah 1: GPS saja ----------
    toggle(page, "GPS")
    R["gps-only"] = wait_task(page, "gps-only", 30)
    R["status1"] = status(page)
    stage_shot(page, "1-gps")
    toggle(page, "Kemudikan dengan estimasi")
    page.wait_for_timeout(8000)
    R["steerGps"] = {"keluar": readout(page, "Keluar lajur"), "ambil": readout(page, "Diambil alih"), "status": status(page), "chips": chips(page)}
    stage_shot(page, "1b-kemudi-gps")
    toggle(page, "Kemudikan dengan estimasi")
    go_next(page)

    # ---------- langkah 2: zona gedung tinggi ----------
    R["s2_gps_off_on_entry"] = not is_on(page, "GPS")
    toggle(page, "GPS")
    seen = {"jump": False, "zone": False}

    def poll2():
        st = status(page)
        if not seen["jump"] and "memantul" in st:
            seen["jump"] = True
            stage_shot(page, "2a-lompatan")
            R["s2_jump_status"] = st
            R["s2_jump_chips"] = chips(page)
        if not seen["zone"] and "zona gedung tinggi. Hanya" in st:
            seen["zone"] = True
            stage_shot(page, "2b-di-zona")

    R["urban-canyon"] = wait_task(page, "urban-canyon", 60, poll2)
    R["s2_seen"] = dict(seen)
    stage_shot(page, "2-kanyon")
    go_next(page)

    # ---------- langkah 3: odometri ----------
    toggle(page, "Odometri dan IMU")
    R["odometry-drift"] = wait_task(page, "odometry-drift", 60)
    R["status3"] = status(page)
    stage_shot(page, "3-odometri")
    go_next(page)

    # ---------- langkah 4: fusi ----------
    R["s4_notDoneBefore"] = "fusion" not in hook(page)["completedTasks"]
    toggle(page, "Fusi (filter Kalman)")
    R["fusion"] = wait_task(page, "fusion", 25)
    page.wait_for_timeout(2500)
    R["status4"] = status(page)
    R["bobot"] = readout(page, "Bobot GPS")
    stage_shot(page, "4-fusi")
    go_next(page)

    # ---------- langkah 5: pencocokan peta ----------
    toggle(page, "Pencocokan peta (LiDAR)")
    R["landmark"] = wait_task(page, "landmark", 40)
    R["status5"] = status(page)
    stage_shot(page, "5-peta")
    toggle(page, "Kemudikan dengan estimasi")
    page.wait_for_timeout(9000)
    R["steerMap"] = {"keluar": readout(page, "Keluar lajur"), "ambil": readout(page, "Diambil alih"), "jarak": readout(page, "Jarak ke tengah lajur")}
    R["lidarPoints"] = lok(page)["state"]["lidarPoints"]
    stage_shot(page, "5b-kemudi-peta")
    page_shot(page, "5c-halaman", full=True)

    # ---------- jeda, kecepatan, ulangi ----------
    press(page, page.locator('[data-act="pause"]'))
    page.wait_for_timeout(300)
    t0 = lok(page)["state"]["simT"]
    page.wait_for_timeout(1500)
    R["pause"] = {"paused": hook(page)["paused"], "simFrozen": lok(page)["state"]["simT"] == t0}
    press(page, page.locator('[data-act="pause"]'))
    press(page, page.locator(".speed-wrap .seg-btn", has_text="2x"))
    t0 = lok(page)["state"]["simT"]
    w0 = time.time()
    page.wait_for_timeout(3000)
    R["speed2x"] = {"hook": hook(page)["speed"], "simPerWall": round((lok(page)["state"]["simT"] - t0) / (time.time() - w0), 2)}
    press(page, page.locator(".speed-wrap .seg-btn", has_text="1x"))
    press(page, page.locator('[data-act="reset"]'))
    page.wait_for_timeout(600)
    R["afterReset"] = {"paused": hook(page)["paused"], "loops": hook(page)["activeLoops"], "keluar": readout(page, "Keluar lajur"), "simT": lok(page)["state"]["simT"]}

    # ---------- ringkasan ----------
    go_next(page)
    page.wait_for_timeout(500)
    h = hook(page)
    R["summary"] = {"stepIndex": h["stepIndex"], "completed": sorted(h["completedTasks"])}
    page_shot(page, "6-ringkasan")
    R["safety"] = lok(page)["safety"] if lok(page) else None
    R["textProblems"] = text_problems(page)

    # ---------- navigasi berulang ----------
    for _ in range(5):
        page.evaluate("() => { location.hash = '#/' }")
        page.wait_for_timeout(400)
        page.evaluate("() => { location.hash = '#/pelajaran/lokalisasi' }")
        page.wait_for_timeout(900)
    R["afterNav"] = {
        "loops": hook(page)["activeLoops"],
        "canvases": page.evaluate("() => document.querySelectorAll('canvas').length"),
        "styleTags": page.evaluate("() => document.querySelectorAll('style[data-lesson]').length"),
        "hookPresent": page.evaluate("() => !!window.__lokalisasi"),
    }
    page.evaluate("() => { location.hash = '#/' }")
    page.wait_for_timeout(600)
    R["home"] = {"loops": hook(page)["activeLoops"], "hookGone": page.evaluate("() => !window.__lokalisasi")}
    R["console"] = [m for m in msgs if "GPU stall due to ReadPixels" not in m]
    browser.close()

print(json.dumps(R, indent=1, ensure_ascii=False))
tasks = ("gps-only", "urban-canyon", "odometry-drift", "fusion", "landmark")
ok = all(R.get(k) is not None for k in tasks) and not R["console"] and R["safety"] and R["safety"]["pedestrianContacts"] == 0 and R["safety"]["redLightViolations"] == 0
sys.exit(0 if ok else 1)
