"""Uji aturan keselamatan (SPEC aturan 9) dan gambar LiDAR yang tenang untuk pelajaran Level Otomasi.

1. Kontrol positif: pelajaran keputusan (punya orang menyeberang dan lampu) harus menaikkan hitungan
   instrumen, bukti instrumennya bekerja.
2. Level Otomasi, semua langkah, kecepatan 2x: level 0 sampai 5 lewat tombol dan keyboard, gas penuh
   dengan setir acak, rem, Pegang kemudi, Ambil alih, Aktifkan, Ulangi berulang, Jeda, ketukan acak
   di kedua kanvas. Semua hitungan yang terkait orang berjalan kaki, lampu, penyeberangan, garis
   henti, sinar LiDAR, dan sapuan LiDAR harus 0. drawLidarRange (cakupan diam) boleh.
3. Gas penuh manual lama di jalan kota dan di kawasan: kecepatan tertinggi, tabrakan per jenis,
   dan nilai tidak wajar (NaN).

Pemakaian: python3 tests/level-otomasi_verify_safety.py --port 8261 [--mobile]
"""
import math
import random
import sys

sys.path.insert(0, __import__("os").path.dirname(__file__))
from importlib import import_module

U = import_module("level-otomasi_verify_util")
PORT = U.arg("--port", "8261")
MOBILE = "--mobile" in sys.argv
TAG = "m" if MOBILE else "d"
FORBIDDEN = [k for k in U.DRAW_FNS if k not in ("drawLidarRange", "drawSensorCone")] + U.ROAD_FNS + U.TRAFFIC_CLASSES + U.TRAFFIC_FNS
fails = []


def check(ok, msg):
    print(("OK   " if ok else "FAIL ") + msg, flush=True)
    if not ok:
        fails.append(msg)


rng = random.Random(20260929)

