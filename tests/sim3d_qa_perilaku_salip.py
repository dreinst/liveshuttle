"""Uji menyalip rintangan diam.
Skenario A: lajur kanan kosong (lalu lintas 0) -> harus menyalip lalu kembali ke kiri.
Skenario B: lalu lintas bawaan (30 mobil) -> menyalip bila aman.
Skenario C: ada arus mobil di lajur kanan searah -> harus menunggu, baru menyalip setelah kosong.
Skenario D: kedua lajur tertutup -> Menunggu celah, tidak menyalip, tidak menabrak.
"""
import sys
import time
from sim3d_qa_perilaku_common import *  # noqa

TRACER = r"""() => {
  const app = window.__qaApp;
  const T = { rows: [], starts: [], ends: [] };
  window.__qaT = T;
  const orig = app.step;
  let prevAct = null;
  app.step = function (dt) {
    orig.call(app, dt);
    const pl = app.planner, r = pl.route, e = app.ego;
    const it = r.items[r.ri];
    const act = pl.active ? pl.active.kind : null;
    if (act !== prevAct && act === 'salip') {
      // celah nyata ke kendaraan di lajur kanan searah saat manuver dimulai
      const seg = it.type === 'road' ? it.seg : null;
      let gaps = [];
      if (seg) {
        for (const c of app.traffic.cars) {
          if (c.lane.type !== 'road' || c.lane.seg !== seg) continue;
          const ds = (c.x - e.x) * seg.dx + (c.z - e.z) * seg.dz;
          gaps.push({ id: c.id, k: c.lane.k, ds: +ds.toFixed(1), v: +c.v.toFixed(1) });
        }
      }
      T.starts.push({ t: +app.simTime.toFixed(2), v: +(e.v * 3.6).toFixed(1), s: +r.s.toFixed(1), gaps });
    }
    if (act !== prevAct && prevAct === 'salip') T.ends.push({ t: +app.simTime.toFixed(2) });
    prevAct = act;
    if (Math.round(app.simTime * 60) % 6 === 0) {
      let obsGap = null;
      for (const o of app.scen.obstacles) {
        const d = Math.hypot(o.x - e.x, o.z - e.z);
        if (obsGap === null || d < obsGap) obsGap = d;
      }
      T.rows.push([+app.simTime.toFixed(1), pl.kNow, r && it.type === 'road' ? +r.lat.toFixed(2) : null, pl.behavior, act, pl.held ? pl.held.kind + ':' + pl.held.why : null, +(e.v * 3.6).toFixed(1), obsGap === null ? null : +obsGap.toFixed(1), app.counters.overtakes, app.counters.collisions, it.type]);
    }
  };
  return 'ok';
}"""

STATE = r"""() => { const app = window.__qaApp, pl = app.planner, r = pl.route, e = app.ego, it = r.items[r.ri];
  const nx = r.items[r.ri + 1];
  return { t: app.simTime, v: e.v * 3.6, item: it.type, remain: it.type === 'road' ? it.len - r.s : 0, k: pl.kNow, s: r.s, beh: pl.behavior, next: nx && nx.type === 'conn' ? nx.lane.move : null, kEnd: it.kEnd, ov: app.counters.overtakes, col: app.counters.collisions, obs: app.scen.obstacles.length }; }"""


def wait_cond(page, fn, secs=90):
    t0 = time.time()
    while time.time() - t0 < secs:
        s = ev(page, STATE)
        if fn(s):
            return s
        time.sleep(0.1)
    return None


