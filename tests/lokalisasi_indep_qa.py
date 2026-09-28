"""QA independen pelajaran Lokalisasi, lewat UI seperti pelajar.

Memeriksa: tugas tidak selesai sendiri tanpa aksi, kelima tugas bisa diselesaikan dengan klik,
ketuk dan tombol keyboard, penggeser sigma, Jeda, kecepatan, Ulangi, kemudi dengan estimasi,
bolak-balik langkah, ringkasan, dan kebocoran loop atau listener setelah 5 kali keluar masuk.

Pemakaian: python3 tests/lokalisasi_indep_qa.py [--mobile] [--port 8134] [--skip-idle]
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
PORT = sys.argv[sys.argv.index("--port") + 1] if "--port" in sys.argv else "8134"
SKIP_IDLE = "--skip-idle" in sys.argv
BASE = f"http://127.0.0.1:{PORT}/"
SHOTS = "/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/lokalisasi-qa/"
TAG = "m" if MOBILE else "d"
os.makedirs(SHOTS, exist_ok=True)

msgs = []
R = {"viewport": "mobile 390x844" if MOBILE else "desktop 1366x900", "fallbackClicks": 0}


def hook(page):
    return page.evaluate("() => JSON.parse(JSON.stringify(window.__simotonom))")


def status(page):
    return page.locator(".sim-status").inner_text()


def press(page, loc):
    """Klik (desktop) atau ketuk (ponsel) sungguhan; dispatch hanya bila tertutup toast."""
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
    page.wait_for_timeout(350)


def go_back(page):
    press(page, page.locator(".step-nav .btn-secondary"))
    page.wait_for_timeout(350)


def go_dot(page, i):
    press(page, page.locator(f'.step-dot[data-go="{i}"]'))
    page.wait_for_timeout(350)


def wait_task(page, task, timeout=60):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if task in hook(page)["completedTasks"]:
            return round(time.time() - t0, 1)
        page.wait_for_timeout(200)
    return None


def top(page):
    page.evaluate("() => window.scrollTo(0, 0)")
    page.wait_for_timeout(120)


def stage_shot(page, name):
    top(page)
    page.locator(".stage").screenshot(path=f"{SHOTS}{TAG}-{name}-stage.png")


def page_shot(page, name, full=True):
    top(page)
    page.screenshot(path=f"{SHOTS}{TAG}-{name}-page.png", full_page=full)


def odo_age(page):
    m = re.search(r"setelah (\d+) detik", status(page))
    return int(m.group(1)) if m else None


def listener_counts(page, cdp):
    out = {}
    for name in ("window", "document"):
        obj = cdp.send("Runtime.evaluate", {"expression": name})["result"]["objectId"]
        out[name] = len(cdp.send("DOMDebugger.getEventListeners", {"objectId": obj})["listeners"])
    out["loops"] = hook(page)["activeLoops"]
    out["canvases"] = page.evaluate("() => document.querySelectorAll('canvas').length")
    out["lessonStyles"] = page.evaluate("() => document.querySelectorAll('style[data-lesson]').length")
    out["toasts"] = page.evaluate("() => document.querySelectorAll('.toast').length")
    return out


def text_problems(page):
    """Cari NaN, undefined, Infinity, [object atau titik desimal gaya Inggris di teks halaman."""
    txt = page.evaluate("() => document.querySelector('.page-lesson').innerText")
    bad = re.findall(r"NaN|undefined|Infinity|\[object|\bnull\b|\d\.\d{1,2}\s?(?:m|detik|km/jam)\b", txt)
    return bad


with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=CHROME, headless=True)
    if MOBILE:
        bctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    else:
        bctx = browser.new_context(viewport={"width": 1366, "height": 900}, device_scale_factor=1)
    page = bctx.new_page()
    page.on("console", lambda m: msgs.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: msgs.append(f"pageerror: {e}"))
    cdp = bctx.new_cdp_session(page)

    page.goto(BASE + "#/", wait_until="load")
    page.evaluate("() => localStorage.clear()")
    page.wait_for_timeout(500)
    R["listenersHome0"] = listener_counts(page, cdp)
    page.goto(BASE + "#/pelajaran/lokalisasi", wait_until="load")
    page.wait_for_timeout(1500)
    h = hook(page)
    R["start"] = {k: h[k] for k in ("stepIndex", "stepCount", "lessonStatus", "activeLoops", "completedTasks")}
    R["startToggles"] = {n: is_on(page, n) for n in ("GPS", "Odometri", "Fusi", "Pencocokan", "Kemudikan")}

    # ---------- A. tanpa aksi: tidak boleh ada tugas yang selesai sendiri ----------
    if not SKIP_IDLE:
        idle = {}
        for i in range(5):
            if i:
                go_next(page)
            t0 = time.time()
            page.wait_for_timeout(14000)
            idle[i] = {"completed": hook(page)["completedTasks"], "status": status(page)}
        R["idleNoAction"] = idle
        # kembali ke langkah 1 dengan tombol Kembali, lalu hapus progres agar bagian B bersih
        page.evaluate("() => localStorage.clear()")
        page.reload(wait_until="load")  # progres juga disimpan di memori, jadi muat ulang penuh
        page.wait_for_timeout(1500)
        for _ in range(6):
            if hook(page)["stepIndex"] == 0:
                break
            go_back(page)
        R["afterIdleReload"] = {k: hook(page)[k] for k in ("stepIndex", "completedTasks")}

    # ---------- B1. langkah 1: GPS saja ----------
    stage_shot(page, "s1-awal")
    toggle(page, "Odometri")  # coba dulu dengan estimasi lain menyala: tugas tidak boleh selesai
    toggle(page, "GPS")
    page.wait_for_timeout(7000)
    R["gpsWithOdoOn_notDone"] = "gps-only" not in hook(page)["completedTasks"]
    R["status1_mixed"] = status(page)
    toggle(page, "Odometri")
    R["gps-only"] = wait_task(page, "gps-only", 30)
    R["status1"] = status(page)
    stage_shot(page, "s1-gps")
    page_shot(page, "s1-gps")

    # penggeser sigma dengan keyboard
    slider = page.locator(".ctl-slider input[type=range]").first
    slider.scroll_into_view_if_needed()
    slider.focus()
    page.keyboard.press("End")
    page.wait_for_timeout(1500)
    R["sigma5"] = {"value": page.locator(".ctl-slider .ctl-value").first.inner_text(), "akurasi": readout(page, "Akurasi klaim")}
    page.keyboard.press("Home")
    page.wait_for_timeout(1500)
    R["sigma05"] = {"value": page.locator(".ctl-slider .ctl-value").first.inner_text(), "akurasi": readout(page, "Akurasi klaim")}
    for _ in range(3):
        page.keyboard.press("ArrowRight")
    page.wait_for_timeout(1200)
    R["sigmaBack"] = {"value": page.locator(".ctl-slider .ctl-value").first.inner_text(), "akurasi": readout(page, "Akurasi klaim")}

    # kemudi dengan estimasi GPS
    toggle(page, "Kemudikan")
    page.wait_for_timeout(9000)
    R["steerGps"] = {"keluar": readout(page, "Keluar lajur"), "ambil": readout(page, "Diambil alih"), "status": status(page)}
    stage_shot(page, "s1-kemudi-gps")
    toggle(page, "Kemudikan")

    # ---------- B2. langkah 2: zona gedung tinggi ----------
    go_next(page)
    R["s2_toggles_on_entry"] = {n: is_on(page, n) for n in ("GPS", "Odometri", "Fusi", "Pencocokan")}
    R["s2_status_entry"] = status(page)
    if not is_on(page, "GPS"):
        toggle(page, "GPS")
    jump = {"shot": False}
    t0 = time.time()
    done_at = None
    while time.time() - t0 < 80:
        if not jump["shot"] and "memantul" in status(page):
            jump["shot"] = True
            stage_shot(page, "s2-lompatan")
            R["s2_jump_status"] = status(page)
        if "urban-canyon" in hook(page)["completedTasks"]:
            done_at = round(time.time() - t0, 1)
            break
        page.wait_for_timeout(150)
    R["urban-canyon"] = done_at
    page.wait_for_timeout(300)
    stage_shot(page, "s2-kanyon")
    page_shot(page, "s2-kanyon", full=False)

    # ---------- B3. langkah 3: odometri ----------
    go_next(page)
    toggle(page, "Odometri")
    page.wait_for_timeout(3000)
    # jeda: waktu odometri tidak boleh bertambah
    press(page, page.locator('[data-act="pause"]'))
    page.wait_for_timeout(300)
    a0 = odo_age(page)
    s0 = status(page)
    page.wait_for_timeout(2500)
    R["pause"] = {"paused": hook(page)["paused"], "age0": a0, "age1": odo_age(page), "statusSame": s0 == status(page),
                  "btn": page.locator('[data-act="pause"]').inner_text()}
    press(page, page.locator('[data-act="pause"]'))
    page.wait_for_timeout(300)
    R["resumed"] = not hook(page)["paused"]
    # kecepatan 2x dan 0,5x
    speed = {}
    for label in ("2x", "0,5x", "1x"):
        press(page, page.locator(".speed-wrap .seg-btn", has_text=label))
        page.wait_for_timeout(300)
        a = odo_age(page)
        tw = time.time()
        page.wait_for_timeout(4000)
        speed[label] = {"hookSpeed": hook(page)["speed"], "simPerWall": round((odo_age(page) - a) / (time.time() - tw), 2)}
    R["speed"] = speed
    R["odometry-drift"] = wait_task(page, "odometry-drift", 45)
    R["status3"] = status(page)
    stage_shot(page, "s3-odo")
    # Ulangi
    before = odo_age(page)
    press(page, page.locator('[data-act="reset"]'))
    page.wait_for_timeout(700)
    R["reset"] = {"ageBefore": before, "ageAfter": odo_age(page), "paused": hook(page)["paused"],
                  "keluar": readout(page, "Keluar lajur"), "odoStillOn": is_on(page, "Odometri"), "status": status(page)}

    # ---------- B4. langkah 4: fusi ----------
    go_next(page)
    R["s4_toggles_on_entry"] = {n: is_on(page, n) for n in ("GPS", "Odometri", "Fusi", "Pencocokan")}
    page.wait_for_timeout(2500)
    R["s4_notDoneBeforeToggle"] = "fusion" not in hook(page)["completedTasks"]
    toggle(page, "Fusi")
    R["fusion"] = wait_task(page, "fusion", 20)
    page.wait_for_timeout(4000)
    R["status4"] = status(page)
    R["bobot"] = readout(page, "Bobot GPS")
    stage_shot(page, "s4-fusi")
    page_shot(page, "s4-fusi")

    # ---------- B5. langkah 5: pencocokan peta ----------
    go_next(page)
    page.wait_for_timeout(1500)
    R["s5_notDoneBeforeToggle"] = "landmark" not in hook(page)["completedTasks"]
    toggle(page, "Pencocokan")
    R["landmark"] = wait_task(page, "landmark", 40)
    R["status5"] = status(page)
    stage_shot(page, "s5-peta")
    toggle(page, "Kemudikan")
    page.wait_for_timeout(9000)
    R["steerMap"] = {"keluar": readout(page, "Keluar lajur"), "ambil": readout(page, "Diambil alih"), "simpangan": readout(page, "Simpangan lajur")}
    stage_shot(page, "s5-kemudi-peta")
    page_shot(page, "s5-peta")
    # matikan estimasi yang dipakai kemudi: kemudi harus ikut mati
    toggle(page, "Pencocokan")
    page.wait_for_timeout(300)
    R["steerOffWhenEstimateOff"] = not is_on(page, "Kemudikan")

    # ---------- C. ringkasan dan bolak-balik langkah ----------
    go_next(page)
    page.wait_for_timeout(600)
    h = hook(page)
    R["summary"] = {"stepIndex": h["stepIndex"], "completed": h["completedTasks"],
                    "title": page.locator(".step-title").inner_text()}
    page_shot(page, "ringkasan", full=False)
    R["progressStored"] = page.evaluate("() => localStorage.getItem('simotonom.progress.v1')")
    hops = [0, 4, 2, 5, 1, 3, 0]
    for i in hops:
        go_dot(page, i)
    for _ in range(5):
        go_next(page)
    for _ in range(5):
        go_back(page)
    for _ in range(12):  # cepat
        page.locator(".step-nav .btn-primary").dispatch_event("click")
        page.wait_for_timeout(40)
        page.locator(".step-nav .btn-secondary").dispatch_event("click")
        page.wait_for_timeout(40)
    page.wait_for_timeout(1200)
    R["afterHop"] = {"step": hook(page)["stepIndex"], "loops": hook(page)["activeLoops"], "textProblems": text_problems(page)}

    # ---------- D. keluar masuk 5 kali ----------
    R["listenersLesson0"] = listener_counts(page, cdp)
    for _ in range(5):
        page.evaluate("() => { location.hash = '#/' }")
        page.wait_for_timeout(700)
        page.evaluate("() => { location.hash = '#/pelajaran/lokalisasi' }")
        page.wait_for_timeout(1200)
    R["listenersLesson5"] = listener_counts(page, cdp)
    page.evaluate("() => { location.hash = '#/' }")
    page.wait_for_timeout(900)
    R["listenersHome5"] = listener_counts(page, cdp)
    page.evaluate("() => { location.hash = '#/pelajaran/lokalisasi' }")
    page.wait_for_timeout(1500)
    R["reentryStep"] = hook(page)["stepIndex"]

    R["console"] = msgs
    print(json.dumps(R, indent=1, ensure_ascii=False))
    browser.close()
