"""QA pelajaran Kendali lewat UI seperti pelajar: kelima tugas, jeda, kecepatan, ulangi, kamera,
dan uji kebocoran navigasi. Semua pesan konsol error/warning dan pageerror dikumpulkan.

Pemakaian: python3 tests/kontrol_qa.py [--mobile] [--port 8246]
Butuh server statis yang sudah berjalan di port tersebut.
"""
import json
import sys
import time

from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
SHOTS = "/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/kontrol/"
MOBILE = "--mobile" in sys.argv
PORT = sys.argv[sys.argv.index("--port") + 1] if "--port" in sys.argv else "8246"
BASE = f"http://127.0.0.1:{PORT}/"
TAG = "m" if MOBILE else "d"


class Session:
    def __init__(self):
        self.errors = []

    def __enter__(self):
        self.pw = sync_playwright().start()
        self.browser = self.pw.chromium.launch(executable_path=CHROME, headless=True)
        if MOBILE:
            self.ctx = self.browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        else:
            self.ctx = self.browser.new_context(viewport={"width": 1366, "height": 900}, device_scale_factor=1)
        self.page = self.ctx.new_page()
        self.page.on("console", lambda m: self.errors.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
        self.page.on("pageerror", lambda e: self.errors.append(f"pageerror: {e}"))
        return self

    def go(self, route, wait=1200):
        self.page.goto(BASE + route, wait_until="load")
        self.page.wait_for_timeout(wait)

    def hook(self):
        return self.page.evaluate("() => JSON.parse(JSON.stringify(window.__simotonom))")

    def shot(self, name, full=False, selector=None):
        path = SHOTS + name + ".png"
        if selector:
            self.page.locator(selector).first.screenshot(path=path)
        else:
            self.page.screenshot(path=path, full_page=full)
        return path

    def __exit__(self, *a):
        self.browser.close()
        self.pw.stop()


def wait_task(s, task, timeout=60, on_tick=None):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if task in s.hook()["completedTasks"]:
            return round(time.time() - t0, 1)
        if on_tick:
            on_tick()
        s.page.wait_for_timeout(250)
    return None


def slider(s, label):
    return s.page.locator(".ctl-slider", has_text=label).first.locator("input[type=range]")


def slide_keys(s, label, key, times):
    """Geser slider dengan tombol panah, seperti pelajar yang memakai keyboard."""
    inp = slider(s, label)
    inp.scroll_into_view_if_needed()
    inp.focus()
    for _ in range(times):
        s.page.keyboard.press(key)
    return float(inp.input_value())


def slide_to(s, label, value):
    """Geser slider ke nilai tertentu (fill memicu event input seperti menyeret)."""
    inp = slider(s, label)
    inp.scroll_into_view_if_needed()
    inp.fill(str(value))
    return float(inp.input_value())


def next_step(s):
    s.page.locator(".step-nav .btn-primary").dispatch_event("click")
    s.page.wait_for_timeout(400)


def top(s):
    s.page.evaluate("() => window.scrollTo(0, 0)")
    s.page.wait_for_timeout(200)


def status(s):
    return s.page.locator(".sim-status").inner_text()


def readout(s, label):
    return s.page.locator(".readout", has_text=label).first.locator(".readout-value").inner_text()


results = {}
with Session() as s:
    s.go("#/")
    s.page.evaluate("() => localStorage.clear()")
    s.go("#/pelajaran/kontrol", 2500)
    h = s.hook()
    results["start"] = {"step": h["stepIndex"], "status": h["lessonStatus"], "loops": h["activeLoops"]}
    s.shot(f"qa-{TAG}-0-awal")

    # percepat simulasi supaya uji tidak terlalu lama
    s.page.locator(".speed-wrap .seg-btn", has_text="2x").click()

    # ---------- langkah 1: lookahead kecil (keyboard: 8 m -> 3 m = 10 kali panah kiri) ----------
    results["ld_small_value"] = slide_keys(s, "Lookahead Ld", "ArrowLeft", 10)
    weave = {}

    def watch_weave():
        st = status(s)
        if "berayun" in st and "weave" not in weave:
            weave["weave"] = st
            top(s)
            s.shot(f"qa-{TAG}-1-berayun")
        if "cadangan" in st and "takeover" not in weave:
            weave["takeover"] = st

    results["lookahead-small"] = wait_task(s, "lookahead-small", 60, watch_weave)
    results["weave_status"] = weave
    top(s)
    if "weave" not in weave:
        s.shot(f"qa-{TAG}-1-berayun")
    # tunggu sampai pengemudi cadangan terlihat untuk tangkapan layar
    t0 = time.time()
    while time.time() - t0 < 20 and "cadangan" not in status(s):
        s.page.wait_for_timeout(200)
    results["takeover_status"] = status(s)
    s.shot(f"qa-{TAG}-1b-cadangan")
    next_step(s)

    # ---------- langkah 2: lookahead besar ----------
    results["ld_large_value"] = slide_to(s, "Lookahead Ld", 16)
    results["lookahead-large"] = wait_task(s, "lookahead-large", 120)
    top(s)
    s.shot(f"qa-{TAG}-2-potong")
    results["cut_status"] = status(s)
    next_step(s)

    # ---------- langkah 3: cari Ld yang pas, satu putaran penuh ----------
    results["preset_ld_step3"] = float(slider(s, "Lookahead Ld").input_value())
    results["ld_tuned_value"] = slide_to(s, "Lookahead Ld", 7)
    results["tuned"] = wait_task(s, "tuned", 240)
    results["lap_readouts"] = {k: readout(s, k) for k in ("RMS putaran terakhir", "Galat maks putaran", "Rata-rata kecepatan")}
    results["attribution_hint"] = s.page.locator(".grp-view .ctl-hint").first.inner_text()
    top(s)
    s.page.locator(".seg-btn", has_text="Seluruh lintasan").dispatch_event("click")
    s.page.wait_for_timeout(600)
    top(s)
    s.shot(f"qa-{TAG}-3-seluruh")
    s.page.locator(".seg-btn", has_text="Ikuti mobil").dispatch_event("click")
    next_step(s)

    # ---------- langkah 4: PID overshoot ----------
    results["ki_high"] = slide_to(s, "Ki", 1)
    s.page.locator(".btn", has_text="Uji dari diam").click()
    results["pid-overshoot"] = wait_task(s, "pid-overshoot", 40)
    results["overshoot_readout"] = readout(s, "Overshoot kecepatan")
    s.page.wait_for_timeout(1500)
    s.shot(f"qa-{TAG}-4-overshoot", full=True)
    next_step(s)

    # ---------- langkah 5: setel PID ----------
    results["preset_gains_step5"] = {k: slider(s, k).input_value() for k in ("Kp", "Ki", "Kd")}
    results["kp_tuned"] = slide_to(s, "Kp", 1.2)
    results["ki_tuned"] = slide_to(s, "Ki", 0.3)
    results["note_after_gain_change"] = s.page.locator(".result-note").inner_text()
    s.page.locator(".btn", has_text="Uji dari diam").click()
    results["pid-tuned"] = wait_task(s, "pid-tuned", 40)
    results["tuned_readouts"] = {k: readout(s, k) for k in ("Overshoot kecepatan", "Waktu mencapai target")}
    s.shot(f"qa-{TAG}-5-setel", full=True)

    # ---------- jeda, kecepatan, ulangi ----------
    s.page.locator('[data-act="pause"]').click()
    s.page.wait_for_timeout(300)
    t_a = s.page.evaluate("() => document.querySelector('.sim-status').textContent")
    s.page.wait_for_timeout(800)
    results["paused"] = s.hook()["paused"]
    results["status_frozen_while_paused"] = t_a == s.page.evaluate("() => document.querySelector('.sim-status').textContent")
    s.page.locator('[data-act="pause"]').click()
    s.page.locator(".speed-wrap .seg-btn", has_text="0,5x").click()
    results["speed05"] = s.hook()["speed"]
    s.page.locator(".speed-wrap .seg-btn", has_text="1x").click()
    s.page.locator('[data-act="reset"]').click()
    s.page.wait_for_timeout(400)
    results["afterReset"] = {k: s.hook()[k] for k in ("paused", "lessonStatus", "activeLoops")}
    results["afterReset_status"] = status(s)

    # ---------- ringkasan ----------
    next_step(s)
    results["summaryStep"] = s.hook()["stepIndex"]
    top(s)
    s.shot(f"qa-{TAG}-6-ringkasan")
    results["completed"] = s.hook()["completedTasks"]
    results["progress"] = s.page.evaluate("() => JSON.parse(localStorage.getItem('liveshuttle.progress.v1')).lessons.kontrol")

    # ---------- navigasi berulang: tidak boleh ada loop, kanvas, atau style yang tertinggal ----------
    for i in range(8):
        s.page.evaluate("() => { location.hash = '#/' }")
        s.page.wait_for_timeout(250)
        s.page.evaluate("() => { location.hash = '#/pelajaran/kontrol' }")
        s.page.wait_for_timeout(400)
    results["afterNav"] = {
        "loops": s.hook()["activeLoops"],
        "canvases": s.page.evaluate("() => document.querySelectorAll('canvas').length"),
        "styleTags": s.page.evaluate("() => document.querySelectorAll('style[data-lesson]').length"),
        "stepIndex": s.hook()["stepIndex"],
    }
    s.page.evaluate("() => { location.hash = '#/' }")
    s.page.wait_for_timeout(400)
    results["home"] = {"loops": s.hook()["activeLoops"], "styleTags": s.page.evaluate("() => document.querySelectorAll('style[data-lesson]').length")}
    results["errors"] = s.errors

print(json.dumps(results, indent=2, ensure_ascii=False))
ok = all(results.get(t) is not None for t in ("lookahead-small", "lookahead-large", "tuned", "pid-overshoot", "pid-tuned")) and not results["errors"]
sys.exit(0 if ok else 1)
