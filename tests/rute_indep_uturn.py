"""Putar balik saat hitung ulang: lihat lintasannya melengkung ke kanan (QA independen, port 8135)."""
import sys

sys.path.insert(0, "/Users/mcdonny/Downloads/ndur/driverless-sim/tests")
from rute_indep_util import Session  # noqa: E402

MOBILE = "--mobile" in sys.argv
TAG = "m" if MOBILE else "d"
with Session(mobile=MOBILE) as S:
    p = S.page
    S.go("#/pelajaran/rute", 1000)
    S.goto_step(4)
    p.locator(".speed-wrap .seg-btn", has_text="0,5x").click()
    S.button("Jalankan mobil").click()
    p.wait_for_timeout(250)
    S.tap_cell(5, 14)
    print("status:", S.status())
    for k in range(6):
        p.wait_for_timeout(350)
        S.shot(f"{TAG}-uturn-{k}", selector=".sim-canvas")
    p.locator(".speed-wrap .seg-btn", has_text="2x").click()
    for _ in range(160):
        if "sampai di tujuan" in S.status():
            break
        p.wait_for_timeout(250)
    print("end:", S.status())
    print("errors:", S.errors)
