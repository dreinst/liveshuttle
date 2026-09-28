"""Alat bantu verifikasi akhir simulator 3D (port 8106, lewat rute shell yang asli)."""
import json
import os
import time

from playwright.sync_api import sync_playwright  # noqa: F401

BASE = os.environ.get("SIM3D_BASE", "http://127.0.0.1:8106")
CHROME = "/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
SHOTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots", "sim3d_final")
os.makedirs(SHOTS, exist_ok=True)
SWIFT = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]

# Hitung konteks WebGL yang dibuat halaman (untuk uji bocor).
GL_INIT = r"""
(() => {
  const ctxs = [];
  window.__glctx = ctxs;
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const c = orig.call(this, type, ...rest);
    if (c && /webgl/.test(type) && !ctxs.includes(c)) ctxs.push(c);
    return c;
  };
})();
"""


def launch(p, extra=None, swift=False):
    args = (SWIFT if swift else []) + (extra or [])
    return p.chromium.launch(executable_path=CHROME, headless=True, args=args)


def new_page(browser, mobile=False, width=1366, height=900, init=None):
    if mobile:
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, device_scale_factor=2)
    else:
        ctx = browser.new_context(viewport={"width": width, "height": height})
    if init:
        ctx.add_init_script(init)
    page = ctx.new_page()
    log = []
    page.resets = 0

    def on_console(msg):
        if msg.type in ("error", "warning"):
            if "ERR_CONNECTION_RESET" in msg.text:
                page.resets += 1
                return
            log.append(f"[{msg.type}] {msg.text}")

    page.on("console", on_console)
    page.on("pageerror", lambda e: log.append(f"[pageerror] {e}"))
    return ctx, page, log


def snap(page):
    return page.evaluate("() => { const s = window.__sim3d; if (!s) return null; const o = {}; for (const k of Object.keys(s)) { if (typeof s[k] !== 'function') o[k] = s[k]; } return JSON.parse(JSON.stringify(o)); }")


def wait_ready(page, timeout=60):
    t0 = time.time()
    last = t0
    reloads = 0
    while time.time() - t0 < timeout:
        try:
            s = snap(page)
        except Exception:
            s = None
        if s and s.get("ready"):
            return s
        # python http.server kadang memutus koneksi saat banyak modul dimuat sekaligus
        if time.time() - last > 8 and reloads < 4:
            reloads += 1
            last = time.time()
            page.reload()
            continue
        time.sleep(0.25)
    raise RuntimeError("simulator tidak siap")


def open_route(page, mode):
    page.goto(f"{BASE}/index.html#/simulator/{mode}")
    return wait_ready(page)


def wait_until(page, pred, timeout=60, step=0.25):
    t0 = time.time()
    s = None
    while time.time() - t0 < timeout:
        try:
            s = snap(page)
        except Exception:
            s = None
        if s and pred(s):
            return s
        time.sleep(step)
    return None


def shot(page, name, full=False):
    path = os.path.join(SHOTS, name)
    page.screenshot(path=path, full_page=full)
    return path


def dump(x):
    print(json.dumps(x, ensure_ascii=False, indent=1))
