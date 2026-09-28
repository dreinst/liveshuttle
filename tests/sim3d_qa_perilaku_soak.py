"""Uji rendam perilaku: 5 menit waktu simulasi pada 4x di Mode Bebas, kepadatan bawaan,
ditambah rintangan dan pejalan kaki mendadak secara acak. Pemantau di halaman mencatat
tabrakan NPC, tabrakan ego, NPC menabrak pejalan kaki, lewat lampu merah, keluar jalan,
salah sisi, NaN, macet, hijau tanpa antrean, dan waktu merah terlama saat ada antrean."""
import random
import sys
import time
from sim3d_qa_perilaku_common import *  # noqa

SIM_SECS = float(sys.argv[1]) if len(sys.argv) > 1 else 300
weather = sys.argv[2] if len(sys.argv) > 2 else "cerah"
signal = sys.argv[3] if len(sys.argv) > 3 else "adaptif"
tag = sys.argv[4] if len(sys.argv) > 4 else f"{weather}_{signal}"
cars_n = int(sys.argv[5]) if len(sys.argv) > 5 else None
peds_n = int(sys.argv[6]) if len(sys.argv) > 6 else None
random.seed(int(sys.argv[7]) if len(sys.argv) > 7 else 7)
DIAG = r"""() => { const a = window.__qaApp, pl = a.planner, r = pl.route, it = r.items[r.ri], e = a.ego;
  return { t: +a.simTime.toFixed(1), beh: pl.behavior, why: pl.reason, lim: pl.limiter, item: it.type + (it.type === 'conn' ? it.lane.move : ''), s: +r.s.toFixed(1), lat: +r.lat.toFixed(2), k: pl.kNow,
    ov: pl.overtake ? { ri: pl.overtake.ri, rri: r.ri, sEnd: +pl.overtake.sEnd.toFixed(1), sOut: +pl.overtake.sOut.toFixed(1), counted: pl.overtake.counted, noBack: pl.overtake.noBack } : null,
    held: pl.held, evs: pl.evs.map((x) => x.kind + '@' + (Number.isFinite(x.start) ? x.start.toFixed(1) : 'inf')).join(','), act: pl.active ? pl.active.kind : null, both: pl.bothBlocked, backup: !!pl.backup,
    items: r.items.slice(r.ri, r.ri + 3).map((x) => x.type === 'road' ? 'R' + x.kStart + x.kEnd + ':' + x.len.toFixed(0) : 'C' + x.lane.move + ':' + x.len.toFixed(0)).join(' '),
    obs: a.scen.obstacles.map((o) => { const d = (o.x - e.x) * Math.cos(e.h) + (o.z - e.z) * Math.sin(e.h); const l = -(o.x - e.x) * Math.sin(e.h) + (o.z - e.z) * Math.cos(e.h); return o.type + ' k' + o.lane.k + ' depan ' + d.toFixed(1) + ' samping ' + l.toFixed(1); }) }; }"""

CLICK_BTN = "(sel) => { const b = document.querySelector(sel); if (!b) return false; b.click(); return true; }"
CLICK_TEXT = "(t) => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === t); if (!b) return false; b.click(); return true; }"

