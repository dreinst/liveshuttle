"""Uji asap setelah perbaikan: kedua mode, desktop dan ponsel, tanpa galat konsol."""
import time
from sim3d_fix_common import *  # noqa

with sync_playwright() as p:
    b = launch(p)
    for mobile in (False, True):
        for mode in ("tutorial", "bebas"):
            ctx, page, log = new_page(b, mobile=mobile)
            s = open_sim(page, mode)
            time.sleep(3)
            s = snap(page)
            tag = f"{'m' if mobile else 'd'}_{mode}"
            shot(page, f"smoke_{tag}.png")
            print(tag, "quality", s["quality"], "pr", s["render"]["pixelRatio"], "beh", s["ego"]["behavior"], "|", s["ego"]["reason"][:70], "| layers", s["layers"], "| log", log)
            ctx.close()
    b.close()
