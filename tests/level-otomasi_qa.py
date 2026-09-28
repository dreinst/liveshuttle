"""QA pelajaran Level Otomasi (perjalanan Ma Chung ke Alun-alun Merdeka) lewat UI.

Menyelesaikan semua tugas lewat tombol, lalu mencoba skenario tambahan (level 3 tanpa respons,
level 2 diabaikan, rem mematikan ACC, level 3 ditolak dekat zona, level 4 ditolak di luar kawasan),
keyboard, jeda, kecepatan, ulangi, peta perjalanan, ringkasan, dan uji kebocoran navigasi.

Pemakaian: python3 tests/level-otomasi_qa.py [--mobile] [--port 8241]
Butuh server statis (python3 tests/serve.py PORT) yang melayani root proyek.
"""
import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
MOBILE = "--mobile" in sys.argv
PORT = sys.argv[sys.argv.index("--port") + 1] if "--port" in sys.argv else "8241"
BASE = f"http://127.0.0.1:{PORT}/"
SHOTS = "/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/level-otomasi-malang/"
TAG = "m" if MOBILE else "d"
ROUTE = "#/pelajaran/level-otomasi"
os.makedirs(SHOTS, exist_ok=True)


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

    def hook(self):
        return self.page.evaluate("() => JSON.parse(JSON.stringify(window.__simotonom))")

    def state(self):
        return self.page.evaluate("() => window.__levelOtomasi ? JSON.parse(JSON.stringify(window.__levelOtomasi.state)) : null")

    def status(self):
        return self.page.locator(".sim-status").inner_text()

    def alert(self):
        el = self.page.locator(".lvl-alert")
        if el.get_attribute("hidden") is not None:
            return None
        return el.locator(".lvl-alert-title").inner_text()

    def chip(self, i):
        return self.page.locator(".hud .hud-chip").nth(i).inner_text().replace("\n", " ")

    def where(self):
        return self.page.locator(".trip-where").inner_text()

    def shot(self, name, full=False):
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

    def press(self, name):
        btn = self.page.locator(".pad .btn-hold", has_text=name)
        btn.scroll_into_view_if_needed()
        box = btn.bounding_box()
        self.page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        self.page.mouse.down()

    def release(self):
        self.page.mouse.up()

    def hold(self, name, seconds):
        self.press(name)
        self.page.wait_for_timeout(int(seconds * 1000))
        self.release()

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

    def wait_state(self, fn, timeout=20):
        t0 = time.time()
        while time.time() - t0 < timeout:
            st = self.state()
            if st and fn(st):
                return round(time.time() - t0, 1)
            self.page.wait_for_timeout(150)
        return None


R = {}
checks = []


def need(cond, msg):
    checks.append((bool(cond), msg))


