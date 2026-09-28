"""Perjalanan pelajar lewat UI, desktop dan ponsel: beranda, Mulai belajar, kuis sampai lulus (progres),
atur ulang progres, Shuttle 3D Panduan ke Jelajah lewat tombol, navigasi kepala, mundur dan maju,
lalu muat ulang di tautan dalam. Konsol harus bersih.

Pemakaian: python3 tests/qa-akhir_journey.py [PORT]   (server: python3 tests/serve.py PORT)
"""
import sys

from playwright.sync_api import sync_playwright

PORT = sys.argv[1] if len(sys.argv) > 1 else "8250"
BASE = f"http://127.0.0.1:{PORT}/"
CHROME = "/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
fails = []


def check(name, ok, detail=""):
    print(("OK   " if ok else "GAGAL"), name, detail if not ok else "")
    if not ok:
        fails.append(name)


def journey(browser, mobile):
    ctx = browser.new_context(**({"viewport": {"width": 390, "height": 844}, "is_mobile": True, "has_touch": True, "device_scale_factor": 2} if mobile else {"viewport": {"width": 1366, "height": 900}}))
    page = ctx.new_page()
    log = []
    page.on("console", lambda m: m.type in ("error", "warning") and "GPU stall" not in m.text and log.append(m.text))
    page.on("pageerror", lambda e: log.append(str(e)))
    hook = lambda: page.evaluate("() => window.__simotonom")
    tag = "ponsel" if mobile else "desktop"

    page.goto(BASE + "#/")
    page.evaluate("() => localStorage.clear()")
    page.reload()
    page.locator("[data-el='start']").click()
    page.wait_for_function("() => window.__simotonom.lessonStatus === 'ready'")
    check(f"{tag}: Mulai belajar membuka pelajaran 1", hook()["route"] == "#/pelajaran/level-otomasi")

    # kuis: jawab semua benar lewat klik, dua tugas selesai dan progres tercatat
    page.goto(BASE + "#/pelajaran/kuis")
    page.wait_for_function("() => window.__simotonom.lessonStatus === 'ready'")
    answers = page.evaluate("async () => { const m = await import('/js/lessons/kuis/questions.js'); return Object.fromEntries(m.QUESTIONS.map((q) => [q.id, q.answer])); }")
    n = page.locator(".kz-track .kz-seg").count()
    for i in range(n):
        page.locator(f".kz-opt[data-opt='{answers[page.get_attribute('.kz-play', 'data-qid')]}']").click()
        page.locator(".kz-next").click()
    page.wait_for_selector(".kz-result:not([hidden])")
    check(f"{tag}: kuis skor 100", page.inner_text(".kz-ring-num").strip() == "100", page.inner_text(".kz-ring-num"))
    check(f"{tag}: dua tugas kuis selesai", sorted(hook()["completedTasks"]) == ["lulus", "selesai"], str(hook()["completedTasks"]))

    page.goto(BASE + "#/")
    page.wait_for_timeout(300)
    check(f"{tag}: progres beranda 1 dari 10", "1" == page.locator(".header-progress-text strong").first.inner_text(), page.locator(".header-progress").first.inner_text())
    page.locator("[data-el='reset'] [data-act='ask']").click()
    page.locator("[data-el='reset'] [data-act='yes']").click()
    page.wait_for_timeout(200)
    check(f"{tag}: atur ulang progres", page.evaluate("() => { const p = JSON.parse(localStorage.getItem('liveshuttle.progress.v1') || '{}'); return !Object.values(p.lessons || {}).some((l) => (l.tasks || []).length); }"))

    # Shuttle 3D lewat navigasi kepala, lalu Panduan ke Jelajah lewat tab
    if mobile:
        page.locator(".menu-toggle").click()
    page.get_by_role("link", name="Shuttle 3D").first.click()
    page.wait_for_function("() => window.__sim3d && window.__sim3d.ready", timeout=120000)
    check(f"{tag}: nav Shuttle 3D ke panduan", page.evaluate("() => location.hash") == "#/shuttle-3d/panduan")
    canvas = page.evaluate_handle("() => document.querySelector('.s3d canvas')")
    page.locator(".s3d-modes button", has_text="Jelajah").first.click()
    page.wait_for_timeout(400)
    same = page.evaluate("(c) => document.querySelector('.s3d canvas') === c", canvas)
    check(f"{tag}: tab Jelajah tanpa pasang ulang", page.evaluate("() => location.hash") == "#/shuttle-3d/jelajah" and same)

    # mundur dan maju
    page.go_back()
    page.wait_for_timeout(600)
    h1 = page.evaluate("() => location.hash")
    page.go_forward()
    page.wait_for_timeout(1500)
    h2 = page.evaluate("() => location.hash")
    check(f"{tag}: mundur lalu maju", h1 in ("#/", "#/shuttle-3d/panduan") and h2.startswith("#/shuttle-3d"), f"{h1} {h2}")

    # muat ulang di tautan dalam
    for deep in ("#/pelajaran/rute", "#/shuttle-3d/jelajah"):
        page.goto(BASE + deep)
        page.reload()
        if deep.startswith("#/shuttle"):
            page.wait_for_function("() => window.__sim3d && window.__sim3d.ready && window.__sim3d.mode === 'jelajah'", timeout=120000)
            ok = True
        else:
            page.wait_for_function("() => window.__simotonom.lessonStatus === 'ready'")
            ok = hook()["lessonId"] == "rute"
        check(f"{tag}: muat ulang {deep}", ok)
    page.goto(BASE + "#/")
    page.wait_for_timeout(500)
    check(f"{tag}: 3D dibersihkan di beranda", page.evaluate("() => !document.querySelector('.s3d') && !window.__sim3d"))
    check(f"{tag}: konsol bersih", not log, str(log[:5]))
    ctx.close()


with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, headless=True, args=["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"])
    for mobile in (False, True):
        journey(b, mobile)
    b.close()
print(f"\n{len(fails)} gagal")
sys.exit(1 if fails else 0)
