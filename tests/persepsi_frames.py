"""Rangkaian bingkai LiDAR berurutan untuk menilai apakah tampilan LiDAR tenang (tanpa garis sinar, tanpa kedip).

Pemakaian: python3 tests/persepsi_frames.py [--mobile] [--gpu] [--old]
  --old  jalankan versi lama pelajaran (isi HEAD git dibaca dengan `git show`, dilayani lewat
         page.route; file di disk tidak diubah) sebagai pembanding.
Butuh server: python3 tests/serve.py 8243

Hanya LiDAR yang dinyalakan. Diambil 6 bingkai panggung berjarak 100 ms, lalu dihitung:
  - lidarPx: jumlah piksel berwarna LiDAR (sian) di tiap bingkai;
  - flicker: rata-rata piksel sian yang muncul atau hilang di antara dua bingkai berturutan,
    dibagi jumlah piksel sian (makin kecil makin tenang).
Juga mengukur waktu antar bingkai (requestAnimationFrame) dan lama kerja tiap callback bingkai
(update simulasi, persepsi, dan gambar) selama 3 detik pada 1x lalu pada 2x.
"""
import io
import json
import subprocess
import sys

sys.path.insert(0, "/Users/mcdonny/Downloads/ndur/driverless-sim/tests")
from persepsi_util import Session, SHOTS  # noqa: E402

MOBILE = "--mobile" in sys.argv
GPU = "--gpu" in sys.argv
OLD = "--old" in sys.argv
TAG = ("m" if MOBILE else "d") + ("-gpu" if GPU else "") + ("-lama" if OLD else "")
ROOT = "/Users/mcdonny/Downloads/ndur/driverless-sim"


def head_file(path):
    return subprocess.run(["git", "show", f"HEAD:{path}"], cwd=ROOT, capture_output=True, text=True, check=True).stdout


def route_old(page):
    def serve(body):
        return lambda route: route.fulfill(status=200, body=body, headers={"content-type": "text/javascript"})
    for rel in ("js/lessons/persepsi.js", "js/lessons/persepsi/scene.js", "js/lessons/persepsi/perception.js"):
        page.route(f"**/{rel}", serve(head_file(rel)))

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    Image = None


def cyan_mask(png):
    im = Image.open(io.BytesIO(png)).convert("RGB")
    w, h = im.size
    px = im.load()
    out = set()
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            r, g, b = px[x, y]
            if b > 150 and g > 150 and r < 120 and g - r > 70:
                out.add((x, y))
    return out


class GpuSession(Session):
    def __enter__(self):
        from playwright.sync_api import sync_playwright
        from persepsi_util import CHROME
        self.pw = sync_playwright().start()
        self.browser = self.pw.chromium.launch(executable_path=CHROME, headless=True, args=["--use-angle=metal", "--enable-gpu"])
        if self.mobile:
            self.ctx = self.browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        else:
            self.ctx = self.browser.new_context(viewport={"width": 1366, "height": 900}, device_scale_factor=1)
        self.page = self.ctx.new_page()
        self.page.on("console", lambda m: self.errors.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
        self.page.on("pageerror", lambda e: self.errors.append(f"pageerror: {e}"))
        return self


with (GpuSession if GPU else Session)(mobile=MOBILE) as s:
    if OLD:
        route_old(s.page)
    # catat lama tiap callback requestAnimationFrame (kerja satu bingkai)
    s.page.add_init_script("""(() => { const raf = window.requestAnimationFrame.bind(window); window.__cb = [];
      window.requestAnimationFrame = (fn) => raf((t) => { const a = performance.now(); fn(t); window.__cb.push(performance.now() - a); if (window.__cb.length > 4000) window.__cb.splice(0, 2000); }); })();""")
    s.go("#/pelajaran/persepsi", 1500)
    s.page.wait_for_function("() => window.__simotonom && window.__simotonom.lessonStatus === 'ready'", timeout=20000)
    s.page.locator(".ctl-toggle", has_text="Kamera").first.click()
    s.page.locator(".ctl-toggle", has_text="LiDAR").first.click()
    s.page.wait_for_timeout(4000)
    s.page.evaluate("() => window.scrollTo(0, 0)")
    frames = []
    for i in range(6):
        png = s.page.locator(".stage").screenshot()
        frames.append(png)
        if i in (0, 3):
            with open(f"{SHOTS}frames-{TAG}-{i}.png", "wb") as f:
                f.write(png)
        s.page.wait_for_timeout(100)
    timing = s.page.evaluate("""() => new Promise((ok) => { const d = []; let last = performance.now(); const t0 = last;
        const f = (t) => { d.push(t - last); last = t; if (t - t0 < 3000) requestAnimationFrame(f); else { d.shift(); d.sort((a, b) => a - b);
        ok({ frames: d.length, fps: Math.round(d.length / 3), median: +d[Math.floor(d.length / 2)].toFixed(1), p95: +d[Math.floor(d.length * 0.95)].toFixed(1), max: +d[d.length - 1].toFixed(1) }); } };
        requestAnimationFrame(f); })""")
    cost_js = """(ms) => new Promise((ok) => { window.__cb.length = 0; setTimeout(() => { const d = window.__cb.slice().sort((a, b) => a - b);
        ok({ n: d.length, median: +d[Math.floor(d.length / 2)].toFixed(2), p95: +d[Math.floor(d.length * 0.95)].toFixed(2), max: +d[d.length - 1].toFixed(2) }); }, ms); })"""
    s.page.locator(".ctl-toggle", has_text="Kamera").first.click()
    s.page.locator(".ctl-toggle", has_text="Radar").first.click()
    s.page.locator(".ctl-toggle", has_text="Prediksi").first.click()
    cost1 = s.page.evaluate(cost_js, 3000)
    s.page.locator(".speed-wrap .seg-btn", has_text="2x").first.dispatch_event("click")
    cost2 = s.page.evaluate(cost_js, 3000)
    out = {"tag": TAG, "timing": timing, "frameWorkMs1x": cost1, "frameWorkMs2x": cost2, "errors": s.errors}
    if Image:
        masks = [cyan_mask(p) for p in frames]
        out["lidarPx"] = [len(m) for m in masks]
        flick = []
        for a, b in zip(masks, masks[1:]):
            flick.append(round(len(a ^ b) / max(1, len(a | b)), 3))
        out["flicker"] = flick
    print(json.dumps(out, indent=1, ensure_ascii=False))
