"""Reproduksi keadaan dari uji rendam: mobil otonom sedang menyalip mobil mogok di lajur kanan,
lalu ada kardus di lajur kanan di depannya (misalnya karena tombol Kardus ditekan saat menyalip).
Catat perilaku, alasan, dan apakah mobil pernah bergerak lagi tanpa bantuan."""
import sys
import time
from sim3d_qa_perilaku_common import *  # noqa

AHEAD = float(sys.argv[1]) if len(sys.argv) > 1 else 40

STATE = r"""() => { const a = window.__qaApp, pl = a.planner, r = pl.route, it = r.items[r.ri];
  const o = a.scen.obstacles.map((o) => { const d = (o.x - a.ego.x) * Math.cos(a.ego.h) + (o.z - a.ego.z) * Math.sin(a.ego.h); return o.type + '@k' + o.lane.k + ':' + d.toFixed(1); }).join(' ');
  return { t: +a.simTime.toFixed(1), v: +(a.ego.v * 3.6).toFixed(1), k: pl.kNow, lat: it.type === 'road' ? +r.lat.toFixed(2) : null, s: +r.s.toFixed(1), item: it.type, remain: it.type === 'road' ? it.len - r.s : 0,
    beh: pl.behavior, why: pl.reason, lim: pl.limiter, act: pl.active ? pl.active.kind : null, held: pl.held ? pl.held.kind + ':' + pl.held.why : null, ov: pl.overtake ? pl.overtake.uid : null, obs: o, col: a.counters.collisions, kEnd: it.kEnd,
    hudBeh: document.querySelector('.s3d-badge') ? document.querySelector('.s3d-badge').textContent : null }; }"""

with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b)
    open_sim(page, "bebas")
    install_monitor(page)
    page.keyboard.press("2")
    ev(page, "() => { const el = document.getElementById('s3d-traf'); el.value = '0'; el.dispatchEvent(new Event('input', { bubbles: true })); window.__qaApp.traffic.cars.length = 0; }")
    t0 = time.time()
    while time.time() - t0 < 120:
        s = ev(page, STATE)
        if s["item"] == "road" and 66 < s["remain"] < 76 and s["k"] == 0 and s["v"] > 15 and s["kEnd"] == 0:
            break
        time.sleep(0.05)
    print("mulai", s)
    ev(page, "() => document.querySelector(\".s3d-obs[data-type='mogok']\").click()")
    # tekan tombol Kardus saat mobil baru saja masuk lajur kanan (tombol menaruh ~40 m di depan pada lajur mobil)
    t0 = time.time()
    while time.time() - t0 < 30:
        s = ev(page, STATE)
        if s["k"] == 1:
            break
        time.sleep(0.02)
    print("masuk lajur kanan", s)
    if AHEAD < 40:
        # keadaan dari uji rendam: kardus di lajur kanan, AHEAD m di depan mobil mogok
        ev(page, f"() => {{ const a = window.__qaApp, o = a.scen.obstacles[0]; a.scen.add('kardus', o.lane.sibling, o.s + {AHEAD}); return true; }}")
    else:
        ev(page, "() => document.querySelector(\".s3d-obs[data-type='kardus']\").click()")
    print("toast", ev(page, "() => [...document.querySelectorAll('.s3d-toast')].map((t) => t.textContent)"))
    seen = []
    t0 = time.time()
    shot_done = False
    still = 0
    while time.time() - t0 < 40:
        s = ev(page, STATE)
        key = (s["beh"], s["why"], s["k"], s["held"])
        if not seen or seen[-1][0] != key:
            seen.append((key, s["t"], s["v"], s["lim"], s["obs"]))
        if s["v"] < 0.3:
            still += 0.2
        if not shot_done and still > 3:
            shot(page, "terjebak_kejar.png")
            page.keyboard.press("3")
            time.sleep(1.2)
            shot(page, "terjebak_atas.png")
            page.keyboard.press("2")
            shot_done = True
        time.sleep(0.2)
    for row in seen:
        print("  ", row)
    tl = ev(page, "() => window.__qaM.behTL.slice(-30)")
    flips = sum(1 for i in range(2, len(tl)) if tl[i][1] == tl[i - 2][1] and tl[i][0] - tl[i - 2][0] < 0.35)
    for row in tl:
        print("   TL", row)
    print("perubahan perilaku cepat (bolak-balik < 0,35 detik):", flips)
    print("debug", [d for d in ev(page, "() => window.__qaApp.debugLog.slice(-12)")])
    print("final", ev(page, STATE))
    b.close()
