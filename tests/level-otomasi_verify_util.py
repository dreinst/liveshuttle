"""Alat bantu uji independen pelajaran Level Otomasi (QA tahap verifikasi).

Menyediakan peramban Playwright (desktop 1366x900 atau ponsel 390x844), pengumpul pesan konsol,
instrumen mesin (menghitung pemanggilan fungsi yang menggambar atau membuat orang berjalan kaki,
lampu lalu lintas, penyeberangan, garis henti, sinar LiDAR, dan sapuan LiDAR), penghitung
pengamat (ResizeObserver, MutationObserver, IntersectionObserver) dan interval, serta hitungan
listener lewat CDP.
"""
import os
import re
import sys
import urllib.request

from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, "tests/shots/level-otomasi-verify") + "/"
os.makedirs(SHOTS, exist_ok=True)
ROUTE = "#/pelajaran/level-otomasi"

# Fungsi mesin yang tidak boleh terpakai di pelajaran ini (tidak ada orang berjalan kaki, lampu, atau
# penyeberangan), ditambah gambar sinar dan sapuan LiDAR (gambar LiDAR harus tenang).
DRAW_FNS = ["drawPedestrian", "drawCyclist", "drawTrafficLight", "drawTrafficSignal", "drawCrosswalk", "drawStopLine",
            "drawIntersection", "drawRays", "drawLidarSweep", "drawPointCloud", "drawSoftPoints", "createLidarTrail",
            "lidarSweepAngle", "drawLidarRange", "drawSensorCone"]
ROAD_FNS = ["crosswalk", "stopLine", "intersection"]
TRAFFIC_CLASSES = ["TrafficLight", "SignalPlan"]
TRAFFIC_FNS = ["shouldStopForYellow", "speedToStop"]

QA_PRELUDE = "const __qa = (k) => { const o = (globalThis.__qaSafety ||= {}); o[k] = (o[k] || 0) + 1; };\n"

INIT_JS = r"""
(() => {
  const live = { ro: 0, mo: 0, io: 0, intervals: 0 };
  window.__qaLive = live;
  const wrapObs = (name, key) => {
    const Orig = window[name];
    if (!Orig) return;
    window[name] = class extends Orig {
      constructor(...a) { super(...a); this.__qaOn = false; }
      observe(...a) { if (!this.__qaOn) { this.__qaOn = true; live[key]++; } return super.observe(...a); }
      disconnect() { if (this.__qaOn) { this.__qaOn = false; live[key]--; } return super.disconnect(); }
    };
  };
  wrapObs('ResizeObserver', 'ro');
  wrapObs('MutationObserver', 'mo');
  wrapObs('IntersectionObserver', 'io');
  const ids = new Set();
  const si = window.setInterval.bind(window);
  const ci = window.clearInterval.bind(window);
  window.setInterval = (...a) => { const id = si(...a); ids.add(id); live.intervals = ids.size; return id; };
  window.clearInterval = (id) => { ids.delete(id); live.intervals = ids.size; return ci(id); };
})();
"""


def wrap_functions(src, names):
    for n in names:
        pat = re.compile(r"export function " + n + r"\(")
        if not pat.search(src):
            continue
        src = pat.sub(
            f"export function {n}(...__a) {{ __qa('{n}'); return __orig_{n}(...__a); }}\nfunction __orig_{n}(", src, count=1)
    return src


def wrap_classes(src, names):
    tail = ""
    for n in names:
        pat = re.compile(r"export class " + n + r"\b")
        if not pat.search(src):
            continue
        src = pat.sub(f"class __Orig_{n}", src, count=1)
        tail += f"\nexport class {n} extends __Orig_{n} {{ constructor(...a) {{ super(...a); __qa('{n}'); }} }}\n"
    return src + tail


