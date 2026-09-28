"""Berapa persen cincin jangkauan LiDAR 60 m yang terlihat di area kanvas bebas panel, per preset kamera."""
import sys
import time
from sim3d_fix_common import *  # noqa

MEASURE = r"""() => {
  const a = window.__app, e = a.ego, R = a.sensing.ranges().lidar;
  a.hud.measureOccluders();
  const st = a.hud.stage.getBoundingClientRect();
  let ok = 0; const N = 72;
  for (let i = 0; i < N; i++) {
    const ang = (i / N) * Math.PI * 2;
    const p = a.screenOf(e.x + Math.cos(ang) * R, e.z + Math.sin(ang) * R);
    const x = p.x - st.left, y = p.y - st.top;
    if (!p.visible || x < 0 || y < 0 || x > st.width || y > st.height) continue;
    if (a.hud.occ.some((o) => x > o.l && x < o.r && y > o.t && y < o.b)) continue;
    ok++;
  }
  return Math.round((ok / N) * 100);
}"""

presets = [
    ("orbit", {"dist": 70, "back": 0.45}),
    ("orbit", {"dist": 100, "back": 0.45}),
    ("orbit", {"dist": 110, "back": 0.35}),
    ("orbit", {"dist": 120, "back": 0.4}),
    ("atas", {"height": 140}),
    ("atas", {"height": 160}),
    ("atas", {"height": 175}),
]
mobile = "--mobile" in sys.argv
with sync_playwright() as p:
    b = launch(p)
    ctx, page, log = new_page(b, mobile=mobile)
    open_sim(page, "tutorial")
    ev(page, "() => window.__app.tutorial.go(1)")
    time.sleep(1)
    for mode, opts in presets:
        ev(page, "([m, o]) => { window.__app.setCamera(m, Object.assign({}, o, { reset: true, fromTutorial: true })); }", [mode, opts])
        time.sleep(1.2)
        pct = ev(page, MEASURE)
        name = f"ring_{'m' if mobile else 'd'}_{mode}_{list(opts.values())[0]}.png"
        shot(page, name)
        print(mode, opts, "cincin terlihat", pct, "%", name)
    print("LOG", log)
    b.close()
