"""Tangkapan layar kanvas beranda (peta Ma Chung) di desktop dan ponsel, dua waktu berbeda.

Pemakaian: python3 tests/situs_ambient.py [awalan] [--reduced]
"""

import json
import os
import sys

from situs_util import BASE, SHOTS, browser, new_page

prefix = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else "amb"
reduced = "--reduced" in sys.argv
out = {}
with browser([]) as b:
    for mobile in (False, True):
        ctx, page, con = new_page(b, mobile)
        if reduced:
            page.emulate_media(reduced_motion="reduce")
        page.goto(BASE + "#/", wait_until="load")
        page.wait_for_timeout(2500)
        el = page.locator('[data-el="ambient"]')
        tag = "m" if mobile else "d"
        el.screenshot(path=os.path.join(SHOTS, f"{prefix}-{tag}-1.png"))
        page.wait_for_timeout(3000)
        el.screenshot(path=os.path.join(SHOTS, f"{prefix}-{tag}-2.png"))
        info = page.evaluate("""() => { const c = document.querySelector('[data-el=ambient] canvas'); const r = c.getBoundingClientRect();
          return { w: r.width, h: r.height, coarse: matchMedia('(pointer: coarse)').matches, loops: window.__simotonom.activeLoops }; }""")
        out[tag] = {"info": info, **con.summary()}
        ctx.close()
print(json.dumps(out, indent=1))
