"""Periksa ukuran target sentuh (min 40 px) di beranda dan satu halaman pelajaran pada ponsel.

Pemakaian: python3 tests/situs_targets.py
"""

import json

from situs_util import BASE, browser, new_page

JS = """() => {
  const out = [];
  for (const e of document.querySelectorAll('a, button, input, [role=radio], [role=switch]')) {
    if (!e.offsetParent && getComputedStyle(e).position !== 'fixed') continue;
    const r = e.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (e.closest('.skip-link')) continue;
    if (Math.min(r.width, r.height) < 40) out.push({ tag: e.tagName, cls: String(e.className).slice(0, 40), text: (e.textContent || '').trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) });
  }
  return out;
}"""
with browser([]) as b:
    ctx, page, con = new_page(b, True)
    page.goto(BASE + "#/", wait_until="load")
    page.evaluate("() => localStorage.setItem('liveshuttle.progress.v1', JSON.stringify({ version: 1, lessons: { sensor: { done: ['lidar-on'], tasks: null, lastStep: 1, complete: false, visited: true } } }))")
    page.reload(wait_until="load")
    page.wait_for_timeout(1500)
    home = page.evaluate(JS)
    page.goto(BASE + "#/pelajaran/rute", wait_until="load")
    page.wait_for_function("() => window.__simotonom.lessonStatus === 'ready'", timeout=20000)
    page.wait_for_timeout(800)
    lesson = page.evaluate(JS)
    print(json.dumps({"home": home, "lesson-rute": lesson, **con.summary()}, indent=1, ensure_ascii=False))
    ctx.close()
