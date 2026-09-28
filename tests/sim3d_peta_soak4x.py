"""Uji rendam dengan loop tampilan sungguhan: kecepatan 4x selama N menit waktu nyata, kamera
berganti-ganti, tangkapan layar berkala, lalu periksa aturan keras, tumpang tindih, keluar jalan,
kemacetan, dan galat konsol. Pemakaian: python3 sim3d_peta_soak4x.py [MENIT] [gpu|swift]"""
import json
import sys
import time

from sim3d_peta_common import launch, new_page, open_harness, snap, shot, sync_playwright

minutes = float(sys.argv[1]) if len(sys.argv) > 1 else 10
mode = sys.argv[2] if len(sys.argv) > 2 else "gpu"
with sync_playwright() as p:
    b = launch(p, mode)
    ctx, page, log = new_page(b)
    open_harness(page, "jelajah")
    renderer = page.evaluate("""() => { const c = document.createElement('canvas'); const gl = c.getContext('webgl2'); const e = gl && gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?'; }""")
    print("renderer", renderer, flush=True)
    page.get_by_role("button", name="4x").click()
    cams = ["2", "1", "3", "4"]
    t0 = time.time()
    k = 0
    fps = []
    next_shot = 0
    while time.time() - t0 < minutes * 60:
        page.keyboard.press(cams[k % len(cams)])
        k += 1
        time.sleep(15)
        s = snap(page)
        fps.append(s["render"]["fps"])
        t = s["traffic"]
        print(f"wall={time.time() - t0:5.0f}s sim={s['simTime']:7.1f} x{s['timeScale']} cam={s['camera']:9} wx={s['weather']['name']:6} fps={s['render']['fps']:5.1f} frameMs={s['render']['frameMs']:5.1f} ratio={s['render']['pixelRatio']} veh={t['vehicles']} peds={t['peds']} red={s['invariants']['redLight']} ped={s['invariants']['pedContact']} ovl={s['collisions']['npcOverlaps']} off={t['offRoad']} stuck={t['stuckNow']:.0f}/{t['stuckMax']:.0f} xing={t['crossings']} clamps={s['shield']['clamps']} dropped={s['render']['droppedSteps']} shuttle={s['shuttle']['state']}:{s['shuttle']['nextHalte']}", flush=True)
        if time.time() - t0 >= next_shot:
            shot(page, f"soak4x_{mode}_{int(time.time() - t0):04d}_{s['camera']}_{s['weather']['name']}.png")
            next_shot += 150
    s = snap(page)
    t = s["traffic"]
    ok = s["invariants"]["redLight"] == 0 and s["invariants"]["pedContact"] == 0 and s["collisions"]["npcOverlaps"] == 0 and t["offRoad"] == 0 and t["stuckMax"] < 150 and not log
    print(json.dumps({"simTime": round(s["simTime"]), "weatherChanges": s["weather"]["changes"], "fpsMin": round(min(fps), 1), "fpsAvg": round(sum(fps) / len(fps), 1), "stuckMax": round(t["stuckMax"]), "recovered": t["recovered"], "shield": s["shield"]["shuttle"], "npcShield": s["shield"]["npc"], "clamps": s["shield"]["clamps"], "droppedSteps": s["render"]["droppedSteps"], "replans": s["shuttle"]["replans"]}))
    print("LOG", log[:10])
    print("LULUS" if ok else "GAGAL")
    b.close()
