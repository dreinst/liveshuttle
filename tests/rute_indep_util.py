"""Alat bantu QA independen untuk pelajaran Perencanaan Rute (port 8135)."""
import sys
import time

from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
BASE = "http://127.0.0.1:8135/"
SHOTS = "/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/rute-qa/"

COLS, ROWS, CELL = 24, 16, 25
MAP_W, MAP_H = COLS * CELL, ROWS * CELL

# Rute A* bawaan dihitung di peramban dengan modul pelajaran yang sama.
ROUTE_JS = """
async ([sc, sr, gc, gr, closed, jams]) => {
  const { createCity } = await import('/js/lessons/rute/city.js');
  const { createSearch } = await import('/js/engine/planning.js');
  const city = createCity();
  for (const [c, r] of closed) city.setClosed(city.cellOf(c, r), true);
  for (const [c, r] of jams) city.setJam(city.cellOf(c, r), true);
  const m = city.minCost();
  const s = createSearch(city.grid, city.cellOf(sc, sr), city.cellOf(gc, gr), {
    algorithm: 'astar', heuristic: (a, b) => city.grid.heuristic(a, b) * m * (1 + 1e-4) }).run();
  return { found: s.found, cells: s.path.map((i) => [i % 24, Math.floor(i / 24)]), expanded: s.expanded };
}
"""


class Session:
    def __init__(self, mobile=False, reduced=False):
        self.mobile = mobile
        self.reduced = reduced
        self.errors = []

    def __enter__(self):
        self.pw = sync_playwright().start()
        self.browser = self.pw.chromium.launch(executable_path=CHROME, headless=True)
        opts = {}
        if self.reduced:
            opts["reduced_motion"] = "reduce"
        if self.mobile:
            self.ctx = self.browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2,
                                                is_mobile=True, has_touch=True, **opts)
        else:
            self.ctx = self.browser.new_context(viewport={"width": 1366, "height": 900}, device_scale_factor=1, **opts)
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

    def route(self, start=(1, 14), goal=(22, 1), closed=(), jams=()):
        return self.page.evaluate(ROUTE_JS, [start[0], start[1], goal[0], goal[1], list(closed), list(jams)])

    # ---------- peta ----------
    def map_transform(self):
        """Letak peta di kanvas (rumus sama dengan boundsFor() di rute.js)."""
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

    def stage_into_view(self):
        self.page.evaluate("() => document.querySelector('.sim-canvas').scrollIntoView({ block: 'center' })")
        self.page.wait_for_timeout(250)

    def tap_cell(self, c, r):
        self.stage_into_view()
        x, y = self.cell_xy(c, r)
        if self.mobile:
            self.page.touchscreen.tap(x, y)
        else:
            self.page.mouse.click(x, y)
        self.page.wait_for_timeout(150)

    def drag_cells(self, cells, steps=8):
        self.stage_into_view()
        x, y = self.cell_xy(*cells[0])
        self.page.mouse.move(x, y)
        self.page.mouse.down()
        for c, r in cells[1:]:
            nx, ny = self.cell_xy(c, r)
            self.page.mouse.move(nx, ny, steps=steps)
        self.page.mouse.up()
        self.page.wait_for_timeout(150)

    def button(self, text):
        return self.page.locator(".lesson-rute .controls button", has_text=text).first

    def seg(self, text):
        return self.page.locator(".lesson-rute .controls .seg-btn", has_text=text).first

    def wait_task(self, task, timeout=40):
        t0 = time.time()
        while time.time() - t0 < timeout:
            if task in self.hook()["completedTasks"]:
                return round(time.time() - t0, 1)
            self.page.wait_for_timeout(150)
        return None

    def goto_step(self, i):
        self.page.locator(f'.step-dot[data-go="{i}"]').dispatch_event("click")
        self.page.wait_for_timeout(400)

    def next_step(self):
        self.page.locator(".step-nav .btn-primary").dispatch_event("click")
        self.page.wait_for_timeout(400)

    def __exit__(self, *a):
        self.browser.close()
        self.pw.stop()


def log(*a):
    print(*a, file=sys.stderr, flush=True)
