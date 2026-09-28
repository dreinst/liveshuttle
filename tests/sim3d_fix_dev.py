"""Dari mana simpangan lajur besar berasal? Catat tiap langkah simulasi saat simpangan > 0,5 m."""
import sys
import time
from sim3d_fix_common import *  # noqa

HOOK = r"""() => {
  const a = window.__app;
  const M = { n: 0, over: 0, max: 0, by: {}, ex: [] };
  window.__dev = M;
  const orig = a.step.bind(a);
  a.step = (dt) => {
    orig(dt);
    const pl = a.planner, r = pl.route; if (!r) return;
    const it = r.items[r.ri];
    const d = a.lateralError;
    M.n++;
    if (d > M.max) M.max = d;
    if (d > 0.5) {
      M.over++;
      const key = it.type === 'conn' ? 'simpang-' + it.lane.move : (pl.active ? 'manuver-' + pl.active.kind : (r.s < 15 ? 'lurus-setelah-simpang' : 'lurus'));
      M.by[key] = (M.by[key] || 0) + 1;
      if (M.ex.length < 12 && d > 0.7) M.ex.push({ t: +a.simTime.toFixed(1), d: +d.toFixed(2), key, v: +(a.ego.v * 3.6).toFixed(0), len: pl.active ? +pl.active.len.toFixed(1) : null });
    }
  };
  return true;
}"""

secs = float(sys.argv[1]) if len(sys.argv) > 1 else 90
with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b)
    open_sim(page, "bebas")
    ev(page, HOOK)
    ev(page, "() => { window.__app.timeScale = 4; }")
    t0 = time.time()
    k = 0
    while time.time() - t0 < secs:
        time.sleep(4)
        k += 1
        if k % 3 == 0:
            ev(page, "() => { const a = window.__app; if (!a.scen.obstacles.length) a.placeObstacle(['mogok','kerucut','kardus'][Math.floor(Math.random()*3)]); else a.clearObstacles(); }")
    M = ev(page, "() => window.__dev")
    s = snap(page)
    print("langkah", M["n"], "waktu sim", round(s["simTime"]), "> 0,5 m:", M["over"], f"({100 * M['over'] / max(1, M['n']):.1f}%)", "maks", round(M["max"], 2))
    print("menurut situasi:", M["by"])
    for e in M["ex"]:
        print("  ", e)
    print("tabrakan", s["counters"]["collisions"], "menyalip", s["counters"]["overtakes"], "AEB", s["counters"]["aebAuto"], "LOG", log)
    b.close()
