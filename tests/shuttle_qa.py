"""QA pelajaran Misi Shuttle Otonom lewat UI seperti pelajar: semua tugas, alat peta, jeda,
ulangi, kecepatan, dan uji kebocoran navigasi.

Pemakaian: python3 tests/shuttle_qa.py [--mobile]
Butuh server statis di port 8119.
"""
import json
import sys
import time

from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
BASE = "http://127.0.0.1:8119/"
SHOTS = "/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/shuttle/"
MOBILE = "--mobile" in sys.argv
TAG = "m" if MOBILE else "d"
MAP = {"minX": -14, "minY": -9, "maxX": 134, "maxY": 109}
PAD = 10
# satu titik di ruas tempat halte berada (untuk menutup jalan lewat ketukan)
HALTE_ROAD = {"Gerbang Utama": (0, 76), "Asrama": (38, 100), "Kantin": (88, 100), "Perpustakaan": (120, 24), "Rektorat": (36, 0)}
SHELTER = {"Rektorat": (27.5, 5.0)}

errors = []
log = {}


def hook(page):
    return page.evaluate("() => JSON.parse(JSON.stringify(window.__simotonom))")


def wait_task(page, task, timeout):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if task in hook(page)["completedTasks"]:
            return round(time.time() - t0, 1)
        page.wait_for_timeout(250)
    return None


def next_step(page):
    page.locator(".step-nav .btn-primary").dispatch_event("click")
    page.wait_for_timeout(400)


def shot(page, name, full=False):
    page.screenshot(path=f"{SHOTS}qa-{TAG}-{name}.png", full_page=full)


def stage_shot(page, name):
    page.locator(".stage").screenshot(path=f"{SHOTS}qa-{TAG}-{name}.png")


def to_screen(page, x, y):
    """Titik dunia ke titik layar pada tampilan Seluruh kampus (meniru View.fit)."""
    box = page.locator(".sim-canvas").bounding_box()
    w, h = box["width"], box["height"]
    bw, bh = MAP["maxX"] - MAP["minX"], MAP["maxY"] - MAP["minY"]
    scale = min((w - 2 * PAD) / bw, (h - 2 * PAD) / bh)
    cx, cy = (MAP["minX"] + MAP["maxX"]) / 2, (MAP["minY"] + MAP["maxY"]) / 2
    return box["x"] + (x - cx) * scale + w / 2, box["y"] + (y - cy) * scale + h / 2


def tap_world(page, x, y):
    page.locator(".sim-canvas").scroll_into_view_if_needed()
    page.wait_for_timeout(150)
    sx, sy = to_screen(page, x, y)
    if MOBILE:
        page.touchscreen.tap(sx, sy)
    else:
        page.mouse.click(sx, sy)
    page.wait_for_timeout(350)


def seg(page, text):
    page.locator(".seg-btn", has_text=text).first.click()
    page.wait_for_timeout(200)


def toast_texts(page):
    return page.evaluate("() => [...document.querySelectorAll('.toast')].map(t => t.textContent.trim())")


def readout(page, label):
    return page.evaluate(
        """(label) => { const r = [...document.querySelectorAll('.readout')].find(e => e.querySelector('.readout-label')?.textContent === label);
        return r ? r.querySelector('.readout-value').textContent : null; }""", label)


