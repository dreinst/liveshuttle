"""Uji awal: pengait App tertangkap, WebGL jalan, cek statis lalu lintas kiri pada graf lajur."""
import time
from sim3d_qa_perilaku_common import *  # noqa

with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b)
    open_sim(page, "bebas")
    print("monitor:", install_monitor(page))
    stat = ev(page, r"""() => {
      const app = window.__qaApp;
      const g = app.graph;
      let bad = [];
      // tiap lajur jalan: pusatnya harus di kiri garis tengah menurut arah jalan
      for (const L of g.roadLanes) {
        const seg = L.seg;
        const mx = (L.poly.x[0] + L.poly.x[1]) / 2, mz = (L.poly.z[0] + L.poly.z[1]) / 2;
        const ex = mx - seg.a.x, ez = mz - seg.a.z;
        const left = ex * seg.dz - ez * seg.dx;
        if (!(left > 0)) bad.push({ lane: L.id, k: L.k, left });
        if (L.k === 0 && Math.abs(left - 5.25) > 0.01) bad.push({ lane: L.id, k: 0, left });
        if (L.k === 1 && Math.abs(left - 1.75) > 0.01) bad.push({ lane: L.id, k: 1, left });
      }
      // konektor: belok kiri dari lajur 0 ke lajur 0 (tikungan pendek), belok kanan dari lajur 1
      const moves = {};
      for (const n of g.nodes) for (const c of n.conns) {
        const key = c.move + ':' + c.fromLane.k + '->' + c.toLane.k + (n.deg === 2 ? ':deg2' : '');
        moves[key] = (moves[key] || 0) + 1;
      }
      // panjang konektor belok kiri vs kanan (kiri harus lebih pendek pada lalu lintas kiri)
      let Llen = [], Rlen = [];
      for (const n of g.nodes) if (n.deg === 4) for (const c of n.conns) { if (c.move === 'L') Llen.push(c.len); if (c.move === 'R') Rlen.push(c.len); }
      return { lanes: g.roadLanes.length, conns: g.lanes.length - g.roadLanes.length, bad: bad.slice(0, 5), nBad: bad.length, moves, Lmean: Llen.reduce((a,b)=>a+b,0)/Llen.length, Rmean: Rlen.reduce((a,b)=>a+b,0)/Rlen.length, signalized: g.nodes.filter(n=>n.signalized).length, nodes: g.nodes.length };
    }""")
    dump(stat)
    time.sleep(3)
    s = snap(page)
    print("render", s["render"], "simTime", s["simTime"])
    print(summary(page))
    page.keyboard.press("3")
    time.sleep(1.5)
    shot(page, "smoke_atas.png")
    print("LOG", log[:10])
    b.close()
