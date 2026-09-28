"""QA pelajaran Persepsi lewat UI seperti pelajar: semua tugas, jeda, ulangi, kecepatan, dan uji kebocoran.

Pemakaian: python3 tests/persepsi_qa.py [--mobile]
Butuh server statis di port 8113.
"""
import sys
import time

sys.path.insert(0, "/Users/mcdonny/Downloads/ndur/driverless-sim/tests")
from persepsi_util import Session, dump  # noqa: E402

MOBILE = "--mobile" in sys.argv
TAG = "m" if MOBILE else "d"


def wait_task(s, task, timeout=40):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if task in s.hook()["completedTasks"]:
            return round(time.time() - t0, 1)
        s.page.wait_for_timeout(200)
    return None


def toggle(s, name):
    loc = s.page.locator(".ctl-toggle", has_text=name).first
    loc.scroll_into_view_if_needed()
    loc.click()


def toggle_state(s, name):
    return s.page.locator(".ctl-toggle", has_text=name).first.get_attribute("aria-checked")


def next_step(s):
    s.page.locator(".step-nav .btn-primary").dispatch_event("click")
    s.page.wait_for_timeout(300)


def top(s):
    s.page.evaluate("() => window.scrollTo(0, 0)")
    s.page.wait_for_timeout(150)


def stage_shot(s, name):
    top(s)
    s.shot(name)
    s.shot(name + "-stage", selector=".stage")


def status(s):
    return s.page.locator(".sim-status").inner_text()


results = {}
with Session(mobile=MOBILE) as s:
    s.go("#/")
    s.page.evaluate("() => localStorage.clear()")
    s.go("#/pelajaran/persepsi", 1500)
    h = s.hook()
    results["start"] = {"step": h["stepIndex"], "status": h["lessonStatus"], "loops": h["activeLoops"]}
    results["preset1"] = {n: toggle_state(s, n) for n in ("Kamera", "LiDAR", "Radar", "Fusi", "Pelacakan", "Prediksi")}

    # langkah 1: tampilkan data mentah LiDAR dan radar
    toggle(s, "LiDAR")
    toggle(s, "Radar")
    results["raw-view"] = wait_task(s, "raw-view", 15)
    s.page.wait_for_timeout(400)
    stage_shot(s, f"qa-{TAG}-1-mentah")
    results["status1"] = status(s)
    next_step(s)

    # langkah 2: fusi
    results["preset2"] = {n: toggle_state(s, n) for n in ("Kamera", "LiDAR", "Radar", "Fusi")}
    toggle(s, "Fusi")
    results["fusion-on"] = wait_task(s, "fusion-on", 15)
    s.page.wait_for_timeout(300)
    stage_shot(s, f"qa-{TAG}-2-fusi")
    results["status2"] = status(s)
    next_step(s)

    # langkah 3: pantulan palsu
    btn = s.page.locator("button", has_text="Munculkan pantulan palsu")
    btn.scroll_into_view_if_needed()
    btn.click()
    results["ghost-rejected"] = wait_task(s, "ghost-rejected", 10)
    s.page.wait_for_timeout(150)
    stage_shot(s, f"qa-{TAG}-3-hantu")
    results["status3"] = status(s)
    results["ghostCount"] = s.page.locator(".readout", has_text="Pantulan ditolak").locator(".readout-value").inner_text()
    next_step(s)

    # langkah 4: ambang keyakinan 90%
    slider = s.page.locator(".ctl-slider", has_text="Ambang keyakinan").locator("input")
    slider.scroll_into_view_if_needed()
    slider.fill("92")
    results["threshold"] = wait_task(s, "threshold", 20)
    s.page.wait_for_timeout(200)
    stage_shot(s, f"qa-{TAG}-4-ambang")
    s.shot(f"qa-{TAG}-4-ambang-list", selector=".grp-list")
    results["status4"] = status(s)
    # ambang rendah: positif palsu dari poster halte
    slider.fill("20")
    s.page.wait_for_timeout(200)
    fp_seen = False
    t0 = time.time()
    while time.time() - t0 < 30:
        if s.page.locator(".grp-list .tag", has_text="palsu").count() > 0 and "tag-danger" in (s.page.locator(".grp-list .tag", has_text="palsu").first.get_attribute("class") or ""):
            fp_seen = True
            break
        s.page.wait_for_timeout(250)
    results["falsePositiveSeenAt20"] = fp_seen
    stage_shot(s, f"qa-{TAG}-4b-positif-palsu")
    next_step(s)

    # langkah 5: prediksi
    results["preset5"] = {n: toggle_state(s, n) for n in ("Kamera", "LiDAR", "Radar", "Fusi", "Pelacakan", "Prediksi")}
    results["thresholdAfterPreset"] = s.page.locator(".ctl-slider", has_text="Ambang keyakinan").locator("output").inner_text()
    s.page.wait_for_timeout(1500)
    stage_shot(s, f"qa-{TAG}-5a-pelacakan")
    toggle(s, "Prediksi")
    results["predict"] = wait_task(s, "predict", 45)
    stage_shot(s, f"qa-{TAG}-5-prediksi")
    results["banner"] = s.page.locator(".warn-banner").inner_text() if s.page.locator(".warn-banner").is_visible() else None
    results["status5"] = status(s)

    # jeda, kecepatan, ulangi
    s.page.locator('[data-act="pause"]').click()
    s.page.wait_for_timeout(200)
    results["paused"] = s.hook()["paused"]
    s.page.locator('[data-act="pause"]').click()
    s.page.locator(".speed-wrap .seg-btn", has_text="2x").click()
    results["speed2"] = s.hook()["speed"]
    s.page.locator(".speed-wrap .seg-btn", has_text="1x").click()
    s.page.locator('[data-act="reset"]').click()
    s.page.wait_for_timeout(500)
    results["afterReset"] = {k: s.hook()[k] for k in ("paused", "lessonStatus", "activeLoops")}

    # ringkasan
    next_step(s)
    results["summaryStep"] = s.hook()["stepIndex"]
    top(s)
    s.shot(f"qa-{TAG}-6-ringkasan")
    results["progress"] = s.page.evaluate("() => JSON.parse(localStorage.getItem('simotonom.progress.v1')).lessons.persepsi")

    # navigasi berulang: tidak boleh ada loop, kanvas, atau gaya yang tertinggal
    for i in range(8):
        s.page.evaluate("() => { location.hash = '#/' }")
        s.page.wait_for_timeout(250)
        s.page.evaluate("() => { location.hash = '#/pelajaran/persepsi' }")
        s.page.wait_for_timeout(400)
    results["afterNav"] = {
        "loops": s.hook()["activeLoops"],
        "canvases": s.page.evaluate("() => document.querySelectorAll('canvas').length"),
        "styleTags": s.page.evaluate("() => document.querySelectorAll('style[data-lesson]').length"),
        "banners": s.page.evaluate("() => document.querySelectorAll('.warn-banner').length"),
    }
    s.page.evaluate("() => { location.hash = '#/' }")
    s.page.wait_for_timeout(400)
    results["home"] = {"loops": s.hook()["activeLoops"], "styleTags": s.page.evaluate("() => document.querySelectorAll('style[data-lesson]').length")}
    results["errors"] = s.errors

dump(results)
