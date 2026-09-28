"""Menyalip di lalu lintas padat: saat manuver salip dimulai, catat celah nyata ke kendaraan di lajur kanan searah
(di depan dan di belakang) dan perlambatan terbesar NPC di lajur itu dalam 4 detik setelahnya (tanda memotong)."""
import time
from sim3d_qa_perilaku_common import *  # noqa

TRACER = r"""() => {
  const app = window.__qaApp;
  const T = { starts: [], watch: [] };
  window.__qaT = T;
  const orig = app.step;
  let prevAct = null;
  app.step = function (dt) {
    orig.call(app, dt);
    const pl = app.planner, r = pl.route, e = app.ego, it = r.items[r.ri];
    const act = pl.active ? pl.active.kind : null;
    if (act === 'salip' && prevAct !== 'salip' && it.type === 'road') {
      const seg = it.seg, tgt = seg.lanes[pl.active.lane];
      let front = null, rear = null;
      for (const c of app.traffic.cars) {
        if (c.lane !== tgt && c.oldLane !== tgt) continue;
        const ds = (c.x - e.x) * seg.dx + (c.z - e.z) * seg.dz;
        const g = Math.abs(ds) - e.hl - c.len / 2;
        if (ds >= 0 && (front === null || g < front.g)) front = { g: +g.toFixed(1), dv: +(c.v - e.v).toFixed(1) };
        if (ds < 0 && (rear === null || g < rear.g)) rear = { g: +g.toFixed(1), dv: +(c.v - e.v).toFixed(1), id: c.id };
      }
      // juga kendaraan yang baru akan masuk ruas ini dari persimpangan di belakang
      const rec = { t: +app.simTime.toFixed(1), v: +(e.v * 3.6).toFixed(1), front, rear, minAcc: 0, tgt: tgt.id };
      T.starts.push(rec);
      T.watch.push({ rec, until: app.simTime + 4, tgt });
    }
    prevAct = act;
    for (const w of T.watch) {
      if (app.simTime > w.until) continue;
      for (const c of app.traffic.cars) {
        if (c.lane !== w.tgt) continue;
        const ds = (c.x - e.x) * Math.cos(e.h) + (c.z - e.z) * Math.sin(e.h);
        if (ds < 0 && ds > -40 && c.acc < w.rec.minAcc) w.rec.minAcc = +c.acc.toFixed(2);
      }
    }
    T.watch = T.watch.filter((w) => app.simTime <= w.until);
  };
  return 'ok';
}"""

STATE = r"""() => { const a = window.__qaApp, pl = a.planner, r = pl.route, it = r.items[r.ri];
  return { t: a.simTime, v: a.ego.v * 3.6, item: it.type, remain: it.type === 'road' ? it.len - r.s : 0, k: pl.kNow, kEnd: it.kEnd, ov: a.counters.overtakes, col: a.counters.collisions, obs: a.scen.obstacles.length, beh: pl.behavior }; }"""

with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b)
    open_sim(page, "bebas")
    install_monitor(page)
    print(ev(page, TRACER))
    ev(page, "() => { for (const [id, v] of [['s3d-traf', 60]]) { const el = document.getElementById(id); el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); } }")
    page.keyboard.press("]")
    placed = 0
    t0 = time.time()
    while time.time() - t0 < 420 and placed < 14:
        s = ev(page, STATE)
        if s["item"] == "road" and 60 < s["remain"] < 76 and s["k"] == 0 and s["v"] > 12 and s["kEnd"] == 0 and s["obs"] == 0:
            ev(page, "() => document.querySelector(\".s3d-obs[data-type='mogok']\").click()")
            placed += 1
            tt = time.time()
            while time.time() - tt < 25:
                st = ev(page, STATE)
                if st["ov"] > s["ov"] and st["k"] == 0:
                    break
                time.sleep(0.2)
            ev(page, "() => window.__qaApp.clearObstacles()")
        time.sleep(0.1)
    T = ev(page, "() => window.__qaT.starts")
    S = summary(page)
    print("rintangan ditaruh", placed, "manuver salip dimulai", len(T), "menyalip", S["counters"]["overtakes"], "tabrakan", S["counters"]["collisions"])
    for r in T:
        print("  ", r)
    rears = [r["rear"]["g"] for r in T if r["rear"]]
    fronts = [r["front"]["g"] for r in T if r["front"]]
    print("celah belakang terkecil", min(rears) if rears else None, "celah depan terkecil", min(fronts) if fronts else None, "perlambatan NPC terbesar", min((r["minAcc"] for r in T), default=None))
    print("npcOverlap", S["npcOverlapEvents"], "wrongSideEgo", S["wrongSideEgo"])
    b.close()
