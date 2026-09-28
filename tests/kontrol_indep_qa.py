"""QA mandiri pelajaran Kendali (kontrol), dijalankan seperti pelajar sungguhan.

Slider digeser dengan mouse (desktop) atau sentuhan asli lewat CDP (ponsel), tombol diklik atau
diketuk. Yang diperiksa:
  1. Tidak ada tugas yang selesai sendiri: tiap langkah dibiarkan tanpa disentuh.
  2. Kelima tugas selesai lewat UI dan tercatat di window.__simotonom.
  3. Langkah maju mundur, Jeda, kecepatan 0,5x/1x/2x, Ulangi.
  4. Keluar masuk pelajaran 5 kali: loop, kanvas, style, dan listener window/document tidak bocor.
  5. Semua pesan konsol error/warning dan pageerror.

Pemakaian: python3 tests/kontrol_indep_qa.py [--mobile] [--port 8246]
"""
import json
import sys
import time

from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
SHOTS = "/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/kontrol/indep/"
MOBILE = "--mobile" in sys.argv
PORT = sys.argv[sys.argv.index("--port") + 1] if "--port" in sys.argv else "8246"
BASE = f"http://127.0.0.1:{PORT}/"
TAG = "m" if MOBILE else "d"
LOG = []


def log(*a):
    msg = " ".join(str(x) for x in a)
    LOG.append(msg)
    print(msg, flush=True)


class S:
    def __init__(self):
        self.errors = []

    def __enter__(self):
        import os
        os.makedirs(SHOTS, exist_ok=True)
        self.pw = sync_playwright().start()
        self.browser = self.pw.chromium.launch(executable_path=CHROME, headless=True)
        if MOBILE:
            self.ctx = self.browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        else:
            self.ctx = self.browser.new_context(viewport={"width": 1366, "height": 900}, device_scale_factor=1)
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
        return self.page.evaluate("""() => Object.fromEntries([...document.querySelectorAll('.lesson-kontrol .readout')]
            .map(r => [r.querySelector('.readout-label').textContent, r.querySelector('.readout-value').textContent]))""")

    def hud(self):
        return self.page.evaluate("""() => Object.fromEntries([...document.querySelectorAll('.hud-chip')]
            .map(c => [c.querySelector('.hud-label')?.textContent || '', (c.hidden ? '[tersembunyi] ' : '') + c.querySelector('.hud-value').textContent]))""")

    def status(self):
        return self.page.locator(".sim-status").inner_text()

    def note(self):
        return self.page.locator(".lesson-kontrol .result-note").inner_text()

    def slider_sel(self, label):
        return self.page.evaluate("""(lab) => { const n = [...document.querySelectorAll('.lesson-kontrol .ctl-slider')]
            .find(x => x.querySelector('label').textContent === lab); return n ? '#' + n.querySelector('input').id : null; }""", label)

    def slider_value(self, label):
        return float(self.page.locator(self.slider_sel(label)).input_value())

    # ---------- aksi seperti pelajar ----------
    def tap(self, locator):
        locator.evaluate("(e) => e.scrollIntoView({ block: 'center' })")
        if MOBILE:
            locator.tap()
        else:
            locator.click()

    def drag_slider(self, label, value):
        inp = self.page.locator(self.slider_sel(label))
        # seperti pelajar: gulir sampai slider ada di tengah layar (tidak tertutup notifikasi di bawah)
        inp.evaluate("(e) => e.scrollIntoView({ block: 'center' })")
        self.page.wait_for_timeout(200)
        box = inp.bounding_box()
        mn, mx = float(inp.get_attribute("min")), float(inp.get_attribute("max"))
        cur = float(inp.input_value())
        thumb = 20

        def xof(v):
            return box["x"] + thumb / 2 + (v - mn) / (mx - mn) * (box["width"] - thumb)

        y = box["y"] + box["height"] / 2
        x0, x1 = xof(cur), xof(value)
        n = 12
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
        self.page.wait_for_timeout(100)
        return float(inp.input_value())

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

    def shot(self, name, full=False, selector=None):
        path = SHOTS + f"{TAG}-{name}.png"
        if selector:
            self.page.locator(selector).first.screenshot(path=path)
        else:
            self.page.screenshot(path=path, full_page=full)
        return path

    def stage_shot(self, name):
        self.page.evaluate("() => document.querySelector('.stage').scrollIntoView({block: 'start'})")
        self.page.wait_for_timeout(150)
        return self.shot(name, selector=".sim-area")

    def listeners(self):
        out = {}
        for expr in ("window", "document"):
            obj = self.cdp.send("Runtime.evaluate", {"expression": expr, "objectGroup": "qa"})["result"]["objectId"]
            ls = self.cdp.send("DOMDebugger.getEventListeners", {"objectId": obj})["listeners"]
            out[expr] = len(ls)
        self.cdp.send("Runtime.releaseObjectGroup", {"objectGroup": "qa"})
        return out

    def wait_task(self, task, timeout, on_tick=None):
        t0 = time.time()
        while time.time() - t0 < timeout:
            if task in self.done():
                return round(time.time() - t0, 1)
            if on_tick:
                on_tick()
            self.page.wait_for_timeout(250)
        return None


