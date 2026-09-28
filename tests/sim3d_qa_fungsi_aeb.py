"""Rekam jejak rem darurat setelah pejalan kaki menyeberang mendadak (J), beberapa kali, pada beberapa cuaca."""
import sys
import time
from sim3d_qa_fungsi_util import BASE, launch, new_page, snap, wait_ready, wait_until, shot, sync_playwright

TRACE = """() => { const s = window.__sim3d; const b = document.querySelector('.is-brake .s3d-bar-val')?.textContent; const g = document.querySelector('.is-gas .s3d-bar-val')?.textContent;
 const cells = [...document.querySelectorAll('.s3d-safe')].map(c => c.querySelector('.s3d-safe-val').textContent);
 return { t: +s.simTime.toFixed(2), v: +s.ego.speedKmh.toFixed(1), beh: s.ego.behavior, aeb: s.ego.aeb, ttc: s.ego.ttc && +s.ego.ttc.toFixed(2), lim: s.ego.limiter, brake: b, gas: g, cells, c: s.counters.aebAuto, col: s.counters.collisions, jay: s.counters.jaywalkers }; }"""

weathers = sys.argv[1:] or ["cerah"]
with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b)
    page.goto(f"{BASE}/#/simulator/bebas")
    wait_ready(page)
    time.sleep(1)
    summary = []
    for w in weathers:
        page.click(f".s3d-group[data-hl=cuaca] button[data-value={w}]")
        time.sleep(1)
        for run in range(4):
            s = wait_until(page, lambda s: s["ego"]["speedKmh"] > (25 if w == "kabut" else 33) and s["ego"]["behavior"] in ("Melaju",) and not s["ego"]["aeb"], timeout=60)
            if not s:
                summary.append((w, run, "tidak pernah melaju cepat"))
                continue
            c0 = s["counters"]
            page.keyboard.press("j")
            rows = []
            t0 = time.time()
            while time.time() - t0 < 5:
                rows.append(page.evaluate(TRACE))
                if len(rows) == 12:
                    shot(page, f"aeb_{w}_{run}.png")
                time.sleep(0.05)
            last = rows[-1]
            aeb_rows = [r for r in rows if r["aeb"]]
            first_aeb = aeb_rows[0] if aeb_rows else None
            maxbrake = max((int(r["brake"].rstrip("%")) for r in rows if r["brake"]), default=0)
            minv = min(r["v"] for r in rows)
            summary.append((w, run, "v0", round(s["ego"]["speedKmh"]), "jay", last["jay"] - c0["jaywalkers"], "aebAuto+", last["c"] - c0["aebAuto"], "col+", last["col"] - c0["collisions"], "minv", minv, "maxbrakeHUD", maxbrake, "minTTC", min((r["ttc"] for r in rows if r["ttc"] is not None), default=None)))
            if run == 0:
                for r in rows[::4]:
                    print(r)
            time.sleep(3)
    for x in summary:
        print(x)
    print("LOG", log)
    b.close()
