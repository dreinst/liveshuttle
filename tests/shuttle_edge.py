"""Uji tepi pelajaran Misi Shuttle Otonom: lompat langkah lewat titik langkah, tutup jalan saat
dijeda, dan kembali ke langkah sebelumnya. Butuh server di port 8119."""
import json
from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
BASE = "http://127.0.0.1:8119/"
SHOTS = "/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/shuttle/"
log, errors = {}, []


def hook(page):
    return page.evaluate("() => JSON.parse(JSON.stringify(window.__simotonom))")


def go_step(page, i):
    page.locator(f'.step-dot[data-go="{i}"]').dispatch_event("click")
    page.wait_for_timeout(400)


def wait(page, fn, timeout):
    t = 0
    while t < timeout:
        if fn():
            return round(t / 1000, 1)
        page.wait_for_timeout(250)
        t += 250
    return None


with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, headless=True)
    page = b.new_context(viewport={"width": 1366, "height": 900}).new_page()
    page.on("console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    page.goto(BASE + "#/", wait_until="load")
    page.evaluate("() => localStorage.clear()")
    page.goto(BASE + "#/pelajaran/shuttle", wait_until="load")
    page.wait_for_timeout(1200)

    # lompat langsung ke langkah hujan: mobil pelan harus muncul di depan shuttle
    go_step(page, 2)
    gap = page.locator(".hud-chip", has_text="Jarak ke depan")
    log["leader-visible-after"] = wait(page, lambda: gap.is_visible(), 40000)
    page.locator(".stage").screenshot(path=SHOTS + "edge-leader.png")

    # kembali ke langkah 2, jeda, tutup ruas di depan, lalu lanjutkan
    go_step(page, 1)
    page.locator('[data-act="pause"]').click()
    page.wait_for_timeout(300)
    tries = 0
    ok = False
    while tries < 10 and not ok:
        tries += 1
        page.locator("button", has_text="Tutup ruas di depan").click()
        page.wait_for_timeout(500)
        rute = page.locator(".sh-brain li", has_text="Rute").text_content()
        ok = "ditutup" in rute
        if not ok:
            page.locator("button", has_text="Buka semua jalan").click()
            page.locator('[data-act="pause"]').click()
            page.wait_for_timeout(2500)
            page.locator('[data-act="pause"]').click()
    log["paused-reroute-text"] = page.locator(".sh-brain li", has_text="Rute").text_content()
    log["still-paused"] = hook(page)["paused"]
    page.locator(".stage").screenshot(path=SHOTS + "edge-paused-reroute.png")
    page.locator('[data-act="pause"]').click()
    log["closure-after-resume"] = wait(page, lambda: "closure" in hook(page)["completedTasks"], 8000)

    # langkah 1 lagi: tugas halte pertama selesai pada penumpang berikutnya yang naik
    go_step(page, 0)
    log["first-stop"] = wait(page, lambda: "first-stop" in hook(page)["completedTasks"], 90000)
    log["tasks"] = hook(page)["completedTasks"]
    b.close()
log["errors"] = errors
print(json.dumps(log, indent=2, ensure_ascii=False))
