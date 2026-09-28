"""Serangan lewat UI terhadap aturan keselamatan pelajaran Pengambilan Keputusan (Jalan Kawi, Malang).

Seperti pelajar yang iseng: kecepatan simulasi 2x, kecepatan target 50 km/jam, lampu Paksa merah,
Paksa hijau, dan Otomatis diganti-ganti cepat, tombol pejalan kaki (klik dan tombol P) ditekan terus,
angkot ngetem ditaruh dan disuruh pergi, kepadatan diganti, dan Ulangi ditekan sesekali. Selama itu
window.__keputusan dibaca berkala: terobos lampu merah, kontak dengan pejalan kaki, dan penjepitan
posisi harus tetap 0 (penghitung dijumlahkan sebelum setiap Ulangi). Konsol harus bersih.

Pemakaian: python3 tests/keputusan_safety_ui.py [--mobile] [--port 8247] [--seconds 90]
"""
import json
import random
import sys
import time

from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
arg = lambda k, d: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
PORT = arg("--port", "8247")
SECONDS = float(arg("--seconds", "90"))
MOBILE = "--mobile" in sys.argv
TAG = "m" if MOBILE else "d"
SHOTS = "/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/keputusan-malang/"


def main():
    res = {"errors": [], "actions": {}, "samples": 0, "total": {"redRuns": 0, "pedContacts": 0, "clamps": 0, "otherCollisions": 0}, "maxEgoKmh": 0, "wraps": 0}
    rnd = random.Random(20260928)
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=CHROME, headless=True)
        if MOBILE:
            ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        else:
            ctx = browser.new_context(viewport={"width": 1366, "height": 900})
        page = ctx.new_page()
        page.on("console", lambda m: res["errors"].append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: res["errors"].append(f"pageerror: {e}"))
        page.goto(f"http://127.0.0.1:{PORT}/#/pelajaran/keputusan", wait_until="load")
        page.wait_for_function("() => window.__simotonom && window.__simotonom.lessonStatus === 'ready'", timeout=20000)
        page.locator('.step-dot[data-go="4"]').dispatch_event("click")
        page.wait_for_timeout(300)
        page.locator(".speed-wrap .seg-btn", has_text="2x").first.click()
        # kecepatan target paling tinggi lewat slider
        page.evaluate("""() => { const s = document.querySelector('.lesson-keputusan input[type=range]'); s.value = s.max; s.dispatchEvent(new Event('input', { bubbles: true })); }""")
        kp = lambda: page.evaluate("() => JSON.parse(JSON.stringify(window.__keputusan))")
        seg = {}

        def fold(s):
            for k in res["total"]:
                seg[k] = max(seg.get(k, 0), s["counters"][k])

        def flush():
            for k in res["total"]:
                res["total"][k] += seg.get(k, 0)
            seg.clear()

        def act(name, fn):
            res["actions"][name] = res["actions"].get(name, 0) + 1
            fn()

        def tap(loc):
            loc.scroll_into_view_if_needed()
            if MOBILE:
                loc.tap()
            else:
                loc.click()

        t_end = time.time() + SECONDS
        shots = 0
        while time.time() < t_end:
            r = rnd.random()
            if r < 0.28:
                label = rnd.choice(["Paksa merah", "Paksa hijau", "Otomatis"])
                act("lampu", lambda: tap(page.locator(".lesson-keputusan .seg-btn", has_text=label).first))
            elif r < 0.55:
                if MOBILE or rnd.random() < 0.5:
                    act("pejalan-klik", lambda: tap(page.locator(".lesson-keputusan .btn", has_text="Munculkan pejalan kaki").first))
                else:
                    act("pejalan-P", lambda: page.keyboard.press("p"))
            elif r < 0.67:
                act("angkot", lambda: tap(page.locator(".lesson-keputusan .kp-scen-row .btn").nth(1)))
            elif r < 0.8:
                d = rnd.choice(["Kosong", "Sepi", "Sedang", "Padat"])
                act("kepadatan", lambda: tap(page.locator(".lesson-keputusan .seg-btn", has_text=d).first))
            elif r < 0.84:
                s = kp()
                fold(s)
                flush()
                act("ulangi", lambda: page.locator('[data-act="reset"]').click())
            page.wait_for_timeout(rnd.randint(80, 900))
            s = kp()
            res["samples"] += 1
            fold(s)
            res["maxEgoKmh"] = max(res["maxEgoKmh"], round(s["egoSpeed"] * 3.6, 1))
            res["wraps"] = max(res["wraps"], s["wraps"])
            if shots < 3 and any(p["state"] == "menyeberang" for p in s["peds"]):
                page.evaluate("() => window.scrollTo(0, 0)")
                page.locator(".stage").first.screenshot(path=SHOTS + f"serang-{TAG}-{shots}.png")
                shots += 1
        fold(kp())
        flush()
        res["final"] = {k: kp()[k] for k in ("state", "light", "mode", "density", "pendingPed", "angkot")}
        browser.close()
    print(json.dumps(res, indent=1, ensure_ascii=False))
    t = res["total"]
    ok = t["redRuns"] == 0 and t["pedContacts"] == 0 and t["clamps"] == 0 and t["otherCollisions"] == 0 and not res["errors"] and res["maxEgoKmh"] <= 50.01
    print("LULUS" if ok else "GAGAL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