with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b)
    open_sim(page, "bebas")
    print("monitor", install_monitor(page))
    if weather != "cerah":
        ev(page, CLICK_BTN, f".s3d-seg-btn[data-value='{weather}']")
    if signal != "adaptif":
        ev(page, CLICK_BTN, f".s3d-seg-btn[data-value='{signal}']")
    if cars_n is not None:
        ev(page, f"() => {{ for (const [id, v] of [['s3d-traf', {cars_n}], ['s3d-ped', {peds_n}]]) {{ const el = document.getElementById(id); el.value = String(v); el.dispatchEvent(new Event('input', {{ bubbles: true }})); }} }}")
    page.keyboard.press("]")
    page.keyboard.press("]")
    n_stops = 0
    diags = []
    s = snap(page)
    print("timeScale", s["timeScale"], "weather", s["weather"], "signal", s["signalMode"], "cars", s["traffic"]["cars"], "peds", s["traffic"]["peds"])
    start_sim = s["simTime"]
    wall0 = time.time()
    samples = []
    events = []
    next_event = start_sim + 8
    next_sample = start_sim
    next_shot = start_sim + 60
    next_clear = start_sim + 70
    page.evaluate("() => { if (window.gc) window.gc(); }")
    while True:
        c = counts(page)
        t = c["t"]
        if t - start_sim >= SIM_SECS:
            break
        if t >= next_sample:
            c["wall"] = round(time.time() - wall0, 1)
            samples.append(c)
            next_sample = t + 20
        if t >= next_event:
            r = random.random()
            if r < 0.45:
                typ = random.choice(["mogok", "kerucut", "kardus"])
                ok = ev(page, CLICK_BTN, f".s3d-obs[data-type='{typ}']")
                events.append((round(t, 1), "rintangan", typ, ok))
            elif r < 0.85:
                page.keyboard.press("j")
                events.append((round(t, 1), "J"))
            else:
                # taruh dengan klik di jalan (titik probe 28 m di depan)
                ev(page, "() => window.__qaApp.armClick(true)")
                pt = ev(page, "() => { const s = window.__sim3d; const pr = s.probe; if (!pr) return null; const sc = s.screenOf(pr.x + 0, pr.z + 0); return sc; }")
                if pt and pt["visible"] and 0 < pt["x"] < 1000 and 60 < pt["y"] < 800:
                    page.mouse.click(pt["x"], pt["y"])
                    events.append((round(t, 1), "klik", round(pt["x"]), round(pt["y"])))
                ev(page, "() => window.__qaApp.armClick(false)")
            next_event = t + random.uniform(6, 14)
        if t >= next_clear:
            ev(page, CLICK_TEXT, "Hapus rintangan")
            events.append((round(t, 1), "hapus"))
            next_clear = t + random.uniform(50, 80)
        ls = ev(page, "() => (window.__qaM.egoLongStops || []).length")
        if ls > n_stops:
            n_stops = ls
            d = ev(page, DIAG)
            diags.append(d)
            shot(page, f"soak_{tag}_macet_{int(t - start_sim)}.png")
        if t >= next_shot:
            shot(page, f"soak_{tag}_{int(t - start_sim)}.png")
            next_shot = t + 100
        time.sleep(0.25)
    wall = time.time() - wall0
    page.evaluate("() => { if (window.gc) window.gc(); }")
    time.sleep(0.5)
    c = counts(page)
    c["wall"] = round(wall, 1)
    samples.append(c)
    shot(page, f"soak_{tag}_end.png")
    S = summary(page)
    final = snap(page)
    print(f"sim {SIM_SECS} s dalam {wall:.1f} s nyata (laju {SIM_SECS / wall:.2f}x)")
    print("events", len(events), events[:40])
    print("SAMPLES")
    for smp in samples:
        print(smp)
    print("SUMMARY")
    dump(S)
    print("DIAG ego diam > 20 s")
    for d in diags:
        print("  ", d)
    print("BEHAVIOR TIMELINE (terakhir 60)")
    for row in ev(page, "() => window.__qaM.behTL.slice(-60)"):
        print("  ", row)
    print("FINAL counters", final["counters"], "traffic", final["traffic"])
    # statistik TTC: selisih planner vs kebenaran dasar
    tt = ev(page, "() => window.__qaM.ttcPairs")
    rel = sorted(abs(a - g) / g for a, g, *_ in tt if 0.3 < g < 6)
    if rel:
        print("TTC n", len(rel), "median rel err", round(rel[len(rel) // 2], 3), "p95", round(rel[int(len(rel) * 0.95)], 3), "max", round(rel[-1], 3))
        worst = sorted(tt, key=lambda x: -abs(x[0] - x[1]) / max(x[1], 0.3))[:8]
        print("TTC worst", worst)
    print("LOG", [l for l in log if "CONNECTION_RESET" not in l][:20])
    b.close()
