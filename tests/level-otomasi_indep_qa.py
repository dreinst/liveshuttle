"""QA independen pelajaran Level Otomasi (ditulis oleh penguji, terpisah dari uji pembuat).

Pemakaian: python3 tests/level-otomasi_indep_qa.py [--mobile] [--port 8131] [--only NAMA,...]
Butuh server statis yang melayani root proyek di port tersebut.

Yang diperiksa:
  idle     tidak ada tugas yang selesai sendiri saat pelajar diam (langkah 1 sampai 4)
  tasks    semua tugas diselesaikan lewat UI seperti pelajar, tercatat di window.__simotonom
  shell    Jeda, Ulangi, dan tombol kecepatan bekerja
  nav      maju mundur semua langkah dengan tombol dan titik langkah
  keys     tombol panah menyetir setelah level diklik, P/A/0 sampai 5 bekerja
  leak     keluar masuk pelajaran 5 kali tanpa loop, style, atau listener yang tertinggal
"""
import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
MOBILE = "--mobile" in sys.argv
PORT = sys.argv[sys.argv.index("--port") + 1] if "--port" in sys.argv else "8131"
ONLY = sys.argv[sys.argv.index("--only") + 1].split(",") if "--only" in sys.argv else None
BASE = f"http://127.0.0.1:{PORT}/"
SHOTS = "/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/level-otomasi-qa/"
TAG = "m" if MOBILE else "d"
ROUTE = "#/pelajaran/level-otomasi"
os.makedirs(SHOTS, exist_ok=True)

