"""Tangkapan layar beranda, halaman pelajaran, dan rute 3D (desktop dan ponsel).

Pemakaian: python3 tests/situs_shots.py [awalan] [--routes home,lesson:sensor,sim]
"""

import json
import sys

from situs_util import BASE, browser, hook, new_page, shot

prefix = sys.argv[1] if len(sys.argv) > 1 else "now"
routes = ["#/", "#/pelajaran/sensor"]
if "--routes" in sys.argv:
    routes = sys.argv[sys.argv.index("--routes") + 1].split(",")

out = {}
with browser() as b:
    for mobile in (False, True):
        tag = "m" if mobile else "d"
        ctx, page, con = new_page(b, mobile)
        for r in routes:
            page.goto(BASE + r, wait_until="load")
            page.wait_for_timeout(2500)
            name = r.replace("#/", "").replace("/", "_") or "home"
            shot(page, f"{prefix}-{name}-{tag}", full_page=r == "#/")
            out[f"{name}-{tag}"] = {"hook": hook(page), "title": page.title(), **con.summary()}
            con.clear()
        ctx.close()
print(json.dumps(out, indent=1, ensure_ascii=False))
