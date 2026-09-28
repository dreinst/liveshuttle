"""QA independen pelajaran Lokalisasi lewat UI: kelima tugas, uji negatif, tombol shell, kebocoran.

Tugas diselesaikan dengan klik (desktop) atau ketuk (ponsel) sungguhan. Sebelum tiap tugas dicoba
juga kombinasi yang TIDAK boleh menyelesaikan tugas. Lalu Jeda, 2x, 0,5x, Ulangi, ringkasan, dan
lima kali keluar masuk pelajaran (loop, kanvas, gaya, listener window, heap JS).
Pemakaian: python3 tests/lokalisasi_verify_tasks.py [--mobile]
"""
import json
import sys
import time

from lokalisasi_verify_util import (sync_playwright, launch, new_page, open_lesson, hook, lok, console, go_next, go_step,
                                    press, toggle, is_on, readout, wait_task, stage_shot, page_shot, chips, status,
                                    text_problems)

MOBILE = "--mobile" in sys.argv
R = {"viewport": "390x844" if MOBILE else "1366x900", "neg": {}}


def done(page, t):
    return t in hook(page)["completedTasks"]


def listeners(page, cdp):
    win = cdp.send("Runtime.evaluate", {"expression": "window"})["result"]["objectId"]
    doc = cdp.send("Runtime.evaluate", {"expression": "document"})["result"]["objectId"]
    a = cdp.send("DOMDebugger.getEventListeners", {"objectId": win})["listeners"]
    b = cdp.send("DOMDebugger.getEventListeners", {"objectId": doc})["listeners"]
    return len(a) + len(b)


def heap(page, cdp):
    cdp.send("HeapProfiler.collectGarbage")
    return round(page.evaluate("() => performance.memory ? performance.memory.usedJSHeapSize / 1e6 : -1"), 1)


