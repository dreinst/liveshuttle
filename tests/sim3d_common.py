"""Alat bantu bersama untuk uji Playwright simulator 3D (port 8101)."""
import json
import os
import time

from playwright.sync_api import sync_playwright

BASE = os.environ.get("SIM3D_BASE", "http://127.0.0.1:8101")
CHROME = "/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
SHOTS = os.path.join(os.path.dirname(__file__), "shots", "sim3d")
os.makedirs(SHOTS, exist_ok=True)
GL_ARGS = []  # WebGL tersedia lewat GPU (Metal). Pakai SWIFT_ARGS bila tidak tersedia.
SWIFT_ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]


def launch(p, extra_args=None):
    return p.chromium.launch(executable_path=CHROME, headless=True, args=GL_ARGS + (extra_args or []))


def new_page(browser, mobile=False):
    if mobile:
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, device_scale_factor=2)
    else:
        ctx = browser.new_context(viewport={"width": 1366, "height": 900})
    page = ctx.new_page()
    log = []
    resets = []
    page.resets = resets
    page.logs = log

    def on_console(msg):
        if msg.type in ("error", "warning"):
            # Putus koneksi dari server uji (python -m http.server, antrean listen 5) dicatat terpisah.
            if "ERR_CONNECTION_RESET" in msg.text:
                resets.append(msg.text)
                return
            log.append(f"[{msg.type}] {msg.text}")

    page.on("console", on_console)
    page.on("pageerror", lambda e: log.append(f"[pageerror] {e}"))
    return ctx, page, log


def snap(page):
    return page.evaluate("() => { const s = window.__sim3d; return s ? JSON.parse(JSON.stringify(s)) : null; }")


def wait_ready(page, timeout=30):
    t0 = time.time()
    last = None
    reloaded = 0
    while time.time() - t0 < timeout:
        # Server uji python -m http.server kadang memutus koneksi saat banyak modul dimuat
        # bersamaan (antrean listen hanya 5). Bila halaman gagal memuat modul, muat ulang.
        if reloaded < 2 and time.time() - t0 > 6 * (reloaded + 1):
            try:
                broken = page.evaluate("() => !window.__sim3d")
            except Exception:
                broken = False
            if broken:
                reloaded += 1
                page.reload()
                continue
        try:
            s = snap(page)
        except Exception as e:  # halaman sedang berpindah
            last = str(e)[:200]
            s = None
        if s and s.get("ready"):
            return s
        time.sleep(0.2)
    try:
        page.screenshot(path=os.path.join(SHOTS, "gagal_siap.png"))
        info = page.evaluate("() => ({ hash: location.hash, hook: typeof window.__sim3d, html: (document.querySelector('.sim3d-host, #host') || document.body).innerHTML.slice(0, 120), ready: document.readyState })")
        info["logs"] = getattr(page, "logs", [])[:10]
        info["resets"] = len(getattr(page, "resets", []))
    except Exception as e:
        info = str(e)
    raise RuntimeError(f"simulator tidak siap: {last} {info}")


def wait_until(page, fn, timeout=60, every=0.25):
    t0 = time.time()
    last = None
    while time.time() - t0 < timeout:
        last = snap(page)
        if last and fn(last):
            return last
        time.sleep(every)
    return None


def shot(page, name):
    path = os.path.join(SHOTS, name)
    page.screenshot(path=path)
    return path


def dump(obj):
    print(json.dumps(obj, indent=1, ensure_ascii=False))
