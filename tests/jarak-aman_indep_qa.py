"""QA mandiri pelajaran Jarak Aman, dijalankan seperti pelajar sungguhan.

Slider digeser dengan mouse (desktop) atau sentuhan asli lewat CDP (ponsel), tombol diklik atau
diketuk. Yang diperiksa:
  1. Tidak ada tugas yang selesai sendiri saat langkah dibiarkan, dan aksi yang salah tidak
     menyelesaikan tugas.
  2. Kelima tugas selesai lewat UI dan tercatat di window.__simotonom.
  3. Hasil tiap percobaan (banner dan panel) cocok dengan fisika yang dihitung di sini.
  4. Jeda, kecepatan 0,5x/1x/2x (lama percobaan), Ulangi, langkah maju mundur.
  5. Keluar masuk pelajaran 5 kali: loop, kanvas, style, HUD, ResizeObserver, dan listener
     window/document tidak bocor.
  6. Semua pesan konsol error/warning dan pageerror.

Pemakaian: python3 tests/jarak-aman_indep_qa.py [--mobile] [--port 8138]
"""
import json
import math
import os
import sys
import time

from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
SHOTS = "/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/jarak-aman-qa/"
MOBILE = "--mobile" in sys.argv
PORT = sys.argv[sys.argv.index("--port") + 1] if "--port" in sys.argv else "8138"
BASE = f"http://127.0.0.1:{PORT}/"
TAG = "m" if MOBILE else "d"
LESSON = "#/pelajaran/jarak-aman"

# Hitung ResizeObserver yang masih aktif (observe tanpa disconnect).
INIT = """
(() => {
  const RO = window.ResizeObserver;
  window.__roLive = 0;
  window.ResizeObserver = class extends RO {
    constructor(cb) { super(cb); this.__n = 0; }
    observe(t, o) { if (!this.__n) window.__roLive++; this.__n++; return super.observe(t, o); }
    disconnect() { if (this.__n) window.__roLive--; this.__n = 0; return super.disconnect(); }
  };
})();
"""


def log(*a):
    print(" ".join(str(x) for x in a), flush=True)


