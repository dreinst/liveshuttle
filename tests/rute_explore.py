"""Eksplorasi visual pelajaran Perencanaan Rute: animasi pencarian, rute, macet, tutup, mobil.

Pemakaian: python3 tests/rute_explore.py [--mobile]   (server di port 8115)
"""
import json
import sys

sys.path.insert(0, "/Users/mcdonny/Downloads/ndur/driverless-sim/tests")
from rute_util import Session  # noqa: E402

MOBILE = "--mobile" in sys.argv
TAG = "m" if MOBILE else "d"
out = {}
with Session(mobile=MOBILE) as s:
    s.go("#/")
    s.page.evaluate("() => localStorage.clear()")
    s.go("#/pelajaran/rute", 1500)
    s.click_text(".btn", "Cari rute")
    s.page.wait_for_timeout(700)
    s.shot(f"ex-{TAG}-astar-mid")
    s.page.wait_for_timeout(2500)
    s.shot(f"ex-{TAG}-astar-done")
    out["status_astar"] = s.status()
    out["route"] = s.route_cells()
    # Dijkstra
    s.page.locator(".seg-btn", has_text="Dijkstra").first.click()
    s.click_text(".btn", "Cari rute")
    s.page.wait_for_timeout(2500)
    s.shot(f"ex-{TAG}-dijkstra-mid")
    s.page.wait_for_timeout(6000)
    s.shot(f"ex-{TAG}-dijkstra-done")
    out["status_dijkstra"] = s.status()
    # macet dan tutup dengan tombol cepat
    s.page.locator(".seg-btn", has_text="A*").first.click()
    s.click_text(".btn", "Macet di rute")
    s.click_text(".btn", "Tutup ruas di rute")
    s.shot(f"ex-{TAG}-edit")
    s.click_text(".btn", "Cari rute")
    s.page.wait_for_timeout(4000)
    s.shot(f"ex-{TAG}-replanned")
    out["status_edit"] = s.status()
    s.click_text(".btn", "Jalankan mobil")
    s.page.wait_for_timeout(2500)
    s.shot(f"ex-{TAG}-driving")
    s.click_text(".btn", "Tutup ruas di rute")
    s.page.wait_for_timeout(400)
    s.shot(f"ex-{TAG}-live-replan")
    out["status_live"] = s.status()
    s.page.wait_for_timeout(15000)
    s.shot(f"ex-{TAG}-arrived")
    out["status_end"] = s.status()
    out["hook"] = s.hook()
    out["errors"] = s.errors
print(json.dumps(out, indent=2, ensure_ascii=False))