def main():
    R = {"mode": "mobile" if MOBILE else "desktop"}
    with S() as s:
        s.page.goto(BASE + "#/", wait_until="load")
        s.page.wait_for_timeout(600)
        s.page.evaluate("() => localStorage.clear()")
        s.page.goto(BASE + "#/pelajaran/kontrol", wait_until="load")
        s.page.wait_for_timeout(2500)
        h = s.hook()
        R["load"] = {k: h[k] for k in ("lessonStatus", "stepIndex", "stepCount", "completedTasks", "activeLoops")}
        R["listeners_first"] = s.listeners()
        s.shot("00-awal")
        s.shot("00-awal-full", full=True)

        # ---------- 1. tidak ada tugas yang selesai sendiri ----------
        s.speed("2x")
        idle = {}
        waits = [8, 8, 26, 12, 12]
        for i, w in enumerate(waits):
            s.go_step(i)
            pre = {k: s.slider_value(k) for k in ("Lookahead Ld", "Kp", "Ki", "Kd", "Kecepatan target")}
            s.page.wait_for_timeout(w * 1000)
            idle[i] = {"preset": pre, "done": s.done(), "ro": {k: v for k, v in s.readouts().items() if k in ("RMS putaran terakhir", "Overshoot kecepatan", "Waktu mencapai target")}}
        R["idle"] = idle
        R["idle_ok"] = all(not v["done"] for v in idle.values())
        log("idle", json.dumps(idle, ensure_ascii=False))

        # ---------- 2. tugas lewat UI ----------
        s.go_step(0)
        R["t1_ld"] = s.drag_slider("Lookahead Ld", 2.5)
        seen = {}

        def watch1():
            st = s.status()
            if "berayun kiri kanan" in st and "weave" not in seen:
                seen["weave"] = st
                s.stage_shot("01-berayun")
            if "cadangan" in st and "takeover" not in seen:
                seen["takeover"] = st
                s.stage_shot("01b-cadangan")

        R["lookahead-small"] = s.wait_task("lookahead-small", 45, watch1)
        t0 = time.time()
        while time.time() - t0 < 15 and ("weave" not in seen or "takeover" not in seen):
            watch1()
            s.page.wait_for_timeout(200)
        R["t1_seen"] = seen
        log("t1", R["lookahead-small"], R["t1_ld"], json.dumps(seen, ensure_ascii=False))
        s.next_step()

        R["t2_ld"] = s.drag_slider("Lookahead Ld", 17)
        cut = {}

        def watch2():
            st = s.status()
            if "memotong tikungan" in st and "cut" not in cut:
                cut["cut"] = st
                s.stage_shot("02-potong")

        R["lookahead-large"] = s.wait_task("lookahead-large", 120, watch2)
        t0 = time.time()
        while time.time() - t0 < 20 and "cut" not in cut:
            watch2()
            s.page.wait_for_timeout(200)
        R["t2_seen"] = cut
        log("t2", R["lookahead-large"], R["t2_ld"], json.dumps(cut, ensure_ascii=False))
        s.next_step()

        R["t3_preset_ld"] = s.slider_value("Lookahead Ld")
        R["t3_ld"] = s.drag_slider("Lookahead Ld", 7)
        R["tuned"] = s.wait_task("tuned", 240)
        R["t3_readouts"] = s.readouts()
        log("t3", R["tuned"], R["t3_ld"], json.dumps(R["t3_readouts"], ensure_ascii=False))
        s.stage_shot("03-pas")
        # mode adaptif dan kamera seluruh lintasan
        s.tap(s.page.locator(".seg-btn", has_text="Adaptif"))
        s.page.wait_for_timeout(400)
        R["adaptive"] = s.page.evaluate("""() => { const sl = [...document.querySelectorAll('.lesson-kontrol .ctl-slider')];
            const f = (lab) => sl.find(x => x.querySelector('label').textContent === lab);
            return { ldDisabled: f('Lookahead Ld').querySelector('input').disabled, kVisible: getComputedStyle(f('Faktor k')).display !== 'none' }; }""")
        s.page.wait_for_timeout(1500)
        R["adaptive_hud"] = s.hud()
        s.shot("03b-adaptif-panel", full=True)
        s.tap(s.page.locator(".seg-btn", has_text="Tetap"))
        s.tap(s.page.locator(".seg-btn", has_text="Seluruh lintasan"))
        s.page.wait_for_timeout(800)
        s.stage_shot("03c-seluruh")
        s.tap(s.page.locator(".seg-btn", has_text="Ikuti mobil"))
        s.next_step()

        R["t4_preset"] = {k: s.slider_value(k) for k in ("Kp", "Ki", "Kd")}
        R["t4_ki"] = s.drag_slider("Ki", 1.0)
        R["t4_note_after_drag"] = s.note()
        s.tap(s.page.locator(".lesson-kontrol .btn", has_text="Uji dari diam"))
        R["pid-overshoot"] = s.wait_task("pid-overshoot", 30)
        s.page.wait_for_timeout(1500)
        R["t4_readouts"] = {k: v for k, v in s.readouts().items() if k in ("Overshoot kecepatan", "Waktu mencapai target")}
        log("t4", R["pid-overshoot"], R["t4_ki"], json.dumps(R["t4_readouts"], ensure_ascii=False))
        s.shot("04-overshoot", full=True)
        s.next_step()

        R["t5_preset"] = {k: s.slider_value(k) for k in ("Kp", "Ki", "Kd")}
        s.page.wait_for_timeout(4000)
        R["t5_preset_readouts"] = {k: v for k, v in s.readouts().items() if k in ("Overshoot kecepatan", "Waktu mencapai target")}
        R["t5_ki"] = s.drag_slider("Ki", 0.2)
        R["t5_note_after_drag"] = s.note()
        s.tap(s.page.locator(".lesson-kontrol .btn", has_text="Uji dari diam"))
        R["pid-tuned"] = s.wait_task("pid-tuned", 30)
        R["t5_readouts"] = {k: v for k, v in s.readouts().items() if k in ("Overshoot kecepatan", "Waktu mencapai target")}
        log("t5", R["pid-tuned"], R["t5_ki"], json.dumps(R["t5_readouts"], ensure_ascii=False))
        s.shot("05-setel", full=True)
        R["completed"] = s.done()

        # ---------- 3. jeda, kecepatan, ulangi ----------
        def lap_pct():
            v = s.readouts()["Putaran berjalan"].replace("%", "")
            return float(v) if v.replace(",", "").isdigit() else None

        s.tap(s.page.locator('[data-act="pause"]'))
        s.page.wait_for_timeout(400)
        a = (s.hud(), s.readouts()["Putaran berjalan"], s.status())
        s.page.wait_for_timeout(1500)
        b = (s.hud(), s.readouts()["Putaran berjalan"], s.status())
        R["pause"] = {"hookPaused": s.hook()["paused"], "frozen": a == b, "badge": s.page.locator('[data-el="badge"]').is_visible(), "btn": s.page.locator('[data-act="pause"]').inner_text()}
        s.stage_shot("06-jeda")
        s.tap(s.page.locator('[data-act="pause"]'))
        rates = {}
        for lab in ("1x", "2x", "0,5x"):
            s.speed(lab)
            for _ in range(3):
                p0 = lap_pct()
                s.page.wait_for_timeout(3000)
                p1 = lap_pct()
                if p0 is not None and p1 is not None and p1 > p0:
                    rates[lab] = round((p1 - p0) / 3, 2)
                    break
        R["speed_rates_pct_per_s"] = rates
        R["hook_speed"] = s.hook()["speed"]
        s.speed("1x")
        s.tap(s.page.locator('[data-act="reset"]'))
        s.page.wait_for_timeout(250)
        R["after_reset"] = {"hud": s.hud(), "lap": s.readouts()["Putaran berjalan"], "status": s.status(), "paused": s.hook()["paused"], "loops": s.hook()["activeLoops"]}
        # Ulangi juga saat dijeda harus melanjutkan
        s.tap(s.page.locator('[data-act="pause"]'))
        s.tap(s.page.locator('[data-act="reset"]'))
        s.page.wait_for_timeout(300)
        R["reset_while_paused_unpauses"] = not s.hook()["paused"]
        log("controls", json.dumps({k: R[k] for k in ("pause", "speed_rates_pct_per_s", "after_reset")}, ensure_ascii=False))

        # ---------- 4. maju mundur langkah ----------
        for _ in range(4):
            s.prev_step()
        for _ in range(5):
            s.next_step()
        R["summary_index"] = s.hook()["stepIndex"]
        s.page.evaluate("() => window.scrollTo(0, 0)")
        s.shot("07-ringkasan")
        s.shot("07-ringkasan-full", full=True)
        for i in (3, 1, 4, 0, 2, 5, 2):
            s.go_step(i)
        R["steps_errors_so_far"] = list(s.errors)

        # ---------- 5. keluar masuk 5 kali ----------
        s.page.evaluate("() => { location.hash = '#/' }")
        s.page.wait_for_timeout(600)
        R["home_loops_before"] = s.hook()["activeLoops"]
        R["listeners_home_before"] = s.listeners()
        s.page.evaluate("() => { location.hash = '#/pelajaran/kontrol' }")
        s.page.wait_for_timeout(1200)
        R["listeners_lesson_1"] = s.listeners()
        for _ in range(5):
            s.page.evaluate("() => { location.hash = '#/' }")
            s.page.wait_for_timeout(400)
            s.page.evaluate("() => { location.hash = '#/pelajaran/kontrol' }")
            s.page.wait_for_timeout(900)
        R["after_5_reentries"] = {
            "loops": s.hook()["activeLoops"],
            "canvases": s.page.evaluate("() => document.querySelectorAll('canvas').length"),
            "styleTags": s.page.evaluate("() => document.querySelectorAll('style[data-lesson]').length"),
            "hudChips": s.page.evaluate("() => document.querySelectorAll('.hud-chip').length"),
            "listeners": s.listeners(),
        }
        s.page.evaluate("() => { location.hash = '#/' }")
        s.page.wait_for_timeout(600)
        R["home_after"] = {"loops": s.hook()["activeLoops"], "styleTags": s.page.evaluate("() => document.querySelectorAll('style[data-lesson]').length"), "listeners": s.listeners()}
        R["errors"] = s.errors

    print(json.dumps(R, indent=1, ensure_ascii=False))
    tasks = ("lookahead-small", "lookahead-large", "tuned", "pid-overshoot", "pid-tuned")
    ok = all(R.get(t) is not None for t in tasks) and R["idle_ok"] and not R["errors"]
    print("OK" if ok else "GAGAL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
