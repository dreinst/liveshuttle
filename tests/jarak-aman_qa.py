"""QA pelajaran Jarak Aman lewat UI seperti pelajar: semua tugas, jeda, ulangi, kecepatan, dan uji kebocoran.

Pemakaian: python3 tests/jarak-aman_qa.py [--mobile] [--port 8118]
Butuh server statis yang sudah berjalan di port tersebut.
"""
import json
import sys
import time

from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
PORT = sys.argv[sys.argv.index("--port") + 1] if "--port" in sys.argv else "8118"
BASE = f"http://127.0.0.1:{PORT}/"
SHOTS = "/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/jarak-aman/"
MOBILE = "--mobile" in sys.argv
TAG = "m" if MOBILE else "d"

msgs = []


def hook(page):
    return page.evaluate("() => JSON.parse(JSON.stringify(window.__simotonom))")


def status(page):
    return page.locator(".sim-status").inner_text()


def wait_task(page, task, timeout=30):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if task in hook(page)["completedTasks"]:
            return round(time.time() - t0, 1)
        page.wait_for_timeout(200)
    return None


def wait_done(page, timeout=30):
    """Tunggu sampai banner hasil muncul (percobaan selesai)."""
    t0 = time.time()
    while time.time() - t0 < timeout:
        if page.locator(".ja-banner:not([hidden])").count():
            return round(time.time() - t0, 1)
        page.wait_for_timeout(150)
    return None


def next_step(page):
    page.locator(".step-nav .btn-primary").dispatch_event("click")
    page.wait_for_timeout(400)


def slider_to(page, label, target, step):
    """Geser slider dengan tombol panah seperti pengguna keyboard."""
    ctl = page.locator(".ctl-slider", has_text=label).first
    inp = ctl.locator("input[type=range]")
    inp.focus()
    for _ in range(80):
        v = float(inp.input_value())
        if abs(v - target) < step / 2:
            break
        page.keyboard.press("ArrowRight" if v < target else "ArrowLeft")
    return float(inp.input_value())


def click_seg(page, text):
    page.locator(".seg-btn", has_text=text).first.click()


def press_scenario(page, text):
    btn = page.locator(".ja-scn .btn", has_text=text)
    btn.scroll_into_view_if_needed()
    btn.click()


def stage_shot(page, name):
    page.evaluate("() => document.querySelector('.stage').scrollIntoView({block: 'center'})")
    page.wait_for_timeout(120)
    path = SHOTS + f"qa-{TAG}-{name}.png"
    page.screenshot(path=path)
    return path


