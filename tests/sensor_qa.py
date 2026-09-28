"""QA pelajaran Sensor lewat UI: semua tugas, jeda, kecepatan, ulangi, target sentuh, kebocoran navigasi,
penghitung keselamatan, dan waktu bingkai.

Pemakaian: python3 tests/sensor_qa.py [--mobile] [--gpu]
Butuh server di port 8242 (python3 tests/serve.py 8242).
--gpu mencoba jalur GPU (ANGLE Metal) untuk pengukuran waktu bingkai; bawaan memakai Chrome headless biasa.
"""
import json
import sys
import time

from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
BASE = "http://127.0.0.1:8242/"
SHOTS = "/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/sensor/"
MOBILE = "--mobile" in sys.argv
GPU = "--gpu" in sys.argv
TAG = "m" if MOBILE else "d"


def hook(page):
    return page.evaluate("() => JSON.parse(JSON.stringify(window.__simotonom))")


def wait_task(page, task, timeout=40):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if task in hook(page)["completedTasks"]:
            return round(time.time() - t0, 1)
        page.wait_for_timeout(250)
    return None


def toggle(page, name, want=None):
    t = page.locator(".ctl-toggle", has_text=name).first
    if want is None or (t.get_attribute("aria-checked") == "true") != want:
        t.click()


def next_step(page):
    page.locator(".step-nav .btn-primary").click()
    page.wait_for_timeout(300)


def canvas_shot(page, name):
    page.locator(".sim-canvas").first.screenshot(path=f"{SHOTS}qa-{TAG}-{name}.png")


def safety(page):
    return page.evaluate("() => { const s = window.__lessonSafety.snapshot(); delete s.events; return s; }")


def frame_stats(page, ms=3000):
    return page.evaluate("""(ms) => new Promise((done) => {
      const t = []; const t0 = performance.now();
      const f = (now) => { t.push(now); if (now - t0 < ms) requestAnimationFrame(f); else {
        const d = t.slice(1).map((x, i) => x - t[i]); d.sort((a, b) => a - b);
        done({ frames: d.length, avg: +(d.reduce((a, b) => a + b, 0) / d.length).toFixed(2), p95: +d[Math.floor(d.length * 0.95)].toFixed(2), max: +d[d.length - 1].toFixed(2) });
      } };
      requestAnimationFrame(f);
    })""", ms)


