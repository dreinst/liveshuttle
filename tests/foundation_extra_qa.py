"""QA tambahan foundation: ketuk objek di kanvas, sakelar saat dijeda, reduced motion, dan rute simulator.

Pemakaian: python3 tests/foundation_extra_qa.py   (server di port 8100)
"""
import json
import sys

sys.path.insert(0, "/Users/mcdonny/Downloads/ndur/driverless-sim/tests")
from foundation_util import Session, CHROME, BASE  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

out = {}
with Session() as s:
    s.go("#/")
    s.page.evaluate("() => localStorage.clear()")
    s.page.reload()
    s.go("#/pelajaran/sensor", 1500)
    # ketuk tembok: hitung posisi layar dari batas tampilan lebar pelajaran sensor
    r = s.page.evaluate("() => { const c = document.querySelector('.sim-canvas').getBoundingClientRect(); return {x: c.left, y: c.top, w: c.width, h: c.height}; }")
    scale = min((r["w"] - 24) / 76.5, (r["h"] - 24) / 28)
    cx, cy = 21.75, -1

    def to_screen(x, y):
        return r["x"] + r["w"] / 2 + (x - cx) * scale, r["y"] + r["h"] / 2 + (y - cy) * scale

    sx, sy = to_screen(-14.6, 2)
    s.page.mouse.click(sx, sy)
    s.page.wait_for_timeout(400)
    out["tapWall"] = s.page.locator(".insp-name").text_content()
    sx, sy = to_screen(0, -10)  # area kosong (gedung) membatalkan pilihan
    s.page.mouse.click(sx, sy)
    s.page.wait_for_timeout(400)
    out["tapEmpty"] = s.page.locator(".insp-name").count()

    # jeda lalu nyalakan LiDAR: pembacaan tetap muncul walau dijeda
    s.page.locator('[data-act="pause"]').click()
    s.page.wait_for_timeout(200)
    s.page.locator(".ctl-toggle", has_text="LiDAR").click()
    s.page.wait_for_timeout(500)
    out["pausedStatus"] = s.page.locator(".sim-status").text_content()
    out["pausedBadge"] = s.page.locator(".stage-badge").is_visible()
    t0 = s.page.evaluate("() => document.querySelector('.sim-status').textContent")
    s.page.wait_for_timeout(600)
    out["pausedStable"] = t0 == s.page.evaluate("() => document.querySelector('.sim-status').textContent")
    s.page.locator('[data-act="pause"]').click()
    out["errors"] = list(s.errors)

# reduced motion di beranda: animasi dekoratif tidak berjalan
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, headless=True)
    ctx = b.new_context(viewport={"width": 1366, "height": 900}, reduced_motion="reduce")
    page = ctx.new_page()
    errs = []
    page.on("console", lambda m: errs.append(m.text) if m.type in ("error", "warning") else None)
    page.goto(BASE + "#/")
    page.wait_for_timeout(1500)
    out["reducedMotionLoops"] = page.evaluate("() => window.__simotonom.activeLoops")
    page.goto(BASE + "#/pelajaran/sensor")
    page.wait_for_timeout(1200)
    out["reducedMotionLessonLoops"] = page.evaluate("() => window.__simotonom.activeLoops")
    out["reducedMotionErrors"] = errs
    b.close()

# simulator: #/simulator dialihkan, lalu kembali ke beranda tanpa kanvas tertinggal
with Session(webgl=True) as s:
    s.go("#/simulator", 4000)
    out["simRedirect"] = s.hook()["route"]
    out["simStatus"] = s.hook()["simStatus"]
    s.page.evaluate("() => { location.hash = '#/pelajaran/sensor' }")
    s.page.wait_for_timeout(1500)
    out["afterSimCanvases"] = s.page.evaluate("() => document.querySelectorAll('canvas').length")
    out["afterSimSim3dLinks"] = s.page.evaluate("() => document.querySelectorAll('link[href*=\"sim3d\"]').length")
    s.page.evaluate("() => { location.hash = '#/' }")
    s.page.wait_for_timeout(800)
    out["homeLoops"] = s.hook()["activeLoops"]
    out["simErrors"] = [e for e in s.errors if "ReadPixels" not in e]

print(json.dumps(out, indent=2, ensure_ascii=False))
