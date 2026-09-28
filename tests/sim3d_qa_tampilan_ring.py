"""QA visual sensor: seberapa banyak cincin jangkauan LiDAR dan bidang kamera yang benar-benar terlihat
(tidak tertutup panel) pada preset kamera tiap langkah tutorial dan cuaca."""
import math
import time

from playwright.sync_api import sync_playwright

from sim3d_qa_tampilan_common import BASE, launch, new_page, snap, wait_ready, shot

VIS_JS = r"""
() => {
  const s = window.__sim3d;
  const R = s.sensing.lidarRange, RC = s.sensing.cameraRange;
  const e = s.ego;
  const box = (sel) => { const el = document.querySelector(sel); if (!el || el.offsetParent === null) return null; const r = el.getBoundingClientRect(); return r.width ? r : null; };
  const covers = [box('.s3d-left'), box('.s3d-right .s3d-panel'), box('.s3d-top'), box('.s3d-safety')].filter(Boolean);
  // panel kanan: pakai seluruh kolom kanan
  const right = document.querySelector('.s3d-right').getBoundingClientRect();
  const left = document.querySelector('.s3d-left');
  const lr = left && getComputedStyle(left).display !== 'none' ? document.querySelector('.s3d-tut').getBoundingClientRect() : null;
  const stage = document.querySelector('.s3d-stage').getBoundingClientRect();
  const free = (p) => {
    if (!p || !p.visible) return false;
    if (p.x < stage.left || p.x > stage.right || p.y < stage.top + 52 || p.y > stage.bottom - 80) return false;
    if (p.x > right.left - 2) return false;
    if (lr && p.x < lr.right && p.y < lr.bottom) return false;
    return true;
  };
  let ring = 0, n = 72;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    if (free(s.screenOf(e.x + Math.cos(a) * R, e.z + Math.sin(a) * R))) ring++;
  }
  let fov = 0, m = 0;
  for (let i = 0; i <= 12; i++) {
    const a = e.heading - Math.PI / 4 + (i / 12) * Math.PI / 2;
    for (const f of [0.5, 1]) { m++; if (free(s.screenOf(e.x + Math.cos(a) * RC * f, e.z + Math.sin(a) * RC * f))) fov++; }
  }
  const ego = s.screenOf(e.x, e.z);
  return { R, RC, ringVisiblePct: Math.round((100 * ring) / n), fovVisiblePct: Math.round((100 * fov) / m), egoFree: free(ego), camera: s.camera, step: s.tutorial.step, weather: s.weather };
}
"""

with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b)
    page.goto(f"{BASE}/index.html#/simulator/tutorial")
    wait_ready(page)
    time.sleep(2)
    for i in range(9):
        time.sleep(2)
        print(page.evaluate(VIS_JS))
        page.click(".s3d-tut-nav .s3d-primary") if i < 8 else None
    # kamera bebas per cuaca
    page.click(".s3d-modes [data-mode='bebas']")
    for wx in ["cerah", "kabut"]:
        page.click(f".s3d-top [aria-label='Cuaca'] [data-value='{wx}']")
        for k, cam in enumerate(["orbit", "kejar", "atas", "kokpit"]):
            page.keyboard.press(str(k + 1))
            time.sleep(1.5)
            print("bebas", wx, cam, page.evaluate(VIS_JS))
    print("logs", log)
    b.close()
