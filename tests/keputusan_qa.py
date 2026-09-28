"""QA pelajaran Pengambilan Keputusan lewat UI, seperti pelajar sungguhan.

Menyelesaikan keempat tugas lewat tombol, memeriksa jeda, ulangi, kecepatan, ringkasan,
navigasi berulang (kebocoran loop), lalu menyimpan tangkapan layar.
Pemakaian: python3 tests/keputusan_qa.py [--mobile] [--port 8117]
"""
import json
import re
import sys
import time

from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
PORT = sys.argv[sys.argv.index("--port") + 1] if "--port" in sys.argv else "8117"
BASE = f"http://127.0.0.1:{PORT}/"
SHOTS = "/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/keputusan/"
MOBILE = "--mobile" in sys.argv
TAG = "m" if MOBILE else "d"


def num(text):
    m = re.search(r"-?[\d.]+(?:,\d+)?", text or "")
    if not m:
        return None
    return float(m.group(0).replace(".", "").replace(",", "."))


def main():
    res = {"errors": []}
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
        status = lambda: page.locator(".sim-status").inner_text()

        def readout(label):
            return page.locator(".readout", has_text=label).first.locator(".readout-value").inner_text()

        def click(sel_text, cls=".seg-btn"):
            loc = page.locator(cls, has_text=sel_text).first
            loc.scroll_into_view_if_needed()
            loc.click()

        def wait_task(task, timeout):
            t0 = time.time()
            while time.time() - t0 < timeout:
                if task in hook()["completedTasks"]:
                    return round(time.time() - t0, 1)
                page.wait_for_timeout(200)
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

        def next_step():
            page.locator(".step-nav .btn-primary").dispatch_event("click")
            page.wait_for_timeout(300)

        def boot(route):
            # http.server kadang memutus koneksi saat banyak modul dimuat sekaligus; muat ulang bila perlu
            for attempt in range(4):
                before = len(res["errors"])
                page.goto(BASE + route, wait_until="load")
                try:
                    page.wait_for_function("() => window.__simotonom && (window.__simotonom.routeName !== 'lesson' || window.__simotonom.lessonStatus === 'ready')", timeout=8000)
                    return
                except Exception:
                    res["retries"] = res.get("retries", 0) + 1
                    res.setdefault("retryErrors", []).extend(res["errors"][before:])
                    del res["errors"][before:]
            raise RuntimeError("halaman gagal dimuat")

        boot("#/")
        page.evaluate("() => localStorage.clear()")
        boot("#/pelajaran/keputusan")
        page.wait_for_timeout(1000)
        h = hook()
        res["start"] = {"step": h["stepIndex"], "status": h["lessonStatus"], "loops": h["activeLoops"]}
        click("2x", ".speed-wrap .seg-btn")

        # ---------- langkah 1: lampu merah ----------
        page.wait_for_timeout(1500)
        click("Paksa merah")
        res["red-stop"] = wait_task("red-stop", 60)
        top()
        shot("1-lampu-merah")
        res["status1"] = status()
        next_step()

        # ---------- langkah 2: pejalan kaki ----------
        click("Munculkan pejalan kaki", ".btn")
        res["ped-crossing-seen"] = wait_status("sedang menyeberang", 40)
        top()
        shot("2-pejalan")
        res["yield-ped"] = wait_task("yield-ped", 40)
        next_step()

        # ---------- langkah 3: lampu kuning (tekan saat dekat) ----------
        t0 = time.time()
        while time.time() - t0 < 40:
            d = num(readout("Ke garis henti"))
            if d is not None and d < 22:
                break
            page.wait_for_timeout(50)
        click("Paksa merah")
        page.wait_for_timeout(500)
        top()
        shot("3-kuning-canvas")
        res["yellow-decision"] = wait_task("yellow-decision", 30)
        page.locator(".ctl-group", has_text="Dilema lampu kuning").first.scroll_into_view_if_needed()
        page.wait_for_timeout(300)
        shot("3-kuning-panel", selector=".ctl-group:has-text('Dilema lampu kuning')")
        res["yellowPanel"] = page.locator(".ctl-group", has_text="Dilema lampu kuning").first.inner_text()
        next_step()

        # ---------- langkah 4: mobil mogok ----------
        click("Taruh mobil mogok", ".btn")
        res["waiting-seen"] = wait_status("MENUNGGU CELAH", 60)
        page.wait_for_timeout(600)
        top()
        shot("4-celah")
        res["overtaking-seen"] = wait_status("MENYALIP", 90)
        page.wait_for_timeout(1200)
        top()
        shot("4-menyalip")
        res["overtake"] = wait_task("overtake", 60)
        page.locator(".kp-log").first.scroll_into_view_if_needed()
        page.wait_for_timeout(300)
        shot("4-log", selector=".kp-log-group")
        res["logTop"] = page.locator(".kp-log li").first.inner_text()
        res["logCount"] = page.locator(".kp-log li").count()
        next_step()

        # ---------- langkah 5: semua berjalan ----------
        page.wait_for_timeout(4000)
        top()
        shot("5-semua", full=True)

        # jeda, kecepatan, ulangi
        page.locator('[data-act="pause"]').click()
        page.wait_for_timeout(300)
        res["paused"] = hook()["paused"]
        shot("5-dijeda")
        page.locator('[data-act="pause"]').click()
        click("0,5x", ".speed-wrap .seg-btn")
        res["speed05"] = hook()["speed"]
        click("1x", ".speed-wrap .seg-btn")
        page.locator('[data-act="reset"]').click()
        page.wait_for_timeout(400)
        res["afterReset"] = {k: hook()[k] for k in ("paused", "lessonStatus", "activeLoops")}

        # ringkasan
        next_step()
        res["summaryStep"] = hook()["stepIndex"]
        top()
        shot("6-ringkasan")
        res["progress"] = page.evaluate("() => JSON.parse(localStorage.getItem('simotonom.progress.v1')).lessons.keputusan")

        # navigasi berulang: tidak boleh ada loop, kanvas, atau style yang tertinggal
        for _ in range(6):
            page.evaluate("() => { location.hash = '#/' }")
            page.wait_for_timeout(250)
            page.evaluate("() => { location.hash = '#/pelajaran/keputusan' }")
            page.wait_for_timeout(400)
        res["afterNav"] = {
            "loops": hook()["activeLoops"],
            "canvases": page.evaluate("() => document.querySelectorAll('canvas').length"),
            "styleTags": page.evaluate("() => document.querySelectorAll('style[data-lesson]').length"),
            "stepIndex": hook()["stepIndex"],
        }
        page.evaluate("() => { location.hash = '#/' }")
        page.wait_for_timeout(400)
        res["home"] = {"loops": hook()["activeLoops"], "styleTags": page.evaluate("() => document.querySelectorAll('style[data-lesson]').length")}
        browser.close()
    print(json.dumps(res, indent=2, ensure_ascii=False))
    ok = all(res.get(k) is not None for k in ("red-stop", "yield-ped", "yellow-decision", "overtake")) and not res["errors"]
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