class S:
    def __init__(self):
        self.errors = []

    def __enter__(self):
        os.makedirs(SHOTS, exist_ok=True)
        self.pw = sync_playwright().start()
        self.browser = self.pw.chromium.launch(executable_path=CHROME, headless=True)
        if MOBILE:
            self.ctx = self.browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        else:
            self.ctx = self.browser.new_context(viewport={"width": 1366, "height": 900}, device_scale_factor=1)
        self.ctx.add_init_script(INIT)
        self.page = self.ctx.new_page()
        self.cdp = self.ctx.new_cdp_session(self.page)
        self.page.on("console", lambda m: self.errors.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
        self.page.on("pageerror", lambda e: self.errors.append(f"pageerror: {e}"))
        return self

    def __exit__(self, *a):
        self.browser.close()
        self.pw.stop()

    # ---------- baca keadaan ----------
    def hook(self):
        return self.page.evaluate("() => JSON.parse(JSON.stringify(window.__simotonom))")

    def done(self):
        return self.hook()["completedTasks"]

    def readouts(self):
        return self.page.evaluate("""() => Object.fromEntries([...document.querySelectorAll('.lesson-jarak-aman .readout')]
            .map(r => [r.querySelector('.readout-label').textContent, r.querySelector('.readout-value').textContent]))""")

    def hud(self):
        return self.page.evaluate("""() => Object.fromEntries([...document.querySelectorAll('.hud-chip')]
            .map(c => [c.querySelector('.hud-label')?.textContent || '', c.querySelector('.hud-value').textContent]))""")

    def status(self):
        return self.page.locator(".sim-status").inner_text()

    def banner(self):
        b = self.page.locator(".ja-banner")
        return None if b.get_attribute("hidden") is not None else {"tone": b.get_attribute("data-tone"), "text": b.inner_text()}

    def result(self):
        return self.page.locator(".ja-result").inner_text()

    def slider_input(self, label):
        sel = self.page.evaluate("""(lab) => { const n = [...document.querySelectorAll('.lesson-jarak-aman .ctl-slider')]
            .find(x => x.querySelector('label').textContent === lab); return n ? '#' + n.querySelector('input').id : null; }""", label)
        return self.page.locator(sel)

    def slider_value(self, label):
        return float(self.slider_input(label).input_value())

    # ---------- aksi seperti pelajar ----------
    def tap(self, locator):
        locator.evaluate("(e) => e.scrollIntoView({ block: 'center' })")
        self.page.wait_for_timeout(120)
        if MOBILE:
            locator.tap()
        else:
            locator.click()

    def _drag(self, x0, x1, y):
        n = 10
        if MOBILE:
            self.cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x0, "y": y}]})
            for i in range(1, n + 1):
                self.cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x0 + (x1 - x0) * i / n, "y": y}]})
                self.page.wait_for_timeout(16)
            self.cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        else:
            self.page.mouse.move(x0, y)
            self.page.mouse.down()
            for i in range(1, n + 1):
                self.page.mouse.move(x0 + (x1 - x0) * i / n, y)
                self.page.wait_for_timeout(16)
            self.page.mouse.up()
        self.page.wait_for_timeout(80)

    def drag_slider(self, label, value):
        inp = self.slider_input(label)
        inp.evaluate("(e) => e.scrollIntoView({ block: 'center' })")
        self.page.wait_for_timeout(200)
        mn, mx, st = float(inp.get_attribute("min")), float(inp.get_attribute("max")), float(inp.get_attribute("step"))
        for _ in range(4):
            box = inp.bounding_box()
            thumb = 20

            def xof(v):
                return box["x"] + thumb / 2 + (v - mn) / (mx - mn) * (box["width"] - thumb)

            cur = float(inp.input_value())
            if abs(cur - value) < st / 2:
                break
            y = box["y"] + box["height"] / 2
            x0, x1 = xof(cur), xof(value)
            if abs(x1 - x0) < 24:
                # geseran pendek di bawah ambang sentuh: tarik dulu menjauh, lalu kembali ke target
                away = x0 + (40 if x1 >= x0 else -40)
                self._drag(x0, away, y)
                x0 = xof(float(inp.input_value()))
            self._drag(x0, x1, y)
        return float(inp.input_value())

    def seg(self, text):
        self.tap(self.page.locator(".lesson-jarak-aman .controls .seg-btn", has_text=text).first)
        self.page.wait_for_timeout(150)

    def aeb(self, on):
        sw = self.page.locator(".lesson-jarak-aman .ctl-toggle[role=switch]", has_text="AEB")
        if (sw.get_attribute("aria-checked") == "true") != on:
            self.tap(sw)
        self.page.wait_for_timeout(150)
        return sw.get_attribute("aria-checked") == "true"

    def scenario(self, name):
        self.tap(self.page.locator(".ja-scn .btn", has_text=name))

    def wait_banner(self, timeout=40):
        t0 = time.time()
        while time.time() - t0 < timeout:
            b = self.banner()
            if b:
                return round(time.time() - t0, 2), b
            self.page.wait_for_timeout(50)
        return None, None

    def run(self, name, timeout=40):
        self.scenario(name)
        t, b = self.wait_banner(timeout)
        self.page.wait_for_timeout(300)
        return t, b

    def next_step(self):
        self.tap(self.page.locator(".step-nav .btn-primary"))
        self.page.wait_for_timeout(350)

    def prev_step(self):
        self.tap(self.page.locator(".step-nav .btn-secondary"))
        self.page.wait_for_timeout(350)

    def go_step(self, i):
        self.tap(self.page.locator(f'.step-dot[data-go="{i}"]'))
        self.page.wait_for_timeout(350)

    def speed(self, label):
        self.tap(self.page.locator(".speed-wrap .seg-btn", has_text=label))

    def shot(self, name, full=False):
        path = SHOTS + f"qa-{TAG}-{name}.png"
        self.page.screenshot(path=path, full_page=full)
        return path

    def stage_shot(self, name):
        self.page.evaluate("() => document.querySelector('.stage').scrollIntoView({block: 'start'})")
        self.page.wait_for_timeout(150)
        path = SHOTS + f"qa-{TAG}-{name}.png"
        self.page.locator(".sim-area").first.screenshot(path=path)
        return path

    def listeners(self):
        out = {}
        for expr in ("window", "document"):
            obj = self.cdp.send("Runtime.evaluate", {"expression": expr, "objectGroup": "qa"})["result"]["objectId"]
            out[expr] = len(self.cdp.send("DOMDebugger.getEventListeners", {"objectId": obj})["listeners"])
        self.cdp.send("Runtime.releaseObjectGroup", {"objectGroup": "qa"})
        return out

    def counts(self):
        c = self.page.evaluate("""() => ({ loops: window.__simotonom.activeLoops, canvases: document.querySelectorAll('canvas').length,
            styles: document.querySelectorAll('style[data-lesson]').length, chips: document.querySelectorAll('.hud-chip').length,
            meters: document.querySelectorAll('.ja-meter').length, banners: document.querySelectorAll('.ja-banner').length, ro: window.__roLive })""")
        c["listeners"] = self.listeners()
        return c


