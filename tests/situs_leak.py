"""Bolak-balik beranda dan pelajaran (dengan Jeda) untuk memastikan tidak ada loop, kanvas, atau gaya yang tertinggal.

Pemakaian: python3 tests/situs_leak.py
"""

import json

from situs_util import BASE, browser, new_page

STATE = """() => ({ loops: window.__simotonom.activeLoops, canvases: document.querySelectorAll('canvas').length,
  styles: document.querySelectorAll('style[data-lesson]').length, toasts: document.querySelectorAll('.toast').length })"""
out = {}
with browser([]) as b:
    ctx, page, con = new_page(b)
    page.goto(BASE + "#/", wait_until="load")
    page.wait_for_timeout(1500)
    out["home-start"] = page.evaluate(STATE)
    for i, lid in enumerate(["shuttle", "rute", "sensor", "kontrol", "jarak-aman", "shuttle"]):
        page.evaluate("(h) => { location.hash = h; }", f"#/pelajaran/{lid}")
        page.wait_for_function("() => window.__simotonom.lessonStatus === 'ready'", timeout=30000)
        page.wait_for_timeout(400)
        page.locator('[data-act="pause"]').click()
        page.wait_for_timeout(200)
        out[f"lesson-{i}-{lid}"] = page.evaluate(STATE)
        page.evaluate("() => { location.hash = '#/'; }")
        page.wait_for_timeout(700)
        out[f"home-{i}"] = page.evaluate(STATE)
    out["console"] = con.summary()
    ctx.close()
print(json.dumps(out, indent=1))
