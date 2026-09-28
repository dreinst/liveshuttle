"""Uji J: pejalan kaki menyeberang mendadak pada kecepatan bawaan (50 km/jam), cuaca tertentu.
Tiap percobaan: tunggu mobil melaju cepat di ruas lurus, tekan J, amati AEB, TTC, jarak minimum, tabrakan."""
import sys
import time
from sim3d_qa_perilaku_common import *  # noqa

weather = sys.argv[1] if len(sys.argv) > 1 else "cerah"
trials = int(sys.argv[2]) if len(sys.argv) > 2 else 8
min_kmh = float(sys.argv[3]) if len(sys.argv) > 3 else 44

RESET = "() => { const M = window.__qaM; M.pedMinDist = 99; M.pedMinEx = null; M.aebEvents = []; M.ttcPairs.length = 0; }"
STATE = r"""() => {
  const app = window.__qaApp, pl = app.planner, r = pl.route, e = app.ego;
  const it = r.items[r.ri];
  const jay = app.peds.peds.find((p) => p.jay);
  return { t: app.simTime, v: e.v * 3.6, item: it.type, remain: it.type === 'road' ? it.len - r.s : 0, beh: pl.behavior, ttc: Number.isFinite(pl.ttc) ? pl.ttc : null,
    aeb: pl.aeb, col: app.counters.collisions, aebN: app.counters.aebAuto, jay: jay ? { w: jay.jay.w, stage: jay.jay.stage, d: Math.hypot(jay.x - e.x, jay.z - e.z) } : null,
    pending: !!app.scen.pendingJay, hudTtc: document.querySelector('.s3d-safety .s3d-safe:nth-child(2) .s3d-safe-val').textContent, lead: pl.binding ? pl.binding.kind : null,
    stop: pl.stopInfo ? Math.round(pl.stopInfo.dist) : null };
}"""

with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b)
    open_sim(page, "bebas")
    install_monitor(page)
    if weather != "cerah":
        page.click(f".s3d-seg-btn[data-value='{weather}']")
    results = []
    for trial in range(trials):
        # tunggu kondisi: cepat, di ruas jalan, sisa ruas cukup, tidak sedang mengikuti objek dekat
        t0 = time.time()
        ok = False
        while time.time() - t0 < 90:
            s = ev(page, STATE)
            if s["v"] >= min_kmh and s["item"] == "road" and s["remain"] > 45 and not s["jay"] and not s["aeb"] and (s["stop"] is None or s["stop"] > 45):
                ok = True
                break
            time.sleep(0.1)
        if not ok:
            print("trial", trial, "kondisi tidak tercapai", s)
            continue
        ev(page, RESET)
        before = s
        page.keyboard.press("j")
        trace = []
        tt = time.time()
        shot_done = False
        while time.time() - tt < 6:
            st = ev(page, STATE)
            trace.append(st)
            if not shot_done and st["aeb"] and trial == 0:
                shot(page, f"jay_{weather}_aeb.png")
                shot_done = True
            if st["jay"] is None and not st["pending"] and len(trace) > 10 and st["v"] > 5:
                break
            time.sleep(0.05)
        M = ev(page, "() => { const M = window.__qaM; return { pedMin: M.pedMinDist, ex: M.pedMinEx, aeb: M.aebEvents, ttc: M.ttcPairs.slice(0, 400) }; }")
        after = ev(page, STATE)
        ttcs = [x["ttc"] for x in trace if x["ttc"] is not None]
        jd = [x["jay"]["d"] for x in trace if x["jay"]]
        spawn_d = jd[0] if jd else None
        errs = [abs(a - g) for a, g, *_ in M["ttc"] if g < 6]
        rel = [abs(a - g) / g for a, g, *_ in M["ttc"] if 0.3 < g < 6]
        res = {
            "trial": trial, "v0": round(before["v"], 1), "spawn_d": round(spawn_d, 1) if spawn_d else None,
            "aeb_delta": after["aebN"] - before["aebN"], "col_delta": after["col"] - before["col"],
            "min_ttc": round(min(ttcs), 2) if ttcs else None, "ped_min_gap": round(M["pedMin"], 2), "ped_ex": M["ex"],
            "aeb_ev": M["aeb"][:2], "ttc_abs_err_max": round(max(errs), 3) if errs else None, "ttc_rel_err_med": round(sorted(rel)[len(rel)//2], 3) if rel else None,
            "hud_ttc_seen": sorted(set(x["hudTtc"] for x in trace))[:6], "behaviors": sorted(set(x["beh"] for x in trace)),
        }
        results.append(res)
        print(res, flush=True)
        # biarkan mobil kembali melaju
        time.sleep(1.0)
    shot(page, f"jay_{weather}_end.png")
    tot_col = sum(r["col_delta"] for r in results)
    tot_aeb = sum(1 for r in results if r["aeb_delta"] > 0)
    print("RINGKASAN", weather, "trials", len(results), "tabrakan", tot_col, "percobaan dengan AEB", tot_aeb, "min gap", min((r["ped_min_gap"] for r in results), default=None))
    print("LOG", log[:10])
    b.close()
