"""Alat bantu uji fungsional simulator 3D (QA fungsi, port 8102)."""
import json
import os
import time

from playwright.sync_api import sync_playwright  # noqa: F401

BASE = os.environ.get("SIM3D_BASE", "http://127.0.0.1:8102")
CHROME = "/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
SHOTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots", "sim3d_fungsi")
os.makedirs(SHOTS, exist_ok=True)
SWIFT = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]


def launch(p, extra=None, swift=False):
    args = (SWIFT if swift else []) + (extra or [])
    return p.chromium.launch(executable_path=CHROME, headless=True, args=args)


def new_page(browser, mobile=False, init_script=None):
    if mobile:
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, device_scale_factor=2)
    else:
        ctx = browser.new_context(viewport={"width": 1366, "height": 900})
    if init_script:
        ctx.add_init_script(init_script)
    page = ctx.new_page()
    page.resets = []
    log = []

    def on_console(msg):
        if msg.type in ("error", "warning"):
            if "ERR_CONNECTION_RESET" in msg.text:
                page.resets.append(msg.text)
                return
            log.append(f"[{msg.type}] {msg.text}")

    page.on("console", on_console)
    page.on("pageerror", lambda e: log.append(f"[pageerror] {e}"))
    page.logs = log
    return ctx, page, log


def snap(page):
    return page.evaluate("() => { const s = window.__sim3d; if (!s) return null; const o = {}; for (const k of Object.keys(s)) { if (typeof s[k] !== 'function') o[k] = s[k]; } return JSON.parse(JSON.stringify(o)); }")


def wait_ready(page, timeout=60):
    """Tunggu simulator siap. python -m http.server (antrean listen 5) kadang memutus koneksi
    saat banyak modul dimuat bersamaan (ERR_CONNECTION_RESET); bila begitu, muat ulang halaman."""
    t0 = time.time()
    last_reload = t0
    reloads = 0
    while time.time() - t0 < timeout:
        try:
            s = snap(page)
        except Exception:
            s = None
        if s and s.get("ready"):
            page.reloads = reloads
            return s
        if time.time() - last_reload > 6 and reloads < 6:
            reloads += 1
            last_reload = time.time()
            # buang catatan putus koneksi dari server uji
            page.logs[:] = [x for x in page.logs if "ERR_CONNECTION_RESET" not in x]
            page.reload()
            continue
        time.sleep(0.25)
    raise RuntimeError("simulator tidak siap")


def wait_until(page, fn, timeout=60, every=0.25):
    t0 = time.time()
    last = None
    while time.time() - t0 < timeout:
        try:
            last = snap(page)
        except Exception:
            last = None
        if last and fn(last):
            return last
        time.sleep(every)
    return None


def shot(page, name, full=False):
    path = os.path.join(SHOTS, name)
    page.screenshot(path=path, full_page=full)
    return path


def text(page, sel):
    return page.evaluate("(s) => { const e = document.querySelector(s); return e ? e.textContent.trim() : null; }", sel)


def dump(obj):
    print(json.dumps(obj, indent=1, ensure_ascii=False))
