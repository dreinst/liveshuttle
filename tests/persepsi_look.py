"""Tangkapan layar cepat pelajaran Persepsi (Jalan Karangampel Timur) di desktop dan ponsel.

Pemakaian: python3 tests/persepsi_look.py [--mobile] [detik_tunggu]
Butuh server: python3 tests/serve.py 8243
"""
import sys

sys.path.insert(0, "/Users/mcdonny/Downloads/ndur/driverless-sim/tests")
from persepsi_util import Session, dump  # noqa: E402

MOBILE = "--mobile" in sys.argv
args = [a for a in sys.argv[1:] if not a.startswith("--")]
WAIT = float(args[0]) if args else 6
TAG = "m" if MOBILE else "d"

with Session(mobile=MOBILE) as s:
    s.go("#/pelajaran/persepsi", 1500)
    s.page.wait_for_function("() => window.__simotonom && window.__simotonom.lessonStatus === 'ready'", timeout=20000)
    out = {"hook": s.hook()}
    for name in ("LiDAR", "Radar"):
        s.page.locator(".ctl-toggle", has_text=name).first.click()
    s.page.wait_for_timeout(int(WAIT * 1000))
    s.page.evaluate("() => window.scrollTo(0, 0)")
    s.shot(f"look-{TAG}-raw")
    s.shot(f"look-{TAG}-raw-stage", selector=".stage")
    s.page.locator(".ctl-toggle", has_text="Prediksi").first.click()
    s.page.wait_for_timeout(int(WAIT * 1000))
    s.page.evaluate("() => window.scrollTo(0, 0)")
    s.shot(f"look-{TAG}-pred-stage", selector=".stage")
    out["status"] = s.page.locator(".sim-status").inner_text()
    out["safety"] = s.page.evaluate("() => JSON.parse(JSON.stringify(window.__lessonSafety || null))")
    out["errors"] = s.errors
dump(out)
