"""Alat bantu uji untuk area situs (shell LiveShuttle).

Dipakai oleh tests/situs_*.py. Server harus sudah berjalan:
  python3 tests/serve.py 8221
"""

import os
import re
from contextlib import contextmanager

from playwright.sync_api import sync_playwright

CHROME = (
    "/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
    "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
)
SWIFTSHADER = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
GPU = ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, "tests", "shots", "situs")
BASE = f"http://127.0.0.1:{os.environ.get('PORT', '8221')}/"
IGNORE = [re.compile(r"GPU stall due to ReadPixels")]

LESSONS = [
    "level-otomasi",
    "sensor",
    "persepsi",
    "lokalisasi",
    "rute",
    "kontrol",
    "keputusan",
    "jarak-aman",
    "shuttle",
    "kuis",
]


class Console:
    def __init__(self):
        self.errors = []
        self.warnings = []
        self.page_errors = []

    def attach(self, page):
        def on_console(msg):
            if any(r.search(msg.text) for r in IGNORE):
                return
            if msg.type == "error":
                self.errors.append(msg.text)
            elif msg.type == "warning":
                self.warnings.append(msg.text)

        page.on("console", on_console)
        page.on("pageerror", lambda exc: self.page_errors.append(str(exc)))

    def clear(self):
        self.errors.clear()
        self.warnings.clear()
        self.page_errors.clear()

    def summary(self):
        return {"errors": list(self.errors), "warnings": list(self.warnings), "pageErrors": list(self.page_errors)}

    @property
    def clean(self):
        return not (self.errors or self.warnings or self.page_errors)


@contextmanager
def browser(args=None):
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=CHROME, headless=True, args=args if args is not None else SWIFTSHADER)
        try:
            yield b
        finally:
            b.close()


def new_page(b, mobile=False):
    if mobile:
        ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    else:
        ctx = b.new_context(viewport={"width": 1366, "height": 900})
    page = ctx.new_page()
    con = Console()
    con.attach(page)
    return ctx, page, con


def shot(page, name, full_page=False):
    os.makedirs(SHOTS, exist_ok=True)
    path = os.path.join(SHOTS, name if name.endswith(".png") else name + ".png")
    page.screenshot(path=path, full_page=full_page)
    return path


def hook(page):
    return page.evaluate("() => window.__simotonom ? JSON.parse(JSON.stringify(window.__simotonom)) : null")
