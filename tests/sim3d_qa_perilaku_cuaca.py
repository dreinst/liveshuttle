"""Uji cuaca: jangkauan sensor, batas kecepatan, alasan, dan konsistensi titik LiDAR/deteksi dengan jangkauan."""
import time
from sim3d_qa_perilaku_common import *  # noqa

PROBE = r"""() => {
  const app = window.__qaApp, e = app.ego, S = app.sensing, R = S.ranges();
  let maxPt = 0;
  for (let i = 0; i < S.pointCount; i++) { const d = Math.hypot(S.pos[i*3] - e.x, S.pos[i*3+2] - e.z); if (d > maxPt) maxPt = d; }
  let maxDet = 0, maxCam = 0;
  for (const t of app.perception.list) { const d = Math.hypot(t.x - e.x, t.z - e.z) - Math.max(t.hl, t.hw); if (d > maxDet) maxDet = d; if (t.cam && d > maxCam) maxCam = d; }
  let maxCamSeen = 0;
  for (const [id, s] of S.seen) if (s.cam) { const d = Math.hypot(s.o.x - e.x, s.o.z - e.z); if (d > maxCamSeen) maxCamSeen = d; }
  return { R, maxPt, maxDet, maxCamSeen, ring: S.ring.scale.x, fov: S.fovGroup.scale.x, v: e.v * 3.6, cap: app.weather.fx.capKmh, beh: app.planner.behavior, why: app.planner.reason, lim: app.planner.limiter,
    brakeMax: app.weather.fx.brakeMax, npc: app.weather.fx.npcSpeed, light: app.perception.light, sensLine: document.querySelector('.s3d-panel[data-tab=persepsi] .s3d-panel-body').innerText.split('\n').slice(0, 6).join(' | '),
    capReason: app.weather.capReason(), fogNear: app.scene.fog.near, fogFar: app.scene.fog.far };
}"""

with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b)
    open_sim(page, "bebas")
    install_monitor(page)
    page.keyboard.press("]")  # 2x
    for w in ["cerah", "hujan", "kabut", "malam", "cerah"]:
        ev(page, "(w) => document.querySelector(`.s3d-seg-btn[data-value='${w}']`).click()", w)
        time.sleep(0.4)
        toast = ev(page, "() => [...document.querySelectorAll('.s3d-toast')].map((t) => t.textContent)")
        vmax = 0
        maxpt = 0
        maxdet = 0
        maxcam = 0
        behs = set()
        t0 = time.time()
        first = None
        while time.time() - t0 < 25:
            r = ev(page, PROBE)
            first = first or r
            if time.time() - t0 > 4:
                vmax = max(vmax, r["v"])
            maxpt = max(maxpt, r["maxPt"])
            maxdet = max(maxdet, r["maxDet"])
            maxcam = max(maxcam, r["maxCamSeen"])
            behs.add(r["beh"])
            time.sleep(0.2)
        shot(page, f"cuaca_{w}.png")
        print(w, {"R": first["R"], "ring": first["ring"], "fov": first["fov"], "cap": first["cap"], "vmax_after4s": round(vmax, 1), "maxLidarPt": round(maxpt, 1), "maxDet": round(maxdet, 1), "maxCamSeen": round(maxcam, 1),
                  "brakeMax": round(first["brakeMax"], 2), "npc": first["npc"], "fog": (first["fogNear"], first["fogFar"])})
        print("   toast:", toast)
        print("   capReason:", first["capReason"])
        print("   HUD:", first["sensLine"][:200])
        print("   beh:", sorted(behs), "| why:", r["why"], "| lim:", r["lim"])
    S = summary(page)
    print("col", S["counters"]["collisions"], "egoRed", S["egoRed"], S["egoRedEx"], "npcRed", S["npcRed"])
    print("LOG", [l for l in log if "CONNECTION_RESET" not in l][:10])
    b.close()
