"""Alat bantu uji untuk pelajaran Perencanaan Rute (port 8115)."""
import sys

from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
BASE = "http://127.0.0.1:8115/"
SHOTS = "/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/rute/"

COLS, ROWS, CELL = 24, 16, 25
MAP_W, MAP_H = COLS * CELL, ROWS * CELL


class Session:
    def __init__(self, mobile=False):
        self.mobile = mobile
        self.errors = []

    def __enter__(self):
        self.pw = sync_playwright().start()
        self.browser = self.pw.chromium.launch(executable_path=CHROME, headless=True)
        if self.mobile:
            self.ctx = self.browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        else:
            self.ctx = self.browser.new_context(viewport={"width": 1366, "height": 900}, device_scale_factor=1)
        self.page = self.ctx.new_page()
        self.page.on("console", lambda m: self.errors.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
        self.page.on("pageerror", lambda e: self.errors.append(f"pageerror: {e}"))
        return self

    def go(self, route, wait=1200):
        self.page.goto(BASE + route, wait_until="load")
        self.page.wait_for_timeout(wait)

    def hook(self):
        return self.page.evaluate("() => JSON.parse(JSON.stringify(window.__simotonom))")

    def status(self):
        return self.page.locator(".sim-status").inner_text()

    def shot(self, name, full=False, selector=None):
        path = SHOTS + name + ".png"
        if selector:
            self.page.locator(selector).first.screenshot(path=path)
        else:
            self.page.screenshot(path=path, full_page=full)
        return path

    # ---------- peta ----------
    def map_transform(self):
        """Hitung letak peta di kanvas dengan rumus yang sama seperti boundsFor() di rute.js."""
        box = self.page.locator(".sim-canvas").bounding_box()
        w, h = box["width"], box["height"]
        narrow = w / h < 1.2
        top_px = 58 if narrow else 46
        bot_px = 70 if narrow else 34
        side_px = 6 if narrow else 12
        avail = max(60, h - top_px - bot_px)
        s = max(0.05, min((w - 2 * side_px) / MAP_W, avail / MAP_H))
        top = top_px + max(0, (avail - MAP_H * s) / 2)
        left = (w - MAP_W * s) / 2
        return {"x": box["x"] + left, "y": box["y"] + top, "s": s, "box": box}

    def cell_xy(self, c, r):
        t = self.map_transform()
        return t["x"] + (c + 0.5) * CELL * t["s"], t["y"] + (r + 0.5) * CELL * t["s"]

    def tap_cell(self, c, r):
        x, y = self.cell_xy(c, r)
        if self.mobile:
            self.page.touchscreen.tap(x, y)
        else:
            self.page.mouse.click(x, y)
        self.page.wait_for_timeout(150)

    def drag_cells(self, cells, steps=6):
        """Seret dari sel pertama melewati sel lainnya (mouse)."""
        x, y = self.cell_xy(*cells[0])
        self.page.mouse.move(x, y)
        self.page.mouse.down()
        for c, r in cells[1:]:
            nx, ny = self.cell_xy(c, r)
            self.page.mouse.move(nx, ny, steps=steps)
        self.page.mouse.up()
        self.page.wait_for_timeout(150)

    def route_cells(self):
        """Sel yang dilewati garis rute (warna teal di pusat sel), dibaca dari piksel kanvas."""
        t = self.map_transform()
        dpr = self.page.evaluate("() => Math.min(window.devicePixelRatio || 1, 2)")
        box = t["box"]
        pts = []
        for r in range(ROWS):
            for c in range(COLS):
                x = (t["x"] - box["x"] + (c + 0.5) * CELL * t["s"]) * dpr
                y = (t["y"] - box["y"] + (r + 0.5) * CELL * t["s"]) * dpr
                pts.append([c, r, round(x), round(y)])
        found = self.page.evaluate(
            """(pts) => {
              const cv = document.querySelector('.sim-canvas');
              // salin kanvas sekali ke kanvas bantu supaya hanya ada satu pembacaan piksel
              const tmp = document.createElement('canvas');
              tmp.width = cv.width;
              tmp.height = cv.height;
              const tg = tmp.getContext('2d', { willReadFrequently: true });
              tg.drawImage(cv, 0, 0);
              const img = tg.getImageData(0, 0, cv.width, cv.height).data;
              const out = [];
              for (const [c, r, x, y] of pts) {
                const k = (y * cv.width + x) * 4;
                const d = [img[k], img[k + 1], img[k + 2]];
                // teal #2dd4bf
                if (Math.abs(d[0] - 45) < 40 && Math.abs(d[1] - 212) < 40 && Math.abs(d[2] - 191) < 40) out.push([c, r]);
              }
              return out;
            }""",
            pts,
        )
        return [tuple(p) for p in found]

    def click_text(self, selector, text):
        self.page.locator(selector, has_text=text).first.click()
        self.page.wait_for_timeout(120)

    def wait_task(self, task, timeout=40):
        import time
        t0 = time.time()
        while time.time() - t0 < timeout:
            if task in self.hook()["completedTasks"]:
                return round(time.time() - t0, 1)
            self.page.wait_for_timeout(200)
        return None

    def next_step(self):
        self.page.locator(".step-nav .btn-primary").dispatch_event("click")
        self.page.wait_for_timeout(350)

    def __exit__(self, *a):
        self.browser.close()
        self.pw.stop()


def log(*a):
    print(*a, file=sys.stderr, flush=True)
