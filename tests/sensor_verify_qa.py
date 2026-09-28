"""QA independen pelajaran Sensor lewat UI sungguhan.

Memeriksa: tidak ada tugas yang selesai sendiri saat dibuka dan dibiarkan, syarat negatif tiap tugas,
kelima tugas selesai lewat klik dan tahan tombol (sentuh di ponsel), Jeda, Lanjutkan, Ulangi, kecepatan
0,5x dan 2x, kebocoran setelah keluar masuk 5 kali, ukuran target sentuh, dan galat konsol.

Pemakaian: python3 tests/sensor_verify_qa.py [--mobile]   (server di port 8262)
"""
import json
import sys
import time

from playwright.sync_api import sync_playwright

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from sensor_verify_util import (SHOTS, BASE, launch, new_page, hook, open_lesson, wait_ready, go_step, toggle,  # noqa: E402
                                weather, sim_speed, safety, wait_task, hold, ego_s)

MOBILE = "--mobile" in sys.argv
TAG = "m" if MOBILE else "d"
R = {"viewport": "390x844" if MOBILE else "1366x900", "checks": [], "fail": []}


def check(name, ok, detail=None):
    R["checks"].append({"name": name, "ok": bool(ok), "detail": detail})
    if not ok:
        R["fail"].append(name)
    print(("OK  " if ok else "GAGAL ") + name, detail if detail is not None else "")


def shot(page, name):
    page.locator(".sim-canvas").first.screenshot(path=f"{SHOTS}v-{TAG}-{name}.png")


def sim_time(page):
    return page.evaluate("() => window.__lessonSafety.snapshot().time")


