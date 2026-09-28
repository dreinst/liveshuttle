"""Apakah lencana perilaku di panel Perencanaan berkedip bolak-balik saat mendekati rintangan? (1x, lalu lintas bawaan)"""
import time
from sim3d_qa_perilaku_common import *  # noqa

STATE = r"""() => { const a = window.__qaApp, pl = a.planner, r = pl.route, it = r.items[r.ri];
  return { v: a.ego.v * 3.6, item: it.type, remain: it.type === 'road' ? it.len - r.s : 0, k: pl.kNow, kEnd: it.kEnd }; }"""
HUD = "() => [document.querySelector('.s3d-badge').textContent, document.querySelector('.s3d-why').textContent]"

with sync_playwright() as p:
    b = launch(p)
    total_flips = 0
    for trial in range(4):
        ctx, page, log = new_page(b)
        open_sim(page, "bebas")
        install_monitor(page)
        t0 = time.time()
        while time.time() - t0 < 120:
            s = ev(page, STATE)
            if s["item"] == "road" and 70 < s["remain"] < 76 and s["k"] == 0 and s["v"] > 25 and s["kEnd"] == 0:
                break
            time.sleep(0.03)
        typ = ["mogok", "kardus", "kerucut", "mogok"][trial]
        ev(page, f"() => document.querySelector(\".s3d-obs[data-type='{typ}']\").click()")
        seq = []
        tt = time.time()
        while time.time() - tt < 8:
            h = ev(page, HUD)
            if not seq or seq[-1] != h:
                seq.append(h)
            time.sleep(0.05)
        flips = sum(1 for i in range(2, len(seq)) if seq[i][0] == seq[i - 2][0] and seq[i][0] != seq[i - 1][0])
        total_flips += flips
        print(f"{typ}: {len(seq)} perubahan teks, bolak-balik lencana {flips}")
        for x in seq[:14]:
            print("    ", x[0], "|", x[1][:95])
        ctx.close()
    print("total bolak-balik", total_flips)
    b.close()