# ---------- fisika pembanding (dihitung ulang di sini, bukan dari model.js) ----------
def expect_rem(kmh, tau, mu, tr):
    """Mobil depan rem mendadak, kedua mobil rem mu*g, tanpa AEB. Kembalikan (tabrakan, benturan km/jam, sisa m)."""
    v, a = kmh / 3.6, mu * 9.8
    gap = v * tau
    rem = v * (tau - tr)
    if rem >= -1e-9:
        return False, 0, max(0.0, rem)
    # cari waktu sentuh numerik
    t, dt = 0.0, 1e-4
    while True:
        lx = v * t - 0.5 * a * t * t if t < v / a else v * v / (2 * a)
        lv = max(0.0, v - a * t)
        if t < tr:
            ex, ev = v * t, v
        else:
            tb = t - tr
            ex = v * tr + (v * tb - 0.5 * a * tb * tb if tb < v / a else v * v / (2 * a))
            ev = max(0.0, v - a * tb)
        if gap + lx - ex <= 0:
            return True, (ev - lv) * 3.6, 0
        t += dt


R = {"mode": "mobile" if MOBILE else "desktop", "problems": []}


def check(cond, what):
    if not cond:
        R["problems"].append(what)
        log("MASALAH:", what)


with S() as s:
    s.page.goto(BASE + "#/", wait_until="load")
    s.page.wait_for_timeout(600)
    s.page.evaluate("() => localStorage.clear()")
    s.page.goto(BASE + "#/", wait_until="load")
    s.page.wait_for_timeout(800)
    R["home_baseline"] = s.counts()
    s.page.goto(BASE + LESSON, wait_until="load")
    s.page.wait_for_timeout(2000)
    h = s.hook()
    R["load"] = {k: h[k] for k in ("lessonStatus", "stepIndex", "stepCount", "completedTasks", "activeLoops")}
    check(h["lessonStatus"] == "ready" and h["stepCount"] == 5 and not h["completedTasks"], "muat awal")
    R["lesson_first"] = s.counts()
    s.shot("00-awal")

    # ---------- 1. tidak ada tugas yang selesai sendiri ----------
    s.speed("2x")
    idle = {}
    for i in range(5):
        s.go_step(i)
        s.page.wait_for_timeout(3500)
        idle[i] = {"done": s.done(), "kmh": s.slider_value("Kecepatan"), "tau": s.slider_value("Jarak waktu ACC")}
    R["idle"] = idle
    check(all(not v["done"] for v in idle.values()), "tugas selesai sendiri saat idle")

    # aksi yang salah tidak boleh menyelesaikan tugas
    wrong = {}
    s.go_step(1)  # crash: tekan skenario rintangan, bukan rem mendadak
    wrong["crash_rintangan"] = s.run("Rintangan")[1]
    wrong["crash_after"] = s.done()
    s.go_step(2)  # gap-fix: jarak masih 1 detik
    wrong["gapfix_tau1"] = s.run("rem mendadak")[1]
    wrong["gapfix_after"] = s.done()
    s.go_step(3)  # aeb: AEB masih mati
    wrong["aeb_off"] = s.run("Rintangan")[1]
    s.aeb(True)  # AEB menyala tetapi skenario rem mendadak (AEB tidak sempat membantu pada 80 km/jam)
    wrong["aeb_rem"] = s.run("rem mendadak")[1]
    wrong["aeb_after"] = s.done()
    s.go_step(4)  # licin: jalan masih basah
    wrong["licin_basah"] = s.run("Rintangan")[1]
    wrong["licin_after"] = s.done()
    R["wrong"] = wrong
    check(not s.done(), "aksi salah menyelesaikan tugas: " + str(s.done()))
    s.speed("1x")

    # ---------- 2. tugas lewat UI ----------
    s.go_step(0)
    R["t1_kmh"] = s.drag_slider("Kecepatan", 80)
    s.seg("Basah")
    t0 = time.time()
    while "calc" not in s.done() and time.time() - t0 < 6:
        s.page.wait_for_timeout(100)
    R["calc_s"] = round(time.time() - t0, 2) if "calc" in s.done() else None
    R["t1_formula"] = s.page.locator(".ja-formula").inner_text()
    R["t1_meter"] = s.page.locator(".ja-mhead").inner_text()
    check(R["calc_s"] is not None and R["calc_s"] >= 0.8, f"calc {R['calc_s']}")
    check("83,7 m" in R["t1_formula"] and "33,3 m" in R["t1_formula"] and "50,4 m" in R["t1_formula"], "rumus 80 basah")
    s.stage_shot("01-rumus")
    s.next_step()

    # langkah 2: rem mendadak, 1 detik, basah, manusia
    pre = {"kmh": s.slider_value("Kecepatan"), "tau": s.slider_value("Jarak waktu ACC")}
    R["t2_preset"] = pre
    s.scenario("rem mendadak")
    s.page.wait_for_timeout(1300)
    R["t2_mid"] = {"status": s.status(), "hud": s.hud(), "ro": s.readouts()}
    s.stage_shot("02a-reaksi")
    t, b = s.wait_banner()
    R["t2_banner"] = b
    R["t2_result"] = s.result()
    s.page.wait_for_timeout(300)
    R["crash"] = "crash" in s.done()
    col, imp, _ = expect_rem(80, 1.0, 0.5, 1.5)
    check(b and b["tone"] == "danger" and f"{round(imp)} km/jam" in b["text"], f"banner tabrakan {b} harap {imp:.1f}")
    check(R["crash"], "tugas crash")
    s.stage_shot("02b-tabrakan")
    s.next_step()

    # langkah 3: jarak 2 detik
    R["t3_tau"] = s.drag_slider("Jarak waktu ACC", 2.0)
    s.page.wait_for_timeout(800)
    t, b = s.run("rem mendadak")
    R["t3_banner"] = b
    R["t3_result"] = s.result()
    R["gap-fix"] = "gap-fix" in s.done()
    check(b and b["tone"] == "ok" and "11,1 m" in b["text"], f"banner aman 11,1 m: {b}")
    check(R["gap-fix"], "tugas gap-fix")
    s.stage_shot("03-aman")
    # tepi: jarak waktu sama dengan waktu reaksi
    R["t3_edge_tau"] = s.drag_slider("Jarak waktu ACC", 1.5)
    t, b = s.run("rem mendadak")
    R["t3_edge_banner"] = b
    R["t3_edge_result"] = s.result()
    check(b and "0 km/jam" not in b["text"], f"benturan 0 km/jam pada jarak 1,5 detik: {b}")
    s.stage_shot("03b-tepi")
    R["t3_14_tau"] = s.drag_slider("Jarak waktu ACC", 1.4)
    t, b = s.run("rem mendadak")
    col, imp, _ = expect_rem(80, 1.4, 0.5, 1.5)
    R["t3_14_banner"] = b
    check(b and b["tone"] == "danger" and f"{round(imp)} km/jam" in b["text"], f"1,4 detik harap {imp:.1f}: {b}")
    s.next_step()

    # langkah 4: AEB pada rintangan diam
    R["t4_preset"] = {"kmh": s.slider_value("Kecepatan"), "tau": s.slider_value("Jarak waktu ACC")}
    R["t4_aeb"] = s.aeb(True)
    s.scenario("Rintangan")
    s.page.wait_for_timeout(700)
    s.stage_shot("04a-rintangan")
    t, b = s.wait_banner()
    s.page.wait_for_timeout(300)
    R["t4_banner"] = b
    R["t4_result"] = s.result()
    R["aeb"] = "aeb" in s.done()
    check(R["aeb"], "tugas aeb")
    s.stage_shot("04b-aeb")
    # 40 km/jam, klaim teks: AEB mencegah tabrakan pada rintangan diam
    s.drag_slider("Kecepatan", 40)
    t, b = s.run("Rintangan")
    R["t4_40_rintangan"] = b
    s.stage_shot("04c-aeb-40")
    t, b = s.run("rem mendadak")
    R["t4_40_rem"] = b
    s.next_step()

    # langkah 5: licin
    s.seg("Licin")
    t, b = s.run("Rintangan")
    R["t5_banner"] = b
    R["t5_result"] = s.result()
    R["licin"] = "licin" in s.done()
    check(R["licin"], "tugas licin")
    s.stage_shot("05-licin")
    s.drag_slider("Kecepatan", 40)
    s.drag_slider("Jarak waktu ACC", 3.0)
    t, b = s.run("Rintangan")
    R["t5_40_3"] = b
    check(b and b["tone"] == "ok", f"40 km/jam 3 detik licin harus aman: {b}")
    s.stage_shot("05b-licin-40")
    R["completed"] = s.done()
    check(sorted(R["completed"]) == sorted(["calc", "crash", "gap-fix", "aeb", "licin"]), "semua tugas")

    # ---------- 3. jeda, kecepatan, ulangi ----------
    s.drag_slider("Kecepatan", 80)
    s.drag_slider("Jarak waktu ACC", 1.0)
    s.seg("Basah")
    s.aeb(False)
    durations = {}
    for lab in ("1x", "2x", "0,5x"):
        s.speed(lab)
        t, b = s.run("rem mendadak", 60)
        durations[lab] = t
    R["run_seconds"] = durations
    check(durations["2x"] < durations["1x"] * 0.7 and durations["0,5x"] > durations["1x"] * 1.6, f"kecepatan {durations}")
    s.speed("1x")
    # jeda di tengah percobaan
    s.scenario("rem mendadak")
    s.page.wait_for_timeout(1500)
    s.tap(s.page.locator('[data-act="pause"]'))
    s.page.wait_for_timeout(300)
    a = (s.readouts(), s.status(), s.hud())
    s.page.wait_for_timeout(1500)
    bb = (s.readouts(), s.status(), s.hud())
    R["pause"] = {"paused": s.hook()["paused"], "frozen": a == bb, "badge": s.page.locator(".stage-badge").is_visible(), "banner": s.banner()}
    check(R["pause"]["paused"] and R["pause"]["frozen"] and R["pause"]["badge"], "jeda")
    s.stage_shot("06-jeda")
    s.tap(s.page.locator('[data-act="pause"]'))
    t, b = s.wait_banner()
    R["after_resume_banner"] = b
    check(b is not None, "percobaan selesai setelah dilanjutkan")
    s.stage_shot("06b-jeda-selesai")
    # Ulangi di tengah percobaan
    s.scenario("rem mendadak")
    s.page.wait_for_timeout(1200)
    s.tap(s.page.locator('[data-act="reset"]'))
    s.page.wait_for_timeout(600)
    R["reset_mid"] = {"banner": s.banner(), "status": s.status(), "paused": s.hook()["paused"]}
    check(R["reset_mid"]["banner"] is None and "mengikuti" in R["reset_mid"]["status"], "ulangi di tengah percobaan")
    # Ulangi saat dijeda harus melanjutkan
    s.tap(s.page.locator('[data-act="pause"]'))
    s.tap(s.page.locator('[data-act="reset"]'))
    s.page.wait_for_timeout(300)
    R["reset_unpauses"] = not s.hook()["paused"]
    check(R["reset_unpauses"], "ulangi melanjutkan")

    # ---------- 4. langkah maju mundur ----------
    for _ in range(4):
        s.prev_step()
    for _ in range(5):
        s.next_step()
    R["summary_index"] = s.hook()["stepIndex"]
    check(R["summary_index"] == 5, "ringkasan")
    s.page.evaluate("() => window.scrollTo(0, 0)")
    s.shot("07-ringkasan")
    for i in (3, 1, 4, 0, 2, 5, 2):
        s.go_step(i)
    R["errors_after_steps"] = list(s.errors)

    # ---------- 5. keluar masuk 5 kali ----------
    s.page.evaluate("() => { location.hash = '#/' }")
    s.page.wait_for_timeout(700)
    R["home_before"] = s.counts()
    s.page.evaluate(f"() => {{ location.hash = '{LESSON}' }}")
    s.page.wait_for_timeout(1200)
    R["lesson_1"] = s.counts()
    for _ in range(5):
        s.page.evaluate("() => { location.hash = '#/' }")
        s.page.wait_for_timeout(400)
        s.page.evaluate(f"() => {{ location.hash = '{LESSON}' }}")
        s.page.wait_for_timeout(900)
        s.page.locator(".ja-scn .btn").first.dispatch_event("click")
        s.page.wait_for_timeout(300)
    R["lesson_after_5"] = s.counts()
    s.page.evaluate("() => { location.hash = '#/' }")
    s.page.wait_for_timeout(700)
    R["home_after"] = s.counts()
    check(R["lesson_after_5"] == R["lesson_1"] or {k: v for k, v in R["lesson_after_5"].items() if k != "listeners"} == {k: v for k, v in R["lesson_1"].items() if k != "listeners"}, "kebocoran di pelajaran")
    check(R["home_after"] == R["home_before"], f"kebocoran di beranda {R['home_before']} {R['home_after']}")
    check(R["lesson_after_5"]["listeners"] == R["lesson_1"]["listeners"], "listener bertambah")
    R["errors"] = s.errors
    check(not s.errors, "pesan konsol")

print(json.dumps(R, indent=1, ensure_ascii=False))
print("OK" if not R["problems"] else "GAGAL: " + "; ".join(R["problems"]))
sys.exit(0 if not R["problems"] else 1)