class Browser:
    def __init__(self, port, mobile=False, instrument=True):
        self.port = port
        self.base = f"http://127.0.0.1:{port}/"
        self.mobile = mobile
        self.instrument = instrument
        self.msgs = []

    def __enter__(self):
        self.pw = sync_playwright().start()
        self.browser = self.pw.chromium.launch(executable_path=CHROME, headless=True)
        if self.mobile:
            self.ctx = self.browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2,
                                                is_mobile=True, has_touch=True)
        else:
            self.ctx = self.browser.new_context(viewport={"width": 1366, "height": 900}, device_scale_factor=1)
        self.ctx.add_init_script(INIT_JS)
        if self.instrument:
            self.ctx.route("**/js/engine/draw.js", lambda r: self._serve(r, "js/engine/draw.js", DRAW_FNS, []))
            self.ctx.route("**/js/engine/road.js", lambda r: self._serve(r, "js/engine/road.js", ROAD_FNS, []))
            self.ctx.route("**/js/engine/traffic.js", lambda r: self._serve(r, "js/engine/traffic.js", TRAFFIC_FNS, TRAFFIC_CLASSES))
        self.page = self.ctx.new_page()
        self.page.on("console", self._console)
        self.page.on("pageerror", lambda e: self.msgs.append(f"pageerror: {e}"))
        self.cdp = self.ctx.new_cdp_session(self.page)
        return self

    def _console(self, m):
        if m.type in ("error", "warning"):
            self.msgs.append(f"{m.type}: {m.text}")

    def _serve(self, route, rel, fns, classes):
        src = open(os.path.join(ROOT, rel), encoding="utf-8").read()
        src = QA_PRELUDE + wrap_classes(wrap_functions(src, fns), classes)
        route.fulfill(status=200, body=src, headers={"Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store"})

    def __exit__(self, *a):
        try:
            self.browser.close()
        finally:
            self.pw.stop()

    # ---------- navigasi dan keadaan ----------
    def goto_lesson(self, clear=False):
        if clear:
            self.page.goto(self.base + "#/")
            self.page.evaluate("() => localStorage.clear()")
        self.page.goto(self.base + ROUTE)
        self.page.wait_for_function("() => window.__simotonom && window.__simotonom.lessonStatus === 'ready' && window.__levelOtomasi")
        self.page.wait_for_timeout(300)

    def hook(self):
        return self.page.evaluate("() => JSON.parse(JSON.stringify(window.__simotonom))")

    def state(self):
        return self.page.evaluate("() => window.__levelOtomasi ? JSON.parse(JSON.stringify(window.__levelOtomasi.state)) : null")

    def qa_counts(self):
        return self.page.evaluate("() => ({ ...(globalThis.__qaSafety || {}) })")

    def reset_counts(self):
        self.page.evaluate("() => { globalThis.__qaSafety = {}; }")

    def live(self):
        return self.page.evaluate("() => ({ ...window.__qaLive })")

    def status(self):
        return self.page.locator(".sim-status").inner_text()

    def alert(self):
        el = self.page.locator(".lesson-level-otomasi .lvl-alert")
        if el.count() == 0 or el.get_attribute("hidden") is not None:
            return None
        return el.locator(".lvl-alert-title").inner_text()

    def go_step(self, i):
        self.page.locator(f".step-card [data-go='{i}']").first.dispatch_event("click")
        self.page.wait_for_timeout(250)

    def listeners(self):
        out = {}
        for key, expr in (("window", "window"), ("document", "document")):
            r = self.cdp.send("Runtime.evaluate", {"expression": expr})
            oid = r["result"]["objectId"]
            ls = self.cdp.send("DOMDebugger.getEventListeners", {"objectId": oid, "depth": 0 if key == "window" else -1, "pierce": True})
            out[key] = len(ls["listeners"])
            self.cdp.send("Runtime.releaseObject", {"objectId": oid})
        return out

    # ---------- masukan ----------
    def center(self, locator):
        locator.scroll_into_view_if_needed()
        b = locator.bounding_box()
        return b["x"] + b["width"] / 2, b["y"] + b["height"] / 2

    def press_hold(self, locator):
        """Tekan dan tahan tombol lewat pointer (mouse di desktop, sentuhan di ponsel)."""
        x, y = self.center(locator)
        if self.mobile:
            self.cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y, "id": 1}]})
        else:
            self.page.mouse.move(x, y)
            self.page.mouse.down()

    def release_hold(self):
        if self.mobile:
            self.cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        else:
            self.page.mouse.up()

    def tap(self, locator):
        if self.mobile:
            locator.scroll_into_view_if_needed()
            locator.tap()
        else:
            locator.click()

    def frame_stats(self, ms=2500):
        return self.page.evaluate(
            """(ms) => new Promise((res) => { const d = []; let last = performance.now(); const t0 = last;
              const f = (t) => { d.push(t - last); last = t; if (t - t0 < ms) requestAnimationFrame(f); else {
                d.sort((a, b) => a - b); const mean = d.reduce((a, b) => a + b, 0) / d.length;
                res({ fps: 1000 / mean, p95: d[Math.floor(d.length * 0.95)], max: d[d.length - 1], n: d.length }); } };
              requestAnimationFrame(f); })""", ms)


def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default
