"""Uji tepi pelajaran Persepsi: kontrol saat dijeda, kecepatan 2x, ubah ukuran jendela, dan laju frame."""
import sys
import time
sys.path.insert(0, "/Users/mcdonny/Downloads/ndur/driverless-sim/tests")
from persepsi_util import Session, dump  # noqa: E402

res = {}
with Session() as s:
    s.go("#/")
    s.page.evaluate("() => localStorage.clear()")
    s.go("#/pelajaran/persepsi", 1500)
    # laju frame pada 1x
    res["fps"] = s.page.evaluate("""() => new Promise((ok) => { let n = 0; const t0 = performance.now();
        const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else ok(Math.round(n / 3)); }; requestAnimationFrame(f); })""")
    # langkah 3, dijeda, lalu munculkan pantulan palsu
    s.page.locator('.step-dot[data-go="2"]').dispatch_event("click")
    s.page.wait_for_timeout(400)
    s.page.locator('[data-act="pause"]').click()
    s.page.wait_for_timeout(300)
    before = s.page.locator(".readout", has_text="Pantulan ditolak").locator(".readout-value").inner_text()
    s.page.locator("button", has_text="Munculkan pantulan palsu").click()
    t0 = time.time()
    done = None
    while time.time() - t0 < 5:
        if "ghost-rejected" in s.hook()["completedTasks"]:
            done = round(time.time() - t0, 1)
            break
        s.page.wait_for_timeout(150)
    res["pausedGhost"] = {"before": before, "after": s.page.locator(".readout", has_text="Pantulan ditolak").locator(".readout-value").inner_text(), "taskWhilePaused": done, "paused": s.hook()["paused"]}
    s.page.evaluate("() => window.scrollTo(0, 0)")
    s.shot("edge-paused-ghost", selector=".stage")
    # prediksi saat dijeda (mengaktifkan pelacakan dan fusi)
    s.page.locator(".ctl-toggle", has_text="Prediksi").first.click()
    s.page.wait_for_timeout(300)
    res["pausedToggles"] = {n: s.page.locator(".ctl-toggle", has_text=n).first.get_attribute("aria-checked") for n in ("Fusi", "Pelacakan", "Prediksi")}
    # matikan fusi: pelacakan dan prediksi ikut mati
    s.page.locator(".ctl-toggle", has_text="Fusi").first.click()
    s.page.wait_for_timeout(200)
    res["fusionOff"] = {n: s.page.locator(".ctl-toggle", has_text=n).first.get_attribute("aria-checked") for n in ("Fusi", "Pelacakan", "Prediksi")}
    s.page.locator('[data-act="pause"]').click()
    s.page.locator(".speed-wrap .seg-btn", has_text="2x").click()
    s.page.locator(".ctl-toggle", has_text="Prediksi").first.click()
    s.page.wait_for_timeout(5000)
    # derau maksimum sebentar
    sl = s.page.locator(".ctl-slider", has_text="Derau sensor").locator("input")
    sl.fill("3")
    s.page.wait_for_timeout(3000)
    s.page.evaluate("() => window.scrollTo(0, 0)")
    s.shot("edge-noise3", selector=".stage")
    sl.fill("1")
    # ubah ukuran jendela saat berjalan
    s.page.set_viewport_size({"width": 800, "height": 900})
    s.page.wait_for_timeout(800)
    s.page.set_viewport_size({"width": 1366, "height": 900})
    s.page.wait_for_timeout(800)
    res["afterResize"] = {k: s.hook()[k] for k in ("lessonStatus", "activeLoops", "speed")}
    res["errors"] = s.errors
dump(res)
