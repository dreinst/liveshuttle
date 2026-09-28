"""Uji tekanan tanpa menggambar: beberapa biji acak dan kepadatan lalu lintas tinggi.
Pemakaian: python3 sim3d_peta_stress.py MENIT KEPADATAN BIJI [BIJI...]"""
import json
import sys

from sim3d_peta_common import launch, new_page, snap, sync_playwright, BASE

minutes = float(sys.argv[1]) if len(sys.argv) > 1 else 20
density = int(sys.argv[2]) if len(sys.argv) > 2 else 70
seeds = [int(x) for x in sys.argv[3:]] or [1, 2, 3]
bad = 0
with sync_playwright() as p:
    b = launch(p, "swift")
    for seed in seeds:
        ctx, page, log = new_page(b)
        page.add_init_script(f"window.__sim3dSeed = {seed};")
        page.goto(f"{BASE}/tests/sim3d_harness.html?mode=jelajah")
        page.wait_for_function("() => window.__sim3d && window.__sim3d.ready", timeout=90000)
        page.keyboard.press("Space")
        page.evaluate(f"() => window.__sim3d.debug.setTraffic({density})")
        steps = int(minutes * 3600)
        done = 0
        dumped = False
        while done < steps:
            page.evaluate("() => window.__sim3d.debug.runSteps(1800)")
            done += 1800
            if not dumped and snap(page)["traffic"]["stuckNow"] > 150:
                dumped = True
                print("MACET t=", round(snap(page)["simTime"]), flush=True)
                for v in page.evaluate("() => window.__sim3d.debug.vehicles(100)"):
                    print("  ", json.dumps(v), flush=True)
        s = snap(page)
        t = s["traffic"]
        row = dict(seed=seed, simTime=round(s["simTime"]), veh=t["vehicles"], red=s["invariants"]["redLight"], ped=s["invariants"]["pedContact"], ovl=s["collisions"]["npcOverlaps"], off=t["offRoad"], stuckMax=round(t["stuckMax"]), recovered=t["recovered"], clamps=s["shield"]["clamps"], crossings=t["crossings"], shieldShuttle=s["shield"]["shuttle"], shieldNpc=s["shield"]["npc"], shuttle=s["shuttle"]["state"], replans=s["shuttle"]["replans"])
        print(json.dumps(row), flush=True)
        if row["clamps"]:
            print("CLAMP", json.dumps(s["shield"]["clampLog"][-5:], ensure_ascii=False))
        if row["red"] or row["ped"] or row["ovl"] or row["off"] or row["recovered"] or row["stuckMax"] > 150:
            bad += 1
            print(json.dumps(s["debugLog"][-8:], ensure_ascii=False))
            print(json.dumps(s["shield"]["clampLog"][-5:], ensure_ascii=False))
        if log:
            print("LOG", log[:5])
        ctx.close()
    b.close()
print("GAGAL" if bad else "LULUS", bad)
