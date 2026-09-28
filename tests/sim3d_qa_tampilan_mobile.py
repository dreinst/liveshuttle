"""QA tampilan ponsel 390x844 lewat rute asli: tata letak tutorial dan bebas, semua tab lembar bawah,
lembar diperkecil, bantuan, serta pemeriksaan target sentuh dan elemen yang terpotong."""
import time

from playwright.sync_api import sync_playwright

from sim3d_qa_tampilan_common import BASE, launch, new_page, snap, wait_ready, shot, dump

CHECK_JS = r"""
() => {
  const root = document.querySelector('.s3d');
  const vw = innerWidth, vh = innerHeight;
  const out = { small: [], offscreen: [], overflowX: document.documentElement.scrollWidth > vw, stageH: 0, sheetH: 0 };
  const st = root.querySelector('.s3d-stage').getBoundingClientRect();
  const sh = root.querySelector('.s3d-sheet').getBoundingClientRect();
  out.stageH = Math.round(st.height); out.sheetH = Math.round(sh.height); out.rootH = Math.round(root.getBoundingClientRect().height);
  out.stageTop = Math.round(st.top);
  for (const b of root.querySelectorAll('button, input, select, a')) {
    const r = b.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const cs = getComputedStyle(b);
    if (cs.visibility === 'hidden') continue;
    // hanya elemen yang benar-benar terlihat (bukan di dalam area gulir yang tersembunyi)
    const label = (b.getAttribute('aria-label') || b.textContent || b.tagName).trim().slice(0, 30);
    if ((r.height < 40 || r.width < 40) && b.type !== 'range') out.small.push([label, Math.round(r.width), Math.round(r.height)]);
    if (r.right > vw + 1 || r.left < -1) out.offscreen.push([label, Math.round(r.left), Math.round(r.right)]);
  }
  return out;
}
"""


def tabs(page, prefix):
    names = page.eval_on_selector_all(".s3d-tab", "els => els.filter(e => !e.hidden).map(e => e.dataset.tab)")
    for t in names:
        page.click(f".s3d-tab[data-tab='{t}']")
        time.sleep(0.6)
        shot(page, f"{prefix}_tab_{t}.png")
        # gulir isi lembar sampai bawah juga
        h = page.evaluate("() => { const b = document.querySelector('.s3d-sheet-body'); return [b.scrollHeight, b.clientHeight]; }")
        if h[0] > h[1] + 10:
            page.evaluate("() => { const b = document.querySelector('.s3d-sheet-body'); b.scrollTop = b.scrollHeight; }")
            time.sleep(0.3)
            shot(page, f"{prefix}_tab_{t}_bawah.png")
        print(t, "scroll", h)
    return names


with sync_playwright() as p:
    b = launch(p)
    for mode in ["tutorial", "bebas"]:
        ctx, page, log = new_page(b, mobile=True)
        page.goto(f"{BASE}/index.html#/simulator/{mode}")
        s = wait_ready(page)
        time.sleep(3)
        print("==", mode, s["camera"], s["quality"], s["render"])
        shot(page, f"mob_{mode}_awal.png")
        dump(page.evaluate(CHECK_JS))
        names = tabs(page, f"mob_{mode}")
        print("tabs", names)
        # lembar diperkecil
        page.click(".s3d-sheet-btn")
        time.sleep(0.8)
        shot(page, f"mob_{mode}_sheetmin.png")
        dump(page.evaluate(CHECK_JS))
        page.click(".s3d-sheet-btn")
        time.sleep(0.5)
        # bantuan
        page.click(".s3d-help-btn")
        time.sleep(0.5)
        shot(page, f"mob_{mode}_help.png")
        page.click(".s3d-help .s3d-primary")
        time.sleep(0.3)
        # autopilot mati untuk melihat tombol kemudi
        if mode == "bebas":
            page.click(".s3d-tab[data-tab='kontrol']")
            page.click(".s3d-switch")
            time.sleep(0.8)
            shot(page, f"mob_{mode}_manual.png")
            page.click(".s3d-switch")
        s = snap(page)
        print("render", s["render"])
        print("logs", log)
        ctx.close()
    b.close()
