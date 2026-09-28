"""Kanvas beranda di wadah besar (skala jalan) untuk memeriksa posisi kendaraan di lajur kiri.

Pemakaian: python3 tests/situs_ambient_zoom.py [awalan]
"""

import json
import os
import sys

from situs_util import BASE, SHOTS, browser, new_page

prefix = sys.argv[1] if len(sys.argv) > 1 else "ambzoom"
with browser([]) as b:
    ctx, page, con = new_page(b)
    page.set_viewport_size({"width": 2400, "height": 1530})
    page.goto(BASE + "tests/situs_ambient_zoom.html", wait_until="load")
    page.wait_for_timeout(3000)
    page.locator("#amb").screenshot(path=os.path.join(SHOTS, f"{prefix}-1.png"))
    page.wait_for_timeout(4000)
    page.locator("#amb").screenshot(path=os.path.join(SHOTS, f"{prefix}-2.png"))
    print(json.dumps(con.summary(), indent=1))
    ctx.close()
