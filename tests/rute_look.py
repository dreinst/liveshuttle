"""Tangkapan layar untuk dinilai dengan mata: lampu di jalan dari dekat, jalan satu arah, sorotan alat,
mobil menunggu tanpa rute, dan gerak dikurangi. Pemakaian: python3 tests/rute_look.py (server port 8245).
"""
import sys

sys.path.insert(0, "/Users/mcdonny/Downloads/ndur/driverless-sim/tests")
from rute_util import Session  # noqa: E402

FAIL = []


def expect(cond, msg):
    print(("OK   " if cond else "GAGAL") + " " + msg)
    if not cond:
        FAIL.append(msg)


def street_red(S, tag):
    p = S.page
    S.goto_step(4)
    S.seg("15 kali")
    S.click_button("Jalankan mobil")
    p.locator('button[aria-label="Ikuti mobil"]').click()
    ok = S.wait_until("() => window.__rute.snapshot().car.hold", 90000)
    expect(ok, f"{tag}: mobil menunggu di lampu merah")
    p.locator('[data-act="pause"]').first.click()
    S.scroll_stage()
    S.shot(f"look-{tag}-red-follow", selector=".stage")
    p.locator('button[aria-label="Perbesar peta"]').click()
    p.wait_for_timeout(200)
    S.shot(f"look-{tag}-red-close", selector=".stage")
    p.locator('[data-act="pause"]').first.click()
    ok = S.wait_until("() => { const s = window.__rute.snapshot(); return !s.car.hold && s.car.v > 2; }", 60000)
    expect(ok, f"{tag}: mobil berangkat lagi setelah hijau")
    snap = S.snap()
    expect(snap["safety"]["redRuns"] == 0, f"{tag}: terobos lampu merah tetap 0")
    S.click_button("Batalkan perjalanan")


with Session() as S:
    p = S.page
    S.go()
    street_red(S, "desktop")
    # jalan satu arah
    p.locator(".ctl-toggle", has_text="Tandai jalan satu arah").click()
    p.locator('button[aria-label="Tampilkan start dan tujuan"]').click()
    p.wait_for_timeout(300)
    S.shot("look-desktop-oneway", selector=".stage")
    for _ in range(3):
        p.locator('button[aria-label="Perbesar peta"]').click()
    p.wait_for_timeout(300)
    S.shot("look-desktop-oneway-zoom", selector=".stage")
    p.locator(".ctl-toggle", has_text="Tandai jalan satu arah").click()
    # sorotan alat saat mouse di atas rute
    p.locator('button[aria-label="Tampilkan start dan tujuan"]').click()
    pt = p.evaluate("() => window.__rute.routePoint(0.62)")
    box = S.canvas_box()
    p.mouse.move(box["x"] + pt["x"], box["y"] + pt["y"])
    p.wait_for_timeout(300)
    S.shot("look-desktop-hover", selector=".stage")
    # geser peta dengan mouse
    s0 = S.snap()
    p.mouse.move(box["x"] + 300, box["y"] + 300)
    p.mouse.down()
    p.mouse.move(box["x"] + 200, box["y"] + 250, steps=6)
    p.mouse.up()
    s1 = S.snap()
    expect(s1["cam"] == "manual", "desktop: menyeret peta beralih ke kamera manual")
    # Pindah: ketuk titik di peta sebagai tujuan
    p.locator('button[aria-label="Tampilkan start dan tujuan"]').click()
    S.seg("Pindah")
    S.seg("Tujuan")
    pt = p.evaluate("() => window.__rute.placePoint('ijen')")
    S.tap_canvas(pt)
    expect(S.snap()["goal"]["label"] == "Jalan Besar Ijen", f"desktop: ketuk tempat bernama memilih tujuan ({S.snap()['goal']['label']})")
    pt = p.evaluate("() => window.__rute.placePoint('ijen')")
    S.tap_canvas({"x": pt["x"] - 60, "y": pt["y"] + 40})
    g = S.snap()["goal"]
    expect(g["place"] is None and g["label"], f"desktop: ketuk titik bebas memilih simpang ({g['label']})")
    sel = p.locator("select.rute-select").nth(1).input_value()
    expect(sel == "peta", "desktop: daftar tujuan menampilkan titik di peta")
    S.click_button("Cari rute")
    S.click_button("Lewati animasi")
    S.wait_until("() => !window.__rute.snapshot().searching")
    S.shot("look-desktop-custom-goal", selector=".stage")
    expect(not S.errors, f"desktop: tanpa galat {S.errors[:3]}")

with Session(mobile=True) as S:
    S.go()
    street_red(S, "mobile")
    expect(not S.errors, f"mobile: tanpa galat {S.errors[:3]}")

with Session(reduced=True) as S:
    p = S.page
    S.go()
    S.click_button("Cari rute")
    p.wait_for_timeout(1200)
    S.shot("look-reduced-search", selector=".stage")
    S.wait_until("() => !window.__rute.snapshot().searching")
    S.wait_until("() => window.__simotonom.completedTasks.includes('first-route')", 5000)
    expect("first-route" in S.done_tasks(), "gerak dikurangi: tugas pertama tetap bisa diselesaikan")
    expect(not S.errors, f"gerak dikurangi: tanpa galat {S.errors[:3]}")

print("GAGAL:", FAIL if FAIL else "tidak ada")
sys.exit(1 if FAIL else 0)
