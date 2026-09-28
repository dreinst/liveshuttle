"""Jalankan seluruh Mode Tutorial lewat UI dan papan ketik nyata (rute #/simulator/tutorial)."""
import sys
import time
from sim3d_qa_fungsi_util import BASE, launch, new_page, snap, wait_ready, wait_until, shot, text, dump, sync_playwright

mobile = "--mobile" in sys.argv
tag = "m" if mobile else "d"
res = {}


def done(page, i):
    s = snap(page)
    return s["tutorial"]["done"][i]


def card(page):
    return page.evaluate("""() => ({
      step: document.querySelector('.s3d-tut-step')?.textContent,
      title: document.querySelector('.s3d-tut-title')?.textContent,
      task: document.querySelector('.s3d-task-text')?.textContent,
      state: document.querySelector('.s3d-task-state')?.textContent,
      taskDone: document.querySelector('.s3d-task')?.dataset.done,
      next: document.querySelector('.s3d-tut-nav .s3d-primary')?.textContent,
      prevDisabled: document.querySelector('.s3d-tut-nav .s3d-ghost')?.disabled,
      pulse: [...document.querySelectorAll('.is-pulse')].map(e => e.getAttribute('aria-label') || e.dataset.hl || e.dataset.tab || e.textContent.slice(0,20)),
      dots: [...document.querySelectorAll('.s3d-dots li')].map(l => l.dataset.state).join(','),
    })""")


def click_next(page):
    page.click(".s3d-tut-nav .s3d-primary")
    time.sleep(0.6)


