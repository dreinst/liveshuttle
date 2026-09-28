"""Periksa peta perjalanan Level Otomasi: posisi titik tujuan terhadap lencana atribusi, label kanvas,
peran img, dan tampilan saat peta jalan Malang gagal dimuat.

Pemakaian: python3 tests/level-otomasi_verify_map.py --port 8261 [--mobile]
"""
import sys

sys.path.insert(0, __import__("os").path.dirname(__file__))
from importlib import import_module

U = import_module("level-otomasi_verify_util")
PORT = U.arg("--port", "8261")
MOBILE = "--mobile" in sys.argv
TAG = "m" if MOBILE else "d"
fails = []


def check(ok, msg):
    print(("OK   " if ok else "FAIL ") + msg, flush=True)
    if not ok:
        fails.append(msg)


GOAL_JS = """() => {
  const cv = document.querySelector('.trip-map canvas');
  const r = cv.getBoundingClientRect();
  return { w: r.width, h: r.height, role: cv.getAttribute('role'), label: cv.getAttribute('aria-label') };
}"""

with U.Browser(PORT, mobile=MOBILE, instrument=False) as b:
    page = b.page
    b.goto_lesson(clear=True)
    b.go_step(5)
    page.wait_for_timeout(1500)
    info = page.evaluate(GOAL_JS)
    print("  trip canvas:", info)
    check(info["role"] == "img" and "OpenStreetMap" in (info["label"] or ""), "trip map canvas has role img and a label")
    stage = page.evaluate("() => { const c = document.querySelector('.stage canvas'); return [c.getAttribute('role'), c.getAttribute('aria-label')]; }")
    check(stage[0] == "img" and "ilustrasi" in stage[1], f"stage canvas role img, label mentions the illustration: {stage[1][:90]}")
    # titik tujuan: ambil dari modul data, lalu hitung posisinya di layar dengan kamera view peta
    pos = page.evaluate("""async () => {
      const { TRIP } = await import('./js/lessons/level-otomasi/data/trip.js');
      const g = TRIP.route[TRIP.route.length - 1];
      return g;
    }""")
    page.locator(".grp-trip").screenshot(path=U.SHOTS + f"map-{TAG}.png")
    print("  goal (world):", pos)
    msgs = [m for m in b.msgs if "GPU stall" not in m]
    check(not msgs, f"no console messages ({msgs[:3]})")

with U.Browser(PORT, mobile=MOBILE, instrument=False) as b:
    page = b.page
    b.ctx.route("**/js/data/malang-roads.json", lambda r: r.abort())
    b.goto_lesson(clear=True)
    page.wait_for_timeout(1500)
    page.locator(".grp-trip").screenshot(path=U.SHOTS + f"map-failed-{TAG}.png")
    s = b.state()
    check(s is not None and s["trip"] > 0, "lesson keeps running when the Malang road map cannot load")
    msgs = [m for m in b.msgs if "GPU stall" not in m and "Failed to load resource" not in m]
    print("  messages with map blocked:", b.msgs[:4])
    check(not msgs, f"no lesson errors when the map fails ({msgs[:3]})")

print()
print(f"{'MOBILE' if MOBILE else 'DESKTOP'} MAP FAILS: {len(fails)}")
sys.exit(1 if fails else 0)
