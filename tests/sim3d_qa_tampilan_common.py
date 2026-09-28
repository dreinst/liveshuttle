"""Alat bantu uji QA tampilan simulator 3D (port 8104, hanya baca, tidak mengubah berkas proyek)."""
import json
import os
import time

BASE = os.environ.get("SIM3D_BASE", "http://127.0.0.1:8104")
CHROME = "/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
SHOTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots", "sim3d_tampilan")
os.makedirs(SHOTS, exist_ok=True)
SWIFT_ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]


def launch(p, swift=False, extra=None):
    args = (SWIFT_ARGS if swift else []) + (extra or [])
    return p.chromium.launch(executable_path=CHROME, headless=True, args=args)


def new_page(browser, mobile=False):
    if mobile:
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, device_scale_factor=2)
    else:
        ctx = browser.new_context(viewport={"width": 1366, "height": 900})
    page = ctx.new_page()
    log = []
    page.logs = log

    def on_console(msg):
        if msg.type in ("error", "warning"):
            log.append(f"[{msg.type}] {msg.text}")

    page.on("console", on_console)
    page.on("pageerror", lambda e: log.append(f"[pageerror] {e}"))
    return ctx, page, log


def snap(page):
    return page.evaluate(
        "() => { const s = window.__sim3d; if (!s) return null; const o = {}; for (const k of Object.keys(s)) { if (typeof s[k] !== 'function') o[k] = s[k]; } return JSON.parse(JSON.stringify(o)); }"
    )


def wait_ready(page, timeout=40):
    t0 = time.time()
    reloaded = False
    while time.time() - t0 < timeout:
        # python -m http.server kadang memutus koneksi saat banyak modul dimuat; muat ulang sekali.
        if not reloaded and time.time() - t0 > 12:
            try:
                if page.evaluate("() => !window.__sim3d"):
                    reloaded = True
                    print("  (muat ulang: modul belum termuat)")
                    page.reload()
                    continue
            except Exception:
                pass
        try:
            s = snap(page)
        except Exception:
            s = None
        if s and s.get("ready"):
            return s
        time.sleep(0.25)
    raise RuntimeError("simulator tidak siap")


def shot(page, name, full=False):
    path = os.path.join(SHOTS, name)
    page.screenshot(path=path, full_page=full)
    return path


def dump(obj):
    print(json.dumps(obj, indent=1, ensure_ascii=False))
