"""QA tata letak di layar laptop umum yang lebih pendek (1366x768, 1280x720) dan tablet 820x1180.
Memeriksa apakah tombol Lanjut terlihat tanpa menggulir dan apakah bar keselamatan bertabrakan dengan panel."""
import time

from playwright.sync_api import sync_playwright

from sim3d_qa_tampilan_common import BASE, launch, snap, wait_ready, shot

CHECK = r"""
() => {
  const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) }; };
  const inter = (a, b) => a && b && a.w && b.w && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
  const next = r('.s3d-tut-nav .s3d-primary');
  const stage = r('.s3d-stage');
  const safety = r('.s3d-safety'), tut = r('.s3d-tut'), right = r('.s3d-right'), top = r('.s3d-top');
  const topKids = [...document.querySelectorAll('.s3d-top > *')].map((e) => { const b = e.getBoundingClientRect(); return [e.className, Math.round(b.left), Math.round(b.right), Math.round(b.top), Math.round(b.bottom)]; });
  return { layout: document.querySelector('.s3d').dataset.layout, next, nextVisible: next && next.b <= stage.b && next.t >= stage.t, safetyVsTut: inter(safety, tut), safetyVsRight: inter(safety, right), topKids, topH: top && top.h };
}
"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing", headless=True)
    for w, h in [(1366, 768), (1280, 720), (1024, 768), (820, 1180)]:
        ctx = b.new_context(viewport={"width": w, "height": h})
        page = ctx.new_page()
        logs = []
        page.on("console", lambda m: logs.append(m.text) if m.type in ("error", "warning") else None)
        page.goto(f"{BASE}/index.html#/simulator/tutorial")
        wait_ready(page)
        time.sleep(2)
        info = page.evaluate(CHECK)
        print(w, h, info)
        shot(page, f"laptop_{w}x{h}_tut1.png")
        # langkah 2 punya teks paling panjang
        page.click(".s3d-tut-nav .s3d-primary") if info["next"] else None
        time.sleep(1.2)
        print("  step2", page.evaluate(CHECK)["nextVisible"])
        shot(page, f"laptop_{w}x{h}_tut2.png")
        print("  logs", [l for l in logs if "CONNECTION_RESET" not in l])
        ctx.close()
    b.close()
