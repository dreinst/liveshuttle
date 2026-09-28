"""Jalankan contoh ENGINE.md bagian 8 (tests/situs_example.html) dan simpan tangkapan layarnya.

Pemakaian: python3 tests/situs_example.py
"""

import json
import os

from situs_util import BASE, SHOTS, browser, new_page

with browser([]) as b:
    ctx, page, con = new_page(b)
    page.set_viewport_size({"width": 920, "height": 1120})
    page.goto(BASE + "tests/situs_example.html", wait_until="load")
    page.wait_for_function("() => window.__ex && window.__ex.done", timeout=20000)
    page.wait_for_timeout(3000)
    page.locator("#a").screenshot(path=os.path.join(SHOTS, "example-a.png"))
    page.locator("#b").screenshot(path=os.path.join(SHOTS, "example-b-1.png"))
    page.wait_for_timeout(2000)
    page.locator("#b").screenshot(path=os.path.join(SHOTS, "example-b-2.png"))
    res = page.evaluate("() => ({ errors: window.__ex.errors, search: window.__ex.search && window.__ex.search(), trail: window.__ex.trail && window.__ex.trail() })")
    print(json.dumps({**res, **con.summary()}, indent=1))
    ctx.close()
