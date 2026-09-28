"""QA mandiri pelajaran Kendali: kasus tepi dan tangkapan layar panggung.

  1. Langkah 4 dengan pengendali P saja (Ki 0) lalu kecepatan target diturunkan 40 ke 30 km/jam.
     Mobil hanya berhenti sedikit di bawah target (selisih tetap), jadi tugas pid-overshoot TIDAK
     boleh selesai dan overshoot harus "tidak diukur".
  2. Label "Ld" dan "titik tujuan" tidak boleh tertutup chip HUD atau keluar kanvas (Ld 17 m).
  3. Tampilan seluruh lintasan: penunjuk setir tidak menutupi lintasan.

Pemakaian: python3 tests/kontrol_indep_edge.py [--mobile] [--port 8136]
"""
import json
import sys

sys.path.insert(0, __file__.rsplit("/", 1)[0])
import kontrol_indep_qa as q  # noqa: E402  (dipakai hanya kelas S dan pengaturannya)

R = {"mode": "mobile" if q.MOBILE else "desktop"}
with q.S() as s:
    s.page.goto(q.BASE + "#/", wait_until="load")
    s.page.evaluate("() => localStorage.clear()")
    s.page.goto(q.BASE + "#/pelajaran/kontrol", wait_until="load")
    s.page.wait_for_timeout(2000)
    s.speed("2x")

    # ---------- 1. P saja, target turun ----------
    s.go_step(3)
    R["ki0"] = s.drag_slider("Ki", 0)
    R["kp05"] = s.drag_slider("Kp", 0.5)
    s.tap(s.page.locator(".lesson-kontrol .btn", has_text="Uji dari diam"))
    s.page.wait_for_timeout(9000)
    R["p_only_up"] = {k: v for k, v in s.readouts().items() if k in ("Kecepatan", "Overshoot kecepatan", "Waktu mencapai target")}
    R["target30"] = s.drag_slider("Kecepatan target", 30)
    s.page.wait_for_timeout(8000)
    R["p_only_down"] = {k: v for k, v in s.readouts().items() if k in ("Kecepatan", "Overshoot kecepatan", "Waktu mencapai target")}
    R["p_only_down_note"] = s.note()
    R["p_only_down_done"] = s.done()
    # target naik lagi: diukur lagi
    R["target50"] = s.drag_slider("Kecepatan target", 50)
    s.page.wait_for_timeout(7000)
    R["p_only_up2"] = {k: v for k, v in s.readouts().items() if k in ("Kecepatan", "Overshoot kecepatan", "Waktu mencapai target")}
    R["p_only_up2_note"] = s.note()

    # ---------- 2. label Ld pada Ld besar ----------
    s.go_step(1)
    R["ld17"] = s.drag_slider("Lookahead Ld", 17)
    for i in range(3):
        s.page.wait_for_timeout(2500)
        s.shot(f"e{i}-ld17-panggung", selector=".stage")
    s.go_step(0)
    s.page.wait_for_timeout(1500)
    s.shot("e3-ld8-panggung", selector=".stage")
    R["ld20"] = s.drag_slider("Lookahead Ld", 20)
    s.page.wait_for_timeout(3000)
    s.shot("e4-ld20-panggung", selector=".stage")

    # ---------- 3. seluruh lintasan ----------
    s.tap(s.page.locator(".seg-btn", has_text="Seluruh lintasan"))
    s.page.wait_for_timeout(2500)
    s.shot("e5-seluruh-panggung", selector=".stage")
    # pengambilalihan saat seluruh lintasan tampil: chip HUD bertambah, lintasan tidak boleh tertutup
    R["ld15_small"] = s.drag_slider("Lookahead Ld", 1.5)
    for _ in range(80):
        if "[tersembunyi]" not in s.hud().get("Pengemudi cadangan", "[tersembunyi]"):
            break
        s.page.wait_for_timeout(250)
    s.page.wait_for_timeout(600)
    R["takeover_hud"] = s.hud()
    s.shot("e5b-seluruh-cadangan", selector=".stage")
    s.drag_slider("Lookahead Ld", 8)
    s.tap(s.page.locator(".seg-btn", has_text="Ikuti mobil"))
    s.page.wait_for_timeout(800)
    s.shot("e6-ikuti-panggung", selector=".stage")
    R["errors"] = s.errors

print(json.dumps(R, indent=1, ensure_ascii=False))
ok = "pid-overshoot" not in R["p_only_down_done"] and R["p_only_down"]["Overshoot kecepatan"] == "tidak diukur" and not R["errors"]
print("OK" if ok else "GAGAL")
sys.exit(0 if ok else 1)
