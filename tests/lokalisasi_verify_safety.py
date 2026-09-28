"""Serangan aturan keselamatan Lokalisasi lewat UI (klik atau ketuk sungguhan).

Kemudi dengan estimasi GPS (sigma 5), odometri yang dibiarkan drift, fusi, dan peta, bergantian
cepat. Kecepatan 2x, Ulangi saat ada yang menyeberang, pindah langkah (mobil dipindah ke depan
zona), Jeda, dan penyeberang tambahan lewat kait uji tiap 1,2 detik. Penghitung harus tetap 0.
Pemakaian: python3 tests/lokalisasi_verify_safety.py [--mobile] [--seconds 150]
"""
import json
import random
import sys
import time

from lokalisasi_verify_util import (sync_playwright, launch, new_page, open_lesson, hook, lok, console, go_step, press,
                                    toggle, is_on, stage_shot, chips, status)

MOBILE = "--mobile" in sys.argv
SECONDS = float(sys.argv[sys.argv.index("--seconds") + 1]) if "--seconds" in sys.argv else (90 if MOBILE else 150)
random.seed(4)
R = {"viewport": "390x844" if MOBILE else "1366x900", "actions": {}, "samples": []}


def act(k):
    R["actions"][k] = R["actions"].get(k, 0) + 1


def set_slider(page, value):
    # slider GPS: geser dengan keyboard supaya memakai event input sungguhan
    s = page.locator('.ctl-slider input[type="range"]').first
    s.scroll_into_view_if_needed()
    s.focus()
    page.keyboard.press("End" if value >= 5 else "Home")


def seg(page, label):
    press(page, page.locator(".grp-steer .seg-btn", has_text=label).first)


with sync_playwright() as pw:
    br = launch(pw)
    page = new_page(br, MOBILE)
    open_lesson(page)
    press(page, page.locator(".speed-wrap .seg-btn", has_text="2x"))
    set_slider(page, 5)
    toggle(page, "Kemudikan dengan estimasi")
    t0 = time.time()
    last_spawn = 0
    shot = 0
    while time.time() - t0 < SECONDS:
        now = time.time() - t0
        if now - last_spawn > 1.2:
            page.evaluate("() => window.__lokalisasi && window.__lokalisasi.spawnPedestrian(Math.random() < 0.5)")
            last_spawn = now
        r = random.random()
        try:
            if r < 0.25:
                seg(page, random.choice(["GPS", "Odometri", "Fusi", "Peta"]))
                if not is_on(page, "Kemudikan dengan estimasi"):
                    toggle(page, "Kemudikan dengan estimasi")
                act("sel")
            elif r < 0.33:
                toggle(page, "Kemudikan dengan estimasi")
                act("steer")
            elif r < 0.43:
                st = lok(page)["state"]
                if any(c == "cross" for c in st["crossers"]) or random.random() < 0.3:
                    press(page, page.locator('[data-act="reset"]'))
                    act("reset")
            elif r < 0.5:
                go_step(page, random.choice([1, 1, 2, 0]))
                toggle(page, "GPS")
                set_slider(page, random.choice([0.5, 5]))
                toggle(page, "Kemudikan dengan estimasi")
                act("step")
            elif r < 0.55:
                press(page, page.locator('[data-act="pause"]'))
                page.wait_for_timeout(300)
                press(page, page.locator('[data-act="pause"]'))
                act("pause")
            elif r < 0.62:
                toggle(page, "Odometri dan IMU")
                act("odo")
        except Exception as e:  # tombol tertutup toast dan sejenisnya: catat, lanjutkan
            R.setdefault("uiErrors", []).append(str(e)[:120])
        page.wait_for_timeout(random.randint(300, 1500))
        s = lok(page)
        if s and (len(R["samples"]) < 400):
            R["samples"].append({"t": round(now, 1), "shield": s["state"]["shield"], "yield": s["state"]["yielding"],
                                 "take": s["state"]["takeover"], "v": s["state"]["speed"], "contacts": s["safety"]["pedestrianContacts"]})
        if s and s["state"]["shield"] and shot < 4:
            stage_shot(page, f"safety-perisai-{shot}")
            shot += 1
    s = lok(page)
    R["safety"] = s["safety"]
    R["final"] = {"state": s["state"], "chips": chips(page), "status": status(page)}
    R["stoppedLongest"] = None
    R["console"] = console(page)
    br.close()

samples = R.pop("samples")
R["shieldSamples"] = sum(1 for x in samples if x["shield"])
R["yieldSamples"] = sum(1 for x in samples if x["yield"])
R["takeSamples"] = sum(1 for x in samples if x["take"])
R["nSamples"] = len(samples)
print(json.dumps(R, indent=1, ensure_ascii=False))
ok = R["safety"]["pedestrianContacts"] == 0 and R["safety"]["redLightViolations"] == 0 and not R["console"]
sys.exit(0 if ok else 1)
