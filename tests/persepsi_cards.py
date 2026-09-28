"""Tangkapan layar kartu langkah pelajaran Persepsi (desktop), satu per langkah. Server: python3 tests/serve.py 8243"""
import sys
sys.path.insert(0, "/Users/mcdonny/Downloads/ndur/driverless-sim/tests")
from persepsi_util import Session, dump  # noqa: E402

with Session() as s:
    s.ctx.close()
    s.ctx = s.browser.new_context(viewport={"width": 1366, "height": 1400}, device_scale_factor=1)
    s.page = s.ctx.new_page()
    s.page.on("console", lambda m: s.errors.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
    s.page.on("pageerror", lambda e: s.errors.append(f"pageerror: {e}"))
    s.go("#/")
    s.page.evaluate("() => localStorage.clear()")
    s.go("#/pelajaran/persepsi", 800)
    for i in range(5):
        s.page.locator(f'.step-dot[data-go="{i}"]').dispatch_event("click")
        s.page.wait_for_timeout(400)
        s.shot(f"card-{i + 1}", selector=".step-card")
    dump({"errors": s.errors})