with U.Browser(PORT, mobile=MOBILE) as b:
    page = b.page
    # 1. kontrol positif
    page.goto(b.base + "#/pelajaran/keputusan")
    page.wait_for_function("() => window.__simotonom && window.__simotonom.lessonStatus === 'ready'")
    page.wait_for_timeout(4000)
    ctrl = b.qa_counts()
    print("  positive control (keputusan):", {k: v for k, v in ctrl.items() if k in FORBIDDEN})
    check(ctrl.get("drawPedestrian", 0) > 0 or ctrl.get("drawTrafficSignal", 0) > 0 or ctrl.get("drawTrafficLight", 0) > 0,
          "instrument counts pedestrians or signals in the keputusan lesson")

    # 2. Level Otomasi
    b.goto_lesson(clear=True)
    b.reset_counts()
    stage_canvas = page.locator(".stage canvas").first
    trip_canvas = page.locator(".trip-map canvas").first
    keys_hold = ["ArrowUp", "ArrowLeft", "ArrowRight", "ArrowDown"]
    worst = {"lead": 0, "motor": 0, "zone": 0}
    bad_values = []
    for step in range(6):
        b.go_step(step)
        page.locator(".speed-wrap .seg-btn", has_text="2x").dispatch_event("click")
        t_end = 22 if step in (3, 4, 5) else 14
        elapsed = 0.0
        while elapsed < t_end:
            act = rng.random()
            if act < 0.18:
                n = rng.randrange(6)
                if rng.random() < 0.5:
                    page.keyboard.press(str(n))
                else:
                    page.locator(".grp-level .seg-btn").nth(n).dispatch_event("click")
            elif act < 0.5:
                k = rng.choice(keys_hold)
                page.keyboard.down("ArrowUp")
                page.keyboard.down(k)
                page.wait_for_timeout(rng.randrange(200, 900))
                page.keyboard.up(k)
                page.keyboard.up("ArrowUp")
            elif act < 0.58:
                page.keyboard.press(rng.choice(["p", "a"]))
            elif act < 0.64:
                for sel in ("[data-act='pegang']", "[data-act='ambil-alih']", "[data-act='alert-action']"):
                    el = page.locator(sel)
                    if el.count() and el.is_visible() and not el.is_disabled():
                        el.dispatch_event("click")
            elif act < 0.68:
                btn = page.locator(".lv-sys .btn")
                if btn.count() and btn.is_visible():
                    btn.dispatch_event("click")
            elif act < 0.74:
                page.locator("[data-act='reset']").dispatch_event("click")
            elif act < 0.78:
                page.locator("[data-act='pause']").dispatch_event("click")
                page.wait_for_timeout(200)
                page.locator("[data-act='pause']").dispatch_event("click")
            elif act < 0.86:
                for cv in (stage_canvas, trip_canvas):
                    bb = cv.bounding_box()
                    if bb:
                        x = bb["x"] + rng.random() * bb["width"]
                        y = bb["y"] + rng.random() * bb["height"]
                        if MOBILE:
                            page.touchscreen.tap(x, y)
                        else:
                            page.mouse.click(x, y)
            else:
                page.wait_for_timeout(rng.randrange(300, 1200))
            elapsed += 0.6
            s = b.state()
            for k in worst:
                worst[k] = max(worst[k], s["crashes"][k])
            for k in ("trip", "speedKmh", "egoD"):
                if not isinstance(s[k], (int, float)) or math.isnan(s[k]) or math.isinf(s[k]):
                    bad_values.append((step, k, s[k]))
        c = b.qa_counts()
        hits = {k: c.get(k, 0) for k in FORBIDDEN if c.get(k, 0)}
        print(f"  step {step + 1}: forbidden hits {hits} lidarRange {c.get('drawLidarRange', 0)} crashes {b.state()['crashes']}")
        check(not hits, f"step {step + 1} fuzz: no pedestrian, light, crosswalk, stop line, LiDAR ray or sweep call")
    check(not bad_values, f"no NaN or infinite values in lesson state ({bad_values[:4]})")
    print("  worst crash counters seen during fuzz (vehicle and roadworks only):", worst)

    # 3. gas penuh manual lama
    for step, label in ((0, "city"), (4, "kawasan")):
        b.go_step(step)
        page.locator(".speed-wrap .seg-btn", has_text="2x").dispatch_event("click")
        page.keyboard.press("0")
        vmax = 0.0
        page.keyboard.down("ArrowUp")
        for _ in range(40):
            page.wait_for_timeout(500)
            s = b.state()
            vmax = max(vmax, s["speedKmh"])
        page.keyboard.up("ArrowUp")
        s = b.state()
        print(f"  full throttle {label}: vmax {vmax:.1f} km/jam, crashes {s['crashes']}, trip {s['trip']:.0f}, limit {s['limitKmh']}")
        check(vmax < 70, f"manual top speed stays capped ({vmax:.1f} km/jam) on {label}")
        c = b.qa_counts()
        hits = {k: c.get(k, 0) for k in FORBIDDEN if c.get(k, 0)}
        check(not hits, f"full throttle on {label}: still no forbidden calls")

    # level 3 ke atas memakai cakupan LiDAR diam
    b.go_step(4)
    b.reset_counts()
    page.wait_for_timeout(1500)
    c = b.qa_counts()
    check(c.get("drawLidarRange", 0) > 30 and not c.get("drawLidarSweep") and not c.get("drawRays"),
          f"level 4 draws the still LiDAR range each frame, no rays or sweep ({c.get('drawLidarRange', 0)} calls)")

    msgs = [m for m in b.msgs if "GPU stall" not in m]
    check(not msgs, f"no console errors, warnings or page errors ({msgs[:5]})")

print()
print(f"{'MOBILE' if MOBILE else 'DESKTOP'} SAFETY FAILS: {len(fails)}")
for f in fails:
    print(" -", f)
sys.exit(1 if fails else 0)
