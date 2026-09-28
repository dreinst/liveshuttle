"""Reproduksi temuan:
1. Rintangan kedua ditaruh saat mobil sedang menyalip di lajur kanan: perilaku dan alasan yang ditampilkan.
2. Kecepatan relatif di panel "Apa yang dilihat mobil" dibanding kebenaran dasar (interval pemindaian nyata).
"""
import time
from sim3d_qa_perilaku_common import *  # noqa

STATE = r"""() => { const a = window.__qaApp, pl = a.planner, r = pl.route, it = r.items[r.ri];
  return { t: +a.simTime.toFixed(1), v: +(a.ego.v * 3.6).toFixed(1), k: pl.kNow, lat: it.type === 'road' ? +r.lat.toFixed(2) : null, item: it.type, remain: it.type === 'road' ? it.len - r.s : 0,
    beh: pl.behavior, why: pl.reason, lim: pl.limiter, act: pl.active ? pl.active.kind : null, held: pl.held ? pl.held.kind + ':' + pl.held.why : null, both: pl.bothBlocked,
    ov: pl.overtake ? pl.overtake.uid : null, kEnd: it.kEnd, obs: a.scen.obstacles.map((o) => o.type + '@k' + o.lane.k + ':' + Math.round(o.s)).join(' '), col: a.counters.collisions,
    nextIsConn: r.items[r.ri + 1] ? r.items[r.ri + 1].type : null }; }"""

with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b)
    open_sim(page, "bebas")
    install_monitor(page)
    page.keyboard.press("2")
    ev(page, "() => { const el = document.getElementById('s3d-traf'); el.value = '0'; el.dispatchEvent(new Event('input', { bubbles: true })); window.__qaApp.traffic.cars.length = 0; }")
    # --- 1. rintangan kedua saat menyalip ---
    t0 = time.time()
    while time.time() - t0 < 120:
        s = ev(page, STATE)
        if s["item"] == "road" and 60 < s["remain"] < 72 and s["k"] == 0 and s["v"] > 15 and s["kEnd"] == 0:
            break
        time.sleep(0.05)
    print("mulai", s)
    ev(page, "() => document.querySelector(\".s3d-obs[data-type='mogok']\").click()")
    # tunggu sampai mobil sudah di lajur kanan (sedang menyalip)
    t0 = time.time()
    while time.time() - t0 < 30:
        s = ev(page, STATE)
        if s["k"] == 1 and s["lat"] is not None and s["lat"] > 3.0:
            break
        time.sleep(0.05)
    print("di lajur kanan", s)
    ev(page, "() => document.querySelector(\".s3d-obs[data-type='kardus']\").click()")
    toast = ev(page, "() => [...document.querySelectorAll('.s3d-toast')].map((t) => t.textContent)")
    print("toast", toast)
    seen = []
    t0 = time.time()
    shot_done = False
    while time.time() - t0 < 25:
        s = ev(page, STATE)
        key = (s["beh"], s["why"], s["k"], s["held"])
        if not seen or seen[-1][0] != key:
            seen.append((key, s["t"], s["v"], s["lim"], s["obs"], s["both"], s["remain"]))
        if not shot_done and s["v"] < 0.5 and time.time() - t0 > 5:
            page.keyboard.press("3")
            time.sleep(1.2)
            shot(page, "repro_salip_terjebak_atas.png")
            page.keyboard.press("2")
            time.sleep(1.0)
            shot(page, "repro_salip_terjebak.png")
            shot_done = True
        time.sleep(0.2)
    for row in seen:
        print("  ", row)
    print("collisions", ev(page, "() => window.__qaApp.counters.collisions"))
    ev(page, "() => window.__qaApp.clearObstacles()")

    # --- 2. kecepatan relatif di panel ---
    res = ev(page, r"""async () => {
      const app = window.__qaApp, per = app.perception;
      const orig = per.update.bind(per);
      const out = { intervals: [], rows: [] };
      let last = null;
      per.update = function (now) {
        if (last !== null) out.intervals.push(+(now - last).toFixed(4));
        last = now;
        const e = app.ego;
        const before = new Map([...per.tracks].map(([id, t]) => [id, t.dist]));
        orig(now);
        for (const t of per.list) {
          if (!t.ref || t.cls === 'pejalan') continue;
          // laju perubahan jarak sebenarnya: turunan jarak pusat terhadap waktu dari kecepatan nyata
          const dx = t.ref.x - e.x, dz = t.ref.z - e.z, d = Math.hypot(dx, dz);
          const rvx = (t.ref.vx || 0) - e.v * Math.cos(e.h), rvz = (t.ref.vz || 0) - e.v * Math.sin(e.h);
          const truth = (dx * rvx + dz * rvz) / d;
          if (out.rows.length < 600 && Math.abs(truth) > 2 && before.has(t.id)) out.rows.push([+t.rate.toFixed(2), +truth.toFixed(2)]);
        }
      };
      await new Promise((r) => setTimeout(r, 15000));
      per.update = orig;
      return out;
    }""")
    iv = res["intervals"]
    from collections import Counter
    print("interval pemindaian (detik):", Counter(iv).most_common(4))
    rows = res["rows"]
    ratios = sorted(r / t for r, t in rows if abs(t) > 2)
    if ratios:
        print("rasio rate panel / kebenaran: n", len(ratios), "median", round(ratios[len(ratios) // 2], 3), "p10", round(ratios[len(ratios) // 10], 3), "p90", round(ratios[len(ratios) * 9 // 10], 3))
    print("LOG", [l for l in log if "CONNECTION_RESET" not in l][:10])
    b.close()
