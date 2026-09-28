"""Alat bantu uji tahap peta Shuttle 3D Ma Chung (port 8201, lewat tests/sim3d_harness.html)."""
import json
import os
import time

from playwright.sync_api import sync_playwright  # noqa: F401

BASE = os.environ.get("SIM3D_BASE", "http://127.0.0.1:8201")
CHROME = "/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
SHOTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots", "peta")
os.makedirs(SHOTS, exist_ok=True)
SWIFT = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
GPU = ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"]

IGNORE = ("GPU stall due to ReadPixels", "ERR_CONNECTION_RESET")


def launch(p, mode="swift"):
    args = SWIFT if mode == "swift" else GPU
    return p.chromium.launch(executable_path=CHROME, headless=True, args=args)


def new_page(browser, mobile=False, width=1366, height=900):
    if mobile:
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, device_scale_factor=2)
    else:
        ctx = browser.new_context(viewport={"width": width, "height": height})
    page = ctx.new_page()
    log = []

    def on_console(msg):
        if msg.type in ("error", "warning"):
            if any(s in msg.text for s in IGNORE):
                return
            log.append(f"[{msg.type}] {msg.text}")

    page.on("console", on_console)
    page.on("pageerror", lambda e: log.append(f"[pageerror] {e}"))
    return ctx, page, log


def snap(page):
    return page.evaluate(
        "() => { const s = window.__sim3d; if (!s) return null; const o = {}; for (const k of Object.keys(s)) { if (k !== 'debug') o[k] = s[k]; } return JSON.parse(JSON.stringify(o)); }"
    )


def open_harness(page, mode="panduan", timeout=90):
    page.goto(f"{BASE}/tests/sim3d_harness.html?mode={mode}")
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            s = snap(page)
        except Exception:
            s = None
        if s and s.get("ready"):
            return s
        time.sleep(0.3)
    raise RuntimeError("simulator tidak siap")


def wait_sim(page, sim_seconds, timeout=600, poll=1.0):
    """Tunggu sampai waktu simulasi bertambah sim_seconds."""
    s0 = snap(page)["simTime"]
    t0 = time.time()
    while time.time() - t0 < timeout:
        s = snap(page)
        if s["simTime"] - s0 >= sim_seconds:
            return s
        time.sleep(poll)
    return snap(page)


def shot(page, name):
    path = os.path.join(SHOTS, name)
    page.screenshot(path=path)
    return path


def dump(x):
    print(json.dumps(x, ensure_ascii=False, indent=1))
