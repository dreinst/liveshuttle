"""Alat bantu uji untuk pelajaran Perencanaan Rute (peta jalan Malang). Server: port 8245.

Jalankan server dulu: python3 tests/serve.py 8245
"""
import os
import time

from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
PORT = int(os.environ.get("RUTE_PORT", "8245"))
BASE = f"http://127.0.0.1:{PORT}/"
SHOTS = "/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/rute/"
IGNORE = ("GPU stall due to ReadPixels",)


class Session:
    def __init__(self, mobile=False, reduced=False, gpu=False, swiftshader=False):
        self.mobile = mobile
        self.reduced = reduced
        self.gpu = gpu
        self.swiftshader = swiftshader
        self.errors = []

    def __enter__(self):
        os.makedirs(SHOTS, exist_ok=True)
        self.pw = sync_playwright().start()
        args = ["--use-angle=metal", "--enable-gpu"] if self.gpu else []
        if self.swiftshader:
            # alur perangkat lunak: WebGL lewat SwiftShader, kanvas 2D tanpa akselerasi GPU
            args = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-gpu", "--disable-accelerated-2d-canvas"]
        self.browser = self.pw.chromium.launch(executable_path=CHROME, headless=True, args=args)
        opts = {"reduced_motion": "reduce"} if self.reduced else {}
        if self.mobile:
            self.ctx = self.browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True, **opts)
        else:
            self.ctx = self.browser.new_context(viewport={"width": 1366, "height": 900}, device_scale_factor=1, **opts)
        self.page = self.ctx.new_page()

        def on_console(m):
            if m.type in ("error", "warning") and not any(s in m.text for s in IGNORE):
                self.errors.append(f"{m.type}: {m.text}")

        self.page.on("console", on_console)
        self.page.on("pageerror", lambda e: self.errors.append(f"pageerror: {e}"))
        return self

    def __exit__(self, *exc):
        self.ctx.close()
        self.browser.close()
        self.pw.stop()

    # ---------- navigasi ----------
    def go(self, route="#/pelajaran/rute", wait_ready=True):
        self.page.goto(BASE + route, wait_until="load")
        if wait_ready:
            self.page.wait_for_function("() => window.__simotonom && window.__simotonom.lessonStatus === 'ready' && window.__rute", timeout=20000)
            self.page.wait_for_timeout(400)

    def goto_step(self, i):
        self.page.locator(f'.step-dot[data-go="{i}"]').first.click()
        self.page.wait_for_timeout(300)

    def hook(self):
        return self.page.evaluate("() => JSON.parse(JSON.stringify(window.__simotonom))")

    def snap(self):
        return self.page.evaluate("() => window.__rute.snapshot()")

    def status(self):
        return self.page.locator(".sim-status").inner_text()

    def done_tasks(self):
        return self.hook().get("completedTasks", [])

    def shot(self, name, full=False, selector=None):
        path = SHOTS + name + ".png"
        if selector:
            self.page.locator(selector).first.screenshot(path=path)
        else:
            self.page.screenshot(path=path, full_page=full)
        return path

    # ---------- kontrol ----------
    def button(self, label):
        return self.page.locator("button.btn", has_text=label).first

    def click_button(self, label, required=True):
        b = self.button(label)
        if not required and (b.count() == 0 or not b.is_enabled()):
            return False
        b.scroll_into_view_if_needed()
        b.click()
        self.page.wait_for_timeout(150)
        return True

    def seg(self, label):
        b = self.page.locator(".seg-btn", has_text=label).first
        b.scroll_into_view_if_needed()
        b.click()
        self.page.wait_for_timeout(120)

    def select(self, which, value):
        sel = self.page.locator("select.rute-select").nth(0 if which == "start" else 1)
        sel.scroll_into_view_if_needed()
        sel.select_option(value)
        self.page.wait_for_timeout(200)

    def canvas_box(self):
        return self.page.locator(".sim-canvas").first.bounding_box()

    def tap_canvas(self, pt):
        """pt = {x, y} relatif kanvas (dari window.__rute.routePoint dan sejenisnya)."""
        box = self.canvas_box()
        x, y = box["x"] + pt["x"], box["y"] + pt["y"]
        if self.mobile:
            self.page.touchscreen.tap(x, y)
        else:
            self.page.mouse.click(x, y)
        self.page.wait_for_timeout(200)

    def scroll_stage(self):
        self.page.locator(".stage").first.scroll_into_view_if_needed()
        self.page.wait_for_timeout(150)

    def wait_until(self, js, timeout=30000, poll=100):
        t0 = time.time()
        while time.time() - t0 < timeout / 1000:
            if self.page.evaluate(js):
                return True
            self.page.wait_for_timeout(poll)
        return False