with S() as s:
    s.page.goto(BASE + "#/", wait_until="load")
    s.page.evaluate("() => localStorage.clear()")
    s.page.goto(BASE + ROUTE, wait_until="load")
    s.page.reload(wait_until="load")
    s.page.wait_for_timeout(1500)
    h = s.hook()
    R["start"] = {"step": h["stepIndex"], "status": h["lessonStatus"], "loops": h["activeLoops"], "canvases": s.page.evaluate("() => document.querySelectorAll('.stage canvas, .grp-trip canvas').length")}
    need(R["start"]["status"] == "ready" and R["start"]["step"] == 0 and R["start"]["loops"] == 1 and R["start"]["canvases"] == 2, "awal pelajaran")
    st0 = s.state()
    R["start"]["state"] = {"lead": st0["lead"], "trip": round(st0["trip"]), "limit": st0["limitKmh"], "where": s.where()}
    need(st0["lead"] and st0["lead"]["kind"] == "angkot" and "Jalan Tidar" in s.where() and st0["limitKmh"] == 40, "langkah 1 di Jalan Tidar di belakang angkot")

    # ---------- langkah 1: level 0, kemudikan 150 m ----------
    s.press("Gas")
    s.page.wait_for_timeout(5000)
    R["l0-midway"] = {"status": s.status(), "alert": s.alert(), "chip": s.chip(3)}
    s.stage_shot("1-level0-drive")
    R["l0-manual"] = s.wait_task("l0-manual", 40)
    s.release()
    need(R["l0-manual"] is not None, "tugas l0-manual")
    s.page.wait_for_timeout(300)
    s.shot("1-level0-done")

    # ---------- langkah 2: pilih level 1, ACC di belakang angkot 5 detik ----------
    s.next_step()
    R["step2-start"] = {"status": s.status(), "chip": s.chip(0), "where": s.where()}
    s.level(1)
    s.page.wait_for_timeout(3000)
    R["l1-mid"] = {"status": s.status(), "gap": s.page.locator(".grp-data .readout").nth(1).inner_text().replace("\n", " ")}
    s.stage_shot("2-level1-acc")
    R["l1-acc"] = s.wait_task("l1-acc", 25)
    need(R["l1-acc"] is not None, "tugas l1-acc")
    s.shot("2-level1-done")

    # ---------- langkah 3: level 2, jawab "Pegang kemudi" ----------
    s.next_step()
    R["l2-prompt-after"] = s.wait_alert("Pegang kemudi", 12)
    s.stage_shot("3-level2-prompt")
    s.page.locator('[data-act="pegang"]').click()
    R["l2-attention"] = s.wait_task("l2-attention", 5)
    R["l2-after"] = {"alert": s.alert(), "status": s.status()}
    need(R["l2-attention"] is not None, "tugas l2-attention")

    # ---------- langkah 4: level 3, ambil alih saat diminta ----------
    s.next_step()
    R["l3-tor-after"] = s.wait_alert("Ambil alih kemudi", 15)
    s.page.wait_for_timeout(1200)
    R["l3-tor"] = {"alert": s.alert(), "count": s.page.locator(".lvl-alert-count").inner_text(), "status": s.status(), "where": s.where()}
    s.stage_shot("4-level3-tor")
    s.page.locator('[data-act="ambil-alih"]').click()
    R["l3-takeover"] = s.wait_task("l3-takeover", 5)
    need(R["l3-takeover"] is not None, "tugas l3-takeover")
    s.page.wait_for_timeout(400)
    R["l3-after"] = {"alert": s.alert(), "chip": s.chip(1), "status": s.status()}
    # tanpa menyetir: rem darurat otomatis harus berhenti sebelum kerucut
    s.speed("2x")
    R["l3-aeb-after"] = s.wait_alert("Rem darurat", 25)
    s.page.wait_for_timeout(2500)
    st = s.state()
    R["l3-aeb-state"] = {"alert": s.alert(), "speed": round(st["speedKmh"], 1), "crashes": st["crashes"]}
    need(R["l3-aeb-after"] is not None and st["crashes"]["zone"] == 0, "AEB berhenti sebelum zona tanpa menabrak")
    s.stage_shot("4b-aeb-cones")
    s.speed("1x")

    # ---------- langkah 5: level 4 menepi sendiri di ujung kawasan ----------
    s.next_step()
    st = s.state()
    R["l4-start"] = {"where": s.where(), "inKawasan": st["inKawasan"], "limit": st["limitKmh"], "status": s.status()}
    need(st["inKawasan"] and st["limitKmh"] == 30 and "Villa Puncak Tidar" in s.status(), "langkah 5 dimulai di kawasan Villa Puncak Tidar")
    s.speed("2x")
    R["l4-mrm-alert"] = s.wait_alert("Manuver risiko minimal", 20)
    s.page.wait_for_timeout(1200)
    s.stage_shot("5-level4-mrm")
    R["l4-mrm"] = s.wait_task("l4-mrm", 30)
    need(R["l4-mrm"] is not None, "tugas l4-mrm")
    s.page.wait_for_timeout(400)
    st = s.state()
    R["l4-after"] = {"alert": s.alert(), "status": s.status(), "pos": s.page.locator(".grp-data .readout").nth(3).inner_text().replace("\n", " "), "inKawasan": st["inKawasan"], "where": s.where()}
    need("Tepi kiri" in R["l4-after"]["pos"] and st["inKawasan"], "level 4 berhenti di tepi kiri, masih di dalam kawasan")
    s.stage_shot("5-level4-mrc")
    s.page.locator(".grp-trip").scroll_into_view_if_needed()
    s.page.locator(".grp-trip").screenshot(path=SHOTS + f"qa-{TAG}-5-trip.png")
    s.shot("5-level4-page")
    s.speed("1x")

    # ---------- langkah 6: level 5 melewati batas kawasan ----------
    s.next_step()
    s.speed("2x")
    R["l5-pass-after"] = s.wait_alert("Level 5 terus berjalan", 20)
    R["l5-out"] = s.wait_state(lambda x: not x["inKawasan"], 25)
    s.page.wait_for_timeout(3000)
    st = s.state()
    R["l5"] = {"alert": s.alert(), "status": s.status(), "limit": st["limitKmh"], "speed": round(st["speedKmh"], 1), "where": s.where()}
    need(R["l5-out"] is not None and st["limitKmh"] == 40 and st["speedKmh"] > 35, "level 5 keluar kawasan dan melaju 40 km/jam")
    s.stage_shot("6-level5-pass")
    # level 4 tidak bisa aktif lagi di luar kawasan
    s.level(4)
    s.page.wait_for_timeout(200)
    R["l4-outside"] = {"alert": s.alert(), "sys": s.page.locator(".lv-sys-text").inner_text()}
    need(R["l4-outside"]["alert"] == "Level 4 tidak bisa aktif", "level 4 ditolak di luar kawasan")
    s.shot("6-level5-page")
    s.speed("1x")

    # ---------- skenario tambahan ----------
    # level 3 tanpa respons: berhenti di lajur dengan lampu hazard
    s.go_step(3)
    s.speed("2x")
    R["l3-nores-tor"] = s.wait_alert("Ambil alih kemudi", 15)
    R["l3-nores-mrm"] = s.wait_alert("Tidak ada respons", 20)
    R["l3-nores-mrc"] = s.wait_alert("Mobil berhenti di lajur", 20)
    need(R["l3-nores-mrc"] is not None, "level 3 tanpa respons berhenti di lajur")
    s.page.wait_for_timeout(500)
    s.stage_shot("7-level3-mrc")
    s.speed("1x")

    # level 2 diabaikan: peringatan keras, lalu kemudi diserahkan
    s.go_step(2)
    s.speed("2x")
    R["l2-ign-prompt"] = s.wait_alert("Pegang kemudi", 12)
    R["l2-ign-warn"] = s.wait_alert("Pegang kemudi sekarang", 12)
    R["l2-ign-handback"] = s.wait_alert("Sistem level 2 mati", 12)
    need(R["l2-ign-handback"] is not None, "level 2 menyerahkan kemudi")
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
    need(R["brake-cancel"]["alert"] and "rem" in R["brake-cancel"]["alert"].lower(), "rem mematikan ACC")

    # level 3 ditolak saat zona sudah dekat
    s.go_step(3)
    s.level(0)
    s.speed("2x")
    s.page.wait_for_timeout(2500)
    s.speed("1x")
    s.level(3)
    s.page.wait_for_timeout(200)
    R["l3-refuse"] = {"alert": s.alert(), "sys": s.page.locator(".lv-sys-text").inner_text()}
    need(R["l3-refuse"]["alert"] == "Level 3 belum bisa aktif", "level 3 ditolak dekat zona")

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
    need(R["key-level2"] == "2" and not R["key-gas-speed"].endswith(" 0 km/jam"), "keyboard")

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
    need(R["paused"] is True and R["speed2"] == 2 and R["afterReset"]["activeLoops"] == 1, "jeda, kecepatan, ulangi")

    # ringkasan dan kemajuan
    s.go_step(6)
    R["summaryStep"] = s.hook()["stepIndex"]
    s.shot("9-summary")
    R["progress"] = s.page.evaluate("() => (JSON.parse(localStorage.getItem('liveshuttle.progress.v1') || '{}').lessons || {})['level-otomasi']")
    R["completed"] = s.hook()["completedTasks"]
    need(set(R["completed"]) >= {"l0-manual", "l1-acc", "l2-attention", "l3-takeover", "l4-mrm"}, "semua tugas selesai")

    # tidak ada pejalan kaki dan lampu lalu lintas, dan tidak ada tabrakan tercatat untuk keduanya
    st = s.state()
    R["safety"] = st["safety"] if st else None

    # navigasi berulang: tidak boleh ada loop, kanvas, style, atau hook yang tertinggal
    for i in range(8):
        s.page.evaluate("() => { location.hash = '#/' }")
        s.page.wait_for_timeout(250)
        s.page.evaluate(f"() => {{ location.hash = '{ROUTE}' }}")
        s.page.wait_for_timeout(350)
    R["afterNav"] = {
        "loops": s.hook()["activeLoops"],
        "canvases": s.page.evaluate("() => document.querySelectorAll('.stage canvas, .grp-trip canvas').length"),
        "styleTags": s.page.evaluate("() => document.querySelectorAll('style[data-lesson]').length"),
    }
    s.page.evaluate("() => { location.hash = '#/' }")
    s.page.wait_for_timeout(500)
    R["home"] = {
        "loops": s.hook()["activeLoops"],
        "styleTags": s.page.evaluate("() => document.querySelectorAll('style[data-lesson]').length"),
        "hookLeft": s.page.evaluate("() => 'level' + (window.__levelOtomasi ? ' masih ada' : ' bersih')"),
    }
    need(R["afterNav"]["loops"] == 1 and R["afterNav"]["canvases"] == 2 and R["afterNav"]["styleTags"] == 1, "navigasi berulang")
    need(R["home"]["styleTags"] == 0 and R["home"]["hookLeft"] == "level bersih", "kembali ke beranda bersih")
    R["errors"] = s.errors
    need(not s.errors, "tanpa galat atau peringatan konsol")

R["checks"] = [(ok, msg) for ok, msg in checks]
R["passed"] = all(ok for ok, _ in checks)
print(json.dumps(R, indent=1, ensure_ascii=False))
sys.exit(0 if R["passed"] else 1)
