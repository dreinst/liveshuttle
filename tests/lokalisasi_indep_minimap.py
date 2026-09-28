"""QA independen: peta mini Lokalisasi memudar saat ada estimasi di bawahnya (layar ponsel).

Mengambil banyak bingkai panggung di langkah 2 selama mobil melewati zona gedung tinggi, lalu
membuat lembar kontak dari bingkai yang kotak peta mininya berubah (memudar).
Pemakaian: python3 tests/lokalisasi_indep_minimap.py [--port 8134]
"""
import io
import os
import re
import sys

from PIL import Image
from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
PORT = sys.argv[sys.argv.index("--port") + 1] if "--port" in sys.argv else "8134"
BASE = f"http://127.0.0.1:{PORT}/"
SHOTS = "/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/lokalisasi-malang/lama-qa/"
os.makedirs(SHOTS, exist_ok=True)
msgs = []

with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=CHROME, headless=True)
    bctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    page = bctx.new_page()
    page.on("console", lambda m: msgs.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: msgs.append(f"pageerror: {e}"))
    page.goto(BASE + "#/", wait_until="load")
    page.evaluate("() => localStorage.clear()")
    page.reload(wait_until="load")
    page.goto(BASE + "#/pelajaran/lokalisasi", wait_until="load")
    page.wait_for_timeout(1200)
    page.locator('.step-dot[data-go="1"]').tap()
    page.wait_for_timeout(500)
    gps = page.locator(".ctl-toggle").filter(has=page.locator(".toggle-label", has_text=re.compile("^GPS$"))).first
    gps.scroll_into_view_if_needed()
    gps.tap()
    page.evaluate("() => window.scrollTo(0, 0)")
    page.wait_for_timeout(300)
    stage = page.locator(".stage")
    frames = []
    # dua kali lewat zona: tunggu satu putaran penuh di antaranya dengan kecepatan 2x
    for rnd in range(2):
        for i in range(60):
            png = stage.screenshot()
            im = Image.open(io.BytesIO(png)).convert("RGB")
            # rata-rata kecerahan di dalam kotak peta mini (kiri bawah, di tengah kotak)
            w, h = im.size
            box = im.crop((int(w * 0.07), int(h * 0.80), int(w * 0.25), int(h * 0.93)))
            px = list(box.getdata())
            lum = sum(0.3 * r + 0.59 * g + 0.11 * b for r, g, b in px) / len(px)
            frames.append((lum, im, rnd, i))
            page.wait_for_timeout(180)
        if rnd == 0:
            page.locator(".speed-wrap .seg-btn", has_text="2x").tap()
            page.evaluate("() => window.scrollTo(0, 0)")
            page.wait_for_timeout(22000)
            page.locator(".speed-wrap .seg-btn", has_text="1x").tap()
            page.evaluate("() => window.scrollTo(0, 0)")
            page.wait_for_timeout(200)
    lums = [f[0] for f in frames]
    base = sorted(lums)[len(lums) // 2]
    faded = [f for f in frames if abs(f[0] - base) > 6]
    print({"frames": len(frames), "medianLum": round(base, 1), "fadedFrames": len(faded),
           "lumRange": [round(min(lums), 1), round(max(lums), 1)], "console": msgs})
    pick = (faded or frames)[:6]
    tw, th = pick[0][1].size
    sheet = Image.new("RGB", (tw * 3 // 2, th * 2 // 2 * ((len(pick) + 2) // 3) // 1), (0, 0, 0))
    sheet = Image.new("RGB", ((tw // 2) * 3, (th // 2) * ((len(pick) + 2) // 3)), (0, 0, 0))
    for k, f in enumerate(pick):
        sheet.paste(f[1].resize((tw // 2, th // 2)), ((k % 3) * (tw // 2), (k // 3) * (th // 2)))
    sheet.save(f"{SHOTS}m-minimap-fade-sheet.png")
    browser.close()
