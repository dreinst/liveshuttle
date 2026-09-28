"""Reproduksi dari uji rendam (hujan): dua rintangan di lajur kiri berjarak D m. Mobil menyalip yang pertama,
lalu kembali ke kiri menuju rintangan kedua. Apakah mobil terjebak mengangkangi dua lajur?"""
import sys
import time
from sim3d_qa_perilaku_common import *  # noqa

gaps = [float(x) for x in sys.argv[1:]] or [14, 18, 22, 26, 30]
weather = "cerah"

STATE = r"""() => { const a = window.__qaApp, pl = a.planner, r = pl.route, it = r.items[r.ri];
  return { t: +a.simTime.toFixed(1), v: +(a.ego.v * 3.6).toFixed(1), k: pl.kNow, lat: it.type === 'road' ? +r.lat.toFixed(2) : null, s: +r.s.toFixed(1), item: it.type, remain: it.type === 'road' ? it.len - r.s : 0,
    beh: pl.behavior, why: pl.reason, act: pl.active ? pl.active.kind : null, held: pl.held ? pl.held.kind + ':' + pl.held.why : null, ov: pl.overtake ? pl.overtake.uid + (pl.overtake.counted ? 'c' : '') : null,
    kEnd: it.kEnd, col: a.counters.collisions, ovN: a.counters.overtakes, laneTxt: pl.laneText }; }"""

with sync_playwright() as p:
    b = launch(p)
    for D in gaps:
        ctx, page, log = new_page(b)
        open_sim(page, "bebas")
        install_monitor(page)
        page.keyboard.press("2")
        ev(page, "() => { const el = document.getElementById('s3d-traf'); el.value = '0'; el.dispatchEvent(new Event('input', { bubbles: true })); window.__qaApp.traffic.cars.length = 0; }")
        t0 = time.time()
        while time.time() - t0 < 120:
            s = ev(page, STATE)
            if s["item"] == "road" and 70 < s["remain"] < 76 and s["k"] == 0 and s["v"] > 15 and s["kEnd"] == 0:
                break
            time.sleep(0.03)
        ev(page, "() => document.querySelector(\".s3d-obs[data-type='kardus']\").click()")
        # rintangan kedua di lajur yang sama, D m setelah yang pertama (seperti tombol ditekan dua kali)
        ok = ev(page, f"() => {{ const a = window.__qaApp, o = a.scen.obstacles[0]; if (o.s + {D} > o.lane.len - 3) return false; a.scen.add('kardus', o.lane, o.s + {D}); return o.s; }}")
        rows = []
        stuck = 0
        max_stuck = 0
        tt = time.time()
        shot_done = False
        while time.time() - tt < 30:
            st = ev(page, STATE)
            rows.append(st)
            if st["v"] < 0.3:
                stuck += 0.2
                max_stuck = max(max_stuck, stuck)
                if stuck > 6 and not shot_done:
                    shot(page, f"kembali_D{int(D)}.png")
                    shot_done = True
            else:
                stuck = 0
            time.sleep(0.2)
        lats = [r["lat"] for r in rows if r["lat"] is not None]
        last = rows[-1]
        print(f"D={D} (rintangan pertama s={ok}): menyalip {last['ovN']}, tabrakan {last['col']}, diam terlama {max_stuck:.1f} s (nyata, 1x), lat akhir {last['lat']}, perilaku akhir {last['beh']} | {last['why'][:90]} | lajur: {last['laneTxt']} | act {last['act']} held {last['held']}")
        ctx.close()
    b.close()
