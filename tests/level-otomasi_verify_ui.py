"""QA independen pelajaran Level Otomasi lewat UI.

Bagian:
  idle     tidak ada tugas yang selesai sendiri saat dimuat atau saat langkah dibiarkan (kecuali tugas
           mengamati di langkah 5, yang memang selesai saat mobil level 4 berhenti sendiri)
  tasks    semua tugas diselesaikan lewat tombol di layar (pointer atau sentuhan) dan tercatat di
           window.__simotonom.completedTasks
  shell    Jeda, Lanjutkan, kecepatan 0,5x / 1x / 2x, Ulangi, dan tombol keyboard
  leak     5 kali keluar dan masuk lagi: loop, kanvas, style, listener, pengamat, interval
  shots    tangkapan layar tiap langkah
  perf     waktu bingkai

Pemakaian: python3 tests/level-otomasi_verify_ui.py --port 8261 [--mobile] [--only idle,tasks,...]
"""
import json
import sys
import time

sys.path.insert(0, __import__("os").path.dirname(__file__))
from importlib import import_module

U = import_module("level-otomasi_verify_util")

PORT = U.arg("--port", "8261")
MOBILE = "--mobile" in sys.argv
ONLY = set((U.arg("--only", "idle,tasks,shell,leak,shots,perf")).split(","))
TAG = "m" if MOBILE else "d"
fails = []
notes = []


def check(ok, msg):
    print(("OK   " if ok else "FAIL ") + msg, flush=True)
    if not ok:
        fails.append(msg)


def wait_until(b, pred, timeout_s, poll=0.1):
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        v = pred()
        if v:
            return v
        b.page.wait_for_timeout(int(poll * 1000))
    return None


def set_speed(b, label):
    b.tap(b.page.locator(".speed-wrap .seg-btn", has_text=label))


def level_btn(b, n):
    return b.page.locator(".grp-level .seg-btn").nth(n)


def pad_btn(b, name):
    idx = {"Kiri": 0, "Gas": 1, "Rem": 2, "Kanan": 3}[name]
    return b.page.locator(".grp-drive .pad .btn").nth(idx)


def done(b):
    return b.hook()["completedTasks"]


