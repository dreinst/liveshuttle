"""Tangkapan layar aktor Malang (dekat dan skala pelajaran). Pemakaian: python3 tests/situs_actors.py"""

import json
import os

from situs_util import BASE, SHOTS, browser

with browser([]) as b:
    ctx = b.new_context(viewport={"width": 920, "height": 880}, device_scale_factor=2)
    page = ctx.new_page()
    errs = []
    page.on("console", lambda m: errs.append(m.text) if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto(BASE + "tests/situs_actors.html", wait_until="load")
    page.wait_for_function("() => window.__done", timeout=10000)
    page.locator("#a").screenshot(path=os.path.join(SHOTS, "actors-a.png"))
    page.locator("#b").screenshot(path=os.path.join(SHOTS, "actors-b.png"))
    print(json.dumps({"errors": errs}))