def run(page, name, density, stream=False, both=False, watch=35):
    ev(page, f"() => {{ const el = document.getElementById('s3d-traf'); el.value = '{density}'; el.dispatchEvent(new Event('input', {{ bubbles: true }})); }}")
    ev(page, "() => { const b = [...document.querySelectorAll('.s3d-btn')].find((x) => x.textContent.trim() === 'Hapus rintangan'); b.click(); }")
    if density == 0:
        ev(page, "() => { const a = window.__qaApp; a.traffic.cars.length = 0; }")
    s = wait_cond(page, lambda s: s["item"] == "road" and s["remain"] > 56 and s["k"] == 0 and s["v"] > 20 and s["kEnd"] == 0)
    if not s:
        print(name, "kondisi awal tidak tercapai")
        return None
    ev(page, "() => { const T = window.__qaT; T.rows.length = 0; T.starts.length = 0; T.ends.length = 0; }")
    before = s
    if stream:
        # arus mobil di lajur kanan searah, di belakang dan sejajar mobil otonom
        ev(page, r"""() => { const a = window.__qaApp, pl = a.planner, r = pl.route, it = r.items[r.ri];
          const lane = it.seg.lanes[1];
          for (const ds of [-4, -22, -40]) { const s = r.s + ds; if (s > 2) { const c = a.traffic.addCar(lane, s, 9); c.v0 = 9.5; } }
          return true; }""")
    ev(page, "() => document.querySelector(\".s3d-obs[data-type='mogok']\").click()")
    if both:
        ev(page, r"""() => { const a = window.__qaApp, o = a.scen.obstacles[a.scen.obstacles.length - 1];
          const sib = o.lane.sibling; a.scen.add('kerucut', sib, o.s + 1); a.scen.add('kardus', sib, o.s - 3); return true; }""")
    t0 = time.time()
    shots = 0
    while time.time() - t0 < watch:
        st = ev(page, STATE)
        if shots == 0 and st["beh"] in ("Menyalip", "Menunggu celah") and time.time() - t0 > 2:
            shot(page, f"salip_{name}_mid.png")
            shots = 1
        if not both and st["ov"] > before["ov"] and st["k"] == 0 and st["beh"] not in ("Menyalip",) and time.time() - t0 > 4:
            time.sleep(1.5)
            break
        time.sleep(0.1)
    T = ev(page, "() => window.__qaT")
    after = ev(page, STATE)
    rows = T["rows"]
    lanes_seq = []
    for r in rows:
        if not lanes_seq or lanes_seq[-1] != r[1]:
            lanes_seq.append(r[1])
    lat = [r[2] for r in rows if r[2] is not None]
    behs = []
    for r in rows:
        if not behs or behs[-1] != r[3]:
            behs.append(r[3])
    min_obs = min((r[7] for r in rows if r[7] is not None), default=None)
    res = {
        "name": name, "overtakes": after["ov"] - before["ov"], "collisions": after["col"] - before["col"], "lane_seq": lanes_seq,
        "lat_min": min(lat) if lat else None, "lat_max": max(lat) if lat else None, "beh_seq": behs[:14], "min_center_dist_obs": min_obs,
        "starts": T["starts"], "held": sorted(set(r[5] for r in rows if r[5])), "end_k": after["k"], "end_beh": after["beh"],
    }
    print(res, flush=True)
    return res


with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b)
    open_sim(page, "bebas")
    install_monitor(page)
    print(ev(page, TRACER))
    page.keyboard.press("2")
    which = sys.argv[1:] or ["A", "B", "C", "D"]
    if "A" in which:
        run(page, "A_kosong", 0)
    if "B" in which:
        run(page, "B_bawaan", 30)
    if "C" in which:
        run(page, "C_arus_kanan", 0, stream=True, watch=45)
    if "D" in which:
        run(page, "D_dua_lajur", 0, both=True, watch=25)
        shot(page, "salip_D_end.png")
        ev(page, "() => window.__qaApp.clearObstacles()")
        time.sleep(4)
        print("setelah hapus:", ev(page, STATE))
    print("monitor:", {k: v for k, v in summary(page).items() if k in ("offRoadEgoEx", "offRoadCar", "offRoadEx", "wrongSideEgo", "wrongSideEgoEx", "egoLatMin", "egoLatMax", "offRoadEgo", "egoDevMax", "egoDevMaxEx", "counters")})
    print("LOG", log[:10])
    b.close()
