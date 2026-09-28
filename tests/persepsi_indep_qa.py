"""QA mandiri pelajaran Persepsi lewat UI seperti pelajar.

Pemakaian: python3 tests/persepsi_indep_qa.py [--mobile] [--skip-idle]
Butuh server statis di port 8133.

Bagian:
  1. idle: tiap langkah dibuka lalu dibiarkan tanpa interaksi, tidak boleh ada tugas selesai.
  2. walk: kelima tugas lewat klik, ketuk, dan seret slider sungguhan.
  3. shell: Jeda (kanvas diam), kecepatan 0,5x/1x/2x (laju jarak objek), Ulangi.
  4. nav: bolak-balik semua langkah dan ringkasan.
  5. leak: keluar masuk pelajaran 5 kali, hitung loop, kanvas, gaya, dan listener window/document.
"""
import hashlib
import re
import sys
import time

sys.path.insert(0, "/Users/mcdonny/Downloads/ndur/driverless-sim/tests")
from persepsi_indep_util import Session, dump, ROUTE  # noqa: E402

MOBILE = "--mobile" in sys.argv
TAG = "m" if MOBILE else "d"
R = {}


def canvas_hash(s):
    return hashlib.md5(s.page.locator(".sim-canvas").first.screenshot()).hexdigest()


def track_rates(s, dt=1.0):
    """Laju berkurangnya jarak jejak mobil diam (m per detik nyata), dari tabel daftar objek."""
    def snap():
        out = {}
        for r in s.rows():
            c = r["cells"]
            if len(c) < 5 or not c[0].startswith("#"):
                continue
            if not c[1].startswith("mobil"):
                continue
            m = re.match(r"([\d.,]+) m", c[2])
            if not m:
                continue
            out[c[0]] = (float(m.group(1).replace(".", "").replace(",", ".")), c[3])
        return out

    a = snap()
    t0 = time.time()
    s.page.wait_for_timeout(int(dt * 1000))
    b = snap()
    el = time.time() - t0
    rates = []
    for k, (d0, sp) in a.items():
        slow = re.match(r"(\d+) km/jam", sp)
        if k in b and slow and int(slow.group(1)) <= 2 and d0 > 8 and b[k][0] > 8:
            rates.append(round((d0 - b[k][0]) / el, 2))
    return sorted(rates)


