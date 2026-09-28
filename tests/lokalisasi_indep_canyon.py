"""QA independen langkah 2 Lokalisasi (zona gedung tinggi).

Skenario:
  A. Diam 30 detik di langkah 2 tanpa aksi: tugas urban-canyon tidak boleh selesai.
  B. Setelah mobil lewat zona, GPS dinyalakan: mobil dipindah ke depan zona (ada toast), tugas selesai.
  C. GPS langsung dinyalakan saat masuk langkah 2: mobil tidak dipindah, tugas selesai.
Juga mengambil beberapa tangkapan panggung saat lompatan untuk memeriksa peta mini.

Pemakaian: python3 tests/lokalisasi_indep_canyon.py [--mobile] [--port 8134]
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
BASE = f"http://127.0.0.1:{PORT}/"
SHOTS = "/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/lokalisasi-qa/"
TAG = "m" if MOBILE else "d"
os.makedirs(SHOTS, exist_ok=True)
msgs = []
R = {"viewport": "mobile" if MOBILE else "desktop"}


def hook(page):
    return page.evaluate("() => JSON.parse(JSON.stringify(window.__simotonom))")


def status(page):
    return page.locator(".sim-status").inner_text()


def press(page, loc):
    loc.scroll_into_view_if_needed()
    if MOBILE:
        loc.tap(timeout=4000)
    else:
        loc.click(timeout=4000)


def gps_toggle(page):
    return page.locator(".ctl-toggle").filter(has=page.locator(".toggle-label", has_text=re.compile("^GPS$"))).first


def zone_dist(page):
    m = re.search(r"Zona gedung tinggi (\d+) m lagi", status(page))
    return int(m.group(1)) if m else None


def toasts(page):
    return page.evaluate("() => [...document.querySelectorAll('.toast')].map((t) => t.innerText)")


def fresh(page):
    page.goto(BASE + "#/", wait_until="load")
    page.evaluate("() => localStorage.clear()")
    page.reload(wait_until="load")
    page.goto(BASE + "#/pelajaran/lokalisasi", wait_until="load")
    page.wait_for_timeout(1200)
    press(page, page.locator('.step-dot[data-go="1"]'))
    page.wait_for_timeout(600)


def wait_task(page, timeout, shots=None):
    t0 = time.time()
    n = 0
    while time.time() - t0 < timeout:
        if shots and n < 3 and "memantul" in status(page):
            page.wait_for_timeout(250 if n == 0 else 0)
            page.evaluate("() => window.scrollTo(0, 0)")
            page.locator(".stage").screenshot(path=f"{SHOTS}{TAG}-{shots}-{n}.png")
            n += 1
            page.wait_for_timeout(900)
        if "urban-canyon" in hook(page)["completedTasks"]:
            return round(time.time() - t0, 1)
        page.wait_for_timeout(150)
    return None


with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=CHROME, headless=True)
    if MOBILE:
        bctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    else:
        bctx = browser.new_context(viewport={"width": 1366, "height": 900}, device_scale_factor=1)
    page = bctx.new_page()
    page.on("console", lambda m: msgs.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: msgs.append(f"pageerror: {e}"))

    # A dan B
    fresh(page)
    R["A_entry"] = {"step": hook(page)["stepIndex"], "gpsOn": gps_toggle(page).get_attribute("aria-checked"), "status": status(page),
                    "task": page.locator(".task-text").inner_text()}
    page.wait_for_timeout(30000)
    R["A_after30s"] = {"completed": hook(page)["completedTasks"], "status": status(page)}
    page.evaluate("() => window.scrollTo(0, 0)")
    page.locator(".stage").screenshot(path=f"{SHOTS}{TAG}-canyon-A-idle.png")
    press(page, gps_toggle(page))
    page.wait_for_timeout(400)
    R["B_afterToggle"] = {"status": status(page), "dist": zone_dist(page), "toasts": toasts(page)}
    R["B_task"] = wait_task(page, 30, shots="canyon-B-jump")

    # C
    fresh(page)
    d0 = zone_dist(page)
    press(page, gps_toggle(page))
    page.wait_for_timeout(400)
    R["C_afterToggle"] = {"distBefore": d0, "distAfter": zone_dist(page), "toasts": toasts(page)}
    R["C_task"] = wait_task(page, 30)
    R["console"] = msgs
    print(json.dumps(R, indent=1, ensure_ascii=False))
    browser.close()
