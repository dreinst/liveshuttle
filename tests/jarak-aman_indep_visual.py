"""Tangkapan layar kasus ekstrem pelajaran Jarak Aman (QA mandiri), untuk diperiksa dengan mata.

Pengaturan diubah lewat widget (event input pada slider, klik pada tombol), lalu panggung difoto
di tengah percobaan dan di akhir. Semua pesan konsol error/warning dicatat.

Pemakaian: python3 tests/jarak-aman_indep_visual.py [--mobile] [--port 8138]
"""
import json
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
errors = []
out = {}

CASES = [
    # nama, kmh, tau, jalan, reaksi, aeb, skenario, jeda tengah (detik nyata, None = tidak ada)
    ("ikut-120-3", 120, 3.0, "Kering", "Manusia", False, None, None),
    ("rem-120-3", 120, 3.0, "Kering", "Manusia", False, "rem mendadak", 2.0),
    ("rin-80-1-awal", 80, 1.0, "Basah", "Manusia", False, "Rintangan", 0.4),
    ("rin-120-05-licin", 120, 0.5, "Licin", "Manusia", True, "Rintangan", 1.6),
    ("rem-80-15-tepi", 80, 1.5, "Basah", "Manusia", False, "rem mendadak", None),
    ("rem-20-05", 20, 0.5, "Kering", "Sistem otomatis", True, "rem mendadak", None),
    ("rin-120-3-sistem", 120, 3.0, "Licin", "Sistem otomatis", True, "Rintangan", 2.5),
]

with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, headless=True)
    if MOBILE:
        c = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    else:
        c = b.new_context(viewport={"width": 1366, "height": 900}, device_scale_factor=1)
    p = c.new_page()
    p.on("console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    p.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    p.goto(BASE + "#/", wait_until="load")
    p.evaluate("() => localStorage.clear()")
    p.goto(BASE + "#/pelajaran/jarak-aman", wait_until="load")
    p.wait_for_timeout(1500)

    def set_slider(label, v):
        p.evaluate("""([lab, v]) => { const n = [...document.querySelectorAll('.lesson-jarak-aman .ctl-slider')]
            .find(x => x.querySelector('label').textContent === lab); const i = n.querySelector('input');
            i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); }""", [label, v])

    def click(loc):
        loc.evaluate("(e) => e.scrollIntoView({ block: 'center' })")
        loc.dispatch_event("click")

    def stage(name):
        p.evaluate("() => document.querySelector('.stage').scrollIntoView({block: 'start'})")
        p.wait_for_timeout(120)
        p.locator(".stage").first.screenshot(path=SHOTS + f"vis-{TAG}-{name}.png")

    def banner():
        bn = p.locator(".ja-banner")
        return None if bn.get_attribute("hidden") is not None else bn.inner_text()

    for name, kmh, tau, road, reac, aeb, sc, mid in CASES:
        set_slider("Kecepatan", kmh)
        set_slider("Jarak waktu ACC", tau)
        click(p.locator(".lesson-jarak-aman .controls .seg-btn", has_text=road).first)
        click(p.locator(".lesson-jarak-aman .controls .seg-btn", has_text=reac).first)
        sw = p.locator(".lesson-jarak-aman .ctl-toggle[role=switch]", has_text="AEB")
        if (sw.get_attribute("aria-checked") == "true") != aeb:
            click(sw)
        p.wait_for_timeout(3500)  # ACC menyesuaikan jarak
        if sc is None:
            stage(name)
            out[name] = {"status": p.locator(".sim-status").inner_text()}
            continue
        click(p.locator(".ja-scn .btn", has_text=sc))
        if mid is not None:
            p.wait_for_timeout(int(mid * 1000))
            p.locator('[data-act="pause"]').dispatch_event("click")
            p.wait_for_timeout(200)
            stage(name + "-tengah")
            p.locator('[data-act="pause"]').dispatch_event("click")
        t0 = time.time()
        while banner() is None and time.time() - t0 < 40:
            p.wait_for_timeout(100)
        p.wait_for_timeout(900)
        stage(name + "-akhir")
        out[name] = {"banner": banner(), "result": p.locator(".ja-result").inner_text()}
    p.locator(".ja-scn .btn").first.dispatch_event("click")
    p.wait_for_timeout(300)
    b.close()

print(json.dumps(out, indent=1, ensure_ascii=False))
print("errors", errors)
sys.exit(1 if errors else 0)