results = {}
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=CHROME, headless=True)
    if MOBILE:
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    else:
        ctx = browser.new_context(viewport={"width": 1366, "height": 900}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("console", lambda m: msgs.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: msgs.append(f"pageerror: {e}"))

    page.goto(BASE + "#/", wait_until="load")
    page.evaluate("() => localStorage.clear()")
    page.wait_for_timeout(600)
    results["loops_home_baseline"] = hook(page)["activeLoops"]
    page.goto(BASE + "#/pelajaran/jarak-aman", wait_until="load")
    page.wait_for_timeout(1500)
    h = hook(page)
    results["start"] = {"step": h["stepIndex"], "status": h["lessonStatus"], "loops": h["activeLoops"], "steps": h["stepCount"]}
    stage_shot(page, "0-awal")

    # Langkah 1: 80 km/jam dan jalan basah
    results["speed"] = slider_to(page, "Kecepatan", 80, 5)
    click_seg(page, "Basah")
    results["calc"] = wait_task(page, "calc", 6)
    results["formula"] = page.locator(".ja-formula").inner_text()
    results["meter"] = page.locator(".ja-mhead").inner_text()
    stage_shot(page, "1-rumus")
    next_step(page)

    # Langkah 2: rem mendadak dengan jarak 1 detik
    press_scenario(page, "rem mendadak")
    page.wait_for_timeout(1700)
    results["mid_status"] = status(page)
    stage_shot(page, "2a-reaksi")
    results["crash_done_s"] = wait_done(page)
    results["crash_banner"] = page.locator(".ja-banner").inner_text()
    results["crash"] = wait_task(page, "crash", 5)
    stage_shot(page, "2b-tabrakan")
    results["crash_result"] = page.locator(".ja-result").inner_text()
    next_step(page)

    # Langkah 3: jarak 2 detik, rem mendadak lagi
    results["gap"] = slider_to(page, "Jarak waktu", 2.0, 0.1)
    page.wait_for_timeout(1500)
    press_scenario(page, "rem mendadak")
    results["gapfix_done_s"] = wait_done(page)
    results["gapfix_banner"] = page.locator(".ja-banner").inner_text()
    results["gap-fix"] = wait_task(page, "gap-fix", 5)
    stage_shot(page, "3-aman")
    next_step(page)

    # Langkah 4: AEB menyala, rintangan diam, jarak 1 detik (preset)
    page.locator(".ctl-toggle", has_text="AEB").click()
    page.wait_for_timeout(300)
    press_scenario(page, "Rintangan")
    page.wait_for_timeout(1400)
    stage_shot(page, "4a-rintangan")
    results["aeb_done_s"] = wait_done(page)
    results["aeb_banner"] = page.locator(".ja-banner").inner_text()
    results["aeb"] = wait_task(page, "aeb", 5)
    stage_shot(page, "4b-aeb")
    results["aeb_result"] = page.locator(".ja-result").inner_text()
    next_step(page)

    # Langkah 5: jalan licin, AEB menyala (preset), rintangan diam
    click_seg(page, "Licin")
    page.wait_for_timeout(300)
    press_scenario(page, "Rintangan")
    results["licin_done_s"] = wait_done(page)
    results["licin_banner"] = page.locator(".ja-banner").inner_text()
    results["licin"] = wait_task(page, "licin", 5)
    stage_shot(page, "5-licin")
    results["licin_result"] = page.locator(".ja-result").inner_text()

    # Coba 40 km/jam dan 3 detik di jalan licin
    slider_to(page, "Kecepatan", 40, 5)
    slider_to(page, "Jarak waktu", 3.0, 0.1)
    page.wait_for_timeout(1200)
    press_scenario(page, "Rintangan")
    wait_done(page)
    results["licin40_banner"] = page.locator(".ja-banner").inner_text()
    stage_shot(page, "5b-licin-40")

    next_step(page)  # ringkasan
    h = hook(page)
    results["summary"] = {"step": h["stepIndex"], "tasks": h["completedTasks"]}
    page.evaluate("() => window.scrollTo(0, 0)")
    page.screenshot(path=SHOTS + f"qa-{TAG}-6-ringkasan.png", full_page=False)

    # Jeda, kecepatan, ulangi
    page.locator('[data-act="pause"]').click()
    page.wait_for_timeout(300)
    results["paused"] = hook(page)["paused"]
    press_scenario(page, "rem mendadak")  # harus melanjutkan simulasi
    page.wait_for_timeout(300)
    results["resumed_by_scenario"] = not hook(page)["paused"]
    page.locator(".speed-wrap .seg-btn", has_text="2x").click()
    page.wait_for_timeout(200)
    results["speed2"] = hook(page)["speed"]
    page.locator('[data-act="reset"]').click()
    page.wait_for_timeout(500)
    results["after_reset_status"] = status(page)
    results["banner_hidden_after_reset"] = page.locator(".ja-banner[hidden]").count() == 1

    # Kebocoran: bolak-balik beberapa kali
    for _ in range(3):
        page.goto(BASE + "#/pelajaran/sensor")
        page.wait_for_timeout(700)
        page.goto(BASE + "#/pelajaran/jarak-aman")
        page.wait_for_timeout(700)
    results["loops_on_lesson"] = hook(page)["activeLoops"]
    page.goto(BASE + "#/")
    page.wait_for_timeout(600)
    results["loops_home"] = hook(page)["activeLoops"]
    results["styles_left"] = page.evaluate("() => document.querySelectorAll('style[data-lesson=\"jarak-aman\"]').length")
    browser.close()

results["console"] = msgs
print(json.dumps(results, indent=2, ensure_ascii=False))
ok = (all(results.get(k) is not None for k in ["calc", "crash", "gap-fix", "aeb", "licin"]) and not msgs
      and results["loops_home"] == results["loops_home_baseline"] and results["loops_on_lesson"] == 1
      and results["styles_left"] == 0)
print("OK" if ok else "MASALAH")
sys.exit(0 if ok else 1)
