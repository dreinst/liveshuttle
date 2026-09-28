"""Alat bantu QA mandiri untuk pelajaran Persepsi (port bawaan 8243, bisa diganti dengan --port P)."""
import json
import sys
import time

from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
PORT = sys.argv[sys.argv.index("--port") + 1] if "--port" in sys.argv else "8243"
BASE = f"http://127.0.0.1:{PORT}/"
SHOTS = "/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/persepsi-malang/"
ROUTE = "#/pelajaran/persepsi"


class Session:
    def __init__(self, mobile=False):
        self.mobile = mobile
        self.errors = []
        self.phase = "start"

    def __enter__(self):
        self.pw = sync_playwright().start()
        self.browser = self.pw.chromium.launch(executable_path=CHROME, headless=True)
        if self.mobile:
            self.ctx = self.browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        else:
            self.ctx = self.browser.new_context(viewport={"width": 1366, "height": 900}, device_scale_factor=1)
        self.page = self.ctx.new_page()
        self.page.on("console", lambda m: self.errors.append(f"[{self.phase}] {m.type}: {m.text} @ {m.location.get('url', '')}") if m.type in ("error", "warning") else None)
        self.page.on("requestfailed", lambda r: self.errors.append(f"[{self.phase}] requestfailed: {r.url} {r.failure}"))
        self.page.on("pageerror", lambda e: self.errors.append(f"[{self.phase}] pageerror: {e}"))
        self.cdp = self.ctx.new_cdp_session(self.page)
        return self

    def go(self, route, wait=1200):
        self.page.goto(BASE + route, wait_until="load")
        self.page.wait_for_timeout(wait)

    def fresh(self):
        # hash saja tidak memuat ulang dokumen, jadi progres di memori harus dibuang dengan reload
        self.go("#/", 300)
        self.page.evaluate("() => localStorage.clear()")
        self.page.goto("about:blank")
        self.go(ROUTE, 1500)
        assert self.hook()["stepIndex"] == 0, self.hook()

    def hook(self):
        return self.page.evaluate("() => JSON.parse(JSON.stringify(window.__simotonom))")

    def done(self):
        return self.hook()["completedTasks"]

    def shot(self, name, full=False, selector=None):
        path = SHOTS + name + ".png"
        if selector:
            self.page.locator(selector).first.screenshot(path=path)
        else:
            self.page.screenshot(path=path, full_page=full)
        return path

    # ---------- interaksi seperti pelajar ----------
    def toggle(self, label):
        loc = self.page.locator(".ctl-toggle").filter(has=self.page.locator(".toggle-label", has_text=label)).first
        loc.scroll_into_view_if_needed()
        if self.mobile:
            loc.tap()
        else:
            loc.click()
        return loc

    def toggle_state(self, label):
        loc = self.page.locator(".ctl-toggle").filter(has=self.page.locator(".toggle-label", has_text=label)).first
        return loc.get_attribute("aria-checked") == "true"

    def press(self, loc):
        loc.scroll_into_view_if_needed()
        if self.mobile:
            loc.tap()
        else:
            loc.click()

    def wait_toasts(self, timeout=6000):
        t0 = time.time()
        while time.time() - t0 < timeout / 1000:
            if self.page.locator(".toast:visible").count() == 0:
                return
            self.page.wait_for_timeout(200)

    def nav(self, which):
        """Tekan Lanjut ('next') atau Kembali ('prev') di kartu langkah, seperti pelajar."""
        sel = ".step-nav .btn-primary" if which == "next" else ".step-nav .btn-secondary"
        loc = self.page.locator(sel).first
        loc.scroll_into_view_if_needed()
        try:
            if self.mobile:
                loc.tap(timeout=3000)
            else:
                loc.click(timeout=3000)
        except Exception:
            self.wait_toasts()
            loc.click(timeout=5000)
        self.page.wait_for_timeout(250)

    def drag_slider(self, label, target):
        """Seret jempol slider ke nilai target dengan mouse (desktop) atau sentuhan (mobile)."""
        inp = self.page.locator(".ctl-slider").filter(has=self.page.locator("label", has_text=label)).locator("input").first
        inp.scroll_into_view_if_needed()
        self.page.wait_for_timeout(150)
        box = inp.bounding_box()
        mn = float(inp.get_attribute("min"))
        mx = float(inp.get_attribute("max"))
        cur = float(inp.input_value())
        thumb = 16  # lebar jempol kira-kira
        span = box["width"] - thumb

        def px(v):
            return box["x"] + thumb / 2 + span * (v - mn) / (mx - mn)

        y = box["y"] + box["height"] / 2
        x0 = px(cur)
        x1 = px(target)
        if not self.mobile:
            self.page.mouse.move(x0, y)
            self.page.mouse.down()
            for i in range(1, 13):
                self.page.mouse.move(x0 + (x1 - x0) * i / 12, y)
                self.page.wait_for_timeout(16)
            self.page.mouse.up()
        else:
            def touch(kind, x):
                pts = [] if kind == "touchEnd" else [{"x": x, "y": y}]
                self.cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": pts})

            touch("touchStart", x0)
            for i in range(1, 13):
                touch("touchMove", x0 + (x1 - x0) * i / 12)
                self.page.wait_for_timeout(16)
            touch("touchEnd", x1)
        self.page.wait_for_timeout(120)
        return float(inp.input_value())

    def wait_task(self, task, timeout=40):
        t0 = time.time()
        while time.time() - t0 < timeout:
            if task in self.done():
                return round(time.time() - t0, 1)
            self.page.wait_for_timeout(150)
        return None

    def status(self):
        return self.page.locator(".sim-status").inner_text()

    def top(self):
        self.page.evaluate("() => window.scrollTo(0, 0)")
        self.page.wait_for_timeout(120)

    def rows(self):
        return self.page.evaluate(
            """() => [...document.querySelectorAll('.grp-list tbody tr')].map((tr) => ({
                cls: tr.className,
                cells: [...tr.children].map((c) => c.innerText.trim()),
            }))"""
        )

    def window_listeners(self):
        out = {}
        for name, expr in (("window", "window"), ("document", "document")):
            obj = self.cdp.send("Runtime.evaluate", {"expression": expr})["result"]["objectId"]
            ls = self.cdp.send("DOMDebugger.getEventListeners", {"objectId": obj})["listeners"]
            out[name] = len(ls)
        return out

    def __exit__(self, *a):
        self.browser.close()
        self.pw.stop()


def dump(obj):
    print(json.dumps(obj, indent=2, ensure_ascii=False))
    sys.stdout.flush()
