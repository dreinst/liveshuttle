"""QA independen pelajaran Pengambilan Keputusan (Jalan Kawi, Malang), lewat UI seperti pelajar.

Pemakaian: python3 tests/keputusan_indep_qa.py [--mobile] [--port 8247]
Memeriksa: tugas tidak selesai sendiri, keempat tugas lewat klik/tombol keyboard (P dan A), permintaan
pejalan kaki yang ditunda karena mobil sudah terlalu dekat, kedua cabang dilema kuning,
Jeda/Ulangi/kecepatan, maju mundur langkah, ringkasan, masuk keluar 5 kali (loop, kanvas, style,
kait uji, dan listener keyboard tidak bocor), penghitung perisai tetap 0, dan konsol bersih.
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
    res = {"console": [], "fail": []}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=CHROME, headless=True)
        if MOBILE:
            bctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        else:
            bctx = browser.new_context(viewport={"width": 1366, "height": 900})
        page = bctx.new_page()
        page.on("console", lambda m: res["console"].append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: res["console"].append(f"pageerror: {e}"))

        def hook():
            return page.evaluate("() => JSON.parse(JSON.stringify(window.__simotonom || {}))")

        def status():
            return page.locator(".sim-status").inner_text()

        def readout(label):
            return page.locator(".lesson-keputusan .readout", has=page.locator(".readout-label", has_text=re.compile("^" + label + "$"))).first.locator(".readout-value").inner_text()

        def fail(msg):
            res["fail"].append(msg)

        def tap(loc):
            loc.scroll_into_view_if_needed()
            if MOBILE:
                loc.tap()
            else:
                loc.click()

        def seg(text):
            tap(page.locator(".lesson-keputusan .ctl-group .seg-btn", has_text=re.compile("^" + text + "$")).first)

        def btn(text):
            tap(page.locator(".lesson-keputusan .ctl-group .btn", has_text=text).first)

        def go_step(i):
            page.locator(f'.step-dot[data-go="{i}"]').first.dispatch_event("click")
            page.wait_for_timeout(350)

        def speed(label):
            page.locator(".speed-wrap .seg-btn", has_text=label).first.dispatch_event("click")

        def done():
            return hook().get("completedTasks", [])

        def wait_task(task, timeout):
            t0 = time.time()
            while time.time() - t0 < timeout:
                if task in done():
                    return round(time.time() - t0, 1)
                page.wait_for_timeout(200)
            return None

        def wait_until(fn, timeout, every=100):
            t0 = time.time()
            while time.time() - t0 < timeout:
                v = fn()
                if v:
                    return v
                page.wait_for_timeout(every)
            return None

        def shot(name, full=False, selector=None):
            path = SHOTS + f"indep-{TAG}-{name}.png"
            if selector:
                page.locator(selector).first.screenshot(path=path)
            else:
                page.screenshot(path=path, full_page=full)

        def top():
            page.evaluate("() => window.scrollTo(0, 0)")
            page.wait_for_timeout(150)

        def log_items():
            return page.locator(".lesson-keputusan .kp-log li").all_inner_texts()

        def boot(route):
            for _ in range(4):
                page.goto(BASE + route, wait_until="load")
                try:
                    page.wait_for_function("() => window.__simotonom && (window.__simotonom.routeName !== 'lesson' || window.__simotonom.lessonStatus === 'ready')", timeout=8000)
                    return
                except Exception:
                    res["bootRetries"] = res.get("bootRetries", 0) + 1
            raise RuntimeError("gagal memuat")

        boot("#/")
        page.evaluate("() => localStorage.clear()")
        boot("#/pelajaran/keputusan")
        page.wait_for_timeout(800)

        # ---------- 1. tidak ada tugas yang selesai sendiri ----------
        speed("2x")
        idle = {}
        for i in range(4):
            go_step(i)
            page.wait_for_timeout(9000)  # 18 detik simulasi tanpa menyentuh apa pun
            idle[i] = done()
        res["idleCompleted"] = idle
        if any(idle.values()):
            fail(f"tugas selesai tanpa aksi: {idle}")

        # ---------- 2. maju mundur semua langkah ----------
        for i in [4, 3, 2, 1, 0, 4, 0, 2]:
            go_step(i)
        page.locator(".step-nav .btn-primary").dispatch_event("click")
        page.wait_for_timeout(300)
        page.locator(".step-nav .btn-secondary").dispatch_event("click")
        page.wait_for_timeout(300)
        res["afterNav"] = hook()["stepIndex"]

        # ---------- 3. tugas langkah 1: lampu merah ----------
        go_step(0)
        page.wait_for_timeout(1200)
        seg("Paksa merah")
        page.wait_for_timeout(1500)
        top()
        shot("1-kuning-jauh")
        res["red-stop"] = wait_task("red-stop", 60)
        top()
        shot("1-berhenti")
        res["status1"] = status()
        res["log1"] = log_items()[:6]
        if res["red-stop"] is None:
            fail("red-stop tidak selesai")

        # ---------- 4. tugas langkah 2: pejalan kaki lewat tombol keyboard P (desktop) ----------
        go_step(1)
        # pelajar membaca teks dulu: tekan P saat mobil sudah melewati zebra cross (2x). Permintaan
        # harus ditunda dengan penjelasan, lalu pejalan kaki muncul saat mobil datang lagi dari awal ruas.
        page.wait_for_timeout(6500)
        if MOBILE:
            btn("Munculkan pejalan kaki")
        else:
            page.locator("body").click(position={"x": 5, "y": 300})
            page.keyboard.press("p")
        page.wait_for_timeout(400)
        res["pedQueuedNote"] = [t for t in log_items() if "muncul saat mobil datang lagi" in t]
        if len(res["pedQueuedNote"]) != 1:
            fail(f"permintaan pejalan kaki yang terlambat tidak dijelaskan: {log_items()[:3]}")
        spawned = wait_until(lambda: [t for t in log_items() if "muncul di tepi zebra cross" in t], 40)
        res["pedLogAfterSpawn"] = spawned or []
        if len(res["pedLogAfterSpawn"]) != 1:
            fail(f"P/tombol memunculkan {len(res['pedLogAfterSpawn'])} pejalan kaki, harusnya 1")
        page.wait_for_timeout(1200)
        top()
        shot("2-pejalan-jauh")
        seen = wait_until(lambda: "sedang menyeberang" in status() or "Mobil berhenti dan mempersilakan" in status(), 60)
        page.wait_for_timeout(300)
        top()
        shot("2-pejalan")
        res["status2"] = status()
        res["yield-ped"] = wait_task("yield-ped", 60)
        if res["yield-ped"] is None:
            fail("yield-ped tidak selesai")

        # ---------- 5. tugas langkah 3: dilema kuning, cabang BERHENTI ----------
        go_step(2)
        d = wait_until(lambda: (lambda x: x if x is not None and x < 55 else None)(num(readout("Ke garis henti"))), 40, 40)
        seg("Paksa merah")
        res["yellowPressAt"] = d
        page.wait_for_timeout(700)
        top()
        shot("3-kuning-berhenti")
        res["yellow-decision"] = wait_task("yellow-decision", 30)
        if res["yellow-decision"] is None:
            fail("yellow-decision tidak selesai")
        grp = page.locator(".lesson-keputusan .ctl-group", has_text="Dilema lampu kuning").first
        grp.scroll_into_view_if_needed()
        page.wait_for_timeout(300)
        grp.screenshot(path=SHOTS + f"indep-{TAG}-3-panel-berhenti.png")
        res["yellowStop"] = grp.inner_text()
        if "BERHENTI" not in res["yellowStop"]:
            fail("cabang berhenti tidak tampil")

        # cabang TERUS: Ulangi, tunggu dekat, lalu Paksa merah
        seg("Paksa hijau")
        page.locator('[data-act="reset"]').dispatch_event("click")
        page.wait_for_timeout(300)
        d2 = wait_until(lambda: (lambda x: x if x is not None and x < 16 else None)(num(readout("Ke garis henti"))), 40, 30)
        seg("Paksa merah")
        res["yellowGoPressAt"] = d2
        page.wait_for_timeout(600)
        top()
        shot("3-kuning-terus")
        wait_until(lambda: "sebelum lampu merah" in grp.inner_text() or "sudah merah" in grp.inner_text(), 20)
        grp.scroll_into_view_if_needed()
        grp.screenshot(path=SHOTS + f"indep-{TAG}-3-panel-terus.png")
        res["yellowGo"] = grp.inner_text()
        if "TERUS" not in res["yellowGo"]:
            fail("cabang terus tidak tampil")

        # ---------- 6. tugas langkah 4: angkot ngetem lewat tombol A (desktop) ----------
        go_step(3)
        page.wait_for_timeout(500)
        if MOBILE:
            btn("Taruh angkot ngetem")
        else:
            page.locator("body").click(position={"x": 5, "y": 300})
            page.keyboard.press("a")
        res["observeSeen"] = bool(wait_until(lambda: "mengamati apakah" in status(), 60, 50))
        res["statusObserve"] = status()
        res["waitSeen"] = bool(wait_until(lambda: "MENUNGGU CELAH" in status(), 60))
        seg("Padat")
        page.wait_for_timeout(800)
        top()
        shot("4-celah")
        res["status4a"] = status()
        res["gapReadout4a"] = readout("Kendaraan lawan tiba")
        inz = wait_until(lambda: "zona salip" in status(), 25, 50)
        if inz:
            top()
            shot("4-celah-zona")
            res["statusInZone"] = status()
            res["gapReadoutInZone"] = readout("Kendaraan lawan tiba")
        res["salipSeen"] = bool(wait_until(lambda: "MENYALIP" in status(), 90))
        page.wait_for_timeout(900)
        top()
        shot("4-menyalip")
        res["overtake"] = wait_task("overtake", 60)
        if res["overtake"] is None:
            fail("overtake tidak selesai")
        page.locator(".lesson-keputusan .kp-log-group").first.scroll_into_view_if_needed()
        page.wait_for_timeout(300)
        page.locator(".lesson-keputusan .kp-log-group").first.screenshot(path=SHOTS + f"indep-{TAG}-4-log.png")
        res["log4"] = log_items()[:8]

        # ---------- 7. Jeda, kecepatan, Ulangi (langkah 5, lampu otomatis) ----------
        go_step(4)
        speed("1x")
        page.wait_for_timeout(1500)

        def left():
            return num(readout("Berganti dalam"))

        page.locator('[data-act="pause"]').dispatch_event("click")
        page.wait_for_timeout(300)
        a = left()
        page.wait_for_timeout(1500)
        b = left()
        res["pause"] = {"a": a, "b": b, "paused": hook()["paused"]}
        if a != b or not hook()["paused"]:
            fail(f"jeda tidak menghentikan waktu {res['pause']}")
        top()
        shot("5-dijeda")
        page.locator('[data-act="pause"]').dispatch_event("click")
        page.wait_for_timeout(200)
        rates = {}
        for lab, factor in [("0,5x", 0.5), ("1x", 1), ("2x", 2)]:
            speed(lab)
            page.wait_for_timeout(300)
            wait_until(lambda: (left() or 0) > 4, 20)
            x0, t0 = left(), time.time()
            page.wait_for_timeout(1500)
            x1, t1 = left(), time.time()
            rates[lab] = round((x0 - x1) / (t1 - t0), 2) if x0 is not None and x1 is not None else None
        res["speedRates"] = rates
        for lab, f in [("0,5x", 0.5), ("1x", 1), ("2x", 2)]:
            r = rates.get(lab)
            if r is None or abs(r - f) > 0.25 * f + 0.1:
                fail(f"kecepatan {lab} laju {r}")
        speed("1x")
        page.wait_for_timeout(6000)
        page.locator('[data-act="reset"]').dispatch_event("click")
        page.wait_for_timeout(400)
        res["afterReset"] = {"left": left(), "log": log_items()[:2], "hook": {k: hook()[k] for k in ("paused", "activeLoops")}}
        top()
        shot("5-semua")
        page.wait_for_timeout(4000)
        top()
        shot("5-semua-2")

        # ---------- 8. ringkasan ----------
        page.locator('.step-dot[data-go="5"]').first.dispatch_event("click")
        page.wait_for_timeout(600)
        top()
        shot("6-ringkasan", full=True)
        res["summary"] = page.locator(".step-card").first.inner_text()[:400]
        res["progress"] = page.evaluate("() => localStorage.getItem('liveshuttle.progress.v1')")
        res["shield"] = page.evaluate("() => window.__keputusan && window.__keputusan.counters")
        if not res["shield"] or res["shield"]["redRuns"] or res["shield"]["pedContacts"] or res["shield"]["clamps"]:
            fail(f"penghitung perisai tidak 0: {res['shield']}")

        # ---------- 9. masuk keluar 5 kali ----------
        for _ in range(5):
            page.evaluate("() => { location.hash = '#/'; }")
            page.wait_for_timeout(500)
            page.keyboard.press("p")
            page.keyboard.press("a")
            res.setdefault("hookOnHome", []).append(page.evaluate("() => typeof window.__keputusan"))
            page.evaluate("() => { location.hash = '#/pelajaran/keputusan'; }")
            page.wait_for_function("() => window.__simotonom.lessonStatus === 'ready'", timeout=8000)
            page.wait_for_timeout(500)
        h = hook()
        res["leak"] = {
            "activeLoops": h["activeLoops"],
            "canvases": page.evaluate("() => document.querySelectorAll('canvas').length"),
            "styles": page.evaluate("() => document.querySelectorAll('style[data-lesson]').length"),
        }
        go_step(1)
        page.wait_for_timeout(300)
        page.locator("body").click(position={"x": 5, "y": 300})
        page.keyboard.press("p")
        page.wait_for_timeout(400)
        res["leak"]["pedsAfterOneP"] = len([t for t in log_items() if "muncul di tepi zebra cross" in t])
        if res["leak"]["activeLoops"] != 1 or res["leak"]["canvases"] != 1 or res["leak"]["styles"] != 1 or res["leak"]["pedsAfterOneP"] != 1:
            fail(f"bocor: {res['leak']}")
        if any(h != "undefined" for h in res["hookOnHome"]):
            fail(f"kait uji tertinggal di beranda: {res['hookOnHome']}")
        page.evaluate("() => { location.hash = '#/'; }")
        page.wait_for_timeout(600)
        res["homeStyles"] = page.evaluate("() => document.querySelectorAll('style[data-lesson]').length")

        if res["console"]:
            fail("pesan konsol ada")
        browser.close()
    print(json.dumps(res, indent=1, ensure_ascii=False))
    sys.exit(1 if res["fail"] else 0)


if __name__ == "__main__":
    main()
