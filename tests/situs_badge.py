"""Jeda setiap pelajaran lalu tangkap panggungnya, untuk melihat letak lencana Dijeda (desktop dan ponsel).

Menyimpan satu lembar kontak per ukuran layar: tests/shots/situs/badge-sheet-d.png dan -m.png.
Pemakaian: python3 tests/situs_badge.py
"""

import io
import json
import os

from PIL import Image

from situs_util import BASE, LESSONS, SHOTS, browser, new_page

out = {}
with browser([]) as b:
    for mobile in (False, True):
        tag = "m" if mobile else "d"
        ctx, page, con = new_page(b, mobile)
        tiles = []
        for lid in LESSONS:
            if lid == "kuis":
                continue
            page.goto(BASE + "#/", wait_until="load")
            page.evaluate("(h) => { location.hash = h; }", f"#/pelajaran/{lid}")
            page.wait_for_function("() => window.__simotonom && window.__simotonom.lessonStatus === 'ready'", timeout=30000)
            page.wait_for_timeout(600)
            page.locator('[data-act="pause"], .sim-bar button:has-text("Jeda")').first.click()
            page.wait_for_timeout(300)
            info = page.evaluate("""() => { const b = document.querySelector('.stage-badge'); const r = b.getBoundingClientRect();
              const s = b.closest('.stage, .lesson-stage, [data-el=stage]') || b.parentElement; const q = s.getBoundingClientRect();
              return { hidden: b.hidden, top: Math.round(r.top - q.top), right: Math.round(q.right - r.right), h: Math.round(r.height), paused: window.__simotonom.paused }; }""")
            out[f"{lid}-{tag}"] = info
            png = page.locator(".stage-badge").evaluate_handle("(b) => b.parentElement").as_element().screenshot()
            img = Image.open(io.BytesIO(png)).convert("RGB")
            img.thumbnail((640, 420) if not mobile else (390, 300))
            tiles.append(img)
        cols = 3
        w = max(t.width for t in tiles)
        h = max(t.height for t in tiles)
        sheet = Image.new("RGB", (cols * (w + 8), ((len(tiles) + cols - 1) // cols) * (h + 8)), (20, 20, 20))
        for i, t in enumerate(tiles):
            sheet.paste(t, ((i % cols) * (w + 8), (i // cols) * (h + 8)))
        sheet.save(os.path.join(SHOTS, f"badge-sheet-{tag}.png"))
        out[f"console-{tag}"] = con.summary()
        ctx.close()
print(json.dumps(out, indent=1))