with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b, mobile=MOBILE)
    open_lesson(page)
    h = hook(page)
    check("mulai di langkah 1, belum ada tugas", h["stepIndex"] == 0 and h["completedTasks"] == [], h)

    # ---------- 1) dibiarkan: tidak ada tugas yang selesai sendiri ----------
    for i in range(5):
        go_step(page, i)
        page.wait_for_timeout(4500)
        check(f"langkah {i + 1} dibiarkan 4,5 detik: tidak ada tugas selesai", hook(page)["completedTasks"] == [], hook(page)["completedTasks"])
    # langkah 6 lalu kembali, juga dengan 2x
    go_step(page, 5)
    sim_speed(page, "2x")
    for i in range(5):
        go_step(page, i)
        page.wait_for_timeout(2500)
    sim_speed(page, "1x")
    check("maju mundur antar langkah pada 2x: tidak ada tugas selesai", hook(page)["completedTasks"] == [], hook(page)["completedTasks"])

    # muat ulang di tengah pelajaran: tetap tidak ada yang selesai
    page.reload()
    wait_ready(page)
    page.wait_for_timeout(3000)
    check("muat ulang halaman: tidak ada tugas selesai", hook(page)["completedTasks"] == [], hook(page))

    # ---------- 2) tugas lewat UI ----------
    go_step(page, 0)
    toggles = {n: page.locator(".ctl-toggle", has_text=n).first.get_attribute("aria-checked") for n in ["Kamera", "LiDAR", "Radar", "Ultrasonik"]}
    check("langkah 1: semua sensor mati", all(v == "false" for v in toggles.values()), toggles)
    # negatif: kamera + LiDAR menyala tidak boleh menyelesaikan "kamera saja"
    toggle(page, "LiDAR", True)
    toggle(page, "Kamera", True)
    page.wait_for_timeout(3000)
    check("kamera-lampu tidak selesai bila LiDAR juga menyala", "kamera-lampu" not in hook(page)["completedTasks"])
    toggle(page, "LiDAR", False)
    t = wait_task(page, "kamera-lampu", 20)
    check("kamera-lampu selesai lewat UI", t is not None, t)
    chip = page.locator(".hud-chip", has_text="Lampu terbaca").first.inner_text() if page.locator(".hud-chip", has_text="Lampu terbaca").count() else None
    check("chip HUD menampilkan warna lampu", chip is not None and any(c in chip for c in ["merah", "kuning", "hijau"]), chip)
    shot(page, "1-kamera")

    go_step(page, 1)
    check("langkah 2: LiDAR mati oleh preset", page.locator(".ctl-toggle", has_text="LiDAR").first.get_attribute("aria-checked") == "false")
    page.wait_for_timeout(1500)
    check("lidar-on belum selesai sebelum LiDAR dinyalakan", "lidar-on" not in hook(page)["completedTasks"])
    toggle(page, "LiDAR", True)
    t = wait_task(page, "lidar-on", 10)
    check("lidar-on selesai lewat UI", t is not None, t)
    page.wait_for_timeout(800)
    shot(page, "2-lidar")

    go_step(page, 2)
    page.wait_for_timeout(2000)
    check("radar-kecepatan belum selesai sebelum radar dinyalakan", "radar-kecepatan" not in hook(page)["completedTasks"])
    toggle(page, "Radar", True)
    t = wait_task(page, "radar-kecepatan", 60)
    check("radar-kecepatan selesai lewat UI", t is not None, t)
    shot(page, "3-radar")

    go_step(page, 3)
    wx = page.evaluate("() => window.__lessonSafety.snapshot().weather")
    check("langkah 4: cuaca dikembalikan ke cerah", wx == "cerah", wx)
    # negatif: kabut dengan radar mati
    toggle(page, "Radar", False)
    toggle(page, "Kamera", True)
    weather(page, "Kabut")
    page.wait_for_timeout(3000)
    check("kabut-radar tidak selesai bila radar mati", "kabut-radar" not in hook(page)["completedTasks"])
    toggle(page, "Radar", True)
    t = wait_task(page, "kabut-radar", 10)
    check("kabut-radar selesai lewat UI", t is not None, t)
    shot(page, "4-kabut")

    go_step(page, 4)
    check("langkah 5: ultrasonik mati oleh preset", page.locator(".ctl-toggle", has_text="Ultrasonik").first.get_attribute("aria-checked") == "false")
    back = page.locator(".btn-hold", has_text="Mundur").first
    back.scroll_into_view_if_needed()
    # negatif: mundur dekat angkot dengan ultrasonik mati
    hold(page, back, 7000, mobile=MOBILE)
    page.wait_for_timeout(1500)
    e = ego_s(page)
    check("mundur tanpa ultrasonik: tugas belum selesai", "ultrasonik-dekat" not in hook(page)["completedTasks"], e)
    toggle(page, "Ultrasonik", True)
    t = wait_task(page, "ultrasonik-dekat", 6)
    if t is None:
        hold(page, back, 4000, mobile=MOBILE)
        t = wait_task(page, "ultrasonik-dekat", 6)
    rear = page.locator(".readout", has_text="Jarak belakang").first.inner_text()
    check("ultrasonik-dekat selesai lewat UI", t is not None, {"t": t, "readout": rear})
    s = safety(page)
    check("mundur ke angkot: tanpa tabrakan dan tanpa jepit", s["otherCollisions"] == 0 and s["clamps"] == 0 and s["redRuns"] == 0 and s["pedContacts"] == 0, s)
    shot(page, "5-ultrasonik")

    go_step(page, 5)
    page.wait_for_timeout(800)
    tg = {n: page.locator(".ctl-toggle", has_text=n).first.get_attribute("aria-checked") for n in ["Kamera", "LiDAR", "Radar", "Ultrasonik"]}
    check("langkah 6: semua sensor menyala", all(v == "true" for v in tg.values()), tg)
    for w in ["Cerah", "Hujan", "Kabut", "Malam"]:
        weather(page, w)
        page.wait_for_timeout(1200)
        shot(page, f"6-semua-{w.lower()}")
    weather(page, "Cerah")

    # ---------- 3) tombol shell ----------
    pause = page.locator("[data-act=pause]")
    pause.click()
    page.wait_for_timeout(200)
    t0 = sim_time(page)
    fwd = page.locator(".btn-hold", has_text="Maju").first
    e0 = ego_s(page)
    hold(page, fwd, 1500, mobile=MOBILE)
    toggle(page, "LiDAR", False)
    toggle(page, "LiDAR", True)
    weather(page, "Hujan")
    page.wait_for_timeout(800)
    t1 = sim_time(page)
    e1 = ego_s(page)
    badge = page.locator(".stage-badge").first
    check("Jeda: waktu tidak maju dan mobil diam", abs(t1 - t0) < 1e-9 and abs(e1["s"] - e0["s"]) < 1e-6, {"t0": t0, "t1": t1})
    check("Jeda: label tombol Lanjutkan dan lencana Dijeda tampil", "Lanjutkan" in pause.inner_text() and badge.is_visible(), pause.inner_text())
    trail_count = page.evaluate("() => window.__lessonSafety.trail.count")
    check("Jeda: pindai ulang LiDAR saat dijeda tetap berisi titik", trail_count > 50, trail_count)
    pause.click()
    page.wait_for_timeout(1000)
    check("Lanjutkan: waktu maju lagi", sim_time(page) > t1 + 0.5)

    for lab, want in [("2x", 2.0), ("0,5x", 0.5), ("1x", 1.0)]:
        sim_speed(page, lab)
        a = sim_time(page)
        w0 = time.time()
        page.wait_for_timeout(2000)
        ratio = (sim_time(page) - a) / (time.time() - w0)
        check(f"kecepatan {lab}: rasio waktu simulasi", abs(ratio - want) < 0.25 * want, round(ratio, 2))
        check(f"kecepatan {lab}: kait uji mencatat", abs(hook(page)["speed"] - want) < 1e-9, hook(page)["speed"])

    # Ulangi: mobil kembali ke awal, waktu mulai dari 0, tugas tetap tersimpan
    hold(page, back, 2500, mobile=MOBILE)
    page.locator("[data-act=reset]").click()
    page.wait_for_timeout(300)
    e = ego_s(page)
    tt = sim_time(page)
    check("Ulangi: mobil otonom kembali ke s = 31,6", abs(e["s"] - 31.6) < 0.2 and abs(e["v"]) < 0.3, e)
    check("Ulangi: waktu simulasi mulai lagi dari 0", tt < 1.0, tt)
    check("Ulangi: tugas tetap tersimpan", len(hook(page)["completedTasks"]) == 5, hook(page)["completedTasks"])

    # ringkasan
    page.locator(".step-nav .btn-primary").click()
    page.wait_for_timeout(500)
    check("ringkasan terbuka", hook(page)["stepIndex"] == 6, hook(page)["stepIndex"])
    page.screenshot(path=f"{SHOTS}v-{TAG}-7-ringkasan.png")
    prog = page.evaluate("() => JSON.parse(localStorage.getItem('liveshuttle.progress.v1') || 'null')")
    lp = (prog or {}).get("lessons", {}).get("sensor") if prog else None
    check("progres tersimpan di liveshuttle.progress.v1", lp is not None and len(lp.get("done", [])) == 5, lp)

    # ---------- 4) target sentuh ----------
    small = page.evaluate("""() => [...document.querySelectorAll('.controls button, .controls [role=radio], .controls [role=switch], [data-act], .step-nav .btn')]
      .filter((b) => b.offsetParent).map((b) => { const r = b.getBoundingClientRect(); return { t: (b.innerText || b.getAttribute('aria-label') || '').trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) }; })
      .filter((r) => r.w < 40 || r.h < 40)""")
    go_step(page, 5)
    small2 = page.evaluate("""() => [...document.querySelectorAll('.controls button, .controls [role=radio]')].filter((b) => b.offsetParent)
      .map((b) => { const r = b.getBoundingClientRect(); return { t: (b.innerText || b.getAttribute('aria-label') || '').trim().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height) }; })
      .filter((r) => r.w < 40 || r.h < 40)""")
    check("semua kontrol pelajaran dan tombol simulasi minimal 40 px", not small and not small2, small + small2)

    # ---------- 5) keluar masuk 5 kali ----------
    stats = []
    for k in range(5):
        page.goto(BASE + "#/")
        page.wait_for_timeout(600)
        page.keyboard.down("ArrowUp")
        page.wait_for_timeout(100)
        page.keyboard.up("ArrowUp")
        home = page.evaluate("() => ({ hook: !!window.__lessonSafety, styles: [...document.querySelectorAll('style')].filter((s) => s.textContent.includes('.lesson-sensor')).length, stage: document.querySelectorAll('.sim-canvas').length })")
        page.goto(BASE + "#/pelajaran/sensor")
        wait_ready(page)
        page.wait_for_timeout(700)
        inside = page.evaluate("() => ({ loops: window.__simotonom.activeLoops, canvases: document.querySelectorAll('.sim-canvas').length, styles: [...document.querySelectorAll('style')].filter((s) => s.textContent.includes('.lesson-sensor')).length, heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null })")
        stats.append({"home": home, "inside": inside})
    check("keluar masuk 5 kali: kait dihapus di beranda, tanpa gaya tersisa", all(not s["home"]["hook"] and s["home"]["styles"] == 0 for s in stats), stats)
    homeloops = page.evaluate("() => 0")
    check("keluar masuk 5 kali: 1 kanvas, 1 gaya pelajaran di dalam", all(s["inside"]["canvases"] == 1 and s["inside"]["styles"] == 1 for s in stats), [s["inside"] for s in stats])
    loops = [s["inside"]["loops"] for s in stats]
    check("keluar masuk 5 kali: jumlah loop tidak bertambah", len(set(loops)) == 1, loops)
    h = hook(page)
    check("kembali ke pelajaran: langkah terakhir diingat", h["stepIndex"] in (5, 6), h["stepIndex"])

    s = safety(page)
    check("penghitung keselamatan tetap 0", s["redRuns"] == 0 and s["pedContacts"] == 0 and s["clamps"] == 0, s)
    check("tanpa galat, peringatan, atau pageerror di konsol", not log, log)
    R["errors"] = log
    b.close()

print(json.dumps({"viewport": R["viewport"], "fail": R["fail"], "n": len(R["checks"])}, ensure_ascii=False))
sys.exit(1 if R["fail"] else 0)
