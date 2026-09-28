"""QA tampilan Mode Tutorial di desktop 1366x900 lewat rute asli: tangkapan tiap langkah,
alur langkah 7 (pilih Kabut) ke langkah 8 (kamera Atas 150 m), dan posisi gulir kartu di ponsel."""
import time

from playwright.sync_api import sync_playwright

from sim3d_qa_tampilan_common import BASE, launch, new_page, snap, wait_ready, shot, dump

OVERLAP_JS = r"""
() => {
  const q = (s) => document.querySelector(s);
  const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom) }; };
  const inter = (a, b) => a && b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
  const left = r(q('.s3d-left')), right = r(q('.s3d-right')), safety = r(q('.s3d-safety')), top = r(q('.s3d-top')), toasts = r(q('.s3d-toasts'));
  const tut = r(q('.s3d-tut'));
  const lscroll = q('.s3d-left'); const rscroll = q('.s3d-right');
  return { left, right, safety, top, tut,
    safetyHitsLeft: inter(safety, tut), safetyHitsRight: inter(safety, right),
    leftScroll: [lscroll.scrollHeight, lscroll.clientHeight], rightScroll: [rscroll.scrollHeight, rscroll.clientHeight] };
}
"""

with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b)
    page.goto(f"{BASE}/index.html#/simulator/tutorial")
    wait_ready(page)
    time.sleep(3)
    for i in range(9):
        s = snap(page)
        print("step", s["tutorial"]["step"], s["tutorial"]["id"], "cam", s["camera"])
        dump(page.evaluate(OVERLAP_JS))
        shot(page, f"desk_tut_step{i + 1}.png")
        if i == 6:
            # langkah cuaca: pilih Kabut lewat tombol di kartu
            page.click(".s3d-tut-actions button:has-text('Kabut')")
            time.sleep(2.5)
            shot(page, f"desk_tut_step7_kabut.png")
        if i < 8:
            page.click(".s3d-tut-nav .s3d-primary")
            time.sleep(2.5)
    s = snap(page)
    print("akhir", s["tutorial"]["step"], s["camera"], s["weather"])
    shot(page, "desk_tut_step8_kabut_atas150.png")
    # mode bebas lewat tombol terakhir
    page.click(".s3d-tut-nav .s3d-primary")
    time.sleep(1.5)
    s = snap(page)
    print("mode setelah tombol terakhir", s["mode"])
    shot(page, "desk_tut_to_bebas.png")
    print("logs", log)
    ctx.close()

    # ponsel: posisi gulir kartu setelah menekan Lanjut
    ctx, page, log = new_page(b, mobile=True)
    page.goto(f"{BASE}/index.html#/simulator/tutorial")
    wait_ready(page)
    time.sleep(2)
    body = ".s3d-sheet-body"
    for i in range(3):
        page.evaluate("() => { const b = document.querySelector('.s3d-sheet-body'); b.scrollTop = b.scrollHeight; }")
        time.sleep(0.3)
        page.click(".s3d-tut-nav .s3d-primary")
        time.sleep(0.8)
        info = page.evaluate("() => { const b = document.querySelector('.s3d-sheet-body'); const t = document.querySelector('.s3d-tut-title').getBoundingClientRect(); const br = b.getBoundingClientRect(); return { scrollTop: b.scrollTop, scrollH: b.scrollHeight, clientH: b.clientHeight, titleVisible: t.top >= br.top && t.bottom <= br.bottom, title: document.querySelector('.s3d-tut-title').textContent }; }")
        print("ponsel setelah Lanjut", info)
        shot(page, f"mob_tut_after_next{i + 1}.png")
    print("logs", log)
    ctx.close()
    b.close()