with U.Browser(PORT, mobile=MOBILE) as b:
    page = b.page
    b.goto_lesson(clear=True)
    check(b.hook()["stepIndex"] == 0, "lesson opens at step 1")
    page.wait_for_timeout(1500)
    check(done(b) == [], f"no task done right after load (got {done(b)})")

    # ------------------------------------------------------------------ idle
    if "idle" in ONLY:
        set_speed(b, "2x")
        for i in range(6):
            b.go_step(i)
            set_speed(b, "2x")
            page.wait_for_timeout(13000)  # sekitar 26 detik waktu simulasi
            d = done(b)
            s = b.state()
            print(f"  idle step {i + 1}: done={d} level={s['level']} engaged={s['engaged']} phase={s['phase']} trip={s['trip']:.0f} speed={s['speedKmh']:.1f}")
            expected = ["l4-mrm"] if i >= 4 else []
            check(d == expected, f"idle step {i + 1}: completed tasks {d} == {expected}")
        page.evaluate("() => localStorage.clear()")
        page.reload()
        b.goto_lesson()
        check(done(b) == [], "progress cleared before the task run")

    # ------------------------------------------------------------------ tasks
    if "tasks" in ONLY:
        b.go_step(0)
        set_speed(b, "2x")
        # langkah 1: tahan Gas (pointer) sampai 150 m
        t0 = time.time()
        gas = pad_btn(b, "Gas")
        b.press_hold(gas)
        page.wait_for_timeout(600)
        check(gas.get_attribute("aria-pressed") == "true", "Gas button shows pressed while held")
        ok = wait_until(b, lambda: "l0-manual" in done(b), 40)
        b.release_hold()
        s = b.state()
        check(bool(ok), f"l0-manual done by holding Gas ({time.time() - t0:.1f} s real, crashes {s['crashes']})")
        page.wait_for_timeout(400)
        check(pad_btn(b, "Gas").get_attribute("aria-pressed") == "false", "Gas released after pointer up")

        # langkah 2: pilih level 1 lewat tombol, ACC mengikuti angkot
        b.go_step(1)
        set_speed(b, "2x")
        page.wait_for_timeout(1200)
        check("l1-acc" not in done(b), "l1-acc not done before choosing level 1")
        b.tap(level_btn(b, 1))
        ok = wait_until(b, lambda: "l1-acc" in done(b), 25)
        s = b.state()
        check(bool(ok), f"l1-acc done after tapping level 1 (lead {s['lead']}, level {s['level']})")
        check(s["crashes"]["lead"] == 0, "no crash behind the angkot with ACC")

        # langkah 3: tunggu pesan Pegang kemudi, tekan tombolnya
        b.go_step(2)
        set_speed(b, "1x")
        ok = wait_until(b, lambda: b.alert() == "Pegang kemudi", 12)
        check(bool(ok), f"Pegang kemudi prompt appears (alert={b.alert()})")
        check("l2-attention" not in done(b), "l2-attention not done before answering")
        hand = page.locator("[data-act='pegang']")
        check(not hand.is_disabled(), "Pegang kemudi button enabled during the prompt")
        b.tap(hand)
        page.wait_for_timeout(500)
        check("l2-attention" in done(b), f"l2-attention done after tapping Pegang kemudi (done={done(b)})")

        # langkah 4: tunggu permintaan ambil alih, tekan Ambil alih di panel
        b.go_step(3)
        set_speed(b, "2x")
        take = page.locator("[data-act='ambil-alih']")
        ok = wait_until(b, lambda: b.state()["phase"] == "tor", 40)
        check(bool(ok), "level 3 raises the takeover request before the work zone")
        check("l3-takeover" not in done(b), "l3-takeover not done before pressing")
        wait_until(b, lambda: b.alert() == "Ambil alih kemudi", 2)
        page.wait_for_timeout(200)
        cnt = page.locator(".lvl-alert-count").inner_text()
        check(b.alert() == "Ambil alih kemudi" and cnt.strip() != "", f"takeover alert with countdown '{cnt}'")
        b.tap(take)
        page.wait_for_timeout(500)
        s = b.state()
        check("l3-takeover" in done(b), f"l3-takeover done after tapping Ambil alih (engaged={s['engaged']})")
        check(not s["engaged"], "system off after takeover")

        # langkah 5: level 4 menepi dan berhenti sendiri
        b.go_step(4)
        set_speed(b, "2x")
        ok = wait_until(b, lambda: "l4-mrm" in done(b), 30)
        s = b.state()
        check(bool(ok), f"l4-mrm done by watching (phase {s['phase']}, egoD {s['egoD']:.2f}, inKawasan {s['inKawasan']})")
        check(s["inKawasan"] and s["speedKmh"] < 0.5 and s["egoD"] > 3.5, "level 4 stopped on the left edge inside the area")
        h = b.hook()
        check(sorted(h["completedTasks"]) == sorted(["l0-manual", "l1-acc", "l2-attention", "l3-takeover", "l4-mrm"]),
              f"all 5 tasks registered in __simotonom: {h['completedTasks']}")
        stored = page.evaluate("() => localStorage.getItem('liveshuttle.progress.v1')")
        check(stored and "l4-mrm" in stored, "progress saved in localStorage liveshuttle.progress.v1")

        # langkah 6: level 5 melewati batas, level 4 ditolak di luar kawasan
        b.go_step(5)
        set_speed(b, "2x")
        ok = wait_until(b, lambda: not b.state()["inKawasan"] and b.state()["limitKmh"] == 40, 30)
        s = b.state()
        check(bool(ok) and s["level"] == 5 and s["engaged"], f"level 5 drives past the boundary (trip {s['trip']:.0f})")
        page.wait_for_timeout(4000)
        s = b.state()
        check(35 <= s["speedKmh"] <= 41, f"level 5 speeds up toward 40 km/jam outside the area ({s['speedKmh']:.1f})")
        b.tap(level_btn(b, 4))
        page.wait_for_timeout(300)
        s = b.state()
        check(s["level"] == 4 and not s["engaged"] and b.alert() == "Level 4 tidak bisa aktif", f"level 4 refused outside the area (alert {b.alert()})")
        b.go_step(6)
        page.wait_for_timeout(300)
        txt = page.locator(".step-card").inner_text()
        check("Semua tugas selesai" in txt, "summary shows all tasks done")

    # ------------------------------------------------------------------ shell
    if "shell" in ONLY:
        b.go_step(5)
        set_speed(b, "1x")
        page.wait_for_timeout(800)
        b.tap(page.locator("[data-act='pause']"))
        page.wait_for_timeout(200)
        t1 = b.state()["trip"]
        page.wait_for_timeout(1500)
        t2 = b.state()["trip"]
        check(abs(t2 - t1) < 0.01 and b.hook()["paused"], f"Jeda freezes the sim (trip {t1:.2f} -> {t2:.2f})")
        check(page.locator(".stage-badge").is_visible(), "Dijeda badge visible")
        b.tap(page.locator("[data-act='pause']"))
        page.wait_for_timeout(300)
        check(not b.hook()["paused"], "Lanjutkan resumes")
        # rasio kecepatan
        def rate(label):
            set_speed(b, label)
            page.wait_for_timeout(400)
            a = b.state()
            t0 = time.time()
            page.wait_for_timeout(2000)
            z = b.state()
            return (z["trip"] - a["trip"]) / (time.time() - t0), z["speedKmh"]
        b.tap(page.locator("[data-act='reset']"))
        page.wait_for_timeout(300)
        r1, v1 = rate("1x")
        r2, v2 = rate("2x")
        r05, v05 = rate("0,5x")
        print(f"  trip rate 1x {r1:.2f} m/s (v {v1:.1f}), 2x {r2:.2f} (v {v2:.1f}), 0,5x {r05:.2f} (v {v05:.1f})")
        check(r2 > r1 * 1.5 and r05 < r1 * 0.75, "speed buttons scale sim time")
        set_speed(b, "1x")
        # Ulangi: kembali ke titik awal langkah dengan level pilihan pelajar
        b.tap(level_btn(b, 3))
        page.wait_for_timeout(1500)
        b.tap(page.locator("[data-act='reset']"))
        page.wait_for_timeout(200)
        s = b.state()
        print(f"  after Ulangi: level {s['level']} engaged {s['engaged']} trip {s['trip']:.0f}")
        check(s["level"] == 3 and abs(s["trip"] - 652) < 15, f"Ulangi restarts step 6 with the chosen level (trip {s['trip']:.0f})")
        # keyboard
        page.locator("body").click(position={"x": 5, "y": 5}) if not MOBILE else None
        for n in range(6):
            page.keyboard.press(str(n))
            page.wait_for_timeout(120)
            check(b.state()["level"] == n, f"key {n} selects level {n}")
        page.keyboard.press("0")
        page.wait_for_timeout(100)
        v0 = b.state()["speedKmh"]
        page.keyboard.down("ArrowUp")
        page.wait_for_timeout(1500)
        page.keyboard.up("ArrowUp")
        v1 = b.state()["speedKmh"]
        check(v1 > v0 + 3, f"ArrowUp accelerates in level 0 ({v0:.1f} -> {v1:.1f})")
        page.keyboard.down("ArrowDown")
        page.wait_for_timeout(1500)
        page.keyboard.up("ArrowDown")
        v2 = b.state()["speedKmh"]
        check(v2 < v1 - 3, f"ArrowDown brakes ({v1:.1f} -> {v2:.1f})")
        # langkah 3 dengan tombol P, langkah 4 dengan tombol A
        page.evaluate("() => localStorage.clear()")
        page.reload()
        b.goto_lesson()
        b.go_step(2)
        ok = wait_until(b, lambda: b.alert() == "Pegang kemudi", 12)
        page.keyboard.press("p")
        page.wait_for_timeout(300)
        check("l2-attention" in done(b), "key P answers the level 2 prompt")
        b.go_step(3)
        set_speed(b, "2x")
        wait_until(b, lambda: b.state()["phase"] == "tor", 40)
        page.keyboard.press("a")
        page.wait_for_timeout(300)
        check("l3-takeover" in done(b), "key A takes over during the request")
        set_speed(b, "1x")

    # ------------------------------------------------------------------ leak
    if "leak" in ONLY:
        b.goto_lesson()
        page.wait_for_timeout(800)
        base = dict(b.listeners(), **b.live(), loops=b.hook()["activeLoops"],
                    canvases=page.locator("canvas").count(), styles=page.locator("style").count())
        print("  baseline in lesson:", base)
        rows = []
        for k in range(5):
            page.evaluate("() => { location.hash = '#/'; }")
            page.wait_for_function("() => window.__simotonom.routeName === 'home'")
            page.wait_for_timeout(500)
            home = dict(hook=page.evaluate("() => typeof window.__levelOtomasi"),
                        lessonStyles=page.evaluate("() => [...document.querySelectorAll('style')].filter(s => s.textContent.includes('.lesson-level-otomasi')).length"))
            page.evaluate("() => { location.hash = '#/pelajaran/level-otomasi'; }")
            page.wait_for_function("() => window.__simotonom.lessonStatus === 'ready' && window.__levelOtomasi")
            page.wait_for_timeout(800)
            # sedikit interaksi supaya jalur listener ikut dipakai
            b.go_step(k % 6)
            page.wait_for_timeout(400)
            b.go_step(0)
            page.wait_for_timeout(400)
            row = dict(b.listeners(), **b.live(), loops=b.hook()["activeLoops"],
                       canvases=page.locator("canvas").count(), styles=page.locator("style").count(), home=home)
            rows.append(row)
            print(f"  round {k + 1}: {row}")
        last = rows[-1]
        for key in ("window", "document", "ro", "mo", "io", "intervals", "loops", "canvases", "styles"):
            check(last[key] <= base[key], f"after 5 round trips {key} {last[key]} <= baseline {base[key]}")
        check(all(r["home"]["hook"] == "undefined" and r["home"]["lessonStyles"] == 0 for r in rows), "home page has no lesson hook and no lesson style")

    # ------------------------------------------------------------------ shots
    if "shots" in ONLY:
        b.goto_lesson()
        for i in range(6):
            b.go_step(i)
            set_speed(b, "1x")
            if i == 0:
                gas = pad_btn(b, "Gas")
                b.press_hold(gas)
                page.wait_for_timeout(3500)
                b.release_hold()
            elif i == 1:
                b.tap(level_btn(b, 1))
                page.wait_for_timeout(4000)
            elif i == 2:
                wait_until(b, lambda: b.alert() == "Pegang kemudi", 10)
            elif i == 3:
                set_speed(b, "2x")
                wait_until(b, lambda: b.state()["phase"] == "tor", 40)
                page.wait_for_timeout(600)
            elif i == 4:
                set_speed(b, "2x")
                page.wait_for_timeout(3500)
            else:
                set_speed(b, "2x")
                page.wait_for_timeout(5000)
            page.evaluate("() => window.scrollTo(0, 0)")
            page.wait_for_timeout(150)
            page.screenshot(path=U.SHOTS + f"ui-{TAG}-step{i + 1}.png")
            page.locator(".stage").screenshot(path=U.SHOTS + f"ui-{TAG}-stage{i + 1}.png")
        page.locator(".grp-trip").screenshot(path=U.SHOTS + f"ui-{TAG}-tripmap.png")
        page.screenshot(path=U.SHOTS + f"ui-{TAG}-full.png", full_page=True)
        # langkah 4 saat level 3+ (LiDAR tampil): dua bingkai berurutan untuk melihat gambar sensor
        b.go_step(3)
        set_speed(b, "1x")
        page.wait_for_timeout(1500)
        page.locator(".stage").screenshot(path=U.SHOTS + f"ui-{TAG}-lidar-a.png")
        page.wait_for_timeout(90)
        page.locator(".stage").screenshot(path=U.SHOTS + f"ui-{TAG}-lidar-b.png")

    # ------------------------------------------------------------------ perf
    if "perf" in ONLY:
        b.goto_lesson()
        for i in (0, 3, 5):
            b.go_step(i)
            set_speed(b, "1x")
            page.wait_for_timeout(800)
            fs = b.frame_stats(2500)
            print(f"  step {i + 1} frames: fps {fs['fps']:.1f} p95 {fs['p95']:.1f} ms max {fs['max']:.1f} ms")
            check(fs["fps"] > 50, f"step {i + 1} runs near 60 fps (software canvas, headless)")

    msgs = [m for m in b.msgs if "GPU stall" not in m]
    check(not msgs, f"no console errors, warnings or page errors ({msgs[:5]})")

print()
print(f"{'MOBILE' if MOBILE else 'DESKTOP'} FAILS: {len(fails)}")
for f in fails:
    print(" -", f)
sys.exit(1 if fails else 0)
