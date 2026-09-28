"""Alat bantu uji independen pelajaran Lokalisasi (QA akhir, port 8264 atau --port P).

Dipakai oleh tests/lokalisasi_verify_*.py. Server: python3 tests/serve.py 8264
"""
import os
import re
import sys
import time

from playwright.sync_api import sync_playwright  # noqa: F401  (diimpor ulang oleh skrip lain)

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
PORT = sys.argv[sys.argv.index("--port") + 1] if "--port" in sys.argv else "8264"
BASE = f"http://127.0.0.1:{PORT}/"
SHOTS = "/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/lokalisasi-verify/"
os.makedirs(SHOTS, exist_ok=True)
IGNORE = ("GPU stall due to ReadPixels",)


def launch(pw, gpu=False):
    args = ["--use-angle=metal", "--enable-gpu"] if gpu else []
    return pw.chromium.launch(executable_path=CHROME, headless=True, args=args)


def new_page(browser, mobile=False, reduced=False):
    opts = {"reduced_motion": "reduce"} if reduced else {}
    if mobile:
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True, **opts)
    else:
        ctx = browser.new_context(viewport={"width": 1366, "height": 900}, device_scale_factor=1, **opts)
    page = ctx.new_page()
    page.msgs = []
    page.mobile = mobile
    page.on("console", lambda m: page.msgs.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: page.msgs.append(f"pageerror: {e}"))
    return page


def console(page):
    return [m for m in page.msgs if not any(i in m for i in IGNORE)]


def hook(page):
    return page.evaluate("() => JSON.parse(JSON.stringify(window.__simotonom))")


def lok(page):
    return page.evaluate("() => window.__lokalisasi ? { safety: window.__lokalisasi.safety, state: window.__lokalisasi.state } : null")


def open_lesson(page, clear=True):
    page.goto(BASE + "#/", wait_until="load")
    if clear:
        page.evaluate("() => localStorage.clear()")
    page.goto(BASE + "#/pelajaran/lokalisasi", wait_until="load")
    for _ in range(80):
        if hook(page)["lessonStatus"] == "ready" and lok(page):
            return True
        page.wait_for_timeout(150)
    return False


def status(page):
    return page.locator(".sim-status").inner_text()


def press(page, loc):
    loc.scroll_into_view_if_needed()
    if page.mobile:
        loc.tap(timeout=4000)
    else:
        loc.click(timeout=4000)


def toggle_loc(page, label):
    return page.locator(".ctl-toggle").filter(has=page.locator(".toggle-label", has_text=re.compile(f"^{re.escape(label)}"))).first


def toggle(page, label):
    press(page, toggle_loc(page, label))
    page.wait_for_timeout(150)


def is_on(page, label):
    return toggle_loc(page, label).get_attribute("aria-checked") == "true"


def readout(page, label):
    return page.locator(".readout", has_text=label).first.locator(".readout-value").inner_text()


def go_step(page, i):
    """Pindah langkah lewat titik langkah (klik sungguhan)."""
    press(page, page.locator(f'.step-dots [data-go="{i}"]'))
    page.wait_for_timeout(400)


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
    page.wait_for_timeout(120)


def stage_shot(page, name):
    top(page)
    tag = "m" if page.mobile else "d"
    page.locator(".stage").screenshot(path=f"{SHOTS}{tag}-{name}.png")


def page_shot(page, name, full=False):
    top(page)
    tag = "m" if page.mobile else "d"
    page.screenshot(path=f"{SHOTS}{tag}-{name}.png", full_page=full)


def chips(page):
    return page.evaluate("() => [...document.querySelectorAll('.hud-chip')].filter(c => !c.hidden && c.offsetParent).map(c => c.innerText.replace(/\\s+/g, ' ').trim())")


def text_problems(page):
    txt = page.evaluate("() => (document.querySelector('.page-lesson') || document.body).innerText")
    return re.findall(r"NaN|undefined|Infinity|\[object|\bnull\b|\d\.\d{1,2}\s?(?:m|detik|km/jam|m/s)\b|—|–| -- ", txt)
