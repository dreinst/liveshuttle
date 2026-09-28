"""Diagnosa: setelah menyalip di dekat ujung ruas, apakah mobil kembali ke lajur kiri?"""
import time
from sim3d_qa_perilaku_common import *  # noqa

ROUTE = r"""() => { const a = window.__qaApp, pl = a.planner, r = pl.route;
  return { t: +a.simTime.toFixed(1), ri: r.ri, s: +r.s.toFixed(1), lat: +r.lat.toFixed(2), k: pl.kNow, beh: pl.behavior, lane: pl.laneText, why: pl.laneWhy,
    items: r.items.map((it, i) => it.type === 'road' ? `${i}:R${it.seg.id}[${it.kStart}->${it.kEnd}]` : `${i}:C${it.lane.move}${it.lane.fromLane.k}${it.lane.toLane.k}`).join(' '),
    evs: pl.evs.map((e) => `${e.kind}:${e.lane}@${Number.isFinite(e.start) ? Math.round(e.start) : 'inf'}`).join(','), act: pl.active ? pl.active.kind : null, held: pl.held ? pl.held.kind + ':' + pl.held.why : null,
    ov: pl.overtake ? { ri: pl.overtake.ri, noBack: pl.overtake.noBack, sOut: Math.round(pl.overtake.sOut), counted: pl.overtake.counted } : null, dest: r.dest.seg.id, replans: pl.replans }; }"""

with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b)
    open_sim(page, "bebas")
    install_monitor(page)
    ev(page, "() => { const el = document.getElementById('s3d-traf'); el.value = '0'; el.dispatchEvent(new Event('input', { bubbles: true })); window.__qaApp.traffic.cars.length = 0; }")
    # tunggu ruas dengan sisa 56 m sampai 70 m sehingga rintangan dekat ujung ruas
    t0 = time.time()
    while time.time() - t0 < 120:
        s = ev(page, "() => { const a = window.__qaApp, r = a.planner.route, it = r.items[r.ri]; return { item: it.type, remain: it.type === 'road' ? it.len - r.s : 0, k: a.planner.kNow, v: a.ego.v * 3.6 }; }")
        if s["item"] == "road" and 56 < s["remain"] < 62 and s["k"] == 0 and s["v"] > 15:
            break
        time.sleep(0.05)
    print("mulai", s)
    ev(page, "() => document.querySelector(\".s3d-obs[data-type='mogok']\").click()")
    last = None
    for i in range(200):
        st = ev(page, ROUTE)
        key = (st["ri"], st["k"], st["beh"], st["evs"], st["act"], st["held"], st["items"][:60])
        if key != last:
            print(st)
            last = key
        time.sleep(0.25)
    shot(page, "salip_diag_end.png")
    b.close()
