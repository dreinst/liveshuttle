"""Reproduksi: tombol Mobil mogok ditekan saat mobil otonom sekitar 30 sampai 40 m sebelum persimpangan.
Rintangan jatuh di awal ruas setelah persimpangan (s = 14). Apakah mobil berhenti di dalam kotak
persimpangan dan macet di sana? Kendaraan lain dari arah lain ikut tertahan?"""
import sys
import time
from sim3d_qa_perilaku_common import *  # noqa

typ = sys.argv[1] if len(sys.argv) > 1 else "mogok"
dens = sys.argv[2] if len(sys.argv) > 2 else "0"

STATE = r"""() => { const a = window.__qaApp, pl = a.planner, r = pl.route, it = r.items[r.ri], nx = r.items[r.ri + 1];
  const node = it.type === 'conn' ? it.lane.node : it.seg.b;
  const ctl = a.signals.byNode.get(node.id);
  const blockedCars = a.traffic.cars.filter((c) => c.lane.type === 'road' && c.lane.node === node && c.v < 0.2 && c.decision === 'stop' && a.signals.colorAt(node.id, c.lane.dir) === 'green').length;
  return { t: +a.simTime.toFixed(1), v: +(a.ego.v * 3.6).toFixed(1), item: it.type, move: it.type === 'conn' ? it.lane.move : (nx && nx.type === 'conn' ? 'next:' + nx.lane.move : null), s: +r.s.toFixed(1), remain: it.type === 'road' ? it.len - r.s : 0,
    beh: pl.behavior, why: pl.reason, lim: pl.limiter, held: pl.held ? pl.held.kind + ':' + pl.held.why : null, ov: pl.overtake ? pl.overtake.ri + '/' + r.ri : null,
    evs: pl.evs.map((e) => e.kind + '@' + (Number.isFinite(e.start) ? e.start.toFixed(1) : 'inf')).join(','), box: a.boxOcc[node.id] ? Array.from(a.boxOcc[node.id]).join('') : null,
    sig: ctl ? ctl.describe() : 'tanpa lampu', blockedGreen: blockedCars, col: a.counters.collisions, obs: a.scen.obstacles.map((o) => o.type + ':' + Math.round(o.s)).join(' ') }; }"""

with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b)
    open_sim(page, "bebas")
    install_monitor(page)
    page.keyboard.press("2")
    ev(page, f"() => {{ const el = document.getElementById('s3d-traf'); el.value = '{dens}'; el.dispatchEvent(new Event('input', {{ bubbles: true }})); if ({dens} === 0) window.__qaApp.traffic.cars.length = 0; }}")
    t0 = time.time()
    while time.time() - t0 < 150:
        s = ev(page, STATE)
        if s["item"] == "road" and 30 < s["remain"] < 40 and s["move"] == "next:S" and s["v"] > 10:
            break
        time.sleep(0.03)
    print("mulai", s)
    ev(page, f"() => document.querySelector(\".s3d-obs[data-type='{typ}']\").click()")
    print("toast", ev(page, "() => [...document.querySelectorAll('.s3d-toast')].map((t) => t.textContent)"))
    seen = []
    t0 = time.time()
    shots = 0
    in_box_still = 0
    while time.time() - t0 < 45:
        s = ev(page, STATE)
        key = (s["item"], s["beh"], s["held"], s["evs"], round(s["v"]) == 0)
        if not seen or seen[-1][0] != key:
            seen.append((key, s["t"], s["v"], s["s"], s["why"][:80], s["box"], s["sig"], s["blockedGreen"]))
        if s["item"] == "conn" and s["v"] < 0.3:
            in_box_still += 0.2
            if shots == 0 and in_box_still > 4:
                shot(page, f"kotak_{typ}_kejar.png")
                page.keyboard.press("3")
                time.sleep(1.5)
                shot(page, f"kotak_{typ}_atas.png")
                page.keyboard.press("2")
                shots = 1
        time.sleep(0.2)
    for row in seen[:40]:
        print("  ", row)
    print("waktu diam di dalam persimpangan (detik nyata, 1x):", round(in_box_still, 1))
    print("final", ev(page, STATE))
    b.close()
