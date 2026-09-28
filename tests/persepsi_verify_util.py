"""Alat bantu QA mandiri untuk pelajaran Persepsi (port 8263, server: python3 tests/serve.py 8263)."""
import json
import sys

from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
PORT = sys.argv[sys.argv.index("--port") + 1] if "--port" in sys.argv else "8263"
BASE = f"http://127.0.0.1:{PORT}/"
SHOTS = "/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/persepsi-verify/"
ROUTE = "#/pelajaran/persepsi"


class Session:
    def __init__(self, mobile=False, gpu=False, reduced=False, init_script=None):
        self.mobile = mobile
        self.gpu = gpu
        self.reduced = reduced
        self.init_script = init_script
        self.errors = []

    def __enter__(self):
        self.pw = sync_playwright().start()
        args = ["--use-angle=metal", "--enable-gpu"] if self.gpu else []
        self.browser = self.pw.chromium.launch(executable_path=CHROME, headless=True, args=args)
        kw = {"reduced_motion": "reduce"} if self.reduced else {}
        if self.mobile:
            self.ctx = self.browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True, **kw)
        else:
            self.ctx = self.browser.new_context(viewport={"width": 1366, "height": 900}, device_scale_factor=1, **kw)
        if self.init_script:
            self.ctx.add_init_script(self.init_script)
        self.page = self.ctx.new_page()
        self.page.on("console", lambda m: self.errors.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") and "GPU stall due to ReadPixels" not in m.text else None)
        self.page.on("pageerror", lambda e: self.errors.append(f"pageerror: {e}"))
        return self

    def go(self, route=ROUTE, wait=1500):
        self.page.goto(BASE + route, wait_until="load")
        self.page.wait_for_timeout(wait)

    def hook(self):
        return self.page.evaluate("() => JSON.parse(JSON.stringify(window.__simotonom))")

    def safety(self):
        return self.page.evaluate("() => window.__lessonSafety ? JSON.parse(JSON.stringify({...window.__lessonSafety, log: undefined, clampLog: undefined})) : null")

    def shot(self, name, full=False, selector=None):
        path = SHOTS + name + ".png"
        if selector:
            self.page.locator(selector).first.screenshot(path=path)
        else:
            self.page.screenshot(path=path, full_page=full)
        return path

    def step(self, i):
        self.page.locator(f'.step-dot[data-go="{i}"]').first.click()
        self.page.wait_for_timeout(300)

    def toggle(self, label):
        """Klik sakelar berlabel `label` di panel kontrol."""
        loc = self._tog(label)
        loc.scroll_into_view_if_needed()
        loc.click()
        self.page.wait_for_timeout(150)

    def toggle_state(self, label):
        return self._tog(label).get_attribute("aria-checked") == "true"

    def _tog(self, label):
        import re as _re
        return self.page.locator(".ctl-toggle").filter(has=self.page.locator(".toggle-label", has_text=_re.compile("^" + _re.escape(label) + "$"))).first

    def __exit__(self, *a):
        self.browser.close()
        self.pw.stop()


def dump(obj):
    print(json.dumps(obj, indent=2, ensure_ascii=False))
    sys.stdout.flush()