def brain(page):
    return page.evaluate("() => [...document.querySelectorAll('.sh-brain li')].map(li => li.textContent.trim())")


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
    page.goto(BASE + "#/pelajaran/shuttle", wait_until="load")
    page.wait_for_timeout(1500)
    h = hook(page)
    log["start"] = {"step": h["stepIndex"], "status": h["lessonStatus"], "loops": h["activeLoops"]}
    stage_shot(page, "0-awal")

    # langkah 1: halte pertama
    log["first-stop"] = wait_task(page, "first-stop", 60)
    stage_shot(page, "1-halte")
    log["brain-1"] = brain(page)
    next_step(page)

    # langkah 2: tutup jalan (ketuk peta seperti pelajar, tombol sebagai cadangan)
    seg(page, "Seluruh kampus")
    seg(page, "Tutup jalan")
    page.wait_for_timeout(600)
    # uji ketuk ruas yang bukan rute: Jl. Riset, lalu buka lagi
    tap_world(page, 90, 50)
    log["tap-riset"] = toast_texts(page)
    page.wait_for_timeout(500)
    stage_shot(page, "2a-riset-ditutup")
    tap_world(page, 90, 50)
    log["tap-riset-open"] = toast_texts(page)
    page.wait_for_timeout(1200)
    target = page.locator(".hud-chip", has_text="Menuju").locator(".hud-value").text_content()
    log["target-before"] = target
    # coba ketuk ruas seperti pelajar: ruas halte tujuan dulu, lalu ruas lain, buka lagi bila rute tidak berubah
    candidates = [HALTE_ROAD.get(target)] + [(60, 25), (30, 50), (90, 50), (60, 75), (38, 100), (88, 100), (120, 24), (36, 0), (0, 30), (120, 75), (0, 76), (90, 0)]
    log["tap-tries"] = 0
    for pt in [c for c in candidates if c]:
        tap_world(page, *pt)
        log["tap-tries"] += 1
        if wait_task(page, "closure", 2.2) is not None:
            log["closure"] = f"ketuk {pt}"
            break
        page.locator("button", has_text="Buka semua jalan").click()
        page.wait_for_timeout(300)
    stage_shot(page, "2b-reroute")
    if "closure" not in log:
        log["closure-fallback"] = True
        for _ in range(12):
            page.locator("button", has_text="Tutup ruas di depan").click()
            page.wait_for_timeout(700)
            if wait_task(page, "closure", 3) is not None:
                log["closure"] = "button"
                break
            page.locator("button", has_text="Buka semua jalan").click()
            page.wait_for_timeout(2500)
    stage_shot(page, "2c-closure-done")
    log["brain-2"] = brain(page)
    next_step(page)

    # langkah 3: hujan
    page.wait_for_timeout(4000)
    gap_dry = page.locator(".hud-chip", has_text="Jarak ke depan").locator(".hud-value").text_content()
    log["gap-dry"] = gap_dry
    stage_shot(page, "3a-sebelum-hujan")
    page.locator(".ctl-toggle", has_text="Hujan").click()
    log["rain"] = wait_task(page, "rain", 45)
    page.wait_for_timeout(3000)
    log["gap-rain"] = page.locator(".hud-chip", has_text="Jarak ke depan").locator(".hud-value").text_content()
    log["brain-3"] = brain(page)
    stage_shot(page, "3b-hujan")
    next_step(page)

    # langkah 4: antar 10 penumpang, kecepatan 2x; uji juga pilih halte di peta
    page.locator(".speed-wrap .seg-btn", has_text="2x").click()
    seg(page, "Seluruh kampus")
    seg(page, "Pilih halte")
    tap_world(page, *SHELTER["Rektorat"])
    log["halte-off"] = page.locator(".ctl-toggle", has_text="Rektorat").get_attribute("aria-checked")
    stage_shot(page, "4a-rektorat-off")
    tap_world(page, *SHELTER["Rektorat"])
    log["halte-on"] = page.locator(".ctl-toggle", has_text="Rektorat").get_attribute("aria-checked")
    log["deliver-10"] = wait_task(page, "deliver-10", 180)
    log["delivered"] = readout(page, "Penumpang diantar")
    stage_shot(page, "4b-antar")
    next_step(page)

    # langkah 5: satu putaran tanpa pelanggaran, dengan pejalan kaki mendadak (tombol J)
    page.wait_for_timeout(2000)
    page.keyboard.press("j")
    page.wait_for_timeout(2500)
    stage_shot(page, "5a-pejalan")
    log["clean-run"] = wait_task(page, "clean-run", 260)
    log["violations"] = readout(page, "Pelanggaran lampu merah")
    log["emergencies"] = readout(page, "Pengereman darurat")
    log["loops-done"] = readout(page, "Putaran selesai")
    stage_shot(page, "5b-putaran")
    shot(page, "5c-halaman", full=True)
    next_step(page)
    shot(page, "6-ringkasan")
    log["summary"] = page.locator(".summary-tasks-title").text_content()

    # jeda, ulangi, kecepatan
    page.locator(".speed-wrap .seg-btn", has_text="1x").click()
    page.locator('[data-act="pause"]').click()
    page.wait_for_timeout(300)
    log["paused"] = hook(page)["paused"]
    page.locator('[data-act="pause"]').click()
    page.locator('[data-act="reset"]').click()
    page.wait_for_timeout(600)
    log["after-reset"] = {"delivered": readout(page, "Penumpang diantar"), "paused": hook(page)["paused"], "speed": hook(page)["speed"]}

    # kebocoran loop saat pindah halaman berkali-kali
    for _ in range(3):
        page.goto(BASE + "#/", wait_until="load")
        page.wait_for_timeout(500)
        page.goto(BASE + "#/pelajaran/shuttle", wait_until="load")
        page.wait_for_timeout(900)
    page.evaluate("() => { location.hash = '#/'; }")
    page.wait_for_timeout(600)
    log["loops-on-home"] = hook(page)["activeLoops"]
    page.evaluate("() => { location.hash = '#/pelajaran/shuttle'; }")
    page.wait_for_timeout(900)
    log["loops-on-lesson"] = hook(page)["activeLoops"]
    log["final-tasks"] = hook(page)["completedTasks"]
    browser.close()

log["errors"] = errors
print(json.dumps(log, indent=2, ensure_ascii=False))
