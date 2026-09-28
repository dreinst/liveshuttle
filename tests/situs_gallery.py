"""Buka tests/situs_gallery.html, catat log dan galat, lalu simpan tangkapan layar.

Pemakaian: python3 tests/situs_gallery.py [nama]
"""

import json
import sys

import os

from situs_util import BASE, SHOTS, browser, new_page, shot

name = sys.argv[1] if len(sys.argv) > 1 else "gallery"
with browser([]) as b:
    ctx, page, con = new_page(b)
    page.set_viewport_size({"width": 1366, "height": 1500})
    page.goto(BASE + "tests/situs_gallery.html", wait_until="load")
    page.wait_for_function("() => window.__gallery && window.__gallery.done", timeout=30000)
    page.wait_for_timeout(300)
    print(page.inner_text("#log"))
    print(json.dumps({"gallery": page.evaluate("() => window.__gallery"), **con.summary()}, ensure_ascii=False, indent=1))
    print(shot(page, name, full_page=True))
    for i in range(1, 7):
        page.locator(f"#c{i}").screenshot(path=os.path.join(SHOTS, f"{name}-c{i}.png"))
