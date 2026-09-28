"""Verifikasi akhir: jalani seluruh Mode Tutorial lewat rute #/simulator/tutorial dengan klik nyata.
Pemakaian: python3 tests/sim3d_final_tutorial.py [desktop|mobile] [kecepatan langkah 5: 30|50|70]"""
import sys
import time
from sim3d_final_common import *  # noqa

DEV = sys.argv[1] if len(sys.argv) > 1 else "desktop"
SPEED = sys.argv[2] if len(sys.argv) > 2 else "30"
MOBILE = DEV == "mobile"
TAG = f"{'m' if MOBILE else 'd'}{SPEED}"


def tut(page):
    return snap(page)["tutorial"]


def click_action(page, text):
    loc = page.locator(".s3d-tut-actions button", has_text=text).first
    loc.scroll_into_view_if_needed()
    loc.click()


def click_next(page):
    loc = page.locator(".s3d-tut-nav .s3d-primary")
    loc.scroll_into_view_if_needed()
    loc.click()


def wait_done(page, idx, timeout):
    t0 = time.time()
    s = wait_until(page, lambda s: s["tutorial"]["done"][idx], timeout=timeout)
    return (s is not None), round(time.time() - t0, 1), s


results = []
with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b, mobile=MOBILE)
    s = open_route(page, "tutorial")
    assert s["mode"] == "tutorial", s["mode"]
    time.sleep(1)
    shot(page, f"tut_{TAG}_01.png")

    # 1: dua sudut kamera
    click_action(page, "Kejar")
    time.sleep(0.4)
    click_action(page, "Atas")
    ok, dt, s = wait_done(page, 0, 5)
    results.append(("1 kamera", ok, dt))
    click_next(page)
    time.sleep(1.2)
    shot(page, f"tut_{TAG}_02.png")

    # 2: LiDAR mati lalu nyala
    click_action(page, "LiDAR")
    time.sleep(0.5)
    click_action(page, "LiDAR")
    ok, dt, s = wait_done(page, 1, 5)
    results.append(("2 lidar", ok, dt))
    click_next(page)
    time.sleep(0.5)
    s = snap(page)
    results.append(("3 belum selesai saat masuk", not s["tutorial"]["done"][2], 0))
    ok, dt, s = wait_done(page, 2, 40)
    results.append(("3 persepsi", ok, dt))
    shot(page, f"tut_{TAG}_03.png")
    click_next(page)
    time.sleep(0.8)

    # 4: taruh mobil mogok dan tunggu menyalip
    click_action(page, "Taruh mobil mogok")
    time.sleep(2.5)
    shot(page, f"tut_{TAG}_04a.png")
    ok, dt, s = wait_done(page, 3, 90)
    results.append(("4 menyalip", ok, dt))
    if not ok:
        s = snap(page)
        print("langkah 4 macet:", s["ego"]["behavior"], s["ego"]["reason"], s["ego"]["plan"], s["counters"])
    shot(page, f"tut_{TAG}_04b.png")
    click_next(page)
    time.sleep(0.6)

    # 5: ubah kecepatan target
    click_action(page, f"{SPEED} km/jam")
    ok, dt, s = wait_done(page, 4, 5)
    results.append((f"5 kecepatan {SPEED}", ok, dt))
    time.sleep(1.5)
    shot(page, f"tut_{TAG}_05.png")
    click_next(page)
    time.sleep(0.5)

    # 6: tunggu cukup cepat lalu pejalan kaki menyeberang
    s = wait_until(page, lambda s: s["ego"]["speedKmh"] > min(38, float(SPEED) - 3) and s["ego"]["behavior"] in ("Melaju", "Mengikuti"), timeout=40)
    v0 = snap(page)["ego"]["speedKmh"]
    col0 = snap(page)["counters"]["collisions"]
    click_action(page, "Pejalan kaki")
    ok, dt, s = wait_done(page, 5, 30)
    s = snap(page)
    results.append((f"6 AEB dari {v0:.0f} km/jam", ok, dt))
    results.append(("6 tanpa tabrakan", s["counters"]["collisions"] == col0, s["counters"]["collisions"]))
    time.sleep(0.3)
    shot(page, f"tut_{TAG}_06.png")
    click_next(page)
    time.sleep(0.6)

    # 7: cuaca
    click_action(page, "Hujan")
    ok, dt, s = wait_done(page, 6, 5)
    results.append(("7 cuaca", ok, dt))
    time.sleep(2)
    shot(page, f"tut_{TAG}_07.png")
    click_next(page)
    time.sleep(1.0)

    # 8: lampu
    click_action(page, "Waktu tetap")
    ok, dt, s = wait_done(page, 7, 5)
    results.append(("8 lampu", ok, dt))
    time.sleep(1.5)
    shot(page, f"tut_{TAG}_08.png")
    click_next(page)
    time.sleep(1.0)
    shot(page, f"tut_{TAG}_09.png")

    # 9: tombol Buka Mode Bebas
    s = snap(page)
    results.append(("9 langkah terakhir", s["tutorial"]["step"] == 9, s["tutorial"]["step"]))
    click_next(page)
    time.sleep(1.2)
    s = snap(page)
    results.append(("pindah ke bebas", s["mode"] == "bebas" and page.evaluate("location.hash") == "#/simulator/bebas", page.evaluate("location.hash")))
    shot(page, f"tut_{TAG}_bebas.png")

    s = snap(page)
    print("done", s["tutorial"]["done"], "counters", s["counters"])
    for r in results:
        print(("OK  " if r[1] else "GAGAL"), r[0], r[2])
    print("LOG", log, "resets", page.resets)
    b.close()
