"""QA independen: kelancaran pelajaran Misi Shuttle Otonom (port 8139).

Mengukur jarak antarframe (requestAnimationFrame) selama 6 detik dan tugas panjang (long task)
di desktop, desktop 2x dengan hujan, dan ponsel dengan CPU diperlambat 4x.
Pemakaian: python3 tests/shuttle_indep_perf.py
"""
import json

from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
BASE = "http://127.0.0.1:8139/"

MEASURE = """
() => new Promise((resolve) => {
  const gaps = [];
  let long = 0;
  const po = new PerformanceObserver((l) => { long += l.getEntries().length; });
  try { po.observe({ type: 'longtask', buffered: false }); } catch (e) {}
  let last = performance.now();
  const t0 = last;
  function f(now) {
    gaps.push(now - last);
    last = now;
    if (now - t0 < 6000) requestAnimationFrame(f);
    else {
      po.disconnect();
      gaps.sort((a, b) => a - b);
      const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      resolve({ fps: +(1000 / mean).toFixed(1), p95: +gaps[Math.floor(gaps.length * 0.95)].toFixed(1),
                over34: gaps.filter((g) => g > 34).length, frames: gaps.length, longTasks: long });
    }
  }
  requestAnimationFrame(f);
})
"""

out = {}
errors = []
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=CHROME, headless=True)
    for name, mobile, throttle, actions in [
        ("desktop", False, 1, []),
        ("desktop-2x-hujan", False, 1, ["2x", "hujan"]),
        ("ponsel-cpu4x-ikuti", True, 4, []),
        ("ponsel-cpu4x-peta", True, 4, ["peta"]),
    ]:
        if mobile:
            ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        else:
            ctx = browser.new_context(viewport={"width": 1366, "height": 900})
        page = ctx.new_page()
        page.on("console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.goto(BASE + "#/pelajaran/shuttle", wait_until="load")
        page.wait_for_timeout(1500)
        if "2x" in actions:
            page.locator(".speed-wrap .seg-btn", has_text="2x").click()
        if "hujan" in actions:
            page.locator(".ctl-toggle", has_text="Hujan").click()
        if "peta" in actions:
            page.locator(".seg-btn", has_text="Seluruh kampus").click()
        page.locator(".sim-canvas").scroll_into_view_if_needed()
        if throttle > 1:
            cdp = ctx.new_cdp_session(page)
            cdp.send("Emulation.setCPUThrottlingRate", {"rate": throttle})
        page.wait_for_timeout(800)
        out[name] = page.evaluate(MEASURE)
        ctx.close()
    browser.close()
out["errors"] = errors
print(json.dumps(out, indent=1))
