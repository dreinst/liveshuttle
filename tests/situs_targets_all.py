"""Ukuran target sentuh (min 40 px) di semua pelajaran pada ponsel 390x844.

Memisahkan widget bersama (engine/shell) dari UI khusus pelajaran supaya jelas siapa yang perlu memperbaiki.
Pemakaian: python3 tests/situs_targets_all.py
"""

import json

from situs_util import BASE, LESSONS, browser, new_page

JS = """() => {
  const out = [];
  const shared = (e) => !!e.closest('.ctl, .seg, .step-card, .sim-bar, .app-header, .nav-panel, .lesson-head, .stage-foot, .sim-controls, .step-nav, .step-dots') ||
    /\\b(seg-btn|btn|step-dot|ctl-toggle|nav-link)\\b/.test(String(e.className));
  for (const e of document.querySelectorAll('a, button, input, select, [role=radio], [role=switch]')) {
    if (!e.offsetParent && getComputedStyle(e).position !== 'fixed') continue;
    const r = e.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (e.closest('.skip-link')) continue;
    // label yang membungkus input (misalnya sakelar) dihitung dari labelnya
    let box = r;
    const lab = e.tagName === 'INPUT' ? e.closest('label') : null;
    if (lab) box = lab.getBoundingClientRect();
    if (Math.min(box.width, box.height) < 40) out.push({ shared: shared(e), tag: e.tagName, cls: String(e.className).slice(0, 40), text: (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 30), w: Math.round(box.width), h: Math.round(box.height) });
  }
  return out;
}"""
res = {}
with browser([]) as b:
    ctx, page, con = new_page(b, True)
    for lid in LESSONS:
        page.goto(BASE + "#/", wait_until="load")
        page.evaluate("(h) => { location.hash = h; }", f"#/pelajaran/{lid}")
        page.wait_for_function("() => window.__simotonom && window.__simotonom.lessonStatus === 'ready'", timeout=30000)
        page.wait_for_timeout(700)
        items = page.evaluate(JS)
        res[lid] = {"shared": [i for i in items if i["shared"]], "lessonOnly": len([i for i in items if not i["shared"]])}
    res["console"] = con.summary()
    ctx.close()
print(json.dumps(res, indent=1, ensure_ascii=False))
