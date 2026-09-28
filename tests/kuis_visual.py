#!/usr/bin/env python3
"""Tangkapan layar tambahan Kuis Akhir: cincin fokus keyboard dan mode gerak dikurangi.

Pemakaian: python3 tests/kuis_visual.py --port 8120
"""

import argparse
import os
import sys

from playwright.sync_api import sync_playwright

CHROME = (
    "/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
    "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, "tests", "shots", "kuis")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8120)
    args = ap.parse_args()
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROME, headless=True)
        ctx = browser.new_context(viewport={"width": 1366, "height": 900}, reduced_motion="reduce")
        page = ctx.new_page()
        page.on("console", lambda m: m.type in ("error", "warning") and errors.append(m.text))
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(f"http://127.0.0.1:{args.port}/#/pelajaran/kuis", wait_until="load")
        page.wait_for_function("() => window.__simotonom?.lessonStatus === 'ready'")
        page.wait_for_selector(".kz-opt")
        # fokus keyboard ke pilihan kedua
        page.focus('.kz-opt[data-slot="0"]')
        page.keyboard.press("Tab")
        focused = page.evaluate("() => document.activeElement?.dataset.slot")
        print("fokus di pilihan", focused)
        page.screenshot(path=f"{SHOTS}/vis-fokus.png", clip={"x": 436, "y": 80, "width": 900, "height": 560})
        # Spasi pada pilihan terfokus juga memilih jawaban
        page.keyboard.press("Space")
        page.wait_for_selector(".kz-feedback:not([hidden])")
        # selesaikan kuis dengan tombol angka 1 lalu Enter, cincin skor harus langsung penuh (tanpa animasi)
        while True:
            page.keyboard.press("Enter")
            if page.locator(".kz-result:not([hidden])").count():
                break
            page.keyboard.press("1")
            page.wait_for_selector(".kz-feedback:not([hidden])")
        page.wait_for_timeout(100)
        page.screenshot(path=f"{SHOTS}/vis-gerak-dikurangi.png")
        browser.close()
    print("pesan console:", errors)
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
