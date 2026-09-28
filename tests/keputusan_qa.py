"""QA pelajaran Pengambilan Keputusan (Jalan Kawi, Malang) lewat UI, seperti pelajar sungguhan.

Menyelesaikan keempat tugas lewat tombol, memeriksa penghitung perisai keselamatan (harus 0), jeda,
ulangi, kecepatan, tombol keyboard, ringkasan, atribusi peta, navigasi berulang (kebocoran loop dan
kait uji), lalu menyimpan tangkapan layar ke tests/shots/keputusan-malang/.
Pemakaian: python3 tests/keputusan_qa.py [--mobile] [--port 8247]
"""
import json
import re
import sys
import time

from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
PORT = sys.argv[sys.argv.index("--port") + 1] if "--port" in sys.argv else "8247"
BASE = f"http://127.0.0.1:{PORT}/"
SHOTS = "/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/keputusan-malang/"
MOBILE = "--mobile" in sys.argv
TAG = "m" if MOBILE else "d"


def num(text):
    m = re.search(r"-?[\d.]+(?:,\d+)?", text or "")
    if not m:
        return None
    return float(m.group(0).replace(".", "").replace(",", "."))


def main():
    res = {"errors": [], "counterSamples": 0, "counterMax": {}}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=CHROME, headless=True)
        if MOBILE:
            ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        else:
            ctx = browser.new_context(viewport={"width": 1366, "height": 900})
        page = ctx.new_page()
        page.on("console", lambda m: res["errors"].append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: res["errors"].append(f"pageerror: {e}"))

        hook = lambda: page.evaluate("() => JSON.parse(JSON.stringify(window.__simotonom))")
        kp = lambda: page.evaluate("() => window.__keputusan ? JSON.parse(JSON.stringify(window.__keputusan)) : null")
        status = lambda: page.locator(".sim-status").inner_text()

        def sample():
            s = kp()
            if not s:
                return
            res["counterSamples"] += 1
            for k, v in s["counters"].items():
                res["counterMax"][k] = max(res["counterMax"].get(k, 0), v)

        def readout(label):
            return page.locator(".readout", has_text=label).first.locator(".readout-value").inner_text()

        def click(sel_text, cls=".seg-btn"):
            loc = page.locator(cls, has_text=sel_text).first
            loc.scroll_into_view_if_needed()
            loc.click()

        def wait_task(task, timeout):
            t0 = time.time()
            while time.time() - t0 < timeout:
                sample()
                if task in hook()["completedTasks"]:
                    return round(time.time() - t0, 1)
                page.wait_for_timeout(250)
            return None

        def wait_status(pattern, timeout):
            t0 = time.time()
            while time.time() - t0 < timeout:
                if re.search(pattern, status()):
                    return True
                page.wait_for_timeout(100)
            return False

        def top():
            page.evaluate("() => window.scrollTo(0, 0)")
            page.wait_for_timeout(150)

        def shot(name, full=False, selector=None):
            path = SHOTS + f"qa-{TAG}-{name}.png"
            if selector:
                page.locator(selector).first.screenshot(path=path)
            else:
                page.screenshot(path=path, full_page=full)

        def stage_shot(name):
            top()
            page.locator(".stage").first.screenshot(path=SHOTS + f"qa-{TAG}-{name}-stage.png")

        def next_step():
            page.locator(".step-nav .btn-primary").dispatch_event("click")
            page.wait_for_timeout(300)

        def boot(route):
            for attempt in range(4):
                before = len(res["errors"])
                page.goto(BASE + route, wait_until="load")
                try:
                    page.wait_for_function("() => window.__simotonom && (window.__simotonom.routeName !== 'lesson' || window.__simotonom.lessonStatus === 'ready')", timeout=15000)
                    return
                except Exception:
                    res["retries"] = res.get("retries", 0) + 1
                    res.setdefault("retryErrors", []).extend(res["errors"][before:])
                    del res["errors"][before:]
            raise RuntimeError("halaman gagal dimuat")

        boot("#/")
        page.wait_for_timeout(800)
        res["homeBaselineLoops"] = hook()["activeLoops"]
        page.evaluate("() => localStorage.clear()")
        boot("#/pelajaran/keputusan")
        page.wait_for_timeout(1000)
        h = hook()
        res["start"] = {"step": h["stepIndex"], "status": h["lessonStatus"], "loops": h["activeLoops"]}
        # tombol kontrol minimal 40 px
        res["smallTargets"] = page.evaluate("""() => [...document.querySelectorAll('.lesson-keputusan .ctl-group button, .lesson-keputusan .ctl-group input[type=range]')]
            .filter(el => el.offsetParent).map(el => { const r = el.getBoundingClientRect(); return { t: (el.innerText || el.getAttribute('aria-label') || el.type).trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) }; })
            .filter(o => o.h < 40 || o.w < 40)""")
        click("2x", ".speed-wrap .seg-btn")

        # ---------- langkah 1: lampu merah ----------
        page.wait_for_timeout(1500)
        click("Paksa merah")
        res["red-stop"] = wait_task("red-stop", 60)
        stage_shot("1-lampu-merah")
        res["status1"] = status()
        next_step()

        # ---------- langkah 2: pejalan kaki ----------
        click("Munculkan pejalan kaki", ".btn")
        res["ped-crossing-seen"] = wait_status("sedang menyeberang", 60)
        stage_shot("2-pejalan")
        res["yield-ped"] = wait_task("yield-ped", 60)
        next_step()

        # ---------- langkah 3: lampu kuning (tekan saat dekat) ----------
        t0 = time.time()
        while time.time() - t0 < 40:
            d = num(readout("Ke garis henti"))
            if d is not None and 0 < d < 22:
                break
            page.wait_for_timeout(50)
        click("Paksa merah")
        page.wait_for_timeout(500)
        stage_shot("3-kuning")
        res["yellow-decision"] = wait_task("yellow-decision", 40)
        grp = page.locator(".ctl-group", has_text="Dilema lampu kuning").first
        grp.scroll_into_view_if_needed()
        page.wait_for_timeout(300)
        grp.screenshot(path=SHOTS + f"qa-{TAG}-3-kuning-panel.png")
        res["yellowPanel"] = grp.inner_text()
        next_step()

        # ---------- langkah 4: angkot ngetem ----------
        click("Taruh angkot ngetem", ".btn")
        res["waiting-seen"] = wait_status("MENUNGGU CELAH", 60)
        page.wait_for_timeout(600)
        stage_shot("4-celah")
        res["overtaking-seen"] = wait_status("MENYALIP", 120)
        page.wait_for_timeout(1200)
        stage_shot("4-menyalip")
        res["overtake"] = wait_task("overtake", 60)
        page.locator(".kp-log").first.scroll_into_view_if_needed()
        page.wait_for_timeout(300)
        shot("4-log", selector=".kp-log-group")
        res["logTop"] = page.locator(".kp-log li").first.inner_text()
        res["logCount"] = page.locator(".kp-log li").count()
        next_step()

        # ---------- langkah 5: semua berjalan, tombol keyboard ----------
        page.wait_for_timeout(3000)
        top()
        page.keyboard.press("p")
        page.wait_for_timeout(400)
        s = kp()
        res["keyP"] = {"testPeds": len([p for p in s["peds"] if p["test"]]), "pending": s["pendingPed"]}
        page.keyboard.press("a")
        page.wait_for_timeout(300)
        res["keyA_removed"] = not kp()["angkot"]
        page.keyboard.press("a")
        page.wait_for_timeout(300)
        s = kp()
        res["keyA_again"] = {"angkot": s["angkot"], "pending": s["pendingAngkot"]}
        page.wait_for_timeout(4000)
        stage_shot("5-semua")
        shot("5-halaman", full=True)
        shield_grp = page.locator(".ctl-group", has_text="Perisai keselamatan").first
        res["shieldPanel"] = shield_grp.inner_text()

        # jeda, kecepatan, ulangi
        page.locator('[data-act="pause"]').click()
        page.wait_for_timeout(300)
        res["paused"] = hook()["paused"]
        t_a = kp()["time"]
        page.wait_for_timeout(600)
        res["pausedFrozen"] = kp()["time"] == t_a
        stage_shot("5-dijeda")
        page.locator('[data-act="pause"]').click()
        click("0,5x", ".speed-wrap .seg-btn")
        res["speed05"] = hook()["speed"]
        click("1x", ".speed-wrap .seg-btn")
        page.locator('[data-act="reset"]').click()
        page.wait_for_timeout(400)
        res["afterReset"] = {k: hook()[k] for k in ("paused", "lessonStatus", "activeLoops")}
        res["afterResetTime"] = kp()["time"]
        sample()

        # ringkasan
        next_step()
        res["summaryStep"] = hook()["stepIndex"]
        top()
        shot("6-ringkasan")
        res["progress"] = page.evaluate("() => JSON.parse(localStorage.getItem('liveshuttle.progress.v1') || '{}')")
        res["progress"] = (res["progress"].get("lessons") or {}).get("keputusan")

        # navigasi berulang: tidak boleh ada loop, kanvas, style, atau kait uji yang tertinggal
        for _ in range(6):
            page.evaluate("() => { location.hash = '#/' }")
            page.wait_for_timeout(250)
            page.evaluate("() => { location.hash = '#/pelajaran/keputusan' }")
            page.wait_for_timeout(500)
        page.wait_for_timeout(1500)
        res["afterNav"] = {
            "loops": hook()["activeLoops"],
            "canvases": page.evaluate("() => document.querySelectorAll('canvas').length"),
            "styleTags": page.evaluate("() => document.querySelectorAll('style[data-lesson]').length"),
            "stepIndex": hook()["stepIndex"],
            "hook": page.evaluate("() => typeof window.__keputusan"),
        }
        page.evaluate("() => { location.hash = '#/' }")
        page.wait_for_timeout(500)
        res["home"] = {"loops": hook()["activeLoops"], "styleTags": page.evaluate("() => document.querySelectorAll('style[data-lesson]').length"), "hook": page.evaluate("() => typeof window.__keputusan")}
        browser.close()
    print(json.dumps(res, indent=2, ensure_ascii=False))
    cm = res["counterMax"]
    ok = (all(res.get(k) is not None for k in ("red-stop", "yield-ped", "yellow-decision", "overtake"))
          and not res["errors"] and cm.get("redRuns", 0) == 0 and cm.get("pedContacts", 0) == 0 and cm.get("clamps", 0) == 0
          and res["home"]["hook"] == "undefined" and res["home"]["loops"] == res["homeBaselineLoops"]
          and res["afterNav"]["loops"] == 1 and res["afterNav"]["canvases"] == 1 and res["afterNav"]["styleTags"] == 1
          and not res["smallTargets"])
    print("LULUS" if ok else "GAGAL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
