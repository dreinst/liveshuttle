"""Uji tutorial: selesaikan tugas tiap langkah lewat antarmuka, simpan tangkapan layar tiap langkah.

Pemakaian: python3 sim3d_tutorial.py [desktop|mobile] [harness|route]
"""
import sys
import time

from sim3d_common import BASE, launch, new_page, snap, wait_ready, wait_until, shot, sync_playwright

layout = sys.argv[1] if len(sys.argv) > 1 else "desktop"
where = sys.argv[2] if len(sys.argv) > 2 else "harness"
mobile = layout == "mobile"
tag = f"{'m' if mobile else 'd'}_{where}"


def done(page, i):
    return snap(page)["tutorial"]["done"][i]


def open_tab(page, tab):
    if mobile:
        page.click(f".s3d-tab[data-tab='{tab}']")
        time.sleep(0.2)


def act(page, text):
    """Klik tombol aksi cepat di kartu tutorial."""
    open_tab(page, "tutorial")
    page.click(f".s3d-tut-actions button:has-text('{text}')")


def nxt(page):
    open_tab(page, "tutorial")
    page.click(".s3d-tut-nav .s3d-primary")
    time.sleep(0.4)


results = []
with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b, mobile)
    url = f"{BASE}/tests/sim3d_harness.html?mode=tutorial" if where == "harness" else f"{BASE}/#/simulator/tutorial"
    page.goto(url)
    wait_ready(page)
    time.sleep(1.5)
    shot(page, f"tut_{tag}_1_start.png")

    # Langkah 1: coba dua kamera lain (papan ketik di desktop, tombol di ponsel)
    if mobile:
        act(page, "Kejar")
        time.sleep(0.5)
        act(page, "Atas")
    else:
        page.keyboard.press("2")
        time.sleep(0.5)
        page.keyboard.press("3")
    time.sleep(0.6)
    results.append(("1 kamera", done(page, 0)))
    shot(page, f"tut_{tag}_1_done.png")
    nxt(page)

    # Langkah 2: LiDAR mati lalu nyala
    time.sleep(1.0)
    shot(page, f"tut_{tag}_2.png")
    if mobile:
        act(page, "LiDAR")
        time.sleep(0.4)
        act(page, "LiDAR")
    else:
        page.keyboard.press("l")
        time.sleep(0.4)
        page.keyboard.press("l")
    time.sleep(0.5)
    results.append(("2 lidar", done(page, 1)))
    nxt(page)

    # Langkah 3: persepsi, tunggu otomatis
    s = wait_until(page, lambda s: s["tutorial"]["done"][2], 40)
    results.append(("3 persepsi", bool(s)))
    shot(page, f"tut_{tag}_3.png")
    if mobile:
        open_tab(page, "persepsi")
        time.sleep(0.4)
        shot(page, f"tut_{tag}_3_panel.png")
    nxt(page)

    # Langkah 4: mobil mogok lalu menyalip
    time.sleep(0.8)
    ok4 = False
    for attempt in range(4):
        wait_until(page, lambda s: s["ego"]["speedKmh"] > 20 and s["ego"]["behavior"] in ("Melaju", "Mengikuti"), 60)
        act(page, "Taruh mobil mogok")
        s = wait_until(page, lambda s: s["ego"]["behavior"] == "Menyalip", 20)
        if s:
            time.sleep(0.8)
            shot(page, f"tut_{tag}_4_menyalip.png")
        s = wait_until(page, lambda s: s["tutorial"]["done"][3], 40)
        if s:
            ok4 = True
            break
        page.click(".s3d-panel[data-tab='uji'] button:has-text('Hapus rintangan')", force=True) if not mobile else None
    results.append(("4 menyalip", ok4))
    shot(page, f"tut_{tag}_4_done.png")
    nxt(page)

    # Langkah 5: ubah kecepatan target
    act(page, "30 km/jam")
    time.sleep(0.8)
    results.append(("5 kecepatan", done(page, 4)))
    if mobile:
        open_tab(page, "kontrol")
        time.sleep(0.4)
    shot(page, f"tut_{tag}_5.png")
    act(page, "50 km/jam")
    nxt(page)

    # Langkah 6: pejalan kaki mendadak dan rem darurat
    ok6 = False
    for attempt in range(4):
        wait_until(page, lambda s: s["ego"]["speedKmh"] > 38 and s["ego"]["behavior"] == "Melaju", 90)
        if mobile:
            act(page, "Pejalan kaki")
        else:
            page.keyboard.press("j")
        s = wait_until(page, lambda s: s["tutorial"]["done"][5], 15, every=0.1)
        if s:
            time.sleep(0.2)
            shot(page, f"tut_{tag}_6_aeb.png")
            ok6 = True
            break
    results.append(("6 rem darurat", ok6))
    nxt(page)

    # Langkah 7: cuaca
    act(page, "Kabut")
    time.sleep(1.5)
    results.append(("7 cuaca", done(page, 6)))
    shot(page, f"tut_{tag}_7_kabut.png")
    act(page, "Cerah")
    nxt(page)

    # Langkah 8: lampu adaptif atau waktu tetap
    act(page, "Waktu tetap")
    time.sleep(1.0)
    results.append(("8 kota pintar", done(page, 7)))
    shot(page, f"tut_{tag}_8.png")
    act(page, "Adaptif")
    nxt(page)

    # Langkah 9: ke Mode Bebas
    time.sleep(0.5)
    shot(page, f"tut_{tag}_9.png")
    open_tab(page, "tutorial")
    page.click(".s3d-tut-nav .s3d-primary")
    time.sleep(1.0)
    s = snap(page)
    results.append(("9 mode bebas", s["mode"] == "bebas"))
    results.append(("hash", page.evaluate("() => location.hash")))
    shot(page, f"tut_{tag}_bebas.png")
    s = snap(page)
    print("counters", s["counters"], "collisions", s["counters"]["collisions"])
    for r in results:
        print("HASIL", r)
    print("done flags", s["tutorial"]["done"])
    for d in s.get("debug", []):
        if d.get("type") != "npc-20s":
            print("DEBUG", d)
    print("LOG:", "\n".join(log[:30]) or "(kosong)")
    b.close()
