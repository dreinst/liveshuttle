"""Ukur kelancaran pelajaran Misi Shuttle Otonom: fps dan long task, desktop dan ponsel
(ponsel diemulasikan dengan CPU diperlambat 4 kali). Butuh server di port 8119."""
import json
from playwright.sync_api import sync_playwright

CHROME = ("/Users/mcdonny/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"
          "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")
URL = "http://127.0.0.1:8119/#/pelajaran/shuttle"
MEASURE = """async (ms) => {
  const longTasks = [];
  const po = new PerformanceObserver((l) => { for (const e of l.getEntries()) longTasks.push(e.duration); });
  try { po.observe({ entryTypes: ['longtask'] }); } catch (e) {}
  const frames = [];
  let last = performance.now();
  await new Promise((resolve) => {
    const t0 = last;
    function f(now) { frames.push(now - last); last = now; if (now - t0 < ms) requestAnimationFrame(f); else resolve(); }
    requestAnimationFrame(f);
  });
  po.disconnect();
  frames.sort((a, b) => a - b);
  const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
  return { fps: +(1000 / avg).toFixed(1), p95: +frames[Math.floor(frames.length * 0.95)].toFixed(1), longTasks: longTasks.length, worstLong: longTasks.length ? Math.max(...longTasks).toFixed(0) : 0 };
}"""

out = {}
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME, headless=True)
    for name, opts, throttle in [
        ("desktop", dict(viewport={"width": 1366, "height": 900}), 1),
        ("desktop-2x-hujan", dict(viewport={"width": 1366, "height": 900}), 1),
        ("ponsel-cpu4x", dict(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True), 4),
        ("ponsel-cpu4x-peta-2x", dict(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True), 4),
    ]:
        ctx = b.new_context(**opts)
        page = ctx.new_page()
        errs = []
        page.on("console", lambda m: errs.append(m.text) if m.type in ("error", "warning") else None)
        page.goto(URL, wait_until="load")
        page.wait_for_timeout(1500)
        if throttle > 1:
            cdp = ctx.new_cdp_session(page)
            cdp.send("Emulation.setCPUThrottlingRate", {"rate": throttle})
        if "2x" in name:
            page.locator(".speed-wrap .seg-btn", has_text="2x").click()
        if "hujan" in name:
            page.locator(".ctl-toggle", has_text="Hujan").click()
        if "peta" in name:
            page.locator(".seg-btn", has_text="Seluruh kampus").click()
        page.evaluate("() => window.scrollTo(0, 0)")
        page.wait_for_timeout(800)
        out[name] = page.evaluate(MEASURE, 5000)
        out[name]["errors"] = errs
        ctx.close()
    b.close()
print(json.dumps(out, indent=2))
