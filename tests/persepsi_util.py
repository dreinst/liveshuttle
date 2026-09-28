"""Alat bantu uji untuk pelajaran Persepsi (port 8243, server: python3 tests/serve.py 8243)."""
import json
import sys

from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
PORT = sys.argv[sys.argv.index("--port") + 1] if "--port" in sys.argv else "8243"
BASE = f"http://127.0.0.1:{PORT}/"
SHOTS = "/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/persepsi-malang/"


class Session:
    def __init__(self, mobile=False):
        self.mobile = mobile
        self.errors = []

    def __enter__(self):
        self.pw = sync_playwright().start()
        self.browser = self.pw.chromium.launch(executable_path=CHROME, headless=True)
        if self.mobile:
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


def dump(obj):
    print(json.dumps(obj, indent=2, ensure_ascii=False))
    sys.stdout.flush()
