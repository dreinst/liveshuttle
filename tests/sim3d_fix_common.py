"""Alat bantu uji perbaikan simulator 3D (port 8105)."""
import json
import os
import time

from playwright.sync_api import sync_playwright  # noqa: F401

BASE = os.environ.get("SIM3D_BASE", "http://127.0.0.1:8105")
CHROME = "/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
SHOTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots", "sim3d_fix")
os.makedirs(SHOTS, exist_ok=True)

# Menangkap objek App lewat setter sementara (sama seperti skrip QA perilaku).
INIT_JS = r"""
(() => {
  Object.defineProperty(Object.prototype, 'app', {
    configurable: true, enumerable: false,
    get() { return undefined; },
    set(v) {
      try { if (v && v.constructor && v.constructor.name === 'App') window.__app = v; } catch (e) {}
      Object.defineProperty(this, 'app', { value: v, writable: true, configurable: true, enumerable: true });
    },
  });
})();
"""


def launch(p, swift=False):
    args = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] if swift else []
    return p.chromium.launch(executable_path=CHROME, headless=True, args=args)


def new_page(browser, mobile=False, width=1366, height=900, capture=True):
    if mobile:
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, device_scale_factor=2)
    else:
        ctx = browser.new_context(viewport={"width": width, "height": height})
    if capture:
        ctx.add_init_script(INIT_JS)
    page = ctx.new_page()
    log = []

    def on_console(msg):
        if msg.type in ("error", "warning") and "ERR_CONNECTION_RESET" not in msg.text:
            log.append(f"[{msg.type}] {msg.text}")

    page.on("console", on_console)
    page.on("pageerror", lambda e: log.append(f"[pageerror] {e}"))
    page.logs = log
    return ctx, page, log


def snap(page):
    return page.evaluate("() => { const s = window.__sim3d; if (!s) return null; const o = {}; for (const k of Object.keys(s)) { if (typeof s[k] !== 'function') o[k] = s[k]; } return JSON.parse(JSON.stringify(o)); }")


def open_sim(page, mode="tutorial", timeout=60):
    page.goto(f"{BASE}/index.html#/simulator/{mode}")
    t0 = time.time()
    reloaded = False
    while time.time() - t0 < timeout:
        try:
            s = snap(page)
        except Exception:
            s = None
        if s and s.get("ready"):
            return s
        if not reloaded and time.time() - t0 > 15:
            reloaded = True
            page.reload()
        time.sleep(0.25)
    raise RuntimeError("simulator tidak siap")


def wait_until(page, pred, timeout=60, step=0.2):
    t0 = time.time()
    s = None
    while time.time() - t0 < timeout:
        s = snap(page)
        if s and pred(s):
            return s
        time.sleep(step)
    return None


def shot(page, name):
    path = os.path.join(SHOTS, name)
    page.screenshot(path=path)
    return path


def ev(page, js, arg=None):
    return page.evaluate(js, arg) if arg is not None else page.evaluate(js)


def dump(x):
    print(json.dumps(x, ensure_ascii=False, indent=1))
