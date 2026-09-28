"""Gerak dikurangi: cincin hitung ulang diam, tanpa galat (QA independen, port 8135)."""
import sys

sys.path.insert(0, "/Users/mcdonny/Downloads/ndur/driverless-sim/tests")
from rute_indep_util import Session  # noqa: E402

with Session(reduced=True) as S:
    p = S.page
    S.go("#/pelajaran/rute", 1000)
    S.goto_step(4)
    S.button("Jalankan mobil").click()
    p.wait_for_timeout(800)
    S.tap_cell(22, 8)
    p.wait_for_timeout(200)
    S.shot("d-reduced-a", selector=".sim-canvas")
    p.wait_for_timeout(500)
    S.shot("d-reduced-b", selector=".sim-canvas")
    print("status:", S.status())
    print("reducedMotion:", p.evaluate("() => matchMedia('(prefers-reduced-motion: reduce)').matches"))
    print("errors:", S.errors)
