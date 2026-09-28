"""Tangkapan layar penuh pelajaran Persepsi (panel kontrol, kartu langkah, ringkasan) di desktop dan mobile.

Pemakaian: python3 tests/persepsi_indep_pages.py [--mobile] [prefix]
Butuh server: python3 tests/serve.py 8243 (atau --port P).
"""
import sys

sys.path.insert(0, "/Users/mcdonny/Downloads/ndur/driverless-sim/tests")
from persepsi_indep_util import Session, dump  # noqa: E402

MOBILE = "--mobile" in sys.argv
args = [a for a in sys.argv[1:] if not a.startswith("--")]
PREFIX = args[0] if args else "p"
TAG = "m" if MOBILE else "d"

with Session(mobile=MOBILE) as s:
    s.fresh()
    s.page.wait_for_timeout(1500)
    s.shot(f"{PREFIX}{TAG}-step1-full", full=True)
    s.page.locator('.step-dot[data-go="1"]').first.dispatch_event("click")
    s.toggle("Fusi")
    s.page.wait_for_timeout(2500)
    s.top()
    s.shot(f"{PREFIX}{TAG}-step2-stage", selector=".stage")
    s.page.locator('.step-dot[data-go="4"]').first.dispatch_event("click")
    s.page.wait_for_timeout(500)
    s.toggle("Prediksi")
    # tunggu peringatan penyeberang
    for _ in range(300):
        if s.page.locator(".warn-banner").is_visible():
            break
        s.page.wait_for_timeout(100)
    s.top()
    s.page.wait_for_timeout(300)
    s.shot(f"{PREFIX}{TAG}-step5-warn", selector=".stage")
    s.page.wait_for_timeout(700)
    s.shot(f"{PREFIX}{TAG}-step5-warn-b", selector=".stage")
    s.wait_toasts()
    s.top()
    s.shot(f"{PREFIX}{TAG}-step5-stage", selector=".stage")
    s.shot(f"{PREFIX}{TAG}-step5-full", full=True)
    s.page.wait_for_timeout(700)
    s.shot(f"{PREFIX}{TAG}-step5-stage-b", selector=".stage")
    s.shot(f"{PREFIX}{TAG}-controls", selector=".controls")
    s.page.locator('.step-dot[data-go="5"]').first.dispatch_event("click")
    s.page.wait_for_timeout(600)
    s.shot(f"{PREFIX}{TAG}-summary-card", selector=".step-card")
    dump({"errors": s.errors})