results = {"mode": ("mobile" if MOBILE else "desktop") + (" gpu" if GPU else " headless")}
args = ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] if GPU else []
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=CHROME, headless=True, args=args)
    if MOBILE:
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    else:
        ctx = browser.new_context(viewport={"width": 1366, "height": 900})
    page = ctx.new_page()
    errors = []
    page.on("console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

    page.goto(BASE + "#/")
    page.evaluate("() => localStorage.clear()")
    page.wait_for_timeout(800)
    results["homeBaselineLoops"] = hook(page)["activeLoops"]  # animasi latar beranda punya loop sendiri
    page.goto(BASE + "#/pelajaran/sensor")
    page.reload()
    page.wait_for_function("window.__lessonSafety && window.__simotonom.lessonStatus === 'ready'", timeout=20000)
    page.wait_for_timeout(800)
    h = hook(page)
    results["start"] = {"step": h["stepIndex"], "status": h["lessonStatus"], "loops": h["activeLoops"]}
    results["simStatus"] = page.locator(".sim-status, [role=status]").first.inner_text()

    # target sentuh: tombol nama objek di tabel minimal 40 px
    sizes = page.evaluate("() => [...document.querySelectorAll('.lesson-sensor .pick')].map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })")
    results["pickButtons"] = {"count": len(sizes), "minHeight": min(s[1] for s in sizes), "minWidth": min(s[0] for s in sizes)}
    small = page.evaluate("""() => [...document.querySelectorAll('.lesson-sensor .controls button, .lesson-sensor .controls [role=switch], .lesson-sensor .controls .seg-btn')]
      .filter((b) => b.offsetParent).map((b) => { const r = b.getBoundingClientRect(); return { t: (b.textContent || '').trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) }; })
      .filter((r) => r.h < 40 || r.w < 40)""")
    results["smallTargets"] = small

    # langkah 1: kamera saja
    toggle(page, "Kamera", True)
    results["kamera-lampu"] = wait_task(page, "kamera-lampu", 12)
    canvas_shot(page, "1-kamera")
    next_step(page)

    # langkah 2: LiDAR (jejak titik yang memudar, tanpa garis sinar)
    toggle(page, "LiDAR", True)
    results["lidar-on"] = wait_task(page, "lidar-on", 12)
    page.wait_for_timeout(1500)
    results["lidarPoints"] = page.evaluate("() => window.__lessonSafety.rig.reading('lidar')?.points.length ?? 0")
    results["lidarTrail"] = page.evaluate("() => window.__lessonSafety.trail.count")
    canvas_shot(page, "2-lidar")
    next_step(page)

    # langkah 3: radar, tunggu kendaraan bergerak
    toggle(page, "Radar", True)
    results["radar-kecepatan"] = wait_task(page, "radar-kecepatan", 70)
    canvas_shot(page, "3-radar")
    next_step(page)

    # langkah 4: kabut
    page.locator(".seg-btn", has_text="Kabut").first.click()
    results["kabut-radar"] = wait_task(page, "kabut-radar", 12)
    canvas_shot(page, "4-kabut")
    next_step(page)

    # langkah 5: ultrasonik, mundur dengan tombol tahan sampai dekat angkot ngetem
    toggle(page, "Ultrasonik", True)
    btn = page.locator(".btn-hold", has_text="Mundur")
    btn.scroll_into_view_if_needed()
    box = btn.bounding_box()
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.mouse.down()
    results["ultrasonik-dekat"] = wait_task(page, "ultrasonik-dekat", 25)
    page.wait_for_timeout(3000)  # terus tahan: mobil harus berhenti sendiri sebelum angkot
    page.mouse.up()
    rear = page.evaluate("() => window.__lessonSafety.scene.rearGap()")
    results["rearGapAfterHold"] = round(rear, 3)
    results["statusWhileBlocked"] = page.locator(".lesson-sensor [role=status]").first.inner_text()
    page.evaluate("() => window.scrollTo(0, 0)")
    page.wait_for_timeout(300)
    canvas_shot(page, "5-ultrasonik")
    next_step(page)

    # langkah 6: semua sensor menyala
    results["step6Sensors"] = page.evaluate("() => ['kamera','lidar','radar','ultrasonik'].map((t) => window.__lessonSafety.rig.isEnabled(t))")
    page.wait_for_timeout(1500)
    results["frames_allSensors"] = frame_stats(page)
    canvas_shot(page, "6-semua")
    page.screenshot(path=f"{SHOTS}qa-{TAG}-6-halaman.png", full_page=True)

    # keyboard (desktop): tahan panah atas, mobil maju lalu berhenti sendiri sebelum garis henti
    if not MOBILE:
        page.locator(".sim-canvas").first.click(position={"x": 5, "y": 5})
        page.keyboard.down("ArrowUp")
        page.wait_for_timeout(1200)
        results["speedWithKey"] = round(page.evaluate("() => window.__lessonSafety.scene.ego.speed"), 2)
        page.keyboard.up("ArrowUp")

    # jeda, kecepatan, ulangi
    page.locator('[data-act="pause"]').click()
    page.wait_for_timeout(200)
    results["paused"] = hook(page)["paused"]
    page.locator(".seg-btn", has_text="Hujan").first.click()  # ganti cuaca saat dijeda: pindai ulang
    page.wait_for_timeout(300)
    results["pausedRescanTrail"] = page.evaluate("() => window.__lessonSafety.trail.count")
    page.locator('[data-act="pause"]').click()
    page.locator(".speed-wrap .seg-btn", has_text="2x").click()
    results["speed2"] = hook(page)["speed"]
    page.locator(".speed-wrap .seg-btn", has_text="0,5x").click()
    results["speed05"] = hook(page)["speed"]
    page.locator(".speed-wrap .seg-btn", has_text="1x").click()
    page.locator('[data-act="reset"]').click()
    page.wait_for_timeout(400)
    results["afterReset"] = {k: hook(page)[k] for k in ("paused", "lessonStatus", "activeLoops")}
    results["egoAfterReset"] = page.evaluate("() => { const h = window.__lessonSafety; const f = h.scene.frame.toFrame(h.scene.ego.x, h.scene.ego.y); return [+f.s.toFixed(2), +f.d.toFixed(2)]; }")

    # ringkasan
    next_step(page)
    results["summaryStep"] = hook(page)["stepIndex"]
    page.screenshot(path=f"{SHOTS}qa-{TAG}-7-ringkasan.png")
    results["progress"] = page.evaluate("() => JSON.parse(localStorage.getItem('liveshuttle.progress.v1')).lessons.sensor")
    results["safety"] = safety(page)

    # navigasi berulang: tidak boleh ada loop, kanvas, atau kait uji yang tertinggal
    for _ in range(8):
        page.evaluate("() => { location.hash = '#/' }")
        page.wait_for_timeout(250)
        page.evaluate("() => { location.hash = '#/pelajaran/sensor' }")
        page.wait_for_timeout(450)
    page.wait_for_function("window.__lessonSafety && window.__simotonom.lessonStatus === 'ready'", timeout=20000)
    results["afterNav"] = {
        "loops": hook(page)["activeLoops"],
        "canvases": page.evaluate("() => document.querySelectorAll('canvas').length"),
        "styleTags": page.evaluate("() => document.querySelectorAll('style[data-lesson]').length"),
        "stepIndex": hook(page)["stepIndex"],
    }
    page.evaluate("() => { location.hash = '#/' }")
    page.wait_for_timeout(500)
    results["home"] = {
        "loops": hook(page)["activeLoops"],
        "styleTags": page.evaluate("() => document.querySelectorAll('style[data-lesson]').length"),
        "hookRemoved": page.evaluate("() => !('__lessonSafety' in window)"),
    }
    results["errors"] = errors
    browser.close()

tasks = ["kamera-lampu", "lidar-on", "radar-kecepatan", "kabut-radar", "ultrasonik-dekat"]
s = results["safety"]
results["pass"] = (
    all(results[t] is not None for t in tasks)
    and not results["errors"]
    and s["redRuns"] == 0 and s["pedContacts"] == 0
    and results["pickButtons"]["minHeight"] >= 40
    and results["afterNav"]["loops"] == 1 and results["home"]["loops"] == results["homeBaselineLoops"] and results["home"]["hookRemoved"]
    and results["afterNav"]["canvases"] == 1 and results["home"]["styleTags"] == 0
)
print(json.dumps(results, indent=2, ensure_ascii=False))
sys.exit(0 if results["pass"] else 1)
