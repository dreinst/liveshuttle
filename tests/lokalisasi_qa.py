"""QA pelajaran Lokalisasi lewat UI, seperti pelajar: semua tugas, kemudi dengan estimasi,
jeda, kecepatan, ulangi, ringkasan, dan uji kebocoran navigasi.

Pemakaian: python3 tests/lokalisasi_qa.py [--mobile] [--port 8114]
Butuh server statis yang sudah berjalan di port itu.
"""
import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
MOBILE = "--mobile" in sys.argv
PORT = sys.argv[sys.argv.index("--port") + 1] if "--port" in sys.argv else "8114"
BASE = f"http://127.0.0.1:{PORT}/"
SHOTS = "/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/lokalisasi/"
TAG = "m" if MOBILE else "d"
os.makedirs(SHOTS, exist_ok=True)

errors = []
results = {}


def hook(page):
    return page.evaluate("() => JSON.parse(JSON.stringify(window.__simotonom))")


def status(page):
    return page.locator(".sim-status").inner_text()


def shot(page, name, full=False):
    page.screenshot(path=f"{SHOTS}qa-{TAG}-{name}.png", full_page=full)


def stage_shot(page, name):
    page.locator(".stage").screenshot(path=f"{SHOTS}qa-{TAG}-{name}.png")


def wait_task(page, task, timeout=40, on_poll=None):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if task in hook(page)["completedTasks"]:
            return round(time.time() - t0, 1)
        if on_poll:
            on_poll()
        page.wait_for_timeout(200)
    return None


def toggle(page, name):
    loc = page.locator(".ctl-toggle", has_text=name).first
    loc.scroll_into_view_if_needed()
    loc.click()


def next_step(page):
    page.locator(".step-nav .btn-primary").dispatch_event("click")
    page.wait_for_timeout(400)


def readout(page, label):
    return page.locator(".readout", has_text=label).first.locator(".readout-value").inner_text()


def top(page):
    page.evaluate("() => window.scrollTo(0, 0)")
    page.wait_for_timeout(150)


with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=CHROME, headless=True)
    if MOBILE:
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    else:
        ctx = browser.new_context(viewport={"width": 1366, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

    page.goto(BASE + "#/", wait_until="load")
    page.evaluate("() => localStorage.clear()")
    page.goto(BASE + "#/pelajaran/lokalisasi", wait_until="load")
    page.wait_for_timeout(1500)
    h = hook(page)
    results["start"] = {"step": h["stepIndex"], "status": h["lessonStatus"], "loops": h["activeLoops"], "steps": h["stepCount"]}

    # langkah 1: GPS saja
    toggle(page, "GPS")
    results["gps-only"] = wait_task(page, "gps-only", 25)
    results["status1"] = status(page)
    top(page)
    shot(page, "1-gps")
    # kemudi dengan estimasi GPS: mobil harus oleng dan diambil alih
    toggle(page, "Kemudikan dengan estimasi")
    page.wait_for_timeout(6000)
    results["steer-gps"] = {"keluar": readout(page, "Keluar lajur"), "ambil": readout(page, "Diambil alih"), "status": status(page)}
    top(page)
    stage_shot(page, "1b-kemudi-gps")
    toggle(page, "Kemudikan dengan estimasi")
    next_step(page)

    # langkah 2: zona gedung tinggi (preset memindah mobil ke dekat zona dan mematikan GPS,
    # jadi pelajar harus menyalakan GPS sendiri)
    toggle(page, "GPS")
    jump_shot = {"done": False}

    def poll_jump():
        if not jump_shot["done"] and "memantul" in status(page):
            jump_shot["done"] = True
            top(page)
            stage_shot(page, "2a-lompatan")

    results["urban-canyon"] = wait_task(page, "urban-canyon", 40, poll_jump)
    results["jump_seen_in_status"] = jump_shot["done"]
    top(page)
    shot(page, "2-kanyon")
    next_step(page)

    # langkah 3: odometri saja
    toggle(page, "Odometri dan IMU")
    results["odometry-drift"] = wait_task(page, "odometry-drift", 50)
    results["status3"] = status(page)
    top(page)
    shot(page, "3-odometri")
    next_step(page)

    # langkah 4: fusi
    toggle(page, "Fusi")
    results["fusion"] = wait_task(page, "fusion", 20)
    page.wait_for_timeout(2000)
    results["status4"] = status(page)
    results["bobot"] = readout(page, "Bobot GPS")
    top(page)
    shot(page, "4-fusi")
    next_step(page)

    # langkah 5: pencocokan peta
    toggle(page, "Pencocokan peta")
    results["landmark"] = wait_task(page, "landmark", 30)
    results["status5"] = status(page)
    top(page)
    shot(page, "5-peta")
    stage_shot(page, "5a-peta-stage")
    # kemudi dengan estimasi Peta: mobil harus tetap di lajur
    toggle(page, "Kemudikan dengan estimasi")
    page.wait_for_timeout(6000)
    results["steer-map"] = {"keluar": readout(page, "Keluar lajur"), "ambil": readout(page, "Diambil alih"), "simpangan": readout(page, "Simpangan lajur")}
    top(page)
    shot(page, "5b-kemudi-peta", full=True)

    # jeda, kecepatan, ulangi
    page.locator('[data-act="pause"]').click()
    page.wait_for_timeout(300)
    results["paused"] = hook(page)["paused"]
    s1 = status(page)
    page.wait_for_timeout(800)
    results["status_stable_when_paused"] = s1 == status(page)
    page.locator('[data-act="pause"]').click()
    page.locator(".speed-wrap .seg-btn", has_text="2x").click()
    results["speed2"] = hook(page)["speed"]
    page.locator(".speed-wrap .seg-btn", has_text="1x").click()
    page.locator('[data-act="reset"]').click()
    page.wait_for_timeout(500)
    results["afterReset"] = {k: hook(page)[k] for k in ("paused", "lessonStatus", "activeLoops")}
    results["afterResetCounters"] = {"keluar": readout(page, "Keluar lajur"), "ambil": readout(page, "Diambil alih")}

    # ringkasan
    next_step(page)
    results["summaryStep"] = hook(page)["stepIndex"]
    top(page)
    shot(page, "6-ringkasan")
    prog = page.evaluate("() => JSON.parse(localStorage.getItem('simotonom.progress.v1'))")
    results["progress"] = prog["lessons"].get("lokalisasi") if prog else None

    # navigasi berulang: tidak boleh ada loop, kanvas, atau style yang tertinggal
    for _ in range(6):
        page.evaluate("() => { location.hash = '#/' }")
        page.wait_for_timeout(250)
        page.evaluate("() => { location.hash = '#/pelajaran/lokalisasi' }")
        page.wait_for_timeout(400)
    results["afterNav"] = {
        "loops": hook(page)["activeLoops"],
        "canvases": page.evaluate("() => document.querySelectorAll('canvas').length"),
        "styleTags": page.evaluate("() => document.querySelectorAll('style[data-lesson]').length"),
    }
    page.evaluate("() => { location.hash = '#/' }")
    page.wait_for_timeout(400)
    results["home"] = {"loops": hook(page)["activeLoops"], "styleTags": page.evaluate("() => document.querySelectorAll('style[data-lesson]').length")}
    results["errors"] = errors
    browser.close()

print(json.dumps(results, indent=2, ensure_ascii=False))
ok = all(results.get(k) is not None for k in ("gps-only", "urban-canyon", "odometry-drift", "fusion", "landmark")) and not errors
sys.exit(0 if ok else 1)