# hitung listener di window dan document supaya kebocoran terlihat
INIT = """
(() => {
  const counts = { window: 0, document: 0 };
  const map = new WeakMap();
  const name = (t) => (t === window ? 'window' : t === document ? 'document' : null);
  const add = EventTarget.prototype.addEventListener;
  const rem = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    const n = name(this);
    if (n && fn) {
      let set = map.get(this);
      if (!set) map.set(this, (set = new Set()));
      const cap = typeof opts === 'boolean' ? opts : !!(opts && opts.capture);
      const key = type + '|' + cap;
      let per = set[key] || (set[key] = new Set());
      if (!per.has(fn)) {
        per.add(fn);
        counts[n]++;
        const sig = opts && opts.signal;
        if (sig) sig.addEventListener('abort', () => { if (per.delete(fn)) counts[n]--; }, { once: true });
      }
    }
    return add.call(this, type, fn, opts);
  };
  EventTarget.prototype.removeEventListener = function (type, fn, opts) {
    const n = name(this);
    if (n && fn) {
      const set = map.get(this);
      const cap = typeof opts === 'boolean' ? opts : !!(opts && opts.capture);
      const per = set && set[type + '|' + cap];
      if (per && per.delete(fn)) counts[n]--;
    }
    return rem.call(this, type, fn, opts);
  };
  window.__lvlQaListeners = counts;
})();
"""


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
        self.ctx.add_init_script(INIT)
        self.page = self.ctx.new_page()
        self.page.on("console", lambda m: self.errors.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
        self.page.on("pageerror", lambda e: self.errors.append(f"pageerror: {e}"))
        return self

    def __exit__(self, *a):
        self.browser.close()
        self.pw.stop()

    def go(self, route, wait=1500):
        self.page.goto(BASE + route, wait_until="load")
        t0 = time.time()
        while time.time() - t0 < 10:
            if route.startswith("#/pelajaran") and self.hook().get("lessonStatus") == "ready":
                break
            if not route.startswith("#/pelajaran"):
                break
            self.page.wait_for_timeout(100)
        self.page.wait_for_timeout(wait)

    def fresh(self):
        # ganti hash saja tidak memuat ulang halaman, jadi muat ulang supaya status shell ikut bersih
        self.go("#/", 300)
        self.page.evaluate("() => localStorage.clear()")
        self.page.goto(BASE + ROUTE, wait_until="load")
        self.page.reload(wait_until="load")
        self.page.evaluate("() => localStorage.clear()")
        self.page.reload(wait_until="load")
        self.go(ROUTE)

    def hook(self):
        return self.page.evaluate("() => JSON.parse(JSON.stringify(window.__simotonom))")

    def done(self):
        return self.hook()["completedTasks"]

    def status(self):
        return self.page.locator(".sim-status").inner_text()

    def alert(self):
        el = self.page.locator(".lvl-alert")
        if el.get_attribute("hidden") is not None:
            return None
        return el.locator(".lvl-alert-title").inner_text()

    def chips(self):
        return self.page.evaluate(
            "() => [...document.querySelectorAll('.hud .hud-chip')].filter(c => !c.hidden).map(c => c.innerText.replace(/\\n/g, ' '))")

    def readouts(self):
        return self.page.evaluate(
            "() => [...document.querySelectorAll('.grp-data .readout')].map(r => r.innerText.replace(/\\n/g, ' '))")

    def shot(self, name):
        self.page.evaluate("() => window.scrollTo(0, 0)")
        self.page.wait_for_timeout(150)
        self.page.screenshot(path=SHOTS + f"{TAG}-{name}.png")

    def stage_shot(self, name):
        self.page.locator(".stage").screenshot(path=SHOTS + f"{TAG}-{name}.png")

    def el_shot(self, sel, name):
        loc = self.page.locator(sel).first
        loc.scroll_into_view_if_needed()
        self.page.wait_for_timeout(150)
        loc.screenshot(path=SHOTS + f"{TAG}-{name}.png")

    def full_shot(self, name):
        self.page.screenshot(path=SHOTS + f"{TAG}-{name}.png", full_page=True)

    def next_step(self):
        self.page.locator(".step-nav .btn-primary").dispatch_event("click")
        self.page.wait_for_timeout(350)

    def prev_step(self):
        self.page.locator(".step-nav .btn-secondary, .step-nav .btn-ghost").first.dispatch_event("click")
        self.page.wait_for_timeout(250)

    def go_step(self, i):
        self.page.locator(f'.step-dot[data-go="{i}"]').dispatch_event("click")
        self.page.wait_for_timeout(350)

    def click(self, sel):
        loc = self.page.locator(sel).first
        loc.scroll_into_view_if_needed()
        if MOBILE:
            loc.tap()
        else:
            loc.click()
        self.page.wait_for_timeout(120)

    def level(self, n):
        loc = self.page.locator(f'.grp-level .seg-btn[data-value="{n}"]')
        loc.scroll_into_view_if_needed()
        if MOBILE:
            loc.tap()
        else:
            loc.click()
        self.page.wait_for_timeout(150)

    def speed(self, label):
        self.page.locator(".speed-wrap .seg-btn", has_text=label).click()
        self.page.wait_for_timeout(100)

    def press_hold(self, name):
        btn = self.page.locator(".pad .btn-hold", has_text=name)
        btn.scroll_into_view_if_needed()
        box = btn.bounding_box()
        self.page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        self.page.mouse.down()

    def release_hold(self):
        self.page.mouse.up()

    def wait(self, fn, timeout=20, every=120):
        t0 = time.time()
        while time.time() - t0 < timeout:
            v = fn()
            if v:
                return round(time.time() - t0, 1)
            self.page.wait_for_timeout(every)
        return None

    def wait_task(self, task, timeout=30):
        return self.wait(lambda: task in self.done(), timeout, 200)

    def wait_alert(self, text, timeout=20):
        return self.wait(lambda: (self.alert() or "").find(text) >= 0, timeout)

    def wait_status(self, text, timeout=20):
        return self.wait(lambda: text in self.status(), timeout)

    def canvas_png(self):
        return self.page.locator(".sim-canvas").first.screenshot()


def chip_num(chips, label):
    for c in chips:
        if c.startswith(label):
            digits = "".join(ch for ch in c[len(label):] if ch.isdigit() or ch == ".")
            try:
                return float(digits.replace(".", ""))
            except ValueError:
                return None
    return None


R = {}
want = lambda n: ONLY is None or n in ONLY

with S() as s:
    # ---------------- idle: tidak ada tugas yang selesai sendiri ----------------
    if want("idle"):
        s.fresh()
        res = {}
        for i, t in enumerate(["l0-manual", "l1-acc", "l2-attention", "l3-takeover"]):
            s.go_step(i)
            s.speed("2x")
            s.page.wait_for_timeout(12000 if i >= 2 else 6000)
            res[t] = {"done": t in s.done(), "status": s.status(), "alert": s.alert()}
            s.speed("1x")
        R["idle"] = res

    # ---------------- tasks: semua tugas lewat UI ----------------
    if want("tasks"):
        s.fresh()
        T = {}
        h = s.hook()
        T["start"] = {"step": h["stepIndex"], "loops": h["activeLoops"], "done": h["completedTasks"]}
        s.shot("01-start")
        # langkah 1: tahan Gas (desktop: panah atas di keyboard, mobile: tombol Gas)
        if MOBILE:
            s.press_hold("Gas")
        else:
            s.page.keyboard.down("ArrowUp")
        s.page.wait_for_timeout(4000)
        T["l0-mid"] = {"status": s.status(), "chips": s.chips(), "alert": s.alert(),
                       "gasHeld": s.page.locator(".pad .btn-hold", has_text="Gas").get_attribute("aria-pressed")}
        s.stage_shot("02-l0-driving")
        T["l0-manual"] = s.wait_task("l0-manual", 30)
        if MOBILE:
            s.release_hold()
        else:
            s.page.keyboard.up("ArrowUp")
        s.page.wait_for_timeout(300)
        # langkah 2
        s.next_step()
        T["l1-before"] = {"status": s.status(), "done": "l1-acc" in s.done()}
        s.page.wait_for_timeout(2000)
        T["l1-still-not-done-at-L0"] = "l1-acc" not in s.done()
        s.level(1)
        s.page.wait_for_timeout(2500)
        T["l1-mid"] = {"status": s.status(), "readouts": s.readouts(), "chips": s.chips()}
        s.stage_shot("03-l1-acc")
        T["l1-acc"] = s.wait_task("l1-acc", 20)
        s.shot("04-l1-page")
        # langkah 3
        s.next_step()
        T["l2-prompt"] = s.wait_alert("Pegang kemudi", 12)
        T["l2-alert-btn"] = s.page.locator('[data-act="alert-action"]').inner_text()
        s.stage_shot("05-l2-prompt")
        s.click('[data-act="pegang"]')
        T["l2-attention"] = s.wait_task("l2-attention", 5)
        T["l2-after"] = {"alert": s.alert(), "status": s.status()}
        s.stage_shot("06-l2-thanks")
        # langkah 4
        s.next_step()
        T["l3-tor"] = s.wait_alert("Ambil alih kemudi", 15)
        s.page.wait_for_timeout(1200)
        T["l3-tor-state"] = {"alert": s.alert(), "count": s.page.locator(".lvl-alert-count").inner_text(), "status": s.status(), "chips": s.chips()}
        s.stage_shot("07-l3-tor")
        s.shot("08-l3-page")
        if MOBILE:
            s.click('[data-act="alert-action"]')
        else:
            s.page.keyboard.press("a")
        T["l3-takeover"] = s.wait_task("l3-takeover", 5)
        s.page.wait_for_timeout(500)
        T["l3-after"] = {"alert": s.alert(), "status": s.status(), "chips": s.chips()}
        s.stage_shot("09-l3-taken")
        # langkah 5
        s.next_step()
        s.speed("2x")
        T["l4-mrm-alert"] = s.wait_alert("Manuver risiko minimal", 20)
        s.page.wait_for_timeout(1500)
        s.stage_shot("10-l4-mrm")
        T["l4-mrm"] = s.wait_task("l4-mrm", 30)
        s.page.wait_for_timeout(500)
        T["l4-after"] = {"alert": s.alert(), "status": s.status(), "readouts": s.readouts()}
        s.stage_shot("11-l4-mrc")
        s.speed("1x")
        # langkah 6
        s.next_step()
        s.speed("2x")
        T["l5-pass"] = s.wait_alert("Level 5 terus berjalan", 25)
        s.page.wait_for_timeout(1200)
        T["l5"] = {"alert": s.alert(), "status": s.status()}
        s.stage_shot("12-l5-pass")
        s.speed("1x")
        s.el_shot(".grp-resp", "13-resp-l5")
        s.full_shot("14-l5-full")
        s.next_step()
        s.page.wait_for_timeout(600)
        s.full_shot("15-summary")
        h = s.hook()
        prog = s.page.evaluate("() => localStorage.getItem('liveshuttle.progress.v1')")
        T["final"] = {"done": h["completedTasks"], "step": h["stepIndex"], "progress": json.loads(prog) if prog else None}
        R["tasks"] = T

    # ---------------- shell: jeda, ulangi, kecepatan ----------------
    if want("shell"):
        s.fresh()
        s.go_step(4)  # level 4, batas 230 m di depan
        s.page.wait_for_timeout(600)
        d0 = chip_num(s.chips(), "Batas area operasi")
        s.page.wait_for_timeout(2000)
        d1 = chip_num(s.chips(), "Batas area operasi")
        rate1 = (d0 - d1) / 2.0 if d0 and d1 else None
        s.speed("2x")
        d2 = chip_num(s.chips(), "Batas area operasi")
        s.page.wait_for_timeout(1500)
        d3 = chip_num(s.chips(), "Batas area operasi")
        rate2 = (d2 - d3) / 1.5 if d2 and d3 else None
        s.speed("0,5x")
        d4 = chip_num(s.chips(), "Batas area operasi")
        s.page.wait_for_timeout(2000)
        d5 = chip_num(s.chips(), "Batas area operasi")
        rate05 = (d4 - d5) / 2.0 if d4 and d5 else None
        s.speed("1x")
        # jeda
        s.page.locator('[data-act="pause"]').click()
        s.page.wait_for_timeout(300)
        p0 = chip_num(s.chips(), "Batas area operasi")
        img0 = s.canvas_png()
        s.page.wait_for_timeout(1500)
        p1 = chip_num(s.chips(), "Batas area operasi")
        img1 = s.canvas_png()
        paused_hook = s.hook()["paused"]
        # klik level saat dijeda: panel tetap diperbarui
        s.level(5)
        s.page.wait_for_timeout(400)
        paused_level_chip = s.chips()[0]
        s.level(4)
        s.page.locator('[data-act="pause"]').click()
        s.page.wait_for_timeout(300)
        resumed = not s.hook()["paused"]
        # tunggu berhenti di bahu jalan lalu Ulangi
        s.speed("2x")
        s.wait_task("l4-mrm", 30)
        s.page.wait_for_timeout(600)
        before_reset = {"status": s.status(), "chips": s.chips()}
        s.page.locator('[data-act="pause"]').click()
        s.page.locator('[data-act="reset"]').click()
        s.page.wait_for_timeout(400)
        after_reset = {"status": s.status(), "chips": s.chips(), "paused": s.hook()["paused"], "alert": s.alert()}
        s.speed("1x")
        R["shell"] = {
            "rate1x_m_per_s": rate1, "rate2x": rate2, "rate05x": rate05,
            "paused_dist_same": p0 == p1, "paused_canvas_same": img0 == img1, "paused_hook": paused_hook,
            "paused_level_chip": paused_level_chip, "resumed": resumed,
            "before_reset": before_reset, "after_reset": after_reset,
        }

    # ---------------- nav: maju mundur semua langkah ----------------
    if want("nav"):
        s.fresh()
        seq = []
        for i in range(6):
            s.next_step()
            seq.append(s.hook()["stepIndex"])
        for i in range(6):
            s.page.locator(".step-nav [data-go]").first.dispatch_event("click")
            s.page.wait_for_timeout(200)
            seq.append(s.hook()["stepIndex"])
        for i in [5, 0, 3, 1, 4, 2, 6, 2]:
            s.go_step(i)
            seq.append(s.hook()["stepIndex"])
        # ganti level cepat di setiap langkah
        for i in range(6):
            s.go_step(i)
            for n in [5, 3, 1, 4, 2, 0]:
                s.level(n)
        R["nav"] = {"seq": seq, "loops": s.hook()["activeLoops"], "status": s.status()}

    # ---------------- keys: panah menyetir setelah klik level ----------------
    if want("keys") and not MOBILE:
        s.fresh()
        s.go_step(1)
        s.level(1)
        s.page.wait_for_timeout(500)
        focused_role = s.page.evaluate("() => document.activeElement && document.activeElement.getAttribute('role')")
        s.page.keyboard.down("ArrowLeft")
        s.page.wait_for_timeout(200)
        left_pressed = s.page.locator(".pad .btn-hold", has_text="Kiri").get_attribute("aria-pressed")
        lvl_after_arrow = s.chips()[0]
        s.page.keyboard.up("ArrowLeft")
        # angka memilih level, P dan A
        s.go_step(2)
        s.page.keyboard.press("3")
        s.page.wait_for_timeout(300)
        chip3 = s.chips()[0]
        s.page.keyboard.press("2")
        s.page.wait_for_timeout(300)
        s.wait_alert("Pegang kemudi", 12)
        s.page.keyboard.press("p")
        p_done = s.wait_task("l2-attention", 4)
        # rem mematikan level 2
        s.page.keyboard.down("ArrowDown")
        s.page.wait_for_timeout(300)
        s.page.keyboard.up("ArrowDown")
        brake_alert = s.alert()
        s.stage_shot("20-brake-cancel")
        s.click('[data-act="alert-action"]')
        s.page.wait_for_timeout(300)
        re_engaged = s.page.locator(".lv-sys-text").inner_text()
        # level 3: menekan 3 saat sudah level 3 tidak boleh mengubah apa pun
        s.go_step(3)
        s.wait_alert("Ambil alih kemudi", 15)
        s.page.keyboard.press("3")
        s.page.wait_for_timeout(300)
        same_level_key = {"alert": s.alert(), "sys": s.page.locator(".lv-sys-text").inner_text()}
        # sistem mati karena rem, lalu tombol angka level yang sama menyalakannya lagi
        s.go_step(1)
        s.page.keyboard.press("1")
        s.page.wait_for_timeout(1500)
        s.page.keyboard.down("ArrowDown")
        s.page.wait_for_timeout(200)
        s.page.keyboard.up("ArrowDown")
        off_after_brake = s.page.locator(".lv-sys-text").inner_text()
        s.page.keyboard.press("1")
        s.page.wait_for_timeout(300)
        same_level_key["reengage_by_digit"] = [off_after_brake, s.page.locator(".lv-sys-text").inner_text()]
        R["keys"] = {
            "focused_role_after_click": focused_role, "left_pressed": left_pressed, "lvl_after_arrow": lvl_after_arrow,
            "chip3": chip3, "p_done": p_done, "brake_alert": brake_alert, "re_engaged": re_engaged,
            "same_level_key": same_level_key,
        }

    # ---------------- leak: keluar masuk 5 kali ----------------
    if want("leak"):
        s.fresh()
        base = s.page.evaluate("() => ({...window.__lvlQaListeners})")
        rounds = []
        for k in range(5):
            s.go("#/", 400)
            home = s.page.evaluate("() => ({ loops: window.__simotonom.activeLoops, styles: document.querySelectorAll('style[data-lesson]').length, l: {...window.__lvlQaListeners} })")
            s.go(ROUTE, 900)
            # sedikit interaksi supaya listener dan loop benar-benar dipakai
            s.level(2)
            s.page.wait_for_timeout(300)
            les = s.page.evaluate("() => ({ loops: window.__simotonom.activeLoops, styles: document.querySelectorAll('style[data-lesson]').length, canvases: document.querySelectorAll('.sim-canvas').length, alerts: document.querySelectorAll('.lvl-alert').length, l: {...window.__lvlQaListeners} })")
            rounds.append({"home": home, "lesson": les})
        R["leak"] = {"base": base, "rounds": rounds}

    R["errors"] = s.errors

print(json.dumps(R, indent=1, ensure_ascii=False))
