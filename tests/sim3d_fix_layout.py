"""Tata letak di beberapa lebar layar: bar atas tidak saling tutup, panel tidak menutupi bar atas, gambar untuk dilihat."""
import time
from sim3d_fix_common import *  # noqa

JS = r"""
() => {
  const out = [];
  for (const b of document.querySelectorAll('.s3d-top button, .s3d-top select')) {
    const r = b.getBoundingClientRect();
    if (!r.width) continue;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!(hit === b || b.contains(hit))) out.push('tertutup: ' + b.textContent.trim().slice(0, 20));
    if (r.right > innerWidth + 1) out.push('keluar layar: ' + b.textContent.trim().slice(0, 20));
  }
  const top = document.querySelector('.s3d-top').getBoundingClientRect();
  let topBottom = 0;
  for (const c of document.querySelectorAll('.s3d-top > *')) topBottom = Math.max(topBottom, c.getBoundingClientRect().bottom);
  for (const sel of ['.s3d-left', '.s3d-right']) {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    if (r.width && getComputedStyle(el).display !== 'none' && r.top < topBottom - 1) out.push(`${sel} menimpa bar atas (${Math.round(r.top)} < ${Math.round(topBottom)})`);
  }
  const safe = [...document.querySelectorAll('.s3d-safe')].map((c) => c.getBoundingClientRect());
  const cols = new Set(safe.map((r) => Math.round(r.left))).size;
  return { issues: out, safetyCols: cols, layout: document.querySelector('.s3d').dataset.layout };
}
"""
with sync_playwright() as p:
    b = launch(p)
    for w, h in [(1366, 900), (1280, 720), (1180, 820), (1100, 800), (1024, 768), (920, 700), (820, 1180), (768, 1024)]:
        for mode in ("tutorial", "bebas"):
            ctx, page, log = new_page(b, width=w, height=h)
            open_sim(page, mode)
            time.sleep(1.2)
            r = ev(page, JS)
            shot(page, f"layout_{w}x{h}_{mode}.png")
            print(w, h, mode, r, log)
            ctx.close()
    b.close()
