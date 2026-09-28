"""Tangkapan layar keadaan khusus pelajaran Jarak Aman (nilai ekstrem, fase sebelum rintangan terlihat, jeda).

Pemakaian: python3 tests/jarak-aman_visual.py [--mobile] [--port 8118]
"""
import json
import sys

from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
PORT = sys.argv[sys.argv.index("--port") + 1] if "--port" in sys.argv else "8118"
BASE = f"http://127.0.0.1:{PORT}/"
SHOTS = "/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/jarak-aman/"
MOBILE = "--mobile" in sys.argv
TAG = "m" if MOBILE else "d"
msgs = []

SET_SLIDER = """([label, value]) => {
  const ctl = [...document.querySelectorAll('.ctl-slider')].find((c) => c.textContent.includes(label));
  const input = ctl.querySelector('input');
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}"""


def seg(page, text):
    page.locator(".seg-btn", has_text=text).first.click()


def stage(page, name):
    page.evaluate("() => document.querySelector('.stage').scrollIntoView({block: 'center'})")
    page.wait_for_timeout(150)
    page.locator(".stage").screenshot(path=SHOTS + f"vis-{TAG}-{name}.png")


def hook(page):
    return page.evaluate("() => JSON.parse(JSON.stringify(window.__simotonom))")


out = {}
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=CHROME, headless=True)
    if MOBILE:
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    else:
        ctx = browser.new_context(viewport={"width": 1366, "height": 900})
    page = ctx.new_page()
    page.on("console", lambda m: msgs.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: msgs.append(f"pageerror: {e}"))
    page.goto(BASE + "#/", wait_until="load")
    page.evaluate("() => localStorage.clear()")
    page.goto(BASE + "#/pelajaran/jarak-aman", wait_until="load")
    page.wait_for_timeout(1200)

    # nilai terkecil
    page.evaluate(SET_SLIDER, ["Kecepatan", 20])
    page.evaluate(SET_SLIDER, ["Jarak waktu", 0.5])
    page.wait_for_timeout(2500)
    stage(page, "min-20kmh")
    out["min_status"] = page.locator(".sim-status").inner_text()

    # nilai terbesar di jalan licin
    page.evaluate(SET_SLIDER, ["Kecepatan", 120])
    page.evaluate(SET_SLIDER, ["Jarak waktu", 3])
    seg(page, "Licin")
    page.wait_for_timeout(9000)
    stage(page, "max-120kmh-licin")
    out["max_meter"] = page.locator(".ja-mhead").inner_text()

    # rintangan: fase sebelum terlihat
    page.evaluate(SET_SLIDER, ["Kecepatan", 60])
    page.evaluate(SET_SLIDER, ["Jarak waktu", 1.5])
    seg(page, "Kering")
    page.wait_for_timeout(2500)
    page.locator(".ja-scn .btn", has_text="Rintangan").click()
    page.wait_for_timeout(450)
    stage(page, "rintangan-pra")
    page.wait_for_timeout(5000)
    stage(page, "rintangan-hasil")
    out["rintangan_banner"] = page.locator(".ja-banner").inner_text()

    # sistem otomatis, rem mendadak, jarak 0,5 detik
    seg(page, "Sistem otomatis")
    page.evaluate(SET_SLIDER, ["Jarak waktu", 0.5])
    page.wait_for_timeout(1500)
    page.locator(".ja-scn .btn", has_text="rem mendadak").click()
    page.wait_for_timeout(700)
    page.locator('[data-act="pause"]').click()
    page.wait_for_timeout(300)
    stage(page, "sistem-jeda")
    out["paused"] = hook(page)["paused"]
    page.locator('[data-act="pause"]').click()
    page.wait_for_timeout(6000)
    stage(page, "sistem-hasil")
    out["sistem_banner"] = page.locator(".ja-banner").inner_text()
    out["sistem_result"] = page.locator(".ja-result").inner_text()

    # AEB di 40 km/jam, rintangan, jalan basah, jarak 1 detik: tabrakan dicegah
    seg(page, "Manusia")
    seg(page, "Basah")
    page.evaluate(SET_SLIDER, ["Kecepatan", 40])
    page.evaluate(SET_SLIDER, ["Jarak waktu", 1])
    toggle = page.locator(".ctl-toggle", has_text="AEB")
    if toggle.get_attribute("aria-checked") != "true":
        toggle.click()
    page.wait_for_timeout(2000)
    page.locator(".ja-scn .btn", has_text="Rintangan").click()
    page.wait_for_timeout(6000)
    stage(page, "aeb-40-cegah")
    out["aeb40_banner"] = page.locator(".ja-banner").inner_text()
    out["aeb40_result"] = page.locator(".ja-result").inner_text()

    # panel kontrol dan rumus
    page.locator(".ja-formula").scroll_into_view_if_needed()
    page.wait_for_timeout(200)
    page.screenshot(path=SHOTS + f"vis-{TAG}-panel.png")
    browser.close()

out["console"] = msgs
print(json.dumps(out, indent=2, ensure_ascii=False))
sys.exit(1 if msgs else 0)
