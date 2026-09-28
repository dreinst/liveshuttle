"""QA pelajaran Sensor lewat UI: semua tugas, jeda, ulangi, kecepatan, dan uji kebocoran navigasi.

Pemakaian: python3 tests/foundation_sensor_qa.py [--mobile]
Butuh server di port 8100.
"""
import json
import sys
import time

sys.path.insert(0, "/Users/mcdonny/Downloads/ndur/driverless-sim/tests")
from foundation_util import Session  # noqa: E402

MOBILE = "--mobile" in sys.argv
TAG = "m" if MOBILE else "d"


def wait_task(s, task, timeout=40):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if task in s.hook()["completedTasks"]:
            return round(time.time() - t0, 1)
        s.page.wait_for_timeout(250)
    return None


def toggle(s, name):
    s.page.locator(".ctl-toggle", has_text=name).first.click()


def next_step(s):
    # toast bisa menutupi tombol sebentar, jadi klik langsung lewat DOM
    s.page.locator(".step-nav .btn-primary").dispatch_event("click")
    s.page.wait_for_timeout(300)


results = {}
with Session(mobile=MOBILE) as s:
    s.go("#/")
    s.page.evaluate("() => localStorage.clear()")
    s.go("#/pelajaran/sensor", 1500)
    h = s.hook()
    results["start"] = {"step": h["stepIndex"], "status": h["lessonStatus"], "loops": h["activeLoops"]}

    # langkah 1: kamera saja
    toggle(s, "Kamera")
    results["kamera-lampu"] = wait_task(s, "kamera-lampu", 10)
    s.shot(f"qa-{TAG}-1-kamera")
    next_step(s)

    # langkah 2: LiDAR
    toggle(s, "LiDAR")
    results["lidar-on"] = wait_task(s, "lidar-on", 10)
    s.shot(f"qa-{TAG}-2-lidar")
    next_step(s)

    # langkah 3: radar
    toggle(s, "Radar")
    results["radar-kecepatan"] = wait_task(s, "radar-kecepatan", 40)
    s.shot(f"qa-{TAG}-3-radar")
    next_step(s)

    # langkah 4: kabut
    s.page.locator(".seg-btn", has_text="Kabut").click()
    results["kabut-radar"] = wait_task(s, "kabut-radar", 10)
    s.shot(f"qa-{TAG}-4-kabut")
    next_step(s)

    # langkah 5: ultrasonik, mundur dengan tombol tahan
    toggle(s, "Ultrasonik")
    btn = s.page.locator(".btn-hold", has_text="Mundur")
    btn.scroll_into_view_if_needed()
    box = btn.bounding_box()
    s.page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    s.page.mouse.down()
    results["ultrasonik-dekat"] = wait_task(s, "ultrasonik-dekat", 20)
    s.page.mouse.up()
    s.page.evaluate("() => window.scrollTo(0, 0)")
    s.page.wait_for_timeout(300)
    s.shot(f"qa-{TAG}-5-ultrasonik")
    next_step(s)
    s.shot(f"qa-{TAG}-6-semua", full=True)

    # jeda, kecepatan, ulangi
    s.page.locator('[data-act="pause"]').click()
    s.page.wait_for_timeout(200)
    results["paused"] = s.hook()["paused"]
    s.page.locator('[data-act="pause"]').click()
    s.page.locator(".speed-wrap .seg-btn", has_text="2x").click()
    results["speed2"] = s.hook()["speed"]
    s.page.locator(".speed-wrap .seg-btn", has_text="0,5x").click()
    results["speed05"] = s.hook()["speed"]
    s.page.locator('[data-act="reset"]').click()
    s.page.wait_for_timeout(300)
    results["afterReset"] = {k: s.hook()[k] for k in ("paused", "lessonStatus", "activeLoops")}

    # ringkasan
    next_step(s)
    results["summaryStep"] = s.hook()["stepIndex"]
    s.shot(f"qa-{TAG}-7-ringkasan")
    results["progress"] = s.page.evaluate("() => JSON.parse(localStorage.getItem('simotonom.progress.v1')).lessons.sensor")

    # navigasi berulang: tidak boleh ada loop atau kanvas yang tertinggal
    for i in range(8):
        s.page.evaluate("() => { location.hash = '#/' }")
        s.page.wait_for_timeout(250)
        s.page.evaluate("() => { location.hash = '#/pelajaran/sensor' }")
        s.page.wait_for_timeout(350)
    results["afterNav"] = {
        "loops": s.hook()["activeLoops"],
        "canvases": s.page.evaluate("() => document.querySelectorAll('canvas').length"),
        "styleTags": s.page.evaluate("() => document.querySelectorAll('style[data-lesson]').length"),
        "stepIndex": s.hook()["stepIndex"],
    }
    s.page.evaluate("() => { location.hash = '#/' }")
    s.page.wait_for_timeout(400)
    results["home"] = {"loops": s.hook()["activeLoops"], "styleTags": s.page.evaluate("() => document.querySelectorAll('style[data-lesson]').length")}
    results["errors"] = s.errors

print(json.dumps(results, indent=2, ensure_ascii=False))
