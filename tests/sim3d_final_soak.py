"""Verifikasi akhir: uji tahan di Mode Bebas (rute #/simulator/bebas) pada kecepatan 4x.
Pemakaian: python3 tests/sim3d_final_soak.py [detik_dinding=180] [acara: 0|1] [kepadatan mobil]
Dicatat: tabrakan, tumpang tindih NPC, macet mobil otonom dan NPC, kecepatan, dan
lama mobil merayap karena tikungan yang masih jauh."""
import random
import sys
import time
from sim3d_final_common import *  # noqa

WALL = float(sys.argv[1]) if len(sys.argv) > 1 else 180
EVENTS = (sys.argv[2] if len(sys.argv) > 2 else "1") == "1"
DENS = sys.argv[3] if len(sys.argv) > 3 else None
TAG = f"{int(WALL)}_{'ev' if EVENTS else 'plain'}{'_' + DENS if DENS else ''}"

CAPTURE = r"""
(() => {
  Object.defineProperty(Object.prototype, 'app', {
    configurable: true, enumerable: false,
    get() { return undefined; },
    set(v) {
      try { if (v && v.constructor && v.constructor.name === 'App') window.__app = v; } catch (e) {}
      Object.defineProperty(this, 'app', { value: v, writable: true, configurable: true, enumerable: true });
    },
  });
})();
"""

# Pengamat di dalam halaman: jalan tiap frame lewat pengait langkah simulasi.
MONITOR = r"""
() => {
  const app = window.__app;
  if (!app || app.__mon) return !!app;
  const m = { t: 0, fast: 0, crawl: 0, crawlOnRoad: 0, sumV: 0, n: 0, npcStill: new Map(), npcMaxStill: 0, npcMaxStillWhere: null,
              egoStill: 0, egoMaxStill: 0, egoMaxStillWhy: '', maxOverlap: 0, overlapSteps: 0, redRun: 0, nan: 0 };
  app.__mon = m;
  const orig = app.step.bind(app);
  app.step = (dt) => {
    orig(dt);
    const e = app.ego;
    const pl = app.planner;
    m.t += dt;
    m.n++;
    m.sumV += Math.max(0, e.v);
    if (!Number.isFinite(e.x) || !Number.isFinite(e.v)) m.nan++;
    if (e.v * 3.6 > 38) m.fast += dt;
    const b = pl.binding;
    const it = pl.route && pl.route.items[pl.route.ri];
    if (b && b.kind === 'tikungan' && b.dist > 35) m.crawl += dt;
    if (b && b.kind === 'tikungan' && it && it.type === 'road') m.crawlOnRoad += dt;
    if (Math.abs(e.v) < 0.1) {
      m.egoStill += dt;
      if (m.egoStill > m.egoMaxStill) { m.egoMaxStill = m.egoStill; m.egoMaxStillWhy = `${pl.behavior}: ${pl.reason}`; }
    } else m.egoStill = 0;
    if (m.n % 30 === 0) {
      const ov = app.traffic.countOverlaps();
      if (ov > m.maxOverlap) m.maxOverlap = ov;
      if (ov) m.overlapSteps++;
      const seen = new Set();
      for (const c of app.traffic.cars) {
        seen.add(c.id);
        const prev = m.npcStill.get(c.id) || 0;
        const still = c.v < 0.1 ? prev + dt * 30 : 0;
        m.npcStill.set(c.id, still);
        if (still > m.npcMaxStill) { m.npcMaxStill = still; m.npcMaxStillWhere = { x: Math.round(c.x), z: Math.round(c.z), lane: c.lane.type, dec: c.decision || null }; }
      }
      for (const id of [...m.npcStill.keys()]) if (!seen.has(id)) m.npcStill.delete(id);
    }
  };
  return true;
}
"""

READ = r"""
() => { const m = window.__app.__mon; return { t: m.t, fast: m.fast, crawl: m.crawl, crawlOnRoad: m.crawlOnRoad, avgKmh: m.sumV / Math.max(1, m.n) * 3.6,
  npcMaxStill: m.npcMaxStill, npcMaxStillWhere: m.npcMaxStillWhere, egoMaxStill: m.egoMaxStill, egoMaxStillWhy: m.egoMaxStillWhy, maxOverlap: m.maxOverlap,
  overlapSamples: m.overlapSteps, nan: m.nan }; }
"""

random.seed(11)
with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b, init=CAPTURE)
    s = open_route(page, "bebas")
    assert page.evaluate(MONITOR), "App tidak tertangkap"
    if DENS:
        page.evaluate(f"() => {{ const e = document.querySelector('#s3d-traf'); e.value = '{DENS}'; e.dispatchEvent(new Event('input', {{ bubbles: true }})); }}")
    page.evaluate("() => document.activeElement && document.activeElement.blur()")
    page.keyboard.press("]")
    page.keyboard.press("]")
    time.sleep(0.3)
    assert snap(page)["timeScale"] == 4, snap(page)["timeScale"]
    t0 = time.time()
    nev = 0
    while time.time() - t0 < WALL:
        time.sleep(1.0)
        if not EVENTS:
            continue
        r = random.random()
        if r < 0.10:
            page.keyboard.press("j"); nev += 1
        elif r < 0.18:
            page.keyboard.press("o"); nev += 1
        elif r < 0.21:
            page.keyboard.press(random.choice(["1", "2", "3", "4"]))
        elif r < 0.24:
            w = random.choice(["cerah", "hujan", "kabut", "malam"])
            page.click(f".s3d-group[data-hl=cuaca] button[data-value={w}]")
            page.evaluate("() => document.activeElement && document.activeElement.blur()")
        elif r < 0.26:
            page.evaluate("() => window.__app.clearObstacles()")
    s = snap(page)
    m = page.evaluate(READ)
    shot(page, f"soak_{TAG}_end.png")
    print(f"soak {TAG}: sim {m['t']:.0f} s dalam {WALL:.0f} s dinding, kecepatan rata-rata {m['avgKmh']:.1f} km/jam, di atas 38 km/jam {100*m['fast']/max(1,m['t']):.1f}%")
    print("  merayap karena tikungan >35 m", round(m["crawl"], 1), "s; tikungan saat masih di ruas", round(m["crawlOnRoad"], 1), "s")
    print("  counters", s["counters"])
    print("  NPC overlap maks", m["maxOverlap"], "sampel dengan overlap", m["overlapSamples"], "| NaN", m["nan"])
    print("  mobil otonom diam terlama", round(m["egoMaxStill"], 1), "s:", m["egoMaxStillWhy"][:100])
    print("  NPC diam terlama", round(m["npcMaxStill"], 1), "s di", m["npcMaxStillWhere"])
    print("  mobil", s["traffic"]["cars"], "pejalan", s["traffic"]["peds"], "rintangan", s["traffic"]["obstacles"], "respawn", s["traffic"]["respawns"], "fps", round(s["render"]["fps"]))
    print("  debug", [d for d in s["debug"] if d.get("type") == "tabrakan"][-5:])
    print("LOG", log, "resets", page.resets)
    b.close()
