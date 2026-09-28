"""Uji UI pelajaran Perencanaan Rute: semua tugas lewat antarmuka, di desktop dan ponsel.

Pemakaian: python3 tests/serve.py 8245 (di latar), lalu python3 tests/rute_qa.py [desktop|mobile|all]
Tangkapan layar: tests/shots/rute/qa-*.png
"""
import sys

sys.path.insert(0, "/Users/mcdonny/Downloads/ndur/driverless-sim/tests")
from rute_util import Session  # noqa: E402

FAIL = []


def expect(cond, msg):
    print(("OK   " if cond else "GAGAL") + " " + msg)
    if not cond:
        FAIL.append(msg)


def lanjut(S):
    S.page.locator(".step-nav .btn-primary").first.click()
    S.page.wait_for_timeout(350)


def wait_search(S, timeout=40000):
    return S.wait_until("() => !window.__rute.snapshot().searching", timeout)


def run(mobile):
    tag = "mobile" if mobile else "desktop"
    print(f"===== {tag} =====")
    with Session(mobile=mobile) as S:
        p = S.page
        S.go()
        p.evaluate("() => localStorage.removeItem('liveshuttle.progress.v1')")
        S.go()
        snap = S.snap()
        expect(snap["start"]["label"] == "Universitas Ma Chung" and snap["goal"]["label"] == "Alun-Alun Merdeka", f"{tag}: start dan tujuan bawaan bernama")
        expect(p.locator(".sim-canvas").get_attribute("role") == "img", f"{tag}: kanvas role img")
        S.scroll_stage()
        S.shot(f"qa-{tag}-0-load", selector=".stage")

        # ---- langkah 1: A* ----
        S.click_button("Cari rute")
        p.wait_for_timeout(1500 if not mobile else 1200)
        S.scroll_stage()
        S.shot(f"qa-{tag}-1-searching", selector=".stage")
        mid = S.snap()
        expect(mid["searching"] and mid["expanded"] > 50, f"{tag}: pencarian beranimasi ({mid['expanded']} node setelah sekitar 1,5 detik)")
        expect(wait_search(S), f"{tag}: pencarian A* selesai")
        p.wait_for_timeout(700)
        snap = S.snap()
        expect(snap["route"] and abs(snap["route"]["length"] - 6034) < 30, f"{tag}: rute Ma Chung ke Alun-Alun sekitar 6,03 km ({snap['route'] and round(snap['route']['length'])} m)")
        expect("first-route" in S.done_tasks(), f"{tag}: tugas first-route selesai")
        S.scroll_stage()
        S.shot(f"qa-{tag}-1-route", selector=".stage")
        status = S.status()
        expect("6,03 km" in status and "3.378 node" in status, f"{tag}: status menyebut panjang dan node ({status})")

        # ---- langkah 2: Dijkstra lalu A* ----
        lanjut(S)
        expect(S.snap()["algorithm"] == "dijkstra", f"{tag}: langkah 2 memilih Dijkstra")
        S.click_button("Cari rute")
        p.wait_for_timeout(600)
        S.click_button("Lewati animasi")
        expect(wait_search(S), f"{tag}: Dijkstra selesai (dilewati)")
        S.seg("A*")
        S.click_button("Cari rute")
        expect(wait_search(S), f"{tag}: A* selesai")
        p.wait_for_timeout(700)
        res = S.snap()["results"]
        expect(res["astar"]["expanded"] < res["dijkstra"]["expanded"] and abs(res["astar"]["time"] - res["dijkstra"]["time"]) < 0.01,
               f"{tag}: A* {res['astar']['expanded']} node < Dijkstra {res['dijkstra']['expanded']} node, waktu sama")
        expect("compare" in S.done_tasks(), f"{tag}: tugas compare selesai")
        table = p.locator(".grp-compare .data-table").inner_text()
        expect("3.378" in table and "5.627" in table, f"{tag}: tabel memuat 3.378 dan 5.627")
        note = p.locator(".compare-note").inner_text()
        expect("persen" in note, f"{tag}: catatan perbandingan ({note})")

        # ---- langkah 3: tutup jalan dengan mengetuk rute ----
        lanjut(S)
        snap = S.snap()
        expect(snap["route"] is not None and snap["tool"] == "tutup", f"{tag}: langkah 3 punya rute siap dan alat Tutup jalan")
        old_roads = set(snap["route"]["roads"])
        S.scroll_stage()
        pt = p.evaluate("() => window.__rute.routePoint(0.5)")
        S.tap_canvas(pt)
        snap = S.snap()
        closed = [r for st in snap["stretches"] if st["kind"] == "tutup" for r in st["roads"]]
        expect(len(closed) > 0 and any(r in old_roads for r in closed), f"{tag}: ketukan menutup jalan di rute ({snap['stretches'][:1]})")
        expect(snap["route"]["stale"], f"{tag}: rute lama ditandai usang")
        S.shot(f"qa-{tag}-3-closed", selector=".stage")
        S.click_button("Cari rute")
        expect(wait_search(S), f"{tag}: cari ulang selesai")
        p.wait_for_timeout(600)
        snap = S.snap()
        expect(not (set(snap["route"]["roads"]) & set(closed)), f"{tag}: rute baru menghindari jalan ditutup")
        expect("closure" in S.done_tasks(), f"{tag}: tugas closure selesai")
        S.scroll_stage()
        S.shot(f"qa-{tag}-3-rerouted", selector=".stage")
        # ketuk jalan yang ditutup lagi: terbuka
        S.seg("Tutup jalan")
        mids = p.evaluate("""() => { const s = window.__rute.snapshot(); return s.stretches.length; }""")
        expect(mids == 1, f"{tag}: satu potongan ditutup")

        # ---- langkah 4: macet ----
        lanjut(S)
        snap = S.snap()
        expect(snap["tool"] == "macet" and snap["route"] is not None, f"{tag}: langkah 4 memilih alat Macet")
        done = False
        for attempt, frac in enumerate([0.5, 0.35, 0.65, 0.2]):
            if attempt == 2:
                S.seg("8 kali")
            S.scroll_stage()
            pt = p.evaluate(f"() => window.__rute.routePoint({frac})")
            S.tap_canvas(pt)
            S.click_button("Cari rute")
            wait_search(S)
            p.wait_for_timeout(700)
            if "traffic" in S.done_tasks():
                done = True
                break
        snap = S.snap()
        jams = [r for st in snap["stretches"] if st["kind"] == "macet" for r in st["roads"]]
        expect(done, f"{tag}: tugas traffic selesai setelah {attempt + 1} potongan macet")
        expect(not (set(snap["route"]["roads"]) & set(jams)) or not done, f"{tag}: rute baru tidak lewat semua jalan macet")
        S.scroll_stage()
        S.shot(f"qa-{tag}-4-jam", selector=".stage")

        # ---- langkah 5: jalankan mobil, tutup jalan di depan ----
        lanjut(S)
        S.click_button("Jalankan mobil")
        p.wait_for_timeout(1500)
        snap = S.snap()
        expect(snap["car"]["state"] == "driving" and snap["car"]["s"] > 5, f"{tag}: mobil melaju (s = {round(snap['car']['s'])} m)")
        S.scroll_stage()
        replanned = False
        for dist in (350, 500, 250, 700):
            pt = p.evaluate(f"() => window.__rute.aheadPoint({dist})")
            S.tap_canvas(pt)
            p.wait_for_timeout(300)
            if S.snap()["route"]["replanned"]:
                replanned = True
                break
        if not replanned:
            S.click_button("Tutup jalan di rute")
            p.wait_for_timeout(300)
            replanned = S.snap()["route"]["replanned"]
        expect(replanned, f"{tag}: rute dihitung ulang saat melaju")
        S.scroll_stage()
        S.shot(f"qa-{tag}-5-replan", selector=".stage")
        ok = S.wait_until("() => window.__simotonom.completedTasks.includes('replan-live')", 8000)
        expect(ok, f"{tag}: tugas replan-live selesai")
        # ikuti mobil sampai berhenti di lampu merah (kalau ada di rute)
        p.locator('button[aria-label="Ikuti mobil"]').click()
        S.seg("30 kali")
        held = S.wait_until("() => { const s = window.__rute.snapshot(); return s.car.hold || s.car.state === 'arrived'; }", 90000)
        snap = S.snap()
        if snap["car"]["hold"]:
            nx = snap["next"]
            expect(nx and nx["state"] in ("red", "yellow") and 0 <= nx["dist"] < 3, f"{tag}: mobil berhenti sebelum garis henti ({nx})")
            S.scroll_stage()
            S.shot(f"qa-{tag}-5-red", selector=".stage")
        arrived = S.wait_until("() => window.__rute.snapshot().car.state === 'arrived'", 150000)
        expect(arrived, f"{tag}: mobil sampai di tujuan")
        snap = S.snap()
        expect(snap["safety"]["redRuns"] == 0 and snap["safety"]["pedContacts"] == 0, f"{tag}: 0 terobos lampu merah, 0 kontak pejalan kaki ({snap['safety']})")
        expect(snap["safety"]["clamps"] == 0, f"{tag}: perisai tidak perlu menjepit")
        S.scroll_stage()
        S.shot(f"qa-{tag}-5-arrived", selector=".stage")
        print("   status:", S.status())
        expect(sorted(S.done_tasks()) == sorted(["first-route", "compare", "closure", "traffic", "replan-live"]), f"{tag}: semua tugas selesai ({S.done_tasks()})")
        red_text = p.locator(".readout", has_text="Terobos lampu merah").inner_text()
        expect(red_text.strip().endswith("0"), f"{tag}: panel menampilkan terobos 0")

        # ---- kamera: tombol perbesar, perkecil, seluruh rute ----
        p.locator('button[aria-label="Tampilkan start dan tujuan"]').click()
        s0 = S.snap()["scale"]
        p.locator('button[aria-label="Perbesar peta"]').click()
        p.wait_for_timeout(100)
        s1 = S.snap()["scale"]
        expect(s1 > s0 * 1.5 and S.snap()["cam"] == "manual", f"{tag}: tombol perbesar ({s0:.3f} ke {s1:.3f})")
        p.locator('button[aria-label="Tampilkan start dan tujuan"]').click()
        p.wait_for_timeout(100)
        expect(abs(S.snap()["scale"] - s0) < 1e-6, f"{tag}: kembali ke tampilan start dan tujuan")

        # ---- pilih tempat lain dari daftar ----
        S.select("goal", "stasiun")
        snap = S.snap()
        expect(snap["goal"]["label"].startswith("Stasiun Malang") and snap["route"] is None, f"{tag}: tujuan diganti ke Stasiun Malang")
        S.click_button("Cari rute")
        S.click_button("Lewati animasi")
        wait_search(S)
        p.wait_for_timeout(300)
        expect(S.snap()["route"] is not None, f"{tag}: rute ke Stasiun Malang ditemukan")
        S.click_button("Tukar start dan tujuan")
        expect(S.snap()["start"]["label"].startswith("Stasiun"), f"{tag}: tukar start dan tujuan")

        # ---- ringkasan, tinggalkan halaman, kembali ----
        p.goto(S.page.url.split("#")[0] + "#/", wait_until="load")
        p.wait_for_timeout(800)
        expect(p.evaluate("() => window.__rute === undefined"), f"{tag}: kait pengujian dibersihkan setelah keluar")
        loops_home = S.hook().get("activeLoops")
        S.go()
        S.go("#/pelajaran/level-otomasi", wait_ready=False)
        p.wait_for_timeout(800)
        S.go()
        expect(S.hook().get("activeLoops") == 1, f"{tag}: satu loop aktif setelah bolak-balik (beranda {loops_home})")
        expect(not S.errors, f"{tag}: tanpa galat atau peringatan konsol {S.errors[:5]}")


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    if which in ("desktop", "all"):
        run(False)
    if which in ("mobile", "all"):
        run(True)
    print("GAGAL:", FAIL if FAIL else "tidak ada")
    sys.exit(1 if FAIL else 0)
