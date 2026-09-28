"""Kasus tepi pelajaran Perencanaan Rute (QA independen, port 8135).

Pemakaian: python3 tests/rute_indep_edge.py [--mobile]
"""
import json
import re
import sys

sys.path.insert(0, "/Users/mcdonny/Downloads/ndur/driverless-sim/tests")
from rute_indep_util import Session, log  # noqa: E402

MOBILE = "--mobile" in sys.argv
TAG = "m" if MOBILE else "d"
res = {}


def secs_of(text, pat):
    m = re.search(pat, text)
    return float(m.group(1).replace(".", "").replace(",", ".")) if m else None


with Session(mobile=MOBILE) as S:
    p = S.page
    S.go("#/pelajaran/rute", 1200)

    # 1. Dijkstra di HUD (langkah 2), cek tinggi HUD
    S.goto_step(1)
    S.button("Cari rute").click()
    p.wait_for_timeout(200)
    S.button("Lewati animasi").click()
    p.wait_for_timeout(400)
    S.stage_into_view()
    hud = p.evaluate("() => { const h = document.querySelector('.hud'); const r = h.getBoundingClientRect(); const s = document.querySelector('.stage').getBoundingClientRect(); return { h: r.height, top: r.top - s.top, bottom: r.bottom - s.top }; }")
    res["hud-dijkstra"] = hud
    S.shot(f"{TAG}-e-dijkstra-hud")

    # 2. Macet di sel tujuan: perkiraan waktu dibanding waktu tiba
    S.goto_step(3)  # alat macet, rute A* siap
    res["preset-table-astar"] = p.locator(".grp-compare tbody tr").first.inner_text()
    S.tap_cell(22, 1)  # sel tujuan
    p.wait_for_timeout(200)
    res["jam-goal-status"] = S.status()
    S.tap_cell(20, 1)  # macet di dekat tujuan
    S.seg("Pindah").click()
    S.seg("Tujuan").click()
    S.tap_cell(20, 1)
    res["move-onto-jam"] = S.status()
    S.seg("Macet").click()
    S.button("Cari rute").click()
    p.wait_for_timeout(200)
    S.button("Lewati animasi").click()
    p.wait_for_timeout(400)
    est = S.status()
    res["jam-goal-estimate"] = est
    S.button("Jalankan mobil").click()
    p.wait_for_timeout(300)
    res["jam-goal-driving"] = S.status()
    p.locator(".speed-wrap .seg-btn", has_text="2x").click()
    for _ in range(120):
        if "sampai di tujuan" in S.status():
            break
        p.wait_for_timeout(250)
    res["jam-goal-arrived"] = S.status()
    p.locator(".speed-wrap .seg-btn", has_text="1x").click()

    # 3. Mobil tertahan: tutup semua akses ke tujuan saat melaju
    S.goto_step(4)
    S.button("Jalankan mobil").click()
    p.wait_for_timeout(600)
    S.tap_cell(21, 1)
    S.tap_cell(22, 2)
    p.wait_for_timeout(300)
    res["blocked-status"] = S.status()
    S.shot(f"{TAG}-e-blocked-banner")
    p.wait_for_timeout(2500)
    res["blocked-later"] = S.status()
    res["blocked-chip"] = p.locator(".hud").inner_text()
    res["blocked-left"] = p.locator(".lesson-rute .readout", has_text="Sisa waktu").inner_text()
    S.shot(f"{TAG}-e-blocked")
    S.tap_cell(22, 2)  # buka lagi
    p.wait_for_timeout(400)
    res["unblocked-status"] = S.status()
    S.shot(f"{TAG}-e-unblocked")

    # 4. Status panjang: hitung ulang lalu melaju di sel macet
    S.goto_step(4)
    S.button("Jalankan mobil").click()
    p.wait_for_timeout(300)
    S.seg("Macet").click()
    S.tap_cell(6, 14)
    S.tap_cell(7, 14)
    S.seg("Tutup jalan").click()
    S.tap_cell(22, 8)
    p.wait_for_timeout(300)
    longest = ""
    for _ in range(30):
        st = S.status()
        if len(st) > len(longest):
            longest = st
        p.wait_for_timeout(100)
    res["long-status"] = longest
    lines = p.evaluate("() => { const e = document.querySelector('.sim-status'); return { h: e.getBoundingClientRect().height, sh: e.scrollHeight, lh: parseFloat(getComputedStyle(e).lineHeight) }; }")
    res["status-box"] = lines
    S.shot(f"{TAG}-e-long-status")

    # 5. Pindah: ketuk marker tujuan, lalu ketuk sel baru
    S.goto_step(0)
    S.seg("Pindah").click()
    S.tap_cell(22, 1)
    res["pindah-select"] = S.status()
    S.tap_cell(9, 5)
    res["pindah-move"] = S.status()
    S.button("Cari rute").click()
    p.wait_for_timeout(200)
    S.button("Lewati animasi").click()
    p.wait_for_timeout(300)
    res["pindah-route"] = S.status()
    S.shot(f"{TAG}-e-pindah")
    if not MOBILE:
        # seret penanda start dengan mouse
        x0, y0 = S.cell_xy(1, 14)
        x1, y1 = S.cell_xy(5, 10)
        S.stage_into_view()
        x0, y0 = S.cell_xy(1, 14)
        x1, y1 = S.cell_xy(5, 10)
        p.mouse.move(x0 - 3, y0 - 3)
        p.mouse.down()
        p.mouse.move(x1, y1, steps=12)
        S.shot(f"{TAG}-e-drag-ghost")
        p.mouse.up()
        p.wait_for_timeout(200)
        res["drag-start"] = S.status()

    # 6. Ulangi di tengah pencarian dan jeda
    S.goto_step(0)
    S.button("Cari rute").click()
    p.wait_for_timeout(400)
    p.locator('[data-act="pause"]').click()
    p.wait_for_timeout(300)  # panel diperbarui tiap 120 ms
    n1 = S.status()
    p.wait_for_timeout(600)
    n2 = S.status()
    res["pause-freezes-search"] = n1 == n2
    p.locator('[data-act="reset"]').click()
    p.wait_for_timeout(300)
    res["reset-mid-search"] = {"status": S.status(), "hook": S.hook()["paused"]}
    res["errors"] = S.errors

print(json.dumps(res, indent=1, ensure_ascii=False))
