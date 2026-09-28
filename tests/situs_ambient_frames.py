"""Beberapa tangkapan kanvas beranda berurutan (DPR 2) untuk menilai ketenangan LiDAR dan ukuran kendaraan.

Pemakaian: python3 tests/situs_ambient_frames.py [awalan] [--gpu]
"""

import json
import os
import sys

from situs_util import BASE, GPU, SHOTS, SWIFTSHADER, browser

prefix = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else "ambf"
args = GPU if "--gpu" in sys.argv else SWIFTSHADER
out = {}
with browser(args) as b:
    ctx = b.new_context(viewport={"width": 1366, "height": 900}, device_scale_factor=2)
    page = ctx.new_page()
    errs = []
    page.on("console", lambda m: errs.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") and "ReadPixels" not in m.text else None)
    page.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))
    page.goto(BASE + "#/", wait_until="load")
    page.wait_for_timeout(2500)
    el = page.locator('[data-el="ambient"]')
    for i in range(4):
        el.screenshot(path=os.path.join(SHOTS, f"{prefix}-{i}.png"))
        page.wait_for_timeout(700)
    out["errors"] = errs
    ctx.close()
print(json.dumps(out, indent=1))
