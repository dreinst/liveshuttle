"""QA pelajaran Level Otomasi lewat UI: semua tugas, skenario tambahan, jeda, ulangi, dan uji kebocoran.

Pemakaian: python3 tests/level-otomasi_qa.py [--mobile] [--port 8111]
Butuh server statis yang melayani root proyek di port tersebut.
"""
import json
import sys
import time

from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
MOBILE = "--mobile" in sys.argv
PORT = sys.argv[sys.argv.index("--port") + 1] if "--port" in sys.argv else "8111"
BASE = f"http://127.0.0.1:{PORT}/"
SHOTS = "/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/level-otomasi/"
TAG = "m" if MOBILE else "d"
ROUTE = "#/pelajaran/level-otomasi"


class S:
    def __init__(self):
        self.errors = []

    def __enter__(self):
        self.pw = sync_playwright().start()
        self.browser = self.pw.chromium.launch(executable_path=CHROME, headless=True)
        if MOBILE:
            self.ctx = self.browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        else:
            self.ctx = self.browser.new_context(viewport={"width": 1366, "height": 900}, device_scale_factor=1)
        self.page = self.ctx.new_page()
        self.page.on("console", lambda m: self.errors.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
        self.page.on("pageerror", lambda e: self.errors.append(f"pageerror: {e}"))
        return self

    def __exit__(self, *a):
        self.browser.close()
        self.pw.stop()

    def go(self, route, wait=1200):
        self.page.goto(BASE + route, wait_until="load")
        self.page.wait_for_timeout(wait)

    def hook(self):
        return self.page.evaluate("() => JSON.parse(JSON.stringify(window.__simotonom))")

    def status(self):
        return self.page.locator(".sim-status").inner_text()

    def alert(self):
        el = self.page.locator(".lvl-alert")
        if el.get_attribute("hidden") is not None:
            return None
        return el.locator(".lvl-alert-title").inner_text()

    def chip(self, i):
        return self.page.locator(".hud .hud-chip").nth(i).inner_text().replace("\n", " ")

    def shot(self, name, full=False):
        # kanvas ada di atas: gulir ke atas dulu supaya panggung terlihat
        if not full:
            self.page.evaluate("() => window.scrollTo(0, 0)")
            self.page.wait_for_timeout(120)
        self.page.screenshot(path=SHOTS + f"qa-{TAG}-{name}.png", full_page=full)

    def stage_shot(self, name):
        self.page.locator(".stage").screenshot(path=SHOTS + f"qa-{TAG}-{name}.png")

    def next_step(self):
        self.page.locator(".step-nav .btn-primary").dispatch_event("click")
        self.page.wait_for_timeout(350)

    def go_step(self, i):
        self.page.locator(f'.step-dot[data-go="{i}"]').dispatch_event("click")
        self.page.wait_for_timeout(350)

    def level(self, n):
        self.page.locator(".grp-level .seg-btn", has_text=str(n)).click()
        self.page.wait_for_timeout(150)

    def speed(self, label):
        self.page.locator(".speed-wrap .seg-btn", has_text=label).click()

    def hold(self, name, seconds):
        btn = self.page.locator(".pad .btn-hold", has_text=name)
        btn.scroll_into_view_if_needed()
        box = btn.bounding_box()
        self.page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        self.page.mouse.down()
        self.page.wait_for_timeout(int(seconds * 1000))
        self.page.mouse.up()

    def wait_task(self, task, timeout=30):
        t0 = time.time()
        while time.time() - t0 < timeout:
            if task in self.hook()["completedTasks"]:
                return round(time.time() - t0, 1)
            self.page.wait_for_timeout(200)
        return None

    def wait_alert(self, text, timeout=20):
        t0 = time.time()
        while time.time() - t0 < timeout:
            a = self.alert()
            if a and text in a:
                return round(time.time() - t0, 1)
            self.page.wait_for_timeout(100)
        return None

    def wait_status(self, text, timeout=20):
        t0 = time.time()
        while time.time() - t0 < timeout:
            if text in self.status():
                return round(time.time() - t0, 1)
            self.page.wait_for_timeout(150)
        return None


R = {}
with S() as s:
    s.go("#/")
    s.page.evaluate("() => localStorage.clear()")
    s.go(ROUTE, 1500)
    h = s.hook()
    R["start"] = {"step": h["stepIndex"], "status": h["lessonStatus"], "loops": h["activeLoops"]}

    # ---------- langkah 1: level 0, kemudikan 150 m ----------
    btn = s.page.locator(".pad .btn-hold", has_text="Gas")
    btn.scroll_into_view_if_needed()
    box = btn.bounding_box()
    s.page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    s.page.mouse.down()
    s.page.wait_for_timeout(5500)
    R["l0-midway"] = {"status": s.status(), "alert": s.alert(), "chip": s.chip(3)}
    s.stage_shot("1-level0-drive")
    R["l0-manual"] = s.wait_task("l0-manual", 25)
    s.page.mouse.up()
    s.page.wait_for_timeout(300)
    s.shot("1-level0-done")

    # ---------- langkah 2: pilih level 1, ACC menjaga jarak 5 detik ----------
    s.next_step()
    R["step2-start"] = {"status": s.status(), "chip": s.chip(0)}
    s.level(1)
    s.page.wait_for_timeout(3000)
    R["l1-mid"] = {"status": s.status(), "gap": s.page.locator(".grp-data .readout").nth(1).inner_text().replace("\n", " ")}
    s.stage_shot("2-level1-acc")
    R["l1-acc"] = s.wait_task("l1-acc", 20)
    s.shot("2-level1-done")

    # ---------- langkah 3: level 2, jawab "Pegang kemudi" ----------
    s.next_step()
    R["l2-prompt-after"] = s.wait_alert("Pegang kemudi", 12)
    s.stage_shot("3-level2-prompt")
    s.shot("3-level2-prompt-page")
    s.page.locator('[data-act="pegang"]').click()
    R["l2-attention"] = s.wait_task("l2-attention", 5)
    R["l2-after"] = {"alert": s.alert(), "status": s.status()}

    # ---------- langkah 4: level 3, ambil alih saat diminta ----------
    s.next_step()
    R["l3-tor-after"] = s.wait_alert("Ambil alih kemudi", 15)
    s.page.wait_for_timeout(1500)
    R["l3-tor"] = {"alert": s.alert(), "count": s.page.locator(".lvl-alert-count").inner_text(), "status": s.status()}
    s.stage_shot("4-level3-tor")
    s.shot("4-level3-tor-page")
    s.page.locator('[data-act="ambil-alih"]').click()
    R["l3-takeover"] = s.wait_task("l3-takeover", 5)
    s.page.wait_for_timeout(400)
    R["l3-after"] = {"alert": s.alert(), "chip": s.chip(1), "status": s.status()}
    # tanpa menyetir: rem darurat otomatis harus berhenti sebelum kerucut
    s.speed("2x")
    R["l3-aeb-after"] = s.wait_alert("Rem darurat", 25)
    s.page.wait_for_timeout(2500)
    R["l3-aeb-state"] = {"alert": s.alert(), "status": s.status(), "speed": s.chip(2)}
    s.stage_shot("4b-aeb-cones")
    s.speed("1x")

    # ---------- langkah 5: level 4 menepi sendiri ----------
    s.next_step()
    s.speed("2x")
    R["l4-mrm-alert"] = s.wait_alert("Manuver risiko minimal", 20)
    s.page.wait_for_timeout(1200)
    s.stage_shot("5-level4-mrm")
    R["l4-mrm"] = s.wait_task("l4-mrm", 30)
    s.page.wait_for_timeout(400)
    R["l4-after"] = {"alert": s.alert(), "status": s.status(), "pos": s.page.locator(".grp-data .readout").nth(3).inner_text().replace("\n", " ")}
    s.stage_shot("5-level4-mrc")
    s.shot("5-level4-page")
    s.speed("1x")

    # ---------- langkah 6: level 5 melewati batas ----------
    s.next_step()
    s.speed("2x")
    R["l5-pass-after"] = s.wait_alert("Level 5 terus berjalan", 20)
    s.page.wait_for_timeout(2600)
    R["l5"] = {"alert": s.alert(), "status": s.status()}
    s.stage_shot("6-level5-pass")
    s.shot("6-level5-page")
    s.speed("1x")

    # ---------- skenario tambahan ----------
    # level 3 tanpa respons: berhenti di lajur dengan lampu hazard
    s.go_step(3)
    s.speed("2x")
    R["l3-nores-tor"] = s.wait_alert("Ambil alih kemudi", 15)
    R["l3-nores-mrm"] = s.wait_alert("Tidak ada respons", 20)
    R["l3-nores-mrc"] = s.wait_alert("Mobil berhenti di lajur", 20)
    s.page.wait_for_timeout(500)
    s.stage_shot("7-level3-mrc")
    R["l3-nores-status"] = s.status()
    s.speed("1x")

    # level 2 diabaikan: peringatan keras, lalu kemudi diserahkan
    s.go_step(2)
    s.speed("2x")
    R["l2-ign-prompt"] = s.wait_alert("Pegang kemudi", 12)
    R["l2-ign-warn"] = s.wait_alert("Pegang kemudi sekarang", 12)
    s.page.wait_for_timeout(600)
    s.stage_shot("8-level2-warn")
    R["l2-ign-handback"] = s.wait_alert("Sistem level 2 mati", 12)
    R["l2-ign-state"] = {"chip": s.chip(1), "status": s.status()}
    # aktifkan lagi lewat tombol di kotak peringatan
    s.page.locator('[data-act="alert-action"]').click()
    s.page.wait_for_timeout(300)
    R["l2-reengaged"] = s.chip(1)
    s.speed("1x")

    # level 1: rem mematikan ACC
    s.go_step(1)
    s.level(1)
    s.page.wait_for_timeout(2500)
    s.hold("Rem", 0.4)
    s.page.wait_for_timeout(200)
    R["brake-cancel"] = {"alert": s.alert(), "sys": s.page.locator(".lv-sys-text").inner_text()}

    # level 3 ditolak saat zona sudah dekat, dan level 4 di luar ODD
    s.go_step(3)
    s.level(0)
    s.speed("2x")
    s.page.wait_for_timeout(3500)
    s.speed("1x")
    s.level(3)
    s.page.wait_for_timeout(200)
    R["l3-refuse"] = {"alert": s.alert(), "sys": s.page.locator(".lv-sys-text").inner_text()}

    # keyboard: angka memilih level, panah menyetir (level 0)
    s.go_step(0)
    s.page.locator("body").click(position={"x": 5, "y": 300})
    s.page.keyboard.press("2")
    s.page.wait_for_timeout(250)
    R["key-level2"] = s.page.locator(".lv-num").inner_text()
    s.page.keyboard.press("0")
    s.page.wait_for_timeout(200)
    s.page.keyboard.down("ArrowUp")
    s.page.wait_for_timeout(1500)
    s.page.keyboard.up("ArrowUp")
    R["key-gas-speed"] = s.chip(2)

    # jeda, kecepatan, ulangi
    s.page.locator('[data-act="pause"]').click()
    s.page.wait_for_timeout(200)
    R["paused"] = s.hook()["paused"]
    s.page.locator('[data-act="pause"]').click()
    s.speed("2x")
    R["speed2"] = s.hook()["speed"]
    s.speed("1x")
    s.page.locator('[data-act="reset"]').click()
    s.page.wait_for_timeout(300)
    R["afterReset"] = {k: s.hook()[k] for k in ("paused", "lessonStatus", "activeLoops")}
    R["afterResetSpeed"] = s.chip(2)

    # ringkasan
    s.go_step(6)
    R["summaryStep"] = s.hook()["stepIndex"]
    s.shot("9-summary")
    R["progress"] = s.page.evaluate("() => JSON.parse(localStorage.getItem('simotonom.progress.v1')).lessons['level-otomasi']")

    # navigasi berulang: tidak boleh ada loop, kanvas, atau style yang tertinggal
    for i in range(8):
        s.page.evaluate("() => { location.hash = '#/' }")
        s.page.wait_for_timeout(250)
        s.page.evaluate(f"() => {{ location.hash = '{ROUTE}' }}")
        s.page.wait_for_timeout(350)
    R["afterNav"] = {
        "loops": s.hook()["activeLoops"],
        "canvases": s.page.evaluate("() => document.querySelectorAll('canvas').length"),
        "styleTags": s.page.evaluate("() => document.querySelectorAll('style[data-lesson]').length"),
    }
    s.page.evaluate("() => { location.hash = '#/' }")
    s.page.wait_for_timeout(400)
    R["home"] = {"loops": s.hook()["activeLoops"], "styleTags": s.page.evaluate("() => document.querySelectorAll('style[data-lesson]').length")}
    R["errors"] = s.errors

print(json.dumps(R, indent=2, ensure_ascii=False))
