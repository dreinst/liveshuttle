"""Kecepatan relatif (mendekat/menjauh) di panel dibanding laju perubahan jarak sebenarnya."""
from collections import Counter
from sim3d_qa_perilaku_common import *  # noqa

with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b)
    open_sim(page, "bebas")
    res = ev(page, r"""async () => {
      const app = window.__qaApp, per = app.perception;
      const orig = per.update.bind(per);
      const out = { intervals: [], rows: [] };
      let last = null;
      per.update = function (now) {
        if (last !== null) out.intervals.push(+(now - last).toFixed(4));
        last = now;
        orig(now);
        const e = app.ego;
        for (const t of per.list) {
          if (!t.ref || t.n < 4) continue;
          const dx = t.ref.x - e.x, dz = t.ref.z - e.z, d = Math.hypot(dx, dz);
          const rvx = (t.ref.vx || 0) - e.v * Math.cos(e.h), rvz = (t.ref.vz || 0) - e.v * Math.sin(e.h);
          const truth = (dx * rvx + dz * rvz) / d;
          if (out.rows.length < 3000 && Math.abs(truth) > 3) out.rows.push([t.rate, truth]);
        }
      };
      await new Promise((r) => setTimeout(r, 25000));
      per.update = orig;
      return out;
    }""")
    print("interval pemindaian:", Counter(res["intervals"]).most_common(3), "=> frekuensi", round(1 / Counter(res["intervals"]).most_common(1)[0][0], 2), "Hz")
    ratios = sorted(r / t for r, t in res["rows"])
    n = len(ratios)
    print("rasio rate panel / laju jarak sebenarnya: n", n, "median", round(ratios[n // 2], 3), "p25", round(ratios[n // 4], 3), "p75", round(ratios[3 * n // 4], 3))
    b.close()
