"""Uji kasus tepi pelajaran Lokalisasi: lompat langkah, sakelar saat dijeda, slider ekstrem,
kemudi yang menyalakan estimasinya sendiri, jalan lama di 2x, dan teks NaN/undefined.

Pemakaian: python3 tests/lokalisasi_edge.py [--mobile] [--port 8114]
"""
import json
import re
import sys

from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
MOBILE = "--mobile" in sys.argv
PORT = sys.argv[sys.argv.index("--port") + 1] if "--port" in sys.argv else "8114"
BASE = f"http://127.0.0.1:{PORT}/"
SHOTS = "/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/lokalisasi/"
TAG = "m" if MOBILE else "d"
errors = []
res = {}
bad = re.compile(r"NaN|undefined|Infinity|∞|\[object")


def checked(page, name):
    return page.locator(".ctl-toggle", has_text=name).first.get_attribute("aria-checked") == "true"


def click_toggle(page, name):
    page.locator(".ctl-toggle", has_text=name).first.click()
    page.wait_for_timeout(150)


def go_step(page, i):
    page.locator(f'.step-dot[data-go="{i}"]').dispatch_event("click")
    page.wait_for_timeout(250)


def set_slider(page, v):
    page.evaluate("(v) => { const s = document.querySelector('.ctl-slider input'); s.value = v; s.dispatchEvent(new Event('input', { bubbles: true })); }", v)


def page_text_ok(page):
    txt = page.locator("main").inner_text()
    m = bad.search(txt)
    return None if not m else txt[max(0, m.start() - 60): m.end() + 20]


with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=CHROME, headless=True)
    if MOBILE:
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    else:
        ctx = browser.new_context(viewport={"width": 1366, "height": 900})
    page = ctx.new_page()
    page.on("console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.goto(BASE + "#/", wait_until="load")
    page.evaluate("() => localStorage.clear()")
    page.goto(BASE + "#/pelajaran/lokalisasi", wait_until="load")
    page.wait_for_timeout(1200)

    canvas = page.locator(".stage .sim-canvas").first
    res["canvas_a11y"] = {"role": canvas.get_attribute("role"), "label": (canvas.get_attribute("aria-label") or "")[:60]}

    # lompat langsung ke langkah 5, lalu nyalakan peta saat dijeda
    go_step(page, 4)
    res["step5_preset"] = {n: checked(page, n) for n in ("GPS", "Odometri", "Fusi", "Pencocokan")}
    page.locator('[data-act="pause"]').click()
    click_toggle(page, "Pencocokan peta")
    page.wait_for_timeout(400)
    res["paused_toggle_status"] = page.locator(".sim-status").inner_text()
    page.locator('[data-act="pause"]').click()
    page.wait_for_timeout(1500)

    # kemudi memakai odometri saat odometri mati: odometri harus ikut menyala
    page.locator(".ctl-seg .seg-btn", has_text="Odometri").first.click()
    click_toggle(page, "Kemudikan dengan estimasi")
    res["steer_odo_enables_odo"] = checked(page, "Odometri")
    # mematikan odometri harus mematikan kemudi
    click_toggle(page, "Odometri")
    res["odo_off_stops_steer"] = not checked(page, "Kemudikan dengan estimasi")

    # slider ekstrem
    set_slider(page, 0.5)
    page.wait_for_timeout(2500)
    res["sigma_min_value"] = page.locator(".ctl-slider .ctl-value").inner_text()
    set_slider(page, 5)
    page.wait_for_timeout(2500)
    res["sigma_max_value"] = page.locator(".ctl-slider .ctl-value").inner_text()

    # jalan lama di 2x dengan kemudi GPS dan semua estimasi menyala
    for n in ("GPS", "Odometri", "Fusi"):
        if not checked(page, n):
            click_toggle(page, n)
    page.locator(".ctl-seg .seg-btn", has_text="GPS").first.click()
    click_toggle(page, "Kemudikan dengan estimasi")
    page.locator(".speed-wrap .seg-btn", has_text="2x").click()
    page.wait_for_timeout(30000)
    res["long_run_text_problem"] = page_text_ok(page)
    res["long_run_status"] = page.locator(".sim-status").inner_text()
    res["takeovers"] = page.locator(".readout", has_text="Diambil alih").locator(".readout-value").inner_text()
    page.evaluate("() => window.scrollTo(0, 0)")
    page.locator(".stage").screenshot(path=f"{SHOTS}edge-{TAG}-long.png")
    page.locator(".speed-wrap .seg-btn", has_text="1x").click()

    # langkah bolak-balik cepat
    for i in [0, 3, 1, 4, 2, 0, 4, 1, 3, 2]:
        go_step(page, i)
    page.wait_for_timeout(1500)
    res["after_step_hopping"] = {"step": page.evaluate("() => window.__simotonom.stepIndex"), "text_problem": page_text_ok(page)}

    # ringkasan lalu kembali
    go_step(page, 5)
    page.wait_for_timeout(1500)
    res["summary_status"] = page.locator(".sim-status").inner_text()
    go_step(page, 2)
    page.wait_for_timeout(500)
    res["loops"] = page.evaluate("() => window.__simotonom.activeLoops")
    res["errors"] = errors
    browser.close()

print(json.dumps(res, indent=2, ensure_ascii=False))
sys.exit(0 if not errors and not res["long_run_text_problem"] else 1)
