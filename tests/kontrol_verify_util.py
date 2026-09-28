"""Alat bantu QA mandiri pelajaran Kendali (kontrol) untuk Playwright.

Dipakai oleh tests/kontrol_verify_*.py. Server harus sudah berjalan (python3 tests/serve.py 8266).
"""
import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
SHOTS = "/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/kontrol-verify/"
PORT = sys.argv[sys.argv.index("--port") + 1] if "--port" in sys.argv else "8266"
BASE = f"http://127.0.0.1:{PORT}/"
IGNORE = ("GPU stall due to ReadPixels",)


class Session:
    def __init__(self, mobile=False, gpu=None):
        self.mobile = mobile
        self.gpu = gpu
        self.msgs = []

    def __enter__(self):
        os.makedirs(SHOTS, exist_ok=True)
        self.pw = sync_playwright().start()
        args = []
        if self.gpu == "swiftshader":
            args = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
        elif self.gpu == "metal":
            args = ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"]
        self.browser = self.pw.chromium.launch(executable_path=CHROME, headless=True, args=args)
        if self.mobile:
            self.ctx = self.browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2,
                                                is_mobile=True, has_touch=True)
        else:
            self.ctx = self.browser.new_context(viewport={"width": 1366, "height": 900}, device_scale_factor=1)
        self.page = self.ctx.new_page()
        self.page.on("console", self._console)
        self.page.on("pageerror", lambda e: self.msgs.append(f"pageerror: {e}"))
        return self

    def _console(self, m):
        if m.type in ("error", "warning") and not any(s in m.text for s in IGNORE):
            self.msgs.append(f"{m.type}: {m.text}")

    def __exit__(self, *a):
        self.browser.close()
        self.pw.stop()

    # ---------- navigasi ----------
    def open_lesson(self, clear=True):
        p = self.page
        p.goto(BASE + "#/")
        if clear:
            p.evaluate("() => localStorage.clear()")
        p.goto(BASE + "#/pelajaran/kontrol")
        self.wait_ready()

    def wait_ready(self, timeout=20):
        t0 = time.time()
        while time.time() - t0 < timeout:
            h = self.hook()
            if h["lessonId"] == "kontrol" and h["lessonStatus"] == "ready":
                return h
            time.sleep(0.1)
        raise RuntimeError("pelajaran tidak siap: " + json.dumps(self.hook()))

    def hook(self):
        return self.page.evaluate("() => JSON.parse(JSON.stringify(window.__simotonom))")

    def done(self):
        return self.hook()["completedTasks"]

    def go_step(self, i):
        self.page.locator(f'.step-dot[data-go="{i}"]').first.click()
        t0 = time.time()
        while self.hook()["stepIndex"] != i and time.time() - t0 < 5:
            time.sleep(0.05)
        time.sleep(0.2)

    def next_step(self):
        self.page.locator(".step-nav .btn-primary").first.click()
        time.sleep(0.2)

    def speed(self, label):
        # label: "0,5x", "1x", "2x"
        loc = self.page.locator(".speed-wrap .seg-btn", has_text=label).first
        loc.scroll_into_view_if_needed()
        loc.click()

    def pause_btn(self):
        loc = self.page.locator('[data-act="pause"]').first
        loc.scroll_into_view_if_needed()
        loc.click()

    def reset_btn(self):
        loc = self.page.locator('[data-act="reset"]').first
        loc.scroll_into_view_if_needed()
        loc.click()

    # ---------- baca keadaan ----------
    def readouts(self):
        return self.page.evaluate("""() => Object.fromEntries([...document.querySelectorAll('.lesson-kontrol .readout')]
            .map(r => [r.querySelector('.readout-label')?.textContent, r.querySelector('.readout-value')?.textContent]))""")

    def hud(self):
        return self.page.evaluate("""() => [...document.querySelectorAll('.hud-chip')]
            .map(c => (c.hidden ? '[x] ' : '') + c.textContent.trim().replace(/\\s+/g, ' '))""")

    def status(self):
        return self.page.locator(".sim-status").first.inner_text()

    def note(self):
        return self.page.locator(".lesson-kontrol .result-note").first.inner_text()

    def slider(self, label):
        """Locator input range dengan label persis."""
        return self.page.locator(".lesson-kontrol .ctl-slider").filter(
            has=self.page.locator("label", has_text=label)).locator("input[type=range]").first

    def slider_value(self, label):
        return float(self.slider(label).input_value())

    def set_slider(self, label, value):
        """Geser slider seperti pelajar: klik/ketuk di posisi nilai pada trek, lalu rapikan dengan tombol panah."""
        inp = self.slider(label)
        inp.scroll_into_view_if_needed()
        mn = float(inp.get_attribute("min"))
        mx = float(inp.get_attribute("max"))
        step = float(inp.get_attribute("step"))
        box = inp.bounding_box()
        frac = (value - mn) / (mx - mn)
        # jempol slider kira-kira 16 px: posisi efektif trek
        thumb = 16
        x = box["x"] + thumb / 2 + frac * (box["width"] - thumb)
        y = box["y"] + box["height"] / 2
        if self.mobile:
            self.page.touchscreen.tap(x, y)
        else:
            self.page.mouse.click(x, y)
        time.sleep(0.05)
        # rapikan dengan papan ketik (tetap interaksi UI sungguhan, memicu event input)
        for _ in range(60):
            v = float(inp.input_value())
            if abs(v - value) < step / 2:
                break
            inp.press("ArrowRight" if v < value else "ArrowLeft")
        return float(inp.input_value())

    def click_text(self, selector, text):
        loc = self.page.locator(selector, has_text=text).first
        loc.scroll_into_view_if_needed()
        if self.mobile:
            loc.tap()
        else:
            loc.click()

    def wait_for(self, fn, timeout, poll=0.25):
        t0 = time.time()
        while time.time() - t0 < timeout:
            v = fn()
            if v:
                return time.time() - t0
            time.sleep(poll)
        return None

    def shot(self, name, full=False):
        path = SHOTS + name + ".png"
        self.page.screenshot(path=path, full_page=full)
        return path

    def stage_shot(self, name):
        path = SHOTS + name + ".png"
        self.page.locator(".stage").first.screenshot(path=path)
        return path


def expose_sim(page):
    """Hanya untuk uji: sajikan kontrol.js dengan satu baris tambahan yang memasang objek sim di
    window.__kvSim (berkas aslinya tidak diubah). Dipakai untuk memeriksa posisi mobil dan
    memajukan simulasi secara pasti saat mengambil gambar."""
    import urllib.request

    def handle(route):
        body = urllib.request.urlopen(route.request.url).read().decode("utf-8")
        body = body.replace("const sim = createSim(track, { seed: 7 });",
                            "const sim = createSim(track, { seed: 7 }); window.__kvSim = sim; window.__kvTrack = track;")
        route.fulfill(status=200, body=body, headers={"content-type": "text/javascript; charset=utf-8", "cache-control": "no-store"})

    page.route("**/js/lessons/kontrol.js*", handle)
