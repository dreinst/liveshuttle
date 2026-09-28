"""Uji putar balik dan keadaan 'tidak ada rute' saat mobil melaju.

Start dipindah ke (22, 9), tujuan tetap (22, 1). Mobil berangkat ke utara, lalu (22, 4) ditutup
sehingga mobil harus putar balik. Setelah itu (21, 1) ditutup sehingga tujuan tidak bisa dicapai,
lalu dibuka lagi supaya mobil melanjutkan perjalanan.

Pemakaian: python3 tests/rute_uturn.py [--mobile]   (server di port 8115)
"""
import json
import sys

sys.path.insert(0, "/Users/mcdonny/Downloads/ndur/driverless-sim/tests")
from rute_util import Session, SHOTS  # noqa: E402

MOBILE = "--mobile" in sys.argv
TAG = "m" if MOBILE else "d"
out = {}
with Session(mobile=MOBILE) as s:
    s.go("#/")
    s.page.evaluate("() => localStorage.clear()")
    s.go("#/pelajaran/rute", 1500)
    s.page.locator(".step-dot[data-go='4']").dispatch_event("click")
    s.page.wait_for_timeout(400)
    # pindah start
    s.page.locator(".seg-btn", has_text="Pindah").first.click()
    s.page.locator(".seg-btn", has_text="Start").first.click()
    s.page.evaluate("() => window.scrollTo(0, 0)")
    s.tap_cell(22, 9)
    out["after_move"] = s.status()
    s.page.locator(".seg-btn", has_text="Tutup jalan").first.click()
    s.click_text(".btn", "Jalankan mobil")
    s.page.wait_for_timeout(250)
    s.page.locator('[data-act="pause"]').click()
    s.page.evaluate("() => window.scrollTo(0, 0)")
    s.page.wait_for_timeout(150)
    s.tap_cell(22, 4)
    s.page.wait_for_timeout(150)
    out["after_close"] = s.status()
    s.page.locator(".sim-canvas").screenshot(path=SHOTS + f"ut-{TAG}-1-replan.png")
    # jalankan sebentar sampai mobil putar balik
    s.page.locator('[data-act="pause"]').click()
    s.page.wait_for_timeout(700)
    s.page.locator('[data-act="pause"]').click()
    s.page.evaluate("() => window.scrollTo(0, 0)")
    s.page.wait_for_timeout(150)
    s.page.locator(".sim-canvas").screenshot(path=SHOTS + f"ut-{TAG}-2-uturn.png")
    out["uturn"] = s.status()
    # tutup (21, 1): tujuan tidak bisa dicapai
    s.tap_cell(21, 1)
    s.page.wait_for_timeout(150)
    out["blocked_now"] = s.status()
    s.page.locator('[data-act="pause"]').click()
    s.page.wait_for_timeout(2500)
    s.page.evaluate("() => window.scrollTo(0, 0)")
    s.page.wait_for_timeout(150)
    s.page.locator(".sim-canvas").screenshot(path=SHOTS + f"ut-{TAG}-3-blocked.png")
    out["blocked"] = s.status()
    out["car_state"] = s.page.locator(".readout", has_text="Keadaan").inner_text()
    # buka lagi (22, 4): mobil melanjutkan
    s.tap_cell(22, 4)
    s.page.wait_for_timeout(300)
    out["reopened"] = s.status()
    s.page.wait_for_timeout(6000)
    s.page.evaluate("() => window.scrollTo(0, 0)")
    s.page.locator(".sim-canvas").screenshot(path=SHOTS + f"ut-{TAG}-4-arrived.png")
    out["end"] = s.status()
    out["tasks"] = s.hook()["completedTasks"]
    out["errors"] = s.errors
print(json.dumps(out, indent=1, ensure_ascii=False))
