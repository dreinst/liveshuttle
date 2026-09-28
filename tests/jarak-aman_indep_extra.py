"""QA mandiri tambahan pelajaran Jarak Aman: gerak dikurangi, muat ulang, teks langkah, ringkasan.

Pemakaian: python3 tests/jarak-aman_indep_extra.py [--port 8138]
"""
import json
import sys

from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
SHOTS = "/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/jarak-aman-qa/"
PORT = sys.argv[sys.argv.index("--port") + 1] if "--port" in sys.argv else "8138"
BASE = f"http://127.0.0.1:{PORT}/"
out = {}
errors = []

with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, headless=True)
    for mobile in (False, True):
        tag = "m" if mobile else "d"
        if mobile:
            c = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True, reduced_motion="reduce")
        else:
            c = b.new_context(viewport={"width": 1366, "height": 900}, reduced_motion="reduce")
        p = c.new_page()
        p.on("console", lambda m: errors.append(f"{tag} {m.type}: {m.text}") if m.type in ("error", "warning") else None)
        p.on("pageerror", lambda e: errors.append(f"{tag} pageerror: {e}"))
        p.goto(BASE + "#/", wait_until="load")
        p.evaluate("() => localStorage.clear()")
        p.goto(BASE + "#/pelajaran/jarak-aman", wait_until="load")
        p.wait_for_timeout(1200)
        p.locator('.step-dot[data-go="3"]').dispatch_event("click")
        p.wait_for_timeout(500)
        p.reload(wait_until="load")
        p.wait_for_timeout(1500)
        h = p.evaluate("() => JSON.parse(JSON.stringify(window.__simotonom))")
        aeb = p.locator(".lesson-jarak-aman .ctl-toggle[role=switch]").get_attribute("aria-checked")
        out[tag + "_reload"] = {"step": h["stepIndex"], "aebChecked": aeb, "meter": p.locator(".ja-mhead").inner_text()}
        # teks langkah 4 dan tugasnya
        card = p.locator(".step-card")
        card.evaluate("(e) => e.scrollIntoView({block: 'start'})")
        p.wait_for_timeout(200)
        card.screenshot(path=SHOTS + f"extra-{tag}-langkah4.png")
        # sisa 0 m: jarak 1,5 detik, rem mendadak, AEB mati
        p.evaluate("""() => { const n = [...document.querySelectorAll('.lesson-jarak-aman .ctl-slider')]
            .find(x => x.querySelector('label').textContent === 'Jarak waktu ACC'); const i = n.querySelector('input');
            i.value = 1.5; i.dispatchEvent(new Event('input', { bubbles: true })); }""")
        p.wait_for_timeout(2500)
        p.locator(".ja-scn .btn").first.dispatch_event("click")
        p.wait_for_function("() => !document.querySelector('.ja-banner').hidden", timeout=20000)
        p.wait_for_timeout(600)
        out[tag + "_edge"] = p.locator(".ja-banner").inner_text()
        p.evaluate("() => document.querySelector('.stage').scrollIntoView({block: 'start'})")
        p.locator(".stage").first.screenshot(path=SHOTS + f"extra-{tag}-tepi.png")
        # ringkasan
        p.locator('.step-dot[data-go="5"]').dispatch_event("click")
        p.wait_for_timeout(600)
        card = p.locator(".step-card")
        card.evaluate("(e) => e.scrollIntoView({block: 'start'})")
        card.screenshot(path=SHOTS + f"extra-{tag}-ringkasan.png")
        out[tag + "_summary_step"] = p.evaluate("() => window.__simotonom.stepIndex")
        c.close()
    b.close()
print(json.dumps(out, indent=1, ensure_ascii=False))
print("errors", errors)
sys.exit(1 if errors else 0)
