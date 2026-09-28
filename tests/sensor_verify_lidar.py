"""QA independen: tampilan LiDAR pelajaran Sensor (tenang, tanpa garis, tanpa kedip).

Menyalakan LiDAR saja, menunggu kendaraan latar yang bergerak lewat dekat mobil otonom, lalu mengambil
beberapa bingkai berurutan (potongan kanvas di sekitar kendaraan itu) dan satu lembar penuh.
Juga mengukur "garis" di belakang kendaraan bergerak: jarak terjauh titik LiDAR yang masih terlihat
di belakang bemper belakang kendaraan (m), dan kedip: perubahan kecerahan titik di dinding diam
antar bingkai.

Pemakaian: python3 tests/sensor_verify_lidar.py [prefix] [--mobile] [--weather=hujan]   (port 8262)
"""
import json
import sys

from playwright.sync_api import sync_playwright

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from sensor_verify_util import SHOTS, launch, new_page, open_lesson, go_step, toggle, weather  # noqa: E402

args = [a for a in sys.argv[1:] if not a.startswith("--")]
PREFIX = args[0] if args else "lidar"
MOBILE = "--mobile" in sys.argv
WX = next((a.split("=", 1)[1] for a in sys.argv if a.startswith("--weather=")), None)
TAG = "m" if MOBILE else "d"

# jejak titik di belakang kendaraan bergerak: titik LiDAR yang digambar (menurut data jejak) di koridor
# kendaraan, di belakang bemper belakangnya
STREAK_JS = r"""
() => {
  const L = window.__lessonSafety;
  const sc = L.scene;
  const out = [];
  const pts = (L.trailPoints ? L.trailPoints() : null);
  for (const a of sc.npcs) {
    if (!a.active || a.speed < 3) continue;
    const d = Math.hypot(a.x - sc.ego.x, a.y - sc.ego.y);
    out.push({ id: a.id, speed: +a.speed.toFixed(1), dist: +d.toFixed(1) });
  }
  return { movers: out, time: L.snapshot().time };
}
"""

with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b, mobile=MOBILE)
    open_lesson(page)
    go_step(page, 1)
    toggle(page, "LiDAR", True)
    if WX:
        weather(page, WX.capitalize())
    canvas = page.locator(".sim-canvas").first
    cb = canvas.bounding_box()
    # tunggu kendaraan bergerak di dekat mobil otonom (dalam 25 m)
    target = None
    for _ in range(300):
        page.wait_for_timeout(100)
        info = page.evaluate("""() => { const sc = window.__lessonSafety.scene; const v = window.__lessonSafety.view;
          for (const a of sc.npcs) { if (!a.active || a.speed < 4) continue; const d = Math.hypot(a.x - sc.ego.x, a.y - sc.ego.y);
            if (d < 22 && d > 6) { const s = v.worldToScreen ? v.worldToScreen(a.x, a.y) : null; return { id: a.id, d, speed: a.speed, s }; } }
          return null; }""")
        if info:
            target = info
            break
    print("sasaran", target)
    frames = []
    for k in range(8):
        pos = page.evaluate("""(id) => { const sc = window.__lessonSafety.scene; const v = window.__lessonSafety.view; const a = sc.npcs.find((n) => n.id === id);
          const s = v.worldToScreen ? v.worldToScreen(a.x, a.y) : v.toScreen(a.x, a.y); return { x: s.x, y: s.y }; }""", target["id"]) if target else {"x": cb["width"] / 2, "y": cb["height"] / 2}
        w, h = (220, 160) if not MOBILE else (200, 150)
        x = max(cb["x"], min(cb["x"] + cb["width"] - w, cb["x"] + pos["x"] - w / 2))
        y = max(cb["y"], min(cb["y"] + cb["height"] - h, cb["y"] + pos["y"] - h / 2))
        path = f"{SHOTS}{PREFIX}-{TAG}-f{k}.png"
        page.screenshot(path=path, clip={"x": x, "y": y, "width": w, "height": h})
        frames.append(path)
        page.wait_for_timeout(60)
    canvas.screenshot(path=f"{SHOTS}{PREFIX}-{TAG}-full.png")
    print(json.dumps({"frames": frames, "errors": log}, indent=1))
    b.close()