with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b, mobile=mobile)
    page.goto(f"{BASE}/#/simulator/tutorial")
    wait_ready(page)
    time.sleep(1.5)
    s = snap(page)
    print("awal", s["camera"], s["tutorial"]["step"], card(page))

    # Langkah 1: kamera
    t0 = time.time()
    if mobile:
        page.click(".s3d-tut-actions button:has-text('Kejar')")
        time.sleep(0.4)
        page.click(".s3d-tut-actions button:has-text('Atas')")
    else:
        page.click(".s3d-group[data-hl=kamera] button[data-value=kejar]")
        time.sleep(0.4)
        page.keyboard.press("3")
    time.sleep(0.5)
    s = snap(page)
    res["1_kamera"] = (s["tutorial"]["done"][0], s["camera"], round(time.time() - t0, 1))
    print("L1", res["1_kamera"], card(page))
    shot(page, f"tut_{tag}_1.png")

    # Langkah 2: LiDAR
    click_next(page)
    print("L2 masuk", snap(page)["camera"], card(page))
    if mobile:
        page.click(".s3d-tut-actions button")
    else:
        page.keyboard.press("l")
    time.sleep(0.4)
    s1 = snap(page)
    if mobile:
        page.click(".s3d-tut-actions button")
    else:
        page.click(".s3d-panel[data-tab=persepsi] .s3d-toggle:has-text('LiDAR')")
    time.sleep(0.5)
    s = snap(page)
    res["2_lidar"] = (s["tutorial"]["done"][1], s1["layers"]["lidar"], s["layers"]["lidar"])
    print("L2", res["2_lidar"], card(page))
    shot(page, f"tut_{tag}_2.png")

    # Langkah 3: persepsi
    click_next(page)
    t0 = time.time()
    s = wait_until(page, lambda s: s["tutorial"]["done"][2], timeout=60)
    res["3_persepsi"] = (bool(s), round(time.time() - t0, 1), s and s["perception"])
    print("L3", res["3_persepsi"], card(page))
    shot(page, f"tut_{tag}_3.png")

    # Langkah 4: mobil mogok, menyalip
    click_next(page)
    print("L4 masuk", snap(page)["camera"], card(page))
    page.click(".s3d-tut-actions button:has-text('mobil mogok')")
    t0 = time.time()
    time.sleep(1.5)
    shot(page, f"tut_{tag}_4a.png")
    s = wait_until(page, lambda s: s["tutorial"]["done"][3], timeout=90)
    last = snap(page)
    res["4_menyalip"] = (bool(s), round(time.time() - t0, 1), last["counters"], last["ego"]["behavior"], last["traffic"]["obstacles"])
    print("L4", res["4_menyalip"], card(page))
    shot(page, f"tut_{tag}_4b.png")

    # Langkah 5: kecepatan target
    click_next(page)
    if mobile:
        page.click(".s3d-tut-actions button:has-text('30 km/jam')")
    else:
        page.focus("#s3d-target")
        page.keyboard.press("ArrowLeft")
        page.keyboard.press("ArrowLeft")
    time.sleep(0.8)
    s = snap(page)
    res["5_kontrol"] = (s["tutorial"]["done"][4], s["ego"]["targetKmh"], text(page, "#s3d-target-out"))
    print("L5", res["5_kontrol"], card(page))
    shot(page, f"tut_{tag}_5.png")
    # kembalikan target ke 50 lewat tombol aksi supaya langkah 6 bisa cepat
    page.click(".s3d-tut-actions button:has-text('50 km/jam')")
    time.sleep(0.3)

    # Langkah 6: pejalan kaki mendadak dan AEB
    click_next(page)
    t0 = time.time()
    ok = False
    tries = []
    for attempt in range(6):
        wait_until(page, lambda s: s["ego"]["speedKmh"] > 35 and s["ego"]["behavior"] in ("Melaju", "Mengikuti"), timeout=40)
        s0 = snap(page)
        if mobile:
            page.click(".s3d-tut-actions button")
        else:
            page.keyboard.press("j")
        s = wait_until(page, lambda s: s["tutorial"]["done"][5], timeout=10)
        last = snap(page)
        tries.append((round(s0["ego"]["speedKmh"]), s0["ego"]["behavior"], last["counters"]["jaywalkers"], last["counters"]["aebAuto"], last["counters"]["collisions"]))
        if s:
            ok = True
            break
    res["6_aeb"] = (ok, round(time.time() - t0, 1), tries)
    print("L6", res["6_aeb"], card(page))
    shot(page, f"tut_{tag}_6.png")

    # Langkah 7: cuaca
    click_next(page)
    if mobile:
        page.click(".s3d-tut-actions button:has-text('Kabut')")
    else:
        page.click(".s3d-group[data-hl=cuaca] button[data-value=kabut]")
    time.sleep(1.5)
    s = snap(page)
    res["7_cuaca"] = (s["tutorial"]["done"][6], s["weather"], s["sensing"]["lidarRange"], s["sensing"]["cameraRange"])
    time.sleep(6)
    s = snap(page)
    res["7_cuaca_speed"] = (round(s["ego"]["speedKmh"]), s["ego"]["behavior"], s["ego"]["reason"])
    print("L7", res["7_cuaca"], res["7_cuaca_speed"], card(page))
    shot(page, f"tut_{tag}_7.png")

    # Langkah 8: kota pintar
    click_next(page)
    print("L8 masuk", snap(page)["camera"], card(page))
    if mobile:
        page.click(".s3d-tut-actions button:has-text('Waktu tetap')")
    else:
        page.click(".s3d-panel[data-tab=kota] button[data-value=tetap]")
    time.sleep(0.6)
    s = snap(page)
    res["8_kota"] = (s["tutorial"]["done"][7], s["signalMode"])
    print("L8", res["8_kota"], card(page))
    shot(page, f"tut_{tag}_8.png")

    # Langkah 9: selesai
    click_next(page)
    c9 = card(page)
    print("L9", c9)
    shot(page, f"tut_{tag}_9.png")
    page.click(".s3d-tut-nav .s3d-primary")
    time.sleep(1.2)
    s = snap(page)
    res["9_bebas"] = (s["mode"], page.evaluate("location.hash"), page.evaluate("document.querySelector('.s3d').dataset.mode"))
    print("L9 ->", res["9_bebas"])
    shot(page, f"tut_{tag}_9_bebas.png")

    # kembali ke tutorial lewat tab: tugas yang selesai tetap tercentang?
    page.click(".s3d-modes button[data-mode=tutorial]")
    time.sleep(0.8)
    s = snap(page)
    res["kembali"] = (s["mode"], s["tutorial"]["step"], s["tutorial"]["done"], page.evaluate("location.hash"))
    print("kembali", res["kembali"], card(page))
    dump(res)
    print("LOG", log, "resets", len(page.resets))
    b.close()
