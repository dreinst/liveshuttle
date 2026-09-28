"""QA bar atas di lebar 1024 dan 820: apakah tombol cuaca/kamera tertutup grup waktu (elementFromPoint)."""
import time
from playwright.sync_api import sync_playwright
from sim3d_qa_tampilan_common import BASE, CHROME, wait_ready

JS = r"""
() => [...document.querySelectorAll('.s3d-top .s3d-seg-btn')].map((b) => {
  const r = b.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  const hit = document.elementFromPoint(x, y);
  return [b.textContent.trim(), Math.round(r.left), Math.round(r.right), hit === b || b.contains(hit) ? 'bisa diklik' : 'TERTUTUP oleh ' + (hit ? (hit.closest('[class]') || hit).className : 'null')];
})
"""
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, headless=True)
    for w, h in [(1180, 820), (1024, 768), (820, 1180)]:
        ctx = b.new_context(viewport={"width": w, "height": h})
        page = ctx.new_page()
        page.goto(f"{BASE}/index.html#/simulator/bebas")
        wait_ready(page)
        time.sleep(1)
        res = page.evaluate(JS)
        print(w, h)
        for r in res:
            if 'TERTUTUP' in r[3] or r[2] > w:
                print('   ', r)
        ctx.close()
    b.close()