with sync_playwright() as pw:
    br = launch(pw)
    page = new_page(br, MOBILE)
    cdp = page.context.new_cdp_session(page)
    R["ready"] = open_lesson(page)
    page.wait_for_timeout(800)

    # ---------- langkah 1: GPS saja ----------
    toggle(page, "GPS")
    toggle(page, "Odometri dan IMU")
    page.wait_for_timeout(9000)
    R["neg"]["gps+odo 9s"] = done(page, "gps-only")
    R["status1neg"] = status(page)
    toggle(page, "Odometri dan IMU")
    R["gps-only"] = wait_task(page, "gps-only", 40)
    R["status1"] = status(page)
    stage_shot(page, "t1-gps")

    # ---------- langkah 2: zona gedung tinggi ----------
    go_next(page)
    R["s2GpsOffOnEntry"] = not is_on(page, "GPS")
    page.wait_for_timeout(4000)
    R["neg"]["s2 idle 4s"] = done(page, "urban-canyon")
    toggle(page, "GPS")
    seen = {}

    def poll2():
        st = status(page)
        if "memantul" in st and "jump" not in seen:
            seen["jump"] = st
            stage_shot(page, "t2-lompatan")

    R["urban-canyon"] = wait_task(page, "urban-canyon", 60, poll2)
    R["s2seen"] = seen
    R["s2chips"] = chips(page)
    stage_shot(page, "t2-kanyon")

    # ---------- langkah 3: odometri ----------
    go_next(page)
    toggle(page, "Odometri dan IMU")
    toggle(page, "GPS")
    press(page, page.locator(".speed-wrap .seg-btn", has_text="2x"))
    page.wait_for_timeout(16000)
    R["neg"]["odo+gps 32s sim"] = done(page, "odometry-drift")
    R["odoErrWithGps"] = lok(page)["state"]["errors"]["odo"]
    press(page, page.locator(".speed-wrap .seg-btn", has_text="1x"))
    toggle(page, "GPS")
    R["odometry-drift"] = wait_task(page, "odometry-drift", 60)
    R["status3"] = status(page)
    stage_shot(page, "t3-odometri")

    # ---------- langkah 4: fusi ----------
    go_next(page)
    page.wait_for_timeout(5000)
    R["neg"]["s3 preset 5s"] = done(page, "fusion")
    toggle(page, "Fusi (filter Kalman)")
    page.wait_for_timeout(1500)
    toggle(page, "Fusi (filter Kalman)")  # mati lagi sebelum 4 detik
    page.wait_for_timeout(3500)
    R["neg"]["fus 1,5s then off"] = done(page, "fusion")
    toggle(page, "Fusi (filter Kalman)")
    R["fusion"] = wait_task(page, "fusion", 25)
    page.wait_for_timeout(2000)
    R["status4"] = status(page)
    R["bobot"] = readout(page, "Bobot GPS")
    stage_shot(page, "t4-fusi")

    # ---------- langkah 5: pencocokan peta ----------
    go_next(page)
    page.wait_for_timeout(5000)
    R["neg"]["s4 preset 5s"] = done(page, "landmark")
    toggle(page, "Pencocokan peta (LiDAR)")
    t0 = time.time()
    frames = []
    for k in range(6):
        page.wait_for_timeout(250)
        stage_shot(page, f"t5-lidar-{k}")
    R["landmark"] = wait_task(page, "landmark", 60)
    R["status5"] = status(page)
    stage_shot(page, "t5-peta")
    toggle(page, "Kemudikan dengan estimasi")
    page.wait_for_timeout(10000)
    R["steerMap"] = {"keluar": readout(page, "Keluar lajur"), "ambil": readout(page, "Diambil alih"),
                     "jarak": readout(page, "Jarak ke tengah lajur"), "chips": chips(page)}
    stage_shot(page, "t5-kemudi-peta")
    page_shot(page, "t5-halaman", full=True)

    # ---------- Jeda, kecepatan, Ulangi ----------
    press(page, page.locator('[data-act="pause"]'))
    page.wait_for_timeout(300)
    a = lok(page)["state"]["simT"]
    page.wait_for_timeout(1500)
    R["pause"] = {"hook": hook(page)["paused"], "frozen": lok(page)["state"]["simT"] == a,
                  "label": page.locator('[data-act="pause"]').inner_text()}
    press(page, page.locator('[data-act="pause"]'))
    for sp, label in ((2, "2x"), (0.5, "0,5x")):
        press(page, page.locator(".speed-wrap .seg-btn", has_text=label))
        a = lok(page)["state"]["simT"]
        w = time.time()
        page.wait_for_timeout(3000)
        R[f"speed{label}"] = {"hook": hook(page)["speed"], "simPerWall": round((lok(page)["state"]["simT"] - a) / (time.time() - w), 2)}
    press(page, page.locator(".speed-wrap .seg-btn", has_text="1x"))
    press(page, page.locator('[data-act="reset"]'))
    page.wait_for_timeout(500)
    st = lok(page)["state"]
    R["afterReset"] = {"simT": st["simT"], "s": st["s"], "loops": hook(page)["activeLoops"], "keluar": readout(page, "Keluar lajur"),
                       "mapOn": is_on(page, "Pencocokan peta (LiDAR)"), "steerOn": is_on(page, "Kemudikan dengan estimasi"), "errors": st["errors"]}
    page.wait_for_timeout(1500)
    stage_shot(page, "t6-ulangi")

    # ---------- ringkasan ----------
    go_next(page)
    page.wait_for_timeout(500)
    h = hook(page)
    R["summary"] = {"stepIndex": h["stepIndex"], "completed": sorted(h["completedTasks"]),
                    "text": page.locator(".summary-tasks-title").inner_text()}
    page_shot(page, "t7-ringkasan", full=True)
    R["textProblems"] = text_problems(page)
    R["safety"] = lok(page)["safety"]

    # ---------- keluar masuk 5 kali ----------
    page.evaluate("() => { location.hash = '#/' }")
    page.wait_for_timeout(800)
    base = {"listeners": listeners(page, cdp), "heap": heap(page, cdp)}
    runs = []
    for i in range(5):
        page.evaluate("() => { location.hash = '#/pelajaran/lokalisasi' }")
        for _ in range(60):
            if hook(page)["lessonStatus"] == "ready" and lok(page):
                break
            page.wait_for_timeout(100)
        go_step(page, 4)
        toggle(page, "Pencocokan peta (LiDAR)")
        page.wait_for_timeout(1500)
        inside = {"loops": hook(page)["activeLoops"], "canvases": page.evaluate("() => document.querySelectorAll('canvas').length"),
                  "styles": page.evaluate("() => document.querySelectorAll('style').length")}
        page.evaluate("() => { location.hash = '#/' }")
        page.wait_for_timeout(700)
        runs.append({**inside, "homeLoops": hook(page)["activeLoops"], "hookGone": page.evaluate("() => !window.__lokalisasi"),
                     "listeners": listeners(page, cdp), "heap": heap(page, cdp)})
    R["leak"] = {"base": base, "runs": runs}
    R["console"] = console(page)
    br.close()

print(json.dumps(R, indent=1, ensure_ascii=False))
