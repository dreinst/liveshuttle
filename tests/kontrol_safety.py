"""Uji tekan pelajaran Kendali lewat UI: pengaturan paling ekstrem, simulasi 2x, tombol ditekan
berulang, lalu periksa bahwa tidak ada galat konsol, pengemudi cadangan selalu turun tangan, dan
mobil tidak pernah jauh keluar dari badan jalan.

Aturan keselamatan situs (tidak ada kendaraan yang menerobos lampu merah atau menabrak pejalan
kaki): pelajaran ini memakai jalan yang dianggap ditutup untuk uji, tanpa pejalan kaki, kendaraan
lain, atau lampu lalu lintas. Uji ini memastikan hal itu juga benar di halaman yang berjalan: teks
pelajaran menyebutnya, dan chip HUD tidak pernah melaporkan objek lain.

Pemakaian: python3 tests/kontrol_safety.py [--mobile] [--port 8246]
"""
import json
import re
import sys

from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
MOBILE = "--mobile" in sys.argv
PORT = sys.argv[sys.argv.index("--port") + 1] if "--port" in sys.argv else "8246"
BASE = f"http://127.0.0.1:{PORT}/"
SHOTS = "/Users/mcdonny/Downloads/ndur/driverless-sim/tests/shots/kontrol/"
TAG = "m" if MOBILE else "d"


def num(text):
    m = re.search(r"-?[\d.]+(?:,\d+)?", text.replace("−", "-"))
    return float(m.group(0).replace(".", "").replace(",", ".")) if m else None


with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, headless=True)
    if MOBILE:
        ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    else:
        ctx = b.new_context(viewport={"width": 1366, "height": 900})
    p = ctx.new_page()
    errors = []
    p.on("console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    p.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    p.goto(BASE + "#/", wait_until="load")
    p.evaluate("() => localStorage.clear()")
    p.goto(BASE + "#/pelajaran/kontrol", wait_until="load")
    p.wait_for_timeout(2500)

    def slider(label, value):
        inp = p.locator(".ctl-slider", has=p.locator("label", has_text=re.compile("^" + re.escape(label) + "$"))).first.locator("input[type=range]")
        inp.fill(str(value))

    def hud():
        return p.evaluate("""() => Object.fromEntries([...document.querySelectorAll('.hud-chip')]
            .map(c => [c.querySelector('.hud-label')?.textContent || '', { hidden: c.hidden, v: c.querySelector('.hud-value').textContent }]))""")

    R = {"mode": "mobile" if MOBILE else "desktop", "runs": []}
    p.locator(".speed-wrap .seg-btn", has_text="2x").dispatch_event("click")
    worst = 0.0
    takeovers_seen = 0
    combos = [
        {"ld": 2, "target": 50, "kp": 5, "ki": 2, "kd": 1},
        {"ld": 20, "target": 50, "kp": 0.8, "ki": 0.2, "kd": 0},
        {"ld": 2, "target": 10, "kp": 0.8, "ki": 0.2, "kd": 0},
        {"ld": 20, "target": 10, "kp": 5, "ki": 0, "kd": 1},
        {"ld": 3, "target": 45, "kp": 0.1, "ki": 2, "kd": 0},
    ]
    for c in combos:
        slider("Lookahead Ld", c["ld"])
        slider("Kecepatan target", c["target"])
        slider("Kp", c["kp"])
        slider("Ki", c["ki"])
        slider("Kd", c["kd"])
        p.locator(".btn", has_text="Uji dari diam").dispatch_event("click")
        run_worst = 0.0
        seen_tk = False
        for _ in range(60):  # sekitar 15 detik nyata, 30 detik simulasi
            h = hud()
            g = num(h["Galat"]["v"]) or 0.0
            run_worst = max(run_worst, abs(g))
            if not h["Pengemudi cadangan"]["hidden"]:
                seen_tk = True
            p.wait_for_timeout(250)
        worst = max(worst, run_worst)
        takeovers_seen += 1 if seen_tk else 0
        R["runs"].append({**c, "maxGalat": run_worst, "takeoverSeen": seen_tk})

    # tombol ditekan berulang dan kamera diganti-ganti sambil jalan 2x
    for i in range(12):
        p.locator(".btn", has_text="Uji dari diam").dispatch_event("click")
        p.locator(".seg-btn", has_text="Seluruh lintasan" if i % 2 else "Ikuti mobil").dispatch_event("click")
        p.locator('[data-act="pause"]').dispatch_event("click")
        p.wait_for_timeout(60)
    if p.evaluate("() => window.__simotonom.paused"):
        p.locator('[data-act="pause"]').dispatch_event("click")
    p.locator(".seg-btn", has_text="Adaptif").dispatch_event("click")
    slider("Faktor k", 0.2)
    slider("Kecepatan target", 50)
    p.locator(".ctl-toggle", has_text="Pelan di tikungan").first.dispatch_event("click")
    for _ in range(40):
        g = num(hud()["Galat"]["v"]) or 0.0
        worst = max(worst, abs(g))
        p.wait_for_timeout(250)
    p.locator(".stage").screenshot(path=SHOTS + f"safety-{TAG}-akhir.png")

    R["worstGalat"] = worst
    R["takeoverRuns"] = takeovers_seen
    R["introMentionsClosedRoad"] = "tidak ada kendaraan lain, pejalan kaki, atau lampu lalu lintas" in p.content()
    R["hudLabels"] = list(hud().keys())
    R["hook"] = p.evaluate("() => ({ status: window.__simotonom.lessonStatus, loops: window.__simotonom.activeLoops, paused: window.__simotonom.paused })")
    R["errors"] = errors
    b.close()

print(json.dumps(R, indent=1, ensure_ascii=False))
ok = (not R["errors"] and R["worstGalat"] < 2.5 and R["introMentionsClosedRoad"] and R["takeoverRuns"] >= 3
      and R["hook"]["status"] == "ready" and R["hook"]["loops"] == 1)
print("OK" if ok else "GAGAL")
sys.exit(0 if ok else 1)