with Session(mobile=MOBILE) as s:
    s.phase = "fresh"
    s.fresh()
    h = s.hook()
    R["load"] = {k: h[k] for k in ("lessonStatus", "stepIndex", "stepCount", "activeLoops", "completedTasks")}

    # ---------- 1. idle ----------
    s.phase = "idle"
    if "--skip-idle" not in sys.argv:
        idle = {}
        for i in range(5):
            s.page.locator(f'.step-dot[data-go="{i}"]').first.dispatch_event("click")
            s.page.wait_for_timeout(9000 if i == 4 else 6500)
            idle[i] = s.done()
        R["idle"] = idle
        s.fresh()

    # ---------- 2. walk ----------
    s.phase = "walk"
    walk = {}
    walk["preset0"] = {n: s.toggle_state(n) for n in ("Kamera", "LiDAR", "Radar", "Fusi", "Pelacakan", "Prediksi")}
    s.toggle("LiDAR")
    s.page.wait_for_timeout(300)
    walk["after-lidar-only"] = s.done()
    s.toggle("Radar")
    walk["raw-view"] = s.wait_task("raw-view", 20)
    s.top()
    s.shot(f"w{TAG}-1")
    walk["status1"] = s.status()
    s.nav("next")

    walk["preset1"] = {n: s.toggle_state(n) for n in ("Kamera", "LiDAR", "Radar", "Fusi")}
    s.page.wait_for_timeout(2500)
    walk["fusion-before-toggle"] = "fusion-on" in s.done()
    s.toggle("Fusi")
    walk["fusion-on"] = s.wait_task("fusion-on", 20)
    s.page.wait_for_timeout(300)
    s.top()
    s.shot(f"w{TAG}-2")
    walk["status2"] = s.status()
    s.nav("next")

    walk["preset2"] = {n: s.toggle_state(n) for n in ("Kamera", "LiDAR", "Radar", "Fusi")}
    ghost = s.page.locator(".ghost-btn").first
    s.press(ghost)
    walk["ghost-rejected"] = s.wait_task("ghost-rejected", 12)
    s.page.wait_for_timeout(100)
    s.top()
    s.shot(f"w{TAG}-3")
    walk["status3"] = s.status()
    walk["ghostReadout"] = s.page.locator(".readout", has_text="Pantulan ditolak").locator(".readout-value").inner_text()
    s.nav("next")

    walk["preset3-threshold"] = s.page.locator(".ctl-slider", has_text="Ambang keyakinan").locator("output").inner_text()
    thr = s.page.locator(".ctl-slider").filter(has=s.page.locator("label", has_text="Ambang")).locator("input").first
    v = s.drag_slider("Ambang keyakinan", 87)
    if not MOBILE:
        # tepat 89 lewat tombol panah, seperti pelajar yang memakai keyboard
        thr.focus()
        while float(thr.input_value()) < 89:
            s.page.keyboard.press("ArrowRight")
        while float(thr.input_value()) > 89:
            s.page.keyboard.press("ArrowLeft")
    walk["slider-89"] = float(thr.input_value())
    s.page.wait_for_timeout(3000)
    walk["threshold-at-89"] = "threshold" in s.done()
    if not MOBILE:
        s.page.keyboard.press("ArrowRight")
        walk["slider-90"] = float(thr.input_value())
    else:
        walk["slider-90"] = s.drag_slider("Ambang keyakinan", 96)
    walk["threshold"] = s.wait_task("threshold", 25)
    s.page.wait_for_timeout(200)
    s.top()
    s.shot(f"w{TAG}-4")
    s.shot(f"w{TAG}-4-list", selector=".grp-list")
    walk["rows4"] = s.rows()
    walk["status4"] = s.status()
    # positif palsu dari poster halte saat ambang rendah
    s.drag_slider("Ambang keyakinan", 25)
    fp = None
    t0 = time.time()
    while time.time() - t0 < 30:
        rows = s.rows()
        if any("palsu" in r["cells"][1] and "is-filtered" not in r["cls"] for r in rows):
            fp = round(time.time() - t0, 1)
            break
        s.page.wait_for_timeout(200)
    walk["fp-at-25"] = fp
    s.top()
    s.shot(f"w{TAG}-4b")
    s.nav("next")

    walk["preset4"] = {n: s.toggle_state(n) for n in ("Kamera", "LiDAR", "Radar", "Fusi", "Pelacakan", "Prediksi")}
    walk["preset4-threshold"] = s.page.locator(".ctl-slider", has_text="Ambang keyakinan").locator("output").inner_text()
    s.page.wait_for_timeout(1500)
    s.top()
    s.shot(f"w{TAG}-5a")
    s.toggle("Prediksi")
    walk["pred-states"] = {n: s.toggle_state(n) for n in ("Fusi", "Pelacakan", "Prediksi")}
    banners = []
    t0 = time.time()
    while time.time() - t0 < 45:
        b = s.page.locator(".warn-banner")
        if b.is_visible():
            txt = b.inner_text().strip()
            if not banners or banners[-1] != txt:
                banners.append(txt)
        if "predict" in s.done():
            walk["predict"] = round(time.time() - t0, 1)
            break
        s.page.wait_for_timeout(100)
    else:
        walk["predict"] = None
    s.page.wait_for_timeout(150)
    s.top()
    s.shot(f"w{TAG}-5")
    walk["banners"] = banners
    walk["status5"] = s.status()
    # teruskan sampai mobil berhenti dan penyeberang lewat
    t0 = time.time()
    seen = []
    while time.time() - t0 < 12:
        st = s.status()
        if not seen or seen[-1] != st:
            seen.append(st)
        s.page.wait_for_timeout(250)
    walk["statusSeq5"] = seen[:12]
    R["walk"] = walk
    R["afterWalk"] = s.done()

    # ---------- 3. shell ----------
    s.phase = "shell"
    shell = {}
    s.top()
    pause = s.page.locator('[data-act="pause"]')
    s.press(pause)
    s.page.wait_for_timeout(300)
    h1 = canvas_hash(s)
    s.page.wait_for_timeout(1200)
    h2 = canvas_hash(s)
    shell["paused"] = s.hook()["paused"]
    shell["canvasStaticWhilePaused"] = h1 == h2
    shell["pauseLabel"] = pause.inner_text().strip()
    # tombol hantu saat dijeda
    s.page.locator('.step-dot[data-go="2"]').first.dispatch_event("click")
    s.page.wait_for_timeout(300)
    shell["pausedAfterStep"] = s.hook()["paused"]
    s.press(s.page.locator(".ghost-btn").first)
    s.page.wait_for_timeout(600)
    shell["rejectedLabelWhilePaused"] = s.page.locator(".readout", has_text="Pantulan ditolak").locator(".readout-value").inner_text()
    s.top()
    s.shot(f"s{TAG}-paused-ghost")
    s.page.locator('.step-dot[data-go="4"]').first.dispatch_event("click")
    s.page.wait_for_timeout(200)
    s.top()
    s.press(pause)
    s.page.wait_for_timeout(300)
    h3 = canvas_hash(s)
    s.page.wait_for_timeout(500)
    shell["canvasMovesAfterResume"] = h3 != canvas_hash(s)
    shell["pausedAfterResume"] = s.hook()["paused"]
    s.page.wait_for_timeout(1500)
    rates = {}
    for label in ("1x", "2x", "0,5x"):
        s.press(s.page.locator(".speed-wrap .seg-btn", has_text=label).first)
        s.page.wait_for_timeout(400)
        ego = s.page.locator(".hud").inner_text().replace("\n", " ")
        rates[label] = {"speed": s.hook()["speed"], "hud": ego, "rates": track_rates(s, 1.5)}
    s.press(s.page.locator(".speed-wrap .seg-btn", has_text="1x").first)
    shell["rates"] = rates
    s.press(s.page.locator('[data-act="reset"]'))
    s.page.wait_for_timeout(600)
    hk = s.hook()
    shell["afterReset"] = {k: hk[k] for k in ("paused", "lessonStatus", "activeLoops", "completedTasks")}
    shell["statusAfterReset"] = s.status()
    s.top()
    s.shot(f"s{TAG}-after-reset")
    R["shell"] = shell

    # ---------- 4. nav ----------
    s.phase = "nav"
    s.page.locator('.step-dot[data-go="0"]').first.dispatch_event("click")
    s.page.wait_for_timeout(200)
    for _ in range(2):
        for i in range(5):
            s.nav("next")
        for i in range(5):
            s.nav("prev")
    for i in [3, 0, 4, 1, 2, 5, 0]:
        s.page.locator(f'.step-dot[data-go="{i}"]').first.dispatch_event("click")
        s.page.wait_for_timeout(120)
    R["nav"] = {"step": s.hook()["stepIndex"], "errors": list(s.errors)}

    # ---------- 5. leak ----------
    s.phase = "leak"
    loopCount = "async () => (await import('/js/engine/loop.js')).Loop.activeCount"
    base = {
        "hook": s.hook()["activeLoops"],
        "Loop.activeCount": s.page.evaluate(loopCount),
        "listeners": s.window_listeners(),
    }
    s.page.evaluate("() => { location.hash = '#/' }")
    s.page.wait_for_timeout(600)
    home = {"Loop.activeCount": s.page.evaluate(loopCount), "listeners": s.window_listeners(),
            "styles": s.page.evaluate("() => document.querySelectorAll('style[data-lesson]').length")}
    for i in range(5):
        s.page.evaluate(f"() => {{ location.hash = '{ROUTE}' }}")
        s.page.wait_for_timeout(700)
        s.page.evaluate("() => { location.hash = '#/' }")
        s.page.wait_for_timeout(500)
    home2 = {"Loop.activeCount": s.page.evaluate(loopCount), "listeners": s.window_listeners(),
             "styles": s.page.evaluate("() => document.querySelectorAll('style[data-lesson]').length")}
    s.page.evaluate(f"() => {{ location.hash = '{ROUTE}' }}")
    s.page.wait_for_timeout(1000)
    after = {
        "hook": s.hook()["activeLoops"],
        "Loop.activeCount": s.page.evaluate(loopCount),
        "listeners": s.window_listeners(),
        "canvases": s.page.evaluate("() => document.querySelectorAll('canvas').length"),
        "banners": s.page.evaluate("() => document.querySelectorAll('.warn-banner').length"),
        "styles": s.page.evaluate("() => document.querySelectorAll('style[data-lesson]').length"),
        "status": s.hook()["lessonStatus"],
    }
    R["leak"] = {"lessonFirst": base, "homeFirst": home, "homeAfter5": home2, "lessonAfter5": after}
    R["errors"] = s.errors

dump(R)
