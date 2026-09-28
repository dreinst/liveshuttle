"""Uji cepat: jalankan banyak langkah fisika tanpa menggambar dan periksa aturan keras.
Pemakaian: python3 sim3d_peta_fast.py MENIT [CUACA...]"""
import json
import sys
import time
from sim3d_peta_common import launch, new_page, open_harness, snap, sync_playwright

minutes = float(sys.argv[1]) if len(sys.argv) > 1 else 5
with sync_playwright() as p:
    b = launch(p, "swift")
    ctx, page, log = new_page(b)
    open_harness(page, "jelajah")
    page.evaluate("() => window.__sim3d.debug.runSteps(0)")
    page.keyboard.press("Space")  # jeda loop tampilan supaya hanya runSteps yang menjalankan fisika
    total = int(minutes * 60 * 60)
    chunk = 1800
    done = 0
    t0 = time.time()
    while done < total:
        ms = page.evaluate(f"() => window.__sim3d.debug.runSteps({chunk})")
        done += chunk
        s = snap(page)
        t = s["traffic"]
        print(f"t={s['simTime']:7.1f} wx={s['weather']['name']:6} veh={t['vehicles']:2} out={t['outside']} peds={t['peds']} red={s['invariants']['redLight']} ped={s['invariants']['pedContact']} ovl={s['collisions']['npcOverlaps']} off={t['offRoad']} stuck={t['stuckNow']:.0f}/{t['stuckMax']:.0f} rec={t['recovered']} clamps={s['shield']['clamps']} fcl={t['followClamps']} lcl={t['lineClamps']} xing={t['crossings']} gaveup={t['gaveUp']} shuttle={s['shuttle']['state']}:{s['shuttle']['nextHalte']} ms/step={ms/chunk:.2f}", flush=True)
    s = snap(page)
    print(json.dumps(s["debugLog"][-20:], ensure_ascii=False))
    print(json.dumps(s["shield"], ensure_ascii=False))
    print(json.dumps(s["invariants"], ensure_ascii=False))
    print("LOG", log[:10], "wall", round(time.time() - t0))
    b.close()
