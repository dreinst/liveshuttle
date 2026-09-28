"""Beberapa bingkai berurutan dari tampilan LiDAR pelajaran Sensor, untuk menilai apakah titiknya tenang
(tidak berkedip dan tanpa garis sinar). Juga menghitung seberapa banyak piksel berubah antar bingkai.

Pemakaian: python3 tests/sensor_lidar_frames.py
Butuh server di port 8242.
"""
import io
import json
from PIL import Image, ImageChops
from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
OUT = "/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/sensor/"
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, headless=True)
    p = b.new_page(viewport={"width": 1366, "height": 900})
    p.goto("http://127.0.0.1:8242/#/pelajaran/sensor")
    p.wait_for_function("window.__lessonSafety && window.__simotonom.lessonStatus === 'ready'", timeout=20000)
    p.locator(".ctl-toggle", has_text="LiDAR").first.click()
    p.wait_for_timeout(4000)
    canvas = p.locator(".sim-canvas").first
    frames = []
    for i in range(6):
        frames.append(Image.open(io.BytesIO(canvas.screenshot())).convert("RGB"))
        p.wait_for_timeout(120)
    b.close()
w, h = frames[0].size
crop = (0, 40, w // 2, h * 3 // 4)
strip = Image.new("RGB", ((crop[2] - crop[0]) * 3, (crop[3] - crop[1]) * 2))
for i, f in enumerate(frames):
    strip.paste(f.crop(crop), ((i % 3) * (crop[2] - crop[0]), (i // 3) * (crop[3] - crop[1])))
strip.save(OUT + "lidar-frames.png")
diffs = []
for a, c in zip(frames, frames[1:]):
    d = ImageChops.difference(a.crop(crop), c.crop(crop)).convert("L")
    data = d.get_flattened_data() if hasattr(d, "get_flattened_data") else d.getdata()
    changed = sum(1 for v in data if v > 40)
    diffs.append(changed)
print(json.dumps({"changedPixelsBetweenFrames": diffs, "cropPixels": (crop[2] - crop[0]) * (crop[3] - crop[1])}))
